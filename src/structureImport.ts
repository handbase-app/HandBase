/*
 * « Importer une structure (CSV) » (Réglages > Structure et sport, administrateurs) : ligues, comités et clubs lus dans un
 * fichier (ex. liste officielle de la fédération : code_ligue;ligue;departement;comite;numero_club;club;code_postal;ville;
 * latitude;longitude), rangés dans l'arbre des unités (src/structureTree.ts).
 *
 * Fichier pur (ni Dexie ni React) : lecture, correspondance des colonnes, APERÇU (ce qui sera créé, mis à jour, inchangé ;
 * anomalies), lignes à écrire, et préparation de « Annuler l'import ». L'écriture passe par le chemin normal de l'appli
 * (saveMany + synchro hb_upsert) : src/components/StructureImport.tsx.
 *
 * Idempotent : chaque unité importée porte une clé stable (champ `code`) : « ligue:<code_ligue> », « comite:<code_ligue>:<département> »,
 * « club:<numéro> » (sinon « club:<nom>|<code postal> »), « federation » pour la tête, « pole:<région>:<sexe>:<site> » pour les
 * Pôles Espoirs (case « Ajouter les Pôles Espoirs » : liste de src/poles.ts, chaque pôle rangé DIRECTEMENT sous la ligue de
 * sa région, retrouvée par ses départements dans le fichier, sinon par son nom). Réimporter le même fichier ne change
 * rien ; un nom changé met l'unité à jour, sans doublon. Les unités saisies à la main (pôles…) ne sont jamais touchées
 * (sauf un pôle portant exactement le nom d'un Pôle Espoirs de la liste : repris, comme une ligue) ;
 * une ligue, un comité ou un club déjà saisi à la main est repris (même nom de ligue, même département de comité, même nom
 * de club) plutôt que dédoublé.
 *
 * Aucune donnée réelle ici ni dans les tests : le fichier de la fédération reste sur l'ordinateur de l'administrateur.
 */
import { parseCsv } from './criteriaFormat'
import { POLE_SITES, type PoleSite } from './poles'
import { OFFICIAL_REGIONS, REGION_FALLBACK } from './regionsOfficial'
import { HANDBALL_LEVELS, type LevelRow, type UnitRow } from './structureTree'

// ---------- Lecture et correspondance des colonnes ----------

export const IMPORT_FIELDS = ['code_ligue', 'ligue', 'departement', 'comite', 'numero_club', 'club', 'code_postal', 'ville', 'latitude', 'longitude'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const FIELD_LABELS: Record<ImportField, string> = {
  code_ligue: 'Code de la ligue',
  ligue: 'Nom de la ligue',
  departement: 'Département',
  comite: 'Nom du comité',
  numero_club: 'Numéro du club',
  club: 'Nom du club',
  code_postal: 'Code postal',
  ville: 'Ville',
  latitude: 'Latitude',
  longitude: 'Longitude',
}

/** Colonne choisie pour chaque champ (index dans l'en-tête), ou absente. */
export type Mapping = Partial<Record<ImportField, number>>

export interface CsvTable {
  headers: string[]
  rows: string[][]
}

/** Lit le texte d'un CSV (séparateur « ; » ou « , » détecté, BOM toléré, lignes vides ignorées). */
export function readStructureCsv(text: string): CsvTable {
  const all = parseCsv(text).map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)).trim()))
  const rows = all.filter((r) => r.some((c) => c !== ''))
  const [headers = [], ...rest] = rows
  return { headers, rows: rest }
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const SYNONYMS: Record<ImportField, string[]> = {
  code_ligue: ['code_ligue', 'codeligue', 'num_ligue', 'numero_ligue', 'id_ligue', 'ligue_code', 'code_de_la_ligue'],
  ligue: ['ligue', 'nom_ligue', 'ligue_nom', 'libelle_ligue', 'nom_de_la_ligue', 'region'],
  departement: ['departement', 'dept', 'dep', 'code_departement', 'num_departement', 'numero_departement', 'code_dept'],
  comite: ['comite', 'nom_comite', 'comite_nom', 'libelle_comite', 'nom_du_comite', 'comite_departemental'],
  numero_club: ['numero_club', 'num_club', 'n_club', 'no_club', 'numero', 'numero_affiliation', 'affiliation', 'code_club', 'club_numero', 'numero_du_club', 'n_affiliation', 'no_affiliation'],
  club: ['club', 'nom_club', 'club_nom', 'libelle_club', 'nom_du_club', 'nom', 'structure'],
  code_postal: ['code_postal', 'cp', 'codepostal', 'postal'],
  ville: ['ville', 'commune', 'localite', 'city'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon', 'long'],
}

/** Correspondance proposée d'après les noms de colonnes (chaque colonne sert au plus une fois). */
export function guessMapping(headers: readonly string[]): Mapping {
  const h = headers.map(norm)
  const used = new Set<number>()
  const out: Mapping = {}
  for (const f of IMPORT_FIELDS) {
    for (const syn of SYNONYMS[f]) {
      const i = h.findIndex((x, j) => x === syn && !used.has(j))
      if (i >= 0) {
        out[f] = i
        used.add(i)
        break
      }
    }
  }
  return out
}

// ---------- Aperçu ----------

export type Kind = 'root' | 'ligue' | 'comite' | 'pole' | 'club'
export const KIND_LABELS: Record<Kind, [string, string]> = {
  root: ['fédération', 'fédérations'],
  ligue: ['ligue', 'ligues'],
  comite: ['comité', 'comités'],
  pole: ['pôle', 'pôles'],
  club: ['club', 'clubs'],
}

export interface ImportOptions {
  ligues: boolean
  comites: boolean
  clubs: boolean
  /** Ajouter les Pôles Espoirs (src/poles.ts), chacun sous la ligue de sa région. */
  poles: boolean
  /** Ranger les ligues (et les lignes sans ligue) sous une unité Fédération, créée si absente. */
  root: boolean
  rootName: string
}
export const DEFAULT_OPTIONS: ImportOptions = { ligues: true, comites: true, clubs: true, poles: true, root: true, rootName: 'Fédération française de handball' }

export type AnomalyType = 'sansLigue' | 'comiteSansNom' | 'sansDepartement' | 'clubSansNumero' | 'doublon' | 'nomDifferent' | 'ligneIgnoree' | 'cycle' | 'garde' | 'poleSansLigue' | 'comiteRange' | 'comiteOutreMer'
/** Libellés neutres : ce que l'import a fait de la ligne. */
export const ANOMALY_LABELS: Record<AnomalyType, string> = {
  sansLigue: 'Lignes sans ligue',
  comiteSansNom: 'Comités sans nom (nom proposé : territoire, sinon « Comité » + département)',
  sansDepartement: 'Clubs sans département reconnu (rangés sous leur ligue)',
  clubSansNumero: 'Clubs sans numéro (reconnus par leur nom et leur code postal)',
  doublon: 'Clubs en double (première ligne gardée)',
  nomDifferent: 'Noms différents pour une même ligue ou un même comité (premier nom gardé)',
  ligneIgnoree: 'Lignes sans nom de club (laissées de côté)',
  cycle: 'Rattachements laissés tels quels (une unité ne peut pas être rangée sous elle-même)',
  garde: 'Unités déjà rangées plus finement (sous un pôle…) : place gardée',
  comiteRange: 'Comités déjà saisis, absents du fichier : rangés sous la ligue de leur région (sinon la fédération)',
  comiteOutreMer: 'Comités d’un territoire ultramarin non précisé (« 97 ») : rangés sous la fédération',
  poleSansLigue: 'Pôles Espoirs dont la ligue n’est pas dans le fichier (rangés sous la fédération)',
}

export interface Anomaly {
  type: AnomalyType
  /** Ligne du fichier (1 = en-tête). */
  line?: number
  detail: string
}

export interface Write {
  kind: Kind
  /** Unité à enregistrer (complète : champs existants gardés). */
  row: UnitRow
  /** Version avant l'import (mise à jour) ; absente : création. */
  before?: UnitRow
}

export type Counts = Record<Kind, { create: number; update: number; same: number }>

export interface ImportPlan {
  counts: Counts
  anomalies: Anomaly[]
  /** Unités à écrire, dans l'ordre (tête, ligues, comités, clubs) : un parent est toujours écrit avant ses enfants. */
  writes: Write[]
  /** Niveaux à créer d'abord (Ligue, Comité, Club… absents des niveaux). */
  levelsToCreate: LevelRow[]
  /** Lignes de données lues. */
  lines: number
  /** Problème qui empêche l'import (colonne indispensable absente…), en clair. */
  blocker?: string
}

const fold = (s: string) => norm(s).replace(/_/g, ' ')

/** Département : « 1 » → « 01 » (zéro perdu par un tableur), « 2a » → « 2A ». Vide si non reconnu (ou « 00 »). */
export function cleanDept(raw: string): string {
  let d = raw.trim().toUpperCase()
  if (/^\d$/.test(d)) d = '0' + d
  if (d === '00' || d === '000') return ''
  return /^(\d{2,3}|2[AB])$/.test(d) ? d : ''
}
/** Nom proposé pour un comité sans nom dans le fichier (collectivités d'outre-mer). */
const COMITE_NAMES: Record<string, string> = { '986': 'Wallis-et-Futuna', '987': 'Polynésie française', '988': 'Nouvelle-Calédonie' }
const DEPT_REGION = new Map(Object.entries(OFFICIAL_REGIONS).flatMap(([r, ds]) => ds.split(' ').map((d) => [d, r] as const)))
const cleanPostal = (raw: string) => (/^\d{4}$/.test(raw.trim()) ? '0' + raw.trim() : raw.trim())
const num = (raw: string) => {
  const v = parseFloat(raw.replace(',', '.'))
  return raw.trim() && Number.isFinite(v) ? v : undefined
}
const cut = (s: string, n = 100) => (s.length > n ? s.slice(0, n).trim() : s)

/** Niveau d'un type d'unité, reconnu à son nom (Fédération, Ligue, Comité, Club). */
const LEVEL_PREFIX: Record<Kind, string> = { root: 'federation', ligue: 'ligue', comite: 'comite', pole: 'pole', club: 'club' }
const HANDBALL_ID: Record<Kind, string> = { root: 'niveau-federation', ligue: 'niveau-ligue', comite: 'niveau-comite', pole: 'niveau-pole', club: 'niveau-club' }

/** Champs comparés pour décider « mise à jour » ou « inchangé ». */
const COMPARED: (keyof UnitRow)[] = ['name', 'levelId', 'parentId', 'code', 'departments', 'clubNumber', 'postalCode', 'city', 'lat', 'lng', 'poleSex', 'poleSite', 'poleLevels']
const same = (a: UnitRow, b: UnitRow) => COMPARED.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null))

// ---------- Pôles Espoirs ----------

const slug = (s: string) => fold(s).replace(/ /g, '-')
/** Clé stable d'un pôle : « pole:region-sud:M:saint-raphael ». */
export const poleCode = (p: PoleSite) => `pole:${p.regions[0]}:${p.sex}:${slug(p.site)}`
/** « Pôle Saint-Raphaël (garçons) », « Pôle Aix-en-Provence – Luynes (filles) ». */
export function poleName(p: PoleSite) {
  const site = p.site.replace(/\s*\(([^)]+)\)\s*$/, ' – $1')
  return `Pôle ${site} (${p.sex === 'M' ? 'garçons' : 'filles'})`
}

export function planImport(input: {
  table: CsvTable
  mapping: Mapping
  units: readonly UnitRow[]
  levels: readonly LevelRow[]
  options: ImportOptions
  newId: () => string
}): ImportPlan {
  const { table, mapping, options } = input
  const zero = () => ({ create: 0, update: 0, same: 0 })
  const counts: Counts = { root: zero(), ligue: zero(), comite: zero(), pole: zero(), club: zero() }
  const anomalies: Anomaly[] = []
  const empty: ImportPlan = { counts, anomalies, writes: [], levelsToCreate: [], lines: table.rows.length }
  if (mapping.club === undefined && options.clubs) return { ...empty, blocker: 'Choisis la colonne « Nom du club » (ou décoche les clubs).' }
  if (mapping.ligue === undefined && mapping.code_ligue === undefined && options.ligues) return { ...empty, blocker: 'Choisis la colonne « Nom de la ligue » ou « Code de la ligue » (ou décoche les ligues).' }
  if (mapping.departement === undefined && options.comites) return { ...empty, blocker: 'Choisis la colonne « Département » (ou décoche les comités).' }
  if (!options.ligues && !options.comites && !options.clubs && !options.poles) return { ...empty, blocker: 'Coche au moins les ligues, les comités, les pôles ou les clubs.' }

  // Niveaux : ceux de l'installation, reconnus à leur nom ; absents : créés (niveaux du handball).
  const live = input.levels.filter((l) => !l.deleted)
  const levelsToCreate: LevelRow[] = []
  const levelId = {} as Record<Kind, string>
  const maxOrder = Math.max(0, ...live.map((l) => l.order))
  const needed: Kind[] = [...(options.root ? (['root'] as Kind[]) : []), 'ligue', 'comite', ...(options.poles ? (['pole'] as Kind[]) : []), 'club']
  for (const k of needed) {
    const found = live.find((l) => fold(l.name).startsWith(LEVEL_PREFIX[k]))
    if (found) levelId[k] = found.id
    else {
      const def = HANDBALL_LEVELS.find((l) => l.id === HANDBALL_ID[k])!
      const lv = { id: live.some((l) => l.id === def.id) ? input.newId() : def.id, name: def.name, order: maxOrder + levelsToCreate.length + 1 }
      levelsToCreate.push(lv)
      levelId[k] = lv.id
    }
  }

  const units = input.units.filter((u) => !u.deleted)
  const byId = new Map(units.map((u) => [u.id, u]))
  const byCode = new Map<string, UnitRow>()
  for (const u of units) if (u.code && !byCode.has(u.code)) byCode.set(u.code, u)
  const adopted = new Set<string>()
  /** Unité existante saisie à la main, reprise (une seule candidate, pas encore reprise). */
  const adopt = (pred: (u: UnitRow) => boolean) => {
    const c = units.filter((u) => !u.code && !adopted.has(u.id) && pred(u))
    return c.length === 1 ? c[0] : undefined
  }

  const get = (r: string[], f: ImportField) => (mapping[f] === undefined ? '' : (r[mapping[f]!] ?? '').trim())

  // Planned : clé → unité finale (existante modifiée ou nouvelle).
  const planned = new Map<string, Write>()
  const order: string[] = []
  const plan = (kind: Kind, key: string, fields: Omit<UnitRow, 'id' | 'levelId'>, find: () => UnitRow | undefined) => {
    const existing = byCode.get(key) ?? find()
    if (existing && !existing.code) adopted.add(existing.id)
    const row: UnitRow = existing ? { ...existing, ...fields, levelId: existing.levelId, code: key } : { id: input.newId(), ...fields, levelId: levelId[kind], code: key }
    for (const k of Object.keys(row) as (keyof UnitRow)[]) if (row[k] === undefined) delete row[k]
    const w: Write = { kind, row, ...(existing ? { before: existing } : {}) }
    planned.set(key, w)
    order.push(key)
    return w
  }

  // Tête : unité « Fédération ».
  let rootId: string | undefined
  if (options.root) {
    const existing = byCode.get('federation') ?? adopt((u) => u.levelId === levelId.root && !u.parentId)
    if (existing) {
      rootId = existing.id
      if (!existing.code) plan('root', 'federation', { name: existing.name }, () => existing)
      else counts.root.same++
    } else rootId = plan('root', 'federation', { name: cut(options.rootName.trim() || DEFAULT_OPTIONS.rootName) }, () => undefined).row.id
  }

  /** Parent pour une ligne sans ligue (ou une ligue) : la Fédération si demandée, sinon aucun (en tête, à ranger). */
  const top = rootId

  const ligueKey = (r: string[]) => {
    const code = get(r, 'code_ligue')
    const name = get(r, 'ligue')
    return code ? `ligue:${code}` : name ? `ligue:nom:${fold(name)}` : ''
  }
  const ligueNames = new Map<string, string>()
  const comiteNames = new Map<string, string>()
  const clubKeys = new Set<string>()

  // Unité (existante ou prévue) d'une clé : pour les rattachements.
  const unitOf = (key: string) => planned.get(key)?.row ?? byCode.get(key)

  // 1) Ligues.
  table.rows.forEach((r, i) => {
    const key = ligueKey(r)
    const line = i + 2
    if (!key) {
      anomalies.push({ type: 'sansLigue', line, detail: `${get(r, 'club') || get(r, 'comite') || '(ligne vide)'} : ${top ? 'rangée sous la fédération' : 'laissée en tête, à ranger'}` })
      return
    }
    const name = cut(get(r, 'ligue') || `Ligue ${get(r, 'code_ligue')}`)
    const prev = ligueNames.get(key)
    if (prev !== undefined) {
      if (fold(prev) !== fold(name)) anomalies.push({ type: 'nomDifferent', line, detail: `${prev} / ${name}` })
      return
    }
    ligueNames.set(key, name)
    if (!options.ligues) return
    plan('ligue', key, { name, parentId: top }, () => adopt((u) => u.levelId === levelId.ligue && fold(u.name) === fold(name)))
  })

  // 2) Comités.
  const comiteKey = (r: string[]) => {
    const d = cleanDept(get(r, 'departement'))
    return d ? `comite:${get(r, 'code_ligue') || ligueKey(r).replace(/^ligue:/, '')}:${d}` : ''
  }
  table.rows.forEach((r, i) => {
    const line = i + 2
    const d = cleanDept(get(r, 'departement'))
    if (!d) return
    const key = comiteKey(r)
    const raw = get(r, 'comite')
    const name = cut(raw || COMITE_NAMES[d] || `Comité ${d}`)
    const prev = comiteNames.get(key)
    if (prev !== undefined) {
      if (raw && fold(prev) !== fold(name)) anomalies.push({ type: 'nomDifferent', line, detail: `${prev} / ${name}` })
      return
    }
    comiteNames.set(key, name)
    if (!raw) anomalies.push({ type: 'comiteSansNom', line, detail: `Département ${d} : « ${name} »` })
    if (!options.comites) return
    const ligue = ligueKey(r)
    const parentId = (ligue && unitOf(ligue)?.id) || top
    plan('comite', key, { name, parentId, departments: [d] }, () =>
      adopt((u) => u.levelId === levelId.comite && u.departments?.length === 1 && u.departments[0] === d),
    )
  })

  // 3) Clubs.
  if (options.clubs)
    table.rows.forEach((r, i) => {
      const line = i + 2
      const name = cut(get(r, 'club'))
      if (!name) {
        anomalies.push({ type: 'ligneIgnoree', line, detail: [get(r, 'ligue'), get(r, 'comite'), get(r, 'numero_club')].filter(Boolean).join(' · ') || '(ligne vide)' })
        return
      }
      const number = get(r, 'numero_club').replace(/\s+/g, '')
      const postal = cleanPostal(get(r, 'code_postal'))
      const key = number ? `club:${number}` : `club:${fold(name)}|${postal}`
      if (clubKeys.has(key)) {
        anomalies.push({ type: 'doublon', line, detail: `${name}${number ? ` (${number})` : ''}` })
        return
      }
      clubKeys.add(key)
      if (!number) anomalies.push({ type: 'clubSansNumero', line, detail: `${name}${postal ? ` (${postal})` : ''}` })
      const comite = comiteKey(r)
      const ligue = ligueKey(r)
      if (!comite && ligue) anomalies.push({ type: 'sansDepartement', line, detail: name })
      const parentId = (comite && unitOf(comite)?.id) || (ligue && unitOf(ligue)?.id) || top
      const fields: Omit<UnitRow, 'id' | 'levelId'> = {
        name,
        parentId,
        ...(number ? { clubNumber: number } : {}),
        ...(postal ? { postalCode: postal } : {}),
        ...(get(r, 'ville') ? { city: cut(get(r, 'ville')) } : {}),
        ...(num(get(r, 'latitude')) !== undefined ? { lat: num(get(r, 'latitude')) } : {}),
        ...(num(get(r, 'longitude')) !== undefined ? { lng: num(get(r, 'longitude')) } : {}),
      }
      plan('club', key, fields, () => adopt((u) => u.levelId === levelId.club && fold(u.name) === fold(name)))
    })

  // Ligue d'une région (src/regionsOfficial.ts) : celle du fichier qui compte le plus de lignes pour le premier département
  // connu de la région (Corse : 2A/2B), sinon une ligue du même nom (fichier ou déjà saisie) ; introuvable : rien.
  const deptLigues = new Map<string, Map<string, number>>()
  for (const r of table.rows) {
    const d = cleanDept(get(r, 'departement'))
    const key = ligueKey(r)
    if (!d || !key) continue
    const m = deptLigues.get(d) ?? new Map<string, number>()
    m.set(key, (m.get(key) ?? 0) + 1)
    deptLigues.set(d, m)
  }
  const ligueOfRegion = new Map<string, UnitRow | undefined>()
  const findLigue = (region: string): UnitRow | undefined => {
    if (ligueOfRegion.has(region)) return ligueOfRegion.get(region)
    let found: UnitRow | undefined
    for (const d of (OFFICIAL_REGIONS[region] ?? '').split(' ').filter(Boolean)) {
      const m = deptLigues.get(d)
      if (!m) continue
      found = unitOf([...m.entries()].sort((a, b) => b[1] - a[1])[0][0])
      if (found) break
    }
    const name = fold(REGION_FALLBACK[region] ?? '')
    if (!found && name) {
      const hit = [...ligueNames.entries()].find(([, n]) => fold(n).includes(name))
      found = (hit && unitOf(hit[0])) || units.find((u) => u.levelId === levelId.ligue && fold(u.name).includes(name))
    }
    ligueOfRegion.set(region, found)
    return found
  }

  // 4) Comités saisis avant l'import (« Pré-remplir les comités »…), en tête de l'arbre, dont le département n'est pas dans le
  // fichier (« 20 » quand le fichier a 2A/2B, « 97 » ultramarin non précisé) : rangés sous la ligue de leur région, sinon sous
  // la fédération ; signalés. Rien n'est supprimé, la clé reste vide (unité saisie à la main) ; l'annulation remet le parent d'avant.
  if (options.comites) {
    const plannedIds = new Set([...planned.values()].map((w) => w.row.id))
    const fileDepts = new Set(table.rows.map((r) => cleanDept(get(r, 'departement'))).filter(Boolean))
    for (const u of units) {
      if (u.code || u.levelId !== levelId.comite || plannedIds.has(u.id) || (u.parentId && byId.has(u.parentId))) continue
      const depts = u.departments ?? []
      if (!depts.length || depts.some((d) => fileDepts.has(d))) continue
      const d = depts[0]
      const outreMer = d === '97'
      const ligue = outreMer ? undefined : findLigue(DEPT_REGION.get(d) ?? '')
      const parentId = ligue?.id ?? top
      anomalies.push({
        type: outreMer ? 'comiteOutreMer' : 'comiteRange',
        detail: `${u.name} : ${ligue ? `rangé sous ${ligue.name}` : parentId ? 'rangé sous la fédération' : 'laissé en tête, à ranger'}`,
      })
      if (!parentId) continue
      const key = `rangement:${u.id}`
      planned.set(key, { kind: 'comite', row: { ...u, parentId }, before: u })
      order.push(key)
    }
  }

  // 5) Pôles Espoirs : sous la ligue de leur région (première de la liste : Corse → Région Sud, Antilles-Guyane → Antilles,
  // Réunion-Mayotte → Réunion) ; ligue introuvable : sous la fédération, signalé.
  if (options.poles) {
    for (const p of POLE_SITES) {
      const region = p.regions[0]
      const ligue = findLigue(region)
      const name = poleName(p)
      if (!ligue) anomalies.push({ type: 'poleSansLigue', detail: `${name} (${REGION_FALLBACK[region] ?? region}) : ${top ? 'rangé sous la fédération' : 'laissé en tête, à ranger'}` })
      plan('pole', poleCode(p), { name, parentId: ligue?.id ?? top, poleSex: p.sex, poleSite: p.site, ...(p.levels.length ? { poleLevels: [...p.levels] } : {}) }, () =>
        adopt((u) => u.levelId === levelId.pole && fold(u.name) === fold(name)),
      )
    }
  }

  // Rattachements : une unité existante déjà rangée plus finement (sous un pôle du bon comité…) garde sa place ; une unité
  // sans parent prévu garde le sien ; jamais de cycle (même règle que le serveur).
  const parentOf = new Map<string, string | undefined>(units.map((u) => [u.id, u.parentId]))
  for (const w of planned.values()) parentOf.set(w.row.id, w.row.parentId)
  const isUnder = (id: string | undefined, target: string) => {
    const seen = new Set<string>()
    let cur = id
    while (cur && !seen.has(cur)) {
      if (cur === target) return true
      seen.add(cur)
      cur = parentOf.get(cur)
    }
    return false
  }
  for (const w of planned.values()) {
    const b = w.before
    if (!b || b.parentId === w.row.parentId || !b.parentId || !byId.has(b.parentId)) continue
    if (!w.row.parentId || isUnder(b.parentId, w.row.parentId)) {
      if (w.row.parentId) anomalies.push({ type: 'garde', detail: w.row.name })
      w.row.parentId = b.parentId
      parentOf.set(w.row.id, b.parentId)
    }
  }
  for (const w of planned.values()) {
    const start = w.row.parentId
    let cur = start
    const seen = new Set<string>()
    let bad = false
    while (cur) {
      if (cur === w.row.id || seen.has(cur)) {
        bad = true
        break
      }
      seen.add(cur)
      cur = parentOf.get(cur)
    }
    if (bad) {
      anomalies.push({ type: 'cycle', detail: w.row.name })
      const back = w.before?.parentId
      if (back) w.row.parentId = back
      else delete w.row.parentId
      parentOf.set(w.row.id, w.row.parentId)
    }
  }

  const rank: Record<Kind, number> = { root: 0, ligue: 1, comite: 2, pole: 3, club: 4 }
  const writes: Write[] = []
  for (const w of order.map((k) => planned.get(k)!).sort((a, b) => rank[a.kind] - rank[b.kind])) {
    if (!w.row.parentId) delete w.row.parentId
    if (w.before && same(w.before, w.row)) counts[w.kind].same++
    else {
      counts[w.kind][w.before ? 'update' : 'create']++
      writes.push(w)
    }
  }
  // Niveaux à créer : seulement s'ils servent.
  const usedLevels = new Set(writes.map((w) => w.row.levelId))
  return { counts, anomalies, writes, levelsToCreate: levelsToCreate.filter((l) => usedLevels.has(l.id)), lines: table.rows.length }
}

/** Anomalies regroupées par type, dans l'ordre d'affichage. */
export function groupAnomalies(list: readonly Anomaly[]): { type: AnomalyType; label: string; items: Anomaly[] }[] {
  return (Object.keys(ANOMALY_LABELS) as AnomalyType[])
    .map((type) => ({ type, label: ANOMALY_LABELS[type], items: list.filter((a) => a.type === type) }))
    .filter((g) => g.items.length)
}

// ---------- Annuler l'import ----------

/** Trace du dernier import, gardée sur l'appareil : de quoi revenir en arrière. */
export interface ImportRecord {
  at: number
  file: string
  items: { id: string; kind: Kind; before?: UnitRow; after: number }[]
}

export interface UndoPlan {
  ok: boolean
  /** Raison en clair si impossible. */
  reason?: string
  /** Unités remises dans leur version d'avant l'import. */
  restore: UnitRow[]
  /** Unités créées par l'import, à retirer (sous-unités d'abord). */
  remove: UnitRow[]
}

/**
 * Peut-on annuler le dernier import ? Seulement si rien n'a changé depuis : chaque unité écrite est encore dans la version
 * laissée par l'import, aucune unité créée n'a reçu d'affectation ni de sous-unité ajoutée à la main.
 */
export function planUndo(record: ImportRecord, units: readonly (UnitRow & { updatedAt?: number })[], assignments: readonly { unitId: string; deleted?: boolean }[]): UndoPlan {
  const byId = new Map(units.map((u) => [u.id, u]))
  const created = new Set(record.items.filter((i) => !i.before).map((i) => i.id))
  const touched = new Set(record.items.map((i) => i.id))
  const changed = record.items.filter((i) => {
    const u = byId.get(i.id)
    return !u || u.deleted || u.updatedAt !== i.after
  })
  const fail = (reason: string): UndoPlan => ({ ok: false, reason, restore: [], remove: [] })
  if (changed.length)
    return fail(`${changed.length} unité${changed.length > 1 ? 's ont' : ' a'} changé depuis l’import (${changed.slice(0, 3).map((i) => byId.get(i.id)?.name ?? 'unité retirée').join(', ')}${changed.length > 3 ? '…' : ''}) : l’import ne peut plus être annulé d’un bloc.`)
  const extra = units.filter((u) => !u.deleted && !touched.has(u.id) && u.parentId && created.has(u.parentId))
  if (extra.length) return fail(`${extra.length} unité${extra.length > 1 ? 's ont été rangées' : ' a été rangée'} depuis sous une unité importée (${extra[0].name}…) : déplace-la${extra.length > 1 ? 's' : ''} d’abord.`)
  const people = assignments.filter((a) => !a.deleted && created.has(a.unitId))
  if (people.length) return fail(`${people.length} affectation${people.length > 1 ? 's' : ''} sur des unités importées : retire-les d’abord.`)
  const strip = (u: UnitRow & { updatedAt?: number }) => {
    const { updatedAt: _u, ...rest } = u
    return rest as UnitRow
  }
  const rank: Record<Kind, number> = { club: 0, pole: 1, comite: 2, ligue: 3, root: 4 }
  return {
    ok: true,
    restore: record.items.filter((i) => i.before).map((i) => strip(i.before as UnitRow & { updatedAt?: number })),
    remove: record.items
      .filter((i) => !i.before)
      .sort((a, b) => rank[a.kind] - rank[b.kind])
      .map((i) => ({ ...strip(byId.get(i.id)!), deleted: true })),
  }
}

// ---------- Recherche dans l'arbre ----------

/** « Trouver une unité » : nom, ville, code postal, numéro, département ; tous les mots doivent y être. */
export function findUnits<T extends UnitRow>(units: readonly T[], query: string, limit = 30): T[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out: T[] = []
  for (const u of units) {
    if (u.deleted) continue
    const hay = fold([u.name, u.city, u.postalCode, u.clubNumber, ...(u.departments ?? [])].filter(Boolean).join(' '))
    if (words.every((w) => hay.includes(w))) {
      out.push(u)
      if (out.length >= limit) break
    }
  }
  return out
}
