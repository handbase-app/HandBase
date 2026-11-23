// Test du filet de sécurité des mises à jour (src/pwaRepair.ts, utilisé par src/pwa.ts) : lecture de version.json,
// « le serveur a plus récent », décision de réparer (pas si une version attend, pas deux fois de suite vers la même
// version sauf appui de la personne), caches effacés (workbox-precache* seulement), fichiers de démarrage lus dans
// index.html.
//
//   npx jiti tools/test-pwa-reparation.ts
import assert from 'node:assert/strict'
import { entryAssets, parseAttempt, precacheCaches, REPAIR_COOLDOWN_MS, repairDecision, serverIsNewer, versionOf } from '../src/pwaRepair'

const OLD = '2026-11-23T21:18:00.000Z'
const NEW = '2026-11-23T22:05:00.000Z'

// ---------- 1. version.json ----------
{
  assert.equal(versionOf({ build: NEW }), NEW)
  assert.equal(versionOf({ build: 'pas une date' }), null)
  assert.equal(versionOf({}), null)
  assert.equal(versionOf(null), null)
  assert.equal(versionOf('2026'), null, 'pas un objet')
  assert.equal(versionOf({ build: 12 }), null)
}

// ---------- 2. Plus récent ----------
{
  assert.equal(serverIsNewer(NEW, OLD), true)
  assert.equal(serverIsNewer(OLD, NEW), false, 'serveur plus ancien (retour arrière) : rien')
  assert.equal(serverIsNewer(OLD, OLD), false, 'même version')
  assert.equal(serverIsNewer(null, OLD), false, 'illisible')
  assert.equal(serverIsNewer(NEW, ''), false, 'version de développement')
  assert.equal(serverIsNewer('n’importe quoi', OLD), false)
}

// ---------- 3. Décision ----------
{
  const base = { server: NEW, mine: OLD, waiting: false, last: null, now: 1_000_000_000 }
  assert.equal(repairDecision(base), 'repair', 'serveur plus récent, rien en attente')
  assert.equal(repairDecision({ ...base, waiting: true }), 'none', 'une version attend : chemin normal (bandeau)')
  assert.equal(repairDecision({ ...base, server: OLD }), 'none', 'à jour')
  assert.equal(repairDecision({ ...base, server: null }), 'none', 'hors ligne / version.json absent')
  const just = { target: NEW, at: base.now - 60_000 }
  assert.equal(repairDecision({ ...base, last: just }), 'cooldown', 'réparation vers la même version il y a 1 min : pas de boucle')
  assert.equal(repairDecision({ ...base, last: just, manual: true }), 'repair', 'appui sur « Vérifier » : on répare quand même')
  assert.equal(repairDecision({ ...base, last: { target: NEW, at: base.now - REPAIR_COOLDOWN_MS } }), 'repair', 'délai passé')
  assert.equal(repairDecision({ ...base, last: { target: OLD, at: base.now - 1000 } }), 'repair', 'autre version visée : on répare')
  assert.equal(repairDecision({ ...base, last: { target: NEW, at: base.now + 60_000 } }), 'repair', 'horloge reculée : pas bloqué')
}

// ---------- 4. Dernière réparation gardée ----------
{
  assert.deepEqual(parseAttempt(JSON.stringify({ target: NEW, at: 5 })), { target: NEW, at: 5 })
  assert.equal(parseAttempt(null), null)
  assert.equal(parseAttempt('{abîmé'), null)
  assert.equal(parseAttempt('{"target":1,"at":2}'), null)
  assert.equal(parseAttempt('null'), null)
}

// ---------- 5. Caches effacés ----------
{
  const keys = ['workbox-precache-v2-https://x.ts.net/', 'google-fonts', 'pdfjs', 'sqlite-wasm', 'hb-badge', 'workbox-precache-v2-https://x.ts.net/-temp']
  assert.deepEqual(precacheCaches(keys), ['workbox-precache-v2-https://x.ts.net/', 'workbox-precache-v2-https://x.ts.net/-temp'])
  assert.deepEqual(precacheCaches(['google-fonts', 'hb-badge']), [], 'jamais les autres caches')
}

// ---------- 6. Fichiers de démarrage d'index.html ----------
{
  const html = `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono&display=swap" rel="stylesheet" />
<script type="module" crossorigin src="/assets/index-D0QAjUJY.js"></script>
<link rel="modulepreload" crossorigin href="/assets/ui-BMjOh24r.js">
<link rel="modulepreload" crossorigin href="/assets/ui-BMjOh24r.js">
<link rel="stylesheet" crossorigin href="/assets/index-D2CyNXti.css">
<link rel="manifest" href="/manifest.webmanifest">
<script>window.x = 1</script>`
  assert.deepEqual(entryAssets(html), ['/assets/index-D0QAjUJY.js', '/assets/ui-BMjOh24r.js', '/assets/index-D2CyNXti.css'])
  // Appli servie sous un sous-dossier, adresses relatives.
  assert.deepEqual(entryAssets('<script type="module" src="./assets/index-A.js"></script><link rel=stylesheet href="assets/i.css">', '/HandBase/'), [
    '/HandBase/assets/index-A.js',
    '/HandBase/assets/i.css',
  ])
  assert.deepEqual(entryAssets('<html>rien</html>'), [], 'page sans fichier de démarrage (repli du serveur) : rien')
}

console.log('test-pwa-reparation : OK')
