import Dexie from 'dexie'
import { useEffect, useRef, useState, useSyncExternalStore, type DependencyList } from 'react'
import { db } from './db'

/*
 * Requêtes « lourdes » (toute la base) recalculées au plus une fois toutes les DELAY ms après un
 * changement, au lieu d'une fois par écriture : une synchronisation arrive par paquets de 500 lignes,
 * useLiveQuery relancerait tout à chaque paquet.
 */

const DELAY = 1500

/** Appelle `fn` quand une des tables change (sur cet appareil ou dans un autre onglet). */
function onTables(tables: string[], fn: () => void) {
  const prefixes = tables.map((t) => `idb://${db.name}/${t}/`)
  const l = (parts: Record<string, unknown>) => {
    if (Object.keys(parts).some((k) => prefixes.some((p) => k.startsWith(p)))) fn()
  }
  Dexie.on('storagemutated', l)
  return () => Dexie.on('storagemutated').unsubscribe(l)
}

/**
 * Valeur partagée par tous les écrans qui l'utilisent (un seul calcul), relancée au plus toutes les
 * `delay` ms après un changement des tables citées, et tout de suite par refresh().
 */
export function sharedQuery<T>(tables: string[], query: () => Promise<T>, delay = DELAY) {
  let value: T | undefined
  let stale = true
  let running = false
  let again = false
  let timer: number | undefined
  let stop: (() => void) | null = null
  const listeners = new Set<() => void>()

  async function run() {
    timer = undefined
    if (running) {
      again = true
      return
    }
    running = true
    try {
      value = await query()
      stale = false
      listeners.forEach((l) => l())
    } catch (e) {
      console.error(e)
    } finally {
      running = false
      if (again) {
        again = false
        void run()
      }
    }
  }
  /** Recalcul différé : plusieurs changements rapprochés n'en font qu'un. */
  const soon = (ms = delay) => {
    if (timer !== undefined) {
      if (ms) return
      window.clearTimeout(timer)
    }
    timer = window.setTimeout(() => void run(), ms)
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l)
      if (!stop) stop = onTables(tables, () => soon())
      if (stale) soon(0)
      return () => {
        listeners.delete(l)
        if (!listeners.size && stop) {
          // Plus personne n'écoute : on ne suit plus la base ; la valeur sera recalculée au prochain abonné.
          stop()
          stop = null
          stale = true
        }
      }
    },
    get: () => value,
    /** À relancer tout de suite (changement hors de la base : rôle, « déjà vus »…). */
    refresh: () => soon(0),
  }
}

export function useShared<T>(q: ReturnType<typeof sharedQuery<T>>) {
  return useSyncExternalStore(q.subscribe, q.get)
}

/**
 * Comme useLiveQuery, mais relancée au plus toutes les `delay` ms après un changement des tables citées
 * (pour les écrans qui relisent toute la base : fil, compteurs).
 */
export function useThrottledQuery<T>(query: () => Promise<T>, deps: DependencyList, tables: string[], delay?: number): T | undefined
export function useThrottledQuery<T>(query: () => Promise<T>, deps: DependencyList, tables: string[], delay: number | undefined, initial: T): T
export function useThrottledQuery<T>(query: () => Promise<T>, deps: DependencyList, tables: string[], delay = DELAY, initial?: T) {
  const [value, setValue] = useState<T | undefined>(initial)
  const ref = useRef(query)
  ref.current = query
  useEffect(() => {
    let alive = true
    let running = false
    let again = false
    let timer: number | undefined
    const run = async () => {
      timer = undefined
      if (running) {
        again = true
        return
      }
      running = true
      try {
        const v = await ref.current()
        if (alive) setValue(() => v)
      } catch (e) {
        console.error(e)
      } finally {
        running = false
        if (again && alive) {
          again = false
          void run()
        }
      }
    }
    void run()
    const stop = onTables(tables, () => {
      if (timer === undefined) timer = window.setTimeout(() => void run(), delay)
    })
    return () => {
      alive = false
      stop()
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tables.join(), delay])
  return value
}
