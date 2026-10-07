import { geoConicConformal, geoPath } from 'd3-geo'
import type { FeatureCollection, Geometry } from 'geojson'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAlerts } from '../alerts'
import { department, useSessionState } from '../components/PlayerFilter'
import { Empty, Icon, Segmented } from '../components/ui'
import { alive, db, type Measurement } from '../db'
import { useDepartments } from '../lists'
import { useThrottledQuery } from '../live'
import { can, useRole } from '../roles'

/*
 * Vue nationale (administrateurs) : carte des départements colorée selon un indicateur, chiffres clés et
 * classement. Tout est calculé sur l'appareil, en une passe sur les joueurs et les mesures ; rien n'est écrit.
 *
 * Contours des départements : france-geojson de Grégoire David (departements-version-simplifiee.geojson,
 * https://github.com/gregoiredavid/france-geojson), issus d'Admin Express IGN — Licence Ouverte Etalab.
 * Coordonnées arrondies à 3 décimales (src/assets/departements.json, ~220 Ko), chargées à la demande.
 */

type Metric = 'players' | 'measured' | 'spotted'
type Sex = 'all' | 'M' | 'F'

const METRICS: { value: Metric; label: string }[] = [
  { value: 'players', label: 'Joueurs' },
  { value: 'measured', label: 'Mesurés par le staff' },
  { value: 'spotted', label: 'Profils repérés' },
]

/** Auteur des tailles reprises de l'export des licences (src/importLicences.ts) : pas une mesure du staff. */
const DECLARED = 'Licence FFHB (déclarée)'

/** Ce qu'il faut savoir de chaque joueur pour la carte (lu une fois, puis filtré sans relire la base). */
interface Row {
  id: string
  dept?: string
  club?: string
  year: string
  sex?: 'M' | 'F'
  /** Au moins une mesure prise par le staff. */
  staff: boolean
  /** Dernière taille connue (mesurée ou déclarée). */
  height?: number
}

async function loadRows(): Promise<Row[]> {
  const [players, measurements] = await Promise.all([db.players.toArray(), db.measurements.toArray()])
  const staff = new Set<string>()
  const height = new Map<string, Measurement>()
  for (const m of measurements) {
    if (m.deleted) continue
    if (m.author !== DECLARED) staff.add(m.playerId)
    if (m.criterionId === 'taille' && typeof m.value === 'number') {
      const cur = height.get(m.playerId)
      if (!cur || m.date > cur.date || (m.date === cur.date && m.updatedAt > cur.updatedAt)) height.set(m.playerId, m)
    }
  }
  // Mêmes joueurs que les alertes : ni fiches fondues, ni fiches hors cadre.
  return alive(players)
    .filter((p) => !p.mergedInto && p.review !== 'refused')
    .map((p) => ({
      id: p.id,
      dept: department(p),
      club: p.clubCode || p.club || undefined,
      year: p.birthDate?.slice(0, 4) ?? '',
      sex: p.sex,
      staff: staff.has(p.id),
      height: height.get(p.id)?.value as number | undefined,
    }))
}

/**
 * Repli quand aucune alerte n'est utilisable : joueurs dont la dernière taille atteint le 90e centile
 * de leur année de naissance et de leur sexe (groupes d'au moins 10 joueurs mesurés).
 */
function tallest(rows: Row[]) {
  const groups = new Map<string, number[]>()
  for (const r of rows) {
    if (r.height === undefined || !r.year || !r.sex) continue
    const k = `${r.year}|${r.sex}`
    const g = groups.get(k)
    if (g) g.push(r.height)
    else groups.set(k, [r.height])
  }
  const p90 = new Map<string, number>()
  for (const [k, hs] of groups) {
    if (hs.length < 10) continue
    hs.sort((a, b) => a - b)
    p90.set(k, hs[Math.floor(0.9 * (hs.length - 1))])
  }
  const out = new Set<string>()
  for (const r of rows) {
    const t = p90.get(`${r.year}|${r.sex}`)
    if (t !== undefined && r.height !== undefined && r.height >= t) out.add(r.id)
  }
  return out
}

interface Agg {
  n: number
  staff: number
  spotted: number
}

// Carte : métropole + Corse ; encarts Île-de-France (zoom) et outre-mer (une case).
// La largeur est fixée ; la hauteur suit celle du pays. Encarts dans la Manche (en haut à gauche) et en Espagne.
const W = 600
const IDF = ['75', '77', '78', '91', '92', '93', '94', '95']
const IDF_BOX = { x: 4, y: 4, w: 120, h: 104 }
const DOM_W = 96
const DOM_H = 50
/** Corse : un seul département pour nous (n° de club « 20 »). */
const codeOf = (c: string) => (c === '2A' || c === '2B' ? '20' : c)

interface Shape {
  code: string
  d: string
}

function useGeo() {
  const [geo, setGeo] = useState<FeatureCollection<Geometry, { code: string; nom: string }> | null>(null)
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

const fmt = (n: number) => n.toLocaleString('fr-FR')
const pct = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: n < 10 ? 1 : 0 })} %`

/** Ouvre la liste Joueurs filtrée sur ce département (et l'année / le sexe choisis ici). */
function showDeptInPlayers(code: string, year: string, sex: Sex) {
  try {
    const set = (k: string, v: unknown) => sessionStorage.setItem(`handbase.filter.joueurs.${k}`, JSON.stringify(v))
    set('dept', code)
    set('year', year)
    for (const f of ['group', 'club', 'q', 'minH']) set(f, '')
    set('position', 'all')
    set('hand', 'all')
    set('quarter', 0)
    set('withSecondary', false)
    sessionStorage.setItem('handbase.joueurs.view', JSON.stringify('base'))
    localStorage.setItem('handbase.sexFilter', sex)
  } catch {
    /* stockage indisponible */
  }
}

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
  const rows = useThrottledQuery(loadRows, [], ['players', 'measurements'])
  const alerts = useAlerts()
  const geo = useGeo()
  const lists = useDepartments()
  const [metric, setMetric] = useSessionState<Metric>('handbase.national.metric', 'players')
  const [year, setYear] = useSessionState('handbase.national.year', '')
  const [sex, setSex] = useSessionState<Sex>('handbase.national.sex', 'all')

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
  const spottedIds = useMemo(() => (fromAlerts.n ? fromAlerts.ids : tallest(rows ?? [])), [fromAlerts, rows])

  const years = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) if (r.year && (sex === 'all' || r.sex === sex)) m.set(r.year, (m.get(r.year) ?? 0) + 1)
    return [...m].sort((a, b) => b[0].localeCompare(a[0]))
  }, [rows, sex])

  // Une passe sur les joueurs retenus : totaux et chiffres de chaque département.
  const stats = useMemo(() => {
    const by = new Map<string, Agg>()
    const clubs = new Set<string>()
    const total: Agg = { n: 0, staff: 0, spotted: 0 }
    for (const r of rows ?? []) {
      if ((year && r.year !== year) || (sex !== 'all' && r.sex !== sex)) continue
      const s = spottedIds.has(r.id) ? 1 : 0
      const st = r.staff ? 1 : 0
      total.n++
      total.staff += st
      total.spotted += s
      if (r.club) clubs.add(r.club)
      if (!r.dept) continue
      let a = by.get(r.dept)
      if (!a) by.set(r.dept, (a = { n: 0, staff: 0, spotted: 0 }))
      a.n++
      a.staff += st
      a.spotted += s
    }
    return { by, clubs: clubs.size, total }
  }, [rows, year, sex, spottedIds])

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
      ['97', 'Outre-mer'],
    ])
    for (const f of geo?.features ?? []) if (!m.has(codeOf(f.properties.code))) m.set(codeOf(f.properties.code), f.properties.nom)
    return m
  }, [geo])
  const nameOf = (code: string) => lists.find((d) => d.code === code)?.name ?? geoNames.get(code) ?? `Département ${code}`

  // Tracés calculés une fois (ils ne dépendent que du fichier) ; les couleurs changent seules.
  const shapes = useMemo(() => {
    if (!geo) return null
    const proj = geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitWidth(W - 16, geo)
    const main = geoPath(proj.translate([proj.translate()[0] + 8, proj.translate()[1] + 8]))
    const h = Math.ceil(main.bounds(geo)[1][1]) + 8
    const idf = { ...geo, features: geo.features.filter((f) => IDF.includes(f.properties.code)) }
    const zoom = geoPath(
      geoConicConformal().parallels([44, 49]).rotate([-3, 0]).fitExtent([[IDF_BOX.x + 6, IDF_BOX.y + 18], [IDF_BOX.x + IDF_BOX.w - 6, IDF_BOX.y + IDF_BOX.h - 6]], idf),
    )
    const toShape = (p: typeof main) => (f: (typeof geo.features)[number]): Shape => ({ code: codeOf(f.properties.code), d: p(f) ?? '' })
    return { main: geo.features.map(toShape(main)), idf: idf.features.map(toShape(zoom)), h, dom: { x: 8, y: h - 8 - DOM_H, w: DOM_W, h: DOM_H } }
  }, [geo])

  // Survol (souris) ou appui (téléphone) : bulle d'info. Au doigt, un 2e appui ouvre la liste des joueurs.
  const box = useRef<HTMLDivElement>(null)
  const pointer = useRef('mouse')
  const [tip, setTip] = useState<{ code: string; x: number; y: number; w: number; h: number; pinned?: boolean } | null>(null)
  const place = (e: ReactPointerEvent | React.MouseEvent, code: string, pinned?: boolean) => {
    const r = box.current!.getBoundingClientRect()
    setTip({ code, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height, pinned })
  }
  const go = (code: string) => {
    showDeptInPlayers(code, year, sex)
    navigate('/joueurs')
  }
  const handlers = (code: string) => ({
    onPointerDown: (e: ReactPointerEvent) => (pointer.current = e.pointerType),
    onPointerMove: (e: ReactPointerEvent) => e.pointerType === 'mouse' && place(e, code),
    onPointerLeave: (e: ReactPointerEvent) => e.pointerType === 'mouse' && setTip(null),
    onClick: (e: React.MouseEvent) => {
      if (pointer.current === 'mouse' || (tip?.pinned && tip.code === code)) go(code)
      else place(e, code, true)
    },
  })
  const pathProps = (s: Shape) => ({
    d: s.d,
    fill: shade(s.code),
    stroke: 'var(--color-bg)',
    strokeWidth: 0.6,
    className: 'cursor-pointer transition-[fill] duration-300',
    ...handlers(s.code),
  })

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

  if (!rows) return <div className="py-20 text-center text-sm text-muted">Calcul de la vue nationale…</div>

  const t = stats.total
  const tipAgg = tip ? stats.by.get(tip.code) : undefined
  const legend = b.length ? [Math.min(...values.values()), ...b] : []
  const kpis = [
    { label: 'Joueurs', value: fmt(t.n) },
    { label: 'Clubs', value: fmt(stats.clubs) },
    { label: 'Départements', value: fmt(stats.by.size) },
    { label: 'Mesurés par le staff', value: t.n ? pct((100 * t.staff) / t.n) : '—' },
    { label: 'Profils repérés', value: fmt(t.spotted), main: true },
  ]

  return (
    // Écran large : la vue sort de la colonne de l'appli pour mettre la carte et les chiffres côte à côte.
    <div className="flex flex-col gap-3 lg:relative lg:left-1/2 lg:w-[min(68rem,calc(100vw-2rem))] lg:-translate-x-1/2">
      <div className="flex items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold">Vue nationale</h1>
          <p className="text-[11px] text-muted">Données de cet appareil, par département du club</p>
        </div>
        <Link to="/joueurs" className="text-[11px] font-bold text-muted underline">
          Tous les joueurs
        </Link>
      </div>

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
          <Segmented value={metric} options={METRICS} onChange={(v) => (setMetric(v), setTip(null))} />
          <div className="flex gap-2">
            <select className={`field py-1.5 text-xs ${year ? 'border-accent font-bold' : ''}`} value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">Toutes les années</option>
              {years.map(([y, n]) => (
                <option key={y} value={y}>
                  {y} ({fmt(n)})
                </option>
              ))}
            </select>
            <div className="flex shrink-0 overflow-hidden rounded-md border border-line text-xs font-bold">
              {(
                [
                  ['all', 'Tous'],
                  ['M', 'G.'],
                  ['F', 'F.'],
                ] as const
              ).map(([v, label]) => (
                <button key={v} onClick={() => setSex(v)} title={v === 'M' ? 'Garçons' : v === 'F' ? 'Filles' : 'Garçons et filles'} className={`px-3 py-1.5 ${sex === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div ref={box} className="relative" onPointerLeave={() => !tip?.pinned && setTip(null)}>
            {!shapes ? (
              <div className="flex aspect-square items-center justify-center text-xs text-muted">Chargement de la carte…</div>
            ) : (
              <svg viewBox={`0 0 ${W} ${shapes.h}`} className="block h-auto w-full select-none"
                role="img"
                aria-label="Carte des départements"
                // Appui hors d'un département : la bulle se ferme.
                onClick={(e) => e.target === e.currentTarget && setTip(null)}
              >
                {shapes.main.map((s, i) => (
                  <path key={i} {...pathProps(s)} />
                ))}
                <Outline shapes={shapes.main} code={tip?.code} />
                {/* Encart Île-de-France : Paris et la petite couronne sont trop petits à l'échelle du pays. */}
                <rect x={IDF_BOX.x} y={IDF_BOX.y} width={IDF_BOX.w} height={IDF_BOX.h} rx={8} fill="var(--color-panel)" stroke="var(--color-line)" />
                <text x={IDF_BOX.x + 8} y={IDF_BOX.y + 13} fontSize={10} fontWeight={700} fill="var(--color-muted)">
                  Île-de-France
                </text>
                {shapes.idf.map((s, i) => (
                  <path key={i} {...pathProps(s)} />
                ))}
                <Outline shapes={shapes.idf} code={tip?.code} />
                {/* Outre-mer : les n° de club en 97 ne disent pas quel territoire ; une seule case. */}
                <rect x={shapes.dom.x} y={shapes.dom.y} width={shapes.dom.w} height={shapes.dom.h} rx={8} fill="var(--color-panel)" stroke="var(--color-line)" />
                <text x={shapes.dom.x + 8} y={shapes.dom.y + 13} fontSize={10} fontWeight={700} fill="var(--color-muted)">
                  Outre-mer
                </text>
                <rect
                  x={shapes.dom.x + 8}
                  y={shapes.dom.y + 20}
                  width={shapes.dom.w - 16}
                  height={shapes.dom.h - 28}
                  rx={4}
                  fill={shade('97')}
                  stroke={tip?.code === '97' ? 'var(--color-fg)' : 'var(--color-line)'}
                  className="cursor-pointer transition-[fill] duration-300"
                  {...handlers('97')}
                />
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
                <div className="font-bold">
                  {tip.code} · {nameOf(tip.code)}
                </div>
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
                {legend.map((v, i) => (
                  <div key={i} className="flex-1">
                    <div className="h-3" style={{ background: fillFor(i) }} />
                    <div className="mt-0.5 tabular-nums">{i === 0 ? '' : '> '}{show(v)}</div>
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
                  ? `Joueurs présents dans au moins une de mes alertes (${fromAlerts.n} alerte${fromAlerts.n > 1 ? 's' : ''}).`
                  : 'Aucune alerte : joueurs dont la dernière taille atteint le 90e centile de leur année et de leur sexe.'
                : 'Joueurs licenciés dans un club du département.'}{' '}
            Toucher un département pour voir ses joueurs.
          </p>
        </section>

        <section className="card p-3">
          <div className="section-title">Départements les plus actifs</div>
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
            <Icon name="bell" className="h-3.5 w-3.5" /> Alertes et profils repérés
          </Link>
        </section>
      </div>
    </div>
  )
}
