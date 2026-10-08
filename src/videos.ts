import type { Video, VideoMoment } from './db'

/*
 * Liens vidéo (supabase/036_videos.sql) : on ne garde que l'adresse d'une vidéo (Rematch, YouTube, Handball TV,
 * Facebook, Dartfish…), jamais la vidéo elle-même. Ici : vérification du lien, source reconnue d'après le domaine (sans appel
 * à leurs services), moment à regarder (« 1:35 ») et lien qui s'ouvre à ce moment quand c'est possible (YouTube).
 */

export type VideoSource = 'youtube' | 'rematch' | 'handballtv' | 'facebook' | 'dartfish' | 'other'

const SOURCE_LABEL: Record<Exclude<VideoSource, 'other'>, string> = {
  youtube: 'YouTube',
  rematch: 'Rematch',
  handballtv: 'Handball TV',
  facebook: 'Facebook',
  dartfish: 'Dartfish',
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}
const isHost = (h: string, domain: string) => h === domain || h.endsWith('.' + domain)

/** Source d'un lien, d'après son domaine (rematch.tv et liens raccourcis de l'appli Rematch compris). */
export function videoSource(url: string): VideoSource {
  const h = host(url)
  const labels = h.split('.')
  if (['youtube.com', 'youtu.be', 'youtube-nocookie.com'].some((d) => isHost(h, d))) return 'youtube'
  // rematch.tv, www.rematch.tv, liens courts de l'appli (rematch.app.link…) : un élément du nom commence par « rematch ».
  if (labels.some((l) => l.startsWith('rematch'))) return 'rematch'
  if (labels.some((l) => l.startsWith('handballtv'))) return 'handballtv'
  if (['facebook.com', 'fb.watch', 'fb.com'].some((d) => isHost(h, d))) return 'facebook'
  // Dartfish : dartfish.tv (et sous-domaines), liens courts de partage dartfi.sh (vidéo ou collection de clips).
  if (['dartfish.tv', 'dartfi.sh'].some((d) => isHost(h, d))) return 'dartfish'
  return 'other'
}

/** « Rematch », « YouTube »… ; pour un autre site, son nom de domaine (« dailymotion.com »). */
export function sourceLabel(url: string) {
  const s = videoSource(url)
  return s === 'other' ? host(url).replace(/^(www|m)\./, '') || 'Lien' : SOURCE_LABEL[s]
}

/** Identifiant d'une vidéo YouTube (watch?v=, youtu.be/, shorts/, embed/, live/), sinon undefined. */
export function youtubeId(url: string): string | undefined {
  if (videoSource(url) !== 'youtube') return undefined
  try {
    const u = new URL(url)
    const id = isHost(u.hostname, 'youtu.be') ? u.pathname.split('/')[1] : (u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1])
    return id && /^[\w-]{6,20}$/.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

/** Miniature YouTube (servie par img.youtube.com) ; rien pour les autres sources. */
export const thumbnailOf = (url: string) => {
  const id = youtubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : undefined
}

/**
 * Lien saisi ou collé → adresse propre (https:// ajouté s'il manque), ou un message d'erreur.
 * Seulement http et https, sans identifiant dans l'adresse (comme le serveur, 036_videos.sql).
 */
export function cleanUrl(input: string): { url: string } | { error: string } {
  let s = input.trim()
  if (!s) return { error: 'Colle le lien de la vidéo.' }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return { error: 'Ce lien n’est pas valide.' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'Seuls les liens http ou https sont acceptés.' }
  if (u.username || u.password || !/^[a-z0-9.-]+$/i.test(u.hostname) || !u.hostname.includes('.')) return { error: 'Ce lien n’est pas valide.' }
  if (u.href.length > 2000) return { error: 'Lien trop long.' }
  return { url: u.href }
}

/** « 1:35 », « 1:02:03 » → secondes ; vide → undefined ; mal écrit → null. */
export function parseMoment(input: string): number | undefined | null {
  const s = input.trim().replace(/[hm]/gi, ':').replace(/s$/i, '').replace(/::+/g, ':')
  if (!s) return undefined
  const m = s.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/)
  if (!m) return null
  const [h, min, sec] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])]
  if (sec > 59 || (m[1] !== undefined && min > 59)) return null
  return h * 3600 + min * 60 + sec
}

/** Secondes → « 1:35 » ou « 1:02:03 ». */
export function fmtMoment(t: number) {
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Moment indiqué dans un lien YouTube collé (?t=95, ?t=1m35s, &start=95), en secondes. */
export function momentInUrl(url: string): number | undefined {
  if (videoSource(url) !== 'youtube') return undefined
  try {
    const u = new URL(url)
    const t = u.searchParams.get('t') ?? u.searchParams.get('start')
    if (!t) return undefined
    if (/^\d+s?$/.test(t)) return parseInt(t, 10)
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
    return m && (m[1] || m[2] || m[3]) ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : undefined
  } catch {
    return undefined
  }
}

export const MAX_MOMENTS = 20

/** Moments d'un lien : sa liste, sinon (ligne plus ancienne) son moment unique, sinon aucun. */
export function momentsOf(v: Pick<Video, 'at' | 'moments'>): VideoMoment[] {
  if (v.moments?.length) return v.moments
  return v.at !== undefined ? [{ at: v.at }] : []
}

/** Moments triés et bornés comme le serveur (037) + moment unique pour les anciennes versions (début du premier). */
export function withMoments(list: VideoMoment[]): Pick<Video, 'at' | 'moments'> {
  const moments = list
    .filter((m) => Number.isFinite(m.at) && m.at >= 0 && m.at < 360000)
    .map((m) => ({
      at: Math.floor(m.at),
      ...(m.dur && m.dur >= 1 && m.dur <= 600 ? { dur: Math.floor(m.dur) } : {}),
      ...(m.note?.trim() ? { note: m.note.trim().slice(0, 120) } : {}),
    }))
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_MOMENTS)
  return moments.length ? { at: moments[0].at, moments } : { at: undefined, moments: undefined }
}

/** « 1:00 · 15 s · contre-attaque ». */
export const momentLabel = (m: VideoMoment) => [fmtMoment(m.at), m.dur && `${m.dur} s`, m.note].filter(Boolean).join(' · ')

/** « à 1:00, 10:00 » (fil, suivis), ou rien. */
export function momentsShort(v: Pick<Video, 'at' | 'moments'>) {
  const ms = momentsOf(v)
  return ms.length ? `à ${ms.map((m) => fmtMoment(m.at)).join(', ')}` : ''
}

/**
 * Lecture dans l'appli (src/components/VideoPlayer.tsx) : comment lire ce lien, ou undefined quand il s'ouvre seulement sur
 * son site (Rematch, Handball TV, Facebook, Dartfish, Dailymotion, Google Drive…). Liste blanche : seuls YouTube
 * (youtube-nocookie.com) et Vimeo (player.vimeo.com) sont intégrés en cadre ; un fichier vidéo direct (.mp4, .webm, .m4v,
 * .mov, Dropbox compris) est lu par la balise <video> du navigateur. Toujours en https.
 */
export type Embed = { kind: 'youtube'; id: string } | { kind: 'vimeo'; id: string; hash?: string } | { kind: 'file'; src: string }

const VIDEO_FILE = /\.(mp4|webm|m4v|mov)$/i

export function embedOf(url: string): Embed | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  if (u.protocol !== 'https:' || u.username || u.password) return undefined
  const h = u.hostname.toLowerCase()
  const yt = youtubeId(url)
  if (yt) return { kind: 'youtube', id: yt }
  if (isHost(h, 'vimeo.com')) {
    // vimeo.com/123456, vimeo.com/123456/abcdef12 (non répertoriée), vimeo.com/channels/x/123456, player.vimeo.com/video/123456?h=…
    const m =
      h === 'player.vimeo.com'
        ? u.pathname.match(/^\/video\/(\d{3,12})\/?$/)
        : u.pathname.match(/^\/(?:channels\/[\w-]+\/|groups\/[\w-]+\/videos\/|showcase\/\d+\/video\/)?(\d{3,12})(?:\/([0-9a-f]{6,20}))?\/?$/)
    if (!m) return undefined
    const hash = m[2] ?? u.searchParams.get('h') ?? undefined
    return { kind: 'vimeo', id: m[1], hash: hash && /^[0-9a-f]{6,20}$/.test(hash) ? hash : undefined }
  }
  if (!VIDEO_FILE.test(u.pathname)) return undefined
  // Dropbox : lien de partage (dl=0, page de prévisualisation) → le fichier lui-même (raw=1).
  if (isHost(h, 'dropbox.com')) {
    u.searchParams.delete('dl')
    u.searchParams.set('raw', '1')
    return { kind: 'file', src: u.href }
  }
  // Google Drive et sources connues (Facebook…) : pas de lien direct fiable, on ouvre leur page.
  if (videoSource(url) !== 'other' || isHost(h, 'google.com')) return undefined
  return { kind: 'file', src: u.href }
}

/** Lien à ouvrir : YouTube démarre au moment demandé (paramètre t=), par défaut le premier ; les autres sources tel quel. */
export function openUrl(v: Pick<Video, 'url' | 'at'>, at = v.at) {
  if (!/^https?:\/\//i.test(v.url)) return undefined // jamais autre chose que http(s)
  if (!at || videoSource(v.url) !== 'youtube') return v.url
  try {
    const u = new URL(v.url)
    u.searchParams.delete('start')
    u.searchParams.set('t', `${Math.floor(at)}s`)
    return u.href
  } catch {
    return v.url
  }
}
