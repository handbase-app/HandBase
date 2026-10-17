// Années de naissance choisies (filtre « année » des joueurs, génération des événements, bilan de détection) : une LISTE
// d'années, vide = toutes. Fonctions pures, sans base ni écran (testées par tools/test-annees.ts).
//
//  - Recette (src/recipe.ts Population) : `years` [première, dernière] (bornes comprises, comme avant) et, seulement si
//    les années choisies ne se suivent pas, `yearList` (les années exactes, entre ces bornes). Une année seule
//    ([2011, 2011]) et une plage (« de 2010 à 2012 ») s'écrivent comme avant : les recettes enregistrées, les adresses et
//    le journal des questions d'avant restent lus tels quels ; une version d'avant de l'appli lit au moins les bornes.
//  - yearsShort : le résumé d'un bouton (« Toutes les années », « 2011 », « 2010 – 2012 », « 2010, 2012, 2014 »,
//    « 5 années ») ; yearsPhrase : la pastille (« nés en 2011 », « nés de 2010 à 2012 », « nés en 2010, 2012 ou 2014 »).
//  - yearsParam / parseYearsParam : l'adresse (a=2010,2011,2012 ; a=2011 d'avant ; « inconnue » : année non renseignée).
//  - parseSaidYears : une année, une liste ou une plage rendue par le modèle (2011, [2010, 2012], {de, a}, « 2010-2012 »,
//    « 2010 et 2012 »).

/** Au plus autant d'années choisies (une plage plus longue est ramenée à ses dernières années). */
export const MAX_YEARS = 40
/** Plage dite au plus (« nés avant 2010 » ne remonte pas à 1950). */
export const MAX_SPAN = 30

/** Années entières, sans doublon, de la plus ancienne à la plus récente (au plus MAX_YEARS, les plus récentes). */
export function uniqYears(xs: Iterable<unknown>, lim: readonly [number, number] = [1950, 2100]): number[] {
  const out = new Set<number>()
  for (const x of xs) {
    const n = typeof x === 'number' ? x : typeof x === 'string' && /^\s*\d{4}\s*$/.test(x) ? Number(x) : NaN
    if (Number.isInteger(n) && n >= lim[0] && n <= lim[1]) out.add(n)
  }
  return [...out].sort((a, b) => a - b).slice(-MAX_YEARS)
}

/** Années de a à b (bornes comprises, dans l'ordre). */
export function spanYears(a: number, b: number): number[] {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const out: number[] = []
  for (let y = Math.max(lo, hi - MAX_YEARS + 1); y <= hi; y++) out.push(y)
  return out
}

/** Les années (triées) se suivent-elles ? */
export const contiguous = (ys: readonly number[]) => ys.every((y, i) => i === 0 || y === ys[i - 1] + 1)

/** Champs d'années d'une population : bornes, et années exactes si elles ne se suivent pas. */
export type YearFields = { years?: [number, number]; yearList?: number[] }

/** Années choisies (null : toutes). */
export function yearsOf(f: YearFields): number[] | null {
  if (!f.years) return null
  if (f.yearList?.length) return [...f.yearList]
  return spanYears(f.years[0], f.years[1])
}

/** Forme rangée d'une liste d'années : rien (toutes), des bornes, ou des bornes et la liste (années qui ne se suivent pas). */
export function yearFields(ys: Iterable<unknown> | null | undefined): YearFields {
  const list = uniqYears(ys ?? [])
  if (!list.length) return {}
  const years: [number, number] = [list[0], list[list.length - 1]]
  return contiguous(list) ? { years } : { years, yearList: list }
}

/** Pose les années choisies (vide ou null : toutes) dans la population (modifiée). */
export function putYears(f: YearFields, ys: Iterable<unknown> | null | undefined) {
  delete f.years
  delete f.yearList
  Object.assign(f, yearFields(ys))
}

/** Une année de naissance ('' ou absente : inconnue) est-elle parmi les années choisies ? */
export function inYears(f: YearFields, year: string | number | undefined): boolean {
  if (!f.years) return true
  const y = Number(year)
  if (!year || !Number.isInteger(y) || y < f.years[0] || y > f.years[1]) return false
  return !f.yearList?.length || f.yearList.includes(y)
}

/**
 * Champs d'années lus dans l'adresse, la session ou « Mes questions » (rien n'y est cru) : bornes [a, b] d'avant ; liste
 * gardée seulement entre ces bornes, et seulement si ses années ne se suivent pas (sinon les bornes suffisent).
 */
export function cleanYearFields(rawYears: unknown, rawList: unknown, lim: readonly [number, number]): YearFields {
  if (!Array.isArray(rawYears) || rawYears.length !== 2) return {}
  const [a, b] = rawYears.map((x) => (typeof x === 'number' && Number.isInteger(x) && x >= lim[0] && x <= lim[1] ? x : undefined))
  if (a === undefined || b === undefined) return {}
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  const list = Array.isArray(rawList) ? uniqYears(rawList, lim).filter((y) => y >= lo && y <= hi) : []
  return list.length ? yearFields(list) : { years: [lo, hi] }
}

const label = (y: number | string, unknown: string) => (y === '' ? unknown : String(y))

/**
 * Résumé d'un choix d'années (bouton) : « Toutes les années », « 2011 », « 2010 – 2012 » (années qui se suivent),
 * « 2010, 2012, 2014 », ou « 5 années » si c'est trop long. '' : année inconnue.
 */
export function yearsShort(ys: readonly (number | string)[], opts: { all?: string; unknown?: string; max?: number } = {}): string {
  const all = opts.all ?? 'Toutes les années'
  const unknown = opts.unknown ?? 'Année inconnue'
  if (!ys.length) return all
  if (ys.length === 1) return label(ys[0], unknown)
  const known = uniqYears(ys)
  const hasUnknown = ys.some((y) => y === '')
  if (!hasUnknown && known.length > 1 && contiguous(known)) return `${known[0]} – ${known[known.length - 1]}`
  const parts = [...known.map(String), ...(hasUnknown ? [unknown.toLowerCase()] : [])]
  const text = parts.join(', ')
  return parts.length <= 3 && text.length <= (opts.max ?? 22) ? text : `${parts.length} années`
}

/** « a, b ou c » */
const orList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ou ${xs[xs.length - 1]}`)

/** Pastille : « nés en 2011 », « nés de 2010 à 2012 », « nés en 2010, 2012 ou 2014 » (e : '', 's', 'es'). */
export function yearsPhrase(ys: readonly number[], e = 's'): string {
  const list = uniqYears(ys)
  if (!list.length) return ''
  if (list.length === 1) return `né${e} en ${list[0]}`
  if (contiguous(list)) return `né${e} de ${list[0]} à ${list[list.length - 1]}`
  if (list.length > 6) return `né${e} en ${list.length} années, de ${list[0]} à ${list[list.length - 1]}`
  return `né${e} en ${orList(list.map(String))}`
}

/** Adresse : « 2010,2011,2012 » ('' : `unknown`, année non renseignée). */
export const yearsParam = (ys: readonly string[], unknown = 'inconnue') => ys.map((y) => y || unknown).join(',')

/** Adresse lue : « 2011 » (d'avant), « 2010,2011,2012 », « 2010-2012 », « inconnue ». Années triées, la récente d'abord, l'inconnue à la fin. */
export function parseYearsParam(s: string | null | undefined, unknown = 'inconnue'): string[] {
  if (!s) return []
  const out = new Set<string>()
  for (const part of s.split(/[,;\s]+/).slice(0, 200)) {
    if (part === unknown) out.add('')
    const m = /^(\d{4})(?:-(\d{4}))?$/.exec(part)
    if (!m) continue
    if (m[2]) for (const y of spanYears(Number(m[1]), Number(m[2]))) out.add(String(y))
    else out.add(m[1])
  }
  return sortYearStrings([...out]).slice(0, MAX_YEARS + 1)
}

/** Années (textes) de la plus récente à la plus ancienne, l'année inconnue ('') à la fin, sans doublon. */
export const sortYearStrings = (ys: Iterable<string>) => [...new Set(ys)].sort((a, b) => (!a ? 1 : !b ? -1 : b.localeCompare(a)))

/** Années proposées sans effectifs (questions enregistrées, pastille « nés en ») : de cette année à `n` ans avant. */
export const recentYears = (thisYear: number, n = MAX_SPAN) => spanYears(thisYear - n, thisYear).reverse().map((y) => ({ value: String(y) }))

/** Ajoute ou retire une année d'un choix (textes, la récente d'abord). */
export const toggleYear = (ys: readonly string[], y: string) => sortYearStrings(ys.includes(y) ? ys.filter((x) => x !== y) : [...ys, y])

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Années dites, telles que rendues par le modèle : 2011, « 2011 », [2010, 2012] (les années citées), {de, a} (une plage ;
 * une borne seule : cette année), « 2010-2012 », « de 2010 à 2012 », « entre 2010 et 2012 » (plages), « 2010, 2012 et
 * 2014 », « 2010 ou 2012 » (listes). Une plage de plus de MAX_SPAN ans est ramenée à ses dernières années. undefined :
 * rien de lisible (une valeur illisible dans une liste la rend illisible : rien n'est deviné).
 */
export function parseSaidYears(v: unknown, thisYear: number, min = 1950): number[] | undefined {
  const one = (x: unknown): number | undefined => {
    const n = typeof x === 'number' ? x : typeof x === 'string' && /^\s*\d{4}\s*$/.test(x) ? Number(x) : NaN
    return Number.isInteger(n) && n >= min && n <= thisYear ? n : undefined
  }
  const range = (a: number, b: number) => {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    return spanYears(Math.max(lo, hi - MAX_SPAN), hi)
  }
  if (isObj(v)) {
    const lo = one(v.de ?? v.min ?? v.debut ?? v.du)
    const hi = one(v.a ?? v.max ?? v.fin ?? v.au)
    if (lo === undefined && hi === undefined) return undefined
    return range(lo ?? hi!, hi ?? lo!)
  }
  if (Array.isArray(v)) {
    if (!v.length || v.length > 60) return undefined
    const ys: number[] = []
    for (const x of v) {
      const r = isObj(x) || Array.isArray(x) || (typeof x === 'string' && !/^\s*\d{4}\s*$/.test(x)) ? parseSaidYears(x, thisYear, min) : one(x) !== undefined ? [one(x)!] : undefined
      if (!r) return undefined
      ys.push(...r)
    }
    return uniqYears(ys, [min, thisYear])
  }
  if (typeof v === 'number') return one(v) !== undefined ? [one(v)!] : undefined
  if (typeof v !== 'string') return undefined
  const s = v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^\d{4}$/.test(s)) return one(s) !== undefined ? [one(s)!] : undefined
  const r = /^(?:de |du |entre )?(\d{4}) ?(?:-|–|a|au|jusqu a|et) ?(\d{4})$/.exec(s)
  // « 2010 et 2012 » : les deux années ; « entre 2010 et 2012 », « 2010-2012 », « de 2010 à 2012 » : la plage.
  if (r && !(/ et /.test(s) && !s.startsWith('entre'))) {
    const a = one(r[1])
    const b = one(r[2])
    return a !== undefined && b !== undefined ? range(a, b) : undefined
  }
  const parts = s.split(/ ?(?:,|;|\bet\b|\bou\b|\/) ?/).filter(Boolean)
  if (parts.length < 2 || parts.some((p) => !/^\d{4}$/.test(p))) return undefined
  const ys = parts.map(one)
  return ys.every((y) => y !== undefined) ? uniqYears(ys as number[], [min, thisYear]) : undefined
}
