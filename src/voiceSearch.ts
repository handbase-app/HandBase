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

type Choice = { valeur: string | number; sens: string }
type SchemaEntry = { type: 'texte' | 'entier' | 'booleen'; sens: string; valeurs?: Choice[]; min?: number; max?: number }

export const QUARTER_TEXT = ['janvier à mars', 'avril à juin', 'juillet à septembre', 'octobre à décembre']
const POLE_KEYS: Record<string, PoleValue> = { en_cours: 'current', sortis: 'past', tous: 'any' }

export function buildSchema(ctx: SearchContext): Record<string, SchemaEntry> {
  const s: Record<string, SchemaEntry> = {
    sexe: { type: 'texte', sens: 'sexe des joueurs', valeurs: [{ valeur: 'M', sens: 'garçons' }, { valeur: 'F', sens: 'filles' }] },
    annee: { type: 'entier', sens: 'année de naissance (une seule)', min: 1950, max: ctx.thisYear },
    trimestre: { type: 'entier', sens: 'trimestre de naissance', valeurs: QUARTER_TEXT.map((t, i) => ({ valeur: i + 1, sens: t })) },
    tailleMin: { type: 'entier', sens: 'taille minimum en centimètres (dernière mesure)', min: 100, max: 230 },
    lateralite: {
      type: 'texte',
      sens: 'latéralité',
      valeurs: [
        { valeur: 'droitier', sens: 'droitiers, droitières' },
        { valeur: 'gaucher', sens: 'gauchers, gauchères' },
        { valeur: 'ambidextre', sens: 'ambidextres' },
      ],
    },
    poste: {
      type: 'texte',
      sens: 'poste principal',
      valeurs: [...ctx.positions.map((p) => ({ valeur: p.id, sens: p.label })), { valeur: 'aucun', sens: 'sans poste renseigné' }],
    },
    postesSecondaires: { type: 'booleen', sens: 'compter aussi les joueurs qui ont ce poste en secondaire (avec « poste »)' },
    region: { type: 'texte', sens: 'région (ligue)', valeurs: ctx.regions.map((r) => ({ valeur: r.id, sens: r.name })) },
    departement: { type: 'texte', sens: 'département du club', valeurs: ctx.depts.map((d) => ({ valeur: d.code, sens: d.name ?? `département ${d.code}` })) },
    club: { type: 'texte', sens: 'nom du club, tel qu’il est dit' },
    pole: {
      type: 'texte',
      sens: 'Pôle Espoirs',
      valeurs: [
        { valeur: 'en_cours', sens: 'au Pôle Espoirs en ce moment' },
        { valeur: 'sortis', sens: 'sortis du Pôle Espoirs' },
        { valeur: 'tous', sens: 'passés par le Pôle Espoirs (en cours ou sortis)' },
      ],
    },
    avecVideo: { type: 'booleen', sens: 'seulement les joueurs qui ont une vidéo' },
    suivis: { type: 'booleen', sens: 'seulement les joueurs que je suis' },
  }
  if (ctx.groups.length) s.groupe = { type: 'texte', sens: 'groupe de joueurs', valeurs: ctx.groups.map((g) => ({ valeur: g.name, sens: 'groupe' })) }
  if (ctx.profiles.length) s.profil = { type: 'texte', sens: 'profil recherché enregistré', valeurs: ctx.profiles.map((p) => ({ valeur: p.name, sens: 'profil' })) }
  s.recherche = { type: 'texte', sens: 'nom, prénom ou numéro de licence d’une personne citée explicitement' }
  return s
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
      understood.push({ key: 'departement', label: m.found.name ? `${m.found.code} · ${m.found.name}` : `département ${m.found.code}` })
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
    const s = asText(f.recherche).replace(/\s+/g, ' ').slice(0, 60)
    if (s) {
      values.q = s
      understood.push({ key: 'recherche', label: `« ${s} »` })
    }
  }
  return { values, understood, notFound, unsupported }
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
