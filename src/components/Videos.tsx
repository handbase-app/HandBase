import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, newId, remove, save, type Video } from '../db'
import { can, useRole } from '../roles'
import { supabase } from '../sync'
import { cleanUrl, fmtMoment, momentInUrl, openUrl, parseMoment, sourceLabel, thumbnailOf } from '../videos'
import { ask } from './Confirm'
import { Icon, InfoButton } from './ui'

/*
 * Section « Vidéos » d'une fiche joueur ou d'un événement (supabase/036_videos.sql) : liens vers des vidéos
 * (Rematch, YouTube, Handball TV, Facebook…) pour regarder quelques minutes avant d'aller voir un joueur.
 * Tout le monde en ajoute ; son auteur modifie le sien ; auteur, administrateur ou encadrant (secteur) supprime.
 */

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
          <p>Seul le lien est enregistré, jamais la vidéo. Indique le moment où regarder (ex. 12:30) : sur YouTube, la vidéo s’ouvre directement à ce moment.</p>
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
    </div>
  )
}

function VideoRow({
  v,
  online,
  onOffline,
  onEdit,
  onDelete,
}: {
  v: Video
  online: boolean
  onOffline: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const href = openUrl(v)
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
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={guard} className={cls} aria-label={label}>
        {children}
      </a>
    ) : (
      <span className={cls}>{children}</span>
    )
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-panel-2 p-2">
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
          {v.at !== undefined && <span className="font-bold text-fg">à {fmtMoment(v.at)}</span>}
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
  )
}

/** Ajout ou modification d'un lien : adresse, titre, moment. */
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
  const [moment, setMoment] = useState(video?.at !== undefined ? fmtMoment(video.at) : '')
  const [error, setError] = useState('')

  // Lien YouTube collé avec un moment (?t=95) : le moment est repris, s'il n'est pas déjà rempli.
  function fillMoment(u: string) {
    if (moment.trim()) return
    const c = cleanUrl(u)
    const t = 'url' in c ? momentInUrl(c.url) : undefined
    if (t) setMoment(fmtMoment(t))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const c = cleanUrl(url)
    if ('error' in c) return setError(c.error)
    const at = parseMoment(moment)
    if (at === null) return setError('Moment à écrire en minutes:secondes (12:30) ou heures:minutes:secondes (1:02:30).')
    if (others.some((o) => o.id !== video?.id && o.url === c.url && o.at === at)) return setError('Ce lien est déjà dans la liste.')
    const t = title.trim().slice(0, 200) || undefined
    if (video) await save<Video>('videos', { ...video, url: c.url, title: t, at })
    else await save<Video>('videos', { id: newId(), targetKind: kind, targetId, url: c.url, title: t, at })
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
      <div className="grid grid-cols-[1fr_5.5rem] gap-2">
        <input className="field" placeholder="Titre (facultatif)" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        <input
          className="field"
          placeholder="à mm:ss"
          aria-label="Moment à regarder (minutes:secondes)"
          value={moment}
          onChange={(e) => (setMoment(e.target.value), setError(''))}
        />
      </div>
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
