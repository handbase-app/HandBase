import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Video, VideoMoment } from '../db'
import { embedOf, fmtMoment, momentLabel, momentsOf, openUrl, sourceLabel, type Embed } from '../videos'
import { Icon } from './ui'
import { useMedia } from '../layout'

/*
 * Lecteur vidéo intégré (chargé à la demande par VideoDock.tsx, posé à la racine de l'appli : rien n'est téléchargé avant le
 * clic, et le lecteur survit aux changements de mise en page quand le téléphone tourne).
 * Un adaptateur par source pilote le lecteur (aller à un moment, lire, pause, temps courant) :
 *   - YouTube : lecteur officiel (IFrame Player API) sur youtube-nocookie.com ;
 *   - Vimeo : player.vimeo.com piloté par messages (postMessage), sans bibliothèque ;
 *   - fichier vidéo direct : balise <video>.
 * Les autres sources (embedOf → undefined) ne sont pas lues ici : « Ouvrir sur … ».
 * Cadres : domaines de la liste blanche seulement, sandbox et permissions minimales, référent limité à l'origine.
 */

/** Commandes communes aux lecteurs. */
interface Ctl {
  seek(t: number): void
  play(): void
  pause(): void
  /** Temps courant (secondes), undefined si inconnu. */
  time(): number | undefined
  /** En lecture (ou en chargement après un « lire »). */
  playing(): boolean
  ended(): boolean
  /** Durée de la vidéo (s), undefined tant qu'elle n'est pas connue. */
  duration(): number | undefined
  /** Vitesse de lecture (0,25 à 2). */
  setRate(r: number): void
  /** Couper ou remettre le son. */
  setMuted(m: boolean): void
}

type AdapterProps = { embed: Embed; start: number; onCtl: (c: Ctl) => void; onFail: () => void }

/** Durée lue pour un moment sans durée : 15 s, ou moins si le moment suivant commence avant. */
const DEFAULT_DUR = 15

function passage(ms: VideoMoment[], i: number) {
  const m = ms[i]
  if (m.dur) return { at: m.at, end: m.at + m.dur }
  const next = ms[i + 1]
  return { at: m.at, end: next && next.at > m.at ? Math.min(next.at, m.at + DEFAULT_DUR) : m.at + DEFAULT_DUR }
}

const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox'
const ALLOW = 'autoplay; encrypted-media; fullscreen; picture-in-picture'

/* ---------- YouTube : IFrame Player API ---------- */

interface YTPlayer {
  seekTo(t: number, allowSeekAhead: boolean): void
  playVideo(): void
  pauseVideo(): void
  getCurrentTime(): number
  getPlayerState(): number
  getDuration(): number
  setPlaybackRate(r: number): void
  mute(): void
  unMute(): void
}
interface YTNamespace {
  Player: new (el: HTMLIFrameElement, opts: { events: { onReady?: () => void; onError?: (e: { data: number }) => void } }) => YTPlayer
}
declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

let ytApi: Promise<YTNamespace> | undefined
/** Script de l'API YouTube, chargé une seule fois et seulement à la première lecture. */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  ytApi ??= new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      if (window.YT) resolve(window.YT)
    }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.referrerPolicy = 'strict-origin-when-cross-origin'
    s.onerror = () => {
      ytApi = undefined
      s.remove()
      reject(new Error('API YouTube indisponible'))
    }
    document.head.appendChild(s)
  })
  return ytApi
}

function YouTubeAdapter({ embed, start, onCtl, onFail }: AdapterProps) {
  const ref = useRef<HTMLIFrameElement>(null)
  const id = embed.kind === 'youtube' ? embed.id : ''
  // Adresse figée au premier rendu (le cadre ne doit pas se recharger).
  const [src] = useState(() => {
    // controls=0 : les commandes sont les nôtres, sous la vidéo (rien n'est posé sur le cadre YouTube : son logo et ses
    // écrans restent visibles, comme le demandent ses conditions). Seule exception : plein écran au doigt, où elles
    // apparaissent par-dessus le temps d'un toucher, comme dans l'appli YouTube.
    const q = new URLSearchParams({ enablejsapi: '1', origin: location.origin, playsinline: '1', rel: '0', controls: '0' })
    if (start) q.set('start', String(Math.floor(start)))
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${q}`
  })
  useEffect(() => {
    let alive = true
    loadYouTubeApi()
      .then((YT) => {
        if (!alive || !ref.current) return
        const p: YTPlayer = new YT.Player(ref.current, {
          events: {
            onReady: () =>
              alive &&
              onCtl({
                seek: (t) => p.seekTo(t, true),
                play: () => p.playVideo(),
                pause: () => p.pauseVideo(),
                time: () => p.getCurrentTime(),
                playing: () => [1, 3].includes(p.getPlayerState()),
                ended: () => p.getPlayerState() === 0,
                duration: () => p.getDuration() || undefined,
                setRate: (r) => p.setPlaybackRate(r),
                setMuted: (m) => (m ? p.mute() : p.unMute()),
              }),
            // 100/101/150/153 : vidéo introuvable, privée ou intégration interdite par son auteur.
            onError: () => alive && onFail(),
          },
        })
      })
      .catch(() => alive && onFail())
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <iframe
      ref={ref}
      src={src}
      title="Lecteur YouTube"
      className="h-full w-full"
      sandbox={SANDBOX}
      allow={ALLOW}
      referrerPolicy="strict-origin-when-cross-origin"
    />
  )
}

/* ---------- Vimeo : messages postMessage (sans bibliothèque) ---------- */

const VIMEO = 'https://player.vimeo.com'

function VimeoAdapter({ embed, start, onCtl, onFail }: AdapterProps) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [src] = useState(() => {
    if (embed.kind !== 'vimeo') return ''
    const q = new URLSearchParams({ dnt: '1', playsinline: '1' })
    if (embed.hash) q.set('h', embed.hash)
    return `${VIMEO}/video/${encodeURIComponent(embed.id)}?${q}${start ? `#t=${Math.floor(start)}s` : ''}`
  })
  useEffect(() => {
    const st = { t: undefined as number | undefined, d: undefined as number | undefined, playing: false, ended: false }
    const send = (method: string, value?: unknown) => ref.current?.contentWindow?.postMessage(value === undefined ? { method } : { method, value }, VIMEO)
    let ready = false
    const failTimer = window.setTimeout(() => !ready && onFail(), 20000)
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== VIMEO || e.source !== ref.current?.contentWindow) return
      let d: { event?: string; data?: { seconds?: number; duration?: number } } | undefined
      try {
        d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
      } catch {
        return
      }
      if (!d || typeof d !== 'object') return
      if (d.event === 'ready' && !ready) {
        ready = true
        window.clearTimeout(failTimer)
        for (const ev of ['timeupdate', 'play', 'pause', 'ended', 'error']) send('addEventListener', ev)
        onCtl({
          seek: (t) => {
            st.t = undefined
            st.ended = false
            send('setCurrentTime', t)
          },
          play: () => {
            st.ended = false
            send('play')
          },
          pause: () => send('pause'),
          time: () => st.t,
          playing: () => st.playing,
          ended: () => st.ended,
          duration: () => st.d,
          setRate: (r) => send('setPlaybackRate', r),
          setMuted: (m) => send('setVolume', m ? 0 : 1),
        })
      } else if (d.event === 'timeupdate' && typeof d.data?.seconds === 'number') {
        st.t = d.data.seconds
        if (typeof d.data.duration === 'number') st.d = d.data.duration
      }
      else if (d.event === 'play') st.playing = true
      else if (d.event === 'pause') st.playing = false
      else if (d.event === 'ended') {
        st.playing = false
        st.ended = true
      } else if (d.event === 'error') onFail() // vidéo privée, lecture refusée ou impossible dans ce navigateur
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.clearTimeout(failTimer)
      window.removeEventListener('message', onMessage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <iframe
      ref={ref}
      src={src}
      title="Lecteur Vimeo"
      className="h-full w-full"
      sandbox={SANDBOX}
      allow={ALLOW}
      referrerPolicy="strict-origin-when-cross-origin"
    />
  )
}

/* ---------- Fichier vidéo direct : <video> ---------- */

function FileAdapter({ embed, start, onCtl, onFail }: AdapterProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const src = embed.kind === 'file' ? embed.src : ''
  // Pilotable tout de suite (sur mobile, le navigateur peut ne rien précharger avant « lire »).
  useEffect(() => {
    const v = ref.current
    if (!v) return
    onCtl({
      seek: (t) => (v.currentTime = t),
      play: () => void v.play().catch(() => {}),
      pause: () => v.pause(),
      time: () => v.currentTime,
      playing: () => !v.paused,
      ended: () => v.ended,
      duration: () => (Number.isFinite(v.duration) ? v.duration : undefined),
      setRate: (r) => (v.playbackRate = r),
      setMuted: (m) => (v.muted = m),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <video
      ref={ref}
      // #t= : position de départ sans lecture automatique ; preload metadata : seul l'en-tête est chargé avant « lire ».
      src={start ? `${src}#t=${Math.floor(start)}` : src}
      className="h-full w-full bg-black"
      playsInline
      onClick={(e) => (e.currentTarget.paused ? void e.currentTarget.play().catch(() => {}) : e.currentTarget.pause())}
      preload="metadata"
      onError={onFail}
    />
  )
}

const ADAPTERS = { youtube: YouTubeAdapter, vimeo: VimeoAdapter, file: FileAdapter }

/* ---------- Lecteur ---------- */

function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOn(true)
    const down = () => setOn(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return on
}

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
const SKIP = 2

/**
 * Avancer ou reculer de d secondes. Juste après un saut, le lecteur (YouTube) rend encore l'ancien temps : des appuis
 * rapprochés partent donc du dernier temps demandé (gardé 1,5 s), pour que trois appuis fassent bien trois sauts.
 */
const lastSeek = new WeakMap<Ctl, { t: number; at: number }>()
function nudge(c: Ctl, d: number) {
  const prev = lastSeek.get(c)
  const base = prev && Date.now() - prev.at < 1500 ? prev.t : (c.time() ?? 0)
  const t = Math.max(0, base + d)
  lastSeek.set(c, { t, at: Date.now() })
  c.seek(t)
}

/** Pointeur au doigt (téléphone, tablette). */
const COARSE = '(pointer: coarse)'
/** Téléphone couché (même hauteur que MQ.rail), au doigt. */
const PHONE_LANDSCAPE = '(orientation: landscape) and (max-height: 520px) and (pointer: coarse)'
/** Commandes masquées après ce délai sans geste, en lecture, en plein écran au doigt. */
const HIDE_AFTER = 3000

type Orientation = ScreenOrientation & { lock?: (o: string) => Promise<void> }

/** Orientation bloquée en paysage (Android, plein écran) ; refusée sans bruit ailleurs. */
function lockLandscape(locked: { current: boolean }) {
  try {
    const o = screen.orientation as Orientation | undefined
    o?.lock?.('landscape')
      .then(() => (locked.current = true))
      .catch(() => {})
  } catch {
    /* non pris en charge */
  }
}

function unlockOrientation(locked: { current: boolean }) {
  if (!locked.current) return
  locked.current = false
  try {
    screen.orientation?.unlock()
  } catch {
    /* non pris en charge */
  }
}

/** « 12:05 » / « 1:02:05 ». */
const MUTE_KEY = 'handbase.video.muet'
const clock = (t?: number) => (t === undefined || !Number.isFinite(t) ? '--:--' : fmtMoment(Math.floor(t)))

/**
 * Nos commandes sous la vidéo (YouTube est intégré sans les siennes, controls=0 ; fichier vidéo : sans celles du
 * navigateur) : lire / pause, −2 s / +2 s, vitesse, temps / durée, plein écran de notre bloc (vidéo, commandes, frise).
 */
function Controls({ ctl, fs, onFs, big }: { ctl: Ctl; fs: boolean; onFs: () => void; big?: boolean }) {
  const [, tick] = useState(0)
  const [rate, setRate] = useState(1)
  // Son coupé : retenu sur l'appareil et appliqué à chaque vidéo ouverte.
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    ctl.setMuted(muted)
  }, [ctl, muted])
  const toggleMute = () => {
    const m = !muted
    setMuted(m)
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0')
    } catch {
      /* stockage indisponible : réglage pour cette vidéo seulement */
    }
  }
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 250)
    return () => window.clearInterval(timer)
  }, [])
  const t = ctl.time()
  const playing = ctl.playing()
  // Plein écran au doigt : boutons de 44 px.
  const btn = `flex items-center justify-center rounded px-1.5 text-white/90 hover:bg-white/10 ${big ? 'h-11 min-w-11 text-xs' : 'h-8 min-w-8'}`
  const ico = big ? 'h-5 w-5' : 'h-4 w-4'
  return (
    <div className="flex shrink-0 items-center gap-1 bg-black px-2 py-1 text-[11px] text-white/90" role="toolbar" aria-label="Commandes de la vidéo">
      <button className={btn} title={playing ? 'Pause (espace)' : 'Lire (espace)'} aria-label={playing ? 'Pause' : 'Lire'} onClick={() => (playing ? ctl.pause() : ctl.play())}>
        <Icon name={playing ? 'pause' : 'play'} className={ico} filled />
      </button>
      <button className={btn} title={`Reculer de ${SKIP} s (←)`} aria-label={`Reculer de ${SKIP} s`} onClick={() => nudge(ctl, -SKIP)}>
        −{SKIP} s
      </button>
      <button className={btn} title={`Avancer de ${SKIP} s (→)`} aria-label={`Avancer de ${SKIP} s`} onClick={() => nudge(ctl, SKIP)}>
        +{SKIP} s
      </button>
      <span className="ml-1 min-w-0 truncate tabular-nums">
        {clock(t)} <span className="text-white/50">/ {clock(ctl.duration())}</span>
      </span>
      <button className={`${btn} ml-auto`} title={muted ? 'Remettre le son' : 'Couper le son'} aria-label={muted ? 'Remettre le son' : 'Couper le son'} aria-pressed={muted} onClick={toggleMute}>
        <Icon name={muted ? 'mute' : 'volume'} className={ico} />
      </button>
      <select
        className={`rounded bg-white/10 px-1 text-white ${big ? 'h-11 text-xs' : 'h-8 text-[11px]'}`}
        title="Vitesse de lecture"
        aria-label="Vitesse de lecture"
        value={rate}
        onChange={(e) => {
          const r = Number(e.target.value)
          setRate(r)
          ctl.setRate(r)
        }}
      >
        {RATES.map((r) => (
          <option key={r} value={r} className="text-black">
            {String(r).replace('.', ',')}×
          </option>
        ))}
      </select>
      <button className={btn} title={fs ? 'Quitter le plein écran' : 'Plein écran'} aria-label={fs ? 'Quitter le plein écran' : 'Plein écran'} onClick={onFs}>
        <Icon name={fs ? 'shrink' : 'expand'} className={ico} />
      </button>
    </div>
  )
}

/** Commandes offertes aux outils ajoutés sous les moments (calage d'une feuille de match…). */
export interface PlayerTools {
  /** Le lecteur est prêt (sinon time() rend undefined et seek ne fait rien). */
  ready: boolean
  /** Temps courant de la vidéo (s). */
  time(): number | undefined
  /** Aller à ce temps et lire (play false : sans changer lecture / pause). */
  seek(t: number, play?: boolean): void
  /** En lecture. */
  playing(): boolean
  /** Moment en cours, ou le dernier lancé (gardé quand son passage est fini) ; undefined si aucun. */
  moment?: VideoMoment
  /** Durée de la vidéo (s), undefined tant qu'elle n'est pas connue. */
  duration(): number | undefined
}

/** Passage en cours : moment i, seul ou dans l'enchaînement de tous les moments. */
type Run = { i: number; seq: boolean }

/**
 * Panneau (plein écran sur mobile) : lecteur, moments à jouer, enchaînement « Voir les actions ».
 * `moment` : indice du moment à jouer dès que le lecteur est prêt (clic sur une pastille).
 */
export default function VideoPlayer({
  video,
  moment,
  onClose,
  tools,
  bar,
  badge,
}: {
  video: Video
  moment?: number
  onClose: () => void
  /** Outils affichés sous les moments (ex. calage d'une feuille de match sur la vidéo de l'événement). */
  tools?: (api: PlayerTools) => ReactNode
  /** Bloc affiché sous les commandes de la vidéo, gardé en plein écran (frise du match et calage). */
  bar?: (api: PlayerTools) => ReactNode
  /** Marque ajoutée à la pastille d'un moment (ex. « ✓ calé » / « ~ estimé »). */
  badge?: (m: VideoMoment) => ReactNode
}) {
  const embed = embedOf(video.url)
  const online = useOnline()
  const moments = momentsOf(video)
  const source = sourceLabel(video.url)
  const href = openUrl(video)
  const [ctl, setCtl] = useState<Ctl>()
  const [failed, setFailed] = useState(false)
  const [run, setRun] = useState<Run | null>(null)
  const [blocked, setBlocked] = useState(false)
  // Dernier moment lancé (pour les outils : il reste choisi quand son passage est fini).
  const [last, setLast] = useState<number | undefined>(moment !== undefined && moments[moment] ? moment : undefined)
  // Note du moment en cours : les moments peuvent être recalculés pendant la lecture (calage), et donc changer de place.
  const runNote = useRef<string | undefined>(moment !== undefined ? moments[moment]?.note : undefined)
  // Moment demandé avant que le lecteur soit prêt.
  const pending = useRef<Run | null>(moment !== undefined && moments[moment] ? { i: moment, seq: false } : null)
  // Lecture du passage : « armé » une fois arrivé au début du passage (le saut prend un instant).
  const armed = useRef(false)
  const startedAt = useRef(0)
  const closeBtn = useRef<HTMLButtonElement>(null)
  // Plein écran de notre bloc (vidéo, commandes, frise) : celui du navigateur (apiFs) ou, sans l'API (iPhone) ou refusé,
  // bloc posé sur tout l'écran (cssFs).
  const stage = useRef<HTMLDivElement>(null)
  const [apiFs, setApiFs] = useState(false)
  const [cssFs, setCssFs] = useState(false)
  const fs = apiFs || cssFs
  // Téléphone (au doigt) : plein écran « immersif » à la YouTube, commandes posées sur la vidéo et masquées en lecture.
  const coarse = useMedia(COARSE)
  const phoneLandscape = useMedia(PHONE_LANDSCAPE)
  const immersive = fs && coarse
  // Plein écran entré tout seul (téléphone couché) : quitté tout seul en le redressant ; un choix fait au bouton est gardé.
  const auto = useRef(false)
  // Orientation bloquée en paysage par le bouton plein écran (Android) : libérée en sortant du plein écran.
  const locked = useRef(false)
  const ctlRef = useRef<Ctl | undefined>(undefined)
  ctlRef.current = ctl
  useEffect(() => {
    const el = stage.current
    const on = () => {
      const mine = !!el && document.fullscreenElement === el
      setApiFs(mine)
      if (mine) return
      unlockOrientation(locked)
      // Plein écran quitté par le téléphone (retour, geste) : on sort aussi du bloc posé sur l'écran.
      auto.current = false
      setCssFs(false)
    }
    document.addEventListener('fullscreenchange', on)
    return () => {
      document.removeEventListener('fullscreenchange', on)
      // Lecteur fermé en plein écran : on rend l'écran et l'orientation.
      if (el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
      unlockOrientation(locked)
    }
  }, [])
  function toggleFs() {
    const el = stage.current
    if (!el) return
    auto.current = false
    if (document.fullscreenElement) {
      setCssFs(false)
      return void document.exitFullscreen().catch(() => {})
    }
    if (cssFs) return setCssFs(false)
    if (!el.requestFullscreen) return setCssFs(true)
    // Demande restée sans réponse (navigateur intégré, webview…) : bloc posé sur l'écran en attendant.
    const slow = window.setTimeout(() => setCssFs(true), 1000)
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(() => {
        window.clearTimeout(slow)
        // Téléphone tenu droit : la vidéo passe en paysage (Android ; refusé sans bruit ailleurs, iPhone compris).
        if (coarse && matchMedia('(orientation: portrait)').matches) lockLandscape(locked)
      })
      .catch(() => {
        window.clearTimeout(slow)
        setCssFs(true)
      })
  }

  // Téléphone tourné en paysage, lecteur ouvert : plein écran tout de suite (le navigateur peut le refuser sans geste de
  // la personne : le bloc est alors posé sur tout l'écran). Redressé : on en sort, s'il était entré tout seul.
  const canPlayRef = useRef(false)
  const fsRef = useRef(fs)
  fsRef.current = fs
  const wasLandscape = useRef(phoneLandscape)
  useEffect(() => {
    if (wasLandscape.current === phoneLandscape) return
    wasLandscape.current = phoneLandscape
    if (phoneLandscape) {
      if (fsRef.current || !canPlayRef.current) return
      auto.current = true
      setCssFs(true)
      stage.current?.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {})
    } else if (auto.current) {
      auto.current = false
      setCssFs(false)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [phoneLandscape])

  // Commandes en plein écran au doigt : un toucher sur la vidéo les montre ou les cache (en pause aussi, pour voir toute
  // l'image) ; masquées seules 3 s après le dernier geste pendant la lecture (gardées en pause et avec la frise du match).
  const [chrome, setChrome] = useState(true)
  const hideTimer = useRef(0)
  const poke = () => {
    setChrome(true)
    window.clearTimeout(hideTimer.current)
    // Frise du match (calage) : pas de masquage tout seul, « C'est ici ! » doit rester à portée du doigt.
    if (bar) return
    const later = () => {
      hideTimer.current = window.setTimeout(() => (ctlRef.current?.playing() ? setChrome(false) : later()), HIDE_AFTER)
    }
    later()
  }
  const pokeRef = useRef(poke)
  pokeRef.current = poke
  useEffect(() => {
    if (immersive) pokeRef.current()
    else setChrome(true)
    return () => window.clearTimeout(hideTimer.current)
  }, [immersive])

  // Clavier, quel que soit l'élément qui a le focus (frise, repère, bouton…), sauf dans un champ de saisie : Échap ferme (ou
  // quitte le plein écran) ; espace lit / met en pause ; flèches : ±2 s, avec Maj ±0,5 s. Écouté en phase de capture et
  // sans action par défaut : un bouton qui a le focus ne se déclenche pas, la page ne défile pas. La page derrière ne
  // défile plus. (Entrée et N, propres au calage, sont écoutés par la frise : MatchTimeline.)
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.fullscreenElement) return
        if (cssFs) {
          auto.current = false
          return setCssFs(false)
        }
        return onClose()
      }
      const c = ctlRef.current
      if (!c || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return
      if (e.key === ' ') {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) {
          if (c.playing()) c.pause()
          else c.play()
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        const d = e.shiftKey ? 0.5 : SKIP
        nudge(c, e.key === 'ArrowLeft' ? -d : d)
      }
    }
    // Espace relâché sur un bouton : pas de clic (le bouton aurait été déclenché en plus de lecture / pause).
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && !typing(e.target)) e.preventDefault()
    }
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('keydown', onKey, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeBtn.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKeyUp, true)
      document.body.style.overflow = overflow
    }
  }, [onClose, cssFs])

  function start(r: Run, c = ctl) {
    if (!c) {
      pending.current = r
      return
    }
    armed.current = false
    startedAt.current = Date.now()
    setBlocked(false)
    c.seek(moments[r.i].at)
    c.play()
    setRun(r)
    setLast(r.i)
    runNote.current = moments[r.i].note
  }

  function stop(pause = true) {
    if (pause) ctl?.pause()
    setRun(null)
    setBlocked(false)
  }

  function onCtl(c: Ctl) {
    setCtl(c)
    if (pending.current) start(pending.current, c)
    pending.current = null
  }

  // Moments recalculés (nouveau début, nouvel ordre) : le moment en cours est retrouvé par sa note ; le suivi repart sur
  // son nouveau passage, sans relancer la vidéo.
  const sig = moments.map((m) => `${m.at}|${m.dur ?? ''}|${m.note ?? ''}`).join(';')
  const firstSig = useRef(sig)
  useEffect(() => {
    if (sig === firstSig.current) return
    firstSig.current = sig
    const note = runNote.current
    const j = note ? moments.findIndex((m) => m.note === note) : -1
    if (j < 0) return
    setLast(j)
    setRun((r) => (r ? { ...r, i: j } : r))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  // Suivi du passage : à la fin, moment suivant (enchaînement) ou pause.
  useEffect(() => {
    if (!run || !ctl) return
    const timer = window.setInterval(() => {
      const t = ctl.time()
      const { at, end } = passage(moments, run.i)
      if (!armed.current) {
        if (t !== undefined && ctl.playing() && t >= at - 1.5 && t < end) {
          armed.current = true
          setBlocked(false)
        } else if (Date.now() - startedAt.current > 2500 && !ctl.playing()) setBlocked(true) // lecture automatique refusée
        return
      }
      if (t === undefined) return
      // La personne a avancé ou reculé elle-même : on la laisse regarder.
      if (t < at - 2 || t > end + 3) return setRun(null)
      if (t >= end || ctl.ended()) {
        if (run.seq && run.i < moments.length - 1) start({ i: run.i + 1, seq: true })
        else stop()
      }
    }, 250)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, ctl])

  const Adapter = embed ? ADAPTERS[embed.kind] : undefined
  const canPlay = !!Adapter && !failed && online
  canPlayRef.current = canPlay
  const openLink = href && (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className="inline-flex min-w-0 max-w-[55%] items-center gap-1 text-[11px] font-bold text-accent hover:underline"
      title={`Ouvrir sur ${source} (nouvel onglet)`}
    >
      <Icon name="external" className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">Ouvrir sur {source}</span>
    </a>
  )
  const cur = run ? moments[run.i] : undefined
  const api: PlayerTools = {
    ready: !!ctl && canPlay,
    time: () => ctl?.time(),
    seek: (t, play = true) => {
      if (!ctl) return
      setRun(null)
      ctl.seek(Math.max(0, t))
      if (play) ctl.play()
    },
    playing: () => !!ctl?.playing(),
    moment: last !== undefined ? moments[last] : undefined,
    duration: () => ctl?.duration(),
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/80 sm:items-center sm:p-4 [@media(max-height:520px)]:p-0" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={video.title || `Vidéo ${source}`}
        className="flex h-full w-full flex-col overflow-y-auto bg-panel pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:h-auto sm:max-h-full sm:max-w-3xl sm:rounded-lg sm:border sm:border-line sm:shadow-2xl landscape:overflow-hidden sm:landscape:h-[88vh] sm:landscape:max-w-6xl lg:landscape:max-w-7xl [@media(max-height:520px)]:h-full [@media(max-height:520px)]:max-w-none [@media(max-height:520px)]:rounded-none [@media(max-height:520px)]:border-0 [@media(max-height:520px)]:px-[env(safe-area-inset-left)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 px-3 py-2 [@media(max-height:520px)]:py-1">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{video.title || `Vidéo ${source}`}</div>
            <span className="inline-block max-w-full truncate align-top rounded bg-panel-2 px-1 py-px text-[10px] font-bold text-muted">{source}</span>
          </div>
          {canPlay && openLink}
          <button ref={closeBtn} className="shrink-0 rounded p-1.5 text-muted hover:bg-panel-2 hover:text-fg" title="Fermer (Échap)" aria-label="Fermer le lecteur" onClick={onClose}>
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>

        {/* Portrait : vidéo puis moments. Paysage (téléphone couché, ordinateur) : vidéo à gauche, moments à droite. */}
        <div className="flex min-h-0 flex-1 flex-col landscape:flex-row">
        <div
          ref={stage}
          className={`flex shrink-0 flex-col bg-black landscape:min-w-0 landscape:flex-1 ${fs ? 'fixed inset-0 z-[60] h-full w-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]' : ''} ${immersive ? 'pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]' : ''}`}
        >
        {canPlay && embed ? (
          <>
            <div className={`relative flex min-h-0 items-center justify-center bg-black ${fs ? 'flex-1' : 'landscape:flex-1'}`}>
              <div className={`aspect-video max-h-full w-full bg-black ${fs ? 'h-full w-auto max-w-full' : 'landscape:h-full landscape:w-auto landscape:max-w-full'}`}>
                <Adapter embed={embed} start={moments[moment ?? 0]?.at ?? 0} onCtl={onCtl} onFail={() => (setFailed(true), setRun(null))} />
              </div>
              {/* Plein écran au doigt : toucher la vidéo montre ou cache les commandes (calque transparent, rien n'est caché). */}
              {immersive && (
                <button
                  type="button"
                  className="absolute inset-0 z-10 cursor-default"
                  aria-label={chrome ? 'Cacher les commandes' : 'Afficher les commandes'}
                  onClick={() => (chrome ? (window.clearTimeout(hideTimer.current), setChrome(false)) : poke())}
                />
              )}
            </div>
            {/* Commandes et frise : sous la vidéo ; plein écran au doigt : posées en bas de la vidéo, masquées en lecture. */}
            <div
              className={
                immersive
                  ? `absolute inset-x-0 bottom-0 z-20 bg-black/70 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] transition-opacity duration-200 ${chrome ? '' : 'pointer-events-none opacity-0'}`
                  : 'shrink-0'
              }
              aria-hidden={immersive && !chrome ? true : undefined}
              onPointerDownCapture={immersive ? poke : undefined}
              onKeyDownCapture={immersive ? poke : undefined}
            >
              {ctl && <Controls ctl={ctl} fs={fs} onFs={toggleFs} big={immersive} />}
              {/* Plein écran au doigt : frise limitée (le haut de la vidéo reste visible pendant le calage), défilante. */}
              {bar && <div className={`shrink-0 bg-panel ${immersive ? 'max-h-[40dvh] overflow-y-auto overscroll-contain' : ''}`}>{bar(api)}</div>}
            </div>
            {immersive && (
              <div
                className={`absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent pt-[env(safe-area-inset-top)] pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] transition-opacity duration-200 ${chrome ? '' : 'pointer-events-none opacity-0'}`}
                aria-hidden={!chrome ? true : undefined}
                onPointerDownCapture={poke}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-white">{video.title || `Vidéo ${source}`}</span>
                <button
                  className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs font-bold text-white hover:bg-black/80"
                  aria-label="Quitter le plein écran"
                  onClick={toggleFs}
                >
                  <Icon name="shrink" className="h-5 w-5" />
                  Quitter le plein écran
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-black px-6 text-center text-sm text-white/80 landscape:h-full landscape:w-auto landscape:max-w-full">
            <Icon name={online ? 'video' : 'alert'} className="h-8 w-8 text-white/50" />
            <p>
              {!online
                ? 'Hors ligne : la vidéo pourra être lue une fois la connexion revenue.'
                : failed
                  ? 'Cette vidéo ne peut pas être lue dans l’appli (vidéo privée, supprimée, ou lecture intégrée refusée).'
                  : `Les vidéos ${source} se regardent sur leur site.`}
            </p>
            {online && openLink}
          </div>
        )}
        </div>

        <div className="flex flex-col gap-2 p-3 landscape:w-72 landscape:shrink-0 landscape:overflow-y-auto landscape:border-l landscape:border-line lg:landscape:w-80">
          {blocked && run && (
            <p className="text-[11px] text-amber-200" role="status">
              Le navigateur a bloqué la lecture automatique : touche la vidéo pour lancer le passage.
            </p>
          )}
          {run?.seq && cur && (
            <div className="flex items-center gap-2 rounded-md border border-accent/50 bg-panel-2 px-2 py-1.5" role="status">
              <span className="min-w-0 flex-1 truncate text-xs">
                <span className="font-bold">
                  Action {run.i + 1}/{moments.length}
                </span>
                {cur.note ? ` — ${cur.note}` : ` — ${fmtMoment(cur.at)}`}
              </span>
              <button
                className="rounded p-1 text-muted hover:text-fg disabled:opacity-30"
                title="Action précédente"
                aria-label="Action précédente"
                disabled={run.i === 0}
                onClick={() => start({ i: run.i - 1, seq: true })}
              >
                <Icon name="prev" className="h-4 w-4" />
              </button>
              <button
                className="rounded p-1 text-muted hover:text-fg disabled:opacity-30"
                title="Action suivante"
                aria-label="Action suivante"
                disabled={run.i >= moments.length - 1}
                onClick={() => start({ i: run.i + 1, seq: true })}
              >
                <Icon name="next" className="h-4 w-4" />
              </button>
              <button className="rounded p-1 text-muted hover:text-red-400" title="Arrêter" aria-label="Arrêter l’enchaînement" onClick={() => stop()}>
                <Icon name="stop" className="h-4 w-4" />
              </button>
            </div>
          )}

          {moments.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[11px] font-bold text-muted">Moments à regarder</span>
                {canPlay && moments.length > 1 && (
                  <button className="btn-primary inline-flex items-center gap-1 px-3 py-1 text-xs" onClick={() => start({ i: 0, seq: true })}>
                    <Icon name="play" className="h-3 w-3" filled />
                    Voir les actions
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 landscape:flex-col landscape:flex-nowrap" aria-label="Moments à regarder">
                {moments.map((m, i) => {
                  const active = run?.i === i
                  const cls = `inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] landscape:rounded-md landscape:py-1.5 ${
                    active ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2'
                  }`
                  const body = (
                    <>
                      <Icon name="play" className="h-2.5 w-2.5 shrink-0 text-accent" filled />
                      <span className="truncate">
                        <span className="font-bold">{fmtMoment(m.at)}</span>
                        {m.dur ? ` · ${m.dur} s` : ''}
                        {m.note ? ` · ${m.note}` : ''}
                      </span>
                      {badge?.(m)}
                    </>
                  )
                  if (canPlay)
                    return (
                      <button key={i} className={`${cls} hover:border-accent hover:text-accent`} title={`${momentLabel(m)} — jouer ce passage`} aria-pressed={active} onClick={() => start({ i, seq: false })}>
                        {body}
                      </button>
                    )
                  const to = online ? openUrl(video, m.at) : undefined // YouTube s'ouvre à ce moment, les autres au début
                  return to ? (
                    <a key={i} href={to} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={`${cls} hover:border-accent hover:text-accent`} title={momentLabel(m)}>
                      {body}
                    </a>
                  ) : (
                    <span key={i} className={cls}>
                      {body}
                    </span>
                  )
                })}
              </div>
              {canPlay && <p className="text-[10px] text-muted">Un moment sans durée est lu {DEFAULT_DUR} s (ou jusqu’au moment suivant).</p>}
            </>
          )}
          {tools?.(api)}
        </div>
        </div>
      </div>
    </div>
  )
}
