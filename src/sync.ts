import { createClient, isAuthRetryableFetchError, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { db, SYNC_TABLES, TRIAL, type SyncTable } from './db'
import { disablePush } from './push'
import { retireUnpublishedCriteria } from './criteriaImport'
import { aggregate, type SyncProgress, type TableProgress } from './syncProgress'
import { questionLogRights } from './questionLogCore'
import { orphanIds, planScopeChange, SCOPED_TABLES, scopeSignature, type ServerScope } from './perimeter'
import { spyTarget } from './spy'
import { playerReadsTable } from './playerSpace'
import { CONTENT_TABLES, dueForSync, Grouper, keepRows, LIVE_EVENTS, parseSignal, planPull, pullDelay, type ServerRow, type WhatsNew } from './syncLive'

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
 *  - en direct, le serveur envoie un SIGNAL ({t, id, v} : ni nom ni contenu) sur des canaux privés par périmètre
 *    (hb:dept:…, hb:club:…, hb:tout, hb:compte:…, hb:joueur:…, hb:staff, hb:commun ; liste donnée par hb_mes_canaux) ;
 *    l'appli ne relit que la table signalée, après 1,5 s de regroupement (canaux larges : + 0 à 10 s au hasard) ;
 *    configuration, critères et niveaux arrivent avec leur contenu (appliqué comme une ligne relue, curseur inchangé) ;
 *  - une écriture de l'appareil n'envoie que la file (sa ligne revient par le signal) ;
 *  - filet de sécurité : synchronisation complète toutes les 5 minutes quand le direct est abonné, toutes les minutes
 *    sinon ; toujours au retour sur l'appli et au retour du réseau ;
 *  - une nouvelle version annoncée (hb_annoncer_version, canal commun) : vérification de la mise à jour dans les 30 s.
 *  Serveur sans 057 (fonctions absentes) : relecture complète des 19 tables et postgres_changes, comme avant.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null
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
    try {
      await push()
    } catch (e) {
      pushError = e
    }
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

// Le serveur ne garde que les lignes autorisées pour le rôle du compte, et seulement si
// la version envoyée est plus récente (voir supabase/002_roles.sql). Il renvoie les refusées.
const upsert = (table: SyncTable, rows: Payload[]) => supabase!.rpc('hb_upsert', { p_table: table, p_rows: rows })

async function push() {
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
      const { data, error } = await upsert(table, payload)
      // Suivis, staffs ou vidéos envoyés avant que le serveur ne les connaisse (supabase/032_suivis.sql, 034_equipes_encadrants.sql,
      // 036_videos.sql pas encore passés) : gardés dans la file, renvoyés plus tard, sans bloquer la synchronisation.
      if (error && OPTIONAL_TABLES.includes(table) && /Table inconnue/.test(error.message)) break
      if (!error) {
        // La file n'est vidée qu'une fois les refus traités (sinon on renverra).
        await applyRejected(table, data)
        await db.outbox.bulkDelete(part.map((it) => it.seq!))
        continue
      }
      if (transient(error)) throw error
      // Paquet refusé : on renvoie ligne par ligne pour isoler la ou les lignes fautives.
      for (const p of payload) {
        const one = await upsert(table, [p])
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
      }
      // Entrées de la file dont la ligne n'existe plus sur l'appareil : rien à envoyer.
      const sent = new Set(payload.map((p) => p.id))
      await db.outbox.bulkDelete(part.filter((it) => !sent.has(it.rowId)).map((it) => it.seq!))
    }
  }
  // Lignes refusées pas encore mises de côté : on le signale (elles repartiront au prochain envoi).
  if ([...failures.keys()].some((k) => !setAside.has(k))) throw new Error(`Envoi refusé : ${lastPushError}`)
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
const PULL_PAGE = 1000

/** Nombre de lignes à recevoir depuis start, estimé par le serveur sans les télécharger (0 si inconnu). */
async function countSince(table: SyncTable, start: string) {
  try {
    const { count } = await supabase!.from(`hb_${table}`).select('id', { count: 'estimated', head: true }).gte('server_updated_at', start)
    return count ?? 0
  } catch {
    return 0
  }
}

const setProgress = (p: SyncProgress | null) => {
  progress = p
  listeners.forEach((l) => l())
}

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
  const curseurs: Record<string, string> = {}
  for (const t of tables) curseurs[t] = localStorage.getItem(PULL_KEY(t))!
  const { data, error } = await supabase!.rpc('hb_quoi_de_neuf', { curseurs })
  if (error) {
    if (missingFunction(error)) whatsNewMissingAt = Date.now()
    return null
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as WhatsNew) : null
}

/**
 * Reçoit les nouveautés. scope : tables signalées en direct (synchronisation ciblée : ces seules tables, rien d'autre) ;
 * null : synchronisation complète (« quoi de neuf ? », puis les tables signalées ; tables jamais reçues toujours relues ;
 * puis les vérifications périodiques).
 */
async function pull(uid: string, scope: Set<SyncTable> | null) {
  /*
   * Avancement : tables jamais téléchargées comptées d'avance (en parallèle) ; les autres seulement si
   * leur premier paquet est plein (gros retard). Une petite synchro ordinaire ne fait aucune requête de plus.
   */
  const per: Partial<Record<SyncTable, TableProgress>> = {}
  const readable = SYNC_TABLES.filter(readsTable)
  const wanted = scope ? readable.filter((t) => scope.has(t)) : readable
  const fresh = new Set(wanted.filter((t) => !localStorage.getItem(PULL_KEY(t))))
  const first = fresh.size === readable.length
  await Promise.all([...fresh].map(async (t) => (per[t] = { done: 0, total: await countSince(t, '1970-01-01T00:00:00Z') })))
  if (fresh.size) setProgress(aggregate(per, null, first))
  // Complète, appareil déjà servi au moins une fois : une requête dit quelles tables ont changé (premier chargement : tout).
  const flags = scope || first ? null : await whatsNew(wanted.filter((t) => !fresh.has(t)))
  const plan = planPull(wanted, fresh, flags)
  for (const t of plan.quiet) knowTable(t, true)
  for (const t of plan.absent) knowTable(t, false)
  const toPull = new Set(plan.pull)
  try {
    const teamsBefore = await myTeams(uid)
    let structureRows = 0
    for (const table of SYNC_TABLES) {
      // Staffs changés : les groupes « Mon staff » et les « à revoir » (041, visibles par le staff de leur auteur) qu'ils
      // ouvrent sont relus en entier.
      if (table === 'groups') {
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
      const n = await pullTable(table, per, first)
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
  // Compte joueur : ni groupes, ni staffs, ni périmètre : rien à vérifier (sa fiche arrive par le curseur ; retirée du compte
  // (accès retiré) : le serveur ne la montre plus, l'appli repasse à « Entre ton code » et l'appareil est effacé à la déconnexion).
  if (playerAccount()) return
  await forgetHidden()
  await checkPerimeter(uid)
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

async function checkPerimeter(uid: string) {
  if (!structureChanged && Date.now() - lastScopeCheck < FORGET_EVERY_MS) return
  const { data, error } = await supabase!.rpc('hb_my_perimeter')
  if (error || !data || typeof data !== 'object') return // 046 pas passé, ou réseau : on réessaiera
  lastScopeCheck = Date.now()
  structureChanged = false
  const scope = data as ServerScope
  const plan = planScopeChange(store.get(SCOPE_KEY), scope, Number(store.get(SCOPE_FORGET_KEY) ?? 0), Date.now())
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
async function applyServerRows(table: SyncTable, rows: ServerRow[]) {
  if (!rows.length) return
  await db.transaction('rw', db.table(table), async () => {
    const locals = (await db.table(table).bulkGet(rows.map((r) => r.id))) as ({ updatedAt?: number } | undefined)[]
    const newer = keepRows(rows, locals)
    if (newer.length) await db.table(table).bulkPut(newer.map((r) => r.data))
  })
}

/** Reçoit les lignes changées depuis le curseur de la table ; renvoie le nombre de lignes reçues. */
async function pullTable(table: SyncTable, per: Partial<Record<SyncTable, TableProgress>>, first: boolean): Promise<number> {
  const since = localStorage.getItem(PULL_KEY(table)) ?? '1970-01-01T00:00:00Z'
  let received = 0
  const at = new Date(since).getTime()
  const start = new Date(Date.now() - at < OVERLAP_WINDOW_MS ? at - PULL_OVERLAP_MS : at).toISOString()
  let after: { at: string; id: string } | null = null
  for (;;) {
    const base = supabase!.from(`hb_${table}`).select('id, data, server_updated_at')
    const filtered = after
      ? base.or(`server_updated_at.gt."${after.at}",and(server_updated_at.eq."${after.at}",id.gt."${after.id}")`)
      : base.gte('server_updated_at', start)
    const { data, error } = await filtered.order('server_updated_at').order('id').limit(PULL_PAGE)
    // Table des suivis, des staffs ou des vidéos absente du serveur (supabase/032, 034, 036 pas encore passés) : rien à recevoir.
    if (error && OPTIONAL_TABLES.includes(table) && missingTable(error)) {
      knowTable(table, false)
      return received
    }
    if (error) throw error
    if (!data?.length) break
    received += data.length
    await applyServerRows(table, data as ServerRow[])
    const last: { id: string; server_updated_at: string } = data[data.length - 1]
    after = { at: last.server_updated_at, id: last.id }
    if (new Date(last.server_updated_at) > new Date(since)) localStorage.setItem(PULL_KEY(table), last.server_updated_at)
    // Gros retard (premier paquet plein) : on compte ce qui reste, une seule fois.
    if (!per[table] && data.length === PULL_PAGE) per[table] = { done: 0, total: await countSince(table, start) }
    const p = per[table]
    if (p) {
      p.done += data.length
      setProgress(aggregate(per, table, first))
    }
    if (data.length < PULL_PAGE) break
  }
  // Table terminée : son total devient exact (l'estimation peut être un peu fausse).
  if (per[table]) per[table]!.total = per[table]!.done
  // Table vide sur le serveur : curseur posé quand même, pour ne plus la recompter à chaque synchro.
  if (!localStorage.getItem(PULL_KEY(table))) localStorage.setItem(PULL_KEY(table), since)
  knowTable(table, true)
  return received
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
  const s = parseSignal(payload, SYNC_TABLES)
  if (!s || !readsTable(s.table)) return
  // Ligne entière (configuration, critères, niveaux) : appliquée tout de suite, sans toucher au curseur (la relecture reste
  // la référence : la prochaine complète la fera, étalée). Rien d'autre à relire pour ce signal.
  if (event === 'ligne' && s.row && CONTENT_TABLES.includes(s.table)) {
    void applyServerRows(s.table, [s.row]).catch(() => signals.add(s.table, pullDelay(topic)))
    return
  }
  signals.add(s.table, pullDelay(topic))
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
  for (const ch of channels) void supabase.removeChannel(ch)
  channels = []
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

/** État de la synchro hors React (écran d'ouverture, src/splashScreen.ts). */
export const syncSnapshot = () => ({ state, progress, runs })

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
  return { state, lastError, live, progress }
}
