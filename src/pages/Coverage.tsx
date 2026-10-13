import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { alive, db, fmtDate, plural, save, today, type HBEvent, type Player, type Rewatch } from '../db'
import {
  birthYear,
  byLeftToSee,
  coverageByClub,
  coverageByPlace,
  coverageByYear,
  fedReport,
  filterPlayers,
  lastSights,
  livePlayers,
  NO_DEPT,
  percent,
  seasonOf,
  toSights,
  totalOf,
  type ClubCoverage,
  type CoveragePeriod,
  type CoverageSex,
  type PlaceOf,
  type Sight,
  type Tally,
} from '../coverage'
import { regionOfDept, useDepartments, useRegionLabel } from '../lists'
import { useThrottledQuery } from '../live'
import { MQ, useMedia } from '../layout'
import { can, currentUserId, useRole } from '../roles'
import { scoutId } from '../scouting'
import { loadTeams } from '../teams'
import { FranceMap, useDeptName } from '../components/FranceMap'
import { department } from '../components/PlayerFilter'
import { RewatchToggle } from '../components/Scouting'
import { Empty, Icon, Segmented, SectionTitle } from '../components/ui'
import { PlayerRow } from '../components/PlayerRow'
import { FollowStar } from '../components/Follow'

/*
 * Bilan de détection : couverture par génération (« X vus sur N »), clubs où il reste des joueurs à voir, et la liste de
 * ces joueurs ; carte de France (src/components/FranceMap.tsx) de la part des joueurs vus par région puis par
 * département, jusqu'aux clubs d'un département. Mêmes filtres partout : sexe, période, année, lieu. Un joueur est « vu » dès qu'un membre du staff l'a marqué vu ou a donné un avis (src/coverage.ts).
 * Uniquement des marques positives ou neutres : un joueur pas encore vu est « à voir », jamais autre chose.
 */

// ---------- Choix gardés sur l'appareil ----------

const PERIOD_KEY = 'handbase.bilan.period'
/** Même choix Garçons / Filles que les filtres de joueurs (PlayerFilter) : gardé sur l'appareil. */
const SEX_KEY = 'handbase.sexFilter'

function readKey<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}
function useStored<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => readKey(key, allowed, fallback))
  const set = (x: T) => {
    setV(x)
    try {
      localStorage.setItem(key, x)
    } catch {
      /* stockage indisponible */
    }
  }
  return [v, set]
}
const usePeriod = () => useStored<CoveragePeriod>(PERIOD_KEY, ['season', 'all'], 'season')

// ---------- Données ----------

/** Joueurs de la base, passages (« vu » et avis) et « à revoir » ; recalculé quand l'une de ces tables change. */
function useCoverageData() {
  return useThrottledQuery(
    async () => {
      const [players, seen, evals, deadEvents, rewatch] = await Promise.all([
        db.players.toArray(),
        db.seen.toArray(),
        db.evaluations.toArray(),
        db.events.filter((e) => !!e.deleted).primaryKeys(),
        db.rewatch.toArray(),
      ])
      const me = scoutId()
      const sights = toSights(seen, evals, {
        deadEvents: new Set(deadEvents as string[]),
        nameOfSeen: (s) => {
          const row = s as (typeof seen)[number]
          const mine = !!me && (row.createdBy ? row.createdBy === me : row.id.startsWith(`${me}:`))
          return mine ? 'toi' : row.createdByName
        },
      })
      const rw = new Map<string, Rewatch[]>()
      for (const r of alive(rewatch)) rw.set(r.playerId, [...(rw.get(r.playerId) ?? []), r])
      return { players, sights, rewatch: rw }
    },
    [],
    ['players', 'seen', 'evaluations', 'events', 'rewatch'],
    300,
  )
}

/** Période choisie : saison en cours (1er septembre → 31 août) ou depuis toujours. */
function periodInfo(period: CoveragePeriod) {
  const s = seasonOf(today())
  return period === 'season'
    ? { range: s, label: `Saison ${s.label}`, long: `saison ${s.label} (du ${fmtDate(s.from)} au ${fmtDate(s.to)})` }
    : { range: undefined, label: 'Depuis toujours', long: 'depuis toujours' }
}

const yearLabel = (y: string) => y || 'Année inconnue'
const clubLabel = (name: string) => name || 'Club non renseigné'

// ---------- Petits éléments ----------

function Bar({ t, className = '' }: { t: Tally; className?: string }) {
  const p = t.total ? (t.seen / t.total) * 100 : 0
  return (
    <span className={`block h-1.5 overflow-hidden rounded-full bg-panel-2 ${className}`}>
      <span className="block h-full rounded-full bg-accent" style={{ width: `${p}%` }} />
    </span>
  )
}

/** « 3 à voir » (bleu, neutre) ou « tous vus » (vert). */
function LeftBadge({ t }: { t: Tally }) {
  const left = t.total - t.seen
  return left > 0 ? (
    <span className="shrink-0 rounded-full border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-sky-300">{left.toLocaleString('fr-FR')} à voir</span>
  ) : (
    <span className="shrink-0 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-emerald-300">tous vus ✓</span>
  )
}

const vusSur = (t: Tally) => `${t.seen.toLocaleString('fr-FR')} vu${t.seen > 1 ? 's' : ''} sur ${t.total.toLocaleString('fr-FR')}`

function Filters({
  sex,
  setSex,
  period,
  setPeriod,
  showSex = true,
  years,
  year = null,
  setYear,
}: {
  sex: CoverageSex
  setSex: (v: CoverageSex) => void
  period: CoveragePeriod
  setPeriod: (v: CoveragePeriod) => void
  showSex?: boolean
  /** Années proposées (sinon pas de choix d'année) ; null : toutes. */
  years?: string[]
  year?: string | null
  setYear?: (v: string | null) => void
}) {
  const season = seasonOf(today())
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap [&_button]:min-h-8">
      {showSex && (
        <div className="sm:w-72">
          <Segmented<CoverageSex>
            value={sex}
            onChange={setSex}
            options={[
              { value: 'all', label: 'Tous' },
              { value: 'M', label: 'Garçons' },
              { value: 'F', label: 'Filles' },
            ]}
          />
        </div>
      )}
      <div className="sm:w-80">
        <Segmented<CoveragePeriod>
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'season', label: `Saison ${season.label}` },
            { value: 'all', label: 'Depuis toujours' },
          ]}
        />
      </div>
      {years && setYear && (
        // Année : '*' pour toutes ('' est l'année inconnue).
        <select
          className={`field min-h-8 py-1 text-xs sm:w-48 ${year !== null ? 'border-accent font-bold' : ''}`}
          aria-label="Année de naissance"
          value={year ?? '*'}
          onChange={(e) => setYear(e.target.value === '*' ? null : e.target.value)}
        >
          <option value="*">Toutes les années</option>
          {years.map((y) => (
            <option key={y || 'inconnue'} value={y}>
              {yearLabel(y)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

// ---------- Carte ----------

/**
 * Part des joueurs vus : une seule teinte (sarcelle), du plus clair au plus soutenu. Jamais de rouge : un lieu peu vu
 * n'est pas « mauvais », il reste simplement des joueurs à voir. Gris : aucun joueur avec ces filtres.
 * Échelle ajustée aux zones affichées (du moins vu au plus vu), pour que les écarts se voient même quand toutes les
 * zones sont proches (ex. régions entre 38 et 47 %) ; la légende donne les vraies valeurs.
 */
const TEAL = '#14b8a6'
const NO_PLAYER = 'var(--color-panel-2)'
type Scale = { lo: number; hi: number }
const FULL: Scale = { lo: 0, hi: 1 }
const share = (t: Tally) => t.seen / t.total
/** Échelle des zones affichées : de la plus faible à la plus forte part de vus (au moins 10 points d'écart). */
function scaleOf(ts: Iterable<Tally>): Scale {
  const v = [...ts].filter((t) => t.total).map(share)
  if (!v.length) return FULL
  let lo = Math.min(...v)
  let hi = Math.max(...v)
  if (hi - lo < 0.1) {
    const mid = (lo + hi) / 2
    lo = Math.max(0, mid - 0.05)
    hi = Math.min(1, lo + 0.1)
    lo = hi - 0.1
  }
  return { lo, hi }
}
const fillOf = (t?: Tally, sc: Scale = FULL) => {
  if (!t?.total) return NO_PLAYER
  const k = Math.min(1, Math.max(0, (share(t) - sc.lo) / (sc.hi - sc.lo)))
  // Courbe un peu accentuée au milieu, du très clair (8 %) au très soutenu (100 %).
  return `color-mix(in srgb, ${TEAL} ${Math.round(8 + 92 * k)}%, var(--color-panel))`
}

function MapLegend({ sc }: { sc: Scale }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => Math.round(100 * (sc.lo + k * (sc.hi - sc.lo))))
  const adjusted = sc.lo > 0 || sc.hi < 1
  return (
    <div className="flex items-start gap-3 text-[10px] text-muted">
      <span className="flex shrink-0 items-center gap-1">
        <span className="h-3 w-4 rounded-sm border border-line" style={{ background: NO_PLAYER }} />
        aucun joueur
      </span>
      <div className="min-w-0 flex-1">
        <div className="h-3 rounded-sm" style={{ background: `linear-gradient(to right, ${fillOf({ seen: sc.lo, total: 1 }, sc)}, ${fillOf({ seen: sc.hi, total: 1 }, sc)})` }} />
        <div className="mt-0.5 flex justify-between tabular-nums">
          {ticks.map((v, i) => (
            <span key={i}>{v} %</span>
          ))}
        </div>
        {adjusted && <div className="mt-0.5">Échelle ajustée aux zones affichées, du moins vu au plus vu.</div>}
      </div>
    </div>
  )
}

/** Fil d'Ariane du lieu : « France › Région Sud › Var (83) » ; chaque étape avant la dernière ramène à elle. */
function Crumbs({ steps }: { steps: { label: string; go?: () => void }[] }) {
  return (
    <nav aria-label="Lieu" className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs">
      {steps.map((s, i) => {
        const last = i === steps.length - 1
        return (
          <span key={i} className="flex min-w-0 items-center gap-x-1">
            {i > 0 && <span className="text-muted">›</span>}
            {last || !s.go ? (
              <span className="min-h-8 truncate py-1.5 font-extrabold" aria-current={last ? 'location' : undefined}>
                {s.label}
              </span>
            ) : (
              <button className="min-h-8 truncate rounded px-1 py-1.5 font-bold text-muted underline decoration-dotted underline-offset-2 hover:text-fg" onClick={s.go}>
                {s.label}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}

/** Ligne d'une région ou d'un département : vus sur total, barre, joueurs à voir ; un toucher l'ouvre. */
function PlaceRow({ label, t, sc, onClick }: { label: string; t: Tally; sc?: Scale; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card flex min-h-11 items-center gap-3 px-3 py-2 text-left transition hover:border-accent">
      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: fillOf(t, sc) }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{label}</span>
        <span className="mt-1 flex items-center gap-2 text-[10px] text-muted">
          <span className="shrink-0">
            <b className="text-fg">{percent(t.seen, t.total)} %</b> · {vusSur(t)}
          </span>
          <Bar t={t} className="w-12 sm:w-20" />
        </span>
      </span>
      <LeftBadge t={t} />
      <span className="shrink-0 text-muted">›</span>
    </button>
  )
}

// ---------- État de la page, dans l'adresse ----------

type View = 'map' | 'years'
const VIEW_KEY = 'handbase.bilan.view'
/** Vue France : couleur par région (celle qu'on touche) ou par département. */
const MAP_BY_KEY = 'handbase.bilan.mapBy'
/** Derniers choix de la session (adresse du bilan sans paramètre : menu, accueil). */
const QUERY_KEY = 'handbase.bilan.q'
const UNKNOWN_YEAR = 'inconnue'

/**
 * Tout ce que l'on a choisi sur le bilan : filtres, vue, lieu, club, « Déjà vus » ouvert. Gardé dans l'adresse
 * (/bilan?s=F&p=saison&v=carte&a=2008&r=93&d=83&c=<club>&vus=1) : le retour (de l'appli ou du navigateur) le retrouve
 * tel quel, et l'adresse se partage. Année : null toutes, '' année inconnue. Lieu : '' toute la France ; NO_DEPT :
 * département non renseigné. Club : null aucun, '' club non renseigné.
 */
export type BilanState = {
  sex: CoverageSex
  period: CoveragePeriod
  view: View
  mapBy: 'region' | 'dept'
  year: string | null
  region: string
  dept: string
  club: string | null
  seenOpen: boolean
}

function parseBilan(q: URLSearchParams): BilanState {
  const one = <T extends string>(v: string | null, allowed: readonly T[], key: string, fallback: T): T =>
    v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : readKey(key, allowed, fallback)
  const p = q.get('p')
  const v = q.get('v')
  const a = q.get('a')
  return {
    // Absents de l'adresse : les choix gardés sur l'appareil.
    sex: one(q.get('s'), ['all', 'M', 'F'] as const, SEX_KEY, 'all'),
    period: p === 'saison' ? 'season' : p === 'tout' ? 'all' : readKey<CoveragePeriod>(PERIOD_KEY, ['season', 'all'], 'season'),
    view: v === 'carte' ? 'map' : v === 'generations' ? 'years' : readKey<View>(VIEW_KEY, ['map', 'years'], 'map'),
    mapBy: one(q.get('m'), ['region', 'dept'] as const, MAP_BY_KEY, 'region'),
    year: a === null ? null : a === UNKNOWN_YEAR ? '' : a,
    region: q.get('r') ?? '',
    dept: q.get('d') ?? '',
    club: q.get('c'),
    seenOpen: q.get('vus') === '1',
  }
}

/** Paramètres de l'adresse (sans « ? »). */
function bilanQuery(st: BilanState): string {
  const q = new URLSearchParams()
  q.set('s', st.sex)
  q.set('p', st.period === 'season' ? 'saison' : 'tout')
  q.set('v', st.view === 'map' ? 'carte' : 'generations')
  if (st.mapBy === 'dept') q.set('m', 'dept')
  if (st.year !== null) q.set('a', st.year || UNKNOWN_YEAR)
  if (st.region) q.set('r', st.region)
  if (st.dept) q.set('d', st.dept)
  if (st.club !== null) q.set('c', st.club)
  if (st.seenOpen) q.set('vus', '1')
  return q.toString()
}

function sessionQuery(): string | null {
  try {
    return sessionStorage.getItem(QUERY_KEY)
  } catch {
    return null
  }
}

/**
 * État du bilan lu dans l'adresse ; `set` le change (sans nouvelle entrée d'historique) ; `search` : « ?… » à garder
 * sur les fiches ouvertes depuis le bilan (/bilan/joueurs/:pid?…), pour y revenir à l'identique.
 */
export function useBilanState() {
  const [params, setParams] = useSearchParams()
  const raw = params.toString()
  // Adresse sans paramètre (menu, accueil) : derniers choix de la session.
  const saved = raw ? null : sessionQuery()
  const query = saved ?? raw
  const st = useMemo(() => parseBilan(new URLSearchParams(query)), [query])
  useEffect(() => {
    if (saved) setParams(new URLSearchParams(saved), { replace: true })
  }, [saved, setParams])
  useEffect(() => {
    if (!raw) return
    try {
      sessionStorage.setItem(QUERY_KEY, raw)
    } catch {
      /* stockage indisponible */
    }
  }, [raw])
  const set = (patch: Partial<BilanState>) => {
    // Préférences de l'appareil : sexe (commun aux filtres de joueurs), période, vue, couleur de la carte.
    const keep: [keyof BilanState, string][] = [
      ['sex', SEX_KEY],
      ['period', PERIOD_KEY],
      ['view', VIEW_KEY],
      ['mapBy', MAP_BY_KEY],
    ]
    for (const [k, key] of keep)
      if (patch[k] !== undefined)
        try {
          localStorage.setItem(key, String(patch[k]))
        } catch {
          /* stockage indisponible */
        }
    setParams(new URLSearchParams(bilanQuery({ ...st, ...patch })), { replace: true })
  }
  return { st, set, search: `?${bilanQuery(st)}` }
}

/** Joueurs d'un club comme dans « Qui ? » : à voir, puis déjà vus, chacun par nom. */
export function whoOrder(club: ClubCoverage<Player>) {
  const byName = (a: Player, b: Player) => a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' }) || a.firstName.localeCompare(b.firstName, 'fr')
  return { toSee: [...club.toSee].sort(byName), seen: [...club.seenPlayers].sort(byName) }
}

/** Calculs du bilan pour un état donné (page, fiche ouverte depuis le bilan) ; refaits seulement quand un filtre ou les données changent. */
export function useBilanModel(st: BilanState) {
  const data = useCoverageData()
  const lists = useDepartments()
  const { sex, period, year, region, dept } = st
  // Lieu d'un joueur : département du n° de club (ou de licence, ou saisi), région selon la liste des départements.
  const place = useMemo<PlaceOf<Player>>(() => ({ deptOf: department, regionOf: (d) => regionOfDept(d) }), [lists]) // eslint-disable-line react-hooks/exhaustive-deps
  // Jamais à un survol ; la base n'est pas relue.
  const last = useMemo(() => (data ? lastSights(data.sights, periodInfo(period).range) : new Map<string, Sight>()), [data, period])
  // Carte : sexe et année (elle montre tous les lieux).
  const forMap = useMemo(() => (data ? filterPlayers(data.players, { sex, year }, place) : []), [data, sex, year, place])
  const byPlace = useMemo(() => coverageByPlace(forMap, last, place), [forMap, last, place])
  // Générations : sexe et lieu (chaque carte est une année).
  const inPlace = useMemo(() => (data ? filterPlayers(data.players, { sex, region, dept }, place) : []), [data, sex, region, dept, place])
  const years = useMemo(() => coverageByYear(inPlace, last), [inPlace, last])
  // Clubs : tous les filtres.
  const clubs = useMemo(() => coverageByClub(year === null ? inPlace : inPlace.filter((p) => birthYear(p) === year), last), [inPlace, year, last])
  // Années proposées : toutes celles de la base (quel que soit le lieu), la plus récente d'abord.
  const allYears = useMemo(() => {
    const ys = new Set(data ? livePlayers(data.players).map(birthYear) : [])
    if (year !== null) ys.add(year)
    return [...ys].sort((a, b) => (!a ? 1 : !b ? -1 : b.localeCompare(a)))
  }, [data, year])
  const club = st.club === null ? undefined : clubs.find((c) => c.key === st.club)
  return { data, last, byPlace, years, clubs, allYears, club, yearText: year === null ? 'Toutes les années' : yearLabel(year) }
}

/** Ce que les listes « Qui ? » du bilan partagent : état de l'adresse (pour les fiches) et « Déjà vus » ouvert. */
const WhoCtx = createContext<{ search: string; seenOpen: boolean; setSeenOpen: (v: boolean) => void }>({ search: '', seenOpen: false, setSeenOpen: () => {} })

// ---------- Page ----------

export default function Coverage() {
  const role = useRole()
  const regionLabel = useRegionLabel()
  const deptName = useDeptName()
  // Filtres communs à la carte, aux générations et aux clubs : dans l'adresse, retrouvés au retour d'une fiche joueur.
  const { st, set, search } = useBilanState()
  const { sex, period, view, mapBy, year, region, dept } = st
  const { data, last, byPlace, years, clubs, allYears, club, yearText } = useBilanModel(st)
  const side = useMedia(MQ.side)
  const whereRef = useRef<HTMLDivElement>(null)
  const who = useMemo(() => ({ search, seenOpen: st.seenOpen, setSeenOpen: (v: boolean) => set({ seenOpen: v }) }), [search]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!can.viewCoverage(role)) return <Empty>Le bilan de détection est réservé aux administrateurs et aux encadrants.</Empty>
  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const total = totalOf(clubs)
  const deptText = (d: string) => (d === NO_DEPT ? 'Département non renseigné' : `${deptName(d)} (${d})`)

  const setSex = (v: CoverageSex) => set({ sex: v })
  const setPeriod = (v: CoveragePeriod) => set({ period: v })
  const setView = (v: View) => set({ view: v })
  const setMapBy = (v: 'region' | 'dept') => set({ mapBy: v })
  const closeClub = () => set({ club: null, seenOpen: false })
  const pickYear = (y: string | null) => set({ year: y, club: null, seenOpen: false })
  const goFrance = () => set({ region: '', dept: '', club: null, seenOpen: false })
  const pickRegion = (r: string) => set({ region: r, dept: '', club: null, seenOpen: false })
  const pickDept = (d: string) => set({ region: d === NO_DEPT ? '' : (regionOfDept(d) ?? ''), dept: d, club: null, seenOpen: false })
  const pickClub = (k: string) => set({ club: club?.key === k ? null : k, seenOpen: false })
  // Générations : un toucher choisit l'année (un 2e toucher revient à toutes) ; au téléphone, on descend vers ses clubs.
  const pickCard = (y: string | null) => {
    pickYear(y === year ? null : y)
    if (!side) requestAnimationFrame(() => whereRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const crumbs = [
    { label: 'France', go: goFrance },
    ...(region ? [{ label: regionLabel(region), go: () => pickRegion(region) }] : []),
    ...(dept ? [{ label: deptText(dept), go: club ? closeClub : undefined }] : []),
    ...(dept && club ? [{ label: clubLabel(club.name) }] : []),
  ]
  // Ordinateur, un club choisi dans un département : la liste des clubs remplace la carte (à gauche), ses joueurs à
  // voir passent à droite. Le fil (ou un nouveau toucher sur le club) ramène à la carte.
  const clubMode = side && !!dept && !!club
  const where = dept ? deptText(dept) : region ? regionLabel(region) : ''
  const clubList = (inline: boolean) =>
    clubs.length ? (
      <ClubList key={`${sex}|${year}|${region}|${dept}|${period}`} clubs={clubs} inline={inline} selected={club?.key} onPick={pickClub} label={yearText} last={last} rewatch={data.rewatch} />
    ) : (
      <Empty>Aucun joueur ici avec ces filtres.</Empty>
    )

  // Carte : couleur d'un département (vue France « par région » : celle de sa région).
  // Échelle des couleurs : zones affichées (régions de France, départements de la région ou de France).
  const byRegionView = !region && mapBy === 'region'
  const sc = scaleOf(
    byRegionView ? byPlace.byRegion.values() : region ? [...byPlace.byDept].filter(([d]) => regionOfDept(d) === region).map(([, t]) => t) : byPlace.byDept.values(),
  )
  const fill = (code: string) => fillOf(byRegionView ? byPlace.byRegion.get(regionOfDept(code) ?? '') : byPlace.byDept.get(code), sc)
  // À côté de la carte : les régions (France), les départements (région), les clubs (département).
  const deptRows = byLeftToSee([...byPlace.byDept].filter(([d]) => (region ? regionOfDept(d) === region : !regionOfDept(d))))
  const side2 = dept ? (
    <section>
      <SectionTitle info="Clubs du département, du plus grand nombre de joueurs à voir au plus petit. Touche un club pour la liste des joueurs.">
        Où aller ? · {yearText}
      </SectionTitle>
      {clubList(true)}
    </section>
  ) : region ? (
    <section>
      <SectionTitle info="Départements de la région, du plus grand nombre de joueurs à voir au plus petit. Touche un département (ou la carte) pour ses clubs.">
        Départements · {regionLabel(region)}
      </SectionTitle>
      {deptRows.length ? (
        <div className="flex flex-col gap-2">
          {deptRows.map(([d, t]) => (
            <PlaceRow key={d} label={deptText(d)} t={t} sc={sc} onClick={() => pickDept(d)} />
          ))}
        </div>
      ) : (
        <Empty>Aucun joueur dans cette région avec ces filtres.</Empty>
      )}
    </section>
  ) : (
    <section>
      <SectionTitle info="Régions, du plus grand nombre de joueurs à voir au plus petit. Touche une région (ou la carte) pour ses départements.">Régions</SectionTitle>
      {byPlace.total ? (
        <div className="flex flex-col gap-2">
          {byLeftToSee(byPlace.byRegion).map(([r, t]) => (
            <PlaceRow key={r} label={regionLabel(r)} t={t} sc={sc} onClick={() => pickRegion(r)} />
          ))}
          {/* Départements hors découpage (numéro inconnu) et joueurs sans département : choisis directement. */}
          {deptRows.map(([d, t]) => (
            <PlaceRow key={d} label={deptText(d)} t={t} sc={sc} onClick={() => pickDept(d)} />
          ))}
          {byPlace.noDept.total > 0 && <PlaceRow label={deptText(NO_DEPT)} t={byPlace.noDept} onClick={() => pickDept(NO_DEPT)} />}
        </div>
      ) : (
        <Empty>{sex === 'all' ? 'Aucun joueur dans la base avec ces filtres.' : `Aucun${sex === 'F' ? 'e fille' : ' garçon'} avec ces filtres.`}</Empty>
      )}
    </section>
  )

  return (
    <WhoCtx.Provider value={who}>
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <BackButton fallback="/" label="ACCUEIL" className="self-start" />
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold">Bilan de détection</h1>
            <p className="text-[11px] text-muted">Un joueur est vu dès qu’un membre du staff l’a marqué « vu » ou a donné un avis sur lui.</p>
          </div>
          <Link to="/bilan/rapport" className="btn-ghost min-h-8 shrink-0 px-3 py-1.5 text-xs">
            <Icon name="list" className="h-3.5 w-3.5" />
            Rapport Fédé
          </Link>
        </div>
        <Filters sex={sex} setSex={setSex} period={period} setPeriod={setPeriod} years={allYears} year={year} setYear={pickYear} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Crumbs steps={crumbs} />
          <div className="sm:w-64 [&_button]:min-h-8">
            <Segmented<View>
              value={view}
              onChange={setView}
              options={[
                { value: 'map', label: 'Carte', icon: 'map' },
                { value: 'years', label: 'Générations', icon: 'users' },
              ]}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-[11px]">
          <span className="min-w-0 shrink">
            <b className="text-sm">{percent(total.seen, total.total)} %</b>{' '}
            <span className="text-muted">
              · {vusSur(total)}
              {year !== null && ` · ${yearText}`}
            </span>
          </span>
          <Bar t={total} className="min-w-12 flex-1" />
        </div>
      </div>

      {view === 'map' ? (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 side:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {clubMode && club ? (
            <section data-keep-scroll="bilan-clubs" className="side:sticky side:top-[calc(var(--hdr)+1rem)] side:max-h-[calc(100dvh-var(--hdr)-2rem)] side:overflow-y-auto">
              <SectionTitle info="Clubs du département, du plus grand nombre de joueurs à voir au plus petit. Touche un autre club pour changer, ou le département dans le fil pour revenir à la carte.">
                Où aller ? · {deptText(dept)} · {yearText}
              </SectionTitle>
              {clubList(false)}
            </section>
          ) : (
          <section className="card flex flex-col gap-2 p-3 side:sticky side:top-[calc(var(--hdr)+1rem)]">
            {!region && (
              <div className="[&_button]:min-h-8">
                <Segmented<'region' | 'dept'>
                  value={mapBy}
                  onChange={setMapBy}
                  options={[
                    { value: 'region', label: 'Par région' },
                    { value: 'dept', label: 'Par département' },
                  ]}
                />
              </div>
            )}
            <FranceMap
              region={region}
              selected={dept}
              fill={fill}
              onRegion={pickRegion}
              onDept={pickDept}
              touch="select"
              className="side:max-h-[calc(100dvh-var(--hdr)-15rem)]"
              ariaLabel={`Part des joueurs vus${where ? ` : ${where}` : ' par région et par département'}`}
              tip={({ code, isRegion }) => {
                const t = isRegion ? byPlace.byRegion.get(code) : byPlace.byDept.get(code)
                return (
                  <>
                    <div className="font-bold">{isRegion ? regionLabel(code) : deptText(code)}</div>
                    {t?.total ? (
                      <>
                        <div className="mt-1">
                          <b className="text-base">{percent(t.seen, t.total)} %</b> <span className="text-muted">vus</span>
                        </div>
                        <div className="text-muted">{vusSur(t)}</div>
                        <div className={t.total > t.seen ? 'text-sky-300' : 'text-emerald-300'}>
                          {t.total > t.seen ? `${(t.total - t.seen).toLocaleString('fr-FR')} à voir` : 'tous vus ✓'}
                        </div>
                      </>
                    ) : (
                      <div className="mt-1 text-muted">Aucun joueur avec ces filtres</div>
                    )}
                    {isRegion && <div className="mt-1 text-[10px] text-muted">Toucher pour voir ses départements</div>}
                  </>
                )
              }}
            />
            <MapLegend sc={sc} />
            <p className="text-[10px] text-muted">
              Part des joueurs vus ({periodInfo(period).label.toLowerCase()}, {year === null ? 'toutes les années' : year ? `nés en ${year}` : 'année de naissance inconnue'}).{' '}
              {dept ? 'Toucher un autre département pour changer.' : region ? 'Toucher un département pour voir ses clubs.' : 'Toucher une région pour la voir de plus près.'}
            </p>
          </section>
          )}
          <div ref={whereRef}>
            {clubMode && club ? (
              <Who club={club} label={yearText} last={last} rewatch={data.rewatch} />
            ) : (
              side2
            )}
          </div>
        </div>
      ) : !years.length ? (
        <Empty>Aucun joueur ici avec ces filtres.</Empty>
      ) : (
        <>
          <section>
            <SectionTitle info="Une carte par année de naissance. Touche une génération pour ne voir qu’elle (carte, clubs et joueurs) ; touche-la encore pour revenir à toutes les années.">
              Par génération{where ? ` · ${where}` : ''}
            </SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 side:grid-cols-4 xl:grid-cols-6">
              {[{ year: null as string | null, ...totalOf(years) }, ...years].map((y) => {
                const on = y.year === year
                return (
                  <button
                    key={y.year ?? 'toutes'}
                    onClick={() => pickCard(y.year)}
                    aria-pressed={on}
                    className={`card flex min-w-0 flex-col gap-1.5 p-3 text-left transition hover:border-accent ${on ? 'border-accent bg-accent/10' : ''}`}
                  >
                    <span className={`font-extrabold ${y.year ? 'text-lg' : 'text-sm leading-7'}`}>{y.year === null ? 'Toutes' : yearLabel(y.year)}</span>
                    <span className="text-[11px] text-muted">{vusSur(y)}</span>
                    <Bar t={y} />
                    <span className="text-[11px] font-bold">
                      {percent(y.seen, y.total)} %{' '}
                      {y.total > y.seen ? (
                        <span className="font-normal text-sky-300">· {(y.total - y.seen).toLocaleString('fr-FR')} à voir</span>
                      ) : (
                        <span className="font-normal text-emerald-300">· tous vus ✓</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <div ref={whereRef} className="grid scroll-mt-20 grid-cols-[minmax(0,1fr)] items-start gap-4 side:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <section>
              <SectionTitle info="Clubs, du plus grand nombre de joueurs à voir au plus petit. Touche un club pour la liste des joueurs.">
                Où aller ? · {yearText}
                {where ? ` · ${where}` : ''}
              </SectionTitle>
              {clubList(!side)}
            </section>
            {side && (
              <section data-keep-scroll="bilan-qui" className="sticky top-[calc(var(--hdr)+1rem)] max-h-[calc(100dvh-var(--hdr)-2rem)] overflow-y-auto">
                <SectionTitle>Qui ?</SectionTitle>
                {club ? <Who club={club} label={yearText} last={last} rewatch={data.rewatch} /> : <Empty>Choisis un club pour voir les joueurs qu’il reste à voir.</Empty>}
              </section>
            )}
          </div>
        </>
      )}
    </div>
    </WhoCtx.Provider>
  )
}

// ---------- Où aller ? ----------

/** Nombre de clubs montrés d'abord (toute la France, toutes les années : des centaines). */
const CLUBS_STEP = 40

/** Clubs, du plus grand nombre de joueurs à voir au plus petit ; `inline` : la liste « Qui ? » s'ouvre sous le club touché. */
function ClubList({
  clubs,
  inline,
  selected,
  onPick,
  label,
  last,
  rewatch,
}: {
  clubs: ClubCoverage<Player>[]
  inline: boolean
  selected?: string
  onPick: (key: string) => void
  label: string
  last: Map<string, Sight>
  rewatch: Map<string, Rewatch[]>
}) {
  const [limit, setLimit] = useState(() => Math.max(CLUBS_STEP, clubs.findIndex((c) => c.key === selected) + 1))
  return (
    <div className="flex flex-col gap-2">
      {clubs.slice(0, limit).map((c) => {
        const on = c.key === selected
        return (
          <div key={c.key || 'aucun'} className="flex flex-col gap-2">
            <button
              onClick={() => onPick(c.key)}
              aria-expanded={on}
              className={`card flex min-h-11 items-center gap-3 px-3 py-2 text-left transition hover:border-accent ${on ? 'border-accent bg-accent/10' : ''}`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-bold ${c.key ? '' : 'text-muted italic'}`}>{clubLabel(c.name)}</span>
                <span className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                  <span className="shrink-0">{vusSur(c)}</span>
                  <Bar t={c} className="w-16 sm:w-24" />
                </span>
              </span>
              <LeftBadge t={c} />
              {inline && <span className={`shrink-0 text-muted transition ${on ? 'rotate-90' : ''}`}>›</span>}
            </button>
            {on && inline && <Who club={c} label={label} last={last} rewatch={rewatch} />}
          </div>
        )
      })}
      {clubs.length > limit && (
        <button className="btn-ghost min-h-8 py-1.5 text-xs" onClick={() => setLimit(limit + CLUBS_STEP * 2)}>
          Afficher plus de clubs ({(clubs.length - limit).toLocaleString('fr-FR')} autres)
        </button>
      )}
    </div>
  )
}

// ---------- Qui ? ----------

function Who({ club, label, last, rewatch }: { club: ClubCoverage<Player>; label: string; last: Map<string, Sight>; rewatch: Map<string, Rewatch[]> }) {
  const role = useRole()
  // « Déjà vus » ouvert et état du bilan : dans l'adresse (retrouvés au retour d'une fiche).
  const { search, seenOpen: showSeen, setSeenOpen: setShowSeen } = useContext(WhoCtx)
  const [adding, setAdding] = useState<string[] | null>(null)
  const { toSee, seen: seenP } = whoOrder(club)
  // Fiche ouverte dans le bilan : les joueurs du club à côté (ordinateur) ou ‹ › (téléphone), retour à l'identique.
  const linkTo = (p: Player) => ({ to: `/bilan/joueurs/${p.id}${search}` })
  const addEvents = can.manageEvents(role)
  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-extrabold">{clubLabel(club.name)}</div>
          <div className="text-[11px] text-muted">
            {label} · {toSee.length ? `${plural(toSee.length, 'joueur')} à voir` : 'tous vus ✓'}
          </div>
        </div>
        {addEvents && toSee.length > 1 && (
          <button className="btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={() => setAdding(toSee.map((p) => p.id))} title="Ajouter tous les joueurs à voir de ce club à un événement à venir">
            <Icon name="calendar" className="h-3.5 w-3.5" />
            Tous à un événement…
          </button>
        )}
      </div>

      {toSee.length > 0 && (
        <div className="flex flex-col gap-2">
          {toSee.map((p) => (
            <PlayerRow
              key={p.id}
              p={p}
              link={linkTo(p)}
              sub={p.birthDate?.slice(0, 4) ?? ''}
              rewatch={<RewatchToggle playerId={p.id} rows={rewatch.get(p.id)} />}
              follow={<FollowStar id={p.id} />}
              actions={
                addEvents && (
                  <button type="button" className="-my-2 shrink-0 p-2 text-muted hover:text-accent" title="Ajouter à un événement" aria-label="Ajouter à un événement" onClick={() => setAdding([p.id])}>
                    <Icon name="calendar" className="h-4 w-4" />
                  </button>
                )
              }
            />
          ))}
        </div>
      )}

      {seenP.length > 0 && (
        <div className="border-t border-line pt-1">
          <button className="flex min-h-8 w-full items-center gap-2 text-left text-[11px] font-bold text-emerald-300" aria-expanded={showSeen} onClick={() => setShowSeen(!showSeen)}>
            <Icon name="eye" className="h-3.5 w-3.5" />
            <span className="flex-1">Déjà vus ({seenP.length})</span>
            <span className={`text-muted transition ${showSeen ? 'rotate-90' : ''}`}>›</span>
          </button>
          {showSeen && (
            <div className="mt-1 flex flex-col gap-2">
              {seenP.map((p) => {
                const s = last.get(p.id)
                return (
                  <PlayerRow
                    key={p.id}
                    p={p}
                    link={linkTo(p)}
                    sub={[p.birthDate?.slice(0, 4), s && `vu le ${fmtDate(s.day)}${s.by ? `, par ${s.by}` : ''}`].filter(Boolean).join(' · ')}
                    follow={<FollowStar id={p.id} />}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
      {adding && <AddToEventDialog playerIds={adding} onClose={() => setAdding(null)} />}
    </div>
  )
}

// ---------- Ajouter à un événement ----------

/** Événements à venir où je peux ajouter des joueurs (organisateur, administrateur, participant) ; un toucher les ajoute. */
export function AddToEventDialog({ playerIds, onClose }: { playerIds: string[]; onClose: () => void }) {
  const role = useRole()
  const [done, setDone] = useState<string | null>(null)
  const events = useLiveQuery(async () => {
    await loadTeams()
    const rows = alive(await db.events.where('date').aboveOrEqual(today()).toArray())
    return rows.filter((e) => !e.archived && (can.editEvent(role, e) || can.contributeEvent(role, e))).sort((a, b) => a.date.localeCompare(b.date))
  }, [role])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const n = playerIds.length
  const who = n > 1 ? plural(n, 'joueur') : 'ce joueur'

  async function add(ev: HBEvent) {
    const cur = (await db.events.get(ev.id)) ?? ev
    const ids = cur.playerIds ?? []
    const added = playerIds.filter((id) => !ids.includes(id))
    if (added.length) {
      // « Ajouté par » : posé ici pour l'affichage ; le serveur le refait (supabase/024).
      const me = currentUserId()
      await save<HBEvent>('events', {
        ...cur,
        playerIds: [...ids, ...added],
        ...(me && { addedBy: { ...cur.addedBy, ...Object.fromEntries(added.map((id) => [id, me])) } }),
      })
    }
    setDone(added.length ? `${added.length > 1 ? plural(added.length, 'joueur') + ' ajoutés' : 'Joueur ajouté'} à « ${cur.name} ».` : `Déjà dans « ${cur.name} ».`)
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="card flex max-h-[80dvh] w-full max-w-md flex-col gap-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-extrabold">Ajouter {who} à un événement</div>
        {done ? (
          <p className="text-xs text-emerald-300">{done}</p>
        ) : events === undefined ? (
          <div className="text-xs text-muted">Chargement…</div>
        ) : events.length ? (
          <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
            {events.map((e) => {
              const inside = playerIds.filter((id) => e.playerIds?.includes(id)).length
              return (
                <button key={e.id} onClick={() => void add(e)} className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-left text-xs hover:border-accent">
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{e.name}</b>
                    <span className="text-muted">
                      {fmtDate(e.date)}
                      {e.place ? ` · ${e.place}` : ''}
                    </span>
                  </span>
                  {inside > 0 && <span className="shrink-0 text-[10px] text-muted">{inside === n ? 'déjà dedans' : `${inside} déjà dedans`}</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted">Aucun événement à venir que tu peux compléter. Crée-le d’abord dans Événements.</p>
        )}
        <div className="flex justify-end gap-2">
          {done && (
            <button className="btn-ghost px-4 text-xs" onClick={() => setDone(null)}>
              Un autre événement
            </button>
          )}
          <button className="btn-primary px-4 text-xs" onClick={onClose}>
            {done ? 'OK' : 'Fermer'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- Rapport chiffré ----------

const cell = (t: Tally) => (t.total ? `${t.seen.toLocaleString('fr-FR')}/${t.total.toLocaleString('fr-FR')}` : '–')
const pct = (t: Tally) => (t.total ? `${percent(t.seen, t.total)} %` : '–')

/**
 * Rapport pour la fédération, à imprimer (ou enregistrer en PDF) : seulement des nombres par génération, sexe et club,
 * et les totaux ; aucun nom de joueur. Feuille blanche à l'écran comme à l'impression.
 */
export function CoverageReport() {
  const role = useRole()
  const data = useCoverageData()
  const [period, setPeriod] = usePeriod()
  const info = periodInfo(period)
  const lists = useDepartments()
  const regionLabel = useRegionLabel()
  const report = useMemo(
    () => (data ? fedReport(data.players, lastSights(data.sights, periodInfo(period).range), { deptOf: department, regionOf: (d) => regionOfDept(d) }) : null),
    [data, period, lists], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // Régions par ordre alphabétique, région inconnue à la fin.
  const regions = useMemo(
    () => (report ? [...report.regions].sort((a, b) => (!a.region ? 1 : !b.region ? -1 : regionLabel(a.region).localeCompare(regionLabel(b.region), 'fr'))) : []),
    [report, regionLabel],
  )

  if (!can.viewCoverage(role)) return <Empty>Le bilan de détection est réservé aux administrateurs et aux encadrants.</Empty>
  if (!report) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const noSex = report.total.all.total - report.total.M.total - report.total.F.total
  // Cellules : nom à gauche (retour à la ligne permis), nombres à droite sur une ligne.
  const th = 'border-b border-neutral-400 px-1 py-1 font-bold sm:px-1.5'
  const td = 'border-b border-neutral-200 px-1 py-1 sm:px-1.5'
  const num = 'text-right tabular-nums whitespace-nowrap'
  const name = 'text-left break-words'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="no-print flex flex-col gap-2">
        <BackButton fallback="/bilan" label="BILAN DE DÉTECTION" className="self-start" />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 flex-1 text-lg font-extrabold">Rapport Fédé</h1>
          <button className="btn-primary min-h-8 px-4 py-1.5 text-xs" onClick={() => window.print()}>
            Imprimer / PDF
          </button>
        </div>
        <p className="text-[11px] text-muted">Seulement des nombres, par génération, sexe, région et club : aucun nom de joueur.</p>
        <Filters sex="all" setSex={() => {}} period={period} setPeriod={setPeriod} showSex={false} />
      </div>

      <article className="report rounded-lg bg-white p-3 text-[11px] text-neutral-900 shadow sm:p-6 print:rounded-none print:p-0 print:shadow-none">
        <div className="mb-3 border-b-2 border-neutral-900 pb-2">
          <div className="text-[10px] font-bold tracking-widest text-neutral-500">HANDBASE</div>
          <h2 className="text-base font-extrabold">Bilan de détection</h2>
          <div>
            Édité le {fmtDate(today())} · Période : {info.long}
          </div>
          <div className="text-neutral-600">Un joueur est compté « vu » dès qu’un membre du staff l’a marqué vu ou a donné un avis sur lui. Chiffres : vus/joueurs dans la base ; G. garçons, F. filles, Ens. ensemble.</div>
        </div>

        <table className="mb-4 w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} ${name}`}>Génération</th>
              <th className={`${th} ${num}`}>G.</th>
              <th className={`${th} ${num}`}>F.</th>
              <th className={`${th} ${num}`}>Ens.</th>
              <th className={`${th} ${num}`}>%</th>
            </tr>
          </thead>
          <tbody>
            <tr className="font-bold">
              <td className={`${td} ${name}`}>Toutes</td>
              <td className={`${td} ${num}`}>{cell(report.total.M)}</td>
              <td className={`${td} ${num}`}>{cell(report.total.F)}</td>
              <td className={`${td} ${num}`}>{cell(report.total.all)}</td>
              <td className={`${td} ${num}`}>{pct(report.total.all)}</td>
            </tr>
            {report.years.map((y) => (
              <tr key={y.year || 'inconnue'}>
                <td className={`${td} ${name}`}>{yearLabel(y.year)}</td>
                <td className={`${td} ${num}`}>{cell(y.M)}</td>
                <td className={`${td} ${num}`}>{cell(y.F)}</td>
                <td className={`${td} ${num}`}>{cell(y.all)}</td>
                <td className={`${td} ${num}`}>{pct(y.all)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {regions.length > 1 && (
          <table className="mb-4 w-full border-collapse">
            <thead>
              <tr>
                <th className={`${th} ${name}`}>Région (club)</th>
                <th className={`${th} ${num}`}>G.</th>
                <th className={`${th} ${num}`}>F.</th>
                <th className={`${th} ${num}`}>Ens.</th>
                <th className={`${th} ${num}`}>%</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => (
                <tr key={r.region || 'inconnue'}>
                  <td className={`${td} ${name} ${r.region ? '' : 'italic'}`}>{r.region ? regionLabel(r.region) : 'Région non renseignée'}</td>
                  <td className={`${td} ${num}`}>{cell(r.M)}</td>
                  <td className={`${td} ${num}`}>{cell(r.F)}</td>
                  <td className={`${td} ${num}`}>{cell(r.all)}</td>
                  <td className={`${td} ${num}`}>{pct(r.all)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {report.years.map((y) => (
          <section key={y.year || 'inconnue'} className="mb-4 break-inside-avoid">
            <h3 className="mb-1 text-[12px] font-extrabold">
              {yearLabel(y.year)} — {cell(y.all)} vus ({percent(y.all.seen, y.all.total)} %)
            </h3>
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col />
                <col className="w-[17%]" />
                <col className="w-[15%]" />
                <col className="w-[17%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={`${th} ${name}`}>Club</th>
                  <th className={`${th} ${num}`}>G.</th>
                  <th className={`${th} ${num}`}>F.</th>
                  <th className={`${th} ${num}`}>Ens.</th>
                  <th className={`${th} ${num}`}>%</th>
                </tr>
              </thead>
              <tbody>
                {y.clubs.map((c) => (
                  <tr key={c.name || 'aucun'}>
                    <td className={`${td} ${name} ${c.name ? '' : 'italic'}`}>{clubLabel(c.name)}</td>
                    <td className={`${td} ${num}`}>{cell(c.M)}</td>
                    <td className={`${td} ${num}`}>{cell(c.F)}</td>
                    <td className={`${td} ${num}`}>{cell(c.all)}</td>
                    <td className={`${td} ${num} text-neutral-600`}>{pct(c.all)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {noSex > 0 && <p className="text-neutral-600">« Ens. » compte aussi {plural(noSex, 'joueur')} dont le sexe n’est pas renseigné.</p>}
        {!report.years.length && <p>Aucun joueur dans la base.</p>}
      </article>
    </div>
  )
}
