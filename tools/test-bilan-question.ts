// Question posée au bilan de détection, réponse géographique (src/bilanQuestion.ts) : quelles recettes vont au bilan,
// lieu de départ (club, département, région, France), recette sans ce lieu, valeur montrée, totaux par région,
// département et club, classement. Données entièrement fictives.
//
//   npx jiti tools/test-bilan-question.ts
import assert from 'node:assert/strict'
import { aggregate, aggValue, goesToBilan, isTopClubs, limitClubs, questionPoints, rankAgg, recipeAt, splitPlace, topClubsPlace, valueKind, bilanOutput } from '../src/bilanQuestion'
import { buildIndex, cleanRecipe, runRecipe, type QPlayer, type Recipe } from '../src/recipe'

const TODAY = '2026-10-14'
const REGIONS: Record<string, string> = { '83': 'region-sud', '06': 'region-sud', '13': 'region-sud', '75': 'region-idf' }
const regionOf = (d: string) => REGIONS[d]
const CLUB_DEPT: Record<string, string> = { 'hbc exemple': '83', 'as fictive': '83', 'club imaginaire': '06', 'entente fictive': '75' }
const clubDept = (k: string) => CLUB_DEPT[k]
const R = (x: Partial<Recipe> & { out: Recipe['out'] }): Recipe => cleanRecipe({ pop: {}, avis: [], measures: [], ...x })

// ---------- Quelles questions vont au bilan ----------
assert.equal(goesToBilan(R({ out: { type: 'table', groupBy: 'club', sort: { by: 'count', dir: 'desc' } } })), true, 'tableau par club')
assert.equal(goesToBilan(R({ out: { type: 'table' } })), true, 'tableau sans regroupement : par club')
assert.equal(goesToBilan(R({ out: { type: 'table', groupBy: 'dept' } })), true, 'tableau par département')
assert.equal(goesToBilan(R({ out: { type: 'table', groupBy: 'region' } })), true, 'tableau par région')
assert.equal(goesToBilan(R({ out: { type: 'map' } })), true, 'carte')
assert.equal(goesToBilan(R({ pop: { depts: ['83'] }, out: { type: 'count' } })), true, 'nombre dans un lieu')
assert.equal(goesToBilan(R({ out: { type: 'count' } })), false, 'nombre sans lieu : réponse simple')
assert.equal(goesToBilan(R({ pop: { depts: ['83'] }, out: { type: 'list' } })), false, 'liste de joueurs')
for (const g of ['year', 'position', 'sex', 'staff', 'event'] as const) assert.equal(goesToBilan(R({ out: { type: 'table', groupBy: g } })), false, `tableau par ${g}`)
assert.equal(bilanOutput({ type: 'count' }), true, 'nombre gardé au bilan quand on change la question')
assert.equal(bilanOutput({ type: 'list' }), false)

// ---------- Lieu de départ ----------
const F = { region: '', dept: '', club: null }
const sp = (pop: Recipe['pop']) => splitPlace(R({ pop, out: { type: 'table', groupBy: 'club' } }), regionOf, clubDept)
let s = sp({ depts: ['83'], sex: 'F' })
assert.deepEqual(s.place, { region: 'region-sud', dept: '83', club: null }, 'un département')
assert.deepEqual(s.recipe.pop, { sex: 'F' }, 'le lieu passe au bilan, le reste de la population reste')
s = sp({ regions: ['region-sud'] })
assert.deepEqual(s.place, { region: 'region-sud', dept: '', club: null }, 'une région')
assert.deepEqual(s.recipe.pop, {})
s = sp({ depts: ['83', '06'] })
assert.deepEqual(s.place, { region: 'region-sud', dept: '', club: null }, 'deux départements d’une région : la région')
assert.deepEqual(s.recipe.pop, { depts: ['83', '06'] }, 'seuls ces départements restent comptés')
s = sp({ depts: ['83', '75'] })
assert.deepEqual(s.place, F, 'départements de deux régions : la France')
assert.deepEqual(s.recipe.pop, { depts: ['83', '75'] })
s = sp({ clubs: ['hbc exemple'] })
assert.deepEqual(s.place, { region: 'region-sud', dept: '83', club: 'hbc exemple' }, 'un club : son département, club choisi')
assert.deepEqual(s.recipe.pop, {})
s = sp({ clubs: ['hbc exemple', 'as fictive'] })
assert.deepEqual(s.place, { region: 'region-sud', dept: '83', club: null }, 'deux clubs d’un département')
assert.deepEqual(s.recipe.pop, { clubs: ['hbc exemple', 'as fictive'] })
s = sp({ clubs: ['club inconnu'] })
assert.deepEqual(s.place, F, 'club au département inconnu : la France')
assert.deepEqual(s.recipe.pop, { clubs: ['club inconnu'] })
assert.deepEqual(sp({}).place, F, 'sans lieu : la France')
assert.deepEqual(sp({ depts: ['83'], regions: ['region-idf'] }).place.dept === '83', false, 'département hors de la région demandée : pas choisi')
// Retour à la recette complète (« Ouvrir en détail », « Enregistrer »).
assert.deepEqual(recipeAt(R({ out: { type: 'map' } }), { region: 'region-sud', dept: '83', club: null }).pop, { depts: ['83'] })
assert.deepEqual(recipeAt(R({ out: { type: 'map' } }), { region: 'region-sud', dept: '', club: null }).pop, { regions: ['region-sud'] })
assert.deepEqual(recipeAt(R({ out: { type: 'map' } }), { region: 'region-sud', dept: '83', club: 'as fictive' }).pop, { clubs: ['as fictive'], depts: ['83'] })
assert.deepEqual(recipeAt(R({ out: { type: 'map' } }), F).pop, {})

// ---------- Valeur montrée ----------
assert.equal(valueKind(R({ out: { type: 'table', groupBy: 'club' } })), 'count')
assert.equal(valueKind(R({ nbAvis: { op: 'gte', n: 1 }, out: { type: 'table', sort: { by: 'share', dir: 'desc' } } })), 'share', 'part qui répond')
assert.equal(valueKind(R({ out: { type: 'table', sort: { by: 'share', dir: 'desc' } } })), 'seen', 'part sans condition : part vue (cleanRecipe)')
assert.equal(valueKind(R({ out: { type: 'table', value: 'seen' } })), 'seen')
assert.equal(valueKind(R({ out: { type: 'table', value: 'measure', measure: 'taille' } })), 'measure')
assert.equal(valueKind(R({ out: { type: 'table', value: 'age' } })), 'age')
assert.equal(valueKind(R({ out: { type: 'map' } })), 'count', 'carte sans condition : nombre')
assert.equal(valueKind(R({ out: { type: 'map' }, seen: { by: 'event', op: 'eq', n: 0, period: { kind: 'season' } } })), 'share', 'carte avec condition : part')

// ---------- Totaux sur un jeu fictif ----------
type P = QPlayer & { department?: string }
const pl = (id: string, birthDate: string, sex: 'M' | 'F', club: string, department: string): P => ({ id, firstName: `Prénom${id}`, lastName: `NOM${id}`, birthDate, sex, club, department })
const players: P[] = [
  pl('a', '2011-03-02', 'F', 'HBC Exemple', '83'),
  pl('b', '2011-07-15', 'F', 'HBC Exemple', '83'),
  pl('c', '2010-01-20', 'M', 'HBC Exemple', '83'),
  pl('d', '2011-11-01', 'F', 'AS Fictive', '83'),
  pl('e', '2011-05-05', 'F', 'Club Imaginaire', '06'),
  pl('f', '2010-02-02', 'M', 'Entente Fictive', '75'),
  pl('g', '2011-09-09', 'F', '', ''),
]
const ix = buildIndex<P>({
  players,
  sights: [
    { playerId: 'a', day: '2026-09-20', event: 'ev1', person: 'u1' },
    { playerId: 'e', day: '2026-09-21', event: 'ev2', person: 'u1' },
  ],
  evals: [],
  measures: [
    { playerId: 'a', criterionId: 'taille', value: 170, date: '2026-09-01' },
    { playerId: 'b', criterionId: 'taille', value: 160, date: '2026-09-01' },
    { playerId: 'd', criterionId: 'taille', value: 175, date: '2026-09-01' },
  ],
  criteria: [{ id: 'taille', label: 'Taille', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'cm' }],
  groups: [],
  events: [],
  deptOf: (p) => p.department || undefined,
  regionOf,
  today: TODAY,
})
const run = (r: Recipe, at = { region: '', dept: '' }) => {
  const ans = runRecipe(ix, r)
  return aggregate(questionPoints(ix, r, ans), at, (k) => ix.clubNames.get(k) ?? k)
}

// « Dans quel club du Var il y a le plus de joueuses 2011 » : population sans le lieu (le bilan le porte).
const q1 = R({ pop: { sex: 'F', years: [2011, 2011] }, out: { type: 'table', groupBy: 'club', sort: { by: 'count', dir: 'desc' } } })
let a = run(q1, { region: 'region-sud', dept: '83' })
assert.equal(a.all.total, 5, 'population : les joueuses 2011 de toute la France')
assert.equal(a.byDept.get('83')!.seen, 3)
assert.equal(a.byDept.get('06')!.seen, 1)
assert.equal(a.byRegion.get('region-sud')!.seen, 4)
assert.equal(a.noDept.total, 1, 'sans département : à part')
assert.equal(a.here.seen, 3, 'totaux du lieu affiché (Var)')
assert.deepEqual(a.clubs.map((c) => [c.key, c.seen]).sort(), [['as fictive', 1], ['hbc exemple', 2]], 'clubs du Var seulement')
assert.equal(a.clubs.find((c) => c.key === 'hbc exemple')!.name, 'HBC Exemple', 'nom affiché du club')
assert.equal(a.depts, 1)
const ranked = rankAgg('count', a.clubs.map((c) => [c.key, c] as [string, typeof c]))
assert.deepEqual(ranked.map(([k]) => k), ['hbc exemple', 'as fictive'], 'le club qui en a le plus d’abord')
assert.deepEqual(rankAgg('count', a.clubs.map((c) => [c.key, c] as [string, typeof c]), 'asc').map(([k]) => k), ['as fictive', 'hbc exemple'], 'le moins d’abord si demandé')
assert.equal(aggValue('count', a.byDept.get('83')), 3)

// Part qui répond (condition « pas encore vus »), avec les joueurs non concernés dans le total.
const q2 = R({ seen: { by: 'event', op: 'eq', n: 0, period: { kind: 'season' } }, out: { type: 'map' } })
a = run(q2)
assert.equal(valueKind(q2), 'share')
const v83 = a.byDept.get('83')!
assert.deepEqual([v83.seen, v83.total], [3, 4], '3 joueurs du Var sur 4 pas encore vus')
assert.equal(aggValue('share', v83), 0.75)
assert.equal(aggValue('share', a.byDept.get('99')), undefined, 'zone sans joueur : pas de valeur (gris)')

// Moyenne d'une mesure par club : seulement les joueurs mesurés.
const q3 = R({ out: { type: 'table', groupBy: 'club', value: 'measure', measure: 'taille' } })
a = run(q3, { region: 'region-sud', dept: '83' })
const hbc = a.clubs.find((c) => c.key === 'hbc exemple')!
assert.equal(hbc.n, 2, 'deux joueurs mesurés')
assert.equal(aggValue('measure', hbc), 165)
assert.equal(aggValue('measure', a.clubs.find((c) => c.key === 'as fictive')), 175)
assert.deepEqual(rankAgg('measure', a.clubs.map((c) => [c.key, c] as [string, typeof c])).map(([k]) => k), ['as fictive', 'hbc exemple'])

// Part vue des joueurs qui répondent (période : la saison).
const q4 = R({ pop: { sex: 'F' }, out: { type: 'table', groupBy: 'dept', value: 'seen' } })
a = run(q4)
assert.equal(aggValue('seen', a.byDept.get('83')), 1 / 3, 'Var : 1 joueuse vue sur 3')
assert.equal(aggValue('seen', a.byDept.get('06')), 1)

// Club non renseigné : en fin de classement.
a = run(R({ out: { type: 'table' } }))
assert.equal(rankAgg('count', a.clubs.map((c) => [c.key, c] as [string, typeof c])).at(-1)![0], '', 'club non renseigné à la fin')

// ---------- « Le club qui a le plus de… » : tableau par club limité aux N premiers ----------
const top = (limit: number, dir: 'asc' | 'desc' = 'desc', extra: Partial<Recipe['out']> = {}) =>
  R({ out: { type: 'table', groupBy: 'club', sort: { by: 'count', dir }, limit, ...extra } })
assert.equal(isTopClubs(top(1)), true)
assert.equal(isTopClubs(R({ out: { type: 'table', groupBy: 'club' } })), false, 'sans limite')
assert.equal(isTopClubs(R({ out: { type: 'table', groupBy: 'dept', limit: 3 } })), false, 'par département')
assert.equal(goesToBilan(top(1)), true, 'reste une réponse géographique')
{
  // France : HBC Exemple (3 joueurs), puis trois clubs à 1 ; le club non renseigné n'est jamais classé.
  const q = top(1)
  const b = run(q)
  const ranked = rankAgg('count', b.clubs.map((c) => [c.key, c] as [string, typeof c])).map(([, c]) => c)
  assert.deepEqual(limitClubs(q, 'count', ranked).map((c) => c.key), ['hbc exemple'])
  assert.deepEqual(limitClubs(top(2), 'count', ranked).map((c) => c.key), ['hbc exemple', 'as fictive', 'club imaginaire', 'entente fictive'], 'ex aequo du 2e compris')
  assert.equal(limitClubs(R({ out: { type: 'table', groupBy: 'club' } }), 'count', ranked), ranked, 'sans limite : tous')
  // Département d'un club : celui de ses joueurs.
  assert.equal(b.clubs.find((c) => c.key === 'hbc exemple')!.dept, '83')
  assert.equal(b.clubs.find((c) => c.key === '')!.dept, undefined)
  // « Le club qui en a le moins », parmi ceux qui ont des joueuses 2011 vues : seulement ceux qui répondent.
  const q2 = R({ pop: { sex: 'F' }, seen: { by: 'event', op: 'gte', n: 1, period: { kind: 'season' } }, out: { type: 'table', groupBy: 'club', sort: { by: 'count', dir: 'asc' }, limit: 1 } })
  const b2 = run(q2)
  const r2 = rankAgg('count', b2.clubs.map((c) => [c.key, c] as [string, typeof c]), 'asc').map(([, c]) => c)
  assert.deepEqual(limitClubs(q2, 'count', r2).map((c) => c.key), ['hbc exemple', 'club imaginaire'], 'à 0 : pas classés ; à égalité (1) : les deux')
}

// Lieu de départ : un seul club → son département, club choisi ; plusieurs dans un département → lui ; une région → elle.
const FR = { region: '', dept: '', club: null }
assert.deepEqual(topClubsPlace(FR, ['hbc exemple'], regionOf, clubDept), { region: 'region-sud', dept: '83', club: 'hbc exemple' })
assert.deepEqual(topClubsPlace(FR, ['hbc exemple', 'as fictive'], regionOf, clubDept), { region: 'region-sud', dept: '83', club: null })
assert.deepEqual(topClubsPlace(FR, ['hbc exemple', 'club imaginaire'], regionOf, clubDept), { region: 'region-sud', dept: '', club: null })
assert.deepEqual(topClubsPlace(FR, ['hbc exemple', 'entente fictive'], regionOf, clubDept), FR, 'deux régions : la France')
assert.deepEqual(topClubsPlace(FR, ['club perdu'], regionOf, clubDept), FR, 'département inconnu : lieu de la question')
assert.deepEqual(topClubsPlace(FR, [], regionOf, clubDept), FR)
// Jamais plus large que le lieu de la question, jamais en dehors.
const VAR = { region: 'region-sud', dept: '83', club: null }
assert.deepEqual(topClubsPlace(VAR, ['as fictive'], regionOf, clubDept), { region: 'region-sud', dept: '83', club: 'as fictive' })
assert.deepEqual(topClubsPlace(VAR, ['entente fictive'], regionOf, clubDept), VAR, 'hors du Var : le Var')
const SUD = { region: 'region-sud', dept: '', club: null }
assert.deepEqual(topClubsPlace(SUD, ['club imaginaire'], regionOf, clubDept), { region: 'region-sud', dept: '06', club: 'club imaginaire' })
const ONE = { region: 'region-sud', dept: '83', club: 'hbc exemple' }
assert.equal(topClubsPlace(ONE, ['as fictive'], regionOf, clubDept), ONE, 'club déjà choisi : gardé')
// De bout en bout : recette (sans lieu) → premier club → son département, club choisi.
{
  const q = top(1)
  const keys = (runRecipe(ix, q).table ?? []).map((x) => x.key).filter(Boolean)
  const to = splitPlace(q, regionOf, clubDept)
  assert.deepEqual(topClubsPlace(to.place, keys, regionOf, clubDept), { region: 'region-sud', dept: '83', club: 'hbc exemple' })
}

console.log('tout bon')
