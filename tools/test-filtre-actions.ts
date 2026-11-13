// Test de la visibilité par type d'action (src/actionFilter.ts) : types présents et leur nombre, filtre mémorisé,
// séquençage (file restreinte aux actions montrées, action annoncée et suivante visibles, compteur, masquées ni calées
// ni ancres : l'estimation ne change pas), moments d'une vidéo (type lu dans la note, ⏮ ⏭ et enchaînement dans la
// sélection, « But 2-2 · 3/12 buts »). Feuille fictive, sans nom.
//
//   npx jiti tools/test-filtre-actions.ts
import assert from 'node:assert/strict'
import { catOf, countLabel, filterQueue, momentKind, nextVisible, parseFilter, positionIn, prevVisible, presentCats, SHOW_ALL, showAll, showNone, shown, stepVisible, toggleCat, toggleSide, visibleAt, visibleMoments, type TypeFilter } from '../src/actionFilter'
import type { VideoMoment } from '../src/db'
import { timeline, type MatchSheet, type StoredAction } from '../src/matchSheet'
import { pendingOf, seqQueue, stepQueue } from '../src/sequencer'

// Types : 7 M regroupe tous les jets de 7 m ; CARTON les trois cartons ; tir = tir raté ; perte et passe prêtes.
assert.equal(catOf('but7'), '7m')
assert.equal(catOf('tir7'), '7m')
assert.equal(catOf('tir'), 'tir')
assert.equal(catOf('disq'), 'carton')
assert.equal(catOf('perte'), 'perte')
assert.equal(catOf('passe'), 'passe')
assert.deepEqual(
  presentCats(['but', 'but', 'tm', 'but7', 'avert', 'disq', 'but']).map((p) => `${p.cat.label.short} ${p.n}`),
  ['BUT 3', '7 M 1', 'CARTON 2', 'TM 1'],
  'seuls les types présents, dans l’ordre, avec leur nombre',
)

// Choix mémorisé : lecture robuste, types inconnus ignorés.
assert.deepEqual(parseFilter(null), SHOW_ALL)
assert.deepEqual(parseFilter('{pas du json'), SHOW_ALL)
assert.deepEqual(parseFilter('{"hide":["tm","inconnu"],"sides":["away","x"]}'), { hide: ['tm'], sides: ['away'] })
const onlyGoals: TypeFilter = showNone(SHOW_ALL, ['but', '7m', 'carton', 'tm'])
assert.deepEqual(toggleCat(onlyGoals, 'but').hide.includes('but'), false)
assert.deepEqual(showAll(), SHOW_ALL)
assert.equal(shown(toggleSide(SHOW_ALL, 'away'), 'but', 'away'), false)
assert.equal(shown(toggleSide(SHOW_ALL, 'away'), 'tm'), true, 'sans équipe : seul le type compte')

// Compteur : « 5/12 », « 5/12 buts » quand un seul type présent est coché.
assert.equal(countLabel(5, 12, SHOW_ALL, ['but', 'tm']), '5/12')
assert.equal(countLabel(5, 12, toggleCat(SHOW_ALL, 'tm'), ['but', 'tm']), '5/12 buts')
assert.equal(countLabel(5, 12, SHOW_ALL, ['but']), '5/12', 'un seul type présent : pas besoin de le dire')

// ---------- Séquençage ----------
const actions: StoredAction[] = [
  { t: 60, p: 1, s: [1, 0], k: 'but', side: 'home', pl: 0 }, // a0
  { t: 120, p: 1, s: [1, 0], k: 'avert', side: 'away', pl: 1 }, // a1
  { t: 150, p: 1, s: [1, 0], k: '2mn', side: 'away', pl: 1 }, // a2 : 2' et 7 m au même temps de jeu
  { t: 150, p: 1, s: [2, 0], k: 'but7', side: 'home', pl: 0 },
  { t: 300, p: 1, s: [2, 0], k: 'tm', side: 'home' }, // a4
  { t: 420, p: 1, s: [2, 1], k: 'but', side: 'away', pl: 1 }, // a5
]
const base: MatchSheet = { v: 1, home: 'Locaux', away: 'Visiteurs', halfMin: 20, players: [{ side: 'home', num: '7' }, { side: 'away', num: '12' }], actions, importedAt: '' }
const keys = timeline(base).keys
const ms: MatchSheet = { ...base, sync: { marks: {}, fix: { [keys[0]]: 100 } } }
const all = seqQueue(ms)
assert.deepEqual(all.map((x) => x.id), ['a0', 'a1', 'a2', 'a4', 'a5'])
assert.equal(filterQueue(ms, all, SHOW_ALL), all, 'rien de masqué : même file')

// Seuls les buts : cartons, 2' et temps mort disparaissent ; le groupe 2' + 7 m reste pour son 7 m… seulement si 7 M est coché.
const goals = showNone(SHOW_ALL, ['carton', '2mn', 'tm', '7m'])
const q = filterQueue(ms, all, goals)
assert.deepEqual(q.map((x) => x.id), ['a0', 'a5'])
const goals7 = toggleCat(goals, '7m')
const q7 = filterQueue(ms, all, goals7)
assert.deepEqual(q7.map((x) => x.id), ['a0', 'a2', 'a5'])
const g = q7.find((x) => x.id === 'a2')!
assert.deepEqual(g.is, [3], 'le groupe ne montre que son 7 m')
assert.equal(g.k, 'but7')
assert.equal(g.i, 2, 'même élément de la file : même calage')
// Les temps estimés ne changent pas : les masquées ne sont pas des ancres et l'estimation porte sur toute la feuille.
for (const x of q7) assert.equal(x.v, all.find((y) => y.id === x.id)!.v)
// Action annoncée : la prochaine VISIBLE ; une action choisie mais masquée n'est plus annoncée ; N : la suivante visible.
assert.equal(pendingOf(q, undefined, 0)?.id, 'a5', 'a0 calée : la prochaine à caler visible est a5')
assert.equal(pendingOf(q, 'a1', 0)?.id, 'a5', 'carton masqué : pas annoncé')
assert.equal(stepQueue(q7, 'a0', 1)?.id, 'a2')
assert.equal(stepQueue(q7, 'a2', 1)?.id, 'a5', 'le temps mort masqué est sauté')
// Équipe masquée.
assert.deepEqual(filterQueue(ms, all, toggleSide(SHOW_ALL, 'away')).map((x) => x.id), ['a0', 'a2', 'a4'])
// Compteur : position dans la sélection.
const present = presentCats(all.flatMap((x) => x.is.map((j) => ms.actions[j].k))).map((p) => p.cat.id)
assert.equal(countLabel(2, q.length, goals, present), '2/2 buts')

// ---------- Moments d'une vidéo ----------
const M = (at: number, note?: string): VideoMoment => ({ at, ...(note ? { note } : {}) })
const moments = [M(10, 'But 1-0 · feuille'), M(40, 'Temps mort 1-0 · feuille'), M(70, 'But 7m 2-0 · feuille'), M(100, 'contre-attaque'), M(130, 'But 2-1 · feuille'), M(160, 'Avertissement 2-1 · feuille')]
assert.deepEqual(moments.map(momentKind), ['but', 'tm', 'but7', 'autre', 'but', 'avert'])
// Moments d'une vidéo d'événement (sheetMoments) : « But 3-2 · n° 7 (Locaux) » ; une note libre qui commence par « But » : autre.
assert.equal(momentKind({ note: 'But 3-2 · n° 7 (Locaux)' }), 'but')
assert.equal(momentKind({ note: '2 min 3-2' }), '2mn')
assert.equal(momentKind({ note: 'But de la tête' }), 'autre')
assert.equal(momentKind({}), 'autre')
const fb = showNone(SHOW_ALL, ['7m', 'tm', 'autre', 'carton'])
const vis = visibleMoments(moments, fb)
assert.deepEqual(vis, [0, 4])
assert.deepEqual(visibleMoments(moments, SHOW_ALL), [0, 1, 2, 3, 4, 5])
// ⏭ / ⏮ dans la sélection : depuis le moment lu, ou d'après le temps.
assert.equal(stepVisible(moments, vis, 1, 12, 0), 4)
assert.equal(stepVisible(moments, vis, -1, 132, 4), 0)
assert.equal(stepVisible(moments, vis, 1, 50), 4, 'entre deux : premier montré qui commence après')
assert.equal(stepVisible(moments, vis, 1, 140, 4), undefined)
assert.equal(stepVisible(moments, vis, 1, 72, 2), 4, 'moment lu masqué : d’après le temps')
// Enchaînement « Voir les actions » : suivant / précédent montré.
assert.equal(nextVisible(vis, 0), 4)
assert.equal(nextVisible(vis, 4), undefined)
assert.equal(prevVisible(vis, 4), 0)
assert.equal(visibleAt(moments, vis, 131), 4)
assert.equal(visibleAt(moments, vis, 72), undefined, '7 m masqué : pas « en cours »')
// Libellé : « But 2-1 · feuille · 2/2 buts ».
assert.equal(positionIn(moments, vis, 4, fb), 'But 2-1 · feuille · 2/2 buts')
assert.equal(positionIn(moments, visibleMoments(moments, SHOW_ALL), 4, SHOW_ALL), 'But 2-1 · feuille · 5/6')

console.log('test-filtre-actions : ok')
