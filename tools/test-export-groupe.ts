// Test de l'export d'un groupe en PDF (src/groupExport.ts), sur des joueurs fictifs : répartition « déjà au pôle » /
// « nouveaux », colonnes, données incomplètes, tri, recherche et totaux.
//
//   npx jiti tools/test-export-groupe.ts
import assert from 'node:assert/strict'
import {
  cellText,
  cssString,
  isMixed,
  matchesSearch,
  missingOf,
  poleChoices,
  poleKey,
  poleStatusLabel,
  sectionTitles,
  sortRows,
  splitSections,
  stayOf,
  totalsByYear,
  type Row,
} from '../src/groupExport'

const day = '2026-10-13'
const SR = { regionId: 'region-sud', site: 'Saint-Raphaël', from: '2025-09-01' }
const AIX = { regionId: 'region-sud', site: 'Aix-en-Provence', from: '2025-09-01' }
type P = Row['p']
const P = (id: string, lastName: string, birthDate: string | undefined, sex: 'M' | 'F' | undefined, poles: P['poles'] = [], extra: Partial<P> = {}): P => ({
  id,
  lastName,
  firstName: 'Prénom',
  birthDate,
  sex,
  poles,
  ...extra,
})
const players = [
  P('a', 'Martin', '2010-03-01', 'M', [SR]), // au pôle de Saint-Raphaël
  P('b', 'Durand', '2011-05-01', 'M', [{ ...SR, site: 'saint-raphael' }]), // même site, autre écriture
  P('c', 'Bernard', '2011-01-01', 'M'), // jamais en pôle
  P('d', 'Écuyer', '2010-07-01', 'M', [{ ...SR, to: '2026-06-30', exitReason: 'fin_cursus' }]), // sorti
  P('e', 'Petit', '2011-02-01', 'M', [AIX]), // autre pôle en cours
  P('f', 'Dubois', '2012-01-01', 'M', [{ ...SR, from: '2027-09-01' }]), // entrée à venir : pas encore au pôle
  P('g', 'Leroy', undefined, undefined, [SR]), // année et sexe inconnus
]
const rows: Row[] = players.map((p) => ({ p }))

// ---------- Pôle de référence et répartition ----------

// Le site cité dans le nom du groupe d'abord (« Saint-Raph »), même si un autre est plus représenté.
const choices = poleChoices(players, day, 'Pôle Saint-Raph 2027-2028')
assert.equal(choices[0].key, poleKey(SR))
assert.equal(choices[0].count, 3)
assert.equal(choices[0].label, 'Pôle Espoirs region-sud (Saint-Raphaël)')
assert.equal(poleChoices(players, day, 'Pôle Aix 2027')[0].key, poleKey(AIX))
// Sans site dans le nom : le plus représenté.
assert.equal(poleChoices(players, day, 'Sélection 2010')[0].key, poleKey(SR))
assert.deepEqual(poleChoices([P('z', 'Z', '2010', 'M')], day), [])

const target = choices[0].key
assert.equal(stayOf(players[0], day, target), 'reste')
assert.equal(stayOf(players[1], day, target), 'reste')
assert.equal(stayOf(players[2], day, target), 'nouveau')
assert.equal(stayOf(players[3], day, target), 'nouveau')
assert.equal(stayOf(players[4], day, target), 'nouveau') // autre pôle : nouvel arrivant dans celui-ci
assert.equal(stayOf(players[4], day, 'any'), 'reste') // « n'importe quel pôle »
assert.equal(stayOf(players[5], day, target), 'nouveau')
assert.equal(stayOf(players[0], day, undefined), 'nouveau') // aucun pôle de référence
// Choix à la main : l'emporte toujours.
assert.equal(stayOf(players[2], day, target, { c: 'reste' }), 'reste')
assert.equal(stayOf(players[0], day, target, { a: 'nouveau' }), 'nouveau')

const s = splitSections(rows, { today: day, target, overrides: { c: 'reste' } })
assert.deepEqual(
  s.stay.map((r) => r.p.id),
  ['c', 'b', 'g', 'a'], // Bernard, Durand, Leroy, Martin
)
assert.deepEqual(
  s.arrivals.map((r) => r.p.id),
  ['f', 'd', 'e'], // Dubois, Écuyer (accents ignorés), Petit
)

// ---------- Colonnes ----------

const full: Row = {
  p: P('x', 'Fictif', '2010-03-07', 'F', [SR], { position: 'GB', club: 'HBC Imaginaire', laterality: 'gaucher', license: '0000001', category: '-18 nat' }),
  height: 172.4,
}
assert.equal(cellText(full, 'nom', day), 'FICTIF')
assert.equal(cellText(full, 'naissance', day), '07/03/2010')
assert.equal(cellText(full, 'annee', day), '2010')
assert.equal(cellText(full, 'genre', day), 'F')
assert.equal(cellText(full, 'poste', day), 'Gardien de but')
assert.equal(cellText({ p: { ...full.p, position: 'ARD' } }, 'poste', day), 'Arrière droit')
assert.equal(cellText(full, 'taille', day), '172')
assert.equal(cellText(full, 'lateralite', day), 'Gauche')
assert.equal(cellText(full, 'niveau', day), '-18 nat')
assert.equal(cellText(full, 'pole', day), 'Pôle (Saint-Raphaël)')
assert.equal(poleStatusLabel(players[3], day), 'Ancien pôle (Saint-Raphaël)')
assert.equal(poleStatusLabel(players[5], day), '') // entrée à venir : rien encore
assert.equal(poleStatusLabel(players[2], day), '')
assert.equal(cellText({ p: P('y', 'Y', '2010', 'M') }, 'naissance', day), '2010') // année seule

// Données incomplètes : licence, date de naissance, taille, latéralité, poste, club.
assert.deepEqual(missingOf(full, day), [])
assert.deepEqual(missingOf({ ...full, p: { ...full.p, club: ' ', laterality: undefined } }, day), ['lateralite', 'club'])
assert.deepEqual(missingOf(rows[6], day), ['licence', 'naissance', 'taille', 'lateralite', 'poste', 'club'])

// ---------- Tri et recherche ----------

const ids = (rs: Row[]) => rs.map((r) => r.p.id)
assert.deepEqual(ids(sortRows(rows, { key: 'nom', dir: 'asc' }, day)), ['c', 'f', 'b', 'd', 'g', 'a', 'e'])
assert.deepEqual(ids(sortRows(rows, { key: 'nom', dir: 'desc' }, day)), ['e', 'a', 'g', 'd', 'b', 'f', 'c'])
// Date de naissance : aînés d'abord ; date inconnue à la fin dans les deux sens.
assert.deepEqual(ids(sortRows(rows, { key: 'naissance', dir: 'asc' }, day)), ['a', 'd', 'c', 'e', 'b', 'f', 'g'])
assert.deepEqual(ids(sortRows(rows, { key: 'naissance', dir: 'desc' }, day)), ['f', 'b', 'e', 'c', 'd', 'a', 'g'])
// Taille en nombre (95 avant 172), absente à la fin ; poste dans l'ordre du terrain.
const tall: Row[] = [
  { p: P('t1', 'Un', '2010-01-01', 'M', [], { position: 'PIV' }), height: 172 },
  { p: P('t2', 'Deux', '2010-01-01', 'M', [], { position: 'GB' }), height: 95 },
  { p: P('t3', 'Trois', '2010-01-01', 'M', [], { position: 'DC' }) },
]
assert.deepEqual(ids(sortRows(tall, { key: 'taille', dir: 'asc' }, day)), ['t2', 't1', 't3'])
assert.deepEqual(ids(sortRows(tall, { key: 'taille', dir: 'desc' }, day)), ['t1', 't2', 't3'])
assert.deepEqual(ids(sortRows(tall, { key: 'poste', dir: 'asc' }, day)), ['t2', 't3', 't1'])

assert.equal(matchesSearch(full, 'fictif'), true)
assert.equal(matchesSearch(full, 'imaginaire 0000001'), true)
assert.equal(matchesSearch(rows[3], 'ecuyer'), true) // sans accent
assert.equal(matchesSearch(full, 'martin'), false)
assert.equal(matchesSearch(full, ''), true)

// ---------- Totaux ----------

const t = totalsByYear(players)
assert.deepEqual(
  t.rows.map((r) => [r.year, r.M, r.F, r.other, r.total]),
  [
    ['2010', 2, 0, 0, 2],
    ['2011', 3, 0, 0, 3],
    ['2012', 1, 0, 0, 1],
    ['', 0, 0, 1, 1],
  ],
)
assert.deepEqual([t.total.M, t.total.F, t.total.other, t.total.total], [6, 0, 1, 7])

assert.equal(isMixed('M', players), false)
assert.equal(isMixed('mixte', players), true)
assert.equal(isMixed(undefined, [{ sex: 'M' }, { sex: 'F' }]), true)
assert.equal(sectionTitles([{ sex: 'F' }, { sex: 'F' }]).arrivals, 'Nouvelles arrivantes')
assert.equal(sectionTitles(players).stay, 'Joueurs déjà au pôle')
assert.equal(cssString('Pôle "A" \\ B'), '"Pôle \\"A\\" \\\\ B"')

console.log('Export de groupe : OK')
