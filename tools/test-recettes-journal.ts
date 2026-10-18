// Test des recettes tirées du journal des questions (src/questionRescue.ts, src/recipe.ts, src/questionLogCore.ts) :
// un cas par constat du journal anonymisé de la base de test. Réponses du modèle simulées (aucun appel réseau) ; jeu fictif.
//  1. doublons : même phrase, même page à moins de 2 s → une seule ligne (makeLogDeduper) ;
//  2. « Combien y a-t-il de gauchers ? » : la latéralité seule suffit (nombre et liste, page question et liste Joueurs) ;
//  3. nombre de clubs (« répertoriés dans la base de données », « en France », « dans la fédération ») ;
//  4. clubs classés par licenciés, « le plus de licenciés » → le premier ; « combien de licenciés » ;
//  5. « clubs : au moins N … et aucun … né en A » ;
//  6. suite de la question précédente (« la même chose… dans le Var », « et en 2011 », « pareil pour les filles ») ;
//  7. dictée : « vœu » → « Var » dans une question seulement ; phrase coupée → « Phrase incomplète… » ;
//  8. anonymisation : mots-outils, mots très courts et « Saint-Raphaël » jamais pris pour des prénoms.
//
//   npx jiti tools/test-recettes-journal.ts
import assert from 'node:assert/strict'
import { answersNothing, buildIndex, cleanRecipe, decodeRecipe, encodeRecipe, interpretRecipe, recipeChips, removeChip, runRecipe, type Names, type QData, type QPlayer, type QuestionContext, type Recipe } from '../src/recipe'
import { correctQuestionPhrase, incompletePhrase, isFollowUp, lastRecipe, rememberRecipe, rescueInterpretation } from '../src/questionRescue'
import { buildAnonymizer, makeLogDeduper } from '../src/questionLogCore'
import { goesToBilan } from '../src/bilanQuestion'
import { clean } from '../src/dictation/clean'

const TODAY = '2026-10-14'
const REGIONS: Record<string, string> = { '83': 'region-sud', '06': 'region-sud', '35': 'region-bre' }
const ctx: QuestionContext = {
  regions: [
    { id: 'region-sud', name: 'Région Sud' },
    { id: 'region-bre', name: 'Bretagne' },
  ],
  depts: [
    { code: '83', name: 'Var' },
    { code: '06', name: 'Alpes-Maritimes' },
    { code: '35', name: 'Ille-et-Vilaine' },
  ],
  regionOfDept: (c) => REGIONS[c],
  positions: [
    { id: 'GB', label: 'Gardien' },
    { id: 'PIV', label: 'Pivot' },
  ],
  clubs: [
    { key: 'club alpha', name: 'Club Alpha', dept: '83' },
    { key: 'club beta', name: 'Club Beta', dept: '83' },
    { key: 'club gamma', name: 'Club Gamma', dept: '06' },
    { key: 'club delta', name: 'Club Delta', dept: '35' },
  ],
  groups: [],
  events: [],
  criteria: [{ id: 'taille', label: 'Taille', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'cm' }],
  zoneOf: () => null,
  today: TODAY,
}

// ---------- Jeu fictif ----------
type P = QPlayer & { department?: string }
let n = 0
const pl = (birth: string, sex: 'M' | 'F', club: string, dept: string, extra: Partial<P> = {}): P => {
  n++
  return { id: `p${n}`, firstName: `Prénom${n}`, lastName: `NOM${n}`, birthDate: `${birth}-03-01`, sex, club, department: dept, ...extra }
}
const players: P[] = [
  // Alpha (83) : trois 2010 vus, aucun 2011.
  pl('2010', 'M', 'Club Alpha', '83', { laterality: 'gaucher' }),
  pl('2010', 'M', 'Club Alpha', '83'),
  pl('2010', 'F', 'Club Alpha', '83', { laterality: 'gaucher' }),
  // Beta (83) : trois 2010 vus et une 2011 vue.
  pl('2010', 'M', 'Club Beta', '83'),
  pl('2010', 'M', 'Club Beta', '83', { laterality: 'droitier' }),
  pl('2010', 'M', 'Club Beta', '83'),
  pl('2011', 'F', 'Club Beta', '83', { laterality: 'gaucher' }),
  // Gamma (06) : un 2010 vu, une 2011 pas encore vue.
  pl('2010', 'M', 'Club Gamma', '06', { laterality: 'gaucher' }),
  pl('2011', 'F', 'Club Gamma', '06'),
  // Delta (35) : un 2012.
  pl('2012', 'F', 'Club Delta', '35'),
]
const seenIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']
const data: QData<P> = {
  players,
  sights: seenIds.map((playerId) => ({ playerId, day: '2026-09-20', event: 'ev1', person: 'u1' })),
  evals: [],
  measures: [],
  criteria: ctx.criteria,
  groups: [],
  events: [],
  deptOf: (p) => p.department,
  regionOf: (d) => REGIONS[d],
  zoneOf: () => null,
  today: TODAY,
}
const ix = buildIndex(data)
const names: Names = {
  position: (c) => c,
  region: (id) => id,
  dept: (c) => c,
  club: (k) => k,
  group: (id) => id,
  event: (id) => id,
  criterion: (id) => id,
  category: (x) => x,
  today: TODAY,
} as unknown as Names

/** Comme la page de réponse (src/pages/Question.tsx) : relecture, relecture d'après la phrase, statut du journal. */
function ask(phrase: string, raw: unknown, nonGere: string[] = [], prev: Recipe | null = null) {
  const heard = correctQuestionPhrase(phrase)
  const it = rescueInterpretation(interpretRecipe(raw, nonGere, ctx, heard), heard, ctx, { prev })
  const status = answersNothing(it.recipe, it.unsupported) ? 'pas_comprise' : it.notes.length || it.unsupported.length ? 'partielle' : 'complete'
  return { ...it, status, answer: runRecipe(ix, it.recipe) }
}

// ---------- 1. Doublons ----------
{
  const d = makeLogDeduper(2000)
  const t0 = 1_000_000
  const phrase = 'Donne-moi la liste des gauchers de plus d’un mètre quatre-vingt.'
  assert.equal(d.seen(phrase, 'question', t0), undefined)
  d.add(phrase, 'question', 'id-1', t0)
  // La même phrase 0,1 s plus tard (majuscules, ponctuation, espaces près) : la même ligne.
  assert.equal(d.seen('donne-moi la liste des gauchers de plus d’un mètre quatre-vingt', 'question', t0 + 100), 'id-1')
  assert.equal(d.seen(phrase, 'joueurs', t0 + 100), undefined, 'autre page : une autre ligne')
  assert.equal(d.seen(phrase, 'question', t0 + 2500), undefined, 'reposée plus tard : une nouvelle ligne')
  assert.equal(d.seen('Combien y a-t-il de licenciés ?', 'question', t0 + 100), undefined, 'autre phrase')
}

// ---------- 2. Latéralité seule ----------
{
  // Constat : recette vide et « lateralite seul » dans nonGere → « pas comprise ».
  for (const raw of [{}, { sortie: { type: 'nombre' } }]) {
    const a = ask('Combien y a-t-il de gauchers ?', raw, ['lateralite seul'])
    assert.equal(a.status, 'complete', 'la latéralité seule suffit')
    assert.equal(a.recipe.pop.hand, 'gaucher')
    assert.equal(a.recipe.out.type, 'count')
    assert.deepEqual(a.unsupported, [])
    assert.equal(a.answer.count, 4)
  }
  // Liste.
  const l = ask('Donne-moi la liste des gauchères', { sortie: { type: 'liste' } }, ['latéralité seule'])
  assert.equal(l.status, 'complete')
  assert.equal(l.recipe.pop.hand, 'gaucher')
  assert.equal(l.recipe.out.type, 'list')
  // Liste Joueurs (filtres) : la latéralité est posée aussi.
  const j = rescueInterpretation(interpretRecipe({}, ['lateralite seul'], ctx), 'les droitiers', ctx, { scope: 'liste' })
  assert.equal(j.recipe.pop.hand, 'droitier')
  assert.deepEqual(j.unsupported, [])
  // « ailier gauche » n'est pas une latéralité.
  assert.equal(ask('les ailiers gauche', {}).recipe.pop.hand, undefined)
}

// ---------- 3. Nombre de clubs ----------
{
  const cases: [string, unknown, string[]][] = [
    ['Combien y a-t-il de clubs répertoriés dans la base de données ?', {}, ['clubs répertoriés dans la base de données']],
    ['Combien y a-t-il de clubs en France ?', { population: { pays: 'France' }, sortie: { type: 'nombre' } }, []],
    ['Donne-moi le nombre de clubs qu’il y a dans la fédération.', { population: { regions: ['fédération'] } }, ['nombre de clubs']],
  ]
  for (const [phrase, raw, nonGere] of cases) {
    const a = ask(phrase, raw, nonGere)
    assert.equal(a.status, 'complete', phrase)
    assert.deepEqual(a.recipe.out, { type: 'table', groupBy: 'club', countRows: true }, phrase)
    assert.deepEqual(a.recipe.pop, {}, `${phrase} : toute la France (le périmètre de l’utilisateur)`)
    assert.equal(a.answer.table!.filter((x) => x.key).length, 4, phrase)
    assert.equal(goesToBilan(a.recipe), false, 'reste sur la page de réponse (le nombre)')
  }
  const v = ask('Combien de clubs dans le Var ?', { population: { departements: ['Var'] }, sortie: { type: 'nombre' } })
  assert.equal(v.answer.table!.length, 2)
  // Pastille, adresse, retrait.
  const r = ask('le nombre de clubs', {}).recipe
  assert.ok(recipeChips(r, names).some((c) => c.label === 'nombre de clubs'))
  assert.deepEqual(decodeRecipe(encodeRecipe(r)), r)
  assert.equal(removeChip(r, 'countRows').out.countRows, undefined)
  assert.equal(cleanRecipe({ ...r, out: { type: 'list', countRows: true } }).out.countRows, undefined, 'tableaux seulement')
  // « combien de joueurs par club » : pas un nombre de clubs.
  assert.equal(ask('combien de joueurs par club', { sortie: { type: 'tableau', par: 'club' } }).recipe.out.countRows, undefined)
}

// ---------- 4. Licenciés ----------
{
  const top = ask('Quel club en France a le plus de licenciés ?', {}, ['licenciés : pas dans les données'])
  assert.equal(top.status, 'complete')
  assert.deepEqual(top.recipe.out, { type: 'table', groupBy: 'club', sort: { by: 'count', dir: 'desc' }, limit: 1 })
  assert.deepEqual(top.answer.table!.map((x) => [x.key, x.match]), [['club beta', 4]])
  const ranked = ask('Les clubs classés par nombre de licenciés', {}, ['licenciés'])
  assert.equal(ranked.status, 'complete')
  assert.deepEqual(ranked.answer.table!.map((x) => x.key), ['club beta', 'club alpha', 'club gamma', 'club delta'])
  const count = ask('Combien y a-t-il de licenciés ?', { sortie: { type: 'nombre' } }, ['licenciés : pas dans les données'])
  assert.equal(count.status, 'complete')
  assert.equal(count.answer.count, players.length, 'chaque joueur de la base est licencié')
}

// ---------- 5. « au moins N … et aucun … » par club ----------
{
  const phrase = 'Quels clubs ont au moins 3 joueurs vus en 2010 mais aucun joueur vu né en 2011 ?'
  const raws: [unknown, string[]][] = [
    [{ population: { annee: 2010 }, vus: { op: '>=', n: 3 }, sortie: { type: 'tableau', par: 'club' } }, ['aucun joueur vu né en 2011']],
    [{ vus: { op: '>=', n: 1, periode: 'depuis', depuis: '2010-01-01' }, sortie: { type: 'tableau', par: 'club' } }, ['aucun joueur vu né en 2011']],
    [{}, ['au moins 3 joueurs vus en 2010', 'aucun joueur vu né en 2011']],
  ]
  for (const [raw, nonGere] of raws) {
    const a = ask(phrase, raw, nonGere)
    assert.equal(a.status, 'complete', JSON.stringify(raw))
    assert.equal(a.recipe.out.minMatch, 3)
    assert.deepEqual(a.recipe.out.noneYears, [2011])
    assert.deepEqual(a.recipe.pop.years, [2010, 2010])
    assert.deepEqual(a.recipe.seen, { by: 'event', op: 'gte', n: 1, period: { kind: 'season' } })
    assert.deepEqual(a.answer.table!.map((x) => [x.key, x.match]), [['club alpha', 3]], 'Beta a une 2011 vue ; Gamma un seul 2010')
    assert.equal(goesToBilan(a.recipe), false)
  }
  const r = ask(phrase, {}).recipe
  const chips = recipeChips(r, names).map((c) => c.label)
  assert.ok(chips.includes('au moins 3 joueurs') && chips.includes('et aucun né en 2011 qui répond'), chips.join(' | '))
  assert.deepEqual(decodeRecipe(encodeRecipe(r)), r)
  // Sans condition « vu » : une 2011 pas encore vue (Gamma) n'empêche que si elle répond.
  const plain = runRecipe(ix, cleanRecipe({ pop: { years: [2010, 2010] }, avis: [], measures: [], out: { type: 'table', groupBy: 'club', noneYears: [2011] } }))
  assert.deepEqual(plain.table!.map((x) => x.key), ['club alpha'])
}

// ---------- 6. Suite de la question précédente ----------
{
  const first = ask('J’aimerais voir le nombre de joueurs vus dans les Alpes-Maritimes nés en 2010', {
    population: { departements: ['Alpes-Maritimes'], annee: 2010 },
    vus: { op: '>=', n: 1 },
    sortie: { type: 'nombre' },
  })
  assert.equal(first.answer.count, 1)
  const prev = first.recipe
  // La recette du modèle (seulement le lieu), ou rien du tout : la phrase suffit.
  for (const raw of [{ population: { departements: ['Var'] } }, {}]) {
    const a = ask('La même chose que la question précédente, mais seulement dans le Var.', raw, ['la même chose que la question précédente'], prev)
    assert.equal(a.status, 'complete', JSON.stringify(raw))
    assert.equal(a.followUp, true)
    assert.deepEqual(a.recipe.pop.depts, ['83'])
    assert.deepEqual(a.recipe.pop.years, [2010, 2010], 'années gardées')
    assert.equal(a.recipe.out.type, 'count', 'sortie gardée')
    assert.ok(a.recipe.seen)
    assert.equal(a.answer.count, 6)
  }
  // Dictée : « vœu » entendu pour « Var ».
  const v = ask('La même chose, mais seulement dans le vœu.', {}, [], prev)
  assert.deepEqual(v.recipe.pop.depts, ['83'])
  const y = ask('et en 2011', {}, [], prev)
  assert.deepEqual(y.recipe.pop.years, [2011, 2011])
  assert.deepEqual(y.recipe.pop.depts, ['06'], 'lieu gardé')
  assert.ok(y.recipe.seen && y.recipe.seen.period.kind === 'season', '« en 2011 » : une année de naissance, pas une période')
  const f = ask('pareil pour les filles', {}, [], prev)
  assert.equal(f.recipe.pop.sex, 'F')
  assert.deepEqual(f.recipe.pop.depts, ['06'])
  // Forme dite : elle remplace celle d'avant.
  assert.equal(ask('pareil mais la liste', { sortie: { type: 'liste' } }, [], prev).recipe.out.type, 'list')
  // Sans question précédente : rien de fusionné.
  assert.equal(ask('et en 2011', {}, [], null).followUp, undefined)
  assert.equal(isFollowUp('Combien de gardiens nés en 2011 ?'), false)
  // Dernière recette de la session.
  const store = new Map<string, string>()
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
  assert.equal(lastRecipe(), null)
  rememberRecipe(prev)
  assert.deepEqual(lastRecipe(), prev)
}

// ---------- 7. Dictée ----------
{
  assert.equal(correctQuestionPhrase('Les joueurs du vœu nés en 2011'), 'Les joueurs du Var nés en 2011')
  assert.equal(correctQuestionPhrase('dans le Voeu ?'), 'dans le Var ?')
  assert.equal(correctQuestionPhrase('les clubs des vœux'), 'les clubs des Var')
  assert.equal(correctQuestionPhrase('Combien de joueurs ?'), 'Combien de joueurs ?')
  // La dictée d'un commentaire n'est pas touchée (le mot « vœu » reste ailleurs).
  assert.match(clean('son vœu est de jouer au pôle'), /vœu/)
  assert.equal(incompletePhrase('La carte sur.'), 'Phrase incomplète : tu voulais la carte de… ?')
  assert.equal(incompletePhrase('Les joueurs du'), 'Phrase incomplète : tu voulais « Les joueurs du… » ?')
  assert.equal(incompletePhrase('La carte des joueurs vus.'), null)
  assert.equal(incompletePhrase('les 2010 et plus'), null)
  assert.equal(incompletePhrase('Combien y a-t-il de licenciés ?'), null)
}

// ---------- 8. Anonymisation ----------
{
  const an = buildAnonymizer({
    players: [
      { firstName: 'Raphaël', lastName: 'Saint' },
      { firstName: 'Mais', lastName: 'Sein' },
      { firstName: 'Du', lastName: 'Deux' },
      { firstName: 'Léo', lastName: 'Li' },
      { firstName: 'Lucas', lastName: 'Martin' },
    ],
    keep: ['Saint-Raphaël Var Handball'],
  })
  const said = 'Mais y a-t-il deux joueurs au sein du Saint-Raphaël Var Handball ?'
  assert.equal(an.text(said), said, 'mots-outils, nombres et nom de lieu : jamais masqués')
  assert.equal(an.text('les joueurs de Saint Raphaël'), 'les joueurs de Saint Raphaël')
  assert.equal(an.text('les joueurs du Var'), 'les joueurs du Var')
  assert.equal(an.text('Combien de joueurs chez Li ?'), 'Combien de joueurs chez Li ?', 'mot de deux lettres : gardé')
  // Les vrais noms restent masqués.
  assert.equal(an.text('Où joue Lucas Martin ?'), 'Où joue [prénom] [nom] ?')
  assert.equal(an.text('les joueurs comme Léo'), 'les joueurs comme [prénom]')
  // Sans club « Saint-Raphaël » sur l'appareil : le nom de lieu reste gardé, le prénom seul est masqué.
  const an2 = buildAnonymizer({ players: [{ firstName: 'Raphaël', lastName: 'Saint' }] })
  assert.equal(an2.text(said), said)
  assert.equal(an2.text('Raphaël a été vu'), '[prénom] a été vu')
}

console.log('test-recettes-journal : OK')
