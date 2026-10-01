import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { db, SYNC_TABLES, type SyncTable } from './db'

/*
 * Synchronisation « hors ligne d'abord » :
 *  - toutes les écritures vont dans IndexedDB + une file d'attente (outbox) ;
 *  - quand le réseau est là, on pousse la file vers Supabase puis on tire les
 *    changements des autres appareils ;
 *  - en cas de conflit, la version la plus récente (updatedAt) l'emporte.
 * Sans configuration Supabase, l'application fonctionne en local uniquement.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
export const syncEnabled = !!supabase

export type SyncState = 'local' | 'login' | 'offline' | 'syncing' | 'synced' | 'error'

let state: SyncState = syncEnabled ? (navigator.onLine ? 'synced' : 'offline') : 'local'
let lastError = ''
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
    const ids = [...new Set(batch.map((i) => i.rowId))]
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
    await db.outbox.bulkDelete(batch.map((i) => i.seq!))
    const rejected: string[] = Array.isArray(data) ? data : []
    if (rejected.length) {
      rejectedCount += rejected.length
      await restoreFromServer(table, rejected)
    }
  }
}

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

/** À appeler une fois au démarrage. */
export function startSync() {
  if (!supabase) return
  window.addEventListener('online', () => void syncNow())
  window.addEventListener('offline', () => setState('offline'))
  db.outbox.hook('creating', () => {
    setTimeout(() => void syncNow(), 500)
  })
  // Ne pas appeler Supabase directement dans ce callback (risque de blocage) : on diffère.
  supabase.auth.onAuthStateChange(() => setTimeout(() => void syncNow(), 0))
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
  return { state, lastError }
}
