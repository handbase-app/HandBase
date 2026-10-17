import { geoConicConformal, geoPath } from 'd3-geo'
import type { FeatureCollection, Geometry, MultiLineString } from 'geojson'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { focusProjection, spreadDots } from '../clubMap'
import { regionOfDept, useDepartments } from '../lists'
import { fitFont, inkOn, inside, LABEL_INK, parseCssColor, poleOfInaccessibility, type Poly, type Pt } from '../mapLabels'
import { insetPaths, OTHER_OM, OUTRE_MER, type OutreMerGeo } from '../outreMer'

/*
 * Carte de France des départements du bilan de détection (src/pages/Coverage.tsx, tous ses onglets) et de la réponse
 * à une question (src/pages/Question.tsx). La page donne la couleur de chaque département et le contenu de la bulle ; la carte gère
 * le tracé, le zoom sur une région, le survol et les appuis. Avec des points (`dots` : les clubs d'un département, src/clubMap.ts),
 * la carte se recale sur le département choisi et y pose un point par club.
 *
 * Contours des départements : france-geojson de Grégoire David (departements-version-simplifiee.geojson,
 * https://github.com/gregoiredavid/france-geojson), issus d'Admin Express IGN — Licence Ouverte Etalab.
 * Coordonnées arrondies à 3 décimales (src/assets/departements.json, ~220 Ko), chargées à la demande.
 * Contours de l'outre-mer : src/assets/outre-mer.json (sources et licences dans src/outreMer.ts), chargés de même.
 */

// Carte : métropole + Corse, et sous elle une rangée d'encarts pour l'outre-mer (src/outreMer.ts). Toucher une région
// la montre de plus près (projection recalée sur ses départements) ; on y touche ensuite un département.
// La largeur est fixée ; la hauteur suit celle du pays, et reste la même quand on zoome sur une région.
const W = 600
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

let omLoad: Promise<OutreMerGeo> | null = null
const loadOutreMer = () => (omLoad ??= import('../assets/outre-mer.json?raw').then((m) => JSON.parse(m.default) as OutreMerGeo))

/** Encarts ultramarins : tracés pour la petite taille (rangée sous la carte) et la grande (ligue ultramarine choisie). */
const INSET = { small: [60, 40], big: [150, 110] } as const
/** Contours de l'outre-mer (encarts, et territoire choisi recalé à plein cadre avec ses clubs). */
function useOutreMer() {
  const [geo, setGeo] = useState<OutreMerGeo | null>(null)
  useEffect(() => {
    let alive = true
    void loadOutreMer().then((g) => {
      if (alive) setGeo(g)
    })
    return () => {
      alive = false
    }
  }, [])
  return geo
}
function useInsets(om: OutreMerGeo | null) {
  return useMemo(() => (om ? { small: insetPaths(om, ...INSET.small), big: insetPaths(om, ...INSET.big) } : null), [om])
}

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

/** Point posé sur la carte d'un département (un club). */
export interface MapDot {
  id: string
  lat: number
  lng: number
  /** Rayon à l'écran (px), avant resserrement des départements très fournis. */
  r: number
  fill: string
  /** Nom et valeur, pour les lecteurs d'écran. */
  label: string
  /** Point neutre (aucun joueur avec ces filtres) : dessiné dessous, plus discret. */
  muted?: boolean
}
export interface MapDots {
  items: MapDot[]
  /** Point mis en avant (survolé ici ou dans la liste) : sa bulle s'affiche. */
  active?: string | null
  /** Point choisi (club ouvert) : cerclé. */
  picked?: string
  onActive: (id: string | null) => void
  onPick: (id: string) => void
  /**
   * Au doigt, un premier toucher montre seulement la bulle du point (épinglée : on peut y toucher un bouton, par exemple
   * « Voir les joueurs ») au lieu de choisir le club. La souris et le clavier choisissent toujours directement.
   */
  touchShowsTip?: boolean
  /** Contenu de la bulle d'un point ; pinned : bulle posée au doigt (elle peut contenir des boutons). */
  tip: (id: string, pinned: boolean) => ReactNode
}

/** Zone d'appui minimale d'un point (rayon, px à l'écran) : 24 px de diamètre au moins. */
const HIT = 12

/**
 * Chiffres dans les zones (prop zoneLabel) : taille visée à l'écran (px CSS), selon la largeur de la carte (`s` : px par
 * unité ; téléphone ≈ 0,57, ordinateur ≈ 0,9) ; une zone trop petite descend jusqu'à LABEL_MIN puis n'a pas de chiffre.
 */
const labelPx = (isRegion: boolean, s: number) => Math.min(isRegion ? 17 : 15, Math.max(12, 10 + (isRegion ? 6 : 5) * s))
const LABEL_MIN = 9

/** Polygones d'un ensemble de départements, projetés (repère de la carte). */
function projPolys(fs: Feature[], P: (c: number[]) => Pt): Poly[] {
  return fs.flatMap((f) => {
    const g = f.geometry
    const ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    return ps.map((p) => p.map((r) => r.map(P)))
  })
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
  label,
  others = false,
  dots,
  passive = false,
  zoneLabel,
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
  /** Nom d'un encart ultramarin pour les lecteurs d'écran, avec son chiffre (par défaut : le nom du territoire). */
  label?: (code: string) => string
  /** Montre la pastille « Autres outre-mer » (« 97 » : joueurs ultramarins sans territoire précis). */
  others?: boolean
  /**
   * Points du département choisi (`selected`) : la carte se recale sur lui (sans eux : sur sa région). Sans département
   * choisi : points posés sur la France (ou la région), par exemple les clubs d'une réponse répartis dans plusieurs départements.
   */
  dots?: MapDots
  /** Zones sans appui ni bulle (seuls les points se touchent) : carte d'une réponse, pas de navigation par lieu. */
  passive?: boolean
  /**
   * Chiffre écrit dans une zone (même valeur que la bulle) ; undefined : pas de chiffre (hors périmètre, sans donnée).
   * Vue France : un chiffre par région (isRegion) ; région agrandie : un par département ; encarts ultramarins : le leur.
   * Rien sur la carte d'un département (points des clubs) ni avec des points.
   */
  zoneLabel?: (code: string, isRegion: boolean) => string | undefined
}) {
  const geo = useGeo()
  const om = useOutreMer()
  const insetD = useInsets(om)
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

  // Tracés : France entière, ou la région choisie à plein cadre (ses voisins estompés autour), ou le département
  // choisi à plein cadre quand il a des points (métropole : voisins estompés ; outre-mer : le territoire seul).
  // Recalculés seulement quand la région (le département) change ; les couleurs changent seules.
  const focusCode = dots && selected ? selected : ''
  const shapes = useMemo(() => {
    if (!geo || !regionGeo) return null
    const conic = () => geoConicConformal().parallels([44, 49]).rotate([-3, 0])
    const france = conic().fitWidth(W - 16, geo)
    france.translate([france.translate()[0] + 8, france.translate()[1] + 8])
    const h = Math.ceil(geoPath(france).bounds(geo)[1][1]) + 8
    if (focusCode) {
      const mine = geo.features.filter((f) => codeOf(f.properties.code) === focusCode)
      const omOnes = (om?.features ?? []).filter((f) => f.properties.code === focusCode)
      const overseas = !mine.length
      if (mine.length || omOnes.length) {
        const proj = focusProjection({ type: 'FeatureCollection', features: overseas ? omOnes : mine }, W, h, 24, overseas)
        const path = geoPath(proj)
        return {
          h,
          zoomed: true,
          proj,
          dotProj: proj,
          main: (overseas ? omOnes : geo.features).map((f): Shape & { inside: boolean } => {
            const code = codeOf(f.properties.code)
            return { code, d: path(f) ?? '', inside: code === focusCode }
          }),
          outlines: [] as { region: string; d: string }[],
        }
      }
    }
    const inRegion = region ? (regionGeo.by.get(region) ?? []) : []
    const zoomed = inRegion.length > 0
    const flat = zoomed
      ? conic().fitExtent(
          [
            [12, 12],
            [W - 12, h - 12],
          ],
          { ...geo, features: inRegion },
        )
      : france
    const path = geoPath(flat)
    return {
      h,
      zoomed,
      proj: null,
      // Points sur la France ou sur une région (clubs d'une réponse, partout) : même projection que le tracé.
      dotProj: flat,
      main: geo.features.map((f): Shape & { inside: boolean } => {
        const code = codeOf(f.properties.code)
        return { code, d: path(f) ?? '', inside: !zoomed || regionOfDept(code) === region }
      }),
      // France : contour de chaque région (plus marqué que celui des départements). Région : son seul contour.
      outlines: [...regionGeo.lines].filter(([r]) => !zoomed || r === region).map(([r, g]) => ({ region: r, d: path(g) ?? '' })),
    }
  }, [geo, regionGeo, region, focusCode, om])
  const focused = !!shapes?.proj
  // Points dessinés : département recalé, ou points posés sur la France (ou une région) sans département choisi.
  const withDots = !!dots && !!shapes && (focused || !focusCode)
  // Région sans contour sur la carte (ligue ultramarine) : ses seuls encarts, en grand.
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
      // Souris, ou clavier (encarts ultramarins : boutons ; detail = 0) : tout de suite.
      if (pointer.current === 'mouse' || e.detail === 0) onDept(code)
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
    passive
      ? {
          fill: focused ? (s.inside ? 'color-mix(in srgb, var(--color-panel-2) 70%, var(--color-panel))' : 'var(--color-panel-2)') : fill(s.code),
          opacity: focused && !s.inside ? 0.45 : shapes?.zoomed && !s.inside ? 0.5 : undefined,
          stroke: focused && s.inside ? 'var(--color-fg)' : 'var(--color-bg)',
          strokeOpacity: focused && s.inside ? 0.6 : undefined,
          strokeWidth: focused && s.inside ? 1.6 : 0.5,
          pointerEvents: 'none' as const,
        }
      : focused
      ? s.inside
        ? // Département recalé : fond neutre sous les points des clubs, sans bulle (celles des points suffisent).
          { fill: 'color-mix(in srgb, var(--color-panel-2) 70%, var(--color-panel))', stroke: 'var(--color-fg)', strokeOpacity: 0.6, strokeWidth: 1.6, pointerEvents: 'none' as const }
        : // Voisins estompés : un appui choisit ce département.
          { fill: 'var(--color-panel-2)', opacity: 0.45, stroke: 'var(--color-line)', strokeWidth: 0.8, className: 'cursor-pointer', ...deptHandlers(s.code) }
      : !shapes?.zoomed
      ? { fill: fill(s.code), stroke: 'var(--color-bg)', strokeWidth: 0.5, className: 'cursor-pointer transition-[fill] duration-300', ...regionHandlers(regionOfDept(s.code)) }
      : s.inside
        ? // Région agrandie : limites des départements bien visibles.
          { fill: fill(s.code), stroke: 'var(--color-muted)', strokeOpacity: 0.7, strokeWidth: 0.8, className: 'cursor-pointer transition-[fill] duration-300', ...deptHandlers(s.code) }
        : // Voisins estompés : un appui passe à leur région.
          { fill: 'var(--color-panel-2)', opacity: 0.5, stroke: 'var(--color-line)', strokeWidth: 0.8, className: 'cursor-pointer', ...regionHandlers(regionOfDept(s.code)) }

  // Points des clubs : tailles en px à l'écran, converties dans le repère de la carte (`fit.s` : px par unité ; la carte
  // peut être réduite en hauteur, elle est alors centrée). Mesuré à chaque changement de taille.
  const svgRef = useRef<SVGSVGElement>(null)
  const [fit, setFit] = useState({ s: 1, ox: 0, oy: 0 })
  const wantLabels = !!zoneLabel && !passive && !!shapes && !focused && !withDots && !domOnly
  useLayoutEffect(() => {
    const el = svgRef.current
    if (!(withDots || wantLabels) || !el || !shapes) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      const b = box.current?.getBoundingClientRect()
      if (!r.width || !b) return
      const sc = Math.min(r.width / W, r.height / shapes.h || Infinity)
      setFit({ s: sc, ox: r.left - b.left + (r.width - W * sc) / 2, oy: r.top - b.top + (r.height - shapes.h * sc) / 2 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [withDots, wantLabels, shapes])

  // Chiffres dans les zones : point intérieur de chaque zone (pôle d'inaccessibilité, src/mapLabels.ts), calculé une fois
  // par tracé. Vue France : les régions (même quand la couleur est celle des départements) ; région agrandie : ses départements.
  const anchors = useMemo(() => {
    if (!wantLabels || !geo || !regionGeo || !shapes?.dotProj) return []
    const proj = shapes.dotProj
    const P = (c: number[]): Pt => {
      const p = proj(c as [number, number])
      return p ? [p[0], p[1]] : [NaN, NaN]
    }
    const zones: [string, Feature[], boolean][] = []
    if (shapes.zoomed) {
      const by = new Map<string, Feature[]>()
      for (const f of regionGeo.by.get(region) ?? []) {
        const c = codeOf(f.properties.code)
        by.set(c, [...(by.get(c) ?? []), f])
      }
      for (const [c, fs] of by) zones.push([c, fs, false])
    } else for (const [r, fs] of regionGeo.by) zones.push([r, fs, true])
    return zones.flatMap(([code, fs, isRegion]) => {
      const polys = projPolys(fs, P)
      const edges = (outline(fs) as MultiLineString).coordinates.map((l) => l.map(P))
      const pole = poleOfInaccessibility(polys, edges, 0.5)
      if (!pole) return []
      // Département sous le chiffre : sa couleur décide de celle du texte (vue France par département).
      const under = fs.find((f) => inside(pole.x, pole.y, projPolys([f], P)))
      return [{ code, isRegion, polys, x: pole.x, y: pole.y, under: codeOf((under ?? fs[0]).properties.code) }]
    })
  }, [wantLabels, geo, regionGeo, shapes, region])
  // Couleur du texte : claire ou foncée selon la luminance du fond, lue telle que le navigateur la calcule (variables du
  // style de l'installation, fond propre de la carte en style Sport…). Relue quand le style ou le thème change.
  const probe = useRef<HTMLSpanElement>(null)
  const [styleVer, setStyleVer] = useState(0)
  // Largeur réelle des chiffres dans la police de la carte (chiffres à chasse fixe selon le style : « % » et espaces larges).
  const [widthOf, setWidthOf] = useState<((t: string) => number) | null>(null)
  useLayoutEffect(() => {
    const el = probe.current
    const ctx = el && document.createElement('canvas').getContext('2d')
    if (!el || !ctx) return
    const cs = getComputedStyle(el)
    ctx.font = `800 100px ${cs.fontFamily}`
    const cache = new Map<string, number>()
    setWidthOf(() => (t: string) => {
      let w = cache.get(t)
      if (w === undefined) cache.set(t, (w = ctx.measureText(t).width / 100))
      return w
    })
  }, [wantLabels, styleVer])
  useEffect(() => {
    if (!wantLabels) return
    const bump = () => setStyleVer((v) => v + 1)
    const mo = new MutationObserver(bump)
    mo.observe(document.documentElement, { attributes: true })
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    mq?.addEventListener?.('change', bump)
    // Police des chiffres chargée après coup : on remesure.
    void document.fonts?.ready.then(bump)
    return () => {
      mo.disconnect()
      mq?.removeEventListener?.('change', bump)
    }
  }, [wantLabels])
  // Texte de chaque zone, puis taille qui tient (recalculée quand un chiffre ou la taille de la carte change).
  const texts = wantLabels ? anchors.map((a) => zoneLabel!(a.code, a.isRegion) ?? '') : []
  const textKey = texts.join('|')
  const labels = useMemo(
    () =>
      anchors.flatMap((a, i) => {
        const text = texts[i]
        if (!text) return []
        const f = fitFont(text, a.x, a.y, a.polys, labelPx(a.isRegion, fit.s) / fit.s, LABEL_MIN / fit.s, widthOf ?? undefined)
        return f ? [{ ...a, text, f }] : []
      }),
    [anchors, textKey, fit.s, widthOf], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const fills = labels.map((l) => fill(l.under))
  const fillKey = fills.join('|')
  const [inks, setInks] = useState<Map<string, 'dark' | 'light'>>(new Map())
  useLayoutEffect(() => {
    const el = probe.current
    if (!el || !fills.length) return
    const next = new Map<string, 'dark' | 'light'>()
    for (const c of new Set(fills)) {
      el.style.backgroundColor = ''
      el.style.backgroundColor = c
      const rgb = parseCssColor(getComputedStyle(el).backgroundColor)
      next.set(c, rgb ? inkOn(rgb) : 'dark')
    }
    setInks((m) => (m.size === next.size && [...next].every(([k, v]) => m.get(k) === v) ? m : next))
  }, [fillKey, styleVer]) // eslint-disable-line react-hooks/exhaustive-deps
  const labelEls =
    labels.length > 0 ? (
      <g aria-hidden="true" pointerEvents="none" className="tabular-nums" fontWeight={800} textAnchor="middle">
        {labels.map((l, i) => {
          const ink = LABEL_INK[inks.get(fills[i]) ?? 'dark']
          return (
            <text
              key={l.code}
              x={l.x.toFixed(1)}
              y={l.y.toFixed(1)}
              dominantBaseline="central"
              fontSize={l.f.toFixed(2)}
              fill={ink.fill}
              stroke={ink.halo}
              strokeWidth={(l.f * 0.22).toFixed(2)}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {l.text}
            </text>
          )
        })}
      </g>
    ) : null
  const items = withDots ? dots?.items : undefined
  const placed = useMemo(() => {
    if (!shapes?.dotProj || !items) return []
    const k = 1 / fit.s
    // Beaucoup de clubs : points un peu plus petits ; puis écartés pour ne pas se recouvrir.
    const dense = items.length > 60 ? 0.7 : items.length > 30 ? 0.85 : 1
    // Hors du cadre (club ultramarin sur la carte de France) : pas de point (la liste le montre).
    const pts = items.flatMap((d) => {
      const xy = shapes.dotProj!([d.lng, d.lat])
      return xy && xy[0] >= 0 && xy[0] <= W && xy[1] >= 0 && xy[1] <= shapes.h ? [{ ...d, x: xy[0], y: xy[1], r: Math.max(3, d.r * dense) * k }] : []
    })
    // Dessin : neutres dessous, puis du plus gros au plus petit (les petits restent touchables).
    return spreadDots(pts, 1.5 * k).sort((a, b) => Number(!!b.muted) - Number(!!a.muted) || b.r - a.r)
  }, [shapes, items, fit.s])
  const activeDot = dots?.active ? placed.find((d) => d.id === dots.active) : undefined
  // Bulle d'un point posée au doigt (touchShowsTip) : elle reste et se touche, jusqu'à un appui ailleurs.
  const [dotPinned, setDotPinned] = useState(false)
  useEffect(() => {
    if (!dots?.active) setDotPinned(false)
  }, [dots?.active])

  // Points des clubs (boutons) : dans le département recalé, ou posés sur la France / la région.
  const dotEls =
    dots &&
    placed.map((d) => {
      const on = d.id === dots.active || d.id === dots.picked
      const k = 1 / fit.s
      return (
        <g
          key={d.id}
          transform={`translate(${d.x.toFixed(1)},${d.y.toFixed(1)})`}
          role="button"
          tabIndex={0}
          aria-label={d.label}
          aria-pressed={d.id === dots.picked}
          className={`outline-none ${d.muted ? '' : 'cursor-pointer'}`}
          onPointerDown={(e) => {
            pointer.current = e.pointerType
          }}
          onPointerEnter={(e) => {
            if (e.pointerType === 'mouse' && !dotPinned) dots.onActive(d.id)
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse' && !dotPinned) dots.onActive(null)
          }}
          onFocus={() => dots.onActive(d.id)}
          // Bulle épinglée au doigt : toucher son bouton fait perdre le focus au point ; on ne la ferme pas (sinon elle
          // disparaît avant que le clic n'arrive sur « Voir les joueurs »). Un appui ailleurs sur la carte la ferme.
          onBlur={() => !dotPinned && dots.onActive(null)}
          onClick={(e) => {
            e.stopPropagation()
            setTip(null)
            dots.onActive(d.id)
            if (dots.touchShowsTip && pointer.current !== 'mouse' && !d.muted) {
              setDotPinned(true)
              return
            }
            setDotPinned(false)
            dots.onPick(d.id)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              dots.onPick(d.id)
            }
          }}
        >
          {/* Zone d'appui invisible, plus grande que le point. */}
          <circle r={Math.max(HIT * k, d.r + 3 * k)} fill="transparent" />
          {on && <circle r={d.r + 3 * k} fill="none" stroke="var(--color-fg)" strokeWidth={2 * k} pointerEvents="none" />}
          <circle
            r={d.r}
            fill={d.fill}
            stroke={d.muted ? 'var(--color-muted)' : 'var(--color-fg)'}
            strokeOpacity={d.muted ? 0.5 : 0.55}
            strokeWidth={k}
            pointerEvents="none"
            className="transition-[fill] duration-300"
          />
        </g>
      )
    })

  // Encarts ultramarins : à la vue France (rangée sous la carte) ou seuls, en grand, pour une ligue ultramarine (pas sur
  // une carte sans appui : ils sont des boutons).
  const insets = !shapes || focused || passive || (shapes.zoomed && !domOnly) ? [] : [...OUTRE_MER, ...(others ? [OTHER_OM] : [])].filter((t) => !domOnly || regionOfDept(t.code) === region)
  const big = domOnly
  const [iw, ih] = big ? INSET.big : INSET.small
  const tipIsRegion = !!tip?.code.startsWith('region-')
  // Chiffre d'un encart ultramarin, sous son nom.
  const omLabel = (code: string) => (zoneLabel && !passive ? zoneLabel(code, false) : undefined)

  return (
    <div ref={box} className="map-surface relative" onPointerLeave={() => !tip?.pinned && setTip(null)}>
      {/* Couleur d'un fond telle que calculée ici (variables de la carte), pour choisir celle des chiffres. */}
      {wantLabels && <span ref={probe} aria-hidden="true" className="pointer-events-none absolute size-0 overflow-hidden opacity-0 tabular-nums" />}
      {!shapes ? (
        <div className="flex aspect-square items-center justify-center text-xs text-muted">Chargement de la carte…</div>
      ) : domOnly ? null : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${shapes.h}`}
          className={`block h-auto w-full select-none ${className}`}
          // Avec des points (boutons) : un groupe, pour que les lecteurs d'écran les atteignent.
          role={withDots ? 'group' : 'img'}
          aria-label={ariaLabel ?? (region ? 'Carte des départements de la région' : 'Carte des régions et des départements')}
          // Appui hors d'un département (ou d'un point) : la bulle se ferme.
          onClick={(e) => {
            if (dotPinned) {
              setDotPinned(false)
              dots?.onActive(null)
            }
            if (e.target === e.currentTarget) {
              setTip(null)
              dots?.onActive(null)
            }
          }}
        >
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
          {focused ? (
            dotEls
          ) : shapes.zoomed ? (
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
          {!focused && withDots && dotEls}
          {labelEls}
        </svg>
      )}
      {insets.length > 0 && (
        <div role="group" aria-label="Outre-mer" className={`flex flex-wrap justify-center gap-1 ${big ? 'py-6' : 'pt-1'}`}>
          {insets.map((t) => {
            const d = insetD?.[big ? 'big' : 'small'].get(t.code)
            const sel = selected === t.code
            const on = sel || tip?.code === t.code
            return (
              <button
                key={t.code}
                type="button"
                aria-label={label?.(t.code) ?? t.name}
                aria-pressed={sel}
                className={`flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-md bg-panel px-0.5 pt-1 pb-0.5 transition ${big ? 'w-36' : 'w-16'} ${
                  sel ? 'border-2 border-fg' : on ? 'border border-fg' : 'border border-line hover:border-muted'
                }`}
                {...deptHandlers(t.code)}
              >
                {d !== undefined ? (
                  <svg viewBox={`0 0 ${iw} ${ih}`} className={`pointer-events-none block w-full ${big ? 'h-28' : 'h-9'}`} aria-hidden="true">
                    <path d={d} fill={fill(t.code)} stroke="var(--color-fg)" strokeOpacity={0.45} strokeWidth={big ? 0.8 : 0.5} strokeLinejoin="round" className="transition-[fill] duration-300" />
                  </svg>
                ) : (
                  // « Autres outre-mer » (pas de contour), ou contours pas encore chargés : une pastille de la couleur.
                  <span className={`pointer-events-none flex items-center justify-center ${big ? 'h-28' : 'h-9'}`} aria-hidden="true">
                    <span className="block size-6 rounded-full border border-line transition-[background] duration-300" style={{ background: fill(t.code) }} />
                  </span>
                )}
                <span className={`pointer-events-none w-full truncate text-center leading-tight font-bold text-muted ${big ? 'text-xs' : 'text-[9px]'}`}>{big ? t.name : t.short}</span>
                {omLabel(t.code) && (
                  <span className={`pointer-events-none w-full truncate text-center leading-tight font-extrabold text-fg tabular-nums ${big ? 'text-sm' : 'text-[11px]'}`}>{omLabel(t.code)}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {withDots && activeDot && dots && !tip && (
        // Bulle d'un point (survolé, touché, ou sa ligne survolée dans la liste) : au-dessus ou au-dessous du point.
        <div
          className={`absolute z-10 w-52 rounded-lg border border-line bg-panel p-2.5 text-xs shadow-xl ${dotPinned ? '' : 'pointer-events-none'}`}
          style={(() => {
            const x = fit.ox + activeDot.x * fit.s
            const y = fit.oy + activeDot.y * fit.s
            const below = y < (shapes?.h ?? 0) * fit.s * 0.4
            const w = box.current?.clientWidth ?? 0
            return {
              left: Math.min(Math.max(x - 104, 0), Math.max(0, w - 208)),
              top: below ? y + activeDot.r * fit.s + 10 : y - activeDot.r * fit.s - 10,
              transform: below ? undefined : 'translateY(-100%)',
            }
          })()}
        >
          {dots.tip(activeDot.id, dotPinned)}
        </div>
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
