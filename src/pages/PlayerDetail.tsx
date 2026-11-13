import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { PictoTabs } from '../components/PictoTabs'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackButton, useBack } from '../backNav'
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
import { CourtPicker, CourtView } from '../components/CourtPicker'
import { Avatar, fmtValue, Icon, playerName, PosBadges, QuarterBadge, Segmented, type IconName } from '../components/ui'
import { age, alive, criterionApplies, db, fmtDate, POLE_EXITS, poleName, lateralityLabel, remove, save, today, type Measurement, type Player, dayOf } from '../db'
import { teamSummary } from '../rencontres'
import { sportContent } from '../sportContent'
import { latestByPlayer } from './Players'
import { ask } from '../components/Confirm'
import { exportPlayer } from '../export'
import { can, useRole } from '../roles'
import { FollowButton, FollowedVia } from '../components/Follow'
import { VideoSection } from '../components/Videos'
import { PanelClose, usePanel } from '../components/MasterDetail'
import { HeaderMenu, PageHeader } from '../components/PageHeader'
import { copyLink } from '../components/ItemMenu'
import { RewatchButton, RewatchHistory, usePlayerRewatch } from '../components/Scouting'
import { ParcoursStrip, usePlayerParcours } from '../components/Parcours'
import { usePerimeter } from '../installation'
import { sexLabel, w } from '../gender'
import { spyTarget } from '../spy'
import { PLAYER_TAB_DEFAULT, PLAYER_TABS, playerTabParam, tabOf, withTab, type PlayerTab } from '../tabQuery'
import { canInvite, canPreviewPlayerPage, PlayerAccessCard, SelfSection, usePlayerAccess } from '../components/PlayerSpace'
import { StaffJournal } from '../components/PlayerJournal'
import { useReperes } from '../components/Medal'
import { FamilyReport } from '../components/FamilyReport'
import { AllTests } from '../components/AllTests'
import { ObjectivesCard } from '../components/Objectives'
import { SelfEvalStaff, usePlayerSelfEvals } from '../components/SelfEval'
import { PlayerWellnessTab, usePlayerWellnessGroups } from '../components/PlayerWellness'
import { FOCUS_KEY, FOCUS_TAB, focusAttr, parseFocus, withoutFocus, type PlayerFocus } from '../playerFocus'

// Mêmes identifiants que l'adresse (src/tabQuery.ts : PLAYER_TABS).
// Ordre choisi le 30/10 : Profil · Croissance · Tests · Vidéos · Avis · Compte joueur (vidéos et accès à l'espace joueur :
// onglets à part, plus dans « Profil » ; « Compte joueur » seulement pour qui peut s'en servir). « Wellness » (09/11) avant
// « Compte joueur » : seulement pour le staff qui le lit, fiche dans un groupe qui le demande (src/components/PlayerWellness.tsx).
const TABS: readonly { id: PlayerTab; label: string; icon: IconName }[] = [
  { id: 'profil', label: 'Profil', icon: 'user' },
  { id: 'croissance', label: 'Croissance', icon: 'growth' },
  { id: 'tests', label: 'Tests', icon: 'ruler' },
  { id: 'videos', label: 'Vidéos', icon: 'video' },
  { id: 'avis', label: 'Avis', icon: 'chat' },
  { id: 'wellness', label: 'Wellness', icon: 'heart' },
  { id: 'compte', label: 'Compte joueur', icon: 'key' },
]
type TabId = PlayerTab

/**
 * Onglets de la fiche, collés sous l'en-tête de l'appli quand on fait défiler (src/components/PictoTabs.tsx, mêmes onglets
 * que « Ma page » du jeune). `counts` : nombre d'avis, de vidéos. `hidden` : onglets absents (Compte joueur sans droit).
 */
function Tabs({ tab, setTab, counts, hidden }: { tab: TabId; setTab: (t: TabId) => void; counts: Partial<Record<TabId, number>>; hidden: TabId[] }) {
  return <PictoTabs tabs={TABS} tab={tab} setTab={setTab} counts={counts} hidden={hidden} />
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
  // Parcours par palier (src/parcours.ts) : frise sous le nom, sur téléphone comme sur ordinateur (choix du 31/10).
  const paliers = usePlayerParcours(data?.player) ?? []
  // Repères des tests (src/reperes.ts) : médailles dans l'onglet Tests et le bilan à imprimer.
  const reperes = useReperes()
  // « Bilan à imprimer » (menu ⋮) : fenêtre d'aperçu.
  const [printing, setPrinting] = useState(false)
  // « Son regard » (auto-évaluations du jeune, supabase/064) : lu à la demande, en ligne, quand l'onglet Avis est ouvert.
  const selfEvals = usePlayerSelfEvals(id!, tab === 'avis')
  // Onglet « Wellness » : groupes qui le demandent à cette fiche et dont ce compte lit le wellness (Pôle d'abord) ; aucun : pas d'onglet.
  const wellnessGroups = usePlayerWellnessGroups(id!)

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
    ['Taille de la mère', p.motherHeight !== undefined ? `${p.motherHeight} cm (${p.motherHeightSource === 'mesuree' ? 'mesurée' : 'déclarée'})` : undefined],
    ['Taille du père', p.fatherHeight !== undefined ? `${p.fatherHeight} cm (${p.fatherHeightSource === 'mesuree' ? 'mesurée' : 'déclarée'})` : undefined],
  ]

  async function del() {
    if (!(await ask(`Supprimer la fiche de ${playerName(p)} ?`, { ok: 'Supprimer' }))) return
    await remove('players', p.id)
    // L'écran d'où l'on vient (liste, événement, groupe…), dans le même état ; entrée directe : la liste des joueurs.
    leave.exit()
  }

  const stamp = stampOf(p)
  // Onglet « Compte joueur » (accès à l'espace joueur) : pour qui peut s'en servir ; sinon ?onglet=compte ouvre « Profil ».
  const account = canInvite(role, p) || canPreviewPlayerPage(role)
  const wellness = !!wellnessGroups?.length
  // ?onglet=wellness sans droit (ou fiche hors des groupes) : « Profil » ; pendant la lecture des groupes, rien (pas d'éclair de « Profil »).
  const view: TabId = (tab === 'compte' && !account) || (tab === 'wellness' && wellnessGroups && !wellness) ? 'profil' : tab
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
                  // Bilan pour la famille ou l'école (04/11) : page imprimable, faite sur l'appareil (rien n'est envoyé). Pour qui
                  // voit la fiche, « Voir comme… » compris (lecture seule n'empêche pas d'imprimer).
                  { label: 'Bilan à imprimer', icon: 'printer', hint: 'pour la famille ou l’école, en PDF', onSelect: () => setPrinting(true) },
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

      {/* Frise du parcours sous le nom, au-dessus des onglets ; un appui ouvre le détail là où l'on a appuyé. */}
      <ParcoursStrip paliers={paliers} />

      {printing && <FamilyReport player={p} criteria={factual} measurements={measurements} paliers={paliers} reperes={reperes} onClose={() => setPrinting(false)} />}

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

      <Tabs tab={view} setTab={setTab} counts={{ avis: evaluations.length, videos: data.videos }} hidden={[...(account ? [] : ['compte' as const]), ...(wellness || view === 'wellness' ? [] : ['wellness' as const])]} />

      {view === 'profil' && (
        <>
        <PlayerGroups playerId={p.id} />
        {/* « À revoir » (le reste de l'ancienne carte « Repérage » est dans le parcours). */}
        <RewatchHistory playerId={p.id} sex={p.sex} />

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

        <PosteCard player={p} canEdit={can.editPlayer(role, p)} />
        {/* Objectifs de travail (vague 2 « Génération Bleue ») : un encadrant qui peut modifier la fiche les fixe ici ; le jeune
            les voit sur sa page, le bilan à imprimer montre ceux en cours. */}
        <ObjectivesCard player={p} canEdit={can.editPlayers(role) && can.editPlayer(role, p)} />
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
            <Link to={`/joueurs/${p.id}/mesures`} className="btn-soft">
              + Nouvelle séance de tests
            </Link>
          )}
          {/* Tous ses tests (src/components/AllTests.tsx, la même vue que « Mes tests » de sa page) : par famille, courbe et
              mesures datées d'un test ouvert (modifier, supprimer : qui peut saisir). */}
          <AllTests
            player={p}
            criteria={factual}
            measurements={measurements}
            reperes={reperes}
            staff
            editable={can.editMeasurements(role)}
            focus={focus?.kind === 'mesure' ? focus : undefined}
            familyExtra={(_, ls) => (ls.some((l) => l.c.id === 'sorensen') ? <ShiradoRatio latest={latest} /> : null)}
            empty={
              <div className="card p-4 text-center text-xs text-muted">
                {measurements.some((m) => !m.deleted && !criteria.some((c) => c.id === m.criterionId))
                  ? 'Mesures enregistrées, mais leurs critères ne sont pas dans la base : un administrateur doit les importer.'
                  : 'Aucune mesure enregistrée.'}
              </div>
            }
          />
        </>
      )}

      {/* Avis subjectifs ; « Donner un avis » ici = avis spontané (sur un événement : depuis l'événement). */}
      {view === 'avis' && (
        <Link to={`/evaluer?contexte=libre&joueur=${p.id}`} className="btn-soft">
          + Donner un avis
        </Link>
      )}
      {view === 'avis' && (
        <div className="card p-4" data-voir="avis:tous">
          <div className="mb-3 flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase">
            <span className="text-accent">★</span> Avis du staff
          </div>
          <Opinions player={p} criteria={subjective} evaluations={evaluations} events={events} focus={focus?.kind === 'avis' ? focus : undefined} selfEvals={selfEvals ?? undefined} />
        </div>
      )}
      {/* « Son regard » : ce que le jeune écrit après un événement (064), à part des avis, jamais compté dans les chiffres. */}
      {view === 'avis' && <SelfEvalStaff player={p} list={selfEvals} events={events} />}

      {view === 'croissance' && <MaturityCard player={p} measurements={measurements} />}

      {/* Onglet à part depuis le 30/10 (avant : sous « Profil ») ; ?voir=video:… l'ouvre de lui-même. */}
      {view === 'videos' && <VideoSection kind="player" targetId={p.id} dept={department(p)} sex={p.sex} focus={focus?.kind === 'video' ? focus : undefined} />}

      {view === 'compte' && <PlayerSpaceCard player={p} />}

      {view === 'wellness' && (wellnessGroups ? wellness && <PlayerWellnessTab player={p} groups={wellnessGroups} /> : <div className="py-10 text-center text-sm text-muted">Chargement…</div>)}
    </div>
  )
}

/**
 * Carte « Poste et latéralité » de l'onglet Profil, modifiable sur place (31/10, demande de Geoffroy et Stef : plus besoin de
 * ⋮ → Modifier la fiche → Profil sportif) : le crayon ouvre le terrain du formulaire (CourtPicker) et Droitier / Gaucher /
 * Ambidextre ; chaque toucher est enregistré tout de suite, « Terminé » referme. Sans poste ni latéralité : la carte ne
 * paraît que pour qui peut les renseigner.
 */
function PosteCard({ player: p, canEdit }: { player: Player; canEdit: boolean }) {
  // Brouillon pendant la modification : chaque toucher ne change que l'écran (immédiat, même sur téléphone) ;
  // la fiche n'est écrite sur l'appareil, puis envoyée au serveur, qu'une fois, avec « Terminé ».
  const [draft, setDraft] = useState<Pick<Player, 'position' | 'secondaryPositions' | 'laterality'> | null>(null)
  const hasPos = !!p.position || (p.secondaryPositions ?? []).length > 0
  if (!hasPos && !p.laterality && !canEdit) return null
  const finish = () => {
    if (draft && (draft.position !== p.position || draft.laterality !== p.laterality || (draft.secondaryPositions ?? []).join() !== (p.secondaryPositions ?? []).join()))
      void save<Player>('players', { ...p, ...draft })
    setDraft(null)
  }
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="section-title mb-0">Poste et latéralité</div>
        {canEdit &&
          (draft ? (
            <div className="flex items-center gap-4">
              <button className="text-xs font-bold text-muted" onClick={() => setDraft(null)}>
                Annuler
              </button>
              <button className="text-xs font-bold text-accent" onClick={finish}>
                Terminé
              </button>
            </div>
          ) : (
            <button
              className="-m-1.5 flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg"
              aria-label="Modifier le poste et la latéralité"
              title="Modifier le poste et la latéralité"
              onClick={() => setDraft({ position: p.position, secondaryPositions: p.secondaryPositions, laterality: p.laterality })}
            >
              <Icon name="pencil" className="h-4 w-4" />
            </button>
          ))}
      </div>
      {draft ? (
        <div className="flex flex-col gap-3">
          <CourtPicker
            value={draft.position}
            secondary={draft.secondaryPositions}
            onChange={(pos, sec) => setDraft({ ...draft, position: pos, secondaryPositions: sec.length ? sec : undefined })}
          />
          <Segmented
            value={draft.laterality}
            onChange={(v) => setDraft({ ...draft, laterality: v })}
            options={[
              { value: 'droitier', label: lateralityLabel('droitier', p.sex) },
              { value: 'gaucher', label: lateralityLabel('gaucher', p.sex) },
              { value: 'ambidextre', label: 'Ambidextre' },
            ]}
          />
        </div>
      ) : (
        <>
          {hasPos ? <CourtView value={p.position} secondary={p.secondaryPositions} /> : <p className="text-center text-xs text-muted">Pas encore de poste.</p>}
          <p className="mt-1 text-center text-xs font-bold">{p.laterality ? lateralityLabel(p.laterality, p.sex) : <span className="font-normal text-muted">Latéralité à renseigner</span>}</p>
        </>
      )}
    </div>
  )
}

/** Carte « Espace joueur » de la fiche (src/components/PlayerSpace.tsx) : l'état de l'accès est lu ici, pour cette fiche. */
function PlayerSpaceCard({ player }: { player: Player }) {
  const access = usePlayerAccess(player)
  return <PlayerAccessCard player={player} access={access} />
}

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

/** Ratio Shirado / Sorensen, calculé à partir des dernières valeurs (norme 0,7–0,8 ; > 1 = déséquilibre). */
function ShiradoRatio({ latest }: { latest: Map<string, Measurement> }) {
  const a = latest.get('shirado')?.value
  const b = latest.get('sorensen')?.value
  if (typeof a !== 'number' || typeof b !== 'number' || !b) return null
  const r = a / b
  return (
    // Pied du bloc de la famille du Sorensen (onglet Tests, trait pointillé au-dessus), staff seulement.
    <div className="flex items-center justify-between gap-3 border-t border-dashed border-line px-3.5 py-2" title="Norme : 0,7 à 0,8. Au-dessus de 1 : déséquilibre abdos / lombaires.">
      <span className="text-xs text-muted">Ratio Shirado / Sorensen</span>
      <span className={`text-[13px] font-extrabold tabular-nums ${r > 1 ? 'text-amber-300' : ''}`}>{r.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</span>
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
