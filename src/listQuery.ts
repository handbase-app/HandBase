// Listes Événements et Groupes : les filtres sont une RECETTE, comme la liste Joueurs (src/playerQuery.ts) — même
// expérience (un champ « Filtrer ou poser une question… », un micro ✨, des pastilles, « Annuler »), recette propre à
// chaque liste (src/eventQuery.ts, src/groupQuery.ts). Fonctions pures, sans base ni écran
// (tools/test-filtres-recette-pages.ts).
//
//  - ListQuery : les filtres posés (`f`, une clé par filtre), la recherche locale (`q` : nom, lieu, créateur…), le tri de
//    la liste et, s'il y en a une, la question de CALCUL sur la sélection (`calc` : combien, par type, par mois…).
//  - isListSearch : un simple nom d'événement ou de groupe tapé (« Cannes », « Intercomités 83 ») reste une recherche
//    locale instantanée, sans appel ; une phrase (« les tournois de cette saison », « combien par mois ? ») part au mode
//    « question » avec le contexte de la liste.
//  - mergeListQuery : MÊME RÈGLE QUE JOUEURS : une phrase AJOUTE à la sélection (filtres posés à la main ou par une phrase
//    d'avant) ; une clé redite prend la nouvelle valeur ; on n'efface tout que si c'est dit, on ne retire que ce qui est dit.
//  - listKeysForModel : ce qui part avec la phrase : les NOMS des filtres posés, jamais leurs valeurs (ni noms
//    d'événements, de groupes, de lieux ou de personnes : le texte cherché, sa présence seulement).
// Uniquement des formulations positives ou neutres.

import { matchName } from './askAction'
import { changeText, localCommandWith, type QueryAction } from './playerQuery'
import { bestMatch, normalize } from './voiceFilters'

export type Cmp = 'gte' | 'lte' | 'eq'
/** Condition sur un nombre (« au moins 10 joueurs »). */
export type NumCond = { op: Cmp; n: number }
export type ListSort = { by: string; dir: 'asc' | 'desc' }
/** Calcul sur la sélection : combien, ou un petit tableau (par type, par mois…). */
export type ListCalc = { type: 'count' } | { type: 'table'; by: string }

export type ListQuery<F> = { f: F; q: string; sort?: ListSort; calc?: ListCalc }

/**
 * Nom de personne dit, approchant d'un nom connu de l'appareil (« Steve Bacher » pour « Stef bascher ») : à faire confirmer
 * (« Tu voulais dire … ? ») avant d'appliquer le filtre ; choices : les noms possibles, le plus proche d'abord.
 */
export type NameConfirm = { key: 'creators'; said: string; choices: string[] }

/** Ce que rend la lecture d'une phrase (recette de la page, revérifiée ici) ; confirm : noms approchants à confirmer. */
export type ListIncoming<F> = { f: Partial<F>; q?: string; sort?: ListSort; calc?: ListCalc; notes: string[]; unsupported: string[]; confirm?: NameConfirm[] }

/**
 * Personne dite (créateur) retrouvée parmi les noms connus de l'appareil : comme avant d'abord (nom exact ou mots du nom :
 * « Paul » trouve « Paul Fictif » s'il est seul ; plusieurs : les mots dits) ; sinon un nom APPROCHANT (son, une ou deux
 * lettres : src/askAction.ts, matchName), à confirmer ; sinon rien. Les noms restent sur l'appareil.
 */
export function matchPerson(said: string, people: readonly string[]): { found: string } | { words: string } | { confirm: string[] } | { none: true } {
  const list = [...new Set(people.filter(Boolean))]
  const m = bestMatch(said, list, (x) => [x])
  if ('found' in m) return { found: m.found }
  if ('ambiguous' in m) return { words: said }
  const f = matchName(said, list.map((name) => ({ name })))
  if (f.kind === 'exact') return { found: f.item.name }
  if (f.kind === 'approx') return { confirm: f.choices.map((c) => c.name) }
  return { none: true }
}

export type ListChip = { key: string; label: string; removable: boolean }

/** Une liste pilotée par une recette : ses filtres, leurs mots, leurs tests, ses tris et ses regroupements. */
export interface ListSpec<F extends object, T, C> {
  id: 'evenements' | 'groupes'
  /** Filtres, dans l'ordre des pastilles. */
  keys: (keyof F & string)[]
  /** Nom de chaque filtre pour le modèle (`sort` : tri, `q` : recherche). */
  modelKey: Record<string, string>
  /** Nom court (« Retiré : type »). */
  keyLabel: Record<string, string>
  /** Mots dits (sans accents ni espaces) → filtres. */
  words: Record<string, string[]>
  /** Filtres lus dans la session ou rendus par une phrase (rien n'y est cru). */
  clean(v: unknown): F
  /** Libellé de la pastille d'un filtre posé. */
  chip(k: keyof F & string, f: F, ctx: C): string
  /** L'élément passe-t-il ce filtre ? */
  test(k: keyof F & string, f: F, item: T, ctx: C): boolean
  /** Texte de la recherche locale (nom, lieu, créateur…). */
  hay(item: T): string
  sorts: { value: string; label: string; dir: 'asc' | 'desc'; get(item: T, ctx: C): number | string | undefined }[]
  groupings: { value: string; label: string; keys(item: T, ctx: C): string[]; name?(key: string, ctx: C): string }[]
  /** Après un ajout : cohérences entre filtres (un département d'ailleurs écarte la région…). */
  fix?(f: F, added: Set<string>, regionOf: (d: string) => string | undefined): void
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Requête lue dans la session (rien n'y est cru). */
export function cleanListQuery<F extends object, T, C>(spec: ListSpec<F, T, C>, v: unknown): ListQuery<F> {
  const o = isObj(v) ? v : {}
  const f = spec.clean(o.f)
  const q = typeof o.q === 'string' ? o.q.slice(0, 80) : ''
  const s = isObj(o.sort) ? o.sort : undefined
  const sort = s && spec.sorts.some((x) => x.value === s.by) ? { by: String(s.by), dir: s.dir === 'asc' ? ('asc' as const) : ('desc' as const) } : undefined
  const c = isObj(o.calc) ? o.calc : undefined
  const calc: ListCalc | undefined =
    c?.type === 'count' ? { type: 'count' } : c?.type === 'table' && spec.groupings.some((g) => g.value === c.by) ? { type: 'table', by: String(c.by) } : undefined
  return { f, q, ...(sort ? { sort } : {}), ...(calc ? { calc } : {}) }
}

export const emptyListQuery = <F extends object>(): ListQuery<F> => ({ f: {} as F, q: '' })

const set = (f: object, k: string) => (f as Record<string, unknown>)[k] !== undefined

/** Filtres posés (dans l'ordre des pastilles), puis le tri et la recherche. */
export function activeListKeys<F extends object, T, C>(spec: ListSpec<F, T, C>, qy: ListQuery<F>): string[] {
  const k: string[] = spec.keys.filter((x) => set(qy.f, x))
  if (qy.sort) k.push('sort')
  if (qy.q.trim()) k.push('q')
  return k
}

export const hasListQuery = <F extends object, T, C>(spec: ListSpec<F, T, C>, qy: ListQuery<F>) => activeListKeys(spec, qy).length > 0

/** Nombre montré sur le bouton « Filtres » : un par champ posé (plusieurs valeurs cochées comptent pour un), tri compris, sans la recherche. */
export const listFilterCount = <F extends object, T, C>(spec: ListSpec<F, T, C>, qy: ListQuery<F>) => activeListKeys(spec, qy).filter((k) => k !== 'q').length

/** Envoyé avec la phrase : les NOMS des filtres posés, jamais leurs valeurs (le texte cherché : sa présence seulement). */
export const listKeysForModel = <F extends object, T, C>(spec: ListSpec<F, T, C>, qy: ListQuery<F>): string[] =>
  activeListKeys(spec, qy).map((k) => spec.modelKey[k] ?? k)

/** Filtres d'un mot (« le type », « mesEvenements », « la date ») ; [] si inconnu. */
export function listKeysOfWord<F extends object, T, C>(spec: ListSpec<F, T, C>, v: unknown): string[] {
  if (typeof v !== 'string') return []
  const raw = v.trim()
  // Nom de clé rendu par le modèle (« mesEvenements », « feuilleDeMatch ») : tel quel d'abord.
  const byModel = Object.entries(spec.modelKey).filter(([, m]) => m === raw).map(([k]) => k)
  if (byModel.length) return byModel
  const w = normalize(raw)
    .split(' ')
    .filter((x) => !['le', 'la', 'les', 'l', 'filtre', 'filtres', 'critere', 'condition', 'de', 'd', 'du', 'des', 'sur', 'par', 'mon', 'ma', 'mes', 'a', 'un', 'une'].includes(x))
  if (!w.length) return spec.words[normalize(raw).replace(/ /g, '')] ?? []
  return spec.words[w.join('')] ?? spec.words[w[0]] ?? spec.words[normalize(raw).replace(/ /g, '')] ?? []
}

/** Retire des filtres (et le tri, la recherche). */
export function removeListKeys<F extends object>(qy: ListQuery<F>, keys: Iterable<string>): ListQuery<F> {
  const f = { ...qy.f } as Record<string, unknown>
  let q = qy.q
  let sort = qy.sort
  for (const k of keys) {
    if (k === 'q') q = ''
    else if (k === 'sort') sort = undefined
    else delete f[k]
  }
  return { f: f as F, q, ...(sort ? { sort } : {}), ...(qy.calc ? { calc: qy.calc } : {}) }
}

/** « efface tout », « enlève le type », « sans la date » : sans appel au modèle (chaque mot est un filtre connu). */
export function localListCommand<F extends object, T, C>(spec: ListSpec<F, T, C>, phrase: string) {
  return localCommandWith(phrase, (w) => listKeysOfWord(spec, w))
}

/**
 * Applique la recette d'une phrase à la requête courante (fonction pure), même règle que la liste Joueurs :
 *  - ajouter (défaut) : chaque filtre dit prend sa nouvelle valeur, les autres restent ; `remove` : retirés en plus ;
 *  - retirer : les filtres de `remove`, et ceux que la phrase nomme ;
 *  - effacer : tout (recherche et calcul compris), puis ce que dit la phrase.
 * Un tri dit remplace le tri d'avant ; un calcul dit s'applique à la sélection obtenue.
 */
export function mergeListQuery<F extends object, T, C>(
  spec: ListSpec<F, T, C>,
  current: ListQuery<F>,
  incoming: Pick<ListIncoming<F>, 'f' | 'q' | 'sort' | 'calc'>,
  action: QueryAction,
  remove: string[] = [],
  regionOf: (d: string) => string | undefined = () => undefined,
): ListQuery<F> {
  const incF = spec.clean(incoming.f)
  const incKeys = spec.keys.filter((k) => set(incF, k))
  if (action === 'retirer') {
    const out = removeListKeys(current, [...remove, ...incKeys, ...(incoming.q ? ['q'] : [])])
    return incoming.calc ? { ...out, calc: incoming.calc } : out
  }
  const base: ListQuery<F> = action === 'effacer' ? emptyListQuery<F>() : removeListKeys(current, remove)
  const f = { ...base.f } as Record<string, unknown>
  for (const k of incKeys) f[k] = structuredClone((incF as Record<string, unknown>)[k])
  spec.fix?.(f as F, new Set(incKeys), regionOf)
  const q = incoming.q !== undefined && incoming.q.trim() ? incoming.q.trim() : base.q
  const sort = incoming.sort ?? base.sort
  const calc = incoming.calc ?? base.calc
  return { f: spec.clean(f), q, ...(sort ? { sort } : {}), ...(calc ? { calc } : {}) }
}

// ---------- Pastilles, ligne de résultat ----------

/** Pastilles des filtres posés et du tri (la recherche reste dans le champ). */
export function listChips<F extends object, T, C>(spec: ListSpec<F, T, C>, qy: ListQuery<F>, ctx: C): ListChip[] {
  const out: ListChip[] = spec.keys.filter((k) => set(qy.f, k)).map((k) => ({ key: k, label: spec.chip(k, qy.f, ctx), removable: true }))
  if (qy.sort) {
    const s = spec.sorts.find((x) => x.value === qy.sort!.by)
    if (s) out.push({ key: 'sort', label: `tri : ${s.label.toLowerCase()} ${qy.sort.dir === 'asc' ? '↑' : '↓'}`, removable: true })
  }
  return out
}

/** « Ajouté : … — Remplacé : … — Retiré : … » (mêmes mots que la liste Joueurs). */
export function listChangeText<F extends object, T, C>(spec: ListSpec<F, T, C>, before: ListQuery<F>, after: ListQuery<F>, ctx: C) {
  // Clés préfixées : « period » n'est pas ici la période d'une sortie de la recette des joueurs (que changeText écarte).
  const tag = (cs: ListChip[]) => cs.map((c) => ({ ...c, key: `liste.${c.key}` }))
  return changeText(tag(listChips(spec, before, ctx)), tag(listChips(spec, after, ctx)), before.q, after.q)
}

export const sameListQuery = <F extends object, T, C>(spec: ListSpec<F, T, C>, a: ListQuery<F>, b: ListQuery<F>) =>
  JSON.stringify(cleanListQuery(spec, a)) === JSON.stringify(cleanListQuery(spec, b))

// ---------- Liste filtrée ----------

/** Texte sans accents ni majuscules (recherche locale, comme avant). */
export const foldText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** La recherche locale : chaque mot tapé se trouve dans le texte de l'élément (nom, lieu, créateur…), comme avant. */
export function textMatch(hay: string, q: string): boolean {
  const words = foldText(q).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const h = foldText(hay)
  return words.every((w) => h.includes(w))
}

/** Éléments qui passent tous les filtres, sauf `except` (nombres des menus) ; la recherche locale comprise sauf except 'q'. */
export function filterItems<F extends object, T, C>(spec: ListSpec<F, T, C>, items: T[], qy: ListQuery<F>, ctx: C, except?: string): T[] {
  const keys = spec.keys.filter((k) => k !== except && set(qy.f, k))
  const q = except === 'q' ? '' : qy.q
  return items.filter((it) => keys.every((k) => spec.test(k, qy.f, it, ctx)) && (!q.trim() || textMatch(spec.hay(it), q)))
}

/** Liste de la requête, dans l'ordre reçu ou selon le tri demandé (sans valeur pour ce tri : en fin de liste). */
export function selectItems<F extends object, T, C>(spec: ListSpec<F, T, C>, items: T[], qy: ListQuery<F>, ctx: C): T[] {
  const list = filterItems(spec, items, qy, ctx)
  const s = qy.sort && spec.sorts.find((x) => x.value === qy.sort!.by)
  if (!s) return list
  const dir = qy.sort!.dir === 'asc' ? 1 : -1
  const vals = new Map(list.map((it) => [it, s.get(it, ctx)]))
  return list
    .map((it, i) => ({ it, i, v: vals.get(it) }))
    .sort((a, b) => {
      if (a.v === undefined || b.v === undefined) return a.v === undefined && b.v === undefined ? a.i - b.i : a.v === undefined ? 1 : -1
      const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v), 'fr')
      return c ? c * dir : a.i - b.i
    })
    .map((x) => x.it)
}

/** Nombre d'éléments par valeur d'un filtre (les AUTRES filtres appliqués), pour les menus du panneau. */
export function countBy<T>(items: T[], keys: (t: T) => (string | undefined)[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) for (const k of new Set(keys(it))) if (k) m.set(k, (m.get(k) ?? 0) + 1)
  return m
}

export type CalcRow = { key: string; label: string; n: number; sums: number[] }
export type CalcAnswer = { count: number; sums: number[]; rows?: CalcRow[] }

/**
 * Calcul sur la sélection : combien (et les totaux, ex. joueurs et avis), ou un tableau (par type, par mois…), lignes du
 * plus grand au plus petit (par mois, par année : dans l'ordre du temps). `sums` : totaux affichés à côté du nombre.
 */
export function calcList<F extends object, T, C>(spec: ListSpec<F, T, C>, list: T[], calc: ListCalc, ctx: C, sums: ((t: T) => number)[] = []): CalcAnswer {
  const total = (xs: T[]) => sums.map((s) => xs.reduce((n, x) => n + s(x), 0))
  const ans: CalcAnswer = { count: list.length, sums: total(list) }
  if (calc.type !== 'table') return ans
  const g = spec.groupings.find((x) => x.value === calc.by)
  if (!g) return ans
  const by = new Map<string, T[]>()
  for (const it of list) {
    const ks = g.keys(it, ctx)
    for (const k of ks.length ? new Set(ks) : ['']) by.set(k, [...(by.get(k) ?? []), it])
  }
  const timeOrder = calc.by === 'month' || calc.by === 'year' || calc.by === 'season'
  ans.rows = [...by.entries()]
    .map(([key, xs]) => ({ key, label: key ? (g.name?.(key, ctx) ?? key) : 'non renseigné', n: xs.length, sums: total(xs) }))
    .sort((a, b) => (!a.key !== !b.key ? (a.key ? -1 : 1) : timeOrder ? b.key.localeCompare(a.key) : b.n - a.n || a.label.localeCompare(b.label, 'fr')))
  return ans
}

// ---------- Simple nom ou phrase ----------

// Mots d'une phrase (verbes, questions, critères) : la saisie est alors une phrase, même si elle trouve un nom.
const PHRASE_START =
  /^(?:les|des|mes|ceux|celles|tous|toutes|quels?|quelles?|combien|montre|affiche|cherche|trouve|liste|seulement|uniquement|efface|enleve|retire|supprime|recommence|trie|classe|ou|qui|donne|dis|avec|sans|cree|crees|a venir|passes?)\b/
const COMMAND = /^(?:efface|effacer|enleve|enlever|retire|retirer|supprime|recommence|reinitialise|trie|classe|combien|montre|affiche|peu importe|sans)\b/
const PHRASE_WORDS =
  /\b(?:combien|moyenne|par (?:type|mois|annee|lieu|departement|region|createur|comite|ligue|sexe|niveau|visibilite)|cette saison|ce mois|a venir|passes|depuis|entre|avant|apres|plus de|moins de|au moins|au plus|trie[sz]?|classe[sz]?|avec|sans|crees? par|ou je|mes)\b/

/**
 * La saisie est-elle une recherche locale (instantanée, sans appel) ? Vide : oui. Une phrase (« les tournois de cette
 * saison », « combien par mois ? ») : non. Sinon : oui si un élément contient tous ses mots (« Cannes », « Tournoi de
 * Cannes 2025 », « Intercomités 83 »), ou si elle est courte (trois mots au plus, sans chiffre de quantité) : un nom.
 */
export function isListSearch(text: string, hays: string[]): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (/[?!]/.test(t)) return false
  const n = normalize(t)
  // Un texte qui trouve un élément (« liste fictive », « Tournoi de Fictiville ») reste une recherche, sauf une commande.
  if (!COMMAND.test(n) && n.split(' ').length <= 6 && hays.some((h) => textMatch(h, t))) return true
  if (PHRASE_START.test(n) || PHRASE_WORDS.test(n)) return false
  const ws = n.split(' ').filter(Boolean)
  return ws.length <= 3 && !/\d/.test(n)
}

// ---------- Lecture d'une réponse du modèle (commune aux deux listes) ----------

export const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 12) : v === undefined || v === null || v === '' ? [] : [v])

/** « {op: ">=", n: 10} », « 10 » (au moins), « plus de 10 » (strict : 11) ; undefined sinon. */
export function parseNumCond(v: unknown): NumCond | undefined {
  let op: unknown = 'gte'
  let n: unknown = v
  if (isObj(v)) {
    op = v.op ?? 'gte'
    n = v.n ?? v.valeur ?? v.nombre
  }
  const num = typeof n === 'number' ? n : typeof n === 'string' && /^\s*\d+\s*$/.test(n) ? Number(n) : NaN
  if (!Number.isInteger(num) || num < 0 || num > 100000) return undefined
  const o = typeof op === 'string' ? normalize(op.replace('>=', ' ge ').replace('<=', ' le ').replace('>', ' gt ').replace('<', ' lt ').replace('=', ' eq ')) : ''
  if (/^(ge|gte|au moins|min|minimum)$/.test(o)) return { op: 'gte', n: num }
  if (/^(le|lte|au plus|max|maximum)$/.test(o)) return { op: 'lte', n: num }
  if (/^(gt|plus de)$/.test(o)) return { op: 'gte', n: num + 1 }
  if (/^(lt|moins de)$/.test(o)) return num > 0 ? { op: 'lte', n: num - 1 } : undefined
  if (/^(eq|egal|exactement)$/.test(o)) return { op: 'eq', n: num }
  return undefined
}

export const numOk = (c: NumCond, n: number) => (c.op === 'gte' ? n >= c.n : c.op === 'lte' ? n <= c.n : n === c.n)
export const numText = (c: NumCond, unit: string, units = `${unit}s`) =>
  `${c.op === 'gte' ? (c.n <= 1 ? 'au moins' : '≥') : c.op === 'lte' ? '≤' : ''} ${c.n} ${c.n > 1 ? units : unit}`.trim()

/** Clé « numérique » valide (session). */
export const cleanNum = (v: unknown): NumCond | undefined =>
  isObj(v) && ['gte', 'lte', 'eq'].includes(v.op as string) && Number.isInteger(v.n) && (v.n as number) >= 0 && (v.n as number) <= 100000 ? { op: v.op as Cmp, n: v.n as number } : undefined

/** Liste de textes courts (session). */
export const cleanStrings = (v: unknown, max = 10): string[] | undefined => {
  const xs = asList(v)
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((x) => x.trim().slice(0, 60))
    .slice(0, max)
  return xs.length ? [...new Set(xs)] : undefined
}

/** Tri rendu par le modèle : {tri, ordre} ; valeurs du tri de la page. */
export function parseSort(o: Record<string, unknown>, sorts: { value: string; dir: 'asc' | 'desc'; aliases: string[] }[]): ListSort | undefined {
  const t = typeof o.tri === 'string' ? normalize(o.tri) : ''
  if (!t) return undefined
  const s = sorts.find((x) => x.aliases.includes(t) || normalize(x.value) === t)
  if (!s) return undefined
  const ord = typeof o.ordre === 'string' ? normalize(o.ordre) : ''
  return { by: s.value, dir: /^(croissant|asc|ancien|plus ancien|petit)/.test(ord) ? 'asc' : /^(decroissant|desc|recent|grand)/.test(ord) ? 'desc' : s.dir }
}
