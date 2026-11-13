// Signe d'attente (partie pure, testée par tools/test-attente.ts) : durée habituelle de chaque sorte de demande à l'assistant,
// apprise sur l'appareil (moyenne glissante des durées réelles), avancée de la barre selon le temps écoulé, texte affiché.
// Le stockage (localStorage) et l'affichage sont dans src/aiWait.ts et src/components/Attente.tsx.

/** Durée supposée d'une demande tant que l'appareil n'en a pas mesuré (ms). */
export const DEFAULT_MS = 2500
/** Poids de la dernière mesure dans la moyenne glissante. */
const ALPHA = 0.3
/** Mesures gardées : au-delà, une coupure (téléphone en veille, réseau perdu) ne doit pas fausser la moyenne. */
const MIN_SAMPLE = 100
const MAX_SAMPLE = 60_000
/** La barre avance jusqu'à ce point pendant la durée habituelle, puis attend en avançant à peine. */
export const HOLD_AT = 0.9
const CREEP_TO = 0.96
/** Temps estimé montré seulement après assez de mesures, et si elles se ressemblent (écart moyen ≤ 35 % de la moyenne). */
const ETA_MIN_SAMPLES = 3
const ETA_MAX_SPREAD = 0.35

/** Durée habituelle d'une sorte de demande : moyenne glissante, écart moyen glissant, nombre de mesures. */
export type WaitStat = { avg: number; dev: number; n: number }
export type WaitStats = Record<string, WaitStat>

/** Ajoute une durée mesurée (ms) ; une valeur aberrante (moins de 0,1 s, plus d'une minute, pas un nombre) est ignorée. */
export function addSample(s: WaitStat | undefined, ms: number): WaitStat | undefined {
  if (!Number.isFinite(ms) || ms < MIN_SAMPLE || ms > MAX_SAMPLE) return s
  if (!s || !(s.n > 0)) return { avg: Math.round(ms), dev: 0, n: 1 }
  const avg = s.avg + ALPHA * (ms - s.avg)
  const dev = s.dev + ALPHA * (Math.abs(ms - s.avg) - s.dev)
  return { avg: Math.round(avg), dev: Math.round(dev), n: Math.min(s.n + 1, 999) }
}

/** Durée habituelle (ms) : la moyenne mesurée, sinon la valeur par défaut. */
export const expectedMs = (s: WaitStat | undefined) => (s && s.n > 0 && s.avg > 0 ? s.avg : DEFAULT_MS)

/**
 * Avancée de la barre (0 à 1) après `elapsed` ms, pour une durée habituelle `expected` : jusqu'à 90 % pendant la durée
 * habituelle (vite au début, plus doucement ensuite), puis presque à l'arrêt (96 % au plus). La fin (100 %) vient de la réponse.
 */
export function progressAt(elapsed: number, expected: number): number {
  const e = Math.max(expected, 1)
  const t = Math.max(elapsed, 0) / e
  if (t <= 1) return HOLD_AT * (1 - (1 - t) * (1 - t))
  return HOLD_AT + (CREEP_TO - HOLD_AT) * (1 - Math.exp(-(t - 1)))
}

/** Plus de deux fois la durée habituelle : on rassure. */
export const isSlow = (elapsed: number, expected: number) => elapsed > 2 * Math.max(expected, 1)

/** Texte court de l'attente. */
export const waitText = (elapsed: number, expected: number) => (isSlow(elapsed, expected) ? 'Encore un instant…' : 'Je cherche…')

/**
 * Temps estimé (« ≈ 2 s ») : seulement s'il reste juste (assez de mesures, durées régulières) et tant que la durée habituelle
 * n'est pas dépassée ; sinon rien (jamais de faux chiffre).
 */
export function etaText(s: WaitStat | undefined, elapsed: number): string | null {
  if (!s || s.n < ETA_MIN_SAMPLES || !(s.avg > 0) || s.dev / s.avg > ETA_MAX_SPREAD) return null
  if (elapsed > s.avg) return null
  const sec = s.avg / 1000
  return `≈ ${sec < 1 ? '1' : sec < 10 ? String(Math.round(sec)) : String(Math.round(sec / 5) * 5)} s`
}

/** Relit les durées gardées (texte du stockage) ; toute valeur douteuse est écartée. */
export function parseStats(raw: string | null | undefined): WaitStats {
  const out: WaitStats = {}
  if (!raw) return out
  let o: unknown
  try {
    o = JSON.parse(raw)
  } catch {
    return out
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out
  for (const [k, v] of Object.entries(o as Record<string, unknown>).slice(0, 30)) {
    const s = v as Partial<WaitStat> | null
    if (!/^[a-z_]{1,30}$/.test(k) || !s || typeof s !== 'object') continue
    const { avg, dev, n } = s
    if (typeof avg !== 'number' || typeof dev !== 'number' || typeof n !== 'number') continue
    if (!(avg >= MIN_SAMPLE && avg <= MAX_SAMPLE) || !(dev >= 0 && dev <= MAX_SAMPLE) || !(n >= 1)) continue
    out[k] = { avg: Math.round(avg), dev: Math.round(dev), n: Math.min(Math.floor(n), 999) }
  }
  return out
}
