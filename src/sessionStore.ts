/*
 * SESSION LISIBLE PAR LE SERVICE WORKER (push de la veille, supabase/060_push_veille.sql, src/veilleSw.ts).
 *
 * POURQUOI : la veille d'un événement, le service worker télécharge les joueurs AVEC LA SESSION de la personne (ses droits,
 * HTTPS), appli fermée. supabase-js gardait la session dans localStorage, que le service worker ne peut pas lire. Elle est
 * désormais gardée dans IndexedDB (base « hb-session », magasin « kv »), lisible par l'appli ET par le service worker
 * (option storage de supabase-js, qui accepte un stockage asynchrone).
 *
 * UNE SEULE SOURCE : la session n'est JAMAIS gardée à deux endroits (deux copies divergentes = un jeton de renouvellement
 * périmé envoyé un jour par l'une, et GoTrue ferme alors la session de tous les appareils du compte, voir src/authRefresh.ts) :
 *  - MIGRATION : à la première lecture, la session de localStorage (versions d'avant) passe dans IndexedDB et quitte
 *    localStorage. Un onglet d'une ancienne version encore ouvert peut la réécrire dans localStorage : à la lecture suivante,
 *    la plus récente des deux (expires_at) est gardée dans IndexedDB et localStorage est vidé ;
 *  - IndexedDB indisponible (navigation privée de certains navigateurs, stockage bloqué) : localStorage comme avant, pour
 *    toute la durée de l'onglet ; le service worker ne trouve alors pas de session et la notification invite à ouvrir l'appli.
 * Le repère de renouvellement (src/authRefresh.ts, « déjà renouvelé ») est recopié dans le même magasin (GATE_MIRROR_KEY) :
 * le service worker le respecte.
 * Fonctions pures et magasin injectable (memoryKv) : testées par tools/test-session-partagee.ts.
 */

/** Base IndexedDB partagée par l'appli et le service worker (une par site). */
export const SESSION_DB = 'hb-session'
export const SESSION_STORE = 'kv'
/** Copie du repère de renouvellement (src/authRefresh.ts, RefreshGate) lisible par le service worker. */
export const GATE_MIRROR_KEY = 'handbase.renouvellement'

/** Clé de la session dans le stockage : la même que celle choisie par défaut par supabase-js (sb-<projet>-auth-token). */
export function sessionStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
}

/** Petit magasin clé → texte (IndexedDB dans l'appli et le service worker ; mémoire dans les tests). */
export interface Kv {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  del(key: string): Promise<void>
}

export interface StoredSession {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
  user?: { id?: string }
  [k: string]: unknown
}

/** Session lisible dans un texte JSON (jetons présents) ; null sinon. */
export function parseSession(text: string | null | undefined): StoredSession | null {
  if (!text) return null
  try {
    const s = JSON.parse(text) as Partial<StoredSession> | null
    return s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' ? (s as StoredSession) : null
  } catch {
    return null
  }
}

/** Jeton de renouvellement d'une session gardée (texte JSON) ; null : aucune. */
export const refreshTokenOf = (text: string | null | undefined) => parseSession(text)?.refresh_token ?? null

/** Expiration (secondes depuis 1970) d'une session gardée ; 0 si illisible. */
export function expiresAtOf(text: string | null | undefined): number {
  const s = parseSession(text)
  return s && typeof s.expires_at === 'number' && Number.isFinite(s.expires_at) ? s.expires_at : 0
}

/**
 * La plus récente de deux sessions gardées (idb : celle d'IndexedDB ; legacy : celle de localStorage) : la plus grande
 * expiration ; à égalité (ou illisibles toutes deux), celle d'IndexedDB. Une session illisible ne remplace jamais une lisible.
 */
export function newerSession(idb: string | null, legacy: string | null): string | null {
  if (legacy == null) return idb
  if (idb == null) return legacy
  const a = parseSession(idb)
  const b = parseSession(legacy)
  if (!b) return idb
  if (!a) return legacy
  return expiresAtOf(legacy) > expiresAtOf(idb) ? legacy : idb
}

type Legacy = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Stockage asynchrone pour supabase-js (option auth.storage) : voir l'en-tête. */
export interface SharedStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  /** IndexedDB indisponible : localStorage comme avant. */
  readonly degraded: boolean
}

export function sharedSessionStorage(kv: Kv | null, legacy: Legacy | null): SharedStorage {
  let broken = !kv
  const lsGet = (k: string) => {
    try {
      return legacy?.getItem(k) ?? null
    } catch {
      return null
    }
  }
  const lsSet = (k: string, v: string) => {
    try {
      legacy?.setItem(k, v)
    } catch {
      /* stockage indisponible */
    }
  }
  const lsDel = (k: string) => {
    try {
      legacy?.removeItem(k)
    } catch {
      /* stockage indisponible */
    }
  }
  return {
    get degraded() {
      return broken
    },
    async getItem(key) {
      if (broken) return lsGet(key)
      let idb: string | null
      try {
        idb = await kv!.get(key)
      } catch {
        broken = true
        return lsGet(key)
      }
      const old = lsGet(key)
      if (old == null) return idb
      const chosen = newerSession(idb, old)
      try {
        if (chosen != null && chosen !== idb) await kv!.set(key, chosen)
      } catch {
        broken = true
        return old
      }
      lsDel(key)
      return chosen
    },
    async setItem(key, value) {
      if (!broken) {
        try {
          await kv!.set(key, value)
          lsDel(key)
          return
        } catch {
          broken = true
        }
      }
      lsSet(key, value)
    },
    async removeItem(key) {
      lsDel(key)
      if (broken) return
      try {
        await kv!.del(key)
      } catch {
        broken = true
      }
    },
  }
}

/** Magasin en mémoire (tests, et repli). */
export function memoryKv(init: Record<string, string> = {}): Kv & { map: Map<string, string> } {
  const map = new Map(Object.entries(init))
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    del: async (k) => void map.delete(k),
  }
}

/**
 * Magasin IndexedDB (appli et service worker) : base SESSION_DB, magasin SESSION_STORE, clés et valeurs texte. La base est
 * ouverte à la demande et fermée si une autre version la demande (jamais de blocage) ; null si IndexedDB est absent.
 */
export function idbKv(factory: IDBFactory | undefined = (globalThis as { indexedDB?: IDBFactory }).indexedDB): Kv | null {
  if (!factory) return null
  let opening: Promise<IDBDatabase> | null = null
  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(SESSION_DB, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(SESSION_STORE)) req.result.createObjectStore(SESSION_STORE)
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => {
          db.close()
          opening = null
        }
        db.onclose = () => {
          opening = null
        }
        resolve(db)
      }
      req.onerror = () => {
        opening = null
        reject(req.error ?? new Error('IndexedDB indisponible'))
      }
      req.onblocked = () => {
        opening = null
        reject(new Error('IndexedDB bloquée'))
      }
    }))
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | null): Promise<T> => {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(SESSION_STORE, mode)
      const req = fn(tx.objectStore(SESSION_STORE))
      tx.oncomplete = () => resolve((req?.result ?? null) as T)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB : écriture refusée'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB : transaction annulée'))
    })
  }
  return {
    get: async (k) => {
      const v = await run<unknown>('readonly', (s) => s.get(k))
      return typeof v === 'string' ? v : null
    },
    set: (k, v) => run<void>('readwrite', (s) => s.put(v, k)),
    del: (k) => run<void>('readwrite', (s) => s.delete(k)),
  }
}
