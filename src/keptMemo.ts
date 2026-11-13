/*
 * Calculs gardés en mémoire pour toute l'appli (sans base ni React ; testé : tools/test-bilan-cache.ts).
 *
 * useMemo oublie tout quand l'écran se ferme : revenir sur le bilan (retour d'une fiche, menu) refaisait chaque calcul
 * (carte, générations, clubs, chiffres clés) sur les 40 000 fiches. Ici, chaque calcul nommé garde ses `size` derniers
 * résultats avec leurs entrées : mêmes entrées (mêmes objets, mêmes valeurs : Object.is), même résultat, rendu tel quel.
 * Les entrées sont les données gardées en mémoire (src/coverageCache.ts, src/playersCache.ts : un nouvel objet à chaque
 * relecture de la base) et les choix de l'écran ; une base changée donne donc de nouvelles entrées, et un nouveau calcul.
 */

export type Kept = <T>(name: string, deps: readonly unknown[], fn: () => T) => T

/** Mémoire de calculs : `size` derniers résultats par nom (le plus récent servi d'abord, le plus ancien oublié). */
export function keptMemo(size = 4): Kept & { clear: () => void } {
  const slots = new Map<string, { deps: readonly unknown[]; value: unknown }[]>()
  const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const kept = <T>(name: string, deps: readonly unknown[], fn: () => T): T => {
    let list = slots.get(name)
    if (!list) slots.set(name, (list = []))
    const i = list.findIndex((e) => same(e.deps, deps))
    if (i >= 0) {
      const [hit] = list.splice(i, 1)
      list.unshift(hit)
      return hit.value as T
    }
    const value = fn()
    list.unshift({ deps: [...deps], value })
    if (list.length > size) list.length = size
    return value
  }
  return Object.assign(kept, { clear: () => slots.clear() })
}
