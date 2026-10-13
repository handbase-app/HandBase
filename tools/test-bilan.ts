// Test du bilan de détection (src/coverage.ts), sur des joueurs fictifs.
//
//   npx jiti tools/test-bilan.ts
import assert from 'node:assert/strict'
import { coverageByYear, fedReport, lastSights, percent, seasonOf, toSights, totalOf } from '../src/coverage'

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

console.log('Bilan de détection : tous les tests passent.')
