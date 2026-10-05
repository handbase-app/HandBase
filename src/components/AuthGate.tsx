import type { Session } from '@supabase/supabase-js'
import { useEffect, useState, type ReactNode } from 'react'
import { clearRole, refreshRole } from '../roles'
import { supabase } from '../sync'
import { TRIAL } from '../db'
import { useMe } from './ui'
import { CHARTER_VERSION, CharterText, PrivacyText } from '../pages/Privacy'

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

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(async ({ data }) => {
      // Lien d'accès : connexion directe (l'appli demandera ensuite de choisir son mot de passe).
      if (invite && data.session?.user.email?.toLowerCase() !== invite.email.toLowerCase()) {
        if (data.session) await supabase!.auth.signOut()
        const { data: r, error } = await supabase!.auth.signInWithPassword(invite)
        if (error) setInviteErr(navigator.onLine ? loginError(error.message) : 'Pas de connexion internet : réessaie le lien une fois en ligne.')
        return setSession(r.session)
      }
      setSession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      if (e === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Rôle du compte : rechargé à chaque connexion, oublié à la déconnexion.
  const uid = session?.user.id
  useEffect(() => {
    if (!supabase) return // mode local : l'unique utilisateur garde tous les droits
    if (session === null) clearRole()
    else if (uid) void refreshRole()
  }, [uid, session])

  // Le nom d'observateur suit le compte connecté.
  const name = accountName(session ?? null)
  useEffect(() => {
    if (name && name !== me) setMe(name)
  }, [name, me, setMe])

  if (!supabase) return <>{children}</>
  if (session === undefined) return null
  if (!session) return <Login initialEmail={invite?.email} initialError={inviteErr} />
  // Mot de passe provisoire (compte créé par un administrateur) ou lien « mot de passe oublié ».
  if (recovery || session.user.user_metadata?.must_change_password) return <NewPassword recovery={recovery} onDone={() => setRecovery(false)} />
  if (!name) return <AskName />
  // Charte d'utilisation : acceptée une fois (et de nouveau si elle change).
  if (session.user.user_metadata?.charter_version !== CHARTER_VERSION) return <AcceptCharter />
  return <>{children}</>
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6">
      <div className="text-center">
        <div className="text-[10px] font-bold tracking-[0.3em] text-muted">HANDBASE</div>
        {TRIAL && <div className="mx-auto mt-2 w-fit rounded bg-amber-500 px-2 py-0.5 text-[10px] font-bold tracking-wider text-black">VERSION D’ESSAI</div>}
        <h1 className="mt-1 text-2xl font-extrabold">Collecte & suivi</h1>
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

/** Charte d'utilisation à accepter avant d'utiliser l'appli ; l'acceptation est gardée sur le compte. */
function AcceptCharter() {
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
          const { error } = await supabase!.auth.updateUser({ data: { charter_version: CHARTER_VERSION, charter_accepted_at: new Date().toISOString() } })
          setBusy(false)
          if (error) setErr('Impossible d’enregistrer (connexion internet ?).')
        }}
      >
        <div className="text-sm font-extrabold">Charte d’utilisation</div>
        <div className="max-h-[55dvh] overflow-y-auto rounded-md border border-line bg-panel-2 p-3">
          <CharterText />
        </div>
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          J’ai lu la charte et je m’engage à la respecter.
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
        <p className="text-[11px] text-muted">Il signera tes avis et tes mesures, pour que le staff puisse comparer les évaluations.</p>
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
