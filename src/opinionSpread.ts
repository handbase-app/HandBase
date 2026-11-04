/*
 * Écarts entre observateurs sur UN événement (onglet Avis de la fiche, un événement choisi dans le menu, et avis d'un
 * joueur sur la page de l'événement ; src/components/OpinionsSpread.tsx) : pour chaque critère, de la note la plus basse
 * à la plus haute des observateurs (chacun : la moyenne de ses avis sur l'événement), et la moyenne des observateurs.
 * Seuils décidés (04/11) sur l'écart (max − min) : moins de 1,5 : accord ; de 1,5 à moins de 2,5 : écart ; 2,5 et plus :
 * gros écart. Critères rangés du plus gros écart au plus petit (les sujets à discuter en staff d'abord). Pour le staff
 * seulement : rien de tout cela côté jeune.
 * Fonctions pures (test : npx jiti tools/test-ecarts-avis.ts).
 */

/** Écart (max − min) à partir duquel les observateurs ne sont plus d'accord (« écart »)… */
export const SPREAD_GAP = 1.5
/** … et à partir duquel c'est un « gros écart ». */
export const SPREAD_BIG = 2.5

export type SpreadLevel = 'accord' | 'ecart' | 'gros'
export const SPREAD_WORD: Record<SpreadLevel, string> = { accord: 'accord', ecart: 'écart', gros: 'gros écart' }
/** Couleurs des niveaux (jetons de src/index.css) : gris, orange d'avertissement, rouge. */
export const SPREAD_COLOR: Record<SpreadLevel, string> = { accord: 'var(--color-muted)', ecart: 'var(--color-warn)', gros: 'var(--color-loss)' }
/** Légende : les trois niveaux, avec leurs seuils. */
export const SPREAD_LEGEND: { level: SpreadLevel; name: string }[] = [
  { level: 'accord', name: 'Accord (écart < 1,5)' },
  { level: 'ecart', name: 'Écart (1,5 à 2)' },
  { level: 'gros', name: 'Gros écart (2,5 et plus)' },
]

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
