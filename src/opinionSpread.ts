/*
 * Écarts entre observateurs sur UN événement (onglet Avis de la fiche, un événement choisi dans le menu, et avis d'un
 * joueur sur la page de l'événement ; src/components/OpinionsSpread.tsx) : pour chaque critère, de la note la plus basse
 * à la plus haute des observateurs (chacun : la moyenne de ses avis sur l'événement), et la moyenne des observateurs.
 * Seuils décidés (04/11) sur l'écart (max − min) : moins de 1,5 : accord ; de 1,5 à moins de 2,5 : écart ; 2,5 et plus :
 * gros écart (mots du texte et du bandeau) ; couleur continue selon l'écart, de l'orange clair (1,5) au rouge franc (4).
 * Critères rangés du plus gros écart au plus petit (les sujets à discuter en staff d'abord). Pour le staff
 * seulement : rien de tout cela côté jeune.
 * Fonctions pures (test : npx jiti tools/test-ecarts-avis.ts).
 */

/** Écart (max − min) à partir duquel les observateurs ne sont plus d'accord (« écart »)… */
export const SPREAD_GAP = 1.5
/** … et à partir duquel c'est un « gros écart ». */
export const SPREAD_BIG = 2.5

export type SpreadLevel = 'accord' | 'ecart' | 'gros'
export const SPREAD_WORD: Record<SpreadLevel, string> = { accord: 'accord', ecart: 'écart', gros: 'gros écart' }
/** Accord : gris discret (mot du niveau, bande des petites lignes). */
export const SPREAD_ACCORD = 'var(--color-muted)'
/** Écart maximal sur une échelle 1 à 5 : la teinte la plus rouge, la plus opaque. */
export const SPREAD_MAX = 4

/**
 * « Plus l'écart est grand, plus c'est rouge » (05/11) : intensité de 0 (écart de 1,5) à 1 (écart de 4), continue ;
 * null sous 1,5 (accord : pas de couleur).
 */
export function spreadHeat(gap: number): number | null {
  const g = r2(gap)
  if (g < SPREAD_GAP) return null
  return Math.min(1, (g - SPREAD_GAP) / (SPREAD_MAX - SPREAD_GAP))
}

/**
 * Couleur d'un écart (bande du radar, bande des lignes, mot du niveau) : de l'orange clair (--color-spread-lo) au rouge
 * franc (--color-spread-hi, jetons de src/index.css, clairs et sombres) ; null sous 1,5.
 */
export function spreadColor(gap: number): string | null {
  const h = spreadHeat(gap)
  if (h === null) return null
  const pct = Math.round(h * 100)
  return pct <= 0 ? 'var(--color-spread-lo)' : pct >= 100 ? 'var(--color-spread-hi)' : `color-mix(in oklab, var(--color-spread-hi) ${pct}%, var(--color-spread-lo))`
}

/** Opacité d'une bande : de plus en plus opaque avec l'écart (0,45 à 1,5 → 0,9 à 4). */
export const spreadOpacity = (gap: number) => 0.45 + 0.45 * (spreadHeat(gap) ?? 0)

/** Couleur du texte d'un écart (accord, une seule note : gris). */
export const spreadTextColor = (s: Spread) => (s.n > 1 && spreadColor(s.gap)) || SPREAD_ACCORD

/** Petite légende en dégradé (« petit écart → gros écart »). */
export const SPREAD_GRADIENT = 'linear-gradient(90deg, var(--color-spread-lo), var(--color-spread-hi))'

export interface Spread {
  /** Note la plus basse et la plus haute des observateurs (null : personne n'a noté). */
  lo: number | null
  hi: number | null
  /** Moyenne des observateurs. */
  avg: number | null
  /** hi − lo (0 avec une seule note). */
  gap: number
  level: SpreadLevel
  /** Nombre d'observateurs qui ont noté. */
  n: number
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
// Au centième : 3,7 − 2,2 ne doit pas tomber sous 1,5 par une erreur d'arrondi.
const r2 = (x: number) => Math.round(x * 100) / 100

/** Niveau d'un écart (seuils 1,5 et 2,5). */
export function spreadLevel(gap: number): SpreadLevel {
  const g = r2(gap)
  return g >= SPREAD_BIG ? 'gros' : g >= SPREAD_GAP ? 'ecart' : 'accord'
}

/** Écart d'un critère, d'après la note de chaque observateur (null : pas noté par lui). */
export function spreadOf(vals: readonly (number | null | undefined)[]): Spread {
  const v = vals.filter(isNum)
  if (!v.length) return { lo: null, hi: null, avg: null, gap: 0, level: 'accord', n: 0 }
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  const gap = r2(hi - lo)
  return { lo, hi, avg: mean(v), gap, level: spreadLevel(gap), n: v.length }
}

/**
 * Écart d'une famille (vue « Par famille » du radar) : pour chaque observateur, la moyenne de ses notes sur les critères
 * de la famille ; puis l'écart entre ces moyennes. `rows` : un tableau par critère, une note par observateur.
 */
export function familySpread(rows: readonly (readonly (number | null | undefined)[])[]): Spread {
  const n = Math.max(0, ...rows.map((r) => r.length))
  return spreadOf(Array.from({ length: n }, (_, o) => mean(rows.map((r) => r[o]).filter(isNum))))
}

/** Couleur d'une bande (radar) : sujet à discuter seulement, sinon rien. */
export const bandColor = (s: Spread) => (toDiscuss(s) ? spreadColor(s.gap) : null)

/** Sujet à discuter : au moins deux notes, et un écart (1,5 et plus). */
export const toDiscuss = (s: Spread) => s.n > 1 && s.level !== 'accord'

/** Du plus gros écart au plus petit ; à écart égal, l'ordre de départ (celui de la fiche). */
export function bySpread<T>(items: readonly T[], sp: (t: T) => Spread): T[] {
  return items
    .map((t, i) => ({ t, i, g: sp(t).gap }))
    .sort((a, b) => b.g - a.g || a.i - b.i)
    .map((x) => x.t)
}

/** « 3 critères à discuter : Efficacité au tir, Engagement, Duel 1 contre 1 » (aucun : null). */
export function spreadSummary(labels: readonly string[]): string | null {
  if (!labels.length) return null
  return `${labels.length} critère${labels.length > 1 ? 's' : ''} à discuter : ${labels.join(', ')}`
}

/** Note au demi-point près, virgule (« 3,5 »). */
const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',')

/**
 * Libellés d'un écart. `range` : « 1 à 5 » (une seule note, ou tous pareil : « 4 ») ; `label` : sous le libellé d'un axe
 * du radar (« 1 à 5 · gros écart », « 4 · accord », une seule note : « 3 · une note ») ; `word` : « gros écart » ;
 * `stats` : dans les petites lignes (« moy. 3,0 · écart 4 »).
 */
export function spreadWords(s: Spread): { range: string; label: string; word: string; stats: string } {
  if (s.lo === null || s.hi === null || s.avg === null) return { range: '', label: '', word: '', stats: '' }
  const range = s.lo === s.hi ? fmt(s.lo) : `${fmt(s.lo)} à ${fmt(s.hi)}`
  const word = s.n < 2 ? 'une note' : SPREAD_WORD[s.level]
  const moy = `moy. ${s.avg.toFixed(1).replace('.', ',')}`
  return { range, label: `${range} · ${word}`, word, stats: s.n < 2 ? `${moy} · une note` : `${moy} · écart ${fmt(s.gap)}` }
}

/**
 * Repères qui tombent sur la même note : décalage de chacun (en « crans », centré sur 0) pour qu'ils restent tous
 * visibles côte à côte (deux à 4 : −0,5 et +0,5 ; trois : −1, 0, +1). Pas de note : 0.
 */
export function sameNoteOffsets(vals: readonly (number | null | undefined)[]): number[] {
  const groups = new Map<number, number[]>()
  vals.forEach((v, i) => {
    if (!isNum(v)) return
    const k = Math.round(v * 100)
    groups.set(k, [...(groups.get(k) ?? []), i])
  })
  const out = vals.map(() => 0)
  for (const idx of groups.values()) idx.forEach((i, j) => (out[i] = j - (idx.length - 1) / 2))
  return out
}

/** Forme du repère de chaque observateur (avec sa couleur : deux observateurs ne se confondent jamais). */
export const MARK_SHAPES = ['circle', 'square', 'diamond', 'triangle', 'triangleDown'] as const
export type MarkShape = (typeof MARK_SHAPES)[number]
export const markShapeOf = (i: number): MarkShape => MARK_SHAPES[i % MARK_SHAPES.length]
