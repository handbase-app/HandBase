// « Poser une question » : relecture de la PHRASE après la réponse du modèle (mode « question » de la fonction
// « transcrire »), pour les cas vus au journal des questions où la recette rendue était incomplète ou vide alors que la
// phrase était claire. Fonctions pures, sans base ni écran (testées par tools/test-recettes-journal.ts). Rien ne part au
// serveur d'autre que la phrase : tout ce qui est fait ici l'est sur l'appareil.
//
//  - correctQuestionPhrase : mots mal entendus par la dictée, seulement dans une phrase de question (« vœu » → « Var » :
//    dans une question, c'est toujours le département ; la dictée d'un commentaire n'est pas touchée).
//  - incompletePhrase : phrase coupée (« La carte sur. ») → « Phrase incomplète : tu voulais la carte de… ? » au lieu de
//    « pas comprise », sans appel.
//  - rescueInterpretation : complète la recette relue (src/recipe.ts interpretRecipe) d'après la phrase :
//     · latéralité dite (« gauchers », « droitières ») : un filtre suffisant à lui seul, partout (nombre et liste) ;
//     · « en France », « dans la fédération », « dans la base de données », « répertoriés » : toute la France (le périmètre
//       de l'utilisateur, déjà appliqué aux données de l'appareil) ; jamais un « pas pris en compte » ;
//     · « licenciés » : chaque joueur de la base est licencié (onglet « Licenciés » du bilan) ; « quel club a le plus de
//       licenciés » → tableau par club, trié par nombre, le premier ; « clubs classés par nombre de licenciés » → le tableau ;
//     · « combien de clubs », « le nombre de clubs » : tableau par club dont la réponse est le NOMBRE de lignes (clubs qui
//       ont au moins un joueur dans la base, ou qui répondent aux conditions dites) ;
//     · « les clubs qui ont au moins 3 joueurs vus nés en 2010 mais aucun joueur vu né en 2011 » : « au moins N » et
//       « aucun … né en A » sur le tableau par club (mêmes conditions) ;
//     · SUITE DE LA QUESTION PRÉCÉDENTE (« la même chose que la question précédente, mais seulement dans le Var », « et en
//       2011 », « pareil pour les filles ») : la dernière recette de la session (sessionStorage), modifiée par ce qui est dit.
//    Ce qui a été ainsi appliqué est retiré des « Pas pris en compte » et « Non appliqué ».
// Uniquement des formulations positives ou neutres sur les jeunes.

import { putYears, yearsOf } from './birthYears'
import { cleanRecipe, decodeRecipe, encodeRecipe, type Interpreted, type Population, type QuestionContext, type Recipe } from './recipe'
import type { Laterality } from './db'
import { normalize, REGION_ALIASES } from './voiceFilters'

// ---------- Dictée ----------

/** Mots mal entendus dans une question (jamais dans un commentaire dicté) : « vœu », « voeux » → « Var ». */
export function correctQuestionPhrase(s: string): string {
  return s.replace(/(?<![\p{L}\p{M}])v(?:œ|oe)ux?(?![\p{L}\p{M}])/giu, 'Var')
}

// Mots qui ne peuvent pas finir une question : la phrase a été coupée (« La carte sur. », « les joueurs du »).
const DANGLING = new Set(
  'au aux avec chez d dans de des du en entre et l la le les ma mes mon ou par pour sa sans ses son sur ta tes ton un une vers ce ces cette leur leurs notre nos votre vos dont'.split(' '),
)

/** Phrase coupée : le message à montrer (au lieu de « pas comprise ») ; null : la phrase est entière. */
export function incompletePhrase(phrase: string): string | null {
  const ws = normalize(phrase).split(' ').filter(Boolean)
  if (!ws.length || !DANGLING.has(ws[ws.length - 1])) return null
  if (ws.includes('carte')) return 'Phrase incomplète : tu voulais la carte de… ?'
  const said = phrase.replace(/[\s.!?…,;:]+$/u, '').trim()
  return `Phrase incomplète : tu voulais « ${said}… » ?`
}

// ---------- Dernière question de la session ----------

const LAST_KEY = 'handbase.question.derniere'

/** Garde la recette de la dernière question (pour « la même chose, mais… »). Jamais d'erreur. */
export function rememberRecipe(r: Recipe) {
  try {
    sessionStorage.setItem(LAST_KEY, encodeRecipe(r))
  } catch {
    /* stockage indisponible : pas de suite possible */
  }
}

/** Recette de la dernière question de la session (null : aucune). */
export function lastRecipe(): Recipe | null {
  try {
    return decodeRecipe(sessionStorage.getItem(LAST_KEY))
  } catch {
    return null
  }
}

/** La phrase reprend-elle la question précédente ? (« la même chose… », « pareil pour… », « et en 2011 ») */
const FOLLOW_RE =
  /^(?:et |mais |alors )?(?:(?:la |le )?meme chose|pareil|idem|meme question|refais|refaire|recommence|maintenant)\b|\bquestion (?:precedente|d avant)\b|\bmeme chose\b|\bpareil\b|^(?:et|mais) (?:en|dans|pour|chez|avec|seulement|que|sans|du|de la|des|les|nes?|nees?)\b/
export const isFollowUp = (phrase: string) => FOLLOW_RE.test(normalize(phrase))

// ---------- Lecture locale de la phrase ----------

const NUM: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 }

/** Années de naissance citées (« 2010 », « 2011 »). */
function yearsIn(text: string): number[] {
  return [...new Set([...text.matchAll(/\b(19[5-9]\d|20\d\d)\b/g)].map((m) => Number(m[1])))]
}

function handIn(ws: string[]): Laterality | undefined {
  const hs = new Set<Laterality>()
  for (const w of ws) {
    if (/^gaucher(e)?s?$/.test(w)) hs.add('gaucher')
    else if (/^droitier(e)?s?$/.test(w)) hs.add('droitier')
    else if (/^ambidextres?$/.test(w)) hs.add('ambidextre')
  }
  return hs.size === 1 ? [...hs][0] : undefined
}

function sexIn(ws: string[]): 'M' | 'F' | undefined {
  const f = ws.some((w) => /^(filles?|joueuses?|feminin(e)?s?|garconnes)$/.test(w))
  const m = ws.some((w) => /^(garcons?|masculin(e)?s?)$/.test(w))
  return f === m ? undefined : f ? 'F' : 'M'
}

/** Départements et régions cités (« dans le Var », « du 83 », « en Bretagne »), d'après les listes de l'appli. */
function placesIn(text: string, ctx: QuestionContext): { depts: string[]; regions: string[] } {
  const t = ` ${text} `
  const depts: string[] = []
  for (const d of ctx.depts) {
    const by = [d.name ? normalize(d.name) : '', d.code.toLowerCase()].filter(Boolean)
    // Nom de département précédé d'un mot de lieu (« le Cher », « dans l'Ain ») ; numéro après « dans le », « du », « département ».
    const hit = by.some((k, i) =>
      i === 0 && d.name
        ? new RegExp(`\\b(?:dans|du|le|la|l|les|des|en|de|au|aux|departement|seulement) ${k} `).test(t)
        : new RegExp(`\\b(?:dans le|du|departement|le departement) ${k} `).test(t),
    )
    if (hit && !depts.includes(d.code)) depts.push(d.code)
  }
  const regions: string[] = []
  if (!depts.length)
    for (const r of ctx.regions) {
      const names = [r.name, ...(REGION_ALIASES[r.id] ?? [])].map(normalize).filter((k) => k.length >= 4 && !ctx.depts.some((d) => d.name && normalize(d.name) === k))
      if (names.some((k) => t.includes(` ${k} `))) regions.push(r.id)
    }
  return { depts, regions }
}

// ---------- Suite de la question précédente ----------

const PLACE_KEYS = ['regions', 'depts', 'clubs'] as const
/** La phrase dit-elle la forme de la réponse ? (sinon la suite garde celle de la question précédente) */
const OUT_WORDS = /\b(combien|nombre|liste|carte|tableau|classes?|classement|par (?:clubs?|departements?|regions?|postes?|annees?|generations?|sexe|evenements?))\b/

/** La recette précédente, modifiée par ce que dit la suite (la recette du modèle, complétée par la phrase). */
export function mergeFollowUp(prev: Recipe, next: Recipe, phrase: string, ctx: QuestionContext): Recipe {
  const text = normalize(phrase)
  const ws = text.split(' ')
  const r = cleanRecipe(prev)
  const pop: Population = { ...next.pop }
  // Ce que le modèle n'a pas rendu, lu dans la phrase.
  const ys = yearsIn(text)
  if (!pop.years && ys.length) putYears(pop, ys)
  const sex = sexIn(ws)
  if (!pop.sex && sex) pop.sex = sex
  const hand = handIn(ws)
  if (!pop.hand && hand) pop.hand = hand
  if (!PLACE_KEYS.some((k) => pop[k]?.length)) {
    const pl = placesIn(text, ctx)
    if (pl.depts.length) pop.depts = pl.depts
    else if (pl.regions.length) pop.regions = pl.regions
  }
  // Un lieu dit remplace tous les lieux d'avant ; des années dites remplacent les années d'avant.
  if (PLACE_KEYS.some((k) => pop[k]?.length)) for (const k of PLACE_KEYS) delete r.pop[k]
  if (pop.years) {
    delete r.pop.years
    delete r.pop.yearList
  }
  Object.assign(r.pop, pop)
  // Conditions : seulement celles que la phrase dit (« et en 2011 » n'est pas une période « vu »).
  if (next.seen && /\b(vus?|vues?|jamais vu)\b/.test(text)) r.seen = next.seen
  if (next.avis.length) r.avis = next.avis
  if (next.nbAvis) r.nbAvis = next.nbAvis
  if (next.measures.length) r.measures = next.measures
  if (OUT_WORDS.test(text)) r.out = next.out
  return cleanRecipe(r)
}

// ---------- Relecture d'après la phrase ----------

const HAND_RE = /lateralit|gauch|droiti|ambidex/
const WHOLE_WORDS = /\bfrance\b|\bfederation\b|\bffhb\b|base de donnees|\bdans la base\b|\bnational|\btout le pays\b|\bpartout\b|\brepertorie/
const WHOLE_RE = /\bfrance\b|federation|\bffhb\b|base de donnees|\bbase\b|\bnational|\bpays\b|\bpartout\b|repertori/
const LICENCE_RE = /licenci|inscrit/
const FOLLOW_NOTE_RE = /precedent|meme chose|pareil|idem|meme question|d avant/
const NEG_NOTE_RE = /\baucun|\bau moins\b|\bpas de\b|\bpas un\b|\bzero\b|\bsans\b|\bni\b/
const CLUB_COUNT = /\b(?:combien|nombre)(?: total)?(?: (?:y a t il|il y a|ya t il|existe t il|y en a t il|on a|avons nous))?(?: de| d)? clubs?\b/
const CLUB_COUNT_NOTE_RE = /\b(?:nombre|combien|total|compter|compte)\b.*\bclubs?\b|^clubs?(?: repertories?)?$/
const NEG = /\bau moins (\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\b(.*?)\b(?:aucun|aucune|pas de|pas un seul|pas une seule|zero)\b(.*)$/

export type RescueScope = 'question' | 'liste'
export type Rescued = Interpreted & { followUp?: boolean }

/**
 * Recette relue (interpretRecipe), complétée d'après la phrase (voir en tête). scope « liste » (liste Joueurs, filtres) :
 * seulement la latéralité, « toute la France » et « licenciés » ; « question » (défaut) : tout. `prev` : la recette de la
 * question précédente (suite).
 */
export function rescueInterpretation(it: Interpreted, phrase: string, ctx: QuestionContext, opts: { scope?: RescueScope; prev?: Recipe | null } = {}): Rescued {
  const text = normalize(correctQuestionPhrase(phrase))
  const ws = text.split(' ').filter(Boolean)
  let r = cleanRecipe(it.recipe)
  const handled: RegExp[] = []
  if (WHOLE_WORDS.test(text)) handled.push(WHOLE_RE)
  if (LICENCE_RE.test(text)) handled.push(LICENCE_RE)
  const hand = handIn(ws)
  if (hand) {
    r.pop.hand ??= hand
    if (r.pop.hand === hand) handled.push(HAND_RE)
  }
  let followUp = false
  if (opts.scope !== 'liste') {
    if (opts.prev && isFollowUp(phrase)) {
      r = mergeFollowUp(opts.prev, r, phrase, ctx)
      handled.push(FOLLOW_NOTE_RE)
      followUp = true
    }
    const clubs = /\bclubs?\b/.test(text)
    // « au moins 3 joueurs vus … mais aucun joueur vu né en 2011 » (par club).
    const neg = clubs ? NEG.exec(text) : null
    const none = neg ? yearsIn(neg[3]) : []
    if (neg && none.length) {
      const n = /^\d+$/.test(neg[1]) ? Number(neg[1]) : NUM[neg[1]]
      const by = r.out.type === 'table' && r.out.groupBy !== 'staff' ? (r.out.groupBy ?? 'club') : 'club'
      r.out = { ...(r.out.type === 'table' ? r.out : {}), type: 'table', groupBy: by, minMatch: n, noneYears: none }
      const before = yearsIn(neg[2]).filter((y) => !none.includes(y))
      const base = (yearsOf(r.pop) ?? []).filter((y) => !none.includes(y))
      putYears(r.pop, base.length ? base : before)
      if (/\bvu/.test(neg[2]) && !r.seen) r.seen = { by: 'event', op: 'gte', n: 1, period: { kind: 'season' } }
      // « au moins 3 joueurs vus » n'est pas « vus au moins 3 fois ».
      if (r.seen && r.seen.op === 'gte' && r.seen.n === n && !/\bfois\b/.test(neg[2])) r.seen = { ...r.seen, n: 1 }
      // « vus en 2010 » lu comme une période : c'est l'année de naissance (« les 2010 »).
      const since = r.seen?.period.kind === 'since' ? r.seen.period.since : undefined
      if (r.seen && since && [...before, ...none].some((y) => since.startsWith(String(y)))) r.seen = { ...r.seen, period: { kind: 'season' } }
      handled.push(NEG_NOTE_RE)
    }
    // « combien de clubs », « le nombre de clubs » : le nombre de lignes du tableau par club.
    const clubCount = CLUB_COUNT.test(text)
    if (clubCount) {
      r.out = { ...(r.out.type === 'table' && r.out.groupBy === 'club' ? r.out : {}), type: 'table', groupBy: 'club', countRows: true }
      handled.push(CLUB_COUNT_NOTE_RE)
    }
    // « quel club a le plus de licenciés », « les clubs classés par nombre de licenciés ».
    if (clubs && LICENCE_RE.test(text) && !clubCount) {
      const most = /\b(?:le |la )?(plus|moins) (?:de |d )?(?:licencies?|inscrits?)\b/.exec(text)
      const ranked = /\bclasse(?:e|s|es)? (?:par|selon) (?:le |leur )?(?:nombre (?:de |d ))?(?:licencies?|inscrits?)\b|\bclassement\b/.test(text)
      if (most || ranked) {
        const one = /\b(?:quel|quelle|le|la) club\b/.test(text) && !/\bclubs\b/.test(text)
        const keepLimit = r.out.type === 'table' && r.out.groupBy === 'club' ? r.out.limit : undefined
        r.out = { type: 'table', groupBy: 'club', sort: { by: 'count', dir: most?.[1] === 'moins' ? 'asc' : 'desc' }, ...(one ? { limit: 1 } : keepLimit ? { limit: keepLimit } : {}) }
      }
    }
    // « combien… » rendu en liste : un nombre.
    if (!followUp && !clubCount && /\bcombien\b|^(?:quel est |donne moi |donne |dis moi )?le nombre\b/.test(text) && r.out.type === 'list' && !r.out.sort) r.out = { type: 'count' }
  }
  const keep = (x: string) => !handled.some((re) => re.test(normalize(x)))
  return { recipe: cleanRecipe(r), notes: it.notes.filter(keep), unsupported: it.unsupported.filter(keep), ...(followUp ? { followUp } : {}) }
}
