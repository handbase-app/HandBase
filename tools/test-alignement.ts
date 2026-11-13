// Test de l'alignement et de l'analyse des erreurs du texte de calibration (public/essai-dictee/alignement.js),
// avec des transcriptions fabriquées : substitutions, mots coupés, mots collés, homophones, règles prudentes.
//
//   npx jiti tools/test-alignement.ts
import assert from 'node:assert/strict'
// @ts-expect-error copie JavaScript sans types (public/essai-dictee/)
import { aligner, analyser, classer, cle, contexte, erreurs, morceaux, tauxErreur, texteSuggestions } from '../public/essai-dictee/alignement.js'
// @ts-expect-error copie JavaScript sans types
import { paragraphes, termes } from '../public/essai-dictee/calibration.js'
// @ts-expect-error copie JavaScript sans types
import { motsCles as motsClesJs, motsVoxtral as motsVoxtralJs } from '../public/essai-dictee/vocabulaire.js'
import { motsCles, motsVoxtral } from '../src/dictation/vocabulary'

type Err = { ref: string; hyp: string; refN: string; hypN: string }
type Sugg = { ref: string; hyp: string; fois: number; classe: string; raison: string; regle?: { faux: string; juste: string }; mot?: string; prudence?: string; stable: boolean }

// La copie JavaScript du vocabulaire est à jour (la page s'en sert pour classer).
assert.deepEqual(motsVoxtralJs, motsVoxtral)
assert.deepEqual(motsClesJs, motsCles)

// ---------- Texte de calibration ----------
const nbMots = (paragraphes as string[]).join(' ').split(/\s+/).length
assert.ok(paragraphes.length >= 6 && paragraphes.length <= 8, '6 à 8 paragraphes')
assert.ok(nbMots >= 250 && nbMots <= 310, 'environ 2 minutes de lecture : ' + nbMots + ' mots')
const tout = (paragraphes as string[]).join(' ')
for (const t of ['chabala', 'roucoulette', 'kung-fu', 'flyer', 'kempa', 'tir à la hanche', 'en suspension', 'sortie de bloc', 'écran', 'croisé',
  'défense 0-6', 'défense 3-2-1', 'défense 5+1', '7 contre 6', 'jet de 7 mètres', '9 mètres', 'jeu passif', 'exclusion de 2 minutes', 'carton jaune',
  'U15', 'U17', 'Pôle Espoirs', 'Interligues', '12 à 10', 'à la 23e minute', 'sert', 'serre', 'axée', 'âgée', 'poing', 'point', 'lancer', 'lancé']) {
  assert.ok(tout.toLowerCase().includes(t.toLowerCase()), 'texte de calibration : ' + t)
}

// ---------- Découpe et normalisation ----------
assert.deepEqual(morceaux("L'ailier demi-centre, 5+1 !").map((m: { t: string; n: string }) => [m.t, m.n]),
  [["L'", 'l'], ['ailier', 'ailier'], ['demi-', 'demi'], ['centre,', 'centre'], ['5', '5'], ['+', 'plus'], ['1 !', '1']]) // ponctuation isolée : affichée avec le mot d'avant
assert.equal(tauxErreur('Le score est de 12 à 10.', 'le score est de douze a dix'), 0) // nombres, accents, ponctuation
assert.equal(tauxErreur('à la 23e minute', 'À la 23ème minute'), 0)
assert.equal(tauxErreur('défense 5+1', 'défense cinq plus un'), 0)
assert.equal(tauxErreur('Le numéro 7', 'Le n°7'), 0)
assert.equal(tauxErreur('', 'abc'), null)

// ---------- Alignement ----------
{
  const a = aligner('le pivot sert le demi-centre', 'le pivot serre le demi centre')
  assert.equal(a.s, 1); assert.equal(a.d, 0); assert.equal(a.i, 0)
  assert.equal(a.wer, 1 / 6)
  assert.deepEqual(a.ops.map((o: { op: string }) => o.op), ['ok', 'ok', 'sub', 'ok', 'ok', 'ok'])
}
{
  const a = aligner('une belle roucoulette', 'une belle roue coulette') // mot coupé : 1 substitution + 1 insertion
  assert.equal(a.s + a.i + a.d, 2)
  assert.deepEqual(erreurs(a.ops).map((e: Err) => [e.ref, e.hyp]), [['roucoulette', 'roue coulette']])
}
{
  const a = aligner('un tir en suspension', 'un tiran suspension') // mots collés
  assert.deepEqual(erreurs(a.ops).map((e: Err) => [e.ref, e.hyp]), [['tir en', 'tiran']])
}
{
  // Erreur dans une partie d'un mot : étendue au mot entier
  const e = erreurs(aligner('le demi-centre accélère', 'le demi sentre accélère').ops)
  assert.deepEqual(e.map((x: Err) => [x.ref, x.hyp]), [['demi-centre', 'demi sentre']])
}
{
  // Erreurs séparées par un mot juste : deux erreurs ; mot oublié, mot ajouté
  const e = erreurs(aligner('le kempa reste à travailler', 'le campa reste vraiment travailler bien').ops)
  assert.deepEqual(e.map((x: Err) => [x.ref, x.hyp]), [['kempa', 'campa'], ['à', 'vraiment'], ['', 'bien']])
  const d = erreurs(aligner('il lève le poing', 'il lève le').ops)
  assert.deepEqual(d.map((x: Err) => [x.ref, x.hyp]), [['poing', '']])
}

// ---------- Classement ----------
const refs = [...paragraphes, 'Le demi-centre accélère la montée de balle et sert le pivot entre les deux défenseurs.']
const ctx = contexte({ motsVoxtral, jargon: [...motsCles, ...termes], references: refs })
const c = (ref: string, hyp: string) => {
  const e = erreurs(aligner(ref, hyp).ops)
  assert.equal(e.length, 1, ref + ' / ' + hyp)
  return classer(e[0], ctx)
}
// (a) correction : erreur stable sur un terme du hand, « faux » rare
{
  const r = c('une roucoulette', 'une roue coulette')
  assert.equal(r.classe, 'a'); assert.deepEqual(r.regle, { faux: 'roue coulette', juste: 'roucoulette' })
  assert.equal(r.prudence, undefined)
  const k = c('Le kempa reste', 'Le campa reste')
  assert.equal(k.classe, 'a'); assert.deepEqual(k.regle, { faux: 'campa', juste: 'kempa' })
  const p = c('pour le Pôle Espoirs', 'pour le Paule Espoir')
  assert.equal(p.classe, 'a'); assert.deepEqual(p.regle, { faux: 'paule espoir', juste: 'Pôle Espoirs' })
}
// (b) mot de contexte : terme du hand absent de motsVoxtral
{
  assert.ok(!motsVoxtral.includes('marge de progression'))
  const r = c('une belle marge de progression', 'une belle marche de progression')
  assert.equal(r.classe, 'b'); assert.equal(r.mot, 'marge de progression')
  const p = c('le ballon frappe le poteau', 'le ballon frappe le poto')
  assert.equal(p.classe, 'b'); assert.equal(p.mot, 'poteau')
  // même un mot oublié
  assert.equal(c('frappe le poteau.', 'frappe le.').classe, 'b')
}
// (c) ambigu : homophones, accords, mots courants, nombres, mots ajoutés ou oubliés
for (const [ref, hyp] of [
  ['et sert le pivot', 'et serre le pivot'],
  ['le pivot serre les dents', 'le pivot sert les dents'],
  ['très haute et axée sur', 'très haute et âgée sur'],
  ['arrière droite âgée de seize ans', 'arrière droite axée de seize ans'],
  ['il lève le poing pour', 'il lève le point pour'],
  ['chaque point compte', 'chaque poing compte'],
  ['un flyer bien lancé font', 'un flyer bien lancer font'],
  ['encore lancer plus fort', 'encore lancé plus fort'],
  ['à la 23e minute', 'à la vingt-troisième minute'],
  ['il doit encore lancer', 'il doit encore'], // mot courant oublié
  ['la défense étagée', 'la défense de étagée'], // mot ajouté
  ['puis une chabala', 'puis une cha bala'], // découpage seulement (déjà corrigé par le nettoyage)
  ['tente une roucoulette', 'tente une roue'], // « roue » : mot courant, jamais « faux » d'une règle
]) {
  const r = c(ref, hyp)
  assert.equal(r.classe, 'c', ref + ' / ' + hyp + ' : ' + JSON.stringify(r))
  assert.equal(r.regle, undefined)
}
// Jamais de règle dont « faux » est un mot courant ou une expression d'un texte juste
assert.equal(c('il marque en suspension', 'il marque en suspens').classe, 'a') // « suspens » rare : règle possible
assert.equal(c('la montée de balle', 'la monté de balle').classe, 'c') // accord
assert.equal(c('derrière un écran du pivot', 'derrière un écran du pied').classe, 'c') // mot courant
assert.equal(c('il lève le bras', 'il lève le gardien').classe, 'c') // mot d'un texte juste
// Expression faite de mots courants : proposée, mais avec une mise en garde
{
  const r = c('le kempa reste', 'le quand pas reste')
  assert.equal(r.classe, 'a'); assert.equal(r.regle.faux, 'quand pas'); assert.ok(r.prudence)
  // « lieu » seul pour « l'ailier » : mot courant, pas de règle
  assert.equal(c("l'ailier gauche numéro 3", 'lieu gauche numéro 3').classe, 'c')
}

// ---------- Analyse de plusieurs lectures et texte à copier ----------
const lectures = [
  { ref: paragraphes[2], texte: paragraphes[2].replace('roucoulette', 'roue coulette').replace('kempa', 'campa') },
  { ref: paragraphes[2], texte: paragraphes[2].replace('roucoulette', 'roue coulette').replace('lancé', 'lancer') },
  { ref: paragraphes[0], texte: paragraphes[0].replace('sert', 'serre') },
  { ref: paragraphes[7], texte: paragraphes[7].replace('marge', 'marche') },
]
const sugg: Sugg[] = analyser(lectures, ctx)
const roue = sugg.find((s) => s.ref === 'roucoulette')!
assert.equal(roue.fois, 2); assert.equal(roue.classe, 'a'); assert.equal(roue.stable, true)
const campa = sugg.find((s) => s.hyp === 'campa')!
assert.equal(campa.fois, 1); assert.equal(campa.stable, false)
assert.equal(sugg.find((s) => s.ref === 'sert')!.classe, 'c')
assert.equal(sugg.find((s) => s.ref === 'lancé')!.classe, 'c')
assert.equal(sugg.find((s) => s.ref === 'marge')!.classe, 'b')
assert.equal(sugg[0], roue) // le plus fréquent d'abord
const choix = new Set(sugg.filter((s) => s.classe !== 'c').map(cle))
choix.delete(cle(campa)) // décochée
const txt: string = texteSuggestions(sugg, choix, ['En-tête'])
assert.ok(txt.startsWith('En-tête\n'))
assert.ok(txt.includes('« roue coulette » → « roucoulette » (2 fois)'))
assert.ok(!txt.includes('« campa » →'))
assert.ok(txt.includes('« marge de progression » (« marge » entendu « marche », 1 fois)'))
assert.ok(txt.includes('« sert » entendu « serre » (1 fois) : homophone'))
const json = JSON.parse(txt.slice(txt.indexOf('JSON :') + 6))
assert.deepEqual(json.corrections, [{ faux: 'roue coulette', juste: 'roucoulette', fois: 2 }])
assert.deepEqual(json.motsVoxtral, ['marge de progression'])
assert.equal(json.ambigus.length, 2)
assert.ok(json.ambigus.every((a: { raison: string }) => a.raison))

// Lecture parfaite : aucune erreur
assert.deepEqual(analyser(paragraphes.map((p: string) => ({ ref: p, texte: p })), ctx), [])

console.log('Alignement : tout est bon.')
