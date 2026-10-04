import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { alive, db, newId, save, type PlayerGroup } from '../db'
import { can, useRole } from '../roles'

/** Ajoute des joueurs au groupe (sans doublon, ordre conservé). Renvoie le nombre de nouveaux. */
export function addToGroup(g: PlayerGroup, ids: string[]) {
  // Relecture et écriture d'un bloc : des clics rapprochés s'enchaînent sans s'écraser.
  return db.transaction('rw', db.groups, db.outbox, async () => {
    const cur = (await db.groups.get(g.id)) ?? g
    const have = new Set(cur.playerIds)
    const added = [...new Set(ids)].filter((id) => !have.has(id))
    if (added.length) await save<PlayerGroup>('groups', { ...cur, playerIds: [...cur.playerIds, ...added] })
    return added.length
  })
}

export function removeFromGroup(g: PlayerGroup, ids: string[]) {
  return db.transaction('rw', db.groups, db.outbox, async () => {
    const cur = (await db.groups.get(g.id)) ?? g
    const drop = new Set(ids)
    await save<PlayerGroup>('groups', { ...cur, playerIds: cur.playerIds.filter((id) => !drop.has(id)) })
  })
}

/**
 * « Mettre dans un groupe » : choisir un de ses groupes, ou en créer un nouveau avec ces joueurs.
 * `playerIds` : les joueurs à ajouter (ceux affichés après les filtres, ou un seul joueur).
 */
export function AddToGroup({ playerIds, onDone }: { playerIds: string[]; onDone: (msg?: string) => void }) {
  const role = useRole()
  const groups = useLiveQuery(() => db.groups.orderBy('name').toArray().then((gs) => alive(gs).filter((g) => !g.archived)), [], [])
  const mine = groups.filter((g) => can.editGroup(role, g))
  const [name, setName] = useState('')
  const n = playerIds.length
  const label = n > 1 ? `${n.toLocaleString('fr-FR')} joueurs` : 'ce joueur'

  async function create() {
    const g = await save<PlayerGroup>('groups', { id: newId(), name: name.trim(), playerIds: [...new Set(playerIds)] })
    onDone(`Groupe « ${g.name} » créé avec ${label}.`)
  }

  return (
    <div className="card flex flex-col gap-2 border-accent/40 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-extrabold">Mettre {label} dans un groupe</div>
        <button className="text-xs text-muted hover:text-white" onClick={() => onDone()}>
          Fermer
        </button>
      </div>
      {mine.length > 0 && (
        <div className="flex flex-col gap-1">
          {mine.map((g) => {
            const already = playerIds.every((id) => g.playerIds.includes(id))
            return (
              <button
                key={g.id}
                disabled={already}
                className="flex items-center justify-between rounded-md border border-line bg-panel-2 px-3 py-2 text-left text-xs hover:border-accent disabled:opacity-50"
                onClick={async () => {
                  const added = await addToGroup(g, playerIds)
                  onDone(added ? `${added.toLocaleString('fr-FR')} joueur(s) ajouté(s) à « ${g.name} ».` : `Déjà dans « ${g.name} ».`)
                }}
              >
                <span className="truncate font-bold">{g.name}</span>
                <span className="shrink-0 text-muted">{already ? 'déjà dedans' : `${g.playerIds.length} joueurs`}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="flex gap-2">
        <input
          className="field flex-1 py-1.5 text-xs"
          placeholder="Nouveau groupe : Intercomités 83 – 2010…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()}
        />
        <button className="btn-primary shrink-0 px-3 py-1.5 text-xs" disabled={!name.trim()} onClick={() => void create()}>
          Créer
        </button>
      </div>
      {groups.length > mine.length && (
        <p className="text-[10px] text-muted">Les groupes créés par d’autres encadrants ne se modifient que par eux (ou un administrateur).</p>
      )}
    </div>
  )
}

/** Groupes d'un joueur, en pastilles (fiche joueur). */
export function PlayerGroups({ playerId }: { playerId: string }) {
  const role = useRole()
  const groups = useLiveQuery(
    () => db.groups.toArray().then((gs) => alive(gs).filter((g) => !g.archived && g.playerIds.includes(playerId))),
    [playerId],
    [],
  )
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')
  if (!groups.length && !can.manageGroups(role)) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold tracking-wider text-muted uppercase">Groupes</span>
        {groups.map((g) => (
          <Link key={g.id} to={`/groupes/${g.id}`} className="rounded-full border border-accent/50 bg-accent-soft px-2.5 py-0.5 text-[11px] font-bold hover:border-accent">
            {g.name}
          </Link>
        ))}
        {!groups.length && <span className="text-[11px] text-muted">aucun</span>}
        {can.manageGroups(role) && !adding && (
          <button className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-[11px] text-muted hover:text-white" onClick={() => (setAdding(true), setMsg(''))}>
            + Ajouter à un groupe
          </button>
        )}
      </div>
      {adding && <AddToGroup playerIds={[playerId]} onDone={(m) => (setAdding(false), setMsg(m ?? ''))} />}
      {msg && <p className="text-[11px] text-emerald-300">{msg}</p>}
    </div>
  )
}
