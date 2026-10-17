// Test du séquençage en plein écran (src/sequencer.ts) : file des actions, estimation de leur temps vidéo (0, 1, plusieurs
// repères, pente 1 au-delà du dernier, temps mort +60 s, mi-temps, actions simultanées, 7 m), action annoncée figée sur la
// cible avec toute la frise (y compris une annoncée déjà calée), appui en avance, positions sur la frise. Les positions sont
// testées avec la chaîne exacte de l'écran (Sequencer.tsx) : liveQueue(ms, base, …) puis seqView.
//
//   npx jiti tools/test-sequenceur.ts
import assert from 'node:assert/strict'
import { timeline, type MatchSheet, type StoredAction } from '../src/matchSheet'
import { countdownOf, fmtCountdown, isPenalty, isPing, liveQueue, pendingOf, seqQueue, seqView, stepQueue, type SeqItem } from '../src/sequencer'

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
/** Positions sur la frise comme les calcule l'écran (Sequencer.tsx) : liveQueue puis seqView. */
const screen = (ms: MatchSheet, q: SeqItem[], pend: string, now: number, ahead = 600) =>
  Object.fromEntries(seqView(liveQueue(ms, q, pend, now).queue, pend, now, ahead).map((m) => [m.it.id, m.x]))

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
assert.deepEqual(liveQueue(base, q0, 'a0', 50).late, 0)

// Un repère (a0 calé à 1:40 de vidéo) : pente 1 dans la période, 60 s de plus après le temps mort a4 (600 de jeu) ;
// 2e mi-temps déduite (fin estimée + 10 min de pause).
const ms1 = withFix({ 0: 100 })
const one = vOf(ms1)
assert.equal(one.a0, 100)
assert.equal(one.a1, 190)
assert.equal(one.a3, 340)
assert.equal(one.a4, 640, 'le temps mort lui-même : pas encore de minute ajoutée')
assert.equal(one.a5, 100 + 1140 + 60 + 600 + 60, 'fin 1re mi-temps 1300 (temps mort compris), +600 s de pause, +60 s de jeu')
assert.equal(one.a6, 2200)

// Plusieurs repères : interpolation entre a0 (60 → 100) et a3 (300 → 400), soit 1,25 s de vidéo par seconde de jeu ; au-delà
// du dernier : pente 1 (le moment le plus tôt possible), pas la pente observée.
const many = vOf(withFix({ 0: 100, 3: 400 }))
near(many.a1, 212.5, 'interpolation entre deux ancres')
near(many.a4, 700, 'pente 1 après la dernière ancre (et non 775 avec la pente 1,25)')
near(many.a5, 400 + 900 + 60 + 600 + 60, 'mi-temps : fin estimée au plus tôt, temps mort compris, puis 10 min de pause')

// Mi-temps : la 2e période sans repère garde 10 min de pause estimée après la fin (au plus tôt) de la 1re ; un repère dans la
// 2e période sert à la 2e période (pente 1 à partir de lui).
{
  const tl = timeline(withFix({ 0: 100, 4: 700 }))
  const end1 = tl.videoAt(1, 1200)!
  assert.equal(end1, 700 + 600 + 60, 'temps mort a4 calé : sa minute compte pour la suite')
  assert.equal(tl.videoAt(2, 1200)! - end1, 600, 'pause estimée : 10 min')
  const half = vOf(withFix({ 0: 100, 5: 2000 }))
  assert.equal(half.a5, 2000)
  assert.equal(half.a6, 2240)
  assert.equal(half.a4, 640, '1re mi-temps inchangée')
}

// Temps mort d'équipe : 60 s de vidéo de plus pour les actions qui le suivent (au-delà de la dernière ancre) ; un temps mort
// ignoré (absent de la vidéo) ne compte pas ; entre deux ancres, seule l'interpolation.
{
  const tmSheet: MatchSheet = {
    ...base,
    actions: [
      { t: 60, p: 1, s: [1, 0], k: 'but', side: 'home', pl: 0 },
      { t: 300, p: 1, s: [1, 0], k: 'tm', side: 'away' },
      { t: 330, p: 1, s: [2, 0], k: 'but', side: 'home', pl: 0 },
      { t: 400, p: 1, s: [2, 0], k: 'avert', side: 'away', pl: 1 },
    ],
  }
  const k = timeline(tmSheet).keys
  const v = (sync: MatchSheet['sync']) => vOf({ ...tmSheet, sync })
  assert.deepEqual(v({ marks: {}, fix: { [k[0]]: 100 } }), { a0: 100, a1: 340, a2: 430, a3: 500 })
  assert.equal(v({ marks: {}, fix: { [k[0]]: 100 }, skip: { [k[1]]: 1 } }).a2, 370, 'temps mort ignoré : pas de minute ajoutée')
  near(v({ marks: {}, fix: { [k[0]]: 100, [k[3]]: 600 } }).a2, 100 + 270 * (500 / 340), 'entre deux ancres : interpolation')
  assert.equal(v({ marks: {}, fix: { [k[0]]: 100, [k[2]]: 480 } }).a3, 550, 'ancre après le temps mort : il est déjà dedans')
}

// Jet de 7 m : aucun temps ajouté (arrêt de durée inconnue), l'estimation reste « au plus tôt » ; l'annonce porte une note.
{
  const q = seqQueue(ms1)
  assert.equal(isPenalty(base, q[1]), true, 'groupe exclusion + but sur 7 m')
  assert.equal(isPenalty(base, q[0]), false)
  assert.equal(q[1].v, 190, 'pas de temps ajouté avant un 7 m')
  assert.equal(fmtCountdown(countdownOf(q, 'a1', 150)!), 'au plus tôt dans ~40 s')
  assert.equal(fmtCountdown(countdownOf(q, 'a1', 150)!, true), '≥ 40 s')
}

// Actions simultanées : calées ensemble ; le groupe n'est « calé » que si toutes le sont.
assert.equal(seqQueue(withFix({ 0: 100, 1: 195 }))[1].fixed, false)
const both = seqQueue(withFix({ 0: 100, 1: 195, 2: 195 }))
assert.equal(both[1].fixed, true)
assert.equal(both[1].v, 195)

// Action annoncée par défaut : la première non calée pas déjà loin derrière (reprise en cours de match), sinon la première
// non calée ; celle choisie si elle est dans la file.
const q1 = seqQueue(ms1)
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
  const marks = seqView(liveQueue(ms1, q1, 'a1', 160).queue, 'a1', 160)
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

// Figée sur la cible : estimation dépassée, l'action annoncée devient une ancre provisoire au temps courant
// (max(estimation, maintenant)) ; elle reste sur la cible et TOUTES les suivantes non calées, estimées à partir d'elle,
// s'arrêtent avec elle (écart de temps de jeu, temps mort compris) ; la calée à gauche continue vers la gauche.
{
  const at200 = liveQueue(ms1, q1, 'a1', 200)
  assert.equal(at200.late, 10)
  const v200 = Object.fromEntries(at200.queue.map((x) => [x.id, x.v]))
  assert.deepEqual(v200, { a0: 100, a1: 200, a3: 350, a4: 650, a5: 1970, a6: 2210 })
  const s200 = screen(ms1, q1, 'a1', 200, 3000)
  const s230 = screen(ms1, q1, 'a1', 230, 3000)
  near(s200.a1, 1 / 3, 'sur la cible')
  near(s230.a1, 1 / 3, 'toujours sur la cible')
  for (const id of ['a3', 'a4', 'a5', 'a6']) near(s230[id], s200[id], `${id} immobile`)
  near(s230.a0, s200.a0 - (30 / 3000) * (2 / 3), 'la calée continue vers la gauche')
  assert.equal(isPing(countdownOf(q1, 'a1', 230)), true)
  assert.equal(fmtCountdown(countdownOf(q1, 'a1', 230)!), 'attendue depuis ~40 s')
  assert.equal(fmtCountdown(countdownOf(q1, 'a1', 230)!, true), '+40 s')
  // Le bug corrigé : une action annoncée DÉJÀ calée (touchée sur la frise pour la recaler, ou la dernière de la feuille)
  // restait collée sur la cible (seqView la bloquait) pendant que les suivantes continuaient d'avancer (liveQueue ne figeait
  // qu'une annoncée non calée). Une seule règle maintenant : tout s'arrête avec elle.
  const msF = withFix({ 0: 100, 1: 190, 2: 190 })
  const qF = seqQueue(msF)
  const f200 = screen(msF, qF, 'a1', 200, 3000)
  const f230 = screen(msF, qF, 'a1', 230, 3000)
  near(f230.a1, 1 / 3)
  for (const id of ['a3', 'a4', 'a5', 'a6']) near(f230[id], f200[id], `${id} immobile derrière une annoncée déjà calée`)
  // Une action calée plus loin garde sa vraie position ; les non calées entre les deux s'interpolent entre l'ancre provisoire
  // et elle ; celles d'après se basent sur elle (inchangées).
  const msFar = withFix({ 0: 100, 4: 700 })
  const qFar = seqQueue(msFar)
  const far = Object.fromEntries(liveQueue(msFar, qFar, 'a1', 230).queue.map((x) => [x.id, x.v]))
  near(far.a3, 230 + 150 * (470 / 450))
  assert.equal(far.a4, 700)
  assert.equal(far.a5, qFar[4].v)
  assert.equal(far.a5, 700 + 600 + 60 + 600 + 60)
  // On recule avant l'estimation : plus rien n'est décalé, l'action annoncée reprend sa place à droite de la cible.
  const back = liveQueue(ms1, q1, 'a1', 170)
  assert.equal(back.late, 0)
  assert.equal(back.queue, q1)
  assert.ok(seqView(back.queue, 'a1', 170).find((m) => m.pending)!.x > 1 / 3)
}

// Appui en avance (« C'est ici » à 170 s, estimation 190 s) : vraie ancre, toute la suite arrive plus tôt (pente 1 depuis
// elle) ; en retard (200 s) : plus tard. La frise figée à 200 s donnait déjà exactement ces positions.
{
  const early = vOf(withFix({ 0: 100, 1: 170, 2: 170 }))
  assert.equal(early.a1, 170)
  assert.equal(early.a3, 320)
  assert.ok(early.a6! < one.a6!)
  const lateFix = vOf(withFix({ 0: 100, 1: 200, 2: 200 }))
  assert.equal(lateFix.a3, 350)
  assert.ok(lateFix.a3! > one.a3!)
  assert.deepEqual(Object.fromEntries(liveQueue(ms1, q1, 'a1', 200).queue.map((x) => [x.id, x.v])), lateFix, 'figée = calée au temps courant')
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
// « Ignorer » (sync.skip) : le groupe sort de la file, sans toucher à l'estimation des autres (sauf un temps mort ignoré :
// plus de minute ajoutée) ; partiellement ignoré, il reste.
{
  const ign: MatchSheet = { ...ms1, sync: { ...ms1.sync!, skip: { [keys[1]]: 1, [keys[2]]: 1, [keys[4]]: 1 } } }
  const qi = seqQueue(ign)
  assert.deepEqual(qi.map((x) => x.id), ['a0', 'a3', 'a5', 'a6'])
  assert.equal(qi.find((x) => x.id === 'a3')?.v, one.a3)
  assert.equal(qi.find((x) => x.id === 'a6')?.v, one.a6! - 60, 'temps mort a4 ignoré')
  assert.equal(pendingOf(qi, 'a1', 0)?.id, 'a3', 'ignorée : plus proposée')
  const part: MatchSheet = { ...ign, sync: { ...ign.sync!, skip: { [keys[1]]: 1 } } }
  assert.deepEqual(seqQueue(part).map((x) => x.id), ['a0', 'a1', 'a3', 'a4', 'a5', 'a6'])
  // Une action ignorée qui était calée n'est plus un repère si son calage est retiré avec (ce que fait « Ignorer »).
  const ignFixed: MatchSheet = { ...base, sync: { marks: {}, fix: { [keys[0]]: 100 }, skip: { [keys[3]]: 1 } } }
  assert.equal(vOf(ignFixed).a4, 640)
}

// Compte à rebours : « au plus tôt » (l'estimation est le moment le plus tôt possible) ; court sur téléphone.
assert.equal(fmtCountdown(40), 'au plus tôt dans ~40 s')
assert.equal(fmtCountdown(1.5), 'maintenant')
assert.equal(fmtCountdown(-12), 'attendue depuis ~12 s')
assert.equal(fmtCountdown(185), 'au plus tôt dans ~3 min')
assert.equal(fmtCountdown(185, true), '≥ 3 min')

console.log('test-sequenceur : ok')
