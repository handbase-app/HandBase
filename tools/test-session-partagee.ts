// Test du partage de la session avec le service worker (src/sessionStore.ts) et du verrou de renouvellement commun
// (src/authRefresh.ts : guardRefresh pour l'appli, workerSession pour le service worker) : une seule copie de la session
// (migration depuis localStorage, la plus récente gardée, repli sur localStorage sans IndexedDB), clé identique à celle de
// supabase-js, vrai client de connexion (auth-js) sur le stockage asynchrone ; le service worker utilise le jeton gardé
// s'il est valable, sinon UN renouvellement dans le verrou commun, jamais en même temps que l'appli, jamais avec un jeton
// déjà remplacé, jamais d'effacement. Données fictives seulement (aucun serveur contacté).
//
//   npx jiti tools/test-session-partagee.ts
import assert from 'node:assert/strict'
import { GoTrueClient } from '@supabase/auth-js'
import { createClient } from '@supabase/supabase-js'
import { guardRefresh, isDeferred, OPEN_GATE, queueLock, readGate, storedGate, tokenMark, workerSession, type RefreshGate } from '../src/authRefresh'
import { expiresAtOf, GATE_MIRROR_KEY, memoryKv, newerSession, refreshTokenOf, sessionStorageKey, sharedSessionStorage, type Kv } from '../src/sessionStore'

let n = 0
let chain: Promise<void> = Promise.resolve()
const t = (name: string, f: () => void | Promise<void>) => {
  chain = chain.then(async () => {
    await f()
    n++
    console.log(`ok ${n} - ${name}`)
  })
}

const URL_ = 'https://abcdefgh.supabase.co'
const KEY = sessionStorageKey(URL_)
const NOW = Date.parse('2026-11-13T17:00:00Z')
const sess = (rt: string, expiresAt: number) =>
  JSON.stringify({
    access_token: `acces-${rt}`,
    refresh_token: rt,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    user: { id: '00000000-0000-0000-0000-0000000000d1', aud: 'authenticated', email: 'club@exemple.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** localStorage en mémoire. */
class Mem {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}
/** Magasin qui échoue (IndexedDB indisponible). */
const brokenKv: Kv = {
  get: async () => {
    throw new Error('IndexedDB indisponible')
  },
  set: async () => {
    throw new Error('IndexedDB indisponible')
  },
  del: async () => {
    throw new Error('IndexedDB indisponible')
  },
}

// ---------- Une seule copie ----------

t('clé de la session : la même que celle choisie par supabase-js', () => {
  // (transport fictif : Node 20 n'a pas de WebSocket ; rien n'est ouvert)
  const c = createClient(URL_, 'cle-publique-fictive', {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: class {} as unknown as never },
  })
  assert.equal(KEY, 'sb-abcdefgh-auth-token')
  assert.equal((c as unknown as { storageKey: string }).storageKey, KEY)
  assert.equal(sessionStorageKey('http://localhost:54321'), 'sb-localhost-auth-token')
})

t('la plus récente de deux sessions ; une illisible ne remplace jamais une lisible', () => {
  const a = sess('A', 1000)
  const b = sess('B', 2000)
  assert.equal(newerSession(a, b), b)
  assert.equal(newerSession(b, a), b)
  assert.equal(newerSession(a, a), a)
  assert.equal(newerSession(a, null), a)
  assert.equal(newerSession(null, b), b)
  assert.equal(newerSession(a, '{pas du json'), a)
  assert.equal(newerSession('{"x":1}', b), b)
  assert.equal(refreshTokenOf(b), 'B')
  assert.equal(expiresAtOf(b), 2000)
  assert.equal(refreshTokenOf(null), null)
})

t('migration : la session de localStorage passe dans IndexedDB et quitte localStorage', async () => {
  const ls = new Mem()
  const kv = memoryKv()
  ls.setItem(KEY, sess('A', 1000))
  const st = sharedSessionStorage(kv, ls)
  assert.equal(await st.getItem(KEY), sess('A', 1000))
  assert.equal(ls.getItem(KEY), null)
  assert.equal(kv.map.get(KEY), sess('A', 1000))
  // Ancien onglet encore ouvert qui réécrit une session plus récente dans localStorage : adoptée, localStorage vidé.
  ls.setItem(KEY, sess('B', 2000))
  assert.equal(await st.getItem(KEY), sess('B', 2000))
  assert.equal(kv.map.get(KEY), sess('B', 2000))
  assert.equal(ls.getItem(KEY), null)
  // … ou plus ancienne : IndexedDB gardée, localStorage vidé quand même.
  ls.setItem(KEY, sess('A', 1000))
  assert.equal(await st.getItem(KEY), sess('B', 2000))
  assert.equal(ls.getItem(KEY), null)
  // Écriture et effacement : IndexedDB seulement (jamais deux copies).
  await st.setItem(KEY, sess('C', 3000))
  assert.equal(ls.getItem(KEY), null)
  assert.equal(kv.map.get(KEY), sess('C', 3000))
  await st.removeItem(KEY)
  assert.equal(kv.map.has(KEY), false)
  assert.equal(await st.getItem(KEY), null)
  assert.equal(st.degraded, false)
})

t('sans IndexedDB : localStorage comme avant (rien ne casse)', async () => {
  const ls = new Mem()
  ls.setItem(KEY, sess('A', 1000))
  const st = sharedSessionStorage(brokenKv, ls)
  assert.equal(await st.getItem(KEY), sess('A', 1000))
  assert.equal(st.degraded, true)
  await st.setItem(KEY, sess('B', 2000))
  assert.equal(ls.getItem(KEY), sess('B', 2000))
  await st.removeItem(KEY)
  assert.equal(ls.getItem(KEY), null)
  const none = sharedSessionStorage(null, ls)
  await none.setItem(KEY, sess('C', 1))
  assert.equal(ls.getItem(KEY), sess('C', 1))
})

t('vrai client de connexion (auth-js) sur le stockage asynchrone : session migrée lue, renouvelée, enregistrée dans IndexedDB', async () => {
  const ls = new Mem()
  const kv = memoryKv()
  ls.setItem(KEY, sess('A', Math.round(Date.now() / 1000) - 10)) // jeton d'accès expiré
  const st = sharedSessionStorage(kv, ls)
  let sent: string | null = null
  const client = new GoTrueClient({
    url: `${URL_}/auth/v1`,
    headers: { apikey: 'cle-publique-fictive' },
    storageKey: KEY,
    storage: st,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    fetch: async (_input, init) => {
      sent = (JSON.parse(String(init?.body)) as { refresh_token: string }).refresh_token
      return json(200, JSON.parse(sess('B', Math.round(Date.now() / 1000) + 3600)))
    },
  })
  const { data } = await client.getSession()
  assert.equal(sent, 'A')
  assert.equal(data.session?.refresh_token, 'B')
  assert.equal(refreshTokenOf(kv.map.get(KEY)), 'B')
  assert.equal(ls.getItem(KEY), null)
})

// ---------- Service worker : renouvellement ----------

/** Serveur de connexion simulé : compte les envois ; réponse selon `answer`. */
function server(answer: (rt: string) => Response | Promise<Response>) {
  const calls: string[] = []
  const f = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const rt = (JSON.parse(String(init?.body)) as { refresh_token: string }).refresh_token
    calls.push(rt)
    return answer(rt)
  }) as typeof fetch
  return { calls, f }
}
const nowS = Math.round(NOW / 1000)
const opts = (kv: Kv, f: typeof fetch, lock = queueLock()) => ({
  fetch: f,
  url: URL_,
  anonKey: 'cle-publique-fictive',
  key: KEY,
  gateKey: GATE_MIRROR_KEY,
  kv,
  lock,
  now: () => NOW,
})

t('service worker : jeton encore valable → aucun envoi ; pas de session → « aucune »', async () => {
  const s = server(() => json(500, {}))
  const kv = memoryKv({ [KEY]: sess('A', nowS + 3000) })
  const r = await workerSession(opts(kv, s.f))
  assert.deepEqual(r, { ok: true, accessToken: 'acces-A', userId: '00000000-0000-0000-0000-0000000000d1', renewed: false })
  assert.equal(s.calls.length, 0)
  assert.deepEqual(await workerSession(opts(memoryKv(), s.f)), { ok: false, why: 'aucune' })
})

t('service worker : jeton expiré → UN renouvellement ; nouvelle session et empreinte écrites', async () => {
  const s = server(() => json(200, JSON.parse(sess('B', nowS + 3600))))
  const kv = memoryKv({ [KEY]: sess('A', nowS - 10) })
  const r = await workerSession(opts(kv, s.f))
  assert.equal(r.ok && r.accessToken, 'acces-B')
  assert.deepEqual(s.calls, ['A'])
  assert.equal(refreshTokenOf(kv.map.get(KEY)), 'B')
  assert.equal(readGate(kv.map.get(GATE_MIRROR_KEY) ?? null).used, tokenMark('A'))
})

t('service worker : erreur passagère → « plus tard », session gardée ; refus définitif → « refusée », session NON effacée', async () => {
  for (const [res, why] of [
    [json(503, {}), 'plus-tard'],
    [json(429, { message: 'trop' }), 'plus-tard'],
    [json(200, { pas: 'une session' }), 'plus-tard'],
    [json(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }), 'refusee'],
  ] as const) {
    const s = server(() => res.clone())
    const kv = memoryKv({ [KEY]: sess('A', nowS - 10) })
    assert.deepEqual(await workerSession(opts(kv, s.f)), { ok: false, why })
    assert.equal(s.calls.length, 1)
    assert.equal(refreshTokenOf(kv.map.get(KEY)), 'A')
  }
  const down = server(() => {
    throw new TypeError('Failed to fetch')
  })
  const kv = memoryKv({ [KEY]: sess('A', nowS - 10) })
  assert.deepEqual(await workerSession(opts(kv, down.f)), { ok: false, why: 'plus-tard' })
})

t('service worker : attente en cours (repère de l’appli) ou jeton déjà renouvelé par un onglet → rien n’est envoyé', async () => {
  const s = server(() => json(200, JSON.parse(sess('X', nowS + 3600))))
  const wait = memoryKv({ [KEY]: sess('A', nowS - 10), [GATE_MIRROR_KEY]: JSON.stringify({ n: 2, at: NOW + 4000 }) })
  assert.deepEqual(await workerSession(opts(wait, s.f)), { ok: false, why: 'plus-tard' })
  const used = memoryKv({ [KEY]: sess('A', nowS - 10), [GATE_MIRROR_KEY]: JSON.stringify({ n: 0, at: 0, used: tokenMark('A') }) })
  assert.deepEqual(await workerSession(opts(used, s.f)), { ok: false, why: 'plus-tard' })
  assert.equal(s.calls.length, 0)
})

t('verrou commun : appli et service worker en même temps → un seul envoi ; l’autre relit la session renouvelée', async () => {
  // Serveur à rotation stricte : le jeton actif est accepté une fois (renvoie le suivant) ; un jeton remplacé est refusé.
  let active = 'A'
  let k = 0
  const s = server(async (rt) => {
    await new Promise((r) => setTimeout(r, 5))
    if (rt !== active) return json(400, { error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' })
    active = `R${++k}`
    return json(200, JSON.parse(sess(active, nowS + 3600)))
  })
  const kv = memoryKv({ [KEY]: sess('A', nowS - 10) })
  const lock = queueLock()
  const st = sharedSessionStorage(kv, null)
  let gate: RefreshGate = OPEN_GATE
  const appFetch = guardRefresh({
    fetch: s.f,
    lock,
    storedToken: async () => refreshTokenOf(await st.getItem(KEY)),
    gate: { get: () => gate, set: (g) => void (gate = g) },
    mirror: async (g) => kv.set(GATE_MIRROR_KEY, JSON.stringify(g)),
    now: () => NOW,
  })
  const appRefresh = () =>
    appFetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: JSON.stringify({ refresh_token: 'A' }) })
  // Le service worker entre d'abord dans le verrou, l'appli (avec le jeton A lu avant) attend son tour.
  const wp = workerSession(opts(kv, s.f, lock))
  await new Promise((r) => setTimeout(r, 2)) // le service worker tient le verrou (envoi en cours, 5 ms)
  const [w, a] = await Promise.all([wp, appRefresh()])
  assert.deepEqual(s.calls, ['A'])
  assert.equal(w.ok && w.renewed, true)
  assert.equal(isDeferred(a), true) // jeton A déjà remplacé : pas envoyé (il aurait été refusé, session fermée)
  assert.equal(refreshTokenOf(kv.map.get(KEY)), 'R1')
  // Dans l'autre ordre : l'appli renouvelle (la nouvelle session n'est enregistrée par auth-js qu'après le verrou) ; le
  // service worker trouve le jeton gardé déjà renouvelé (empreinte recopiée DANS le verrou) : il n'envoie rien.
  active = 'B'
  kv.map.set(KEY, sess('B', nowS - 10))
  gate = OPEN_GATE
  const appB = await appFetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: JSON.stringify({ refresh_token: 'B' }) })
  assert.equal(appB.status, 200)
  assert.equal(readGate(kv.map.get(GATE_MIRROR_KEY) ?? null).used, tokenMark('B'))
  const w2 = await workerSession(opts(kv, s.f, lock))
  assert.deepEqual(w2, { ok: false, why: 'plus-tard' })
  assert.deepEqual(s.calls, ['A', 'B'])
})

t('repère de l’appli recopié pour le service worker (attente après un échec)', async () => {
  const kv = memoryKv({ [KEY]: sess('A', nowS - 10) })
  const ls = new Map<string, string>()
  const appFetch = guardRefresh({
    fetch: (async () => json(503, {})) as typeof fetch,
    lock: queueLock(),
    storedToken: async () => 'A',
    gate: storedGate({ get: (k) => ls.get(k) ?? null, set: (k, v) => void ls.set(k, v) }),
    mirror: async (g) => kv.set(GATE_MIRROR_KEY, JSON.stringify(g)),
    now: () => NOW,
    rnd: () => 0,
  })
  const r = await appFetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: JSON.stringify({ refresh_token: 'A' }) })
  assert.equal(isDeferred(r), true)
  const g = readGate(kv.map.get(GATE_MIRROR_KEY) ?? null)
  assert.equal(g.n, 1)
  assert.equal(g.at, NOW + 2000)
  // Le service worker respecte l'attente.
  const s = server(() => json(200, {}))
  assert.deepEqual(await workerSession(opts(kv, s.f)), { ok: false, why: 'plus-tard' })
  assert.equal(s.calls.length, 0)
})

chain.then(() => console.log(`\n${n} essais réussis`)).catch((e) => {
  console.error(e)
  process.exit(1)
})
