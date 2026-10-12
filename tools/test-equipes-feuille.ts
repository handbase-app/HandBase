// Test des deux équipes d'un match importé d'une feuille (src/sheetTeams.ts), sur des joueurs fictifs.
//
//   npx jiti tools/test-equipes-feuille.ts
import assert from 'node:assert/strict'
import { cleanNum, sheetPlayersWithoutTeam, teamsFromSheet } from '../src/sheetTeams'

let n = 0
const makeId = () => `t${++n}`
const sheet = {
  home: 'HBC Exemple',
  away: 'AS Fictive',
  players: [
    { side: 'home' as const, num: '1', playerId: 'a', gk: true },
    { side: 'home' as const, num: '7', playerId: 'b' },
    { side: 'away' as const, num: '12', playerId: 'c' },
    { side: 'away' as const, num: '99999', playerId: 'd' }, // numéro refusé par le serveur
    { side: 'away' as const, num: '5', playerId: 'hors-liste' },
    { side: 'home' as const, num: '9' }, // pas relié
  ],
}
const ids = ['a', 'b', 'c', 'd', 'x']

// Sans répartition : deux équipes, chacun dans la sienne avec son numéro.
const t1 = teamsFromSheet(undefined, sheet, ids, makeId)
assert.deepEqual(t1.teams, [
  { id: 'locaux', name: 'HBC Exemple' },
  { id: 'visiteurs', name: 'AS Fictive' },
])
assert.deepEqual(t1.players, { a: { team: 'locaux', num: '1' }, b: { team: 'locaux', num: '7' }, c: { team: 'visiteurs', num: '12' }, d: { team: 'visiteurs' } })
assert.equal(sheetPlayersWithoutTeam(t1, sheet, ids), 0)
assert.equal(sheetPlayersWithoutTeam(undefined, sheet, ids), 4)

// Répartition existante : équipe du même nom reprise (casse ignorée), choix à la main gardés, observateurs gardés,
// identifiant « locaux » déjà pris par une autre équipe.
const t2 = teamsFromSheet(
  {
    teams: [
      { id: 'locaux', name: 'Autre équipe' },
      { id: 'tabc', name: 'as fictive' },
    ],
    players: { a: { team: 'tabc', num: '3' }, b: { num: '70' } },
    assign: { u1: ['tabc'] },
  },
  sheet,
  ids,
  makeId,
)
assert.deepEqual(t2.teams.map((t) => t.name), ['Autre équipe', 'as fictive', 'HBC Exemple'])
const home = t2.teams[2].id
assert.match(home, /^t\d+$/)
assert.deepEqual(t2.players, { a: { team: 'tabc', num: '3' }, b: { team: home, num: '70' }, c: { team: 'tabc', num: '12' }, d: { team: 'tabc' } })
assert.deepEqual(t2.assign, { u1: ['tabc'] })

// Équipe disparue : le joueur est de nouveau rangé.
const t3 = teamsFromSheet({ teams: [], players: { c: { team: 'vieille', num: '4' } } }, sheet, ids, makeId)
assert.deepEqual(t3.players?.c, { team: 'visiteurs', num: '4' })

// Noms absents : « Locaux » / « Visiteurs » ; même nom des deux côtés : deux équipes distinctes.
assert.deepEqual(teamsFromSheet(undefined, { home: '', away: ' ', players: [] }, [], makeId).teams.map((t) => t.name), ['Locaux', 'Visiteurs'])
const twins = teamsFromSheet(undefined, { home: 'Club', away: 'Club', players: [] }, [], makeId).teams
assert.equal(twins.length, 2)
assert.notEqual(twins[0].id, twins[1].id)

// Rejouer ne change rien.
assert.deepEqual(teamsFromSheet(t1, sheet, ids, makeId), t1)

assert.equal(cleanNum(' 10 '), '10')
assert.equal(cleanNum('1-2'), undefined)
console.log('Équipes de la feuille de match : OK')
