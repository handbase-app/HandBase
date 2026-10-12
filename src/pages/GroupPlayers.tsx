import { useLiveQuery } from 'dexie-react-hooks'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import MasterDetail from '../components/MasterDetail'
import { ContextBar, ContextRoster, useLeaveTo } from '../components/ContextRoster'
import { FollowStar } from '../components/Follow'
import { playerSub } from '../components/PlayerRow'
import { GroupRewatchLine, RewatchToggle, useGroupRewatch } from '../components/Scouting'
import { GroupMark } from '../components/ui'
import { alive, db, type Player } from '../db'
import { MQ, useMedia } from '../layout'
import { can } from '../roles'
import { sortByName } from '../rosterOrder'
import { loadTeams } from '../teams'
import PlayerDetail from './PlayerDetail'
import { groupAddedBy } from './Groups'

/*
 * Fiche d'un joueur ouverte depuis un groupe : /groupes/:id/joueurs/:pid (partageable), comme depuis un événement
 * (EventPlayers.tsx). Ordinateur : les joueurs du groupe seulement à gauche, dans l'ordre de sa page (alphabétique),
 * la fiche à droite ; « Fermer » revient au groupe. Téléphone : fiche en plein écran sous la barre « groupe · 5 / 23 »
 * (‹ ›, retour au groupe à la même position).
 */

/** Groupe et ses joueurs, dans l'ordre de sa page. null : groupe introuvable ou pas visible. */
function useGroupRoster(id: string) {
  return useLiveQuery(async () => {
    await loadTeams()
    const g = await db.groups.get(id)
    if (!g || g.deleted || !can.seeGroup(g)) return { g: null }
    const players = sortByName(alive((await db.players.bulkGet(g.playerIds)).filter((p): p is Player => !!p)))
    return { g, players, ids: players.map((p) => p.id) }
  }, [id])
}

export default function GroupPlayers() {
  const { id = '', pid } = useParams()
  const split = useMedia(MQ.split)
  const base = `/groupes/${id}/joueurs`
  const leave = useLeaveTo(`/groupes/${id}`)
  const data = useGroupRoster(id)
  const rewatch = useGroupRewatch(id)

  if (!pid) return <Navigate to={`/groupes/${id}`} replace />
  if (data === undefined) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (data.g === null) return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>
  const { g, players, ids } = data

  if (!split)
    return (
      <>
        <ContextBar title={g.name} ids={ids} current={pid} base={base} back={() => void leave()} />
        <Outlet />
      </>
    )
  return (
    <MasterDetail
      base={base}
      closeTo={`/groupes/${id}`}
      listCol="minmax(0, var(--md-col))"
      list={
        <ContextRoster
          base={base}
          back={{ label: g.name, go: () => void leave() }}
          count={`${ids.length} joueur${ids.length > 1 ? 's' : ''}`}
          sections={[{ players }]}
          detail={(p) => playerSub(p)}
          actions={(p) => ({
            rewatch: <RewatchToggle playerId={p.id} groupId={g.id} rows={rewatch.by.get(p.id)} />,
            follow: <FollowStar id={p.id} />,
          })}
        />
      }
    />
  )
}

/** Fiche du joueur, sous un bandeau de ce que le groupe en dit (positif ou neutre seulement). */
export function GroupPlayer() {
  const { id = '', pid = '' } = useParams()
  const g = useLiveQuery(() => db.groups.get(id), [id])
  const rewatch = useGroupRewatch(id)
  const split = useMedia(MQ.split)
  const visible = g && !g.deleted && can.seeGroup(g) && g.playerIds.includes(pid)
  const by = visible ? groupAddedBy(g, pid) : undefined
  const rows = rewatch.by.get(pid) ?? []
  return (
    <div key={pid} className="flex flex-col gap-3">
      {visible && (
        <div className="flex flex-col gap-1 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
          {/* Téléphone : le nom est déjà dans la barre du haut. */}
          {split && (
            <span className="block truncate font-bold">
              <GroupMark g={g} />
              {g.name}
            </span>
          )}
          <span className="text-[11px] text-muted">{by ? `Dans ce groupe, ajouté par ${by}` : 'Dans ce groupe'}</span>
          <GroupRewatchLine rows={rows} events={rewatch.events} />
        </div>
      )}
      {/* Téléphone : la barre du haut fait le retour au groupe. */}
      <PlayerDetail id={pid} hideBack={!split} />
    </div>
  )
}
