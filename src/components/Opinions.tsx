import { Fragment, lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { contextLabel, counts, criterionApplies, fmtDate, remove, reviewOf, scaleMax, type Criterion, type Evaluation, type HBEvent, type Player } from '../db'
import { can, currentUserId, useRole, type Role } from '../roles'
import { ask } from './Confirm'
import { department } from './PlayerFilter'
import { ReviewActions, ReviewBadge, ReviewNote } from './Review'
import { Empty, Icon, playerName } from './ui'

// Une couleur par observateur ; plus foncées sur les thèmes clairs.
const COLORS_DARK = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb923c', '#f472b6', '#22d3ee', '#a3e635']
const COLORS_LIGHT = ['#0369a1', '#6d28d9', '#047857', '#b45309', '#c2410c', '#be185d', '#0e7490', '#4d7c0f']
// Radar chargé à la demande (recharts).
const OpinionsRadar = lazy(() => import('./OpinionsRadar'))
const obsColor = (i: number) => {
  const list = document.documentElement.hasAttribute('data-light') ? COLORS_LIGHT : COLORS_DARK
  return list[i % list.length]
}
/** Écart (max − min) à partir duquel les avis sont considérés divergents. */
export const DIVERGENCE = 2

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const f1 = (n: number | null) => (n === null ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: 1 }))
const f1n = (n: number | null) => (n === null ? null : f1(n))

/** Une ligne du tableau : valeur par observateur (déjà formatée) et synthèse (moyenne ou répartition). */
interface Row {
  c: Criterion
  perObs: (string | null)[]
  summary: string
  /** Moyenne et notes par observateur (absentes pour un choix ou un texte). */
  avg?: number | null
  nums?: (number | null)[]
  n: number
  divergent: boolean
}

/**
 * Compare et cumule les avis subjectifs sur un joueur.
 * Si un observateur a donné plusieurs avis dans la période, on prend sa moyenne
 * pour qu'il ne pèse pas plus que les autres.
 * Seuls les avis validés comptent ; les avis spontanés en attente peuvent être inclus à la demande,
 * les avis hors cadre jamais (ils restent consultables à part).
 * `lockedEventId` : vue d'un seul événement (page de l'événement), sans sélecteur, radar d'abord, en compact ;
 * `scoreCriteria` : détaille alors les notes de chaque avis.
 */
export function Opinions({
  player,
  criteria,
  evaluations,
  events,
  lockedEventId,
  scoreCriteria,
}: {
  player: Player
  criteria: Criterion[]
  evaluations: Evaluation[]
  events: HBEvent[]
  lockedEventId?: string
  scoreCriteria?: Criterion[]
}) {
  const locked = lockedEventId !== undefined
  const [chosenEventId, setEventId] = useState<string>('all')
  const eventId = lockedEventId ?? chosenEventId
  const [chosenView, setView] = useState<'table' | 'radar'>(locked ? 'radar' : 'table')
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
      .map((c): Row => {
        const byObs = observers.map((o) => evs.filter((e) => e.observer === o).map((e) => e.scores[c.id]))
        if (c.scale === 'choice' || c.scale === 'text') {
          // Choix / texte : la réponse de chaque observateur, et la répartition à la place de la moyenne.
          const perObs = byObs.map((vs) => {
            const t = [...new Set(vs.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))]
            return t.length ? t.join(' / ') : null
          })
          const counts = new Map<string, number>()
          for (const v of perObs) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
          const n = perObs.filter(Boolean).length
          const summary = c.scale === 'choice' ? [...counts].sort((a, b) => b[1] - a[1]).map(([v, k]) => (counts.size > 1 ? `${v} ${k}` : v)).join(' · ') : '—'
          return { c, perObs, summary, n, divergent: c.scale === 'choice' && counts.size > 1 }
        }
        const perObs = byObs.map((vs) => mean(vs.filter((x): x is number => typeof x === 'number')))
        const vals = perObs.filter((x): x is number => x !== null)
        const avg = mean(vals)
        const spread = vals.length > 1 ? Math.max(...vals) - Math.min(...vals) : 0
        return { c, perObs: perObs.map(f1n), nums: perObs, summary: f1(avg), avg, n: vals.length, divergent: spread >= DIVERGENCE }
      })
      .filter((r) => r.n > 0)
  }, [criteria, evs, observers])
  const numericRows = rows.filter((r) => r.nums)
  // Sur l'événement, radar d'abord… s'il y a de quoi le tracer.
  const view = locked && chosenView === 'radar' && numericRows.length < 3 ? 'table' : chosenView

  const overall = mean(
    observers.map((o) => mean(evs.filter((e) => e.observer === o && typeof e.overall === 'number').map((e) => e.overall!))).filter((x): x is number => x !== null),
  )

  // Donner un avis : sur l'événement filtré, sinon avis spontané (il n'y a plus d'onglet Évaluer).
  const evaluateLink = eventId !== 'all' && eventId !== 'none' ? `/evaluer?joueur=${player.id}&evenement=${eventId}` : `/evaluer?contexte=libre&joueur=${player.id}`

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

  const radarData = numericRows.map((r) => ({
    label: r.c.label,
    Moyenne: r.avg,
    ...Object.fromEntries(observers.map((o, i) => [o, r.nums![i]])),
  }))

  const divergent = rows.filter((r) => r.divergent)

  return (
    <div className="flex flex-col gap-3">
      <div className={`flex gap-2 ${locked ? 'items-center justify-between' : ''}`}>
        {/* Sur l'événement, la synthèse tient sur une ligne. */}
        {locked && (
          <div className="text-[11px] text-muted">
            <b className="text-fg">{evs.length}</b> avis · <b className="text-fg">{observers.length}</b> obs.
            {overall !== null && (
              <>
                {' '}
                · note globale <b className="text-fg">{f1(overall)}/5</b>
              </>
            )}
          </div>
        )}
        {!locked && (
          <select className="field flex-1" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="all">Tous les avis (cumul)</option>
            {usedEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.deleted ? `(supprimé) ${ev.name}` : ev.name} · {fmtDate(ev.date)}
              </option>
            ))}
            {evaluations.some((e) => !e.eventId) && <option value="none">Avis spontanés / hors événement</option>}
          </select>
        )}
        <div className="flex shrink-0 overflow-hidden rounded-md border border-line">
          {(['table', 'radar'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 ${locked ? 'py-1' : ''} text-xs font-bold ${view === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
              {v === 'table' ? 'Tableau' : 'Radar'}
            </button>
          ))}
        </div>
      </div>

      {!locked && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Avis" value={String(evs.length)} />
          <Stat label="Observateurs" value={String(observers.length)} />
          <Stat label="Note globale" value={overall === null ? '—' : `${f1(overall)}/5`} />
        </div>
      )}

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
          <Icon name="alert" className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />Avis divergents sur : <b>{divergent.map((r) => r.c.label).join(', ')}</b> — à discuter en staff.
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
                  <th key={o} className="px-1.5 py-1.5 font-bold whitespace-nowrap" style={{ color: obsColor(i) }}>
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
                    <tr className={r.divergent ? 'bg-amber-500/10' : ''}>
                      <td className="sticky left-0 border-t border-line bg-panel px-1 py-1.5" title={r.c.description}>
                        {r.c.label}
                        {r.divergent && <Icon name="alert" className="ml-1 inline h-3.5 w-3.5 -translate-y-px text-amber-300" />}
                      </td>
                      <td className="border-t border-line px-1.5 text-center font-extrabold whitespace-nowrap text-accent">{r.summary}</td>
                      {r.perObs.map((v, i) => (
                        <td key={i} className={`border-t border-line px-1.5 text-center ${r.c.scale === 'text' ? 'min-w-32 text-left text-[11px]' : ''}`}>
                          {v ?? '—'}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : numericRows.length < 3 ? (
        <Empty>Il faut au moins 3 critères notés pour afficher le radar.</Empty>
      ) : (
        <Suspense fallback={<div className={`${locked ? 'h-64' : 'h-80'} py-10 text-center text-xs text-muted`}>Chargement du radar…</div>}>
          <OpinionsRadar data={radarData} observers={observers} colors={observers.map((_, i) => obsColor(i))} compact={locked} />
        </Suspense>
      )}

      {/* Détail des avis (avec commentaires) */}
      <div className="flex flex-col gap-2">
        <div className="section-title mt-2">Détail des avis ({listed.length})</div>
        {[...listed]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((e) => (
            <AvisCard
              key={e.id}
              e={e}
              where={locked ? undefined : eventLabel(e)}
              role={role}
              dept={department(player)}
              event={events.find((x) => x.id === e.eventId)}
              criteria={scoreCriteria}
            />
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
                <AvisCard
                  key={e.id}
                  e={e}
                  where={locked ? undefined : eventLabel(e)}
                  role={role}
                  dept={department(player)}
                  event={events.find((x) => x.id === e.eventId)}
                  criteria={scoreCriteria}
                />
              ))}
          </div>
        </details>
      )}

      <Link to={evaluateLink} className={`btn-ghost mt-1 ${locked ? 'py-1.5 text-xs' : ''}`}>
        + Donner mon avis
      </Link>
    </div>
  )
}

/**
 * Un avis, avec son état de validation et, selon les droits, les actions possibles.
 * Avec `criteria`, la note de chaque critère est détaillée (sinon : seulement leur nombre).
 */
export function AvisCard({
  e,
  where,
  role,
  player,
  dept,
  event,
  criteria,
}: {
  e: Evaluation
  where?: string
  role: Role
  player?: Player
  dept?: string
  event?: HBEvent
  criteria?: Criterion[]
}) {
  const mine = !!e.observerId && e.observerId === currentUserId()
  const mayDelete = role === 'admin' || mine
  const notes = Object.values(e.scores).filter((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== ''))
  return (
    <div className="rounded-lg border border-line bg-panel-2 p-2.5 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="text-[10px] text-muted">
          {player && (
            <>
              <Link to={`/joueurs/${player.id}`} className="text-sm font-bold text-fg">
                {playerName(player)}
              </Link>
              <br />
            </>
          )}
          <b className="text-fg">{e.observer}</b>
          {where && <> · {where}</>} · {fmtDate(e.date)}
          {e.minutesObserved ? ` · ${e.minutesObserved} min observées` : ''}
          <br />
          {notes.length} critère{notes.length > 1 ? 's' : ''} noté{notes.length > 1 ? 's' : ''}
          {typeof e.overall === 'number' && <> · note globale <b className="text-fg">{e.overall}/5</b></>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ReviewBadge e={e} />
          {mine && e.contextType && (
            <Link to={`/evaluer?contexte=libre&joueur=${e.playerId}&avis=${e.id}`} className="px-1 text-muted hover:text-fg" title="Modifier cet avis">
              ✎
            </Link>
          )}
          {mayDelete && (
            <button
              className="px-1 text-muted hover:text-red-400"
              title="Supprimer cet avis"
              onClick={async () =>
                (await ask(`Supprimer l’avis de ${e.observer} (${[where, fmtDate(e.date)].filter(Boolean).join(', ')}) ?`, { ok: 'Supprimer' })) && void remove('evaluations', e.id)
              }
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {criteria && <ScoreChips e={e} criteria={criteria} />}
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
      {e.review && !mine && can.reviewAvis(role, dept, event) && <ReviewActions e={e} compact={!player} />}
    </div>
  )
}

/** Notes d'un avis, critère par critère (libellés et ordre de db.criteria) : pastilles, textes à la ligne. */
function ScoreChips({ e, criteria }: { e: Evaluation; criteria: Criterion[] }) {
  const known = new Set(criteria.map((c) => c.id))
  // Critères connus dans leur ordre, puis ceux qui ne le sont plus (supprimés depuis) sous leur identifiant.
  const list = [
    ...criteria.filter((c) => c.id in e.scores),
    ...Object.keys(e.scores)
      .filter((id) => !known.has(id))
      .map((id) => ({ id, label: id, scale: 'score5' }) as Criterion),
  ].filter((c) => {
    const v = e.scores[c.id]
    return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')
  })
  if (!list.length) return null
  const texts = list.filter((c) => c.scale === 'text')
  const chips = list.filter((c) => c.scale !== 'text')
  return (
    <div className="my-1.5 flex flex-col gap-1">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => {
            const v = e.scores[c.id]
            const max = scaleMax(c.scale)
            return (
              <span key={c.id} className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] text-muted" title={c.description}>
                {c.label}{' '}
                <b className="text-fg">
                  {typeof v === 'number' ? v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : v}
                  {typeof v === 'number' && max ? `/${max}` : c.unit ? ` ${c.unit}` : ''}
                </b>
              </span>
            )
          })}
        </div>
      )}
      {texts.map((c) => (
        <div key={c.id} className="text-[11px]">
          <span className="text-muted">{c.label} : </span>
          {e.scores[c.id]}
        </div>
      ))}
    </div>
  )
}

/**
 * Avis d'un joueur sur un événement, dépliés sous sa ligne (liste, hors liste, classement) : la vue Avis de la
 * fiche (tableau / radar, détail, validation), verrouillée sur l'événement. Mêmes avis visibles que la fiche
 * (tous ceux présents sur l'appareil) ; en tête, la note de chaque évaluateur pour comprendre un « avis très partagés ».
 */
export function EventAvis({ player, evals, criteria, event }: { player: Player; evals: Evaluation[]; criteria: Criterion[]; event: HBEvent }) {
  const list = evals.filter((e) => e.playerId === player.id)
  // Mêmes critères que l'onglet Avis de la fiche : subjectifs, du poste du joueur.
  const subjective = criteria.filter((c) => c.kind === 'subjective' && criterionApplies(c, player.position))
  // Note de chaque évaluateur (avis validés seulement, comme le classement) : note globale, sinon moyenne de ses critères.
  const perObs = new Map<string, number[]>()
  for (const e of list.filter(counts)) {
    const crit = Object.values(e.scores).filter((v): v is number => typeof v === 'number')
    const v = typeof e.overall === 'number' ? e.overall : mean(crit)
    if (v === null) continue
    perObs.set(e.observer, [...(perObs.get(e.observer) ?? []), v])
  }
  const notes = [...perObs].map(([o, vs]) => [o, mean(vs)!] as const).sort((a, b) => b[1] - a[1])
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-panel p-2.5">
      <div className="flex items-start justify-between gap-2 text-[10px] text-muted">
        <span>
          {notes.length > 0 && (
            <>
              Note par évaluateur :{' '}
              {notes.map(([o, v], i) => (
                <Fragment key={o}>
                  {i > 0 && ' · '}
                  {o} <b className="text-fg">{f1(v)}</b>
                </Fragment>
              ))}
            </>
          )}
        </span>
        <Link to={`/joueurs/${player.id}?onglet=avis`} className="shrink-0 text-[11px] font-bold text-accent">
          Voir la fiche →
        </Link>
      </div>
      <Opinions player={player} criteria={subjective} evaluations={list} events={[event]} lockedEventId={event.id} scoreCriteria={criteria} />
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
