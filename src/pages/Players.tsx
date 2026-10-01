import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { age, alive, db, POSITIONS, type Measurement, type Position } from '../db'
import { Avatar, Empty, fmtValue, PosBadge } from '../components/ui'
import { exportCsv } from '../export'

/** Dernière valeur de chaque critère factuel, par joueur. */
export function latestByPlayer(ms: Measurement[]) {
  const out = new Map<string, Map<string, Measurement>>()
  for (const m of ms) {
    if (m.deleted) continue
    if (!out.has(m.playerId)) out.set(m.playerId, new Map())
    const cur = out.get(m.playerId)!.get(m.criterionId)
    if (!cur || m.date > cur.date || (m.date === cur.date && m.updatedAt > cur.updatedAt)) out.get(m.playerId)!.set(m.criterionId, m)
  }
  return out
}

export default function Players() {
  const players = useLiveQuery(() => db.players.orderBy('lastName').toArray().then(alive))
  const measurements = useLiveQuery(() => db.measurements.where('criterionId').anyOf('taille', 'poids').toArray(), [], [])
  const [filter, setFilter] = useState<Position | 'all'>('all')
  const [q, setQ] = useState('')

  const latest = useMemo(() => latestByPlayer(measurements), [measurements])

  if (!players) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const counts = Object.fromEntries(POSITIONS.map((p) => [p.id, players.filter((x) => x.position === p.id).length]))
  const shown = players.filter(
    (p) =>
      (filter === 'all' || p.position === filter) &&
      (!q || `${p.firstName} ${p.lastName} ${p.club ?? ''} ${p.team ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  )

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold">Joueurs</h1>
        <div className="flex gap-2">
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void exportCsv()} disabled={!players.length}>
            Exporter
          </button>
          <Link to="/joueurs/nouveau" className="btn-primary px-3 py-1.5 text-xs">
            + Joueur
          </Link>
        </div>
      </div>

      <input className="field mb-3" placeholder="Rechercher (nom, club, équipe)…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ id: 'all' as const, short: 'Tous' }, ...POSITIONS].map((p) => (
          <button
            key={p.id}
            onClick={() => setFilter(p.id)}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-bold ${
              filter === p.id ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-muted'
            }`}
          >
            {p.short} {p.id === 'all' ? players.length : counts[p.id]}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty>{players.length ? 'Aucun joueur ne correspond.' : 'Aucun joueur pour l’instant. Inscris le premier !'}</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((p) => {
            const l = latest.get(p.id)
            const a = age(p.birthDate)
            return (
              <Link key={p.id} to={`/joueurs/${p.id}`} className="card flex items-center gap-3 p-3 transition hover:border-accent">
                <Avatar p={p} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">
                    {p.firstName} {p.lastName}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                    <PosBadge pos={p.position} />
                    {a !== null && <span>{a} ans</span>}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted">
                    {[
                      l?.get('taille') && `${fmtValue(undefined, l.get('taille')!.value)} cm`,
                      l?.get('poids') && `${fmtValue(undefined, l.get('poids')!.value)} kg`,
                      p.laterality && p.laterality[0].toUpperCase() + p.laterality.slice(1),
                      p.club,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <span className="text-muted">›</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
