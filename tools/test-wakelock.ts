// Test de l'écran gardé allumé pendant un gros chargement (src/wakeLock.ts) : demandé au début, rendu à la fin, redemandé
// au retour au premier plan si le chargement continue, sans erreur quand le navigateur n'a pas l'API ou refuse.
//
//   npx jiti tools/test-wakelock.ts
import assert from 'node:assert/strict'
import { createWakeKeeper, type WakeEnv } from '../src/wakeLock'

const tick = () => new Promise((r) => setTimeout(r, 0))

function fakeEnv(opts: { refuse?: boolean } = {}) {
  let visible = true
  let onVisible: () => void = () => {}
  const stats = { requests: 0, releases: 0 }
  const sentinels: { released: boolean; fire: () => void }[] = []
  const env: WakeEnv = {
    visible: () => visible,
    onVisible: (fn) => (onVisible = fn),
    wakeLock: {
      async request() {
        stats.requests++
        if (opts.refuse) throw new Error('NotAllowedError')
        const listeners: (() => void)[] = []
        const s = {
          released: false,
          async release() {
            if (s.released) return
            s.released = true
            stats.releases++
            listeners.forEach((l) => l())
          },
          addEventListener: (_: 'release', fn: () => void) => listeners.push(fn),
          // Le navigateur retire le verrou quand la page passe en arrière-plan.
          fire: () => {
            s.released = true
            listeners.forEach((l) => l())
          },
        }
        sentinels.push(s)
        return s
      },
    },
  }
  return {
    env,
    stats,
    sentinels,
    hide() {
      visible = false
      sentinels.at(-1)?.fire()
    },
    show() {
      visible = true
      onVisible()
    },
  }
}

// Demandé au début, une seule fois, rendu à la fin.
{
  const f = fakeEnv()
  const k = createWakeKeeper(f.env)
  k.want(true)
  k.want(true)
  await tick()
  assert.equal(f.stats.requests, 1)
  assert.equal(k.held(), true)
  k.want(false)
  await tick()
  assert.equal(f.stats.releases, 1)
  assert.equal(k.held(), false)
}

// Arrière-plan pendant le chargement : retiré par le navigateur, redemandé au retour.
{
  const f = fakeEnv()
  const k = createWakeKeeper(f.env)
  k.want(true)
  await tick()
  f.hide()
  assert.equal(k.held(), false)
  f.show()
  await tick()
  assert.equal(f.stats.requests, 2)
  assert.equal(k.held(), true)
  // Fini : plus rien demandé au retour suivant.
  k.want(false)
  await tick()
  f.hide()
  f.show()
  await tick()
  assert.equal(f.stats.requests, 2)
}

// Chargement fini pendant la demande : rendu dès qu'il arrive.
{
  const f = fakeEnv()
  const k = createWakeKeeper(f.env)
  k.want(true)
  k.want(false)
  await tick()
  await tick()
  assert.equal(k.held(), false)
  assert.equal(f.stats.releases, 1)
}

// Refus ou navigateur sans l'API : aucune erreur.
{
  const f = fakeEnv({ refuse: true })
  const k = createWakeKeeper(f.env)
  k.want(true)
  await tick()
  assert.equal(k.held(), false)
  const k2 = createWakeKeeper({ visible: () => true, onVisible: () => {} })
  k2.want(true)
  k2.want(false)
  assert.equal(k2.held(), false)
}

// Page cachée au début : demandé seulement au retour.
{
  const f = fakeEnv()
  f.hide()
  const k = createWakeKeeper(f.env)
  k.want(true)
  await tick()
  assert.equal(f.stats.requests, 0)
  f.show()
  await tick()
  assert.equal(k.held(), true)
}

console.log('wakeLock : OK')
