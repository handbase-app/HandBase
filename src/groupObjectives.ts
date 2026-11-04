import { accord, pluralG, w, type Gender } from './gender'
import {
  activeObjectives,
  cleanObjectiveText,
  cleanShortText,
  cleanVideoUrl,
  DAY,
  finalizeObjectives,
  OBJ_MAX_ACTIVE,
  OBJ_STEP_TEXT_MAX,
  OBJ_STEPS_MAX,
  objectivesOf,
  type ObjectiveSource,
  type WorkObjective,
} from './objectives'

/*
 * Objectifs de travail DONNÉS À TOUT UN GROUPE (04/11 : « le groupe Pôle, avant de revenir de vacances, doit aller courir
 * 20 minutes par jour »). Depuis la page d'un groupe ou d'un événement (⋮ du titre → « Donner un objectif au groupe ») :
 *  - une COPIE de l'objectif est écrite dans la fiche de chaque joueur choisi (clé `objectives`, src/objectives.ts), comme un
 *    objectif du staff ordinaire : identifiants propres à chaque copie (objectif et étapes), pour que chaque jeune coche SES
 *    étapes (supabase/065 : ses coches visent les identifiants d'étapes de sa fiche) ; la source (« groupe Pôle », ou
 *    l'événement, relié d'office) et le lot de l'envoi sont gardés sur la copie ;
 *  - seulement les fiches que l'utilisateur peut modifier (même règle que la carte de la fiche) ; un joueur qui a déjà 3
 *    objectifs en cours est passé (rien n'est écrasé), comme celui qui a déjà cet objectif de ce même groupe en cours ;
 *  - « Objectifs donnés » (page du groupe ou de l'événement) : les envois retrouvés par leur source, l'avancement du groupe
 *    (atteints, étapes cochées) et « Retirer à tous » (les fiches modifiables seulement ; rien d'autre n'est touché).
 * Modifier le texte pour tous n'est pas proposé : chaque copie a ses propres étapes et ses coches ; on retire et on redonne.
 * Aucun script SQL : tout passe par la fiche, déjà synchronisée. Rien ne part vers une IA (clavier seulement).
 * Fichier pur (ni Dexie ni React) : testé par tools/test-objectifs-groupe.ts.
 */

/** Ce qu'on tape dans la fenêtre « Donner un objectif au groupe ». */
export interface GiftInput {
  text: string
  video?: string
  steps: { text: string; video?: string }[]
  /** « À faire avant le … » (AAAA-MM-JJ), facultatif. */
  due?: string
}

/** Objectif à donner, nettoyé (ce qui sera recopié dans chaque fiche). */
export interface Gift {
  text: string
  video?: string
  steps: { text: string; video?: string }[]
  due?: string
}

export type GiftError = 'vide' | 'lien' | 'etapes' | 'personne'
export const GIFT_ERRORS: Record<GiftError, string> = {
  vide: 'Écris l’objectif en quelques mots.',
  lien: 'Un lien n’est pas une adresse web : il doit commencer par http:// ou https://. Corrige-le ou efface-le.',
  etapes: `${OBJ_STEPS_MAX} étapes au plus par objectif.`,
  personne: 'Coche au moins un joueur à qui le donner.',
}

/** Contrôle de la saisie : titre obligatoire, liens http(s) seulement, 8 étapes au plus (étapes vides retirées). */
export function checkGift(input: GiftInput): { ok: true; gift: Gift } | { ok: false; error: GiftError } {
  const text = cleanObjectiveText(input.text)
  if (!text) return { ok: false, error: 'vide' }
  const bad = (v?: string) => !!v?.trim() && !cleanVideoUrl(v)
  const filled = input.steps
    .map((s) => ({ text: cleanShortText(s.text, OBJ_STEP_TEXT_MAX), video: s.video }))
    .filter((s) => s.text)
  if (bad(input.video) || filled.some((s) => bad(s.video))) return { ok: false, error: 'lien' }
  if (filled.length > OBJ_STEPS_MAX) return { ok: false, error: 'etapes' }
  const video = cleanVideoUrl(input.video)
  return {
    ok: true,
    gift: {
      text,
      ...(video ? { video } : {}),
      steps: filled.map((s) => {
        const v = cleanVideoUrl(s.video)
        return { text: s.text, ...(v ? { video: v } : {}) }
      }),
      ...(input.due && DAY.test(input.due) ? { due: input.due } : {}),
    },
  }
}

/** Fiche visée (un joueur) : son identifiant et ses objectifs. */
export interface GiftTarget {
  id: string
  objectives?: unknown
}

/** Pourquoi un joueur est passé : fiche pas modifiable par l'utilisateur, déjà 3 en cours, ou déjà cet objectif de là. */
export type SkipReason = 'droits' | 'max' | 'deja'

/** « pas modifiable par toi », « déjà 3 objectifs en cours », « déjà donné, en cours ». Neutre : rien n'est reproché au jeune. */
export const SKIP_LABEL: Record<SkipReason, string> = {
  droits: 'pas modifiable par toi',
  max: `déjà ${OBJ_MAX_ACTIVE} objectifs en cours`,
  deja: 'déjà donné, en cours',
}

/** Groupe ou événement d'où l'on donne (sans le lot : posé à l'envoi). */
export type GiftFrom = Omit<ObjectiveSource, 'batch' | 'at'>

/** Ce joueur recevra-t-il l'objectif ? (ok, ou la raison pour laquelle il est passé.) */
export function giftStatus<P extends GiftTarget>(p: P, gift: Pick<Gift, 'text'>, from: GiftFrom, canEdit: (p: P) => boolean): 'ok' | SkipReason {
  if (!canEdit(p)) return 'droits'
  const list = activeObjectives(objectivesOf(p))
  const text = cleanObjectiveText(gift.text).toLowerCase()
  if (list.some((o) => o.source?.kind === from.kind && o.source.id === from.id && o.text.toLowerCase() === text)) return 'deja'
  if (list.length >= OBJ_MAX_ACTIVE) return 'max'
  return 'ok'
}

/** Copie de l'objectif pour une fiche : nouveaux identifiants (objectif et étapes), rien de coché, la source et le lot. */
export function copyGift(gift: Gift, source: ObjectiveSource, newId: () => string, event?: { id: string; name: string; date?: string }): WorkObjective {
  return {
    id: newId(),
    text: gift.text,
    status: 'en_cours',
    // Donné depuis un événement : relié d'office (son nom et sa date, comme « D'où vient-il ? » sur la fiche).
    ...(event ? { eventId: event.id, eventName: event.name.trim().slice(0, 120), ...(event.date && DAY.test(event.date) ? { date: event.date } : {}) } : {}),
    ...(gift.video ? { video: gift.video } : {}),
    ...(gift.steps.length ? { steps: gift.steps.map((s) => ({ id: newId(), text: s.text, ...(s.video ? { video: s.video } : {}) })) } : {}),
    ...(gift.due ? { due: gift.due } : {}),
    source,
  }
}

export interface GiveResult<P> {
  /** Fiches à écrire (objectif ajouté à la fin de leurs objectifs). */
  rows: P[]
  /** Joueurs qui l'ont reçu. */
  given: string[]
  /** Joueurs passés, et pourquoi. */
  skipped: { id: string; why: SkipReason }[]
}

/**
 * Donner l'objectif à plusieurs joueurs (ceux cochés dans la fenêtre) : une copie par fiche modifiable qui a de la place ;
 * les autres sont passés sans rien écraser. Le lot (`batch`) réunit les copies de cet envoi.
 */
export function giveToMany<P extends GiftTarget>(
  players: readonly P[],
  gift: Gift,
  from: GiftFrom,
  opts: { canEdit: (p: P) => boolean; newId: () => string; batch: string; day: string; event?: { id: string; name: string; date?: string } },
): GiveResult<P> {
  const source: ObjectiveSource = { ...from, name: cleanShortText(from.name, 120) || (from.kind === 'groupe' ? 'Groupe' : 'Événement'), batch: opts.batch, at: opts.day }
  const out: GiveResult<P> = { rows: [], given: [], skipped: [] }
  const seen = new Set<string>()
  for (const p of players) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    const why = giftStatus(p, gift, from, opts.canEdit)
    if (why !== 'ok') {
      out.skipped.push({ id: p.id, why })
      continue
    }
    // 12 gardés au plus sur la fiche (les atteints les plus anciens tombent, comme sur la carte).
    out.rows.push({ ...p, objectives: finalizeObjectives([...objectivesOf(p), copyGift(gift, source, opts.newId, opts.event)]) })
    out.given.push(p.id)
  }
  return out
}

/** « Objectif donné à 14 joueurs ; 2 passés (déjà 3 objectifs en cours) ; 1 passé (pas modifiable par toi). » */
export function giftSummary(r: { given: readonly string[]; skipped: readonly { why: SkipReason }[] }, g?: Gender): string {
  const parts = [r.given.length ? `Objectif donné à ${pluralG(r.given.length, g)}` : `Objectif donné à ${w(g).aucunJoueur}`]
  for (const why of ['max', 'deja', 'droits'] as SkipReason[]) {
    const n = r.skipped.filter((s) => s.why === why).length
    if (n) parts.push(`${n} ${accord('passé', g, n)} (${SKIP_LABEL[why]})`)
  }
  return parts.join(' ; ') + '.'
}

// ---------- « Objectifs donnés » ----------

/** Un envoi retrouvé dans les fiches, avec l'avancement du groupe. */
export interface GiftView {
  batch: string
  text: string
  due?: string
  /** Jour de l'envoi. */
  at?: string
  /** Nombre d'étapes de l'objectif. */
  steps: number
  /** Joueurs qui l'ont (sa copie encore sur leur fiche). */
  total: number
  /** Parmi eux, ceux pour qui il est « atteint ✓ ». */
  reached: number
  /** Étapes cochées (par le staff sur la fiche, ou par le jeune), sur toutes les copies. */
  stepsDone: number
  stepsTotal: number
  /** Joueurs qui l'ont, et leur avancement. */
  players: { id: string; objectiveId: string; reached: boolean; done: number; total: number }[]
}

/**
 * Envois faits depuis ce groupe ou cet événement, le plus récent en premier. `checks` : coches du jeune sur les étapes du
 * staff (hb_player_goals, quand elles sont lisibles), par joueur.
 */
export function giftsFrom<P extends GiftTarget>(players: readonly P[], from: Pick<GiftFrom, 'kind' | 'id'>, checks: Record<string, Record<string, string>> = {}): GiftView[] {
  const by = new Map<string, GiftView>()
  for (const p of players) {
    for (const o of objectivesOf(p)) {
      const s = o.source
      if (!s || s.kind !== from.kind || s.id !== from.id) continue
      let v = by.get(s.batch)
      if (!v) {
        v = { batch: s.batch, text: o.text, ...(o.due ? { due: o.due } : {}), ...(s.at ? { at: s.at } : {}), steps: o.steps?.length ?? 0, total: 0, reached: 0, stepsDone: 0, stepsTotal: 0, players: [] }
        by.set(s.batch, v)
      }
      const mine = checks[p.id] ?? {}
      const steps = o.steps ?? []
      const done = steps.filter((x) => x.done || mine[x.id]).length
      const reached = o.status === 'atteint'
      v.total++
      if (reached) v.reached++
      v.stepsDone += done
      v.stepsTotal += steps.length
      v.players.push({ id: p.id, objectiveId: o.id, reached, done, total: steps.length })
    }
  }
  return [...by.values()].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '') || a.text.localeCompare(b.text))
}

/** « 9 joueurs sur 14 l'ont atteint » ; personne encore : « 14 joueurs l'ont reçu ». */
export function reachedLabel(v: Pick<GiftView, 'reached' | 'total'>, g?: Gender): string {
  if (!v.reached) return `${pluralG(v.total, g)} l’${v.total > 1 ? 'ont' : 'a'} reçu`
  return `${v.reached.toLocaleString('fr-FR')} sur ${pluralG(v.total, g)} l’${v.reached > 1 ? 'ont' : 'a'} atteint`
}

/** « 31 étapes cochées sur 42 » ; sans étape : rien. */
export function stepsLabel(v: Pick<GiftView, 'stepsDone' | 'stepsTotal'>): string {
  if (!v.stepsTotal) return ''
  return `${v.stepsDone.toLocaleString('fr-FR')} étape${v.stepsDone > 1 ? 's' : ''} ${v.stepsDone > 1 ? 'cochées' : 'cochée'} sur ${v.stepsTotal.toLocaleString('fr-FR')}`
}

/**
 * « Retirer à tous » : la copie de cet envoi part des fiches modifiables (sans trace, comme un objectif retiré) ; les fiches
 * pas modifiables par l'utilisateur la gardent (`kept`).
 */
export function withdrawGift<P extends GiftTarget>(players: readonly P[], batch: string, canEdit: (p: P) => boolean): { rows: P[]; removed: string[]; kept: string[] } {
  const out = { rows: [] as P[], removed: [] as string[], kept: [] as string[] }
  for (const p of players) {
    const list = objectivesOf(p)
    if (!list.some((o) => o.source?.batch === batch)) continue
    if (!canEdit(p)) {
      out.kept.push(p.id)
      continue
    }
    const next = list.filter((o) => o.source?.batch !== batch)
    // Plus aucun objectif : la clé part de la fiche (comme sur la carte).
    const { objectives: _old, ...rest } = p
    out.rows.push((next.length ? { ...rest, objectives: next } : rest) as P)
    out.removed.push(p.id)
  }
  return out
}

/** Écritures par lots raisonnables (save() en une transaction par lot). */
export function chunks<T>(list: readonly T[], size = 50): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
