import { createClient, isAuthRetryableFetchError, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { db, SYNC_TABLES, TRIAL, type Assignment, type SyncTable } from './db'
import { disablePush } from './push'
import { retireUnpublishedCriteria } from './criteriaImport'
import { aggregate, forward, startTable, type SyncProgress, type TableProgress } from './syncProgress'
import { retryingFetch } from './retry'
import { questionLogRights } from './questionLogCore'
import { orphanIds, planScopeChange, SCOPED_TABLES, scopeSignature, type ServerScope } from './perimeter'
import { spyTarget } from './spy'
import { playerReadsTable } from './playerSpace'
import { unitTerritory } from './eventOrganizer'
import {
  assignmentScope,
  assignmentScopeKey,
  CONTENT_TABLES,
  dropProvisional,
  dueForSync,
  forSignal,
  GROUP_MS,
  Grouper,
  IDS_PER_READ,
  LIVE_EVENTS,
  LIVE_ROWS_MAX,
  liveKey,
  liveRowsToApply,
  markProvisional,
  otherAssignmentIds,
  outgoingSignals,
  parseSignal,
  planAssignmentScope,
  planLive,
  planPull,
  planVerify,
  PROVISIONAL_MAX,
  provisionalBefore,
  provisionalCount,
  PULL_ORDER,
  PULL_PAGE,
  pullDelay,
  pullReader,
  readPages,
  readProvisional,
  readScopedPages,
  ROW_TABLES,
  rowsToWrite,
  SIGNAL_MAX_BYTES,
  splitLiveKeys,
  whatsNewAnswer,
  whatsNewRequest,
  writeAnswer,
  type ChannelLookup,
  type PageKey,
  type Provisional,
  type ScopedRequest,
  type SentRow,
  type ServerRow,
  type WhatsNew,
} from './syncLive'

/*
 * Synchronisation « hors ligne d'abord » :
 *  - toutes les écritures vont dans IndexedDB + une file d'attente (outbox) ;
 *  - quand le réseau est là, on pousse la file vers Supabase puis on tire les
 *    changements des autres appareils ;
 *  - en cas de conflit, la version la plus récente (updatedAt) l'emporte ;
 *  - en direct : le serveur prévient (Supabase Realtime) dès qu'une donnée change, et l'appli
 *    va chercher les nouveautés aussitôt (sinon, au plus tard toutes les minutes).
 * Sans configuration Supabase, l'application fonctionne en local uniquement.
 *
 * Synchronisation ALLÉGÉE (supabase/057_synchro_legere.sql, règles pures dans src/syncLive.ts) :
 *  - une synchronisation complète demande d'abord « quoi de neuf ? » (hb_quoi_de_neuf : une requête, les curseurs de
 *    toutes les tables) et ne relit que les tables signalées ; rien de changé : une seule requête ;
 *  - en direct, l'APPAREIL QUI ÉCRIT envoie, après chaque envoi réussi, un SIGNAL ({t, id, v} : ni nom ni contenu) sur
 *    ceux de ses canaux privés qui lisent les lignes envoyées (hb:dept:…, hb:club:…, hb:tout, hb:compte:…, hb:staff,
 *    hb:commun ; liste donnée par hb_mes_canaux ; canaux d'une ligne : src/syncLive.ts, rowChannels) ; jamais sur un canal
 *    qu'il n'écoute pas (le serveur le refuserait : règle hb_emettre). Ce qui ne vient pas d'un appareil (SQL, imports,
 *    tâches de nuit) n'est pas signalé : le filet de sécurité le rattrape ;
 *    à la réception, l'appli ne relit que la table signalée, après 1,5 s de regroupement (canaux larges : + 0 à 10 s au
 *    hasard) ; configuration, critères et niveaux arrivent avec leur contenu (appliqué comme une ligne relue, curseur
 *    inchangé) ;
 *  - une écriture de l'appareil n'envoie que la file (ses autres appareils sont prévenus par hb:compte:…) ;
 *  - filet de sécurité : synchronisation complète toutes les 5 minutes quand le direct est abonné, toutes les minutes
 *    sinon ; toujours au retour sur l'appli et au retour du réseau ;
 *  - une nouvelle version annoncée (hb_annoncer_version, canal commun) : vérification de la mise à jour dans les 30 s.
 *  Serveur sans 057 (fonctions absentes) : relecture complète des 19 tables et postgres_changes, comme avant.
 *
 * PREMIÈRE SYNCHRONISATION allégée (essai de charge du 29/10 : 5 000 appareils ouverts en 5 minutes saturaient la base) :
 *  - aucun comptage d'avance (18 requêtes HEAD par appareil neuf) : l'avancement se lit dans les pages reçues
 *    (src/syncProgress.ts) ;
 *  - affectations : toutes pour un administrateur, les siennes seulement pour les autres (src/syncLive.ts, assignmentScope) ;
 *    l'écran Structure lit la liste complète à la demande (fetchAllAssignments) ;
 *  - appareil neuf : pas de relecture des identifiants visibles ni de vérification des joueurs juste après avoir tout reçu.
 *
 * LIGNE DANS LE SIGNAL (essai de charge du 29/10, série 5 : à 3 500 appareils, les relectures déclenchées par les signaux
 * faisaient 80 % du temps de la base ; règles pures et sécurité : src/syncLive.ts, section « Ligne dans le signal ») :
 *  - joueurs, mesures, avis, « vu » partent par hb_upsert_lignes (057) : mêmes contrôles que hb_upsert, et les lignes telles
 *    que le serveur les a enregistrées (petits envois) ; l'appareil qui écrit les reprend aussitôt, puis les met dans son
 *    signal, sur les seuls canaux dont tous les abonnés peuvent les lire ; les autres lignes : leurs identifiants ;
 *  - à la réception : lignes appliquées sans rien relire (jamais par-dessus une version plus récente ni un envoi en attente),
 *    identifiants relus par identifiant (id=in.(…), sans recouvrement) après le regroupement de 1,5 s ; signal simple (appli
 *    d'avant, gros envoi) : relecture de la table par curseur, comme avant ;
 *  - le curseur n'avance jamais pour une ligne reçue en direct ou relue par identifiant : le filet de sécurité (« quoi de
 *    neuf ? » toutes les 5 minutes) reste la référence ; une ligne reçue en direct est « à confirmer » (provisoire) jusqu'à
 *    la synchronisation complète suivante, qui la remplace par la version du serveur (ou la retire), quelle que soit son heure.
 *  Serveur sans hb_upsert_lignes : hb_upsert, et des signaux avec les seuls identifiants.
 *
 * LECTURE PAR PÉRIMÈTRE INDEXÉE (supabase/058_lecture_perimetre.sql ; série 6 du 29/10 : les pages de mesures, « vu » et
 * joueurs étaient les requêtes les plus coûteuses ; règles pures : src/syncLive.ts, pullReader et readScopedPages) :
 *  - joueurs, mesures, avis, « vu » d'un compte qui ne voit pas tout (club, comité, ligue, joueur ; périmètre ou rôle pas
 *    encore connus) : hb_lire_perimetre (mêmes lignes que la lecture directe, lues par des index) ; administrateur et
 *    périmètre « tout » : lecture directe, comme avant ;
 *  - pages suivantes « >= heure de la dernière ligne reçue », égalités déjà reçues écartées sur l'appareil ; page pleine d'une
 *    seule heure : page suivante à l'ancien filtre ;
 *  - fonction absente (058 pas passé) : la même demande en lecture directe, nouvel essai une heure plus tard.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/*
 * OUVERTURE ÉQUITABLE (« tourniquet », src/retry.ts ; série 6 du 29/10 : à 10 000 ouvertures, 4,86 % d'erreurs) : une
 * requête vers la base refusée parce que le serveur est occupé (503, 429 ; délai dépassé ou coupure pour une lecture ou une
 * écriture « la plus récente gagne ») est rejouée telle quelle après 1, 2, 4, 8… s (plafond 30 s, un peu de hasard, Retry-After
 * respecté) : la synchronisation attend son tour et reprend à la page en cours, au lieu d'échouer et de repartir plus tard.
 * Pendant l'attente, une indication discrète (serverBusy, src/components/SyncProgress.tsx).
 */
let busyUntil = 0
const setBusy = (until: number) => {
  busyUntil = until
  listeners.forEach((l) => l())
}
const restFetch = retryingFetch({
  fetch: (input, init) => fetch(input, init),
  onWait: (_n, ms) => setBusy(Date.now() + ms),
  onDone: () => setBusy(0),
})
export const supabase: SupabaseClient | null = url && key ? createClient(url, key, { global: { fetch: restFetch } }) : null
// Adresse et clé publique du serveur, pour la page d'essai de dictée (public/essai-dictee/) servie sur le même site :
// elle ouvre sa propre connexion (même session, renouvelée comme dans un 2e onglet). Rien de secret.
if (url && key) {
  try {
    localStorage.setItem('handbase.supabase', JSON.stringify({ url, key }))
  } catch {
    /* stockage indisponible */
  }
}
export const syncEnabled = !!supabase

export type SyncState = 'local' | 'login' | 'offline' | 'syncing' | 'synced' | 'error'

let state: SyncState = syncEnabled ? (navigator.onLine ? 'synced' : 'offline') : 'local'
let lastError = ''
/** Connexion « en direct » active (notifications du serveur reçues : canaux privés, ou postgres_changes à défaut). */
let live = false
/** En direct par les canaux privés de 057 (signaux ciblés) : le filet de sécurité peut espacer les synchronisations complètes. */
let liveSignals = false
/**
 * Branchements de src/pwa.ts (posés par startPwaUpdates ; pwa.ts importe ce fichier, pas l'inverse : les tests chargent sync.ts
 * sans le service worker) : nouvelle version annoncée en direct ; annonces disponibles (vérifications de fond espacées).
 */
export const versionHooks: { announced: (v: unknown) => void; live: (on: boolean) => void } = { announced: () => {}, live: () => {} }
/** Avancement d'un gros téléchargement en cours (null sinon). */
let progress: SyncProgress | null = null
const listeners = new Set<() => void>()
const setState = (s: SyncState, err = '') => {
  state = s
  lastError = err
  listeners.forEach((l) => l())
}

const PULL_KEY = (t: SyncTable) => `handbase${TRIAL ? '-essai' : ''}.lastPull.${t}`

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* stockage indisponible */
    }
  },
}

/*
 * Propriétaire des données locales : le compte qui les a synchronisées. Un autre compte qui se connecte
 * sur l'appareil (lien d'accès #acces=, ancienne version qui gardait les données à la déconnexion)
 * repart d'un appareil vide. Avant cette version, le compte n'était noté que dans handbase.uid (roles.ts).
 */
const OWNER_KEY = `handbase${TRIAL ? '-essai' : ''}.owner`
const legacyOwner = store.get('handbase.uid')

/** Note le compte propriétaire des données locales ; false si elles sont à un autre compte (effacement lancé). */
export function claimDevice(uid: string): boolean {
  if (wiping) return false
  const owner = store.get(OWNER_KEY) ?? legacyOwner
  if (owner && owner !== uid) {
    void wipeDevice()
    return false
  }
  if (!store.get(OWNER_KEY)) store.set(OWNER_KEY, uid)
  return true
}

let wiping = false

/**
 * Efface HandBase de cet appareil (déconnexion, ou données d'un autre compte) : notifications désabonnées,
 * session fermée si demandé, base locale, réglages handbase.*, pastille de l'icône ; puis on recharge.
 */
export async function wipeDevice({ signOut = false } = {}) {
  if (wiping) return
  wiping = true
  stopRealtime()
  // Le serveur oublie l'abonnement de l'appareil (il faut encore la session). Sans service worker prêt, on n'attend pas.
  await Promise.race([disablePush().catch(() => {}), new Promise((r) => setTimeout(r, 3000))])
  if (signOut && supabase) {
    await supabase.auth.signOut().catch(() => {})
    // Hors ligne, signOut() échoue et garde la session : on l'oublie quand même sur l'appareil.
    try {
      for (const k of Object.keys(localStorage)) if (/^sb-.+-auth-token/.test(k)) localStorage.removeItem(k)
    } catch {
      /* stockage indisponible */
    }
  }
  try {
    await db.delete({ disableAutoOpen: true })
  } catch {
    /* base déjà absente ou bloquée : rien de plus à faire */
  }
  for (const get of [() => localStorage, () => sessionStorage]) {
    try {
      const s = get()
      // Le thème est un réglage de l'appareil, pas une donnée du compte.
      for (const k of Object.keys(s)) if (/^handbase(-essai)?\./.test(k) && k !== 'handbase.theme') s.removeItem(k)
    } catch {
      /* stockage indisponible */
    }
  }
  try {
    await caches.delete('hb-badge')
  } catch {
    /* cache indisponible */
  }
  try {
    await (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.()
  } catch {
    /* non pris en charge */
  }
  location.reload()
}

let running: Promise<void> | null = null
/** Une synchronisation complète est demandée dès que celle en cours se termine. */
let again = false
/** Tables demandées (signaux reçus pendant une synchronisation) : relues ensuite, si aucune complète n'est demandée. */
let asked: Set<SyncTable> | null = null
/** Début de la dernière synchronisation complète (filet de sécurité, src/syncLive.ts dueForSync). */
let lastFull = 0

/**
 * Lance une synchronisation (ou attend celle en cours). retry : renvoie aussi les modifications mises de côté.
 * tables : synchronisation CIBLÉE (envoi de la file, puis relecture de ces seules tables ; vide : envoi seul) ; sans tables :
 * complète (envoi, « quoi de neuf ? », relecture des tables signalées, vérifications).
 */
export async function syncNow({ retry = false, tables }: { retry?: boolean; tables?: Iterable<SyncTable> } = {}): Promise<void> {
  if (!supabase || wiping) return
  if (retry) {
    setAside.clear()
    failures.clear()
  }
  if (!navigator.onLine) return setState('offline')
  if (running) {
    // Ciblée pendant une autre : ses tables attendent (vide : seulement l'envoi de la file, qui a peut-être déjà eu lieu).
    if (tables) {
      asked ??= new Set()
      for (const t of tables) asked.add(t)
    } else again = true
    return running
  }
  running = run(tables ? new Set(tables) : null)
  try {
    await running
  } finally {
    running = null
    if (again) {
      again = false
      asked = null
      void syncNow()
    } else if (asked) {
      const t = asked
      asked = null
      void syncNow({ tables: t })
    }
  }
}

async function run(scope: Set<SyncTable> | null) {
  try {
    await runOnce(scope)
  } finally {
    runs++
    listeners.forEach((l) => l())
  }
}

async function runOnce(scope: Set<SyncTable> | null) {
  try {
    const { data, error } = await supabase!.auth.getSession()
    // Session expirée, pas renouvelable faute de réseau : on reste hors ligne (voir AuthGate).
    if (!data.session) return setState(isAuthRetryableFetchError(error) ? 'offline' : 'login')
    if (!claimDevice(data.session.user.id)) return
    setState('syncing')
    if (!scope) lastFull = Date.now()
    rejectedCount = 0
    // Un envoi en échec n'empêche pas de recevoir les nouveautés des autres.
    let pushError: unknown = null
    const sent: Sent[] = []
    try {
      await push(sent)
    } catch (e) {
      pushError = e
    }
    // Ce qui est parti (même si un paquet suivant a échoué) : les autres appareils sont prévenus.
    if (sent.length) void signalWrites(sent)
    await pull(data.session.user.id, scope)
    if (pushError) throw pushError
    const notes = [
      rejectedCount && `${rejectedCount} modification(s) annulée(s) : refusée(s) par le serveur (droits) ou plus ancienne(s) que sa version.`,
      setAside.size && `${setAside.size} modification(s) mise(s) de côté, refusée(s) à chaque envoi (${lastPushError}) ; « Synchroniser maintenant » les renvoie.`,
    ].filter(Boolean)
    setState('synced', notes.join(' '))
  } catch (e) {
    setState('error', e instanceof Error ? e.message : String((e as { message?: string } | null)?.message ?? e))
  }
}

const PUSH_CHUNK = 400

/**
 * Tables que le serveur peut ne pas encore connaître (script SQL pas encore passé) : ignorées sans erreur. Leurs lignes
 * restent dans la file d'envoi et partent dès que le script est passé (ex. journal des questions avancées, 043 ; configuration
 * et structure, 044 : sans la table, l'appli garde les valeurs par défaut handball).
 */
const OPTIONAL_TABLES: SyncTable[] = ['follows', 'teams', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log', 'saved_questions']

/*
 * Tables facultatives que le serveur connaît : lues sans erreur à une synchronisation de ce lancement (true), ou absentes
 * (false : script SQL pas encore passé). Inconnu tant qu'elles n'ont pas été lues. Sert aux questions enregistrées (054,
 * src/savedQuestions.ts) : gardées sur l'appareil tant que la table n'existe pas, versées au compte dès qu'elle existe.
 */
const serverTables = new Map<SyncTable, boolean>()
/** Le serveur connaît-il cette table ? (undefined : pas encore lue depuis le lancement.) */
export const serverHasTable = (table: SyncTable) => serverTables.get(table)
const knowTable = (table: SyncTable, has: boolean) => {
  if (serverTables.get(table) === has) return
  serverTables.set(table, has)
  listeners.forEach((l) => l())
}

let rejectedCount = 0

/*
 * Tables en ÉCRITURE SEULE pour un compte qui n'est pas administrateur : ses lignes partent au serveur, mais rien n'en est
 * reçu, et ses lignes envoyées quittent l'appareil (journal des questions, supabase/043_journal_questions.sql : lecture
 * réservée aux administrateurs ; un encadrant ne relit pas même ses propres questions). Le rôle est lu dans le stockage de
 * src/roles.ts (roles.ts importe ce fichier : pas d'import en retour). Sans serveur (mode local) : lu comme les autres.
 */
const ADMIN_READ: SyncTable[] = ['question_log']
const ROLE_KEY = 'handbase.role'
/**
 * Compte joueur (espace joueur, supabase/051_espace_joueur.sql) : il ne reçoit que sa fiche, la configuration et les listes
 * (src/playerSpace.ts, PLAYER_TABLES) ; le serveur ne lui enverrait rien d'autre de toute façon (règles de lecture), mais on
 * ne le demande même pas : aucune requête sur les tables du staff, aucune erreur en console. Il n'ENVOIE rien non plus : sa
 * seule écriture passe par hb_player_self_update (src/pages/Me.tsx), jamais par la file d'envoi. Rôle lu comme ci-dessus.
 */
function playerAccount() {
  try {
    return localStorage.getItem(ROLE_KEY) === 'joueur'
  } catch {
    return false
  }
}
const storedRole = () => {
  try {
    return localStorage.getItem(ROLE_KEY)
  } catch {
    return null
  }
}
/** Signature des affectations reçues (« all » ou « mine:<compte> ») : changée, elles sont relues depuis le début. */
const ASSIGN_SCOPE_KEY = `handbase${TRIAL ? '-essai' : ''}.affectations`
/**
 * L'appareil a-t-il TOUTES les affectations ? Administrateur (écran Structure modifiable, « Voir comme… », sauvegarde
 * complète), une fois reçues, ou mode local : oui ; les autres comptes ne reçoivent que les leurs (src/syncLive.ts,
 * assignmentScope) : l'écran Structure lit alors la liste complète à la demande (fetchAllAssignments).
 */
export const deviceHasAllAssignments = () => !supabase || store.get(ASSIGN_SCOPE_KEY) === 'all'

function readsTable(table: SyncTable) {
  if (playerAccount()) return playerReadsTable(table)
  if (!ADMIN_READ.includes(table)) return true
  try {
    return questionLogRights(localStorage.getItem(ROLE_KEY)).read
  } catch {
    return false
  }
}

/** Table en écriture seule : retire de l'appareil ses lignes déjà envoyées (celles de la file d'envoi restent jusqu'à l'envoi). */
async function forgetWriteOnly(table: SyncTable) {
  localStorage.removeItem(PULL_KEY(table)) // redevenu administrateur : tout sera relu
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    const pending = new Set((await db.outbox.where('table').equals(table).toArray()).map((i) => i.rowId))
    const sent = ((await db.table(table).toCollection().primaryKeys()) as string[]).filter((id) => !pending.has(id))
    if (sent.length) await db.table(table).bulkDelete(sent)
  })
}

/*
 * Ligne refusée à chaque envoi (donnée invalide…) : après MAX_FAILURES échecs, elle est mise de côté
 * (gardée dans la file mais plus envoyée, jusqu'à « Synchroniser maintenant » ou au prochain lancement)
 * pour ne pas bloquer toute la synchronisation.
 */
const MAX_FAILURES = 3
const failures = new Map<string, number>()
const setAside = new Set<string>()
let lastPushError = ''
const rowKey = (table: SyncTable, id: string) => `${table}:${id}`

/**
 * Réseau coupé, serveur indisponible ou refus de la requête entière (pas de code Postgres, codes PGRST…,
 * délai dépassé) : on réessaiera, sans accuser la ligne.
 */
const transient = (e: { code?: string }) => !e.code || e.code.startsWith('PGRST') || e.code === '57014'

type Payload = { id: string; data: unknown; updated_at_client: number; deleted: boolean }
/**
 * Lignes acceptées par le serveur pendant un envoi, par table (pour les signaux en direct) ; server : ces lignes telles que
 * le serveur les a enregistrées (hb_upsert_lignes : joueurs, mesures, avis, « vu », petits envois).
 */
type Sent = { table: SyncTable; rows: SentRow[]; server?: ServerRow[] }

// Le serveur ne garde que les lignes autorisées pour le rôle du compte, et seulement si
// la version envoyée est plus récente (voir supabase/002_roles.sql). Il renvoie les refusées.
const upsert = (table: SyncTable, rows: Payload[]) => supabase!.rpc('hb_upsert', { p_table: table, p_rows: rows })

/** hb_upsert_lignes absente du serveur (057 pas passé) : hb_upsert, redemandée une heure plus tard. */
let upsertRowsMissingAt = 0

/**
 * Envoi d'un paquet : joueurs, mesures, avis, « vu » par hb_upsert_lignes (057 : mêmes contrôles et même refus que
 * hb_upsert, plus les lignes enregistrées, au plus LIVE_ROWS_MAX et SIGNAL_MAX_BYTES chacune) ; le reste par hb_upsert.
 * data : identifiants refusés (comme hb_upsert) ; server : lignes enregistrées (null : pas demandées ou pas renvoyées).
 */
async function write(table: SyncTable, rows: Payload[]): Promise<{ data: unknown; error: { code?: string; message: string } | null; server: ServerRow[] | null }> {
  if (ROW_TABLES.includes(table) && Date.now() - upsertRowsMissingAt >= ASK_AGAIN_MS) {
    const r = await supabase!.rpc('hb_upsert_lignes', { p_table: table, p_rows: rows, p_max: LIVE_ROWS_MAX, p_octets: SIGNAL_MAX_BYTES })
    if (!r.error) {
      const w = writeAnswer(r.data)
      return { data: w.rejected, error: null, server: w.rows }
    }
    if (!missingFunction(r.error)) return { data: null, error: r.error, server: null }
    upsertRowsMissingAt = Date.now()
  }
  const r = await upsert(table, rows)
  return { data: r.data, error: r.error, server: null }
}

async function push(accepted: Sent[]) {
  // « Voir comme… » : rien de neuf à envoyer (lecture seule), et les lectures ne voient que le périmètre du membre simulé
  // (src/viewAsFilter.ts) : une ligne en attente hors de ce périmètre serait prise pour effacée. Envoi à la sortie.
  // Compte joueur : rien à envoyer (sa lettre part par hb_player_self_update, pas par la file).
  if (spyTarget() || playerAccount()) return
  const items = (await db.outbox.orderBy('seq').toArray()).filter((i) => !setAside.has(rowKey(i.table, i.rowId)))
  if (!items.length) return
  for (const table of SYNC_TABLES) {
    const batch = items.filter((i) => i.table === table)
    if (!batch.length) continue
    // Envoi par paquets (un import de licences peut représenter des milliers de lignes).
    for (let i = 0; i < batch.length; i += PUSH_CHUNK) {
      const part = batch.slice(i, i + PUSH_CHUNK)
      const ids = [...new Set(part.map((it) => it.rowId))]
      const rows = (await db.table(table).bulkGet(ids)).filter(Boolean)
      const payload: Payload[] = rows.map((r) => ({
        id: r.id,
        data: r,
        updated_at_client: r.updatedAt,
        deleted: !!r.deleted,
      }))
      const { data, error, server } = await write(table, payload)
      // Suivis, staffs ou vidéos envoyés avant que le serveur ne les connaisse (supabase/032_suivis.sql, 034_equipes_encadrants.sql,
      // 036_videos.sql pas encore passés) : gardés dans la file, renvoyés plus tard, sans bloquer la synchronisation.
      if (error && OPTIONAL_TABLES.includes(table) && /Table inconnue/.test(error.message)) break
      if (!error) {
        // La file n'est vidée qu'une fois les refus traités (sinon on renverra).
        await applyRejected(table, data)
        await db.outbox.bulkDelete(part.map((it) => it.seq!))
        const refused = new Set(Array.isArray(data) ? (data as string[]) : [])
        const stored = await keepStored(table, server, refused)
        accepted.push({ table, rows: rows.filter((r) => !refused.has(r.id)).map((r) => forSignal(table, r)), server: stored })
        continue
      }
      if (transient(error)) throw error
      // Paquet refusé : on renvoie ligne par ligne pour isoler la ou les lignes fautives.
      for (const p of payload) {
        const one = await write(table, [p])
        const k = rowKey(table, p.id)
        if (one.error) {
          if (transient(one.error)) throw one.error
          lastPushError = one.error.message
          const n = (failures.get(k) ?? 0) + 1
          failures.set(k, n)
          if (n >= MAX_FAILURES) setAside.add(k)
          continue
        }
        failures.delete(k)
        await applyRejected(table, one.data)
        await db.outbox.bulkDelete(part.filter((it) => it.rowId === p.id).map((it) => it.seq!))
        if (!(Array.isArray(one.data) && one.data.includes(p.id))) {
          const stored = await keepStored(table, one.server, new Set())
          accepted.push({ table, rows: [forSignal(table, p.data as SentRow)], server: stored })
        }
      }
      // Entrées de la file dont la ligne n'existe plus sur l'appareil : rien à envoyer.
      const sent = new Set(payload.map((p) => p.id))
      await db.outbox.bulkDelete(part.filter((it) => !sent.has(it.rowId)).map((it) => it.seq!))
    }
  }
  // Lignes refusées pas encore mises de côté : on le signale (elles repartiront au prochain envoi).
  if ([...failures.keys()].some((k) => !setAside.has(k))) throw new Error(`Envoi refusé : ${lastPushError}`)
}

/**
 * Lignes enregistrées renvoyées par hb_upsert_lignes (refusées exclues) : l'appareil qui écrit reprend tout de suite la
 * version du serveur (signature, nom, département posé par le serveur…), sauf sur une modification faite entre-temps
 * (encore dans la file) ; renvoyées pour le signal.
 */
async function keepStored(table: SyncTable, server: ServerRow[] | null, refused: ReadonlySet<string>): Promise<ServerRow[]> {
  const stored = (server ?? []).filter((r) => !refused.has(r.id))
  if (stored.length) await applyServerRows(table, stored, { skipPending: true })
  return stored
}

/** Refus du serveur (droits, ou version plus ancienne que la sienne) : on reprend sa version. */
async function applyRejected(table: SyncTable, data: unknown) {
  const rejected: string[] = Array.isArray(data) ? data : []
  if (!rejected.length) return
  rejectedCount += rejected.length
  await restoreFromServer(table, rejected)
}

/** Annule localement les modifications refusées : on reprend la version du serveur (ou on retire la ligne). */
async function restoreFromServer(table: SyncTable, ids: string[]) {
  const { data, error } = await supabase!.from(`hb_${table}`).select('id, data').in('id', ids)
  if (error) throw error
  const server = new Map((data ?? []).map((r) => [r.id as string, r.data]))
  await db.transaction('rw', db.table(table), async () => {
    for (const id of ids) {
      const row = server.get(id)
      if (row) await db.table(table).put(row)
      else await db.table(table).delete(id)
    }
  })
}

/*
 * server_updated_at est l'heure d'écriture (clock_timestamp()), pas celle de validation : une ligne
 * validée un peu plus tard peut porter une heure antérieure au dernier curseur. On relit donc la
 * dernière minute (réappliquer une ligne déjà vue est sans effet), et on pagine sur
 * (server_updated_at, id) pour avancer même si plus de PULL_PAGE lignes ont la même heure.
 * Seulement quand le curseur est récent : une écriture validée en retard l'est en quelques secondes.
 * Sinon, un import massif (des milliers de lignes dans la même minute) serait retéléchargé à chaque fois.
 */
const PULL_OVERLAP_MS = 60_000
const OVERLAP_WINDOW_MS = 5 * 60_000
// PULL_PAGE (1 000, src/syncLive.ts) : jamais plus que le plafond de lignes par réponse du serveur (db-max-rows).
const EPOCH = '1970-01-01T00:00:00Z'

/*
 * Avancement (src/syncProgress.ts) : AUCUNE requête de comptage. Jusqu'au 29/10/2026, chaque appareil neuf comptait d'avance
 * ses 18 tables (HEAD « count=estimated ») : sous les règles de lecture, c'était le premier poste de la base à l'essai de
 * charge. L'avancement se lit maintenant dans les pages reçues.
 */
const setProgress = (p: SyncProgress | null) => {
  progress = p
  listeners.forEach((l) => l())
}
/** Avancement recalculé après une page (jamais en arrière pendant le même téléchargement). */
const showPages = (per: Partial<Record<SyncTable, TableProgress>>, table: SyncTable | null, first: boolean) =>
  setProgress(forward(progress, aggregate(per, table, first)))

/**
 * Staffs dont ce compte est membre (ou créateur), avec leur version : un staff qui apparaît ou change (on vient
 * d'y entrer, par exemple) peut ouvrir des groupes « Mon staff » qui, eux, n'ont pas changé : le serveur ne les
 * enverrait pas (on ne reçoit que ce qui a changé depuis la dernière fois). On relit alors tous les groupes.
 */
async function myTeams(uid: string) {
  const teams = await db.teams.toArray()
  return new Map(teams.filter((t) => !t.deleted && (t.createdBy === uid || t.members?.includes(uid))).map((t) => [t.id, t.updatedAt]))
}

/**
 * « Quoi de neuf ? » (hb_quoi_de_neuf, 057) : une requête avec les curseurs des tables ; pour chacune, true (à relire), false
 * (rien de nouveau pour ce compte), null (table inconnue du serveur). Fonction absente (script pas passé) : null → relecture
 * de toutes les tables, comme avant ; on réessaie une heure plus tard. Autre erreur (réseau) : null aussi (la relecture
 * complète reste juste).
 */
const ASK_AGAIN_MS = 60 * 60_000
let whatsNewMissingAt = 0

async function whatsNew(tables: SyncTable[]): Promise<WhatsNew | null> {
  if (!tables.length || Date.now() - whatsNewMissingAt < ASK_AGAIN_MS) return null
  const cursors: Record<string, string | null> = {}
  for (const t of tables) cursors[t] = localStorage.getItem(PULL_KEY(t))
  // Affectations : seulement les siennes (hors administrateur) : demandées sous la clé « mes_affectations » (057).
  const mine = tables.includes('assignments') && assignmentScope(storedRole()) === 'mine'
  const { data, error } = await supabase!.rpc('hb_quoi_de_neuf', { curseurs: whatsNewRequest(cursors, mine) })
  if (error) {
    if (missingFunction(error)) whatsNewMissingAt = Date.now()
    return null
  }
  return whatsNewAnswer(data, mine)
}

/**
 * Reçoit les nouveautés. scope : tables signalées en direct (synchronisation ciblée : ces seules tables, rien d'autre) ;
 * null : synchronisation complète (« quoi de neuf ? », puis les tables signalées ; tables jamais reçues toujours relues ;
 * puis les vérifications périodiques).
 */
async function pull(uid: string, scope: Set<SyncTable> | null) {
  /*
   * Avancement (sans comptage, src/syncProgress.ts) : tables jamais téléchargées suivies dès le départ ; les autres
   * seulement si leur premier paquet est plein (gros retard). Une petite synchro ordinaire ne fait aucune requête de plus.
   */
  const per: Partial<Record<SyncTable, TableProgress>> = {}
  const readable = SYNC_TABLES.filter(readsTable)
  const wanted = scope ? readable.filter((t) => scope.has(t)) : readable
  const fresh = new Set(wanted.filter((t) => !localStorage.getItem(PULL_KEY(t))))
  const first = fresh.size === readable.length
  // Appareil neuf : premier chargement ET base locale vide (rien reçu avant, rien créé hors ligne) : rien à oublier ensuite.
  const emptyDevice = first && !scope && (await localRowsCount()) === 0
  for (const t of fresh) per[t] = startTable()
  if (fresh.size) setProgress(aggregate(per, null, first))
  // Complète, appareil déjà servi au moins une fois : une requête dit quelles tables ont changé (premier chargement : tout).
  const flags = scope || first ? null : await whatsNew(wanted.filter((t) => !fresh.has(t)))
  const plan = planPull(wanted, fresh, flags)
  for (const t of plan.quiet) knowTable(t, true)
  for (const t of plan.absent) knowTable(t, false)
  const toPull = new Set(plan.pull)
  // Affectations reçues autrement qu'à la dernière fois (rôle changé, appareil d'avant ce tri) : relues quoi qu'en dise
  // « quoi de neuf ? » (pullTable les reprend depuis le début).
  // (Table inconnue du serveur, 044 pas passé : pas redemandée à chaque fois pendant ce lancement.)
  if (wanted.includes('assignments') && serverTables.get('assignments') !== false && store.get(ASSIGN_SCOPE_KEY) !== assignmentScopeKey(storedRole(), uid))
    toPull.add('assignments')
  try {
    const teamsBefore = await myTeams(uid)
    let structureRows = 0
    // Ordre (src/syncLive.ts, PULL_ORDER) : réglages et structure (petits), puis le périmètre du compte (joueurs, mesures,
    // avis, « vu ») : l'appli s'ouvre dès la première page de joueurs (premier chargement), le reste arrive derrière.
    for (const table of PULL_ORDER) {
      // Staffs changés : les groupes « Mon staff » et les « à revoir » (041, visibles par le staff de leur auteur) qu'ils
      // ouvrent sont relus en entier. Premier chargement : rien à faire, ils viennent d'être lus depuis le début avec les
      // staffs tels qu'ils sont (sinon les événements, déjà reçus, étaient tous relus juste après).
      if (table === 'groups' && !first) {
        const after = await myTeams(uid)
        if ([...after].some(([id, v]) => teamsBefore.get(id) !== v)) {
          localStorage.removeItem(PULL_KEY('groups'))
          localStorage.removeItem(PULL_KEY('rewatch'))
          // Événements (048) : participant par un staff, je vois aussi ceux hors de mes territoires ; l'événement, lui,
          // n'a pas changé : relu au prochain passage.
          localStorage.removeItem(PULL_KEY('events'))
          again = true
        }
      }
      // Écriture seule (journal des questions, hors administrateurs) : rien à recevoir ; lignes envoyées retirées.
      // Compte joueur : tables du staff jamais demandées (et retirées de l'appareil si une ancienne session en avait laissé).
      if (!readsTable(table)) {
        if (!scope) await forgetWriteOnly(table)
        continue
      }
      if (!toPull.has(table)) continue
      const n = await pullTable(table, uid, per, first)
      if (table === 'levels' || table === 'units' || table === 'assignments') structureRows += n
    }
    structureChanged = structureChanged || structureRows > 0
  } finally {
    if (progress) setProgress(null)
  }
  // Critères jamais publiés de l'appareil : retirés dès que la base partagée tient la liste (criteriaImport.ts).
  if (toPull.has('criteria')) await retireUnpublishedCriteria()
  // Ciblée : rien d'autre (les vérifications périodiques attendent la prochaine complète).
  if (scope) return
  // Lignes reçues en direct avant cette synchronisation et pas encore confirmées par une relecture : relues par identifiant.
  try {
    await verifyProvisional(lastFull)
  } catch (e) {
    console.warn('Lignes reçues en direct :', e instanceof Error ? e.message : e)
  }
  // Compte joueur : ni groupes, ni staffs, ni périmètre : rien à vérifier (sa fiche arrive par le curseur ; retirée du compte
  // (accès retiré) : le serveur ne la montre plus, l'appli repasse à « Entre ton code » et l'appareil est effacé à la déconnexion).
  if (playerAccount()) return
  // Appareil neuf : il vient de tout recevoir tel que le serveur le montre ; relire les identifiants visibles (staffs, groupes,
  // « à revoir », événements, joueurs) ne retrouverait que ces mêmes lignes. Première vérification dans 10 minutes (et
  // celle des joueurs dans un jour), comme après une vérification faite.
  if (emptyDevice) lastForget = Date.now()
  else await forgetHidden()
  await checkPerimeter(uid, emptyDevice)
}

/** Lignes déjà sur l'appareil dans les tables que les vérifications nettoient (0 : appareil vide). */
async function localRowsCount() {
  const tables: string[] = ['teams', 'groups', 'rewatch', 'events', ...SCOPED_TABLES]
  const counts = await Promise.all(tables.map((t) => db.table(t).count()))
  return counts.reduce((a, b) => a + b, 0)
}

/*
 * Lignes que ce compte ne voit plus. Le serveur ne lui en envoie plus rien, pas même la suppression : sa copie
 * resterait sur l'appareil.
 *  - staffs dont il a été retiré (supabase/034_equipes_encadrants.sql) : sa copie le dirait encore membre ;
 *  - groupes « Mon staff » dont il a été retiré (ou dont il s'est retiré, supabase/031_groupes_equipe.sql), ou
 *    ouverts par un staff dont il est sorti (034).
 *  - « à revoir » (041) d'un staff dont il est sorti (ou dont l'auteur est sorti).
 *  - événements (supabase/048_evenements_organisateur.sql) dont l'organisateur est sorti de mes territoires (unité
 *    changée, unité déplacée, affectation retirée), dont je ne suis plus participant, ou où plus aucun de mes joueurs
 *    n'est inscrit (retiré de la liste, joueur muté ou supprimé). Avant 048, le serveur les montre tous : rien n'est
 *    retiré. Leurs avis restent (filtrés par le joueur, 046), comme ceux d'un événement supprimé.
 *    (Dans l'autre sens, rien à faire : un joueur de mon périmètre inscrit à un événement, ou un joueur inscrit qui entre
 *    dans mon périmètre, réécrit l'événement sur le serveur (liste changée, ou recalcul de players_dept / players_club en
 *    fin de transaction) : nouvelle heure serveur, il arrive par le curseur.)
 * Au lancement puis toutes les 10 minutes, on relit la liste des staffs et des groupes visibles (seulement leurs
 * identifiants : quelques centaines au plus) et on retire de l'appareil ceux qui n'y sont plus, sauf s'ils ont une
 * modification pas encore envoyée. (Rendre un groupe moins visible en crée une copie et supprime l'ancien, voir
 * GroupForm : cela, tous les appareils le reçoivent tout de suite.)
 */
const FORGET_EVERY_MS = 10 * 60_000
let lastForget = 0

type ForgetTable = 'groups' | 'teams' | 'rewatch' | 'players' | 'events'

/** Identifiants visibles d'une table (null : erreur, ou table inconnue du serveur). */
async function visibleIds(table: ForgetTable) {
  const visible = new Set<string>()
  // Pagination par identifiant (et non par position) : aucune ligne sautée si le serveur change entre deux pages.
  for (let after = ''; ; ) {
    const { data, error } = await supabase!.from(`hb_${table}`).select('id').gt('id', after).order('id').limit(PULL_PAGE)
    if (error) return null // on réessaiera à la prochaine synchronisation
    for (const r of data) visible.add(r.id as string)
    if (data.length < PULL_PAGE) break
    after = data[data.length - 1].id as string
  }
  return visible
}

/** Retire de l'appareil les lignes de `table` absentes de `visible` (sauf celles qui attendent d'être envoyées). */
async function forgetRows(table: ForgetTable, visible: Set<string>) {
  // Une seule transaction : une ligne créée sur l'appareil pendant ce temps est forcément dans la file d'envoi.
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    const pending = new Set((await db.outbox.where('table').equals(table).toArray()).map((i) => i.rowId))
    const gone = ((await db.table(table).toCollection().primaryKeys()) as string[]).filter((id) => !visible.has(id) && !pending.has(id))
    if (gone.length) await db.table(table).bulkDelete(gone)
  })
}

/**
 * Synchronise tout de suite en relisant les lignes visibles (sans attendre les 10 minutes) : après une action du
 * serveur qui me retire l'accès à un groupe (réattribution d'un groupe privé, supabase/038), il est effacé de l'appareil.
 */
export function syncAndForgetHidden() {
  lastForget = 0
  lastScopeCheck = 0
  return syncNow()
}

async function forgetHidden() {
  if (Date.now() - lastForget < FORGET_EVERY_MS) return
  const [teams, groups, rewatch, events] = await Promise.all([visibleIds('teams'), visibleIds('groups'), visibleIds('rewatch'), visibleIds('events')])
  if (!groups) return
  lastForget = Date.now()
  // Aucun groupe visible (compte sans rôle, réponse anormale) : on ne retire rien, par prudence. Aucun staff
  // visible, en revanche, est courant (personne n'en a encore créé) ; table absente du serveur (null) : rien.
  if (!groups.size) return
  if (teams) await forgetRows('teams', teams)
  // Événements hors de mes territoires (048) ; erreur de lecture (null) : rien.
  if (events) await forgetRows('events', events)
  // « À revoir » d'un staff dont je suis sorti (041) : aucun visible est courant (personne n'en a encore mis).
  if (rewatch) await forgetRows('rewatch', rewatch)
  await forgetRows('groups', groups)
}

/*
 * Périmètre (supabase/046_perimetre.sql) : le serveur n'envoie que les joueurs du périmètre du compte (unités où il est
 * affecté + sous-unités) et ce qui leur est rattaché. Deux problèmes quand ce périmètre change (affectation ajoutée ou
 * retirée, unité déplacée, rôle changé) :
 *  1. PLUS VISIBLES : le serveur ne renvoie rien (pas même une suppression) : la copie resterait sur l'appareil.
 *     → on relit la liste des joueurs visibles (identifiants seulement, par pages) et on retire les autres, puis les lignes
 *     rattachées à un joueur absent (sauf les siennes) ; jamais une ligne qui attend d'être envoyée.
 *  2. DEVENUS VISIBLES : ces lignes n'ont pas changé, leur heure serveur est ancienne : la synchronisation par curseur
 *     (« ce qui a changé depuis la dernière fois ») ne les ramènerait JAMAIS.
 *     → on efface le curseur des tables du périmètre : elles sont relues depuis le début (une ligne déjà identique sur
 *     l'appareil n'est pas réécrite, voir pullTable).
 * Le périmètre appliqué est lu au serveur (hb_my_perimeter) : après une synchronisation qui a reçu des changements de
 * structure (niveaux, unités, affectations), sinon toutes les 10 minutes (rôle changé…). Sa signature est gardée sur
 * l'appareil ; le plan (src/perimeter.ts, planScopeChange, testé) décide. Un joueur qui mute hors du périmètre (le
 * serveur ne prévient pas) : vérification complète une fois par jour. Fonction absente (046 pas encore passé) : rien.
 * Un joueur qui ENTRE dans le périmètre (mutation) change, lui : il arrive par le curseur, ses lignes rattachées aussi
 * (le serveur les fait suivre, hb_scope_cascade).
 */
const SCOPE_KEY = `handbase${TRIAL ? '-essai' : ''}.perimetre`
const SCOPE_FORGET_KEY = `handbase${TRIAL ? '-essai' : ''}.perimetre.verifie`
let lastScopeCheck = 0
let structureChanged = false

async function checkPerimeter(uid: string, emptyDevice = false) {
  if (!structureChanged && Date.now() - lastScopeCheck < FORGET_EVERY_MS) return
  const { data, error } = await supabase!.rpc('hb_my_perimeter')
  if (error || !data || typeof data !== 'object') return // 046 pas passé, ou réseau : on réessaiera
  lastScopeCheck = Date.now()
  structureChanged = false
  const scope = data as ServerScope
  const prev = store.get(SCOPE_KEY)
  const plan = planScopeChange(prev, scope, Number(store.get(SCOPE_FORGET_KEY) ?? 0), Date.now(), emptyDevice)
  // Appareil neuf : rien à oublier (planScopeChange) ; la vérification du jour part de maintenant.
  if (emptyDevice && prev === null) store.set(SCOPE_FORGET_KEY, String(Date.now()))
  if (plan.forget) {
    const visible = await visibleIds('players')
    if (!visible) return // erreur : on garde l'ancienne signature, tout sera refait la prochaine fois
    await forgetRows('players', visible)
    await forgetOrphans(uid)
    store.set(SCOPE_FORGET_KEY, String(Date.now()))
  }
  if (plan.resetCursors) {
    for (const t of SCOPED_TABLES) localStorage.removeItem(PULL_KEY(t))
    // Événements (048) : ceux organisés dans le nouveau périmètre n'ont pas changé non plus ; ceux qui en sortent sont
    // retirés à la synchronisation suivante (forgetHidden, sans attendre les 10 minutes).
    localStorage.removeItem(PULL_KEY('events'))
    lastForget = 0
    again = true // nouvelle synchronisation juste après celle-ci : relit les tables depuis le début
  }
  const sig = scopeSignature(scope)
  // Périmètre changé (ou première lecture) : les canaux en direct suivent (hb_mes_canaux relu).
  if (store.get(SCOPE_KEY) !== sig && (channels.length || channel)) restartRealtime()
  store.set(SCOPE_KEY, sig)
}

/** Lignes rattachées à un joueur qui n'est plus sur l'appareil (sauf les siennes et celles à envoyer). */
async function forgetOrphans(uid: string) {
  for (const table of SCOPED_TABLES) {
    if (table === 'players') continue
    await db.transaction('rw', db.players, db.table(table), db.outbox, async () => {
      const players = new Set((await db.players.toCollection().primaryKeys()) as string[])
      const pending = new Set((await db.outbox.where('table').equals(table).toArray()).map((i) => i.rowId))
      const gone = orphanIds(table, await db.table(table).toArray(), players, pending, uid)
      if (gone.length) await db.table(table).bulkDelete(gone)
    })
  }
}

/** Table inconnue du serveur (Postgres 42P01, ou cache de PostgREST : PGRST205). */
const missingTable = (e: { code?: string }) => e.code === '42P01' || e.code === 'PGRST205'
/** Fonction inconnue du serveur (script SQL pas encore passé : Postgres 42883, ou cache de PostgREST : PGRST202). */
const missingFunction = (e: { code?: string }) => e.code === '42883' || e.code === 'PGRST202'

/**
 * Écrit sur l'appareil des lignes reçues du serveur (une page relue, ou une ligne arrivée en direct avec son contenu) : une
 * seule transaction par paquet (premier chargement : des dizaines de milliers de lignes) ; seules les lignes à garder (src/syncLive.ts,
 * keepRows : jamais par-dessus une version plus récente, ligne identique pas réécrite, effacement toujours appliqué).
 */
async function applyServerRows(table: SyncTable, rows: ServerRow[], opts: { skipPending?: boolean; force?: ReadonlySet<string> } = {}) {
  if (!rows.length) return
  const force = opts.force ?? new Set<string>()
  const outbox = opts.skipPending || force.size > 0
  await db.transaction('rw', outbox ? [db.table(table), db.outbox] : [db.table(table)], async () => {
    const pending = outbox ? await pendingIds(table, rows.map((r) => r.id)) : new Set<string>()
    const list = opts.skipPending ? rows.filter((r) => !pending.has(r.id)) : rows
    const locals = (await db.table(table).bulkGet(list.map((r) => r.id))) as ({ updatedAt?: number } | undefined)[]
    // Ligne reçue en direct confirmée par cette lecture du serveur (force) : la version du serveur l'emporte (src/syncLive.ts, rowsToWrite).
    const newer = rowsToWrite(list, locals, force, pending)
    if (newer.length) await db.table(table).bulkPut(newer.map((r) => r.data))
  })
}

/** Identifiants (parmi ids) qui attendent d'être envoyés (à appeler dans une transaction qui couvre db.outbox). */
async function pendingIds(table: SyncTable, ids: string[]) {
  if (!ids.length) return new Set<string>()
  const items = await db.outbox.where('rowId').anyOf(ids).toArray()
  return new Set(items.filter((i) => i.table === table).map((i) => i.rowId))
}

/*
 * Lignes reçues EN DIRECT (contenu d'un signal ; configuration, critères, niveaux par l'événement « ligne ») : « à
 * confirmer ». Elles viennent d'un autre appareil, pas du serveur : la synchronisation complète suivante les remplace par la
 * version du serveur (relecture par curseur, ou par identifiant pour celles qu'elle n'a pas relues) ou les retire, quelle que
 * soit leur heure (une ligne erronée ou forgée, même datée dans le futur, ne survit pas). Liste gardée sur l'appareil
 * (effacée avec lui), au plus PROVISIONAL_MAX lignes (au-delà, les lignes reçues sont relues par identifiant).
 */
const PROVISIONAL_KEY = `handbase${TRIAL ? '-essai' : ''}.provisoire`
let provisional: Provisional | null = null
const prov = () => (provisional ??= readProvisional(store.get(PROVISIONAL_KEY)))
const setProv = (p: Provisional) => {
  if (p === provisional) return
  provisional = p
  store.set(PROVISIONAL_KEY, JSON.stringify(p))
}

/**
 * Applique des lignes reçues en direct (src/syncLive.ts, liveRowsToApply : jamais par-dessus une version plus récente ni un
 * envoi en attente) et note celles écrites comme « à confirmer ». Renvoie les identifiants à relire plutôt qu'appliquer
 * (version trop en avance, liste des lignes à confirmer pleine).
 */
async function applyLiveRows(table: SyncTable, rows: ServerRow[]): Promise<string[]> {
  if (!rows.length) return []
  if (provisionalCount(prov()) + rows.length > PROVISIONAL_MAX) return rows.map((r) => r.id)
  let written: string[] = []
  let reread: string[] = []
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    const pending = await pendingIds(table, rows.map((r) => r.id))
    const locals = (await db.table(table).bulkGet(rows.map((r) => r.id))) as ({ updatedAt?: number } | undefined)[]
    const plan = liveRowsToApply(rows, locals, pending, Date.now())
    reread = plan.reread
    if (plan.apply.length) await db.table(table).bulkPut(plan.apply.map((r) => r.data))
    written = plan.apply.map((r) => r.id)
  })
  setProv(markProvisional(prov(), table, written, Date.now()))
  return reread
}

/**
 * Relectures CIBLÉES (signal avec identifiants) : regroupées comme les signaux (1,5 s, canaux larges étalés), puis par table,
 * id=in.(…) par paquets de IDS_PER_READ, sans recouvrement ni curseur (le filet de sécurité reste la référence). La version du
 * serveur confirme les lignes reçues en direct avant la lecture. Erreur : la table est relue par curseur (comme avant).
 */
const rereads = new Grouper<string>((keys) => void readIds(keys))

async function readIds(keys: Set<string>) {
  if (!supabase || wiping) return
  for (const [table, ids] of splitLiveKeys(keys, SYNC_TABLES)) {
    if (!readsTable(table)) continue
    for (let i = 0; i < ids.length; i += IDS_PER_READ) {
      const part = ids.slice(i, i + IDS_PER_READ)
      const askedAt = Date.now()
      try {
        const { data, error } = await supabase.from(`hb_${table}`).select('id, data, server_updated_at').in('id', part)
        if (error) throw error
        const rows = (data ?? []) as ServerRow[]
        const force = provisionalBefore(prov(), table, askedAt)
        await applyServerRows(table, rows, { skipPending: true, force })
        setProv(dropProvisional(prov(), table, rows.map((r) => r.id).filter((id) => force.has(id))))
      } catch {
        signals.add(table, GROUP_MS)
        break
      }
    }
  }
}

/**
 * Fin d'une synchronisation complète : les lignes reçues en direct AVANT son début que les relectures par curseur n'ont pas
 * confirmées sont relues par identifiant : la version du serveur les remplace ; absentes (inconnues du serveur, ou plus
 * visibles par ce compte), elles sont retirées ; jamais une ligne qui attend d'être envoyée. Erreur : réessayé à la suivante.
 */
async function verifyProvisional(before: number) {
  for (const table of Object.keys(prov()) as SyncTable[]) {
    if (!SYNC_TABLES.includes(table) || !readsTable(table)) {
      setProv(dropProvisional(prov(), table, Object.keys(prov()[table] ?? {})))
      continue
    }
    const ids = [...provisionalBefore(prov(), table, before)]
    for (let i = 0; i < ids.length; i += IDS_PER_READ) {
      const part = ids.slice(i, i + IDS_PER_READ)
      const { data, error } = await supabase!.from(`hb_${table}`).select('id, data, server_updated_at').in('id', part)
      if (error) return
      await db.transaction('rw', db.table(table), db.outbox, async () => {
        const plan = planVerify(part, (data ?? []) as ServerRow[], await pendingIds(table, part))
        if (plan.put.length) await db.table(table).bulkPut(plan.put.map((r) => r.data))
        if (plan.remove.length) await db.table(table).bulkDelete(plan.remove)
      })
      setProv(dropProvisional(prov(), table, part))
    }
  }
}

type PulledRow = ServerRow & { server_updated_at: string }

/** Colonne hb_assignments.user_id (057) : true connue du serveur, false absente (filtre sur data->>userId), undefined pas essayée. */
let assignmentUserColumn: boolean | undefined

/**
 * Lecture par périmètre (supabase/058_lecture_perimetre.sql, src/syncLive.ts, pullReader / readScopedPages) : fonction
 * hb_lire_perimetre absente du serveur (058 pas passé) : lecture directe, et on réessaie une heure plus tard.
 */
let perimeterMissingAt = 0

/**
 * Reçoit les lignes changées depuis le curseur de la table, par pages de PULL_PAGE triées (server_updated_at, id) ;
 * renvoie le nombre de lignes reçues. Affectations d'un compte qui n'est pas administrateur : les siennes seulement
 * (data.userId, index hb_assignments_user de 046) ; signature changée : relues depuis le début (planAssignmentScope).
 */
async function pullTable(table: SyncTable, uid: string, per: Partial<Record<SyncTable, TableProgress>>, first: boolean): Promise<number> {
  const scopeKey = table === 'assignments' ? assignmentScopeKey(storedRole(), uid) : null
  const scopePlan = scopeKey ? planAssignmentScope(store.get(ASSIGN_SCOPE_KEY), scopeKey) : null
  if (scopePlan?.reset) localStorage.removeItem(PULL_KEY(table))
  const mine = !!scopeKey && scopeKey !== 'all'
  // Joueurs, mesures, avis, « vu » d'un compte qui ne voit pas tout : lecture par périmètre indexée (058).
  const scoped = pullReader(table, storedRole(), store.get(SCOPE_KEY), Date.now() - perimeterMissingAt < ASK_AGAIN_MS) === 'perimetre'
  const since = localStorage.getItem(PULL_KEY(table)) ?? EPOCH
  const at = new Date(since).getTime()
  const start = new Date(Date.now() - at < OVERLAP_WINDOW_MS ? at - PULL_OVERLAP_MS : at).toISOString()
  let missing = false
  const read = (after: PageKey | null, byColumn: boolean) => {
    const select = supabase!.from(`hb_${table}`).select('id, data, server_updated_at')
    // Ses affectations : colonne user_id (057, index utilisable sous les règles de lecture), sinon data->>userId (sans index).
    const base = !mine ? select : byColumn ? select.eq('user_id', uid) : select.eq('data->>userId', uid)
    const filtered = after
      ? base.or(`server_updated_at.gt."${after.at}",and(server_updated_at.eq."${after.at}",id.gt."${after.id}")`)
      : base.gte('server_updated_at', start)
    return filtered.order('server_updated_at').order('id').limit(PULL_PAGE)
  }
  /*
   * Page par la lecture par périmètre (058) : depuis une heure incluse (hb_lire_perimetre ; fonction absente : la même
   * demande en lecture directe), ou après (heure, id) à l'ancien filtre (page pleine d'une seule heure).
   */
  const readScoped = async (req: ScopedRequest) => {
    if ('after' in req) return read(req.after, false)
    if (Date.now() - perimeterMissingAt >= ASK_AGAIN_MS) {
      const res = await supabase!.rpc('hb_lire_perimetre', { p_table: table, p_curseur: req.since, p_limite: PULL_PAGE })
      if (!res.error || !missingFunction(res.error)) return res
      perimeterMissingAt = Date.now()
    }
    return supabase!.from(`hb_${table}`).select('id, data, server_updated_at').gte('server_updated_at', req.since).order('server_updated_at').order('id').limit(PULL_PAGE)
  }
  // Heure de la demande de la page en cours : les lignes reçues en direct AVANT elle sont confirmées par la page (src/syncLive.ts, rowsToWrite).
  let askedAt = 0
  // more : d'autres pages suivent (lecture par périmètre : la page brute était pleine, égalités écartées comprises).
  const onPage = async (rows: readonly PulledRow[], more = rows.length === PULL_PAGE) => {
    const force = provisionalBefore(prov(), table, askedAt)
    await applyServerRows(table, rows as PulledRow[], { force })
    if (force.size) setProv(dropProvisional(prov(), table, rows.map((r) => r.id).filter((id) => force.has(id))))
    const last = rows[rows.length - 1]
    if (new Date(last.server_updated_at) > new Date(since)) localStorage.setItem(PULL_KEY(table), last.server_updated_at)
    if (table === 'players') markPlayersReady()
    // Gros retard (premier paquet plein) : suivi dans l'avancement à partir de là.
    if (!per[table] && more) per[table] = startTable()
    const p = per[table]
    if (p) {
      p.done += rows.length
      p.pages++
      p.finished = !more
      showPages(per, table, first)
    }
  }
  const check = (data: unknown, error: { code?: string; message: string } | null) => {
    // Table des suivis, des staffs ou des vidéos absente du serveur (supabase/032, 034, 036 pas encore passés) : rien à recevoir.
    if (error && OPTIONAL_TABLES.includes(table) && missingTable(error)) {
      missing = true
      return []
    }
    if (error) throw error
    return (data ?? []) as PulledRow[]
  }
  const received = scoped
    ? await readScopedPages<PulledRow>(
        start,
        async (req) => {
          askedAt = Date.now()
          const { data, error } = await readScoped(req)
          return check(data, error)
        },
        onPage,
      )
    : await readPages<PulledRow>(async (after) => {
        askedAt = Date.now()
        let { data, error } = await read(after, mine && assignmentUserColumn !== false)
        if (error && mine && assignmentUserColumn !== false && (error.code === '42703' || /user_id/.test(error.message ?? ''))) {
          // Serveur sans la colonne user_id (057 d'avant le 29/10, ou pas passé ; Postgres 42703) : même lecture sur data.userId.
          const again = await read(after, false)
          if (!again.error) assignmentUserColumn = false
          ;({ data, error } = again)
        } else if (!error && mine) assignmentUserColumn ??= true
        return check(data, error)
      }, (rows) => onPage(rows))
  if (table === 'players') markPlayersReady()
  // Table terminée (ou absente du serveur) : sa part de l'avancement est faite.
  const p = per[table]
  if (p && !p.finished) {
    p.finished = true
    showPages(per, table, first)
  }
  if (missing) {
    knowTable(table, false)
    return received
  }
  // Table vide sur le serveur : curseur posé quand même, pour ne plus la relire en entier à chaque synchro.
  if (!localStorage.getItem(PULL_KEY(table))) localStorage.setItem(PULL_KEY(table), since)
  if (scopeKey) {
    if (scopePlan?.forgetOthers) await forgetOtherAssignments(uid)
    store.set(ASSIGN_SCOPE_KEY, scopeKey)
  }
  knowTable(table, true)
  return received
}

/** Affectations des autres comptes retirées de l'appareil (sauf celles qui attendent d'être envoyées). */
async function forgetOtherAssignments(uid: string) {
  await db.transaction('rw', db.assignments, db.outbox, async () => {
    const pending = new Set((await db.outbox.where('table').equals('assignments').toArray()).map((i) => i.rowId))
    const gone = otherAssignmentIds(await db.assignments.toArray(), uid, pending)
    if (gone.length) await db.assignments.bulkDelete(gone)
  })
}

/*
 * Toutes les affectations, LUES À LA DEMANDE (écran Structure en lecture seule d'un compte qui n'est pas administrateur :
 * l'appareil n'a que les siennes). Pages de PULL_PAGE par identifiant (rien de sauté si le serveur change entre deux pages),
 * affectations non supprimées. Gardées 5 minutes pendant le lancement. null : hors ligne, déconnecté ou erreur.
 */
const ALL_ASSIGNMENTS_MS = 5 * 60_000
let allAssignments: { at: number; rows: Assignment[] } | null = null
/** Lecture en cours (deux parties de l'écran la demandent en même temps : une seule lecture). */
let allAssignmentsReading: Promise<Assignment[] | null> | null = null

export function fetchAllAssignments(): Promise<Assignment[] | null> {
  if (!supabase || !navigator.onLine) return Promise.resolve(null)
  if (allAssignments && Date.now() - allAssignments.at < ALL_ASSIGNMENTS_MS) return Promise.resolve(allAssignments.rows)
  allAssignmentsReading ??= (async () => {
    try {
      const rows: Assignment[] = []
      for (let after = ''; ; ) {
        const { data, error } = await supabase!.from('hb_assignments').select('id, data').eq('deleted', false).gt('id', after).order('id').limit(PULL_PAGE)
        if (error) return null
        for (const r of data) if (r.data && !(r.data as Assignment).deleted) rows.push(r.data as Assignment)
        if (data.length < PULL_PAGE) break
        after = data[data.length - 1].id as string
      }
      allAssignments = { at: Date.now(), rows }
      return rows
    } catch {
      return null
    } finally {
      allAssignmentsReading = null
    }
  })()
  return allAssignmentsReading
}

// Plusieurs changements rapprochés (ex. un import) ne déclenchent qu'une synchronisation complète.
let soon: number | undefined
function syncSoon(delay = 400) {
  window.clearTimeout(soon)
  soon = window.setTimeout(() => void syncNow(), delay)
}

// Écritures de l'appareil rapprochées : un seul envoi de la file (ses lignes reviennent par le signal du serveur, ou par la
// prochaine synchronisation complète : rien à relire tout de suite).
let pushSoon: number | undefined
function pushLater(delay = 500) {
  window.clearTimeout(pushSoon)
  pushSoon = window.setTimeout(() => void syncNow({ tables: [] }), delay)
}

/** Signaux reçus en direct, regroupés (src/syncLive.ts) : une synchronisation ciblée sur les tables signalées. */
const signals = new Grouper<SyncTable>((tables) => void syncNow({ tables }))

/** Canaux privés abonnés (057) ; à défaut, l'ancien canal postgres_changes. */
let channels: RealtimeChannel[] = []
/** Canaux privés prêts (abonnement confirmé) : les seuls où l'appareil envoie ses signaux. */
const ready = new Map<string, RealtimeChannel>()
let channel: RealtimeChannel | null = null
/** La liste des canaux est en cours de lecture (hb_mes_canaux) : pas de second abonnement en parallèle. */
let opening = false
/** Numéro de l'écoute en cours : une liste de canaux reçue après un arrêt (déconnexion) n'est pas abonnée. */
let listening = 0

const setLive = (signalsOn: boolean, on: boolean) => {
  const was = live
  live = on
  liveSignals = on && signalsOn
  versionHooks.live(liveSignals)
  // En (re)connexion, on rattrape ce qui a pu changer pendant la coupure.
  if (live && !was) syncSoon(0)
  listeners.forEach((l) => l())
}

/**
 * Écoute le serveur (seulement une fois connecté) : les canaux privés de hb_mes_canaux (signaux par table, contenu des
 * tables sans donnée personnelle, annonces de version) ; serveur sans 057 : postgres_changes sur toutes les tables.
 */
async function startRealtime() {
  if (!supabase || channel || channels.length || opening) return
  opening = true
  const gen = listening
  try {
    const { data, error } = await supabase.rpc('hb_mes_canaux')
    if (wiping || gen !== listening || channel || channels.length) return
    const topics = Array.isArray(data) ? (data as unknown[]).filter((t): t is string => typeof t === 'string' && t.startsWith('hb:')) : []
    if (error || !topics.length) {
      // Fonction absente (057 pas passé), compte sans canal (rôle pas encore connu) ou réseau : l'ancien canal ; la liste
      // sera relue au prochain changement de périmètre ou de session.
      if (error && !missingFunction(error)) console.warn('Canaux en direct :', error.message)
      startPostgresChanges()
      return
    }
    openChannels(topics)
  } finally {
    opening = false
  }
}

/** Canaux privés : Realtime vérifie le droit d'écoute à l'abonnement (jeton de session, règle hb_recevoir), puis diffuse. */
function openChannels(topics: string[]) {
  const subscribed = new Set<string>()
  for (const topic of topics) {
    const ch = supabase!.channel(topic, { config: { private: true } })
    for (const event of LIVE_EVENTS) ch.on('broadcast', { event }, (msg) => onLiveMessage(topic, event, (msg as { payload?: unknown }).payload))
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') subscribed.add(topic)
      else subscribed.delete(topic)
      // (Un canal déjà remplacé, périmètre changé, n'est jamais repris.)
      if (status === 'SUBSCRIBED' && channels.includes(ch)) ready.set(topic, ch)
      else if (ready.get(topic) === ch) ready.delete(topic)
      if (status === 'CHANNEL_ERROR') console.warn(`Canal en direct refusé : ${topic}`)
      // En direct dès que tous les canaux répondent (realtime-js réessaie seul ceux qui échouent).
      setLive(true, subscribed.size === topics.length)
    })
    channels.push(ch)
  }
}

/** Un message reçu sur un canal privé. */
function onLiveMessage(topic: string, event: string, payload: unknown) {
  if (event === 'version') {
    versionHooks.announced((payload as { v?: unknown } | undefined)?.v)
    return
  }
  // Table connue (SYNC_TABLES) et lue par ce compte : sinon rien, avec ou sans lignes.
  const s = parseSignal(payload, SYNC_TABLES)
  if (!s || !readsTable(s.table)) return
  // Ligne entière (configuration, critères, niveaux) : appliquée tout de suite, sans toucher au curseur (la relecture reste
  // la référence : la prochaine complète la fera, étalée). Rien d'autre à relire pour ce signal.
  if (event === 'ligne' && s.row && CONTENT_TABLES.includes(s.table)) {
    void applyLiveRows(s.table, [s.row]).then(
      (again) => again.length && signals.add(s.table, pullDelay(topic)),
      () => signals.add(s.table, pullDelay(topic)),
    )
    return
  }
  // Signal ciblé (src/syncLive.ts, planLive) : lignes appliquées sans rien relire, identifiants relus par identifiant ;
  // signal simple : la table est relue par curseur, comme avant.
  const plan = planLive(s, topic)
  if (plan.table) {
    signals.add(s.table, pullDelay(topic))
    return
  }
  const delay = pullDelay(topic)
  const reread = (ids: string[]) => {
    for (const id of ids) rereads.add(liveKey(s.table, id), delay)
  }
  reread(plan.ids)
  if (plan.rows.length)
    void applyLiveRows(s.table, plan.rows).then(reread, () => reread(plan.rows.map((r) => r.id)))
}

/**
 * Prévient les autres appareils d'un envoi réussi (plan B de 057 : la base ne diffuse plus) : messages calculés par
 * src/syncLive.ts (outgoingSignals : un signal par table et par canal, avec les lignes enregistrées de joueurs, mesures, avis
 * et « vu » là où elles peuvent voyager, sinon les identifiants ; contenu pour configuration, critères et niveaux),
 * envoyés seulement sur les canaux privés prêts. Ce qu'il faut savoir des lignes citées (joueur d'un avis, unité
 * organisatrice, membres d'un staff) est lu dans la base de l'appareil. Rien ne bloque ni n'échoue : un signal perdu est
 * rattrapé par le filet de sécurité des autres appareils.
 */
async function signalWrites(sent: Sent[]) {
  if (!ready.size) return
  try {
    const ids = (field: string, tables: SyncTable[]) =>
      sent.filter((s) => tables.includes(s.table)).flatMap((s) => s.rows.map((r) => r[field]).filter((x): x is string => typeof x === 'string'))
    const playerIds = [
      ...new Set([
        ...ids('playerId', ['measurements', 'evaluations', 'seen', 'rewatch']),
        ...ids('targetId', ['videos']),
        ...sent.filter((s) => s.table === 'events').flatMap((s) => s.rows.flatMap((r) => (Array.isArray(r.playerIds) ? (r.playerIds as string[]) : []))),
      ]),
    ]
    const teamIds = [...new Set(sent.filter((s) => s.table === 'groups' || s.table === 'events').flatMap((s) => s.rows.flatMap((r) => (Array.isArray(r.teams) ? (r.teams as string[]) : []))))]
    const needUnits = sent.some((s) => s.table === 'events' && s.rows.some((r) => typeof r.organizerUnitId === 'string' && r.organizerUnitId.trim()))
    const [players, teams, units] = await Promise.all([
      playerIds.length ? db.players.bulkGet(playerIds) : [],
      teamIds.length ? db.teams.bulkGet(teamIds) : [],
      needUnits ? db.units.toArray() : [],
    ])
    const playerMap = new Map(players.filter((p) => !!p).map((p) => [p!.id, p!]))
    const territories = new Map<string, { depts: string[]; clubs: string[] } | undefined>()
    const look: ChannelLookup = {
      player: (id) => playerMap.get(id),
      territory: (id) => {
        if (!territories.has(id)) territories.set(id, units.some((u) => u.id === id && !u.deleted) ? unitTerritory(units, id) : undefined)
        return territories.get(id)
      },
      teamMembers: (ids) => teams.filter((t) => !!t && !t.deleted && ids.includes(t.id)).flatMap((t) => t!.members ?? []),
    }
    for (const m of outgoingSignals(sent, new Set(ready.keys()), look, new Date().toISOString())) {
      void ready
        .get(m.topic)
        ?.send({ type: 'broadcast', event: m.event, payload: m.payload })
        .catch(() => {})
    }
  } catch (e) {
    console.warn('Signaux en direct :', e instanceof Error ? e.message : e)
  }
}

/** Ancien mode (serveur sans 057) : postgres_changes sur toutes les tables, chaque changement relance une synchronisation complète. */
function startPostgresChanges() {
  if (!supabase || channel) return
  channel = supabase.channel('handbase-sync')
  // Suivis, staffs et vidéos : pas de diffusion en direct (rarement changés ; relus à chaque synchronisation,
  // au plus toutes les minutes ; une table absente du serveur ne doit pas faire échouer l'abonnement).
  // Compte joueur : seulement sa fiche (le rôle peut n'être connu qu'après : alors toutes les tables, le serveur filtre).
  for (const t of SYNC_TABLES.filter((t) => !OPTIONAL_TABLES.includes(t) && (!playerAccount() || t === 'players'))) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: `hb_${t}` }, () => syncSoon())
  }
  channel.subscribe((status) => setLive(false, status === 'SUBSCRIBED'))
}

function stopRealtime() {
  if (!supabase) return
  listening++
  signals.cancel()
  rereads.cancel()
  for (const ch of channels) void supabase.removeChannel(ch)
  channels = []
  ready.clear()
  if (channel) void supabase.removeChannel(channel)
  channel = null
  setLive(false, false)
}

/** Périmètre ou session changés : les canaux à écouter aussi (relus au serveur). */
function restartRealtime() {
  stopRealtime()
  void startRealtime()
}

/** À appeler une fois au démarrage. */
export function startSync() {
  if (!supabase) return
  window.addEventListener('online', () => void syncNow())
  window.addEventListener('offline', () => setState('offline'))
  // Retour sur l'appli (téléphone déverrouillé, onglet réaffiché) : on se met à jour.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncSoon(0))
  db.outbox.hook('creating', () => pushLater())
  // Ne pas appeler Supabase directement dans ce callback (risque de blocage) : on diffère.
  supabase.auth.onAuthStateChange((_e, session) =>
    setTimeout(() => {
      if (session) void startRealtime()
      else stopRealtime()
      void syncNow()
    }, 0),
  )
  // Filet de sécurité si une notification est perdue : complète toutes les 5 minutes en direct, toutes les minutes sinon.
  setInterval(() => {
    if (dueForSync(Date.now(), lastFull, liveSignals)) void syncNow()
  }, 30_000)
  void syncNow()
}

/** Nombre de synchronisations terminées depuis le lancement (réussies ou non) : l'écran d'ouverture attend la première. */
let runs = 0

/**
 * Première page de joueurs reçue pendant ce lancement (ou table des joueurs lue jusqu'au bout, même vide) : au premier
 * chargement, l'écran d'ouverture laisse entrer dès ce moment (src/splash.ts), le reste arrive derrière.
 */
let playersReady = false
function markPlayersReady() {
  if (playersReady) return
  playersReady = true
  listeners.forEach((l) => l())
}

/** Serveur très demandé : une requête attend son tour pour être rejouée (src/retry.ts). */
const serverBusy = () => busyUntil > Date.now()

/** État de la synchro hors React (écran d'ouverture, src/splashScreen.ts). */
export const syncSnapshot = () => ({ state, progress, runs, playersReady, busy: serverBusy() })

/** Abonnement hors React ; renvoie la fonction de désabonnement. */
export function subscribeSync(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Appareil encore jamais synchronisé (aucune table reçue) : le premier chargement va tout télécharger. */
export const deviceEmpty = () => !SYNC_TABLES.some((t) => store.get(PULL_KEY(t)))

export function useSyncState() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return { state, lastError, live, progress, busy: serverBusy() }
}
