import type { Evaluation, EventType, HBEvent } from './db'

/*
 * Progression des avis d'un joueur (onglet Avis de la fiche, vue « Progression », src/components/OpinionsProgress.tsx) :
 * la moyenne de tous les avis dans le temps ne veut rien dire (1 il y a un an, 5 aujourd'hui → 3), on montre le chemin
 * parcouru entre deux crans d'une frise.
 *  - Crans : les avis rangés par date, regroupés par événement (hors événement : par jour) ; notes d'un cran moyennées
 *    critère par critère (d'abord par observateur, pour qu'aucun ne pèse plus que les autres).
 *  - Note d'un critère à un cran : celle du cran, sinon la dernière connue avant (report) ; avant sa première note, rien.
 *  - Couleur : l'arrivée comparée au départ (jamais au plus haut ou au plus bas du chemin) ; « a varié ↕ » quand l'écart
 *    est petit (< 1) mais le chemin a bougé (amplitude ≥ 1,5) ; « dernier avis … » quand le dernier pas va dans l'autre
 *    sens que l'écart total. Côté jeune, jamais de baisse affichée : neutre.
 * Fonctions pures (test : npx jiti tools/test-progression-avis.ts).
 */

/** Un cran de la frise : un événement, ou les avis hors événement d'un même jour. */
export interface ProgressStep {
  key: string
  date: string
  /** Nom pour la phrase « Du … au … » (événement, ou « l’avis spontané »). */
  name: string
  /** Type, en court, sous le mois sur la frise (« Tournoi », « Match », « Vidéo »…). */
  tag: string
  eventId?: string
  /** Nombre d'avis du cran. */
  count: number
  /** Note moyenne du cran, par critère (seulement les critères notés à ce cran). */
  scores: Record<string, number>
}

/** Type d'événement, en court, pour la frise. */
export const STEP_TAG: Record<EventType, string> = { match: 'Match', tournoi: 'Tournoi', entrainement: 'Entraîn.', observation: 'Observ.' }
const SPONTANEOUS = 'l’avis spontané'

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)

/** Crans de la frise, du plus ancien au plus récent (avis déjà choisis : validés, et en attente si on les inclut). */
export function progressSteps(evals: readonly Evaluation[], events: readonly HBEvent[]): ProgressStep[] {
  const groups = new Map<string, Evaluation[]>()
  for (const e of evals) {
    if (!Object.values(e.scores).some((v) => typeof v === 'number')) continue
    const k = e.eventId ? `ev:${e.eventId}` : `jour:${e.date}`
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  const steps: ProgressStep[] = []
  for (const [key, list] of groups) {
    const first = [...list].sort((a, b) => a.date.localeCompare(b.date))[0]
    const ev = first.eventId ? events.find((x) => x.id === first.eventId) : undefined
    // Par observateur d'abord, puis moyenne des observateurs.
    const byObs = new Map<string, Evaluation[]>()
    for (const e of list) byObs.set(e.observer, [...(byObs.get(e.observer) ?? []), e])
    const ids = [...new Set(list.flatMap((e) => Object.keys(e.scores).filter((k) => typeof e.scores[k] === 'number')))]
    const scores: Record<string, number> = {}
    for (const id of ids) {
      const perObs = [...byObs.values()].map((es) => mean(es.map((e) => e.scores[id]).filter((v): v is number => typeof v === 'number'))).filter((v): v is number => v !== null)
      const m = mean(perObs)
      if (m !== null) scores[id] = m
    }
    const types = [...new Set(list.map((e) => e.contextType))]
    steps.push({
      key,
      date: ev?.date ?? first.date,
      name: first.eventId ? (ev ? ev.name : 'Événement inconnu') : SPONTANEOUS,
      tag: ev ? STEP_TAG[ev.type] ?? 'Événement' : first.eventId ? 'Événement' : types.length === 1 && types[0] === 'video' ? 'Vidéo' : 'Spontané',
      eventId: first.eventId,
      count: list.length,
      scores,
    })
  }
  return steps.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
}

/** Note d'un critère à chaque cran : celle du cran, sinon la dernière connue avant ; null avant la première. */
export function carried(steps: readonly ProgressStep[], id: string): (number | null)[] {
  let last: number | null = null
  return steps.map((s) => (last = s.scores[id] ?? last))
}

/** Note au cran `t` (fractionnaire pendant ▶ Rejouer : entre deux crans, en continu). Pas encore notée : null. */
export function valueAt(h: readonly (number | null)[], t: number): number | null {
  if (!h.length) return null
  const i = Math.max(0, Math.floor(t))
  if (i >= h.length - 1) return h[h.length - 1]
  const a = h[i]
  const b = h[i + 1]
  const f = t - i
  if (f <= 0 || b === null) return a
  if (a === null) return null
  return a + (b - a) * f
}

const r1 = (x: number) => Math.round(x * 10) / 10

export interface Delta {
  /** Note au départ (null : pas encore notée) et à l'arrivée. */
  a: number | null
  b: number | null
  /** Écart arrivée − départ, arrondi au dixième (null : pas de départ). */
  d: number | null
  /** Écart petit (< 1) mais chemin agité (amplitude ≥ 1,5) : « a varié ↕ ». */
  yoyo: boolean
  /** Dernier pas, quand il va dans l'autre sens que l'écart total (« dernier avis −1 »). */
  last: number | null
}

/** Écart d'un critère entre le cran de départ `s` et l'arrivée `t` (fractionnaire pendant l'animation). */
export function deltaOf(h: readonly (number | null)[], s: number, t: number): Delta {
  const a = h[s] ?? null
  const b = valueAt(h, t)
  if (a === null || b === null) return { a, b, d: null, yoyo: false, last: null }
  const d = r1(b - a)
  const path = [...h.slice(s, Math.floor(t) + 1), b].filter((v): v is number => v !== null)
  const span = Math.max(...path) - Math.min(...path)
  const yoyo = Math.abs(d) < 1 && span >= 1.5
  let last: number | null = null
  const ti = Math.floor(t)
  if (t === ti && ti - 1 >= s) {
    const p = h[ti - 1]
    const q = h[ti]
    if (p !== null && q !== null) {
      const ld = r1(q - p)
      if (ld !== 0 && Math.sign(ld) !== Math.sign(d)) last = ld
    }
  }
  return { a, b, d, yoyo, last }
}

export type Tone = 'up' | 'down' | 'flat'
/** Couleur d'une note de progression : gagné, perdu, neutre (jetons de src/index.css). */
export const TONE_COLOR: Record<Tone, string> = { up: 'var(--color-gain)', down: 'var(--color-loss)', flat: 'var(--color-muted)' }

/** Couleur : vert au-dessus du départ, rouge en dessous, gris égal ou « a varié ». Jeune : jamais de rouge. */
export function toneOf(x: Delta, young = false): Tone {
  if (x.d === null || x.yoyo) return 'flat'
  if (x.d > 0) return 'up'
  if (x.d < 0) return young ? 'flat' : 'down'
  return 'flat'
}

/** Note au dixième, virgule (« 3,5 »). */
export const fmtNote = (v: number | null | undefined) => (typeof v === 'number' ? String(r1(v)).replace('.', ',') : '—')
/** Écart signé (« +2,5 », « −1 »). */
export const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNote(Math.abs(v))

/**
 * Libellés d'un écart. `short` : sous le libellé d'un axe du radar (« 1 → 4 ↗ ») ; `range` : le même pour la bulle ;
 * `gap` : dans les petites lignes (« +2,5 ↗ », « stable », « a varié ↕ ») ; `lastStep` : « dernier avis −1 ».
 * Jeune : une baisse n'a ni flèche ↘ ni « dernier avis » négatif.
 */
export function deltaWords(x: Delta, young = false): { short: string; range: string; gap: string; lastStep: string | null } {
  if (x.b === null) return { short: '', range: '', gap: '', lastStep: null }
  if (x.a === null || x.d === null) return { short: fmtNote(x.b), range: `${fmtNote(x.b)} (pas encore noté au départ)`, gap: 'nouveau', lastStep: null }
  const arrow = x.yoyo ? ' ↕' : x.d > 0 ? ' ↗' : x.d < 0 && !young ? ' ↘' : ''
  const ab = `${fmtNote(x.a)} → ${fmtNote(x.b)}`
  // Jeune : une baisse n'est pas chiffrée (aucun « −1 »), seulement les deux notes, en neutre.
  const gap = x.yoyo ? 'a varié ↕' : x.d === 0 ? 'stable' : x.d < 0 && young ? '' : signed(x.d) + arrow
  const word = x.yoyo ? ' · a varié' : x.d === 0 ? ' · stable' : ''
  const lastStep = x.last !== null && !(young && x.last < 0) ? `dernier avis ${signed(x.last)}` : null
  return { short: ab + arrow, range: ab + word + arrow, gap, lastStep }
}

/** Moyenne des critères d'une famille à chaque cran (ceux qui ont déjà une note). */
export function meanHistory(hs: readonly (readonly (number | null)[])[]): (number | null)[] {
  const n = Math.max(0, ...hs.map((h) => h.length))
  return Array.from({ length: n }, (_, j) => mean(hs.map((h) => h[j]).filter((v): v is number => typeof v === 'number')))
}

/** Combien progressent, baissent, restent stables ou ont varié (critères notés au départ et à l'arrivée). */
export function countTones(deltas: readonly Delta[], young = false) {
  const out = { up: 0, down: 0, flat: 0 }
  for (const x of deltas) if (x.d !== null) out[toneOf(x, young)]++
  return out
}

/** « Actuel » (moyenne des notes à l'arrivée) et écart moyen depuis le départ (critères notés aux deux). */
export function overall(deltas: readonly Delta[]): { now: number | null; gain: number | null } {
  const now = mean(deltas.map((x) => x.b).filter((v): v is number => v !== null))
  const both = deltas.filter((x) => x.a !== null && x.b !== null)
  const gain = mean(both.map((x) => x.b! - x.a!))
  return { now, gain: gain === null ? null : r1(gain) }
}

/** Raccourci « 6 mois » : premier cran dans les 6 mois avant le dernier (au plus l'avant-dernier). */
export function sixMonthsStart(steps: readonly { date: string }[]): number {
  const L = steps.length - 1
  if (L < 1) return 0
  const lim = new Date(steps[L].date + 'T00:00:00')
  lim.setMonth(lim.getMonth() - 6)
  const iso = lim.toLocaleDateString('sv')
  const i = steps.findIndex((s) => s.date >= iso)
  return Math.max(0, Math.min(L - 1, i < 0 ? L - 1 : i))
}

/**
 * Cran de l'arrivée pendant ▶ Rejouer, `ms` après le départ : de `from` à `to`, ~0,9 s par cran, en continu ; mouvement
 * réduit (prefers-reduced-motion) : d'un cran entier à l'autre.
 */
export function replayAt(from: number, to: number, ms: number, reduced = false, per = 900): number {
  const p = ms / per
  return Math.min(to, from + (reduced ? Math.floor(p) : p))
}

/** Poignée la plus proche du cran touché (égalité : celle qui y va sans croiser l'autre). Départ toujours avant l'arrivée. */
export function moveNearest(s: number, e: number, j: number, L: number): { s: number; e: number } {
  const ds = Math.abs(j - s)
  const de = Math.abs(j - e)
  if (ds < de || (ds === de && j < s)) return { s: Math.max(0, Math.min(j, e - 1)), e }
  return { s, e: Math.min(L, Math.max(j, s + 1)) }
}

const MOIS = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
/** Mois court d'une date (« sept. »). */
export const monthOf = (d: string) => MOIS[Number(d.slice(5, 7)) - 1] ?? ''
/** « 25/10/2025 ». */
export const dayLong = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
/** « 25/10 ». */
export const dayShort = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** « Du Stage de Toussaint » / « De l’avis spontané » ; « au … » / « à l’avis spontané ». */
export const fromWord = (name: string) => (/^l[’']/.test(name) ? 'De' : 'Du')
export const toWord = (name: string) => (/^l[’']/.test(name) ? 'à' : 'au')

