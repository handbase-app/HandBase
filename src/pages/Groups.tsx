import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { StampLine } from '../components/ActivityLog'
import { ask } from '../components/Confirm'
import { addToGroup, removeFromGroup } from '../components/Groups'
import { arrowNav, DEPARTMENT_CHOICES, departmentLabel, fold, showGroupInPlayers, useSessionState } from '../components/PlayerFilter'
import { Avatar, Empty, PosBadge, QuarterBadge } from '../components/ui'
import { alive, db, newId, REGIONS, remove, save, type Player, type PlayerGroup } from '../db'
import { exportCsv } from '../export'
import { can, useRole } from '../roles'
import { AddPlayers } from './Events'

/** Liste des groupes (Intercomités, Pôle, Sport-études…). */
export default function Groups() {
  const role = useRole()
  const groups = useLiveQuery(() => db.groups.orderBy('name').toArray().then(alive))
  const [showArchived, setShowArchived] = useState(false)
  // Filtres de la liste (gardés pendant la session).
  const [q, setQ] = useSessionState('handbase.groupes.q', '')
  const [sex, setSex] = useSessionState('handbase.groupes.sex', '')
  const [dept, setDept] = useSessionState('handbase.groupes.dept', '')
  const [region, setRegion] = useSessionState('handbase.groupes.region', '')
  const [year, setYear] = useSessionState('handbase.groupes.year', '')
  if (!groups) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const words = fold(q).split(/\s+/).filter(Boolean)
  const shown = groups.filter(
    (g) =>
      (!sex || g.sex === sex) &&
      (!dept || g.department === dept) &&
      (!region || g.region === region) &&
      (!year || g.years?.includes(year)) &&
      words.every((w) => fold(`${g.name} ${g.description ?? ''} ${g.createdByName ?? ''}`).includes(w)),
  )
  const active = shown.filter((g) => !g.archived)
  const archived = shown.filter((g) => g.archived)
  const uniq = (vs: (string | undefined)[]) => [...new Set(vs.filter((v): v is string => !!v))].sort()
  const depts = uniq(groups.map((g) => g.department))
  const regions = uniq(groups.map((g) => g.region))
  const years = uniq(groups.flatMap((g) => g.years ?? [])).reverse()
  const filtering = !!(q || sex || dept || region || year)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">Groupes</h1>
        {can.manageGroups(role) && (
          <Link to="/groupes/nouveau" className="btn-primary px-3 py-1.5 text-xs">
            + Groupe
          </Link>
        )}
      </div>
      <p className="text-[11px] text-muted">
        Des listes de joueurs réutilisables (Intercomités 83, Pôle, Sport-études…) : un clic pour les filtrer, les exporter ou remplir un
        événement.
      </p>
      {groups.length > 0 && (
        <div className="flex flex-col gap-2">
          <input className="field" placeholder="Rechercher un groupe (nom, description, créateur)…" value={q} onChange={(e) => setQ(e.target.value)} />
          {(depts.length > 0 || regions.length > 0 || years.length > 0 || groups.some((g) => g.sex)) && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <select className="field py-1.5 text-xs" value={sex} onChange={(e) => setSex(e.target.value)}>
                <option value="">Garçons et filles</option>
                {SEXES.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
              <select className="field py-1.5 text-xs" value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">Tous départements</option>
                {depts.map((d) => (
                  <option key={d} value={d}>
                    {departmentLabel(d)}
                  </option>
                ))}
              </select>
              <select className="field py-1.5 text-xs" value={region} onChange={(e) => setRegion(e.target.value)}>
                <option value="">Toutes régions</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <select className="field py-1.5 text-xs" value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">Toutes années</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}
          {filtering && (
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
      {active.map((g) => (
        <GroupRow key={g.id} g={g} />
      ))}
      {archived.length > 0 && (
        <button className="self-start text-[11px] font-bold text-muted underline" onClick={() => setShowArchived((x) => !x)}>
          {showArchived ? 'Masquer' : 'Voir'} les groupes archivés ({archived.length})
        </button>
      )}
      {showArchived && archived.map((g) => <GroupRow key={g.id} g={g} />)}
    </div>
  )
}

function GroupRow({ g }: { g: PlayerGroup }) {
  return (
    <Link to={`/groupes/${g.id}`} className={`card flex items-center justify-between gap-3 p-3 hover:border-accent ${g.archived ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold">
          {g.name}
          {g.archived && <span className="ml-2 text-[10px] text-muted">archivé</span>}
        </div>
        {groupInfo(g) && <div className="truncate text-[11px] font-bold text-accent">{groupInfo(g)}</div>}
        {g.description && <div className="truncate text-[11px] text-muted">{g.description}</div>}
        {g.createdByName && <div className="text-[10px] text-muted">par {g.createdByName}</div>}
      </div>
      <span className="shrink-0 text-xs font-bold text-muted">
        {g.playerIds.length} joueur{g.playerIds.length > 1 ? 's' : ''} ›
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

/** « Garçons · 83 · 2010-2011 · Provence-Alpes-Côte d’Azur » : les informations du groupe, en clair. */
export function groupInfo(g: Pick<PlayerGroup, 'sex' | 'department' | 'region' | 'years'>) {
  const ys = [...(g.years ?? [])].sort()
  const years = !ys.length ? '' : ys.length > 1 && Number(ys[ys.length - 1]) - Number(ys[0]) === ys.length - 1 ? `${ys[0]}-${ys[ys.length - 1]}` : ys.join(', ')
  return [SEXES.find((x) => x.value === g.sex)?.label, g.department && departmentLabel(g.department), years, g.region].filter(Boolean).join(' · ')
}

/** Création ou modification d'un groupe : nom, description et informations facultatives. */
function GroupForm({ group, playerIds = [], onDone }: { group?: PlayerGroup; playerIds?: string[]; onDone: (g?: PlayerGroup) => void }) {
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [sex, setSex] = useState(group?.sex)
  const [department, setDepartment] = useState(group?.department ?? '')
  const [region, setRegion] = useState(group?.region ?? '')
  const [years, setYears] = useState<string[]>(group?.years ?? [])
  const toggleYear = (y: string) => setYears((ys) => (ys.includes(y) ? ys.filter((x) => x !== y) : [...ys, y]))
  const chip = (on: boolean) =>
    `rounded-md border px-2.5 py-1.5 text-xs font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-white'}`

  return (
    <div className="flex flex-col gap-2">
      <span className="label">Nom du groupe</span>
      <input className="field" autoFocus={!group} placeholder="Ex. Intercomités 83 – 2010, Pôle Espoirs garçons…" value={name} onChange={(e) => setName(e.target.value)} />
      <span className="label">Description</span>
      <input className="field" placeholder="Saison, encadrant… — facultatif" value={description} onChange={(e) => setDescription(e.target.value)} />

      <div className="mt-2 text-[11px] text-muted">Informations facultatives, pour retrouver et filtrer les groupes :</div>
      <span className="label">Garçons / filles</span>
      <div className="flex gap-1">
        {SEXES.map((x) => (
          <button key={x.value} type="button" className={`flex-1 ${chip(sex === x.value)}`} onClick={() => setSex(sex === x.value ? undefined : x.value)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="label">Département</span>
          <select className="field" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">—</option>
            {[...DEPARTMENT_CHOICES, ...(department && !DEPARTMENT_CHOICES.some((d) => d.value === department) ? [{ value: department, label: departmentLabel(department) }] : [])].map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Région</span>
          <select className="field" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">—</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <span className="label">Années d’âge (naissance)</span>
      <div className="flex flex-wrap gap-1">
        {yearChoices(years).map((y) => (
          <button key={y} type="button" className={chip(years.includes(y))} onClick={() => toggleYear(y)}>
            {y}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={!name.trim()}
          onClick={async () => {
            const fields = {
              name: name.trim(),
              description: description.trim() || undefined,
              sex,
              department: department || undefined,
              region: region || undefined,
              years: years.length ? [...years].sort() : undefined,
            }
            // Relit le groupe : sa liste a pu changer entre-temps.
            const current = group && (await db.groups.get(group.id))
            onDone(await save<PlayerGroup>('groups', current ? { ...current, ...fields } : { id: newId(), playerIds: [...new Set(playerIds)], ...fields }))
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
  const [editing, setEditing] = useState(false)
  // Groupe tout juste créé sans joueurs : on ouvre directement l'ajout.
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(params.has('ajout'))
  const data = useLiveQuery(async () => {
    const g = await db.groups.get(id!)
    const players = alive((await db.players.bulkGet(g?.playerIds ?? [])).filter((p): p is Player => !!p))
    return { g, players }
  }, [id])

  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const { g, players } = data
  if (!g || g.deleted) return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>
  const manage = can.editGroup(role, g)
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
      <div className="flex items-center justify-between">
        <button onClick={() => nav('/groupes')} className="text-xs font-bold text-muted">
          ← GROUPES
        </button>
        {manage && !editing && (
          <div className="flex gap-4">
            <button className="text-xs text-muted hover:text-white" onClick={() => setEditing(true)}>
              Modifier
            </button>
            <button className="text-xs text-muted hover:text-white" onClick={() => void save<PlayerGroup>('groups', { ...g, archived: !g.archived })}>
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
          </div>
        )}
      </div>

      {editing ? (
        <div className="card p-3">
          <GroupForm group={g} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <div>
          <h1 className="text-lg font-extrabold">
            {g.name}
            {g.archived && <span className="ml-2 text-xs text-muted">archivé</span>}
          </h1>
          {groupInfo(g) && <div className="text-xs font-bold text-accent">{groupInfo(g)}</div>}
          {g.description && <div className="text-xs text-muted">{g.description}</div>}
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

      {manage && (
        <button className="btn-ghost" onClick={() => setAdding(true)}>
          + Ajouter des joueurs (par filtres ou un par un)
        </button>
      )}

      <div className="text-[11px] text-muted">
        {players.length} joueur{players.length > 1 ? 's' : ''}
      </div>
      {!players.length && <Empty>Aucun joueur dans ce groupe.</Empty>}
      <div className="flex flex-col gap-1.5" onKeyDown={(e) => arrowNav(e, 'a[data-player]')}>
        {sorted.map((p) => (
          <div key={p.id} className="card flex items-center gap-3 p-2.5">
            <Link to={`/joueurs/${p.id}`} data-player className="flex min-w-0 flex-1 items-center gap-3 outline-none focus:text-accent">
              <Avatar p={p} size={32} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 truncate text-sm font-bold">
                  {p.firstName} {p.lastName} <PosBadge pos={p.position} /> <QuarterBadge birthDate={p.birthDate} />
                </div>
                <div className="truncate text-[11px] text-muted">{[p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}</div>
              </div>
            </Link>
            {manage && (
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
