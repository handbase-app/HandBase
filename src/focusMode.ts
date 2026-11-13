import { useSyncExternalStore } from 'react'

/*
 * Notation en cours (src/pages/Evaluate.tsx, un joueur affiché) : sur téléphone tenu droit, App.tsx cache le menu du bas
 * (data-nonav sur <html>, src/index.css) ; « Enregistrer » et le micro de l'avis vocal descendent tout en bas.
 */
let on = false
const subs = new Set<() => void>()

export function setRatingFocus(v: boolean) {
  if (on === v) return
  on = v
  subs.forEach((f) => f())
}

export function useRatingFocus() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => on,
  )
}
