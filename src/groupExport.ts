import { poleName, type PolePeriod, type Player } from './db'
import { positionCodes, positionFull } from './sportConfig'

/*
 * Export d'un groupe en PDF (n'importe quel groupe ; ex. « Pôle Saint-Raph 2027-2028 » envoyé à la ligue) : calculs purs
 * (sans base ni écran), testés par tools/test-export-groupe.ts. Seulement l'identité et des informations administratives
 * (colonnes calquées sur la liste de l'outil fédéral) : aucune note, aucun avis, aucun commentaire, ni scolarité ni
 * famille. Séparation facultative « déjà au pôle » / « nouveaux arrivants ».
 */

const fold = (s = '') =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const filled = (x: PolePeriod) => !!(x.from || x.to || x.name || x.regionId || x.site)
/** Période en cours à cette date (même règle que poleStatus, src/db.ts). */
const isCurrent = (x: PolePeriod, today: string) => filled(x) && (!x.from || x.from <= today) && (!x.to || x.to >= today)

/** Clé d'un pôle : ligue et site (ou ancien nom libre), sans accents ni majuscules. */
export const poleKey = (x: PolePeriod) => `${x.regionId ?? ''}|${fold(x.site || (x.regionId ? '' : x.name))}`

/** Périodes de pôle en cours aujourd'hui. */
export const currentPoles = (p: Pick<Player, 'poles'>, today: string) => (p.poles ?? []).filter((x) => isCurrent(x, today))

/** Mots qui ne désignent pas un site (« Pôle Saint-Raph » : seul « raph » compte). */
const STOP = new Set(['saint', 'sainte', 'pole', 'poles', 'les', 'sur', 'aux', 'des', 'creps', 'espoirs', 'ligue', 'region'])

export interface PoleChoice {
  key: string
  label: string
  /** Joueurs du groupe actuellement dans ce pôle. */
  count: number
}

/**
 * Pôles en cours des joueurs du groupe, le plus probable d'abord : celui dont le site est cité dans le nom du groupe
 * (« Pôle Saint-Raph » → Saint-Raphaël, début d'un mot du site, 3 lettres au moins), puis le plus représenté.
 */
export function poleChoices(players: Pick<Player, 'poles'>[], today: string, groupName = '', region?: (id: string) => string | undefined): PoleChoice[] {
  const m = new Map<string, PoleChoice & { named: boolean }>()
  const words = fold(groupName).split(' ')
  for (const p of players)
    for (const k of new Set(currentPoles(p, today).map(poleKey))) {
      const x = currentPoles(p, today).find((y) => poleKey(y) === k)!
      const c = m.get(k) ?? {
        key: k,
        label: poleName({ regionId: x.regionId, site: x.site, name: x.name }, region),
        count: 0,
        named: fold(x.site || x.name)
          .split(' ')
          .filter((w) => w.length >= 3 && !STOP.has(w))
          .some((w) => words.some((g) => g.length >= 3 && !STOP.has(g) && (w.startsWith(g) || g.startsWith(w.slice(0, 4))))),
      }
      c.count++
      m.set(k, c)
    }
  return [...m.values()]
    .sort((a, b) => Number(b.named) - Number(a.named) || b.count - a.count || a.label.localeCompare(b.label, 'fr'))
    .map(({ named: _named, ...c }) => c)
}

/** « reste » : déjà au pôle (y reste) ; « nouveau » : nouvel arrivant. */
export type Stay = 'reste' | 'nouveau'

/** Pôle de référence : une clé (poleKey), « any » (n'importe quel pôle en cours) ou rien (aucun joueur au pôle). */
export type PoleTarget = string | 'any' | undefined

/**
 * Règle : un joueur est « déjà au pôle » s'il est aujourd'hui dans le pôle de référence (période en cours dans la fiche :
 * entrée passée ou vide, sortie vide ou à venir) ; sinon il est « nouveau » (jamais passé en pôle, sorti, ou dans un
 * autre pôle). Le choix fait à la main avant d'imprimer l'emporte toujours.
 */
export function stayOf(p: Pick<Player, 'id' | 'poles'>, today: string, target: PoleTarget, overrides: Record<string, Stay> = {}): Stay {
  const o = overrides[p.id]
  if (o === 'reste' || o === 'nouveau') return o
  if (!target) return 'nouveau'
  return currentPoles(p, today).some((x) => target === 'any' || poleKey(x) === target) ? 'reste' : 'nouveau'
}

// ---------- Colonnes ----------

/** Une ligne du document : le joueur et sa dernière taille (cm). */
export interface Row {
  p: Pick<Player, 'id' | 'lastName' | 'firstName' | 'birthDate' | 'sex' | 'position' | 'club' | 'laterality' | 'license' | 'poles' | 'category'>
  height?: number
}

/** Colonnes possibles (vocabulaire de l'outil fédéral). `base` : affichée par défaut. */
export const COLUMNS = [
  { id: 'nom', label: 'Nom', base: true },
  { id: 'prenom', label: 'Prénom', base: true },
  { id: 'naissance', label: 'Date de naissance', base: true },
  { id: 'annee', label: 'Année', base: false },
  { id: 'genre', label: 'Genre', base: true },
  { id: 'poste', label: 'Poste', base: true },
  { id: 'club', label: 'Club', base: true },
  { id: 'taille', label: 'Taille (cm)', base: true },
  { id: 'lateralite', label: 'Latéralité', base: true },
  { id: 'licence', label: 'N° de licence', base: true },
  { id: 'pole', label: 'Statut pôle / SHN', base: false },
  { id: 'niveau', label: 'Niveau', base: false },
] as const
export type ColumnId = (typeof COLUMNS)[number]['id']

/** Poste en toutes lettres (configuration de l'installation, src/sportConfig.ts) : « Gardien de but », « Ailier gauche »… */
export const posteLabel = (p?: string | null) => positionFull(p)
/** « Droite », « Gauche », « Ambidextre ». */
export const lateraliteLabel = (l?: string | null) => (l === 'droitier' ? 'Droite' : l === 'gaucher' ? 'Gauche' : l === 'ambidextre' ? 'Ambidextre' : '')
export const birthYear = (p: Pick<Player, 'birthDate'>) => (/^\d{4}/.test(p.birthDate ?? '') ? p.birthDate!.slice(0, 4) : '')
/** « 01/03/2010 » (l'année seule si la date n'est pas complète). */
export const birthLabel = (d?: string) => (!d ? '' : /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('/') : birthYear({ birthDate: d }))

/** « Pôle (Saint-Raphaël) » si une période de Pôle Espoirs est en cours, « Ancien pôle (Aix-en-Provence) » s'il en est sorti. */
export function poleStatusLabel(p: Pick<Player, 'poles'>, today: string): string {
  const where = (x: PolePeriod) => (x.site || x.name ? ` (${x.site || x.name})` : '')
  const cur = currentPoles(p, today)[0]
  if (cur) return `Pôle${where(cur)}`
  const past = (p.poles ?? []).filter((x) => filled(x) && !!x.to && x.to < today).sort((a, b) => (b.to ?? '').localeCompare(a.to ?? ''))[0]
  return past ? `Ancien pôle${where(past)}` : ''
}

/** Texte d'une cellule (vide si la donnée manque). */
export function cellText(r: Row, c: ColumnId, today: string): string {
  const p = r.p
  switch (c) {
    case 'nom':
      return (p.lastName ?? '').toUpperCase()
    case 'prenom':
      return p.firstName ?? ''
    case 'naissance':
      return birthLabel(p.birthDate)
    case 'annee':
      return birthYear(p)
    case 'genre':
      return p.sex ?? ''
    case 'poste':
      return posteLabel(p.position)
    case 'club':
      return p.club?.trim() ?? ''
    case 'taille':
      return r.height ? `${Math.round(r.height)}` : ''
    case 'lateralite':
      return lateraliteLabel(p.laterality)
    case 'licence':
      return p.license?.trim() ?? ''
    case 'pole':
      return poleStatusLabel(p, today)
    case 'niveau':
      return p.category?.trim() ?? ''
  }
}

/** Données attendues : une seule absente et la fiche est « incomplète ». */
export const REQUIRED: ColumnId[] = ['licence', 'naissance', 'taille', 'lateralite', 'poste', 'club']
export const missingOf = (r: Row, today: string) => REQUIRED.filter((c) => !cellText(r, c, today))

// ---------- Tri, recherche, parties ----------

export type SortDir = 'asc' | 'desc'
export interface SortBy {
  key: ColumnId
  dir: SortDir
}

const byName = (a: Row, b: Row) =>
  (a.p.lastName ?? '').localeCompare(b.p.lastName ?? '', 'fr', { sensitivity: 'base' }) || (a.p.firstName ?? '').localeCompare(b.p.firstName ?? '', 'fr', { sensitivity: 'base' })

/**
 * Tri par une colonne (clic sur son titre), puis par nom ; valeur absente toujours à la fin, dans les deux sens.
 * Date de naissance croissante : les aînés d'abord ; poste : ordre du terrain ; taille : en nombre.
 */
export function sortRows<T extends Row>(rows: T[], by: SortBy, today: string): T[] {
  const val = (r: T): string | number | undefined => {
    if (by.key === 'taille') return r.height || undefined
    if (by.key === 'naissance' || by.key === 'annee') return r.p.birthDate || undefined
    // Ordre des postes de l'installation (handball : ordre du terrain).
    if (by.key === 'poste') return r.p.position && positionCodes().includes(r.p.position) ? positionCodes().indexOf(r.p.position) : undefined
    return cellText(r, by.key, today) || undefined
  }
  const s = by.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (by.key === 'nom') return s * byName(a, b)
    const x = val(a)
    const y = val(b)
    if (x === undefined || y === undefined) return x === y ? byName(a, b) : x === undefined ? 1 : -1
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr', { sensitivity: 'base', numeric: true })
    return s * c || byName(a, b)
  })
}

/** Recherche « Joueur » : nom, prénom, licence ou club, sans accents ni majuscules. */
export function matchesSearch(r: Row, q: string): boolean {
  const hay = fold(`${r.p.lastName ?? ''} ${r.p.firstName ?? ''} ${r.p.license ?? ''} ${r.p.club ?? ''}`)
  return fold(q)
    .split(' ')
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

/** Les deux parties du document (« déjà au pôle » / « nouveaux »), chacune dans l'ordre choisi. */
export function splitSections<T extends Row>(rows: T[], o: { today: string; target: PoleTarget; overrides?: Record<string, Stay>; sort?: SortBy }) {
  const stay: T[] = []
  const arrivals: T[] = []
  for (const r of rows) (stayOf(r.p, o.today, o.target, o.overrides) === 'reste' ? stay : arrivals).push(r)
  const by = o.sort ?? { key: 'nom', dir: 'asc' }
  return { stay: sortRows(stay, by, o.today), arrivals: sortRows(arrivals, by, o.today) }
}

// ---------- Totaux ----------

export interface YearRow {
  /** Année de naissance, '' = non renseignée. */
  year: string
  M: number
  F: number
  /** Genre non renseigné. */
  other: number
  total: number
}

/** Effectif par année de naissance et genre (années croissantes, année inconnue à la fin), et la ligne « Total ». */
export function totalsByYear(players: Pick<Player, 'birthDate' | 'sex'>[]): { rows: YearRow[]; total: YearRow } {
  const m = new Map<string, YearRow>()
  const total: YearRow = { year: 'total', M: 0, F: 0, other: 0, total: 0 }
  for (const p of players) {
    const y = birthYear(p)
    const r = m.get(y) ?? { year: y, M: 0, F: 0, other: 0, total: 0 }
    for (const x of [r, total]) {
      if (p.sex === 'M') x.M++
      else if (p.sex === 'F') x.F++
      else x.other++
      x.total++
    }
    m.set(y, r)
  }
  const rows = [...m.values()].sort((a, b) => (!a.year ? 1 : !b.year ? -1 : a.year.localeCompare(b.year)))
  return { rows, total }
}

/** Groupe mixte : déclaré mixte, ou garçons et filles parmi ses joueurs. */
export const isMixed = (groupSex: string | undefined, players: Pick<Player, 'sex'>[]) =>
  groupSex === 'mixte' || (players.some((p) => p.sex === 'M') && players.some((p) => p.sex === 'F'))

/** « Joueuses » si toutes sont des filles, sinon « Joueurs » (titres des parties). */
export function sectionTitles(players: Pick<Player, 'sex'>[]) {
  const girls = players.length > 0 && players.every((p) => p.sex === 'F')
  return girls
    ? { all: 'Liste des joueuses', stay: 'Joueuses déjà au pôle', arrivals: 'Nouvelles arrivantes', one: 'joueuse', many: 'joueuses' }
    : { all: 'Liste des joueurs', stay: 'Joueurs déjà au pôle', arrivals: 'Nouveaux arrivants', one: 'joueur', many: 'joueurs' }
}

/** Chaîne CSS entre guillemets (contenu des marges de page). */
export const cssString = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r]+/g, ' ')}"`
