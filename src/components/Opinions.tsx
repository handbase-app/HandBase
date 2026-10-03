import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { contextLabel, counts, fmtDate, remove, reviewOf, type Criterion, type Evaluation, type HBEvent, type Player } from '../db'
import { can, currentUserId, useRole, type Role } from '../roles'
import { ask } from './Confirm'
import { department } from './PlayerFilter'
import { ReviewActions, ReviewBadge, ReviewNote } from './Review'
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
 * Seuls les avis validés comptent ; les avis spontanés en attente peuvent être inclus à la demande,
 * les avis hors cadre jamais (ils restent consultables à part).
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
  const [withPending, setWithPending] = useState(false)

  const inPeriod = (e: Evaluation) => eventId === 'all' || (e.eventId ?? 'none') === eventId
  const pending = evaluations.filter((e) => reviewOf(e) === 'pending')
  const refused = evaluations.filter((e) => reviewOf(e) === 'refused')
  // Avis pris en compte dans les chiffres, et avis listés dans le détail (validés + en attente).
  const evs = evaluations.filter((e) => inPeriod(e) && (counts(e) || (withPending && reviewOf(e) === 'pending')))
  const listed = evaluations.filter((e) => inPeriod(e) && reviewOf(e) !== 'refused')
  const usedEvents = events.filter((ev) => evaluations.some((e) => e.eventId === ev.id))
  const eventLabel = (e: Evaluation) => {
    if (!e.eventId) return contextLabel(e)
    const ev = events.find((x) => x.id === e.eventId)
    if (!ev) return 'Événement inconnu'
    return ev.deleted ? `Événement supprimé : ${ev.name}` : ev.name
  }
  const role = useRole()
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
          {evaluations.some((e) => !e.eventId) && <option value="none">Avis spontanés / hors événement</option>}
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

      {pending.length > 0 && (
        <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
          <input type="checkbox" className="mt-0.5" checked={withPending} onChange={(e) => setWithPending(e.target.checked)} />
          <span>
            {pending.length} avis spontané{pending.length > 1 ? 's' : ''} en attente de validation
            {withPending ? ' : inclus dans les chiffres ci-dessous.' : ' : ne compte' + (pending.length > 1 ? 'nt' : '') + ' pas dans les chiffres. Cocher pour les inclure.'}
          </span>
        </label>
      )}

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
        <div className="section-title mt-2">Détail des avis ({listed.length})</div>
        {[...listed]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((e) => (
            <AvisCard key={e.id} e={e} where={eventLabel(e)} role={role} dept={department(player)} />
          ))}
      </div>

      {refused.length > 0 && (
        <details className="rounded-lg border border-line p-2.5">
          <summary className="cursor-pointer text-xs font-bold text-muted">
            Avis hors cadre ({refused.length}) : gardés pour mémoire, jamais comptés
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {[...refused]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((e) => (
                <AvisCard key={e.id} e={e} where={eventLabel(e)} role={role} dept={department(player)} />
              ))}
          </div>
        </details>
      )}

      <Link to={evaluateLink} className="btn-ghost mt-1">
        + Donner mon avis
      </Link>
    </div>
  )
}

/** Un avis, avec son état de validation et, selon les droits, les actions possibles. */
export function AvisCard({ e, where, role, player, dept }: { e: Evaluation; where: string; role: Role; player?: Player; dept?: string }) {
  const mine = !!e.observerId && e.observerId === currentUserId()
  const mayDelete = role === 'admin' || mine
  const notes = Object.values(e.scores).filter((v) => typeof v === 'number')
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] text-muted">
          {player && (
            <>
              <Link to={`/joueurs/${player.id}`} className="text-sm font-bold text-white">
                {player.firstName} {player.lastName}
              </Link>
              <br />
            </>
          )}
          <b className="text-white">{e.observer}</b> · {where} · {fmtDate(e.date)}
          {e.minutesObserved ? ` · ${e.minutesObserved} min observées` : ''}
          <br />
          {notes.length} critère{notes.length > 1 ? 's' : ''} noté{notes.length > 1 ? 's' : ''}
          {typeof e.overall === 'number' && <> · note globale <b className="text-white">{e.overall}/5</b></>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ReviewBadge e={e} />
          {mine && e.contextType && (
            <Link to={`/evaluer?contexte=libre&joueur=${e.playerId}&avis=${e.id}`} className="px-1 text-muted hover:text-white" title="Modifier cet avis">
              ✎
            </Link>
          )}
          {mayDelete && (
            <button
              className="px-1 text-muted hover:text-red-400"
              title="Supprimer cet avis"
              onClick={async () =>
                (await ask(`Supprimer l’avis de ${e.observer} (${where}, ${fmtDate(e.date)}) ?`, { ok: 'Supprimer' })) && void remove('evaluations', e.id)
              }
            >
              ✕
            </button>
          )}
        </div>
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
      <ReviewNote e={e} />
      {/* Les avis spontanés d'un validateur sont validés d'office : on ne se valide pas soi-même. */}
      {/* Décision : dans son secteur seulement (département du joueur). */}
      {e.review && !mine && can.reviewDept(role, dept) && <ReviewActions e={e} compact={!player} />}
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
