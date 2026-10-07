import { createClient, isAuthRetryableFetchError, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { db, SYNC_TABLES, TRIAL, type SyncTable } from './db'
import { disablePush } from './push'
import { aggregate, type SyncProgress, type TableProgress } from './syncProgress'

/*
 * Synchronisation « hors ligne d'abord » :
 *  - toutes les écritures vont dans IndexedDB + une file d'attente (outbox) ;
 *  - quand le réseau est là, on pousse la file vers Supabase puis on tire les
 *    changements des autres appareils ;
 *  - en cas de conflit, la version la plus récente (updatedAt) l'emporte ;
 *  - en direct : le serveur prévient (Supabase Realtime) dès qu'une donnée change, et l'appli
 *    va chercher les nouveautés aussitôt (sinon, au plus tard toutes les minutes).
 * Sans configuration Supabase, l'application fonctionne en local uniquement.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
export const syncEnabled = !!supabase

export type SyncState = 'local' | 'login' | 'offline' | 'syncing' | 'synced' | 'error'

let state: SyncState = syncEnabled ? (navigator.onLine ? 'synced' : 'offline') : 'local'
let lastError = ''
/** Connexion « en direct » active (notifications du serveur reçues). */
let live = false
/** Avancement d'un gros téléchargement en cours (null sinon). */
let progress: SyncProgress | null = null
const listeners = new Set<() => void>()
const setState = (s: SyncState, err = '') => {
  state = s
  lastError = err
  listeners.forEach((l) => l())
}

const PULL_KEY = (t: SyncTable) => `handbase${TRIAL ? '-essai' : ''}.lastPull.${t}`

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* stockage indisponible */
    }
  },
}

/*
 * Propriétaire des données locales : le compte qui les a synchronisées. Un autre compte qui se connecte
 * sur l'appareil (lien d'accès #acces=, ancienne version qui gardait les données à la déconnexion)
 * repart d'un appareil vide. Avant cette version, le compte n'était noté que dans handbase.uid (roles.ts).
 */
const OWNER_KEY = `handbase${TRIAL ? '-essai' : ''}.owner`
const legacyOwner = store.get('handbase.uid')

/** Note le compte propriétaire des données locales ; false si elles sont à un autre compte (effacement lancé). */
export function claimDevice(uid: string): boolean {
  if (wiping) return false
  const owner = store.get(OWNER_KEY) ?? legacyOwner
  if (owner && owner !== uid) {
    void wipeDevice()
    return false
  }
  if (!store.get(OWNER_KEY)) store.set(OWNER_KEY, uid)
  return true
}

let wiping = false

/**
 * Efface HandBase de cet appareil (déconnexion, ou données d'un autre compte) : notifications désabonnées,
 * session fermée si demandé, base locale, réglages handbase.*, pastille de l'icône ; puis on recharge.
 */
export async function wipeDevice({ signOut = false } = {}) {
  if (wiping) return
  wiping = true
  stopRealtime()
  // Le serveur oublie l'abonnement de l'appareil (il faut encore la session). Sans service worker prêt, on n'attend pas.
  await Promise.race([disablePush().catch(() => {}), new Promise((r) => setTimeout(r, 3000))])
  if (signOut && supabase) {
    await supabase.auth.signOut().catch(() => {})
    // Hors ligne, signOut() échoue et garde la session : on l'oublie quand même sur l'appareil.
    try {
      for (const k of Object.keys(localStorage)) if (/^sb-.+-auth-token/.test(k)) localStorage.removeItem(k)
    } catch {
      /* stockage indisponible */
    }
  }
  try {
    await db.delete({ disableAutoOpen: true })
  } catch {
    /* base déjà absente ou bloquée : rien de plus à faire */
  }
  for (const get of [() => localStorage, () => sessionStorage]) {
    try {
      const s = get()
      // Le thème est un réglage de l'appareil, pas une donnée du compte.
      for (const k of Object.keys(s)) if (/^handbase(-essai)?\./.test(k) && k !== 'handbase.theme') s.removeItem(k)
    } catch {
      /* stockage indisponible */
    }
  }
  try {
    await caches.delete('hb-badge')
  } catch {
    /* cache indisponible */
  }
  try {
    await (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.()
  } catch {
    /* non pris en charge */
  }
  location.reload()
}

let running: Promise<void> | null = null
let again = false

/** Lance une synchronisation (ou attend celle en cours). retry : renvoie aussi les modifications mises de côté. */
export async function syncNow({ retry = false } = {}): Promise<void> {
  if (!supabase || wiping) return
  if (retry) {
    setAside.clear()
    failures.clear()
  }
  if (!navigator.onLine) return setState('offline')
  if (running) {
    again = true
    return running
  }
  running = run()
  try {
    await running
  } finally {
    running = null
    if (again) {
      again = false
      void syncNow()
    }
  }
}

async function run() {
  try {
    const { data, error } = await supabase!.auth.getSession()
    // Session expirée, pas renouvelable faute de réseau : on reste hors ligne (voir AuthGate).
    if (!data.session) return setState(isAuthRetryableFetchError(error) ? 'offline' : 'login')
    if (!claimDevice(data.session.user.id)) return
    setState('syncing')
    rejectedCount = 0
    // Un envoi en échec n'empêche pas de recevoir les nouveautés des autres.
    let pushError: unknown = null
    try {
      await push()
    } catch (e) {
      pushError = e
    }
    await pull(data.session.user.id)
    if (pushError) throw pushError
    const notes = [
      rejectedCount && `${rejectedCount} modification(s) annulée(s) : refusée(s) par le serveur (droits) ou plus ancienne(s) que sa version.`,
      setAside.size && `${setAside.size} modification(s) mise(s) de côté, refusée(s) à chaque envoi (${lastPushError}) ; « Synchroniser maintenant » les renvoie.`,
    ].filter(Boolean)
    setState('synced', notes.join(' '))
  } catch (e) {
    setState('error', e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? e))
  }
}

const PUSH_CHUNK = 400

/** Tables que le serveur peut ne pas encore connaître (script SQL pas encore passé) : ignorées sans erreur. */
const OPTIONAL_TABLES: SyncTable[] = ['follows', 'teams']

let rejectedCount = 0

/*
 * Ligne refusée à chaque envoi (donnée invalide…) : après MAX_FAILURES échecs, elle est mise de côté
 * (gardée dans la file mais plus envoyée, jusqu'à « Synchroniser maintenant » ou au prochain lancement)
 * pour ne pas bloquer toute la synchronisation.
 */
const MAX_FAILURES = 3
const failures = new Map<string, number>()
const setAside = new Set<string>()
let lastPushError = ''
const rowKey = (table: SyncTable, id: string) => `${table}:${id}`

/**
 * Réseau coupé, serveur indisponible ou refus de la requête entière (pas de code Postgres, codes PGRST…,
 * délai dépassé) : on réessaiera, sans accuser la ligne.
 */
const transient = (e: { code?: string }) => !e.code || e.code.startsWith('PGRST') || e.code === '57014'

type Payload = { id: string; data: unknown; updated_at_client: number; deleted: boolean }

// Le serveur ne garde que les lignes autorisées pour le rôle du compte, et seulement si
// la version envoyée est plus récente (voir supabase/002_roles.sql). Il renvoie les refusées.
const upsert = (table: SyncTable, rows: Payload[]) => supabase!.rpc('hb_upsert', { p_table: table, p_rows: rows })

async function push() {
  const items = (await db.outbox.orderBy('seq').toArray()).filter((i) => !setAside.has(rowKey(i.table, i.rowId)))
  if (!items.length) return
  for (const table of SYNC_TABLES) {
    const batch = items.filter((i) => i.table === table)
    if (!batch.length) continue
    // Envoi par paquets (un import de licences peut représenter des milliers de lignes).
    for (let i = 0; i < batch.length; i += PUSH_CHUNK) {
      const part = batch.slice(i, i + PUSH_CHUNK)
      const ids = [...new Set(part.map((it) => it.rowId))]
      const rows = (await db.table(table).bulkGet(ids)).filter(Boolean)
      const payload: Payload[] = rows.map((r) => ({
        id: r.id,
        data: r,
        updated_at_client: r.updatedAt,
        deleted: !!r.deleted,
      }))
      const { data, error } = await upsert(table, payload)
      // Suivis ou staffs envoyés avant que le serveur ne les connaisse (supabase/032_suivis.sql, 034_equipes_encadrants.sql
      // pas encore passés) : gardés dans la file, renvoyés plus tard, sans bloquer la synchronisation.
      if (error && OPTIONAL_TABLES.includes(table) && /Table inconnue/.test(error.message)) break
      if (!error) {
        // La file n'est vidée qu'une fois les refus traités (sinon on renverra).
        await applyRejected(table, data)
        await db.outbox.bulkDelete(part.map((it) => it.seq!))
        continue
      }
      if (transient(error)) throw error
      // Paquet refusé : on renvoie ligne par ligne pour isoler la ou les lignes fautives.
      for (const p of payload) {
        const one = await upsert(table, [p])
        const k = rowKey(table, p.id)
        if (one.error) {
          if (transient(one.error)) throw one.error
          lastPushError = one.error.message
          const n = (failures.get(k) ?? 0) + 1
          failures.set(k, n)
          if (n >= MAX_FAILURES) setAside.add(k)
          continue
        }
        failures.delete(k)
        await applyRejected(table, one.data)
        await db.outbox.bulkDelete(part.filter((it) => it.rowId === p.id).map((it) => it.seq!))
      }
      // Entrées de la file dont la ligne n'existe plus sur l'appareil : rien à envoyer.
      const sent = new Set(payload.map((p) => p.id))
      await db.outbox.bulkDelete(part.filter((it) => !sent.has(it.rowId)).map((it) => it.seq!))
    }
  }
  // Lignes refusées pas encore mises de côté : on le signale (elles repartiront au prochain envoi).
  if ([...failures.keys()].some((k) => !setAside.has(k))) throw new Error(`Envoi refusé : ${lastPushError}`)
}

/** Refus du serveur (droits, ou version plus ancienne que la sienne) : on reprend sa version. */
async function applyRejected(table: SyncTable, data: unknown) {
  const rejected: string[] = Array.isArray(data) ? data : []
  if (!rejected.length) return
  rejectedCount += rejected.length
  await restoreFromServer(table, rejected)
}

/** Annule localement les modifications refusées : on reprend la version du serveur (ou on retire la ligne). */
async function restoreFromServer(table: SyncTable, ids: string[]) {
  const { data, error } = await supabase!.from(`hb_${table}`).select('id, data').in('id', ids)
  if (error) throw error
  const server = new Map((data ?? []).map((r) => [r.id as string, r.data]))
  await db.transaction('rw', db.table(table), async () => {
    for (const id of ids) {
      const row = server.get(id)
      if (row) await db.table(table).put(row)
      else await db.table(table).delete(id)
    }
  })
}

/*
 * server_updated_at est l'heure d'écriture (clock_timestamp()), pas celle de validation : une ligne
 * validée un peu plus tard peut porter une heure antérieure au dernier curseur. On relit donc la
 * dernière minute (réappliquer une ligne déjà vue est sans effet), et on pagine sur
 * (server_updated_at, id) pour avancer même si plus de PULL_PAGE lignes ont la même heure.
 * Seulement quand le curseur est récent : une écriture validée en retard l'est en quelques secondes.
 * Sinon, un import massif (des milliers de lignes dans la même minute) serait retéléchargé à chaque fois.
 */
const PULL_OVERLAP_MS = 60_000
const OVERLAP_WINDOW_MS = 5 * 60_000
const PULL_PAGE = 1000

/** Nombre de lignes à recevoir depuis start, estimé par le serveur sans les télécharger (0 si inconnu). */
async function countSince(table: SyncTable, start: string) {
  try {
    const { count } = await supabase!.from(`hb_${table}`).select('id', { count: 'estimated', head: true }).gte('server_updated_at', start)
    return count ?? 0
  } catch {
    return 0
  }
}

const setProgress = (p: SyncProgress | null) => {
  progress = p
  listeners.forEach((l) => l())
}

/**
 * Staffs dont ce compte est membre (ou créateur), avec leur version : un staff qui apparaît ou change (on vient
 * d'y entrer, par exemple) peut ouvrir des groupes « Mon staff » qui, eux, n'ont pas changé : le serveur ne les
 * enverrait pas (on ne reçoit que ce qui a changé depuis la dernière fois). On relit alors tous les groupes.
 */
async function myTeams(uid: string) {
  const teams = await db.teams.toArray()
  return new Map(teams.filter((t) => !t.deleted && (t.createdBy === uid || t.members?.includes(uid))).map((t) => [t.id, t.updatedAt]))
}

async function pull(uid: string) {
  /*
   * Avancement : tables jamais téléchargées comptées d'avance (en parallèle) ; les autres seulement si
   * leur premier paquet est plein (gros retard). Une petite synchro ordinaire ne fait aucune requête de plus.
   */
  const per: Partial<Record<SyncTable, TableProgress>> = {}
  const fresh = SYNC_TABLES.filter((t) => !localStorage.getItem(PULL_KEY(t)))
  const first = fresh.length === SYNC_TABLES.length
  await Promise.all(fresh.map(async (t) => (per[t] = { done: 0, total: await countSince(t, '1970-01-01T00:00:00Z') })))
  if (fresh.length) setProgress(aggregate(per, null, first))
  try {
    const teamsBefore = await myTeams(uid)
    for (const table of SYNC_TABLES) {
      if (table === 'groups') {
        const after = await myTeams(uid)
        if ([...after].some(([id, v]) => teamsBefore.get(id) !== v)) localStorage.removeItem(PULL_KEY('groups'))
      }
      await pullTable(table, per, first)
    }
  } finally {
    if (progress) setProgress(null)
  }
  await forgetHidden()
}

/*
 * Lignes que ce compte ne voit plus. Le serveur ne lui en envoie plus rien, pas même la suppression : sa copie
 * resterait sur l'appareil.
 *  - staffs dont il a été retiré (supabase/034_equipes_encadrants.sql) : sa copie le dirait encore membre ;
 *  - groupes « Mon staff » dont il a été retiré (ou dont il s'est retiré, supabase/031_groupes_equipe.sql), ou
 *    ouverts par un staff dont il est sorti (034).
 * (Les événements sont visibles par tout le staff : rien à oublier ; les droits de participant suivent les staffs.)
 * Au lancement puis toutes les 10 minutes, on relit la liste des staffs et des groupes visibles (seulement leurs
 * identifiants : quelques centaines au plus) et on retire de l'appareil ceux qui n'y sont plus, sauf s'ils ont une
 * modification pas encore envoyée. (Rendre un groupe moins visible en crée une copie et supprime l'ancien, voir
 * GroupForm : cela, tous les appareils le reçoivent tout de suite.)
 */
const FORGET_EVERY_MS = 10 * 60_000
let lastForget = 0

/** Identifiants visibles d'une table (null : erreur, ou table inconnue du serveur). */
async function visibleIds(table: 'groups' | 'teams') {
  const visible = new Set<string>()
  // Pagination par identifiant (et non par position) : aucune ligne sautée si le serveur change entre deux pages.
  for (let after = ''; ; ) {
    const { data, error } = await supabase!.from(`hb_${table}`).select('id').gt('id', after).order('id').limit(PULL_PAGE)
    if (error) return null // on réessaiera à la prochaine synchronisation
    for (const r of data) visible.add(r.id as string)
    if (data.length < PULL_PAGE) break
    after = data[data.length - 1].id as string
  }
  return visible
}

/** Retire de l'appareil les lignes de `table` absentes de `visible` (sauf celles qui attendent d'être envoyées). */
async function forgetRows(table: 'groups' | 'teams', visible: Set<string>) {
  // Une seule transaction : une ligne créée sur l'appareil pendant ce temps est forcément dans la file d'envoi.
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    const pending = new Set((await db.outbox.where('table').equals(table).toArray()).map((i) => i.rowId))
    const gone = ((await db.table(table).toCollection().primaryKeys()) as string[]).filter((id) => !visible.has(id) && !pending.has(id))
    if (gone.length) await db.table(table).bulkDelete(gone)
  })
}

async function forgetHidden() {
  if (Date.now() - lastForget < FORGET_EVERY_MS) return
  const [teams, groups] = await Promise.all([visibleIds('teams'), visibleIds('groups')])
  if (!groups) return
  lastForget = Date.now()
  // Aucun groupe visible (compte sans rôle, réponse anormale) : on ne retire rien, par prudence. Aucun staff
  // visible, en revanche, est courant (personne n'en a encore créé) ; table absente du serveur (null) : rien.
  if (!groups.size) return
  if (teams) await forgetRows('teams', teams)
  await forgetRows('groups', groups)
}

/** Table inconnue du serveur (Postgres 42P01, ou cache de PostgREST : PGRST205). */
const missingTable = (e: { code?: string }) => e.code === '42P01' || e.code === 'PGRST205'

async function pullTable(table: SyncTable, per: Partial<Record<SyncTable, TableProgress>>, first: boolean) {
  const since = localStorage.getItem(PULL_KEY(table)) ?? '1970-01-01T00:00:00Z'
  const at = new Date(since).getTime()
  const start = new Date(Date.now() - at < OVERLAP_WINDOW_MS ? at - PULL_OVERLAP_MS : at).toISOString()
  let after: { at: string; id: string } | null = null
  for (;;) {
    const base = supabase!.from(`hb_${table}`).select('id, data, server_updated_at')
    const filtered = after
      ? base.or(`server_updated_at.gt."${after.at}",and(server_updated_at.eq."${after.at}",id.gt."${after.id}")`)
      : base.gte('server_updated_at', start)
    const { data, error } = await filtered.order('server_updated_at').order('id').limit(PULL_PAGE)
    // Table des suivis ou des staffs absente du serveur (supabase/032, 034 pas encore passés) : rien à recevoir.
    if (error && OPTIONAL_TABLES.includes(table) && missingTable(error)) return
    if (error) throw error
    if (!data?.length) break
    // Un paquet = une lecture et une écriture groupées (premier chargement : des dizaines de milliers de lignes).
    await db.transaction('rw', db.table(table), async () => {
      const locals = (await db.table(table).bulkGet(data.map((r) => r.id))) as ({ updatedAt?: number } | undefined)[]
      // Ligne effacée par le serveur (expiration, purge) : appliquée quelle que soit l'heure locale.
      const newer = data.filter((r, i) => !locals[i] || r.data?.purged === true || (r.data.updatedAt ?? 0) >= (locals[i]!.updatedAt ?? 0))
      if (newer.length) await db.table(table).bulkPut(newer.map((r) => r.data))
    })
    const last: { id: string; server_updated_at: string } = data[data.length - 1]
    after = { at: last.server_updated_at, id: last.id }
    if (new Date(last.server_updated_at) > new Date(since)) localStorage.setItem(PULL_KEY(table), last.server_updated_at)
    // Gros retard (premier paquet plein) : on compte ce qui reste, une seule fois.
    if (!per[table] && data.length === PULL_PAGE) per[table] = { done: 0, total: await countSince(table, start) }
    const p = per[table]
    if (p) {
      p.done += data.length
      setProgress(aggregate(per, table, first))
    }
    if (data.length < PULL_PAGE) break
  }
  // Table terminée : son total devient exact (l'estimation peut être un peu fausse).
  if (per[table]) per[table]!.total = per[table]!.done
  // Table vide sur le serveur : curseur posé quand même, pour ne plus la recompter à chaque synchro.
  if (!localStorage.getItem(PULL_KEY(table))) localStorage.setItem(PULL_KEY(table), since)
}

// Plusieurs changements rapprochés (ex. un import) ne déclenchent qu'une synchronisation.
let soon: number | undefined
function syncSoon(delay = 400) {
  window.clearTimeout(soon)
  soon = window.setTimeout(() => void syncNow(), delay)
}

let channel: RealtimeChannel | null = null

/** Écoute les changements du serveur sur toutes les tables (seulement une fois connecté). */
function startRealtime() {
  if (!supabase || channel) return
  channel = supabase.channel('handbase-sync')
  // Suivis et staffs : pas de diffusion en direct (privés, rarement changés ; relus à chaque synchronisation,
  // au plus toutes les minutes ; un staff absent du serveur ne doit pas faire échouer l'abonnement).
  for (const t of SYNC_TABLES.filter((t) => !OPTIONAL_TABLES.includes(t))) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: `hb_${t}` }, () => syncSoon())
  }
  channel.subscribe((status) => {
    const was = live
    live = status === 'SUBSCRIBED'
    // En (re)connexion, on rattrape ce qui a pu changer pendant la coupure.
    if (live && !was) syncSoon(0)
    listeners.forEach((l) => l())
  })
}

function stopRealtime() {
  if (!supabase || !channel) return
  void supabase.removeChannel(channel)
  channel = null
  live = false
  listeners.forEach((l) => l())
}

/** À appeler une fois au démarrage. */
export function startSync() {
  if (!supabase) return
  window.addEventListener('online', () => void syncNow())
  window.addEventListener('offline', () => setState('offline'))
  // Retour sur l'appli (téléphone déverrouillé, onglet réaffiché) : on se met à jour.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncSoon(0))
  db.outbox.hook('creating', () => syncSoon(500))
  // Ne pas appeler Supabase directement dans ce callback (risque de blocage) : on diffère.
  supabase.auth.onAuthStateChange((_e, session) =>
    setTimeout(() => {
      if (session) startRealtime()
      else stopRealtime()
      void syncNow()
    }, 0),
  )
  // Filet de sécurité si une notification est perdue.
  setInterval(() => void syncNow(), 60_000)
  void syncNow()
}

export function useSyncState() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return { state, lastError, live, progress }
}
