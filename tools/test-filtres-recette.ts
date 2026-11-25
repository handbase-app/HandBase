// Test de la liste Joueurs en ÉDITEUR DE RECETTE (src/playerQuery.ts, même moteur que « Poser une question », src/recipe.ts) :
// fusion filtres posés + phrase (ajout par défaut, remplacement et effacement seulement s'ils sont dits, retrait), calcul sur la
// sélection, commandes locales sans appel, détection « simple nom » / phrase, ce qui part au modèle (noms des filtres
// seulement), exemples des consignes « joueurs » de la fonction (chacun relu par l'appli avec l'effet attendu), ÉQUIVALENCE
// des filtres rapides avec l'ancien PlayerFilter (mêmes joueurs retenus, dans le même ordre, sur un jeu fictif), tri et joueurs
// sans valeur en fin de liste, nombres des menus, questions enregistrées, appel avec contexte (faux fetch : rien ne part), et
// performance sur 40 000 fiches fictives (< 150 ms).
//
//   npx jiti tools/test-filtres-recette.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  activeKeys,
  buildPlayersIndex,
  calcRecipe,
  changeText,
  clubPlaces,
  clubsInPlaces,
  cleanQuery,
  decideAction,
  EMPTY_QUERY,
  filterCount,
  isNameQuery,
  keysForModel,
  keysOfWord,
  legacyToQuery,
  listRecipe,
  localQueryCommand,
  mergeQuery,
  missingQuantities,
  needsFullData,
  phraseAction,
  queryFromSaved,
  quickCounts,
  recipeToSave,
  removeKeys,
  selectPlayers,
  type JoueursQuery,
} from '../src/playerQuery'
import { buildQuestionSchema, cleanRecipe, decodeRecipe, encodeRecipe, handsOf, interpretRecipe, orText, parseSaved, putHands, putQuarters, quartersOf, recipeChips, removeChip, runRecipe, toggleIn, type Names, type QCriterion, type QData, type QPlayer, type QuestionContext, type Recipe } from '../src/recipe'
import { EMPTY_FILTERS, type FilterValues } from '../src/voiceSearch'
import { nameTokens, playerHaystack, searchByName } from '../src/nameMatch'
import { understandQuestion, type Endpoint } from '../src/dictation/transcribe'
import type { Laterality, Position } from '../src/db'

const TODAY = '2026-10-14'
const POSITIONS = [
  { id: 'GB' as const, label: 'Gardien' },
  { id: 'AG' as const, label: 'Ailier gauche' },
  { id: 'ARG' as const, label: 'Arrière gauche' },
  { id: 'DC' as const, label: 'Demi-centre' },
  { id: 'ARD' as const, label: 'Arrière droit' },
  { id: 'AD' as const, label: 'Ailier droit' },
  { id: 'PIV' as const, label: 'Pivot' },
]
const REGIONS: Record<string, string> = { '83': 'region-sud', '13': 'region-sud', '75': 'region-idf', '35': 'region-bre' }
const CRITERIA: QCriterion[] = [
  { id: 'taille', label: 'Taille', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'cm' },
  { id: 'sprint_10', label: 'Sprint 10 m', category: 'Vitesse & endurance', kind: 'factual', scale: 'number', unit: 's' },
  { id: 'agressivite', label: 'Agressivité défensive', category: 'Défense', kind: 'subjective', scale: 'score5' },
  { id: 'tir', label: 'Efficacité au tir', category: 'Attaque', kind: 'subjective', scale: 'score5' },
]

// ---------- Jeu fictif (aucun nom réel) ----------
type P = QPlayer & { department?: string; team?: string; license?: string }
const FIRST = ['Lucas', 'Léa', 'Jean-Pierre', 'Inès', 'Hugo', 'Zoé', 'Noah', 'Jade', 'Tom', 'Lina']
const LAST = ['Martin', 'Dupont', 'Fictif', 'Exemple', 'De La Cruz', 'Imaginaire', 'Durand', 'Petit', 'Moreau', 'Lefèvre']
const CLUBS = ['HBC Exemple', 'AS Fictive', 'Handball Imaginaire', 'Entente du Nord Fictif']
const DEPTS = ['83', '83', '13', '75']
const POS: (Position | undefined)[] = ['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV', undefined]
const HANDS: (Laterality | undefined)[] = ['droitier', 'gaucher', 'ambidextre', undefined]
let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
function makePlayers(n: number): P[] {
  return Array.from({ length: n }, (_, i) => {
    const c = Math.floor(rnd() * CLUBS.length)
    const position = pick(POS)
    return {
      id: `p${i}`,
      firstName: pick(FIRST),
      lastName: `${pick(LAST)}${n > 1000 ? '' : ''}`,
      birthDate: `${2008 + Math.floor(rnd() * 6)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`,
      sex: rnd() < 0.5 ? 'M' : 'F',
      club: CLUBS[c],
      department: DEPTS[c],
      position,
      secondaryPositions: rnd() < 0.3 ? [pick(POS.filter((x): x is Position => !!x))] : undefined,
      laterality: pick(HANDS),
      poles: rnd() < 0.1 ? [{ from: rnd() < 0.5 ? '2025-09-01' : '2020-09-01', to: rnd() < 0.5 ? undefined : '2022-06-30', site: 'Fictiville' }] : undefined,
      license: `638301${String(1000000 + i).slice(-7)}`,
    }
  })
}
const players = makePlayers(400).sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.id.localeCompare(b.id))
const measures = players.filter(() => rnd() < 0.7).map((p, i) => ({ playerId: p.id, criterionId: 'taille', value: 150 + Math.floor(rnd() * 50), date: `2026-0${1 + (i % 9)}-01` }))
const sprint = players.filter(() => rnd() < 0.4).map((p) => ({ playerId: p.id, criterionId: 'sprint_10', value: 1.7 + Math.round(rnd() * 60) / 100, date: '2026-05-01' }))
const groups = [
  { id: 'g-ic', playerIds: players.filter(() => rnd() < 0.2).map((p) => p.id) },
  { id: 'g-pole', playerIds: players.filter(() => rnd() < 0.1).map((p) => p.id) },
]
const followed = new Set(players.filter(() => rnd() < 0.15).map((p) => p.id))
const videos = new Set(players.filter(() => rnd() < 0.15).map((p) => p.id))
const profileMembers = new Map([['a-1', new Set(players.filter(() => rnd() < 0.25).map((p) => p.id))]])
const sights = players.filter(() => rnd() < 0.3).map((p, i) => ({ playerId: p.id, day: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, event: `ev${i % 5}`, person: `u${i % 3}` }))
const evals = players
  .filter(() => rnd() < 0.3)
  .map((p, i) => ({ playerId: p.id, observer: `u${i % 3}`, day: '2026-09-15', scores: { agressivite: 1 + Math.floor(rnd() * 5), tir: 1 + Math.floor(rnd() * 5) } as Record<string, number> }))
const data: QData<P> = {
  players,
  sights,
  evals,
  measures: [...measures, ...sprint],
  criteria: CRITERIA,
  groups,
  events: [{ id: 'ev0', date: '2026-09-01' }],
  deptOf: (p) => p.department,
  regionOf: (d) => REGIONS[d],
  today: TODAY,
  followed,
  videos,
  profileMembers,
}
const ix = buildPlayersIndex(data)
const hays = new Map<P, string>()
const hay = (p: P) => hays.get(p) ?? (hays.set(p, playerHaystack(p)), hays.get(p)!)
const toks = (p: P) => nameTokens(p)
const ids = (xs: { id: string }[]) => xs.map((p) => p.id)
const sel = (qy: JoueursQuery) => selectPlayers(ix, qy, hay, toks)

const ctx: QuestionContext = {
  regions: [
    { id: 'region-sud', name: 'Région Sud' },
    { id: 'region-idf', name: 'Île-de-France' },
    { id: 'region-bre', name: 'Bretagne' },
  ],
  depts: [
    { code: '83', name: 'Var' },
    { code: '13', name: 'Bouches-du-Rhône' },
    { code: '75', name: 'Paris' },
    { code: '35', name: 'Ille-et-Vilaine' },
  ],
  regionOfDept: (c) => REGIONS[c],
  positions: POSITIONS,
  clubs: [...ix.clubNames].map(([key, name]) => ({ key, name })),
  groups: [
    { id: 'g-ic', name: 'Intercomités' },
    { id: 'g-pole', name: 'Sélection Pôle' },
  ],
  events: [{ id: 'ev0', name: 'Stage de rentrée', date: '2026-09-01' }],
  criteria: CRITERIA,
  today: TODAY,
  profiles: [{ id: 'a-1', name: 'Grands gauchers' }],
}
const names: Names = {
  region: (id) => ctx.regions.find((r) => r.id === id)?.name ?? id,
  dept: (c) => c,
  club: (k) => ix.clubNames.get(k) ?? k,
  group: (id) => ctx.groups.find((g) => g.id === id)?.name ?? 'groupe',
  event: (id) => ctx.events.find((e) => e.id === id)?.name ?? 'événement',
  criterion: (id) => CRITERIA.find((c) => c.id === id)?.label ?? 'critère',
  unit: (id) => CRITERIA.find((c) => c.id === id)?.unit,
  position: (id) => POSITIONS.find((p) => p.id === id)?.label ?? id,
  profile: (id) => ctx.profiles?.find((p) => p.id === id)?.name ?? 'profil',
  today: TODAY,
}

/** Ce que fait l'écran d'une réponse du modèle (src/components/PlayersQuery.tsx) : relecture, action, fusion. */
function phrase(current: JoueursQuery, said: string, answer: { recette: unknown; action?: string; retirer?: string[]; nonGere?: string[] }) {
  const local = localQueryCommand(said)
  if (local) return { qy: local.action === 'effacer' ? EMPTY_QUERY : removeKeys(current, local.keys), unsupported: [] as string[], local: true }
  const it = interpretRecipe(answer.recette, answer.nonGere ?? [], ctx)
  const action = decideAction(answer.action, said)
  const remove = (answer.retirer ?? []).flatMap(keysOfWord)
  const qy = mergeQuery(current, it.recipe, action, remove, (d) => REGIONS[d])
  const unsupported = [...it.unsupported, ...(action !== 'retirer' ? missingQuantities(said, qy, ctx) : [])]
  return { qy, unsupported, notes: it.notes, local: false }
}
const withPop = (pop: Recipe['pop'], q = ''): JoueursQuery => ({ recipe: listRecipe(cleanRecipe({ pop })), q })

// ---------- 1. Combinaison filtres posés + phrase (règle demandée par Geoffroy) ----------
{
  // « Garçons » coché à la main, puis « nés en 2010 de plus d'1 m 85 » : garçons + 2010 + ≥ 185.
  const r = phrase(withPop({ sex: 'M' }), 'nés en 2010 de plus d’1 m 85', { recette: { population: { annee: 2010, tailleMin: 185 } }, action: 'ajouter' })
  assert.deepEqual(r.qy.recipe.pop, { sex: 'M', years: [2010, 2010], hMin: 185 })
  assert.deepEqual(r.unsupported, [])
  // Le modèle dit « remplacer » sans que la phrase le dise : on AJOUTE quand même.
  const r2 = phrase(withPop({ sex: 'M', depts: ['83'] }), 'les gauchers', { recette: { population: { lateralite: 'gaucher' } }, action: 'remplacer' })
  assert.deepEqual(r2.qy.recipe.pop, { sex: 'M', depts: ['83'], hand: 'gaucher' }, 'ajout par défaut')
  // Ancienne fonction (pas d'action) : ajout aussi.
  const r3 = phrase(withPop({ years: [2011, 2011] }), 'les pivots', { recette: { population: { postes: ['PIV'] } } })
  assert.deepEqual(r3.qy.recipe.pop, { years: [2011, 2011], positions: ['PIV'] })
  // « seulement les filles » remplace la clé sexe, garde le reste.
  const r4 = phrase(withPop({ sex: 'M', years: [2010, 2010] }), 'seulement les filles', { recette: { population: { sexe: 'F' } }, action: 'ajouter' })
  assert.deepEqual(r4.qy.recipe.pop, { sex: 'F', years: [2010, 2010] })
  // « efface les filtres et montre les gardiens » : effacement dit → seulement les gardiens (le nom cherché part aussi).
  const r5 = phrase(withPop({ sex: 'M', years: [2010, 2010] }, 'Martin'), 'efface les filtres et montre les gardiens', { recette: { population: { postes: ['GB'] } }, action: 'ajouter' })
  assert.deepEqual([r5.qy.recipe.pop, r5.qy.q], [{ positions: ['GB'] }, ''])
  // « recommence avec les 2012 » : idem.
  assert.equal(phraseAction('recommence avec les 2012'), 'effacer')
  assert.equal(phraseAction('alors efface tout et dis-moi la taille moyenne des joueurs'), 'effacer')
  assert.equal(phraseAction('les gardiens qui ont effacé leur retard'), 'ajouter')
  // « enlève la taille » : retrait, sans appel.
  const loc = localQueryCommand('enlève la taille')
  assert.deepEqual(loc, { action: 'retirer', keys: ['height'] })
  assert.deepEqual(localQueryCommand('peu importe le poste'), { action: 'retirer', keys: ['positions'] })
  assert.deepEqual(localQueryCommand("sans l'année"), { action: 'retirer', keys: ['years'] })
  assert.deepEqual(localQueryCommand('enlève la taille et le club'), { action: 'retirer', keys: ['height', 'clubs'] })
  assert.deepEqual(localQueryCommand('efface tout'), { action: 'effacer' })
  assert.deepEqual(localQueryCommand('réinitialise'), { action: 'effacer' })
  assert.deepEqual(localQueryCommand('recommence'), { action: 'effacer' })
  assert.equal(localQueryCommand('enlève les joueurs du Var qui sont grands'), null, 'phrase compliquée : au modèle')
  const r6 = phrase(withPop({ years: [2010, 2010], hMin: 180 }), 'enlève la taille', { recette: {} })
  assert.ok(r6.local)
  assert.deepEqual(r6.qy.recipe.pop, { years: [2010, 2010] })
  // Retrait rendu par le modèle (clé de « actuels » ou critère nommé : « retire le Var »).
  const r7 = phrase(withPop({ years: [2010, 2010], depts: ['83'] }), 'retire le Var de la recherche', { recette: { population: { departements: ['Var'] } }, action: 'retirer' })
  assert.deepEqual(r7.qy.recipe.pop, { years: [2010, 2010] })
  const r8 = phrase(withPop({ years: [2010, 2010], positions: ['DC'] }), 'sans condition d’année mais des pivots', { recette: { population: { postes: ['PIV'] } }, action: 'ajouter', retirer: ['annee'] })
  assert.deepEqual(r8.qy.recipe.pop, { positions: ['PIV'] })
  // Lieux : un nouveau département d'une autre région écarte la région ; de la même région, la garde.
  assert.deepEqual(mergeQuery(withPop({ regions: ['region-idf'] }), cleanRecipe({ pop: { depts: ['83'] } }), 'ajouter', [], (d) => REGIONS[d]).recipe.pop, { depts: ['83'] })
  assert.deepEqual(mergeQuery(withPop({ regions: ['region-sud'] }), cleanRecipe({ pop: { depts: ['83'] } }), 'ajouter', [], (d) => REGIONS[d]).recipe.pop, { regions: ['region-sud'], depts: ['83'] })
  // Taille : un nouveau minimum au-dessus du maximum posé retire ce maximum.
  assert.deepEqual(mergeQuery(withPop({ hMax: 170 }), cleanRecipe({ pop: { hMin: 185 } }), 'ajouter').recipe.pop, { hMin: 185 })
  // Notes : même cible remplacée, autre cible ajoutée ; mesures pareil.
  const avis1 = cleanRecipe({ avis: [{ target: { on: 'category', name: 'Défense' }, op: 'gte', value: 3 }] })
  const m1 = mergeQuery({ recipe: listRecipe(avis1), q: '' }, cleanRecipe({ avis: [{ target: { on: 'category', name: 'Défense' }, op: 'gte', value: 4 }] }), 'ajouter')
  assert.deepEqual(m1.recipe.avis.map((a) => a.value), [4])
  const m2 = mergeQuery(m1, cleanRecipe({ avis: [{ target: { on: 'category', name: 'Attaque' }, op: 'gte', value: 3 }] }), 'ajouter')
  assert.equal(m2.recipe.avis.length, 2)
  // Tri dit : remplace le tri d'avant, les filtres restent.
  const m3 = mergeQuery(withPop({ sex: 'F' }), cleanRecipe({ out: { type: 'list', sort: { by: 'height', dir: 'desc' } } }), 'ajouter')
  assert.deepEqual([m3.recipe.pop, m3.recipe.out.sort], [{ sex: 'F' }, { by: 'height', dir: 'desc' }])
  // Ligne de résultat : Ajouté / Retiré / Remplacé.
  const before = withPop({ sex: 'M', years: [2010, 2010], hMin: 180 })
  const after = mergeQuery(removeKeys(before, ['height']), cleanRecipe({ pop: { years: [2011, 2011], hand: 'gaucher' } }), 'ajouter')
  const ch = changeText(recipeChips(before.recipe, names), recipeChips(after.recipe, names))
  assert.deepEqual([ch.added, ch.removed, ch.replaced], [['gauchers'], ['taille ≥ 180 cm'], ['nés en 2011']])
  assert.equal(ch.text, 'Ajouté : gauchers — Remplacé : nés en 2011 — Retiré : taille ≥ 180 cm')
  assert.equal(changeText(recipeChips(before.recipe, names), recipeChips(before.recipe, names), 'Martin', '').text, 'Retiré : recherche « Martin »')
}

// ---------- 2. Calcul sur la sélection ----------
{
  const cur = withPop({ sex: 'M', years: [2010, 2010] })
  const r = phrase(cur, 'quelle est la taille moyenne ?', { recette: { sortie: { type: 'nombre', valeur: 'moyenne_mesure', mesure: 'Taille' } }, action: 'ajouter' })
  assert.deepEqual(r.qy.recipe.pop, cur.recipe.pop, 'la liste reste filtrée')
  assert.deepEqual(r.unsupported, [], 'taille moyenne calculée : rien de « pas pris en compte »')
  const calc = calcRecipe(r.qy)!
  const ans = runRecipe(ix, calc)
  const listed = sel(r.qy).list
  assert.equal(ans.count, listed.length, 'calcul sur les joueurs de la liste')
  const hs = listed.map((p) => ix.last.get('taille')?.get(p.id)).filter((v): v is number => v !== undefined)
  assert.ok(Math.abs((ans.stat!.avg ?? 0) - hs.reduce((a, b) => a + b, 0) / hs.length) < 1e-9, 'moyenne des tailles de la sélection')
  assert.equal(ans.stat!.n, hs.length)
  // « combien sont-ils par club ? » : tableau sur la sélection.
  const t = phrase(r.qy, 'combien sont-ils par club ?', { recette: { sortie: { type: 'tableau', par: 'club' } }, action: 'ajouter' })
  assert.equal(t.qy.calc?.type, 'table')
  const tab = runRecipe(ix, calcRecipe(t.qy)!)
  assert.equal(tab.table!.reduce((n, x) => n + x.match, 0), listed.length)
  // « efface tout et dis-moi la taille moyenne des joueurs » : filtres vidés, calcul sur tous.
  const e = phrase(cur, 'efface tout et dis-moi la taille moyenne des joueurs', {
    recette: { sortie: { type: 'nombre', valeur: 'moyenne_mesure', mesure: 'Taille' } },
    action: 'effacer',
  })
  assert.deepEqual(e.qy.recipe.pop, {})
  assert.equal(runRecipe(ix, calcRecipe(e.qy)!).count, ix.players.length)
  // Grandeur demandée non calculée (moyenne d'avis à la place de la taille) : « Pas pris en compte » (mode avancé).
  const bad = phrase(cur, 'quelle est la taille moyenne ?', { recette: { sortie: { type: 'nombre', valeur: 'moyenne' } }, action: 'ajouter' })
  assert.deepEqual(bad.unsupported, ['moyenne de taille : pas calculée par la recette'])
  // Taille déjà dans les filtres : « trie-les par taille » n'est pas signalé ; le retrait non plus.
  assert.deepEqual(phrase(withPop({ hMin: 180 }), 'classe-les par taille', { recette: { sortie: { type: 'liste', tri: 'taille' } } }).unsupported, [])
  // Tri par taille avec un calcul (par club) déjà affiché : la taille est dans la liste, rien à signaler.
  assert.deepEqual(phrase(t.qy, 'classe-les par taille', { recette: { sortie: { type: 'liste', tri: 'taille' } } }).unsupported, [])
  // Carte demandée : tableau par département sur la sélection.
  assert.deepEqual(phrase(cur, 'montre la carte', { recette: { sortie: { type: 'carte' } } }).qy.calc, { type: 'table', groupBy: 'dept' })
}

// ---------- 3. Simple nom ou phrase ----------
for (const s of ['Martin', 'martin', 'jean-pierre', 'Jean Pierre', 'De La Cruz', 'Jean Pierre Martin', 'Lefèvre', '638 301 500 1234', '6383015001234', '', '  ', "N'Diaye"])
  assert.ok(isNameQuery(s), `nom : « ${s} »`)
for (const s of ['nés en 2010', '2010', 'les gauchers', 'quelle est la taille moyenne ?', 'combien sont-ils', 'garçons', 'Martin 2010', 'les filles du Var', 'efface tout', 'enlève la taille', 'gardiens de plus d’1m85', 'trie par taille'])
  assert.ok(!isNameQuery(s), `phrase : « ${s} »`)

// ---------- 4. Ce qui part au modèle : noms des filtres, jamais leurs valeurs ni un nom ----------
{
  const qy: JoueursQuery = { recipe: listRecipe(cleanRecipe({ pop: { sex: 'F', depts: ['83'], clubs: ['hbc exemple'], names: ['Lucas'], hMin: 180 }, out: { type: 'list', sort: { by: 'height', dir: 'desc' } } })), q: 'Dupont' }
  const keys = keysForModel(qy)
  assert.deepEqual(keys, ['sexe', 'noms', 'departements', 'clubs', 'taille', 'tri', 'recherche'])
  for (const x of ['Dupont', 'Lucas', '83', 'hbc', 'F', '180']) assert.ok(!JSON.stringify(keys).includes(x), x)
  // Clés du modèle relues dans « retirer ».
  for (const k of keys) assert.ok(keysOfWord(k).length, k)
  assert.deepEqual(activeKeys(EMPTY_QUERY), [])
}

// ---------- 5. Exemples des consignes « joueurs » de la fonction ----------
{
  const fn = readFileSync(new URL('../supabase/functions/transcrire/index.ts', import.meta.url), 'utf8')
  const block = fn.slice(fn.indexOf('const CONSIGNES_JOUEURS'), fn.indexOf('const CONSIGNES_LISTE'))
  const lines = [...block.matchAll(/^Actuels (\[[^\]]*\]) ; « (.+?) » → (\{.+\})`?$/gm)]
  assert.ok(lines.length >= 8, 'exemples présents')
  // Une valeur fictive pour chaque clé de « actuels ».
  const value: Record<string, Recipe['pop']> = { sexe: { sex: 'M' }, annee: { years: [2011, 2011] }, taille: { hMin: 180 }, departements: { depts: ['83'] }, postes: { positions: ['DC'] } }
  const expect: Record<string, (q: JoueursQuery, unsupported: string[]) => void> = {
    "nés en 2010 de plus d'1 m 85": (q) => assert.deepEqual(q.recipe.pop, { sex: 'M', years: [2010, 2010], hMin: 185 }),
    'quelle est la taille moyenne ?': (q, u) => (assert.deepEqual(q.recipe.pop, { sex: 'M', years: [2011, 2011] }), assert.equal(q.calc?.value, 'measure'), assert.deepEqual(u, [])),
    'enlève la taille': (q) => assert.deepEqual(q.recipe.pop, { years: [2011, 2011] }),
    'seulement les filles': (q) => assert.deepEqual(q.recipe.pop, { sex: 'F', years: [2011, 2011] }),
    'efface tout et dis-moi la taille moyenne des joueurs': (q, u) => (assert.deepEqual(q.recipe.pop, {}), assert.equal(q.calc?.measure, 'taille'), assert.deepEqual(u, [])),
    'combien sont-ils par club ?': (q) => assert.deepEqual([q.recipe.pop, q.calc?.type, q.calc?.groupBy], [{ years: [2011, 2011] }, 'table', 'club']),
    'les gauchers vus au moins deux fois, classés par taille': (q, u) => (
      assert.deepEqual(q.recipe.pop, { hand: 'gaucher' }), assert.equal(q.recipe.seen?.n, 2), assert.deepEqual(q.recipe.out.sort, { by: 'height', dir: 'desc' }), assert.deepEqual(u, [])
    ),
    'peu importe le poste, mais au Pôle': (q) => assert.deepEqual(q.recipe.pop, { pole: 'current' }),
    'mes à revoir du mois dernier': (q, u) => (assert.deepEqual(q.recipe.pop, { rewatch: { by: 'me', when: { kind: 'lastMonth' } } }), assert.deepEqual(u, [])),
    "ceux que j'ai mis à revoir au stage de rentrée, pas encore revus": (q, u) => (
      assert.deepEqual(q.recipe.pop, { sex: 'M', rewatch: { by: 'me', from: ['ev0'], state: 'open' } }), assert.deepEqual(u, [])
    ),
  }
  for (const [, actuels, said, json] of lines) {
    const ans = JSON.parse(json) as { action: string; recette: unknown; retirer: string[]; nonGere: string[] }
    const cur = withPop(Object.assign({}, ...(JSON.parse(actuels) as string[]).map((k) => value[k] ?? {})))
    assert.deepEqual(keysForModel(cur), JSON.parse(actuels), `actuels de « ${said} »`)
    const r = phrase(cur, said, ans)
    assert.ok(expect[said], `effet attendu de « ${said} »`)
    expect[said](r.qy, r.unsupported)
  }
  assert.ok(fn.includes("'question', 'question_joueurs', 'question_evenements', 'question_groupes', 'sql'"), 'GET : la fonction annonce le contexte joueurs')
  assert.ok(fn.includes("Object.hasOwn(CONTEXTES, entree.contexte)") && fn.includes("const joueurs = contexte === 'joueurs'"), 'contexte joueurs seulement sur demande (rétrocompatible)')
}

// ---------- 6. Équivalence des filtres rapides avec l'ancien PlayerFilter ----------
// Copie fidèle de l'ancien calcul (src/components/PlayerFilter.tsx avant la recette) : groupe, profil, suivis, Pôle, vidéo,
// puis sexe, latéralité, trimestre, taille ; région, département, club, année ; recherche par nom ; poste.
function legacy(list0: P[], v: FilterValues): P[] {
  const pole = (p: P) => {
    const ps = (p.poles ?? []).filter((x) => x.from || x.to || x.name || x.regionId || x.site)
    if (!ps.length) return undefined
    return ps.some((x) => (!x.from || x.from <= TODAY) && (!x.to || x.to >= TODAY)) ? 'current' : 'past'
  }
  const quarter = (b?: string) => {
    const m = b && /^\d{4}-\d{2}/.test(b) ? Number(b.slice(5, 7)) : 0
    return m >= 1 && m <= 12 ? Math.ceil(m / 3) : null
  }
  const lastH = new Map<string, { v: number; date: string }>()
  for (const m of measures) {
    const cur = lastH.get(m.playerId)
    if (!cur || m.date > cur.date) lastH.set(m.playerId, { v: m.value, date: m.date })
  }
  let list = list0
  if (v.followedOnly) list = list.filter((p) => followed.has(p.id))
  if (v.pole) list = list.filter((p) => (v.pole === 'any' ? !!pole(p) : pole(p) === v.pole))
  if (v.videoOnly) list = list.filter((p) => videos.has(p.id))
  if (v.group) {
    const g = new Set(groups.find((x) => x.id === v.group)?.playerIds ?? [])
    list = list.filter((p) => g.has(p.id))
  }
  if (v.profile) list = list.filter((p) => profileMembers.get(v.profile)?.has(p.id))
  const lo = Number(v.minH) || 0
  const base0 = list.filter((p) => {
    if (!((v.sex === 'all' || p.sex === v.sex) && (v.hand === 'all' || p.laterality === v.hand) && (!v.quarter || quarter(p.birthDate) === v.quarter))) return false
    if (!lo) return true
    const h = lastH.get(p.id)?.v
    return h !== undefined && h >= lo
  })
  const base = v.region ? base0.filter((p) => REGIONS[p.department ?? ''] === v.region) : base0
  const scoped = base.filter((p) => (!v.dept || p.department === v.dept) && (!v.club || p.club === v.club) && (!v.year || !!p.birthDate?.startsWith(v.year)))
  const searched = searchByName(scoped, v.q, hay, toks).list
  return searched.filter((p) => {
    if (v.position === 'none') return !p.position
    if (v.position === 'all') return true
    return p.position === v.position || (v.withSecondary && !!p.secondaryPositions?.includes(v.position))
  })
}
{
  const vals = (): FilterValues => ({
    ...EMPTY_FILTERS,
    q: rnd() < 0.15 ? pick(['Martin', 'jean-pierre', 'Dupond', 'exemple', '6383011000012', 'lea']) : '',
    sex: rnd() < 0.4 ? pick(['M', 'F'] as const) : 'all',
    region: rnd() < 0.2 ? pick(['region-sud', 'region-idf']) : '',
    dept: rnd() < 0.2 ? pick(['83', '13', '75']) : '',
    club: rnd() < 0.2 ? pick(CLUBS) : '',
    year: rnd() < 0.4 ? String(2008 + Math.floor(rnd() * 6)) : '',
    position: rnd() < 0.4 ? pick(['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV', 'none'] as const) : 'all',
    withSecondary: rnd() < 0.3,
    hand: rnd() < 0.3 ? pick(['droitier', 'gaucher', 'ambidextre'] as const) : 'all',
    quarter: rnd() < 0.2 ? 1 + Math.floor(rnd() * 4) : 0,
    minH: rnd() < 0.25 ? String(150 + Math.floor(rnd() * 45)) : '',
    group: rnd() < 0.15 ? pick(['g-ic', 'g-pole']) : '',
    profile: rnd() < 0.1 ? 'a-1' : '',
    followedOnly: rnd() < 0.1,
    pole: rnd() < 0.15 ? pick(['current', 'past', 'any'] as const) : '',
    videoOnly: rnd() < 0.1,
  })
  let nonEmpty = 0
  for (let i = 0; i < 1500; i++) {
    const v = vals()
    const want = ids(legacy(players, v))
    const got = ids(sel(legacyToQuery(v)).list)
    assert.deepEqual(got, want, `mêmes joueurs : ${JSON.stringify(v)}`)
    if (want.length) nonEmpty++
  }
  assert.ok(nonEmpty > 300, `assez de cas avec des joueurs (${nonEmpty})`)
  // Sans filtre : toute la liste, dans l'ordre reçu.
  assert.deepEqual(ids(sel(EMPTY_QUERY).list), ids(players))
  // Noms approchants (« Dupond » trouve « Dupont »), comme avant.
  const near = sel({ ...EMPTY_QUERY, q: 'Dupond' })
  assert.ok(near.approx && near.list.length && near.list.some((p) => p.lastName === 'Dupont'))
}

// ---------- 7. Tri, joueurs sans valeur, nombres des menus, conditions ----------
{
  const byH = sel({ recipe: listRecipe(cleanRecipe({ pop: { sex: 'F' }, out: { type: 'list', sort: { by: 'height', dir: 'desc' } } })), q: '' })
  const f = players.filter((p) => p.sex === 'F')
  assert.equal(byH.list.length, f.length, 'tous les joueurs restent, même sans taille')
  const ranked = byH.list.slice(0, f.length - byH.unranked)
  const hv = ranked.map((p) => ix.last.get('taille')!.get(p.id)!)
  assert.ok(hv.every((h, i) => i === 0 || hv[i - 1] >= h), 'du plus grand au plus petit')
  assert.ok(byH.list.slice(f.length - byH.unranked).every((p) => !ix.last.get('taille')!.has(p.id)), 'sans taille : en fin de liste')
  assert.equal(byH.values.get(ranked[0].id)?.value, hv[0])
  // Nombres des menus : chaque nombre est celui qu'on obtient en choisissant la valeur.
  const qy = withPop({ sex: 'M', depts: ['83'] })
  const c = quickCounts(ix, qy, hay, toks)
  for (const [y, n] of c.years) assert.equal(sel(withPop({ sex: 'M', depts: ['83'], years: [Number(y), Number(y)] })).list.length, n, `année ${y}`)
  for (const [d, n] of c.depts) assert.equal(sel(withPop({ sex: 'M', depts: [d] })).list.length, n, `département ${d}`)
  for (const [k, n] of c.clubs) assert.equal(sel(withPop({ sex: 'M', depts: ['83'], clubs: [k] })).list.length, n, `club ${k}`)
  assert.equal(c.positionTotal, sel(qy).list.length)
  // Conditions de la recette sur la liste : vus, notes, mesures (mêmes résultats que « Poser une question »).
  const cond = listRecipe(cleanRecipe({ seen: { by: 'event', op: 'gte', n: 1, period: { kind: 'season' } }, avis: [{ target: { on: 'category', name: 'Défense' }, op: 'gte', value: 3 }], measures: [{ id: 'sprint_10', op: 'lte', value: 2 }] }))
  assert.deepEqual(new Set(ids(sel({ recipe: cond, q: '' }).list)), new Set(ids(runRecipe(ix, { ...cond, out: { type: 'count' } }).match)))
  assert.ok(needsFullData({ recipe: cond, q: '' }) && !needsFullData(withPop({ sex: 'M', hMin: 180 })), 'données lourdes seulement au besoin')
  // Hors cadre : gardés par l'index de la liste Joueurs (onglet « Hors cadre »).
  const refused = buildPlayersIndex({ ...data, players: [{ ...players[0], review: 'refused' }] })
  assert.equal(refused.players.length, 1)
}

// ---------- 8. Questions enregistrées, session ----------
{
  const qy: JoueursQuery = { recipe: listRecipe(cleanRecipe({ pop: { sex: 'F', years: [2011, 2011] } })), q: 'Martin', calc: { type: 'count', value: 'measure', measure: 'taille' } }
  const saved = recipeToSave(qy)
  assert.deepEqual([saved.out.type, saved.pop.names], ['count', ['Martin']], 'calcul enregistré, le nom cherché devient « prénom ou nom »')
  const back = queryFromSaved(saved)
  assert.deepEqual([back.recipe.out.type, back.calc?.type, back.recipe.pop.sex], ['list', 'count', 'F'])
  assert.deepEqual(recipeToSave({ ...qy, q: '638301', calc: undefined }).pop.names, undefined, 'licence : pas un nom')
  // Session : rien n'y est cru.
  for (const bad of [null, 42, 'x', [], { recipe: { pop: { sex: 'X', years: ['a'] } }, q: 3, calc: { type: 'liste' } }]) {
    const c = cleanQuery(bad)
    assert.deepEqual([c.recipe.pop, c.q, c.calc], [{}, '', undefined])
  }
  assert.deepEqual(cleanQuery(JSON.parse(JSON.stringify(qy))), qy, 'aller-retour par la session')
  // Nouvelles clés de population (filtres rapides) : relues et retirables.
  const quick = cleanRecipe({ pop: { quarter: 2, positions: ['DC'], secondary: true, followed: true, video: true, profiles: ['a-1'], noPosition: true } })
  assert.deepEqual(quick.pop, { positions: ['DC'], profiles: ['a-1'], quarter: 2, secondary: true, followed: true, video: true }, 'sans poste ignoré avec un poste')
  const it = interpretRecipe({ population: { trimestre: 'Q1', suivis: true, avecVideo: 'oui', profils: ['grands gauchers'], sansPoste: true } }, [], ctx)
  assert.deepEqual(it.recipe.pop, { quarter: 1, noPosition: true, followed: true, video: true, profiles: ['a-1'] })
  assert.deepEqual(
    recipeChips(it.recipe, names).map((c) => c.label).slice(0, 5),
    ['Q1 · janv.–mars', 'sans poste', 'mes suivis', 'avec une vidéo', 'profil : Grands gauchers'],
  )
}

// ---------- 9. Appel : contexte « joueurs » (faux fetch, rien ne part) ----------
{
  const calls: { body: Record<string, unknown> }[] = []
  const ep: Endpoint = {
    url: 'https://exemple.invalid/functions/v1/transcrire',
    headers: {},
    uid: 'u',
    fetch: (async (_url: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ recette: { population: { annee: 2010 } }, nonGere: [], action: 'ajouter', retirer: ['taille'], ms: 3 }), { status: 200 })
    }) as unknown as typeof fetch,
  }
  const qy = withPop({ sex: 'M', hMin: 180 }, 'Dupont')
  const ans = await understandQuestion(ep, 'nés en 2010', { population: '…' }, undefined, { contexte: 'joueurs', actuels: keysForModel(qy) })
  assert.deepEqual([ans.action, ans.retirer], ['ajouter', ['taille']])
  assert.deepEqual(calls[0].body, { phrase: 'nés en 2010', schema: { population: '…' }, contexte: 'joueurs', actuels: ['sexe', 'taille', 'recherche'] })
  assert.ok(!JSON.stringify(calls[0].body).includes('Dupont'), 'jamais le nom cherché')
  // Sans contexte (bilan) : comme avant.
  await understandQuestion(ep, 'les 2010', { population: '…' })
  assert.deepEqual(Object.keys(calls[1].body), ['phrase', 'schema'])
}

// ---------- 9 bis. Choix multiples : OU dans un champ, ET entre les champs ----------
{
  // Anciennes valeurs simples (questions enregistrées, adresses, historique) : toujours lues, et réécrites pareil.
  const old = cleanRecipe({ pop: { hand: 'gaucher', quarter: 2, positions: ['AG'] } })
  assert.deepEqual(old.pop, { positions: ['AG'], hand: 'gaucher', quarter: 2 })
  assert.deepEqual([handsOf(old.pop), quartersOf(old.pop)], [['gaucher'], [2]])
  assert.deepEqual(decodeRecipe(encodeRecipe(old))?.pop, old.pop, 'adresse : aller-retour sans changement')
  assert.deepEqual(cleanQuery({ recipe: { pop: { hand: 'droitier', quarter: 4 } }, q: '' }).recipe.pop, { hand: 'droitier', quarter: 4 }, 'session d’avant')
  const saved = parseSaved([{ id: 'q1', name: 'Gauchers T1', recipe: { pop: { hand: 'gaucher', quarter: 1 }, avis: [], measures: [], out: { type: 'list' } }, vars: [], at: 1 }])
  assert.deepEqual(saved[0].recipe.pop, { hand: 'gaucher', quarter: 1 }, 'question enregistrée d’avant')
  // Plusieurs valeurs : une liste (ordre fixe, sans doublon, valeurs inconnues écartées) ; une seule : valeur simple, comme avant.
  assert.deepEqual(cleanRecipe({ pop: { hand: ['ambidextre', 'gaucher', 'gaucher', 'gaucher-gauche'], quarter: [3, 1, 9, '2'] } }).pop, { hand: ['gaucher', 'ambidextre'], quarter: [1, 3] })
  assert.deepEqual(cleanRecipe({ pop: { hand: ['gaucher'], quarter: [2] } }).pop, { hand: 'gaucher', quarter: 2 }, 'une seule valeur : écrite comme avant')
  assert.deepEqual(cleanRecipe({ pop: { hand: [], quarter: [] } }).pop, {})
  const pp: Recipe['pop'] = {}
  putHands(pp, ['ambidextre', 'droitier'])
  putQuarters(pp, [4])
  assert.deepEqual(pp, { hand: ['droitier', 'ambidextre'], quarter: 4 })
  putHands(pp, [])
  assert.deepEqual(pp, { quarter: 4 })
  assert.deepEqual(toggleIn(['AG'], 'AD'), ['AG', 'AD'])
  assert.equal(toggleIn(['AG'], 'AG'), undefined, 'plus rien de coché : le champ disparaît')
  // Pastilles : « l'un ou l'autre ».
  assert.equal(orText(['Var']), 'Var')
  assert.equal(orText(['Var', 'Bouches-du-Rhône']), 'Var ou Bouches-du-Rhône')
  assert.equal(orText(['Var', 'Gard', 'Hérault']), 'Var, Gard ou Hérault')
  assert.equal(orText(['A', 'B', 'C', 'D', 'E']), 'A, B, C +2')
  const chips = (pop: Recipe['pop']) => new Map(recipeChips(cleanRecipe({ pop }), { ...names, dept: (c) => ctx.depts.find((d) => d.code === c)?.name ?? c }).map((c) => [c.key, c.label]))
  const c1 = chips({ positions: ['AG', 'AD'], depts: ['83', '13'], hand: ['gaucher', 'ambidextre'], quarter: [1, 2] })
  assert.equal(c1.get('positions'), 'Ailier gauche ou Ailier droit')
  assert.equal(c1.get('depts'), 'Var ou Bouches-du-Rhône')
  assert.equal(c1.get('hand'), 'gauchers ou ambidextres')
  assert.equal(c1.get('quarter'), 'nés en Q1 ou Q2')
  assert.equal(chips({ sex: 'F', hand: ['droitier', 'gaucher'], quarter: [3, 4] }).get('hand'), 'droitières ou gauchères')
  assert.equal(chips({ sex: 'F', quarter: [3, 4] }).get('quarter'), 'nées en Q3 ou Q4')
  assert.equal(chips({ hand: 'gaucher', quarter: 2 }).get('quarter'), 'Q2 · avril–juin', 'une seule valeur : comme avant')
  assert.equal(chips({ groups: ['g-ic', 'g-pole'] }).get('groups'), 'groupe : Intercomités ou Sélection Pôle')
  // Retirer la pastille retire toutes ses valeurs.
  assert.deepEqual(removeChip(cleanRecipe({ pop: { hand: ['gaucher', 'droitier'], depts: ['83'] } }), 'hand').pop, { depts: ['83'] })

  // Le cas de Stef : les ailiers gauches ET droits du Var ET des Bouches-du-Rhône (OU dans chaque champ, ET entre les champs).
  const wings = withPop({ positions: ['AG', 'AD'], depts: ['83', '13'] })
  const got = sel(wings).list
  const want = players.filter((p) => (p.position === 'AG' || p.position === 'AD') && (p.department === '83' || p.department === '13'))
  assert.ok(want.length > 5 && want.some((p) => p.position === 'AG') && want.some((p) => p.position === 'AD') && want.some((p) => p.department === '13'), 'jeu fictif : des deux postes et des deux départements')
  assert.deepEqual(ids(got), ids(want), 'ailiers G. ou D., du Var ou des Bouches-du-Rhône')
  assert.ok(got.every((p) => p.department !== '75' && p.position !== 'PIV'))
  // ET avec un autre champ : seulement les gauchers ou ambidextres parmi eux.
  const lefties = sel(withPop({ positions: ['AG', 'AD'], depts: ['83', '13'], hand: ['gaucher', 'ambidextre'] })).list
  assert.deepEqual(ids(lefties), ids(want.filter((p) => p.laterality === 'gaucher' || p.laterality === 'ambidextre')))
  // Trimestres : l'un ou l'autre.
  const q13 = sel(withPop({ quarter: [1, 3] })).list
  const month = (p: P) => Number(p.birthDate!.slice(5, 7))
  assert.deepEqual(ids(q13), ids(players.filter((p) => [1, 2, 3, 7, 8, 9].includes(month(p)))))
  // Un champ à une seule valeur, ancienne forme : mêmes joueurs que la liste d'une valeur.
  assert.deepEqual(ids(sel(withPop({ hand: 'gaucher' })).list), ids(sel({ recipe: listRecipe(cleanRecipe({ pop: { hand: ['gaucher'] } })), q: '' }).list))
  // Nombres des menus : chaque département garde le nombre qu'on obtient en le cochant (les autres champs appliqués).
  const qc = quickCounts(ix, wings, hay, toks)
  const n83 = qc.depts.find(([d]) => d === '83')?.[1]
  assert.equal(n83, want.filter((p) => p.department === '83').length)
  assert.equal(qc.positions.AG, want.filter((p) => p.position === 'AG').length, 'nombre du poste : avec les deux départements')
  for (const [d, n] of qc.depts) assert.equal(sel(withPop({ positions: ['AG', 'AD'], depts: [d] })).list.length, n, `département ${d}, postes cochés`)
  for (const [y, n] of qc.years) assert.equal(sel(withPop({ positions: ['AG', 'AD'], depts: ['83', '13'], years: [Number(y), Number(y)] })).list.length, n, `année ${y}, postes cochés`)
  for (const [k, n] of qc.clubs) assert.equal(sel(withPop({ positions: ['AG', 'AD'], depts: ['83', '13'], clubs: [k] })).list.length, n, `club ${k}, postes cochés`)

  // Nombre de filtres posés (bouton « Filtres 3 ») : un par champ, quel que soit le nombre de valeurs cochées.
  assert.equal(filterCount(wings), 2)
  assert.equal(filterCount(withPop({ positions: ['AG', 'AD'], depts: ['83', '13'], hand: ['gaucher', 'ambidextre'] }, 'Martin')), 3, 'le nom cherché ne compte pas')
  assert.equal(filterCount(withPop({ sex: 'M', years: [2010, 2010] }), new Set(['sex', 'years'] as const)), 0, 'barre posée : sans les commandes de l’écran')
  assert.equal(filterCount(EMPTY_QUERY), 0)

  // Phrase : « les gauchers ou ambidextres nés au 1er ou au 2e trimestre » (listes rendues par le modèle).
  const it = interpretRecipe({ population: { lateralite: ['gaucher', 'ambidextre'], trimestre: [1, '2e'], postes: ['AG', 'AD'], departements: ['Var', '13'] } }, [], ctx)
  assert.deepEqual(it.recipe.pop, { positions: ['AG', 'AD'], depts: ['83', '13'], hand: ['gaucher', 'ambidextre'], quarter: [1, 2] })
  assert.deepEqual(it.notes, [])
  // Une valeur simple, comme avant.
  assert.equal(interpretRecipe({ population: { lateralite: 'gauchère', trimestre: 'T3' } }, [], ctx).recipe.pop.hand, 'gaucher')
  const bad = interpretRecipe({ population: { lateralite: ['gaucher', 'manchot'] } }, [], ctx)
  assert.equal(bad.recipe.pop.hand, 'gaucher')
  assert.equal(bad.notes.length, 1, 'valeur inconnue signalée')
  // Fusion d'une phrase : la nouvelle liste remplace la clé (comme une valeur simple avant).
  const merged = mergeQuery(withPop({ hand: 'droitier', sex: 'M' }), cleanRecipe({ pop: { hand: ['gaucher', 'ambidextre'] } }), 'ajouter')
  assert.deepEqual(merged.recipe.pop, { sex: 'M', hand: ['gaucher', 'ambidextre'] })
  // Description envoyée au modèle : latéralité et trimestre peuvent être des listes.
  const schema = buildQuestionSchema(ctx)
  assert.ok(/lateralite \([^)]*liste/.test(schema.population) && /trimestre \([^)]*liste/.test(schema.population), 'schéma : listes permises')
  // Question qui compte (bilan) : même règle.
  const ans = runRecipe(ix, cleanRecipe({ pop: { positions: ['AG', 'AD'], depts: ['83', '13'] }, out: { type: 'count' } }))
  assert.equal(ans.count, want.length)
}

// ---------- 9 bis. Lieu → clubs ; groupe ET lieu (et leurs nombres) ----------
{
  const places = clubPlaces(ix)
  const key = (name: string) => [...ix.clubNames].find(([, n]) => n === name)![0]
  const [hbc, asf, hbi, ent] = CLUBS.map(key)
  // Départements cochés : la liste « Club » ne propose que les clubs de ces départements (régions : de ces régions).
  assert.deepEqual(new Set(quickCounts(ix, withPop({ depts: ['83'] }), hay, toks).clubs.map(([k]) => k)), new Set([hbc, asf]))
  assert.deepEqual(new Set(quickCounts(ix, withPop({ regions: ['region-sud'] }), hay, toks).clubs.map(([k]) => k)), new Set([hbc, asf, hbi]))
  assert.deepEqual(new Set(quickCounts(ix, withPop({ regions: ['region-sud'], depts: ['13'] }), hay, toks).clubs.map(([k]) => k)), new Set([hbi]))
  // Cocher un département (ou une région) retire les clubs cochés qui n'en font pas partie.
  assert.deepEqual(clubsInPlaces([hbc, hbi, ent], places, ['83']), [hbc])
  assert.deepEqual(clubsInPlaces([hbc, hbi, ent], places, ['83', '75']), [hbc, ent])
  assert.deepEqual(clubsInPlaces([hbc, hbi, ent], places, undefined, ['region-sud']), [hbc, hbi])
  assert.deepEqual(clubsInPlaces([hbc, hbi], places, ['13'], ['region-sud']), [hbi])
  assert.equal(clubsInPlaces([ent], places, ['83']), undefined, 'plus aucun club : le champ disparaît')
  assert.deepEqual(clubsInPlaces([hbc, ent], places, [], []), [hbc, ent], 'aucun lieu coché : clubs gardés')
  assert.deepEqual(clubsInPlaces(['club-inconnu'], places, ['83']), ['club-inconnu'], 'club inconnu de l’appareil : gardé')
  assert.equal(clubsInPlaces(undefined, places, ['83']), undefined)

  // Groupe ET lieu : « les joueurs du groupe Intercomités qui sont du Var » (le groupe n'efface plus le lieu).
  const ic = new Set(groups[0].playerIds)
  const var83 = sel(withPop({ groups: ['g-ic'], depts: ['83'] })).list
  assert.ok(var83.length > 0 && var83.length < ic.size)
  assert.deepEqual(ids(var83), ids(players.filter((p) => ic.has(p.id) && p.department === '83')))
  assert.deepEqual(ids(sel(withPop({ groups: ['g-ic'], depts: ['83'], clubs: [asf] })).list), ids(players.filter((p) => ic.has(p.id) && p.club === 'AS Fictive')))
  // Nombres de la fenêtre avec un groupe ET un lieu : chacun est celui qu'on obtient en le cochant.
  const both = withPop({ groups: ['g-ic'], depts: ['83'] })
  const cg = quickCounts(ix, both, hay, toks)
  for (const [d, n] of cg.depts) assert.equal(sel(withPop({ groups: ['g-ic'], depts: [d] })).list.length, n, `groupe + département ${d}`)
  for (const [k, n] of cg.clubs) assert.equal(sel(withPop({ groups: ['g-ic'], depts: ['83'], clubs: [k] })).list.length, n, `groupe + club ${k}`)
  for (const [r, n] of cg.regions) assert.equal(sel(withPop({ groups: ['g-ic'], regions: [r] })).list.length, n, `groupe + région ${r}`)
  assert.equal(cg.positionTotal, var83.length)
  // Nombre d'un groupe : ses joueurs qui répondent aux autres filtres (lieu compris), groupe coché ou non.
  assert.equal(cg.groups.get('g-ic'), var83.length)
  assert.equal(cg.groups.get('g-pole'), sel(withPop({ groups: ['g-pole'], depts: ['83'] })).list.length)
  const cf = quickCounts(ix, withPop({ sex: 'F', regions: ['region-sud'] }), hay, toks)
  for (const g of ['g-ic', 'g-pole']) assert.equal(cf.groups.get(g), sel(withPop({ sex: 'F', regions: ['region-sud'], groups: [g] })).list.length, `nombre du groupe ${g}`)
  assert.equal(quickCounts(ix, EMPTY_QUERY, hay, toks).groups.get('g-ic'), groups[0].playerIds.length, 'sans filtre : tout le groupe')
}

// ---------- 10. Performance : 40 000 fiches ----------
{
  seed = 11
  const big = makePlayers(40_000).sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.id.localeCompare(b.id))
  const bigM = big.filter(() => rnd() < 0.6).map((p) => ({ playerId: p.id, criterionId: 'taille', value: 150 + Math.floor(rnd() * 50), date: '2026-03-01' }))
  let t0 = performance.now()
  const bix = buildPlayersIndex({ ...data, players: big, measures: bigM, sights: [], evals: [], groups: [{ id: 'g-ic', playerIds: big.slice(0, 3000).map((p) => p.id) }] })
  const tIndex = performance.now() - t0
  const bh = new WeakMap<P, string>()
  const bhay = (p: P) => bh.get(p) ?? (bh.set(p, playerHaystack(p)), bh.get(p)!)
  selectPlayers(bix, { ...EMPTY_QUERY, q: 'x' }, bhay, toks) // textes de recherche préparés (une fois, comme à l'écran)
  const cases: JoueursQuery[] = [
    EMPTY_QUERY,
    withPop({ sex: 'M', years: [2010, 2010], hMin: 185 }),
    withPop({ depts: ['83'], hand: 'gaucher', positions: ['PIV'], secondary: true }),
    withPop({ regions: ['region-sud'], quarter: 1, groups: ['g-ic'] }, 'martin'),
    withPop({ positions: ['AG', 'AD'], depts: ['83', '13'], hand: ['gaucher', 'ambidextre'], quarter: [1, 2] }),
    { recipe: listRecipe(cleanRecipe({ pop: { sex: 'F' }, out: { type: 'list', sort: { by: 'height', dir: 'desc' } } })), q: '' },
    withPop({ sex: 'F' }, 'Dupond'),
  ]
  let worst = 0
  for (const qy of cases) {
    t0 = performance.now()
    selectPlayers(bix, qy, bhay, toks)
    worst = Math.max(worst, performance.now() - t0)
  }
  t0 = performance.now()
  quickCounts(bix, withPop({ sex: 'M', depts: ['83'] }), bhay, toks)
  const tCounts = performance.now() - t0
  console.log(`40 000 fiches : index ${Math.round(tIndex)} ms, filtre le plus lent ${Math.round(worst)} ms, nombres des menus ${Math.round(tCounts)} ms`)
  assert.ok(worst < 150, `filtre sur 40 000 fiches en moins de 150 ms (${Math.round(worst)} ms)`)
}

console.log('test-filtres-recette : OK')
