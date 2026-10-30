import { applyUpdate, useUpdateReady } from './pwa'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { pushSupport, setIconBadge, syncSubscription } from './push'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, type NavLinkProps } from 'react-router-dom'
import { canLeave, ConfirmHost } from './components/Confirm'
import { GlobalCompareBar } from './components/ComparePick'
import { TRIAL, TRIAL_LABEL } from './db'
import { useShowBrand } from './brandPref'
import { useDepartments } from './lists'
import { useSportConfig } from './installation'
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
import { warmCoverage } from './coverageCache'
import { useFollowNewsCount } from './follows'
import { Icon, ICONS } from './components/ui'
import { ProfileButton } from './components/ProfileMenu'
import { can, useRole } from './roles'
import { useThemeVersion } from './theme'
import { AppLockup } from './components/Brand'
import { appName, useAppBrand } from './appBrand'
import { SyncProgressBar } from './components/SyncProgress'
import { BackTracker } from './backNav'
import { STAFF } from './staffLabels'
import { SpyBanner } from './components/ViewAs'
import { spyTarget } from './spy'
import MasterDetail from './components/MasterDetail'
import VideoDock from './components/VideoDock'
import { MQ, useMedia } from './layout'
import { isPlayerRole } from './roles'
import { AskButton } from './components/Demander'
import { AskActionHost } from './components/AskAction'

// Écrans moins fréquents ou lourds (graphiques) : chargés à la demande, pour un démarrage plus rapide.
// Le service worker les garde tous en cache : ils restent disponibles hors ligne.
const JoueurFiche = lazy(() => import('./pages/JoueurFiche'))
const ReviewPage = lazy(() => import('./pages/Review'))
const Missed = lazy(() => import('./pages/Missed'))
const Settings = lazy(() => import('./pages/Settings'))
const Events = lazy(() => import('./pages/Events'))
const EventDetail = lazy(() => import('./pages/Events').then((m) => ({ default: m.EventDetail })))
const EventPlayers = lazy(() => import('./pages/EventPlayers'))
const EventPlayer = lazy(() => import('./pages/EventPlayers').then((m) => ({ default: m.EventPlayer })))
const Groups = lazy(() => import('./pages/Groups'))
const GroupDetail = lazy(() => import('./pages/Groups').then((m) => ({ default: m.GroupDetail })))
const GroupPlayers = lazy(() => import('./pages/GroupPlayers'))
const GroupPlayer = lazy(() => import('./pages/GroupPlayers').then((m) => ({ default: m.GroupPlayer })))
const NewGroup = lazy(() => import('./pages/Groups').then((m) => ({ default: m.NewGroup })))
const Alerts = lazy(() => import('./pages/Alerts'))
const AlertDetail = lazy(() => import('./pages/Alerts').then((m) => ({ default: m.AlertDetail })))
const NewAlert = lazy(() => import('./pages/Alerts').then((m) => ({ default: m.NewAlert })))
const Follows = lazy(() => import('./pages/Follows'))
const Teams = lazy(() => import('./pages/Teams'))
const Compare = lazy(() => import('./pages/Compare'))
const RewatchPage = lazy(() => import('./pages/Rewatch'))
const RewatchPlayers = lazy(() => import('./pages/Rewatch').then((m) => ({ default: m.RewatchPlayers })))
const RewatchPlayer = lazy(() => import('./pages/Rewatch').then((m) => ({ default: m.RewatchPlayer })))
const Coverage = lazy(() => import('./pages/Coverage'))
const CoveragePlayers = lazy(() => import('./pages/CoveragePlayers'))
const CoveragePlayer = lazy(() => import('./pages/CoveragePlayers').then((m) => ({ default: m.CoveragePlayer })))
const CoverageReport = lazy(() => import('./pages/Coverage').then((m) => ({ default: m.CoverageReport })))
const Question = lazy(() => import('./pages/Question'))
const QuestionPlayers = lazy(() => import('./pages/Question').then((m) => ({ default: m.QuestionPlayers })))
const QuestionPlayer = lazy(() => import('./pages/Question').then((m) => ({ default: m.QuestionPlayer })))
const GroupReport = lazy(() => import('./pages/GroupReport').then((m) => ({ default: m.GroupReport })))
// Espace joueur (/moi) : la seule page d'un compte joueur ; aperçu pour un administrateur depuis une fiche.
const Me = lazy(() => import('./pages/Me'))
const PoleSeason = lazy(() => import('./pages/PoleSeason'))

/**
 * Raccourci de l'en-tête (à gauche, en face de la bulle de profil) : pictogramme et nom (« Mes suivis ») dès que la place
 * le permet (sm), pictogramme seul sur téléphone ; le nombre de nouveautés en pastille, collée
 * au nom ou posée sur le pictogramme. `compact` (menu de gauche, téléphone couché) : pictogramme seul, toujours.
 */
function HeaderShortcut({ to, icon, label, n, aria, compact }: { to: string; icon: 'star' | 'target'; label: string; n: number; aria: string; compact?: boolean }) {
  const count = n > 99 ? '99+' : String(n)
  if (compact)
    return (
      <GuardedLink to={to} aria-label={aria} title={label} className="relative inline-flex shrink-0 items-center rounded-full text-muted hover:text-fg">
        <Icon name={icon} className="h-6 w-6" />
        {n > 0 && <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-accent px-1 text-center text-[9px] leading-4 font-bold text-white">{count}</span>}
      </GuardedLink>
    )
  return (
    <GuardedLink
      to={to}
      aria-label={aria}
      className="relative inline-flex shrink-0 items-center gap-1.5 rounded-full text-muted hover:text-fg sm:border sm:border-line sm:px-3 sm:py-1.5 sm:hover:border-accent"
    >
      <Icon name={icon} className="h-5 w-5 sm:h-4 sm:w-4" />
      <span className="hidden text-xs font-bold whitespace-nowrap sm:inline">{label}</span>
      {n > 0 && (
        <>
          <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-accent px-1 text-center text-[9px] leading-4 font-bold text-white sm:hidden">{count}</span>
          <span className="hidden min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 font-bold text-white sm:inline">{count}</span>
        </>
      )}
    </GuardedLink>
  )
}

/** Profils recherchés (téléphone couché seulement : menu de gauche), avec le nombre de joueurs qui viennent d'y entrer. */
const AlertBell = ({ n }: { n: number }) => <HeaderShortcut to="/alertes" icon="target" label="Profils recherchés" n={n} aria={n ? `Profils recherchés : ${n} nouveau${n > 1 ? 'x' : ''}` : 'Profils recherchés'} compact />

/** « Mes suivis », avec le nombre de nouveautés pas encore vues. */
const FollowStar = ({ n, compact }: { n: number; compact?: boolean }) => <HeaderShortcut to="/suivis" icon="star" label="Mes suivis" n={n} aria={n ? `Mes suivis : ${n} nouveauté${n > 1 ? 's' : ''}` : 'Mes suivis'} compact={compact} />

/**
 * Onglets (barre du bas sur téléphone, menu de gauche sur ordinateur). Réglages et Confidentialité sont dans le menu de la
 * bulle de profil de l'en-tête (src/components/ProfileMenu.tsx). Bilan : comptes qui voient le bilan de détection
 * (can.viewCoverage), actif sur /bilan et ses sous-pages.
 */
const NAV = [
  { to: '/', label: 'Accueil', icon: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z' },
  { to: '/joueurs', label: 'Joueurs', icon: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-4 4-6 8-6s8 2 8 6' },
  { to: '/evenements', label: 'Événements', icon: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4' },
  { to: '/groupes', label: 'Groupes', icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a3 3 0 1 0 0-6M3 20c0-3 3-5 6-5s6 2 6 5M17 15c2.5 0 4 1.7 4 5' },
  { to: '/bilan', label: 'Bilan', icon: ICONS.map },
]

/** Compte joueur (espace joueur, supabase/051) : sa page et des réglages réduits (apparence, déconnexion), rien d'autre. */
const NAV_PLAYER = [
  { to: '/moi', label: 'Ma page', icon: NAV[1].icon },
  // Icône des Réglages (plus dans NAV : ils sont dans la bulle de profil pour le staff).
  { to: '/parametres', label: 'Réglages', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1V4h-4v3l-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1v3h4v-3l2-1 2 1 2-4z' },
]

/** Téléphone couché trop bas pour l'étoile et la cible dans le menu de gauche : elles passent dans le menu de la bulle de profil. */
const RAIL_SHORT = '(orientation: landscape) and (max-height: 379px)'

/**
 * Version d'essai ou démonstration, téléphone couché (plus de bande orange : plus d'en-tête) : un petit repère orange en
 * haut du menu de gauche, qui garde le texte en bulle d'aide et pour les lecteurs d'écran.
 */
function TrialMark() {
  if (!TRIAL) return null
  return (
    <span role="note" aria-label={TRIAL_LABEL} title={TRIAL_LABEL} className="mx-auto mb-1.5 block h-1.5 w-7 shrink-0 rounded-full bg-amber-500" />
  )
}

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

/**
 * Identité de l'appli (en-tête sur téléphone ; en haut du menu de gauche sur ordinateur) : pictogramme et nom écrit à côté
 * (Nextar par défaut ; Réglages → Administration → « Appli : nom et logo » ; src/components/Brand.tsx). Le nom et le logo
 * du style de l'installation sont ceux de l'organisation : ils sont sur l'accueil (OrgHeader, src/pages/Home.tsx), plus ici.
 */
function Logo({ className = '', stacked = false }: { className?: string; stacked?: boolean }) {
  const { name } = useAppBrand()
  // Réglages → Apparence : logo et nom masqués au choix (src/brandPref.ts) ; en haut du menu, la place reste (même hauteur que l'en-tête).
  if (!useShowBrand()) return null
  return (
    <GuardedLink to="/" aria-label={`${name}, accueil`} className={`leading-none ${stacked ? 'text-lg' : 'flex min-w-0 items-center gap-2 text-[17px]'} ${className}`}>
      <AppLockup mark={stacked ? 'h-8 w-8' : 'h-7 w-7'} />
    </GuardedLink>
  )
}

/**
 * Largeur du contenu en paysage et sur ordinateur, selon l'écran (sur téléphone tenu droit, tout reste
 * dans la colonne de 42rem). Listes et tableaux de bord s'élargissent ; les formulaires restent étroits.
 */
const PAGE_W: [RegExp, string][] = [
  [/^\/(joueurs\/nouveau|joueurs\/[^/]+\/(modifier|mesures)|groupes\/nouveau|alertes\/nouvelle|confidentialite|moi)$/, ''],
  // Notation : joueur (ou liste de l'événement) à gauche, grille à droite ; téléphone couché : pleine largeur pour la liste,
  // l'écran garde sa colonne étroite sans elle (Evaluate.tsx).
  [/^\/evaluer$/, 'side:max-w-6xl rail:max-w-none'],
  [/^\/(joueurs|(evenements|groupes)\/[^/]+\/joueurs|bilan(\/question)?\/joueurs|a-revoir\/joueurs)\/[^/]+$/, 'wide:max-w-4xl'],
  [/^\/(actualite|avis-spontanes|rates)$/, 'wide:max-w-4xl'],
  // Comparaison de deux joueurs : radar à gauche, tableau à droite sur ordinateur.
  [/^\/comparer$/, 'wide:max-w-6xl'],
  // Rapport chiffré du bilan, export d'un groupe en PDF : une feuille à imprimer.
  [/^\/(bilan|groupes\/[^/]+)\/rapport$/, 'wide:max-w-4xl'],
  // Changement de saison d'un pôle : deux colonnes.
  [/^\/groupes\/[^/]+\/saison$/, 'wide:max-w-6xl'],
  [/^\//, 'wide:max-w-7xl'],
]

/** Listes en maître-détail (liste + panneau sur ordinateur) : même largeur, liste seule ou fiche ouverte. */
const MASTER = /^\/((joueurs|groupes|evenements)(\/[^/]+)?|((evenements|groupes)\/[^/]+|bilan(\/question)?|a-revoir)\/joueurs\/[^/]+)$/

function PageWidth({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const split = useMedia(MQ.split)
  const md = split && MASTER.test(pathname) && !/\/(nouveau)$/.test(pathname)
  const w = md ? 'wide:max-w-7xl page-md' : (PAGE_W.find(([re]) => re.test(pathname))?.[1] ?? '')
  return <div className={`mx-auto w-full max-w-2xl ${w}`}>{children}</div>
}

/** Hauteur de l'en-tête dans --hdr (panneaux et colonnes collés juste dessous). */
function useHeaderHeight() {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--hdr', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return ref
}

/** Colonne de la liste des joueurs, fiche ouverte (filtres repliés) : un tiers de la largeur, une carte de large (--players-col). */
const PLAYERS_COL = 'minmax(0, var(--players-col))'

/** Nouvelle version prête : un appui pour la prendre, sans fermer l'appli. */
function UpdateBanner() {
  const ready = useUpdateReady()
  if (!ready) return null
  return (
    <div className="no-print fixed inset-x-0 bottom-[calc(var(--nav-b)+0.75rem)] z-30 mx-auto flex max-w-2xl px-4 wide:bottom-4 wide:left-[var(--nav-l)]">
      <div className="flex w-full items-center gap-3 rounded-win border border-accent bg-panel px-3 py-2 text-xs shadow-lg">
        <span className="min-w-0 flex-1">Nouvelle version de {appName()} disponible.</span>
        <button className="btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={async () => (await canLeave()) && applyUpdate()}>
          Mettre à jour
        </button>
      </div>
    </div>
  )
}

export default function App() {
  // Avis spontanés à valider : pastille sur « Évaluer ».
  const toReview = usePendingCount()
  const alerts = useAlertCount()
  const followNews = useFollowNewsCount()
  // Pastille sur l'icône de l'appli : tout ce qui attend (propositions à valider + nouvelles alertes).
  useEffect(() => {
    void setIconBadge(toReview + alerts)
  }, [toReview, alerts])
  // Noms des départements (liste modifiable) : toute l'appli se redessine quand ils changent.
  useDepartments()
  // Sport et postes de l'installation (table hb_config, handball par défaut) : redessin quand ils changent.
  useSportConfig()
  // Expiration RGPD des fiches proposées jamais traitées (si le serveur ne le fait pas la nuit).
  useDailyPurge()
  // Compte joueur : une seule page (/moi), menu réduit, pas de notifications ni de pictogrammes du staff dans l'en-tête.
  const player = isPlayerRole(useRole())
  // Notifications : l'abonnement de ce téléphone est réenregistré sur le serveur à chaque ouverture.
  useEffect(() => {
    if (pushSupport() === 'ok' && !player) void syncSubscription()
  }, [player])
  // Changement de thème : tout se redessine (les graphiques relisent les couleurs).
  useThemeVersion()
  const header = useHeaderHeight()
  const role = useRole()
  // Bilan de détection préparé quand l'appli ne fait rien, quelques secondes après l'ouverture (src/coverageCache.ts) :
  // son premier passage s'affiche sans relire la base.
  useEffect(() => (player || !can.viewCoverage(role) ? undefined : warmCoverage(can.nationalView(role))), [player, role])
  // Téléphone couché : plus d'en-tête ; « Demander » en haut du menu de gauche, suivis, cible et profil en bas.
  const rail = useMedia(MQ.rail)
  const railShort = useMedia(RAIL_SHORT)
  // Téléphone tenu droit (ni colonne, ni menu à gauche) : capsule d'onglets flottante en bas.
  const side = useMedia(MQ.side)
  const portrait = !rail && !side
  const navigate = useNavigate()
  const goGuarded = (to: string) => async () => {
    if (await canLeave()) navigate(to)
  }
  // Trop peu de hauteur : l'étoile et la cible deviennent des entrées du menu de profil (nouveautés en pastille sur la bulle).
  const railExtra =
    rail && railShort && !player
      ? [
          { label: followNews ? `Mes suivis · ${followNews} nouveauté${followNews > 1 ? 's' : ''}` : 'Mes suivis', icon: 'star' as const, onSelect: goGuarded('/suivis') },
          { label: alerts ? `Profils recherchés · ${alerts}` : 'Profils recherchés', icon: 'target' as const, onSelect: goGuarded('/alertes') },
        ]
      : []
  // Compte joueur : sa navigation à lui ; staff : le Bilan seulement pour qui a le droit de le voir.
  const nav = player ? NAV_PLAYER : NAV.filter((n) => n.to !== '/bilan' || can.viewCoverage(role))
  return (
    // Téléphone tenu droit : colonne étroite, onglets en bas. Paysage / ordinateur : navigation à gauche
    // (--nav-l, index.css), contenu élargi selon la page (PAGE_W).
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col wide:max-w-none wide:pl-[var(--nav-l)]">
      <header
        ref={header}
        // Téléphone couché : pas d'en-tête (toute la hauteur pour la page) ; son contenu est dans le menu de gauche (plus bas).
        className="app-header sticky top-0 z-20 grid grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)] items-center gap-2 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur rail:hidden side:gap-3 side:px-6"
      >
        {/* Version d'essai ou démonstration : une bande orange tout en haut, sur toute la largeur, qui porte son texte (plus
            de badge à côté du nom de l'appli, qu'il coupait sur téléphone). Dans l'en-tête : sa hauteur compte dans --hdr. */}
        {TRIAL && (
          <div className="col-span-3 -mx-4 -mt-3 mb-0.5 bg-amber-500 text-center text-[10px] leading-[18px] font-extrabold tracking-wider text-black side:-mx-6">
            {TRIAL_LABEL}
          </div>
        )}
        {/* Trois colonnes partout : « Mes suivis » à gauche · capsule « Nextar » au milieu · bulle de profil (point de
            synchro) à droite. Les deux colonnes du bord gardent la place de leur contenu (max-content) : sur téléphone étroit, la
            capsule glisse un peu plutôt que de passer sous un bouton. Compte joueur : ni capsule, ni suivis (outils du staff) ; la bulle de profil reste (synchro, réglages, déconnexion). */}
        {/* Plus de logo ici : le nom de l'appli est dans le bouton « ★ Nextar » du milieu (sur ordinateur, le logo reste en haut du menu). */}
        {/* À gauche, en face de la bulle de profil : « Mes suivis » (nom dès que la place le permet). « Profils recherchés » est
            une tuile de l'Accueil (choix du 26/10). */}
        <div className="flex min-w-0 items-center gap-3 sm:gap-2">
          {!player && !rail && <FollowStar n={followNews} />}
        </div>
        {/* Bulle ✦ « Demander » (toutes les pages ; raccourci « / » ; appui long : dictée) : src/components/Demander.tsx. */}
        {player || rail ? <span aria-hidden /> : <AskButton />}
        <div className="flex min-w-0 items-center justify-end gap-3">
          {/* Bulle de profil : initiales, point de synchro ; menu Réglages, Confidentialité, déconnexion (ProfileMenu.tsx). */}
          {!rail && <ProfileButton />}
        </div>
        {!rail && <SyncProgressBar />}
        {/* « Voir comme… » (outil administrateur) : bandeau sous l'en-tête. */}
        {!rail && <SpyBanner />}
      </header>
      {/* Téléphone couché (pas d'en-tête) : barre de téléchargement et bandeau « Voir comme… » tout en haut de la page. */}
      {rail && (
        <div className="no-print fixed top-0 right-0 left-[var(--nav-l)] z-20">
          <div className="relative">
            <SyncProgressBar />
            <SpyBanner />
          </div>
        </div>
      )}

      <BackTracker />
      <main
        className={`flex-1 px-4 pb-28 wide:pb-10 rail:pr-[max(1rem,env(safe-area-inset-right))] side:px-6 ${spyTarget() ? 'pt-14' : 'pt-4 rail:pt-3 side:pt-5'}`}
      >
        <Suspense fallback={<div className="py-20 text-center text-sm text-muted">Chargement…</div>}>
        <PageWidth>
        {player ? (
          // Espace joueur : sa page, des réglages réduits, la confidentialité ; toute autre adresse ramène à sa page.
          <Routes>
            <Route path="/moi" element={<Me />} />
            <Route path="/parametres" element={<Settings />} />
            <Route path="/confidentialite" element={<Privacy />} />
            <Route path="*" element={<Navigate to="/moi" replace />} />
          </Routes>
        ) : (
        <Routes>
          <Route path="/" element={<Home toReview={toReview} followNews={followNews} alerts={alerts} />} />
          {/* Aperçu de l'espace joueur (?joueur=<id>) : administrateurs, mode essai. */}
          <Route path="/moi" element={<Me />} />
          <Route path="/suivis" element={<Follows />} />
          {/* Listes en maître-détail : /joueurs/:id = liste + fiche sur ordinateur, fiche seule sur téléphone. */}
          <Route path="/joueurs" element={<MasterDetail base="/joueurs" list={<Players />} listCol={PLAYERS_COL} />}>
            <Route index element={null} />
            <Route path=":id" element={<JoueurFiche />} />
          </Route>
          <Route path="/joueurs/nouveau" element={<PlayerForm />} />
          <Route path="/joueurs/:id/modifier" element={<PlayerForm />} />
          <Route path="/joueurs/:id/mesures" element={<MeasureSession />} />
          <Route path="/evaluer" element={<Evaluate />} />
          <Route path="/avis-spontanes" element={<ReviewPage />} />
          <Route path="/rates" element={<Missed />} />
          <Route path="/evenements" element={<MasterDetail base="/evenements" list={<Events />} listCol="minmax(0, var(--md-col))" />}>
            <Route index element={null} />
            <Route path=":id" element={<EventDetail />} />
          </Route>
          {/* Fiche ouverte depuis un événement : ses joueurs à gauche (ordinateur), ‹ › sur téléphone (EventPlayers.tsx). */}
          <Route path="/evenements/:id/joueurs" element={<EventPlayers />}>
            <Route path=":pid" element={<EventPlayer />} />
          </Route>
          <Route path="/groupes" element={<MasterDetail base="/groupes" list={<Groups />} listCol="minmax(0, var(--md-col))" />}>
            <Route index element={null} />
            <Route path=":id" element={<GroupDetail />} />
          </Route>
          {/* Fiche ouverte depuis un groupe : ses joueurs à gauche (ordinateur), ‹ › sur téléphone (GroupPlayers.tsx). */}
          <Route path="/groupes/:id/joueurs" element={<GroupPlayers />}>
            <Route path=":pid" element={<GroupPlayer />} />
          </Route>
          <Route path="/groupes/nouveau" element={<NewGroup />} />
          <Route path="/groupes/:id/rapport" element={<GroupReport />} />
          {/* Changement de saison d'un groupe Pôle (src/pages/PoleSeason.tsx). */}
          <Route path="/groupes/:id/saison" element={<PoleSeason />} />
          <Route path={STAFF.route} element={<Teams />} />
          <Route path="/parametres" element={<Settings />} />
          <Route path="/confidentialite" element={<Privacy />} />
          <Route path="/actualite" element={<Feed />} />
          <Route path="/alertes" element={<Alerts />} />
          <Route path="/alertes/nouvelle" element={<NewAlert />} />
          <Route path="/alertes/:id" element={<AlertDetail />} />
          {/* Ancienne vue nationale : onglets du bilan de détection (liens et favoris gardés). */}
          <Route path="/national" element={<Navigate to="/bilan?onglet=licencies" replace />} />
          <Route path="/comparer" element={<Compare />} />
          <Route path="/a-revoir" element={<RewatchPage />} />
          {/* Fiche ouverte depuis « À revoir » : ses joueurs à gauche (ordinateur), ‹ › sur téléphone (Rewatch.tsx). */}
          <Route path="/a-revoir/joueurs" element={<RewatchPlayers />}>
            <Route path=":pid" element={<RewatchPlayer />} />
          </Route>
          <Route path="/bilan" element={<Coverage />} />
          <Route path="/bilan/rapport" element={<CoverageReport />} />
          {/* Fiche ouverte depuis le bilan : les joueurs du club choisi à gauche (ordinateur), ‹ › sur téléphone (CoveragePlayers.tsx). */}
          <Route path="/bilan/joueurs" element={<CoveragePlayers />}>
            <Route path=":pid" element={<CoveragePlayer />} />
          </Route>
          {/* « Poser une question » au bilan : réponse (recette dans l'adresse), fiche dans le contexte de la réponse (Question.tsx). */}
          <Route path="/bilan/question" element={<Question />} />
          <Route path="/bilan/question/joueurs" element={<QuestionPlayers />}>
            <Route path=":pid" element={<QuestionPlayer />} />
          </Route>
        </Routes>
        )}
        </PageWidth>
        </Suspense>
      </main>

      {/* Onglets : capsule flottante en bas, icônes seules (tenu droit, choix du 30/10), fine colonne d'icônes (téléphone
          couché), menu à gauche (ordinateur). « Demander » reste au milieu de l'en-tête. */}
      <nav
        aria-label="Menu principal"
        className={`fixed bottom-[calc(0.625rem+env(safe-area-inset-bottom))] left-3 z-20 rounded-full border border-line bg-panel/95 shadow-lg backdrop-blur right-3 wide:top-0 wide:bottom-0 wide:left-0 wide:right-auto wide:w-[var(--nav-l)] wide:rounded-none wide:border-0 wide:border-r wide:bg-bg/95 wide:pb-[env(safe-area-inset-bottom)] wide:shadow-none rail:flex rail:flex-col rail:pl-[env(safe-area-inset-left)]`}
      >
        {/* Ordinateur : le haut du menu a la hauteur et la couleur de l'en-tête (--hdr, bande orange comprise) ; la ligne
            sous l'en-tête continue jusqu'au bord gauche et « Accueil » commence dessous (choix du 30/10). */}
        <div className="app-header hidden shrink-0 flex-col border-b border-line side:flex side:h-[var(--hdr)]">
          {TRIAL && <div aria-hidden className="h-[18px] shrink-0 bg-amber-500" />}
          <div className="flex min-h-0 flex-1 items-center px-5">
            <Logo stacked />
          </div>
        </div>
        {/* Téléphone couché : en haut, le repère « version d'essai » et le bouton « Demander » (pictogramme de l'appli). */}
        {rail && (
          <div className="flex shrink-0 flex-col items-center pt-2">
            <TrialMark />
            {!player && <AskButton rail />}
          </div>
        )}
        <div className="mx-auto flex h-[50px] max-w-2xl items-center justify-around px-1 wide:h-auto wide:max-w-none wide:flex-col wide:items-stretch rail:min-h-0 rail:w-full rail:flex-1 rail:justify-center rail:gap-0.5 rail:px-0 side:gap-0.5 side:px-2 side:pt-4">
          {nav.map((n) => (
            <GuardedLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              title={n.label}
              className={({ isActive }) =>
                `flex min-w-0 flex-auto flex-col items-center justify-center text-xs font-bold wide:flex-none rail:py-2 side:flex-row side:justify-start side:gap-3 side:rounded-lg side:px-3 side:py-2.5 side:text-sm side:hover:bg-panel-2 ${isActive ? 'text-accent side:bg-accent/10 side:hover:bg-accent/15' : 'text-muted side:hover:text-fg'}`
              }
            >
              {({ isActive }) => (
                <>
                  {/* Tenu droit : l'onglet ouvert dans une pastille teintée, pictogramme et nom ; les autres, pictogramme seul
                      (choix du 30/10). */}
                  <span className={`flex h-10 items-center justify-center gap-1.5 rounded-full wide:h-auto wide:w-auto wide:bg-transparent wide:px-0 side:gap-3 ${isActive ? 'bg-accent/15 px-3.5' : 'w-10'}`}>
                    <span className="relative">
                      <svg viewBox="0 0 24 24" className="h-6 w-6 side:h-5 side:w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
                        <path d={n.icon} />
                      </svg>
                      {/* Propositions à valider : pastille sur l'accueil (le bouton Propositions y est). */}
                      {n.to === '/' && toReview > 0 && (
                        <span className="absolute -top-1.5 -right-2.5 rounded-full bg-amber-400 px-1 text-[9px] leading-tight text-black">{toReview}</span>
                      )}
                    </span>
                    {/* Nom écrit : onglet ouvert (tenu droit) et ordinateur ; ailleurs lu par les lecteurs d'écran et en info-bulle. */}
                    <span className={`whitespace-nowrap ${isActive ? 'rail:sr-only' : 'sr-only side:not-sr-only'}`}>{n.label}</span>
                  </span>
                </>
              )}
            </GuardedLink>
          ))}
        </div>
        {/* Téléphone couché : en bas, l'étoile des suivis et la cible (si la hauteur le permet), puis la bulle de profil. */}
        {rail && (
          <div className="flex shrink-0 flex-col items-center gap-3.5 pt-1 pb-2.5">
            {!player && !railShort && <FollowStar n={followNews} compact />}
            {!player && !railShort && <AlertBell n={alerts} />}
            <ProfileButton rail extra={railExtra} badge={railShort && !player ? followNews + alerts : 0} />
          </div>
        )}
      </nav>
      {/* Tenu droit : un voile du fond sous la capsule, pour que la page qui défile dessous (et sous les barres « Enregistrer »
          collées au-dessus) ne se lise pas autour des boutons. */}
      {portrait && <div aria-hidden className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[15] h-[calc(var(--nav-b)+1rem)] bg-linear-to-t from-bg from-70% to-transparent" />}
      <UpdateBanner />
      {/* Lecteur vidéo, hors des pages : il reste ouvert quand la mise en page change (téléphone tourné). */}
      {!player && <VideoDock />}
      {!player && <GlobalCompareBar />}
      <ConfirmHost />
      <AskActionHost />
    </div>
  )
}
