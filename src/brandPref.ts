import { useSyncExternalStore } from 'react'

/**
 * « Afficher le logo et le nom de l'appli » (Réglages → Apparence) : chacun choisit sur son appareil si l'en-tête (téléphone)
 * et le menu de gauche (ordinateur) montrent le logo et le nom. NON par défaut (décidé le 20/10 : qui ouvre l'appli sait
 * comment elle s'appelle) ; « 1 » dans le stockage = les afficher. Gardé dans le stockage de l'appareil ;
 * stockage indisponible (navigation privée) : gardé jusqu'au rechargement. L'écran de connexion, l'écran de démarrage,
 * l'icône de l'appli installée et les exports gardent toujours la marque.
 */
const KEY = 'handbase.showBrand'
let mem: boolean | null = null
const subs = new Set<() => void>()

export function showBrand(): boolean {
  if (mem !== null) return mem
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setShowBrand(on: boolean) {
  mem = on
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // stockage indisponible : la valeur reste en mémoire
  }
  subs.forEach((f) => f())
}

export function useShowBrand(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    showBrand,
    () => false,
  )
}
