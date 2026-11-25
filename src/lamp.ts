/*
 * « Lampe d'Aladin » : jauge de la saison de l'espace joueur (règles proposées par le responsable du pôle de Saint-Raphaël,
 * construites le 09/11 avec des valeurs par défaut, à ajuster : chaque nombre est une constante nommée ci-dessous, et le
 * réglage d'installation hb_config « lampe » peut les remplacer). Partie PURE (ni Dexie ni React), testée par
 * tools/test-lampe.ts ; écrans : src/components/PlayerLamp.tsx (le jeune), src/components/LampStaff.tsx (fiche, onglet
 * Wellness), src/pages/GroupLamps.tsx (« Lampes du groupe ») ; données : src/lampApi.ts ; serveur : supabase/074_lampe.sql.
 *
 * LES RÈGLES
 *  - Jours demandés : du lundi au vendredi, hors vacances scolaires (zone A, B ou C de l'académie du site du pôle) et jours
 *    fériés, à partir du début de la lampe (réglage) ou de l'arrivée du jeune s'il est arrivé plus tard.
 *  - Une journée s'allume quand les 3 tâches du jour sont faites : wellness du matin, au moins une « Ma séance » notée pour
 *    ce jour (RPE), cahier du hand (les 3 questions remplies : CAHIER_MIN_FIELDS).
 *  - Saison en 3 trimestres (TRIMESTERS : 1er sept → 31 déc, 1er janv → 31 mars, 1er avril → 30 juin), 30 % chacun : part
 *    du trimestre = 30 % × journées allumées / jours demandés du trimestre (proportionnel). Un trimestre où rien n'a été
 *    demandé (arrivée après sa fin) est neutralisé : son poids passe aux autres (on peut toujours atteindre 90 %).
 *  - Bonus du week-end : cahier de match rempli le samedi ou le dimanche d'une semaine dont tous les jours demandés sont
 *    allumés → + 1 % ; la part « assiduité » (trimestres + bonus) reste plafonnée à 90 %.
 *  - Part des encadrants : 10 %, 5 critères × 2 points (0, 1 ou 2 chacun), donnés par le staff du pôle pour la saison ; ils
 *    s'AJOUTENT seulement (jamais retirés, jamais montrés comme un manque au jeune).
 *  - Lots : 100 % sur la saison gagne un lot ; sinon le meilleur pourcentage gagne un lot plus petit (ex aequo : tous). Le
 *    jeune ne voit JAMAIS de classement ni le chiffre d'un autre : seulement sa lampe.
 * Mots toujours positifs ou neutres (projet : jamais d'étiquette négative sur un jeune).
 */

// ---------- Constantes (valeurs par défaut ; le réglage « lampe » peut les remplacer, cleanLampSettings) ----------

/** Réglage de l'installation (hb_config, clé « lampe ») : { actif, debut, zone, pont, criteres, catalogue, regles }. */
export const LAMP_KEY = 'lampe'
/** Trimestres de la saison : mois-jour de début et de fin ; `y` = 0 l'année de la rentrée, 1 l'année suivante. */
export const TRIMESTERS = [
  { key: 'T1', label: '1er trimestre', short: 'Sept → déc', from: { y: 0, md: '09-01' }, to: { y: 0, md: '12-31' } },
  { key: 'T2', label: '2e trimestre', short: 'Janv → mars', from: { y: 1, md: '01-01' }, to: { y: 1, md: '03-31' } },
  { key: 'T3', label: '3e trimestre', short: 'Avril → juin', from: { y: 1, md: '04-01' }, to: { y: 1, md: '06-30' } },
] as const
export type TrimesterKey = (typeof TRIMESTERS)[number]['key']
/** Mois de la rentrée (9 = septembre) : même valeur que SEASON_START_MONTH (src/wellness.ts) et hb_lp_saison() (074). */
export const LAMP_SEASON_MONTH = 9
/** Part de chaque trimestre (%). */
export const TRIMESTER_SHARE = 30
/** Plafond de la part « assiduité » : trimestres + bonus du week-end (%). */
export const DILIGENCE_CAP = 90
/** Bonus d'un week-end (cahier de match après une semaine complète, %). */
export const WEEKEND_BONUS = 1
/** Part des encadrants (%). */
export const COACH_SHARE = 10
/** Points par critère des encadrants (0, 1 ou 2). */
export const COACH_POINTS_MAX = 2
/** Questions du cahier du hand à remplir pour que la tâche compte (sur 3). */
export const CAHIER_MIN_FIELDS = 3
/** Vœux choisis au plus. */
export const WISHES_MAX = 3
/** Vœux du catalogue au plus (Réglages). */
export const CATALOGUE_MAX = 30
/** Critères des encadrants au plus. */
export const CRITERIA_MAX = 8
/** Écart en dessous duquel deux pourcentages sont égaux (calculs en virgule flottante). */
const EPS = 1e-9

/** Critères des encadrants (libellés du responsable du pôle, modifiables dans Réglages ; clés stables). */
export const DEFAULT_COACH_CRITERIA: readonly LampCriterion[] = [
  { key: 'entrainabilite', label: 'Entraînabilité' },
  { key: 'attitude', label: 'Attitude' },
  { key: 'humeur', label: 'Humeur' },
  { key: 'remise', label: 'Remise en question' },
  { key: 'transformation', label: 'Transformation' },
]

/** Catalogue des vœux par défaut (exemples de la maquette ; l'installation tient le sien dans Réglages). */
export const DEFAULT_WISHES: readonly LampWish[] = [
  { id: 'carte-edf', label: 'Une carte dédicacée d’un joueur de l’équipe de France' },
  { id: 'places-edf', label: 'Des places pour un match de l’équipe de France' },
  { id: 'ballon', label: 'Un ballon signé' },
  { id: 'maillot', label: 'Un maillot dédicacé' },
  { id: 'centre', label: 'La visite d’un centre de formation' },
  { id: 'pro', label: 'Une rencontre avec un joueur pro' },
]

// ---------- Tâches du jour ----------

/** Tâches d'un jour, en bits (le serveur rend le même masque, 074 : hb_lp_bits). */
export const TASK = { wellness: 1, seance: 2, cahier: 4, match: 8 } as const
export type TaskKey = keyof typeof TASK
/** Les 3 tâches qui allument une journée. */
export const DAILY_TASKS = ['wellness', 'seance', 'cahier'] as const satisfies readonly TaskKey[]
export const DAY_COMPLETE = TASK.wellness | TASK.seance | TASK.cahier
export const TASK_LABEL: Record<TaskKey, string> = {
  wellness: 'ton wellness du matin',
  seance: 'ta séance (intensité ressentie)',
  cahier: 'ton cahier du hand',
  match: 'ton cahier de match',
}
export const isComplete = (bits: number | undefined) => ((bits ?? 0) & DAY_COMPLETE) === DAY_COMPLETE

/** Masque par jour à partir des listes de jours de chaque tâche. */
export function dayFlags(lists: Partial<Record<TaskKey, Iterable<string>>>): Map<string, number> {
  const m = new Map<string, number>()
  for (const k of Object.keys(TASK) as TaskKey[]) for (const d of lists[k] ?? []) if (isDay(d)) m.set(d, (m.get(d) ?? 0) | TASK[k])
  return m
}

// ---------- Jours ----------

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
const toUtc = (day: string) => Date.parse(day + 'T00:00:00Z')
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10)
export const addDays = (day: string, n: number) => fromUtc(toUtc(day) + n * 86400000)
/** 0 = dimanche … 6 = samedi. */
export const dow = (day: string) => new Date(toUtc(day)).getUTCDay()
export const isWeekday = (day: string) => dow(day) >= 1 && dow(day) <= 5
/** Lundi de la semaine de ce jour. */
export const mondayOf = (day: string) => addDays(day, -((dow(day) + 6) % 7))
const maxDay = (...xs: (string | undefined)[]) => xs.filter(isDay).sort().at(-1)!

/** Année de la rentrée de la saison qui contient ce jour (2026 pour 2026-2027). */
export function seasonYear(day: string): number {
  const y = Number(day.slice(0, 4))
  return Number(day.slice(5, 7)) >= LAMP_SEASON_MONTH ? y : y - 1
}
/** Bornes des trimestres d'une saison. */
export function trimesterBounds(year: number): { key: TrimesterKey; label: string; short: string; from: string; to: string }[] {
  return TRIMESTERS.map((t) => ({ key: t.key, label: t.label, short: t.short, from: `${year + t.from.y}-${t.from.md}`, to: `${year + t.to.y}-${t.to.md}` }))
}

// ---------- Vacances scolaires et jours fériés ----------

export type Zone = 'A' | 'B' | 'C'
export const ZONES: readonly Zone[] = ['A', 'B', 'C']

export interface SchoolHoliday {
  id: 'toussaint' | 'noel' | 'hiver' | 'printemps' | 'ascension' | 'ete'
  label: string
  /** Absente : toutes les zones. */
  zone?: Zone
  /** Premier et dernier jour sans classe (samedi du départ → veille du lundi de la reprise). */
  from: string
  to: string
  /** Pont (facultatif : réglage « pont »). */
  optional?: boolean
}

/**
 * Calendrier scolaire officiel de la métropole (arrêté du 22 octobre 2025 pour 2026-2027), par année de rentrée. Une saison
 * absente : seuls les week-ends et jours fériés sont retirés (à compléter chaque année : une ligne par vacances).
 */
export const SCHOOL_HOLIDAYS: Record<number, readonly SchoolHoliday[]> = {
  2026: [
    { id: 'toussaint', label: 'Vacances de la Toussaint', from: '2026-10-17', to: '2026-11-01' },
    { id: 'noel', label: 'Vacances de Noël', from: '2026-12-19', to: '2027-01-03' },
    { id: 'hiver', label: 'Vacances d’hiver', zone: 'A', from: '2027-02-13', to: '2027-02-28' },
    { id: 'hiver', label: 'Vacances d’hiver', zone: 'B', from: '2027-02-20', to: '2027-03-07' },
    { id: 'hiver', label: 'Vacances d’hiver', zone: 'C', from: '2027-02-06', to: '2027-02-21' },
    { id: 'printemps', label: 'Vacances de printemps', zone: 'A', from: '2027-04-10', to: '2027-04-25' },
    { id: 'printemps', label: 'Vacances de printemps', zone: 'B', from: '2027-04-17', to: '2027-05-02' },
    { id: 'printemps', label: 'Vacances de printemps', zone: 'C', from: '2027-04-03', to: '2027-04-18' },
    { id: 'ascension', label: 'Pont de l’Ascension', from: '2027-05-06', to: '2027-05-09', optional: true },
    { id: 'ete', label: 'Vacances d’été', from: '2027-07-03', to: '2027-08-31' },
  ],
}

/** Dimanche de Pâques (algorithme de Meeus / Butcher, calendrier grégorien). */
export function easter(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
/** Jours fériés de la métropole d'une année civile (lundi de Pâques, Ascension, lundi de Pentecôte compris). */
export function publicHolidays(year: number): string[] {
  const e = easter(year)
  return [
    ...['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'].map((md) => `${year}-${md}`),
    addDays(e, 1),
    addDays(e, 39),
    addDays(e, 50),
  ].sort()
}
const holidayCache = new Map<number, Set<string>>()
export const isPublicHoliday = (day: string) => {
  const y = Number(day.slice(0, 4))
  let s = holidayCache.get(y)
  if (!s) holidayCache.set(y, (s = new Set(publicHolidays(y))))
  return s.has(day)
}

/** Vacances scolaires qui contiennent ce jour pour cette zone (null : jour de classe, ou zone inconnue). */
export function schoolHolidayOf(day: string, zone: Zone | null | undefined, opts: { pont?: boolean } = {}): SchoolHoliday | null {
  if (!zone) return null
  for (const h of SCHOOL_HOLIDAYS[seasonYear(day)] ?? []) {
    if (h.zone && h.zone !== zone) continue
    if (h.optional && opts.pont === false) continue
    if (day >= h.from && day <= h.to) return h
  }
  return null
}

/** Jour demandé : lundi → vendredi, ni férié, ni en vacances scolaires (zone connue). */
export function isRequestedDay(day: string, zone: Zone | null | undefined, opts: { pont?: boolean } = {}): boolean {
  return isWeekday(day) && !isPublicHoliday(day) && !schoolHolidayOf(day, zone, opts)
}

// ---------- Zone de l'académie ----------

/** Département → zone des vacances (académies de la métropole, découpage en vigueur). Corse et outre-mer : calendriers
 *  propres, absents ici (réglage « zone » de l'installation à défaut). */
export const DEPT_ZONE: Readonly<Record<string, Zone>> = (() => {
  const z: Record<string, Zone> = {}
  const put = (zone: Zone, ds: string) => ds.split(' ').forEach((d) => (z[d] = zone))
  // A : Besançon, Bordeaux, Clermont-Ferrand, Dijon, Grenoble, Limoges, Lyon, Poitiers.
  put('A', '25 39 70 90 24 33 40 47 64 03 15 43 63 21 58 71 89 07 26 38 73 74 19 23 87 01 42 69 16 17 79 86')
  // B : Aix-Marseille, Amiens, Lille, Nancy-Metz, Nantes, Nice, Normandie, Orléans-Tours, Reims, Rennes, Strasbourg.
  put('B', '04 05 13 84 02 60 80 59 62 54 55 57 88 44 49 53 72 85 06 83 14 27 50 61 76 18 28 36 37 41 45 08 10 51 52 22 29 35 56 67 68')
  // C : Créteil, Montpellier, Paris, Toulouse, Versailles.
  put('C', '77 93 94 11 30 34 48 66 75 09 12 31 32 46 65 81 82 78 91 92 95')
  return z
})()

/** Site d'un pôle (src/poles.ts) → département (pour la zone ; le champ Site reste libre : à défaut, le réglage). */
export const POLE_SITE_DEPT: Readonly<Record<string, string>> = {
  lyon: '69', chambery: '73', 'cournon d auvergne': '63', 'clermont ferrand': '63', dijon: '21', besancon: '25',
  'cesson sevigne': '35', brest: '29', rennes: '35', chartres: '28', orleans: '45', strasbourg: '67', 'pont a mousson': '54',
  reims: '51', metz: '57', barr: '67', dunkerque: '59', amiens: '80', tourcoing: '59', eaubonne: '95', 'chatenay malabry': '92',
  fontainebleau: '77', caen: '14', 'le havre': '76', 'bordeaux talence': '33', 'saint yrieix la perche': '87', pau: '64',
  angouleme: '16', montpellier: '34', nimes: '30', toulouse: '31', nantes: '44', 'saint raphael': '83', 'aix en provence': '13',
  ajaccio: '2A', nice: '06',
}
const foldSite = (s = '') =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
export function deptOfSite(site?: string): string | undefined {
  const f = foldSite(site)
  if (!f) return undefined
  if (POLE_SITE_DEPT[f]) return POLE_SITE_DEPT[f]
  // « Aix-en-Provence (Luynes) », « Saint-Raphaël Var Handball » : le nom connu le plus long au début.
  const hit = Object.keys(POLE_SITE_DEPT)
    .filter((k) => f.startsWith(k + ' '))
    .sort((a, b) => b.length - a.length)[0]
  return hit ? POLE_SITE_DEPT[hit] : undefined
}
const normDept = (d?: string) => {
  const s = (d ?? '').trim().toUpperCase()
  return /^\d$/.test(s) ? '0' + s : s
}
/**
 * Zone des vacances du jeune : départements de l'unité Pôle (le premier connu), puis site du pôle, puis réglage de
 * l'installation, puis département de la fiche ; null : inconnue (seuls week-ends et jours fériés retirés).
 */
export function zoneFor(o: { departments?: readonly string[]; site?: string; setting?: Zone; playerDept?: string }): Zone | null {
  for (const d of o.departments ?? []) {
    const z = DEPT_ZONE[normDept(d)]
    if (z) return z
  }
  const ds = deptOfSite(o.site)
  if (ds && DEPT_ZONE[ds]) return DEPT_ZONE[ds]
  if (o.setting && ZONES.includes(o.setting)) return o.setting
  return DEPT_ZONE[normDept(o.playerDept)] ?? null
}

// ---------- Réglage de l'installation ----------

export interface LampCriterion {
  key: string
  label: string
}
export interface LampWish {
  id: string
  label: string
  /** « Offert par … » (marque sur le lot seulement : ni publicité ciblée, ni donnée partagée). */
  by?: string
}
export interface LampRules {
  trimesterShare: number
  diligenceCap: number
  weekendBonus: number
  coachShare: number
  coachPointsMax: number
  cahierMinFields: number
}
export const DEFAULT_RULES: LampRules = {
  trimesterShare: TRIMESTER_SHARE,
  diligenceCap: DILIGENCE_CAP,
  weekendBonus: WEEKEND_BONUS,
  coachShare: COACH_SHARE,
  coachPointsMax: COACH_POINTS_MAX,
  cahierMinFields: CAHIER_MIN_FIELDS,
}
export interface LampSettings {
  /** Ouverte sur l'installation (mode essai : toujours). */
  actif: boolean
  /** Premier jour compté (lancement en cours de saison) ; absent : la rentrée. */
  debut?: string
  /** Zone par défaut quand celle du site n'est pas connue. */
  zone?: Zone
  /** Pont de l'Ascension compté comme vacances (vrai par défaut). */
  pont: boolean
  criteria: LampCriterion[]
  catalogue: LampWish[]
  rules: LampRules
}

const line = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, max).trim() : '')
const slug = (s: string) => foldSite(s).replace(/ /g, '-').slice(0, 32)
const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : def)

/** Réglage « lampe » lu (hb_config) : tout est vérifié, le reste prend la valeur par défaut. */
export function cleanLampSettings(v: unknown, opts: { trial?: boolean } = {}): LampSettings {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const criteria: LampCriterion[] = []
  if (Array.isArray(o.criteres))
    for (const c of o.criteres as unknown[]) {
      const x = c && typeof c === 'object' ? (c as Record<string, unknown>) : {}
      const label = line(x.label, 40)
      const key = typeof x.key === 'string' && /^[a-z0-9_-]{1,32}$/.test(x.key) ? x.key : slug(label)
      if (label && key && !criteria.some((k) => k.key === key) && criteria.length < CRITERIA_MAX) criteria.push({ key, label })
    }
  const catalogue: LampWish[] = []
  if (Array.isArray(o.catalogue))
    for (const c of o.catalogue as unknown[]) {
      const x = c && typeof c === 'object' ? (c as Record<string, unknown>) : {}
      const label = line(x.label, 100)
      const id = typeof x.id === 'string' && /^[a-z0-9_-]{1,32}$/.test(x.id) ? x.id : slug(label)
      const by = line(x.by, 60)
      if (label && id && !catalogue.some((k) => k.id === id) && catalogue.length < CATALOGUE_MAX) catalogue.push({ id, label, ...(by ? { by } : {}) })
    }
  const r = o.regles && typeof o.regles === 'object' ? (o.regles as Record<string, unknown>) : {}
  return {
    actif: opts.trial ? true : o.actif === true,
    ...(isDay(o.debut) ? { debut: o.debut } : {}),
    ...(typeof o.zone === 'string' && ZONES.includes(o.zone as Zone) ? { zone: o.zone as Zone } : {}),
    pont: o.pont !== false,
    criteria: criteria.length ? criteria : [...DEFAULT_COACH_CRITERIA],
    catalogue: Array.isArray(o.catalogue) ? catalogue : [...DEFAULT_WISHES],
    rules: {
      trimesterShare: num(r.trimesterShare, 0, 100 / 3, DEFAULT_RULES.trimesterShare),
      diligenceCap: num(r.diligenceCap, 0, 100, DEFAULT_RULES.diligenceCap),
      weekendBonus: num(r.weekendBonus, 0, 10, DEFAULT_RULES.weekendBonus),
      coachShare: num(r.coachShare, 0, 100, DEFAULT_RULES.coachShare),
      coachPointsMax: Math.round(num(r.coachPointsMax, 1, 5, DEFAULT_RULES.coachPointsMax)),
      cahierMinFields: Math.round(num(r.cahierMinFields, 1, 3, DEFAULT_RULES.cahierMinFields)),
    },
  }
}
/** Valeur à enregistrer dans hb_config (clés du serveur, 074). */
export function lampSettingsValue(s: LampSettings): Record<string, unknown> {
  return {
    actif: s.actif,
    ...(s.debut ? { debut: s.debut } : {}),
    ...(s.zone ? { zone: s.zone } : {}),
    pont: s.pont,
    criteres: s.criteria,
    catalogue: s.catalogue,
    regles: s.rules,
  }
}

// ---------- Part des encadrants ----------

/** Points des encadrants nettoyés : clés des critères, entiers 0 → max. */
export function cleanCoach(v: unknown, criteria: readonly LampCriterion[], max = COACH_POINTS_MAX): Record<string, number> {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const out: Record<string, number> = {}
  for (const c of criteria) {
    const n = o[c.key]
    if (typeof n === 'number' && Number.isInteger(n) && n > 0) out[c.key] = Math.min(max, n)
  }
  return out
}
/** Part des encadrants (%) : coachShare × points / (max × nombre de critères). */
export function coachPart(points: Record<string, number> | undefined, criteria: readonly LampCriterion[], rules: LampRules = DEFAULT_RULES): number {
  if (!criteria.length) return 0
  const c = cleanCoach(points, criteria, rules.coachPointsMax)
  const sum = Object.values(c).reduce((a, b) => a + b, 0)
  return (rules.coachShare * sum) / (rules.coachPointsMax * criteria.length)
}
/** Nouveaux points : jamais en dessous des anciens (« ils s'ajoutent seulement ») ; un administrateur peut corriger. */
export function coachLowered(before: Record<string, number> | undefined, after: Record<string, number>): string[] {
  return Object.keys(before ?? {}).filter((k) => (after[k] ?? 0) < (before?.[k] ?? 0))
}

// ---------- Vœux ----------

/** Vœux choisis : identifiants du catalogue, sans doublon, dans l'ordre, 3 au plus. */
export function cleanWishes(v: unknown, catalogue: readonly LampWish[]): string[] {
  const ids = new Set(catalogue.map((w) => w.id))
  const out: string[] = []
  for (const x of Array.isArray(v) ? v : []) if (typeof x === 'string' && ids.has(x) && !out.includes(x) && out.length < WISHES_MAX) out.push(x)
  return out
}

// ---------- La lampe ----------

export interface LampInput {
  /** Aujourd'hui (jour de Paris). */
  today: string
  /** Arrivée du jeune (début de sa période de pôle, ou activation de son groupe), si après la rentrée. */
  start?: string
  /** Masque des tâches par jour (TASK). */
  days: ReadonlyMap<string, number>
  coach?: Record<string, number>
  zone: Zone | null
  settings: LampSettings
}

export interface TrimesterView {
  key: TrimesterKey
  label: string
  short: string
  from: string
  to: string
  /** Jours demandés du trimestre (depuis le début compté). */
  requested: number
  /** Journées allumées. */
  done: number
  /** Jours demandés déjà passés (avant aujourd'hui) ; jours encore à venir (aujourd'hui compris s'il n'est pas allumé). */
  past: number
  ahead: number
  /** Poids du trimestre (30 %, plus si un trimestre est neutralisé) et part gagnée. */
  weight: number
  share: number
  /** Rien n'a été demandé (arrivée après la fin) : poids donné aux autres. */
  neutral: boolean
  current: boolean
}

export interface LampView {
  season: number
  /** Premier jour compté. */
  start: string
  pct: number
  diligence: number
  /** Trimestres seuls (avant bonus et plafond). */
  trimesters: TrimesterView[]
  bonus: { weeks: string[]; pct: number }
  coach: number
  /** Plus haut pourcentage encore possible (journées à venir allumées, bonus possibles, part des encadrants entière) : ce que
   *  le jeune lit (« elle peut encore atteindre… »). */
  maxPct: number
  /** Pourcentage atteignable en allumant simplement toutes les journées à venir (bonus déjà gagnés seulement, part des
   *  encadrants entière) : « Lot assuré » du staff tant qu'il vaut 100 %. */
  trackPct: number
  onTrack: boolean
  today: { requested: boolean; bits: number; missing: TaskKey[]; complete: boolean; holiday: SchoolHoliday | null; weekend: boolean }
  /** Week-end : la semaine est-elle complète (cahier de match = bonus) et le cahier de match est-il rempli ? */
  weekend: { eligible: boolean; matchDone: boolean } | null
  /** Journées allumées d'affilée (jours demandés) jusqu'à aujourd'hui ; aujourd'hui pas encore allumé ne casse rien. */
  streak: number
  bestStreak: number
  litDays: number
}

export const round1 = (n: number) => Math.round(n * 10) / 10
/** « 42,5 % » */
export const pctText = (n: number) => `${round1(n).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`

export function lampView(input: LampInput): LampView {
  const { today, days, settings, zone } = input
  const rules = settings.rules
  const year = seasonYear(today)
  const bounds = trimesterBounds(year)
  const seasonFrom = bounds[0].from
  const seasonTo = bounds[bounds.length - 1].to
  const start = maxDay(seasonFrom, settings.debut, input.start)
  const req = (d: string) => d >= start && isRequestedDay(d, zone, { pont: settings.pont })
  const lit = (d: string) => d <= today && isComplete(days.get(d))

  const raw = bounds.map((b) => {
    let requested = 0
    let done = 0
    let past = 0
    let ahead = 0
    for (let d = maxDay(b.from, start); d <= b.to; d = addDays(d, 1)) {
      if (!req(d)) continue
      requested++
      if (lit(d)) done++
      else if (d >= today) ahead++
      if (d < today) past++
    }
    return { ...b, requested, done, past, ahead }
  })
  const active = raw.filter((t) => t.requested > 0).length
  const base = rules.trimesterShare * bounds.length
  const trimesters: TrimesterView[] = raw.map((t) => {
    const weight = t.requested ? base / active : 0
    return { ...t, weight, share: t.requested ? (weight * t.done) / t.requested : 0, neutral: !t.requested, current: today >= t.from && today <= t.to }
  })
  const maxTrim = trimesters.reduce((a, t) => a + (t.requested ? (t.weight * (t.done + t.ahead)) / t.requested : 0), 0)

  // Bonus du week-end : semaines (du lundi) avec au moins un jour demandé, tous allumés, et un cahier de match le samedi
  // ou le dimanche (déjà passé ou aujourd'hui).
  const weeks: string[] = []
  let possibleWeeks = 0
  for (let m = mondayOf(start); m <= seasonTo; m = addDays(m, 7)) {
    const wd = [0, 1, 2, 3, 4].map((i) => addDays(m, i)).filter((d) => d <= seasonTo && req(d))
    if (!wd.length) continue
    const sat = addDays(m, 5)
    const sun = addDays(m, 6)
    const allLit = wd.every(lit)
    const match = [sat, sun].some((d) => d <= today && ((days.get(d) ?? 0) & TASK.match) !== 0)
    if (allLit && match) weeks.push(m)
    else if (sun >= today && wd.every((d) => d >= today || lit(d))) possibleWeeks++
  }
  const bonusPct = weeks.length * rules.weekendBonus
  const trimSum = trimesters.reduce((a, t) => a + t.share, 0)
  const diligence = Math.min(rules.diligenceCap, trimSum + bonusPct)
  const coach = coachPart(input.coach, settings.criteria, rules)
  const pct = Math.min(100, diligence + coach)
  const maxDil = Math.min(rules.diligenceCap, maxTrim + (weeks.length + possibleWeeks) * rules.weekendBonus)
  const maxPct = Math.min(100, maxDil + rules.coachShare)
  const trackPct = Math.min(100, Math.min(rules.diligenceCap, maxTrim + bonusPct) + rules.coachShare)

  // Aujourd'hui.
  const bits = days.get(today) ?? 0
  const requestedToday = today >= start && today <= seasonTo && req(today)
  const missing = requestedToday ? DAILY_TASKS.filter((k) => !(bits & TASK[k])) : []
  const weekend = !isWeekday(today)
  let weekendInfo: LampView['weekend'] = null
  if (weekend && today >= start && today <= seasonTo) {
    const m = mondayOf(today)
    const wd = [0, 1, 2, 3, 4].map((i) => addDays(m, i)).filter(req)
    const sat = addDays(m, 5)
    const matchDone = [sat, addDays(m, 6)].some((d) => d <= today && ((days.get(d) ?? 0) & TASK.match) !== 0)
    weekendInfo = { eligible: wd.length > 0 && wd.every(lit), matchDone }
  }

  // Séries : jours demandés allumés d'affilée.
  let streak = 0
  let best = 0
  let run = 0
  let litDays = 0
  const last = today < seasonTo ? today : seasonTo
  for (let d = start; d <= last; d = addDays(d, 1)) {
    if (!req(d)) continue
    if (lit(d)) {
      run++
      litDays++
      best = Math.max(best, run)
    } else if (d < today) run = 0
  }
  streak = run

  return {
    season: year,
    start,
    pct,
    diligence,
    trimesters,
    bonus: { weeks, pct: bonusPct },
    coach,
    maxPct,
    trackPct,
    onTrack: trackPct >= 100 - EPS,
    today: { requested: requestedToday, bits, missing, complete: requestedToday && missing.length === 0, holiday: schoolHolidayOf(today, zone, { pont: settings.pont }), weekend },
    weekend: weekendInfo,
    streak,
    bestStreak: best,
    litDays,
  }
}

/** Phrase positive de ce qui reste aujourd'hui (« Encore ton cahier du hand pour allumer ta journée »). */
export function todayLine(v: LampView): string {
  const t = v.today
  if (t.requested) {
    if (!t.missing.length) return 'Journée allumée ✨ Bravo !'
    const names = t.missing.map((k) => TASK_LABEL[k])
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`
    return `Encore ${list} pour allumer ta journée`
  }
  if (v.weekend) {
    if (v.weekend.eligible) return v.weekend.matchDone ? 'Cahier de match rempli : bonus du week-end gagné ✨' : 'Ta semaine est complète : remplis ton cahier de match pour un bonus'
    return 'C’est le week-end : ton cahier de match t’attend si tu as joué'
  }
  if (t.holiday) return `${t.holiday.label} : rien n’est demandé, profite bien`
  return 'Rien n’est demandé aujourd’hui'
}

// ---------- Lots (staff seulement : le jeune ne voit jamais de classement) ----------

export type LotStatus = 'assure' | 'consolation'
export const LOT_LABEL: Record<LotStatus, string> = { assure: 'Lot assuré', consolation: 'Lot de consolation' }

/**
 * Lots d'un groupe : « Lot assuré » pour qui l'a atteint ou est encore sur la route des 100 % (trackPct : toutes les journées
 * à venir allumées suffisent) ; « Lot de consolation » pour le meilleur pourcentage des autres (au dixième près, tel
 * qu'affiché ; ex aequo : tous ; jamais à 0 %).
 */
export function lampLots(rows: readonly { id: string; pct: number; trackPct: number }[]): Map<string, LotStatus> {
  const out = new Map<string, LotStatus>()
  for (const r of rows) if (r.trackPct >= 100 - EPS) out.set(r.id, 'assure')
  const rest = rows.filter((r) => !out.has(r.id))
  const top = Math.max(0, ...rest.map((r) => round1(r.pct)))
  if (top > 0) for (const r of rest) if (round1(r.pct) === top) out.set(r.id, 'consolation')
  return out
}

// ---------- Contexte d'une fiche ----------

type PeriodLike = { site?: string; from?: string; to?: string }
/**
 * Arrivée et zone d'une fiche pour sa lampe : période de pôle en cours (la plus récente qui couvre aujourd'hui) ; arrivée =
 * son début s'il est dans la saison ; zone = départements de l'unité Pôle, puis site de la période, puis réglage, puis
 * département de la fiche, puis `fallback` (mode essai).
 */
export function lampContext(
  p: { poles?: readonly PeriodLike[]; department?: string } | null | undefined,
  today: string,
  /** `zone` : déjà connue (unité Pôle du groupe, src/components/LampStaff.tsx : unitZone) ; prime sur tout le reste. */
  opts: { zone?: Zone | null; departments?: readonly string[]; setting?: Zone; fallback?: Zone } = {},
): { start?: string; zone: Zone | null } {
  const cur = (p?.poles ?? [])
    .filter((x) => (!x.from || x.from <= today) && (!x.to || x.to >= today))
    .sort((a, b) => (b.from ?? '').localeCompare(a.from ?? ''))[0]
  const seasonFrom = trimesterBounds(seasonYear(today))[0].from
  const start = cur?.from && isDay(cur.from) && cur.from > seasonFrom ? cur.from : undefined
  const zone = opts.zone || zoneFor({ departments: opts.departments, site: cur?.site, setting: opts.setting, playerDept: p?.department }) || opts.fallback || null
  return { ...(start ? { start } : {}), zone }
}

/** Ordre de la vue du staff : pourcentage décroissant, puis nom. */
export function sortLamps<T extends { pct: number; name: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => round1(b.pct) - round1(a.pct) || a.name.localeCompare(b.name, 'fr'))
}
