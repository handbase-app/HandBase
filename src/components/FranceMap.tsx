import { geoConicConformal, geoPath } from 'd3-geo'
import type { FeatureCollection, Geometry } from 'geojson'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { regionOfDept, useDepartments } from '../lists'

/*
 * Carte de France des départements, partagée par la vue nationale (src/pages/National.tsx) et le bilan de détection
 * (src/pages/Coverage.tsx). La page donne la couleur de chaque département et le contenu de la bulle ; la carte gère
 * le tracé, le zoom sur une région, le survol et les appuis.
 *
 * Contours des départements : france-geojson de Grégoire David (departements-version-simplifiee.geojson,
 * https://github.com/gregoiredavid/france-geojson), issus d'Admin Express IGN — Licence Ouverte Etalab.
 * Coordonnées arrondies à 3 décimales (src/assets/departements.json, ~220 Ko), chargées à la demande.
 */

// Carte : métropole + Corse, et une case pour l'outre-mer. Toucher une région la montre de plus près
// (projection recalée sur ses départements) ; on y touche ensuite un département.
// La largeur est fixée ; la hauteur suit celle du pays, et reste la même quand on zoome sur une région.
const W = 600
const DOM_W = 132
const DOM_H = 62
/** Territoires ultramarins (pas sur la carte) : une case chacun, dans l'encadré « Ultramarins ». */
const DOM_CODES: [string, string][] = [
  ['971', 'GP'],
  ['972', 'MQ'],
  ['973', 'GF'],
  ['974', 'RE'],
  ['976', 'YT'],
  ['988', 'NC'],
  // Ultramarin sans territoire précis (n° de club « 97… » : department() donne « 97 »).
  ['97', 'OM'],
]
/** Corse : un seul département pour nous (n° de club « 20 »). */
const codeOf = (c: string) => (c === '2A' || c === '2B' ? '20' : c)

type Geo = FeatureCollection<Geometry, { code: string; nom: string }>
type Feature = Geo['features'][number]

interface Shape {
  code: string
  d: string
}

// Fichier à part (pas dans le démarrage de l'appli), lu une seule fois ; mis en cache par le service worker.
let geoLoad: Promise<Geo> | null = null
const loadGeo = () => (geoLoad ??= import('../assets/departements.json?raw').then((m) => JSON.parse(m.default) as Geo))

export function useGeo() {
  const [geo, setGeo] = useState<Geo | null>(null)
  useEffect(() => {
    let alive = true
    void loadGeo().then((g) => {
      if (alive) setGeo(g)
    })
    return () => {
      alive = false
    }
  }, [])
  return geo
}

/** Nom d'un département : la liste des départements (Réglages), sinon celui de la carte (une fois chargée). */
export function useDeptName() {
  const geo = useGeo()
  const lists = useDepartments()
  const geoNames = useMemo(() => {
    const m = new Map<string, string>([
      ['20', 'Corse'],
      ['97', 'Ultramarins (non précisé)'],
      ['971', 'Guadeloupe'],
      ['972', 'Martinique'],
      ['973', 'Guyane'],
      ['974', 'La Réunion'],
      ['976', 'Mayotte'],
      ['988', 'Nouvelle-Calédonie'],
    ])
    for (const f of geo?.features ?? []) if (!m.has(codeOf(f.properties.code))) m.set(codeOf(f.properties.code), f.properties.nom)
    return m
  }, [geo])
  return (code: string) => lists.find((d) => d.code === code)?.name ?? geoNames.get(code) ?? `Département ${code}`
}

/** Anneaux (contours) d'un département, polygone simple ou multiple. */
function rings(f: Feature): number[][][] {
  const g = f.geometry
  if (g.type === 'Polygon') return g.coordinates
  if (g.type === 'MultiPolygon') return g.coordinates.flat()
  return []
}

/**
 * Contour d'un ensemble de départements (une région) : les segments qu'un seul d'entre eux possède.
 * Les frontières communes ont les mêmes points dans le fichier : elles s'annulent deux à deux.
 */
function outline(features: Feature[]): Geometry {
  const key = (a: number[], b: number[]) => {
    const x = `${a[0]},${a[1]}`
    const y = `${b[0]},${b[1]}`
    return x < y ? `${x}|${y}` : `${y}|${x}`
  }
  const count = new Map<string, number>()
  for (const f of features)
    for (const r of rings(f))
      for (let i = 1; i < r.length; i++) {
        const k = key(r[i - 1], r[i])
        count.set(k, (count.get(k) ?? 0) + 1)
      }
  const lines: number[][][] = []
  for (const f of features)
    for (const r of rings(f)) {
      let cur: number[][] | null = null
      for (let i = 1; i < r.length; i++) {
        if (count.get(key(r[i - 1], r[i])) === 1) {
          if (!cur) lines.push((cur = [r[i - 1]]))
          cur.push(r[i])
        } else cur = null
      }
    }
  return { type: 'MultiLineString', coordinates: lines }
}

/** Contour d'un département (survolé, choisi), tracé par-dessus ses voisins. */
function Outline({ shapes, code, width = 1.6 }: { shapes: Shape[]; code?: string; width?: number }) {
  return shapes
    .filter((s) => s.code === code)
    .map((s, i) => <path key={i} d={s.d} fill="none" stroke="var(--color-fg)" strokeWidth={width} strokeLinejoin="round" pointerEvents="none" />)
}

export interface MapTip {
  /** Numéro du département, ou identifiant de la région (« region-… »). */
  code: string
  isRegion: boolean
  /** Bulle posée par un appui (doigt) : elle reste, on peut y toucher un bouton. */
  pinned: boolean
}

export function FranceMap({
  region,
  selected,
  fill,
  onRegion,
  onDept,
  touch = 'confirm',
  tip: tipContent,
  className = '',
  ariaLabel,
}: {
  /** Région montrée de plus près ('' : toute la France). */
  region: string
  /** Département choisi : contour marqué. */
  selected?: string
  /** Couleur d'un département (numéro) ; à la vue France, la page peut y mettre celle de sa région. */
  fill: (code: string) => string
  onRegion: (r: string) => void
  onDept: (code: string) => void
  /**
   * Appui au doigt sur un département : 'confirm' montre d'abord sa bulle, un 2e appui appelle onDept ; 'select' appelle
   * onDept tout de suite et montre la bulle. À la souris, un clic appelle toujours onDept.
   */
  touch?: 'confirm' | 'select'
  /** Contenu de la bulle d'un département ou d'une région. */
  tip: (t: MapTip) => ReactNode
  /** Description de l'image (lecteurs d'écran). */
  ariaLabel?: string
  /** Classes de l'image (hauteur maximale…). */
  className?: string
}) {
  const geo = useGeo()
  const lists = useDepartments()

  // Départements de chaque région et contour des régions : une fois par fichier (et par liste des départements,
  // qui peut changer la région d'un département).
  const regionGeo = useMemo(() => {
    if (!geo) return null
    const by = new Map<string, Feature[]>()
    for (const f of geo.features) {
      const r = regionOfDept(codeOf(f.properties.code))
      if (!r) continue
      const g = by.get(r)
      if (g) g.push(f)
      else by.set(r, [f])
    }
    return { by, lines: new Map([...by].map(([r, fs]) => [r, outline(fs)])) }
  }, [geo, lists]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tracés : France entière, ou la région choisie à plein cadre (ses voisins estompés autour).
  // Recalculés seulement quand la région change ; les couleurs changent seules.
  const shapes = useMemo(() => {
    if (!geo || !regionGeo) return null
    const conic = () => geoConicConformal().parallels([44, 49]).rotate([-3, 0])
    const france = conic().fitWidth(W - 16, geo)
    france.translate([france.translate()[0] + 8, france.translate()[1] + 8])
    const h = Math.ceil(geoPath(france).bounds(geo)[1][1]) + 8
    const inRegion = region ? (regionGeo.by.get(region) ?? []) : []
    const zoomed = inRegion.length > 0
    const path = geoPath(
      zoomed
        ? conic().fitExtent(
            [
              [12, 12],
              [W - 12, h - 12],
            ],
            { ...geo, features: inRegion },
          )
        : france,
    )
    return {
      h,
      zoomed,
      main: geo.features.map((f): Shape & { inside: boolean } => {
        const code = codeOf(f.properties.code)
        return { code, d: path(f) ?? '', inside: !zoomed || regionOfDept(code) === region }
      }),
      // France : contour de chaque région (plus marqué que celui des départements). Région : son seul contour.
      outlines: [...regionGeo.lines].filter(([r]) => !zoomed || r === region).map(([r, g]) => ({ region: r, d: path(g) ?? '' })),
      dom: { x: 8, y: h - 8 - DOM_H, w: DOM_W, h: DOM_H },
    }
  }, [geo, regionGeo, region])
  // Région sans contour sur la carte (outre-mer) : une grande case au centre.
  const domOnly = !!region && !!shapes && !shapes.zoomed

  // Survol (souris) ou appui (téléphone) : bulle d'info. France : un appui sur une région la montre de plus près.
  const box = useRef<HTMLDivElement>(null)
  const pointer = useRef('mouse')
  const [tip, setTip] = useState<{ code: string; x: number; y: number; w: number; h: number; pinned?: boolean } | null>(null)
  // Autre région : l'ancienne bulle n'a plus de sens.
  useEffect(() => {
    setTip(null)
  }, [region])
  const place = (e: ReactPointerEvent | React.MouseEvent, code: string, pinned?: boolean) => {
    const r = box.current!.getBoundingClientRect()
    setTip({ code, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height, pinned })
  }
  const pickRegion = (r: string) => {
    setTip(null)
    onRegion(r)
  }
  // Département (vue d'une région, case outre-mer).
  const deptHandlers = (code: string) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      pointer.current = e.pointerType
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse') place(e, code)
    },
    onPointerLeave: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse') setTip(null)
    },
    onClick: (e: React.MouseEvent) => {
      if (pointer.current === 'mouse') onDept(code)
      else if (touch === 'select') {
        onDept(code)
        place(e, code, true)
      } else if (tip?.pinned && tip.code === code) onDept(code)
      else place(e, code, true)
    },
  })
  // Vue France (ou voisin estompé d'une région) : bulle de la région au survol, un appui la choisit.
  const regionHandlers = (r: string | undefined) => ({
    onPointerMove: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse' && r) place(e, r)
    },
    onPointerLeave: (e: ReactPointerEvent) => {
      if (e.pointerType === 'mouse') setTip(null)
    },
    onClick: () => {
      if (r) pickRegion(r)
    },
  })
  const pathProps = (s: Shape & { inside: boolean }) =>
    !shapes?.zoomed
      ? { fill: fill(s.code), stroke: 'var(--color-bg)', strokeWidth: 0.5, className: 'cursor-pointer transition-[fill] duration-300', ...regionHandlers(regionOfDept(s.code)) }
      : s.inside
        ? // Région agrandie : limites des départements bien visibles.
          { fill: fill(s.code), stroke: 'var(--color-muted)', strokeOpacity: 0.7, strokeWidth: 0.8, className: 'cursor-pointer transition-[fill] duration-300', ...deptHandlers(s.code) }
        : // Voisins estompés : un appui passe à leur région.
          { fill: 'var(--color-panel-2)', opacity: 0.5, stroke: 'var(--color-line)', strokeWidth: 0.8, className: 'cursor-pointer', ...regionHandlers(regionOfDept(s.code)) }

  const dom = domOnly ? { x: W / 2 - 120, y: (shapes?.h ?? 0) / 2 - 60, w: 240, h: 120 } : shapes?.dom
  const tipIsRegion = !!tip?.code.startsWith('region-')

  return (
    <div ref={box} className="relative" onPointerLeave={() => !tip?.pinned && setTip(null)}>
      {!shapes ? (
        <div className="flex aspect-square items-center justify-center text-xs text-muted">Chargement de la carte…</div>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${shapes.h}`}
          className={`block h-auto w-full select-none ${className}`}
          role="img"
          aria-label={ariaLabel ?? (region ? 'Carte des départements de la région' : 'Carte des régions et des départements')}
          // Appui hors d'un département : la bulle se ferme.
          onClick={(e) => {
            if (e.target === e.currentTarget) setTip(null)
          }}
        >
          {!domOnly && (
            <>
              {shapes.main.map((s, i) => (
                <path key={i} d={s.d} {...pathProps(s)} />
              ))}
              {shapes.outlines.map((o) => (
                <path
                  key={o.region}
                  d={o.d}
                  fill="none"
                  stroke="var(--color-fg)"
                  strokeOpacity={shapes.zoomed ? 0.6 : 0.45}
                  strokeWidth={shapes.zoomed ? 1.6 : 1.1}
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
              ))}
              {shapes.zoomed ? (
                <>
                  <Outline shapes={shapes.main} code={selected} width={2.6} />
                  {tip?.code !== selected && <Outline shapes={shapes.main} code={tip?.code} />}
                </>
              ) : (
                // Vue France : contour de la région survolée.
                shapes.outlines
                  .filter((o) => o.region === tip?.code)
                  .map((o) => <path key={o.region} d={o.d} fill="none" stroke="var(--color-fg)" strokeWidth={2.2} strokeLinejoin="round" pointerEvents="none" />)
              )}
            </>
          )}
          {/* Ultramarins : une case par territoire (Antilles = Guadeloupe + Martinique), ou seulement ceux de la ligue choisie. */}
          {dom &&
            (domOnly || !shapes.zoomed) &&
            (() => {
              const cells = DOM_CODES.filter(([c]) => !domOnly || regionOfDept(c) === region)
              const cols = Math.min(4, cells.length)
              const rows = Math.ceil(cells.length / cols)
              const cw = (dom.w - 16 - (cols - 1) * 4) / cols
              const ch = (dom.h - 28 - (rows - 1) * 4) / rows
              return (
                <>
                  <rect x={dom.x} y={dom.y} width={dom.w} height={dom.h} rx={8} fill="var(--color-panel)" stroke="var(--color-line)" />
                  <text x={dom.x + 8} y={dom.y + 13} fontSize={10} fontWeight={700} fill="var(--color-muted)">
                    Ultramarins
                  </text>
                  {cells.map(([code, abbr], i) => {
                    const x = dom.x + 8 + (i % cols) * (cw + 4)
                    const y = dom.y + 20 + Math.floor(i / cols) * (ch + 4)
                    const on = tip?.code === code || selected === code
                    return (
                      <g key={code}>
                        <rect
                          x={x}
                          y={y}
                          width={cw}
                          height={ch}
                          rx={4}
                          fill={fill(code)}
                          stroke={on ? 'var(--color-fg)' : 'var(--color-line)'}
                          strokeWidth={selected === code ? 2 : 1}
                          className="cursor-pointer transition-[fill] duration-300"
                          {...deptHandlers(code)}
                        />
                        <text x={x + cw / 2} y={y + ch / 2 + 3} fontSize={8} fontWeight={700} textAnchor="middle" fill="var(--color-muted)" pointerEvents="none">
                          {abbr}
                        </text>
                      </g>
                    )
                  })}
                </>
              )
            })()}
        </svg>
      )}
      {tip && (
        <div
          className={`absolute z-10 w-52 rounded-lg border border-line bg-panel p-2.5 text-xs shadow-xl ${tip.pinned ? '' : 'pointer-events-none'}`}
          style={{
            left: Math.min(Math.max(tip.x - 104, 0), tip.w - 208),
            top: tip.y > tip.h / 2 ? tip.y - 12 : tip.y + 16,
            transform: tip.y > tip.h / 2 ? 'translateY(-100%)' : undefined,
          }}
        >
          {tipContent({ code: tip.code, isRegion: tipIsRegion, pinned: !!tip.pinned })}
        </div>
      )}
    </div>
  )
}
