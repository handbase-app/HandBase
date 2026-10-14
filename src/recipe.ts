// « Poser une question » au bilan de détection : la RECETTE d'une réponse (petit langage JSON typé), sa validation stricte
// et son exécution SUR L'APPAREIL. Fonctions pures, sans base ni écran (testées par tools/test-questions.ts).
//
//  1. buildQuestionSchema : la description de la recette envoyée à la fonction « transcrire » (?mode=question) avec la
//     phrase : clés, opérateurs, valeurs permises (postes, catégories et critères d'avis, mesures, zones du radar).
//     Jamais de données de joueurs ; ni clubs, ni régions, ni départements, ni groupes, ni événements : le modèle recopie
//     ce qui est dit, l'appli le retrouve ici (comme la recherche vocale).
//  2. interpretRecipe : relit la recette rendue par le modèle. Chaque champ est revérifié (inconnu : ignoré et signalé),
//     chaque nom retrouvé dans les listes de l'appli, chaque nombre borné. Le résultat (Recipe) ne contient que des
//     identifiants et des valeurs permises.
//  3. cleanRecipe : même contrôle pour une recette lue dans l'adresse ou dans « Mes questions » (rien n'y est cru).
//  4. buildIndex + runRecipe : exécution, en lecture seule, sur les tableaux de données (joueurs, « vu », avis, mesures,
//     critères, groupes, événements) ; index par joueur, rapide sur 40 000 joueurs. En plus des filtres : tableau par
//     personne du staff, score combiné, progression, « à voir en priorité », tableaux triés par part vue ; moyennes
//     limitées aux critères du poste. answersNothing : question sans rien d'utile (« Je ne sais pas encore répondre »).
//  5. recipeChips : la recette en clair, en pastilles (« Joueuses · nées en 2011 · vues à 1 événement · cette saison »).
// Uniquement des formulations positives ou neutres sur les jeunes : « pas encore vus », tri croissant ou décroissant.

import type { Laterality, Player, Position } from './db'
import { birthYear, clubKey, seasonOf, type Tally } from './coverage'
import { categoryKind, isRadarZone, RADAR_ZONES, type RadarZone } from './radarZones'
import { asText, bestMatch, matchDept, matchRegion, normalize, parseSex, quote, type Places } from './voiceFilters'
import { parseHand, parseHeight, parsePole, POSITION_ALIASES } from './voiceSearch'
import { nameKey, nameTokens } from './nameMatch'
import { cleanSqlSpec, type SqlSpec } from './sqlGuard'

// ---------- Recette ----------

/** Comparaison : égal, au moins, au plus. */
export type Cmp = 'eq' | 'gte' | 'lte'
export type PeriodKind = 'season' | '12m' | 'all' | 'since'
/** Période des « vu » : saison en cours (1er septembre → 31 août), 12 derniers mois, depuis toujours, depuis une date. */
export type Period = { kind: PeriodKind; since?: string }
/** Moyenne d'avis : générale, d'un critère, d'une catégorie ou d'une zone du radar (src/radarZones.ts). */
export type SimpleTarget = { on: 'global' } | { on: 'criterion'; id: string } | { on: 'category'; name: string } | { on: 'zone'; zone: RadarZone }
/** … ou SCORE COMBINÉ : moyenne de 2 à 4 cibles (« Vitesse + Intelligence de jeu »), chacune nécessaire. */
export type AvisTarget = SimpleTarget | { on: 'mix'; parts: SimpleTarget[] }
/** Regroupement ; « staff » : une ligne par personne du staff (joueurs vus distincts, avis écrits), noms lus sur l'appareil. */
export type GroupBy = 'club' | 'dept' | 'region' | 'year' | 'position' | 'sex' | 'staff'
/**
 * Tri. Liste : nom, année, taille, vus, moyenne (ou score combiné), nombre d'avis, mesure, progression (écart entre les
 * deux derniers avis), priorité (« à voir en priorité », règle fixe expliquée à l'écran). Tableau : part (part vue, ou
 * part qui répond), nombre de joueurs qui répondent (« le club qui a le plus de… »), moyenne, vus et avis (staff).
 */
export type SortBy = 'name' | 'year' | 'height' | 'seen' | 'avg' | 'nbAvis' | 'measure' | 'progress' | 'priority' | 'share' | 'count'
export type OutType = 'count' | 'list' | 'table' | 'map'
export type PoleWanted = 'current' | 'past' | 'any'

export type Population = {
  sex?: 'M' | 'F'
  /** Années de naissance, bornes comprises. */
  years?: [number, number]
  positions?: Position[]
  /** Clés de clubs (clubKey). */
  clubs?: string[]
  regions?: string[]
  depts?: string[]
  /** Taille (dernière mesure « taille »), en cm. */
  hMin?: number
  hMax?: number
  hand?: Laterality
  /** Identifiants de groupes et d'événements. */
  groups?: string[]
  events?: string[]
  pole?: PoleWanted
  /** Prénoms ou noms dits (« s'appellent Lucas ») : chaque mot est un mot du prénom ou du nom, sans accents ni majuscules. */
  names?: string[]
}

export type SeenRule = {
  /** Compter les événements distincts (défaut) ou les personnes du staff distinctes. */
  by: 'event' | 'person'
  op: Cmp
  n: number
  period: Period
}
export type AvisRule = { target: AvisTarget; op: 'gte' | 'lte'; value: number }
export type MeasureRule = { id: string; op: 'gte' | 'lte'; value: number }

export type Output = {
  type: OutType
  /** Tableau : regroupement. */
  groupBy?: GroupBy
  /** Tableau : en plus du nombre, part vue dans la période ou moyenne d'avis. */
  value?: 'count' | 'seen' | 'avg'
  /** Tableau : lignes gardées (certains joueurs répondent, tous, aucun). */
  keep?: 'some' | 'all' | 'none'
  sort?: { by: SortBy; dir: 'asc' | 'desc' }
  /** Moyenne utilisée par le tri (moyenne, progression, priorité) ou la colonne « moyenne » ; défaut : celle de la 1re condition d'avis, sinon générale. */
  avg?: AvisTarget
  /** Mesure utilisée par le tri ; défaut : celle de la 1re condition de mesure. */
  measure?: string
  /** Période de la part vue (tableau), du tableau du staff, du tri par « vus » ou par priorité ; défaut : celle de la condition « vu », sinon la saison (affichée). */
  period?: Period
  /** Liste : nombre de joueurs montrés. */
  limit?: number
}

export type Recipe = {
  pop: Population
  seen?: SeenRule
  avis: AvisRule[]
  nbAvis?: { op: Cmp; n: number }
  measures: MeasureRule[]
  out: Output
}

export const EMPTY_RECIPE: Recipe = { pop: {}, avis: [], measures: [], out: { type: 'list' } }

/** Bornes : tout ce qui vient du modèle, de l'adresse ou du stockage y est ramené. */
export const LIMITS = { year: [1950, 2100], n: [0, 100], height: [100, 230], avg: [0, 5], measure: [-100000, 100000], limit: [1, 500], list: 20 } as const
export const DEFAULT_LIMIT = 50
/** Taille : critère « taille » (mêmes données que le filtre de taille de la liste Joueurs). */
export const HEIGHT_ID = 'taille'
const MAX_ITEMS = 20
const MAX_ID = 120
const MAX_NAME = 40
const MAX_NAMES_POP = 5

// ---------- Contexte de l'appli (listes réelles, jamais envoyées hors schéma) ----------

export type QCriterion = { id: string; label: string; category: string; kind: 'factual' | 'subjective'; scale: string; unit?: string; deleted?: boolean; active?: boolean; positions?: Position[] }

export type QuestionContext = Places & {
  positions: { id: Position; label: string }[]
  /** Clubs des joueurs (clé, nom affiché, département de la plupart de leurs joueurs) : retrouvés ici, jamais envoyés. */
  clubs: { key: string; name: string; dept?: string }[]
  groups: { id: string; name: string }[]
  events: { id: string; name: string; date?: string }[]
  criteria: QCriterion[]
  /** Zone du radar d'une catégorie (réglages ; sinon déduite du nom). */
  zoneOf?: (category: string) => RadarZone | null
  /** Jour (AAAA-MM-JJ) : saison en cours, « depuis septembre ». */
  today: string
}

const isScore = (scale: string) => scale === 'score5' || scale === 'score3' || scale === 'score2'
const usable = (c: QCriterion) => !c.deleted && c.active !== false
/** Critères notés dans les avis (échelle de notes). */
export const avisCriteria = (cs: QCriterion[]) => cs.filter((c) => usable(c) && c.kind === 'subjective' && isScore(c.scale))
/** Critères mesurés (valeur chiffrée). */
export const measureCriteria = (cs: QCriterion[]) => cs.filter((c) => usable(c) && c.kind === 'factual' && (c.scale === 'number' || isScore(c.scale)))
export const avisCategories = (cs: QCriterion[]) => [...new Set(avisCriteria(cs).map((c) => c.category))]

const ZONE_HINT: Partial<Record<RadarZone, string>> = { haut: 'mental', 'haut-droite': 'intelligence de jeu', droite: 'attaque', bas: 'physique', gauche: 'défense' }

// ---------- 1. Schéma envoyé avec la phrase ----------

/** Au-delà, les noms de critères ne sont pas listés (le modèle recopie le nom dit, l'appli le retrouve). */
const MAX_NAMES = 80

/**
 * Description compacte de la recette : une ligne par clé (petits modèles : court et explicite). Contient la date du jour
 * (pour « cette saison », « depuis septembre »), les postes, les noms de catégories, de critères d'avis et de mesures
 * (réglages, pas des données de joueurs). Clubs, lieux, groupes et événements ne sont pas listés.
 */
export function buildQuestionSchema(ctx: QuestionContext): Record<string, string> {
  const s = seasonOf(ctx.today)
  const avis = avisCriteria(ctx.criteria)
  const mes = measureCriteria(ctx.criteria)
  const names = (cs: QCriterion[]) => (cs.length <= MAX_NAMES ? cs.map((c) => c.label).join(' | ') : 'nom tel que dit')
  return {
    aujourdhui: `${ctx.today} (saison ${s.label} : du 1er septembre au 31 août)`,
    population:
      'objet, clés facultatives : noms [prénoms ou noms tels que dits], sexe (M ou F), annee (entier) ou annees {de, a}, postes [codes], clubs [noms tels que dits], regions [noms tels que dits], departements [numéros ou noms tels que dits], tailleMin et tailleMax (cm), lateralite (droitier, gaucher, ambidextre), groupes [noms tels que dits], evenements [noms tels que dits], pole (en_cours, sortis, tous)',
    postes: ctx.positions.map((p) => `${p.id} (${p.label.toLowerCase()})`).join(', '),
    vus: 'objet facultatif : compter (evenements par défaut, ou personnes du staff), op (= | >= | <= | aucun), n (entier), periode (omise si non dite : saison en cours | 12mois | toujours | depuis), depuis (date AAAA-MM-JJ ou mois dit)',
    avis: 'liste facultative de conditions : {sur (global | categorie | critere | zone), nom, op (>= | <=), valeur (note sur 5)} ; score combiné : sur "combine", nom [liste de noms]',
    categories: avisCategories(ctx.criteria).join(' | ') || 'aucune',
    criteres: names(avis) || 'aucun',
    zones: RADAR_ZONES.map((z) => `${z.id}${ZONE_HINT[z.id] ? ` (${ZONE_HINT[z.id]})` : ''}`).join(', '),
    nbAvis: 'objet facultatif : {op (= | >= | <=), n} nombre d’avis',
    mesures: 'liste facultative : {critere (nom de mesure), op (>= | <=), valeur}',
    mesuresPossibles: names(mes) || 'aucune',
    sortie:
      'objet : type (nombre | liste | tableau | carte) ; tableau : par (club | departement | region | annee | poste | sexe | staff), valeur (compte | part_vus | moyenne), garder (certains | tous | aucun), tri (compte | part_vus | moyenne | vus | nbAvis), ordre ; liste : tri (nom | annee | taille | vus | moyenne | nbAvis | mesure | progression | priorite), ordre (croissant | decroissant), limite (1 à 500) ; moyenne {sur, nom} (ou {sur:"combine", nom:[noms]}) et mesure (nom) pour le tri ou la colonne ; periode (de la part vue, du staff, de la priorité)',
  }
}

// ---------- Lecture des valeurs ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n))
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : v === undefined || v === null || v === '' ? [] : [v])
const present = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)

/** Nombre (« 3,5 », 3.5, « 40 cm ») ; undefined sinon. */
export function parseNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v !== 'string') return undefined
  const m = /^\s*(-?\d+(?:[.,]\d+)?)/.exec(v)
  return m ? Number(m[1].replace(',', '.')) : undefined
}

/** Opérateur : « = », « >= », « au moins », « plus de » (strict : pour les comptes, n + 1), « aucun »… */
export function parseOp(v: unknown): { op: Cmp; strict?: boolean; none?: boolean } | undefined {
  const raw = asText(v).replace(/\s+/g, ' ')
  if (/^(>=|≥|=>)$/.test(raw)) return { op: 'gte' }
  if (/^(<=|≤|=<)$/.test(raw)) return { op: 'lte' }
  if (/^(=|==)$/.test(raw)) return { op: 'eq' }
  if (raw === '>') return { op: 'gte', strict: true }
  if (raw === '<') return { op: 'lte', strict: true }
  const s = normalize(raw)
  if (/^(aucun|aucune|jamais|zero|0|personne|pas vu|pas encore)/.test(s)) return { op: 'eq', none: true }
  if (/^(au moins|min|minimum|gte|ge|superieur ou egal)/.test(s)) return { op: 'gte' }
  if (/^(plus de|superieur|gt|plus que)/.test(s)) return { op: 'gte', strict: true }
  if (/^(au plus|max|maximum|lte|le|inferieur ou egal|pas plus)/.test(s)) return { op: 'lte' }
  if (/^(moins de|inferieur|lt|moins que)/.test(s)) return { op: 'lte', strict: true }
  if (/^(egal|eq|exactement|pile|seulement)/.test(s)) return { op: 'eq' }
  return undefined
}

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
const pad = (n: number) => String(n).padStart(2, '0')
const validDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

/**
 * « depuis … » : date AAAA-MM-JJ, AAAA-MM, « septembre » (le dernier 1er septembre passé), « 1er janvier 2026 »,
 * « la rentrée » (début de saison). Jamais après aujourd'hui.
 */
export function parseSince(v: unknown, today: string): string | undefined {
  const raw = asText(v)
  let out: string | undefined
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(raw)
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3] ?? 1)]
    if (validDay(y, m, d)) out = `${y}-${pad(m)}-${pad(d)}`
  } else {
    const s = normalize(raw)
    if (/^(la )?rentree|debut (de la )?saison/.test(s)) out = seasonOf(today).from
    const fr = /(?:(\d{1,2})(?:er)? )?(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?: (\d{4}))?/.exec(s)
    if (!out && fr) {
      const m = MONTHS.indexOf(fr[2]) + 1
      const d = fr[1] ? Number(fr[1]) : 1
      let y = fr[3] ? Number(fr[3]) : Number(today.slice(0, 4))
      if (!fr[3] && `${y}-${pad(m)}-${pad(d)}` > today) y--
      if (validDay(y, m, d)) out = `${y}-${pad(m)}-${pad(d)}`
    }
  }
  if (!out || out < '1950-01-01' || out > today) return undefined
  return out
}

export function parsePeriod(v: unknown, since: unknown, today: string): Period | undefined {
  const s = normalize(asText(v))
  if (!s) return present(since) ? (parseSince(since, today) ? { kind: 'since', since: parseSince(since, today) } : undefined) : undefined
  if (/^(saison|cette saison|season|la saison|en cours)/.test(s)) return { kind: 'season' }
  if (/^(12 ?mois|12m|douze mois|annee|l annee|cette annee|un an|12 derniers mois|derniers 12 mois)/.test(s)) return { kind: '12m' }
  if (/^(toujours|depuis toujours|tout|all|toutes|jamais)/.test(s)) return { kind: 'all' }
  if (/^depuis/.test(s)) {
    const d = parseSince(present(since) ? since : asText(v).replace(/^depuis\s*(le\s*)?/i, ''), today)
    return d ? { kind: 'since', since: d } : undefined
  }
  const d = parseSince(v, today)
  return d ? { kind: 'since', since: d } : undefined
}

const ZONE_WORDS: [RegExp, RadarZone][] = [
  [/^(haut|en haut)$/, 'haut'],
  [/haut.*droite/, 'haut-droite'],
  [/haut.*gauche/, 'haut-gauche'],
  [/bas.*droite/, 'bas-droite'],
  [/bas.*gauche/, 'bas-gauche'],
  [/^(bas|en bas)$/, 'bas'],
  [/^(a )?droite$/, 'droite'],
  [/^(a )?gauche$/, 'gauche'],
]

// ---------- 2. Relecture de la réponse du modèle ----------

export type Interpreted = {
  recipe: Recipe
  /** Valeurs écartées : champ inconnu, valeur hors bornes, nom introuvable ou ambigu (en termes neutres). */
  notes: string[]
  /** Ce que le modèle n'a pas su traduire (renvoyé tel quel, nettoyé). */
  unsupported: string[]
}

const KNOWN_TOP = ['population', 'vus', 'avis', 'nbAvis', 'mesures', 'sortie', 'nonGere']
const KNOWN_POP = ['noms', 'nom', 'prenom', 'prenoms', 'sexe', 'annee', 'annees', 'postes', 'poste', 'clubs', 'club', 'regions', 'region', 'departements', 'departement', 'tailleMin', 'tailleMax', 'lateralite', 'groupes', 'groupe', 'evenements', 'evenement', 'pole']
const KNOWN_SEEN = ['compter', 'op', 'n', 'periode', 'depuis']
const KNOWN_OUT = ['type', 'par', 'valeur', 'garder', 'tri', 'ordre', 'moyenne', 'mesure', 'limite', 'periode']

function matchPositionOf(v: unknown, ctx: QuestionContext): Position | undefined {
  const s = asText(v)
  if (!s) return undefined
  const exact = ctx.positions.find((p) => p.id.toLowerCase() === s.toLowerCase())
  if (exact) return exact.id
  const plural = s.replace(/s$/i, '')
  const m = bestMatch(plural, ctx.positions, (p) => [p.label, ...(POSITION_ALIASES[p.id] ?? [])])
  return 'found' in m ? m.found.id : undefined
}

/** Cible d'une moyenne d'avis : { sur, nom } du modèle → AvisTarget (catégorie, critère, zone retrouvés ; liste : score combiné). */
export function readAvisTarget(v: unknown, ctx: QuestionContext, skip: (what: string, why: string) => void): AvisTarget | undefined {
  // Score combiné : liste de cibles ([{sur, nom}, …]), {sur: "combine", nom: [noms]}, ou « Vitesse + Intelligence de jeu ».
  const many: unknown[] | undefined = Array.isArray(v)
    ? v
    : isObj(v) && Array.isArray(v.nom)
      ? v.nom.map((nom) => (isObj(nom) ? nom : { sur: /^combin|^mix|^score/.test(normalize(asText(v.sur))) ? '' : v.sur, nom }))
      : isObj(v) && /\s\+\s/.test(asText(v.nom))
        ? asText(v.nom)
            .split(/\s\+\s/)
            .map((nom) => ({ sur: v.sur, nom }))
        : undefined
  if (many) {
    const parts: SimpleTarget[] = []
    for (const x of many.slice(0, 4)) {
      const t = readAvisTarget(x, ctx, skip)
      if (t && t.on !== 'mix' && !parts.some((y) => sameTarget(y, t))) parts.push(t)
    }
    return parts.length > 1 ? { on: 'mix', parts } : parts[0]
  }
  if (!isObj(v)) {
    if (normalize(asText(v)) === 'global') return { on: 'global' }
    // Nom seul (« Vitesse ») : catégorie ou critère.
    return asText(v) ? readAvisTarget({ nom: asText(v) }, ctx, skip) : undefined
  }
  const on = normalize(asText(v.sur))
  const name = asText(v.nom)
  if (on === 'global' || on === 'generale' || on === 'general' || (!name && (!on || /^categ|^critere/.test(on)))) return { on: 'global' }
  const cats = avisCategories(ctx.criteria)
  const crits = avisCriteria(ctx.criteria)
  const exactCategory = (n: string): string | undefined => {
    const m = bestMatch(n, cats, (c) => [c])
    return 'found' in m ? m.found : undefined
  }
  // Mot dit (« défense », « les défenseurs ») : la catégorie de cette famille (src/radarZones.ts).
  const kindCategory = (n: string): string | undefined => {
    const kind = categoryKind(n.replace(/eurs?\b|euses?\b/gi, 'e'))
    return kind !== 'autre' ? cats.find((c) => categoryKind(c) === kind) : undefined
  }
  const criterion = (n: string) => bestMatch(n, crits, (c) => [c.label, c.id])
  if (on === 'zone') {
    const n = normalize(name)
    const cat = exactCategory(name) ?? kindCategory(name)
    const z = isRadarZone(name) ? name : (ZONE_WORDS.find(([re]) => re.test(n))?.[1] ?? (cat ? ctx.zoneOf?.(cat) : undefined))
    if (z) return { on: 'zone', zone: z }
    skip(`zone ${quote(name)}`, 'zone du radar inconnue')
    return undefined
  }
  if (on === 'critere' || on === 'criteres') {
    const m = criterion(name)
    if ('found' in m) return { on: 'criterion', id: m.found.id }
    // Le modèle a pu nommer une catégorie.
    const c = exactCategory(name) ?? kindCategory(name)
    if (c) return { on: 'category', name: c }
    skip(`critère ${quote(name)}`, 'ambiguous' in m ? 'plusieurs critères possibles' : 'critère d’avis introuvable')
    return undefined
  }
  // Catégorie (défaut) dite telle quelle, sinon critère nommé (« Vitesse », « Explosivité »), sinon famille de catégorie.
  const c = exactCategory(name)
  if (c) return { on: 'category', name: c }
  const m = criterion(name)
  if ('found' in m) return { on: 'criterion', id: m.found.id }
  const k = kindCategory(name)
  if (k) return { on: 'category', name: k }
  skip(`avis ${quote(name)}`, 'catégorie ou critère introuvable')
  return undefined
}

const sameTarget = (a: AvisTarget, b: AvisTarget) => JSON.stringify(a) === JSON.stringify(b)

function readMeasure(v: unknown, ctx: QuestionContext): string | undefined {
  const s = asText(v)
  if (!s) return undefined
  const cs = measureCriteria(ctx.criteria)
  const exact = cs.find((c) => c.id === s)
  if (exact) return exact.id
  const m = bestMatch(s, cs, (c) => [c.label])
  return 'found' in m ? m.found.id : undefined
}

const GROUP_WORDS: Record<string, GroupBy> = {
  club: 'club', clubs: 'club', departement: 'dept', departements: 'dept', dept: 'dept', comite: 'dept', region: 'region', regions: 'region', ligue: 'region',
  annee: 'year', annees: 'year', generation: 'year', generations: 'year', naissance: 'year', poste: 'position', postes: 'position', sexe: 'sex', genre: 'sex',
  staff: 'staff', personne: 'staff', personnes: 'staff', observateur: 'staff', observateurs: 'staff', coach: 'staff', coachs: 'staff', entraineur: 'staff',
  entraineurs: 'staff', encadrant: 'staff', encadrants: 'staff', membre: 'staff', membres: 'staff', auteur: 'staff',
}
const TYPE_WORDS: Record<string, OutType> = { nombre: 'count', combien: 'count', compte: 'count', count: 'count', liste: 'list', list: 'list', tableau: 'table', table: 'table', carte: 'map', map: 'map' }
const SORT_WORDS: Record<string, SortBy> = {
  nom: 'name', name: 'name', annee: 'year', age: 'year', naissance: 'year', taille: 'height', vus: 'seen', vu: 'seen', passages: 'seen',
  moyenne: 'avg', note: 'avg', notes: 'avg', avis: 'avg', score: 'avg', nbavis: 'nbAvis', 'nb avis': 'nbAvis', 'nombre d avis': 'nbAvis', mesure: 'measure', mesures: 'measure',
  progression: 'progress', progres: 'progress', evolution: 'progress', priorite: 'priority', prioritaire: 'priority', prioritaires: 'priority', 'a voir': 'priority',
  part: 'share', 'part vus': 'share', 'part vue': 'share', pourcentage: 'share', taux: 'share',
  compte: 'count', nombre: 'count', effectif: 'count', effectifs: 'count', count: 'count', 'nombre de joueurs': 'count', joueurs: 'count', nb: 'count',
}

/**
 * Relit la recette rendue par le modèle (`raw` : l'objet « recette », `nonGere` : ce qu'il n'a pas su traduire).
 * Tout champ inconnu, toute valeur hors bornes ou introuvable est écarté et signalé ; le reste devient une Recipe.
 */
export function interpretRecipe(raw: unknown, nonGere: unknown, ctx: QuestionContext): Interpreted {
  const notes: string[] = []
  const skip = (what: string, why: string) => notes.push(`${what} (${why})`)
  const top = isObj(raw) ? raw : {}
  // « nonGere » : ce que le modèle n'a pas su traduire, à côté de la recette ou (parfois) dedans ; jamais un champ de recette.
  const unsupported = [...asList(nonGere), ...asList(top.nonGere)]
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter((x, i, xs) => x && xs.indexOf(x) === i)
    .slice(0, 8)
  const r: Recipe = { pop: {}, avis: [], measures: [], out: { type: 'list' } }
  const unknown = (o: Record<string, unknown>, known: string[], where: string) => {
    for (const k of Object.keys(o)) if (!known.includes(k) && present(o[k])) skip(`${where}${quote(k)}`, 'champ inconnu, ignoré')
  }
  unknown(top, KNOWN_TOP, '')
  const thisYear = Number(ctx.today.slice(0, 4))

  // Population.
  const p = isObj(top.population) ? top.population : {}
  unknown(p, KNOWN_POP, 'population ')
  // Prénoms ou noms : recopiés tels que dits, cherchés sans accents (mots entiers du prénom ou du nom).
  const nameList: string[] = []
  for (const v of [...asList(p.noms), ...asList(p.nom), ...asList(p.prenom), ...asList(p.prenoms)]) {
    const t = asText(v).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
    if (!t || !nameKey(t)) skip(`nom ${quote(v)}`, 'illisible')
    else if (!nameList.some((x) => nameKey(x) === nameKey(t))) nameList.push(t)
  }
  if (nameList.length) r.pop.names = nameList.slice(0, MAX_NAMES_POP)
  if (present(p.sexe)) {
    const v = parseSex(p.sexe)
    if (v) r.pop.sex = v
    else skip(`sexe ${quote(p.sexe)}`, 'valeur inconnue')
  }
  const yearOf = (v: unknown) => {
    const n = parseNumber(v)
    return n !== undefined && Number.isInteger(n) && n >= LIMITS.year[0] && n <= thisYear ? n : undefined
  }
  if (present(p.annee) || present(p.annees)) {
    const a = present(p.annees) ? p.annees : p.annee
    let range: [number, number] | undefined
    if (isObj(a)) {
      const lo = yearOf(a.de ?? a.min ?? a.debut)
      const hi = yearOf(a.a ?? a.max ?? a.fin)
      if (lo !== undefined || hi !== undefined) range = [lo ?? hi!, hi ?? lo!]
    } else if (Array.isArray(a) && a.length) {
      const ys = a.map(yearOf)
      if (ys.every((y) => y !== undefined)) range = [Math.min(...(ys as number[])), Math.max(...(ys as number[]))]
    } else {
      const m = /^(\d{4})\s*(?:-|à|a|et)\s*(\d{4})$/.exec(asText(a))
      const y1 = yearOf(m ? m[1] : a)
      const y2 = m ? yearOf(m[2]) : y1
      if (y1 !== undefined && y2 !== undefined) range = [y1, y2]
    }
    if (range) {
      if (range[0] > range[1]) range = [range[1], range[0]]
      if (range[1] - range[0] > 30) range = [range[1] - 30, range[1]]
      r.pop.years = range
    } else skip(`année ${quote(Array.isArray(a) ? a.join('-') : isObj(a) ? `${asText(a.de)}-${asText(a.a)}` : a)}`, 'pas une année de naissance')
  }
  const positions: Position[] = []
  for (const v of [...asList(p.postes), ...asList(p.poste)]) {
    const pos = matchPositionOf(v, ctx)
    if (pos) {
      if (!positions.includes(pos)) positions.push(pos)
    } else skip(`poste ${quote(v)}`, 'valeur inconnue')
  }
  if (positions.length) r.pop.positions = positions
  // Lieux : départements puis régions (une région qui ne contient aucun des départements dits est écartée).
  const depts: string[] = []
  for (const v of [...asList(p.departements), ...asList(p.departement)]) {
    const m = matchDept(v, ctx)
    if ('found' in m) {
      if (!depts.includes(m.found.code)) depts.push(m.found.code)
    } else skip(`département ${quote(v)}`, 'ambiguous' in m ? `plusieurs possibles : ${m.ambiguous.slice(0, 3).map((d) => d.name).join(', ')}` : 'introuvable')
  }
  const regions: string[] = []
  for (const v of [...asList(p.regions), ...asList(p.region)]) {
    const m = matchRegion(v, ctx)
    if ('found' in m) {
      if (depts.length && ctx.regionOfDept && !depts.some((d) => ctx.regionOfDept!(d) === m.found.id)) skip(`région ${quote(m.found.name)}`, 'ne contient pas le département choisi')
      else if (!regions.includes(m.found.id)) regions.push(m.found.id)
    } else skip(`région ${quote(v)}`, 'ambiguous' in m ? 'plusieurs possibles' : 'introuvable')
  }
  if (depts.length) r.pop.depts = depts
  if (regions.length && !depts.length) r.pop.regions = regions
  const clubs: string[] = []
  for (const v of [...asList(p.clubs), ...asList(p.club)]) {
    const s = asText(v)
    const pool = depts.length ? ctx.clubs.filter((c) => c.dept && depts.includes(c.dept)) : ctx.clubs
    const m = bestMatch(s, pool, (c) => [c.name])
    if ('found' in m) clubs.push(m.found.key)
    // Plusieurs clubs de ce nom (« Toulon ») : tous, s'ils sont peu nombreux.
    else if ('ambiguous' in m && m.ambiguous.length <= 5) clubs.push(...m.ambiguous.map((c) => c.key))
    else skip(`club ${quote(s)}`, 'ambiguous' in m ? `${m.ambiguous.length} clubs possibles` : depts.length ? 'introuvable dans ce département' : 'introuvable dans la base')
  }
  if (clubs.length) r.pop.clubs = [...new Set(clubs)].slice(0, MAX_ITEMS)
  if (present(p.tailleMin)) {
    const v = parseHeight(p.tailleMin)
    if (v) r.pop.hMin = v
    else skip(`taille ${quote(p.tailleMin)}`, 'entre 100 et 230 cm')
  }
  if (present(p.tailleMax)) {
    const v = parseHeight(p.tailleMax)
    if (v) r.pop.hMax = v
    else skip(`taille ${quote(p.tailleMax)}`, 'entre 100 et 230 cm')
  }
  if (r.pop.hMin && r.pop.hMax && r.pop.hMin > r.pop.hMax) [r.pop.hMin, r.pop.hMax] = [r.pop.hMax, r.pop.hMin]
  if (present(p.lateralite)) {
    const v = parseHand(p.lateralite)
    if (v) r.pop.hand = v
    else skip(`latéralité ${quote(p.lateralite)}`, 'valeur inconnue')
  }
  const groups: string[] = []
  for (const v of [...asList(p.groupes), ...asList(p.groupe)]) {
    const m = bestMatch(asText(v), ctx.groups, (g) => [g.name])
    if ('found' in m) groups.push(m.found.id)
    else skip(`groupe ${quote(v)}`, 'ambiguous' in m ? 'plusieurs groupes possibles' : 'introuvable')
  }
  if (groups.length) r.pop.groups = [...new Set(groups)]
  const events: string[] = []
  for (const v of [...asList(p.evenements), ...asList(p.evenement)]) {
    const m = bestMatch(asText(v), ctx.events, (e) => [e.name])
    if ('found' in m) events.push(m.found.id)
    else if ('ambiguous' in m) {
      // Même nom chaque année (« Tournoi de Cannes ») : le plus récent.
      const last = [...m.ambiguous].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0]
      events.push(last.id)
      skip(`événement ${quote(v)}`, `${m.ambiguous.length} possibles : le plus récent est pris`)
    } else skip(`événement ${quote(v)}`, 'introuvable')
  }
  if (events.length) r.pop.events = [...new Set(events)]
  if (present(p.pole)) {
    const v = parsePole(p.pole)
    if (v) r.pop.pole = v
    else skip(`Pôle ${quote(p.pole)}`, 'valeur inconnue')
  }

  // Condition « vu ».
  if (isObj(top.vus) && Object.values(top.vus).some(present)) {
    const v = top.vus
    unknown(v, KNOWN_SEEN, 'vus ')
    const by = /^person|^staff|^observ|^membre/.test(normalize(asText(v.compter))) ? 'person' : 'event'
    if (present(v.compter) && by === 'event' && !/^(evenement|evenements|event|fois|passages?)/.test(normalize(asText(v.compter))))
      skip(`compter ${quote(v.compter)}`, 'compté par événement')
    const o = present(v.op) ? parseOp(v.op) : { op: 'gte' as Cmp }
    let n = parseNumber(v.n)
    const period = present(v.periode) || present(v.depuis) ? parsePeriod(v.periode, v.depuis, ctx.today) : { kind: 'season' as const }
    if (present(v.periode) && !period) skip(`période ${quote(v.periode)}${present(v.depuis) ? ` ${quote(v.depuis)}` : ''}`, 'valeur inconnue : cette saison')
    if (!o) skip(`opérateur ${quote(v.op)}`, 'valeur inconnue')
    else {
      if (o.none) n = 0
      if (n === undefined) n = o.op === 'lte' ? 0 : 1
      if (!Number.isInteger(n) || n < LIMITS.n[0] || n > LIMITS.n[1]) skip(`nombre ${quote(v.n)}`, `entier de ${LIMITS.n[0]} à ${LIMITS.n[1]}`)
      else {
        if (o.strict) n = o.op === 'gte' ? n + 1 : n - 1
        if (n < 0) skip(`moins de ${quote(v.n)}`, 'aucun nombre possible')
        else r.seen = { by, op: o.op, n: clamp(n, LIMITS.n), period: period ?? { kind: 'season' } }
      }
    }
  }

  // Conditions d'avis.
  for (const a of asList(top.avis)) {
    if (!isObj(a)) {
      skip(`avis ${quote(a)}`, 'condition illisible')
      continue
    }
    const target = readAvisTarget(a, ctx, skip)
    if (!target) continue
    const o = present(a.op) ? parseOp(a.op) : { op: 'gte' as Cmp }
    const value = parseNumber(a.valeur)
    if (!o || o.op === 'eq' || value === undefined || value < LIMITS.avg[0] || value > LIMITS.avg[1])
      skip(`moyenne ${quote(a.nom ?? a.sur)} ${quote(a.op)} ${quote(a.valeur)}`, `note sur 5, avec >= ou <=`)
    else r.avis.push({ target, op: o.op as 'gte' | 'lte', value: Math.round(value * 100) / 100 })
  }
  if (isObj(top.nbAvis) && present(top.nbAvis.n)) {
    const o = present(top.nbAvis.op) ? parseOp(top.nbAvis.op) : { op: 'gte' as Cmp }
    let n = parseNumber(top.nbAvis.n)
    if (o && n !== undefined && Number.isInteger(n) && n >= 0 && n <= LIMITS.n[1]) {
      if (o.none) n = 0
      if (o.strict) n = o.op === 'gte' ? n + 1 : n - 1
      if (n >= 0) r.nbAvis = { op: o.op, n }
    } else skip(`nombre d’avis ${quote(top.nbAvis.n)}`, `entier de 0 à ${LIMITS.n[1]}`)
  }
  for (const m of asList(top.mesures)) {
    if (!isObj(m)) {
      skip(`mesure ${quote(m)}`, 'condition illisible')
      continue
    }
    const id = readMeasure(m.critere, ctx)
    const o = present(m.op) ? parseOp(m.op) : { op: 'gte' as Cmp }
    const value = id === HEIGHT_ID ? parseHeight(m.valeur) : parseNumber(m.valeur)
    if (!id) skip(`mesure ${quote(m.critere)}`, 'mesure introuvable')
    else if (!o || o.op === 'eq' || value === undefined || value < LIMITS.measure[0] || value > LIMITS.measure[1]) skip(`mesure ${quote(m.critere)} ${quote(m.valeur)}`, 'valeur chiffrée, avec >= ou <=')
    else {
      // Taille : même place que tailleMin / tailleMax.
      if (id === HEIGHT_ID) {
        if (o.op === 'gte') r.pop.hMin = value
        else r.pop.hMax = value
      } else r.measures.push({ id, op: o.op as 'gte' | 'lte', value: Math.round(value * 1000) / 1000 })
    }
  }

  // Sortie.
  const s = isObj(top.sortie) ? top.sortie : {}
  unknown(s, KNOWN_OUT, 'sortie ')
  const type = TYPE_WORDS[normalize(asText(s.type))]
  if (present(s.type) && !type) skip(`sortie ${quote(s.type)}`, 'liste')
  const groupBy = GROUP_WORDS[normalize(asText(s.par)).replace(/^par /, '')]
  if (present(s.par) && !groupBy) skip(`regroupement ${quote(s.par)}`, 'valeur inconnue')
  r.out.type = type ?? (groupBy ? 'table' : 'list')
  if (r.out.type === 'table') r.out.groupBy = groupBy ?? 'club'
  const value = normalize(asText(s.valeur))
  if (r.out.type === 'table' && value) {
    if (/^(part|vus|part vus|pourcentage|taux)/.test(value)) r.out.value = 'seen'
    else if (/^(moyenne|note|avis)/.test(value)) r.out.value = 'avg'
    else if (!/^(compte|nombre|count)/.test(value)) skip(`valeur ${quote(s.valeur)}`, 'nombre de joueurs')
  }
  const keep = normalize(asText(s.garder))
  if (r.out.type === 'table' && keep) {
    if (/^tous|^toutes/.test(keep)) r.out.keep = 'all'
    else if (/^aucun/.test(keep)) r.out.keep = 'none'
  }
  if (present(s.moyenne)) {
    const t = readAvisTarget(s.moyenne, ctx, skip)
    if (t) r.out.avg = t
  }
  if (present(s.mesure)) {
    const id = readMeasure(s.mesure, ctx)
    if (id) r.out.measure = id
    else skip(`mesure ${quote(s.mesure)}`, 'mesure introuvable')
  }
  if (present(s.periode)) {
    const per = parsePeriod(s.periode, undefined, ctx.today)
    if (per) r.out.period = per
    else skip(`période ${quote(s.periode)}`, 'valeur inconnue')
  }
  // Tri inconnu : pas de tri par défaut à la place (jamais une liste triée par nom qui n'a rien à voir) ; dit à l'écran.
  let sortUnknown = false
  if (present(s.tri)) {
    const by = SORT_WORDS[normalize(asText(s.tri))]
    if (by) r.out.sort = { by, dir: by === 'name' ? 'asc' : 'desc' }
    else {
      sortUnknown = true
      unsupported.push(`tri ${quote(s.tri)}`)
    }
  }
  if (present(s.ordre) && !sortUnknown) {
    const o = normalize(asText(s.ordre))
    const dir = /^(croiss|asc|du plus petit|du moins)/.test(o) ? 'asc' : /^(decroiss|desc|du plus grand|du plus haut)/.test(o) ? 'desc' : undefined
    if (!dir) skip(`ordre ${quote(s.ordre)}`, 'valeur inconnue')
    else
      r.out.sort = {
        by: r.out.sort?.by ?? (r.out.avg || r.avis.length ? 'avg' : r.out.type === 'table' ? (r.out.value === 'seen' ? 'share' : 'count') : 'name'),
        dir,
      }
  }
  if (present(s.limite)) {
    const n = parseNumber(s.limite)
    if (n !== undefined && Number.isFinite(n) && n >= 1) r.out.limit = clamp(Math.round(n), LIMITS.limit)
    else skip(`limite ${quote(s.limite)}`, `de ${LIMITS.limit[0]} à ${LIMITS.limit[1]}`)
  }
  if (r.out.limit && r.out.type !== 'list') delete r.out.limit
  return { recipe: settle(r, notes), notes, unsupported }
}

/** Tris possibles d'une liste et d'un tableau. */
const LIST_SORTS: readonly SortBy[] = ['name', 'year', 'height', 'seen', 'avg', 'nbAvis', 'measure', 'progress', 'priority']
const TABLE_SORTS: readonly SortBy[] = ['share', 'avg', 'count']
const STAFF_SORTS: readonly SortBy[] = ['seen', 'nbAvis']

export const hasConditions = (r: Recipe) => !!(r.seen || r.avis.length || r.nbAvis || r.measures.length)
export const hasPopulation = (r: Recipe) => Object.keys(r.pop).length > 0

/**
 * Recette qui ne répond à rien d'utile : ni population, ni condition, et une liste sans tri parlant (tous les joueurs
 * par nom), ou un nombre de tous les joueurs dont une partie n'a pas été comprise. L'écran dit alors « Je ne sais pas encore
 * répondre à … » au lieu de sortir une liste par défaut.
 */
export function answersNothing(r: Recipe, unsupported: readonly string[] = []): boolean {
  if (hasPopulation(r) || hasConditions(r)) return false
  const plainList = r.out.type === 'list' && (!r.out.sort || r.out.sort.by === 'name')
  return plainList || (unsupported.length > 0 && r.out.type === 'count')
}

/** Recette cohérente : tri par moyenne ou mesure avec sa cible, valeurs inutiles retirées. */
function settle(r: Recipe, notes?: string[]): Recipe {
  const out = r.out
  if (out.type !== 'table') {
    delete out.groupBy
    delete out.value
    delete out.keep
  } else if (out.groupBy === 'staff') {
    // Staff : joueurs vus distincts et avis écrits, toujours ; pas de part ni de moyenne.
    delete out.value
    delete out.keep
    if (out.sort && !STAFF_SORTS.includes(out.sort.by)) delete out.sort
  } else if (out.sort) {
    // « vus » sur un tableau : la part vue ; « part » sans condition : la part vue ; « moyenne » : la colonne moyenne.
    if (out.sort.by === 'seen') out.sort.by = 'share'
    if (out.sort.by === 'share' && !out.value && !hasConditions(r)) out.value = 'seen'
    if (out.sort.by === 'avg') out.value = 'avg'
    if (!TABLE_SORTS.includes(out.sort.by)) delete out.sort
  }
  if (out.type === 'list' && out.sort && !LIST_SORTS.includes(out.sort.by)) delete out.sort
  if (out.type !== 'list') {
    delete out.limit
    delete out.measure
    if (out.type !== 'table') delete out.sort
    if (out.type !== 'table' || (out.value !== 'avg' && out.sort?.by !== 'avg')) delete out.avg
  }
  if (out.sort?.by === 'measure' && !out.measure && !r.measures.length) {
    notes?.push('tri par mesure (aucune mesure nommée : tri par nom)')
    out.sort = { by: 'name', dir: 'asc' }
  }
  if (!usesOutPeriod(r)) delete out.period
  return r
}

/** La recette se sert-elle de out.period (part vue d'un tableau, tableau du staff, tri par vus ou par priorité) ? */
export function usesOutPeriod(r: Recipe): boolean {
  const o = r.out
  return (o.type === 'table' && (o.value === 'seen' || o.groupBy === 'staff')) || (o.type === 'list' && (o.sort?.by === 'seen' || o.sort?.by === 'priority'))
}

// ---------- 3. Recette lue dans l'adresse ou le stockage ----------

const POS_IDS: Position[] = ['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV']
// Identifiant ou nom : texte court, sans caractère de contrôle.
const okId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID && [...v].every((c) => c.charCodeAt(0) >= 32)
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter(okId))].slice(0, MAX_ITEMS) : [])
const oneOf = <T extends string>(v: unknown, xs: readonly T[]): T | undefined => (xs as readonly unknown[]).includes(v) ? (v as T) : undefined
const int = (v: unknown, lim: readonly [number, number]) => (typeof v === 'number' && Number.isInteger(v) && v >= lim[0] && v <= lim[1] ? v : undefined)
const num = (v: unknown, lim: readonly [number, number]) => (typeof v === 'number' && Number.isFinite(v) && v >= lim[0] && v <= lim[1] ? v : undefined)

function cleanPeriod(v: unknown): Period | undefined {
  if (!isObj(v)) return undefined
  const kind = oneOf(v.kind, ['season', '12m', 'all', 'since'] as const)
  if (!kind) return undefined
  if (kind !== 'since') return { kind }
  const since = typeof v.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.since) ? v.since : undefined
  return since ? { kind, since } : undefined
}
function cleanTarget(v: unknown): AvisTarget | undefined {
  if (!isObj(v)) return undefined
  if (v.on === 'mix') {
    const parts = (Array.isArray(v.parts) ? v.parts.slice(0, 4) : []).map(cleanTarget).filter((t): t is SimpleTarget => !!t && t.on !== 'mix')
    return parts.length > 1 ? { on: 'mix', parts } : parts[0]
  }
  if (v.on === 'global') return { on: 'global' }
  if (v.on === 'criterion' && okId(v.id)) return { on: 'criterion', id: v.id }
  if (v.on === 'category' && okId(v.name)) return { on: 'category', name: v.name }
  if (v.on === 'zone' && isRadarZone(v.zone)) return { on: 'zone', zone: v.zone }
  return undefined
}

/** Recette venue de l'adresse ou de « Mes questions » : chaque champ revérifié, le reste ignoré. Jamais d'erreur. */
export function cleanRecipe(v: unknown): Recipe {
  const o = isObj(v) ? v : {}
  const p = isObj(o.pop) ? o.pop : {}
  const pop: Population = {}
  const sex = oneOf(p.sex, ['M', 'F'] as const)
  if (sex) pop.sex = sex
  if (Array.isArray(p.years) && p.years.length === 2) {
    const a = int(p.years[0], LIMITS.year)
    const b = int(p.years[1], LIMITS.year)
    if (a !== undefined && b !== undefined) pop.years = a <= b ? [a, b] : [b, a]
  }
  const pos = ids(p.positions).filter((x): x is Position => POS_IDS.includes(x as Position))
  if (pos.length) pop.positions = pos
  for (const k of ['clubs', 'regions', 'depts', 'groups', 'events'] as const) {
    const xs = ids(p[k])
    if (xs.length) pop[k] = xs
  }
  const hMin = int(p.hMin, LIMITS.height)
  const hMax = int(p.hMax, LIMITS.height)
  if (hMin !== undefined) pop.hMin = hMin
  if (hMax !== undefined) pop.hMax = hMax
  const hand = oneOf(p.hand, ['droitier', 'gaucher', 'ambidextre'] as const)
  if (hand) pop.hand = hand
  const pole = oneOf(p.pole, ['current', 'past', 'any'] as const)
  if (pole) pop.pole = pole
  const nm = (Array.isArray(p.names) ? p.names : []).filter((x): x is string => okId(x) && x.length <= MAX_NAME && !!nameKey(x)).slice(0, MAX_NAMES_POP)
  if (nm.length) pop.names = nm
  const r: Recipe = { pop, avis: [], measures: [], out: { type: oneOf(isObj(o.out) ? o.out.type : undefined, ['count', 'list', 'table', 'map'] as const) ?? 'list' } }
  if (isObj(o.seen)) {
    const by = oneOf(o.seen.by, ['event', 'person'] as const) ?? 'event'
    const op = oneOf(o.seen.op, ['eq', 'gte', 'lte'] as const)
    const n = int(o.seen.n, LIMITS.n)
    if (op && n !== undefined) r.seen = { by, op, n, period: cleanPeriod(o.seen.period) ?? { kind: 'season' } }
  }
  for (const a of Array.isArray(o.avis) ? o.avis.slice(0, MAX_ITEMS) : []) {
    const target = isObj(a) ? cleanTarget(a.target) : undefined
    const op = isObj(a) ? oneOf(a.op, ['gte', 'lte'] as const) : undefined
    const value = isObj(a) ? num(a.value, LIMITS.avg) : undefined
    if (target && op && value !== undefined) r.avis.push({ target, op, value })
  }
  if (isObj(o.nbAvis)) {
    const op = oneOf(o.nbAvis.op, ['eq', 'gte', 'lte'] as const)
    const n = int(o.nbAvis.n, LIMITS.n)
    if (op && n !== undefined) r.nbAvis = { op, n }
  }
  for (const m of Array.isArray(o.measures) ? o.measures.slice(0, MAX_ITEMS) : []) {
    const op = isObj(m) ? oneOf(m.op, ['gte', 'lte'] as const) : undefined
    const value = isObj(m) ? num(m.value, LIMITS.measure) : undefined
    if (isObj(m) && okId(m.id) && op && value !== undefined) r.measures.push({ id: m.id, op, value })
  }
  const out = isObj(o.out) ? o.out : {}
  const groupBy = oneOf(out.groupBy, ['club', 'dept', 'region', 'year', 'position', 'sex', 'staff'] as const)
  if (r.out.type === 'table') r.out.groupBy = groupBy ?? 'club'
  const value = oneOf(out.value, ['count', 'seen', 'avg'] as const)
  if (value && value !== 'count') r.out.value = value
  const keep = oneOf(out.keep, ['some', 'all', 'none'] as const)
  if (keep && keep !== 'some') r.out.keep = keep
  if (isObj(out.sort)) {
    const by = oneOf(out.sort.by, ['name', 'year', 'height', 'seen', 'avg', 'nbAvis', 'measure', 'progress', 'priority', 'share', 'count'] as const)
    const dir = oneOf(out.sort.dir, ['asc', 'desc'] as const)
    if (by && dir) r.out.sort = { by, dir }
  }
  const avg = cleanTarget(out.avg)
  if (avg) r.out.avg = avg
  if (okId(out.measure)) r.out.measure = out.measure
  const per = cleanPeriod(out.period)
  if (per) r.out.period = per
  const limit = int(out.limit, LIMITS.limit)
  if (limit !== undefined) r.out.limit = limit
  return settle(r)
}

/** Recette → texte de l'adresse (`?r=`), et retour (jamais d'erreur : recette vide si illisible). */
export const encodeRecipe = (r: Recipe) => JSON.stringify(cleanRecipe(r))
export function decodeRecipe(s: string | null | undefined): Recipe | null {
  if (!s || s.length > 8000) return null
  try {
    return cleanRecipe(JSON.parse(s))
  } catch {
    return null
  }
}

// ---------- 4. Exécution ----------

/** Joueur : champs lus par l'exécution (fiches complètes acceptées). */
export type QPlayer = Pick<Player, 'id' | 'firstName' | 'lastName' | 'birthDate' | 'sex' | 'club' | 'position' | 'secondaryPositions' | 'laterality' | 'poles' | 'deleted' | 'mergedInto' | 'review'>
/** Un passage : joueur vu ce jour-là, à cet événement (ou ce jour d'observation), par cette personne du staff. */
export type QSight = { playerId: string; day: string; event: string; person: string }
/** Avis qui compte (validé, ni supprimé ni hors cadre) : auteur, jour (AAAA-MM-JJ : progression, tableau du staff), notes par critère. */
export type QEval = { playerId: string; observer: string; day?: string; scores: Record<string, number | string> }
export type QMeasure = { playerId: string; criterionId: string; value: number | string; date: string; updatedAt?: number; deleted?: boolean }

export type QData<P extends QPlayer> = {
  players: P[]
  sights: QSight[]
  evals: QEval[]
  measures: QMeasure[]
  criteria: QCriterion[]
  groups: { id: string; playerIds: string[]; deleted?: boolean }[]
  /** Joueurs d'un événement : ceux de sa liste, plus ceux vus ou évalués à cet événement. */
  events: { id: string; playerIds?: string[]; deleted?: boolean }[]
  deptOf: (p: P) => string | undefined
  regionOf: (dept: string) => string | undefined
  zoneOf?: (category: string) => RadarZone | null
  today: string
}

/** `name` : nom puis prénom repliés (sans accents, minuscules) pour trier vite par nom. */
type PlayerInfo = { dept?: string; region?: string; club: string; year: string; pos?: Position; name: string }

export type QIndex<P extends QPlayer> = {
  data: QData<P>
  players: P[]
  info: Map<string, PlayerInfo>
  sights: Map<string, QSight[]>
  evals: Map<string, QEval[]>
  /** Dernière valeur chiffrée de chaque mesure : critère → joueur → valeur. */
  last: Map<string, Map<string, number>>
  groupMembers: Map<string, Set<string>>
  eventMembers: Map<string, Set<string>>
  /** Échelle de chaque critère d'avis (notes ramenées sur 5). */
  norm: Map<string, (v: number) => number | undefined>
  /** Le critère compte-t-il pour un joueur de ce poste (postes du critère ; sinon famille de la catégorie, voir applies) ? */
  applies: (cid: string, pos: Position | undefined, byFamily: boolean) => boolean
  clubNames: Map<string, string>
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const a = m.get(k)
  if (a) a.push(v)
  else m.set(k, [v])
}

/** Index par joueur (une fois par changement des données) : passages, avis, dernières mesures, groupes, événements. */
export function buildIndex<P extends QPlayer>(data: QData<P>): QIndex<P> {
  const players = data.players.filter((p) => !p.deleted && !p.mergedInto && p.review !== 'refused')
  const info = new Map<string, PlayerInfo>()
  const names = new Map<string, Map<string, number>>()
  for (const p of players) {
    const dept = data.deptOf(p)
    const club = clubKey(p.club)
    info.set(p.id, { dept, region: dept ? data.regionOf(dept) : undefined, club, year: birthYear(p), pos: p.position, name: `${fold(p.lastName)}\u0001${fold(p.firstName)}` })
    if (club) {
      const m = names.get(club) ?? new Map<string, number>()
      names.set(club, m)
      m.set(p.club!.trim(), (m.get(p.club!.trim()) ?? 0) + 1)
    }
  }
  const caps = (s: string) => s.replace(/[^A-Z]/g, '').length
  const clubNames = new Map([...names].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1] || caps(b[0]) - caps(a[0]) || a[0].localeCompare(b[0], 'fr'))[0][0]]))
  const sights = new Map<string, QSight[]>()
  for (const s of data.sights) push(sights, s.playerId, s)
  const evals = new Map<string, QEval[]>()
  for (const e of data.evals) push(evals, e.playerId, e)
  // Avis d'un joueur dans l'ordre des jours (progression : les deux derniers).
  for (const es of evals.values()) if (es.length > 1) es.sort((a, b) => (a.day ?? '').localeCompare(b.day ?? ''))
  const lastAt = new Map<string, Map<string, { v: number; date: string; u: number }>>()
  for (const m of data.measures) {
    if (m.deleted) continue
    const v = typeof m.value === 'number' ? m.value : parseNumber(m.value)
    if (v === undefined || !Number.isFinite(v)) continue
    let by = lastAt.get(m.criterionId)
    if (!by) lastAt.set(m.criterionId, (by = new Map()))
    const cur = by.get(m.playerId)
    const u = m.updatedAt ?? 0
    if (!cur || m.date > cur.date || (m.date === cur.date && u > cur.u)) by.set(m.playerId, { v, date: m.date, u })
  }
  const last = new Map([...lastAt].map(([c, by]) => [c, new Map([...by].map(([pid, x]) => [pid, x.v]))]))
  const groupMembers = new Map(data.groups.filter((g) => !g.deleted).map((g) => [g.id, new Set(g.playerIds)]))
  const eventMembers = new Map(data.events.filter((e) => !e.deleted).map((e) => [e.id, new Set(e.playerIds ?? [])]))
  for (const s of data.sights) eventMembers.get(s.event)?.add(s.playerId)
  const norm = new Map<string, (v: number) => number | undefined>()
  for (const c of avisCriteria(data.criteria)) {
    const [lo, hi] = c.scale === 'score5' ? [1, 5] : c.scale === 'score3' ? [0, 3] : [0, 2]
    // Notes ramenées sur 5 (1 → 5) pour comparer des échelles différentes ; une note hors échelle est ignorée.
    norm.set(c.id, (v) => (v < lo || v > hi ? undefined : c.scale === 'score5' ? v : 1 + ((v - lo) * 4) / (hi - lo)))
  }
  // Postes concernés de chaque critère (réglages) et famille de sa catégorie.
  const critPos = new Map<string, Set<Position>>()
  const critKind = new Map<string, string>()
  for (const c of data.criteria) {
    if (c.positions?.length) critPos.set(c.id, new Set(c.positions))
    critKind.set(c.id, categoryKind(c.category))
  }
  const applies = (cid: string, pos: Position | undefined, byFamily: boolean) => {
    const ps = critPos.get(cid)
    if (ps) return !!pos && ps.has(pos)
    if (!byFamily || !pos) return true
    // Sans postes réglés, moyenne d'une catégorie ou d'une zone : un gardien n'y est pas classé sur la défense ou l'attaque
    // des joueurs de champ, un joueur de champ pas sur les catégories de gardien.
    const k = critKind.get(cid)
    return pos === 'GB' ? k !== 'defense' && k !== 'attaque' : k !== 'gardien' && k !== 'gardien-arrets'
  }
  return { data, players, info, sights, evals, last, groupMembers, eventMembers, norm, applies, clubNames }
}

const fold = (s: string | undefined) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

const DAY = 86_400_000
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10)

/** Bornes d'une période (undefined : depuis toujours). */
export function periodRange(p: Period, today: string): { from: string; to: string } | undefined {
  if (p.kind === 'all') return undefined
  if (p.kind === 'season') return seasonOf(today)
  if (p.kind === '12m') return { from: shiftDay(today, -365), to: today }
  return { from: p.since ?? today, to: '9999-12-31' }
}

const test = (op: Cmp, a: number, b: number) => (op === 'eq' ? a === b : op === 'gte' ? a >= b : a <= b)

/** Nombre de « vu » d'un joueur dans la période : événements distincts ou personnes distinctes. */
export function seenCount<P extends QPlayer>(ix: QIndex<P>, pid: string, by: 'event' | 'person', range?: { from: string; to: string }): number {
  const ss = ix.sights.get(pid)
  if (!ss) return 0
  const keys = new Set<string>()
  for (const s of ss) {
    if (range && (s.day < range.from || s.day > range.to)) continue
    keys.add(by === 'event' ? s.event : s.person)
  }
  return keys.size
}

/** Critères d'une cible simple de moyenne (score combiné : ceux de toutes ses parties). */
export function targetCriteria<P extends QPlayer>(ix: QIndex<P>, t: AvisTarget): Set<string> {
  const cs = avisCriteria(ix.data.criteria)
  if (t.on === 'mix') return new Set(t.parts.flatMap((x) => [...targetCriteria(ix, x)]))
  if (t.on === 'global') return new Set(cs.map((c) => c.id))
  if (t.on === 'criterion') return new Set(cs.filter((c) => c.id === t.id).map((c) => c.id))
  if (t.on === 'category') return new Set(cs.filter((c) => c.category === t.name).map((c) => c.id))
  return new Set(cs.filter((c) => (ix.data.zoneOf?.(c.category) ?? null) === t.zone).map((c) => c.id))
}

/** Notes d'un avis sur ces critères (ramenées sur 5, critères du poste seulement) : somme et nombre. */
function evalNotes<P extends QPlayer>(ix: QIndex<P>, e: QEval, crit: Set<string>, pos: Position | undefined, byFamily: boolean, acc: { s: number; n: number }) {
  for (const cid in e.scores) {
    const raw = e.scores[cid]
    if (typeof raw !== 'number' || !crit.has(cid) || !ix.applies(cid, pos, byFamily)) continue
    const v = ix.norm.get(cid)?.(raw)
    if (v === undefined) continue
    acc.s += v
    acc.n++
  }
}

/**
 * Moyenne d'avis (sur 5) : chaque observateur pèse pareil (moyenne de ses notes), puis moyenne des observateurs. Seuls
 * comptent les critères qui concernent le poste du joueur (`byFamily` : en plus, pour une catégorie ou une zone, la
 * famille de la catégorie, voir buildIndex).
 */
export function avgOf<P extends QPlayer>(ix: QIndex<P>, pid: string, crit: Set<string>, byFamily = false): number | null {
  const es = ix.evals.get(pid)
  if (!es || !crit.size) return null
  const pos = ix.info.get(pid)?.pos
  const byObs = new Map<string, { s: number; n: number }>()
  for (const e of es) {
    const o = byObs.get(e.observer) ?? { s: 0, n: 0 }
    evalNotes(ix, e, crit, pos, byFamily, o)
    if (o.n) byObs.set(e.observer, o)
  }
  if (!byObs.size) return null
  let t = 0
  for (const o of byObs.values()) t += o.s / o.n
  return t / byObs.size
}

type Scorer = (pid: string) => number | null

/** Moyenne d'une cible ; score combiné : moyenne des moyennes de ses parties, chacune nécessaire. */
export function scorer<P extends QPlayer>(ix: QIndex<P>, t: AvisTarget): Scorer {
  if (t.on === 'mix') {
    const fs = t.parts.map((x) => scorer(ix, x))
    return (pid) => {
      let s = 0
      for (const f of fs) {
        const v = f(pid)
        if (v === null) return null
        s += v
      }
      return s / fs.length
    }
  }
  const crit = targetCriteria(ix, t)
  const byFamily = t.on === 'category' || t.on === 'zone'
  return (pid) => avgOf(ix, pid, crit, byFamily)
}

/**
 * Progression : moyenne du dernier avis moins celle de l'avis précédent (avis qui notent la cible, dans l'ordre des jours ;
 * score combiné : chaque partie dans chacun des deux avis). null : moins de deux avis sur ce point.
 */
export function progressOf<P extends QPlayer>(ix: QIndex<P>, pid: string, t: AvisTarget): number | null {
  const es = ix.evals.get(pid)
  if (!es || es.length < 2) return null
  const parts: SimpleTarget[] = t.on === 'mix' ? t.parts : [t]
  const sets = parts.map((x) => ({ crit: targetCriteria(ix, x), byFamily: x.on === 'category' || x.on === 'zone' }))
  const pos = ix.info.get(pid)?.pos
  const found: number[] = []
  for (let i = es.length - 1; i >= 0 && found.length < 2; i--) {
    let total = 0
    let ok = true
    for (const x of sets) {
      const acc = { s: 0, n: 0 }
      evalNotes(ix, es[i], x.crit, pos, x.byFamily, acc)
      if (!acc.n) {
        ok = false
        break
      }
      total += acc.s / acc.n
    }
    if (ok) found.push(total / sets.length)
  }
  return found.length === 2 ? found[0] - found[1] : null
}

/** « À voir en priorité » : note de bonne impression (moyenne sur 5) qui place un joueur vu une fois en tête (à confirmer). */
export const PRIORITY_GOOD = 3.5
/** Explication affichée avec la liste « à voir en priorité ». */
export const PRIORITY_TEXT = `d’abord les joueurs vus une seule fois et déjà bien notés (moyenne ≥ ${String(PRIORITY_GOOD).replace('.', ',')} : à confirmer), puis ceux pas encore vus, des plus âgés aux plus jeunes, puis les autres vus une seule fois ; ceux déjà vus deux fois ou plus n’y sont pas`

/** Ligne de tableau ; staff : `key` = la personne, `staff` = joueurs vus distincts et avis écrits (total = match = joueurs). */
export type TableRow = { key: string; total: number; match: number; seen?: Tally; avg?: number | null; staff?: { players: number; avis: number } }

export type Answer<P> = {
  /** Joueurs qui passent la population. */
  total: number
  /** Joueurs qui remplissent aussi les conditions. */
  count: number
  match: P[]
  matchIds: Set<string>
  pop: P[]
  /** Liste : joueurs triés et limités, avec la valeur du tri (priorité : le rang, et `tag` en clair). */
  rows?: { p: P; value?: number | null; tag?: string }[]
  /** Joueurs non classés : sans valeur de tri, moins de deux avis (progression), déjà vus deux fois ou plus (priorité). */
  missing?: number
  table?: TableRow[]
  ms: number
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Population seule (sans les conditions). */
function inPopulation<P extends QPlayer>(ix: QIndex<P>, pop: Population, p: P): boolean {
  const i = ix.info.get(p.id)!
  if (pop.sex && p.sex !== pop.sex) return false
  if (pop.names && !namesMatch(pop.names, p)) return false
  if (pop.years) {
    const y = Number(i.year)
    if (!i.year || y < pop.years[0] || y > pop.years[1]) return false
  }
  if (pop.positions && !(p.position && pop.positions.includes(p.position))) return false
  if (pop.depts && !(i.dept && pop.depts.includes(i.dept))) return false
  if (pop.regions && !(i.region && pop.regions.includes(i.region))) return false
  if (pop.clubs && !pop.clubs.includes(i.club)) return false
  if (pop.hand && p.laterality !== pop.hand) return false
  if (pop.hMin || pop.hMax) {
    const h = ix.last.get(HEIGHT_ID)?.get(p.id)
    if (h === undefined || (pop.hMin && h < pop.hMin) || (pop.hMax && h > pop.hMax)) return false
  }
  if (pop.groups && !pop.groups.some((g) => ix.groupMembers.get(g)?.has(p.id))) return false
  if (pop.events && !pop.events.some((e) => ix.eventMembers.get(e)?.has(p.id))) return false
  if (pop.pole) {
    const st = poleOf(p, ix.data.today)
    if (pop.pole === 'any' ? !st : st !== pop.pole) return false
  }
  return true
}

/** Chaque mot de chaque nom dit est un mot entier du prénom ou du nom (sans accents ; « Jean-Pierre » = « jean pierre »). */
function namesMatch(names: string[], p: QPlayer): boolean {
  const toks = new Set(nameTokens(p))
  // Prénom ou nom composé écrit collé (« Jeanpierre »).
  toks.add(nameKey(p.firstName ?? '').replace(/ /g, ''))
  toks.add(nameKey(p.lastName ?? '').replace(/ /g, ''))
  return names.every((n) => nameKey(n).split(' ').every((w) => toks.has(w)))
}

/** Pôle Espoirs (même règle que db.ts poleStatus, sans la base). */
function poleOf(p: Pick<Player, 'poles'>, today: string): 'current' | 'past' | undefined {
  const ps = (p.poles ?? []).filter((x) => x.from || x.to || x.name || x.regionId || x.site)
  if (!ps.length) return undefined
  return ps.some((x) => (!x.from || x.from <= today) && (!x.to || x.to >= today)) ? 'current' : 'past'
}

/** Clé de regroupement d'un joueur. */
export function groupKey<P extends QPlayer>(ix: QIndex<P>, by: GroupBy, p: P): string {
  const i = ix.info.get(p.id)!
  if (by === 'club') return i.club
  if (by === 'dept') return i.dept ?? ''
  if (by === 'region') return i.region ?? ''
  if (by === 'year') return i.year
  if (by === 'position') return p.position ?? ''
  return p.sex ?? ''
}

/** Avis d'une personne du staff dans la période (jour de l'avis ; sans jour : compté). */
const inRange = (day: string | undefined, range?: { from: string; to: string }) => !range || !day || (day >= range.from && day <= range.to)

/**
 * Exécute une recette (lecture seule) : population, puis conditions (vu, avis, nombre d'avis, mesures), puis la sortie
 * demandée (nombre, liste triée et limitée, tableau groupé, ou joueurs pour la carte).
 */
export function runRecipe<P extends QPlayer>(ix: QIndex<P>, r: Recipe): Answer<P> {
  const t0 = now()
  const today = ix.data.today
  const pop = ix.players.filter((p) => inPopulation(ix, r.pop, p))
  const seenRange = r.seen ? periodRange(r.seen.period, today) : undefined
  const avisRules = r.avis.map((a) => ({ ...a, score: scorer(ix, a.target) }))
  const match = pop.filter((p) => {
    if (r.seen && !test(r.seen.op, seenCount(ix, p.id, r.seen.by, seenRange), r.seen.n)) return false
    for (const a of avisRules) {
      const v = a.score(p.id)
      if (v === null || !(a.op === 'gte' ? v >= a.value - 1e-9 : v <= a.value + 1e-9)) return false
    }
    if (r.nbAvis && !test(r.nbAvis.op, ix.evals.get(p.id)?.length ?? 0, r.nbAvis.n)) return false
    for (const m of r.measures) {
      const v = ix.last.get(m.id)?.get(p.id)
      if (v === undefined || !(m.op === 'gte' ? v >= m.value : v <= m.value)) return false
    }
    return true
  })
  const matchIds = new Set(match.map((p) => p.id))
  const ans: Answer<P> = { total: pop.length, count: match.length, match, matchIds, pop, ms: 0 }
  const avgTarget = r.out.avg ?? r.avis[0]?.target ?? { on: 'global' as const }
  const outRange = periodRange(r.out.period ?? r.seen?.period ?? { kind: 'season' }, today)
  const nameOf = (p: P) => ix.info.get(p.id)!.name
  const byName = (a: P, b: P) => {
    const x = nameOf(a)
    const y = nameOf(b)
    return x < y ? -1 : x > y ? 1 : 0
  }

  if (r.out.type === 'list') {
    const sort = defaultSort(r)
    const limit = r.out.limit ?? DEFAULT_LIMIT
    if (sort.by === 'priority') {
      ans.rows = priorityRows(ix, match, scorer(ix, avgTarget), outRange, byName)
      ans.missing = match.length - ans.rows.length
      ans.rows = ans.rows.slice(0, limit)
    } else {
      const score = sort.by === 'avg' ? scorer(ix, avgTarget) : undefined
      const measure = r.out.measure ?? r.measures[0]?.id
      const valueOf = (p: P): number | null | undefined => {
        switch (sort.by) {
          case 'year':
            return ix.info.get(p.id)!.year ? Number(ix.info.get(p.id)!.year) : null
          case 'height':
            return ix.last.get(HEIGHT_ID)?.get(p.id) ?? null
          case 'seen':
            return seenCount(ix, p.id, r.seen?.by ?? 'event', outRange)
          case 'avg':
            return score!(p.id)
          case 'nbAvis':
            return ix.evals.get(p.id)?.length ?? 0
          case 'measure':
            return measure ? (ix.last.get(measure)?.get(p.id) ?? null) : null
          case 'progress':
            return progressOf(ix, p.id, avgTarget)
          default:
            return undefined
        }
      }
      const vals = sort.by === 'name' ? match.map((p) => ({ p, value: undefined as number | null | undefined })) : match.map((p) => ({ p, value: valueOf(p) }))
      // Sans valeur (pas d'avis sur ce point, jamais mesuré) : pas dans le classement, compté à part.
      const ranked = sort.by === 'name' ? vals : vals.filter((x) => x.value !== null && x.value !== undefined)
      const k = sort.dir === 'asc' ? 1 : -1
      ranked.sort((a, b) => (sort.by === 'name' ? k * byName(a.p, b.p) : k * ((a.value as number) - (b.value as number)) || byName(a.p, b.p)))
      ans.missing = vals.length - ranked.length
      ans.rows = ranked.slice(0, limit)
    }
  } else if (r.out.type === 'table' && r.out.groupBy === 'staff') {
    ans.table = staffRows(ix, match, outRange, r.out.sort)
  } else if (r.out.type === 'table') {
    const by = r.out.groupBy ?? 'club'
    const rows = new Map<string, TableRow>()
    for (const p of pop) {
      const k = groupKey(ix, by, p)
      const row = rows.get(k) ?? { key: k, total: 0, match: 0 }
      rows.set(k, row)
      row.total++
      if (matchIds.has(p.id)) row.match++
    }
    if (r.out.value === 'seen' || r.out.value === 'avg') {
      const score = r.out.value === 'avg' ? scorer(ix, avgTarget) : undefined
      const sums = new Map<string, { s: number; n: number }>()
      for (const p of match) {
        const row = rows.get(groupKey(ix, by, p))!
        if (r.out.value === 'seen') {
          row.seen ??= { seen: 0, total: 0 }
          row.seen.total++
          if (seenCount(ix, p.id, 'event', outRange) > 0) row.seen.seen++
        } else {
          const v = score!(p.id)
          if (v === null) continue
          const x = sums.get(row.key) ?? { s: 0, n: 0 }
          x.s += v
          x.n++
          sums.set(row.key, x)
        }
      }
      if (r.out.value === 'avg') for (const row of rows.values()) row.avg = sums.has(row.key) ? sums.get(row.key)!.s / sums.get(row.key)!.n : null
    }
    const keep = r.out.keep ?? 'some'
    const sort = r.out.sort
    // Tri par part : toutes les lignes restent (celles à 0 % sont justement « en retard »).
    const keepRow = (x: TableRow) => (keep === 'all' ? x.match === x.total : keep === 'none' ? x.match === 0 : sort?.by === 'share' || x.match > 0)
    const k = sort?.dir === 'asc' ? 1 : -1
    // Valeur triée : null (pas de valeur) toujours en fin de tableau.
    const cmp = (a: number | null | undefined, b: number | null | undefined) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : k * (a - b))
    ans.table = [...rows.values()].filter(keepRow).sort((a, b) => {
      // Inconnu (club non renseigné, année inconnue…) à la fin ; années : la plus récente d'abord.
      if (!a.key !== !b.key) return !a.key ? 1 : -1
      if (sort?.by === 'share') return cmp(shareOf(a), shareOf(b)) || b.total - a.total || a.key.localeCompare(b.key, 'fr')
      if (sort?.by === 'count') return k * (a.match - b.match) || b.total - a.total || a.key.localeCompare(b.key, 'fr')
      if (sort?.by === 'avg' || r.out.value === 'avg') return (sort ? cmp(a.avg, b.avg) : (b.avg ?? -1) - (a.avg ?? -1)) || b.match - a.match
      if (by === 'year') return b.key.localeCompare(a.key)
      return (keep === 'some' ? b.match - a.match : 0) || b.total - a.total || a.key.localeCompare(b.key, 'fr')
    })
  }
  ans.ms = Math.round(now() - t0)
  return ans
}

/** Tri effectif d'une liste : celui de la recette, sinon moyenne (s'il y a une moyenne en jeu), sinon nom. */
export function defaultSort(r: Recipe): { by: SortBy; dir: 'asc' | 'desc' } {
  return r.out.sort ?? (r.avis.length || r.out.avg ? { by: 'avg', dir: 'desc' } : { by: 'name', dir: 'asc' })
}

/** Part d'une ligne de tableau : part vue (colonne « part vue »), sinon part qui répond. */
export const shareOf = (row: TableRow): number | null => (row.seen ? (row.seen.total ? row.seen.seen / row.seen.total : null) : row.total ? row.match / row.total : null)

/** « À voir en priorité » (PRIORITY_TEXT) : rang 0 à confirmer, 1 pas encore vu, 2 vu une fois ; vus ≥ 2 : écartés. */
function priorityRows<P extends QPlayer>(ix: QIndex<P>, match: P[], score: Scorer, range: { from: string; to: string } | undefined, byName: (a: P, b: P) => number) {
  const rows: { p: P; value: number; tag: string; avg: number | null; year: number }[] = []
  for (const p of match) {
    const n = seenCount(ix, p.id, 'event', range)
    if (n > 1) continue
    const avg = n === 1 ? score(p.id) : null
    const e = p.sex === 'F' ? 'e' : ''
    const year = Number(ix.info.get(p.id)!.year) || 9999
    const note = avg === null ? '' : `, moyenne ${fr(avg)}`
    if (n === 1 && avg !== null && avg >= PRIORITY_GOOD - 1e-9) rows.push({ p, value: 0, tag: `à confirmer : vu${e} 1 fois${note}`, avg, year })
    else if (n === 0) rows.push({ p, value: 1, tag: `pas encore vu${e}`, avg, year })
    else rows.push({ p, value: 2, tag: `vu${e} 1 fois${note}`, avg, year })
  }
  rows.sort((a, b) => a.value - b.value || (b.avg ?? -1) - (a.avg ?? -1) || a.year - b.year || byName(a.p, b.p))
  return rows.map(({ p, value, tag }) => ({ p, value, tag }))
}

/** Tableau du staff : par personne, joueurs (de la réponse) vus distincts et avis écrits dans la période. */
function staffRows<P extends QPlayer>(ix: QIndex<P>, match: P[], range: { from: string; to: string } | undefined, sort?: { by: SortBy; dir: 'asc' | 'desc' }): TableRow[] {
  const players = new Map<string, Set<string>>()
  const avis = new Map<string, number>()
  const known = (who: string) => !!who && who !== '?'
  for (const p of match) {
    for (const s of ix.sights.get(p.id) ?? []) {
      if (!known(s.person) || !inRange(s.day, range)) continue
      const set = players.get(s.person) ?? new Set<string>()
      players.set(s.person, set)
      set.add(p.id)
    }
    for (const e of ix.evals.get(p.id) ?? []) if (known(e.observer) && inRange(e.day, range)) avis.set(e.observer, (avis.get(e.observer) ?? 0) + 1)
  }
  const rows = [...new Set([...players.keys(), ...avis.keys()])].map((key): TableRow => {
    const n = players.get(key)?.size ?? 0
    return { key, total: n, match: n, staff: { players: n, avis: avis.get(key) ?? 0 } }
  })
  const k = sort?.dir === 'asc' ? 1 : -1
  const main = (x: TableRow) => (sort?.by === 'nbAvis' ? x.staff!.avis : x.staff!.players)
  const other = (x: TableRow) => (sort?.by === 'nbAvis' ? x.staff!.players : x.staff!.avis)
  return rows.sort((a, b) => k * (main(a) - main(b)) || other(b) - other(a) || a.key.localeCompare(b.key))
}

/** Carte : part de la population qui remplit les conditions, par département et par région (seen = remplit). */
export function mapTallies<P extends QPlayer>(ix: QIndex<P>, ans: Answer<P>) {
  const byDept = new Map<string, Tally>()
  const byRegion = new Map<string, Tally>()
  const noDept: Tally = { seen: 0, total: 0 }
  const add = (m: Map<string, Tally>, k: string, ok: boolean) => {
    const t = m.get(k) ?? { seen: 0, total: 0 }
    m.set(k, t)
    t.total++
    if (ok) t.seen++
  }
  for (const p of ans.pop) {
    const i = ix.info.get(p.id)!
    const ok = ans.matchIds.has(p.id)
    if (!i.dept) {
      noDept.total++
      if (ok) noDept.seen++
      continue
    }
    add(byDept, i.dept, ok)
    if (i.region) add(byRegion, i.region, ok)
  }
  return { byDept, byRegion, noDept }
}

// ---------- 5. La recette en clair ----------

export type Names = {
  region: (id: string) => string
  dept: (code: string) => string
  club: (key: string) => string
  group: (id: string) => string
  event: (id: string) => string
  criterion: (id: string) => string
  unit?: (id: string) => string | undefined
  position: (id: Position) => string
  /** Personne du staff (nom lu sur l'appareil, jamais envoyé). */
  staff?: (id: string) => string
  today: string
}

/** Ce qu'on peut changer d'un toucher sur une pastille (en plus de la retirer). */
export type ChipEdit = 'sex' | 'years' | 'height' | 'seen' | 'period' | 'avis' | 'nbAvis' | 'measure' | 'out' | 'sort' | 'limit' | 'value' | 'outPeriod'
export type Chip = { key: string; label: string; edit?: ChipEdit; removable: boolean }

const fr = (n: number, d = 2) => n.toLocaleString('fr-FR', { maximumFractionDigits: d })
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const OP_TEXT: Record<Cmp, string> = { eq: '=', gte: '≥', lte: '≤' }
const GROUP_TEXT: Record<GroupBy, string> = {
  club: 'par club',
  dept: 'par département',
  region: 'par région',
  year: 'par génération',
  position: 'par poste',
  sex: 'par sexe',
  staff: 'par personne du staff',
}
const POLE_TEXT: Record<PoleWanted, string> = { current: 'au Pôle Espoirs', past: 'sortis du Pôle Espoirs', any: 'passés par le Pôle Espoirs' }

export function periodText(p: Period, today: string): string {
  if (p.kind === 'season') return `cette saison (${seasonOf(today).label})`
  if (p.kind === '12m') return '12 derniers mois'
  if (p.kind === 'all') return 'depuis toujours'
  return `depuis le ${fmtDay(p.since ?? today)}`
}

export function targetText(t: AvisTarget, names: Names): string {
  if (t.on === 'mix') return t.parts.map((x) => targetText(x, names)).join(' + ')
  if (t.on === 'global') return 'générale'
  if (t.on === 'criterion') return names.criterion(t.id)
  if (t.on === 'category') return t.name
  return `zone « ${RADAR_ZONES.find((z) => z.id === t.zone)?.label.toLowerCase() ?? t.zone} »`
}

/** « moyenne Défense », « moyenne générale », « score Vitesse + Intelligence de jeu ». */
export const avgText = (t: AvisTarget, names: Names) => `${t.on === 'mix' ? 'score' : 'moyenne'} ${targetText(t, names)}`

/** Part en clair : entière au-dessous (« 12 % »), une décimale sous 1 % (« 0,3 % »), « < 0,1 % » pour une part plus petite. */
export function shareText(part: number, total: number): string {
  if (!total || !part) return '0 %'
  const p = (part * 100) / total
  if (p >= 1) return `${Math.floor(p)} %`
  const d = Math.floor(p * 10) / 10
  return d ? `${fr(d, 1)} %` : '< 0,1 %'
}

const list = (xs: string[], max = 3) => (xs.length > max ? `${xs.slice(0, max).join(', ')} +${xs.length - max}` : xs.join(', '))

/** Pastilles de la recette, dans l'ordre de lecture ; chacune peut être retirée (sauf la sortie). */
export function recipeChips(r: Recipe, names: Names): Chip[] {
  const c: Chip[] = []
  const f = r.pop.sex === 'F'
  const e = f ? 'es' : 's'
  const p = r.pop
  if (p.sex) c.push({ key: 'sex', label: f ? 'Joueuses' : 'Garçons', edit: 'sex', removable: true })
  if (p.names) c.push({ key: 'names', label: `prénom ou nom : ${list(p.names)}`, removable: true })
  if (p.years)
    c.push({ key: 'years', label: p.years[0] === p.years[1] ? `né${e} en ${p.years[0]}` : `né${e} de ${p.years[0]} à ${p.years[1]}`, edit: 'years', removable: true })
  if (p.positions) c.push({ key: 'positions', label: list(p.positions.map(names.position)), removable: true })
  if (p.regions) c.push({ key: 'regions', label: list(p.regions.map(names.region)), removable: true })
  if (p.depts) c.push({ key: 'depts', label: list(p.depts.map(names.dept)), removable: true })
  if (p.clubs) c.push({ key: 'clubs', label: `${p.clubs.length > 1 ? 'clubs' : 'club'} : ${list(p.clubs.map(names.club))}`, removable: true })
  if (p.hMin || p.hMax)
    c.push({
      key: 'height',
      label: p.hMin && p.hMax ? `taille ${p.hMin}–${p.hMax} cm` : p.hMin ? `taille ≥ ${p.hMin} cm` : `taille ≤ ${p.hMax} cm`,
      edit: 'height',
      removable: true,
    })
  if (p.hand) c.push({ key: 'hand', label: p.hand === 'gaucher' ? (f ? 'gauchères' : 'gauchers') : p.hand === 'droitier' ? (f ? 'droitières' : 'droitiers') : 'ambidextres', removable: true })
  if (p.groups) c.push({ key: 'groups', label: `groupe : ${list(p.groups.map(names.group))}`, removable: true })
  if (p.events) c.push({ key: 'events', label: `événement : ${list(p.events.map(names.event))}`, removable: true })
  if (p.pole) c.push({ key: 'pole', label: POLE_TEXT[p.pole], removable: true })
  if (r.seen) {
    const s = r.seen
    const unit = s.by === 'event' ? (s.n > 1 ? 'événements' : 'événement') : s.n > 1 ? 'personnes du staff' : 'personne du staff'
    const v = `vu${f ? 'e' : ''}s`
    const label =
      s.op === 'eq' && s.n === 0
        ? `pas encore ${v}`
        : s.op === 'eq'
          ? `${v} ${s.by === 'event' ? 'à' : 'par'} ${s.n} ${unit}`
          : s.op === 'gte'
            ? `${v} ${s.by === 'event' ? 'à' : 'par'} au moins ${s.n} ${unit}`
            : `${v} ${s.by === 'event' ? 'à' : 'par'} ${s.n} ${unit} au plus`
    c.push({ key: 'seen', label, edit: 'seen', removable: true })
    c.push({ key: 'period', label: periodText(s.period, names.today), edit: 'period', removable: false })
  }
  r.avis.forEach((a, i) => c.push({ key: `avis.${i}`, label: `${avgText(a.target, names)} ${OP_TEXT[a.op]} ${fr(a.value)}`, edit: 'avis', removable: true }))
  if (r.nbAvis) c.push({ key: 'nbAvis', label: `${OP_TEXT[r.nbAvis.op] === '=' ? '' : `${OP_TEXT[r.nbAvis.op]} `}${r.nbAvis.n} avis`, edit: 'nbAvis', removable: true })
  r.measures.forEach((m, i) => {
    const u = names.unit?.(m.id)
    c.push({ key: `measure.${i}`, label: `${names.criterion(m.id)} ${OP_TEXT[m.op]} ${fr(m.value, 3)}${u ? ` ${u}` : ''}`, edit: 'measure', removable: true })
  })
  const o = r.out
  c.push({
    key: 'out',
    label: o.type === 'count' ? 'combien ?' : o.type === 'map' ? 'carte de France' : o.type === 'table' ? (o.groupBy === 'staff' ? 'tableau par personne du staff' : GROUP_TEXT[o.groupBy ?? 'club']) : 'liste',
    edit: 'out',
    removable: false,
  })
  const avgT = o.avg ?? r.avis[0]?.target ?? { on: 'global' as const }
  const arrow = (dir: 'asc' | 'desc') => (dir === 'asc' ? '↑' : '↓')
  if (o.type === 'table' && o.value && o.value !== 'count')
    c.push({
      key: 'value',
      label: o.value === 'seen' ? `part vue (${periodText(o.period ?? r.seen?.period ?? { kind: 'season' }, names.today)})` : avgText(avgT, names),
      edit: 'value',
      removable: true,
    })
  if (o.type === 'table' && o.keep && o.keep !== 'some')
    c.push({ key: 'keep', label: o.keep === 'all' ? 'seulement si tous répondent' : 'seulement si aucun ne répond', removable: true })
  // Période du tableau du staff, du tri par vus ou par priorité : toujours affichée (saison en cours par défaut).
  if (usesOutPeriod(r) && !(o.type === 'table' && o.value === 'seen'))
    c.push({ key: 'outPeriod', label: periodText(o.period ?? r.seen?.period ?? { kind: 'season' }, names.today), edit: 'outPeriod', removable: false })
  if (o.type === 'table' && o.sort) {
    const what =
      o.groupBy === 'staff'
        ? o.sort.by === 'nbAvis'
          ? 'avis écrits'
          : 'joueurs vus'
        : o.sort.by === 'count'
          ? 'nombre de joueurs'
          : o.sort.by === 'avg'
            ? avgText(avgT, names)
            : o.value === 'seen'
              ? 'part vue'
              : 'part qui répond'
    c.push({ key: 'sort', label: `tri : ${what} ${arrow(o.sort.dir)}`, edit: 'sort', removable: true })
  }
  if (o.type === 'list') {
    const s = defaultSort(r)
    const what: Record<SortBy, string> = {
      name: 'nom',
      year: 'année de naissance',
      height: 'taille',
      seen: 'nombre de vus',
      avg: avgText(avgT, names),
      nbAvis: 'nombre d’avis',
      measure: names.criterion(o.measure ?? r.measures[0]?.id ?? ''),
      progress: `évolution entre les deux derniers avis (${avgText(avgT, names)})`,
      priority: 'à voir en priorité',
      share: 'part',
      count: 'nombre',
    }
    c.push({ key: 'sort', label: s.by === 'priority' ? `tri : ${what.priority}` : `tri : ${what[s.by]} ${arrow(s.dir)}`, edit: 'sort', removable: !!o.sort })
    c.push({ key: 'limit', label: `${o.limit ?? DEFAULT_LIMIT} premiers`, edit: 'limit', removable: false })
  }
  return c
}

/** La recette en une phrase (« Joueuses · nées en 2011 · vues à 1 événement · cette saison · par département »). */
export const recipeText = (r: Recipe, names: Names) => recipeChips(r, names).map((c) => c.label).join(' · ')

/** Retire une pastille (clé de recipeChips). */
export function removeChip(r: Recipe, key: string): Recipe {
  const x = cleanRecipe(r)
  const [k, i] = key.split('.')
  if (k === 'height') {
    delete x.pop.hMin
    delete x.pop.hMax
  } else if (k in x.pop || ['sex', 'names', 'years', 'positions', 'regions', 'depts', 'clubs', 'hand', 'groups', 'events', 'pole'].includes(k)) delete x.pop[k as keyof Population]
  else if (k === 'seen') delete x.seen
  else if (k === 'avis') x.avis.splice(Number(i), 1)
  else if (k === 'measure') x.measures.splice(Number(i), 1)
  else if (k === 'nbAvis') delete x.nbAvis
  else if (k === 'value') delete x.out.value
  else if (k === 'keep') delete x.out.keep
  else if (k === 'sort') delete x.out.sort
  return cleanRecipe(x)
}

// ---------- Questions enregistrées ----------

/** Valeurs qui peuvent devenir des variables (choisies à la relance). */
export type VarKey = 'sex' | 'years' | 'period' | 'region' | 'dept' | 'position' | 'group' | 'seenN'
export const VAR_TEXT: Record<VarKey, string> = {
  sex: 'garçons / filles',
  years: 'année de naissance',
  period: 'période',
  region: 'région',
  dept: 'département',
  position: 'poste',
  group: 'groupe',
  seenN: 'nombre de vus',
}

/** Variables possibles d'une recette (celles qui ont une valeur simple). */
export function possibleVars(r: Recipe): VarKey[] {
  const v: VarKey[] = []
  if (r.pop.sex) v.push('sex')
  if (r.pop.years) v.push('years')
  if (r.seen) v.push('period', 'seenN')
  else if (r.out.period) v.push('period')
  if (r.pop.regions?.length === 1) v.push('region')
  if (r.pop.depts?.length === 1) v.push('dept')
  if (r.pop.positions?.length === 1) v.push('position')
  if (r.pop.groups?.length === 1) v.push('group')
  return v
}

export type VarValues = { sex?: 'M' | 'F' | ''; years?: [number, number]; period?: Period; region?: string; dept?: string; position?: Position; group?: string; seenN?: number }

/** Valeurs actuelles des variables d'une recette. */
export function varValues(r: Recipe): VarValues {
  return {
    sex: r.pop.sex ?? '',
    years: r.pop.years,
    period: r.seen?.period ?? r.out.period,
    region: r.pop.regions?.[0],
    dept: r.pop.depts?.[0],
    position: r.pop.positions?.[0],
    group: r.pop.groups?.[0],
    seenN: r.seen?.n,
  }
}

/** Recette relancée avec d'autres valeurs (rien d'autre ne change ; tout est revérifié). */
export function applyVars(r: Recipe, v: VarValues): Recipe {
  const x = cleanRecipe(r)
  if (v.sex !== undefined) {
    if (v.sex) x.pop.sex = v.sex
    else delete x.pop.sex
  }
  if (v.years) x.pop.years = v.years
  if (v.period) {
    if (x.seen) x.seen.period = v.period
    else x.out.period = v.period
  }
  if (v.region) x.pop.regions = [v.region]
  if (v.dept) {
    x.pop.depts = [v.dept]
    delete x.pop.regions
  }
  if (v.position) x.pop.positions = [v.position]
  if (v.group) x.pop.groups = [v.group]
  if (v.seenN !== undefined && x.seen) x.seen.n = v.seenN
  return cleanRecipe(x)
}

/** Question enregistrée : une recette, ou (mode avancé) une requête SQL relancée telle quelle sur la copie locale, sans variables. */
export type SavedQuestion = { id: string; name: string; recipe: Recipe; vars: VarKey[]; phrase?: string; at: number; sql?: SqlSpec }
const VAR_KEYS = Object.keys(VAR_TEXT) as VarKey[]

/** « Mes questions » lues dans le stockage : chaque question revérifiée, les illisibles ignorées. */
export function parseSaved(raw: unknown): SavedQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: SavedQuestion[] = []
  for (const q of raw.slice(0, 100)) {
    if (!isObj(q) || !okId(q.id) || typeof q.name !== 'string' || !q.name.trim()) continue
    // Mode avancé : requête recontrôlée ; illisible ou refusée : question écartée.
    const sql = q.sql === undefined ? undefined : cleanSqlSpec(q.sql)
    if (sql === null) continue
    const recipe = sql ? cleanRecipe({}) : cleanRecipe(q.recipe)
    const can = possibleVars(recipe)
    out.push({
      id: q.id,
      name: q.name.replace(/\s+/g, ' ').trim().slice(0, 80),
      recipe,
      vars: !sql && Array.isArray(q.vars) ? q.vars.filter((v): v is VarKey => VAR_KEYS.includes(v as VarKey) && can.includes(v as VarKey)) : [],
      ...(typeof q.phrase === 'string' && q.phrase.trim() ? { phrase: q.phrase.slice(0, 300) } : {}),
      at: typeof q.at === 'number' && Number.isFinite(q.at) ? q.at : 0,
      ...(sql ? { sql } : {}),
    })
  }
  return out
}

// ---------- Aide ----------

export const QUESTION_HINT = 'les joueuses 2011 vues une seule fois cette saison, par département », « combien de gardiens 2009 mesurent plus de 1 m 85'

/** Questions qui marchent, montrées quand une question n'a pas été comprise. */
export const QUESTION_EXAMPLES = [
  'Les joueuses 2011 vues une seule fois cette saison, par département',
  'Quel département est le plus en retard sur les 2013 ?',
  'Les 10 meilleurs défenseurs nés en 2010',
  'Quels joueurs aller voir en priorité en Bretagne ?',
]
