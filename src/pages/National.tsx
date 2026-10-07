import { geoConicConformal, geoPath } from 'd3-geo'
import type { FeatureCollection, Geometry } from 'geojson'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAlerts } from '../alerts'
import { department, showDeptInPlayers, usePlayerFilter, useSessionState } from '../components/PlayerFilter'
import { Empty, Icon, Segmented } from '../components/ui'
import { alive, db, type Measurement, type Player } from '../db'
import { regionOfDept, useDepartments, useRegionLabel } from '../lists'
import { useThrottledQuery } from '../live'
import { can, useRole } from '../roles'

/*
 * Vue nationale (administrateurs) : carte des départements colorée selon un indicateur, chiffres clés et
 * classement. Tout est calculé sur l'appareil, en une passe sur les joueurs et les mesures ; rien n'est écrit.
 * Mêmes filtres que la liste Joueurs (usePlayerFilter, portée « national »), sauf la région et le département,
 * absents du panneau : c'est la carte qui les choisit (une région, puis un de ses départements).
 *
 * Contours des départements : france-geojson de Grégoire David (departements-version-simplifiee.geojson,
 * https://github.com/gregoiredavid/france-geojson), issus d'Admin Express IGN — Licence Ouverte Etalab.
 * Coordonnées arrondies à 3 décimales (src/assets/departements.json, ~220 Ko), chargées à la demande.
 */

type Metric = 'players' | 'measured' | 'spotted'

const METRICS: { value: Metric; label: string }[] = [
  { value: 'players', label: 'Joueurs' },
  { value: 'measured', label: 'Mesurés par le staff' },
  { value: 'spotted', label: 'Profils repérés' },
]

/** Auteur des tailles reprises de l'export des licences (src/importLicences.ts) : pas une mesure du staff. */
const DECLARED = 'Licence FFHB (déclarée)'

/** Joueurs retenus et ce qu'il faut savoir de leurs mesures (lu une fois ; les filtres ne relisent pas la base). */
interface Data {
  players: Player[]
  /** Joueurs avec au moins une mesure prise par le staff. */
  staff: Set<string>
  /** Dernière taille connue (mesurée ou déclarée). */
  height: Map<string, number>
}

async function loadData(): Promise<Data> {
  const [players, measurements] = await Promise.all([db.players.toArray(), db.measurements.toArray()])
  const staff = new Set<string>()
  const last = new Map<string, Measurement>()
  for (const m of measurements) {
    if (m.deleted) continue
    if (m.author !== DECLARED) staff.add(m.playerId)
    if (m.criterionId === 'taille' && typeof m.value === 'number') {
      const cur = last.get(m.playerId)
      if (!cur || m.date > cur.date || (m.date === cur.date && m.updatedAt > cur.updatedAt)) last.set(m.playerId, m)
    }
  }
  return {
    // Mêmes joueurs que les alertes : ni fiches fondues, ni fiches hors cadre.
    players: alive(players).filter((p) => !p.mergedInto && p.review !== 'refused'),
    staff,
    height: new Map([...last].map(([id, m]) => [id, m.value as number])),
  }
}

/**
 * Repli quand aucune alerte n'est utilisable : joueurs dont la dernière taille atteint le 90e centile
 * de leur année de naissance et de leur sexe (groupes d'au moins 10 joueurs mesurés).
 */
function tallest({ players, height }: Data) {
  const groups = new Map<string, number[]>()
  for (const p of players) {
    const h = height.get(p.id)
    if (h === undefined || !p.birthDate || !p.sex) continue
    const k = `${p.birthDate.slice(0, 4)}|${p.sex}`
    const g = groups.get(k)
    if (g) g.push(h)
    else groups.set(k, [h])
  }
  const p90 = new Map<string, number>()
  for (const [k, hs] of groups) {
    if (hs.length < 10) continue
    hs.sort((a, b) => a - b)
    p90.set(k, hs[Math.floor(0.9 * (hs.length - 1))])
  }
  const out = new Set<string>()
  for (const p of players) {
    const t = p90.get(`${p.birthDate?.slice(0, 4)}|${p.sex}`)
    const h = height.get(p.id)
    if (t !== undefined && h !== undefined && h >= t) out.add(p.id)
  }
  return out
}

interface Agg {
  n: number
  staff: number
  spotted: number
}

// Carte : métropole + Corse, et une case pour l'outre-mer. Toucher une région la montre de plus près
// (projection recalée sur ses départements) ; on y touche ensuite un département pour voir ses joueurs.
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
]
/** Corse : un seul département pour nous (n° de club « 20 »). */
const codeOf = (c: string) => (c === '2A' || c === '2B' ? '20' : c)

type Geo = FeatureCollection<Geometry, { code: string; nom: string }>
type Feature = Geo['features'][number]

interface Shape {
  code: string
  d: string
}

function useGeo() {
  const [geo, setGeo] = useState<Geo | null>(null)
  useEffect(() => {
    let alive = true
    // Fichier à part (pas dans le démarrage de l'appli) ; mis en cache par le service worker.
    void import('../assets/departements.json?raw').then((m) => alive && setGeo(JSON.parse(m.default)))
    return () => {
      alive = false
    }
  }, [])
  return geo
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

/** Teinte de l'accent du thème, du plus clair (classe 0) au plus fort (classe 4) ; vide : fond de carte. */
const SHADES = [14, 30, 48, 68, 92]
const fillFor = (k: number | undefined) =>
  k === undefined ? 'var(--color-panel-2)' : `color-mix(in srgb, var(--color-accent) ${SHADES[k]}%, var(--color-panel))`

/** Seuils de 5 classes de même effectif (quantiles), pour que la carte reste lisible malgré Paris et le Nord. */
function breaks(values: number[]) {
  const v = [...values].sort((a, b) => a - b)
  if (!v.length) return []
  return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.floor(q * (v.length - 1))])
}
const classOf = (v: number, b: number[]) => b.filter((x) => v > x).length

/** Filtres partagés avec la liste Joueurs, sauf la région et le département : c'est la carte qui les choisit. */
const HIDE = { hide: ['dept' as const, 'region' as const] }

const fmt = (n: number) => n.toLocaleString('fr-FR')
const pct = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: n < 10 ? 1 : 0 })} %`

/** Contour du département survolé, tracé par-dessus ses voisins. */
function Outline({ shapes, code }: { shapes: Shape[]; code?: string }) {
  return shapes
    .filter((s) => s.code === code)
    .map((s, i) => <path key={i} d={s.d} fill="none" stroke="var(--color-fg)" strokeWidth={1.6} strokeLinejoin="round" pointerEvents="none" />)
}

export default function National() {
  const role = useRole()
  if (!can.nationalView(role)) return <Empty>Vue réservée aux administrateurs.</Empty>
  return <NationalView />
}

function NationalView() {
  const navigate = useNavigate()
  const data = useThrottledQuery(loadData, [], ['players', 'measurements'])
  // Mêmes filtres que la liste Joueurs ; la région choisie sur la carte en fait partie (elle suit vers Joueurs).
  const { filtered, ui, region, setRegion, regionCounts } = usePlayerFilter(data?.players, 'national', HIDE)
  const alerts = useAlerts()
  const geo = useGeo()
  const lists = useDepartments()
  const regionLabel = useRegionLabel()
  const [metric, setMetric] = useSessionState<Metric>('handbase.national.metric', 'players')

  // Profils repérés : joueurs d'au moins une alerte (hors alertes sans condition, qui prennent tout le monde).
  const fromAlerts = useMemo(() => {
    const ids = new Set<string>()
    let n = 0
    for (const a of alerts?.alerts ?? []) {
      if (!a.players.length || a.players.length >= alerts!.ctx.players.length) continue
      n++
      for (const p of a.players) ids.add(p.id)
    }
    return { ids, n }
  }, [alerts])
  // Centile de taille calculé sur tous les joueurs (pas seulement les filtrés) : le repérage ne bouge pas avec les filtres.
  const spottedIds = useMemo(() => (fromAlerts.n ? fromAlerts.ids : data ? tallest(data) : new Set<string>()), [fromAlerts, data])

  // Une passe sur les joueurs filtrés (région comprise) : totaux, chiffres de chaque département et de chaque
  // région. `filtered` ne change qu'avec les filtres ou les données ; changer d'indicateur ne refait pas ce calcul.
  const stats = useMemo(() => {
    const by = new Map<string, Agg>()
    const byRegion = new Map<string, Agg>()
    const clubs = new Set<string>()
    const total: Agg = { n: 0, staff: 0, spotted: 0 }
    const add = (m: Map<string, Agg>, k: string, st: number, s: number) => {
      let a = m.get(k)
      if (!a) m.set(k, (a = { n: 0, staff: 0, spotted: 0 }))
      a.n++
      a.staff += st
      a.spotted += s
    }
    for (const p of filtered) {
      const s = spottedIds.has(p.id) ? 1 : 0
      const st = data?.staff.has(p.id) ? 1 : 0
      total.n++
      total.staff += st
      total.spotted += s
      const club = p.clubCode || p.club
      if (club) clubs.add(club)
      const dept = department(p)
      if (!dept) continue
      add(by, dept, st, s)
      const r = regionOfDept(dept)
      if (r) add(byRegion, r, st, s)
    }
    return { by, byRegion, clubs: clubs.size, total }
  }, [filtered, data, spottedIds])

  const valueOf = (a: Agg | undefined) =>
    !a || !a.n ? undefined : metric === 'players' ? a.n : metric === 'measured' ? (100 * a.staff) / a.n : a.spotted
  const show = (v: number) => (metric === 'measured' ? pct(v) : fmt(v))

  const values = useMemo(() => {
    const m = new Map<string, number>()
    for (const [code, a] of stats.by) {
      const v = valueOf(a)
      if (v !== undefined && (metric === 'measured' || v > 0)) m.set(code, v)
    }
    return m
  }, [stats, metric]) // eslint-disable-line react-hooks/exhaustive-deps
  const b = useMemo(() => breaks([...values.values()]), [values])
  const shade = (code: string) => {
    const v = values.get(code)
    return fillFor(v === undefined ? undefined : classOf(v, b))
  }

  // Noms : la liste des départements (Réglages), sinon celui de la carte.
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
  const nameOf = (code: string) => lists.find((d) => d.code === code)?.name ?? geoNames.get(code) ?? `Département ${code}`

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
  // Région : au doigt, un 2e appui sur un département ouvre la liste des joueurs.
  const box = useRef<HTMLDivElement>(null)
  const pointer = useRef('mouse')
  const [tip, setTip] = useState<{ code: string; x: number; y: number; w: number; h: number; pinned?: boolean } | null>(null)
  const place = (e: ReactPointerEvent | React.MouseEvent, code: string, pinned?: boolean) => {
    const r = box.current!.getBoundingClientRect()
    setTip({ code, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height, pinned })
  }
  const pickRegion = (r: string) => {
    setRegion(r)
    setTip(null)
  }
  const go = (code: string) => {
    // Liste Joueurs avec les filtres de cet écran (région comprise), plus le département touché.
    showDeptInPlayers('national', code)
    try {
      sessionStorage.setItem('handbase.joueurs.view', JSON.stringify('base'))
    } catch {
      /* stockage indisponible */
    }
    navigate('/joueurs')
  }
  // Département (vue d'une région, case outre-mer) : bulle, puis liste des joueurs.
  const deptHandlers = (code: string) => ({
    onPointerDown: (e: ReactPointerEvent) => (pointer.current = e.pointerType),
    onPointerMove: (e: ReactPointerEvent) => e.pointerType === 'mouse' && place(e, code),
    onPointerLeave: (e: ReactPointerEvent) => e.pointerType === 'mouse' && setTip(null),
    onClick: (e: React.MouseEvent) => {
      if (pointer.current === 'mouse' || (tip?.pinned && tip.code === code)) go(code)
      else place(e, code, true)
    },
  })
  // Vue France (ou voisin estompé d'une région) : bulle de la région au survol, un appui la choisit.
  const regionHandlers = (r: string | undefined) => ({
    onPointerMove: (e: ReactPointerEvent) => e.pointerType === 'mouse' && !!r && place(e, r),
    onPointerLeave: (e: ReactPointerEvent) => e.pointerType === 'mouse' && setTip(null),
    onClick: () => r && pickRegion(r),
  })
  const pathProps = (s: Shape & { inside: boolean }) =>
    !shapes?.zoomed
      ? { fill: shade(s.code), stroke: 'var(--color-bg)', strokeWidth: 0.5, className: 'cursor-pointer transition-[fill] duration-300', ...regionHandlers(regionOfDept(s.code)) }
      : s.inside
        ? // Région agrandie : limites des départements bien visibles.
          { fill: shade(s.code), stroke: 'var(--color-muted)', strokeOpacity: 0.7, strokeWidth: 0.8, className: 'cursor-pointer transition-[fill] duration-300', ...deptHandlers(s.code) }
        : // Voisins estompés : un appui passe à leur région.
          { fill: 'var(--color-panel-2)', opacity: 0.5, stroke: 'var(--color-line)', strokeWidth: 0.8, className: 'cursor-pointer', ...regionHandlers(regionOfDept(s.code)) }

  const ranking = useMemo(
    () =>
      [...stats.by]
        .filter(([, a]) => a.n >= (metric === 'measured' ? 5 : 1))
        .map(([code, a]) => ({ code, a, v: valueOf(a)! }))
        .filter((x) => x.v > 0)
        .sort((x, y) => y.v - x.v || y.a.n - x.a.n)
        .slice(0, 10),
    [stats, metric], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const top = ranking[0]?.v ?? 1

  if (!data) return <div className="py-20 text-center text-sm text-muted">Calcul de la vue nationale…</div>

  const t = stats.total
  // Bulle : chiffres d'une région (vue France) ou d'un département (vue d'une région, outre-mer).
  const tipIsRegion = !!tip?.code.startsWith('region-')
  const tipAgg = !tip ? undefined : tipIsRegion ? stats.byRegion.get(tip.code) : stats.by.get(tip.code)
  // Classes de la légende ; une classe forcément vide (seuils égaux, peu de départements) n'y figure pas.
  const max = values.size ? Math.max(...values.values()) : 0
  const legend = b.length
    ? [
        { k: 0, v: Math.min(...values.values()) },
        ...b.map((v, j) => ({ k: j + 1, v })).filter(({ k, v }) => max > v && (k === b.length || v !== b[k])),
      ]
    : []
  const kpis = [
    { label: 'Joueurs', value: fmt(t.n) },
    { label: 'Clubs', value: fmt(stats.clubs) },
    { label: 'Départements', value: fmt(stats.by.size) },
    { label: 'Mesurés par le staff', value: t.n ? pct((100 * t.staff) / t.n) : '—' },
    { label: 'Profils repérés', value: fmt(t.spotted), main: true },
  ]
  // Menu des régions : celles qui ont des joueurs avec ces filtres, plus la région choisie.
  const regionChoices = [...regionCounts, ...(region && !regionCounts.some(([r]) => r === region) ? [[region, 0] as [string, number]] : [])].sort((x, y) =>
    regionLabel(x[0]).localeCompare(regionLabel(y[0]), 'fr'),
  )
  const dom = domOnly ? { x: W / 2 - 120, y: (shapes?.h ?? 0) / 2 - 60, w: 240, h: 120 } : shapes?.dom

  return (
    // Écran large : la vue sort de la colonne de l'appli pour mettre la carte et les chiffres côte à côte.
    <div className="flex flex-col gap-3 lg:relative lg:left-1/2 lg:w-[min(68rem,calc(100vw-2rem))] lg:-translate-x-1/2">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold">Vue nationale{region ? ` · ${regionLabel(region)}` : ''}</h1>
          <p className="text-[11px] text-muted">Données de cet appareil, par département du club</p>
        </div>
        <Link to="/joueurs" className="text-[11px] font-bold text-muted underline">
          Tous les joueurs
        </Link>
      </div>

      {ui}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className={`card px-3 py-2.5 ${k.main ? 'col-span-2 border-accent/60 sm:col-span-1' : ''}`}>
            <div className={`text-xl font-extrabold tabular-nums ${k.main ? 'text-accent' : ''}`}>{k.value}</div>
            <div className="text-[10px] font-bold tracking-wider text-muted uppercase">{k.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[3fr_2fr] lg:items-start">
        <section className="card flex flex-col gap-2 p-3">
          <div className="flex gap-2">
            {region && (
              <button className="shrink-0 rounded-md border border-line bg-panel-2 px-2.5 text-xs font-bold" onClick={() => pickRegion('')}>
                ← Toute la France
              </button>
            )}
            <select
              className={`field min-w-0 flex-1 py-1.5 text-xs ${region ? 'border-accent font-bold' : ''}`}
              value={region}
              onChange={(e) => pickRegion(e.target.value)}
            >
              <option value="">Toute la France</option>
              {regionChoices.map(([r, n]) => (
                <option key={r} value={r}>
                  {regionLabel(r)} ({fmt(n)})
                </option>
              ))}
            </select>
          </div>
          <Segmented value={metric} options={METRICS} onChange={(v) => (setMetric(v), setTip(null))} />

          <div ref={box} className="relative" onPointerLeave={() => !tip?.pinned && setTip(null)}>
            {!shapes ? (
              <div className="flex aspect-square items-center justify-center text-xs text-muted">Chargement de la carte…</div>
            ) : (
              <svg
                viewBox={`0 0 ${W} ${shapes.h}`}
                className="block h-auto w-full select-none"
                role="img"
                aria-label={region ? `Carte des départements : ${regionLabel(region)}` : 'Carte des régions et des départements'}
                // Appui hors d'un département : la bulle se ferme.
                onClick={(e) => e.target === e.currentTarget && setTip(null)}
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
                      <Outline shapes={shapes.main} code={tip?.code} />
                    ) : (
                      // Vue France : contour de la région survolée.
                      shapes.outlines
                        .filter((o) => o.region === tip?.code)
                        .map((o) => <path key={o.region} d={o.d} fill="none" stroke="var(--color-fg)" strokeWidth={2.2} strokeLinejoin="round" pointerEvents="none" />)
                    )}
                  </>
                )}
                {/* Ultramarins : une case par territoire (Antilles = Guadeloupe + Martinique), ou seulement ceux de la ligue choisie. */}
                {dom && (domOnly || !shapes.zoomed) && (() => {
                  const cells = DOM_CODES.filter(([c]) => !domOnly || regionOfDept(c) === region)
                  const cols = Math.min(3, cells.length)
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
                        return (
                          <g key={code}>
                            <rect
                              x={x}
                              y={y}
                              width={cw}
                              height={ch}
                              rx={4}
                              fill={shade(code)}
                              stroke={tip?.code === code ? 'var(--color-fg)' : 'var(--color-line)'}
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
                <div className="font-bold">{tipIsRegion ? regionLabel(tip.code) : `${tip.code} · ${nameOf(tip.code)}`}</div>
                {tipAgg ? (
                  <div className="mt-1 grid grid-cols-[1fr_auto] gap-x-2 text-muted">
                    <span>Joueurs</span>
                    <b className={`tabular-nums ${metric === 'players' ? 'text-accent' : 'text-fg'}`}>{fmt(tipAgg.n)}</b>
                    <span>Mesurés par le staff</span>
                    <b className={`tabular-nums ${metric === 'measured' ? 'text-accent' : 'text-fg'}`}>{pct((100 * tipAgg.staff) / tipAgg.n)}</b>
                    <span>Profils repérés</span>
                    <b className={`tabular-nums ${metric === 'spotted' ? 'text-accent' : 'text-fg'}`}>{fmt(tipAgg.spotted)}</b>
                  </div>
                ) : (
                  <div className="mt-1 text-muted">Aucun joueur</div>
                )}
                {tipIsRegion && <div className="mt-1 text-[10px] text-muted">Cliquer pour voir la région</div>}
                {tip.pinned && tipAgg && (
                  <button className="btn-primary mt-2 w-full py-1.5 text-xs" onClick={() => go(tip.code)}>
                    Voir les joueurs →
                  </button>
                )}
              </div>
            )}
          </div>

          {legend.length > 0 && (
            <div className="flex items-center gap-2 text-[10px] text-muted">
              <span className="flex items-center gap-1">
                <span className="h-3 w-4 rounded-sm border border-line" style={{ background: fillFor(undefined) }} />
                aucun
              </span>
              <div className="flex flex-1">
                {legend.map(({ k, v }) => (
                  <div key={k} className="flex-1">
                    <div className="h-3" style={{ background: fillFor(k) }} />
                    <div className="mt-0.5 tabular-nums">{k === 0 ? '' : '> '}{show(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-[10px] text-muted">
            {metric === 'measured'
              ? 'Part des joueurs avec au moins une mesure prise par le staff (hors tailles déclarées à la licence).'
              : metric === 'spotted'
                ? fromAlerts.n
                  ? `Joueurs correspondant à au moins un de mes profils recherchés (${fromAlerts.n} profil${fromAlerts.n > 1 ? 's' : ''}).`
                  : 'Aucun profil recherché : joueurs dont la dernière taille atteint le 90e centile de leur année et de leur sexe.'
                : 'Joueurs licenciés dans un club du département.'}{' '}
            {region ? 'Toucher un département pour voir ses joueurs.' : 'Toucher une région pour la voir de plus près.'}
          </p>
        </section>

        <section className="card p-3">
          <div className="section-title">Départements les plus actifs{region ? ` · ${regionLabel(region)}` : ''}</div>
          {ranking.length ? (
            <ol className="flex flex-col">
              {ranking.map(({ code, a, v }, i) => (
                <li key={code}>
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-xs hover:bg-panel-2"
                    onClick={() => go(code)}
                    onMouseEnter={() => setTip(null)}
                  >
                    <span className={`w-5 shrink-0 text-center font-extrabold tabular-nums ${i < 3 ? 'text-accent' : 'text-muted'}`}>{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">
                        {code} · {nameOf(code)}
                      </span>
                      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-panel-2">
                        <span className="block h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(100 * v) / top}%` }} />
                      </span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <b>{show(v)}</b>
                      {metric !== 'players' && <span className="block text-[10px] text-muted">{fmt(a.n)} j.</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-6 text-center text-xs text-muted">Aucun département pour ces filtres.</p>
          )}
          <Link to="/alertes" className="mt-2 flex items-center gap-1.5 border-t border-line pt-2 text-[11px] font-bold text-muted hover:text-fg">
            <Icon name="target" className="h-3.5 w-3.5" /> Profils recherchés
          </Link>
        </section>
      </div>
    </div>
  )
}
