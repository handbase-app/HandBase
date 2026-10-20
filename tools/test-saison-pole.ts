// Test du groupe « Pôle » d'une unité et du changement de saison (src/poleSeason.ts) : correspondance unité / période
// (avec et sans accents, ancien champ `name`, ligue), vue en cours / prochaine avec des dates futures, reconduit = rien
// écrit, sortant = sortie + motif, nouveau = période créée, transfert d'un pôle à l'autre, rétablir, propositions par âge
// pour les trois programmes, annuler une arrivée à venir, groupes Pôle matérialisés (membres en cours), statut de saison, droits (affecté à l'unité, à une autre unité, administrateur, observateur).
// Données fictives seulement.
//
//   npx jiti tools/test-saison-pole.ts
import assert from 'node:assert/strict'
import type { PolePeriod } from '../src/db'
import {
  applySeason,
  batchSize,
  cancelArrival,
  closePeriod,
  defaultPoleGroupName,
  exportGaps,
  isMemberAt,
  isPoleLeader,
  isPoleUnit,
  joinPole,
  leavePole,
  likelyEnd,
  materializePoleGroups,
  membersAt,
  myPoleUnits,
  otherPoleAt,
  periodMatches,
  poleRefOf,
  poleRefsOf,
  POLE_ENTRY_DAY,
  POLE_EXIT_DAY,
  refDate,
  reopenPeriod,
  seasons,
  seasonStatus,
  seasonStatusLabel,
  seasonSummary,
  suggestProgramme,
  unitRegionId,
  upcomingIndex,
  viewLabel,
} from '../src/poleSeason'
import { poleViewOf, withPoleView } from '../src/tabQuery'
import { can } from '../src/roles'
import type { AssignmentRow, LevelRow, UnitRow } from '../src/structureTree'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const today = '2026-10-19'

// ---------- Saisons ----------

t('saisons : en cours, prochaine, dates de référence et de bascule', () => {
  const s = seasons(today)
  assert.equal(s.current.label, '2026-2027')
  assert.equal(s.next.label, '2027-2028')
  assert.equal(s.refCurrent, today)
  assert.equal(s.refNext, '2027-09-01')
  assert.equal(s.exit, `2027-${POLE_EXIT_DAY}`)
  assert.equal(s.entry, `2027-${POLE_ENTRY_DAY}`)
  assert.equal(refDate('courante', s), today)
  assert.equal(refDate('prochaine', s), '2027-09-01')
  assert.equal(viewLabel('courante', s), 'Saison en cours (2026-2027)')
  assert.equal(viewLabel('prochaine', s), 'Saison prochaine (2027-2028)')
  // En juillet, la saison en cours est encore celle qui finit le 31 août.
  assert.equal(seasons('2027-07-15').current.label, '2026-2027')
  assert.equal(seasons('2027-09-01').current.label, '2027-2028')
})

t('vue dans l’adresse : ?saison=prochaine, rien pour la vue par défaut', () => {
  assert.equal(poleViewOf(''), 'courante')
  assert.equal(poleViewOf('?saison=prochaine'), 'prochaine')
  assert.equal(poleViewOf('?saison=autre'), 'courante')
  assert.equal(withPoleView('?x=1', 'prochaine'), '?x=1&saison=prochaine')
  assert.equal(withPoleView('?saison=prochaine', 'courante'), '')
})

// ---------- Structure fictive ----------

const levels: LevelRow[] = [
  { id: 'niveau-federation', name: 'Fédération', order: 1 },
  { id: 'niveau-ligue', name: 'Ligue', order: 2 },
  { id: 'niveau-comite', name: 'Comité', order: 3 },
  { id: 'niveau-pole', name: 'Pôle', order: 4 },
]
const units: UnitRow[] = [
  { id: 'fed', levelId: 'niveau-federation', name: 'Fédération' },
  { id: 'ligue-sud', levelId: 'niveau-ligue', name: 'Ligue Sud', parentId: 'fed' },
  { id: 'com-83', levelId: 'niveau-comite', name: 'Comité 83', parentId: 'ligue-sud', departments: ['83'] },
  { id: 'pole-sr', levelId: 'niveau-pole', name: 'Pôle Saint-Raphaël (garçons)', parentId: 'ligue-sud', poleSex: 'M', poleSite: 'Saint-Raphaël', poleLevels: ['accession'], psqsRef: 'PSQS-TEST' },
  { id: 'pole-nice', levelId: 'niveau-pole', name: 'Pôle Nice (filles)', parentId: 'ligue-sud', poleSex: 'F', poleSite: 'Nice', poleLevels: ['accession_territoriale'] },
  { id: 'ligue-occ', levelId: 'niveau-ligue', name: 'Ligue Occitanie', parentId: 'fed' },
  { id: 'pole-tlse', levelId: 'niveau-pole', name: 'Pôle Toulouse (filles)', parentId: 'ligue-occ', poleSex: 'F', poleSite: 'Toulouse', poleLevels: ['accession', 'excellence'] },
  { id: 'pole-x', levelId: 'niveau-pole', name: 'Pôle supprimé', parentId: 'ligue-sud', deleted: true },
  { id: 'ligue-nord', levelId: 'niveau-ligue', name: 'Ligue Nord', parentId: 'fed' },
  { id: 'pole-amiens', levelId: 'niveau-pole', name: 'Pôle Amiens', parentId: 'ligue-nord', poleSite: 'Amiens' },
]
const regions = [
  { id: 'region-sud', name: 'Région Sud' },
  { id: 'region-occ', name: 'Occitanie' },
]
const regionOfDept = (d: string) => (d === '83' ? 'region-sud' : undefined)
const opts = { regionOfDept, regions }
const ropts = { ...opts, levels }

t('unité de niveau Pôle : identifiant proposé, ou niveau nommé « Pôle »', () => {
  assert.equal(isPoleUnit(units[3], levels), true)
  assert.equal(isPoleUnit(units[1], levels), false)
  assert.equal(isPoleUnit({ levelId: 'autre' }, [{ id: 'autre', name: 'Pôles Espoirs', order: 9 }]), true)
})

t('ligue d’une unité : par les départements de ses sous-unités, sinon par le nom', () => {
  assert.equal(unitRegionId(units, 'pole-sr', ropts), 'region-sud')
  assert.equal(unitRegionId(units, 'pole-tlse', ropts), 'region-occ')
  assert.equal(unitRegionId(units, 'fed', ropts), undefined) // la Fédération n'est pas une ligue
  assert.equal(unitRegionId(units, 'pole-amiens', ropts), undefined) // ligue sans département ni nom connu : rien (pas celle de la Fédération)
  assert.equal(unitRegionId(units, 'inconnue', ropts), undefined)
})

const SR = poleRefOf(units, levels, 'pole-sr', opts)!
const TLSE = poleRefOf(units, levels, 'pole-tlse', opts)!

t('référence d’une unité Pôle : site, ligue, sexe, programmes, PSQS ; rien pour une unité qui n’est pas un pôle', () => {
  assert.deepEqual(SR, { unitId: 'pole-sr', regionId: 'region-sud', site: 'Saint-Raphaël', sex: 'M', levels: ['accession'], name: 'Pôle Saint-Raphaël (garçons)', psqsRef: 'PSQS-TEST' })
  assert.equal(poleRefOf(units, levels, 'ligue-sud', opts), null)
  assert.equal(poleRefOf(units, levels, 'pole-x', opts), null)
  assert.equal(defaultPoleGroupName(units[3]), 'Pôle Saint-Raphaël')
  assert.equal(defaultPoleGroupName({ name: 'Pôle Ajaccio' }), 'Pôle Ajaccio')
})

// ---------- Correspondance période ↔ unité ----------

t('période ↔ unité : même site sans accents ni majuscules, ancien champ name, ligue', () => {
  assert.equal(periodMatches({ regionId: 'region-sud', site: 'Saint-Raphaël' }, SR), true)
  assert.equal(periodMatches({ regionId: 'region-sud', site: 'saint raphael' }, SR), true)
  assert.equal(periodMatches({ site: 'SAINT-RAPHAEL' }, SR), true) // ligue inconnue sur la période : le site suffit
  assert.equal(periodMatches({ name: 'Pôle Espoirs Saint-Raphaël', from: '2024-09-01' }, SR), true) // ancienne saisie libre
  assert.equal(periodMatches({ name: 'Pôle Saint-Raph' }, SR), true) // abrégé : premier mot du site
  assert.equal(periodMatches({ regionId: 'region-sud', site: 'Aix-en-Provence' }, SR), false)
  assert.equal(periodMatches({ regionId: 'region-occ', site: 'Saint-Raphaël' }, SR), false) // autre ligue, même ville
  assert.equal(periodMatches({ regionId: 'region-cor', site: 'Saint-Raphaël' }, SR), true) // Corse : même pôle que Région Sud
  assert.equal(periodMatches({}, SR), false)
})

// ---------- Joueurs fictifs ----------

type P = { id: string; firstName: string; lastName: string; birthDate?: string; sex?: 'M' | 'F'; license?: string; poles?: PolePeriod[] }
const sr = (extra: Partial<PolePeriod> = {}): PolePeriod => ({ regionId: 'region-sud', site: 'Saint-Raphaël', from: '2025-07-01', ...extra })
const P = (id: string, birthDate: string | undefined, poles?: PolePeriod[], extra: Partial<P> = {}): P => ({ id, firstName: 'Prénom', lastName: id.toUpperCase(), birthDate, sex: 'M', license: '123', poles, ...extra })
const players: P[] = [
  P('a', '2011-03-01', [sr()]), // au pôle, reste dans le programme
  P('b', '2009-05-01', [sr()]), // au pôle, Tle cette saison : fin de cursus probable
  P('c', '2011-01-01'), // jamais en pôle
  P('d', '2010-07-01', [sr({ to: '2026-06-30', exitReason: 'fin_cursus' })]), // sorti l'été dernier
  P('e', '2011-02-01', [{ regionId: 'region-sud', site: 'Aix-en-Provence', from: '2025-07-01' }]), // autre pôle en cours
  P('f', '2012-01-01', [sr({ from: '2027-07-01' })]), // entrée déjà enregistrée pour la saison prochaine
  P('g', '2010-04-01', [sr({ to: '2027-06-30', exitReason: 'blessure' })]), // sortie déjà enregistrée à la fin de la saison
  P('h', undefined, [sr()]), // date de naissance inconnue
]
const s = seasons(today)

t('vue en cours et vue prochaine : les dates futures font le travail', () => {
  assert.deepEqual(membersAt(players, SR, s.refCurrent).map((p) => p.id), ['a', 'b', 'g', 'h'])
  assert.deepEqual(membersAt(players, SR, s.refNext).map((p) => p.id), ['a', 'b', 'f', 'h'])
  assert.equal(isMemberAt(players[4], SR, today), false)
  assert.deepEqual(otherPoleAt(players[4], SR, today), players[4].poles![0])
  assert.equal(otherPoleAt(players[0], SR, today), undefined)
})

// ---------- Groupes Pôle matérialisés (filtres, recettes, questions : src/poleMembers.ts) ----------

t('références de toutes les unités Pôle : les pôles seulement, pas une unité supprimée', () => {
  const refs = poleRefsOf(units, levels, opts)
  assert.deepEqual([...refs.keys()].sort(), ['pole-amiens', 'pole-nice', 'pole-sr', 'pole-tlse'])
  assert.deepEqual(refs.get('pole-sr'), SR)
})

t('groupe Pôle matérialisé : membres en cours ; arrivée future pas comptée ; groupe ordinaire et unité supprimée inchangés', () => {
  const refs = poleRefsOf(units, levels, opts)
  const pole = { id: 'g-sr', name: 'Pôle Saint-Raphaël', poleUnitId: 'pole-sr', playerIds: ['vieux'] }
  const plain = { id: 'g-1', name: 'Repérés', playerIds: ['c', 'e'] }
  const orphan = { id: 'g-x', name: 'Pôle supprimé', poleUnitId: 'pole-x', playerIds: ['old'] }
  const nice = { id: 'g-nice', name: 'Pôle Nice', poleUnitId: 'pole-nice', playerIds: [] as string[] }
  const out = materializePoleGroups([pole, plain, orphan, nice], refs, players, s.refCurrent)
  // Membres calculés à la date de la vue « Saison en cours » : f (entrée au 1er juillet prochain) n'y est pas, d (sorti) non plus.
  assert.deepEqual(out[0].playerIds, ['a', 'b', 'g', 'h'])
  assert.deepEqual(out[0].playerIds, membersAt(players, SR, s.refCurrent).map((p) => p.id))
  assert.equal(out[0].playerIds.includes('f'), false)
  assert.equal(out[0].name, 'Pôle Saint-Raphaël')
  // Copie : le groupe lu n'est pas modifié (rien à réenregistrer).
  assert.notEqual(out[0], pole)
  assert.deepEqual(pole.playerIds, ['vieux'])
  // Groupe ordinaire : le même objet, playerIds tels quels.
  assert.equal(out[1], plain)
  // Unité supprimée (plus de référence) : playerIds d'origine.
  assert.equal(out[2], orphan)
  assert.deepEqual(out[2].playerIds, ['old'])
  // Pôle sans membre : liste vide.
  assert.deepEqual(out[3].playerIds, [])
  // Vue « Saison prochaine » (autre date) : f arrive, g est sorti.
  assert.deepEqual(materializePoleGroups([pole], refs, players, s.refNext)[0].playerIds, ['a', 'b', 'f', 'h'])
  // Aucun pôle connu : tout inchangé.
  assert.equal(materializePoleGroups([pole], new Map(), players, s.refCurrent)[0], pole)
})

// ---------- Propositions ----------

t('fin de cursus probable : l’année de naissance sort du programme la saison prochaine', () => {
  const y = 2027 // début de la saison prochaine
  // Accession (3e-Tle, 14-17 ans scolaires) : né en 2009 → 18 en 2027 : sort ; né en 2010 → 17 : reste.
  assert.equal(likelyEnd(players[1], {}, ['accession'], y), true)
  assert.equal(likelyEnd(P('x', '2010-01-01'), {}, ['accession'], y), false)
  assert.equal(likelyEnd(players[7], {}, ['accession'], y), false) // date inconnue : pas de proposition
  // Accession territoriale (3e-2de) : né en 2011 → 16 en 2027 : sort ; né en 2012 → 15 : reste.
  assert.equal(likelyEnd(P('x', '2011-01-01'), { programme: 'accession_territoriale' }, [], y), true)
  assert.equal(likelyEnd(P('x', '2012-01-01'), { programme: 'accession_territoriale' }, [], y), false)
  // Accession nationale (1re-Tle) et excellence (16-17 ans) : né en 2009 sort, né en 2010 reste.
  assert.equal(likelyEnd(P('x', '2009-01-01'), { programme: 'accession_nationale' }, [], y), true)
  assert.equal(likelyEnd(P('x', '2010-01-01'), { programme: 'accession_nationale' }, [], y), false)
  assert.equal(likelyEnd(P('x', '2009-01-01'), { programme: 'excellence' }, [], y), true)
  assert.equal(likelyEnd(P('x', '2010-01-01'), { programme: 'excellence' }, [], y), false)
  // Programme absent de la période, unité à un seul programme : celui-ci.
  assert.equal(likelyEnd(P('x', '2011-01-01'), {}, ['accession_territoriale'], y), true)
})

t('programme déduit de l’âge et du sexe parmi ceux de l’unité', () => {
  const y = 2027
  const both: ('accession_territoriale' | 'accession_nationale')[] = ['accession_territoriale', 'accession_nationale']
  assert.equal(suggestProgramme(both, P('x', '2013-01-01'), y), 'accession_territoriale') // 14 : 3e
  assert.equal(suggestProgramme(both, P('x', '2012-01-01'), y), 'accession_territoriale') // 15 : 2de
  assert.equal(suggestProgramme(both, P('x', '2011-01-01'), y), 'accession_nationale') // 16 : 1re
  assert.equal(suggestProgramme(both, P('x', '2010-01-01'), y), 'accession_nationale') // 17 : Tle
  assert.equal(suggestProgramme(both, P('x', '2009-01-01'), y), undefined) // 18 : hors programme
  // Excellence (filles 16-17 ans) : proposée à une fille de 16-17 ans avant « accession », jamais à un garçon.
  assert.equal(suggestProgramme(['accession', 'excellence'], P('x', '2011-01-01', [], { sex: 'F' }), y), 'excellence')
  assert.equal(suggestProgramme(['accession', 'excellence'], P('x', '2012-01-01', [], { sex: 'F' }), y), 'accession')
  assert.equal(suggestProgramme(['excellence'], P('x', '2011-01-01', [], { sex: 'F' }), y), 'excellence')
  assert.equal(suggestProgramme(['excellence'], P('x', '2011-01-01'), y), undefined)
  // Date inconnue : le seul programme de l'unité, sinon rien.
  assert.equal(suggestProgramme(['accession'], P('x', undefined), y), 'accession')
  assert.equal(suggestProgramme(both, P('x', undefined), y), undefined)
})

// ---------- Écritures ----------

t('sortant : sortie et motif sur la période en cours ; rétablir efface les deux', () => {
  const out = leavePole(players[0], SR, today, s.exit, 'fin_cursus')!
  assert.deepEqual(out, [sr({ to: '2027-06-30', exitReason: 'fin_cursus' })])
  assert.deepEqual(players[0].poles, [sr()]) // la fiche d'origine n'est pas touchée
  assert.equal(leavePole(players[2], SR, today, s.exit, 'autre'), null) // pas au pôle : rien
  assert.deepEqual(reopenPeriod(out, 0), [sr()])
  assert.deepEqual(closePeriod([sr(), sr({ from: '2020-01-01', to: '2021-01-01', exitReason: 'autre' })], 0, '2027-06-30', 'blessure')[1], sr({ from: '2020-01-01', to: '2021-01-01', exitReason: 'autre' }))
})

t('nouveau : période créée (région, site, programme, entrée) ; déjà membre : rien', () => {
  const r = joinPole(players[2], SR, { day: s.entry, entry: s.entry, exit: s.exit, programme: 'accession' })!
  assert.deepEqual(r.poles, [{ regionId: 'region-sud', site: 'Saint-Raphaël', programme: 'accession', from: '2027-07-01' }])
  assert.equal(r.transferredFrom, undefined)
  assert.equal(joinPole(players[0], SR, { day: s.entry, entry: s.entry, exit: s.exit }), null)
  assert.equal(joinPole(players[5], SR, { day: s.entry, entry: s.entry, exit: s.exit }), null) // entrée déjà enregistrée
  // Unité sans ligue connue : pas de regionId sur la période.
  const noRegion = joinPole(players[2], { site: 'Ajaccio' }, { day: s.entry, entry: s.entry, exit: s.exit })!
  assert.deepEqual(noRegion.poles, [{ site: 'Ajaccio', from: '2027-07-01' }])
})

t('transfert : la période de l’autre pôle est fermée au 30 juin avec le motif « autre »', () => {
  const r = joinPole(players[4], SR, { day: s.entry, entry: s.entry, exit: s.exit, programme: 'accession' })!
  assert.deepEqual(r.transferredFrom, players[4].poles![0])
  assert.deepEqual(r.poles, [
    { regionId: 'region-sud', site: 'Aix-en-Provence', from: '2025-07-01', to: '2027-06-30', exitReason: 'autre' },
    { regionId: 'region-sud', site: 'Saint-Raphaël', programme: 'accession', from: '2027-07-01' },
  ])
})

t('annuler l’arrivée : arrivée à venir seule → plus aucune période', () => {
  // f : entrée enregistrée au 1er juillet 2027, rien d'autre.
  assert.equal(upcomingIndex(players[5], SR, today), 0)
  assert.deepEqual(cancelArrival(players[5], SR, today), [])
  assert.deepEqual(cancelArrival(players[5], SR, today, s.refNext), []) // vue « Saison prochaine »
  assert.deepEqual(players[5].poles, [sr({ from: '2027-07-01' })]) // la fiche d'origine n'est pas touchée
  assert.equal(isMemberAt({ poles: cancelArrival(players[5], SR, today)! }, SR, s.refNext), false)
})

t('annuler l’arrivée : après une période passée, seule l’arrivée disparaît', () => {
  const past = sr({ from: '2023-07-01', to: '2025-06-30', exitReason: 'autre' })
  const p = P('r', '2011-01-01', [past, sr({ from: '2027-07-01', programme: 'accession' })])
  assert.equal(upcomingIndex(p, SR, today), 1)
  assert.deepEqual(cancelArrival(p, SR, today), [past])
  // Transfert : la période de l'autre pôle fermée au 30 juin par cette arrivée reste telle quelle (pas rouverte).
  const moved = joinPole(players[4], SR, { day: s.entry, entry: s.entry, exit: s.exit, programme: 'accession' })!.poles
  assert.deepEqual(cancelArrival({ poles: moved }, SR, today), [moved[0]])
})

t('annuler l’arrivée : période déjà commencée → rien à annuler (elle se ferme)', () => {
  assert.equal(upcomingIndex(players[0], SR, today), -1)
  assert.equal(cancelArrival(players[0], SR, today), null)
  assert.equal(cancelArrival(players[0], SR, today, s.refNext), null)
  // Arrivée aujourd'hui même : déjà commencée.
  assert.equal(cancelArrival(P('t', '2011-01-01', [sr({ from: today })]), SR, today), null)
  // Sortie déjà enregistrée (période en cours fermée au 30 juin) : rien non plus.
  assert.equal(cancelArrival(players[6], SR, today), null)
})

t('annuler l’arrivée : un autre pôle reste intact', () => {
  const aix = { regionId: 'region-sud', site: 'Aix-en-Provence', from: '2027-07-01' }
  const both = P('o', '2011-01-01', [sr(), aix])
  // Arrivée à venir à Aix seulement : rien à annuler à Saint-Raphaël (période en cours) ; à Aix, seule celle-ci part.
  assert.equal(cancelArrival(both, SR, today), null)
  assert.deepEqual(cancelArrival(both, { regionId: 'region-sud', site: 'Aix-en-Provence' }, today), [sr()])
  // Arrivée à venir à Saint-Raphaël, période en cours ailleurs : celle d'ailleurs ne bouge pas.
  const other = P('q', '2011-01-01', [{ regionId: 'region-sud', site: 'Aix-en-Provence', from: '2025-07-01' }, sr({ from: '2027-07-01' })])
  assert.deepEqual(cancelArrival(other, SR, today), [{ regionId: 'region-sud', site: 'Aix-en-Provence', from: '2025-07-01' }])
  // Le jour de la vue ne couvre pas l'arrivée : rien.
  assert.equal(cancelArrival(players[5], SR, today, today), null)
})

t('lot : reconduit = rien écrit, sortant = sortie + motif, nouveau = période, transfert signalé', () => {
  const batch = { keep: ['a', 'h'], leave: [{ id: 'b', reason: 'fin_cursus' as const }], add: [{ id: 'c', programme: 'accession' as const }, { id: 'e' }] }
  const writes = applySeason(players, SR, batch, { day: today, exit: s.exit, entry: s.entry })
  assert.deepEqual(
    writes.map((w) => [w.id, w.kind, !!w.transferredFrom]),
    [
      ['b', 'sortant', false],
      ['c', 'nouveau', false],
      ['e', 'nouveau', true],
    ],
  )
  assert.deepEqual(writes[0].poles, [sr({ to: '2027-06-30', exitReason: 'fin_cursus' })])
  assert.deepEqual(writes[1].poles, [{ regionId: 'region-sud', site: 'Saint-Raphaël', programme: 'accession', from: '2027-07-01' }])
  assert.equal(writes.some((w) => w.id === 'a'), false)
  assert.equal(batchSize(batch), 3)
  // Après le lot : vue prochaine = reconduits + nouveaux, sans les sortants.
  const after = players.map((p) => ({ ...p, poles: writes.find((w) => w.id === p.id)?.poles ?? p.poles }))
  assert.deepEqual(membersAt(after, SR, s.refNext).map((p) => p.id), ['a', 'c', 'e', 'f', 'h'])
  assert.deepEqual(membersAt(after, SR, s.refCurrent).map((p) => p.id), ['a', 'b', 'g', 'h']) // la saison en cours ne bouge pas
  assert.equal(seasonSummary(batch, false, 1), '2 reconduits · 2 nouveaux (dont 1 transfert depuis un autre pôle) · 1 sortant (1 fin de cursus)')
  assert.equal(
    seasonSummary({ keep: Array(12).fill('x'), leave: [...Array(3).fill({ id: 'x', reason: 'fin_cursus' }), { id: 'y', reason: 'blessure' }, { id: 'z', reason: 'autre' }], add: Array(4).fill({ id: 'n' }) }),
    '12 reconduits · 4 nouveaux · 5 sortants (3 fin de cursus, 1 blessure, 1 autre)',
  )
  assert.equal(seasonSummary({ keep: ['a'], leave: [], add: [{ id: 'b' }] }, true), '1 reconduite · 1 nouvelle · 0 sortante')
})

// ---------- Statut de saison (export) ----------

t('statut de saison : reconduit / nouveau / sorti (motif) / rien', () => {
  assert.deepEqual(seasonStatus(players[0], SR, s), { status: 'reconduit' })
  assert.deepEqual(seasonStatus(players[5], SR, s), { status: 'nouveau' })
  assert.deepEqual(seasonStatus(players[6], SR, s), { status: 'sorti', reason: 'blessure' })
  assert.deepEqual(seasonStatus(players[2], SR, s), { status: '' })
  assert.deepEqual(seasonStatus(players[3], SR, s), { status: '' }) // sorti l'été dernier : plus dans aucune vue
  assert.equal(seasonStatusLabel({ status: 'reconduit' }, 'F'), 'Reconduite')
  assert.equal(seasonStatusLabel({ status: 'nouveau' }, 'M'), 'Nouveau')
  assert.equal(seasonStatusLabel({ status: 'sorti', reason: 'blessure' }, 'M'), 'Sorti (blessure)')
  assert.equal(seasonStatusLabel({ status: 'sorti' }, 'F'), 'Sortie')
  assert.equal(seasonStatusLabel({ status: '' }), '')
})

t('contrôle avant export : licence, date de naissance complète, sexe', () => {
  assert.deepEqual(exportGaps(players[0]), [])
  assert.deepEqual(exportGaps({ license: '', birthDate: '2010', sex: undefined }), ['licence', 'date de naissance complète', 'sexe'])
  assert.deepEqual(exportGaps({ license: '1', birthDate: '2010-01-01', sex: 'F' }), [])
})

// ---------- Droits ----------

const assignments: AssignmentRow[] = [
  { id: 'a1', userId: 'u-sr', unitId: 'pole-sr', role: 'preparateur' },
  { id: 'a2', userId: 'u-nice', unitId: 'pole-nice', role: 'admin' },
  { id: 'a3', userId: 'u-obs', unitId: 'pole-sr', role: 'observateur' },
  { id: 'a4', userId: 'u-ligue', unitId: 'ligue-sud', role: 'preparateur' },
  { id: 'a5', userId: 'u-old', unitId: 'pole-sr', role: 'preparateur', deleted: true },
]

t('dirigeant du pôle : affecté à l’unité (encadrant ou admin) ; pas une autre unité, pas la ligue, pas l’observateur', () => {
  assert.equal(isPoleLeader(assignments, 'u-sr', 'pole-sr'), true)
  assert.equal(isPoleLeader(assignments, 'u-nice', 'pole-nice'), true)
  assert.equal(isPoleLeader(assignments, 'u-nice', 'pole-sr'), false) // affecté à une autre unité
  assert.equal(isPoleLeader(assignments, 'u-obs', 'pole-sr'), false) // observateur
  assert.equal(isPoleLeader(assignments, 'u-ligue', 'pole-sr'), false) // la Ligue lit seulement
  assert.equal(isPoleLeader(assignments, 'u-old', 'pole-sr'), false) // affectation supprimée
  assert.equal(isPoleLeader(assignments, null, 'pole-sr'), false)
  // Droit de l'appli (src/roles.ts) : l'administrateur partout, les autres seulement s'ils dirigent le pôle.
  assert.equal(can.editPoles('admin', false), true)
  assert.equal(can.editPoles('preparateur', true), true)
  assert.equal(can.editPoles('preparateur', false), false)
  assert.equal(can.editPoles('observateur', true), true) // dirigeant par affectation « admin » sur l'unité : le rôle d'affectation prime
  assert.equal(can.editPoles('observateur', false), false)
})

t('mes unités Pôle : celles que je dirige ; toutes pour un administrateur ; jamais une unité supprimée', () => {
  assert.deepEqual(myPoleUnits(units, levels, assignments, 'u-sr', false).map((u) => u.id), ['pole-sr'])
  assert.deepEqual(myPoleUnits(units, levels, assignments, 'u-ligue', false), [])
  assert.deepEqual(myPoleUnits(units, levels, assignments, 'u-obs', false), [])
  assert.deepEqual(myPoleUnits(units, levels, assignments, null, true).map((u) => u.id), ['pole-amiens', 'pole-nice', 'pole-sr', 'pole-tlse'])
  assert.equal(TLSE.levels.length, 2)
})

console.log(`\n${n} tests OK`)
