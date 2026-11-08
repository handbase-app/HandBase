/*
 * Wellness du matin et « Ma séance » (espace joueur, supabase/073_wellness.sql) : partie pure (ni Dexie ni React), testée par
 * tools/test-wellness.ts. Écrans : src/components/Wellness.tsx (le jeune, page /moi), src/pages/GroupWellness.tsx (le staff
 * du groupe) ; accès aux données : src/wellnessApi.ts.
 *
 * Champs (responsable du pôle, 08/11) : énergie générale, fraîcheur musculaire, humeur, qualité du sommeil (1 à 10) ;
 * « Douleurs, gênes » oui / non, et si oui : UNE LIGNE PAR ENDROIT (1 à 8 ; nom anatomique et côté du jeune, choisi sur une
 * silhouette face / dos, dans une liste, ou écrit), avec pour chacune ce que c'est (courbatures, gêne, douleur, contracture,
 * coup / choc, autre) et son intensité 1 à 10.
 * Demandé du lundi au vendredi, le matin ; le week-end n'est jamais un jour « demandé » (taux : completionRate).
 * « Ma séance » : intensité ressentie (RPE, 1 à 10) ET durée (obligatoire, le pôle note les deux) après une séance, plusieurs
 * par jour ; charge = RPE × durée.
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
/** Précision d'une douleur (endroit écrit, ou « Autre ») : 80 caractères. */
export const PAIN_TEXT_MAX = 80
/** Endroits douloureux d'un jour : 8 au plus (une ligne chacun). */
export const PAIN_ENTRIES_MAX = 8
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
  { key: 'energie', label: 'Énergie générale', short: 'Énergie', abbr: 'Éne.', hint: 'Ce matin' },
  { key: 'fraicheur', label: 'Fraîcheur musculaire', short: 'Fraîcheur', abbr: 'Fra.', hint: 'Jambes, muscles' },
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
/** Niveau d'une intensité de douleur (couleur du staff, mêmes seuils que painWord). */
export type PainTone = 'light' | 'medium' | 'strong'
export const painTone = (v: number): PainTone => (v <= 3 ? 'light' : v <= 6 ? 'medium' : 'strong')

/** Intensité ressentie d'une séance (RPE 1 à 10) en mots, comme l'échelle CR-10 simplifiée. */
export function rpeWord(v: number | undefined | null): string | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 10) return null
  return v <= 2 ? 'Très facile' : v <= 4 ? 'Facile' : v <= 6 ? 'Moyenne' : v <= 8 ? 'Difficile' : 'Maximale'
}

// ---------- Endroits (noms anatomiques) et silhouette ----------

export type PainSide = 'g' | 'd'
export type BodyView = 'face' | 'dos'

/**
 * Endroits d'une douleur, du haut vers le bas (mêmes identifiants que hb_wl_zones_connues, 073). `sides` : endroit pair, le
 * côté (gauche / droite DU JEUNE) est alors obligatoire, avec l'accord du nom ; sinon, pas de côté. `aka` : mots de la
 * recherche (« cuisse », « talon »…). « autre » : endroit écrit par le jeune (texte obligatoire), en dernier recours.
 */
export interface BodyArea {
  id: string
  label: string
  sides?: { d: string; g: string }
  aka?: string
}
const pair = (d: string, g: string) => ({ d, g })
export const AREA_OTHER = 'autre'
export const BODY_AREAS: readonly BodyArea[] = [
  { id: 'tete', label: 'Tête', aka: 'crane visage machoire' },
  { id: 'nuque', label: 'Nuque / cou', aka: 'cervicales trapeze' },
  { id: 'epaule', label: 'Épaule', sides: pair('Épaule droite', 'Épaule gauche'), aka: 'clavicule coiffe' },
  { id: 'bras', label: 'Bras', sides: pair('Bras droit', 'Bras gauche'), aka: 'biceps triceps' },
  { id: 'coude', label: 'Coude', sides: pair('Coude droit', 'Coude gauche'), aka: 'avant bras' },
  { id: 'poignet', label: 'Poignet', sides: pair('Poignet droit', 'Poignet gauche'), aka: 'avant bras' },
  { id: 'main', label: 'Main / doigts', sides: pair('Main / doigts, côté droit', 'Main / doigts, côté gauche'), aka: 'doigt pouce' },
  { id: 'poitrine', label: 'Poitrine', aka: 'pectoraux cotes thorax' },
  { id: 'dos-haut', label: 'Dos (haut)', aka: 'omoplate dorsales' },
  { id: 'abdos', label: 'Abdominaux', aka: 'ventre abdos obliques' },
  { id: 'lombaires', label: 'Lombaires (bas du dos)', aka: 'reins lombalgie' },
  { id: 'hanche', label: 'Hanche', sides: pair('Hanche droite', 'Hanche gauche'), aka: 'bassin' },
  { id: 'aine', label: 'Aine / pubis', sides: pair('Aine / pubis, côté droit', 'Aine / pubis, côté gauche'), aka: 'pubalgie bassin' },
  { id: 'fessiers', label: 'Fessiers', sides: pair('Fessier droit', 'Fessier gauche'), aka: 'fesse' },
  { id: 'quadriceps', label: 'Quadriceps', sides: pair('Quadriceps droit', 'Quadriceps gauche'), aka: 'cuisse avant' },
  { id: 'ischios', label: 'Ischio-jambiers', sides: pair('Ischio-jambiers droits', 'Ischio-jambiers gauches'), aka: 'cuisse arriere ischios' },
  { id: 'adducteurs', label: 'Adducteurs', sides: pair('Adducteurs droits', 'Adducteurs gauches'), aka: 'cuisse interieur' },
  { id: 'genou', label: 'Genou', sides: pair('Genou droit', 'Genou gauche'), aka: 'rotule menisque' },
  { id: 'tibia', label: 'Tibia', sides: pair('Tibia droit', 'Tibia gauche'), aka: 'jambe periostite' },
  { id: 'mollet', label: 'Mollet', sides: pair('Mollet droit', 'Mollet gauche'), aka: 'jambe' },
  { id: 'achille', label: 'Tendon d’Achille', sides: pair('Tendon d’Achille droit', 'Tendon d’Achille gauche'), aka: 'talon' },
  { id: 'cheville', label: 'Cheville', sides: pair('Cheville droite', 'Cheville gauche'), aka: 'entorse' },
  { id: 'pied', label: 'Pied', sides: pair('Pied droit', 'Pied gauche'), aka: 'orteil talon voute plante' },
  { id: AREA_OTHER, label: 'Autre endroit' },
]
const AREA_BY_ID = new Map(BODY_AREAS.map((a) => [a.id, a]))
export const areaOf = (id: string) => AREA_BY_ID.get(id)
export const isPairedArea = (id: string) => !!AREA_BY_ID.get(id)?.sides

/** Minuscules sans accents (recherche). */
export const foldText = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Recherche dans la liste des endroits (nom, mots voisins, début de mot) ; vide : tous. « autre » toujours au bout. */
export function searchAreas(q: string): BodyArea[] {
  const words = foldText(q).split(' ').filter(Boolean)
  const hit = (a: BodyArea) => {
    const hay = foldText(`${a.label} ${a.aka ?? ''}`).split(' ')
    return words.every((w) => hay.some((h) => h.startsWith(w)))
  }
  return [...BODY_AREAS.filter((a) => a.id !== AREA_OTHER && hit(a)), AREA_BY_ID.get(AREA_OTHER)!]
}

/**
 * Points de la silhouette (repère 120 × 240), un par endroit et par côté. Toucher la silhouette choisit le point le plus
 * proche (zone de toucher bien plus large que le point). De face, la droite du jeune est à GAUCHE de l'écran ; de dos, à
 * droite. Le devant de la cuisse est le quadriceps, l'arrière l'ischio-jambiers, l'intérieur les adducteurs.
 */
export interface SilhouettePoint {
  area: string
  cote?: PainSide
  view: BodyView
  x: number
  y: number
}
/** Un endroit pair : `x` est l'abscisse de la droite du jeune vue DE FACE (moitié gauche de l'écran) ; de dos, elle passe de l'autre côté. */
const both = (area: string, view: BodyView, x: number, y: number): SilhouettePoint[] => {
  const xr = view === 'face' ? x : 120 - x
  return [
    { area, cote: 'd', view, x: xr, y },
    { area, cote: 'g', view, x: 120 - xr, y },
  ]
}
export const SILHOUETTE_POINTS: readonly SilhouettePoint[] = [
  { area: 'tete', view: 'face', x: 60, y: 15 },
  { area: 'nuque', view: 'face', x: 60, y: 32 },
  ...both('epaule', 'face', 38, 45),
  { area: 'poitrine', view: 'face', x: 60, y: 55 },
  ...both('bras', 'face', 28, 62),
  ...both('coude', 'face', 23, 80),
  ...both('poignet', 'face', 18, 103),
  ...both('main', 'face', 16, 122),
  { area: 'abdos', view: 'face', x: 60, y: 81 },
  ...both('hanche', 'face', 41, 99),
  ...both('aine', 'face', 54, 110),
  ...both('quadriceps', 'face', 45, 133),
  ...both('adducteurs', 'face', 55, 144),
  ...both('genou', 'face', 49, 166),
  ...both('tibia', 'face', 50, 192),
  ...both('cheville', 'face', 50, 213),
  ...both('pied', 'face', 48, 228),
  { area: 'tete', view: 'dos', x: 60, y: 15 },
  { area: 'nuque', view: 'dos', x: 60, y: 32 },
  ...both('epaule', 'dos', 38, 45),
  { area: 'dos-haut', view: 'dos', x: 60, y: 60 },
  ...both('bras', 'dos', 28, 62),
  ...both('coude', 'dos', 23, 80),
  ...both('poignet', 'dos', 18, 103),
  ...both('main', 'dos', 16, 122),
  { area: 'lombaires', view: 'dos', x: 60, y: 90 },
  ...both('fessiers', 'dos', 49, 113),
  ...both('ischios', 'dos', 49, 140),
  ...both('genou', 'dos', 49, 166),
  ...both('mollet', 'dos', 50, 189),
  ...both('achille', 'dos', 50, 210),
  ...both('pied', 'dos', 48, 228),
]
/** Point le plus proche de (x, y) sur une vue, à moins de `max` unités ; sinon null (toucher hors du corps). */
export function nearestPoint(view: BodyView, x: number, y: number, max = 20): SilhouettePoint | null {
  let best: SilhouettePoint | null = null
  let bd = max * max
  for (const p of SILHOUETTE_POINTS) {
    if (p.view !== view) continue
    const d = (p.x - x) ** 2 + (p.y - y) ** 2
    if (d <= bd) {
      bd = d
      best = p
    }
  }
  return best
}

// ---------- Douleurs : une ligne par endroit ----------

export type PainType = 'courbatures' | 'gene' | 'douleur' | 'contracture' | 'coup' | 'autre'
/** Ce que c'est (mots neutres ; mêmes identifiants que hb_wl_types, 073). */
export const PAIN_TYPES: readonly { id: PainType; label: string }[] = [
  { id: 'courbatures', label: 'Courbatures' },
  { id: 'gene', label: 'Gêne' },
  { id: 'douleur', label: 'Douleur' },
  { id: 'contracture', label: 'Contracture' },
  { id: 'coup', label: 'Coup / choc' },
  { id: 'autre', label: 'Autre' },
]
const TYPE_BY_ID = new Map(PAIN_TYPES.map((x) => [x.id, x]))
export const painTypeLabel = (id: string) => TYPE_BY_ID.get(id as PainType)?.label ?? id

/** Une douleur : un endroit (et son côté), ce que c'est, son intensité 1 à 10, une précision facultative. */
export interface PainEntry {
  zone: string
  cote?: PainSide
  type: PainType
  texte?: string
  intensite: number
}

/** « Ischio-jambiers droits » ; endroit écrit : son texte. */
export function painPlace(p: Pick<PainEntry, 'zone' | 'cote' | 'texte'>): string {
  if (p.zone === AREA_OTHER) return p.texte || 'Autre endroit'
  const a = AREA_BY_ID.get(p.zone)
  if (!a) return p.zone
  return a.sides && p.cote ? a.sides[p.cote] : a.label
}
/** « Ischio-jambiers droits · Contracture · 6/10 » (précision d'un « Autre » : « Autre : tiraillement »). */
export function painLine(p: PainEntry): string {
  const type = p.type === 'autre' && p.texte && p.zone !== AREA_OTHER ? `Autre : ${p.texte}` : painTypeLabel(p.type)
  return `${painPlace(p)} · ${type} · ${p.intensite}/10`
}
/** Clé d'un endroit (une seule ligne par endroit et par côté). */
export const painKey = (p: Pick<PainEntry, 'zone' | 'cote'>) => `${p.zone}:${p.cote ?? ''}`

// ---------- Ce que le jeune enregistre ----------

export type Scores = Partial<Record<WellnessKey, number>>

/** Le wellness d'un jour (une ligne par jeune et par jour). */
export interface WellnessEntry {
  playerId?: string
  day: string
  scores: Scores
  pain: boolean
  /** Douleur : une ligne par endroit (1 à 8), dans l'ordre choisi. */
  pains?: PainEntry[]
  /** Dernier enregistrement (ISO). */
  at?: string
}

/** Intensité la plus forte des douleurs du jour (null : pas de douleur). */
export const painMax = (e: Pick<WellnessEntry, 'pain' | 'pains'> | null | undefined): number | null =>
  e?.pain && e.pains?.length ? Math.max(...e.pains.map((p) => p.intensite)) : null

/** « Ma séance » : intensité ressentie ET durée (obligatoire : le pôle note les deux). */
export interface WellnessSession {
  id: string
  playerId?: string
  day: string
  rpe: number
  minutes: number
  at?: string
}

/** Ce que le formulaire envoie (avant nettoyage). */
export interface WellnessInput {
  scores?: Record<string, unknown>
  pain?: unknown
  pains?: unknown
}

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi

/** Précision d'une douleur (une ligne) : caractères de contrôle, retours à la ligne et espaces répétés → une espace, 80 caractères. */
export function cleanPainText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, PAIN_TEXT_MAX).trim()
  return s || undefined
}

/**
 * Une douleur valable (même règle que hb_wl_douleurs, 073) : endroit connu ; côté « g » / « d » obligatoire pour un endroit
 * pair, absent sinon ; type connu ; intensité entière 1 à 10 ; précision nettoyée (obligatoire pour « autre endroit ») ; les
 * autres clés sont ignorées. Illisible : null.
 */
export function cleanPain(v: unknown): PainEntry | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const r = v as Record<string, unknown>
  if (typeof r.zone !== 'string' || !AREA_BY_ID.has(r.zone)) return null
  const paired = isPairedArea(r.zone)
  if (paired ? r.cote !== 'g' && r.cote !== 'd' : r.cote !== undefined && r.cote !== null) return null
  if (typeof r.type !== 'string' || !TYPE_BY_ID.has(r.type as PainType)) return null
  if (!isInt(r.intensite, 1, 10)) return null
  if (r.texte !== undefined && r.texte !== null && typeof r.texte !== 'string') return null
  const texte = cleanPainText(r.texte)
  if (r.zone === AREA_OTHER && !texte) return null
  return { zone: r.zone, ...(paired ? { cote: r.cote as PainSide } : {}), type: r.type as PainType, ...(texte ? { texte } : {}), intensite: r.intensite }
}

/** Les douleurs d'un jour : 1 à 8, toutes valables, un endroit (et côté) une seule fois ; sinon null (refus « douleurs »). */
export function cleanPains(v: unknown): PainEntry[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > PAIN_ENTRIES_MAX) return null
  const out: PainEntry[] = []
  for (const x of v) {
    const p = cleanPain(x)
    if (!p || out.some((o) => painKey(o) === painKey(p))) return null
    out.push(p)
  }
  return out
}

/**
 * Nettoyage d'un wellness (même règle que hb_wellness_enregistrer, 073) : notes entières de 1 à 10 sur les clés connues ;
 * douleur : 1 à 8 lignes valables (sinon « douleurs ») ; sans douleur, aucune ligne ; au moins une note ou une douleur
 * (sinon « valeurs »).
 */
export function cleanEntry(input: WellnessInput, day: string): { ok: true; entry: WellnessEntry } | { ok: false; error: 'valeurs' | 'douleurs' } {
  const scores: Scores = {}
  for (const k of WELLNESS_KEYS) {
    const v = input.scores?.[k]
    if (isInt(v, 1, 10)) scores[k] = v
  }
  const pain = input.pain === true
  const entry: WellnessEntry = { day, scores, pain }
  if (pain) {
    const pains = cleanPains(input.pains)
    if (!pains) return { ok: false, error: 'douleurs' }
    entry.pains = pains
  }
  if (!Object.keys(scores).length && !pain) return { ok: false, error: 'valeurs' }
  return { ok: true, entry }
}

/** Une séance valable ? RPE entier 1 à 10 ET durée entière de 1 à 600 minutes. */
export function sessionOk(rpe: unknown, minutes: unknown): boolean {
  return isInt(rpe, 1, 10) && isInt(minutes, 1, SESSION_MINUTES_MAX)
}

/** Charge d'une séance : RPE × minutes. */
export const sessionLoad = (s: Pick<WellnessSession, 'rpe' | 'minutes'>) => s.rpe * s.minutes

/** Ce que le serveur (ou l'appareil) renvoie → un wellness ; ligne illisible : null. */
export function entryFromRow(r: Record<string, unknown> | null | undefined): WellnessEntry | null {
  if (!r || typeof r.day !== 'string' || !isDay(r.day)) return null
  const c = cleanEntry({ scores: (r.scores ?? {}) as Record<string, unknown>, pain: r.pain, pains: r.pains }, r.day)
  if (!c.ok) return null
  return { ...c.entry, ...(typeof r.playerId === 'string' ? { playerId: r.playerId } : {}), ...(typeof r.at === 'string' ? { at: r.at } : {}) }
}

/** Ce que le serveur (ou l'appareil) renvoie → une séance ; ligne illisible (sans durée comprise) : null. */
export function sessionFromRow(r: Record<string, unknown> | null | undefined): WellnessSession | null {
  if (!r || typeof r.id !== 'string' || typeof r.day !== 'string' || !isDay(r.day) || !sessionOk(r.rpe, r.minutes)) return null
  return {
    id: r.id,
    day: r.day,
    rpe: r.rpe as number,
    minutes: r.minutes as number,
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
  /** Séances des 7 derniers jours. */
  sessions7: number
}
export function chargeSummary(sessions: readonly WellnessSession[], today: string): ChargeSummary {
  const fromA = addDays(today, -(ACUTE_DAYS - 1))
  const fromC = addDays(today, -(CHRONIC_DAYS - 1))
  let acute = 0
  let chronic = 0
  let sessions7 = 0
  for (const s of sessions) {
    if (s.day > today || s.day < fromC) continue
    const l = sessionLoad(s)
    chronic += l
    if (s.day >= fromA) {
      sessions7++
      acute += l
    }
  }
  const chronicWeekly = chronic / (CHRONIC_DAYS / 7)
  const ratio = chronicWeekly > 0 ? acute / chronicWeekly : null
  return { acute, chronicWeekly, ratio, tone: chargeTone(ratio), sessions7 }
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
  none: 'pas encore assez de séances',
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

/**
 * Ordre du tableau : douleur signalée d'abord (la plus forte intensité en premier), puis le plus de notes nettement en
 * dessous, puis un peu, puis répondu, puis le nom (pas encore répondu : 1000).
 */
export function staffRank(r: StaffRow): number {
  if (!r.today) return 1000
  const n = (x: Tone) => WELLNESS_KEYS.filter((k) => r.tones[k] === x).length
  const max = painMax(r.today)
  return (max !== null ? -100 - max * 50 : 100) - n('wellBelow') * 10 - n('below')
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
  douleurs: `Pour chaque endroit, dis ce que c’est et son intensité (${PAIN_ENTRIES_MAX} endroits au plus).`,
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
  s: { id?: string; day: string; rpe: number; minutes: number },
  today: string,
  newId: () => string,
  at: string,
): { ok: true; list: WellnessSession[]; saved: WellnessSession } | { ok: false; error: string } {
  if (s.day !== today && s.day !== addDays(today, -1)) return { ok: false, error: 'jour_ferme' }
  if (!sessionOk(s.rpe, s.minutes)) return { ok: false, error: 'valeurs' }
  const open = (x: WellnessSession) => x.day === today || x.day === addDays(today, -1)
  if (s.id && !list.some((x) => x.id === s.id && open(x))) return { ok: false, error: 'seance_inconnue' }
  if (!s.id && list.filter((x) => x.day === s.day).length >= SESSIONS_PER_DAY) return { ok: false, error: 'trop' }
  const saved: WellnessSession = { id: s.id ?? newId(), day: s.day, rpe: s.rpe, minutes: s.minutes, at }
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
        ...(e.pain
          ? {
              douleurs: (e.pains ?? []).map((p) => ({
                endroit: painPlace(p),
                ceQueCEst: painTypeLabel(p.type),
                ...(p.texte && p.zone !== AREA_OTHER ? { precision: p.texte } : {}),
                intensite: p.intensite,
              })),
            }
          : {}),
      })),
    mesSeances: [...sessions]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((s) => ({ jour: s.day, intensiteRessentie: s.rpe, dureeEnMinutes: s.minutes, charge: sessionLoad(s) })),
  }
}
