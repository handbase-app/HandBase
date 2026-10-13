import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAlerts } from '../alerts'
import { FranceMap, useDeptName } from '../components/FranceMap'
import { department, showDeptInPlayers, usePlayerFilter, useSessionState } from '../components/PlayerFilter'
import { Empty, Icon, Segmented } from '../components/ui'
import { alive, db, type Measurement, type Player } from '../db'
import { regionOfDept, useRegionLabel } from '../lists'
import { useThrottledQuery } from '../live'
import { can, useRole } from '../roles'

/*
 * Vue nationale (administrateurs) : carte des départements colorée selon un indicateur, chiffres clés et
 * classement. Tout est calculé sur l'appareil, en une passe sur les joueurs et les mesures ; rien n'est écrit.
 * Mêmes filtres que la liste Joueurs (usePlayerFilter, portée « national »), sauf la région et le département,
 * absents du panneau : c'est la carte qui les choisit (une région, puis un de ses départements). Recherche vocale « micro ✨ »
 * comme sur Joueurs : elle peut aussi choisir la région de la carte (« montre la Bretagne »), pas le département.
 * Carte : src/components/FranceMap.tsx (partagée avec le bilan de détection).
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

/** Filtres partagés avec la liste Joueurs, sauf la région et le département : c'est la carte qui les choisit ; recherche vocale. */
const HIDE = { hide: ['dept' as const, 'region' as const], voice: true }

const fmt = (n: number) => n.toLocaleString('fr-FR')
const pct = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: n < 10 ? 1 : 0 })} %`

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
  const nameOf = useDeptName()

  const pickRegion = (r: string) => setRegion(r)
  // Département touché (au doigt : 2e appui, après sa bulle) : liste des joueurs.
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

  return (
    // Écran large : carte et chiffres côte à côte (la page a toute la largeur en paysage / sur ordinateur ; sinon elle sort de la colonne).
    <div className="flex flex-col gap-3 lg:relative lg:left-1/2 lg:w-[min(68rem,calc(100vw-2rem))] lg:-translate-x-1/2 wide:static wide:w-auto wide:translate-x-0">
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

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[3fr_2fr] lg:items-start wide:grid wide:grid-cols-[3fr_2fr] wide:items-start">
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
          <Segmented value={metric} options={METRICS} onChange={setMetric} />

          <FranceMap
            region={region}
            fill={shade}
            onRegion={pickRegion}
            onDept={go}
            className="side:max-h-[max(28rem,calc(100dvh-15rem))]"
            ariaLabel={region ? `Carte des départements : ${regionLabel(region)}` : 'Carte des régions et des départements'}
            tip={({ code, isRegion, pinned }) => {
              // Bulle : chiffres d'une région (vue France) ou d'un département (vue d'une région, outre-mer).
              const a = isRegion ? stats.byRegion.get(code) : stats.by.get(code)
              return (
                <>
                  <div className="font-bold">{isRegion ? regionLabel(code) : `${code} · ${nameOf(code)}`}</div>
                  {a ? (
                    <div className="mt-1 grid grid-cols-[1fr_auto] gap-x-2 text-muted">
                      <span>Joueurs</span>
                      <b className={`tabular-nums ${metric === 'players' ? 'text-accent' : 'text-fg'}`}>{fmt(a.n)}</b>
                      <span>Mesurés par le staff</span>
                      <b className={`tabular-nums ${metric === 'measured' ? 'text-accent' : 'text-fg'}`}>{pct((100 * a.staff) / a.n)}</b>
                      <span>Profils repérés</span>
                      <b className={`tabular-nums ${metric === 'spotted' ? 'text-accent' : 'text-fg'}`}>{fmt(a.spotted)}</b>
                    </div>
                  ) : (
                    <div className="mt-1 text-muted">Aucun joueur</div>
                  )}
                  {isRegion && <div className="mt-1 text-[10px] text-muted">Cliquer pour voir la région</div>}
                  {pinned && a && (
                    <button className="btn-primary mt-2 w-full py-1.5 text-xs" onClick={() => go(code)}>
                      Voir les joueurs →
                    </button>
                  )}
                </>
              )
            }}
          />

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
