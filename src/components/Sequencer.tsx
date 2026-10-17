import { useEffect, useRef, useState } from 'react'
import type { MatchSheet, Side, StoredAction } from '../matchSheet'
import { countLabel, presentCats, type TypeFilter } from '../actionFilter'
import { NO_TEAM, pillLabel, pillWidth, stackLanes, teamAbbr, TEAM_COLOR } from '../seqPills'
import { fmtCountdown, isPenalty, isPing, liveQueue, seqView, countdownOf, type SeqItem } from '../sequencer'
import { fmtMoment } from '../videos'
import { sideName } from './matchLabels'
import { Chip, Glyph, PillBody } from './SeqPill'
import TypeChips from './TypeChips'
import { Icon } from './ui'
import type { PlayerTools } from './VideoPlayer'

/*
 * Séquençage en plein écran (mode édition) : on regarde le match en entier, les actions de la feuille défilent de droite à
 * gauche sur une frise transparente posée en bas de la vidéo, vers une ligne de visée au tiers gauche. Quand l'action
 * annoncée y arrive : « ping » (ligne et bouton qui s'illuminent, bip court si le son est mis) ; « C'est ici » (Entrée, clic)
 * la cale au temps courant et la suivante est annoncée. L'action annoncée ne dépasse pas la cible : estimation dépassée,
 * elle y reste et toute la frise attend avec elle (sequencer.ts liveQueue, seule source des positions : rien n'est recalé
 * ici). L'estimation est le moment le plus tôt possible (« au plus tôt dans ~40 s ») ; un 7 m annoncé porte une note : le
 * chrono s'arrête souvent avant, l'action peut tarder.
 *
 * Écran seulement : le calcul est dans sequencer.ts, les écritures (calage, passer, ignorer, annuler) dans MatchTimeline
 * (mêmes fonctions que la frise du match, actions simultanées calées ensemble). Couleurs fixes (blanc sur voile noir) : la
 * frise est posée sur la vidéo, claire ou sombre, quel que soit le style de l'installation.
 *
 * Pastilles (seqPills.ts, SeqPill.tsx) : QUOI en texte court et pictogramme (« BUT », « 7 M », « 2′ », carton jaune…), QUI
 * par la couleur franche de l'équipe (fond opaque), son abréviation et le numéro ; légende des deux équipes en tête du
 * bandeau ; l'annonce reprend les mêmes mots et la même couleur. Actions proches : deux rangées (stackLanes).
 */

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
  all,
  types,
  onTypes,
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
  /** Toute la file, types masqués compris (pastilles de visibilité et leurs nombres). */
  all: SeqItem[]
  /** Types d'actions affichés (actionFilter.ts) : base ne garde que les actions montrées. */
  types: TypeFilter
  onTypes: (f: TypeFilter) => void
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
  // Largeur de la frise (px), pour empiler les pastilles proches.
  const stripRef = useRef<HTMLDivElement>(null)
  const [stripW, setStripW] = useState(0)
  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStripW(el.clientWidth))
    ro.observe(el)
    setStripW(el.clientWidth)
    return () => ro.disconnect()
  }, [folded])
  const touch = api.touch

  const { queue } = liveQueue(ms, base, pending?.id, now)
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

  // QUOI et QUI d'une action : libellé, équipe (couleur, abréviation, nom), numéro, joueur relié.
  const abbr = teamAbbr(ms.home, ms.away)
  const sideOf = (a: StoredAction): Side | undefined => a.side ?? (a.pl !== undefined ? ms.players[a.pl]?.side : undefined)
  const colorOf = (a: StoredAction) => {
    const sd = sideOf(a)
    return sd ? TEAM_COLOR[sd] : NO_TEAM
  }
  const teamOf = (a: StoredAction) => {
    const sd = sideOf(a)
    return sd ? abbr[sd] : ''
  }
  const numOf = (a: StoredAction) => (a.pl !== undefined ? ms.players[a.pl]?.num : undefined)
  /** Nom du joueur si sa fiche est reliée (who donne sinon « n° 7 (Équipe) »). */
  const linked = (a: StoredAction) => {
    if (a.pl === undefined || !ms.players[a.pl]?.playerId) return undefined
    const w = who(a)
    return w && !w.startsWith('n°') ? w : undefined
  }
  const lab = (i: number) => pillLabel(ms.actions[i].k, ms.actions[i].l)
  /** Pour les lecteurs d'écran et les bulles : « But · Rhône Sud · n°7 DUPONT Léo ». */
  const full = (i: number) => {
    const a = ms.actions[i]
    const num = numOf(a)
    return [lab(i).long, sideName(ms, sideOf(a)), [num && `n°${num}`, linked(a)].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  }
  /** En bref : « Carton jaune COL n°12 ». */
  const short = (i: number) => {
    const a = ms.actions[i]
    const num = numOf(a)
    return [lab(i).long, teamOf(a), num && `n°${num}`].filter(Boolean).join(' ')
  }
  /** Étiquette de couleur d'équipe : « [● BUT] ». */
  const chip = (i: number, small = false) => (
    <Chip color={colorOf(ms.actions[i])} className={small ? 'text-[11px]' : ''}>
      <Glyph g={lab(i).glyph} card={lab(i).card} size={small ? 10 : 11} />
      {lab(i).short}
    </Chip>
  )
  /** Annonce d'une action : « [● BUT] Rhône Sud · n°7 DUPONT Léo ». */
  const said = (i: number) => {
    const a = ms.actions[i]
    const num = numOf(a)
    const team = sideName(ms, sideOf(a))
    const pl = [num && `n°${num}`, linked(a)].filter(Boolean).join(' ')
    return (
      <>
        {chip(i)} {[team, pl].filter(Boolean).join(' · ')}
      </>
    )
  }
  /** En bref, avec l'étiquette : « [● 2′] COL n°12 ». */
  const saidShort = (i: number) => {
    const a = ms.actions[i]
    const num = numOf(a)
    return (
      <>
        {chip(i, true)} {[teamOf(a), num && `n°${num}`].filter(Boolean).join(' ')}
      </>
    )
  }
  const lead = (it: SeqItem) => it.is.find((j) => ms.actions[j].k === it.k) ?? it.i
  const others = (it: SeqItem) => it.is.filter((j) => j !== lead(it))
  const nexts = pending ? base.slice(pos, pos + 2) : []

  // Rangée de chaque pastille (seqPills.ts stackLanes), d'après leur position en px sur toute la file et leur largeur estimée.
  const scale = (1 - AIM) / ahead
  const boxes = queue.flatMap((it) => {
    if (it.v === undefined) return []
    const i = lead(it)
    const a = ms.actions[i]
    const l = lab(i)
    const num = numOf(a) ? `n°${numOf(a)}` : ''
    const more = it.is.length > 1 ? ' +1' : ''
    const big = it.id === pending?.id
    const w = compact
      ? pillWidth([`•• ${l.short}${more} ${big ? teamOf(a) : ''} ${num}`], big ? 12 : 11, 12)
      : big
        ? pillWidth([`•• ${l.short}${more} · ${teamOf(a)}`, `${num} ${linked(a) ?? sideName(ms, sideOf(a))}`], 13, 26)
        : pillWidth([`•• ${l.short}${more}`, `${teamOf(a)} ${num}`], 12, 18)
    return [{ id: it.id, x: (AIM + (it.v - now) * scale) * stripW, w, block: big }]
  })
  const laneOf = stackLanes(boxes)
  const lanes = new Map(boxes.map((b, j) => [b.id, laneOf[j]]))
  // Téléphone (bandeau compact) ou bandeau replié : « ≥ 40 s » ; sinon « au plus tôt dans ~40 s ».
  const when = countdown !== undefined ? fmtCountdown(countdown, compact || folded) : undefined
  const penalty = isPenalty(ms, pending)

  // Pastilles de visibilité : types présents (actions de toute la file, masquées comprises) et leur nombre.
  const [typesOpen, setTypesOpen] = useState(false)
  const present = presentCats(all.flatMap((it) => it.is.map((j) => ms.actions[j].k)))
  const shownCats = present.filter((p) => !types.hide.includes(p.cat.id)).length
  const filtered = shownCats < present.length || types.sides.length > 0
  const counter = countLabel(pos, base.length, types, present.map((p) => p.cat.id))
  const typeChips = (
    <TypeChips
      present={present}
      filter={types}
      onChange={onTypes}
      tone="video"
      names={!compact}
      teams={(['home', 'away'] as const).map((sd) => ({ side: sd, abbr: abbr[sd], name: sideName(ms, sd), color: TEAM_COLOR[sd] }))}
    />
  )
  /** Légende des deux équipes : « [RHS] HBC Rhône Sud  [COL] Handball Collines » (abréviations seules sur téléphone). */
  const legend = (
    <span className="flex shrink-0 items-center gap-2" aria-label={`Équipes : ${abbr.home} ${ms.home}, ${abbr.away} ${ms.away}`}>
      {(['home', 'away'] as const).map((sd) => (
        <span key={sd} className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-white/90" title={sideName(ms, sd)}>
          <Chip color={TEAM_COLOR[sd]} className="text-[11px]">
            {abbr[sd]}
          </Chip>
          {!compact && <span className="max-w-[10rem] truncate">{sideName(ms, sd)}</span>}
        </span>
      ))}
    </span>
  )

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
                  <span className="block truncate text-sm font-bold" role="status" aria-label={`Prochaine action : ${full(lead(pending))}`}>
                    {chip(lead(pending))} {[teamOf(ms.actions[lead(pending)]), numOf(ms.actions[lead(pending)]) && `n°${numOf(ms.actions[lead(pending)])}`].filter(Boolean).join(' ')} · {counter}
                    {when && ` · ${when}`}
                  </span>
                ) : (
                  <>
                    <span className={`block truncate font-bold ${compact ? 'text-xs' : 'text-sm'}`} role="status">
                      <span className="text-white/60">{countdown === undefined ? 'Première action : ' : 'Prochaine action : '}</span>
                      {said(lead(pending))}
                      {others(pending).map((j) => (
                        <span key={j}>
                          {' + '}
                          {saidShort(j)}
                        </span>
                      ))}{' '}
                      · {fmtMoment(ms.actions[pending.i].t)} de jeu
                      {when && <span className={ping ? 'text-yellow-300' : 'text-white/80'}> · {when}</span>}
                    </span>
                    {penalty && (
                      <span className="block truncate text-[11px] font-semibold text-amber-200" role="note">
                        Penalty : le chrono s’arrête souvent avant, l’action peut tarder
                      </span>
                    )}
                    <span className="flex items-center gap-3 text-[11px] text-white/65">
                      <span className="min-w-0 flex-1 truncate">
                        {toast ? (
                          <span className="text-emerald-300">{toast}</span>
                        ) : countdown === undefined ? (
                          'Touche « C’est ici » quand elle arrive : les suivantes défileront.'
                        ) : nexts.length ? (
                          <>
                            ensuite :{' '}
                            {nexts.map((x, j) => (
                              <span key={x.id}>
                                {j > 0 && ' · '}
                                {saidShort(lead(x))}
                              </span>
                            ))}
                          </>
                        ) : (
                          'Dernière action de la feuille.'
                        )}
                      </span>
                      {compact && legend}
                    </span>
                  </>
                )
              ) : (
                <span className={`block truncate text-sm font-bold ${base.length ? 'text-emerald-300' : 'text-white/80'}`} role="status">
                  {!base.length && all.length ? 'Aucune action affichée : coche au moins un type.' : filtered ? 'Toutes les actions affichées sont calées ou ignorées.' : 'Toutes les actions sont calées ou ignorées.'}
                </span>
              )}
            </button>
            <span className={`shrink-0 self-center rounded bg-white/10 px-1.5 text-[11px] font-bold tabular-nums text-white/80 ${folded ? 'hidden' : ''}`} title="Action annoncée / actions affichées à caler">
              {counter}
            </span>
            {compact && !folded && (
              <span className="relative shrink-0">
                <button type="button" className={`${tool} gap-0.5 text-[11px] font-bold ${typesOpen || filtered ? 'bg-white/15' : ''}`} aria-expanded={typesOpen} title="Types d’actions affichés" onClick={() => setTypesOpen(!typesOpen)}>
                  Types{filtered ? ` ${shownCats}/${present.length}` : ''} <span aria-hidden>▾</span>
                </button>
                {typesOpen && (
                  <div className="absolute right-0 bottom-full z-40 mb-1 w-[min(30rem,80vw)] rounded-lg bg-black/90 p-2 ring-1 ring-white/20" role="dialog" aria-label="Types d’actions affichés">
                    {typeChips}
                  </div>
                )}
              </span>
            )}
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

          {/* Types d'actions affichés (et équipes, qui servent de légende) ; téléphone couché : bouton « Types ▾ ». */}
          {!folded && !compact && typeChips}

          {/* Frise défilante : ligne de visée au tiers, actions de droite à gauche, sur deux rangées quand elles sont proches. */}
          {!folded && (
            <div ref={stripRef} className={`relative overflow-hidden rounded-md bg-black/35 ${compact ? 'h-[50px]' : 'h-20'}`} aria-label="Actions à venir">
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
                const i = lead(m.it)
                const a = ms.actions[i]
                const lane = lanes.get(m.it.id) ?? 0
                const pos = lane < 0 ? 'top-1/2 -translate-y-1/2' : lane === 0 ? (compact ? 'top-0.5' : 'top-1') : compact ? 'bottom-0.5' : 'bottom-1'
                return (
                  <button
                    type="button"
                    key={m.it.id}
                    className={`absolute flex -translate-x-1/2 rounded-md transition-[left,opacity] duration-200 ease-linear focus-visible:outline-2 focus-visible:outline-white motion-reduce:transition-none ${pos} ${big ? 'z-20' : 'z-10 hover:z-30'} ${m.past ? 'opacity-40' : ''}`}
                    style={{ left: `${m.x * 100}%` }}
                    title={`${m.it.is.map(short).join(' + ')} — ${m.it.fixed ? 'calée' : 'estimée'} à ${fmtMoment(Math.round(m.it.v!))}`}
                    aria-label={`${m.it.is.map(full).join(' + ')}, ${m.it.fixed ? 'calée' : 'estimée'}`}
                    aria-current={big ? 'true' : undefined}
                    onClick={() => onPick(m.it)}
                  >
                    <PillBody
                      label={lab(i)}
                      color={colorOf(a)}
                      team={teamOf(a)}
                      teamName={sideName(ms, sideOf(a))}
                      num={numOf(a)}
                      player={big ? linked(a) : undefined}
                      more={m.it.is.length - 1}
                      size={compact ? 'compact' : 'normal'}
                      big={big}
                      fixed={m.it.fixed}
                      ping={big && ping}
                    />
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
