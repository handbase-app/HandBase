// Test du niveau de charge et des règles adaptatives (src/charge.ts) : indices (refus, erreurs, lenteur, Retry-After), montée
// immédiate, retour au calme progressif (un cran à la fois, sans va-et-vient), annonce du serveur (plancher borné, « calme »),
// délais de regroupement, envoi de la file (notations et évaluations jamais retardées), signe de vie, filet de sécurité (15 min
// en charge, 60 s → 2 min → 5 min quand le direct est coupé) ; mesure branchée sur src/retry.ts (onResult) et câblage de
// src/sync.ts / src/presence.ts. Aucune donnée réelle.
//
//   npx jiti tools/test-charge.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CHARGE_REGLES,
  delaiEnvoi,
  delaiFilet,
  delaiSigneDeVie,
  DISCRET_TABLES,
  indice,
  lireAnnonce,
  LoadMeter,
  regroupement,
  type Niveau,
} from '../src/charge'
import { retryingFetch } from '../src/retry'
import { ALL_TOPIC, BROAD_JITTER_MS, COMMON_TOPIC, GROUP_MS, LIVE_EVENTS, pullDelay } from '../src/syncLive'

let n = 0
let chain: Promise<void> = Promise.resolve()
const t = (name: string, f: () => void | Promise<void>) => {
  chain = chain.then(async () => {
    await f()
    n++
    console.log(`ok ${n} - ${name}`)
  })
}

const R = CHARGE_REGLES
const S = 1000
const M = 60_000

/** Estimateur sur une horloge fictive. */
function meter() {
  let now = 1_000_000
  const changes: Niveau[] = []
  const m = new LoadMeter({ now: () => now, onChange: (x) => changes.push(x) })
  return {
    m,
    changes,
    at: (ms: number) => {
      now += ms
    },
    refus: (k = 1) => {
      for (let i = 0; i < k; i++) m.note({ status: 503, ms: 20, refused: true, retryAfterMs: 2000 })
    },
  }
}

// ---------- Indices ----------

t('indices : refus, erreurs, coupure, lenteur, Retry-After', () => {
  assert.deepEqual(indice({ status: 200, ms: 120 }), { pts: 0, min: 'calme' })
  assert.deepEqual(indice({ status: 429, ms: 10 }), { pts: R.points.refus, min: 'calme' })
  assert.deepEqual(indice({ status: 503, ms: 10, refused: true }), { pts: R.points.refus, min: 'calme' })
  assert.equal(indice({ status: 503, ms: 10 }).pts, R.points.erreur)
  assert.equal(indice({ status: 504, ms: 30_000 }).pts, R.points.erreur, 'erreur lente : comptée une fois')
  assert.equal(indice({ status: 0, ms: 60_000, timeout: true }).pts, R.points.erreur)
  assert.equal(indice({ status: 0, ms: 50 }).pts, R.points.coupure)
  assert.equal(indice({ status: 200, ms: R.lentMs - 1 }).pts, 0)
  assert.equal(indice({ status: 200, ms: R.lentMs }).pts, R.points.lent)
  assert.equal(indice({ status: 200, ms: R.tresLentMs }).pts, R.points.tresLent)
  // 404, 401 (réponse normale de l'appli) : rien.
  assert.equal(indice({ status: 404, ms: 30 }).pts, 0)
  assert.equal(indice({ status: 503, ms: 5, refused: true, retryAfterMs: 2000 }).min, 'charge')
  assert.equal(indice({ status: 503, ms: 5, refused: true, retryAfterMs: 10_000 }).min, 'sature')
  assert.equal(indice({ status: 503, ms: 5, refused: true, retryAfterMs: 1000 }).min, 'calme')
})

// ---------- Montée ----------

t('montée immédiate : chargé puis saturé selon les points de la fenêtre', () => {
  const x = meter()
  assert.equal(x.m.niveau(), 'calme')
  x.m.note({ status: 200, ms: 50 })
  x.m.note({ status: 503, ms: 50 }) // 2 points
  assert.equal(x.m.niveau(), 'calme')
  x.m.note({ status: 200, ms: R.tresLentMs }) // 4 points
  assert.equal(x.m.niveau(), 'charge')
  x.refus(3) // 10 points
  assert.equal(x.m.niveau(), 'sature')
  assert.deepEqual(x.changes, ['charge', 'sature'])
})

t('Retry-After long : saturé d’un coup ; moyen : chargé', () => {
  const a = meter()
  a.m.note({ status: 503, ms: 5, refused: true, retryAfterMs: 2000 })
  assert.equal(a.m.niveau(), 'charge')
  const b = meter()
  b.m.note({ status: 429, ms: 5, retryAfterMs: 30_000 })
  assert.equal(b.m.niveau(), 'sature')
})

t('indices anciens : sortis de la fenêtre, ils ne comptent plus pour monter', () => {
  const x = meter()
  x.m.note({ status: 503, ms: 5 })
  x.at(R.fenetreMs + 1)
  x.m.note({ status: 503, ms: 5 })
  assert.equal(x.m.points(), R.points.erreur)
  assert.equal(x.m.niveau(), 'calme')
})

// ---------- Retour progressif ----------

t('retour au calme progressif : un cran après 2 min sans indice, puis un autre', () => {
  const x = meter()
  x.refus(5)
  assert.equal(x.m.niveau(), 'sature')
  // Les indices sortent de la fenêtre au bout d'une minute ; il faut encore 2 min sous le seuil de sortie.
  x.at(R.fenetreMs + 1)
  assert.equal(x.m.niveau(), 'sature')
  x.at(R.calmeAvantDescenteMs - R.fenetreMs - 2)
  assert.equal(x.m.niveau(), 'sature', 'pas encore 2 min depuis le dernier indice suffisant')
  x.at(1)
  assert.equal(x.m.niveau(), 'charge')
  x.at(R.calmeAvantDescenteMs - 1)
  assert.equal(x.m.niveau(), 'charge', 'un cran à la fois')
  x.at(1)
  assert.equal(x.m.niveau(), 'calme')
  // (Le premier refus porte Retry-After 2 s : « chargé » tout de suite, puis « saturé » au cinquième.)
  assert.deepEqual(x.changes, ['charge', 'sature', 'charge', 'calme'])
})

t('sans va-et-vient : un indice isolé garde le niveau sans le relever', () => {
  const x = meter()
  x.refus(5)
  x.at(3 * M)
  assert.equal(x.m.niveau(), 'charge')
  // Une requête lente (1 point) : au-dessus du seuil de sortie de « chargé », sous l'entrée de « saturé » : on reste chargé.
  x.m.note({ status: 200, ms: R.lentMs })
  assert.equal(x.m.niveau(), 'charge')
  x.at(R.calmeAvantDescenteMs - 1)
  assert.equal(x.m.niveau(), 'charge', 'l’indice a relancé l’attente')
  x.at(R.calmeAvantDescenteMs)
  assert.equal(x.m.niveau(), 'calme')
  // Le serveur oscille (un refus de temps en temps, 2 points par minute) : jamais de remontée à « chargé » depuis le calme.
  const y = meter()
  for (let i = 0; i < 20; i++) {
    y.m.note({ status: 503, ms: 5 })
    y.at(R.fenetreMs + 1)
  }
  assert.equal(y.m.niveau(), 'calme')
  assert.deepEqual(y.changes, [])
})

t('saturé maintenu tant que le serveur refuse, même un peu', () => {
  const x = meter()
  x.refus(5)
  for (let i = 0; i < 10; i++) {
    x.at(30 * S)
    x.refus(2) // 4 points par fenêtre : seuil de sortie de « saturé »
  }
  assert.equal(x.m.niveau(), 'sature')
})

// ---------- Annonce du serveur ----------

t('annonce : lecture stricte, accents, durée par défaut et plafond', () => {
  assert.deepEqual(lireAnnonce({ niveau: 'sature', ttl: 600 }), { niveau: 'sature', ttlMs: 600_000 })
  assert.deepEqual(lireAnnonce({ niveau: 'Saturé' }), { niveau: 'sature', ttlMs: R.annonceTtlMs })
  assert.deepEqual(lireAnnonce({ niveau: 'chargé', ttl: 30 }), { niveau: 'charge', ttlMs: 30_000 })
  assert.deepEqual(lireAnnonce({ niveau: 'charge', ttl: 999_999 }), { niveau: 'charge', ttlMs: R.annonceMaxMs })
  assert.deepEqual(lireAnnonce({ niveau: 'calme' }), { niveau: 'calme', ttlMs: R.annonceTtlMs })
  for (const bad of [null, 'sature', [], {}, { niveau: 3 }, { niveau: 'panique' }])
    assert.equal(lireAnnonce(bad), null, JSON.stringify(bad))
  // Durée négative ou illisible : la durée par défaut.
  assert.equal(lireAnnonce({ niveau: 'sature', ttl: -5 })?.ttlMs, R.annonceTtlMs)
  assert.equal(lireAnnonce({ niveau: 'sature', ttl: 'x' })?.ttlMs, R.annonceTtlMs)
})

t('annonce : plancher jusqu’à l’échéance, puis retour progressif ; « calme » retire le plancher', () => {
  const x = meter()
  x.m.annonce({ niveau: 'sature', ttlMs: 5 * M })
  assert.equal(x.m.niveau(), 'sature')
  x.at(5 * M - 1)
  assert.equal(x.m.niveau(), 'sature', 'aucun indice local : le plancher tient')
  x.at(1)
  assert.equal(x.m.niveau(), 'sature', 'échéance : pas de chute brutale')
  x.at(R.calmeAvantDescenteMs)
  assert.equal(x.m.niveau(), 'charge')
  x.at(R.calmeAvantDescenteMs)
  assert.equal(x.m.niveau(), 'calme')
  // Plafond : une annonce de 2 h ne tient que annonceMaxMs.
  const y = meter()
  y.m.annonce({ niveau: 'charge', ttlMs: 2 * 3600_000 })
  y.at(R.annonceMaxMs + R.calmeAvantDescenteMs)
  assert.equal(y.m.niveau(), 'calme')
  // « calme » : le plancher part, la descente reste progressive ; les indices de l'appareil comptent toujours.
  const z = meter()
  z.m.annonce({ niveau: 'sature', ttlMs: 10 * M })
  z.at(M)
  z.m.annonce({ niveau: 'calme', ttlMs: R.annonceTtlMs })
  assert.equal(z.m.niveau(), 'sature')
  z.at(R.calmeAvantDescenteMs)
  assert.equal(z.m.niveau(), 'charge')
  const w = meter()
  w.refus(5)
  w.m.annonce({ niveau: 'calme', ttlMs: R.annonceTtlMs })
  assert.equal(w.m.niveau(), 'sature', 'l’annonce « calme » n’efface pas ce que l’appareil constate')
  // Annonce plus basse que le niveau local : sans effet.
  const v = meter()
  v.refus(5)
  v.m.annonce({ niveau: 'charge', ttlMs: 10 * M })
  assert.equal(v.m.niveau(), 'sature')
})

// ---------- Règles ----------

t('regroupement des signaux : 1,5 s, 5 s, 10 s ; canaux larges étalés', () => {
  assert.equal(regroupement('calme', false), 1500)
  assert.equal(regroupement('charge', false), 5000)
  assert.equal(regroupement('sature', false), 10_000)
  assert.equal(regroupement('calme', true, () => 0.5), 1500 + 5000)
  assert.equal(regroupement('charge', true, () => 0.5), 5000 + 10_000)
  assert.equal(regroupement('sature', true, () => 0.999999), 10_000 + 29_999)
  // pullDelay (src/syncLive.ts) : calme par défaut (comportement d'avant), niveau donné sinon.
  assert.equal(GROUP_MS, 1500)
  assert.equal(BROAD_JITTER_MS, 10_000)
  assert.equal(pullDelay('hb:club:X', () => 0.7), 1500)
  assert.equal(pullDelay('hb:club:X', () => 0.7, 'sature'), 10_000)
  assert.equal(pullDelay(ALL_TOPIC, () => 0, 'charge'), 5000)
})

t('envoi de la file : notations et évaluations jamais retardées ; « vu » et traces regroupés en charge', () => {
  for (const niveau of ['calme', 'charge', 'sature'] as const) {
    assert.equal(delaiEnvoi(['measurements'], niveau), R.envoiImmediatMs, `notation, ${niveau}`)
    assert.equal(delaiEnvoi(['evaluations'], niveau), R.envoiImmediatMs, `évaluation, ${niveau}`)
    assert.equal(delaiEnvoi(['seen', 'measurements', 'question_log'], niveau), R.envoiImmediatMs, `notation avec des « vu », ${niveau}`)
    assert.equal(delaiEnvoi(['players'], niveau), R.envoiImmediatMs)
    assert.equal(delaiEnvoi(['events'], niveau), R.envoiImmediatMs)
    assert.equal(delaiEnvoi([], niveau), R.envoiImmediatMs)
  }
  assert.equal(R.envoiImmediatMs, 500)
  assert.deepEqual([...DISCRET_TABLES].sort(), ['question_log', 'seen'])
  assert.equal(delaiEnvoi(['seen'], 'calme'), 500)
  assert.equal(delaiEnvoi(['seen', 'question_log'], 'charge'), 10_000)
  assert.equal(delaiEnvoi(new Set(['seen']), 'sature'), 30_000)
  // Aucun délai « discret » ne s'applique à une table qui porte une note.
  for (const tbl of ['measurements', 'evaluations']) assert.ok(!DISCRET_TABLES.includes(tbl))
})

t('signe de vie : 30 s, 60 s, 120 s', () => {
  assert.deepEqual((['calme', 'charge', 'sature'] as const).map((x) => delaiSigneDeVie(x)), [30_000, 60_000, 120_000])
})

t('filet, direct abonné : 5 min au calme, 15 min en charge', () => {
  assert.equal(delaiFilet(true, 'calme', 0, 0.9), 5 * M)
  assert.equal(delaiFilet(true, 'charge', 0, 0.9), 15 * M)
  assert.equal(delaiFilet(true, 'sature', 7, 0.9), 15 * M)
})

t('filet, direct coupé : 60 s, puis 2 min, puis 5 min, avec du hasard ; en charge, on part plus haut', () => {
  assert.deepEqual([0, 1, 2, 3, 10].map((k) => delaiFilet(false, 'calme', k, 0)), [M, 2 * M, 5 * M, 5 * M, 5 * M])
  assert.equal(delaiFilet(false, 'calme', 0, 0.5), 60_000 * 1.125)
  assert.ok(delaiFilet(false, 'calme', 0, 0.999999) <= 75_000)
  assert.deepEqual([0, 1, 2].map((k) => delaiFilet(false, 'charge', k, 0)), [2 * M, 5 * M, 5 * M])
  assert.deepEqual([0, 1].map((k) => delaiFilet(false, 'sature', k, 0)), [5 * M, 5 * M])
})

t('filet, direct coupé : simulation de src/sync.ts (pas de rafale à 60 s), puis direct revenu', () => {
  // Même logique que startSync / runOnce / setLive : palier pris au début de chaque synchronisation complète.
  let coupes = 0
  let step = 0
  let last = 0
  let live = false
  const fulls: number[] = []
  const full = (now: number) => {
    last = now
    step = live ? 0 : coupes++
    fulls.push(now)
  }
  full(0)
  for (let now = 10_000; now <= 30 * M; now += 10_000) {
    if (now === 20 * M) {
      live = true
      coupes = 0
    }
    if (now - last >= delaiFilet(live, 'calme', step, 0)) full(now)
  }
  // Coupé : 0, 1 min, 3 min, 8 min, 13 min, 18 min ; revenu à 20 min : prochain filet 5 min après la dernière (23 min).
  assert.deepEqual(fulls.map((x) => x / M), [0, 1, 3, 8, 13, 18, 23, 28])
  // Avant (60 s fixes) : 30 synchronisations complètes en 30 min.
})

// ---------- Mesure branchée sur le tourniquet ----------

t('tourniquet : chaque tentative est un indice (statut, refus, Retry-After, délai)', async () => {
  const seen: { status: number; refused: boolean; retryAfterMs: number | null; timeout: boolean }[] = []
  const answers = [
    new Response('', { status: 503, headers: { 'Retry-After': '12', 'x-envoy-overloaded': 'true' } }),
    new Response('', { status: 429 }),
    new Response('[]', { status: 200 }),
  ]
  const f = retryingFetch({
    fetch: async () => answers.shift()!,
    sleep: async () => {},
    rnd: () => 0,
    online: () => true,
    onResult: (r) => seen.push({ status: r.status, refused: r.refused, retryAfterMs: r.retryAfterMs, timeout: r.timeout }),
  })
  const res = await f('https://exemple.test/rest/v1/hb_players?select=id')
  assert.equal(res.status, 200)
  assert.deepEqual(seen, [
    { status: 503, refused: true, retryAfterMs: 12_000, timeout: false },
    { status: 429, refused: false, retryAfterMs: null, timeout: false },
    { status: 200, refused: false, retryAfterMs: null, timeout: false },
  ])
  // Branché sur l'estimateur : un 503 avec Retry-After de 12 s fait passer « saturé ».
  const x = meter()
  for (const s of seen) x.m.note({ ...s, ms: 10 })
  assert.equal(x.m.niveau(), 'sature')
  // Hors ligne, ou autre adresse que la base : rien.
  const none: unknown[] = []
  const off = retryingFetch({ fetch: async () => new Response('', { status: 503 }), sleep: async () => {}, online: () => false, onResult: (r) => none.push(r) })
  await off('https://exemple.test/rest/v1/hb_players')
  await retryingFetch({ fetch: async () => new Response('{}'), onResult: (r) => none.push(r) })('https://exemple.test/auth/v1/user')
  assert.equal(none.length, 0)
})

// ---------- Câblage ----------

t('câblage : mesure, annonce sur le canal commun, direct, file, filet, signe de vie', () => {
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  const presence = readFileSync(new URL('../src/presence.ts', import.meta.url), 'utf8')
  assert.ok((LIVE_EVENTS as readonly string[]).includes('charge'))
  assert.equal(COMMON_TOPIC, 'hb:commun')
  assert.ok(sync.includes('onResult: (r) => charge.note(r)'))
  assert.match(sync, /event === 'charge'\) \{\s*const a = topic === COMMON_TOPIC \? lireAnnonce\(payload\) : null/)
  assert.ok(sync.includes('pullDelay(topic, Math.random, niveau)'))
  assert.ok(!/pullDelay\(topic\)/.test(sync), 'tous les délais de relecture suivent le niveau')
  assert.ok(sync.includes("db.outbox.hook('creating', (_key, item) => pushLater(item.table))"))
  assert.ok(sync.includes('delaiEnvoi(pushTables, charge.niveau())'))
  assert.ok(sync.includes('delaiFilet(liveSignals, charge.niveau(), filetStep, filetHasard)'))
  assert.ok(sync.includes('if (liveSignals) filetCoupes = 0'))
  assert.ok(!sync.includes('dueForSync('), 'plus de filet fixe à 60 s')
  assert.ok(presence.includes('delaiSigneDeVie(niveauCharge())'))
  assert.ok(!presence.includes('setInterval(() => void ping(), 30_000)'))
})

chain.then(
  () => console.log(`${n} tests OK`),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
