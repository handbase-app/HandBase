// Test du lien vers un endroit précis de la fiche (?voir=…, src/playerFocus.ts) et des lignes compactes de « Mes suivis »
// (src/followRows.ts) : lecture et écriture du paramètre, onglet visé, libellés accessibles, pictogrammes d'une journée
// (nombre, cible), écart d'une mesure avec la précédente (sans jugement).
//
//   npx jiti tools/test-voir-fiche.ts
import assert from 'node:assert/strict'
import { focusLabel, focusLink, focusOfNews, parseFocus, withoutFocus } from '../src/playerFocus'
import { daySummary, deltaText, pictoLabel, previousValue, rowPictos, summaryLabel, summaryParts } from '../src/followRows'

// Lecture
assert.deepEqual(parseFocus('mesure:taille'), { kind: 'mesure', id: 'taille' })
assert.deepEqual(parseFocus('mesure:taille:m-1'), { kind: 'mesure', id: 'taille', row: 'm-1' })
assert.deepEqual(parseFocus('mesure:taille:'), { kind: 'mesure', id: 'taille' })
assert.deepEqual(parseFocus('avis:abc-123'), { kind: 'avis', id: 'abc-123' })
assert.deepEqual(parseFocus('video:a:b'), { kind: 'video', id: 'a:b' })
assert.deepEqual(parseFocus('avis:tous'), { kind: 'avis', id: 'tous' })
for (const bad of [null, undefined, '', 'mesure', 'mesure:', ':taille', 'courbe:taille', 'mesure::m-1', 'avis:' + 'x'.repeat(201)]) assert.equal(parseFocus(bad), null, String(bad))

// Écriture : onglet de l'élément visé, sans onglet pour Profil (défaut) ; aller-retour
assert.equal(focusLink('p1', { kind: 'mesure', id: 'taille' }), '/joueurs/p1?onglet=tests&voir=mesure%3Ataille')
assert.equal(focusLink('p1', { kind: 'mesure', id: 'poids', row: 'm9' }), '/joueurs/p1?onglet=tests&voir=mesure%3Apoids%3Am9')
assert.equal(focusLink('p1', { kind: 'avis', id: 'e1' }), '/joueurs/p1?onglet=avis&voir=avis%3Ae1')
assert.equal(focusLink('p1', { kind: 'video', id: 'v1' }), '/joueurs/p1?voir=video%3Av1')
for (const f of [{ kind: 'mesure', id: 'taille', row: 'm9' }, { kind: 'avis', id: 'e1' }, { kind: 'video', id: 'toutes' }] as const) {
  const q = new URLSearchParams(focusLink('p1', f).split('?')[1])
  assert.deepEqual(parseFocus(q.get('voir')), f)
}

// Retiré de l'adresse, le reste gardé
assert.equal(withoutFocus('?onglet=tests&voir=mesure%3Ataille'), '?onglet=tests')
assert.equal(withoutFocus('?voir=video%3Av1'), '')
assert.equal(withoutFocus('?r=x&voir=avis%3Ae&onglet=avis'), '?r=x&onglet=avis')

// Nouveauté → cible
assert.deepEqual(focusOfNews({ kind: 'measurement', refId: 'm1', criterionId: 'taille' }), { kind: 'mesure', id: 'taille', row: 'm1' })
assert.deepEqual(focusOfNews({ kind: 'evaluation', refId: 'e1' }), { kind: 'avis', id: 'e1' })
assert.deepEqual(focusOfNews({ kind: 'video', refId: 'v1' }), { kind: 'video', id: 'v1' })

// Libellés accessibles
assert.equal(focusLabel({ kind: 'measurement', label: 'Taille', curve: true }, 'DUPONT Léo'), 'Voir la courbe de taille de DUPONT Léo')
assert.equal(focusLabel({ kind: 'measurement', label: 'VMA', curve: true }, 'DUPONT Léo'), 'Voir la courbe de VMA de DUPONT Léo')
assert.equal(focusLabel({ kind: 'measurement', label: 'Latéralité', curve: false }, 'X Y'), 'Voir la mesure « Latéralité » de X Y')
assert.equal(focusLabel({ kind: 'evaluation', author: 'Stef' }, 'X Y'), 'Voir l’avis de Stef sur X Y')
assert.equal(focusLabel({ kind: 'video', label: 'Finale' }, 'X Y'), 'Voir la vidéo « Finale » de X Y')
assert.equal(pictoLabel('measurement', 3, 'DUPONT Léo'), '3 nouvelles mesures de DUPONT Léo')
assert.equal(pictoLabel('evaluation', 1, 'DUPONT Léo'), '1 nouvel avis sur DUPONT Léo')
assert.equal(pictoLabel('evaluation', 2, 'X'), '2 nouveaux avis sur X')
assert.equal(pictoLabel('video', 1, 'X'), '1 nouvelle vidéo de X')

// Pictogrammes d'une journée : avis, mesures, vidéos ; une seule → elle, plusieurs → la section ; mesures → la plus récente
const day = [
  { kind: 'video', refId: 'v1', time: 5 },
  { kind: 'measurement', refId: 'm1', criterionId: 'taille', time: 3 },
  { kind: 'measurement', refId: 'm2', criterionId: 'poids', time: 4 },
  { kind: 'evaluation', refId: 'e1', time: 1 },
  { kind: 'evaluation', refId: 'e2', time: 2 },
] as const
assert.deepEqual(rowPictos(day), [
  { kind: 'evaluation', n: 2, focus: { kind: 'avis', id: 'tous' } },
  { kind: 'measurement', n: 2, focus: { kind: 'mesure', id: 'poids', row: 'm2' } },
  { kind: 'video', n: 1, focus: { kind: 'video', id: 'v1' } },
])
assert.deepEqual(rowPictos([day[3]]), [{ kind: 'evaluation', n: 1, focus: { kind: 'avis', id: 'e1' } }])
assert.deepEqual(rowPictos([day[0], { kind: 'video', refId: 'v2', time: 9 }]), [{ kind: 'video', n: 2, focus: { kind: 'video', id: 'toutes' } }])
assert.deepEqual(rowPictos([]), [])

// Synthèse d'une journée repliée : joueurs concernés (accordés), avis, mesures, vidéos ; seulement ce qui est présent
const many = [
  { kind: 'evaluation', playerId: 'a' },
  { kind: 'evaluation', playerId: 'a' },
  { kind: 'measurement', playerId: 'a' },
  { kind: 'measurement', playerId: 'a' },
  { kind: 'measurement', playerId: 'a' },
  { kind: 'video', playerId: 'a' },
] as const
assert.deepEqual(daySummary(many), { players: 1, evaluation: 2, measurement: 3, video: 1 })
assert.equal(summaryLabel(daySummary(many), 'F'), '1 joueuse, 2 avis, 3 mesures, 1 vidéo')
assert.equal(summaryLabel(daySummary(many), undefined), '1 joueur, 2 avis, 3 mesures, 1 vidéo')
const two = [{ kind: 'measurement', playerId: 'a' }, { kind: 'measurement', playerId: 'b' }, { kind: 'video', playerId: 'b' }, { kind: 'video', playerId: 'b' }] as const
assert.equal(summaryLabel(daySummary(two), 'F'), '2 joueuses, 2 mesures, 2 vidéos')
assert.equal(summaryLabel(daySummary(two), 'mixte'), '2 joueurs, 2 mesures, 2 vidéos')
assert.equal(summaryLabel(daySummary([{ kind: 'evaluation', playerId: 'a' }]), undefined), '1 joueur, 1 avis')
// Ordre des pictogrammes : joueurs puis celui des lignes (avis, mesures, vidéos) ; le nombre pour la pastille
assert.deepEqual(
  summaryParts(daySummary(two), 'F').map((p) => [p.key, p.n]),
  [['players', 2], ['measurement', 2], ['video', 2]],
)
assert.deepEqual(summaryParts(daySummary([])), [])
assert.equal(summaryLabel({ players: 1200, evaluation: 0, measurement: 1500, video: 0 }), '1\u202f200 joueurs, 1\u202f500 mesures')

// Écart avec la mesure précédente : signe, unité, arrondi, échelle sans unité, même valeur
assert.equal(deltaText(180, 178, 'cm'), '+2 cm')
assert.equal(deltaText(64.7, 65, 'kg'), '−0,3 kg')
assert.equal(deltaText(65.2, 64.9, 'kg'), '+0,3 kg')
assert.equal(deltaText(4, 3, '/5', true), '+1')
assert.equal(deltaText(12, 12), '=')
assert.equal(deltaText(12.5, 12), '+0,5')

// Mesure précédente : la dernière avant (date du test, puis ordre de saisie) ; les textes ne comptent pas
const series = [
  { id: 'a', date: '2026-01-10', value: 170, at: 1 },
  { id: 'b', date: '2026-06-01', value: 175, at: 2 },
  { id: 'c', date: '2026-10-19', value: 180, at: 5 },
  { id: 'd', date: '2026-10-19', value: 'n/a', at: 3 },
  { id: 'e', date: '2026-10-19', value: 179, at: 4 },
]
assert.equal(previousValue(series, series[2]), 179)
assert.equal(previousValue(series, series[1]), 170)
assert.equal(previousValue(series, series[0]), undefined)
// Mesure saisie après coup pour un test plus ancien : comparée à ce qui la précède, pas à la plus récente
assert.equal(previousValue(series, { id: 'z', date: '2026-03-01', value: 172, at: 9 }), 170)

console.log('test-voir-fiche : OK')
