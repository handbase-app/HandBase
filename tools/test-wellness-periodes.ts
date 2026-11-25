// Test du wellness du groupe dans le temps (src/wellness.ts : periodBounds, groupPeriod, gaugeGap, gapText, formeTrend,
// prevStaffDay, nextStaffDay ; src/demoWellness.ts : buildDemoWellnessLastYear ; écran : src/pages/GroupWellness.tsx ;
// serveur : supabase/082_wellness_groupe_moyennes.sql, même calcul, parité : tools/essai-sql-082/parite.ts). Données fictives.
//
//   npx jiti tools/test-wellness-periodes.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildDemoWellness, buildDemoWellnessLastYear, DEMO_LAST_YEAR_SHIFT } from '../src/demoWellness'
import {
  addDays,
  formeDuJour,
  formeTrend,
  gapText,
  gaugeGap,
  groupDay,
  groupPeriod,
  isWeekday,
  LAST_YEAR_SHIFT,
  nextStaffDay,
  PERIOD_GAP,
  PERIOD_KEYS,
  PERIOD_LABEL,
  periodBounds,
  prevStaffDay,
  WELLNESS_KEYS,
  type Gauge,
  type WellnessEntry,
} from '../src/wellness'

let n = 0
const ok = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok : ${name}`)
}
const e = (day: string, scores: WellnessEntry['scores'], pain?: number): WellnessEntry =>
  ({ day, scores, pain: pain !== undefined, ...(pain !== undefined ? { pains: [{ zone: 'tete', type: 'gene', intensite: pain }] } : {}) }) as WellnessEntry

const MON = '2026-11-23'

ok('bornes des repères : 7 jours, 30 jours, 4 semaines autour du même jour il y a 52 semaines', () => {
  const b = periodBounds(MON)
  assert.deepEqual(b.semaine, { from: '2026-11-17', to: MON })
  assert.deepEqual(b.mois, { from: '2026-10-25', to: MON })
  assert.equal(addDays(MON, -LAST_YEAR_SHIFT), '2025-11-24')
  assert.deepEqual(b.an, { from: '2025-11-10', to: '2025-12-08' })
  // 52 semaines : même jour de la semaine.
  assert.equal(new Date(addDays(MON, -LAST_YEAR_SHIFT) + 'T12:00:00Z').getUTCDay(), new Date(MON + 'T12:00:00Z').getUTCDay())
  assert.deepEqual(PERIOD_KEYS, ['semaine', 'mois', 'an'])
})

ok('moyennes du groupe : toutes les réponses de la période, notes données seulement, forme = moyenne des formes du jour', () => {
  const a = [e(MON, { energie: 8, fraicheur: 7, humeur: 9, sommeil: 6 }, 8), e('2026-11-20', { energie: 5, fraicheur: 5, humeur: 5, sommeil: 5 }), e('2026-10-01', { energie: 1 })]
  const b = [e(MON, { energie: 6, fraicheur: 6 }), e('2026-11-11', { energie: 7 })]
  const day = groupPeriod([a, b], MON, MON)
  assert.equal(day.answers, 2)
  assert.equal(day.players, 2)
  assert.deepEqual(day.avg, { energie: 7, fraicheur: 6.5, humeur: 9, sommeil: 6 })
  // 7,5 − 2 = 5,5 et 6 → 5,75 (formeDuJour, inchangée).
  assert.equal(formeDuJour(a[0])!.value, 5.5)
  assert.equal(day.forme, 5.75)
  const month = groupPeriod([a, b], '2026-10-25', MON)
  assert.equal(month.answers, 4)
  assert.equal(month.players, 2)
  assert.deepEqual(month.avg, { energie: 6.5, fraicheur: 6, humeur: 7, sommeil: 5.5 })
  assert.equal(month.forme, 5.88)
  // Même jour : les mêmes chiffres que groupDay (en-tête), au dixième.
  const gd = groupDay([a[0], b[0]])
  for (const k of WELLNESS_KEYS) assert.equal(Math.round((day.avg[k] ?? 0) * 10) / 10, gd.avg[k] ?? 0)
  // Rien sur la période : null partout, 0 réponse.
  const none = groupPeriod([a, b], '2024-01-01', '2024-01-31')
  assert.deepEqual(none, { from: '2024-01-01', to: '2024-01-31', answers: 0, players: 0, avg: { energie: null, fraicheur: null, humeur: null, sommeil: null }, forme: null })
  // Une gêne seule (pas de note) : compte comme réponse, pas dans la forme.
  const pain = groupPeriod([[{ day: MON, scores: {}, pain: true, pains: [{ zone: 'tete', type: 'gene', intensite: 3 }] } as WellnessEntry]], MON, MON)
  assert.equal(pain.answers, 1)
  assert.equal(pain.forme, null)
})

ok('ce qui ressort d’une jauge : l’an dernier d’abord, puis le mois, puis la semaine, à un point ou plus', () => {
  const g = (value: number | null, semaine: number | null, mois: number | null, an: number | null): Gauge => ({ value, refs: { semaine, mois, an } })
  assert.deepEqual(gaugeGap(g(5, 5.2, 5.4, 7)), { ref: 'an', diff: -2 })
  assert.deepEqual(gaugeGap(g(5, 5.2, 6.3, 5.5)), { ref: 'mois', diff: -1.3 })
  assert.deepEqual(gaugeGap(g(7, 6, 6.5, null)), { ref: 'semaine', diff: 1 })
  assert.equal(gaugeGap(g(6, 6.5, 5.4, 6.9)), null)
  assert.equal(gaugeGap(g(null, 6, 6, 6)), null)
  assert.equal(gaugeGap(g(6, null, null, null)), null)
  assert.equal(PERIOD_GAP, 1)
  assert.equal(gapText({ ref: 'an', diff: -2 }, 7), '2 de moins que l’an dernier (7)')
  assert.equal(gapText({ ref: 'mois', diff: 1.3 }, 5.4), '1,3 de plus que les 30 derniers jours (5,4)')
  assert.equal(PERIOD_LABEL.semaine.short, '7 j')
})

ok('petites barres : les 10 derniers jours de semaine jusqu’au jour choisi, sans réponse = null', () => {
  const list = [e(MON, { energie: 8 }), e('2026-11-20', { energie: 6 }), e('2026-11-21', { energie: 9 })]
  const t = formeTrend(list, MON)
  assert.equal(t.length, 10)
  assert.equal(t[9].day, MON)
  assert.equal(t[9].forme, 8)
  assert.equal(t[8].day, '2026-11-20')
  assert.equal(t[8].forme, 6)
  assert.ok(t.every((x) => isWeekday(x.day)))
  assert.equal(t[0].day, '2026-11-10')
  assert.equal(t.filter((x) => x.forme === null).length, 8)
  // Un samedi choisi : jusqu'au vendredi.
  assert.equal(formeTrend(list, '2026-11-21')[9].day, '2026-11-20')
})

ok('‹ › : jour de semaine d’avant / d’après, jamais après le jour présent', () => {
  assert.equal(prevStaffDay(MON), '2026-11-20')
  assert.equal(prevStaffDay('2026-11-20'), '2026-11-19')
  assert.equal(nextStaffDay('2026-11-20', MON), MON)
  assert.equal(nextStaffDay(MON, MON), null)
  assert.equal(nextStaffDay('2026-11-19', '2026-11-20'), '2026-11-20')
  assert.equal(nextStaffDay('2026-11-21', MON), MON)
})

ok('démonstration : saison passée fictive, jours de semaine, déterministe, écarts visibles', () => {
  const ids = ['demo-a', 'demo-b', 'demo-c', 'demo-d']
  const ly = buildDemoWellnessLastYear(ids, MON)
  assert.deepEqual(buildDemoWellnessLastYear(ids, MON), ly)
  for (const id of ids) {
    const list = ly[id]
    assert.ok(list.length > 150, `${id} : ${list.length}`)
    assert.ok(list.every((x) => isWeekday(x.day) && x.day >= '2025-09-01' && x.day <= '2026-06-30'))
    assert.ok(list.every((x) => WELLNESS_KEYS.every((k) => Number.isInteger(x.scores[k]) && x.scores[k]! >= 1 && x.scores[k]! <= 10)))
  }
  // Les deux premiers : tous les jours de semaine.
  assert.equal(ly['demo-a'].length, ly['demo-b'].length)
  // Écarts : l'an dernier, énergie plus haute, humeur plus basse que cette saison (même groupe).
  const now = buildDemoWellness(ids, MON)
  const b = periodBounds(MON)
  const cur = groupPeriod(ids.map((id) => now[id].entries), b.mois.from, b.mois.to)
  const last = groupPeriod(ids.map((id) => ly[id]), b.an.from, b.an.to)
  assert.ok(last.answers > 30)
  assert.ok(last.avg.energie! - cur.avg.energie! >= 1, `énergie ${last.avg.energie} / ${cur.avg.energie}`)
  assert.ok(cur.avg.humeur! - last.avg.humeur! >= 0.5, `humeur ${last.avg.humeur} / ${cur.avg.humeur}`)
  assert.equal(DEMO_LAST_YEAR_SHIFT.fraicheur, 0)
  // Avant la saison en cours : jamais un jour de cette saison (la lampe ne la compte pas).
  assert.ok(Object.values(ly).every((list) => list.every((x) => x.day < '2026-09-01')))
})

ok('confidentialité et mots : rien gardé sur l’appareil côté staff, mots neutres', () => {
  const page = readFileSync(new URL('../src/pages/GroupWellness.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /localStorage|sessionStorage|db\.\w+\.(put|add|bulkPut)/)
  for (const bad of ['mauvais', 'faible', 'pas retenu', 'mauvaise', 'nul ', 'mort']) assert.ok(!page.toLowerCase().includes(bad), bad)
  const api = readFileSync(new URL('../src/wellnessApi.ts', import.meta.url), 'utf8')
  const avg = api.slice(api.indexOf('export async function fetchGroupAverages'), api.indexOf('export interface PlayerWellnessData'))
  assert.doesNotMatch(avg, /writeLocal|localStorage\.setItem|db\./)
  // Choix du jour : bulle accrochée, fond flouté (AnchoredBubble) ; le jour gardé dans l'entrée d'historique (« Retour »).
  assert.match(page, /<AnchoredBubble at=\{at\} label="Choisir le jour du tableau"/)
  assert.match(page, /useEntryState<string \| null>\(`wellness\.\$\{id\}\.jour`, null\)/)
})

console.log(`\n${n} tests OK`)
