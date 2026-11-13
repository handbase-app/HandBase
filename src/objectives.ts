/*
 * Objectifs de travail d'un joueur (idée reprise de « Génération Bleue », vague 2, 04/11) : un encadrant qui peut modifier la
 * fiche fixe 1 à 3 objectifs EN COURS, courts et formulés positivement (« Gagner en vitesse sur le premier pas »), avec, si on
 * veut, l'événement d'où ils viennent (un stage, un tournoi) et une date. État : « en cours » ou « atteint ✓ », jamais
 * « raté » ni « abandonné » : un objectif qui ne sert plus se retire, sans trace.
 *
 * Rangés DANS la fiche (clé `objectives` de hb_players.data) : ils voyagent avec elle (synchronisation, hors ligne, mode
 * essai), s'écrivent comme elle (mêmes droits : périmètre, hb_scope_row ; « la plus récente gagne »), et le jeune les lit sur
 * sa page puisqu'il lit sa fiche (051 : sa ligne, et elle seule). Aucun script SQL pour eux.
 * Le bilan à imprimer montre ceux en cours, avec leurs étapes et l'avancement.
 *
 * ÉTAPES (04/11, « liste à cocher ») : chaque objectif peut avoir jusqu'à 8 étapes courtes (« Corde à sauter 10 min par
 * jour »), chacune avec sa case et, si on veut, un lien vidéo (le modèle à imiter, la démonstration de l'exercice) ; l'objectif
 * aussi peut avoir son lien. Une étape se coche une fois (date gardée), pas de suivi jour par jour. Les étapes des objectifs
 * du staff sont dans la fiche (comme l'objectif) ; le staff les coche sur la fiche (`done`), le jeune les coche depuis sa page
 * par sa propre fonction (supabase/065_objectifs_etapes.sql, src/myGoals.ts) : il ne touche jamais au texte du staff.
 * Liens : http(s) seulement, 500 caractères au plus ; jamais intégrés (rien ne se charge à l'affichage : on ouvre le lien).
 * Objectifs déjà enregistrés sans étapes : inchangés (`steps` absent).
 *
 * DONNÉS À TOUT UN GROUPE (04/11, src/groupObjectives.ts) : depuis la page d'un groupe ou d'un événement, une COPIE de
 * l'objectif est écrite dans la fiche de chaque joueur (identifiants propres à chaque copie : chaque jeune coche ses étapes),
 * avec sa source (`source` : groupe ou événement, son nom recopié, le lot qui réunit les copies d'un même envoi) et, si on
 * veut, une fin (`due`). Pour le reste, un objectif du staff ordinaire.
 *
 * PÉRIODE (04/11, src/period.ts) : début (`date`, ou `from` repoussé : « à partir du 05/07 ») et fin facultative (`due`),
 * saisis en un toucher (« 1 semaine », « Jusqu'à la rentrée »…) ; « Jusqu'au 31/08 · encore 12 jours », « Commence le … »,
 * « Période terminée » (neutre : l'objectif reste, le staff le passe « atteint » ou le prolonge).
 *
 * Fichier pur (ni Dexie ni React) : testé par tools/test-objectifs.ts et tools/test-objectifs-etapes.ts.
 */

import { cleanPeriod, periodRange, shortDay } from './period'

export type ObjectiveStatus = 'en_cours' | 'atteint'

/** D'où vient un objectif donné à plusieurs (src/groupObjectives.ts) : le groupe ou l'événement, et l'envoi (lot). */
export interface ObjectiveSource {
  kind: 'groupe' | 'evenement'
  /** Identifiant du groupe ou de l'événement. */
  id: string
  /** Son nom au moment de l'envoi (le jeune ne lit ni les groupes ni les événements : il voit ce nom-là). */
  name: string
  /** Même valeur pour toutes les copies d'un même envoi (« Objectifs donnés », « Retirer à tous »). */
  batch: string
  /** Jour de l'envoi (AAAA-MM-JJ). */
  at?: string
}

/** Une étape d'un objectif : une ligne courte, une case cochée une fois, un lien vidéo facultatif. */
export interface ObjectiveStep {
  id: string
  /** Texte court (100 caractères au plus). */
  text: string
  /** Lien vidéo (http ou https), facultatif. */
  video?: string
  /** Cochée le (AAAA-MM-JJ) : par le staff pour ses objectifs, par le jeune pour les siens. */
  done?: string
}

export interface WorkObjective {
  id: string
  /** Texte court, positif (120 caractères au plus). */
  text: string
  status: ObjectiveStatus
  /** Événement d'où vient l'objectif (fin de stage, tournoi), facultatif ; son nom est recopié au moment du choix
   *  (le jeune ne lit pas les événements : il voit ce nom-là). */
  eventId?: string
  eventName?: string
  /** Date de l'objectif (AAAA-MM-JJ), facultative : le jour où il a été fixé (début de sa période, src/period.ts). */
  date?: string
  /** Début repoussé (« à partir du 05/07 », les vacances), facultatif ; sans lui, la période commence à `date`. */
  from?: string
  /** Quand il a été atteint (AAAA-MM-JJ). */
  doneAt?: string
  /** Lien vidéo de l'objectif (http ou https), facultatif. */
  video?: string
  /** Étapes (8 au plus) ; absentes sur les objectifs enregistrés avant les étapes. */
  steps?: ObjectiveStep[]
  /** Fin de la période (AAAA-MM-JJ, comprise), facultative : « Jusqu'au 31/08 » (src/period.ts). */
  due?: string
  /** Donné à tout un groupe ou à la liste d'un événement (copie dans chaque fiche). */
  source?: ObjectiveSource
}

/** Objectifs en cours en même temps, au plus. */
export const OBJ_MAX_ACTIVE = 3
/** Longueur d'un objectif. */
export const OBJ_TEXT_MAX = 120
/** Objectifs gardés sur la fiche (en cours + atteints) : au-delà, les plus anciens atteints tombent. */
export const OBJ_KEEP = 12
/** Étapes par objectif, au plus. */
export const OBJ_STEPS_MAX = 8
/** Longueur d'une étape. */
export const OBJ_STEP_TEXT_MAX = 100
/** Longueur d'un lien vidéo. */
export const OBJ_URL_MAX = 500

export const OBJ_STATUS_LABEL: Record<ObjectiveStatus, string> = { en_cours: 'En cours', atteint: 'Atteint ✓' }

export const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Texte court : espaces et caractères de contrôle repliés, bords coupés, `max` caractères au plus (re-coupé après). */
export const cleanShortText = (s: unknown, max: number): string =>
  typeof s === 'string' ? s.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max).trim() : ''

/** Texte d'un objectif : espaces repliés, bords coupés, 120 caractères au plus. */
export const cleanObjectiveText = (s: unknown): string => cleanShortText(s, OBJ_TEXT_MAX)

/**
 * Lien vidéo gardé : http ou https seulement (ni javascript:, ni data:, ni fichier), sans espace ni guillemet, 500 caractères
 * au plus ; sinon undefined. Même règle que le serveur (065, hb_go_url).
 */
export function cleanVideoUrl(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined
  const v = s.trim()
  if (!v || v.length > OBJ_URL_MAX || !/^https?:\/\/[^\s<>"'\\/][^\s<>"'\\]*$/i.test(v)) return undefined
  try {
    const u = new URL(v)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? v : undefined
  } catch {
    return undefined
  }
}

/** Un lien tapé est-il refusé ? (vide : non, rien à refuser.) */
export const badVideoUrl = (s: string | undefined) => !!s?.trim() && !cleanVideoUrl(s)

/** Étapes lues ou écrites : formes inconnues et textes vides écartés, identifiants en double écartés, 8 au plus. */
export function stepsOf(raw: unknown): ObjectiveStep[] {
  if (!Array.isArray(raw)) return []
  const out: ObjectiveStep[] = []
  const seen = new Set<string>()
  for (const s of raw) {
    if (out.length >= OBJ_STEPS_MAX) break
    if (!s || typeof s !== 'object') continue
    const x = s as Record<string, unknown>
    const text = cleanShortText(x.text, OBJ_STEP_TEXT_MAX)
    if (typeof x.id !== 'string' || !ID.test(x.id) || !text || seen.has(x.id)) continue
    seen.add(x.id)
    const video = cleanVideoUrl(x.video)
    out.push({ id: x.id, text, ...(video ? { video } : {}), ...(typeof x.done === 'string' && DAY.test(x.done) ? { done: x.done } : {}) })
  }
  return out
}

/** Identifiant d'un objectif ou d'une étape (celui de newId, ou « demo-… ») : court, sans caractère spécial. */
const ID = /^[A-Za-z0-9_-]{1,40}$/

/** Liste lue sur la fiche : formes inconnues écartées (fiche ancienne, valeur abîmée), jamais d'erreur. */
export function objectivesOf(p: { objectives?: unknown } | null | undefined): WorkObjective[] {
  const raw = p?.objectives
  if (!Array.isArray(raw)) return []
  const out: WorkObjective[] = []
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue
    const x = o as Record<string, unknown>
    const text = cleanObjectiveText(x.text)
    if (typeof x.id !== 'string' || !x.id || !text) continue
    out.push({
      id: x.id,
      text,
      status: x.status === 'atteint' ? 'atteint' : 'en_cours',
      ...(typeof x.eventId === 'string' && x.eventId ? { eventId: x.eventId } : {}),
      ...(typeof x.eventName === 'string' && x.eventName.trim() ? { eventName: x.eventName.trim().slice(0, 120) } : {}),
      ...(typeof x.date === 'string' && DAY.test(x.date) ? { date: x.date } : {}),
      ...(typeof x.doneAt === 'string' && DAY.test(x.doneAt) ? { doneAt: x.doneAt } : {}),
      ...withVideoAndSteps(x),
      ...cleanPeriod(x),
      ...withSource(x.source),
    })
  }
  return out
}

/** Source lue (objectif donné à un groupe) : forme complète seulement, sinon rien (l'objectif reste un objectif ordinaire). */
function withSource(raw: unknown): Pick<WorkObjective, 'source'> {
  if (!raw || typeof raw !== 'object') return {}
  const x = raw as Record<string, unknown>
  const name = cleanShortText(x.name, 120)
  if ((x.kind !== 'groupe' && x.kind !== 'evenement') || typeof x.id !== 'string' || !x.id || typeof x.batch !== 'string' || !ID.test(x.batch) || !name) return {}
  return { source: { kind: x.kind, id: x.id, name, batch: x.batch, ...(typeof x.at === 'string' && DAY.test(x.at) ? { at: x.at } : {}) } }
}

/** Lien et étapes d'un objectif lu (clés absentes quand il n'y en a pas : ancienne forme gardée telle quelle). */
function withVideoAndSteps(x: Record<string, unknown>): Pick<WorkObjective, 'video' | 'steps'> {
  const video = cleanVideoUrl(x.video)
  const steps = stepsOf(x.steps)
  return { ...(video ? { video } : {}), ...(steps.length ? { steps } : {}) }
}

/** En cours, dans l'ordre où ils ont été fixés. */
export const activeObjectives = (list: readonly WorkObjective[]) => list.filter((o) => o.status === 'en_cours')
/** Atteints, le plus récent en premier. */
export const doneObjectives = (list: readonly WorkObjective[]) =>
  list.filter((o) => o.status === 'atteint').sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))

/** Peut-on en ajouter (ou en remettre un « en cours ») ? */
export const canAddObjective = (list: readonly WorkObjective[]) => activeObjectives(list).length < OBJ_MAX_ACTIVE

export type ObjectiveError = 'vide' | 'max'
export type ObjectiveResult = { ok: true; list: WorkObjective[] } | { ok: false; error: ObjectiveError }

export const OBJECTIVE_ERRORS: Record<ObjectiveError, string> = {
  vide: 'Écris l’objectif en quelques mots.',
  max: `${OBJ_MAX_ACTIVE} objectifs en cours au plus : marque-en un « atteint » ou retire-le d’abord.`,
}

/** Garde OBJ_KEEP objectifs au plus : tous ceux en cours, puis les atteints les plus récents. */
function trim(list: WorkObjective[]): WorkObjective[] {
  if (list.length <= OBJ_KEEP) return list
  const keepDone = new Set(doneObjectives(list).slice(0, Math.max(0, OBJ_KEEP - activeObjectives(list).length)).map((o) => o.id))
  return list.filter((o) => o.status === 'en_cours' || keepDone.has(o.id))
}

/**
 * Liste à écrire sur la fiche (fin d'une modification) : formes nettoyées (textes vides retirés, clés vides ôtées), OBJ_KEEP
 * au plus en tout (tous ceux en cours, puis les atteints les plus récents). Le plafond de OBJ_MAX_ACTIVE en cours est tenu
 * par l'écran (« Ajouter » et « remettre en cours » s'arrêtent à 3) et par addObjective / setObjectiveStatus.
 */
export function finalizeObjectives(list: readonly unknown[]): WorkObjective[] {
  return trim(objectivesOf({ objectives: list }))
}

/** Origine et date, nettoyées (date au format AAAA-MM-JJ, sinon rien ; nom d'événement sans identifiant : rien). */
function origin(input: { eventId?: string; eventName?: string; date?: string }): Pick<WorkObjective, 'eventId' | 'eventName' | 'date'> {
  const out: Pick<WorkObjective, 'eventId' | 'eventName' | 'date'> = {}
  if (input.eventId) {
    out.eventId = input.eventId
    if (input.eventName?.trim()) out.eventName = input.eventName.trim().slice(0, 120)
  }
  if (input.date && DAY.test(input.date)) out.date = input.date
  return out
}

/** Nouvel objectif « en cours » (à la fin). */
export function addObjective(
  list: readonly WorkObjective[],
  input: { text: string; eventId?: string; eventName?: string; date?: string },
  id: string,
): ObjectiveResult {
  const text = cleanObjectiveText(input.text)
  if (!text) return { ok: false, error: 'vide' }
  if (!canAddObjective(list)) return { ok: false, error: 'max' }
  const o: WorkObjective = { id, text, status: 'en_cours', ...origin(input) }
  return { ok: true, list: trim([...list, o]) }
}

/** Texte, origine ou date corrigés (l'état ne change pas ici). */
export function editObjective(list: readonly WorkObjective[], id: string, input: { text: string; eventId?: string; eventName?: string; date?: string }): ObjectiveResult {
  // Les étapes et le lien ne changent pas ici (ils passent par la modification de la carte : finalizeObjectives).
  const text = cleanObjectiveText(input.text)
  if (!text) return { ok: false, error: 'vide' }
  return {
    ok: true,
    list: list.map((o) => {
      if (o.id !== id) return o
      const { eventId: _e, eventName: _n, date: _d, ...rest } = o
      return { ...rest, text, ...origin(input) }
    }),
  }
}

/** « Atteint ✓ » (date du jour) ou de nouveau « en cours » (si la place le permet). */
export function setObjectiveStatus(list: readonly WorkObjective[], id: string, status: ObjectiveStatus, day: string): ObjectiveResult {
  const o = list.find((x) => x.id === id)
  if (!o || o.status === status) return { ok: true, list: [...list] }
  if (status === 'en_cours' && !canAddObjective(list)) return { ok: false, error: 'max' }
  return {
    ok: true,
    list: list.map((x) => {
      if (x.id !== id) return x
      if (status === 'atteint') return { ...x, status, doneAt: day }
      const { doneAt: _d, ...rest } = x
      return { ...rest, status }
    }),
  }
}

/** Retirer un objectif (il ne sert plus, faute de frappe) : il disparaît, sans trace sur la fiche. */
export const removeObjective = (list: readonly WorkObjective[], id: string) => list.filter((o) => o.id !== id)

/** Même liste (pour n'écrire la fiche que si quelque chose a changé). */
export const sameObjectives = (a: readonly WorkObjective[], b: readonly WorkObjective[]) => JSON.stringify(a) === JSON.stringify(b)

/**
 * « Stage de rentrée · 28/08/2026 », « 28/08/2026 », ou rien. La période se dit à part (periodLabel, src/period.ts : « Jusqu'au
 * 31/08 · encore 12 jours ») ; au bilan à imprimer, objectivePrintOrigin. Donné depuis un événement : son nom est déjà dans
 * la mention de source (sourceLabel), il n'est pas redit ici.
 */
export function objectiveOrigin(o: Pick<WorkObjective, 'eventName' | 'date' | 'source'>, fmt: (d: string) => string): string {
  const event = o.source?.kind === 'evenement' && o.eventName === o.source.name ? undefined : o.eventName
  return [event, o.date && fmt(o.date)].filter(Boolean).join(' · ')
}

/** Bilan à imprimer : « Stage de rentrée · du 05/07 au 31/08 » (la période remplace la date quand il y en a une). */
export function objectivePrintOrigin(o: Pick<WorkObjective, 'eventName' | 'date' | 'from' | 'due' | 'source'>, day: string, fmt?: (d: string) => string): string {
  const range = periodRange(o, day, fmt)
  if (!range) return objectiveOrigin(o, fmt ?? ((d) => shortDay(d, day)))
  return [objectiveOrigin({ ...o, date: undefined }, (d) => d), range].filter(Boolean).join(' · ')
}

/** Mention discrète d'un objectif donné à plusieurs : « groupe Pôle », « Stage de rentrée » ; sinon rien. */
export const sourceLabel = (o: Pick<WorkObjective, 'source'>) => (!o.source ? '' : o.source.kind === 'groupe' ? `groupe ${o.source.name}` : o.source.name)

/**
 * Événements proposés comme origine d'un objectif : ceux où le joueur était sur la liste, déjà commencés (date du jour ou
 * avant), pas supprimés, des 6 derniers mois, le plus récent en premier (15 au plus).
 */
export function originEvents<E extends { id: string; name: string; date: string; deleted?: boolean; playerIds?: string[] }>(
  events: readonly E[],
  playerId: string,
  day: string,
): E[] {
  const from = shiftDay(day, -183)
  return events
    .filter((e) => !e.deleted && e.date <= day && e.date >= from && (e.playerIds ?? []).includes(playerId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 15)
}

/** Jour décalé de n jours (AAAA-MM-JJ, calcul en UTC : pas d'effet d'heure d'été). */
export function shiftDay(day: string, n: number): string {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

// ---------- Étapes ----------

/** Étapes cochées sur le total : « 1 étape sur 3 ». */
export interface StepProgress {
  done: number
  total: number
}

/** « 1 étape sur 3 », « 3 étapes sur 3 ✓ » ; sans étape : rien. Jamais de mot négatif (« 0 étape sur 3 » reste neutre). */
export function progressLabel(p: StepProgress): string {
  if (!p.total) return ''
  const all = p.done >= p.total
  return `${p.done} étape${p.done > 1 ? 's' : ''} sur ${p.total}${all ? ' ✓' : ''}`
}

/** Étape cochée ou décochée (date du jour) dans une liste d'objectifs (ceux de la fiche, ou ceux du jeune). */
export function setStepDone(list: readonly WorkObjective[], objectiveId: string, stepId: string, done: boolean, day: string): WorkObjective[] {
  return list.map((o) => {
    if (o.id !== objectiveId || !o.steps?.some((s) => s.id === stepId)) return o
    return {
      ...o,
      steps: o.steps.map((s) => {
        if (s.id !== stepId) return s
        if (done) return s.done ? s : { ...s, done: day }
        const { done: _d, ...rest } = s
        return rest
      }),
    }
  })
}

/** Identifiants des étapes des objectifs de la fiche (ceux que le jeune peut cocher). */
export const staffStepIds = (list: readonly WorkObjective[]) => new Set(list.flatMap((o) => (o.steps ?? []).map((s) => s.id)))
