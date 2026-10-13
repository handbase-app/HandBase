import { useCallback, useId, useMemo, useState, type RefCallback } from 'react'
import { layoutRadar, polar, wrapLabel, type CategoryStyle, type RadarAxis } from '../radarZones'

/*
 * Radar « par zones » (src/radarZones.ts), dessiné en SVG : chaque catégorie occupe son secteur (fond à peine teinté
 * de sa couleur), branches régulières dans le secteur, cercles 1 à 5. Tracés :
 *  - « zones » : polygone rempli, dans chaque secteur, de la couleur de la catégorie (découpé par secteur), contour
 *    couleur du texte, points aux sommets couleur de la catégorie (moyenne des avis) ;
 *  - « fill » : polygone d'une seule couleur, translucide (un joueur dans la comparaison) ;
 *  - « line » : contour seul et petits points à ses notes, sans remplissage (un observateur affiché à la demande).
 * Légende des catégories (et des tracés donnés dans `legend`) sous le radar. Libellés coupés sur deux lignes et
 * écartés les uns des autres pour ne pas se chevaucher.
 */

export interface RadarSeries {
  key: string
  name: string
  /** Une valeur par branche, dans l'ordre de `axes` (null : pas de valeur). */
  values: (number | null | undefined)[]
  mode: 'zones' | 'fill' | 'line'
  color?: string
  fillOpacity?: number
  strokeOpacity?: number
  strokeWidth?: number
}

type Size = 'compact' | 'normal' | 'large'
/** Hauteur au plus (px) : comme avant (h-64, h-80, colonne large : entre 22 et 34rem, 58 % de l'écran). */
const maxHeight = (size: Size) =>
  size === 'compact' ? 256 : size === 'normal' ? 320 : Math.max(352, Math.min(544, Math.round((typeof window === 'undefined' ? 800 : window.innerHeight) * 0.58)))

function useBox<T extends HTMLElement>(): [RefCallback<T>, { w: number; h: number }] {
  const [box, setBox] = useState({ w: 0, h: 0 })
  const ref = useCallback<RefCallback<T>>((el) => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, box]
}

interface Label {
  text: string[]
  full: string
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  w: number
  h: number
}

/** Écarte verticalement les libellés qui se chevauchent (sans sortir du cadre). */
function spread(labels: Label[], top: number, bottom: number, mid: number) {
  const box = (l: Label) => {
    const x0 = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - l.w : l.x - l.w / 2
    return { x0, x1: x0 + l.w, y0: l.y - l.h / 2, y1: l.y + l.h / 2 }
  }
  for (let it = 0; it < 40; it++) {
    let moved = false
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const a = box(labels[i])
        const b = box(labels[j])
        if (a.x1 + 2 <= b.x0 || b.x1 + 2 <= a.x0) continue
        const over = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1
        if (over <= 0) continue
        const [up, down] = labels[i].y <= labels[j].y ? [labels[i], labels[j]] : [labels[j], labels[i]]
        // Vers l'extérieur du radar : en haut on monte le plus haut tant qu'il y a la place, en bas on descend le
        // plus bas ; le reste est rattrapé par l'autre.
        if ((up.y + down.y) / 2 < mid) {
          const m = Math.max(0, Math.min(over, up.y - up.h / 2 - top))
          up.y -= m
          down.y += over - m
        } else {
          const m = Math.max(0, Math.min(over, bottom - down.y - down.h / 2))
          down.y += m
          up.y -= over - m
        }
        moved = true
      }
    for (const l of labels) l.y = Math.min(bottom - l.h / 2, Math.max(top + l.h / 2, l.y))
    if (!moved) break
  }
}

const wedge = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  if (a1 - a0 >= 359.999) return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  return `M${cx},${cy}L${x0},${y0}A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0},1 ${x1},${y1}Z`
}

export default function ZoneRadar({
  axes,
  styles,
  series,
  size = 'normal',
  max = 5,
  legend = [],
}: {
  axes: RadarAxis[]
  styles: Map<string, CategoryStyle>
  series: RadarSeries[]
  size?: Size
  max?: number
  /** Entrées de légende en plus des catégories (tracés : moyenne, observateurs…). */
  legend?: { name: string; color: string; line?: boolean }[]
}) {
  const uid = 'zr' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [ref, { w: W }] = useBox<HTMLDivElement>()
  const layout = useMemo(() => layoutRadar(axes, styles), [axes, styles])
  const index = useMemo(() => new Map(axes.map((a, i) => [a.id, i])), [axes])

  // Police à chasse fixe de l'appli : ~0,6 em par caractère.
  const f = size === 'large' ? 11 : W < 420 ? 9 : 10
  const lineH = Math.round(f * 1.2)
  const charW = f * 0.6
  const labelW = Math.max(60, Math.min(size === 'large' ? 140 : 120, W * 0.24))
  const maxChars = Math.max(6, Math.floor(labelW / charW))
  const maxH = maxHeight(size)
  // Rayon limité par la largeur (téléphone) ou la hauteur ; hauteur réduite à ce qu'il faut (pas de vide).
  const R = Math.max(30, Math.min(W / 2 - labelW - 10, maxH / 2 - 3 * lineH - 6))
  const H = W ? Math.min(maxH, Math.round(2 * R + 6 * lineH + 16)) : 0
  const cx = W / 2
  const cy = H / 2

  const labels: Label[] = useMemo(() => {
    if (!W || !H) return []
    const ls = layout.axes.map((a): Label => {
      const text = wrapLabel(a.label, maxChars)
      const s = Math.sin((a.angle * Math.PI) / 180)
      const c = Math.cos((a.angle * Math.PI) / 180)
      const [x, y] = polar(cx, cy, R + 7, a.angle)
      const h = text.length * lineH
      const anchor = Math.abs(s) < 0.08 ? 'middle' : s > 0 ? 'start' : 'end'
      // Près du haut / du bas : le bloc de texte posé au-dessus / au-dessous de la pointe.
      const dy = c > 0.8 ? -h / 2 + 2 : c < -0.8 ? h / 2 - 2 : 0
      return { text, full: a.label, x, y: y + dy, anchor, w: Math.max(...text.map((t) => t.length)) * charW, h }
    })
    spread(ls, 1, H - 1, cy)
    return ls
  }, [layout, W, H, cx, cy, R, maxChars, lineH, charW])

  const pt = (v: number | null | undefined, angle: number) => {
    if (typeof v !== 'number') return null
    return polar(cx, cy, (R * Math.max(0, Math.min(max, v))) / max, angle)
  }
  /** Chemin du tracé (coupé là où une valeur manque ; fermé s'il ne manque rien). */
  const pathOf = (s: RadarSeries) => {
    const pts = layout.axes.map((a) => pt(s.values[index.get(a.id)!], a.angle))
    if (pts.every(Boolean)) return 'M' + pts.map((p) => p!.join(',')).join('L') + 'Z'
    let d = ''
    let pen = false
    pts.forEach((p) => {
      if (!p) pen = false
      else {
        d += (pen ? 'L' : 'M') + p.join(',')
        pen = true
      }
    })
    return d
  }

  const sectors = layout.sectors
  // Légende dans l'ordre du cadran, en partant du haut.
  const turn = (a: { start: number; end: number }) => ((a.start + a.end) / 2 + 45 + 720) % 360
  const sectorLegend = [...sectors].sort((a, b) => turn(a) - turn(b))
  const values = (s: RadarSeries) => layout.axes.map((a) => s.values[index.get(a.id)!])
  const fmt = (v: number | null | undefined) => (typeof v === 'number' ? (Math.round(v * 10) / 10).toString().replace('.', ',') : '—')

  return (
    <div>
      <div ref={ref} className={`mx-auto w-full ${size === 'large' ? 'max-w-[46rem]' : ''}`} style={{ height: H || maxHeight(size) }}>
        {W > 0 && H > 0 && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Radar : ${layout.axes.map((a) => a.label).join(', ')}`} className="block overflow-visible">
            <defs>
              {sectors.map((s, i) => (
                <clipPath key={i} id={`${uid}-s${i}`}>
                  <path d={wedge(cx, cy, R + 4, s.start, s.end)} />
                </clipPath>
              ))}
            </defs>
            {/* Fonds des secteurs */}
            {sectors.map((s, i) => (
              <path key={i} d={wedge(cx, cy, R, s.start, s.end)} fill={s.color} fillOpacity={0.08} />
            ))}
            {/* Cercles 1 à 5 et branches */}
            {Array.from({ length: max }, (_, i) => (
              <circle key={i} cx={cx} cy={cy} r={(R * (i + 1)) / max} fill="none" style={{ stroke: 'var(--color-line)' }} strokeWidth={i + 1 === max ? 1 : 0.7} />
            ))}
            {layout.axes.map((a) => {
              const [x, y] = polar(cx, cy, R, a.angle)
              return <line key={a.id} x1={cx} y1={cy} x2={x} y2={y} style={{ stroke: 'var(--color-line)' }} strokeWidth={0.7} />
            })}
            {/* Tracés */}
            {series.map((s) => {
              const d = pathOf(s)
              if (s.mode === 'zones')
                return (
                  <g key={s.key}>
                    {sectors.map((sec, i) => (
                      <path key={i} d={d} clipPath={`url(#${uid}-s${i})`} fill={sec.color} fillOpacity={s.fillOpacity ?? 0.5} stroke="none" />
                    ))}
                    <path d={d} fill="none" style={{ stroke: 'var(--color-fg)' }} strokeWidth={s.strokeWidth ?? 1.8} strokeLinejoin="round" />
                    {layout.axes.map((a, i) => {
                      const v = values(s)[i]
                      const p = pt(v, a.angle)
                      return (
                        p && (
                          <circle key={a.id} cx={p[0]} cy={p[1]} r={size === 'compact' ? 2.6 : 3.2} fill={sectors[a.sector].color} style={{ stroke: 'var(--color-panel)' }} strokeWidth={1}>
                            <title>
                              {a.label} : {fmt(v)}
                            </title>
                          </circle>
                        )
                      )
                    })}
                  </g>
                )
              // Contour d'un observateur : petits points à ses notes (une note isolée, sans voisine notée, reste visible).
              if (s.mode === 'line')
                return (
                  <g key={s.key}>
                    <path d={d} fill="none" stroke={s.color} strokeOpacity={s.strokeOpacity ?? 1} strokeWidth={s.strokeWidth ?? 1.2} strokeLinejoin="round">
                      <title>{s.name}</title>
                    </path>
                    {layout.axes.map((a, i) => {
                      const v = values(s)[i]
                      const p = pt(v, a.angle)
                      return (
                        p && (
                          <circle key={a.id} cx={p[0]} cy={p[1]} r={size === 'compact' ? 2 : 2.4} fill={s.color}>
                            <title>
                              {s.name} · {a.label} : {fmt(v)}
                            </title>
                          </circle>
                        )
                      )
                    })}
                  </g>
                )
              return (
                <path
                  key={s.key}
                  d={d}
                  fill={s.mode === 'fill' ? s.color : 'none'}
                  fillOpacity={s.fillOpacity ?? 0.2}
                  stroke={s.color}
                  strokeOpacity={s.strokeOpacity ?? 1}
                  strokeWidth={s.strokeWidth ?? (s.mode === 'fill' ? 2 : 1.2)}
                  strokeLinejoin="round"
                >
                  <title>{s.name}</title>
                </path>
              )
            })}
            {/* Libellés des branches */}
            {labels.map((l, i) => (
              <text key={i} x={l.x} y={l.y - l.h / 2 + lineH / 2} textAnchor={l.anchor} dominantBaseline="central" fontSize={f} style={{ fill: 'var(--color-muted)' }}>
                {l.text.map((t, j) => (
                  <tspan key={j} x={l.x} dy={j ? lineH : 0}>
                    {t}
                  </tspan>
                ))}
                {l.full !== l.text.join(' ') && <title>{l.full}</title>}
              </text>
            ))}
          </svg>
        )}
      </div>
      <ul className={`mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 ${size === 'large' ? 'text-[11px]' : 'text-[10px]'} text-muted`}>
        {sectorLegend.map((s) => (
          <li key={s.category} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            {s.category}
          </li>
        ))}
        {legend.map((l) => (
          <li key={l.name} className="flex items-center gap-1">
            <span className={l.line ? 'h-0.5 w-3.5 shrink-0 rounded' : 'h-2.5 w-2.5 shrink-0 rounded-full'} style={{ background: l.color }} />
            {l.name}
          </li>
        ))}
      </ul>
    </div>
  )
}
