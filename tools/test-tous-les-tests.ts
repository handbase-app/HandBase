// Test de « Tous les tests » (src/allTests.ts : onglet Tests de la fiche, « Mes tests » de la page du jeune) : tests passés par
// famille (ordre des critères), dernière valeur, record, gain depuis la première mesure dans le bon sens (sprint : plus bas est
// mieux, « −0,09 s ↗ » ; sens inconnu : écart positif en neutre ; un recul : rien), « plus beaux progrès » (3 au plus, progrès
// relatif), points de la petite courbe, en-tête, lignes du tableur (CSV). Données FICTIVES seulement.
//
//   npx jiti tools/test-tous-les-tests.ts
import assert from 'node:assert/strict'
import type { Criterion, Measurement } from '../src/db'
import { measureDirection } from '../src/compare'
import { repereDirection } from '../src/reperes'
import { csvRows, families, fileSlug, gainKind, gainText, sparkPoints, summaryText, testLines, toCsv, topProgress, type Dir } from '../src/allTests'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok - ${name}`)
}

const crit = (id: string, category: string, order: number, extra: Partial<Criterion> = {}): Criterion => ({
  id,
  label: id,
  category,
  kind: 'factual',
  scale: 'number',
  active: true,
  order,
  updatedAt: 1,
  ...extra,
})
const C = [
  crit('sprint_10', 'Vitesse & endurance', 1, { label: 'Sprint 10 m', unit: 's' }),
  crit('vma', 'Vitesse & endurance', 2, { label: 'VMA', unit: 'km/h' }),
  crit('illinois', 'Vitesse & endurance', 3, { label: 'Illinois', unit: 's' }),
  crit('cmj_hauteur', 'Sauts (plateforme)', 4, { label: 'CMJ – hauteur', unit: 'cm' }),
  crit('taille', 'Gabarit', 5, { label: 'Taille', unit: 'cm' }),
  crit('poids', 'Gabarit', 6, { label: 'Poids', unit: 'kg' }),
  crit('lateralite', 'Mobilité', 7, { label: 'Côté fort', scale: 'choice', options: ['D', 'G'] }),
  crit('jamais', 'Force (6 RM)', 8, { label: 'Jamais passé', unit: 'kg' }),
  crit('avis', 'Technique', 9, { kind: 'subjective', scale: 'score5' }),
]
const DIR: Record<string, Dir> = { sprint_10: -1, illinois: -1, vma: 1, cmj_hauteur: 1 }
const dirOf = (c: Criterion): Dir => DIR[c.id] ?? 0

let k = 0
const m = (criterionId: string, date: string, value: number | string, extra: Partial<Measurement> = {}): Measurement => ({
  id: `m${++k}`,
  playerId: 'j1',
  criterionId,
  date,
  value,
  updatedAt: k,
  ...extra,
})
const M = [
  m('sprint_10', '2026-03-01', 1.91),
  m('sprint_10', '2026-10-12', 1.82),
  m('sprint_10', '2026-06-01', 1.85),
  m('vma', '2025-09-20', 15.5),
  m('vma', '2026-10-12', 16.5),
  m('illinois', '2026-06-03', 16.9),
  m('cmj_hauteur', '2025-09-22', 32),
  m('cmj_hauteur', '2026-01-20', 32.5),
  m('cmj_hauteur', '2026-10-12', 38),
  m('cmj_hauteur', '2026-05-05', 40), // record ancien : la dernière n'est pas la meilleure
  m('taille', '2025-10-12', 174),
  m('taille', '2026-10-12', 178),
  m('poids', '2025-10-12', 66),
  m('poids', '2026-10-12', 64),
  m('lateralite', '2026-02-02', 'D'),
  m('avis', '2026-02-02', 4),
  m('sprint_10', '2026-10-13', 1.5, { deleted: true }), // supprimée : ignorée
  m('vma', '2026-10-13', 20, { playerId: 'autre' }), // un autre joueur : ignorée
  m('inconnu', '2026-10-13', 3), // critère absent de la base : ignorée
]
const lines = testLines(C, M, dirOf, 'j1')
const L = (id: string) => lines.find((l) => l.c.id === id)!

t('tests passés seulement, critères factuels, dans l’ordre des critères ; familles dans l’ordre', () => {
  assert.deepEqual(
    lines.map((l) => l.c.id),
    ['sprint_10', 'vma', 'illinois', 'cmj_hauteur', 'taille', 'poids', 'lateralite'],
  )
  assert.deepEqual(
    families(lines).map(([f, ls]) => [f, ls.length]),
    [['Vitesse & endurance', 3], ['Sauts (plateforme)', 1], ['Gabarit', 2], ['Mobilité', 1]],
  )
  // Ordre des critères (pas celui du tableau reçu).
  assert.deepEqual(testLines([...C].reverse(), M, dirOf, 'j1').map((l) => l.c.id), lines.map((l) => l.c.id))
})

t('mesures dans l’ordre des dates, la dernière ; supprimée, autre joueur, critère inconnu : ignorés', () => {
  assert.deepEqual(L('sprint_10').all.map((x) => x.date), ['2026-03-01', '2026-06-01', '2026-10-12'])
  assert.equal(L('sprint_10').last.value, 1.82)
  assert.equal(L('vma').all.length, 2)
  assert.equal(L('poids').all.length, 2, 'Poids visible comme les autres tests')
})

t('plus bas est mieux (sprint) : gain « −0,09 s ↗ », record, meilleure valeur la plus basse', () => {
  const s = L('sprint_10')
  assert.equal(s.delta, -0.09)
  assert.equal(gainKind(s), 'up')
  assert.equal(gainText(s), '−0,09 s')
  assert.equal(s.record, true)
  assert.equal(s.best, 1.82)
})

t('plus haut est mieux : gain, record ; la dernière n’est pas la meilleure : pas de record, gain quand même', () => {
  assert.equal(gainText(L('vma')), '+1 km/h')
  assert.equal(L('vma').record, true)
  const j = L('cmj_hauteur')
  assert.equal(gainText(j), '+6 cm')
  assert.equal(j.record, false)
  assert.equal(j.best, 40)
})

t('jamais un recul : gain dans le mauvais sens → rien', () => {
  const recul = testLines(C, [m('sprint_10', '2026-01-01', 1.8), m('sprint_10', '2026-02-01', 1.9), m('vma', '2026-01-01', 16), m('vma', '2026-02-01', 15)], dirOf)
  for (const l of recul) {
    assert.equal(gainKind(l), null, l.c.id)
    assert.equal(gainText(l), null, l.c.id)
    assert.equal(l.record, false, l.c.id)
  }
  assert.deepEqual(topProgress(recul), [])
  // Égalité : rien non plus, pas de record.
  const egal = testLines(C, [m('vma', '2026-01-01', 16), m('vma', '2026-02-01', 16)], dirOf)
  assert.equal(gainText(egal[0]), null)
  assert.equal(egal[0].record, false)
})

t('sens inconnu (taille, poids) : écart positif en neutre, baisse : rien ; jamais de record ni de progrès', () => {
  assert.equal(gainKind(L('taille')), 'neutral')
  assert.equal(gainText(L('taille')), '+4 cm')
  assert.equal(gainKind(L('poids')), null)
  assert.equal(gainText(L('poids')), null)
  assert.equal(L('taille').record, false)
  assert.equal(L('taille').best, undefined)
  assert.ok(!topProgress(lines).some((l) => l.dir === 0))
})

t('une seule mesure, ou un choix : ni gain ni courbe', () => {
  assert.equal(gainText(L('illinois')), null)
  assert.equal(L('illinois').record, false)
  assert.equal(L('lateralite').points.length, 0)
  assert.equal(L('lateralite').dir, 0)
  assert.equal(L('lateralite').last.value, 'D')
})

t('plus beaux progrès : 3 au plus, du plus grand progrès relatif, bon sens seulement', () => {
  // cmj : +6/32 = 18,8 % ; vma : +1/15,5 = 6,5 % ; sprint : 0,09/1,91 = 4,7 %.
  assert.deepEqual(topProgress(lines).map((l) => l.c.id), ['cmj_hauteur', 'vma', 'sprint_10'])
  assert.deepEqual(topProgress(lines, 2).map((l) => l.c.id), ['cmj_hauteur', 'vma'])
  // Une seule mesure partout : aucun.
  assert.deepEqual(topProgress(testLines(C, [m('vma', '2026-01-01', 16)], dirOf)), [])
})

t('petite courbe : points dans la boîte, haut = plus grand, valeurs égales au milieu, moins de 2 : rien', () => {
  assert.equal(sparkPoints([1], 50, 20), '')
  assert.equal(sparkPoints([], 50, 20), '')
  assert.equal(sparkPoints([10, 20, 15], 50, 20, 2), '2,18 25,2 48,10')
  assert.equal(sparkPoints([5, 5], 50, 20, 2), '2,10 48,10')
})

t('en-tête : nombre de tests passés et date de la dernière mesure', () => {
  assert.equal(summaryText(lines), '7 tests passés · dernier le 12/10/2026')
  assert.equal(summaryText(testLines(C, [m('vma', '2026-01-05', 16)], dirOf)), '1 test passé · dernier le 05/01/2026')
  assert.equal(summaryText([]), null)
})

t('tableur : une ligne par mesure (date, famille, test, valeur, unité), nombres à virgule, formules neutralisées', () => {
  const rows = csvRows(lines)
  assert.deepEqual(rows[0], ['Date', 'Famille', 'Test', 'Valeur', 'Unité'])
  assert.equal(rows.length, 1 + 3 + 2 + 1 + 4 + 2 + 2 + 1)
  assert.deepEqual(rows[1], ['01/03/2026', 'Vitesse & endurance', 'Sprint 10 m', 1.91, 's'])
  const csv = toCsv([rows[0], rows[1], ['01/01/2026', 'Famille', '=1+1', '12,5', '']])
  assert.ok(csv.startsWith('﻿Date;Famille;Test;Valeur;Unité\r\n'))
  assert.ok(csv.includes('01/03/2026;Vitesse & endurance;Sprint 10 m;1,91;s\r\n'))
  assert.ok(csv.includes(";'=1+1;12,5;"), 'formule neutralisée, nombre texte gardé')
  assert.equal(toCsv([['a;b', 'dit "oui"']]), '﻿"a;b";"dit ""oui"""\r\n')
  // Valeur en texte « 12,5 » : lue comme un nombre.
  const r2 = csvRows(testLines(C, [m('vma', '2026-01-01', '12,5')], dirOf))
  assert.equal(r2[1][3], 12.5)
})

t('sens réel des tests (src/compare.ts, réglage des repères) : sprint et agilité plus bas, sauts plus haut, gabarit inconnu', () => {
  assert.equal(measureDirection(crit('sprint_10', 'V', 1, { unit: 's' })), -1)
  assert.equal(measureDirection(crit('illinois', 'V', 1, { unit: 's' })), -1)
  assert.equal(measureDirection(crit('cmj_hauteur', 'S', 1, { unit: 'cm' })), 1)
  assert.equal(measureDirection(crit('vma', 'V', 1, { unit: 'km/h' })), 1)
  for (const id of ['taille', 'poids']) assert.equal(measureDirection(crit(id, 'Gabarit', 1)), 0, id)
  // Un temps en secondes inconnu (gainage : plus long est mieux) reste inconnu, sauf sens choisi dans les repères.
  const gainage = crit('gainage_fictif', 'Stabilité', 1, { unit: 's' })
  assert.equal(measureDirection(gainage), 0)
  assert.equal(repereDirection({ dir: 1 }, gainage), 1)
  assert.equal(repereDirection(undefined, crit('sprint_10', 'V', 1)), -1)
  // Avec le sens réel : le sprint qui baisse progresse.
  const real = testLines(C, M, (c) => repereDirection(undefined, c), 'j1')
  assert.equal(gainText(real.find((l) => l.c.id === 'sprint_10')!), '−0,09 s')
})

t('nom de fichier sans accents ni espaces', () => {
  assert.equal(fileSlug('Léo  Martin-Dupré'), 'leo-martin-dupre')
})

console.log(`\n${n} tests ok`)
