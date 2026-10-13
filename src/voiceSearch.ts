// Recherche de joueurs en langage naturel (« tous les joueurs nés en 2010 qui mesurent plus d'1 m 80 ») : fonctions pures,
// sans dépendance à l'appli (testées dans tools/test-recherche-vocale.ts avec de fausses réponses du modèle).
//  1. buildSchema : le schéma envoyé à la fonction « transcrire » (?mode=filtres) avec la phrase : clés permises, types,
//     valeurs possibles (postes, sexes, latéralités, trimestres, régions et départements, noms des groupes et des profils
//     recherchés que le compte voit). Jamais de données de joueurs.
//  2. interpretFilters : revérifie chaque valeur rendue par le modèle d'après les vraies listes (valeur inconnue : écartée
//     et signalée), retrouve clubs, départements, régions, groupes et profils malgré accents, majuscules et noms partiels,
//     et donne les nouveaux filtres (les autres sont remis à zéro) avec le résumé « Compris : … ».
// Recherche seulement : aucune action sur les joueurs.

import type { Laterality, Position } from './db'

export type SexValue = 'all' | 'M' | 'F'
export type PoleValue = '' | 'current' | 'past' | 'any'

/** Valeurs des filtres de la liste Joueurs (usePlayerFilter), toutes ensemble. */
export type FilterValues = {
  q: string
  sex: SexValue
  region: string
  dept: string
  club: string
  year: string
  position: Position | 'all' | 'none'
  withSecondary: boolean
  hand: 'all' | Laterality
  quarter: number
  minH: string
  group: string
  profile: string
  followedOnly: boolean
  pole: PoleValue
  videoOnly: boolean
}

export const EMPTY_FILTERS: FilterValues = {
  q: '',
  sex: 'all',
  region: '',
  dept: '',
  club: '',
  year: '',
  position: 'all',
  withSecondary: false,
  hand: 'all',
  quarter: 0,
  minH: '',
  group: '',
  profile: '',
  followedOnly: false,
  pole: '',
  videoOnly: false,
}

export const sameFilters = (a: FilterValues, b: FilterValues) =>
  (Object.keys(EMPTY_FILTERS) as (keyof FilterValues)[]).every((k) => String(a[k]) === String(b[k]))

/** Listes réelles de l'appli, pour construire le schéma et revérifier les réponses. */
export type SearchContext = {
  positions: { id: Position; label: string }[]
  regions: { id: string; name: string }[]
  depts: { code: string; name?: string }[]
  /** Clubs des joueurs de la base (pas envoyés au modèle : retrouvés ici). */
  clubs: string[]
  /** Groupes et profils recherchés visibles par ce compte. */
  groups: { id: string; name: string }[]
  profiles: { id: string; name: string }[]
  /** Région d'un département (pour écarter une région qui contredit le département). */
  regionOfDept?: (code: string) => string | undefined
  /** Année en cours (années de naissance possibles). */
  thisYear: number
}

// ---------- Schéma envoyé avec la phrase ----------

export const QUARTER_TEXT = ['janvier à mars', 'avril à juin', 'juillet à septembre', 'octobre à décembre']
const POLE_KEYS: Record<string, PoleValue> = { en_cours: 'current', sortis: 'past', tous: 'any' }
/** Au-delà, les noms de groupes ou de profils ne sont pas envoyés (le modèle recopie alors le nom dit). */
const MAX_NAMES = 30

/**
 * Schéma compact envoyé avec la phrase : une ligne par clé (petits modèles : court et explicite).
 * Régions, départements et clubs ne sont pas listés : le modèle recopie ce qui est dit (« Var », « 83 », « PACA »,
 * « Toulon ») et l'appli le retrouve dans ses listes (moins de mots envoyés, rien d'inventé).
 */
export function buildSchema(ctx: SearchContext): Record<string, string> {
  const s: Record<string, string> = {
    sexe: 'M (garçons) ou F (filles)',
    annee: 'année de naissance, entier (une seule)',
    trimestre: 'trimestre de naissance : 1 (janv.-mars), 2 (avril-juin), 3 (juil.-sept.), 4 (oct.-déc.)',
    tailleMin: 'taille minimum en cm, entier',
    lateralite: 'droitier, gaucher ou ambidextre',
    poste: [...ctx.positions.map((p) => `${p.id} (${p.label.toLowerCase()})`), 'aucun (sans poste)'].join(', '),
    postesSecondaires: 'true : compter aussi le poste secondaire (avec poste)',
    region: 'nom de la région tel que dit',
    departement: 'numéro ou nom du département tel que dit',
    club: 'nom du club tel que dit',
    pole: 'Pôle Espoirs : en_cours, sortis ou tous',
    avecVideo: 'true : seulement les joueurs avec une vidéo',
    suivis: 'true : seulement mes joueurs suivis',
  }
  if (ctx.groups.length)
    s.groupe = ctx.groups.length <= MAX_NAMES ? `un de : ${ctx.groups.map((g) => g.name).join(' | ')}` : 'nom du groupe tel que dit'
  if (ctx.profiles.length)
    s.profil = ctx.profiles.length <= MAX_NAMES ? `profil recherché, un de : ${ctx.profiles.map((p) => p.name).join(' | ')}` : 'nom du profil recherché tel que dit'
  s.recherche = 'nom et/ou prénom d’une personne, tel que dit ; ou numéro de licence'
  return s
}

/** Valeur envoyée à la place du nom cherché (le modèle peut la rendre : elle est ignorée). */
export const NAME_PLACEHOLDER = '(nom)'

/** Filtres actifs, avec les clés du schéma (envoyés avec la phrase pour « ajoute… », « enlève… ») ; du nom cherché, sa présence seulement. */
export function currentForModel(v: FilterValues, ctx: SearchContext): Record<string, string | number | boolean> {
  const o: Record<string, string | number | boolean> = {}
  if (v.sex !== 'all') o.sexe = v.sex
  if (v.year) o.annee = Number(v.year)
  if (v.quarter) o.trimestre = v.quarter
  if (Number(v.minH)) o.tailleMin = Number(v.minH)
  if (v.hand !== 'all') o.lateralite = v.hand
  if (v.position !== 'all') o.poste = v.position === 'none' ? 'aucun' : v.position
  if (v.withSecondary) o.postesSecondaires = true
  if (v.region) o.region = ctx.regions.find((r) => r.id === v.region)?.name ?? v.region
  if (v.dept) o.departement = v.dept
  if (v.club) o.club = v.club
  if (v.pole) o.pole = Object.keys(POLE_KEYS).find((k) => POLE_KEYS[k] === v.pole) ?? v.pole
  if (v.videoOnly) o.avecVideo = true
  if (v.followedOnly) o.suivis = true
  if (v.group) o.groupe = ctx.groups.find((g) => g.id === v.group)?.name ?? 'groupe choisi'
  if (v.profile) o.profil = ctx.profiles.find((p) => p.id === v.profile)?.name ?? 'profil choisi'
  // Recherche par nom : sa présence seulement (« enlève le nom »), pas le nom lui-même.
  if (v.q.trim()) o.recherche = NAME_PLACEHOLDER
  return o
}

// ---------- Rapprochement de noms (accents, majuscules, noms partiels) ----------

/** Minuscules sans accents ni ponctuation, espaces simples. */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Mots qui ne distinguent rien (« le club de Toulon », « HBC », « département du Var »).
const STOP = new Set(['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'et', 'en', 'sur', 'a', 'au', 'aux', 'club', 'hand', 'handball', 'ball', 'hb', 'hbc', 'departement', 'region', 'ligue', 'groupe', 'profil'])
const words = (s: string) => normalize(s).split(' ').filter((w) => w && !STOP.has(w))

export type Match<T> = { found: T } | { ambiguous: T[] } | { none: true }

/**
 * Meilleur candidat pour un nom dit ou tapé : égalité exacte, puis égalité sans les mots vides, puis tous les mots
 * présents (mots entiers, puis débuts de mots), puis morceau du nom. Plusieurs candidats aussi bons : « ambigu » (rien
 * n'est choisi : « Var » peut être plusieurs clubs).
 */
export function bestMatch<T>(input: string, items: T[], names: (t: T) => string[]): Match<T> {
  const n = normalize(input)
  const w = words(input)
  if (!n) return { none: true }
  const score = (name: string) => {
    const nn = normalize(name)
    if (nn === n) return 100
    const nw = words(name)
    if (w.length && nw.join(' ') === w.join(' ')) return 90
    if (!w.length) return 0
    if (w.every((x) => nw.includes(x))) return 70
    if (w.every((x) => x.length >= 3 && nw.some((y) => y.startsWith(x)))) return 50
    if (n.length >= 4 && nn.replace(/ /g, '').includes(n.replace(/ /g, ''))) return 30
    return 0
  }
  let best = 0
  let top: T[] = []
  for (const it of items) {
    const sc = Math.max(0, ...names(it).map(score))
    if (sc > best) {
      best = sc
      top = [it]
    } else if (sc === best && sc > 0) top.push(it)
  }
  if (!best) return { none: true }
  return top.length === 1 ? { found: top[0] } : { ambiguous: top }
}

// Noms courants des régions (« PACA », « IDF »…).
const REGION_ALIASES: Record<string, string[]> = {
  'region-sud': ['PACA', 'Provence-Alpes-Côte d’Azur', 'Provence'],
  'region-idf': ['IDF', 'région parisienne'],
  'region-ara': ['AURA', 'Auvergne Rhône Alpes'],
  'region-bfc': ['BFC'],
  'region-hdf': ['HDF', 'Nord'],
  'region-naq': ['NA'],
  'region-ges': ['Alsace Lorraine Champagne'],
  'region-cvl': ['Centre'],
  'region-pdl': ['PDL'],
  'region-reu': ['Réunion'],
}

const POSITION_ALIASES: Record<string, string[]> = {
  GB: ['gardien de but', 'gardienne', 'goal', 'GK'],
  DC: ['demi centre', 'demi', 'meneur', 'meneuse', 'DC'],
  ARG: ['arrière gauche', 'ARG'],
  ARD: ['arrière droit', 'arrière droite', 'ARD'],
  AG: ['ailier gauche', 'ailière gauche', 'aile gauche', 'AG'],
  AD: ['ailier droit', 'ailière droite', 'aile droite', 'AD'],
  PIV: ['pivot', 'PIV'],
}

// ---------- Lecture des valeurs ----------

const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
const isTrue = (v: unknown) => v === true || v === 1 || (typeof v === 'string' && ['true', 'oui', 'vrai', '1'].includes(normalize(v)))

/** Taille en cm : 180, 1.8, « 1 m 80 », « 1,80 », « 180 cm ». */
export function parseHeight(v: unknown): number | undefined {
  let n: number | undefined
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') {
    const s = v.toLowerCase().replace(/\s+/g, ' ').trim()
    const m = /^(\d)\s*m\s*(\d{1,2})?(?:\s*cm)?$/.exec(s)
    if (m) n = Number(m[1]) * 100 + (m[2] ? Number(m[2].length === 1 ? m[2] + '0' : m[2]) : 0)
    else {
      const x = /^(\d+(?:[.,]\d+)?)\s*(m|cm)?$/.exec(s)
      if (x) n = Number(x[1].replace(',', '.')) * (x[2] === 'm' ? 100 : 1)
    }
  }
  if (n === undefined || !Number.isFinite(n)) return undefined
  if (n > 0 && n < 3) n *= 100 // 1.80 (mètres)
  n = Math.round(n)
  return n >= 100 && n <= 230 ? n : undefined
}

export function parseYear(v: unknown, thisYear: number): number | undefined {
  const s = asText(v)
  if (!/^\d{4}$/.test(s)) return undefined
  const y = Number(s)
  return y >= 1950 && y <= thisYear ? y : undefined
}

export function parseQuarter(v: unknown): number | undefined {
  const s = normalize(asText(v))
  const m = /^(?:q|t)?\s*([1-4])(?:er|e|eme)?$/.exec(s)
  if (m) return Number(m[1])
  const words: Record<string, number> = { premier: 1, deuxieme: 2, second: 2, troisieme: 3, quatrieme: 4, dernier: 4 }
  for (const [k, q] of Object.entries(words)) if (s.startsWith(k)) return q
  return undefined
}

export function parseSex(v: unknown): 'M' | 'F' | undefined {
  const s = normalize(asText(v))
  if (['m', 'masculin', 'masculins', 'garcon', 'garcons', 'h', 'homme', 'hommes'].includes(s)) return 'M'
  if (['f', 'feminin', 'feminines', 'feminine', 'fille', 'filles', 'femme', 'femmes', 'joueuses'].includes(s)) return 'F'
  return undefined
}

export function parseHand(v: unknown): Laterality | undefined {
  const s = normalize(asText(v))
  if (s.startsWith('gauch') || s === 'left') return 'gaucher'
  if (s.startsWith('droit') || s === 'right') return 'droitier'
  if (s.startsWith('ambi')) return 'ambidextre'
  return undefined
}

export function parsePole(v: unknown): PoleValue | undefined {
  if (v === true) return 'current'
  const s = normalize(asText(v)).replace(/ /g, '_')
  if (POLE_KEYS[s]) return POLE_KEYS[s]
  if (['current', 'oui', 'en_ce_moment', 'actuel', 'actuels'].includes(s)) return 'current'
  if (['past', 'sorti', 'anciens'].includes(s)) return 'past'
  if (['any', 'tout', 'passes'].includes(s)) return 'any'
  return undefined
}

function matchPosition(v: unknown, ctx: SearchContext): Position | 'none' | undefined {
  const s = asText(v)
  if (!s) return undefined
  if (['aucun', 'none', 'sans poste', 'sans'].includes(normalize(s))) return 'none'
  const exact = ctx.positions.find((p) => p.id.toLowerCase() === s.toLowerCase())
  if (exact) return exact.id
  const m = bestMatch(s, ctx.positions, (p) => [p.label, ...(POSITION_ALIASES[p.id] ?? [])])
  return 'found' in m ? m.found.id : undefined
}

function matchDept(v: unknown, ctx: SearchContext): Match<{ code: string; name?: string }> {
  const s = asText(v)
  const codes = ctx.depts
  // Numéro (« 83 », 6 → « 06 », « 2A »), même au milieu d'un nom (« Var (83) »).
  const num = /^(\d{1,3}|2[ab])$/i.exec(s) ?? /\b(\d{2,3}|2[ab])\b/i.exec(s)
  if (num) {
    const c = num[1].toUpperCase()
    const code = /^\d$/.test(c) ? '0' + c : c
    const d = codes.find((x) => x.code === code)
    if (d) return { found: d }
  }
  return bestMatch(s, codes.filter((d) => d.name), (d) => [d.name!])
}

// ---------- Interprétation de la réponse du modèle ----------

export type Understood = { key: string; label: string }

export type Interpretation = {
  /** Nouveaux filtres : les filtres compris, tous les autres à zéro. */
  values: FilterValues
  /** Ce qui a été compris, dans l'ordre des pastilles de filtres. */
  understood: Understood[]
  /** Valeurs écartées : inconnues de la base, ambiguës ou incohérentes (« club « Toulon » : plusieurs clubs possibles »). */
  notFound: string[]
  /** Ce que le modèle n'a pas su traduire en filtre (renvoyé tel quel, nettoyé). */
  unsupported: string[]
}

const KNOWN_KEYS = new Set(['sexe', 'annee', 'trimestre', 'tailleMin', 'lateralite', 'poste', 'postesSecondaires', 'region', 'departement', 'club', 'pole', 'avecVideo', 'suivis', 'groupe', 'profil', 'recherche'])
const POLE_TEXT: Record<string, string> = { current: 'au Pôle Espoirs', past: 'sortis du Pôle Espoirs', any: 'passés par le Pôle Espoirs' }
const HAND_TEXT: Record<string, string> = { droitier: 'droitiers', gaucher: 'gauchers', ambidextre: 'ambidextres' }
const QUARTER_SHORT = ['janv.–mars', 'avril–juin', 'juil.–sept.', 'oct.–déc.']
const quote = (v: unknown) => `« ${asText(v).slice(0, 40) || '?'} »`

export function interpretFilters(raw: unknown, nonGere: unknown, ctx: SearchContext): Interpretation {
  const f: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const has = (k: string) => f[k] !== undefined && f[k] !== null && f[k] !== '' && f[k] !== false
  const values: FilterValues = { ...EMPTY_FILTERS }
  const understood: Understood[] = []
  const notFound: string[] = []
  const unsupported = (Array.isArray(nonGere) ? nonGere : [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 8)
  const skip = (what: string, why: string) => notFound.push(`${what} (${why})`)

  for (const k of Object.keys(f)) if (!KNOWN_KEYS.has(k) && has(k)) unsupported.push(`« ${k.slice(0, 30)} »`)

  if (has('sexe')) {
    const v = parseSex(f.sexe)
    if (v) {
      values.sex = v
      understood.push({ key: 'sexe', label: v === 'M' ? 'garçons' : 'filles' })
    } else skip(`sexe ${quote(f.sexe)}`, 'valeur inconnue')
  }
  if (has('annee')) {
    const v = parseYear(f.annee, ctx.thisYear)
    if (v) {
      values.year = String(v)
      understood.push({ key: 'annee', label: `${values.sex === 'F' ? 'nées' : 'nés'} en ${v}` })
    } else skip(`année ${quote(f.annee)}`, 'pas une année de naissance')
  }
  if (has('trimestre')) {
    const v = parseQuarter(f.trimestre)
    if (v) {
      values.quarter = v
      understood.push({ key: 'trimestre', label: `trimestre ${v} (${QUARTER_SHORT[v - 1]})` })
    } else skip(`trimestre ${quote(f.trimestre)}`, 'valeur inconnue')
  }
  if (has('tailleMin')) {
    const v = parseHeight(f.tailleMin)
    if (v) {
      values.minH = String(v)
      understood.push({ key: 'tailleMin', label: `taille ≥ ${v} cm` })
    } else skip(`taille ${quote(f.tailleMin)}`, 'entre 100 et 230 cm')
  }
  if (has('lateralite')) {
    const v = parseHand(f.lateralite)
    if (v) {
      values.hand = v
      understood.push({ key: 'lateralite', label: HAND_TEXT[v] })
    } else skip(`latéralité ${quote(f.lateralite)}`, 'valeur inconnue')
  }
  if (has('departement')) {
    const m = matchDept(f.departement, ctx)
    if ('found' in m) {
      values.dept = m.found.code
      understood.push({ key: 'departement', label: m.found.name ? `${m.found.name} (${m.found.code})` : `département ${m.found.code}` })
    } else if ('ambiguous' in m) skip(`département ${quote(f.departement)}`, `plusieurs possibles : ${m.ambiguous.slice(0, 3).map((d) => d.name).join(', ')}`)
    else skip(`département ${quote(f.departement)}`, 'pas trouvé')
  }
  if (has('region')) {
    const s = asText(f.region)
    const exact = ctx.regions.find((r) => r.id === s)
    const m = exact ? { found: exact } : bestMatch(s, ctx.regions, (r) => [r.name, ...(REGION_ALIASES[r.id] ?? [])])
    if ('found' in m) {
      const deptRegion = values.dept && ctx.regionOfDept?.(values.dept)
      // Le département suffit (et décide) : une région qui le contredit est écartée.
      if (deptRegion && deptRegion !== m.found.id) skip(`région ${quote(m.found.name)}`, 'le département choisi est dans une autre région')
      else {
        values.region = m.found.id
        understood.push({ key: 'region', label: m.found.name })
      }
    } else if ('ambiguous' in m) skip(`région ${quote(s)}`, `plusieurs possibles : ${m.ambiguous.slice(0, 3).map((r) => r.name).join(', ')}`)
    else skip(`région ${quote(s)}`, 'pas trouvée')
  }
  if (has('club')) {
    const s = asText(f.club)
    const m = bestMatch(s, ctx.clubs, (c) => [c])
    if ('found' in m) {
      values.club = m.found
      understood.push({ key: 'club', label: m.found })
    } else if ('ambiguous' in m)
      skip(`club ${quote(s)}`, `${m.ambiguous.length} clubs possibles : choisissez dans Filtres`)
    else skip(`club ${quote(s)}`, 'pas trouvé dans la base')
  }
  if (has('suivis')) {
    if (isTrue(f.suivis)) {
      values.followedOnly = true
      understood.push({ key: 'suivis', label: 'mes suivis' })
    }
  }
  if (has('pole')) {
    const v = parsePole(f.pole)
    if (v) {
      values.pole = v
      understood.push({ key: 'pole', label: POLE_TEXT[v] })
    } else skip(`Pôle ${quote(f.pole)}`, 'valeur inconnue')
  }
  if (has('avecVideo') && isTrue(f.avecVideo)) {
    values.videoOnly = true
    understood.push({ key: 'avecVideo', label: 'avec une vidéo' })
  }
  if (has('profil')) {
    const s = asText(f.profil)
    const m = bestMatch(s, ctx.profiles, (p) => [p.name])
    if ('found' in m) {
      values.profile = m.found.id
      understood.push({ key: 'profil', label: `profil : ${m.found.name}` })
    } else skip(`profil ${quote(s)}`, 'ambiguous' in m ? 'plusieurs possibles' : 'pas trouvé')
  }
  if (has('groupe')) {
    const s = asText(f.groupe)
    const m = bestMatch(s, ctx.groups, (g) => [g.name])
    if ('found' in m) {
      values.group = m.found.id
      understood.push({ key: 'groupe', label: `groupe : ${m.found.name}` })
    } else skip(`groupe ${quote(s)}`, 'ambiguous' in m ? 'plusieurs possibles' : 'pas trouvé')
  }
  if (has('poste')) {
    const v = matchPosition(f.poste, ctx)
    if (v) {
      values.position = v
      understood.push({ key: 'poste', label: v === 'none' ? 'sans poste' : (ctx.positions.find((p) => p.id === v)?.label ?? v).toLowerCase() })
      if (v !== 'none' && has('postesSecondaires') && isTrue(f.postesSecondaires)) {
        values.withSecondary = true
        understood.push({ key: 'postesSecondaires', label: '+ postes secondaires' })
      }
    } else skip(`poste ${quote(f.poste)}`, 'valeur inconnue')
  }
  if (has('recherche')) {
    let s = asText(f.recherche).replace(/\s+/g, ' ').slice(0, 60)
    // Licence dite par morceaux (« 638 301 500 1234 ») : chiffres recollés. Le nom est gardé tel quel (la liste le cherche
    // sans accents ni majuscules, puis en approchant s'il ne trouve personne).
    if (/^[\d\s.-]+$/.test(s)) s = s.replace(/\D/g, '')
    // Valeur de remplacement renvoyée par le modèle (« (nom) ») : ignorée.
    if (s && !/^\(.*\)$/.test(s)) {
      values.q = s
      understood.push({ key: 'recherche', label: /^\d+$/.test(s) ? `licence ${s}` : `nom : ${s}` })
    }
  }
  return { values, understood, notFound, unsupported }
}

// ---------- Opérations sur les filtres actuels ----------

/** remplacer : nouvelle recherche ; ajouter : garder les filtres actuels et ajouter (ou changer) ; retirer ; effacer : tout. */
export type FilterAction = 'remplacer' | 'ajouter' | 'retirer' | 'effacer'
export const ACTIONS: FilterAction[] = ['remplacer', 'ajouter', 'retirer', 'effacer']

/** Champs de FilterValues de chaque clé du schéma. */
const KEY_FIELDS: Record<string, (keyof FilterValues)[]> = {
  sexe: ['sex'],
  annee: ['year'],
  trimestre: ['quarter'],
  tailleMin: ['minH'],
  lateralite: ['hand'],
  poste: ['position', 'withSecondary'],
  postesSecondaires: ['withSecondary'],
  region: ['region'],
  departement: ['dept'],
  club: ['club'],
  pole: ['pole'],
  avecVideo: ['videoOnly'],
  suivis: ['followedOnly'],
  groupe: ['group'],
  profil: ['profile'],
  recherche: ['q'],
}
/** Nom court d'un filtre (« Retiré : taille »). */
export const KEY_TEXT: Record<string, string> = {
  sexe: 'garçons / filles',
  annee: 'année',
  trimestre: 'trimestre',
  tailleMin: 'taille',
  lateralite: 'latéralité',
  poste: 'poste',
  postesSecondaires: 'postes secondaires',
  region: 'région',
  departement: 'département',
  club: 'club',
  pole: 'Pôle Espoirs',
  avecVideo: 'vidéo',
  suivis: 'suivis',
  groupe: 'groupe',
  profil: 'profil',
  recherche: 'recherche par nom',
}
// Mots acceptés dans « retirer » à la place des clés (petits modèles : « taille », « année »…).
const KEY_ALIASES: Record<string, string> = {
  taille: 'tailleMin',
  tailles: 'tailleMin',
  hauteur: 'tailleMin',
  annee: 'annee',
  annees: 'annee',
  age: 'annee',
  naissance: 'annee',
  sexe: 'sexe',
  genre: 'sexe',
  trimestre: 'trimestre',
  lateralite: 'lateralite',
  main: 'lateralite',
  poste: 'poste',
  postes: 'poste',
  region: 'region',
  ligue: 'region',
  departement: 'departement',
  dept: 'departement',
  club: 'club',
  pole: 'pole',
  video: 'avecVideo',
  videos: 'avecVideo',
  suivis: 'suivis',
  groupe: 'groupe',
  profil: 'profil',
  recherche: 'recherche',
  nom: 'recherche',
  noms: 'recherche',
  prenom: 'recherche',
  licence: 'recherche',
}

export type ModelAnswer = { action?: unknown; filtres?: unknown; retirer?: unknown; nonGere?: unknown }

export type Outcome = {
  action: FilterAction
  /** Filtres à appliquer (tous). */
  values: FilterValues
  /** Critères posés (remplacer, ajouter). */
  added: Understood[]
  /** Noms des filtres retirés (« taille »). */
  removed: string[]
  notFound: string[]
  unsupported: string[]
  /** Les filtres changent-ils ? */
  changed: boolean
}

/** Au moins un filtre posé (Garçons / Filles compris). */
export const hasFilters = (v: FilterValues) => !sameFilters(v, EMPTY_FILTERS)

/** Clé du schéma pour un nom de filtre rendu dans « retirer » : clé exacte ou mot courant (« la taille », « filtre année »). */
export function keyOf(v: unknown): string | undefined {
  const s = asText(v)
  if (KEY_FIELDS[s]) return s
  const w = normalize(s)
    .split(' ')
    .filter((x) => !['le', 'la', 'les', 'l', 'filtre', 'filtres', 'critere', 'condition', 'de', 'd', 'du', 'des', 'sur', 'par'].includes(x))
  return w.length ? KEY_ALIASES[w[0]] : undefined
}

/**
 * Applique la réponse du modèle aux filtres actuels, après vérification de chaque valeur :
 *  - effacer : tout à zéro ; remplacer : seulement les nouveaux critères ;
 *  - ajouter : filtres actuels + nouveaux critères (une clé déjà posée prend la nouvelle valeur) ; « retirer » peut s'y ajouter ;
 *  - retirer : les clés citées reviennent à zéro (un critère rendu dans « filtres », « retire le Var », retire aussi sa clé).
 * Action absente ou inconnue (ancienne version de la fonction) : « retirer » s'il n'y a que des clés à retirer, sinon « remplacer ».
 */
export function applyAnswer(answer: ModelAnswer, current: FilterValues, ctx: SearchContext): Outcome {
  const it = interpretFilters(answer.filtres, answer.nonGere, ctx)
  const rawRemove = Array.isArray(answer.retirer) ? answer.retirer.slice(0, 16) : []
  let action: FilterAction = ACTIONS.includes(answer.action as FilterAction)
    ? (answer.action as FilterAction)
    : !it.understood.length && rawRemove.length
      ? 'retirer'
      : 'remplacer'
  // Rien d'actif : « ajouter » revient à « remplacer ».
  if (action === 'ajouter' && !hasFilters(current)) action = 'remplacer'
  const out = { action, added: [] as Understood[], removed: [] as string[], notFound: it.notFound, unsupported: it.unsupported }
  if (action === 'effacer') return { ...out, values: { ...EMPTY_FILTERS }, changed: hasFilters(current) }
  if (action === 'remplacer') {
    if (!it.understood.length) return { ...out, values: current, changed: false }
    return { ...out, values: it.values, added: it.understood, changed: !sameFilters(it.values, current) }
  }
  const values: FilterValues = { ...current }
  const set = (f: keyof FilterValues, v: unknown) => ((values as Record<string, unknown>)[f] = v)
  const keys = new Set<string>()
  for (const r of rawRemove) {
    const k = keyOf(r)
    if (k) keys.add(k)
    else out.notFound.push(`retirer ${quote(r)} (filtre inconnu)`)
  }
  if (action === 'retirer') for (const u of it.understood) keys.add(u.key)
  for (const k of keys) {
    const fields = KEY_FIELDS[k]
    const before = JSON.stringify(fields.map((f) => values[f]))
    for (const f of fields) set(f, EMPTY_FILTERS[f])
    if (JSON.stringify(fields.map((f) => values[f])) !== before) out.removed.push(KEY_TEXT[k])
  }
  if (action === 'ajouter') {
    for (const u of it.understood) for (const f of KEY_FIELDS[u.key]) set(f, it.values[f])
    out.added = it.understood
    const added = new Set(it.understood.map((u) => u.key))
    // Nouveau département : une région d'ailleurs part ; nouvelle région : un département d'ailleurs part.
    if (added.has('departement') && !added.has('region') && values.region && ctx.regionOfDept && ctx.regionOfDept(values.dept) !== values.region) values.region = ''
    if (added.has('region') && !added.has('departement') && values.dept && ctx.regionOfDept && ctx.regionOfDept(values.dept) !== values.region) values.dept = ''
  }
  return { ...out, values, changed: !sameFilters(values, current) }
}

/** Ce qui s'est passé, en une ligne : « Ajouté : Var (83) », « Retiré : taille », « Filtres effacés », « Remplacés : … ». */
export function outcomeText(o: Outcome, hadFilters: boolean): string {
  const list = (u: Understood[]) => u.map((x) => x.label).join(' · ')
  if (o.action === 'effacer') return o.changed ? 'Filtres effacés' : 'Aucun filtre à effacer'
  if (!o.changed) return ''
  if (o.action === 'remplacer') return `${hadFilters ? 'Remplacés' : 'Compris'} : ${list(o.added)}`
  return [o.removed.length ? `Retiré : ${o.removed.join(' · ')}` : '', o.added.length ? `Ajouté : ${list(o.added)}` : ''].filter(Boolean).join(' — ')
}

// ---------- Commandes évidentes, sans appel au modèle ----------

// « efface la sélection », « réinitialise », « remets à zéro », « tout effacer », « supprime les filtres », « montre tout le monde »…
const POLITE = String.raw`(?:(?:s il (?:te|vous) plait|stp|svp|merci|ok|bon|alors|allez|euh|tu peux|vous pouvez|peux tu|pouvez vous|je veux|on peut|il faut) )*`
const END = String.raw`(?: s il (?:te|vous) plait| stp| svp| merci)?$`
const VERB = String.raw`(?:efface[rsz]?|reinitialise[rsz]?|vide[rsz]?|supprime[rsz]?|enleve[rsz]?|retire[rsz]?|nettoie[rsz]?|nettoyer|reset|remet[stz]? (?:tout )?a zero|remettre (?:tout )?a zero|remise a zero|recommence[rsz]?|on recommence|on repart de zero|repars de zero|on efface tout)`
const WHAT = String.raw`(?: tout)?(?: (?:tous |toutes )?(?:les|la|le|mes|ma|mon|ces|cette|tout|toute) (?:filtres?|selection|criteres?|conditions?|recherche))?(?: tout)?`
const CLEAR_RES = [
  new RegExp(`^${POLITE}${VERB}${WHAT}${END}`),
  new RegExp(`^${POLITE}(?:tout effacer|tout efface|plus de filtres?|sans (?:aucun )?filtres?|aucun filtre|zero filtre)${END}`),
  new RegExp(`^${POLITE}(?:montre|affiche|montrer|afficher|montrez|affichez|voir|donne) (?:moi )?(?:tout le monde|tous les joueurs|toute la liste|la liste complete|tout|tous)${END}`),
]

/** Commande reconnue sans le modèle (instantané, gratuit, hors ligne) ; null : à envoyer au modèle. */
export function localCommand(phrase: string): 'effacer' | null {
  const n = normalize(phrase)
  if (!n || n.split(' ').length > 10) return null
  return CLEAR_RES.some((re) => re.test(n)) ? 'effacer' : null
}

/** « Compris : nés en 2010 · taille ≥ 180 cm » (vide si rien n'a été compris). */
export function summaryText(understood: Understood[]): string {
  return understood.length ? `Compris : ${understood.map((u) => u.label).join(' · ')}` : ''
}

/** « Je ne sais pas encore filtrer sur : … » (vide s'il n'y a rien à dire). */
export function unsupportedText(it: Pick<Interpretation, 'unsupported'>): string {
  return it.unsupported.length ? `Je ne sais pas encore filtrer sur : ${it.unsupported.join(' ; ')}` : ''
}

/** Valeurs écartées, en termes neutres : « Non appliqué : club « X » (pas trouvé dans la base) ». */
export function notFoundText(it: Pick<Interpretation, 'notFound'>): string {
  return it.notFound.length ? `Non appliqué : ${it.notFound.join(' ; ')}` : ''
}
