import { clubKey } from './coverage'
import { isPlacedClub, placedClubs } from './clubMap'
import type { UnitFields } from './structureTree'

/*
 * Clubs nommés dans une réponse de « Poser une question » (mode avancé : lignes de la requête SQLite, src/components/
 * SqlAnswer.tsx ; tableau par club de la recette, src/pages/Question.tsx) : retrouvés parmi les clubs des joueurs de
 * l'appareil et placés sur la carte (unités « Club » de la structure importée, même règle que le bilan, src/clubMap.ts :
 * n° de club d'abord, sinon nom replié unique dans son département). Chaque club retrouvé ouvre le bilan sur lui.
 * Fichier pur (ni React ni base), testé par tools/test-answer-clubs.ts. Rien ne part : tout est lu sur l'appareil.
 */

type Unitish = Pick<UnitFields, 'levelId' | 'name' | 'clubNumber' | 'city' | 'lat' | 'lng' | 'departments'> & { id: string; deleted?: boolean }
/** Joueur de l'appareil (vivant) : son club, son n° de club et son département. */
export type ClubPlayer = { club?: string; clubCode?: string; dept?: string }

/** Club des joueurs de l'appareil (clé : nom replié, comme le bilan). */
export type KnownClub = { key: string; name: string; dept?: string; toSee: { clubCode?: string }[]; seenPlayers: { clubCode?: string }[] }

/** Club retrouvé dans une réponse : clé du bilan, nom, département ; position s'il est placé. */
export type AnswerClub = { key: string; name: string; dept?: string; lat?: number; lng?: number; number?: string; city?: string }

const top = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]

/** Clubs des joueurs, par clé : nom le plus écrit, département de la plupart de ses joueurs. */
export function knownClubs(players: readonly ClubPlayer[]): Map<string, KnownClub> {
  const acc = new Map<string, { names: Map<string, number>; depts: Map<string, number>; codes: { clubCode?: string }[] }>()
  for (const p of players) {
    const k = clubKey(p.club)
    if (!k) continue
    let a = acc.get(k)
    if (!a) acc.set(k, (a = { names: new Map(), depts: new Map(), codes: [] }))
    const n = p.club!.trim()
    a.names.set(n, (a.names.get(n) ?? 0) + 1)
    if (p.dept) a.depts.set(p.dept, (a.depts.get(p.dept) ?? 0) + 1)
    a.codes.push({ clubCode: p.clubCode })
  }
  return new Map([...acc].map(([key, a]) => [key, { key, name: top(a.names)!, dept: top(a.depts), toSee: a.codes, seenPlayers: [] }]))
}

/**
 * Clubs (clés du bilan) placés : département et position quand l'unité est connue (sinon seulement le département, ou rien).
 * Ordre gardé.
 */
export function locateClubs(keys: readonly string[], known: Map<string, KnownClub>, units: readonly Unitish[], deptOf: (clubNumber: string) => string | undefined): Map<string, AnswerClub> {
  const clubs = [...new Set(keys)].map((k) => known.get(k)).filter((c): c is KnownClub => !!c)
  const { dots } = placedClubs(clubs, units, deptOf)
  const at = new Map(dots.map((d) => [d.id, d]))
  return new Map(
    clubs.map((c) => {
      const d = at.get(c.key)
      return [
        c.key,
        {
          key: c.key,
          name: c.name,
          ...(c.dept ? { dept: c.dept } : {}),
          ...(d ? { lat: d.lat, lng: d.lng, ...(d.number ? { number: d.number } : {}), ...(d.city ? { city: d.city } : {}) } : {}),
        },
      ]
    }),
  )
}

const NUMBER = /^\d{7}$/

/**
 * Colonne de clubs d'un résultat SQL et club de chaque ligne. Une colonne compte si ses valeurs sont des noms de clubs
 * des joueurs (repliés) ou des n° de club (7 chiffres) : celle dont le nom dit « club » (au moins une ligne retrouvée),
 * sinon celle qui en retrouve le plus, au moins 60 % de ses lignes renseignées. Un n° sans joueur de ce club : l'unité de
 * la structure (clé : son nom replié). `value` : 1re autre colonne numérique (couleur, taille des points). null : aucun club.
 */
export function clubsInRows(
  res: { columns: readonly string[]; rows: readonly (readonly unknown[])[] },
  known: Map<string, KnownClub>,
  units: readonly Unitish[],
  deptOf: (clubNumber: string) => string | undefined,
): { col: number; value?: number; rows: (AnswerClub | null)[] } | null {
  if (!res.rows.length || res.columns.some((c) => c.toLowerCase() === 'joueur_id')) return null
  const byNumber = new Map(units.filter((u) => !u.deleted && u.clubNumber).map((u) => [u.clubNumber!, u]))
  // N° de club → club des joueurs (n° le plus fréquent de ses joueurs).
  const codeClub = new Map<string, string>()
  for (const c of known.values()) {
    const n = new Map<string, number>()
    for (const p of c.toSee) if (NUMBER.test(p.clubCode ?? '')) n.set(p.clubCode!, (n.get(p.clubCode!) ?? 0) + 1)
    const main = top(n)
    if (main && !codeClub.has(main)) codeClub.set(main, c.key)
  }
  const keyOf = (v: unknown): { key: string; number?: string } | null => {
    if (v === null || v === undefined) return null
    const s = String(v).trim()
    if (NUMBER.test(s)) {
      const k = codeClub.get(s) ?? (byNumber.get(s) ? clubKey(byNumber.get(s)!.name) : undefined)
      return k ? { key: k, number: s } : null
    }
    const k = clubKey(s)
    return k && known.has(k) ? { key: k } : null
  }
  let best: { col: number; hits: number } | null = null
  res.columns.forEach((name, col) => {
    const filled = res.rows.filter((r) => r[col] !== null && r[col] !== undefined && r[col] !== '').length
    const hits = res.rows.filter((r) => keyOf(r[col])).length
    if (!hits) return
    const named = /club/i.test(name)
    const ok = named || hits >= Math.max(1, 0.6 * filled)
    if (!ok) return
    const score = hits + (named ? 1e6 : 0)
    if (!best || score > best.hits) best = { col, hits: score }
  })
  if (!best) return null
  const col = (best as { col: number }).col
  const found = res.rows.map((r) => keyOf(r[col]))
  const placed = locateClubs(
    found.filter((x): x is { key: string } => !!x && known.has(x.key)).map((x) => x.key),
    known,
    units,
    deptOf,
  )
  const rows = found.map((x): AnswerClub | null => {
    if (!x) return null
    const c = placed.get(x.key)
    if (c) return c
    // N° de club sans joueur sur l'appareil : l'unité de la structure.
    const u = x.number ? byNumber.get(x.number) : undefined
    if (!u) return null
    return {
      key: x.key,
      name: u.name,
      ...(deptOf(x.number!) ? { dept: deptOf(x.number!) } : {}),
      ...(isPlacedClub(u) ? { lat: u.lat!, lng: u.lng!, number: x.number } : { number: x.number }),
      ...(u.city ? { city: u.city } : {}),
    }
  })
  const value = res.columns.findIndex((_, k) => k !== col && res.rows.some((r) => typeof r[k] === 'number') && res.rows.every((r) => r[k] === null || typeof r[k] === 'number'))
  return { col, ...(value >= 0 ? { value } : {}), rows }
}

/**
 * Cadre de la carte des clubs d'une réponse : un seul département → lui (recalé, points à leur adresse) ; une seule
 * région → elle ; sinon la France.
 */
export function clubsFrame(clubs: readonly AnswerClub[], regionOf: (dept: string) => string | undefined): { region: string; dept: string } {
  const ds = [...new Set(clubs.filter((c) => c.lat !== undefined).map((c) => c.dept).filter((d): d is string => !!d))]
  if (ds.length === 1 && clubs.every((c) => c.lat === undefined || c.dept === ds[0])) return { region: regionOf(ds[0]) ?? '', dept: ds[0] }
  const rs = [...new Set(ds.map(regionOf))]
  if (rs.length === 1 && rs[0]) return { region: rs[0], dept: '' }
  return { region: '', dept: '' }
}
