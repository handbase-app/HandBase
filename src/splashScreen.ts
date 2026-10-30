import { deviceEmpty, subscribeSync, syncEnabled, syncSnapshot } from './sync'
import { splashBar, splashDecision, splashText, type SplashSync } from './splash'

/*
 * Écran d'ouverture : posé par index.html avant tout script (logo animé, pas d'écran blanc), piloté ici une fois l'appli
 * chargée. Il couvre l'appli qui démarre dessous (synchro, données) et s'en va selon les règles de src/splash.ts, branchées
 * sur la vraie synchro (src/sync.ts). Une seule fois par lancement : retiré du document à la sortie, jamais remis (ni en
 * changeant d'écran, ni au retour d'arrière-plan).
 *
 * Ne bloque jamais : toute erreur fait entrer dans l'appli, et index.html le retire seul si ce fichier ne prend pas la main.
 */

const SPLASH_THEME = '#0A182D'
/** Appli encore vide derrière (premier affichage pas fini) : on lui laisse au plus ce délai de plus. */
const RENDER_GRACE_MS = 1500
/** La bulle de profil (point de synchro) clignote une fois (classe sur <html>, voir index.css). */
const PULSE_MS = 2400

function syncKind(): SplashSync {
  if (!syncEnabled) return 'none'
  const { state, runs } = syncSnapshot()
  if (state === 'login') return 'login'
  if (state === 'offline' || state === 'error' || state === 'local') return 'none'
  if (state === 'synced' && runs > 0) return 'done'
  return 'pending'
}

export function startSplash() {
  const el = document.getElementById('splash')
  if (!el) return
  const w = window as unknown as { __splash?: boolean; __splashT0?: number }
  w.__splash = true
  // Origine : début de l'animation (posé par index.html juste avant le premier affichage).
  const t0 = typeof w.__splashT0 === 'number' ? w.__splashT0 : 0
  const root = document.getElementById('root')
  const meta = document.querySelector('meta[name="theme-color"]')
  const appTheme = meta?.getAttribute('content') ?? null
  meta?.setAttribute('content', SPLASH_THEME)
  const bar = el.querySelector<HTMLElement>('.sp-bar')
  const fill = el.querySelector<HTMLElement>('.sp-bar i')
  const txt = el.querySelector<HTMLElement>('.sp-txt')
  const btn = el.querySelector<HTMLButtonElement>('.sp-btn')

  const firstLoad = syncEnabled && deviceEmpty()
  let lastActivity = performance.now() - t0
  let skipped = false
  let forced = false
  let gone = false
  let enterAt = 0
  let timer = 0

  const unsubscribe = subscribeSync(() => {
    lastActivity = performance.now() - t0
    tick()
  })

  function leave(pulse: boolean) {
    if (gone) return
    gone = true
    window.clearInterval(timer)
    unsubscribe()
    document.removeEventListener('keydown', onKey, true)
    try {
      if (meta && appTheme) meta.setAttribute('content', appTheme)
      if (root) root.inert = false
      document.documentElement.classList.remove('splash-on')
      el!.classList.add('sp-out')
      el!.setAttribute('aria-busy', 'false')
      // Le focus va à l'appli (contenu principal s'il est là).
      const target = document.querySelector<HTMLElement>('main') ?? root
      if (target) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        target.focus({ preventScroll: true })
      }
      if (pulse) {
        document.documentElement.classList.add('sync-pulse')
        window.setTimeout(() => document.documentElement.classList.remove('sync-pulse'), PULSE_MS)
      }
    } finally {
      window.setTimeout(() => el!.remove(), 500)
    }
  }

  function tick() {
    if (gone) return
    try {
      const now = performance.now() - t0
      const sync = syncKind()
      const { progress, playersReady } = syncSnapshot()
      const d = splashDecision({ elapsed: now, lastActivity, sync, firstLoad, skipped, forced, playersReady })
      const share = splashBar(sync, progress)
      bar?.classList.toggle('sp-wait', share === null)
      if (fill) fill.style.width = share === null ? '' : `${(share * 100).toFixed(1)}%`
      const text = splashText(sync, progress, syncEnabled, navigator.onLine)
      if (txt && txt.textContent !== text) txt.textContent = text
      btn?.classList.toggle('sp-show', d.button)
      el!.title = d.skippable ? 'Toucher pour passer' : ''
      if (!d.enter) return
      // Appli encore vide derrière : on attend son premier affichage, un court instant au plus.
      if (!enterAt) enterAt = now
      if (root && !root.childElementCount && now - enterAt < RENDER_GRACE_MS) return
      leave(d.pulse)
    } catch {
      leave(false)
    }
  }

  const skip = () => {
    skipped = true
    tick()
  }
  function onKey(e: KeyboardEvent) {
    // Entrée sur le bouton « Entrer quand même » : c'est le bouton qui répond.
    if ((e.key === 'Enter' || e.key === 'Escape') && e.target !== btn) {
      e.preventDefault()
      skip()
    }
  }
  el.addEventListener('pointerdown', (e) => {
    if (e.target !== btn) skip()
  })
  document.addEventListener('keydown', onKey, true)
  btn?.addEventListener('click', () => {
    forced = true
    tick()
  })
  try {
    el.focus({ preventScroll: true })
  } catch {
    /* rien */
  }
  timer = window.setInterval(tick, 100)
  tick()
}
