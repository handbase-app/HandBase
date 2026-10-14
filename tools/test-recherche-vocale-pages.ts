// Test de la recherche vocale « micro ✨ » des autres pages (src/voicePages.ts, src/voiceFilters.ts) : bilan de
// détection, Événements, Groupes, et la liste Joueurs (page « joueurs »). Schémas envoyés (aucune donnée
// de joueur, aucun nom d'événement, de groupe ou de club), relecture des réponses du modèle (valeurs revérifiées),
// actions (remplacer, ajouter, retirer, effacer), exemples des consignes de la fonction « transcrire » pour chaque page,
// champ « page » et modes annoncés (faux fetch : aucun appel réseau, rien n'est envoyé à Mistral).
//
//   npx jiti tools/test-recherche-vocale-pages.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { localCommand, notFoundText, outcomeText, pageApply, pageHas, unsupportedText, type ModelAnswer, type VoicePage } from '../src/voiceFilters'
import {
  bilanVoicePage,
  EMPTY_EVENTS,
  EMPTY_GROUPS,
  eventsVoicePage,
  groupsVoicePage,
  type BilanVoice,
  type BilanVoiceContext,
  type EventsVoice,
  type GroupsVoice,
} from '../src/voicePages'
import { applyAnswer, buildSchema, EMPTY_FILTERS, type SearchContext } from '../src/voiceSearch'
import { requestAccess, understandFilters, type Endpoint } from '../src/dictation/transcribe'

const REGIONS: Record<string, string> = { '83': 'region-sud', '13': 'region-sud', '06': 'region-sud', '75': 'region-idf', '35': 'region-bre', '29': 'region-bre' }
const places = {
  regions: [
    { id: 'region-sud', name: 'Région Sud' },
    { id: 'region-idf', name: 'Île-de-France' },
    { id: 'region-bre', name: 'Bretagne' },
  ],
  depts: [
    { code: '06', name: 'Alpes-Maritimes' },
    { code: '13', name: 'Bouches-du-Rhône' },
    { code: '29', name: 'Finistère' },
    { code: '35', name: 'Ille-et-Vilaine' },
    { code: '75', name: 'Paris' },
    { code: '83', name: 'Var' },
  ],
  regionOfDept: (c: string) => REGIONS[c],
}

// ---------- Consignes de la fonction : exemples de chaque page ----------
const fn = readFileSync(new URL('../supabase/functions/transcrire/index.ts', import.meta.url), 'utf8')
function pageExamples(page: string) {
  const start = fn.indexOf(`  ${page}: \``)
  assert.ok(start > 0, `consignes de la page ${page}`)
  const text = fn.slice(start, fn.indexOf('`,', start))
  const ex = [...text.matchAll(/^Actuels (\{.*?\}) ; « (.*) » → (\{.*\})$/gm)]
  assert.ok(ex.length >= 5, `${page} : ${ex.length} exemples`)
  return { text, ex }
}
/** Chaque réponse d'exemple est acceptée par l'appli, garde ses clés dans le schéma et change les filtres. */
function checkExamples<V extends object>(name: string, page: VoicePage<V>, toValues: (a: Record<string, unknown>) => V) {
  const schema = page.schema()
  const { text, ex } = pageExamples(name)
  const seen = new Set<string>()
  for (const [, actuels, phrase, reponse] of ex) {
    const before = toValues(JSON.parse(actuels))
    const r = JSON.parse(reponse) as Required<ModelAnswer> & { filtres: Record<string, unknown>; retirer: string[] }
    assert.deepEqual(Object.keys(r), ['action', 'filtres', 'retirer', 'nonGere'], phrase)
    seen.add(r.action as string)
    const out = pageApply(page, r, before)
    assert.equal(out.action, r.action, phrase)
    assert.equal(out.notFound.length, 0, `${phrase} : ${out.notFound}`)
    assert.equal(out.unsupported.length, 0, `${phrase} : ${out.unsupported}`)
    assert.ok(out.changed, `l'exemple change les filtres : ${phrase}`)
    for (const k of [...Object.keys(r.filtres), ...r.retirer, ...Object.keys(JSON.parse(actuels))]) assert.ok(k in schema, `${phrase} : clé ${k}`)
    if (localCommand(phrase)) assert.equal(r.action, 'effacer', phrase)
  }
  assert.deepEqual([...seen].sort(), ['ajouter', 'effacer', 'remplacer', 'retirer'], name)
  const chars = text.length + Object.entries(schema).map(([k, v]) => `${k} : ${v}`).join('\n').length
  console.log(`Consignes « ${name} » ≈ ${chars} caractères (≈ ${Math.round(chars / 3.5)} jetons, actions communes comprises)`)
  assert.ok(chars < 6000, 'consignes compactes')
}

// ---------- Bilan de détection ----------
const bilanCtx: BilanVoiceContext = {
  ...places,
  clubs: [
    { key: 'toulon handball', name: 'Toulon Handball', dept: '83' },
    { key: 'hbc toulon saint-cyr var', name: 'HBC Toulon Saint-Cyr Var', dept: '83' },
    { key: 'toulon saint-cyr', name: 'Toulon Saint-Cyr', dept: '13' },
    { key: 'cesson rennes', name: 'Cesson Rennes Métropole HB', dept: '35' },
    { key: 'istres provence', name: 'Istres Provence Handball', dept: '13' },
  ],
  thisYear: 2026,
  view: 'map',
  season: '2026-2027',
}
const bilan = bilanVoicePage(bilanCtx)
const B0: BilanVoice = { sex: 'all', period: 'season', year: null, region: '', dept: '', club: null, view: 'map' }
const bSchema = bilan.schema()
assert.deepEqual(Object.keys(bSchema), ['sexe', 'annee', 'periode', 'region', 'departement', 'club', 'vue'])
const bSent = JSON.stringify(bSchema)
for (const c of bilanCtx.clubs) assert.ok(!bSent.includes(c.name), `club absent du schéma : ${c.name}`)
for (const d of places.depts) assert.ok(!bSent.includes(d.name), `département absent du schéma : ${d.name}`)
assert.equal(bilan.mode, undefined, 'bilan : consignes de la liste Joueurs suffisent (fonction déjà déployée)')

let b = pageApply(bilan, { action: 'remplacer', filtres: { sexe: 'F', annee: 2011, departement: 'Var' } }, B0)
assert.deepEqual(b.values, { ...B0, sex: 'F', year: '2011', dept: '83', region: 'region-sud' }, 'département : sa région suit (carte)')
assert.equal(outcomeText(b, false), 'Compris : filles · génération 2011 · Var (83)')
// Club : retrouvé dans le département choisi ; il amène son lieu sinon.
b = pageApply(bilan, { action: 'remplacer', filtres: { club: 'Saint-Cyr' } }, B0)
assert.deepEqual([b.changed, notFoundText(b)], [false, 'Non appliqué : club « Saint-Cyr » (2 clubs possibles : choisissez dans la liste)'], 'deux clubs de Saint-Cyr')
b = pageApply(bilan, { action: 'ajouter', filtres: { club: 'Saint-Cyr' } }, { ...B0, year: '2010', dept: '83', region: 'region-sud' })
assert.deepEqual(b.values, { ...B0, year: '2010', dept: '83', region: 'region-sud', club: 'hbc toulon saint-cyr var' }, 'un seul dans le Var')
b = pageApply(bilan, { action: 'ajouter', filtres: { club: 'Toulon' } }, { ...B0, year: '2010', dept: '83', region: 'region-sud' })
assert.deepEqual(b.values, { ...B0, year: '2010', dept: '83', region: 'region-sud', club: 'toulon handball' })
b = pageApply(bilan, { action: 'remplacer', filtres: { club: 'Cesson' } }, B0)
assert.deepEqual(b.values, { ...B0, club: 'cesson rennes', dept: '35', region: 'region-bre' }, 'le club amène son département et sa région')
b = pageApply(bilan, { action: 'ajouter', filtres: { club: 'Cesson' } }, { ...B0, sex: 'M' })
assert.deepEqual(b.values, { ...B0, sex: 'M', club: 'cesson rennes', dept: '35', region: 'region-bre' })
b = pageApply(bilan, { action: 'remplacer', filtres: { club: 'Real Madrid' } }, B0)
assert.deepEqual([b.changed, notFoundText(b)], [false, 'Non appliqué : club « Real Madrid » (pas trouvé dans la base)'])
// Période, vue, génération inconnue.
b = pageApply(bilan, { action: 'ajouter', filtres: { periode: 'toujours' } }, { ...B0, year: '2010' })
assert.deepEqual([b.values.period, outcomeText(b, true)], ['all', 'Ajouté : depuis toujours'])
assert.equal(pageApply(bilan, { action: 'remplacer', filtres: { periode: 'cette saison', annee: 'inconnue' } }, { ...B0, period: 'all' }).values.year, '')
b = pageApply(bilan, { action: 'ajouter', filtres: { vue: 'generations' } }, { ...B0, sex: 'F' })
assert.deepEqual(b.values, { ...B0, sex: 'F', view: 'years' })
// Région ajoutée : département et club d'avant partent (comme un toucher sur la carte) ; retirer le département garde la région.
b = pageApply(bilan, { action: 'ajouter', filtres: { region: 'Bretagne' } }, { ...B0, dept: '83', region: 'region-sud', club: 'toulon handball' })
assert.deepEqual(b.values, { ...B0, region: 'region-bre' })
b = pageApply(bilan, { action: 'retirer', retirer: ['departement'] }, { ...B0, dept: '83', region: 'region-sud', club: 'toulon handball' })
assert.deepEqual([b.values, outcomeText(b, true)], [{ ...B0, region: 'region-sud' }, 'Retiré : département'])
b = pageApply(bilan, { action: 'retirer', retirer: ['la région'] }, { ...B0, dept: '83', region: 'region-sud', year: '2011' })
assert.deepEqual(b.values, { ...B0, year: '2011' })
// Effacer : la vue affichée ne change pas.
const yearsView = bilanVoicePage({ ...bilanCtx, view: 'years' })
b = pageApply(yearsView, { action: 'effacer' }, { ...B0, view: 'years', sex: 'M', period: 'all', dept: '83', region: 'region-sud' })
assert.deepEqual(b.values, { ...B0, view: 'years' })
assert.equal(pageHas(yearsView, { ...B0, view: 'years' }), false, 'la vue seule n’est pas un filtre')
// Valeurs inventées.
b = pageApply(bilan, { action: 'remplacer', filtres: { annee: 2031, periode: 'hier', vue: 'tableau', poste: 'DC' } }, B0)
assert.equal(b.changed, false)
assert.equal(notFoundText(b), 'Non appliqué : génération « 2031 » (pas une année de naissance) ; période « hier » (valeur inconnue) ; vue « tableau » (valeur inconnue)')
assert.equal(unsupportedText(b), 'Je ne sais pas encore filtrer sur : « poste »')
// Filtres actifs envoyés : clés du schéma, pas de clé de club.
assert.deepEqual(bilan.current({ ...B0, sex: 'F', year: '', period: 'all', region: 'region-sud', dept: '83', club: 'toulon handball' }), {
  sexe: 'F',
  annee: 'inconnue',
  periode: 'toujours',
  region: 'Région Sud',
  departement: '83',
  club: 'Toulon Handball',
  vue: 'carte',
})
assert.equal(bilan.current({ ...B0, dept: '?' }).departement, 'non renseigné')
checkExamples('bilan', bilan, (a) => {
  const v = pageApply(bilan, { action: 'remplacer', filtres: a }, B0).values
  return v
})
// Le cas d'usage : génération et département, puis le club.
const toulon = pageExamples('bilan').ex.find((e) => e[2].includes('Toulon'))!
assert.deepEqual(pageApply(bilan, JSON.parse(toulon[3]), { ...B0, year: '2010', dept: '83', region: 'region-sud' }).notFound.length, 0)

// ---------- Événements ----------
const TYPES = [
  { value: 'match', label: 'Match' },
  { value: 'tournoi', label: 'Tournoi' },
  { value: 'entrainement', label: 'Entraînement' },
  { value: 'observation', label: 'Observation' },
]
const events = eventsVoicePage({ types: TYPES, names: ['Tournoi de Cannes 2025', 'Tournoi de Cannes 2024', 'Match Toulon – Nice', 'Toulon', 'Intercomités U13', 'Cannes'], years: ['2024', '2025', '2026'] })
assert.equal(events.mode, 'filtres_evenements', 'bouton seulement avec une fonction à jour')
const eSchema = events.schema()
assert.deepEqual(Object.keys(eSchema), ['recherche', 'type', 'annee', 'mesEvenements'])
assert.ok(!JSON.stringify(eSchema).includes('Cannes'), 'noms d’événements absents du schéma')
let e = pageApply(events, { action: 'remplacer', filtres: { type: 'tournois', annee: 2025 } }, EMPTY_EVENTS)
assert.deepEqual([e.values, outcomeText(e, false)], [{ ...EMPTY_EVENTS, type: 'tournoi', year: '2025' }, 'Compris : tournoi · en 2025'])
e = pageApply(events, { action: 'remplacer', filtres: { type: 'stage' } }, EMPTY_EVENTS)
assert.equal(e.values.type, 'entrainement')
// Nom ou lieu : retrouvé parmi les événements ; plusieurs : les mots qui les trouvent tous ; aucun : écarté.
assert.equal(pageApply(events, { filtres: { recherche: 'Intercomités' } }, EMPTY_EVENTS).values.q, 'Intercomités U13')
e = pageApply(events, { filtres: { recherche: 'le tournoi de Cannes' } }, EMPTY_EVENTS)
assert.deepEqual([e.values.q, e.added[0].label], ['tournoi cannes', '« le tournoi de Cannes » (2 possibles)'])
e = pageApply(events, { filtres: { recherche: 'Marseille' } }, EMPTY_EVENTS)
assert.deepEqual([e.changed, notFoundText(e)], [false, 'Non appliqué : recherche « Marseille » (aucun événement de ce nom ou à ce lieu)'])
assert.equal(pageApply(events, { filtres: { recherche: '(nom)' } }, EMPTY_EVENTS).changed, false, 'valeur de remplacement ignorée')
// Année sans événement, type inventé.
e = pageApply(events, { filtres: { annee: 2019, type: 'réunion' } }, EMPTY_EVENTS)
assert.equal(notFoundText(e), 'Non appliqué : type « réunion » (valeur inconnue) ; année « 2019 » (aucun événement cette année-là)')
e = pageApply(events, { action: 'ajouter', filtres: { mesEvenements: true } }, { ...EMPTY_EVENTS, type: 'match' })
assert.deepEqual(e.values, { ...EMPTY_EVENTS, type: 'match', mine: true })
e = pageApply(events, { action: 'retirer', retirer: ['le nom'] }, { ...EMPTY_EVENTS, q: 'cannes', year: '2025' })
assert.deepEqual([e.values, outcomeText(e, true)], [{ ...EMPTY_EVENTS, year: '2025' }, 'Retiré : recherche'])
assert.deepEqual(events.current({ q: 'Cannes', type: 'tournoi', year: '2025', mine: true }), { type: 'tournoi', annee: 2025, mesEvenements: true, recherche: '(nom)' }, 'du texte cherché, sa présence seulement')
checkExamples('evenements', events, (a) => {
  const v: EventsVoice = pageApply(events, { action: 'remplacer', filtres: { ...a, recherche: undefined } }, EMPTY_EVENTS).values
  return a.recherche ? { ...v, q: 'cannes' } : v
})

// ---------- Groupes ----------
const SCOPES = [
  { value: 'federation', label: 'Fédération' },
  { value: 'ligue', label: 'Ligue' },
  { value: 'comite', label: 'Comité' },
]
const groups = groupsVoicePage({ ...places, scopes: SCOPES, names: ['Intercomités 83 – 2011', 'Intercomités 13 – 2010', 'Pôle Espoirs garçons', 'Sélection Var U15'], years: ['2010', '2011', '2012'] })
assert.equal(groups.mode, 'filtres_groupes')
const gSchema = groups.schema()
assert.deepEqual(Object.keys(gSchema), ['recherche', 'portee', 'sexe', 'region', 'departement', 'annee'])
assert.ok(!JSON.stringify(gSchema).includes('Intercomités'), 'noms de groupes absents du schéma')
let g = pageApply(groups, { action: 'remplacer', filtres: { sexe: 'F', departement: 'Var' } }, EMPTY_GROUPS)
assert.deepEqual(g.values, { ...EMPTY_GROUPS, sex: 'F', dept: '83', region: 'region-sud' }, 'comité : sa ligue suit (comme le menu)')
assert.equal(outcomeText(g, false), 'Compris : filles · Var (83)')
g = pageApply(groups, { filtres: { sexe: 'mixtes', portee: 'régionaux', region: 'PACA' } }, EMPTY_GROUPS)
assert.deepEqual(g.values, { ...EMPTY_GROUPS, sex: 'mixte', scope: 'ligue', region: 'region-sud' })
// Fédération : pas de territoire ; ligue : pas de comité.
g = pageApply(groups, { filtres: { portee: 'federation', region: 'PACA' } }, EMPTY_GROUPS)
assert.deepEqual([g.values, notFoundText(g)], [{ ...EMPTY_GROUPS, scope: 'federation' }, 'Non appliqué : ligue « PACA » (les groupes de la Fédération n’ont pas de territoire)'])
g = pageApply(groups, { filtres: { portee: 'ligue', departement: '83' } }, EMPTY_GROUPS)
assert.deepEqual([g.values, notFoundText(g)], [{ ...EMPTY_GROUPS, scope: 'ligue' }, 'Non appliqué : comité « 83 » (les groupes de ligue n’ont pas de comité)'])
g = pageApply(groups, { action: 'ajouter', filtres: { portee: 'federation' } }, { ...EMPTY_GROUPS, dept: '83', region: 'region-sud', sex: 'M' })
assert.deepEqual(g.values, { ...EMPTY_GROUPS, scope: 'federation', sex: 'M' })
g = pageApply(groups, { action: 'ajouter', filtres: { region: 'Bretagne' } }, { ...EMPTY_GROUPS, dept: '83', region: 'region-sud' })
assert.deepEqual(g.values, { ...EMPTY_GROUPS, region: 'region-bre' }, 'nouvelle ligue : le comité d’ailleurs part')
g = pageApply(groups, { action: 'ajouter', filtres: { departement: '13' } }, { ...EMPTY_GROUPS, sex: 'F' })
assert.deepEqual(g.values, { ...EMPTY_GROUPS, sex: 'F', dept: '13', region: 'region-sud' })
g = pageApply(groups, { action: 'retirer', retirer: ['ligue'] }, { ...EMPTY_GROUPS, dept: '83', region: 'region-sud', year: '2011' })
assert.deepEqual([g.values, outcomeText(g, true)], [{ ...EMPTY_GROUPS, year: '2011' }, 'Retiré : ligue'])
// Noms et années revérifiés.
assert.equal(pageApply(groups, { filtres: { recherche: 'pôle espoir garçons' } }, EMPTY_GROUPS).values.q, 'Pôle Espoirs garçons')
g = pageApply(groups, { filtres: { recherche: 'Intercomités' } }, EMPTY_GROUPS)
assert.deepEqual([g.values.q, g.added[0].label], ['intercomites', '« Intercomités » (2 possibles)'])
g = pageApply(groups, { filtres: { recherche: 'Sport-études', annee: 2009 } }, EMPTY_GROUPS)
assert.equal(notFoundText(g), 'Non appliqué : année « 2009 » (aucun groupe de cette année) ; groupe « Sport-études » (aucun groupe de ce nom)')
assert.deepEqual(groups.current({ q: 'Pôle', scope: 'ligue', sex: 'F', dept: '', region: 'region-sud', year: '2011' }), {
  portee: 'ligue',
  sexe: 'F',
  region: 'Région Sud',
  annee: 2011,
  recherche: '(nom)',
})
checkExamples('groupes', groups, (a) => {
  const v: GroupsVoice = pageApply(groups, { action: 'remplacer', filtres: { ...a, recherche: undefined } }, EMPTY_GROUPS).values
  return a.recherche ? { ...v, q: 'pole' } : v
})

// ---------- Liste Joueurs : page « joueurs », mode « filtres » ----------
const pctx: SearchContext = {
  positions: [{ id: 'DC', label: 'Demi-centre' }],
  ...places,
  clubs: ['Toulon Handball'],
  groups: [],
  profiles: [],
  thisYear: 2026,
}
assert.ok('departement' in buildSchema(pctx) && 'region' in buildSchema(pctx), 'région et département dans le schéma')
const n = applyAnswer({ action: 'remplacer', filtres: { region: 'Bretagne', sexe: 'F' } }, EMPTY_FILTERS, pctx)
assert.deepEqual(n.values, { ...EMPTY_FILTERS, region: 'region-bre', sex: 'F' })
// La liste Joueurs n'a plus de micro « Filtrer » : ses filtres sont une recette (src/playerQuery.ts, tools/test-filtres-recette.ts) ;
// les consignes « filtres » de la liste Joueurs restent dans la fonction pour les versions plus anciennes de l'appli.

// ---------- Commandes locales des nouvelles pages ----------
for (const p of ['montre tous les événements', 'affiche tous les groupes', 'efface tout']) assert.equal(localCommand(p), 'effacer', p)

// ---------- Appel : champ « page » (hors Joueurs), modes annoncés ----------
type Call = { url: string; init?: RequestInit }
const calls: Call[] = []
const fake = (body: unknown) =>
  (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
const ep: Endpoint = { url: 'https://x.supabase.co/functions/v1/transcrire', headers: { Authorization: 'Bearer t' } }
await understandFilters({ ...ep, fetch: fake({ action: 'remplacer', filtres: {} }) }, 'les tournois', events.schema(), {}, undefined, 'evenements')
await understandFilters({ ...ep, fetch: fake({}) }, 'nés en 2010', buildSchema(pctx), {}, undefined, 'joueurs')
await understandFilters({ ...ep, fetch: fake({}) }, 'nés en 2010', buildSchema(pctx), {})
const bodies = calls.map((c) => JSON.parse(String(c.init?.body)))
assert.deepEqual(Object.keys(bodies[0]), ['phrase', 'schema', 'actuels', 'page'])
assert.equal(bodies[0].page, 'evenements')
assert.deepEqual(Object.keys(bodies[1]), ['phrase', 'schema', 'actuels'], 'liste Joueurs : requête inchangée')
assert.deepEqual(Object.keys(bodies[2]), ['phrase', 'schema', 'actuels'])
for (const c of calls) assert.equal(c.url, ep.url + '?mode=filtres')
// Aucune donnée de joueur ni nom de groupe / d'événement dans ce qui part.
for (const body of bodies) for (const x of ['Cannes', 'Intercomités', 'Toulon Handball']) assert.ok(!JSON.stringify(body).includes(x), x)
const acc = await requestAccess({ ...ep, fetch: fake({ pret: true, modes: ['dictee', 'filtres', 'avis', 'filtres_bilan', 'filtres_evenements', 'filtres_groupes', 3] }) })
assert.deepEqual([acc.filtres, acc.modes], [true, ['dictee', 'filtres', 'avis', 'filtres_bilan', 'filtres_evenements', 'filtres_groupes']])
const old = await requestAccess({ ...ep, fetch: fake({ pret: true, modes: ['dictee', 'filtres', 'avis'] }) })
assert.ok(old.filtres && !old.modes?.includes('filtres_evenements'), 'fonction déployée d’avant : pas de bouton sur Événements ni Groupes')
assert.deepEqual(fn.match(/modes: \[([^\]]*)\]/)?.[1], `'dictee', 'filtres', 'avis', 'filtres_bilan', 'filtres_evenements', 'filtres_groupes', 'question', 'question_joueurs', 'sql'`)
// La fonction : page inconnue ou absente → consignes de la liste Joueurs.
assert.ok(fn.includes("Object.hasOwn(CONSIGNES_PAGES, entree.page) && CONSIGNES_PAGES[entree.page]) || CONSIGNES"))

console.log('Recherche vocale des pages (bilan, Joueurs, Événements, Groupes) : tous les tests passent.')
