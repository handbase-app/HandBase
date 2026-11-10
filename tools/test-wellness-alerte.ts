// Test du wellness côté staff (src/wellnessAlert.ts, src/demander.ts) : la phrase de « Demander » (« les joueurs en
// dessous de 6 dans le wellness », « sommeil sous 5 », variantes de dictée), le critère dans l'adresse, la dernière réponse
// de chacun, l'alerte « 3 jours demandés de suite à 5 ou moins » (week-end sauté, jour sans réponse qui coupe, matinée pas
// finie, vacances, note réglée), le réglage du groupe, les propositions de l'en-tête, la pureté du module. Données fictives.
//
//   npx jiti tools/test-wellness-alerte.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { routeAsk } from '../src/demander'
import type { WellnessEntry } from '../src/wellness'
import {
  alertSettingsOf,
  alertText,
  askMatch,
  criterionParam,
  criterionText,
  DEFAULT_ALERT,
  dayMean,
  lastAnswer,
  lowAlert,
  lowStreak,
  parseCriterionParam,
  parseWellnessAsk,
  WELLNESS_IN_ASK,
  WELLNESS_LOW_DAYS,
  WELLNESS_LOW_MAX,
  wellnessAsk,
} from '../src/wellnessAlert'

let n = 0
const ok = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok - ${name}`)
}

// ---------- La phrase ----------

ok('phrase de Geoffroy : moyenne en dessous de 6', () => {
  assert.deepEqual(parseWellnessAsk('donne-moi les joueurs en dessous de 6 dans le wellness'), { notes: [], op: 'lt', value: 6 })
})
ok('variantes de dictée du mot wellness', () => {
  for (const s of ['les joueurs en dessous de 6 dans le welness', 'en-dessous de 6 au wellnes', 'sous 6 dans le well ness', 'moins de 6 au ouelness', 'en dessous de 6 au bien-être', 'Wellness < 6']) {
    assert.deepEqual(parseWellnessAsk(s), { notes: [], op: 'lt', value: 6 }, s)
  }
})
ok('une note nommée : cette note seulement', () => {
  assert.deepEqual(parseWellnessAsk('sommeil en dessous de 6'), { notes: ['sommeil'], op: 'lt', value: 6 })
  assert.deepEqual(parseWellnessAsk('énergie sous 5'), { notes: ['energie'], op: 'lt', value: 5 })
  assert.deepEqual(parseWellnessAsk('fraîcheur inférieure à 6'), { notes: ['fraicheur'], op: 'lt', value: 6 })
  assert.deepEqual(parseWellnessAsk('les joueurs avec une humeur de 4 ou moins'), { notes: ['humeur'], op: 'le', value: 4 })
  assert.deepEqual(parseWellnessAsk('énergie et sommeil sous 5'), { notes: ['energie', 'sommeil'], op: 'lt', value: 5 })
})
ok('tournures : moins de, sous, inférieur à, 5 ou moins, au-dessus de, au moins, nombres en lettres, décimales', () => {
  const c = (s: string) => {
    const r = parseWellnessAsk(s)
    return r ? `${r.op} ${r.value}` : null
  }
  assert.equal(c('wellness moins de 6'), 'lt 6')
  assert.equal(c('wellness inférieur à 6'), 'lt 6')
  assert.equal(c('wellness inférieure ou égale à 5'), 'le 5')
  assert.equal(c('5 ou moins au wellness'), 'le 5')
  assert.equal(c('5 et moins au wellness'), 'le 5')
  assert.equal(c('wellness ≤ 5'), 'le 5')
  assert.equal(c('au-dessus de 7 dans le wellness'), 'gt 7')
  assert.equal(c('plus de 7 au wellness'), 'gt 7')
  assert.equal(c('wellness supérieur à 7'), 'gt 7')
  assert.equal(c('au moins 8 au wellness'), 'ge 8')
  assert.equal(c('8 ou plus au wellness'), 'ge 8')
  assert.equal(c('pas plus de 4 au wellness'), 'le 4')
  assert.equal(c('wellness en dessous de six'), 'lt 6')
  assert.equal(c('wellness sous 5,5'), 'lt 5.5')
})
ok('pas une phrase de wellness : null (la phrase suit son chemin)', () => {
  for (const s of ['les gauchers de plus d’1 m 80', 'les joueurs nés en 2010', 'le wellness', 'les joueurs de plus de 15 ans au wellness', 'les 2011 du Var', 'Martin', '']) {
    assert.equal(parseWellnessAsk(s), null, s)
  }
})
ok('interrupteur unique (allumé) : wellnessAsk = parseWellnessAsk', () => {
  assert.equal(WELLNESS_IN_ASK, true)
  assert.deepEqual(wellnessAsk('sommeil sous 5'), parseWellnessAsk('sommeil sous 5'))
})
ok('texte du critère et critère dans l’adresse (aller-retour, valeurs refusées)', () => {
  const c = parseWellnessAsk('énergie et sommeil de 5 ou moins')!
  assert.equal(criterionText(c), 'énergie et sommeil à 5 ou moins')
  assert.equal(criterionText({ notes: [], op: 'lt', value: 5.5 }), 'moyenne des notes en dessous de 5,5')
  assert.equal(criterionParam(c), 'le-5-energie.sommeil')
  assert.deepEqual(parseCriterionParam(criterionParam(c)), c)
  assert.deepEqual(parseCriterionParam('lt-6'), { notes: [], op: 'lt', value: 6 })
  for (const bad of ['', 'lt-0', 'lt-11', 'xx-5', 'lt-5-poids', 'lt-5-sommeil.<script>', null]) assert.equal(parseCriterionParam(bad), null, String(bad))
})

// ---------- Dernière réponse ----------

const E = (day: string, s: [number, number, number, number] | Partial<Record<'energie' | 'fraicheur' | 'humeur' | 'sommeil', number>>): WellnessEntry => ({
  day,
  pain: false,
  scores: Array.isArray(s) ? { energie: s[0], fraicheur: s[1], humeur: s[2], sommeil: s[3] } : s,
})

ok('moyenne d’un jour : les notes données', () => {
  assert.equal(dayMean(E('2026-11-10', [4, 5, 6, 7])), 5.5)
  assert.equal(dayMean(E('2026-11-10', { sommeil: 3, humeur: 5 })), 4)
  assert.equal(dayMean({ scores: {} }), null)
})
ok('Demander : dernière réponse de 7 jours au plus, valeur et jour rendus', () => {
  const list = [E('2026-11-02', [2, 2, 2, 2]), E('2026-11-06', [5, 5, 6, 6]), E('2026-11-09', [7, 7, 7, 7])]
  // Mardi 10 au matin, pas encore répondu : la réponse de lundi.
  assert.equal(lastAnswer(list, '2026-11-10')?.day, '2026-11-09')
  assert.equal(askMatch(list, '2026-11-10', { notes: [], op: 'lt', value: 6 }), null)
  assert.deepEqual(askMatch(list, '2026-11-08', { notes: [], op: 'lt', value: 6 }), { day: '2026-11-06', values: [{ label: 'moyenne', value: 5.5 }] })
  // Trop ancienne (plus de 7 jours) : rien.
  assert.equal(askMatch([E('2026-11-02', [2, 2, 2, 2])], '2026-11-10', { notes: [], op: 'lt', value: 6 }), null)
  // Une note : cette note ; la note manque ce jour-là : pas retenu.
  assert.deepEqual(askMatch([E('2026-11-10', [8, 8, 8, 4])], '2026-11-10', { notes: ['sommeil'], op: 'lt', value: 6 })?.values, [{ label: 'sommeil', value: 4 }])
  assert.equal(askMatch([E('2026-11-10', { energie: 3 })], '2026-11-10', { notes: ['sommeil'], op: 'lt', value: 6 }), null)
  // Deux notes : chacune.
  assert.equal(askMatch([E('2026-11-10', [4, 8, 8, 4])], '2026-11-10', { notes: ['energie', 'sommeil'], op: 'lt', value: 5 })?.values.length, 2)
  assert.equal(askMatch([E('2026-11-10', [4, 8, 8, 6])], '2026-11-10', { notes: ['energie', 'sommeil'], op: 'lt', value: 5 }), null)
})

// ---------- Alerte : jours demandés de suite ----------

const low: [number, number, number, number] = [5, 5, 4, 5] // moyenne 4,75
const mid: [number, number, number, number] = [6, 6, 5, 5] // moyenne 5,5

ok('constantes à un seul endroit : 5 ou moins, 3 jours, la moyenne', () => {
  assert.equal(WELLNESS_LOW_MAX, 5)
  assert.equal(WELLNESS_LOW_DAYS, 3)
  assert.deepEqual(DEFAULT_ALERT, { max: 5, days: 3, note: null })
  assert.equal(alertText(DEFAULT_ALERT), '3 jours de suite à 5 ou moins (moyenne des notes)')
})
ok('3 jours de semaine de suite : alerte ; 2 : pas encore', () => {
  // Lundi 9, mardi 10, mercredi 11 novembre 2026.
  const list = [E('2026-11-09', low), E('2026-11-10', low), E('2026-11-11', low)]
  assert.deepEqual(lowStreak(list, '2026-11-11'), ['2026-11-11', '2026-11-10', '2026-11-09'])
  assert.equal(lowAlert(lowStreak(list, '2026-11-11')), true)
  assert.equal(lowAlert(lowStreak(list.slice(1), '2026-11-11')), false)
})
ok('5 pile compte (« 5 ou moins ») ; moyenne 5,5 coupe', () => {
  assert.equal(lowStreak([E('2026-11-09', [5, 5, 5, 5]), E('2026-11-10', [5, 5, 5, 5]), E('2026-11-11', [5, 5, 5, 5])], '2026-11-11').length, 3)
  assert.equal(lowStreak([E('2026-11-09', low), E('2026-11-10', mid), E('2026-11-11', low)], '2026-11-11').length, 1)
})
ok('week-end sauté : vendredi → lundi se suivent', () => {
  // Jeudi 5, vendredi 6, lundi 9.
  const list = [E('2026-11-05', low), E('2026-11-06', low), E('2026-11-09', low)]
  assert.deepEqual(lowStreak(list, '2026-11-09'), ['2026-11-09', '2026-11-06', '2026-11-05'])
  // Le samedi et le dimanche : la série d'avant reste visible (dernier jour demandé : vendredi).
  assert.deepEqual(lowStreak(list.slice(0, 2), '2026-11-08'), ['2026-11-06', '2026-11-05'])
})
ok('un jour demandé sans réponse coupe la série', () => {
  const list = [E('2026-11-05', low), E('2026-11-06', low), E('2026-11-10', low), E('2026-11-11', low)]
  // Lundi 9 sans réponse.
  assert.deepEqual(lowStreak(list, '2026-11-11'), ['2026-11-11', '2026-11-10'])
})
ok('matinée pas finie : aujourd’hui sans réponse ne coupe pas (la série s’arrête à hier) ; une réponse haute, si', () => {
  const list = [E('2026-11-09', low), E('2026-11-10', low), E('2026-11-11', low)]
  assert.deepEqual(lowStreak(list, '2026-11-12'), ['2026-11-11', '2026-11-10', '2026-11-09'])
  assert.deepEqual(lowStreak([...list, E('2026-11-12', [8, 8, 8, 8])], '2026-11-12'), [])
})
ok('jours demandés réglables (vacances scolaires, jours fériés) : sautés aussi', () => {
  // Mercredi 11 novembre 2026 férié : mardi 10 → jeudi 12 se suivent.
  const req = (d: string) => d !== '2026-11-11' && new Date(d + 'T12:00:00Z').getUTCDay() % 6 !== 0
  const list = [E('2026-11-09', low), E('2026-11-10', low), E('2026-11-12', low)]
  assert.equal(lowStreak(list, '2026-11-12', DEFAULT_ALERT, req).length, 3)
  assert.equal(lowStreak(list, '2026-11-12').length, 1)
})
ok('note réglée : cette note seulement ; seuil et durée réglés', () => {
  const s = alertSettingsOf({ note: 'sommeil', max: 4, days: 2 })
  assert.deepEqual(s, { note: 'sommeil', max: 4, days: 2 })
  const list = [E('2026-11-10', [8, 8, 8, 4]), E('2026-11-11', [8, 8, 8, 3])]
  assert.equal(lowAlert(lowStreak(list, '2026-11-11', s), s), true)
  assert.equal(lowStreak(list, '2026-11-11').length, 0)
  // Le sommeil manque un jour : coupe.
  assert.equal(lowStreak([E('2026-11-10', [8, 8, 8, 4]), E('2026-11-11', { energie: 2 })], '2026-11-11', s).length, 0)
  assert.equal(alertText(s), '2 jours de suite à 4 ou moins (sommeil)')
})
ok('réglage du groupe relu : valeurs inconnues → par défaut', () => {
  assert.deepEqual(alertSettingsOf(undefined), DEFAULT_ALERT)
  assert.deepEqual(alertSettingsOf({ max: 12, days: 40, note: 'poids' }), DEFAULT_ALERT)
  assert.deepEqual(alertSettingsOf({ max: '5', days: 3 }), DEFAULT_ALERT)
  assert.deepEqual(alertSettingsOf([1, 2]), DEFAULT_ALERT)
})

// ---------- En-tête « Demander » ----------

ok('en-tête : le tableau filtré de chaque groupe lisible (Pôle d’abord, 3 au plus), rien d’autre', () => {
  const ctx = { wellnessGroups: [{ id: 'g1', name: 'Pôle Espoirs' }, { id: 'g2', name: 'U15' }] }
  const rs = routeAsk('donne-moi les joueurs en dessous de 6 dans le wellness', ctx)
  assert.equal(rs.length, 2)
  assert.equal(rs[0].kind, 'wellness')
  assert.equal(rs[0].to, '/groupes/g1/wellness?wl=lt-6')
  assert.match(rs[0].label, /Pôle Espoirs/)
  assert.equal(rs[0].apply, undefined)
  assert.equal(routeAsk('sommeil sous 5', ctx)[1].to, '/groupes/g2/wellness?wl=lt-5-sommeil')
  // Aucun groupe lisible : la liste des groupes, sans rien lire.
  const none = routeAsk('les joueurs en dessous de 6 dans le wellness')
  assert.equal(none.length, 1)
  assert.equal(none[0].to, '/groupes')
  // Une autre phrase : inchangée.
  assert.notEqual(routeAsk('les gauchers de 2011', ctx)[0].kind, 'wellness')
})

// ---------- Pureté, confidentialité, mots ----------

ok('module pur (ni base, ni réseau, ni IA) et mots neutres', () => {
  const src = readFileSync(new URL('../src/wellnessAlert.ts', import.meta.url), 'utf8')
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(imports, ['./wellness'])
  assert.doesNotMatch(src, /fetch\(|supabase|mistral|localStorage|sessionStorage/i)
  const page = readFileSync(new URL('../src/pages/GroupWellness.tsx', import.meta.url), 'utf8')
  for (const bad of ['mauvais', 'faible', 'pas retenu', 'mauvaise', 'nul ']) {
    assert.ok(!src.toLowerCase().includes(bad), bad)
    assert.ok(!page.toLowerCase().includes(bad), bad)
  }
  // Bulle de réglage : fenêtre accrochée (fond flouté, AnchoredBubble).
  assert.match(page, /<AnchoredBubble at=\{at\} label="Régler l’alerte du wellness"/)
})

console.log(`\n${n} tests OK`)
