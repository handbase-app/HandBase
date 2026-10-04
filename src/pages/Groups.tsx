import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { StampLine } from '../components/ActivityLog'
import { ask } from '../components/Confirm'
import { addToGroup, removeFromGroup } from '../components/Groups'
import { arrowNav, showGroupInPlayers } from '../components/PlayerFilter'
import { Avatar, Empty, PosBadge } from '../components/ui'
import { alive, db, newId, remove, save, type Player, type PlayerGroup } from '../db'
import { exportCsv } from '../export'
import { can, useRole } from '../roles'
import { AddPlayers } from './Events'

/** Liste des groupes (Intercomités, Pôle, Sport-études…). */
export default function Groups() {
  const role = useRole()
  const groups = useLiveQuery(() => db.groups.orderBy('name').toArray().then(alive))
  const [showArchived, setShowArchived] = useState(false)
  if (!groups) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const active = groups.filter((g) => !g.archived)
  const archived = groups.filter((g) => g.archived)

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
      {!active.length && (
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
        {g.description && <div className="truncate text-[11px] text-muted">{g.description}</div>}
        {g.createdByName && <div className="text-[10px] text-muted">par {g.createdByName}</div>}
      </div>
      <span className="shrink-0 text-xs font-bold text-muted">
        {g.playerIds.length} joueur{g.playerIds.length > 1 ? 's' : ''} ›
      </span>
    </Link>
  )
}

/** Création ou modification d'un groupe (nom, description). */
function GroupForm({ group, playerIds = [], onDone }: { group?: PlayerGroup; playerIds?: string[]; onDone: (g?: PlayerGroup) => void }) {
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  return (
    <div className="flex flex-col gap-2">
      <span className="label">Nom du groupe</span>
      <input className="field" autoFocus={!group} placeholder="Ex. Intercomités 83 – 2010, Pôle Espoirs garçons…" value={name} onChange={(e) => setName(e.target.value)} />
      <span className="label">Description</span>
      <input className="field" placeholder="Description (saison, encadrant…) — facultatif" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={!name.trim()}
          onClick={async () => {
            const fields = { name: name.trim(), description: description.trim() || undefined }
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
                  {p.firstName} {p.lastName} <PosBadge pos={p.position} />
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
