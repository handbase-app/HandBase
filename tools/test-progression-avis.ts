// Test de la progression des avis (src/opinionProgress.ts) sur des avis fictifs : crans de la frise (regroupés par
// événement, par jour hors événement, notes moyennées par observateur), report des notes, écart départ → arrivée, couleur,
// « a varié ↕ », « dernier avis », raccourci 6 mois, interpolation de ▶ Rejouer, poignée la plus proche, côté jeune.
//
//   npx jiti tools/test-progression-avis.ts
import assert from 'node:assert/strict'
import type { Evaluation, HBEvent } from '../src/db'
import {
  carried,
  countTones,
  deltaOf,
  deltaWords,
  fromWord,
  meanHistory,
  moveNearest,
  overall,
  progressSteps,
  replayAt,
  sixMonthsStart,
  toneOf,
  toWord,
  valueAt,
} from '../src/opinionProgress'

let n = 0
const ok = (name: string, fn: () => void) => {
  fn()
  n++
  console.log('ok -', name)
}

const ev = (id: string, date: string, type: HBEvent['type'] = 'match', name = `Événement ${id}`): HBEvent => ({ id, name, type, date, updatedAt: 0 })
let k = 0
const av = (date: string, scores: Record<string, number | string>, more: Partial<Evaluation> = {}): Evaluation => ({
  id: `a${k++}`,
  playerId: 'p',
  observer: 'Obs A',
  date,
  scores,
  updatedAt: 0,
  ...more,
})

ok('crans : par événement, par jour hors événement, rangés par date', () => {
  const events = [ev('t', '2025-09-13', 'tournoi', 'Tournoi de rentrée'), ev('s', '2025-10-25', 'entrainement', 'Stage de Toussaint')]
  const steps = progressSteps(
    [
      av('2025-10-25', { a: 3 }, { eventId: 's' }),
      av('2025-09-13', { a: 1 }, { eventId: 't' }),
      av('2025-09-14', { a: 2 }, { eventId: 't', observer: 'Obs B' }), // même événement, autre jour : même cran
      av('2025-10-02', { a: 4 }, { contextType: 'video' }),
      av('2025-10-02', { a: 2 }, { contextType: 'video', observer: 'Obs B' }),
      av('2025-10-03', { txt: 'rien de chiffré' }), // sans note : pas de cran
    ],
    events,
  )
  assert.deepEqual(
    steps.map((s) => [s.date, s.tag, s.count, s.scores.a]),
    [
      ['2025-09-13', 'Tournoi', 2, 1.5],
      ['2025-10-02', 'Vidéo', 2, 3],
      ['2025-10-25', 'Entraîn.', 1, 3],
    ],
  )
  assert.equal(steps[0].name, 'Tournoi de rentrée')
  assert.equal(steps[1].name, 'l’avis spontané')
  assert.equal(fromWord(steps[1].name) + ' / ' + toWord(steps[1].name), 'De / à')
  assert.equal(fromWord(steps[0].name) + ' / ' + toWord(steps[0].name), 'Du / au')
})

ok('cran : moyenne par observateur d’abord (deux avis du même ne pèsent pas double)', () => {
  const steps = progressSteps(
    [av('2026-01-10', { a: 2 }, { eventId: 'e' }), av('2026-01-10', { a: 2 }, { eventId: 'e' }), av('2026-01-10', { a: 5 }, { eventId: 'e', observer: 'Obs B' })],
    [ev('e', '2026-01-10')],
  )
  assert.equal(steps[0].scores.a, 3.5)
})

ok('report : dernière note connue, rien avant la première', () => {
  const steps = progressSteps([av('2026-01-01', { a: 2 }), av('2026-02-01', { a: 3, b: 4 }), av('2026-03-01', { b: 5 })], [])
  assert.deepEqual(carried(steps, 'a'), [2, 3, 3])
  assert.deepEqual(carried(steps, 'b'), [null, 4, 5])
  assert.deepEqual(carried(steps, 'z'), [null, null, null])
})

ok('interpolation (▶ Rejouer) : continue entre deux crans, rien avant la première note', () => {
  assert.equal(valueAt([1, 3, 5], 0.5), 2)
  assert.equal(valueAt([1, 3, 5], 2), 5)
  assert.equal(valueAt([1, 3, 5], 9), 5)
  assert.equal(valueAt([null, 4, 5], 0.5), null)
  assert.equal(valueAt([null, 4, 5], 1), 4)
  assert.equal(replayAt(2, 6, 450), 2.5)
  assert.equal(replayAt(2, 6, 99999), 6)
  // Mouvement réduit : d'un cran entier à l'autre.
  assert.equal(replayAt(2, 6, 1700, true), 3)
  assert.equal(replayAt(2, 6, 1800, true), 4)
})

ok('montée, baisse, stable : toujours l’arrivée comparée au départ', () => {
  const up = deltaOf([1, 2, 3, 4], 0, 3)
  assert.deepEqual([up.a, up.b, up.d, up.yoyo, up.last], [1, 4, 3, false, null])
  assert.equal(toneOf(up), 'up')
  const down = deltaOf([4, 3.5, 3, 3], 0, 3)
  assert.equal(toneOf(down), 'down')
  assert.equal(deltaWords(down).gap, '−1 ↘')
  assert.equal(deltaWords(down).short, '4 → 3 ↘')
  const flat = deltaOf([3, 3, 3], 0, 2)
  assert.equal(toneOf(flat), 'flat')
  assert.equal(deltaWords(flat).gap, 'stable')
  // Plus haut au milieu du chemin, arrivée sous le départ : rouge (jamais comparé au maxi).
  const peak = deltaOf([3, 5, 2], 0, 2)
  assert.equal(toneOf(peak), 'down')
})

ok('« a varié ↕ » : écart < 1 et amplitude ≥ 1,5', () => {
  const yoyo = deltaOf([3, 4.5, 2.5, 3.5], 0, 3)
  assert.equal(yoyo.yoyo, true)
  assert.equal(toneOf(yoyo), 'flat')
  assert.equal(deltaWords(yoyo).gap, 'a varié ↕')
  assert.equal(deltaWords(yoyo).short, '3 → 3,5 ↕')
  // Amplitude de 1 seulement : pas de « a varié ».
  assert.equal(deltaOf([3, 4, 3.5], 0, 2).yoyo, false)
  // Écart de 1 ou plus : jamais « a varié ».
  assert.equal(deltaOf([1, 5, 2], 0, 2).yoyo, false)
  // L'amplitude ne compte qu'entre les deux poignées.
  assert.equal(deltaOf([1, 5, 3, 3.5], 2, 3).yoyo, false)
})

ok('« dernier avis » : 1 → 5 → 4, le dernier pas va dans l’autre sens', () => {
  const x = deltaOf([1, 5, 4], 0, 2)
  assert.equal(x.d, 3)
  assert.equal(x.last, -1)
  assert.equal(deltaWords(x).lastStep, 'dernier avis −1')
  // Même sens : rien.
  assert.equal(deltaOf([1, 3, 4], 0, 2).last, null)
  // Pendant l'animation (arrivée entre deux crans) : rien.
  assert.equal(deltaOf([1, 5, 4], 0, 1.5).last, null)
  // Critère pas noté au dernier cran (report) : pas de dernier pas.
  assert.equal(deltaOf([1, 5, 5], 0, 2).last, null)
})

ok('pas encore noté au départ : « nouveau », gris, hors des comptes', () => {
  const x = deltaOf([null, 3, 4], 0, 2)
  assert.equal(x.d, null)
  assert.equal(toneOf(x), 'flat')
  assert.equal(deltaWords(x).gap, 'nouveau')
  assert.equal(deltaWords(x).short, '4')
  const c = countTones([x, deltaOf([1, 3], 0, 1), deltaOf([3, 2], 0, 1), deltaOf([3, 3], 0, 1)])
  assert.deepEqual(c, { up: 1, down: 1, flat: 1 })
})

ok('côté jeune : jamais de rouge, ni ↘, ni « −1 », ni « baissent »', () => {
  const down = deltaOf([4, 3], 0, 1)
  assert.equal(toneOf(down, true), 'flat')
  const w = deltaWords(down, true)
  assert.equal(w.short, '4 → 3')
  assert.ok(!/↘|−/.test(w.short + w.range + w.gap))
  const back = deltaWords(deltaOf([1, 5, 4], 0, 2), true)
  assert.equal(back.lastStep, null)
  assert.equal(back.gap, '+3 ↗')
  assert.deepEqual(countTones([down, deltaOf([1, 2], 0, 1)], true), { up: 1, down: 0, flat: 1 })
})

ok('famille (vue Par famille) : moyenne des critères notés à chaque cran', () => {
  assert.deepEqual(meanHistory([[1, 2, 3], [null, 4, 5]]), [1, 3, 4])
  assert.deepEqual(meanHistory([[null, null], [null, 2]]), [null, 2])
})

ok('« Actuel » et écart moyen depuis le départ', () => {
  const o = overall([deltaOf([1, 4], 0, 1), deltaOf([3, 2], 0, 1), deltaOf([null, 5], 0, 1)])
  assert.equal(o.now, (4 + 2 + 5) / 3)
  assert.equal(o.gain, 1)
})

ok('raccourci « 6 mois » et poignée la plus proche', () => {
  const steps = ['2025-09-13', '2025-10-04', '2025-11-22', '2025-12-13', '2026-01-24', '2026-03-21', '2026-05-30'].map((date) => ({ date }))
  assert.equal(sixMonthsStart(steps), 3) // 13/12/2025 : premier cran après le 30/11/2025
  assert.equal(sixMonthsStart([{ date: '2026-01-01' }, { date: '2026-01-02' }]), 0)
  // Tous dans les 6 mois : départ au premier ; tout au même mois : au plus l'avant-dernier.
  assert.equal(sixMonthsStart([{ date: '2026-05-01' }, { date: '2026-05-02' }, { date: '2026-05-03' }]), 0)
  assert.deepEqual(moveNearest(0, 6, 1, 6), { s: 1, e: 6 })
  assert.deepEqual(moveNearest(0, 6, 5, 6), { s: 0, e: 5 })
  assert.deepEqual(moveNearest(2, 4, 3, 6), { s: 2, e: 3 }) // égalité : l'arrivée recule
  assert.deepEqual(moveNearest(2, 3, 3, 6), { s: 2, e: 3 })
  assert.deepEqual(moveNearest(2, 3, 2, 6), { s: 2, e: 3 })
  assert.deepEqual(moveNearest(3, 4, 4, 6), { s: 3, e: 4 })
})

console.log(`\n${n} tests passés`)
