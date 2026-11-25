/*
 * Défilement des longues listes (components/InfiniteList.tsx) : calculs purs, sans page ni React (tools/test-defilement.ts).
 *
 * Une liste de plus de quelques centaines de lignes (liste Joueurs : jusqu'à 40 000 fiches) n'en dessine qu'une fenêtre
 * autour de ce qui est à l'écran ; au-dessus et en dessous, une marge de la hauteur des lignes non dessinées garde la
 * barre de défilement juste. Les lignes vont par rangées (`cols` : 1 sur téléphone, 2 en grille sur grand écran) ; la
 * hauteur d'une rangée est mesurée quand elle est dessinée, estimée sinon (`estimate`). Mesures gardées par élément (clé) :
 * au retour sur la liste, les mêmes hauteurs donnent la même page, et la position notée retombe sur la même ligne.
 */

/** Nombre de rangées pour `count` éléments sur `cols` colonnes. */
export const lineCount = (count: number, cols: number) => (count > 0 ? Math.ceil(count / Math.max(1, cols)) : 0)

/**
 * Haut de chaque rangée (`offsets[i]`, `offsets[lines]` : hauteur totale). Rangée connue : la plus grande mesure de ses
 * éléments (sur deux colonnes, la grille aligne la rangée sur le plus haut) ; inconnue : `estimate`. Chaque hauteur
 * comprend l'écart qui suit la rangée.
 */
export function lineOffsets(keys: readonly string[], cols: number, heights: ReadonlyMap<string, number>, estimate: number): Float64Array {
  const c = Math.max(1, cols)
  const lines = lineCount(keys.length, c)
  const out = new Float64Array(lines + 1)
  for (let l = 0; l < lines; l++) {
    let h = -1
    for (let i = l * c, end = Math.min(keys.length, i + c); i < end; i++) {
      const v = heights.get(keys[i])
      if (v !== undefined && v > h) h = v
    }
    out[l + 1] = out[l] + (h < 0 ? estimate : h)
  }
  return out
}

/** Rangée qui contient la hauteur `y` (comptée depuis le haut de la liste), bornée à la liste. */
export function lineAt(offsets: ArrayLike<number>, y: number): number {
  const lines = offsets.length - 1
  if (lines <= 0) return 0
  if (y <= 0) return 0
  if (y >= offsets[lines]) return lines - 1
  let lo = 0
  let hi = lines - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Fenêtre dessinée : éléments [start, end[ et marges au-dessus (`top`) et en dessous (`bottom`), en pixels. */
export interface ListWindow {
  start: number
  end: number
  top: number
  bottom: number
}

/**
 * Fenêtre pour une vue [viewTop, viewBottom] (pixels depuis le haut de la liste ; négatifs si la liste commence plus bas
 * que le haut de l'écran) : les rangées visibles, plus `overscan` éléments de chaque côté, bornes arrondies à des paquets de
 * `chunk` éléments (la fenêtre ne bouge que tous les `chunk` éléments défilés : on ajoute les 10 suivants, on retire
 * les 10 d'avant). `gap` : écart entre deux rangées (pas d'écart après la dernière dessinée).
 */
export function windowRange(
  offsets: ArrayLike<number>,
  count: number,
  cols: number,
  viewTop: number,
  viewBottom: number,
  overscan = 20,
  chunk = 10,
  gap = 0,
): ListWindow {
  const c = Math.max(1, cols)
  const lines = lineCount(count, c)
  if (!lines) return { start: 0, end: 0, top: 0, bottom: 0 }
  const first = lineAt(offsets, viewTop)
  const last = Math.max(first, lineAt(offsets, viewBottom))
  const over = Math.ceil(overscan / c)
  const step = Math.max(1, Math.ceil(chunk / c))
  const s = Math.max(0, Math.floor((first - over) / step) * step)
  const e = Math.min(lines, Math.ceil((last + 1 + over) / step) * step)
  return paddings(offsets, count, c, s * c, e * c, gap)
}

/** Marges d'une fenêtre [start, end[ déjà choisie (hauteurs mises à jour sans déplacer la fenêtre). */
export function paddings(offsets: ArrayLike<number>, count: number, cols: number, start: number, end: number, gap = 0): ListWindow {
  const c = Math.max(1, cols)
  const lines = lineCount(count, c)
  const s = Math.min(lines, Math.floor(start / c))
  const e = Math.min(lines, Math.max(s, Math.ceil(end / c)))
  return {
    start: s * c,
    end: Math.min(count, e * c),
    top: offsets[s] ?? 0,
    bottom: e < lines ? Math.max(0, offsets[lines] - offsets[e] - gap) : 0,
  }
}

/**
 * Hauteur de chaque rangée dessinée, lue sur la page : `tops` / `bottoms` des éléments dessinés, dans l'ordre. Du haut d'une
 * rangée au haut de la suivante (l'écart compris) ; la dernière : sa hauteur plus `gap`.
 */
export function linePitches(tops: readonly number[], bottoms: readonly number[], cols: number, gap = 0): number[] {
  const c = Math.max(1, cols)
  const lines = lineCount(tops.length, c)
  const top = (l: number) => Math.min(...tops.slice(l * c, l * c + c))
  const out: number[] = []
  for (let l = 0; l < lines; l++) {
    const t = top(l)
    const next = l + 1 < lines ? top(l + 1) : Math.max(...bottoms.slice(l * c, l * c + c)) + gap
    out.push(Math.max(0, next - t))
  }
  return out
}

/**
 * Pose les hauteurs mesurées (une par rangée dessinée, à partir de l'élément `start`) sur les clés de leurs éléments.
 * Rend vrai si quelque chose a changé (au-delà d'un demi-pixel).
 */
export function storePitches(heights: Map<string, number>, keys: readonly string[], start: number, cols: number, pitches: readonly number[]): boolean {
  const c = Math.max(1, cols)
  let changed = false
  pitches.forEach((h, j) => {
    for (let i = start + j * c, end = Math.min(keys.length, i + c); i < end; i++) {
      const old = heights.get(keys[i])
      if (old === undefined || Math.abs(old - h) > 0.5) {
        heights.set(keys[i], h)
        changed = true
      }
    }
  })
  return changed
}

/** Estimation d'une rangée pas encore dessinée : la médiane des premières mesures (`fallback` sans mesure). */
export function estimateOf(pitches: readonly number[], fallback: number): number {
  const v = pitches.filter((h) => h > 0).sort((a, b) => a - b)
  return v.length ? v[v.length >> 1] : fallback
}

/** Premier élément de la rangée à la hauteur `y` (retour sur la liste : quelle ligne est en haut de l'écran). */
export const itemAt = (offsets: ArrayLike<number>, cols: number, y: number) => lineAt(offsets, y) * Math.max(1, cols)

/** Hauteur où commence l'élément `index` (pour y revenir). */
export const offsetOf = (offsets: ArrayLike<number>, cols: number, index: number) => offsets[Math.min(offsets.length - 1, Math.floor(index / Math.max(1, cols)))] ?? 0

/**
 * Fil lu par périodes (Quoi de neuf, Mes suivis) : période suivante quand on approche du bas. 60 jours de plus ; deux fois
 * plus loin si la dernière n'a rien apporté (fil calme : on ne relit pas 60 jours à la fois jusqu'à `max`) ; jamais au-delà de `max`.
 */
export const olderDays = (days: number, grew: boolean, max: number) => Math.min(max, grew ? days + 60 : Math.max(days + 60, days * 2))
