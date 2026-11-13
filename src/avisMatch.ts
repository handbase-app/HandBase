import type { EventType } from './db'
import { playerScore } from './compare'

/*
 * Avis de match enrichi (04/11, idée reprise de « Génération Bleue », la FFR) et résumé d'un joueur sur un événement
 * (vue Mosaïque de la page de l'événement). Fichier pur, testé par tools/test-avis-match.ts.
 *
 * Deux champs facultatifs de l'avis, libres dans data (jsonb) et gardés tels quels par le serveur (hb_upsert) : pas de SQL.
 * - superPower : « Super-pouvoir observé », une phrase courte et positive (« sa lecture du jeu », « son premier pas »).
 * - playingTime : temps de jeu en minutes (nombre entier), seulement sur un avis de match ou de tournoi. Jamais de case
 *   blessure (donnée de santé d'un mineur : décision du 04/11).
 * Un avis d'avant (sans ces champs) se lit comme « non renseigné ».
 */

/** Longueur maximale du super-pouvoir (une phrase courte). */
export const SUPER_POWER_MAX = 80
/** Temps de jeu au plus (minutes) : un tournoi peut compter plusieurs matchs. */
export const PLAYING_TIME_MAX = 600

/** Champs lus ici (un avis complet, ou un brouillon de l'écran de notation). */
export interface AvisMatchFields {
  playerId?: string
  observer?: string
  scores?: Record<string, number | string>
  review?: 'pending' | 'validated' | 'refused'
  superPower?: unknown
  playingTime?: unknown
}

/** Le temps de jeu se saisit sur un avis rattaché à un match ou à un tournoi. */
export const hasPlayingTime = (type?: EventType | string | null) => type === 'match' || type === 'tournoi'

/** Super-pouvoir propre (espaces resserrés, coupé à SUPER_POWER_MAX) ; vide ou absent : undefined. */
export function superPowerOf(e: Pick<AvisMatchFields, 'superPower'>): string | undefined {
  if (typeof e.superPower !== 'string') return undefined
  const s = e.superPower.replace(/\s+/g, ' ').trim().slice(0, SUPER_POWER_MAX).trim()
  return s || undefined
}

/** Temps de jeu lu : entier de 0 à PLAYING_TIME_MAX ; tout le reste (vide, texte, négatif…) : non renseigné. */
export function playingTimeOf(e: Pick<AvisMatchFields, 'playingTime'>): number | undefined {
  const v = e.playingTime
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  const n = Math.round(v)
  return n >= 0 && n <= PLAYING_TIME_MAX ? n : undefined
}

/** Saisie du temps de jeu (pavé numérique) : chiffres seulement ; vide = non renseigné ; borné à PLAYING_TIME_MAX. */
export function parsePlayingTime(text: string): number | undefined {
  const digits = text.replace(/\D/g, '').slice(0, 3)
  if (!digits) return undefined
  return Math.min(PLAYING_TIME_MAX, Number(digits))
}

/** Boutons ± du temps de jeu : pas de 5 minutes (vide : « + » met 5, « − » ne fait rien), bornés à 0…PLAYING_TIME_MAX. */
export function stepPlayingTime(v: number | undefined, dir: 1 | -1, step = 5): number | undefined {
  if (v === undefined) return dir > 0 ? step : undefined
  // Hors du pas (37 min tapées) : on se cale d'abord sur le multiple voisin.
  const next = dir > 0 ? Math.floor(v / step) * step + step : Math.ceil(v / step) * step - step
  return Math.max(0, Math.min(PLAYING_TIME_MAX, next))
}

/** « 40 min », « 1 h 10 » (au-delà d'une heure). */
export function fmtPlayingTime(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

/** Résumé des avis d'un joueur sur un événement (vignette de la vue Mosaïque). */
export interface EventPlayerSummary {
  /** Avis listés (validés ou en attente ; un avis hors cadre ne se montre pas). */
  n: number
  /** Note : moyenne des évaluateurs (chacun : moyenne de ses critères), avis validés seulement, comme le classement. */
  avg: number | null
  /** Évaluateurs qui ont donné une note (même calcul). */
  observers: number
  /** Temps de jeu : moyenne arrondie des avis qui l'indiquent (souvent un seul) ; sinon null. */
  playingTime: number | null
  /** Super-pouvoirs observés, sans doublon (casse et accents ignorés), dans l'ordre des avis. */
  superPowers: string[]
}

const key = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Résumé d'un joueur sur un événement, à partir des avis de l'événement (tous joueurs confondus, supprimés retirés). */
export function eventPlayerSummary<E extends AvisMatchFields>(evals: E[], playerId: string): EventPlayerSummary {
  const mine = evals.filter((e) => e.playerId === playerId && e.review !== 'refused')
  const counted = mine.filter((e) => (e.review ?? 'validated') === 'validated')
  const s = playerScore(counted.map((e) => ({ observer: e.observer ?? '', scores: e.scores ?? {} })) as unknown as Parameters<typeof playerScore>[0])
  const times = mine.map(playingTimeOf).filter((v): v is number => v !== undefined)
  const seen = new Set<string>()
  const superPowers: string[] = []
  for (const e of mine) {
    const sp = superPowerOf(e)
    if (!sp || seen.has(key(sp))) continue
    seen.add(key(sp))
    superPowers.push(sp)
  }
  return {
    n: mine.length,
    avg: s?.avg ?? null,
    observers: s?.observers ?? 0,
    playingTime: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    superPowers,
  }
}

/** Note affichée comme au classement : une décimale, virgule française (« 3,5 »). */
export const fmtAvg = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
