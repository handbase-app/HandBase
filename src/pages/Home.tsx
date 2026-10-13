import { Link } from 'react-router-dom'
import { db } from '../db'
import { useThrottledQuery } from '../live'
import { can, useRole } from '../roles'
import { HomeFeed } from './Feed'
import { Icon } from '../components/ui'
import { countOpenRewatch } from '../scouting'

// Actions rapides (le reste est dans la barre du bas ; « + Joueur » est sur la page Joueurs). « Propositions » n'a pas d'onglet : c'est ici qu'on la trouve.
const ACTIONS = [
  { to: '/evenements', title: 'Événements', icon: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4' },
  { to: '/avis-spontanes', title: 'Propositions', icon: 'M4 4h16v12H8l-4 4zM9 10l2 2 4-4' },
  { to: '/suivis', title: 'Mes suivis', icon: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
  // Joueurs que mon staff veut revoir, pas encore revus (supabase/041).
  { to: '/a-revoir', title: 'Mes à revoir', icon: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
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
  const rewatch = useThrottledQuery(countOpenRewatch, [], ['rewatch', 'seen', 'evaluations', 'teams'], undefined, 0)
  const actions: { to: string; title: string; icon: string; main?: boolean }[] = ACTIONS
  return (
    // Téléphone couché : actions à gauche, fil « Quoi de neuf » à droite. Ordinateur : en-tête et actions sur toute
    // la largeur (tuiles et Vue nationale sur une rangée), fil en dessous.
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-2 rail:grid rail:max-w-5xl rail:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] rail:items-start rail:gap-6 rail:pt-0 side:max-w-6xl side:gap-5">
      <div className="flex flex-col gap-4 side:grid side:grid-cols-5 side:gap-x-4 side:gap-y-5">
      <div className="text-center side:col-span-full side:flex side:items-baseline side:gap-3 side:text-left">
        <h1 className="text-xl font-extrabold">Collecte & suivi</h1>
        {counts && (
          <p className="mt-0.5 text-[11px] text-muted side:mt-0">
            {counts.players.toLocaleString('fr-FR')} joueur{counts.players > 1 ? 's' : ''} · {counts.evals.toLocaleString('fr-FR')} évaluation
            {counts.evals > 1 ? 's' : ''}
          </p>
        )}
      </div>

      <div
        className={`grid gap-2 side:gap-4 ${actions.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : actions.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} ${can.nationalView(role) ? 'side:col-span-3' : 'side:col-span-full'}`}
      >
        {actions.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className={`card relative flex flex-col items-center justify-center gap-1.5 px-2 py-3 text-center side:py-4 transition hover:border-accent ${t.main ? 'border-accent/60' : ''}`}
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
            {t.to === '/a-revoir' && rewatch > 0 && (
              <span className="absolute top-1.5 right-1.5 rounded-full bg-sky-500 px-1.5 text-[10px] font-bold text-white">{rewatch > 99 ? '99+' : rewatch}</span>
            )}
            {t.to === '/suivis' && followNews > 0 && (
              <span className="absolute top-1.5 right-1.5 rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{followNews > 99 ? '99+' : followNews}</span>
            )}
          </Link>
        ))}
        {/* Bilan de détection (administrateurs et encadrants) : sous « Mes à revoir », toute la largeur des tuiles. */}
        {can.viewCoverage(role) && (
          <Link to="/bilan" className="card group col-span-full flex items-center gap-3 px-3 py-2.5 transition hover:border-accent">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-muted">
              <Icon name="check" className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-bold">Bilan de détection</span>
              <span className="block truncate text-[11px] text-muted">Qui a été vu, par génération et par club</span>
            </span>
            <span className="text-lg text-muted transition group-hover:translate-x-0.5 group-hover:text-accent">›</span>
          </Link>
        )}
      </div>

      {/* Vue nationale : carte des départements (administrateurs). */}
      {can.nationalView(role) && (
        <Link to="/national" className="card group flex items-center gap-3 side:col-span-2 border-accent/60 bg-gradient-to-r from-accent/15 to-transparent px-4 py-3 transition hover:border-accent">
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
      </div>

      <HomeFeed />
    </div>
  )
}
