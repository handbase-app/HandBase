/*
 * OUVERTURE ÉQUITABLE (« tourniquet ») : quand le serveur est plein, l'appareil attend son tour au lieu d'échouer.
 *
 * POURQUOI (essai de charge du 29/10, série 6) : à 10 000 appareils ouverts en 10 minutes, 4,86 % des requêtes échouaient
 * (délais dépassés à 30 s, réponses 503 d'Envoy) et chaque échec arrêtait la synchronisation de l'appareil, qui repartait à
 * la synchronisation suivante. Désormais, une requête vers la base (PostgREST, /rest/v1/) refusée parce que le serveur est
 * occupé est REJOUÉE, telle quelle, après une attente croissante avec un peu de hasard :
 *   1 s, 2 s, 4 s, 8 s, 16 s, puis 30 s (plafond), chaque attente allongée au hasard de 0 à 50 % (au plus 30 s au total),
 *   au plus RETRY_MAX nouvelles tentatives (~1 min 30 d'attente en tout), puis l'erreur remonte comme avant.
 *   Le serveur dit combien attendre (en-tête Retry-After, en secondes ou en date HTTP) : on attend au moins cela (plafonné
 *   à RETRY_AFTER_MAX_MS), plus un peu de hasard (jusqu'à 1 s) pour que les appareils ne reviennent pas tous ensemble, et
 *   jamais moins que l'attente croissante.
 * La requête rejouée est LA MÊME (même adresse, même curseur, même page) : une synchronisation reprend là où elle en était,
 * jamais depuis le début ; les pages déjà reçues sont gardées (curseur enregistré page après page, src/sync.ts).
 *
 * Quand rejouer :
 *  - 429 (trop de requêtes) et 503 de refus explicite (en-tête Retry-After, ou x-envoy-overloaded : file d'Envoy pleine,
 *    circuit ouvert) : la requête n'a pas été traitée, on la rejoue toujours ;
 *  - autre 503 (Envoy : « upstream connect error… reset before headers », la requête a peut-être atteint PostgREST) : comme
 *    un délai dépassé (ci-dessous) ;
 *  - délai dépassé (504, 408, attente de l'appareil au-delà de REQUEST_TIMEOUT_MS) et erreur réseau : la requête a peut-être
 *    été traitée ; rejouée seulement si elle ne change rien ou se rejoue sans effet : lectures (GET, HEAD) et fonctions
 *    idempotentes (IDEMPOTENT_RPC : écriture « la plus récente gagne », lectures) ;
 *  - hors ligne (navigator.onLine faux) : rien n'est rejoué, l'appli passe « hors ligne » comme avant ;
 *  - requête annulée par l'appelant (signal) : rien n'est rejoué.
 * Fonctions pures et injectables (horloge, hasard, attente, fetch) : testées par tools/test-tourniquet.ts. Branché dans
 * src/sync.ts (createClient, global.fetch).
 */

/** Première attente, multipliée par 2 à chaque nouvelle tentative. */
export const RETRY_BASE_MS = 1000
/** Plafond d'une attente (hors Retry-After). */
export const RETRY_CAP_MS = 30_000
/** Hasard ajouté : jusqu'à cette part de l'attente. */
export const RETRY_JITTER = 0.5
/** Nouvelles tentatives au plus (1 + 2 + 4 + 8 + 16 + 30 + 30 s ≈ 1 min 30, plus le hasard), puis l'erreur remonte. */
export const RETRY_MAX = 7
/** Retry-After plus long que cela (valeur aberrante) : ramené à cela. */
export const RETRY_AFTER_MAX_MS = 120_000
/** Une requête sans réponse au bout de ce délai est abandonnée (puis rejouée si elle peut l'être). */
export const REQUEST_TIMEOUT_MS = 60_000

/** Fonctions de la base qu'on peut rejouer sans effet après un délai dépassé ou une coupure (lectures, « la plus récente gagne »). */
export const IDEMPOTENT_RPC: readonly string[] = [
  'hb_upsert',
  'hb_upsert_lignes',
  'hb_quoi_de_neuf',
  'hb_lire_perimetre',
  'hb_mes_canaux',
  'hb_my_perimeter',
  'hb_ping',
]

/** Attente avant la tentative n° attempt + 1 (attempt = 0 pour la première nouvelle tentative), sans Retry-After. */
export function backoffMs(attempt: number, rnd: () => number = Math.random): number {
  const base = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt))
  const r = Math.min(Math.max(rnd(), 0), 1)
  return Math.min(RETRY_CAP_MS, Math.round(base * (1 + RETRY_JITTER * r)))
}

/** En-tête Retry-After en millisecondes (secondes, ou date HTTP) ; null : absent ou illisible. */
export function retryAfterMs(header: string | null | undefined, now: number = Date.now()): number | null {
  if (!header) return null
  const s = header.trim()
  if (/^\d+(\.\d+)?$/.test(s)) return Math.min(RETRY_AFTER_MAX_MS, Math.round(Number(s) * 1000))
  const at = Date.parse(s)
  if (Number.isNaN(at)) return null
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, at - now))
}

/**
 * Attente avant de rejouer : l'attente croissante, et au moins Retry-After (plus jusqu'à 1 s de hasard) quand le serveur le
 * donne : un Retry-After fixe (Envoy : 2 s) n'empêche pas l'attente de croître si le serveur reste plein.
 */
export function retryDelay(attempt: number, retryAfter: string | null | undefined, rnd: () => number = Math.random, now: number = Date.now()): number {
  const backoff = backoffMs(attempt, rnd)
  const after = retryAfterMs(retryAfter, now)
  if (after === null) return backoff
  return Math.max(backoff, after + Math.round(1000 * Math.min(Math.max(rnd(), 0), 1)))
}

/** Requête vers la base (PostgREST) : seules celles-ci sont rejouées (pas la connexion, ni le stockage, ni Realtime). */
export const isRestUrl = (url: string) => url.includes('/rest/v1/')

/** La requête peut-elle être rejouée après un délai dépassé ou une coupure (peut-être traitée par le serveur) ? */
export function replayable(method: string | undefined, url: string): boolean {
  const m = (method ?? 'GET').toUpperCase()
  if (m === 'GET' || m === 'HEAD') return true
  const rpc = /\/rest\/v1\/rpc\/([A-Za-z0-9_]+)/.exec(url)
  return m === 'POST' && !!rpc && IDEMPOTENT_RPC.includes(rpc[1])
}

/**
 * Réponse à rejouer : 429, et 503 de refus explicite (refused : Retry-After ou x-envoy-overloaded), toujours ; autre 503, 504
 * et 408 (délai dépassé) seulement si la requête peut l'être.
 */
export function retryableStatus(status: number, canReplay: boolean, refused = false): boolean {
  if (status === 429 || (status === 503 && refused)) return true
  return canReplay && (status === 503 || status === 504 || status === 408)
}

/** Refus explicite du serveur (la requête n'a pas été transmise) : Retry-After, ou x-envoy-overloaded (circuit d'Envoy). */
export const refusedResponse = (h: Headers) => h.has('Retry-After') || h.get('x-envoy-overloaded') === 'true'

export interface RetryOptions {
  /** fetch sous-jacent. */
  fetch: typeof fetch
  /** Attente (ms) ; rejetée si signal annulé. */
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>
  rnd?: () => number
  now?: () => number
  /** Réseau disponible (navigator.onLine) ; faux : rien n'est rejoué. */
  online?: () => boolean
  /** Prévenu avant chaque attente (tentative n°, attente en ms, cause) : indication discrète « serveur très demandé ». */
  onWait?: (attempt: number, ms: number, cause: string) => void
  /** Prévenu quand la requête a enfin abouti (ou abandonné) après au moins une attente. */
  onDone?: (retried: number, ok: boolean) => void
  /**
   * Prévenu après CHAQUE tentative (réponse ou erreur) : statut (0 : coupure ou délai dépassé), durée, Retry-After (ms),
   * refus explicite, délai dépassé. Sert à estimer le niveau de charge du serveur (src/charge.ts) ; jamais appelé pour une
   * requête annulée par l'appelant ni hors ligne.
   */
  onResult?: (r: { status: number; ms: number; retryAfterMs: number | null; refused: boolean; timeout: boolean }) => void
  maxRetries?: number
  timeoutMs?: number
}

const defaultSleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })

class TimeoutError extends Error {
  constructor() {
    super('Délai dépassé')
    this.name = 'TimeoutError'
  }
}

/** Une tentative, abandonnée au bout de timeoutMs (l'annulation de l'appelant passe aussi). */
async function attempt(f: typeof fetch, input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  if (!(timeoutMs > 0) || typeof AbortController === 'undefined') return f(input, init)
  const ctl = new AbortController()
  const outer = init?.signal
  const onAbort = () => ctl.abort(outer?.reason)
  if (outer) {
    if (outer.aborted) ctl.abort(outer.reason)
    else outer.addEventListener('abort', onAbort, { once: true })
  }
  let timedOut = false
  const t = setTimeout(() => {
    timedOut = true
    ctl.abort()
  }, timeoutMs)
  try {
    return await f(input, { ...init, signal: ctl.signal })
  } catch (e) {
    if (timedOut && !outer?.aborted) throw new TimeoutError()
    throw e
  } finally {
    clearTimeout(t)
    outer?.removeEventListener('abort', onAbort)
  }
}

const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

/**
 * fetch qui rejoue les requêtes vers la base refusées pour cause de serveur occupé (voir l'en-tête du fichier). Les autres
 * adresses passent telles quelles. Le corps des requêtes de supabase-js est un texte (JSON) : rejouable tel quel.
 */
export function retryingFetch(opts: RetryOptions): typeof fetch {
  const sleep = opts.sleep ?? defaultSleep
  const rnd = opts.rnd ?? Math.random
  const now = opts.now ?? Date.now
  const online = opts.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const max = opts.maxRetries ?? RETRY_MAX
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input)
    if (!isRestUrl(url)) return opts.fetch(input, init)
    const canReplay = replayable(init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : undefined), url)
    for (let n = 0; ; n++) {
      let res: Response | null = null
      let err: unknown = null
      const t0 = now()
      try {
        res = await attempt(opts.fetch, input, init, timeoutMs)
      } catch (e) {
        err = e
      }
      const aborted = !!init?.signal?.aborted
      const last = n >= max || aborted || !online()
      if (opts.onResult && !aborted && online()) {
        try {
          opts.onResult({
            status: res ? res.status : 0,
            ms: Math.max(0, now() - t0),
            retryAfterMs: res ? retryAfterMs(res.headers.get('Retry-After'), now()) : null,
            refused: res ? refusedResponse(res.headers) : false,
            timeout: !res && err instanceof TimeoutError,
          })
        } catch {
          /* l'estimation ne doit jamais gêner la requête */
        }
      }
      if (res) {
        if (!retryableStatus(res.status, canReplay, refusedResponse(res.headers)) || last) {
          if (n > 0) opts.onDone?.(n, res.ok)
          return res
        }
        const ms = retryDelay(n, res.headers.get('Retry-After'), rnd, now())
        // Réponse abandonnée : son corps est libéré (la connexion reste réutilisable).
        res.body?.cancel().catch(() => {})
        opts.onWait?.(n + 1, ms, String(res.status))
        await sleep(ms, init?.signal)
        continue
      }
      // Erreur réseau ou délai dépassé : rejouée seulement si la requête peut l'être.
      if (!canReplay || last) {
        if (n > 0) opts.onDone?.(n, false)
        throw err
      }
      const ms = retryDelay(n, null, rnd, now())
      opts.onWait?.(n + 1, ms, err instanceof TimeoutError ? 'délai' : 'réseau')
      await sleep(ms, init?.signal)
    }
  }
}
