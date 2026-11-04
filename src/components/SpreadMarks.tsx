import { sameNoteOffsets, SPREAD_COLOR, type MarkShape, type Spread } from '../opinionSpread'

/*
 * Repères des observateurs (vue « Écarts » de l'onglet Avis, src/components/OpinionsSpread.tsx, et ZoneRadar) : chacun
 * sa forme (rond, carré, losange, triangle…) et sa couleur (celle de sa colonne dans le tableau), liseré couleur du fond
 * pour rester lisible par-dessus les bandes. Échelle 1 à 5 d'un critère : bande de la note la plus basse à la plus haute
 * (couleur du niveau d'écart ; accord : gris discret), trait de la moyenne, un repère par observateur.
 */

/** Repère d'un observateur, centré en (x, y), dans un SVG. */
export function ObsMark({ x, y, r, shape, color, title }: { x: number; y: number; r: number; shape: MarkShape; color: string; title?: string }) {
  const p = { style: { fill: color, stroke: 'var(--color-panel)' }, strokeWidth: 1.4 }
  const t = title ? <title>{title}</title> : null
  if (shape === 'circle')
    return (
      <circle cx={x} cy={y} r={r} {...p}>
        {t}
      </circle>
    )
  if (shape === 'square')
    return (
      <rect x={x - r * 0.9} y={y - r * 0.9} width={r * 1.8} height={r * 1.8} {...p}>
        {t}
      </rect>
    )
  const k = r * 1.25
  const pts =
    shape === 'diamond'
      ? [
          [x, y - k],
          [x + k, y],
          [x, y + k],
          [x - k, y],
        ]
      : shape === 'triangle'
        ? [
            [x, y - k],
            [x + k, y + k * 0.75],
            [x - k, y + k * 0.75],
          ]
        : [
            [x - k, y - k * 0.75],
            [x + k, y - k * 0.75],
            [x, y + k],
          ]
  return (
    <polygon points={pts.map((q) => q.map((n) => n.toFixed(1)).join(',')).join(' ')} {...p}>
      {t}
    </polygon>
  )
}

/** Repère seul, en ligne avec du texte (légende, bulle). */
export function MarkIcon({ shape, color, size = 12 }: { shape: MarkShape; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <ObsMark x={7} y={7} r={4.6} shape={shape} color={color} />
    </svg>
  )
}

/**
 * Échelle d'un critère (HTML, s'étire sur la largeur donnée) : piste fine, bande min → max colorée selon l'écart, trait de
 * la moyenne, un repère par observateur ; des repères sur la même note sont posés côte à côte, un peu décalés en hauteur.
 */
export function SpreadScale({
  vals,
  colors,
  shapes,
  sp,
  lo = 1,
  hi = 5,
  names,
}: {
  /** Note de chaque observateur (null : pas noté). */
  vals: readonly (number | null | undefined)[]
  colors: readonly string[]
  shapes: readonly MarkShape[]
  sp: Spread
  lo?: number
  hi?: number
  names?: readonly string[]
}) {
  const pct = (v: number) => `${((Math.max(lo, Math.min(hi, v)) - lo) / Math.max(1, hi - lo)) * 100}%`
  const off = sameNoteOffsets(vals)
  const band = sp.lo !== null && sp.hi !== null && sp.hi > sp.lo
  return (
    <span className="relative mx-2 block h-6" aria-hidden>
      {/* Piste et graduations 1 à 5 */}
      <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-line" />
      {Array.from({ length: hi - lo + 1 }, (_, i) => (
        <span key={i} className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-line" style={{ left: pct(lo + i) }} />
      ))}
      {band && (
        <span
          className="absolute top-1/2 h-[7px] -translate-y-1/2 rounded-full"
          style={{
            left: pct(sp.lo!),
            width: `calc(${pct(sp.hi!)} - ${pct(sp.lo!)})`,
            background: sp.level === 'accord' ? 'var(--color-muted)' : SPREAD_COLOR[sp.level],
            opacity: sp.level === 'accord' ? 0.4 : 0.85,
          }}
        />
      )}
      {sp.avg !== null && <span className="absolute top-1/2 h-5 w-[2.5px] -translate-x-1/2 -translate-y-1/2 rounded bg-fg" style={{ left: pct(sp.avg) }} />}
      {vals.map((v, i) =>
        typeof v === 'number' ? (
          <svg
            key={i}
            width={14}
            height={14}
            viewBox="0 0 14 14"
            className="absolute top-1/2"
            style={{ left: pct(v), transform: `translate(-50%, calc(-50% + ${off[i] * 6}px))` }}
          >
            <ObsMark x={7} y={7} r={4.4} shape={shapes[i]} color={colors[i]} title={names?.[i]} />
          </svg>
        ) : null,
      )}
    </span>
  )
}
