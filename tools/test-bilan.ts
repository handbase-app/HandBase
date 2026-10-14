// Test du bilan de détection (src/coverage.ts), sur des joueurs fictifs.
//
//   npx jiti tools/test-bilan.ts
import assert from 'node:assert/strict'
import { byLeftToSee, coverageByClub, coverageByPlace, coverageByYear, DECLARED, fedReport, filterPlayers, isShare, lastSights, measureOf, NO_DEPT, percent, rankBy, seasonOf, sortClubs, staffMeasured, tallest, toSights, totalOf } from '../src/coverage'

// Saison : 1er septembre → 31 août.
assert.deepEqual(seasonOf('2026-10-12'), { from: '2026-09-01', to: '2027-08-31', label: '2026-2027' })
assert.deepEqual(seasonOf('2027-08-31'), { from: '2026-09-01', to: '2027-08-31', label: '2026-2027' })
assert.deepEqual(seasonOf('2026-09-01').label, '2026-2027')
assert.deepEqual(seasonOf('2026-08-31').label, '2025-2026')

const P = (id: string, birthDate: string | undefined, sex: 'M' | 'F' | undefined, club: string | undefined, extra = {}) => ({ id, birthDate, sex, club, ...extra })
const players = [
  P('a', '2011-03-02', 'M', 'HBC Exemple'),
  P('b', '2011-07-15', 'M', 'hbc exemple '), // même club, autre écriture
  P('c', '2011-01-20', 'F', 'AS Fictive'),
  P('d', '2011-11-01', 'F', undefined), // club non renseigné
  P('e', '2012-05-05', 'M', 'AS Fictive'),
  P('f', undefined, 'M', 'HBC Exemple'), // année inconnue
  P('g', '2012-02-02', undefined, 'AS Fictive'), // sexe non renseigné
  P('x', '2011-01-01', 'M', 'HBC Exemple', { deleted: true }), // supprimé : jamais compté
  P('y', '2011-01-01', 'M', 'HBC Exemple', { review: 'refused' }), // hors cadre : jamais compté
  P('z', '2011-01-01', 'M', 'HBC Exemple', { mergedInto: 'a' }), // fondu dans une autre fiche
]

const seen = [
  { eventId: 'ev1', playerId: 'a', at: '2026-09-20T10:00:00Z', updatedAt: 0 },
  { eventId: 'ev1', playerId: 'c', at: '2025-12-01T10:00:00Z', updatedAt: 0 }, // saison passée
  { eventId: 'ev1', playerId: 'e', at: '2026-10-01T10:00:00Z', updatedAt: 0, deleted: true }, // retiré
  { eventId: 'mort', playerId: 'g', at: '2026-10-01T10:00:00Z', updatedAt: 0 }, // événement supprimé
]
const evals = [
  { playerId: 'b', date: '2026-10-05', observer: 'Sophie' },
  { playerId: 'd', date: '2026-10-05', observer: 'Paul', review: 'refused' as const }, // hors cadre : ne compte pas
  { playerId: 'f', date: '2026-09-10', observer: 'Paul', review: 'pending' as const }, // en attente : vu quand même
]
const sights = toSights(seen, evals, { deadEvents: new Set(['mort']), nameOfSeen: () => 'toi' })
assert.equal(sights.length, 4)

const season = seasonOf('2026-10-12')
const inSeason = lastSights(sights, season)
const ever = lastSights(sights)
assert.deepEqual([...inSeason.keys()].sort(), ['a', 'b', 'f'])
assert.deepEqual([...ever.keys()].sort(), ['a', 'b', 'c', 'f'])
assert.equal(ever.get('b')?.by, 'Sophie')
assert.equal(ever.get('a')?.day, '2026-09-20')

// Par génération : la plus récente d'abord, année inconnue à la fin.
const ys = coverageByYear(players, inSeason)
assert.deepEqual(
  ys.map((y) => [y.year, y.seen, y.total]),
  [
    ['2012', 0, 2],
    ['2011', 2, 4],
    ['', 1, 1],
  ],
)
assert.deepEqual(totalOf(ys), { seen: 3, total: 7 })
// Clubs de 2011 : le plus de joueurs à voir d'abord, club non renseigné à la fin ; écritures d'un même club réunies.
const y2011 = ys.find((y) => y.year === '2011')!
assert.deepEqual(
  y2011.clubs.map((c) => [c.name, c.seen, c.total, c.toSee.map((p) => p.id)]),
  [
    ['AS Fictive', 0, 1, ['c']],
    ['HBC Exemple', 2, 2, []],
    ['', 0, 1, ['d']],
  ],
)
// Depuis toujours : c vu la saison passée compte.
assert.equal(coverageByYear(players, ever).find((y) => y.year === '2011')!.seen, 3)

// Filtre garçons / filles : un joueur sans sexe renseigné n'est compté que dans « tous ».
assert.deepEqual(totalOf(coverageByYear(players, inSeason, 'M')), { seen: 3, total: 4 })
assert.deepEqual(totalOf(coverageByYear(players, inSeason, 'F')), { seen: 0, total: 2 })

// Pourcentage : jamais 100 % tant qu'il reste quelqu'un à voir.
assert.equal(percent(199, 200), 99)
assert.equal(percent(0, 0), 0)
assert.equal(percent(3, 3), 100)

// Rapport : seulement des nombres (aucun identifiant de joueur).
const rep = fedReport(players, inSeason)
assert.deepEqual(rep.total, { M: { seen: 3, total: 4 }, F: { seen: 0, total: 2 }, all: { seen: 3, total: 7 } })
const r2011 = rep.years.find((y) => y.year === '2011')!
assert.deepEqual(
  r2011.clubs.map((c) => c.name),
  ['AS Fictive', 'HBC Exemple', ''],
)
assert.deepEqual(r2011.clubs[1], { name: 'HBC Exemple', M: { seen: 2, total: 2 }, F: { seen: 0, total: 0 }, all: { seen: 2, total: 2 } })
const text = JSON.stringify(rep)
for (const id of ['"a"', '"b"', '"c"', 'playerId', 'toSee']) assert.ok(!text.includes(id), `le rapport ne doit pas contenir ${id}`)

// ---------- Par lieu (carte) ----------
type TP = (typeof players)[number] & { department?: string }
const dept: Record<string, string> = { a: '83', b: '83', c: '13', e: '06', f: '75', g: '83' } // d : sans département
const place = {
  deptOf: (p: TP) => dept[p.id],
  regionOf: (d: string) => ({ '83': 'region-sud', '13': 'region-sud', '06': 'region-sud', '75': 'region-idf' })[d],
}
const all = filterPlayers(players as TP[], {}, place)
assert.equal(all.length, 7) // supprimés, hors cadre et fondus exclus
const pc = coverageByPlace(all, inSeason, place)
assert.deepEqual({ seen: pc.seen, total: pc.total }, { seen: 3, total: 7 })
assert.deepEqual(pc.byDept.get('83'), { seen: 2, total: 3 }) // a, b vus ; g à voir
assert.deepEqual(pc.byRegion.get('region-sud'), { seen: 2, total: 5 })
assert.deepEqual(pc.byRegion.get('region-idf'), { seen: 1, total: 1 })
assert.deepEqual(pc.noDept, { seen: 0, total: 1 })
// Régions : le plus de joueurs à voir d'abord.
assert.deepEqual(
  byLeftToSee(pc.byRegion).map(([r]) => r),
  ['region-sud', 'region-idf'],
)
// Filtres : année, sexe, région, département, département non renseigné.
assert.deepEqual(
  filterPlayers(players as TP[], { year: '2011' }, place).map((p) => p.id),
  ['a', 'b', 'c', 'd'],
)
assert.deepEqual(
  filterPlayers(players as TP[], { year: '' }, place).map((p) => p.id),
  ['f'],
)
assert.deepEqual(
  filterPlayers(players as TP[], { region: 'region-sud', sex: 'M' }, place).map((p) => p.id),
  ['a', 'b', 'e'],
)
assert.deepEqual(
  filterPlayers(players as TP[], { region: 'region-sud', dept: '83', year: '2011' }, place).map((p) => p.id),
  ['a', 'b'],
)
assert.deepEqual(
  filterPlayers(players as TP[], { dept: NO_DEPT }, place).map((p) => p.id),
  ['d'],
)
// Clubs d'un département, toutes années : même tri que par génération.
assert.deepEqual(
  coverageByClub(filterPlayers(players as TP[], { dept: '83' }, place), inSeason).map((c) => [c.name, c.seen, c.total]),
  [
    ['AS Fictive', 0, 1],
    ['HBC Exemple', 2, 2],
  ],
)
// Rapport par région : des nombres seulement ; '' pour les joueurs sans région.
const repPlace = fedReport(players as TP[], inSeason, place)
assert.deepEqual(
  repPlace.regions.map((r) => [r.region, r.all.seen, r.all.total]).sort(),
  [
    ['', 0, 1],
    ['region-idf', 1, 1],
    ['region-sud', 2, 5],
  ],
)
assert.deepEqual(rep.regions, []) // sans `place` : pas de régions

// ---------- Onglets de la carte : vus, licenciés, mesurés par le staff, profils repérés ----------
assert.deepEqual([isShare('vus'), isShare('mesures'), isShare('licencies'), isShare('reperes')], [true, true, false, false])
const t = { seen: 3, total: 12 }
assert.deepEqual([measureOf('vus', t), measureOf('mesures', t), measureOf('licencies', t), measureOf('reperes', t)], [0.25, 0.25, 12, 3])
assert.equal(measureOf('licencies', { seen: 0, total: 0 }), undefined) // aucun joueur : gris sur la carte
// Classement : parts → le plus de joueurs restant à voir ; nombres → la plus grande valeur, puis le plus de joueurs.
const rows: [string, { seen: number; total: number }][] = [
  ['83', { seen: 1, total: 10 }],
  ['13', { seen: 5, total: 20 }],
  ['06', { seen: 5, total: 8 }],
]
assert.deepEqual(rankBy('vus', rows).map(([k]) => k), ['13', '83', '06'])
assert.deepEqual(rankBy('licencies', rows).map(([k]) => k), ['13', '83', '06'])
assert.deepEqual(rankBy('reperes', rows).map(([k]) => k), ['13', '06', '83'])
const cl = [
  { key: '', name: '', seen: 9, total: 9 },
  { key: 'a', name: 'A', seen: 1, total: 5 },
  { key: 'b', name: 'B', seen: 2, total: 3 },
]
assert.deepEqual(sortClubs('reperes', cl).map((c) => c.key), ['b', 'a', ''])
assert.deepEqual(sortClubs('licencies', cl).map((c) => c.key), ['a', 'b', ''])
assert.equal(sortClubs('vus', cl), cl) // parts : l'ordre de coverageByClub
// Par onglet, coverageByClub range ses joueurs : « comptés » (seenPlayers) et les autres (toSee).
const staff = new Set(['a', 'c'])
const byClubStaff = coverageByClub(filterPlayers(players as TP[], {}), staff)
assert.deepEqual(byClubStaff.find((c) => c.key === 'hbc exemple')!.seenPlayers.map((p) => p.id), ['a'])

// Mesurés par le staff : les tailles déclarées à la licence ne comptent pas ; dernière taille connue.
const M = (playerId: string, value: number, date: string, author?: string, extra = {}) => ({ playerId, criterionId: 'taille', value, date, updatedAt: 0, author, ...extra })
const sm = staffMeasured([
  M('a', 170, '2026-01-01', 'Sophie'),
  M('a', 172, '2026-06-01', 'Sophie'),
  M('b', 180, '2026-01-01', DECLARED), // déclarée : pas une mesure du staff
  M('c', 160, '2026-01-01', 'Paul', { deleted: true }), // supprimée
])
assert.deepEqual([...sm.staff], ['a'])
assert.deepEqual([...sm.height], [
  ['a', 172],
  ['b', 180],
])
// Repli des profils repérés : 90e centile de la génération et du sexe (au moins 10 joueurs mesurés).
const gen = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, birthDate: '2011-01-01', sex: 'M' as const }))
const tall = tallest([...gen, { id: 'f1', birthDate: '2011-01-01', sex: 'F' }], new Map([...gen.map((p, i) => [p.id, 170 + i] as [string, number]), ['f1', 200]]))
assert.deepEqual([...tall], ['p8', 'p9']) // seuil : 178 ; la fille seule (groupe de 1) n'est pas comptée

console.log('Bilan de détection : tous les tests passent.')
