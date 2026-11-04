import type { Criterion, Measurement } from './db'
import { numericValue } from './reperes'

/*
 * « Tous les tests » d'un joueur (onglet Tests de la fiche, « Mes tests » de sa page /moi ; src/components/AllTests.tsx) :
 * une ligne par test PASSÉ (critère factuel avec au moins une mesure), rangée par famille (catégorie du critère, dans l'ordre
 * des critères), avec sa dernière valeur, son nombre de mesures, une petite courbe, ce qu'il a gagné depuis la première
 * mesure et un « record » quand la dernière est sa meilleure.
 *
 * Toujours positif (règle de l'appli pour les jeunes) : il se compare à lui-même, jamais aux autres ; un gain n'est montré
 * que s'il va dans le bon sens. Sens d'un test : `dirOf` (src/compare.ts, measureDirection, ou celui des repères :
 * src/reperes.ts, repereDirection) : 1 plus haut est mieux, −1 plus bas (sprint, agilité : « −0,09 s ↗ »), 0 inconnu (taille,
 * poids, mensurations) : un écart positif est montré en neutre (« +4 cm »), sans flèche, sans record, jamais dans les progrès.
 *
 * Fichier pur (ni Dexie ni React) : testé par tools/test-tous-les-tests.ts.
 */

export type Dir = 1 | -1 | 0

export interface TestPoint {
  date: string
  value: number
}

export interface TestLine {
  c: Criterion
  family: string
  /** Toutes ses mesures, de la plus ancienne à la plus récente. */
  all: Measurement[]
  last: Measurement
  /** Mesures chiffrées (courbe, gain, record), dans l'ordre des dates. */
  points: TestPoint[]
  dir: Dir
  /** Meilleure valeur (sens connu) ; sinon undefined. */
  best?: number
  /** La dernière bat toutes les précédentes (au moins 2 mesures chiffrées, sens connu). */
  record: boolean
  /** Dernière − première (valeurs chiffrées, au moins 2) ; undefined sinon. */
  delta?: number
  /** Progrès relatif (delta × sens / |première|) : > 0 quand il a progressé ; undefined si sens inconnu ou première nulle. */
  progress?: number
}

/** Ordre des mesures : date, puis heure de modification. */
const byDate = (a: Measurement, b: Measurement) => a.date.localeCompare(b.date) || (a.updatedAt ?? 0) - (b.updatedAt ?? 0)

/** Arrondi d'affichage (0,1 + 0,2 = 0,3 et pas 0,30000000000000004). */
const round = (v: number) => Math.round(v * 1e6) / 1e6

/**
 * Les tests passés : critères factuels (ordre des critères) qui ont au moins une mesure non supprimée de ce joueur.
 * `measurements` : celles du joueur (les autres sont ignorées si `playerId` est donné).
 */
export function testLines(criteria: Criterion[], measurements: Measurement[], dirOf: (c: Criterion) => Dir, playerId?: string): TestLine[] {
  const byCrit = new Map<string, Measurement[]>()
  for (const m of measurements) {
    if (m.deleted || (playerId && m.playerId !== playerId)) continue
    if (m.value === undefined || m.value === null || m.value === '') continue
    const l = byCrit.get(m.criterionId)
    if (l) l.push(m)
    else byCrit.set(m.criterionId, [m])
  }
  const out: TestLine[] = []
  for (const c of [...criteria].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (c.kind !== 'factual' || c.deleted) continue
    const all = byCrit.get(c.id)
    if (!all?.length) continue
    all.sort(byDate)
    const numeric = c.scale !== 'text' && c.scale !== 'choice'
    const points: TestPoint[] = numeric
      ? all.flatMap((m) => {
          const v = numericValue(m.value)
          return v === undefined ? [] : [{ date: m.date, value: v }]
        })
      : []
    const dir = numeric ? dirOf(c) : 0
    const line: TestLine = { c, family: c.category || 'Autres tests', all, last: all[all.length - 1], points, dir, record: false }
    if (points.length && dir) line.best = points.reduce((b, p) => (p.value * dir > b * dir ? p.value : b), points[0].value)
    if (points.length >= 2) {
      const first = points[0].value
      const lastV = points[points.length - 1].value
      line.delta = round(lastV - first)
      if (dir) {
        line.record = points.slice(0, -1).every((p) => lastV * dir > p.value * dir)
        if (first !== 0) line.progress = ((lastV - first) * dir) / Math.abs(first)
      }
    }
    out.push(line)
  }
  return out
}

/** Familles présentes, dans l'ordre des critères, avec leurs tests. */
export function families(lines: TestLine[]): [string, TestLine[]][] {
  const m = new Map<string, TestLine[]>()
  for (const l of lines) {
    const x = m.get(l.family)
    if (x) x.push(l)
    else m.set(l.family, [l])
  }
  return [...m.entries()]
}

/** Gain à montrer : 'up' (bon sens, en vert, ↗), 'neutral' (sens inconnu, écart positif, sans flèche) ; null : rien. */
export function gainKind(l: TestLine): 'up' | 'neutral' | null {
  if (l.delta === undefined || l.delta === 0) return null
  if (l.dir) return l.delta * l.dir > 0 ? 'up' : null
  return l.delta > 0 ? 'neutral' : null
}

/** Nombre à la française : « 1,82 », « 16,5 », « 38 » (2 décimales au plus). */
export const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }))

/** Gain écrit : « +6 cm », « −0,09 s » ; null quand il n'y a rien à montrer (jamais un recul). */
export function gainText(l: TestLine): string | null {
  if (!gainKind(l)) return null
  const d = l.delta!
  return `${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))}${l.c.unit ? ` ${l.c.unit}` : ''}`
}

/** « Ses plus beaux progrès » : au plus `n` tests au plus grand progrès relatif (bon sens, au moins 2 mesures). */
export function topProgress(lines: TestLine[], n = 3): TestLine[] {
  return lines
    .filter((l) => l.progress !== undefined && l.progress > 0 && gainKind(l) === 'up')
    .sort((a, b) => b.progress! - a.progress! || (a.c.order ?? 0) - (b.c.order ?? 0))
    .slice(0, n)
}

/**
 * Points d'une petite courbe (attribut `points` d'une polyline SVG) dans une boîte w × h, marge `pad` : abscisses à pas
 * réguliers (une mesure, un pas), ordonnées de la plus petite à la plus grande valeur (haut = plus grand, comme la courbe du
 * test ouvert : un sprint qui progresse descend). Moins de 2 valeurs : ''.
 */
export function sparkPoints(values: number[], w: number, h: number, pad = 2): string {
  if (values.length < 2) return ''
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo
  const stepX = (w - 2 * pad) / (values.length - 1)
  return values
    .map((v, i) => {
      const t = span ? (v - lo) / span : 0.5
      const y = pad + (1 - t) * (h - 2 * pad)
      return `${round(pad + i * stepX)},${round(y)}`
    })
    .join(' ')
}

/** « 12/10/2026 » depuis « 2026-10-12 ». */
export const frDate = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : d)

/** En-tête : « 18 tests passés · dernier le 12/10/2026 » ; aucun test : null. */
export function summaryText(lines: TestLine[]): string | null {
  if (!lines.length) return null
  const last = lines.reduce((d, l) => (l.last.date > d ? l.last.date : d), '')
  return `${lines.length} test${lines.length > 1 ? 's' : ''} passé${lines.length > 1 ? 's' : ''}${last ? ` · dernier le ${frDate(last)}` : ''}`
}

/** Tableur : une ligne par mesure (date, famille, test, valeur, unité), dans l'ordre des familles puis des dates. */
export function csvRows(lines: TestLine[]): (string | number)[][] {
  const head = ['Date', 'Famille', 'Test', 'Valeur', 'Unité']
  const rows = lines.flatMap((l) =>
    l.all.map((m) => {
      const v = typeof m.value === 'number' ? m.value : (numericValue(m.value) ?? m.value)
      return [frDate(m.date), l.family, l.c.label, v, l.c.unit ?? '']
    }),
  )
  return [head, ...rows]
}

/** Cellule CSV (séparateur « ; », Excel en français) : nombres à virgule, formules neutralisées, guillemets si besoin. */
const csvCell = (v: string | number) => {
  let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Le fichier CSV entier (BOM pour qu'Excel lise les accents). */
export const toCsv = (rows: (string | number)[][]) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n'

/** Nom de fichier sans accents ni espaces : « tests-leo-martin ». */
export const fileSlug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
