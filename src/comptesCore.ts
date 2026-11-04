/*
 * « CHANGER DE COMPTE » EN UN TOUCHER (administrateur qui essaie la page d'un jeune, /moi) : règles pures, sans écran ni
 * stockage (testées par tools/test-comptes.ts). Le reste (stockage, session, rechargement) : src/comptes.ts.
 *
 * Un appareil garde au plus 3 comptes : le compte « maison » (l'administrateur, celui qui était connecté quand le premier
 * compte de test a été ajouté) et au plus MAX_TEST comptes de test. Un seul est actif ; les autres sont « garés » :
 * leur session (jetons) dans IndexedDB « hb-session » (même stockage que la session active, src/sessionStore.ts).
 *
 * CHAQUE COMPTE A SON ESPACE LOCAL : sa base Dexie (« handbase » pour la maison, « handbase-compte-<id> » pour un compte de
 * test) et ses réglages handbase.* (curseurs de synchro, rôle gardé, propriétaire des données…), rangés à part quand il est
 * garé, remis en place quand il redevient actif. Un compte joueur n'ouvre donc jamais la base du staff ; revenir sur
 * l'administrateur est immédiat (rien à retélécharger, seulement les nouveautés). Le thème reste un réglage de l'appareil.
 */

/** Base Dexie du compte maison (celle d'avant cette fonction : rien ne change pour qui n'ajoute jamais de compte). */
export const HOME_DB = 'handbase'
/** Base active (stockage local, lu de façon synchrone à l'ouverture de la base, src/db.ts ; copié pour le service worker). */
export const BASE_KEY = 'hb-comptes.base'
/** Comptes gardés sur l'appareil (IndexedDB « hb-session »). */
export const LIST_KEY = 'hb-comptes.liste'
/** Réglages handbase.* d'un compte garé (IndexedDB « hb-session »). */
export const bundleKey = (uid: string) => `hb-comptes.reglages.${uid}`
/** Comptes de test au plus, en plus du compte maison. */
export const MAX_TEST = 2
/** Message aux autres onglets du site : le compte actif a changé, ils se rechargent. */
export const CHANNEL = 'hb-comptes'

const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Base d'un compte de test. */
export const testDbName = (uid: string) => `handbase-compte-${uid.toLowerCase()}`
export const isTestDb = (name: string | null | undefined) => !!name && /^handbase-compte-/.test(name) && UID.test(name.slice('handbase-compte-'.length))

/** Base à ouvrir (valeur gardée, si elle est valable ; sinon la maison). */
export const activeDbOf = (stored: string | null | undefined) => (isTestDb(stored) ? stored! : HOME_DB)
/** Nom réel d'une base : la maison s'appelle « handbase-essai » en version d'essai (VITE_TRIAL, serveur de test compris). */
export const realDbName = (name: string, trial: boolean) => (name === HOME_DB && trial ? 'handbase-essai' : name)

export interface SavedAccount {
  uid: string
  /** Nom affiché (métadonnées full_name) ; e-mail à défaut. */
  name: string
  email: string
  /** Rôle lu au serveur (admin, preparateur, observateur, joueur) ; vide si inconnu. */
  role: string
  /** Compte maison (l'administrateur). */
  home: boolean
  /** Base Dexie de son espace. */
  db: string
  /** Session garée (texte JSON de supabase-js) ; null : c'est le compte actif (sa session est celle de supabase-js). */
  session: string | null
  /** Ajouté le (ms). */
  at: number
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Liste lue dans le stockage : entrées valables seulement, une par compte, une seule maison, au plus 1 + MAX_TEST. */
export function parseList(text: string | null | undefined): SavedAccount[] {
  let raw: unknown
  try {
    raw = JSON.parse(text ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const out: SavedAccount[] = []
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object' || !UID.test(str(r.uid)) || out.some((a) => a.uid === r.uid)) continue
    const home = r.home === true && !out.some((a) => a.home)
    const db = home ? HOME_DB : testDbName(str(r.uid))
    out.push({
      uid: str(r.uid),
      name: str(r.name),
      email: str(r.email),
      role: str(r.role),
      home,
      db,
      session: typeof r.session === 'string' ? r.session : null,
      at: typeof r.at === 'number' ? r.at : 0,
    })
  }
  // Sans maison, les comptes de test n'ont plus de sens (on ne saurait pas où revenir).
  if (!out.some((a) => a.home)) return []
  return [out.find((a) => a.home)!, ...out.filter((a) => !a.home).slice(0, MAX_TEST)]
}

export const listText = (list: SavedAccount[]) => JSON.stringify(list)

/** Compte qui ouvre une base donnée. */
export const accountOfDb = (list: SavedAccount[], db: string) => list.find((a) => a.db === db) ?? null

export interface Identity {
  uid: string
  name: string
  email: string
  role: string
}

/**
 * Compte actif garé (on le quitte) : sa session est rangée (les derniers jetons, lus au moment de partir). Liste vide : il
 * devient la maison. Il garde sa place s'il est déjà dans la liste.
 */
export function park(list: SavedAccount[], me: Identity, session: string, activeDb: string, now: number): SavedAccount[] {
  const known = list.find((a) => a.uid === me.uid)
  if (known) return list.map((a) => (a.uid === me.uid ? { ...a, name: me.name || a.name, email: me.email || a.email, role: me.role || a.role, session } : a))
  if (!list.length) return [{ ...me, home: true, db: HOME_DB, session, at: now }]
  // Compte inconnu de la liste mais actif (ne devrait pas arriver) : son espace est la base ouverte.
  return [...list, { ...me, home: activeDb === HOME_DB && !list.some((a) => a.home), db: activeDb, session, at: now }]
}

/** Le compte devient actif : sa session n'est plus garée (elle passe à supabase-js). */
export const unpark = (list: SavedAccount[], uid: string) => list.map((a) => (a.uid === uid ? { ...a, session: null } : a))

export type AddResult = { list: SavedAccount[]; error?: never } | { list?: never; error: 'actif' | 'plein' }

/**
 * Compte de test ajouté (ou reconnecté : même compte, nouvelle session). activeUid : compte actif (pas ajoutable : il est
 * déjà là). La maison peut être reconnectée (session expirée) mais jamais ajoutée comme compte de test.
 */
export function addTest(list: SavedAccount[], acc: Identity, session: string, activeUid: string | null, now: number): AddResult {
  if (acc.uid === activeUid) return { error: 'actif' }
  const known = list.find((a) => a.uid === acc.uid)
  if (known) return { list: list.map((a) => (a.uid === acc.uid ? { ...a, name: acc.name || a.name, email: acc.email || a.email, role: acc.role || a.role, session } : a)) }
  if (list.filter((a) => !a.home).length >= MAX_TEST) return { error: 'plein' }
  return { list: [...list, { ...acc, home: false, db: testDbName(acc.uid), session, at: now }] }
}

/** Compte retiré de l'appareil (jamais la maison : c'est la déconnexion complète). */
export const removeTest = (list: SavedAccount[], uid: string) => list.filter((a) => a.home || a.uid !== uid)

/** Clés du stockage local qui appartiennent au compte (comme l'effacement de src/sync.ts, wipeDevice : thème exclu). */
// Version d'essai : mêmes réglages sous « handbase-essai. » (curseurs de synchro, périmètre…), rangés de même.
export const isAccountKey = (k: string) => /^handbase(-essai)?\./.test(k) && !/^handbase(-essai)?\.theme$/.test(k)

/** Réglages du compte (clés handbase.* du stockage local), à ranger quand on le quitte. */
export function bundleOf(entries: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of entries) if (isAccountKey(k)) out[k] = v
  return out
}

export function parseBundle(text: string | null | undefined): Record<string, string> {
  try {
    const o = JSON.parse(text ?? '{}') as Record<string, unknown>
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {}
    return Object.fromEntries(Object.entries(o).filter(([k, v]) => isAccountKey(k) && typeof v === 'string')) as Record<string, string>
  } catch {
    return {}
  }
}

/** Prénom affiché (premier mot du nom, sinon le début de l'e-mail) : jamais rien d'autre de la session. */
export function firstName(a: { name: string; email: string }): string {
  const n = a.name.trim().split(/\s+/)[0]
  return n || a.email.split('@')[0] || 'ce compte'
}

const ROLE_WORD: Record<string, string> = { admin: 'admin', preparateur: 'encadrant', observateur: 'observateur', joueur: 'joueur' }
/** « Geoffroy (admin) », « Léo (joueur) ». */
export const accountLabel = (a: { name: string; email: string; role: string }) => (ROLE_WORD[a.role] ? `${firstName(a)} (${ROLE_WORD[a.role]})` : firstName(a))

/** Session garée : encore utilisable telle quelle (jeton d'accès valable plus de `margin` secondes) ? */
export function sessionFresh(text: string | null | undefined, nowMs: number, margin = 120): boolean {
  try {
    const s = JSON.parse(text ?? 'null') as { expires_at?: unknown } | null
    return !!s && typeof s.expires_at === 'number' && s.expires_at - nowMs / 1000 > margin
  } catch {
    return false
  }
}

/** Jetons d'une session garée (pour la reprendre) ; null : illisible. */
export function tokensOf(text: string | null | undefined): { access_token: string; refresh_token: string } | null {
  try {
    const s = JSON.parse(text ?? 'null') as { access_token?: unknown; refresh_token?: unknown } | null
    return s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' ? { access_token: s.access_token, refresh_token: s.refresh_token } : null
  } catch {
    return null
  }
}

/** Ce que montre le menu du compte (src/components/ProfileMenu.tsx). */
export interface AccountsView {
  /** Afficher quelque chose : le compte connecté est administrateur, ou l'appareil garde un compte administrateur. */
  show: boolean
  /** Compte de test actif (bandeau « Compte de test : … »). */
  onTest: boolean
  /** Compte actif (de la liste) ; null si la liste ne le connaît pas encore. */
  active: SavedAccount | null
  /** Maison à rejoindre (« Revenir sur … ») quand on est sur un compte de test. */
  home: SavedAccount | null
  /** Autres comptes de test garés (« Passer sur … »). */
  others: SavedAccount[]
  /** « Ajouter un compte de test… » possible. */
  canAdd: boolean
}

/**
 * Règle d'affichage. realRole : rôle RÉEL du compte connecté (src/roles.ts realRole : jamais celui de « Voir comme… »).
 * Un vrai jeune sur son téléphone : liste vide, pas administrateur : rien de nouveau.
 */
export function accountsView(list: SavedAccount[], activeUid: string | null, activeDb: string, realRole: string): AccountsView {
  const active = (activeUid && list.find((a) => a.uid === activeUid)) || accountOfDb(list, activeDb)
  const onTest = isTestDb(activeDb) && !!active && !active.home
  const home = onTest ? (list.find((a) => a.home && a.session) ?? null) : null
  const adminKept = list.some((a) => a.role === 'admin' && a.uid !== activeUid && !!a.session)
  const show = realRole === 'admin' || adminKept
  const others = show ? list.filter((a) => !a.home && a.uid !== active?.uid && !!a.session) : []
  const canAdd = realRole === 'admin' && list.filter((a) => !a.home).length < MAX_TEST
  return { show, onTest, active: active ?? null, home: show ? home : null, others, canAdd }
}

/** Message clair d'un ajout refusé. */
export const addErrorText = (e: 'actif' | 'plein') =>
  e === 'actif' ? 'C’est déjà le compte connecté.' : `Déjà ${MAX_TEST} comptes de test sur cet appareil : retires-en un d’abord.`
