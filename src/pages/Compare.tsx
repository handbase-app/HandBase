import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment, lazy, Suspense, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { CLEAR, criterionMean, measureDirection, playerScore, TIE } from '../compare'
import { alive, counts, criterionApplies, db, fmtDate, positionLabel, scaleMax, type Criterion, type Evaluation, type Measurement, type Player } from '../db'
import { snapshots } from '../components/MaturityCard'
import { latestByPlayer } from './Players'
import { Empty, fmtValue, PosBadges, QuarterBadge, playerName } from '../components/ui'

/*
 * Comparaison de deux joueurs (/comparer?a=…&b=…&evenement=…) : en-tête côte à côte, radar superposé,
 * tableau critère par critère (meilleure valeur en vert), points forts, mesures factuelles.
 * Par défaut, les avis de l'événement d'où l'on vient ; « Tous les avis » pour l'historique complet.
 * Comme le classement : avis validés seulement.
 */

// Radar chargé à la demande (recharts).
const CompareRadar = lazy(() => import('../components/CompareRadar'))

// Bleu et orange : bien distincts, y compris pour les daltoniens ; plus foncés sur les thèmes clairs.
const COLORS_DARK: [string, string] = ['#38bdf8', '#fb923c']
const COLORS_LIGHT: [string, string] = ['#0369a1', '#c2410c']
const sideColors = () => (document.documentElement.hasAttribute('data-light') ? COLORS_LIGHT : COLORS_DARK)

type Side = 'a' | 'b'
// Écarts calculés sur les valeurs affichées (au dixième) : « 4,1 » contre « 4,4 » est bien un écart de 0,3.
const r1 = (n: number | null | undefined) => (n == null ? n : Math.round(n * 10) / 10)
const f1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const signed = (n: number, digits = 1, unit?: string) =>
  (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits === 1 ? 1 : 0 }) + (unit ? ` ${unit}` : '')

interface ScoreRow {
  c: Criterion
  v: [number | null, number | null]
  win: Side | null
  gap: number
}
interface MeasureRow {
  c: Criterion
  m: [Measurement | undefined, Measurement | undefined]
  dir: 1 | -1 | 0
  win: Side | null
  gap: number
}

/** Meilleur des deux (null : égalité, valeur manquante ou sens inconnu). */
function winner(va: number | null | undefined, vb: number | null | undefined, threshold: number, dir: 1 | -1 | 0 = 1): { win: Side | null; gap: number } {
  if (va == null || vb == null || dir === 0) return { win: null, gap: 0 }
  const d = (va - vb) * dir
  if (Math.abs(d) < threshold - 1e-9 || Math.abs(va - vb) < 1e-9) return { win: null, gap: 0 }
  return d > 0 ? { win: 'a', gap: va - vb } : { win: 'b', gap: vb - va }
}

export default function Compare() {
  const [params, setParams] = useSearchParams()
  const ids = [params.get('a') ?? '', params.get('b') ?? '']
  const eventId = params.get('evenement') ?? undefined
  const all = !eventId || params.get('tous') === '1'
  const [focus, setFocus] = useState<Side | null>(null)

  const data = useLiveQuery(async () => {
    const players = await db.players.bulkGet(ids)
    const [criteria, evaluations, measurements, event] = await Promise.all([
      db.criteria.orderBy('order').toArray().then(alive),
      db.evaluations.where('playerId').anyOf(ids).toArray().then(alive),
      db.measurements.where('playerId').anyOf(ids).toArray().then(alive),
      eventId ? db.events.get(eventId) : undefined,
    ])
    return { players, criteria, evaluations, measurements, event }
  }, [ids[0], ids[1], eventId])

  const back = <BackButton fallback={eventId ? `/evenements/${eventId}` : '/joueurs'} label={eventId ? 'ÉVÉNEMENT' : 'JOUEURS'} />
  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const [pa, pb] = data.players
  if (!pa || !pb || pa.deleted || pb.deleted || pa.id === pb.id)
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Empty>{pa && pb && pa.id === pb.id ? 'Choisis deux joueurs différents à comparer.' : 'Joueur introuvable : la comparaison ne peut pas s’afficher.'}</Empty>
      </div>
    )
  const ps: [Player, Player] = [pa, pb]
  const { criteria, evaluations, measurements, event } = data
  const colors = sideColors()
  const names = ps.map((p) => p.lastName.toUpperCase()) as [string, string]

  // Avis pris en compte : validés, de l'événement (ou tous).
  const evs = ps.map((p) => evaluations.filter((e) => e.playerId === p.id && counts(e) && (all || e.eventId === eventId))) as [Evaluation[], Evaluation[]]
  const observers = evs.map((l) => new Set(l.map((e) => e.observer)).size)
  const overall = evs.map(playerScore)

  // Critères subjectifs notés (échelle de notes) ; communs aux postes des deux joueurs.
  const subjective = criteria.filter((c) => c.kind === 'subjective' && scaleMax(c.scale) !== null)
  const common = subjective.filter((c) => criterionApplies(c, pa.position) && criterionApplies(c, pb.position))
  const onlyOne = subjective.filter((c) => criterionApplies(c, pa.position) !== criterionApplies(c, pb.position))
  const rows: ScoreRow[] = common
    .map((c) => {
      const v = evs.map((l) => criterionMean(l, c.id)) as [number | null, number | null]
      return { c, v, ...winner(r1(v[0]), r1(v[1]), TIE) }
    })
    .filter((r) => r.v[0] !== null || r.v[1] !== null)
  const ahead = (s: Side) => rows.filter((r) => r.win === s).length
  const strengths = (s: Side) =>
    rows
      .filter((r) => r.win === s && r.gap >= CLEAR)
      .sort((x, y) => y.gap - x.gap)
      .slice(0, 5)
  const radarData = rows
    .filter((r) => r.c.scale === 'score5' && r.v[0] !== null && r.v[1] !== null)
    .map((r) => ({ label: r.c.label, a: r.v[0]!, b: r.v[1]! }))
  const overallWin = winner(r1(overall[0]?.avg), r1(overall[1]?.avg), TIE)

  // Mesures : dernière valeur de chaque critère factuel chiffré.
  const latest = latestByPlayer(measurements)
  const measureRows: MeasureRow[] = criteria
    .filter((c) => c.kind === 'factual' && c.scale !== 'text' && c.scale !== 'choice')
    .map((c) => {
      const m = ps.map((p) => {
        const x = latest.get(p.id)?.get(c.id)
        return x && typeof x.value === 'number' ? x : undefined
      }) as [Measurement | undefined, Measurement | undefined]
      const dir = measureDirection(c)
      return { c, m, dir, ...winner(m[0]?.value as number | undefined, m[1]?.value as number | undefined, 0, dir) }
    })
    .filter((r) => r.m[0] || r.m[1])

  const samePos = pa.position && pa.position === pb.position
  const toggleAll = () => {
    const next = new URLSearchParams(params)
    if (all) next.delete('tous')
    else next.set('tous', '1')
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      {back}
      <h1 className="-mt-2 text-lg font-extrabold">Comparer deux joueurs</h1>

      {/* Source des notes */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 p-2.5 text-[11px]">
        <span className="min-w-0 text-muted">
          {all ? (
            <>
              Avis validés de <b className="text-fg">tous les contextes</b>
              {event ? ` (pas seulement ${event.name})` : ''}
            </>
          ) : (
            <>
              Avis validés de <b className="text-fg">{event?.name ?? 'l’événement'}</b>
              {event?.date ? ` (${fmtDate(event.date)})` : ''}
            </>
          )}
        </span>
        {eventId && (
          <button role="switch" aria-checked={all} onClick={toggleAll} className="flex shrink-0 items-center gap-2 font-bold">
            <span className={`relative h-5 w-9 rounded-full transition ${all ? 'bg-accent' : 'bg-line'}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${all ? 'left-4.5' : 'left-0.5'}`} />
            </span>
            Tous les avis
          </button>
        )}
      </div>

      {/* En-tête : les deux joueurs côte à côte */}
      <div className="grid grid-cols-2 gap-2">
        {ps.map((p, i) => (
          <PlayerHead key={p.id} p={p} color={colors[i]} evs={evs[i].length} observers={observers[i]} ms={measurements.filter((m) => m.playerId === p.id)} />
        ))}
      </div>

      {!samePos && onlyOne.length > 0 && (
        <p className="rounded-md border border-line bg-panel-2 p-2.5 text-[11px] text-muted">
          Postes différents ({positionLabel(pa.position)} / {positionLabel(pb.position)}) : seuls les critères communs aux deux postes sont comparés ;{' '}
          {onlyOne.length} critère{onlyOne.length > 1 ? 's' : ''} propre{onlyOne.length > 1 ? 's' : ''} à un seul poste {onlyOne.length > 1 ? 'sont écartés' : 'est écarté'}.
        </p>
      )}

      <div className="flex flex-col gap-4 wide:grid wide:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] wide:items-start">
        <div className="flex flex-col gap-4 side:sticky side:top-[calc(var(--hdr)+1.25rem)]">
          {/* Radar superposé */}
          <section className="card p-3">
            <div className="section-title">Radar des avis</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Mettre un joueur en avant">
              {ps.map((p, i) => {
                const s: Side = i ? 'b' : 'a'
                return (
                  <button
                    key={p.id}
                    onClick={() => setFocus((f) => (f === s ? null : s))}
                    aria-pressed={focus === s}
                    title={focus === s ? 'Revoir les deux joueurs' : 'Mettre ce joueur en avant'}
                    className={`flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${focus === s ? 'border-fg/40 bg-panel-2' : 'border-line'} ${focus && focus !== s ? 'opacity-45' : ''}`}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[i] }} />
                    <span className="truncate">{playerName(p)}</span>
                  </button>
                )
              })}
            </div>
            {radarData.length < 3 ? (
              <p className="py-8 text-center text-[11px] text-muted">
                Il faut au moins 3 critères notés pour les deux joueurs pour tracer le radar
                {radarData.length ? ` (${radarData.length} pour l’instant)` : ''}.
              </p>
            ) : (
              <>
                <Suspense fallback={<div className="h-72 py-10 text-center text-xs text-muted">Chargement du radar…</div>}>
                  <CompareRadar data={radarData} colors={colors} focus={focus} />
                </Suspense>
                <p className="text-[10px] text-muted">Critères notés pour les deux joueurs ({radarData.length}). Toucher un nom le met en avant.</p>
              </>
            )}
          </section>

          {/* Points forts */}
          {rows.some((r) => r.v[0] !== null && r.v[1] !== null) && (
            <section className="grid grid-cols-2 gap-2">
              {ps.map((p, i) => {
                const list = strengths(i ? 'b' : 'a')
                return (
                  <div key={p.id} className="rounded-lg border border-line bg-panel p-2.5" style={{ borderTopColor: colors[i], borderTopWidth: 3 }}>
                    <div className="mb-1 truncate text-[10px] font-extrabold tracking-wider uppercase" style={{ color: colors[i] }}>
                      Points forts · {names[i]}
                    </div>
                    {list.length ? (
                      <ul className="flex flex-col gap-0.5 text-[11px]">
                        {list.map((r) => (
                          <li key={r.c.id} className="flex justify-between gap-1">
                            <span className="min-w-0">{r.c.label}</span>
                            <b className="shrink-0 text-emerald-300">{signed(r.gap)}</b>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-muted">Aucun critère avec une avance nette.</p>
                    )}
                  </div>
                )
              })}
              <p className="col-span-2 text-[10px] text-muted">Avance d’au moins {f1(CLEAR)} point.</p>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {/* Tableau des avis */}
          <section className="card p-3">
            <div className="section-title">Avis critère par critère</div>
            {rows.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-muted">
                Aucun avis validé {all ? '' : 'sur cet événement '}pour ces deux joueurs
                {!all ? (
                  <>
                    .{' '}
                    <button className="font-bold text-accent" onClick={toggleAll}>
                      Voir tous les avis
                    </button>
                  </>
                ) : (
                  '.'
                )}
              </p>
            ) : (
              <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
                <thead>
                  <HeadRow names={names} colors={colors} label="Critère" />
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <Fragment key={r.c.id}>
                      {(idx === 0 || rows[idx - 1].c.category !== r.c.category) && <CatRow label={r.c.category} />}
                      <tr>
                        <td className="border-t border-line py-1.5 pr-1" title={r.c.description}>
                          {r.c.label}
                        </td>
                        {r.v.map((v, i) => (
                          <ValueCell key={i} best={r.win === (i ? 'b' : 'a')} gap={signed(r.gap)}>
                            {v === null ? '—' : f1(v)}
                          </ValueCell>
                        ))}
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="border-t-2 border-line py-2 pr-1 font-bold">Moyenne générale</td>
                    {overall.map((o, i) => (
                      <ValueCell key={i} best={overallWin.win === (i ? 'b' : 'a')} gap={signed(overallWin.gap)} top>
                        {o ? `${f1(o.avg)}/5` : '—'}
                      </ValueCell>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-1 text-muted">Critères où il est devant</td>
                    {(['a', 'b'] as const).map((s, i) => (
                      <td key={s} className={`py-1.5 text-center ${ahead(s) > ahead(i ? 'a' : 'b') ? 'font-extrabold' : 'text-muted'}`}>
                        {ahead(s)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            )}
            <p className="mt-2 text-[10px] text-muted">
              Moyenne de chaque critère : chaque observateur pèse pareil. En <b className="text-emerald-300">vert</b>, le meilleur des deux et son avance ; écart sous{' '}
              {f1(TIE)} : égalité. Moyenne générale calculée comme le classement.
            </p>
          </section>

          {/* Mesures factuelles */}
          <section className="card p-3">
            <div className="section-title">Mesures (dernières valeurs)</div>
            {measureRows.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-muted">Aucune mesure enregistrée pour ces deux joueurs.</p>
            ) : (
              <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
                <thead>
                  <HeadRow names={names} colors={colors} label="Mesure" />
                </thead>
                <tbody>
                  {measureRows.map((r, idx) => (
                    <Fragment key={r.c.id}>
                      {(idx === 0 || measureRows[idx - 1].c.category !== r.c.category) && <CatRow label={r.c.category} />}
                      <tr>
                        <td className="border-t border-line py-1.5 pr-1" title={r.c.description}>
                          {r.c.label}
                          {r.dir !== 0 && <span className="ml-1 text-[9px] text-muted">{r.dir < 0 ? '↓ mieux' : '↑ mieux'}</span>}
                        </td>
                        {r.m.map((m, i) => (
                          <ValueCell
                            key={i}
                            best={r.win === (i ? 'b' : 'a')}
                            gap={signed(r.gap, 2, scaleMax(r.c.scale) === null ? r.c.unit : undefined)}
                            sub={m ? fmtDate(m.date) : undefined}
                            stack
                          >
                            {m ? fmtValue(r.c, m.value) : '—'}
                          </ValueCell>
                        ))}
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-[10px] text-muted">
              ↓ mieux : plus petit est meilleur (temps de course) ; ↑ mieux : plus grand est meilleur. Sans flèche (gabarit, mensurations…), pas de meilleur : rien en
              vert.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

/** Carte d'un joueur dans l'en-tête, avec sa couleur. */
function PlayerHead({ p, color, evs, observers, ms }: { p: Player; color: string; evs: number; observers: number; ms: Measurement[] }) {
  const snaps = snapshots(p, ms)
  const kr = snaps[snaps.length - 1]?.kr
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-panel p-2.5" style={{ borderTopColor: color, borderTopWidth: 4 }}>
      <Link to={`/joueurs/${p.id}`} className="text-sm leading-tight font-extrabold break-words hover:underline" style={{ color }}>
        {p.lastName.toUpperCase()} <span className="font-bold">{p.firstName}</span>
      </Link>
      <div className="flex flex-wrap items-center gap-1">
        <PosBadges p={p} />
        <QuarterBadge birthDate={p.birthDate} />
        {p.birthDate && <span className="text-[11px] text-muted">{p.birthDate.slice(0, 4)}</span>}
      </div>
      {p.club && <div className="truncate text-[11px] text-muted">{p.club}</div>}
      <div className="text-[11px]">
        {evs ? (
          <>
            <b>{evs}</b> avis · <b>{observers}</b> observateur{observers > 1 ? 's' : ''}
          </>
        ) : (
          <span className="text-muted">Aucun avis validé</span>
        )}
      </div>
      {kr && (
        <div className="text-[10px] text-muted" title="Khamis-Roche : estimation, pas une certitude">
          Taille adulte prédite ≈ <b className="text-fg">{Math.round(kr.predicted)} cm</b> · {Math.round(kr.pah)} % atteint
        </div>
      )}
    </div>
  )
}

function HeadRow({ names, colors, label }: { names: [string, string]; colors: [string, string]; label: string }) {
  return (
    <tr className="text-[10px]">
      <th className="py-1 text-left font-bold text-muted">{label}</th>
      {names.map((n, i) => (
        <th key={i} className="w-[28%] truncate px-1 py-1 text-center font-extrabold" style={{ color: colors[i] }} title={n}>
          {n}
        </th>
      ))}
    </tr>
  )
}

function CatRow({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={3} className="pt-3 pb-1 text-[10px] font-extrabold tracking-wider text-accent uppercase">
        {label}
      </td>
    </tr>
  )
}

/** Valeur d'un joueur : en vert gras avec son avance si c'est la meilleure. */
function ValueCell({ best, gap, sub, top, stack, children }: { best: boolean; gap: string; sub?: string; top?: boolean; stack?: boolean; children: ReactNode }) {
  return (
    <td className={`${top ? 'border-t-2' : 'border-t'} border-line px-1 py-1.5 text-center`}>
      <span className={`whitespace-nowrap ${best ? 'font-extrabold text-emerald-300' : ''}`}>{children}</span>
      {best && <span className={`text-[10px] font-bold text-emerald-300 ${stack ? 'block' : 'ml-1'}`}>{gap}</span>}
      {sub && <div className="text-[9px] text-muted">{sub}</div>}
    </td>
  )
}
