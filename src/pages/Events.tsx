import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { Empty, Icon, QuarterBadge } from '../components/ui'
import { PlayerRow, playerSub } from '../components/PlayerRow'
import { PlayerMenuScope } from '../components/PlayerMenu'
import { copyLink, ItemMenu, MENU_ROW, MenuButton, useRowMenu, type MenuItem } from '../components/ItemMenu'
import { type Role } from '../roles'
import { FollowStar } from '../components/Follow'
import { HiddenPlayers } from '../components/HiddenPlayers'
import { alive, counts, db, fmtDate, POSITIONS, remove, save, type Criterion, type Evaluation, type HBEvent, type Player, type Position, type Rewatch } from '../db'
import { EVENT_TYPES, NewEventForm } from './Evaluate'
import { ask, inform } from '../components/Confirm'
import { can, currentUserId, isParticipant, useRole } from '../roles'
import { usePerimeter, useUnits } from '../installation'
import { DEFAULT_TERRITORY_FILTER, inMyTerritories, organizerLabel, seenThroughMyPlayers, type TerritoryFilter, type TerritoryPlayer } from '../eventOrganizer'
import { arrowNav, department, useSessionState } from '../components/PlayerFilter'
import { useEventsQuery, type EventStats } from '../components/EventsQuery'
import { usePlayersQuery } from '../components/PlayersQuery'
import { AvisCard, DIVERGENCE, EventAvis } from '../components/Opinions'
import { StampLine } from '../components/ActivityLog'
import { Participants } from '../components/Participants'
import { VideoSection } from '../components/Videos'
import { useTeams } from '../teams'
import { filterRoster, isMine, ROSTER_GROUPS, rosterSections, sortRoster, teamGroups, type RosterSection, useRosterFilter, useRosterGroup, useRosterSort } from '../rosterOrder'
import { RosterChip, RosterControls, RosterSectionList } from '../components/PositionRoster'
import { PanelClose, selectedCls, usePanel, useSelected } from '../components/MasterDetail'
import { PageHeader } from '../components/PageHeader'
import { MQ, useMedia, useWidth } from '../layout'
import { playerScore } from '../compare'
import { CompareBar, CompareToggle, PickBox, useComparePick, type ComparePick } from '../components/ComparePick'
import { rememberScroll, useRestoreScroll } from '../components/ContextRoster'
import { CoverageBar, RewatchButton, RewatchInEvent, RewatchToggle, SeenBy, SeenEye, TournamentPanel, type CoverageFilter } from '../components/Scouting'
import { accord, genderOf, pluralG, setGender, w, type Gender } from '../gender'
import { myTournamentTeams, numOf, personName, saveTournament, sheetPlayersWithoutTeam, sightings, teamObservers, teamOf, teamsFromSheet, tournamentTeams, type Sighting } from '../scouting'

// Feuille de match (import, calage, moments) : module chargé à la demande ; pdf.js seulement à la lecture d'un PDF.
const loadSheet = () => import('../components/MatchSheet')
const MatchImport = lazy(() => loadSheet().then((m) => ({ default: m.MatchImport })))
const MatchSheetCard = lazy(() => loadSheet().then((m) => ({ default: m.MatchSheetCard })))
const MatchSyncTools = lazy(() => loadSheet().then((m) => ({ default: m.MatchSyncTools })))
// Frise du match sous la vidéo (repères des actions, « C'est ici ! ») : chargée avec le lecteur.
const MatchTimeline = lazy(() => import('../components/MatchTimeline'))

const typeLabel = (t: string) => EVENT_TYPES.find((x) => x.value === t)?.label ?? t

const NO_STATS = new Map<string, EventStats>()

/** Onglets de la page d'un événement (?onglet=… ; « joueurs » par défaut, sans paramètre). */
const EVENT_TABS = ['joueurs', 'classement', 'video'] as const
type EventTab = (typeof EVENT_TABS)[number]

export default function Events() {
  const role = useRole()
  const allEvents = useLiveQuery(() => db.events.orderBy('date').reverse().toArray().then(alive))
  // Unité organisatrice (src/eventOrganizer.ts) : petite ligne « Organisé par » sur chaque événement, et filtre
  // « Mes territoires » / « Tous ». Par défaut « Tous » tant que supabase/048 n'est pas passé (DEFAULT_TERRITORY_FILTER) :
  // rien ne disparaît de la liste par surprise. Filtre proposé seulement à un compte qui ne voit pas tout et a une affectation.
  const units = useUnits()
  const per = usePerimeter()
  const territoryOn = !!per && !per.all && per.units.length > 0
  const [territory, setTerritory] = useSessionState<TerritoryFilter>('handbase.evenements.territoires', DEFAULT_TERRITORY_FILTER)
  const territoryActive = !!per && territoryOn && territory === 'mes'
  // « Mes territoires » compte aussi les événements où est inscrit un de mes joueurs (048, règle (d)) : fiches des joueurs
  // inscrits, lues seulement quand le filtre est actif.
  const eventPlayers = useLiveQuery(async () => {
    if (!territoryActive || !allEvents) return undefined
    const ids = [...new Set(allEvents.flatMap((e) => e.playerIds ?? []))]
    const m = new Map<string, TerritoryPlayer>()
    for (const p of await db.players.bulkGet(ids)) if (p) m.set(p.id, p)
    return m
  }, [territoryActive, allEvents])
  const events = useMemo(() => {
    if (!allEvents || !per || !territoryActive) return allEvents
    const cache = new Map<string, { depts: string[]; clubs: string[] }>()
    const ctx = {
      per,
      userId: currentUserId(),
      units,
      participant: (x: { editors?: string[]; teams?: string[] }) => isParticipant(x),
      player: (pid: string) => eventPlayers?.get(pid),
    }
    return allEvents.filter((e) => inMyTerritories(e, ctx, cache))
  }, [allEvents, per, territoryActive, units, eventPlayers])
  // Accord de la ligne (src/gender.ts) : événement sans sexe déclaré dont les joueurs de la liste (fiches sur l'appareil)
  // sont toutes des filles → « 12 joueuses ». Une seule lecture groupée des fiches de ces listes (sexe seulement).
  const rosterSex = useLiveQuery(async () => {
    if (!allEvents) return undefined
    const ids = [...new Set(allEvents.filter((e) => !e.sex).flatMap((e) => e.playerIds ?? []))]
    const m = new Map<string, string | undefined>()
    for (const p of await db.players.bulkGet(ids)) if (p && !p.deleted) m.set(p.id, p.sex)
    return m
  }, [allEvents])
  const genderOfEvent = (ev: HBEvent): Gender =>
    setGender(ev.sex, rosterSex ? (ev.playerIds ?? []).filter((id) => rosterSex.has(id)).map((id) => ({ sex: rosterSex.get(id) })) : [])
  // Avis comptés une fois par événement (et non pour chaque ligne de la liste).
  const stats = useLiveQuery(async () => {
    const m = new Map<string, EventStats>()
    await db.evaluations.orderBy('eventId').each((e) => {
      if (e.deleted || !e.eventId) return
      let s = m.get(e.eventId)
      if (!s) m.set(e.eventId, (s = { avis: 0, players: new Set() }))
      s.avis++
      s.players.add(e.playerId)
    })
    return m
  }, [], NO_STATS)
  // Depuis un groupe : « Créer un événement » ouvre le formulaire avec ses joueurs.
  const [params, setParams] = useSearchParams()
  const fromGroup = params.get('groupe') ?? undefined
  const [creating, setCreating] = useState(!!fromGroup)
  const [fromSheet, setFromSheet] = useState(false)
  const nav = useNavigate()
  // Ordinateur, événement ouvert à droite : son bouton « Évaluer » est le seul bouton principal de l'écran ;
  // « + Événement » passe en secondaire.
  const detailOpen = !!useSelected('/evenements')
  // Tout afficher, archivés : retrouvés au retour (pendant la session), comme les filtres.
  const [showAll, setShowAll] = useSessionState('handbase.evenements.all', false)
  const [showArchived, setShowArchived] = useSessionState('handbase.evenements.archived', false)
  // Filtres = recette « événements » (même expérience que la liste Joueurs) : champ « Filtrer ou poser une question… »,
  // micro ✨, pastilles, panneau Filtres, calcul sur la sélection ; gardés pendant la session (src/components/EventsQuery.tsx).
  const { filtered: results, active: searching, ui: filterUi, top: filterTop, loading: filterLoading } = useEventsQuery(events, stats)

  if (!events || !allEvents) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const orgOf = (ev: HBEvent) => organizerLabel(ev, units)
  const hiddenByTerritory = allEvents.length - events.length

  // À venir (aujourd'hui compris) du plus proche au plus lointain ; passés du plus récent au plus ancien.
  const todayIso = new Date().toLocaleDateString('sv')
  const upcoming = events.filter((e) => !e.archived && e.date >= todayIso).reverse()
  const past = events.filter((e) => !e.archived && e.date < todayIso)
  const archived = events.filter((e) => e.archived)

  return (
    <div className="flex flex-col gap-3">
      {/* Téléphone étroit : les boutons passent sous le titre plutôt que d'être coupés à droite. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold">Événements</h1>
        {!creating && can.manageEvents(role) && (
          <div className="flex gap-2">
            <button className="btn-ghost whitespace-nowrap px-3 py-1.5 text-xs" title="Nouveau match depuis une feuille de match (PDF FFHB)" onClick={() => setFromSheet(true)}>
              + Feuille de match
            </button>
            <button className={`${detailOpen ? 'btn-ghost' : 'btn-primary'} whitespace-nowrap px-3 py-1.5 text-xs`} onClick={() => setCreating(true)}>
              + Événement
            </button>
          </div>
        )}
      </div>
      {fromSheet && (
        <Suspense fallback={null}>
          <MatchImport
            onClose={(id) => {
              setFromSheet(false)
              if (id) nav(`/evenements/${id}`)
            }}
          />
        </Suspense>
      )}
      {creating && (
        <div className="card p-3">
          <NewEventForm
            groupId={fromGroup}
            onDone={(ev) => {
              setCreating(false)
              if (fromGroup) setParams({}, { replace: true })
              if (ev) nav(`/evenements/${ev.id}`)
            }}
          />
        </div>
      )}
      {territoryOn && allEvents.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <div role="radiogroup" aria-label="Événements affichés" className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
            {(
              [
                ['mes', 'Mes territoires'],
                ['tous', 'Tous'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="radio"
                aria-checked={territory === v}
                onClick={() => setTerritory(v)}
                className={`min-h-9 px-3 ${territory === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted hover:text-fg'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {territory === 'mes' && hiddenByTerritory > 0 && (
            <span>
              {hiddenByTerritory > 1 ? `${hiddenByTerritory} autres événements` : '1 autre événement'} dans « Tous »
            </span>
          )}
        </div>
      )}
      {events.length > 0 && filterUi}
      {filterTop}
      {searching ? (
        <>
          <div className="section-title mt-1 mb-0">
            {filterLoading ? 'Chargement…' : `${results.length} résultat${results.length > 1 ? 's' : ''}`} <span className="text-muted normal-case">(archivés compris)</span>
          </div>
          <div className="cols flex flex-col gap-3">
            {results.map((ev) => (
              <EventRow key={ev.id} ev={ev} g={genderOfEvent(ev)} organizer={orgOf(ev)} stats={stats.get(ev.id)} upcoming={!ev.archived && ev.date >= todayIso} />
            ))}
          </div>
          {!results.length && !filterLoading && <Empty>Aucun événement ne correspond.</Empty>}
        </>
      ) : events.length === 0 && hiddenByTerritory > 0 ? (
        <Empty>Aucun événement organisé dans tes territoires, ni où tu es participant. « Tous » affiche les autres.</Empty>
      ) : events.length === 0 ? (
        <Empty>{can.manageEvents(role) ? 'Crée un match, un tournoi ou une journée de sélection pour que plusieurs personnes puissent y donner leur avis sur les joueurs.' : 'Aucun événement pour l’instant.'}</Empty>
      ) : (
        <>
          <div className="section-title mt-1 mb-0">À venir</div>
          {upcoming.length ? (
            <div className="cols flex flex-col gap-3">
              {upcoming.map((ev) => (
                <EventRow key={ev.id} ev={ev} g={genderOfEvent(ev)} organizer={orgOf(ev)} stats={stats.get(ev.id)} upcoming />
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted">Aucun événement prévu.</p>
          )}
          {past.length > 0 && (
            <>
              <div className="section-title mt-3 mb-0">Passés</div>
              <div className="cols flex flex-col gap-3">
                {past.slice(0, showAll ? undefined : 10).map((ev) => (
                  <EventRow key={ev.id} ev={ev} g={genderOfEvent(ev)} organizer={orgOf(ev)} stats={stats.get(ev.id)} />
                ))}
              </div>
              {past.length > 10 && !showAll && (
                <button className="btn-ghost text-xs" onClick={() => setShowAll(true)}>
                  Afficher les {past.length - 10} plus anciens
                </button>
              )}
            </>
          )}
          {archived.length > 0 && (
            <>
              <button className="section-title mt-3 mb-0 flex items-center gap-1.5 text-left text-muted" onClick={() => setShowArchived(!showArchived)}>
                Archivés ({archived.length}) <span>{showArchived ? '▴' : '▾'}</span>
              </button>
              {showArchived && (
                <div className="cols flex flex-col gap-3">
                  {archived.map((ev) => (
                    <EventRow key={ev.id} ev={ev} g={genderOfEvent(ev)} organizer={orgOf(ev)} stats={stats.get(ev.id)} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Tournoi réparti (supabase/041) : liste découpée par équipe, mes équipes d'abord, puis les autres, puis « Sans équipe » ;
 * dans chaque équipe, par poste (sous-titres, ordre du terrain) puis numéro de maillot, ou par numéro seulement.
 * Titre : progression (vus / total) et observateurs qui en ont la charge. Même ordre que la notation (groupRoster).
 */
function teamSections(list: Player[], ev: HBEvent, sight: Map<string, Sighting[]>, name: (uid: string) => string, byPosition: boolean, g?: Gender) {
  const out: RosterSection[] = []
  let start = 0
  for (const { team: t, mine, players } of teamGroups(list, ev, byPosition)) {
    const seen = players.filter((p) => (sight.get(p.id) ?? []).length).length
    const obs = t.id ? teamObservers(ev, t.id) : []
    const head = {
      heading: t.name,
      team: true,
      mine,
      info: [`${seen} sur ${players.length} ${accord('vu', g, players.length)}`, obs.length ? `suivie par ${obs.map(name).join(', ')}` : ''].filter(Boolean).join(' · '),
    }
    if (byPosition)
      rosterSections(players, true).forEach((s, k) =>
        out.push({ ...(k === 0 ? head : { heading: null }), sub: s.heading ?? undefined, start: start + s.start, players: s.players }),
      )
    else out.push({ ...head, start, players })
    start += players.length
  }
  return out
}

/** Dans combien de jours : « aujourd'hui », « demain », « dans 5 jours ». */
function inDays(date: string) {
  const n = Math.round((new Date(date + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime()) / 86400000)
  return n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : `dans ${n} jours`
}


/** Archiver (après confirmation : retiré des listes, avis gardés) ou désarchiver. Renvoie false si on renonce. */
async function toggleArchiveEvent(ev: HBEvent) {
  if (!ev.archived && !(await ask(`Archiver « ${ev.name} » ? Il n’apparaîtra plus dans Évaluer ni dans la liste ; ses avis sont gardés et comptent toujours.`, { ok: 'Archiver' })))
    return false
  await save<HBEvent>('events', { ...ev, archived: !ev.archived })
  return true
}

/**
 * Supprimer un événement, après confirmation. Chaque avis appartient à un événement : supprimer l'événement supprime
 * ses avis ; les avis des autres évaluateurs ne peuvent être supprimés que par un administrateur. Renvoie true si supprimé.
 */
async function deleteEvent(ev: HBEvent, role: Role) {
  const evals = alive(await db.evaluations.where('eventId').equals(ev.id).toArray())
  const n = evals.length
  if (n && role !== 'admin') {
    await inform(`« ${ev.name} » contient ${n} avis : seul un administrateur peut le supprimer.`)
    return false
  }
  const msg = n
    ? `Supprimer l’événement « ${ev.name} » ? ${n > 1 ? `Ses ${n} avis seront supprimés aussi.` : 'Son avis sera supprimé aussi.'}`
    : `Supprimer l’événement « ${ev.name} » ? Les fiches des ${w(ev.sex).joueurs} ne sont pas touchées.`
  if (!(await ask(msg, { ok: 'Supprimer', focusCancel: true }))) return false
  for (const e of evals) await remove('evaluations', e.id)
  await remove('events', ev.id)
  return true
}

/** Menu d'une ligne d'événement (appui long, clic droit, « ⋮ ») : seulement ce que les droits permettent. */
function EventMenu({ ev, menu }: { ev: HBEvent; menu: ReturnType<typeof useRowMenu> }) {
  const role = useRole()
  const nav = useNavigate()
  const { pathname } = useLocation()
  if (!menu.anchor) return null
  const manage = can.editEvent(role, ev)
  const items: (MenuItem | false)[] = [
    { label: 'Ouvrir', icon: 'calendar', onSelect: () => nav(`/evenements/${ev.id}`) },
    { label: `Évaluer des ${w(ev.sex).joueurs}`, icon: 'check', onSelect: () => nav(`/evaluer?evenement=${ev.id}`) },
    (manage || can.contributeEvent(role, ev)) && { label: `Ajouter des ${w(ev.sex).joueurs}`, icon: 'userPlus', onSelect: () => nav(`/evenements/${ev.id}?ajout=1`) },
    manage && { label: 'Modifier', icon: 'pencil', onSelect: () => nav(`/evenements/${ev.id}?modifier=1`) },
    manage && { label: ev.archived ? 'Désarchiver' : 'Archiver', icon: 'archive', onSelect: () => void toggleArchiveEvent(ev) },
    { label: 'Copier le lien', icon: 'copy', onSelect: () => copyLink(`/evenements/${ev.id}`) },
    manage && {
      label: 'Supprimer',
      icon: 'trash',
      danger: true,
      onSelect: async () => {
        if ((await deleteEvent(ev, role)) && pathname.startsWith(`/evenements/${ev.id}`)) nav('/evenements', { replace: true })
      },
    },
  ]
  return (
    <ItemMenu
      anchor={menu.anchor}
      title={ev.name}
      subtitle={[typeLabel(ev.type), fmtDate(ev.date), ev.place].filter(Boolean).join(' · ')}
      items={items.filter((x): x is MenuItem => !!x)}
      onClose={menu.close}
    />
  )
}

function EventRow({ ev, stats, upcoming = false, organizer, g = ev.sex }: { ev: HBEvent; stats?: EventStats; upcoming?: boolean; organizer?: string; g?: Gender }) {
  const d = new Date(ev.date + 'T00:00:00')
  const today = upcoming && inDays(ev.date) === 'aujourd’hui'
  // Ordinateur : événement ouvert dans le panneau de droite.
  const on = useSelected('/evenements') === ev.id
  const menu = useRowMenu()
  // Ordinateur, un événement déjà ouvert à droite : on passe à un autre en gardant l'onglet choisi (Classement, Vidéo).
  const { search } = useLocation()
  const keep = new URLSearchParams(search).get('onglet')
  const tabQuery = keep && EVENT_TABS.some((t) => t === keep) ? `?onglet=${keep}` : ''
  return (
    <>
    <Link
      to={`/evenements/${ev.id}${tabQuery}`}
      data-md={ev.id}
      aria-current={on || undefined}
      className={`card flex items-center gap-3 p-3 outline-none hover:border-accent focus-visible:border-accent ${MENU_ROW} ${today ? 'border-accent/70' : ''} ${selectedCls(on)}`}
      {...menu.bind}
    >
      <div className={`w-11 shrink-0 rounded-md py-1 text-center leading-tight ${upcoming ? 'bg-accent/15' : 'bg-panel-2'}`}>
        <div className="text-[9px] font-bold text-muted uppercase">{d.toLocaleDateString('fr-FR', { weekday: 'short' })}</div>
        <div className={`text-base font-extrabold ${upcoming ? 'text-accent' : ''}`}>{d.getDate()}</div>
        <div className="text-[9px] text-muted">{d.toLocaleDateString('fr-FR', { month: 'short', ...(d.getFullYear() !== new Date().getFullYear() && { year: '2-digit' }) })}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-bold">
          {ev.name}
          {ev.archived && <span className="ml-1.5 rounded bg-panel-2 px-1 py-px align-middle text-[9px] text-muted">ARCHIVÉ</span>}
        </div>
        <div className="truncate text-[11px] text-muted">
          {typeLabel(ev.type)}
          {ev.place ? ` · ${ev.place}` : ''}
        </div>
        {organizer && <div className="truncate text-[10px] text-muted">Organisé par : {organizer}</div>}
        {upcoming &&<div className="text-[11px] font-bold text-accent">{inDays(ev.date)}</div>}
      </div>
      <div className="shrink-0 text-right text-[11px] text-muted">
        {/* Avant l'événement : les convoqués ; dès qu'il y a des avis : joueurs notés et nombre d'avis. */}
        {stats ? (
          <>
            <div>
              <b className="text-fg">{stats.players.size}</b> {accord('joueur', g, stats.players.size)}
            </div>
            <div>
              <b className="text-fg">{stats.avis}</b> avis
            </div>
          </>
        ) : (
          (ev.playerIds ?? []).length > 0 && (
            <div>
              <b className="text-fg">{(ev.playerIds ?? []).length}</b> {accord('convoqué', g, (ev.playerIds ?? []).length)}
            </div>
          )
        )}
      </div>
      <MenuButton onOpen={menu.open} open={!!menu.anchor} inLink label={`Actions pour « ${ev.name} »`} className="-mr-1.5" />
    </Link>
    <EventMenu ev={ev} menu={menu} />
    </>
  )
}

export function EventDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const role = useRole()
  const teams = useTeams() ?? []
  const units = useUnits()
  const per = usePerimeter()
  // « Ajouter des joueurs », « Modifier » depuis le menu d'une ligne de la liste : ?ajout=1, ?modifier=1 (comme les groupes).
  const [params, setParams] = useSearchParams()
  const loc = useLocation()
  // Onglet dans l'adresse (?onglet=classement, ?onglet=video ; Joueurs par défaut) : « Retour » depuis une fiche ouverte
  // ici ramène sur le même onglet, et un lien vers la vidéo d'un événement ouvre directement l'onglet Vidéo.
  const tab: EventTab = EVENT_TABS.find((t) => t === params.get('onglet')) ?? 'joueurs'
  const setTab = (t: EventTab) => {
    if (t === tab) return
    const next = new URLSearchParams(params)
    if (t === 'joueurs') next.delete('onglet')
    else next.set('onglet', t)
    setParams(next, { replace: true, state: loc.state })
  }
  // Infos secondaires (organisateur, avis donnés par, participants, création) : repliées, dépliées pendant la session.
  const [infos, setInfos] = useSessionState('handbase.evenement.infos', false)
  const [adding, setAdding] = useState(params.has('ajout'))
  const [editing, setEditing] = useState(params.has('modifier'))
  useEffect(() => {
    const add = params.has('ajout')
    const edit = params.has('modifier')
    if (!add && !edit) return
    setAdding(add)
    setEditing(edit)
    const next = new URLSearchParams(params)
    next.delete('ajout')
    next.delete('modifier')
    setParams(next, { replace: true })
  }, [id, params, setParams])
  // « Retirer des joueurs » : les croix n'apparaissent qu'en mode retrait (sinon, l'étoile pour suivre).
  const [removing, setRemoving] = useState(false)
  const [importing, setImporting] = useState(false)
  // Liste des joueurs : toujours par poste ; dans chaque poste, l'ordre choisi (gardé sur l'appareil pour cet
  // événement, repris par la notation). Filtres rapides : masquer ceux que j'ai notés, un poste.
  const [sort, setSort] = useRosterSort(id)
  // Filtres partagés avec la notation : elle ne propose que les joueurs affichés ici.
  const { pos: posFilter, setPos: setPosFilter, hideNoted, setHideNoted } = useRosterFilter(id)
  // Couverture de l'équipe d'observateurs (supabase/041) : filtre de la liste (gardé pendant la session) ;
  // événement réparti en équipes : liste par équipe et poste (par défaut), par équipe et numéro, ou par poste.
  const [cover, setCover] = useSessionState<CoverageFilter>(`handbase.couverture.${id}`, 'tous')
  const [groupBy, setGroupBy] = useRosterGroup(id)
  const panel = usePanel()
  // Ordinateur : boutons en barre d'actions compacte ; et liste des joueurs à gauche, avis du joueur choisi à droite
  // (dans le panneau, qui passe alors en pleine largeur ; sur téléphone, les avis se déplient sous la ligne).
  const bar = useMedia(MQ.side)
  const [boxRef, boxW] = useWidth<HTMLDivElement>()
  const duo = bar && (!!panel || boxW >= 680)
  // Joueur dont les avis sont ouverts (un seul à la fois). Téléphone : dépliés sous sa ligne, retenus pendant la session.
  // Ordinateur : dans l'adresse (?avis=<id>) : le retour du navigateur les ferme, et revenir d'une fiche les retrouve.
  const [avis, setAvis] = useSessionState<{ ev?: string; pid: string } | null>('handbase.evenement.avis', null)
  const urlAvis = params.get('avis')
  const openAvis = duo ? urlAvis : avis && avis.ev === id ? avis.pid : null
  function showAvis(pid: string | null) {
    if (!duo) return setAvis(pid ? { ev: id, pid } : null)
    const state = (loc.state ?? {}) as Record<string, unknown>
    // Fermer des avis ouverts ici : retour à l'entrée d'avant (liste des événements, à sa position).
    if (!pid && state.avis) return void nav(-1)
    const next = new URLSearchParams(params)
    if (pid) next.set('avis', pid)
    else next.delete('avis')
    // Premiers avis ouverts : nouvelle entrée d'historique ; d'un joueur à l'autre, on remplace.
    if (pid && !urlAvis) setParams(next, { state: { ...state, avis: true } })
    else setParams(next, { replace: true, state })
  }
  const toggleAvis = (pid: string) => showAvis(openAvis === pid ? null : pid)
  // « Comparer » : cases à cocher sur les joueurs (liste et classement), deux à comparer.
  const pick = useComparePick()
  const data = useLiveQuery(async () => {
    const ev = await db.events.get(id!)
    const evals = alive(await db.evaluations.where('eventId').equals(id!).toArray())
    const ids = [...new Set([...(ev?.playerIds ?? []), ...evals.map((e) => e.playerId)])]
    const got = (await db.players.bulkGet(ids)).filter((p): p is Player => !!p)
    const players = alive(got)
    // Joueurs de la liste absents de l'appareil : hors du périmètre du compte (supabase/046), comptés sans leur nom.
    const onDevice = new Set(got.map((p) => p.id))
    const hidden = (ev?.playerIds ?? []).filter((pid) => !onDevice.has(pid))
    // Critères (libellés à jour) pour détailler les notes des avis.
    const criteria = alive(await db.criteria.orderBy('order').toArray())
    // Repérage (supabase/041) : « vu » de l'équipe ; « à revoir » repérés ici (origine) ou qui visent cet événement.
    const seen = alive(await db.seen.where('eventId').equals(id!).toArray())
    const rewatch = alive(await db.rewatch.toArray()).filter((r) => r.originEventId === id || r.events?.includes(id!))
    const known = new Set(players.map((p) => p.id))
    const extra = alive((await db.players.bulkGet([...new Set(rewatch.map((r) => r.playerId))].filter((x) => !known.has(x)))).filter((p): p is Player => !!p))
    const origins = (await db.events.bulkGet([...new Set(rewatch.map((r) => r.originEventId).filter((x): x is string => !!x))])).filter((e): e is HBEvent => !!e)
    // Vidéos de l'événement (même filtre que la section Vidéos) : nombre affiché sur l'onglet Vidéo.
    const nVideos = (await db.videos.where('targetId').equals(id!).toArray()).filter((v) => !v.deleted && v.targetKind === 'event' && v.url).length
    return { ev, evals, players, criteria, seen, rewatch, extra, origins, hidden, nVideos }
  }, [id])

  // Retour d'une fiche ouverte depuis la liste : même position qu'avant.
  useRestoreScroll(`evenement.${id}`, !!data)

  // Avis affichés à côté de la liste des joueurs : le panneau prend toute la largeur (liste des événements masquée),
  // joueurs sur un tiers, avis sur deux tiers. Échap ferme les avis (la liste revient) ; ↑ ↓ changent de joueur.
  const avisShown = duo && tab === 'joueurs' && !adding && !!openAvis && !!data?.players.some((p) => p.id === openAvis)
  const setFocus = panel?.setFocus
  useEffect(() => {
    if (!setFocus) return
    setFocus(avisShown)
    return () => {
      setFocus(false)
    }
  }, [setFocus, avisShown])
  // Joueurs dont on peut lire les avis, dans l'ordre affiché (rempli au rendu).
  const avisOrder = useRef<string[]>([])
  const avisKeys = useRef({ openAvis, showAvis })
  avisKeys.current = { openAvis, showAvis }
  useEffect(() => {
    if (!avisShown) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      if (document.querySelector('[aria-modal="true"], .fixed.inset-0')) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      const { openAvis: cur, showAvis: go } = avisKeys.current
      if (e.key === 'Escape') {
        e.preventDefault()
        go(null)
        return
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (t === document.body || t === document.documentElement || !!t.closest('[data-avis-nav]'))) {
        e.preventDefault()
        const order = avisOrder.current
        const next = order[order.indexOf(cur ?? '') + (e.key === 'ArrowDown' ? 1 : -1)]
        if (!next) return
        go(next)
        // La ligne du joueur reste visible dans la liste.
        requestAnimationFrame(() => {
          document.querySelector(`[data-avis-row="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' })
        })
      }
    }
    // Capture : avant le panneau, qui sinon fermerait l'événement (Échap) ou parcourrait la liste masquée (↑ ↓).
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
    }
  }, [avisShown])

  // Match importé d'une feuille avant la répartition en équipes : l'organisateur ou un participant qui l'ouvre
  // range une fois (par appareil) les joueurs dans les deux équipes de la feuille. Retirer ces équipes ensuite ne les
  // fait pas revenir ; « Reprendre les deux équipes de la feuille de match » reste dans la répartition.
  const autoEv = data?.ev
  const autoEdit = !!autoEv && (can.editEvent(role, autoEv) || can.contributeEvent(role, autoEv))
  useEffect(() => {
    if (!autoEv || !autoEdit || !autoEv.matchSheet || autoEv.tournament || autoEv.deleted) return
    if (!sheetPlayersWithoutTeam(undefined, autoEv.matchSheet, autoEv.playerIds ?? [])) return
    const k = `handbase.equipesFeuille.${autoEv.id}`
    try {
      if (localStorage.getItem(k)) return
      localStorage.setItem(k, '1')
    } catch {
      return
    }
    void saveTournament(autoEv, (t) => (t.teams.length ? t : teamsFromSheet(t, autoEv.matchSheet!, autoEv.playerIds ?? [])))
  }, [autoEv, autoEdit])

  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const { ev, evals, players, criteria, seen, rewatch, extra, origins, hidden, nVideos } = data
  if (!ev || ev.deleted) return <div className="py-20 text-center text-sm text-muted">Événement introuvable.</div>

  const byId = new Map(players.map((p) => [p.id, p]))
  // Mes avis sur cet événement : ✓ dans la liste, filtre « Masquer ceux que j'ai notés ».
  const notedByMe = new Set(evals.filter(isMine).map((e) => e.playerId))
  const roster = sortRoster(
    (ev.playerIds ?? []).map((pid) => byId.get(pid)).filter((p): p is Player => !!p),
    sort,
  )
  const shownRoster = filterRoster(roster, { pos: posFilter, hideNoted }, notedByMe)
  // Accord au genre (src/gender.ts) : sexe déclaré de l'événement, sinon déduit de la liste (toutes des filles → féminin).
  const eg = setGender(ev.sex, roster)
  const ew = w(eg)
  const filtered = shownRoster.length < roster.length
  // Couverture de l'équipe : vu (« vu » ou avis), noté, à revoir (repéré ici). Uniquement des marques positives.
  const sight = sightings(seen, evals)
  const notedSet = new Set(evals.map((e) => e.playerId))
  const rewatchFrom = new Map<string, Rewatch[]>()
  for (const r of rewatch) if (r.originEventId === ev.id) rewatchFrom.set(r.playerId, [...(rewatchFrom.get(r.playerId) ?? []), r])
  const isSeen = (p: Player) => (sight.get(p.id) ?? []).length > 0
  const coverOk = (p: Player) =>
    cover === 'pasvus' ? !isSeen(p) : cover === 'vus' ? isSeen(p) : cover === 'notes' ? notedSet.has(p.id) : cover === 'arevoir' ? rewatchFrom.has(p.id) : true
  const displayed = shownRoster.filter(coverOk)
  // Tournoi réparti : équipes, mes équipes et leur progression.
  const tTeams = tournamentTeams(ev)
  const myTeams = myTournamentTeams(ev)
  const byTeam = tTeams.length > 0 && groupBy !== 'poste'
  const teamName = (pid: string) => tTeams.find((t) => t.id === teamOf(ev, pid))?.name
  const myRoster = roster.filter((p) => myTeams.has(teamOf(ev, p.id) ?? ''))
  const nameOf = (uid: string) => personName(uid, ev, teams)
  // Titres de poste, sauf si aucun joueur n'a de poste (un seul titre « Sans poste » n'apporterait rien).
  const withHeadings = roster.some((p) => p.position)
  const nNotedInRoster = roster.filter((p) => notedByMe.has(p.id)).length
  // « Évaluer » ouvre le premier joueur que je n'ai pas encore noté, dans l'ordre choisi.
  // Avec un filtre, seulement parmi les joueurs affichés.
  const firstToRate = shownRoster.find((p) => !notedByMe.has(p.id)) ?? shownRoster[0]
  // Joueurs notés sur l'événement sans être dans la liste (ex. avis d'un observateur).
  const inRoster = new Set(ev.playerIds ?? [])
  const offList = players.filter((p) => !inRoster.has(p.id) && evals.some((e) => e.playerId === p.id))
  const observers = [...new Set(evals.map((e) => e.observer))].sort()
  // Hors liste : avis en attente (à décider) et joueurs dont aucun avis n'attend (à ajouter, ou anciens).
  const pendingOff = evals.filter((e) => e.review === 'pending' && offList.some((p) => p.id === e.playerId))
  const settled = offList.filter((p) => !pendingOff.some((e) => e.playerId === p.id) && evals.some((e) => e.playerId === p.id && counts(e)))
  const manage = can.editEvent(role, ev)
  const organizerName = organizerLabel(ev, units)
  // Vu seulement grâce à mes joueurs (048, règle (d) : organisateur hors de mes territoires, ni créateur ni participant) :
  // lecture seule, mention discrète sous « Organisé par ».
  const viaMyPlayers = per
    ? seenThroughMyPlayers(ev, { per, userId: currentUserId(), units, participant: (x) => isParticipant(x), player: (pid) => byId.get(pid) })
    : 0
  // Participant (supabase/024) : ajoute des joueurs, retire les siens, co-organise les avis hors liste.
  const contribute = can.contributeEvent(role, ev)
  const who = (uid?: string) => (uid ? (ev.names?.[uid] ?? (uid === ev.createdBy ? ev.createdByName : undefined)) : undefined)
  const addedByOf = (pid: string) => who(ev.addedBy?.[pid] ?? ev.createdBy)

  async function setRoster(ids: string[]) {
    // « Ajouté par » des nouveaux joueurs : posé ici pour l'affichage ; le serveur le refait (024).
    const me = currentUserId()
    const added = ids.filter((id) => !(ev!.playerIds ?? []).includes(id))
    await save<HBEvent>('events', {
      ...ev!,
      playerIds: ids,
      ...(me && added.length && { addedBy: { ...ev!.addedBy, ...Object.fromEntries(added.map((id) => [id, me])) } }),
    })
  }

  // « Évaluer » ouvre le premier joueur à noter ; « + Ajouter des joueurs » devient le geste principal quand la liste est vide.
  const canAdd = manage || contribute
  const addFirst = canAdd && roster.length === 0
  const evaluate = (cls: string) => (
    <Link to={`/evaluer?evenement=${ev.id}${firstToRate ? `&joueur=${firstToRate.id}` : ''}`} className={cls}>
      {filtered
        ? `Évaluer les ${pluralG(shownRoster.length, eg, 'joueur affiché')}`
        : `Évaluer ${roster.length ? `les ${pluralG(roster.length, eg)}` : `des ${ew.joueurs}`}`}
    </Link>
  )
  const addButton = (cls: string, label = `+ Ajouter des ${ew.joueurs}`) => (
    <button className={cls} onClick={() => setAdding(true)}>
      {label}
    </button>
  )
  // Feuille de match : importée depuis le formulaire « Modifier », ou depuis l'onglet Vidéo tant qu'il n'y en a pas.
  const importSheet = !ev.matchSheet && manage && (
    <button
      type="button"
      className="btn-ghost w-full py-1.5 text-xs"
      onClick={() => {
        setEditing(false)
        setImporting(true)
      }}
    >
      + Importer une feuille de match (PDF)
    </button>
  )

  // Onglets : Joueurs, Classement, Vidéo (vidéos et feuille de match). Tout le monde peut ajouter une vidéo : l'onglet
  // Vidéo est toujours là ; son nombre de vidéos, ou un point discret s'il n'y a qu'une feuille de match.
  const tabs = (cls = '') => (
    <div role="tablist" aria-label="Contenu de l’événement" className={`flex overflow-hidden rounded-md border border-line text-xs font-bold ${cls}`}>
      {(
        [
          ['joueurs', `${ew.Joueurs} (${roster.length})`],
          ['classement', 'Classement'],
          ['video', nVideos ? `Vidéo (${nVideos})` : 'Vidéo'],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          role="tab"
          aria-selected={tab === v}
          data-tab={v}
          onClick={() => setTab(v)}
          className={`min-w-0 flex-1 truncate px-1 ${bar ? 'py-1.5' : 'py-2'} ${tab === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}
        >
          {label}
          {v === 'video' && !nVideos && ev.matchSheet && (
            <span className={`ml-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${tab === v ? 'bg-white' : 'bg-accent'}`} title="Feuille de match importée" />
          )}
        </button>
      ))}
    </div>
  )
  const sections = byTeam ? teamSections(displayed, ev, sight, nameOf, groupBy === 'equipe-poste' && withHeadings, eg) : rosterSections(displayed, withHeadings)
  // Joueur dont les avis sont affichés dans la colonne de droite (mode « duo »).
  const avisPlayer = avisShown ? players.find((p) => p.id === openAvis) : undefined
  // ↑ ↓ : joueurs de la liste affichée puis hors liste, ceux qui ont des avis.
  const withAvis = new Set(evals.map((e) => e.playerId))
  avisOrder.current = [...sections.flatMap((sec) => sec.players), ...settled].map((p) => p.id).filter((pid) => withAvis.has(pid))

  // Retirer un joueur depuis le menu de sa ligne : toujours après confirmation.
  async function removeOne(p: Player) {
    const n = evals.filter((e) => e.playerId === p.id).length
    const msg = `Retirer ${p.lastName.toUpperCase()} ${p.firstName} de « ${ev!.name} » ? ${n ? `Ses ${n > 1 ? `${n} avis` : 'avis'} sur cet événement ${n > 1 ? 'sont conservés' : 'est conservé'}.` : 'Sa fiche n’est pas touchée.'}`
    if (await ask(msg, { ok: 'Retirer', focusCancel: true })) await setRoster((ev!.playerIds ?? []).filter((x) => x !== p.id))
  }

  return (
    <PlayerMenuScope.Provider value={{ pick, eventId: ev.id }}>
    <div ref={boxRef} className="flex flex-col gap-4">
      {/* En-tête : retour, puis les actions de l'événement dans le ⋮ (Supprimer en dernier, avec confirmation). */}
      <PageHeader
        back={
          avisPlayer && panel ? (
            // Avis ouverts en pleine largeur : on revient à la liste des événements en fermant les avis.
            <button onClick={() => showAvis(null)} title="Fermer les avis et afficher la liste des événements (Échap)" className="text-left text-xs font-bold text-muted hover:text-fg">
              ← LISTE DES ÉVÉNEMENTS
            </button>
          ) : panel ? (
            <PanelClose />
          ) : (
            <BackButton fallback="/evenements" label="ÉVÉNEMENTS" />
          )
        }
        menu={{
          title: ev.name,
          subtitle: [typeLabel(ev.type), fmtDate(ev.date), ev.place].filter(Boolean).join(' · '),
          items: [
            manage && !editing && { label: 'Modifier', icon: 'pencil', onSelect: () => setEditing(true) },
            // Archiver : retiré des listes (Évaluer, événements), avis conservés.
            manage && { label: ev.archived ? 'Désarchiver' : 'Archiver', icon: 'archive', hint: ev.archived ? undefined : 'avis conservés', onSelect: () => void toggleArchiveEvent(ev) },
            { label: 'Copier le lien', icon: 'copy', onSelect: () => copyLink(`/evenements/${ev.id}`) },
            manage && {
              label: 'Supprimer',
              icon: 'trash',
              danger: true,
              onSelect: async () => {
                if (await deleteEvent(ev, role)) nav('/evenements', { replace: true })
              },
            },
          ],
        }}
      />
      {editing ? (
        <div className="card p-3">
          <NewEventForm event={ev} onDone={() => setEditing(false)} extra={importSheet} />
        </div>
      ) : (
        <div>
          {ev.archived && <div className="mb-1 w-fit rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold text-muted">ARCHIVÉ</div>}
          <h1 className="text-lg font-extrabold">{ev.name}</h1>
          <div className="text-xs text-muted">
            {typeLabel(ev.type)} · {fmtDate(ev.date)}
            {ev.time ? ` · ${ev.time}` : ''}
            {ev.place ? ` · ${ev.place}` : ''}
          </div>
          {/* Infos secondaires repliées en une ligne : l'entrée de l'événement va droit aux onglets. */}
          <button
            type="button"
            className="mt-1 flex max-w-full items-center gap-1 text-left text-[11px] text-muted hover:text-fg"
            aria-expanded={infos}
            onClick={() => setInfos(!infos)}
          >
            <span className="shrink-0 font-bold">Infos</span>
            {!infos && <span className="min-w-0 truncate">· {organizerName ? `Organisé par : ${organizerName}` : 'organisateur, participants, historique'}</span>}
            <span className={`shrink-0 transition-transform ${infos ? 'rotate-90' : ''}`} aria-hidden>
              ›
            </span>
          </button>
          {infos && (
            <div className="mt-0.5 border-l-2 border-line pl-2" data-testid="infos-evenement">
              <div className="text-[11px] text-muted">{organizerName ? `Organisé par : ${organizerName}` : 'Organisateur non précisé'}</div>
              {observers.length > 0 && <div className="mt-1 text-[11px] text-muted">Avis donnés par : {observers.join(', ')}</div>}
              <Participants
                x={ev}
                teams={teams}
                who={who}
                onLeave={
                  contribute
                    ? async () => {
                        if (!(await ask(`Te retirer des participants de « ${ev.name} » ? Les ${ew.joueurs} que tu as ${accord('ajouté', eg, 2)} restent dans la liste.`, { ok: 'Me retirer' }))) return
                        const me = currentUserId()
                        await save<HBEvent>('events', { ...ev, editors: (ev.editors ?? []).filter((u) => u !== me) })
                      }
                    : undefined
                }
              />
              <StampLine row={ev} />
            </div>
          )}
          {viaMyPlayers > 0 && (
            <div className="text-[11px] italic text-muted" data-testid="vu-par-mes-joueurs">
              Tu vois cet événement parce que {viaMyPlayers === 1 ? `1 de tes ${ew.joueurs} y est ${ew.inscrit}` : `${viaMyPlayers} de tes ${ew.joueurs} y sont ${ew.inscrits}`}
            </div>
          )}
        </div>
      )}

      {importing && (
        <Suspense fallback={null}>
          <MatchImport event={ev} onClose={() => setImporting(false)} />
        </Suspense>
      )}

      {/* Ordinateur : une barre d'actions compacte. Liste vide : « + Ajouter des joueurs » passe en bouton principal. */}
      {bar && (
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'video' ? null : addFirst && tab === 'joueurs' && !adding ? (
            <>
              {addButton('btn-primary px-3 py-1.5 text-xs')}
              {evaluate('btn-ghost px-3 py-1.5 text-xs')}
            </>
          ) : (
            <>
              {evaluate('btn-primary px-3 py-1.5 text-xs')}
              {tab === 'joueurs' && !adding && canAdd && addButton('btn-ghost px-3 py-1.5 text-xs')}
            </>
          )}
          {tabs('ml-auto min-w-64 max-w-80 flex-1')}
        </div>
      )}

      {/* Téléphone : les joueurs d'abord ; « Évaluer » vient juste au-dessus de la liste, après la couverture. */}
      {!bar && tabs()}
      {!bar && tab === 'classement' && evaluate('btn-primary')}

      {/* Joueurs : la répartition par équipe en haut (repliée), puis la liste. */}
      {tab === 'joueurs' && !adding && !editing && (ev.type === 'tournoi' || tTeams.length > 0 || !!ev.matchSheet) && (
        <TournamentPanel ev={ev} roster={roster} sight={sight} edit={manage || contribute} manage={manage} teams={teams} g={eg} />
      )}

      {/* Vidéo : vidéos, feuille de match (calage, moments, déroulé) et son import. Toujours monté, seulement masqué sur
          les autres onglets : le lecteur (VideoDock), le mode édition du séquençage et l'état des cartes (déroulé ouvert…)
          ne se ferment ni ne se rechargent en changeant d'onglet. */}
      {!editing && (
        <div role="tabpanel" data-testid="onglet-video" aria-hidden={tab !== 'video'} className={tab === 'video' ? 'flex flex-col gap-4' : 'hidden'}>
          <VideoSection
            kind="event"
            targetId={ev.id}
            sheet={ev.matchSheet ? { ms: ev.matchSheet, canEdit: can.calibrateMatch(role, { eventId: ev.id }) } : undefined}
            tools={
              ev.matchSheet
                ? (v, api) => (
                    <Suspense fallback={null}>
                      <MatchSyncTools eventId={ev.id} video={v} api={api} />
                    </Suspense>
                  )
                : undefined
            }
            bar={
              ev.matchSheet
                ? (v, api) => (
                    <Suspense fallback={null}>
                      <MatchTimeline eventId={ev.id} video={v} eventVideo api={api} />
                    </Suspense>
                  )
                : undefined
            }
          />
          {ev.matchSheet ? (
            <Suspense fallback={null}>
              <MatchSheetCard ev={ev} manage={manage} />
            </Suspense>
          ) : (
            manage && (
              <div className="card flex flex-col gap-2 p-4">
                <div className="section-title flex items-center gap-2">
                  <Icon name="list" className="h-3.5 w-3.5" />
                  Feuille de match
                </div>
                <p className="text-[11px] text-muted">
                  Feuille de match électronique FFHB (PDF lu sur l’appareil, jamais gardé) : score, {ew.joueurs} {accord('relié', eg, 2)} aux fiches et déroulé, à caler ensuite sur
                  la vidéo du match.
                </p>
                {importSheet}
              </div>
            )
          )}
        </div>
      )}

      {tab === 'video' ? null : tab === 'joueurs' ? (
        adding ? (
          <AddPlayers g={eg} current={ev.playerIds ?? []} onCancel={() => setAdding(false)} onAdd={async (ids) => (await setRoster([...(ev.playerIds ?? []), ...ids]), setAdding(false))} />
        ) : (
          // Deux colonnes seulement quand un joueur est choisi : sinon la liste (et « Notés hors liste ») prend toute la largeur.
          // Panneau en pleine largeur : joueurs sur un tiers (une colonne de cartes), avis sur deux tiers.
          <div
            className={avisPlayer ? 'grid items-start gap-4' : ''}
            style={avisPlayer ? { gridTemplateColumns: panel ? 'clamp(19rem, 33%, 34rem) minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)' } : undefined}
          >
          <div className={`flex flex-col gap-2 ${duo ? 'md-box' : ''}`}>
            {duo && !avisPlayer && (
              <p className="text-[11px] text-muted">
                {evals.length ? `Choisis « avis » sur la ligne d’${ew.unJoueur} : ses avis et son radar s’affichent à droite.` : 'Aucun avis pour l’instant sur cet événement.'}
              </p>
            )}
            {!bar &&
              canAdd &&
              (addFirst ? addButton('btn-primary') : addButton('btn-ghost text-xs', `+ Ajouter des ${ew.joueurs} (par groupe ou ${ew.un} par ${ew.un})`))}
            {!bar && roster.length === 0 && evaluate(addFirst ? 'btn-ghost text-xs' : 'btn-primary')}
            <RewatchInEvent
              ev={ev}
              rows={rewatch.filter((r) => r.events?.includes(ev.id))}
              players={new Map([...players, ...extra].map((p) => [p.id, p]))}
              events={new Map(origins.map((e) => [e.id, e]))}
              sight={sight}
              canAdd={manage || contribute}
              g={eg}
              onAdd={(ids) => void setRoster([...(ev.playerIds ?? []), ...ids.filter((x) => !inRoster.has(x))])}
            />
            {offList.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-amber-200">{accord('Noté', genderOf(offList), 2)} hors liste ({offList.length})</div>
                  {(manage || contribute) && settled.length > 0 && (
                    <button className="btn-ghost px-3 py-1 text-xs" onClick={() => void setRoster([...(ev.playerIds ?? []), ...settled.map((p) => p.id)])}>
                      Ajouter {settled.length > 1 ? `les ${settled.length}` : w(settled[0]?.sex).leJoueur} à la liste
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-muted">
                  {w(genderOf(offList)).Joueurs} {accord('repéré', genderOf(offList), 2)} sur place. Un avis en attente validé compte dans les moyennes et ajoute {w(genderOf(offList)).leJoueur} à la liste ; hors cadre, il est gardé
                  sans compter.
                </p>
                {/* Avis à valider : en grand, avec les boutons de décision. */}
                {pendingOff.length > 0 && (
                  <div className="cols mt-2 flex flex-col gap-2">
                    {pendingOff.map((e) => {
                      const p = offList.find((x) => x.id === e.playerId)!
                      return <AvisCard key={e.id} e={e} where={ev.name} role={role} player={p} dept={department(p)} event={ev} criteria={criteria} />
                    })}
                  </div>
                )}
                {/* Joueurs hors liste dont les avis ne sont pas en attente (anciens avis, organisateur…) : en bref. */}
                {settled.length > 0 && (
                  <div className="cols mt-2 flex flex-col gap-1 gap-x-6">
                    {settled.map((p) => (
                      <div key={p.id} data-avis-row={p.id} className={`flex flex-col gap-1 ${openAvis === p.id && !duo ? 'col-span-full' : ''}`}>
                        <div className={`flex items-center justify-between gap-2 rounded text-xs ${duo && openAvis === p.id ? 'bg-accent/10' : ''}`}>
                          <Link to={`/joueurs/${p.id}`} className="truncate">
                            <b>
                              {p.lastName.toUpperCase()} {p.firstName}
                            </b>
                            <span className="text-muted"> · {[p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}</span>
                          </Link>
                          <AvisToggle n={evals.filter((e) => e.playerId === p.id).length} open={openAvis === p.id} side={duo} onClick={() => toggleAvis(p.id)} />
                        </div>
                        {openAvis === p.id && !duo && <EventAvis player={p} evals={evals} criteria={criteria} event={ev} />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <HiddenPlayers count={hidden.length} />
            {roster.length === 0 ? (
              offList.length || hidden.length ? null : <Empty>{ew.AucunJoueur} dans la liste. {manage ? `Ajoute un groupe (club + année…) ou des ${ew.joueurs} ${ew.un} par ${ew.un}.` : ''}</Empty>
            ) : (
              <>
                <CoverageBar
                  total={roster.length}
                  seen={roster.filter(isSeen).length}
                  noted={roster.filter((p) => notedSet.has(p.id)).length}
                  rewatch={roster.filter((p) => rewatchFrom.has(p.id)).length}
                  mine={myRoster.length ? { seen: myRoster.filter(isSeen).length, total: myRoster.length } : undefined}
                  filter={cover}
                  setFilter={setCover}
                  g={eg}
                />
                {!bar && evaluate('btn-primary')}
                {(roster.length > 1 || roster.some((p) => can.removeFromEvent(role, ev, p.id))) && (
                  <div className="flex items-center justify-end gap-3">
                    {roster.length > 1 && !removing && <CompareToggle pick={pick} className="mr-auto" />}
                    {manage && roster.length > 1 && removing && (
                      <button
                        className="text-[11px] font-bold text-muted underline"
                        onClick={async () => (await ask(`Retirer les ${pluralG(roster.length, eg)} de la liste ? Les avis déjà donnés sont conservés.`, { ok: 'Vider la liste' })) && void setRoster(hidden)}
                      >
                        Vider la liste
                      </button>
                    )}
                    {!pick.on && roster.some((p) => can.removeFromEvent(role, ev, p.id)) && (
                      <button
                        className={`rounded-md border px-2 py-1 text-[11px] font-bold transition ${removing ? 'border-accent bg-accent text-white' : 'border-line text-muted hover:text-fg'}`}
                        onClick={() => setRemoving((r) => !r)}
                      >
                        {removing ? 'Terminé' : `Retirer des ${ew.joueurs}`}
                      </button>
                    )}
                  </div>
                )}
                {roster.length > 1 && (
                  <RosterControls
                    roster={roster}
                    sort={sort}
                    setSort={setSort}
                    pos={posFilter}
                    setPos={setPosFilter}
                    showSort={!byTeam}
                    top={
                      tTeams.length > 0 && (
                        <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
                          {ROSTER_GROUPS.map(({ value: v, label }) => (
                            <button
                              key={v}
                              onClick={() => setGroupBy(v)}
                              aria-pressed={groupBy === v}
                              className={`min-h-8 flex-1 px-1 py-1 leading-tight ${groupBy === v ? 'bg-accent text-white' : 'bg-panel text-muted'}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )
                    }
                    chips={
                      nNotedInRoster > 0 && (
                        <RosterChip on={hideNoted} onClick={() => setHideNoted(!hideNoted)}>
                          Masquer {ew.ceux} que j’ai {accord('noté', eg, 2)} ({nNotedInRoster})
                        </RosterChip>
                      )
                    }
                    note={`La notation (flèches, glisser) suit cet ordre${filtered ? ` et ne propose que les ${ew.joueurs} ${accord('affiché', eg, 2)}` : ''}.`}
                  />
                )}
                {shownRoster.length === 0 && (
                  <Empty>{hideNoted ? `Tu as ${accord('noté', eg, 2)} ${ew.tousLesJoueurs} ${accord('affiché', eg, 2)}.` : `${ew.AucunJoueur} à ce poste.`}</Empty>
                )}
                {shownRoster.length > 0 && displayed.length === 0 && (
                  <Empty>{cover === 'pasvus' ? `L’équipe a ${accord('vu', eg, 2)} ${ew.tousLesJoueurs} ${accord('affiché', eg, 2)}.` : `${ew.AucunJoueur} pour ce filtre.`}</Empty>
                )}
                {/* Un titre à chaque nouveau poste (ou équipe) ; sous chaque titre, les joueurs (en colonnes sur grand écran). */}
                <RosterSectionList
                  sections={sections}
                  row={(p, i) => {
                  const n = evals.filter((e) => e.playerId === p.id).length
                  return (
                    // Avis ouverts : le joueur prend toute la ligne.
                    <div key={p.id} data-avis-row={p.id} className={`flex flex-col gap-2 ${openAvis === p.id && !duo ? 'col-span-full' : ''}`}>
                    {/* La photo ouvre la fiche dans l'événement (ses joueurs seulement autour, EventPlayers.tsx ; le retour revient
                        ici, à la même position) ; le reste de la ligne mène à l'évaluation. */}
                    <PlayerRow
                      p={p}
                      selected={duo && openAvis === p.id}
                      className={pick.picked.includes(p.id) ? 'border-accent' : ''}
                      lead={
                        <>
                          <PickBox pick={pick} p={p} />
                          <span className="w-6 shrink-0 text-center text-[11px] text-muted" title={byTeam ? 'Numéro de maillot' : undefined}>
                            {byTeam ? (numOf(ev, p.id) ?? '–') : i + 1}
                          </span>
                        </>
                      }
                      avatarLink={{ to: `/evenements/${ev.id}/joueurs/${p.id}`, state: { md: true }, onClick: () => rememberScroll(`evenement.${ev.id}`) }}
                      link={{ to: `/evaluer?evenement=${ev.id}&joueur=${p.id}` }}
                      sub={playerSub(p, !byTeam && numOf(ev, p.id) && `n° ${numOf(ev, p.id)}`, !byTeam && teamName(p.id))}
                      lines={
                        <>
                          {!!ev.editors?.length && addedByOf(p.id) && <span className="truncate text-[10px] text-muted">{w(p.sex).ajoute} par {addedByOf(p.id)}</span>}
                          {!removing && (
                            <span className="mt-0.5 flex min-w-0 items-center gap-2 empty:hidden">
                              <SeenBy list={sight.get(p.id) ?? []} sex={p.sex} />
                              <RewatchButton playerId={p.id} originEventId={ev.id} rows={rewatchFrom.get(p.id)} compact={!bar} hideEmpty />
                            </span>
                          )}
                          {(n > 0 || notedByMe.has(p.id)) && (
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] font-bold">
                              {n ? <AvisToggle n={n} open={openAvis === p.id} side={duo} onClick={() => toggleAvis(p.id)} /> : null}
                              {notedByMe.has(p.id) && <span className="text-[9px] text-emerald-300">✓ {w(p.sex).note} par moi</span>}
                            </span>
                          )}
                        </>
                      }
                      menuExtras={can.removeFromEvent(role, ev, p.id) ? [{ label: 'Retirer de cet événement', icon: 'close', onSelect: () => void removeOne(p) }] : undefined}
                      seen={!removing && <SeenEye eventId={ev.id} playerId={p.id} list={sight.get(p.id)} sex={p.sex} />}
                      rewatch={!removing && <RewatchToggle playerId={p.id} originEventId={ev.id} rows={rewatchFrom.get(p.id)} />}
                      follow={!removing && <FollowStar id={p.id} sex={p.sex} />}
                      actions={
                        removing &&
                        can.removeFromEvent(role, ev, p.id) && (
                          <button
                            className="flex h-8 w-8 shrink-0 items-center justify-center text-muted hover:text-red-400"
                            title="Retirer de la liste"
                            onClick={() => void setRoster((ev.playerIds ?? []).filter((x) => x !== p.id))}
                          >
                            ✕
                          </button>
                        )
                      }
                    />
                    {openAvis === p.id && !duo && <EventAvis player={p} evals={evals} criteria={criteria} event={ev} />}
                    </div>
                  )
                  }}
                />
              </>
            )}
          </div>
          {avisPlayer && (
            // Avis du joueur choisi : colonne collée en haut du panneau, qui défile seule.
            <aside key={avisPlayer.id} data-avis-nav className="md-box sticky top-0 z-10 flex max-h-[calc(100dvh-var(--hdr)-2.5rem)] flex-col gap-2 overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-bold">
                  {avisPlayer.lastName.toUpperCase()} {avisPlayer.firstName}
                </span>
                <span className="hidden shrink-0 text-[10px] text-muted wide:inline">↑ ↓ {ew.joueur} {accord('précédent', eg)} / {accord('suivant', eg)} · Échap ferme</span>
                <button className="shrink-0 text-muted hover:text-fg" title="Fermer les avis (Échap)" aria-label="Fermer les avis" onClick={() => showAvis(null)}>
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>
              <EventAvis player={avisPlayer} evals={evals} criteria={criteria} event={ev} wide={!!panel} />
            </aside>
          )}
          </div>
        )
      ) : (
        <Ranking players={players} evals={evals.filter(counts)} rosterIds={new Set(ev.playerIds ?? [])} eventName={ev.name} details={{ evals, criteria, event: ev }} pick={pick} />
      )}
      <CompareBar pick={pick} players={players} eventId={ev.id} />
    </div>
    </PlayerMenuScope.Provider>
  )
}

/**
 * Ajout de joueurs à une liste (événement, groupe) : par groupe de filtres ou un par un. Filtres = même éditeur de recette
 * que la liste Joueurs (src/components/PlayersQuery.tsx : champ « Filtrer ou poser une question… », micro ✨, pastilles,
 * panneau Filtres ; une phrase AJOUTE aux filtres posés), avec son propre état de session (scope).
 */
export function AddPlayers({
  current,
  onAdd,
  onCancel,
  scope = 'ajout-evenement',
  g,
}: {
  /** Genre de la liste où l'on ajoute (src/gender.ts) : « Ajouter des joueuses » pour un groupe ou un événement de filles. */
  g?: Gender
  current: string[]
  onAdd: (ids: string[]) => void
  onCancel: () => void
  scope?: string
}) {
  const all = useLiveQuery(() => db.players.orderBy('lastName').toArray().then(alive))
  const { filtered, ui, top } = usePlayersQuery(all, { dock: false, scope })
  // Dans le panneau de droite (ordinateur), la barre se colle en haut du panneau, qui défile seul.
  const inPanel = !!usePanel()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(60)
  const inList = new Set(current)
  const available = filtered.filter((p) => !inList.has(p.id))
  const allPicked = available.length > 0 && available.every((p) => picked.has(p.id))

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function pickAll() {
    if (allPicked) {
      setPicked((s) => new Set([...s].filter((id) => !available.some((p) => p.id === id))))
      return
    }
    if (available.length > 300 && !(await ask(`Sélectionner ${pluralG(available.length, genderOf(available))} ? Affine les filtres pour un groupe plus précis.`, { ok: 'Tout sélectionner', danger: false }))) return
    setPicked((s) => new Set([...s, ...available.map((p) => p.id)]))
  }

  if (!all) return <div className="py-10 text-center text-sm text-muted">Chargement…</div>
  return (
    <div className="flex flex-col gap-3" onKeyDown={(e) => arrowNav(e, 'button[data-player]')}>
      <div className="card flex flex-col gap-2 p-3">
        <div className="text-xs font-extrabold">Ajouter des {w(g).joueurs}</div>
        {ui}
      </div>
      {top}

      <div className={`sticky z-10 flex items-center justify-between gap-2 rounded-lg border border-line bg-bg/95 p-2 backdrop-blur ${inPanel ? 'top-0' : 'top-14 rail:top-11'}`}>
        <button className="btn-ghost px-3 py-1.5 text-xs" disabled={!available.length} onClick={() => void pickAll()}>
          {allPicked ? 'Tout désélectionner' : `Tout sélectionner (${available.length.toLocaleString('fr-FR')})`}
        </button>
        <div className="flex gap-2">
          <button className="btn px-3 py-1.5 text-xs text-muted" onClick={onCancel}>
            Annuler
          </button>
          <button className="btn-primary px-3 py-1.5 text-xs" disabled={!picked.size} onClick={() => onAdd([...picked])}>
            Ajouter {picked.size || ''}
          </button>
        </div>
      </div>

      <div className="cols flex flex-col gap-1">
        {filtered.slice(0, limit).map((p) => {
          const already = inList.has(p.id)
          const on = already || picked.has(p.id)
          return (
            <button
              key={p.id}
              data-player
              disabled={already}
              onClick={() => toggle(p.id)}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs outline-none focus:ring-2 focus:ring-accent ${on ? 'border-accent bg-accent-soft' : 'border-line bg-panel'} ${already ? 'opacity-50' : ''}`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line'}`}>
                {on ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <b>
                  {p.lastName.toUpperCase()} {p.firstName}
                </b>
                <span className="text-muted"> · {[p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}</span> <QuarterBadge birthDate={p.birthDate} />
              </span>
              {already && <span className="shrink-0 text-[10px] text-muted">déjà dans la liste</span>}
            </button>
          )
        })}
        {filtered.length > limit && (
          <button className="btn-ghost col-span-full text-xs" onClick={() => setLimit((l) => l + 60)}>
            Afficher plus ({(filtered.length - limit).toLocaleString('fr-FR')} restants)
          </button>
        )}
        {!filtered.length && <Empty>{w(g).AucunJoueur} ne correspond aux filtres.</Empty>}
      </div>
    </div>
  )
}

/** Bouton « N avis » : déplie ou replie les avis du joueur sous sa ligne. */
function AvisToggle({ n, open, side = false, onClick }: { n: number; open: boolean; side?: boolean; onClick: () => void }) {
  // Peut se trouver dans le lien de la ligne (téléphone) : n'ouvre pas l'évaluation.
  const tap = (e: { preventDefault(): void; stopPropagation(): void }) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  }
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={tap}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && tap(e)}
      aria-expanded={open}
      className={`inline-flex shrink-0 cursor-pointer items-center rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-emerald-300 ${open ? 'border-accent bg-accent/15' : 'border-emerald-500/40'}`}
      title={open ? 'Masquer les avis' : 'Lire les avis'}
    >
      {n} avis {side ? '›' : open ? '▴' : '▾'}
    </span>
  )
}

/** Avis de l'événement (tous ceux visibles, pas seulement ceux comptés), pour les déplier sous une ligne. */
type AvisDetails = { evals: Evaluation[]; criteria: Criterion[]; event: HBEvent }

function Ranking({
  players,
  evals,
  rosterIds,
  eventName,
  details,
  pick,
}: {
  players: Player[]
  evals: Evaluation[]
  rosterIds: Set<string>
  eventName: string
  details: AvisDetails
  pick: ComparePick
}) {
  // Joueur dont les avis sont dépliés (un seul à la fois).
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (pid: string) => setOpen((o) => (o === pid ? null : pid))
  const rows = players
    .map((p) => ({ p, s: playerScore(evals.filter((e) => e.playerId === p.id)) }))
    .sort((a, b) => (b.s?.avg ?? -1) - (a.s?.avg ?? -1))
  const groups = [...POSITIONS.map((x) => ({ id: x.id as string, label: x.label })), { id: 'none', label: 'Poste non renseigné' }]
    .map((g) => ({
      ...g,
      rows: rows.filter((r) => (r.p.position ?? 'none') === g.id),
      // Joueurs qui ont ce poste en secondaire : affichés en grisé, hors classement.
      extra: rows.filter((r) => r.p.position !== g.id && r.p.secondaryPositions?.includes(g.id as Position)),
    }))
    .filter((g) => g.rows.length || g.extra.length)
  const f1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

  function exportRanking() {
    const lines = [['Poste', 'Rang', 'Nom', 'Prénom', 'Année', 'Club', 'Licence', 'Note moyenne', 'Évaluateurs', 'Écart entre évaluateurs', 'Dans la liste', 'Postes secondaires']]
    for (const g of groups)
      g.rows.forEach((r, i) =>
        lines.push([
          g.label,
          String(r.s ? i + 1 : ''),
          r.p.lastName,
          r.p.firstName,
          r.p.birthDate?.slice(0, 4) ?? '',
          r.p.club ?? '',
          r.p.license ?? '',
          r.s ? f1(r.s.avg) : '',
          r.s ? String(r.s.observers) : '0',
          r.s && r.s.observers > 1 ? f1(r.s.spread) : '',
          rosterIds.has(r.p.id) ? 'oui' : 'non',
          (r.p.secondaryPositions ?? []).map((x) => POSITIONS.find((q) => q.id === x)?.short ?? x).join(', '),
        ]),
      )
    const csv = '﻿' + lines.map((l) => l.map((v) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `classement-${eventName.replace(/[^\p{L}\d]+/gu, '-').toLowerCase()}.csv`
    a.click()
  }

  if (!evals.length) return <Empty>Le classement apparaîtra dès les premiers avis.</Empty>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted">Note = moyenne des évaluateurs (chacun : moyenne de ses critères). <Icon name="alert" className="inline h-3 w-3 -translate-y-px" /> = avis très partagés.</p>
        <div className="flex shrink-0 items-center gap-2">
          {rows.length > 1 && <CompareToggle pick={pick} />}
          <button className="btn-ghost shrink-0 px-3 py-1 text-xs" onClick={exportRanking}>
            Exporter
          </button>
        </div>
      </div>
      {groups.map((g) => (
        <div key={g.id} className="card p-3">
          <div className="section-title">
            {g.label} ({g.rows.length}
            {g.extra.length ? ` + ${g.extra.length} en secondaire` : ''})
          </div>
          <div className="divide-y divide-line">
            {g.rows.map((r, i) => (
              <RankRow key={r.p.id} r={r} rank={r.s ? String(i + 1) : '–'} f1={f1} open={open === r.p.id} onToggle={() => toggle(r.p.id)} details={details} pick={pick} />
            ))}
            {g.extra.map((r) => (
              <RankRow key={r.p.id} r={r} rank="" f1={f1} secondary open={open === r.p.id} onToggle={() => toggle(r.p.id)} details={details} pick={pick} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Ligne du classement ; en grisé pour un joueur affiché à son poste secondaire (hors classement). */
function RankRow({
  r,
  rank,
  f1,
  secondary,
  open,
  onToggle,
  details,
  pick,
}: {
  r: { p: Player; s: ReturnType<typeof playerScore> }
  rank: string
  f1: (n: number) => string
  secondary?: boolean
  open: boolean
  onToggle: () => void
  details: AvisDetails
  pick: ComparePick
}) {
  // Toucher la ligne déplie les avis du joueur (note de chaque évaluateur, détail) ; la fiche est un lien dedans.
  return (
    <div>
      <div className="flex items-center gap-3">
      <PickBox pick={pick} p={r.p} />
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={`flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left text-xs ${secondary && !open ? 'opacity-45' : ''}`}
        title={secondary ? 'Poste secondaire' : undefined}
      >
        <span className="w-5 text-center font-extrabold text-muted">{secondary ? '○' : rank}</span>
        <span className="min-w-0 flex-1 truncate">
          <b>
            {r.p.lastName.toUpperCase()} {r.p.firstName}
          </b>
          <span className="text-muted"> · {[r.p.birthDate?.slice(0, 4), r.p.club].filter(Boolean).join(' · ')}</span> <QuarterBadge birthDate={r.p.birthDate} />
          {secondary && <span className="text-[10px] text-muted"> · poste principal : {POSITIONS.find((q) => q.id === r.p.position)?.short ?? '—'}</span>}
        </span>
        {r.s && r.s.observers > 1 && r.s.spread >= DIVERGENCE && <Icon name="alert" className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
        <span className="w-16 shrink-0 text-right text-[10px] text-muted">{r.s ? `${r.s.observers} éval.` : `pas ${w(r.p.sex).note}`}</span>
        <span className={`w-9 shrink-0 text-right text-sm font-extrabold ${secondary ? 'text-muted' : 'text-accent'}`}>{r.s ? f1(r.s.avg) : ''}</span>
        <span className="w-3 shrink-0 text-[10px] text-muted">{open ? '▴' : '▾'}</span>
      </button>
      </div>
      {open && (
        <div className="pb-2">
          <EventAvis player={r.p} evals={details.evals} criteria={details.criteria} event={details.event} />
        </div>
      )}
    </div>
  )
}
