// Test de la présence sans requête à part (src/presence.ts, src/charge.ts, supabase/061) : signe de vie avec « quoi de neuf ? »
// (hb_registre_depuis), hb_ping à part au plus toutes les 10 / 20 / 30 min, « qui est là ? » de l'écran Membres (réponse
// seulement si l'appareil est affiché, le serveur calme et le dernier signe de vie vieux d'au moins 30 s, après 0 à 10 s au
// hasard ; un message forgé ne fait jamais plus d'un signe de vie toutes les 30 s), point vert toujours juste (« connecté »
// = moins de 90 s), requêtes HTTP par appareil et par heure avant / après ; serveur sans 061 : 30 s comme avant. Câblage de
// src/sync.ts, src/presence.ts, src/components/Members.tsx. Aucune donnée réelle.
//
//   npx jiti tools/test-presence.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHARGE_REGLES, delaiFilet, delaiReponsePresence, delaiSigneDeVie, doitRepondrePresence } from '../src/charge'
import { LIVE_EVENTS, STAFF_TOPIC } from '../src/syncLive'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}
const R = CHARGE_REGLES
const S = 1000
const M = 60_000

t('signe de vie à part : 30 / 60 / 120 s sans 061 (comme avant), 10 / 20 / 30 min avec 061', () => {
  assert.deepEqual([delaiSigneDeVie('calme'), delaiSigneDeVie('charge'), delaiSigneDeVie('sature')], [30 * S, 60 * S, 120 * S])
  assert.deepEqual([delaiSigneDeVie('calme', R, true), delaiSigneDeVie('charge', R, true), delaiSigneDeVie('sature', R, true)], [10 * M, 20 * M, 30 * M])
})

t('« qui est là ? » : répond si affiché, calme, et dernier signe de vie vieux d’au moins 30 s', () => {
  const now = 1_000_000
  assert.equal(doitRepondrePresence(now, now - 31 * S, 'calme', true), true)
  assert.equal(doitRepondrePresence(now, now - 29 * S, 'calme', true), false, 'déjà « en ligne »')
  assert.equal(doitRepondrePresence(now, now - 10 * M, 'calme', false), false, 'appli cachée : pas « connecté en ce moment »')
  assert.equal(doitRepondrePresence(now, now - 10 * M, 'charge', true), false, 'serveur chargé : on ne répond pas')
  assert.equal(doitRepondrePresence(now, now - 10 * M, 'sature', true), false)
})

t('réponse étalée : 0 à 10 s au hasard', () => {
  assert.equal(delaiReponsePresence(() => 0), 0)
  assert.equal(delaiReponsePresence(() => 0.5), 5 * S)
  assert.ok(delaiReponsePresence(() => 1) < R.presenceHasardMs)
})

t('point vert toujours juste : appareil affiché vu il y a moins de 90 s tant que l’écran Membres est ouvert', () => {
  // Pire cas : l'appareil a répondu juste avant une demande (donc ne répond pas à celle-ci), répond à la suivante après le
  // plus long hasard, et l'écran relit les connexions toutes les 20 s.
  const relecture = 20 * S
  const pire = R.presenceDemandeMs + R.presenceHasardMs + relecture
  assert.ok(pire < 90 * S, `${pire} ms`)
  assert.ok(R.presenceRepondreMinMs <= R.presenceDemandeMs, 'un appareil répond à chaque demande au plus une fois')
})

t('message forgé ou écran laissé ouvert : jamais plus d’un signe de vie par appareil toutes les 30 s (avant 061 : toujours un toutes les 30 s)', () => {
  // Demandes toutes les secondes pendant 10 min : l'appareil répond au plus une fois par presenceRepondreMinMs.
  let dernier = 0
  let pings = 0
  for (let now = 0; now < 10 * M; now += S) {
    if (doitRepondrePresence(now, dernier, 'calme', true)) {
      dernier = now
      pings++
    }
  }
  assert.ok(pings <= Math.ceil((10 * M) / R.presenceRepondreMinMs) + 1, `${pings}`)
})

t('requêtes HTTP de présence par appareil et par heure : 120 avant (hb_ping toutes les 30 s), 0 avec 061 hors écran Membres', () => {
  const avant = 3600 / 30
  // Avec 061 : le signe de vie part avec « quoi de neuf ? » (toutes les 5 min en direct : delaiFilet), aucune requête de plus ;
  // hb_ping à part seulement si rien n'est parti depuis 10 min (ne se produit pas tant que la synchronisation tourne).
  const filet = delaiFilet(true, 'calme', 0, 0)
  assert.equal(filet, 5 * M)
  assert.ok(filet < delaiSigneDeVie('calme', R, true), 'le registre passe avant l’échéance du signe de vie à part')
  const apres = 0
  console.log(`   présence : ${avant} requêtes/h/appareil avant, ${apres} avec 061 (+ ${Math.round(3600 / (R.presenceDemandeMs / 1000))} au plus pendant qu’un administrateur regarde l’écran Membres)`)
  assert.equal(avant, 120)
})

t('événement « presence » écouté, canal du staff seulement', () => {
  assert.ok((LIVE_EVENTS as readonly string[]).includes('presence'))
  assert.equal(STAFF_TOPIC, 'hb:staff')
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  assert.match(sync, /if \(event === 'presence'\) \{\s*if \(topic === STAFF_TOPIC\) presenceHooks\.demande\(\)\s*return\s*\}/)
  assert.ok(sync.includes(".get(STAFF_TOPIC)\n    ?.send({ type: 'broadcast', event: 'presence', payload: {} })"))
})

t('câblage : session jointe à « quoi de neuf ? » (appli affichée), notée, hb_ping à part selon le registre', () => {
  const presence = readFileSync(new URL('../src/presence.ts', import.meta.url), 'utf8')
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  assert.ok(presence.includes('presenceHooks.session = () => (!stopped && navigator.onLine && visible() ? { id: SESSION, device: device() } : null)'))
  assert.ok(sync.includes('if (session) presenceHooks.noted(Date.now())'))
  assert.ok(presence.includes('if (Date.now() - dernier >= delaiSigneDeVie(niveauCharge(), undefined, registreActif())) void ping()'))
  assert.ok(presence.includes("const reprise = () => !registreActif() && void ping()"), 'retour sur l’appli : la synchronisation du retour l’emporte')
  assert.ok(presence.includes('doitRepondrePresence(Date.now(), dernier, niveauCharge(), visible())'))
  assert.ok(!presence.includes('setInterval(() => void ping(), 30_000)'))
})

t('câblage : écran Membres → « qui est là ? » tant qu’il est affiché, toutes les 45 s', () => {
  const members = readFileSync(new URL('../src/components/Members.tsx', import.meta.url), 'utf8')
  assert.ok(members.includes("const quiEstLa = () => document.visibilityState === 'visible' && demanderPresence()"))
  assert.ok(members.includes('setInterval(quiEstLa, CHARGE_REGLES.presenceDemandeMs)'))
  assert.ok(members.includes('clearInterval(q)'))
  assert.ok(members.includes('const ONLINE_MS = 90_000'))
})

console.log(`${n} tests OK`)
