import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { estimateOf, lineOffsets, linePitches, paddings, storePitches, windowRange, type ListWindow } from '../listWindow'

/*
 * Listes qui défilent sans bouton « Afficher plus » (comme les fils des applis : la suite arrive toute seule).
 *
 * - LoadMore : repère posé au bout d'une liste (données lues par paquets : serveur, journal, ou liste locale montrée par
 *   pages). Quand il approche de l'écran (`ahead` pixels avant, ~10 lignes), la page suivante est demandée ; tant qu'il
 *   reste visible, les pages s'enchaînent. Dans une zone qui défile seule (fenêtre, liste déroulante), c'est elle qui compte.
 *   Sans IntersectionObserver (navigateur ancien) : l'ancien bouton.
 * - Windowed : longue liste locale (liste Joueurs, ajout de joueurs) : toutes les lignes sont dans la liste, mais seules
 *   celles autour de l'écran sont dessinées (~60), avec des marges de la bonne hauteur au-dessus et en dessous. Calculs :
 *   src/listWindow.ts (tools/test-defilement.ts). Sous `threshold` lignes, tout est dessiné.
 */

/** Zone qui défile autour de `el` (fenêtre, liste déroulante, panneau de droite) ; null : la page. */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (!/(auto|scroll|overlay)/.test(s.overflowY)) continue
    // Zone bornée (hauteur maximale) ou qui déborde déjà : c'est elle qui défile ; sinon elle grandit avec la liste.
    if (s.maxHeight !== 'none' || p.scrollHeight > p.clientHeight + 1) return p
  }
  return null
}

const hasIO = typeof IntersectionObserver !== 'undefined'

/**
 * Repère de fin de liste : `onMore` quand il approche (une fois par `at` : nombre de lignes, jours lus… — à chaque nouvelle
 * valeur, il regarde à nouveau s'il est encore près de l'écran). Rien tant que `busy` (lecture en cours) ; rien du tout sans
 * `more`. `children` : petit texte discret dans le repère (« Chargement de la suite… »).
 */
export function LoadMore({
  more,
  onMore,
  at,
  busy = false,
  ahead = 800,
  label = 'Afficher la suite',
  className = 'col-span-full h-px',
  children,
}: {
  more: boolean
  onMore: () => void
  at: unknown
  busy?: boolean
  ahead?: number
  /** Bouton de secours (sans IntersectionObserver). */
  label?: string
  className?: string
  children?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onMore)
  cb.current = onMore
  useEffect(() => {
    const el = ref.current
    if (!el || !hasIO || !more || busy) return
    const obs = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return
        obs.disconnect()
        cb.current()
      },
      { root: scrollParent(el), rootMargin: `0px 0px ${ahead}px 0px` },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [more, busy, ahead, at])
  if (!more) return null
  if (!hasIO)
    return (
      <button type="button" className="btn-ghost col-span-full min-h-11 text-xs" disabled={busy} onClick={onMore}>
        {label}
      </button>
    )
  return (
    <div ref={ref} aria-hidden className={className}>
      {children}
    </div>
  )
}

/** La liste a-t-elle grandi depuis le dernier appel (`n` : nombre de lignes) ? Pour aller plus loin d'un coup quand rien n'arrive. */
export function useGrowth(): (n: number) => boolean {
  const last = useRef(-1)
  return (n) => {
    const grew = n > last.current
    last.current = n
    return grew
  }
}

// ---------- Fenêtre de lignes ----------

/** Mesures d'une liste, gardées d'un passage à l'autre (même clé `cacheKey`) : par disposition (colonnes, largeur). */
interface Layout {
  heights: Map<string, number>
  estimate?: number
}
interface ListCache {
  cols: number
  width: number
  layouts: Map<string, Layout>
}
const caches = new Map<string, ListCache>()
const newCache = (): ListCache => ({ cols: 1, width: 0, layouts: new Map() })
function layoutOf(c: ListCache): Layout {
  const id = `${c.cols}|${Math.round(c.width)}`
  let l = c.layouts.get(id)
  if (!l) {
    // Une autre disposition déjà mesurée : son estimation en attendant les mesures de celle-ci.
    const prev = [...c.layouts.values()].at(-1)
    l = { heights: new Map(), estimate: prev?.estimate }
    c.layouts.set(id, l)
    // Deux dispositions gardées au plus (téléphone tourné, panneau ouvert à côté).
    for (const k of [...c.layouts.keys()].slice(0, -2)) c.layouts.delete(k)
  }
  return l
}

/** Éléments dessinés (un par ligne ; le menu d'une ligne, div.contents, ne compte pas). */
const rowEls = (box: HTMLElement) => [...box.children].filter((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('contents') && !c.hasAttribute('data-wtail'))

/** Colonnes de la grille (.cols : 2 sur grand écran), 1 sinon. */
function colsOf(el: HTMLElement): number {
  const s = getComputedStyle(el)
  if (!s.display.includes('grid')) return 1
  return Math.max(1, s.gridTemplateColumns.split(' ').filter(Boolean).length)
}
const gapOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).rowGap) || 0

/** Éléments dessinés de chaque côté de l'écran, et pas de la fenêtre (en éléments). */
const OVERSCAN = 20
const CHUNK = 10

/**
 * Longue liste dessinée par fenêtre. `items` : toute la liste ; `keyOf` : clé stable (mesures gardées par clé) ;
 * `render` : la ligne (un seul élément de page par ligne, plus éventuellement un div.contents) ; `className` : la boîte
 * des lignes (ex. « cols flex flex-col gap-2 »). `cacheKey` : mesures gardées pour le retour sur la liste (même position).
 * `onRange` : lignes dessinées [start, end[ (la page lit les données des pictogrammes pour elles). `tail` : après les lignes,
 * dans la boîte (message « aucun »…).
 */
export function Windowed<T>({
  items,
  keyOf,
  render,
  className,
  threshold = 200,
  estimate = 64,
  cacheKey,
  onRange,
  tail,
}: {
  items: readonly T[]
  keyOf: (item: T) => string
  render: (item: T, index: number) => ReactNode
  className?: string
  threshold?: number
  estimate?: number
  cacheKey?: string
  onRange?: (start: number, end: number) => void
  tail?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const n = items.length
  const on = n > threshold
  const cache = useMemo(() => {
    if (!cacheKey) return newCache()
    let c = caches.get(cacheKey)
    if (!c) caches.set(cacheKey, (c = newCache()))
    return c
  }, [cacheKey])
  // Disposition (colonnes, largeur) et version des mesures : chaque changement refait les hauteurs.
  const [shape, setShape] = useState(() => ({ cols: cache.cols, width: cache.width }))
  const [ver, setVer] = useState(0)
  const keys = useMemo(() => items.map(keyOf), [items]) // eslint-disable-line react-hooks/exhaustive-deps
  const layout = useMemo(() => {
    cache.cols = shape.cols
    cache.width = shape.width
    return layoutOf(cache)
  }, [cache, shape])
  const offsets = useMemo(
    () => (on ? lineOffsets(keys, shape.cols, layout.heights, layout.estimate ?? estimate) : new Float64Array(1)),
    [on, keys, shape.cols, layout, estimate, ver], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const [range, setRange] = useState<{ start: number; end: number }>({ start: 0, end: Math.min(n, 60) })
  const gap = useRef(0)
  const win: ListWindow = on ? paddings(offsets, n, shape.cols, range.start, range.end, gap.current) : { start: 0, end: n, top: 0, bottom: 0 }

  // Valeurs du dernier rendu, lues par les écouteurs (défilement, tailles).
  const live = useRef({ on, n, keys, offsets, cols: shape.cols, width: shape.width, win, layout })
  live.current = { on, n, keys, offsets, cols: shape.cols, width: shape.width, win, layout }
  // Ligne repère (en haut de l'écran) et sa position : remise au même endroit quand des hauteurs changent au-dessus.
  const anchor = useRef<{ key: string; top: number; at: number } | null>(null)
  const root = useRef<HTMLElement | null | undefined>(undefined)

  const tools = useMemo(() => {
    const scroller = () => {
      if (root.current === undefined && ref.current) root.current = scrollParent(ref.current)
      return root.current ?? null
    }
    const view = () => {
      const r = scroller()
      return r ? { top: r.getBoundingClientRect().top, height: r.clientHeight, at: r.scrollTop } : { top: 0, height: window.innerHeight, at: window.scrollY }
    }
    const visible = (el: HTMLElement) => el.getClientRects().length > 0
    /** Note la première ligne visible (seulement quand la liste a défilé sous le haut de l'écran). */
    const note = () => {
      const box = ref.current
      const L = live.current
      anchor.current = null
      if (!box || !L.on || !visible(box)) return
      const v = view()
      if (box.getBoundingClientRect().top >= v.top) return
      const els = rowEls(box)
      for (let j = 0; j < els.length; j++) {
        const r = els[j].getBoundingClientRect()
        if (r.bottom > v.top) {
          const key = L.keys[L.win.start + j]
          if (key !== undefined) anchor.current = { key, top: r.top - v.top, at: v.at }
          return
        }
      }
    }
    /** La ligne repère a bougé (hauteurs changées au-dessus d'elle) : la page suit, rien ne saute. */
    const keep = () => {
      const a = anchor.current
      const box = ref.current
      const L = live.current
      if (!a || !box || !L.on || !visible(box)) return
      let j = -1
      for (let i = L.win.start; i < L.win.end && j < 0; i++) if (L.keys[i] === a.key) j = i - L.win.start
      const el = j >= 0 ? rowEls(box)[j] : undefined
      if (!el) return
      // Défilement depuis la note (pas encore vu par l'écouteur) : il est voulu, seul le reste est corrigé.
      const v = view()
      const d = el.getBoundingClientRect().top - v.top - (a.top - (v.at - a.at))
      if (Math.abs(d) < 0.5) return
      const r = scroller()
      if (r) r.scrollTop += d
      else window.scrollBy(0, d)
    }
    /** Mesure les lignes dessinées ; vrai si une hauteur a changé. */
    const measure = () => {
      const box = ref.current
      const L = live.current
      if (!box || !L.on || !visible(box)) return false
      const els = rowEls(box)
      if (els.length !== L.win.end - L.win.start) return false
      gap.current = gapOf(box)
      const rects = els.map((e) => e.getBoundingClientRect())
      const pitches = linePitches(
        rects.map((r) => r.top),
        rects.map((r) => r.bottom),
        L.cols,
        gap.current,
      )
      if (L.layout.estimate === undefined && pitches.length) L.layout.estimate = estimateOf(pitches, estimate)
      return storePitches(L.layout.heights, L.keys, L.win.start, L.cols, pitches)
    }
    /** Fenêtre pour la position actuelle. */
    const place = () => {
      const box = ref.current
      const L = live.current
      if (!box || !L.on || !visible(box)) return
      const v = view()
      const t = v.top - box.getBoundingClientRect().top
      const w = windowRange(L.offsets, L.n, L.cols, t, t + v.height, OVERSCAN, CHUNK, gap.current)
      setRange((r) => (r.start === w.start && r.end === w.end ? r : { start: w.start, end: w.end }))
    }
    /** Disposition (colonnes, largeur) ; vrai si elle change (mesures et repère attendent le rendu suivant). */
    const reshape = () => {
      const box = ref.current
      const L = live.current
      if (!box || !visible(box)) return false
      const cols = colsOf(box)
      const width = box.clientWidth
      if (L.cols === cols && Math.abs(L.width - width) < 1) return false
      setShape({ cols, width })
      return true
    }
    return { note, keep, measure, place, reshape }
  }, [estimate])

  // Après chaque rendu, avant la peinture : la page reste sur la même ligne, puis mesures et fenêtre à jour.
  useLayoutEffect(() => {
    if (!on || tools.reshape()) return
    tools.keep()
    if (tools.measure()) setVer((v) => v + 1)
    tools.place()
    tools.note()
  })

  useLayoutEffect(() => {
    onRange?.(win.start, win.end)
  }, [onRange, win.start, win.end])

  useEffect(() => {
    if (!on) return
    const box = ref.current
    if (!box) return
    root.current = scrollParent(box)
    const target: HTMLElement | Window = root.current ?? window
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        tools.note()
        tools.place()
      })
    }
    // Ligne qui change de taille (pictogrammes lus, ligne dépliée, cases de la sélection), largeur de la liste.
    const ro = new ResizeObserver(() => {
      if (tools.reshape()) return
      tools.keep()
      if (tools.measure()) setVer((v) => v + 1)
      tools.note()
    })
    ro.observe(box)
    const watch = new MutationObserver(() => {
      ro.disconnect()
      ro.observe(box)
      for (const el of rowEls(box)) ro.observe(el)
    })
    for (const el of rowEls(box)) ro.observe(el)
    watch.observe(box, { childList: true })
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      watch.disconnect()
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [on, tools])

  const shown = on ? items.slice(win.start, win.end) : items
  return (
    <div
      ref={ref}
      className={className}
      // Marges des lignes non dessinées ; la page se recale elle-même (pas le navigateur : il le ferait deux fois).
      style={on ? { paddingTop: win.top, paddingBottom: win.bottom, overflowAnchor: 'none' } : undefined}
      data-windowed={on ? '' : undefined}
    >
      {shown.map((it, i) => render(it, win.start + i))}
      {tail && (
        <div className="contents" data-wtail>
          {tail}
        </div>
      )}
    </div>
  )
}
