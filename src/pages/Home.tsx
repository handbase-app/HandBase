import { Link } from 'react-router-dom'
import { useThrottledQuery } from '../live'
import { HomeFeed } from './Feed'
import { countOpenRewatch } from '../scouting'
import { usePerimeter, useUnits } from '../installation'
import { installationAppearance, useThemeVersion } from '../theme'
import { appName } from '../appBrand'

// Actions rapides, dans cet ordre (choix du 26/10) : Mes suivis, À revoir, Propositions, Profils recherchés. Pas de tuile
// « Événements » : il est déjà dans la barre de navigation. « Propositions » n'a pas d'onglet : c'est ici qu'on la trouve.
const ACTIONS = [
  { to: '/suivis', title: 'Mes suivis', icon: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z' },
  // Section « À revoir » (src/pages/Rewatch.tsx) : qui, quand, d'où ; le nombre de joueurs pas encore revus en pastille.
  // Horloge bleu ciel, comme partout ailleurs pour « à revoir » (l'œil veut dire « vu »).
  { to: '/a-revoir', title: 'À revoir', icon: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', tone: 'bg-sky-500/10 text-sky-300' },
  { to: '/avis-spontanes', title: 'Propositions', icon: 'M4 4h16v12H8l-4 4zM9 10l2 2 4-4' },
  // Profils recherchés (src/pages/Alerts.tsx) : cible ; les joueurs qui viennent d'y entrer en pastille.
  { to: '/alertes', title: 'Profils recherchés', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z' },
]

/**
 * `toReview` : propositions à valider ; `followNews` : nouveautés de mes suivis ; `alerts` : joueurs qui viennent d'entrer
 * dans mes profils recherchés (comptés une seule fois, dans App).
 */
export default function Home({ toReview, followNews, alerts }: { toReview: number; followNews: number; alerts: number }) {
  const rewatch = useThrottledQuery(countOpenRewatch, [], ['rewatch', 'seen', 'evaluations', 'teams'], undefined, 0)
  const actions: { to: string; title: string; icon: string; main?: boolean; tone?: string }[] = ACTIONS
  return (
    // Téléphone couché : actions à gauche, fil « Quoi de neuf » à droite. Ordinateur : en-tête et actions sur toute
    // la largeur (tuiles sur une rangée), fil en dessous. Pas de tuile « Bilan de détection » : il est déjà dans la
    // barre de navigation (même condition, can.viewCoverage).
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pt-2 rail:grid rail:max-w-5xl rail:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] rail:items-start rail:gap-6 rail:pt-0 side:max-w-6xl side:gap-5">
      <div className="flex flex-col gap-4 side:grid side:grid-cols-5 side:gap-x-4 side:gap-y-5">
      <OrgHeader />

      <div
        className={`grid gap-2 side:gap-4 ${actions.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : actions.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} side:col-span-full`}
      >
        {actions.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className={`card relative flex flex-col items-center justify-center gap-1.5 px-2 py-3 text-center side:py-4 transition hover:border-accent ${t.main ? 'border-accent/60' : ''}`}
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${t.main ? 'bg-accent text-white' : (t.tone ?? 'bg-panel-2 text-muted')}`}>
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
            {t.to === '/alertes' && alerts > 0 && (
              <span className="absolute top-1.5 right-1.5 rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{alerts > 99 ? '99+' : alerts}</span>
            )}
            {t.to === '/suivis' && followNews > 0 && (
              <span className="absolute top-1.5 right-1.5 rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">{followNews > 99 ? '99+' : followNews}</span>
            )}
          </Link>
        ))}
      </div>

      </div>

      <HomeFeed />
    </div>
  )
}

/** Nom de l'appli saisi comme nom d'organisation (anciennes installations : « NEXTAR », « HANDBASE ») : pas un nom d'organisation. */
const isAppName = (s: string) => /^\s*(nextar|handbase)\s*$/i.test(s) || s.trim().toLowerCase() === appName().toLowerCase()

/**
 * En-tête de l'accueil : l'organisation mise en avant (la fédération, la ligue…). Logo et nom : ceux réglés par les
 * administrateurs (Réglages → Style de l'installation, « Organisation : nom et logo ») ; sans nom réglé, l'unité au sommet
 * de la structure. Le logo est montré tel quel (fond transparent), ou sur une tuile blanche si l'organisation l'a choisi (logo foncé en mode sombre) ;
 * sans logo, l'initiale du nom. L'appli (Nextar par défaut) signe dans l'en-tête de l'appli juste au-dessus (téléphone) ou à côté
 * (menu de gauche, ordinateur) : présent sur chaque écran sans concurrencer l'organisation, d'où aucune autre signature ici.
 */
function OrgHeader() {
  useThemeVersion()
  const units = useUnits()
  const per = usePerimeter()
  const look = installationAppearance()
  const roots = units.filter((u) => !u.parentId || !units.some((x) => x.id === u.parentId))
  const top = roots.find((u) => u.levelId === 'niveau-federation') ?? (roots.length === 1 ? roots[0] : undefined)
  const own = look.name && !isAppName(look.name) ? look.name : ''
  const name = own || top?.name || 'Mon organisation'
  const where = !per
    ? ''
    : per.all
      ? 'Toute la France'
      : per.units.length
        ? per.units.map((u) => u.name).join(' · ')
        : 'Aucune affectation pour l’instant'
  const tile = 'flex h-16 w-16 shrink-0 items-center justify-center rounded-xl side:h-20 side:w-20'
  return (
    <div className="flex items-center gap-3.5 px-1 side:col-span-full side:gap-5">
      {look.logo ? (
        <span className={look.logoBg === 'white' ? `${tile} bg-white p-1.5 shadow-sm ring-1 ring-black/[0.07] side:p-2` : tile}>
          <img src={look.logo} alt="" className="h-full w-full object-contain" />
        </span>
      ) : (
        <span aria-hidden className={`${tile} bg-panel-2 text-2xl font-extrabold text-muted ring-1 ring-line side:text-3xl`}>
          {name.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <div className="min-w-0">
        <h1 className="text-lg leading-snug font-extrabold text-balance side:text-2xl side:leading-tight">{name}</h1>
        {where && <p className="mt-1 text-xs text-muted side:text-sm">Ton périmètre : {where}</p>}
      </div>
    </div>
  )
}
