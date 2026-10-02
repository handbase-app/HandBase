import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { fmtDate, remove, type Criterion, type Evaluation, type HBEvent, type Player } from '../db'
import { currentUserId, useRole } from '../roles'
import { ask } from './Confirm'
import { Empty } from './ui'

const COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb923c', '#f472b6', '#22d3ee', '#a3e635']
/** Écart (max − min) à partir duquel les avis sont considérés divergents. */
export const DIVERGENCE = 2

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const f1 = (n: number | null) => (n === null ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))

/**
 * Compare et cumule les avis subjectifs sur un joueur.
 * Si un observateur a donné plusieurs avis dans la période, on prend sa moyenne
 * pour qu'il ne pèse pas plus que les autres.
 */
export function Opinions({
  player,
  criteria,
  evaluations,
  events,
}: {
  player: Player
  criteria: Criterion[]
  evaluations: Evaluation[]
  events: HBEvent[]
}) {
  const [eventId, setEventId] = useState<string>('all')
  const [view, setView] = useState<'table' | 'radar'>('table')

  const evs = eventId === 'all' ? evaluations : evaluations.filter((e) => (e.eventId ?? 'none') === eventId)
  const usedEvents = events.filter((ev) => evaluations.some((e) => e.eventId === ev.id))
  const eventLabel = (id?: string) => {
    if (!id) return 'Hors événement'
    const ev = events.find((x) => x.id === id)
    if (!ev) return 'Événement inconnu'
    return ev.deleted ? `Événement supprimé : ${ev.name}` : ev.name
  }
  const role = useRole()
  const mayDelete = (e: Evaluation) => role === 'admin' || (!!e.observerId && e.observerId === currentUserId())
  const observers = [...new Set(evs.map((e) => e.observer))].sort()

  const rows = useMemo(() => {
    return criteria
      .map((c) => {
        const perObs = observers.map((o) => mean(evs.filter((e) => e.observer === o).map((e) => e.scores[c.id]).filter((x): x is number => typeof x === 'number')))
        const vals = perObs.filter((x): x is number => x !== null)
        const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0
        return { c, perObs, avg: mean(vals), n: vals.length, spread }
      })
      .filter((r) => r.n > 0)
  }, [criteria, evs, observers])

  const overall = mean(
    observers.map((o) => mean(evs.filter((e) => e.observer === o && typeof e.overall === 'number').map((e) => e.overall!))).filter((x): x is number => x !== null),
  )

  const evaluateLink = `/evaluer?joueur=${player.id}${eventId !== 'all' && eventId !== 'none' ? `&evenement=${eventId}` : ''}`

  if (!evaluations.length)
    return (
      <Empty>
        Aucun avis pour l’instant.
        <br />
        <Link to={evaluateLink} className="mt-3 inline-block font-bold text-accent">
          Donner le premier avis →
        </Link>
      </Empty>
    )

  const radarData = rows.map((r) => ({
    label: r.c.label,
    Moyenne: r.avg,
    ...Object.fromEntries(observers.map((o, i) => [o, r.perObs[i]])),
  }))

  const divergent = rows.filter((r) => r.spread >= DIVERGENCE)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <select className="field flex-1" value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="all">Tous les avis (cumul)</option>
          {usedEvents.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.deleted ? `(supprimé) ${ev.name}` : ev.name} · {fmtDate(ev.date)}
            </option>
          ))}
          {evaluations.some((e) => !e.eventId) && <option value="none">Hors événement</option>}
        </select>
        <div className="flex shrink-0 overflow-hidden rounded-md border border-line">
          {(['table', 'radar'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 text-xs font-bold ${view === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
              {v === 'table' ? 'Tableau' : 'Radar'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Avis" value={String(evs.length)} />
        <Stat label="Observateurs" value={String(observers.length)} />
        <Stat label="Note globale" value={overall === null ? '—' : `${f1(overall)}/5`} />
      </div>

      {divergent.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
          ⚠ Avis divergents sur : <b>{divergent.map((r) => r.c.label).join(', ')}</b> — à discuter en staff.
        </div>
      )}

      {view === 'table' ? (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr className="text-[10px] text-muted">
                <th className="sticky left-0 bg-panel px-1 py-1.5 text-left font-bold">Critère</th>
                <th className="px-1.5 py-1.5 font-bold text-accent">Moy.</th>
                {observers.map((o, i) => (
                  <th key={o} className="px-1.5 py-1.5 font-bold whitespace-nowrap" style={{ color: COLORS[i % COLORS.length] }}>
                    {o}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const showCat = idx === 0 || rows[idx - 1].c.category !== r.c.category
                return (
                  <Fragment key={r.c.id}>
                    {showCat && (
                      <tr>
                        <td colSpan={observers.length + 2} className="px-1 pt-3 pb-1 text-[10px] font-extrabold tracking-wider text-accent uppercase">
                          {r.c.category}
                        </td>
                      </tr>
                    )}
                    <tr className={r.spread >= DIVERGENCE ? 'bg-amber-500/10' : ''}>
                      <td className="sticky left-0 border-t border-line bg-panel px-1 py-1.5" title={r.c.description}>
                        {r.c.label}
                        {r.spread >= DIVERGENCE && <span className="ml-1 text-amber-300">⚠</span>}
                      </td>
                      <td className="border-t border-line px-1.5 text-center font-extrabold text-accent">{f1(r.avg)}</td>
                      {r.perObs.map((v, i) => (
                        <td key={i} className="border-t border-line px-1.5 text-center">
                          {f1(v)}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : rows.length < 3 ? (
        <Empty>Il faut au moins 3 critères notés pour afficher le radar.</Empty>
      ) : (
        <div className="h-80">
          <ResponsiveContainer>
            <RadarChart data={radarData} outerRadius="58%" margin={{ left: 20, right: 20 }}>
              <PolarGrid stroke="#3a3a56" />
              <PolarAngleAxis dataKey="label" tick={{ fill: '#9a9ab8', fontSize: 9 }} />
              <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={false} axisLine={false} />
              {observers.map((o, i) => (
                <Radar key={o} name={o} dataKey={o} stroke={COLORS[i % COLORS.length]} fill="none" strokeWidth={1.2} strokeOpacity={0.8} />
              ))}
              <Radar name="Moyenne" dataKey="Moyenne" stroke="#f43f5e" fill="#f43f5e" fillOpacity={0.25} strokeWidth={2.5} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Détail des avis (avec commentaires) */}
      <div className="flex flex-col gap-2">
        <div className="section-title mt-2">Détail des avis ({evs.length})</div>
        {[...evs]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((e) => {
            const notes = Object.values(e.scores).filter((v) => typeof v === 'number')
            return (
              <div key={e.id} className="rounded-lg border border-line bg-panel-2 p-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[10px] text-muted">
                    <b className="text-white">{e.observer}</b> · {eventLabel(e.eventId)} · {fmtDate(e.date)}
                    {e.minutesObserved ? ` · ${e.minutesObserved} min observées` : ''}
                    <br />
                    {notes.length} critère{notes.length > 1 ? 's' : ''} noté{notes.length > 1 ? 's' : ''}
                    {typeof e.overall === 'number' && <> · note globale <b className="text-white">{e.overall}/5</b></>}
                  </div>
                  {mayDelete(e) && (
                    <button
                      className="shrink-0 px-1 text-muted hover:text-red-400"
                      title="Supprimer cet avis"
                      onClick={async () =>
                        (await ask(`Supprimer l’avis de ${e.observer} (${eventLabel(e.eventId)}, ${fmtDate(e.date)}) ?`, { ok: 'Supprimer' })) &&
                        void remove('evaluations', e.id)
                      }
                    >
                      ✕
                    </button>
                  )}
                </div>
                {e.strengths && (
                  <div>
                    <span className="text-emerald-300">+ </span>
                    {e.strengths}
                  </div>
                )}
                {e.improvements && (
                  <div>
                    <span className="text-amber-300">→ </span>
                    {e.improvements}
                  </div>
                )}
              </div>
            )
          })}
      </div>

      <Link to={evaluateLink} className="btn-ghost mt-1">
        + Donner mon avis
      </Link>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 py-2">
      <div className="text-base font-extrabold">{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  )
}
