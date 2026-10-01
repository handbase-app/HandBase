import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { can, useRole } from '../roles'

const TILES = [
  { to: '/joueurs/nouveau', title: 'Inscrire un nouveau joueur', sub: 'Créer une fiche et saisir les tests physiques', icon: 'M15 19c0-3-3-5-6-5s-6 2-6 5M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M16 11h6', main: true },
  { to: '/joueurs', title: 'Base de données des joueurs', sub: 'Consulter, modifier et exporter les fiches', icon: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-4 4-6 8-6s8 2 8 6' },
  { to: '/evaluer', title: 'Évaluer un joueur', sub: 'Donner son avis sur un match ou un tournoi', icon: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
  { to: '/evenements', title: 'Matchs & tournois', sub: 'Créer un événement et comparer les avis', icon: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4' },
]

export default function Home() {
  const role = useRole()
  const counts = useLiveQuery(async () => ({
    players: await db.players.filter((p) => !p.deleted).count(),
    evals: await db.evaluations.filter((e) => !e.deleted).count(),
  }))
  return (
    <div className="flex flex-col items-center pt-6">
      <div className="text-[10px] font-bold tracking-[0.3em] text-muted">HANDBASE</div>
      <h1 className="mt-1 text-2xl font-extrabold">Collecte & suivi</h1>
      <p className="mt-1 text-center text-xs text-muted">Données physiques et évaluations des joueurs de handball</p>
      {counts && (
        <p className="mt-2 text-[11px] text-muted">
          {counts.players} joueur{counts.players > 1 ? 's' : ''} · {counts.evals} évaluation{counts.evals > 1 ? 's' : ''}
        </p>
      )}
      <div className="mt-8 flex w-full max-w-md flex-col gap-3">
        {TILES.filter((t) => !t.main || can.editPlayers(role)).map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className={`card flex items-center gap-4 p-4 transition hover:border-accent ${t.main ? 'border-accent/60' : ''}`}
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${t.main ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={t.icon} />
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold">{t.title}</div>
              <div className="text-[11px] text-muted">{t.sub}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
