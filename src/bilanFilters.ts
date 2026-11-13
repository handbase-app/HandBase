import type { Place } from './bilanNav'
import { splitPlace } from './bilanQuestion'
import { listRecipe, type FilterKey, type JoueursQuery } from './playerQuery'
import { putYears, sortYearStrings, yearsOf } from './birthYears'
import { cleanRecipe, EMPTY_RECIPE, hasConditions, hasPopulation, type Output, type Population, type Recipe } from './recipe'

/*
 * Barre de filtres du bilan de détection = la barre de la liste Joueurs (src/components/PlayersQuery.tsx, même recette,
 * mêmes pastilles, même champ « Filtrer ou poser une question… »). Fichier pur (ni React ni base) : passage entre l'état
 * du bilan (adresse) et la requête de la barre. Testé par tools/test-bilan-filtres.ts.
 *
 * UNE commande par notion :
 *  - sexe et années de naissance : les commandes du bilan (Tous / Garçons / Filles, « Toutes les années » : une ou
 *    plusieurs années cochées, réglés en tête de la fenêtre « Filtres » de la barre) ; une phrase de la barre qui les dit
 *    les change (adresse s=, a=2010,2011,2012) ; pas de pastille de la barre pour eux (le bilan montre les siennes). Années posées dans la barre par une adresse d'avant (f= avec des
 *    années) : une pastille de la barre ; choisir des années dans le menu du bilan les remplace.
 *  - lieu (une région, un département, un club) : l'étage du bilan (carte, fil, adresse r= d= c=) ; un lieu choisi dans
 *    la barre (menus Région, Département, Club, ou une phrase) fait descendre le bilan à cet étage. Plusieurs départements
 *    ou clubs : pastille de la barre (seuls eux sont comptés), comme pour une question (src/bilanQuestion.ts splitPlace).
 *  - tout le reste (poste, taille, latéralité, trimestre, Pôle, vidéo, suivis, profil, groupe, événement, vus, avis,
 *    mesures, recherche par nom) : la barre seule, dans l'adresse (f=<recette>, t=<nom cherché>).
 *  - Question posée au bilan (?q=, réponse géographique) : sa recette porte sa population ; la barre montre et change
 *    SES pastilles (sexe et année compris : les commandes du bilan sont cachées pendant une question). Une question qui
 *    arrive remplace les filtres de la barre ; ✕ ferme la question et ses filtres restent dans la barre.
 * La population du bilan (carte, tuiles, clubs, générations, Rapport Fédé) = les joueurs retenus par la barre, calculés
 * sur l'appareil par le moteur de la recette (src/playerQuery.ts selectPlayers), puis les filtres propres du bilan.
 */

/** Ce que la barre lit de l'état du bilan. */
export type BarState = {
  sex: 'all' | 'M' | 'F'
  /** Années choisies (textes, src/birthYears.ts) ; vide : toutes ; '' : année inconnue. */
  years: string[]
  region: string
  dept: string
  club: string | null
  /** Filtres de la barre (recette, sortie « liste ») ; null : aucun. */
  f: Recipe | null
  /** Recherche par nom de la barre. */
  t: string
  /** Question posée au bilan (sa recette porte sa population). */
  q: Recipe | null
}

const PLACE_KEYS = ['regions', 'depts', 'clubs'] as const

/** Département qui ne se dit pas dans une recette (non renseigné, autres outre-mer) : le bilan seul le porte. */
const SPECIAL_DEPTS = new Set(['?', '97'])

/** Filtres de la barre nettoyés (sortie « liste » sans tri) ; null s'il n'y en a aucun. */
export function cleanFilters(r: Recipe | null | undefined): Recipe | null {
  if (!r) return null
  const x = listRecipe({ ...cleanRecipe(r), out: { type: 'list' } })
  return hasPopulation(x) || hasConditions(x) ? x : null
}

/** Un filtre de la barre est posé (recette ou nom cherché). */
export const hasBarFilter = (f: Recipe | null, t: string) => !!cleanFilters(f) || !!t.trim()

/** Recette de la barre : filtres posés, ou population de la question. */
const barBase = (s: BarState): Recipe => (s.q ? listRecipe({ ...s.q, out: { type: 'list' } }) : (s.f ?? EMPTY_RECIPE))

/**
 * Requête montrée par la barre : ses filtres, plus (pour que ses menus et ses nombres suivent le bilan) le sexe, l'année
 * et le lieu du bilan. Ces derniers ne sont pas des pastilles de la barre (barHidden).
 */
export function barQuery(s: BarState, calc?: Output): JoueursQuery {
  const base = barBase(s)
  const pop: Population = { ...base.pop }
  if (!s.q) {
    if (s.sex !== 'all') pop.sex = s.sex
    // Années du bilan (sauf l'année inconnue, qu'une recette ne dit pas) : les menus et les nombres de la barre suivent.
    if (s.years.length && !s.years.includes('') && !pop.years) putYears(pop, s.years)
  }
  if (s.dept && !SPECIAL_DEPTS.has(s.dept)) {
    if (s.region && !pop.regions) pop.regions = [s.region]
    if (!pop.depts) pop.depts = [s.dept]
    if (s.club && !pop.clubs) pop.clubs = [s.club]
  } else if (s.region && !s.dept && !pop.regions) pop.regions = [s.region]
  return { recipe: listRecipe({ ...base, pop, out: { type: 'list' } }), q: s.t, ...(calc ? { calc } : {}) }
}

/** Filtres de la requête de la barre qui viennent du bilan (sexe, année, lieu) : pas de pastille, pas comptés. */
export function barHidden(s: BarState): Set<FilterKey> {
  const base = barBase(s)
  const out = new Set<FilterKey>()
  if (!s.q) {
    out.add('sex')
    if (!base.pop.years) out.add('years')
  }
  for (const k of PLACE_KEYS) if (!base.pop[k]) out.add(k)
  return out
}

const placeSig = (p: Population) => JSON.stringify(PLACE_KEYS.map((k) => p[k] ?? null))

/** Changement d'état du bilan demandé par la barre. */
export type BarPatch = Partial<Pick<BarState, 'sex' | 'years' | 'f' | 't' | 'q'>> & Place

/**
 * Requête de la barre → état du bilan. Lieu inchangé dans la barre : celui du bilan reste (même un lieu qu'une recette ne
 * dit pas) ; lieu changé : le bilan va au lieu de la barre (splitPlace : un club → son département, club choisi ; un
 * département → lui ; une région → elle ; plusieurs départements ou clubs : gardés en filtre). Sans question : le sexe et
 * les années vont aux commandes du bilan. Question posée : sa recette prend la population de la barre, sa sortie reste.
 */
export function fromBar(
  next: JoueursQuery,
  s: BarState,
  regionOf: (dept: string) => string | undefined,
  clubDept: (club: string) => string | undefined,
): { patch: BarPatch; calc?: Output } {
  const composed = barQuery(s).recipe
  const base = barBase(s)
  const r = listRecipe({ ...next.recipe, out: { type: 'list' } })
  let pop: Population = { ...r.pop }
  let place: Place = { region: s.region, dept: s.dept, club: s.club }
  if (placeSig(pop) === placeSig(composed.pop)) {
    for (const k of PLACE_KEYS) if (!base.pop[k]) delete pop[k]
  } else {
    const sp = splitPlace({ ...r, pop }, regionOf, clubDept)
    place = sp.place
    pop = { ...sp.recipe.pop }
  }
  const t = next.q
  if (s.q) {
    const q = cleanRecipe({ ...r, pop, out: s.q.out })
    return { patch: { ...place, q, t }, calc: next.calc }
  }
  const sex = pop.sex ?? 'all'
  delete pop.sex
  // Années de la barre : au menu du bilan ; aucune : toutes (sauf l'année inconnue du bilan, que la barre ne porte pas).
  const ys = yearsOf(pop)
  const years = ys ? sortYearStrings(ys.map(String)) : s.years.includes('') ? s.years : []
  delete pop.years
  delete pop.yearList
  return { patch: { ...place, sex, years, f: cleanFilters({ ...r, pop }), t }, calc: next.calc }
}

/**
 * Question qui ferme (✕) : sa population reste dans la barre (sexe et années aux commandes du bilan, le reste en
 * filtres), sa sortie s'en va.
 */
export function closeQuestion(q: Recipe): { q: null; f: Recipe | null; sex: 'all' | 'M' | 'F'; years: string[] } {
  const pop: Population = { ...q.pop }
  const sex = pop.sex ?? 'all'
  delete pop.sex
  const years = sortYearStrings((yearsOf(pop) ?? []).map(String))
  delete pop.years
  delete pop.yearList
  return { q: null, f: cleanFilters({ ...q, pop }), sex, years }
}

/** Années choisies au menu du bilan : remplacent des années posées dans la barre (une seule commande). */
export function withoutYears(f: Recipe | null): Recipe | null {
  if (!f?.pop.years) return f
  const pop = { ...f.pop }
  delete pop.years
  delete pop.yearList
  return cleanFilters({ ...f, pop })
}

/** Adresse : f= (filtres) et t= (nom cherché), lus sans rien croire. */
export function parseBar(f: string | null, t: string | null): { f: Recipe | null; t: string } {
  let r: Recipe | null = null
  if (f && f.length <= 8000)
    try {
      r = cleanFilters(JSON.parse(f))
    } catch {
      r = null
    }
  return { f: r, t: (t ?? '').replace(/\s+/g, ' ').slice(0, 80) }
}
export const encodeBar = (f: Recipe | null) => (f ? JSON.stringify(f) : '')
