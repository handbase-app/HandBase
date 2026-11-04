// Test de la période d'un objectif de travail (04/11 ; src/period.ts, src/objectives.ts, src/myGoals.ts,
// src/groupObjectives.ts, supabase/065) : raccourcis (« 1 semaine », « 1 mois », « Jusqu'à la rentrée », « Jusqu'au
// prochain stage », « Pas de fin »), début repoussé, libellés NEUTRES (« Jusqu'au 31/08 · encore 12 jours », « Commence le
// … », « Période terminée », jamais « en retard »), état avant / pendant / après, barre de temps, « Prolonger d'une
// semaine », bilan à imprimer (« du 05/07 au 31/08 »), relecture qui garde from / due (fiche, objectifs « à moi », objectifs
// donnés à un groupe), mêmes règles côté jeune, fin avant le début refusée, limites inchangées, et le script 065 qui garde
// la période comme l'appli. Textes et joueurs fictifs.
//
//   npx jiti tools/test-periode.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkGift, copyGift, giftsFrom, giveToMany } from '../src/groupObjectives'
import { addOwnGoal, cleanMyGoals, editOwnGoal, emptyMyGoals, MY_GOAL_ERRORS, myGoalsFromRow, OWN_MAX_ACTIVE, type MyGoals } from '../src/myGoals'
import { addObjective, finalizeObjectives, objectiveOrigin, objectivePrintOrigin, objectivesOf, OBJ_MAX_ACTIVE, type WorkObjective } from '../src/objectives'
import {
  addDays,
  addMonths,
  cleanPeriod,
  daysBetween,
  daysLeft,
  eventShortcutLabel,
  extendPeriod,
  matchShortcut,
  nextEventFor,
  nextSchoolStart,
  PERIOD_ERROR,
  PERIOD_SHORTCUTS,
  periodBad,
  periodElapsed,
  periodLabel,
  periodRange,
  periodStart,
  periodState,
  shortcutBase,
  shortcutEnd,
  shortDay,
} from '../src/period'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const DAY = '2026-11-04'

t('calendrier : jours, mois (fin de mois ramenée), rentrée, format court', () => {
  assert.equal(addDays('2026-11-04', 7), '2026-11-11')
  assert.equal(addDays('2026-03-28', 2), '2026-03-30') // heure d'été : sans effet
  assert.equal(addDays('2026-12-30', 3), '2027-01-02')
  assert.equal(daysBetween('2026-11-04', '2026-11-16'), 12)
  assert.equal(daysBetween('2026-11-16', '2026-11-04'), -12)
  assert.equal(addMonths('2026-11-04', 1), '2026-12-04')
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29')
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15')
  assert.equal(nextSchoolStart('2026-07-05'), '2026-09-01')
  assert.equal(nextSchoolStart('2026-08-31'), '2026-09-01')
  assert.equal(nextSchoolStart('2026-09-01'), '2027-09-01')
  assert.equal(nextSchoolStart('2026-11-04'), '2027-09-01')
  assert.equal(shortDay('2026-08-31', DAY), '31/08')
  assert.equal(shortDay('2027-09-01', DAY), '01/09/2027')
})

t('raccourcis : depuis le début repoussé, sinon depuis aujourd’hui ; « Pas de fin » ; prochain stage seulement à venir', () => {
  assert.deepEqual(
    PERIOD_SHORTCUTS.map((s) => s.label),
    ['1 semaine', '2 semaines', '1 mois', 'Jusqu’à la rentrée', 'Jusqu’au prochain stage', 'Pas de fin'],
  )
  assert.equal(shortcutBase({}, DAY), DAY)
  assert.equal(shortcutBase({ from: '2026-12-20' }, DAY), '2026-12-20')
  const ev = { date: '2026-11-18' }
  assert.equal(shortcutEnd('1s', DAY, ev), '2026-11-11')
  assert.equal(shortcutEnd('2s', DAY, ev), '2026-11-18')
  assert.equal(shortcutEnd('1m', DAY, ev), '2026-12-04')
  assert.equal(shortcutEnd('rentree', DAY, ev), '2027-09-01')
  assert.equal(shortcutEnd('evenement', DAY, ev), '2026-11-18')
  assert.equal(shortcutEnd('evenement', DAY), null)
  assert.equal(shortcutEnd('evenement', '2026-12-20', ev), null) // l'événement vient avant le début : pas proposé
  assert.equal(shortcutEnd('sans', DAY, ev), undefined)
  // Vacances : « 2 semaines » à partir du 20/12.
  assert.equal(shortcutEnd('2s', shortcutBase({ from: '2026-12-20' }, DAY)), '2027-01-03')
  // Pastille allumée : celle qui donne la fin ; plusieurs possibles → la première (« 2 semaines » = le stage) ; sinon « autre ».
  assert.equal(matchShortcut(undefined, DAY), 'sans')
  assert.equal(matchShortcut('2026-12-04', DAY), '1m')
  assert.equal(matchShortcut('2026-11-18', DAY, ev), '2s')
  assert.equal(matchShortcut('2026-11-20', DAY, { date: '2026-11-20' }), 'evenement')
  assert.equal(matchShortcut('2026-11-25', DAY), 'autre')
  assert.equal(eventShortcutLabel({ name: 'Stage de Toussaint' }), 'Jusqu’au prochain stage')
  assert.equal(eventShortcutLabel({ name: 'Tournoi de la Drôme' }), 'Jusqu’au prochain événement')
})

t('prochain événement : à venir, joueur sur la liste ; pour un groupe : commun à tous ; supprimés et archivés écartés', () => {
  const events = [
    { id: 'a', name: 'Passé', date: '2026-10-01', playerIds: ['p1', 'p2'] },
    { id: 'b', name: 'Stage loin', date: '2026-12-20', playerIds: ['p1', 'p2'] },
    { id: 'c', name: 'Tournoi', date: '2026-11-15', playerIds: ['p1'] },
    { id: 'd', name: 'Supprimé', date: '2026-11-06', playerIds: ['p1', 'p2'], deleted: true },
    { id: 'e', name: 'Archivé', date: '2026-11-07', playerIds: ['p1', 'p2'], archived: true },
    { id: 'f', name: 'Aujourd’hui', date: DAY, playerIds: ['p1', 'p2'] },
  ]
  assert.equal(nextEventFor(events, ['p1'], DAY)?.id, 'c')
  assert.equal(nextEventFor(events, ['p1', 'p2'], DAY)?.id, 'b')
  assert.equal(nextEventFor(events, ['p3'], DAY), undefined)
  assert.equal(nextEventFor(events, [], DAY), undefined)
})

t('état et libellés : avant, pendant, dernier jour, après (neutre), sans fin, atteint', () => {
  const during = { status: 'en_cours' as const, date: '2026-10-25', due: '2026-11-16' }
  assert.equal(periodState(during, DAY), 'en_cours')
  assert.equal(daysLeft(during, DAY), 12)
  assert.equal(periodLabel(during, DAY), 'Jusqu’au 16/11 · encore 12 jours')
  assert.equal(periodLabel({ ...during, due: '2026-11-05' }, DAY), 'Jusqu’au 05/11 · encore 1 jour')
  assert.equal(periodLabel({ ...during, due: DAY }, DAY), `Jusqu’au 04/11 · dernier jour`)
  assert.equal(periodState({ ...during, due: DAY }, DAY), 'en_cours') // la fin est comprise
  assert.equal(periodLabel({ ...during, due: '2027-01-10' }, DAY), 'Jusqu’au 10/01/2027 · encore 67 jours')

  const later = { status: 'en_cours' as const, date: DAY, from: '2026-12-20', due: '2027-01-03' }
  assert.equal(periodState(later, DAY), 'a_venir')
  assert.equal(periodLabel(later, DAY), 'Commence le 20/12 · jusqu’au 03/01/2027')
  assert.equal(periodLabel({ ...later, due: undefined }, DAY), 'Commence le 20/12')
  assert.equal(periodElapsed(later, DAY), undefined)
  // Le jour venu, elle est en cours.
  assert.equal(periodState(later, '2026-12-20'), 'en_cours')

  const over = { status: 'en_cours' as const, date: '2026-10-01', due: '2026-11-02' }
  assert.equal(periodState(over, DAY), 'terminee')
  assert.equal(periodLabel(over, DAY), 'Période terminée')
  // Sans fin : rien de plus qu'avant ; atteint : rien (« atteint le … » suffit).
  assert.equal(periodState({ date: '2026-10-01' }, DAY), 'sans')
  assert.equal(periodLabel({ date: '2026-10-01' }, DAY), '')
  assert.equal(periodLabel({ date: '2026-10-01', from: '2026-10-10' }, DAY), '')
  assert.equal(periodLabel({ ...over, status: 'atteint' }, DAY), '')
  assert.equal(periodLabel({ ...during, status: 'atteint' }, DAY), '')
  // Jamais un mot négatif.
  for (const o of [during, later, over, { ...during, due: DAY }])
    assert.doesNotMatch(periodLabel(o, DAY), /retard|échou|raté|dépass|manqu|trop tard/i)
})

t('début : début repoussé, sinon jour où il a été fixé, sinon jour de l’envoi (objectif donné) ; barre de temps', () => {
  assert.equal(periodStart({ date: '2026-10-01', from: '2026-12-20' }), '2026-12-20')
  assert.equal(periodStart({ date: '2026-10-01' }), '2026-10-01')
  assert.equal(periodStart({ source: { at: '2026-11-02' } }), '2026-11-02')
  assert.equal(periodStart({}), undefined)
  // Du 01/11 au 10/11 (10 jours), le 04/11 : 4 sur 10.
  assert.equal(periodElapsed({ date: '2026-11-01', due: '2026-11-10' }, DAY), 0.4)
  assert.equal(periodElapsed({ date: '2026-11-01', due: DAY }, DAY), 1)
  assert.equal(periodElapsed({ due: '2026-11-10' }, DAY), undefined) // début inconnu : pas de barre
  assert.equal(periodElapsed({ date: '2026-10-01', due: '2026-11-02' }, DAY), undefined) // terminée : pas de barre
  assert.equal(periodElapsed({ date: '2026-11-01', due: '2026-11-10', status: 'atteint' }, DAY), undefined)
})

t('prolonger d’une semaine : depuis la fin, ou depuis aujourd’hui si elle est passée', () => {
  assert.equal(extendPeriod('2026-11-02', DAY), '2026-11-11')
  assert.equal(extendPeriod('2026-11-10', DAY), '2026-11-17')
  const o = { status: 'en_cours' as const, date: '2026-10-01', due: extendPeriod('2026-11-02', DAY) }
  assert.equal(periodState(o, DAY), 'en_cours')
  assert.equal(periodLabel(o, DAY), 'Jusqu’au 11/11 · encore 7 jours')
})

t('bilan à imprimer : « du … au … », « jusqu’au … », « depuis le … » / « à partir du … » ; sinon la date', () => {
  assert.equal(periodRange({ date: '2026-07-05', due: '2026-08-31' }, DAY), 'du 05/07 au 31/08')
  assert.equal(periodRange({ date: DAY, from: '2026-12-20', due: '2027-01-03' }, DAY), 'du 20/12 au 03/01/2027')
  assert.equal(periodRange({ due: '2026-11-30' }, DAY), 'jusqu’au 30/11')
  assert.equal(periodRange({ date: '2026-10-01', from: '2026-10-05' }, DAY), 'depuis le 05/10')
  assert.equal(periodRange({ date: DAY, from: '2026-12-20' }, DAY), 'à partir du 20/12')
  assert.equal(periodRange({ date: DAY }, DAY), '')
  const o: WorkObjective = { id: 'o', text: 'A', status: 'en_cours', eventId: 'ev', eventName: 'Stage de rentrée', date: '2026-08-28', due: '2026-10-31' }
  assert.equal(objectivePrintOrigin(o, DAY), 'Stage de rentrée · du 28/08 au 31/10')
  assert.equal(objectivePrintOrigin({ ...o, due: undefined }, DAY), 'Stage de rentrée · 28/08')
  assert.equal(objectivePrintOrigin({ ...o, due: undefined }, DAY, (d) => d.split('-').reverse().join('/')), 'Stage de rentrée · 28/08/2026')
  // La carte : l'origine ne dit plus « avant le … » (la période se dit à part).
  assert.equal(objectiveOrigin(o, (d) => d.split('-').reverse().join('/')), 'Stage de rentrée · 28/08/2026')
})

t('fin avant le début : refusée (message neutre) ; relecture : jours valables seulement', () => {
  assert.equal(periodBad({ date: DAY, due: '2026-11-01' }), true)
  assert.equal(periodBad({ date: DAY, from: '2026-12-20', due: '2026-12-01' }), true)
  assert.equal(periodBad({ date: DAY, from: '2026-12-20', due: '2026-12-20' }), false)
  assert.equal(periodBad({ due: '2026-11-01' }), false) // début inconnu : rien à comparer
  assert.equal(periodBad({ date: DAY }), false)
  assert.doesNotMatch(PERIOD_ERROR, /retard/i)
  assert.deepEqual(cleanPeriod({ from: '2026-12-20', due: '2027-01-03' }), { from: '2026-12-20', due: '2027-01-03' })
  assert.deepEqual(cleanPeriod({ from: '20/12/2026', due: 12 }), {})
})

t('fiche (staff) : from et due gardés à la relecture et à « Terminé » ; ancienne forme inchangée ; 3 en cours au plus', () => {
  const raw = [
    { id: 'a', text: 'Gagner en détente', status: 'en_cours', date: DAY, from: '2026-12-20', due: '2027-01-03' },
    { id: 'b', text: 'Oser le tir', status: 'en_cours', date: DAY, from: 'demain', due: 'bientôt' },
    { id: 'c', text: 'Sans période', status: 'en_cours' },
  ]
  const l = objectivesOf({ objectives: raw })
  assert.deepEqual(l[0], raw[0])
  assert.deepEqual(l[1], { id: 'b', text: 'Oser le tir', status: 'en_cours', date: DAY })
  assert.deepEqual(l[2], { id: 'c', text: 'Sans période', status: 'en_cours' })
  assert.deepEqual(finalizeObjectives(l), l)
  // Effacée dans la modification (clé à undefined) : ôtée.
  assert.deepEqual(finalizeObjectives([{ ...raw[0], from: undefined, due: undefined }])[0], { id: 'a', text: 'Gagner en détente', status: 'en_cours', date: DAY })
  // La période ne change pas la limite.
  const r = addObjective(l, { text: 'Un quatrième' }, 'd')
  assert.deepEqual(r, { ok: false, error: 'max' })
  assert.equal(OBJ_MAX_ACTIVE, 3)
})

t('donné à un groupe : période contrôlée, recopiée sur chaque fiche, montrée dans « Objectifs donnés »', () => {
  const c = checkGift({ text: 'Courir 20 minutes par jour', steps: [], from: '2026-12-20', due: '2027-01-03' })
  assert.ok(c.ok)
  assert.equal(c.gift.from, '2026-12-20')
  assert.equal(c.gift.due, '2027-01-03')
  assert.deepEqual(checkGift({ text: 'A', steps: [], from: '2026-12-20', due: '2026-12-01' }), { ok: false, error: 'periode' })
  const noDates = checkGift({ text: 'A', steps: [], from: 'jamais', due: '31/12/2026' })
  assert.ok(noDates.ok && noDates.gift.from === undefined && noDates.gift.due === undefined)
  let k = 0
  const newId = () => `id-${++k}`
  const copy = copyGift(c.gift, { kind: 'groupe', id: 'g', name: 'Pôle', batch: 'lot' }, newId)
  assert.equal(copy.from, '2026-12-20')
  assert.equal(copy.due, '2027-01-03')
  const r = giveToMany([{ id: 'p1' }, { id: 'p2' }], c.gift, { kind: 'groupe', id: 'g', name: 'Pôle' }, { canEdit: () => true, newId, batch: 'lot-1', day: DAY })
  const back = objectivesOf(r.rows[0])[0]
  assert.equal(back.from, '2026-12-20')
  assert.equal(back.due, '2027-01-03')
  // Sans date, la période commence au jour de l'envoi.
  assert.equal(periodStart(back), '2026-12-20')
  assert.equal(periodStart({ ...back, from: undefined }), DAY)
  const v = giftsFrom(r.rows, { kind: 'groupe', id: 'g' })[0]
  assert.equal(v.from, '2026-12-20')
  assert.equal(v.due, '2027-01-03')
  assert.equal(periodLabel({ from: v.from, due: v.due, date: v.at }, DAY), 'Commence le 20/12 · jusqu’au 03/01/2027')
})

t('côté jeune : mêmes règles (période gardée, fin avant le début refusée, 5 en cours au plus)', () => {
  const g0 = emptyMyGoals()
  const add = addOwnGoal(g0, { text: 'Le tir en suspension', steps: [], from: '2026-12-20', due: '2027-01-03' }, 'm-1', DAY)
  assert.ok(add.ok)
  const g: MyGoals = add.goals
  assert.deepEqual(g.own[0], { id: 'm-1', text: 'Le tir en suspension', status: 'en_cours', date: DAY, from: '2026-12-20', due: '2027-01-03' })
  // Fin avant le jour où il est fixé, ou avant le début repoussé : refusée.
  assert.deepEqual(addOwnGoal(g0, { text: 'A', steps: [], due: '2026-11-01' }, 'x', DAY), { ok: false, error: 'periode' })
  assert.deepEqual(addOwnGoal(g0, { text: 'A', steps: [], from: '2026-12-20', due: '2026-12-10' }, 'x', DAY), { ok: false, error: 'periode' })
  assert.equal(MY_GOAL_ERRORS.periode, PERIOD_ERROR)
  // Modifier : période changée ou retirée ; la date (jour où il a été fixé) reste.
  const e = editOwnGoal(g, 'm-1', { text: 'Le tir en suspension', steps: [], due: '2026-11-30' })
  assert.ok(e.ok)
  assert.deepEqual(e.goals.own[0], { id: 'm-1', text: 'Le tir en suspension', status: 'en_cours', date: DAY, due: '2026-11-30' })
  const e2 = editOwnGoal(e.goals, 'm-1', { text: 'Le tir en suspension', steps: [] })
  assert.ok(e2.ok)
  assert.deepEqual(e2.goals.own[0], { id: 'm-1', text: 'Le tir en suspension', status: 'en_cours', date: DAY })
  // Relecture (appareil, serveur) : from et due gardés (jours valables seulement), comme hb_go_clean_own (065).
  const read = myGoalsFromRow({ own: [{ id: 'a', text: 'A', status: 'en_cours', date: DAY, from: '2026-12-20', due: '2027-01-03' }, { id: 'b', text: 'B', from: 'x', due: 3 }], checks: {} })
  assert.deepEqual(read.own, [
    { id: 'a', text: 'A', status: 'en_cours', date: DAY, from: '2026-12-20', due: '2027-01-03' },
    { id: 'b', text: 'B', status: 'en_cours' },
  ])
  assert.deepEqual(cleanMyGoals(JSON.parse(JSON.stringify(g))), g)
  // 5 en cours au plus, période ou pas.
  let full = g0
  for (let i = 0; i < OWN_MAX_ACTIVE; i++) {
    const r = addOwnGoal(full, { text: `Objectif ${i}`, steps: [], due: '2026-12-01' }, `o-${i}`, DAY)
    assert.ok(r.ok)
    full = r.goals
  }
  assert.deepEqual(addOwnGoal(full, { text: 'Un de trop', steps: [] }, 'z', DAY), { ok: false, error: 'max' })
})

t('script 065 : la période gardée comme l’appli (hb_go_clean_own), en-tête à jour, contrôle attendu inchangé', () => {
  const sql = readFileSync(new URL('../supabase/065_objectifs_etapes.sql', import.meta.url), 'utf8')
  const fn = sql.slice(sql.indexOf('create or replace function public.hb_go_clean_own'), sql.indexOf('create or replace function public.hb_go_active'))
  assert.match(fn, /'from', public\.hb_go_day\(public\.hb_go_str\(o, 'from'\)\)/)
  assert.match(fn, /'due', public\.hb_go_day\(public\.hb_go_str\(o, 'due'\)\)/)
  assert.match(sql, /steps\?, from\?, due\? \}/)
  assert.match(sql, /-- Attendu : t 2 t f 2 0/)
  const essai = readFileSync(new URL('./essai-sql-065/essais.sql', import.meta.url), 'utf8')
  assert.match(essai, /"from":"2026-12-20","due":"2027-01-03"/)
})

t('écrans : un seul composant partagé (fiche, groupe, « Mon objectif ») ; plus de champ « avant le » ; démo', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const objectives = read('../src/components/Objectives.tsx')
  const group = read('../src/components/GroupObjectives.tsx')
  assert.equal((objectives.match(/<PeriodPicker\b/g) ?? []).length, 2) // carte de la fiche, fenêtre « Mon objectif »
  assert.equal((group.match(/<PeriodPicker\b/g) ?? []).length, 1)
  assert.match(objectives, /<PeriodNote o=\{o\} \/>/)
  assert.doesNotMatch(group, /avant le/)
  assert.match(read('../src/components/FamilyReport.tsx'), /objectivePrintOrigin\(/)
  const picker = read('../src/components/PeriodPicker.tsx')
  assert.match(picker, /Commencer plus tard/)
  assert.match(picker, /Prolonger d’une semaine/)
  assert.doesNotMatch(picker, /(text|bg|border)-red/)
  // Rien vers une IA.
  assert.doesNotMatch(read('../src/period.ts') + picker, /ai\(|anthropic|openai|gemini|fetch\(/i)
  // Démo : période en cours, commence plus tard, terminée, objectif du groupe jusqu'au prochain stage (dates relatives).
  const demo = read('../src/demo.ts')
  assert.match(demo, /due: day\(12\)/)
  assert.match(demo, /from: day\(46\)/)
  assert.match(demo, /due: day\(-2\)/)
  assert.match(demo, /name: 'Stage de Toussaint', type: 'entrainement', date: day\(14\), place: 'Valence', playerIds: players\.map/)
})

console.log(`\n${n} tests passés`)
