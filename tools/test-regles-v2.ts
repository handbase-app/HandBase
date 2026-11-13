// Test des règles adaptatives v2 (src/charge.ts, CHARGE_REGLES ; série 10 du 30/10 : en scénario dur, les règles ne s'étaient
// presque jamais déclenchées, chaque requête restant sous 2 s) : durée d'une synchronisation entière (> 10 s : 1 point, > 30 s :
// 2), retard du direct (> 10 s : 1 point, > 60 s : 2 ; au-delà du plus petit retard vu, borné : horloge en avance tolérée ;
// une rafale compte une fois ; valeurs absurdes ignorées), heure d'un signal (lignes du serveur d'abord), annonce du serveur par
// la réponse du registre (061) ; simulations : jour réaliste → calme, scénario dur → chargé puis saturé, retour progressif ;
// câblage de src/sync.ts. Aucune donnée réelle.
//
//   npx jiti tools/test-regles-v2.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHARGE_REGLES, heureSignal, indiceRetard, indiceSync, lireAnnonce, LoadMeter } from '../src/charge'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}
const R = CHARGE_REGLES
const S = 1000
const M = 60_000

function meter() {
  let now = 0
  const changes: string[] = []
  const m = new LoadMeter({ now: () => now, onChange: (x) => changes.push(x) })
  return { m, changes, at: (ms: number) => (now = ms), now: () => now }
}

t('seuils dans CHARGE_REGLES : synchronisation 10 s / 30 s, retard 10 s / 60 s', () => {
  assert.equal(R.syncLongueMs, 10 * S)
  assert.equal(R.syncTresLongueMs, 30 * S)
  assert.equal(R.retardMs, 10 * S)
  assert.equal(R.retardTresMs, 60 * S)
  assert.deepEqual([indiceSync(9_999), indiceSync(10 * S), indiceSync(29_999), indiceSync(30 * S), indiceSync(NaN)], [0, 1, 1, 2, 0])
  assert.deepEqual([indiceRetard(9 * S), indiceRetard(10 * S), indiceRetard(60 * S), indiceRetard(-5 * S)], [0, 1, 2, 0])
})

t('synchronisations entières longues : deux de plus de 30 s en une minute → chargé', () => {
  const { m, at } = meter()
  m.noteSync(2 * S)
  assert.equal(m.niveau(), 'calme')
  m.noteSync(45 * S)
  assert.equal(m.niveau(), 'calme', 'une seule : 2 points')
  at(20 * S)
  m.noteSync(45 * S)
  assert.equal(m.niveau(), 'charge')
})

t('retard du direct : au-delà du plus petit retard vu (horloge de l’appareil 40 s en avance : rien) ', () => {
  const { m, at } = meter()
  for (let i = 0; i < 30; i++) {
    at(i * 6 * S)
    m.noteRetard(40 * S + (i % 3) * 100)
  }
  assert.equal(m.points(), 0)
  assert.equal(m.niveau(), 'calme')
  // Puis un vrai retard de 70 s de plus : 2 points par indice, un indice toutes les 5 s au plus.
  for (let i = 0; i < 5; i++) {
    at(200 * S + i * 6 * S)
    m.noteRetard(110 * S)
  }
  assert.equal(m.niveau(), 'sature')
})

t('retard : une rafale de signaux en retard compte une fois ; valeurs absurdes ignorées ; horloge en avance de plus de 2 min : indice pas utilisé', () => {
  const a = meter()
  a.m.noteRetard(0)
  for (let i = 0; i < 50; i++) a.m.noteRetard(70 * S)
  assert.equal(a.m.points(), R.points.retardTres, 'une rafale = un indice')
  const b = meter()
  b.m.noteRetard(10 * 60 * 60 * S)
  b.m.noteRetard(-45 * M)
  b.m.noteRetard(NaN)
  assert.equal(b.m.points(), 0)
  const c = meter()
  c.m.noteRetard(10 * M) // horloge 10 min en avance : indice pas utilisé (jamais « saturé » pour une horloge fausse)
  c.m.noteRetard(11 * M)
  assert.equal(c.m.points(), 0)
})

t('heure d’un signal : la plus récente heure serveur des lignes portées, sinon l’heure d’envoi ; rien de lisible : null', () => {
  assert.equal(heureSignal('2026-11-01T09:00:00Z', ['2026-11-01T08:59:58.5Z', '2026-11-01T08:59:59Z']), Date.parse('2026-11-01T08:59:59Z'))
  assert.equal(heureSignal('2026-11-01T09:00:00Z', [undefined, 'x']), Date.parse('2026-11-01T09:00:00Z'))
  assert.equal(heureSignal(undefined, []), null)
  assert.equal(heureSignal(42, [null]), null)
})

t('annonce du serveur dans la réponse du registre (k) : même lecture que l’annonce en direct', () => {
  assert.deepEqual(lireAnnonce({ niveau: 'sature', ttl: 120 }), { niveau: 'sature', ttlMs: 120 * S })
  const { m } = meter()
  m.annonce(lireAnnonce({ niveau: 'charge', ttl: 60 })!)
  assert.equal(m.niveau(), 'charge')
})

t('simulation, jour réaliste (synchronisations de 0,3 s, signaux reçus en 0,2 à 1 s) : toujours calme', () => {
  const { m, at, changes } = meter()
  for (let s = 0; s < 3600; s += 3) {
    at(s * S)
    if (s % 300 === 0) m.noteSync(300)
    m.noteRetard(200 + (s % 800))
  }
  assert.equal(m.niveau(), 'calme')
  assert.deepEqual(changes, [])
})

t('simulation, scénario dur de la série 10 (synchronisations p95 45 s, direct p95 ~4 min, requêtes < 2 s) : saturé en moins de 2 min', () => {
  const { m, at } = meter()
  // Ouverture calme (le plus petit retard vu : 1 s), puis la charge monte : retards de 30 s à 4 min, synchronisations de 20 à 45 s.
  m.noteRetard(1 * S)
  let sature = -1
  for (let s = 0; s < 600; s += 2) {
    at(s * S)
    m.noteRetard(Math.min(240, 30 + s) * S)
    if (s % 30 === 0) m.noteSync(Math.min(45, 20 + s / 10) * S)
    if (sature < 0 && m.niveau() === 'sature') sature = s
  }
  assert.ok(sature >= 0 && sature < 120, `saturé à ${sature} s`)
  // Retour progressif : un cran après 2 min sans indice, puis le suivant.
  const fin = 600 * S
  at(fin + R.fenetreMs + R.calmeAvantDescenteMs + S)
  assert.equal(m.niveau(), 'charge')
  at(fin + R.fenetreMs + 2 * R.calmeAvantDescenteMs + 2 * S)
  assert.equal(m.niveau(), 'calme')
})

t('câblage (src/sync.ts) : durée de synchronisation (hors premier chargement et gros envois), retard des signaux, annonce du registre', () => {
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  assert.ok(sync.includes('if (!freshBefore && sent.reduce((n, x) => n + x.rows.length, 0) <= 100) charge.noteSync(Date.now() - startedAt)'))
  assert.ok(sync.includes('const at = heureSignal(s.v, [...(s.rows ?? []), ...(s.row ? [s.row] : [])].map((r) => r.server_updated_at))'))
  assert.ok(sync.includes('if (at !== null) charge.noteRetard(Date.now() - at)'))
  assert.ok(sync.includes('const annonce = rep.k ? lireAnnonce(rep.k) : null'))
  assert.ok(sync.includes('if (annonce) charge.annonce(annonce)'))
})

console.log(`${n} tests OK`)
