import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { alive, db, type ListItem } from './db'

/*
 * Listes modifiables par les administrateurs (Réglages), synchronisées comme le reste.
 * Les noms viennent de la base (supabase/019_listes_regions.sql) ; seul le découpage officiel des régions
 * (plus bas) sert de repli quand la liste ne dit rien.
 */

const byOrder = (a: ListItem, b: ListItem) => a.order - b.order || a.name.localeCompare(b.name, 'fr')

/** Régions, dans l'ordre choisi par les administrateurs. */
export function useRegions(): ListItem[] {
  return useLiveQuery(() => db.lists.where('kind').equals('region').toArray().then((rs) => alive(rs).sort(byOrder)), [], [])
}

/** Nom d'une région à partir de son identifiant (vide si inconnue ou supprimée). */
export function useRegionName() {
  const regions = useRegions()
  const names = new Map(regions.map((r) => [r.id, r.name]))
  return (id?: string) => (id ? names.get(id) : undefined)
}

// ---------- Départements ----------

// Tri par numéro, la Corse (2A, 2B) entre 19 et 21.
const codeKey = (c = '') => (c === '2A' ? 20.1 : c === '2B' ? 20.2 : Number(c) || 999)
const byCode = (a: ListItem, b: ListItem) => codeKey(a.code) - codeKey(b.code)

/**
 * Noms des départements, tenus à jour en continu : `departmentLabel` peut ainsi s'utiliser partout,
 * même hors d'un composant. Les écrans qui affichent des départements appellent `useDepartments()`
 * (directement ou via l'App) pour se redessiner quand la liste change.
 */
let departments: ListItem[] = []
const listeners = new Set<() => void>()
liveQuery(() => db.lists.where('kind').equals('department').toArray()).subscribe((rs) => {
  departments = alive(rs).filter((d) => d.code).sort(byCode)
  listeners.forEach((l) => l())
})

export function useDepartments(): ListItem[] {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return departments
}

/** « 83 · Var » ; « Département 83 » si son nom n'est pas dans la liste. */
export function departmentLabel(code: string) {
  const d = departments.find((x) => x.code === code)
  return d ? `${code} · ${d.name}` : `Département ${code}`
}

/** Départements proposés à la saisie : [{ value: '83', label: '83 · Var' }…]. */
export const departmentChoices = () => departments.map((d) => ({ value: d.code!, label: `${d.code} · ${d.name}` }))

// ---------- Région de chaque département ----------

/**
 * Découpage officiel (INSEE, régions de 2016), avec les identifiants de la liste des régions
 * (supabase/019_listes_regions.sql). Référence quand un département de la liste n'a pas de région.
 * Corse : un seul département pour nous (« 20 », n° de club) ; outre-mer : « 97 ».
 */
const OFFICIAL_REGIONS: Record<string, string> = {
  'region-ara': '01 03 07 15 26 38 42 43 63 69 73 74',
  'region-bfc': '21 25 39 58 70 71 89 90',
  'region-bre': '22 29 35 56',
  'region-cvl': '18 28 36 37 41 45',
  'region-cor': '20 2A 2B',
  'region-ges': '08 10 51 52 54 55 57 67 68 88',
  'region-hdf': '02 59 60 62 80',
  'region-idf': '75 77 78 91 92 93 94 95',
  'region-nor': '14 27 50 61 76',
  'region-naq': '16 17 19 23 24 33 40 47 64 79 86 87',
  'region-occ': '09 11 12 30 31 32 34 46 48 65 66 81 82',
  'region-pdl': '44 49 53 72 85',
  'region-sud': '04 05 06 13 83 84',
  'region-om': '97 971 972 973 974 976',
}
const DEPT_REGION = new Map(Object.entries(OFFICIAL_REGIONS).flatMap(([r, ds]) => ds.split(' ').map((d) => [d, r] as const)))

/** Noms de repli (liste des régions absente : mode essai, base pas encore synchronisée). */
const REGION_FALLBACK: Record<string, string> = {
  'region-ara': 'Auvergne-Rhône-Alpes',
  'region-bfc': 'Bourgogne-Franche-Comté',
  'region-bre': 'Bretagne',
  'region-cvl': 'Centre-Val de Loire',
  'region-cor': 'Corse',
  'region-ges': 'Grand Est',
  'region-hdf': 'Hauts-de-France',
  'region-idf': 'Île-de-France',
  'region-nor': 'Normandie',
  'region-naq': 'Nouvelle-Aquitaine',
  'region-occ': 'Occitanie',
  'region-pdl': 'Pays de la Loire',
  'region-sud': 'Région Sud',
  'region-om': 'Outre-mer',
}

/** Région d'un département : celle de la liste (Réglages) si elle est renseignée, sinon le découpage officiel. */
export function regionOfDept(code?: string): string | undefined {
  if (!code) return undefined
  // Table refaite seulement quand la liste des départements change (appelée pour chaque joueur).
  if (listRegionsOf !== departments) {
    listRegionsOf = departments
    listRegions = new Map(departments.filter((d) => d.regionId).map((d) => [d.code!, d.regionId!]))
  }
  return listRegions.get(code) ?? DEPT_REGION.get(code)
}
let listRegionsOf: ListItem[] | undefined
let listRegions = new Map<string, string>()

/** Départements (numéros) d'une région. */
export function deptsOfRegion(regionId: string): string[] {
  return [...new Set([...DEPT_REGION.keys(), ...departments.map((d) => d.code!)])].filter((c) => regionOfDept(c) === regionId)
}

/**
 * Tous les départements connus (liste des Réglages + découpage officiel), triés par numéro.
 * Du découpage officiel, seuls les numéros à deux chiffres : ceux que donnent les licences (Corse « 20 », outre-mer « 97 »).
 */
export function allDepts(): string[] {
  const codes = new Set([...[...DEPT_REGION.keys()].filter((c) => /^\d\d$/.test(c)), ...departments.map((d) => d.code!)])
  return [...codes].sort((a, b) => codeKey(a) - codeKey(b))
}

// Noms des régions de la liste, tenus à jour comme les départements (pour `regionLabel` hors composant).
let regionNames = new Map<string, string>()
liveQuery(() => db.lists.where('kind').equals('region').toArray()).subscribe((rs) => {
  regionNames = new Map(alive(rs).map((r) => [r.id, r.name]))
  listeners.forEach((l) => l())
})

/** Nom d'une région : celui de la liste, sinon le nom officiel. */
export function regionLabel(id: string) {
  return regionNames.get(id) ?? REGION_FALLBACK[id] ?? id
}

/** Nom d'une région, en redessinant le composant quand la liste change. */
export function useRegionLabel() {
  useDepartments()
  return regionLabel
}

/**
 * Résumé court d'une zone (numéros de départements) : régions complètes par leur nom, puis numéros
 * des départements seuls (« Île-de-France · 13, 83 ») ; au-delà de 4 éléments, « 3 régions, 2 départements ».
 */
export function zoneSummary(codes: string[] | undefined) {
  if (!codes?.length) return 'Toute la France'
  const sel = new Set(codes)
  const all = allDepts()
  const regions = [...new Set(all.map((c) => regionOfDept(c)).filter((r): r is string => !!r))]
  const full = regions.filter((r) => deptsOfRegion(r).filter((c) => all.includes(c)).every((c) => sel.has(c)))
  const inFull = new Set(full.flatMap((r) => deptsOfRegion(r)))
  const rank = new Map(all.map((c, i) => [c, i]))
  const loose = codes.filter((c) => !inFull.has(c)).sort((a, b) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999))
  if (!full.length && loose.length === 1) return departmentLabel(loose[0])
  if (full.length + loose.length <= 4) return [full.map(regionLabel).join(', '), loose.join(', ')].filter(Boolean).join(' · ')
  const n = (k: number, w: string) => `${k} ${w}${k > 1 ? 's' : ''}`
  return [full.length ? n(full.length, 'région') : '', loose.length ? n(loose.length, 'département') : ''].filter(Boolean).join(', ')
}
