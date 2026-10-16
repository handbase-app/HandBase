import type { Place } from './bilanNav'
import type { Tally } from './coverage'
import {
  hasConditions,
  outValueFn,
  periodRange,
  seenCount,
  topWithTies,
  type Answer,
  type Output,
  type Population,
  type QIndex,
  type QPlayer,
  type Recipe,
} from './recipe'

/*
 * Question posée au bilan de détection dont la réponse est géographique (« dans quel club du Var il y a le plus de
 * joueurs ») : elle reste sur le bilan (src/pages/Coverage.tsx, ?q=<recette>), avec sa carte (départements ou points des
 * clubs) et ses listes, colorées et triées par la valeur de la question. Les autres réponses (listes de joueurs, tableaux
 * par génération, par poste, par personne du staff…) restent sur /bilan/question.
 *
 * Fichier pur (ni React ni base) : quelles recettes vont au bilan, lieu de départ, valeur de chaque joueur et totaux par
 * région, département et club. Testé par tools/test-bilan-question.ts.
 */

/** Valeur montrée : nombre de joueurs qui répondent, part de la population qui répond, part vue, moyenne d'avis, d'une mesure, âge moyen. */
export type QValueKind = 'count' | 'share' | 'seen' | 'avg' | 'measure' | 'age'

const GEO = new Set(['club', 'dept', 'region'])

/** Population limitée à un lieu (région, département ou club). */
export const hasPlace = (pop: Population) => !!(pop.regions?.length || pop.depts?.length || pop.clubs?.length)

/** Sortie que le bilan sait montrer : carte, nombre, tableau par club, département ou région. */
export const bilanOutput = (out: Output) => out.type === 'map' || out.type === 'count' || (out.type === 'table' && GEO.has(out.groupBy ?? 'club'))

/** La réponse va-t-elle au bilan ? Carte, tableau par lieu, ou nombre limité à un lieu. */
export const goesToBilan = (r: Recipe) => bilanOutput(r.out) && (r.out.type !== 'count' || hasPlace(r.pop))

const FRANCE: Place = { region: '', dept: '', club: null }

/**
 * Lieu de départ du bilan et recette sans ce lieu (le bilan le porte : on peut ensuite changer de lieu en gardant la
 * question). Un club → son département, club choisi ; un département → lui ; plusieurs départements d'une même région ou
 * une région → la région ; sinon la France. Ce qui ne devient pas le lieu reste dans la population (plusieurs clubs ou
 * départements : seuls eux sont comptés).
 */
export function splitPlace(r: Recipe, regionOf: (dept: string) => string | undefined, clubDept: (club: string) => string | undefined): { recipe: Recipe; place: Place } {
  const { regions = [], depts = [], clubs = [], ...rest } = r.pop
  const keep = (pop: Partial<Population>): Recipe => ({ ...r, pop: { ...rest, ...pop } })
  // Un seul club, dont le département est connu (et dans la population) : le bilan s'ouvre sur lui.
  if (clubs.length === 1) {
    const d = clubDept(clubs[0])
    const rg = d ? regionOf(d) : undefined
    if (d && (!depts.length || depts.includes(d)) && (!regions.length || (!!rg && regions.includes(rg))))
      return { recipe: keep({}), place: { region: rg ?? '', dept: d, club: clubs[0] } }
  }
  const others = clubs.length ? { clubs } : {}
  const ds = depts.length ? depts : clubs.map(clubDept).filter((d): d is string => !!d)
  const uniq = [...new Set(ds)]
  if (uniq.length === 1) {
    const d = uniq[0]
    const rg = regionOf(d)
    if (!regions.length || (!!rg && regions.includes(rg))) return { recipe: keep(others), place: { region: rg ?? '', dept: d, club: null } }
  }
  if (uniq.length > 1) {
    const rs = [...new Set(uniq.map(regionOf))]
    const rg = rs.length === 1 ? rs[0] : undefined
    const pop = { ...others, ...(depts.length ? { depts } : {}) }
    if (rg && (!regions.length || regions.includes(rg))) return { recipe: keep(pop), place: { region: rg, dept: '', club: null } }
    return { recipe: keep({ ...pop, ...(regions.length ? { regions } : {}) }), place: FRANCE }
  }
  if (regions.length === 1) return { recipe: keep(others), place: { region: regions[0], dept: '', club: null } }
  return { recipe: keep({ ...others, ...(regions.length ? { regions } : {}) }), place: FRANCE }
}

/** Recette avec le lieu du bilan (« Ouvrir en détail », « Enregistrer cette question »). */
export function recipeAt(r: Recipe, p: Place): Recipe {
  const pop = { ...r.pop }
  if (p.club !== null && p.club) pop.clubs = [p.club]
  if (p.dept) pop.depts = [p.dept]
  else if (p.region) pop.regions = [p.region]
  return { ...r, pop }
}

/** Valeur montrée par le bilan pour cette recette. */
export function valueKind(r: Recipe): QValueKind {
  const v = r.out.value
  if (v === 'avg' || v === 'age' || (v === 'measure' && r.out.measure)) return v
  if (v === 'seen') return 'seen'
  if (r.out.sort?.by === 'share') return 'share'
  if (r.out.type === 'map' && hasConditions(r)) return 'share'
  return 'count'
}

/** Valeur en part (0 → 1) : échelle en pourcentages. */
export const isShareKind = (k: QValueKind) => k === 'share' || k === 'seen'

/**
 * Totaux d'une zone : `total` joueurs de la population, `seen` ceux qui répondent (comme Tally : mêmes barres et
 * couleurs que le bilan) ; `vus` : ceux qui répondent vus dans la période (part vue) ; `sum` / `n` : valeur des joueurs
 * qui répondent et en ont une (moyenne).
 */
export type QAgg = Tally & { vus: number; sum: number; n: number }
export const emptyAgg = (): QAgg => ({ seen: 0, total: 0, vus: 0, sum: 0, n: 0 })

/** Un joueur de la population, avec son lieu, s'il répond, et sa valeur. */
export type QPoint<P> = { p: P; dept?: string; region?: string; club: string; match: boolean; value?: number | null; vu?: boolean }

/** Joueurs de la population de la réponse, avec ce que le bilan en montre. */
export function questionPoints<P extends QPlayer>(ix: QIndex<P>, r: Recipe, ans: Answer<P>): QPoint<P>[] {
  const kind = valueKind(r)
  const f = outValueFn(ix, r)
  const range = periodRange(r.out.period ?? r.seen?.period ?? { kind: 'season' }, ix.data.today)
  return ans.pop.map((p) => {
    const i = ix.info.get(p.id)!
    const match = ans.matchIds.has(p.id)
    return {
      p,
      dept: i.dept,
      region: i.region,
      club: i.club,
      match,
      ...(match && f ? { value: f(p) } : {}),
      ...(match && kind === 'seen' ? { vu: seenCount(ix, p.id, 'event', range) > 0 } : {}),
    }
  })
}

function add(a: QAgg, x: QPoint<unknown>) {
  a.total++
  if (!x.match) return
  a.seen++
  if (x.vu) a.vus++
  if (x.value !== undefined && x.value !== null) {
    a.sum += x.value
    a.n++
  }
}

/** Club de la réponse, comme un club du bilan (ClubCoverage : `seenPlayers` = ceux qui répondent, `toSee` = les autres). */
export type QClub<P> = QAgg & { key: string; name: string; seenPlayers: P[]; toSee: P[]; dept?: string }

/** Département non renseigné (même valeur que NO_DEPT, src/coverage.ts). */
const NO_DEPT = '?'

/**
 * Totaux par département et par région (toute la France), et pour le lieu affiché : ses totaux (`here`) et ses clubs.
 * `clubName` : nom affiché d'une clé de club.
 */
export function aggregate<P>(points: readonly QPoint<P>[], at: { region: string; dept: string }, clubName: (key: string) => string) {
  const byDept = new Map<string, QAgg>()
  const byRegion = new Map<string, QAgg>()
  const noDept = emptyAgg()
  const all = emptyAgg()
  const here = emptyAgg()
  const clubs = new Map<string, QClub<P>>()
  const clubDepts = new Map<string, Map<string, number>>()
  const depts = new Set<string>()
  const get = (m: Map<string, QAgg>, k: string) => {
    let a = m.get(k)
    if (!a) m.set(k, (a = emptyAgg()))
    return a
  }
  for (const x of points) {
    add(all, x)
    if (x.dept) {
      add(get(byDept, x.dept), x)
      if (x.region) add(get(byRegion, x.region), x)
    } else add(noDept, x)
    const inside = at.dept ? (at.dept === NO_DEPT ? !x.dept : x.dept === at.dept) : at.region ? x.region === at.region : true
    if (!inside) continue
    add(here, x)
    if (x.dept && x.match) depts.add(x.dept)
    let c = clubs.get(x.club)
    if (!c) clubs.set(x.club, (c = { ...emptyAgg(), key: x.club, name: x.club ? clubName(x.club) : '', seenPlayers: [], toSee: [] }))
    add(c, x)
    ;(x.match ? c.seenPlayers : c.toSee).push(x.p)
    if (x.dept) {
      const m = clubDepts.get(x.club) ?? new Map<string, number>()
      clubDepts.set(x.club, m)
      m.set(x.dept, (m.get(x.dept) ?? 0) + 1)
    }
  }
  // Département d'un club : celui de la plupart de ses joueurs (à égalité, le plus petit numéro).
  for (const [k, m] of clubDepts) clubs.get(k)!.dept = [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
  return { byDept, byRegion, noDept, all, here, clubs: [...clubs.values()], depts: depts.size }
}

/** Valeur d'une zone (undefined : rien à montrer, gris sur la carte). */
export function aggValue(k: QValueKind, a?: Tally): number | undefined {
  if (!a?.total) return undefined
  const q = a as QAgg
  if (k === 'count') return q.seen
  if (k === 'share') return q.seen / q.total
  if (k === 'seen') return q.seen ? q.vus / q.seen : undefined
  return q.n ? q.sum / q.n : undefined
}

/** Zones dans l'ordre de la question : de la plus forte valeur à la plus faible (`asc` : l'inverse), sans valeur à la fin. */
export function rankAgg<T extends Tally>(k: QValueKind, rows: Iterable<[string, T]>, dir: 'asc' | 'desc' = 'desc'): [string, T][] {
  const s = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (!a[0] !== !b[0]) return !a[0] ? 1 : -1
    const x = aggValue(k, a[1])
    const y = aggValue(k, b[1])
    if (x === undefined || y === undefined) return x === undefined ? (y === undefined ? 0 : 1) : -1
    return s * (x - y) || b[1].total - a[1].total || a[0].localeCompare(b[0], 'fr')
  })
}

/** Sens du classement : celui demandé (« le club qui en a le moins »), sinon du plus au moins. */
export const rankDir = (r: Recipe): 'asc' | 'desc' => r.out.sort?.dir ?? 'desc'

/** Tableau par club limité aux N premiers (« le club qui a le plus de… », « les 5 clubs du Var… »). */
export const isTopClubs = (r: Recipe) => r.out.type === 'table' && (r.out.groupBy ?? 'club') === 'club' && !!r.out.limit

/**
 * Tableau par club limité aux N premiers (« le club qui a le plus de… », « les 5 clubs du Var… ») : seulement eux, dans
 * l'ordre de la question (`ranked` : rankAgg), ex aequo du dernier compris. Lignes gardées comme le tableau de la recette
 * (runRecipe) : au moins un joueur qui répond (« tous », « aucun » : garder de la recette ; tri par part : toutes).
 * Sans limite (ou autre regroupement) : tous les clubs.
 */
export function limitClubs<C extends QAgg & { key: string }>(r: Recipe, kind: QValueKind, ranked: readonly C[]): readonly C[] {
  if (!isTopClubs(r)) return ranked
  const keep = r.out.keep ?? 'some'
  const kept = ranked.filter((c) =>
    !c.key ? false : keep === 'all' ? c.seen === c.total : keep === 'none' ? c.seen === 0 : r.out.sort?.by === 'share' || c.seen > 0,
  )
  return topWithTies(kept, r.out.limit!, (c) => aggValue(kind, c))
}

/**
 * Lieu de départ d'un tableau par club limité aux N premiers (`top` : leurs clés, dans l'ordre, calculées sur la recette
 * entière) : un seul club → son département, club choisi (ses joueurs à droite) ; tous dans un département → lui ; dans
 * une région → elle ; sinon le lieu de la question. Jamais plus large que `place` (lieu tiré de la question).
 */
export function topClubsPlace(place: Place, top: readonly string[], regionOf: (dept: string) => string | undefined, clubDept: (club: string) => string | undefined): Place {
  if (place.club !== null || !top.length || top.length > 50) return place
  const ds = top.map(clubDept)
  if (ds.some((d) => !d)) return place
  const uniq = [...new Set(ds as string[])]
  const inside = (p: Place) => (!place.dept || p.dept === place.dept) && (!place.region || p.region === place.region)
  if (uniq.length === 1) {
    const d = uniq[0]
    const p: Place = { region: regionOf(d) ?? '', dept: d, club: top.length === 1 ? top[0] : null }
    return inside(p) ? p : place
  }
  if (place.dept) return place
  const rs = [...new Set(uniq.map(regionOf))]
  if (rs.length === 1 && rs[0]) {
    const p: Place = { region: rs[0], dept: '', club: null }
    return inside(p) ? p : place
  }
  return place
}
