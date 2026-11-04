import { useMemo, useState, type ReactNode } from 'react'
import { scaleMax, scaleMin, type Criterion, type Evaluation } from '../db'
import { bandColor, bySpread, markShapeOf, SPREAD_GRADIENT, spreadOf, spreadOpacity, spreadTextColor, spreadWords, type Spread } from '../opinionSpread'
import { categoryStyles, styleOf } from '../radarZones'
import type { AvisView } from '../tabQuery'
import { AnchoredBubble } from './AnchoredBubble'
import { MarkIcon, SpreadScale } from './SpreadMarks'
import ZoneRadar, { type AxisAnchor, type LegendItem, type RadarSpread } from './ZoneRadar'
import { Empty } from './ui'

/*
 * Vue « Écarts » de l'onglet Avis (fiche du joueur, un événement choisi dans le menu ; avis d'un joueur sur la page de
 * l'événement) quand au moins deux observateurs ont noté (logique pure : src/opinionSpread.ts ; seuils 1,5 et 2,5).
 * Segment commun de l'onglet (dans Opinions) « Complet | Par famille | Tableau », un seul volet à la fois (05/11) :
 *  - Complet / Par famille : le radar NORMAL de l'événement (moyenne des observateurs en zones colorées par famille,
 *    comme un avis seul) ; les écarts n'y sont qu'une surcouche discrète : une bande min → max le long des seules
 *    branches où il y a un écart, plus rouge et plus opaque à mesure que l'écart grandit. Ni repère d'observateur ni
 *    mention sous les libellés ; légende normale (familles, Moyenne) et petit dégradé « petit écart → gros écart ».
 *  - Tableau : petites lignes, une par critère, du plus gros écart au plus petit (les sujets à discuter en staff
 *    d'abord) : échelle 1 à 5, bande, trait de la moyenne, niveau et « moy. 3,0 · écart 4 » ; dessous, en plus compact,
 *    le tableau par observateur (`table`, fait par Opinions).
 *  - Toucher un critère (libellé du radar, ligne) : bulle accrochée là, note (et commentaire de l'avis) de chacun.
 * Pour le staff seulement : jamais sur la page du jeune.
 */

export default function OpinionsSpread({
  criteria,
  observers,
  colors,
  values,
  evs,
  view,
  table,
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
  view: AvisView
  /** Tableau par observateur, sous les lignes (volet « Tableau »). */
  table?: ReactNode
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
  const [bubble, setBubble] = useState<{ i: number; at: AxisAnchor } | null>(null)
  const open = (i: number, at: AxisAnchor) => setBubble({ i, at })

  const spread: RadarSpread = {
    values: crits.map((x) => x.v),
    band: sps.map((s) => {
      const color = bandColor(s)
      return color ? { color, opacity: spreadOpacity(s.gap) } : null
    }),
  }
  const legend: LegendItem[] = [
    { name: 'Moyenne', color: 'var(--color-fg)', line: true },
    ...(spread.band.some(Boolean) ? [{ name: 'petit écart → gros écart', color: '', gradient: SPREAD_GRADIENT }] : []),
  ]
  // Lignes : du plus gros écart au plus petit.
  const order = bySpread(
    crits.map((_, i) => i),
    (i) => sps[i],
  )

  return (
    <div className="flex flex-col gap-3">
      {view !== 'tableau' ? (
        crits.length < 3 ? (
          <Empty>Il faut au moins 3 critères notés pour afficher le radar.</Empty>
        ) : (
          <ZoneRadar
            axes={crits.map(({ c }) => ({ id: c.id, label: c.label, category: c.category }))}
            styles={styles}
            size={size}
            view={view === 'familles' ? 'split' : 'full'}
            series={[{ key: 'moyenne', name: 'Moyenne', values: sps.map((s) => s.avg), mode: 'zones' }]}
            spread={spread}
            onAxis={open}
            legend={legend}
          />
        )
      ) : (
        <>
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
                        <span className="shrink-0 text-xs font-bold" style={{ color: spreadTextColor(sp) }}>
                          {w.word}
                        </span>
                      </span>
                      <span className="flex w-full items-center gap-2 pl-4">
                        <span className="min-w-0 flex-1">
                          <SpreadScale vals={v} sp={sp} lo={scaleMin(c.scale)} hi={scaleMax(c.scale) ?? 5} />
                        </span>
                        <span className="w-[7.5rem] shrink-0 text-right text-[10px] whitespace-nowrap text-muted tabular-nums">{w.stats}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="mt-1.5 text-[10px] text-muted">Rangées du plus gros écart au plus petit. Touche un critère pour voir la note et le commentaire de chacun.</p>
          </div>
          {table && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-extrabold tracking-wider text-muted uppercase">Notes par observateur</div>
              {table}
            </div>
          )}
        </>
      )}

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
      <div className="mt-1 text-sm font-extrabold tabular-nums" style={{ color: spreadTextColor(sp) }}>
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
