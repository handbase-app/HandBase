import { alive, db, newId, today, TRIAL } from './db'
import {
  entryFromRow,
  removeSessionLocal,
  saveEntryLocal,
  saveSessionLocal,
  sessionFromRow,
  wellnessEnabledOf,
  wellnessErrorText,
  wellnessMissing,
  WELLNESS_ERRORS,
  type WellnessEntry,
  type WellnessInput,
  type WellnessSession,
} from './wellness'
import { supabase } from './sync'

/*
 * Wellness (supabase/073_wellness.sql, src/wellness.ts) : accès aux données, sans React.
 *  - Avec le serveur : lu À LA DEMANDE et en ligne, jamais synchronisé ni gardé sur l'appareil du staff (données de santé :
 *    pas de copie hors ligne, donc dans aucun export du staff, ni dans « Demander », ni vers une IA). Le jeune passe par
 *    hb_wellness_moi / hb_wellness_enregistrer / hb_wellness_seance / hb_wellness_seance_retirer ; le staff du groupe par
 *    hb_wellness_groupe. Script pas passé (fonction absente) : `missing`, la section se tait.
 *  - Sans serveur (mode essai / local), et pour les fiches de démonstration (« demo-… », jamais envoyées) : sur l'appareil
 *    (stockage du navigateur), mêmes règles (src/wellness.ts). Le réglage d'installation est alors considéré ouvert (données
 *    fictives seulement).
 */

export type Res<T> = { ok: true; value: T } | { ok: false; error: string; missing?: boolean }

const KEY_PREFIX = `handbase${TRIAL ? '-essai' : ''}.wellness.`
const LOCAL_KEY = (playerId: string) => KEY_PREFIX + playerId
/** Sur l'appareil : pas de serveur, ou fiche de démonstration (elle n'existe pas sur le serveur). */
export const isLocalWellness = (playerId: string) => !supabase || playerId.startsWith('demo-')

interface LocalData {
  entries: WellnessEntry[]
  sessions: WellnessSession[]
}
function readLocal(playerId: string): LocalData {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(playerId))
    const v = raw ? (JSON.parse(raw) as Partial<Record<keyof LocalData, unknown>>) : {}
    const rows = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : [])
    return {
      entries: rows(v.entries).map(entryFromRow).filter((e): e is WellnessEntry => !!e),
      sessions: rows(v.sessions).map(sessionFromRow).filter((s): s is WellnessSession => !!s),
    }
  } catch {
    return { entries: [], sessions: [] }
  }
}
function writeLocal(playerId: string, d: LocalData) {
  try {
    if (d.entries.length || d.sessions.length) localStorage.setItem(LOCAL_KEY(playerId), JSON.stringify(d))
    else localStorage.removeItem(LOCAL_KEY(playerId))
  } catch {
    /* stockage indisponible : l'essai ne survit pas au rechargement */
  }
}

const offline = (): Res<never> => ({ ok: false, error: 'Il faut être en ligne pour ça : ce n’est pas gardé sur l’appareil.' })
const fail = (e: { message?: string; code?: string }): Res<never> =>
  wellnessMissing(e.code) ? { ok: false, error: wellnessErrorText(e.message, e.code), missing: true } : { ok: false, error: wellnessErrorText(e.message, e.code) }
const localError = (code: string): Res<never> => ({ ok: false, error: WELLNESS_ERRORS[code] ?? code })

/** Réglage de l'installation (mode essai, sans serveur : ouvert ; sinon hb_config « wellness », copie de l'appareil). */
export async function wellnessEnabled(): Promise<boolean> {
  return wellnessEnabledOf(await db.config.toArray(), { trial: TRIAL, local: !supabase })
}

/** Groupes de l'appareil qui demandent le wellness à cette fiche (mode essai : la règle du serveur, en plus simple). */
async function localRequested(playerId: string): Promise<boolean> {
  const groups = alive(await db.groups.toArray())
  return groups.some((g) => g.wellness === true && !g.archived && g.playerIds.includes(playerId))
}

export interface MyWellness {
  /** Réglage de l'installation ouvert. */
  enabled: boolean
  /** Demandé à ce jeune (groupe activé). */
  requested: boolean
  entries: WellnessEntry[]
  sessions: WellnessSession[]
}

/** Son wellness et ses séances des `days` derniers jours (compte joueur : le serveur ; essai et démonstration : l'appareil). */
export async function fetchMyWellness(playerId: string, days = 28): Promise<Res<MyWellness>> {
  if (isLocalWellness(playerId)) {
    const d = readLocal(playerId)
    const from = new Date(Date.now() - (days - 1) * 86400000).toLocaleDateString('sv')
    return {
      ok: true,
      value: { enabled: await wellnessEnabled(), requested: await localRequested(playerId), entries: d.entries.filter((e) => e.day >= from), sessions: d.sessions.filter((s) => s.day >= from) },
    }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_wellness_moi', { p_jours: days })
  if (error) return fail(error)
  const r = (data ?? {}) as Record<string, unknown>
  const rows = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : [])
  return {
    ok: true,
    value: {
      enabled: r.actif === true,
      requested: r.demande === true,
      entries: rows(r.jours).map(entryFromRow).filter((e): e is WellnessEntry => !!e),
      sessions: rows(r.seances).map(sessionFromRow).filter((s): s is WellnessSession => !!s),
    },
  }
}

/** Enregistre le wellness du jour (aujourd'hui seulement). Renvoie ce qui est gardé. */
export async function saveMyWellness(playerId: string, input: WellnessInput): Promise<Res<WellnessEntry>> {
  if (isLocalWellness(playerId)) {
    const d = readLocal(playerId)
    const r = saveEntryLocal(d.entries, input, today(), new Date().toISOString())
    if (!r.ok) return localError(r.error)
    writeLocal(playerId, { ...d, entries: r.list })
    return { ok: true, value: r.saved }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_wellness_enregistrer', { p_valeurs: input })
  if (error) return fail(error)
  const e = entryFromRow(data as Record<string, unknown>)
  return e ? { ok: true, value: e } : { ok: false, error: 'Réponse du serveur illisible.' }
}

/** Ajoute (sans `id`) ou modifie une séance d'aujourd'hui ou d'hier. */
export async function saveMySession(playerId: string, s: { id?: string; day: string; rpe: number; minutes: number }): Promise<Res<WellnessSession>> {
  if (isLocalWellness(playerId)) {
    const d = readLocal(playerId)
    const r = saveSessionLocal(d.sessions, s, today(), newId, new Date().toISOString())
    if (!r.ok) return localError(r.error)
    writeLocal(playerId, { ...d, sessions: r.list })
    return { ok: true, value: r.saved }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_wellness_seance', { p_jour: s.day, p_rpe: s.rpe, p_duree: s.minutes, p_id: s.id ?? null })
  if (error) return fail(error)
  const x = sessionFromRow(data as Record<string, unknown>)
  return x ? { ok: true, value: x } : { ok: false, error: 'Réponse du serveur illisible.' }
}

/** Retire une séance d'aujourd'hui ou d'hier. */
export async function removeMySession(playerId: string, id: string): Promise<Res<true>> {
  if (isLocalWellness(playerId)) {
    const d = readLocal(playerId)
    const r = removeSessionLocal(d.sessions, id, today())
    if (!r.ok) return localError(r.error)
    writeLocal(playerId, { ...d, sessions: r.list })
    return { ok: true, value: true }
  }
  if (!navigator.onLine) return offline()
  const { error } = await supabase!.rpc('hb_wellness_seance_retirer', { p_id: id })
  if (error) return fail(error)
  return { ok: true, value: true }
}

export interface GroupWellness {
  enabled: boolean
  /** Fiches qui ont un espace joueur (elles seules peuvent répondre). */
  accounts: Set<string>
  entries: Map<string, WellnessEntry[]>
  sessions: Map<string, WellnessSession[]>
}

/**
 * Tableau du staff d'un groupe : wellness et séances des `days` derniers jours de ses joueurs. Serveur : hb_wellness_groupe
 * (le serveur vérifie que le compte est du staff du groupe et lit les fiches) ; fiches de démonstration et mode essai :
 * l'appareil (toutes comptent comme ayant un espace joueur).
 */
export async function fetchGroupWellness(groupId: string, playerIds: readonly string[], days = 35): Promise<Res<GroupWellness>> {
  const entries = new Map<string, WellnessEntry[]>()
  const sessions = new Map<string, WellnessSession[]>()
  const accounts = new Set<string>()
  const from = new Date(Date.now() - (days - 1) * 86400000).toLocaleDateString('sv')
  const local = playerIds.filter(isLocalWellness)
  for (const id of local) {
    const d = readLocal(id)
    accounts.add(id)
    entries.set(id, d.entries.filter((e) => e.day >= from))
    sessions.set(id, d.sessions.filter((s) => s.day >= from))
  }
  let enabled = await wellnessEnabled()
  if (supabase && local.length < playerIds.length) {
    if (!navigator.onLine) return offline()
    const { data, error } = await supabase.rpc('hb_wellness_groupe', { p_group_id: groupId, p_jours: days })
    if (error) return fail(error)
    const r = (data ?? {}) as Record<string, unknown>
    if (!local.length) enabled = r.actif === true
    for (const id of Array.isArray(r.comptes) ? (r.comptes as unknown[]) : []) if (typeof id === 'string') accounts.add(id)
    for (const row of Array.isArray(r.jours) ? (r.jours as Record<string, unknown>[]) : []) {
      const e = entryFromRow(row)
      if (e?.playerId) entries.set(e.playerId, [...(entries.get(e.playerId) ?? []), e])
    }
    for (const row of Array.isArray(r.seances) ? (r.seances as Record<string, unknown>[]) : []) {
      const s = sessionFromRow(row)
      if (s?.playerId) sessions.set(s.playerId, [...(sessions.get(s.playerId) ?? []), s])
    }
  }
  return { ok: true, value: { enabled, accounts, entries, sessions } }
}

export interface PlayerWellnessData {
  enabled: boolean
  /** La fiche a un espace joueur (sinon rien ne lui est demandé). */
  account: boolean
  entries: WellnessEntry[]
  sessions: WellnessSession[]
}

/*
 * Onglet Wellness de la fiche (staff) : par hb_wellness_groupe du groupe choisi (le groupe Pôle d'abord), filtré sur la fiche,
 * plutôt qu'un select direct sur hb_wellness / hb_wellness_seances. La règle de lecture (073, staff_read) le permettrait,
 * mais elle évalue hb_wellness_staff_lit (fonction security definer, périmètres compris) pour CHAQUE ligne lue ; la fonction
 * du groupe calcule les droits et les périmètres une fois (~0,15 s par groupe Pôle, essai du 09/11 : commit b88f534) et dit en plus si la fiche
 * a un espace joueur. Gardé en mémoire 60 s seulement (glisser d'un joueur à l'autre du même groupe sans relire), jamais sur
 * le disque : rien dans les exports, ni dans « Demander », ni vers une IA.
 */
const PLAYER_TTL = 60_000
const groupMemo = new Map<string, { at: number; value: GroupWellness }>()

export async function fetchPlayerWellness(playerId: string, groupId: string, days = 35): Promise<Res<PlayerWellnessData>> {
  if (isLocalWellness(playerId)) {
    const d = readLocal(playerId)
    const from = new Date(Date.now() - (days - 1) * 86400000).toLocaleDateString('sv')
    return { ok: true, value: { enabled: await wellnessEnabled(), account: true, entries: d.entries.filter((e) => e.day >= from), sessions: d.sessions.filter((s) => s.day >= from) } }
  }
  const key = `${groupId}:${days}`
  const hit = groupMemo.get(key)
  let gw: GroupWellness
  if (hit && Date.now() - hit.at < PLAYER_TTL) gw = hit.value
  else {
    const r = await fetchGroupWellness(groupId, [playerId], days)
    if (!r.ok) return r
    gw = r.value
    groupMemo.set(key, { at: Date.now(), value: gw })
  }
  return { ok: true, value: { enabled: gw.enabled, account: gw.accounts.has(playerId), entries: gw.entries.get(playerId) ?? [], sessions: gw.sessions.get(playerId) ?? [] } }
}

/** Démonstration : wellness et séances fictifs posés sur l'appareil (fiches « demo-… »). */
export function seedDemoWellness(byPlayer: Record<string, { entries: WellnessEntry[]; sessions: WellnessSession[] }>) {
  for (const [id, d] of Object.entries(byPlayer)) writeLocal(id, d)
}

/** Démonstration effacée : son wellness aussi. */
export function clearDemoWellness() {
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
