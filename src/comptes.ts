import { createClient, isAuthApiError, isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import Dexie from 'dexie'
import { useEffect, useState } from 'react'
import { REFRESH_GATE_KEY, readGate, tokenMark, webLock } from './authRefresh'
import { db, TRIAL } from './db'
import { realRole, realUserId, useRole } from './roles'
import { GATE_MIRROR_KEY, parseSession } from './sessionStore'
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
  if (!accountsAvailable()) return accountsView([], null, HOME_DB, '')
  return accountsView(list, realUserId(), activeDb(), realRole())
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
      next = unpark(next, uid)
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
  if (check.error) {
    await c.auth.signOut({ scope: 'local' }).catch(() => {})
    return fail(addErrorText(check.error))
  }
  return switchTo(acc.uid, { incoming: { acc, session: JSON.stringify(s) } })
}

/** « Retirer ce compte de l'appareil » : sa session fermée, son espace effacé. Le compte actif : retour sur la maison. */
export async function removeAccount(uid: string): Promise<SwitchResult> {
  if (!accountsAvailable()) return fail('Changement de compte indisponible sur cet appareil.')
  await readList()
  const acc = list.find((a) => a.uid === uid)
  if (!acc || acc.home) return fail('Ce compte n’est pas un compte de test de l’appareil.')
  if (uid === realUserId() || acc.db === activeDb()) {
    const home = list.find((a) => a.home && a.session)
    if (!home) return fail('Le compte administrateur n’est plus gardé : utilise « Se déconnecter ».')
    return switchTo(home.uid, { dropCurrent: true })
  }
  await timeout(revoke(acc.session), 4000).catch(() => {})
  await deleteDb(acc.db)
  await kv!.del(bundleKey(uid))
  await writeList(removeTest(parseList(await kv!.get(LIST_KEY)), uid))
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
