import { createClient, isAuthApiError, isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import Dexie from 'dexie'
import { useEffect, useState } from 'react'
import { REFRESH_GATE_KEY, readGate, tokenMark, webLock } from './authRefresh'
import { db, TRIAL } from './db'
import { realRole, realUserId, useRole } from './roles'
import { GATE_MIRROR_KEY, parseSession } from './sessionStore'
import { spyTarget } from './spy'
import { accountHooks, authStorage, authStorageKey, freezeSync, serverConfig, sessionKv, supabase } from './sync'
import {
  accountsView,
  addErrorText,
  addTest,
  BASE_KEY,
  bundleKey,
  bundleOf,
  CHANNEL,
  firstName,
  HOME_DB,
  homeUidOf,
  linkedUids,
  parseRemote,
  placeFor,
  REMOTE_KEY,
  remoteErrorText,
  remoteFromRows,
  remoteText,
  type RemoteAccount,
  realDbName,
  isAccountKey,
  isTestDb,
  LIST_KEY,
  listText,
  park,
  parseBundle,
  parseList,
  removeTest,
  sessionFresh,
  tokensOf,
  unpark,
  accountOfDb,
  type Identity,
  type SavedAccount,
} from './comptesCore'

/*
 * « CHANGER DE COMPTE » (administrateur qui essaie la page d'un jeune) : règles dans src/comptesCore.ts ; ici le stockage, la
 * session et le rechargement.
 *
 * PASSER SUR UN AUTRE COMPTE (switchTo) :
 *  1. sa session garée est rafraîchie si son jeton d'accès a expiré (client de connexion à part, sans stockage) ; refus
 *     définitif du serveur : on ne change pas, l'appli propose de reconnecter ce compte ;
 *  2. la synchronisation et le renouvellement automatique s'arrêtent (la synchro en cours se termine d'abord) ;
 *  3. DANS LE VERROU DE RENOUVELLEMENT (src/authRefresh.ts, commun aux onglets et au service worker) : on relit la session
 *     active (les derniers jetons ; un renouvellement qui vient d'aboutir est attendu), on la gare avec les réglages
 *     handbase.* du compte, on écrit la session du compte choisi à la place (UNE SEULE copie de chaque session : jamais garée
 *     ET active, voir src/sessionStore.ts), on remet ses réglages et sa base ;
 *  4. les autres onglets se rechargent, celui-ci aussi : tout repart comme après une connexion (rôle, canaux en direct,
 *     « Voir comme… » fini, écrans), dans l'espace du compte choisi (sa base, ses réglages).
 * Ajouter un compte : connexion sur un client à part (persistSession false), puis passage sur lui. La session de
 * l'administrateur n'est jamais fermée. Déconnexion complète (src/sync.ts wipeDevice) : tout part (forgetAll).
 * Notifications : l'abonnement de l'appareil reste au compte maison (pas réenregistré pendant un compte de test, src/App.tsx).
 *
 * COMPTES GARDÉS SUR LE COMPTE ADMINISTRATEUR (« ça marche de partout », supabase/076_comptes_test.sql, fonction edge
 * comptes-test ; règles pures dans src/comptesCore.ts) :
 *  - Ajout avec mot de passe : le jeton d'accès du compte de test (preuve du mot de passe) part UNE fois à la fonction
 *    (« lier ») avec celui de l'administrateur ; rien n'est gardé au serveur que l'e-mail, le nom et le rôle.
 *  - Liste lue par l'administrateur actif (table, ses lignes seulement), copiée sur l'appareil (REMOTE_KEY) pour rester
 *    visible pendant un compte de test.
 *  - Compte de la liste absent de l'appareil : « ouvrir » (fonction, jeton de l'administrateur, actif ou garé) rend un jeton
 *    de connexion à usage unique, échangé sur un client à part (verifyOtp) ; puis passage sur lui comme après un ajout.
 *  - Appareil plein : le compte enregistré utilisé le moins récemment laisse sa place (releaseCandidate).
 *  - « Retirer » : de l'appareil ET du serveur. Comptes ajoutés avant cette version : liés sans mot de passe tant que leur
 *    session est gardée (« Garder sur tous mes appareils »).
 *  - Avant 076 ou sans la fonction (base pas à jour, essai sans serveur) : copie absente, rien de nouveau, aucun message.
 *    Jamais pendant « Voir comme… ».
 */

const kv = sessionKv
const ls = (() => {
  try {
    return localStorage
  } catch {
    return null
  }
})()
/** Paires clé → valeur du stockage local. */
function lsEntries(): [string, string][] {
  const out: [string, string][] = []
  try {
    for (let i = 0; i < (ls?.length ?? 0); i++) {
      const k = ls!.key(i)
      const v = k == null ? null : ls!.getItem(k)
      if (k != null && v != null) out.push([k, v])
    }
  } catch {
    /* stockage indisponible */
  }
  return out
}

/** Fonction disponible : serveur configuré, IndexedDB utilisable (même stockage que la session). */
export const accountsAvailable = () => !!supabase && !!serverConfig && !!kv && !authStorage.degraded

let list: SavedAccount[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

async function readList(): Promise<SavedAccount[]> {
  try {
    list = parseList(await kv?.get(LIST_KEY))
  } catch {
    /* stockage illisible : la liste connue reste */
  }
  emit()
  return list
}
async function writeList(next: SavedAccount[]) {
  await kv!.set(LIST_KEY, listText(next))
  list = next
  emit()
}
if (accountsAvailable()) void readList()

// ---------- Liste du serveur (copie locale) ----------

let remoteRaw: string | null = null
async function readRemote() {
  try {
    remoteRaw = (await kv?.get(REMOTE_KEY)) ?? null
  } catch {
    /* illisible : la copie connue reste */
  }
  emit()
}
async function writeRemote(admin: string, rows: RemoteAccount[] | null) {
  if (rows) await kv!.set(REMOTE_KEY, remoteText(admin, rows))
  else await kv!.del(REMOTE_KEY)
  remoteRaw = rows ? remoteText(admin, rows) : null
  emit()
}
if (accountsAvailable()) void readRemote()

/** Administrateur de l'appareil (maison, ou compte actif administrateur). */
const homeUid = () => homeUidOf(list, realUserId(), realRole())
/** Liste du serveur connue pour l'administrateur de l'appareil ; null : inconnue (ou « Voir comme… » : rien du serveur). */
const remoteList = () => (spyTarget() ? null : parseRemote(remoteRaw, homeUid()))

let remoteReadAt = 0
/**
 * Relit la liste du serveur (administrateur actif, en ligne, hors « Voir comme… », au plus une fois par minute). Table absente
 * (avant 076) : copie effacée, sans message ; autre échec : copie gardée.
 */
export async function refreshRemote(force = false) {
  if (!accountsAvailable() || spyTarget() || realRole() !== 'admin' || onTestAccount() || !navigator.onLine) return
  const me = realUserId()
  if (!me || (!force && Date.now() - remoteReadAt < 60_000)) return
  remoteReadAt = Date.now()
  try {
    const token = await activeToken()
    if (!token) return
    // Fonction présente ? Une demande vide lui fait répondre « demande » (400) sans rien lire ni écrire ; absente, le serveur
    // répond autre chose (404, 503…) : rien du serveur n'est montré (on ne propose pas ce qu'on ne peut pas faire).
    const [probe, read] = await Promise.all([
      callRemote(token, {}),
      timeout(Promise.resolve(supabase!.from('hb_comptes_test').select('test_uid, email, libelle, role, ajoute_le')), 10_000),
    ])
    if (!probe) return
    const { data, error } = read
    if (error) {
      if (/PGRST205|42P01|does not exist|schema cache/i.test(`${error.code} ${error.message}`)) await writeRemote(me, null)
      return
    }
    await writeRemote(me, functionHere(probe) ? remoteFromRows(data) : null)
  } catch {
    /* réseau : plus tard */
  }
}

/** Base de l'espace actif (src/db.ts). */
export const activeDb = () => db.name
/** Un compte de test est actif (bandeau, pas de réabonnement aux notifications). */
export const onTestAccount = () => isTestDb(activeDb())
/** Comptes gardés sur l'appareil (déconnexion : on prévient qu'ils partent aussi). */
export const keptAccounts = () => list.filter((a) => !!a.session).length

/** Ce que montrent le menu du compte, le bandeau et l'écran de connexion. */
export function useAccountsView() {
  useRole()
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  const admin = accountsAvailable() && realRole() === 'admin' && !onTestAccount()
  useEffect(() => {
    if (admin) void refreshRemote()
  }, [admin])
  if (!accountsAvailable()) return accountsView([], null, HOME_DB, '')
  return accountsView(list, realUserId(), activeDb(), realRole(), remoteList())
}

// ---------- Client de connexion à part (aucun stockage : rien n'écrase la session active) ----------

let tempN = 0
const tempClient = () =>
  createClient(serverConfig!.url, serverConfig!.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `hb-compte-${++tempN}` },
  })

const timeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, ko) => setTimeout(() => ko(new Error('délai')), ms))])

/** Session garée rafraîchie : nouveau texte ; definitive : refusée pour de bon (révoquée, expirée) ; sinon : réessayer plus tard. */
async function refreshParked(text: string): Promise<{ text?: string; definitive?: boolean }> {
  const t = tokensOf(text)
  if (!t) return { definitive: true }
  try {
    const { data, error } = await timeout(tempClient().auth.refreshSession({ refresh_token: t.refresh_token }), 15_000)
    if (data.session) return { text: JSON.stringify(data.session) }
    const status = (error as { status?: number } | null)?.status ?? 0
    if (error && isAuthApiError(error) && !isAuthRetryableFetchError(error) && [400, 401, 403, 404].includes(status)) return { definitive: true }
  } catch {
    /* réseau : plus tard */
  }
  return {}
}

/** Ferme une session au serveur (celle-ci seulement : les autres appareils du compte restent connectés). Au mieux. */
async function revoke(text: string | null) {
  const t = tokensOf(text)
  if (!t || !navigator.onLine) return
  const c = tempClient()
  let access = t.access_token
  if (!sessionFresh(text, Date.now(), 30)) {
    const { data } = await c.auth.refreshSession({ refresh_token: t.refresh_token })
    if (!data.session) return
    access = data.session.access_token
  }
  await c.auth.admin.signOut(access, 'local')
}

async function deleteDb(name: string) {
  await Promise.race([Dexie.delete(name).catch(() => {}), new Promise((r) => setTimeout(r, 2000))])
}

const identity = (s: Pick<Session, 'user'>, role: string): Identity => ({
  uid: s.user.id,
  name: ((s.user.user_metadata?.full_name as string | undefined) ?? '').trim(),
  email: s.user.email ?? '',
  role,
})

// ---------- Fonction comptes-test (serveur) ----------

type Reply = { status: number; body: Record<string, unknown> }

/** Appel de la fonction ; null : injoignable (hors ligne, fonction absente du serveur, délai). Rien n'est journalisé. */
async function callRemote(adminToken: string, body: Record<string, unknown>): Promise<Reply | null> {
  try {
    const res = await timeout(
      fetch(`${serverConfig!.url.replace(/\/+$/, '')}/functions/v1/comptes-test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, apikey: serverConfig!.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      15_000,
    )
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, body: json && typeof json === 'object' ? json : {} }
  } catch {
    return null
  }
}

/** Réponse de la fonction à une demande vide : elle est déployée (sinon : 404, 503… du serveur des fonctions). */
const functionHere = (r: Reply) => r.status === 400 && r.body.error === 'demande'

/** Jeton d'accès valable d'un compte garé (rafraîchi à part et regardé si besoin) ; null : pas possible maintenant. */
async function parkedToken(uid: string): Promise<string | null> {
  const a = list.find((x) => x.uid === uid)
  if (!a?.session) return null
  if (sessionFresh(a.session, Date.now())) return tokensOf(a.session)?.access_token ?? null
  if (!navigator.onLine) return null
  const r = await refreshParked(a.session)
  if (!r.text) return null
  await writeList(parseList(await kv!.get(LIST_KEY)).map((x) => (x.uid === uid && x.session ? { ...x, session: r.text! } : x)))
  return tokensOf(r.text)?.access_token ?? null
}

/** Jeton du compte actif (supabase-js). */
async function activeToken(): Promise<string | null> {
  const { data } = await timeout(supabase!.auth.getSession(), 5000).catch(() => ({ data: { session: null } }))
  return data.session?.access_token ?? null
}

/** Jeton de l'administrateur de l'appareil : actif, ou garé (maison). Jamais pendant « Voir comme… ». */
async function adminToken(): Promise<string | null> {
  if (spyTarget()) return null
  if (realRole() === 'admin' && !onTestAccount()) return activeToken()
  await readList()
  const home = list.find((a) => a.home && a.session)
  return home ? parkedToken(home.uid) : null
}

/** Enregistre un compte de test sur le compte administrateur (preuve : son jeton d'accès). Au mieux, sans message. */
async function linkRemote(testToken: string): Promise<boolean> {
  if (!accountsAvailable() || spyTarget() || !navigator.onLine) return false
  const admin = await adminToken()
  const me = homeUid()
  if (!admin || !me) return false
  const r = await callRemote(admin, { action: 'lier', jeton_test: testToken })
  const row = r?.status === 200 ? remoteFromRows([r.body.compte])[0] : undefined
  if (!row) return false
  const known = parseRemote(remoteRaw, me) ?? []
  await writeRemote(me, [...known.filter((k) => k.uid !== row.uid), row])
  return true
}

/** Retire un compte de test du compte administrateur. Au mieux : hors ligne, il reste au serveur (réapparaît dans la liste). */
async function unlinkRemote(uid: string) {
  const me = homeUid()
  const known = parseRemote(remoteRaw, me)
  if (!me || !known?.some((k) => k.uid === uid)) return
  const admin = await adminToken()
  const r = admin ? await callRemote(admin, { action: 'retirer', test_uid: uid }) : null
  if (r?.status === 200) await writeRemote(me, known.filter((k) => k.uid !== uid))
}

// ---------- Autres onglets ----------

const channel = (() => {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
  } catch {
    return null
  }
})()
// Un autre onglet a changé de compte : celui-ci repart dans le nouvel espace (sa base, sa session).
if (channel) channel.onmessage = () => location.reload()

// ---------- Changer de compte ----------

export type SwitchResult = { ok: true } | { ok: false; message: string; reconnect?: SavedAccount }

const fail = (message: string, reconnect?: SavedAccount): SwitchResult => ({ ok: false, message, reconnect })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Passe sur le compte `uid` (voir l'en-tête). incoming : compte qu'on vient de connecter (ajout, ou reconnexion d'un compte
 * dont la session ne valait plus). dropCurrent : le compte actif est retiré de l'appareil (« Retirer ce compte ») : sa session
 * est fermée, son espace effacé. Réussite : l'appli se recharge (ne revient pas).
 */
export async function switchTo(uid: string, opts: { incoming?: { acc: Identity; session: string }; dropCurrent?: boolean } = {}): Promise<SwitchResult> {
  if (!accountsAvailable()) return fail('Changement de compte indisponible sur cet appareil.')
  await readList()
  const known = list.find((a) => a.uid === uid)
  let target = opts.incoming?.session ?? known?.session ?? null
  if (!target) return fail('Ce compte n’est plus gardé sur l’appareil.')
  // 1. Session garée périmée : rafraîchie à part (hors ligne : reprise telle quelle, l'appli travaille hors ligne).
  if (!opts.incoming && !sessionFresh(target, Date.now()) && navigator.onLine) {
    const r = await refreshParked(target)
    if (r.definitive) return fail(`La session de ${firstName(known!)} n’est plus valable : reconnecte ce compte.`, known)
    if (r.text) {
      target = r.text
      // Nouveau jeton (l'ancien est remplacé au serveur) : gardé tout de suite.
      await writeList(list.map((a) => (a.uid === uid ? { ...a, session: r.text! } : a)))
    }
  }
  // 2. Plus rien ne part de cet onglet avec l'ancienne session.
  await supabase!.auth.stopAutoRefresh().catch(() => {})
  await timeout(supabase!.auth.getSession(), 5000).catch(() => null)
  await freezeSync()
  let dropped: string | null = null
  let droppedSession: string | null = null
  try {
    // 3. Dans le verrou de renouvellement (aucun renouvellement en vol, ni ici, ni ailleurs, ni dans le service worker).
    const err = await webLock()(async () => {
      // Un renouvellement vient d'aboutir mais sa session n'est pas encore enregistrée (src/authRefresh.ts, « used ») : on l'attend.
      let current: string | null = null
      for (let i = 0; i < 12; i++) {
        current = await authStorage.getItem(authStorageKey)
        const rt = parseSession(current)?.refresh_token
        if (!rt || readGate(ls?.getItem(REFRESH_GATE_KEY) ?? null).used !== tokenMark(rt)) break
        await sleep(250)
      }
      const cur = parseSession(current)
      const curUid = cur?.user?.id ?? null
      const now = Date.now()
      let next = parseList(await kv!.get(LIST_KEY))
      const here = db.name
      if (curUid && !opts.dropCurrent) {
        next = park(next, identity(cur as unknown as Session, realRole()), current!, here, now)
        await kv!.set(bundleKey(curUid), JSON.stringify(bundleOf(lsEntries())))
      } else {
        // Compte retiré, ou session de ce compte de test refusée (écran de connexion) : son espace part.
        const mine = (curUid && next.find((a) => a.uid === curUid)) || accountOfDb(next, here)
        if (opts.dropCurrent) droppedSession = current
        if (mine && !mine.home) {
          next = removeTest(next, mine.uid)
          await kv!.del(bundleKey(mine.uid))
          dropped = mine.db
        }
      }
      if (opts.incoming) {
        const r = addTest(next, opts.incoming.acc, target!, opts.dropCurrent ? null : curUid, now)
        if (r.error) return addErrorText(r.error)
        next = r.list
      }
      const dest = next.find((a) => a.uid === uid)
      if (!dest) return 'Ce compte n’est plus gardé sur l’appareil.'
      next = unpark(next, uid, now)
      const bundle = parseBundle(await kv!.get(bundleKey(uid)))
      // Session du compte choisi d'abord (une seule écriture) ; puis la liste (il n'y est plus garé : jamais deux copies).
      await authStorage.setItem(authStorageKey, target!)
      await writeList(next)
      await kv!.del(bundleKey(uid))
      if (bundle[REFRESH_GATE_KEY]) await kv!.set(GATE_MIRROR_KEY, bundle[REFRESH_GATE_KEY])
      else await kv!.del(GATE_MIRROR_KEY)
      if (dest.db === HOME_DB) await kv!.del(BASE_KEY)
      else await kv!.set(BASE_KEY, dest.db)
      // Réglages : ceux du compte choisi seulement ; sa base à l'ouverture suivante.
      if (ls) {
        for (const [k] of lsEntries()) if (isAccountKey(k)) ls.removeItem(k)
        for (const [k, v] of Object.entries(bundle)) ls.setItem(k, v)
        if (dest.db === HOME_DB) ls.removeItem(BASE_KEY)
        else ls.setItem(BASE_KEY, dest.db)
      }
      try {
        for (const k of Object.keys(sessionStorage)) if (/^handbase(-essai)?\./.test(k)) sessionStorage.removeItem(k)
      } catch {
        /* stockage indisponible */
      }
      return null
    })
    if (err) {
      location.reload()
      return fail(err)
    }
    // Compte retiré : sa session fermée au serveur, sa base effacée.
    if (droppedSession) await timeout(revoke(droppedSession), 4000).catch(() => {})
    if (dropped) {
      db.close()
      await deleteDb(dropped)
    }
  } catch {
    // Rien d'écrit, ou écriture interrompue : l'appli repart sur ce qui est enregistré (src/sync.ts claimDevice protège les données).
  }
  channel?.postMessage('change')
  location.assign(import.meta.env.BASE_URL)
  return { ok: true }
}

/**
 * « Ajouter un compte de test… » (ou reconnecter un compte gardé) : connexion sur un client à part (la session active ne
 * bouge pas), puis passage sur ce compte.
 */
export async function addAccount(email: string, password: string): Promise<SwitchResult> {
  if (!accountsAvailable()) return fail('Changement de compte indisponible sur cet appareil.')
  if (!navigator.onLine) return fail('Pas de connexion internet : il faut être en ligne pour connecter un compte.')
  const c = tempClient()
  const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password }).catch((e: unknown) => ({ data: { session: null }, error: e as Error }))
  if (error || !data.session) return fail(/temp_password_expired/.test((error as Error | null)?.message ?? '') ? 'Ce mot de passe provisoire a expiré (24 h).' : 'E-mail ou mot de passe incorrect.')
  const s = data.session
  const { data: prof } = await c.from('hb_profiles').select('role').eq('user_id', s.user.id).maybeSingle()
  const acc = identity(s, (prof as { role?: string } | null)?.role ?? '')
  await readList()
  const check = addTest(list, acc, '', realUserId(), Date.now())
  if (check.error === 'actif') {
    await c.auth.signOut({ scope: 'local' }).catch(() => {})
    return fail(addErrorText(check.error))
  }
  // Compte de test (pas l'administrateur reconnecté) : enregistré sur le compte administrateur, pour tous ses appareils.
  if (acc.role !== 'admin' && !list.find((a) => a.uid === acc.uid)?.home) await linkRemote(s.access_token).catch(() => false)
  const place = placeFor(list, acc.uid, realUserId(), linkedUids(remoteList()))
  if ('error' in place) {
    await c.auth.signOut({ scope: 'local' }).catch(() => {})
    return fail(addErrorText(place.error))
  }
  if ('release' in place) await releaseLocal(place.release.uid)
  return switchTo(acc.uid, { incoming: { acc, session: JSON.stringify(s) } })
}

/**
 * Compte enregistré sur le compte administrateur mais pas sur cet appareil : ouvert au serveur (jeton de connexion à usage
 * unique, aucun e-mail), échangé sur un client à part, puis passage sur lui (il devient un compte gardé de l'appareil).
 */
export async function openRemote(uid: string): Promise<SwitchResult> {
  if (!accountsAvailable() || spyTarget()) return fail('Changement de compte indisponible pour l’instant.')
  if (!navigator.onLine) return fail('Pas de connexion internet : il faut être en ligne pour ouvrir ce compte.')
  await readList()
  const row = remoteList()?.find((r) => r.uid === uid)
  if (!row) return fail('Ce compte de test n’est plus gardé sur ton compte.')
  const place = placeFor(list, uid, realUserId(), linkedUids(remoteList()))
  if ('error' in place) return fail(addErrorText(place.error))
  const admin = await adminToken()
  if (!admin) return fail('Reviens sur ton compte administrateur pour ouvrir ce compte.')
  const r = await callRemote(admin, { action: 'ouvrir', test_uid: uid })
  const hash = typeof r?.body.token_hash === 'string' ? r.body.token_hash : ''
  if (!hash) {
    const code = typeof r?.body.error === 'string' ? r.body.error : ''
    // Ligne ou compte disparus au serveur : retirés de la copie locale.
    if (code === 'inconnu' || code === 'cible_absente') {
      const me = homeUid()
      if (me) await writeRemote(me, (parseRemote(remoteRaw, me) ?? []).filter((k) => k.uid !== uid))
    }
    return fail(remoteErrorText(code))
  }
  const c = tempClient()
  let v = await c.auth.verifyOtp({ token_hash: hash, type: 'magiclink' }).catch(() => ({ data: { session: null } }))
  // Serveur d'authentification plus récent (type « magiclink » retiré) : même jeton, type « email ».
  if (!v.data.session) v = await c.auth.verifyOtp({ token_hash: hash, type: 'email' }).catch(() => ({ data: { session: null } }))
  const s = v.data.session
  if (!s || s.user.id !== uid) return fail(remoteErrorText(''))
  const { data: prof } = await c.from('hb_profiles').select('role').eq('user_id', s.user.id).maybeSingle()
  const acc = identity(s, (prof as { role?: string } | null)?.role ?? row.role)
  if (acc.role === 'admin') {
    await c.auth.signOut({ scope: 'local' }).catch(() => {})
    return fail(remoteErrorText('cible_admin'))
  }
  if ('release' in place) await releaseLocal(place.release.uid)
  return switchTo(uid, { incoming: { acc, session: JSON.stringify(s) } })
}

/**
 * Comptes de test de l'appareil ajoutés AVANT cette version (ou hors ligne) : enregistrés sur le compte administrateur sans
 * retaper leur mot de passe, tant que leur session est gardée (jeton d'accès rafraîchi = preuve). Rend le nombre enregistré.
 */
export async function linkKept(): Promise<number> {
  if (!accountsAvailable() || spyTarget() || !navigator.onLine) return 0
  await readList()
  const known = linkedUids(remoteList())
  const activeUid = realUserId()
  let n = 0
  for (const a of list.filter((x) => !x.home && !known.includes(x.uid))) {
    const token = a.uid === activeUid && !a.session ? await activeToken() : await parkedToken(a.uid)
    if (token && (await linkRemote(token).catch(() => false))) n++
  }
  return n
}

/** Compte de test libéré de l'appareil seulement (session fermée, espace effacé) ; il reste enregistré au serveur. */
async function releaseLocal(uid: string) {
  const acc = list.find((a) => a.uid === uid)
  if (!acc || acc.home || uid === realUserId() || acc.db === activeDb()) return
  await timeout(revoke(acc.session), 4000).catch(() => {})
  await deleteDb(acc.db)
  await kv!.del(bundleKey(uid))
  await writeList(removeTest(parseList(await kv!.get(LIST_KEY)), uid))
}

/**
 * « Retirer ce compte » : de l'appareil (sa session fermée, son espace effacé) ET du compte administrateur (tous ses
 * appareils). Le compte actif : retour sur la maison. Compte seulement au serveur : retiré du serveur.
 */
export async function removeAccount(uid: string): Promise<SwitchResult> {
  if (!accountsAvailable()) return fail('Changement de compte indisponible sur cet appareil.')
  await readList()
  const acc = list.find((a) => a.uid === uid)
  if (!acc && remoteList()?.some((r) => r.uid === uid)) {
    await unlinkRemote(uid)
    return remoteList()?.some((r) => r.uid === uid) ? fail('Pas de connexion au serveur : réessaie dans un moment.') : { ok: true }
  }
  if (!acc || acc.home) return fail('Ce compte n’est pas un compte de test de l’appareil.')
  if (uid === realUserId() || acc.db === activeDb()) {
    const home = list.find((a) => a.home && a.session)
    if (!home) return fail('Le compte administrateur n’est plus gardé : utilise « Se déconnecter ».')
    await timeout(unlinkRemote(uid), 8000).catch(() => {})
    return switchTo(home.uid, { dropCurrent: true })
  }
  await timeout(unlinkRemote(uid), 8000).catch(() => {})
  await releaseLocal(uid)
  return { ok: true }
}

/**
 * Déconnexion complète ou données d'un autre compte (src/sync.ts wipeDevice, qui efface ensuite la base ouverte) : comptes
 * gardés, leurs réglages et leurs bases d'abord (sur l'appareil), puis leurs sessions fermées au serveur si possible.
 */
async function forgetAll() {
  if (!kv) return
  let all: SavedAccount[] = []
  try {
    all = parseList(await kv.get(LIST_KEY))
  } catch {
    /* illisible */
  }
  await kv.del(LIST_KEY).catch(() => {})
  await kv.del(BASE_KEY).catch(() => {})
  await kv.del(REMOTE_KEY).catch(() => {})
  remoteRaw = null
  try {
    ls?.removeItem(BASE_KEY)
  } catch {
    /* stockage indisponible */
  }
  list = []
  for (const a of all) await kv.del(bundleKey(a.uid)).catch(() => {})
  const dbs = new Set([realDbName(HOME_DB, TRIAL), ...all.map((a) => realDbName(a.db, TRIAL))])
  dbs.delete(db.name)
  for (const name of dbs) await deleteDb(name)
  await Promise.race([Promise.all(all.map((a) => revoke(a.session).catch(() => {}))), sleep(3000)])
}
accountHooks.forgetAll = forgetAll
