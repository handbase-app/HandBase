import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment, lazy, Suspense, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { COMPARE_MAX } from '../components/ComparePick'
import { CLEAR, criterionMean, measureDirection, playerScore, TIE } from '../compare'
import { alive, counts, criterionApplies, db, fmtDate, positionLabel, scaleMax, type Criterion, type Evaluation, type Measurement, type Player } from '../db'
import { snapshots } from '../components/MaturityCard'
import { latestByPlayer } from './Players'
import { Empty, fmtValue, PosBadges, QuarterBadge, playerName } from '../components/ui'

/*
 * Comparaison de deux ou trois joueurs (/comparer?a=…&b=…&c=…&evenement=…) : en-tête côte à côte, radar superposé,
 * tableau critère par critère (meilleure valeur en vert), points forts, mesures factuelles.
 * Par défaut, les avis de l'événement d'où l'on vient ; « Tous les avis » pour l'historique complet.
 * Comme le classement : avis validés seulement.
 */

// Radar par zones, chargé à la demande.
const CompareRadar = lazy(() => import('../components/CompareRadar'))

// Bleu, orange, violet (comme la palette des avis) : bien distincts, y compris pour les daltoniens, et
// loin du vert des meilleures valeurs ; plus foncés sur les thèmes clairs.
const COLORS_DARK = ['#38bdf8', '#fb923c', '#a78bfa']
const COLORS_LIGHT = ['#0369a1', '#c2410c', '#6d28d9']
const sideColors = () => (document.documentElement.hasAttribute('data-light') ? COLORS_LIGHT : COLORS_DARK)
const KEYS = ['a', 'b', 'c'] as const
// Écarts calculés sur les valeurs affichées (au dixième) : « 4,1 » contre « 4,4 » est bien un écart de 0,3.
const r1 = (n: number | null | undefined) => (n == null ? n : Math.round(n * 10) / 10)
const f1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const signed = (n: number, digits = 1, unit?: string) =>
  (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: digits === 1 ? 1 : 0 }) + (unit ? ` ${unit}` : '')

// Une case par joueur comparé, dans l'ordre de l'adresse (a, b, c).
interface ScoreRow {
  c: Criterion
  v: (number | null)[]
  win: number | null
  gap: number
}
interface MeasureRow {
  c: Criterion
  m: (Measurement | undefined)[]
  dir: 1 | -1 | 0
  win: number | null
  gap: number
}

/**
 * Indice du meilleur joueur et son avance sur le deuxième (valeur du meilleur moins celle du deuxième).
 * null : moins de deux valeurs, sens inconnu, ou deuxième à moins de `threshold` (égalité en tête).
 * Les valeurs absentes sont ignorées. À deux joueurs : même règle qu'avant.
 */
function winner(vals: (number | null | undefined)[], threshold: number, dir: 1 | -1 | 0 = 1): { win: number | null; gap: number } {
  const none = { win: null, gap: 0 }
  if (dir === 0) return none
  const present = vals.flatMap((v, i) => (v == null ? [] : [{ v, i }])).sort((x, y) => (y.v - x.v) * dir)
  if (present.length < 2) return none
  const [best, second] = present
  if (Math.abs(best.v - second.v) < threshold - 1e-9 || Math.abs(best.v - second.v) < 1e-9) return none
  return { win: best.i, gap: best.v - second.v }
}

export default function Compare() {
  const [params, setParams] = useSearchParams()
  // a et b (anciens liens), c en plus pour un troisième joueur.
  const ids = KEYS.slice(0, COMPARE_MAX)
    .map((k) => params.get(k) ?? '')
    .filter((id, i) => id || i < 2)
  const eventId = params.get('evenement') ?? undefined
  const all = !eventId || params.get('tous') === '1'
  const [focus, setFocus] = useState<number | null>(null)

  const data = useLiveQuery(async () => {
    const players = await db.players.bulkGet(ids)
    const [criteria, evaluations, measurements, event] = await Promise.all([
      db.criteria.orderBy('order').toArray().then(alive),
      db.evaluations.where('playerId').anyOf(ids).toArray().then(alive),
      db.measurements.where('playerId').anyOf(ids).toArray().then(alive),
      eventId ? db.events.get(eventId) : undefined,
    ])
    return { players, criteria, evaluations, measurements, event }
  }, [ids.join(','), eventId])

  const back = <BackButton fallback={eventId ? `/evenements/${eventId}` : '/joueurs'} label={eventId ? 'ÉVÉNEMENT' : 'JOUEURS'} />
  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const found = data.players.filter((p): p is Player => !!p && !p.deleted)
  if (found.length < data.players.length || new Set(ids).size < ids.length)
    return (
      <div className="flex flex-col gap-4">
        {back}
        <Empty>{found.length === data.players.length ? 'Choisis des joueurs différents à comparer.' : 'Joueur introuvable : la comparaison ne peut pas s’afficher.'}</Empty>
      </div>
    )
  const ps = found
  const n = ps.length
  const nWord = n === 2 ? 'deux' : 'trois'
  const { criteria, evaluations, measurements, event } = data
  const colors = sideColors().slice(0, n)
  const names = ps.map((p) => p.lastName.toUpperCase())

  // Avis pris en compte : validés, de l'événement (ou tous).
  const evs: Evaluation[][] = ps.map((p) => evaluations.filter((e) => e.playerId === p.id && counts(e) && (all || e.eventId === eventId)))
  const observers = evs.map((l) => new Set(l.map((e) => e.observer)).size)
  const overall = evs.map(playerScore)

  // Critères subjectifs notés (échelle de notes) ; communs aux postes de tous les joueurs.
  const subjective = criteria.filter((c) => c.kind === 'subjective' && scaleMax(c.scale) !== null)
  const applies = (c: Criterion) => ps.map((p) => criterionApplies(c, p.position))
  const common = subjective.filter((c) => applies(c).every(Boolean))
  const onlyOne = subjective.filter((c) => applies(c).some(Boolean) && !applies(c).every(Boolean))
  const rows: ScoreRow[] = common
    .map((c) => {
      const v = evs.map((l) => criterionMean(l, c.id))
      return { c, v, ...winner(v.map(r1), TIE) }
    })
    .filter((r) => r.v.some((x) => x !== null))
  const ahead = (i: number) => rows.filter((r) => r.win === i).length
  const strengths = (i: number) =>
    rows
      .filter((r) => r.win === i && r.gap >= CLEAR)
      .sort((x, y) => y.gap - x.gap)
      .slice(0, 5)
  const radarData = rows.filter((r) => r.c.scale === 'score5' && r.v.every((x) => x !== null))
  const overallWin = winner(
    overall.map((o) => r1(o?.avg)),
    TIE,
  )

  // Mesures : dernière valeur de chaque critère factuel chiffré.
  const latest = latestByPlayer(measurements)
  const measureRows: MeasureRow[] = criteria
    .filter((c) => c.kind === 'factual' && c.scale !== 'text' && c.scale !== 'choice')
    .map((c) => {
      const m = ps.map((p) => {
        const x = latest.get(p.id)?.get(c.id)
        return x && typeof x.value === 'number' ? x : undefined
      })
      const dir = measureDirection(c)
      return {
        c,
        m,
        dir,
        ...winner(
          m.map((x) => x?.value as number | undefined),
          0,
          dir,
        ),
      }
    })
    .filter((r) => r.m.some(Boolean))

  const samePos = !!ps[0].position && ps.every((p) => p.position === ps[0].position)
  const toggleAll = () => {
    const next = new URLSearchParams(params)
    if (all) next.delete('tous')
    else next.set('tous', '1')
    setParams(next, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      {back}
      <h1 className="-mt-2 text-lg font-extrabold">Comparer {nWord} joueurs</h1>

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

      {/* En-tête : les joueurs côte à côte */}
      <div className={`grid gap-2 ${n > 2 ? 'grid-cols-3 max-sm:gap-1.5' : 'grid-cols-2'}`}>
        {ps.map((p, i) => (
          <PlayerHead key={p.id} p={p} color={colors[i]} compact={n > 2} evs={evs[i].length} observers={observers[i]} ms={measurements.filter((m) => m.playerId === p.id)} />
        ))}
      </div>

      {!samePos && onlyOne.length > 0 && (
        <p className="rounded-md border border-line bg-panel-2 p-2.5 text-[11px] text-muted">
          Postes différents ({ps.map((p) => positionLabel(p.position)).join(' / ')}) : seuls les critères communs {n === 2 ? 'aux deux postes' : 'à tous les postes'} sont
          comparés ; {onlyOne.length} critère{onlyOne.length > 1 ? 's' : ''} {n === 2 ? (onlyOne.length > 1 ? 'propres à un seul poste' : 'propre à un seul poste') : 'qui ne valent pas pour tous'}{' '}
          {onlyOne.length > 1 ? 'sont écartés' : 'est écarté'}.
        </p>
      )}

      <div className="flex flex-col gap-4 wide:grid wide:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] wide:items-start">
        <div className="flex flex-col gap-4 side:sticky side:top-[calc(var(--hdr)+1.25rem)]">
          {/* Radar superposé */}
          <section className="card p-3">
            <div className="section-title">Radar des avis</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Mettre un joueur en avant">
              {ps.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setFocus((f) => (f === i ? null : i))}
                  aria-pressed={focus === i}
                  title={focus === i ? `Revoir les ${nWord} joueurs` : 'Mettre ce joueur en avant'}
                  className={`flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${focus === i ? 'border-fg/40 bg-panel-2' : 'border-line'} ${focus !== null && focus !== i ? 'opacity-45' : ''}`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors[i] }} />
                  <span className="truncate">{playerName(p)}</span>
                </button>
              ))}
            </div>
            {radarData.length < 3 ? (
              <p className="py-8 text-center text-[11px] text-muted">
                Il faut au moins 3 critères notés pour les {nWord} joueurs pour tracer le radar
                {radarData.length ? ` (${radarData.length} pour l’instant)` : ''}.
              </p>
            ) : (
              <>
                <Suspense fallback={<div className="h-72 py-10 text-center text-xs text-muted">Chargement du radar…</div>}>
                  <CompareRadar rows={radarData} colors={colors} focus={focus} />
                </Suspense>
                <p className="text-[10px] text-muted">
                  Critères notés pour les {nWord} joueurs ({radarData.length}). Toucher un nom le met en avant.
                </p>
              </>
            )}
          </section>

          {/* Points forts */}
          {rows.some((r) => r.v.filter((x) => x !== null).length >= 2) && (
            <section className={`grid gap-2 ${n > 2 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2'}`}>
              {ps.map((p, i) => {
                const list = strengths(i)
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
              <p className="col-span-full text-[10px] text-muted">
                Avance d’au moins {f1(CLEAR)} point{n > 2 ? ' sur le deuxième' : ''}.
              </p>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {/* Tableau des avis */}
          <section className="card p-3">
            <div className="section-title">Avis critère par critère</div>
            {rows.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-muted">
                Aucun avis validé {all ? '' : 'sur cet événement '}pour ces {nWord} joueurs
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
              <ScrollTable wide={n > 2}>
                <thead>
                  <HeadRow names={names} colors={colors} label="Critère" />
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <Fragment key={r.c.id}>
                      {(idx === 0 || rows[idx - 1].c.category !== r.c.category) && <CatRow label={r.c.category} span={n + 1} />}
                      <tr>
                        <td className={`${STICKY} border-t border-line py-1.5 pr-1`} title={r.c.description}>
                          {r.c.label}
                        </td>
                        {r.v.map((v, i) => (
                          <ValueCell key={i} best={r.win === i} gap={signed(r.gap)}>
                            {v === null ? '—' : f1(v)}
                          </ValueCell>
                        ))}
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={`${STICKY} border-t-2 border-line py-2 pr-1 font-bold`}>Moyenne générale</td>
                    {overall.map((o, i) => (
                      <ValueCell key={i} best={overallWin.win === i} gap={signed(overallWin.gap)} top>
                        {o ? `${f1(o.avg)}/5` : '—'}
                      </ValueCell>
                    ))}
                  </tr>
                  <tr>
                    <td className={`${STICKY} py-1.5 pr-1 text-muted`}>Critères où il est devant</td>
                    {ps.map((p, i) => (
                      <td key={p.id} className={`py-1.5 text-center ${ps.every((_, j) => j === i || ahead(i) > ahead(j)) ? 'font-extrabold' : 'text-muted'}`}>
                        {ahead(i)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </ScrollTable>
            )}
            <p className="mt-2 text-[10px] text-muted">
              Moyenne de chaque critère : chaque observateur pèse pareil. En <b className="text-emerald-300">vert</b>, le meilleur des {nWord} et son avance
              {n > 2 ? ' sur le deuxième' : ''} ; écart sous {f1(TIE)} : égalité{n > 2 ? ' en tête, rien en vert' : ''}. Moyenne générale calculée comme le classement.
            </p>
          </section>

          {/* Mesures factuelles */}
          <section className="card p-3">
            <div className="section-title">Mesures (dernières valeurs)</div>
            {measureRows.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-muted">Aucune mesure enregistrée pour ces {nWord} joueurs.</p>
            ) : (
              <ScrollTable wide={n > 2}>
                <thead>
                  <HeadRow names={names} colors={colors} label="Mesure" />
                </thead>
                <tbody>
                  {measureRows.map((r, idx) => (
                    <Fragment key={r.c.id}>
                      {(idx === 0 || measureRows[idx - 1].c.category !== r.c.category) && <CatRow label={r.c.category} span={n + 1} />}
                      <tr>
                        <td className={`${STICKY} border-t border-line py-1.5 pr-1`} title={r.c.description}>
                          {r.c.label}
                          {r.dir !== 0 && <span className="ml-1 text-[9px] text-muted">{r.dir < 0 ? '↓ mieux' : '↑ mieux'}</span>}
                        </td>
                        {r.m.map((m, i) => (
                          <ValueCell
                            key={i}
                            best={r.win === i}
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
              </ScrollTable>
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
function PlayerHead({ p, color, compact, evs, observers, ms }: { p: Player; color: string; compact?: boolean; evs: number; observers: number; ms: Measurement[] }) {
  const snaps = snapshots(p, ms)
  const kr = snaps[snaps.length - 1]?.kr
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-panel ${compact ? 'p-2.5 max-sm:p-1.5' : 'p-2.5'}`} style={{ borderTopColor: color, borderTopWidth: 4 }}>
      <Link
        to={`/joueurs/${p.id}`}
        className={`leading-tight font-extrabold break-words hover:underline ${compact ? 'text-sm max-sm:text-xs' : 'text-sm'}`}
        style={{ color }}
      >
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

// Colonne Critère figée quand le tableau défile horizontalement (trois joueurs sur téléphone).
const STICKY = 'sticky left-0 z-[1] bg-panel'

/** Tableau d'une colonne par joueur ; à trois, il défile horizontalement s'il manque de place. */
function ScrollTable({ wide, children }: { wide: boolean; children: ReactNode }) {
  return (
    <div className={wide ? '-mx-3 overflow-x-auto px-3' : ''}>
      <table className={`w-full table-fixed border-separate border-spacing-0 text-xs ${wide ? 'min-w-[19rem]' : ''}`}>{children}</table>
    </div>
  )
}

function HeadRow({ names, colors, label }: { names: string[]; colors: string[]; label: string }) {
  return (
    <tr className="text-[10px]">
      <th className={`${STICKY} py-1 text-left font-bold text-muted`}>{label}</th>
      {names.map((n, i) => (
        <th key={i} className={`${names.length > 2 ? 'w-[22%]' : 'w-[28%]'} truncate px-1 py-1 text-center font-extrabold`} style={{ color: colors[i] }} title={n}>
          {n}
        </th>
      ))}
    </tr>
  )
}

function CatRow({ label, span }: { label: string; span: number }) {
  return (
    <tr>
      <td colSpan={span} className="pt-3 pb-1 text-[10px] font-extrabold tracking-wider text-accent uppercase">
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
