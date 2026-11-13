import { useLiveQuery } from 'dexie-react-hooks'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import MasterDetail from '../components/MasterDetail'
import { ContextBar, ContextRoster, useLeaveTo } from '../components/ContextRoster'
import { FollowStar } from '../components/Follow'
import { playerSub } from '../components/PlayerRow'
import { GroupRewatchLine, RewatchToggle, useGroupRewatch } from '../components/Scouting'
import { GroupMark } from '../components/ui'
import { alive, db, type Player } from '../db'
import { pluralG, setGender, w } from '../gender'
import { MQ, useMedia } from '../layout'
import { can } from '../roles'
import { groupRosterKey, positionRosterView, useRosterSort } from '../rosterOrder'
import { loadTeams } from '../teams'
import PlayerDetail from './PlayerDetail'
import { groupAddedBy } from './Groups'
import { PoleChip, usePoleMembers, usePoleRef } from '../components/PoleGroup'
import { isMemberAt } from '../poleSeason'
import { poleViewOf, withPoleView } from '../tabQuery'

/*
 * Fiche d'un joueur ouverte depuis un groupe : /groupes/:id/joueurs/:pid (partageable), comme depuis un événement
 * (EventPlayers.tsx). Ordinateur : les joueurs du groupe seulement à gauche, dans l'ordre et sous les titres de sa page
 * (par poste, tri choisi dans chaque poste ; sans le filtre d'un poste),
 * la fiche à droite ; « Fermer » revient au groupe. Téléphone : fiche en plein écran sous la barre « groupe · 5 / 23 »
 * (‹ ›, retour au groupe à la même position).
 */

/**
 * Groupe et ses joueurs, dans l'ordre et par poste comme sur sa page. null : groupe introuvable ou pas visible.
 * Groupe Pôle (src/poleSeason.ts) : membres calculés depuis les fiches, pour la vue de l'adresse (?saison=prochaine).
 */
function useGroupRoster(id: string, view: ReturnType<typeof poleViewOf>) {
  const [sort] = useRosterSort(groupRosterKey(id))
  const data = useLiveQuery(async () => {
    await loadTeams()
    const g = await db.groups.get(id)
    if (!g || g.deleted || !can.seeGroup(g)) return { g: null }
    return { g, players: alive((await db.players.bulkGet(g.playerIds)).filter((p): p is Player => !!p)) }
  }, [id])
  const ref = usePoleRef(data?.g?.poleUnitId)
  const pm = usePoleMembers(data?.g?.poleUnitId ? ref : null, view)
  if (!data?.g) return data
  if (data.g.poleUnitId && !pm) return undefined
  const players = data.g.poleUnitId ? pm!.shown : data.players
  const { roster, sections } = positionRosterView(players, sort)
  return { g: data.g, sections, ids: roster.map((p) => p.id), gender: setGender(ref?.sex ?? data.g.sex, players) }
}

export default function GroupPlayers() {
  const { id = '', pid } = useParams()
  const split = useMedia(MQ.split)
  const base = `/groupes/${id}/joueurs`
  const loc = useLocation()
  const view = poleViewOf(loc.search)
  const data = useGroupRoster(id, view)
  // Retour au groupe Pôle sur la même vue.
  const search = data?.g?.poleUnitId ? withPoleView('', view) : ''
  const leave = useLeaveTo(`/groupes/${id}${search}`, data?.g?.name ?? '')
  const rewatch = useGroupRewatch(id)

  if (!pid) return <Navigate to={`/groupes/${id}`} replace />
  if (data === undefined) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (data.g === null) return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>
  const { g, sections, ids, gender } = data

  if (!split)
    return (
      <>
        <ContextBar title={g.name} ids={ids} current={pid} base={base} search={search} back={() => void leave.go()}>
          <Outlet />
        </ContextBar>
      </>
    )
  return (
    <MasterDetail
      base={base}
      closeTo={`/groupes/${id}${search}`}
      listCol="minmax(0, var(--md-col))"
      list={
        <ContextRoster
          base={base}
          search={search}
          back={leave}
          count={pluralG(ids.length, gender)}
          sections={sections}
          detail={(p) => playerSub(p)}
          actions={(p) => ({
            rewatch: <RewatchToggle playerId={p.id} groupId={g.id} rows={rewatch.by.get(p.id)} />,
            follow: <FollowStar id={p.id} sex={p.sex} />,
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
  const sex = useLiveQuery(() => db.players.get(pid).then((p) => p?.sex), [pid])
  const rewatch = useGroupRewatch(id)
  const split = useMedia(MQ.split)
  // Groupe Pôle : membre si une période de ce pôle couvre la date de la vue (?saison=…).
  const view = poleViewOf(useLocation().search)
  const ref = usePoleRef(g?.poleUnitId)
  const pm = usePoleMembers(g?.poleUnitId ? ref : null, view)
  const player = useLiveQuery(() => db.players.get(pid), [pid])
  const member = g?.poleUnitId ? !!(ref && pm && player && isMemberAt(player, ref, view === 'prochaine' ? pm.s.refNext : pm.s.refCurrent)) : !!g?.playerIds.includes(pid)
  const visible = g && !g.deleted && can.seeGroup(g) && member
  const by = visible && !g.poleUnitId ? groupAddedBy(g, pid) : undefined
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
              {g.poleUnitId && <PoleChip />}
            </span>
          )}
          <span className="text-[11px] text-muted">
            {by ? `Dans ce groupe, ${w(sex).ajoute} par ${by}` : g.poleUnitId ? `Au pôle (${view === 'prochaine' ? 'saison prochaine' : 'saison en cours'})` : 'Dans ce groupe'}
          </span>
          <GroupRewatchLine rows={rows} events={rewatch.events} sex={sex} />
        </div>
      )}
      {/* Téléphone : la barre du haut fait le retour au groupe. */}
      <PlayerDetail id={pid} hideBack={!split} />
    </div>
  )
}
