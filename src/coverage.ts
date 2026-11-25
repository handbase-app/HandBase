import type { Evaluation, Measurement, Player, Seen } from './db'

/*
 * Bilan de détection : qui a été vu, par génération (année de naissance) et par club ; et, pour les administrateurs,
 * les mêmes calculs pour les autres onglets de la carte (licenciés, mesurés par le staff, profils repérés : voir
 * « Onglets du bilan » plus bas). Calculs purs (sans base ni écran), testés par tools/test-bilan.ts sur des joueurs fictifs.
 * Un joueur est « vu » si au moins un membre du staff l'a vu : une marque « vu » (seen) ou un avis (evaluations).
 * Aucune note n'est nécessaire et il n'existe aucune marque négative : un joueur pas encore vu est simplement « à voir ».
 */

/** Période du bilan : la saison en cours (1er septembre → 31 août) ou depuis toujours. */
export type CoveragePeriod = 'season' | 'all'
export type CoverageSex = 'all' | 'M' | 'F'

/** Saison (1er septembre → 31 août) qui contient ce jour (AAAA-MM-JJ) : bornes et libellé « 2026-2027 ». */
export function seasonOf(day: string) {
  const y = Number(day.slice(0, 4))
  const m = Number(day.slice(5, 7))
  const start = m >= 9 ? y : y - 1
  return { from: `${start}-09-01`, to: `${start + 1}-08-31`, label: `${start}-${start + 1}` }
}

/** Jour local (AAAA-MM-JJ) d'une date seule ou d'un horodatage ISO. */
const dayOfAny = (s: string) => (s.length <= 10 ? s : new Date(Date.parse(s)).toLocaleDateString('sv'))

/** Un passage : ce joueur a été vu ce jour-là, par… (nom affichable, s'il est connu). */
export interface Sight {
  playerId: string
  day: string
  by?: string
}

/**
 * « Vu » et avis → passages. Ignorés : lignes supprimées, avis mis hors cadre (ils ne comptent jamais), « vu » sur un
 * événement supprimé. `nameOfSeen` donne le nom de l'observateur d'un « vu » (le serveur le signe ; en local : « toi »).
 */
export function toSights(
  seen: Pick<Seen, 'playerId' | 'eventId' | 'at' | 'createdAtServer' | 'updatedAt' | 'deleted'>[],
  evals: Pick<Evaluation, 'playerId' | 'date' | 'deleted' | 'review' | 'observer'>[],
  opts: { deadEvents?: Set<string>; nameOfSeen?: (s: (typeof seen)[number]) => string | undefined } = {},
): Sight[] {
  const out: Sight[] = []
  for (const s of seen) {
    if (s.deleted || opts.deadEvents?.has(s.eventId)) continue
    const when = s.at ?? s.createdAtServer
    out.push({ playerId: s.playerId, day: when ? dayOfAny(when) : new Date(s.updatedAt).toLocaleDateString('sv'), by: opts.nameOfSeen?.(s) })
  }
  for (const e of evals) {
    if (e.deleted || e.review === 'refused') continue
    out.push({ playerId: e.playerId, day: dayOfAny(e.date), by: e.observer || undefined })
  }
  return out
}

/** Dernier passage de chaque joueur dans la période (bornes comprises ; sans borne : depuis toujours). */
export function lastSights(sights: Sight[], range?: { from: string; to: string }): Map<string, Sight> {
  const last = new Map<string, Sight>()
  for (const s of sights) {
    if (range && (s.day < range.from || s.day > range.to)) continue
    const cur = last.get(s.playerId)
    if (!cur || s.day > cur.day || (s.day === cur.day && !cur.by && s.by)) last.set(s.playerId, s)
  }
  return last
}

type CovPlayer = Pick<Player, 'id' | 'birthDate' | 'sex' | 'club' | 'deleted' | 'review' | 'mergedInto'>

/** Joueurs de la base, comme la page Joueurs : ni supprimés, ni fondus dans une autre fiche, ni mis hors cadre. */
export const livePlayers = <P extends CovPlayer>(ps: P[]) => ps.filter((p) => !p.deleted && !p.mergedInto && p.review !== 'refused')

/** Année de naissance (« 2011 ») ; '' si inconnue. */
export const birthYear = (p: Pick<Player, 'birthDate'>) => (/^\d{4}/.test(p.birthDate ?? '') ? p.birthDate!.slice(0, 4) : '')

/** Clé d'un club : sans accents, majuscules ni espaces en trop (même club écrit de deux façons) ; '' si non renseigné. */
export const clubKey = (club?: string) => {
  const raw = club ?? ''
  // Retenue par écriture (quelques milliers de clubs pour 40 000 joueurs : le calcul, lent sur un téléphone, n'est fait qu'une fois).
  let k = clubKeys.get(raw)
  if (k === undefined) {
    if (clubKeys.size >= 50000) clubKeys.clear()
    clubKeys.set(raw, (k = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()))
  }
  return k
}
const clubKeys = new Map<string, string>()

/** Pourcentage vu, arrondi vers le bas (100 % seulement quand tout le monde est vu). */
export const percent = (seen: number, total: number) => (total ? Math.floor((seen * 100) / total) : 0)

export interface Tally {
  seen: number
  total: number
}
const add = (t: Tally, isSeen: boolean) => {
  t.total++
  if (isSeen) t.seen++
}
const empty = (): Tally => ({ seen: 0, total: 0 })

export interface ClubCoverage<P> extends Tally {
  /** Clé du club ('' : club non renseigné). */
  key: string
  /** Nom affiché (le plus fréquent parmi les écritures du club) ; '' : non renseigné. */
  name: string
  toSee: P[]
  seenPlayers: P[]
}

export interface YearCoverage<P> extends Tally {
  /** Année de naissance ('' : inconnue). */
  year: string
  clubs: ClubCoverage<P>[]
}

/** Nom affiché d'un club : l'écriture la plus fréquente ; à égalité, celle qui a le plus de majuscules (« HBC », pas « hbc »). */
const caps = (s: string) => s.replace(/[^A-Z]/g, '').length
function clubName(names: Map<string, number>) {
  return [...names].sort((a, b) => b[1] - a[1] || caps(b[0]) - caps(a[0]) || a[0].localeCompare(b[0], 'fr'))[0]?.[0] ?? ''
}

/**
 * Couverture par club d'une liste de joueurs (déjà filtrés : `filterPlayers`) : du plus grand nombre de joueurs à voir
 * au plus petit (puis le plus de joueurs, puis le nom), « club non renseigné » à la fin.
 */
export function coverageByClub<P extends CovPlayer>(players: P[], seen: { has(id: string): boolean }): ClubCoverage<P>[] {
  const clubs = new Map<string, { t: Tally; names: Map<string, number>; toSee: P[]; seen: P[] }>()
  for (const p of players) {
    const k = clubKey(p.club)
    let c = clubs.get(k)
    if (!c) clubs.set(k, (c = { t: empty(), names: new Map(), toSee: [], seen: [] }))
    const isSeen = seen.has(p.id)
    add(c.t, isSeen)
    if (k) c.names.set(p.club!.trim(), (c.names.get(p.club!.trim()) ?? 0) + 1)
    ;(isSeen ? c.seen : c.toSee).push(p)
  }
  return [...clubs]
    .map(([key, c]) => ({ key, name: clubName(c.names), ...c.t, toSee: c.toSee, seenPlayers: c.seen }))
    .sort((a, b) => (!a.key ? 1 : !b.key ? -1 : b.total - b.seen - (a.total - a.seen) || b.total - a.total || a.name.localeCompare(b.name, 'fr')))
}

/**
 * Couverture par génération puis par club. Générations : de la plus récente à la plus ancienne, « année inconnue » à la
 * fin. Clubs : comme `coverageByClub`. `sex` : seulement les garçons ou les filles (un joueur sans sexe renseigné n'est
 * alors pas compté).
 */
export function coverageByYear<P extends CovPlayer>(players: P[], seen: { has(id: string): boolean }, sex: CoverageSex = 'all'): YearCoverage<P>[] {
  const years = new Map<string, P[]>()
  for (const p of livePlayers(players)) {
    if (sex !== 'all' && p.sex !== sex) continue
    const y = birthYear(p)
    const list = years.get(y)
    if (list) list.push(p)
    else years.set(y, [p])
  }
  return [...years]
    .sort((a, b) => (!a[0] ? 1 : !b[0] ? -1 : b[0].localeCompare(a[0])))
    .map(([year, ps]) => {
      const clubs = coverageByClub(ps, seen)
      return { year, ...totalOf(clubs), clubs }
    })
}

// ---------- Par lieu : régions et départements (carte du bilan) ----------

/** Département d'un joueur (numéro, « 83 ») et région d'un département : donnés par l'appelant (listes, n° de club…). */
export interface PlaceOf<P> {
  deptOf: (p: P) => string | undefined
  regionOf: (dept: string) => string | undefined
}

/** Choix « département non renseigné » : ses joueurs restent à voir comme les autres. */
export const NO_DEPT = '?'

/**
 * Filtres communs à la carte, aux générations et aux clubs. Année : `null` toutes, '' année inconnue ; `years` : une
 * ou plusieurs années (vide : toutes ; '' : année inconnue), à la place de `year`. Région et département : vides pour
 * toute la France ; `dept` peut valoir NO_DEPT (département non renseigné).
 */
export interface CoverageFilter {
  sex?: CoverageSex
  year?: string | null
  years?: readonly string[]
  region?: string
  dept?: string
}

/** Joueurs de la base (`livePlayers`) qui passent les filtres. */
export function filterPlayers<P extends CovPlayer>(players: P[], f: CoverageFilter, place?: PlaceOf<P>): P[] {
  const sex = f.sex ?? 'all'
  const year = f.year ?? null
  const years = f.years?.length ? new Set(f.years) : null
  return livePlayers(players).filter((p) => {
    if (sex !== 'all' && p.sex !== sex) return false
    if (year !== null && birthYear(p) !== year) return false
    if (years && !years.has(birthYear(p))) return false
    if (!place || (!f.dept && !f.region)) return true
    const d = place.deptOf(p)
    if (f.dept) return f.dept === NO_DEPT ? !d : d === f.dept
    return !!d && place.regionOf(d) === f.region
  })
}

export interface PlaceCoverage extends Tally {
  byDept: Map<string, Tally>
  byRegion: Map<string, Tally>
  /** Joueurs sans département. */
  noDept: Tally
}

/** Couverture par département et par région d'une liste de joueurs (déjà filtrés : `filterPlayers`). */
export function coverageByPlace<P extends CovPlayer>(players: P[], seen: { has(id: string): boolean }, place: PlaceOf<P>): PlaceCoverage {
  const out: PlaceCoverage = { ...empty(), byDept: new Map(), byRegion: new Map(), noDept: empty() }
  const tally = (m: Map<string, Tally>, k: string) => {
    let t = m.get(k)
    if (!t) m.set(k, (t = empty()))
    return t
  }
  for (const p of players) {
    const isSeen = seen.has(p.id)
    add(out, isSeen)
    const d = place.deptOf(p)
    if (!d) {
      add(out.noDept, isSeen)
      continue
    }
    add(tally(out.byDept, d), isSeen)
    const r = place.regionOf(d)
    if (r) add(tally(out.byRegion, r), isSeen)
  }
  return out
}

/** Lieux (régions ou départements) du plus grand nombre de joueurs à voir au plus petit, puis le plus de joueurs. */
export const byLeftToSee = <T extends Tally>(rows: Iterable<[string, T]>) =>
  [...rows].sort((a, b) => b[1].total - b[1].seen - (a[1].total - a[1].seen) || b[1].total - a[1].total || a[0].localeCompare(b[0]))

/** Totaux (vus, total) d'une liste de générations. */
export const totalOf = (ys: Tally[]): Tally => ys.reduce((t, y) => ({ seen: t.seen + y.seen, total: t.total + y.total }), empty())

// ---------- Rapport chiffré (sans aucun nom de joueur) ----------

export interface ReportRow {
  /** Garçons, filles, ensemble (sexe non renseigné compris). */
  M: Tally
  F: Tally
  all: Tally
}
export interface ReportClub extends ReportRow {
  name: string
}
export interface ReportYear extends ReportRow {
  year: string
  clubs: ReportClub[]
}

export interface ReportRegion extends ReportRow {
  /** Identifiant de la région ('' : inconnue) ; nom et ordre choisis à l'affichage. */
  region: string
}

const emptyRow =(): ReportRow => ({ M: empty(), F: empty(), all: empty() })
const addRow = (r: ReportRow, p: CovPlayer, isSeen: boolean) => {
  add(r.all, isSeen)
  if (p.sex === 'M' || p.sex === 'F') add(r[p.sex], isSeen)
}

/**
 * Rapport pour la fédération : seulement des nombres, par génération, sexe et club, et les totaux. Aucun identifiant ni
 * nom de joueur n'en sort. Clubs par ordre alphabétique (« club non renseigné » à la fin). Avec `place` : aussi
 * par région.
 */
export function fedReport<P extends CovPlayer>(
  players: P[],
  seen: { has(id: string): boolean },
  place?: PlaceOf<P>,
): { years: ReportYear[]; total: ReportRow; regions: ReportRegion[] } {
  const total = emptyRow()
  // Par région, si l'appelant sait situer les joueurs ; '' : région inconnue (département absent ou hors découpage).
  const regions = new Map<string, ReportRow>()
  const years = new Map<string, { row: ReportRow; clubs: Map<string, { row: ReportRow; names: Map<string, number> }> }>()
  for (const p of livePlayers(players)) {
    const isSeen = seen.has(p.id)
    const y = birthYear(p)
    let yr = years.get(y)
    if (!yr) years.set(y, (yr = { row: emptyRow(), clubs: new Map() }))
    const k = clubKey(p.club)
    let c = yr.clubs.get(k)
    if (!c) yr.clubs.set(k, (c = { row: emptyRow(), names: new Map() }))
    if (k) c.names.set(p.club!.trim(), (c.names.get(p.club!.trim()) ?? 0) + 1)
    addRow(total, p, isSeen)
    addRow(yr.row, p, isSeen)
    addRow(c.row, p, isSeen)
    if (place) {
      const d = place.deptOf(p)
      const r = (d && place.regionOf(d)) || ''
      let row = regions.get(r)
      if (!row) regions.set(r, (row = emptyRow()))
      addRow(row, p, isSeen)
    }
  }
  return {
    total,
    regions: [...regions].map(([region, row]) => ({ region, ...row })),
    years: [...years]
      .sort((a, b) => (!a[0] ? 1 : !b[0] ? -1 : b[0].localeCompare(a[0])))
      .map(([year, yr]) => ({
        year,
        ...yr.row,
        clubs: [...yr.clubs]
          .map(([key, c]) => ({ key, name: clubName(c.names), ...c.row }))
          .sort((a, b) => (!a.key ? 1 : !b.key ? -1 : a.name.localeCompare(b.name, 'fr')))
          .map(({ key: _k, ...c }) => c),
      })),
  }
}

// ---------- Onglets du bilan : ce que mesure la carte ----------

/**
 * Onglets de la page /bilan (une seule carte) : joueurs vus (défaut), licenciés, mesurés par le staff, profils repérés.
 * Chaque onglet donne un ensemble de joueurs « comptés » (le `seen` des fonctions ci-dessus) ; les mêmes calculs (Tally :
 * comptés / total) servent partout. Vus et mesurés : une part (0 → 1) ; licenciés : le nombre de joueurs ; repérés : le
 * nombre de joueurs repérés.
 */
export type Onglet = 'vus' | 'licencies' | 'mesures' | 'reperes'
export const ONGLETS: readonly Onglet[] = ['vus', 'licencies', 'mesures', 'reperes']

/** Onglet mesuré en part (pourcentage) ; sinon en nombre de joueurs. */
export const isShare = (o: Onglet) => o === 'vus' || o === 'mesures'

/** Valeur d'une zone pour l'onglet (undefined : aucun joueur). */
export function measureOf(o: Onglet, t: Tally): number | undefined {
  if (!t.total) return undefined
  return o === 'licencies' ? t.total : o === 'reperes' ? t.seen : t.seen / t.total
}

/**
 * Classement des lieux pour l'onglet : vus et mesurés, du plus grand nombre de joueurs restant à voir (à mesurer) au
 * plus petit (`byLeftToSee`) ; licenciés et repérés, de la plus grande valeur à la plus petite, puis le plus de joueurs.
 */
export function rankBy<T extends Tally>(o: Onglet, rows: Iterable<[string, T]>): [string, T][] {
  if (isShare(o)) return byLeftToSee(rows)
  return [...rows].sort((a, b) => (measureOf(o, b[1]) ?? 0) - (measureOf(o, a[1]) ?? 0) || b[1].total - a[1].total || a[0].localeCompare(b[0]))
}

/** Clubs dans l'ordre de l'onglet (comme `rankBy`), « club non renseigné » à la fin. */
export function sortClubs<C extends Tally & { key: string; name: string }>(o: Onglet, clubs: C[]): C[] {
  if (isShare(o)) return clubs
  return [...clubs].sort((a, b) =>
    !a.key ? 1 : !b.key ? -1 : (measureOf(o, b) ?? 0) - (measureOf(o, a) ?? 0) || b.total - a.total || a.name.localeCompare(b.name, 'fr'),
  )
}

/** Auteur des tailles reprises de l'export des licences (src/importLicences.ts) : pas une mesure du staff. */
export const DECLARED = 'Licence FFHB (déclarée)'

type Meas = Pick<Measurement, 'playerId' | 'criterionId' | 'value' | 'date' | 'updatedAt' | 'author' | 'deleted'>

/** Joueurs mesurés par le staff (au moins une mesure, hors tailles déclarées à la licence) et dernière taille connue. */
export function staffMeasured(measurements: Meas[]): { staff: Set<string>; height: Map<string, number> } {
  const staff = new Set<string>()
  const last = new Map<string, Meas>()
  for (const m of measurements) {
    if (m.deleted) continue
    if (m.author !== DECLARED) staff.add(m.playerId)
    if (m.criterionId === 'taille' && typeof m.value === 'number') {
      const cur = last.get(m.playerId)
      if (!cur || m.date > cur.date || (m.date === cur.date && m.updatedAt > cur.updatedAt)) last.set(m.playerId, m)
    }
  }
  return { staff, height: new Map([...last].map(([id, m]) => [id, m.value as number])) }
}

/**
 * Profils repérés quand aucun profil recherché n'est utilisable : joueurs dont la dernière taille atteint le 90e centile
 * de leur année de naissance et de leur sexe (groupes d'au moins 10 joueurs mesurés).
 */
export function tallest(players: Pick<Player, 'id' | 'birthDate' | 'sex'>[], height: Map<string, number>): Set<string> {
  const groups = new Map<string, number[]>()
  for (const p of players) {
    const h = height.get(p.id)
    if (h === undefined || !p.birthDate || !p.sex) continue
    const k = `${p.birthDate.slice(0, 4)}|${p.sex}`
    const g = groups.get(k)
    if (g) g.push(h)
    else groups.set(k, [h])
  }
  const p90 = new Map<string, number>()
  for (const [k, hs] of groups) {
    if (hs.length < 10) continue
    hs.sort((a, b) => a - b)
    p90.set(k, hs[Math.floor(0.9 * (hs.length - 1))])
  }
  const out = new Set<string>()
  for (const p of players) {
    const t = p90.get(`${p.birthDate?.slice(0, 4)}|${p.sex}`)
    const h = height.get(p.id)
    if (t !== undefined && h !== undefined && h >= t) out.add(p.id)
  }
  return out
}
