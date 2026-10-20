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
 *
 * Avec un faux modèle posé, l'appli se comporte comme si la fonction « transcrire » annonçait tous ses modes.
 */

export type AskMock = {
  /** Réponse du mode « question » : { recette, nonGere?, action?, retirer? }. */
  question?: (phrase: string, contexte?: string) => unknown
  /** Réponse du mode « action » : le plan. */
  action?: (phrase: string) => unknown
}

let mock: AskMock | null = null
const listeners = new Set<() => void>()

/** Faux modèle posé (développement seulement) ; null sinon. */
export const askMock = (): AskMock | null => (import.meta.env.DEV ? mock : null)

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
    clear() {
      mock = null
      listeners.forEach((l) => l())
    },
  }
