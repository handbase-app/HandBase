import { useSyncExternalStore } from 'react'

/**
 * « Afficher la flèche de retour » (Réglages → Apparence, 31/10) : petite flèche ← dans l'en-tête, sur les écrans qui ne
 * sont pas un onglet du menu (sur ordinateur, l'appli installée n'a pas de bouton retour du navigateur ; sur iPhone, le
 * geste ne part que du bord gauche). OUI par défaut ; chacun peut la masquer sur son appareil (« 0 » dans le stockage).
 * Stockage indisponible (navigation privée) : gardé jusqu'au rechargement.
 */
const KEY = 'handbase.backArrow'
let mem: boolean | null = null
const subs = new Set<() => void>()

export function showBackArrow(): boolean {
  if (mem !== null) return mem
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

export function setShowBackArrow(on: boolean) {
  mem = on
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, '0')
  } catch {
    // stockage indisponible : la valeur reste en mémoire
  }
  subs.forEach((f) => f())
}

export function useShowBackArrow(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    showBackArrow,
    () => true,
  )
}
