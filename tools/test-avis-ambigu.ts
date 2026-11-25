import assert from 'node:assert/strict'
import { parseAmbigu } from '../src/dictation/avis'

const refs = [
  { criterionId: 'jc', label: 'Jeu collectif' },
  { criterionId: 'pd', label: 'Prise de décision' },
  { criterionId: 'li', label: "Lecture du jeu" },
]
assert.deepEqual(parseAmbigu('« joue très personnel » : Jeu collectif ou Prise de décision', refs), { quote: 'joue très personnel', ids: ['jc', 'pd'] })
// Casse et accents indifférents, point final, trois candidats.
assert.deepEqual(parseAmbigu('« voit bien » : lecture du jeu, prise de decision ou Jeu collectif.', refs), { quote: 'voit bien', ids: ['li', 'pd', 'jc'] })
// Un seul critère reconnu, ou pas de « : » : simple texte.
assert.equal(parseAmbigu('« voit bien » : Lecture du jeu ou Placement', refs), null)
assert.equal(parseAmbigu('je ne sais pas', refs), null)
console.log('test-avis-ambigu : OK')
