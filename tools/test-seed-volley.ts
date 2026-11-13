// Test du générateur du jeu de démonstration volley national (tools/seed-volley.ts), parties pures : déterminisme,
// structure (villes dans leur département, n° de club lus par l'appli), répartitions (filles, postes, trimestres,
// générations), tests physiques dans les fourchettes, avis sur les grilles du volley, pôles reconnus par l'appli.
// Aucune base, aucun réseau ; données fictives.
//
//   npx jiti tools/test-seed-volley.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildSeed,
  BEHIND,
  categoryOf,
  DEPTS,
  ENVERGURE,
  FAMOUS,
  hash32,
  phi,
  seedUuid,
  stats,
  TODAY,
  TOWN_LIST,
  upcoming,
  upsertSql,
  YEARS,
  type Seed,
} from './seed-volley'
import { RANGES } from '../src/demoVolley'
import { playerDepartment } from '../src/perimeter'
import { OFFICIAL_REGIONS } from '../src/regionsOfficial'
import { HANDBALL_LEVELS, type UnitRow } from '../src/structureTree'
import { membersAt, poleRefsOf } from '../src/poleSeason'
import type { Measurement, Player, PolePeriod } from '../src/db'
import { snapshots } from '../src/maturitySnapshot'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const file = readFileSync(new URL('../public/demo/criteres-volley.json', import.meta.url), 'utf8')
const seed: Seed = buildSeed(file)
const s = stats(seed)
const players = seed.players
const byId = new Map(players.map((p) => [p.id, p]))

t('déterministe : deux générations donnent exactement les mêmes lignes', () => {
  const again = buildSeed(file)
  for (const [k, rows] of Object.entries(seed.tables)) {
    const a = hash32(JSON.stringify(rows))
    const b = hash32(JSON.stringify(again.tables[k as keyof Seed['tables']]))
    assert.equal(a, b, k)
  }
  assert.equal(seedUuid('player:1'), seedUuid('player:1'))
  assert.match(seedUuid('player:1'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

t('identifiants uniques dans chaque table', () => {
  for (const [k, rows] of Object.entries(seed.tables)) assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, k)
})

t('volumes : 25 000 joueurs, ~1 450 clubs, ~15 000 « vu », ~1 200 avis, 50 à 70 000 mesures, ~20 événements', () => {
  assert.equal(s.counts.players, 25_000)
  assert.ok(s.clubs >= 1400 && s.clubs <= 1520, `clubs ${s.clubs}`)
  assert.ok(s.counts.seen >= 13_000 && s.counts.seen <= 17_000, `vus ${s.counts.seen}`)
  assert.ok(s.counts.evaluations >= 1000 && s.counts.evaluations <= 1450, `avis ${s.counts.evaluations}`)
  assert.ok(s.counts.measurements >= 50_000 && s.counts.measurements <= 70_000, `mesures ${s.counts.measurements}`)
  assert.ok(s.counts.events >= 18 && s.counts.events <= 30, `événements ${s.counts.events}`)
  assert.equal(s.counts.criteria, 43)
  assert.equal(s.counts.lists, 121)
  assert.equal(s.counts.groups, 16 + 3)
})

t('villes réelles : dans le contour de leur département (côtes simplifiées : 15 km), code postal du département', () => {
  type Ring = number[][]
  const load = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8')) as { features: { properties: { code: string }; geometry: { type: string; coordinates: unknown } }[] }
  const shapes = new Map<string, Ring[]>()
  for (const g of [load('../src/assets/departements.json'), load('../src/assets/outre-mer.json')])
    for (const f of g.features) {
      const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][]
      shapes.set(f.properties.code, polys.map((p) => p[0]))
    }
  const inside = ([x, y]: number[], ring: Ring) => {
    let c = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  }
  const km = ([x, y]: number[], ring: Ring) => Math.min(...ring.map(([a, b]) => Math.hypot((a - x) * 111 * Math.cos((y * Math.PI) / 180), (b - y) * 111)))
  let outside = 0
  for (const town of TOWN_LIST) {
    const rings = shapes.get(town.dept)
    assert.ok(rings, `contour ${town.dept}`)
    const pt = [town.lng, town.lat]
    if (!rings.some((r) => inside(pt, r))) {
      outside++
      assert.ok(Math.min(...rings.map((r) => km(pt, r))) < 15, `${town.name} (${town.dept}) loin de son département`)
    }
    const prefix = town.dept === '2A' || town.dept === '2B' ? '20' : town.dept
    for (const cp of town.postal) assert.ok(cp.startsWith(prefix) && /^\d{5}$/.test(cp), `${town.name} ${cp}`)
  }
  assert.ok(TOWN_LIST.length > 800, `${TOWN_LIST.length} villes`)
  assert.ok(outside < 15, `${outside} villes hors contour`)
})

t('structure : fédération, 19 ligues, un comité par département, clubs rangés sous leur comité, pôles sous leur ligue', () => {
  const units = seed.tables.units.map((r) => r.data as unknown as UnitRow)
  const byLevel = (l: string) => units.filter((u) => u.levelId === l)
  assert.equal(byLevel('niveau-federation').length, 1)
  assert.equal(byLevel('niveau-ligue').length, 19)
  assert.equal(byLevel('niveau-comite').length, DEPTS.length)
  assert.equal(byLevel('niveau-pole').length, 16)
  const ids = new Map(units.map((u) => [u.id, u]))
  for (const u of units) if (u.parentId) assert.ok(ids.has(u.parentId), `parent de ${u.name}`)
  for (const c of byLevel('niveau-club')) assert.equal(ids.get(c.parentId!)!.levelId, 'niveau-comite')
  for (const p of byLevel('niveau-pole')) assert.equal(ids.get(p.parentId!)!.levelId, 'niveau-ligue')
  for (const c of byLevel('niveau-comite')) for (const d of c.departments ?? []) assert.match(d, /^(\d{2,3}|2[AB])$/)
  // Noms de clubs uniques, aucun nom inventé identique d'un département à l'autre.
  const names = byLevel('niveau-club').map((c) => c.name)
  assert.equal(new Set(names).size, names.length)
})

t('n° de club et licences : le département lu par l\'appli est celui du club (outre-mer, Corse comprises)', () => {
  const licenses = new Set<string>()
  for (const p of players) {
    const c = p.club
    assert.match(c.number, /^\d{7}$/)
    const want = c.dept.code === '2A' || c.dept.code === '2B' ? '20' : c.dept.code
    assert.equal(playerDepartment({ clubCode: c.number }), want, c.number)
    assert.equal(playerDepartment({ license: p.data.license as string }), want)
    assert.ok((p.data.license as string).startsWith(c.number))
    licenses.add(p.data.license as string)
  }
  assert.equal(licenses.size, players.length, 'licences uniques')
})

t('colonnes de périmètre (046) : département et club du joueur selon la règle du serveur, recopiés sur ses lignes', () => {
  const scope = new Map(seed.tables.players.map((r) => [r.id, r.scope]))
  for (const r of seed.tables.players) assert.deepEqual(r.scope, [playerDepartment(r.data as { clubCode: string }), r.data.clubCode])
  for (const k of ['measurements', 'evaluations', 'seen'] as const) for (const r of seed.tables[k]) assert.deepEqual(r.scope, scope.get(r.data.playerId as string), k)
  for (const r of seed.tables.videos) assert.deepEqual(r.scope, r.data.targetKind === 'player' ? scope.get(r.data.targetId as string) : [null, null])
})

t('joueurs : 58 % de filles, nés de 2008 à 2013, postes R4 > C > PT > P, droitiers en majorité, aucun sportif connu', () => {
  assert.ok(s.girls >= 56 && s.girls <= 60, `filles ${s.girls}`)
  assert.ok(players.every((p) => YEARS.includes(p.year as (typeof YEARS)[number])))
  const { R4, C, PT, P } = s.positions
  assert.ok(R4 > C && C > PT && PT > P, JSON.stringify(s.positions))
  assert.ok(s.leftHanded > 8 && s.leftHanded < 18)
  for (const p of players) assert.ok(!FAMOUS.has(`${p.data.firstName} ${p.data.lastName}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()))
  // Aucun champ qui ferait expirer ou effacer la fiche la nuit (012, 028).
  for (const p of players) assert.ok(!('review' in p.data) && !('deleted' in p.data))
})

t('effet de l\'âge relatif : un peu plus de naissances au 1er trimestre, beaucoup plus aux pôles', () => {
  const [q1, , , q4] = s.quarters.all
  assert.ok(q1 > q4 && q1 < 30, JSON.stringify(s.quarters.all))
  assert.ok(s.quarters.poles[0] > 35 && s.quarters.poles[3] < 16, JSON.stringify(s.quarters.poles))
  assert.ok(s.quarters.seen[0] > s.quarters.all[0], 'les vus sont plus souvent nés en début d\'année')
})

t('« vu » : sur des joueurs de la liste de l\'événement, événements passés, plus de M18 que de M15, départements en retard', () => {
  const events = new Map(seed.events.map((e) => [e.id, e]))
  for (const r of seed.tables.seen) {
    const e = events.get(r.data.eventId as string)!
    assert.ok(e && !upcoming(e))
    assert.ok(e.roster.some((p) => p.id === r.data.playerId))
    assert.equal(r.id, `${r.data.createdBy}:${r.data.eventId}:${r.data.playerId}`)
    assert.ok((r.data.at as string) <= `${TODAY}T23:59`)
  }
  const y = s.byYear as Record<number, { seen: number }>
  assert.ok((y[2008].seen + y[2009].seen + y[2010].seen) / 3 > (y[2011].seen + y[2012].seen) / 2 + 3, JSON.stringify(y))
  for (const d of s.deptsLeastSeen.slice(0, 5)) assert.ok(d.seen < 5)
  assert.ok([...BEHIND].filter((c) => s.deptsLeastSeen.some((d) => d.code === c)).length >= 3)
  assert.ok(s.deptsMostSeen[0].seen > 25)
})

t('tests physiques : dans les fourchettes de la catégorie, taille jamais en baisse, triplet de maturité le même jour', () => {
  const byPlayer = new Map<string, Map<string, Record<string, number>>>()
  for (const r of seed.tables.measurements) {
    const d = r.data as { playerId: string; criterionId: string; value: number; date: string }
    const p = byId.get(d.playerId)!
    const cat = categoryOf(p.year, d.date)
    const R = RANGES[p.sex][cat] as Record<string, readonly [number, number]>
    const key = { taille: 'taille', taille_assise: 'assise', poids: 'poids', atteinte: 'atteinte', hauteur_attaque: 'attaque', hauteur_contre: 'contre', cmj_hauteur: 'cmj', t_test: 'ttest', medecine_ball: 'mb' }[d.criterionId]
    if (key) {
      const [a, b] = R[key]
      assert.ok(d.value >= Math.min(a, b) && d.value <= Math.max(a, b), `${d.criterionId} ${d.value} ${p.sex} ${cat}`)
    }
    const m = byPlayer.get(d.playerId) ?? new Map()
    m.set(d.date, { ...(m.get(d.date) ?? {}), [d.criterionId]: d.value })
    byPlayer.set(d.playerId, m)
  }
  let sessions = 0
  for (const [pid, days] of byPlayer) {
    const p = byId.get(pid)!
    let prev = 0
    for (const [day, v] of [...days].sort((a, b) => a[0].localeCompare(b[0]))) {
      sessions++
      assert.ok(v.taille !== undefined && v.poids !== undefined && v.taille_assise !== undefined, 'taille, poids, taille assise le même jour')
      assert.ok(v.taille >= prev, `taille en baisse ${pid}`)
      prev = v.taille
      if (v.envergure !== undefined) {
        const [a, b] = ENVERGURE[p.sex][categoryOf(p.year, day)]
        assert.ok(v.envergure - v.taille >= a - 0.5 && v.envergure - v.taille <= b + 0.5)
      }
      if (v.hauteur_attaque !== undefined && v.atteinte !== undefined) assert.ok(v.hauteur_attaque > v.atteinte)
      if (v.hauteur_contre !== undefined && v.hauteur_attaque !== undefined) assert.ok(v.hauteur_contre < v.hauteur_attaque)
    }
    assert.ok(days.size >= 1 && days.size <= 3)
  }
  assert.ok(s.measuredPlayers >= 25 && s.measuredPlayers <= 35, `mesurés ${s.measuredPlayers} %`)
  assert.ok(sessions > 8000)
})

t('corrélations : taille ↔ atteinte et hauteur d\'attaque, CMJ ↔ hauteur d\'attaque', () => {
  const pairs: Record<string, number[][]> = { ta: [], tat: [], ca: [] }
  const rows = new Map<string, Record<string, number>>()
  for (const r of seed.tables.measurements) {
    const d = r.data as { playerId: string; criterionId: string; value: number; date: string }
    const k = `${d.playerId}|${d.date}`
    rows.set(k, { ...(rows.get(k) ?? {}), [d.criterionId]: d.value })
  }
  for (const [k, v] of rows) {
    const p = byId.get(k.split('|')[0])!
    if (p.sex !== 'F' || categoryOf(p.year, k.split('|')[1]) !== 'M15') continue
    if (v.atteinte) pairs.ta.push([v.taille, v.atteinte])
    if (v.hauteur_attaque) pairs.tat.push([v.taille, v.hauteur_attaque])
    if (v.hauteur_attaque && v.cmj_hauteur) pairs.ca.push([v.cmj_hauteur, v.hauteur_attaque - (v.atteinte ?? 0)])
  }
  const corr = (xy: number[][]) => {
    const n = xy.length
    const mx = xy.reduce((s, [x]) => s + x, 0) / n
    const my = xy.reduce((s, [, y]) => s + y, 0) / n
    const c = xy.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0)
    return c / Math.sqrt(xy.reduce((s, [x]) => s + (x - mx) ** 2, 0) * xy.reduce((s, [, y]) => s + (y - my) ** 2, 0))
  }
  assert.ok(corr(pairs.ta) > 0.8, `taille-atteinte ${corr(pairs.ta)}`)
  assert.ok(corr(pairs.tat) > 0.5, `taille-attaque ${corr(pairs.tat)}`)
  const elan = pairs.ca.filter(([, e]) => e > 0)
  assert.ok(corr(elan) > 0.5, `CMJ-élan ${corr(elan)}`)
})

t('maturité et taille adulte prédite (calculs de l\'appli) : Mirwald à chaque séance, Khamis-Roche plausible, maturité en avance visible', () => {
  const byPlayer = new Map<string, Measurement[]>()
  for (const r of seed.tables.measurements) byPlayer.set(r.data.playerId as string, [...(byPlayer.get(r.data.playerId as string) ?? []), r.data as unknown as Measurement])
  const pairs: [number, number][] = []
  let kr = 0
  for (const [pid, ms] of byPlayer) {
    const p = byId.get(pid)!
    const snaps = snapshots(p.data as unknown as Player, ms)
    assert.ok(snaps.length >= 1)
    for (const s of snaps) {
      assert.ok(s.mirwald !== null, `Mirwald calculable (${pid} ${s.date})`)
      if (s.kr) {
        kr++
        const [lo, hi] = p.sex === 'F' ? [155, 195] : [165, 212]
        assert.ok(s.kr.predicted > lo && s.kr.predicted < hi, `taille prédite ${Math.round(s.kr.predicted)} (${p.sex})`)
        assert.ok(s.kr.pah > 80 && s.kr.pah < 106, `% de la taille adulte ${s.kr.pah}`)
      }
      if (p.sex === 'F' && s.age >= 12 && s.age < 13.5) pairs.push([p.m, s.mean.offset])
    }
  }
  assert.ok(kr > 2000, `${kr} prédictions de taille`)
  const n = pairs.length
  const mx = pairs.reduce((a, [x]) => a + x, 0) / n
  const my = pairs.reduce((a, [, y]) => a + y, 0) / n
  const c = pairs.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / Math.sqrt(pairs.reduce((a, [x]) => a + (x - mx) ** 2, 0) * pairs.reduce((a, [, y]) => a + (y - my) ** 2, 0))
  assert.ok(c > 0.15, `maturité en avance ↔ décalage au pic : ${c.toFixed(2)}`)
})

t('avis : grilles du volley selon le poste, notes de 1 à 5 centrées sur 3, textes positifs ou « À travailler : »', () => {
  const crit = new Map(seed.tables.criteria.map((r) => [r.id, r.data as { positions?: string[]; kind: string }]))
  const events = new Set(seed.tables.events.map((r) => r.id))
  for (const r of seed.tables.evaluations) {
    const d = r.data as { playerId: string; eventId: string; scores: Record<string, number>; strengths?: string; improvements?: string; observer: string; createdByName: string }
    const p = byId.get(d.playerId)!
    assert.ok(p && events.has(d.eventId))
    assert.equal(d.observer, d.createdByName)
    for (const [c, v] of Object.entries(d.scores)) {
      const def = crit.get(c)
      assert.ok(def && def.kind === 'subjective', c)
      assert.ok(Number.isInteger(v) && v >= 1 && v <= 5)
      assert.ok(!def.positions || !p.pos || def.positions.includes(p.pos), `${c} pour ${p.pos}`)
    }
    if (d.improvements) assert.match(d.improvements, /^À travailler : /)
    if (d.strengths) assert.doesNotMatch(d.strengths, /\b(pas|faible|nul|insuffisant|mauvais)\b/i)
  }
  assert.ok(s.evalMean > 2.8 && s.evalMean < 3.4, `moyenne ${s.evalMean}`)
  assert.ok(s.scoreDist[4] > 3 && s.scoreDist[4] < 15, 'quelques 5 (profils remarquables)')
})

t('pôles : 16 groupes reconnus par l\'appli (poleSeason), au plus 16 membres de 2009 à 2012, du territoire du pôle', () => {
  const units = seed.tables.units.map((r) => r.data as unknown as UnitRow)
  const regions = Object.keys(OFFICIAL_REGIONS).map((id) => ({ id, name: id }))
  const deptRegion = new Map(Object.entries(OFFICIAL_REGIONS).flatMap(([r, ds]) => ds.split(' ').map((d) => [d, r] as const)))
  const refs = poleRefsOf(units, HANDBALL_LEVELS, { regions, regionOfDept: (d) => deptRegion.get(d) })
  assert.equal(refs.size, 16)
  const groups = seed.tables.groups.filter((r) => r.data.poleUnitId)
  assert.equal(groups.length, 16)
  const fiches = players.map((p) => ({ id: p.id, poles: p.data.poles as PolePeriod[] | undefined, p }))
  for (const g of groups) {
    const ref = refs.get(g.data.poleUnitId as string)!
    assert.equal(ref.regionId, g.data.regionId)
    const members = membersAt(fiches, ref, TODAY)
    assert.ok(members.length >= 12 && members.length <= 16, `${g.data.name} : ${members.length}`)
    for (const m of members) {
      assert.ok(m.p.year >= 2009 && m.p.year <= 2012)
      assert.equal(m.p.region, g.data.regionId)
      assert.equal(m.p.sex, g.data.sex)
    }
  }
  const sel = seed.tables.groups.filter((r) => !r.data.poleUnitId)
  assert.equal(sel.length, 3)
  for (const g of sel) assert.ok((g.data.playerIds as string[]).every((id) => byId.get(id)!.region === g.data.regionId))
})

t('SQL : apostrophes doublées, écriture idempotente', () => {
  const sql = upsertSql('players', [{ id: 'x', data: { id: 'x', club: "Volley Club de L'Isle-Adam" } }])
  assert.match(sql, /L''Isle-Adam/)
  assert.match(sql, /on conflict \(id\) do update/)
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-6 && phi(1.96) > 0.97 && phi(-1.96) < 0.03)
})

console.log(`\n${n} tests OK`)
