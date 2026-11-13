import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { Video } from '../db'
import { actionKeys, type MatchSheet } from '../matchSheet'
import { cleanMarks, MARK_LABEL, marksFor, matchErrorText, mergeMarks, type PeriodMark, type PlayerMarks, type PlayerMatch, type PlayerMatchVideo, type PlayerSeqData } from '../playerMatches'
import { loadSeq, saveMarks, type MatchCtx } from '../playerMatchesApi'
import { seqQueue } from '../sequencer'
import { fmtMoment } from '../videos'
import { actionLabel } from './matchLabels'
import type { PlayerTools } from './VideoPlayer'

/*
 * Séquenceur SIMPLIFIÉ de l'espace joueur (supabase/053_matchs_joueur.sql, src/playerMatches.ts) : le lecteur de l'appli
 * (VideoPlayer) avec, dessous, la liste de SES actions de la feuille de match. Même moteur que le staff (sequencer.ts
 * seqQueue, matchSheet.ts timeline) : une fois les bornes des mi-temps posées, chaque action est proposée à l'instant estimé
 * d'après sa minute de jeu ; « Aller » y emmène, il ajuste en regardant et touche « C'est ici ».
 * Ce que le staff a calé sur cette vidéo prime : affiché, jamais modifiable ici. Ses repères sont enregistrés à part
 * (hb_player_set_marks) et montrés au staff comme « proposés par le joueur ». Pas d'ajout libre d'actions, rien sur les
 * actions des autres joueurs.
 */

const VideoPlayer = lazy(() => import('./VideoPlayer'))

/** On arrive un peu avant l'instant estimé (l'estimation est le moment le plus tôt possible). */
const LEAD = 3

const gameClock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
const PERIOD = (p: number) => (p === 1 ? '1re mi-temps' : p === 2 ? '2e mi-temps' : `Prolongation ${p - 2}`)

export function PlayerSequencer({ ctx, match, video, canWrite, onClose }: { ctx: MatchCtx; match: PlayerMatch; video: PlayerMatchVideo; canWrite: boolean; onClose: () => void }) {
  const [data, setData] = useState<PlayerSeqData>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    void loadSeq(ctx, match.eventId).then((r) => {
      if (!live) return
      if (r.ok) setData(r.value)
      else setError(matchErrorText(r.error))
    })
    return () => {
      live = false
    }
  }, [ctx, match.eventId])
  const v = useMemo<Video>(() => ({ id: video.id, url: video.url, targetKind: 'event', targetId: match.eventId, updatedAt: 0 }), [video.id, video.url, match.eventId])
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 text-sm text-white/80" role="status">
          Chargement du lecteur…
        </div>
      }
    >
      <VideoPlayer
        video={v}
        onClose={onClose}
        tools={(api) =>
          error ? (
            <p className="text-xs text-red-300">{error}</p>
          ) : data ? (
            <SeqPanel ctx={ctx} match={match} video={video} data={data} setData={setData} api={api} canWrite={canWrite} />
          ) : (
            <p className="text-xs text-muted">Chargement de tes actions…</p>
          )
        }
      />
    </Suspense>
  )
}

function SeqPanel({
  ctx,
  match,
  video,
  data,
  setData,
  api,
  canWrite,
}: {
  ctx: MatchCtx
  match: PlayerMatch
  video: PlayerMatchVideo
  data: PlayerSeqData
  setData: (d: PlayerSeqData) => void
  api: PlayerTools
  canWrite: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const merged = mergeMarks(data, video)
  const mine: PlayerMarks = data.mine && data.mine.videoId === video.id ? data.mine : { videoId: video.id, marks: {}, fix: {} }
  // Même moteur que le staff : déroulé entier (repères des autres actions compris), file filtrée sur MES actions.
  const ms: Pick<MatchSheet, 'actions' | 'halfMin' | 'sync'> = {
    actions: data.actions.map((a) => ({ t: a.t, p: a.p, s: a.s, k: a.k, ...(a.side ? { side: a.side } : {}), ...(a.l ? { l: a.l } : {}) })),
    halfMin: data.halfMin,
    sync: { videoId: video.id, url: video.url, marks: merged.marks, fix: merged.fix },
  }
  const queue = seqQueue(ms).filter((it) => it.is.some((j) => data.actions[j].me))
  const keys = actionKeys(data.actions)
  const myKeys = (is: number[]) => is.filter((j) => data.actions[j].me).map((j) => keys[j])
  const placed = queue.filter((it) => myKeys(it.is).every((k) => merged.fixBy(k))).length
  const bounds = marksFor(data)
  const anchored = Object.keys(merged.marks).length > 0

  async function commit(next: PlayerMarks, done: string) {
    const cleaned = cleanMarks(next, data, video)
    setBusy(true)
    setMsg(null)
    try {
      const r = await saveMarks(ctx, match.eventId, cleaned)
      if (!r.ok) return setMsg({ ok: false, text: matchErrorText(r.error) })
      setData({ ...data, mine: r.value })
      setMsg({ ok: true, text: done })
    } finally {
      setBusy(false)
    }
  }
  const now = () => {
    const t = api.time()
    if (t === undefined) {
      setMsg({ ok: false, text: 'Lance la vidéo d’abord (le lecteur n’est pas encore prêt).' })
      return undefined
    }
    return Math.round(t * 10) / 10
  }
  const setMark = (k: PeriodMark, v: number | undefined) => {
    const marks = { ...mine.marks }
    if (v === undefined) delete marks[k]
    else marks[k] = v
    void commit({ ...mine, marks }, v === undefined ? 'Repère retiré.' : `${MARK_LABEL[k]} : ${fmtMoment(Math.round(v))}.`)
  }
  const setFix = (is: number[], v: number | undefined) => {
    const fix = { ...mine.fix }
    for (const k of myKeys(is)) {
      if (merged.fixBy(k) === 'staff') continue
      if (v === undefined) delete fix[k]
      else fix[k] = v
    }
    void commit({ ...mine, fix }, v === undefined ? 'Repère retiré.' : `Calé à ${fmtMoment(Math.round(v))}.`)
  }
  const small = 'flex h-9 min-w-9 items-center justify-center rounded border border-line bg-panel px-2 text-[11px] font-bold hover:border-accent disabled:opacity-40'
  const tag = (by?: 'staff' | 'moi') =>
    by === 'staff' ? (
      <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[9px] font-bold text-emerald-300">ton encadrant</span>
    ) : by === 'moi' ? (
      <span className="rounded-full bg-accent/15 px-1.5 py-px text-[9px] font-bold text-accent">toi</span>
    ) : null

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-2 text-xs" data-testid="mes-actions-video">
      <div>
        <div className="font-bold">Mes actions dans la vidéo</div>
        <p className="mt-0.5 text-[10px] text-muted">
          1. Pose les bornes : va au coup d’envoi et touche « Ici » (la fin de la 1re mi-temps et la reprise aident aussi). 2. Pour chacune de tes actions,
          « Aller » t’emmène à l’instant estimé d’après la minute de la feuille : ajuste en regardant et touche « C’est ici ». Ce que ton encadrant a déjà calé
          reste comme il l’a mis.
        </p>
      </div>

      {/* Bornes des périodes */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1.5 gap-y-1">
        {bounds.map((k) => {
          const v = merged.marks[k]
          const by = merged.markBy(k)
          return (
            <div key={k} className="contents">
              <span className="truncate">
                {MARK_LABEL[k]} {tag(by)}
              </span>
              {v !== undefined ? (
                <button className="h-9 px-1 font-bold text-accent tabular-nums hover:underline" title="Aller à ce repère" onClick={() => api.seek(v)}>
                  {fmtMoment(Math.round(v))}
                </button>
              ) : (
                <span className="text-muted">—</span>
              )}
              {canWrite && by !== 'staff' ? (
                <span className="flex gap-1">
                  <button
                    className={small}
                    disabled={!api.ready || busy}
                    title={`${MARK_LABEL[k]} : le temps actuel de la vidéo`}
                    onClick={() => {
                      const t = now()
                      if (t !== undefined) setMark(k, t)
                    }}
                  >
                    Ici
                  </button>
                  {by === 'moi' && (
                    <button className={`${small} text-muted`} disabled={busy} aria-label={`Retirer le repère ${MARK_LABEL[k]}`} onClick={() => setMark(k, undefined)}>
                      ✕
                    </button>
                  )}
                </span>
              ) : (
                <span />
              )}
            </div>
          )
        })}
      </div>

      {/* Mes actions */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="font-bold">Mes actions de la feuille</span>
          <span className="text-[10px] text-muted">
            {placed} calée{placed > 1 ? 's' : ''} sur {queue.length}
          </span>
        </div>
        {!queue.length ? (
          <p className="text-[11px] text-muted">Aucune action à ton nom dans le déroulé de cette feuille (buts, arrêts, tirs, sanctions…).</p>
        ) : (
          <ul className="divide-y divide-line/50 rounded-md border border-line">
            {queue.map((it) => {
              const a = ms.actions[it.i]
              const ks = myKeys(it.is)
              const by = ks.map((k) => merged.fixBy(k)).find(Boolean)
              const staff = ks.length > 0 && ks.every((k) => merged.fixBy(k) === 'staff')
              const v = it.v
              return (
                <li key={it.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5">
                  <span className="w-10 shrink-0 text-muted tabular-nums">{gameClock(a.t)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-bold">{it.is.filter((j) => data.actions[j].me).map((j) => actionLabel(ms.actions[j])).join(' + ')}</span>{' '}
                    <span className="text-muted tabular-nums">
                      {a.s[0]}-{a.s[1]} · {PERIOD(a.p)}
                    </span>
                    <span className="block text-[10px] text-muted">
                      {v === undefined ? (
                        'Pose d’abord le coup d’envoi'
                      ) : by ? (
                        <>
                          ✓ {fmtMoment(Math.round(v))} {tag(by)}
                        </>
                      ) : (
                        `~ vers ${fmtMoment(Math.round(v))} (estimé)`
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button className={small} disabled={v === undefined || !api.ready} title="Aller à cet instant de la vidéo" onClick={() => v !== undefined && api.seek(Math.max(0, v - (by ? 0 : LEAD)))}>
                      Aller
                    </button>
                    {canWrite && !staff && (
                      <button
                        className={`${small} border-accent text-accent`}
                        disabled={!api.ready || busy}
                        title="Cette action est à cet instant de la vidéo"
                        onClick={() => {
                          const t = now()
                          if (t !== undefined) setFix(it.is, t)
                        }}
                      >
                        C’est ici
                      </button>
                    )}
                    {canWrite && by === 'moi' && (
                      <button className={`${small} text-muted`} disabled={busy} aria-label="Retirer ce repère" onClick={() => setFix(it.is, undefined)}>
                        ✕
                      </button>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {!anchored && queue.length > 0 && <p className="mt-1 text-[10px] text-muted">Sans coup d’envoi, on ne peut pas encore estimer où sont tes actions.</p>}
      </div>
      {msg && (
        <p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`} role="status">
          {msg.text}
        </p>
      )}
      {!canWrite && <p className="text-[10px] text-muted">Aperçu : rien n’est enregistré.</p>}
    </div>
  )
}
