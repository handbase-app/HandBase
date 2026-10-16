import { useEffect, useRef, useState } from 'react'
import type { ActionKind, MatchSheet, Side, StoredAction } from '../matchSheet'
import { fmtCountdown, isPing, liveQueue, seqView, countdownOf, type SeqItem } from '../sequencer'
import { fmtMoment } from '../videos'
import { actionLabel, sideName } from './matchLabels'
import { Icon } from './ui'
import type { PlayerTools } from './VideoPlayer'

/*
 * Séquençage en plein écran (mode édition) : on regarde le match en entier, les actions de la feuille défilent de droite à
 * gauche sur une frise transparente posée en bas de la vidéo, vers une ligne de visée au tiers gauche. Quand l'action
 * annoncée y arrive : « ping » (ligne et bouton qui s'illuminent, bip court si le son est mis) ; « C'est ici » (Entrée, clic)
 * la cale au temps courant et la suivante est annoncée. L'action annoncée ne dépasse pas la cible : estimation dépassée,
 * elle y reste et toute la frise attend avec elle (sequencer.ts liveQueue).
 *
 * Écran seulement : le calcul est dans sequencer.ts, les écritures (calage, passer, ignorer, annuler) dans MatchTimeline
 * (mêmes fonctions que la frise du match, actions simultanées calées ensemble). Couleurs fixes (blanc sur voile noir) : la
 * frise est posée sur la vidéo, claire ou sombre, quel que soit le style de l'installation.
 */

/** Icône d'un type d'action (texte : aucun fichier) ; sur la frise, un but sur 7 m s'écrit « 7m ». */
const KIND_ICON: Partial<Record<ActionKind, string>> = { but: '⚽', but7: '⚽', '2mn': '⏱', avert: '🟨', disq: '🟥', bleu: '🟦', tm: 'T' }
const iconOf = (k: ActionKind) => KIND_ICON[k] ?? '•'
const pillOf = (k: ActionKind) => (k === 'but7' ? '7m' : iconOf(k))
/** Libellés du séquençage (plus parlants que ceux de la feuille pour les cartons). */
const SEQ_LABEL: Partial<Record<ActionKind, string>> = { but: 'But', but7: 'But sur 7 m', '2mn': '2 minutes', avert: 'Carton jaune', disq: 'Carton rouge', bleu: 'Carton bleu', tm: 'Temps mort' }
const labelOf = (a: StoredAction) => SEQ_LABEL[a.k] ?? actionLabel(a)
const TEAM: Record<Side, string> = { home: '#3b82f6', away: '#f97316' }

/** Réglages gardés sur l'appareil (lectures et écritures sous try/catch : stockage parfois indisponible). */
const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* stockage indisponible : réglage pour cette fois */
  }
}
const SOUND_KEY = 'handbase.sequenceur.son'
const FOLD_KEY = 'handbase.sequenceur.replie'
const AHEAD_KEY = 'handbase.sequenceur.fenetre'
/** Secondes visibles à droite de la cible. */
const AHEADS = [30, 60, 120]
const AIM = 1 / 3

/** Bip court et discret (Web Audio, généré : pas de fichier). Le contexte est ouvert au premier geste. */
let ac: AudioContext | undefined
function audio() {
  try {
    ac ??= new AudioContext()
    if (ac.state === 'suspended') void ac.resume().catch(() => {})
    return ac
  } catch {
    return undefined
  }
}
function beep() {
  const c = audio()
  if (!c) return
  try {
    const o = c.createOscillator()
    const g = c.createGain()
    const t = c.currentTime
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
    o.connect(g).connect(c.destination)
    o.start(t)
    o.stop(t + 0.17)
  } catch {
    /* audio indisponible */
  }
}

export default function Sequencer({
  ms,
  base,
  pending,
  now,
  api,
  who,
  busy,
  msg,
  undo,
  onHere,
  onPass,
  onIgnore,
  onPick,
}: {
  ms: MatchSheet
  /** File de séquençage (sequencer.ts seqQueue). */
  base: SeqItem[]
  /** Action annoncée ; undefined : tout est calé ou ignoré. */
  pending?: SeqItem
  now: number
  api: PlayerTools
  /** Nom affiché du joueur d'une action (fiche reliée, sinon « n° 7 (Équipe) »). */
  who: (a: StoredAction) => string
  busy: boolean
  msg: string
  /** Dernier calage annulable (Z / Retour arrière). */
  undo?: { label: string; run: () => void }
  onHere: () => void
  onPass: () => void
  onIgnore: () => void
  /** Toucher une action de la frise : elle devient l'annoncée, la vidéo y va. */
  onPick: (it: SeqItem) => void
}) {
  const [sound, setSound] = useState(() => read(SOUND_KEY) !== '0')
  const [folded, setFolded] = useState(() => read(FOLD_KEY) === '1')
  const [ahead, setAhead] = useState(() => {
    const v = Number(read(AHEAD_KEY))
    return AHEADS.includes(v) ? v : 60
  })
  const compact = api.compact
  const touch = api.touch

  const { queue } = liveQueue(base, pending?.id, now)
  const marks = seqView(queue, pending?.id, now, ahead, AIM)
  const countdown = countdownOf(base, pending?.id, now)
  const ping = isPing(countdown)
  const pos = pending ? base.findIndex((x) => x.id === pending.id) + 1 : 0

  // Ping : bip une fois par action arrivée sur la cible (réarmé si l'on recule avant elle).
  const pinged = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!ping) {
      pinged.current = undefined
      return
    }
    if (pending && pinged.current !== pending.id) {
      pinged.current = pending.id
      if (sound) beep()
    }
  }, [ping, pending, sound])

  // Message de la dernière écriture (« Calé à 12:34 »…), montré 4 s.
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!msg) return
    setToast(msg)
    const t = window.setTimeout(() => setToast(''), 4000)
    return () => window.clearTimeout(t)
  }, [msg])

  const name = (a: StoredAction) => {
    const w = who(a)
    if (a.pl === undefined || w.startsWith('n°')) return w
    const sp = ms.players[a.pl]
    return `${w}${sp?.num ? ` n°${sp.num}` : ''} (${sideName(ms, sp?.side)})`
  }
  const num = (a: StoredAction) => (a.pl !== undefined && ms.players[a.pl]?.num ? ` n°${ms.players[a.pl].num}` : '')
  /** Une action du groupe, en entier : « ⚽ But · DUPONT Léo n°7 (Locaux) ». */
  const full = (i: number) => {
    const a = ms.actions[i]
    const w = name(a)
    return `${iconOf(a.k)} ${labelOf(a)}${w ? ` · ${w}` : ''}`
  }
  /** En bref : « 🟨 Carton jaune n°12 ». */
  const short = (i: number) => `${iconOf(ms.actions[i].k)} ${labelOf(ms.actions[i])}${num(ms.actions[i])}`
  const lead = (it: SeqItem) => it.is.find((j) => ms.actions[j].k === it.k) ?? it.i
  const others = (it: SeqItem) => it.is.filter((j) => j !== lead(it))
  const nexts = pending ? base.slice(pos, pos + 2) : []
  const when = countdown !== undefined ? fmtCountdown(countdown) : undefined

  const setSoundOn = (v: boolean) => {
    setSound(v)
    write(SOUND_KEY, v ? '1' : '0')
    if (v) audio()
  }
  const setFold = (v: boolean) => {
    setFolded(v)
    write(FOLD_KEY, v ? '1' : '0')
  }
  const setWin = (v: number) => {
    setAhead(v)
    write(AHEAD_KEY, String(v))
  }
  // Annonce touchée : la vidéo va 5 s avant l'action (estimée), sans changer lecture / pause.
  const goPending = () => pending?.v !== undefined && api.seek(Math.max(0, pending.v - 5), api.playing())

  const tool = `flex shrink-0 items-center justify-center rounded text-white/85 hover:bg-white/15 disabled:opacity-30 ${touch ? 'h-11 min-w-11' : 'h-8 min-w-8'} px-1.5`
  const hereBtn = (
    <button
      type="button"
      className={`relative shrink-0 rounded-xl px-4 font-extrabold text-black shadow-lg transition-colors disabled:opacity-50 ${
        ping ? 'bg-yellow-300 ring-4 ring-yellow-200/80 motion-safe:animate-pulse' : 'bg-yellow-400 hover:bg-yellow-300'
      } ${folded ? 'h-12 text-sm' : compact ? 'h-14 min-w-28 text-base' : 'h-16 min-w-36 text-lg'}`}
      disabled={!pending || busy || !api.ready}
      title="L’action annoncée est à ce moment de la vidéo (Entrée)"
      onClick={onHere}
    >
      C’est ici !
      {!touch && !folded && <span className="block text-[10px] font-bold opacity-60">Entrée</span>}
    </button>
  )
  const nudgeBtns = (
    <div className={`flex shrink-0 gap-1 ${folded ? 'flex-row' : 'flex-col justify-end'}`}>
      <button type="button" className={`${tool} bg-white/10 text-xs font-bold`} title="Avancer de 2 s (→)" onClick={() => api.nudge(2)}>
        +2 s
      </button>
      <button type="button" className={`${tool} bg-white/10 text-xs font-bold`} title="Reculer de 2 s (←)" onClick={() => api.nudge(-2)}>
        −2 s
      </button>
    </div>
  )

  return (
    <div className={`pointer-events-auto w-full text-white ${compact ? 'px-1 pb-1' : 'px-2 pb-2'}`} onPointerDown={() => sound && audio()}>
      <div className={`flex items-stretch gap-2 rounded-lg bg-black/60 ring-1 ring-white/10 backdrop-blur-[2px] ${compact || folded ? 'p-1.5' : 'p-2'}`} role="region" aria-label="Séquençage de la feuille de match">
        {/* Pouce gauche (téléphone couché) : −2 s / +2 s. */}
        {(touch || compact) && nudgeBtns}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* Annonce et réglages. */}
          <div className="flex min-w-0 items-start gap-1.5">
            <button type="button" className="min-w-0 flex-1 text-left" title={pending?.v !== undefined ? 'Aller à cette action (5 s avant)' : undefined} onClick={goPending} disabled={pending?.v === undefined}>
              {pending ? (
                folded ? (
                  <span className="block truncate text-sm font-bold" role="status">
                    {short(lead(pending))} · {pos}/{base.length}
                    {when && ` · ${when}`}
                  </span>
                ) : (
                  <>
                    <span className={`block truncate font-bold ${compact ? 'text-xs' : 'text-sm'}`} role="status">
                      <span className="text-white/60">{countdown === undefined ? 'Première action : ' : 'Prochaine action : '}</span>
                      {full(lead(pending))}
                      {others(pending).map((j) => ` + ${short(j)}`).join('')} · {fmtMoment(ms.actions[pending.i].t)} de jeu
                      {when && <span className={ping ? 'text-yellow-300' : 'text-white/80'}> · {when}</span>}
                    </span>
                    <span className="block truncate text-[11px] text-white/65">
                      {toast ? (
                        <span className="text-emerald-300">{toast}</span>
                      ) : countdown === undefined ? (
                        'Touche « C’est ici » quand elle arrive : les suivantes défileront.'
                      ) : nexts.length ? (
                        `ensuite : ${nexts.map((x) => short(lead(x))).join(' · ')}`
                      ) : (
                        'Dernière action de la feuille.'
                      )}
                    </span>
                  </>
                )
              ) : (
                <span className="block truncate text-sm font-bold text-emerald-300" role="status">
                  Toutes les actions sont calées ou ignorées.
                </span>
              )}
            </button>
            <span className={`shrink-0 self-center rounded bg-white/10 px-1.5 text-[11px] font-bold tabular-nums text-white/80 ${folded ? 'hidden' : ''}`} title="Action annoncée / actions à caler">
              {pos}/{base.length}
            </span>
            {!folded && !compact && (
              <span className="flex shrink-0 items-center">
                <button type="button" className={tool} title="Voir plus loin" aria-label="Voir plus loin" disabled={ahead >= AHEADS.at(-1)!} onClick={() => setWin(AHEADS[AHEADS.indexOf(ahead) + 1])}>
                  −
                </button>
                <span className="w-9 text-center text-[10px] text-white/60 tabular-nums">{ahead} s</span>
                <button type="button" className={tool} title="Voir moins loin" aria-label="Voir moins loin" disabled={ahead <= AHEADS[0]} onClick={() => setWin(AHEADS[AHEADS.indexOf(ahead) - 1])}>
                  +
                </button>
              </span>
            )}
            <button type="button" className={tool} title={sound ? 'Couper le bip' : 'Mettre le bip'} aria-label={sound ? 'Couper le bip' : 'Mettre le bip'} aria-pressed={sound} onClick={() => setSoundOn(!sound)}>
              <Icon name={sound ? 'volume' : 'mute'} className="h-4 w-4" />
            </button>
            <button type="button" className={tool} title={folded ? 'Déplier le bandeau' : 'Replier le bandeau'} aria-label={folded ? 'Déplier le bandeau' : 'Replier le bandeau'} aria-expanded={!folded} onClick={() => setFold(!folded)}>
              <span className={`text-base leading-none transition-transform motion-reduce:transition-none ${folded ? '-rotate-90' : 'rotate-90'}`} aria-hidden>
                ›
              </span>
            </button>
            {api.endEdit && !folded && !compact && (
              <button type="button" className={`${tool} text-[11px] font-bold`} title="Terminer l’édition : retour à la lecture" onClick={api.endEdit}>
                Terminer
              </button>
            )}
          </div>

          {/* Frise défilante : ligne de visée au tiers, actions de droite à gauche. */}
          {!folded && (
            <div className={`relative overflow-hidden rounded-md bg-black/35 ${compact ? 'h-10' : 'h-14'}`} aria-label="Actions à venir">
              <span
                className={`pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 transition-colors ${ping ? 'bg-yellow-300 shadow-[0_0_10px_3px_rgba(253,224,71,0.8)] motion-safe:animate-pulse' : 'bg-white/70'}`}
                style={{ left: `${AIM * 100}%` }}
              />
              {countdown === undefined && pending && (
                <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-white/60" style={{ left: `calc(${AIM * 100}% + 0.75rem)` }}>
                  Pas encore de repère : cale la première action, les suivantes défileront.
                </span>
              )}
              {marks.map((m) => {
                const big = m.pending
                const k = m.it.k
                const color = m.it.fixed ? '#10b981' : 'rgba(255,255,255,0.18)'
                return (
                  <button
                    type="button"
                    key={m.it.id}
                    className={`absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 font-extrabold leading-none transition-[left,opacity] duration-200 ease-linear motion-reduce:transition-none ${
                      big ? `${compact ? 'h-8 min-w-8 text-sm' : 'h-11 min-w-11 text-lg'} z-10 px-1 ${ping ? 'border-yellow-300 bg-yellow-400/40' : 'border-yellow-300/90 bg-black/50'}` : `${compact ? 'h-6 min-w-6 text-[10px]' : 'h-7 min-w-7 text-xs'} px-0.5`
                    } ${m.past ? 'opacity-35' : ''} ${m.it.fixed || big ? '' : 'border-dashed'}`}
                    style={{
                      left: `${m.x * 100}%`,
                      borderColor: big ? undefined : m.it.fixed ? '#10b981' : 'rgba(255,255,255,0.6)',
                      background: big ? undefined : color,
                      boxShadow: ms.actions[m.it.i].side ? `inset 0 -3px 0 ${TEAM[ms.actions[m.it.i].side!]}` : undefined,
                    }}
                    title={`${m.it.is.map(short).join(' + ')} — ${m.it.fixed ? 'calée' : 'estimée'} à ${fmtMoment(Math.round(m.it.v!))}`}
                    aria-label={`${m.it.is.map(short).join(' + ')}, ${m.it.fixed ? 'calée' : 'estimée'}`}
                    aria-current={big ? 'true' : undefined}
                    onClick={() => onPick(m.it)}
                  >
                    {pillOf(k)}
                    {m.it.is.length > 1 && <span className="ml-0.5 text-[9px] text-white/80">+{m.it.is.length - 1}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Pouce droit : « C'est ici », puis Passer, Ignorer (à l'écart), Annuler. */}
        <div className={`flex shrink-0 gap-1 ${folded ? 'flex-row items-center' : 'flex-col items-stretch justify-end'}`}>
          {hereBtn}
          {!folded && (
            <div className="flex gap-1">
              <button type="button" className={`${tool} flex-1 bg-white/10 text-[11px] font-bold`} disabled={!pending || busy} title="Passer : la laisser non calée pour l’instant (N)" onClick={onPass}>
                Passer{!touch && <span className="ml-1 opacity-50">N</span>}
              </button>
              <button type="button" className={`${tool} text-[11px] text-white/70 hover:text-red-300`} disabled={!pending || busy} title="Ignorer : pas dans la vidéo ou sans intérêt, plus proposée (Suppr / X)" onClick={onIgnore}>
                Ignorer
              </button>
              {undo && (
                <button type="button" className={tool} title={`Annuler : ${undo.label} (Z / Retour arrière)`} aria-label={`Annuler ${undo.label}`} onClick={undo.run}>
                  <Icon name="undo" className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
