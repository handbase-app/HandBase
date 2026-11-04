// Test des objectifs de travail (src/objectives.ts, vague 2 « Génération Bleue ») : 3 en cours au plus, états « en cours » /
// « atteint » seulement (jamais « raté »), remettre en cours si la place le permet, retrait, nettoyage (textes, dates,
// formes abîmées), 12 gardés au plus (les atteints les plus anciens tombent), origine (événements où le joueur était sur la
// liste), ce que montre le bilan à imprimer (en cours seulement). Textes fictifs.
//
//   npx jiti tools/test-objectifs.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  activeObjectives,
  addObjective,
  canAddObjective,
  cleanObjectiveText,
  doneObjectives,
  editObjective,
  finalizeObjectives,
  OBJ_KEEP,
  OBJ_MAX_ACTIVE,
  OBJ_STATUS_LABEL,
  OBJ_TEXT_MAX,
  objectiveOrigin,
  objectivesOf,
  originEvents,
  removeObjective,
  setObjectiveStatus,
  shiftDay,
  type WorkObjective,
} from '../src/objectives'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}
const ok = <T>(r: { ok: true; list: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(`refusé : ${r.error}`)
  return r.list
}

t('trois en cours au plus', () => {
  assert.equal(OBJ_MAX_ACTIVE, 3)
  let l: WorkObjective[] = []
  l = ok(addObjective(l, { text: 'Gagner en vitesse sur le premier pas' }, 'a'))
  l = ok(addObjective(l, { text: 'Prendre la parole en défense' }, 'b'))
  l = ok(addObjective(l, { text: 'Oser le tir de loin' }, 'c'))
  assert.equal(canAddObjective(l), false)
  assert.deepEqual(addObjective(l, { text: 'Un quatrième' }, 'd'), { ok: false, error: 'max' })
  // Un atteint libère une place.
  l = ok(setObjectiveStatus(l, 'b', 'atteint', '2026-11-04'))
  assert.equal(canAddObjective(l), true)
  l = ok(addObjective(l, { text: 'Un quatrième' }, 'd'))
  assert.equal(activeObjectives(l).length, 3)
  assert.equal(l.length, 4)
  // Le remettre « en cours » : refusé tant qu'il y en a 3.
  assert.deepEqual(setObjectiveStatus(l, 'b', 'en_cours', '2026-11-05'), { ok: false, error: 'max' })
  l = removeObjective(l, 'd')
  l = ok(setObjectiveStatus(l, 'b', 'en_cours', '2026-11-05'))
  assert.equal(l.find((o) => o.id === 'b')!.doneAt, undefined)
})

t('deux états seulement, positifs', () => {
  assert.deepEqual(Object.keys(OBJ_STATUS_LABEL).sort(), ['atteint', 'en_cours'])
  assert.deepEqual(Object.values(OBJ_STATUS_LABEL), ['En cours', 'Atteint ✓'])
  for (const v of Object.values(OBJ_STATUS_LABEL)) assert.doesNotMatch(v, /raté|échec|abandon|pas atteint|manqué/i)
  // Un état inconnu lu sur une fiche redevient « en cours » (jamais un état négatif).
  assert.equal(objectivesOf({ objectives: [{ id: 'x', text: 'Oser', status: 'rate' }] })[0].status, 'en_cours')
})

t('atteint : date posée, rangés du plus récent au plus ancien', () => {
  let l: WorkObjective[] = [
    { id: 'a', text: 'A', status: 'en_cours' },
    { id: 'b', text: 'B', status: 'en_cours' },
  ]
  l = ok(setObjectiveStatus(l, 'a', 'atteint', '2026-10-01'))
  l = ok(setObjectiveStatus(l, 'b', 'atteint', '2026-11-01'))
  assert.deepEqual(
    doneObjectives(l).map((o) => [o.id, o.doneAt]),
    [
      ['b', '2026-11-01'],
      ['a', '2026-10-01'],
    ],
  )
  // Même état : rien ne change.
  assert.deepEqual(ok(setObjectiveStatus(l, 'a', 'atteint', '2026-12-01')), l)
})

t('texte nettoyé, vide refusé', () => {
  assert.equal(cleanObjectiveText('  Gagner\n en\tvitesse  '), 'Gagner en vitesse')
  assert.equal(cleanObjectiveText('x'.repeat(200)).length, OBJ_TEXT_MAX)
  assert.equal(cleanObjectiveText(12), '')
  assert.deepEqual(addObjective([], { text: '   ' }, 'a'), { ok: false, error: 'vide' })
  assert.deepEqual(editObjective([{ id: 'a', text: 'A', status: 'en_cours' }], 'a', { text: '' }), { ok: false, error: 'vide' })
})

t('origine et date', () => {
  const l = ok(addObjective([], { text: 'Oser', eventId: 'ev-1', eventName: ' Stage de rentrée ', date: '2026-08-28' }, 'a'))
  assert.deepEqual(l[0], { id: 'a', text: 'Oser', status: 'en_cours', eventId: 'ev-1', eventName: 'Stage de rentrée', date: '2026-08-28' })
  // Date illisible : ignorée ; nom sans événement : ignoré.
  const m = ok(addObjective([], { text: 'Oser', eventName: 'Sans id', date: '28/08/2026' }, 'b'))
  assert.deepEqual(m[0], { id: 'b', text: 'Oser', status: 'en_cours' })
  // Correction : l'origine peut être retirée, l'état reste.
  const e = ok(editObjective(ok(setObjectiveStatus(l, 'a', 'atteint', '2026-11-01')), 'a', { text: 'Oser davantage' }))
  assert.deepEqual(e[0], { id: 'a', text: 'Oser davantage', status: 'atteint', doneAt: '2026-11-01' })
  const fmt = (d: string) => d.split('-').reverse().join('/')
  assert.equal(objectiveOrigin(l[0], fmt), 'Stage de rentrée · 28/08/2026')
  assert.equal(objectiveOrigin({ date: '2026-08-28' }, fmt), '28/08/2026')
  assert.equal(objectiveOrigin({}, fmt), '')
})

t('fiche ancienne ou abîmée : jamais d’erreur', () => {
  assert.deepEqual(objectivesOf(undefined), [])
  assert.deepEqual(objectivesOf({}), [])
  assert.deepEqual(objectivesOf({ objectives: 'n’importe quoi' }), [])
  assert.deepEqual(objectivesOf({ objectives: [null, 3, { text: 'sans id' }, { id: 'a', text: '' }, { id: 'b', text: 'Bon', date: 'hier', eventId: '' }] }), [
    { id: 'b', text: 'Bon', status: 'en_cours' },
  ])
})

t('12 gardés au plus : les atteints les plus anciens tombent, jamais ceux en cours', () => {
  const list: WorkObjective[] = Array.from({ length: 14 }, (_, i) => ({ id: `d${i}`, text: `Atteint ${i}`, status: 'atteint', doneAt: shiftDay('2026-01-01', i) }))
  const l = ok(addObjective(list, { text: 'Nouveau' }, 'neuf'))
  assert.equal(l.length, OBJ_KEEP)
  assert.ok(l.some((o) => o.id === 'neuf'))
  assert.ok(!l.some((o) => o.id === 'd0' || o.id === 'd1' || o.id === 'd2'))
  assert.ok(l.some((o) => o.id === 'd13'))
  // Fin de modification sur la fiche : même règle, formes nettoyées (clés vides ôtées).
  const f = finalizeObjectives([...list, { id: 'x', text: '  En cours  ', status: 'en_cours', doneAt: undefined, eventId: undefined }])
  assert.equal(f.length, OBJ_KEEP)
  assert.deepEqual(f.find((o) => o.id === 'x'), { id: 'x', text: 'En cours', status: 'en_cours' })
  assert.deepEqual(finalizeObjectives([{ id: 'v', text: '   ', status: 'en_cours' }]), [])
})

t('origine proposée : événements où le joueur était sur la liste, déjà commencés, 6 mois', () => {
  const ev = (id: string, date: string, ids: string[], deleted = false) => ({ id, name: id, date, playerIds: ids, deleted })
  const events = [
    ev('passe', '2026-10-20', ['p1']),
    ev('jour', '2026-11-04', ['p1']),
    ev('futur', '2026-11-20', ['p1']),
    ev('autre', '2026-10-25', ['p2']),
    ev('suppr', '2026-10-26', ['p1'], true),
    ev('vieux', '2026-03-01', ['p1']),
  ]
  assert.deepEqual(
    originEvents(events, 'p1', '2026-11-04').map((e) => e.id),
    ['jour', 'passe'],
  )
})

t('bilan à imprimer : les objectifs en cours seulement', () => {
  const src = readFileSync(new URL('../src/components/FamilyReport.tsx', import.meta.url), 'utf8')
  // Depuis les étapes (04/11) : goalViews(…).active (ceux du staff puis ceux du jeune, en cours seulement).
  assert.match(src, /goalViews\(objectivesOf\(p\), usePlayerGoals\(p\.id\)\)\.active/)
  const l: WorkObjective[] = [
    { id: 'a', text: 'A', status: 'en_cours' },
    { id: 'b', text: 'B', status: 'atteint', doneAt: '2026-10-01' },
  ]
  assert.deepEqual(activeObjectives(l).map((o) => o.id), ['a'])
})

t('jours : décalage sans effet d’heure d’été', () => {
  assert.equal(shiftDay('2026-10-24', 7), '2026-10-31')
  assert.equal(shiftDay('2026-03-28', 2), '2026-03-30')
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31')
})

console.log(`\n${n} essais réussis`)
