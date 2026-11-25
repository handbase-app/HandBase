// Test de l'auto-évaluation du jeune (src/selfEval.ts, vague 2 « Génération Bleue » ; règles reprises par
// supabase/064_auto_evaluation.sql) : fenêtre du jour de l'événement à 14 jours après, événement passé et jeune sur la liste
// (match, tournoi, entraînement ; jamais une observation), une seule par événement, tout vide = retirée, notes et textes
// nettoyés, mots positifs ou neutres, hors des avis et des moyennes, cohérence avec le script SQL. Données fictives.
//
//   npx jiti tools/test-auto-evaluation.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addDays,
  avisAndSelf,
  cleanScores,
  cleanSelfEval,
  cleanSelfEvalText,
  levelWord,
  saveSelfEvalLocal,
  selfEvalChips,
  selfEvalConcerns,
  selfEvalErrorText,
  selfEvalEvents,
  selfEvalFromRow,
  selfEvalMissing,
  selfEvalUntil,
  selfEvalWindowOpen,
  SELF_EVAL_CRITERIA,
  SELF_EVAL_DAYS,
  SELF_EVAL_ERRORS,
  SELF_EVAL_LEVELS,
  SELF_EVAL_TEXT_MAX,
  SELF_EVAL_TYPES,
  toFill,
  type SelfEval,
} from '../src/selfEval'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const TODAY = '2026-11-04'
const ev = (id: string, type: string, daysAgo: number, ids: string[], deleted = false) => ({
  id,
  name: `Événement ${id}`,
  type,
  date: addDays(TODAY, -daysAgo),
  place: 'Salle fictive',
  playerIds: ids,
  deleted,
})
const events = [
  ev('ok', 'tournoi', 3, ['p1', 'p2']),
  ev('auj', 'match', 0, ['p1']),
  ev('j14', 'entrainement', 14, ['p1']),
  ev('j15', 'match', 15, ['p1']),
  ev('futur', 'entrainement', -5, ['p1']),
  ev('obs', 'observation', 2, ['p1']),
  ev('autre', 'match', 1, ['p2']),
  ev('suppr', 'match', 2, ['p1'], true),
  ev('vieux', 'tournoi', 90, ['p1']),
]
const input = { scores: { engagement: 4 }, good: 'Mes passes', work: '' }

t('règle des 14 jours : du jour même (compris) à 14 jours après (compris)', () => {
  assert.equal(SELF_EVAL_DAYS, 14)
  assert.equal(selfEvalUntil('2026-11-01'), '2026-11-15')
  assert.equal(selfEvalWindowOpen('2026-11-04', TODAY), true) // jour même
  assert.equal(selfEvalWindowOpen('2026-10-21', TODAY), true) // 14 jours
  assert.equal(selfEvalWindowOpen('2026-10-20', TODAY), false) // 15 jours
  assert.equal(selfEvalWindowOpen('2026-11-05', TODAY), false) // demain
  assert.equal(selfEvalWindowOpen('pas une date', TODAY), false)
  // Passage à l'heure d'hiver (25/10) sans effet.
  assert.equal(selfEvalUntil('2026-10-20'), '2026-11-03')
})

t('événement concerné : type match / tournoi / entraînement, pas supprimé, jeune sur la liste', () => {
  assert.deepEqual([...SELF_EVAL_TYPES], ['match', 'tournoi', 'entrainement'])
  const concerned = events.filter((e) => selfEvalConcerns(e, 'p1')).map((e) => e.id)
  assert.deepEqual(concerned, ['ok', 'auj', 'j14', 'j15', 'futur', 'vieux'])
})

t('page du jeune : passés et récents, ouverts dans la fenêtre ; ni à venir, ni observation, ni d’un autre', () => {
  const list = selfEvalEvents(events, 'p1', [], TODAY)
  assert.deepEqual(
    list.map((e) => `${e.eventId}:${e.open}`),
    ['auj:true', 'ok:true', 'j14:true', 'j15:false'],
  )
  assert.deepEqual(toFill(list).map((e) => e.eventId), ['auj', 'ok', 'j14'])
  assert.equal(list[1].until, selfEvalUntil(list[1].date))
  // Autre jeune : seulement les siens.
  assert.deepEqual(selfEvalEvents(events, 'p2', [], TODAY).map((e) => e.eventId), ['autre', 'ok'])
})

t('enregistrer : une seule par événement, modifiable dans la fenêtre', () => {
  let mine: SelfEval[] = []
  const r1 = saveSelfEvalLocal(mine, events[0], 'p1', input, TODAY, '2026-11-04T10:00:00.000Z')
  assert.ok(r1.ok)
  mine = r1.list
  const r2 = saveSelfEvalLocal(mine, events[0], 'p1', { scores: { plaisir: 5 }, good: '', work: 'Mon repli' }, TODAY, '2026-11-04T11:00:00.000Z')
  assert.ok(r2.ok)
  mine = r2.list
  assert.equal(mine.length, 1)
  assert.deepEqual(mine[0], {
    eventId: 'ok',
    eventType: 'tournoi',
    eventDate: '2026-11-01',
    eventName: 'Événement ok',
    scores: { plaisir: 5 },
    work: 'Mon repli',
    at: '2026-11-04T11:00:00.000Z',
  })
  // La page la montre remplie, toujours ouverte.
  const l = selfEvalEvents(events, 'p1', mine, TODAY)
  assert.equal(l.find((e) => e.eventId === 'ok')!.mine?.work, 'Mon repli')
  assert.equal(toFill(l).some((e) => e.eventId === 'ok'), false)
})

t('refus : hors fenêtre, à venir, pas sur la liste, observation, supprimé, inconnu', () => {
  const save = (e: (typeof events)[number] | undefined) => saveSelfEvalLocal([], e, 'p1', input, TODAY, 'x')
  const byId = (id: string) => events.find((e) => e.id === id)
  assert.deepEqual(save(byId('j15')), { ok: false, error: 'fenetre_fermee' })
  assert.deepEqual(save(byId('futur')), { ok: false, error: 'pas_encore' })
  assert.deepEqual(save(byId('autre')), { ok: false, error: 'evenement_inconnu' })
  assert.deepEqual(save(byId('obs')), { ok: false, error: 'evenement_inconnu' })
  assert.deepEqual(save(byId('suppr')), { ok: false, error: 'evenement_inconnu' })
  assert.deepEqual(save(undefined), { ok: false, error: 'evenement_inconnu' })
  assert.ok(save(byId('j14')).ok)
  assert.ok(save(byId('auj')).ok)
})

t('tout vide : retirée', () => {
  const r1 = saveSelfEvalLocal([], events[0], 'p1', input, TODAY, 'x')
  assert.ok(r1.ok)
  const r2 = saveSelfEvalLocal(r1.list, events[0], 'p1', { scores: { bidule: 3 }, good: '   ', work: '\n' }, TODAY, 'y')
  assert.ok(r2.ok)
  assert.equal(r2.saved, null)
  assert.deepEqual(r2.list, [])
  assert.equal(cleanSelfEval({ scores: {}, good: '', work: '' }), null)
})

t('notes et textes nettoyés (comme le serveur)', () => {
  assert.deepEqual(cleanScores({ engagement: 4, plaisir: 7, bidule: 3, progres: 2.5, collectif: '5', concentration: 5 }), { engagement: 4, concentration: 5 })
  assert.deepEqual(cleanScores(null), {})
  assert.equal(cleanSelfEvalText('  Mes passes\u0007 décisives \r\n '), 'Mes passes décisives')
  assert.equal(cleanSelfEvalText('é'.repeat(400)).length, SELF_EVAL_TEXT_MAX)
  assert.equal(cleanSelfEvalText(3), '')
})

t('mots positifs ou neutres, jamais de jugement', () => {
  assert.deepEqual([...SELF_EVAL_LEVELS], ['Un peu', 'Assez', 'Bien', 'Très bien', 'À fond'])
  for (const wd of [...SELF_EVAL_LEVELS, ...SELF_EVAL_CRITERIA.map((c) => c.label), ...Object.values(SELF_EVAL_ERRORS)])
    assert.doesNotMatch(wd, /nul|raté|mauvais|faible|insuffisant|échec/i)
  assert.equal(levelWord(5), 'À fond')
  assert.equal(levelWord(9), '')
  assert.ok(SELF_EVAL_CRITERIA.length >= 3 && SELF_EVAL_CRITERIA.length <= 5)
})

t('hors des avis et des moyennes : les avis restent tels quels, le regard du jeune à part, en mots', () => {
  const evaluations = [
    { id: 'a1', eventId: 'ok', scores: { vision: 4 } },
    { id: 'a2', eventId: 'ok', scores: { vision: 2 } },
    { id: 'a3', eventId: 'autre', scores: { vision: 5 } },
  ]
  const self: SelfEval = { eventId: 'ok', eventType: 'tournoi', eventDate: '2026-11-01', scores: { engagement: 5, plaisir: 1 }, at: 'x' }
  const r = avisAndSelf(evaluations, [self], 'ok')
  assert.deepEqual(r.staff.map((e) => e.id), ['a1', 'a2'])
  assert.equal(r.self, self)
  // La moyenne des avis de l'événement ne bouge pas avec l'auto-évaluation.
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  assert.equal(mean(r.staff.map((e) => e.scores.vision)), 3)
  // Pas la forme d'un avis (ni observateur, ni critères du staff) : rien ne peut la prendre pour un avis.
  assert.ok(!('observer' in self) && !('playerId' in self))
  // Affichée en mots, une ligne par critère, sans total ni moyenne.
  assert.deepEqual(selfEvalChips(self).map((c) => `${c.label} : ${c.word}`), ['Mon engagement : À fond', 'Mon plaisir de jouer : Un peu'])
  // Les avis, radars, exports et le bilan n'en savent rien (aucun de ces fichiers ne l'importe).
  for (const f of ['src/components/Opinions.tsx', 'src/components/OpinionsRadar.tsx', 'src/export.ts', 'src/bilanReport.ts', 'src/components/FamilyReport.tsx']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /selfEvalApi|fetchPlayerSelfEvals/, `${f} ne lit pas les auto-évaluations`)
  }
  // Opinions ne la reçoit que pour l'afficher à côté (SelfEvalBeside), jamais dans ses calculs.
  const op = readFileSync(new URL('../src/components/Opinions.tsx', import.meta.url), 'utf8')
  assert.equal((op.match(/selfEvals/g) ?? []).length, 3) // la prop, son type, l'affichage à côté
})

t('rangées du serveur lues sans erreur', () => {
  assert.deepEqual(
    selfEvalFromRow({ event_id: 'ok', event_type: 'tournoi', event_date: '2026-11-01', event_name: 'T', scores: { engagement: 4, x: 9 }, good: null, work: 'W', updated_at: '2026-11-04T10:00:00+00:00' }),
    { eventId: 'ok', eventType: 'tournoi', eventDate: '2026-11-01', eventName: 'T', scores: { engagement: 4 }, work: 'W', at: '2026-11-04T10:00:00.000Z' },
  )
  assert.equal(selfEvalFromRow({ event_id: 3 }), null)
  // Réponse des fonctions (clés de l'appli).
  assert.equal(selfEvalFromRow({ eventId: 'ok', eventType: 'match', eventDate: '2026-11-01', scores: {}, at: '2026-11-04T10:00:00Z' })?.eventType, 'match')
})

t('script pas passé : repli silencieux ; erreurs du serveur en clair', () => {
  assert.ok(selfEvalMissing('PGRST202') && selfEvalMissing('PGRST205') && selfEvalMissing('42P01'))
  assert.ok(!selfEvalMissing('P0001'))
  assert.equal(selfEvalErrorText('fenetre_fermee', 'P0001'), SELF_EVAL_ERRORS.fenetre_fermee)
  assert.equal(selfEvalErrorText('evenement_inconnu'), SELF_EVAL_ERRORS.evenement_inconnu)
  assert.match(selfEvalErrorText(undefined, 'PGRST202'), /pas encore ouvert/i)
})

t('cohérence avec supabase/064_auto_evaluation.sql', () => {
  const sql = readFileSync(new URL('../supabase/064_auto_evaluation.sql', import.meta.url), 'utf8')
  // Mêmes critères (hb_se_scores) et mêmes types.
  const keys = /unnest\(array\[([^\]]+)\]\) k/.exec(sql)![1].match(/'([a-z]+)'/g)!.map((s) => s.slice(1, -1))
  assert.deepEqual(keys, SELF_EVAL_CRITERIA.map((c) => c.key))
  assert.match(sql, /in \('match', 'tournoi', 'entrainement'\)/)
  // Même fenêtre (14 jours), même longueur de texte (300), mêmes refus.
  assert.match(sql, /v_day > v_d \+ 14/)
  assert.match(sql, /'until', to_char\(ev\.d \+ 14/)
  assert.match(sql, /, 300\)/)
  for (const k of Object.keys(SELF_EVAL_ERRORS)) if (k !== 'pas_joueur' && k !== 'sans_fiche') assert.match(sql, new RegExp(`'${k}'`))
  assert.match(sql, /v_day - 60/)
})

console.log(`\n${n} essais réussis`)
