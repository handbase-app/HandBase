// Test du push de la veille côté téléphone (src/veilleCore.ts, parties pures du service worker src/veilleSw.ts) : lecture
// du message (champs inattendus ignorés), textes EXACTS de la notification selon l'issue (prêt, occupé, session, réseau,
// erreur), page ouverte, attente au hasard (étalement), réponses du serveur (429/503 : abandon sans insister), joueurs à
// préparer, rangement avec la règle de l'appli (jamais par-dessus une version plus récente ni une ligne en attente
// d'envoi), synchronisation périodique, branchements (veille-sw.js chargé avant push-sw.js). Données fictives seulement.
//
//   npx jiti tools/test-veille-sw.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  attenteVeille,
  evenementsDuCompte,
  heureFr,
  inList,
  joueursDes,
  joueursEnTrop,
  lignesARanger,
  paquets,
  parseVeille,
  statutLecture,
  tagVeille,
  texteVeille,
  titreVeille,
  urlVeille,
  VEILLE_TABLES,
} from '../src/veilleCore'
import { veillePayload } from '../supabase/functions/veille/veille'
import { PRIORITE_MAX } from '../src/priorite'
import { PULL_ORDER } from '../src/syncLive'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const un = parseVeille({ type: 'veille', v: 1, jour: '2026-11-13', ev: [{ id: 'e1', nom: 'Détection U13', h: '09:30' }] })!
const trois = parseVeille({
  type: 'veille',
  v: 1,
  jour: '2026-11-13',
  ev: [
    { id: 'e1', nom: 'Détection U13', h: '09:30' },
    { id: 'e2', nom: 'Stage gardiens', h: '14:00' },
    { id: 'e3', nom: 'Tournoi' },
  ],
  plus: 2,
})!

t('message : lu tel que la fonction l’envoie ; autre message ou illisible : ignoré ; champs inattendus jetés', () => {
  const p = veillePayload('2026-11-13', [{ id: 'e1', nom: 'Détection U13', h: '09:30' }], { calme: true })
  assert.deepEqual(parseVeille(p), { type: 'veille', jour: '2026-11-13', ev: [{ id: 'e1', nom: 'Détection U13', h: '09:30' }], plus: 0, calme: true })
  assert.equal(parseVeille({ title: 'Avis à valider' }), null)
  assert.equal(parseVeille({ type: 'veille', jour: 'demain', ev: [{ id: 'e1' }] }), null)
  assert.equal(parseVeille({ type: 'veille', jour: '2026-11-13', ev: [] }), null)
  assert.equal(parseVeille(null), null)
  const m = parseVeille({ type: 'veille', jour: '2026-11-13', ev: [{ id: 'e1', nom: '', h: '9h', joueurs: ['x'] }, { id: 'e1' }, { id: 3 }] })!
  assert.deepEqual(m.ev, [{ id: 'e1', nom: 'Événement' }])
})

t('heure à la française', () => {
  assert.equal(heureFr('09:30'), '9 h 30')
  assert.equal(heureFr('14:00'), '14 h')
  assert.equal(heureFr('00:05'), '0 h 05')
  assert.equal(heureFr(undefined), '')
  assert.equal(heureFr('9h'), '')
})

t('notification : titre et textes exacts selon l’issue', () => {
  assert.equal(titreVeille(un), 'Demain : Détection U13 à 9 h 30')
  assert.equal(titreVeille(trois), 'Demain : 5 événements')
  assert.equal(titreVeille(parseVeille({ type: 'veille', jour: '2026-11-13', ev: [{ id: 'e', nom: 'Tournoi' }] })!), 'Demain : Tournoi')
  assert.equal(texteVeille(un, { kind: 'en-cours' }), 'Préparation hors ligne de tes joueurs…')
  assert.equal(texteVeille(un, { kind: 'pret', joueurs: 24, evenements: 1, manquants: 0 }), 'Tes 24 joueurs sont prêts hors ligne.')
  assert.equal(texteVeille(un, { kind: 'pret', joueurs: 1, evenements: 1, manquants: 0 }), 'Ton joueur est prêt hors ligne.')
  assert.equal(texteVeille(un, { kind: 'pret', joueurs: 0, evenements: 1, manquants: 0 }), 'Prêt hors ligne (aucun joueur dans la liste pour l’instant).')
  assert.equal(texteVeille(un, { kind: 'pret', joueurs: 1200, evenements: 1, manquants: 40 }), `Tes ${(1200).toLocaleString('fr-FR')} joueurs sont prêts hors ligne. Le reste arrivera à l’ouverture de l’appli.`)
  assert.equal(texteVeille(un, { kind: 'pret', joueurs: 0, evenements: 0, manquants: 0 }), 'Ouvre l’appli pour retrouver cet événement.')
  assert.equal(texteVeille(un, { kind: 'occupe' }), 'Serveur très demandé : tes joueurs se chargeront à l’ouverture de l’appli.')
  assert.equal(texteVeille(un, { kind: 'session' }), 'Ouvre l’appli pour préparer tes joueurs hors ligne (connexion à renouveler).')
  assert.equal(texteVeille(un, { kind: 'reseau' }), 'Pas de réseau : ouvre l’appli une fois connecté pour préparer tes joueurs.')
  assert.equal(texteVeille(un, { kind: 'erreur' }), 'Préparation impossible pour l’instant : ouvre l’appli pour charger tes joueurs.')
  assert.equal(
    texteVeille(trois, { kind: 'pret', joueurs: 30, evenements: 3, manquants: 0 }),
    'Détection U13 (9 h 30), Stage gardiens (14 h), Tournoi et 2 autres. Tes 30 joueurs sont prêts hors ligne.',
  )
  // Jamais de mot négatif sur des jeunes (règle « positif seulement ») : les textes parlent du téléphone, pas des joueurs.
  for (const k of ['en-cours', 'occupe', 'session', 'reseau', 'erreur'] as const) assert.ok(!/retenu|refus|échec/i.test(texteVeille(un, { kind: k })))
})

t('page ouverte et étiquette : l’événement seul, sinon la liste ; la deuxième notification remplace la première', () => {
  assert.equal(urlVeille(un), '/evenements/e1')
  assert.equal(urlVeille(trois), '/evenements')
  assert.equal(urlVeille(parseVeille({ type: 'veille', jour: '2026-11-13', ev: [{ id: 'a/b', nom: 'x' }] })!), '/evenements/a%2Fb')
  assert.equal(tagVeille(un), 'veille:2026-11-13')
  assert.equal(tagVeille(un), tagVeille(trois))
})

t('étalement : 0 à 20 s au hasard (0 à 5 s sur iPhone)', () => {
  assert.equal(attenteVeille(() => 0), 0)
  assert.equal(attenteVeille(() => 1), 20_000)
  assert.equal(attenteVeille(() => 0.5), 10_000)
  assert.equal(attenteVeille(() => 7), 20_000)
  assert.equal(attenteVeille(() => 1, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1'), 5000)
  assert.equal(attenteVeille(() => 1, 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'), 20_000)
})

t('réponses du serveur : occupé (429, 503) → abandon sans insister ; 401/403 → session ; autres → erreur', () => {
  assert.equal(statutLecture(200), 'ok')
  assert.equal(statutLecture(206), 'ok')
  assert.equal(statutLecture(429), 'occupe')
  assert.equal(statutLecture(503), 'occupe')
  assert.equal(statutLecture(401), 'session')
  assert.equal(statutLecture(403), 'session')
  assert.equal(statutLecture(500), 'erreur')
  assert.equal(statutLecture(404), 'erreur')
})

t('joueurs à préparer : ceux des événements reçus, dans l’ordre, sans doublon, au plus PRIORITE_MAX ; le reste compté', () => {
  const evs = [
    { data: { playerIds: ['j1', 'j2', 'j1'] } },
    { data: { playerIds: ['j3', 'j2', 7, ''] } },
    { data: { playerIds: ['j9'], deleted: true } },
    { data: {} },
  ]
  assert.deepEqual(joueursDes(evs), ['j1', 'j2', 'j3'])
  assert.deepEqual(joueursDes(evs, 2), ['j1', 'j2'])
  assert.equal(joueursEnTrop(evs, 2), 1)
  const big = [{ data: { playerIds: Array.from({ length: PRIORITE_MAX + 25 }, (_, i) => `p${i}`) } }]
  assert.equal(joueursDes(big).length, PRIORITE_MAX)
  assert.equal(joueursEnTrop(big), 25)
})

t('adresse PostgREST : identifiants entre guillemets, sans guillemet ni caractère de contrôle ; paquets de 100', () => {
  assert.equal(inList(['a', 'b-1']), '("a","b-1")')
  assert.equal(inList(['x"),evil', 'a\\b\nc']), '("x),evil","abc")')
  assert.deepEqual(
    paquets(Array.from({ length: 250 }, (_, i) => i), 100).map((p) => p.length),
    [100, 100, 50],
  )
})

t('rangement : règle de l’appli ; jamais par-dessus une version plus récente, ni une ligne en attente d’envoi, ni une ligne illisible', () => {
  const rows = [
    { id: 'a', data: { id: 'a', updatedAt: 10, v: 'serveur' } }, // absente : rangée
    { id: 'b', data: { id: 'b', updatedAt: 5, v: 'serveur' } }, // plus ancienne que l'appareil : non
    { id: 'c', data: { id: 'c', updatedAt: 7, v: 'même' } }, // identique : non réécrite
    { id: 'd', data: { id: 'd', updatedAt: 20, v: 'serveur' } }, // en attente d'envoi : jamais
    { id: 'e', data: { id: 'e', updatedAt: 1, purged: true } }, // effacée par le serveur : toujours
    { id: 'f', data: { id: 'autre', updatedAt: 99 } }, // identifiant différent : illisible
    { id: 'g', data: { updatedAt: 3 } }, // sans data.id : rangée (identifiant de la ligne)
  ]
  const locals = [undefined, { updatedAt: 9 }, { id: 'c', updatedAt: 7, v: 'même' }, { updatedAt: 1 }, { updatedAt: 50 }, undefined, undefined]
  assert.deepEqual(
    lignesARanger(rows, locals, new Set(['d'])).map((r) => r.id),
    ['a', 'e', 'g'],
  )
})

t('tables lues : configuration et grille de notation avant les joueurs, dans l’ordre de la synchronisation', () => {
  const pos = (x: string) => PULL_ORDER.indexOf(x as never)
  for (let i = 1; i < VEILLE_TABLES.length; i++) assert.ok(pos(VEILLE_TABLES[i - 1]) < pos(VEILLE_TABLES[i]), VEILLE_TABLES[i])
})

t('synchronisation périodique (Android) : événements du compte (créateur ou participant) d’aujourd’hui à après-demain', () => {
  const U = '00000000-0000-0000-0000-0000000000a1'
  const evs = [
    { id: 'e1', data: { date: '2026-11-13', createdBy: U } },
    { id: 'e2', data: { date: '2026-11-15', editors: ['x', U] } },
    { id: 'e3', data: { date: '2026-11-16', createdBy: U } }, // trop loin
    { id: 'e4', data: { date: '2026-11-12', createdBy: U } }, // passé
    { id: 'e5', data: { date: '2026-11-14', createdBy: 'autre' } }, // vu par le périmètre seulement
    { id: 'e6', data: { date: '2026-11-14', createdBy: U, archived: true } },
    { id: 'e7', data: { date: '2026-11-14', createdBy: U, deleted: true } },
  ]
  assert.deepEqual(evenementsDuCompte(evs, U, '2026-11-13', '2026-11-15'), ['e1', 'e2'])
})

t('branchements : veille-sw.js construit à part et chargé avant push-sw.js, qui lui confie les messages « veille »', () => {
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
  assert.match(vite, /importScripts: \['veille-sw\.js', 'push-sw\.js'\]/)
  assert.match(vite, /formats: \['iife'\]/)
  const push = readFileSync(new URL('../public/push-sw.js', import.meta.url), 'utf8')
  assert.match(push, /d\.type === 'veille'/)
  assert.match(push, /self\.HBVeille && self\.HBVeille\.push\(d\)/)
  const swSrc = readFileSync(new URL('../src/veilleSw.ts', import.meta.url), 'utf8')
  // Notification visible AVANT toute attente ou lecture ; résultat dans la même étiquette.
  assert.ok(swSrc.indexOf("await notify(m, { kind: 'en-cours' }, true)") < swSrc.indexOf('await sleep(attenteVeille'))
  assert.match(swSrc, /req\.onupgradeneeded = \(\) => req\.transaction\?\.abort\(\)/) // base locale jamais créée
})

console.log(`\n${n} essais réussis`)
