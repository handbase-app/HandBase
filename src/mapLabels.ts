/*
 * Chiffres posés dans les zones de la carte du bilan (src/components/FranceMap.tsx) : point intérieur d'une zone (pôle
 * d'inaccessibilité, à la manière de « polylabel » de Mapbox, sans dépendance), taille du texte qui tient dans la zone,
 * et couleur du texte (claire ou foncée) selon la luminance du fond. Fonctions pures, testées par tools/test-carte-chiffres.ts.
 * Coordonnées : celles du dessin (repère de la carte, déjà projetées).
 */

export type Pt = [number, number]
/** Polygone : contour extérieur puis trous éventuels. */
export type Poly = Pt[][]

/** Point dans un polygone (pair-impair sur ses anneaux : les trous sont dehors). */
function inPoly(x: number, y: number, poly: Poly): boolean {
  let inside = false
  for (const r of poly)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]
      const [xj, yj] = r[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  return inside
}

/** Point dans la zone (dans l'un de ses polygones : départements d'une région, îles…). */
export function inside(x: number, y: number, polys: readonly Poly[]): boolean {
  return polys.some((p) => inPoly(x, y, p))
}

function segDist2(x: number, y: number, a: Pt, b: Pt) {
  let [px, py] = a
  let dx = b[0] - px
  let dy = b[1] - py
  if (dx || dy) {
    const t = ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy)
    if (t > 1) {
      px = b[0]
      py = b[1]
    } else if (t > 0) {
      px += dx * t
      py += dy * t
    }
  }
  dx = x - px
  dy = y - py
  return dx * dx + dy * dy
}

/**
 * Distance signée au bord de la zone : positive dedans, négative dehors. `edges` : lignes du bord (pour une région, son
 * seul contour, sans les limites entre ses départements).
 */
export function signedDist(x: number, y: number, polys: readonly Poly[], edges: readonly Pt[][]): number {
  let min = Infinity
  for (const l of edges) for (let i = 1; i < l.length; i++) min = Math.min(min, segDist2(x, y, l[i - 1], l[i]))
  return (inside(x, y, polys) ? 1 : -1) * Math.sqrt(min)
}

/**
 * Pôle d'inaccessibilité : le point de la zone le plus éloigné de son bord (centre visuel, toujours dedans, même pour une
 * zone en croissant). Recherche par cellules de plus en plus fines (méthode de polylabel). Renvoie le point et sa distance
 * au bord (rayon du plus grand cercle qui tient dedans).
 */
export function poleOfInaccessibility(polys: readonly Poly[], edges: readonly Pt[][] = polys.flat(), precision = 1): { x: number; y: number; d: number } | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of polys)
    for (const [x, y] of p[0] ?? []) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  if (!Number.isFinite(x0)) return null
  const size = Math.min(x1 - x0, y1 - y0)
  if (size <= 0) return { x: x0, y: y0, d: 0 }
  type Cell = { x: number; y: number; h: number; d: number; max: number }
  const cell = (x: number, y: number, h: number): Cell => {
    const d = signedDist(x, y, polys, edges)
    return { x, y, h, d, max: d + h * Math.SQRT2 }
  }
  // File par potentiel décroissant (tas binaire).
  const heap: Cell[] = []
  const push = (c: Cell) => {
    heap.push(c)
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p].max >= heap[i].max) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l].max > heap[m].max) m = l
        if (r < heap.length && heap[r].max > heap[m].max) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  const h0 = size / 2
  for (let x = x0; x < x1; x += size) for (let y = y0; y < y1; y += size) push(cell(x + h0, y + h0, h0))
  let best = cell((x0 + x1) / 2, (y0 + y1) / 2, 0)
  while (heap.length) {
    const c = pop()
    if (c.d > best.d) best = c
    if (c.max - best.d <= precision) continue
    const h = c.h / 2
    push(cell(c.x - h, c.y - h, h))
    push(cell(c.x + h, c.y - h, h))
    push(cell(c.x - h, c.y + h, h))
    push(cell(c.x + h, c.y + h, h))
  }
  return { x: best.x, y: best.y, d: Math.max(0, best.d) }
}

/** Largeur approchée d'un texte en gras (chiffres, « % »), en unités de sa taille de police. */
export function textWidth(text: string): number {
  let w = 0
  for (const ch of text) w += ch === ' ' || ch === ' ' || ch === ' ' ? (ch === ' ' ? 0.2 : 0.28) : ch === '%' ? 0.85 : ch === ',' || ch === '.' ? 0.3 : 0.62
  return w
}

/**
 * Taille de police (unités de la carte) qui tient dans la zone autour de (x, y) : de `target` jusqu'à `min`, sinon
 * undefined (chiffre masqué ; la bulle le donne). Le cadre du texte (plus une petite marge) doit rester dans la zone.
 */
export function fitFont(
  text: string,
  x: number,
  y: number,
  polys: readonly Poly[],
  target: number,
  min: number,
  /** Largeur réelle du texte (unités de police), mesurée par le navigateur ; sinon estimée. */
  width: (text: string) => number = textWidth,
): number | undefined {
  const w = width(text)
  for (let f = target; ; f = Math.max(min, f * 0.9)) {
    const hw = (w * f) / 2 + f * 0.3
    const hh = f * 0.5
    const pts: Pt[] = [
      [x - hw, y - hh],
      [x, y - hh],
      [x + hw, y - hh],
      [x + hw, y],
      [x + hw, y + hh],
      [x, y + hh],
      [x - hw, y + hh],
      [x - hw, y],
    ]
    if (pts.every(([px, py]) => inside(px, py, polys))) return f
    if (f <= min) return undefined
  }
}

/**
 * Couleur calculée par le navigateur (getComputedStyle) en composantes 0–1 : « rgb(…) », « rgba(…) »,
 * « color(srgb …) » (color-mix), « #rrggbb ». Autre format : null.
 */
export function parseCssColor(s: string): [number, number, number] | null {
  const t = s.trim().toLowerCase()
  let m = t.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/)
  if (m) return [+m[1] / 255, +m[2] / 255, +m[3] / 255]
  m = t.match(/^color\(\s*srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)/)
  if (m) return [+m[1], +m[2], +m[3]].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number]
  m = t.match(/^#([0-9a-f]{6})$/) ?? t.match(/^#([0-9a-f]{3})$/)
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number]
  }
  return null
}

/** Luminance relative (WCAG) d'une couleur sRGB 0–1. */
export function luminance([r, g, b]: readonly [number, number, number]): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Texte posé sur la carte : foncé ou clair, avec un halo de la couleur opposée. */
export const LABEL_INK = {
  dark: { fill: '#0f172a', halo: 'rgba(255,255,255,0.55)' },
  light: { fill: '#ffffff', halo: 'rgba(0,0,0,0.45)' },
} as const
const L_DARK = luminance(parseCssColor(LABEL_INK.dark.fill)!)

/** Encre la plus contrastée sur ce fond (rapport de contraste WCAG avec le blanc ou avec le texte foncé). */
export function inkOn(bg: readonly [number, number, number]): 'dark' | 'light' {
  const l = luminance(bg)
  return (l + 0.05) / (L_DARK + 0.05) >= 1.05 / (l + 0.05) ? 'dark' : 'light'
}

/** Rapport de contraste WCAG entre deux luminances. */
export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
