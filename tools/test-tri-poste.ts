// Test du rangement par poste d'une liste de joueurs (src/positionOrder.ts), commun à la page d'un événement et à celle
// d'un groupe : ordre du terrain, tri dans chaque poste, titres, numérotation continue, pastilles, filtre d'un poste.
//
//   npx jiti tools/test-tri-poste.ts
import assert from 'node:assert/strict'
import type { Player, Position } from '../src/db'
import { groupRosterKey, positionRosterView, rosterPositions, rosterSections, sortRoster } from '../src/positionOrder'

// Joueurs fictifs, dans l'ordre d'ajout.
const mk = (id: string, lastName: string, position?: string, extra: Partial<Player> = {}) =>
  ({ id, lastName, firstName: 'Test', position: position as Position | undefined, ...extra }) as Player
const list = [
  mk('a', 'Zed', 'PIV', { club: 'Alpha', birthDate: '2010-05-01' }),
  mk('b', 'Brun', 'GB', { club: 'Gamma', birthDate: '2011-01-01' }),
  mk('c', 'Alix', undefined),
  mk('d', 'Moreau', 'AG', { club: 'Beta', birthDate: '2009-03-01' }),
  mk('e', 'Abel', 'AG', { birthDate: '2010-01-01' }),
  mk('f', 'Aaron', 'GB', { club: 'Alpha' }),
]
const ids = (l: Player[]) => l.map((p) => p.id).join('')

// Par poste (gardien, ailier gauche… pivot, puis sans poste), nom dans chaque poste
assert.equal(ids(sortRoster(list, 'nom')), 'fbedac')
// Ordre d'ajout dans chaque poste
assert.equal(ids(sortRoster(list, 'ajout')), 'bfdeac')
// Naissance : les plus âgés d'abord, date inconnue à la fin du poste
assert.equal(ids(sortRoster(list, 'naissance')), 'bfdeac')
// Club : club absent à la fin du poste
assert.equal(ids(sortRoster(list, 'club')), 'fbdeac')

// Titres et numérotation continue
const secs = rosterSections(sortRoster(list, 'nom'), true)
assert.deepEqual(
  secs.map((s) => [s.heading, s.start, ids(s.players)]),
  [
    ['Gardien', 0, 'fb'],
    ['Ailier gauche', 2, 'ed'],
    ['Pivot', 4, 'a'],
    ['Sans poste', 5, 'c'],
  ],
)
// Aucun poste renseigné : un seul morceau, sans titre
assert.deepEqual(
  rosterSections([mk('x', 'X'), mk('y', 'Y')], false).map((s) => [s.heading, s.start, s.players.length]),
  [[null, 0, 2]],
)

// Pastilles : postes présents, ordre du terrain, nombre de joueurs
assert.deepEqual(
  rosterPositions(list).map((x) => [x.id, x.short, x.n]),
  [
    ['GB', 'Gardien', 2],
    ['AG', 'Ailier G.', 2],
    ['PIV', 'Pivot', 1],
  ],
)

// Vue d'un groupe : tous triés (colonne de contexte, export), affichés filtrés sur un poste
const v = positionRosterView(list, 'nom', 'AG' as Position)
assert.equal(ids(v.roster), 'fbedac')
assert.equal(ids(v.shown), 'ed')
assert.deepEqual(v.sections.map((s) => [s.heading, s.start]), [['Ailier gauche', 0]])
assert.equal(v.positions.length, 3)
const all = positionRosterView(list, 'nom')
assert.equal(ids(all.sections.flatMap((s) => s.players)), ids(all.roster))
// Sans aucun poste renseigné : pas de titre
assert.deepEqual(positionRosterView([mk('x', 'X')], 'nom').sections.map((s) => s.heading), [null])

// Clé du tri mémorisé d'un groupe : distincte de celle d'un événement (son id)
assert.equal(groupRosterKey('g1'), 'groupe.g1')

console.log('test-tri-poste : OK')
