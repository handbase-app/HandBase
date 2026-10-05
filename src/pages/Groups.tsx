import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { StampLine } from '../components/ActivityLog'
import { ask } from '../components/Confirm'
import { addToGroup, removeFromGroup } from '../components/Groups'
import { arrowNav, fold, showGroupInPlayers, useSessionState } from '../components/PlayerFilter'
import { departmentChoices, departmentLabel } from '../lists'
import { Avatar, Empty, Icon, PosBadges, QuarterBadge, Segmented } from '../components/ui'
import { alive, db, newId, remove, save, type Player, type PlayerGroup } from '../db'
import { useRegionName, useRegions } from '../lists'
import { exportCsv } from '../export'
import { can, useRole } from '../roles'
import { AddPlayers } from './Events'

/** Liste des groupes (Intercomités, Pôle, Sport-études…). */
export default function Groups() {
  const role = useRole()
  const groups = useLiveQuery(() => db.groups.orderBy('name').toArray().then((gs) => alive(gs).filter(can.seeGroup)))
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
      {active.some((g) => g.private) && (
        <>
          <div className="section-title mt-1 mb-0 flex items-center gap-1.5">
            <Icon name="lock" className="h-3.5 w-3.5" /> Mes groupes privés
          </div>
          {active
            .filter((g) => g.private)
            .map((g) => (
              <GroupRow key={g.id} g={g} />
            ))}
        </>
      )}
      {active.some((g) => !g.private) && (
        <>
          <div className="section-title mt-1 mb-0 flex items-center gap-1.5">
            <Icon name="users" className="h-3.5 w-3.5" /> Groupes du staff
          </div>
          {active
            .filter((g) => !g.private)
            .map((g) => (
              <GroupRow key={g.id} g={g} />
            ))}
        </>
      )}
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
  const regionName = useRegionName()
  const info = groupInfo(g, regionName(g.regionId))
  return (
    <Link to={`/groupes/${g.id}`} className={`card flex items-center justify-between gap-3 p-3 hover:border-accent ${g.archived ? 'opacity-60' : ''}`}>
      <div className="min-w-0">
        <div className="truncate text-sm font-bold">
          {g.name}
          {g.archived && <span className="ml-2 text-[10px] text-muted">archivé</span>}
        </div>
        {info && <div className="truncate text-[11px] font-bold text-accent">{info}</div>}
        {g.description && <div className="truncate text-[11px] text-muted">{g.description}</div>}
        {g.createdByName && !g.private && <div className="text-[10px] text-muted">par {g.createdByName}</div>}
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

/** « Garçons · 83 · 2010-2011 · Région Sud » : les informations du groupe, en clair. */
export function groupInfo(g: Pick<PlayerGroup, 'sex' | 'department' | 'years'>, region?: string) {
  const ys = [...(g.years ?? [])].sort()
  const years = !ys.length ? '' : ys.length > 1 && Number(ys[ys.length - 1]) - Number(ys[0]) === ys.length - 1 ? `${ys[0]}-${ys[ys.length - 1]}` : ys.join(', ')
  return [SEXES.find((x) => x.value === g.sex)?.label, g.department && departmentLabel(g.department), years, region].filter(Boolean).join(' · ')
}

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
  const [priv, setPriv] = useState(group ? !!group.private : true)
  const [sex, setSex] = useState(group?.sex)
  const [department, setDepartment] = useState(group?.department ?? '')
  const regions = useRegions()
  const [region, setRegion] = useState(group?.regionId ?? '')
  // Année d'âge (les anciens groupes à plusieurs années gardent la première).
  const sortedYears = [...(group?.years ?? [])].sort()
  const [year, setYear] = useState(sortedYears[0] ?? '')
  const years = year ? [year] : []
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
        <Segmented<'prive' | 'public'>
          value={priv ? 'prive' : 'public'}
          onChange={(v) => setPriv(v === 'prive')}
          options={[
            { value: 'prive', label: '🔒 Moi seul' },
            { value: 'public', label: '👥 Tout le staff' },
          ]}
        />
      ) : (
        <p className="text-xs">🔒 Moi seul (groupe privé)</p>
      )}
      <p className="text-[11px] text-muted">
        {priv ? 'Groupe privé : personne d’autre ne le voit, même pas les administrateurs.' : 'Groupe public : visible par tout le staff.'}
      </p>

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
            {[...departmentChoices(), ...(department && !departmentChoices().some((d) => d.value === department) ? [{ value: department, label: departmentLabel(department) }] : [])].map((d) => (
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
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="label">Année d’âge (naissance)</span>
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
              regionId: region || undefined,
              years: years.length ? [...years].sort() : undefined,
            }
            // Relit le groupe : sa liste a pu changer entre-temps.
            const current = group && (await db.groups.get(group.id))
            if (current && priv && !current.private) {
              // Public → privé : nouveau groupe privé, et l'ancien est supprimé chez tout le monde
              // (sinon les autres appareils garderaient leur copie publique).
              const copy = await save<PlayerGroup>('groups', { ...stripStamps(current), ...fields, id: newId(), private: true })
              await remove('groups', current.id)
              return onDone(copy)
            }
            onDone(
              await save<PlayerGroup>(
                'groups',
                current ? { ...current, ...fields, private: priv } : { id: newId(), playerIds: [...new Set(playerIds)], ...fields, private: priv },
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
  const data = useLiveQuery(async () => {
    const g = await db.groups.get(id!)
    const players = alive((await db.players.bulkGet(g?.playerIds ?? [])).filter((p): p is Player => !!p))
    return { g, players }
  }, [id])

  // Données encore celles du groupe précédent (navigation d'un groupe à l'autre) : on attend.
  if (!data || (data.g && data.g.id !== id)) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const { g, players } = data
  if (!g || g.deleted || !can.seeGroup(g)) return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>
  const manage = can.editGroup(role, g)
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
        <button onClick={() => nav('/groupes')} className="text-xs font-bold whitespace-nowrap text-muted">
          ← GROUPES
        </button>
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
              // Passé en privé : c'est un nouveau groupe (voir GroupForm).
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
            {g.archived && <span className="ml-2 text-xs text-muted">archivé</span>}
          </h1>
          {info && <div className="text-xs font-bold text-accent">{info}</div>}
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
                  {p.lastName.toUpperCase()} {p.firstName} <PosBadges p={p} /> <QuarterBadge birthDate={p.birthDate} />
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
