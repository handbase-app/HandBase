// Test des écarts entre observateurs sur un événement (src/opinionSpread.ts) : écart et niveau d'un critère (seuils 1,5 et
// 2,5, arrondis), une seule note, moyenne d'une famille par observateur, tri du plus gros écart au plus petit, résumé
// « n critères à discuter », libellés, repères sur la même note, formes des repères ; démo (src/demoProgress.ts) : un
// événement noté par 3 observateurs avec un 1 / 3 / 5, au handball comme au volley.
//
//   npx jiti tools/test-ecarts-avis.ts
import assert from 'node:assert/strict'
import type { Player } from '../src/db'
import { buildProgressDemo } from '../src/demoProgress'
import { GRID_CHAMP, GRID_MENTAL } from '../src/demoVolley'
import {
  bySpread,
  familySpread,
  markShapeOf,
  sameNoteOffsets,
  SPREAD_BIG,
  SPREAD_GAP,
  spreadLevel,
  spreadOf,
  spreadSummary,
  spreadWords,
  toDiscuss,
} from '../src/opinionSpread'

let n = 0
const ok = (name: string, fn: () => void) => {
  fn()
  n++
  console.log('ok -', name)
}

ok('seuils décidés : moins de 1,5 accord, 1,5 à 2 écart, 2,5 et plus gros écart', () => {
  assert.equal(SPREAD_GAP, 1.5)
  assert.equal(SPREAD_BIG, 2.5)
  assert.equal(spreadLevel(0), 'accord')
  assert.equal(spreadLevel(1), 'accord')
  assert.equal(spreadLevel(1.49), 'accord')
  assert.equal(spreadLevel(1.5), 'ecart')
  assert.equal(spreadLevel(2), 'ecart')
  assert.equal(spreadLevel(2.4), 'ecart')
  assert.equal(spreadLevel(2.5), 'gros')
  assert.equal(spreadLevel(4), 'gros')
  // Arrondi : 3,7 − 2,2 vaut 1,5 (pas 1,4999…).
  assert.equal(spreadLevel(3.7 - 2.2), 'ecart')
  assert.equal(spreadLevel(4.1 - 1.6), 'gros')
})

ok('écart d’un critère : min, max, moyenne, observateurs qui ont noté', () => {
  const s = spreadOf([1, 3, 5])
  assert.deepEqual(s, { lo: 1, hi: 5, avg: 3, gap: 4, level: 'gros', n: 3 })
  const t = spreadOf([2, null, 4.5, undefined])
  assert.equal(t.n, 2)
  assert.equal(t.gap, 2.5)
  assert.equal(t.level, 'gros')
  assert.equal(t.avg, 3.25)
  assert.equal(spreadOf([3, 3.5, 4]).level, 'accord')
  // Une seule note : pas d'écart, pas à discuter.
  const one = spreadOf([null, 4])
  assert.deepEqual([one.gap, one.level, one.n], [0, 'accord', 1])
  assert.equal(toDiscuss(one), false)
  assert.equal(toDiscuss(spreadOf([3, 4.5])), true)
  assert.equal(toDiscuss(spreadOf([3, 4])), false)
  // Personne : vide.
  assert.deepEqual(spreadOf([null, null]), { lo: null, hi: null, avg: null, gap: 0, level: 'accord', n: 0 })
})

ok('famille : moyenne de chaque observateur sur ses critères, puis l’écart', () => {
  // Deux critères × trois observateurs ; le 3e n'a noté que le premier critère.
  const f = familySpread([
    [2, 4, 5],
    [2, 4, null],
  ])
  assert.deepEqual([f.lo, f.hi, f.gap, f.level, f.n], [2, 5, 3, 'gros', 3])
  const g = familySpread([
    [1, 5],
    [5, 1],
  ])
  // Désaccords qui se compensent : moyennes égales, accord sur la famille.
  assert.equal(g.gap, 0)
  assert.equal(g.level, 'accord')
  assert.equal(familySpread([]).n, 0)
})

ok('tri : du plus gros écart au plus petit, ordre de la fiche à égalité', () => {
  const rows = [
    { id: 'vitesse', v: [4, 4, 4] },
    { id: 'tir', v: [1, 3, 5] },
    { id: 'gestion', v: [3, 3, 3.5] },
    { id: 'engagement', v: [2, 4, 5] },
    { id: 'vision', v: [4, 4, 4.5] },
    { id: 'duel', v: [2, 4, 4.5] },
  ]
  assert.deepEqual(
    bySpread(rows, (r) => spreadOf(r.v)).map((r) => r.id),
    ['tir', 'engagement', 'duel', 'gestion', 'vision', 'vitesse'],
  )
})

ok('résumé : « 3 critères à discuter : … », un seul, aucun', () => {
  assert.equal(spreadSummary(['Efficacité au tir', 'Engagement', 'Duel 1 contre 1']), '3 critères à discuter : Efficacité au tir, Engagement, Duel 1 contre 1')
  assert.equal(spreadSummary(['Engagement']), '1 critère à discuter : Engagement')
  assert.equal(spreadSummary([]), null)
})

ok('libellés : radar, lignes, une seule note', () => {
  assert.deepEqual(spreadWords(spreadOf([1, 3, 5])), { range: '1 à 5', label: '1 à 5 · gros écart', word: 'gros écart', stats: 'moy. 3,0 · écart 4' })
  assert.equal(spreadWords(spreadOf([2, 4, 4.5])).label, '2 à 4,5 · gros écart')
  assert.equal(spreadWords(spreadOf([2, 4, 4.5])).stats, 'moy. 3,5 · écart 2,5')
  assert.equal(spreadWords(spreadOf([3, 3, 5])).label, '3 à 5 · écart')
  assert.equal(spreadWords(spreadOf([3.5, 3.5, 4])).label, '3,5 à 4 · accord')
  assert.equal(spreadWords(spreadOf([4, 4, 4])).label, '4 · accord')
  assert.equal(spreadWords(spreadOf([4, 4, 4])).stats, 'moy. 4,0 · écart 0')
  assert.equal(spreadWords(spreadOf([null, 3])).label, '3 · une note')
  assert.equal(spreadWords(spreadOf([null, 3])).stats, 'moy. 3,0 · une note')
  assert.equal(spreadWords(spreadOf([])).label, '')
})

ok('repères sur la même note : côte à côte, centrés', () => {
  assert.deepEqual(sameNoteOffsets([1, 3, 5]), [0, 0, 0])
  assert.deepEqual(sameNoteOffsets([4, 4, 5]), [-0.5, 0.5, 0])
  assert.deepEqual(sameNoteOffsets([4, 4, 4]), [-1, 0, 1])
  assert.deepEqual(sameNoteOffsets([null, 2, 2]), [0, -0.5, 0.5])
})

ok('formes des repères : une par observateur, puis on recommence', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(markShapeOf), ['circle', 'square', 'diamond', 'triangle', 'triangleDown'])
  assert.equal(markShapeOf(5), 'circle')
})

ok('démo : un événement noté par 3 observateurs, un 1 / 3 / 5 et d’autres écarts nets (hand et volley)', () => {
  const hand = ['vision', 'decision', 'efficacite_tir', 'duel', 'engagement', 'pression', 'agressivite']
  const players = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, firstName: 'A', lastName: 'B', position: 'DC' }) as Player)
  const third = 'Julie (adjointe)'
  for (const crits of [hand, [...GRID_CHAMP, ...GRID_MENTAL]]) {
    const d = buildProgressDemo(players, [], () => crits, ['Coach Paul', 'Sophie (CTF)'], 0, () => false, third)
    const byEvent = new Map<string, typeof d.evaluations>()
    for (const e of d.evaluations) byEvent.set(`${e.eventId}|${e.playerId}`, [...(byEvent.get(`${e.eventId}|${e.playerId}`) ?? []), e])
    const trios = [...byEvent.values()].filter((l) => new Set(l.map((e) => e.observer)).size === 3)
    assert.equal(trios.length, 1)
    const list = trios[0]
    const sps = crits.map((c) => spreadOf(list.map((e) => e.scores[c] as number)))
    assert.ok(sps.some((s) => s.lo === 1 && s.hi === 5 && s.avg === 3), 'un critère noté 1 / 3 / 5')
    assert.equal(sps.filter((s) => s.level === 'gros').length, 2)
    assert.equal(sps.filter((s) => s.level === 'ecart').length, 1)
    assert.ok(list.every((e) => e.strengths || e.improvements), 'un commentaire de chacun')
    // Sans troisième observateur : jamais trois.
    const two = buildProgressDemo(players, [], () => crits, ['Coach Paul', 'Sophie (CTF)'], 0)
    assert.ok(two.evaluations.every((e) => e.observer !== third))
  }
})

console.log(`\n${n} tests passés`)
