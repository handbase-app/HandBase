// Demandes à l'assistant en cours (fonction « transcrire ») et leur durée habituelle sur cet appareil.
//  - timeAi(mode, appel) : note la demande pendant l'appel (la bulle ✦ de l'en-tête tourne, la pilule montre « Je cherche… »),
//    puis sa durée réelle (aller-retour vu de l'appareil, réseau compris) dans une moyenne glissante par sorte de demande ;
//  - les durées restent sur l'appareil (localStorage « handbase.attente ») : rien ne part, rien de personnel (des nombres).
// Partie pure (moyenne, avancée de la barre, textes) : src/attente.ts.

import { useSyncExternalStore } from 'react'
import { addSample, parseStats, type WaitStat, type WaitStats } from './attente'

const KEY = 'handbase.attente'

/** Une demande en cours : sa sorte (« dictee », « question »…) et son début (performance.now). */
export type Flight = { id: number; mode: string; start: number }

let flights: Flight[] = []
let last: Flight | null = null
let stats: WaitStats | null = null
let seq = 0
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function readStats(): WaitStats {
  if (stats) return stats
  try {
    stats = parseStats(localStorage.getItem(KEY))
  } catch {
    stats = {}
  }
  return stats
}

/** Durée habituelle d'une sorte de demande sur cet appareil (undefined : pas encore mesurée). */
export const waitStat = (mode: string): WaitStat | undefined => readStats()[mode]

function record(mode: string, ms: number) {
  const cur = readStats()
  const next = addSample(cur[mode], ms)
  if (!next || next === cur[mode]) return
  stats = { ...cur, [mode]: next }
  try {
    localStorage.setItem(KEY, JSON.stringify(stats))
  } catch {
    /* stockage indisponible : gardé jusqu'au rechargement */
  }
}

/** Appel à l'assistant, noté pendant qu'il dure ; sa durée compte seulement s'il a abouti (ni erreur ni annulation). */
export async function timeAi<T>(mode: string, run: () => Promise<T>): Promise<T> {
  const f: Flight = { id: ++seq, mode, start: performance.now() }
  flights = [...flights, f]
  last = f
  notify()
  try {
    const r = await run()
    record(mode, performance.now() - f.start)
    return r
  } finally {
    flights = flights.filter((x) => x.id !== f.id)
    last = flights[flights.length - 1] ?? null
    notify()
  }
}

const current = () => last
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** La dernière demande en cours (null : aucune). */
export const useAiFlight = (): Flight | null => useSyncExternalStore(subscribe, current, current)
