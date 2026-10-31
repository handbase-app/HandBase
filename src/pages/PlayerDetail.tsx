import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackButton, useBack } from '../backNav'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { stampOf, StampWindow } from '../components/ActivityLog'
import { MaturityCard } from '../components/MaturityCard'
import { PlayerGroups } from '../components/Groups'
import { Opinions } from '../components/Opinions'
import { department } from '../components/PlayerFilter'
import { departmentLabel, regionLabel } from '../lists'
import { MergePlayers } from '../components/MergePlayers'
import { possibleDuplicates } from '../merge'
import { expiryDate } from '../purge'
import { ReviewActions, ReviewBadge, ReviewNote } from '../components/Review'
import { CourtView } from '../components/CourtPicker'
import { Avatar, fmtValue, groupBy, Icon, playerName, PosBadges, QuarterBadge, type IconName } from '../components/ui'
import { age, alive, criterionApplies, db, fmtDate, POLE_EXITS, poleName, lateralityLabel, remove, today, type Criterion, type Measurement, type Player, dayOf } from '../db'
import { teamSummary } from '../rencontres'
import { sportContent } from '../sportContent'
import { latestByPlayer } from './Players'
import { ask } from '../components/Confirm'
import { themeColor } from '../theme'
import { exportPlayer } from '../export'
import { can, useRole } from '../roles'
import { FollowButton, FollowedVia } from '../components/Follow'
import { VideoSection } from '../components/Videos'
import { PanelClose, usePanel } from '../components/MasterDetail'
import { HeaderMenu, PageHeader } from '../components/PageHeader'
import { copyLink } from '../components/ItemMenu'
import { RewatchButton, ScoutHistory, usePlayerRewatch } from '../components/Scouting'
import { usePerimeter } from '../installation'
import { sexLabel, w } from '../gender'
import { spyTarget } from '../spy'
import { PLAYER_TAB_DEFAULT, PLAYER_TABS, playerTabParam, tabOf, withTab, type PlayerTab } from '../tabQuery'
import { canInvite, canPreviewPlayerPage, PlayerAccessCard, SelfSection, usePlayerAccess } from '../components/PlayerSpace'
import { StaffJournal } from '../components/PlayerJournal'
import { FOCUS_KEY, FOCUS_TAB, focusAttr, parseFocus, withoutFocus, type PlayerFocus } from '../playerFocus'

// Mêmes identifiants que l'adresse (src/tabQuery.ts : PLAYER_TABS).
// Ordre choisi le 30/10 : Profil · Croissance · Tests · Vidéos · Avis · Compte joueur (vidéos et accès à l'espace joueur :
// onglets à part, plus dans « Profil » ; « Compte joueur » seulement pour qui peut s'en servir).
const TABS: readonly { id: PlayerTab; label: string; icon: IconName }[] = [
  { id: 'profil', label: 'Profil', icon: 'user' },
  { id: 'croissance', label: 'Croissance', icon: 'growth' },
  { id: 'tests', label: 'Tests', icon: 'stopwatch' },
  { id: 'videos', label: 'Vidéos', icon: 'video' },
  { id: 'avis', label: 'Avis', icon: 'chat' },
  { id: 'compte', label: 'Compte joueur', icon: 'key' },
]
type TabId = PlayerTab

/**
 * Onglets de la fiche, collés sous l'en-tête de l'appli quand on fait défiler. Un pictogramme par onglet ; le nom écrit
 * seulement dans l'onglet ouvert (pastille teintée, comme la barre du bas), nom complet en title et pour les lecteurs
 * d'écran (choix du 30/10 : les six tiennent sur 375 px). `counts` : nombre d'avis, de vidéos (petite pastille sur le
 * pictogramme, à côté du nom dans l'onglet ouvert). `hidden` : onglets absents (Compte joueur sans droit).
 */
function Tabs({ tab, setTab, counts, hidden }: { tab: TabId; setTab: (t: TabId) => void; counts: Partial<Record<TabId, number>>; hidden: TabId[] }) {
  // Hauteur réelle de l'en-tête (bandeau d'essai, encoche des iPhone…) ; dans le panneau de droite
  // (ordinateur), le panneau défile seul : les onglets se collent en haut du panneau.
  const inPanel = !!usePanel()
  const [top, setTop] = useState(50)
  // Remesurée quand l'écran tourne (en-tête plus compact sur téléphone couché).
  useLayoutEffect(() => {
    const measure = () => setTop(document.querySelector('header')?.getBoundingClientRect().height ?? 50)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return (
    // Dans le panneau de droite (marge haute pt-3), les onglets collent au bord même du cadre : sinon une bande
    // de 0,75 rem laisse voir le contenu qui défile au-dessus d'eux.
    <div data-fiche-onglets className={`sticky z-10 -mx-4 border-b border-line px-4 ${inPanel ? 'bg-bg' : 'bg-bg/95 backdrop-blur'}`} style={{ top: inPanel ? '-0.75rem' : top }}>
      <div className="flex items-center gap-1 py-1.5">
        {TABS.filter((t) => !hidden.includes(t.id)).map((t) => {
          const on = tab === t.id
          const n = counts[t.id] ?? 0
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-label={n ? `${t.label} (${n})` : t.label}
              aria-current={on ? 'true' : undefined}
              title={t.label}
              className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full text-xs font-bold transition ${on ? 'flex-none bg-accent/15 px-3 text-accent' : 'flex-1 text-muted hover:text-fg'}`}
            >
              <span className="relative shrink-0">
                <Icon name={t.icon} className="h-[18px] w-[18px]" />
                {!on && n > 0 && (
                  <span aria-hidden className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-line px-1 text-center text-[9px] leading-4 font-bold text-fg">
                    {n}
                  </span>
                )}
              </span>
              {on && (
                <span aria-hidden className="whitespace-nowrap">
                  {t.label}
                  {n > 0 && <span className="ml-1 text-[10px] opacity-70">{n}</span>}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Fiche d'un joueur : /joueurs/:id, ou ouverte depuis une liste (événement…) qui passe `id` elle-même.
 * `hideBack` : la liste fournit déjà son bouton retour (barre du haut sur téléphone).
 */
export default function PlayerDetail({ id: idProp, hideBack = false }: { id?: string; hideBack?: boolean } = {}) {
  const route = useParams()
  const id = idProp ?? route.id
  const nav = useNavigate()
  const role = useRole()
  const panel = usePanel()
  // ?fusion=<id> : ouvre la fusion avec cette autre fiche (lien « Comparer et fusionner »).
  const [params, setParams] = useSearchParams()
  // Après une suppression : retour à l'écran d'origine (src/backNav.tsx).
  const leave = useBack('/joueurs', 'JOUEURS')
  const mergeWith = params.get('fusion')
  // Onglet dans l'adresse (?onglet=avis ; ?fiche=… sous /bilan/joueurs, où `onglet` est celui du bilan) : on le
  // retrouve en revenant sur la fiche, et il reste ouvert en passant à un autre joueur de la liste (src/tabQuery.ts).
  // Changer d'onglet remplace l'adresse et garde ses autres paramètres (état de la liste d'origine : bilan, réponse…).
  const { pathname, search, state } = useLocation()
  const tabKey = playerTabParam(pathname)
  const tab = tabOf(search, PLAYER_TABS, PLAYER_TAB_DEFAULT, tabKey)
  const setTab = (t: TabId) => {
    // La fusion ouverte par un lien (?fusion=) se referme en changeant d'onglet, comme avant.
    const q = new URLSearchParams(withTab(search, t, PLAYER_TABS, PLAYER_TAB_DEFAULT, tabKey))
    q.delete('fusion')
    setParams(q, { replace: true, state })
  }
  // ?voir=… (ligne de « Mes suivis », src/playerFocus.ts) : retenu ici (numéroté : le même lien rouvert vise de nouveau),
  // retiré de l'adresse aussitôt (remplacée, même état : « Retour » ramène toujours à l'écran d'origine).
  // Gardé pour ce joueur seulement (fiche réutilisée en passant à un autre joueur de la liste).
  const voir = params.get(FOCUS_KEY)
  const [aimed, setAimed] = useState<(PlayerFocus & { n: number; pid?: string }) | null>(null)
  useEffect(() => {
    if (voir === null) return
    const f = parseFocus(voir)
    if (f) setAimed((old) => ({ ...f, pid: id, n: (old?.n ?? 0) + 1 }))
    // L'onglet de l'élément visé s'ouvre de lui-même (vidéo : onglet Vidéos, même par un ancien lien sans `onglet`).
    const rest = withoutFocus(search)
    setParams(new URLSearchParams(f ? withTab(rest, FOCUS_TAB[f.kind], PLAYER_TABS, PLAYER_TAB_DEFAULT, tabKey) : rest), { replace: true, state })
  }, [voir]) // eslint-disable-line react-hooks/exhaustive-deps
  const focus = aimed && aimed.pid === id ? aimed : null
  useFocusScroll(focus)
  /** Lien vers une autre fiche (doublon, fiche fusionnée) : même onglet. */
  const sameTab = withTab('', tab, PLAYER_TABS, PLAYER_TAB_DEFAULT)
  const [merging, setMerging] = useState(false)
  // Fenêtre « Infos de la fiche » (créée par…, modifiée par…), ouverte par le ⋮.
  const [stampOpen, setStampOpen] = useState(false)
  // « À revoir » de ce joueur visibles (mon staff) : bouton « à revoir ×2 » (supabase/041).
  const rewatch = usePlayerRewatch(id!)
  const per = usePerimeter()
  const data = useLiveQuery(async () => {
    const player = await db.players.get(id!)
    if (!player) return null
    const [criteria, measurements, evaluations, events, homonyms, videos] = await Promise.all([
      db.criteria.orderBy('order').toArray().then(alive),
      db.measurements.where('playerId').equals(id!).toArray().then(alive),
      db.evaluations.where('playerId').equals(id!).toArray().then(alive),
      db.events.toArray(), // y compris supprimés : leurs avis gardent le nom de l'événement
      db.players.where('lastName').equalsIgnoreCase(player.lastName).toArray().then(alive),
      // Nombre de vidéos (onglet « Vidéos ») : mêmes liens que la section (src/components/Videos.tsx).
      db.videos.where('targetId').equals(id!).filter((v) => !v.deleted && v.targetKind === 'player' && !!v.url).count(),
    ])
    // Doublons possibles de cette fiche (même nom, naissance compatible, l'une proposée ou sans licence).
    const duplicates = possibleDuplicates(homonyms)
      .filter(([a, b]) => a.id === player.id || b.id === player.id)
      .map(([a, b]) => (a.id === player.id ? b : a))
    return { player, criteria, measurements, evaluations, events, duplicates, videos }
  }, [id])

  if (data === undefined) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (data?.player.mergedInto)
    return (
      <div className="py-20 text-center text-sm text-muted">
        Cette fiche a été fusionnée avec une autre.
        <br />
        <Link to={`/joueurs/${data.player.mergedInto}${sameTab}`} replace className="mt-3 inline-block font-bold text-accent">
          Voir la fiche {w(data.player.sex).duJoueur} →
        </Link>
      </div>
    )
  // « Voir comme… » : fiche hors du périmètre du membre simulé (src/viewAsFilter.ts), comme dans les événements et groupes.
  if (data === null && spyTarget() && per && !per.all)
    return (
      <div className="py-20 text-center text-sm text-muted" data-testid="hors-perimetre-fiche">
        Joueur hors de ton périmètre (fiche non affichée).
      </div>
    )
  if (data === null || data.player.deleted) return <div className="py-20 text-center text-sm text-muted">Joueur introuvable.</div>

  const { player: p, criteria, measurements, evaluations, events } = data
  const latest = latestByPlayer(measurements).get(p.id) ?? new Map<string, Measurement>()
  const factual = criteria.filter((c) => c.kind === 'factual')
  const subjective = criteria.filter((c) => c.kind === 'subjective' && criterionApplies(c, p.position))
  const a = age(p.birthDate)
  const g = w(p.sex)
  const teamText = teamSummary(p, today(), sportContent().youthCategories)

  // Taille, poids : dernière mesure, avec l'unité du critère (ou l'unité habituelle si le critère n'est pas dans la base).
  const gauge = (id: string, unit: string) => {
    const m = latest.get(id)
    if (!m) return undefined
    const c = factual.find((x) => x.id === id)
    return c ? fmtValue(c, m.value) : `${fmtValue(undefined, m.value)} ${unit}`
  }
  const info: [string, string | undefined][] = [
    ['Sexe', sexLabel(p.sex) || undefined],
    ['Club', p.club],
    ['Département', department(p) && departmentLabel(department(p)!)],
    ['Équipe', p.team],
    ['Catégorie / niveau', p.category],
    ['Nationalité', p.nationality],
    ['Licence', p.license && `${p.license}${p.licenseStatus ? ` (${p.licenseStatus.toLowerCase().replace(/_/g, ' ')})` : ''}`],
    ['Type de licence', p.licenseRequestType && p.licenseRequestType.charAt(0) + p.licenseRequestType.slice(1).toLowerCase()],
    ['Anciennes licences', p.previousLicenses?.join(', ')],
    ['Internat', p.boarding === true ? 'Oui' : p.boarding === false ? 'Non' : undefined],
    ['Naissance', p.birthDate && fmtDate(p.birthDate)],
    ['Taille', gauge('taille', 'cm')],
    ['Poids', gauge('poids', 'kg')],
    ['Latéralité', lateralityLabel(p.laterality, p.sex)],
    ['Taille de la mère', p.motherHeight !== undefined ? `${p.motherHeight} cm (${p.motherHeightSource === 'mesuree' ? 'mesurée' : 'déclarée'})` : undefined],
    ['Taille du père', p.fatherHeight !== undefined ? `${p.fatherHeight} cm (${p.fatherHeightSource === 'mesuree' ? 'mesurée' : 'déclarée'})` : undefined],
  ]

  const testGroups = groupBy(
    factual.filter((c) => c.category !== 'Gabarit' && latest.has(c.id)),
    (c) => c.category,
  )

  async function del() {
    if (!(await ask(`Supprimer la fiche de ${playerName(p)} ?`, { ok: 'Supprimer' }))) return
    await remove('players', p.id)
    // L'écran d'où l'on vient (liste, événement, groupe…), dans le même état ; entrée directe : la liste des joueurs.
    leave.exit()
  }

  const stamp = stampOf(p)
  // Onglet « Compte joueur » (accès à l'espace joueur) : pour qui peut s'en servir ; sinon ?onglet=compte ouvre « Profil ».
  const account = canInvite(role, p) || canPreviewPlayerPage(role)
  const view: TabId = tab === 'compte' && !account ? 'profil' : tab
  return (
    // data-fiche : la fiche de ce joueur est affichée (le glisser de ContextBar attend qu'elle le soit pour la faire arriver).
    <div className="flex flex-col gap-4" data-fiche={p.id}>
      {/* Ordinateur : fermer le panneau ; sinon pas de rangée (le ⋮ est à côté de « Suivre », depuis le 30/10). */}
      <PageHeader back={panel ? <PanelClose /> : hideBack ? null : <BackButton fallback="/joueurs" label="JOUEURS" />} />

      {/* Initiales alignées en haut avec le nom ; au bout de la rangée du nom : « Suivre » puis le ⋮ (actions de la fiche,
          Supprimer en dernier, avec confirmation). */}
      <div className="flex items-start gap-4">
        <Avatar p={p} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h1 className="min-w-0 text-lg font-extrabold">{playerName(p)}</h1>
            <div className="flex shrink-0 items-center gap-1">
              <FollowButton kind="player" id={p.id} sex={p.sex} />
              <HeaderMenu
                title={playerName(p)}
                subtitle={[p.club, a !== null ? `${a} ans` : ''].filter(Boolean).join(' · ') || undefined}
                items={[
                  can.editPlayer(role, p) && { label: can.editPlayers(role) ? 'Modifier la fiche' : 'Modifier ma proposition', icon: 'pencil', onSelect: () => nav(`/joueurs/${p.id}/modifier`) },
                  can.exportPlayer(role) && {
                    label: 'Ses données',
                    icon: 'download',
                    hint: `copie de toutes ses données (demande ${g.duJoueur} ou de ses parents)`,
                    onSelect: () => void exportPlayer(p.id),
                  },
                  { label: 'Copier le lien', icon: 'copy', onSelect: () => copyLink(`/joueurs/${p.id}`) },
                  // Créée par…, modifiée par… : plus dans l'en-tête (30/10), ici seulement s'il y a quelque chose à dire.
                  stamp && { label: 'Infos de la fiche', icon: 'clock', hint: 'création, dernière modification', onSelect: () => setStampOpen(true) },
                  // Espace joueur (supabase/051) : l'onglet « Compte joueur » fait tout (donner / retirer l'accès, aperçu) ; ici, on y va.
                  account && {
                    label: 'Espace joueur',
                    icon: 'key',
                    hint: 'donner ou retirer l’accès, voir sa page',
                    onSelect: () => setTab('compte'),
                  },
                  // Plus de boutons en bas de « Profil » (30/10) : « Modifier » est en tête du ⋮, la fusion ici (administrateurs).
                  role === 'admin' &&
                    !merging &&
                    !mergeWith && {
                      label: 'Fusionner avec une autre fiche',
                      icon: 'users',
                      hint: 'doublon',
                      onSelect: () => (setMerging(true), (document.querySelector('.md-panel') ?? window).scrollTo({ top: 0, behavior: 'smooth' })),
                    },
                  can.deletePlayers(role) && { label: 'Supprimer la fiche', icon: 'trash', danger: true, onSelect: () => void del() },
                ]}
              />
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <PosBadges p={p} />
            {a !== null && <span>{a} ans</span>}
            <QuarterBadge birthDate={p.birthDate} />
            {/* « Mon équipe » (src/rencontres.ts) : « U15 · Équipe 1 · Régional ». */}
            {teamText && (
              <span title={p.usualTeam?.src === 'joueur' ? `Dit par ${g.leJoueur} depuis sa page` : 'Équipe en championnat'}>{teamText}</span>
            )}
          </div>
          <FollowedVia playerId={p.id} sex={p.sex} />
          <RewatchButton playerId={p.id} rows={rewatch.filter((r) => !r.done)} className="mt-1.5 px-2.5 py-1 text-[11px]" />
        </div>
      </div>

      {stampOpen && stamp && (
        <StampWindow stamp={stamp} title="Infos de la fiche" onClose={() => setStampOpen(false)} />
      )}

      {p.review && p.review !== 'validated' && (
        <div className={`rounded-lg border p-3 text-xs ${p.review === 'pending' ? 'border-amber-500/40 bg-amber-500/10' : 'border-line bg-panel'}`}>
          <div className="flex items-center justify-between gap-2">
            <ReviewBadge e={p} kind="players" />
            {p.createdByName && <span className="text-[10px] text-muted">Proposée par {p.createdByName}</span>}
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {p.review === 'pending'
              ? 'Fiche proposée par un observateur : à valider par un encadrant.'
              : `Fiche mise hors cadre : gardée pour mémoire, pour voir plus tard ce que ${g.leJoueur} est devenu${g.e}.`}{' '}
            {/* RGPD (supabase/012_expiration_rgpd.sql). */}
            {p.review === 'pending' && expiryDate(p.createdAtServer) && (
              <>Sans décision, elle sera effacée (avec ses avis) le {fmtDate(expiryDate(p.createdAtServer))}.</>
            )}
          </p>
          <ReviewNote e={p} />
          {can.reviewDept(role, department(p)) ? (
            <ReviewActions e={p} kind="players" compact={p.review === 'refused'} />
          ) : (
            can.review(role) && <p className="mt-1 text-[10px] text-muted">Hors de ton secteur : c’est au responsable du département de décider.</p>
          )}
        </div>
      )}
      {p.review === 'validated' && <ReviewNote e={p} />}

      {can.editPlayers(role) && !merging && !mergeWith && data.duplicates.length > 0 && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-xs">
          <b>Doublon possible :</b>{' '}
          {data.duplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <Link to={`/joueurs/${d.id}${sameTab}`} className="font-bold underline">
                {playerName(d)}
              </Link>
              {d.license ? ` (${w(d.sex).licencie})` : d.review === 'refused' ? ' (hors cadre)' : d.review === 'pending' ? ' (proposée)' : ''}{' '}
              {/* Fusion : administrateurs seulement (supabase/029) ; l'encadrant voit le doublon et le signale. */}
              {role === 'admin' ? (
                <button className="font-bold text-accent" onClick={() => setParams({ fusion: d.id }, { replace: true })}>
                  Comparer et fusionner
                </button>
              ) : (
                <span className="text-muted">(fusion : un administrateur)</span>
              )}
            </span>
          ))}
        </div>
      )}
      {role === 'admin' && (merging || mergeWith) && (
        <MergePlayers
          player={p}
          otherId={mergeWith ?? undefined}
          onClose={() => {
            setMerging(false)
            setParams({}, { replace: true })
          }}
        />
      )}

      <Tabs tab={view} setTab={setTab} counts={{ avis: evaluations.length, videos: data.videos }} hidden={account ? [] : ['compte']} />

      {view === 'profil' && (
        <>
        <PlayerGroups playerId={p.id} />
        <ScoutHistory playerId={p.id} sex={p.sex} />

        <div className="card divide-y divide-line">
          {info
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between px-4 py-2 text-xs">
                <span className="text-muted">{k}</span>
                <span className="font-bold">{v}</span>
              </div>
            ))}
        </div>

        <PoleCard player={p} />

        {(p.position || (p.secondaryPositions ?? []).length > 0) && (
          <div className="card p-4">
            <div className="section-title">Postes</div>
            <CourtView value={p.position} secondary={p.secondaryPositions} />
          </div>
        )}
        {p.gaps && (
          <div className="card p-4">
            <div className="section-title text-amber-300">Lacunes mobilité / souplesse</div>
            <div className="text-sm">{p.gaps}</div>
          </div>
        )}
        {p.notes && (
          <div className="card p-4">
            <div className="section-title">Notes</div>
            <div className="text-sm whitespace-pre-wrap">{p.notes}</div>
          </div>
        )}

        {/* Espace joueur (supabase/051, 052) : ce qu'il a écrit lui-même (si quelque chose), son journal du hand (tendance des
            humeurs, notes partagées). L'accès (compte, code, retrait, aperçu) : onglet « Compte joueur » (30/10). */}
        <SelfSection player={p} />
        <StaffJournal player={p} />

        {p.mergedFrom && p.mergedFrom.length > 0 && (
          <div className="card p-4">
            <div className="section-title">Fiches fondues dans celle-ci</div>
            <div className="flex flex-col gap-2 text-[11px]">
              {p.mergedFrom.map((m) => (
                <div key={m.id} className="rounded-md border border-line bg-panel-2 p-2">
                  <b>{m.name}</b>
                  {m.club && <span className="text-muted"> · {m.club}</span>}
                  {m.license && <span className="text-muted"> · licence {m.license}</span>}
                  <div className="text-[10px] text-muted">
                    {m.createdByName && <>Proposée par {m.createdByName}. </>}
                    {m.review === 'refused' && (
                      <span className="text-amber-200">
                        Mise hors cadre{m.reviewedByName && <> par {m.reviewedByName}</>}
                        {m.reviewedAt && <> le {fmtDate(dayOf(m.reviewedAt))}</>}
                        {m.reviewNote && <> : « {m.reviewNote} »</>}.{' '}
                      </span>
                    )}
                    Fusionnée le {fmtDate(dayOf(m.mergedAt))}
                    {m.mergedByName && <> par {m.mergedByName}</>}.
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </>
      )}

      {view === 'tests' && (
        <>
          {can.editMeasurements(role) && (
            <Link to={`/joueurs/${p.id}/mesures`} className="btn-primary">
              + Nouvelle séance de tests
            </Link>
          )}
        {/* Données factuelles */}
        {testGroups.map(([cat, cs]) => (
          <div key={cat} className="card p-4">
            <div className="section-title">{cat}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {cs.map((c) => (
                // Mesure sans courbe (texte, choix) : visée ici par ?voir=mesure:… ; avec courbe, c'est « Suivi des mesures ».
                <div key={c.id} data-voir={hasCurve(c) ? undefined : `mesure:${c.id}`} className="rounded-md">
                  <div className="text-[10px] text-muted">{c.label}</div>
                  <div className="text-sm font-extrabold">{fmtValue(c, latest.get(c.id)!.value)}</div>
                </div>
              ))}
              {cs.some((c) => c.id === 'sorensen') && <ShiradoRatio latest={latest} />}
            </div>
          </div>
        ))}
        <Tracking criteria={factual} measurements={measurements} editable={can.editMeasurements(role)} focus={focus?.kind === 'mesure' ? focus : undefined} />
        </>
      )}

      {/* Avis subjectifs ; « Donner un avis » ici = avis spontané (sur un événement : depuis l'événement). */}
      {view === 'avis' && (
        <Link to={`/evaluer?contexte=libre&joueur=${p.id}`} className="btn-primary">
          + Donner un avis
        </Link>
      )}
      {view === 'avis' && (
        <div className="card p-4" data-voir="avis:tous">
          <div className="mb-3 flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase">
            <span className="text-accent">★</span> Avis du staff
          </div>
          <Opinions player={p} criteria={subjective} evaluations={evaluations} events={events} focus={focus?.kind === 'avis' ? focus : undefined} />
        </div>
      )}

      {view === 'croissance' && <MaturityCard player={p} measurements={measurements} />}

      {/* Onglet à part depuis le 30/10 (avant : sous « Profil ») ; ?voir=video:… l'ouvre de lui-même. */}
      {view === 'videos' && <VideoSection kind="player" targetId={p.id} dept={department(p)} sex={p.sex} focus={focus?.kind === 'video' ? focus : undefined} />}

      {view === 'compte' && <PlayerSpaceCard player={p} />}
    </div>
  )
}

/** Carte « Espace joueur » de la fiche (src/components/PlayerSpace.tsx) : l'état de l'accès est lu ici, pour cette fiche. */
function PlayerSpaceCard({ player }: { player: Player }) {
  const access = usePlayerAccess(player)
  return <PlayerAccessCard player={player} access={access} />
}

/** Critère tracé dans « Suivi des mesures » (pas les textes ni les choix). */
const hasCurve = (c: Criterion) => c.scale !== 'text' && c.scale !== 'choice'

/**
 * Élément de la fiche visé par ?voir=… (`data-voir`) : dès qu'il est là (données lues, onglet ouvert, carte dépliée),
 * il vient à l'écran sous les onglets collés, puis est un instant mis en évidence.
 */
function useFocusScroll(focus: (PlayerFocus & { n: number }) | null) {
  useEffect(() => {
    if (!focus) return
    const sel = `[data-voir="${CSS.escape(focusAttr(focus))}"]`
    let tries = 0
    let hl: ReturnType<typeof setTimeout> | undefined
    const timer = setInterval(() => {
      const el = document.querySelector<HTMLElement>(sel)
      if (!el) {
        if (++tries > 60) clearInterval(timer)
        return
      }
      clearInterval(timer)
      // Sous les onglets collés : ceux de la fiche (sous l'en-tête de l'appli, ou en haut du panneau de droite).
      const tabs = document.querySelector<HTMLElement>('[data-fiche-onglets]')
      const box = el.closest<HTMLElement>('.md-panel')
      const margin = (tabs ? Math.max(0, parseFloat(tabs.style.top) || 0) + tabs.offsetHeight : 60) + 12
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const behavior: ScrollBehavior = smooth ? 'smooth' : 'auto'
      if (box) box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - box.getBoundingClientRect().top - margin, behavior })
      else window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - margin, behavior })
      el.classList.add('voir-hl')
      hl = setTimeout(() => el.classList.remove('voir-hl'), 2400)
    }, 50)
    return () => {
      clearInterval(timer)
      clearTimeout(hl)
    }
  }, [focus])
}

/**
 * « Suivi des mesures » : courbe d'évolution d'un critère factuel et historique (saisie : page Séance de tests).
 * `focus` (?voir=mesure:<critère>) : ce critère est choisi dans la liste.
 */
function Tracking({
  criteria,
  measurements,
  editable,
  focus,
}: {
  criteria: Criterion[]
  measurements: Measurement[]
  editable: boolean
  focus?: { id: string; row?: string; n: number }
}) {
  const withData = criteria.filter((c) => hasCurve(c) && measurements.some((m) => m.criterionId === c.id))
  const [cid, setCid] = useState<string>('')
  useEffect(() => {
    if (focus) setCid(focus.id)
  }, [focus])
  const current = withData.find((c) => c.id === cid) ?? withData[0]
  const series = useMemo(
    () =>
      measurements
        .filter((m) => m.criterionId === current?.id && typeof m.value === 'number')
        .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt),
    [measurements, current],
  )

  return (
    <div className="card p-4" data-voir={current ? `mesure:${current.id}` : undefined}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase">
          <span className="text-accent">↗</span> Suivi des mesures
        </div>
      </div>

      {!current ? (
        <div className="text-center text-xs text-muted">
          {measurements.some((m) => !criteria.some((c) => c.id === m.criterionId))
            ? 'Mesures enregistrées, mais leurs critères ne sont pas dans la base : un administrateur doit les importer.'
            : 'Aucune mesure enregistrée.'}
        </div>
      ) : (
        <>
          <select className="field mb-3" value={current.id} onChange={(e) => setCid(e.target.value)}>
            {withData.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
                {c.unit ? ` (${c.unit})` : ''}
              </option>
            ))}
          </select>
          {series.length > 1 ? (
            // Le doigt promène l'infobulle de la courbe : pas de glisser vers un autre joueur ici (useSwipeNav).
            <div className="h-48" data-noswipe>
              <ResponsiveContainer>
                <LineChart data={series.map((m) => ({ date: fmtDate(m.date).slice(0, 5) + '/' + m.date.slice(2, 4), v: m.value }))} margin={{ left: -18, right: 8, top: 8 }}>
                  <CartesianGrid stroke={themeColor('line')} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: themeColor('muted'), fontSize: 9 }} />
                  <YAxis domain={['auto', 'auto']} tick={{ fill: themeColor('muted'), fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: themeColor('panel'), border: `1px solid ${themeColor('line')}`, fontSize: 11 }} formatter={(v) => [fmtValue(current, v as number), current.label]} />
                  <Line type="monotone" dataKey="v" stroke={themeColor('accent')} strokeWidth={2} dot={{ r: 3, fill: themeColor('accent') }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-3 text-center text-[11px] text-muted">Une seule mesure : la courbe apparaîtra à la prochaine.</div>
          )}
          <div className="mt-2 divide-y divide-line">
            {[...series].reverse().map((m) => (
              // Mesure visée (?voir=mesure:<critère>:<mesure>, nouveauté de « Mes suivis ») : sa ligne reste marquée.
              <div key={m.id} className={`flex items-center justify-between py-1.5 text-xs ${focus?.row === m.id && current.id === focus.id ? '-mx-2 rounded-md bg-accent/10 px-2' : ''}`}>
                <span className="min-w-0">
                  <span className="font-bold">{fmtDate(m.date)}</span>
                  {m.note && <span className="ml-2 text-[11px] text-amber-200">« {m.note} »</span>}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span>{fmtValue(current, m.value)}</span>
                  {m.author && <span className="text-[10px] text-muted">{m.author}</span>}
                  {editable && (
                    <button
                      className="text-muted hover:text-red-400"
                      title="Supprimer cette mesure"
                      onClick={async () => (await ask('Supprimer cette mesure ?', { ok: 'Supprimer' })) && void remove('measurements', m.id)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Ratio Shirado / Sorensen, calculé à partir des dernières valeurs (norme 0,7–0,8 ; > 1 = déséquilibre). */
function ShiradoRatio({ latest }: { latest: Map<string, Measurement> }) {
  const a = latest.get('shirado')?.value
  const b = latest.get('sorensen')?.value
  if (typeof a !== 'number' || typeof b !== 'number' || !b) return null
  const r = a / b
  return (
    <div title="Norme : 0,7 à 0,8. Au-dessus de 1 : déséquilibre abdos / lombaires.">
      <div className="text-[10px] text-muted">Ratio Shirado / Sorensen</div>
      <div className={`text-sm font-extrabold ${r > 1 ? 'text-amber-300' : ''}`}>{r.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</div>
    </div>
  )
}

/** Pôle Espoirs : une ligne par période, la plus récente en haut (« Au pôle » ou « Sorti », dates, motif). */
function PoleCard({ player }: { player: Player }) {
  const today = new Date().toLocaleDateString('sv')
  const periods = (player.poles ?? []).filter((x) => x.from || x.to || x.regionId || x.site || x.name).sort((a, b) => (b.from ?? '').localeCompare(a.from ?? ''))
  if (!periods.length) return null
  const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '?')
  return (
    <div className="card p-4">
      <div className="section-title">Pôle Espoirs</div>
      <div className="flex flex-col gap-2">
        {periods.map((x, i) => {
          const now = (!x.from || x.from <= today) && (!x.to || x.to >= today)
          const why = POLE_EXITS.find((e) => e.value === x.exitReason)?.label
          return (
            <div key={i} className="flex items-start gap-3 rounded-md border border-line bg-panel-2 px-3 py-2">
              <span
                className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${now ? 'bg-emerald-500/15 text-emerald-300' : 'bg-panel text-muted'}`}
              >
                {now ? 'Au pôle' : 'Sorti'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold">{poleName(x, regionLabel)}</div>
                <div className="text-[11px] text-muted">
                  {x.to ? `${d(x.from)} → ${d(x.to)}` : `depuis le ${d(x.from)}`}
                  {x.to && why ? ` · ${why}` : ''}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
