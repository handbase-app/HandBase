import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js'
import { useEffect, useState, type ReactNode } from 'react'
import { clearRole, isPlayerRole, myPlayerId, refreshRole, useRole } from '../roles'
import { claimDevice, supabase, syncNow } from '../sync'
import { TRIAL, TRIAL_LABEL } from '../db'
import { useAppBrand } from '../appBrand'
import { BRAND_FONT } from './Brand'
import { useMe } from './ui'
import { CHARTER_VERSION, CharterText, PLAYER_CHARTER_VERSION, PlayerCharterText, PrivacyText } from '../pages/Privacy'
import { claimErrorText, formatInviteCode, INVITE_LENGTH, isInviteCode, normalizeInviteCode } from '../playerSpace'

/**
 * Lien d'accès envoyé par un administrateur : …/HandBase/#acces=<e-mail>:<mot de passe provisoire>.
 * Après le « # », rien n'est envoyé à un serveur (ni GitHub, ni les aperçus de liens WhatsApp / SMS).
 * On le lit une fois au démarrage, puis on l'efface de la barre d'adresse.
 */
const invite = (() => {
  const m = location.hash.match(/^#acces=([^:]+):(.+)$/)
  if (!m) return null
  history.replaceState(null, '', location.pathname + location.search)
  try {
    return { email: decodeURIComponent(m[1]), password: decodeURIComponent(m[2]) }
  } catch {
    return null
  }
})()

/** Message clair pour une connexion refusée. */
const loginError = (message: string) =>
  /temp_password_expired/.test(message)
    ? 'Ce mot de passe provisoire a expiré (24 h) : demande un nouvel accès à un administrateur.'
    : 'E-mail ou mot de passe incorrect.'

/** Session enregistrée par Supabase sur l'appareil (clé sb-…-auth-token), même si son jeton a expiré. */
function storedSession(): Session | null {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!/^sb-.+-auth-token$/.test(k)) continue
      const s = JSON.parse(localStorage.getItem(k) ?? 'null') as Session | null
      if (s?.refresh_token && s.user?.id) return s
    }
  } catch {
    /* stockage illisible */
  }
  return null
}

/**
 * Session du compte. Jeton d'accès expiré (plus d'une heure) et renouvellement impossible faute de réseau
 * (gymnase sans réseau) : Supabase répond « pas de session » mais la garde sur l'appareil ; on la reprend
 * alors pour travailler hors ligne (error renseignée). Une vraie déconnexion ou une session révoquée
 * l'efface du stockage : on revient à la connexion.
 */
async function loadSession(): Promise<{ session: Session | null; error?: unknown }> {
  const kept = storedSession()
  const expired = !!kept?.expires_at && kept.expires_at * 1000 < Date.now()
  // Hors ligne, inutile d'attendre Supabase : il réessaie le renouvellement pendant une trentaine de secondes.
  if (kept && expired && !navigator.onLine) return { session: kept, error: 'offline' }
  let error: unknown = null
  try {
    const r = await Promise.race([
      supabase!.auth.getSession(),
      // Réseau qui ne répond pas (wifi sans internet…) : on n'attend pas plus de quelques secondes.
      new Promise<'timeout'>((ok) => setTimeout(() => ok('timeout'), kept ? 5000 : 60_000)),
    ])
    if (r === 'timeout') error = r
    else if (r.data.session) return { session: r.data.session }
    else error = r.error
  } catch (e) {
    error = e
  }
  const network = error === 'timeout' || isAuthRetryableFetchError(error) || error instanceof TypeError || !navigator.onLine
  // storedSession() relu : une session révoquée a été effacée du stockage entre-temps.
  const still = storedSession()
  if (still && network) return { session: still, error }
  return { session: null }
}

/** Nom affiché d'un compte : stocké dans les métadonnées Supabase (full_name). */
export const accountName = (s: Session | null) => (s?.user.user_metadata?.full_name as string | undefined)?.trim() || ''

/**
 * Avec un serveur configuré, l'app demande de se connecter au premier lancement.
 * La session est gardée sur l'appareil : ensuite l'app s'ouvre directement, même hors ligne.
 * Sans serveur (mode local), on laisse passer.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  const [me, setMe] = useMe()
  // Arrivée par le lien « mot de passe oublié » reçu par e-mail : choisir un nouveau mot de passe.
  const [recovery, setRecovery] = useState(false)
  const [inviteErr, setInviteErr] = useState('')

  // Session gardée sur l'appareil mais pas renouvelable faute de réseau : on travaille hors ligne.
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void loadSession().then(async ({ session: s, error }) => {
      // Lien d'accès : connexion directe (l'appli demandera ensuite de choisir son mot de passe).
      if (invite && s?.user.email?.toLowerCase() !== invite.email.toLowerCase()) {
        if (s) await supabase!.auth.signOut()
        const { data: r, error } = await supabase!.auth.signInWithPassword(invite)
        if (error) setInviteErr(navigator.onLine ? loginError(error.message) : 'Pas de connexion internet : réessaie le lien une fois en ligne.')
        return setSession(r.session)
      }
      setOffline(!!s && !!error)
      setSession(s)
    })
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === 'PASSWORD_RECOVERY') setRecovery(true)
      if (s) {
        setOffline(false)
        setSession(s)
      } else if (e === 'SIGNED_OUT') {
        // Vraie déconnexion, ou session refusée par le serveur (révoquée) : retour à la connexion.
        setOffline(false)
        setSession(null)
      }
      // INITIAL_SESSION sans session : loadSession() décide (session gardée hors ligne, ou connexion).
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Hors ligne avec une session expirée : on retente dès que le réseau revient (et de temps en temps).
  useEffect(() => {
    if (!supabase || !offline) return
    const retry = () =>
      void loadSession().then(({ session: s, error }) => {
        if (error) return // toujours pas de réseau
        setOffline(false)
        setSession(s)
      })
    window.addEventListener('online', retry)
    const t = window.setInterval(() => navigator.onLine && retry(), 30_000)
    return () => {
      window.removeEventListener('online', retry)
      window.clearInterval(t)
    }
  }, [offline])

  // Rôle du compte : rechargé à chaque connexion, oublié à la déconnexion (pas en mode hors ligne).
  // Un compte joueur (espace joueur) n'a pas la même suite d'écrans que le staff : on attend d'avoir relu le rôle (ou de savoir
  // qu'on est hors ligne : rôle gardé sur l'appareil) avant d'afficher quoi que ce soit, pour ne pas montrer la charte du staff
  // à un jeune le temps d'une requête.
  const uid = session?.user.id
  const [roleReady, setRoleReady] = useState(false)
  const role = useRole()
  useEffect(() => {
    if (!supabase) return // mode local : l'unique utilisateur garde tous les droits
    if (session === null) {
      clearRole()
      setRoleReady(false)
    } else if (uid && !offline) void refreshRole().finally(() => setRoleReady(true))
    else if (uid && offline) setRoleReady(true)
  }, [uid, session, offline])

  // Données locales d'un autre compte (changement de compte par lien d'accès…) : on efface d'abord.
  const owned = !uid || claimDevice(uid)

  // Le nom d'observateur suit le compte connecté.
  const name = accountName(session ?? null)
  useEffect(() => {
    if (name && name !== me) setMe(name)
  }, [name, me, setMe])

  if (!supabase) return <>{children}</>
  if (session === undefined || !owned) return null
  if (!session) return <Login initialEmail={invite?.email} initialError={inviteErr} />
  // Mot de passe provisoire (compte créé par un administrateur) ou lien « mot de passe oublié ».
  if (recovery || session.user.user_metadata?.must_change_password) return <NewPassword recovery={recovery} onDone={() => setRecovery(false)} />
  if (!name) return <AskName />
  if (!roleReady) return null
  // Compte joueur (espace joueur, supabase/051) : sa charte à lui, puis son code tant que sa fiche n'est pas reliée ; ensuite
  // l'appli, qui ne lui montre que sa page (src/App.tsx → /moi).
  if (isPlayerRole(role)) {
    if (session.user.user_metadata?.player_charter_version !== PLAYER_CHARTER_VERSION) return <AcceptCharter player />
    if (!myPlayerId()) return <ClaimCode />
    return <>{children}</>
  }
  // Charte d'utilisation : acceptée une fois (et de nouveau si elle change).
  if (session.user.user_metadata?.charter_version !== CHARTER_VERSION) return <AcceptCharter />
  return <>{children}</>
}

/**
 * Compte joueur sans fiche reliée : il ne voit rien d'autre que cet écran. Le code (8 caractères, remis par l'encadrant depuis
 * la fiche) est vérifié par le serveur (hb_claim_invite) : code, validité, date de naissance et âge minimum de la fiche.
 */
function ClaimCode() {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = isInviteCode(code)
  return (
    <Shell>
      <form
        className="card flex flex-col gap-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault()
          setErr('')
          if (!navigator.onLine) return setErr('Pas de connexion internet : il faut être en ligne pour entrer ton code.')
          setBusy(true)
          const { error } = await supabase!.rpc('hb_claim_invite', { p_code: normalizeInviteCode(code) })
          if (error) {
            setBusy(false)
            return setErr(error.code === 'PGRST202' ? 'L’espace joueur n’est pas encore ouvert sur ce serveur : demande à ton encadrant.' : claimErrorText(error.message))
          }
          // Fiche reliée : le rôle relu porte sa fiche, la synchronisation la ramène, l'appli s'ouvre sur sa page.
          await refreshRole()
          void syncNow()
          setBusy(false)
        }}
      >
        <div className="text-sm font-extrabold">Entre ton code</div>
        <p className="text-[11px] text-muted">
          Ton encadrant t’a donné un code de 8 caractères : il relie ce compte à ta fiche. Tu ne verras que ta page.
        </p>
        <input
          className="field text-center font-mono text-lg tracking-[0.3em] uppercase"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          spellCheck={false}
          maxLength={INVITE_LENGTH + 1}
          placeholder="XXXX XXXX"
          aria-label="Code"
          value={formatInviteCode(code)}
          onChange={(e) => setCode(normalizeInviteCode(e.target.value).slice(0, INVITE_LENGTH))}
          required
        />
        <button className="btn-primary" disabled={!ok || busy}>
          {busy ? 'Vérification…' : 'Relier ma fiche'}
        </button>
        {err && <p className="text-[11px] text-red-300">{err}</p>}
        <p className="text-[11px] text-muted">Pas de code, ou code perdu ? Demande à ton encadrant : il peut t’en donner un nouveau.</p>
        <button type="button" className="text-[11px] font-bold text-muted underline" onClick={() => void supabase!.auth.signOut()}>
          Se déconnecter
        </button>
      </form>
    </Shell>
  )
}

/**
 * Écran de connexion : logo de l'appli (Nextar par défaut, ou celui réglé ; dernière valeur connue sur l'appareil, la
 * configuration n'étant lisible qu'une fois connecté). Logo complet : il porte le nom ; sinon pictogramme + nom écrit.
 */
function Shell({ children }: { children: ReactNode }) {
  const { name, logo, mark } = useAppBrand()
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6">
      <div className="text-center">
        <img src={logo} alt={name} className="mx-auto h-44 w-44 object-contain" />
        {logo === mark && <div className="mt-1.5 text-lg font-extrabold tracking-[-0.01em]" style={{ fontFamily: BRAND_FONT }}>
            {name}
          </div>}
        {TRIAL && <div className="mx-auto mt-2 w-fit rounded bg-amber-500 px-2 py-0.5 text-[10px] font-bold tracking-wider text-black">{TRIAL_LABEL}</div>}
        <h1 className="mt-2 text-[12px] font-extrabold tracking-[0.14em] text-muted uppercase" style={{ fontFamily: BRAND_FONT }}>
          Détecter<span className="px-[0.35em] text-accent">·</span>Suivre<span className="px-[0.35em] text-accent">·</span>Accompagner
        </h1>
      </div>
      {children}
    </div>
  )
}

function Login({ initialEmail = '', initialError = '' }: { initialEmail?: string; initialError?: string }) {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(initialError)
  const [busy, setBusy] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [sent, setSent] = useState(false)
  const [privacy, setPrivacy] = useState(false)

  if (privacy)
    return (
      <Shell>
        <div className="card flex flex-col gap-3 p-5">
          <div className="text-sm font-extrabold">Confidentialité</div>
          <PrivacyText />
          <button type="button" className="btn-ghost text-xs" onClick={() => setPrivacy(false)}>
            Retour à la connexion
          </button>
        </div>
      </Shell>
    )

  if (forgot)
    return (
      <Shell>
        <form
          className="card flex flex-col gap-3 p-5"
          onSubmit={async (e) => {
            e.preventDefault()
            setErr('')
            if (!navigator.onLine) return setErr('Pas de connexion internet.')
            setBusy(true)
            // Le lien de l'e-mail ramène sur l'appli, qui demande alors le nouveau mot de passe.
            const { error } = await supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + import.meta.env.BASE_URL })
            setBusy(false)
            if (error) setErr(error.status === 429 ? 'Trop de demandes : réessaie dans une heure.' : `Envoi impossible : ${error.message}`)
            else setSent(true)
          }}
        >
          <div className="text-sm font-extrabold">Mot de passe oublié</div>
          {sent ? (
            <p className="text-xs">
              Si un compte existe pour <b>{email.trim()}</b>, un e-mail vient de partir avec un lien pour choisir un nouveau mot de passe. Pense à
              regarder dans les indésirables.
            </p>
          ) : (
            <>
              <p className="text-[11px] text-muted">Indique ton e-mail : tu vas recevoir un lien pour choisir un nouveau mot de passe.</p>
              <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <button className="btn-primary" disabled={busy}>
                {busy ? 'Envoi…' : 'Recevoir le lien'}
              </button>
            </>
          )}
          {err && <p className="text-[11px] text-red-300">{err}</p>}
          <button type="button" className="text-[11px] font-bold text-muted underline" onClick={() => (setForgot(false), setSent(false), setErr(''))}>
            Retour à la connexion
          </button>
        </form>
      </Shell>
    )

  return (
    <Shell>
      <form
        className="card flex flex-col gap-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault()
          setErr('')
          if (!navigator.onLine) return setErr('Pas de connexion internet : la première connexion doit se faire en ligne.')
          setBusy(true)
          const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
          setBusy(false)
          if (error) setErr(loginError(error.message))
        }}
      >
        <div className="text-sm font-extrabold">Connexion staff</div>
        <div>
          <span className="label">E-mail</span>
          <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <span className="label">Mot de passe</span>
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
        {err && <p className="text-[11px] text-red-300">{err}</p>}
        <button type="button" className="self-start text-[11px] font-bold text-accent underline" onClick={() => (setForgot(true), setErr(''))}>
          Mot de passe oublié ?
        </button>
        <p className="text-[11px] text-muted">Pas de compte ? Demande à un administrateur. Une fois connecté, l'app fonctionne aussi hors ligne.</p>
      </form>
      <button type="button" className="text-[11px] font-bold text-muted underline" onClick={() => setPrivacy(true)}>
        Confidentialité
      </button>
    </Shell>
  )
}

/**
 * Charte d'utilisation à accepter avant d'utiliser l'appli ; l'acceptation est gardée sur le compte.
 * `player` : la charte de l'espace joueur (mots simples), sous sa propre clé : un compte qui change de rôle relit la bonne.
 */
function AcceptCharter({ player = false }: { player?: boolean }) {
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <Shell>
      <form
        className="card flex flex-col gap-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault()
          setErr('')
          setBusy(true)
          const at = new Date().toISOString()
          const { error } = await supabase!.auth.updateUser({
            data: player ? { player_charter_version: PLAYER_CHARTER_VERSION, player_charter_accepted_at: at } : { charter_version: CHARTER_VERSION, charter_accepted_at: at },
          })
          setBusy(false)
          if (error) setErr('Impossible d’enregistrer (connexion internet ?).')
        }}
      >
        <div className="text-sm font-extrabold">{player ? 'Ta page, comment ça marche' : 'Charte d’utilisation'}</div>
        <div className="max-h-[55dvh] overflow-y-auto rounded-md border border-line bg-panel-2 p-3">{player ? <PlayerCharterText /> : <CharterText />}</div>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          {player ? 'J’ai lu et j’ai compris.' : 'J’ai lu la charte et je m’engage à la respecter.'}
        </label>
        <button className="btn-primary" disabled={!ok || busy}>
          {busy ? 'Enregistrement…' : 'Accepter et continuer'}
        </button>
        {err && <p className="text-[11px] text-red-300">{err}</p>}
        <button type="button" className="text-[11px] font-bold text-muted underline" onClick={() => void supabase!.auth.signOut()}>
          Se déconnecter
        </button>
      </form>
    </Shell>
  )
}

/** Premier lancement d'un compte sans nom : on le demande une fois et on l'enregistre sur le compte. */
function AskName() {
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  return (
    <Shell>
      <form
        className="card flex flex-col gap-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault()
          const { error } = await supabase!.auth.updateUser({ data: { full_name: name.trim() } })
          if (error) setErr('Impossible d’enregistrer le nom (connexion internet ?).')
        }}
      >
        <div className="text-sm font-extrabold">Ton nom</div>
        <p className="text-[11px] text-muted">Il signera tes avis et tes mesures, pour que le staff puisse comparer les avis.</p>
        <input className="field" placeholder="Prénom Nom" value={name} onChange={(e) => setName(e.target.value)} required />
        <button className="btn-primary" disabled={!name.trim()}>
          Continuer
        </button>
        {err && <p className="text-[11px] text-red-300">{err}</p>}
      </form>
    </Shell>
  )
}

/** Choisir son mot de passe : après un mot de passe provisoire, ou via le lien « mot de passe oublié ». */
function NewPassword({ recovery, onDone }: { recovery: boolean; onDone: () => void }) {
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Shell>
      <form
        className="card flex flex-col gap-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault()
          setErr('')
          if (next.length < 8) return setErr('8 caractères minimum.')
          if (next !== confirm) return setErr('Les deux mots de passe ne sont pas identiques.')
          if (!navigator.onLine) return setErr('Pas de connexion internet.')
          setBusy(true)
          const { error } = await supabase!.auth.updateUser({ password: next, data: { must_change_password: false } })
          setBusy(false)
          if (error) return setErr(/different|same/i.test(error.message) ? 'Choisis un mot de passe différent du précédent.' : `Changement refusé : ${error.message}`)
          onDone()
        }}
      >
        <div className="text-sm font-extrabold">{recovery ? 'Nouveau mot de passe' : 'Choisis ton mot de passe'}</div>
        <p className="text-[11px] text-muted">
          {recovery ? 'Choisis ton nouveau mot de passe.' : 'Tu t’es connecté avec un mot de passe provisoire : choisis le tien pour continuer.'}
        </p>
        <input className="field" type="password" autoComplete="new-password" placeholder="Nouveau mot de passe (8 caractères min.)" value={next} onChange={(e) => setNext(e.target.value)} required />
        <input className="field" type="password" autoComplete="new-password" placeholder="Confirmer" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {err && <p className="text-[11px] text-red-300">{err}</p>}
        <button type="button" className="text-[11px] font-bold text-muted underline" onClick={() => void supabase!.auth.signOut()}>
          Se déconnecter
        </button>
      </form>
    </Shell>
  )
}
