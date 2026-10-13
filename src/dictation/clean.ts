// Nettoyage d'une dictée en français, par règles simples (fonctions pures). Source de vérité : la page d'essai
// public/essai-dictee/nettoyage.js en garde une copie en JavaScript (à tenir alignée ; test : tools/test-dictee.ts).
// - remet des espaces dans les « _ » recopiés par Voxtral depuis les mots de contexte (« 1_contre_1 ») ;
// - retire les hésitations (euh, heu, hum, bah, ben, hein) et les tics de langage placés en début ou fin
//   de phrase ou entre virgules (en fait, tu vois, tu sais, du coup, voilà en début ou en fin) ;
// - retire les répétitions immédiates d'un mot ou d'un groupe de 2 à 3 mots (« le le », « très très ») ;
// - corrige les espaces et la ponctuation à la française, met une majuscule en début de phrase ;
// - corrige pour finir les erreurs de reconnaissance connues du vocabulaire du handball (vocabulary.ts).
// Aucun autre mot n'est retiré, rien n'est reformulé : le sens est gardé.

import { corrections, type Correction } from './vocabulary'

const NBSP = ' '
// Toujours des hésitations, où qu'elles soient.
const ALWAYS = /(^|[\s,;.!?…])(?:e+u+h+|h+e+u+h*|hum+|hm+|bah|hein)(?=$|[\s,;.!?…])/giu
// « ben » seulement en minuscules (« Ben » peut être un prénom).
const BEN = /(^|[\s,;.!?…])ben(?=$|[\s,;.!?…])/gu
// Tics de langage : en début de phrase, entre virgules ou en fin de phrase seulement
// (« il en fait trop » garde son « en fait »).
const TICS = ['en fait', 'tu vois', 'tu sais', 'du coup']
// Mots qui se répètent normalement (« nous nous entraînons », « vous vous placez »).
// Les nombres aussi : « 2 contre 1, 1 contre 1 » ne doit rien perdre.
const KEEP_DOUBLE = new Set(['nous', 'vous', 'que', 'qu', 'un', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'])

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function removeTics(t: string): string {
  for (const tic of TICS) {
    const w = escapeRe(tic).replace(/ /g, '\\s+')
    // début de texte ou de phrase : « En fait, le pivot… »
    t = t.replace(new RegExp('(^|[.!?…]\\s*)' + w + '\\s*,?\\s*', 'giu'), '$1')
    // entre virgules : « le pivot, du coup, recule »
    t = t.replace(new RegExp(',\\s*' + w + '\\s*,', 'giu'), ',')
    // fin de phrase : « …bien placé, tu vois. »
    t = t.replace(new RegExp(',?\\s*\\b' + w + '\\s*(?=[.!?…]|$)', 'giu'), '')
  }
  // « voilà » en début ou en fin seulement
  t = t.replace(/(^|[.!?…]\s*)voil[àa]\s*[,.]?\s*/giu, '$1')
  t = t.replace(/,?\s*\bvoil[àa]\s*(?=[.!?…]|$)/giu, '')
  return t
}

// Répétitions immédiates : on compare les mots sans la ponctuation qui les sépare.
function removeRepeats(t: string): string {
  const tokens = t.split(/\s+/).filter(Boolean)
  const bare = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    for (const n of [3, 2, 1]) {
      if (out.length < n || i + n > tokens.length) continue
      const prev = out.slice(-n).map(bare)
      const next = tokens.slice(i, i + n).map(bare)
      if (prev.some((w) => !w)) continue
      if (n === 1 && (KEEP_DOUBLE.has(prev[0]) || /^\d+$/.test(prev[0]))) continue
      if (prev.join(' ') === next.join(' ')) {
        // On retire la première occurrence, la seconde (et sa ponctuation) est gardée.
        out.splice(out.length - n, n)
        break
      }
    }
    out.push(tokens[i])
  }
  return out.join(' ')
}

function fixPunctuation(t: string): string {
  t = t.replace(/[\s  ]+/g, ' ').trim()
  t = t.replace(/\s+([,.…])/g, '$1') // pas d'espace avant , . …
  t = t.replace(/\s*([;:!?])/g, NBSP + '$1') // espace insécable avant ; : ! ?
  t = t.replace(/,(\s*,)+/g, ',') // virgules en double
  t = t.replace(/,\s*([.!?…])/g, '$1') // virgule juste avant une fin de phrase
  t = t.replace(new RegExp('([.!?…])' + NBSP + '?([.!?])', 'g'), (m, a: string, b: string) => (a === b ? a : m))
  t = t.replace(/^[\s,;:.]+/, '') // ponctuation laissée en tête
  t = t.replace(/([,;:!?.…])(?=[\p{L}\p{N}«(])/gu, (_m, p: string, off: number, s: string) => {
    // pas d'espace ajoutée dans les nombres (« 1,5 ») ni les sigles (« U.S. »)
    const before = s[off - 1] || ''
    if ((p === ',' || p === '.') && /\d/.test(before) && /\d/.test(s[off + 1] || '')) return p
    if (p === '.' && /\p{Lu}/u.test(before) && /\p{Lu}/u.test(s[off + 1] || '')) return p
    return p + ' '
  })
  t = t.replace(/ {2,}/g, ' ').trim()
  // majuscule en début de texte et après . ! ? (pas après …, souvent en milieu de phrase)
  t = t.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
  t = t.replace(/[,;:\s ]+$/u, '') // virgule ou deux-points laissés en fin
  if (t && /[\p{L}\p{N}»)]$/u.test(t)) t += '.'
  return t
}

// Lettres tolérant les accents, pour les corrections données en chaîne.
const ACCENTS: Record<string, string> = { a: '[aàâä]', e: '[eéèêë]', i: '[iîï]', o: '[oôö]', u: '[uùûü]', c: '[cç]', y: '[yÿ]' }
function patternFrom(faux: Correction['faux']): RegExp {
  if (faux instanceof RegExp) return faux
  const base = faux.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  let src = ''
  for (const ch of base) {
    if (ch === ' ' || ch === '-') src += '[\\s-]+'
    else if (ACCENTS[ch]) src += ACCENTS[ch]
    else src += escapeRe(ch)
  }
  return new RegExp('(?<![\\p{L}\\p{N}])' + src + '(?![\\p{L}\\p{N}])', 'giu')
}
const COMPILED = corrections.map((c) => ({ re: patternFrom(c.faux), juste: c.juste }))

export type Replacement = { de: string; vers: string }

/** Applique les corrections du vocabulaire ; renvoie le texte et la liste des remplacements réellement faits. */
export function correct(texte: string): { texte: string; corrections: Replacement[] } {
  const faites: Replacement[] = []
  let t = texte
  for (const { re, juste } of COMPILED) {
    re.lastIndex = 0
    t = t.replace(re, (...args: unknown[]) => {
      const m = args[0] as string
      const named = typeof args.at(-1) === 'object'
      const off = args.at(named ? -3 : -2) as number
      const src = args.at(named ? -2 : -1) as string
      const debutPhrase = off === 0 || /[.!?]\s*$/.test(src.slice(0, off))
      let r =
        typeof juste === 'function'
          ? juste(m, ...(args.slice(1) as string[]))
          : juste.replace(/\$(\d)/g, (_x, k: string) => (args[Number(k)] as string | undefined) ?? '')
      // majuscule gardée en début de phrase
      if (debutPhrase && /^\p{Lu}/u.test(m) && /^\p{Ll}/u.test(r)) r = r[0].toUpperCase() + r.slice(1)
      if (r !== m) faites.push({ de: m, vers: r })
      return r
    })
  }
  return { texte: t, corrections: faites }
}

/** Nettoyage complet (hésitations, répétitions, ponctuation, puis corrections), avec le détail des corrections. */
export function cleanDetail(texte: string | null | undefined): { texte: string; corrections: Replacement[] } {
  if (!texte) return { texte: '', corrections: [] }
  // Voxtral recopie parfois les mots de contexte avec leurs « _ » (« 1_contre_1 ») : on remet des espaces.
  let t = ' ' + String(texte).replace(/([\p{L}\p{N}])_(?=[\p{L}\p{N}])/gu, '$1 ').replace(/[\s  ]+/g, ' ') + ' '
  // deux passages : « euh, euh » ou « euh hein »
  for (let k = 0; k < 2; k++) {
    t = t.replace(ALWAYS, '$1').replace(BEN, '$1')
  }
  t = t.replace(/\s*\.{3}\s*/g, ' … ').replace(/…(\s*…)+/g, '…').replace(/\s+/g, ' ').trim()
  t = removeTics(t)
  t = removeRepeats(t)
  t = fixPunctuation(t)
  // « … » laissé en tête ou isolé après le retrait d'une hésitation
  t = t.replace(/^…\s*/, '').replace(/,\s*…/g, ',').replace(/…\s*,/g, ',')
  t = t.replace(/^(\p{Ll})/u, (m) => m.toUpperCase())
  return correct(t)
}

/** Texte dicté nettoyé et corrigé (sans reformulation). */
export const clean = (texte: string | null | undefined) => cleanDetail(texte).texte
