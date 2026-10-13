import type { Evaluation, Player, Seen } from './db'

/*
 * Bilan de détection : qui a été vu, par génération (année de naissance) et par club. Calculs purs (sans base ni
 * écran), testés par tools/test-bilan.ts sur des joueurs fictifs.
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
export const clubKey = (club?: string) =>
  (club ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

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
 * Couverture par génération puis par club. Générations : de la plus récente à la plus ancienne, « année inconnue » à la
 * fin. Clubs : du plus grand nombre de joueurs à voir au plus petit (puis le plus de joueurs, puis le nom), « club non
 * renseigné » à la fin. `sex` : seulement les garçons ou les filles (un joueur sans sexe renseigné n'est alors pas compté).
 */
export function coverageByYear<P extends CovPlayer>(players: P[], seen: { has(id: string): boolean }, sex: CoverageSex = 'all'): YearCoverage<P>[] {
  const years = new Map<string, { t: Tally; clubs: Map<string, { t: Tally; names: Map<string, number>; toSee: P[]; seen: P[] }> }>()
  for (const p of livePlayers(players)) {
    if (sex !== 'all' && p.sex !== sex) continue
    const y = birthYear(p)
    let yr = years.get(y)
    if (!yr) years.set(y, (yr = { t: empty(), clubs: new Map() }))
    const k = clubKey(p.club)
    let c = yr.clubs.get(k)
    if (!c) yr.clubs.set(k, (c = { t: empty(), names: new Map(), toSee: [], seen: [] }))
    const isSeen = seen.has(p.id)
    add(yr.t, isSeen)
    add(c.t, isSeen)
    if (k) c.names.set(p.club!.trim(), (c.names.get(p.club!.trim()) ?? 0) + 1)
    ;(isSeen ? c.seen : c.toSee).push(p)
  }
  return [...years]
    .sort((a, b) => (!a[0] ? 1 : !b[0] ? -1 : b[0].localeCompare(a[0])))
    .map(([year, yr]) => ({
      year,
      ...yr.t,
      clubs: [...yr.clubs]
        .map(([key, c]) => ({ key, name: clubName(c.names), ...c.t, toSee: c.toSee, seenPlayers: c.seen }))
        .sort((a, b) => (!a.key ? 1 : !b.key ? -1 : b.total - b.seen - (a.total - a.seen) || b.total - a.total || a.name.localeCompare(b.name, 'fr'))),
    }))
}

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

const emptyRow = (): ReportRow => ({ M: empty(), F: empty(), all: empty() })
const addRow = (r: ReportRow, p: CovPlayer, isSeen: boolean) => {
  add(r.all, isSeen)
  if (p.sex === 'M' || p.sex === 'F') add(r[p.sex], isSeen)
}

/**
 * Rapport pour la fédération : seulement des nombres, par génération, sexe et club, et les totaux. Aucun identifiant ni
 * nom de joueur n'en sort. Clubs par ordre alphabétique (« club non renseigné » à la fin).
 */
export function fedReport(players: CovPlayer[], seen: { has(id: string): boolean }): { years: ReportYear[]; total: ReportRow } {
  const total = emptyRow()
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
  }
  return {
    total,
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
