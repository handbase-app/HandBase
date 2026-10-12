import { useLiveQuery } from 'dexie-react-hooks'
import { Link, Navigate, Outlet, useParams } from 'react-router-dom'
import MasterDetail from '../components/MasterDetail'
import { ContextBar, ContextRoster, useLeaveTo } from '../components/ContextRoster'
import { RewatchToggle, SeenEye } from '../components/Scouting'
import { Icon } from '../components/ui'
import { alive, db, type Player, type Rewatch } from '../db'
import { MQ, useMedia } from '../layout'
import { eventSections, sortRoster, useRosterGroup, useRosterSort } from '../rosterOrder'
import { numOf, sightingNames, sightings } from '../scouting'
import PlayerDetail from './PlayerDetail'

/*
 * Fiche d'un joueur ouverte depuis un événement : /evenements/:id/joueurs/:pid (partageable).
 * Ordinateur : les joueurs de l'événement seulement à gauche (même ordre et mêmes titres que sa page : tri choisi,
 * « Par équipe et poste »…), la fiche à droite ; « Fermer » revient à l'événement. Téléphone : fiche en plein écran
 * sous la barre « événement · 5 / 23 » (‹ ›, retour à l'événement à la même position).
 */

/** Joueurs de l'événement, dans l'ordre de sa page (sans ses filtres : tous les joueurs de la liste). */
function useEventRoster(id: string) {
  // Même ordre que la page de l'événement : tri gardé sur l'appareil, regroupement gardé pendant la session.
  const [sort] = useRosterSort(id)
  const [group] = useRosterGroup(id)
  const data = useLiveQuery(async () => {
    const ev = await db.events.get(id)
    if (!ev || ev.deleted) return { ev: null }
    const [found, seen, evals, rewatch] = await Promise.all([
      db.players.bulkGet(ev.playerIds ?? []),
      db.seen.where('eventId').equals(id).toArray().then(alive),
      db.evaluations.where('eventId').equals(id).toArray().then(alive),
      db.rewatch.toArray().then(alive),
    ])
    const byId = new Map(alive(found.filter((p): p is Player => !!p)).map((p) => [p.id, p]))
    const roster = (ev.playerIds ?? []).map((pid) => byId.get(pid)).filter((p): p is Player => !!p)
    return { ev, roster, seen, evals, rewatch: rewatch.filter((r) => r.originEventId === id) }
  }, [id])
  if (!data?.ev) return data
  const sections = eventSections(sortRoster(data.roster, sort), data.ev, group)
  const rewatchFrom = new Map<string, Rewatch[]>()
  for (const r of data.rewatch) rewatchFrom.set(r.playerId, [...(rewatchFrom.get(r.playerId) ?? []), r])
  return { ...data, sections, ids: sections.flatMap((s) => s.players.map((p) => p.id)), sight: sightings(data.seen, data.evals), rewatchFrom }
}

export default function EventPlayers() {
  const { id = '', pid } = useParams()
  const split = useMedia(MQ.split)
  const base = `/evenements/${id}/joueurs`
  const leave = useLeaveTo(`/evenements/${id}`)
  const data = useEventRoster(id)

  // Sans joueur choisi : l'événement lui-même.
  if (!pid) return <Navigate to={`/evenements/${id}`} replace />
  if (data === undefined) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (data.ev === null) return <div className="py-20 text-center text-sm text-muted">Événement introuvable.</div>
  const { ev, sections, ids, sight, rewatchFrom } = data

  if (!split)
    return (
      <>
        <ContextBar title={ev.name} ids={ids} current={pid} base={base} back={() => void leave()} />
        <Outlet />
      </>
    )
  return (
    <MasterDetail
      base={base}
      closeTo={`/evenements/${id}`}
      listCol="minmax(0, var(--md-col))"
      list={
        <ContextRoster
          base={base}
          back={{ label: ev.name, go: () => void leave() }}
          count={`${ids.length} joueur${ids.length > 1 ? 's' : ''}`}
          sections={sections}
          number={(p) => numOf(ev, p.id)}
          detail={(p) => [p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}
          actions={(p) => (
            <>
              <SeenEye eventId={ev.id} playerId={p.id} list={sight.get(p.id)} />
              <RewatchToggle playerId={p.id} originEventId={ev.id} rows={rewatchFrom.get(p.id)} />
            </>
          )}
        />
      }
    />
  )
}

/** Fiche du joueur, sous un bandeau de ce que l'événement en dit (positif ou neutre seulement). */
export function EventPlayer() {
  const { id = '', pid = '' } = useParams()
  const ctx = useLiveQuery(async () => {
    const [ev, seen, evals] = await Promise.all([
      db.events.get(id),
      db.seen.where('eventId').equals(id).toArray().then(alive),
      db.evaluations.where('eventId').equals(id).toArray().then(alive),
    ])
    const mine = evals.filter((e) => e.playerId === pid)
    return { ev, sight: sightings(seen, mine).get(pid) ?? [], avis: mine.length }
  }, [id, pid])
  const split = useMedia(MQ.split)
  return (
    <div key={pid} className="flex flex-col gap-3">
      {ctx?.ev && !ctx.ev.deleted && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            {/* Téléphone : le nom est déjà dans la barre du haut. */}
            {split && <span className="block truncate font-bold">{ctx.ev.name}</span>}
            {!split && ctx.sight.length === 0 && ctx.avis === 0 && <span className="text-[11px] text-muted">Dans cet événement</span>}
            {(ctx.sight.length > 0 || ctx.avis > 0) && (
              <span className="block text-[11px] text-muted">
                {[
                  ctx.sight.length > 0 && (
                    <span key="vu" className="text-accent">
                      <Icon name="eye" className="mr-0.5 inline h-3 w-3 -translate-y-px" />
                      vu par {sightingNames(ctx.sight)}
                    </span>
                  ),
                  ctx.avis > 0 && <span key="avis">{ctx.avis} avis ici</span>,
                ]
                  .filter(Boolean)
                  .flatMap((x, k) => (k ? [<span key={`s${k}`}> · </span>, x] : [x]))}
              </span>
            )}
          </span>
          <Link to={`/evaluer?evenement=${id}&joueur=${pid}`} className="btn-primary flex min-h-8 shrink-0 items-center px-3 py-1 text-xs">
            Évaluer dans cet événement
          </Link>
        </div>
      )}
      {/* Téléphone : la barre du haut fait le retour à l'événement. */}
      <PlayerDetail id={pid} hideBack={!split} />
    </div>
  )
}
