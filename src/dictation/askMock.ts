/*
 * Essai de « Demander » SANS serveur (développement seulement : `npx vite`, jamais dans la version publiée) : une fonction de
 * test peut remplacer les réponses du modèle (modes « question » et « action ») pour vérifier tout le parcours à l'écran
 * (carte de validation, Accepter, Annuler) sur la version d'essai locale. Rien n'est envoyé nulle part.
 *
 *   window.__hbAskMock.set({
 *     question: (phrase, contexte) => ({ recette: { population: { lateralite: 'gaucher' } } }),
 *     action: (phrase) => ({ action: 'creer_groupe', nom: 'Gauchers', joueurs: { population: { lateralite: 'gaucher' } } }),
 *   })
 *   window.__hbAskMock.clear()
 *   window.__hbAskMock.delay(4000)   // réponse lente (4 s) : pour voir le signe d'attente ; delay(0) l'enlève
 *
 * Avec un faux modèle posé, l'appli se comporte comme si la fonction « transcrire » annonçait tous ses modes.
 */

import { DictationError } from './transcribe'

export type AskMock = {
  /** Réponse du mode « question » : { recette, nonGere?, action?, retirer? }. */
  question?: (phrase: string, contexte?: string) => unknown
  /** Réponse du mode « action » : le plan. */
  action?: (phrase: string) => unknown
}

let mock: AskMock | null = null
let delayMs = 0
const listeners = new Set<() => void>()

/** Faux modèle posé (développement seulement) ; null sinon. */
export const askMock = (): AskMock | null => (import.meta.env.DEV ? mock : null)

/** Délai du faux modèle (développement) ; l'annulation de la demande l'interrompt. */
export function mockDelay(signal?: AbortSignal): Promise<void> {
  const ms = import.meta.env.DEV ? delayMs : 0
  if (!ms) return Promise.resolve()
  return new Promise((ok, ko) => {
    const t = setTimeout(ok, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      ko(new DictationError('annule', 'Demande annulée.'))
    })
  })
}

export function onAskMock(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __hbAskMock: unknown }).__hbAskMock = {
    set(m: AskMock) {
      mock = m
      listeners.forEach((l) => l())
    },
    delay(ms: number) {
      delayMs = Math.max(0, Math.min(Number(ms) || 0, 30_000))
    },
    clear() {
      mock = null
      listeners.forEach((l) => l())
    },
  }
