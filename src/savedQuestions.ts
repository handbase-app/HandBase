import { useSyncExternalStore } from 'react'
import { parseSaved, type Recipe, type SavedQuestion, type VarKey } from './recipe'

/*
 * « Mes questions » (bilan de détection) : questions enregistrées, relancées sans appel au modèle (la recette suffit).
 * Gardées SUR CET APPAREIL (localStorage) : aucune table synchronisée ne convient sans changer la base (les profils
 * recherchés, `alerts`, sont des filtres partagés d'une autre forme). Chaque lecture est revérifiée (parseSaved) ;
 * stockage indisponible (navigation privée) : gardées jusqu'au rechargement.
 */

const KEY = 'handbase.questions'
const MAX = 50
const listeners = new Set<() => void>()
let cache: SavedQuestion[] | null = null

function read(): SavedQuestion[] {
  if (cache) return cache
  try {
    cache = parseSaved(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
  } catch {
    cache = []
  }
  return cache
}

function write(next: SavedQuestion[]) {
  cache = next.slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* stockage indisponible : gardées jusqu'au rechargement */
  }
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    cache = null
    listeners.forEach((l) => l())
  })

export function useSavedQuestions(): SavedQuestion[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    read,
    read,
  )
}

export function saveQuestion(name: string, recipe: Recipe, vars: VarKey[], phrase?: string): SavedQuestion {
  const q: SavedQuestion = {
    id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Ma question',
    recipe,
    vars,
    ...(phrase ? { phrase: phrase.slice(0, 300) } : {}),
    at: Date.now(),
  }
  write([q, ...read()])
  return q
}

export function deleteQuestion(id: string) {
  write(read().filter((q) => q.id !== id))
}
