import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { StampLine } from '../components/ActivityLog'
import { ask } from '../components/Confirm'
import { addToGroup, removeFromGroup } from '../components/Groups'
import { arrowNav, fold, showGroupInPlayers, useSessionState } from '../components/PlayerFilter'
import { departmentChoices, departmentLabel } from '../lists'
import { Avatar, Empty, Icon, PosBadges, QuarterBadge, Segmented } from '../components/ui'
import { alive, db, GROUP_SCOPES, newId, remove, save, type GroupScope, type Player, type PlayerGroup } from '../db'
import { regionOfDept, useRegionName, useRegions } from '../lists'
import { exportCsv } from '../export'
import { can, currentUserId, groupVisibility, useRole, type GroupVisibility } from '../roles'
import { loadTeams } from '../teams'
import { StaffPicker, useCanPickStaff } from '../components/StaffPicker'
import { Participants } from '../components/Participants'
import { GROUP_VIS, STAFF, TEAM_FOLLOW } from '../staffLabels'
import { participantSummary, useTeams } from '../teams'
import type { Team } from '../db'
import { AddPlayers } from './Events'
import { FollowButton, FollowStar } from '../components/Follow'
import { teamFollowed } from '../follows'

/** Liste des groupes (Intercomités, Pôle, Sport-études…). */
export default function Groups() {
  const role = useRole()
  const groups = useLiveQuery(() => loadTeams().then(() => db.groups.orderBy('name').toArray().then((gs) => alive(gs).filter(can.seeGroup))))
  const teams = useTeams() ?? []
  const [showArchived, setShowArchived] = useState(false)
  const regionName = useRegionName()
  // Filtres de la liste (gardés pendant la session).
  const [q, setQ] = useSessionState('handbase.groupes.q', '')
  const [sex, setSex] = useSessionState('handbase.groupes.sex', '')
  const [dept, setDept] = useSessionState('handbase.groupes.dept', '')
  const [region, setRegion] = useSessionState('handbase.groupes.region', '')
  const [year, setYear] = useSessionState('handbase.groupes.year', '')
  const [open, setOpen] = useSessionState('handbase.groupes.open', false)
  if (!groups) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const words = fold(q).split(/\s+/).filter(Boolean)
  // Comme pour les joueurs : chaque menu compte les groupes qui passent tous les AUTRES filtres.
  const ok = {
    q: (g: PlayerGroup) => words.every((w) => fold(`${g.name} ${g.description ?? ''} ${g.createdByName ?? ''}`).includes(w)),
    sex: (g: PlayerGroup) => !sex || g.sex === sex,
    dept: (g: PlayerGroup) => !dept || g.department === dept,
    region: (g: PlayerGroup) => !region || g.regionId === region,
    year: (g: PlayerGroup) => !year || !!g.years?.includes(year),
  }
  const except = (k: keyof typeof ok) => groups.filter((g) => (Object.keys(ok) as (keyof typeof ok)[]).every((x) => x === k || ok[x](g)))
  const shown = except('q').filter(ok.q)
  const active = shown.filter((g) => !g.archived)
  const archived = shown.filter((g) => g.archived)
  const countBy = (gs: PlayerGroup[], key: (g: PlayerGroup) => (string | undefined)[]) => {
    const m = new Map<string, number>()
    for (const g of gs) for (const v of key(g)) if (v) m.set(v, (m.get(v) ?? 0) + 1)
    return m
  }
  const deptCounts = countBy(except('dept'), (g) => [g.department])
  const regionCounts = countBy(except('region'), (g) => [g.regionId])
  const yearCounts = countBy(except('year'), (g) => g.years ?? [])
  const depts = [...deptCounts.keys()].sort()
  const regions = [...regionCounts.keys()].filter((r) => regionName(r)).sort()
  const years = [...yearCounts.keys()].sort().reverse()
  const filtering = !!(q || sex || dept || region || year)
  const chips = [
    sex && { label: SEXES.find((x) => x.value === sex)?.label ?? sex, clear: () => setSex('') },
    dept && { label: departmentLabel(dept), clear: () => setDept('') },
    region && { label: regionName(region) ?? region, clear: () => setRegion('') },
    year && { label: year, clear: () => setYear('') },
  ].filter((c): c is { label: string; clear: () => void } => !!c)
  const hasInfo = depts.length > 0 || regions.length > 0 || years.length > 0 || groups.some((g) => g.sex) || chips.length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">Groupes</h1>
        <div className="flex items-center gap-3">
          {(can.manageTeams(role) || teams.length > 0) && (
            <Link to={STAFF.route} className="flex items-center gap-1 text-xs font-bold text-muted hover:text-fg">
              <Icon name="users" className="h-3.5 w-3.5" /> {STAFF.title}
            </Link>
          )}
          {can.manageGroups(role) && (
            <Link to="/groupes/nouveau" className="btn-primary px-3 py-1.5 text-xs">
              + Groupe
            </Link>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted">
        Des listes de joueurs réutilisables (Intercomités 83, Pôle, Sport-études…) : un clic pour les filtrer, les exporter ou remplir un
        événement.
      </p>
      {groups.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input className="field min-w-0 flex-1" placeholder="Rechercher…" title="Nom, description ou créateur" value={q} onChange={(e) => setQ(e.target.value)} />
            {hasInfo && (
              <button
                onClick={() => setOpen(!open)}
                className={`shrink-0 rounded-md border px-3 text-xs font-bold ${open || chips.length ? 'border-accent text-fg' : 'border-line text-muted'} ${open ? 'bg-accent/15' : 'bg-panel-2'}`}
              >
                Filtres{chips.length > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] text-white">{chips.length}</span>} {open ? '▴' : '▾'}
              </button>
            )}
          </div>
          {open && hasInfo && (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-2.5">
              <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
                {[{ value: '', label: 'Tous' }, ...SEXES].map((x) => (
                  <button key={x.value} onClick={() => setSex(x.value)} className={`flex-1 py-1.5 ${sex === x.value ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
                    {x.label}
                  </button>
                ))}
              </div>
              <select className={`field py-1.5 text-xs ${year ? 'border-accent font-bold' : ''}`} value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">Toutes les années ({except('year').length})</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y} ({yearCounts.get(y)})
                  </option>
                ))}
              </select>
              <select className={`field py-1.5 text-xs ${dept ? 'border-accent font-bold' : ''}`} value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">Tous les départements ({except('dept').length})</option>
                {depts.map((d) => (
                  <option key={d} value={d}>
                    {departmentLabel(d)} ({deptCounts.get(d)})
                  </option>
                ))}
              </select>
              <select className={`field py-1.5 text-xs ${region ? 'border-accent font-bold' : ''}`} value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">Toutes les régions ({except('region').length})</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {regionName(r)} ({regionCounts.get(r)})
                  </option>
                ))}
              </select>
            </div>
          )}
          {!open && (chips.length > 0 || filtering) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {chips.map((c) => (
                <button key={c.label} onClick={c.clear} className="rounded-full border border-accent/60 bg-accent/10 px-2 py-0.5 text-[11px] font-bold">
                  {c.label} <span className="text-muted">✕</span>
                </button>
              ))}
              <button className="text-[11px] font-bold text-muted underline" onClick={() => (setQ(''), setSex(''), setDept(''), setRegion(''), setYear(''))}>
                Tout effacer
              </button>
            </div>
          )}
          {open && filtering && (
            <button
              className="self-start text-[11px] font-bold text-muted underline"
              onClick={() => (setQ(''), setSex(''), setDept(''), setRegion(''), setYear(''))}
            >
              Effacer les filtres
            </button>
          )}
        </div>
      )}
      {!active.length && filtering && <Empty>Aucun groupe ne correspond.</Empty>}
      {!groups.length && (
        <Empty>{can.manageGroups(role) ? 'Aucun groupe pour l’instant. Crée le premier avec « + Groupe ».' : 'Aucun groupe pour l’instant.'}</Empty>
      )}
      {SECTIONS.map(
        (sec) =>
          active.some((g) => groupVisibility(g) === sec.vis) && (
            <Fragment key={sec.vis}>
              <div className="section-title mt-1 mb-0 flex items-center gap-1.5">
                <Icon name={sec.icon} className="h-3.5 w-3.5" /> {sec.title}
              </div>
              {active
                .filter((g) => groupVisibility(g) === sec.vis)
                .map((g) => (
                  <GroupRow key={g.id} g={g} teams={teams} />
                ))}
            </Fragment>
          ),
      )}
      {archived.length > 0 && (
        <button className="self-start text-[11px] font-bold text-muted underline" onClick={() => setShowArchived((x) => !x)}>
          {showArchived ? 'Masquer' : 'Voir'} les groupes archivés ({archived.length})
        </button>
      )}
      {showArchived && archived.map((g) => <GroupRow key={g.id} g={g} teams={teams} />)}
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

function GroupRow({ g, teams }: { g: PlayerGroup; teams: Team[] }) {
  const regionName = useRegionName()
  const info = groupInfo(g, regionName(g.regionId))
  // Participants en bref : staffs choisis (par leur nom), puis participants choisis un par un.
  const ps = participantSummary(g, teams)
  const who = [...ps.teams.map((t) => t.name), ...(ps.hidden ? [STAFF.hidden(ps.hidden)] : []), ...ps.others.map((u) => g.names?.[u] ?? '?')]
  return (
    <Link to={`/groupes/${g.id}`} className={`card flex items-center justify-between gap-3 p-3 hover:border-accent ${g.archived ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <div className="flex items-center text-sm font-bold">
          <span className="truncate">{g.name}</span>
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
      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-muted">
        <FollowStar kind="group" id={g.id} />
        {g.playerIds.length} joueur{g.playerIds.length > 1 ? 's' : ''}
      </span>
    </Link>
  )
}

const SEXES = [
  { value: 'M', label: 'Garçons' },
  { value: 'F', label: 'Filles' },
  { value: 'mixte', label: 'Mixte' },
] as const

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

const VIS_HELP: Record<GroupVisibility, string> = GROUP_VIS.help
/** Du moins visible au plus visible. */
const VIS_RANK: Record<GroupVisibility, number> = { private: 0, team: 1, staff: 2 }

/** Copie d'un groupe sans la signature serveur de l'original (la copie a son propre créateur). */
function stripStamps(g: PlayerGroup): PlayerGroup {
  const { createdBy: _a, createdByName: _b, createdAtServer: _c, updatedByName: _d, updatedAtServer: _e, ...rest } = g
  return rest as PlayerGroup
}

/** Création ou modification d'un groupe : nom, description et informations facultatives. */
function GroupForm({ group, playerIds = [], onDone }: { group?: PlayerGroup; playerIds?: string[]; onDone: (g?: PlayerGroup) => void }) {
  const role = useRole()
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  // Nouveau groupe : privé par défaut ; l'observateur ne crée que des groupes privés.
  const [vis, setVis] = useState<GroupVisibility>(group ? groupVisibility(group) : 'private')
  const priv = vis === 'private'
  const [sex, setSex] = useState(group?.sex)
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
    !sex && 'garçons / filles',
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
      <input className="field" autoFocus={!group} placeholder="Ex. Intercomités 83 – 2010, Pôle Espoirs garçons…" value={name} onChange={(e) => setName(e.target.value)} />
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
            { value: 'staff', label: GROUP_VIS.label.staff, icon: 'globe' },
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
              ? 'Encadrants qui voient ce groupe, y ajoutent des joueurs et retirent ceux qu’ils ont ajoutés. Renommer, archiver ou supprimer le groupe, ou changer ses participants, reste à toi.'
              : 'Encadrants qui peuvent ajouter des joueurs à ce groupe et retirer ceux qu’ils ont ajoutés. Eux seuls ; renommer, archiver ou supprimer le groupe reste à toi (et aux administrateurs).'}
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

      <span className="label mt-2">Garçons / filles *</span>
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
      <div className="mt-2 flex gap-2">
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
      </div>
    </div>
  )
}

/** Création d'un groupe (page à part, comme un événement), éventuellement avec des joueurs déjà choisis. */
export function NewGroup() {
  const nav = useNavigate()
  const role = useRole()
  const location = useLocation()
  const playerIds: string[] = (location.state as { playerIds?: string[] } | null)?.playerIds ?? []
  if (!can.manageGroups(role)) return <div className="py-20 text-center text-sm text-muted">Ton rôle ne permet pas de créer des groupes.</div>
  return (
    <div className="flex flex-col gap-4">
      <button onClick={() => nav(-1)} className="self-start text-xs font-bold text-muted">
        ← NOUVEAU GROUPE
      </button>
      <div className="card flex flex-col gap-3 p-4">
        <p className="text-[11px] text-muted">
          {playerIds.length
            ? `Les ${playerIds.length.toLocaleString('fr-FR')} joueurs choisis seront dans le groupe ; tu pourras en ajouter ou en retirer ensuite.`
            : 'Donne un nom au groupe, puis ajoute ses joueurs (par filtres ou un par un).'}
        </p>
        <GroupForm
          playerIds={playerIds}
          onDone={(g) => (g ? nav(`/groupes/${g.id}${playerIds.length ? '' : '?ajout=1'}`, { replace: true }) : nav(-1))}
        />
      </div>
    </div>
  )
}

export function GroupDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const role = useRole()
  const regionName = useRegionName()
  // Groupe tout juste créé sans joueurs : on ouvre directement l'ajout ; tout juste copié : sa fiche.
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState(params.has('modifier'))
  // Même écran réutilisé d'un groupe à l'autre (ex. après « Dupliquer ») : on repart de l'adresse.
  useEffect(() => {
    setEditing(params.has('modifier'))
    setAdding(params.has('ajout'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  const [adding, setAdding] = useState(params.has('ajout'))
  // « Retirer des joueurs » : les croix n'apparaissent qu'en mode retrait (sinon, l'étoile pour suivre).
  const [removing, setRemoving] = useState(false)
  const data = useLiveQuery(async () => {
    const teams = await loadTeams()
    const g = await db.groups.get(id!)
    const players = alive((await db.players.bulkGet(g?.playerIds ?? [])).filter((p): p is Player => !!p))
    return { g, players, teams }
  }, [id])

  // Données encore celles du groupe précédent (navigation d'un groupe à l'autre) : on attend.
  if (!data || (data.g && data.g.id !== id)) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const { g, players, teams } = data
  if (!g || g.deleted || !can.seeGroup(g)) return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>
  const manage = can.editGroup(role, g)
  // Participant (023) : ajoute des joueurs, retire les siens, peut se retirer du groupe.
  const contribute = can.contributeGroup(role, g)
  const who = (uid?: string) => (uid ? (g.names?.[uid] ?? (uid === g.createdBy ? g.createdByName : undefined)) : undefined)
  const addedByOf = (pid: string) => who(g.addedBy?.[pid] ?? g.createdBy)
  const info = groupInfo(g, regionName(g.regionId))
  const sorted = [...players].sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'))

  if (adding)
    return (
      <AddPlayers
        scope="ajout-groupe"
        current={g.playerIds}
        onCancel={() => (setAdding(false), setParams({}, { replace: true }))}
        onAdd={async (ids) => {
          await addToGroup(g, ids)
          setAdding(false)
          setParams({}, { replace: true })
        }}
      />
    )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackButton fallback="/groupes" label="GROUPES" />
        {!editing && (
          <div className="flex flex-wrap gap-3">
            {/* Copier le groupe et ses joueurs (ex. le pôle de la saison suivante), puis ajuster la différence. */}
            <button
              className="text-xs text-muted hover:text-fg"
              onClick={async () => {
                const copy = await save<PlayerGroup>('groups', {
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
                nav(`/groupes/${copy.id}?modifier=1`)
              }}
            >
              Dupliquer
            </button>
            {manage && (
              <>
                <button className="text-xs text-muted hover:text-fg" onClick={() => setEditing(true)}>
                  Modifier
                </button>
                <button className="text-xs text-muted hover:text-fg" onClick={() => void save<PlayerGroup>('groups', { ...g, archived: !g.archived })}>
                  {g.archived ? 'Désarchiver' : 'Archiver'}
                </button>
                <button
                  className="text-xs text-muted hover:text-red-400"
                  onClick={async () => {
                    if (!(await ask(`Supprimer le groupe « ${g.name} » ? Les joueurs, leurs avis et les événements ne sont pas touchés.`, { ok: 'Supprimer' }))) return
                    await remove('groups', g.id)
                    nav('/groupes', { replace: true })
                  }}
                >
                  Supprimer
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="card p-3">
          <GroupForm
            key={g.id}
            group={g}
            onDone={(saved) => {
              setEditing(false)
              if (params.has('modifier')) setParams({}, { replace: true })
              // Rendu moins visible (privé, mon staff) : c'est un nouveau groupe (voir GroupForm).
              if (saved && saved.id !== g.id) nav(`/groupes/${saved.id}`, { replace: true })
            }}
          />
        </div>
      ) : (
        <div>
          <h1 className="text-lg font-extrabold">
            {g.private && (
              <span title="Groupe privé : visible par toi seul">
                <Icon name="lock" className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted" />
              </span>
            )}
            {g.name}
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
                    if (!(await ask(`Te retirer des participants de « ${g.name} » ? Les joueurs que tu as ajoutés restent dans le groupe.`, { ok: 'Me retirer' }))) return
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
      )}

      <div className="grid grid-cols-3 gap-2">
        <button
          className="btn-ghost px-2 text-xs"
          disabled={!players.length}
          onClick={() => {
            showGroupInPlayers(g.id)
            nav('/joueurs')
          }}
        >
          Voir dans Joueurs
        </button>
        <button className="btn-ghost px-2 text-xs" disabled={!players.length} onClick={() => void exportCsv(players)}>
          Exporter ({players.length})
        </button>
        {can.manageEvents(role) ? (
          <Link to={`/evenements?groupe=${g.id}`} className={`btn-primary px-2 text-center text-xs ${players.length ? '' : 'pointer-events-none opacity-50'}`}>
            Créer un événement
          </Link>
        ) : (
          <span />
        )}
      </div>

      {(manage || contribute) && (
        <button className="btn-ghost" onClick={() => setAdding(true)}>
          + Ajouter des joueurs (par filtres ou un par un)
        </button>
      )}
      {contribute && <p className="-mt-2 text-[11px] text-muted">Tu es participant : tu peux ajouter des joueurs et retirer ceux que tu as ajoutés.</p>}

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          {players.length} joueur{players.length > 1 ? 's' : ''}
        </span>
        {players.some((p) => can.removeFromGroup(role, g, p.id)) && (
          <button
            className={`rounded-md border px-2 py-1 text-[11px] font-bold transition ${removing ? 'border-accent bg-accent text-white' : 'border-line text-muted hover:text-fg'}`}
            onClick={() => setRemoving((r) => !r)}
          >
            {removing ? 'Terminé' : 'Retirer des joueurs'}
          </button>
        )}
      </div>
      {!players.length && <Empty>Aucun joueur dans ce groupe.</Empty>}
      <div className="flex flex-col gap-1.5" onKeyDown={(e) => arrowNav(e, 'a[data-player]')}>
        {sorted.map((p) => (
          <div key={p.id} className="card flex items-center gap-3 p-2.5">
            <Link to={`/joueurs/${p.id}`} data-player className="flex min-w-0 flex-1 items-center gap-3 outline-none focus:text-accent">
              <Avatar p={p} size={32} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 truncate text-sm font-bold">
                  {p.lastName.toUpperCase()} {p.firstName} <PosBadges p={p} /> <QuarterBadge birthDate={p.birthDate} />
                </div>
                <div className="truncate text-[11px] text-muted">{[p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}</div>
                {!!g.editors?.length && addedByOf(p.id) && <div className="truncate text-[10px] text-muted">ajouté par {addedByOf(p.id)}</div>}
              </div>
            </Link>
            {!removing && <FollowStar id={p.id} />}
            {removing && can.removeFromGroup(role, g, p.id) && (
              <button className="px-1 text-muted hover:text-red-400" title="Retirer du groupe" onClick={() => void removeFromGroup(g, [p.id])}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
