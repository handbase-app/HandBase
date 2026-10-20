import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEMO, fmtDate, TRIAL, type Player } from '../db'
import type { ParsedSheet } from '../matchSheet'
import { findMeOnSheet, matchErrorText, matchTitle, myTeam, presenceError, type PlayerMatch, type PlayerMatchVideo } from '../playerMatches'
import { addVideo, importSheet, loadMatches, pdfSheetProvider, type MatchCtx } from '../playerMatchesApi'
import { isPlayerRole, useRole } from '../roles'
import { supabase } from '../sync'
import { cleanUrl, embedOf, openUrl, sourceLabel, thumbnailOf } from '../videos'
import { PlayerSequencer } from './PlayerSequencer'
import { Icon, SectionTitle } from './ui'

/*
 * « Mes matchs » de la page /moi (espace joueur ; supabase/053_matchs_joueur.sql, src/playerMatches.ts) :
 *  - importer la feuille de match (PDF lu sur l'appareil, comme pour le staff ; rien n'est envoyé tant que le jeune n'a pas
 *    vu le résumé et confirmé ; seuls numéros, équipes et déroulé partent, plus sa propre ligne pour vérifier qu'il y est) ;
 *  - ajouter le lien vidéo d'un de ses matchs (ou voir celui qui y est déjà) ;
 *  - repérer ses actions dans la vidéo (séquenceur simplifié : PlayerSequencer).
 * Ce qu'il ajoute est marqué « proposé par le joueur » côté staff, qui garde la main.
 */

type Pending = { sheet: ParsedSheet; index: number }

export function PlayerMatches({ p, canWrite }: { p: Player; canWrite: boolean }) {
  const role = useRole()
  const server = isPlayerRole(role) && !!supabase
  // Aperçu d'un administrateur avec le serveur : lecture sur l'appareil, sans écriture.
  const ctx = useMemo<MatchCtx>(() => ({ playerId: p.id, server, readOnly: !canWrite }), [p.id, server, canWrite])
  const [matches, setMatches] = useState<PlayerMatch[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reading, setReading] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [seq, setSeq] = useState<{ match: PlayerMatch; video: PlayerMatchVideo } | null>(null)

  const reload = useCallback(async () => {
    const r = await loadMatches(ctx)
    if (r.ok) {
      setMatches(r.value)
      setLoadError('')
    } else {
      setLoadError(matchErrorText(r.error))
      setMatches((m) => m ?? [])
    }
  }, [ctx])
  // Chargement (serveur ou appareil) : setState seulement à la réponse.
  useEffect(() => {
    let live = true
    void loadMatches(ctx).then((r) => {
      if (!live) return
      setMatches(r.ok ? r.value : [])
      setLoadError(r.ok ? '' : matchErrorText(r.error))
    })
    return () => {
      live = false
    }
  }, [ctx])

  async function read(file: File) {
    setMsg(null)
    setPending(null)
    setReading(true)
    try {
      const sheet = await pdfSheetProvider(file).read()
      const presence = findMeOnSheet(sheet, p)
      const err = presenceError(presence)
      if (err) return setMsg({ ok: false, text: err })
      if (presence.kind === 'license' || presence.kind === 'name') setPending({ sheet, index: presence.index })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error && e.message ? e.message : 'Lecture du PDF impossible.' })
    } finally {
      setReading(false)
    }
  }

  async function send() {
    if (!pending) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await importSheet(ctx, pending.sheet, pending.index)
      if (!r.ok) return setMsg({ ok: false, text: matchErrorText(r.error) })
      setPending(null)
      setMsg({
        ok: true,
        text: r.value.created
          ? 'Match ajouté à tes matchs. Ton encadrant le verra.'
          : r.value.attached
            ? 'Ce match était déjà dans l’appli : il est maintenant dans tes matchs.'
            : 'Ce match est déjà dans tes matchs.',
      })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const s = pending?.sheet
  const me = pending ? pending.sheet.roster[pending.index] : undefined
  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="mes-matchs">
      <SectionTitle info="Importe la feuille de match (le PDF téléchargé après le match) d’un match où tu as joué : il s’ajoute à tes matchs et ton encadrant le voit. Tu peux ensuite ajouter le lien de la vidéo du match et repérer tes actions dedans.">
        Mes matchs
      </SectionTitle>

      {canWrite && !pending && (
        <div className="flex flex-col gap-1">
          <label className={`btn-primary min-h-11 w-fit cursor-pointer px-4 ${reading ? 'pointer-events-none opacity-60' : ''}`}>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void read(f)
              }}
            />
            {reading ? 'Lecture de la feuille…' : 'Importer une feuille de match'}
          </label>
          <p className="text-[10px] text-muted">Le PDF est lu sur ton appareil : il n’est ni envoyé ni gardé.</p>
          {(DEMO || TRIAL) && (
            <p className="text-[10px] text-muted">
              Pour essayer :{' '}
              <a className="font-bold text-accent underline" href={`${import.meta.env.BASE_URL}demo/feuille-match-demo.pdf`} download>
                feuille de match d’exemple
              </a>{' '}
              (joueurs fictifs).
            </p>
          )}
        </div>
      )}

      {/* Résumé avant d'envoyer : rien ne part tant qu'il n'a pas confirmé. */}
      {pending && s && me && (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-panel-2 p-3 text-xs" data-testid="resume-feuille">
          <div className="text-[11px] text-muted">
            {[s.competition, s.date ? fmtDate(s.date) : undefined, s.time].filter(Boolean).join(' · ')}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 font-bold">
            <span className="text-right">{s.home}</span>
            <span className="rounded bg-panel px-2 py-0.5 tabular-nums">{s.score ? `${s.score[0]} – ${s.score[1]}` : '–'}</span>
            <span>{s.away}</span>
          </div>
          <p>
            Tu es sur la feuille{me.num ? ` (n° ${me.num})` : ''} avec <b>{me.side === 'home' ? s.home : s.away}</b>.
          </p>
          <p className="text-[10px] text-muted">
            Seuls les numéros, les équipes et le déroulé du match sont enregistrés, jamais les noms des autres joueurs ni le PDF. Si le match est déjà dans
            l’appli, il est simplement ajouté à tes matchs.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary min-h-11 px-4" disabled={busy} onClick={() => void send()}>
              {busy ? 'Envoi…' : 'Ajouter à mes matchs'}
            </button>
            <button className="btn-ghost min-h-11 px-4" disabled={busy} onClick={() => setPending(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-amber-200'}`} role="status">
          {msg.text}
        </p>
      )}
      {loadError && <p className="text-[11px] text-amber-200">{loadError}</p>}

      {matches === null ? (
        <p className="text-xs text-muted">Chargement…</p>
      ) : matches.length === 0 ? (
        !loadError && <p className="text-xs text-muted">Pas encore de match ici. {canWrite ? 'Importe la feuille d’un match où tu as joué.' : ''}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {matches.map((m) => (
            <MatchItem key={m.eventId} m={m} ctx={ctx} canWrite={canWrite} onChanged={reload} onSeq={(video) => setSeq({ match: m, video })} />
          ))}
        </ul>
      )}

      {seq && <PlayerSequencer ctx={ctx} match={seq.match} video={seq.video} canWrite={canWrite} onClose={() => setSeq(null)} />}
    </section>
  )
}

function MatchItem({ m, ctx, canWrite, onChanged, onSeq }: { m: PlayerMatch; ctx: MatchCtx; canWrite: boolean; onChanged: () => Promise<void>; onSeq: (v: PlayerMatchVideo) => void }) {
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const team = myTeam(m)
  const video = m.videos[0]

  async function add() {
    const c = cleanUrl(url)
    if ('error' in c) return setMsg({ ok: false, text: c.error })
    setBusy(true)
    setMsg(null)
    try {
      const r = await addVideo(ctx, m.eventId, c.url)
      if (!r.ok) return setMsg({ ok: false, text: matchErrorText(r.error) })
      setAdding(false)
      setUrl('')
      setMsg({ ok: true, text: r.value.created ? 'Vidéo ajoutée.' : 'Une vidéo était déjà liée à ce match : la voici.' })
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-line bg-panel-2 p-3 text-xs">
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span className="min-w-0 flex-1 truncate">{[fmtDate(m.date), m.competition].filter(Boolean).join(' · ')}</span>
        {m.mine && m.proposed && <span className="shrink-0 rounded-full bg-panel px-1.5 py-px text-[9px] font-bold">ajouté par toi</span>}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 font-bold" aria-label={matchTitle(m)}>
        <span className={`text-right ${m.side === 'home' ? 'text-accent' : ''}`}>{m.home}</span>
        <span className="rounded bg-panel px-2 py-0.5 tabular-nums">{m.score ? `${m.score[0]} – ${m.score[1]}` : '–'}</span>
        <span className={m.side === 'away' ? 'text-accent' : ''}>{m.away}</span>
      </div>
      {team && (
        <div className="text-[11px] text-muted">
          {m.num ? `N° ${m.num} · ` : ''}
          {team}
        </div>
      )}

      {video ? (
        <VideoLine v={video} onSeq={embedOf(video.url) ? () => onSeq(video) : undefined} />
      ) : canWrite ? (
        adding ? (
          <div className="flex flex-col gap-1.5">
            <input
              className="field min-h-11 w-full"
              type="url"
              inputMode="url"
              placeholder="Lien de la vidéo (YouTube, Vimeo…)"
              value={url}
              autoFocus
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
            />
            <div className="flex gap-2">
              <button className="btn-primary min-h-11 px-4" disabled={busy || !url.trim()} onClick={() => void add()}>
                {busy ? 'Ajout…' : 'Ajouter'}
              </button>
              <button className="btn-ghost min-h-11 px-4" disabled={busy} onClick={() => (setAdding(false), setMsg(null))}>
                Annuler
              </button>
            </div>
            <p className="text-[10px] text-muted">Seul le lien est enregistré, jamais la vidéo.</p>
          </div>
        ) : (
          <button className="btn-ghost min-h-11 w-fit px-3 text-xs" onClick={() => setAdding(true)}>
            <Icon name="video" className="mr-1 inline h-3.5 w-3.5" />
            Ajouter la vidéo du match
          </button>
        )
      ) : (
        <p className="text-[11px] text-muted">Pas encore de vidéo.</p>
      )}
      {msg && <p className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-amber-200'}`}>{msg.text}</p>}
    </li>
  )
}

function VideoLine({ v, onSeq }: { v: PlayerMatchVideo; onSeq?: () => void }) {
  const href = openUrl(v)
  const thumb = thumbnailOf(v.url)
  const source = sourceLabel(v.url)
  return (
    <div className="flex flex-col gap-2">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        className="flex items-center gap-2 rounded-md border border-line bg-panel p-1.5 hover:border-accent"
        title={`Ouvrir sur ${source} (nouvel onglet)`}
      >
        <span className="flex h-[45px] w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-panel-2 text-muted">
          {thumb ? <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" /> : <Icon name="play" className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{v.title || 'Vidéo du match'}</span>
          <span className="text-[10px] text-muted">
            {source}
            {v.mine ? ' · ajoutée par toi' : ''}
          </span>
        </span>
        <Icon name="external" className="h-3.5 w-3.5 shrink-0 text-muted" />
      </a>
      {onSeq && (
        <button className="btn-ghost min-h-11 w-fit px-3 text-xs" onClick={onSeq}>
          <Icon name="target" className="mr-1 inline h-3.5 w-3.5" />
          Repérer mes actions dans la vidéo
        </button>
      )}
    </div>
  )
}
