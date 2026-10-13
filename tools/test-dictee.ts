// Test de la dictée (src/dictation/) : nettoyage, corrections du vocabulaire du hand, insertion dans un commentaire,
// appels à la fonction « transcrire » avec un faux fetch, et accord avec la copie JavaScript de la page d'essai.
//
//   npx jiti tools/test-dictee.ts
import assert from 'node:assert/strict'
import { clean, cleanDetail } from '../src/dictation/clean'
import { insertDictation } from '../src/dictation/insert'
import { DictationError, ERROR_TEXT, fileNameFor, MAX_BYTES, pickMimeType, requestAccess, transcribe, type Endpoint } from '../src/dictation/transcribe'
import { motsVoxtral } from '../src/dictation/vocabulary'
// @ts-expect-error copie JavaScript sans types (public/essai-dictee/)
import { nettoyer } from '../public/essai-dictee/nettoyage.js'

// ---------- Nettoyage et corrections (cas observés pendant l'essai) ----------
const CASES: [string, string][] = [
  ['euh il a fait une roue coulette en fin de match', 'Il a fait une roucoulette en fin de match.'],
  ['roux coulette réussie', 'Roucoulette réussie.'],
  ['très bon en contraint, euh, il fixe bien', 'Très bon en 1 contre 1, il fixe bien.'],
  ['Très bon en 1_contre_1 et en repli_défensif', 'Très bon en 1 contre 1 et en repli défensif.'],
  ['un beau tir en kung fu sur l’aile', 'Un beau tir en kung-fu sur l’aile.'],
  ['kung fou puis chabalah', 'Kung-fu puis chabala.'],
  ['le gardé a fait trois arrêts. Il a été gardé à vue', 'Le gardien a fait trois arrêts. Il a été gardé à vue.'],
  ['Gardé haut, bon placement', 'Gardé haut, bon placement.'], // sans déterminant : pas de correction
  ['euh euh bah le le pivot recule bien, du coup', 'Le pivot recule bien.'],
  ['En fait, la demi centre lit bien le jeu, tu vois', 'La demi-centre lit bien le jeu.'],
  ['une contre une, deux contre un, 2 contre 1, 1 contre 1', '1 contre 1, 2 contre 1, 2 contre 1, 1 contre 1.'],
  ['défense trois deux un et défense cinq plus un', 'Défense 3-2-1 et défense 5+1.'],
  ['il joue au paul espoir en u 15, neuf mètres', 'Il joue au Pôle Espoirs en U15, 9 mètres.'],
  ['Ben est un bon gaucher hein', 'Ben est un bon gaucher.'], // « Ben » prénom gardé
  ['très très rapide sur le repli', 'Très rapide sur le repli.'],
  ['nous nous replaçons vite', 'Nous nous replaçons vite.'],
  ['tir à 1,5 m du but... euh', 'Tir à 1,5 m du but…'],
  ['contre attaque rapide', 'Contre-attaque rapide.'],
  ['  ', ''],
]
for (const [input, want] of CASES) {
  assert.equal(clean(input), want, input)
  // La copie JavaScript de la page d'essai donne le même résultat.
  assert.equal(nettoyer(input), want, `copie JS : ${input}`)
}
assert.equal(clean(undefined), '')
assert.deepEqual(cleanDetail('une roue coulette').corrections, [{ de: 'roue coulette', vers: 'roucoulette' }])
assert.deepEqual(cleanDetail('Il fixe bien.').corrections, [])
// Majuscule gardée en début de phrase après correction.
assert.equal(clean('Kung fu réussi'), 'Kung-fu réussi.')

// ---------- Mots de contexte ----------
assert.ok(motsVoxtral.length <= 100, 'context_bias : 100 mots au plus')
assert.ok(motsVoxtral.every((m) => m.length <= 40 && /^[\p{L}\p{N} '’+\-_]+$/u.test(m)), 'mots acceptés par la fonction')

// ---------- Insertion dans le commentaire ----------
assert.deepEqual(insertDictation('', 'Bon pivot.'), { value: 'Bon pivot.', caret: 10, cut: false })
assert.equal(insertDictation('Rapide.', 'Bon pivot.').value, 'Rapide. Bon pivot.') // à la fin, avec une espace
assert.equal(insertDictation('Rapide. ', 'Bon pivot.').value, 'Rapide. Bon pivot.')
assert.equal(insertDictation('Rapide.\n', 'Bon pivot.').value, 'Rapide.\nBon pivot.')
// au curseur, espaces de part et d'autre
const mid = insertDictation('Rapide.Solide.', 'Bon pivot.', { start: 7, end: 7 })
assert.deepEqual(mid, { value: 'Rapide. Bon pivot. Solide.', caret: 18, cut: false })
// sélection remplacée
assert.equal(insertDictation('Rapide. XXX', 'Bon pivot.', { start: 8, end: 11 }).value, 'Rapide. Bon pivot.')
// pas d'espace avant la ponctuation qui suit
assert.equal(insertDictation('Rapide,.', 'bon pivot', { start: 7, end: 7 }).value, 'Rapide, bon pivot.')
// longueur maximale : texte dicté coupé
const cut = insertDictation('1234567890', 'abcdefghij', null, 15)
assert.deepEqual(cut, { value: '1234567890 abcd', caret: 15, cut: true })
assert.equal(insertDictation('1234567890', 'abc', null, 10).value, '1234567890') // plein : rien
assert.equal(insertDictation('abc', '   ').value, 'abc')

// ---------- Format d'enregistrement ----------
assert.equal(pickMimeType((t) => t.startsWith('audio/webm')), 'audio/webm;codecs=opus') // Chrome, Firefox
assert.equal(pickMimeType((t) => t === 'audio/mp4'), 'audio/mp4') // Safari
assert.equal(pickMimeType(undefined), '')
assert.equal(pickMimeType(() => false), '')
assert.equal(fileNameFor('audio/webm;codecs=opus'), 'son.webm')
assert.equal(fileNameFor('audio/mp4'), 'son.m4a')
assert.equal(fileNameFor('audio/ogg;codecs=opus'), 'son.ogg')
assert.equal(fileNameFor(''), 'son.webm')

// ---------- Fonction « transcrire » avec un faux fetch ----------
type Call = { url: string; init?: RequestInit }
function fake(respond: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const f = (async (url: string, init?: RequestInit) => {
    const c = { url, init }
    calls.push(c)
    return respond(c)
  }) as unknown as typeof fetch
  const ep: Endpoint = { url: 'https://exemple.supabase.co/functions/v1/transcrire', headers: { Authorization: 'Bearer jeton', apikey: 'cle' }, fetch: f }
  return { ep, calls }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const sound = new Blob([new Uint8Array(2000)], { type: 'audio/webm;codecs=opus' })
const fails = async (p: Promise<unknown>, code: string, message?: string) => {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof DictationError)
    assert.equal(e.code, code)
    if (message) assert.equal(e.message, message)
    return true
  })
}

async function main() {
  // Accès (GET)
  {
    const { ep, calls } = fake(() => json({ admin: true, pret: true, restant_mois: 1990, restant_jour: 199 }))
    assert.deepEqual(await requestAccess(ep), { status: 'ok', restantMois: 1990, restantJour: 199 })
    assert.equal(calls[0].init?.method, undefined)
    assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer jeton')
  }
  assert.equal((await requestAccess(fake(() => json({ admin: true, pret: false })).ep)).status, 'sans_cle')
  assert.equal((await requestAccess(fake(() => new Response('Not found', { status: 404 })).ep)).status, 'absent') // prod : pas de fonction
  assert.equal((await requestAccess(fake(() => json({ error: 'pas_admin' }, 403)).ep)).status, 'pas_admin')
  assert.equal((await requestAccess(fake(() => json({ error: 'non_connecte' }, 401)).ep)).status, 'non_connecte')
  assert.equal((await requestAccess(fake(() => Promise.reject(new TypeError('Failed to fetch'))).ep)).status, 'erreur')

  // Envoi (POST) : format de la requête, texte nettoyé
  {
    const { ep, calls } = fake(() => json({ text: 'euh très bon en 1_contre_1, roue coulette', ms: 900, restant_mois: 1989, restant_jour: 198 }))
    const r = await transcribe(ep, sound, 4.23)
    assert.equal(r.text, 'Très bon en 1 contre 1, roucoulette.')
    assert.equal(r.raw, 'euh très bon en 1_contre_1, roue coulette')
    assert.equal(r.restantMois, 1989)
    const init = calls[0].init!
    assert.equal(init.method, 'POST')
    const form = init.body as FormData
    const file = form.get('file') as File
    assert.equal(file.name, 'son.webm')
    assert.equal(file.size, 2000)
    assert.equal(form.get('duree'), '4.3')
    assert.deepEqual(form.getAll('context_bias'), motsVoxtral)
  }
  // Durée bornée à 60 s (arrêt automatique à 60 s, quelques millisecondes de plus)
  {
    const { ep, calls } = fake(() => json({ text: 'ok' }))
    await transcribe(ep, sound, 60.2)
    assert.equal((calls[0].init!.body as FormData).get('duree'), '60')
  }
  await fails(transcribe(fake(() => json({ text: 'x' })).ep, sound, 75), 'trop_long')
  await fails(transcribe(fake(() => json({ text: 'x' })).ep, new Blob([new Uint8Array(MAX_BYTES + 1)]), 10), 'trop_gros')
  // Erreurs de la fonction : messages clairs
  await fails(transcribe(fake(() => json({ error: 'quota_atteint', restant_mois: 0 }, 429)).ep, sound, 3), 'quota_atteint', 'Quota du mois atteint : tapez au clavier.')
  await fails(transcribe(fake(() => json({ error: 'quota_jour_atteint' }, 429)).ep, sound, 3), 'quota_jour_atteint')
  await fails(transcribe(fake(() => json({ error: 'pas_admin' }, 403)).ep, sound, 3), 'pas_admin', ERROR_TEXT.pas_admin)
  await fails(transcribe(fake(() => json({ error: 'cle_absente' }, 503)).ep, sound, 3), 'cle_absente')
  await fails(transcribe(fake(() => json({ error: 'mistral_limite', status: 429 }, 502)).ep, sound, 3), 'mistral_limite')
  await fails(transcribe(fake(() => new Response('', { status: 500 })).ep, sound, 3), 'mistral_erreur')
  await fails(transcribe(fake(() => new Response('', { status: 404 })).ep, sound, 3), 'absent')
  await fails(transcribe(fake(() => Promise.reject(new TypeError('Failed to fetch'))).ep, sound, 3), 'reseau', ERROR_TEXT.reseau)
  await fails(transcribe(fake(() => json({ text: ' euh… ' })).ep, sound, 3), 'vide') // rien d'utile entendu
  // Annulation (écran quitté pendant l'envoi)
  {
    const ctrl = new AbortController()
    const { ep } = fake(({ init }) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('annulé', 'AbortError')))))
    const p = transcribe(ep, sound, 3, ctrl.signal)
    ctrl.abort()
    await fails(p, 'annule')
  }
  console.log('Dictée : tout est bon.')
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
