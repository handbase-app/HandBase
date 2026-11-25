// Test de la sélection de plusieurs groupes de la page Groupes (src/groupPick.ts) : qui peut être coché (droits, groupes
// Pôle), groupes sur lesquels l'action porte (filtre), Archiver / Désarchiver, compteur, textes des confirmations
// (accord au genre), recherche dans les groupes de travail.
//
//   npx jiti tools/test-groupes-selection.ts
import assert from 'node:assert/strict'
import { archiveMode, bulkConfirm, groupPickBlock, pickedLabel, pickedOf, workGroupMatches, workGroupPickBlock } from '../src/groupPick'

// ---------- Qui peut être coché ----------
assert.equal(groupPickBlock({}, true), null)
assert.equal(groupPickBlock({ private: true }, true), null)
// Groupe Pôle : jamais coché, même pour qui le dirige.
assert.match(groupPickBlock({ poleUnitId: 'u1' }, true)!, /Pôle/)
assert.match(groupPickBlock({ poleUnitId: 'u1', private: true }, false)!, /Pôle/)
// Pas le droit de le modifier : la raison dépend de sa visibilité.
assert.equal(groupPickBlock({ private: true }, false), 'Géré par son créateur')
assert.equal(groupPickBlock({ team: true }, false), 'Géré par son créateur')
assert.equal(groupPickBlock({}, false), 'Géré par son créateur ou un administrateur')
assert.equal(workGroupPickBlock(true), null)
assert.equal(workGroupPickBlock(false), 'Géré par son créateur')

// ---------- Groupes sur lesquels l'action porte : cochés, affichés, cochables, dans l'ordre de la liste ----------
const gs = [{ id: 'a' }, { id: 'b', pole: true }, { id: 'c' }, { id: 'd' }]
const block = (g: { pole?: boolean }) => (g.pole ? 'Pôle' : null)
assert.deepEqual(
  pickedOf(['d', 'a', 'b', 'zz'], gs, block).map((g) => g.id),
  ['a', 'd'],
)
// Caché par le filtre : hors de l'action (reste coché pour plus tard).
assert.deepEqual(
  pickedOf(['a', 'c'], gs.slice(2), block).map((g) => g.id),
  ['c'],
)
assert.deepEqual(pickedOf([], gs, block), [])

// ---------- Archiver ou désarchiver ----------
assert.equal(archiveMode([]), 'archive')
assert.equal(archiveMode([{ archived: true }, {}]), 'archive')
assert.equal(archiveMode([{ archived: true }, { archived: true }]), 'unarchive')

// ---------- Compteur ----------
assert.equal(pickedLabel('joueurs', 0), 'Aucun groupe sélectionné')
assert.equal(pickedLabel('joueurs', 1), '1 groupe sélectionné')
assert.equal(pickedLabel('joueurs', 3), '3 groupes sélectionnés')
assert.equal(pickedLabel('travail', 1), '1 groupe de travail sélectionné')
assert.equal(pickedLabel('travail', 2), '2 groupes de travail sélectionnés')
assert.equal(pickedLabel('joueurs', 1200), '1 200 groupes sélectionnés')

// ---------- Confirmations ----------
const g3 = [{ name: 'A', sex: 'M' }, { name: 'B', sex: 'F' }, { name: 'C' }]
let c = bulkConfirm('joueurs', 'archive', g3)
assert.equal(c.ok, 'Archiver')
assert.equal(c.message, 'Archiver 3 groupes ? Ils restent consultables dans « Archivés ».')
c = bulkConfirm('joueurs', 'archive', [{ name: 'U13 Var' }])
assert.equal(c.message, 'Archiver le groupe « U13 Var » ? Il reste consultable dans « Archivés ».')
c = bulkConfirm('joueurs', 'unarchive', g3.slice(0, 2))
assert.equal(c.ok, 'Désarchiver')
assert.equal(c.message, 'Désarchiver 2 groupes ? Ils reviennent dans la liste.')
c = bulkConfirm('joueurs', 'delete', g3.slice(0, 2))
assert.equal(c.ok, 'Supprimer')
assert.equal(c.message, 'Supprimer 2 groupes ? Les joueurs ne sont pas supprimés : ils gardent leur fiche ; les avis et les événements ne sont pas touchés.')
// Tous des groupes de filles : accord au féminin.
c = bulkConfirm('joueurs', 'delete', [{ name: 'F1', sex: 'F' }, { name: 'F2', sex: 'F' }])
assert.equal(c.message, 'Supprimer 2 groupes ? Les joueuses ne sont pas supprimées : elles gardent leur fiche ; les avis et les événements ne sont pas touchés.')
c = bulkConfirm('joueurs', 'delete', [{ name: 'Pôle 2011', sex: 'M' }])
assert.match(c.message, /^Supprimer le groupe « Pôle 2011 » \? Les joueurs ne sont pas supprimés/)
c = bulkConfirm('travail', 'delete', [{ name: 'ETD Var' }, { name: 'ETD 06' }])
assert.equal(c.ok, 'Supprimer')
assert.match(c.message, /^Supprimer 2 groupes de travail \? Leurs membres perdent l’accès qu’ils leur donnaient/)
c = bulkConfirm('travail', 'delete', [{ name: 'ETD Var' }])
assert.match(c.message, /^Supprimer le groupe de travail « ETD Var » \? Ses membres perdent l’accès qu’il leur donnait/)
// Jamais de mot négatif sur les joueurs (pas de « retirés », « écartés »…).
for (const a of ['archive', 'unarchive', 'delete'] as const) assert.doesNotMatch(bulkConfirm('joueurs', a, g3).message, /retenu|écart|refus/)

// ---------- Recherche dans les groupes de travail ----------
const t = { name: 'ETD Drôme', description: 'Encadrement départemental', createdByName: 'Paul Martin', names: { u1: 'Léa Bernard', u2: 'Hugo Petit' } }
assert.equal(workGroupMatches(t, ''), true)
assert.equal(workGroupMatches(t, '   '), true)
assert.equal(workGroupMatches(t, 'drome'), true)
assert.equal(workGroupMatches(t, 'ETD DRÔME'), true)
assert.equal(workGroupMatches(t, 'departemental'), true)
assert.equal(workGroupMatches(t, 'lea'), true)
assert.equal(workGroupMatches(t, 'hugo etd'), true)
assert.equal(workGroupMatches(t, 'martin'), true)
assert.equal(workGroupMatches(t, 'var'), false)
assert.equal(workGroupMatches(t, 'hugo var'), false)
assert.equal(workGroupMatches({ name: 'Gardiens' }, 'gard'), true)

console.log('test-groupes-selection : OK')
