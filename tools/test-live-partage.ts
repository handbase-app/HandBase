// Test des lectures partagées gardées en mémoire (src/live.ts sharedQuery), sans base : un abonné qui arrive pendant la
// première lecture n'en relance pas une seconde (au démarrage, les 40 000 fiches étaient lues deux fois, mesuré par
// tools/bench-page-bilan.mjs) ; un changement pendant la lecture la fait refaire ; `keep` : valeur gardée sans abonné,
// relue au retour si la base a changé entre-temps, rendue telle quelle sinon.
//
//   npx jiti tools/test-live-partage.ts
import assert from 'node:assert/strict'
import Dexie from 'dexie'
import { db } from '../src/db'
import { sharedQuery } from '../src/live'

// Fenêtre minimale (minuteries) pour src/live.ts hors navigateur, posée après le chargement des modules (qui testent `window`).
;(globalThis as unknown as { window: unknown }).window = { setTimeout, clearTimeout }

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))
const change = (table: string) => Dexie.on('storagemutated').fire({ [`idb://${db.name}/${table}/`]: true })

// ---------- Deux abonnés pendant la première lecture : une seule lecture ----------
{
  let runs = 0
  let release!: () => void
  const q = sharedQuery(['players'], async () => {
    runs++
    await new Promise<void>((ok) => (release = ok))
    return runs
  }, 20, true)
  const seen: number[] = []
  const stopA = q.subscribe(() => seen.push(q.get()!))
  await tick()
  assert.equal(runs, 1, 'premier abonné : lecture lancée')
  const stopB = q.subscribe(() => {})
  const loaded = q.load()
  await tick()
  release()
  assert.equal(await Promise.race([loaded, tick(200).then(() => 'relancée : toujours en attente')]), 1, 'load() pendant la lecture : son résultat')
  await tick(40)
  assert.equal(runs, 1, 'deuxième abonné pendant la lecture : pas de deuxième lecture')
  assert.deepEqual(seen, [1])
  // Changement pendant une lecture : elle est refaite (la valeur lue est déjà périmée).
  change('players')
  await tick(30)
  assert.equal(runs, 2, 'changement : relu après le délai')
  change('players')
  await tick()
  release()
  await tick(30)
  release()
  await tick()
  assert.equal(runs, 3, 'changement pendant la lecture : relu une fois de plus')
  assert.equal(q.get(), 3)
  stopA()
  stopB()
  // Gardée sans abonné : rendue telle quelle, sans lecture.
  const r = runs
  const stopC = q.subscribe(() => {})
  await tick(30)
  assert.equal(runs, r, 'retour sans changement : rien n’est relu')
  stopC()
  // Changement pendant l'absence : périmée, relue au retour (la valeur gardée est montrée en attendant).
  change('players')
  await tick(30)
  assert.equal(runs, r, 'personne à l’écran : rien n’est relu tout de suite')
  q.subscribe(() => {})
  assert.equal(q.get(), 3, 'valeur gardée montrée en attendant')
  await tick()
  release()
  await tick()
  assert.equal(runs, r + 1, 'retour après un changement : relue')
  // Autre table : rien.
  change('seen')
  await tick(30)
  assert.equal(runs, r + 1, 'table non suivie : rien n’est relu')
}

console.log('test-live-partage : ok')
process.exit(0)
