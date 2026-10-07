import { Link } from 'react-router-dom'
import { db } from '../db'
import { useThrottledQuery } from '../live'
import { can, useRole } from '../roles'
import { HomeFeed } from './Feed'
import { Icon } from '../components/ui'

// Actions rapides (le reste est dans la barre du bas). « Propositions » n'a pas d'onglet : c'est ici qu'on la trouve.
const ACTIONS = [
  { to: '/joueurs/nouveau', title: 'Nouveau joueur', icon: 'M15 19c0-3-3-5-6-5s-6 2-6 5M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M16 11h6', main: true },
  { to: '/evenements', title: 'Événements', icon: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4' },
  { to: '/avis-spontanes', title: 'Propositions', icon: 'M4 4h16v12H8l-4 4zM9 10l2 2 4-4' },
  { to: '/suivis', title: 'Mes suivis', icon: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
]

/** `toReview` : propositions à valider ; `followNews` : nouveautés de mes suivis (comptées une seule fois, dans App). */
export default function Home({ toReview, followNews }: { toReview: number; followNews: number }) {
  const role = useRole()
  const counts = useThrottledQuery(
    async () => ({
      players: await db.players.filter((p) => !p.deleted).count(),
      evals: await db.evaluations.filter((e) => !e.deleted).count(),
    }),
    [],
    ['players', 'evaluations'],
  )
  const actions = ACTIONS.filter((t) => !t.main || can.editPlayers(role))
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-2">
      <div className="text-center">
        <h1 className="text-xl font-extrabold">Collecte & suivi</h1>
        {counts && (
          <p className="mt-0.5 text-[11px] text-muted">
            {counts.players.toLocaleString('fr-FR')} joueur{counts.players > 1 ? 's' : ''} · {counts.evals.toLocaleString('fr-FR')} évaluation
            {counts.evals > 1 ? 's' : ''}
          </p>
        )}
      </div>

      <div className={`grid gap-2 ${actions.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : actions.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {actions.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className={`card relative flex flex-col items-center gap-1.5 px-2 py-3 text-center transition hover:border-accent ${t.main ? 'border-accent/60' : ''}`}
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${t.main ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={t.icon} />
              </svg>
            </div>
            <span className="text-xs font-bold">{t.title}</span>
            {t.to === '/avis-spontanes' && toReview > 0 && (
              <span className="absolute top-1.5 right-1.5 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-black">{toReview}</span>
            )}
            {t.to === '/suivis' && followNews > 0 && (
              <span className="absolute top-1.5 right-1.5 rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{followNews > 99 ? '99+' : followNews}</span>
            )}
          </Link>
        ))}
      </div>

      {/* Vue nationale : carte des départements (administrateurs). */}
      {can.nationalView(role) && (
        <Link to="/national" className="card group flex items-center gap-3 border-accent/60 bg-gradient-to-r from-accent/15 to-transparent px-4 py-3 transition hover:border-accent">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white">
            <Icon name="map" className="h-6 w-6" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold">Vue nationale</span>
            <span className="block text-[11px] text-muted">Carte des départements : joueurs, mesures, profils repérés</span>
          </span>
          <span className="text-lg text-muted transition group-hover:translate-x-0.5 group-hover:text-accent">›</span>
        </Link>
      )}

      <HomeFeed />
    </div>
  )
}
