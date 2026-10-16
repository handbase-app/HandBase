// Test du passage d'un moment à l'autre dans le lecteur vidéo (src/videos.ts : momentAt, stepMoment, momentPosition) :
// boutons « Action précédente » / « Action suivante » et libellé « But 2-2 · 2/4 » du plein écran.
//
//   npx jiti tools/test-moments-nav.ts
import assert from 'node:assert/strict'
import { momentAt, momentPosition, passage, stepMoment } from '../src/videos'

// Moments fictifs : 1:00 (sans durée, lu 15 s), 2:00 (10 s), 2:05 (sans durée : jusqu'à 2:20 au plus), 5:56 (12 s).
const ms = [{ at: 60, note: 'But 1-0' }, { at: 120, dur: 10 }, { at: 125, note: 'But 2-2' }, { at: 356, dur: 12, note: 'Arrêt' }]

assert.deepEqual(passage(ms, 0), { at: 60, end: 75 })
assert.deepEqual(passage(ms, 1), { at: 120, end: 130 })
assert.deepEqual(passage(ms, 2), { at: 125, end: 140 })

// Moment en cours d'après le temps.
assert.equal(momentAt(ms, undefined), undefined)
assert.equal(momentAt(ms, 10), undefined, 'avant le premier')
assert.equal(momentAt(ms, 59.9), 0, 'arrondi juste après le saut')
assert.equal(momentAt(ms, 59), undefined)
assert.equal(momentAt(ms, 140), 2, 'passage de « But 2-2 » fini, avant le suivant')
assert.equal(momentAt(ms, 70), 0)
assert.equal(momentAt(ms, 77), 0, 'juste après la fin')
assert.equal(momentAt(ms, 90), undefined, 'entre deux moments')
assert.equal(momentAt(ms, 127), 2, 'chevauchement : le plus récent')
assert.equal(momentAt(ms, 360), 3)

// Moment en cours de lecture : on part de lui.
assert.equal(stepMoment(ms, 1, 10, 0), 1)
assert.equal(stepMoment(ms, -1, 10, 0), undefined, 'pas de précédent au premier')
assert.equal(stepMoment(ms, 1, 999, 3), undefined, 'pas de suivant au dernier')
assert.equal(stepMoment(ms, -1, 999, 3), 2)
// Sans lecture : d'après le temps.
assert.equal(stepMoment(ms, 1, 70), 1, 'dans le passage 0 → 1')
assert.equal(stepMoment(ms, -1, 70), undefined)
assert.equal(stepMoment(ms, 1, 75), 1, 'passage 0 fini (pause) → 1')
assert.equal(stepMoment(ms, -1, 127), 1, 'dans le passage 2 → 1')
assert.equal(stepMoment(ms, 1, 0), 0, 'avant le premier → premier')
assert.equal(stepMoment(ms, -1, 0), undefined)
assert.equal(stepMoment(ms, 1, 200), 3, 'entre deux → le suivant')
assert.equal(stepMoment(ms, -1, 200), 2, 'entre deux → le dernier commencé')
assert.equal(stepMoment(ms, 1, 500), undefined, 'après le dernier')
assert.equal(stepMoment(ms, -1, 500), 3)
assert.equal(stepMoment(ms, 1, undefined), 0, 'temps inconnu → premier')
assert.equal(stepMoment([], 1, 0), undefined)

// Libellé du plein écran.
assert.equal(momentPosition(ms, 2), 'But 2-2 · 3/4')
assert.equal(momentPosition(ms, 1), '2:00 · 2/4')

console.log('test-moments-nav : OK')
