import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { db, newId, remove, save, type Video, type VideoMoment } from '../db'
import { can, useRole } from '../roles'
import { supabase } from '../sync'
import {
  cleanUrl,
  embedOf,
  fmtMoment,
  MAX_MOMENTS,
  momentInUrl,
  momentLabel,
  momentsOf,
  openUrl,
  parseMoment,
  sourceLabel,
  thumbnailOf,
  videoSource,
  withMoments,
} from '../videos'
import { ask } from './Confirm'
import { Icon, InfoButton } from './ui'

/*
 * Section « Vidéos » d'une fiche joueur ou d'un événement (supabase/036_videos.sql) : liens vers des vidéos
 * (Rematch, YouTube, Handball TV, Facebook…) pour regarder quelques minutes avant d'aller voir un joueur.
 * Tout le monde en ajoute ; son auteur modifie le sien ; auteur, administrateur ou encadrant (secteur) supprime.
 */

/** Lecteur intégré : son code (et celui des lecteurs YouTube/Vimeo) n'est chargé qu'au premier clic sur une vidéo. */
const VideoPlayer = lazy(() =>
  import('./VideoPlayer').catch(() => ({
    default: ({ onClose }: { onClose: () => void }) => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
        <p className="card max-w-sm p-4 text-sm">Le lecteur n’a pas pu être chargé (connexion ?). Réessaie plus tard ou ouvre la vidéo sur son site.</p>
      </div>
    ),
  })),
)

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

/** Moment d'ajout, pour l'ordre et la date affichée : celui du serveur, sinon celui de l'appareil (pas encore envoyé). */
const addedAt = (v: Video) => (v.createdAtServer ? Date.parse(v.createdAtServer) : v.updatedAt)

export function VideoSection({ kind, targetId, dept }: { kind: Video['targetKind']; targetId: string; dept?: string }) {
  const role = useRole()
  const online = useOnline()
  const videos = useLiveQuery(
    async () =>
      (await db.videos.where('targetId').equals(targetId).toArray())
        .filter((v) => !v.deleted && v.targetKind === kind && v.url)
        .sort((a, b) => addedAt(b) - addedAt(a)),
    [kind, targetId],
  )
  // Formulaire : null = fermé, 'new' = ajout, sinon le lien modifié.
  const [form, setForm] = useState<'new' | Video | null>(null)
  const [note, setNote] = useState('')
  // Vidéo ouverte dans le lecteur intégré (et moment à jouer tout de suite).
  const [playing, setPlaying] = useState<{ v: Video; moment?: number } | null>(null)
  const closePlayer = useCallback(() => setPlaying(null), [])
  if (!videos) return null

  const what = kind === 'player' ? 'ce joueur' : 'cet événement'
  return (
    <div className="card p-4">
      <div className="section-title flex items-center gap-2">
        <Icon name="video" className="h-3.5 w-3.5" />
        Vidéos{videos.length > 0 && <span className="text-muted">({videos.length})</span>}
        <InfoButton title="Vidéos">
          <p>
            Un lien vers une vidéo où l’on voit {what} : Rematch, YouTube, Handball TV, Facebook… Pour le regarder quelques minutes avant de décider
            d’aller le voir.
          </p>
          <p>
            Seul le lien est enregistré, jamais la vidéo. Indique un ou plusieurs moments où regarder (début, durée et note facultatives, ex. « 12:30 ·
            15 s · contre-attaque »).
          </p>
          <p>
            YouTube, Vimeo et fichiers vidéo (.mp4…) se lisent dans l’appli : chaque moment joue son passage, « Voir les actions » les enchaîne. Les
            autres sites (Rematch, Handball TV, Facebook, Dartfish…) s’ouvrent dans un nouvel onglet. Rien n’est téléchargé avant le clic.
          </p>
          <p>Tout le monde peut ajouter un lien ; chacun modifie les siens. Les encadrants et les administrateurs peuvent retirer un lien.</p>
        </InfoButton>
      </div>

      {videos.length > 0 && (
        <div className="flex flex-col gap-2">
          {videos.map((v) =>
            form !== 'new' && form?.id === v.id ? (
              <VideoForm key={v.id} kind={kind} targetId={targetId} video={v} others={videos} onDone={() => setForm(null)} />
            ) : (
              <VideoRow
                key={v.id}
                v={v}
                online={online}
                onOffline={() => setNote('Hors ligne : la vidéo pourra s’ouvrir une fois la connexion revenue.')}
                onPlay={embedOf(v.url) ? (moment) => (setNote(''), setPlaying({ v, moment })) : undefined}
                onEdit={can.editVideo(v) ? () => setForm(v) : undefined}
                onDelete={
                  can.deleteVideo(role, v, dept)
                    ? async () => (await ask(`Retirer le lien « ${v.title || sourceLabel(v.url)} » ?`, { ok: 'Retirer' })) && void remove('videos', v.id)
                    : undefined
                }
              />
            ),
          )}
        </div>
      )}
      {note && (
        <p className="mt-2 text-[11px] text-amber-200" role="status">
          {note}
        </p>
      )}

      {form === 'new' ? (
        <div className={videos.length ? 'mt-3' : ''}>
          <VideoForm
            kind={kind}
            targetId={targetId}
            others={videos}
            onDone={(saved) => {
              setForm(null)
              setNote(saved && supabase && !navigator.onLine ? 'Lien enregistré sur l’appareil : il sera partagé au retour de la connexion.' : '')
            }}
          />
        </div>
      ) : (
        <button className={`btn-ghost w-full py-1.5 text-xs ${videos.length ? 'mt-3' : ''}`} onClick={() => (setForm('new'), setNote(''))}>
          + Ajouter une vidéo
        </button>
      )}

      {playing && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 text-sm text-white/80" role="status">
              Chargement du lecteur…
            </div>
          }
        >
          <VideoPlayer video={playing.v} moment={playing.moment} onClose={closePlayer} />
        </Suspense>
      )}
    </div>
  )
}

function VideoRow({
  v,
  online,
  onOffline,
  onEdit,
  onDelete,
  onPlay,
}: {
  v: Video
  online: boolean
  onOffline: () => void
  onEdit?: () => void
  onDelete?: () => void
  /** Lecture dans l'appli (source lisible ici), éventuellement à un moment ; sinon le lien s'ouvre sur son site. */
  onPlay?: (moment?: number) => void
}) {
  const href = openUrl(v)
  const moments = momentsOf(v)
  const youtube = videoSource(v.url) === 'youtube'
  const thumb = online ? thumbnailOf(v.url) : undefined
  const [broken, setBroken] = useState(false)
  const source = sourceLabel(v.url)
  const when = new Date(addedAt(v)).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })
  const author = v.createdByName ?? (v.createdAtServer ? undefined : 'moi')
  // Hors ligne : pas d'onglet vide, un message à la place.
  const guard = (e: React.MouseEvent) => {
    if (!navigator.onLine) {
      e.preventDefault()
      onOffline()
    }
  }
  const link = (cls: string, children: React.ReactNode, label?: string) =>
    onPlay ? (
      <button type="button" onClick={() => onPlay()} className={`${cls} max-w-full text-left`} aria-label={label} title="Lire la vidéo">
        {children}
      </button>
    ) : href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        onClick={guard}
        className={cls}
        aria-label={label}
        title={`Ouvrir sur ${source} (nouvel onglet)`}
      >
        {children}
      </a>
    ) : (
      <span className={cls}>{children}</span>
    )
  return (
    <div className="rounded-md border border-line bg-panel-2 p-2">
      <div className="flex items-center gap-3">
        {link(
          'relative flex h-[54px] w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-panel text-muted',
          thumb && !broken ? (
            <>
              <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={() => setBroken(true)} />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white">
                  <Icon name="play" className="h-3.5 w-3.5" filled />
                </span>
              </span>
            </>
          ) : (
            <span className="flex flex-col items-center gap-0.5 px-1 text-center">
              <Icon name="play" className="h-4 w-4" />
              <span className="max-w-full truncate text-[9px] font-bold">{source}</span>
            </span>
          ),
          `Ouvrir la vidéo ${v.title ?? source}`,
        )}
        <div className="min-w-0 flex-1">
          {link('block truncate text-xs font-bold hover:text-accent', v.title || `Vidéo ${source}`)}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted">
            <span className="rounded bg-panel px-1 py-px font-bold">{source}</span>
            <span className="truncate">
              {author ? `${author} · ` : ''}
              {when}
            </span>
          </div>
        </div>
        {(onEdit || onDelete) && (
          <div className="flex shrink-0 flex-col items-center gap-1.5">
            {onEdit && (
              <button className="text-muted hover:text-fg" title="Modifier ce lien" aria-label="Modifier ce lien" onClick={onEdit}>
                <Icon name="pencil" className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button className="text-muted hover:text-red-400" title="Retirer ce lien" aria-label="Retirer ce lien" onClick={onDelete}>
                <Icon name="trash" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      {moments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Moments à regarder">
          {moments.map((m, i) => {
            const to = openUrl(v, youtube ? m.at : undefined)
            const cls = 'inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-[10px]'
            const body = (
              <>
                <Icon name="play" className="h-2.5 w-2.5 shrink-0 text-accent" filled />
                <span className="truncate">
                  <span className="font-bold">{fmtMoment(m.at)}</span>
                  {m.dur ? ` · ${m.dur} s` : ''}
                  {m.note ? ` · ${m.note}` : ''}
                </span>
              </>
            )
            if (onPlay)
              return (
                <button key={i} type="button" onClick={() => onPlay(i)} className={`${cls} hover:border-accent hover:text-accent`} title={`${momentLabel(m)} — jouer ce passage`}>
                  {body}
                </button>
              )
            const hint = `${momentLabel(m)} — ${youtube ? 'ouvrir la vidéo à ce moment' : 'ouvrir la vidéo (au début : avancer jusqu’à ce moment)'}`
            return to ? (
              <a
                key={i}
                href={to}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                onClick={guard}
                className={`${cls} hover:border-accent hover:text-accent`}
                title={hint}
              >
                {body}
              </a>
            ) : (
              <span key={i} className={cls}>
                {body}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Ajout ou modification d'un lien : adresse, titre, moments (début, durée, note). */
function VideoForm({
  kind,
  targetId,
  video,
  others,
  onDone,
}: {
  kind: Video['targetKind']
  targetId: string
  video?: Video
  others: Video[]
  onDone: (saved: boolean) => void
}) {
  const [url, setUrl] = useState(video?.url ?? '')
  const [title, setTitle] = useState(video?.title ?? '')
  const [rows, setRows] = useState<MomentRow[]>(() => {
    const ms = video ? momentsOf(video) : []
    return ms.length ? ms.map(toRow) : [emptyRow()]
  })
  const [error, setError] = useState('')
  const setRow = (i: number, patch: Partial<MomentRow>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setError('')
  }

  // Lien YouTube collé avec un moment (?t=95) : il devient le premier moment, s'il n'est pas déjà rempli.
  function fillMoment(u: string) {
    if (rows[0]?.at.trim()) return
    const c = cleanUrl(u)
    const t = 'url' in c ? momentInUrl(c.url) : undefined
    if (t) setRows((rs) => (rs.length ? rs.map((r, j) => (j === 0 ? { ...r, at: fmtMoment(t) } : r)) : [{ ...emptyRow(), at: fmtMoment(t) }]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const c = cleanUrl(url)
    if ('error' in c) return setError(c.error)
    const list: VideoMoment[] = []
    for (const r of rows) {
      if (!r.at.trim() && !r.dur.trim() && !r.note.trim()) continue // ligne vide : ignorée
      const at = parseMoment(r.at)
      if (at === undefined) return setError('Indique le début de chaque moment (ex. 12:30).')
      if (at === null) return setError('Début à écrire en minutes:secondes (12:30) ou heures:minutes:secondes (1:02:30).')
      const dur = r.dur.trim() ? Number(r.dur.trim().replace(/\s*s$/i, '')) : undefined
      if (dur !== undefined && !(Number.isInteger(dur) && dur >= 1 && dur <= 600)) return setError('Durée en secondes, de 1 à 600.')
      list.push({ at, dur, note: r.note })
    }
    const m = withMoments(list)
    if (others.some((o) => o.id !== video?.id && o.url === c.url && o.at === m.at)) return setError('Ce lien est déjà dans la liste.')
    const t = title.trim().slice(0, 200) || undefined
    if (video) await save<Video>('videos', { ...video, url: c.url, title: t, ...m })
    else await save<Video>('videos', { id: newId(), targetKind: kind, targetId, url: c.url, title: t, ...m })
    onDone(true)
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-2 rounded-md border border-accent/50 bg-panel-2 p-3">
      <input
        className="field"
        type="url"
        inputMode="url"
        autoFocus={!video}
        placeholder="Lien de la vidéo (Rematch, YouTube…)"
        value={url}
        onChange={(e) => (setUrl(e.target.value), setError(''))}
        onBlur={(e) => fillMoment(e.target.value)}
        onPaste={(e) => fillMoment(e.clipboardData.getData('text'))}
      />
      <input className="field" placeholder="Titre (facultatif)" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[11px] font-bold text-muted">Moments à regarder (facultatif)</legend>
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[4.25rem_3.75rem_minmax(0,1fr)_1.25rem] items-center gap-1.5">
            <input
              className="field px-2"
              placeholder="mm:ss"
              inputMode="numeric"
              aria-label={`Début du moment ${i + 1} (minutes:secondes)`}
              value={r.at}
              onChange={(e) => setRow(i, { at: e.target.value })}
            />
            <input
              className="field px-2"
              placeholder="durée s"
              inputMode="numeric"
              aria-label={`Durée du moment ${i + 1} en secondes (facultatif)`}
              value={r.dur}
              onChange={(e) => setRow(i, { dur: e.target.value })}
            />
            <input
              className="field px-2"
              placeholder="Note (ex. défense)"
              maxLength={120}
              aria-label={`Note du moment ${i + 1} (facultatif)`}
              value={r.note}
              onChange={(e) => setRow(i, { note: e.target.value })}
            />
            <button
              type="button"
              className="text-muted hover:text-red-400"
              title="Retirer ce moment"
              aria-label={`Retirer le moment ${i + 1}`}
              onClick={() => {
                setRows((rs) => rs.filter((_, j) => j !== i))
                setError('')
              }}
            >
              <Icon name="trash" className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {rows.length < MAX_MOMENTS && (
          <button type="button" className="self-start text-[11px] font-bold text-accent hover:underline" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
            + Ajouter un moment
          </button>
        )}
      </fieldset>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => onDone(false)}>
          Annuler
        </button>
        <button type="submit" className="btn-primary px-4 py-1.5 text-xs" disabled={!url.trim()}>
          {video ? 'Enregistrer' : 'Ajouter'}
        </button>
      </div>
    </form>
  )
}

/** Ligne du formulaire : textes saisis (début « 12:30 », durée en secondes, note). */
type MomentRow = { key: number; at: string; dur: string; note: string }
let rowKey = 0
const emptyRow = (): MomentRow => ({ key: ++rowKey, at: '', dur: '', note: '' })
const toRow = (m: VideoMoment): MomentRow => ({ key: ++rowKey, at: fmtMoment(m.at), dur: m.dur ? String(m.dur) : '', note: m.note ?? '' })
