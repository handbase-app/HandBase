import { StickyQuery } from '../components/StickyQuery'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackButton, useBack, useOrigin } from '../backNav'
import { StampLine } from '../components/ActivityLog'
import { ask } from '../components/Confirm'
import { addToGroup, removeFromGroup } from '../components/Groups'
import { arrowNav, showGroupInPlayers, useSessionState } from '../components/PlayerFilter'
import { FoldSection } from '../components/FoldSection'
import { foldKey, startsOpen } from '../fold'
import { departmentChoices, departmentLabel } from '../lists'
import { Empty, Icon, Segmented } from '../components/ui'
import { alive, db, GROUP_SCOPES, newId, remove, save, saveMany, type GroupScope, type Player, type PlayerGroup } from '../db'
import { accord, genderOf, pluralG, setGender, SEX_CHOICES, SEX_LABELS, w, type Gender } from '../gender'
import { regionOfDept, useRegionName, useRegions } from '../lists'
import { exportCsv } from '../export'
import { can, currentUserId, groupVisibility, useRole, type GroupVisibility } from '../roles'
import { loadTeams } from '../teams'
import { StaffPicker, useCanPickStaff } from '../components/StaffPicker'
import { Participants } from '../components/Participants'
import { GROUP_VIS, STAFF, TEAM_FOLLOW } from '../staffLabels'
import { sportContent } from '../sportContent'
import { participantSummary, useTeams } from '../teams'
import type { Team, Unit } from '../db'
import { AddPlayers } from './Events'
import { FollowButton, FollowStar } from '../components/Follow'
import { GroupRewatchLine, RewatchToggle, useGroupRewatch } from '../components/Scouting'
import { PlayerRow } from '../components/PlayerRow'
import { PlayerList } from '../components/Pictos'
import { HiddenPlayers } from '../components/HiddenPlayers'
import { hiddenCount } from '../perimeter'
import { PlayerMenuScope, type MenuExtra } from '../components/PlayerMenu'
import { copyLink, ItemMenu, MENU_ROW, MenuButton, useRowMenu, type MenuItem } from '../components/ItemMenu'
import type { Role } from '../roles'
import { rememberScroll, useRestoreScroll } from '../components/ContextRoster'
import { groupRosterKey, positionRosterView, useRosterFilter, useRosterSort } from '../rosterOrder'
import { AskFilterBanner, useAskListFilter } from '../components/AskAction'
import { RosterControls, RosterSectionList, rosterBarLead } from '../components/PositionRoster'
import { teamFollowed } from '../follows'
import { PanelClose, selectedCls, usePanel, useSelected } from '../components/MasterDetail'
import { MQ, useMedia } from '../layout'
import { CompareBar, CompareToggle, PickBox, useComparePick } from '../components/ComparePick'
import { canTransferGroup, TransferGroup } from '../components/TransferGroup'
import { OtherGroupDetail, OtherGroupsSection, useAllGroups } from '../components/AdminGroups'
import { useGroupsQuery } from '../components/GroupsQuery'
import { BarActions, BelowBar, MoreActions, PageHeader } from '../components/PageHeader'
import { afterWindow, FormActions, FormWindow } from '../components/FormWindow'
import { WorkGroupDetail, WorkGroupsTab } from './Teams'
import { CapsuleTabs } from '../components/CapsuleTabs'
import { Demander, postAsk } from '../components/Demander'
import { BulkBar } from '../components/Selection'
import { toggleId } from '../selection'
import { archiveMode, bulkConfirm, groupPickBlock, pickedLabel, pickedOf, workGroupMatches, workGroupPickBlock, type BulkAction } from '../groupPick'
import { choose } from '../components/Confirm'
import {
  createPoleGroup,
  cancelArrivalOne,
  ExitReasonDialog,
  fmtDay,
  fmtLongDay,
  joinMessage,
  askArrival,
  joinPoleMany,
  leavePoleOne,
  PoleChip,
  programmeLabel,
  usePoleCount,
  usePoleGroups,
  usePoleLeader,
  usePoleMembers,
  usePoleRef,
  usePoleRefs,
  upcomingArrival,
  VIEW_OPTIONS,
  type PoleMembers,
} from '../components/PoleGroup'
import { exportGaps, periodIndexAt, seasonStatus, seasonStatusLabel, type PoleRef, type PoleView } from '../poleSeason'
import { poleViewOf, withPoleView } from '../tabQuery'

/** Onglets de la page Groupes (?onglet=travail ; groupes de joueurs par défaut, sans paramètre). */
type GroupsTab = 'joueurs' | typeof STAFF.tab
const groupsTabPath = (t: GroupsTab) => (t === STAFF.tab ? STAFF.tabRoute : '/groupes')

/**
 * Page Groupes : onglets « Groupes de joueurs » (Intercomités, Pôle, Sport-études…) et « Groupes de travail » (ex-staffs).
 * Même tête dans les deux onglets, rien ne bouge en passant de l'un à l'autre : le titre, la barre « Demander » (avec son
 * « ⋯ ») collée en haut au défilement, les onglets en capsule juste dessous (à la largeur de la barre), puis la liste.
 */
export default function Groups() {
  const role = useRole()
  const nav = useNavigate()
  const loc = useLocation()
  const [params] = useSearchParams()
  // Onglet dans l'adresse : « Retour » depuis un groupe ouvert ramène sur le même onglet, et un lien partagé l'ouvre.
  const tab: GroupsTab = params.get('onglet') === STAFF.tab ? STAFF.tab : 'joueurs'
  const bar = useMedia(MQ.side)
  const [creatingTeam, setCreatingTeam] = useState(false)
  // « Ajouter un groupe de joueurs » : fenêtre « Nouveau groupe » par-dessus la liste. Ouverte aussi par l'adresse
  // /groupes/nouveau (avec les joueurs choisis ailleurs, ex. la sélection de la liste Joueurs) : devenue ?nouveau=1, retirée
  // de l'adresse avant l'ouverture (un retour ne la rouvre pas) ; Annuler y ramène alors à l'écran d'origine.
  const [newGroup, setNewGroup] = useState<{ playerIds: string[]; fromUrl: boolean } | null>(null)
  const leave = useBack('/groupes', 'GROUPES')
  const wantNew = params.has('nouveau')
  useEffect(() => {
    if (!wantNew) return
    const playerIds = (loc.state as { playerIds?: string[] } | null)?.playerIds ?? []
    const next = new URLSearchParams(params)
    next.delete('nouveau')
    const q = next.toString()
    nav({ pathname: loc.pathname, search: q ? `?${q}` : '' }, { replace: true })
    if (can.manageGroups(role)) setNewGroup({ playerIds, fromUrl: true })
  }, [wantNew]) // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useLiveQuery(() => loadTeams().then(() => db.groups.orderBy('name').toArray().then((gs) => alive(gs).filter(can.seeGroup))))
  const teams = useTeams() ?? []
  // Filtres = recette « groupes » (même expérience que les listes Joueurs et Événements) : champ « Filtrer ou poser une
  // question… », micro ✨, pastilles, panneau Filtres, calcul sur la sélection ; gardés pendant la session.
  const { filtered: shown, active: filtering, ui: filterUi, top: filterTop } = useGroupsQuery(groups)
  // Onglet « Groupes de travail » : la même barre « Demander », en simple recherche sur l'appareil (nom, description,
  // créateur, membres : src/groupPick.ts), sans appel ni filtre. Chaque onglet garde son propre texte pendant la session
  // (celui des groupes de joueurs est celui de leur recette) : on retrouve chaque liste comme on l'a laissée.
  const [workText, setWorkText] = useSessionState('handbase.groupes.travail.texte', '')
  // Sélection de plusieurs groupes (« ⋯ » → « Sélectionner… ») : propre à l'onglet où elle a commencé.
  const [picking, setPicking] = useState<{ tab: GroupsTab; ids: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const pickOn = !!picking && picking.tab === tab
  // Échap quitte la sélection ; pas dans un champ ni dans une fenêtre (ils gèrent leur Échap), et avant le panneau de droite.
  useEffect(() => {
    if (!pickOn) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[aria-modal="true"], .fixed.inset-0')) return
      if ((e.target as HTMLElement).closest?.('input:not([type=checkbox]), textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      setPicking(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pickOn])
  // Groupes Pôle (src/poleSeason.ts) : épinglés en tête ; unités Pôle que je dirige sans groupe : une tuile pour le créer.
  const leader = usePoleLeader()
  const refs = usePoleRefs()
  const poleGroups = usePoleGroups()
  if (!groups) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const pinned = shown.filter((g) => !!g.poleUnitId && !g.archived)
  const active = shown.filter((g) => !g.archived && !g.poleUnitId)
  const archived = shown.filter((g) => g.archived)
  const toCreate = filtering ? [] : leader.units.filter((u) => !poleGroups.some((g) => g.poleUnitId === u.id))
  const work = tab === STAFF.tab
  const shownTeams = workText.trim() ? teams.filter((t) => workGroupMatches(t, workText)) : teams

  // Sélection : mêmes droits que le menu d'un groupe (src/groupPick.ts) ; l'action porte sur les groupes cochés encore
  // affichés et cochables.
  const groupWhy = (g: PlayerGroup) => groupPickBlock(g, can.editGroup(role, g))
  const teamWhy = (t: Team) => workGroupPickBlock(can.editTeam(t))
  const ids = pickOn ? picking.ids : []
  const idSet = new Set(ids)
  const pickedGroups = work ? [] : pickedOf(ids, shown, groupWhy)
  const pickedTeams = work ? pickedOf(ids, shownTeams, teamWhy) : []
  const nPicked = work ? pickedTeams.length : pickedGroups.length
  const canPick = work ? teams.some((t) => !teamWhy(t)) : groups.some((g) => !groupWhy(g))
  const toggle = (id: string) => setPicking((p) => (p ? { ...p, ids: toggleId(p.ids, id) } : p))
  const rowPick = (g: PlayerGroup) => (pickOn ? { checked: idSet.has(g.id), why: groupWhy(g), toggle: () => toggle(g.id) } : undefined)

  /** Archiver, désarchiver ou supprimer les groupes cochés, après confirmation ; la sélection se ferme ensuite. */
  async function runBulk(action: BulkAction) {
    const list = work ? pickedTeams : pickedGroups
    if (!list.length || busy) return
    const c = bulkConfirm(work ? 'travail' : 'joueurs', action, list)
    if (!(await ask(c.message, { ok: c.ok, danger: action === 'delete', focusCancel: action === 'delete' }))) return
    setBusy(true)
    try {
      if (work) for (const t of pickedTeams) await remove('teams', t.id)
      else if (action === 'delete') for (const g of pickedGroups) await remove('groups', g.id)
      else await saveMany<PlayerGroup>('groups', pickedGroups.map((g) => ({ ...g, archived: action === 'archive' })))
      // Le groupe ouvert à droite vient d'être supprimé : la liste seule (comme la suppression d'un groupe).
      const open = /^\/groupes\/([^/]+)$/.exec(loc.pathname)?.[1]
      if (action === 'delete' && open && list.some((x) => x.id === open)) nav(groupsTabPath(tab), { replace: true })
      setPicking(null)
    } finally {
      setBusy(false)
    }
  }

  // Changer d'onglet remplace l'adresse (comme les onglets d'un événement) ; un groupe ouvert à droite se ferme, la
  // sélection aussi.
  const setTab = (t: GroupsTab) => {
    if (t === tab) return
    setCreatingTeam(false)
    setPicking(null)
    nav(groupsTabPath(t), { replace: true, state: loc.pathname === '/groupes' ? loc.state : undefined })
  }
  // Onglets en capsule (même composant que les onglets d'un événement), juste sous la barre et à sa largeur.
  const tabs = (
    <CapsuleTabs
      label="Type de groupes"
      value={tab}
      onChange={setTab}
      compact={bar}
      className="w-full"
      items={[
        { value: 'joueurs', label: `${STAFF.tabPlayers} (${groups.filter((g) => !g.archived).length})` },
        { value: STAFF.tab, label: `${STAFF.tabWork} (${teams.length})` },
      ]}
    />
  )
  // Groupes de joueurs, liste vide : le bouton de création à côté du titre, en plus du « ⋯ ».
  const addButton = !work && can.manageGroups(role) && !groups.length && (
    <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setNewGroup({ playerIds: [], fromUrl: false })}>
      + Groupe
    </button>
  )
  // « ⋯ » au bout de la barre : créer (selon l'onglet), puis « Sélectionner… » s'il y a des groupes que je peux archiver
  // ou supprimer.
  const pickItem: MenuItem | false = canPick && {
    label: pickOn ? 'Quitter la sélection' : 'Sélectionner…',
    icon: 'select',
    hint: pickOn ? undefined : work ? 'Supprimer plusieurs groupes de travail' : 'Archiver ou supprimer plusieurs groupes',
    onSelect: () => setPicking(pickOn ? null : { tab, ids: [] }),
  }
  const actions = work ? (
    <MoreActions
      title={STAFF.tabWork}
      items={[can.manageTeams(role) && !creatingTeam && { label: STAFF.add, icon: 'users', onSelect: () => setCreatingTeam(true) }, pickItem]}
    />
  ) : (
    <MoreActions
      title={STAFF.tabPlayers}
      items={[can.manageGroups(role) && { label: 'Ajouter un groupe de joueurs', icon: 'users', onSelect: () => setNewGroup({ playerIds: [], fromUrl: false }) }, pickItem]}
    />
  )
  const archiveAction = archiveMode(pickedGroups)
  const bulkActions: Parameters<typeof BulkBar>[0]['actions'] = [
    ...(work
      ? []
      : [{ key: 'archive', label: archiveAction === 'archive' ? 'Archiver' : 'Désarchiver', icon: 'archive' as const, disabled: busy || !nPicked, onRun: () => void runBulk(archiveAction) }]),
    { key: 'delete', label: 'Supprimer', icon: 'trash', disabled: busy || !nPicked, onRun: () => void runBulk('delete') },
  ]

  return (
    <div className="flex flex-col gap-3">
      {/* Titre pour les lecteurs d'écran seulement : l'onglet du menu, en surbrillance, dit déjà où l'on est (30/10). Aucun
          groupe : le bouton de création, seul en haut. */}
      <h1 className="sr-only">Groupes</h1>
      {addButton && <div className="self-start">{addButton}</div>}
      {newGroup && (
        <NewGroupWindow
          playerIds={newGroup.playerIds}
          onClose={(created) => {
            setNewGroup(null)
            if (!created && newGroup.fromUrl) afterWindow(leave.exit)
          }}
        />
      )}
      {work ? (
        <>
          {/* Même barre, même place que l'onglet des groupes de joueurs (colonne de useListQuery, src/components/ListQuery.tsx). */}
          <StickyQuery>
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
              <div className="flex items-center gap-2">
                <Demander
                  page="groupes"
                  value={workText}
                  onChange={setWorkText}
                  onSubmit={(t) => {
                    // Entrée : la liste est déjà filtrée. Une demande de l'historique « Groupes » (une phrase sur les groupes de
                    // joueurs) repart sur leur onglet, comme depuis une autre page.
                    if (t === workText) return
                    setWorkText(workText)
                    setTab('joueurs')
                    postAsk({ page: 'groupes', phrase: t })
                  }}
                  canAsk={false}
                  nameMode
                  placeholder="Un groupe, un encadrant…"
                  hint="Le nom d’un groupe de travail ou d’un encadrant"
                  label="Rechercher un groupe de travail"
                />
                {actions}
              </div>
              <BelowBar actions={actions}>{tabs}</BelowBar>
            </div>
          </StickyQuery>
          <WorkGroupsTab
            teams={shownTeams}
            total={teams.length}
            creating={creatingTeam}
            onCreated={() => setCreatingTeam(false)}
            pick={pickOn ? { has: (id) => idSet.has(id), why: teamWhy, toggle } : undefined}
          />
        </>
      ) : (
        <>
      <StickyQuery>
        <BarActions actions={actions} below={tabs}>
          {filterUi}
        </BarActions>
      </StickyQuery>
      {filterTop}
      {!active.length && filtering && (
        // « Archivés » est replié au départ : on dit où sont les groupes qui répondent.
        <Empty>{archived.length ? `Aucun groupe en cours ne correspond ; ${archived.length > 1 ? `${archived.length} dans « Archivés »` : '1 dans « Archivés »'}.` : 'Aucun groupe ne correspond.'}</Empty>
      )}
      {!groups.length && !toCreate.length && (
        <Empty>{can.manageGroups(role) ? 'Aucun groupe pour l’instant. Crée le premier avec « + Groupe ».' : 'Aucun groupe pour l’instant.'}</Empty>
      )}
      {/* Groupes de groupes repliables (src/components/FoldSection.tsx) : dépliés au départ, sauf « Archivés » ; le choix
          est gardé pendant la session. Filtre actif : le titre compte les groupes de la section qui répondent. */}
      {(pinned.length > 0 || toCreate.length > 0) && (
        <FoldSection
          storeKey={foldKey('groupes', 'poles')}
          defaultOpen={startsOpen('current')}
          icon={<Icon name="target" className="h-3.5 w-3.5" />}
          title="Pôles Espoirs"
          count={pinned.length}
        >
          <div className="cols flex flex-col gap-3">
            {pinned.map((g) => (
              <GroupRow key={g.id} g={g} teams={teams} pick={rowPick(g)} />
            ))}
            <PoleCreateTiles units={toCreate} onCreate={async (u) => nav(`/groupes/${(await createPoleGroup(u, refs.get(u.id) ?? null)).id}`)} />
          </div>
        </FoldSection>
      )}
      {SECTIONS.map((sec) => {
        const list = active.filter((g) => groupVisibility(g) === sec.vis)
        return (
          list.length > 0 && (
            <FoldSection
              key={sec.vis}
              storeKey={foldKey('groupes', sec.vis)}
              defaultOpen={startsOpen('current')}
              icon={<Icon name={sec.icon} className="h-3.5 w-3.5" />}
              title={sec.title}
              count={list.length}
            >
              <div className="cols flex flex-col gap-3">
                {list.map((g) => (
                  <GroupRow key={g.id} g={g} teams={teams} pick={rowPick(g)} />
                ))}
              </div>
            </FoldSection>
          )
        )
      })}
      <OtherGroupsSection role={role} info={groupInfo} />
      {archived.length > 0 && (
        // Même clé de session qu'avant (« Voir les groupes archivés ») : le choix déjà fait reste.
        <FoldSection
          storeKey="handbase.groupes.archived"
          defaultOpen={startsOpen('archived')}
          icon={<Icon name="archive" className="h-3.5 w-3.5" />}
          title="Archivés"
          count={archived.length}
          muted
          className="mt-2"
        >
          <div className="cols flex flex-col gap-3">
            {archived.map((g) => (
              <GroupRow key={g.id} g={g} teams={teams} pick={rowPick(g)} />
            ))}
          </div>
        </FoldSection>
      )}
        </>
      )}
      {pickOn && <BulkBar label={pickedLabel(work ? 'travail' : 'joueurs', nPicked)} actions={bulkActions} onCancel={() => setPicking(null)} />}
    </div>
  )
}

/** Sections de la liste, une par visibilité. */
const SECTIONS = [
  { vis: 'private', icon: 'lock', title: GROUP_VIS.section.private },
  { vis: 'team', icon: 'users', title: GROUP_VIS.section.team },
  { vis: 'staff', icon: 'globe', title: GROUP_VIS.section.staff },
] as const

/** Pastille « Mon staff » (team) : groupe visible par son créateur et ses participants seulement. */
/** Sans accents ni majuscules, pour chercher un pôle par son nom. */
const foldName = (s = '') => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/**
 * Tuiles « Créer le groupe Pôle de … » (unités Pôle que je dirige sans groupe). Jusqu'à deux : une tuile par pôle. Au-delà
 * (un administrateur voit tous les pôles de la structure) : une seule tuile qui s'ouvre sur une liste avec un champ de
 * recherche, pour ne pas noyer la page sous cinquante tuiles.
 */
function PoleCreateTiles({ units, onCreate }: { units: Unit[]; onCreate: (u: Unit) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  if (!units.length) return null
  const tile = (u: Unit, compact = false) => (
    <button key={u.id} type="button" className={`card flex items-center gap-3 text-left hover:border-accent ${compact ? 'p-2' : 'p-3'}`} onClick={() => onCreate(u)}>
      <Icon name="userPlus" className="h-4 w-4 shrink-0 text-accent" />
      <span className="min-w-0">
        <span className="block text-sm font-bold">{compact ? u.name : `Créer le groupe Pôle de ${u.name}`}</span>
        {!compact && (
          <span className="block text-[11px] text-muted">Membres calculés depuis les périodes de pôle des fiches ; saison en cours et saison prochaine ; changement de saison.</span>
        )}
      </span>
    </button>
  )
  if (units.length <= 2) return <>{units.map((u) => tile(u))}</>
  const hits = q.trim() ? units.filter((u) => foldName(u.name).includes(foldName(q.trim()))) : units
  return (
    <div className="card flex flex-col gap-2 p-3">
      <button type="button" className="flex items-center gap-3 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="userPlus" className="h-4 w-4 shrink-0 text-accent" />
        <span className="min-w-0">
          <span className="block text-sm font-bold">Créer un groupe Pôle…</span>
          <span className="block text-[11px] text-muted">
            {units.length} pôles de la structure sans groupe. Membres calculés depuis les périodes de pôle des fiches ; saison en cours et saison prochaine ; changement de saison.
          </span>
        </span>
      </button>
      {open && (
        <>
          <input className="field text-sm" placeholder="Chercher un pôle (ville, filles, garçons)…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Chercher un pôle" />
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {hits.slice(0, 30).map((u) => tile(u, true))}
            {!hits.length && <p className="text-xs text-muted">Aucun pôle ne correspond.</p>}
            {hits.length > 30 && <p className="text-xs text-muted">… et {hits.length - 30} de plus : précise la recherche.</p>}
          </div>
        </>
      )}
    </div>
  )
}

function TeamChip() {
  return (
    <span
      title={GROUP_VIS.chipTitle}
      className="ml-2 inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line px-1.5 align-[1px] text-[10px] font-bold text-muted"
    >
      <Icon name="users" className="h-2.5 w-2.5" /> {GROUP_VIS.chip}
    </span>
  )
}

/** Pastille « Suivi par le staff » (teamFollow) : le groupe compte comme suivi pour son créateur et ses participants. */
function TeamFollowChip() {
  return (
    <span
      title={TEAM_FOLLOW.chipTitle}
      className="ml-2 inline-flex shrink-0 items-center gap-0.5 rounded-full border border-accent/50 px-1.5 align-[1px] text-[10px] font-bold text-muted"
    >
      <Icon name="star" filled className="h-2.5 w-2.5 text-accent" /> {TEAM_FOLLOW.label}
    </span>
  )
}

/** Copier le groupe et ses joueurs (ex. le pôle de la saison suivante) ; renvoie la copie, à ajuster. */
function duplicateGroup(g: PlayerGroup, role: Role) {
  return save<PlayerGroup>('groups', {
    ...stripStamps(g),
    id: newId(),
    name: `${g.name} (copie)`,
    archived: undefined,
    // L'observateur ne crée que des groupes privés.
    private: can.publicGroups(role) ? g.private : true,
    team: can.publicGroups(role) ? g.team : undefined,
    teams: can.publicGroups(role) ? g.teams : undefined,
    // La copie est à moi : je ne suis pas mon propre participant.
    editors: can.publicGroups(role) ? g.editors?.filter((u) => u !== currentUserId()) : [],
  })
}

/** Supprimer un groupe, après confirmation (joueurs, avis et événements ne sont pas touchés). Renvoie true si supprimé. */
async function deleteGroup(g: PlayerGroup) {
  const n = g.playerIds.length
  const who = n > 1 ? `Ses ${pluralG(n, g.sex)} gardent leur fiche` : n ? (g.sex === 'F' ? 'Sa joueuse garde sa fiche' : 'Son joueur garde sa fiche') : ''
  const msg = `Supprimer le groupe « ${g.name} » ? ${who ? `${who} ; les` : 'Les'} avis et les événements ne sont pas touchés.`
  if (!(await ask(msg, { ok: 'Supprimer', focusCancel: true }))) return false
  await remove('groups', g.id)
  return true
}

/** Menu d'une ligne de groupe (appui long, clic droit, « ⋮ ») : seulement ce que les droits permettent. */
function GroupMenu({ g, menu, count }: { g: PlayerGroup; menu: ReturnType<typeof useRowMenu>; count: number }) {
  const role = useRole()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const leader = usePoleLeader()
  if (!menu.anchor) return null
  // Groupe Pôle : ses dirigeants le gèrent ; ni dupliqué ni archivé (permanent, un seul par unité).
  const pole = !!g.poleUnitId
  const leads = pole && leader.leads(g.poleUnitId!)
  const manage = can.editGroup(role, g) || leads
  const items: (MenuItem | false)[] = [
    { label: 'Ouvrir', icon: 'users', onSelect: () => nav(`/groupes/${g.id}`) },
    (pole ? leads : manage || can.contributeGroup(role, g)) && { label: `Ajouter des ${w(g.sex).joueurs}`, icon: 'userPlus', onSelect: () => nav(`/groupes/${g.id}?ajout=1`) },
    pole && leads && { label: 'Changement de saison', icon: 'calendar', onSelect: () => nav(`/groupes/${g.id}/saison`) },
    manage && { label: 'Renommer / Modifier', icon: 'pencil', onSelect: () => nav(`/groupes/${g.id}?modifier=1`) },
    !pole && { label: 'Dupliquer', icon: 'list', hint: `avec ses ${w(g.sex).joueurs}`, onSelect: async () => nav(`/groupes/${(await duplicateGroup(g, role)).id}?modifier=copie`) },
    { label: 'Exporter en PDF', icon: 'download', hint: 'à imprimer', onSelect: () => nav(`/groupes/${g.id}/rapport`) },
    !pole && manage && { label: g.archived ? 'Désarchiver' : 'Archiver', icon: 'archive', onSelect: () => void save<PlayerGroup>('groups', { ...g, archived: !g.archived }) },
    { label: 'Copier le lien', icon: 'copy', onSelect: () => copyLink(`/groupes/${g.id}`) },
    manage && {
      label: 'Supprimer',
      icon: 'trash',
      danger: true,
      onSelect: async () => {
        if ((await deleteGroup(g)) && pathname.startsWith(`/groupes/${g.id}`)) nav('/groupes', { replace: true })
      },
    },
  ]
  return (
    <ItemMenu
      anchor={menu.anchor}
      title={g.name}
      subtitle={`${pluralG(count, g.sex)}${g.archived ? ' · archivé' : ''}`}
      items={items.filter((x): x is MenuItem => !!x)}
      onClose={menu.close}
    />
  )
}

/**
 * Liste des groupes (Intercomités, Pôle, Sport-études…). `pick` : mode sélection de la page (« ⋯ » → « Sélectionner… ») :
 * une case à cocher, la carte coche au lieu d'ouvrir le groupe ; un groupe qui ne se coche pas dit pourquoi (bulle, ligne).
 */
function GroupRow({ g, teams, pick }: { g: PlayerGroup; teams: Team[]; pick?: { checked: boolean; why: string | null; toggle: () => void } }) {
  const menu = useRowMenu()
  const regionName = useRegionName()
  const info = groupInfo(g, regionName(g.regionId))
  // Participants en bref : staffs choisis (par leur nom), puis participants choisis un par un.
  const ps = participantSummary(g, teams)
  const who = [...ps.teams.map((t) => t.name), ...(ps.hidden ? [STAFF.hidden(ps.hidden)] : []), ...ps.others.map((u) => g.names?.[u] ?? '?')]
  // Ordinateur : groupe ouvert dans le panneau de droite.
  const on = useSelected('/groupes') === g.id
  // Groupe Pôle : effectif calculé (vue en cours), badge « Pôle ».
  const count = usePoleCount(g)
  const body = (
      <div className="min-w-0">
        <div className="flex items-center text-sm font-bold">
          <span className="truncate">{g.name}</span>
          {g.poleUnitId && <PoleChip />}
          {g.team && <TeamChip />}
          {g.archived && <span className="ml-2 shrink-0 text-[10px] text-muted">archivé</span>}
        </div>
        {info && <div className="truncate text-[11px] font-bold text-accent">{info}</div>}
        {g.description && <div className="truncate text-[11px] text-muted">{g.description}</div>}
        {g.createdByName && !g.private && (
          <div className="text-[10px] text-muted">
            par {g.createdByName}
            {!!who.length && ` + ${who.join(', ')}`}
          </div>
        )}
      </div>
  )
  if (pick) {
    const checked = !pick.why && pick.checked
    return (
      <label
        title={pick.why ?? undefined}
        className={`card flex items-center gap-3 p-3 ${g.archived || pick.why ? 'opacity-60' : ''} ${pick.why ? 'cursor-not-allowed' : 'cursor-pointer hover:border-accent'} ${checked ? 'border-accent bg-accent/10' : ''}`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={!!pick.why}
          onChange={pick.toggle}
          aria-label={`Sélectionner « ${g.name} »`}
          className="h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
        />
        <div className="min-w-0 flex-1">
          {body}
          {pick.why && <div className="truncate text-[10px] text-muted italic">{pick.why}</div>}
        </div>
        <span className="shrink-0 text-xs font-bold text-muted">{pluralG(count, g.sex)}</span>
      </label>
    )
  }
  return (
    <>
    <Link
      to={`/groupes/${g.id}`}
      data-md={g.id}
      aria-current={on || undefined}
      className={`card flex items-center justify-between gap-3 p-3 outline-none hover:border-accent focus-visible:border-accent ${MENU_ROW} ${g.archived ? 'opacity-60' : ''} ${selectedCls(on)}`}
      {...menu.bind}
    >
      {body}
      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-muted">
        <FollowStar kind="group" id={g.id} />
        {pluralG(count, g.sex)}
        <MenuButton onOpen={menu.open} open={!!menu.anchor} inLink label={`Actions pour « ${g.name} »`} className="-mr-1.5" />
      </span>
    </Link>
    <GroupMenu g={g} menu={menu} count={count} />
    </>
  )
}

/** Garçons / Filles / Mixte : libellés partagés (src/gender.ts). */
const SEXES = SEX_CHOICES

/** Années de naissance proposées : les catégories jeunes et un peu au-delà. */
function yearChoices(selected: string[] = []) {
  const now = new Date().getFullYear()
  const ys = Array.from({ length: 15 }, (_, i) => String(now - 6 - i))
  return [...new Set([...ys, ...selected])].sort((a, b) => b.localeCompare(a))
}

/** « Garçons · 83 · 2010-2011 · Région Sud » : les informations du groupe, en clair. */
export function groupInfo(g: Pick<PlayerGroup, 'sex' | 'department' | 'years' | 'scope'>, region?: string) {
  const ys = [...(g.years ?? [])].sort()
  const years = !ys.length ? '' : ys.length > 1 && Number(ys[ys.length - 1]) - Number(ys[0]) === ys.length - 1 ? `${ys[0]}-${ys[ys.length - 1]}` : ys.join(', ')
  const scope =
    g.scope === 'federation' ? 'Fédération' : g.scope === 'ligue' ? `Ligue${region ? ` ${region}` : ''}` : g.scope === 'comite' ? `Comité${g.department ? ` ${g.department}` : ''}` : ''
  const place = g.scope === 'ligue' ? '' : g.scope === 'comite' ? (g.department ? departmentLabel(g.department).replace(/^\S+ · /, '') : '') : g.department && departmentLabel(g.department)
  return [scope, SEXES.find((x) => x.value === g.sex)?.label, place, years, g.scope ? '' : region].filter(Boolean).join(' · ')
}

/** Qui a ajouté ce joueur au groupe (son créateur par défaut). */
export function groupAddedBy(g: PlayerGroup, pid: string) {
  const uid = g.addedBy?.[pid] ?? g.createdBy
  return uid ? (g.names?.[uid] ?? (uid === g.createdBy ? g.createdByName : undefined)) : undefined
}

const VIS_HELP: Record<GroupVisibility, string> = GROUP_VIS.help
/** Du moins visible au plus visible. */
const VIS_RANK: Record<GroupVisibility, number> = { private: 0, team: 1, staff: 2 }

/** Copie d'un groupe sans la signature serveur de l'original (la copie a son propre créateur). */
function stripStamps(g: PlayerGroup): PlayerGroup {
  const { createdBy: _a, createdByName: _b, createdAtServer: _c, updatedByName: _d, updatedAtServer: _e, ...rest } = g
  return rest as PlayerGroup
}

/** Création ou modification d'un groupe : nom, description et informations facultatives. */
export function GroupForm({
  group,
  playerIds = [],
  defaultSex,
  onDone,
}: {
  group?: PlayerGroup
  playerIds?: string[]
  /** Nouveau groupe : sexe déduit des joueurs choisis (setGender / genderOf, src/gender.ts), modifiable. */
  defaultSex?: PlayerGroup['sex']
  onDone: (g?: PlayerGroup) => void
}) {
  const role = useRole()
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  // Nouveau groupe : privé par défaut ; l'observateur ne crée que des groupes privés.
  const [vis, setVis] = useState<GroupVisibility>(group ? groupVisibility(group) : 'private')
  const priv = vis === 'private'
  const [sex, setSex] = useState(group?.sex ?? defaultSex)
  const [department, setDepartment] = useState(group?.department ?? '')
  const regions = useRegions()
  const [region, setRegion] = useState(group?.regionId ?? '')
  const [scope, setScope] = useState<GroupScope | undefined>(group?.scope)
  // Obligatoires : nom, portée (avec sa ligue ou son comité) et garçons / filles ; l'année d'âge reste facultative.
  const missing = [
    !name.trim() && 'le nom',
    !scope && 'la portée',
    scope === 'ligue' && !region && 'la ligue',
    scope === 'comite' && !department && 'le comité',
    !sex && `${SEX_LABELS.M} / ${SEX_LABELS.F}`.toLowerCase(),
  ].filter(Boolean) as string[]
  const complete = !missing.length
  // Année d'âge (les anciens groupes à plusieurs années gardent la première).
  const sortedYears = [...(group?.years ?? [])].sort()
  const [year, setYear] = useState(sortedYears[0] ?? '')
  const years = year ? [year] : []
  // Participants (groupe partagé) : encadrants choisis parmi le staff (supabase/023_participants_groupes.sql).
  const [editors, setEditors] = useState<string[]>(group?.editors ?? [])
  // Staffs choisis (supabase/034) : leurs membres du moment participent. Ceux que je ne vois pas restent tels quels.
  const [teams, setTeams] = useState<string[]>(group?.teams ?? [])
  const canPick = useCanPickStaff()
  // « Suivi par le staff » (teamFollow, supabase/032_suivis.sql) : le créateur seul le change ; groupe « Mon staff » ou du staff.
  const creator = !group?.createdBy || group.createdBy === currentUserId()
  const [teamFollow, setTeamFollow] = useState(!!group?.teamFollow)
  const [staffNames, setStaffNames] = useState<Record<string, string>>({})
  const chip = (on: boolean) =>
    `rounded-md border px-2.5 py-1.5 text-xs font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-white'}`

  return (
    <div className="flex flex-col gap-2">
      <span className="label">Nom du groupe</span>
      <input className="field" autoFocus={!group} placeholder={sportContent().examples.groupName} value={name} onChange={(e) => setName(e.target.value)} />
      <span className="label">Description</span>
      <input className="field" placeholder="Saison, encadrant… — facultatif" value={description} onChange={(e) => setDescription(e.target.value)} />

      <span className="label">Visible par</span>
      {can.publicGroups(role) || (group && !group.private) ? (
        <Segmented<GroupVisibility>
          value={vis}
          onChange={setVis}
          options={[
            { value: 'private', label: GROUP_VIS.label.private, icon: 'lock' },
            { value: 'team', label: GROUP_VIS.label.team, icon: 'users' },
            // « Tout le staff » retiré à la création (en attendant « Mon territoire » / « Officiel »). Un groupe qui l'est
            // déjà le reste : le passer en « Mon staff » en ferait une copie (nouvel identifiant, suivis et « ajouté par » perdus).
            ...(group && groupVisibility(group) === 'staff' ? [{ value: 'staff' as const, label: GROUP_VIS.label.staff, icon: 'globe' as const }] : []),
          ]}
        />
      ) : (
        <p className="flex items-center gap-1.5 text-xs">
          <Icon name="lock" className="h-3.5 w-3.5" />
          Moi seul (groupe privé)
        </p>
      )}
      <p className="text-[11px] text-muted">{VIS_HELP[vis]}</p>

      {!priv && canPick && (
        <>
          <span className="label mt-2">Participants</span>
          <p className="-mt-1 text-[11px] text-muted">
            {vis === 'team'
              ? `Encadrants qui voient ce groupe, y ajoutent des ${w(sex).joueurs} et retirent ${w(sex).ceux} qu’ils ont ${accord('ajouté', sex, 2)}. Renommer, archiver ou supprimer le groupe, ou changer ses participants, reste à toi.`
              : `Encadrants qui peuvent ajouter des ${w(sex).joueurs} à ce groupe et retirer ${w(sex).ceux} qu’ils ont ${accord('ajouté', sex, 2)}. Eux seuls ; renommer, archiver ou supprimer le groupe reste à toi (et aux administrateurs).`}
          </p>
          <StaffPicker
            value={editors}
            onChange={setEditors}
            teams={teams}
            onTeams={setTeams}
            ownerId={group?.createdBy}
            onNames={setStaffNames}
            chip={chip}
          />
        </>
      )}
      {!priv && creator && (
        <label className="mt-2 flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={teamFollow} onChange={(e) => setTeamFollow(e.target.checked)} />
          <span>
            <b>{TEAM_FOLLOW.label}</b>
            <span className="block text-[11px] text-muted">{TEAM_FOLLOW.help}</span>
          </span>
        </label>
      )}

      <span className="label mt-2">Portée *</span>
      <div className="flex gap-1">
        {GROUP_SCOPES.map((x) => (
          <button key={x.value} type="button" className={`flex-1 ${chip(scope === x.value)}`} onClick={() => setScope(x.value)}>
            {x.label}
          </button>
        ))}
      </div>
      {scope === 'federation' && <p className="-mt-1 text-[11px] text-muted">Groupe national (DTN, stages nationaux, équipes de France jeunes).</p>}
      {scope === 'ligue' && (
        <select className={`field ${region ? '' : 'border-amber-400'}`} value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Choisir la ligue (région) *</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      {scope === 'comite' && (
        <select className={`field ${department ? '' : 'border-amber-400'}`} value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">Choisir le comité (département) *</option>
          {[...departmentChoices(), ...(department && !departmentChoices().some((d) => d.value === department) ? [{ value: department, label: departmentLabel(department) }] : [])].map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      )}

      <span className="label mt-2">{SEX_LABELS.M} / {SEX_LABELS.F.toLowerCase()} *</span>
      <div className="flex gap-1">
        {SEXES.map((x) => (
          <button key={x.value} type="button" className={`flex-1 ${chip(sex === x.value)}`} onClick={() => setSex(x.value)}>
            {x.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="label">Année d’âge (facultatif)</span>
          <select className="field" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">—</option>
            {yearChoices(sortedYears).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!complete && <p className="mt-2 text-[11px] text-amber-300">À compléter : {missing.join(', ')}.</p>}
      <FormActions className="mt-2 flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={!complete}
          onClick={async () => {
            const fields = {
              name: name.trim(),
              description: description.trim() || undefined,
              sex,
              scope,
              // Portée : on ne garde que le territoire qui lui correspond (comité → département, ligue → région).
              department: scope === 'federation' || scope === 'ligue' ? undefined : department || undefined,
              regionId: scope === 'federation' ? undefined : scope === 'comite' ? regionOfDept(department) ?? (region || undefined) : region || undefined,
              years: years.length ? [...years].sort() : undefined,
              // Participants : seulement sur un groupe partagé ; leurs noms pour l'affichage.
              editors: priv ? [] : editors,
              teams: priv || !teams.length ? undefined : teams,
              names: {
                ...group?.names,
                ...Object.fromEntries(editors.filter((u) => staffNames[u]).map((u) => [u, staffNames[u]])),
              },
            }
            const flags = {
              private: priv,
              team: vis === 'team' || undefined,
              // Seul le créateur le change ; sinon le groupe garde le sien (le serveur l'impose aussi).
              teamFollow: (creator ? !priv && teamFollow : !priv && !!group?.teamFollow) || undefined,
            }
            // Relit le groupe : sa liste a pu changer entre-temps.
            const current = group && (await db.groups.get(group.id))
            if (current && VIS_RANK[vis] < VIS_RANK[groupVisibility(current)]) {
              // Moins visible (staff → mon staff ou privé, mon staff → privé) : nouveau groupe, et l'ancien est supprimé
              // chez tout le monde. Sinon, ceux qui ne le voient plus garderaient leur copie : le serveur ne leur
              // envoie plus rien de ce groupe, pas même sa suppression.
              const copy = await save<PlayerGroup>('groups', { ...stripStamps(current), ...fields, ...flags, id: newId() })
              await remove('groups', current.id)
              return onDone(copy)
            }
            onDone(
              await save<PlayerGroup>(
                'groups',
                current ? { ...current, ...fields, ...flags } : { id: newId(), playerIds: [...new Set(playerIds)], ...fields, ...flags },
              ),
            )
          }}
        >
          {group ? 'Enregistrer' : 'Créer'}
        </button>
        <button className="btn text-muted" onClick={() => onDone()}>
          Annuler
        </button>
      </FormActions>
    </div>
  )
}

/**
 * /groupes/nouveau (lien d'ailleurs, éventuellement avec des joueurs déjà choisis dans l'état de navigation) : la liste des
 * groupes avec la fenêtre « Nouveau groupe » ouverte (?nouveau=1, voir Groups).
 */
export function NewGroup() {
  const location = useLocation()
  return <Navigate to="/groupes?nouveau=1" replace state={location.state} />
}

/** Fenêtre « Nouveau groupe » : créé, on ouvre le groupe (l'ajout de joueurs s'il est vide). `onClose(true)` : créé. */
function NewGroupWindow({ playerIds, onClose }: { playerIds: string[]; onClose: (created?: boolean) => void }) {
  const nav = useNavigate()
  // « Les 12 joueuses choisies » si ce sont toutes des filles (src/gender.ts).
  const chosenG = useLiveQuery(() => db.players.bulkGet(playerIds).then((ps) => genderOf(ps)), [playerIds.join(',')])
  return (
    <FormWindow title="Nouveau groupe" onClose={() => onClose()}>
      <p className="text-[11px] text-muted">
        {playerIds.length
          ? `Les ${pluralG(playerIds.length, chosenG, 'joueur choisi')} seront dans le groupe ; tu pourras en ajouter ou en retirer ensuite.`
          : 'Donne un nom au groupe, puis ajoute ses joueurs (par filtres ou un par un).'}
      </p>
      <GroupForm
        playerIds={playerIds}
        onDone={(g) => {
          onClose(!!g)
          // Ouvre le groupe créé : il prend la place de l'entrée d'historique de la fenêtre.
          if (g) nav(`/groupes/${g.id}${playerIds.length ? '' : '?ajout=1'}`)
        }}
      />
    </FormWindow>
  )
}

/** Texte d'une période pour l'export d'un groupe Pôle : statut de saison, programme, référence PSQS de l'unité. */
function poleCells(p: Player, pole: { ref: PoleRef; m: PoleMembers; view: PoleView }): [status: string, programme: string, psqs: string] {
  const st = seasonStatus(p, pole.ref, pole.m.s)
  const i = periodIndexAt(p, pole.ref, pole.view === 'prochaine' ? pole.m.s.refNext : pole.m.s.refCurrent)
  return [seasonStatusLabel(st, p.sex), programmeLabel(i >= 0 ? p.poles?.[i]?.programme : undefined), pole.ref.psqsRef ?? '']
}

/**
 * « Exporter ▾ » de la page d'un groupe : tableur (CSV) ou liste à imprimer (PDF, identité seulement, ex. pour la ligue).
 * Groupe Pôle : la vue affichée, avec « Statut de saison », « Programme » et « Référence PSQS » ; avant l'export, les fiches
 * incomplètes (licence, date de naissance complète, sexe) sont listées : continuer, ou aller corriger la première.
 * TODO (plus tard) : courriel préparé pour la ligue / le PSQS.
 */
function GroupExport({ g, players, gender, pole, className = '' }: { g: PlayerGroup; players: Player[]; gender?: Gender; pole?: { ref: PoleRef; m: PoleMembers; view: PoleView }; className?: string }) {
  const nav = useNavigate()
  const menu = useRowMenu()
  const n = players.length
  /** Contrôle des fiches incomplètes (groupe Pôle) : vrai pour continuer. */
  async function checked(): Promise<boolean> {
    if (!pole) return true
    const gaps = players.map((p) => ({ p, miss: exportGaps(p) })).filter((x) => x.miss.length)
    if (!gaps.length) return true
    const list = gaps.slice(0, 6).map((x) => `${x.p.lastName.toUpperCase()} ${x.p.firstName} (${x.miss.join(', ')})`).join(' ; ')
    const r = await choose(`${gaps.length} fiche${gaps.length > 1 ? 's incomplètes' : ' incomplète'} pour la liste officielle : ${list}${gaps.length > 6 ? ' ; …' : ''}. Continuer quand même ?`, [
      { value: 'corriger', label: 'Aller corriger', style: 'ghost' },
      { value: 'continuer', label: 'Continuer', style: 'primary' },
    ])
    if (r === 'corriger') nav(`/joueurs/${gaps[0].p.id}/modifier?retour=${encodeURIComponent(`/groupes/${g.id}`)}`)
    return r === 'continuer'
  }
  const extra = pole ? { head: ['Statut de saison', 'Programme', 'Référence PSQS'], row: (p: Player) => poleCells(p, pole) } : undefined
  return (
    <>
      <button
        className={`btn-ghost text-xs ${className}`}
        disabled={!n}
        aria-haspopup="menu"
        aria-expanded={!!menu.anchor}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          menu.open({ x: r.left, y: r.bottom, top: r.top })
        }}
      >
        Exporter ▾
      </button>
      {menu.anchor && (
        <ItemMenu
          anchor={menu.anchor}
          title="Exporter"
          subtitle={`${g.name} · ${pluralG(n, gender)}`}
          items={[
            { label: 'Exporter CSV', icon: 'download', hint: 'tableur, toutes les colonnes', onSelect: async () => (await checked()) && void exportCsv(players, gender, extra) },
            { label: 'Exporter PDF', icon: 'list', hint: 'liste à imprimer (identité seulement)', onSelect: async () => (await checked()) && nav(`/groupes/${g.id}/rapport${pole ? withPoleView('', pole.view) : ''}`) },
          ]}
          onClose={menu.close}
        />
      )}
    </>
  )
}

/**
 * Écran /groupes/:id : un groupe de joueurs, ou un groupe de travail quand l'adresse porte ?onglet=travail (même
 * panneau de droite sur ordinateur, même écran seul sur téléphone ; la liste de gauche reste sur le bon onglet).
 */
export function GroupDetail() {
  const { id } = useParams()
  const [params] = useSearchParams()
  if (id && params.get('onglet') === STAFF.tab) return <WorkGroupDetail key={id} id={id} />
  return <PlayerGroupDetail />
}

function PlayerGroupDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const role = useRole()
  // Après Supprimer ou une réattribution : l'écran d'origine, par l'historique (même état) ; entrée directe : la liste.
  const leave = useBack('/groupes', 'GROUPES')
  // « Modifier » choisi depuis un autre écran (menu d'une ligne de la liste, ?modifier=1) : Enregistrer ou Annuler y
  // ramène. Copie toute neuve (« Dupliquer », ?modifier=copie) : elle reste ouverte.
  const origin = useOrigin()
  const regionName = useRegionName()
  // Groupe tout juste créé sans joueurs : on ouvre directement l'ajout ; tout juste copié : sa fiche.
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(params.has('modifier'))
  // Même écran réutilisé d'un groupe à l'autre (ex. après « Dupliquer ») : on repart de l'adresse.
  // Aussi depuis le menu d'une ligne de la liste (« Ajouter des joueurs », « Modifier ») sur le groupe déjà ouvert.
  const wantEdit = params.has('modifier')
  const wantAdd = params.has('ajout')
  useEffect(() => {
    setEditing(wantEdit)
    setAdding(wantAdd)
  }, [id, wantEdit, wantAdd])
  const [adding, setAdding] = useState(params.has('ajout'))
  const panel = usePanel()
  // Ordinateur : boutons regroupés en une barre d'actions compacte (pleine largeur sur téléphone).
  const bar = useMedia(MQ.side)
  // « Retirer des joueurs » : les croix n'apparaissent qu'en mode retrait (sinon, l'étoile pour suivre).
  const [removing, setRemoving] = useState(false)
  // « Comparer » : cases à cocher sur les joueurs, deux à comparer.
  const pick = useComparePick()
  // « Les gardiennes du groupe X » (Demander, src/components/AskAction.tsx) : la liste ne montre que ces joueurs.
  const askFilter = useAskListFilter('groupe', id)
  // « Réattribuer… » (administrateurs, supabase/038) : panneau ouvert.
  const [transferring, setTransferring] = useState(false)
  useEffect(() => setTransferring(false), [id])
  // « Voir tous les groupes » (administrateurs, supabase/039) : un groupe absent de l'appareil se lit sur le serveur.
  const allGroups = useAllGroups(role).on
  // « À revoir » qui visent ce groupe (supabase/041) : trace sur la ligne du joueur, « Revu » à la main.
  const rewatch = useGroupRewatch(id)
  // Liste rangée comme celle d'un événement : par poste ; dans chaque poste, l'ordre choisi (gardé sur l'appareil pour
  // ce groupe, repris par la colonne de gauche de la fiche) ; pastille d'un poste pour n'afficher que lui (session).
  const [sort, setSort] = useRosterSort(id ? groupRosterKey(id) : undefined)
  const { pos: posFilter, setPos: setPosFilter } = useRosterFilter(id ? groupRosterKey(id) : undefined)
  const data = useLiveQuery(async () => {
    const teams = await loadTeams()
    const g = await db.groups.get(id!)
    const got = (await db.players.bulkGet(g?.playerIds ?? [])).filter((p): p is Player => !!p)
    // Joueurs du groupe absents de l'appareil : hors du périmètre du compte (supabase/046), comptés sans leur nom.
    const hidden = hiddenCount(g?.playerIds ?? [], new Set(got.map((p) => p.id)))
    return { g, players: alive(got), teams, hidden }
  }, [id])
  // Groupe Pôle (src/poleSeason.ts) : membres calculés depuis les fiches pour la vue de l'adresse (?saison=prochaine) ;
  // ses dirigeants (can.editPoles) ajoutent (entrée écrite sur la fiche) et retirent (sortie + motif) ; jamais playerIds.
  const loc = useLocation()
  const poleView = poleViewOf(loc.search)
  const leader = usePoleLeader()
  const pole = !!data?.g?.poleUnitId
  const ref = usePoleRef(data?.g?.poleUnitId)
  const pm = usePoleMembers(pole ? ref : null, poleView)
  const [exiting, setExiting] = useState<Player | null>(null)
  const [poleMsg, setPoleMsg] = useState('')
  useEffect(() => setPoleMsg(''), [id])

  // Retour d'une fiche ouverte depuis le groupe : la liste reprend sa position.
  useRestoreScroll(`groupe.${id}`, !!data && data.g?.id === id)

  // Données encore celles du groupe précédent (navigation d'un groupe à l'autre) : on attend.
  if (!data || (data.g && data.g.id !== id) || (pole && !pm)) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const { g, teams } = data
  if (!g || g.deleted || !can.seeGroup(g)) {
    if (allGroups && id) return <OtherGroupDetail key={id} id={id} info={groupInfo} />
    return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>
  }
  const players = pole ? pm!.shown : data.players
  const hidden = pole ? 0 : data.hidden
  const leads = pole && leader.leads(g.poleUnitId!)
  const manage = can.editGroup(role, g) || leads
  // Participant (023) : ajoute des joueurs, retire les siens, peut se retirer du groupe. Groupe Pôle : ses dirigeants seuls.
  const contribute = !pole && can.contributeGroup(role, g)
  const who = (uid?: string) => (uid ? (g.names?.[uid] ?? (uid === g.createdBy ? g.createdByName : undefined)) : undefined)
  const addedByOf = (pid: string) => groupAddedBy(g, pid)
  const info = pole ? [ref?.name ?? 'Unité Pôle introuvable', ref?.psqsRef && `PSQS ${ref.psqsRef}`].filter(Boolean).join(' · ') : groupInfo(g, regionName(g.regionId))
  const view = positionRosterView(players, sort, posFilter)
  const askIds = askFilter ? new Set(askFilter.ids) : null
  const sections = askIds ? view.sections.map((sec) => ({ ...sec, players: sec.players.filter((p) => askIds.has(p.id)) })).filter((sec) => sec.players.length) : view.sections
  const nAsk = askIds ? sections.reduce((n, sec) => n + sec.players.length, 0) : 0
  // Accord au genre (src/gender.ts) : sexe du groupe (Filles / Garçons / Mixte ; pôle : sexe de l'unité), sinon déduit de ses joueurs.
  const gg = setGender(ref?.sex ?? g.sex, players)
  const gw = w(gg)
  const fiche = (p: Player) => `/groupes/${g.id}/joueurs/${p.id}${pole ? withPoleView('', poleView) : ''}`
  /** Ligne d'un membre du groupe Pôle : statut de saison (sortie, entrée) ou programme. */
  const poleLine = (p: Player) => {
    if (!pole || !ref || !pm) return null
    const st = seasonStatus(p, ref, pm.s)
    const i = periodIndexAt(p, ref, poleView === 'prochaine' ? pm.s.refNext : pm.s.refCurrent)
    const x = i >= 0 ? p.poles![i] : undefined
    const prog = programmeLabel(x?.programme)
    if (st.status === 'sorti') return `${seasonStatusLabel(st, p.sex)} au ${fmtDay(x?.to)}`
    if (st.status === 'nouveau') return `${seasonStatusLabel(st, p.sex)} · entrée le ${fmtDay(x?.from)}${prog ? ` · ${prog}` : ''}`
    return prog || (x?.from ? `depuis le ${fmtDay(x.from)}` : null)
  }

  if (adding)
    return (
      <AddPlayers
        g={gg}
        scope={pole ? 'ajout-pole' : 'ajout-groupe'}
        current={pole ? pm!.next.map((p) => p.id) : g.playerIds}
        onCancel={() => (setAdding(false), setParams({}, { replace: true }))}
        onAdd={async (ids) => {
          if (pole && ref && pm) {
            // Arrivée aujourd'hui (saison en cours) ou au 1er juillet (saison prochaine) ; la vue affichée suit le choix.
            const when = await askArrival(pm.s, ids.length, poleView === 'prochaine' ? 'next' : 'now')
            if (!when) return
            const r = await joinPoleMany(ref, ids, pm.s, undefined, when)
            setPoleMsg(joinMessage(r, g.name, pm.s, gg, when))
            setAdding(false)
            // Remplace « ?ajout=1 » par la vue de la saison choisie (effacer tous les paramètres ramenait à la saison en cours).
            setParams(new URLSearchParams(withPoleView('', when === 'next' ? 'prochaine' : 'courante')), { replace: true })
            return
          } else await addToGroup(g, ids)
          setAdding(false)
          setParams({}, { replace: true })
        }}
      />
    )

  // Fin de « Modifier » (fenêtre) : Enregistrer, Annuler ou ✕.
  function doneEditing(saved?: PlayerGroup) {
    setEditing(false)
    // Rendu moins visible (privé, mon staff) : c'est un nouveau groupe (voir GroupForm).
    if (saved && saved.id !== g!.id) return nav(`/groupes/${saved.id}`, { replace: true })
    const from = params.get('modifier')
    // Après la fermeture de la fenêtre (son entrée d'historique retirée) : retour à l'écran d'origine.
    if (from !== null && from !== 'copie' && origin.known) return afterWindow(origin.go)
    if (from !== null) setParams({}, { replace: true })
  }

  // Retirer un joueur depuis le menu de sa ligne : toujours après confirmation (groupe Pôle : fenêtre du motif de sortie).
  async function removeOne(p: Player) {
    if (pole) return setExiting(p)
    if (await ask(`Retirer ${p.lastName.toUpperCase()} ${p.firstName} du groupe « ${g!.name} » ? Sa fiche et ses avis ne sont pas touchés.`, { ok: 'Retirer', focusCancel: true }))
      await removeFromGroup(g!, [p.id])
  }

  // Menu d'une ligne du groupe Pôle : arrivée pas encore commencée → « Annuler l'arrivée » (on retire seulement cette
  // période, sans date ni motif) ; période commencée → « Retirer du pôle… » (sortie et motif).
  function poleMenuItem(p: Player): MenuExtra {
    const day = poleView === 'prochaine' ? pm?.s.refNext : pm?.s.refCurrent
    const x = ref && pm ? upcomingArrival(p, ref, pm.s, day) : undefined
    if (!x) return { label: 'Retirer du pôle…', icon: 'close', hint: 'sortie et motif sur la fiche', onSelect: () => void removeOne(p) }
    return {
      label: 'Annuler l’arrivée',
      icon: 'close',
      hint: `prévue le ${fmtLongDay(x.from)}`,
      onSelect: async () => {
        if (!ref || !pm || !(await cancelArrivalOne(p, ref, pm.s, g!.name, day))) return
        setPoleMsg(`${p.lastName.toUpperCase()} ${p.firstName} : arrivée du ${fmtDay(x.from)} annulée (période retirée de sa fiche).`)
      },
    }
  }

  return (
    <PlayerMenuScope.Provider value={{ pick }}>
    <div className="flex flex-col gap-4">
      {/* En-tête : retour, puis les actions du groupe dans le ⋮ (Supprimer en dernier, avec confirmation). */}
      <PageHeader
        back={panel ? <PanelClose /> : <BackButton fallback="/groupes" label="GROUPES" />}
        menu={
          editing
            ? undefined
            : {
                title: g.name,
                subtitle: `${pluralG(players.length, gg)}${g.archived ? ' · archivé' : ''}`,
                items: [
                  // Copier le groupe et ses joueurs (ex. le pôle de la saison suivante), puis ajuster la différence.
                  // Groupe Pôle : permanent (ni dupliqué ni archivé) ; « Changement de saison » pour ses dirigeants.
                  !pole && { label: 'Dupliquer', icon: 'list', hint: `avec ses ${gw.joueurs}`, onSelect: async () => nav(`/groupes/${(await duplicateGroup(g, role)).id}?modifier=copie`) },
                  leads && { label: 'Changement de saison', icon: 'calendar', onSelect: () => nav(`/groupes/${g.id}/saison`) },
                  manage && { label: pole ? 'Renommer' : 'Modifier', icon: 'pencil', onSelect: () => setEditing(true) },
                  !pole && manage && { label: g.archived ? 'Désarchiver' : 'Archiver', icon: 'archive', onSelect: () => void save<PlayerGroup>('groups', { ...g, archived: !g.archived }) },
                  !pole && canTransferGroup(role) && { label: transferring ? 'Fermer « Réattribuer »' : 'Réattribuer…', icon: 'users', onSelect: () => setTransferring((t) => !t) },
                  players.length > 0 && {
                    label: 'Voir dans Joueurs',
                    icon: 'user',
                    hint: 'la liste Joueurs filtrée sur ce groupe',
                    onSelect: () => {
                      showGroupInPlayers(g.id)
                      nav('/joueurs')
                    },
                  },
                  { label: 'Copier le lien', icon: 'copy', onSelect: () => copyLink(`/groupes/${g.id}`) },
                  manage && {
                    label: 'Supprimer',
                    icon: 'trash',
                    danger: true,
                    onSelect: async () => {
                      if (await deleteGroup(g)) leave.exit()
                    },
                  },
                ],
              }
        }
      />

      {transferring && !editing && canTransferGroup(role) && (
        <TransferGroup g={g} onClose={() => setTransferring(false)} onHidden={leave.exit} />
      )}

      {editing && (
        <FormWindow title={pole ? 'Renommer le groupe' : 'Modifier le groupe'} onClose={() => doneEditing()}>
          <GroupForm key={g.id} group={g} onDone={doneEditing} />
        </FormWindow>
      )}
        <div>
          <h1 className="text-lg font-extrabold">
            {g.private && (
              <span title={GROUP_VIS.privateTitle}>
                <Icon name="lock" className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted" />
              </span>
            )}
            {g.name}
            {pole && <PoleChip />}
            {g.team && <TeamChip />}
            {g.teamFollow && !g.private && <TeamFollowChip />}
            {g.archived && <span className="ml-2 text-xs text-muted">archivé</span>}
          </h1>
          <div className="my-1.5 flex flex-wrap items-center gap-2">
            <FollowButton kind="group" id={g.id} />
            {teamFollowed(g) && <span className="text-[10px] text-muted">{TEAM_FOLLOW.already}</span>}
          </div>
          {info && <div className="text-xs font-bold text-accent">{info}</div>}
          {g.description && <div className="text-xs text-muted">{g.description}</div>}
          <Participants
            x={g}
            teams={teams}
            who={who}
            onLeave={
              contribute
                ? async () => {
                    if (!(await ask(`Te retirer des participants de « ${g.name} » ? Les ${gw.joueurs} que tu as ${accord('ajouté', gg, 2)} restent dans le groupe.`, { ok: 'Me retirer' }))) return
                    const me = currentUserId()
                    await save<PlayerGroup>('groups', { ...g, editors: (g.editors ?? []).filter((u) => u !== me) })
                  }
                : undefined
            }
          />
          <div className="mt-1">
            <StampLine row={g} />
          </div>
        </div>

      {/* Groupe Pôle : vue « Saison en cours | Saison prochaine » dans l'adresse (?saison=prochaine), gardée au retour. */}
      {pole && pm && (
        <div className="flex flex-col gap-1">
          <Segmented<PoleView>
            value={poleView}
            onChange={(v) => nav(`${loc.pathname}${withPoleView(loc.search, v)}`, { replace: true, state: loc.state })}
            options={VIEW_OPTIONS(pm.s, !bar)}
          />
          <p className="text-[11px] text-muted">
            {poleView === 'prochaine'
              ? `${gw.Joueurs} dont une période de pôle couvre le ${fmtDay(pm.s.refNext)} (entrées déjà enregistrées comprises).`
              : `${gw.Joueurs} dont une période de pôle couvre aujourd’hui (fiche ${gw.duJoueur}, bloc « Pôle Espoirs »).`}
          </p>
          {poleMsg && (
            <p role="status" className="text-[11px] text-emerald-300">
              {poleMsg}
            </p>
          )}
        </div>
      )}

      {/* Barre d'actions : « + Ajouter des joueurs » (principal), « Créer un événement », « Exporter ▾ » (CSV / PDF).
          Téléphone : le bouton principal sur toute la largeur, les deux autres côte à côte dessous. */}
      <div className={bar ? 'flex flex-wrap items-center gap-2' : 'grid grid-cols-2 gap-2'}>
        {(pole ? leads : manage || contribute) && (
          <button className={`btn-primary ${bar ? 'px-3 py-1.5 text-xs' : 'col-span-2'}`} onClick={() => setAdding(true)}>
            + Ajouter des {gw.joueurs}
          </button>
        )}
        {leads && (
          <Link to={`/groupes/${g.id}/saison`} className={`btn-ghost text-center text-xs ${bar ? 'px-3 py-1.5' : 'col-span-2 px-2'}`}>
            Changement de saison
          </Link>
        )}
        {can.manageEvents(role) && (
          <Link
            to={`/evenements?groupe=${g.id}`}
            aria-disabled={!players.length || undefined}
            className={`btn-ghost text-center text-xs ${bar ? 'px-3 py-1.5' : 'px-2'} ${players.length ? '' : 'pointer-events-none opacity-50'}`}
          >
            Créer un événement
          </Link>
        )}
        <GroupExport g={g} players={view.roster} gender={gg} pole={pole && ref && pm ? { ref, m: pm, view: poleView } : undefined} className={`${bar ? 'px-3 py-1.5' : `px-2 ${can.manageEvents(role) ? '' : 'col-span-2'}`}`} />
      </div>
      {contribute && <p className="-mt-2 text-[11px] text-muted">Tu es participant : tu peux ajouter des {gw.joueurs} et retirer {gw.ceux} que tu as {accord('ajouté', gg, 2)}.</p>}

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          {pluralG(players.length, gg)}
        </span>
        {players.length > 1 && !removing && <CompareToggle pick={pick} className="ml-auto" />}
        {!pick.on && !pole && players.some((p) => can.removeFromGroup(role, g, p.id)) && (
          <button
            className={`rounded-md border px-2 py-1 text-[11px] font-bold transition ${removing ? 'border-accent bg-accent text-white' : 'border-line text-muted hover:text-fg'}`}
            onClick={() => setRemoving((r) => !r)}
          >
            {removing ? 'Terminé' : `Retirer des ${gw.joueurs}`}
          </button>
        )}
      </div>
      {!players.length && !hidden && <Empty>{gw.AucunJoueur} dans ce groupe.</Empty>}
      <HiddenPlayers count={hidden} />
      {players.length > 1 && <RosterControls sort={sort} setSort={setSort} />}
      {players.length > 0 && view.shown.length === 0 && <Empty>{gw.AucunJoueur} à ce poste.</Empty>}
      {/* Un titre à chaque nouveau poste ; sous chaque titre, les joueurs (en colonnes sur grand écran), numérotés à la suite. */}
      {askFilter && <AskFilterBanner kind="groupe" id={g.id} f={askFilter} shown={nAsk} />}
      {/* Postes (filtre) dans la capsule des pictogrammes, collée en haut : à portée pendant le défilement. */}
      <PlayerList
        ids={sections.flatMap((sec) => sec.players.map((p) => p.id))}
        barLead={players.length > 1 && rosterBarLead({ roster: view.roster, pos: posFilter, setPos: setPosFilter })}
        context={{ groupId: g.id }}
        select={!removing && !pick.on}
      >
      <div className="flex flex-col gap-2" onKeyDown={(e) => arrowNav(e, 'a[data-player]')}>
        <RosterSectionList
          sections={sections}
          row={(p, i) => (
          // Toute la ligne (photo comprise) ouvre la fiche dans le groupe : ses joueurs autour (GroupPlayers.tsx) ;
          // le retour revient ici, à la même position.
          <PlayerRow
            key={p.id}
            p={p}
            marked={pick.picked.includes(p.id)}
            lead={
              <>
                <PickBox pick={pick} p={p} />
                <span className="w-6 shrink-0 text-center text-[11px] text-muted">{i + 1}</span>
              </>
            }
            link={{ to: fiche(p), state: { md: true }, onClick: () => rememberScroll(`groupe.${g.id}`) }}
            linkProps={{ 'data-player': true }}
            lines={
              <>
                {!!g.editors?.length && addedByOf(p.id) && <span className="truncate text-[10px] text-muted">{w(p.sex).ajoute} par {addedByOf(p.id)}</span>}
                {pole && poleLine(p) && <span className="truncate text-[10px] text-muted">{poleLine(p)}</span>}
                <GroupRewatchLine rows={rewatch.by.get(p.id) ?? []} events={rewatch.events} sex={p.sex} />
              </>
            }
            menuExtras={
              pole
                ? leads
                  ? [poleMenuItem(p)]
                  : undefined
                : can.removeFromGroup(role, g, p.id)
                  ? [{ label: 'Retirer du groupe', icon: 'close', onSelect: () => void removeOne(p) }]
                  : undefined
            }
            pictos={!removing}
            rewatch={<RewatchToggle playerId={p.id} groupId={g.id} rows={rewatch.by.get(p.id)} />}
            actions={
              removing &&
              can.removeFromGroup(role, g, p.id) && (
                <button className="flex h-8 w-8 shrink-0 items-center justify-center text-muted hover:text-red-400" title="Retirer du groupe" onClick={() => void removeFromGroup(g, [p.id])}>
                  ✕
                </button>
              )
            }
          />
          )}
        />
      </div>
      </PlayerList>
      <CompareBar pick={pick} players={players} />
      {exiting && ref && pm && (
        <ExitReasonDialog
          name={`${exiting.lastName.toUpperCase()} ${exiting.firstName}`}
          sex={exiting.sex}
          date={pm.s.exit}
          onClose={async (reason) => {
            const p = exiting
            setExiting(null)
            if (!reason) return
            const ok = await leavePoleOne(p, ref, pm.s, reason)
            setPoleMsg(ok ? `${p.lastName.toUpperCase()} ${p.firstName} : sortie au ${fmtDay(pm.s.exit)} enregistrée sur sa fiche (se rétablit en effaçant la date).` : `${p.lastName.toUpperCase()} ${p.firstName} n’a pas de période en cours dans ce pôle.`)
          }}
        />
      )}
    </div>
    </PlayerMenuScope.Provider>
  )
}
