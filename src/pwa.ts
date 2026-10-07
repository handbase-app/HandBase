/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register'
import { hasUnsaved } from './components/Confirm'

/*
 * Mises à jour de l'appli installée : on regarde s'il y a une nouvelle version au retour sur l'appli et
 * toutes les heures. Elle s'installe en attente ; l'appli ne se recharge que si rien n'est en cours de
 * saisie (sinon elle sera prise au prochain lancement, ou au prochain moment sans saisie).
 */

const HOUR = 3600 * 1000
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

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true
      // Appli en arrière-plan : on peut recharger sans gêner ; sinon au prochain départ ou retour.
      if (document.visibilityState === 'hidden') apply()
    },
    onNeedReload() {
      reload = true
      apply()
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return
      const check = () => {
        if (navigator.onLine && !reg.installing) void reg.update().catch(() => undefined)
      }
      setInterval(check, HOUR)
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
