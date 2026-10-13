import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react'

/*
 * Appui long (téléphone, stylet) et clic droit (ordinateur) sur un élément : ouvre un menu.
 * - appui long : environ 500 ms sans bouger (annulé si le doigt bouge de plus de 10 px, si la page défile,
 *   ou si le navigateur reprend la main : pointercancel) ; petite vibration quand l'appareil sait le faire (Android) ;
 * - clic droit (événement contextmenu, aussi envoyé par Android à l'appui long) : le menu natif est remplacé ;
 * - après un appui long, le clic qui suit le relâchement est ignoré (la ligne ne s'ouvre pas en plus du menu).
 * Les champs de saisie gardent leur comportement natif. Les événements venus d'un portail (menu ouvert,
 * fenêtres) qui remontent par l'arbre React sont ignorés : seuls comptent ceux nés dans l'élément.
 */

export type PressPoint = { x: number; y: number }

const FIELD = 'input, textarea, select, [contenteditable="true"]'
const inside = (e: { currentTarget: EventTarget; target: EventTarget }) => (e.currentTarget as Node).contains(e.target as Node)
const inField = (e: { target: EventTarget }) => !!(e.target as Element).closest?.(FIELD)

export function useLongPress(onLong: (at: PressPoint) => void, { delay = 500, tolerance = 10 } = {}) {
  const press = useRef<{ timer: number; x: number; y: number; id: number } | null>(null)
  // Moment du dernier appui long : le contextmenu qu'Android envoie juste après n'ouvre pas un second menu.
  const fired = useRef(0)
  const cb = useRef(onLong)
  useEffect(() => {
    cb.current = onLong
  })

  const cancel = useCallback(() => {
    if (!press.current) return
    clearTimeout(press.current.timer)
    press.current = null
    window.removeEventListener('scroll', cancel, true)
  }, [])
  useEffect(() => {
    return () => {
      cancel()
    }
  }, [cancel])

  const fire = (at: PressPoint) => {
    fired.current = Date.now()
    swallowNextClick()
    try {
      navigator.vibrate?.(10)
    } catch {
      /* pas de vibration */
    }
    cb.current(at)
  }

  return {
    onPointerDown(e: PointerEvent) {
      fired.current = 0
      if (e.pointerType === 'mouse' || !e.isPrimary || !inside(e) || inField(e)) return
      cancel()
      const at = { x: e.clientX, y: e.clientY }
      const timer = window.setTimeout(() => {
        cancel()
        fire(at)
      }, delay)
      press.current = { timer, ...at, id: e.pointerId }
      window.addEventListener('scroll', cancel, { capture: true, passive: true })
    },
    onPointerMove(e: PointerEvent) {
      const p = press.current
      if (p && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > tolerance) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu(e: MouseEvent) {
      if (!inside(e) || inField(e)) return
      e.preventDefault()
      // Android envoie aussi contextmenu à l'appui long : un seul menu.
      if (Date.now() - fired.current < 1500) return
      const touching = !!press.current
      cancel()
      if (touching) fire({ x: e.clientX, y: e.clientY })
      else cb.current({ x: e.clientX, y: e.clientY })
    },
  }
}

/*
 * Le clic qui suit le relâchement d'un appui long est arrêté au niveau de la fenêtre, avant tout gestionnaire de la page
 * (y compris ceux, en capture, des listes maître-détail qui ouvrent la ligne). Si aucun clic ne vient (iOS), le prochain
 * appui lève le blocage : le toucher suivant (une action du menu…) agit normalement.
 */
function swallowNextClick() {
  const block = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
    done()
  }
  const done = () => {
    window.removeEventListener('click', block, true)
    window.removeEventListener('pointerdown', done, true)
  }
  window.addEventListener('click', block, true)
  window.addEventListener('pointerdown', done, true)
}
