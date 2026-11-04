/*
 * Objectifs de travail d'un joueur (idée reprise de « Génération Bleue », vague 2, 04/11) : un encadrant qui peut modifier la
 * fiche fixe 1 à 3 objectifs EN COURS, courts et formulés positivement (« Gagner en vitesse sur le premier pas »), avec, si on
 * veut, l'événement d'où ils viennent (un stage, un tournoi) et une date. État : « en cours » ou « atteint ✓ », jamais
 * « raté » ni « abandonné » : un objectif qui ne sert plus se retire, sans trace.
 *
 * Rangés DANS la fiche (clé `objectives` de hb_players.data) : ils voyagent avec elle (synchronisation, hors ligne, mode
 * essai), s'écrivent comme elle (mêmes droits : périmètre, hb_scope_row ; « la plus récente gagne »), et le jeune les lit sur
 * sa page puisqu'il lit sa fiche (051 : sa ligne, et elle seule). Aucun script SQL pour eux.
 * Le jeune les voit en lecture seule (« Mes objectifs », src/pages/Me.tsx) ; le bilan à imprimer montre ceux en cours.
 *
 * Fichier pur (ni Dexie ni React) : testé par tools/test-objectifs.ts.
 */

export type ObjectiveStatus = 'en_cours' | 'atteint'

export interface WorkObjective {
  id: string
  /** Texte court, positif (120 caractères au plus). */
  text: string
  status: ObjectiveStatus
  /** Événement d'où vient l'objectif (fin de stage, tournoi), facultatif ; son nom est recopié au moment du choix
   *  (le jeune ne lit pas les événements : il voit ce nom-là). */
  eventId?: string
  eventName?: string
  /** Date de l'objectif (AAAA-MM-JJ), facultative. */
  date?: string
  /** Quand il a été atteint (AAAA-MM-JJ). */
  doneAt?: string
}

/** Objectifs en cours en même temps, au plus. */
export const OBJ_MAX_ACTIVE = 3
/** Longueur d'un objectif. */
export const OBJ_TEXT_MAX = 120
/** Objectifs gardés sur la fiche (en cours + atteints) : au-delà, les plus anciens atteints tombent. */
export const OBJ_KEEP = 12

export const OBJ_STATUS_LABEL: Record<ObjectiveStatus, string> = { en_cours: 'En cours', atteint: 'Atteint ✓' }

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Texte d'un objectif : espaces repliés, bords coupés, 120 caractères au plus. */
export const cleanObjectiveText = (s: unknown): string =>
  typeof s === 'string' ? s.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, OBJ_TEXT_MAX) : ''

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
    })
  }
  return out
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

/** « Stage de rentrée · 28/08/2026 », « 28/08/2026 », ou rien. */
export function objectiveOrigin(o: Pick<WorkObjective, 'eventName' | 'date'>, fmt: (d: string) => string): string {
  return [o.eventName, o.date && fmt(o.date)].filter(Boolean).join(' · ')
}

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
