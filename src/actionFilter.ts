import { KIND_LABEL, type ActionKind, type MatchSheet, type Side } from './matchSheet'
import { pillLabel, type PillKind, type PillLabel } from './seqPills'
import { kindRank, type SeqItem } from './sequencer'
import type { VideoMoment } from './db'
import { fmtMoment, momentAt, stepMoment } from './videos'
import { currentSport } from './sportConfig'
import { VOLLEY_CAT_SPECS, volleyMomentKind, type VolleySkill } from './volleyActions'

/*
 * Visibilité par type d'action (calcul pur, partagé) : pastilles à cocher BUT, 7 M, TIR (raté), PASSE, ARRÊT, PERTE, 2′,
 * CARTON, TM (et les deux équipes au séquençage). Seuls les types présents ont une pastille, avec leur nombre.
 *
 * - Séquençage en plein écran (Sequencer.tsx, MatchTimeline.tsx) : une action d'un type décoché disparaît de la frise et
 *   n'est plus annoncée ; « C'est ici » cale la prochaine visible, N passe à la prochaine visible. Rien n'est écrit pour
 *   les masquées : ni calées ni ignorées, elles restent à caler et reviennent quand on recoche. L'estimation des temps
 *   (sequencer.ts, matchSheet.ts timeline) ne change pas : elle se fait sur toute la feuille.
 * - Lecture (VideoPlayer.tsx) : la liste des moments, ⏮ ⏭, P / N et « Voir les actions » ne passent que par les moments
 *   des types cochés ; le type d'un moment se lit dans sa note (« But 2-1 · feuille ») ; les autres moments : « AUTRE ».
 *
 * Catégories du sport de l'installation (catsFor) : handball ci-dessous (CATS) ; volley : un geste par pastille (SERVICE,
 * RÉCEPTION, PASSE, ATTAQUE, CONTRE, DÉFENSE), ses trois résultats regroupés comme « 7 M » regroupe les jets de 7 m, le type
 * d'un moment lu dans sa note (« Attaque réussie · n° 7 » : src/volleyActions.ts).
 */

export type CatId = 'but' | '7m' | 'tir' | 'passe' | 'arret' | 'perte' | '2mn' | 'carton' | 'tm' | 'autre' | VolleySkill

export interface Cat {
  id: CatId
  /** Libellé de la pastille (mêmes mots que les pastilles du séquençage). */
  label: PillLabel
  /** « buts » : compteur quand ce seul type est coché (« 5/12 buts »). */
  plural: string
  kinds: PillKind[]
}

// Libellés du handball, quel que soit le sport de l'installation au chargement (« passe » : passe décisive).
const cat = (id: CatId, kinds: PillKind[], plural: string, label: Partial<PillLabel> = {}): Cat => ({ id, kinds, plural, label: { ...pillLabel(kinds[0], undefined, 'handball'), ...label } })

/** Types montrés (handball), dans l'ordre des pastilles. TIR : tir raté (un tir réussi est un but). 7 M : tous les jets de 7 m. */
export const CATS: Cat[] = [
  cat('but', ['but'], 'buts'),
  cat('7m', ['but7', 'tir7', 'arret7'], '7 m', { long: 'Jets de 7 m' }),
  cat('tir', ['tir'], 'tirs ratés'),
  cat('passe', ['passe'], 'passes décisives'),
  cat('arret', ['arret'], 'arrêts'),
  cat('perte', ['perte'], 'pertes de balle'),
  cat('2mn', ['2mn'], '2 minutes'),
  cat('carton', ['avert', 'disq', 'bleu'], 'cartons', { short: 'CARTON', long: 'Cartons' }),
  cat('tm', ['tm'], 'temps morts'),
  cat('autre', ['autre'], 'autres', { short: 'AUTRE', long: 'Autres' }),
]
/** Volley : un geste par pastille (avec ou sans résultat), puis les autres moments. */
export const VOLLEY_CATS: Cat[] = [...VOLLEY_CAT_SPECS.map((c) => ({ ...c, label: { ...c.label } })), cat('autre', ['autre'], 'autres', { short: 'AUTRE', long: 'Autres' })]

const CATS_BY_SPORT: Record<string, Cat[]> = { handball: CATS, volley: VOLLEY_CATS }
/** Catégories du sport (de l'installation par défaut) ; un sport sans catégories propres : celles du handball. */
export const catsFor = (sport: string = currentSport().sport): Cat[] => CATS_BY_SPORT[sport] ?? CATS
const BY_KIND = new Map<Cat[], Map<PillKind, CatId>>()
function kindMap(cats: Cat[]) {
  let m = BY_KIND.get(cats)
  if (!m) BY_KIND.set(cats, (m = new Map(cats.flatMap((c) => c.kinds.map((k) => [k, c.id] as const)))))
  return m
}
export const catOf = (k: PillKind): CatId => kindMap(catsFor()).get(k) ?? 'autre'
export const catById = (id: CatId) => catsFor().find((c) => c.id === id)!

/** Ce qui est masqué (ce qui est coché par défaut : un type nouveau apparaît coché). */
export interface TypeFilter {
  hide: CatId[]
  /** Équipes masquées (séquençage). */
  sides: Side[]
}
export const SHOW_ALL: TypeFilter = { hide: [], sides: [] }

/** Lecture du choix mémorisé (texte JSON) ; illisible : tout est montré. */
export function parseFilter(raw: string | null | undefined): TypeFilter {
  try {
    const v = JSON.parse(raw ?? '')
    const ids = new Set(catsFor().map((c) => c.id as string))
    return {
      hide: Array.isArray(v?.hide) ? v.hide.filter((x: unknown): x is CatId => typeof x === 'string' && ids.has(x)) : [],
      sides: Array.isArray(v?.sides) ? v.sides.filter((x: unknown): x is Side => x === 'home' || x === 'away') : [],
    }
  } catch {
    return SHOW_ALL
  }
}

export const isFiltered = (f: TypeFilter) => f.hide.length > 0 || f.sides.length > 0
/** Une action est montrée : son type est coché et son équipe aussi (une action sans équipe ne dépend que du type). */
export const shown = (f: TypeFilter, k: PillKind, side?: Side) => !f.hide.includes(catOf(k)) && !(side && f.sides.includes(side))

export const toggleCat = (f: TypeFilter, id: CatId): TypeFilter => ({ ...f, hide: f.hide.includes(id) ? f.hide.filter((x) => x !== id) : [...f.hide, id] })
export const toggleSide = (f: TypeFilter, s: Side): TypeFilter => ({ ...f, sides: f.sides.includes(s) ? f.sides.filter((x) => x !== s) : [...f.sides, s] })
/** « Tout » : tous les types et les deux équipes. « Aucun » : aucun type présent (les équipes restent comme elles sont). */
export const showAll = (): TypeFilter => SHOW_ALL
export const showNone = (f: TypeFilter, present: CatId[]): TypeFilter => ({ ...f, hide: [...new Set([...f.hide, ...present])] })

/** Types présents et leur nombre, dans l'ordre des pastilles (un type absent n'a pas de pastille). */
export function presentCats(kinds: PillKind[]): { cat: Cat; n: number }[] {
  const n = new Map<CatId, number>()
  for (const k of kinds) n.set(catOf(k), (n.get(catOf(k)) ?? 0) + 1)
  return catsFor().flatMap((c) => (n.get(c.id) ? [{ cat: c, n: n.get(c.id)! }] : []))
}

/** Compteur sur la sélection : « 5/12 », « 5/12 buts » quand un seul type présent est coché. */
export function countLabel(k: number, n: number, f: TypeFilter, present: CatId[]) {
  const on = present.filter((id) => !f.hide.includes(id))
  return `${k}/${n}${on.length === 1 && present.length > 1 ? ` ${catById(on[0]).plural}` : ''}`
}

// ---------- Séquençage ----------

/**
 * File du séquençage restreinte aux actions montrées. Un groupe d'actions simultanées reste s'il a au moins une action
 * montrée ; is ne garde que celles-ci, k devient la première d'entre elles (but d'abord). id, i, temps et état (calée)
 * ne changent pas : c'est toujours le même élément de la file (même calage, même repère).
 */
export function filterQueue(ms: Pick<MatchSheet, 'actions' | 'players'>, queue: SeqItem[], f: TypeFilter): SeqItem[] {
  if (!isFiltered(f)) return queue
  const sideOf = (j: number) => ms.actions[j].side ?? (ms.actions[j].pl !== undefined ? ms.players[ms.actions[j].pl!]?.side : undefined)
  return queue.flatMap((it) => {
    const is = it.is.filter((j) => shown(f, ms.actions[j].k, sideOf(j)))
    if (!is.length) return []
    if (is.length === it.is.length) return [it]
    const k = is.map((j) => ms.actions[j].k).sort((a, b) => kindRank(a) - kindRank(b))[0]
    return [{ ...it, is, k }]
  })
}

// ---------- Moments d'une vidéo ----------

const LABELS = (Object.entries(KIND_LABEL) as [ActionKind, string][]).filter(([k]) => k !== 'autre').sort((a, b) => b[1].length - a[1].length)
/**
 * Type d'un moment d'après sa note, écrite d'après la feuille : « But 7m 3-2 · feuille » (moment généré) ou « But 3-2 ·
 * n° 7 (Équipe) » (moments d'une vidéo d'événement, matchSheet.ts sheetMoments) → libellé du type puis le score. Moment
 * ajouté à la main ou autre ligne : autre. Volley (pas de feuille) : geste et résultat en tête de la note (« Attaque
 * réussie · n° 7 », src/volleyActions.ts).
 */
export function momentKind(m: Pick<VideoMoment, 'note'>): PillKind {
  if (currentSport().sport === 'volley') return volleyMomentKind(m.note)
  const note = m.note ?? ''
  return LABELS.find(([, l]) => note.startsWith(`${l} `) && /^\d+-\d+(\s·|$)/.test(note.slice(l.length + 1)))?.[0] ?? 'autre'
}

/** Indices des moments montrés (liste triée par début, comme momentsOf). */
export const visibleMoments = (ms: VideoMoment[], f: TypeFilter) => ms.flatMap((m, i) => (shown({ ...f, sides: [] }, momentKind(m)) ? [i] : []))

/** Moment visé par ⏮ (−1) / ⏭ (1) parmi les montrés (indice dans ms), comme videos.ts stepMoment sur la sélection. */
export function stepVisible(ms: VideoMoment[], vis: number[], dir: -1 | 1, t: number | undefined, cur?: number): number | undefined {
  const sub = vis.map((i) => ms[i])
  const c = cur !== undefined ? vis.indexOf(cur) : -1
  const j = stepMoment(sub, dir, t, c >= 0 ? c : undefined)
  return j === undefined ? undefined : vis[j]
}

/** Moment montré suivant (enchaînement « Voir les actions ») ; undefined à la fin. */
export const nextVisible = (vis: number[], i: number) => vis.find((j) => j > i)
export const prevVisible = (vis: number[], i: number) => [...vis].reverse().find((j) => j < i)

/** Moment montré en cours au temps t (indice dans ms). */
export function visibleAt(ms: VideoMoment[], vis: number[], t: number | undefined) {
  const j = momentAt(
    vis.map((i) => ms[i]),
    t,
  )
  return j === undefined ? undefined : vis[j]
}

/** « But 2-2 · 3/12 buts » : moment en cours et sa place dans la sélection. */
export function positionIn(ms: VideoMoment[], vis: number[], i: number, f: TypeFilter) {
  const present = presentCats(ms.map(momentKind)).map((c) => c.cat.id)
  const k = vis.indexOf(i)
  return `${ms[i].note || fmtMoment(ms[i].at)} · ${countLabel(k < 0 ? 0 : k + 1, vis.length, f, present)}`
}
