// Test de la recherche de joueurs en langage naturel (src/voiceSearch.ts) : schéma envoyé, relecture des réponses
// du modèle (y compris valeurs inventées ou mal formées), rapprochement des noms, résumé ; appel à la fonction
// « transcrire » (?mode=filtres) avec un faux fetch (src/dictation/transcribe.ts).
//
//   npx jiti tools/test-recherche-vocale.ts
import assert from 'node:assert/strict'
import {
  bestMatch,
  buildSchema,
  EMPTY_FILTERS,
  interpretFilters,
  notFoundText,
  parseHeight,
  parseQuarter,
  sameFilters,
  summaryText,
  unsupportedText,
  applyAnswer,
  currentForModel,
  keyOf,
  localCommand,
  outcomeText,
  type FilterValues,
  type SearchContext,
} from '../src/voiceSearch'
import { readFileSync } from 'node:fs'
import { levenshtein, nameKey, nameLike, nameTokens, phonetic, playerHaystack, queryWords, searchByName } from '../src/nameMatch'
import { DictationError, requestAccess, understandFilters, type Endpoint } from '../src/dictation/transcribe'

const REGIONS: Record<string, string> = { '83': 'region-sud', '13': 'region-sud', '06': 'region-sud', '75': 'region-idf', '73': 'region-ara', '74': 'region-ara', '2A': 'region-cor' }
const ctx: SearchContext = {
  positions: [
    { id: 'GB', label: 'Gardien' },
    { id: 'AG', label: 'Ailier gauche' },
    { id: 'ARG', label: 'Arrière gauche' },
    { id: 'DC', label: 'Demi-centre' },
    { id: 'ARD', label: 'Arrière droit' },
    { id: 'AD', label: 'Ailier droit' },
    { id: 'PIV', label: 'Pivot' },
  ],
  regions: [
    { id: 'region-sud', name: 'Région Sud' },
    { id: 'region-idf', name: 'Île-de-France' },
    { id: 'region-ara', name: 'Auvergne-Rhône-Alpes' },
    { id: 'region-cor', name: 'Corse' },
  ],
  depts: [
    { code: '06', name: 'Alpes-Maritimes' },
    { code: '13', name: 'Bouches-du-Rhône' },
    { code: '2A', name: 'Corse-du-Sud' },
    { code: '73', name: 'Savoie' },
    { code: '74', name: 'Haute-Savoie' },
    { code: '75', name: 'Paris' },
    { code: '83', name: 'Var' },
  ],
  clubs: ['HBC Toulon Saint-Cyr Var', 'Toulon Handball', 'US Ivry Handball', 'Istres Provence Handball', 'Saint-Raphaël Var Handball', 'Saint-Cyr HB', 'Hand Ball Club Aix'],
  groups: [
    { id: 'g1', name: 'Intercomités 2011' },
    { id: 'g2', name: 'Sélection Var U15' },
    { id: 'g3', name: 'Sélection Var U13' },
  ],
  profiles: [{ id: 'p1', name: 'Grands gauchers' }],
  regionOfDept: (c) => REGIONS[c],
  thisYear: 2026,
}

// ---------- Schéma : seulement des listes de valeurs, aucune donnée de joueur ----------
const schema = buildSchema(ctx)
assert.deepEqual(Object.keys(schema), [
  'sexe', 'annee', 'trimestre', 'tailleMin', 'lateralite', 'poste', 'postesSecondaires', 'region', 'departement', 'club', 'pole', 'avecVideo', 'suivis', 'groupe', 'profil', 'recherche',
])
assert.equal(schema.poste, 'GB (gardien), AG (ailier gauche), ARG (arrière gauche), DC (demi-centre), ARD (arrière droit), AD (ailier droit), PIV (pivot), aucun (sans poste)')
assert.equal(schema.departement, 'numéro ou nom du département tel que dit', 'départements recopiés, retrouvés par l’appli')
assert.equal(schema.groupe, 'un de : Intercomités 2011 | Sélection Var U15 | Sélection Var U13')
assert.equal(schema.club, 'nom du club tel que dit', 'les clubs ne sont pas envoyés')
const sent = JSON.stringify(schema)
for (const d of ['Bouches-du-Rhône', 'Haute-Savoie', 'Alpes-Maritimes', 'Région Sud']) assert.ok(!sent.includes(d), `absent du schéma : ${d}`)
// Au-delà de 30 groupes : pas de liste.
assert.equal(buildSchema({ ...ctx, groups: Array.from({ length: 31 }, (_, i) => ({ id: `x${i}`, name: `G${i}` })) }).groupe, 'nom du groupe tel que dit')
for (const c of ctx.clubs) assert.ok(!sent.includes(c), `club absent du schéma : ${c}`)
assert.ok(!sent.includes('"g1"') && !sent.includes('"p1"'), 'pas d’identifiants internes')
// Sans groupes ni profils visibles : clés absentes.
const bare = buildSchema({ ...ctx, groups: [], profiles: [] })
assert.ok(!('groupe' in bare) && !('profil' in bare))

// ---------- Exemple de l'énoncé ----------
let it = interpretFilters({ annee: 2010, tailleMin: 180 }, [], ctx)
assert.deepEqual(it.values, { ...EMPTY_FILTERS, year: '2010', minH: '180' })
assert.equal(summaryText(it.understood), 'Compris : nés en 2010 · taille ≥ 180 cm')
assert.equal(unsupportedText(it), '')
assert.equal(notFoundText(it), '')

// ---------- Une phrase complète ----------
it = interpretFilters(
  { sexe: 'F', annee: '2011', trimestre: 1, lateralite: 'gauchère', departement: 'Var', club: 'saint raphael', poste: 'ARD', postesSecondaires: true, pole: 'en_cours', avecVideo: true, suivis: 'oui' },
  ['catégorie U15'],
  ctx,
)
assert.deepEqual(it.values, {
  ...EMPTY_FILTERS,
  sex: 'F',
  year: '2011',
  quarter: 1,
  hand: 'gaucher',
  dept: '83',
  club: 'Saint-Raphaël Var Handball',
  position: 'ARD',
  withSecondary: true,
  pole: 'current',
  videoOnly: true,
  followedOnly: true,
})
assert.equal(
  summaryText(it.understood),
  'Compris : filles · nées en 2011 · trimestre 1 (janv.–mars) · gauchers · Var (83) · Saint-Raphaël Var Handball · mes suivis · au Pôle Espoirs · avec une vidéo · arrière droit · + postes secondaires',
)
assert.equal(unsupportedText(it), 'Je ne sais pas encore filtrer sur : catégorie U15')

// ---------- Valeurs inventées ou mal formées : écartées et signalées ----------
it = interpretFilters(
  {
    sexe: 'X',
    annee: 1890,
    trimestre: 7,
    tailleMin: 450,
    lateralite: 'des deux pieds',
    poste: 'libero',
    departement: '999',
    region: 'region-atlantide',
    club: 'Real Madrid',
    groupe: 'Équipe de France',
    profil: 'Petits rapides',
    pole: 'peut-être',
    couleurMaillot: 'rouge',
  },
  'pas un tableau',
  ctx,
)
assert.deepEqual(it.values, EMPTY_FILTERS, 'aucune valeur inventée appliquée')
assert.equal(it.understood.length, 0)
assert.equal(it.notFound.length, 12)
assert.deepEqual(it.unsupported, ['« couleurMaillot »'])
assert.ok(notFoundText(it).startsWith('Non appliqué : sexe « X » (valeur inconnue) ; année « 1890 »'))
assert.ok(notFoundText(it).includes('club « Real Madrid » (pas trouvé dans la base)'))
assert.ok(!/pas retenu/i.test(notFoundText(it) + unsupportedText(it)))
// Réponses qui ne sont pas des objets.
for (const raw of [null, undefined, 'annee=2010', 42, [{ annee: 2010 }]]) assert.deepEqual(interpretFilters(raw, null, ctx).values, EMPTY_FILTERS)
// false, null, '' : pas de filtre, rien à signaler.
it = interpretFilters({ suivis: false, avecVideo: null, club: '', annee: 2010 }, [], ctx)
assert.deepEqual(it.values, { ...EMPTY_FILTERS, year: '2010' })
assert.equal(it.notFound.length, 0)
// nonGere : chaînes seulement, nettoyées, 8 au plus.
it = interpretFilters({}, ['  moins de   1 m 70 ', 3, '', 'x'.repeat(200), ...Array(20).fill('y')], ctx)
assert.equal(it.unsupported[0], 'moins de 1 m 70')
assert.equal(it.unsupported[1].length, 80)
assert.equal(it.unsupported.length, 8)
// postesSecondaires sans poste : rien.
assert.deepEqual(interpretFilters({ postesSecondaires: true }, [], ctx).values, EMPTY_FILTERS)

// ---------- Tailles, trimestres ----------
for (const [v, cm] of [
  [180, 180], [1.8, 180], ['1m80', 180], ['1 m 80', 180], ['1,80', 180], ['1.85 m', 185], ['180 cm', 180], ['1m8', 180], ['1 m 05', 105], ['2m', 200],
] as [unknown, number][])
  assert.equal(parseHeight(v), cm, String(v))
for (const v of [0, 50, 260, 'grand', '', null, -1]) assert.equal(parseHeight(v), undefined, String(v))
for (const [v, q] of [[1, 1], ['Q2', 2], ['3', 3], ['premier', 1], ['4e', 4], ['dernier trimestre', 4]] as [unknown, number][]) assert.equal(parseQuarter(v), q, String(v))
assert.equal(parseQuarter(5), undefined)

// ---------- Départements, régions : numéro ou nom, accents, majuscules ----------
const dept = (v: unknown) => interpretFilters({ departement: v }, [], ctx).values.dept
assert.equal(dept('83'), '83')
assert.equal(dept(83), '83')
assert.equal(dept(6), '06')
assert.equal(dept('2a'), '2A')
assert.equal(dept('le Var'), '83')
assert.equal(dept('bouches du rhone'), '13')
assert.equal(dept('Alpes Maritimes (06)'), '06')
assert.equal(dept('savoie'), '73', 'Savoie exacte, pas Haute-Savoie')
assert.equal(dept('haute savoie'), '74')
assert.equal(dept('PARIS'), '75')
assert.equal(interpretFilters({ region: 'PACA' }, [], ctx).values.region, 'region-sud')
assert.equal(interpretFilters({ region: 'ile de france' }, [], ctx).values.region, 'region-idf')
assert.equal(interpretFilters({ region: 'region-ara' }, [], ctx).values.region, 'region-ara')
// Région qui contredit le département : le département décide.
it = interpretFilters({ departement: '83', region: 'region-idf' }, [], ctx)
assert.equal(it.values.dept, '83')
assert.equal(it.values.region, '')
assert.equal(it.notFound.length, 1)
// Région cohérente : gardée avec le département.
it = interpretFilters({ departement: 'Var', region: 'Région Sud' }, [], ctx)
assert.deepEqual([it.values.region, it.values.dept], ['region-sud', '83'])

// ---------- Clubs, groupes, profils ----------
const club = (v: string) => interpretFilters({ club: v }, [], ctx)
assert.equal(club('Toulon').values.club, 'Toulon Handball', 'même nom aux mots vides près')
assert.equal(club('toulon saint cyr').values.club, 'HBC Toulon Saint-Cyr Var')
assert.equal(club('Ivry').values.club, 'US Ivry Handball')
assert.equal(club('istres').values.club, 'Istres Provence Handball')
assert.equal(club('aix').values.club, 'Hand Ball Club Aix')
assert.equal(club('ST RAPHAEL').values.club, '', '« ST » ne suffit pas')
const amb = club('Var')
assert.equal(amb.values.club, '', 'ambigu : rien choisi')
assert.ok(amb.notFound[0].includes('2 clubs possibles'))
assert.equal(interpretFilters({ groupe: 'intercomites 2011' }, [], ctx).values.group, 'g1')
assert.equal(interpretFilters({ groupe: 'selection var u15' }, [], ctx).values.group, 'g2')
assert.equal(interpretFilters({ groupe: 'Sélection Var' }, [], ctx).values.group, '', 'deux groupes possibles')
assert.equal(interpretFilters({ profil: 'grands gauchers' }, [], ctx).values.profile, 'p1')
assert.equal(summaryText(interpretFilters({ profil: 'Grands Gauchers', groupe: 'Intercomités 2011' }, [], ctx).understood), 'Compris : profil : Grands gauchers · groupe : Intercomités 2011')

// ---------- Postes, latéralité, sexe, recherche ----------
const pos = (v: unknown) => interpretFilters({ poste: v }, [], ctx).values.position
assert.equal(pos('DC'), 'DC')
assert.equal(pos('dc'), 'DC')
assert.equal(pos('demi-centre'), 'DC')
assert.equal(pos('meneur'), 'DC')
assert.equal(pos('gardienne'), 'GB')
assert.equal(pos('ailier gauche'), 'AG')
assert.equal(pos('aucun'), 'none')
assert.equal(pos('ailier'), 'all', 'ailier seul : ambigu')
assert.equal(interpretFilters({ lateralite: 'droitière' }, [], ctx).values.hand, 'droitier')
assert.equal(interpretFilters({ sexe: 'garçons' }, [], ctx).values.sex, 'M')
assert.equal(interpretFilters({ recherche: '  Dupont   Léa ' }, [], ctx).values.q, 'Dupont Léa')
assert.equal(summaryText(interpretFilters({ recherche: 'Lucas Martin', annee: 2010 }, [], ctx).understood), 'Compris : nés en 2010 · nom : Lucas Martin')
assert.equal(interpretFilters({ recherche: '638 301 500 1234' }, [], ctx).values.q, '6383015001234', 'licence recollée')
assert.equal(summaryText(interpretFilters({ recherche: '6383015001234' }, [], ctx).understood), 'Compris : licence 6383015001234')
assert.equal(interpretFilters({ recherche: '(nom)' }, [], ctx).values.q, '', 'valeur de remplacement ignorée')
assert.equal(interpretFilters({ pole: 'sortis' }, [], ctx).values.pole, 'past')
assert.equal(interpretFilters({ pole: 'tous' }, [], ctx).values.pole, 'any')

// ---------- Rapprochement ----------
assert.deepEqual(bestMatch('', ['a'], (x) => [x]), { none: true })
assert.deepEqual(bestMatch('Le club de', ['Toulon'], (x) => [x]), { none: true })
assert.ok(sameFilters(EMPTY_FILTERS, { ...EMPTY_FILTERS }))
assert.ok(!sameFilters(EMPTY_FILTERS, { ...EMPTY_FILTERS, year: '2010' }))

// ---------- Appel à la fonction (faux fetch) ----------
type Call = { url: string; init?: RequestInit }
function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
}
const calls: Call[] = []
const ep: Endpoint = { url: 'https://x.supabase.co/functions/v1/transcrire', headers: { Authorization: 'Bearer t', apikey: 'k' } }
const ans = await understandFilters(
  { ...ep, fetch: fakeFetch(200, { filtres: { annee: 2010 }, nonGere: ['U15', 3], ms: 400, restant_mois: 10, restant_jour: 5 }, calls) },
  '  tous les joueurs   nés en 2010 ',
  schema,
  { tailleMin: 180 },
)
assert.deepEqual(ans, { filtres: { annee: 2010 }, retirer: [], nonGere: ['U15'], ms: 400, restantMois: 10, restantJour: 5 })
assert.equal(calls[0].url, ep.url + '?mode=filtres')
assert.equal(calls[0].init?.method, 'POST')
const hdr = calls[0].init?.headers as Record<string, string>
assert.equal(hdr['Content-Type'], 'application/json')
assert.equal(hdr.Authorization, 'Bearer t')
const body = JSON.parse(String(calls[0].init?.body))
assert.deepEqual(Object.keys(body), ['phrase', 'schema', 'actuels'], 'seulement la phrase, le schéma et les filtres actifs')
assert.deepEqual(body.actuels, { tailleMin: 180 })
// Réponse avec action.
const withAction = await understandFilters({ ...ep, fetch: fakeFetch(200, { action: 'retirer', filtres: {}, retirer: ['tailleMin'], nonGere: [] }) }, 'enlève la taille', schema)
assert.deepEqual([withAction.action, withAction.retirer], ['retirer', ['tailleMin']])
assert.equal(body.phrase, 'tous les joueurs nés en 2010')
// Erreurs.
const code = async (f: typeof fetch, phrase = 'nés en 2010') => {
  try {
    await understandFilters({ ...ep, fetch: f }, phrase, schema)
    return 'ok'
  } catch (e) {
    assert.ok(e instanceof DictationError)
    return (e as DictationError).code
  }
}
assert.equal(await code(fakeFetch(429, { error: 'quota_atteint' })), 'quota_atteint')
assert.equal(await code(fakeFetch(502, { error: 'reponse_illisible' })), 'reponse_illisible')
assert.equal(await code(fakeFetch(404, undefined)), 'absent')
assert.equal(await code(fakeFetch(403, {})), 'pas_admin')
assert.equal(await code((async () => Promise.reject(new TypeError('réseau'))) as unknown as typeof fetch), 'reseau')
assert.equal(await code(fakeFetch(200, {}), '   '), 'phrase_absente')
assert.equal(await code(fakeFetch(200, {}), 'x'.repeat(301)), 'phrase_trop_longue')
// Réponse vide : pas de filtre.
assert.deepEqual((await understandFilters({ ...ep, fetch: fakeFetch(200, {}) }, 'bonjour', schema)).filtres, {})

// ---------- Accès : la recherche n'apparaît qu'avec une fonction qui connaît le mode « filtres » ----------
assert.equal((await requestAccess({ ...ep, fetch: fakeFetch(200, { pret: true, modes: ['dictee', 'filtres'] }) })).filtres, true)
assert.equal((await requestAccess({ ...ep, fetch: fakeFetch(200, { pret: true }) })).filtres, undefined, 'ancienne version de la fonction')
assert.equal((await requestAccess({ ...ep, fetch: fakeFetch(404, undefined) })).status, 'absent')

// ---------- Opérations sur les filtres actuels ----------
const cur: FilterValues = { ...EMPTY_FILTERS, year: '2010', minH: '180', position: 'DC' }
assert.deepEqual(currentForModel(cur, ctx), { annee: 2010, tailleMin: 180, poste: 'DC' })
assert.deepEqual(
  currentForModel({ ...EMPTY_FILTERS, sex: 'F', region: 'region-sud', dept: '83', group: 'g1', pole: 'past', videoOnly: true, q: 'Dupont' }, ctx),
  { sexe: 'F', region: 'Région Sud', departement: '83', pole: 'sortis', avecVideo: true, groupe: 'Intercomités 2011', recherche: '(nom)' },
  'du nom cherché, sa présence seulement',
)

// ajouter : les filtres actuels restent (le cas signalé : « ajoute au filtre que le gamin doit être dans le Var »).
let o = applyAnswer({ action: 'ajouter', filtres: { departement: 'Var' }, retirer: [], nonGere: [] }, cur, ctx)
assert.deepEqual(o.values, { ...cur, dept: '83' })
assert.equal(outcomeText(o, true), 'Ajouté : Var (83)')
// Une clé déjà posée prend la nouvelle valeur.
o = applyAnswer({ action: 'ajouter', filtres: { annee: 2011, lateralite: 'gaucher' } }, cur, ctx)
assert.deepEqual(o.values, { ...cur, year: '2011', hand: 'gaucher' })
assert.equal(outcomeText(o, true), 'Ajouté : nés en 2011 · gauchers')
// Nouveau département d'une autre région : la région d'avant part ; nouvelle région : le département d'ailleurs part.
o = applyAnswer({ action: 'ajouter', filtres: { departement: '75' } }, { ...cur, region: 'region-sud' }, ctx)
assert.deepEqual([o.values.region, o.values.dept], ['', '75'])
o = applyAnswer({ action: 'ajouter', filtres: { region: 'IDF' } }, { ...cur, dept: '83' }, ctx)
assert.deepEqual([o.values.region, o.values.dept], ['region-idf', ''])
// ajouter + retirer.
o = applyAnswer({ action: 'ajouter', filtres: { poste: 'PIV' }, retirer: ['annee'] }, cur, ctx)
assert.deepEqual(o.values, { ...cur, year: '', position: 'PIV' })
assert.equal(outcomeText(o, true), 'Retiré : année — Ajouté : pivot')
// ajouter sans filtre actif : remplacer.
o = applyAnswer({ action: 'ajouter', filtres: { annee: 2010 } }, EMPTY_FILTERS, ctx)
assert.equal(o.action, 'remplacer')
assert.equal(outcomeText(o, false), 'Compris : nés en 2010')
// ajouter une valeur inventée : rien ne change, c'est signalé.
o = applyAnswer({ action: 'ajouter', filtres: { club: 'Real Madrid' } }, cur, ctx)
assert.deepEqual([o.changed, o.values], [false, cur])
assert.equal(notFoundText(o), 'Non appliqué : club « Real Madrid » (pas trouvé dans la base)')

// retirer : par clé, par mot courant, ou par valeur (« retire le Var »).
o = applyAnswer({ action: 'retirer', filtres: {}, retirer: ['tailleMin'] }, cur, ctx)
assert.deepEqual(o.values, { ...cur, minH: '' })
assert.equal(outcomeText(o, true), 'Retiré : taille')
o = applyAnswer({ action: 'retirer', retirer: ['la taille', 'filtre année', 'poste'] }, cur, ctx)
assert.deepEqual(o.values, EMPTY_FILTERS)
assert.equal(outcomeText(o, true), 'Retiré : taille · année · poste')
o = applyAnswer({ action: 'retirer', filtres: { departement: 'Var' } }, { ...cur, dept: '83' }, ctx)
assert.deepEqual(o.values, cur)
assert.equal(outcomeText(o, true), 'Retiré : département')
// Clé inconnue : signalée ; clé non posée : rien ne change.
o = applyAnswer({ action: 'retirer', retirer: ['couleurMaillot'] }, cur, ctx)
assert.deepEqual([o.changed, o.notFound], [false, ['retirer « couleurMaillot » (filtre inconnu)']])
assert.equal(applyAnswer({ action: 'retirer', retirer: ['club'] }, cur, ctx).changed, false)
for (const [w, k] of [['tailleMin', 'tailleMin'], ['taille', 'tailleMin'], ['la taille', 'tailleMin'], ['le filtre de taille', 'tailleMin'], ['année', 'annee'], ['le poste', 'poste'], ['vidéo', 'avecVideo'], ['département', 'departement'], ['Var', undefined]] as [string, string | undefined][])
  assert.equal(keyOf(w), k, w)

// effacer.
o = applyAnswer({ action: 'effacer', filtres: { annee: 2012 } }, { ...cur, sex: 'M' }, ctx)
assert.deepEqual(o.values, EMPTY_FILTERS)
assert.equal(outcomeText(o, true), 'Filtres effacés')
assert.equal(applyAnswer({ action: 'effacer' }, EMPTY_FILTERS, ctx).changed, false)
assert.equal(outcomeText(applyAnswer({ action: 'effacer' }, EMPTY_FILTERS, ctx), false), 'Aucun filtre à effacer')

// remplacer.
o = applyAnswer({ action: 'remplacer', filtres: { annee: 2010, tailleMin: 180 } }, { ...EMPTY_FILTERS, dept: '83', sex: 'F' }, ctx)
assert.deepEqual(o.values, { ...EMPTY_FILTERS, year: '2010', minH: '180' })
assert.equal(outcomeText(o, true), 'Remplacés : nés en 2010 · taille ≥ 180 cm')
// Rien de compris : filtres inchangés.
o = applyAnswer({ action: 'remplacer', filtres: {}, nonGere: ['bons au tir'] }, cur, ctx)
assert.deepEqual([o.changed, o.values, unsupportedText(o)], [false, cur, 'Je ne sais pas encore filtrer sur : bons au tir'])

// Action absente ou inventée (ancienne version de la fonction, modèle distrait).
assert.equal(applyAnswer({ filtres: { annee: 2010 } }, cur, ctx).action, 'remplacer')
assert.equal(applyAnswer({ retirer: ['taille'] }, cur, ctx).action, 'retirer')
assert.equal(applyAnswer({ action: 'supprimer_tout', filtres: { annee: 2012 } }, cur, ctx).action, 'remplacer')
assert.equal(applyAnswer({ action: 'retirer', retirer: 'taille' }, cur, ctx).changed, false, 'retirer doit être un tableau')

// ---------- Exemples des consignes du modèle : chaque réponse est acceptée et a l'effet attendu ----------
const fn = readFileSync(new URL('../supabase/functions/transcrire/index.ts', import.meta.url), 'utf8')
const consignes = fn.slice(fn.indexOf('const CONSIGNES = `') + 19, fn.indexOf('`', fn.indexOf('const CONSIGNES = `') + 19))
const examples = [...consignes.matchAll(/^Actuels (\{.*?\}) ; « (.*) » → (\{.*\})$/gm)]
assert.ok(examples.length >= 8, `exemples trouvés : ${examples.length}`)
// « (nom) » : un nom est cherché (exemple : Martin).
const toValues = (a: Record<string, unknown>) => {
  const v = applyAnswer({ action: 'remplacer', filtres: { ...a, recherche: undefined } }, EMPTY_FILTERS, ctx).values
  return a.recherche ? { ...v, q: 'Martin' } : v
}
const seen = new Set<string>()
for (const [, actuels, phrase, reponse] of examples) {
  const before = toValues(JSON.parse(actuels))
  const r = JSON.parse(reponse)
  assert.deepEqual(Object.keys(r), ['action', 'filtres', 'retirer', 'nonGere'], phrase)
  seen.add(r.action)
  const out = applyAnswer(r, before, ctx)
  assert.equal(out.action, r.action, phrase)
  assert.equal(out.notFound.length, 0, `${phrase} : ${out.notFound}`)
  assert.ok(out.changed, `l'exemple change les filtres : ${phrase}`)
  // Les clés des exemples sont celles du schéma.
  for (const k of [...Object.keys(r.filtres), ...r.retirer, ...Object.keys(JSON.parse(actuels))]) assert.ok(k in schema, `${phrase} : clé ${k}`)
  if (localCommand(phrase)) assert.equal(r.action, 'effacer', phrase)
}
assert.deepEqual([...seen].sort(), ['ajouter', 'effacer', 'remplacer', 'retirer'])
// Le cas signalé, d'après l'exemple : les filtres restent et le Var s'ajoute.
const varCase = examples.find((e) => e[2].includes('gamin'))!
assert.deepEqual(applyAnswer(JSON.parse(varCase[3]), toValues(JSON.parse(varCase[1])), ctx).values, { ...EMPTY_FILTERS, year: '2010', minH: '180', dept: '83' })

// Taille des consignes (avec le schéma d'une base ordinaire), pour suivre le coût de chaque appel.
const schemaText = Object.entries(schema).map(([k, v]) => `${k} : ${v}`).join('\n')
const promptChars = consignes.length + schemaText.length + 30
console.log(`Consignes : ${consignes.length} caractères, schéma : ${schemaText.length}, total ≈ ${promptChars} caractères (≈ ${Math.round(promptChars / 3.5)} jetons)`)
assert.ok(promptChars < 6000, 'consignes compactes')

// ---------- Commandes évidentes, reconnues sans le modèle ----------
const LOCAL: [string, 'effacer' | null][] = [
  ['efface la sélection', 'effacer'],
  ['Efface la sélection.', 'effacer'],
  ['efface les filtres', 'effacer'],
  ['efface tout', 'effacer'],
  ['effacer', 'effacer'],
  ['tout effacer', 'effacer'],
  ['réinitialise', 'effacer'],
  ['réinitialise les filtres', 'effacer'],
  ['Réinitialiser la recherche', 'effacer'],
  ['remets à zéro', 'effacer'],
  ['remets tout à zéro', 'effacer'],
  ['remise à zéro', 'effacer'],
  ['supprime les filtres', 'effacer'],
  ['supprime tous les filtres', 'effacer'],
  ['enlève tous les filtres', 'effacer'],
  ['retire les filtres', 'effacer'],
  ['vide la sélection', 'effacer'],
  ['tu peux effacer les filtres s’il te plaît', 'effacer'],
  ['euh efface tout', 'effacer'],
  ['on recommence', 'effacer'],
  ['recommence', 'effacer'],
  ['montre tout le monde', 'effacer'],
  ['montre-moi tous les joueurs', 'effacer'],
  ['affiche toute la liste', 'effacer'],
  ['plus de filtres', 'effacer'],
  ['aucun filtre', 'effacer'],
  ['reset', 'effacer'],
  // Au modèle : ce n'est pas « tout effacer ».
  ['efface le filtre taille', null],
  ['enlève la taille', null],
  ['retire le Var', null],
  ['tous les joueurs nés en 2010', null],
  ['montre-moi les gauchers', null],
  ['ajoute au filtre que le gamin doit être dans le Var', null],
  ['peu importe le poste', null],
  ['sans condition d’année', null],
  ['efface la sélection et montre les gardiens de 2010', null],
  ['les joueurs du club de Toulon', null],
  ['', null],
]
for (const [phrase, want] of LOCAL) assert.equal(localCommand(phrase), want, phrase)
assert.ok(LOCAL.length >= 25)
// La commande locale donne le même effet qu'un « effacer » du modèle.
assert.deepEqual(applyAnswer({ action: localCommand('efface la sélection')! }, cur, ctx).values, EMPTY_FILTERS)

// ---------- Noms : opérations avec la recherche par nom ----------
o = applyAnswer({ action: 'ajouter', filtres: { recherche: 'Martin' } }, { ...EMPTY_FILTERS, year: '2010' }, ctx)
assert.deepEqual(o.values, { ...EMPTY_FILTERS, year: '2010', q: 'Martin' })
assert.equal(outcomeText(o, true), 'Ajouté : nom : Martin')
o = applyAnswer({ action: 'retirer', retirer: ['recherche'] }, { ...EMPTY_FILTERS, year: '2010', q: 'Martin' }, ctx)
assert.deepEqual([o.values, outcomeText(o, true)], [{ ...EMPTY_FILTERS, year: '2010' }, 'Retiré : recherche par nom'])
assert.equal(keyOf('le nom'), 'recherche')
assert.equal(keyOf('prénom'), 'recherche')
// Le modèle recopie « (nom) » en ajoutant autre chose : le nom cherché reste.
o = applyAnswer({ action: 'ajouter', filtres: { recherche: '(nom)', lateralite: 'gaucher' } }, { ...EMPTY_FILTERS, q: 'Martin' }, ctx)
assert.deepEqual(o.values, { ...EMPTY_FILTERS, q: 'Martin', hand: 'gaucher' })

// ---------- Recherche par nom tolérante (src/nameMatch.ts) ----------
assert.equal(nameKey('  Jean-Pierre  D’Arc '), 'jean pierre d arc')
assert.deepEqual(queryWords('Martin 638 301 500 1234'), ['martin', '6383015001234'])
assert.deepEqual(queryWords('6 3 8 3 0 1 5'), ['6383015'])
assert.deepEqual(queryWords('Lucas-Martin'), ['lucas', 'martin'])
for (const [a, b] of [
  ['Dupond', 'Dupont'],
  ['Mathéo', 'Matteo'],
  ['Lefebvre', 'Lefèvre'],
  ['Philippe', 'Filipe'],
  ['Gauthier', 'Gautier'],
  ['Rémi', 'Rémy'],
  ['Kévin', 'KEVIN'],
  ['Thomas', 'Tomas'],
  ['Martins', 'Martin'],
] as [string, string][])
  assert.equal(phonetic(a), phonetic(b), `${a} = ${b}`)
for (const [a, b] of [['Martin', 'Morin'], ['Dupont', 'Durand'], ['Léa', 'Léo']] as [string, string][]) assert.notEqual(phonetic(a), phonetic(b), `${a} ≠ ${b}`)
assert.equal(levenshtein('dupond', 'dupont'), 1)
assert.equal(levenshtein('martin', 'durand', 2), 3, 'arrêt au-delà du plafond')
assert.ok(nameLike('mateo', 'matteo'))
assert.ok(nameLike('lukas', 'lucas'))
assert.ok(!nameLike('le', 'lea'), 'mots trop courts : pas d’approchant')

type P = { id: string; firstName: string; lastName: string; club?: string; team?: string; license?: string }
const people: P[] = [
  { id: '1', firstName: 'Lucas', lastName: 'Martin', club: 'Toulon Handball', license: '6383015001234' },
  { id: '2', firstName: 'Matteo', lastName: 'Dupont', club: 'US Ivry Handball', license: '6375001000001' },
  { id: '3', firstName: 'Jean-Pierre', lastName: 'Lefèvre', club: 'Istres Provence Handball' },
  { id: '4', firstName: 'Léa', lastName: 'Martin', club: 'Hand Ball Club Aix' },
  { id: '5', firstName: 'Kévin', lastName: 'Morin' },
]
const find = (q: string) => {
  const r = searchByName(people, q, playerHaystack, nameTokens)
  return [r.list.map((p) => p.id).join(','), r.approx] as [string, boolean]
}
assert.deepEqual(find(''), ['1,2,3,4,5', false])
assert.deepEqual(find('Lucas Martin'), ['1', false])
assert.deepEqual(find('martin'), ['1,4', false])
assert.deepEqual(find('MARTIN léa'), ['4', false])
assert.deepEqual(find('jean pierre'), ['3', false])
assert.deepEqual(find('Jean-Pierre'), ['3', false])
assert.deepEqual(find('jeanpierre'), ['3', false])
assert.deepEqual(find('lefevre'), ['3', false], 'sans accent')
assert.deepEqual(find('ivry'), ['2', false], 'club')
assert.deepEqual(find('638 301 500 1234'), ['1', false], 'licence dite par morceaux')
assert.deepEqual(find('6375001'), ['2', false], 'début de licence')
// Approchants : seulement si la recherche exacte ne trouve personne.
assert.deepEqual(find('Dupond'), ['2', true])
assert.deepEqual(find('Mathéo Dupond'), ['2', true])
assert.deepEqual(find('Lefebvre'), ['3', true])
assert.deepEqual(find('Lukas Martin'), ['1', true])
assert.deepEqual(find('Kevin Maurin'), ['5', true])
assert.deepEqual(find('Zidane'), ['', false], 'personne, pas d’approchant inventé')
assert.deepEqual(find('Martin Toulouse'), ['', false], 'un mot sans rapport : personne')
assert.deepEqual(find('12345'), ['', false], 'chiffres : pas d’approchant')
// Grande base : 40 000 fiches, recherche exacte puis approchante en un temps raisonnable.
const big: P[] = Array.from({ length: 40_000 }, (_, i) => ({ id: String(i), firstName: ['Lucas', 'Léa', 'Hugo', 'Emma'][i % 4], lastName: `Nom${i}`, club: `Club ${i % 300}`, license: String(6300000000000 + i) }))
big.push({ id: 'x', firstName: 'Matteo', lastName: 'Dupont' })
const hayCache = new Map<P, string>()
const hayOfBig = (p: P) => hayCache.get(p) ?? (hayCache.set(p, playerHaystack(p)), hayCache.get(p)!)
let t0 = performance.now()
assert.equal(searchByName(big, 'dupont', hayOfBig, nameTokens).list.length, 1)
const tExact = performance.now() - t0
t0 = performance.now()
const near = searchByName(big, 'dupond', hayOfBig, nameTokens)
const tNear = performance.now() - t0
assert.deepEqual([near.list.map((p) => p.id), near.approx], [['x'], true])
console.log(`Recherche par nom sur 40 001 fiches : exacte ${Math.round(tExact)} ms (textes préparés compris), approchante ${Math.round(tNear)} ms`)
assert.ok(tNear < 1500, 'recherche approchante assez rapide')

console.log('Recherche vocale : tous les tests passent.')


