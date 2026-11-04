// Test des objectifs donnés à tout un groupe (src/groupObjectives.ts, 04/11) : saisie contrôlée (titre, liens http(s), 8
// étapes), une copie par fiche avec ses propres identifiants (objectif et étapes) et sa source (groupe ou événement, lot de
// l'envoi), droits (fiches modifiables seulement), limite de 3 en cours (passé, rien d'écrasé), « l'a déjà », résumé,
// « Objectifs donnés » (avancement du groupe, coches du jeune comprises), « Retirer à tous », et la source gardée quand la
// fiche est relue ou modifiée. Textes et joueurs fictifs.
//
//   npx jiti tools/test-objectifs-groupe.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  checkGift,
  chunks,
  copyGift,
  giftsFrom,
  giftStatus,
  giftSummary,
  giveToMany,
  reachedLabel,
  stepsLabel,
  withdrawGift,
  type Gift,
  type GiftFrom,
} from '../src/groupObjectives'
import { goalViews } from '../src/myGoals'
import { finalizeObjectives, objectiveOrigin, objectivesOf, setObjectiveStatus, setStepDone, sourceLabel, type WorkObjective } from '../src/objectives'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

type P = { id: string; objectives?: WorkObjective[]; sex?: string; locked?: boolean }
let seq = 0
const newId = () => `id-${++seq}`
const canEdit = (p: P) => !p.locked
const POLE: GiftFrom = { kind: 'groupe', id: 'g-pole', name: 'Pôle' }
const STAGE: GiftFrom = { kind: 'evenement', id: 'ev-stage', name: 'Stage de rentrée' }
const gift = (): Gift => {
  const c = checkGift({ text: '  Courir 20 minutes par jour ', steps: [{ text: 'Semaine 1' }, { text: '' }, { text: 'Semaine 2', video: 'https://exemple.org/v' }], due: '2026-08-31' })
  assert.ok(c.ok)
  return c.gift
}
const o = (id: string, text: string, more: Partial<WorkObjective> = {}): WorkObjective => ({ id, text, status: 'en_cours', ...more })

t('saisie contrôlée : titre, liens, étapes vides retirées, 8 au plus, date', () => {
  const g = gift()
  assert.equal(g.text, 'Courir 20 minutes par jour')
  assert.deepEqual(g.steps, [{ text: 'Semaine 1' }, { text: 'Semaine 2', video: 'https://exemple.org/v' }])
  assert.equal(g.due, '2026-08-31')
  assert.deepEqual(checkGift({ text: '   ', steps: [] }), { ok: false, error: 'vide' })
  assert.deepEqual(checkGift({ text: 'A', video: 'javascript:alert(1)', steps: [] }), { ok: false, error: 'lien' })
  assert.deepEqual(checkGift({ text: 'A', steps: [{ text: 'x', video: 'data:text/html,1' }] }), { ok: false, error: 'lien' })
  // Lien d'une étape vide : l'étape est retirée, son lien ne compte pas.
  assert.ok(checkGift({ text: 'A', steps: [{ text: ' ', video: 'pas un lien' }] }).ok)
  assert.deepEqual(checkGift({ text: 'A', steps: Array.from({ length: 9 }, (_, i) => ({ text: `É${i}` })) }), { ok: false, error: 'etapes' })
  const bad = checkGift({ text: 'A', steps: [], due: '31/08/2026' })
  assert.ok(bad.ok && bad.gift.due === undefined)
})

t('une copie par fiche, identifiants propres (objectif et étapes), source et lot', () => {
  const players: P[] = [{ id: 'p1' }, { id: 'p2', objectives: [o('x', 'Oser le tir à 9 mètres')] }]
  const r = giveToMany(players, gift(), POLE, { canEdit, newId, batch: 'lot-1', day: '2026-07-01' })
  assert.deepEqual(r.given, ['p1', 'p2'])
  assert.equal(r.skipped.length, 0)
  const a = objectivesOf(r.rows[0])
  const b = objectivesOf(r.rows[1])
  assert.equal(a.length, 1)
  assert.equal(b.length, 2)
  assert.equal(b[0].id, 'x', 'les objectifs déjà là restent, le nouveau va à la fin')
  const ca = a[0]
  const cb = b[1]
  assert.notEqual(ca.id, cb.id)
  const ids = [ca.id, cb.id, ...ca.steps!.map((s) => s.id), ...cb.steps!.map((s) => s.id)]
  assert.equal(new Set(ids).size, ids.length, 'aucun identifiant partagé entre deux copies')
  assert.deepEqual(ca.source, { kind: 'groupe', id: 'g-pole', name: 'Pôle', batch: 'lot-1', at: '2026-07-01' })
  assert.equal(ca.status, 'en_cours')
  assert.equal(ca.due, '2026-08-31')
  assert.ok(ca.steps!.every((s) => !s.done), 'rien de coché')
  assert.equal(ca.eventId, undefined)
  // La fiche d'entrée n'est pas modifiée sur place.
  assert.equal(players[0].objectives, undefined)
})

t('depuis un événement : relié d’office (nom, date), mention sans redite', () => {
  const r = giveToMany([{ id: 'p1' }], gift(), STAGE, { canEdit, newId, batch: 'lot-2', day: '2026-08-29', event: { id: 'ev-stage', name: 'Stage de rentrée', date: '2026-08-28' } })
  const c = objectivesOf(r.rows[0])[0]
  assert.equal(c.eventId, 'ev-stage')
  assert.equal(c.eventName, 'Stage de rentrée')
  assert.equal(c.date, '2026-08-28')
  assert.equal(sourceLabel(c), 'Stage de rentrée')
  const fmt = (d: string) => d.split('-').reverse().join('/')
  // Le nom de l'événement est déjà dans la mention : l'origine ne le redit pas.
  assert.equal(objectiveOrigin(c, fmt), '28/08/2026 · avant le 31/08/2026')
  assert.equal(sourceLabel({ source: { kind: 'groupe', id: 'g', name: 'Pôle', batch: 'b' } }), 'groupe Pôle')
  assert.equal(sourceLabel({}), '')
})

t('fiches pas modifiables : passées ; 3 en cours : passé sans rien écraser ; déjà là : passé', () => {
  const full: P = { id: 'p3', objectives: [o('a', 'Un'), o('b', 'Deux'), o('c', 'Trois'), o('d', 'Ancien', { status: 'atteint', doneAt: '2026-01-01' })] }
  const players: P[] = [{ id: 'p1' }, { id: 'p2', locked: true }, full, { id: 'p1' }]
  const r = giveToMany(players, gift(), POLE, { canEdit, newId, batch: 'lot-3', day: '2026-07-01' })
  assert.deepEqual(r.given, ['p1'], 'un joueur en double n’est servi qu’une fois')
  assert.deepEqual(r.skipped, [
    { id: 'p2', why: 'droits' },
    { id: 'p3', why: 'max' },
  ])
  assert.equal(r.rows.length, 1)
  assert.equal(full.objectives!.length, 4)
  // Un atteint ne compte pas dans la limite.
  assert.equal(giftStatus({ id: 'p4', objectives: [o('a', 'Un'), o('b', 'Deux'), o('d', 'Ancien', { status: 'atteint' })] }, gift(), POLE, canEdit), 'ok')
  // Déjà donné d'ici (même titre, encore en cours) : pas une seconde copie ; d'un autre groupe : si.
  const got = r.rows[0]
  assert.equal(giftStatus(got, { text: 'courir 20 MINUTES par jour' }, POLE, canEdit), 'deja')
  assert.equal(giftStatus(got, gift(), { kind: 'groupe', id: 'g-autre', name: 'Autre' }, canEdit), 'ok')
  // Atteint : on peut le redonner (une nouvelle fois).
  const l = setObjectiveStatus(objectivesOf(got), objectivesOf(got)[0].id, 'atteint', '2026-08-01')
  assert.ok(l.ok)
  assert.equal(giftStatus({ id: got.id, objectives: l.list }, gift(), POLE, canEdit), 'ok')
})

t('résumé : donnés, passés (avec la raison), accords', () => {
  assert.equal(
    giftSummary({ given: Array(14).fill('x'), skipped: [{ why: 'max' }, { why: 'max' }, { why: 'droits' }] }),
    'Objectif donné à 14 joueurs ; 2 passés (déjà 3 objectifs en cours) ; 1 passé (pas modifiable par toi).',
  )
  assert.equal(giftSummary({ given: ['a'], skipped: [] }, 'F'), 'Objectif donné à 1 joueuse.')
  assert.equal(giftSummary({ given: [], skipped: [{ why: 'deja' }, { why: 'deja' }] }, 'F'), 'Objectif donné à aucune joueuse ; 2 passées (déjà donné, en cours).')
})

t('12 objectifs gardés au plus sur la fiche (les atteints les plus anciens tombent)', () => {
  const many: WorkObjective[] = Array.from({ length: 12 }, (_, i) => o(`d${i}`, `Atteint ${i}`, { status: 'atteint', doneAt: `2026-01-${String(i + 1).padStart(2, '0')}` }))
  const r = giveToMany([{ id: 'p1', objectives: many }], gift(), POLE, { canEdit, newId, batch: 'lot-4', day: '2026-07-01' })
  const l = objectivesOf(r.rows[0])
  assert.equal(l.length, 12)
  assert.ok(l.some((x) => x.source?.batch === 'lot-4'))
  assert.ok(!l.some((x) => x.id === 'd0'), 'le plus ancien atteint est tombé')
})

t('« Objectifs donnés » : par envoi, avancement du groupe (staff et jeune), le plus récent d’abord', () => {
  const players: P[] = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4', objectives: [o('z', 'Autre chose')] }]
  const r1 = giveToMany(players.slice(0, 3), gift(), POLE, { canEdit, newId, batch: 'lot-a', day: '2026-07-01' })
  const c2 = checkGift({ text: 'Gainage 5 minutes', steps: [] })
  assert.ok(c2.ok)
  const r2 = giveToMany(r1.rows.slice(0, 1), c2.gift, POLE, { canEdit, newId, batch: 'lot-b', day: '2026-07-10' })
  // p1 : atteint ; étape 1 cochée par le staff. p2 : étape 2 cochée par le jeune (065, hors de la fiche).
  let p1 = r2.rows[0]
  const g1 = objectivesOf(p1).find((x) => x.source?.batch === 'lot-a')!
  let l1 = setStepDone(objectivesOf(p1), g1.id, g1.steps![0].id, true, '2026-07-05')
  const st = setObjectiveStatus(l1, g1.id, 'atteint', '2026-07-20')
  assert.ok(st.ok)
  l1 = st.list
  p1 = { ...p1, objectives: l1 }
  const p2 = r1.rows[1]
  const g2 = objectivesOf(p2)[0]
  const all = [p1, p2, r1.rows[2], players[3]]
  const checks = { p2: { [g2.steps![1].id]: '2026-07-06' }, p3: { 'une-etape-ailleurs': '2026-07-06' } }
  const v = giftsFrom(all, POLE, checks)
  assert.deepEqual(
    v.map((x) => [x.batch, x.total, x.reached, x.stepsDone, x.stepsTotal]),
    [
      ['lot-b', 1, 0, 0, 0],
      ['lot-a', 3, 1, 2, 6],
    ],
  )
  assert.equal(v[1].due, '2026-08-31')
  assert.equal(v[1].at, '2026-07-01')
  assert.equal(reachedLabel(v[1]), '1 sur 3 joueurs l’a atteint')
  assert.equal(reachedLabel({ reached: 9, total: 14 }), '9 sur 14 joueurs l’ont atteint')
  assert.equal(reachedLabel(v[0], 'F'), '1 joueuse l’a reçu')
  assert.equal(stepsLabel(v[1]), '2 étapes cochées sur 6')
  assert.equal(stepsLabel(v[0]), '')
  // Un autre groupe, un événement du même identifiant : rien de mélangé.
  assert.equal(giftsFrom(all, { kind: 'evenement', id: 'g-pole' }).length, 0)
  assert.equal(giftsFrom(all, { kind: 'groupe', id: 'g-autre' }).length, 0)
})

t('« Retirer à tous » : les fiches modifiables, cet envoi seulement ; clé retirée quand il n’en reste aucun', () => {
  const r = giveToMany([{ id: 'p1' }, { id: 'p2', objectives: [o('k', 'Garder celui-ci')] }, { id: 'p3' }], gift(), POLE, { canEdit, newId, batch: 'lot-w', day: '2026-07-01' })
  const other = giveToMany([r.rows[1]], { text: 'Autre envoi', steps: [] }, POLE, { canEdit, newId, batch: 'lot-x', day: '2026-07-02' })
  const players: P[] = [r.rows[0], other.rows[0], { ...r.rows[2], locked: true }, { id: 'p9' }]
  const w = withdrawGift(players, 'lot-w', canEdit)
  assert.deepEqual(w.removed, ['p1', 'p2'])
  assert.deepEqual(w.kept, ['p3'])
  assert.equal(w.rows.length, 2)
  assert.equal('objectives' in w.rows[0], false)
  assert.deepEqual(
    objectivesOf(w.rows[1]).map((x) => x.text),
    ['Garder celui-ci', 'Autre envoi'],
  )
})

t('la source et la date à tenir survivent à la relecture et à la modification de la fiche', () => {
  const src = { kind: 'groupe' as const, id: 'g-pole', name: 'Pôle', batch: 'lot-z', at: '2026-07-01' }
  const c = copyGift(gift(), src, newId)
  const back = finalizeObjectives(JSON.parse(JSON.stringify([c])))
  assert.deepEqual(back[0].source, src)
  assert.equal(back[0].due, '2026-08-31')
  // Formes abîmées : la source est ignorée, l'objectif reste.
  for (const bad of [{ ...src, kind: 'club' }, { ...src, batch: 'a b' }, { ...src, name: '  ' }, 'texte', { ...src, id: '' }]) {
    const l = objectivesOf({ objectives: [{ ...c, source: bad }] })
    assert.equal(l.length, 1)
    assert.equal(l[0].source, undefined)
  }
  assert.equal(objectivesOf({ objectives: [{ ...c, due: 'demain' }] })[0].due, undefined)
  // Vue commune (fiche, page du jeune) : un objectif du staff ordinaire, avec ses étapes.
  const v = goalViews([c], { own: [], checks: { [c.steps![0].id]: '2026-07-03' } })
  assert.equal(v.active[0].owner, 'staff')
  assert.deepEqual(v.active[0].progress, { done: 1, total: 2 })
})

t('écriture par lots raisonnables', () => {
  assert.deepEqual(
    chunks([1, 2, 3, 4, 5], 2).map((x) => x.length),
    [2, 2, 1],
  )
  assert.equal(chunks(Array(120).fill(0)).length, 3)
  assert.deepEqual(chunks([]), [])
})

t('libellés positifs ou neutres seulement ; rien vers une IA', () => {
  const src = readFileSync('src/groupObjectives.ts', 'utf8') + readFileSync('src/components/GroupObjectives.tsx', 'utf8')
  for (const bad of ['raté', 'échec', 'abandonn', 'pas retenu', 'en retard']) assert.ok(!src.toLowerCase().includes(bad), bad)
  for (const ai of ['mistral', 'openai', 'transcrire', 'Demander']) assert.ok(!src.includes(ai), ai)
})

console.log(`${n} tests ok`)
