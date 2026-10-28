/*
 * Synchronisation allégée (supabase/057_synchro_legere.sql) : la partie PURE (ni Dexie, ni React, ni Supabase), testée par
 * tools/test-synchro-legere.ts. L'état et les appels au serveur vivent dans src/sync.ts.
 *  - canaux privés du compte, même règle que hb_mes_canaux() (miroir, pour le test et la lecture du code) ;
 *  - délai de relecture après un signal : regroupement 1,5 s ; canaux larges (commun, staff, tout) : + 0 à 10 s au hasard,
 *    pour que des milliers d'appareils ne relisent pas la même table à la même seconde ;
 *  - filet de sécurité : synchronisation complète toutes les 5 minutes quand le direct est abonné, toutes les minutes sinon ;
 *  - quelles tables relire d'après la réponse de hb_quoi_de_neuf ;
 *  - lignes reçues (relecture ou en direct) à garder face à celles de l'appareil ;
 *  - regroupement des signaux (Grouper) ; annonce d'une nouvelle version (vérification dans les 30 s).
 */
import type { SyncTable } from './db'
import type { ServerScope } from './perimeter'

// ---------- Canaux ----------

/** Tous les comptes, joueurs compris : configuration, listes, annonces de version. */
export const COMMON_TOPIC = 'hb:commun'
/** Tout le staff (comptes avec un rôle) : critères, structure, groupes et alertes partagés, événements sans organisateur. */
export const STAFF_TOPIC = 'hb:staff'
/** Comptes qui voient tout (administrateurs, niveau Fédération). */
export const ALL_TOPIC = 'hb:tout'
/** Canaux « larges » (beaucoup d'abonnés) : la relecture attend un délai au hasard pour étaler les requêtes. */
export const BROAD_TOPICS: readonly string[] = [COMMON_TOPIC, STAFF_TOPIC, ALL_TOPIC]
export const isBroadTopic = (topic: string) => BROAD_TOPICS.includes(topic)

/** Tables dont la ligne entière est diffusée (rien de personnel, lues par tout le staff) : même liste que hb_diffuser (v_contenu). */
export const CONTENT_TABLES: readonly SyncTable[] = ['config', 'criteria', 'levels']

/** Événements diffusés sur les canaux (realtime.send) : signal (table changée), ligne (signal + contenu), version (nouvelle appli). */
export const LIVE_EVENTS = ['signal', 'ligne', 'version'] as const

/**
 * Canaux du compte, même règle que hb_mes_canaux() : le commun et le sien pour tous ; un joueur : sa fiche ; le staff : le
 * canal du staff, puis « tout » ou ses départements et ses clubs (le périmètre tel que le serveur l'applique, hb_my_perimeter).
 */
export function channelsOf(input: { uid: string | null; role: string | null; playerId?: string | null; scope: ServerScope | null }): string[] {
  if (!input.uid) return []
  const out = [COMMON_TOPIC, `hb:compte:${input.uid}`]
  if (input.role === 'joueur') {
    if (input.playerId) out.push(`hb:joueur:${input.playerId}`)
    return out
  }
  if (input.role === 'admin' || input.role === 'preparateur' || input.role === 'observateur') {
    out.push(STAFF_TOPIC)
    const s = input.scope
    if (!s) return out
    if (s.all) out.push(ALL_TOPIC)
    else out.push(...(s.depts ?? []).filter(Boolean).map((d) => `hb:dept:${d}`), ...(s.clubs ?? []).filter(Boolean).map((c) => `hb:club:${c}`))
  }
  return out
}

// ---------- Délais ----------

/** Regroupement des signaux : plusieurs tables signalées en 1,5 s = une seule relecture. */
export const GROUP_MS = 1500
/** Canal large : relecture étalée sur 10 s. */
export const BROAD_JITTER_MS = 10_000
/** Nouvelle version annoncée : vérification étalée sur 30 s. */
export const VERSION_JITTER_MS = 30_000
/** Filet de sécurité (synchronisation complète) : 5 minutes en direct, 1 minute sinon (une notification perdue). */
export const LIVE_SYNC_MS = 5 * 60_000
export const SYNC_MS = 60_000

/** Entier au hasard dans [0, max) ; rnd : tirage dans [0, 1) (Math.random, ou fixé par le test). */
export const jitter = (max: number, rnd: () => number = Math.random) => Math.floor(Math.min(Math.max(rnd(), 0), 0.999999) * max)

/** Délai avant de relire une table signalée sur ce canal. */
export const pullDelay = (topic: string, rnd: () => number = Math.random) => GROUP_MS + (isBroadTopic(topic) ? jitter(BROAD_JITTER_MS, rnd) : 0)

/** Délai avant de vérifier une version annoncée ; aucune vérification si c'est déjà la mienne (ou rien d'annoncé). */
export function versionCheckDelay(announced: unknown, mine: string, rnd: () => number = Math.random): number | null {
  if (typeof announced !== 'string' || !announced.trim() || announced === mine) return null
  return jitter(VERSION_JITTER_MS, rnd)
}

export const syncEvery = (live: boolean) => (live ? LIVE_SYNC_MS : SYNC_MS)
/** Une synchronisation complète est-elle due ? (lastFull : début de la dernière, 0 = jamais.) */
export const dueForSync = (now: number, lastFull: number, live: boolean) => now - lastFull >= syncEvery(live)

// ---------- Signaux ----------

/** Ligne telle que le serveur l'envoie (relecture : id, data, server_updated_at ; en direct : aussi deleted). */
export interface ServerRow {
  id: string
  data: { id?: string; updatedAt?: number; purged?: boolean; deleted?: boolean } & Record<string, unknown>
  server_updated_at?: string
  deleted?: boolean
}

export interface Signal {
  table: SyncTable
  /** Identifiant et heure serveur de la (première) ligne : repères, pas une consigne (on relit la table). */
  id?: string
  v?: string
  /** Contenu de la ligne (événement « ligne », tables de CONTENT_TABLES). */
  row?: ServerRow
}

/** Lit un signal reçu en direct ({t, id, v, ligne?}) ; null s'il est mal formé ou vise une table inconnue (tables : SYNC_TABLES). */
export function parseSignal(payload: unknown, tables: readonly string[]): Signal | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as { t?: unknown; id?: unknown; v?: unknown; ligne?: unknown }
  if (typeof p.t !== 'string' || !tables.includes(p.t)) return null
  const out: Signal = { table: p.t as SyncTable }
  if (typeof p.id === 'string') out.id = p.id
  if (typeof p.v === 'string') out.v = p.v
  const l = p.ligne as { id?: unknown; data?: unknown; deleted?: unknown; server_updated_at?: unknown } | undefined
  if (l && typeof l === 'object' && typeof l.id === 'string' && l.data && typeof l.data === 'object' && !Array.isArray(l.data)) {
    out.row = { id: l.id, data: l.data as ServerRow['data'] }
    if (typeof l.deleted === 'boolean') out.row.deleted = l.deleted
    if (typeof l.server_updated_at === 'string') out.row.server_updated_at = l.server_updated_at
  }
  return out
}

/** Réponse de hb_quoi_de_neuf : true à relire, false rien de neuf, null table inconnue du serveur ; clé absente : prudence, on relit. */
export type WhatsNew = Record<string, boolean | null | undefined>

/**
 * Que relire ? Tables jamais reçues (fresh) : toujours. Sans réponse (fonction absente, erreur) : tout, comme avant.
 * absent : tables que le serveur ne connaît pas (script pas passé) ; quiet : rien de neuf pour ce compte.
 */
export function planPull(tables: readonly SyncTable[], fresh: ReadonlySet<SyncTable>, flags: WhatsNew | null) {
  const pull: SyncTable[] = []
  const absent: SyncTable[] = []
  const quiet: SyncTable[] = []
  for (const t of tables) {
    const f = flags && !fresh.has(t) ? flags[t] : true
    if (f === null) absent.push(t)
    else if (f === false) quiet.push(t)
    else pull.push(t)
  }
  return { pull, absent, quiet }
}

// ---------- Lignes reçues ----------

type LocalRow = { updatedAt?: number } | undefined

/**
 * Parmi des lignes reçues du serveur (relecture ou en direct), celles à écrire sur l'appareil (locals : la ligne de l'appareil,
 * dans le même ordre, undefined si absente) :
 *  - ligne absente : écrite ;
 *  - ligne effacée par le serveur (expiration, purge) : appliquée quelle que soit l'heure locale ;
 *  - sinon seulement si elle n'est pas plus ancienne que celle de l'appareil (updatedAt), et différente : une ligne identique
 *    (relue par le recouvrement du curseur) n'est pas réécrite, sinon chaque synchro relancerait tous les calculs qui lisent
 *    la table (40 000 joueurs relus sur un téléphone). Une suppression (data.deleted) suit la même règle : c'est une version.
 */
export function keepRows<T extends ServerRow>(rows: readonly T[], locals: readonly LocalRow[]): T[] {
  const same = (r: T, l: NonNullable<LocalRow>) => (r.data.updatedAt ?? 0) === (l.updatedAt ?? 0) && JSON.stringify(r.data) === JSON.stringify(l)
  return rows.filter((r, i) => {
    const l = locals[i]
    return !l || r.data.purged === true || ((r.data.updatedAt ?? 0) >= (l.updatedAt ?? 0) && !same(r, l))
  })
}

// ---------- Regroupement ----------

export interface Timers {
  setTimeout(f: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

/**
 * Regroupe les tables signalées : chaque signal donne une table et un délai ; la relecture part à la première échéance
 * demandée, avec toutes les tables reçues d'ici là (un signal « large » retardé de 8 s suit une relecture déjà prévue dans
 * 1,5 s : une seule requête).
 */
export class Grouper<T> {
  private tables = new Set<T>()
  private timer: unknown = null
  private due = Infinity
  private readonly run: (tables: Set<T>) => void
  private readonly timers: Timers
  private readonly now: () => number

  constructor(run: (tables: Set<T>) => void, timers?: Timers, now: () => number = Date.now) {
    this.run = run
    this.timers = timers ?? { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) }
    this.now = now
  }

  add(table: T, delayMs: number) {
    this.tables.add(table)
    const at = this.now() + Math.max(0, delayMs)
    if (at >= this.due) return
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.due = at
    this.timer = this.timers.setTimeout(() => this.fire(), Math.max(0, delayMs))
  }

  /** Tables en attente (pour les tests et l'état affiché). */
  get pending(): number {
    return this.tables.size
  }

  /** Abandonne ce qui attend (déconnexion). */
  cancel() {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
    this.due = Infinity
    this.tables = new Set()
  }

  private fire() {
    const tables = this.tables
    this.cancel()
    if (tables.size) this.run(tables)
  }
}
