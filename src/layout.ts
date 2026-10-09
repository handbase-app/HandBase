import { useSyncExternalStore } from 'react'

/** Formats d'écran (mêmes seuils que les variants rail / side / wide de index.css). */
export const MQ = {
  /** Téléphone couché : peu de hauteur. */
  rail: '(orientation: landscape) and (max-height: 520px)',
  /** Ordinateur / tablette : menu à gauche. */
  side: '(min-width: 1024px) and (min-height: 521px)',
  /** Grand écran : assez de place pour une colonne de filtres à côté de la liste. */
  xl: '(min-width: 1280px) and (min-height: 521px)',
}

/** Vrai tant que la requête média correspond (suit les rotations et redimensionnements). */
export function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
