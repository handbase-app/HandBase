import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { db, type Video } from '../db'
import { momentAction, timelineOf } from '../matchSheet'
import { applyCalibration, forgetUndo, lastUndo, onUndoChange, undoLast, updateSync } from '../matchSync'
import { can, useRole } from '../roles'
import { fmtMoment } from '../videos'
import { actionLabel, calibrated, plural, useActionWho } from './matchLabels'
import { Icon } from './ui'
import type { PlayerTools } from './VideoPlayer'
import { PlaceMark } from './Videos'

/*
 * Frise du match sous la vidéo : un repère par action de la feuille de match, à son temps vidéo (toutes les actions du
 * match, pas seulement celles d'un joueur). Jaune plein = calée à l'œil (✓), jaune pointillé = estimée (~), vert = coup
 * d'envoi et repères de période ; trait rouge = temps courant. Fenêtre d'environ 5 min autour du temps courant, et en
 * dessous la vidéo entière (toucher pour y aller). Des repères trop proches se regroupent en une pastille « n ».
 *
 * Toucher un repère : la vidéo y va et il est choisi ; la carte en dessous donne l'action, son statut et son temps, avec
 * −2 s / +2 s, « C'est ici ! », retirer le repère et « Annuler ». Un repère se fait aussi glisser. Tout le calcul est dans
 * matchSheet.ts, les écritures dans matchSync.ts : ce fichier n'est que l'écran (il peut être remplacé sans y toucher).
 * Calage réservé à can.calibrateMatch ; les autres voient la frise et le statut.
 */

/** Dernier calage annulable de cet événement (l'écran se met à jour quand la pile change). */
function useLastUndo(eventId: string) {
  const [, force] = useState(0)
  useEffect(() => onUndoChange(() => force((n) => n + 1)), [])
  return lastUndo(eventId)
}

/** Bouton « Annuler » du dernier calage de l'événement. */
export function UndoButton({ eventId, onDone }: { eventId: string; onDone?: () => void }) {
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

const YELLOW = '#facc15'
const GREEN = '#22c55e'
/** Écart minimal entre deux repères affichés séparément (px) ; en dessous, ils se regroupent. */
const MIN_GAP = 26
/** Largeurs de fenêtre proposées (s). */
const SPANS = [60, 150, 300, 600, 1200]
const PERIOD_MARK: Record<string, string> = { s1: 'Coup d’envoi', e1: 'Fin 1re mi-temps', s2: 'Début 2e mi-temps', e2: 'Fin du match' }

/** Un repère de la frise : action de la feuille (i) ou repère de période (key). */
type Mk = { id: string; v: number; i?: number; key?: string; fixed: boolean; green: boolean; mine: boolean }
type Sel = { i: number } | { key: string }
const selId = (s?: Sel) => (!s ? '' : 'i' in s ? `a${s.i}` : `m${s.key}`)

/** Épingle pointue vers le bas : pleine (calée), pointillée (estimée), verte (repère de période). */
function Pin({ mk, big }: { mk: Mk; big?: boolean }) {
  const color = mk.green ? GREEN : YELLOW
  const w = big ? 16 : 11
  const h = big ? 22 : 15
  return (
    <svg width={w} height={h} viewBox="-1 -1 14 18" aria-hidden className="pointer-events-none drop-shadow">
      <path
        d="M6 16 L0 8 V0 H12 V8 Z"
        fill={mk.fixed ? color : mk.green ? 'rgba(34,197,94,0.25)' : 'rgba(250,204,21,0.28)'}
        stroke={mk.fixed || mk.green ? color : '#eab308'}
        strokeWidth={mk.fixed ? 1 : 1.6}
        strokeDasharray={mk.fixed ? undefined : '2.2 1.6'}
        strokeLinejoin="round"
      />
      {mk.mine && <circle cx="6" cy="5" r="2.2" fill={mk.fixed ? '#111' : color} />}
    </svg>
  )
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
}: {
  eventId: string
  video: Pick<Video, 'id' | 'url'>
  eventVideo: boolean
  api: PlayerTools
  pls?: number[]
  playerId?: string
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
  const [drag, setDrag] = useState<{ id: string; v: number; start: number }>()
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
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
    if (i !== undefined) setSel({ i })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mNote, mAt, hasMs])

  if (!ev || !ms) return null
  const calib = can.calibrateMatch(role, { eventId, playerId })
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
  for (const [key, v] of Object.entries(marks)) if (PERIOD_MARK[key]) mks.push({ id: `m${key}`, v, key, fixed: true, green: true, mine: false })
  ms.actions.forEach((a, i) => {
    const v = tl.at(i)
    if (v !== undefined) mks.push({ id: `a${i}`, v, i, fixed: fix[tl.keys[i]] !== undefined, green: false, mine: a.pl !== undefined && pls.includes(a.pl) })
  })
  mks.sort((a, b) => a.v - b.v)
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

  const seek = (v: number) => api.seek(Math.max(0, v - 3))
  const choose = (m: Mk) => {
    setSel(m.i !== undefined ? { i: m.i } : { key: m.key! })
    setGroup(undefined)
    setMsg('')
    seek(m.v)
  }
  async function write(ch: Parameters<typeof applyCalibration>[1], label: string, v?: number) {
    setBusy(true)
    try {
      const r = await applyCalibration(eventId, ch, label, eventVideo ? video : undefined)
      setMsg(v === undefined ? 'Repère retiré : l’action est de nouveau estimée.' : calibrated(v, r))
    } finally {
      setBusy(false)
    }
  }
  const labelOf = (s: Sel) => {
    if ('key' in s) return PERIOD_MARK[s.key]
    const a = ms.actions[s.i]
    const num = a.pl !== undefined ? ms.players[a.pl]?.num : undefined
    return `${actionLabel(a)}${num ? ` n°${num}` : ''} · ${minuteOf(a.t)}`
  }
  const undoLabel = (s: Sel) => ('key' in s ? PERIOD_MARK[s.key] : `${actionLabel(ms.actions[s.i])} ${ms.actions[s.i].s[0]}-${ms.actions[s.i].s[1]}`)
  /** Pose le repère choisi à v (s), ou le retire (v absent). */
  const place = (s: Sel, v?: number) => {
    const val = v === undefined ? undefined : Math.max(0, Math.round(v * 10) / 10)
    const label = val === undefined ? `retrait ${undoLabel(s)}` : undoLabel(s)
    return 'key' in s ? write({ kind: 'mark', key: s.key, v: val }, label, val) : write({ kind: 'fix', key: tl.keys[s.i], v: val }, label, val)
  }
  const here = (s: Sel) => {
    const t = api.time()
    if (t === undefined) return setMsg('Lance la vidéo d’abord (le lecteur n’est pas encore prêt).')
    void place(s, t)
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
      const s: Sel = m.i !== undefined ? { i: m.i } : { key: m.key! }
      setSel(s)
      if (ev.type === 'pointerup') void place(s, v)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const selMk = mks.find((m) => m.id === selId(sel))
  const selIdx = selMk ? mks.indexOf(selMk) : -1
  const step = (d: number) => {
    const m = mks[selIdx + d]
    if (m) choose(m)
  }
  const fixedSel = sel ? ('key' in sel ? marks[sel.key] !== undefined : fix[tl.keys[sel.i]] !== undefined) : false
  const small = 'flex h-8 min-w-8 items-center justify-center rounded border border-line bg-panel px-2 text-[11px] font-bold hover:border-accent disabled:opacity-40'

  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2 pb-2 text-[11px]">
      {/* En-tête : compte, coup d'envoi, zoom. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-bold text-emerald-300 tabular-nums">
          {plural(tl.fixedCount, 'action calée', 'actions calées')} sur {ms.actions.length}
        </span>
        {marks.s1 === undefined && calib && (
          <button className="btn-primary h-8 px-3 text-xs" disabled={!api.ready || busy} title="Mets la vidéo sur le coup d’envoi, puis touche ce bouton" onClick={() => here({ key: 's1' })}>
            Coup d’envoi ici
          </button>
        )}
        {!anchored && !calib && <span className="text-muted">Pas encore calée sur la vidéo.</span>}
        <span className="ml-auto flex items-center gap-1">
          <button className={small} title="Élargir la fenêtre" aria-label="Élargir la fenêtre" disabled={span >= SPANS.at(-1)!} onClick={() => setSpan(SPANS[SPANS.indexOf(span) + 1] ?? span)}>
            −
          </button>
          <span className="w-12 text-center text-muted tabular-nums">{span >= 60 ? `${Math.round(span / 60 * 10) / 10} min`.replace('.', ',') : `${span} s`}</span>
          <button className={small} title="Rapprocher" aria-label="Rapprocher" disabled={span <= SPANS[0]} onClick={() => setSpan(SPANS[SPANS.indexOf(span) - 1] ?? span)}>
            +
          </button>
        </span>
      </div>
      {marks.s1 === undefined && calib && <p className="text-[10px] text-muted">Mets la vidéo sur le coup d’envoi du match puis touche « Coup d’envoi ici » : toutes les actions seront estimées.</p>}

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
        {groups.map((g) =>
          g.length === 1 ? (
            <button
              key={g[0].id}
              className="absolute top-0 flex h-9 w-8 -translate-x-1/2 items-start justify-center pt-1"
              style={{ left: xOf(g[0].v) }}
              title={`${g[0].i !== undefined ? labelOf({ i: g[0].i }) : PERIOD_MARK[g[0].key!]} — ${g[0].fixed ? 'calé' : 'estimé'} à ${fmtMoment(Math.round(g[0].v))}`}
              aria-label={`${g[0].i !== undefined ? labelOf({ i: g[0].i }) : PERIOD_MARK[g[0].key!]}, ${g[0].fixed ? 'calé' : 'estimé'}`}
              aria-pressed={g[0].id === selId(sel)}
              onPointerDown={onDown(g[0])}
              onClick={() => !drag && choose(g[0])}
            >
              <Pin mk={g[0]} big={g[0].id === selId(sel) || g[0].id === drag?.id} />
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
              <span className={`rounded-full border px-1.5 text-[10px] font-extrabold tabular-nums ${g.some((m) => m.fixed) ? 'border-yellow-400 bg-yellow-400 text-black' : 'border-dashed border-yellow-500 bg-yellow-400/25'}`}>
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
                {m.i !== undefined ? labelOf({ i: m.i }) : PERIOD_MARK[m.key!]} {m.i !== undefined && <span className="text-muted">{who(ms.actions[m.i])}</span>}
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
              style={{ left: `${(m.v / total) * 100}%`, background: m.green ? GREEN : YELLOW, opacity: m.fixed ? 1 : 0.45 }}
            />
          ))}
          <span className="absolute -top-0.5 h-3 rounded border border-white/60" style={{ left: `${(start / total) * 100}%`, width: `${Math.max(1, (win / total) * 100)}%` }} />
          <span className="absolute -top-1 h-4 w-0.5 bg-red-500" style={{ left: `${(now / total) * 100}%` }} />
        </div>
      </div>

      {/* Carte de l'action choisie. */}
      {sel && selMk ? (
        <div className="flex flex-col gap-1.5 rounded-md border border-accent/50 bg-panel-2 p-2">
          <div className="flex items-center gap-1.5">
            <button className={small} title="Action précédente" aria-label="Action précédente" disabled={selIdx <= 0} onClick={() => step(-1)}>
              <Icon name="prev" className="h-3.5 w-3.5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold">{labelOf(sel)}</div>
              <div className="flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted">
                {'i' in sel && (
                  <span className="truncate">
                    {ms.actions[sel.i].s[0]}-{ms.actions[sel.i].s[1]} · {who(ms.actions[sel.i])}
                    {tl.late.has(sel.i) ? ' · saisie en retard' : ''}
                  </span>
                )}
                {'key' in sel ? <span className="font-bold text-emerald-300">repère posé</span> : <PlaceMark status={fixedSel ? 'fixed' : 'estimated'} />}
                <span className="tabular-nums">à {fmtMoment(Math.round(selMk.v))}</span>
              </div>
            </div>
            <button className={small} title="Action suivante" aria-label="Action suivante" disabled={selIdx < 0 || selIdx >= mks.length - 1} onClick={() => step(1)}>
              <Icon name="next" className="h-3.5 w-3.5" />
            </button>
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
                onClick={() => here(sel)}
              >
                C’est ici !
              </button>
              {fixedSel && (
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
          <UndoButton eventId={eventId} onDone={() => setMsg('Calage annulé.')} />
        </div>
      )}
    </div>
  )
}
