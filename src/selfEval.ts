/*
 * Auto-évaluation du jeune après un événement (idée reprise de « Génération Bleue », vague 2, 04/11 ;
 * supabase/064_auto_evaluation.sql) : « Comment ça s'est passé ? ».
 *  - Après un événement où il était sur la liste (match, tournoi, entraînement / stage ; jamais une « observation » : un
 *    jeune observé ne le sait pas forcément), le jeune remplit, s'il veut, une courte auto-évaluation : 5 critères simples,
 *    les mêmes pour tous et pour les deux sports (engagement, plaisir, concentration, jeu avec l'équipe, progrès), notés de
 *    1 à 5 avec des mots positifs ou neutres (« Un peu » → « À fond »), plus deux champs courts « Ce que j'ai bien réussi »
 *    et « Ce que je veux travailler ».
 *  - Une seule par événement, modifiable du jour de l'événement jusqu'à 14 jours après (puis lecture seule). Tout vider :
 *    elle est retirée.
 *  - Le staff la lit sur la fiche (onglet Avis), sous « Son regard », à part des avis des observateurs : ce n'est PAS un
 *    avis. Elle n'entre jamais dans les moyennes, radars, classements ni exports d'avis (elle n'est pas dans la table des
 *    avis, ni sur l'appareil du staff : lue à la demande, en ligne). Les notes s'affichent en mots, jamais en moyenne.
 *  - Clavier seulement : rien de ce que le jeune écrit ne part vers une IA.
 * Mêmes règles que le serveur (hb_player_selfeval_save) ; en mode essai (sans serveur), tout se fait sur l'appareil.
 * Fichier pur (ni Dexie ni React) : testé par tools/test-auto-evaluation.ts.
 */

/** Critères de l'auto-évaluation (mêmes clés que supabase/064 : hb_se_keys). */
export const SELF_EVAL_CRITERIA = [
  { key: 'engagement', label: 'Mon engagement' },
  { key: 'plaisir', label: 'Mon plaisir de jouer' },
  { key: 'concentration', label: 'Ma concentration' },
  { key: 'collectif', label: 'Mon jeu avec l’équipe' },
  { key: 'progres', label: 'Mes progrès' },
] as const
export type SelfEvalKey = (typeof SELF_EVAL_CRITERIA)[number]['key']

/** Niveaux 1 à 5 : des mots positifs ou neutres, jamais un jugement (pas de « nul », « raté », « mauvais »). */
export const SELF_EVAL_LEVELS = ['Un peu', 'Assez', 'Bien', 'Très bien', 'À fond'] as const
export const levelWord = (n: number) => SELF_EVAL_LEVELS[Math.round(n) - 1] ?? ''

/** Jours pendant lesquels l'auto-évaluation se remplit et se modifie, après le jour de l'événement (supabase/064). */
export const SELF_EVAL_DAYS = 14
/** Longueur de chacun des deux champs libres. */
export const SELF_EVAL_TEXT_MAX = 300
/** Types d'événements concernés (une « observation » : jamais). */
export const SELF_EVAL_TYPES = ['match', 'tournoi', 'entrainement'] as const
/** Jours passés pendant lesquels un événement reste listé sur sa page (au-delà : seulement s'il a une auto-évaluation). */
export const SELF_EVAL_LIST_DAYS = 60

export interface SelfEval {
  eventId: string
  eventType: string
  /** Jour de l'événement (AAAA-MM-JJ). */
  eventDate: string
  /** Nom de l'événement au moment de l'enregistrement (l'événement peut changer de nom ou disparaître ensuite). */
  eventName?: string
  scores: Partial<Record<SelfEvalKey, number>>
  /** « Ce que j'ai bien réussi ». */
  good?: string
  /** « Ce que je veux travailler ». */
  work?: string
  /** Dernier enregistrement (ISO). */
  at: string
}

/** Un événement tel que la page du jeune le reçoit (serveur : hb_player_selfeval_events ; essai : calculé ici). */
export interface SelfEvalEvent {
  eventId: string
  type: string
  name: string
  date: string
  place?: string
  /** Dernier jour où l'on peut remplir ou modifier. */
  until: string
  /** Remplissable / modifiable aujourd'hui (sur la liste, événement présent, dans les 14 jours). */
  open: boolean
  mine: SelfEval | null
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Jour décalé de n jours (AAAA-MM-JJ, calcul en UTC). */
export function addDays(day: string, n: number): string {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86400000
  return new Date(t).toISOString().slice(0, 10)
}

/** Dernier jour pour remplir ou modifier l'auto-évaluation d'un événement de ce jour. */
export const selfEvalUntil = (eventDate: string) => addDays(eventDate, SELF_EVAL_DAYS)

/** Fenêtre ouverte aujourd'hui : du jour de l'événement (compris) à 14 jours après (compris). */
export function selfEvalWindowOpen(eventDate: string, day: string): boolean {
  if (!DAY.test(eventDate)) return false
  return eventDate <= day && day <= selfEvalUntil(eventDate)
}

type EventLike = { id: string; name: string; type: string; date: string; place?: string; deleted?: boolean; playerIds?: string[] }

/** L'événement compte-t-il pour ce joueur (type concerné, pas supprimé, sur la liste) ? */
export const selfEvalConcerns = (e: EventLike, playerId: string) =>
  !e.deleted && (SELF_EVAL_TYPES as readonly string[]).includes(e.type) && (e.playerIds ?? []).includes(playerId) && DAY.test(e.date)

/**
 * Ce que la page du jeune montre (même règle que hb_player_selfeval_events) : les événements qui le concernent, déjà
 * commencés, des 60 derniers jours, plus ceux qu'il a déjà évalués (même plus anciens, ou dont il n'est plus sur la liste,
 * ou supprimés : lecture seule) ; le plus récent en premier, 30 au plus.
 */
export function selfEvalEvents(events: readonly EventLike[], playerId: string, mine: readonly SelfEval[], day: string): SelfEvalEvent[] {
  const from = addDays(day, -SELF_EVAL_LIST_DAYS)
  const byEvent = new Map(mine.map((s) => [s.eventId, s]))
  const out = new Map<string, SelfEvalEvent>()
  for (const e of events) {
    const concerns = selfEvalConcerns(e, playerId)
    const own = byEvent.get(e.id) ?? null
    if (!concerns && !own) continue
    if (concerns && !own && (e.date > day || e.date < from)) continue
    if (!concerns && own && e.date > day) continue
    out.set(e.id, {
      eventId: e.id,
      type: e.type,
      name: e.name,
      date: e.date,
      ...(e.place ? { place: e.place } : {}),
      until: selfEvalUntil(e.date),
      open: concerns && selfEvalWindowOpen(e.date, day),
      mine: own,
    })
  }
  // Évaluations d'événements absents (supprimés pour de bon, ou hors de l'appareil) : gardées, en lecture seule.
  for (const s of mine)
    if (!out.has(s.eventId))
      out.set(s.eventId, { eventId: s.eventId, type: s.eventType, name: s.eventName ?? 'Événement', date: s.eventDate, until: selfEvalUntil(s.eventDate), open: false, mine: s })
  return [...out.values()].sort((a, b) => b.date.localeCompare(a.date) || a.eventId.localeCompare(b.eventId)).slice(0, 30)
}

/** À remplir maintenant (fenêtre ouverte, pas encore fait). */
export const toFill = (list: readonly SelfEvalEvent[]) => list.filter((e) => e.open && !e.mine)

/** Texte libre : caractères de contrôle retirés (retours à la ligne gardés), bords coupés, 300 caractères. */
export function cleanSelfEvalText(s: unknown): string {
  if (typeof s !== 'string') return ''
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, SELF_EVAL_TEXT_MAX)
    .trimEnd()
}

/** Notes gardées : clés connues, entiers de 1 à 5 ; le reste est ignoré. */
export function cleanScores(scores: unknown): Partial<Record<SelfEvalKey, number>> {
  const out: Partial<Record<SelfEvalKey, number>> = {}
  if (!scores || typeof scores !== 'object') return out
  for (const { key } of SELF_EVAL_CRITERIA) {
    const v = (scores as Record<string, unknown>)[key]
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5) out[key] = v
  }
  return out
}

export interface SelfEvalInput {
  scores: Partial<Record<string, number>>
  good: string
  work: string
}

/** Ce qui sera enregistré ; null : tout est vide (l'auto-évaluation est retirée). */
export function cleanSelfEval(input: SelfEvalInput): Pick<SelfEval, 'scores' | 'good' | 'work'> | null {
  const scores = cleanScores(input.scores)
  const good = cleanSelfEvalText(input.good)
  const work = cleanSelfEvalText(input.work)
  if (!Object.keys(scores).length && !good && !work) return null
  return { scores, ...(good ? { good } : {}), ...(work ? { work } : {}) }
}

export type SelfEvalError = 'evenement_inconnu' | 'pas_encore' | 'fenetre_fermee' | 'trop_long' | 'pas_joueur' | 'sans_fiche'

export const SELF_EVAL_ERRORS: Record<SelfEvalError, string> = {
  evenement_inconnu: 'Cet événement n’est pas sur ta page.',
  pas_encore: 'L’événement n’a pas encore eu lieu : reviens après.',
  fenetre_fermee: `On peut la remplir jusqu’à ${SELF_EVAL_DAYS} jours après l’événement : c’est passé pour celui-ci.`,
  trop_long: 'C’est un peu long : raccourcis un peu.',
  pas_joueur: 'Réservé à ton compte joueur.',
  sans_fiche: 'Ta fiche n’est pas encore reliée : demande à ton encadrant.',
}

/** Erreur du serveur → phrase pour le jeune. */
export function selfEvalErrorText(message?: string, code?: string): string {
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42P01') return 'Pas encore ouvert sur ce serveur : demande à ton encadrant.'
  const k = Object.keys(SELF_EVAL_ERRORS).find((x) => message?.includes(x)) as SelfEvalError | undefined
  return k ? SELF_EVAL_ERRORS[k] : `Enregistrement impossible${message ? ` : ${message}` : ''}.`
}

/** Le serveur n'a pas (encore) le script 064 : la section ne s'affiche pas. */
export const selfEvalMissing = (code?: string) => code === 'PGRST202' || code === 'PGRST205' || code === '42P01'

/**
 * Enregistrement sur l'appareil (mode essai), même règle que le serveur. `events` : l'événement tel que l'appareil le
 * connaît (absent : inconnu). Renvoie la liste à garder.
 */
export function saveSelfEvalLocal(
  mine: readonly SelfEval[],
  event: EventLike | undefined,
  playerId: string,
  input: SelfEvalInput,
  day: string,
  at: string,
): { ok: true; list: SelfEval[]; saved: SelfEval | null } | { ok: false; error: SelfEvalError } {
  if (!event || !selfEvalConcerns(event, playerId)) return { ok: false, error: 'evenement_inconnu' }
  if (event.date > day) return { ok: false, error: 'pas_encore' }
  if (!selfEvalWindowOpen(event.date, day)) return { ok: false, error: 'fenetre_fermee' }
  const clean = cleanSelfEval(input)
  const rest = mine.filter((s) => s.eventId !== event.id)
  if (!clean) return { ok: true, list: rest, saved: null }
  const saved: SelfEval = { eventId: event.id, eventType: event.type, eventDate: event.date, eventName: event.name, ...clean, at }
  return { ok: true, list: [saved, ...rest].sort((a, b) => b.eventDate.localeCompare(a.eventDate)), saved }
}

/** Notes en mots, pour la fiche du staff et la page du jeune (« Mon engagement : Très bien ») ; jamais de moyenne. */
export function selfEvalChips(s: Pick<SelfEval, 'scores'>): { key: SelfEvalKey; label: string; word: string; n: number }[] {
  return SELF_EVAL_CRITERIA.filter((c) => typeof s.scores[c.key] === 'number').map((c) => ({ key: c.key, label: c.label, word: levelWord(s.scores[c.key]!), n: s.scores[c.key]! }))
}

/**
 * Avis d'un événement et regard du jeune, côte à côte mais SÉPARÉS : les avis du staff restent tels quels (ce sont eux, et
 * eux seuls, qui font les chiffres), l'auto-évaluation à part.
 */
export function avisAndSelf<E extends { eventId?: string }>(evaluations: readonly E[], selfEvals: readonly SelfEval[], eventId: string): { staff: E[]; self: SelfEval | null } {
  return { staff: evaluations.filter((e) => e.eventId === eventId), self: selfEvals.find((s) => s.eventId === eventId) ?? null }
}

/** Rangée du serveur (hb_player_selfeval, ou réponse des fonctions) → l'appli. */
export function selfEvalFromRow(r: Record<string, unknown>): SelfEval | null {
  const eventId = (r.event_id ?? r.eventId) as unknown
  const eventDate = String(r.event_date ?? r.eventDate ?? '').slice(0, 10)
  if (typeof eventId !== 'string' || !DAY.test(eventDate)) return null
  const good = cleanSelfEvalText(r.good)
  const work = cleanSelfEvalText(r.work)
  const name = (r.event_name ?? r.eventName) as unknown
  const at = (r.updated_at ?? r.at) as unknown
  return {
    eventId,
    eventType: String(r.event_type ?? r.eventType ?? ''),
    eventDate,
    ...(typeof name === 'string' && name ? { eventName: name } : {}),
    scores: cleanScores(r.scores),
    ...(good ? { good } : {}),
    ...(work ? { work } : {}),
    at: typeof at === 'string' ? new Date(at).toISOString() : new Date(0).toISOString(),
  }
}

/** Libellé du type d'événement pour le jeune. */
export const selfEvalTypeLabel = (t: string) => (t === 'match' ? 'Match' : t === 'tournoi' ? 'Tournoi' : t === 'entrainement' ? 'Stage / entraînement' : 'Événement')
