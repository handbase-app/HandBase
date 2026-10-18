import { useCallback, useId, useMemo, useState, type RefCallback } from 'react'
import { layoutRadar, polar, styleOf, wrapLabel, type CategoryStyle, type RadarAxis } from '../radarZones'
import { useMedia } from '../layout'

/*
 * Radar « par zones » (src/radarZones.ts), dessiné en SVG : chaque catégorie occupe son secteur (fond à peine teinté
 * de sa couleur), branches régulières dans le secteur, cercles 1 à 5. Tracés :
 *  - « zones » : polygone rempli, dans chaque secteur, de la couleur de la catégorie (découpé par secteur), contour
 *    couleur du texte, points aux sommets couleur de la catégorie (moyenne des avis) ;
 *  - « fill » : polygone d'une seule couleur, translucide (un joueur dans la comparaison) ;
 *  - « line » : contour seul et petits points à ses notes, sans remplissage (un observateur affiché à la demande).
 * Légende des catégories (et des tracés donnés dans `legend`) sous le radar. Libellés coupés sur deux lignes et
 * écartés les uns des autres pour ne pas se chevaucher.
 * Téléphone (< 640 px) : un petit radar par catégorie, empilés, libellés en 11 px ; une catégorie de moins de 3
 * branches devient une liste de barres. Ordinateur : le radar complet. `view` impose l'une ou l'autre vue (onglets
 * « Complet » / « Par famille » de la comparaison) ; « par famille » sur un écran large : grille de radars de même
 * taille, autant de colonnes (240 px au moins, 3 au plus) que la largeur disponible en donne.
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

interface RadarProps {
  axes: RadarAxis[]
  styles: Map<string, CategoryStyle>
  series: RadarSeries[]
  size?: Size
  max?: number
  /** Entrées de légende en plus des catégories (tracés : moyenne, observateurs…). */
  legend?: { name: string; color: string; line?: boolean }[]
  /** Vue imposée : radar complet ou un radar par catégorie ; sans valeur, selon l'écran (par catégorie sur téléphone). */
  view?: 'full' | 'split'
}

/** Téléphone tenu droit : radar découpé par catégorie. */
const PHONE = '(max-width: 639.98px)'

export default function ZoneRadar(props: RadarProps) {
  const phone = useMedia(PHONE)
  const split = (props.view ?? (phone ? 'split' : 'full')) === 'split'
  return split && props.axes.length ? <SplitRadar {...props} grid={!!props.view} /> : <FullRadar {...props} />
}

/**
 * Téléphone : une carte par catégorie (dans l'ordre d'apparition des critères), avec son petit radar (libellés 11 px)
 * ou, à moins de 3 branches, une barre par critère et par tracé. Légende des tracés une fois, dessous.
 */
function SplitRadar({ axes, styles, series, max = 5, legend = [], grid = false }: RadarProps & { grid?: boolean }) {
  const groups = useMemo(() => {
    const gs: { category: string; color: string; idx: number[] }[] = []
    axes.forEach((a, i) => {
      let g = gs.find((x) => x.category === a.category)
      if (!g) gs.push((g = { category: a.category, color: styleOf(styles, a.category).color, idx: [] }))
      g.idx.push(i)
    })
    return gs
  }, [axes, styles])
  const fmt = (v: number | null | undefined) => (typeof v === 'number' ? (Math.round(v * 10) / 10).toString().replace('.', ',') : '—')
  // Grille (vue imposée) : même place des libellés pour tous les radars (le plus long de tous), donc même taille.
  const labelChars = grid ? Math.max(...axes.map((a) => twoLines(a.label))) : undefined
  const cards = groups.map((g) => {
    const gAxes = g.idx.map((i) => axes[i])
    const gSeries = series.map((s) => ({ ...s, values: g.idx.map((i) => s.values[i]) }))
    return (
      <section
        key={g.category}
        className={`border-t border-line pt-2 first:border-t-0 first:pt-0 ${grid ? 'sm:rounded-lg sm:border sm:p-2 sm:first:border-t sm:first:pt-2' : ''}`}
        aria-label={g.category || 'Critères'}
      >
        <h4 className="flex items-center gap-1.5 text-xs font-bold">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
          {g.category || 'Autres critères'}
        </h4>
        {gAxes.length >= 3 ? (
          <FullRadar axes={gAxes} styles={styles} series={gSeries} max={max} font={11} labelChars={labelChars} bare />
        ) : (
          <ul className="mt-1.5 flex flex-col gap-2">
            {gAxes.map((a, j) => (
              <li key={a.id} className="flex flex-col gap-0.5">
                <span className="text-xs">{a.label}</span>
                {gSeries.map((s) => {
                  const v = s.values[j]
                  const color = s.mode === 'zones' ? g.color : s.color
                  return (
                    <span key={s.key} className="flex items-center gap-2" title={`${s.name} · ${a.label} : ${fmt(v)}`}>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
                        {typeof v === 'number' && (
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${(Math.max(0, Math.min(max, v)) / max) * 100}%`, background: color, opacity: s.mode === 'fill' ? Math.max(0.35, s.strokeOpacity ?? 1) : 1 }}
                          />
                        )}
                      </span>
                      <span className="w-7 shrink-0 text-right text-[11px] font-bold tabular-nums">{fmt(v)}</span>
                    </span>
                  )
                })}
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  })
  return (
    <div className="flex flex-col gap-2 pt-1">
      {grid ? (
        // Autant de colonnes que la place en donne (cases de 240 px au moins), 3 au plus : plus étroit, les libellés ne
        // laissent plus qu'un radar minuscule. Cartes encadrées hors téléphone (comme avant sur téléphone : séparées d'un trait).
        <div className="grid grid-cols-[repeat(auto-fill,minmax(max(min(100%,240px),calc((100%-1rem)/3)),1fr))] items-start gap-2">{cards}</div>
      ) : (
        cards
      )}
      {legend.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-muted">
          {legend.map((l) => (
            <li key={l.name} className="flex items-center gap-1">
              <span className={l.line ? 'h-0.5 w-3.5 shrink-0 rounded' : 'h-2.5 w-2.5 shrink-0 rounded-full'} style={{ background: l.color }} />
              {l.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Longueur (caractères) de la plus longue ligne d'un libellé coupé en deux lignes équilibrées. */
function twoLines(label: string) {
  const words = label.split(/\s+/)
  let best = label.length
  for (let i = 1; i < words.length; i++) best = Math.min(best, Math.max(words.slice(0, i).join(' ').length, words.slice(i).join(' ').length))
  return best
}

function FullRadar({
  axes,
  styles,
  series,
  size = 'normal',
  max = 5,
  legend = [],
  font,
  labelChars,
  bare = false,
}: RadarProps & {
  /** Place des libellés (caractères de la plus longue ligne) imposée : radars d'une grille de même taille. */
  labelChars?: number
  /** Taille des libellés imposée (px). */
  font?: number
  /** Sans légende (radar d'une seule catégorie, sous son titre). */
  bare?: boolean
}) {
  const uid = 'zr' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [ref, { w: W }] = useBox<HTMLDivElement>()
  const layout = useMemo(() => layoutRadar(axes, styles), [axes, styles])
  const index = useMemo(() => new Map(axes.map((a, i) => [a.id, i])), [axes])

  // Police à chasse fixe de l'appli : ~0,6 em par caractère.
  // Grille de petits radars (place des libellés imposée) : libellés plus petits dans une case étroite (< 300 px).
  const f = (font && labelChars && W < 300 ? font - 2 : font) ?? (size === 'large' ? 11 : W < 420 ? 9 : 10)
  const lineH = Math.round(f * 1.2)
  const charW = f * 0.6
  // Petit radar d'une catégorie (téléphone) : place des libellés au plus juste (le plus long, coupé en deux lignes
  // équilibrées), pour garder le plus grand rayon possible.
  const needW = font ? (labelChars ?? Math.max(...axes.map((a) => twoLines(a.label)))) * charW + 2 : 0
  const labelW = font ? Math.max(40, Math.min(W * 0.34, needW)) : Math.max(60, Math.min(size === 'large' ? 140 : 120, W * 0.24))
  const maxChars = Math.max(6, Math.floor(labelW / charW))
  const maxH = maxHeight(size)
  // Rayon limité par la largeur (téléphone) ou la hauteur ; hauteur réduite à ce qu'il faut (pas de vide).
  const R = Math.max(30, Math.min(W / 2 - labelW - 10, maxH / 2 - 3 * lineH - 6))
  const H = W ? Math.min(maxH, Math.round(2 * R + (font ? 4 * lineH + 20 : 6 * lineH + 16))) : 0
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
      {!bare && (
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
      )}
    </div>
  )
}
