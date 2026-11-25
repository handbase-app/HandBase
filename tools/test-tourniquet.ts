// Test de l'ouverture équitable (« tourniquet ») : attente croissante avec hasard et Retry-After (src/retry.ts), requêtes
// rejouées telles quelles (même curseur, même page : la synchronisation reprend où elle en était, jamais depuis zéro), ce qui
// est rejoué ou pas (503/429 toujours ; délai et coupure seulement pour les lectures et les écritures « la plus récente
// gagne » ; hors ligne, annulation, autres adresses : jamais), abandon au bout de RETRY_MAX ; ordre de lecture (le périmètre
// du compte d'abord, src/syncLive.ts PULL_ORDER) et entrée dans l'appli dès la première page de joueurs (src/splash.ts), sans
// casser le premier lancement hors ligne. Données fictives seulement.
//
//   npx jiti tools/test-tourniquet.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  backoffMs,
  IDEMPOTENT_RPC,
  refusedResponse,
  replayable,
  RETRY_AFTER_MAX_MS,
  RETRY_CAP_MS,
  RETRY_MAX,
  retryableStatus,
  retryAfterMs,
  retryDelay,
  retryingFetch,
} from '../src/retry'
import { PULL_ORDER, readScopedPages, type ScopedRequest } from '../src/syncLive'
import { MIN_MS, splashDecision, type SplashInput } from '../src/splash'
import { showProgress } from '../src/syncProgress'

let n = 0
let chain: Promise<void> = Promise.resolve()
const t = (name: string, f: () => void | Promise<void>) => {
  chain = chain.then(async () => {
    await f()
    n++
    console.log(`ok ${n} - ${name}`)
  })
}

const REST = 'https://exemple.test/rest/v1'

// ---------- Attente ----------

t('attente croissante : 1, 2, 4, 8, 16 s puis 30 s (plafond), un peu de hasard en plus', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map((a) => backoffMs(a, () => 0)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  // Hasard : jusqu'à +50 %, jamais au-delà du plafond.
  assert.deepEqual([0, 1, 2, 3, 4].map((a) => backoffMs(a, () => 1)), [1500, 3000, 6000, 12000, 24000])
  assert.equal(backoffMs(5, () => 1), RETRY_CAP_MS)
  for (let a = 0; a < 12; a++) {
    const d = backoffMs(a)
    assert.ok(d >= Math.min(RETRY_CAP_MS, 1000 * 2 ** a) && d <= RETRY_CAP_MS, `tentative ${a} : ${d} ms`)
  }
  // Total au pire avant abandon : environ 1 min 30 (le serveur a le temps de se vider, l'appareil ne reste pas bloqué).
  const total = Array.from({ length: RETRY_MAX }, (_, a) => backoffMs(a, () => 1)).reduce((x, y) => x + y, 0)
  assert.ok(total > 60_000 && total < 150_000, `${total} ms`)
})

t('Retry-After : secondes ou date HTTP, au moins cela (plafonné), plus jusqu’à 1 s de hasard', () => {
  assert.equal(retryAfterMs('3'), 3000)
  assert.equal(retryAfterMs(' 0.5 '), 500)
  assert.equal(retryAfterMs('0'), 0)
  const now = Date.parse('2026-10-30T10:00:00Z')
  assert.equal(retryAfterMs('Fri, 30 Oct 2026 10:00:07 GMT', now), 7000)
  assert.equal(retryAfterMs('Fri, 30 Oct 2026 09:59:00 GMT', now), 0, 'date passée : tout de suite')
  assert.equal(retryAfterMs('100000'), RETRY_AFTER_MAX_MS, 'valeur aberrante plafonnée')
  assert.equal(retryAfterMs('demain'), null)
  assert.equal(retryAfterMs(null), null)
  assert.equal(retryAfterMs(''), null)
  // Avec Retry-After : au moins sa valeur, plus le hasard ; jamais moins que l'attente croissante (Envoy renvoie toujours
  // 2 s : si le serveur reste plein, l'attente grandit quand même).
  assert.equal(retryDelay(0, '2', () => 0), 2000)
  assert.equal(retryDelay(0, '2', () => 1), 3000)
  assert.equal(retryDelay(4, '2', () => 0), 16_000)
  assert.equal(retryDelay(0, '10', () => 0.5), 10_500)
  // Sans : l'attente croissante.
  assert.equal(retryDelay(2, null, () => 0), 4000)
})

// ---------- Ce qui est rejoué ----------

t('rejouées : 429 et refus explicites toujours ; délai, coupure, autre 503 pour les lectures et écritures « la plus récente gagne »', () => {
  assert.equal(retryableStatus(429, false), true)
  assert.equal(retryableStatus(503, false, true), true, '503 avec Retry-After ou x-envoy-overloaded : pas transmise')
  assert.equal(retryableStatus(503, true), true)
  assert.equal(retryableStatus(503, false), false, '503 sans refus explicite sur une écriture unique : peut-être traitée')
  assert.equal(refusedResponse(new Headers({ 'Retry-After': '3' })), true)
  assert.equal(refusedResponse(new Headers({ 'x-envoy-overloaded': 'true' })), true)
  assert.equal(refusedResponse(new Headers()), false)
  assert.equal(retryableStatus(504, true), true)
  assert.equal(retryableStatus(408, true), true)
  assert.equal(retryableStatus(504, false), false, 'délai dépassé sur une écriture non rejouable : on ne sait pas si elle est passée')
  for (const s of [200, 400, 401, 403, 404, 409, 500, 502]) assert.equal(retryableStatus(s, true), false, String(s))
  assert.equal(replayable('GET', `${REST}/hb_players?select=*`), true)
  assert.equal(replayable('HEAD', `${REST}/hb_players`), true)
  assert.equal(replayable(undefined, `${REST}/hb_players`), true)
  for (const f of ['hb_upsert', 'hb_upsert_lignes', 'hb_quoi_de_neuf', 'hb_lire_perimetre', 'hb_mes_canaux', 'hb_my_perimeter', 'hb_ping']) {
    assert.ok(IDEMPOTENT_RPC.includes(f))
    assert.equal(replayable('POST', `${REST}/rpc/${f}`), true, f)
  }
  // Une action unique (code d'invitation utilisé, journal « voir comme »…) n'est pas rejouée après une coupure.
  assert.equal(replayable('POST', `${REST}/rpc/hb_claim_invite`), false)
  assert.equal(replayable('POST', `${REST}/rpc/hb_log_view_as`), false)
  assert.equal(replayable('POST', `${REST}/hb_players`), false)
  assert.equal(replayable('PATCH', `${REST}/hb_players?id=eq.x`), false)
})

// ---------- fetch qui rejoue ----------

type Step = number | 'réseau' | { status: number; retryAfter?: string }
function fakeNet(steps: Step[]) {
  const urls: string[] = []
  const f = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    const s = steps.shift() ?? 200
    if (s === 'réseau') throw new TypeError('Failed to fetch')
    const status = typeof s === 'number' ? s : s.status
    const headers = typeof s === 'object' && s.retryAfter ? { 'Retry-After': s.retryAfter } : undefined
    return new Response(status === 204 ? null : JSON.stringify({ ok: status }), { status, headers })
  }) as typeof fetch
  return { f, urls }
}
const quick = (extra: { sleeps?: number[]; online?: () => boolean } = {}) => ({
  sleep: async (ms: number) => void extra.sleeps?.push(ms),
  rnd: () => 0,
  online: extra.online ?? (() => true),
  timeoutMs: 0,
})

t('fetch qui rejoue : 503 (Retry-After), coupure, 429, puis la réponse ; même requête à chaque fois', async () => {
  const net = fakeNet([{ status: 503, retryAfter: '2' }, 'réseau', 429, 200])
  const sleeps: number[] = []
  const waits: [number, number, string][] = []
  let done: [number, boolean] | null = null
  const f = retryingFetch({ fetch: net.f, ...quick({ sleeps }), onWait: (a, ms, c) => void waits.push([a, ms, c]), onDone: (r, ok) => void (done = [r, ok]) })
  const url = `${REST}/hb_measurements?select=id,data,server_updated_at&server_updated_at=gte.2026-10-30T08:00:00Z&limit=1000`
  const res = await f(url, { method: 'GET' })
  assert.equal(res.status, 200)
  assert.deepEqual(net.urls, [url, url, url, url], 'la même page, le même curseur, quatre fois')
  assert.deepEqual(sleeps, [2000, 2000, 4000], 'Retry-After 2 s, puis 2 s, 4 s (attente croissante)')
  assert.deepEqual(waits.map((w) => w[2]), ['503', 'réseau', '429'])
  assert.deepEqual(done, [3, true])
})

t('fetch qui rejoue : autres adresses (connexion, stockage) telles quelles ; écriture unique pas rejouée après coupure', async () => {
  const auth = fakeNet([503])
  const res = await retryingFetch({ fetch: auth.f, ...quick() })('https://exemple.test/auth/v1/token?grant_type=refresh_token', { method: 'POST' })
  assert.equal(res.status, 503)
  assert.equal(auth.urls.length, 1, 'la connexion n’est pas rejouée ici (supabase-js gère ses propres reprises)')
  const claim = fakeNet(['réseau'])
  await assert.rejects(retryingFetch({ fetch: claim.f, ...quick() })(`${REST}/rpc/hb_claim_invite`, { method: 'POST', body: '{}' }), TypeError)
  assert.equal(claim.urls.length, 1)
  // Mais un refus explicite (503 avec Retry-After : requête pas transmise) est rejoué même pour elle ; un 503 sans refus
  // explicite (reset en route, peut-être traitée), non.
  const claim503 = fakeNet([{ status: 503, retryAfter: '1' }, 200])
  assert.equal((await retryingFetch({ fetch: claim503.f, ...quick() })(`${REST}/rpc/hb_claim_invite`, { method: 'POST', body: '{}' })).status, 200)
  assert.equal(claim503.urls.length, 2)
  const reset = fakeNet([503, 200])
  assert.equal((await retryingFetch({ fetch: reset.f, ...quick() })(`${REST}/rpc/hb_claim_invite`, { method: 'POST', body: '{}' })).status, 503)
  assert.equal(reset.urls.length, 1)
  // Écriture « la plus récente gagne » : rejouée après une coupure, même corps.
  const up = fakeNet(['réseau', 200])
  const bodies: unknown[] = []
  const spy = (async (i: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(init?.body)
    return up.f(i, init)
  }) as typeof fetch
  await retryingFetch({ fetch: spy, ...quick() })(`${REST}/rpc/hb_upsert_lignes`, { method: 'POST', body: '{"p_table":"seen"}' })
  assert.deepEqual(bodies, ['{"p_table":"seen"}', '{"p_table":"seen"}'])
  // Erreurs « normales » (droits, requête invalide, erreur interne) : rendues tout de suite, comme avant.
  for (const s of [400, 401, 403, 404, 500]) {
    const e = fakeNet([s])
    assert.equal((await retryingFetch({ fetch: e.f, ...quick() })(`${REST}/hb_players`)).status, s)
    assert.equal(e.urls.length, 1)
  }
})

t('fetch qui rejoue : abandon après RETRY_MAX nouvelles tentatives ; hors ligne et annulation : jamais', async () => {
  const always = fakeNet(Array.from({ length: 50 }, () => 503))
  const sleeps: number[] = []
  const res = await retryingFetch({ fetch: always.f, ...quick({ sleeps }) })(`${REST}/hb_players`)
  assert.equal(res.status, 503, 'la dernière réponse remonte (la synchronisation échoue comme avant, curseur gardé)')
  assert.equal(always.urls.length, RETRY_MAX + 1)
  assert.deepEqual(sleeps, [1000, 2000, 4000, 8000, 16000, 30000, 30000])
  const cut = fakeNet(Array.from({ length: 50 }, () => 'réseau' as const))
  await assert.rejects(retryingFetch({ fetch: cut.f, ...quick() })(`${REST}/hb_players`), TypeError)
  assert.equal(cut.urls.length, RETRY_MAX + 1)
  // Hors ligne : l'appli passe « hors ligne » comme avant, rien n'est rejoué.
  const off = fakeNet(['réseau', 200])
  await assert.rejects(retryingFetch({ fetch: off.f, ...quick({ online: () => false }) })(`${REST}/hb_players`), TypeError)
  assert.equal(off.urls.length, 1)
  // Annulée par l'appelant : rien n'est rejoué.
  const ctl = new AbortController()
  ctl.abort()
  const ab = fakeNet([503, 200])
  assert.equal((await retryingFetch({ fetch: ab.f, ...quick() })(`${REST}/hb_players`, { signal: ctl.signal })).status, 503)
  assert.equal(ab.urls.length, 1)
})

t('fetch qui rejoue : délai dépassé (pas de réponse) → abandonnée puis rejouée', async () => {
  let calls = 0
  const slow = ((_i: RequestInfo | URL, init?: RequestInit) => {
    calls++
    if (calls === 1) {
      // Ne répond jamais : seule l'annulation (délai) la termine.
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
    }
    return Promise.resolve(new Response('[]', { status: 200 }))
  }) as typeof fetch
  const causes: string[] = []
  const f = retryingFetch({ fetch: slow, sleep: async () => {}, rnd: () => 0, online: () => true, timeoutMs: 30, onWait: (_a, _ms, c) => void causes.push(c) })
  const res = await f(`${REST}/rpc/hb_lire_perimetre`, { method: 'POST', body: '{}' })
  assert.equal(res.status, 200)
  assert.equal(calls, 2)
  assert.deepEqual(causes, ['délai'])
})

// ---------- Reprise au curseur ----------

t('reprise au curseur : une page refusée (503) est redemandée au même curseur, jamais depuis le début', async () => {
  // Serveur fictif derrière une adresse PostgREST : la page est décrite par l'adresse (curseur, ou repère de l'ancien filtre).
  const heures = Array.from({ length: 3500 }, (_, i) => Math.floor(i / 3))
  const at = (s: number) => `2026-10-30T08:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.000000+00:00`
  const rows = heures.map((h, i) => ({ id: `r${String(i).padStart(6, '0')}`, server_updated_at: at(h), data: { id: `r${i}` } }))
  const asked: string[] = []
  let refusals = 0
  const server = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const since = url.searchParams.get('since')!
    asked.push(since)
    // La 2e et la 3e page sont refusées deux fois chacune (serveur plein), avec Retry-After : 1 s.
    const page = asked.filter((s) => s === since).length
    if (since !== asked[0] && page <= 2) {
      refusals++
      return new Response('{"message":"upstream overflow"}', { status: 503, headers: { 'Retry-After': '1' } })
    }
    const body = rows.filter((r) => r.server_updated_at >= since).slice(0, 1000)
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
  const sleeps: number[] = []
  const f = retryingFetch({ fetch: server, ...quick({ sleeps }) })
  const got: string[] = []
  const received = await readScopedPages(
    '1970-01-01T00:00:00Z',
    async (req: ScopedRequest) => {
      if (!('since' in req)) throw new Error('pas d’ancien filtre ici')
      const res = await f(`${REST}/rpc/hb_lire_perimetre?since=${encodeURIComponent(req.since)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as typeof rows
    },
    (page) => void got.push(...page.map((r) => r.id)),
  )
  assert.equal(received, 3500)
  assert.deepEqual(got, rows.map((r) => r.id), 'toutes les lignes, une fois, dans l’ordre')
  assert.equal(refusals, 6, '3 pages refusées 2 fois chacune')
  assert.equal(asked.filter((s) => s === '1970-01-01T00:00:00Z').length, 1, 'jamais redemandé depuis le début')
  // Chaque refus est suivi de la MÊME demande (même curseur).
  const distinct = [...new Set(asked)]
  assert.deepEqual(asked, distinct.flatMap((s, i) => (i === 0 ? [s] : [s, s, s])), 'chaque page : refusée, refusée, servie')
  assert.ok(sleeps.length === 6 && sleeps.every((ms) => ms >= 1000), 'Retry-After respecté (et attente croissante)')
  // Le source branche bien ce fetch sur le client de la base, et enregistre le curseur page après page.
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  // (Le fetch du client encadre aussi le renouvellement du jeton, src/authRefresh.ts : restFetch en dessous.)
  // (Session gardée dans IndexedDB depuis le push de la veille, src/sessionStore.ts : option auth.storage.)
  assert.ok(sync.includes('createClient(url, key, { global: { fetch: authFetch }, auth: { storage: authStorage, storageKey: authStorageKey } })'))
  assert.match(sync, /guardRefresh\(\{\s*fetch: restFetch/)
  assert.ok(sync.includes('localStorage.setItem(PULL_KEY(table), last.server_updated_at)'))
})

// ---------- Le périmètre d'abord, et l'appli ouverte dès les premiers joueurs ----------

t('ordre de lecture : réglages et structure, puis le périmètre du compte, puis le reste', () => {
  const db = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8')
  const SYNC_TABLES = [...db.match(/export const SYNC_TABLES = \[([^\]]+)\]/)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  assert.deepEqual([...PULL_ORDER].sort(), [...SYNC_TABLES].sort(), 'toutes les tables, une fois')
  assert.equal(new Set(PULL_ORDER).size, PULL_ORDER.length)
  const at = (x: string) => PULL_ORDER.indexOf(x as never)
  for (const small of ['config', 'criteria', 'lists', 'levels', 'units', 'assignments']) assert.ok(at(small) < at('players'), `${small} avant les joueurs`)
  assert.deepEqual(PULL_ORDER.slice(at('players'), at('players') + 4), ['players', 'measurements', 'evaluations', 'seen'])
  // Contraintes de pull (src/sync.ts) : les staffs avant les groupes, les groupes avant « à revoir ».
  assert.ok(at('teams') < at('groups') && at('groups') < at('rewatch'))
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  assert.ok(sync.includes('for (const table of PULL_ORDER) {'))
})

t('premier chargement : on entre dès la première page de joueurs (à la fin de l’animation), sans casser le hors-ligne', () => {
  const at = (elapsed: number, o: Partial<SplashInput> = {}) => splashDecision({ elapsed, lastActivity: elapsed, sync: 'pending', firstLoad: true, ...o })
  // Joueurs pas encore reçus : on reste (comme avant), même longtemps.
  assert.equal(at(MIN_MS).enter, false)
  assert.equal(at(9000).enter, false)
  // Joueurs reçus : on entre, au plus tôt à la fin de l'animation ; la pastille clignote (la synchro continue derrière).
  assert.equal(at(MIN_MS - 1, { playersReady: true }).enter, false)
  assert.deepEqual(at(MIN_MS, { playersReady: true }), { enter: true, button: false, pulse: true, skippable: false })
  assert.equal(at(20_000, { playersReady: true }).enter, true)
  // Premier lancement hors ligne (ou synchro impossible) : on entre sur ce qu'a l'appareil, comme avant.
  assert.equal(at(MIN_MS, { sync: 'none' }).enter, true)
  assert.equal(at(MIN_MS, { sync: 'none', playersReady: false }).enter, true)
  // Pas connecté : l'écran de connexion, comme avant.
  assert.equal(at(2000, { sync: 'login' }).enter, true)
  // Lancement ordinaire (appareil déjà servi) : règles inchangées.
  assert.equal(splashDecision({ elapsed: MIN_MS, lastActivity: MIN_MS, sync: 'pending', firstLoad: false, playersReady: true }).enter, false)
  // La barre discrète sous l'en-tête se montre dès le premier élément au premier chargement.
  assert.equal(showProgress({ table: 'measurements', done: 1, share: 0.4, first: true }), true)
  // L'écran d'ouverture lit bien l'état « joueurs reçus » de la synchro.
  const screen = readFileSync(new URL('../src/splashScreen.ts', import.meta.url), 'utf8')
  assert.ok(screen.includes('playersReady })'))
})

chain.then(
  () => console.log(`\n${n} tests réussis.`),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
