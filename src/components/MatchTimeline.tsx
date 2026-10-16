import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { db, type Video } from '../db'
import { momentAction, simultaneous, stepIn, timeline, timelineOf, TWO_MIN, type ActionKind, type Side } from '../matchSheet'
import { applyCalibration, forgetUndo, lastUndo, onUndoChange, undoLast, updateSync, type SyncChange, type UndoEntry } from '../matchSync'
import { can, useRole } from '../roles'
import { fmtMoment } from '../videos'
import { actionLabel, calibrated, plural, useActionWho } from './matchLabels'
import { Icon } from './ui'
import type { PlayerTools } from './VideoPlayer'
import { PlaceMark } from './Videos'

/*
 * Frise du match sous la vidéo : un repère par action de la feuille de match, à son temps vidéo (toutes les actions du
 * match, pas seulement celles d'un joueur). Couleur de l'équipe (locaux bleu, visiteurs orange) ; plein = calée à l'œil
 * (✓), contour pointillé = estimée (~) ; forme selon le type (Glyph) ; repères de période sombres numérotés « 1 », « 2 »
 * (barrés en fin de période), « P1 », « P2 » en prolongation ; bande translucide pendant une exclusion de 2 minutes, et à
 * sa fin un « 2' » barré qui se cale comme une action (le retour du joueur se voit : bon repère, matchSheet.ts END2) ;
 * trait rouge = temps courant. Puces de filtre (Tous, Buts, 2', Cartons, Temps morts). Fenêtre d'environ 5 min autour du
 * temps courant, et en dessous la vidéo entière (toucher pour y aller). Des repères trop proches se regroupent en une
 * pastille « n » (couleur de l'équipe majoritaire, sinon neutre).
 *
 * Toucher un repère : la vidéo y va et il est choisi ; la carte en dessous donne l'action, son statut et son temps, avec
 * −2 s / +2 s, « C'est ici ! », retirer le repère et « Annuler ». Un repère se fait aussi glisser.
 *
 * Calage à la chaîne : après « C'est ici ! », le repère suivant affiché (filtre compris : avec « Buts », de but en but) est
 * choisi et la vidéo va à son estimation, 3 s avant, en lecture si elle l'était ; « Passer » y va sans caler ; « Annuler »
 * revient aussi au repère d'avant. Actions simultanées (même temps sur la feuille, matchSheet.ts simultaneous) : un seul
 * repère, toutes listées sur la carte, calées, retirées et annulées ensemble. Clavier (ordinateur) : Entrée = « C'est ici ! »,
 * N = passer ; espace et flèches sont gérés par le lecteur (VideoPlayer). Tout le calcul est dans
 * matchSheet.ts, les écritures dans matchSync.ts : ce fichier n'est que l'écran (il peut être remplacé sans y toucher).
 * Calage réservé à can.calibrateMatch, sur une vidéo d'événement en mode édition (Videos.tsx) ; sur une fiche joueur
 * (readOnly) et pour les autres : la frise et le statut seulement.
 */

/** Dernier calage annulable de cet événement (l'écran se met à jour quand la pile change). */
function useLastUndo(eventId: string) {
  const [, force] = useState(0)
  useEffect(() => onUndoChange(() => force((n) => n + 1)), [])
  return lastUndo(eventId)
}

/** Bouton « Annuler » du dernier calage de l'événement. */
export function UndoButton({ eventId, onDone }: { eventId: string; onDone?: (e?: UndoEntry) => void }) {
  const last = useLastUndo(eventId)
  if (!last) return null
  return (
    <button className="btn-ghost inline-flex h-8 items-center gap-1 px-2 text-[11px]" title={`Annuler le dernier calage (${last.label})`} onClick={() => void undoLast(eventId).then(onDone)}>
      <Icon name="undo" className="h-3.5 w-3.5" />
      Annuler <span className="max-w-[9rem] truncate text-muted">({last.label})</span>
    </button>
  )
}

const minuteOf = (t: number) => {
  const m = Math.floor(t / 60) + 1
  return `${m}${m === 1 ? 're' : 'e'} minute`
}

// ---------- Repères ----------

/**
 * Couleur d'équipe (feuille de match : recevant = « locaux », visiteur = « visiteurs ») : bleu et orange, lisibles sur
 * les deux thèmes et distincts du trait rouge du temps courant. Action sans équipe connue : couleur du texte.
 */
const TEAM_COLOR: Record<Side, string> = { home: '#3b82f6', away: '#f97316' }
const INK = 'var(--color-fg)'
const PAPER = 'var(--color-panel)'
const teamColor = (side?: Side) => (side ? TEAM_COLOR[side] : INK)
const CARD_COLOR: Partial<Record<ActionKind, string>> = { avert: '#facc15', disq: '#dc2626', bleu: '#2563eb' }

/** Écart minimal entre deux repères affichés séparément (px) ; en dessous, ils se regroupent. */
const MIN_GAP = 26
/** Largeurs de fenêtre proposées (s). */
const SPANS = [60, 150, 300, 600, 1200]
/** Repères de période : nom, et chiffre affiché (barré pour une fin de période). Prolongations : « P1 », « P2 ». */
const PERIOD_MARK: Record<string, string> = {
  s1: 'Coup d’envoi',
  e1: 'Fin 1re mi-temps',
  s2: 'Début 2e mi-temps',
  e2: 'Fin du match',
  s3: 'Début prolongation 1',
  e3: 'Fin prolongation 1',
  s4: 'Début prolongation 2',
  e4: 'Fin prolongation 2',
}
const periodBadge = (key: string) => {
  const p = Number(key.slice(1))
  return p <= 2 ? String(p) : `P${p - 2}`
}

/** Filtres de la frise (gardés sur l'appareil). */
type Filter = 'all' | 'goals' | 'two' | 'cards' | 'tm'
const FILTERS: { k: Filter; label: string; kinds?: ActionKind[] }[] = [
  { k: 'all', label: 'Tous' },
  { k: 'goals', label: 'Buts', kinds: ['but', 'but7'] },
  { k: 'two', label: '2’', kinds: ['2mn'] },
  { k: 'cards', label: 'Cartons', kinds: ['avert', 'disq', 'bleu'] },
  { k: 'tm', label: 'Temps morts', kinds: ['tm'] },
]
const FILTER_KEY = 'handbase.frise.filtre'
const readFilter = (): Filter => {
  try {
    const v = localStorage.getItem(FILTER_KEY)
    return FILTERS.some((f) => f.k === v) ? (v as Filter) : 'all'
  } catch {
    return 'all'
  }
}

/** Aide « Comment caler » : ouverte la première fois, puis repliée une fois qu'on l'a refermée (gardé sur l'appareil). */
const HELP_KEY = 'handbase.frise.aide'
const readHelpSeen = () => {
  try {
    return localStorage.getItem(HELP_KEY) === 'vue'
  } catch {
    return false
  }
}

/** Un repère de la frise : action de la feuille (i, type, équipe) ou repère de période (key). */
type Mk = { id: string; v: number; i?: number; is?: number[]; end?: boolean; key?: string; k?: ActionKind; side?: Side; fixed: boolean; mine: boolean }
/** Repère choisi : action i (ou la fin de ses 2 minutes, end), ou repère de période. */
type Sel = { i: number; end?: boolean } | { key: string }
const selId = (s?: Sel) => (!s ? '' : 'i' in s ? `${s.end ? 'f' : 'a'}${s.i}` : `m${s.key}`)
const selOf = (m: Mk): Sel => (m.i !== undefined ? { i: m.i, ...(m.end && { end: true }) } : { key: m.key! })
/** Repère choisi retrouvé depuis son identifiant (« a12 », « f12 », « ms1 ») : pour revenir en arrière après « Annuler ». */
const selFromId = (id?: string): Sel | undefined =>
  !id ? undefined : id[0] === 'm' ? { key: id.slice(1) } : { i: Number(id.slice(1)), ...(id[0] === 'f' && { end: true }) }
/** Type montré pour un groupe d'actions simultanées : but d'abord, puis exclusion, carton, temps mort, le reste. */
const KIND_RANK: Partial<Record<ActionKind, number>> = { but: 0, but7: 0, '2mn': 1, disq: 2, avert: 2, bleu: 2, tm: 3 }
const rank = (k: ActionKind) => KIND_RANK[k] ?? 4

/**
 * Forme d'un repère, selon son type ; pointe ou trait en bas, sur son temps. Calé = plein, estimé = contour pointillé, dans
 * la couleur de l'équipe. But : épingle (la plus visible, les buts se calent le mieux) ; but sur 7 m : épingle « 7 » ;
 * 2 minutes : étiquette « 2' » ; avertissement, disqualification, carton bleu : carton jaune, rouge, bleu ; temps mort :
 * étiquette « T » ; le reste (tirs, arrêts…) : point. Période : épingle sombre avec son chiffre, barré pour une fin.
 */
function Glyph({ mk, big }: { mk: Mk; big?: boolean }) {
  const scale = big ? 1.45 : 1
  const color = mk.key ? INK : teamColor(mk.side)
  const fill = mk.fixed ? color : `color-mix(in srgb, ${color} 22%, transparent)`
  const line = { stroke: color, strokeWidth: mk.fixed ? 1 : 1.5, strokeDasharray: mk.fixed ? undefined : '2.2 1.6', strokeLinejoin: 'round' as const }
  const text = (s: string, size: number, y: number) => (
    <text x="7" y={y} textAnchor="middle" fontSize={size} fontWeight={800} style={{ fill: mk.fixed ? (mk.key ? PAPER : '#fff') : color }}>
      {s}
    </text>
  )
  const stem = <line x1="7" y1="12" x2="7" y2="18" stroke={color} strokeWidth={1.2} />
  let body
  if (mk.key) {
    const badge = periodBadge(mk.key)
    body = (
      <>
        <path d="M7 18 L0 10 V0 H14 V10 Z" style={{ fill: INK, stroke: INK }} strokeWidth={1} strokeLinejoin="round" />
        {text(badge, badge.length > 1 ? 6.5 : 8.5, 8)}
        {mk.key.startsWith('e') && <line x1="1.5" y1="9" x2="12.5" y2="2.5" style={{ stroke: PAPER }} strokeWidth={1.4} />}
      </>
    )
  } else if (mk.k === 'but' || mk.k === 'but7') {
    body = (
      <>
        <path d="M7 18 L0 10 V0 H14 V10 Z" style={{ fill }} {...line} />
        {mk.k === 'but7' && text('7', 8.5, 8)}
      </>
    )
  } else if (mk.k === '2mn' || mk.k === 'tm') {
    body = (
      <>
        {stem}
        <rect x="0.5" y="1" width="13" height="10" rx="2" style={{ fill }} {...line} />
        {text(mk.k === 'tm' ? 'T' : '2’', 7.5, 9)}
        {/* Fin des 2 minutes : « 2' » barré. */}
        {mk.end && <line x1="1.5" y1="9.5" x2="12.5" y2="2.5" style={{ stroke: mk.fixed ? '#fff' : color }} strokeWidth={1.4} />}
      </>
    )
  } else if (mk.k && CARD_COLOR[mk.k]) {
    const card = CARD_COLOR[mk.k]!
    body = (
      <>
        {stem}
        <rect x="3" y="0.5" width="8" height="11.5" rx="1.2" style={{ fill: mk.fixed ? card : `color-mix(in srgb, ${card} 35%, transparent)` }} {...line} />
      </>
    )
  } else {
    body = (
      <>
        {stem}
        <circle cx="7" cy="9" r="3.6" style={{ fill }} {...line} />
      </>
    )
  }
  return (
    <svg width={16 * scale} height={24 * scale} viewBox="-1 -1 16 24" aria-hidden className="pointer-events-none overflow-visible drop-shadow">
      {body}
      {/* Actions simultanées : nombre d'actions du groupe. */}
      {(mk.is?.length ?? 0) > 1 && !mk.end && (
        <>
          <circle cx="14" cy="0" r="4.2" style={{ fill: INK }} />
          <text x="14" y="2.6" textAnchor="middle" fontSize="6.5" fontWeight={800} style={{ fill: PAPER }}>
            {mk.is!.length}
          </text>
        </>
      )}
      {/* Action du joueur de la fiche ouverte : point sous le repère. */}
      {mk.mine && <circle cx="7" cy="21.5" r="1.8" style={{ fill: INK }} />}
    </svg>
  )
}

/** Couleur d'une pastille de repères regroupés : celle de l'équipe largement majoritaire (3 sur 4), sinon neutre. */
function clusterColor(g: Mk[]) {
  for (const side of ['home', 'away'] as const) if (g.filter((m) => m.side === side).length >= g.length * 0.75) return TEAM_COLOR[side]
  return INK
}

/**
 * Frise et carte de calage. video : vidéo ouverte ; eventVideo : c'est une vidéo de l'événement (le calage s'y rattache),
 * sinon le lien d'une fiche joueur (même adresse). pls : joueurs de la feuille reliés à cette fiche (leurs repères marqués
 * d'un point ; le moment lancé choisit son action).
 */
export default function MatchTimeline({
  eventId,
  video,
  eventVideo,
  api,
  pls = [],
  playerId,
  readOnly = false,
}: {
  eventId: string
  video: Pick<Video, 'id' | 'url'>
  eventVideo: boolean
  api: PlayerTools
  pls?: number[]
  playerId?: string
  /** Frise consultée sans calage (fiche joueur), même pour qui a le droit de caler. */
  readOnly?: boolean
}) {
  const role = useRole()
  const ev = useLiveQuery(() => db.events.get(eventId), [eventId])
  const ms = ev?.matchSheet
  const who = useActionWho(ms)
  const apiRef = useRef(api)
  useLayoutEffect(() => {
    apiRef.current = api
  })
  const [now, setNow] = useState(0)
  const [dur, setDur] = useState<number>()
  const [span, setSpan] = useState(300)
  const [sel, setSel] = useState<Sel>()
  const [group, setGroup] = useState<Mk[]>()
  const [filter, setFilterState] = useState<Filter>(readFilter)
  const setFilter = (f: Filter) => {
    setFilterState(f)
    setGroup(undefined)
    try {
      localStorage.setItem(FILTER_KEY, f)
    } catch {
      /* stockage indisponible */
    }
  }
  const [helpOpen, setHelpOpenState] = useState(() => !readHelpSeen())
  // Vue : une fois refermée, ou après un premier « C'est ici ! » (elle reste ouverte jusqu'à la prochaine fois).
  const helpSeen = () => {
    try {
      localStorage.setItem(HELP_KEY, 'vue')
    } catch {
      /* stockage indisponible */
    }
  }
  const setHelpOpen = (v: boolean) => {
    setHelpOpenState(v)
    if (!v) helpSeen()
  }
  const [drag, setDrag] = useState<{ id: string; v: number; start: number }>()
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  // Entrée = « C'est ici ! », N = passer : écoutés tant que la frise est ouverte, quel que soit le focus (sauf champ de saisie).
  const keys = useRef<{ enter?: () => void; next?: () => void }>({})
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.altKey || e.ctrlKey || e.metaKey || (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable))) return
      const fn = e.key === 'Enter' ? keys.current.enter : e.key === 'n' || e.key === 'N' ? keys.current.next : undefined
      if (!fn) return
      e.preventDefault()
      e.stopPropagation()
      if (!e.repeat) fn()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const hasMs = !!ms

  // Temps courant et durée, relus 5 fois par seconde.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const t = apiRef.current.time()
      if (t !== undefined) setNow(t)
      const d = apiRef.current.duration()
      if (d) setDur(d)
    }, 200)
    return () => window.clearInterval(timer)
  }, [])
  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 320))
    ro.observe(el)
    setWidth(el.clientWidth || 320)
    return () => ro.disconnect()
  }, [hasMs])

  // Fiche joueur : le moment lancé choisit son action.
  const mNote = api.moment?.note
  const mAt = api.moment?.at
  useEffect(() => {
    if (!ms || !api.moment || !pls.length) return
    const i = momentAction(ms, pls, api.moment)
    if (i !== undefined) setSel({ i: simultaneous(ms.actions, timelineOf(ms).late)[i][0] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mNote, mAt, hasMs])

  if (!ev || !ms) return null
  const calib = !readOnly && can.calibrateMatch(role, { eventId, playerId })
  const sync = ms.sync
  const tl = timelineOf(ms)
  const marks = sync?.marks ?? {}
  const fix = sync?.fix ?? {}
  const anchored = Object.keys(marks).length + Object.keys(fix).length > 0
  const other = eventVideo && !!sync?.videoId && sync.videoId !== video.id && anchored

  if (other)
    return (
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]">
        <span className="text-amber-200">La feuille de match est calée sur une autre vidéo de l’événement.</span>
        {calib && (
          <button
            className="btn-ghost h-8 px-2 text-[11px]"
            onClick={async () => {
              await updateSync(eventId, (s) => ({ marks: {}, opts: s.opts, videoId: video.id, url: video.url }))
              forgetUndo(eventId)
            }}
          >
            Caler sur cette vidéo
          </button>
        )}
      </div>
    )

  // Repères : actions placées et repères de période posés.
  const mks: Mk[] = []
  for (const [key, v] of Object.entries(marks)) if (PERIOD_MARK[key]) mks.push({ id: `m${key}`, v, key, fixed: true, mine: false })
  const kinds = FILTERS.find((f) => f.k === filter)?.kinds
  const sim = simultaneous(ms.actions, tl.late)
  const isMine = (i: number) => ms.actions[i].pl !== undefined && pls.includes(ms.actions[i].pl!)
  ms.actions.forEach((a, i) => {
    const g = sim[i]
    // Fin des 2 minutes : repère à part (autre temps), même pour une exclusion d'un groupe.
    const e = tl.end2(i)
    if (e && (!kinds || kinds.includes('2mn') || selId(sel) === `f${i}`))
      mks.push({ id: `f${i}`, v: e.v, i, end: true, k: a.k, side: a.side, fixed: e.fixed, mine: isMine(i) })
    if (g[0] !== i) return // groupe : un seul repère, au nom de sa première action
    const v = tl.at(i)
    if (v === undefined) return
    // Filtre : un groupe s'affiche si l'une de ses actions correspond ; le repère choisi reste affiché.
    if (kinds && !g.some((j) => kinds.includes(ms.actions[j].k)) && selId(sel) !== `a${i}`) return
    const lead = [...g].sort((x, y) => rank(ms.actions[x].k) - rank(ms.actions[y].k))[0]
    mks.push({
      id: `a${i}`,
      v,
      i,
      is: g,
      k: ms.actions[lead].k,
      side: ms.actions[lead].side,
      fixed: g.every((j) => fix[tl.keys[j]] !== undefined),
      mine: g.some(isMine),
    })
  })
  mks.sort((a, b) => a.v - b.v)
  // Exclusions de 2 minutes : bande de la couleur de l'équipe, 2 min de jeu à partir de l'action (infériorité numérique).
  const bands =
    filter === 'all' || filter === 'two'
      ? ms.actions.flatMap((a, i) => {
          if (a.k !== '2mn') return []
          const v0 = tl.at(i)
          const v1 = tl.end2(i)?.v ?? tl.spanEnd(i, 120)
          return v0 === undefined || v1 === undefined ? [] : [{ i, v0, v1, side: a.side }]
        })
      : []
  // Nombre d'actions par filtre (puces), et équipes de la légende.
  const count = (f: (typeof FILTERS)[number]) => (f.kinds ? ms.actions.filter((a) => f.kinds!.includes(a.k)).length : ms.actions.length)
  const total = Math.max(dur ?? 0, now + 60, (mks.at(-1)?.v ?? 0) + 60)
  const win = Math.min(span, total)
  // Fenêtre centrée sur le temps courant ; lecteur pas encore prêt : sur l'action choisie.
  const focus = api.ready ? now : (mks.find((m) => m.id === selId(sel))?.v ?? now)
  const start = drag ? drag.start : Math.min(Math.max(0, focus - win / 2), Math.max(0, total - win))
  const xOf = (v: number) => ((v - start) / win) * width
  const vOf = (x: number) => start + (x / width) * win
  const shown = mks.filter((m) => m.v >= start - 1 && m.v <= start + win + 1).map((m) => (drag?.id === m.id ? { ...m, v: drag.v } : m))
  // Regroupement des repères trop proches (le repère choisi ou glissé reste seul).
  const groups: Mk[][] = []
  for (const m of shown) {
    const g = groups.at(-1)
    const alone = m.id === selId(sel) || m.id === drag?.id
    if (g && !alone && !g.some((x) => x.id === selId(sel) || x.id === drag?.id) && xOf(m.v) - xOf(g[0].v) < MIN_GAP) g.push(m)
    else groups.push([m])
  }

  /** Aller 3 s avant v ; play false : sans changer lecture / pause (calage à la chaîne). */
  const seek = (v: number, play = true) => api.seek(Math.max(0, v - 3), play)
  const choose = (m: Mk, play = true) => {
    setSel(selOf(m))
    setGroup(undefined)
    setMsg('')
    seek(m.v, play)
  }
  async function write(ch: SyncChange[], label: string, v: number | undefined, ctx: string) {
    setBusy(true)
    try {
      const r = await applyCalibration(eventId, ch, label, eventVideo ? video : undefined, ctx)
      setMsg(v === undefined ? 'Repère retiré : l’action est de nouveau estimée.' : calibrated(v, r))
    } finally {
      setBusy(false)
    }
  }
  /** Actions d'un repère choisi : le groupe d'actions simultanées, ou l'exclusion seule pour la fin de ses 2 minutes. */
  const membersOf = (s: { i: number; end?: boolean }) => (s.end ? [s.i] : sim[s.i])
  const nameOf = (i: number) => {
    const a = ms.actions[i]
    const num = a.pl !== undefined ? ms.players[a.pl]?.num : undefined
    return `${actionLabel(a)}${num ? ` n°${num}` : ''}`
  }
  const labelOf = (s: Sel) => {
    if ('key' in s) return PERIOD_MARK[s.key]
    const a = ms.actions[s.i]
    const num = a.pl !== undefined ? ms.players[a.pl]?.num : undefined
    if (s.end) return `Fin des 2’${num ? ` n°${num}` : ''} · ${minuteOf(a.t + TWO_MIN)}`
    return `${membersOf(s).map(nameOf).join(' + ')} · ${minuteOf(a.t)}`
  }
  const undoLabel = (s: Sel) =>
    'key' in s
      ? PERIOD_MARK[s.key]
      : `${s.end ? 'Fin des 2’' : membersOf(s).map((i) => actionLabel(ms.actions[i])).join(' + ')} ${ms.actions[s.i].s[0]}-${ms.actions[s.i].s[1]}`
  /** Clés de calage (sync.fix) d'un repère : toutes les actions du groupe, ou la fin des 2 minutes. */
  const fixKeys = (s: { i: number; end?: boolean }) => (s.end ? [tl.endKey(s.i)] : membersOf(s).map((i) => tl.keys[i]))
  /** Pose le repère choisi à v (s), ou le retire (v absent) ; un groupe, d'un coup. */
  const place = (s: Sel, v?: number) => {
    const val = v === undefined ? undefined : Math.max(0, Math.round(v * 10) / 10)
    const label = val === undefined ? `retrait ${undoLabel(s)}` : undoLabel(s)
    const ch: SyncChange[] = 'key' in s ? [{ kind: 'mark', key: s.key, v: val }] : fixKeys(s).map((key) => ({ kind: 'fix', key, v: val }))
    return write(ch, label, val, selId(s))
  }
  /** Temps vidéo d'un repère d'après la feuille relue (après un calage, avant que l'écran soit à jour). */
  async function freshV(s: Sel): Promise<number | undefined> {
    const m = (await db.events.get(eventId))?.matchSheet
    if (!m) return undefined
    if ('key' in s) return m.sync?.marks?.[s.key]
    const t = timeline(m)
    return s.end ? t.end2(s.i)?.v : t.at(s.i)
  }
  /** Calage à la chaîne : choisir le repère suivant affiché et y aller, en gardant lecture ou pause. */
  async function goNext(from: Sel, anchoredNow: boolean) {
    const next = stepIn(mks, selId(from), 1)
    if (!next) return setMsg((m) => `${m ? `${m} ` : ''}Dernier repère : fin de la chaîne.`)
    const s = selOf(next)
    setSel(s)
    setGroup(undefined)
    const v = anchoredNow ? await freshV(s) : next.v
    if (v !== undefined) seek(v, api.playing())
  }
  const here = async (s: Sel) => {
    const t = api.time()
    if (t === undefined) return setMsg('Lance la vidéo d’abord (le lecteur n’est pas encore prêt).')
    helpSeen()
    await place(s, t)
    await goNext(s, true)
  }
  const pass = () => {
    if (!sel) return
    setMsg('')
    void goNext(sel, false)
  }
  /** Après « Annuler » : retour au repère qui avait été calé, à son temps rétabli. */
  async function backTo(e?: UndoEntry) {
    setMsg('Calage annulé.')
    const s = selFromId(e?.ctx)
    if (!s) return
    setSel(s)
    const v = await freshV(s)
    if (v !== undefined) seek(v, api.playing())
  }

  // Glisser un repère (calage) ; un simple toucher le choisit.
  const onDown = (m: Mk) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!calib || busy) return
    const x0 = e.clientX
    const el = e.currentTarget
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* pointeur déjà relâché */
    }
    let moved = false
    const frozen = start
    const rect = track.current!.getBoundingClientRect()
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 5) return
      moved = true
      const x = Math.min(Math.max(0, ev.clientX - rect.left), rect.width)
      setDrag({ id: m.id, v: frozen + (x / width) * win, start: frozen })
    }
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (!moved) return
      const x = Math.min(Math.max(0, ev.clientX - rect.left), rect.width)
      const v = frozen + (x / width) * win
      setDrag(undefined)
      const s = selOf(m)
      setSel(s)
      if (ev.type === 'pointerup') void place(s, v)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const selMk = mks.find((m) => m.id === selId(sel))
  const step = (d: 1 | -1) => {
    const m = stepIn(mks, selId(sel), d)
    if (m) choose(m, api.playing())
  }
  const selFixed = (s: Sel) => ('key' in s ? marks[s.key] !== undefined : fixKeys(s).every((k) => fix[k] !== undefined))
  const fixedSel = sel ? selFixed(sel) : false
  const anyFixedSel = sel ? ('key' in sel ? fixedSel : fixKeys(sel).some((k) => fix[k] !== undefined)) : false
  keys.current = calib && sel && !busy ? { enter: () => void here(sel), next: pass } : { next: sel ? pass : undefined }
  const small = 'flex h-8 min-w-8 items-center justify-center rounded border border-line bg-panel px-2 text-[11px] font-bold hover:border-accent disabled:opacity-40'
  // Mode édition : petit libellé visible sous un bouton à icône (sur téléphone, pas de survol pour lire son title).
  const named = (button: ReactNode, name: string) =>
    calib ? (
      <span className="flex flex-col items-center gap-0.5">
        {button}
        <span className="text-[10px] leading-none text-muted" aria-hidden>
          {name}
        </span>
      </span>
    ) : (
      button
    )

  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2 pb-2 text-[11px]">
      {/* En-tête : compte, coup d'envoi, zoom. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold text-emerald-300 tabular-nums">
          {plural(tl.fixedCount, 'action calée', 'actions calées')} sur {ms.actions.length}
          {tl.endFixedCount > 0 && ` · ${plural(tl.endFixedCount, 'fin de 2’ calée', 'fins de 2’ calées')}`}
        </span>
        {marks.s1 === undefined && calib && (
          <button className="btn-primary h-8 px-3 text-xs" disabled={!api.ready || busy} title="Mets la vidéo sur le coup d’envoi, puis touche ce bouton" onClick={() => here({ key: 's1' })}>
            Coup d’envoi ici
          </button>
        )}
        {!anchored && !calib && <span className="text-muted">Pas encore calée sur la vidéo.</span>}
        <span className="ml-auto flex items-center gap-1">
          {named(
            <button className={small} title="Élargir la fenêtre" aria-label="Élargir la fenêtre" disabled={span >= SPANS.at(-1)!} onClick={() => setSpan(SPANS[SPANS.indexOf(span) + 1] ?? span)}>
              −
            </button>,
            'Élargir',
          )}
          <span className="w-12 text-center text-muted tabular-nums">{span >= 60 ? `${Math.round(span / 60 * 10) / 10} min`.replace('.', ',') : `${span} s`}</span>
          {named(
            <button className={small} title="Rapprocher" aria-label="Rapprocher" disabled={span <= SPANS[0]} onClick={() => setSpan(SPANS[SPANS.indexOf(span) - 1] ?? span)}>
              +
            </button>,
            'Rapprocher',
          )}
        </span>
      </div>
      {marks.s1 === undefined && calib && <p className="text-[10px] text-muted">Mets la vidéo sur le coup d’envoi du match puis touche « Coup d’envoi ici » : toutes les actions seront estimées.</p>}
      {/* Mode édition : « Comment caler ? », ouvert la première fois, repliable (mémorisé sur l'appareil). */}
      {calib && (
        <div className="rounded-md border border-line bg-panel-2/60">
          <button type="button" className="flex min-h-8 w-full items-center gap-1.5 px-2 text-left text-[11px] font-bold" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}>
            <span className="flex-1">Comment caler ?</span>
            <span className={`text-muted transition ${helpOpen ? 'rotate-90' : ''}`} aria-hidden>
              ›
            </span>
          </button>
          {helpOpen && (
            <div className="flex flex-col gap-1 px-2 pb-2 text-[11px] text-muted">
              <p>
                Touche un repère : la vidéo va à son temps estimé. Laisse défiler et touche « C’est ici ! » au moment exact de l’action ; le repère suivant
                est choisi tout seul. « Passer » (N) va au suivant sans caler, −2 s / +2 s ajuste, et un repère se fait aussi glisser.
              </p>
              <p>Plein = calé, pointillé = estimé · épingle : but (« 7 » : sur 7 m) · « 2’ » : exclusion · carton jaune, rouge, bleu · « T » : temps mort · point : autre action.</p>
            </div>
          )}
        </div>
      )}

      {/* Filtres et légende des équipes. */}
      <div className="flex flex-wrap gap-1" role="group" aria-label="Actions affichées">
        {FILTERS.filter((f) => !f.kinds || count(f) > 0).map((f) => (
          <button
            key={f.k}
            className={`h-8 shrink-0 rounded-full border px-2.5 text-[11px] font-bold ${filter === f.k ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted hover:text-fg'}`}
            aria-pressed={filter === f.k}
            onClick={() => setFilter(f.k)}
          >
            {f.label}
            {f.kinds && <span className="ml-1 font-normal tabular-nums">{count(f)}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
        {(['home', 'away'] as const).map((side) => (
          <span key={side} className="flex min-w-0 max-w-full items-center gap-1">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: TEAM_COLOR[side] }} />
            <span className="truncate">
              <span className="text-muted">{side === 'home' ? 'Locaux' : 'Visiteurs'} :</span> {side === 'home' ? ms.home : ms.away}
            </span>
          </span>
        ))}
      </div>

      {/* Fenêtre autour du temps courant. */}
      <div
        ref={track}
        className="relative h-11 touch-none select-none overflow-hidden rounded-md border border-line bg-panel-2"
        aria-label="Frise du match"
        onClick={(e) => {
          if (e.target !== e.currentTarget) return
          const r = e.currentTarget.getBoundingClientRect()
          api.seek(vOf(e.clientX - r.left))
          setGroup(undefined)
        }}
      >
        {/* Graduations : une par minute de vidéo. */}
        {Array.from({ length: Math.floor(win / 60) + 2 }, (_, k) => Math.ceil(start / 60) * 60 + k * 60)
          .filter((t) => t <= start + win)
          .map((t) => (
            <span key={t} className="pointer-events-none absolute bottom-0 h-1.5 border-l border-line" style={{ left: xOf(t) }}>
              {win <= 600 && <span className="absolute bottom-1.5 left-0.5 text-[8px] text-muted tabular-nums">{fmtMoment(t)}</span>}
            </span>
          ))}
        {bands
          .filter((b) => b.v1 >= start && b.v0 <= start + win)
          .map((b) => (
            <span
              key={`b${b.i}`}
              className="pointer-events-none absolute top-0 bottom-0"
              style={{ left: Math.max(0, xOf(b.v0)), width: Math.max(2, xOf(b.v1) - Math.max(0, xOf(b.v0))), background: teamColor(b.side), opacity: 0.16 }}
              title="Exclusion de 2 minutes"
            />
          ))}
        {groups.map((g) =>
          g.length === 1 ? (
            <button
              key={g[0].id}
              className="absolute top-0 flex h-9 w-8 -translate-x-1/2 items-start justify-center pt-1"
              style={{ left: xOf(g[0].v) }}
              title={`${g[0].i !== undefined ? labelOf(selOf(g[0])) : PERIOD_MARK[g[0].key!]} — ${g[0].fixed ? 'calé' : 'estimé'} à ${fmtMoment(Math.round(g[0].v))}`}
              aria-label={`${g[0].i !== undefined ? labelOf(selOf(g[0])) : PERIOD_MARK[g[0].key!]}, ${g[0].fixed ? 'calé' : 'estimé'}`}
              aria-pressed={g[0].id === selId(sel)}
              onPointerDown={onDown(g[0])}
              onClick={() => !drag && choose(g[0])}
            >
              <Glyph mk={g[0]} big={g[0].id === selId(sel) || g[0].id === drag?.id} />
            </button>
          ) : (
            <button
              key={g[0].id}
              className="absolute top-1 flex h-8 min-w-8 -translate-x-1/2 items-center justify-center"
              style={{ left: (xOf(g[0].v) + xOf(g.at(-1)!.v)) / 2 }}
              title={`${g.length} actions — voir la liste`}
              aria-label={`${g.length} actions rapprochées`}
              onClick={() => setGroup(group?.[0]?.id === g[0].id ? undefined : g)}
            >
              <span
                className={`rounded-full border px-1.5 text-[10px] font-extrabold tabular-nums ${g.some((m) => m.fixed) ? '' : 'border-dashed'}`}
                style={
                  g.some((m) => m.fixed)
                    ? { borderColor: clusterColor(g), background: clusterColor(g), color: clusterColor(g) === INK ? PAPER : '#fff' }
                    : { borderColor: clusterColor(g), background: `color-mix(in srgb, ${clusterColor(g)} 20%, transparent)` }
                }
              >
                {g.length}
              </span>
            </button>
          ),
        )}
        {/* Temps courant. */}
        <span className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-red-500" style={{ left: xOf(now) }} />
      </div>

      {/* Repères regroupés : la liste. */}
      {group && (
        <div className="flex max-h-40 flex-col overflow-y-auto rounded-md border border-line bg-panel-2" role="listbox" aria-label="Actions rapprochées">
          {group.map((m) => (
            <button key={m.id} className="flex h-8 shrink-0 items-center gap-2 px-2 text-left hover:bg-accent/10" onClick={() => choose(m)}>
              <span className={`w-12 shrink-0 tabular-nums ${m.fixed ? 'font-bold text-emerald-300' : 'text-amber-200'}`}>
                {m.fixed ? '✓' : '~'} {fmtMoment(Math.round(m.v))}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {m.i !== undefined ? labelOf(selOf(m)) : PERIOD_MARK[m.key!]} {m.i !== undefined && <span className="text-muted">{who(ms.actions[m.i])}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Toute la vidéo : toucher pour y aller. */}
      <div
        className="relative h-8 cursor-pointer touch-none"
        aria-label="Toute la vidéo"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          api.seek(((e.clientX - r.left) / r.width) * total)
        }}
      >
        <div className="pointer-events-none absolute inset-x-0 top-3 h-2 rounded-full bg-panel-2">
          {mks.map((m) => (
            <span
              key={m.id}
              className="absolute top-0 h-2 w-px"
              style={{ left: `${(m.v / total) * 100}%`, background: m.key ? INK : teamColor(m.side), opacity: m.fixed ? 1 : 0.45 }}
            />
          ))}
          <span className="absolute -top-0.5 h-3 rounded border border-fg/60" style={{ left: `${(start / total) * 100}%`, width: `${Math.max(1, (win / total) * 100)}%` }} />
          <span className="absolute -top-1 h-4 w-0.5 bg-red-500" style={{ left: `${(now / total) * 100}%` }} />
        </div>
      </div>

      {/* Carte de l'action choisie. */}
      {sel && selMk ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-accent/50 bg-panel-2 p-2">
          <div className="flex items-center gap-1.5">
            {named(
              <button className={small} title="Action précédente" aria-label="Action précédente" disabled={!stepIn(mks, selId(sel), -1)} onClick={() => step(-1)}>
                <Icon name="prev" className="h-3.5 w-3.5" />
              </button>,
              'Préc.',
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold">{labelOf(sel)}</div>
              <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted">
                {'i' in sel && (
                  <span className="truncate">
                    {ms.actions[sel.i].s[0]}-{ms.actions[sel.i].s[1]} · {[...new Set(membersOf(sel).map((i) => who(ms.actions[i])))].join(', ')}
                    {tl.late.has(sel.i) ? ' · saisie en retard' : ''}
                  </span>
                )}
                {'key' in sel ? <span className="font-bold text-emerald-300">repère posé</span> : <PlaceMark status={fixedSel ? 'fixed' : 'estimated'} />}
                <span className="tabular-nums">à {fmtMoment(Math.round(selMk.v))}</span>
              </div>
            </div>
            {named(
              <button className={small} title="Action suivante" aria-label="Action suivante" disabled={!stepIn(mks, selId(sel), 1)} onClick={() => step(1)}>
                <Icon name="next" className="h-3.5 w-3.5" />
              </button>,
              'Suiv.',
            )}
          </div>
          {calib && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button className={small} disabled={busy} title="Placer cette action 2 s plus tôt" onClick={() => void place(sel, selMk.v - 2)}>
                −2 s
              </button>
              <button className={small} disabled={busy} title="Placer cette action 2 s plus tard" onClick={() => void place(sel, selMk.v + 2)}>
                +2 s
              </button>
              <button
                className="h-9 rounded-md bg-yellow-400 px-4 text-sm font-extrabold text-black hover:bg-yellow-300 disabled:opacity-50"
                disabled={!api.ready || busy}
                title="L’action est à ce moment de la vidéo"
                onClick={() => void here(sel)}
              >
                C’est ici !
              </button>
              <button className={small} disabled={busy || !stepIn(mks, selId(sel), 1)} title="Passer au repère suivant sans caler celui-ci (N)" onClick={pass}>
                Passer
              </button>
              {anyFixedSel && (
                <button className={`${small} text-muted hover:text-red-400`} disabled={busy} title="Retirer ce repère (l’action redevient estimée)" onClick={() => void place(sel)}>
                  <Icon name="close" className="h-3.5 w-3.5" />
                  <span className="ml-1">Retirer</span>
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        anchored && <p className="text-[10px] text-muted">Touche un repère de la frise : la vidéo y va. {calib && 'Laisse défiler et touche « C’est ici ! » au moment exact de l’action.'}</p>
      )}
      {calib && (msg || lastUndo(eventId)) && (
        <div className="flex flex-wrap items-center gap-2">
          {msg && <span className="min-w-0 flex-1 text-[10px] text-emerald-300">{msg}</span>}
          <UndoButton eventId={eventId} onDone={(e) => void backTo(e)} />
        </div>
      )}
      {/* Raccourcis : ordinateur (pointeur précis) seulement. */}
      <p className="hidden text-[10px] text-muted [@media(hover:hover)_and_(pointer:fine)]:block">
        Espace : lecture · ← → 2 s · Maj 0,5 s{calib ? ' · Entrée : c’est ici' : ''} · N : passer
      </p>
    </div>
  )
}
