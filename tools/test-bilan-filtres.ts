// Barre de filtres du bilan de détection (src/bilanFilters.ts) : la barre de la liste Joueurs posée sur le bilan.
// Passage état du bilan (adresse) ↔ requête de la barre, une commande par notion (sexe, année, lieu : celles du bilan),
// question posée (sa population dans la barre), adresse (f=, t=), et population retenue par le moteur de la recette
// (selectPlayers) sur un jeu entièrement fictif.
//
//   npx jiti tools/test-bilan-filtres.ts
import assert from 'node:assert/strict'
import { barHidden, barQuery, cleanFilters, closeQuestion, encodeBar, fromBar, hasBarFilter, parseBar, withoutYears, type BarState } from '../src/bilanFilters'
import { selectPlayers } from '../src/playerQuery'
import { buildIndex, cleanRecipe, EMPTY_RECIPE, type QPlayer, type Recipe } from '../src/recipe'

const REGIONS: Record<string, string> = { '83': 'region-sud', '06': 'region-sud', '26': 'region-ara', '75': 'region-idf' }
const regionOf = (d: string) => REGIONS[d]
const CLUB_DEPT: Record<string, string> = { 'hbc exemple': '83', 'as fictive': '83', 'club imaginaire': '26', 'entente fictive': '75' }
const clubDept = (k: string) => CLUB_DEPT[k]
const R = (x: Partial<Recipe>): Recipe => cleanRecipe({ pop: {}, avis: [], measures: [], out: { type: 'list' }, ...x })
const S = (x: Partial<BarState> = {}): BarState => ({ sex: 'all', years: [], region: '', dept: '', club: null, f: null, t: '', q: null, ...x })
const apply = (s: BarState, patch: ReturnType<typeof fromBar>['patch']): BarState => ({ ...s, ...patch })

// ---------- Filtres nettoyés ----------
assert.equal(cleanFilters(null), null)
assert.equal(cleanFilters(R({})), null, 'aucun filtre : rien dans l’adresse')
assert.equal(cleanFilters(R({ out: { type: 'list', sort: { by: 'height', dir: 'desc' } } })), null, 'un tri seul ne filtre pas le bilan')
assert.deepEqual(cleanFilters(R({ pop: { positions: ['ARG'] } }))?.pop, { positions: ['ARG'] })
assert.deepEqual(cleanFilters(R({ pop: { positions: ['ARG'] }, out: { type: 'list', sort: { by: 'height', dir: 'desc' } } }))?.out, { type: 'list' }, 'sans tri')
assert.equal(hasBarFilter(null, ''), false)
assert.equal(hasBarFilter(null, '  '), false)
assert.equal(hasBarFilter(null, 'Martin'), true)
assert.equal(hasBarFilter(R({ pop: { hand: 'gaucher' } }), ''), true)

// ---------- Sans filtre : la barre ne montre rien ----------
{
  const s = S({ sex: 'F', years: ['2011'], region: 'region-sud', dept: '83', club: 'hbc exemple' })
  const qy = barQuery(s)
  assert.deepEqual(qy.recipe.pop, { sex: 'F', years: [2011, 2011], regions: ['region-sud'], depts: ['83'], clubs: ['hbc exemple'] }, 'menus de la barre : sexe, année, lieu du bilan')
  assert.deepEqual([...barHidden(s)].sort(), ['clubs', 'depts', 'regions', 'sex', 'years'], 'aucune pastille : ce sont les commandes du bilan')
  // Rien changé dans la barre : l'état du bilan reste le même.
  const { patch } = fromBar(qy, s, regionOf, clubDept)
  assert.deepEqual(patch, { region: 'region-sud', dept: '83', club: 'hbc exemple', sex: 'F', years: ['2011'], f: null, t: '' })
}
// Lieu qu'une recette ne dit pas (département non renseigné, autres outre-mer) : gardé tel quel.
for (const dept of ['?', '97']) {
  const s = S({ dept })
  assert.deepEqual(barQuery(s).recipe.pop, {}, `pas de département ${dept} dans la recette`)
  const { patch } = fromBar({ ...barQuery(s), recipe: R({ pop: { hand: 'gaucher' } }) }, s, regionOf, clubDept)
  assert.equal(patch.dept, dept, `département ${dept} gardé`)
  assert.deepEqual(patch.f?.pop, { hand: 'gaucher' })
}
// Année inconnue (« '' ») : gardée, la barre ne la dit pas.
{
  const s = S({ years: [''] })
  const { patch } = fromBar({ ...barQuery(s), recipe: R({ pop: { positions: ['PIV'] } }) }, s, regionOf, clubDept)
  assert.deepEqual(patch.years, [''])
}

// ---------- Un filtre ajouté au doigt (poste) : le reste du bilan ne bouge pas ----------
{
  const s = S({ years: ['2010'], region: 'region-sud', dept: '83' })
  const qy = barQuery(s)
  const next = { ...qy, recipe: R({ ...qy.recipe, pop: { ...qy.recipe.pop, positions: ['ARG'] } }) }
  const { patch } = fromBar(next, s, regionOf, clubDept)
  assert.deepEqual(patch, { region: 'region-sud', dept: '83', club: null, sex: 'all', years: ['2010'], f: R({ pop: { positions: ['ARG'] } }), t: '' })
  const s2 = apply(s, patch)
  assert.deepEqual([...barHidden(s2)].sort(), ['clubs', 'depts', 'regions', 'sex', 'years'], 'pastille du poste seulement')
  assert.deepEqual(barQuery(s2).recipe.pop, { years: [2010, 2010], positions: ['ARG'], regions: ['region-sud'], depts: ['83'] })
  // « Tout effacer » de la barre : retire le poste (fait par la barre en retirant ses pastilles visibles).
  const cleared = fromBar({ ...barQuery(s2), recipe: R({ pop: { years: [2010, 2010], regions: ['region-sud'], depts: ['83'] } }) }, s2, regionOf, clubDept).patch
  assert.equal(cleared.f, null)
  assert.deepEqual(cleared.years, ['2010'], 'l’année du bilan reste')
  assert.equal(cleared.dept, '83', 'le lieu reste')
}

// ---------- Une phrase qui dit le sexe et l'année : aux commandes du bilan ----------
{
  const s = S()
  const { patch } = fromBar({ recipe: R({ pop: { sex: 'F', years: [2011, 2011], hand: 'gaucher' } }), q: '' }, s, regionOf, clubDept)
  assert.equal(patch.sex, 'F')
  assert.deepEqual(patch.years, ['2011'])
  assert.deepEqual(patch.f?.pop, { hand: 'gaucher' }, 'ni sexe ni année dans les filtres de la barre')
}
// Plusieurs années (une plage, ou des années qui ne se suivent pas) : au menu du bilan (cases à cocher), pas de pastille.
{
  const s = S({ years: ['2010'] })
  const { patch } = fromBar({ recipe: R({ pop: { years: [2009, 2011] } }), q: '' }, s, regionOf, clubDept)
  assert.deepEqual(patch.years, ['2011', '2010', '2009'])
  assert.equal(patch.f, null)
  const s2 = apply(s, patch)
  assert.equal(barHidden(s2).has('years'), true, 'pas de pastille : le menu du bilan les montre')
  assert.deepEqual(barQuery(s2).recipe.pop, { years: [2009, 2011] }, 'menus de la barre : ces années')
  const odd = fromBar({ recipe: R({ pop: { years: [2010, 2014], yearList: [2010, 2012, 2014] } }), q: '' }, s, regionOf, clubDept).patch
  assert.deepEqual(odd.years, ['2014', '2012', '2010'])
  assert.deepEqual(barQuery(apply(s, odd)).recipe.pop, { years: [2010, 2014], yearList: [2010, 2012, 2014] })
  // Adresse d'avant : années dans la barre (f=) : pastille ; des années choisies au menu du bilan les remplacent.
  const old = S({ f: R({ pop: { years: [2009, 2011] } }) })
  assert.equal(barHidden(old).has('years'), false, 'pastille « nés de 2009 à 2011 » visible')
  assert.equal(withoutYears(old.f!), null)
  assert.deepEqual(withoutYears(R({ pop: { years: [2010, 2014], yearList: [2010, 2014], hand: 'gaucher' } }))?.pop, { hand: 'gaucher' })
  assert.equal(withoutYears(null), null)
  // Année inconnue cochée avec d'autres : la barre ne la dit pas (une recette ne la connaît pas), le bilan la garde.
  const unk = S({ years: ['2011', ''] })
  assert.equal(barQuery(unk).recipe.pop.years, undefined)
  assert.deepEqual(fromBar(barQuery(unk), unk, regionOf, clubDept).patch.years, ['2011', ''])
}
// Sexe retiré par une phrase (« garçons et filles ») : « Tous ».
{
  const s = S({ sex: 'M' })
  const qy = barQuery(s)
  const { patch } = fromBar({ ...qy, recipe: R({ pop: {} }) }, s, regionOf, clubDept)
  assert.equal(patch.sex, 'all')
}

// ---------- Lieu choisi dans la barre : le bilan descend à cet étage ----------
{
  const s = S()
  let { patch } = fromBar({ recipe: R({ pop: { clubs: ['as fictive'] } }), q: '' }, s, regionOf, clubDept)
  assert.deepEqual([patch.region, patch.dept, patch.club], ['region-sud', '83', 'as fictive'], 'un club : son département, club choisi')
  assert.equal(patch.f, null, 'le club n’est pas une pastille : c’est l’étage du bilan')
  ;({ patch } = fromBar({ recipe: R({ pop: { regions: ['region-sud'] } }), q: '' }, s, regionOf, clubDept))
  assert.deepEqual([patch.region, patch.dept, patch.club], ['region-sud', '', null], 'une région')
  ;({ patch } = fromBar({ recipe: R({ pop: { depts: ['83', '75'] } }), q: '' }, s, regionOf, clubDept))
  assert.deepEqual([patch.region, patch.dept], ['', ''], 'deux départements de deux régions : la France…')
  assert.deepEqual(patch.f?.pop, { depts: ['83', '75'] }, '… et seuls eux comptés (pastille)')
  // Menu « Toutes les régions » depuis un département : retour à la France.
  const at = S({ region: 'region-sud', dept: '83' })
  ;({ patch } = fromBar({ recipe: R({ pop: {} }), q: '' }, at, regionOf, clubDept))
  assert.deepEqual([patch.region, patch.dept, patch.club], ['', '', null])
  // Menu département dans la région : ce département.
  ;({ patch } = fromBar({ recipe: R({ pop: { regions: ['region-sud'], depts: ['06'] } }), q: '' }, S({ region: 'region-sud' }), regionOf, clubDept))
  assert.deepEqual([patch.region, patch.dept, patch.club], ['region-sud', '06', null])
}

// ---------- Nom cherché ----------
{
  const s = S({ dept: '26', region: 'region-ara' })
  const { patch } = fromBar({ ...barQuery(s), q: 'Martin' }, s, regionOf, clubDept)
  assert.equal(patch.t, 'Martin')
  assert.equal(patch.dept, '26')
  assert.equal(barQuery(apply(s, patch)).q, 'Martin')
}

// ---------- Question posée au bilan : la barre montre et change SA population ----------
{
  const q = R({ pop: { sex: 'F', positions: ['ARG'] }, out: { type: 'table', groupBy: 'dept' } })
  const s = S({ q, sex: 'M', years: ['2010'], f: R({ pop: { hand: 'gaucher' } }) })
  const qy = barQuery(s)
  assert.deepEqual(qy.recipe.pop, { sex: 'F', positions: ['ARG'] }, 'la population de la question, pas les filtres d’avant')
  assert.deepEqual([...barHidden(s)].sort(), ['clubs', 'depts', 'regions'], 'sexe et année : pastilles de la barre pendant une question')
  // Pastille « Joueuses » retirée : la question suit, sa sortie reste.
  const { patch } = fromBar({ ...qy, recipe: R({ pop: { positions: ['ARG'] } }) }, s, regionOf, clubDept)
  assert.deepEqual(patch.q?.pop, { positions: ['ARG'] })
  assert.deepEqual(patch.q?.out, { type: 'table', groupBy: 'dept' })
  assert.equal('sex' in patch, false, 'les commandes du bilan ne bougent pas pendant une question')
  // Condition ajoutée (vus) : dans la question.
  const seen = { by: 'event' as const, op: 'gte' as const, n: 1, period: { kind: 'season' as const } }
  const p2 = fromBar({ ...qy, recipe: R({ ...qy.recipe, seen }) }, s, regionOf, clubDept).patch
  assert.deepEqual(p2.q?.seen, seen)
  // ✕ : la question ferme, sa population reste dans la barre (sexe et année aux commandes du bilan).
  const c = closeQuestion(R({ pop: { sex: 'F', years: [2011, 2011], positions: ['ARG'] }, seen, out: { type: 'table', groupBy: 'dept' } }))
  assert.equal(c.q, null)
  assert.equal(c.sex, 'F')
  assert.deepEqual(c.years, ['2011'])
  assert.deepEqual(c.f?.pop, { positions: ['ARG'] })
  assert.deepEqual(c.f?.seen, seen)
  assert.deepEqual(c.f?.out, { type: 'list' })
  const c2 = closeQuestion(R({ pop: { years: [2009, 2011] }, out: { type: 'map' } }))
  assert.deepEqual([c2.sex, c2.years], ['all', ['2011', '2010', '2009']])
  assert.equal(c2.f, null)
  assert.equal(closeQuestion(R({ out: { type: 'table', groupBy: 'club' } })).f, null, 'question sans population : barre vide')
}

// ---------- Adresse ----------
{
  const f = R({ pop: { positions: ['ARG'], hand: 'gaucher' } })
  assert.deepEqual(parseBar(encodeBar(f), 'Martin'), { f, t: 'Martin' })
  assert.deepEqual(parseBar(null, null), { f: null, t: '' })
  assert.deepEqual(parseBar('{pas du json', null), { f: null, t: '' }, 'illisible : aucun filtre')
  assert.deepEqual(parseBar(JSON.stringify({ pop: { positions: ['XX'], hMin: 9999 } }), null), { f: null, t: '' }, 'valeurs inconnues ou hors bornes : écartées')
  assert.deepEqual(parseBar('x'.repeat(9000), null).f, null, 'trop long')
  assert.equal(parseBar(null, 'a'.repeat(200)).t.length, 80)
  assert.equal(encodeBar(null), '')
}

// ---------- Population retenue (moteur de la recette, comme la liste Joueurs) ----------
{
  type P = QPlayer & { department?: string }
  const pl = (id: string, lastName: string, sex: 'M' | 'F', position: P['position'], club: string, department: string, laterality?: P['laterality']): P => ({
    id,
    firstName: `Prénom${id}`,
    lastName,
    birthDate: '2011-03-02',
    sex,
    position,
    club,
    department,
    laterality,
  })
  const players: P[] = [
    pl('a', 'Martin', 'F', 'ARG', 'HBC Exemple', '83', 'gaucher'),
    pl('b', 'Durand', 'F', 'ARG', 'HBC Exemple', '83', 'droitier'),
    pl('c', 'Martin', 'M', 'PIV', 'AS Fictive', '83'),
    pl('d', 'Moreau', 'M', 'ARG', 'Club Imaginaire', '26', 'gaucher'),
  ]
  const ix = buildIndex<P>({ players, sights: [], evals: [], measures: [], criteria: [], groups: [], events: [], deptOf: (p) => p.department || undefined, regionOf, today: '2026-10-17' })
  const hay = (p: P) => `${p.lastName} ${p.firstName} ${p.club ?? ''}`.toLowerCase()
  const toks = (p: P) => [p.lastName.toLowerCase(), p.firstName.toLowerCase()]
  const ids = (f: Recipe | null, t = '') => selectPlayers(ix, { recipe: f ?? EMPTY_RECIPE, q: t }, hay, toks).list.map((p) => p.id).sort()
  assert.deepEqual(ids(R({ pop: { positions: ['ARG'] } })), ['a', 'b', 'd'], 'poste')
  assert.deepEqual(ids(R({ pop: { positions: ['ARG'], hand: 'gaucher' } })), ['a', 'd'], 'poste et latéralité')
  assert.deepEqual(ids(null, 'Martin'), ['a', 'c'], 'nom cherché')
  assert.deepEqual(ids(R({ pop: { positions: ['ARG'] } }), 'Martin'), ['a'], 'nom et poste')
  // Le lieu et le sexe restent au bilan : la population de la barre ne les filtre pas.
  const s = apply(S(), fromBar({ recipe: R({ pop: { sex: 'F', depts: ['83'], positions: ['ARG'] } }), q: '' }, S(), regionOf, clubDept).patch)
  assert.deepEqual(ids(s.f), ['a', 'b', 'd'], 'filtres de la barre seulement (sexe et lieu : commandes du bilan)')
  assert.deepEqual([s.sex, s.dept], ['F', '83'])
}

console.log('tout bon')
