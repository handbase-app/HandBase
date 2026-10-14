/*
 * Bilan de détection : le retour remonte d'un étage. L'historique du bilan est toujours la chaîne des lieux parents du
 * lieu affiché (France → région → département → club), une entrée par étage : le bouton retour (de l'appli ou du
 * navigateur) ramène au parent, et seulement depuis la France on quitte le bilan.
 *
 * Fichier pur (ni React ni routeur) : le plan de navigation (combien d'entrées dépiler, lesquelles remplacer et
 * empiler) ; l'exécution est dans useBilanState (src/pages/Coverage.tsx). Testé par tools/test-bilan-nav.ts.
 */

/** Lieu du bilan. Club : null aucun, '' club non renseigné. */
export type Place = { region: string; dept: string; club: string | null }

export const placeKey = (p: Place) => JSON.stringify([p.region, p.dept, p.club])
export const samePlace = (a: Place, b: Place) => placeKey(a) === placeKey(b)
export const placeDepth = (p: Place) => (p.club !== null ? 3 : p.dept ? 2 : p.region ? 1 : 0)

/** Étages au-dessus d'un lieu, du plus haut (la France) au parent direct. */
export function placeParents(p: Place): Place[] {
  const out: Place[] = []
  if (placeDepth(p) === 0) return out
  out.push({ region: '', dept: '', club: null })
  if (p.region && (p.dept || p.club !== null)) out.push({ region: p.region, dept: '', club: null })
  if (p.dept && p.club !== null) out.push({ region: p.region, dept: p.dept, club: null })
  return out
}

/** Parent direct (undefined : la France). */
export const placeParent = (p: Place): Place | undefined => placeParents(p).at(-1)

/**
 * Comment aller de `cur` à `next`. `chain` : clés des entrées du bilan sous l'entrée actuelle dans l'historique (de la
 * plus ancienne à la plus récente). Résultat : dépiler `pop` entrées (on retombe sur une entrée de la chaîne), ou
 * remplacer l'entrée actuelle par `replace` ; puis empiler `push`. Après coup, l'historique vaut toujours
 * [parents de next…, next].
 */
export function placePlan(chain: readonly string[], cur: Place, next: Place): { pop: number; replace?: Place; push: Place[] } {
  const line = [...placeParents(next), next]
  const keys = line.map(placeKey)
  const i = keys.indexOf(placeKey(cur))
  if (i === keys.length - 1) return { pop: 0, replace: next, push: [] }
  // Plus bas : on empile les étages manquants.
  if (i >= 0) return { pop: 0, push: line.slice(i + 1) }
  // Plus haut ou à côté : on redescend jusqu'au parent commun le plus bas, puis on empile.
  for (let j = chain.length - 1; j >= 0; j--) {
    const k = keys.indexOf(chain[j])
    if (k >= 0) return { pop: chain.length - j, push: line.slice(k + 1) }
  }
  // Rien de commun (bilan ouvert directement sur un lieu) : l'entrée actuelle devient la tête de la chaîne.
  return { pop: 0, replace: line[0], push: line.slice(1) }
}
