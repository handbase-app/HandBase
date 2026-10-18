// Test de la sélection multiple des listes de joueurs (src/selection.ts) : cocher, Tout / Aucun, garder ceux affichés,
// compteur (au-delà de « Afficher plus », hors du filtre), accords au féminin, confirmation, comparer, suivre,
// actions selon les droits, messages.
//
//   npx jiti tools/test-selection.ts
import assert from 'node:assert/strict'
import {
  canCompare,
  confirmText,
  doneMessage,
  followMode,
  keepOnly,
  needsConfirm,
  SEL_ACTIONS,
  selActions,
  selectAll,
  selectionLabel,
  selectionStats,
  setIds,
  toggleId,
} from '../src/selection'

// ---------- Cocher ----------
assert.deepEqual(toggleId([], 'a'), ['a'])
assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b'])
assert.deepEqual(toggleId(['a'], 'b'), ['a', 'b'])
assert.deepEqual(setIds(['a'], ['b', 'a', 'c', 'b'], true), ['a', 'b', 'c'])
assert.deepEqual(setIds(['a', 'b', 'c'], ['b', 'x'], false), ['a', 'c'])

// ---------- Tout : toute la liste filtrée, en plus de ce qui était coché (même hors du filtre) ----------
const all = Array.from({ length: 120 }, (_, i) => `p${i}`)
const shown = all.slice(0, 60)
assert.equal(selectAll([], all).length, 120)
assert.deepEqual(selectAll(['zz'], ['a', 'b']), ['zz', 'a', 'b'])
// Rien de nouveau : même contenu.
assert.deepEqual(selectAll(['a', 'b'], ['b', 'a']), ['a', 'b'])

// ---------- Compteur ----------
let st = selectionStats(selectAll([], all), all, shown)
assert.deepEqual(st, { n: 120, outside: 0, below: 60, allIn: true })
assert.equal(selectionLabel(st.n, st.outside, undefined, st.below), '120 joueurs sélectionnés · dont 60 plus bas (pas encore affichés)')
// Le filtre change : 2 cochés en sortent ; ils restent comptés.
st = selectionStats(['p1', 'p2', 'x1', 'x2'], all, shown)
assert.deepEqual(st, { n: 4, outside: 2, below: 0, allIn: false })
assert.equal(selectionLabel(st.n, st.outside), '4 joueurs sélectionnés · dont 2 hors du filtre')
// « Garder seulement ceux affichés ».
assert.deepEqual(keepOnly(['p1', 'x1', 'p2', 'x2'], all), ['p1', 'p2'])
// Liste vide : jamais « tout coché ».
assert.equal(selectionStats([], []).allIn, false)
// Doublons dans la liste (un joueur dans deux sections) : tout coché quand même.
assert.equal(selectionStats(['a', 'b'], ['a', 'b', 'a']).allIn, true)

// ---------- Accords ----------
assert.equal(selectionLabel(0, 0), 'Aucun joueur sélectionné')
assert.equal(selectionLabel(0, 0, 'F'), 'Aucune joueuse sélectionnée')
assert.equal(selectionLabel(1, 0), '1 joueur sélectionné')
assert.equal(selectionLabel(7, 0, 'F'), '7 joueuses sélectionnées')
assert.equal(selectionLabel(7, 0, 'mixte'), '7 joueurs sélectionnés')
assert.equal(selectionLabel(30, 1, 'F', 10), '30 joueuses sélectionnées · dont 10 plus bas (pas encore affichées) · dont 1 hors du filtre')

// ---------- Confirmation au-delà de 20, comparer 2 ou 3 ----------
assert.equal(needsConfirm(20), false)
assert.equal(needsConfirm(21), true)
assert.equal(confirmText('Suivre', 21, 'F'), 'Suivre : 21 joueuses ?')
assert.deepEqual([0, 1, 2, 3, 4].map(canCompare), [false, false, true, true, false])

// ---------- Suivre / Ne plus suivre ----------
const followed = new Set(['a', 'b'])
assert.equal(followMode(['a', 'b'], followed), 'unfollow')
assert.equal(followMode(['a', 'c'], followed), 'follow')
assert.equal(followMode([], followed), 'follow')

// ---------- Actions selon les droits ----------
const full = { manageGroups: true, manageEvents: true, follow: true, scout: true }
// Hors événement : pas de « vu » (un « vu » est toujours lié à un événement).
assert.deepEqual(selActions(full), ['newGroup', 'addGroup', 'newEvent', 'addEvent', 'compare', 'follow', 'rewatch'])
// Dans un événement : tout.
assert.deepEqual(selActions({ ...full, eventId: 'e1' }), [...SEL_ACTIONS])
// Observateur (pas d'événements), sans compte de repérage ni suivis : groupes et comparer.
assert.deepEqual(selActions({ manageGroups: true, manageEvents: false, follow: false, scout: false, eventId: 'e1' }), ['newGroup', 'addGroup', 'compare'])

// ---------- Messages ----------
assert.equal(doneMessage('follow', 7, 7), '7 joueurs suivis.')
assert.equal(doneMessage('follow', 5, 7, 'F'), '5 joueuses suivies (2 déjà).')
assert.equal(doneMessage('follow', 0, 3, 'F'), 'Déjà toutes suivies.')
assert.equal(doneMessage('follow', 0, 1), 'Déjà suivi.')
assert.equal(doneMessage('unfollow', 4, 4), '4 joueurs de moins dans « Mes suivis ».')
assert.equal(doneMessage('seen', 3, 3, 'F'), '3 joueuses marquées vues à cet événement.')
assert.equal(doneMessage('seen', 1, 2), '1 joueur marqué vu à cet événement (1 déjà).')
assert.equal(doneMessage('seen', 0, 2), 'Déjà tous vus par toi ici.')
assert.equal(doneMessage('rewatch', 7, 7), '7 joueurs ajoutés à « À revoir ».')
assert.equal(doneMessage('rewatch', 0, 4, 'F'), 'Déjà toutes à revoir par toi.')

console.log('test-selection : OK')
