import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { age, alive, db, type Measurement } from '../db'
import { Avatar, Empty, fmtValue, PosBadge } from '../components/ui'
import { arrowNav, fold, usePlayerFilter, useSessionState } from '../components/PlayerFilter'
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
  const { filtered, ui, signature } = usePlayerFilter(players)
  // Nombre de joueurs affichés et position dans la liste : retrouvés au retour d'une fiche.
  const [limit, setLimit] = useSessionState('handbase.joueurs.limit', PAGE)
  const [limitFor, setLimitFor] = useSessionState('handbase.joueurs.limitFor', signature)
  useEffect(() => {
    if (signature !== limitFor) {
      setLimit(PAGE)
      setLimitFor(signature)
    }
  }, [signature, limitFor, setLimit, setLimitFor])
  const restored = useRef(false)
  useEffect(() => {
    if (!players || restored.current) return
    restored.current = true
    const y = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0)
    if (y) requestAnimationFrame(() => window.scrollTo(0, y))
  }, [players])
  useEffect(() => {
    const keep = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
    window.addEventListener('scroll', keep, { passive: true })
    return () => window.removeEventListener('scroll', keep)
  }, [])

  const latest = useMemo(() => latestByPlayer(measurements), [measurements])

  if (!players) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const shown = filtered.slice(0, limit)

  return (
    <div onKeyDown={(e) => arrowNav(e, 'a[data-player]')}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold">Joueurs</h1>
        <div className="flex gap-2">
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void exportCsv(filtered)} disabled={!filtered.length}>
            Exporter{filtered.length < players.length ? ` (${filtered.length.toLocaleString('fr-FR')})` : ''}
          </button>
          {can.editPlayers(role) && (
            <Link to="/joueurs/nouveau" className="btn-primary px-3 py-1.5 text-xs">
              + Joueur
            </Link>
          )}
        </div>
      </div>

      <div className="mb-3">{ui}</div>
      <p className="mb-2 text-[11px] text-muted">{filtered.length.toLocaleString('fr-FR')} joueur(s)</p>

      {shown.length === 0 ? (
        <Empty>{players.length ? 'Aucun joueur ne correspond.' : 'Aucun joueur pour l’instant. Inscris le premier !'}</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((p) => {
            const l = latest.get(p.id)
            const a = age(p.birthDate)
            return (
              <Link
                key={p.id}
                data-player
                to={`/joueurs/${p.id}`}
                className="card flex items-center gap-3 p-3 transition outline-none hover:border-accent focus:border-accent focus:bg-panel-2"
              >
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
const SCROLL_KEY = 'handbase.joueurs.scroll'

export { fold }
