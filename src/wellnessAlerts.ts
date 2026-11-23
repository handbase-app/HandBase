import { accord, pluralG, type Gender } from './gender'
import { isRequestedDay, type Zone } from './lamp'
import { addDays, isDay, isWeekday, WELLNESS_ITEMS, WELLNESS_KEYS, type WellnessEntry, type WellnessKey } from './wellness'
import { dayValue, streakBack, WELLNESS_LOW_DAYS, WELLNESS_LOW_MAX } from './wellnessAlert'

/*
 * Alertes wellness de « Mes suivis » (supabase/080_alertes_wellness.sql) : chaque compte du staff règle PLUSIEURS alertes sur
 * les joueurs qu'il suit ; le serveur les calcule (hb_wellness_alertes_moi, et le matin le résumé poussé) seulement pour les
 * suivis dont ce compte lit déjà le wellness (règle de 073 : staff d'un groupe où le wellness est activé, ou administrateur).
 * Partie PURE (ni base, ni React, ni réseau), testée par tools/test-alertes-wellness.ts ; la MÊME règle est écrite en SQL
 * (hb_wla_regle, hb_wla_serie, hb_wla_demande) : tools/essai-sql-080 compare les deux sur les mêmes cas.
 *
 * Une alerte = un nom, allumée ou non, une cible (tous mes suivis, ou un groupe suivi) et une règle :
 *  - seuil   : une note (énergie, fraîcheur, humeur, sommeil) ou la moyenne des notes du jour, à `max` ou moins ;
 *  - douleur : douleur signalée ;
 *  - chute   : la note (ou la moyenne) à au moins `baisse` points sous la moyenne du jeune sur les 14 jours (calendrier) qui
 *              précèdent le PREMIER jour de la série (3 réponses au moins dans ces 14 jours ; les jours de la série n'entrent
 *              jamais dans la moyenne de référence ; série = les k derniers jours demandés, k le plus grand possible) ;
 *  - silence : pas de réponse un jour où le wellness est demandé (fiche reliée à un espace joueur seulement, et jamais avant
 *              que le wellness lui soit demandé : `since`).
 * Chacune pendant `jours` jours DEMANDÉS de suite (1 à 10). Jours demandés : lundi → vendredi, sans les jours fériés ni,
 * quand la zone de l'installation est réglée (réglage « lampe »), les vacances scolaires (src/lamp.ts : isRequestedDay).
 * Série : comme l'alerte du groupe (src/wellnessAlert.ts, streakBack) : aujourd'hui pas encore répondu → elle s'arrête à
 * hier ; un jour non demandé est sauté ; un jour demandé sans réponse la coupe (sauf « silence », qui les compte).
 * Données de santé de mineurs : jamais gardées sur l'appareil ; le serveur ne renvoie que « quelle alerte, quel suivi, depuis
 * combien de jours », jamais une note. Mots neutres seulement (« À recharger », « Douleur signalée »).
 */

// ---------- Constantes (mêmes valeurs dans le script SQL 080) ----------

export const ALERT_KINDS = ['seuil', 'douleur', 'chute', 'silence'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]
/** Note suivie : « moyenne » = la moyenne des notes données ce jour-là. */
export const ALERT_NOTES = ['moyenne', ...WELLNESS_KEYS] as const
export type AlertNote = 'moyenne' | WellnessKey
/** Jours demandés de suite : 1 à 10. */
export const RULE_DAYS_MIN = 1
export const RULE_DAYS_MAX = 10
/** Seuil « à X ou moins » : 1 à 9. */
export const RULE_MAX_MIN = 1
export const RULE_MAX_MAX = 9
/** Baisse d'au moins N points : 1 à 9. */
export const RULE_DROP_MIN = 1
export const RULE_DROP_MAX = 9
/** Chute : moyenne de référence sur les 14 jours qui précèdent la série, 3 réponses au moins. */
export const DROP_BASE_DAYS = 14
export const DROP_BASE_MIN = 3
/** Une série regarde 30 jours au plus en arrière (depuis son départ). */
export const LOOKBACK_DAYS = 30
/** Alertes au plus par compte ; nom : 40 caractères. */
export const RULES_PER_ACCOUNT = 20
export const RULE_NAME_MAX = 40
/** Choix proposés dans la fenêtre (le serveur accepte toute la plage). */
export const DAYS_CHOICES = [1, 2, 3, 4, 5] as const
export const MAX_CHOICES = [3, 4, 5, 6, 7] as const
export const DROP_CHOICES = [2, 3, 4, 5] as const
/** Marge des comparaisons (moyennes non entières) : la même dans hb_wla_serie. */
const EPS = 1e-9

export type AlertRule =
  | { type: 'seuil'; note: AlertNote; max: number; jours: number }
  | { type: 'douleur'; jours: number }
  | { type: 'chute'; note: AlertNote; baisse: number; jours: number }
  | { type: 'silence'; jours: number }

/** Une alerte réglée par un compte (table hb_wellness_alertes). `cible` : null = tous mes suivis, sinon un groupe. */
export interface WellnessAlertDef {
  id: string
  nom: string
  actif: boolean
  regle: AlertRule
  cible: string | null
}

/** Alerte proposée (pas imposée) : celle du groupe, moyenne à 5 ou moins, 3 jours demandés de suite. */
export const DEFAULT_RULE: AlertRule = { type: 'seuil', note: 'moyenne', max: WELLNESS_LOW_MAX, jours: WELLNESS_LOW_DAYS }
export const DEFAULT_ALERT_NAME = 'À recharger'

// ---------- Réglages relus (même règle que hb_wla_regle et hb_wla_nom) ----------

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
const isNote = (v: unknown): v is AlertNote => typeof v === 'string' && (ALERT_NOTES as readonly string[]).includes(v)

/** Règle valable, réduite à ses clés (les autres sont ignorées) ; illisible : null. */
export function cleanRule(v: unknown): AlertRule | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (!isInt(r.jours, RULE_DAYS_MIN, RULE_DAYS_MAX)) return null
  const jours = r.jours
  switch (r.type) {
    case 'seuil':
      return isNote(r.note) && isInt(r.max, RULE_MAX_MIN, RULE_MAX_MAX) ? { type: 'seuil', note: r.note, max: r.max, jours } : null
    case 'chute':
      return isNote(r.note) && isInt(r.baisse, RULE_DROP_MIN, RULE_DROP_MAX) ? { type: 'chute', note: r.note, baisse: r.baisse, jours } : null
    case 'douleur':
      return { type: 'douleur', jours }
    case 'silence':
      return { type: 'silence', jours }
    default:
      return null
  }
}

/** Nom d'une alerte : caractères de contrôle et espaces répétés → une espace, 40 caractères ; vide : ''. */
export function cleanRuleName(v: unknown): string {
  if (typeof v !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, RULE_NAME_MAX).trim()
}

/** Ligne de la table (ou du stockage du mode essai) relue ; illisible : null. */
export function alertDefOf(row: unknown): WellnessAlertDef | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const regle = cleanRule(r.regle)
  const nom = cleanRuleName(r.nom)
  if (typeof r.id !== 'string' || !r.id || !regle || !nom) return null
  return { id: r.id, nom, actif: r.actif !== false, regle, cible: typeof r.cible === 'string' && r.cible ? r.cible : null }
}

// ---------- Jours demandés ----------

/** Jours demandés : lundi → vendredi sans les fériés ; zone de l'installation connue : sans ses vacances scolaires. */
export function requestedDayFor(zone: Zone | null | undefined, pont = true): (day: string) => boolean {
  return (day) => isRequestedDay(day, zone ?? null, { pont })
}

// ---------- Calcul ----------

export interface PlayerWellnessInput {
  id: string
  /** Réponses des 50 derniers jours au moins (FETCH_DAYS côté serveur). */
  entries: readonly WellnessEntry[]
  /** Fiche reliée à un espace joueur (sinon jamais « pas de réponse »). */
  account: boolean
  /** Premier jour où le wellness lui est demandé (groupe activé, espace joueur relié) ; null : inconnu. */
  since?: string | null
  /** Groupes suivis qui le contiennent (cible d'une alerte). */
  groups?: readonly string[]
}

const valueOf = (e: WellnessEntry | undefined, note: AlertNote) => dayValue(e, note === 'moyenne' ? null : note)

/** Moyenne des valeurs de la note sur les jours [from, to] (calendrier, réponses seulement) ; moins de `min` : null. */
function meanOver(entries: readonly WellnessEntry[], note: AlertNote, from: string, to: string, min = DROP_BASE_MIN): number | null {
  const vs: number[] = []
  for (const e of entries) {
    if (e.day < from || e.day > to) continue
    const v = valueOf(e, note)
    if (v !== null) vs.push(v)
  }
  return vs.length >= min ? vs.reduce((a, b) => a + b, 0) / vs.length : null
}

/** Jours de la série en cours pour cette règle (du plus récent au plus ancien). */
export function ruleStreak(
  rule: AlertRule,
  entries: readonly WellnessEntry[],
  today: string,
  opts: { requestedDay?: (day: string) => boolean; account?: boolean; since?: string | null } = {},
): string[] {
  const req = opts.requestedDay ?? isWeekday
  if (!isDay(today)) return []
  switch (rule.type) {
    case 'seuil':
      return streakBack(entries, today, (e) => {
        const v = valueOf(e, rule.note)
        return v !== null && v <= rule.max + EPS
      }, req, LOOKBACK_DAYS)
    case 'douleur':
      return streakBack(entries, today, (e) => e?.pain === true, req, LOOKBACK_DAYS)
    case 'silence': {
      if (!opts.account) return []
      const since = opts.since && isDay(opts.since) ? opts.since : null
      return streakBack(entries, today, (e, d) => !e && (!since || d >= since), req, LOOKBACK_DAYS)
    }
    case 'chute': {
      // Jours demandés de suite avec une valeur ; puis la PLUS LONGUE série (depuis le plus récent : les k derniers) dont
      // chaque jour est à `baisse` points au moins sous la moyenne des 14 jours qui précèdent son premier jour. Les plus
      // courtes peuvent échouer (leur référence contient les premiers jours bas) sans arrêter la recherche.
      const days = streakBack(entries, today, (e) => valueOf(e, rule.note) !== null, req, LOOKBACK_DAYS)
      const byDay = new Map(entries.map((e) => [e.day, e]))
      let n = 0
      for (let k = 1; k <= days.length; k++) {
        const first = days[k - 1]
        const base = meanOver(entries, rule.note, addDays(first, -DROP_BASE_DAYS), addDays(first, -1))
        if (base === null) continue
        if (days.slice(0, k).every((d) => (valueOf(byDay.get(d), rule.note) as number) <= base - rule.baisse + EPS)) n = k
      }
      return days.slice(0, n)
    }
  }
}

/** Alerte levée : la série atteint la durée réglée. */
export const ruleHit = (rule: AlertRule, streak: readonly string[]) => streak.length >= rule.jours

export interface AlertHit {
  /** Identifiant de l'alerte réglée. */
  alerte: string
  playerId: string
  /** Jours demandés de suite (série en cours). */
  jours: number
}

/** Alertes en cours sur ces suivis (ceux dont le compte lit le wellness), dans l'ordre des alertes puis des joueurs. */
export function evaluateAlerts(
  defs: readonly WellnessAlertDef[],
  players: readonly PlayerWellnessInput[],
  today: string,
  requestedDay: (day: string) => boolean = isWeekday,
): AlertHit[] {
  const out: AlertHit[] = []
  for (const d of defs) {
    if (!d.actif) continue
    for (const p of players) {
      if (d.cible && !(p.groups ?? []).includes(d.cible)) continue
      const s = ruleStreak(d.regle, p.entries, today, { requestedDay, account: p.account, since: p.since })
      if (ruleHit(d.regle, s)) out.push({ alerte: d.id, playerId: p.id, jours: s.length })
    }
  }
  return out
}

/** Réponse de hb_wellness_alertes_moi relue. */
export interface MyAlerts {
  /** Wellness ouvert sur l'installation. */
  enabled: boolean
  /** Suivis dont ce compte lit le wellness (fiches reliées à un espace joueur). */
  readable: Set<string>
  hits: AlertHit[]
}
export function myAlertsOf(data: unknown): MyAlerts {
  const r = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const readable = new Set((Array.isArray(r.lus) ? r.lus : []).filter((x): x is string => typeof x === 'string'))
  const hits: AlertHit[] = []
  for (const h of Array.isArray(r.alertes) ? (r.alertes as Record<string, unknown>[]) : []) {
    if (h && typeof h.alerte === 'string' && typeof h.joueur === 'string' && isInt(h.jours, 1, 366)) hits.push({ alerte: h.alerte, playerId: h.joueur, jours: h.jours })
  }
  return { enabled: r.actif === true, readable, hits }
}

// ---------- Mots (neutres, accordés) ----------

const SHORT = new Map<string, string>(WELLNESS_ITEMS.map((x) => [x.key, x.short.toLowerCase()]))
export const noteText = (n: AlertNote) => (n === 'moyenne' ? 'moyenne des notes' : (SHORT.get(n) ?? n))
const days = (n: number, what = 'jour') => `${n} ${what}${n > 1 ? 's' : ''}`
const points = (n: number) => `${n} point${n > 1 ? 's' : ''}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const KIND_LABELS: Record<AlertKind, string> = {
  seuil: 'Note sous un seuil',
  douleur: 'Douleur signalée',
  chute: 'Baisse soudaine',
  silence: 'Pas de réponse',
}

/** Le réglage en une phrase : « Moyenne des notes à 5 ou moins, 3 jours demandés de suite ». */
export function ruleText(r: AlertRule): string {
  const span = r.jours > 1 ? `${days(r.jours)} demandés de suite` : '1 jour demandé'
  switch (r.type) {
    case 'seuil':
      return `${cap(noteText(r.note))} à ${r.max} ou moins, ${span}`
    case 'douleur':
      return `Douleur signalée, ${span}`
    case 'chute':
      return `${cap(noteText(r.note))} en baisse d’au moins ${points(r.baisse)} sur sa moyenne des ${DROP_BASE_DAYS} jours d’avant, ${span}`
    case 'silence':
      return `Pas de réponse, ${span}`
  }
}

/** Ce que montre l'encart pour un jeune : « À recharger · 3 jours de suite », « Pas de réponse depuis 2 jours ». */
export function hitText(r: AlertRule, n: number): string {
  switch (r.type) {
    case 'seuil':
      return `À recharger · ${r.note === 'moyenne' ? '' : `${noteText(r.note)} · `}${days(n)} de suite`
    case 'douleur':
      return `Douleur signalée · ${days(n)} de suite`
    case 'chute':
      return `Baisse de ${points(r.baisse)}${r.note === 'moyenne' ? '' : ` (${noteText(r.note)})`} · ${days(n)} de suite`
    case 'silence':
      return `Pas de réponse depuis ${days(n)}`
  }
}

/** « 2 joueuses concernées », « 1 joueur concerné ». */
export const concernedText = (n: number, g: Gender) => pluralG(n, g, 'joueur concerné')
/** « 3 joueurs suivis : wellness non partagé avec toi » (jamais un nom ni une raison). */
export const notSharedText = (n: number, g: Gender) => `${pluralG(n, g, 'joueur suivi')} : wellness non partagé avec toi`
/** Texte de la notification du matin (aucun nom, aucune note) ; même texte que hb_wellness_alertes_quotidien. */
export const morningText = (n: number) => `${n} alerte${n > 1 ? 's' : ''} wellness sur tes suivis`
/** « Aucun joueur suivi n'est concerné pour l'instant », accordé. */
export const noneText = (g: Gender) => `${cap(accord('aucun joueur suivi', g))} concerné${g === 'F' ? 'e' : ''} pour l’instant.`
