// Test du générateur du jeu de démonstration handball national (tools/seed-hand.ts), parties pures : déterminisme et
// identifiants stables, configuration (sport = handball), structure (ligues, comités, clubs aux noms fictifs, sites des pôles
// de src/poles.ts), n° de club lus par l'appli, colonnes de périmètre, postes et catégories du handball, répartition
// filles / garçons, aucune étiquette négative, tests physiques dans les fourchettes, avis sur la grille du handball (gardiens
// à part), pôles reconnus par l'appli. Aucune base, aucun réseau ; données fictives.
//
//   npx jiti tools/test-seed-hand.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BEHIND,
  buildSeed,
  CATS,
  categoryOf,
  DEPTS,
  ENVERGURE,
  FAMOUS,
  hash32,
  jerseys,
  LIGUES,
  MARK,
  PHYSIO,
  RANGE_CRITERION,
  RANGES,
  seasonAge,
  seedUuid,
  SITE_DEPT,
  siteYears,
  SPORT_ROW,
  STAFF,
  stats,
  TODAY,
  upcoming,
  upsertSql,
  verifySql,
  YEARS,
  type Seed,
  type SeedPlayer,
} from './seed-hand'
import { seedUuid as volleyUuid } from './seed-volley'
import { HANDBALL, resolveSportConfig, type ConfigRow } from '../src/sportConfig'
import { SPORT_CONTENT } from '../src/sportContent'
import { playerDepartment } from '../src/perimeter'
import { OFFICIAL_REGIONS } from '../src/regionsOfficial'
import { HANDBALL_LEVELS, type UnitRow } from '../src/structureTree'
import { membersAt, poleRefsOf, PROGRAMME_AGES, schoolAge } from '../src/poleSeason'
import { POLE_SITES } from '../src/poles'
import { poleCode, poleName } from '../src/structureImport'
import type { Measurement, Player, PolePeriod } from '../src/db'
import { snapshots } from '../src/maturitySnapshot'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const file = readFileSync(new URL(`../public/${SPORT_CONTENT.handball.demoCriteria}`, import.meta.url), 'utf8')
const seed: Seed = buildSeed(file)
const s = stats(seed)
const players = seed.players
const byId = new Map(players.map((p) => [p.id, p]))
const CODES = HANDBALL.positions.map((p) => p.code)
const fold = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const deptRegion = new Map(Object.entries(OFFICIAL_REGIONS).flatMap(([r, ds]) => ds.split(' ').map((d) => [d, r] as const)))

t('déterministe : deux générations donnent exactement les mêmes lignes ; identifiants stables (UUID dérivés d\'une clé)', () => {
  const again = buildSeed(file)
  for (const [k, rows] of Object.entries(seed.tables)) assert.equal(hash32(JSON.stringify(rows)), hash32(JSON.stringify(again.tables[k as keyof Seed['tables']])), k)
  assert.equal(seedUuid('player:1'), seedUuid('player:1'))
  assert.match(seedUuid('player:1'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  // Propres au handball : jamais ceux du jeu volley (deux jeux dans une même base ne s'écrasent pas).
  assert.notEqual(seedUuid('player:1'), volleyUuid('player:1'))
  for (const p of players.slice(0, 500)) assert.equal(p.id, seedUuid(`player:${p.i}`))
  for (const st of STAFF) assert.equal(st.id, seedUuid(`staff:${st.key}`))
  for (const e of seed.events) assert.equal(e.id, seedUuid(`event:${e.key}`))
})

t('identifiants uniques dans chaque table ; lignes marquées data.demoSeed = « hand »', () => {
  for (const [k, rows] of Object.entries(seed.tables)) assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, k)
  assert.equal(MARK, 'hand')
  for (const k of ['players', 'measurements', 'events', 'evaluations', 'groups', 'seen', 'videos', 'units'] as const) for (const r of seed.tables[k]) assert.equal(r.data.demoSeed, 'hand', k)
})

t('volumes : 25 000 joueurs, ~1 600 clubs, ~13 000 « vu », ~1 300 avis, 50 à 75 000 mesures, ~27 événements', () => {
  assert.equal(s.counts.players, 25_000)
  assert.ok(s.clubs >= 1500 && s.clubs <= 1750, `clubs ${s.clubs}`)
  assert.ok(s.counts.seen >= 10_000 && s.counts.seen <= 18_000, `vus ${s.counts.seen}`)
  assert.ok(s.counts.evaluations >= 1000 && s.counts.evaluations <= 1700, `avis ${s.counts.evaluations}`)
  assert.ok(s.counts.measurements >= 50_000 && s.counts.measurements <= 75_000, `mesures ${s.counts.measurements}`)
  assert.ok(s.counts.events >= 22 && s.counts.events <= 32, `événements ${s.counts.events}`)
  assert.equal(s.counts.criteria, 91)
  assert.equal(s.counts.lists, 121)
  assert.equal(s.counts.groups, POLE_SITES.length + 3)
})

t('configuration : ligne « sport » = handball (lue par l\'appli et par tools/seed-rencontres.ts), postes par défaut du handball', () => {
  assert.equal(seed.tables.config.length, 1)
  assert.deepEqual(seed.tables.config[0], SPORT_ROW)
  const cfg = resolveSportConfig(seed.tables.config.map((r) => r.data as unknown as ConfigRow), 'volley')
  assert.equal(cfg.sport, 'handball')
  assert.equal(cfg.sportName, 'Handball')
  assert.deepEqual(cfg.positions.map((p) => p.code), CODES)
  // Clé des catégories de jeunes des rencontres (seed-rencontres joint sur le texte brut : jamais « hand »).
  assert.ok(SPORT_CONTENT[(SPORT_ROW.data.value as { sport: string }).sport])
  assert.ok(!seed.tables.config.some((r) => r.id === 'postes'))
})

t('structure : fédération, 18 ligues (Corse dans la Région Sud), un comité par département, clubs sous leur comité', () => {
  const units = seed.tables.units.map((r) => r.data as unknown as UnitRow & { clubNumber?: string; city?: string })
  const byLevel = (l: string) => units.filter((u) => u.levelId === l)
  assert.equal(byLevel('niveau-federation').length, 1)
  assert.equal(byLevel('niveau-federation')[0].name, 'Fédération française de handball')
  assert.equal(byLevel('niveau-ligue').length, 18)
  assert.equal(byLevel('niveau-comite').length, DEPTS.length)
  assert.equal(byLevel('niveau-pole').length, POLE_SITES.length)
  const ids = new Map(units.map((u) => [u.id, u]))
  for (const u of units) if (u.parentId) assert.ok(ids.has(u.parentId), `parent de ${u.name}`)
  for (const c of byLevel('niveau-club')) assert.equal(ids.get(c.parentId!)!.levelId, 'niveau-comite')
  for (const p of byLevel('niveau-pole')) assert.equal(ids.get(p.parentId!)!.levelId, 'niveau-ligue')
  const sud = LIGUES.find((l) => l.key === 'region-sud')!
  for (const code of ['2A', '2B']) assert.equal(DEPTS.find((d) => d.code === code)!.ligue, sud.key)
  for (const l of LIGUES) assert.ok(l.code < '64' ? !l.depts : /^(64|65|66|67|69|70)$/.test(l.code), l.name)
})

t('clubs : noms FICTIFS uniques, jamais les modèles les plus courants des vrais clubs (« X Handball », « HBC X »…)', () => {
  const clubs = seed.structure.clubs
  assert.equal(new Set(clubs.map((c) => fold(c.name))).size, clubs.length)
  for (const c of clubs) {
    assert.doesNotMatch(c.name, /^(HBC|HB|AS|US|ASL|CA|ES|SC|AL) /, c.name)
    assert.doesNotMatch(c.name, /^Handball Club/, c.name)
    assert.notEqual(c.name, `${c.city} Handball`)
    assert.notEqual(c.name, `${c.town.name} Handball`)
    assert.match(c.name, /Hand/)
  }
})

t('n° de club et licences : le département lu par l\'appli est celui du club (outre-mer, Corse comprises)', () => {
  const licenses = new Set<string>()
  for (const p of players) {
    const c = p.club
    assert.match(c.number, /^\d{7}$/)
    const want = c.dept.code === '2A' || c.dept.code === '2B' ? '20' : c.dept.code
    assert.equal(playerDepartment({ clubCode: c.number }), want, c.number)
    assert.equal(playerDepartment({ license: p.data.license as string }), want)
    assert.match(p.data.license as string, /^\d{13}$/)
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
  for (const k of ['units', 'events', 'groups', 'criteria', 'lists', 'config'] as const) for (const r of seed.tables[k]) assert.equal(r.scope, undefined, k)
})

t('postes du handball : les 7 codes de l\'appli, gardiens ~13 %, gauchers surtout à droite (AD, ARD), postes secondaires valables', () => {
  for (const p of players) {
    if (p.pos) assert.ok(CODES.includes(p.pos), p.pos)
    const sec = (p.data.secondaryPositions as string[] | undefined) ?? []
    for (const x of sec) assert.ok(CODES.includes(x) && x !== p.pos && x !== 'GB')
    if (p.pos === 'GB') assert.equal(sec.length, 0)
    assert.ok(['droitier', 'gaucher', 'ambidextre'].includes(p.data.laterality as string))
  }
  for (const c of CODES) assert.ok(s.positions[c] >= 6 && s.positions[c] <= 22, `${c} ${s.positions[c]}`)
  assert.ok(s.positions.GB >= 10 && s.positions.GB <= 17)
  assert.ok(s.leftHanded >= 9 && s.leftHanded <= 15, `gauchers ${s.leftHanded}`)
  for (const c of ['AD', 'ARD']) assert.ok(s.leftByPosition[c] > 40, `${c} ${s.leftByPosition[c]}`)
  for (const c of ['AG', 'ARG']) assert.ok(s.leftByPosition[c] < 6, `${c} ${s.leftByPosition[c]}`)
  // Sans poste : rare, surtout chez les plus jeunes.
  assert.ok(s.noPosition < 6)
  const noPos = (y: number) => players.filter((p) => p.year === y && !p.pos).length / players.filter((p) => p.year === y).length
  assert.ok(noPos(2014) > noPos(2009))
  // Les grands à l'arrière et au pivot, les plus petits à l'aile (potentiel de taille).
  const meanA = (c: string) => { const ps = players.filter((p) => p.pos === c); return ps.reduce((a, p) => a + p.A, 0) / ps.length }
  assert.ok(meanA('PIV') > meanA('DC') && meanA('ARG') > meanA('AG') && meanA('ARD') > meanA('AD'))
})

t('catégories du handball (U13, U15, U18 de src/sportContent.ts) : âges de saison, tests seulement de 12 à 18 ans', () => {
  assert.deepEqual(CATS, ['U13', 'U15', 'U18'])
  for (const y of YEARS)
    for (const d of ['2024-11-09', '2025-03-15', '2025-10-11', '2026-06-13', TODAY]) {
      const a = seasonAge(y, d)
      const cat = SPORT_CONTENT.handball.youthCategories.find((c) => c.ages.includes(a))
      if (cat) assert.equal(categoryOf(y, d), cat.code, `${y} ${d}`)
    }
  assert.equal(seasonAge(2014, TODAY), 13)
  assert.equal(categoryOf(2014, TODAY), 'U13')
  assert.equal(categoryOf(2012, TODAY), 'U15')
  assert.equal(categoryOf(2009, TODAY), 'U18')
  const ages = new Set(SPORT_CONTENT.handball.youthCategories.flatMap((c) => c.ages))
  for (const r of seed.tables.measurements) assert.ok(ages.has(seasonAge(byId.get(r.data.playerId as string)!.year, r.data.date as string)))
})

t('filles et garçons : ~37 % de filles, chaque génération de 30 à 45 % ; pôles, sélections et textes accordés au sexe', () => {
  assert.ok(s.girls >= 33 && s.girls <= 40, `filles ${s.girls}`)
  for (const y of YEARS) {
    const g = (s.byYear as Record<number, { girls: number }>)[y].girls
    assert.ok(g >= 30 && g <= 45, `${y} : ${g}`)
  }
  for (const g of seed.tables.groups) {
    const d = g.data as { sex: 'M' | 'F'; description: string; poleUnitId?: string; playerIds: string[] }
    if (d.poleUnitId) assert.match(d.description, d.sex === 'F' ? /^Pôle Espoirs féminin / : /^Pôle Espoirs masculin /)
    else {
      assert.match(d.description, d.sex === 'F' ? /joueuses fictives\)$/ : /joueurs fictifs\)$/)
      for (const id of d.playerIds) assert.equal(byId.get(id)!.sex, d.sex)
    }
  }
  // Avis : adjectifs accordés au sexe du joueur (src/gender.ts).
  for (const r of seed.tables.evaluations) {
    const p = byId.get(r.data.playerId as string)!
    const txt = (r.data.strengths as string | undefined) ?? ''
    // Mots entiers (\b ne connaît pas les lettres accentuées).
    if (p.sex === 'F') assert.doesNotMatch(txt, /(?<!\p{L})(Puissant|Explosif|appliqué|concentré|naturel)(?!\p{L})/u, txt)
    else assert.doesNotMatch(txt, /(?<!\p{L})(Puissante|Explosive|appliquée|concentrée|naturelle)(?!\p{L})/u, txt)
  }
  for (const e of seed.events) if (e.sex === 'F' || e.sex === 'M') assert.ok(e.roster.every((p) => p.sex === e.sex), e.name)
})

t('aucune étiquette négative : ni « pas retenu » ni motif de sortie négatif, textes positifs ou « À travailler : »', () => {
  const tables = ['players', 'events', 'groups', 'measurements', 'evaluations', 'seen', 'videos', 'units'] as const
  for (const k of tables) {
    const txt = JSON.stringify(seed.tables[k])
    assert.doesNotMatch(txt, /retenu|refus|exclu|exclusion|abandon|blessure|insuffisant|médiocre|mauvais|faible|décevant/i, k)
  }
  for (const p of players) {
    assert.ok(!('review' in p.data) && !('deleted' in p.data))
    for (const x of (p.data.poles as PolePeriod[] | undefined) ?? []) if (x.to || x.exitReason) assert.equal(x.exitReason, 'fin_cursus')
  }
  for (const r of seed.tables.evaluations) {
    const d = r.data as { strengths?: string; improvements?: string }
    if (d.improvements) assert.match(d.improvements, /^À travailler : /)
    if (d.strengths) assert.doesNotMatch(d.strengths, /\b(pas|faible|nul|insuffisant|mauvais|lent)\b/i)
  }
  for (const p of players) assert.ok(!FAMOUS.has(fold(`${p.data.firstName} ${p.data.lastName}`)))
})

t('effet de l\'âge relatif : un peu plus de naissances au 1er trimestre, beaucoup plus aux pôles', () => {
  const [q1, , , q4] = s.quarters.all
  assert.ok(q1 > q4 && q1 < 30, JSON.stringify(s.quarters.all))
  assert.ok(s.quarters.poles[0] > 33 && s.quarters.poles[3] < 18, JSON.stringify(s.quarters.poles))
  assert.ok(s.quarters.seen[0] > s.quarters.all[0], 'les vus sont plus souvent nés en début d\'année')
})

t('« vu » : joueurs de la liste de l\'événement, événements passés, plus de U18 que de U13, départements en retard', () => {
  const events = new Map(seed.events.map((e) => [e.id, e]))
  const gb = STAFF.find((x) => x.keepers)!
  for (const r of seed.tables.seen) {
    const e = events.get(r.data.eventId as string)!
    assert.ok(e && !upcoming(e))
    assert.ok(e.roster.some((p) => p.id === r.data.playerId))
    assert.equal(r.id, `${r.data.createdBy}:${r.data.eventId}:${r.data.playerId}`)
    assert.ok((r.data.at as string) <= `${TODAY}T23:59`)
    if (r.data.createdBy === gb.id) assert.equal(byId.get(r.data.playerId as string)!.pos, 'GB', 'l\'entraîneur des gardiens ne marque que des gardiens')
  }
  for (const e of seed.events) if (upcoming(e)) assert.ok(!seed.tables.seen.some((r) => r.data.eventId === e.id) && !seed.tables.evaluations.some((r) => r.data.eventId === e.id))
  const y = s.byYear as Record<number, { seen: number }>
  assert.ok((y[2009].seen + y[2010].seen) / 2 > (y[2013].seen + y[2014].seen) / 2 + 5, JSON.stringify(y))
  for (const d of s.deptsLeastSeen.slice(0, 5)) assert.ok(d.seen < 5)
  assert.ok([...BEHIND].filter((c) => s.deptsLeastSeen.some((d) => d.code === c)).length >= 3)
  assert.ok(s.deptsMostSeen[0].seen > 20)
})

t('tests physiques : dans les fourchettes de la catégorie, taille jamais en baisse, triplet de maturité le même jour', () => {
  const ranges = (p: SeedPlayer, day: string) => RANGES[p.sex][categoryOf(p.year, day)]
  const byCrit = new Map(Object.entries(RANGE_CRITERION).map(([k, c]) => [c, k as keyof (typeof RANGES)['F']['U13']]))
  const byPlayer = new Map<string, Map<string, Record<string, number>>>()
  for (const r of seed.tables.measurements) {
    const d = r.data as { playerId: string; criterionId: string; value: number; date: string }
    const p = byId.get(d.playerId)!
    const key = byCrit.get(d.criterionId)
    if (key) {
      const [a, b] = ranges(p, d.date)[key]
      assert.ok(d.value >= Math.min(a, b) && d.value <= Math.max(a, b), `${d.criterionId} ${d.value} ${p.sex} ${categoryOf(p.year, d.date)}`)
    }
    if (PHYSIO.includes(d.criterionId)) assert.ok(Number.isInteger(d.value) && d.value >= 1 && d.value <= 5)
    const m = byPlayer.get(d.playerId) ?? new Map()
    m.set(d.date, { ...(m.get(d.date) ?? {}), [d.criterionId]: d.value })
    byPlayer.set(d.playerId, m)
  }
  const crit = new Map(seed.tables.criteria.map((r) => [r.id, r.data as { kind: string; scale: string }]))
  for (const r of seed.tables.measurements) assert.equal(crit.get(r.data.criterionId as string)?.kind, 'factual', r.data.criterionId as string)
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
      if (v.sprint_10 !== undefined && v.sprint_30 !== undefined) assert.ok(v.sprint_10 < v.sprint_30)
    }
    assert.ok(days.size >= 1 && days.size <= 3)
  }
  assert.ok(s.measuredPlayers >= 18 && s.measuredPlayers <= 32, `mesurés ${s.measuredPlayers} %`)
  assert.ok(sessions > 8000)
})

t('corrélations : taille ↔ envergure, poids ; sprint 10 m ↔ 30 m ; grand saut ↔ CMJ', () => {
  const rows = new Map<string, Record<string, number>>()
  for (const r of seed.tables.measurements) {
    const d = r.data as { playerId: string; criterionId: string; value: number; date: string }
    const k = `${d.playerId}|${d.date}`
    rows.set(k, { ...(rows.get(k) ?? {}), [d.criterionId]: d.value })
  }
  const pairs: Record<string, number[][]> = { env: [], poids: [], sprint: [], saut: [] }
  for (const [k, v] of rows) {
    const p = byId.get(k.split('|')[0])!
    if (p.sex !== 'M' || categoryOf(p.year, k.split('|')[1]) !== 'U15') continue
    if (v.envergure) pairs.env.push([v.taille, v.envergure])
    pairs.poids.push([v.taille, v.poids])
    if (v.sprint_10 && v.sprint_30) pairs.sprint.push([v.sprint_10, v.sprint_30])
    if (v.saut_bilateral && v.cmj_hauteur) pairs.saut.push([v.saut_bilateral, v.cmj_hauteur])
  }
  const corr = (xy: number[][]) => {
    const k = xy.length
    const mx = xy.reduce((a, [x]) => a + x, 0) / k
    const my = xy.reduce((a, [, y]) => a + y, 0) / k
    const c = xy.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0)
    return c / Math.sqrt(xy.reduce((a, [x]) => a + (x - mx) ** 2, 0) * xy.reduce((a, [, y]) => a + (y - my) ** 2, 0))
  }
  assert.ok(corr(pairs.env) > 0.9, `taille-envergure ${corr(pairs.env)}`)
  assert.ok(corr(pairs.poids) > 0.5, `taille-poids ${corr(pairs.poids)}`)
  assert.ok(corr(pairs.sprint) > 0.6, `sprints ${corr(pairs.sprint)}`)
  assert.ok(corr(pairs.saut) > 0.5, `sauts ${corr(pairs.saut)}`)
})

t('maturité et taille adulte prédite (calculs de l\'appli) : Mirwald à chaque séance, Khamis-Roche plausible', () => {
  const ms = new Map<string, Measurement[]>()
  for (const r of seed.tables.measurements) ms.set(r.data.playerId as string, [...(ms.get(r.data.playerId as string) ?? []), r.data as unknown as Measurement])
  let kr = 0
  for (const [pid, list] of ms) {
    const p = byId.get(pid)!
    const snaps = snapshots(p.data as unknown as Player, list)
    assert.ok(snaps.length >= 1)
    for (const x of snaps) {
      assert.ok(x.mirwald !== null, `Mirwald calculable (${pid} ${x.date})`)
      if (x.kr) {
        kr++
        const [lo, hi] = p.sex === 'F' ? [150, 192] : [163, 210]
        assert.ok(x.kr.predicted > lo && x.kr.predicted < hi, `taille prédite ${Math.round(x.kr.predicted)} (${p.sex})`)
        assert.ok(x.kr.pah > 75 && x.kr.pah < 106, `% de la taille adulte ${x.kr.pah}`)
      }
    }
  }
  assert.ok(kr > 2000, `${kr} prédictions de taille`)
})

t('avis : grille du handball selon le poste (gardiens : critères du gardien), notes de 1 à 5 centrées sur 3', () => {
  const crit = new Map(seed.tables.criteria.map((r) => [r.id, r.data as { positions?: string[]; kind: string }]))
  const events = new Set(seed.tables.events.map((r) => r.id))
  const gb = STAFF.find((x) => x.keepers)!
  let keepers = 0
  for (const r of seed.tables.evaluations) {
    const d = r.data as { playerId: string; eventId: string; scores: Record<string, number>; observer: string; observerId: string; createdByName: string }
    const p = byId.get(d.playerId)!
    assert.ok(p && events.has(d.eventId))
    assert.equal(d.observer, d.createdByName)
    if (d.observerId === gb.id) assert.equal(p.pos, 'GB')
    if (p.pos === 'GB') keepers++
    for (const [c, v] of Object.entries(d.scores)) {
      const def = crit.get(c)
      assert.ok(def && def.kind === 'subjective', c)
      assert.ok(Number.isInteger(v) && v >= 1 && v <= 5)
      if (def.positions?.length) assert.ok(!!p.pos && def.positions.includes(p.pos), `${c} pour ${p.pos ?? 'sans poste'}`)
      if (c.startsWith('gb_')) assert.equal(p.pos, 'GB')
    }
  }
  assert.ok(keepers > 80, `${keepers} avis de gardiens`)
  assert.ok(s.evalMean > 2.8 && s.evalMean < 3.4, `moyenne ${s.evalMean}`)
  assert.ok(s.scoreDist[4] > 3 && s.scoreDist[4] < 15, 'quelques 5 (profils remarquables)')
})

t('événements : tournois aux équipes complètes, numéros de maillot (gardiens 1, 12, 16), organisateurs dans la structure', () => {
  const units = new Set(seed.tables.units.map((r) => r.id))
  for (const e of seed.events) {
    assert.ok(units.has(e.organizerId), e.name)
    assert.equal(new Set(e.roster.map((p) => p.id)).size, e.roster.length, `doublon dans ${e.name}`)
    if (!e.tournament) continue
    const teams = new Set(e.tournament.teams.map((x) => x.id))
    assert.equal(Object.keys(e.tournament.players).length, e.roster.length)
    for (const p of e.roster) {
      const tp = e.tournament.players[p.id]
      assert.ok(tp && teams.has(tp.team), e.name)
      if (p.pos === 'GB') assert.ok(['1', '12', '16', '99'].includes(tp.num))
    }
    for (const team of teams) {
      const nums: string[] = Object.values(e.tournament.players).filter((x) => x.team === team).map((x) => x.num)
      assert.equal(new Set(nums).size, nums.length, `numéros uniques ${e.name} ${team}`)
    }
  }
  const j = jerseys([{ i: 1, pos: 'GB' }, { i: 2, pos: 'DC' }, { i: 3, pos: 'GB' }] as SeedPlayer[])
  assert.deepEqual([...j.values()], ['1', '2', '12'])
})

t('pôles : les 51 sites de src/poles.ts, reconnus par l\'appli (poleSeason), effectifs de 10 à 20, du territoire du pôle', () => {
  const units = seed.tables.units.map((r) => r.data as unknown as UnitRow)
  const regions = Object.keys(OFFICIAL_REGIONS).map((id) => ({ id, name: id }))
  const refs = poleRefsOf(units, HANDBALL_LEVELS, { regions, regionOfDept: (d) => deptRegion.get(d) })
  assert.equal(refs.size, POLE_SITES.length)
  for (const site of POLE_SITES) {
    const u = units.find((x) => x.code === poleCode(site))!
    assert.ok(u, site.site)
    assert.equal(u.name, poleName(site))
    assert.equal(refs.get(u.id)!.regionId, site.regions[0], site.site)
    assert.ok(site.regions.includes(deptRegion.get(SITE_DEPT[site.site])!), `département du site ${site.site}`)
  }
  const groups = seed.tables.groups.filter((r) => r.data.poleUnitId)
  assert.equal(groups.length, POLE_SITES.length)
  const fiches = players.map((p) => ({ id: p.id, sex: p.sex, poles: p.data.poles as PolePeriod[] | undefined, p }))
  const counted = new Set<string>()
  for (const g of groups) {
    const ref = refs.get(g.data.poleUnitId as string)!
    const site = POLE_SITES.find((x) => poleCode(x) === units.find((u) => u.id === ref.unitId)!.code)!
    assert.equal(ref.regionId, g.data.regionId)
    const members = membersAt(fiches, { ...ref, sex: site.sex }, TODAY)
    assert.ok(members.length >= 10 && members.length <= 20, `${g.data.name} : ${members.length}`)
    const years = siteYears(site.levels)
    for (const m of members) {
      assert.ok(!counted.has(m.id), 'un seul pôle à la fois')
      counted.add(m.id)
      assert.ok(years.includes(m.p.year))
      const age = schoolAge(m.p.year, 2026)
      assert.ok(site.levels.some((l) => age >= PROGRAMME_AGES[l][0] && age <= PROGRAMME_AGES[l][1]), `${site.site} ${m.p.year}`)
      assert.ok(site.regions.includes(m.p.region), `${m.p.region} au pôle ${site.site}`)
      assert.equal(m.p.sex, g.data.sex)
      assert.ok(m.p.pos)
    }
  }
  assert.equal(counted.size, s.poles.now)
  const sel = seed.tables.groups.filter((r) => !r.data.poleUnitId)
  assert.equal(sel.length, 3)
  for (const g of sel) assert.ok((g.data.playerIds as string[]).every((id) => byId.get(id)!.region === g.data.regionId))
})

t('SQL : apostrophes doublées, écriture idempotente, contrôles des fourchettes et du sport', () => {
  const sql = upsertSql('players', [{ id: 'x', data: { id: 'x', club: "Union Handball de L'Isle-Adam" } }])
  assert.match(sql, /L''Isle-Adam/)
  assert.match(sql, /on conflict \(id\) do update/)
  const v = verifySql()
  assert.match(v, /\('M','U18','sprint_10',1\.68,1\.98\)/)
  assert.match(v, /then 'U13'/)
  assert.match(v, /hb_config/)
})

console.log(`\n${n} tests OK`)
