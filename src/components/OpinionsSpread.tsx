import { useMemo, useState } from 'react'
import { scaleMax, scaleMin, type Criterion, type Evaluation } from '../db'
import {
  bySpread,
  familySpread,
  markShapeOf,
  SPREAD_COLOR,
  SPREAD_LEGEND,
  spreadOf,
  spreadWords,
  toDiscuss,
  type Spread,
} from '../opinionSpread'
import { categoryStyles, styleOf } from '../radarZones'
import { AnchoredBubble } from './AnchoredBubble'
import { MarkIcon, SpreadScale } from './SpreadMarks'
import type { ProgressLayout } from './OpinionsProgress'
import { RadarViewTabs, useRadarView } from './RadarViewTabs'
import ZoneRadar, { type AxisAnchor, type RadarSpread } from './ZoneRadar'
import { Empty } from './ui'

/*
 * Vue « Écarts » de l'onglet Avis (fiche du joueur, un événement choisi dans le menu ; avis d'un joueur sur la page de
 * l'événement) quand au moins deux observateurs ont noté : où ils ne sont pas d'accord (logique pure :
 * src/opinionSpread.ts ; seuils 1,5 et 2,5).
 *  - Radar (ZoneRadar, Complet / Par famille) : la moyenne en trait plein, une bande de la note la plus basse à la plus
 *    haute le long de chaque branche (orange : écart, rouge : gros écart ; accord : pas de bande), le repère de chaque
 *    observateur ; sous le libellé « 1 à 5 · gros écart ». Par famille : l'écart des moyennes de la famille par observateur.
 *  - Petites lignes : une par critère, du plus gros écart au plus petit (les sujets à discuter en staff d'abord) : échelle
 *    1 à 5, repères, bande, trait de la moyenne, niveau et « moy. 3,0 · écart 4 ».
 *  - Toucher un critère (libellé du radar, ligne) : bulle accrochée là, note (et commentaire de l'avis) de chacun.
 *  - Légende : les observateurs (repère et nom) et les trois niveaux.
 * Même disposition que la vue Progression : colonne large, radar et lignes côte à côte ; plus étroit, l'un sous l'autre ;
 * téléphone, segment « Radar | Lignes | Tableau » (dans Opinions). Le tableau par observateur reste dans Opinions.
 * Pour le staff seulement : jamais sur la page du jeune.
 */

export type SpreadPane = 'radar' | 'lines'

export default function OpinionsSpread({
  criteria,
  observers,
  colors,
  values,
  evs,
  pane,
  layout,
  radarTabs = true,
  size = 'normal',
}: {
  /** Critères chiffrés notés sur l'événement, dans l'ordre de la fiche. */
  criteria: Criterion[]
  observers: string[]
  colors: string[]
  /** Par critère (ordre de `criteria`) : la note de chaque observateur (sa moyenne s'il a donné plusieurs avis). */
  values: (number | null)[][]
  /** Avis comptés de l'événement (commentaires de la bulle). */
  evs: Evaluation[]
  pane: SpreadPane
  layout: ProgressLayout
  /** Onglets Complet / Par famille au-dessus du radar (fiche du joueur ; page de l'événement : la vue de l'écran). */
  radarTabs?: boolean
  size?: 'compact' | 'normal' | 'large'
}) {
  // Critères rangés par famille (ordre d'apparition des familles), comme la vue Progression.
  const crits = useMemo(() => {
    const fams = [...new Set(criteria.map((c) => c.category))]
    return criteria.map((c, i) => ({ c, v: values[i] })).sort((a, b) => fams.indexOf(a.c.category) - fams.indexOf(b.c.category))
  }, [criteria, values])
  const styles = useMemo(() => categoryStyles(crits.map((x) => x.c)), [crits])
  const sps = useMemo(() => crits.map((x) => spreadOf(x.v)), [crits])
  const marks = observers.map((name, i) => ({ name, color: colors[i], shape: markShapeOf(i) }))
  const colorOf = (sp: Spread) => (sp.n > 1 ? SPREAD_COLOR[sp.level] : SPREAD_COLOR.accord)
  const [radarView, setRadarView] = useRadarView()
  const [bubble, setBubble] = useState<{ i: number; at: AxisAnchor } | null>(null)
  const open = (i: number, at: AxisAnchor) => setBubble({ i, at })

  const spread: RadarSpread = {
    marks,
    values: crits.map((x) => x.v),
    mean: sps.map((s) => s.avg),
    band: sps.map((s) => (toDiscuss(s) ? SPREAD_COLOR[s.level] : null)),
  }
  const groupNote = (idx: number[]) => {
    const sp = familySpread(idx.map((i) => crits[i].v))
    return sp.n ? { text: spreadWords(sp).label, tone: 'flat' as const, color: colorOf(sp) } : null
  }
  const radar =
    crits.length < 3 ? (
      <Empty>Il faut au moins 3 critères notés pour afficher le radar.</Empty>
    ) : (
      <div>
        {radarTabs && <RadarViewTabs view={radarView} onChange={setRadarView} />}
        <ZoneRadar
          axes={crits.map(({ c }) => ({ id: c.id, label: c.label, category: c.category }))}
          styles={styles}
          size={size}
          view={radarTabs ? (radarView === 'familles' ? 'split' : 'full') : undefined}
          series={[]}
          spread={spread}
          notes={sps.map((s) => (s.n ? { text: spreadWords(s).label, short: spreadWords(s).range, tone: 'flat', color: colorOf(s) } : null))}
          groupNote={groupNote}
          onAxis={open}
          legend={[{ name: 'Moyenne', color: 'var(--color-fg)', line: true }]}
        />
      </div>
    )
  // Lignes : du plus gros écart au plus petit.
  const order = bySpread(
    crits.map((_, i) => i),
    (i) => sps[i],
  )

  return (
    <div className="flex flex-col gap-3">
      <div className={layout === 'side' ? 'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start gap-4' : 'flex flex-col gap-4'}>
        {(layout !== 'tabs' || pane === 'radar') && radar}
        {(layout !== 'tabs' || pane === 'lines') && (
          <div className="flex flex-col">
            {/* Une ligne par critère : nom et niveau, puis l'échelle 1 à 5 et « moy. 3,0 · écart 4 » (téléphone compris). */}
            <div className="flex items-end gap-2 border-b border-line px-1 pb-1 pl-5 text-[10px] text-muted" aria-hidden>
              <span className="relative mx-2 block h-3 min-w-0 flex-1">
                {[1, 2, 3, 4, 5].map((v) => (
                  <span key={v} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${((v - 1) / 4) * 100}%` }}>
                    {v}
                  </span>
                ))}
              </span>
              <span className="w-[7.5rem] shrink-0 text-right font-bold tracking-wider uppercase">Écart</span>
            </div>
            <ul>
              {order.map((i) => {
                const { c, v } = crits[i]
                const sp = sps[i]
                const w = spreadWords(sp)
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      data-ligne={c.id}
                      onClick={(ev) => {
                        const r = ev.currentTarget.getBoundingClientRect()
                        open(i, ev.clientX || ev.clientY ? { x: ev.clientX, top: ev.clientY - 4, bottom: ev.clientY + 4 } : { x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
                      }}
                      className="flex w-full flex-col gap-0.5 border-b border-line px-1 py-1.5 text-left transition hover:bg-fg/5"
                      aria-label={`${c.label} : ${w.label}, ${w.stats}`}
                    >
                      <span className="flex w-full items-baseline gap-2">
                        <span className="h-2 w-2 shrink-0 -translate-y-px rounded-full" style={{ background: styleOf(styles, c.category).color }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={c.label}>
                          {c.label}
                        </span>
                        <span className="shrink-0 text-xs font-bold" style={{ color: colorOf(sp) }}>
                          {w.word}
                        </span>
                      </span>
                      <span className="flex w-full items-center gap-2 pl-4">
                        <span className="min-w-0 flex-1">
                          <SpreadScale vals={v} colors={colors} shapes={marks.map((m) => m.shape)} names={observers} sp={sp} lo={scaleMin(c.scale)} hi={scaleMax(c.scale) ?? 5} />
                        </span>
                        <span className="w-[7.5rem] shrink-0 text-right text-[10px] whitespace-nowrap text-muted tabular-nums">{w.stats}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="mt-1.5 text-[10px] text-muted">Rangées du plus gros écart au plus petit. Touche un critère (ici ou sur le radar) pour voir la note de chacun.</p>
          </div>
        )}
      </div>

      {/* Légende : les observateurs (repère et nom), la moyenne, les trois niveaux d'écart. */}
      <ul className="flex flex-wrap justify-center gap-x-3.5 gap-y-1 text-[11px] text-muted" aria-label="Légende">
        {marks.map((m) => (
          <li key={m.name} className="flex items-center gap-1">
            <MarkIcon shape={m.shape} color={m.color} />
            <span className="font-bold text-fg">{m.name}</span>
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span aria-hidden className="h-3.5 w-[2.5px] shrink-0 rounded bg-fg" />
          Moyenne
        </li>
        {SPREAD_LEGEND.map((l) => (
          <li key={l.level} className="flex items-center gap-1">
            <span aria-hidden className="h-2.5 w-3.5 shrink-0 rounded-sm" style={{ background: SPREAD_COLOR[l.level], opacity: l.level === 'accord' ? 0.4 : 0.85 }} />
            {l.name}
          </li>
        ))}
      </ul>

      {bubble && (
        <SpreadBubble
          c={crits[bubble.i].c}
          color={styleOf(styles, crits[bubble.i].c.category).color}
          vals={crits[bubble.i].v}
          sp={sps[bubble.i]}
          marks={marks}
          evs={evs}
          at={bubble.at}
          onClose={() => setBubble(null)}
        />
      )}
    </div>
  )
}

/**
 * Bulle d'un critère (accrochée à l'endroit touché, fond flouté) : « 1 à 5 · gros écart », son échelle, puis chaque
 * observateur, de la note la plus haute à la plus basse, avec le commentaire de son avis (+ points forts, → à travailler).
 */
function SpreadBubble({
  c,
  color,
  vals,
  sp,
  marks,
  evs,
  at,
  onClose,
}: {
  c: Criterion
  color: string
  vals: (number | null)[]
  sp: Spread
  marks: { name: string; color: string; shape: ReturnType<typeof markShapeOf> }[]
  evs: Evaluation[]
  at: AxisAnchor
  onClose: () => void
}) {
  const w = spreadWords(sp)
  const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('fr-FR')
  const people = marks
    .map((m, o) => {
      const mine = evs.filter((e) => e.observer === m.name)
      return {
        m,
        v: vals[o],
        n: mine.filter((e) => typeof e.scores[c.id] === 'number').length,
        notes: mine.flatMap((e) => [e.strengths && { k: '+', t: e.strengths }, e.improvements && { k: '→', t: e.improvements }].filter((x): x is { k: string; t: string } => !!x)),
      }
    })
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1))
  const max = scaleMax(c.scale) ?? 5
  return (
    <AnchoredBubble
      at={at}
      label={c.label}
      title={c.label}
      sub={
        <>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
          {c.category} · {sp.n} note{sp.n > 1 ? 's' : ''}
        </>
      }
      onClose={onClose}
      testId="bulle-ecart"
    >
      <div className="mt-1 text-sm font-extrabold tabular-nums" style={{ color: sp.n > 1 ? SPREAD_COLOR[sp.level] : SPREAD_COLOR.accord }}>
        {w.label}
        <span className="ml-2 text-[11px] font-normal text-muted">{w.stats}</span>
      </div>
      <div className="my-1.5">
        <SpreadScale vals={vals} colors={marks.map((m) => m.color)} shapes={marks.map((m) => m.shape)} names={marks.map((m) => m.name)} sp={sp} lo={scaleMin(c.scale)} hi={max} />
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {people.map(({ m, v, n, notes }) => (
          <li key={m.name} className="py-1.5 text-xs">
            <div className="flex items-center gap-1.5">
              <MarkIcon shape={m.shape} color={m.color} />
              <b className="min-w-0 flex-1 truncate">{m.name}</b>
              {n > 1 && <span className="text-[10px] text-muted">{n} avis</span>}
              <b className="shrink-0 tabular-nums">{typeof v === 'number' ? `${fmt(v)}/${max}` : <span className="font-normal text-muted">pas noté</span>}</b>
            </div>
            {notes.map((x, j) => (
              <div key={j} className="mt-0.5 line-clamp-3 pl-[18px] text-[11px] text-muted">
                <span className={x.k === '+' ? 'text-emerald-300' : 'text-amber-300'}>{x.k} </span>
                {x.t}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </AnchoredBubble>
  )
}
