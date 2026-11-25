import { useSyncExternalStore } from 'react'

/**
 * Retour propre à un écran qui est un onglet du menu (31/10) : la flèche ← de l'en-tête (HeaderBack, src/App.tsx) n'y paraît
 * pas, sauf si l'écran en pose une ici. Bilan de détection : dans une région, un département ou un club, elle remonte d'un
 * étage (club → département → région → France) ; sur la carte de France, rien.
 */
type Override = { go: () => void; label: string } | null
let cur: Override = null
const subs = new Set<() => void>()

export function setHeaderBack(o: Override) {
  cur = o
  subs.forEach((f) => f())
}

export function useHeaderBack(): Override {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => cur,
    () => null,
  )
}
