import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar, Empty, PosBadge } from '../components/ui'
import { alive, db, fmtDate, remove } from '../db'
import { EVENT_TYPES, NewEventForm } from './Evaluate'
import { ask } from '../components/Confirm'
import { can, useRole } from '../roles'

const typeLabel = (t: string) => EVENT_TYPES.find((x) => x.value === t)?.label ?? t

export default function Events() {
  const events = useLiveQuery(() => db.events.orderBy('date').reverse().toArray().then(alive))
  const evals = useLiveQuery(() => db.evaluations.toArray().then(alive), [], [])
  const [creating, setCreating] = useState(false)
  const nav = useNavigate()

  if (!events) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">Matchs & tournois</h1>
        {!creating && (
          <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setCreating(true)}>
            + Événement
          </button>
        )}
      </div>
      {creating && (
        <div className="card p-3">
          <NewEventForm onDone={(ev) => (setCreating(false), ev && nav(`/evenements/${ev.id}`))} />
        </div>
      )}
      {events.length === 0 ? (
        <Empty>Crée un match ou un tournoi pour que plusieurs observateurs puissent y rattacher leurs avis.</Empty>
      ) : (
        events.map((ev) => {
          const es = evals.filter((e) => e.eventId === ev.id)
          return (
            <Link key={ev.id} to={`/evenements/${ev.id}`} className="card flex items-center justify-between p-3 hover:border-accent">
              <div>
                <div className="text-sm font-bold">{ev.name}</div>
                <div className="text-[11px] text-muted">
                  {typeLabel(ev.type)} · {fmtDate(ev.date)}
                  {ev.place ? ` · ${ev.place}` : ''}
                </div>
              </div>
              <div className="text-right text-[11px] text-muted">
                <div>
                  <b className="text-white">{new Set(es.map((e) => e.playerId)).size}</b> joueurs
                </div>
                <div>
                  <b className="text-white">{new Set(es.map((e) => e.observer)).size}</b> observateurs
                </div>
              </div>
            </Link>
          )
        })
      )}
    </div>
  )
}

export function EventDetail() {
  const { id } = useParams()
  const role = useRole()
  const nav = useNavigate()
  const data = useLiveQuery(async () => {
    const ev = await db.events.get(id!)
    const evals = alive(await db.evaluations.where('eventId').equals(id!).toArray())
    const players = alive(await db.players.bulkGet([...new Set(evals.map((e) => e.playerId))]).then((x) => x.filter((p) => !!p)))
    return { ev, evals, players }
  }, [id])

  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const { ev, evals, players } = data
  if (!ev || ev.deleted) return <div className="py-20 text-center text-sm text-muted">Événement introuvable.</div>

  const observers = [...new Set(evals.map((e) => e.observer))].sort()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button onClick={() => nav('/evenements')} className="text-xs font-bold text-muted">
          ← MATCHS & TOURNOIS
        </button>
        {can.manageEvents(role) && (
        <button
          className="text-xs text-muted hover:text-red-400"
          onClick={async () => {
            if (!(await ask(`Supprimer « ${ev.name} » ? Les avis restent rattachés aux joueurs.`, { ok: 'Supprimer' }))) return
            await remove('events', ev.id)
            nav('/evenements', { replace: true })
          }}
        >
          Supprimer
        </button>
        )}
      </div>
      <div>
        <h1 className="text-lg font-extrabold">{ev.name}</h1>
        <div className="text-xs text-muted">
          {typeLabel(ev.type)} · {fmtDate(ev.date)}
          {ev.place ? ` · ${ev.place}` : ''}
        </div>
        {observers.length > 0 && <div className="mt-1 text-[11px] text-muted">Observateurs : {observers.join(', ')}</div>}
      </div>

      <Link to={`/evaluer?evenement=${ev.id}`} className="btn-primary">
        Évaluer des joueurs sur cet événement
      </Link>

      {players.length === 0 ? (
        <Empty>Aucun avis encore saisi pour cet événement.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {players.map((p) => {
            const es = evals.filter((e) => e.playerId === p.id)
            const overalls = es.map((e) => e.overall).filter((x): x is number => typeof x === 'number')
            const avg = overalls.length ? overalls.reduce((a, b) => a + b, 0) / overalls.length : null
            return (
              <Link key={p.id} to={`/joueurs/${p.id}`} className="card flex items-center gap-3 p-3 hover:border-accent">
                <Avatar p={p} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-bold">
                    {p.firstName} {p.lastName} <PosBadge pos={p.position} />
                  </div>
                  <div className="text-[11px] text-muted">
                    {es.length} avis · {[...new Set(es.map((e) => e.observer))].join(', ')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-extrabold text-accent">{avg === null ? '—' : avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</div>
                  <div className="text-[9px] text-muted">note glob.</div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
