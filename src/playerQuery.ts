// Liste Joueurs : les filtres sont une RECETTE (src/recipe.ts), le même moteur que « Poser une question » au bilan.
// Fonctions pures, sans base ni écran (testées par tools/test-filtres-recette.ts).
//
//  - JoueursQuery : la recette des filtres (population, conditions « vu », avis, mesures, tri de la liste), la recherche
//    par nom locale (`q`, comme le champ « Rechercher… » d'avant : nom, prénom, club, équipe, licence, noms approchants) et,
//    s'il y en a une, la question de CALCUL posée sur la sélection (`calc` : nombre, moyenne, petit tableau).
//  - isNameQuery : un simple nom (« Martin », « jean-pierre », une licence) reste une recherche locale instantanée, sans appel ;
//    une phrase (« nés en 2010 de plus d'1 m 85 », « quelle est la taille moyenne ? ») part au mode « question ».
//  - mergeQuery : RÈGLE DE COMBINAISON (demandée par Geoffroy) : une nouvelle phrase AJOUTE à la sélection (filtres posés à la
//    main ou par une phrase d'avant) ; une clé redite prend la nouvelle valeur (« seulement les filles » remplace la clé
//    sexe) ; on n'efface tout que si c'est dit (« efface tout et… », « recommence »), on ne retire que ce qui est dit
//    (« enlève la taille »). Une question de calcul s'applique à la sélection courante.
//  - decideAction / localQueryCommand : l'action, d'après la réponse du modèle et la phrase (jamais « remplacer » sans mot
//    explicite) ; commandes évidentes sans appel (« efface tout », « enlève la taille »).
//  - keysForModel : ce qui part avec la phrase : les NOMS des filtres posés seulement, jamais leurs valeurs ni un nom de
//    joueur (le nom cherché : sa présence seulement).
//  - selectPlayers : la liste filtrée (recette, puis recherche par nom), triée ; quickCounts : les nombres des menus.
//  - legacyToQuery : les anciens filtres rapides (src/voiceSearch.ts FilterValues) en recette (mêmes joueurs retenus).
// Uniquement des formulations positives ou neutres sur les jeunes.

import {
  buildIndex,
  checkQuantities,
  cleanRecipe,
  defaultSort,
  EMPTY_RECIPE,
  type Chip,
  type Output,
  type Population,
  type QuestionContext,
  type QData,
  type QIndex,
  type QPlayer,
  type Recipe,
  runRecipe,
} from './recipe'
import { localCommand, normalize } from './voiceFilters'
import { currentSport } from './sportConfig'
import { searchByName } from './nameMatch'
import { clubKey } from './coverage'
import { inYears, putYears, yearsOf } from './birthYears'
import type { FilterValues } from './voiceSearch'

export type JoueursQuery = {
  /** Filtres et tri de la liste (sortie toujours « liste »). */
  recipe: Recipe
  /** Recherche par nom locale (nom, prénom, club, équipe, licence). */
  q: string
  /** Question de calcul sur la sélection (nombre, tableau), affichée au-dessus de la liste. */
  calc?: Output
}

export const EMPTY_QUERY: JoueursQuery = { recipe: EMPTY_RECIPE, q: '' }

/** Clés de la session (sessionStorage) : la liste, ses pastilles, la ligne de résultat et le mode avancé, retrouvés au retour d'une fiche. */
export const JOUEURS_KEYS = {
  query: 'handbase.joueurs.recette',
  text: 'handbase.joueurs.texte',
  result: 'handbase.joueurs.resultat',
  sql: 'handbase.joueurs.sql',
} as const

/** Recette de la liste : les filtres, sortie « liste » avec son tri (jamais de calcul). */
export function listRecipe(r: Recipe): Recipe {
  const o = r.out
  const out: Output = { type: 'list' }
  if (o.type === 'list') {
    if (o.sort) out.sort = o.sort
    if (o.avg) out.avg = o.avg
    if (o.measure) out.measure = o.measure
    if (o.period) out.period = o.period
    if (o.limit) out.limit = o.limit
  }
  return cleanRecipe({ ...r, out })
}

/** Question de calcul : la sortie demandée, appliquée aux filtres de la liste. La carte devient un tableau par département. */
export function calcOutput(o: Output): Output | undefined {
  if (o.type === 'list') return undefined
  if (o.type === 'map') return { type: 'table', groupBy: 'dept' }
  return { ...o }
}

/** Recette qui calcule la réponse (filtres de la liste + sortie du calcul), ou null. */
export function calcRecipe(qy: JoueursQuery): Recipe | null {
  if (!qy.calc) return null
  const r = cleanRecipe({ ...qy.recipe, out: qy.calc })
  return r.out.type === 'list' ? null : r
}

/** Requête lue dans la session (rien n'y est cru). */
export function cleanQuery(v: unknown): JoueursQuery {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const recipe = listRecipe(cleanRecipe(o.recipe))
  const q = typeof o.q === 'string' ? o.q.slice(0, 80) : ''
  const calcR = o.calc && typeof o.calc === 'object' ? cleanRecipe({ out: o.calc }).out : undefined
  return { recipe, q, ...(calcR && calcR.type !== 'list' ? { calc: calcR } : {}) }
}

// ---------- Clés des filtres ----------

/** Un filtre de la liste (une ou plusieurs valeurs de la recette ; « positions » : postes, secondaires, sans poste). */
export type FilterKey =
  | 'sex'
  | 'names'
  | 'years'
  | 'quarter'
  | 'positions'
  | 'regions'
  | 'depts'
  | 'clubs'
  | 'height'
  | 'hand'
  | 'groups'
  | 'events'
  | 'pole'
  | 'followed'
  | 'video'
  | 'profiles'
  | 'seen'
  | 'avis'
  | 'nbAvis'
  | 'measures'
  | 'sort'
  | 'q'

/** Nom de chaque filtre pour le modèle (mêmes mots que la description de la recette). */
export const MODEL_KEYS: Record<FilterKey, string> = {
  sex: 'sexe',
  names: 'noms',
  years: 'annee',
  quarter: 'trimestre',
  positions: 'postes',
  regions: 'regions',
  depts: 'departements',
  clubs: 'clubs',
  height: 'taille',
  hand: 'lateralite',
  groups: 'groupes',
  events: 'evenements',
  pole: 'pole',
  followed: 'suivis',
  video: 'avecVideo',
  profiles: 'profils',
  seen: 'vus',
  avis: 'avis',
  nbAvis: 'nbAvis',
  measures: 'mesures',
  sort: 'tri',
  q: 'recherche',
}

/** Nom court d'un filtre (« Retiré : taille »). */
export const KEY_LABEL: Record<FilterKey, string> = {
  sex: 'masculin / féminin',
  names: 'prénom ou nom',
  years: 'année',
  quarter: 'trimestre',
  positions: 'poste',
  regions: 'région',
  depts: 'département',
  clubs: 'club',
  height: 'taille',
  hand: 'latéralité',
  groups: 'groupe',
  events: 'événement',
  pole: 'Pôle Espoirs',
  followed: 'suivis',
  video: 'vidéo',
  profiles: 'profil',
  seen: 'vus',
  avis: 'notes d’avis',
  nbAvis: 'nombre d’avis',
  measures: 'mesures',
  sort: 'tri',
  q: 'recherche par nom',
}

// Mots dits (ou rendus par le modèle dans « retirer ») pour chaque filtre, sans accents.
const KEY_WORDS: Record<string, FilterKey[]> = {
  sexe: ['sex'], genre: ['sex'], garcons: ['sex'], filles: ['sex'], garcon: ['sex'], fille: ['sex'],
  masculin: ['sex'], masculins: ['sex'], feminin: ['sex'], feminins: ['sex'], feminine: ['sex'], feminines: ['sex'],
  noms: ['names', 'q'], nom: ['names', 'q'], prenom: ['names', 'q'], prenoms: ['names', 'q'], recherche: ['q', 'names'], licence: ['q'],
  annee: ['years'], annees: ['years'], age: ['years'], naissance: ['years'], generation: ['years'],
  trimestre: ['quarter'],
  postes: ['positions'], poste: ['positions'], postessecondaires: ['positions'], sansposte: ['positions'],
  regions: ['regions'], region: ['regions'], ligue: ['regions'],
  departements: ['depts'], departement: ['depts'], dept: ['depts'],
  clubs: ['clubs'], club: ['clubs'],
  taille: ['height'], tailles: ['height'], tailleMin: ['height'], taillemin: ['height'], taillemax: ['height'], hauteur: ['height'],
  lateralite: ['hand'], main: ['hand'], gauchers: ['hand'], droitiers: ['hand'],
  groupes: ['groups'], groupe: ['groups'],
  evenements: ['events'], evenement: ['events'],
  pole: ['pole'],
  suivis: ['followed'],
  avecvideo: ['video'], video: ['video'], videos: ['video'],
  profils: ['profiles'], profil: ['profiles'],
  vus: ['seen'], vu: ['seen'], passages: ['seen'],
  avis: ['avis'], notes: ['avis'], note: ['avis'], moyenne: ['avis'],
  nbavis: ['nbAvis'],
  mesures: ['measures'], mesure: ['measures'],
  tri: ['sort'], ordre: ['sort'], classement: ['sort'],
}

/** Filtres d'un mot (« la taille », « tailleMin », « filtre année ») ; [] si inconnu. */
export function keysOfWord(v: unknown): FilterKey[] {
  if (typeof v !== 'string') return []
  const w = normalize(v)
    .split(' ')
    .filter((x) => !['le', 'la', 'les', 'l', 'filtre', 'filtres', 'critere', 'condition', 'de', 'd', 'du', 'des', 'sur', 'par', 'mon', 'ma', 'mes', 'a'].includes(x))
  if (!w.length) return []
  return KEY_WORDS[w.join('')] ?? KEY_WORDS[w[0]] ?? []
}

/** Filtres posés (dans l'ordre des pastilles). */
export function activeKeys(qy: JoueursQuery): FilterKey[] {
  const p = qy.recipe.pop
  const r = qy.recipe
  const k: FilterKey[] = []
  if (p.sex) k.push('sex')
  if (p.names) k.push('names')
  if (p.years) k.push('years')
  if (p.quarter) k.push('quarter')
  if (p.positions || p.noPosition) k.push('positions')
  if (p.regions) k.push('regions')
  if (p.depts) k.push('depts')
  if (p.clubs) k.push('clubs')
  if (p.hMin || p.hMax) k.push('height')
  if (p.hand) k.push('hand')
  if (p.groups) k.push('groups')
  if (p.events) k.push('events')
  if (p.pole) k.push('pole')
  if (p.followed) k.push('followed')
  if (p.video) k.push('video')
  if (p.profiles) k.push('profiles')
  if (r.seen) k.push('seen')
  if (r.avis.length) k.push('avis')
  if (r.nbAvis) k.push('nbAvis')
  if (r.measures.length) k.push('measures')
  if (r.out.sort) k.push('sort')
  if (qy.q.trim()) k.push('q')
  return k
}

/** Au moins un filtre (ou un tri) posé. */
export const hasQuery = (qy: JoueursQuery) => activeKeys(qy).length > 0

/**
 * Nombre montré sur le bouton « Filtres » (« Filtres 3 ») : un par champ posé, quel que soit le nombre de valeurs cochées
 * (« Ailier G. ou Ailier D. » compte pour un), tri compris ; ni le nom cherché (il est dans le champ) ni les filtres que
 * l'écran commande lui-même (`hidden` : barre posée du bilan).
 */
export const filterCount = (qy: JoueursQuery, hidden?: ReadonlySet<FilterKey>) => activeKeys(qy).filter((k) => k !== 'q' && !hidden?.has(k)).length

/** Envoyé avec la phrase : les NOMS des filtres posés, jamais leurs valeurs (le nom cherché : sa présence seulement). */
export const keysForModel = (qy: JoueursQuery): string[] => activeKeys(qy).map((k) => MODEL_KEYS[k])

/** Retire des filtres de la recette (et la recherche par nom). */
export function removeKeys(qy: JoueursQuery, keys: Iterable<FilterKey>): JoueursQuery {
  const r: Recipe = structuredClone(qy.recipe)
  let q = qy.q
  const p = r.pop
  for (const k of keys) {
    switch (k) {
      case 'positions':
        delete p.positions
        delete p.secondary
        delete p.noPosition
        break
      case 'height':
        delete p.hMin
        delete p.hMax
        break
      case 'seen':
        delete r.seen
        break
      case 'avis':
        r.avis = []
        break
      case 'nbAvis':
        delete r.nbAvis
        break
      case 'measures':
        r.measures = []
        break
      case 'sort':
        r.out = { type: 'list' }
        break
      case 'q':
        q = ''
        break
      case 'years':
        delete p.years
        delete p.yearList
        break
      default:
        delete p[k as keyof Population]
    }
  }
  return { ...qy, recipe: listRecipe(r), q }
}

// ---------- Simple nom ou phrase ----------

// Mots qui ne sont pas des noms (critères, verbes, questions) : la saisie est alors une phrase.
const NOT_NAME = new Set(
  (
    'les des tous toutes tout qui que quel quelle quels quelles combien comment pourquoi ou moyenne moyen moyens moyennes taille tailles age ages ' +
    'ne nes nee nees garcon garcons fille filles masculin masculins masculine masculines feminin feminins feminine feminines joueuse joueuses joueur joueurs gaucher gauchers gauchere gaucheres droitier droitiers droitiere ' +
    'droitieres ambidextre ambidextres gardien gardiens gardienne gardiennes pivot pivots ailier ailiers ailiere ailieres arriere arrieres demi demis ' +
    'centre centres plus moins avec sans vus vu vue vues jamais efface effacer enleve enlever retire retirer trie trier tri classe classes par ' +
    'meilleur meilleurs meilleure meilleures note notes avis mesure mesures pole video videos suivis groupe groupes club clubs region regions ' +
    'departement departements et en dans montre affiche cherche trouve liste seulement uniquement recommence reinitialise mesurent mesure ' +
    'mesurant ont a sont est nombre annee annees trimestre poste postes lateralite generation generations sexe priorite prioritaires progression ' +
    'evenement evenements tournoi stage saison depuis cm metre metres dis donne'
  ).split(' '),
)
// Postes d'un autre sport que le handball (selon le sport de l'installation) : des mots de critère aussi, pas des noms.
const NOT_NAME_SPORT: Record<string, Set<string>> = {
  volley: new Set(
    (
      'passeur passeurs passeuse passeuses central centraux centrale centrales pointu pointus pointue pointues oppose opposes opposee opposees ' +
      'libero liberos receptionneur receptionneurs receptionneuse receptionneuses attaquant attaquants attaquante attaquantes r4'
    ).split(' '),
  ),
}
// Particules des noms composés (« De La Cruz », « Van Damme ») : jamais seules.
const PARTICLES = new Set(['de', 'du', 'la', 'le', 'van', 'von', 'da', 'di', 'del', 'della', 'ben', 'el', 'al', 'mc', 'mac', 'dos', 'das', 'st', 'saint', 'sainte'])

/**
 * La saisie est-elle un simple nom (recherche locale instantanée, sans appel) ? Un à trois mots sans chiffre ni mot de
 * critère (« Martin », « jean-pierre », « De La Cruz ») ; ou un numéro de licence (5 chiffres ou plus, espaces permis).
 * Vide : oui (la recherche est effacée). Une année seule (« 2010 ») est une phrase.
 */
export function isNameQuery(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (/^[\d\s.-]+$/.test(t)) return t.replace(/\D/g, '').length >= 5
  if (/[^\p{L}\s'’-]/u.test(t)) return false
  const ws = normalize(t).split(' ').filter(Boolean)
  if (!ws.length || ws.length > 4) return false
  const sportWords = NOT_NAME_SPORT[currentSport().sport]
  if (ws.some((w) => NOT_NAME.has(w) || sportWords?.has(w))) return false
  // Prénom et nom composés (« Jean Pierre Martin », « De La Cruz ») : trois mots au plus, particules en plus.
  const real = ws.filter((w) => !PARTICLES.has(w))
  return real.length > 0 && real.length <= 3
}

// ---------- Action d'une phrase ----------

/** ajouter (défaut) : à la sélection ; retirer : les filtres dits ; effacer : tout, puis ce que dit la phrase. */
export type QueryAction = 'ajouter' | 'retirer' | 'effacer'

// « efface tout et… », « efface les filtres », « recommence », « réinitialise », « nouvelle recherche », « oublie tout »…
const CLEAR_START =
  /^(?:(?:alors|bon|ok|euh|maintenant) )*(?:(?:efface|effacer|vide|vider|supprime|supprimer|enleve|enlever|retire|retirer|oublie|oublier|remets?|remettre) (?:tout|tous les filtres|toutes les conditions|les filtres|la selection|toute la selection|les criteres|a zero|tout a zero)\b|tout effacer|tout efface|recommence|on recommence|recommencer|reinitialise|reinitialiser|nouvelle recherche|repars? de zero|on repart de zero|reset)\b/
// « enlève la taille », « retire le Var », « peu importe le poste », « sans l'année »…
const REMOVE_START = /^(?:(?:alors|bon|ok|euh|et) )*(?:enleve|enlever|retire|retirer|supprime|supprimer|oublie|oublier|peu importe|sans condition d|plus de filtre)\b/

/** Action dite par la phrase (sans le modèle) : effacer, retirer, sinon ajouter. */
export function phraseAction(phrase: string): QueryAction {
  const n = normalize(phrase)
  if (CLEAR_START.test(n)) return 'effacer'
  if (REMOVE_START.test(n)) return 'retirer'
  return 'ajouter'
}

/**
 * Action retenue : celle du modèle, mais jamais « effacer » ou « remplacer » si la phrase ne le dit pas (une nouvelle
 * phrase AJOUTE par défaut) ; « remplacer » dit explicitement (« recommence avec… ») = effacer puis ajouter.
 */
export function decideAction(model: unknown, phrase: string): QueryAction {
  const said = phraseAction(phrase)
  if (said === 'effacer') return 'effacer'
  if (model === 'retirer') return 'retirer'
  if (model === 'ajouter' || model === 'effacer' || model === 'remplacer') return 'ajouter'
  return said
}

/**
 * Commande évidente, sans appel au modèle : « efface tout », « réinitialise » ; « enlève la taille », « peu importe le
 * poste », « sans l'année » (chaque mot après le verbe est un filtre connu). null : la phrase part au modèle.
 */
export function localQueryCommand(phrase: string): { action: 'effacer' } | { action: 'retirer'; keys: FilterKey[] } | null {
  return localCommandWith(phrase, keysOfWord)
}

/** Même lecture pour une autre liste (Événements, Groupes : src/listQuery.ts), avec ses propres mots de filtres. */
export function localCommandWith<K extends string>(phrase: string, keysOf: (w: string) => K[]): { action: 'effacer' } | { action: 'retirer'; keys: K[] } | null {
  if (localCommand(phrase) === 'effacer') return { action: 'effacer' }
  const n = normalize(phrase)
  const m = /^(?:(?:alors|bon|ok|et) )*(?:enleve|enlever|retire|retirer|supprime|supprimer|oublie|peu importe|sans)(?: le| la| les| l| filtre| filtres| condition| conditions| de| du| des| d| sur| par| mon| ma| mes)*((?: [a-z]+)+?)(?: s il (?:te|vous) plait| stp| svp| merci)?$/.exec(n)
  if (!m) return null
  const parts = m[1].trim().split(/ (?:et|ni|ou|puis) | /).filter((w) => w && !['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'filtre', 'filtres', 'aussi'].includes(w))
  if (!parts.length || parts.length > 4) return null
  const keys = new Set<K>()
  for (const w of parts) {
    const ks = keysOf(w)
    if (!ks.length) return null
    for (const k of ks) keys.add(k)
  }
  return { action: 'retirer', keys: [...keys] }
}

// ---------- Fusion : recette courante + recette de la phrase ----------

/** Filtres d'une recette (clés posées), sans la recherche par nom. */
const recipeKeys = (r: Recipe): FilterKey[] => activeKeys({ recipe: r, q: '' })

const sameTarget = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Applique la recette d'une phrase à la requête courante (fonction pure) :
 *  - ajouter : chaque filtre dit prend sa nouvelle valeur, les autres restent (notes et mesures : même cible remplacée, sinon
 *    ajoutée) ; `remove` : filtres à retirer en plus (« sans condition d'année mais des pivots ») ;
 *  - retirer : les filtres de `remove`, et ceux que la phrase nomme (« retire le Var ») ;
 *  - effacer : tout (recherche par nom et calcul compris), puis ce que dit la phrase.
 * Sortie « liste » avec un tri : le tri de la liste ; nombre, tableau ou carte : le calcul sur la sélection (`calc`).
 * `regionOf` : région d'un département (un nouveau département écarte une région d'ailleurs, et inversement).
 */
export function mergeQuery(
  current: JoueursQuery,
  incoming: Recipe,
  action: QueryAction,
  remove: FilterKey[] = [],
  regionOf?: (dept: string) => string | undefined,
): JoueursQuery {
  const inc = cleanRecipe(incoming)
  if (action === 'retirer') {
    const out = removeKeys(current, [...remove, ...recipeKeys(inc).filter((k) => k !== 'sort')])
    const calc = calcOutput(inc.out)
    return calc ? { ...out, calc } : out
  }
  const base: JoueursQuery = action === 'effacer' ? EMPTY_QUERY : removeKeys(current, remove)
  const r: Recipe = structuredClone(base.recipe)
  const p = r.pop
  const n = inc.pop
  const set = <K extends keyof Population>(k: K) => {
    if (n[k] !== undefined) p[k] = structuredClone(n[k])
  }
  for (const k of ['sex', 'names', 'quarter', 'clubs', 'hand', 'groups', 'events', 'pole', 'followed', 'video', 'profiles'] as const) set(k)
  // Années dites : remplacent les années d'avant (bornes et années exactes ensemble, src/birthYears.ts).
  if (n.years) putYears(p, yearsOf(n))
  if (n.positions || n.noPosition) {
    delete p.positions
    delete p.secondary
    delete p.noPosition
    set('positions')
    set('secondary')
    set('noPosition')
  }
  if (n.depts) {
    p.depts = [...n.depts]
    if (p.regions && !n.regions && !(regionOf && n.depts.some((d) => p.regions!.includes(regionOf(d) ?? '')))) delete p.regions
  }
  if (n.regions) {
    p.regions = [...n.regions]
    if (p.depts && !n.depts && !(regionOf && p.depts.every((d) => n.regions!.includes(regionOf(d) ?? '')))) delete p.depts
  }
  if (n.hMin) {
    p.hMin = n.hMin
    if (p.hMax && p.hMax < n.hMin && !n.hMax) delete p.hMax
  }
  if (n.hMax) {
    p.hMax = n.hMax
    if (p.hMin && p.hMin > n.hMax && !n.hMin) delete p.hMin
  }
  if (inc.seen) r.seen = structuredClone(inc.seen)
  for (const a of inc.avis) {
    const i = r.avis.findIndex((x) => sameTarget(x.target, a.target) && x.agg === a.agg && x.op === a.op)
    if (i >= 0) r.avis[i] = structuredClone(a)
    else r.avis.push(structuredClone(a))
  }
  if (inc.nbAvis) r.nbAvis = { ...inc.nbAvis }
  for (const m of inc.measures) {
    const i = r.measures.findIndex((x) => x.id === m.id && x.op === m.op)
    if (i >= 0) r.measures[i] = { ...m }
    else r.measures.push({ ...m })
  }
  // Tri de la liste (« classés par taille », « les meilleurs défenseurs ») : remplace le tri d'avant.
  if (inc.out.type === 'list' && (inc.out.sort || inc.out.limit)) {
    r.out = { type: 'list' }
    for (const k of ['sort', 'avg', 'measure', 'period', 'limit'] as const) if (inc.out[k] !== undefined) (r.out as Record<string, unknown>)[k] = structuredClone(inc.out[k])
  }
  const calc = calcOutput(inc.out) ?? base.calc
  return { recipe: listRecipe(r), q: base.q, ...(calc ? { calc } : {}) }
}

/** Ce qui a changé, d'après les pastilles avant et après : « Ajouté : … — Retiré : … — Remplacé : … ». */
export function changeText(before: Chip[], after: Chip[], qBefore = '', qAfter = ''): { added: string[]; removed: string[]; replaced: string[]; text: string } {
  const keep = (c: Chip) => c.key !== 'out' && c.key !== 'limit' && c.key !== 'period' && !(c.key === 'sort' && !c.removable)
  const b = new Map(before.filter(keep).map((c) => [c.key, c.label]))
  const a = new Map(after.filter(keep).map((c) => [c.key, c.label]))
  const added = [...a].filter(([k]) => !b.has(k)).map(([, l]) => l)
  const removed = [...b].filter(([k]) => !a.has(k)).map(([, l]) => l)
  const replaced = [...a].filter(([k, l]) => b.has(k) && b.get(k) !== l).map(([, l]) => l)
  if (qBefore.trim() && !qAfter.trim()) removed.push(`recherche « ${qBefore.trim()} »`)
  const text = [
    added.length ? `Ajouté : ${added.join(' · ')}` : '',
    replaced.length ? `Remplacé : ${replaced.join(' · ')}` : '',
    removed.length ? `Retiré : ${removed.join(' · ')}` : '',
  ]
    .filter(Boolean)
    .join(' — ')
  return { added, removed, replaced, text }
}

// ---------- Liste filtrée ----------

export type Selection<P> = {
  /** Joueurs retenus, dans l'ordre de la liste (tri demandé, sinon l'ordre reçu). */
  list: P[]
  /** Recherche par nom : noms approchants (personne exactement). */
  approx: boolean
  /** Tri : valeur (ou raison, priorité) de chaque joueur classé. */
  values: Map<string, { value?: number | null; tag?: string }>
  /** Joueurs sans valeur pour le tri (pas de mesure, pas d'avis, déjà vus deux fois…) : en fin de liste. */
  unranked: number
  ms: number
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * Liste de la requête : la recette (population, conditions), puis la recherche par nom (exacte, sinon approchante), dans
 * l'ordre des joueurs reçus (par nom) ou selon le tri demandé ; les joueurs sans valeur pour ce tri viennent ensuite.
 */
export function selectPlayers<P extends QPlayer>(ix: QIndex<P>, qy: JoueursQuery, hay: (p: P) => string, tokens: (p: P) => string[]): Selection<P> {
  const t0 = now()
  let r = listRecipe(qy.recipe)
  // Recherche par nom et poste : le poste se choisit APRÈS la recherche (comme avant : la recherche exacte, sinon les noms
  // approchants, porte sur tous les postes ; les nombres des postes sont ceux de la recherche).
  const pp = r.pop
  const byPosition = qy.q.trim() && (pp.positions || pp.noPosition) ? { positions: pp.positions, secondary: pp.secondary, none: pp.noPosition } : null
  if (byPosition) {
    r = structuredClone(r)
    delete r.pop.positions
    delete r.pop.secondary
    delete r.pop.noPosition
  }
  const values = new Map<string, { value?: number | null; tag?: string }>()
  let list: P[]
  const sorted = !!(r.out.sort || r.avis.length)
  if (!sorted) {
    // Sans tri : l'ordre reçu (déjà par nom), pas de classement à calculer.
    list = runRecipe(ix, { ...r, out: { type: 'count' } }).match
  } else {
    const ans = runRecipe(ix, r, { all: true })
    const rows = ans.rows ?? []
    list = rows.map((x) => x.p)
    for (const x of rows) values.set(x.p.id, { value: x.value, tag: x.tag })
    if (rows.length < ans.match.length) {
      const ranked = new Set(list.map((p) => p.id))
      list = list.concat(ans.match.filter((p) => !ranked.has(p.id)))
    }
  }
  const found = searchByName(list, qy.q, hay, tokens)
  const approx = found.approx
  let searched = found.list
  if (byPosition)
    searched = searched.filter((p) =>
      byPosition.none
        ? !p.position
        : (!!p.position && byPosition.positions!.includes(p.position)) || (!!byPosition.secondary && !!p.secondaryPositions?.some((x) => byPosition.positions!.includes(x))),
    )
  const unranked = sorted ? searched.reduce((n, p) => n + (values.has(p.id) ? 0 : 1), 0) : 0
  return { list: searched, approx, values, unranked, ms: Math.round(now() - t0) }
}

/** Tri effectif de la liste (null : ordre par nom, sans classement). */
export const listSort = (qy: JoueursQuery) => (qy.recipe.out.sort || qy.recipe.avis.length ? defaultSort(listRecipe(qy.recipe)) : null)

/**
 * Nombres des menus des filtres rapides : chaque menu compte les joueurs qui passent tous les AUTRES filtres (le nombre à
 * côté d'une année, d'un département ou d'un club est celui qu'on obtiendra en le choisissant), comme avant.
 */
export function quickCounts<P extends QPlayer>(ix: QIndex<P>, qy: JoueursQuery, hay: (p: P) => string, tokens: (p: P) => string[]) {
  const p = qy.recipe.pop
  const rest = structuredClone(qy.recipe)
  for (const k of ['years', 'yearList', 'regions', 'depts', 'clubs', 'positions', 'secondary', 'noPosition'] as const) delete rest.pop[k]
  const base0 = runRecipe(ix, { ...rest, out: { type: 'count' } }).match
  const info = (x: P) => ix.info.get(x.id)!
  const okYear = (x: P) => inYears(p, info(x).year)
  const okDept = (x: P) => !p.depts || (!!info(x).dept && p.depts.includes(info(x).dept!))
  const okClub = (x: P) => !p.clubs || p.clubs.includes(info(x).club)
  const count = (xs: P[], key: (x: P) => string | undefined) => {
    const m = new Map<string, number>()
    for (const x of xs) {
      const k = key(x)
      if (k) m.set(k, (m.get(k) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  }
  // Poste(s) cochés : comptés dans les nombres des lieux et des années (le nombre d'un département est celui qu'on obtient en
  // le cochant, postes compris) ; les nombres des postes, eux, sans le filtre des postes.
  const okPos = (x: P) =>
    p.noPosition
      ? !x.position
      : !p.positions || (!!x.position && p.positions.includes(x.position)) || (!!p.secondary && !!x.secondaryPositions?.some((s) => p.positions!.includes(s)))
  const regionBase = base0.filter((x) => okClub(x) && okYear(x) && okPos(x))
  const base = p.regions ? base0.filter((x) => !!info(x).region && p.regions!.includes(info(x).region!)) : base0
  const deptBase = base.filter((x) => okClub(x) && okYear(x) && okPos(x))
  const clubBase = base.filter((x) => okDept(x) && okYear(x) && okPos(x))
  const yearBase = base.filter((x) => okDept(x) && okClub(x))
  const scoped = yearBase.filter(okYear)
  // Groupes : nombre de joueurs de chaque groupe qui répondent aux AUTRES filtres (lieu compris : « groupe X du Var »).
  const groupBase0 = p.groups ? runRecipe(ix, { ...rest, pop: { ...rest.pop, groups: undefined }, out: { type: 'count' } }).match : base0
  const groupIds = new Set(
    groupBase0
      .filter((x) => (!p.regions || (!!info(x).region && p.regions.includes(info(x).region!))) && okDept(x) && okClub(x) && okYear(x) && okPos(x))
      .map((x) => x.id),
  )
  const groups = new Map<string, number>()
  for (const [g, members] of ix.groupMembers) {
    let n = 0
    for (const id of members) if (groupIds.has(id)) n++
    groups.set(g, n)
  }
  const searched = searchByName(scoped, qy.q, hay, tokens).list
  const positions: Record<string, number> = { none: 0 }
  for (const x of searched) {
    positions[x.position ?? 'none'] = (positions[x.position ?? 'none'] ?? 0) + 1
    if (p.secondary) for (const s of x.secondaryPositions ?? []) if (s !== x.position) positions[s] = (positions[s] ?? 0) + 1
  }
  return {
    regions: count(regionBase, (x) => info(x).region),
    regionTotal: regionBase.length,
    depts: count(deptBase, (x) => info(x).dept),
    deptTotal: deptBase.length,
    clubs: count(clubBase, (x) => info(x).club).map(([k, n]) => [k, n, ix.clubNames.get(k) ?? k] as [string, number, string]),
    clubTotal: clubBase.length,
    years: count(yearBase.filter(okPos), (x) => info(x).year).sort((a, b) => b[0].localeCompare(a[0])),
    positions,
    positionTotal: searched.length,
    groups,
  }
}

/** Départements et régions des joueurs de chaque club (clé de club, src/coverage.ts clubKey). */
export function clubPlaces<P extends QPlayer>(ix: QIndex<P>): Map<string, { depts: Set<string>; regions: Set<string> }> {
  const m = new Map<string, { depts: Set<string>; regions: Set<string> }>()
  for (const x of ix.info.values()) {
    if (!x.club) continue
    let e = m.get(x.club)
    if (!e) m.set(x.club, (e = { depts: new Set(), regions: new Set() }))
    if (x.dept) e.depts.add(x.dept)
    if (x.region) e.regions.add(x.region)
  }
  return m
}

/**
 * Clubs cochés gardés quand des départements ou des régions sont cochés : seulement ceux qui en font partie (comme les
 * départements d'une autre région s'en vont quand on coche une région). Un club inconnu de l'appareil est gardé.
 */
export function clubsInPlaces(
  clubs: string[] | undefined,
  places: Map<string, { depts: Set<string>; regions: Set<string> }>,
  depts?: string[],
  regions?: string[],
): string[] | undefined {
  if (!clubs) return clubs
  const keep = clubs.filter((c) => {
    const at = places.get(c)
    if (!at) return true
    return (!depts?.length || depts.some((d) => at.depts.has(d))) && (!regions?.length || regions.some((r) => at.regions.has(r)))
  })
  return keep.length ? keep : undefined
}

// ---------- Anciens filtres rapides ----------

/** Anciens filtres de la liste Joueurs (FilterValues) en requête : mêmes joueurs retenus. */
export function legacyToQuery(v: FilterValues): JoueursQuery {
  const pop: Population = {}
  if (v.sex !== 'all') pop.sex = v.sex
  if (/^\d{4}$/.test(v.year)) pop.years = [Number(v.year), Number(v.year)]
  if (v.quarter) pop.quarter = v.quarter
  if (Number(v.minH)) pop.hMin = Number(v.minH)
  if (v.hand !== 'all') pop.hand = v.hand
  if (v.region) pop.regions = [v.region]
  if (v.dept) pop.depts = [v.dept]
  if (v.club) pop.clubs = [clubKey(v.club)]
  if (v.position === 'none') pop.noPosition = true
  else if (v.position !== 'all') {
    pop.positions = [v.position]
    if (v.withSecondary) pop.secondary = true
  }
  if (v.group) pop.groups = [v.group]
  if (v.profile) pop.profiles = [v.profile]
  if (v.followedOnly) pop.followed = true
  if (v.pole) pop.pole = v.pole
  if (v.videoOnly) pop.video = true
  return { recipe: listRecipe({ ...EMPTY_RECIPE, pop }), q: v.q }
}

/** Index de la liste Joueurs (fiches hors cadre gardées : l'onglet « Hors cadre » les montre). */
export const buildPlayersIndex = <P extends QPlayer>(data: QData<P>) => buildIndex({ ...data, includeRefused: true })

/**
 * La requête a-t-elle besoin des passages, des avis, des événements ou de toutes les mesures ? (Sinon la liste se contente
 * des fiches, de la taille et du poids, déjà lus : la liste Joueurs reste légère.)
 */
export function needsFullData(qy: JoueursQuery): boolean {
  const r = qy.recipe
  if (r.seen || r.avis.length || r.nbAvis || r.pop.events || qy.calc) return true
  if (r.measures.some((m) => m.id !== 'taille' && m.id !== 'poids')) return true
  const by = r.out.sort?.by
  return !!by && !['name', 'year', 'height'].includes(by)
}

/** Question enregistrée relancée sur la liste : ses filtres (et son tri), et son calcul s'il y en a un. */
export function queryFromSaved(r: Recipe): JoueursQuery {
  const x = cleanRecipe(r)
  const calc = calcOutput(x.out)
  return { recipe: listRecipe(calc ? { ...x, out: { type: 'list' } } : x), q: '', ...(calc ? { calc } : {}) }
}

/** Recette enregistrée depuis la liste : le calcul s'il y en a un, sinon la liste ; un nom cherché devient « prénom ou nom ». */
export function recipeToSave(qy: JoueursQuery): Recipe {
  const base = calcRecipe(qy) ?? listRecipe(qy.recipe)
  const q = qy.q.trim()
  if (!q || !/^[\p{L}\s'’-]+$/u.test(q) || base.pop.names) return base
  return cleanRecipe({ ...base, pop: { ...base.pop, names: [q] } })
}

/**
 * PAS DE SUBSTITUTION (src/recipe.ts checkQuantities) sur la requête fusionnée : une grandeur dite (taille, âge, une mesure)
 * doit être calculée par la liste (filtre, tri) OU par le calcul sur la sélection (moyenne d'une mesure…).
 */
export function missingQuantities(phrase: string, qy: JoueursQuery, ctx: QuestionContext): string[] {
  const list = checkQuantities(phrase, listRecipe(qy.recipe), ctx)
  const calc = calcRecipe(qy)
  if (!calc) return list
  const other = checkQuantities(phrase, calc, ctx)
  return list.filter((x) => other.includes(x))
}
