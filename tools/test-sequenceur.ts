// Test du séquençage en plein écran (src/sequencer.ts) : file des actions, estimation de leur temps vidéo (0, 1, plusieurs
// repères, mi-temps, actions simultanées), action annoncée figée sur la cible, appui en avance, positions sur la frise.
//
//   npx jiti tools/test-sequenceur.ts
import assert from 'node:assert/strict'
import { timeline, type MatchSheet, type StoredAction } from '../src/matchSheet'
import { countdownOf, fmtCountdown, isPing, liveQueue, pendingOf, seqQueue, seqView, stepQueue } from '../src/sequencer'

// Feuille fictive : mi-temps de 20 min (la 2e reprend à 20:00 de jeu), deux joueurs sans fiche.
const actions: StoredAction[] = [
  { t: 60, p: 1, s: [1, 0], k: 'but', side: 'home', pl: 0 }, // a0
  { t: 150, p: 1, s: [1, 0], k: '2mn', side: 'away', pl: 1 }, // a1 : exclusion et 7 m au même temps de jeu
  { t: 150, p: 1, s: [2, 0], k: 'but7', side: 'home', pl: 0 },
  { t: 300, p: 1, s: [2, 0], k: 'avert', side: 'away', pl: 1 }, // a3
  { t: 600, p: 1, s: [2, 0], k: 'tm', side: 'home' }, // a4
  { t: 1260, p: 2, s: [3, 0], k: 'but', side: 'home', pl: 0 }, // a5
  { t: 1500, p: 2, s: [3, 0], k: 'disq', side: 'away', pl: 1 }, // a6
]
const base: MatchSheet = { v: 1, home: 'Locaux', away: 'Visiteurs', halfMin: 20, players: [{ side: 'home', num: '7' }, { side: 'away', num: '12' }], actions, importedAt: '' }
const keys = timeline(base).keys
/** Feuille avec ces actions calées (indice → temps vidéo). */
const withFix = (fix: Record<number, number>): MatchSheet => ({
  ...base,
  sync: { marks: {}, fix: Object.fromEntries(Object.entries(fix).map(([i, v]) => [keys[Number(i)], v])) },
})
const vOf = (ms: MatchSheet) => Object.fromEntries(seqQueue(ms).map((x) => [x.id, x.v]))
const near = (a: number | undefined, b: number, msg?: string) => assert.ok(a !== undefined && Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} ≠ ${b}`)

// File : un élément par action, les simultanées ensemble (le 7 m montré avant l'exclusion).
const q0 = seqQueue(base)
assert.deepEqual(q0.map((x) => x.id), ['a0', 'a1', 'a3', 'a4', 'a5', 'a6'])
assert.deepEqual(q0[1].is, [1, 2])
assert.equal(q0[1].k, 'but7')

// Aucun repère : pas d'estimation, l'action annoncée est la première, rien ne défile, pas de compte à rebours.
assert.ok(q0.every((x) => x.v === undefined && !x.fixed))
assert.equal(pendingOf(q0, undefined, 0)?.id, 'a0')
assert.deepEqual(seqView(q0, 'a0', 0), [])
assert.equal(countdownOf(q0, 'a0', 0), undefined)
assert.equal(isPing(undefined), false)
assert.deepEqual(liveQueue(q0, 'a0', 50).late, 0)

// Un repère (a0 calé à 1:40 de vidéo) : pente 1 dans la période ; 2e mi-temps déduite (fin estimée + 10 min de pause).
const one = vOf(withFix({ 0: 100 }))
assert.equal(one.a0, 100)
assert.equal(one.a1, 190)
assert.equal(one.a3, 340)
assert.equal(one.a4, 640)
assert.equal(one.a5, 1100 + 140 + 600 + 60, 'fin 1re mi-temps 1240, +600 s de pause, +60 s de jeu')
assert.equal(one.a6, 2140)

// Plusieurs repères : interpolation entre a0 (60 → 100) et a3 (300 → 400), soit 1,25 s de vidéo par seconde de jeu ;
// au-delà, même pente (arrêts de jeu déjà constatés).
const many = vOf(withFix({ 0: 100, 3: 400 }))
near(many.a1, 212.5)
near(many.a4, 775)
near(many.a5, 400 + 900 * 1.25 + 600 + 60, 'mi-temps')

// Mi-temps : un repère dans la 2e période sert à la 2e période (pente 1 avec un seul repère).
const half = vOf(withFix({ 0: 100, 5: 2000 }))
assert.equal(half.a5, 2000)
assert.equal(half.a6, 2240)
assert.equal(half.a4, 640, '1re mi-temps inchangée')

// Actions simultanées : calées ensemble ; le groupe n'est « calé » que si toutes le sont.
assert.equal(seqQueue(withFix({ 0: 100, 1: 195 }))[1].fixed, false)
const both = seqQueue(withFix({ 0: 100, 1: 195, 2: 195 }))
assert.equal(both[1].fixed, true)
assert.equal(both[1].v, 195)

// Action annoncée par défaut : la première non calée pas déjà loin derrière (reprise en cours de match), sinon la première
// non calée ; celle choisie si elle est dans la file.
const q1 = seqQueue(withFix({ 0: 100 }))
assert.equal(pendingOf(q1, undefined, 0)?.id, 'a1')
assert.equal(pendingOf(q1, undefined, 500)?.id, 'a4')
assert.equal(pendingOf(q1, undefined, 99999)?.id, 'a1')
assert.equal(pendingOf(q1, 'a3', 0)?.id, 'a3')
assert.equal(pendingOf(q1, 'f1', 0)?.id, 'a1', 'repère inconnu de la file (fin de 2 minutes) : par défaut')
assert.equal(pendingOf(seqQueue(withFix({ 0: 1, 1: 2, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 })), undefined, 0), undefined, 'tout est calé')
assert.equal(stepQueue(q1, 'a1', 1)?.id, 'a3')
assert.equal(stepQueue(q1, 'a1', -1)?.id, 'a0')
assert.equal(stepQueue(q1, 'a6', 1), undefined)

// Frise : cible au tiers, 60 s visibles à droite (30 s à gauche, même échelle).
{
  const marks = seqView(q1, 'a1', 160)
  const m = (id: string) => marks.find((x) => x.it.id === id)
  near(m('a1')?.x, 1 / 3 + (30 / 60) * (2 / 3), 'a1 à 30 s de la cible')
  assert.equal(m('a1')?.pending, true)
  assert.equal(m('a0'), undefined, 'a0 à 60 s derrière : hors de la fenêtre (30 s à gauche)')
  assert.equal(m('a3'), undefined, 'a3 à 180 s : hors de la fenêtre')
  assert.equal(countdownOf(q1, 'a1', 160), 30)
  assert.equal(isPing(30), false)
  assert.equal(seqView(q1, 'a1', 160, 200).find((x) => x.it.id === 'a3')?.past, false)
  const wide = seqView(q1, 'a1', 160, 200)
  assert.equal(wide.find((x) => x.it.id === 'a0')?.past, true, 'calée, à gauche : estompée')
}
// Sur la cible (± 2 s) : ping.
assert.equal(isPing(countdownOf(q1, 'a1', 189)), true)
assert.equal(isPing(countdownOf(q1, 'a1', 187)), false)

// Figée sur la cible : estimation dépassée de 10 s, l'action annoncée reste sur la cible et toute la frise s'arrête avec
// elle (les suivantes non calées gardent leur écart avec elle) ; ping tant qu'on n'a pas appuyé.
{
  const at200 = liveQueue(q1, 'a1', 200)
  assert.equal(at200.late, 10)
  const v200 = Object.fromEntries(at200.queue.map((x) => [x.id, x.v]))
  assert.equal(v200.a0, 100, 'calée : à sa place')
  assert.equal(v200.a1, 200)
  assert.equal(v200.a3, 350)
  assert.equal(v200.a6, 2150)
  const at230 = liveQueue(q1, 'a1', 230)
  const x = (lq: typeof at200, now: number, id: string) => seqView(lq.queue, 'a1', now, 600).find((m) => m.it.id === id)!.x
  near(x(at200, 200, 'a1'), 1 / 3, 'sur la cible')
  near(x(at230, 230, 'a1'), 1 / 3, 'toujours sur la cible')
  near(x(at230, 230, 'a3') - x(at230, 230, 'a1'), x(at200, 200, 'a3') - x(at200, 200, 'a1'), 'écart constant')
  near(x(at230, 230, 'a0'), x(at200, 200, 'a0') - (30 / 600) * (2 / 3), 'la calée continue vers la gauche')
  assert.equal(isPing(countdownOf(q1, 'a1', 230)), true)
  assert.equal(fmtCountdown(countdownOf(q1, 'a1', 230)!), 'dépassée de ~40 s')
  // Une action calée plus loin arrête le décalage : elle et la suite gardent leur temps.
  const qFar = seqQueue(withFix({ 0: 100, 4: 700 }))
  const far = Object.fromEntries(liveQueue(qFar, 'a1', 230).queue.map((x) => [x.id, x.v]))
  near(far.a3, qFar[2].v! + (230 - qFar[1].v!))
  assert.equal(far.a4, 700)
  assert.equal(far.a5, qFar[4].v)
  // On recule avant l'estimation : plus rien n'est décalé, l'action annoncée reprend sa place à droite de la cible.
  const back = liveQueue(q1, 'a1', 170)
  assert.equal(back.late, 0)
  assert.equal(back.queue, q1)
  assert.ok(seqView(back.queue, 'a1', 170).find((m) => m.pending)!.x > 1 / 3)
}

// Appui en avance (« C'est ici » à 170 s, estimation 190 s) : vraie ancre, toute la suite arrive plus tôt.
{
  const early = vOf(withFix({ 0: 100, 1: 170, 2: 170 }))
  assert.equal(early.a1, 170)
  near(early.a3, 170 + 150 * (70 / 90))
  assert.ok(early.a3! < one.a3!)
  assert.ok(early.a6! < one.a6!)
  // Appui en retard (à 200 s) : la suite arrive plus tard qu'estimé.
  const lateFix = vOf(withFix({ 0: 100, 1: 200, 2: 200 }))
  near(lateFix.a3, 200 + 150 * (100 / 90))
  assert.ok(lateFix.a3! > one.a3!)
}

// « Passer » : l'action reste dans la file, non calée (on peut y revenir), estompée une fois l'annoncée plus loin ; ce
// n'est pas un repère : l'estimation continue avec les repères réels.
{
  const passed = pendingOf(q1, stepQueue(q1, 'a1', 1)!.id, 0)!
  assert.equal(passed.id, 'a3')
  assert.equal(q1.find((x) => x.id === 'a1')?.fixed, false)
  assert.equal(seqView(q1, 'a3', 200, 200).find((m) => m.it.id === 'a1')?.past, true, 'passée : estompée, même à droite')
  assert.deepEqual(vOf(withFix({ 0: 100 })), one, 'aucune ancre ajoutée')
}
// « Ignorer » (sync.skip) : le groupe sort de la file, sans toucher à l'estimation des autres ; partiellement ignoré, il reste.
{
  const ign: MatchSheet = { ...withFix({ 0: 100 }), sync: { ...withFix({ 0: 100 }).sync!, skip: { [keys[1]]: 1, [keys[2]]: 1, [keys[4]]: 1 } } }
  const qi = seqQueue(ign)
  assert.deepEqual(qi.map((x) => x.id), ['a0', 'a3', 'a5', 'a6'])
  assert.equal(qi.find((x) => x.id === 'a3')?.v, one.a3)
  assert.equal(qi.find((x) => x.id === 'a6')?.v, one.a6)
  assert.equal(pendingOf(qi, 'a1', 0)?.id, 'a3', 'ignorée : plus proposée')
  const part: MatchSheet = { ...ign, sync: { ...ign.sync!, skip: { [keys[1]]: 1 } } }
  assert.deepEqual(seqQueue(part).map((x) => x.id), ['a0', 'a1', 'a3', 'a4', 'a5', 'a6'])
  // Une action ignorée qui était calée n'est plus un repère si son calage est retiré avec (ce que fait « Ignorer »).
  const ignFixed: MatchSheet = { ...base, sync: { marks: {}, fix: { [keys[0]]: 100 }, skip: { [keys[3]]: 1 } } }
  assert.equal(vOf(ignFixed).a4, 640)
}

// Compte à rebours.
assert.equal(fmtCountdown(40), 'dans ~40 s')
assert.equal(fmtCountdown(1.5), 'maintenant')
assert.equal(fmtCountdown(-12), 'dépassée de ~12 s')
assert.equal(fmtCountdown(185), 'dans ~3 min')

console.log('test-sequenceur : ok')
