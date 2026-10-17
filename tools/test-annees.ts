// Années de naissance à choix MULTIPLE (src/birthYears.ts) : résumé du bouton, pastille, adresse (a=2010,2011,2012 et
// a=2011 d'avant), recettes d'avant ({ years: [a, b] }) relues telles quelles, années qui ne se suivent pas (yearList),
// filtrage (joueur né dans l'une des années), nombres des menus, fusion d'une phrase, retrait, années dites par le modèle
// (une, une liste, une plage, « 2010 et 2012 »), bilan (filterPlayers) et événements (génération). Jeu entièrement fictif.
//
//   npx jiti tools/test-annees.ts
import assert from 'node:assert/strict'
import {
  cleanYearFields,
  inYears,
  parseSaidYears,
  parseYearsParam,
  putYears,
  sortYearStrings,
  toggleYear,
  yearFields,
  yearsOf,
  yearsParam,
  yearsPhrase,
  yearsShort,
  type YearFields,
} from '../src/birthYears'
import { activeKeys, buildPlayersIndex, cleanQuery, EMPTY_QUERY, listRecipe, mergeQuery, quickCounts, removeKeys, selectPlayers, type JoueursQuery } from '../src/playerQuery'
import { cleanRecipe, decodeRecipe, encodeRecipe, EMPTY_RECIPE, interpretRecipe, recipeChips, removeChip, runRecipe, type Names, type QPlayer, type QuestionContext, type Recipe } from '../src/recipe'
import { filterPlayers } from '../src/coverage'
import { readEventsRecipe } from '../src/eventQuery'

// ---------- Résumé du bouton ----------
assert.equal(yearsShort([]), 'Toutes les années')
assert.equal(yearsShort([], { all: 'Toutes années' }), 'Toutes années')
assert.equal(yearsShort(['2011']), '2011')
assert.equal(yearsShort(['']), 'Année inconnue')
assert.equal(yearsShort(['2012', '2011', '2010']), '2010 – 2012', 'années qui se suivent : la plage')
assert.equal(yearsShort(['2014', '2012', '2010']), '2010, 2012, 2014')
assert.equal(yearsShort(['2010', '2012']), '2010, 2012')
assert.equal(yearsShort(['2009', '2011', '2013', '2015']), '4 années', 'trop long : le nombre')
assert.equal(yearsShort(['2011', '']), '2011, année inconnue')
assert.equal(yearsShort(['2011', '2012', '']), '3 années')

// ---------- Pastille ----------
assert.equal(yearsPhrase([2011]), 'nés en 2011')
assert.equal(yearsPhrase([2011], 'es'), 'nées en 2011')
assert.equal(yearsPhrase([2012, 2010, 2011]), 'nés de 2010 à 2012')
assert.equal(yearsPhrase([2010, 2012, 2014]), 'nés en 2010, 2012 ou 2014')
assert.equal(yearsPhrase([2010, 2012]), 'nés en 2010 ou 2012')
assert.equal(yearsPhrase([2000, 2002, 2004, 2006, 2008, 2010, 2012]), 'nés en 7 années, de 2000 à 2012')
assert.equal(yearsPhrase([]), '')

// ---------- Adresse ----------
assert.equal(yearsParam(['2012', '2011', '2010']), '2012,2011,2010')
assert.equal(yearsParam(['2011', '']), '2011,inconnue')
assert.deepEqual(parseYearsParam('2011'), ['2011'], 'adresse d’avant : une année')
assert.deepEqual(parseYearsParam('inconnue'), [''], 'adresse d’avant : année inconnue')
assert.deepEqual(parseYearsParam('2010,2011,2012'), ['2012', '2011', '2010'])
assert.deepEqual(parseYearsParam('2012,2010,2010'), ['2012', '2010'], 'sans doublon')
assert.deepEqual(parseYearsParam('2010-2012'), ['2012', '2011', '2010'])
assert.deepEqual(parseYearsParam('inconnue,2011'), ['2011', ''])
assert.deepEqual(parseYearsParam('2011,abc,<script>,20111'), ['2011'], 'rien d’autre n’est cru')
assert.deepEqual(parseYearsParam(null), [])
assert.deepEqual(parseYearsParam(''), [])
for (const ys of [['2011'], ['2012', '2011', '2010'], ['2014', '2010', ''], []]) assert.deepEqual(parseYearsParam(yearsParam(ys)), ys, `aller-retour ${ys}`)
assert.ok(parseYearsParam('1950-2100').length <= 41, 'au plus 40 années (et l’inconnue)')
assert.deepEqual(sortYearStrings(['2010', '', '2012', '2010']), ['2012', '2010', ''])
assert.deepEqual(toggleYear(['2012'], '2010'), ['2012', '2010'])
assert.deepEqual(toggleYear(['2012', '2010'], '2012'), ['2010'])

// ---------- Champs de la recette ----------
assert.deepEqual(yearFields([2011]), { years: [2011, 2011] }, 'une année : comme avant')
assert.deepEqual(yearFields([2012, 2010, 2011]), { years: [2010, 2012] }, 'années qui se suivent : les bornes, comme avant')
assert.deepEqual(yearFields(['2014', '2010', '2012']), { years: [2010, 2014], yearList: [2010, 2012, 2014] })
assert.deepEqual(yearFields([]), {})
assert.deepEqual(yearFields(null), {})
{
  const f: YearFields = { years: [2000, 2001], yearList: [1999] }
  putYears(f, [2011])
  assert.deepEqual(f, { years: [2011, 2011] }, 'putYears remplace bornes et liste')
  putYears(f, [])
  assert.deepEqual(f, {})
}
assert.deepEqual(yearsOf({}), null)
assert.deepEqual(yearsOf({ years: [2010, 2012] }), [2010, 2011, 2012])
assert.deepEqual(yearsOf({ years: [2010, 2014], yearList: [2010, 2014] }), [2010, 2014])
assert.equal(inYears({}, ''), true, 'aucune année : tous, même l’année inconnue')
assert.equal(inYears({ years: [2010, 2012] }, '2011'), true)
assert.equal(inYears({ years: [2010, 2014], yearList: [2010, 2014] }, '2012'), false)
assert.equal(inYears({ years: [2010, 2014], yearList: [2010, 2014] }, '2014'), true)
assert.equal(inYears({ years: [2010, 2012] }, ''), false)
// Lecture (adresse, session, « Mes questions ») : rien n'est cru.
const LIM = [1950, 2100] as const
assert.deepEqual(cleanYearFields([2011, 2011], undefined, LIM), { years: [2011, 2011] })
assert.deepEqual(cleanYearFields([2012, 2010], undefined, LIM), { years: [2010, 2012] })
assert.deepEqual(cleanYearFields([2010, 2014], [2014, 2010, 2012, 2012], LIM), { years: [2010, 2014], yearList: [2010, 2012, 2014] })
assert.deepEqual(cleanYearFields([2010, 2014], [2010, 2011], LIM), { years: [2010, 2011] }, 'liste qui se suit : les bornes suffisent')
assert.deepEqual(cleanYearFields([2010, 2012], [2005, 2020], LIM), { years: [2010, 2012] }, 'liste hors des bornes : écartée')
assert.deepEqual(cleanYearFields(undefined, [2010, 2012], LIM), {}, 'une liste sans bornes : rien')
assert.deepEqual(cleanYearFields(['2010', 2012], undefined, LIM), {})
assert.deepEqual(cleanYearFields([1800, 2012], undefined, LIM), {})

// ---------- Années dites (modèle) ----------
const Y = (v: unknown) => parseSaidYears(v, 2026)
assert.deepEqual(Y(2011), [2011])
assert.deepEqual(Y('2011'), [2011])
assert.deepEqual(Y([2010, 2012]), [2010, 2012], 'liste : les années citées')
assert.deepEqual(Y([2012, '2010', 2011]), [2010, 2011, 2012])
assert.deepEqual(Y({ de: 2010, a: 2012 }), [2010, 2011, 2012], 'plage')
assert.deepEqual(Y({ de: 2010 }), [2010])
assert.deepEqual(Y({ a: 2012 }), [2012])
assert.deepEqual(Y('2010-2012'), [2010, 2011, 2012])
assert.deepEqual(Y('de 2010 à 2012'), [2010, 2011, 2012])
assert.deepEqual(Y('entre 2010 et 2012'), [2010, 2011, 2012])
assert.deepEqual(Y('2010 et 2012'), [2010, 2012], '« les 2010 et 2012 » : les deux années')
assert.deepEqual(Y('2010, 2012 et 2014'), [2010, 2012, 2014])
assert.deepEqual(Y('2010 ou 2011'), [2010, 2011])
assert.deepEqual(Y(['2010-2011', 2013]), [2010, 2011, 2013])
assert.deepEqual(Y({ de: 1960, a: 2012 }), Array.from({ length: 31 }, (_, i) => 1982 + i), 'plage ramenée à 30 ans')
for (const bad of [2031, 1800, 'deux mille dix', [], [2010, 'x'], [{}], {}, null, true, '2010 et x']) assert.equal(Y(bad), undefined, `illisible : ${JSON.stringify(bad)}`)

// ---------- Jeu fictif ----------
type P = QPlayer & { department?: string }
const CLUBS = ['HBC Exemple', 'AS Fictive', 'Handball Imaginaire']
let seed = 11
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const players: P[] = Array.from({ length: 300 }, (_, i) => ({
  id: `p${i}`,
  firstName: `Prénom${i}`,
  lastName: `Fictif${String(i).padStart(3, '0')}`,
  birthDate: i % 23 === 0 ? undefined : `${2008 + Math.floor(rnd() * 7)}-0${1 + (i % 9)}-15`,
  sex: rnd() < 0.5 ? 'M' : 'F',
  club: CLUBS[i % 3],
  department: ['83', '13', '75'][i % 3],
}))
const REGIONS: Record<string, string> = { '83': 'region-sud', '13': 'region-sud', '75': 'region-idf' }
const ix = buildPlayersIndex({
  players,
  sights: [],
  evals: [],
  measures: [],
  criteria: [],
  groups: [],
  events: [],
  deptOf: (p) => p.department,
  regionOf: (d) => REGIONS[d],
  today: '2026-10-14',
})
const yearOf = (p: P) => (p.birthDate ? Number(p.birthDate.slice(0, 4)) : 0)
const sel = (qy: JoueursQuery) => selectPlayers(ix, qy, (p) => p.lastName, (p) => [p.lastName.toLowerCase()]).list.map((p) => p.id)
const R = (pop: Recipe['pop']): Recipe => cleanRecipe({ ...EMPTY_RECIPE, pop })
const Q = (pop: Recipe['pop']): JoueursQuery => ({ recipe: listRecipe(R(pop)), q: '' })
const expect = (ys: number[]) => players.filter((p) => ys.includes(yearOf(p))).map((p) => p.id).sort()

// Filtrage : joueur né dans l'une des années choisies.
{
  const odd = Q(yearFields([2010, 2012, 2014]))
  assert.deepEqual(sel(odd).sort(), expect([2010, 2012, 2014]))
  assert.deepEqual(sel(Q({ years: [2010, 2012] })).sort(), expect([2010, 2011, 2012]), 'recette d’avant (plage) : inchangée')
  assert.deepEqual(sel(Q({ years: [2011, 2011] })).sort(), expect([2011]), 'recette d’avant (une année) : inchangée')
  assert.equal(runRecipe(ix, { ...odd.recipe, out: { type: 'count' } }).match.length, expect([2010, 2012, 2014]).length)
  // Tableau par génération : seulement les années choisies.
  const t = runRecipe(ix, { ...odd.recipe, out: { type: 'table', groupBy: 'year' } }).table!
  assert.deepEqual(t.map((r) => r.key).sort(), ['2010', '2012', '2014'])
  // Nombres du menu des années : chacun compte les joueurs de cette année (le choix des années n'y compte pas).
  const c = quickCounts(ix, odd, (p) => p.lastName, (p) => [p.lastName])
  assert.equal(c.years.find(([y]) => y === '2011')?.[1], expect([2011]).length)
  assert.equal(c.years.find(([y]) => y === '2010')?.[1], expect([2010]).length)
  assert.ok(c.clubTotal === expect([2010, 2012, 2014]).length, 'menus des clubs : ces années seulement')
}

// Pastilles et recette en clair.
const names: Names = {
  region: (x) => x,
  dept: (x) => x,
  club: (x) => x,
  group: (x) => x,
  event: (x) => x,
  criterion: (x) => x,
  position: (x) => x,
}
assert.equal(recipeChips(R(yearFields([2010, 2012, 2014])), names)[0].label, 'nés en 2010, 2012 ou 2014')
assert.equal(recipeChips(R({ years: [2010, 2012] }), names)[0].label, 'nés de 2010 à 2012')
assert.equal(recipeChips(R({ sex: 'F', years: [2011, 2011] }), names)[1].label, 'nées en 2011')
assert.equal(recipeChips(R({ sex: 'F', ...yearFields([2010, 2011, 2012]) }), names)[1].label, 'nées de 2010 à 2012')

// Compatibilité : recettes et sessions d'avant relues telles quelles ; nouvelle forme gardée à l'aller-retour.
{
  const old = { pop: { sex: 'M', years: [2011, 2011] }, avis: [], measures: [], out: { type: 'count' } }
  assert.deepEqual(cleanRecipe(old).pop, { sex: 'M', years: [2011, 2011] })
  assert.deepEqual(decodeRecipe(JSON.stringify(old))?.pop, { sex: 'M', years: [2011, 2011] }, 'lien partagé d’avant')
  const neu = R(yearFields([2010, 2012, 2014]))
  assert.deepEqual(decodeRecipe(encodeRecipe(neu))?.pop, { years: [2010, 2014], yearList: [2010, 2012, 2014] })
  assert.deepEqual(cleanQuery({ recipe: { pop: { years: [2010, 2014], yearList: [2010, 2014, 'x', 1800] } }, q: '' }).recipe.pop, { years: [2010, 2014], yearList: [2010, 2014] }, 'session')
  assert.deepEqual(cleanRecipe({ pop: { yearList: [2010, 2012] } }).pop, {}, 'liste seule (sans bornes) : rien')
}

// Fusion d'une phrase, retrait.
{
  const cur = Q(yearFields([2010, 2012, 2014]))
  assert.deepEqual(activeKeys(cur), ['years'])
  const m1 = mergeQuery(cur, R({ years: [2011, 2011] }), 'ajouter')
  assert.deepEqual(m1.recipe.pop, { years: [2011, 2011] }, 'années redites : remplacent (pas de liste d’avant qui traîne)')
  const m2 = mergeQuery(Q({ years: [2011, 2011] }), R(yearFields([2009, 2013])), 'ajouter')
  assert.deepEqual(m2.recipe.pop, { years: [2009, 2013], yearList: [2009, 2013] })
  const m3 = mergeQuery(cur, R({ sex: 'F' }), 'ajouter')
  assert.deepEqual(m3.recipe.pop, { sex: 'F', years: [2010, 2014], yearList: [2010, 2012, 2014] }, 'une autre clé : les années restent')
  assert.deepEqual(removeKeys(cur, ['years']).recipe.pop, {})
  assert.deepEqual(removeChip(cur.recipe, 'years').pop, {})
  assert.deepEqual(mergeQuery(cur, EMPTY_RECIPE, 'retirer', ['years']).recipe.pop, {})
  assert.deepEqual(EMPTY_QUERY.recipe.pop, {})
}

// Questions en langage naturel : une année, plusieurs, une plage (les deux formes : avant et après la nouvelle consigne).
{
  const ctx: QuestionContext = {
    regions: [{ id: 'region-sud', name: 'Région Sud' }],
    depts: [{ code: '83', name: 'Var' }],
    regionOfDept: (c) => REGIONS[c],
    positions: [{ id: 'GB', label: 'Gardien' }],
    clubs: [],
    groups: [],
    events: [],
    criteria: [],
    today: '2026-10-14',
  }
  const pop = (population: unknown) => interpretRecipe({ population }, [], ctx).recipe.pop
  assert.deepEqual(pop({ annee: 2011 }), { years: [2011, 2011] })
  assert.deepEqual(pop({ annees: { de: 2010, a: 2012 } }), { years: [2010, 2012] }, 'plage (consigne d’avant)')
  assert.deepEqual(pop({ annees: [2010, 2011] }), { years: [2010, 2011] })
  assert.deepEqual(pop({ annees: [2010, 2012] }), { years: [2010, 2012], yearList: [2010, 2012] }, 'les 2010 et 2012')
  assert.deepEqual(pop({ annees: [2014, 2010, 2012] }), { years: [2010, 2014], yearList: [2010, 2012, 2014] })
  assert.deepEqual(pop({ annee: '2010 et 2012' }), { years: [2010, 2012], yearList: [2010, 2012] })
  assert.deepEqual(pop({ annee: '2010-2012' }), { years: [2010, 2012] })
  const bad = interpretRecipe({ population: { annee: 1800 } }, [], ctx)
  assert.deepEqual(bad.recipe.pop, {})
  assert.ok(bad.notes.some((n) => n.includes('pas une année de naissance')))
}

// ---------- Bilan : carte, clubs, générations (filterPlayers) ----------
{
  const place = { deptOf: (p: P) => p.department, regionOf: (d: string) => REGIONS[d] }
  const ids = (xs: P[]) => xs.map((p) => p.id).sort()
  const birth = (p: P) => p.birthDate?.slice(0, 4) ?? ''
  assert.deepEqual(ids(filterPlayers(players, { years: ['2010', '2012'] }, place)), expect([2010, 2012]))
  assert.deepEqual(ids(filterPlayers(players, { years: [] }, place)), ids(players), 'aucune année : tous')
  assert.deepEqual(ids(filterPlayers(players, { years: [''] }, place)), ids(players.filter((p) => !birth(p))), 'année inconnue')
  assert.deepEqual(ids(filterPlayers(players, { years: ['2011', ''] }, place)), ids(players.filter((p) => !birth(p) || birth(p) === '2011')))
  assert.deepEqual(ids(filterPlayers(players, { year: '2011' }, place)), expect([2011]), 'une année (d’avant) : inchangé')
  assert.deepEqual(ids(filterPlayers(players, { years: ['2010', '2012'], dept: '83' }, place)), ids(players.filter((p) => p.department === '83' && [2010, 2012].includes(yearOf(p)))))
}

// ---------- Événements : génération dite (une, plusieurs, une plage) ----------
{
  const rctx = { today: '2026-10-14', names: [], places: [], creators: [], geo: { regions: [], depts: [] } }
  assert.deepEqual(readEventsRecipe({ generation: 2011 }, [], rctx).f.gens, [2011])
  assert.deepEqual(readEventsRecipe({ generation: [2010, 2012] }, [], rctx).f.gens, [2010, 2012])
  assert.deepEqual(readEventsRecipe({ generation: { de: 2010, a: 2012 } }, [], rctx).f.gens, [2010, 2011, 2012])
  assert.ok(readEventsRecipe({ generation: 'x' }, [], rctx).notes.some((n) => n.includes('génération')))
}

console.log('test-annees : OK')
