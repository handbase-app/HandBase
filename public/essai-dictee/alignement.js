// Alignement mot à mot d'une transcription sur un texte de référence, et analyse des erreurs (page d'essai).
// Fonctions pures, sans DOM : testées par tools/test-alignement.ts.
//
// - morceaux(texte) : découpe en mots ; chaque morceau garde son texte d'origine (affichage) et une forme
//   normalisée (comparaison sans majuscules, accents ni ponctuation ; « douze » = « 12 », « 23ème » = « 23e »).
// - aligner(ref, hyp) : alignement de Levenshtein (ok, substitution, insertion, suppression) et taux d'erreur.
// - erreurs(ops) : erreurs voisines regroupées en expressions (« roucoulette » → « roue coulette »).
// - classer(err, ctx) : (a) correction possible, (b) mot de contexte à ajouter, (c) ambigu (aucune règle).
// - analyser(lectures, ctx) : erreurs de toutes les lectures, comptées et classées.

const NOMBRES = {
  zero: '0', un: '1', une: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6', sept: '7', huit: '8', neuf: '9',
  dix: '10', onze: '11', douze: '12', treize: '13', quatorze: '14', quinze: '15', seize: '16', vingt: '20',
}

const sansAccents = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Forme normalisée d'un morceau (chaîne vide : ponctuation seule).
export function normaliser(m) {
  let w = sansAccents(m).replace(/œ/g, 'oe').replace(/æ/g, 'ae')
  if (w === '+') return 'plus'
  w = w.replace(/[^a-z0-9]+/g, '')
  if (!w) return ''
  const ord = w.match(/^(\d+)(?:e|eme|ieme|er|ere)$/)
  if (ord) return ord[1] + 'e'
  return NOMBRES[w] || w
}

// Découpe : espaces, puis traits d'union, apostrophes et « + » (« demi-centre » → « demi- » « centre »,
// « l'ailier » → « l' » « ailier », « 5+1 » → « 5 » « + » « 1 »). Chaque morceau : { t, n, mot }
// (texte affiché, forme normalisée, indice du mot d'origine dans le texte).
export function morceaux(texte) {
  const out = []
  const mots = String(texte || '').replace(/\bn°\s*/giu, 'numéro ').split(/[\s  ]+/).filter(Boolean)
  mots.forEach((mot, i) => {
    const parts = mot.match(/[^-–'’+]+[-–'’]?|\+/gu) || []
    for (const t of parts) {
      const n = normaliser(t)
      if (n) out.push({ t, n, mot: i, src: mot })
      else if (out.length) out[out.length - 1].t += (out[out.length - 1].mot === i ? '' : ' ') + t // ponctuation : affichée avec le mot d'avant
    }
  })
  return out
}

// Alignement de Levenshtein. Renvoie { ops, wer, n, s, d, i } ; ops : { op: 'ok'|'sub'|'del'|'ins', r, h }.
export function aligner(refTexte, hypTexte) {
  const R = Array.isArray(refTexte) ? refTexte : morceaux(refTexte)
  const H = Array.isArray(hypTexte) ? hypTexte : morceaux(hypTexte)
  const m = R.length
  const n = H.length
  const D = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Uint32Array(n + 1)
    row[0] = i
    return row
  })
  for (let j = 0; j <= n; j++) D[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c = R[i - 1].n === H[j - 1].n ? 0 : 1
      D[i][j] = Math.min(D[i - 1][j - 1] + c, D[i - 1][j] + 1, D[i][j - 1] + 1)
    }
  }
  const ops = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (R[i - 1].n === H[j - 1].n ? 0 : 1)) {
      ops.push({ op: R[i - 1].n === H[j - 1].n ? 'ok' : 'sub', r: R[i - 1], h: H[j - 1] })
      i--; j--
    } else if (i > 0 && D[i][j] === D[i - 1][j] + 1) {
      ops.push({ op: 'del', r: R[i - 1], h: null })
      i--
    } else {
      ops.push({ op: 'ins', r: null, h: H[j - 1] })
      j--
    }
  }
  ops.reverse()
  const s = ops.filter((o) => o.op === 'sub').length
  const d = ops.filter((o) => o.op === 'del').length
  const ins = ops.filter((o) => o.op === 'ins').length
  return { ops, n: m, s, d, i: ins, wer: m ? (s + d + ins) / m : null }
}

// Taux d'erreur seul (comme la page le calculait déjà pour les phrases).
export function tauxErreur(ref, hyp) {
  return aligner(ref, hyp).wer
}

// Texte d'origine couvert par une suite de morceaux : mots entiers, ponctuation de bord retirée.
function texteDe(list) {
  const out = []
  let last = -1
  for (const m of list) {
    if (m.mot === last) continue
    last = m.mot
    out.push(m.src)
  }
  return out.join(' ').replace(/^[^\p{L}\p{N}+]+|[^\p{L}\p{N}+]+$/gu, '')
}

// Erreurs voisines regroupées ; une erreur qui touche une partie d'un mot (« demi-centre » → « demi sentre »)
// s'étend au mot entier des deux côtés. Renvoie [{ ref, hyp, refN, hypN, nRef, nHyp }].
export function erreurs(ops) {
  const runs = []
  let k = 0
  while (k < ops.length) {
    if (ops[k].op === 'ok') { k++; continue }
    let a = k
    let b = k
    while (b + 1 < ops.length && ops[b + 1].op !== 'ok') b++
    runs.push([a, b])
    k = b + 1
  }
  const memeMot = (x, y, cote) => x[cote] && y[cote] && x[cote].mot === y[cote].mot
  const etendus = []
  for (let [a, b] of runs) {
    let change = true
    while (change) {
      change = false
      if (a > 0 && (memeMot(ops[a - 1], ops[a], 'r') || memeMot(ops[a - 1], ops[a], 'h') || touche(ops, a - 1, a, b))) { a--; change = true }
      if (b < ops.length - 1 && (memeMot(ops[b], ops[b + 1], 'r') || memeMot(ops[b], ops[b + 1], 'h') || touche(ops, b + 1, a, b))) { b++; change = true }
    }
    const prev = etendus[etendus.length - 1]
    if (prev && a <= prev[1] + 1) prev[1] = Math.max(prev[1], b)
    else etendus.push([a, b])
  }
  return etendus.map(([a, b]) => {
    const seg = ops.slice(a, b + 1)
    const R = seg.map((o) => o.r).filter(Boolean)
    const H = seg.map((o) => o.h).filter(Boolean)
    return { ref: texteDe(R), hyp: texteDe(H), refN: R.map((m) => m.n).join(' '), hypN: H.map((m) => m.n).join(' '), nRef: R.length, nHyp: H.length }
  })
}
// Un morceau juste voisin appartient-il à un mot déjà couvert par l'erreur (d'un côté ou de l'autre) ?
function touche(ops, x, a, b) {
  const o = ops[x]
  for (let k = a; k <= b; k++) {
    if (o.r && ops[k].r && o.r.mot === ops[k].r.mot) return true
    if (o.h && ops[k].h && o.h.mot === ops[k].h.mot) return true
  }
  return false
}

// ---------- classement ----------

// Mots français courants (forme normalisée) : jamais « faux » d'une règle seuls.
const COURANTS = new Set((
  'a ai as au aux avec avoir ce ces cet cette c ca d dans de des du elle elles en et est etre eu fait faire il ils ' +
  'je j l la le les leur leurs lui m ma mais me meme mes moi mon ne n nous on ont ou par pas peu plus pour qu que qui ' +
  's sa sans se ses si son sont sur t ta te tes toi ton tous tout toute toutes tu un une vos votre vous y ' +
  'bien bon bonne beau belle tres trop encore toujours jamais deja aussi alors apres avant puis donc car comme quand ' +
  'ici la haut bas bras main mains pied pieds tete dos jambe corps dent dents poing point points poings cou coup coups ' +
  'sert sers serre serres serrent cerf serf axe axee axes agee age ages lance lancer lancee lances lancez lancent ' +
  'tir tire tirs tires sort sors sortent sortie temps tant tend tends balle bal ballon vers vert verre ver fin faim ' +
  'peut peux saut seau sot cour cours court courts pris prix fois foi foie mur dur sur sure prend prends prendre ' +
  'passe passes passer passent garde gardes garder arrete arret arrets marque marques marquer jeu jeux joue jouer ' +
  'match matchs score minute minutes seconde secondes fin debut cote cotes face droite droit gauche centre milieu ' +
  'haute haut basse rapide vite lent fort forte force calme belle grand grande petit petite gros grosse long longue ' +
  'premier premiere dernier derniere autre autres chaque plusieurs certain quelque rien personne chose ' +
  'va vas vont vais aller venir vient viennent dit dire voit voir sait savoir doit devoir faut peut pouvoir veut vouloir ' +
  'lui leur eux celui celle ceux celles dont ou quoi comment pourquoi combien ' +
  'roue roux rou lieu lieux lie mer mere pere pare pari part parts paie paye paix plein pleine salle sale ' +
  'aile ailes elle elles bloc blocs ecran ecrans croise croisee croises contre zone ligne lignes but buts ' +
  'public lever leve leves leve tente tentent tente reste restent travail travailler suivre profil calme stage ' +
  'attaque attaques defense defenses entree entre entrer sortir perdu perdue cher chere'
).split(/\s+/).filter(Boolean))

// Groupes d'homophones et de quasi-homophones (forme normalisée).
const HOMOPHONES = [
  'sert sers serre serres serrent cerf serf ser',
  'axee axe axees axes agee age agees ages',
  'poing poings point points',
  'lancer lance lancee lances lancees lancez lancent',
  'et est es ai',
  'son sont',
  'ces ses cest sest sait sais',
  'ce se',
  'on ont',
  'mais mes met mets mai',
  'leur leurs',
  'tir tire tirs tires',
  'sort sors sortent',
  'cou coup coups cout couts',
  'temps tant tend tends tan',
  'balle bal',
  'vers vert verre ver verts',
  'fin faim',
  'peu peut peux',
  'saut seau sot sceau',
  'dans dent dents',
  'cour cours court courts',
  'pris prix',
  'fois foi foie',
  'paie paye pait',
  'pare pari part parts par',
  'la l le',
  'du dans',
  'aile elle ailes elles',
  'sur sure',
  'quand quant',
  'mur mure',
  'tente tentes tentent tante',
].map((g) => new Set(g.split(' ')))

const PETITS = new Set('l la le les d de du des un une en et a au aux'.split(' '))
const homophones = (a, b) => HOMOPHONES.some((g) => g.has(a) && g.has(b))
// Même mot à l'accord près (pluriel, féminin, participe) : « lancé » / « lancer », « âgé » / « âgée ».
const racine = (w) => w.replace(/(ees|ee|es|er|ez|ent|e|s|x)$/, '')
const memeRacine = (a, b) => a !== b && racine(a).length >= 3 && racine(a) === racine(b)
const aChiffres = (s) => /\d/.test(s)

// Contexte du classement, à construire une fois (contexte()).
// - motsVoxtral : mots de contexte actuels ; jargon : termes du hand (vocabulaire + termes du texte) ;
// - references : textes de référence (calibration et phrases d'essai), pour qu'une règle ne casse aucun d'eux.
export function contexte({ motsVoxtral = [], jargon = [], references = [] } = {}) {
  const tok = (s) => morceaux(s).map((m) => m.n)
  const termes = [...new Set(jargon)].map((t) => ({ t, n: tok(t) })).filter((x) => x.n.length && !(x.n.length === 1 && COURANTS.has(x.n[0])))
  const voxtral = new Set(motsVoxtral.map((m) => tok(m).join(' ')))
  const refs = references.map((r) => ' ' + tok(r).join(' ') + ' ')
  const motsRef = new Set(refs.flatMap((r) => r.trim().split(' ')))
  return { termes, voxtral, refs, motsRef, motsVoxtral: motsVoxtral.length }
}

// Une suite b est-elle contenue dans a (mots contigus) ?
function contient(a, b) {
  if (!b.length || b.length > a.length) return false
  for (let i = 0; i + b.length <= a.length; i++) if (b.every((w, k) => a[i + k] === w)) return true
  return false
}

// Classe une erreur { ref, hyp, refN, hypN }. Renvoie { classe: 'a'|'b'|'c', raison, regle?, mot?, prudence? }.
export function classer(err, ctx) {
  const R = err.refN ? err.refN.split(' ') : []
  const H = err.hypN ? err.hypN.split(' ') : []
  if (!R.length) return { classe: 'c', raison: 'mot ajouté par le moteur' }
  if (R.length === 1 && H.length === 1 && homophones(R[0], H[0])) return { classe: 'c', raison: 'homophone : une règle casserait d\'autres phrases' }
  if (R.length === 1 && H.length === 1 && memeRacine(R[0], H[0])) return { classe: 'c', raison: 'accord (pluriel, féminin, participe)' }
  if (H.length && R.join('') === H.join('')) return { classe: 'c', raison: 'découpage des mots seulement' }
  // Jargon touché par l'erreur : terme qui contient la référence, ou qu'elle contient.
  // (sans les petits mots de bord : « l'ailier » touche « ailier gauche »)
  let coeur = R
  while (coeur.length > 1 && PETITS.has(coeur[0])) coeur = coeur.slice(1)
  while (coeur.length > 1 && PETITS.has(coeur[coeur.length - 1])) coeur = coeur.slice(0, -1)
  const touches = ctx.termes.filter((x) => contient(x.n, coeur) || contient(coeur, x.n))
  const connu = touches.some((x) => ctx.voxtral.has(x.n.join(' ')))
  const dansTexte = (x) => ctx.refs.some((r) => r.includes(' ' + x.n.join(' ') + ' '))
  const manquant = touches.filter((x) => !ctx.voxtral.has(x.n.join(' '))).sort((p, q) => dansTexte(q) - dansTexte(p) || q.n.length - p.n.length)[0]
  if (manquant && !connu) return { classe: 'b', raison: 'terme du hand absent des mots de contexte', mot: manquant.t }
  if (!H.length) return { classe: 'c', raison: 'mot oublié par le moteur' }
  if (R.length > 4 || H.length > 4) return { classe: 'c', raison: 'passage mal reconnu, trop long pour une règle' }
  if (aChiffres(err.refN) || aChiffres(err.hypN)) return { classe: 'c', raison: 'écriture des nombres' }
  if (H.length === 1 && (COURANTS.has(H[0]) || ctx.motsRef.has(H[0]))) return { classe: 'c', raison: 'mot courant : une règle casserait d\'autres phrases' }
  if (H.every((w) => w.length < 3)) return { classe: 'c', raison: 'mots trop courts pour une règle' }
  const hypBord = ' ' + H.join(' ') + ' '
  if (ctx.refs.some((r) => r.includes(hypBord))) return { classe: 'c', raison: 'expression présente dans un texte juste : une règle le casserait' }
  const regle = { faux: forme(err.hyp, true), juste: forme(err.ref, false, ctx) }
  const res = { classe: 'a', raison: connu ? 'terme connu mal reconnu' : 'mot mal reconnu', regle }
  if (H.every((w) => COURANTS.has(w) || ctx.motsRef.has(w))) res.prudence = 'faite de mots courants : vérifier qu\'elle ne sert pas ailleurs'
  return res
}

// Texte d'une règle : minuscules pour « faux » ; pour « juste », minuscule en tête sauf nom propre (Pôle Espoirs, U15…).
function forme(s, bas, ctx) {
  if (bas) return s.toLowerCase()
  const propre = ctx?.termes.some((x) => /^\p{Lu}/u.test(x.t) && s.startsWith(x.t.split(' ')[0]))
  if (propre || /^\p{Lu}[\p{Lu}\d]/u.test(s)) return s
  return s.replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase())
}

// Toutes les erreurs de lectures [{ ref, texte }], comptées par paire (référence → entendu) et classées.
// Renvoie [{ ref, hyp, fois, classe, raison, regle?, mot?, prudence?, stable }], le plus fréquent d'abord.
export function analyser(lectures, ctx) {
  const map = new Map()
  for (const l of lectures) {
    for (const e of erreurs(aligner(l.ref, l.texte).ops)) {
      const k = e.refN + '→' + e.hypN
      const cur = map.get(k)
      if (cur) cur.fois++
      else map.set(k, { ...e, fois: 1 })
    }
  }
  // Combien de façons différentes d'entendre la même référence ?
  const variantes = new Map()
  for (const e of map.values()) variantes.set(e.refN, (variantes.get(e.refN) || 0) + 1)
  return [...map.values()].map((e) => {
    const c = classer(e, ctx)
    return { ref: e.ref, hyp: e.hyp, fois: e.fois, ...c, stable: e.fois >= 2, variantes: variantes.get(e.refN) }
  }).sort((p, q) => q.fois - p.fois || p.ref.localeCompare(q.ref, 'fr'))
}

// Texte et JSON à coller dans la conversation. choix : ensemble des clés retenues (cle(s)).
export const cle = (s) => s.classe + ':' + (s.mot || '') + ':' + s.ref + '→' + s.hyp
export function texteSuggestions(sugg, choix, entete = []) {
  const corr = sugg.filter((s) => s.classe === 'a' && choix.has(cle(s)))
  const mots = [...new Map(sugg.filter((s) => s.classe === 'b' && choix.has(cle(s))).map((s) => [s.mot, s])).values()]
  const amb = sugg.filter((s) => s.classe === 'c')
  const fois = (s) => s.fois + ' fois'
  const L = [...entete]
  L.push('', 'Corrections proposées (src/dictation/vocabulary.ts, corrections, puis la copie public/essai-dictee/vocabulaire.js) :')
  if (!corr.length) L.push('  (aucune)')
  for (const s of corr) L.push('  - « ' + s.regle.faux + ' » → « ' + s.regle.juste + ' » (' + fois(s) + (s.prudence ? ' ; ' + s.prudence : '') + ')')
  L.push('', 'Mots de contexte à ajouter (motsVoxtral, 100 au plus) :')
  if (!mots.length) L.push('  (aucun)')
  for (const s of mots) L.push('  - « ' + s.mot + ' » (« ' + s.ref + ' » entendu « ' + (s.hyp || '…') + ' », ' + fois(s) + ')')
  L.push('', 'Erreurs ambiguës, sans règle proposée (pour information) :')
  if (!amb.length) L.push('  (aucune)')
  for (const s of amb) L.push('  - « ' + s.ref + ' » entendu « ' + (s.hyp || '…') + ' » (' + fois(s) + ') : ' + s.raison)
  const json = {
    corrections: corr.map((s) => ({ faux: s.regle.faux, juste: s.regle.juste, fois: s.fois, ...(s.prudence ? { prudence: s.prudence } : {}) })),
    motsVoxtral: mots.map((s) => s.mot),
    ambigus: amb.map((s) => ({ ref: s.ref, entendu: s.hyp, fois: s.fois, raison: s.raison })),
  }
  L.push('', 'JSON :', JSON.stringify(json, null, 2))
  return L.join('\n')
}
