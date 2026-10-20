// Recherche par nom tolérante (fonctions pures, testées dans tools/test-recherche-vocale.ts).
//  - texte sans accents ni majuscules ; traits d'union, apostrophes et espaces équivalents (« Jean-Pierre », « jean pierre »,
//    « jeanpierre ») ;
//  - numéro de licence dit chiffre par chiffre ou par groupes (« 638 301 500 1234 ») : les groupes de chiffres sont recollés ;
//  - si la recherche exacte ne trouve personne : noms approchants (même son en français, ou une ou deux lettres de différence),
//    pour les noms mal écrits par la dictée (« Dupond » / « Dupont », « Mathéo » / « Matteo »).
// Rapide sur une grande base : clés exactes calculées une fois par liste ; sons calculés seulement pour la recherche approchante
// et gardés en mémoire.

/** Minuscules sans accents ; traits d'union, apostrophes, points et virgules deviennent des espaces. */
export const nameKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-‐‑'’`´.,;:_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Mots de la recherche ; les groupes de chiffres qui se suivent sont recollés (licence dite par morceaux). */
export function queryWords(q: string): string[] {
  const out: string[] = []
  for (const w of nameKey(q).split(' ').filter(Boolean)) {
    const prev = out[out.length - 1]
    if (/^\d+$/.test(w) && prev && /^\d+$/.test(prev)) out[out.length - 1] = prev + w
    else out.push(w)
  }
  return out
}

/** Texte où chercher pour un joueur : nom, prénom (séparés et collés), club, équipe, licence. */
export function playerHaystack(p: { firstName?: string; lastName?: string; club?: string; team?: string; license?: string }): string {
  const names = nameKey(`${p.firstName ?? ''} ${p.lastName ?? ''}`)
  const glued = [nameKey(p.firstName ?? ''), nameKey(p.lastName ?? '')].map((x) => x.replace(/ /g, '')).join(' ')
  return `${names} ${glued} ${nameKey(p.club ?? '')} ${nameKey(p.team ?? '')} ${(p.license ?? '').replace(/\D/g, '')}`
}

/** Tous les mots sont dans le texte (début, milieu ou fin de mot, comme avant). */
export const exactMatch = (hay: string, words: string[]) => words.every((w) => hay.includes(w))

const phoneticCache = new Map<string, string>()

/**
 * Clé de son en français, simple (règles courantes, lettres finales muettes, lettres doublées) : Dupond = Dupont,
 * Mathéo = Matteo, Lefebvre = Lefèvre, Philippe = Filipe, Gauthier = Gautier, Rémi = Rémy, Thomas = Tomas, Martins = Martin.
 */
export function phonetic(word: string): string {
  const cached = phoneticCache.get(word)
  if (cached !== undefined) return cached
  let s = nameKey(word).replace(/[^a-z]/g, '')
  s = s
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/sch/g, 'ch')
    .replace(/ch/g, 'C')
    .replace(/qu/g, 'k')
    .replace(/gu(?=[eiy])/g, 'g')
    .replace(/g(?=[eiy])/g, 'j')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/w/g, 'v')
    .replace(/y/g, 'i')
    .replace(/bv/g, 'v')
    .replace(/eaux?|aux?|au/g, 'o')
    .replace(/ai|ei/g, 'e')
    .replace(/(?:ain|ein|in|im|un|um)(?=[^aeiou]|$)/g, 'I')
    .replace(/(?:an|en|am|em)(?=[^aeiou]|$)/g, 'A')
    .replace(/gn/g, 'n')
    .replace(/h/g, '')
  // Lettres finales muettes (Dupond, Dupont, Martins, Duprez…), puis lettres doublées.
  s = s.replace(/(?:[dtspxe])+$/g, '')
  s = s.replace(/(.)\1+/g, '$1')
  const key = s || nameKey(word)
  if (phoneticCache.size > 50_000) phoneticCache.clear()
  phoneticCache.set(word, key)
  return key
}

// Deux lignes de calcul réutilisées (la recherche approchante l'appelle pour chaque mot de 40 000 fiches : sans nouveau
// tableau à chaque appel, environ 4 fois plus rapide).
const ROW_A = new Int32Array(64)
const ROW_B = new Int32Array(64)

/** Distance d'édition, arrêtée au-delà de `max` (renvoie max + 1). */
export function levenshtein(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const long = b.length >= ROW_A.length
  let prev = long ? new Int32Array(b.length + 1) : ROW_A
  let cur = long ? new Int32Array(b.length + 1) : ROW_B
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let best = i
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ai === b.charCodeAt(j - 1) ? 0 : 1))
      cur[j] = v
      if (v < best) best = v
    }
    if (best > max) return max + 1
    const x = prev
    prev = cur
    cur = x
  }
  return prev[b.length]
}

/** Un mot de la recherche ressemble-t-il à un mot du nom ? (3 lettres au moins ; 1 lettre d'écart, 2 dès 6 lettres.) */
export const nameLike = (w: string, token: string): boolean => nameLikeFor(w)(token)

/** nameLike pour un mot donné, préparé une fois (recherche dans une longue liste : pas de travail refait par fiche). */
export function nameLikeFor(w: string): (token: string) => boolean {
  if (w.length < 3 || !/^[a-z]+$/.test(w)) return () => false
  const key = phonetic(w)
  const max = w.length >= 6 ? 2 : 1
  return (token) => token === w || phonetic(token) === key || levenshtein(w, token, max) <= max
}

/**
 * Recherche dans une liste : exacte d'abord ; si personne, approchante (chaque mot est dans le texte, ou ressemble à un mot
 * du nom ou du prénom, et au moins un mot ressemble). `hay` et `tokens` : textes déjà préparés pour chaque élément.
 */
export function searchByName<T>(
  list: T[],
  q: string,
  hay: (t: T) => string,
  tokens: (t: T) => string[],
): { list: T[]; approx: boolean } {
  const words = queryWords(q)
  if (!words.length) return { list, approx: false }
  const exact = list.filter((t) => exactMatch(hay(t), words))
  if (exact.length || !words.some((w) => /^[a-z]{3,}$/.test(w))) return { list: exact, approx: false }
  const like = words.map(nameLikeFor)
  const near = list.filter((t) => {
    const h = hay(t)
    const toks = tokens(t)
    let fuzzy = false
    for (let i = 0; i < words.length; i++) {
      if (h.includes(words[i])) continue
      if (!toks.some(like[i])) return false
      fuzzy = true
    }
    return fuzzy
  })
  return { list: near, approx: near.length > 0 }
}

/** Mots du nom et du prénom (pour la recherche approchante). */
export const nameTokens = (p: { firstName?: string; lastName?: string }) => nameKey(`${p.firstName ?? ''} ${p.lastName ?? ''}`).split(' ').filter(Boolean)
