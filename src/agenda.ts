import { fixtureHeading, safeUrl, youthsText } from './rencontres'

/*
 * « Ajouter à mon agenda » : un fichier .ics (RFC 5545) fabriqué sur l'appareil, pour un événement (menu ⋮ de sa page)
 * ou une rencontre (« Autour de moi »). Fichier pur (ni React ni DOM) : testé par tools/test-agenda.ts. Partage ou
 * téléchargement du fichier : src/agendaFile.ts. Rien n'est envoyé nulle part (pas de lien Google Agenda).
 *
 *  - icsFor : un VCALENDAR (PRODID, VERSION 2.0) avec un VEVENT : UID stable (« <identifiant>@nextar » : le même fichier
 *    rajouté met à jour l'entrée au lieu d'en créer une autre), DTSTAMP, DTSTART / DTEND en UTC (Z) ; sans heure connue,
 *    journée entière (VALUE=DATE, fin exclue = le lendemain). SUMMARY, LOCATION, GEO, URL, DESCRIPTION ; rappel (VALARM,
 *    DISPLAY) 2 h avant, seulement quand l'heure est connue. Textes échappés (\\ ; , et retours à la ligne), lignes pliées
 *    à 75 octets sans couper un caractère UTF-8, fins de ligne CRLF.
 *  - eventIcs : le fichier d'un événement. JAMAIS le nom d'un jeune : les agendas se synchronisent dans les nuages de
 *    Google ou d'Apple. Par construction, seuls sont lus le nom de l'événement, son jour, son heure, son lieu, la
 *    rencontre (compétition, niveau, coordonnées de la salle) et le NOMBRE de joueurs de la liste (« 3 jeunes à voir »).
 *    Durée d'un événement à l'heure connue : 2 h (un match).
 */

const CRLF = '\r\n'
/** Longueur maximale d'une ligne (octets, sans le CRLF). */
export const FOLD_OCTETS = 75
/** Durée par défaut d'un événement dont l'heure est connue (un match) : 2 h. */
export const DEFAULT_MINUTES = 120
/** Rappel : 2 h avant. */
export const ALARM = '-PT2H'

/** Texte d'une propriété (TEXT) : \ ; , échappés, retours à la ligne en \n, caractères de contrôle retirés. */
export function escapeText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Cc}/gu, (c) => (c === '\n' || c === '\t' ? c : ''))
    .replace(/[\\;,]/g, (c) => `\\${c}`)
    .replace(/\n/g, '\\n')
}

/** Octets UTF-8 d'un point de code. */
const octets = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4)

/**
 * Ligne pliée (RFC 5545, 3.1) : au plus 75 octets par ligne, la suite sur des lignes qui commencent par une espace
 * (comptée dans les 75) ; jamais au milieu d'un caractère (on avance par point de code, paires de substitution comprises).
 */
export function foldLine(line: string, max = FOLD_OCTETS): string {
  const parts: string[] = []
  let cur = ''
  let n = 0
  let room = max
  for (const ch of line) {
    const b = octets(ch.codePointAt(0)!)
    if (n + b > room && cur) {
      parts.push(cur)
      cur = ''
      n = 0
      room = max - 1
    }
    cur += ch
    n += b
  }
  parts.push(cur)
  return parts.join(`${CRLF} `)
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** Instant en UTC : « 20261101T130000Z ». */
export const utcStamp = (d: Date) =>
  `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{1,2}):(\d{2})$/

/** Jour « AAAA-MM-JJ » valable → [année, mois, jour] ; sinon undefined. */
function parseDay(day: string): [number, number, number] | undefined {
  const m = DAY_RE.exec(day)
  if (!m) return undefined
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? [y, mo, d] : undefined
}

/** Jour d'une journée entière : « 20261101 » ; `plus` jours plus tard (fin exclue). */
export function dayStamp(day: string, plus = 0): string {
  const p = parseDay(day)
  if (!p) throw new Error(`Jour invalide : ${day}`)
  const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + plus))
  return `${pad(t.getUTCFullYear(), 4)}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`
}

/**
 * Début d'un événement à l'heure connue : jour et heure LOCAUX de l'appareil (comme ils sont saisis et affichés) → instant.
 * undefined si le jour ou l'heure ne sont pas valables.
 */
export function localStart(day: string, time?: string): Date | undefined {
  const p = parseDay(day)
  const t = time ? TIME_RE.exec(time.trim()) : null
  if (!p || !t) return undefined
  const [h, mi] = [Number(t[1]), Number(t[2])]
  if (h > 23 || mi > 59) return undefined
  return new Date(p[0], p[1] - 1, p[2], h, mi)
}

/** Identifiant stable pour l'agenda : « <identifiant>@nextar », réduit aux caractères sûrs. */
export const agendaUid = (id: string) => `${id.replace(/[^A-Za-z0-9._:-]/g, '-')}@nextar`

export interface IcsInput {
  /** Identifiant stable, sans domaine (agendaUid l'ajoute). */
  uid: string
  title: string
  /** Heure connue : l'instant de début. Journée entière (allDay) : le jour « AAAA-MM-JJ ». */
  start: Date | string
  /** Fin : instant (par défaut début + 2 h), ou dernier jour compris d'une journée entière (par défaut le même). */
  end?: Date | string
  allDay?: boolean
  location?: string
  geo?: { lat: number; lng: number }
  /** Adresse de la page dans l'appli (http ou https seulement). */
  url?: string
  description?: string
  /** DTSTAMP (essais) ; par défaut maintenant. */
  now?: Date
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** Fichier .ics d'un seul événement (texte, lignes CRLF). */
export function icsFor(x: IcsInput): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nextar//Agenda//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT']
  lines.push(`UID:${agendaUid(x.uid)}`, `DTSTAMP:${utcStamp(x.now ?? new Date())}`)
  const timed = !x.allDay
  if (timed) {
    if (!(x.start instanceof Date) || Number.isNaN(x.start.getTime())) throw new Error('Début invalide')
    const end = x.end instanceof Date && x.end.getTime() > x.start.getTime() ? x.end : new Date(x.start.getTime() + DEFAULT_MINUTES * 60_000)
    lines.push(`DTSTART:${utcStamp(x.start)}`, `DTEND:${utcStamp(end)}`)
  } else {
    const day = typeof x.start === 'string' ? x.start : ''
    const last = typeof x.end === 'string' && x.end > day ? x.end : day
    lines.push(`DTSTART;VALUE=DATE:${dayStamp(day)}`, `DTEND;VALUE=DATE:${dayStamp(last, 1)}`)
  }
  const title = x.title.trim() || 'Événement'
  lines.push(`SUMMARY:${escapeText(title)}`)
  if (x.location?.trim()) lines.push(`LOCATION:${escapeText(x.location.trim())}`)
  if (x.geo && finite(x.geo.lat) && finite(x.geo.lng) && Math.abs(x.geo.lat) <= 90 && Math.abs(x.geo.lng) <= 180)
    lines.push(`GEO:${x.geo.lat.toFixed(6)};${x.geo.lng.toFixed(6)}`)
  const url = safeUrl(x.url)
  if (url) lines.push(`URL:${url}`)
  if (x.description?.trim()) lines.push(`DESCRIPTION:${escapeText(x.description.trim())}`)
  if (timed) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(title)}`, `TRIGGER:${ALARM}`, 'END:VALARM')
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.map((l) => foldLine(l)).join(CRLF) + CRLF
}

// ---------- Fichier d'un événement ----------

/**
 * Ce que le fichier d'un événement peut lire, et RIEN d'autre (aucun champ de nom de joueur n'existe ici) : la liste
 * des joueurs ne sert qu'à compter.
 */
export interface AgendaEvent {
  id: string
  name: string
  type: string
  date: string
  time?: string
  place?: string
  playerIds?: readonly unknown[]
  rencontreId?: string
  rencontre?: { category?: string; level?: string; competition?: string; lat?: number; lng?: number }
}

const TYPE_SLUG: Record<string, string> = { match: 'match', tournoi: 'tournoi', entrainement: 'entrainement', observation: 'observation' }

/** Nom du fichier : « match-2026-11-01.ics » (type de l'événement, ASCII seulement). */
export const agendaFileName = (type: string, day: string) => `${TYPE_SLUG[type] ?? 'evenement'}-${DAY_RE.test(day) ? day : 'agenda'}.ics`

/** « 3 jeunes à voir » ; '' s'il n'y en a pas. */
export const youthsToSee = (n: number) => (n > 0 ? `${youthsText(n)} à voir` : '')

/**
 * Fichier d'agenda d'un événement : son jour (et son heure s'il en a une : 2 h, rappel 2 h avant ; sinon la journée),
 * son lieu, les coordonnées de la salle d'une rencontre, l'adresse de sa page (`url`), « N jeunes à voir » et la
 * compétition. UID : celui de la rencontre s'il en vient une (même entrée que le fichier pris depuis « Autour de moi »),
 * sinon celui de l'événement. null si le jour n'est pas valable.
 */
export function eventIcs(ev: AgendaEvent, opts: { url?: string; now?: Date; youths?: number } = {}): { ics: string; fileName: string } | null {
  if (!parseDay(ev.date)) return null
  const start = localStart(ev.date, ev.time)
  const r = ev.rencontre
  const n = opts.youths ?? (Array.isArray(ev.playerIds) ? ev.playerIds.length : 0)
  const heading = r ? fixtureHeading(r) : ''
  const description = [youthsToSee(n), heading].filter(Boolean).join('\n')
  const ics = icsFor({
    uid: ev.rencontreId || ev.id,
    title: ev.name,
    start: start ?? ev.date,
    allDay: !start,
    location: ev.place,
    geo: r && finite(r.lat) && finite(r.lng) ? { lat: r.lat, lng: r.lng } : undefined,
    url: opts.url,
    description,
    now: opts.now,
  })
  return { ics, fileName: agendaFileName(ev.type, ev.date) }
}
