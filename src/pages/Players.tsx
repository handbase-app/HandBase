import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { age, alive, db, POSITIONS, type Measurement, type Position } from '../db'
import { Avatar, Empty, fmtValue, PosBadge } from '../components/ui'
import { exportCsv } from '../export'
import { can, useRole } from '../roles'

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
  const role = useRole()
  const players = useLiveQuery(() => db.players.orderBy('lastName').toArray().then(alive))
  const measurements = useLiveQuery(() => db.measurements.where('criterionId').anyOf('taille', 'poids').toArray(), [], [])
  const [filter, setFilter] = useState<Position | 'all'>('all')
  const [q, setQ] = useState('')
  const [club, setClub] = useState('')
  const [year, setYear] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const latest = useMemo(() => latestByPlayer(measurements), [measurements])
  const clubs = useMemo(() => countBy(players ?? [], (p) => p.club), [players])
  const years = useMemo(() => countBy(players ?? [], (p) => p.birthDate?.slice(0, 4)).sort((a, b) => b[0].localeCompare(a[0])), [players])

  if (!players) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const scoped = players.filter((p) => (!club || p.club === club) && (!year || p.birthDate?.startsWith(year)))
  const counts = Object.fromEntries(POSITIONS.map((p) => [p.id, scoped.filter((x) => x.position === p.id).length]))
  const words = fold(q).split(/\s+/).filter(Boolean)
  const filtered = scoped.filter((p) => {
    if (filter !== 'all' && p.position !== filter) return false
    if (!words.length) return true
    const hay = fold(`${p.firstName} ${p.lastName} ${p.club ?? ''} ${p.team ?? ''} ${p.license ?? ''}`)
    return words.every((w) => hay.includes(w))
  })
  const shown = filtered.slice(0, limit)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold">Joueurs</h1>
        <div className="flex gap-2">
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void exportCsv()} disabled={!players.length}>
            Exporter
          </button>
          {can.editPlayers(role) && (
            <Link to="/joueurs/nouveau" className="btn-primary px-3 py-1.5 text-xs">
              + Joueur
            </Link>
          )}
        </div>
      </div>

      <input
        className="field mb-2"
        placeholder="Rechercher (nom, club, licence)…"
        value={q}
        onChange={(e) => (setQ(e.target.value), setLimit(PAGE))}
      />
      {(clubs.length > 1 || years.length > 1) && (
        <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
          <select className="field py-1.5 text-xs" value={club} onChange={(e) => (setClub(e.target.value), setLimit(PAGE))}>
            <option value="">Tous les clubs ({players.length.toLocaleString('fr-FR')})</option>
            {clubs.map(([c, n]) => (
              <option key={c} value={c}>
                {c} ({n})
              </option>
            ))}
          </select>
          <select className="field w-32 py-1.5 text-xs" value={year} onChange={(e) => (setYear(e.target.value), setLimit(PAGE))}>
            <option value="">Toutes années</option>
            {years.map(([y, n]) => (
              <option key={y} value={y}>
                {y} ({n})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ id: 'all' as const, short: 'Tous' }, ...POSITIONS].map((p) => (
          <button
            key={p.id}
            onClick={() => (setFilter(p.id), setLimit(PAGE))}
            className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-bold ${
              filter === p.id ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-muted'
            }`}
          >
            {p.short} {p.id === 'all' ? scoped.length : counts[p.id]}
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
          {filtered.length > shown.length && (
            <button className="btn-ghost text-xs" onClick={() => setLimit((l) => l + PAGE)}>
              Afficher plus ({(filtered.length - shown.length).toLocaleString('fr-FR')} restants)
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Nombre de joueurs affichés d'un coup (la base peut en contenir des milliers). */
const PAGE = 60

/** Texte sans accents ni majuscules, pour la recherche. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

function countBy<T>(items: T[], key: (t: T) => string | undefined): [string, number][] {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))
}
