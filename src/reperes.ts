import type { Criterion } from './db'
import { measureDirection } from './compare'
import { sportContent, type YouthCategory } from './sportContent'

/*
 * Repères des tests physiques (idée reprise de « Génération Bleue », 04/11) : une MÉDAILLE quand un résultat atteint un
 * repère réglé par l'installation. Uniquement du positif (règle de l'appli) : pas de rouge, pas de « pas au niveau » ; un
 * résultat sous le premier repère n'a simplement rien.
 *
 *  - Trois niveaux : Bronze (« Niveau Ligue/Comité »), Argent (« Niveau Pôle »), Or (« Niveau France ») ; libellés réglables.
 *  - Par critère de test mesuré (échelle « number ») ; le sens vient du critère (src/compare.ts, measureDirection : un sprint,
 *    plus bas est mieux ; une détente, plus haut) ou est choisi dans le réglage (temps de gainage…). Sens inconnu : rien.
 *  - Une ligne de repères par sexe (ou les deux) et par âge de saison ou catégorie de jeunes (U13, U15… ; volley M13…, comme
 *    src/rencontres.ts : âge atteint dans l'année où finit la saison de la mesure), ou tous âges. La ligne la plus précise
 *    gagne : le sexe d'abord, puis l'âge, puis la catégorie ; à égalité, la première.
 *  - Valeur égale au repère : atteint.
 *
 * Stockage : une ligne de la configuration de l'installation (table hb_config, clé « reperes », comme « apparence » ou
 * « espace_joueur ») ; le serveur accepte toute clé nouvelle (supabase/044, hb_structure_ok), écriture administrateurs.
 * Aucun barème fédéral réel n'est écrit ici : les repères sont saisis par l'installation (Réglages → Repères des tests).
 *
 * Fichier pur (ni Dexie ni React) : testé par tools/test-reperes.ts.
 */

export type MedalLevel = 'bronze' | 'argent' | 'or'
/** Du plus facile au plus haut. */
export const MEDALS: readonly MedalLevel[] = ['bronze', 'argent', 'or']
export const MEDAL_NAMES: Record<MedalLevel, string> = { bronze: 'Bronze', argent: 'Argent', or: 'Or' }
export const DEFAULT_MEDAL_LABELS: Record<MedalLevel, string> = { bronze: 'Niveau Ligue/Comité', argent: 'Niveau Pôle', or: 'Niveau France' }

/** Clé de la ligne de configuration (hb_config). */
export const REPERES_KEY = 'reperes'

/** Une ligne de repères : pour qui (sexe, âge ou catégorie), et les seuils de chaque médaille (au moins un). */
export interface RepereLine {
  /** Absent : filles et garçons. */
  sex?: 'M' | 'F'
  /** Catégorie de jeunes (code de src/sportContent.ts : U15, M15…). */
  cat?: string
  /** Âge de saison (prioritaire sur la catégorie si les deux étaient posés). */
  age?: number
  bronze?: number
  argent?: number
  or?: number
}

export interface RepereCriterion {
  criterionId: string
  /** Sens choisi dans le réglage (1 : plus haut est mieux, −1 : plus bas) ; absent : celui du critère. */
  dir?: 1 | -1
  lines: RepereLine[]
}

export interface ReperesConfig {
  labels: Record<MedalLevel, string>
  criteria: RepereCriterion[]
}

export const EMPTY_REPERES: ReperesConfig = { labels: { ...DEFAULT_MEDAL_LABELS }, criteria: [] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const MAX_CRITERIA = 200
const MAX_LINES = 60

/** Ligne lue dans une valeur stockée ; sans aucun seuil : null. */
function cleanLine(v: unknown): RepereLine | null {
  if (!isObj(v)) return null
  const out: RepereLine = {}
  if (v.sex === 'M' || v.sex === 'F') out.sex = v.sex
  const age = num(v.age)
  if (age !== undefined && Number.isInteger(age) && age >= 5 && age <= 30) out.age = age
  else if (typeof v.cat === 'string' && v.cat.trim()) out.cat = v.cat.trim().slice(0, 12)
  for (const m of MEDALS) {
    const x = num(v[m])
    if (x !== undefined) out[m] = x
  }
  return MEDALS.some((m) => out[m] !== undefined) ? out : null
}

/** Repères lus dans la valeur stockée (tout ce qui est illisible est écarté ; rien : aucun repère). */
export function cleanReperes(v: unknown): ReperesConfig {
  if (!isObj(v)) return { labels: { ...DEFAULT_MEDAL_LABELS }, criteria: [] }
  const labels = { ...DEFAULT_MEDAL_LABELS }
  if (isObj(v.labels))
    for (const m of MEDALS) {
      const t = v.labels[m]
      if (typeof t === 'string' && t.trim()) labels[m] = t.trim().slice(0, 40)
    }
  const seen = new Set<string>()
  const criteria: RepereCriterion[] = []
  for (const c of Array.isArray(v.criteria) ? v.criteria.slice(0, MAX_CRITERIA) : []) {
    if (!isObj(c) || typeof c.criterionId !== 'string' || !c.criterionId || seen.has(c.criterionId)) continue
    const lines = (Array.isArray(c.lines) ? c.lines.slice(0, MAX_LINES) : []).map(cleanLine).filter((l): l is RepereLine => !!l)
    if (!lines.length) continue
    seen.add(c.criterionId)
    criteria.push({ criterionId: c.criterionId, ...(c.dir === 1 || c.dir === -1 ? { dir: c.dir } : {}), lines })
  }
  return { labels, criteria }
}

/** Repères de l'installation, d'après les lignes de hb_config (non supprimées). */
export function reperesOf(rows: readonly { id: string; key?: string; value: unknown; deleted?: boolean }[]): ReperesConfig {
  return cleanReperes(rows.find((r) => !r.deleted && (r.key ?? r.id) === REPERES_KEY)?.value)
}

/** Des repères sont-ils réglés ? (sans repère, rien ne change à l'écran) */
export const hasReperes = (cfg: ReperesConfig) => cfg.criteria.length > 0

// ---------- Âge, catégorie ----------

/** Année civile où finit la saison qui contient ce jour (1er septembre → 31 août), comme src/rencontres.ts. */
const seasonEndYear = (day: string) => Number(day.slice(0, 4)) + (Number(day.slice(5, 7)) >= 9 ? 1 : 0)

/** Âge de saison le jour `day` (année où finit la saison − année de naissance) ; undefined sans année de naissance. */
export function seasonAge(birthDate: string | undefined | null, day: string): number | undefined {
  if (!birthDate || !/^\d{4}/.test(birthDate) || !/^\d{4}-\d{2}/.test(day)) return undefined
  return seasonEndYear(day) - Number(birthDate.slice(0, 4))
}

/** Ce qu'il faut savoir du joueur pour choisir sa ligne de repères. */
export interface RepereWho {
  sex?: string | null
  birthDate?: string | null
  /** Catégorie écrite sur la fiche : servie seulement sans date de naissance, si c'est un code connu (U15…). */
  category?: string | null
}

/**
 * Ligne de repères qui s'applique à ce joueur pour une mesure du jour `day` : sexe absent ou le sien, âge de saison ou sa
 * catégorie, ou tous âges ; la plus précise (sexe 4, âge 2, catégorie 1), la première à égalité. Sexe inconnu : seulement
 * les lignes « filles et garçons » ; âge inconnu : les lignes « tous âges » (ou sa catégorie écrite, si elle est connue).
 */
export function repereLine(rc: RepereCriterion, who: RepereWho, day: string, cats: readonly YouthCategory[] = sportContent().youthCategories): RepereLine | undefined {
  const age = seasonAge(who.birthDate, day)
  const written = who.category?.trim().toUpperCase()
  const cat = age !== undefined ? cats.find((c) => c.ages.includes(age))?.code : cats.find((c) => c.code.toUpperCase() === written)?.code
  let best: RepereLine | undefined
  let bestScore = -1
  for (const l of rc.lines) {
    if (l.sex && l.sex !== who.sex) continue
    if (l.age !== undefined && l.age !== age) continue
    if (l.age === undefined && l.cat && l.cat !== cat) continue
    const score = (l.sex ? 4 : 0) + (l.age !== undefined ? 2 : l.cat ? 1 : 0)
    if (score > bestScore) {
      best = l
      bestScore = score
    }
  }
  return best
}

/** Valeur numérique d'une mesure (« 12,5 » compris) ; undefined sinon. */
export function numericValue(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string' || !v.trim()) return undefined
  const n = Number(v.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/** Sens retenu pour un critère : celui du réglage, sinon celui du critère (0 : inconnu, aucune médaille). */
export const repereDirection = (rc: Pick<RepereCriterion, 'dir'> | undefined, c: Criterion): 1 | -1 | 0 => rc?.dir ?? measureDirection(c)

/** Plus haute médaille atteinte par `value` sur une ligne, dans le sens `dir` (égal au seuil : atteint). */
export function medalOnLine(line: RepereLine, value: number, dir: 1 | -1): MedalLevel | undefined {
  for (const m of [...MEDALS].reverse()) {
    const s = line[m]
    if (s === undefined) continue
    if (dir === 1 ? value >= s : value <= s) return m
  }
  return undefined
}

/**
 * Médaille d'une mesure : critère mesuré (échelle « number ») avec des repères, sens connu, valeur numérique, ligne qui
 * s'applique au joueur ce jour-là. Sinon undefined (et rien ne s'affiche).
 */
export function medalFor(
  cfg: ReperesConfig,
  c: Criterion | undefined,
  value: unknown,
  who: RepereWho,
  day: string,
  cats?: readonly YouthCategory[],
): MedalLevel | undefined {
  if (!c || c.scale !== 'number' || !cfg.criteria.length) return undefined
  const rc = cfg.criteria.find((x) => x.criterionId === c.id)
  if (!rc) return undefined
  const dir = repereDirection(rc, c)
  const v = numericValue(value)
  if (!dir || v === undefined) return undefined
  const line = repereLine(rc, who, day, cats)
  return line ? medalOnLine(line, v, dir) : undefined
}

/**
 * Seuils d'une ligne dans le bon ordre (Bronze, puis Argent, puis Or de plus en plus difficiles dans le sens du critère) ?
 * Renvoie le message à montrer au réglage, ou null si tout va bien.
 */
export function lineOrderProblem(line: RepereLine, dir: 1 | -1): string | null {
  const set = MEDALS.filter((m) => line[m] !== undefined)
  for (let i = 1; i < set.length; i++) {
    const a = line[set[i - 1]]!
    const b = line[set[i]]!
    if (dir === 1 ? b <= a : b >= a)
      return `${MEDAL_NAMES[set[i]]} doit être ${dir === 1 ? 'plus haut' : 'plus bas'} que ${MEDAL_NAMES[set[i - 1]]}`
  }
  return null
}

/** Pour qui est une ligne : « Filles · U15 », « Garçons · 14 ans », « Tous ». */
export function lineWho(l: RepereLine): string {
  const sex = l.sex === 'F' ? 'Filles' : l.sex === 'M' ? 'Garçons' : ''
  const age = l.age !== undefined ? `${l.age} ans` : (l.cat ?? '')
  return [sex, age].filter(Boolean).join(' · ') || 'Tous'
}
