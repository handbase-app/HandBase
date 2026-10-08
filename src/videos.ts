import type { Video } from './db'

/*
 * Liens vidéo (supabase/036_videos.sql) : on ne garde que l'adresse d'une vidéo (Rematch, YouTube, Handball TV,
 * Facebook…), jamais la vidéo elle-même. Ici : vérification du lien, source reconnue d'après le domaine (sans appel
 * à leurs services), moment à regarder (« 1:35 ») et lien qui s'ouvre à ce moment quand c'est possible (YouTube).
 */

export type VideoSource = 'youtube' | 'rematch' | 'handballtv' | 'facebook' | 'other'

const SOURCE_LABEL: Record<Exclude<VideoSource, 'other'>, string> = {
  youtube: 'YouTube',
  rematch: 'Rematch',
  handballtv: 'Handball TV',
  facebook: 'Facebook',
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

/** Lien à ouvrir : YouTube démarre au moment indiqué (paramètre t=) ; les autres sources tel quel. */
export function openUrl(v: Pick<Video, 'url' | 'at'>) {
  if (!/^https?:\/\//i.test(v.url)) return undefined // jamais autre chose que http(s)
  if (!v.at || videoSource(v.url) !== 'youtube') return v.url
  try {
    const u = new URL(v.url)
    u.searchParams.delete('start')
    u.searchParams.set('t', `${Math.floor(v.at)}s`)
    return u.href
  } catch {
    return v.url
  }
}
