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
import {
  applyWith,
  asText,
  bestMatch,
  isTrue,
  keyOfWith,
  normalize,
  parseSex,
  parseYear,
  quote,
  readPlace,
  sameValues,
  startReading,
  type FilterRules,
  type Interpretation as GenericInterpretation,
  type ModelAnswer,
  type Outcome as GenericOutcome,
} from './voiceFilters'

// Outils communs à toutes les pages (src/voiceFilters.ts), repris ici pour la liste Joueurs.
export {
  ACTIONS,
  bestMatch,
  localCommand,
  normalize,
  notFoundText,
  outcomeText,
  parseSex,
  parseYear,
  summaryText,
  unsupportedText,
  type FilterAction,
  type Match,
  type ModelAnswer,
  type Understood,
} from './voiceFilters'

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

export const sameFilters = (a: FilterValues, b: FilterValues) => sameValues(EMPTY_FILTERS, a, b)

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

export const POSITION_ALIASES: Record<string, string[]> = {
  GB: ['gardien de but', 'gardienne', 'goal', 'GK'],
  DC: ['demi centre', 'demi', 'meneur', 'meneuse', 'DC'],
  ARG: ['arrière gauche', 'ARG'],
  ARD: ['arrière droit', 'arrière droite', 'ARD'],
  AG: ['ailier gauche', 'ailière gauche', 'aile gauche', 'AG'],
  AD: ['ailier droit', 'ailière droite', 'aile droite', 'AD'],
  PIV: ['pivot', 'PIV'],
}

// ---------- Lecture des valeurs ----------


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

export function parseQuarter(v: unknown): number | undefined {
  const s = normalize(asText(v))
  const m = /^(?:q|t)?\s*([1-4])(?:er|e|eme)?$/.exec(s)
  if (m) return Number(m[1])
  const words: Record<string, number> = { premier: 1, deuxieme: 2, second: 2, troisieme: 3, quatrieme: 4, dernier: 4 }
  for (const [k, q] of Object.entries(words)) if (s.startsWith(k)) return q
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

// ---------- Interprétation de la réponse du modèle ----------

export type Interpretation = GenericInterpretation<FilterValues>

const KNOWN_KEYS = new Set(['sexe', 'annee', 'trimestre', 'tailleMin', 'lateralite', 'poste', 'postesSecondaires', 'region', 'departement', 'club', 'pole', 'avecVideo', 'suivis', 'groupe', 'profil', 'recherche'])
const POLE_TEXT: Record<string, string> = { current: 'au Pôle Espoirs', past: 'sortis du Pôle Espoirs', any: 'passés par le Pôle Espoirs' }
const HAND_TEXT: Record<string, string> = { droitier: 'droitiers', gaucher: 'gauchers', ambidextre: 'ambidextres' }
const QUARTER_SHORT = ['janv.–mars', 'avril–juin', 'juil.–sept.', 'oct.–déc.']
export function interpretFilters(raw: unknown, nonGere: unknown, ctx: SearchContext): Interpretation {
  const r = startReading(raw, nonGere, KNOWN_KEYS)
  const { f, understood, notFound, unsupported, skip } = r
  const has = r.has
  const values: FilterValues = { ...EMPTY_FILTERS }

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
  readPlace(f, ctx, r, { dept: (c) => (values.dept = c), region: (id) => (values.region = id) })
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


export type Outcome = GenericOutcome<FilterValues>

/** Au moins un filtre posé (Garçons / Filles compris). */
export const hasFilters = (v: FilterValues) => !sameFilters(v, EMPTY_FILTERS)

/** Règles de la liste Joueurs pour un contexte donné (listes réelles de l'appli). */
export function playerRules(ctx: SearchContext): FilterRules<FilterValues> {
  return {
    empty: EMPTY_FILTERS,
    fields: KEY_FIELDS,
    keyText: KEY_TEXT,
    aliases: KEY_ALIASES,
    interpret: (filtres, nonGere) => interpretFilters(filtres, nonGere, ctx),
    // Nouveau département : une région d'ailleurs part ; nouvelle région : un département d'ailleurs part.
    afterAdd: (values, added) => {
      if (added.has('departement') && !added.has('region') && values.region && ctx.regionOfDept && ctx.regionOfDept(values.dept) !== values.region) values.region = ''
      if (added.has('region') && !added.has('departement') && values.dept && ctx.regionOfDept && ctx.regionOfDept(values.dept) !== values.region) values.dept = ''
    },
  }
}

/** Clé du schéma pour un nom de filtre rendu dans « retirer » : clé exacte ou mot courant (« la taille », « filtre année »). */
export const keyOf = (v: unknown) => keyOfWith({ fields: KEY_FIELDS, aliases: KEY_ALIASES }, v)

/** Applique la réponse du modèle aux filtres actuels de la liste Joueurs (voir applyWith). */
export const applyAnswer = (answer: ModelAnswer, current: FilterValues, ctx: SearchContext): Outcome => applyWith(playerRules(ctx), answer, current)
