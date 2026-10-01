/*
 * Estimations de maturité et de taille adulte (calculées, jamais saisies).
 *
 * Sources (coefficients vérifiés sur au moins deux sources indépendantes) :
 *  - Mirwald et al. (2002) Med Sci Sports Exerc 34(4):689-694 — décalage par rapport au pic de croissance (PHV).
 *  - Moore et al. (2015) Med Sci Sports Exerc 47(8):1755-1764 — version simplifiée de Mirwald.
 *    Équations reproduites dans Kozieł & Malina (2018), PMC5752743.
 *  - Khamis & Roche (1994) Pediatrics 94:504-507, coefficients du poids corrigés par l'erratum
 *    Pediatrics 1995;95:457 (table reprise de uwmsk.org/stature.html, université de Washington).
 *  - Epstein et al. (1995) : correction des tailles parentales déclarées (surestimées).
 *  - Cumming et al. (2017) : stades selon le % de taille adulte (bio-banding).
 */

export type Sex = 'M' | 'F'

export const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

/** Âge décimal (années) à une date donnée. */
export function decimalAge(birthDate: string, on: string): number | null {
  const b = new Date(birthDate + 'T00:00:00').getTime()
  const d = new Date(on + 'T00:00:00').getTime()
  if (isNaN(b) || isNaN(d) || d < b) return null
  return (d - b) / (365.25 * 24 * 3600 * 1000)
}

// ---------- Décalage de maturité (années par rapport au pic de croissance) ----------

export interface OffsetInput {
  sex: Sex
  age: number
  height: number // cm
  sitting?: number // taille assise, cm
  weight?: number // kg
}

/** Mirwald 2002 : nécessite taille, taille assise et poids. */
export function mirwald({ sex, age, height, sitting, weight }: OffsetInput): number | null {
  if (sitting === undefined || weight === undefined) return null
  const leg = height - sitting
  if (leg <= 0) return null
  const wh = (weight / height) * 100
  if (sex === 'M')
    return -9.236 + 0.0002708 * leg * sitting - 0.001663 * age * leg + 0.007216 * age * sitting + 0.02292 * wh
  return -9.376 + 0.0001882 * leg * sitting + 0.0022 * age * leg + 0.005841 * age * sitting - 0.002658 * age * weight + 0.07693 * wh
}

/** Moore 2015 : garçons avec taille assise (sinon variante avec la taille), filles avec la taille. */
export function moore({ sex, age, height, sitting }: OffsetInput): number {
  if (sex === 'F') return -7.709133 + 0.0042232 * age * height
  if (sitting !== undefined) return -8.128741 + 0.0070346 * age * sitting
  return -7.999994 + 0.0036124 * age * height
}

/** Âge moyen au pic de croissance (populations de référence) et écart-type approximatif. */
export const MEAN_APHV: Record<Sex, number> = { M: 13.8, F: 11.8 }
const APHV_SD = 1

export type Timing = 'precoce' | 'norme' | 'tardif'
export function timing(sex: Sex, aphv: number): Timing {
  if (aphv < MEAN_APHV[sex] - APHV_SD) return 'precoce'
  if (aphv > MEAN_APHV[sex] + APHV_SD) return 'tardif'
  return 'norme'
}
export const TIMING_LABEL: Record<Timing, string> = { precoce: 'Précoce', norme: 'Dans la norme', tardif: 'Tardif' }

/** Phase par rapport au pic, avec le seuil prudent de ±1 an (erreur des équations). */
export type Phase = 'avant' | 'autour' | 'apres'
export const phase = (offset: number): Phase => (offset < -1 ? 'avant' : offset > 1 ? 'apres' : 'autour')
export const PHASE_LABEL: Record<Phase, string> = { avant: 'Avant le pic', autour: 'Autour du pic', apres: 'Après le pic' }

/** Les équations ont été construites sur des 8–16 ans et perdent en précision loin du pic. */
export function offsetReliable(age: number, offset: number) {
  return age >= 8 && age <= 16.5 && Math.abs(offset) <= 2
}

// ---------- Khamis-Roche : taille adulte prédite ----------

// Index 0 = 4,0 ans, puis par demi-année jusqu'à 17,5 ans (28 valeurs). Unités : pouces et livres.
const KR = {
  M: {
    b0: [-10.2567, -10.719, -11.0213, -11.1556, -11.1138, -11.0221, -10.9984, -11.0214, -11.0696, -11.122, -11.1571, -11.1405, -11.038, -10.8286, -10.4917, -10.0065, -9.3522, -8.6055, -7.8632, -7.1348, -6.4299, -5.7578, -5.1282, -4.5092, -3.9292, -3.4873, -3.283, -3.4156],
    height: [1.23812, 1.15964, 1.10674, 1.0748, 1.05923, 1.05542, 1.05877, 1.06467, 1.06853, 1.06572, 1.05166, 1.02174, 0.97135, 0.89589, 0.81239, 0.74134, 0.68325, 0.63869, 0.60818, 0.59228, 0.59151, 0.60643, 0.63757, 0.68548, 0.75069, 0.83375, 0.9352, 1.05558],
    weight: [-0.087235, -0.074454, -0.064778, -0.05776, -0.052947, -0.049892, -0.048144, -0.047256, -0.046778, -0.046261, -0.045254, -0.043311, -0.039981, -0.034814, -0.02905, -0.024167, -0.020076, -0.016681, -0.013895, -0.011624, -0.009776, -0.008261, -0.006988, -0.005863, -0.004795, -0.003695, -0.00247, -0.001027],
    midparent: [0.50286, 0.52887, 0.53919, 0.53691, 0.52513, 0.50692, 0.48538, 0.46361, 0.44469, 0.43171, 0.42776, 0.43593, 0.45932, 0.50101, 0.54781, 0.58409, 0.60927, 0.62279, 0.62407, 0.61253, 0.58762, 0.54875, 0.49536, 0.42687, 0.34271, 0.24231, 0.1251, -0.0095],
    /** Marge d'erreur à 90 % (pouces), donnée par les auteurs. */
    error90: 2.101,
  },
  F: {
    b0: [-8.1325, -6.47656, -5.13582, -4.13791, -3.51039, -3.14322, -2.87645, -2.66291, -2.45559, -2.20728, -1.87098, -1.0633, 0.33468, 1.97366, 3.50436, 4.57747, 4.84365, 4.27869, 3.21417, 1.83456, 0.32425, -1.13224, -2.35055, -3.10326, -3.17885, -2.41657, -0.65579, 2.26429],
    height: [1.24768, 1.22177, 1.19932, 1.1788, 1.15866, 1.13737, 1.11342, 1.08525, 1.05135, 1.01018, 0.9602, 0.89989, 0.82771, 0.74213, 0.67173, 0.6415, 0.64452, 0.67386, 0.7226, 0.78383, 0.85062, 0.91605, 0.97319, 1.01514, 1.03496, 1.02573, 0.98054, 0.89246],
    weight: [-0.19435, -0.18519, -0.1753, -0.16484, -0.154, -0.14294, -0.13184, -0.12086, -0.11019, -0.09999, -0.09044, -0.08171, -0.07397, -0.06739, -0.06136, -0.05518, -0.04894, -0.04272, -0.03661, -0.03067, -0.025, -0.01967, -0.01477, -0.01037, -0.00655, -0.0034, -0.001, 0.00057],
    midparent: [0.44774, 0.41381, 0.38467, 0.36039, 0.34105, 0.32672, 0.31748, 0.3134, 0.31457, 0.32105, 0.33291, 0.35025, 0.37312, 0.40161, 0.42042, 0.41686, 0.3949, 0.3585, 0.31163, 0.25826, 0.20235, 0.14787, 0.0988, 0.05909, 0.03272, 0.02364, 0.03584, 0.07327],
    error90: 1.675,
  },
}

const IN = 2.54
const LB = 0.45359237

/** Correction des tailles déclarées (Epstein et al. 1995), en pouces. */
export function correctedParentHeight(cm: number, parent: 'mere' | 'pere', reported: boolean): number {
  if (!reported) return cm
  const inches = cm / IN
  const corrected = parent === 'mere' ? 2.803 + 0.953 * inches : 2.316 + 0.955 * inches
  return corrected * IN
}

export interface KRInput {
  sex: Sex
  age: number
  height: number // cm
  weight: number // kg
  motherHeight: number // cm (déjà corrigée si déclarée)
  fatherHeight: number // cm (déjà corrigée si déclarée)
}

export interface KRResult {
  predicted: number // cm
  error90: number // ± cm
  pah: number // % de la taille adulte atteint
  remaining: number // cm restant à grandir
}

/** Khamis-Roche, de 4 à 17,5 ans (âge arrondi à la demi-année, comme la méthode d'origine). */
export function khamisRoche({ sex, age, height, weight, motherHeight, fatherHeight }: KRInput): KRResult | null {
  const half = Math.round(age * 2) / 2
  if (half < 4 || half > 17.5) return null
  const i = (half - 4) * 2
  const k = KR[sex]
  const midparent = (motherHeight + fatherHeight) / 2 / IN
  const inches = k.b0[i] + k.height[i] * (height / IN) + k.weight[i] * (weight / LB) + k.midparent[i] * midparent
  const predicted = inches * IN
  return { predicted, error90: k.error90 * IN, pah: (height / predicted) * 100, remaining: Math.max(0, predicted - height) }
}

/** Stades selon le % de taille adulte (Cumming et al. 2017). */
export type Stage = 'prepubere' | 'debut' | 'milieu' | 'fin'
export const stage = (pah: number): Stage => (pah < 85 ? 'prepubere' : pah < 90 ? 'debut' : pah < 95 ? 'milieu' : 'fin')
export const STAGE_LABEL: Record<Stage, string> = {
  prepubere: 'Pré-pubère',
  debut: 'Début de puberté',
  milieu: 'Milieu de puberté (pic)',
  fin: 'Fin de puberté',
}
