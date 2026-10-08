/*
 * « Voir comme… » (outil administrateur) : l'appli se comporte comme pour un autre membre du staff (son rôle, son
 * secteur, son identité pour « mes avis », ses groupes et staffs visibles), en lecture seule.
 * C'est une simulation sur l'appareil de l'administrateur : elle n'utilise que les données que lui-même reçoit du
 * serveur (les groupes privés, « Mon staff », staffs et suivis des autres ne lui sont jamais envoyés).
 * Gardée pour l'onglet en cours seulement (sessionStorage) : fermer l'appli y met fin.
 * Module sans dépendance : utilisé par roles.ts, db.ts et ui.tsx.
 */

export interface SpyTarget {
  uid: string
  role: 'admin' | 'preparateur' | 'observateur'
  departments: string[]
  name: string
}

const KEY = 'handbase.spy'
const DEV_KEY = 'handbase.devtools'

let target: SpyTarget | null = (() => {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SpyTarget) : null
  } catch {
    return null
  }
})()

/** Membre simulé, ou null. */
export const spyTarget = () => target

/** Commence ou arrête la simulation, puis recharge l'appli : tous les écrans repartent avec la nouvelle identité. */
export function setSpy(t: SpyTarget | null) {
  target = t
  try {
    if (t) sessionStorage.setItem(KEY, JSON.stringify(t))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* stockage indisponible */
  }
  window.location.assign(import.meta.env.BASE_URL)
}

/** Fin de la simulation sans recharger (déconnexion). */
export function clearSpy() {
  target = null
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* stockage indisponible */
  }
}

/** Outils administrateur affichés (interrupteur de Réglages, gardé sur l'appareil). */
export function devToolsOn() {
  try {
    return localStorage.getItem(DEV_KEY) === '1'
  } catch {
    return false
  }
}
export function setDevTools(on: boolean) {
  try {
    if (on) localStorage.setItem(DEV_KEY, '1')
    else localStorage.removeItem(DEV_KEY)
  } catch {
    /* stockage indisponible */
  }
}

/** Écriture refusée pendant la simulation. */
export class ReadOnlyError extends Error {
  constructor() {
    super('Lecture seule : vous voyez l’appli comme un autre membre.')
    this.name = 'ReadOnlyError'
  }
}

/** Appelé par save(), saveMany() et remove() : pendant la simulation, rien n'est écrit (le bandeau le signale). */
export function guardWrite() {
  if (!target) return
  window.dispatchEvent(new Event('handbase:readonly'))
  throw new ReadOnlyError()
}

// Une écriture bloquée interrompt l'action en cours : ce n'est pas une erreur à signaler dans la console.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e) => {
    if (e.reason instanceof ReadOnlyError) e.preventDefault()
  })
}
