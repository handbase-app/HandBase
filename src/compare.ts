import type { Criterion, Evaluation } from './db'

/*
 * Calculs de la comparaison de deux joueurs (écran /comparer) et de la note du classement d'un événement.
 */

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)

/** Écart sous lequel deux moyennes d'avis sont jugées à égalité. */
export const TIE = 0.3
/** Écart à partir duquel un joueur est « clairement devant » (points forts). */
export const CLEAR = 0.5

/** Note d'un joueur : moyenne des évaluateurs (chacun : moyenne de ses critères), comme le classement. */
export function playerScore(evs: Evaluation[]) {
  const perObserver = new Map<string, number[]>()
  for (const e of evs) {
    const v = mean(Object.values(e.scores).filter((x): x is number => typeof x === 'number'))
    if (v === null) continue
    if (!perObserver.has(e.observer)) perObserver.set(e.observer, [])
    perObserver.get(e.observer)!.push(v)
  }
  const vals = [...perObserver.values()].map((xs) => mean(xs)!)
  if (!vals.length) return null
  return { avg: mean(vals)!, observers: vals.length, spread: Math.max(...vals) - Math.min(...vals) }
}

/** Moyenne d'un critère : chaque observateur pèse pareil (moyenne de ses avis), puis moyenne des observateurs. */
export function criterionMean(evs: Evaluation[], criterionId: string): number | null {
  const byObs = new Map<string, number[]>()
  for (const e of evs) {
    const v = e.scores[criterionId]
    if (typeof v !== 'number') continue
    byObs.set(e.observer, [...(byObs.get(e.observer) ?? []), v])
  }
  return mean([...byObs.values()].map((vs) => mean(vs)!))
}

// Sens des mesures livrées par défaut (src/criteria.ts) : un temps de course, plus petit = meilleur ;
// un saut, une charge, une vitesse, plus grand = meilleur. Gabarit, mensurations, amplitudes en degrés
// et EUR (zone idéale) : pas de « meilleur ».
const LOWER = new Set(['sprint_5', 'sprint_10', 'sprint_30', 't_test', 'illinois', 'rsa_moyen', 'rsa_fatigue'])
const HIGHER = new Set([
  'vift',
  'vma',
  'saut_bilateral',
  'saut_largeur_g',
  'saut_largeur_d',
  'medball_conc',
  'medball_plio',
  'dorsi_g',
  'dorsi_d',
  'shirado',
  'sorensen',
  'sj_hauteur',
  'sj_puissance',
  'cmj_hauteur',
  'cmj_bras',
  'cmj_puissance',
  'cmj_rsi',
  'dj30',
  'dj40',
  'dj50',
  'rsi_dj30',
  'rsi_dj40',
  'rsi_dj50',
  'rm6_squat',
  'rm6_bench',
  'rm6_dl',
  'rm1_clean',
  'rm6_traction',
  'rm6_hipthrust',
])

/**
 * Sens d'une mesure : 1 = plus grand est meilleur, −1 = plus petit est meilleur, 0 = inconnu (pas de vert).
 * Les critères n'ont pas de sens enregistré : il est connu pour les critères livrés, et déduit prudemment
 * pour les autres (une note, une vitesse en km/h, une puissance en W/kg) ; un temps en secondes reste
 * inconnu (sprint : plus petit ; gainage : plus grand).
 */
export function measureDirection(c: Criterion): 1 | -1 | 0 {
  if (LOWER.has(c.id)) return -1
  if (HIGHER.has(c.id)) return 1
  if (c.scale === 'score5' || c.scale === 'score3' || c.scale === 'score2') return 1
  if (c.unit === 'km/h' || c.unit === 'W/kg') return 1
  return 0
}
