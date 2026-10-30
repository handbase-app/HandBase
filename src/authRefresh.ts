/*
 * RENOUVELLEMENT DU JETON SANS PERDRE LA SESSION (série 8 du 30/10, « jour J ») : à 20 000 appareils, 12,8 % des
 * renouvellements (POST /auth/v1/token?grant_type=refresh_token) ont reçu une erreur 500 du service de connexion (GoTrue à
 * court de ports vers la base). Ce fichier encadre CE SEUL appel, dans le fetch donné à supabase-js (src/sync.ts).
 *
 * CE QUE FAIT supabase-js (auth-js 2.109, lu dans node_modules) :
 *  - 500, 501, 502, 503, 504, 520-530 et coupure réseau : erreur « rejouable » (AuthRetryableFetchError) : la session est
 *    gardée sur l'appareil, getSession() rend « pas de session » avec cette erreur, AuthGate passe hors ligne avec la session
 *    gardée (src/components/AuthGate.tsx), la synchronisation passe « hors ligne » (src/sync.ts, runOnce) ;
 *  - TOUT LE RESTE est un refus définitif : 429 (trop de demandes), 408, une page d'erreur d'un intermédiaire (404 « no
 *    route »…), une réponse 200 tronquée qui n'est pas une session. Si le jeton d'accès a expiré (cas du matin : 1 h), la
 *    session est EFFACÉE (SIGNED_OUT) : la personne retape son mot de passe (bcrypt : ce qui coûte le plus au serveur) ;
 *  - après une erreur rejouable, auth-js réessaie tout de suite : 200 ms, 400 ms, 800 ms… jusqu'à 8 envois en 25 s, sans
 *    hasard ni Retry-After, puis encore toutes les 60 s : à 20 000 appareils, une rafale de plus sur un serveur déjà plein ;
 *  - depuis 2.10x, AUCUN verrou entre onglets par défaut (« lockless ») : deux onglets peuvent envoyer le même jeton de
 *    renouvellement en même temps, et un onglet en retard peut envoyer un jeton déjà remplacé.
 *
 * CE QUE FAIT GoTrue (v2.197, internal/tokens/service.go) d'un jeton de renouvellement déjà utilisé : le jeton qui précède
 * IMMÉDIATEMENT le jeton actif (réponse perdue par l'appareil) est toujours accepté et rend le jeton actif ; un jeton plus
 * ancien n'est accepté que dans l'intervalle de réutilisation (GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL, 10 s par
 * défaut) ; au-delà, « refresh_token_already_used » ET, rotation active (défaut), toute la session est fermée (format v2,
 * compteur) ou toute la famille de jetons révoquée (format v1) : tous les appareils du compte sont déconnectés.
 *
 * DONC, pour CE SEUL appel (les autres passent tels quels) :
 *  1. Erreur passagère (500, 501-504, 520-530, 429, 408, délai dépassé, coupure, réponse 200 qui n'est pas une session, page
 *     d'erreur sans code d'erreur de GoTrue) : l'appareil répond lui-même à auth-js par une 503 « différé » : auth-js garde
 *     la session (erreur rejouable) ; l'appli travaille hors ligne, les saisies vont dans la file d'envoi comme sans réseau.
 *  2. Rythme : après un échec, aucun envoi avant l'attente suivante : 2, 4, 8, 16, 30 s puis 60 s, chacune allongée au
 *     hasard de 0 à 25 %, au moins Retry-After (plafonné à 5 min) plus jusqu'à 1 s de hasard. Les rafales d'auth-js
 *     (200 ms, 400 ms…) reçoivent la 503 « différé » sur l'appareil, sans rien envoyer. Le repère (échecs, prochaine heure)
 *     est gardé dans le stockage local : tous les onglets le respectent.
 *  3. Refus définitif de GoTrue (400, 401, 403, 404 avec un code d'erreur : refresh_token_not_found,
 *     refresh_token_already_used, session_not_found, session_expired, invalid_grant…) : la réponse passe telle quelle,
 *     auth-js efface la session, retour à la connexion. Succès : la réponse passe, repère remis à zéro.
 *  4. Jamais deux renouvellements en même temps : un verrou (Web Locks, commun aux onglets du site ; à défaut, une file dans
 *     l'onglet) entoure l'envoi ; dans le verrou, si le stockage tient déjà un AUTRE jeton de renouvellement (un autre onglet,
 *     ou un appel précédent, vient de renouveler ; ou le jeton envoyé est celui que le dernier renouvellement réussi a remplacé :
 *     empreinte gardée dans le repère), le jeton de cette demande est périmé : il n'est PAS envoyé (il pourrait être
 *     « plus ancien que le précédent » et fermer la session), l'appareil répond 503 « différé » ; la session renouvelée est
 *     relue dans le stockage à l'appel suivant (et annoncée par auth-js aux autres onglets). Une demande n'est jamais
 *     rejouée par ce fichier : un envoi par passage dans le verrou, avec le jeton du stockage ; si la réponse s'est perdue
 *     alors que GoTrue avait renouvelé, l'envoi suivant porte le jeton qui précède immédiatement l'actif : accepté.
 * Fonctions pures et injectables (horloge, hasard, verrou, stockage, fetch) : testées par tools/test-renouvellement.ts.
 */

/** Attentes après 1, 2, 3, 4, 5 échecs de suite ; ensuite REFRESH_STEADY_MS. */
export const REFRESH_STEPS_MS: readonly number[] = [2000, 4000, 8000, 16_000, 30_000]
/** Attente une fois les premières passées (serveur durablement indisponible). */
export const REFRESH_STEADY_MS = 60_000
/** Hasard ajouté : jusqu'à cette part de l'attente. */
export const REFRESH_JITTER = 0.25
/** Retry-After plus long que cela : ramené à cela. */
export const REFRESH_AFTER_MAX_MS = 5 * 60_000
/** Un renouvellement sans réponse au bout de ce délai est abandonné (erreur passagère). */
export const REFRESH_TIMEOUT_MS = 15_000
/** Repère partagé par les onglets (stockage local ; effacé avec les autres réglages handbase.* à la déconnexion). */
export const REFRESH_GATE_KEY = 'handbase.renouvellement'
/** Nom du verrou Web Locks. */
export const REFRESH_LOCK = 'handbase-renouvellement'
/** Code de la réponse fabriquée sur l'appareil (jamais envoyée par le serveur). */
export const DEFERRED_CODE = 'hb_renouvellement_differe'

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)

/** Attente avant le prochain envoi après `failures` échecs de suite (≥ 1), Retry-After compris. */
export function refreshDelay(failures: number, retryAfter: string | null | undefined, rnd: () => number = Math.random, now: number = Date.now()): number {
  const i = Math.max(1, Math.floor(failures)) - 1
  const base = i < REFRESH_STEPS_MS.length ? REFRESH_STEPS_MS[i] : REFRESH_STEADY_MS
  const backoff = Math.round(base * (1 + REFRESH_JITTER * clamp01(rnd())))
  const after = retryAfterMsOf(retryAfter, now)
  return after === null ? backoff : Math.max(backoff, after + Math.round(1000 * clamp01(rnd())))
}

/** En-tête Retry-After (secondes, ou date HTTP) en millisecondes, plafonné ; null : absent ou illisible. */
export function retryAfterMsOf(header: string | null | undefined, now: number = Date.now()): number | null {
  if (!header) return null
  const s = header.trim()
  if (/^\d+(\.\d+)?$/.test(s)) return Math.min(REFRESH_AFTER_MAX_MS, Math.round(Number(s) * 1000))
  const at = Date.parse(s)
  if (Number.isNaN(at)) return null
  return Math.min(REFRESH_AFTER_MAX_MS, Math.max(0, at - now))
}

/** La requête est-elle un renouvellement de jeton (POST …/auth/v1/token?grant_type=refresh_token) ? */
export function isRefreshRequest(url: string, method: string | undefined): boolean {
  return (method ?? 'GET').toUpperCase() === 'POST' && /\/auth\/v1\/token(\?|$)/.test(url) && /[?&]grant_type=refresh_token(&|$)/.test(url)
}

export type RefreshVerdict = 'ok' | 'transient' | 'definitive'

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Que faire de la réponse ? ok : une session (2xx avec jetons) ; definitive : refus de GoTrue (400, 401, 403, 404 avec un code
 * d'erreur JSON : error_code, code, error, msg ou error_description) ; transient : tout le reste (5xx, 429, 408, réponse
 * tronquée, page d'erreur d'un intermédiaire sans code de GoTrue).
 */
export function classifyRefresh(status: number, body: string): RefreshVerdict {
  const j = parse(body) as Record<string, unknown> | undefined
  const obj = !!j && typeof j === 'object' && !Array.isArray(j)
  if (status >= 200 && status < 300) return obj && typeof j.access_token === 'string' && typeof j.refresh_token === 'string' ? 'ok' : 'transient'
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    const coded =
      obj &&
      (typeof j.error_code === 'string' ||
        typeof j.code === 'string' ||
        typeof j.code === 'number' ||
        typeof j.error === 'string' ||
        typeof j.msg === 'string' ||
        typeof j.error_description === 'string')
    return coded ? 'definitive' : 'transient'
  }
  return 'transient'
}

/** Jeton de renouvellement d'un corps de requête (texte JSON de supabase-js) ; null : illisible. */
export function tokenOf(body: unknown): string | null {
  if (typeof body !== 'string') return null
  const j = parse(body) as { refresh_token?: unknown } | undefined
  return j && typeof j.refresh_token === 'string' ? j.refresh_token : null
}

/** Jeton de renouvellement de la session gardée par supabase-js (clé sb-…-auth-token) ; null : aucune. */
export function storedRefreshToken(storage: Pick<Storage, 'getItem' | 'length' | 'key'> | null | undefined): string | null {
  if (!storage) return null
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue
      const s = parse(storage.getItem(k) ?? 'null') as { refresh_token?: unknown } | null | undefined
      if (s && typeof s.refresh_token === 'string') return s.refresh_token
    }
  } catch {
    /* stockage illisible */
  }
  return null
}

/**
 * Repère : échecs de suite, heure avant laquelle rien n'est envoyé ; used : empreinte du dernier jeton renouvelé avec succès
 * (auth-js n'enregistre la nouvelle session qu'APRÈS la réponse, hors du verrou : un autre onglet qui entre dans le verrou à ce
 * moment lit encore l'ancien jeton dans le stockage ; l'empreinte l'arrête). Empreinte courte (FNV-1a), jamais le jeton.
 */
export interface RefreshGate {
  n: number
  at: number
  used?: string
}
export const OPEN_GATE: RefreshGate = { n: 0, at: 0 }

export function readGate(text: string | null): RefreshGate {
  const g = parse(text ?? '') as Partial<RefreshGate> | undefined
  if (!g || typeof g !== 'object' || typeof g.n !== 'number' || typeof g.at !== 'number' || !Number.isFinite(g.n) || !Number.isFinite(g.at)) return OPEN_GATE
  const out: RefreshGate = { n: Math.max(0, Math.floor(g.n)), at: g.at }
  if (typeof g.used === 'string') out.used = g.used
  return out
}

/** Empreinte courte d'un jeton (FNV-1a 32 bits, en hexadécimal) : reconnaître un jeton déjà renouvelé sans le garder. */
export function tokenMark(token: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Repère gardé dans un stockage (localStorage : partagé par les onglets). */
export function storedGate(storage: { get: (k: string) => string | null; set: (k: string, v: string) => void }, key = REFRESH_GATE_KEY) {
  return {
    get: () => readGate(storage.get(key)),
    set: (g: RefreshGate) => storage.set(key, JSON.stringify(g)),
  }
}

type Lock = <T>(fn: () => Promise<T>) => Promise<T>

/** File dans l'onglet (navigateur sans Web Locks, tests). */
export function queueLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(fn: () => Promise<T>) => {
    const run = tail.then(fn, fn)
    tail = run.catch(() => {})
    return run
  }
}

/** Verrou commun aux onglets du site (Web Locks) ; à défaut, une file dans l'onglet. */
export function webLock(name = REFRESH_LOCK): Lock {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
  if (!locks?.request) return queueLock()
  return <T>(fn: () => Promise<T>) => locks.request(name, fn) as Promise<T>
}

export interface RefreshGuardOptions {
  /** fetch sous-jacent (src/retry.ts : il laisse passer ce qui n'est pas /rest/v1/). */
  fetch: typeof fetch
  /** Jeton de renouvellement actuellement gardé (stockage partagé par les onglets). */
  storedToken: () => string | null
  gate: { get: () => RefreshGate; set: (g: RefreshGate) => void }
  lock?: Lock
  now?: () => number
  rnd?: () => number
  online?: () => boolean
  timeoutMs?: number
  /** Prévenu après un échec passager : heure du prochain essai possible, cause. */
  onWait?: (until: number, cause: string) => void
  /** Prévenu quand le renouvellement aboutit (ou est refusé pour de bon) après au moins un échec. */
  onDone?: (ok: boolean) => void
}

const NULL_BODY = [101, 204, 205, 304]

/** Réponse fabriquée sur l'appareil : 503, qu'auth-js traite en erreur rejouable (session gardée). */
export const deferredResponse = (cause: string) =>
  new Response(JSON.stringify({ code: DEFERRED_CODE, message: `Renouvellement différé (${cause})` }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'x-hb-local': '1' },
  })

export const isDeferred = (r: Response) => r.headers.get('x-hb-local') === '1'

const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

/** Une tentative, abandonnée au bout de timeoutMs (TimeoutError). */
async function attempt(f: typeof fetch, input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  if (!(timeoutMs > 0) || typeof AbortController === 'undefined') return f(input, init)
  const ctl = new AbortController()
  let timedOut = false
  const t = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, timeoutMs)
  try {
    return await f(input, { ...init, signal: ctl.signal })
  } catch (e) {
    if (timedOut) throw Object.assign(new Error('Délai dépassé'), { name: 'TimeoutError' })
    throw e
  } finally {
    clearTimeout(t)
  }
}

/** fetch qui encadre le renouvellement du jeton (voir l'en-tête du fichier) ; le reste passe tel quel. */
export function guardRefresh(opts: RefreshGuardOptions): typeof fetch {
  const lock = opts.lock ?? webLock()
  const now = opts.now ?? Date.now
  const rnd = opts.rnd ?? Math.random
  const online = opts.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const timeoutMs = opts.timeoutMs ?? REFRESH_TIMEOUT_MS
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : undefined)
    if (!isRefreshRequest(urlOf(input), method)) return opts.fetch(input, init)
    // Hors ligne, ou attente en cours (rafale d'auth-js, autre onglet) : rien n'est envoyé.
    if (!online()) return deferredResponse('hors ligne')
    if (opts.gate.get().at > now()) return deferredResponse('attente')
    return lock(async () => {
      const g = opts.gate.get()
      if (g.at > now()) return deferredResponse('attente')
      // Jeton périmé : renouvelé entre-temps par un autre onglet ou un autre appel (rotation) : surtout ne pas l'envoyer.
      const sent = tokenOf(init?.body)
      const stored = opts.storedToken()
      if ((stored && sent && stored !== sent) || (sent && g.used === tokenMark(sent))) return deferredResponse('déjà renouvelé')
      const fail = (retryAfter: string | null, cause: string) => {
        const n = g.n + 1
        const until = now() + refreshDelay(n, retryAfter, rnd, now())
        opts.gate.set({ n, at: until, ...(g.used ? { used: g.used } : {}) })
        opts.onWait?.(until, cause)
        return deferredResponse(cause)
      }
      let res: Response
      try {
        res = await attempt(opts.fetch, input, init, timeoutMs)
      } catch (e) {
        if (init?.signal?.aborted) throw e
        return fail(null, (e as { name?: string } | null)?.name === 'TimeoutError' ? 'délai' : 'réseau')
      }
      let text: string
      try {
        text = await res.text()
      } catch {
        return fail(res.headers.get('Retry-After'), 'réponse coupée')
      }
      const verdict = classifyRefresh(res.status, text)
      if (verdict === 'transient') return fail(res.headers.get('Retry-After'), String(res.status))
      opts.gate.set(verdict === 'ok' && sent ? { ...OPEN_GATE, used: tokenMark(sent) } : OPEN_GATE)
      if (g.n > 0) opts.onDone?.(verdict === 'ok')
      return new Response(NULL_BODY.includes(res.status) ? null : text, { status: res.status, statusText: res.statusText, headers: res.headers })
    })
  }
}
