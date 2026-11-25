// Avis de match enrichi et résumé d'un joueur sur un événement (src/avisMatch.ts) : super-pouvoir observé, temps de jeu
// (match ou tournoi seulement), lecture d'un avis d'avant sans ces champs, résumé de la vue Mosaïque (nombre d'avis, note
// comme le classement, temps de jeu, super-pouvoirs sans doublon), saisie du temps de jeu (pavé numérique, ±).
//
//   npx jiti tools/test-avis-match.ts
import assert from 'node:assert/strict'
import {
  eventPlayerSummary,
  fmtAvg,
  fmtPlayingTime,
  hasPlayingTime,
  parsePlayingTime,
  PLAYING_TIME_MAX,
  playingTimeOf,
  stepPlayingTime,
  SUPER_POWER_MAX,
  superPowerOf,
} from '../src/avisMatch'
import { playerScore } from '../src/compare'
import type { Evaluation } from '../src/db'

const ev = (o: Partial<Evaluation> & Pick<Evaluation, 'playerId' | 'observer'>): Evaluation =>
  ({ id: Math.random().toString(36).slice(2), date: '2026-11-04', scores: {}, updatedAt: 1, eventId: 'e1', ...o }) as Evaluation

// ---------- Type d'événement ----------
assert.equal(hasPlayingTime('match'), true)
assert.equal(hasPlayingTime('tournoi'), true)
for (const t of ['entrainement', 'observation', undefined, null, '']) assert.equal(hasPlayingTime(t), false, String(t))

// ---------- Avis d'avant, sans les nouveaux champs ----------
const old = ev({ playerId: 'a', observer: 'Obs 1', scores: { c1: 3, c2: 4 } })
assert.equal(superPowerOf(old), undefined)
assert.equal(playingTimeOf(old), undefined)
const sOld = eventPlayerSummary([old], 'a')
assert.deepEqual(sOld, { n: 1, avg: 3.5, observers: 1, playingTime: null, superPowers: [] })

// ---------- Super-pouvoir : propre, borné, vide = rien ----------
assert.equal(superPowerOf({ superPower: '  sa   lecture\n du jeu ' }), 'sa lecture du jeu')
assert.equal(superPowerOf({ superPower: '   ' }), undefined)
assert.equal(superPowerOf({ superPower: 42 }), undefined)
assert.equal(superPowerOf({ superPower: 'x'.repeat(200) })!.length, SUPER_POWER_MAX)

// ---------- Temps de jeu : entier de 0 à PLAYING_TIME_MAX, sinon non renseigné ----------
assert.equal(playingTimeOf({ playingTime: 40 }), 40)
assert.equal(playingTimeOf({ playingTime: 0 }), 0)
assert.equal(playingTimeOf({ playingTime: 39.6 }), 40)
for (const v of [-5, PLAYING_TIME_MAX + 1, NaN, Infinity, '40', null, undefined]) assert.equal(playingTimeOf({ playingTime: v }), undefined, String(v))

// Saisie au pavé numérique : chiffres seulement ; vide = non renseigné ; borné.
assert.equal(parsePlayingTime(''), undefined)
assert.equal(parsePlayingTime('abc'), undefined)
assert.equal(parsePlayingTime('45'), 45)
assert.equal(parsePlayingTime('4,5'), 45)
assert.equal(parsePlayingTime('0'), 0)
assert.equal(parsePlayingTime('999'), PLAYING_TIME_MAX)
assert.equal(parsePlayingTime('12345'), 123)

// Boutons ± (pas de 5 min) : vide + → 5, vide − → vide ; hors du pas, calé sur le multiple voisin ; bornés.
assert.equal(stepPlayingTime(undefined, 1), 5)
assert.equal(stepPlayingTime(undefined, -1), undefined)
assert.equal(stepPlayingTime(40, 1), 45)
assert.equal(stepPlayingTime(40, -1), 35)
assert.equal(stepPlayingTime(37, 1), 40)
assert.equal(stepPlayingTime(37, -1), 35)
assert.equal(stepPlayingTime(0, -1), 0)
assert.equal(stepPlayingTime(3, -1), 0)
assert.equal(stepPlayingTime(PLAYING_TIME_MAX, 1), PLAYING_TIME_MAX)

assert.equal(fmtPlayingTime(40), '40 min')
assert.equal(fmtPlayingTime(0), '0 min')
assert.equal(fmtPlayingTime(60), '1 h')
assert.equal(fmtPlayingTime(70), '1 h 10')
assert.equal(fmtPlayingTime(125), '2 h 05')

// ---------- Résumé d'un joueur sur un événement ----------
const evals = [
  // Obs 1 : deux avis (il ne pèse pas plus que les autres : moyenne de ses avis, comme le classement).
  ev({ playerId: 'p', observer: 'Obs 1', scores: { c1: 4, c2: 4 }, playingTime: 40, superPower: 'Sa lecture du jeu' }),
  ev({ playerId: 'p', observer: 'Obs 1', scores: { c1: 2, txt: 'remarque' } }),
  ev({ playerId: 'p', observer: 'Obs 2', scores: { c1: 5 }, playingTime: 45, superPower: '  sa LECTURE du jeu ! ' }),
  ev({ playerId: 'p', observer: 'Obs 3', scores: {}, superPower: 'Son premier pas' }),
  // En attente : listé (nombre, super-pouvoir, temps de jeu) mais hors de la note.
  ev({ playerId: 'p', observer: 'Obs 4', scores: { c1: 1 }, review: 'pending', superPower: 'Son sang-froid', playingTime: 20 }),
  // Hors cadre : ni listé ni compté.
  ev({ playerId: 'p', observer: 'Obs 5', scores: { c1: 1 }, review: 'refused', superPower: 'Ne doit pas paraître', playingTime: 90 }),
  // Un autre joueur.
  ev({ playerId: 'q', observer: 'Obs 1', scores: { c1: 1 }, playingTime: 10, superPower: 'Sa vision' }),
]
const s = eventPlayerSummary(evals, 'p')
assert.equal(s.n, 5, 'avis listés : validés et en attente, pas hors cadre')
// Note : Obs 1 = moyenne(4, 2) = 3 ; Obs 2 = 5 ; Obs 3 sans note ; → (3 + 5) / 2 = 4.
assert.equal(s.avg, 4)
assert.equal(s.observers, 2)
// Même calcul que le classement (playerScore sur les avis validés).
assert.equal(s.avg, playerScore(evals.filter((e) => e.playerId === 'p' && (e.review ?? 'validated') === 'validated'))!.avg)
// Temps de jeu : moyenne arrondie de 40, 45, 20 → 35.
assert.equal(s.playingTime, 35)
// Super-pouvoirs sans doublon (casse, ponctuation), dans l'ordre ; jamais celui d'un avis hors cadre.
assert.deepEqual(s.superPowers, ['Sa lecture du jeu', 'Son premier pas', 'Son sang-froid'])

// Joueur sans avis : rien.
assert.deepEqual(eventPlayerSummary(evals, 'z'), { n: 0, avg: null, observers: 0, playingTime: null, superPowers: [] })
// Avis seulement en attente : listé, sans note.
const pend = eventPlayerSummary([ev({ playerId: 'r', observer: 'Obs 1', scores: { c1: 4 }, review: 'pending' })], 'r')
assert.equal(pend.n, 1)
assert.equal(pend.avg, null)

assert.equal(fmtAvg(4), '4,0')
assert.equal(fmtAvg(3.456), '3,5')

console.log('test-avis-match : OK')
