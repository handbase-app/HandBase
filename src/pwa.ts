/// <reference types="vite-plugin-pwa/client" />
import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { hasUnsaved } from './components/Confirm'
import { entryAssets, parseAttempt, precacheCaches, repairDecision, versionOf } from './pwaRepair'
import { versionHooks } from './sync'
import { versionCheckDelay } from './syncLive'

/*
 * Mises à jour de l'appli installée : on regarde s'il y a une nouvelle version au retour sur l'appli et
 * toutes les 5 minutes tant qu'elle est ouverte. Elle s'installe en attente : un bandeau propose
 * « Mettre à jour » (un appui, sans fermer l'appli). En arrière-plan, elle se recharge seule si rien
 * n'est en cours de saisie.
 * Nouvelle version annoncée en direct par le serveur (supabase/057, hb_annoncer_version, reçue par src/sync.ts) : on vérifie
 * dans les 30 secondes (étalées entre les appareils) ; les vérifications de fond passent alors à 30 minutes (filet de sécurité).
 * Filet de sécurité (src/pwaRepair.ts) : après une vérification sans version en attente (ou une installation qui échoue),
 * on lit version.json ; si le serveur a plus récent, l'appli se répare (service worker désinstallé, fichiers installés
 * d'avance effacés) et se recharge, aux mêmes moments qu'une mise à jour normale (rien en cours de saisie).
 */

const EVERY = 5 * 60 * 1000
const SLOW_EVERY = 30 * 60 * 1000
let liveNews = false
let lastCheck = 0
/** Les nouvelles versions sont annoncées en direct (src/sync.ts) : vérifications de fond espacées. */
const setLiveVersionNews = (on: boolean) => {
  liveNews = on
}

declare const __BUILD_TIME__: string
/** Date de construction de la version affichée (vite.config.ts). */
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : ''
let registration: ServiceWorkerRegistration | null = null

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

/**
 * « Vérifier les mises à jour » (Réglages) : demande tout de suite au serveur s'il y a une nouvelle version et attend
 * qu'elle soit téléchargée. 'ready' : prête (le bandeau « Mettre à jour » s'affiche aussi) ; 'latest' : à jour. Jamais
 * « à jour » quand version.json du serveur dit plus récent : l'appli se répare et se recharge (appui de la personne et
 * rien en cours de saisie), sinon « Mettre à jour » le fera.
 * manual : appui de la personne (Réglages) ; sinon vérification de fond (annonce du serveur).
 */
export async function checkForUpdate(manual = false): Promise<'ready' | 'latest' | 'offline' | 'unavailable'> {
  if (ready) return 'ready'
  if (!navigator.onLine) return 'offline'
  const reg = registration
  if (!reg) return 'unavailable'
  try {
    await updateAndSettle(reg)
  } catch {
    return 'offline'
  }
  if (ready || reg.waiting) return 'ready'
  if (!(await verify(reg, manual))) return 'latest'
  // Réparation prête : tout de suite si la personne vient de le demander (ou appli en arrière-plan) et rien en cours.
  if (manual ? !hasUnsaved() : safe() && document.visibilityState === 'hidden') applyNow()
  return 'ready'
}

/** reg.update(), puis attend que le nouveau service worker ait fini de s'installer (ou échoué). */
async function updateAndSettle(reg: ServiceWorkerRegistration) {
  lastCheck = Date.now()
  await reg.update()
  const sw = reg.installing
  if (sw)
    await new Promise<void>((done) => {
      const t = window.setTimeout(done, 20_000)
      const end = () => {
        if (sw.state === 'installed' || sw.state === 'redundant' || sw.state === 'activated') {
          window.clearTimeout(t)
          done()
        }
      }
      sw.addEventListener('statechange', end)
      end()
    })
  // onNeedRefresh arrive juste après l'installation : on lui laisse un instant.
  await new Promise((r) => window.setTimeout(r, 300))
}

/** Appui sur « Mettre à jour » : l'appli se recharge sur la nouvelle version. */
export const applyUpdate = () => applyNow()

// ---------- Filet de sécurité : réparer une mise à jour bloquée ----------

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
const REPAIR_KEY = 'handbase.pwaRepair'
/** Version vers laquelle réparer (bandeau affiché, réparation au prochain moment sûr) ; null : rien à réparer. */
let repairTarget: string | null = null
let verifying: Promise<boolean> | null = null

/** Heure de construction de la version du serveur (version.json : ni le service worker ni un cache ne le servent). */
async function serverVersion(): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}version.json?t=${Date.now()}`, { cache: 'no-store' })
    return r.ok ? versionOf(await r.json()) : null
  } catch {
    return null
  }
}

/**
 * La nouvelle version est-elle entière sur le serveur ? Son index.html et ses fichiers de démarrage répondent (copie
 * terminée : sinon le rechargement tomberait sur une page blanche). Redemandés au serveur : un 404 gardé par le
 * navigateur pour l'un d'eux est remplacé au passage.
 */
async function newVersionReachable(): Promise<boolean> {
  try {
    // Paramètre inconnu du service worker : la page vient du serveur, pas des fichiers installés d'avance.
    const r = await fetch(`${BASE}?nextar-verif=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return false
    const urls = entryAssets(await r.text(), BASE)
    if (!urls.length) return false
    const ok = await Promise.all(urls.map((u) => fetch(u, { cache: 'reload' }).then((x) => x.ok, () => false)))
    return ok.every(Boolean)
  } catch {
    return false
  }
}

const lastAttempt = () => {
  try {
    return parseAttempt(localStorage.getItem(REPAIR_KEY))
  } catch {
    return null
  }
}

/**
 * Après une vérification sans version en attente : le serveur a-t-il plus récent ? Si oui (et la nouvelle version est
 * entière sur le serveur), réparation prête : bandeau « Mettre à jour », faite au prochain moment sûr. true : prête.
 */
function verify(reg: ServiceWorkerRegistration, manual: boolean): Promise<boolean> {
  if (repairTarget) return Promise.resolve(true)
  verifying ??= (async () => {
    if (ready || reg.waiting || reg.installing) return false
    const server = await serverVersion()
    const decision = repairDecision({ server, mine: BUILD_TIME, waiting: false, last: lastAttempt(), now: Date.now(), manual })
    if (decision !== 'repair' || !server || !(await newVersionReachable())) return false
    if (ready || reg.waiting) return false // la mise à jour normale est arrivée entre-temps
    repairTarget = server
    setReady(true)
    return true
  })().finally(() => (verifying = null))
  return verifying
}

/**
 * Réparation : service worker de l'appli désinstallé, ses fichiers installés d'avance effacés (caches workbox-precache*
 * seulement : ni la base locale, ni les polices, le lecteur de PDF, SQLite ou la pastille), puis rechargement : la page
 * vient du serveur et le nouveau service worker s'installe à neuf.
 */
async function repairAndReload(target: string) {
  try {
    localStorage.setItem(REPAIR_KEY, JSON.stringify({ target, at: Date.now() }))
  } catch {
    /* stockage indisponible : la réparation se fait quand même */
  }
  try {
    await registration?.unregister()
    for (const k of precacheCaches(await caches.keys())) await caches.delete(k)
  } catch {
    /* on recharge quand même : la page vient du serveur */
  }
  location.reload()
}

/**
 * Nouvelle version annoncée par le serveur (v : son heure de construction, ou un libellé) : vérification dans les 30 s,
 * étalée entre les appareils ; rien si c'est déjà la mienne. Le bandeau « Mettre à jour » suit (onNeedRefresh).
 */
let announced: number | undefined
export function versionAnnounced(v: unknown) {
  const delay = versionCheckDelay(v, BUILD_TIME)
  if (delay === null) return
  window.clearTimeout(announced)
  announced = window.setTimeout(() => void checkForUpdate(), delay)
}
// Formulaires : une saisie peut y attendre sans être signalée (fiche, alerte, groupe, réglages…).
const FORM_PAGE = /\/(nouveau|nouvelle|modifier|mesures)$|\/(evaluer|parametres)$/

const safe = () => !hasUnsaved() && !FORM_PAGE.test(location.pathname)

export function startPwaUpdates() {
  // Annonces du serveur (canal commun, src/sync.ts) : vérification étalée ; vérifications de fond espacées tant que ça marche.
  versionHooks.announced = versionAnnounced
  versionHooks.live = setLiveVersionNews
  if (!('serviceWorker' in navigator)) return
  // Nouvelle version prête (en attente), et nouvelle version déjà active dans un autre onglet.
  let waiting = false
  let reload = false

  const apply = () => {
    if (!safe()) return
    if (repairTarget) void repairAndReload(repairTarget)
    else if (reload) location.reload()
    else if (waiting) {
      waiting = false
      void updateSW(true)
    }
  }

  applyNow = () => {
    setReady(false)
    if (repairTarget) void repairAndReload(repairTarget)
    else if (reload) location.reload()
    else void updateSW(true)
  }

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true
      repairTarget = null // la mise à jour normale est arrivée : pas de réparation
      // Appli en arrière-plan : on peut recharger sans gêner ; sinon le bandeau propose la mise à jour.
      if (document.visibilityState === 'hidden') apply()
      setReady(true)
    },
    onNeedReload() {
      reload = true
      repairTarget = null
      apply()
      setReady(true)
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return
      registration = reg
      // Vérification sans version en attente alors que le serveur a plus récent : réparation (filet de sécurité), faite
      // tout de suite si l'appli est en arrière-plan, sinon bandeau et prochain moment sûr (apply).
      const verifyThenApply = () => void verify(reg, false).then((repair) => repair && document.visibilityState === 'hidden' && apply())
      const check = () => {
        if (!navigator.onLine || reg.installing) return
        void updateAndSettle(reg).then(() => !ready && !reg.waiting && verifyThenApply(), () => undefined)
      }
      // Installation d'une nouvelle version qui échoue (« redundant ») sans rien en attente : on vérifie aussi.
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'redundant' && !reg.waiting) window.setTimeout(() => !reg.installing && verifyThenApply(), 1000)
        })
      })
      // De fond : toutes les 5 minutes ; 30 quand les versions sont annoncées en direct.
      setInterval(() => document.visibilityState === 'visible' && (!liveNews || Date.now() - lastCheck >= SLOW_EVERY) && check(), EVERY)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
        apply()
      })
      // Au démarrage : une version bloquée se voit sans attendre 5 minutes.
      window.setTimeout(check, 15_000)
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
