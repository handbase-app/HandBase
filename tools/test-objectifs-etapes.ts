// Test des objectifs en liste à cocher avec des étapes (04/11 ; src/objectives.ts, src/myGoals.ts, src/goalTemplates.ts) :
// étapes (8 au plus, nettoyées, cochées une fois), liens vidéo http(s) seulement, ancienne forme sans étapes gardée telle
// quelle, avancement « 1 étape sur 3 », vue commune (staff puis « à moi »), droits (le staff coche et modifie les siens ; le
// jeune coche toutes les étapes et ses objectifs, jamais l'« atteint » ni le texte du staff), limites (3 en cours pour le
// staff, 5 pour le jeune), coches du jeune (étapes de SA fiche seulement, jour gardé), modèles d'objectifs (nettoyage,
// reprise sur la fiche, ceux de la démo), libellés positifs, rien vers une IA. Textes fictifs.
//
//   npx jiti tools/test-objectifs-etapes.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addObjective,
  badVideoUrl,
  cleanVideoUrl,
  finalizeObjectives,
  OBJ_MAX_ACTIVE,
  OBJ_STEPS_MAX,
  objectivesOf,
  progressLabel,
  setStepDone,
  staffStepIds,
  stepsOf,
  type WorkObjective,
} from '../src/objectives'
import {
  addOwnGoal,
  cleanMyGoals,
  editOwnGoal,
  emptyMyGoals,
  goalRights,
  goalViews,
  MY_GOAL_ERRORS,
  myGoalsFromRow,
  OWN_MAX_ACTIVE,
  pruneChecks,
  removeOwnGoal,
  setOwnGoalStatus,
  setStaffStepCheck,
  stepCheckable,
  type MyGoals,
} from '../src/myGoals'
import { cleanTemplates, DEMO_TEMPLATES, GOAL_TEMPLATES_KEY, isDemoTemplatesValue, objectiveFromTemplate, templatesOf } from '../src/goalTemplates'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}
const ok = (r: { ok: true; goals: MyGoals } | { ok: false; error: string }): MyGoals => {
  if (!r.ok) throw new Error(`refusé : ${r.error}`)
  return r.goals
}
const DAY = '2026-11-04'

// Fiche fictive : un objectif du staff avec trois étapes (une cochée par le staff), un sans étape (ancienne forme).
const staff: WorkObjective[] = objectivesOf({
  objectives: [
    {
      id: 'o-1',
      text: 'Gagner en détente',
      status: 'en_cours',
      steps: [
        { id: 'e-1', text: 'Corde à sauter 10 min par jour' },
        { id: 'e-2', text: 'Sauts sur banc', done: '2026-11-01' },
        { id: 'e-3', text: 'Test de détente dans 6 semaines', video: 'https://exemple.test/test' },
      ],
    },
    { id: 'o-2', text: 'Parler en défense', status: 'atteint', doneAt: '2026-10-20' },
  ],
})

t('ancienne forme (sans étapes) : lue telle quelle, sans clé ajoutée', () => {
  const old = [{ id: 'a', text: 'Oser le tir de loin', status: 'en_cours', eventId: 'ev', eventName: 'Stage', date: '2026-08-28' }]
  assert.deepEqual(objectivesOf({ objectives: old }), old)
  assert.deepEqual(finalizeObjectives(old), old)
  assert.equal('steps' in staff[1], false)
  // Ajouter un objectif : toujours sans étapes ni lien tant qu'on n'en met pas.
  const r = addObjective([], { text: 'Nouveau' }, 'n')
  assert.ok(r.ok && !('steps' in r.list[0]) && !('video' in r.list[0]))
})

t('étapes : nettoyées, sans doublon, 8 au plus, cochées une fois', () => {
  const s = stepsOf([
    { id: 'a', text: '  Corde\n à sauter  ' },
    { id: 'a', text: 'doublon' },
    { id: 'b', text: '   ' },
    { id: 'c d', text: 'identifiant abîmé' },
    { id: 'e', text: 'x'.repeat(300), done: 'hier' },
    null,
    { id: 'f', text: 'Fait', done: '2026-11-03', video: 'javascript:alert(1)' },
  ])
  assert.deepEqual(s, [
    { id: 'a', text: 'Corde à sauter' },
    { id: 'e', text: 'x'.repeat(100) },
    { id: 'f', text: 'Fait', done: '2026-11-03' },
  ])
  const many = stepsOf(Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, text: `Étape ${i}` })))
  assert.equal(many.length, OBJ_STEPS_MAX)
  // Cocher, décocher ; cocher une étape déjà cochée garde son jour.
  let l = setStepDone(staff, 'o-1', 'e-1', true, DAY)
  assert.equal(l[0].steps![0].done, DAY)
  l = setStepDone(l, 'o-1', 'e-2', true, DAY)
  assert.equal(l[0].steps![1].done, '2026-11-01')
  l = setStepDone(l, 'o-1', 'e-1', false, DAY)
  assert.equal('done' in l[0].steps![0], false)
  // Étape inconnue, objectif inconnu : rien ne change.
  assert.deepEqual(setStepDone(staff, 'o-1', 'zz', true, DAY), staff)
  assert.deepEqual(setStepDone(staff, 'zz', 'e-1', true, DAY), staff)
  // Fin de modification sur la fiche : étapes vides retirées, objectif sans étape : clé ôtée.
  const f = finalizeObjectives([{ id: 'x', text: 'A', status: 'en_cours', steps: [{ id: 's', text: '  ' }], video: '' }])
  assert.deepEqual(f, [{ id: 'x', text: 'A', status: 'en_cours' }])
})

t('liens vidéo : http(s) seulement, bornés', () => {
  assert.equal(cleanVideoUrl(' https://www.youtube.com/watch?v=abc '), 'https://www.youtube.com/watch?v=abc')
  assert.equal(cleanVideoUrl('HTTP://exemple.test/a'), 'HTTP://exemple.test/a')
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://exemple.test', 'https://', 'https:///chemin', 'https://a b', '//exemple.test', 'exemple.test', 'https://x/"onmouseover', 12, null])
    assert.equal(cleanVideoUrl(bad), undefined, String(bad))
  assert.equal(cleanVideoUrl('https://exemple.test/' + 'a'.repeat(500)), undefined)
  assert.equal(badVideoUrl(''), false)
  assert.equal(badVideoUrl('   '), false)
  assert.equal(badVideoUrl('www.exemple.test'), true)
  // Lien lu sur une fiche abîmée : écarté, l'objectif reste.
  assert.deepEqual(objectivesOf({ objectives: [{ id: 'a', text: 'A', video: 'javascript:x' }] }), [{ id: 'a', text: 'A', status: 'en_cours' }])
})

t('avancement : « 1 étape sur 3 », toujours en positif', () => {
  assert.equal(progressLabel({ done: 1, total: 3 }), '1 étape sur 3')
  assert.equal(progressLabel({ done: 0, total: 3 }), '0 étape sur 3')
  assert.equal(progressLabel({ done: 2, total: 3 }), '2 étapes sur 3')
  assert.equal(progressLabel({ done: 3, total: 3 }), '3 étapes sur 3 ✓')
  assert.equal(progressLabel({ done: 0, total: 0 }), '')
  for (const s of [progressLabel({ done: 0, total: 5 }), ...Object.values(MY_GOAL_ERRORS)]) assert.doesNotMatch(s, /raté|échec|retard|manqué|pas atteint|abandon/i)
})

t('vue commune : staff puis « à moi », coches du staff et du jeune', () => {
  const mine: MyGoals = {
    own: [
      { id: 'm-1', text: 'Le tir en suspension', status: 'en_cours', steps: [{ id: 'p-1', text: 'Regarder la vidéo', done: '2026-11-02' }, { id: 'p-2', text: 'Dix tirs' }] },
      { id: 'm-2', text: 'Courir deux fois par semaine', status: 'atteint', doneAt: '2026-10-25' },
    ],
    checks: { 'e-1': '2026-11-03' },
  }
  const v = goalViews(staff, mine)
  assert.deepEqual(
    v.active.map((x) => [x.owner, x.goal.id, progressLabel(x.progress)]),
    [
      ['staff', 'o-1', '2 étapes sur 3'],
      ['moi', 'm-1', '1 étape sur 2'],
    ],
  )
  assert.deepEqual(
    v.active[0].steps.map((s) => [s.id, s.checked, s.by, s.at]),
    [
      ['e-1', true, 'joueur', '2026-11-03'],
      ['e-2', true, 'staff', '2026-11-01'],
      ['e-3', false, undefined, undefined],
    ],
  )
  assert.equal(v.active[1].steps[0].by, 'joueur')
  // Atteints : le plus récent en premier, des deux côtés.
  assert.deepEqual(
    v.done.map((x) => [x.owner, x.goal.id]),
    [
      ['moi', 'm-2'],
      ['staff', 'o-2'],
    ],
  )
  // Ses objectifs pas lisibles (script 065 pas passé, hors ligne) : ceux du staff, avec les coches du staff.
  const ro = goalViews(staff, null)
  assert.deepEqual(ro.active.map((x) => x.goal.id), ['o-1'])
  assert.equal(progressLabel(ro.active[0].progress), '1 étape sur 3')
  // Une coche du jeune ne compte que pour une étape du staff (jamais pour une des siennes : il la coche dans la sienne).
  const odd = goalViews([], { own: mine.own, checks: { 'p-2': DAY } })
  assert.equal(odd.active[0].steps[1].checked, false)
})

t('droits : le staff coche et modifie les siens, lit ceux du jeune', () => {
  const opts = { staffEdit: true }
  assert.deepEqual(goalRights('staff', 'staff', opts), { check: true, edit: true })
  assert.deepEqual(goalRights('staff', 'moi', opts), { check: false, edit: false })
  // Sans droit de modifier la fiche (observateur, « Voir comme… ») : rien.
  assert.deepEqual(goalRights('staff', 'staff', { staffEdit: false }), { check: false, edit: false })
  assert.equal(stepCheckable('staff', 'staff', { checked: false }, opts), true)
  assert.equal(stepCheckable('staff', 'staff', { checked: true, by: 'staff' }, opts), true)
  // Une étape cochée par le jeune reste à lui.
  assert.equal(stepCheckable('staff', 'staff', { checked: true, by: 'joueur' }, opts), false)
  assert.equal(stepCheckable('staff', 'moi', { checked: false }, opts), false)
  assert.equal(stepCheckable('staff', 'staff', { checked: false }, { staffEdit: false }), false)
})

t('droits : le jeune coche toutes les étapes et ses objectifs, jamais l’« atteint » ni le texte du staff', () => {
  const opts = { playerWrite: true }
  assert.deepEqual(goalRights('joueur', 'moi', opts), { check: true, edit: true })
  assert.deepEqual(goalRights('joueur', 'staff', opts), { check: false, edit: false })
  assert.equal(stepCheckable('joueur', 'staff', { checked: false }, opts), true)
  assert.equal(stepCheckable('joueur', 'staff', { checked: true, by: 'joueur' }, opts), true)
  // Cochée par le staff : il la voit cochée, sans la décocher.
  assert.equal(stepCheckable('joueur', 'staff', { checked: true, by: 'staff' }, opts), false)
  assert.equal(stepCheckable('joueur', 'moi', { checked: true, by: 'joueur' }, opts), true)
  // Lecture seule (script pas passé, aperçu d'un administrateur avec le serveur) : rien.
  assert.deepEqual(goalRights('joueur', 'moi', { playerWrite: false }), { check: false, edit: false })
  assert.equal(stepCheckable('joueur', 'staff', { checked: false }, { playerWrite: false }), false)
})

t('coches du jeune : étapes de SA fiche seulement, jour gardé', () => {
  let g = setStaffStepCheck(emptyMyGoals(), staff, 'e-1', true, '2026-11-02')
  assert.deepEqual(g.checks, { 'e-1': '2026-11-02' })
  g = setStaffStepCheck(g, staff, 'e-1', true, DAY)
  assert.equal(g.checks['e-1'], '2026-11-02')
  // Un objectif du staff (son « atteint »), une étape inconnue : refusés sans bruit.
  assert.deepEqual(setStaffStepCheck(g, staff, 'o-1', true, DAY), g)
  assert.deepEqual(setStaffStepCheck(g, staff, 'e-9', true, DAY), g)
  g = setStaffStepCheck(g, staff, 'e-1', false, DAY)
  assert.deepEqual(g.checks, {})
  // À l'enregistrement : coches d'étapes retirées de la fiche écartées.
  assert.deepEqual(pruneChecks({ own: [], checks: { 'e-1': DAY, 'ancienne': DAY } }, staff).checks, { 'e-1': DAY })
  assert.deepEqual([...staffStepIds(staff)].sort(), ['e-1', 'e-2', 'e-3'])
})

t('ses objectifs : 5 en cours au plus (3 pour le staff), atteint libère une place', () => {
  assert.equal(OWN_MAX_ACTIVE, 5)
  assert.equal(OBJ_MAX_ACTIVE, 3)
  let g = emptyMyGoals()
  for (let i = 1; i <= 5; i++) g = ok(addOwnGoal(g, { text: `Objectif ${i}`, steps: [] }, `m-${i}`, DAY))
  assert.deepEqual(addOwnGoal(g, { text: 'Sixième', steps: [] }, 'm-6', DAY), { ok: false, error: 'max' })
  g = ok(setOwnGoalStatus(g, 'm-2', 'atteint', DAY))
  assert.equal(g.own[1].doneAt, DAY)
  g = ok(addOwnGoal(g, { text: 'Sixième', steps: [] }, 'm-6', DAY))
  // Le remettre en cours : refusé tant qu'il y en a 5.
  assert.deepEqual(setOwnGoalStatus(g, 'm-2', 'en_cours', DAY), { ok: false, error: 'max' })
  g = removeOwnGoal(g, 'm-6')
  g = ok(setOwnGoalStatus(g, 'm-2', 'en_cours', DAY))
  assert.equal('doneAt' in g.own[1], false)
  // Lecture d'une forme abîmée : jamais plus de 5 en cours ni 12 en tout.
  const raw = { own: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, text: `T${i}`, status: i < 8 ? 'en_cours' : 'atteint' })), checks: {} }
  const c = cleanMyGoals(raw)
  assert.equal(c.own.filter((o) => o.status === 'en_cours').length, 5)
  assert.equal(c.own.length, 12)
})

t('ses objectifs : titre, lien, étapes ; refus en clair', () => {
  const g = ok(
    addOwnGoal(
      emptyMyGoals(),
      {
        text: '  Le tir en suspension ',
        video: ' https://exemple.test/modele ',
        steps: [
          { id: 's1', text: 'Regarder la vidéo', video: 'https://exemple.test/geste' },
          { id: 's2', text: '   ' },
          { id: 's3', text: 'Dix tirs' },
        ],
      },
      'm-1',
      DAY,
    ),
  )
  assert.deepEqual(g.own[0], {
    id: 'm-1',
    text: 'Le tir en suspension',
    status: 'en_cours',
    date: DAY,
    video: 'https://exemple.test/modele',
    steps: [
      { id: 's1', text: 'Regarder la vidéo', video: 'https://exemple.test/geste' },
      { id: 's3', text: 'Dix tirs' },
    ],
  })
  assert.deepEqual(addOwnGoal(emptyMyGoals(), { text: '  ', steps: [] }, 'x', DAY), { ok: false, error: 'vide' })
  assert.deepEqual(addOwnGoal(emptyMyGoals(), { text: 'A', video: 'javascript:alert(1)', steps: [] }, 'x', DAY), { ok: false, error: 'lien' })
  assert.deepEqual(addOwnGoal(emptyMyGoals(), { text: 'A', steps: [{ id: 's', text: 'B', video: 'www.exemple.test' }] }, 'x', DAY), { ok: false, error: 'lien' })
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, text: `Étape ${i}` }))
  assert.deepEqual(addOwnGoal(emptyMyGoals(), { text: 'A', steps: nine }, 'x', DAY), { ok: false, error: 'etapes' })
  // Modifier : l'état et la date restent ; une étape cochée garde sa coche ; plus de lien : clé ôtée.
  const done = { ...g, own: setStepDone(g.own, 'm-1', 's3', true, DAY) }
  const e = ok(editOwnGoal(done, 'm-1', { text: 'Le tir en suspension, bras haut', steps: [{ id: 's3', text: 'Dix tirs', done: DAY }] }))
  assert.deepEqual(e.own[0], { id: 'm-1', text: 'Le tir en suspension, bras haut', status: 'en_cours', date: DAY, steps: [{ id: 's3', text: 'Dix tirs', done: DAY }] })
})

t('ligne du serveur : nettoyée comme le serveur (065), jamais d’erreur', () => {
  assert.deepEqual(myGoalsFromRow(null), emptyMyGoals())
  assert.deepEqual(myGoalsFromRow({ own: 'abîmé', checks: [1, 2] }), emptyMyGoals())
  const r = myGoalsFromRow({
    own: [{ id: 'a', text: 'A', status: 'en_cours', doneAt: '2026-11-01', eventId: 'ev', bidule: 1 }, { id: 'a', text: 'doublon' }],
    checks: { 'e-1': '2026-11-02', 'e-2': 'hier', 'x y': '2026-11-02' },
    updated_at: '2026-11-04T10:00:00Z',
  })
  // doneAt seulement s'il est atteint ; pas d'événement d'origine pour les siens (il ne lit pas les événements).
  assert.deepEqual(r, { own: [{ id: 'a', text: 'A', status: 'en_cours' }], checks: { 'e-1': '2026-11-02' }, at: '2026-11-04T10:00:00Z' })
})

t('modèles : nettoyés, repris sur la fiche avec de nouveaux identifiants', () => {
  const list = cleanTemplates([
    { id: 'm1', text: ' Gagner en détente ', steps: [{ text: 'Corde à sauter' }, { text: '  ' }, { text: 'Sauts', video: 'javascript:x' }], video: 'https://exemple.test/v' },
    { id: 'm1', text: 'doublon' },
    { id: 'm2', text: '' },
    { text: 'sans identifiant' },
    'n’importe quoi',
  ])
  assert.deepEqual(list, [{ id: 'm1', text: 'Gagner en détente', video: 'https://exemple.test/v', steps: [{ text: 'Corde à sauter' }, { text: 'Sauts' }] }])
  let k = 0
  const o = objectiveFromTemplate(list[0], () => `id-${++k}`)
  assert.deepEqual(o, {
    id: 'id-1',
    text: 'Gagner en détente',
    status: 'en_cours',
    video: 'https://exemple.test/v',
    steps: [
      { id: 'id-2', text: 'Corde à sauter' },
      { id: 'id-3', text: 'Sauts' },
    ],
  })
  // Ligne de configuration : tableau, ou { demo, templates } pour la démo ; supprimée : aucun modèle.
  assert.equal(GOAL_TEMPLATES_KEY, 'modeles_objectifs')
  assert.match(GOAL_TEMPLATES_KEY, /^[a-z][a-z0-9_]{0,39}$/) // accepté par hb_structure_ok (044)
  assert.equal(templatesOf([{ id: GOAL_TEMPLATES_KEY, key: GOAL_TEMPLATES_KEY, value: list }]).length, 1)
  assert.equal(templatesOf([{ id: GOAL_TEMPLATES_KEY, key: GOAL_TEMPLATES_KEY, value: { demo: true, templates: DEMO_TEMPLATES } }]).length, DEMO_TEMPLATES.length)
  assert.equal(templatesOf([{ id: GOAL_TEMPLATES_KEY, key: GOAL_TEMPLATES_KEY, value: list, deleted: true }]).length, 0)
  assert.equal(isDemoTemplatesValue({ demo: true, templates: [] }), true)
  assert.equal(isDemoTemplatesValue(list), false)
})

t('modèles de la démo : 3 ou 4, génériques, propres', () => {
  assert.ok(DEMO_TEMPLATES.length >= 3 && DEMO_TEMPLATES.length <= 4)
  assert.deepEqual(cleanTemplates(DEMO_TEMPLATES), DEMO_TEMPLATES)
  assert.ok(DEMO_TEMPLATES.some((t) => t.text === 'Gagner en détente' && t.steps.length === 3))
  for (const t of DEMO_TEMPLATES) assert.doesNotMatch(JSON.stringify(t), /FFHB|FFVB|fédéra|ligue|pôle/i)
})

t('rien vers une IA ; modèles et démo branchés', () => {
  const src = readFileSync(new URL('../src/components/Objectives.tsx', import.meta.url), 'utf8')
  // Clavier seulement : ni micro, ni dictée, ni Demander.
  assert.doesNotMatch(src, /from '\.\/(Demander|Dictation|AvisVocal|VoiceButton)|useDictation|transcrire|name="mic"/)
  // Lien vidéo : jamais d'intégration (iframe, lecteur) ; ouvert dans un nouvel onglet, sans accès à la page.
  assert.doesNotMatch(src, /<iframe|<video|VideoPlayer/)
  assert.match(src, /rel="noopener noreferrer"/)
  const demo = readFileSync(new URL('../src/demo.ts', import.meta.url), 'utf8')
  assert.match(demo, /seedDemoGoals\(/)
  assert.match(demo, /clearDemoGoals\(\)/)
  assert.match(demo, /seedDemoTemplates\(\)/)
  assert.doesNotMatch(demo.slice(demo.indexOf('function buildDemoGoals'), demo.indexOf('async function seedDemoTemplates')), /rand\(\)/)
  const settings = readFileSync(new URL('../src/pages/Settings.tsx', import.meta.url), 'utf8')
  assert.match(settings, /<GoalTemplatesSettings /)
})

console.log(`\n${n} essais réussis`)
