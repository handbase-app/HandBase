import { addDays, fmt1, isDay, isWeekday, WELLNESS_ITEMS, WELLNESS_KEYS, type WellnessEntry, type WellnessKey } from './wellness'

/*
 * Wellness du matin, côté STAFF : « Demander » (« les joueurs en dessous de 6 dans le wellness ») et alerte « plusieurs jours
 * de suite à 5 ou moins ». Partie PURE (ni base, ni React, ni réseau), testée par tools/test-wellness-alerte.ts ; écran :
 * src/pages/GroupWellness.tsx (bandeau, pastille de la ligne, filtre, bulle), proposition de l'en-tête : src/demander.ts.
 *
 * Règles (décidées le 10/11) :
 *  - Valeur d'un jour : par défaut la MOYENNE des notes données ce jour-là (les 4 d'habitude : énergie, fraîcheur, humeur,
 *    sommeil ; une réponse partielle : la moyenne de celles données) ; une note nommée (« sommeil sous 5 ») : cette note
 *    seulement ; plusieurs (« énergie et sommeil sous 5 ») : chacune.
 *  - « Demander » lit la DERNIÈRE réponse de chaque jeune (celle du jour s'il a répondu, sinon la précédente), si elle a
 *    7 jours au plus (WELLNESS_ASK_FRESH_DAYS) : le matin, avant les réponses, la liste n'est pas vide et chaque ligne dit
 *    de quel jour est la réponse.
 *  - Alerte : WELLNESS_LOW_MAX (5) ou moins pendant WELLNESS_LOW_DAYS (3) jours DEMANDÉS de suite. Jours demandés : lundi →
 *    vendredi (et, quand la zone du pôle est connue, hors vacances scolaires et jours fériés : src/lamp.ts isRequestedDay) ;
 *    un jour non demandé (week-end) ne compte pas et ne coupe pas la série (vendredi → lundi se suivent). Un jour demandé
 *    SANS réponse coupe la série (on ne compte que des réponses réelles, jamais une supposition). Aujourd'hui pas encore
 *    répondu (la matinée n'est pas finie) : la série s'arrête à hier, sans être coupée.
 *  - Seuil, durée et note réglables par groupe (clé `wellnessAlert` du groupe, écrite comme le reste du groupe par son
 *    créateur ou un administrateur ; pas de script SQL) ; valeurs par défaut ici seulement.
 * Données de santé de mineurs : lues à la demande (src/wellnessApi.ts), jamais gardées sur l'appareil ni envoyées à une
 * IA ; la phrase est comprise ICI, sur l'appareil. Mots neutres seulement (jamais d'étiquette sur un jeune).
 */

// ---------- Constantes (un seul endroit) ----------

/** Interrupteur : le wellness dans « Demander » (en-tête et barre du tableau du groupe). Geoffroy l'a validé le 10/11. */
export const WELLNESS_IN_ASK = true
/** Alerte : note (ou moyenne) à 5 ou moins… */
export const WELLNESS_LOW_MAX = 5
/** … pendant 3 jours demandés de suite. */
export const WELLNESS_LOW_DAYS = 3
/** « Demander » : dernière réponse lue si elle a 7 jours au plus. */
export const WELLNESS_ASK_FRESH_DAYS = 7
/** Choix du réglage de l'alerte. */
export const ALERT_MAX_CHOICES = [3, 4, 5, 6, 7] as const
export const ALERT_DAYS_CHOICES = [2, 3, 4, 5] as const

// ---------- Valeur d'un jour ----------

/** Notes lues : liste vide = la moyenne des notes du jour. */
export type WellnessNotes = readonly WellnessKey[]

/** Moyenne des notes données ce jour-là (null : aucune note). */
export function dayMean(e: Pick<WellnessEntry, 'scores'> | null | undefined): number | null {
  if (!e) return null
  const vs = WELLNESS_KEYS.map((k) => e.scores[k]).filter((v): v is number => typeof v === 'number')
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null
}

/** Valeur d'une note, ou la moyenne (null : pas de valeur). */
export function dayValue(e: Pick<WellnessEntry, 'scores'> | null | undefined, note: WellnessKey | null): number | null {
  if (!e) return null
  if (!note) return dayMean(e)
  const v = e.scores[note]
  return typeof v === 'number' ? v : null
}

// ---------- « Demander » : la phrase ----------

export type CmpOp = 'lt' | 'le' | 'gt' | 'ge'
export interface WellnessCriterion {
  /** Notes nommées (vide : la moyenne des notes du jour). */
  notes: WellnessKey[]
  op: CmpOp
  value: number
}

const NUM_WORDS: Record<string, number> = { un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 }
const N = String.raw`(\d+(?:\.\d+)?|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)`
/** Tournures de comparaison, les plus longues d'abord (« 5 ou moins » avant « moins de », « pas plus de » avant « plus de »). */
const CMP: readonly [CmpOp, RegExp][] = [
  ['le', new RegExp(String.raw`\b${N} (?:ou|et) moins\b`)],
  ['le', new RegExp(String.raw`\binferieure?s? ou egale?s? (?:a )?${N}`)],
  ['le', new RegExp(String.raw`\b(?:au plus|au maximum|maximum|max|pas plus de|pas au dessus de|jusqu a) ${N}`)],
  ['le', new RegExp(String.raw`\bleq ${N}`)],
  ['ge', new RegExp(String.raw`\b${N} (?:ou|et) plus\b`)],
  ['ge', new RegExp(String.raw`\bsuperieure?s? ou egale?s? (?:a )?${N}`)],
  ['ge', new RegExp(String.raw`\b(?:au moins|au minimum|minimum|min|pas moins de|pas en dessous de|a partir de) ${N}`)],
  ['ge', new RegExp(String.raw`\bgeq ${N}`)],
  ['lt', new RegExp(String.raw`\b(?:en|au) dessous (?:de |du |des )?(?:la barre (?:de |des )?)?${N}`)],
  ['lt', new RegExp(String.raw`\bsous (?:la barre (?:de |des )?|les |le )?${N}`)],
  ['lt', new RegExp(String.raw`\bmoins (?:de |que )${N}`)],
  ['lt', new RegExp(String.raw`\binferieure?s? (?:a )?${N}`)],
  ['lt', new RegExp(String.raw`\bplus (?:petite?s?|basse?s?|bas) (?:que |a )${N}`)],
  ['lt', new RegExp(String.raw`\blt ${N}`)],
  ['gt', new RegExp(String.raw`\bau dessus (?:de |du |des )?(?:la barre (?:de |des )?)?${N}`)],
  ['gt', new RegExp(String.raw`\bplus (?:de |que )${N}`)],
  ['gt', new RegExp(String.raw`\bsuperieure?s? (?:a )?${N}`)],
  ['gt', new RegExp(String.raw`\bplus (?:grande?s?|haute?s?|hauts?) (?:que |a )${N}`)],
  ['gt', new RegExp(String.raw`\bgt ${N}`)],
]
/** « wellness » et ses variantes de dictée (« welness », « well ness », « ouelness »), « bien-être ». */
const WELLNESS_WORD = /\b(?:(?:w|ou|v)e+l+ ?n+e+s+e?s?|bien ?etre|questionnaire du matin)\b/
const NOTE_WORDS: Record<WellnessKey, RegExp> = {
  energie: /\b(?:energie|energies|batterie)\b/,
  fraicheur: /\b(?:fraicheur|fraicheurs|fraicheur musculaire|jambes)\b/,
  humeur: /\b(?:humeur|humeurs|moral|mood)\b/,
  sommeil: /\b(?:sommeil|nuit|nuits)\b/,
}

/** Phrase repliée : minuscules sans accents, signes de comparaison en mots, décimales « 5,5 » → « 5.5 ». */
export function foldWellnessPhrase(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/≤|<=|=</g, ' leq ')
    .replace(/≥|>=|=>/g, ' geq ')
    .replace(/</g, ' lt ')
    .replace(/>/g, ' gt ')
    .replace(/(\d)\s*,\s*(\d)/g, '$1.$2')
    .replace(/\.(?!\d)|(?<!\d)\./g, ' ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const numOf = (s: string) => NUM_WORDS[s] ?? Number(s)

/**
 * « Les joueurs en dessous de 6 dans le wellness » → { notes: [], op: 'lt', value: 6 } ; « sommeil sous 5 » →
 * { notes: ['sommeil'], … }. Il faut le mot « wellness » (ou une variante, « bien-être ») ou une note nommée, ET une
 * comparaison à un nombre de 1 à 10 ; sinon null (la phrase suit son chemin habituel). Pur, sur l'appareil.
 */
export function parseWellnessAsk(phrase: string): WellnessCriterion | null {
  const s = foldWellnessPhrase(phrase)
  if (!s) return null
  const notes = WELLNESS_KEYS.filter((k) => NOTE_WORDS[k].test(s))
  if (!WELLNESS_WORD.test(s) && !notes.length) return null
  for (const [op, re] of CMP) {
    const m = s.match(re)
    if (!m) continue
    const value = numOf(m[1])
    if (!Number.isFinite(value) || value < 1 || value > 10) return null
    // « moyenne » dite avec une note (« la moyenne du sommeil ») : la note.
    return { notes, op, value }
  }
  return null
}

/** Même lecture, si l'interrupteur WELLNESS_IN_ASK est allumé (sinon null partout). */
export const wellnessAsk = (phrase: string): WellnessCriterion | null => (WELLNESS_IN_ASK ? parseWellnessAsk(phrase) : null)

export const meets = (v: number | null, op: CmpOp, value: number): boolean =>
  v !== null && (op === 'lt' ? v < value : op === 'le' ? v <= value : op === 'gt' ? v > value : v >= value)

const SHORT = new Map(WELLNESS_ITEMS.map((x) => [x.key, x.short.toLowerCase()]))
/** « moyenne des notes », « sommeil », « énergie et sommeil ». */
export function notesText(notes: WellnessNotes): string {
  if (!notes.length) return 'moyenne des notes'
  const ws = notes.map((k) => SHORT.get(k) ?? k)
  return ws.length === 1 ? ws[0] : `${ws.slice(0, -1).join(', ')} et ${ws[ws.length - 1]}`
}
const OP_TEXT: Record<CmpOp, (v: string) => string> = {
  lt: (v) => `en dessous de ${v}`,
  le: (v) => `à ${v} ou moins`,
  gt: (v) => `au-dessus de ${v}`,
  ge: (v) => `à ${v} ou plus`,
}
/** « Wellness : moyenne des notes en dessous de 6 ». */
export const criterionText = (c: WellnessCriterion) => `${notesText(c.notes)} ${OP_TEXT[c.op](fmt1(c.value))}`

/** Dans l'adresse (filtre de la page, retrouvé au « Retour ») : « lt-6 », « le-5-sommeil.energie ». Jamais une donnée. */
export const criterionParam = (c: WellnessCriterion) => [c.op, String(c.value), ...(c.notes.length ? [c.notes.join('.')] : [])].join('-')
export function parseCriterionParam(v: string | null | undefined): WellnessCriterion | null {
  const m = (v ?? '').match(/^(lt|le|gt|ge)-(\d+(?:\.\d+)?)(?:-([a-z.]+))?$/)
  if (!m) return null
  const value = Number(m[2])
  if (!(value >= 1 && value <= 10)) return null
  const notes = m[3] ? m[3].split('.') : []
  if (!notes.every((n) => (WELLNESS_KEYS as string[]).includes(n))) return null
  return { op: m[1] as CmpOp, value, notes: WELLNESS_KEYS.filter((k) => notes.includes(k)) }
}

/** Dernière réponse d'un jeune, de `fresh` jours au plus (aujourd'hui compris) ; null : aucune. */
export function lastAnswer(entries: readonly WellnessEntry[], today: string, fresh = WELLNESS_ASK_FRESH_DAYS): WellnessEntry | null {
  const from = addDays(today, -(fresh - 1))
  let best: WellnessEntry | null = null
  for (const e of entries) if (e.day <= today && e.day >= from && (!best || e.day > best.day)) best = e
  return best
}

export interface AskHit {
  day: string
  /** Valeur de chaque note nommée (ou la moyenne : clé « moyenne »), pour la ligne du tableau. */
  values: { label: string; value: number }[]
}
/** Le jeune répond-il au critère (sur sa dernière réponse) ? null : non, ou pas de réponse récente. */
export function askMatch(entries: readonly WellnessEntry[], today: string, c: WellnessCriterion): AskHit | null {
  const e = lastAnswer(entries, today)
  if (!e) return null
  const keys: (WellnessKey | null)[] = c.notes.length ? c.notes : [null]
  const values: AskHit['values'] = []
  for (const k of keys) {
    const v = dayValue(e, k)
    if (!meets(v, c.op, c.value)) return null
    values.push({ label: k ? (SHORT.get(k) ?? k) : 'moyenne', value: v as number })
  }
  return { day: e.day, values }
}

// ---------- Alerte : plusieurs jours demandés de suite à 5 ou moins ----------

export interface AlertSettings {
  /** Seuil : valeur à `max` ou moins. */
  max: number
  /** Jours demandés de suite. */
  days: number
  /** Note suivie (null : la moyenne des notes du jour). */
  note: WellnessKey | null
}
export const DEFAULT_ALERT: AlertSettings = { max: WELLNESS_LOW_MAX, days: WELLNESS_LOW_DAYS, note: null }

/** Réglage du groupe (clé `wellnessAlert`) relu : valeurs connues seulement, sinon celles par défaut. */
export function alertSettingsOf(v: unknown): AlertSettings {
  const r = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const max = (ALERT_MAX_CHOICES as readonly unknown[]).includes(r.max) ? (r.max as number) : DEFAULT_ALERT.max
  const days = (ALERT_DAYS_CHOICES as readonly unknown[]).includes(r.days) ? (r.days as number) : DEFAULT_ALERT.days
  const note = typeof r.note === 'string' && (WELLNESS_KEYS as string[]).includes(r.note) ? (r.note as WellnessKey) : null
  return { max, days, note }
}
export const isDefaultAlert = (s: AlertSettings) => s.max === DEFAULT_ALERT.max && s.days === DEFAULT_ALERT.days && s.note === DEFAULT_ALERT.note

/** « 3 jours de suite à 5 ou moins (moyenne des notes) ». */
export const alertText = (s: AlertSettings) => `${s.days} jours de suite à ${s.max} ou moins (${notesText(s.note ? [s.note] : [])})`

/**
 * Série en cours : les jours demandés de suite, du plus récent au plus ancien, où la valeur est à `max` ou moins. Départ :
 * aujourd'hui s'il a répondu ; aujourd'hui demandé sans réponse encore : hier (la matinée n'est pas finie) ; jour non
 * demandé : le dernier jour demandé. Un jour demandé sans réponse (ou sans la note suivie) coupe la série ; un jour non
 * demandé est sauté. Regarde 120 jours au plus.
 */
export function lowStreak(
  entries: readonly WellnessEntry[],
  today: string,
  s: AlertSettings = DEFAULT_ALERT,
  requestedDay: (day: string) => boolean = isWeekday,
): string[] {
  if (!isDay(today)) return []
  const byDay = new Map<string, WellnessEntry>()
  for (const e of entries) if (e.day <= today) byDay.set(e.day, e)
  const out: string[] = []
  let d = today
  if (requestedDay(today) && !byDay.has(today)) d = addDays(today, -1)
  for (let i = 0; i < 120; i++, d = addDays(d, -1)) {
    if (!requestedDay(d)) continue
    const v = dayValue(byDay.get(d), s.note)
    if (v === null || v > s.max) break
    out.push(d)
  }
  return out
}

/** Alerte levée : la série atteint la durée réglée. */
export const lowAlert = (streak: readonly string[], s: AlertSettings = DEFAULT_ALERT) => streak.length >= s.days
