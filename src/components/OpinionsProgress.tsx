import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackCloses, useEntryState } from '../backNav'
import { scaleMax, scaleMin, type Criterion } from '../db'
import { useMedia, useWidth } from '../layout'
import {
  carried,
  countTones,
  dayLong,
  dayShort,
  deltaOf,
  deltaWords,
  fmtNote,
  fromWord,
  meanHistory,
  monthOf,
  moveNearest,
  overall,
  replayAt,
  signed,
  sixMonthsStart,
  toneOf,
  toWord,
  type Delta,
  type ProgressStep,
  type Tone,
  TONE_COLOR,
} from '../opinionProgress'
import { categoryStyles, styleOf } from '../radarZones'
import { RadarViewTabs, useRadarView } from './RadarViewTabs'
import ZoneRadar, { type AxisAnchor, type LegendItem } from './ZoneRadar'
import { Empty } from './ui'

/*
 * Vue « Progression » de l'onglet Avis (fiche du joueur, src/components/Opinions.tsx) : le chemin parcouru plutôt que la
 * moyenne de tous les avis (logique pure : src/opinionProgress.ts).
 *  - Frise à deux poignées (Départ / Arrivée), un cran par événement (avis hors événement : par jour) ; glisser, toucher
 *    un cran (la poignée la plus proche y va), flèches du clavier ; raccourcis « Tout », « 6 mois », « Dernier avis » ;
 *    « ▶ Rejouer » : l'arrivée part du départ et avance seule (~0,9 s par cran, en continu ; mouvement réduit : cran par cran).
 *  - Radar (ZoneRadar, vues Complet / Par famille) : départ en pointillés, arrivée en trait plein, gagné en vert, perdu en
 *    rouge ; sous chaque libellé « 1 → 4 ↗ ».
 *  - Petites lignes : une par critère, rangées par famille : note actuelle, petite courbe (la période en couleur), écart.
 *  - Toucher un critère (libellé du radar, ligne) : bulle accrochée là, courbe de toutes ses notes datées.
 * Colonne large : radar à gauche, lignes à droite ; fiche à côté de la liste : l'un sous l'autre ; téléphone : segment
 * « Radar | Lignes » (dans Opinions).
 * `young` : vue du jeune, sans rouge ni baisse (une baisse en gris neutre, sans flèche) ; pas encore montrée côté jeune.
 * Un seul cran : pas de frise ni de ▶, le radar de cet avis.
 */

export type ProgressPane = 'radar' | 'lines'
/** Radar et lignes : côte à côte, l'un sous l'autre, ou un seul à la fois (segment « Radar | Lignes »). */
export type ProgressLayout = 'side' | 'stack' | 'tabs'

export default function OpinionsProgress({
  playerId,
  steps,
  criteria,
  avisCount,
  observerCount,
  pane,
  layout,
  afterStats,
  young = false,
}: {
  playerId: string
  steps: ProgressStep[]
  /** Critères chiffrés notés au moins une fois, dans l'ordre de la fiche. */
  criteria: Criterion[]
  avisCount: number
  observerCount: number
  /** Téléphone : volet affiché (segment « Radar | Lignes »). */
  pane: ProgressPane
  layout: ProgressLayout
  /** Sous les chiffres (case « inclure les avis en attente »). */
  afterStats?: ReactNode
  young?: boolean
}) {
  const L = steps.length - 1
  const single = L < 1
  // Critères rangés par famille (ordre d'apparition des familles), puis dans l'ordre de la fiche.
  const crits = useMemo(() => {
    const fams = [...new Set(criteria.map((c) => c.category))]
    return [...criteria].sort((a, b) => fams.indexOf(a.category) - fams.indexOf(b.category))
  }, [criteria])
  const styles = useMemo(() => categoryStyles(crits), [crits])
  const hs = useMemo(() => crits.map((c) => carried(steps, c.id)), [crits, steps])

  // Poignées gardées avec l'entrée de l'historique (Retour d'un avis ouvert depuis la fiche : même période).
  const [kept, keep] = useEntryState<{ pid: string; n: number; s: number; e: number } | null>('avis.frise', null)
  const valid = kept && kept.pid === playerId && kept.n === steps.length && kept.s < kept.e && kept.e <= L
  const s = valid ? kept.s : 0
  const e = valid ? kept.e : Math.max(0, L)
  const setRange = (ns: number, ne: number) => keep({ pid: playerId, n: steps.length, s: ns, e: ne })

  // ▶ Rejouer : arrivée animée (cran fractionnaire), poignée de départ fixe.
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const [anim, setAnim] = useState<number | null>(null)
  const [playFrom, setPlayFrom] = useState<number | null>(null)
  useEffect(() => {
    if (playFrom === null) return
    const t0 = performance.now()
    let id = 0
    let alive = true
    const tick = () => {
      if (!alive) return
      const t = replayAt(playFrom, L, performance.now() - t0, reduced)
      if (t >= L) {
        setAnim(null)
        setPlayFrom(null)
        keep({ pid: playerId, n: steps.length, s: playFrom, e: L })
        return
      }
      setAnim(t)
      id = reduced ? window.setTimeout(tick, 900) : requestAnimationFrame(tick)
    }
    id = reduced ? window.setTimeout(tick, 900) : requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimationFrame(id)
      clearTimeout(id)
    }
  }, [playFrom]) // eslint-disable-line react-hooks/exhaustive-deps
  const playing = playFrom !== null
  const stop = () => {
    if (!playing) return
    const at = anim ?? s + 1
    setPlayFrom(null)
    setAnim(null)
    setRange(s, Math.min(L, Math.max(s + 1, Math.round(at))))
  }
  const t = anim ?? e

  const deltas = useMemo(() => hs.map((h) => deltaOf(h, s, t)), [hs, s, t])
  const tones = deltas.map((d) => toneOf(d, young))
  const words = deltas.map((d) => deltaWords(d, young))

  const [bubble, setBubble] = useState<{ i: number; at: AxisAnchor } | null>(null)
  const open = (i: number, at: AxisAnchor) => {
    stop()
    setBubble({ i, at })
  }

  const [radarView, setRadarView] = useRadarView()
  const tot = overall(deltas)
  const nums = countTones(deltas, young)
  const a = steps[s]
  const b = steps[Math.min(L, Math.round(t))]

  // Vue « Par famille » : moyenne des critères de la famille à chaque cran.
  const groupNote = (idx: number[]) => {
    if (single) return null
    const d = deltaOf(meanHistory(idx.map((i) => hs[i])), s, t)
    if (d.d === null) return null
    return { text: deltaWords(d, young).short, tone: toneOf(d, young) }
  }
  const legend: LegendItem[] = single
    ? [{ name: 'Notes de l’avis', color: 'var(--color-fg)', line: true }]
    : [
        { name: 'Départ', color: 'var(--color-muted)', dashed: true },
        { name: 'Arrivée', color: 'var(--color-fg)', line: true },
        { name: 'Progresse', color: TONE_COLOR.up },
        ...(young ? [] : [{ name: 'Baisse', color: TONE_COLOR.down }]),
        { name: 'a varié', color: '', mark: '↕' },
      ]

  const radar =
    crits.length < 3 ? (
      <Empty>Il faut au moins 3 critères notés pour afficher le radar.</Empty>
    ) : (
      <div>
        <RadarViewTabs view={radarView} onChange={setRadarView} />
        <ZoneRadar
          axes={crits.map((c) => ({ id: c.id, label: c.label, category: c.category }))}
          styles={styles}
          size="normal"
          view={radarView === 'familles' ? 'split' : 'full'}
          series={single ? [{ key: 'avis', name: 'Notes de l’avis', values: hs.map((h) => h[0]), mode: 'zones' }] : []}
          progress={single ? undefined : { from: deltas.map((d) => d.a), to: deltas.map((d) => d.b), neutralLoss: young }}
          notes={single ? undefined : words.map((w, i) => (w.short ? { text: w.short, tone: tones[i] } : null))}
          groupNote={groupNote}
          onAxis={open}
          legend={legend}
        />
      </div>
    )

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Avis" value={String(avisCount)} />
        <Stat label={observerCount > 1 ? 'Personnes' : 'Personne'} value={String(observerCount)} />
        <Stat
          label="Actuel"
          value={tot.now === null ? '—' : `${fmtNote(tot.now)}/5`}
          sub={
            !single && tot.gain !== null && (tot.gain > 0 || !young) ? (
              <span style={{ color: TONE_COLOR[tot.gain > 0 ? 'up' : tot.gain < 0 ? 'down' : 'flat'] }}>
                {tot.gain > 0 ? '↗ ' : tot.gain < 0 ? '↘ ' : ''}
                {tot.gain === 0 ? 'stable' : signed(tot.gain)} depuis le départ
              </span>
            ) : undefined
          }
        />
      </div>
      {afterStats}

      {!single && (
        <section className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-2.5" aria-label="Période comparée">
          <div className="text-xs text-muted" aria-live="polite">
            {fromWord(a.name)} <b className="text-fg">{a.name}</b> ({dayLong(a.date)}) {playing ? (toWord(b.name) === 'au' ? 'jusqu’au' : 'jusqu’à') : toWord(b.name)}{' '}
            <b className="text-fg">{b.name}</b> ({dayLong(b.date)})
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Pill tone="up">{nums.up} progresse{nums.up > 1 ? 'nt' : ''}</Pill>
              {!young && <Pill tone="down">{nums.down} baisse{nums.down > 1 ? 'nt' : ''}</Pill>}
              <Pill tone="flat">
                {nums.flat} stable{nums.flat > 1 ? 's' : ''} ou variable{nums.flat > 1 ? 's' : ''}
              </Pill>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ['Tout', 0, L],
                ['6 mois', sixMonthsStart(steps), L],
                ['Dernier avis', L - 1, L],
              ] as const
            ).map(([label, ns, ne]) => (
              <button
                key={label}
                type="button"
                aria-pressed={!playing && s === ns && e === ne}
                onClick={() => {
                  stop()
                  setRange(ns, ne)
                }}
                className={`min-h-8 rounded-full border px-3 text-xs font-bold transition ${!playing && s === ns && e === ne ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line bg-panel text-fg hover:border-muted'}`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                if (playing) return stop()
                setBubble(null)
                setAnim(s)
                setPlayFrom(s)
              }}
              className="ml-auto min-h-8 rounded-full bg-fg px-4 text-xs font-bold text-panel transition hover:brightness-110"
              aria-label={playing ? 'Mettre en pause' : 'Rejouer la progression depuis le départ'}
            >
              {playing ? '❚❚ Pause' : '▶ Rejouer'}
            </button>
          </div>
          <Frise
            steps={steps}
            s={s}
            t={t}
            onChange={(ns, ne) => {
              stop()
              setRange(ns, ne)
            }}
          />
        </section>
      )}

      <div className={layout === 'side' ? 'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-4' : 'flex flex-col gap-4'}>
        {(layout !== 'tabs' || pane === 'radar') && radar}
        {(layout !== 'tabs' || pane === 'lines') && (
          <Lines crits={crits} styles={styles} hs={hs} s={s} t={t} single={single} deltas={deltas} tones={tones} words={words} onOpen={open} />
        )}
      </div>

      {bubble && (
        <CriterionBubble
          c={crits[bubble.i]}
          color={styleOf(styles, crits[bubble.i].category).color}
          steps={steps}
          s={s}
          t={t}
          single={single}
          range={words[bubble.i].range}
          tone={tones[bubble.i]}
          at={bubble.at}
          onClose={() => setBubble(null)}
        />
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 py-2">
      <div className="text-base font-extrabold">{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
      {sub && <div className="mt-0.5 px-1 text-[10px] leading-tight font-bold">{sub}</div>}
    </div>
  )
}

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-panel px-2.5 py-0.5 text-[11px] font-bold" style={{ color: TONE_COLOR[tone] }}>
      {children}
    </span>
  )
}

/**
 * Frise à deux poignées : un cran par point, libellés mois + type (une partie seulement s'il n'y a pas la place). Glisser
 * une poignée ; toucher la frise : la poignée la plus proche y va (et suit le doigt) ; flèches du clavier sur une poignée
 * (role slider). Le départ reste toujours avant l'arrivée.
 */
function Frise({ steps, s, t, onChange }: { steps: ProgressStep[]; s: number; t: number; onChange: (s: number, e: number) => void }) {
  const L = steps.length - 1
  const [ref, w] = useWidth<HTMLDivElement>()
  const box = useRef<HTMLDivElement | null>(null)
  const e = Math.round(t)
  const pct = (j: number) => `${(j / L) * 100}%`
  // Un libellé tous les k crans (56 px au moins chacun), toujours le dernier.
  const k = Math.max(1, Math.ceil((L + 1) / Math.max(2, Math.floor((w || 320) / 56))))
  const shown = (j: number) => j === L || (j % k === 0 && L - j >= k * 0.6)
  // Poignées proches : les légendes « Départ » / « Arrivée » s'écartent de part et d'autre.
  const close = w > 0 && ((t - s) / L) * w < 64
  const drag = useRef<'s' | 'e' | null>(null)
  const stepAt = (x: number) => {
    const r = box.current!.getBoundingClientRect()
    return Math.max(0, Math.min(L, Math.round(((x - r.left) / r.width) * L)))
  }
  const cur = useRef({ s, e })
  useLayoutEffect(() => {
    cur.current = { s, e }
  })
  const move = (which: 's' | 'e', j: number) => {
    const { s: cs, e: ce } = cur.current
    if (which === 's') {
      const ns = Math.min(j, ce - 1)
      if (ns !== cs && ns >= 0) onChange(ns, ce)
    } else {
      const ne = Math.max(j, cs + 1)
      if (ne !== ce && ne <= L) onChange(cs, ne)
    }
  }
  const down = (ev: PointerEvent<HTMLDivElement>) => {
    if (ev.button !== 0) return
    const j = stepAt(ev.clientX)
    const handle = (ev.target as HTMLElement).closest<HTMLElement>('[data-poignee]')?.dataset.poignee as 's' | 'e' | undefined
    let which = handle
    if (!which) {
      const n = moveNearest(s, e, j, L)
      which = n.s !== s ? 's' : n.e !== e ? 'e' : Math.abs(j - s) <= Math.abs(j - e) ? 's' : 'e'
      onChange(n.s, n.e)
      cur.current = n
    }
    drag.current = which
    ev.currentTarget.setPointerCapture(ev.pointerId)
    ;(ev.currentTarget.querySelector(`[data-poignee="${which}"]`) as HTMLElement | null)?.focus({ preventScroll: true })
    ev.preventDefault()
  }
  const key = (which: 's' | 'e') => (ev: KeyboardEvent) => {
    const d = ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -1 : ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : 0
    const to = ev.key === 'Home' ? 0 : ev.key === 'End' ? L : null
    if (!d && to === null) return
    ev.preventDefault()
    const cs = cur.current
    if (which === 's') onChange(Math.max(0, Math.min(cs.e - 1, to ?? cs.s + d)), cs.e)
    else onChange(cs.s, Math.min(L, Math.max(cs.s + 1, to ?? cs.e + d)))
  }
  const handle = (which: 's' | 'e') => {
    const j = which === 's' ? s : t
    const st = steps[which === 's' ? s : e]
    const cap = which === 's' ? 'Départ' : 'Arrivée'
    return (
      <div
        data-poignee={which}
        role="slider"
        tabIndex={0}
        aria-label={cap}
        aria-valuemin={0}
        aria-valuemax={L}
        aria-valuenow={which === 's' ? s : e}
        aria-valuetext={`${st.name}, ${dayLong(st.date)}`}
        onKeyDown={key(which)}
        className={`absolute top-[19px] z-[2] -ml-[13px] h-[26px] w-[26px] cursor-grab touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing ${
          which === 's' ? 'border-[3px] border-muted bg-panel' : 'border-2 border-panel bg-fg shadow-[0_0_0_2px_var(--color-fg)]'
        }`}
        style={{ left: pct(j) }}
      >
        <span
          className={`pointer-events-none absolute bottom-[29px] text-[11px] font-bold whitespace-nowrap ${which === 's' ? 'text-muted' : 'text-fg'}`}
          style={close ? (which === 's' ? { right: 6 } : { left: 6 }) : { left: '50%', transform: 'translateX(-50%)' }}
        >
          {cap}
        </span>
      </div>
    )
  }
  return (
    <div
      ref={(el) => {
        box.current = el
        return ref(el)
      }}
      className="relative mx-3.5 h-[84px] touch-none select-none"
      onPointerDown={down}
      onPointerMove={(ev) => drag.current && move(drag.current, stepAt(ev.clientX))}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className="absolute inset-x-0 top-[29px] h-1.5 rounded-full bg-line" />
      <div className="absolute top-[29px] h-1.5 rounded-full bg-fg" style={{ left: pct(s), width: `${((t - s) / L) * 100}%` }} />
      {steps.map((st, j) => (
        <span
          key={st.key}
          aria-hidden
          title={`${st.name} · ${dayLong(st.date)}`}
          className={`absolute top-[26px] -ml-1.5 h-3 w-3 rounded-full border-2 bg-panel ${j >= s && j <= t ? 'border-fg' : 'border-muted/60'}`}
          style={{ left: pct(j) }}
        />
      ))}
      {steps.map(
        (st, j) =>
          shown(j) && (
            <span key={st.key} aria-hidden className="pointer-events-none absolute top-[46px] -translate-x-1/2 text-center text-[10px] leading-tight whitespace-nowrap text-muted" style={{ left: pct(j) }}>
              <b className="block font-bold text-fg">{monthOf(st.date)}</b>
              {st.tag}
            </span>
          ),
      )}
      {handle('s')}
      {handle('e')}
    </div>
  )
}

/** Petites lignes : une par critère chiffré, rangées par famille. */
function Lines({
  crits,
  styles,
  hs,
  s,
  t,
  single,
  deltas,
  tones,
  words,
  onOpen,
}: {
  crits: Criterion[]
  styles: ReturnType<typeof categoryStyles>
  hs: (number | null)[][]
  s: number
  t: number
  single: boolean
  deltas: Delta[]
  tones: Tone[]
  words: ReturnType<typeof deltaWords>[]
  onOpen: (i: number, at: AxisAnchor) => void
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-1 pb-1 text-[10px] font-bold tracking-wider text-muted uppercase">
        <span className="flex-1">Critère</span>
        <span className="w-9 text-center">Actuel</span>
        {!single && <span className="w-[4.75rem] text-right">Évolution</span>}
      </div>
      <ul>
        {crits.map((c, i) => {
          const color = styleOf(styles, c.category).color
          return (
            <li key={c.id}>
              <button
                type="button"
                data-ligne={c.id}
                onClick={(ev) => {
                  const r = ev.currentTarget.getBoundingClientRect()
                  onOpen(i, ev.clientX || ev.clientY ? { x: ev.clientX, top: ev.clientY - 4, bottom: ev.clientY + 4 } : { x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
                }}
                className="flex w-full items-center gap-2 border-b border-line px-1 py-1.5 text-left transition hover:bg-fg/5"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-xs leading-tight font-semibold break-words">{c.label}</span>
                  <span className="block truncate text-[10px] text-muted">{c.category}</span>
                </span>
                <span className="w-9 shrink-0 text-center text-sm font-extrabold tabular-nums">{fmtNote(deltas[i].b)}</span>
                {!single && (
                  <>
                    <Spark h={hs[i]} s={s} t={t} tone={tones[i]} lo={scaleMin(c.scale)} hi={scaleMax(c.scale) ?? 5} />
                    <span className="w-[4.75rem] shrink-0 text-right text-xs leading-tight font-bold" style={{ color: TONE_COLOR[tones[i]] }}>
                      {words[i].gap}
                      {words[i].lastStep && <span className="block text-[10px] font-normal text-muted">{words[i].lastStep}</span>}
                    </span>
                  </>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-1.5 text-[10px] text-muted">Touche un critère (ici ou sur le radar) pour voir sa courbe.</p>
    </div>
  )
}

/** Petite courbe d'un critère : tout l'historique en gris clair, la période Départ → Arrivée en couleur, un point au bout. */
function Spark({ h, s, t, tone, lo, hi }: { h: (number | null)[]; s: number; t: number; tone: Tone; lo: number; hi: number }) {
  const W = 60
  const H = 26
  const L = Math.max(1, h.length - 1)
  const x = (j: number) => 3 + (j * (W - 6)) / L
  const y = (v: number) => H - 3 - ((v - lo) / Math.max(1, hi - lo)) * (H - 6)
  const all = h.map((v, j) => (v === null ? null : `${x(j).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean)
  const part: string[] = []
  for (let j = s; j <= Math.floor(t); j++) if (h[j] !== null) part.push(`${x(j).toFixed(1)},${y(h[j]!).toFixed(1)}`)
  const end = deltaOf(h, s, t).b
  if (t % 1 && end !== null) part.push(`${x(t).toFixed(1)},${y(end).toFixed(1)}`)
  const start = h[s]
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="shrink-0">
      <polyline points={all.join(' ')} fill="none" style={{ stroke: 'var(--color-line)' }} strokeWidth={2} strokeLinejoin="round" />
      {part.length > 1 && <polyline points={part.join(' ')} fill="none" style={{ stroke: TONE_COLOR[tone] }} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
      {start !== null && <circle cx={x(s)} cy={y(start)} r={2.4} style={{ fill: 'var(--color-panel)', stroke: 'var(--color-muted)' }} strokeWidth={1.4} />}
      {end !== null && <circle cx={x(t)} cy={y(end)} r={3.2} style={{ fill: TONE_COLOR[tone] }} />}
    </svg>
  )
}

/**
 * Bulle d'un critère, accrochée à l'endroit touché (dessous s'il y a la place, sinon dessus ; pointe vers le doigt), fond
 * légèrement flouté (scrim-light) : nom, « 3 → 4,5 ↗ », courbe de toutes ses notes datées (période Départ → Arrivée
 * teintée). ✕, Échap, toucher à côté, Retour du téléphone, défilement de la page ou changement de taille : fermée.
 */
function CriterionBubble({
  c,
  color,
  steps,
  s,
  t,
  single,
  range,
  tone,
  at,
  onClose,
}: {
  c: Criterion
  color: string
  steps: ProgressStep[]
  s: number
  t: number
  single: boolean
  range: string
  tone: Tone
  at: AxisAnchor
  onClose: () => void
}) {
  useBackCloses(onClose)
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  const [pos, setPos] = useState<{ left: number; top: number; caret: number; below: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(8, Math.min(at.x - w / 2, vw - w - 8))
    const below = at.bottom + 12 + h <= vh - 8 || vh - at.bottom >= at.top
    const top = below ? Math.min(at.bottom + 12, vh - h - 8) : Math.max(8, at.top - 12 - h)
    setPos({ left, top, caret: Math.max(16, Math.min(at.x - left, w - 16)), below })
  }, [at])
  useEffect(() => {
    const before = document.activeElement
    box.current?.focus({ preventScroll: true })
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close.current()
    const scroll = (e: Event) => !box.current?.contains(e.target as Node) && close.current()
    const resize = () => close.current()
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true })
    }
  }, [])

  // Courbe : les notes vraiment données (pas le report), placées à leur cran.
  const L = Math.max(1, steps.length - 1)
  const pts = steps.map((st, j) => ({ j, v: st.scores[c.id], d: st.date })).filter((p): p is { j: number; v: number; d: string } => typeof p.v === 'number')
  const lo = scaleMin(c.scale)
  const hi = scaleMax(c.scale) ?? 5
  const W = 310
  const H = 150
  const pl = 22
  const pr = 18
  const pt = 10
  const pb = 30
  const x = (j: number) => (steps.length === 1 ? (pl + W - pr) / 2 : pl + (j * (W - pl - pr)) / L)
  const y = (v: number) => pt + ((hi - v) / Math.max(1, hi - lo)) * (H - pt - pb)
  // Dates sous les points : une sur k si elles sont serrées.
  const kd = Math.max(1, Math.ceil(pts.length / 7))
  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 scrim-light" aria-hidden />
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-label={c.label}
        onClick={(e) => e.stopPropagation()}
        className={`win absolute w-[min(22rem,calc(100vw-1rem))] p-3.5 pb-2.5 shadow-2xl outline-none transition-opacity duration-100 ${pos ? 'opacity-100' : 'opacity-0'}`}
        style={pos ? { left: pos.left, top: pos.top } : { left: 8, top: at.bottom + 12 }}
        data-testid="bulle-critere"
      >
        {pos && (
          <span
            aria-hidden
            className={`absolute h-3 w-3 rotate-45 border-line bg-panel ${pos.below ? '-top-1.5 border-t border-l' : '-bottom-1.5 border-r border-b'}`}
            style={{ left: pos.caret - 6 }}
          />
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[15px] leading-tight font-extrabold">{c.label}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
              {c.category} · {pts.length} note{pts.length > 1 ? 's' : ''}
            </div>
          </div>
          <button className="-mt-1.5 -mr-2 min-h-9 min-w-9 shrink-0 text-muted" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>
        {!single && range && (
          <div className="mt-1 text-sm font-extrabold tabular-nums" style={{ color: TONE_COLOR[tone] }}>
            {range}
          </div>
        )}
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Courbe de ${c.label} : ${pts.map((p) => `${fmtNote(p.v)} le ${dayLong(p.d)}`).join(', ')}`} className="mt-1 block">
          {Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((v) => (
            <g key={v}>
              <line x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--color-line)' }} strokeWidth={0.8} />
              <text x={pl - 7} y={y(v) + 3.5} textAnchor="end" fontSize={10} style={{ fill: 'var(--color-muted)' }}>
                {v}
              </text>
            </g>
          ))}
          {!single && <rect x={x(s)} y={pt} width={Math.max(0, x(t) - x(s))} height={H - pt - pb} style={{ fill: 'var(--color-fg)' }} fillOpacity={0.06} />}
          {pts.length > 1 && (
            <polyline points={pts.map((p) => `${x(p.j).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} fill="none" style={{ stroke: 'var(--color-fg)' }} strokeWidth={2} strokeLinejoin="round" />
          )}
          {pts.map((p, i) => {
            const inR = single || (p.j >= s && p.j <= t)
            return (
              <g key={p.j}>
                <circle cx={x(p.j)} cy={y(p.v)} r={inR ? 4 : 3} style={{ fill: inR ? 'var(--color-fg)' : 'var(--color-panel)', stroke: 'var(--color-fg)' }} strokeWidth={1.5}>
                  <title>
                    {fmtNote(p.v)} · {steps[p.j].name} · {dayLong(p.d)}
                  </title>
                </circle>
                {(i % kd === 0 || i === pts.length - 1) && (
                  <text x={x(p.j)} y={H - pb + 15} textAnchor="middle" fontSize={10} style={{ fill: 'var(--color-muted)' }}>
                    {dayShort(p.d)}
                  </text>
                )}
              </g>
            )
          })}
          {!single && (
            <>
              <text x={x(s)} y={H - 3} textAnchor="start" fontSize={10} fontWeight={700} style={{ fill: 'var(--color-muted)' }}>
                départ
              </text>
              <text x={x(t)} y={H - 3} textAnchor="end" fontSize={10} fontWeight={700} style={{ fill: 'var(--color-fg)' }}>
                arrivée
              </text>
            </>
          )}
        </svg>
      </div>
    </div>,
    document.body,
  )
}
