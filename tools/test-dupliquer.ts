// Test de « Dupliquer l'événement » (src/eventCopy.ts) : titre « (copie) », « (copie 2) »… ; brouillon de la copie selon
// les cases cochées (liste des joueurs, nom, date, équipes) ; ce qui est toujours repris ; ce qui ne l'est jamais ;
// l'original jamais modifié.
//
//   npx jiti tools/test-dupliquer.ts
import assert from 'node:assert/strict'
import type { HBEvent } from '../src/db'
import { ALL_COPY, buildCopyDraft, copyTitle, hasTeams } from '../src/eventCopy'

// ---------- 1. Titre de la copie ----------
{
  assert.equal(copyTitle('Tournoi de Pâques', []), 'Tournoi de Pâques (copie)')
  assert.equal(copyTitle('Tournoi de Pâques', ['Tournoi de Pâques']), 'Tournoi de Pâques (copie)', 'l’original ne compte pas comme une copie')
  assert.equal(copyTitle('Tournoi de Pâques', ['Tournoi de Pâques', 'Tournoi de Pâques (copie)']), 'Tournoi de Pâques (copie 2)')
  assert.equal(
    copyTitle('Tournoi de Pâques', ['Tournoi de Pâques', 'Tournoi de Pâques (copie)', 'Tournoi de Pâques (copie 2)']),
    'Tournoi de Pâques (copie 3)',
  )
  // Un trou dans la suite : le premier libre.
  assert.equal(copyTitle('Stage', ['Stage (copie)', 'Stage (copie 3)']), 'Stage (copie 2)')
  // Dupliquer une copie repart du titre d'origine.
  assert.equal(copyTitle('Stage (copie)', ['Stage', 'Stage (copie)']), 'Stage (copie 2)')
  assert.equal(copyTitle('Stage (copie 2)', ['Stage', 'Stage (copie)', 'Stage (copie 2)']), 'Stage (copie 3)')
  // Casse et espaces ignorés pour savoir si le nom existe.
  assert.equal(copyTitle('Stage', ['  stage   (COPIE) ']), 'Stage (copie 2)')
  assert.equal(copyTitle('  Stage  ', []), 'Stage (copie)')
}

// ---------- 2. Événement avec joueurs et équipes ----------
const ev: HBEvent = {
  id: 'ev1',
  updatedAt: 1,
  name: 'Tournoi U15',
  type: 'tournoi',
  date: '2026-04-12',
  place: 'Valence',
  sex: 'F',
  organizerUnitId: 'u-26',
  organizerName: 'Comité Drôme',
  editors: ['a', 'b'],
  teams: ['t-gardiens'],
  names: { a: 'Anne', b: 'Bruno', c: 'Chloé' },
  playerIds: ['p1', 'p2', 'p3'],
  addedBy: { p1: 'a', p2: 'c', zz: 'a' },
  time: '14:00',
  archived: true,
  createdBy: 'c',
  tournament: {
    teams: [
      { id: 'e1', name: 'Drôme' },
      { id: 'e2', name: 'Ardèche' },
    ],
    players: { p1: { team: 'e1', num: '7' }, p2: { team: 'e2' }, p9: { team: 'e1', num: '3' } },
    assign: { a: ['e1'], b: ['e2', 'gone'], c: ['gone'] },
  },
  matchSheet: { home: 'Drôme', away: 'Ardèche' } as unknown as HBEvent['matchSheet'],
} as HBEvent
const before = JSON.stringify(ev)
const existing = ['Tournoi U15', 'Tournoi U15 (copie)', 'Autre']

{
  assert.equal(hasTeams(ev), true)
  assert.equal(hasTeams({ tournament: { teams: [] } }), false)
  assert.equal(hasTeams({}), false)

  const d = buildCopyDraft(ev, ALL_COPY, existing, '2026-10-20')
  assert.equal(d.name, 'Tournoi U15 (copie 2)')
  assert.equal(d.date, '2026-10-20', 'date du jour')
  assert.equal(d.from, 'Tournoi U15')
  // Toujours repris.
  assert.equal(d.type, 'tournoi')
  assert.equal(d.place, 'Valence')
  assert.equal(d.sex, 'F')
  assert.equal(d.organizerUnitId, 'u-26')
  assert.equal(d.organizerName, 'Comité Drôme')
  assert.deepEqual(d.editors, ['a', 'b'])
  assert.deepEqual(d.teams, ['t-gardiens'])
  assert.deepEqual(d.names, { a: 'Anne', b: 'Bruno', c: 'Chloé' })
  // Liste des joueurs, et qui les avait ajoutés (seulement pour les joueurs copiés).
  assert.deepEqual(d.playerIds, ['p1', 'p2', 'p3'])
  assert.deepEqual(d.addedBy, { p1: 'a', p2: 'c' })
  // Équipes : équipes, équipe et numéro des joueurs copiés ; équipes confiées (seulement celles qui existent).
  assert.deepEqual(d.tournament, {
    teams: [
      { id: 'e1', name: 'Drôme' },
      { id: 'e2', name: 'Ardèche' },
    ],
    players: { p1: { team: 'e1', num: '7' }, p2: { team: 'e2' } },
    assign: { a: ['e1'], b: ['e2'] },
  })
  // Jamais repris : identifiant, feuille de match, heure, archivage, signature.
  const keys = Object.keys(d)
  for (const k of ['id', 'matchSheet', 'time', 'archived', 'createdBy', 'updatedAt', 'deleted']) assert.ok(!keys.includes(k), `${k} n’est pas copié`)
  // Copies indépendantes : changer le brouillon ne touche pas l'original.
  d.playerIds!.push('p4')
  d.editors.push('z')
  d.tournament!.teams[0].name = 'Changé'
  d.tournament!.players!.p1.num = '99'
  d.names!.a = 'Changé'
  assert.equal(JSON.stringify(ev), before, 'l’original n’est jamais modifié')
}

// ---------- 3. Cases décochées ----------
{
  // Même nom, date d'origine.
  const d = buildCopyDraft(ev, { ...ALL_COPY, rename: false, today: false }, existing, '2026-10-20')
  assert.equal(d.name, 'Tournoi U15')
  assert.equal(d.date, '2026-04-12')

  // Sans la liste : ni joueurs, ni « ajouté par » ; les équipes restent, sans joueurs ni numéros.
  const n = buildCopyDraft(ev, { ...ALL_COPY, players: false }, existing, '2026-10-20')
  assert.equal(n.playerIds, undefined)
  assert.equal(n.addedBy, undefined)
  assert.deepEqual(n.tournament?.teams.map((t) => t.name), ['Drôme', 'Ardèche'])
  assert.equal(n.tournament?.players, undefined)

  // Sans les équipes.
  const t = buildCopyDraft(ev, { ...ALL_COPY, teams: false }, existing, '2026-10-20')
  assert.equal(t.tournament, undefined)
  assert.deepEqual(t.playerIds, ['p1', 'p2', 'p3'])

  // Rien de coché : seulement ce qui est toujours repris.
  const z = buildCopyDraft(ev, { players: false, rename: false, today: false, teams: false }, existing, '2026-10-20')
  assert.deepEqual(
    { name: z.name, date: z.date, type: z.type, place: z.place, players: z.playerIds, tournament: z.tournament, editors: z.editors },
    { name: 'Tournoi U15', date: '2026-04-12', type: 'tournoi', place: 'Valence', players: undefined, tournament: undefined, editors: ['a', 'b'] },
  )
}

// ---------- 4. Événement simple (sans joueurs, sans équipes, sans participants) ----------
{
  const simple = { id: 's', updatedAt: 1, name: 'Observation', type: 'observation', date: '2026-09-01' } as HBEvent
  const d = buildCopyDraft(simple, ALL_COPY, ['Observation'], '2026-10-20')
  assert.equal(d.name, 'Observation (copie)')
  assert.equal(d.playerIds, undefined, 'liste vide : rien à copier')
  assert.equal(d.tournament, undefined)
  assert.deepEqual(d.editors, [])
  assert.equal(d.teams, undefined)
  assert.equal(d.names, undefined)
  assert.equal(d.place, undefined)
  // Doublons dans la liste : une seule fois.
  const dup = buildCopyDraft({ ...simple, playerIds: ['p1', 'p1', 'p2'] }, ALL_COPY, [], '2026-10-20')
  assert.deepEqual(dup.playerIds, ['p1', 'p2'])
}

console.log('test-dupliquer : OK')
