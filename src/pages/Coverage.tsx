import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import { useAlerts } from '../alerts'
import { BackButton } from '../backNav'
import { placeDepth, placeKey, placeParent, placeParents, placePlan, samePlace, type Place } from '../bilanNav'
import { alive, db, fmtDate, plural, today, type Player, type Rewatch } from '../db'
import {
  birthYear,
  clubKey,
  coverageByClub,
  coverageByPlace,
  coverageByYear,
  fedReport,
  filterPlayers,
  isShare,
  lastSights,
  livePlayers,
  measureOf,
  NO_DEPT,
  ONGLETS,
  percent,
  rankBy,
  seasonOf,
  sortClubs,
  staffMeasured,
  tallest,
  toSights,
  totalOf,
  type ClubCoverage,
  type CoveragePeriod,
  type CoverageSex,
  type Onglet,
  type PlaceOf,
  type Sight,
  type Tally,
} from '../coverage'
import { regionOfDept, useDepartments, useRegionLabel } from '../lists'
import { useThrottledQuery } from '../live'
import { MQ, useMedia } from '../layout'
import { can, useRole } from '../roles'
import { scoutId } from '../scouting'
import { FranceMap, useDeptName, type MapDot } from '../components/FranceMap'
import { OTHER_OM, OUTRE_MER, showOtherOM } from '../outreMer'
import { clubDots, dotRadius, hasPlacedClubs } from '../clubMap'
import { usePerimeter, useUnits } from '../installation'
import { deptInPerimeter, perimeterDepts, perimeterPlace, perimeterText } from '../perimeter'
import { department } from '../components/PlayerFilter'
import { RewatchToggle } from '../components/Scouting'
import { Empty, Icon, Segmented, SectionTitle } from '../components/ui'
import { PlayerRow } from '../components/PlayerRow'
import { AddToEventDialog } from '../components/AddToEvent'
import { FollowStar } from '../components/Follow'
import { VoiceSearch } from '../components/VoiceSearch'
import { bilanVoicePage, type BilanVoice } from '../voicePages'
import { useVoicePlaces } from '../voicePlaces'
import { AskQuestion } from '../components/AskQuestion'
import { SavedQuestions } from './Question'
import { decodeRecipe, encodeRecipe, hasConditions, outValueText, periodText, recipeChips, runRecipe, shareText, type Names, type Recipe } from '../recipe'
import { aggregate, aggValue, bilanOutput, isShareKind, questionPoints, rankAgg, rankDir, recipeAt, valueKind, type QAgg, type QClub, type QPoint } from '../bilanQuestion'
import { useQuestionModel } from '../questionModel'
import { RecipeChips, SaveForm, type RecipeModel } from '../components/RecipeChips'

/*
 * Bilan de détection (/bilan) : UNE carte de France (src/components/FranceMap.tsx) et des onglets de mesure, dans l'adresse
 * (?onglet=…) :
 *  - « Vus » (défaut ; administrateurs et encadrants) : part des joueurs vus. Un joueur est « vu » dès qu'un membre du
 *    staff l'a marqué vu ou a donné un avis (src/coverage.ts) ;
 *  - « Licenciés », « Mesurés par le staff », « Profils repérés » (administrateurs : l'ancienne vue nationale, /national
 *    y mène) : nombre de joueurs, part des joueurs avec une mesure du staff, nombre de joueurs d'au moins un profil recherché.
 * Pour tous les onglets : mêmes filtres (sexe, génération ; période pour « Vus »), même descente région → département →
 * club → joueurs, même échelle de couleurs adaptative ; à côté de la carte, le classement des zones suit l'onglet.
 * Département choisi et structure importée (clubs avec coordonnées, src/clubMap.ts) : la carte se recale sur lui, un point
 * par club (taille : nombre de joueurs, couleur : valeur de l'onglet) ; toucher un point = choisir le club dans la liste,
 * et survoler l'un met l'autre en avant. Sans structure, la carte reste celle de la région.
 * Recherche vocale « micro ✨ Filtrer » à côté des filtres (src/components/VoiceSearch.tsx, schéma : src/voicePages.ts) :
 * « les filles de 2011 dans le Var », « depuis toujours », « le club de Toulon », « efface tout » ; elle change les mêmes
 * choix que les boutons et la carte (l'adresse suit).
 * « Poser une question » (src/components/AskQuestion.tsx, src/recipe.ts) : une question libre (« les joueuses 2011 vues
 * une seule fois cette saison, par département ») dont la réponse est calculée sur l'appareil (src/pages/Question.tsx) ;
 * « Mes questions » : celles qu'on a enregistrées, relancées sans envoi. Réponse géographique (carte, tableau par club,
 * département ou région, nombre dans un lieu : src/bilanQuestion.ts) : elle reste ICI (?q=<recette>), un bandeau
 * « ✨ question ✕ » à la place des onglets ; carte, points des clubs et listes colorés et triés par la valeur de la question
 * (nombre, part, part vue, moyenne, âge) ; changer de lieu garde la question, ✕ la ferme (remplace l'adresse).
 * Uniquement des marques positives ou neutres : un joueur pas encore vu est « à voir », pas encore mesuré « à mesurer ».
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

/**
 * Onglets des administrateurs : joueurs mesurés par le staff (mesures lues seulement pour eux) et profils repérés —
 * joueurs d'au moins un profil recherché (hors profils sans condition, qui prennent tout le monde) ; sans profil
 * utilisable, les plus grands de leur génération (`tallest`, calculé sur toute la base : il ne bouge pas avec les filtres).
 */
function useNationalData(enabled: boolean, players: Player[] | undefined) {
  const meas = useThrottledQuery(async () => (enabled ? staffMeasured(await db.measurements.toArray()) : null), [enabled], ['measurements'], 300)
  const alerts = useAlerts()
  return useMemo(() => {
    if (!enabled || !meas || !players || !alerts) return undefined
    const ids = new Set<string>()
    let n = 0
    for (const a of alerts.alerts) {
      if (!a.players.length || a.players.length >= alerts.ctx.players.length) continue
      n++
      for (const p of a.players) ids.add(p.id)
    }
    return { staff: meas.staff, spotted: n ? ids : tallest(livePlayers(players), meas.height), profiles: n }
  }, [enabled, meas, players, alerts])
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
const fmt = (n: number) => n.toLocaleString('fr-FR')

// ---------- Ce que compte chaque onglet, en mots ----------

/**
 * Libellés de chaque onglet. `hit` : un joueur compté (« vu ») ; `todo` / `done` : ceux qui restent (« à voir ») et
 * tout le monde compté (« tous vus ✓ ») — seulement pour les onglets en part. Marques positives ou neutres seulement.
 */
export const TAB: Record<Onglet, { label: string; hit: string; todo?: string; done?: string; order: string; main: string; rest: string }> = {
  vus: { label: 'Vus', hit: 'vu', todo: 'à voir', done: 'tous vus ✓', order: 'du plus grand nombre de joueurs à voir au plus petit', main: 'À voir', rest: 'Déjà vus' },
  licencies: { label: 'Licenciés', hit: 'licencié', order: 'du plus grand nombre de joueurs au plus petit', main: 'Joueurs', rest: '' },
  mesures: {
    label: 'Mesurés par le staff',
    hit: 'mesuré',
    todo: 'à mesurer',
    done: 'tous mesurés ✓',
    order: 'du plus grand nombre de joueurs à mesurer au plus petit',
    main: 'À mesurer',
    rest: 'Déjà mesurés',
  },
  reperes: { label: 'Profils repérés', hit: 'repéré', order: 'du plus grand nombre de profils repérés au plus petit', main: 'Profils repérés', rest: 'Autres joueurs' },
}

const s = (n: number) => (n > 1 ? 's' : '')
/** Valeur principale d'une zone : « 45 % » (vus, mesurés) ou un nombre (licenciés, repérés). */
export const headline = (o: Onglet, t: Tally) => (isShare(o) ? `${percent(t.seen, t.total)} %` : fmt(o === 'licencies' ? t.total : t.seen))
/** Détail : « 12 vus sur 30 », « 30 joueurs », « 3 repérés sur 30 ». */
export const detail = (o: Onglet, t: Tally) =>
  o === 'licencies' ? plural(t.total, 'joueur') : `${fmt(t.seen)} ${TAB[o].hit}${s(t.seen)} sur ${fmt(t.total)}`
/** Unité de la valeur principale (bulle de la carte). */
const unit = (o: Onglet, t: Tally) => (o === 'licencies' ? `joueur${s(t.total)}` : `${TAB[o].hit}${s(isShare(o) ? 2 : t.seen)}`)

// ---------- Petits éléments ----------

/** Barre : part comptée (`t`), ou `ratio` (0 → 1) donné par la page (licenciés : par rapport à la plus grande zone). */
export function Bar({ t, ratio, className = '' }: { t: Tally; ratio?: number; className?: string }) {
  const p = 100 * (ratio ?? (t.total ? t.seen / t.total : 0))
  return (
    <span className={`block h-1.5 overflow-hidden rounded-full bg-panel-2 ${className}`}>
      <span className="block h-full rounded-full bg-accent" style={{ width: `${p}%` }} />
    </span>
  )
}

/** « 3 à voir » / « 3 à mesurer » (bleu, neutre), « tous vus ✓ » (vert), « 3 repérés » ; rien pour les licenciés. */
function LeftBadge({ t, o = 'vus' }: { t: Tally; o?: Onglet }) {
  const tab = TAB[o]
  const left = t.total - t.seen
  const pill = 'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap'
  if (o === 'reperes')
    return t.seen > 0 ? <span className={`${pill} border-accent/50 bg-accent/10 text-accent`}>{`${fmt(t.seen)} repéré${s(t.seen)}`}</span> : null
  if (!tab.todo) return null
  return left > 0 ? (
    <span className={`${pill} border-sky-500/50 bg-sky-500/10 text-sky-300`}>
      {fmt(left)} {tab.todo}
    </span>
  ) : (
    <span className={`${pill} border-emerald-500/50 bg-emerald-500/10 text-emerald-300`}>{tab.done}</span>
  )
}

function Filters({
  sex,
  setSex,
  period,
  setPeriod,
  showSex = true,
  showPeriod = true,
  years,
  year = null,
  setYear,
}: {
  sex: CoverageSex
  setSex: (v: CoverageSex) => void
  period: CoveragePeriod
  setPeriod: (v: CoveragePeriod) => void
  showSex?: boolean
  /** Période : seulement pour les joueurs vus. */
  showPeriod?: boolean
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
      {showPeriod && (
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
      )}
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
 * Couleur d'une zone : une seule teinte (sarcelle), du plus clair au plus soutenu. Jamais de rouge : un lieu peu vu
 * n'est pas « mauvais », il reste simplement des joueurs à voir. Gris : aucun joueur avec ces filtres.
 * Échelle ajustée aux zones affichées (de la plus faible à la plus forte valeur), pour que les écarts se voient même
 * quand toutes les zones sont proches (ex. régions entre 38 et 47 %) ; la légende donne les vraies valeurs. Nombres
 * (licenciés, repérés) : échelle en racine carrée, pour que Paris et le Nord n'écrasent pas le reste.
 */
const TEAL = '#14b8a6'
const NO_PLAYER = 'var(--color-panel-2)'
/** Point d'un club sans joueur avec ces filtres (carte d'un département) : gris neutre, visible sur le fond du département. */
const MUTED_DOT = 'color-mix(in srgb, var(--color-muted) 40%, var(--color-panel))'
/** Zone hors du périmètre du compte (aucune donnée reçue) : neutre, plus pâle qu'une zone sans joueur. */
const OUTSIDE = 'color-mix(in srgb, var(--color-muted) 12%, var(--color-bg))'
/** `count` : nombres (racine carrée) ; `digits` : valeurs (moyenne, mesure, âge), linéaire, avec leur unité. */
export type Scale = { lo: number; hi: number; count?: boolean; digits?: number; unit?: string }
const FULL: Scale = { lo: 0, hi: 1 }
const share = (t: Tally) => t.seen / t.total
const tr = (v: number, sc: Scale) => (sc.count ? Math.sqrt(v) : v)

/** Échelle des valeurs affichées : parts (au moins 10 points d'écart) ou nombres (`count`). */
export function scaleOfValues(values: Iterable<number>, count = false): Scale {
  const v = [...values]
  if (!v.length) return count ? { lo: 0, hi: 1, count } : FULL
  let lo = Math.min(...v)
  let hi = Math.max(...v)
  if (count) {
    if (hi === lo) lo = 0
    return { lo, hi: Math.max(hi, lo + 1), count }
  }
  if (hi - lo < 0.1) {
    const mid = (lo + hi) / 2
    lo = Math.max(0, mid - 0.05)
    hi = Math.min(1, lo + 0.1)
    lo = hi - 0.1
  }
  return { lo, hi }
}
/** Échelle de valeurs (moyenne d'avis, d'une mesure, âge moyen) : de la plus petite à la plus grande. */
export function scaleOfNumbers(values: number[], digits: number, unit?: string): Scale {
  if (!values.length) return { lo: 0, hi: 1, digits, unit }
  const hi = Math.max(...values)
  const lo = Math.min(...values)
  return { lo: hi - lo < 1e-9 ? hi - 1 : lo, hi, digits, unit }
}
/** Échelle de la part des joueurs vus des zones affichées. */
export const scaleOf = (ts: Iterable<Tally>): Scale => scaleOfValues([...ts].filter((t) => t.total).map(share))

/** Couleur d'une valeur (undefined : aucun joueur). */
export function fillAt(v: number | undefined, sc: Scale = FULL) {
  if (v === undefined) return NO_PLAYER
  const k = Math.min(1, Math.max(0, (tr(v, sc) - tr(sc.lo, sc)) / (tr(sc.hi, sc) - tr(sc.lo, sc) || 1)))
  // Du très clair (8 %) au très soutenu (100 %).
  return `color-mix(in srgb, ${TEAL} ${Math.round(8 + 92 * k)}%, var(--color-panel))`
}
/** Couleur de la part des joueurs vus d'une zone. */
export const fillOf = (t?: Tally, sc: Scale = FULL) => fillAt(t?.total ? share(t) : undefined, sc)

export function MapLegend({ sc, note = 'du moins vu au plus vu', title }: { sc: Scale; note?: string; title?: string }) {
  // Graduations régulières sur la teinte (en racine carrée pour les nombres), avec leur vraie valeur.
  const at = (k: number) => (sc.count ? (Math.sqrt(sc.lo) + k * (Math.sqrt(sc.hi) - Math.sqrt(sc.lo))) ** 2 : sc.lo + k * (sc.hi - sc.lo))
  // Nombres : chaque graduation une seule fois (petits effectifs : 0, 1, 2…).
  const num = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: sc.digits })}${sc.unit ? ` ${sc.unit}` : ''}`
  const ticks = [
    ...new Set([0, 0.25, 0.5, 0.75, 1].map((k) => (sc.count ? fmt(Math.round(at(k))) : sc.digits !== undefined ? num(at(k)) : `${Math.round(100 * at(k))} %`))),
  ]
  const adjusted = sc.count || sc.digits !== undefined || sc.lo > 0 || sc.hi < 1
  return (
    <div className="flex flex-col gap-1">
    {title && <div className="text-[11px] font-bold">{title}</div>}
    <div className="flex items-start gap-3 text-[10px] text-muted">
      <span className="flex shrink-0 items-center gap-1">
        <span className="h-3 w-4 rounded-sm border border-line" style={{ background: NO_PLAYER }} />
        aucun joueur
      </span>
      <div className="min-w-0 flex-1">
        <div className="h-3 rounded-sm" style={{ background: `linear-gradient(to right, ${fillAt(sc.lo, sc)}, ${fillAt(sc.hi, sc)})` }} />
        <div className="mt-0.5 flex justify-between tabular-nums">
          {ticks.map((v, i) => (
            <span key={i}>{v}</span>
          ))}
        </div>
        {adjusted && <div className="mt-0.5">Échelle ajustée aux zones affichées, {note}.</div>}
      </div>
    </div>
    </div>
  )
}

/** Fil d'Ariane du lieu : « France › Région Sud › Var (83) » ; chaque étape avant la dernière ramène à elle. */
export function Crumbs({ steps }: { steps: { label: string; go?: () => void }[] }) {
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

/** Barre des licenciés : par rapport à la plus grande zone de la liste ; sinon la part comptée. */
const ratioOf = (o: Onglet, t: Tally, max: number) => (o === 'licencies' ? t.total / (max || 1) : undefined)

/**
 * Ce que montrent la carte et les listes : la valeur d'un onglet, ou celle d'une question posée au bilan (questionLens).
 * `value` : couleur et classement ; `row` / `club` : ligne d'une zone ou d'un club ; `bar` : barre (null : aucune) ;
 * `tip` : bulle de la carte ; `label` : valeur en mots (lecteurs d'écran).
 */
type Lens = {
  name: string
  value: (t?: Tally) => number | undefined
  scale: (values: number[]) => Scale
  rank: <T extends Tally>(rows: Iterable<[string, T]>) => [string, T][]
  row: (t: Tally) => ReactNode
  club: (t: Tally) => ReactNode
  bar: (t: Tally, max: number) => { t: Tally; ratio?: number } | null
  badge: (t: Tally) => ReactNode
  tip: (t?: Tally) => ReactNode
  label: (t: Tally) => string
  /** Légende : ce que dit la couleur, et l'ordre de l'échelle. */
  title?: string
  note?: string
}

const noPlayerTip = <div className="mt-1 text-muted">Aucun joueur avec ces filtres</div>

/** Valeur d'un onglet du bilan. */
function ongletLens(o: Onglet): Lens {
  const tab = TAB[o]
  return {
    name: tab.label,
    value: (t) => (t ? measureOf(o, t) : undefined),
    scale: (v) => scaleOfValues(v, !isShare(o)),
    rank: (rows) => rankBy(o, rows),
    row: (t) =>
      o === 'licencies' ? (
        <>
          <b className="text-fg">{fmt(t.total)}</b> joueur{s(t.total)}
        </>
      ) : (
        <>
          <b className="text-fg">{headline(o, t)}</b> · {detail(o, t)}
        </>
      ),
    club: (t) => detail(o, t),
    bar: (t, max) => ({ t, ratio: ratioOf(o, t, max) }),
    badge: (t) => <LeftBadge t={t} o={o} />,
    tip: (t) =>
      t?.total ? (
        <>
          <div className="mt-1">
            <b className="text-base">{headline(o, t)}</b> <span className="text-muted">{unit(o, t)}</span>
          </div>
          {o !== 'licencies' && <div className="text-muted">{detail(o, t)}</div>}
          {tab.todo && <div className={t.total > t.seen ? 'text-sky-300' : 'text-emerald-300'}>{t.total > t.seen ? `${fmt(t.total - t.seen)} ${tab.todo}` : tab.done}</div>}
        </>
      ) : (
        noPlayerTip
      ),
    label: (t) => `${headline(o, t)} ${unit(o, t)}`,
    note: o === 'vus' ? undefined : 'de la plus faible à la plus forte valeur',
  }
}

/** Ligne d'une région ou d'un département : valeur montrée, barre, badge ; un toucher l'ouvre. */
function PlaceRow({ lens, label, t, color, max, onClick }: { lens: Lens; label: string; t: Tally; color: string; max: number; onClick: () => void }) {
  const bar = lens.bar(t, max)
  return (
    <button onClick={onClick} className="card flex min-h-11 items-center gap-3 px-3 py-2 text-left transition hover:border-accent">
      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{label}</span>
        <span className="mt-1 flex items-center gap-2 text-[10px] text-muted">
          <span className="min-w-0 truncate">{lens.row(t)}</span>
          {bar && <Bar t={bar.t} ratio={bar.ratio} className="w-12 shrink-0 sm:w-20" />}
        </span>
      </span>
      {lens.badge(t)}
      <span className="shrink-0 text-muted">›</span>
    </button>
  )
}

// ---------- État de la page, dans l'adresse ----------

type View = 'map' | 'years'
const VIEW_KEY = 'handbase.bilan.view'
/** Vue France : couleur par région (celle qu'on touche) ou par département. */
const MAP_BY_KEY = 'handbase.bilan.mapBy'
const CLUBS_AS_KEY = 'handbase.bilan.clubsAs'
/** Derniers choix de la session (adresse du bilan sans paramètre : menu, accueil). */
const QUERY_KEY = 'handbase.bilan.q'
const UNKNOWN_YEAR = 'inconnue'

/**
 * Tout ce que l'on a choisi sur le bilan : onglet, filtres, vue, lieu, club, « Déjà vus » ouvert. Gardé dans l'adresse
 * (/bilan?onglet=mesures&s=F&p=saison&v=carte&a=2008&r=93&d=83&c=<club>&vus=1) : le retour (de l'appli ou du navigateur)
 * le retrouve tel quel, et l'adresse se partage. Onglet absent : « Vus ». Année : null toutes, '' année inconnue. Lieu :
 * '' toute la France ; NO_DEPT : département non renseigné. Club : null aucun, '' club non renseigné.
 */
export type BilanState = {
  onglet: Onglet
  sex: CoverageSex
  period: CoveragePeriod
  view: View
  mapBy: 'region' | 'dept'
  /** Ordinateur, un club choisi dans un département avec ses clubs sur la carte : à gauche, la carte (points) ou la liste des clubs. */
  clubsAs: 'map' | 'list'
  year: string | null
  region: string
  dept: string
  club: string | null
  seenOpen: boolean
  /** Question posée au bilan (réponse géographique, src/bilanQuestion.ts) : recette sans son lieu, que porte le bilan ; null aucune. */
  q: Recipe | null
}

function parseBilan(q: URLSearchParams): BilanState {
  const one = <T extends string>(v: string | null, allowed: readonly T[], key: string, fallback: T): T =>
    v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : readKey(key, allowed, fallback)
  const o = q.get('onglet')
  const p = q.get('p')
  const v = q.get('v')
  const a = q.get('a')
  return {
    onglet: o && (ONGLETS as readonly string[]).includes(o) ? (o as Onglet) : 'vus',
    // Absents de l'adresse : les choix gardés sur l'appareil.
    sex: one(q.get('s'), ['all', 'M', 'F'] as const, SEX_KEY, 'all'),
    period: p === 'saison' ? 'season' : p === 'tout' ? 'all' : readKey<CoveragePeriod>(PERIOD_KEY, ['season', 'all'], 'season'),
    view: v === 'carte' ? 'map' : v === 'generations' ? 'years' : readKey<View>(VIEW_KEY, ['map', 'years'], 'map'),
    mapBy: one(q.get('m'), ['region', 'dept'] as const, MAP_BY_KEY, 'region'),
    clubsAs: q.get('cl') === 'liste' ? 'list' : q.get('cl') === 'carte' ? 'map' : readKey<'map' | 'list'>(CLUBS_AS_KEY, ['map', 'list'], 'map'),
    year: a === null ? null : a === UNKNOWN_YEAR ? '' : a,
    region: q.get('r') ?? '',
    dept: q.get('d') ?? '',
    club: q.get('c'),
    seenOpen: q.get('vus') === '1',
    q: decodeRecipe(q.get('q')),
  }
}

/** Paramètres de l'adresse (sans « ? »). */
function bilanQuery(st: BilanState): string {
  const q = new URLSearchParams()
  if (st.onglet !== 'vus') q.set('onglet', st.onglet)
  q.set('s', st.sex)
  q.set('p', st.period === 'season' ? 'saison' : 'tout')
  q.set('v', st.view === 'map' ? 'carte' : 'generations')
  if (st.mapBy === 'dept') q.set('m', 'dept')
  if (st.clubsAs === 'list') q.set('cl', 'liste')
  if (st.year !== null) q.set('a', st.year || UNKNOWN_YEAR)
  if (st.region) q.set('r', st.region)
  if (st.dept) q.set('d', st.dept)
  if (st.club !== null) q.set('c', st.club)
  if (st.seenOpen) q.set('vus', '1')
  if (st.q) q.set('q', encodeRecipe(st.q))
  return q.toString()
}

/**
 * Adresse du bilan ouvert sur une question (« Poser une question », « Mes questions ») : derniers choix de la session
 * (onglet, sexe…), le lieu de la question, la carte. À ouvrir avec l'état { bilanChain: [] } : le retour revient au bilan
 * d'avant la question (les étages au-dessus ne sont pas posés).
 */
export function bilanQuestionSearch(q: Recipe, p: Place): string {
  const base = parseBilan(new URLSearchParams(sessionQuery() ?? ''))
  return bilanQuery({ ...base, q, region: p.region, dept: p.dept, club: p.club, seenOpen: false, view: 'map' })
}

function sessionQuery(): string | null {
  try {
    return sessionStorage.getItem(QUERY_KEY)
  } catch {
    return null
  }
}

/** Onglets que ce rôle voit : « Vus » (bilan de détection), et les autres pour qui avait la vue nationale. */
export const tabsFor = (national: boolean): Onglet[] => (national ? [...ONGLETS] : ['vus'])

/**
 * État du bilan lu dans l'adresse ; `set` le change (sans nouvelle entrée d'historique) ; `search` : « ?… » à garder
 * sur les fiches ouvertes depuis le bilan (/bilan/joueurs/:pid?…), pour y revenir à l'identique. Un onglet que ce rôle
 * ne voit pas (adresse partagée, ancienne vue nationale) revient à « Vus ».
 */
/** État d'historique d'une entrée du bilan : clés des lieux des entrées du bilan en dessous (src/bilanNav.ts). */
type BilanNavState = { bilanChain?: string[] } | null
/** Retour remontant de plusieurs étages : après le saut dans l'historique, filtres à remettre et étages à empiler. */
let pendingPlace: { next: BilanState; push: Place[] } | null = null
/** Dernier état affiché : ses filtres (onglet, sexe, période…) suivent le retour, seul le lieu change. */
let lastBilan: BilanState | null = null

export function useBilanState() {
  const national = can.nationalView(useRole())
  const [params, setParams] = useSearchParams()
  const loc = useLocation()
  const nav = useNavigate()
  const navType = useNavigationType()
  const chain = (loc.state as BilanNavState)?.bilanChain
  const raw = params.toString()
  // Périmètre du compte (supabase/046) : sans autre choix, le bilan s'ouvre dessus (un comité : son département).
  const per = usePerimeter()
  const home = useMemo(() => (per ? perimeterPlace(per, regionOfDept) : null), [per])
  // Adresse sans paramètre (menu, accueil) : derniers choix de la session, sinon le périmètre.
  const saved = raw ? null : (sessionQuery() ?? (home ? bilanQuery({ ...parseBilan(new URLSearchParams()), region: home.region, dept: home.dept }) : null))
  const query = saved ?? raw
  const st = useMemo(() => {
    const p = parseBilan(new URLSearchParams(query))
    return tabsFor(national).includes(p.onglet) ? p : { ...p, onglet: 'vus' as const }
  }, [query, national])
  useEffect(() => {
    if (saved) setParams(new URLSearchParams(saved), { replace: true })
  }, [saved, setParams])
  useEffect(() => {
    if (!raw) return
    try {
      // La question n'est pas gardée : le bilan rouvert depuis le menu revient à ses onglets.
      const keep = new URLSearchParams(raw)
      keep.delete('q')
      sessionStorage.setItem(QUERY_KEY, keep.toString())
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
      ['clubsAs', CLUBS_AS_KEY],
    ]
    for (const [k, key] of keep)
      if (patch[k] !== undefined)
        try {
          localStorage.setItem(key, String(patch[k]))
        } catch {
          /* stockage indisponible */
        }
    const next = { ...st, ...patch }
    if (samePlace(st, next)) setParams(new URLSearchParams(bilanQuery(next)), { replace: true, state: loc.state })
    else goPlace(next)
  }
  // Lieu changé : l'historique reste la chaîne des étages (France → région → département → club), le retour remonte d'un étage.
  const withPlace = (next: BilanState, p: Place): BilanState => ({ ...next, region: p.region, dept: p.dept, club: p.club, seenOpen: samePlace(p, next) ? next.seenOpen : false })
  const stack = (next: BilanState, below: string[], top: Place, push: Place[]) => {
    let c = below
    for (const p of push) {
      c = [...c, placeKey(top)]
      nav({ pathname: loc.pathname, search: `?${bilanQuery(withPlace(next, p))}` }, { state: { bilanChain: c } })
      top = p
    }
  }
  const goPlace = (next: BilanState) => {
    const below = chain ?? []
    const plan = placePlan(below, st, next)
    if (plan.pop) {
      pendingPlace = { next, push: plan.push }
      nav(-plan.pop)
      return
    }
    if (plan.replace) nav({ pathname: loc.pathname, search: `?${bilanQuery(withPlace(next, plan.replace))}` }, { replace: true, state: { bilanChain: below } })
    stack(next, below, plan.replace ?? st, plan.push)
  }
  useEffect(() => {
    if (loc.pathname !== '/bilan' || !raw) return
    const pend = pendingPlace
    pendingPlace = null
    const prev = lastBilan
    lastBilan = st
    if (pend) {
      // Arrivé sur le parent commun : ses filtres deviennent ceux choisis, puis les étages en dessous.
      const here = withPlace(pend.next, st)
      if (bilanQuery(here) !== bilanQuery(st)) nav({ pathname: loc.pathname, search: `?${bilanQuery(here)}` }, { replace: true, state: loc.state })
      stack(pend.next, chain ?? [], st, pend.push)
      return
    }
    if (!chain) {
      // Bilan ouvert directement sur un lieu (menu, lien) : on pose les étages au-dessus, pour que le retour y remonte.
      if (placeDepth(st) === 0) nav({ pathname: loc.pathname, search: loc.search }, { replace: true, state: { bilanChain: [] } })
      else {
        const line = [...placeParents(st), st]
        nav({ pathname: loc.pathname, search: `?${bilanQuery(withPlace(st, line[0]))}` }, { replace: true, state: { bilanChain: [] } })
        stack(st, [], line[0], line.slice(1))
      }
      return
    }
    // Retour du navigateur sur un étage du bilan : on garde les filtres choisis entre-temps.
    if (navType === 'POP' && prev) {
      const merged = { ...withPlace(prev, st), q: st.q }
      if (bilanQuery(merged) !== bilanQuery(st)) setParams(new URLSearchParams(bilanQuery(merged)), { replace: true, state: loc.state })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key])
  /** Étage au-dessus du lieu affiché (undefined : la France, on quitte le bilan). */
  const up = placeParent(st)
  return { st, set, search: `?${bilanQuery(st)}`, national, up: up && (() => goPlace({ ...st, ...up, seenOpen: false })), upPlace: up }
}

/**
 * Joueurs d'un club comme dans « Qui ? », chacun par nom : `main` (liste ouverte) puis `rest` (repliée). Vus et
 * mesurés : ceux qui restent à voir (à mesurer), puis les déjà vus ; repérés : les profils repérés, puis les autres ;
 * licenciés : tous.
 */
export function whoOrder(club: ClubCoverage<Player>, o: Onglet = 'vus') {
  const byName = (a: Player, b: Player) => a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' }) || a.firstName.localeCompare(b.firstName, 'fr')
  const hit = [...club.seenPlayers].sort(byName)
  const other = [...club.toSee].sort(byName)
  return isShare(o) ? { main: other, rest: hit } : { main: hit, rest: other }
}

/** Tout le monde (onglet « Licenciés »). */
const EVERYONE = { has: () => true }

/** Calculs du bilan pour un état donné (page, fiche ouverte depuis le bilan) ; refaits seulement quand un filtre ou les données changent. */
export function useBilanModel(st: BilanState) {
  const data = useCoverageData()
  const lists = useDepartments()
  const national = can.nationalView(useRole())
  const nat = useNationalData(national, data?.players)
  const { onglet, sex, period, year, region, dept } = st
  // Lieu d'un joueur : département du n° de club (ou de licence, ou saisi), région selon la liste des départements.
  const place = useMemo<PlaceOf<Player>>(() => ({ deptOf: department, regionOf: (d) => regionOfDept(d) }), [lists]) // eslint-disable-line react-hooks/exhaustive-deps
  // Jamais à un survol ; la base n'est pas relue.
  const last = useMemo(() => (data ? lastSights(data.sights, periodInfo(period).range) : new Map<string, Sight>()), [data, period])
  // Joueurs comptés par l'onglet (undefined : pas encore calculé).
  const hit: { has(id: string): boolean } | undefined =
    onglet === 'vus' ? last : onglet === 'licencies' ? EVERYONE : onglet === 'mesures' ? nat?.staff : nat?.spotted
  const counted = hit ?? EVERYONE
  // Carte : sexe et année (elle montre tous les lieux).
  const forMap = useMemo(() => (data ? filterPlayers(data.players, { sex, year }, place) : []), [data, sex, year, place])
  const byPlace = useMemo(() => coverageByPlace(forMap, counted, place), [forMap, counted, place])
  // Générations : sexe et lieu (chaque carte est une année).
  const inPlace = useMemo(() => (data ? filterPlayers(data.players, { sex, region, dept }, place) : []), [data, sex, region, dept, place])
  const years = useMemo(() => coverageByYear(inPlace, counted), [inPlace, counted])
  // Clubs : tous les filtres.
  const inScope = useMemo(() => (year === null ? inPlace : inPlace.filter((p) => birthYear(p) === year)), [inPlace, year])
  const clubs = useMemo(() => sortClubs(onglet, coverageByClub(inScope, counted)), [onglet, inScope, counted])
  // Chiffres clés des joueurs retenus (tous les filtres) : clubs, départements et la valeur de chaque onglet.
  const kpis = useMemo(() => {
    const k = { total: inScope.length, vus: 0, mesures: 0, reperes: 0, clubs: new Set<string>(), depts: new Set<string>() }
    for (const p of inScope) {
      if (last.has(p.id)) k.vus++
      if (nat?.staff.has(p.id)) k.mesures++
      if (nat?.spotted.has(p.id)) k.reperes++
      const c = clubKey(p.club)
      if (c) k.clubs.add(c)
      const d = department(p)
      if (d) k.depts.add(d)
    }
    const t = (seen: number): Tally => ({ seen, total: k.total })
    return {
      tabs: { vus: t(k.vus), licencies: t(k.total), mesures: t(k.mesures), reperes: t(k.reperes) } as Record<Onglet, Tally>,
      clubs: k.clubs.size,
      depts: k.depts.size,
    }
  }, [inScope, last, nat])
  // Années proposées : toutes celles de la base (quel que soit le lieu), la plus récente d'abord.
  const allYears = useMemo(() => {
    const ys = new Set(data ? livePlayers(data.players).map(birthYear) : [])
    if (year !== null) ys.add(year)
    return [...ys].sort((a, b) => (!a ? 1 : !b ? -1 : b.localeCompare(a)))
  }, [data, year])
  const club = st.club === null ? undefined : clubs.find((c) => c.key === st.club)
  return {
    data: hit ? data : undefined,
    last,
    hit: counted,
    nat,
    byPlace,
    years,
    clubs,
    kpis,
    allYears,
    club,
    yearText: year === null ? 'Toutes les années' : yearLabel(year),
  }
}

// ---------- Question posée au bilan ----------

/**
 * Question posée au bilan (st.q, src/bilanQuestion.ts) : réponse calculée sur l'appareil (src/recipe.ts), totaux par
 * région, département et club du lieu affiché, clubs dans l'ordre de la question, valeur de chaque joueur qui répond.
 * Les données de la question ne sont lues que lorsqu'une question est posée.
 */
export function useBilanQuestion(st: BilanState) {
  const model = useQuestionModel(!!st.q)
  const { index, names } = model
  const recipe = st.q
  const answer = useMemo(() => (index && recipe ? runRecipe(index, recipe) : null), [index, recipe])
  const points = useMemo(() => (index && recipe && answer ? questionPoints(index, recipe, answer) : null), [index, recipe, answer])
  const { region, dept } = st
  const agg = useMemo(() => (points && index ? aggregate(points, { region, dept }, (k) => index.clubNames.get(k) ?? k) : null), [points, index, region, dept])
  const kind = recipe ? valueKind(recipe) : 'count'
  const dir = recipe ? rankDir(recipe) : 'desc'
  const clubs = useMemo(() => (agg ? rankAgg(kind, agg.clubs.map((c) => [c.key, c] as [string, QClub<Player>]), dir).map(([, c]) => c) : []), [agg, kind, dir])
  const club = st.club === null ? undefined : clubs.find((c) => c.key === st.club)
  const texts = useMemo(() => (recipe ? questionTexts(recipe, names) : null), [recipe, names])
  // Valeur de chaque joueur qui répond (moyenne, mesure, âge ; part vue : vu ou à voir).
  const byPlayer = useMemo(() => new Map((points ?? []).filter((x) => x.match).map((x) => [x.p.id, x])), [points])
  /** Joueurs d'un club qui répondent : par valeur (moyenne, mesure, âge), sinon par nom. */
  const order = (c: ClubCoverage<Player>) => {
    const byName = (a: Player, b: Player) => a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' }) || a.firstName.localeCompare(b.firstName, 'fr')
    const v = (p: Player) => byPlayer.get(p.id)?.value ?? null
    const k = dir === 'asc' ? 1 : -1
    return [...c.seenPlayers].sort((a, b) => {
      const x = v(a)
      const y = v(b)
      return (x === null ? (y === null ? 0 : 1) : y === null ? -1 : k * (x - y)) || byName(a, b)
    })
  }
  const playerText = (p: { id: string }) => {
    const x = byPlayer.get(p.id)
    return x && texts ? texts.player(x) : ''
  }
  return { ready: !!agg && !!texts, model, recipe, answer, agg, kind, dir, clubs, club, texts, order, playerText }
}

/** Textes d'une question : ce que dit la valeur (bannière, légende, lignes, bulles, joueurs). Positifs ou neutres seulement. */
function questionTexts(r: Recipe, names: Names) {
  const kind = valueKind(r)
  const cond = hasConditions(r)
  const f = r.pop.sex === 'F'
  const e = f ? 'e' : ''
  const players = (n: number) => `${f ? 'joueuse' : 'joueur'}${s(n)}`
  const who = (n: number) => `${fmt(n)} ${players(n)}`
  const digits = kind === 'age' ? 1 : 2
  const vUnit = kind === 'measure' ? (names.unit?.(r.out.measure ?? '') ?? '') : kind === 'age' ? 'ans' : kind === 'avg' ? 'sur 5' : ''
  const num = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: digits })
  const period = periodText(r.out.period ?? r.seen?.period ?? { kind: 'season' }, names.today)
  const valueName = kind === 'avg' || kind === 'measure' || kind === 'age' ? outValueText(r, names) : ''
  /** « Nombre de joueuses », « Part qui répond », « Part vue », « Moyenne Défense », « Âge moyen ». */
  const what =
    kind === 'count' ? `Nombre de ${f ? 'joueuses' : 'joueurs'}` : kind === 'share' ? 'Part qui répond' : kind === 'seen' ? 'Part vue' : valueName.replace(/^./, (c) => c.toUpperCase())
  const legend =
    kind === 'count'
      ? `Couleur : nombre de ${f ? 'joueuses' : 'joueurs'}${cond ? ' qui répondent' : ''}`
      : kind === 'share'
        ? 'Couleur : part de la population qui répond'
        : kind === 'seen'
          ? `Couleur : part vue (${period})`
          : `Couleur : ${valueName}`
  const q = (t: Tally) => t as QAgg
  const big = (t: Tally) => {
    const v = aggValue(kind, t)
    if (kind === 'count') return fmt(t.seen)
    if (kind === 'share') return shareText(t.seen, t.total)
    if (v === undefined) return '–'
    return kind === 'seen' ? shareText(q(t).vus, t.seen) : `${num(v)}${vUnit ? ` ${vUnit}` : ''}`
  }
  const small = (t: Tally) =>
    kind === 'count'
      ? `${players(t.seen)}${cond ? ` · sur ${fmt(t.total)} (${shareText(t.seen, t.total)})` : ''}`
      : kind === 'share'
        ? `${fmt(t.seen)} sur ${fmt(t.total)}`
        : kind === 'seen'
          ? `${fmt(q(t).vus)} vu${e}${s(q(t).vus)} sur ${who(t.seen)}`
          : q(t).n
            ? `sur ${who(q(t).n)}`
            : 'pas encore de valeur'
  const line = (t: Tally) => (
    <>
      <b className="text-fg">{big(t)}</b> {small(t)}
    </>
  )
  const lens: Lens = {
    name: what,
    value: (t) => aggValue(kind, t),
    scale: (v) => (kind === 'count' ? scaleOfValues(v, true) : isShareKind(kind) ? scaleOfValues(v) : scaleOfNumbers(v, digits, vUnit || undefined)),
    rank: (rows) => rankAgg(kind, rows, rankDir(r)),
    row: line,
    club: line,
    bar: (t) => (kind === 'share' || (kind === 'count' && cond) ? { t } : kind === 'seen' ? { t: { seen: q(t).vus, total: t.seen } } : null),
    badge: () => null,
    tip: (t) =>
      t?.total ? (
        <>
          <div className="mt-1">
            <b className="text-base">{big(t)}</b>
          </div>
          <div className="text-muted">{small(t)}</div>
        </>
      ) : (
        noPlayerTip
      ),
    label: (t) => `${big(t)} ${small(t)}`,
    title: legend,
    note: 'de la plus faible à la plus forte valeur',
  }
  /** Ce que la question dit d'un joueur qui répond. */
  const player = (x: QPoint<unknown>) =>
    kind === 'seen'
      ? x.vu
        ? `vu${e} (${period})`
        : `à voir (${period})`
      : valueName && x.value !== undefined && x.value !== null
        ? `${valueName} ${num(x.value)}${vUnit ? ` ${vUnit}` : ''}`
        : ''
  /** Total du lieu affiché : « 371 joueurs répondent », puis « sur 1 200 (30 %) », « moyenne Taille 178 cm ». */
  const total = (t: QAgg) => ({
    head: cond ? `${who(t.seen)} répond${t.seen > 1 ? 'ent' : ''}` : who(t.seen),
    rest: [
      cond ? `sur ${fmt(t.total)} (${shareText(t.seen, t.total)})` : '',
      kind === 'seen' && t.seen ? `${shareText(t.vus, t.seen)} vu${e}s (${period})` : '',
      valueName && t.n ? `${valueName} ${num(t.sum / t.n)}${vUnit ? ` ${vUnit}` : ''}` : '',
    ].filter(Boolean),
  })
  // Pastilles de la question, sans la sortie (le bilan la montre) ; le sexe est déjà dans « Nombre de joueuses ».
  const hidden = new Set(['out', 'sort', 'value', 'keep', 'limit', 'outPeriod', ...(kind === 'count' ? ['sex'] : [])])
  const conditions = recipeChips(r, names)
    .filter((c) => !hidden.has(c.key))
    .map((c) => c.label)
  return { kind, cond, what, lens, player, total, conditions }
}

/** Ce que les listes « Qui ? » du bilan partagent : onglet, état de l'adresse (pour les fiches) et « Déjà vus » ouvert. */
const WhoCtx = createContext<{
  o: Onglet
  search: string
  seenOpen: boolean
  setSeenOpen: (v: boolean) => void
  /** Valeur montrée (onglet ou question) ; absente : celle de l'onglet. */
  lens?: Lens
  /** Question posée : joueurs du club qui répondent, à la place de « Qui ? ». */
  qWho?: (club: ClubCoverage<Player>) => ReactNode
}>({
  o: 'vus',
  search: '',
  seenOpen: false,
  setSeenOpen: () => {},
})

// ---------- Page ----------

export default function Coverage() {
  const role = useRole()
  const loc = useLocation()
  const regionLabel = useRegionLabel()
  const deptName = useDeptName()
  // Onglet et filtres communs à la carte, aux générations et aux clubs : dans l'adresse, retrouvés au retour d'une fiche joueur.
  const { st, set, search, national, up, upPlace } = useBilanState()
  const per = usePerimeter()
  const { onglet: o, sex, period, mapBy, year, region, dept } = st
  const bilan = useBilanModel(st)
  const { data, last, nat, years, kpis, allYears, yearText } = bilan
  // Question posée au bilan : carte, listes et clubs montrent sa valeur (sur la carte seulement, sans les filtres du bilan).
  const bq = useBilanQuestion(st)
  const Q = st.q && bq.ready && bq.agg && bq.texts ? { ...bq, agg: bq.agg, texts: bq.texts } : null
  const view: View = st.q ? 'map' : st.view
  const byPlace = Q ? { ...Q.agg.all, byDept: Q.agg.byDept, byRegion: Q.agg.byRegion, noDept: Q.agg.noDept } : bilan.byPlace
  const clubs: ClubCoverage<Player>[] = Q ? Q.clubs : bilan.clubs
  const club: ClubCoverage<Player> | undefined = Q ? Q.club : bilan.club
  const lens = useMemo(() => Q?.texts.lens ?? ongletLens(o), [Q?.texts, o]) // eslint-disable-line react-hooks/exhaustive-deps
  const side = useMedia(MQ.side)
  const whereRef = useRef<HTMLDivElement>(null)
  const qWho = Q ? (c: ClubCoverage<Player>) => <QuestionWho club={c} players={Q.order(c)} text={Q.playerText} what={Q.texts} /> : undefined
  const who = useMemo(() => ({ o, search, seenOpen: st.seenOpen, setSeenOpen: (v: boolean) => set({ seenOpen: v }), lens, qWho }), [o, search, lens, Q?.agg]) // eslint-disable-line react-hooks/exhaustive-deps
  // Recherche vocale (« micro ✨ Filtrer ») : filtres du bilan (sexe, période, génération, lieu de la carte, club, vue). Clubs et
  // lieux sont retrouvés ici ; seuls la phrase, le schéma et les filtres actifs partent (src/voicePages.ts).
  const voiceClubs = useMemo(() => {
    const m = new Map<string, { names: Map<string, number>; depts: Map<string, number> }>()
    for (const p of data ? livePlayers(data.players) : []) {
      const k = clubKey(p.club)
      if (!k) continue
      let c = m.get(k)
      if (!c) m.set(k, (c = { names: new Map(), depts: new Map() }))
      c.names.set(p.club!.trim(), (c.names.get(p.club!.trim()) ?? 0) + 1)
      const d = department(p)
      if (d) c.depts.set(d, (c.depts.get(d) ?? 0) + 1)
    }
    const top = (x: Map<string, number>) => [...x].sort((a, b) => b[1] - a[1])[0]?.[0]
    return [...m].map(([key, c]) => ({ key, name: top(c.names)!, dept: top(c.depts) }))
  }, [data])
  // Clubs du département sur la carte (structure importée) : points, échelle de couleurs des clubs, clubs sans position.
  const units = useUnits()
  const [hot, setHot] = useState<string | null>(null)
  const clubMap = useMemo(() => {
    if (!dept || dept === NO_DEPT || dept === OTHER_OM.code || !hasPlacedClubs(units)) return null
    const r = clubDots(clubs, units, dept, (n) => department({ clubCode: n }))
    if (!r.dots.length) return null
    const sc = lens.scale(r.dots.map((d) => (d.club ? lens.value(d.club) : undefined)).filter((v): v is number => v !== undefined))
    const max = Math.max(0, ...r.dots.map((d) => d.club?.total ?? 0))
    const items = r.dots.map(
      (d): MapDot => ({
        id: d.id,
        lat: d.lat,
        lng: d.lng,
        r: d.club ? dotRadius(d.club.total, max) : 3.5,
        fill: d.club ? fillAt(lens.value(d.club), sc) : MUTED_DOT,
        muted: !d.club,
        label: `${clubLabel(d.name)}${d.number ? `, n° ${d.number}` : ''} : ${d.club?.total ? lens.label(d.club) : 'aucun joueur avec ces filtres'}`,
      }),
    )
    return { ...r, sc, items, byId: new Map(r.dots.map((d) => [d.id, d])), color: new Map(items.filter((d) => !d.muted).map((d) => [d.id, d.fill])) }
  }, [dept, units, clubs, lens])
  const places = useVoicePlaces()
  const voicePage = useMemo(
    () => bilanVoicePage({ ...places, clubs: voiceClubs, thisYear: new Date().getFullYear(), view, season: seasonOf(today()).label }),
    [places, voiceClubs, view],
  )

  if (!can.viewCoverage(role)) return <Empty>Le bilan de détection est réservé aux administrateurs et aux encadrants.</Empty>
  if (!data || (st.q && !Q)) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const tab = TAB[o]
  const total = totalOf(clubs)
  const deptText = (d: string) => (d === NO_DEPT ? 'Département non renseigné' : `${deptName(d)} (${d})`)

  const setOnglet = (v: Onglet) => set({ onglet: v, seenOpen: false })
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
  // Ordinateur, un club choisi dans un département : ses joueurs passent à droite ; à gauche, la carte des clubs reste
  // (choix « Carte / Liste » au-dessus), ou la liste des clubs quand on la choisit ou que les clubs n'ont pas de position.
  // Le fil (ou un nouveau toucher sur le club) referme le club.
  const clubMode = side && !!dept && !!club
  const clubsAsList = clubMode && (st.clubsAs === 'list' || !clubMap)
  const clubsAsSwitch = clubMode && clubMap && (
    <div className="[&_button]:min-h-8">
      <Segmented<'map' | 'list'>
        value={st.clubsAs}
        onChange={(v) => set({ clubsAs: v })}
        options={[
          { value: 'map', label: 'Carte', icon: 'map' },
          { value: 'list', label: 'Liste', icon: 'list' },
        ]}
      />
    </div>
  )
  const where = dept ? deptText(dept) : region ? regionLabel(region) : ''
  const clubsTitle = o === 'vus' && !Q ? 'Où aller ?' : 'Clubs'
  // Point de la carte touché : comme le club choisi dans la liste ; au téléphone, on descend jusqu'à sa ligne.
  const pickDot = (id: string) => {
    if (!clubMap?.byId.get(id)?.club) return
    const opening = club?.key !== id
    pickClub(id)
    if (opening && !side)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => document.querySelector(`[data-club="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })),
      )
  }
  const clubList = (inline: boolean, linked = false) =>
    clubs.length ? (
      <ClubList
        key={`${o}|${sex}|${year}|${region}|${dept}|${period}|${st.q ? encodeRecipe(st.q) : ''}`}
        clubs={clubs}
        inline={inline}
        selected={club?.key}
        onPick={pickClub}
        label={yearText}
        last={last}
        rewatch={data.rewatch}
        {...(linked && clubMap ? { hot, onHot: setHot, dotColor: (k: string) => clubMap.color.get(k) } : {})}
      />
    ) : (
      <Empty>Aucun joueur ici avec ces filtres.</Empty>
    )

  // Carte : couleur d'un département (vue France « par région » : celle de sa région).
  // Échelle des couleurs : zones affichées (régions de France, départements de la région ou de France).
  const byRegionView = !region && mapBy === 'region'
  const shown = byRegionView ? [...byPlace.byRegion.values()] : region ? [...byPlace.byDept].filter(([d]) => regionOfDept(d) === region).map(([, t]) => t) : [...byPlace.byDept.values()]
  const valueOf = lens.value
  const sc = lens.scale(shown.map(valueOf).filter((v): v is number => v !== undefined))
  const colorOf = (t?: Tally) => fillAt(valueOf(t), sc)
  // Hors du périmètre du compte (supabase/046 : aucun joueur reçu) : zone neutre, grisée, et dite comme telle.
  const perRegions = new Set(per && !per.all ? perimeterDepts(per).map(regionOfDept) : [])
  const outsideDept = (d: string) => !!per && !per.all && !deptInPerimeter(per, d)
  const outsideRegion = (r: string | undefined) => !!per && !per.all && !perRegions.has(r)
  const fill = (code: string) =>
    (byRegionView ? outsideRegion(regionOfDept(code)) : outsideDept(code))
      ? OUTSIDE
      : colorOf(byRegionView ? byPlace.byRegion.get(regionOfDept(code) ?? '') : byPlace.byDept.get(code))
  // À côté de la carte : le classement des régions (France), des départements (région), des clubs (département).
  const deptRows = lens.rank([...byPlace.byDept].filter(([d]) => (region ? regionOfDept(d) === region : !regionOfDept(d))))
  const regionRows = lens.rank(byPlace.byRegion)
  const maxOf = (rows: [string, Tally][]) => Math.max(0, ...rows.map(([, t]) => t.total))
  // Bulle d'une zone ou d'un club : valeur montrée, détail, ce qui reste.
  const tipValue = lens.tip
  const order = Q ? 'dans l’ordre de la question' : tab.order
  const side2 = dept ? (
    <section>
      <SectionTitle info={`Clubs du département, ${order}. Touche un club pour la liste des joueurs.`}>
        {clubsTitle} · {Q ? Q.texts.what : yearText}
      </SectionTitle>
      {clubList(true, true)}
    </section>
  ) : region ? (
    <section>
      <SectionTitle info={`Départements de la région, ${order}. Touche un département (ou la carte) pour ses clubs.`}>Départements · {regionLabel(region)}</SectionTitle>
      {deptRows.length ? (
        <div className="flex flex-col gap-2">
          {deptRows.map(([d, t]) => (
            <PlaceRow key={d} lens={lens} label={deptText(d)} t={t} color={colorOf(t)} max={maxOf(deptRows)} onClick={() => pickDept(d)} />
          ))}
        </div>
      ) : (
        <Empty>Aucun joueur dans cette région avec ces filtres.</Empty>
      )}
    </section>
  ) : (
    <section>
      <SectionTitle info={`Régions, ${order}. Touche une région (ou la carte) pour ses départements.`}>Régions</SectionTitle>
      {byPlace.total ? (
        <div className="flex flex-col gap-2">
          {regionRows.map(([r, t]) => (
            <PlaceRow key={r} lens={lens} label={regionLabel(r)} t={t} color={colorOf(t)} max={maxOf(regionRows)} onClick={() => pickRegion(r)} />
          ))}
          {/* Départements hors découpage (numéro inconnu) et joueurs sans département : choisis directement. */}
          {deptRows.map(([d, t]) => (
            <PlaceRow key={d} lens={lens} label={deptText(d)} t={t} color={colorOf(t)} max={maxOf(regionRows)} onClick={() => pickDept(d)} />
          ))}
          {byPlace.noDept.total > 0 && (
            <PlaceRow lens={lens} label={deptText(NO_DEPT)} t={byPlace.noDept} color={fillAt(undefined)} max={maxOf(regionRows)} onClick={() => pickDept(NO_DEPT)} />
          )}
        </div>
      ) : (
        <Empty>{sex === 'all' ? 'Aucun joueur dans la base avec ces filtres.' : `Aucun${sex === 'F' ? 'e fille' : ' garçon'} avec ces filtres.`}</Empty>
      )}
    </section>
  )

  const yearsText = year === null ? 'toutes les années' : year ? `nés en ${year}` : 'année de naissance inconnue'
  const explain: ReactNode =
    o === 'vus' ? (
      `Part des joueurs vus (${periodInfo(period).label.toLowerCase()}, ${yearsText}).`
    ) : o === 'licencies' ? (
      `Joueurs licenciés dans un club de la zone (${yearsText}).`
    ) : o === 'mesures' ? (
      `Part des joueurs avec au moins une mesure prise par le staff, hors tailles déclarées à la licence (${yearsText}).`
    ) : (
      <>
        {nat?.profiles
          ? `Joueurs correspondant à au moins un de mes profils recherchés (${plural(nat.profiles, 'profil')}, ${yearsText}).`
          : `Aucun profil recherché : joueurs dont la dernière taille atteint le 90e centile de leur année et de leur sexe (${yearsText}).`}{' '}
        <Link to="/alertes" className="inline-flex items-center gap-1 font-bold text-accent underline">
          <Icon name="target" className="h-3 w-3" /> Profils recherchés
        </Link>
      </>
    )
  const subtitle =
    o === 'vus'
      ? 'Un joueur est vu dès qu’un membre du staff l’a marqué « vu » ou a donné un avis sur lui.'
      : o === 'licencies'
        ? 'Joueurs de la base, par département de leur club.'
        : o === 'mesures'
          ? 'Joueurs avec au moins une mesure prise par le staff.'
          : 'Joueurs correspondant à mes profils recherchés.'

  return (
    <WhoCtx.Provider value={who}>
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {/* Sur un lieu, le retour remonte d'un étage (club → département → région → France) ; depuis la France, on quitte le bilan. */}
        {up && upPlace ? (
          <button onClick={up} className="min-w-0 self-start truncate text-left text-xs font-bold text-muted">
            ← {(upPlace.dept ? deptText(upPlace.dept) : upPlace.region ? regionLabel(upPlace.region) : 'France').toUpperCase()}
          </button>
        ) : (
          <BackButton fallback="/" label="ACCUEIL" className="self-start" />
        )}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold">Bilan de détection</h1>
            <p className="text-[11px] text-muted">{subtitle}</p>
          </div>
          <Link to="/bilan/rapport" className="btn-ghost min-h-8 shrink-0 px-3 py-1.5 text-xs">
            <Icon name="list" className="h-3.5 w-3.5" />
            Rapport Fédé
          </Link>
        </div>
        {/* « Poser une question » (réponse calculée sur l'appareil, page /bilan/question) et « Mes questions ». */}
        <AskQuestion />
        <SavedQuestions clubDept={(k) => voiceClubs.find((c) => c.key === k)?.dept} />
        {/* Question posée : ses propres filtres (pastilles), pas ceux du bilan. */}
        {!Q && (
        <VoiceSearch<BilanVoice>
          values={{ sex, period, year, region, dept, club: st.club, view }}
          apply={(v) => set({ ...v, seenOpen: v.club === st.club ? st.seenOpen : false })}
          page={voicePage}
          label="Filtrer"
          input={
            <div className="min-w-0 flex-1">
              <Filters sex={sex} setSex={setSex} period={period} setPeriod={setPeriod} showPeriod={o === 'vus'} years={allYears} year={year} setYear={pickYear} />
            </div>
          }
        />
        )}
        {/* Question posée : un bandeau à la place des onglets (✕ revient aux onglets). */}
        {Q && st.q && (
          <QuestionBanner
            recipe={st.q}
            texts={Q.texts}
            names={Q.model.names}
            criteria={Q.model.data?.criteria ?? []}
            events={Q.model.data?.events}
            place={{ region, dept, club: st.club }}
            placeText={st.club !== null && club ? clubLabel(club.name) : dept ? deptText(dept) : region ? regionLabel(region) : 'France'}
            level={dept ? 'par club' : region || mapBy === 'dept' ? 'par département' : 'par région'}
            heard={(loc.state as { heard?: string } | null)?.heard}
            onChange={(r) => set({ q: r })}
            onClose={() => set({ q: null })}
          />
        )}
        {/* Onglets de mesure (administrateurs) : chacun montre sa valeur pour les filtres et le lieu choisis (chiffres clés). */}
        {national && !Q && (
          <div role="tablist" aria-label="Ce que montre la carte" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tabsFor(national).map((k) => {
              const on = k === o
              const t = kpis.tabs[k]
              const ready = k === 'vus' || k === 'licencies' || !!nat
              return (
                <button
                  key={k}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setOnglet(k)}
                  className={`card flex min-h-11 min-w-0 flex-col items-start px-3 py-1.5 text-left transition hover:border-accent ${on ? 'border-accent bg-accent/10' : ''}`}
                >
                  <span className={`text-base leading-tight font-extrabold tabular-nums ${on ? 'text-accent' : ''}`}>{!ready ? '…' : t.total ? headline(k, t) : '—'}</span>
                  <span className="w-full truncate text-[10px] font-bold tracking-wider text-muted uppercase">{TAB[k].label}</span>
                </button>
              )
            })}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Crumbs steps={crumbs} />
          {!Q && (
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
          )}
        </div>
        {Q ? (
          // Question : son total au lieu affiché (« 371 joueurs répondent · sur 1 200 (30 %) »).
          <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-[11px]">
            <span className="min-w-0 shrink">
              <b className="text-sm">{Q.texts.total(Q.agg.here).head}</b>{' '}
              <span className="text-muted">
                {Q.texts.total(Q.agg.here).rest.map((x) => `· ${x} `)}· {plural(Q.agg.clubs.filter((c) => c.key && c.seen).length, 'club')}
                {!dept && ` · ${plural(Q.agg.depts, 'département')}`}
              </span>
            </span>
            {Q.texts.cond && <Bar t={Q.agg.here} className="min-w-12 flex-1" />}
          </div>
        ) : (
        <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-[11px]">
          <span className="min-w-0 shrink">
            <b className="text-sm">
              {o === 'licencies' ? plural(total.total, 'joueur') : o === 'reperes' ? plural(total.seen, 'profil repéré', 'profils repérés') : headline(o, total)}
            </b>{' '}
            <span className="text-muted">
              {isShare(o) && `· ${detail(o, total)} `}
              {o === 'reperes' && `sur ${plural(total.total, 'joueur')} `}· {plural(kpis.clubs, 'club')}
              {!dept && ` · ${plural(kpis.depts, 'département')}`}
              {year !== null && ` · ${yearText}`}
            </span>
          </span>
          {o !== 'licencies' && <Bar t={total} className="min-w-12 flex-1" />}
        </div>
        )}
      </div>

      {view === 'map' ? (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 side:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {clubsAsList && club ? (
            <section data-keep-scroll="bilan-clubs" className="flex flex-col gap-2 side:sticky side:top-[calc(var(--hdr)+1rem)] side:max-h-[calc(100dvh-var(--hdr)-2rem)] side:overflow-y-auto">
              {clubsAsSwitch}
              <SectionTitle info={`Clubs du département, ${order}. Touche un autre club pour changer, ou « Carte » pour revoir les clubs sur la carte.`}>
                {clubsTitle} · {deptText(dept)} · {Q ? Q.texts.what : yearText}
              </SectionTitle>
              {clubList(false)}
            </section>
          ) : (
          <section className="card flex flex-col gap-2 p-3 side:sticky side:top-[calc(var(--hdr)+1rem)]">
            {clubsAsSwitch}
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
              className="side:max-h-[calc(100dvh-var(--hdr)-19rem)]"
              ariaLabel={`${lens.name}${where ? ` : ${where}` : ' par région et par département'}`}
              others={showOtherOM(byPlace.byDept)}
              label={(code) => {
                const t = byPlace.byDept.get(code)
                return `${deptText(code)} : ${outsideDept(code) ? 'hors de ton périmètre' : t?.total ? lens.label(t) : 'aucun joueur avec ces filtres'}`
              }}
              tip={({ code, isRegion }) => {
                const t = isRegion ? byPlace.byRegion.get(code) : byPlace.byDept.get(code)
                return (
                  <>
                    <div className="font-bold">{isRegion ? regionLabel(code) : deptText(code)}</div>
                    {(isRegion ? outsideRegion(code) : outsideDept(code)) ? <div className="text-muted">Hors de ton périmètre</div> : tipValue(t)}
                    {isRegion && <div className="mt-1 text-[10px] text-muted">Toucher pour voir ses départements</div>}
                  </>
                )
              }}
              dots={
                clubMap
                  ? {
                      items: clubMap.items,
                      active: hot,
                      picked: club?.key,
                      onActive: setHot,
                      onPick: pickDot,
                      tip: (id) => {
                        const d = clubMap.byId.get(id)
                        if (!d) return null
                        const at = [d.number && `N° ${d.number}`, d.city].filter(Boolean).join(' · ')
                        return (
                          <>
                            <div className="font-bold">{clubLabel(d.name)}</div>
                            {at && <div className="text-[10px] text-muted">{at}</div>}
                            {tipValue(d.club)}
                            {d.club && <div className="mt-1 text-[10px] text-muted">Toucher pour voir ses joueurs</div>}
                          </>
                        )
                      },
                    }
                  : undefined
              }
            />
            <MapLegend sc={clubMap?.sc ?? sc} note={lens.note} title={lens.title} />
            {per && !per.all && (
              <p className="flex items-start gap-1.5 text-[10px] text-muted" data-testid="hors-perimetre">
                <span className="mt-0.5 size-2.5 shrink-0 rounded-sm border border-line" style={{ background: OUTSIDE }} />
                <span>Zones pâles : hors de ton périmètre{perimeterText(per) ? ` (${perimeterText(per)})` : ''}, pas de joueurs reçus.</span>
              </p>
            )}
            {clubMap && (
              <p className="flex items-start gap-1.5 text-[10px] text-muted">
                <span className="mt-0.5 size-2.5 shrink-0 rounded-full border border-muted/60" style={{ background: MUTED_DOT }} />
                <span>
                  Un point par club, à son adresse (taille : nombre de joueurs) ; petit point gris : aucun joueur avec ces filtres.
                  {clubMap.unplaced.length > 0 && ` ${plural(clubMap.unplaced.length, 'club')} sans position connue : seulement dans la liste.`}
                </span>
              </p>
            )}
            <p className="text-[10px] text-muted">
              {!Q && explain}{' '}
              {clubMap
                ? `Toucher un point pour voir les joueurs du club${OUTRE_MER.some((t) => t.code === dept) ? '' : ', ou un département voisin pour changer'}.`
                : dept
                  ? 'Toucher un autre département pour changer.'
                  : region
                    ? 'Toucher un département pour voir ses clubs.'
                    : 'Toucher une région pour la voir de plus près.'}
            </p>
          </section>
          )}
          <div ref={whereRef}>
            {clubMode && club ? (
              Q ? (
                <QuestionWho club={club} players={Q.order(club)} text={Q.playerText} what={Q.texts} />
              ) : (
                <Who club={club} label={yearText} last={last} rewatch={data.rewatch} />
              )
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
              {[{ year: null as string | null, ...totalOf(years) }, ...years].map((y, _i, all) => {
                const on = y.year === year
                return (
                  <button
                    key={y.year ?? 'toutes'}
                    onClick={() => pickCard(y.year)}
                    aria-pressed={on}
                    className={`card flex min-w-0 flex-col gap-1.5 p-3 text-left transition hover:border-accent ${on ? 'border-accent bg-accent/10' : ''}`}
                  >
                    <span className={`font-extrabold ${y.year ? 'text-lg' : 'text-sm leading-7'}`}>{y.year === null ? 'Toutes' : yearLabel(y.year)}</span>
                    <span className="text-[11px] text-muted">{detail(o, y)}</span>
                    <Bar t={y} ratio={ratioOf(o, y, all[0].total)} />
                    <span className="text-[11px] font-bold">
                      {headline(o, y)} {!isShare(o) && <span className="font-normal text-muted">{unit(o, y)}</span>}
                      {tab.todo &&
                        (y.total > y.seen ? (
                          <span className="font-normal text-sky-300">· {fmt(y.total - y.seen)} {tab.todo}</span>
                        ) : (
                          <span className="font-normal text-emerald-300">· {tab.done}</span>
                        ))}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          <div ref={whereRef} className="grid scroll-mt-20 grid-cols-[minmax(0,1fr)] items-start gap-4 side:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <section>
              <SectionTitle info={`Clubs, ${tab.order}. Touche un club pour la liste des joueurs.`}>
                {clubsTitle} · {yearText}
                {where ? ` · ${where}` : ''}
              </SectionTitle>
              {clubList(!side)}
            </section>
            {side && (
              <section data-keep-scroll="bilan-qui" className="sticky top-[calc(var(--hdr)+1rem)] max-h-[calc(100dvh-var(--hdr)-2rem)] overflow-y-auto">
                <SectionTitle>Qui ?</SectionTitle>
                {club ? <Who club={club} label={yearText} last={last} rewatch={data.rewatch} /> : <Empty>Choisis un club pour voir ses joueurs.</Empty>}
              </section>
            )}
          </div>
        </>
      )}
    </div>
    </WhoCtx.Provider>
  )
}

// ---------- Question posée au bilan : bandeau et joueurs d'un club ----------

type QuestionTexts = ReturnType<typeof questionTexts>

/**
 * Bandeau d'une question posée au bilan, à la place des onglets : « ✨ Nombre de joueurs par club · Var (83) ✕ » (une
 * ligne, coupée au téléphone). Dessous : « Modifier » (pastilles de la question, src/components/RecipeChips.tsx), « Ouvrir
 * en détail » (/bilan/question, avec le lieu affiché) et « Enregistrer cette question » (avec le lieu affiché). Une
 * pastille qui donne une réponse non géographique (liste de joueurs, tableau par génération…) ouvre /bilan/question.
 */
function QuestionBanner({
  recipe,
  texts,
  names,
  criteria,
  events,
  place,
  placeText,
  level,
  heard,
  onChange,
  onClose,
}: {
  recipe: Recipe
  texts: QuestionTexts
  names: Names
  criteria: RecipeModel['criteria']
  events?: RecipeModel['events']
  place: Place
  placeText: string
  level: string
  heard?: string
  onChange: (r: Recipe) => void
  onClose: () => void
}) {
  const nav = useNavigate()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const text = [`${texts.what} ${level}`, ...texts.conditions, placeText].join(' · ')
  const full = recipeAt(recipe, place)
  const detailUrl = (r: Recipe) => `/bilan/question?r=${encodeURIComponent(encodeRecipe(r))}`
  const change = (r: Recipe) => (bilanOutput(r.out) ? onChange(r) : nav(detailUrl(recipeAt(r, place))))
  const small = 'flex min-h-8 items-center gap-1 rounded px-1.5 font-bold'
  return (
    <section aria-label="Question posée au bilan" className="flex flex-col gap-1">
      <div className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-accent bg-accent/10 pl-3">
        <span aria-hidden>✨</span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold" title={text}>
          {text}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer la question et revenir aux onglets du bilan"
          title="Fermer la question"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-r-lg text-base text-muted hover:text-fg"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap items-center text-[11px]">
        <button type="button" aria-expanded={editing} onClick={() => setEditing(!editing)} className={`${small} text-accent`}>
          Modifier <span aria-hidden>{editing ? '▴' : '▾'}</span>
        </button>
        <Link to={detailUrl(full)} className={`${small} text-muted underline decoration-dotted underline-offset-2 hover:text-fg`}>
          Ouvrir en détail
        </Link>
        <button type="button" aria-expanded={saving} onClick={() => setSaving(!saving)} className={`${small} text-muted hover:text-fg`}>
          <Icon name="star" className="h-3 w-3" />
          Enregistrer<span className="hidden sm:inline"> cette question</span>
        </button>
      </div>
      {editing && (
        <div className="card flex flex-col gap-1.5 p-2">
          {heard && <p className="text-[11px] text-muted">Entendu : « {heard} »</p>}
          <RecipeChips recipe={recipe} names={names} model={{ names, criteria, events }} onChange={change} />
          <p className="text-[10px] text-muted">Le lieu se choisit sur la carte ; la question le garde.</p>
        </div>
      )}
      {saving && <SaveForm recipe={full} names={names} phrase={heard} onDone={() => setSaving(false)} />}
    </section>
  )
}

/** Joueurs d'un club qui répondent à la question (à la place de « Qui ? ») ; fiche ouverte dans le bilan. */
function QuestionWho({ club, players, text, what }: { club: ClubCoverage<Player>; players: Player[]; text: (p: Player) => string; what: QuestionTexts }) {
  const { search } = useContext(WhoCtx)
  const t = what.total(club as QClub<Player>)
  const year = (p: Player) => p.birthDate?.slice(0, 4) ?? ''
  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-extrabold">{clubLabel(club.name)}</div>
        <div className="text-[11px] text-muted">{[t.head, ...t.rest].join(' · ')}</div>
      </div>
      {players.length ? (
        players.map((p) => (
          <PlayerRow key={p.id} p={p} link={{ to: `/bilan/joueurs/${p.id}${search}` }} sub={[year(p), text(p)].filter(Boolean).join(' · ')} follow={<FollowStar id={p.id} />} />
        ))
      ) : (
        <Empty>Personne dans ce club ne répond à la question.</Empty>
      )}
    </div>
  )
}

// ---------- Clubs ----------

/** Nombre de clubs montrés d'abord (toute la France, toutes les années : des centaines). */
const CLUBS_STEP = 40

/** Clubs dans l'ordre de l'onglet ; `inline` : la liste « Qui ? » s'ouvre sous le club touché. */
function ClubList({
  clubs,
  inline,
  selected,
  onPick,
  label,
  last,
  rewatch,
  hot,
  onHot,
  dotColor,
}: {
  clubs: ClubCoverage<Player>[]
  inline: boolean
  selected?: string
  onPick: (key: string) => void
  label: string
  last: Map<string, Sight>
  rewatch: Map<string, Rewatch[]>
  /** Club mis en avant (son point survolé sur la carte) ; `onHot` : survol d'une ligne (son point est mis en avant). */
  hot?: string | null
  onHot?: (key: string | null) => void
  /** Couleur du point d'un club sur la carte (absent : club sans position connue). */
  dotColor?: (key: string) => string | undefined
}) {
  const { o, lens: given } = useContext(WhoCtx)
  const lens = given ?? ongletLens(o)
  const [more, setMore] = useState(CLUBS_STEP)
  // Club choisi plus bas (point de la carte, adresse) : la liste va au moins jusqu'à lui.
  const limit = Math.max(more, clubs.findIndex((c) => c.key === selected) + 1)
  const max = Math.max(0, ...clubs.map((c) => c.total))
  return (
    <div className="flex flex-col gap-2">
      {clubs.slice(0, limit).map((c) => {
        const on = c.key === selected
        const dot = dotColor && c.key ? dotColor(c.key) : undefined
        const bar = lens.bar(c, max)
        return (
          <div key={c.key || 'aucun'} data-club={c.key} className="flex scroll-mt-24 flex-col gap-2">
            <button
              onClick={() => onPick(c.key)}
              aria-expanded={on}
              {...(onHot && c.key
                ? {
                    onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && onHot(c.key),
                    onPointerLeave: (e: React.PointerEvent) => e.pointerType === 'mouse' && onHot(null),
                  }
                : {})}
              className={`card flex min-h-11 items-center gap-3 px-3 py-2 text-left transition hover:border-accent ${on ? 'border-accent bg-accent/10' : hot && c.key === hot ? 'border-accent' : ''}`}
            >
              {dotColor &&
                // Pastille du point sur la carte ; cercle en pointillés : club sans position connue (pas sur la carte).
                (dot ? (
                  <span className="size-3 shrink-0 rounded-full border border-fg/50" style={{ background: dot }} aria-hidden="true" />
                ) : (
                  <span className="size-3 shrink-0 rounded-full border border-dashed border-muted" aria-hidden="true" />
                ))}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-bold ${c.key ? '' : 'text-muted italic'}`}>{clubLabel(c.name)}</span>
                <span className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                  <span className="min-w-0 truncate">{lens.club(c)}</span>
                  {bar && <Bar t={bar.t} ratio={bar.ratio} className="w-16 shrink-0 sm:w-24" />}
                </span>
              </span>
              {lens.badge(c)}
              {inline && <span className={`shrink-0 text-muted transition ${on ? 'rotate-90' : ''}`}>›</span>}
            </button>
            {on && inline && <Who club={c} label={label} last={last} rewatch={rewatch} />}
          </div>
        )
      })}
      {clubs.length > limit && (
        <button className="btn-ghost min-h-8 py-1.5 text-xs" onClick={() => setMore(limit + CLUBS_STEP * 2)}>
          Afficher plus de clubs ({fmt(clubs.length - limit)} autres)
        </button>
      )}
    </div>
  )
}

// ---------- Qui ? ----------

/** Ce que dit la liste « Qui ? » d'un club pour l'onglet : « 3 joueurs à voir », « tous vus ✓ », « 2 profils repérés »… */
export function whoSummary(o: Onglet, mainCount: number) {
  const tab = TAB[o]
  if (o === 'licencies') return plural(mainCount, 'joueur')
  if (o === 'reperes') return mainCount ? plural(mainCount, 'profil repéré', 'profils repérés') : 'aucun profil repéré'
  return mainCount ? `${plural(mainCount, 'joueur')} ${tab.todo}` : tab.done!
}

/** Détail d'un joueur compté : « vu le …, par … » (vus) ; sinon rien. */
export const sightText = (s?: Sight) => (s ? `vu le ${fmtDate(s.day)}${s.by ? `, par ${s.by}` : ''}` : '')

function Who({ club, label, last, rewatch }: { club: ClubCoverage<Player>; label: string; last: Map<string, Sight>; rewatch: Map<string, Rewatch[]> }) {
  const role = useRole()
  // « Déjà vus » ouvert et état du bilan : dans l'adresse (retrouvés au retour d'une fiche).
  const { o, search, seenOpen: showRest, setSeenOpen: setShowRest, qWho } = useContext(WhoCtx)
  const [adding, setAdding] = useState<string[] | null>(null)
  // Question posée : les joueurs du club qui y répondent.
  if (qWho) return qWho(club)
  const { main, rest } = whoOrder(club, o)
  const tab = TAB[o]
  // Fiche ouverte dans le bilan : les joueurs du club à côté (ordinateur) ou ‹ › (téléphone), retour à l'identique.
  const linkTo = (p: Player) => ({ to: `/bilan/joueurs/${p.id}${search}` })
  const addEvents = can.manageEvents(role)
  const year = (p: Player) => p.birthDate?.slice(0, 4) ?? ''
  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-extrabold">{clubLabel(club.name)}</div>
          <div className="text-[11px] text-muted">
            {label} · {whoSummary(o, main.length)}
          </div>
        </div>
        {addEvents && main.length > 1 && (
          <button className="btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={() => setAdding(main.map((p) => p.id))} title="Ajouter tous ces joueurs du club à un événement à venir">
            <Icon name="calendar" className="h-3.5 w-3.5" />
            Tous à un événement…
          </button>
        )}
      </div>

      {main.length > 0 && (
        <div className="flex flex-col gap-2">
          {main.map((p) => (
            <PlayerRow
              key={p.id}
              p={p}
              link={linkTo(p)}
              sub={year(p)}
              rewatch={o === 'vus' ? <RewatchToggle playerId={p.id} rows={rewatch.get(p.id)} /> : undefined}
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

      {rest.length > 0 && (
        <div className="border-t border-line pt-1">
          <button
            className={`flex min-h-8 w-full items-center gap-2 text-left text-[11px] font-bold ${o === 'reperes' ? 'text-muted' : 'text-emerald-300'}`}
            aria-expanded={showRest}
            onClick={() => setShowRest(!showRest)}
          >
            <Icon name={o === 'reperes' ? 'users' : 'eye'} className="h-3.5 w-3.5" />
            <span className="flex-1">
              {tab.rest} ({rest.length})
            </span>
            <span className={`text-muted transition ${showRest ? 'rotate-90' : ''}`}>›</span>
          </button>
          {showRest && (
            <div className="mt-1 flex flex-col gap-2">
              {rest.map((p) => (
                <PlayerRow
                  key={p.id}
                  p={p}
                  link={linkTo(p)}
                  sub={[year(p), o === 'vus' && sightText(last.get(p.id))].filter(Boolean).join(' · ')}
                  follow={<FollowStar id={p.id} />}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {adding && <AddToEventDialog playerIds={adding} onClose={() => setAdding(null)} />}
    </div>
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

// Fenêtre « Ajouter à un événement » : dans src/components/AddToEvent.tsx (aussi utilisée par le menu des lignes de joueur).
export { AddToEventDialog }
