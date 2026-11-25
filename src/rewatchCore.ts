// « À revoir » : QUI l'a posé, QUAND et OÙ (d'où le clic a été fait), et le filtre « À revoir » de la liste Joueurs et
// des questions à Nextar. Fonctions pures, sans base ni écran (testées par tools/test-a-revoir.ts).
//
//  - Origine (supabase/055_a_revoir_origine.sql) : { kind, id?, label?, saved? }, posée à la création du « à revoir »,
//    jamais réécrite ensuite (comme originEventId). Déduite de l'écran : l'événement ou le groupe de la ligne, sinon la
//    page (originFromPath), et pour la liste Joueurs le nom du filtre enregistré ou les filtres posés (listOrigin) —
//    jamais un nom de joueur ni une recherche par nom. Les anciens « à revoir » n'en ont pas : originEventId suffit,
//    sinon rien (« Mis par …, le … », sans « depuis »).
//  - Ligne en clair : « Mis par Sophie, le 12/10 à 15 h 40, depuis l’événement « Tournoi de l’Espenon » ».
//  - Filtre (Population.rewatch de src/recipe.ts) : par qui (moi, mon staff, tous les staffs pour un administrateur),
//    repérés à (événements d'origine), mis à revoir (ce mois-ci, le mois dernier, cette saison, entre deux dates), état
//    (pas encore revu, revu). Un joueur passe s'il a AU MOINS UN « à revoir » qui remplit toutes les conditions.
// Uniquement des formulations positives ou neutres sur les jeunes : « à revoir », « revu », « pas encore revu ».

import { seasonOf } from './coverage'

// ---------- Origine ----------

export const ORIGIN_KINDS = ['event', 'group', 'list', 'player', 'bilan', 'question', 'follows', 'rewatch', 'home', 'other'] as const
export type RewatchOriginKind = (typeof ORIGIN_KINDS)[number]
/** D'où le « à revoir » a été posé. `saved` : `label` est le nom d'un filtre enregistré (« Mes filtres »). */
export interface RewatchOrigin {
  kind: RewatchOriginKind
  id?: string
  label?: string
  saved?: boolean
}

const MAX_ID = 120
const MAX_LABEL = 120
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f-\u009f]+/g

/** Origine lue (appareil, serveur) : mêmes règles que hb_rewatch_origin (supabase/055) ; mal formée : undefined. */
export function cleanOrigin(v: unknown): RewatchOrigin | undefined {
  if (!isObj(v) || !(ORIGIN_KINDS as readonly unknown[]).includes(v.kind)) return undefined
  const o: RewatchOrigin = { kind: v.kind as RewatchOriginKind }
  if (typeof v.id === 'string' && v.id.length > 0 && v.id.length <= MAX_ID && !/[\u0000-\u001f\u007f-\u009f]/.test(v.id)) o.id = v.id
  if (typeof v.label === 'string') {
    const l = v.label.replace(CTRL, ' ').trim().slice(0, MAX_LABEL)
    if (l) o.label = l
  }
  if (v.saved === true && o.label) o.saved = true
  return o
}

/**
 * Origine d'après l'adresse de l'écran (sans la base de l'appli) : l'événement ou le groupe ouvert (fiche ouverte depuis
 * eux comprise), la fiche d'un joueur, la liste Joueurs, le bilan (ou une question posée au bilan), Mes suivis, la page
 * « À revoir », l'accueil.
 */
export function originFromPath(path: string): RewatchOrigin {
  const seg = path.split(/[?#]/)[0].split('/').filter(Boolean).map((s) => decodeURIComponent(s))
  const [a, b] = seg
  const real = (x?: string) => !!x && x !== 'nouveau' && x !== 'nouvelle'
  if (!a) return { kind: 'home' }
  if (a === 'evenements') return real(b) ? { kind: 'event', id: b } : { kind: 'other' }
  if (a === 'groupes') return real(b) ? { kind: 'group', id: b } : { kind: 'other' }
  if (a === 'joueurs') return real(b) ? { kind: 'player' } : { kind: 'list' }
  if (a === 'bilan') return b === 'question' ? { kind: 'question' } : { kind: 'bilan' }
  if (a === 'suivis') return { kind: 'follows' }
  if (a === 'a-revoir') return { kind: 'rewatch' }
  return { kind: 'other' }
}

/** Origine retenue : l'événement de la ligne (repéré là), sinon son groupe, sinon celle de l'écran. */
export function pickOrigin(ctx: { originEventId?: string; groupId?: string }, here?: RewatchOrigin): RewatchOrigin | undefined {
  if (ctx.originEventId) return { kind: 'event', id: ctx.originEventId }
  if (ctx.groupId) return { kind: 'group', id: ctx.groupId }
  return here ? cleanOrigin(here) : undefined
}

/**
 * Origine « liste Joueurs » : le nom du filtre enregistré appliqué tel quel, sinon les pastilles des filtres posés
 * (« Féminin · nées en 2011 · Var »), sans recherche par nom (un nom de joueur ne part jamais), 120 caractères au plus.
 */
export function listOrigin(chips: readonly string[], savedName?: string): RewatchOrigin {
  const name = savedName?.replace(CTRL, ' ').trim()
  if (name) return { kind: 'list', label: name.slice(0, MAX_LABEL), saved: true }
  let label = ''
  for (const c of chips.map((x) => x.replace(CTRL, ' ').trim()).filter(Boolean)) {
    const next = label ? `${label} · ${c}` : c
    if (next.length > MAX_LABEL) {
      label = label ? `${label} …` : c.slice(0, MAX_LABEL - 1) + '…'
      break
    }
    label = next
  }
  return label ? { kind: 'list', label } : { kind: 'list' }
}

/** Ce que garde une ligne « à revoir » pour dire qui, quand et où (Rewatch de src/db.ts). */
export type RewatchLike = {
  id?: string
  playerId: string
  originEventId?: string
  origin?: RewatchOrigin
  events?: string[]
  groups?: string[]
  createdBy?: string
  createdByName?: string
  createdAtServer?: string
  updatedAt: number
  done?: { at?: string; by?: string; byName?: string }
}

/** Origine d'une ligne : la sienne, sinon (ligne d'avant 055) l'événement où il a été repéré. */
export function originOf(r: Pick<RewatchLike, 'origin' | 'originEventId'>): RewatchOrigin | undefined {
  const o = cleanOrigin(r.origin)
  if (o) return o
  return r.originEventId ? { kind: 'event', id: r.originEventId } : undefined
}

/** Événement d'origine (repéré là) : originEventId, sinon une origine « événement ». */
export const originEvent = (r: Pick<RewatchLike, 'origin' | 'originEventId'>) => r.originEventId ?? (r.origin?.kind === 'event' ? r.origin.id : undefined)

export type OriginNames = { event: (id: string) => string | undefined; group: (id: string) => string | undefined }

/**
 * Origine en clair, après « depuis » : « l’événement « Tournoi de l’Espenon » », « le groupe « Repérés » », « la liste
 * Joueurs (Féminin · nées en 2011) », « la liste Joueurs, filtre « Mes gardiennes » », « sa fiche », « le bilan de
 * détection »… ; undefined : origine inconnue (ligne d'avant, autre écran).
 */
export function originText(o: RewatchOrigin | undefined, names: OriginNames): string | undefined {
  if (!o) return undefined
  const q = (s: string) => `« ${s} »`
  switch (o.kind) {
    case 'event': {
      const n = (o.id && names.event(o.id)) || o.label
      return n ? `l’événement ${q(n)}` : 'un événement'
    }
    case 'group': {
      const n = (o.id && names.group(o.id)) || o.label
      return n ? `le groupe ${q(n)}` : 'un groupe'
    }
    case 'list':
      return o.label ? (o.saved ? `la liste Joueurs, filtre ${q(o.label)}` : `la liste Joueurs (${o.label})`) : 'la liste Joueurs'
    case 'player':
      return 'sa fiche'
    case 'bilan':
      return 'le bilan de détection'
    case 'question':
      return 'une question au bilan'
    case 'follows':
      return '« Mes suivis »'
    case 'rewatch':
      return 'la page « À revoir »'
    case 'home':
      return 'l’accueil'
    default:
      return undefined
  }
}

/** Titre court d'une carte « par origine » : « Tournoi de l’Espenon », « Liste Joueurs · Féminin », « Filtre « Mes gardiennes » »… */
export function originTitle(o: RewatchOrigin, names: OriginNames): string {
  const q = (s: string) => `« ${s} »`
  switch (o.kind) {
    case 'event':
      return (o.id && names.event(o.id)) || o.label || 'Un événement'
    case 'group': {
      const n = (o.id && names.group(o.id)) || o.label
      return n ? `Groupe ${q(n)}` : 'Un groupe'
    }
    case 'list':
      return o.label ? (o.saved ? `Filtre ${q(o.label)}` : `Liste Joueurs · ${o.label}`) : 'Liste Joueurs'
    case 'player':
      return 'Depuis une fiche'
    case 'bilan':
      return 'Bilan de détection'
    case 'question':
      return 'Question au bilan'
    case 'follows':
      return 'Mes suivis'
    case 'rewatch':
      return 'Page « À revoir »'
    case 'home':
      return 'Accueil'
    default:
      return 'Autre écran'
  }
}

/** Clé de regroupement par origine (même événement, même groupe, même filtre de la liste) et son titre. */
export function originGroup(r: Pick<RewatchLike, 'origin' | 'originEventId'>, names: OriginNames): { key: string; title: string } {
  const o = originOf(r)
  if (!o) return { key: 'none', title: 'Sans origine' }
  const key = o.kind === 'event' || o.kind === 'group' ? `${o.kind}:${o.id ?? ''}` : o.kind === 'list' ? `list:${o.saved ? 's' : ''}:${o.label ?? ''}` : o.kind
  return { key, title: originTitle(o, names) }
}

// ---------- Qui, quand ----------

/** Moment de création (ISO) : signature du serveur, sinon l'heure de l'appareil (ligne pas encore envoyée). */
export const createdAtOf = (r: Pick<RewatchLike, 'createdAtServer' | 'updatedAt'>) => r.createdAtServer ?? new Date(r.updatedAt).toISOString()

const pad = (n: number) => String(n).padStart(2, '0')

/** « le 12/10 à 15 h 40 » (heure de l'appareil) ; une autre année : « le 12/10/2025 à 15 h 40 ». */
export function whenText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}${d.getFullYear() === now.getFullYear() ? '' : `/${d.getFullYear()}`}`
  return `le ${day} à ${d.getHours()} h ${pad(d.getMinutes())}`
}

/** Jour local (AAAA-MM-JJ) d'un horodatage ISO. */
export const localDayOf = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Titre d'une journée : « Aujourd’hui », « Hier », « Samedi 12 octobre » (« … 2025 » une autre année). */
export function dayTitle(day: string, today: string): string {
  if (!day) return 'Date inconnue'
  if (day === today) return 'Aujourd’hui'
  const t = Date.parse(`${today}T12:00:00`)
  if (day === new Date(t - 86_400_000).toLocaleDateString('sv')) return 'Hier'
  const d = new Date(`${day}T12:00:00`)
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** « Mis par Sophie, le 12/10 à 15 h 40, depuis l’événement « Tournoi de l’Espenon » » (moi : « Mis par toi »). */
export function rewatchLine(r: RewatchLike, mine: boolean, names: OriginNames, now: Date = new Date()): string {
  const who = mine ? 'toi' : r.createdByName?.trim() || 'un membre du staff'
  const when = whenText(createdAtOf(r), now)
  const from = originText(originOf(r), names)
  return [`Mis par ${who}`, when, from && `depuis ${from}`].filter(Boolean).join(', ')
}

// ---------- Filtre « À revoir » ----------

export type RewatchBy = 'me' | 'staff' | 'all'
export type RewatchState = 'open' | 'done'
export type RewatchWhenKind = 'month' | 'lastMonth' | 'season' | 'between'
/** Moment où il a été mis à revoir : ce mois-ci, le mois dernier, cette saison (1er septembre → 31 août), entre deux dates. */
export type RewatchWhen = { kind: RewatchWhenKind; from?: string; to?: string }
/** Filtre ; absent = tout : par mon staff (by), repérés n'importe où, n'importe quand, revus ou non. */
export type RewatchWanted = { by?: RewatchBy; from?: string[]; when?: RewatchWhen; state?: RewatchState }

/**
 * Un « à revoir » d'un joueur, pour le filtre : le mien ? de mon staff ? jour de création (local), événement d'origine,
 * revu (à la main, ou vu / noté dans un événement visé).
 */
export type RewatchFact = { mine: boolean; staff: boolean; day: string; origin?: string; done: boolean }

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID

/** Filtre lu (adresse, session, « Mes filtres ») : chaque champ revérifié ; rien de valable : {} (= tous les « à revoir »). */
export function cleanWanted(v: unknown): RewatchWanted | undefined {
  if (v === true) return {}
  if (!isObj(v)) return undefined
  const w: RewatchWanted = {}
  if (v.by === 'me' || v.by === 'all') w.by = v.by
  const from = Array.isArray(v.from) ? [...new Set(v.from.filter(okId))].slice(0, 20) : []
  if (from.length) w.from = from
  if (isObj(v.when)) {
    const k = v.when.kind
    if (k === 'month' || k === 'lastMonth' || k === 'season') w.when = { kind: k }
    else if (k === 'between') {
      const a = isDay(v.when.from) ? v.when.from : undefined
      const b = isDay(v.when.to) ? v.when.to : undefined
      if (a || b) w.when = { kind: 'between', ...(a && b && a > b ? { from: b, to: a } : { ...(a ? { from: a } : {}), ...(b ? { to: b } : {}) }) }
    }
  }
  if (v.state === 'open' || v.state === 'done') w.state = v.state
  return w
}

/** Bornes (jours compris) d'un moment ; undefined : sans borne. */
export function whenRange(w: RewatchWhen, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  if (w.kind === 'month') return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last(y, m))}` }
  if (w.kind === 'lastMonth') {
    const [yy, mm] = m === 1 ? [y - 1, 12] : [y, m - 1]
    return { from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${pad(last(yy, mm))}` }
  }
  if (w.kind === 'season') return seasonOf(today)
  return { from: w.from ?? '0000-01-01', to: w.to ?? '9999-12-31' }
}

/** Ce « à revoir » remplit-il le filtre ? */
export function factMatches(f: RewatchFact, w: RewatchWanted, today: string): boolean {
  const by = w.by ?? 'staff'
  if (by === 'me' && !f.mine) return false
  if (by === 'staff' && !f.staff && !f.mine) return false
  if (w.from?.length && !(f.origin && w.from.includes(f.origin))) return false
  if (w.when) {
    const r = whenRange(w.when, today)
    if (!f.day || f.day < r.from || f.day > r.to) return false
  }
  if (w.state === 'open' && f.done) return false
  if (w.state === 'done' && !f.done) return false
  return true
}

/** Le joueur a-t-il au moins un « à revoir » qui remplit le filtre ? */
export const anyMatches = (facts: readonly RewatchFact[] | undefined, w: RewatchWanted, today: string) => !!facts?.some((f) => factMatches(f, w, today))

const frDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

/** Moment en clair : « ce mois-ci », « le mois dernier », « cette saison », « du 01/10/2026 au 15/10/2026 », « depuis le … ». */
export function whenLabel(w: RewatchWhen): string {
  if (w.kind === 'month') return 'ce mois-ci'
  if (w.kind === 'lastMonth') return 'le mois dernier'
  if (w.kind === 'season') return 'cette saison'
  if (w.from && w.to) return `du ${frDay(w.from)} au ${frDay(w.to)}`
  if (w.from) return `depuis le ${frDay(w.from)}`
  return w.to ? `jusqu’au ${frDay(w.to)}` : 'n’importe quand'
}

/**
 * Pastille du filtre : « à revoir », « mes à revoir · le mois dernier », « à revoir · repérées au Tournoi de l’Espenon ·
 * pas encore revues » ; `fem` : accord au féminin (filtre « Féminin » ou liste de filles).
 */
export function wantedText(w: RewatchWanted, eventName: (id: string) => string, fem = false): string {
  const e = fem ? 'es' : 's'
  const parts: string[] = [w.by === 'me' ? 'mes à revoir' : 'à revoir']
  if (w.by === 'all') parts.push('tous les staffs')
  if (w.when) parts.push(`mis${fem ? 'es' : ''} à revoir ${whenLabel(w.when)}`)
  if (w.from?.length) {
    const ns = w.from.map(eventName)
    const list = ns.length > 2 ? `${ns.slice(0, 2).join(', ')} +${ns.length - 2}` : ns.join(' ou ')
    parts.push(`repéré${e} à ${list}`)
  }
  if (w.state === 'open') parts.push(`pas encore revu${e}`)
  if (w.state === 'done') parts.push(`revu${e}`)
  return parts.join(' · ')
}

/** « par moi », « mon staff », « tous les staffs » : choix du filtre (tous les staffs : administrateurs). */
export const BY_LABEL: Record<RewatchBy, string> = { me: 'Par moi', staff: 'Tout mon staff', all: 'Tous les staffs' }
export const STATE_LABEL = (fem = false): Record<RewatchState, string> => ({ open: `Pas encore revu${fem ? 'es' : 's'}`, done: `Revu${fem ? 'es' : 's'}` })
export const WHEN_LABEL: Record<Exclude<RewatchWhenKind, 'between'>, string> = { month: 'Ce mois-ci', lastMonth: 'Le mois dernier', season: 'Cette saison' }

// ---------- Lecture d'une phrase (recette rendue par le modèle) ----------

/**
 * « aRevoir » rendu par le modèle : true, ou { par (moi | staff | tous), evenements [noms], periode (ce_mois |
 * mois_dernier | saison | {du, au}), etat (a_revoir | revu | tous) }. Les noms d'événements sont retrouvés par
 * `findEvent` (sur l'appareil) ; ce qui ne se lit pas est signalé par `skip`.
 */
export function readWanted(
  v: unknown,
  findEvent: (said: string) => string | undefined,
  skip: (what: string, why: string) => void,
): RewatchWanted | undefined {
  if (v === undefined || v === null || v === false || v === '') return undefined
  if (v === true || v === 'true' || v === 'oui') return {}
  if (!isObj(v)) {
    skip(`à revoir « ${String(v).slice(0, 30)} »`, 'valeur inconnue')
    return undefined
  }
  const fold = (x: unknown) => (typeof x === 'string' ? x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() : '')
  const w: RewatchWanted = {}
  const par = fold(v.par)
  if (par) {
    if (/^(moi|me|mes|je|perso)/.test(par)) w.by = 'me'
    else if (/^(tous|tout le monde|tous les staffs|toutes)/.test(par)) w.by = 'all'
    else if (!/^(staff|mon staff|equipe|nous)/.test(par)) skip(`à revoir par « ${String(v.par).slice(0, 30)} »`, 'moi ou le staff')
  }
  const evs = Array.isArray(v.evenements) ? v.evenements : v.evenements !== undefined ? [v.evenements] : Array.isArray(v.evenement) ? v.evenement : v.evenement !== undefined ? [v.evenement] : []
  const from: string[] = []
  for (const x of evs.slice(0, 20)) {
    const id = typeof x === 'string' ? findEvent(x) : undefined
    if (id) from.push(id)
    else skip(`repéré à « ${String(x).slice(0, 40)} »`, 'événement introuvable')
  }
  if (from.length) w.from = [...new Set(from)]
  const p = v.periode
  if (p !== undefined && p !== null && p !== '') {
    const s = fold(p)
    if (/^(ce mois|ce_mois|mois en cours|mois courant)/.test(s)) w.when = { kind: 'month' }
    else if (/^(mois dernier|mois_dernier|le mois dernier|mois precedent)/.test(s)) w.when = { kind: 'lastMonth' }
    else if (/^(saison|cette saison|la saison)/.test(s)) w.when = { kind: 'season' }
    else if (isObj(p) && (isDay(p.du) || isDay(p.au))) {
      const c = cleanWanted({ when: { kind: 'between', from: p.du, to: p.au } })
      if (c?.when) w.when = c.when
    } else skip(`mis à revoir « ${typeof p === 'string' ? p.slice(0, 30) : 'période'} »`, 'ce mois-ci, le mois dernier, cette saison ou deux dates')
  }
  const etat = fold(v.etat)
  if (etat) {
    if (/^(a revoir|a_revoir|pas encore|non revu|ouvert|en attente)/.test(etat)) w.state = 'open'
    else if (/^(revu|deja revu|revus)/.test(etat)) w.state = 'done'
    else if (!/^(tous|tout)/.test(etat)) skip(`état « ${String(v.etat).slice(0, 30)} »`, 'à revoir, revu ou tous')
  }
  return w
}

// ---------- Page « À revoir » : rangement en cartes ----------

/** Rangement de la page « À revoir » : par date (jour, semaine, mois), par événement d'origine, par personne, par origine. */
export type RewatchGrouping = 'date' | 'event' | 'person' | 'origin'
/** Rangements proposés : par date, par événement, par personne (« Par origine » retiré du choix le 26/10, trop proche). */
export const GROUPINGS: { value: RewatchGrouping; label: string }[] = [
  { value: 'date', label: 'Par date' },
  { value: 'event', label: 'Par événement' },
  { value: 'person', label: 'Par personne' },
]
export const isGrouping = (v: unknown): v is RewatchGrouping => GROUPINGS.some((g) => g.value === v)
/** Rangement gardé sur l'appareil : l'ancien « par origine » devient « par événement » ; inconnu : par date. */
export const readGrouping = (v: unknown): RewatchGrouping => (v === 'origin' ? 'event' : isGrouping(v) ? v : 'date')

/**
 * Période d'une date de création, du plus récent au plus ancien : aujourd'hui, hier, cette semaine (depuis lundi), la
 * semaine dernière, plus tôt ce mois-ci, le mois dernier, puis un mois (« Août 2026 »). `rank` : ordre des cartes.
 */
export function dateBucket(day: string, today: string): { key: string; title: string; rank: number } {
  if (!day) return { key: 'inconnue', title: 'Date inconnue', rank: 9e9 }
  const t = Date.parse(`${today}T12:00:00Z`)
  const d = Date.parse(`${day}T12:00:00Z`)
  const ago = Math.round((t - d) / 86_400_000)
  if (ago <= 0) return { key: 'today', title: 'Aujourd’hui', rank: 0 }
  if (ago === 1) return { key: 'yesterday', title: 'Hier', rank: 1 }
  const dow = (new Date(t).getUTCDay() + 6) % 7 // lundi = 0
  if (ago <= dow) return { key: 'week', title: 'Plus tôt cette semaine', rank: 2 }
  if (ago <= dow + 7) return { key: 'lastWeek', title: 'La semaine dernière', rank: 3 }
  const ym = (s: string) => s.slice(0, 7)
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const last = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`
  if (ym(day) === ym(today)) return { key: 'month', title: 'Plus tôt ce mois-ci', rank: 4 }
  if (ym(day) === last) return { key: 'lastMonth', title: 'Le mois dernier', rank: 5 }
  const s = new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  // Plus le mois est ancien, plus la carte est bas.
  return { key: ym(day), title: s.charAt(0).toUpperCase() + s.slice(1), rank: 10 + (y * 12 + m - (Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)))) }
}

/** Une ligne « à revoir » à ranger : la ligne, son état pour le filtre, et le moment de création (ms) pour l'ordre. */
export type RankedRow<R extends RewatchLike> = { r: R; fact: RewatchFact; at: number }
/** Une carte : titre, et ses joueurs (le plus récent d'abord), chacun avec ses « à revoir » de la carte (le plus récent d'abord). */
export type RewatchCard<R extends RewatchLike> = { key: string; title: string; players: { playerId: string; rows: RankedRow<R>[] }[]; rows: RankedRow<R>[] }

/**
 * Range les « à revoir » en cartes. Sans origine connue (anciens « à revoir » sans événement ni groupe) : « Sans origine »
 * (par origine) ou « Hors événement » (par événement), à la fin. Par personne : toi d'abord, puis par nom.
 */
export function groupRewatch<R extends RewatchLike>(
  rows: readonly RankedRow<R>[],
  by: RewatchGrouping,
  ctx: { names: OriginNames; today: string; eventDate?: (id: string) => string | undefined },
): RewatchCard<R>[] {
  type Acc = { key: string; title: string; order: number | string; last: boolean; rows: RankedRow<R>[] }
  const cards = new Map<string, Acc>()
  for (const x of rows) {
    let key: string
    let title: string
    let order: number | string = 0
    let last = false
    if (by === 'date') {
      const b = dateBucket(x.fact.day, ctx.today)
      ;({ key, title } = b)
      order = b.rank
    } else if (by === 'event') {
      const ev = originEvent(x.r)
      key = ev ? `event:${ev}` : 'none'
      title = ev ? (ctx.names.event(ev) ?? 'Événement') : 'Hors événement'
      last = !ev
      // Événement le plus récent d'abord (sa date ; sinon le moment du « à revoir »).
      order = -Date.parse(`${(ev && ctx.eventDate?.(ev)) || '0000-01-01'}T00:00:00Z`)
    } else if (by === 'person') {
      key = x.fact.mine ? 'me' : `p:${x.r.createdBy ?? x.r.createdByName ?? '?'}`
      title = x.fact.mine ? 'Toi' : x.r.createdByName?.trim() || 'Un membre du staff'
      order = x.fact.mine ? '' : `~${title.toLocaleLowerCase('fr')}`
    } else {
      ;({ key, title } = originGroup(x.r, ctx.names))
      last = key === 'none'
    }
    let c = cards.get(key)
    if (!c) cards.set(key, (c = { key, title, order, last, rows: [] }))
    c.rows.push(x)
  }
  const latest = (c: Acc) => Math.max(...c.rows.map((x) => x.at))
  const sorted = [...cards.values()].sort((a, b) => {
    if (a.last !== b.last) return a.last ? 1 : -1
    if (by === 'origin') return latest(b) - latest(a)
    if (typeof a.order === 'string' || typeof b.order === 'string') return String(a.order).localeCompare(String(b.order), 'fr')
    return a.order - b.order || latest(b) - latest(a)
  })
  return sorted.map((c) => {
    const byPlayer = new Map<string, RankedRow<R>[]>()
    for (const x of [...c.rows].sort((a, b) => b.at - a.at)) byPlayer.set(x.r.playerId, [...(byPlayer.get(x.r.playerId) ?? []), x])
    return { key: c.key, title: c.title, rows: c.rows, players: [...byPlayer].map(([playerId, rs]) => ({ playerId, rows: rs })) }
  })
}
