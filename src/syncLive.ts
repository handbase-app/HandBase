/*
 * Synchronisation allégée (supabase/057_synchro_legere.sql) : la partie PURE (ni Dexie, ni React, ni Supabase), testée par
 * tools/test-synchro-legere.ts. L'état et les appels au serveur vivent dans src/sync.ts.
 *  - canaux privés du compte, même règle que hb_mes_canaux() (miroir, pour le test et la lecture du code) ;
 *  - délai de relecture après un signal : regroupement 1,5 s ; canaux larges (commun, staff, tout) : + 0 à 10 s au hasard,
 *    pour que des milliers d'appareils ne relisent pas la même table à la même seconde ;
 *  - filet de sécurité : synchronisation complète toutes les 5 minutes quand le direct est abonné, toutes les minutes sinon ;
 *  - quelles tables relire d'après la réponse de hb_quoi_de_neuf ;
 *  - lignes reçues (relecture ou en direct) à garder face à celles de l'appareil ;
 *  - regroupement des signaux (Grouper) ; annonce d'une nouvelle version (vérification dans les 30 s) ;
 *  - ENVOI des signaux par l'appareil qui écrit (plan B : la base ne diffuse plus) : canaux d'une ligne, même règle que
 *    hb_canaux_ligne (rowChannels), et messages d'un envoi réussi, groupés, limités aux canaux ouverts (outgoingSignals) ;
 *  - PREMIÈRE SYNCHRONISATION allégée (essai de charge du 29/10) : lecture par pages (readPages, correcte quand le serveur
 *    plafonne à 1 000 lignes par réponse) ; affectations : toutes pour un administrateur, les siennes seulement pour les
 *    autres (assignmentScopeKey, planAssignmentScope ; clé « mes_affectations » de hb_quoi_de_neuf) ;
 *  - LIGNE DANS LE SIGNAL (série 5 du 29/10 : à 3 500 appareils, les relectures après chaque signal faisaient 80 % du temps
 *    de la base) : la ligne telle que le serveur l'a enregistrée voyage dans le signal (joueurs, mesures, avis, « vu »,
 *    seulement sur les canaux dont tous les abonnés peuvent la lire : rowFitsTopic), sinon ses seuls identifiants (relecture
 *    ciblée id=in.(…), sans recouvrement) ; à la réception, planLive, liveRowsToApply ; lignes reçues « à confirmer »
 *    jusqu'à la synchronisation complète suivante (Provisional, rowsToWrite, planVerify).
 */
import type { SyncTable } from './db'
import { playerClub, playerDepartment, type ServerScope } from './perimeter'

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

/** Tables dont la ligne entière est diffusée (rien de personnel, lues par tout le staff) : événement « ligne ». */
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

/**
 * Ligne telle que le serveur l'envoie (relecture : id, data, server_updated_at ; en direct et hb_upsert_lignes : aussi
 * deleted ; hb_upsert_lignes : aussi scope_dept / scope_club, le périmètre de la ligne pour le serveur, 046).
 */
export interface ServerRow {
  id: string
  data: { id?: string; updatedAt?: number; purged?: boolean; deleted?: boolean } & Record<string, unknown>
  server_updated_at?: string
  deleted?: boolean
  scope_dept?: string | null
  scope_club?: string | null
}

export interface Signal {
  table: SyncTable
  /** Identifiant et heure serveur de la (première) ligne : repères, pas une consigne (on relit la table). */
  id?: string
  v?: string
  /** Contenu de la ligne (événement « ligne », tables de CONTENT_TABLES). */
  row?: ServerRow
  /**
   * Signal CIBLÉ (appli du 29/10 et après : champs « lignes » ou « ids » présents) : les lignes enregistrées qu'il porte
   * (rows) et les identifiants à relire (ids) sont TOUT ce qui a changé ; rien d'autre n'est relu. Sans ces champs (appli
   * d'avant, ou envoi trop gros) : relecture de la table par curseur, comme avant.
   */
  targeted?: boolean
  rows?: ServerRow[]
  ids?: string[]
}

/** Au plus, par signal reçu : lignes et identifiants lus (un signal plus gros, mal formé ou forgé, n'est pas lu en entier). */
const PARSE_ROWS_MAX = 100
const PARSE_IDS_MAX = 500
const isId = (x: unknown): x is string => typeof x === 'string' && x !== '' && x.length <= 200

/** Une ligne reçue (contenu d'un signal, réponse de hb_upsert_lignes) ; null si mal formée (data.id différent compris). */
export function readServerRow(x: unknown): ServerRow | null {
  const l = x as { id?: unknown; data?: unknown; deleted?: unknown; server_updated_at?: unknown; scope_dept?: unknown; scope_club?: unknown } | null
  if (!l || typeof l !== 'object' || !isId(l.id) || !l.data || typeof l.data !== 'object' || Array.isArray(l.data)) return null
  const data = l.data as ServerRow['data']
  if (data.id !== undefined && data.id !== l.id) return null
  const row: ServerRow = { id: l.id, data }
  if (typeof l.deleted === 'boolean') row.deleted = l.deleted
  if (typeof l.server_updated_at === 'string') row.server_updated_at = l.server_updated_at
  for (const k of ['scope_dept', 'scope_club'] as const) if (typeof l[k] === 'string' || l[k] === null) row[k] = l[k] as string | null
  return row
}

/**
 * Lit un signal reçu en direct ({t, id, v, ligne?, lignes?, ids?}) ; null s'il est mal formé ou vise une table inconnue
 * (tables : SYNC_TABLES). Une table inconnue n'est jamais acceptée, avec ou sans lignes.
 */
export function parseSignal(payload: unknown, tables: readonly string[]): Signal | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as { t?: unknown; id?: unknown; v?: unknown; ligne?: unknown; lignes?: unknown; ids?: unknown }
  if (typeof p.t !== 'string' || !tables.includes(p.t)) return null
  const out: Signal = { table: p.t as SyncTable }
  if (typeof p.id === 'string') out.id = p.id
  if (typeof p.v === 'string') out.v = p.v
  const row = p.ligne === undefined ? null : readServerRow(p.ligne)
  if (row) out.row = row
  if (Array.isArray(p.lignes) || Array.isArray(p.ids)) {
    out.targeted = true
    const rows = (Array.isArray(p.lignes) ? p.lignes.slice(0, PARSE_ROWS_MAX) : []).map(readServerRow).filter((r): r is ServerRow => !!r)
    const ids = (Array.isArray(p.ids) ? p.ids.slice(0, PARSE_IDS_MAX) : []).filter(isId)
    // Lignes en trop ou mal formées : le signal n'est plus complet, la table est relue (prudence).
    const lost = (Array.isArray(p.lignes) && rows.length < p.lignes.length) || (Array.isArray(p.ids) && ids.length < p.ids.length)
    if (lost) out.targeted = false
    if (rows.length) out.rows = rows
    if (ids.length) out.ids = ids
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

/*
 * Affectations (hb_assignments) : à l'essai de charge, chaque appareil relisait TOUTES les affectations (20 000 comptes : 20
 * pages par appareil neuf, ~5 900 s de base sur le palier de 5 000), soit un coût qui croît comme le carré du nombre de
 * membres du staff. L'appareil n'en a besoin que pour lui (son périmètre affiché, ses pôles, l'organisateur proposé d'un
 * événement : src/perimeter.ts, src/poleSeason.ts, src/eventOrganizer.ts). Seul l'administrateur garde tout (écran Structure
 * modifiable, « Voir comme… », sauvegarde complète). L'écran Structure en lecture seule lit la liste complète À LA DEMANDE
 * (src/sync.ts, fetchAllAssignments). Ce n'est qu'un tri de ce qui est synchronisé : les droits de lecture ne changent pas.
 */
export type AssignmentScope = 'all' | 'mine'

/** Affectations reçues par l'appareil : toutes (administrateur), sinon les siennes (rôle encore inconnu compris). */
export const assignmentScope = (role: string | null | undefined): AssignmentScope => (role === 'admin' ? 'all' : 'mine')

/** Signature gardée sur l'appareil avec le curseur des affectations : « all », ou « mine:<compte> ». */
export const assignmentScopeKey = (role: string | null | undefined, uid: string) => (assignmentScope(role) === 'all' ? 'all' : `mine:${uid}`)

/**
 * Signature changée (rôle connu après le début de la synchro, administrateur nommé ou retiré, appareil d'avant ce tri) :
 *  - reset : relire depuis le début (les affectations des autres, devenues utiles, sont anciennes pour le curseur) ; toujours
 *    quand la signature change (relire les siennes seules ne coûte qu'une requête) ;
 *  - forgetOthers : retirer de l'appareil celles des autres (sauf celles qui attendent d'être envoyées).
 */
export function planAssignmentScope(prev: string | null, next: string): { reset: boolean; forgetOthers: boolean } {
  if (prev === next) return { reset: false, forgetOthers: false }
  return { reset: true, forgetOthers: next !== 'all' }
}

/** Affectations des autres à retirer de l'appareil (passage à « mine ») : jamais celles qui attendent d'être envoyées. */
export const otherAssignmentIds = (rows: readonly { id: string; userId?: string }[], uid: string, pending: ReadonlySet<string>) =>
  rows.filter((r) => r.userId !== uid && !pending.has(r.id)).map((r) => r.id)

/** Clé de hb_quoi_de_neuf pour les seules affectations du compte (057 : data.userId = le compte connecté). */
export const MY_ASSIGNMENTS_KEY = 'mes_affectations'

/**
 * Curseurs envoyés à hb_quoi_de_neuf : ceux des tables ; affectations du compte seulement (mine) : sous MY_ASSIGNMENTS_KEY
 * (sinon le serveur dirait « à relire » dès qu'une affectation d'un autre change, et l'appareil relirait pour rien à chaque fois).
 */
export function whatsNewRequest(cursors: Readonly<Record<string, string | null | undefined>>, mine: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [t, c] of Object.entries(cursors)) out[mine && t === 'assignments' ? MY_ASSIGNMENTS_KEY : t] = c ?? ''
  return out
}

/** Réponse de hb_quoi_de_neuf, ramenée aux tables (null : réponse illisible). Serveur sans la clé : absente, donc relue (prudence). */
export function whatsNewAnswer(data: unknown, mine: boolean): WhatsNew | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const out: WhatsNew = { ...(data as WhatsNew) }
  if (mine) {
    delete out.assignments
    if (MY_ASSIGNMENTS_KEY in out) out.assignments = out[MY_ASSIGNMENTS_KEY]
    delete out[MY_ASSIGNMENTS_KEY]
  }
  return out
}

// ---------- Lecture par pages ----------

/**
 * Lignes par page (relecture par curseur, identifiants visibles). Le serveur plafonne chaque réponse à db-max-rows lignes
 * (Supabase : 1 000 par défaut ; serveur autohébergé : PGRST_DB_MAX_ROWS=1000) : une page n'est la dernière que si elle est
 * PLUS COURTE que PULL_PAGE. PULL_PAGE ne doit donc jamais dépasser ce plafond (sinon une page pleine, coupée par le serveur,
 * passerait pour la dernière et la suite ne serait lue qu'à la synchronisation suivante).
 */
export const PULL_PAGE = 1000

/** Repère de la dernière ligne reçue : la page suivante commence strictement après (server_updated_at, id). */
export type PageKey = { at: string; id: string }

/**
 * Lit une table par pages triées (server_updated_at, id) : fetch(après) rend la page suivante (après null : la première,
 * depuis le curseur) ; onPage est appelé pour chaque page non vide, dans l'ordre. S'arrête sur une page vide ou plus courte
 * que pageSize. Renvoie le nombre de lignes reçues.
 */
export async function readPages<R extends { id: string; server_updated_at: string }>(
  fetch: (after: PageKey | null) => Promise<readonly R[]>,
  onPage: (rows: readonly R[]) => Promise<void> | void,
  pageSize = PULL_PAGE,
): Promise<number> {
  let after: PageKey | null = null
  let received = 0
  for (;;) {
    const rows = await fetch(after)
    if (!rows.length) break
    received += rows.length
    await onPage(rows)
    const last = rows[rows.length - 1]
    after = { at: last.server_updated_at, id: last.id }
    if (rows.length < pageSize) break
  }
  return received
}

// ---------- Lecture par périmètre (058) ----------

/*
 * LECTURE PAR PÉRIMÈTRE INDEXÉE (supabase/058_lecture_perimetre.sql ; essai de charge du 29/10, série 6 : les pages de mesures,
 * de « vu » et de joueurs étaient les requêtes les plus coûteuses). Sous la règle de lecture (« tout OU département OU club OU
 * auteur »), le serveur parcourait toute la table dans l'ordre des heures pour remplir une page d'un compte de club ;
 * hb_lire_perimetre(table, curseur, limite) lit la même page par des index (club, département, auteur), avec les mêmes
 * règles (SECURITY INVOKER : elle ne peut rendre que ce que la lecture directe rendrait).
 *  - qui : les comptes qui ne voient pas tout (club, comité, ligue, pôle, joueur, rôle encore inconnu) ; administrateur et
 *    périmètre « tout » connu sur l'appareil : lecture directe, comme avant (pullReader) ;
 *  - pages suivantes : « server_updated_at >= heure de la dernière ligne reçue » (un index sur trois colonnes ne lit pas le
 *    OU de l'ancien filtre), et l'appareil écarte les lignes de cette heure déjà reçues ; une page PLEINE d'une seule heure
 *    (import de masse) : page suivante à l'ancien filtre (lecture directe, heure >, ou = et id >), sinon la même page
 *    reviendrait sans fin (readScopedPages) ;
 *  - fonction absente (058 pas passé) : la même demande (>= curseur) en lecture directe : mêmes lignes, sans index.
 */

/**
 * Ordre de lecture des tables (premier chargement comme synchronisation ordinaire) : SERVIR D'ABORD LE PÉRIMÈTRE DU COMPTE.
 * D'abord les petites tables qui font l'appli (configuration du sport, critères, listes, structure et ses affectations : une
 * page chacune), puis les joueurs du périmètre et ce qui leur est rattaché (mesures, avis, « vu ») : l'appli s'ouvre dès la
 * première page de joueurs (src/splash.ts) ; enfin le reste. Contraintes de src/sync.ts (pull) : les staffs avant les groupes
 * (un staff changé fait relire les groupes « Mon staff ») et les groupes avant « à revoir ».
 */
export const PULL_ORDER: readonly SyncTable[] = [
  'config', 'criteria', 'lists', 'levels', 'units', 'assignments',
  'players', 'measurements', 'evaluations', 'seen',
  'teams', 'events', 'groups', 'alerts', 'follows', 'videos', 'rewatch', 'question_log', 'saved_questions',
]

/** Tables lues par hb_lire_perimetre (058) ; les autres (dont « à revoir », règle plus étroite) : lecture directe. */
export const PERIMETER_TABLES: readonly SyncTable[] = ['players', 'measurements', 'evaluations', 'seen']

/**
 * Lecture d'une table pour ce compte : « perimetre » (hb_lire_perimetre) ou « table » (lecture directe d'avant). role : rôle
 * gardé sur l'appareil (null : inconnu) ; scopeSig : signature du périmètre reçu (src/perimeter.ts, scopeSignature ; null :
 * pas encore lu) ; missing : fonction absente du serveur (récemment).
 */
export function pullReader(table: SyncTable, role: string | null, scopeSig: string | null, missing: boolean): 'perimetre' | 'table' {
  if (missing || !PERIMETER_TABLES.includes(table)) return 'table'
  if (role === 'admin') return 'table'
  if (scopeSig) {
    try {
      if ((JSON.parse(scopeSig) as { all?: boolean }).all === true) return 'table'
    } catch {
      /* signature illisible : périmètre inconnu */
    }
  }
  return 'perimetre'
}

/** Demande d'une page : depuis une heure incluse (hb_lire_perimetre, ou lecture directe >=), ou après (heure, id) (ancien filtre). */
export type ScopedRequest = { since: string } | { after: PageKey }

/**
 * Lit une table par pages avec le protocole de 058 (voir plus haut) : fetch(demande) rend la page brute, triée
 * (server_updated_at, id) ; onPage reçoit les seules lignes nouvelles, et more : la page brute était pleine (d'autres
 * suivent, même si des égalités ont été écartées). Première demande : depuis since. S'arrête sur une page brute plus courte
 * que pageSize. Renvoie le nombre de lignes reçues (sans les égalités écartées).
 */
export async function readScopedPages<R extends { id: string; server_updated_at: string }>(
  since: string,
  fetch: (req: ScopedRequest) => Promise<readonly R[]>,
  onPage: (rows: readonly R[], more: boolean) => Promise<void> | void,
  pageSize = PULL_PAGE,
): Promise<number> {
  let req: ScopedRequest = { since }
  /** Dernière ligne reçue (la plus avancée dans l'ordre du serveur). */
  let after: PageKey | null = null
  /** Identifiants déjà reçus à l'heure after.at. */
  let atHour = new Set<string>()
  let received = 0
  for (let guard = 0; guard < 1_000_000; guard++) {
    const raw: readonly R[] = await fetch(req)
    if (!raw.length) break
    // « >= » : les lignes de l'heure de la dernière ligne reçue, déjà reçues, reviennent : écartées.
    const prev: PageKey | null = after
    const rows: readonly R[] = 'since' in req && prev ? raw.filter((r) => !(r.server_updated_at === prev.at && atHour.has(r.id))) : raw
    if (rows.length) {
      received += rows.length
      await onPage(rows, raw.length >= pageSize)
      for (const r of rows as R[]) {
        if (!after || r.server_updated_at !== after.at) atHour = new Set()
        atHour.add(r.id)
        after = { at: r.server_updated_at, id: r.id }
      }
    }
    if (raw.length < pageSize) break
    // Page pleine d'une seule heure : la suivante à l'ancien filtre (strictement après la dernière ligne reçue).
    const single = raw[0].server_updated_at === raw[raw.length - 1].server_updated_at
    if (!after) break // (impossible : une page non vide a au moins une ligne nouvelle ou déjà reçue)
    req = single ? { after } : { since: after.at }
  }
  return received
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

// ---------- Envoi des signaux (l'appareil qui écrit prévient) ----------

/** Ligne envoyée au serveur (contenu de l'appareil, tel que la file l'a poussé). */
export interface SentRow {
  id: string
  updatedAt?: number
  deleted?: boolean
  [k: string]: unknown
}

/**
 * Ce que l'appareil sait des lignes citées par une ligne envoyée (lu dans sa base locale par src/sync.ts) :
 *  - player : la fiche d'un joueur (département et club, comme scope_dept / scope_club de 046) ;
 *  - territory : territoire d'une unité organisatrice (048) ; undefined : unité inconnue de l'appareil ;
 *  - teamMembers : membres des staffs choisis (hb_team_members, 034 : staffs non supprimés).
 */
export interface ChannelLookup {
  player(id: string): { clubCode?: string; license?: string; department?: string } | undefined
  territory(unitId: string): { depts: string[]; clubs: string[] } | undefined
  teamMembers(teamIds: readonly string[]): string[]
}

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && v !== '') : [])
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x : undefined)

/**
 * Canaux de ceux qui lisent une ligne : MÊME RÈGLE que hb_canaux_ligne (supabase/057_synchro_legere.sql), calculée sur la
 * ligne de l'appareil. Différences, toutes sans effet sur l'envoi (on ne garde ensuite que les canaux que l'appareil écoute,
 * et un compte du staff n'écoute jamais hb:joueur:…) :
 *  - fiche d'un jeune qui a un compte (hb:joueur:…) : l'appareil ne le sait pas, rien ;
 *  - événement dont l'unité organisatrice est inconnue de l'appareil : staff ET tout (le serveur dirait l'un ou l'autre).
 * Trop prévenir est sans danger (l'appareil prévenu relit par sa règle de lecture et ne reçoit rien) ; trop peu n'arrive
 * qu'avec une base locale incomplète, et le filet de sécurité le rattrape.
 */
export function rowChannels(table: SyncTable, row: SentRow, look: ChannelLookup): string[] {
  const author = str(row.createdBy) && `hb:compte:${row.createdBy}`
  const perimeter = (p: { clubCode?: string; license?: string; department?: string } | undefined) => {
    const d = p && playerDepartment(p)
    const c = p && playerClub(p)
    return [ALL_TOPIC, d && `hb:dept:${d}`, c && `hb:club:${c}`, author]
  }
  const participants = () => [...strings(row.editors), ...look.teamMembers(strings(row.teams))].map((u) => `hb:compte:${u}`)
  let out: (string | false | undefined)[]
  switch (table) {
    case 'players':
      out = perimeter(row as { clubCode?: string; license?: string; department?: string })
      break
    case 'measurements':
    case 'evaluations':
    case 'seen':
    case 'rewatch':
      out = perimeter(str(row.playerId) ? look.player(row.playerId as string) : undefined)
      break
    case 'videos':
      out = row.targetKind === 'player' ? perimeter(str(row.targetId) ? look.player(row.targetId as string) : undefined) : [STAFF_TOPIC]
      break
    case 'follows':
    case 'saved_questions':
      out = [author]
      break
    case 'teams':
      out = [author, ...strings(row.members).map((u) => `hb:compte:${u}`)]
      break
    case 'groups':
      out = row.private === true ? [author] : row.team === true ? [author, ...participants()] : [STAFF_TOPIC, author]
      break
    case 'alerts':
      out = row.private === true ? [author] : [STAFF_TOPIC]
      break
    case 'events': {
      const unit = str(row.organizerUnitId)?.trim()
      if (!unit) {
        out = [STAFF_TOPIC]
        break
      }
      const t = look.territory(unit)
      const players = strings(row.playerIds).map((id) => look.player(id)).filter((p): p is NonNullable<typeof p> => !!p)
      const depts = [...(t?.depts ?? []), ...players.map((p) => playerDepartment(p))]
      const clubs = [...(t?.clubs ?? []), ...players.map((p) => playerClub(p))]
      out = [
        ...(t ? [] : [STAFF_TOPIC]),
        ALL_TOPIC,
        author,
        ...depts.map((d) => d && `hb:dept:${d}`),
        ...clubs.map((c) => c && `hb:club:${c}`),
        ...participants(),
      ]
      break
    }
    case 'criteria':
    case 'levels':
    case 'units':
    case 'assignments':
      out = [STAFF_TOPIC]
      break
    case 'config':
    case 'lists':
      out = [COMMON_TOPIC]
      break
    case 'question_log':
      out = [ALL_TOPIC]
      break
    default:
      out = []
  }
  return [...new Set(out.filter((x): x is string => typeof x === 'string' && x !== ''))].sort()
}

/** Champs d'une ligne qui décident de ses canaux (rowChannels) : seuls gardés après un envoi, hors tables de contenu. */
const CHANNEL_FIELDS = ['id', 'updatedAt', 'deleted', 'createdBy', 'clubCode', 'license', 'department', 'playerId', 'targetKind', 'targetId', 'members', 'private', 'team', 'editors', 'teams', 'organizerUnitId', 'playerIds'] as const

/**
 * Ce qu'il faut garder d'une ligne envoyée pour la signaler : la ligne entière pour configuration, critères et niveaux
 * (contenu diffusé) ; sinon les seuls champs qui décident des canaux (un import de 40 000 fiches ne garde pas les fiches
 * en mémoire, ni rien de personnel).
 */
export function forSignal(table: SyncTable, row: SentRow): SentRow {
  if (CONTENT_TABLES.includes(table)) return row
  const out: SentRow = { id: row.id }
  for (const k of CHANNEL_FIELDS) if (row[k] !== undefined) (out as Record<string, unknown>)[k] = row[k]
  return out
}

/**
 * Message à envoyer sur un canal (broadcast) : même forme que ceux que la base envoyait ({t, id, v[, ligne]}), plus, pour un
 * signal ciblé, les lignes enregistrées (lignes) et les identifiants à relire (ids). Une appli d'avant ne lit que {t, id, v}
 * et relit la table : rien ne casse.
 */
export interface OutgoingSignal {
  topic: string
  event: 'signal' | 'ligne'
  payload: {
    t: SyncTable
    id: string
    v: string
    ligne?: { id: string; data: Record<string, unknown>; deleted: boolean }
    lignes?: ServerRow[]
    ids?: string[]
  }
}

/** Au-delà, un envoi de configuration, critères ou niveaux part en un seul signal (un import de 300 critères = 1 message). */
export const CONTENT_MAX = 20

/** Contenu diffusé d'une ligne : sans les noms des comptes (« créé par », « modifié par ») ; la relecture les apporte. */
const withoutNames = (row: SentRow): Record<string, unknown> => Object.fromEntries(Object.entries(row).filter(([k]) => !/ByName$/.test(k)))

/**
 * Messages à envoyer après un envoi réussi (sent : par table, les lignes acceptées par le serveur et, pour joueurs, mesures,
 * avis et « vu », ces lignes TELLES QUE LE SERVEUR LES A ENREGISTRÉES, réponse de hb_upsert_lignes) :
 *  - seulement sur les canaux ouverts par l'appareil (open : abonnés, donc permis par la règle hb_emettre) ;
 *  - un seul signal par table et par canal ({t, id de la première ligne, v}) ; jamais de nom ;
 *  - signal CIBLÉ (packSignal) : les lignes enregistrées qui peuvent voyager sur ce canal (rowFitsTopic) dans « lignes »,
 *    jusqu'à SIGNAL_MAX_BYTES par message, et les identifiants des autres dans « ids » (relus par identifiant) ; trop
 *    d'identifiants, ou table relue autrement (ID_TABLES) : signal simple, la table est relue par curseur comme avant ;
 *  - canaux d'une ligne enregistrée : son périmètre selon le serveur (serverRowChannels, colonnes scope_* de 046) ; sinon
 *    calculés sur la ligne de l'appareil (rowChannels) ;
 *  - configuration, critères, niveaux : la ligne entière, une par ligne (événement « ligne »), jusqu'à CONTENT_MAX lignes
 *    par table ; au-delà, un seul signal.
 * v : heure de l'envoi (l'appareil ne connaît pas l'heure serveur) ; repère seulement.
 */
export function outgoingSignals(
  sent: readonly { table: SyncTable; rows: readonly SentRow[]; server?: readonly ServerRow[] }[],
  open: ReadonlySet<string>,
  look: ChannelLookup,
  now: string,
): OutgoingSignal[] {
  const out: OutgoingSignal[] = []
  const byTable = new Map<SyncTable, { rows: Map<string, SentRow>; server: Map<string, ServerRow> }>()
  for (const s of sent) {
    const t = byTable.get(s.table) ?? { rows: new Map<string, SentRow>(), server: new Map<string, ServerRow>() }
    for (const r of s.rows) t.rows.set(r.id, r)
    for (const r of s.server ?? []) t.server.set(r.id, r)
    byTable.set(s.table, t)
  }
  for (const [table, { rows, server }] of byTable) {
    const list = [...rows.values()]
    const content = CONTENT_TABLES.includes(table) && list.length <= CONTENT_MAX
    const groups = new Map<string, string[]>() // canal → identifiants, dans l'ordre de l'envoi
    for (const row of list) {
      const stored = ROW_TABLES.includes(table) ? server.get(row.id) : undefined
      for (const topic of stored ? serverRowChannels(table, stored) : rowChannels(table, row, look)) {
        if (!open.has(topic)) continue
        if (content) {
          out.push({ topic, event: 'ligne', payload: { t: table, id: row.id, v: now, ligne: { id: row.id, data: withoutNames(row), deleted: !!row.deleted } } })
          continue
        }
        const ids = groups.get(topic) ?? []
        if (!groups.has(topic)) groups.set(topic, ids)
        ids.push(row.id)
      }
    }
    for (const [topic, ids] of groups) out.push({ topic, event: 'signal', payload: packSignal(table, topic, ids, server, now) })
  }
  return out
}

// ---------- Ligne dans le signal (série 5 du 29/10) ----------
//
// POURQUOI : à l'essai de charge du 29/10 (3 500 appareils, profil « jour de détection »), chaque écriture était reçue par
// ~18 appareils, et chacun relisait la table depuis son curseur moins 60 s de recouvrement : ~280 000 relectures de
// hb_measurements et hb_seen, 80 % du temps de la base. L'appareil qui écrit met maintenant la ligne enregistrée dans le
// signal ; ceux qui la reçoivent l'appliquent sans rien relire ; une ligne trop grosse (ou une table qui ne voyage pas) :
// ses seuls identifiants, relus par identifiant (id=in.(…), sans recouvrement). Le filet de sécurité (« quoi de neuf ? »
// toutes les 5 minutes, curseur et recouvrement) ne change pas : il rattrape ce qui manque, et le curseur n'est JAMAIS
// avancé par une ligne reçue en direct ni par une relecture ciblée (sauf confirmation par l'empreinte du filet économe, 059 :
// src/filet.ts).
//
// SÉCURITÉ (le contenu ne doit aller qu'à qui peut le lire par la synchronisation normale) :
//  - les lignes viennent de hb_upsert_lignes (057), SECURITY INVOKER : relues dans la transaction d'écriture avec les règles
//    de lecture de celui qui écrit ;
//  - elles ne voyagent que pour ROW_TABLES, dont la règle de lecture est EXACTEMENT « rôle du staff et (tout, ou département
//    couvert, ou club couvert, ou auteur) » (046 : staff_read sur scope_dept / scope_club) ; et seulement sur un canal dont
//    l'abonnement implique ce droit (rowFitsTopic) : hb:tout (périmètre « tout »), hb:dept:<scope_dept de la ligne>,
//    hb:club:<scope_club de la ligne>, ou son propre canal hb:compte:… (ses autres appareils). hb_mes_canaux donne ces canaux
//    avec le MÊME périmètre (hb_scope_of) que la règle de lecture, et Realtime refuse l'abonnement aux autres (hb_recevoir) ;
//  - « à revoir » (règle de lecture plus étroite que le périmètre, 041), vidéos, staffs, groupes, événements… : jamais de
//    contenu, seulement les identifiants (relus avec les règles de lecture du destinataire) ;
//  - à la réception, mêmes contrôles (table connue : parseSignal ; rowFitsTopic avec le canal d'arrivée : une ligne qui n'a
//    rien à faire sur ce canal est relue au lieu d'être appliquée) ; une ligne reçue est « à confirmer » : la synchronisation
//    complète suivante la remplace par la version du serveur (ou la retire), quelle que soit son heure (Provisional).

/** Tables dont la ligne enregistrée voyage dans le signal (règle de lecture = périmètre exactement, 046). */
export const ROW_TABLES: readonly SyncTable[] = ['players', 'measurements', 'evaluations', 'seen']

/**
 * Tables relues PAR IDENTIFIANT après un signal ciblé. Les autres gardent la relecture par curseur : staffs (teams : une
 * entrée dans un staff ouvre des groupes qui, eux, n'ont pas changé ; la synchronisation le voit en comparant les staffs
 * avant et après leur relecture), affectations (les siennes seulement, filtre user_id), journal des questions (écriture
 * seule hors administrateurs), configuration, critères et niveaux (contenu diffusé par l'événement « ligne »).
 */
export const ID_TABLES: readonly SyncTable[] = ['players', 'measurements', 'events', 'evaluations', 'groups', 'lists', 'alerts', 'follows', 'videos', 'seen', 'rewatch', 'units', 'saved_questions']

/** Plafond d'un signal ciblé : charge utile en JSON, en octets UTF-8 (lignes et identifiants compris). */
export const SIGNAL_MAX_BYTES = 6000
/** Lignes enregistrées demandées au plus à hb_upsert_lignes par paquet (au-delà, un import : identifiants seulement). */
export const LIVE_ROWS_MAX = 20
/** Une version reçue en direct plus de 5 minutes en avance sur l'horloge de l'appareil est écartée (relue), comme le serveur. */
export const FUTURE_MS = 5 * 60_000
/** Identifiants par requête de relecture ciblée (id=in.(…)). */
export const IDS_PER_READ = 100
/** Lignes reçues en direct en attente de confirmation, au plus (au-delà : relues par identifiant au lieu d'être appliquées). */
export const PROVISIONAL_MAX = 2000

const utf8 = (s: string) => new TextEncoder().encode(s).length

/** Canaux d'une ligne ENREGISTRÉE de ROW_TABLES : son périmètre selon le serveur (même règle que staff_read, 046). */
export function serverRowChannels(table: SyncTable, row: ServerRow): string[] {
  if (!ROW_TABLES.includes(table)) return []
  const author = str(row.data.createdBy)
  return [...new Set([ALL_TOPIC, str(row.scope_dept) && `hb:dept:${row.scope_dept}`, str(row.scope_club) && `hb:club:${row.scope_club}`, author && `hb:compte:${author}`].filter((x): x is string => !!x))].sort()
}

/**
 * La ligne enregistrée peut-elle voyager sur ce canal ? Oui seulement si TOUT abonné du canal peut la lire par la
 * synchronisation normale : table de ROW_TABLES, et canal « tout », son département, son club, ou un canal de compte (on
 * n'écoute et n'émet que sur le sien : ce sont les autres appareils du même compte).
 */
export function rowFitsTopic(table: SyncTable, topic: string, row: ServerRow): boolean {
  if (!ROW_TABLES.includes(table)) return false
  if (topic === ALL_TOPIC || topic.startsWith('hb:compte:')) return true
  if (topic.startsWith('hb:dept:')) return !!str(row.scope_dept) && topic === `hb:dept:${row.scope_dept}`
  if (topic.startsWith('hb:club:')) return !!str(row.scope_club) && topic === `hb:club:${row.scope_club}`
  return false
}

/** Ligne telle qu'elle part dans le signal : les seuls champs de ServerRow. */
const wireRow = (r: ServerRow): ServerRow => {
  const w: ServerRow = { id: r.id, data: r.data }
  if (r.deleted !== undefined) w.deleted = r.deleted
  if (r.server_updated_at !== undefined) w.server_updated_at = r.server_updated_at
  if (r.scope_dept !== undefined) w.scope_dept = r.scope_dept
  if (r.scope_club !== undefined) w.scope_club = r.scope_club
  return w
}

/**
 * Charge utile d'un signal (une table, un canal, les identifiants envoyés dans l'ordre) : {t, id, v} toujours ; table de
 * ID_TABLES : les lignes enregistrées qui peuvent voyager sur ce canal, tant que le message reste sous SIGNAL_MAX_BYTES, et
 * les identifiants des autres. Tous les identifiants ne tiennent pas : signal simple (relecture par curseur).
 */
export function packSignal(table: SyncTable, topic: string, ids: readonly string[], server: ReadonlyMap<string, ServerRow>, now: string): OutgoingSignal['payload'] {
  const base: OutgoingSignal['payload'] = { t: table, id: ids[0], v: now }
  if (!ID_TABLES.includes(table) || !ids.length) return base
  const idBytes = ids.map((id) => utf8(JSON.stringify(id)) + 1)
  let size = utf8(JSON.stringify({ ...base, lignes: [], ids: [] })) + idBytes.reduce((a, b) => a + b, 0)
  if (size > SIGNAL_MAX_BYTES) return base
  const lignes: ServerRow[] = []
  const rest: string[] = []
  ids.forEach((id, i) => {
    const r = server.get(id)
    if (r && rowFitsTopic(table, topic, r)) {
      const w = wireRow(r)
      const grow = utf8(JSON.stringify(w)) + 1 - idBytes[i]
      if (size + grow <= SIGNAL_MAX_BYTES) {
        lignes.push(w)
        size += grow
        return
      }
    }
    rest.push(id)
  })
  return { ...base, ...(lignes.length ? { lignes } : {}), ...(rest.length ? { ids: rest } : {}) }
}

/**
 * Que faire d'un signal reçu sur ce canal ? rows : lignes à appliquer ; ids : à relire par identifiant ; table : relire la
 * table par curseur (signal simple, appli d'avant, table relue autrement). Une ligne qui ne peut pas voyager sur ce canal
 * (rowFitsTopic) n'est pas appliquée : elle est relue, avec les règles de lecture du destinataire.
 */
export function planLive(s: Signal, topic: string): { rows: ServerRow[]; ids: string[]; table: boolean } {
  if (!s.targeted || !ID_TABLES.includes(s.table)) return { rows: [], ids: [], table: true }
  const rows: ServerRow[] = []
  const ids = new Set(s.ids ?? [])
  for (const r of s.rows ?? []) {
    if (rowFitsTopic(s.table, topic, r)) rows.push(r)
    else ids.add(r.id)
  }
  for (const r of rows) ids.delete(r.id)
  return { rows, ids: [...ids], table: false }
}

/**
 * Lignes reçues en direct à écrire sur l'appareil (locals : celles de l'appareil, même ordre ; pending : identifiants qui
 * attendent d'être envoyés) : jamais par-dessus un envoi en attente (l'envoi tranchera : accepté, c'est la plus récente ;
 * refusé, l'appareil reprend la version du serveur) ; version plus de FUTURE_MS en avance sur l'horloge de l'appareil :
 * écartée, relue par identifiant (reread) ; sinon la règle de toute ligne reçue (keepRows : jamais par-dessus une version
 * plus récente, ligne identique pas réécrite).
 */
export function liveRowsToApply<T extends ServerRow>(rows: readonly T[], locals: readonly LocalRow[], pending: ReadonlySet<string>, now: number): { apply: T[]; reread: string[] } {
  const reread: string[] = []
  const ok: T[] = []
  const okLocals: LocalRow[] = []
  rows.forEach((r, i) => {
    if (pending.has(r.id)) return
    const at = r.data.updatedAt
    if (at !== undefined && (typeof at !== 'number' || !Number.isFinite(at) || at > now + FUTURE_MS)) {
      reread.push(r.id)
      return
    }
    ok.push(r)
    okLocals.push(locals[i])
  })
  return { apply: keepRows(ok, okLocals), reread }
}

/** Lignes reçues en direct, à confirmer : table → identifiant → heure de réception (horloge de l'appareil). */
export type Provisional = Record<string, Record<string, number>>

/** Relit la liste gardée sur l'appareil (texte JSON) ; illisible : vide. */
export function readProvisional(text: string | null): Provisional {
  try {
    const p = JSON.parse(text ?? '{}') as unknown
    if (!p || typeof p !== 'object' || Array.isArray(p)) return {}
    const out: Provisional = {}
    for (const [t, ids] of Object.entries(p as Record<string, unknown>)) {
      if (!ids || typeof ids !== 'object' || Array.isArray(ids)) continue
      const keep = Object.entries(ids as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number')
      if (keep.length) out[t] = Object.fromEntries(keep)
    }
    return out
  } catch {
    return {}
  }
}

export const provisionalCount = (p: Provisional) => Object.values(p).reduce((n, ids) => n + Object.keys(ids).length, 0)

/** Note des lignes reçues (nouvelle liste ; la plus récente réception l'emporte). */
export function markProvisional(p: Provisional, table: string, ids: readonly string[], at: number): Provisional {
  if (!ids.length) return p
  return { ...p, [table]: { ...(p[table] ?? {}), ...Object.fromEntries(ids.map((id) => [id, at])) } }
}

/** Identifiants d'une table reçus AVANT `before` (une lecture partie à `before` donne pour eux la version du serveur). */
export function provisionalBefore(p: Provisional, table: string, before: number): Set<string> {
  return new Set(Object.entries(p[table] ?? {}).filter(([, at]) => at < before).map(([id]) => id))
}

/** Retire des identifiants confirmés (nouvelle liste). */
export function dropProvisional(p: Provisional, table: string, ids: Iterable<string>): Provisional {
  const left = { ...(p[table] ?? {}) }
  let changed = false
  for (const id of ids) {
    if (id in left) {
      delete left[id]
      changed = true
    }
  }
  if (!changed) return p
  const out = { ...p }
  if (Object.keys(left).length) out[table] = left
  else delete out[table]
  return out
}

/**
 * Lignes du serveur (relecture) à écrire : keepRows, plus celles qui confirment une ligne reçue en direct (force) : la
 * version du serveur l'emporte alors QUELLE QUE SOIT son heure (une ligne forgée, datée dans le futur, ne survit pas), sauf
 * sur un envoi en attente (pending) ; identique : pas réécrite.
 */
export function rowsToWrite<T extends ServerRow>(rows: readonly T[], locals: readonly LocalRow[], force: ReadonlySet<string>, pending: ReadonlySet<string>): T[] {
  const kept = new Set(keepRows(rows, locals))
  return rows.filter((r, i) => {
    if (kept.has(r)) return true
    if (!force.has(r.id) || pending.has(r.id)) return false
    const l = locals[i]
    return !l || JSON.stringify(r.data) !== JSON.stringify(l)
  })
}

/**
 * Vérification des lignes reçues en direct que la synchronisation complète n'a pas relues (ids) : celles que le serveur
 * rend (found) remplacent celles de l'appareil ; les autres (inconnues du serveur ou plus visibles) sont retirées ; jamais
 * une ligne qui attend d'être envoyée.
 */
export function planVerify<T extends ServerRow>(ids: readonly string[], found: readonly T[], pending: ReadonlySet<string>): { put: T[]; remove: string[] } {
  const byId = new Map(found.map((r) => [r.id, r]))
  return {
    put: found.filter((r) => ids.includes(r.id) && !pending.has(r.id)),
    remove: ids.filter((id) => !byId.has(id) && !pending.has(id)),
  }
}

/** Réponse de hb_upsert_lignes ({refusees, lignes}) ; ancienne réponse de hb_upsert (tableau des refusées) : sans lignes. */
export function writeAnswer(data: unknown): { rejected: string[]; rows: ServerRow[] | null } {
  if (Array.isArray(data)) return { rejected: data.filter((x): x is string => typeof x === 'string'), rows: null }
  const d = (data ?? {}) as { refusees?: unknown; lignes?: unknown }
  const rejected = Array.isArray(d.refusees) ? d.refusees.filter((x): x is string => typeof x === 'string') : []
  const rows = Array.isArray(d.lignes) ? d.lignes.map(readServerRow).filter((r): r is ServerRow => !!r) : null
  return { rejected, rows }
}

/** Clé d'une relecture ciblée en attente (table et identifiant ; un nom de table n'a jamais de « : »). */
export const liveKey = (table: SyncTable, id: string) => `${table}:${id}`

/** Relectures ciblées regroupées → identifiants par table (tables : SYNC_TABLES ; clé d'une table inconnue : ignorée). */
export function splitLiveKeys(keys: Iterable<string>, tables: readonly string[]): Map<SyncTable, string[]> {
  const out = new Map<SyncTable, string[]>()
  for (const k of keys) {
    const i = k.indexOf(':')
    if (i <= 0) continue
    const t = k.slice(0, i)
    if (!tables.includes(t)) continue
    const list = out.get(t as SyncTable) ?? []
    list.push(k.slice(i + 1))
    out.set(t as SyncTable, list)
  }
  return out
}
