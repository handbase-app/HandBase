import { useLayoutEffect, useRef, type TouchEvent } from 'react'

/*
 * Glisser pour changer de joueur : vers la gauche, le suivant ; vers la droite, le précédent. Un seul geste partout
 * (choix du 30/10) : écran de notation (src/pages/Evaluate.tsx) et fiche ouverte depuis une liste sur téléphone
 * (ContextBar, src/components/ContextRoster.tsx).
 * - La fiche elle-même suit le doigt, n'importe où dessus ; le sens se décide dès que le doigt a bougé de 8 px :
 *   vertical = défilement normal, on laisse faire ; horizontal seulement s'il l'est nettement (|dx| > 1,2 × |dy|).
 * - Au lâcher : au-delà de 28 % de la largeur (ou geste vif : > 0,5 px/ms et > 30 px), elle sort sur le côté (0,16 s)
 *   et le joueur suivant arrive de l'autre côté (animate-slide-left / -right, src/index.css) ; sinon elle revient en place.
 * - Résistance au bout de la liste (pas de joueur de ce côté) : la fiche ne suit qu'au quart.
 * - Ignoré dans un champ (input, textarea, select), sur [data-noswipe], dans une zone qui défile de côté (elle garde son
 *   geste) et pour ce qui vient d'un portail (menus, fenêtres ouvertes par-dessus, qui remontent par l'arbre React).
 * - « Réduire les animations » : pas de sortie ni d'arrivée animées (la fiche suit quand même le doigt).
 * - `hold()` vrai (saisie pas enregistrée) : la fiche revient en place et la question est posée par `go` avant de partir.
 * - `go(id)` renvoie false si l'on reste (question « Rester ») : la fiche revient en place.
 * Mise en place : `useSwipeNav(idAffiché)` avant tout retour anticipé (règle des hooks), puis `nav.handlers({…})` une fois
 * le joueur précédent / suivant connu ; `nav.cardRef` sur l'élément qui bouge, `{...handlers}` sur la zone qui écoute.
 */

type Dir = 'left' | 'right'
type Opts = { enabled: boolean; prev?: string; next?: string; go: (id: string) => unknown; hold?: () => boolean }

const SLIDE: Record<Dir, string> = { left: 'animate-slide-left', right: 'animate-slide-right' }

/** Élément entre `from` et `to` (exclu) qui défile de côté : le geste lui revient. */
function inSideScroller(from: Element, to: Element) {
  for (let el: Element | null = from; el && el !== to; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true
  }
  return false
}

/**
 * `current` : joueur affiché. `ready(fiche, id)` : la fiche de `id` est-elle affichée ? (contenu chargé à part, comme
 * PlayerDetail : l'arrivée attend, 0,6 s au plus, pour ne pas faire glisser l'ancien joueur ni « Chargement… »).
 */
export function useSwipeNav(current: string | undefined, { ready }: { ready?: (card: HTMLElement, id: string) => boolean } = {}) {
  // Glissement en cours : départ du doigt, et sens décidé (horizontal = on fait glisser la fiche).
  const swipe = useRef<{ x: number; y: number; t: number; horizontal?: boolean; dx: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // Joueur qui arrive après un glissement (ou une flèche), et de quel côté : seule sa fiche s'anime.
  const enter = useRef<{ id: string; dir: Dir } | null>(null)
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const setCard = (x: number, transition = '', opacity = 1) => {
    const el = cardRef.current
    if (!el) return
    el.style.transition = transition
    el.style.transform = x ? `translateX(${x}px)` : ''
    el.style.opacity = opacity === 1 ? '' : String(opacity)
  }
  const springBack = () => setCard(0, 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)')

  // Arrivée du nouveau joueur : remise en place, animation venue du côté opposé au geste, et retour en haut de sa fiche
  // si on était descendu plus bas.
  useLayoutEffect(() => {
    const e = enter.current
    const el = cardRef.current
    if (!e || e.id !== current || !el) return
    enter.current = null
    const t0 = performance.now()
    let timer = 0
    let waiting = false
    const start = () => {
      // Minuterie plutôt qu'images (requestAnimationFrame s'arrête quand la page est cachée : la fiche resterait invisible).
      if (ready && !ready(el, e.id) && performance.now() - t0 < 600) {
        waiting = true
        timer = window.setTimeout(start, 16)
        return
      }
      waiting = false
      setCard(0)
      el.classList.remove(SLIDE.left, SLIDE.right)
      if (!reduceMotion) {
        void el.offsetWidth // relance l'animation (même élément d'un joueur à l'autre)
        el.classList.add(SLIDE[e.dir])
        const end = (ev: AnimationEvent) => {
          if (ev.target !== el) return
          el.classList.remove(SLIDE[e.dir])
          el.removeEventListener('animationend', end)
        }
        el.addEventListener('animationend', end)
      }
      const top = el.getBoundingClientRect().top
      if (top < 0) window.scrollBy({ top: top - 80 })
    }
    start()
    return () => {
      clearTimeout(timer)
      if (waiting) setCard(0)
    }
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Passe au joueur `id` : la fiche actuelle sort du côté `dir`, la nouvelle arrive de l'autre côté. */
  async function change(o: Opts, id: string, dir: Dir) {
    if (o.hold?.()) {
      // Saisie pas enregistrée : la fiche revient en place, la question est posée (et « Rester » ne bouge rien).
      springBack()
      enter.current = { id, dir }
      return void o.go(id)
    }
    if (!reduceMotion && cardRef.current) {
      const w = cardRef.current.offsetWidth
      setCard(dir === 'left' ? -w : w, 'transform 0.16s ease-in, opacity 0.16s ease-in', 0)
      await new Promise((r) => setTimeout(r, 160))
    }
    enter.current = { id, dir }
    if ((await o.go(id)) === false) {
      enter.current = null
      springBack()
    }
  }

  /** Gestes de la zone qui écoute, et `change` (mêmes sortie et arrivée pour des flèches). */
  function handlers(o: Opts) {
    const onTouchStart = (e: TouchEvent) => {
      const el = e.target as HTMLElement
      swipe.current =
        !o.enabled ||
        !(e.currentTarget as Node).contains(el) ||
        el.closest('input, textarea, select, [data-noswipe]') ||
        inSideScroller(el, e.currentTarget as Element)
          ? null
          : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dx: 0 }
    }
    const onTouchMove = (e: TouchEvent) => {
      const s = swipe.current
      if (!s) return
      const dx = e.touches[0].clientX - s.x
      const dy = e.touches[0].clientY - s.y
      // On décide du sens dès que le doigt a un peu bougé : vertical = défilement normal, on laisse faire.
      if (s.horizontal === undefined) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        s.horizontal = Math.abs(dx) > Math.abs(dy) * 1.2
        if (!s.horizontal) return void (swipe.current = null)
      }
      // Résistance au bout de la liste (pas de joueur de ce côté).
      s.dx = (dx < 0 && !o.next) || (dx > 0 && !o.prev) ? dx * 0.25 : dx
      setCard(s.dx)
    }
    const onTouchEnd = () => {
      const s = swipe.current
      swipe.current = null
      if (!s?.horizontal) return
      const w = cardRef.current?.offsetWidth ?? 360
      const speed = Math.abs(s.dx) / Math.max(1, Date.now() - s.t) // px/ms
      const target = s.dx < 0 ? o.next : o.prev
      if (target && (Math.abs(s.dx) > w * 0.28 || (speed > 0.5 && Math.abs(s.dx) > 30))) void change(o, target, s.dx < 0 ? 'left' : 'right')
      else springBack()
    }
    return {
      touch: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: () => ((swipe.current = null), springBack()) },
      change: (id: string, dir: Dir) => change(o, id, dir),
    }
  }

  return { cardRef, handlers }
}
