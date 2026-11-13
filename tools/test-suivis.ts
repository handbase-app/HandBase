// Vues de « Mes suivis » (src/followViews.ts) : vue lue dans l'adresse, origine de chaque suivi (direct, un groupe,
// plusieurs groupes, « aussi via » dans une section), sections Par groupe (un joueur de deux groupes dans les deux,
// « Suivis directement » pour les ★ hors groupe, joueurs inconnus écartés), Par année (récente d'abord, inconnue à la
// fin), filtre d'une section, répartition des nouveautés, pastilles. Jeu entièrement fictif.
//
//   npx jiti tools/test-suivis.ts
import assert from 'node:assert/strict'
import {
  DIRECT_KEY,
  followOrigins,
  groupSections,
  originText,
  parseFollowView,
  pickSection,
  sectionChip,
  sectionPlayers,
  splitBySection,
  UNKNOWN_YEAR_KEY,
  yearSections,
  type FollowGroupLite,
} from '../src/followViews'

// ---------- Vue dans l'adresse ----------
assert.equal(parseFollowView(null), 'tout')
assert.equal(parseFollowView(''), 'tout')
assert.equal(parseFollowView('groupe'), 'groupe')
assert.equal(parseFollowView('annee'), 'annee')
assert.equal(parseFollowView('n-importe'), 'tout')

// ---------- Jeu fictif ----------
// Groupes dans l'ordre de computeFollows (alphabétique). p2 est dans deux groupes ; p5 suivi directement ET par un groupe ;
// p6 suivi seulement directement ; p9 n'existe plus (fusionné / supprimé).
const groups: FollowGroupLite[] = [
  { id: 'gA', name: 'Ligue U16', playerIds: ['p1', 'p2', 'p9'] },
  { id: 'gB', name: 'Pôle Sud', playerIds: ['p2', 'p3', 'p5', 'p3'] },
  { id: 'gC', name: 'Stage vide', playerIds: [] },
  { id: 'gD', name: 'U17 Équipe Test', playerIds: ['p4'], team: true },
]
const direct = new Set(['p5', 'p6'])

// ---------- Origines ----------
const o = followOrigins(direct, groups)
assert.deepEqual(o.get('p1'), { direct: false, groups: [{ id: 'gA', name: 'Ligue U16' }] })
assert.deepEqual(
  o.get('p2')?.groups.map((g) => g.id),
  ['gA', 'gB'],
)
assert.equal(o.get('p3')?.groups.length, 1, 'doublon dans un groupe compté une fois')
assert.deepEqual(o.get('p5'), { direct: true, groups: [{ id: 'gB', name: 'Pôle Sud' }] })
assert.deepEqual(o.get('p6'), { direct: true, groups: [] })
assert.equal(o.get('inconnu'), undefined)

assert.equal(originText(o.get('p1'))?.text, 'via Ligue U16')
assert.equal(originText(o.get('p2'))?.text, 'via 2 groupes')
assert.equal(originText(o.get('p2'))?.detail, 'Groupe « Ligue U16 »\nGroupe « Pôle Sud »')
assert.equal(originText(o.get('p6'))?.text, 'suivi direct')
assert.equal(originText(o.get('p5'))?.text, 'suivi direct · via Pôle Sud')
assert.equal(originText(o.get('p5'))?.detail, 'Suivi directement (★)\nGroupe « Pôle Sud »')
assert.equal(originText(undefined), null)
// Dans la section d'un groupe : ce groupe n'est pas répété.
assert.equal(originText(o.get('p1'), 'gA'), null)
assert.equal(originText(o.get('p2'), 'gA')?.text, 'aussi via Pôle Sud')
assert.equal(originText(o.get('p5'), 'gB')?.text, 'suivi direct')
assert.equal(originText(o.get('p6'), DIRECT_KEY), null)

// ---------- Par groupe ----------
const known = (id: string) => id !== 'p9'
const gs = groupSections(direct, groups, known)
assert.deepEqual(
  gs.map((s) => [s.key, s.label, s.playerIds.join()]),
  [
    ['gA', 'Ligue U16', 'p1,p2'],
    ['gB', 'Pôle Sud', 'p2,p3,p5'],
    ['gD', 'U17 Équipe Test', 'p4'],
    [DIRECT_KEY, 'Suivis directement', 'p6'],
  ],
  'groupe vide écarté, p9 inconnu écarté, p5 (déjà dans un groupe) pas dans « Suivis directement »',
)
assert.equal(gs[2].team, true)
assert.equal(gs[0].groupId, 'gA')
assert.equal(gs[3].groupId, undefined)
// Joueurs distincts : p2 une seule fois.
assert.deepEqual([...sectionPlayers(gs)].sort(), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
// Sans groupe suivi : seulement « Suivis directement ».
assert.deepEqual(
  groupSections(['a', 'b'], []).map((s) => s.key),
  [DIRECT_KEY],
)
assert.deepEqual(groupSections([], []), [])

// ---------- Par année ----------
const ys = yearSections([
  { id: 'p1', birthDate: '2010-04-02' },
  { id: 'p2', birthDate: '2009-11-30' },
  { id: 'p3' },
  { id: 'p4', birthDate: '2011-01-15' },
  { id: 'p5', birthDate: '2010-12-31' },
  { id: 'p5', birthDate: '2010-12-31' },
  { id: 'p6', birthDate: 'abc' },
])
assert.deepEqual(
  ys.map((s) => [s.key, s.label, s.playerIds.join()]),
  [
    ['2011', '2011', 'p4'],
    ['2010', '2010', 'p1,p5'],
    ['2009', '2009', 'p2'],
    [UNKNOWN_YEAR_KEY, 'Année inconnue', 'p3,p6'],
  ],
)
assert.deepEqual(yearSections([]), [])

// ---------- Filtre ----------
assert.equal(pickSection(gs, 'gB')?.label, 'Pôle Sud')
assert.equal(pickSection(gs, null), null)
assert.equal(pickSection(gs, 'gC'), null, 'groupe vide (ou plus suivi) : pas de filtre')
assert.equal(pickSection(ys, '2010')?.playerIds.length, 2)
assert.equal(pickSection(ys, UNKNOWN_YEAR_KEY)?.label, 'Année inconnue')

// ---------- Nouveautés par section ----------
const news = [
  { key: 'n1', playerId: 'p2' },
  { key: 'n2', playerId: 'p6' },
  { key: 'n3', playerId: 'p1' },
]
const split = splitBySection(news, gs)
assert.deepEqual(
  split.map((x) => [x.section.key, x.items.map((n) => n.key).join()]),
  [
    ['gA', 'n1,n3'],
    ['gB', 'n1'],
    ['gD', ''],
    [DIRECT_KEY, 'n2'],
  ],
  'p2 (deux groupes) dans les deux sections',
)
// Filtrées : seulement la section choisie.
assert.deepEqual(
  splitBySection(news, [pickSection(gs, 'gB')!]).map((x) => x.items.length),
  [1],
)

// ---------- Pastilles ----------
assert.equal(sectionChip(gs[0]), 'Ligue U16 (2)')
assert.equal(sectionChip(ys[1]), '2010 (2)')

console.log('test-suivis : OK')
