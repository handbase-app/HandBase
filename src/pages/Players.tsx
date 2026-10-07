import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { age, alive, db, lateralityLabel, plural, type Measurement } from '../db'
import { Avatar, Empty, fmtValue, PosBadges, QuarterBadge } from '../components/ui'
import { ReviewBadge } from '../components/Review'
import { arrowNav, fold, usePlayerFilter, useSessionState } from '../components/PlayerFilter'
import { exportCsv } from '../export'
import { AddToGroupDialog, GroupNotice } from '../components/Groups'
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
  const all = useLiveQuery(() => db.players.orderBy('lastName').toArray().then(alive))
  const measurements = useLiveQuery(() => db.measurements.where('criterionId').anyOf('taille', 'poids').toArray(), [], [])
  // Fiches : la base (fiches proposées comprises) ; les proposées seules ; les fiches hors cadre, gardées pour mémoire.
  const [view, setView] = useSessionState<'base' | 'pending' | 'refused'>('handbase.joueurs.view', 'base')
  const nPending = all?.filter((p) => p.review === 'pending').length ?? 0
  const nRefused = all?.filter((p) => p.review === 'refused').length ?? 0
  const players = useMemo(
    () => all?.filter((p) => (view === 'base' ? p.review !== 'refused' : p.review === view)),
    [all, view],
  )
  const { filtered, ui, signature: filterSig, group } = usePlayerFilter(players)
  const [grouping, setGrouping] = useState(false)
  const [groupMsg, setGroupMsg] = useState<{ text: string; groupId?: string }>({ text: '' })
  const signature = `${view}|${filterSig}`
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

  if (!players || !all) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const shown = filtered.slice(0, limit)

  return (
    <div onKeyDown={(e) => arrowNav(e, 'a[data-player]')}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold">Joueurs</h1>
        <div className="flex gap-2 whitespace-nowrap">
          {can.manageGroups(role) && (
            <button
              className="btn-ghost px-3 py-1.5 text-xs"
              title="Ajouter les joueurs affichés à un groupe (existant ou nouveau)"
              disabled={!filtered.length}
              onClick={() => (setGrouping(true), setGroupMsg({ text: '' }))}
            >
              → Groupe{filtered.length < all.length ? ` (${filtered.length.toLocaleString('fr-FR')})` : ''}
            </button>
          )}
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void exportCsv(filtered)} disabled={!filtered.length}>
            Exporter{filtered.length < all.length ? ` (${filtered.length.toLocaleString('fr-FR')})` : ''}
          </button>
          <Link to="/joueurs/nouveau" className="btn-primary px-3 py-1.5 text-xs">
            {can.editPlayers(role) ? '+ Joueur' : '+ Proposer'}
          </Link>
        </div>
      </div>

      {(nPending > 0 || nRefused > 0 || view !== 'base') && (
        <div className="mb-3 flex gap-2">
          {(
            [
              ['base', 'Base'],
              ['pending', `Proposées (${nPending})`],
              ['refused', `Hors cadre (${nRefused})`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-bold ${view === v ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {view === 'refused' && (
        <p className="mb-2 text-[11px] text-muted">
          Fiches proposées puis mises hors cadre : gardées pour mémoire.{' '}
          <Link to="/rates" className="font-bold text-accent">
            Ce qu’ils sont devenus (ratés) →
          </Link>
        </p>
      )}

      <div className="mb-3">{ui}</div>
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          {plural(filtered.length, 'joueur')}
          {group && (
            <>
              {' '}
              ·{' '}
              <Link to={`/groupes/${group.id}`} className="font-bold text-accent">
                ouvrir le groupe
              </Link>
            </>
          )}
        </span>
      </div>
      {grouping && (
        <AddToGroupDialog playerIds={filtered.map((p) => p.id)} onClose={(text, groupId) => (setGrouping(false), setGroupMsg({ text: text ?? '', groupId }))} />
      )}
      <div className="mb-2">
        <GroupNotice msg={groupMsg.text} groupId={groupMsg.groupId} />
      </div>

      {shown.length === 0 ? (
        <Empty>{players.length ? 'Aucun joueur ne correspond.' : view === 'base' ? 'Aucun joueur pour l’instant. Inscris le premier !' : 'Aucune fiche.'}</Empty>
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
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold">
                      {p.lastName.toUpperCase()} {p.firstName}
                    </span>
                    {p.review !== 'validated' && <ReviewBadge e={p} kind="players" />}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                    <PosBadges p={p} />
                    {a !== null && <span>{a} ans</span>}
                    <QuarterBadge birthDate={p.birthDate} />
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted">
                    {[
                      l?.get('taille') && `${fmtValue(undefined, l.get('taille')!.value)} cm`,
                      l?.get('poids') && `${fmtValue(undefined, l.get('poids')!.value)} kg`,
                      lateralityLabel(p.laterality, p.sex),
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
