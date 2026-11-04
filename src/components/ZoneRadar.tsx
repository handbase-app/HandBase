import { useCallback, useId, useMemo, useState, type KeyboardEvent, type MouseEvent, type RefCallback } from 'react'
import { layoutRadar, polar, smoothPath, styleOf, wrapLabel, type CategoryStyle, type RadarAxis } from '../radarZones'
import { TONE_COLOR, type Tone } from '../opinionProgress'
import { sameNoteOffsets, spreadOf, type MarkShape } from '../opinionSpread'
import { useMedia } from '../layout'
import { ObsMark, SpreadScale } from './SpreadMarks'

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
 * Progression des avis (`progress`, src/components/OpinionsProgress.tsx) : forme de départ en pointillés gris, forme
 * d'arrivée en trait plein, entre les deux la zone gagnée en vert (arrivée moins départ, par masque) et la zone perdue en
 * rouge (départ moins arrivée ; gris neutre côté jeune) ; sous chaque libellé, une ligne colorée (`notes` : « 1 → 4 ↗ ») ;
 * un toucher sur un libellé (`onAxis`) ouvre la bulle du critère. Secteurs teintés et points de couleur de famille gardés.
 * Écarts entre observateurs sur un événement (`spread`, src/components/OpinionsSpread.tsx) : moyenne en trait plein ; le
 * long de chaque branche, une bande de la note la plus basse à la plus haute, couleur du niveau d'écart (accord : pas de
 * bande) ; le repère de chaque observateur (forme et couleur) à sa note ; sous le libellé, « 1 à 5 · gros écart » coloré.
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
/** Point touché (bulle ancrée là, pointe vers le doigt) : abscisse, haut et bas de la zone touchée, à l'écran. */
export interface AxisAnchor {
  x: number
  top: number
  bottom: number
}
/**
 * Ligne sous un libellé : couleur du ton (progression), ou `color` imposée (écarts) ; `short` : à la place de `text` sur
 * les petits radars d'une famille (« 1 à 5 » plutôt que « 1 à 5 · gros écart » : la couleur dit le niveau).
 */
type AxisNote = { text: string; tone: Tone; color?: string; short?: string } | null | undefined
const noteColor = (n: NonNullable<AxisNote>) => n.color ?? TONE_COLOR[n.tone]

/** Écarts entre observateurs (un événement) : par branche, dans l'ordre de `axes`. */
export interface RadarSpread {
  /** Repère de chaque observateur. */
  marks: { name: string; color: string; shape: MarkShape }[]
  /** Par branche : la note de chaque observateur (ordre de `marks`). */
  values: (number | null | undefined)[][]
  /** Par branche : la moyenne des observateurs (trait plein). */
  mean: (number | null | undefined)[]
  /** Par branche : couleur de la bande min → max (null : accord, pas de bande). */
  band: (string | null)[]
}
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
  note?: AxisNote
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
  w: number
  h: number
}

/** Écarte verticalement les libellés qui se chevauchent (sans sortir du cadre). */
function spreadLabels(labels: Label[], top: number, bottom: number, mid: number) {
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
    if (!moved) return
  }
  // Toujours des chevauchements (beaucoup de branches, libellés sur trois lignes avec la progression) : balayage de haut
  // en bas (chaque libellé sous ceux qui le recouvrent), puis de bas en haut s'il déborde du cadre.
  const ord = [...labels].sort((a, b) => a.y - b.y)
  const hit = (a: Label, b: Label) => {
    const p = box(a)
    const q = box(b)
    return !(p.x1 + 2 <= q.x0 || q.x1 + 2 <= p.x0)
  }
  for (let j = 0; j < ord.length; j++)
    for (let i = 0; i < j; i++) if (hit(ord[i], ord[j])) ord[j].y = Math.max(ord[j].y, ord[i].y + (ord[i].h + ord[j].h) / 2 + 1)
  for (let j = ord.length - 1; j >= 0; j--) {
    ord[j].y = Math.min(ord[j].y, bottom - ord[j].h / 2)
    for (let i = ord.length - 1; i > j; i--) if (hit(ord[i], ord[j])) ord[j].y = Math.min(ord[j].y, ord[i].y - (ord[i].h + ord[j].h) / 2 - 1)
  }
}

const wedge = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  if (a1 - a0 >= 359.999) return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  return `M${cx},${cy}L${x0},${y0}A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0},1 ${x1},${y1}Z`
}

/** Entrée de légende : trait (`line`, `dashed`), pastille, ou un signe à la place (`mark`). */
export interface LegendItem {
  name: string
  color: string
  line?: boolean
  dashed?: boolean
  mark?: string
}

interface RadarProps {
  axes: RadarAxis[]
  styles: Map<string, CategoryStyle>
  series: RadarSeries[]
  size?: Size
  max?: number
  /** Entrées de légende en plus des catégories (tracés : moyenne, observateurs…). */
  legend?: LegendItem[]
  /** Vue imposée : radar complet ou un radar par catégorie ; sans valeur, selon l'écran (par catégorie sur téléphone). */
  view?: 'full' | 'split'
  /** Progression : notes au départ et à l'arrivée (ordre de `axes`) ; `neutralLoss` : zone perdue en gris (côté jeune). */
  progress?: { from: (number | null | undefined)[]; to: (number | null | undefined)[]; neutralLoss?: boolean }
  /** Ligne colorée sous chaque libellé (ordre de `axes`). */
  notes?: AxisNote[]
  /** Toucher le libellé d'une branche (indice dans `axes`). */
  onAxis?: (i: number, at: AxisAnchor) => void
  /** Vue par famille : note sous le titre de chaque famille (indices de ses branches dans `axes`). */
  groupNote?: (idx: number[]) => AxisNote
  /** Écarts entre observateurs sur un événement (moyenne, bandes min → max, repères). */
  spread?: RadarSpread
}

/** Point touché d'un libellé : au doigt (souris, toucher), sinon (clavier) sous le libellé. */
const anchorOf = (ev: MouseEvent | KeyboardEvent): AxisAnchor => {
  const r = (ev.currentTarget as Element).getBoundingClientRect()
  if ('clientX' in ev && (ev.clientX || ev.clientY)) return { x: ev.clientX, top: ev.clientY - 4, bottom: ev.clientY + 4 }
  return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom }
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
function SplitRadar({ axes, styles, series, max = 5, legend = [], grid = false, progress, notes, onAxis, groupNote, spread }: RadarProps & { grid?: boolean }) {
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
  // Petits radars : la forme courte des lignes sous les libellés, s'il y en a une.
  const small = notes?.map((n) => (n?.short ? { ...n, text: n.short } : n))
  // Grille (vue imposée) : même place des libellés pour tous les radars (le plus long de tous), donc même taille.
  const labelChars = grid ? Math.max(...axes.map((a, i) => Math.max(twoLines(a.label), small?.[i]?.text.length ?? 0))) : undefined
  const cards = groups.map((g) => {
    const gAxes = g.idx.map((i) => axes[i])
    const gSeries = series.map((s) => ({ ...s, values: g.idx.map((i) => s.values[i]) }))
    const gProgress = progress && { ...progress, from: g.idx.map((i) => progress.from[i]), to: g.idx.map((i) => progress.to[i]) }
    const gNotes = notes && g.idx.map((i) => notes[i])
    const gSpread = spread && { ...spread, values: g.idx.map((i) => spread.values[i]), mean: g.idx.map((i) => spread.mean[i]), band: g.idx.map((i) => spread.band[i]) }
    const gNote = groupNote?.(g.idx)
    return (
      <section
        key={g.category}
        className={`border-t border-line pt-2 first:border-t-0 first:pt-0 ${grid ? 'sm:rounded-lg sm:border sm:p-2 sm:first:border-t sm:first:pt-2' : ''}`}
        aria-label={g.category || 'Critères'}
      >
        <h4 className="flex items-center gap-1.5 text-xs font-bold">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: g.color }} />
          {g.category || 'Autres critères'}
          {/* Progression : moyenne des critères de la famille, du départ à l'arrivée. */}
          {gNote && (
            <span className="ml-auto text-[11px] font-extrabold whitespace-nowrap tabular-nums" style={{ color: noteColor(gNote) }}>
              {gNote.text}
            </span>
          )}
        </h4>
        {gAxes.length >= 3 ? (
          <FullRadar
            axes={gAxes}
            styles={styles}
            series={gSeries}
            max={max}
            font={11}
            labelChars={labelChars}
            bare
            progress={gProgress}
            notes={small && g.idx.map((i) => small[i])}
            spread={gSpread}
            onAxis={onAxis && ((j, at) => onAxis(g.idx[j], at))}
          />
        ) : gSpread ? (
          // Moins de 3 branches, écarts : l'échelle 1 à 5 de chaque critère (repères, bande, moyenne), niveau dessous.
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {gAxes.map((a, j) => {
              const note = gNotes?.[j]
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-0.5 text-left"
                    onClick={onAxis && ((ev) => onAxis(g.idx[j], anchorOf(ev)))}
                    disabled={!onAxis}
                  >
                    <span className="flex items-baseline justify-between gap-2 text-xs">
                      {a.label}
                      {note && (
                        <b className="text-[11px] whitespace-nowrap tabular-nums" style={{ color: noteColor(note) }}>
                          {note.text}
                        </b>
                      )}
                    </span>
                    <SpreadScale
                      vals={gSpread.values[j]}
                      colors={gSpread.marks.map((m) => m.color)}
                      shapes={gSpread.marks.map((m) => m.shape)}
                      names={gSpread.marks.map((m) => m.name)}
                      sp={spreadOf(gSpread.values[j])}
                      hi={max}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : gProgress ? (
          // Moins de 3 branches, en progression : barre de l'arrivée, trait au départ, écart dessous.
          <ul className="mt-1.5 flex flex-col gap-2">
            {gAxes.map((a, j) => {
              const to = gProgress.to[j]
              const from = gProgress.from[j]
              const note = gNotes?.[j]
              const pct = (v: number) => `${(Math.max(0, Math.min(max, v)) / max) * 100}%`
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-0.5 text-left"
                    onClick={onAxis && ((ev) => onAxis(g.idx[j], anchorOf(ev)))}
                    disabled={!onAxis}
                  >
                    <span className="flex items-baseline justify-between gap-2 text-xs">
                      {a.label}
                      {note && (
                        <b className="text-[11px] whitespace-nowrap tabular-nums" style={{ color: noteColor(note) }}>
                          {note.text}
                        </b>
                      )}
                    </span>
                    <span className="relative h-2 w-full rounded-full bg-panel-2">
                      {typeof to === 'number' && <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(to), background: g.color }} />}
                      {typeof from === 'number' && <span aria-hidden className="absolute -inset-y-0.5 w-0.5 rounded bg-muted" style={{ left: pct(from) }} />}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
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
        // Grille (onglet « Par famille ») : légende des tracés plus lisible, une seule pour tous les radars.
        <ul className={`flex flex-wrap justify-center gap-x-3 gap-y-1 ${grid ? 'gap-x-4 text-xs font-bold' : 'text-[11px] text-muted'}`}>
          {legend.map((l) => (
            <li key={l.name} className="flex items-center gap-1">
              <LegendMark l={l} big={grid} />
              {l.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Repère d'une entrée de légende : trait (plein ou pointillé), pastille, ou signe (« ↕ »). */
function LegendMark({ l, big = false }: { l: LegendItem; big?: boolean }) {
  if (l.mark) return <span aria-hidden className="font-bold">{l.mark}</span>
  if (l.dashed) return <span aria-hidden className="w-3.5 shrink-0 border-t-2 border-dashed" style={{ borderColor: l.color }} />
  return <span aria-hidden className={l.line ? 'h-0.5 w-3.5 shrink-0 rounded' : `${big ? 'h-3 w-3' : 'h-2.5 w-2.5'} shrink-0 rounded-full`} style={{ background: l.color }} />
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
  progress,
  notes: allNotes,
  onAxis,
  spread,
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
  // Petit radar (famille, téléphone) : forme courte des lignes sous les libellés, s'il y en a une (plus de place au cercle).
  const shortNotes = !!font || (W > 0 && W < 480)
  const notes = useMemo(() => (shortNotes ? allNotes?.map((n) => (n?.short ? { ...n, text: n.short } : n)) : allNotes), [allNotes, shortNotes])
  const layout = useMemo(() => layoutRadar(axes, styles), [axes, styles])
  const index = useMemo(() => new Map(axes.map((a, i) => [a.id, i])), [axes])

  // Police à chasse fixe de l'appli : ~0,6 em par caractère.
  // Grille de petits radars (place des libellés imposée) : libellés plus petits dans une case étroite (< 300 px).
  const f = (font && labelChars && W < 300 ? font - 2 : font) ?? (size === 'large' ? 11 : W < 420 ? 9 : 10)
  const lineH = Math.round(f * 1.2)
  const charW = f * 0.6
  // Petit radar d'une catégorie (téléphone) : place des libellés au plus juste (le plus long, coupé en deux lignes
  // équilibrées), pour garder le plus grand rayon possible.
  const needW = font ? (labelChars ?? Math.max(...axes.map((a, i) => Math.max(twoLines(a.label), notes?.[i]?.text.length ?? 0)))) * charW + 2 : 0
  const labelW = font ? Math.max(40, Math.min(W * 0.34, needW)) : Math.max(60, Math.min(size === 'large' ? 140 : 120, W * 0.24))
  const maxChars = Math.max(6, Math.floor(labelW / charW))
  const maxH = maxHeight(size)
  // Rayon limité par la largeur (téléphone) ou la hauteur ; hauteur réduite à ce qu'il faut (pas de vide). Ligne de
  // progression sous les libellés : une ligne de plus en haut et en bas.
  const extra = notes ? 1 : 0
  const R = Math.max(30, Math.min(W / 2 - labelW - 10, maxH / 2 - (3 + extra) * lineH - 6))
  // Avec la ligne de progression, de la place en plus en haut et en bas pour écarter les libellés serrés (beaucoup de branches).
  const room = notes ? (font ? 2 : 4) * lineH : 0
  const H = W ? Math.min(maxH + 2 * extra * lineH + room, Math.round(2 * R + (font ? (4 + 2 * extra) * lineH + 20 : (6 + 2 * extra) * lineH + 16) + room)) : 0
  const cx = W / 2
  const cy = H / 2

  const labels: Label[] = useMemo(() => {
    if (!W || !H) return []
    const ls = layout.axes.map((a): Label => {
      const text = wrapLabel(a.label, maxChars)
      const note = notes?.[index.get(a.id)!]
      const s = Math.sin((a.angle * Math.PI) / 180)
      const c = Math.cos((a.angle * Math.PI) / 180)
      const [x, y] = polar(cx, cy, R + 7, a.angle)
      const h = (text.length + (note?.text ? 1 : 0)) * lineH
      const anchor = Math.abs(s) < 0.08 ? 'middle' : s > 0 ? 'start' : 'end'
      // Près du haut / du bas : le bloc de texte posé au-dessus / au-dessous de la pointe.
      const dy = c > 0.8 ? -h / 2 + 2 : c < -0.8 ? h / 2 - 2 : 0
      return { text, full: a.label, note, x, y: y + dy, anchor, w: Math.max(...text.map((t) => t.length), note?.text.length ?? 0) * charW, h }
    })
    spreadLabels(ls, 1, H - 1, cy)
    return ls
  }, [layout, index, notes, W, H, cx, cy, R, maxChars, lineH, charW])

  const pt = (v: number | null | undefined, angle: number) => {
    if (typeof v !== 'number') return null
    return polar(cx, cy, (R * Math.max(0, Math.min(max, v))) / max, angle)
  }
  /**
   * Chemin du tracé, arrondi (Bézier « moyenne », src/radarZones.ts smoothPath) : fermé s'il ne manque rien, sinon un
   * morceau par suite de valeurs connues (coupé là où une valeur manque). Les points restent sur les notes.
   */
  const pathOf = (s: RadarSeries) => pathFor(values(s))
  /** Même chemin, d'après des valeurs dans l'ordre du cadran (`layout.axes`). */
  const pathFor = (vals: (number | null | undefined)[]) => {
    const pts = layout.axes.map((a, i) => pt(vals[i], a.angle))
    if (pts.every(Boolean)) return smoothPath(pts as [number, number][], true)
    const runs: [number, number][][] = []
    let run: [number, number][] = []
    pts.forEach((p) => {
      if (p) run.push(p as [number, number])
      else if (run.length) runs.push(run), (run = [])
    })
    if (run.length) runs.push(run)
    return runs.map((r) => smoothPath(r, false)).join('')
  }

  const sectors = layout.sectors
  /**
   * Formes de la progression. Zones par masques : gagné = arrivée privée du départ, perdu = départ privé de l'arrivée.
   * Critère pas encore noté au départ : sa note d'arrivée tient lieu de départ pour les zones (ni gagné ni perdu), le
   * pointillé du départ est coupé à cet endroit.
   */
  const progressShapes = (p: NonNullable<RadarProps['progress']>) => {
    const from = layout.axes.map((a) => p.from[index.get(a.id)!])
    const to = layout.axes.map((a) => p.to[index.get(a.id)!])
    const dTo = pathFor(to)
    const dFromZ = pathFor(from.map((v, i) => (typeof v === 'number' ? v : to[i])))
    return (
      <g>
        <defs>
          <mask id={`${uid}-gain`} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
            <rect x={0} y={0} width={W} height={H} fill="white" />
            <path d={dFromZ} fill="black" />
          </mask>
          <mask id={`${uid}-loss`} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
            <rect x={0} y={0} width={W} height={H} fill="white" />
            <path d={dTo} fill="black" />
          </mask>
        </defs>
        <path d={dTo} style={{ fill: 'var(--color-fg)' }} fillOpacity={0.05} />
        <path d={dTo} style={{ fill: TONE_COLOR.up }} fillOpacity={0.5} mask={`url(#${uid}-gain)`} />
        <path d={dFromZ} style={{ fill: p.neutralLoss ? TONE_COLOR.flat : TONE_COLOR.down }} fillOpacity={p.neutralLoss ? 0.22 : 0.42} mask={`url(#${uid}-loss)`} />
        <path d={pathFor(from)} fill="none" style={{ stroke: 'var(--color-muted)' }} strokeWidth={1.5} strokeDasharray="5 4" strokeLinejoin="round">
          <title>Départ</title>
        </path>
        <path d={dTo} fill="none" style={{ stroke: 'var(--color-fg)' }} strokeWidth={1.8} strokeLinejoin="round">
          <title>Arrivée</title>
        </path>
        {layout.axes.map((a, i) => {
          const q = pt(to[i], a.angle)
          return (
            q && (
              <circle key={a.id} cx={q[0]} cy={q[1]} r={size === 'compact' ? 2.6 : 3.2} fill={sectors[a.sector].color} style={{ stroke: 'var(--color-panel)' }} strokeWidth={1}>
                <title>
                  {a.label} : {fmt(from[i])} → {fmt(to[i])}
                </title>
              </circle>
            )
          )
        })}
      </g>
    )
  }
  /**
   * Écarts entre observateurs : bandes min → max (secteur d'anneau centré sur la branche, un tiers de l'angle jusqu'aux
   * voisines de chaque côté), moyenne en trait plein, repères des observateurs (côte à côte sur une même note).
   */
  const spreadShapes = (sp: RadarSpread) => {
    const n = layout.axes.length
    const gapTo = (i: number, j: number) => {
      const d = Math.abs(layout.axes[i].angle - layout.axes[j].angle) % 360
      return Math.min(d, 360 - d)
    }
    const half = (i: number) => Math.min(10, 0.31 * Math.min(gapTo(i, (i + n - 1) % n), gapTo(i, (i + 1) % n)))
    const ring = (r0: number, r1: number, a0: number, a1: number) => {
      const [x0, y0] = polar(cx, cy, r0, a0)
      const [x1, y1] = polar(cx, cy, r0, a1)
      const [x2, y2] = polar(cx, cy, r1, a1)
      const [x3, y3] = polar(cx, cy, r1, a0)
      return `M${x0},${y0}A${r0},${r0} 0 0,1 ${x1},${y1}L${x2},${y2}A${r1},${r1} 0 0,0 ${x3},${y3}Z`
    }
    const rOf = (v: number) => (R * Math.max(0, Math.min(max, v))) / max
    const mr = size === 'compact' ? 3 : font ? 3.2 : 3.7
    const mean = layout.axes.map((a) => sp.mean[index.get(a.id)!])
    const dMean = pathFor(mean)
    return (
      <g>
        {layout.axes.map((a, i) => {
          const k = index.get(a.id)!
          const col = sp.band[k]
          const vs = sp.values[k].filter((v): v is number => typeof v === 'number')
          if (!col || vs.length < 2) return null
          const lo = Math.min(...vs)
          const hi = Math.max(...vs)
          const w = half(i)
          return (
            <path key={a.id} d={ring(rOf(lo), rOf(hi), a.angle - w, a.angle + w)} style={{ fill: col, stroke: col }} fillOpacity={0.4} strokeWidth={1}>
              <title>
                {a.label} : {fmt(lo)} à {fmt(hi)}
              </title>
            </path>
          )
        })}
        <path d={dMean} style={{ fill: 'var(--color-fg)', stroke: 'var(--color-fg)' }} fillOpacity={0.04} strokeWidth={1.9} strokeLinejoin="round">
          <title>Moyenne</title>
        </path>
        {layout.axes.map((a) => {
          const k = index.get(a.id)!
          const vals = sp.values[k]
          const off = sameNoteOffsets(vals)
          const rad = (a.angle * Math.PI) / 180
          // Décalage le long de la tangente (perpendiculaire à la branche).
          const tx = Math.cos(rad)
          const ty = Math.sin(rad)
          return (
            <g key={a.id}>
              {vals.map((v, o) => {
                const q = pt(v, a.angle)
                const m = sp.marks[o]
                if (!q || !m) return null
                const d = off[o] * mr * 2.1
                return <ObsMark key={o} x={q[0] + tx * d} y={q[1] + ty * d} r={mr} shape={m.shape} color={m.color} title={`${m.name} · ${a.label} : ${fmt(v)}`} />
              })}
            </g>
          )
        })}
      </g>
    )
  }
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
            {/* Progression : arrivée (fond léger), gagné (vert), perdu (rouge ou gris), départ en pointillés, arrivée en trait plein. */}
            {progress && progressShapes(progress)}
            {/* Écarts entre observateurs : bandes, moyenne, repères. */}
            {spread && spreadShapes(spread)}
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
            {/* Libellés des branches (progression : écart dessous, en couleur ; un toucher ouvre la bulle du critère) */}
            {labels.map((l, i) => {
              const text = (
                <text x={l.x} y={l.y - l.h / 2 + lineH / 2} textAnchor={l.anchor} dominantBaseline="central" fontSize={f} style={{ fill: 'var(--color-muted)' }}>
                  {l.text.map((t, j) => (
                    <tspan key={j} x={l.x} dy={j ? lineH : 0}>
                      {t}
                    </tspan>
                  ))}
                  {l.note?.text && (
                    <tspan x={l.x} dy={lineH} fontWeight={700} style={{ fill: noteColor(l.note) }}>
                      {l.note.text}
                    </tspan>
                  )}
                  {l.full !== l.text.join(' ') && <title>{l.full}</title>}
                </text>
              )
              if (!onAxis) return <g key={i}>{text}</g>
              const k = index.get(layout.axes[i].id)!
              return (
                <g
                  key={i}
                  role="button"
                  tabIndex={0}
                  aria-label={`${l.full}${l.note?.text ? ' : ' + l.note.text : ''}`}
                  className="cursor-pointer outline-none [&:focus-visible_text]:underline [&:hover_text]:underline"
                  data-axe={layout.axes[i].id}
                  onClick={(ev) => onAxis(k, anchorOf(ev))}
                  onKeyDown={(ev) => {
                    if (ev.key !== 'Enter' && ev.key !== ' ') return
                    ev.preventDefault()
                    onAxis(k, anchorOf(ev))
                  }}
                >
                  {/* Zone de toucher un peu plus large que le texte. */}
                  <rect
                    x={(l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - l.w : l.x - l.w / 2) - 4}
                    y={l.y - l.h / 2 - 3}
                    width={l.w + 8}
                    height={l.h + 6}
                    fill="transparent"
                  />
                  {text}
                </g>
              )
            })}
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
            <LegendMark l={l} />
            {l.name}
          </li>
        ))}
      </ul>
      )}
    </div>
  )
}
