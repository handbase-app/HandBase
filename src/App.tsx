import { useLiveQuery } from 'dexie-react-hooks'
import { NavLink, Route, Routes, useNavigate, type NavLinkProps } from 'react-router-dom'
import { canLeave, ConfirmHost } from './components/Confirm'
import { db } from './db'
import Events, { EventDetail } from './pages/Events'
import Evaluate from './pages/Evaluate'
import Home from './pages/Home'
import PlayerDetail from './pages/PlayerDetail'
import PlayerForm from './pages/PlayerForm'
import Players from './pages/Players'
import Settings from './pages/Settings'
import { syncNow, useSyncState } from './sync'

function SyncBadge() {
  const { state, lastError, live } = useSyncState()
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const map = {
    local: { dot: 'bg-muted', text: 'Local' },
    login: { dot: 'bg-amber-400', text: 'Non connecté' },
    offline: { dot: 'bg-amber-400', text: 'Hors ligne' },
    syncing: { dot: 'bg-sky-400 animate-pulse', text: 'Synchro…' },
    synced: { dot: 'bg-emerald-400', text: live ? 'En direct' : 'Synchronisé' },
    error: { dot: 'bg-red-500', text: 'Erreur synchro' },
  }[state]
  const warn = state === 'synced' && !!lastError
  return (
    <button
      onClick={() => void syncNow()}
      title={lastError || (state === 'local' ? 'Données enregistrées sur cet appareil uniquement' : '')}
      className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] font-bold text-muted"
    >
      <span className={`h-2 w-2 rounded-full ${warn ? 'bg-amber-400' : map.dot}`} />
      {map.text}
      {state !== 'local' && pending > 0 && <span className="text-amber-300">· {pending} en attente</span>}
    </button>
  )
}

const NAV = [
  { to: '/', label: 'Accueil', icon: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z' },
  { to: '/joueurs', label: 'Joueurs', icon: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-4 4-6 8-6s8 2 8 6' },
  { to: '/evaluer', label: 'Évaluer', icon: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
  { to: '/evenements', label: 'Événements', icon: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4' },
  { to: '/parametres', label: 'Réglages', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1V4h-4v3l-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1v3h4v-3l2-1 2 1 2-4z' },
]

/** Lien du menu qui vérifie d'abord qu'aucune saisie en cours ne sera perdue. */
function GuardedLink(props: NavLinkProps & { to: string }) {
  const navigate = useNavigate()
  return (
    <NavLink
      {...props}
      onClick={async (e) => {
        e.preventDefault()
        if (await canLeave()) navigate(props.to)
      }}
    />
  )
}

export default function App() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
        <GuardedLink to="/" className="text-sm font-extrabold tracking-widest">
          HAND<span className="text-accent">BASE</span>
        </GuardedLink>
        <SyncBadge />
      </header>

      <main className="flex-1 px-4 pt-4 pb-28">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/joueurs" element={<Players />} />
          <Route path="/joueurs/nouveau" element={<PlayerForm />} />
          <Route path="/joueurs/:id" element={<PlayerDetail />} />
          <Route path="/joueurs/:id/modifier" element={<PlayerForm />} />
          <Route path="/evaluer" element={<Evaluate />} />
          <Route path="/evenements" element={<Events />} />
          <Route path="/evenements/:id" element={<EventDetail />} />
          <Route path="/parametres" element={<Settings />} />
        </Routes>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl">
          {NAV.map((n) => (
            <GuardedLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold ${isActive ? 'text-accent' : 'text-muted'}`
              }
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
                <path d={n.icon} />
              </svg>
              {n.label}
            </GuardedLink>
          ))}
        </div>
      </nav>
      <ConfirmHost />
    </div>
  )
}
