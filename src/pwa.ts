/// <reference types="vite-plugin-pwa/client" />
import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { hasUnsaved } from './components/Confirm'

/*
 * Mises à jour de l'appli installée : on regarde s'il y a une nouvelle version au retour sur l'appli et
 * toutes les 5 minutes tant qu'elle est ouverte. Elle s'installe en attente : un bandeau propose
 * « Mettre à jour » (un appui, sans fermer l'appli). En arrière-plan, elle se recharge seule si rien
 * n'est en cours de saisie.
 */

const EVERY = 5 * 60 * 1000

// Bandeau « nouvelle version » : prête à être appliquée.
let ready = false
const listeners = new Set<() => void>()
const setReady = (v: boolean) => {
  ready = v
  listeners.forEach((l) => l())
}
let applyNow: () => void = () => location.reload()

export function useUpdateReady() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => ready,
  )
}

/** Appui sur « Mettre à jour » : l'appli se recharge sur la nouvelle version. */
export const applyUpdate = () => applyNow()
// Formulaires : une saisie peut y attendre sans être signalée (fiche, alerte, groupe, réglages…).
const FORM_PAGE = /\/(nouveau|nouvelle|modifier|mesures)$|\/(evaluer|parametres)$/

const safe = () => !hasUnsaved() && !FORM_PAGE.test(location.pathname)

export function startPwaUpdates() {
  if (!('serviceWorker' in navigator)) return
  // Nouvelle version prête (en attente), et nouvelle version déjà active dans un autre onglet.
  let waiting = false
  let reload = false

  const apply = () => {
    if (!safe()) return
    if (reload) location.reload()
    else if (waiting) {
      waiting = false
      void updateSW(true)
    }
  }

  applyNow = () => {
    setReady(false)
    if (reload) location.reload()
    else void updateSW(true)
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true
      // Appli en arrière-plan : on peut recharger sans gêner ; sinon le bandeau propose la mise à jour.
      if (document.visibilityState === 'hidden') apply()
      setReady(true)
    },
    onNeedReload() {
      reload = true
      apply()
      setReady(true)
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => {
        if (navigator.onLine && !reg.installing) void reg.update().catch(() => undefined)
      }
      setInterval(() => document.visibilityState === 'visible' && check(), EVERY)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
        apply()
      })
    },
  })

  // Morceau de l'appli introuvable (version remplacée sur le serveur) : on recharge si rien n'est en cours.
  window.addEventListener('vite:preloadError', (e) => {
    const KEY = 'handbase.preloadReload'
    let last = 0
    try {
      last = Number(sessionStorage.getItem(KEY) ?? 0)
      sessionStorage.setItem(KEY, String(Date.now()))
    } catch {
      /* stockage indisponible */
    }
    // Une fois seulement (pas de boucle si le morceau manque vraiment).
    if (!hasUnsaved() && Date.now() - last > 30_000) {
      e.preventDefault()
      location.reload()
    }
  })
}
