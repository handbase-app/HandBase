import { geoConicConformal, geoMercator, type ExtendedFeatureCollection, type GeoProjection } from 'd3-geo'
import { clubKey } from './coverage'
import type { UnitFields } from './structureTree'

/*
 * Clubs sur la carte du bilan (src/pages/Coverage.tsx, src/components/FranceMap.tsx) : un département choisi, la carte se
 * recale sur lui et montre un point par club, à sa place réelle (coordonnées des unités « Club » de la structure importée,
 * src/structureImport.ts). Sans React ni base locale, pour être testé seul (tools/test-club-map.ts).
 */

type Unitish = Pick<UnitFields, 'levelId' | 'name' | 'clubNumber' | 'city' | 'lat' | 'lng' | 'departments'> & { id: string; deleted?: boolean }
type ClubPlayer = { clubCode?: string }
/** Club du bilan (ClubCoverage, src/coverage.ts) : clé (nom replié), nom et ses joueurs. */
type ClubLike = { key: string; name: string; toSee: ClubPlayer[]; seenPlayers: ClubPlayer[] }

/** Unité « Club » placée : numéro ou niveau club, et coordonnées utilisables. */
export const isPlacedClub = (u: Unitish) =>
  !u.deleted &&
  (u.levelId === 'niveau-club' || !!u.clubNumber) &&
  Number.isFinite(u.lat) &&
  Number.isFinite(u.lng) &&
  Math.abs(u.lat!) <= 90 &&
  Math.abs(u.lng!) <= 180

/** Au moins un club placé : sans structure importée, la carte du département reste celle d'avant (pas de points). */
export const hasPlacedClubs = (units: readonly Unitish[]) => units.some(isPlacedClub)

export interface ClubDot<C> {
  /** Clé du club du bilan ; « unit:<id> » pour un club de la structure sans joueur avec ces filtres. */
  id: string
  name: string
  /** N° d'affiliation (7 chiffres), s'il est connu. */
  number?: string
  city?: string
  lat: number
  lng: number
  /** Club du bilan (absent : aucun joueur avec ces filtres). */
  club?: C
}

/** N° de club le plus fréquent parmi les joueurs du club (7 chiffres), à égalité le plus petit. */
function mainCode(c: ClubLike): string | undefined {
  const n = new Map<string, number>()
  for (const p of [...c.toSee, ...c.seenPlayers]) if (/^\d{7}$/.test(p.clubCode ?? '')) n.set(p.clubCode!, (n.get(p.clubCode!) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
}

/**
 * Points des clubs d'un département. Club du bilan → unité : par n° de club (celui de la plupart de ses joueurs), sinon
 * par nom replié s'il n'y a qu'une unité de ce nom ; toujours une unité du département. Clubs sans unité placée : seulement dans la liste
 * (`unplaced`). Clubs de la structure du département sans joueur avec ces filtres : points neutres (sans `club`).
 * `deptOf` : département d'un n° de club (department, src/components/PlayerFilter.tsx).
 */
export function clubDots<C extends ClubLike>(
  clubs: readonly C[],
  units: readonly Unitish[],
  dept: string,
  deptOf: (clubNumber: string) => string | undefined,
): { dots: ClubDot<C>[]; unplaced: C[] } {
  const placed = units.filter(isPlacedClub)
  const inDept = placed.filter((u) => (u.clubNumber ? deptOf(u.clubNumber) : u.departments?.[0]) === dept)
  const byNumber = new Map(inDept.filter((u) => u.clubNumber).map((u) => [u.clubNumber!, u]))
  const byName = new Map<string, Unitish[]>()
  for (const u of inDept) byName.set(clubKey(u.name), [...(byName.get(clubKey(u.name)) ?? []), u])
  const used = new Set<string>()
  const dots: ClubDot<C>[] = []
  const unplaced: C[] = []
  const dot = (id: string, u: Unitish, club?: C): ClubDot<C> => ({
    id,
    name: club?.name || u.name,
    ...(u.clubNumber ? { number: u.clubNumber } : {}),
    ...(u.city ? { city: u.city } : {}),
    lat: u.lat!,
    lng: u.lng!,
    ...(club ? { club } : {}),
  })
  for (const c of clubs) {
    if (!c.key) continue // club non renseigné : nulle part sur la carte
    const code = mainCode(c)
    const same = byName.get(c.key)
    const u = (code ? byNumber.get(code) : undefined) ?? (same?.length === 1 ? same[0] : undefined)
    if (!u) {
      unplaced.push(c)
      continue
    }
    used.add(u.id)
    dots.push(dot(c.key, u, c))
  }
  for (const u of inDept) if (!used.has(u.id)) dots.push(dot(`unit:${u.id}`, u))
  return { dots, unplaced }
}

/**
 * Clubs de plusieurs départements sur une même carte (France, région) : chacun placé comme dans son département
 * (clubDots : n° de club, sinon nom replié unique du département), sans les points neutres. `dept` : département du club
 * (celui de la plupart de ses joueurs) ; sans département ou sans unité placée : `unplaced`.
 */
export function placedClubs<C extends ClubLike & { dept?: string }>(
  clubs: readonly C[],
  units: readonly Unitish[],
  deptOf: (clubNumber: string) => string | undefined,
): { dots: ClubDot<C>[]; unplaced: C[] } {
  const byDept = new Map<string, C[]>()
  const unplaced: C[] = []
  for (const c of clubs) {
    if (!c.key) continue
    if (!c.dept) unplaced.push(c)
    else byDept.set(c.dept, [...(byDept.get(c.dept) ?? []), c])
  }
  const dots: ClubDot<C>[] = []
  if (!hasPlacedClubs(units)) return { dots, unplaced: clubs.filter((c) => c.key) as C[] }
  for (const [d, cs] of byDept) {
    const r = clubDots(cs, units, d, deptOf)
    dots.push(...r.dots.filter((x) => x.club))
    unplaced.push(...r.unplaced)
  }
  // Dans l'ordre reçu (classement de la réponse).
  const rank = new Map(clubs.map((c, i) => [c.key, i]))
  dots.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return { dots, unplaced }
}

/**
 * Projection recalée sur un département (cadre w × h, marge `pad`) : la même conique que la carte de France pour la
 * métropole, Mercator pour un territoire ultramarin (contour de src/assets/outre-mer.json).
 */
export function focusProjection(shape: ExtendedFeatureCollection, w: number, h: number, pad: number, overseas: boolean): GeoProjection {
  const p = overseas ? geoMercator() : geoConicConformal().parallels([44, 49]).rotate([-3, 0])
  return p.fitExtent(
    [
      [pad, pad],
      [w - pad, h - pad],
    ],
    shape,
  )
}

/** Rayon d'un point (px à l'écran) : racine du nombre de joueurs, de `min` (le plus petit club) à `max` (le plus grand). */
export const dotRadius = (total: number, maxTotal: number, min = 5, max = 12) =>
  min + (max - min) * Math.sqrt(Math.min(1, Math.max(0, total) / (maxTotal || 1)))

/**
 * Écarte les points qui se chevauchent (`gap` entre deux bords) : quelques passes où chaque paire trop proche est
 * repoussée de part et d'autre ; les points confondus partent dans des directions fixes (angle d'or), pour un résultat
 * toujours le même. Les positions d'origine ne sont pas modifiées.
 */
export function spreadDots<T extends { x: number; y: number; r: number }>(points: readonly T[], gap = 1.5, passes = 40): T[] {
  const out = points.map((p) => ({ ...p }))
  for (let pass = 0; pass < passes; pass++) {
    let moved = false
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]
        const b = out[j]
        const need = a.r + b.r + gap
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.hypot(dx, dy)
        if (d >= need - 1e-6) continue
        if (d < 1e-6) {
          const t = (j * 2.399963) % (2 * Math.PI)
          dx = Math.cos(t)
          dy = Math.sin(t)
          d = 1
        }
        const push = (need - Math.hypot(b.x - a.x, b.y - a.y)) / 2
        a.x -= (dx / d) * push
        a.y -= (dy / d) * push
        b.x += (dx / d) * push
        b.y += (dy / d) * push
        moved = true
      }
    if (!moved) break
  }
  return out
}
