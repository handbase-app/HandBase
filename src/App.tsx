import { lazy, Suspense, useEffect } from 'react'
import { pushSupport, setIconBadge, syncSubscription } from './push'
import { useLiveQuery } from 'dexie-react-hooks'
import { NavLink, Route, Routes, useNavigate, type NavLinkProps } from 'react-router-dom'
import { canLeave, ConfirmHost } from './components/Confirm'
import { db, TRIAL } from './db'
import { useDepartments } from './lists'
import Evaluate from './pages/Evaluate'
import Home from './pages/Home'
import PlayerForm from './pages/PlayerForm'
import Players from './pages/Players'
import { usePendingCount } from './pending'
import { useDailyPurge } from './purge'
import Privacy from './pages/Privacy'
import MeasureSession from './pages/MeasureSession'
import Feed from './pages/Feed'
import { useAlertCount } from './alerts'
import { Icon } from './components/ui'
import { useThemeVersion } from './theme'
import { syncNow, useSyncState } from './sync'

// Écrans moins fréquents ou lourds (graphiques) : chargés à la demande, pour un démarrage plus rapide.
// Le service worker les garde tous en cache : ils restent disponibles hors ligne.
const PlayerDetail = lazy(() => import('./pages/PlayerDetail'))
const ReviewPage = lazy(() => import('./pages/Review'))
const Missed = lazy(() => import('./pages/Missed'))
const Settings = lazy(() => import('./pages/Settings'))
const Events = lazy(() => import('./pages/Events'))
const EventDetail = lazy(() => import('./pages/Events').then((m) => ({ default: m.EventDetail })))
const Groups = lazy(() => import('./pages/Groups'))
const GroupDetail = lazy(() => import('./pages/Groups').then((m) => ({ default: m.GroupDetail })))
const NewGroup = lazy(() => import('./pages/Groups').then((m) => ({ default: m.NewGroup })))
const Alerts = lazy(() => import('./pages/Alerts'))
const AlertDetail = lazy(() => import('./pages/Alerts').then((m) => ({ default: m.AlertDetail })))
const NewAlert = lazy(() => import('./pages/Alerts').then((m) => ({ default: m.NewAlert })))

/** Cloche de l'en-tête : les alertes, avec le nombre de joueurs qui viennent d'y entrer. */
function AlertBell({ n }: { n: number }) {
  return (
    <GuardedLink to="/alertes" className="relative text-muted hover:text-fg" aria-label="Alertes">
      <Icon name="bell" className="h-5 w-5" />
      {n > 0 && (
        <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-accent px-1 text-center text-[9px] leading-4 font-bold text-white">{n > 99 ? '99+' : n}</span>
      )}
    </GuardedLink>
  )
}

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
  { to: '/evenements', label: 'Événements', icon: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4' },
  { to: '/groupes', label: 'Groupes', icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a3 3 0 1 0 0-6M3 20c0-3 3-5 6-5s6 2 6 5M17 15c2.5 0 4 1.7 4 5' },
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
  // Avis spontanés à valider : pastille sur « Évaluer ».
  const toReview = usePendingCount()
  const alerts = useAlertCount()
  // Pastille sur l'icône de l'appli : tout ce qui attend (propositions à valider + nouvelles alertes).
  useEffect(() => {
    void setIconBadge(toReview + alerts)
  }, [toReview, alerts])
  // Noms des départements (liste modifiable) : toute l'appli se redessine quand ils changent.
  useDepartments()
  // Expiration RGPD des fiches proposées jamais traitées (si le serveur ne le fait pas la nuit).
  useDailyPurge()
  // Notifications : l'abonnement de ce téléphone est réenregistré sur le serveur à chaque ouverture.
  useEffect(() => {
    if (pushSupport() === 'ok') void syncSubscription()
  }, [])
  // Changement de thème : tout se redessine (les graphiques relisent les couleurs).
  useThemeVersion()
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header
        className={`sticky top-0 z-20 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur ${TRIAL ? 'border-t-4 border-t-amber-500' : ''}`}
      >
        <GuardedLink to="/" className="text-sm font-extrabold tracking-widest">
          HAND<span className="text-accent">BASE</span>
          {/* Version d'essai (VITE_TRIAL=1, test en local) : même serveur, donc les saisies y sont réelles. */}
          {TRIAL && <span className="ml-2 rounded bg-amber-500 px-1.5 py-0.5 text-[9px] tracking-wider text-black">VERSION D’ESSAI</span>}
        </GuardedLink>
        <div className="flex items-center gap-3">
          <AlertBell n={alerts} />
          <SyncBadge />
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-28">
        <Suspense fallback={<div className="py-20 text-center text-sm text-muted">Chargement…</div>}>
        <Routes>
          <Route path="/" element={<Home toReview={toReview} />} />
          <Route path="/joueurs" element={<Players />} />
          <Route path="/joueurs/nouveau" element={<PlayerForm />} />
          <Route path="/joueurs/:id" element={<PlayerDetail />} />
          <Route path="/joueurs/:id/modifier" element={<PlayerForm />} />
          <Route path="/joueurs/:id/mesures" element={<MeasureSession />} />
          <Route path="/evaluer" element={<Evaluate />} />
          <Route path="/avis-spontanes" element={<ReviewPage />} />
          <Route path="/rates" element={<Missed />} />
          <Route path="/evenements" element={<Events />} />
          <Route path="/evenements/:id" element={<EventDetail />} />
          <Route path="/groupes" element={<Groups />} />
          <Route path="/groupes/nouveau" element={<NewGroup />} />
          <Route path="/groupes/:id" element={<GroupDetail />} />
          <Route path="/parametres" element={<Settings />} />
          <Route path="/confidentialite" element={<Privacy />} />
          <Route path="/actualite" element={<Feed />} />
          <Route path="/alertes" element={<Alerts />} />
          <Route path="/alertes/nouvelle" element={<NewAlert />} />
          <Route path="/alertes/:id" element={<AlertDetail />} />
        </Routes>
        </Suspense>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl">
          {NAV.map((n) => (
            <GuardedLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-bold ${isActive ? 'text-accent' : 'text-muted'}`
              }
            >
              <span className="relative">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
                  <path d={n.icon} />
                </svg>
                {/* Propositions à valider : pastille sur l'accueil (le bouton Propositions y est). */}
                {n.to === '/' && toReview > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 rounded-full bg-amber-400 px-1 text-[9px] leading-tight text-black">{toReview}</span>
                )}
              </span>
              {n.label}
            </GuardedLink>
          ))}
        </div>
      </nav>
      <ConfirmHost />
    </div>
  )
}
