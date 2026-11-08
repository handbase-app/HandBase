/*
 * Wellness du matin et « Ma séance » (espace joueur, supabase/073_wellness.sql) : partie pure (ni Dexie ni React), testée par
 * tools/test-wellness.ts. Écrans : src/components/Wellness.tsx (le jeune, page /moi), src/pages/GroupWellness.tsx (le staff
 * du groupe) ; accès aux données : src/wellnessApi.ts.
 *
 * Champs (responsable du pôle, 08/11) : énergie générale, fraîcheur musculaire, humeur, qualité du sommeil (1 à 10) ;
 * « Douleurs, gênes » oui / non, et si oui : où (points d'une silhouette face / dos, ou texte libre) et intensité (1 à 10).
 * Demandé du lundi au vendredi, le matin ; le week-end n'est jamais un jour « demandé » (taux : completionRate).
 * « Ma séance » : intensité ressentie (RPE, 1 à 10) après une séance, plusieurs par jour ; durée FACULTATIVE (à confirmer avec
 * un jeune du pôle) : charge = RPE × durée seulement quand la durée est là.
 * Mots toujours positifs ou neutres (jamais d'étiquette négative sur un jeune) ; couleurs du staff par rapport à SA PROPRE
 * moyenne (jamais celle des autres). Données de santé de mineurs : fermé par défaut à l'échelle de l'installation (hb_config
 * « wellness » : { actif }), ouvert seulement en mode essai (données fictives) ; jamais envoyé à une IA.
 */

// ---------- Constantes ----------

/** Réglage de l'installation (hb_config, clé « wellness » : { actif }) : fermé par défaut (décision juridique attendue). */
export const WELLNESS_KEY = 'wellness'
/** Mois du début de saison (9 = septembre) : un seul endroit à changer ; même valeur que hb_wellness_mois_saison() (073). */
export const SEASON_START_MONTH = 9
/** Jours gardés après la fin d'une saison avant la purge ; même valeur que hb_wellness_garde_jours() (073). */
export const WELLNESS_GRACE_DAYS = 30
/** Séances par jour au plus (même borne que le serveur). */
export const SESSIONS_PER_DAY = 6
/** Durée d'une séance : minutes, de 1 à 600. */
export const SESSION_MINUTES_MAX = 600
/** Texte libre de la douleur : 120 caractères. */
export const PAIN_TEXT_MAX = 120
/** Points de la silhouette retenus au plus. */
export const PAIN_ZONES_MAX = 12
/** Moyenne personnelle : sur les 28 jours d'avant, avec au moins 3 réponses (sinon pas de couleur). */
export const OWN_AVERAGE_DAYS = 28
export const OWN_AVERAGE_MIN = 3
/** Écart à sa moyenne (sur 10) : jusqu'à −1, « comme d'habitude » ; jusqu'à −2,5, un peu en dessous ; au-delà, nettement. */
export const TONE_USUAL = 1
export const TONE_WELL_BELOW = 2.5
/** Charge : aiguë sur 7 jours, chronique = moyenne par semaine sur 28 jours ; zone habituelle du rapport 0,8 – 1,3. */
export const ACUTE_DAYS = 7
export const CHRONIC_DAYS = 28
export const RATIO_LOW = 0.8
export const RATIO_HIGH = 1.3
export const RATIO_VERY_HIGH = 1.5

// ---------- Questions ----------

export type WellnessKey = 'energie' | 'fraicheur' | 'humeur' | 'sommeil'

/** Les quatre notes du matin, dans l'ordre de l'écran (mêmes clés que hb_wl_scores, 073). */
export const WELLNESS_ITEMS: readonly { key: WellnessKey; label: string; short: string; abbr: string; hint: string }[] = [
  { key: 'energie', label: 'Énergie générale', short: 'Énergie', abbr: 'Éne.', hint: 'Comment tu te sens ce matin' },
  { key: 'fraicheur', label: 'Fraîcheur musculaire', short: 'Fraîcheur', abbr: 'Fra.', hint: 'Tes jambes, tes muscles' },
  { key: 'humeur', label: 'Humeur', short: 'Humeur', abbr: 'Hum.', hint: 'Ton moral du jour' },
  { key: 'sommeil', label: 'Qualité du sommeil', short: 'Sommeil', abbr: 'Som.', hint: 'Ta nuit' },
]
export const WELLNESS_KEYS = WELLNESS_ITEMS.map((x) => x.key)

/** Mot (et émoji) d'une note de 1 à 10 : toujours positif ou neutre. */
export function scaleWord(v: number | undefined | null): { emoji: string; word: string } | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10) return null
  if (v <= 2) return { emoji: '🔋', word: 'À recharger' }
  if (v <= 4) return { emoji: '🌱', word: 'Doucement' }
  if (v <= 6) return { emoji: '🙂', word: 'Correct' }
  if (v <= 8) return { emoji: '😊', word: 'Bien' }
  return { emoji: '🤩', word: 'Au top' }
}

/** Intensité de la douleur (1 à 10) en mots. */
export function painWord(v: number | undefined | null): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10) return null
  return v <= 3 ? 'Légère' : v <= 6 ? 'Moyenne' : 'Forte'
}

/** Intensité ressentie d'une séance (RPE 1 à 10) en mots, comme l'échelle CR-10 simplifiée. */
export function rpeWord(v: number | undefined | null): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10) return null
  return v <= 2 ? 'Très facile' : v <= 4 ? 'Facile' : v <= 6 ? 'Moyenne' : v <= 8 ? 'Difficile' : 'Maximale'
}

// ---------- Silhouette ----------

export type BodySide = 'face' | 'dos'
export interface BodyZone {
  id: string
  label: string
  side: BodySide
  /** Position du point dans la silhouette (repère 100 × 220). */
  x: number
  y: number
}

/**
 * Points de la silhouette (mêmes identifiants que hb_wl_zones_connues, 073). « g » / « d » : gauche / droite DU JEUNE ; de
 * face, sa gauche est à droite de l'écran.
 */
export const BODY_ZONES: readonly BodyZone[] = [
  { id: 'f-tete', label: 'Tête', side: 'face', x: 50, y: 14 },
  { id: 'f-cou', label: 'Cou', side: 'face', x: 50, y: 31 },
  { id: 'f-epaule-d', label: 'Épaule droite', side: 'face', x: 31, y: 41 },
  { id: 'f-epaule-g', label: 'Épaule gauche', side: 'face', x: 69, y: 41 },
  { id: 'f-poitrine', label: 'Poitrine', side: 'face', x: 50, y: 50 },
  { id: 'f-ventre', label: 'Ventre', side: 'face', x: 50, y: 74 },
  { id: 'f-bras-d', label: 'Bras ou coude droit', side: 'face', x: 22, y: 66 },
  { id: 'f-bras-g', label: 'Bras ou coude gauche', side: 'face', x: 78, y: 66 },
  { id: 'f-poignet-d', label: 'Poignet ou main droite', side: 'face', x: 16, y: 98 },
  { id: 'f-poignet-g', label: 'Poignet ou main gauche', side: 'face', x: 84, y: 98 },
  { id: 'f-hanche-d', label: 'Hanche ou aine droite', side: 'face', x: 41, y: 98 },
  { id: 'f-hanche-g', label: 'Hanche ou aine gauche', side: 'face', x: 59, y: 98 },
  { id: 'f-cuisse-d', label: 'Cuisse droite', side: 'face', x: 41, y: 124 },
  { id: 'f-cuisse-g', label: 'Cuisse gauche', side: 'face', x: 59, y: 124 },
  { id: 'f-genou-d', label: 'Genou droit', side: 'face', x: 41, y: 148 },
  { id: 'f-genou-g', label: 'Genou gauche', side: 'face', x: 59, y: 148 },
  { id: 'f-tibia-d', label: 'Tibia droit', side: 'face', x: 41, y: 172 },
  { id: 'f-tibia-g', label: 'Tibia gauche', side: 'face', x: 59, y: 172 },
  { id: 'f-cheville-d', label: 'Cheville ou pied droit', side: 'face', x: 41, y: 200 },
  { id: 'f-cheville-g', label: 'Cheville ou pied gauche', side: 'face', x: 59, y: 200 },
  { id: 'd-nuque', label: 'Nuque', side: 'dos', x: 50, y: 31 },
  { id: 'd-epaule-g', label: 'Épaule gauche (arrière)', side: 'dos', x: 31, y: 41 },
  { id: 'd-epaule-d', label: 'Épaule droite (arrière)', side: 'dos', x: 69, y: 41 },
  { id: 'd-haut-dos', label: 'Haut du dos', side: 'dos', x: 50, y: 54 },
  { id: 'd-bas-dos', label: 'Bas du dos', side: 'dos', x: 50, y: 82 },
  { id: 'd-coude-g', label: 'Coude gauche (arrière)', side: 'dos', x: 22, y: 66 },
  { id: 'd-coude-d', label: 'Coude droit (arrière)', side: 'dos', x: 78, y: 66 },
  { id: 'd-fessier-g', label: 'Fessier gauche', side: 'dos', x: 41, y: 102 },
  { id: 'd-fessier-d', label: 'Fessier droit', side: 'dos', x: 59, y: 102 },
  { id: 'd-ischio-g', label: 'Arrière de la cuisse gauche', side: 'dos', x: 41, y: 126 },
  { id: 'd-ischio-d', label: 'Arrière de la cuisse droite', side: 'dos', x: 59, y: 126 },
  { id: 'd-mollet-g', label: 'Mollet gauche', side: 'dos', x: 41, y: 170 },
  { id: 'd-mollet-d', label: 'Mollet droit', side: 'dos', x: 59, y: 170 },
  { id: 'd-talon-g', label: 'Talon ou tendon d’Achille gauche', side: 'dos', x: 41, y: 202 },
  { id: 'd-talon-d', label: 'Talon ou tendon d’Achille droit', side: 'dos', x: 59, y: 202 },
]
const ZONE_BY_ID = new Map(BODY_ZONES.map((z) => [z.id, z]))
export const zoneLabel = (id: string) => ZONE_BY_ID.get(id)?.label ?? id

// ---------- Ce que le jeune enregistre ----------

export type Scores = Partial<Record<WellnessKey, number>>

/** Le wellness d'un jour (une ligne par jeune et par jour). */
export interface WellnessEntry {
  playerId?: string
  day: string
  scores: Scores
  pain: boolean
  zones?: string[]
  painText?: string
  painLevel?: number
  /** Dernier enregistrement (ISO). */
  at?: string
}

/** « Ma séance ». */
export interface WellnessSession {
  id: string
  playerId?: string
  day: string
  rpe: number
  minutes?: number
  at?: string
}

/** Ce que le formulaire envoie (avant nettoyage). */
export interface WellnessInput {
  scores?: Record<string, unknown>
  pain?: unknown
  zones?: unknown
  painText?: unknown
  painLevel?: unknown
}

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

/** Texte de la douleur (une ligne) : caractères de contrôle, retours à la ligne et espaces répétés → une espace, 120 caractères. */
export function cleanPainText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, PAIN_TEXT_MAX).trim()
  return s || undefined
}

/** Zones gardées : connues, sans doublon, dans l'ordre, 12 au plus. */
export function cleanZones(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const z of v) if (typeof z === 'string' && ZONE_BY_ID.has(z) && !out.includes(z)) out.push(z)
  return out.slice(0, PAIN_ZONES_MAX)
}

/**
 * Nettoyage d'un wellness (même règle que hb_wellness_enregistrer, 073) : notes entières de 1 à 10 sur les clés connues ;
 * sans douleur, ni zone, ni texte, ni intensité ; au moins une note ou une douleur (sinon « valeurs »).
 */
export function cleanEntry(input: WellnessInput, day: string): { ok: true; entry: WellnessEntry } | { ok: false; error: 'valeurs' } {
  const scores: Scores = {}
  for (const k of WELLNESS_KEYS) {
    const v = input.scores?.[k]
    if (isInt(v, 1, 10)) scores[k] = v
  }
  const pain = input.pain === true
  const entry: WellnessEntry = { day, scores, pain }
  if (pain) {
    const zones = cleanZones(input.zones)
    if (zones.length) entry.zones = zones
    const t = cleanPainText(input.painText)
    if (t) entry.painText = t
    if (isInt(input.painLevel, 1, 10)) entry.painLevel = input.painLevel
  }
  if (!Object.keys(scores).length && !pain) return { ok: false, error: 'valeurs' }
  return { ok: true, entry }
}

/** Une séance valable ? RPE entier 1 à 10 ; durée absente ou entière de 1 à 600. */
export function sessionOk(rpe: unknown, minutes: unknown): boolean {
  return isInt(rpe, 1, 10) && (minutes === undefined || minutes === null || isInt(minutes, 1, SESSION_MINUTES_MAX))
}

/** Charge d'une séance (RPE × minutes) ; sans durée : null. */
export const sessionLoad = (s: Pick<WellnessSession, 'rpe' | 'minutes'>) => (typeof s.minutes === 'number' && s.minutes > 0 ? s.rpe * s.minutes : null)

/** Ce que le serveur (ou l'appareil) renvoie → un wellness ; ligne illisible : null. */
export function entryFromRow(r: Record<string, unknown> | null | undefined): WellnessEntry | null {
  if (!r || typeof r.day !== 'string' || !isDay(r.day)) return null
  const c = cleanEntry({ scores: (r.scores ?? {}) as Record<string, unknown>, pain: r.pain, zones: r.zones, painText: r.painText, painLevel: r.painLevel }, r.day)
  if (!c.ok) return null
  return { ...c.entry, ...(typeof r.playerId === 'string' ? { playerId: r.playerId } : {}), ...(typeof r.at === 'string' ? { at: r.at } : {}) }
}

/** Ce que le serveur (ou l'appareil) renvoie → une séance ; ligne illisible : null. */
export function sessionFromRow(r: Record<string, unknown> | null | undefined): WellnessSession | null {
  if (!r || typeof r.id !== 'string' || typeof r.day !== 'string' || !isDay(r.day) || !sessionOk(r.rpe, r.minutes)) return null
  return {
    id: r.id,
    day: r.day,
    rpe: r.rpe as number,
    ...(typeof r.minutes === 'number' ? { minutes: r.minutes } : {}),
    ...(typeof r.playerId === 'string' ? { playerId: r.playerId } : {}),
    ...(typeof r.at === 'string' ? { at: r.at } : {}),
  }
}

// ---------- Jours ----------

export const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
const toUtc = (day: string) => Date.parse(day + 'T00:00:00Z')
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10)
/** Jour décalé de n jours (calendrier, sans fuseau). */
export const addDays = (day: string, n: number) => fromUtc(toUtc(day) + n * 86400000)
/** Nombre de jours de a à b (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86400000)
/** Jour de semaine (lundi → vendredi) ? */
export const isWeekday = (day: string) => {
  const d = new Date(toUtc(day)).getUTCDay()
  return d >= 1 && d <= 5
}

/** Jour du tableau du staff : aujourd'hui en semaine ; le week-end (rien n'est demandé), le dernier vendredi. */
export function staffDay(day: string): string {
  let d = day
  while (!isWeekday(d)) d = addDays(d, -1)
  return d
}

/** Début de la saison qui contient ce jour (1er septembre par défaut ; SEASON_START_MONTH). */
export function seasonStart(day: string, month = SEASON_START_MONTH): string {
  const y = Number(day.slice(0, 4))
  const m = Number(day.slice(5, 7))
  return `${m >= month ? y : y - 1}-${String(month).padStart(2, '0')}-01`
}

/** Premier jour gardé par la purge (même calcul que hb_wellness_purger, 073). */
export const purgeBefore = (today: string) => seasonStart(addDays(today, -WELLNESS_GRACE_DAYS))

/**
 * Taux de réponse sur les JOURS DE SEMAINE d'une période [from, to] (bornes comprises) : jours demandés (lundi → vendredi),
 * jours répondus (jours de semaine distincts de la période), taux (null s'il n'y a aucun jour demandé). Pur et réutilisable
 * (jauge de la saison plus tard) ; aucun écran de récompense ici.
 */
export function completionRate(answeredDays: Iterable<string>, from: string, to: string): { requested: number; answered: number; rate: number | null } {
  if (!isDay(from) || !isDay(to) || to < from) return { requested: 0, answered: 0, rate: null }
  let requested = 0
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) requested++
  const seen = new Set<string>()
  for (const d of answeredDays) if (isDay(d) && d >= from && d <= to && isWeekday(d)) seen.add(d)
  return { requested, answered: seen.size, rate: requested ? seen.size / requested : null }
}

// ---------- Moyenne personnelle et couleurs ----------

/** Moyenne d'une note sur les `days` jours AVANT `day` (sans lui) ; moins de `min` réponses : null. */
export function ownAverage(entries: readonly WellnessEntry[], key: WellnessKey, day: string, days = OWN_AVERAGE_DAYS, min = OWN_AVERAGE_MIN): number | null {
  const from = addDays(day, -days)
  const vs = entries.filter((e) => e.day < day && e.day >= from && typeof e.scores[key] === 'number').map((e) => e.scores[key] as number)
  return vs.length >= min ? vs.reduce((a, b) => a + b, 0) / vs.length : null
}

/** Ton d'une note par rapport à SA moyenne : « usual » (vert : comme d'habitude ou mieux), « below » (ambre), « wellBelow » (rouge doux), « none ». */
export type Tone = 'usual' | 'below' | 'wellBelow' | 'none'
export function toneVsAverage(value: number | undefined | null, avg: number | null | undefined): Tone {
  if (typeof value !== 'number' || typeof avg !== 'number') return 'none'
  const d = value - avg
  if (d >= -TONE_USUAL) return 'usual'
  if (d > -TONE_WELL_BELOW) return 'below'
  return 'wellBelow'
}
/** Mots du staff pour un ton (jamais une étiquette dure). */
export const TONE_WORDS: Record<Tone, string> = {
  usual: 'comme d’habitude ou mieux',
  below: 'un peu en dessous de sa moyenne',
  wellBelow: 'nettement en dessous de sa moyenne',
  none: 'pas encore de moyenne (moins de 3 réponses)',
}

/** « 7,2 » : une décimale, virgule. */
export const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 })

// ---------- Charge (RPE × durée) ----------

export type ChargeTone = 'usual' | 'more' | 'muchMore' | 'less' | 'none'
export interface ChargeSummary {
  /** Charge des 7 derniers jours (aujourd'hui compris). */
  acute: number
  /** Moyenne par semaine sur les 28 derniers jours. */
  chronicWeekly: number
  /** Rapport aiguë / chronique (null : pas assez d'historique). */
  ratio: number | null
  tone: ChargeTone
  /** Séances des 7 derniers jours, et parmi elles celles sans durée (pas de charge calculée). */
  sessions7: number
  noMinutes7: number
}
export function chargeSummary(sessions: readonly WellnessSession[], today: string): ChargeSummary {
  const fromA = addDays(today, -(ACUTE_DAYS - 1))
  const fromC = addDays(today, -(CHRONIC_DAYS - 1))
  let acute = 0
  let chronic = 0
  let sessions7 = 0
  let noMinutes7 = 0
  for (const s of sessions) {
    if (s.day > today || s.day < fromC) continue
    const l = sessionLoad(s)
    if (l !== null) chronic += l
    if (s.day >= fromA) {
      sessions7++
      if (l === null) noMinutes7++
      else acute += l
    }
  }
  const chronicWeekly = chronic / (CHRONIC_DAYS / 7)
  const ratio = chronicWeekly > 0 ? acute / chronicWeekly : null
  return { acute, chronicWeekly, ratio, tone: chargeTone(ratio), sessions7, noMinutes7 }
}
export function chargeTone(ratio: number | null): ChargeTone {
  if (ratio === null || !Number.isFinite(ratio)) return 'none'
  if (ratio > RATIO_VERY_HIGH) return 'muchMore'
  if (ratio > RATIO_HIGH) return 'more'
  if (ratio < RATIO_LOW) return 'less'
  return 'usual'
}
export const CHARGE_WORDS: Record<ChargeTone, string> = {
  usual: 'habituelle',
  more: 'plus élevée que d’habitude',
  muchMore: 'nettement plus élevée que d’habitude',
  less: 'plus légère que d’habitude',
  none: 'pas encore assez de séances avec durée',
}

// ---------- Tableau du staff ----------

export interface StaffRow {
  /** Réponse du jour (absente : pas encore répondu aujourd'hui). */
  today: WellnessEntry | null
  avg: Record<WellnessKey, number | null>
  tones: Record<WellnessKey, Tone>
  charge: ChargeSummary
  /** Dernière réponse (jour), pour « dernière réponse le … ». */
  lastDay: string | null
}
export function staffRow(entries: readonly WellnessEntry[], sessions: readonly WellnessSession[], today: string): StaffRow {
  const t = entries.find((e) => e.day === today) ?? null
  const avg = {} as Record<WellnessKey, number | null>
  const tones = {} as Record<WellnessKey, Tone>
  for (const k of WELLNESS_KEYS) {
    avg[k] = ownAverage(entries, k, today)
    tones[k] = toneVsAverage(t?.scores[k], avg[k])
  }
  const lastDay = entries.reduce<string | null>((m, e) => (e.day <= today && (!m || e.day > m) ? e.day : m), null)
  return { today: t, avg, tones, charge: chargeSummary(sessions, today), lastDay }
}

/** Ordre du tableau : douleur signalée d'abord, puis le plus de notes nettement en dessous, puis un peu, puis répondu, puis le nom. */
export function staffRank(r: StaffRow): number {
  if (!r.today) return 1000
  const n = (x: Tone) => WELLNESS_KEYS.filter((k) => r.tones[k] === x).length
  return (r.today.pain ? 0 : 100) - n('wellBelow') * 10 - n('below')
}

// ---------- Historique du jeune (14 jours) ----------

export interface MyHistory {
  /** Ses réponses des 14 derniers jours, la plus récente en premier. */
  days: WellnessEntry[]
  /** Moyenne des 14 jours et moyenne de tout ce qui est connu (28 jours), par note. */
  recent: Record<WellnessKey, number | null>
  usual: Record<WellnessKey, number | null>
  /** Une phrase positive. */
  line: string
}
export function myHistory(entries: readonly WellnessEntry[], today: string, days = 14): MyHistory {
  const from = addDays(today, -(days - 1))
  const mine = entries.filter((e) => e.day <= today).sort((a, b) => b.day.localeCompare(a.day))
  const recentList = mine.filter((e) => e.day >= from)
  const mean = (list: readonly WellnessEntry[], k: WellnessKey) => {
    const vs = list.map((e) => e.scores[k]).filter((v): v is number => typeof v === 'number')
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null
  }
  const recent = {} as Record<WellnessKey, number | null>
  const usual = {} as Record<WellnessKey, number | null>
  for (const k of WELLNESS_KEYS) {
    recent[k] = mean(recentList, k)
    usual[k] = mean(mine, k)
  }
  let line: string
  if (!recentList.length) line = 'Tes réponses apparaîtront ici, jour après jour.'
  else if (mine.length < OWN_AVERAGE_MIN) line = 'Merci ! Après quelques matins, tu verras ici tes habitudes.'
  else {
    const lower = WELLNESS_KEYS.filter((k) => recent[k] !== null && usual[k] !== null && (recent[k] as number) < (usual[k] as number) - TONE_USUAL)
    line = lower.length
      ? 'Quelques jours plus doux que d’habitude : écoute ton corps, et parles-en à ton encadrant si tu en as besoin.'
      : 'Belle régularité : tes derniers jours sont au niveau de tes habitudes, ou au-dessus.'
  }
  return { days: recentList, recent, usual, line }
}

// ---------- Réglage de l'installation ----------

type ConfigRow = { id: string; key?: string; value: unknown; deleted?: boolean }
/** Wellness ouvert sur l'installation ? Mode essai ou sans serveur : toujours (données fictives) ; sinon hb_config « wellness ». */
export function wellnessEnabledOf(rows: readonly ConfigRow[] = [], opts: { trial?: boolean; local?: boolean } = {}): boolean {
  if (opts.trial || opts.local) return true
  const row = rows.find((r) => !r.deleted && (r.key ?? r.id) === WELLNESS_KEY)
  const v = row?.value
  return !!v && typeof v === 'object' && (v as Record<string, unknown>).actif === true
}

// ---------- Refus du serveur ----------

export const WELLNESS_ERRORS: Record<string, string> = {
  wellness_ferme: 'Réservé aux essais pour l’instant.',
  pas_demande: 'Le wellness n’est pas demandé dans ton groupe.',
  valeurs: 'Choisis au moins une réponse.',
  jour_ferme: 'Ce jour-là ne se modifie plus.',
  trop: `${SESSIONS_PER_DAY} séances par jour au plus.`,
  seance_inconnue: 'Séance introuvable (déjà retirée ?).',
  trop_long: 'Réponse trop longue.',
  groupe_inconnu: 'Groupe introuvable, ou tu n’en es pas l’encadrant.',
  pas_joueur: 'Réservé au compte du jeune.',
  sans_fiche: 'Ton compte n’est pas encore relié à ta fiche.',
}
/** Fonction ou table absente (script 073 pas passé) : la section se tait. */
export const wellnessMissing = (code?: string) => code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || code === '42883'
export function wellnessErrorText(message?: string | null, code?: string): string {
  if (wellnessMissing(code)) return 'Le wellness n’est pas encore en place sur ce serveur.'
  const k = (message ?? '').trim()
  return WELLNESS_ERRORS[k] ?? (k ? `Impossible : ${k}` : 'Impossible (connexion internet ?).')
}

// ---------- Sur l'appareil (mode essai, fiches de démonstration) ----------

/** Enregistre le wellness du jour dans une liste (un par jour, aujourd'hui seulement : même règle que le serveur). */
export function saveEntryLocal(list: readonly WellnessEntry[], input: WellnessInput, today: string, at: string): { ok: true; list: WellnessEntry[]; saved: WellnessEntry } | { ok: false; error: string } {
  const c = cleanEntry(input, today)
  if (!c.ok) return { ok: false, error: c.error }
  const saved = { ...c.entry, at }
  return { ok: true, saved, list: [saved, ...list.filter((e) => e.day !== today)].sort((a, b) => b.day.localeCompare(a.day)) }
}

/** Ajoute ou modifie une séance d'aujourd'hui ou d'hier (6 par jour au plus). */
export function saveSessionLocal(
  list: readonly WellnessSession[],
  s: { id?: string; day: string; rpe: number; minutes?: number | null },
  today: string,
  newId: () => string,
  at: string,
): { ok: true; list: WellnessSession[]; saved: WellnessSession } | { ok: false; error: string } {
  if (s.day !== today && s.day !== addDays(today, -1)) return { ok: false, error: 'jour_ferme' }
  if (!sessionOk(s.rpe, s.minutes ?? undefined)) return { ok: false, error: 'valeurs' }
  const open = (x: WellnessSession) => x.day === today || x.day === addDays(today, -1)
  if (s.id && !list.some((x) => x.id === s.id && open(x))) return { ok: false, error: 'seance_inconnue' }
  if (!s.id && list.filter((x) => x.day === s.day).length >= SESSIONS_PER_DAY) return { ok: false, error: 'trop' }
  const saved: WellnessSession = { id: s.id ?? newId(), day: s.day, rpe: s.rpe, ...(typeof s.minutes === 'number' ? { minutes: s.minutes } : {}), at }
  return { ok: true, saved, list: [saved, ...list.filter((x) => x.id !== saved.id)].sort((a, b) => b.day.localeCompare(a.day) || (b.at ?? '').localeCompare(a.at ?? '')) }
}

/** Retire une séance d'aujourd'hui ou d'hier. */
export function removeSessionLocal(list: readonly WellnessSession[], id: string, today: string): { ok: true; list: WellnessSession[] } | { ok: false; error: string } {
  const s = list.find((x) => x.id === id)
  if (!s) return { ok: false, error: 'seance_inconnue' }
  if (s.day !== today && s.day !== addDays(today, -1)) return { ok: false, error: 'jour_ferme' }
  return { ok: true, list: list.filter((x) => x.id !== id) }
}

// ---------- Copie RGPD du jeune ----------

/** Son wellness et ses séances, dans « Télécharger mes données » (jamais dans un export du staff). */
export function myWellnessExport(entries: readonly WellnessEntry[], sessions: readonly WellnessSession[]) {
  return {
    wellness: [...entries]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((e) => ({
        jour: e.day,
        energieGenerale: e.scores.energie ?? null,
        fraicheurMusculaire: e.scores.fraicheur ?? null,
        humeur: e.scores.humeur ?? null,
        qualiteDuSommeil: e.scores.sommeil ?? null,
        douleursGenes: e.pain,
        ...(e.pain ? { emplacements: (e.zones ?? []).map(zoneLabel), emplacementEcrit: e.painText ?? null, intensiteDeLaDouleur: e.painLevel ?? null } : {}),
      })),
    mesSeances: [...sessions]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((s) => ({ jour: s.day, intensiteRessentie: s.rpe, dureeEnMinutes: s.minutes ?? null })),
  }
}
