// Test des sélections (src/selections.ts) : noms et identifiants fixes des groupes (comité, ligue, équipe de France), périodes
// (correspondance au groupe, sexe), membres du jour et d'une saison passée, saisons passées proposées, ajout (période ouverte)
// et retrait (sortie + motif neutre, rien ne s'efface), groupes « matérialisés » qui alimentent les niveaux de l'anneau
// (src/levels.ts), groupes de la structure à créer, garde-fou de saisie, conversion d'un ancien groupe, filtres de la liste
// Joueurs et de Demander (recette, lecture de la réponse du modèle, phrase lue sur l'appareil), stages. Données fictives.
//
//   npx jiti tools/test-selections.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  cancelUpcoming,
  cleanSelectionWanted,
  cleanStageWanted,
  closeSelection,
  comiteName,
  dayBefore,
  endSelection,
  DEPT_DE,
  conversionTarget,
  conversionWrites,
  isSelectedAt,
  ligueName,
  majorityCategory,
  materializeSelectionGroups,
  membersOfView,
  missingSelectionGroups,
  openSelection,
  parsePeriodWanted,
  pastSeasons,
  periodText,
  readSelectionWanted,
  readStageWanted,
  SELECTION_EXITS,
  selectionBlockMessage,
  selectionGroupId,
  selectionGroupName,
  selectionGroupSpecs,
  selectionIssues,
  selectionLevelOfUnit,
  selectionMatches,
  selectionMembersAt,
  selectionMembersIn,
  selectionPhraseIn,
  selectionSummary,
  selectionViewOf,
  selectionWantedMatches,
  selectionWantedText,
  stageMatches,
  stageWantedText,
  suggestCategory,
  withSelectionView,
  type SelectionPeriod,
  type SelectionRef,
} from '../src/selections'
import { allPlayerLevels, scopeLevelMap } from '../src/levels'
import { buildIndex, cleanRecipe, interpretRecipe, recipeChips, runRecipe, type QData, type QPlayer, type QuestionContext, type Recipe } from '../src/recipe'
import { rescueInterpretation } from '../src/questionRescue'
import { activeKeys, mergeQuery, needsFullData, EMPTY_QUERY } from '../src/playerQuery'
import { normalize } from '../src/voiceFilters'
import type { LevelRow, UnitRow } from '../src/structureTree'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const TODAY = '2026-11-23'

// ---------- Structure fictive ----------
const levels: LevelRow[] = [
  { id: 'niveau-federation', name: 'Fédération', order: 1 },
  { id: 'niveau-ligue', name: 'Ligue', order: 2 },
  { id: 'niveau-comite', name: 'Comité', order: 3 },
  { id: 'niveau-pole', name: 'Pôle', order: 4 },
  { id: 'niveau-club', name: 'Club', order: 5 },
  { id: 'lv-cd', name: 'Comités départementaux', order: 6 },
]
const units: UnitRow[] = [
  { id: 'fed', levelId: 'niveau-federation', name: 'Fédération fictive' },
  { id: 'lig', levelId: 'niveau-ligue', name: 'Ligue Fictive de handball', parentId: 'fed', departments: ['98'] },
  { id: 'cd1', levelId: 'niveau-comite', name: 'Comité du Fictif (98)', parentId: 'lig', departments: ['98'] },
  { id: 'cd2', levelId: 'lv-cd', name: 'Exemple', parentId: 'lig', departments: ['99'] },
  { id: 'pol', levelId: 'niveau-pole', name: 'Pôle fictif', parentId: 'lig' },
  { id: 'clu', levelId: 'niveau-club', name: 'Club fictif', parentId: 'cd1' },
  { id: 'old', levelId: 'niveau-comite', name: 'Comité supprimé', deleted: true },
]
const CD_M: SelectionRef = { level: 'comite', unitId: 'cd1', sex: 'M' }
const CD_F: SelectionRef = { level: 'comite', unitId: 'cd1', sex: 'F' }
const LIG_M: SelectionRef = { level: 'ligue', unitId: 'lig', sex: 'M' }
const U17_M: SelectionRef = { level: 'france', category: 'U17', sex: 'M' }
const U19_F: SelectionRef = { level: 'france', category: 'U19', sex: 'F' }

type P = { id: string; sex?: 'M' | 'F'; birthDate?: string; selections?: SelectionPeriod[] }
const players: P[] = [
  // Au comité depuis 2024, à la ligue depuis septembre 2025, en U17 depuis octobre 2026.
  {
    id: 'a',
    sex: 'M',
    birthDate: '2010-04-02',
    selections: [
      { level: 'comite', unitId: 'cd1', from: '2023-09-01', to: '2024-06-30', exitReason: 'fin_saison' },
      { level: 'ligue', unitId: 'lig', from: '2025-09-01' },
      { level: 'france', category: 'U17', from: '2026-10-01' },
    ],
  },
  // Au comité la saison passée seulement.
  { id: 'b', sex: 'M', birthDate: '2011-02-10', selections: [{ level: 'comite', unitId: 'cd1', from: '2025-09-01', to: '2026-06-30', exitReason: 'categorie_superieure' }] },
  // Fille au comité aujourd'hui (période sans sexe : celui de la fiche).
  { id: 'c', sex: 'F', birthDate: '2011-07-01', selections: [{ level: 'comite', unitId: 'cd1', from: '2026-09-01' }] },
  // Fiche sans sexe : période avec le sexe du groupe.
  { id: 'd', selections: [{ level: 'france', category: 'U19', sex: 'F', from: '2026-01-10' }] },
  // Entrée à venir (pas encore membre).
  { id: 'e', sex: 'M', selections: [{ level: 'comite', unitId: 'cd1', from: '2027-01-15' }] },
  // Rien.
  { id: 'f', sex: 'M' },
]

t('noms des groupes : comité (sans le numéro), ligue (sans « de handball »), France, masculin / féminin', () => {
  assert.equal(comiteName('Comité du Var (83)'), 'Comité du Var')
  assert.equal(comiteName('Exemple'), 'Comité Exemple')
  assert.equal(comiteName('Comite des Landes'), 'Comité des Landes')
  assert.equal(ligueName('Ligue Auvergne-Rhône-Alpes de handball'), 'Ligue Auvergne-Rhône-Alpes')
  assert.equal(ligueName("Ligue d'Île-de-France de volley"), "Ligue d'Île-de-France")
  assert.equal(ligueName('Occitanie'), 'Ligue Occitanie')
  assert.equal(selectionGroupName(CD_M, 'Comité du Fictif (98)'), 'Comité du Fictif masculin')
  assert.equal(selectionGroupName(CD_F, 'Comité du Fictif (98)'), 'Comité du Fictif féminin')
  assert.equal(selectionGroupName(LIG_M, 'Ligue Fictive de handball'), 'Ligue Fictive masculin')
  assert.equal(selectionGroupName(U17_M), 'Équipe de France U17 masculin')
  assert.equal(selectionGroupName(U19_F), 'Équipe de France U19 féminin')
  assert.equal(selectionGroupId(CD_M), 'sel-comite-cd1-m')
  assert.equal(selectionGroupId(U19_F), 'sel-france-u19-f')
})

t('comité nommé d’après son département : article (« de l’Ain », « du Var », « des Bouches-du-Rhône ») ; même table que le 079', () => {
  assert.equal(comiteName('Ain', ['01']), 'Comité de l’Ain'.replace('’', "'"))
  assert.equal(comiteName('Var', ['83']), 'Comité du Var')
  assert.equal(comiteName('Bouches-du-Rhône', ['13']), 'Comité des Bouches-du-Rhône')
  assert.equal(comiteName('Corse', ['2A', '2B']), 'Comité Corse', 'plusieurs départements : le nom')
  assert.equal(comiteName('Wallis-et-Futuna', ['986']), 'Comité Wallis-et-Futuna', 'absent de la table : le nom')
  assert.equal(selectionGroupName({ level: 'comite', unitId: 'x', sex: 'F' }, { name: 'Hérault', departments: ['34'] }), "Comité de l'Hérault féminin")
  // supabase/079_selections.sql : même table (« ('01', 'de l''Ain') »).
  const sql = readFileSync(new URL('../supabase/079_selections.sql', import.meta.url), 'utf8')
  const block = /insert into t079_dept \(code, de\) values\n([\s\S]*?);\n/.exec(sql)![1]
  const pairs = [...block.matchAll(/\('([0-9AB]+)', '((?:[^']|'')*)'\)/g)].map((m) => [m[1], m[2].replace(/''/g, "'")])
  assert.deepEqual(pairs, [...DEPT_DE])
  assert.equal(DEPT_DE.size, 102)
})

t('niveau d’une unité : par l’identifiant ou le nom du niveau ; pôle, club, fédération : rien', () => {
  assert.equal(selectionLevelOfUnit(units[1], levels), 'ligue')
  assert.equal(selectionLevelOfUnit(units[2], levels), 'comite')
  assert.equal(selectionLevelOfUnit(units[3], levels), 'comite')
  for (const u of [units[0], units[4], units[5]]) assert.equal(selectionLevelOfUnit(u, levels), undefined)
})

t('groupes de la structure : chaque comité et ligue en masculin et féminin, les 6 groupes France ; manquants seulement', () => {
  const specs = selectionGroupSpecs(units, levels)
  assert.equal(specs.length, 3 * 2 + 6)
  assert.deepEqual(
    specs.filter((s) => s.ref.level === 'france').map((s) => s.name),
    ['Équipe de France U17 masculin', 'Équipe de France U17 féminin', 'Équipe de France U19 masculin', 'Équipe de France U19 féminin', 'Équipe de France U21 masculin', 'Équipe de France U21 féminin'],
  )
  assert.equal(specs.find((s) => s.id === 'sel-comite-cd1-m')?.department, '98')
  assert.equal(specs.find((s) => s.id === 'sel-ligue-lig-f')?.department, undefined)
  const have = [{ id: 'sel-comite-cd1-m', selection: CD_M }, { id: 'sel-france-u17-m', selection: U17_M, deleted: true }, { id: 'autre' }]
  const missing = missingSelectionGroups(specs, have)
  assert.equal(missing.length, specs.length - 1)
  assert.ok(missing.some((s) => s.id === 'sel-france-u17-m'), 'un groupe supprimé est recréé')
  assert.deepEqual(missingSelectionGroups(specs, specs.map((s) => ({ id: s.id, selection: s.ref }))), [])
})

t('période ↔ groupe : niveau, unité ou catégorie, sexe de la période sinon de la fiche', () => {
  assert.equal(selectionMatches({ level: 'comite', unitId: 'cd1' }, CD_M, 'M'), true)
  assert.equal(selectionMatches({ level: 'comite', unitId: 'cd1' }, CD_F, 'M'), false)
  assert.equal(selectionMatches({ level: 'comite', unitId: 'cd1', sex: 'F' }, CD_F, undefined), true)
  assert.equal(selectionMatches({ level: 'comite', unitId: 'cd2' }, CD_M, 'M'), false)
  assert.equal(selectionMatches({ level: 'ligue', unitId: 'cd1' }, CD_M, 'M'), false)
  assert.equal(selectionMatches({ level: 'france', category: 'U19' }, U17_M, 'M'), false)
  assert.equal(selectionMatches({ level: 'france', category: 'U17' }, U17_M, 'M'), true)
})

t('membres du jour (entrée à venir et période close exclues) et d’une saison passée', () => {
  assert.deepEqual(selectionMembersAt(players, CD_M, TODAY).map((p) => p.id), [])
  assert.deepEqual(selectionMembersAt(players, CD_F, TODAY).map((p) => p.id), ['c'])
  assert.deepEqual(selectionMembersAt(players, LIG_M, TODAY).map((p) => p.id), ['a'])
  assert.deepEqual(selectionMembersAt(players, U17_M, TODAY).map((p) => p.id), ['a'])
  assert.deepEqual(selectionMembersAt(players, U19_F, TODAY).map((p) => p.id), ['d'])
  assert.deepEqual(selectionMembersIn(players, CD_M, '2025-09-01', '2026-08-31').map((p) => p.id), ['b'])
  assert.deepEqual(membersOfView(players, CD_M, '2023-2024', TODAY).map((p) => p.id), ['a'])
  assert.deepEqual(membersOfView(players, LIG_M, 'courante', TODAY).map((p) => p.id), ['a'])
  assert.equal(isSelectedAt(players[4], CD_M, '2027-02-01'), true)
})

t('saisons passées proposées (la plus récente d’abord, sans la saison en cours) ; vue dans l’adresse', () => {
  assert.deepEqual(pastSeasons(players, CD_M, TODAY), ['2025-2026', '2023-2024'])
  assert.deepEqual(pastSeasons(players, LIG_M, TODAY), ['2025-2026'])
  assert.deepEqual(pastSeasons(players, U17_M, TODAY), [])
  assert.equal(selectionViewOf('?saison=2024-2025'), '2024-2025')
  assert.equal(selectionViewOf('?saison=2024-2026'), 'courante')
  assert.equal(selectionViewOf('?saison=prochaine'), 'courante')
  assert.equal(selectionViewOf(''), 'courante')
  assert.equal(withSelectionView('?a=1', '2024-2025'), '?a=1&saison=2024-2025')
  assert.equal(withSelectionView('?saison=2024-2025', 'courante'), '')
})

t('ajout : période ouverte aujourd’hui (unité, sexe du groupe) ; déjà membre : rien ; retrait : sortie + motif ; rien ne s’efface', () => {
  const f = players[5]
  const opened = openSelection(f, CD_M, TODAY, 'Comité du Fictif (98)')!
  assert.deepEqual(opened, [{ level: 'comite', unitId: 'cd1', unitName: 'Comité du Fictif (98)', sex: 'M', from: TODAY }])
  assert.equal(openSelection({ ...f, selections: opened }, CD_M, TODAY), null)
  const fr = openSelection(f, U17_M, TODAY)!
  assert.deepEqual(fr, [{ level: 'france', category: 'U17', sex: 'M', from: TODAY }])
  const closed = closeSelection({ ...f, selections: opened }, CD_M, TODAY, 'blessure')!
  assert.deepEqual(closed, [{ ...opened[0], to: TODAY, exitReason: 'blessure' }])
  assert.equal(closeSelection(f, CD_M, TODAY, 'autre'), null)
  // Réouverture plus tard : une deuxième période, la première reste.
  const again = openSelection({ ...f, selections: closed }, CD_M, '2027-01-10')!
  assert.equal(again.length, 2)
  // Entrée à venir : annulable ; une période commencée ne s'annule pas.
  assert.deepEqual(cancelUpcoming(players[4], CD_M, TODAY), [])
  assert.equal(cancelUpcoming({ ...f, selections: opened }, CD_M, TODAY), null)
  assert.deepEqual(
    SELECTION_EXITS.map((x) => x.value),
    ['fin_saison', 'categorie_superieure', 'blessure', 'autre'],
  )
  assert.ok(SELECTION_EXITS.every((x) => !/retenu|refus|exclu|echec|échec/i.test(x.label)), 'motifs neutres seulement')
})

t('fin de sélection depuis le groupe : fermée la veille (sort tout de suite de « En ce moment ») ; ajoutée le jour même : retirée', () => {
  assert.equal(dayBefore('2026-03-01'), '2026-02-28')
  const a = endSelection(players[0], LIG_M, TODAY, 'autre')!
  assert.equal(a.removed, false)
  assert.deepEqual(a.selections[1], { level: 'ligue', unitId: 'lig', from: '2025-09-01', to: '2026-11-22', exitReason: 'autre' })
  assert.equal(isSelectedAt({ ...players[0], selections: a.selections }, LIG_M, TODAY), false)
  const today = { id: 'z', sex: 'M' as const, selections: [{ level: 'comite' as const, unitId: 'cd1', from: TODAY }] }
  assert.deepEqual(endSelection(today, CD_M, TODAY, 'autre'), { selections: [], removed: true })
  assert.equal(endSelection(players[5], CD_M, TODAY, 'autre'), null)
})

t('groupes matérialisés : membres du jour dans playerIds (copie), et niveaux de l’anneau (France, Ligue, Comité)', () => {
  const groups = [
    { id: 'sel-france-u17-m', name: 'U17', playerIds: [] as string[], selection: U17_M, scope: 'federation' },
    { id: 'sel-ligue-lig-m', name: 'Ligue', playerIds: [] as string[], selection: LIG_M, scope: 'ligue' },
    { id: 'sel-comite-cd1-f', name: 'CD F', playerIds: [] as string[], selection: CD_F, scope: 'comite' },
    { id: 'g', name: 'Ordinaire', playerIds: ['f'], scope: 'comite' },
  ]
  const m = materializeSelectionGroups(groups, players, TODAY)
  assert.deepEqual(groups[0].playerIds, [], 'l’original ne change pas')
  assert.deepEqual(m.map((g) => g.playerIds), [['a'], ['a'], ['c'], ['f']])
  const map = scopeLevelMap(m)
  assert.deepEqual(allPlayerLevels(map.get('a'), false), ['france', 'ligue'])
  assert.deepEqual(allPlayerLevels(map.get('c'), true), ['pole', 'comite'])
  assert.deepEqual(allPlayerLevels(map.get('b'), false), [], 'sélection passée : plus de niveau')
})

t('garde-fou : sortie avant l’entrée refusée ; chevauchement dans le même groupe, date lointaine, unité manquante : avertissements', () => {
  assert.deepEqual(selectionIssues(players[0].selections, { today: TODAY, sex: 'M' }), [])
  const xs: SelectionPeriod[] = [
    { level: 'comite', unitId: 'cd1', from: '2025-09-01', to: '2025-06-30' },
    { level: 'ligue', unitId: 'lig', from: '2024-09-01' },
    { level: 'ligue', unitId: 'lig', from: '2025-09-01', to: '2026-06-30' },
    { level: 'france', from: '2028-09-01' },
    // Même dates, autre groupe : pas de chevauchement signalé.
    { level: 'comite', unitId: 'cd2', from: '2024-09-01' },
  ]
  const is = selectionIssues(xs, { today: TODAY, sex: 'M' })
  assert.deepEqual(
    is.map((x) => `${x.index}:${x.kind}:${x.level}`),
    ['0:sortie_avant_entree:error', '2:chevauchement:warning', '3:futur:warning', '3:incomplet:warning'],
  )
  assert.match(selectionBlockMessage(is)!, /sortie avant son entrée/)
  assert.equal(selectionBlockMessage(is.filter((x) => x.level === 'warning')), null)
  // Sexes différents (fiche sans sexe) : deux groupes différents.
  assert.deepEqual(selectionIssues([{ level: 'france', category: 'U17', sex: 'M', from: '2025-01-01' }, { level: 'france', category: 'U17', sex: 'F', from: '2025-01-01' }], { today: TODAY }), [])
})

t('résumé de fiche et catégorie France proposée d’après l’âge de saison', () => {
  assert.equal(
    selectionSummary(players[0], (id) => units.find((u) => u.id === id)?.name),
    'Équipe de France U17, depuis le 01/10/2026 ; Ligue Fictive, depuis le 01/09/2025 ; Comité du Fictif, du 01/09/2023 au 30/06/2024 (fin de saison)',
  )
  assert.equal(suggestCategory('2010-04-02', TODAY), 'U17')
  assert.equal(suggestCategory('2008-04-02', TODAY), 'U19')
  assert.equal(suggestCategory('2006-04-02', TODAY), 'U21')
  assert.equal(suggestCategory(undefined, TODAY), undefined)
  assert.equal(majorityCategory([{ birthDate: '2010-01-01' }, { birthDate: '2010-05-01' }, { birthDate: '2008-01-01' }, {}], TODAY), 'U17')
})

t('conversion d’un ancien groupe : cible d’après la portée, périodes à la date choisie, déjà sélectionnés laissés', () => {
  const opts = { units, levels, ligueOfRegion: (r: string) => (r === 'region-fictive' ? 'lig' : undefined), category: 'U17' as const }
  assert.deepEqual(conversionTarget({ scope: 'federation', sex: 'M' }, opts), U17_M)
  assert.equal(conversionTarget({ scope: 'federation', sex: 'mixte' }, opts), null, 'mixte : à choisir')
  assert.deepEqual(conversionTarget({ scope: 'comite', sex: 'F', department: '98' }, opts), CD_F)
  assert.deepEqual(conversionTarget({ scope: 'comite', sex: 'M', department: '99' }, opts), { level: 'comite', unitId: 'cd2', sex: 'M' })
  assert.equal(conversionTarget({ scope: 'comite', sex: 'M', department: '01' }, opts), null)
  assert.deepEqual(conversionTarget({ scope: 'ligue', sex: 'M', regionId: 'region-fictive' }, opts), LIG_M)
  assert.equal(conversionTarget({ sex: 'M' }, opts), null)
  const w = conversionWrites(players, U17_M, '2026-11-01')
  // Chaque membre donné reçoit sa période, sauf celui déjà en U17 à cette date ; les autres périodes restent.
  assert.deepEqual(w.map((x) => x.id).sort(), ['b', 'c', 'd', 'e', 'f'])
  assert.deepEqual(w.find((x) => x.id === 'b')!.selections.slice(-1), [{ level: 'france', category: 'U17', sex: 'M', from: '2026-11-01' }])
  assert.equal(w.find((x) => x.id === 'b')!.selections.length, 2)
})

t('filtres : passés par (période commencée), en ce moment, niveau, catégorie, période ; libellés accordés et neutres', () => {
  const ids = (w: Parameters<typeof selectionWantedMatches>[1]) => players.filter((p) => selectionWantedMatches(p, w, TODAY)).map((p) => p.id)
  assert.deepEqual(ids({}), ['a', 'b', 'c', 'd'], 'entrée à venir : pas encore « passé par »')
  assert.deepEqual(ids({ current: true }), ['a', 'c', 'd'])
  assert.deepEqual(ids({ level: 'comite' }), ['a', 'b', 'c'])
  assert.deepEqual(ids({ level: 'comite', current: true }), ['c'])
  assert.deepEqual(ids({ level: 'france', category: 'U17' }), ['a'])
  assert.deepEqual(ids({ category: 'U19' }), ['d'])
  assert.deepEqual(ids({ level: 'comite', from: '2024-01-01', to: '2024-12-31' }), ['a'])
  assert.deepEqual(ids({ level: 'comite', from: '2025-09-01', to: '2026-08-31' }), ['b'])
  assert.equal(selectionWantedText({ level: 'france', category: 'U17' }), 'passés par l’équipe de France U17')
  assert.equal(selectionWantedText({ level: 'ligue' }, 'F'), 'passées par la sélection de ligue')
  assert.equal(selectionWantedText({ current: true }, 'F'), 'sélectionnées en ce moment')
  assert.equal(selectionWantedText({ current: true, level: 'comite' }), 'sélectionnés en ce moment (comité)')
  assert.equal(selectionWantedText({ level: 'france', category: 'U17', from: '2025-01-01', to: '2025-12-31' }), 'passés par l’équipe de France U17 (2025)')
  assert.equal(stageWantedText({ level: 'france' }), 'passés par un stage national')
  assert.equal(stageWantedText({ level: 'ligue', from: '2024-09-01', to: '2025-08-31' }, 'F'), 'passées par un stage de ligue (saison 2024-2025)')
  assert.equal(periodText('2024-02-01', '2024-03-01'), 'du 01/02/2024 au 01/03/2024')
})

t('lecture de la réponse du modèle et des recettes enregistrées : niveau, catégorie, en ce moment, période ; le reste écarté', () => {
  assert.deepEqual(readSelectionWanted({ niveau: 'france', categorie: 'u17' }, TODAY), { level: 'france', category: 'U17' })
  assert.deepEqual(readSelectionWanted({ categorie: 'U19', periode: '2025' }, TODAY), { level: 'france', category: 'U19', from: '2025-01-01', to: '2025-12-31' })
  assert.deepEqual(readSelectionWanted({ en_ce_moment: true }, TODAY), { current: true })
  assert.deepEqual(readSelectionWanted({ en_ce_moment: true, periode: 'saison 2024-2025' }, TODAY), { from: '2024-09-01', to: '2025-08-31' }, 'une période l’emporte sur « en ce moment »')
  assert.deepEqual(readSelectionWanted('ligue', TODAY), { level: 'ligue' })
  assert.deepEqual(readSelectionWanted(true, TODAY), {})
  const notes: string[] = []
  assert.deepEqual(readSelectionWanted({ niveau: 'mondial', periode: 'hier' }, TODAY, notes), {})
  assert.equal(notes.length, 2)
  assert.deepEqual(readStageWanted({ niveau: 'national', periode: 'saison_derniere' }, TODAY), { level: 'france', from: '2025-09-01', to: '2026-08-31' })
  assert.deepEqual(readStageWanted('comite', TODAY), { level: 'comite' })
  assert.deepEqual(parsePeriodWanted('cette saison', TODAY), { from: '2026-09-01', to: '2027-08-31' })
  assert.deepEqual(parsePeriodWanted({ du: '2025-03-01', au: '2025-01-01' }, TODAY), { from: '2025-01-01', to: '2025-03-01' })
  assert.equal(parsePeriodWanted('demain', TODAY), undefined)
  assert.deepEqual(cleanSelectionWanted({ level: 'france', category: 'U21', current: true, from: '2025-01-01', to: 'x', autre: 1 }), { level: 'france', category: 'U21', current: true, from: '2025-01-01' })
  assert.deepEqual(cleanSelectionWanted({ level: 'monde', category: 'U15' }), {})
  assert.equal(cleanSelectionWanted('france'), undefined)
  assert.deepEqual(cleanStageWanted({ level: 'ligue', to: '2025-12-31' }), { level: 'ligue', to: '2025-12-31' })
})

t('phrase lue sur l’appareil : sélections, en ce moment, stages, période ; le Pôle n’est pas une sélection', () => {
  const said = (s: string) => selectionPhraseIn(normalize(s), TODAY)
  assert.deepEqual(said('tous les joueurs passés par l’équipe de France'), { selection: { level: 'france' } })
  assert.deepEqual(said('les joueuses passées par l’équipe de France U17'), { selection: { level: 'france', category: 'U17' } })
  assert.deepEqual(said('les joueurs sélectionnés France U19 en 2025'), { selection: { level: 'france', category: 'U19', from: '2025-01-01', to: '2025-12-31' } })
  assert.deepEqual(said('passés par la ligue'), { selection: { level: 'ligue' } })
  assert.deepEqual(said('les garçons passés par le comité'), { selection: { level: 'comite' } })
  assert.deepEqual(said('les joueurs sélectionnés en ce moment'), { selection: { current: true } })
  assert.deepEqual(said('passés par un stage national'), { stage: { level: 'france' } })
  assert.deepEqual(said('passées par un stage de ligue pendant la saison 2024 2025'), { stage: { level: 'ligue', from: '2024-09-01', to: '2025-08-31' } })
  assert.deepEqual(said('qui ont fait un stage'), { stage: {} })
  assert.deepEqual(said('les joueurs passés par le Pôle Espoirs'), {})
  assert.deepEqual(said('les gauchers du Var nés en 2011'), {})
})

// ---------- Recette (liste Joueurs, Demander) ----------
type QP = QPlayer & { department?: string }
const qplayers: QP[] = players.map((p, i) => ({ id: p.id, firstName: `Prénom${i}`, lastName: `Nom${i}`, sex: p.sex, birthDate: p.birthDate ?? '2011-01-01', selections: p.selections, department: '98' }))
const events = [
  { id: 'st-n', type: 'stage_national', date: '2026-02-10', playerIds: ['a'] },
  { id: 'st-l', type: 'stage_ligue', date: '2025-04-12', playerIds: ['b'] },
  { id: 'st-c', type: 'stage_comite', date: '2027-03-01', playerIds: ['c'] },
  { id: 'tr', type: 'tournoi', date: '2025-05-01', playerIds: ['f'] },
]
const data: QData<QP> = {
  players: qplayers,
  sights: [{ playerId: 'f', day: '2026-02-10', event: 'st-n', person: 'o1' }],
  evals: [],
  measures: [],
  criteria: [],
  groups: [],
  events,
  deptOf: (p) => p.department,
  regionOf: () => 'region-fictive',
  today: TODAY,
}
const ix = buildIndex(data)
const listOf = (pop: Recipe['pop']) => runRecipe(ix, cleanRecipe({ pop, avis: [], measures: [], out: { type: 'list' } })).match.map((p) => p.id).sort()

t('recette : sélection et stage (liste ou vu, passé, niveau, période) ; distincts', () => {
  assert.deepEqual(listOf({ selection: { level: 'france' } }), ['a', 'd'])
  assert.deepEqual(listOf({ selection: { current: true }, sex: 'M' }), ['a'])
  assert.deepEqual(listOf({ stage: {} }), ['a', 'b', 'f'], 'stage à venir exclu ; vu au stage compté')
  assert.deepEqual(listOf({ stage: { level: 'france' } }), ['a', 'f'])
  assert.deepEqual(listOf({ stage: { level: 'ligue', from: '2024-09-01', to: '2025-08-31' } }), ['b'])
  assert.deepEqual(listOf({ stage: { level: 'france' }, selection: { level: 'france' } }), ['a'])
  assert.equal(stageMatches({ type: 'entrainement', date: '2025-01-01' }, {}, TODAY), false)
  assert.equal(stageMatches({ type: 'stage_comite', date: '2025-01-01', deleted: true }, {}, TODAY), false)
})

t('recette relue (modèle), nettoyée (adresse), pastilles, clés de la liste, besoin des données complètes', () => {
  const ctx: QuestionContext = { regions: [], depts: [], regionOfDept: () => undefined, positions: [], clubs: [], groups: [], events: [], criteria: [], today: TODAY }
  const it = interpretRecipe({ population: { selection: { niveau: 'france', categorie: 'U17', periode: '2025' }, stage: { niveau: 'ligue' } } }, [], ctx)
  assert.deepEqual(it.recipe.pop.selection, { level: 'france', category: 'U17', from: '2025-01-01', to: '2025-12-31' })
  assert.deepEqual(it.recipe.pop.stage, { level: 'ligue' })
  assert.deepEqual(it.notes, [])
  const clean = cleanRecipe(JSON.parse(JSON.stringify(it.recipe)))
  assert.deepEqual(clean.pop.selection, it.recipe.pop.selection)
  assert.deepEqual(clean.pop.stage, it.recipe.pop.stage)
  const names = { position: (x: string) => x, region: (x: string) => x, dept: (x: string) => x, club: (x: string) => x, group: (x: string) => x, event: (x: string) => x, criterion: (x: string) => x }
  const chips = recipeChips(clean, names as never).map((c) => `${c.key}:${c.label}`)
  assert.ok(chips.includes('selection:passés par l’équipe de France U17 (2025)'))
  assert.ok(chips.includes('stage:passés par un stage de ligue'))
  const qy = mergeQuery(EMPTY_QUERY, clean, 'ajouter')
  assert.deepEqual(activeKeys(qy).filter((k) => k === 'selection' || k === 'stage'), ['selection', 'stage'])
  assert.equal(needsFullData(qy), true, 'stage : événements et vus')
  assert.equal(needsFullData(mergeQuery(EMPTY_QUERY, cleanRecipe({ pop: { selection: {} } }), 'ajouter')), false, 'sélection : la fiche suffit')
  // Le modèle n'a rien rendu : la phrase suffit (sur l'appareil).
  const rescued = rescueInterpretation(interpretRecipe({}, [], ctx), 'les joueuses passées par l’équipe de France U19', ctx, { scope: 'liste' })
  assert.deepEqual(rescued.recipe.pop.selection, { level: 'france', category: 'U19' })
})

console.log(`\n${n} tests OK`)
