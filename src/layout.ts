import { useCallback, useState, useSyncExternalStore, type RefCallback } from 'react'

/** Formats d'écran (mêmes seuils que les variants rail / side / wide de index.css). */
export const MQ = {
  /** Téléphone couché : peu de hauteur. */
  rail: '(orientation: landscape) and (max-height: 520px)',
  /** Ordinateur / tablette : menu à gauche. */
  side: '(min-width: 1024px) and (min-height: 521px)',
  /** Grand écran : assez de place pour une colonne de filtres à côté de la liste. */
  xl: '(min-width: 1280px) and (min-height: 521px)',
  /** Maître-détail (liste à gauche, fiche à droite) : ordinateur seulement. Sur téléphone couché, la hauteur
   *  (≈ 390 px) ne laisse pas la place à deux colonnes qui défilent chacune de leur côté. */
  split: '(min-width: 1024px) and (min-height: 521px)',
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

/** Largeur d'un élément, suivie (ResizeObserver) : à poser avec `ref={…}`. 0 tant qu'il n'est pas affiché. */
export function useWidth<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [w, setW] = useState(0)
  const ref = useCallback<RefCallback<T>>((el) => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    // React 19 : la fonction renvoyée est appelée au démontage.
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}
