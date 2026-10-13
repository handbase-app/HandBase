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
  type SearchContext,
} from '../src/voiceSearch'
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
assert.deepEqual(schema.poste.valeurs?.map((v) => v.valeur), ['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV', 'aucun'])
assert.equal(schema.departement.valeurs?.find((v) => v.valeur === '83')?.sens, 'Var')
assert.deepEqual(schema.groupe.valeurs?.map((v) => v.valeur), ['Intercomités 2011', 'Sélection Var U15', 'Sélection Var U13'])
assert.equal(schema.club.valeurs, undefined, 'les clubs ne sont pas envoyés')
const sent = JSON.stringify(schema)
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
  'Compris : filles · nées en 2011 · trimestre 1 (janv.–mars) · gauchers · 83 · Var · Saint-Raphaël Var Handball · mes suivis · au Pôle Espoirs · avec une vidéo · arrière droit · + postes secondaires',
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
)
assert.deepEqual(ans, { filtres: { annee: 2010 }, nonGere: ['U15'], ms: 400, restantMois: 10, restantJour: 5 })
assert.equal(calls[0].url, ep.url + '?mode=filtres')
assert.equal(calls[0].init?.method, 'POST')
const hdr = calls[0].init?.headers as Record<string, string>
assert.equal(hdr['Content-Type'], 'application/json')
assert.equal(hdr.Authorization, 'Bearer t')
const body = JSON.parse(String(calls[0].init?.body))
assert.deepEqual(Object.keys(body), ['phrase', 'schema'], 'seulement la phrase et le schéma')
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

console.log('Recherche vocale : tous les tests passent.')
