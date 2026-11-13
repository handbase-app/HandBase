import { db, TRIAL, today } from './db'
import {
  saveSelfEvalLocal,
  selfEvalErrorText,
  selfEvalEvents,
  selfEvalFromRow,
  selfEvalMissing,
  selfEvalUntil,
  SELF_EVAL_ERRORS,
  type SelfEval,
  type SelfEvalEvent,
  type SelfEvalInput,
} from './selfEval'
import { supabase } from './sync'

/*
 * Auto-évaluation du jeune (supabase/064_auto_evaluation.sql, src/selfEval.ts) : accès aux données, sans React.
 *  - Avec le serveur : lue À LA DEMANDE et en ligne (pas de synchronisation hors ligne, pas sur l'appareil du staff) ; le
 *    jeune passe par hb_player_selfeval_events / hb_player_selfeval_save ; le staff lit la table hb_player_selfeval (règles du
 *    serveur : périmètre de la fiche). Script pas passé (fonction ou table absente) : `missing`, la section ne s'affiche pas.
 *  - Sans serveur (mode essai / local), et pour les fiches de démonstration (« demo-… », jamais envoyées) : sur l'appareil
 *    (stockage du navigateur), mêmes règles (src/selfEval.ts).
 * Rien de ce qui est écrit ici ne part vers une IA.
 */

export type Res<T> = { ok: true; value: T } | { ok: false; error: string; missing?: boolean }

const KEY_PREFIX = `handbase${TRIAL ? '-essai' : ''}.autoeval.`
const LOCAL_KEY = (playerId: string) => KEY_PREFIX + playerId
/** Sur l'appareil : pas de serveur, ou fiche de démonstration (elle n'existe pas sur le serveur). */
const isLocal = (playerId: string) => !supabase || playerId.startsWith('demo-')

function readLocal(playerId: string): SelfEval[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(playerId))
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? (v.map((r) => selfEvalFromRow(r as Record<string, unknown>)).filter(Boolean) as SelfEval[]) : []
  } catch {
    return []
  }
}
function writeLocal(playerId: string, list: SelfEval[]) {
  try {
    if (list.length) localStorage.setItem(LOCAL_KEY(playerId), JSON.stringify(list))
    else localStorage.removeItem(LOCAL_KEY(playerId))
  } catch {
    /* stockage indisponible : l'essai ne survit pas au rechargement */
  }
}

const offline = (): Res<never> => ({ ok: false, error: 'Il faut être en ligne pour ça : ce n’est pas gardé sur l’appareil.' })
const fail = (e: { message?: string; code?: string }): Res<never> =>
  selfEvalMissing(e.code) ? { ok: false, error: selfEvalErrorText(e.message, e.code), missing: true } : { ok: false, error: selfEvalErrorText(e.message, e.code) }

/** Événements de la page du jeune (son compte : le serveur ; essai et démonstration : l'appareil). */
export async function fetchMyEvents(playerId: string): Promise<Res<SelfEvalEvent[]>> {
  if (isLocal(playerId)) return { ok: true, value: selfEvalEvents(await db.events.toArray(), playerId, readLocal(playerId), today()) }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_player_selfeval_events')
  if (error) return fail(error)
  const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : []
  return {
    ok: true,
    value: list.map((r) => ({
      eventId: String(r.eventId),
      type: String(r.type ?? ''),
      name: String(r.name ?? 'Événement'),
      date: String(r.date ?? ''),
      ...(typeof r.place === 'string' ? { place: r.place } : {}),
      until: typeof r.until === 'string' ? r.until : selfEvalUntil(String(r.date ?? '')),
      open: r.open === true,
      mine: r.mine ? selfEvalFromRow(r.mine as Record<string, unknown>) : null,
    })),
  }
}

/**
 * Aperçu de la page du jeune par le staff (lecture seule) : ses auto-évaluations telles que le staff les lit, rangées avec les
 * événements que l'appareil du staff connaît (même règle que la page du jeune).
 */
export async function fetchPreviewEvents(playerId: string): Promise<Res<SelfEvalEvent[]>> {
  const r = await fetchPlayerSelfEvals(playerId)
  if (!r.ok) return r
  return { ok: true, value: selfEvalEvents(await db.events.toArray(), playerId, r.value, today()) }
}

/** Enregistre (ou retire, si tout est vide) l'auto-évaluation du jeune pour un événement. Renvoie ce qui est gardé. */
export async function saveMySelfEval(playerId: string, eventId: string, input: SelfEvalInput): Promise<Res<SelfEval | null>> {
  if (isLocal(playerId)) {
    const r = saveSelfEvalLocal(readLocal(playerId), await db.events.get(eventId), playerId, input, today(), new Date().toISOString())
    if (!r.ok) return { ok: false, error: SELF_EVAL_ERRORS[r.error] }
    writeLocal(playerId, r.list)
    return { ok: true, value: r.saved }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_player_selfeval_save', { p_event_id: eventId, p_scores: input.scores, p_good: input.good, p_work: input.work })
  if (error) return fail(error)
  return { ok: true, value: data ? selfEvalFromRow(data as Record<string, unknown>) : null }
}

/** Auto-évaluations d'un joueur, pour le staff (fiche, onglet Avis), la plus récente en premier. */
export async function fetchPlayerSelfEvals(playerId: string): Promise<Res<SelfEval[]>> {
  if (isLocal(playerId)) return { ok: true, value: readLocal(playerId).sort((a, b) => b.eventDate.localeCompare(a.eventDate)) }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!
    .from('hb_player_selfeval')
    .select('event_id, event_type, event_date, event_name, scores, good, work, updated_at')
    .eq('player_id', playerId)
    .order('event_date', { ascending: false })
    .limit(60)
  if (error) return fail(error)
  return { ok: true, value: ((data ?? []) as Record<string, unknown>[]).map(selfEvalFromRow).filter(Boolean) as SelfEval[] }
}

/** Démonstration : auto-évaluations fictives posées sur l'appareil (fiches « demo-… »). */
export function seedDemoSelfEvals(byPlayer: Record<string, SelfEval[]>) {
  for (const [id, list] of Object.entries(byPlayer)) writeLocal(id, list)
}

/** Démonstration effacée : ses auto-évaluations aussi. */
export function clearDemoSelfEvals() {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(KEY_PREFIX + 'demo-')) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* stockage indisponible : rien à effacer */
  }
}
