import { Link } from 'react-router-dom'
import { db } from '../db'
import { useThrottledQuery } from '../live'
import { can, useRole } from '../roles'
import { HomeFeed } from './Feed'

// Actions rapides (le reste est dans la barre du bas). « Propositions » n'a pas d'onglet : c'est ici qu'on la trouve.
const ACTIONS = [
  { to: '/joueurs/nouveau', title: 'Nouveau joueur', icon: 'M15 19c0-3-3-5-6-5s-6 2-6 5M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M16 11h6', main: true },
  { to: '/evenements', title: 'Événements', icon: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4' },
  { to: '/avis-spontanes', title: 'Propositions', icon: 'M4 4h16v12H8l-4 4zM9 10l2 2 4-4' },
]

/** `toReview` : propositions à valider (compté une seule fois, dans App). */
export default function Home({ toReview }: { toReview: number }) {
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

      <div className={`grid gap-2 ${actions.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
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
          </Link>
        ))}
      </div>

      <HomeFeed />
    </div>
  )
}
