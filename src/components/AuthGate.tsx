import type { Session } from '@supabase/supabase-js'
import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../sync'
import { useMe } from './ui'

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

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // Le nom d'observateur suit le compte connecté.
  const name = accountName(session ?? null)
  useEffect(() => {
    if (name && name !== me) setMe(name)
  }, [name, me, setMe])

  if (!supabase) return <>{children}</>
  if (session === undefined) return null
  if (!session) return <Login />
  if (!name) return <AskName />
  return <>{children}</>
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6">
      <div className="text-center">
        <div className="text-[10px] font-bold tracking-[0.3em] text-muted">HANDBASE</div>
        <h1 className="mt-1 text-2xl font-extrabold">Collecte & suivi</h1>
      </div>
      {children}
    </div>
  )
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
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
          if (error) setErr('E-mail ou mot de passe incorrect.')
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
        <p className="text-[11px] text-muted">
          Pas de compte ou mot de passe oublié ? Demande à l'administrateur du club. Une fois connecté, l'app fonctionne aussi hors ligne.
        </p>
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
