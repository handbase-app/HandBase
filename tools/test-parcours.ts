// Test du parcours d'un joueur par palier (src/parcours.ts) : palier par unité organisatrice, par mots du nom (accents,
// majuscules), match toujours « Repéré », ordre fixe Repéré → Comité → Ligue → Pôle → France, palier absent masqué, comptes
// (avis, mesures, observateurs distincts) et période, repli « ⋯ N autres », joueur sans rien, volley (FFVB, ligue, comité).
// Données fictives seulement.
//
//   npx jiti tools/test-parcours.ts
import assert from 'node:assert/strict'
import { dotCount, foldSteps, monthYear, palierFacts, palierFromWords, palierOf, parcours, periodLabel, stripTag, type ParcoursEvent, type ParcoursInput } from '../src/parcours'
import type { LevelRow, UnitRow } from '../src/structureTree'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

// ---------- Structure fictive ----------

const levels: LevelRow[] = [
  { id: 'niveau-federation', name: 'Fédération', order: 1 },
  { id: 'niveau-ligue', name: 'Ligue', order: 2 },
  { id: 'niveau-comite', name: 'Comité', order: 3 },
  { id: 'niveau-pole', name: 'Pôle', order: 4 },
  { id: 'niveau-club', name: 'Club', order: 5 },
  // Niveau saisi à la main, reconnu à son nom.
  { id: 'lv-maison', name: 'Comités départementaux', order: 6 },
]
const units: UnitRow[] = [
  { id: 'fed', levelId: 'niveau-federation', name: 'Fédération fictive' },
  { id: 'lig', levelId: 'niveau-ligue', name: 'Ligue fictive', parentId: 'fed' },
  { id: 'cd', levelId: 'niveau-comite', name: 'Comité fictif', parentId: 'lig' },
  { id: 'pol', levelId: 'niveau-pole', name: 'Pôle fictif', parentId: 'lig' },
  { id: 'clu', levelId: 'niveau-club', name: 'Club fictif A', parentId: 'cd' },
  { id: 'cd2', levelId: 'lv-maison', name: 'Unité B', parentId: 'lig' },
]
const ev = (id: string, name: string, date: string, extra: Partial<ParcoursEvent> = {}): ParcoursEvent => ({ id, name, date, type: 'entrainement', ...extra })
const base = (over: Partial<ParcoursInput> = {}): ParcoursInput => ({
  playerId: 'j1',
  events: [],
  seen: [],
  evaluations: [],
  measurements: [],
  units,
  levels,
  today: '2026-10-31',
  ...over,
})
const seen = (eventId: string, who: string) => ({ id: `${who}:${eventId}:j1`, eventId, createdBy: who })

// ---------- Palier d'un événement ----------

t('unité organisatrice : club, comité, ligue, pôle, fédération, niveau maison', () => {
  assert.equal(palierOf(ev('a', 'Stage', '2025-01-01', { organizerUnitId: 'clu' }), units, levels), 'repere')
  assert.equal(palierOf(ev('a', 'Stage', '2025-01-01', { organizerUnitId: 'cd' }), units, levels), 'comite')
  assert.equal(palierOf(ev('a', 'Stage', '2025-01-01', { organizerUnitId: 'lig' }), units, levels), 'ligue')
  assert.equal(palierOf(ev('a', 'Stage', '2025-01-01', { organizerUnitId: 'pol' }), units, levels), 'ligue')
  assert.equal(palierOf(ev('a', 'Stage', '2025-01-01', { organizerUnitId: 'fed' }), units, levels), 'france')
  assert.equal(palierOf(ev('a', 'Stage', '2025-01-01', { organizerUnitId: 'cd2' }), units, levels), 'comite')
})

t("l'unité passe avant les mots du nom ; unité absente : nom gardé, puis nom de l'événement", () => {
  // Organisé par le club, même si le nom parle de ligue.
  assert.equal(palierOf(ev('a', 'Tournoi de la ligue', '2025-01-01', { organizerUnitId: 'clu', type: 'tournoi' }), units, levels), 'repere')
  assert.equal(palierOf(ev('a', 'Stage', '2025-01-01', { organizerUnitId: 'inconnue', organizerName: 'Comité fictif' }), units, levels), 'comite')
  assert.equal(palierOf(ev('a', 'Stage de Ligue', '2025-01-01', { organizerUnitId: 'inconnue' }), units, levels), 'ligue')
})

t('mots du nom, sans accents ni majuscules', () => {
  assert.equal(palierFromWords('Stage INTERCOMITÉS 2011'), 'comite')
  assert.equal(palierFromWords('Inter-comités fictifs'), 'comite')
  // « intercomités » organisés par la ligue : Comité quand même.
  assert.equal(palierFromWords('Intercomités de la Ligue fictive'), 'comite')
  assert.equal(palierFromWords('Stage CD 83'), 'comite')
  assert.equal(palierFromWords('Sélection départementale'), 'comite')
  assert.equal(palierFromWords('Rassemblement de ligue'), 'ligue')
  assert.equal(palierFromWords('Stage régional U15'), 'ligue')
  assert.equal(palierFromWords('Interligues'), 'ligue')
  assert.equal(palierFromWords('Stage équipe de FRANCE'), 'france')
  // « national » ne suffit pas (31/10) : un « Tournoi national » de club n'est pas l'équipe de France.
  assert.equal(palierFromWords('Détection nationale'), undefined)
  assert.equal(palierFromWords('Tournoi national de Pâques'), undefined)
  assert.equal(palierFromWords('Stage EDF jeunes'), 'france')
  assert.equal(palierFromWords('Stage fédéral'), 'france')
  assert.equal(palierFromWords('Stage FFHB'), 'france')
  assert.equal(palierFromWords('Tournoi de printemps'), undefined)
  // Pas de faux amis dans un mot plus long.
  assert.equal(palierFromWords('Cdiscount cup'), undefined)
  assert.equal(palierFromWords('Francette'), undefined)
})

t('match toujours Repéré ; tournoi, entraînement, observation sans indice : Repéré', () => {
  assert.equal(palierOf(ev('a', 'Championnat de France U18', '2025-01-01', { type: 'match', organizerUnitId: 'cd' }), units, levels), 'repere')
  assert.equal(palierOf(ev('a', 'Tournoi U13', '2025-01-01', { type: 'tournoi' }), units, levels), 'repere')
  assert.equal(palierOf(ev('a', 'Séance du mercredi', '2025-01-01'), units, levels), 'repere')
  assert.equal(palierOf(ev('a', 'Observation', '2025-01-01', { type: 'observation' }), units, levels), 'repere')
  assert.equal(palierOf(ev('a', 'Tournoi intercomités', '2025-01-01', { type: 'tournoi' }), units, levels), 'comite')
})

// ---------- Parcours complet ----------

// Joueur fictif : 2 tournois, 3 intercomités, 7 stages de ligue, le pôle, 2 stages France.
const events: ParcoursEvent[] = [
  ev('t1', 'Tournoi U13', '2023-05-13', { type: 'tournoi' }),
  ev('t2', 'Tournoi de printemps', '2023-04-02', { type: 'tournoi' }),
  ev('c1', 'Stage intercomités 1', '2024-02-10', { organizerUnitId: 'cd' }),
  ev('c2', 'Stage intercomités 2', '2024-03-10', { organizerUnitId: 'cd' }),
  ev('c3', 'Intercomités', '2024-06-10', { type: 'tournoi' }),
  ...[1, 2, 3, 4, 5, 6, 7].map((i) => ev(`l${i}`, `Stage ligue n°${i}`, `${i < 4 ? 2024 : i < 7 ? 2025 : 2026}-${String(i + 2).padStart(2, '0')}-15`, { organizerUnitId: 'lig', playerIds: ['j1'] })),
  ev('f1', 'Stage EDF jeunes', '2025-11-20'),
  ev('f2', 'Stage équipe de France', '2026-10-05', { organizerUnitId: 'fed' }),
  // Événement où il n'a été ni vu ni mesuré : pas une étape.
  ev('x', 'Stage de ligue sans lui', '2025-05-05', { organizerUnitId: 'lig', playerIds: ['autre'] }),
]
const full = base({
  events,
  seen: [seen('t1', 'o1'), seen('t1', 'o2'), seen('t2', 'o1'), seen('c1', 'o3'), seen('c2', 'o3'), seen('c3', 'o1'), seen('l2', 'o4'), seen('l5', 'o4'), seen('l7', 'o8'), seen('f1', 'o5'), seen('f2', 'o5')],
  evaluations: [
    { eventId: 'c1', observer: 'Observateur 3', observerId: 'o3' },
    { eventId: 'c2', observer: 'Observateur 6', observerId: 'o6' },
    { eventId: 'l1', observer: 'Observateur 4', observerId: 'o4' },
    { eventId: 'l1', observer: 'Observateur 7', observerId: 'o7' },
    // Avis spontané : pas une étape.
    { observer: 'Observateur 1', observerId: 'o1' },
  ],
  // Séances le jour des stages de ligue 3, 4 (deux tests, une séance) et 6, sur la liste ; une séance sans événement.
  measurements: [{ date: '2024-05-15' }, { date: '2025-06-15' }, { date: '2025-06-15' }, { date: '2025-08-15' }, { date: '2025-12-01' }],
  poles: [{ regionId: 'r1', from: '2025-09-01' }],
  poleName: () => 'Pôle Espoirs fictif',
})

t('ordre fixe des paliers et palier absent masqué', () => {
  const ps = parcours(full)
  assert.deepEqual(ps.map((p) => p.id), ['repere', 'comite', 'ligue', 'pole', 'france'])
  // Sans pôle ni France : trois lignes.
  const short = parcours({ ...full, poles: [], events: events.filter((e) => !e.id.startsWith('f')) })
  assert.deepEqual(short.map((p) => p.id), ['repere', 'comite', 'ligue'])
})

t('étapes, comptes et période par palier', () => {
  const ps = new Map(parcours(full).map((p) => [p.id, p]))
  const rep = ps.get('repere')!
  assert.equal(rep.label, 'Repéré en tournoi')
  assert.deepEqual(rep.steps.map((s) => s.eventId), ['t2', 't1'])
  assert.equal(rep.observers, 2)
  assert.equal(rep.steps[1].observers, 2)
  assert.equal(periodLabel(rep), '2023')
  assert.equal(stripTag(rep), '2023')

  const cd = ps.get('comite')!
  assert.equal(cd.label, 'Stages intercomités')
  assert.equal(cd.steps.length, 3)
  assert.equal(cd.avis, 2)
  assert.equal(cd.observers, 3) // o3, o6, o1
  assert.equal(periodLabel(cd), '2024')
  assert.equal(stripTag(cd), '×3')

  const lig = ps.get('ligue')!
  assert.equal(lig.label, 'Stages de ligue')
  assert.equal(lig.steps.length, 7) // l1 à l7 (avis, vu ou mesures), pas « x »
  assert.equal(lig.mesures, 3)
  assert.equal(lig.avis, 2)
  assert.equal(lig.observers, 3) // o4, o7, o8
  assert.equal(periodLabel(lig), '2024 → 2026')
  assert.deepEqual(palierFacts(lig), ['mesures ×3', '2 avis', '3 obs.'])

  const pole = ps.get('pole')!
  assert.equal(pole.label, 'Pôle Espoirs')
  assert.equal(pole.current, true)
  assert.equal(periodLabel(pole), 'depuis sept. 2025')
  assert.equal(stripTag(pole), '2025')
  assert.equal(pole.steps[0].name, 'Pôle Espoirs fictif')

  const fra = ps.get('france')!
  assert.equal(fra.label, 'Stages équipe de France')
  assert.equal(periodLabel(fra), '2025 → 2026')
})

t('pôle terminé : période en années ; libellés au singulier et au féminin', () => {
  const ps = parcours(base({ events: [ev('l', 'Stage de ligue', '2024-03-01')], seen: [seen('l', 'o1')], poles: [{ from: '2022-09-01', to: '2024-06-30' }], sex: 'F' }))
  assert.equal(ps[0].label, 'Stage de ligue')
  assert.equal(stripTag(ps[0]), '2024')
  assert.equal(ps[1].current, false)
  assert.equal(periodLabel(ps[1]), '2022 → 2024')
  const rep = parcours(base({ events: [ev('m', 'Club A - Club B', '2025-01-12', { type: 'match' })], seen: [seen('m', 'o1')], sex: 'F' }))
  assert.equal(rep[0].label, 'Repérée en match')
  assert.equal(rep[0].short, 'Repérée')
  const mixed = parcours(base({ events: [ev('m', 'Club A - Club B', '2025-01-12', { type: 'match' }), ev('t', 'Tournoi', '2025-02-01', { type: 'tournoi' })], seen: [seen('m', 'o1'), seen('t', 'o1')] }))
  assert.equal(mixed[0].label, 'Repéré')
})

t('convocations : événement passé, hors match, sur la liste, compte même sans avis', () => {
  const evs = [
    ev('s1', 'Stage de ligue fictif', '2025-03-01', { organizerUnitId: 'lig', playerIds: ['j1'] }),
    // À venir : pas encore une étape.
    ev('s2', 'Stage de ligue à venir', '2026-12-01', { organizerUnitId: 'lig', playerIds: ['j1'] }),
    // Match « ajouté à mes événements » : la liste, ce sont ceux qui devraient jouer.
    ev('m1', 'Club A - Club B', '2025-04-01', { type: 'match', playerIds: ['j1'] }),
    // Supprimé : rien.
    ev('s3', 'Stage supprimé', '2025-05-01', { organizerUnitId: 'lig', playerIds: ['j1'], deleted: true }),
  ]
  const ps = parcours(base({ events: evs }))
  assert.deepEqual(ps.map((p) => p.id), ['ligue'])
  assert.deepEqual(ps[0].steps.map((s) => s.eventId), ['s1'])
  assert.equal(ps[0].steps[0].listed, true)
  // Vu en plus d'être sur la liste : plus « seulement convoqué ».
  const seenToo = parcours(base({ events: evs, seen: [seen('s1', 'o1')] }))
  assert.equal(seenToo[0].steps[0].listed, undefined)
})

t('joueur sans rien (ou seulement avis spontanés, tests sans événement) : pas de parcours', () => {
  assert.deepEqual(parcours(base()), [])
  assert.deepEqual(parcours(base({ evaluations: [{ observer: 'X' }], measurements: [{ date: '2025-01-01' }], events: events.map((e) => ({ ...e, playerIds: undefined })) })), [])
  // Vu à un événement absent de l'appareil : rien non plus.
  assert.deepEqual(parcours(base({ seen: [seen('absent', 'o1')] })), [])
})

t('repli « ⋯ N autres » et petits points plafonnés', () => {
  assert.deepEqual(foldSteps([1, 2, 3]), [1, 2, 3])
  assert.deepEqual(foldSteps([1, 2, 3, 4]), [1, 2, 3, 4])
  assert.deepEqual(foldSteps([1, 2, 3, 4, 5, 6, 7]), [1, 2, { more: 4 }, 7])
  assert.deepEqual(dotCount(7), { dots: 7, more: 0 })
  assert.deepEqual(dotCount(14), { dots: 10, more: 4 })
  assert.equal(monthYear('2024-10-05'), 'oct. 2024')
  assert.equal(monthYear('2024'), '2024')
})

t('volley : FFVB, ligue, comité ; libellés du volley', () => {
  const vol = parcours(
    base({
      sport: 'volley',
      events: [ev('a', 'Sélection du comité fictif', '2024-01-10'), ev('b', 'Stage Ligue fictive', '2025-02-10'), ev('c', 'Stage FFVB M15', '2026-03-10')],
      seen: [seen('a', 'o1'), seen('a', 'o2'), seen('b', 'o1'), seen('c', 'o1')],
    }),
  )
  assert.deepEqual(vol.map((p) => p.id), ['comite', 'ligue', 'france'])
  assert.equal(vol[0].label, 'Sélection départementale')
  assert.equal(vol[1].label, 'Stage de ligue')
  assert.equal(vol[2].label, 'Stage équipe de France')
})

console.log(`\n${n} tests passés`)
