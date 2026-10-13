// Nettoyage d'une dictée en français, par règles simples (fonction pure, réutilisable dans l'application).
// - retire les hésitations (euh, heu, hum, bah, ben, hein) et les tics de langage placés en début ou fin
//   de phrase ou entre virgules (en fait, tu vois, tu sais, du coup, voilà en début ou en fin) ;
// - retire les répétitions immédiates d'un mot ou d'un groupe de 2 à 3 mots (« le le », « très très ») ;
// - corrige les espaces et la ponctuation à la française, met une majuscule en début de phrase.
// - corrige pour finir les erreurs de reconnaissance connues du vocabulaire du handball (vocabulaire.js).
// Aucun autre mot n'est retiré : le sens est gardé.

import { corrections } from './vocabulaire.js'

const NBSP = '\u00A0'
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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function removeTics(t) {
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
function removeRepeats(t) {
  const tokens = t.split(/\s+/).filter(Boolean)
  const bare = (w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  const out = []
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

function fixPunctuation(t) {
  t = t.replace(/[\s\u00A0\u202F]+/g, ' ').trim()
  t = t.replace(/\s+([,.…])/g, '$1') // pas d'espace avant , . …
  t = t.replace(/\s*([;:!?])/g, NBSP + '$1') // espace insécable avant ; : ! ?
  t = t.replace(/,(\s*,)+/g, ',') // virgules en double
  t = t.replace(/,\s*([.!?…])/g, '$1') // virgule juste avant une fin de phrase
  t = t.replace(new RegExp('([.!?…])' + NBSP + '?([.!?])', 'g'), (m, a, b) => (a === b ? a : m))
  t = t.replace(/^[\s,;:.]+/, '') // ponctuation laissée en tête
  t = t.replace(/([,;:!?.…])(?=[\p{L}\p{N}«(])/gu, (m, p, off, s) => {
    // pas d'espace ajoutée dans les nombres (« 1,5 ») ni les sigles (« U.S. »)
    const before = s[off - 1] || ''
    if ((p === ',' || p === '.') && /\d/.test(before) && /\d/.test(s[off + 1] || '')) return p
    if (p === '.' && /\p{Lu}/u.test(before) && /\p{Lu}/u.test(s[off + 1] || '')) return p
    return p + ' '
  })
  t = t.replace(/ {2,}/g, ' ').trim()
  // majuscule en début de texte et après . ! ? (pas après …, souvent en milieu de phrase)
  t = t.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (m, a, b) => a + b.toUpperCase())
  t = t.replace(/[,;:\s ]+$/u, '') // virgule ou deux-points laissés en fin
  if (t && /[\p{L}\p{N}»)]$/u.test(t)) t += '.'
  return t
}

// Lettres tolérant les accents, pour les corrections données en chaîne.
const ACCENTS = { a: '[aàâä]', e: '[eéèêë]', i: '[iîï]', o: '[oôö]', u: '[uùûü]', c: '[cç]', y: '[yÿ]' }
function patternFrom(faux) {
  if (faux instanceof RegExp) return faux
  const base = faux.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  let src = ''
  for (const ch of base) {
    if (ch === ' ' || ch === '-') src += '[\\s-]+'
    else if (ACCENTS[ch]) src += ACCENTS[ch]
    else src += escapeRe(ch)
  }
  return new RegExp('(?<![\\p{L}\\p{N}])' + src + '(?![\\p{L}\\p{N}])', 'giu')
}
const COMPILED = corrections.map((c) => ({ re: patternFrom(c.faux), juste: c.juste }))

// Applique les corrections ; renvoie le texte et la liste des remplacements réellement faits.
export function corriger(texte) {
  const faites = []
  let t = texte
  for (const { re, juste } of COMPILED) {
    re.lastIndex = 0
    t = t.replace(re, (...args) => {
      const m = args[0]
      const named = typeof args.at(-1) === 'object'
      const off = args.at(named ? -3 : -2)
      const src = args.at(named ? -2 : -1)
      const debutPhrase = off === 0 || /[.!?]\s*$/.test(src.slice(0, off))
      let r = typeof juste === 'function' ? juste(...args) : juste.replace(/\$(\d)/g, (x, k) => args[Number(k)] ?? '')
      // majuscule gardée en début de phrase
      if (debutPhrase && /^\p{Lu}/u.test(m) && /^\p{Ll}/u.test(r)) r = r[0].toUpperCase() + r.slice(1)
      if (r !== m) faites.push({ de: m, vers: r })
      return r
    })
  }
  return { texte: t, corrections: faites }
}

export function nettoyerDetail(texte) {
  if (!texte) return { texte: '', corrections: [] }
  // Voxtral recopie parfois les mots de contexte avec leurs « _ » (« 1_contre_1 ») : on remet des espaces.
  let t = ' ' + String(texte).replace(/([\p{L}\p{N}])_(?=[\p{L}\p{N}])/gu, '$1 ').replace(/[\s\u00A0\u202F]+/g, ' ') + ' '
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
  return corriger(t)
}

export function nettoyer(texte) {
  return nettoyerDetail(texte).texte
}
