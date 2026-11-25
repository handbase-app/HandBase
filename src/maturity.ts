/*
 * Estimations de maturité et de taille adulte (calculées, jamais saisies).
 *
 * Sources (coefficients vérifiés sur au moins deux sources indépendantes) :
 *  - Mirwald et al. (2002) Med Sci Sports Exerc 34(4):689-694 — décalage par rapport au pic de croissance (PHV).
 *  - Moore et al. (2015) Med Sci Sports Exerc 47(8):1755-1764 — version simplifiée de Mirwald.
 *    Équations reproduites dans Kozieł & Malina (2018), PMC5752743.
 *  - Fransen et al. (2018) Pediatr Exerc Sci 30(2):296-307 — « maturity ratio » (âge / âge au pic), GARÇONS seulement
 *    (construit sur Mirwald + 1 330 footballeurs belges de 8 à 17 ans). Coefficients à pleine précision relus sur le
 *    manuscrit accepté des auteurs (dépôt UTS, opus.lib.uts.edu.au/handle/10453/110385, équation l. 264-270) et sur
 *    Salter et al. (2021) Sci Med Football, annexe 1 (ray.yorksj.ac.uk/id/eprint/5319), recoupés par la fiche NOC*NSF
 *    « biologische leeftijd » (2021). DOI 10.1123/pes.2017-0009. Constante POSITIVE (PMC8343060 imprime un moins
 *    par erreur). Taille³ :
 *    −0,000001656585 (l'arrondi à 0,000002 décale le ratio de plus de 1, donc inutilisable).
 *  - Khamis & Roche (1994) Pediatrics 94:504-507, coefficients du poids corrigés par l'erratum
 *    Pediatrics 1995;95:457 (table reprise de uwmsk.org/stature.html, université de Washington).
 *  - Epstein et al. (1995) : correction des tailles parentales déclarées (surestimées).
 *  - Cumming et al. (2017) : stades selon le % de taille adulte (bio-banding).
 *  - Sherar et al. (2005) J Pediatr 147:508-514 : taille adulte sans les parents (croissance restante selon le
 *    décalage au pic), table de la fiche de détection du staff, garçons.
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

/**
 * Fransen 2018 (garçons) : ratio de maturité = âge / âge au pic. Renvoie le décalage (âge − âge au pic), comme
 * Mirwald et Moore. Nécessite taille, taille assise (jambes = taille − assise) et poids. Filles : non applicable.
 */
export function fransenRatio({ sex, age, height, sitting, weight }: OffsetInput): number | null {
  if (sex !== 'M' || sitting === undefined || weight === undefined) return null
  const leg = height - sitting
  if (leg <= 0) return null
  return (
    6.986547255416 +
    0.115802846632 * age +
    0.001450825199 * age ** 2 +
    0.004518400406 * weight -
    0.000034086447 * weight ** 2 -
    0.151951447289 * height +
    0.000932836659 * height ** 2 -
    0.000001656585 * height ** 3 +
    0.032198263733 * leg -
    0.000269025264 * leg ** 2 -
    0.000760897942 * height * age
  )
}
export function fransen(input: OffsetInput): number | null {
  const r = fransenRatio(input)
  if (r === null || r <= 0) return null
  return input.age - input.age / r
}

/** Moyenne des décalages disponibles (Mirwald, Moore, Fransen) et nombre de modèles utilisés. */
export function meanOffset(offsets: (number | null)[]): { offset: number; n: number } | null {
  const v = offsets.filter((x): x is number => x !== null && Number.isFinite(x))
  return v.length ? { offset: v.reduce((a, b) => a + b, 0) / v.length, n: v.length } : null
}

/** Taille assise plausible : 45 à 60 % de la taille (au-delà, le banc a sans doute été compté). */
export const sittingPlausible = (height: number, sitting: number) => sitting / height >= 0.45 && sitting / height <= 0.6

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

// ---------- Taille adulte sans les parents : croissance restante (type Sherar 2005) ----------

/**
 * Croissance restante (cm) selon le décalage au pic et la catégorie de maturité, GARÇONS.
 * Source : fiche de détection du staff, méthode de Sherar et al. (2005) J Pediatr 147:508-514 (« cumulative height
 * velocity curves ») : taille adulte = taille actuelle + croissance restante, lue selon le décalage et la catégorie
 * (âge au pic < 13 ans : avancée ; < 15 : normale ; sinon retardée ; moyenne garçons 14 ± 1 an, comme Sherar).
 * Valeurs reprises de la fiche, à confirmer sur l'article. Table construite avec le décalage de Mirwald : pour Moore
 * et Fransen, indicatif. Marge ≈ ±5 cm. Pas de table filles.
 * Validation : le calculateur de taille adulte de l'université de la Saskatchewan donne, pour un garçon fictif de
 * 13,0 ans, 155 cm, assis 80 cm, 45 kg, maturité normale, 25 cm restants, 180 cm adulte (86,1 %) ; avec cette table,
 * décalage Mirwald −1,063 interpolé → 24,76 cm → 179,8 cm (test dans tools/test-maturity.ts).
 * Ligne i = décalage −4 + 0,2 × i (de −4 à +4) ; colonnes : avancée (précoce), normale, retardée (tardive).
 */
const SHERAR_REMAINING_M: readonly (readonly [number, number, number])[] = [
  [45.29, 40.09, 34.73], // -4,0
  [44.21, 39.08, 33.83], // -3,8
  [43.11, 38.08, 32.94], // -3,6
  [41.99, 37.06, 32.05], // -3,4
  [40.85, 36.06, 31.16], // -3,2
  [39.69, 35.04, 30.27], // -3,0
  [38.52, 34.04, 29.38], // -2,8
  [37.33, 33.05, 28.49], // -2,6
  [36.15, 32.06, 27.6], // -2,4
  [34.97, 31.07, 26.7], // -2,2
  [33.8, 30.06, 25.77], // -2,0
  [32.62, 29.03, 24.79], // -1,8
  [31.44, 27.95, 23.73], // -1,6
  [30.23, 26.83, 22.63], // -1,4
  [28.98, 25.63, 21.45], // -1,2
  [27.66, 24.36, 20.22], // -1,0
  [26.24, 22.99, 18.96], // -0,8
  [24.68, 21.51, 17.68], // -0,6
  [22.96, 19.88, 16.31], // -0,4
  [21.07, 18.09, 14.76], // -0,2
  [19.04, 16.16, 13.05], // 0,0
  [16.96, 14.21, 11.32], // +0,2
  [14.92, 12.35, 9.71], // +0,4
  [13.01, 10.6, 8.27], // +0,6
  [11.26, 9.12, 6.94], // +0,8
  [9.7, 7.78, 5.7], // +1,0
  [8.33, 6.59, 4.54], // +1,2
  [7.11, 5.54, 3.51], // +1,4
  [6.04, 4.62, 2.64], // +1,6
  [5.1, 3.8, 1.92], // +1,8
  [4.26, 3.09, 1.35], // +2,0
  [3.52, 2.48, 0.91], // +2,2
  [2.86, 1.96, 0.58], // +2,4
  [2.29, 1.52, 0.32], // +2,6
  [1.78, 1.16, 0.13], // +2,8
  [1.34, 0.87, 0.0], // +3,0
  [0.96, 0.63, 0.0], // +3,2
  [0.64, 0.43, 0.0], // +3,4
  [0.37, 0.27, 0.0], // +3,6
  [0.16, 0.12, 0.0], // +3,8
  [0.0, 0.0, 0.0], // +4,0
]
const SHERAR_MIN = -4
const SHERAR_STEP = 0.2

export type SherarCategory = 'avancee' | 'normale' | 'retardee'
export const SHERAR_CATEGORY_LABEL: Record<SherarCategory, string> = { avancee: 'Avancée', normale: 'Normale', retardee: 'Retardée' }
/** Catégorie de la fiche (garçons) : âge au pic < 13 ans avancée, < 15 normale, sinon retardée. */
export const sherarCategory = (aphv: number): SherarCategory => (aphv < 13 ? 'avancee' : aphv < 15 ? 'normale' : 'retardee')

/**
 * Croissance restante (cm) d'un garçon, ou null si le décalage sort de [−4, +4].
 * Interpolation LINÉAIRE entre deux lignes (par défaut). La fiche Excel prend la ligne inférieure (RECHERCHEV
 * approchée : mode 'ligne'). L'écart entre les deux est de quelques millimètres loin du pic, mais peut approcher 2 cm
 * autour du pic (jusqu'à 2,03 cm d'une ligne à l'autre, entre −0,2 et 0, maturité avancée).
 */
export function remainingGrowth(offset: number, aphv: number, mode: 'interpole' | 'ligne' = 'interpole'): number | null {
  if (!Number.isFinite(offset) || !Number.isFinite(aphv)) return null
  const x = (offset - SHERAR_MIN) / SHERAR_STEP
  const last = SHERAR_REMAINING_M.length - 1
  if (x < -1e-9 || x > last + 1e-9) return null
  const col = { avancee: 0, normale: 1, retardee: 2 }[sherarCategory(aphv)]
  const i = Math.min(last, Math.max(0, Math.floor(x + 1e-9)))
  const lo = SHERAR_REMAINING_M[i][col]
  if (mode === 'ligne' || i === last) return lo
  return lo + (SHERAR_REMAINING_M[i + 1][col] - lo) * Math.max(0, x - i)
}

/** Taille adulte (cm) = taille + croissance restante. Garçons seulement (table filles non disponible : null). */
export function sherarAdultHeight({ height, offset, aphv, sex }: { height: number; offset: number; aphv: number; sex: Sex }): number | null {
  if (sex !== 'M') return null
  const r = remainingGrowth(offset, aphv)
  return r === null ? null : height + r
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

/**
 * % de taille adulte à l'écran (et à l'export) : plafonné à 100 (le calcul peut dépasser quand la taille mesurée dépasse
 * la prédiction ; « 101 % atteint » n'a pas de sens). Le résultat du calcul (KRResult.pah) n'est pas modifié.
 */
export const pahShown = (pah: number) => Math.min(100, pah)
/** « 87 % atteint », ou « taille adulte atteinte » à 100 % et au-delà (arrondi compris). */
export const pahText = (pah: number) => (Math.round(pah) >= 100 ? 'taille adulte atteinte' : `${Math.round(pah)} % atteint`)

/** Stades selon le % de taille adulte (Cumming et al. 2017). */
export type Stage = 'prepubere' | 'debut' | 'milieu' | 'fin'
export const stage = (pah: number): Stage => (pah < 85 ? 'prepubere' : pah < 90 ? 'debut' : pah < 95 ? 'milieu' : 'fin')
export const STAGE_LABEL: Record<Stage, string> = {
  prepubere: 'Pré-pubère',
  debut: 'Début de puberté',
  milieu: 'Milieu de puberté (pic)',
  fin: 'Fin de puberté',
}
