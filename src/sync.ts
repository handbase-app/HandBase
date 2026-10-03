import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { db, SYNC_TABLES, type SyncTable } from './db'

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
const listeners = new Set<() => void>()
const setState = (s: SyncState, err = '') => {
  state = s
  lastError = err
  listeners.forEach((l) => l())
}

const PULL_KEY = (t: SyncTable) => `handbase.lastPull.${t}`

let running = false
let again = false

export async function syncNow(): Promise<void> {
  if (!supabase) return
  if (!navigator.onLine) return setState('offline')
  if (running) {
    again = true
    return
  }
  running = true
  try {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return setState('login')
    setState('syncing')
    rejectedCount = 0
    await push()
    await pull()
    setState(
      'synced',
      rejectedCount ? `${rejectedCount} modification(s) annulée(s) : ton rôle ne le permet pas.` : '',
    )
  } catch (e) {
    setState('error', e instanceof Error ? e.message : String(e))
  } finally {
    running = false
    if (again) {
      again = false
      void syncNow()
    }
  }
}

async function push() {
  const items = await db.outbox.orderBy('seq').toArray()
  if (!items.length) return
  for (const table of SYNC_TABLES) {
    const batch = items.filter((i) => i.table === table)
    if (!batch.length) continue
    // Envoi par paquets (un import de licences peut représenter des milliers de lignes).
    for (let i = 0; i < batch.length; i += PUSH_CHUNK) {
      const part = batch.slice(i, i + PUSH_CHUNK)
      const ids = [...new Set(part.map((it) => it.rowId))]
      const rows = (await db.table(table).bulkGet(ids)).filter(Boolean)
      const payload = rows.map((r) => ({
        id: r.id,
        data: r,
        updated_at_client: r.updatedAt,
        deleted: !!r.deleted,
      }))
      // Le serveur ne garde que les lignes autorisées pour le rôle du compte, et seulement si
      // la version envoyée est plus récente (voir supabase/002_roles.sql). Il renvoie les refusées.
      const { data, error } = await supabase!.rpc('hb_upsert', { p_table: table, p_rows: payload })
      if (error) throw error
      await db.outbox.bulkDelete(part.map((it) => it.seq!))
      const rejected: string[] = Array.isArray(data) ? data : []
      if (rejected.length) {
        rejectedCount += rejected.length
        await restoreFromServer(table, rejected)
      }
    }
  }
}

const PUSH_CHUNK = 400

let rejectedCount = 0

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

async function pull() {
  for (const table of SYNC_TABLES) {
    const since = localStorage.getItem(PULL_KEY(table)) ?? '1970-01-01T00:00:00Z'
    let cursor = since
    for (;;) {
      const { data, error } = await supabase!
        .from(`hb_${table}`)
        .select('id, data, server_updated_at')
        .gt('server_updated_at', cursor)
        .order('server_updated_at')
        .limit(500)
      if (error) throw error
      if (!data?.length) break
      await db.transaction('rw', db.table(table), async () => {
        for (const r of data) {
          const local = await db.table(table).get(r.id)
          if (!local || (r.data.updatedAt ?? 0) >= (local.updatedAt ?? 0)) await db.table(table).put(r.data)
        }
      })
      cursor = data[data.length - 1].server_updated_at
      localStorage.setItem(PULL_KEY(table), cursor)
      if (data.length < 500) break
    }
  }
}

/**
 * Les référents lisibles dépendent du compte et du rôle : on efface ceux de l'appareil (sauf les
 * saisies pas encore envoyées) et on les recharge entièrement depuis le serveur.
 */
export async function resetReferents() {
  if (!supabase) return
  await db.transaction('rw', db.referents, db.outbox, async () => {
    const unsent = new Set((await db.outbox.where('table').equals('referents').toArray()).map((o) => o.rowId))
    const ids = (await db.referents.toCollection().primaryKeys()).filter((id) => !unsent.has(id))
    await db.referents.bulkDelete(ids)
  })
  try {
    localStorage.removeItem(PULL_KEY('referents'))
  } catch {
    /* stockage indisponible */
  }
  syncSoon(0)
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
  for (const t of SYNC_TABLES) {
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
  return { state, lastError, live }
}
