/*
 * ÉCRAN GARDÉ ALLUMÉ PENDANT UN GROS CHARGEMENT (Geoffroy, 09/11/2026 : le premier chargement d'un téléphone était coupé
 * par la mise en veille, l'appli web étant mise en pause dès que l'écran s'éteint).
 * API « Screen Wake Lock » (Chrome Android, Safari iOS 16.4+, appli installée comprise) : demandée tant qu'un avancement
 * est affiché (src/sync.ts, setProgress), rendue dès la fin. Le navigateur la retire seul quand l'appli passe en arrière-plan :
 * redemandée au retour si le chargement continue. Navigateur sans cette API, ou refus : rien ne change (le chargement
 * reprend de toute façon là où il s'était arrêté, voir registre.ts).
 */

type Sentinel = { released: boolean; release(): Promise<void>; addEventListener(type: 'release', fn: () => void): void }
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> }
export type WakeEnv = {
  wakeLock?: WakeLockApi
  visible: () => boolean
  onVisible: (fn: () => void) => void
}

/** Gardien de l'écran : want(true) pendant le chargement, want(false) à la fin. Ne lance jamais d'erreur. */
export function createWakeKeeper(env: WakeEnv) {
  let wanted = false
  let lock: Sentinel | null = null
  let pending = false

  async function acquire() {
    if (!env.wakeLock || !wanted || pending || (lock && !lock.released) || !env.visible()) return
    pending = true
    try {
      const s = await env.wakeLock.request('screen')
      s.addEventListener('release', () => {
        if (lock === s) lock = null
      })
      lock = s
      // Chargement fini pendant la demande : rendu tout de suite.
      if (!wanted) await release()
    } catch {
      /* refusé (économie d'énergie, page cachée) : rien */
    } finally {
      pending = false
    }
  }

  async function release() {
    const s = lock
    lock = null
    if (s && !s.released) {
      try {
        await s.release()
      } catch {
        /* déjà rendu */
      }
    }
  }

  env.onVisible(() => void acquire())

  return {
    want(on: boolean) {
      if (on === wanted) return
      wanted = on
      void (on ? acquire() : release())
    },
    /** Pour les essais. */
    held: () => !!lock && !lock.released,
  }
}

function browserEnv(): WakeEnv {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: WakeLockApi }) : undefined
  return {
    wakeLock: nav?.wakeLock,
    visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    onVisible: (fn) => {
      if (typeof document === 'undefined') return
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') fn()
      })
    },
  }
}

let keeper: ReturnType<typeof createWakeKeeper> | null = null

/** Écran gardé allumé (true) ou rendu à la veille normale (false). */
export function keepScreenOn(on: boolean) {
  if (!keeper) {
    if (!on) return
    keeper = createWakeKeeper(browserEnv())
  }
  keeper.want(on)
}
