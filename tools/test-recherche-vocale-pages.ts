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
import { bilanVoicePage, type BilanVoice, type BilanVoiceContext } from '../src/voicePages'
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
const B0: BilanVoice = { sex: 'all', period: 'season', years: [], region: '', dept: '', club: null, view: 'map' }
const bSchema = bilan.schema()
assert.deepEqual(Object.keys(bSchema), ['sexe', 'annee', 'periode', 'region', 'departement', 'club', 'vue'])
const bSent = JSON.stringify(bSchema)
for (const c of bilanCtx.clubs) assert.ok(!bSent.includes(c.name), `club absent du schéma : ${c.name}`)
for (const d of places.depts) assert.ok(!bSent.includes(d.name), `département absent du schéma : ${d.name}`)
assert.equal(bilan.mode, undefined, 'bilan : consignes de la liste Joueurs suffisent (fonction déjà déployée)')

let b = pageApply(bilan, { action: 'remplacer', filtres: { sexe: 'F', annee: 2011, departement: 'Var' } }, B0)
assert.deepEqual(b.values, { ...B0, sex: 'F', years: ['2011'], dept: '83', region: 'region-sud' }, 'département : sa région suit (carte)')
assert.equal(outcomeText(b, false), 'Compris : féminin · génération 2011 · Var (83)')
// Club : retrouvé dans le département choisi ; il amène son lieu sinon.
b = pageApply(bilan, { action: 'remplacer', filtres: { club: 'Saint-Cyr' } }, B0)
assert.deepEqual([b.changed, notFoundText(b)], [false, 'Non appliqué : club « Saint-Cyr » (2 clubs possibles : choisissez dans la liste)'], 'deux clubs de Saint-Cyr')
b = pageApply(bilan, { action: 'ajouter', filtres: { club: 'Saint-Cyr' } }, { ...B0, years: ['2010'], dept: '83', region: 'region-sud' })
assert.deepEqual(b.values, { ...B0, years: ['2010'], dept: '83', region: 'region-sud', club: 'hbc toulon saint-cyr var' }, 'un seul dans le Var')
b = pageApply(bilan, { action: 'ajouter', filtres: { club: 'Toulon' } }, { ...B0, years: ['2010'], dept: '83', region: 'region-sud' })
assert.deepEqual(b.values, { ...B0, years: ['2010'], dept: '83', region: 'region-sud', club: 'toulon handball' })
b = pageApply(bilan, { action: 'remplacer', filtres: { club: 'Cesson' } }, B0)
assert.deepEqual(b.values, { ...B0, club: 'cesson rennes', dept: '35', region: 'region-bre' }, 'le club amène son département et sa région')
b = pageApply(bilan, { action: 'ajouter', filtres: { club: 'Cesson' } }, { ...B0, sex: 'M' })
assert.deepEqual(b.values, { ...B0, sex: 'M', club: 'cesson rennes', dept: '35', region: 'region-bre' })
b = pageApply(bilan, { action: 'remplacer', filtres: { club: 'Real Madrid' } }, B0)
assert.deepEqual([b.changed, notFoundText(b)], [false, 'Non appliqué : club « Real Madrid » (pas trouvé dans la base)'])
// Période, vue, génération inconnue.
b = pageApply(bilan, { action: 'ajouter', filtres: { periode: 'toujours' } }, { ...B0, years: ['2010'] })
assert.deepEqual([b.values.period, outcomeText(b, true)], ['all', 'Ajouté : depuis toujours'])
assert.deepEqual(pageApply(bilan, { action: 'remplacer', filtres: { periode: 'cette saison', annee: 'inconnue' } }, { ...B0, period: 'all' }).values.years, [''])
b = pageApply(bilan, { action: 'ajouter', filtres: { vue: 'generations' } }, { ...B0, sex: 'F' })
assert.deepEqual(b.values, { ...B0, sex: 'F', view: 'years' })
// Plusieurs générations : une liste, une plage, « 2010 et 2012 » (src/birthYears.ts).
b = pageApply(bilan, { action: 'remplacer', filtres: { annee: [2010, 2012] } }, B0)
assert.deepEqual([b.values.years, outcomeText(b, false)], [['2012', '2010'], 'Compris : générations 2010, 2012'])
b = pageApply(bilan, { action: 'remplacer', filtres: { annee: { de: 2010, a: 2012 } } }, B0)
assert.deepEqual([b.values.years, outcomeText(b, false)], [['2012', '2011', '2010'], 'Compris : générations 2010 – 2012'])
assert.deepEqual(pageApply(bilan, { action: 'remplacer', filtres: { annee: '2010 et 2012' } }, B0).values.years, ['2012', '2010'])
assert.deepEqual(pageApply(bilan, { action: 'remplacer', filtres: { annee: 'entre 2010 et 2012' } }, B0).values.years, ['2012', '2011', '2010'])
assert.deepEqual(pageApply(bilan, { action: 'ajouter', filtres: { annee: [2011, 2013] } }, { ...B0, years: ['2009'] }).values.years, ['2013', '2011'], 'années redites : remplacent')
assert.equal(pageApply(bilan, { action: 'remplacer', filtres: { annee: [2010, 'x'] } }, B0).changed, false, 'liste illisible : rien deviné')
assert.equal(bilan.current({ ...B0, years: ['2012', '2010'] }).annee, '2012, 2010')
assert.equal(bilan.current({ ...B0, years: ['2011'] }).annee, 2011)
// Région ajoutée : département et club d'avant partent (comme un toucher sur la carte) ; retirer le département garde la région.
b = pageApply(bilan, { action: 'ajouter', filtres: { region: 'Bretagne' } }, { ...B0, dept: '83', region: 'region-sud', club: 'toulon handball' })
assert.deepEqual(b.values, { ...B0, region: 'region-bre' })
b = pageApply(bilan, { action: 'retirer', retirer: ['departement'] }, { ...B0, dept: '83', region: 'region-sud', club: 'toulon handball' })
assert.deepEqual([b.values, outcomeText(b, true)], [{ ...B0, region: 'region-sud' }, 'Retiré : département'])
b = pageApply(bilan, { action: 'retirer', retirer: ['la région'] }, { ...B0, dept: '83', region: 'region-sud', years: ['2011'] })
assert.deepEqual(b.values, { ...B0, years: ['2011'] })
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
assert.deepEqual(bilan.current({ ...B0, sex: 'F', years: [''], period: 'all', region: 'region-sud', dept: '83', club: 'toulon handball' }), {
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
assert.deepEqual(pageApply(bilan, JSON.parse(toulon[3]), { ...B0, years: ['2010'], dept: '83', region: 'region-sud' }).notFound.length, 0)

// ---------- Événements, Groupes : anciens micros « Filtrer » ----------
// Ces listes ont maintenant leurs filtres en recette (src/eventQuery.ts, src/groupQuery.ts : tools/test-filtres-recette-pages.ts).
// Les consignes « filtres » de ces pages restent dans la fonction pour les versions précédentes de l'appli : exemples encore
// lisibles (JSON, actions connues, clés de l'ancien schéma).
const OLD_KEYS: Record<string, string[]> = {
  evenements: ['recherche', 'type', 'annee', 'mesEvenements'],
  groupes: ['recherche', 'portee', 'sexe', 'region', 'departement', 'annee'],
}
for (const [name, keys] of Object.entries(OLD_KEYS)) {
  const { ex } = pageExamples(name)
  const seen = new Set<string>()
  for (const [, actuels, phrase, reponse] of ex) {
    const r = JSON.parse(reponse) as { action: string; filtres: Record<string, unknown>; retirer: string[] }
    seen.add(r.action)
    for (const k of [...Object.keys(r.filtres), ...r.retirer, ...Object.keys(JSON.parse(actuels))]) assert.ok(keys.includes(k), `${name} : ${phrase} : clé ${k}`)
  }
  assert.deepEqual([...seen].sort(), ['ajouter', 'effacer', 'remplacer', 'retirer'], name)
}

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
await understandFilters({ ...ep, fetch: fake({ action: 'remplacer', filtres: {} }) }, 'les tournois', { type: 'match, tournoi' }, {}, undefined, 'evenements')
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
assert.deepEqual(
  fn.match(/modes: \[([^\]]*)\]/)?.[1],
  `'dictee', 'filtres', 'avis', 'filtres_bilan', 'filtres_evenements', 'filtres_groupes', 'question', 'question_joueurs', 'question_evenements', 'question_groupes', 'sql'`,
)
// La fonction : page inconnue ou absente → consignes de la liste Joueurs.
assert.ok(fn.includes("Object.hasOwn(CONSIGNES_PAGES, entree.page) && CONSIGNES_PAGES[entree.page]) || CONSIGNES"))

console.log('Recherche vocale des pages (bilan, Joueurs, Événements, Groupes) : tous les tests passent.')
