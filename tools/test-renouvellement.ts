// Test du renouvellement du jeton sans perte de session (src/authRefresh.ts ; série 8 du 30/10 : 12,8 % de renouvellements en
// erreur 500 à 20 000 appareils) : rythme des essais (2, 4, 8, 16, 30 s puis 60 s, hasard, Retry-After), tri des réponses
// (passagère / refus définitif / succès), rien d'envoyé pendant l'attente, jamais deux renouvellements en même temps ni un jeton
// déjà remplacé ; puis avec le VRAI client de connexion de supabase-js (auth-js, horloge simulée) : erreur passagère → session
// gardée, pas de déconnexion, envois espacés ; refus définitif → déconnexion ; deux « onglets » → un seul envoi. Témoin : sans
// cette protection, une 429 efface la session. Données fictives seulement (aucun serveur contacté).
//
//   npx jiti tools/test-renouvellement.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GoTrueClient } from '@supabase/auth-js'
import {
  classifyRefresh,
  DEFERRED_CODE,
  guardRefresh,
  isDeferred,
  isRefreshRequest,
  OPEN_GATE,
  queueLock,
  readGate,
  REFRESH_AFTER_MAX_MS,
  REFRESH_STEADY_MS,
  REFRESH_STEPS_MS,
  refreshDelay,
  storedRefreshToken,
  tokenMark,
  tokenOf,
  type RefreshGate,
} from '../src/authRefresh'

let n = 0
let chain: Promise<void> = Promise.resolve()
const t = (name: string, f: () => void | Promise<void>) => {
  chain = chain.then(async () => {
    await f()
    n++
    console.log(`ok ${n} - ${name}`)
  })
}

const AUTH = 'https://exemple.test/auth/v1'
const REFRESH_URL = `${AUTH}/token?grant_type=refresh_token`
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const session = (rt: string, expiresAt: number) => ({
  access_token: `acces-${rt}`,
  refresh_token: rt,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: expiresAt,
  user: { id: '00000000-0000-0000-0000-0000000000d1', aud: 'authenticated', email: 'club@exemple.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
})
const refreshInit = (rt: string): RequestInit => ({ method: 'POST', body: JSON.stringify({ refresh_token: rt }), headers: { 'Content-Type': 'application/json' } })

/** Stockage en mémoire (comme localStorage). */
class Mem {
  m = new Map<string, string>()
  get length() {
    return this.m.size
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null
  }
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
const memGate = () => {
  let g: RefreshGate = OPEN_GATE
  return { get: () => g, set: (x: RefreshGate) => void (g = x) }
}

// ---------- Rythme ----------

t('attentes : 2, 4, 8, 16, 30 s puis toutes les 60 s ; hasard de 0 à 25 % ; Retry-After respecté (plafonné)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map((f) => refreshDelay(f, null, () => 0)), [2000, 4000, 8000, 16000, 30000, 60000, 60000, 60000])
  assert.deepEqual([...REFRESH_STEPS_MS, REFRESH_STEADY_MS], [2000, 4000, 8000, 16000, 30000, 60000])
  assert.deepEqual([1, 5, 9].map((f) => refreshDelay(f, null, () => 1)), [2500, 37500, 75000])
  // Retry-After : au moins cela, plus jusqu'à 1 s de hasard ; jamais moins que l'attente croissante.
  assert.equal(refreshDelay(1, '10', () => 0), 10_000)
  assert.equal(refreshDelay(1, '10', () => 1), 11_000)
  assert.equal(refreshDelay(6, '3', () => 0), 60_000)
  const now = Date.parse('2026-10-30T10:00:00Z')
  assert.equal(refreshDelay(1, 'Fri, 30 Oct 2026 10:00:20 GMT', () => 0, now), 20_000)
  assert.equal(refreshDelay(1, '99999', () => 0), REFRESH_AFTER_MAX_MS)
  assert.equal(refreshDelay(1, 'n’importe quoi', () => 0), 2000)
})

t('seul le renouvellement est encadré (POST …/auth/v1/token?grant_type=refresh_token)', () => {
  assert.ok(isRefreshRequest(REFRESH_URL, 'POST'))
  assert.ok(isRefreshRequest(`${AUTH}/token?foo=1&grant_type=refresh_token`, 'post'))
  assert.ok(!isRefreshRequest(`${AUTH}/token?grant_type=password`, 'POST'))
  assert.ok(!isRefreshRequest(REFRESH_URL, 'GET'))
  assert.ok(!isRefreshRequest('https://exemple.test/rest/v1/hb_players?grant_type=refresh_token', 'POST'))
  assert.equal(tokenOf(JSON.stringify({ refresh_token: 'r1' })), 'r1')
  assert.equal(tokenOf('pas du json'), null)
})

t('tri des réponses : passagère, refus définitif de GoTrue, succès', () => {
  const ok = JSON.stringify(session('r1', 0))
  assert.equal(classifyRefresh(200, ok), 'ok')
  assert.equal(classifyRefresh(200, '{"access_tok'), 'transient') // réponse tronquée
  for (const s of [500, 501, 502, 503, 504, 520, 530, 429, 408]) assert.equal(classifyRefresh(s, '{"code":"x","msg":"y"}'), 'transient', `${s}`)
  // Refus définitifs (jeton invalide, révoqué, réutilisé, session fermée) : formats 2024 et anciens.
  assert.equal(classifyRefresh(400, '{"code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}'), 'definitive')
  assert.equal(classifyRefresh(400, '{"code":"refresh_token_already_used","msg":"Invalid Refresh Token: Already Used"}'), 'definitive')
  assert.equal(classifyRefresh(403, '{"code":"session_expired","msg":"Session Expired"}'), 'definitive')
  assert.equal(classifyRefresh(400, '{"error":"invalid_grant","error_description":"Invalid Refresh Token"}'), 'definitive')
  assert.equal(classifyRefresh(400, '{"code":400,"msg":"Invalid Refresh Token"}'), 'definitive')
  assert.equal(classifyRefresh(401, '{"error_code":"bad_jwt","msg":"invalid JWT"}'), 'definitive')
  // Intermédiaire (Envoy, Kong) sans code de GoTrue : passagère, la session est gardée.
  assert.equal(classifyRefresh(404, '{"message":"no Route matched with those values"}'), 'transient')
  assert.equal(classifyRefresh(403, 'upstream connect error or disconnect/reset before headers'), 'transient')
  assert.equal(classifyRefresh(418, '{"code":"x"}'), 'transient')
})

t('stockage : jeton de la session gardée (sb-…-auth-token), repère illisible = ouvert', () => {
  const s = new Mem()
  assert.equal(storedRefreshToken(s), null)
  s.setItem('handbase.role', 'observateur')
  s.setItem('sb-exemple-auth-token', JSON.stringify(session('r7', 0)))
  assert.equal(storedRefreshToken(s), 'r7')
  assert.deepEqual(readGate(null), OPEN_GATE)
  assert.deepEqual(readGate('{"n":"x"}'), OPEN_GATE)
  assert.deepEqual(readGate('{"n":3,"at":12}'), { n: 3, at: 12 })
})

// ---------- Protection seule (fetch simulé) ----------

/** Serveur simulé : réponses dans l'ordre ; compte les envois. */
function server(answers: (() => Response | Promise<Response>)[]) {
  const calls: string[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
    const a = answers.shift()
    if (!a) throw new Error('réponse non prévue')
    return a()
  }) as typeof fetch
  return { f, calls }
}

t('erreur passagère (500) : réponse « différée » 503 (session gardée), rien d’envoyé avant l’attente, puis un essai', async () => {
  let clock = 1_000_000
  const s = server([() => json(500, { code: 'unexpected_failure', msg: 'dial tcp: cannot assign requested address' }), () => json(200, session('r1', 0))])
  const gate = memGate()
  const waits: number[] = []
  const g = guardRefresh({ fetch: s.f, storedToken: () => 'r0', gate, lock: queueLock(), now: () => clock, rnd: () => 0, online: () => true, onWait: (u) => waits.push(u - clock) })
  const r1 = await g(REFRESH_URL, refreshInit('r0'))
  assert.equal(r1.status, 503)
  assert.ok(isDeferred(r1))
  assert.equal(((await r1.json()) as { code: string }).code, DEFERRED_CODE)
  assert.deepEqual(gate.get(), { n: 1, at: clock + 2000 })
  assert.deepEqual(waits, [2000])
  // Rafale d'auth-js (200, 400, 800 ms…) : rien n'est envoyé.
  for (const dt of [200, 400, 800]) {
    clock += dt
    const r = await g(REFRESH_URL, refreshInit('r0'))
    assert.ok(isDeferred(r))
  }
  assert.equal(s.calls.length, 1)
  clock = 1_000_000 + 2000
  const r2 = await g(REFRESH_URL, refreshInit('r0'))
  assert.equal(r2.status, 200)
  assert.equal(((await r2.json()) as { refresh_token: string }).refresh_token, 'r1')
  assert.equal(s.calls.length, 2)
  assert.deepEqual(gate.get(), { ...OPEN_GATE, used: tokenMark('r0') })
  // Le jeton remplacé n'est plus jamais renvoyé (auth-js n'a peut-être pas encore enregistré la nouvelle session).
  assert.ok(isDeferred(await g(REFRESH_URL, refreshInit('r0'))))
  assert.equal(s.calls.length, 2)
})

t('échecs de suite : envois espacés de 2, 4, 8, 16, 30 puis 60 s ; 429, 408, délai, coupure : passagers aussi ; Retry-After', async () => {
  let clock = 0
  const answers: (() => Response | Promise<Response>)[] = [
    () => json(503, {}),
    () => json(429, { code: 'over_request_rate_limit', msg: 'Request rate limit reached' }),
    () => json(408, {}),
    () => Promise.reject(new TypeError('Failed to fetch')),
    () => json(502, {}),
    () => json(504, {}),
    () => json(503, {}, { 'Retry-After': '120' }),
  ]
  const s = server(answers)
  const gate = memGate()
  const g = guardRefresh({ fetch: s.f, storedToken: () => 'r0', gate, lock: queueLock(), now: () => clock, rnd: () => 0, online: () => true })
  const gaps: number[] = []
  let last = 0
  // L'appareil redemande toutes les 100 ms : seuls les envois permis partent.
  for (clock = 0; s.calls.length < 7 && clock < 600_000; clock += 100) {
    const before = s.calls.length
    const r = await g(REFRESH_URL, refreshInit('r0'))
    assert.ok(isDeferred(r))
    if (s.calls.length > before) {
      gaps.push(clock - last)
      last = clock
    }
  }
  assert.deepEqual(gaps, [0, 2000, 4000, 8000, 16000, 30000, 60000])
  // Retry-After 120 s après le 7e échec : plus que les 60 s.
  assert.equal(gate.get().at - last, 120_000)
  // Délai dépassé (pas de réponse) : passager.
  const slow = guardRefresh({
    fetch: ((_i: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_ok, ko) => init?.signal?.addEventListener('abort', () => ko(new DOMException('Aborted', 'AbortError'))))) as typeof fetch,
    storedToken: () => 'r0',
    gate: memGate(),
    lock: queueLock(),
    timeoutMs: 20,
    online: () => true,
  })
  const r = await slow(REFRESH_URL, refreshInit('r0'))
  assert.ok(isDeferred(r))
  assert.match(((await r.json()) as { message: string }).message, /délai/)
})

t('refus définitif (jeton révoqué) : la réponse passe telle quelle (déconnexion), repère remis à zéro', async () => {
  const body = { code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' }
  const s = server([() => json(400, body, { 'x-supabase-api-version': '2024-01-01' })])
  const gate = memGate()
  gate.set({ n: 3, at: 0 })
  let done: boolean | null = null
  const g = guardRefresh({ fetch: s.f, storedToken: () => 'r0', gate, lock: queueLock(), online: () => true, onDone: (ok) => (done = ok) })
  const r = await g(REFRESH_URL, refreshInit('r0'))
  assert.equal(r.status, 400)
  assert.ok(!isDeferred(r))
  assert.equal(r.headers.get('x-supabase-api-version'), '2024-01-01')
  assert.deepEqual(await r.json(), body)
  assert.deepEqual(gate.get(), OPEN_GATE)
  assert.equal(done, false)
})

t('hors ligne : rien n’est envoyé ; autres adresses : passent telles quelles', async () => {
  const s = server([() => json(200, [])])
  const g = guardRefresh({ fetch: s.f, storedToken: () => 'r0', gate: memGate(), lock: queueLock(), online: () => false })
  assert.ok(isDeferred(await g(REFRESH_URL, refreshInit('r0'))))
  assert.equal(s.calls.length, 0)
  const r = await g('https://exemple.test/rest/v1/hb_players?select=id', { method: 'GET' })
  assert.equal(r.status, 200)
  assert.equal(s.calls.length, 1)
})

t('jamais deux renouvellements en même temps ; un jeton déjà remplacé n’est jamais envoyé', async () => {
  const store = new Mem()
  store.setItem('sb-exemple-auth-token', JSON.stringify(session('r0', 0)))
  let inFlight = 0
  let maxInFlight = 0
  const sent: string[] = []
  const f = (async (_i: RequestInfo | URL, init?: RequestInit) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    sent.push(tokenOf(init?.body) ?? '?')
    await new Promise((r) => setTimeout(r, 20))
    inFlight--
    // Le client enregistre la nouvelle session (comme auth-js après une réponse).
    store.setItem('sb-exemple-auth-token', JSON.stringify(session('r1', 0)))
    return json(200, session('r1', 0))
  }) as typeof fetch
  const lock = queueLock() // même verrou pour les deux « onglets » (Web Locks dans le navigateur)
  const gate = memGate()
  const tab = () => guardRefresh({ fetch: f, storedToken: () => storedRefreshToken(store), gate, lock, online: () => true })
  const [a, b] = await Promise.all([tab()(REFRESH_URL, refreshInit('r0')), tab()(REFRESH_URL, refreshInit('r0'))])
  assert.equal(maxInFlight, 1)
  assert.deepEqual(sent, ['r0'])
  assert.equal(a.status, 200)
  assert.ok(isDeferred(b)) // jeton r0 déjà remplacé par r1 : pas envoyé
  // Plus tard, un appel avec le jeton actuel part normalement.
  const c = await tab()(REFRESH_URL, refreshInit('r1'))
  assert.equal(c.status, 200)
  assert.deepEqual(sent, ['r0', 'r1'])
})

// ---------- Avec le vrai client de connexion (auth-js), horloge simulée ----------

/**
 * Horloge simulée pour auth-js : Date.now avance avec les attentes (setTimeout rendu immédiat, l'heure avancée d'autant).
 * Rendue à la fin de chaque essai.
 */
async function withFakeTime<T>(start: number, f: (clock: { now: () => number; advance: (ms: number) => void }) => Promise<T>): Promise<T> {
  const realNow = Date.now
  const realSetTimeout = globalThis.setTimeout
  let now = start
  Date.now = () => now
  globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    now += Math.max(0, ms ?? 0)
    return realSetTimeout(fn, 0, ...args)
  }) as typeof setTimeout
  // auth-js écrit ses erreurs dans la console (comme dans le navigateur) : coupé pendant l'essai.
  const realError = console.error
  console.error = () => {}
  try {
    return await f({ now: () => now, advance: (ms) => void (now += ms) })
  } finally {
    Date.now = realNow
    globalThis.setTimeout = realSetTimeout
    console.error = realError
  }
}

const KEY = 'sb-exemple-auth-token'
function authClient(storage: Mem, fetchImpl: typeof fetch) {
  return new GoTrueClient({
    url: AUTH,
    headers: { apikey: 'cle-publique-fictive' },
    storageKey: KEY,
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    fetch: fetchImpl,
  })
}

/** Serveur de connexion simulé : répond d'après `answer(n)` (n : numéro de l'envoi), compte les envois et leurs heures. */
function authServer(answer: (n: number, rt: string) => Response, now: () => number) {
  const sends: { at: number; rt: string }[] = []
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rt = tokenOf(init?.body) ?? '?'
    sends.push({ at: now(), rt })
    if (!String(input).includes('grant_type=refresh_token')) return json(404, { message: 'no route' })
    return answer(sends.length, rt)
  }) as typeof fetch
  return { f, sends }
}

const T0 = Date.parse('2026-10-31T07:52:35Z')
const expiredSession = () => JSON.stringify(session('r0', Math.floor(T0 / 1000) - 3600)) // jeton d'accès de la veille

t('témoin (sans protection) : une 429 du service de connexion EFFACE la session (supabase-js la prend pour un refus)', () =>
  withFakeTime(T0, async (clock) => {
    const storage = new Mem()
    storage.setItem(KEY, expiredSession())
    const srv = authServer(() => json(429, { code: 'over_request_rate_limit', msg: 'Request rate limit reached' }), clock.now)
    const c = authClient(storage, srv.f)
    const events: string[] = []
    c.onAuthStateChange((e) => void events.push(e))
    await c.initialize()
    assert.equal(storage.getItem(KEY), null)
    assert.ok(events.includes('SIGNED_OUT'))
  }))

t('témoin (sans protection) : une 500 garde la session, mais auth-js renvoie 8 demandes en 25 s, sans hasard', () =>
  withFakeTime(T0, async (clock) => {
    const storage = new Mem()
    storage.setItem(KEY, expiredSession())
    const srv = authServer(() => json(500, { code: 'unexpected_failure', msg: 'erreur' }), clock.now)
    const c = authClient(storage, srv.f)
    await c.initialize()
    assert.ok(storage.getItem(KEY))
    assert.ok(srv.sends.length >= 7, `${srv.sends.length} envois`)
    assert.ok(srv.sends[srv.sends.length - 1].at - srv.sends[0].at < 30_000)
  }))

function guarded(storage: Mem, srv: { f: typeof fetch }, clock: { now: () => number }, gate = memGate(), lock = queueLock()) {
  return guardRefresh({ fetch: srv.f, storedToken: () => storedRefreshToken(storage), gate, lock, now: clock.now, rnd: () => 0, online: () => true })
}

for (const [label, bad] of [
  ['500', () => json(500, { code: 'unexpected_failure', msg: 'dial tcp: cannot assign requested address' })],
  ['429', () => json(429, { code: 'over_request_rate_limit', msg: 'Request rate limit reached' }, { 'Retry-After': '1' })],
  ['délai / coupure', () => {
    throw new TypeError('Failed to fetch')
  }],
] as [string, () => Response][]) {
  t(`avec protection, erreur passagère (${label}) : session gardée, aucune déconnexion, appli hors ligne, envois espacés, puis reprise`, () =>
    withFakeTime(T0, async (clock) => {
      const storage = new Mem()
      storage.setItem(KEY, expiredSession())
      let up = false
      const srv = authServer((_n, rt) => (up ? json(200, session(rt === 'r0' ? 'r1' : 'r2', Math.floor(clock.now() / 1000) + 3600)) : bad()), clock.now)
      const c = authClient(storage, guarded(storage, srv, clock))
      const events: string[] = []
      c.onAuthStateChange((e) => void events.push(e))
      await c.initialize()
      // Session gardée sur l'appareil ; getSession : pas de session, erreur « rejouable » (AuthGate et la synchro passent hors ligne).
      assert.equal(JSON.parse(storage.getItem(KEY)!).refresh_token, 'r0')
      assert.ok(!events.includes('SIGNED_OUT'))
      const g = await c.getSession()
      assert.equal(g.data.session, null)
      assert.equal((g.error as { name?: string } | null)?.name, 'AuthRetryableFetchError')
      // Envois réels : bien moins que la rafale d'auth-js, jamais à moins de 2 s d'intervalle.
      const gaps = srv.sends.slice(1).map((s, i) => s.at - srv.sends[i].at)
      assert.ok(srv.sends.length <= 4, `${srv.sends.length} envois : ${gaps}`)
      assert.ok(gaps.every((d) => d >= 2000), `${gaps}`)
      // Le serveur revient : l'essai suivant (après le délai de refroidissement d'auth-js) renouvelle la session.
      up = true
      clock.advance(REFRESH_STEADY_MS * 2)
      const back = await c.getSession()
      assert.equal(back.data.session?.refresh_token, 'r1')
      assert.equal(JSON.parse(storage.getItem(KEY)!).refresh_token, 'r1')
      assert.ok(events.includes('TOKEN_REFRESHED'))
      assert.ok(!events.includes('SIGNED_OUT'))
    }))
}

t('avec protection, refus définitif (jeton introuvable) : session effacée, déconnexion (retour à la connexion)', () =>
  withFakeTime(T0, async (clock) => {
    const storage = new Mem()
    storage.setItem(KEY, expiredSession())
    const srv = authServer(
      () => json(400, { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }, { 'x-supabase-api-version': '2024-01-01' }),
      clock.now,
    )
    const c = authClient(storage, guarded(storage, srv, clock))
    const events: string[] = []
    c.onAuthStateChange((e) => void events.push(e))
    await c.initialize()
    assert.equal(storage.getItem(KEY), null)
    assert.ok(events.includes('SIGNED_OUT'))
    assert.equal(srv.sends.length, 1)
  }))

t('avec protection, deux onglets au réveil (même stockage, même verrou) : un seul renouvellement envoyé, jamais l’ancien jeton deux fois', () =>
  withFakeTime(T0, async (clock) => {
    const storage = new Mem()
    storage.setItem(KEY, expiredSession())
    const srv = authServer((_n, rt) => (rt === 'r0' ? json(200, session('r1', Math.floor(clock.now() / 1000) + 3600)) : json(400, { code: 'refresh_token_already_used', msg: 'x' })), clock.now)
    const gate = memGate()
    const lock = queueLock()
    const a = authClient(storage, guarded(storage, srv, clock, gate, lock))
    const b = authClient(storage, guarded(storage, srv, clock, gate, lock))
    await Promise.all([a.initialize(), b.initialize()])
    await Promise.all([a.getSession(), b.getSession()])
    assert.deepEqual(srv.sends.map((s) => s.rt), ['r0'])
    // L'onglet dont la demande n'est pas partie relit la session renouvelée dans le stockage.
    const [sa, sb] = await Promise.all([a.getSession(), b.getSession()])
    assert.equal(sa.data.session?.refresh_token, 'r1')
    assert.equal(sb.data.session?.refresh_token, 'r1')
    assert.deepEqual(srv.sends.map((s) => s.rt), ['r0'])
  }))

t('src/sync.ts branche la protection dans le fetch de supabase-js (connexion comprise)', () => {
  const src = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  assert.match(src, /guardRefresh\(\{\s*fetch: restFetch/)
  assert.match(src, /createClient\(url, key, \{ global: \{ fetch: authFetch \} \}\)/)
  assert.match(src, /lock: webLock\(\)/)
})

chain.then(
  () => console.log(`\n${n} essais réussis.`),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
