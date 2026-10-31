/*
 * SERVICE WORKER : PUSH DE LA VEILLE qui prépare l'événement sur le téléphone (règles et textes : src/veilleCore.ts ; envoi :
 * supabase/functions/veille ; serveur : supabase/060_push_veille.sql).
 *
 * Construit à part en un seul fichier « veille-sw.js » (vite.config.ts, extension veilleSw) et chargé par le service worker
 * de l'appli (workbox importScripts), avant public/push-sw.js qui lui passe les messages de type « veille ». Adresse du
 * serveur, clé publique, nom de la base locale : figés à la construction (__HB_SW__ : rien de secret, ce sont ceux de l'appli).
 *
 *  - push « veille » : notification tout de suite, attente au hasard, session (workerSession : même verrou de renouvellement
 *    que l'appli), téléchargement avec les droits de la personne, rangement dans la base Dexie de l'appli (IndexedDB),
 *    notification remplacée par le résultat exact ;
 *  - periodicsync « hb-veille-jours » (Android, appli installée, quand le navigateur le permet) : mêmes téléchargements pour
 *    les événements du compte (créateur ou participant direct) d'aujourd'hui à après-demain, sans notification.
 * La base locale n'est jamais créée ici : si l'appli ne l'a pas encore ouverte (jamais connectée sur ce téléphone), rien
 * n'est écrit. Ouverte sans numéro de version (celle de l'appli), refermée aussitôt si l'appli doit la mettre à niveau.
 */
import { workerSession, webLock, type WorkerSession } from './authRefresh'
import { GATE_MIRROR_KEY, idbKv } from './sessionStore'
import { addDays } from './priorite'
import type { ServerRow } from './syncLive'
import {
  attenteVeille,
  evenementsDuCompte,
  inList,
  joueursDes,
  joueursEnTrop,
  lignesARanger,
  paquets,
  parseVeille,
  statutLecture,
  tagVeille,
  texteVeille,
  titreVeille,
  urlVeille,
  type Issue,
  type VeilleMessage,
  type VeilleTable,
} from './veilleCore'

declare const __HB_SW__: { url: string; anonKey: string; dbName: string; storageKey: string }

type Sw = {
  registration: { scope: string; showNotification(title: string, options: Record<string, unknown>): Promise<void> }
  addEventListener(type: string, fn: (e: { waitUntil(p: Promise<unknown>): void; tag?: string }) => void): void
  navigator: { userAgent: string }
  HBVeille?: { push(data: unknown): Promise<void> | null }
}
const sw = self as unknown as Sw
const CFG = __HB_SW__

/** Lignes lues par page, identifiants par requête (comme la synchronisation : src/syncLive.ts PULL_PAGE, IDS_PER_READ). */
const PAGE = 1000
const IDS = 100
/** Pages au plus par table et par paquet de joueurs (un joueur a quelques dizaines de mesures). */
const MAX_PAGES = 5
/** Délai d'une lecture ; durée totale de la préparation au plus (bien sous les limites des navigateurs). */
const READ_TIMEOUT_MS = 20_000
const BUDGET_MS = 120_000

/** Arrêt de la préparation : serveur occupé, session refusée, pas de réseau, autre erreur, ou temps écoulé. */
type StopKind = 'occupe' | 'session' | 'reseau' | 'erreur' | 'temps'
class Stop extends Error {
  readonly kind: StopKind
  constructor(kind: StopKind) {
    super(kind)
    this.kind = kind
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Notification de la veille (même étiquette : la nouvelle remplace la précédente, sans resonner). */
function notify(m: VeilleMessage, issue: Issue, first: boolean) {
  return sw.registration.showNotification(titreVeille(m), {
    body: texteVeille(m, issue),
    tag: tagVeille(m),
    renotify: false,
    silent: m.calme || !first,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: urlVeille(m) },
  })
}

/** Lecture REST (PostgREST) avec la session de la personne ; arrête la préparation si le serveur est occupé ou refuse. */
async function lire(path: string, token: string, deadline: number): Promise<ServerRow[]> {
  if (Date.now() > deadline) throw new Stop('temps')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), READ_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${CFG.url.replace(/\/$/, '')}/rest/v1/${path}`, {
      headers: { apikey: CFG.anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: ctl.signal,
      cache: 'no-store',
    })
  } catch {
    throw new Stop('reseau')
  } finally {
    clearTimeout(timer)
  }
  const st = statutLecture(res.status)
  if (st !== 'ok') throw new Stop(st)
  const body = (await res.json().catch(() => null)) as unknown
  return Array.isArray(body) ? (body as ServerRow[]) : []
}

/** Toutes les pages d'une lecture (ordre heure serveur puis identifiant, comme la synchronisation), au plus MAX_PAGES. */
async function lirePages(table: string, filter: string, token: string, deadline: number): Promise<ServerRow[]> {
  const out: ServerRow[] = []
  let after: ServerRow | null = null
  for (let p = 0; p < MAX_PAGES; p++) {
    const cursor: string = after
      ? `&or=(server_updated_at.gt.${encodeURIComponent(`"${after.server_updated_at}"`)},and(server_updated_at.eq.${encodeURIComponent(`"${after.server_updated_at}"`)},id.gt.${encodeURIComponent(`"${after.id}"`)}))`
      : ''
    const rows = await lire(`hb_${table}?select=id,data,server_updated_at${filter}${cursor}&order=server_updated_at.asc,id.asc&limit=${PAGE}`, token, deadline)
    out.push(...rows)
    if (rows.length < PAGE) break
    after = rows[rows.length - 1]
  }
  return out
}

// ---------- Base locale (Dexie de l'appli, IndexedDB brute) ----------

function ouvrirBase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(CFG.dbName)
    } catch {
      return resolve(null)
    }
    // Base absente (appli jamais ouverte ici) : on ne la crée pas.
    req.onupgradeneeded = () => req.transaction?.abort()
    req.onsuccess = () => {
      const db = req.result
      // L'appli met sa base à niveau : on la lui laisse.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
}

const reqP = <T>(r: IDBRequest<T>) => new Promise<T>((ok, ko) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => ko(r.error))))

/** Range des lignes du serveur dans une table de la base locale (règle de l'appli ; jamais une ligne en attente d'envoi). */
async function ranger(db: IDBDatabase, table: VeilleTable, rows: ServerRow[]): Promise<number> {
  if (!rows.length || !db.objectStoreNames.contains(table) || !db.objectStoreNames.contains('outbox')) return 0
  const tx = db.transaction([table, 'outbox'], 'readwrite')
  const done = new Promise<void>((ok, ko) => ((tx.oncomplete = () => ok()), (tx.onerror = () => ko(tx.error)), (tx.onabort = () => ko(tx.error))))
  const store = tx.objectStore(table)
  const outbox = tx.objectStore('outbox')
  const pending = new Set<string>()
  const byRow = outbox.indexNames.contains('rowId') ? outbox.index('rowId') : null
  await Promise.all(
    rows.map(async (r) => {
      const items = byRow ? ((await reqP(byRow.getAll(r.id))) as { table?: string }[]) : []
      if (items.some((i) => i.table === table)) pending.add(r.id)
    }),
  )
  const locals = (await Promise.all(rows.map((r) => reqP(store.get(r.id))))) as ({ updatedAt?: number } | undefined)[]
  const keep = lignesARanger(rows, locals, pending)
  for (const r of keep) store.put(r.data.id === undefined ? { ...r.data, id: r.id } : r.data)
  await done
  return keep.length
}

// ---------- Préparation ----------

/** Télécharge et range les événements donnés ; renvoie l'issue (joueurs prêts, ou ce qui a manqué). */
async function preparer(ids: string[], session: Extract<WorkerSession, { ok: true }>): Promise<Issue> {
  const deadline = Date.now() + BUDGET_MS
  const token = session.accessToken
  const db = await ouvrirBase()
  if (!db) return { kind: 'erreur' }
  const events: ServerRow[] = []
  let prets = 0
  let restants = 0
  try {
    // Grille de notation et configuration (petites tables), puis les événements (avec SES droits : ceux qu'il voit).
    for (const t of ['config', 'criteria'] as const) await ranger(db, t, await lirePages(t, '', token, deadline))
    for (const part of paquets(ids, IDS)) events.push(...(await lire(`hb_events?select=id,data,server_updated_at&id=in.${encodeURIComponent(inList(part))}`, token, deadline)))
    await ranger(db, 'events', events)
    const players = joueursDes(events)
    restants = players.length
    for (const part of paquets(players, IDS)) {
      const rows = await lire(`hb_players?select=id,data,server_updated_at&id=in.${encodeURIComponent(inList(part))}`, token, deadline)
      await ranger(db, 'players', rows)
      for (const t of ['measurements', 'evaluations'] as const)
        await ranger(db, t, await lirePages(t, `&data->>playerId=in.${encodeURIComponent(inList(part))}`, token, deadline))
      // Comptés « prêts » seulement une fois leurs mesures et avis rangés.
      prets += rows.filter((r) => r.data && r.data.deleted !== true).length
      restants -= part.length
    }
    return { kind: 'pret', joueurs: prets, evenements: events.length, manquants: joueursEnTrop(events) }
  } catch (e) {
    // Temps écoulé : ce qui est rangé est exact, le reste arrivera à l'ouverture de l'appli.
    if (e instanceof Stop && e.kind === 'temps') return { kind: 'pret', joueurs: prets, evenements: events.length, manquants: restants + joueursEnTrop(events) }
    throw e
  } finally {
    db.close()
  }
}

function session(): Promise<WorkerSession> {
  const kv = idbKv()
  if (!kv || !CFG.url || !CFG.storageKey) return Promise.resolve({ ok: false, why: 'aucune' })
  return workerSession({ fetch: (i, init) => fetch(i, init), url: CFG.url, anonKey: CFG.anonKey, key: CFG.storageKey, gateKey: GATE_MIRROR_KEY, kv, lock: webLock() })
}

async function onVeille(m: VeilleMessage) {
  // 1. Toujours une notification visible, tout de suite.
  await notify(m, { kind: 'en-cours' }, true)
  let issue: Issue
  try {
    // 2. Étalement : les téléphones d'un même lot ne téléchargent pas à la même seconde.
    await sleep(attenteVeille(Math.random, sw.navigator.userAgent))
    // 3. Session de la personne.
    const s = await session()
    if (!s.ok) issue = { kind: s.why === 'plus-tard' ? 'occupe' : 'session' }
    else issue = await preparer(m.ev.map((e) => e.id), s)
  } catch (e) {
    issue = e instanceof Stop && e.kind !== 'temps' ? { kind: e.kind } : { kind: 'erreur' }
  }
  // 6. Le résultat exact remplace la première notification.
  await notify(m, issue, false)
}

/** Appelé par public/push-sw.js pour un message de type « veille » ; null : pas un message de la veille. */
function push(data: unknown): Promise<void> | null {
  const m = parseVeille(data)
  if (!m) return null
  return onVeille(m).catch(() => undefined)
}
sw.HBVeille = { push }

// Android : synchronisation périodique (appli installée) : événements du compte d'aujourd'hui à après-demain, sans notification.
sw.addEventListener('periodicsync', (event) => {
  if (event.tag !== 'hb-veille-jours') return
  event.waitUntil(
    (async () => {
      const s = await session()
      if (!s.ok || !s.userId) return
      const today = new Date().toLocaleDateString('sv')
      const last = addDays(today, 2)
      const days = [today, addDays(today, 1), last]
      const rows = await lire(`hb_events?select=id,data,server_updated_at&data->>date=in.${encodeURIComponent(inList(days))}`, s.accessToken, Date.now() + BUDGET_MS)
      const ids = evenementsDuCompte(rows as never, s.userId, today, last)
      if (ids.length) await preparer(ids, s)
    })().catch(() => undefined),
  )
})
