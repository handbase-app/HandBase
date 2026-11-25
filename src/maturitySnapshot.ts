// Estimations de maturité par date de taille (snapshots), sans JSX : utilisées par la fiche (MaturityCard), l'export,
// les alertes et la comparaison, et testées par tools/test-maturity.ts.
import type { Measurement, Player } from './db'
import { correctedParentHeight, decimalAge, fransen, khamisRoche, meanOffset, mirwald, moore, sherarAdultHeight, type KRResult, type Sex } from './maturity'

/**
 * Écart maximal (jours) entre la taille et la taille assise / le poids utilisés avec elle : 0, même jour. Un jeune peut
 * prendre 10 cm en deux mois (vacances d'été) : une taille assise d'une autre date fausse les jambes calculées.
 */
export const PAIR_MAX_DAYS = 0

const dayDiff = (a: string, b: string) => Math.abs(new Date(a + 'T00:00:00').getTime() - new Date(b + 'T00:00:00').getTime()) / 86_400_000

/** Valeur numérique la plus récente d'un critère à une date donnée (incluse). */
function valueAt(ms: Measurement[], criterionId: string, date: string): number | undefined {
  let best: Measurement | undefined
  for (const m of ms)
    if (m.criterionId === criterionId && typeof m.value === 'number' && m.date <= date && (!best || m.date > best.date)) best = m
  return best?.value as number | undefined
}

/**
 * Mesure d'un critère prise à la même date (PAIR_MAX_DAYS jours d'écart au plus, avant ou après ; à égalité, la plus
 * ancienne). Les équations supposent taille, taille assise et poids pris ensemble : on n'associe pas une taille
 * d'aujourd'hui à une taille assise d'il y a un an (les jambes calculées seraient fausses).
 */
export function valueNear(ms: Measurement[], criterionId: string, date: string): number | undefined {
  let best: Measurement | undefined
  let bestGap = Infinity
  for (const m of ms) {
    if (m.criterionId !== criterionId || typeof m.value !== 'number') continue
    const gap = dayDiff(m.date, date)
    if (gap > PAIR_MAX_DAYS) continue
    if (gap < bestGap || (gap === bestGap && best && m.date < best.date)) {
      best = m
      bestGap = gap
    }
  }
  return best?.value as number | undefined
}

export interface Snapshot {
  date: string
  age: number
  height: number
  /** Taille assise et poids retenus avec cette taille (pris le même jour), s'il y en a. */
  sitting?: number
  weight?: number
  mirwald: number | null
  moore: number
  /** Fransen 2018 : garçons seulement. */
  fransen: number | null
  /** Moyenne des modèles disponibles : c'est elle qui situe le joueur (précoce / tardif, avant / après le pic). */
  mean: { offset: number; n: number }
  kr: KRResult | null
  /**
   * Taille adulte sans les parents (table de croissance restante, Sherar 2005, garçons) : par modèle, avec le décalage
   * et l'âge au pic de CE modèle ; puis la moyenne des tailles disponibles. Filles : tout à null.
   */
  adult: AdultNoParents
}

export interface AdultNoParents {
  mirwald: number | null
  moore: number | null
  fransen: number | null
  mean: { height: number; n: number } | null
}

/** Tailles adultes sans les parents, une par modèle (décalage et âge au pic du modèle), et leur moyenne. */
export function adultNoParents(sex: Sex, age: number, height: number, offsets: { mirwald: number | null; moore: number | null; fransen: number | null }): AdultNoParents {
  const one = (o: number | null) => (o === null ? null : sherarAdultHeight({ height, offset: o, aphv: age - o, sex }))
  const r = { mirwald: one(offsets.mirwald), moore: one(offsets.moore), fransen: one(offsets.fransen) }
  const v = [r.mirwald, r.moore, r.fransen].filter((x): x is number => x !== null)
  return { ...r, mean: v.length ? { height: v.reduce((a, b) => a + b, 0) / v.length, n: v.length } : null }
}

/** Une estimation par date de mesure de la taille, pour suivre l'évolution. */
export function snapshots(p: Player, ms: Measurement[]): Snapshot[] {
  if (!p.sex || !p.birthDate) return []
  const sex = p.sex
  const dates = [...new Set(ms.filter((m) => m.criterionId === 'taille' && typeof m.value === 'number').map((m) => m.date))].sort()
  const parents =
    p.motherHeight !== undefined && p.fatherHeight !== undefined
      ? {
          mother: correctedParentHeight(p.motherHeight, 'mere', p.motherHeightSource !== 'mesuree'),
          father: correctedParentHeight(p.fatherHeight, 'pere', p.fatherHeightSource !== 'mesuree'),
        }
      : null
  return dates.flatMap((date) => {
    const age = decimalAge(p.birthDate!, date)
    const height = valueAt(ms, 'taille', date)
    if (age === null || height === undefined) return []
    const weight = valueNear(ms, 'poids', date)
    const sitting = valueNear(ms, 'taille_assise', date)
    const input = { sex, age, height, weight, sitting }
    const mw = mirwald(input)
    const mo = moore(input)
    const fr = fransen(input)
    return [
      {
        date,
        age,
        height,
        sitting,
        weight,
        mirwald: mw,
        moore: mo,
        fransen: fr,
        mean: meanOffset([mw, mo, fr]) ?? { offset: mo, n: 1 },
        kr:
          parents && weight !== undefined
            ? khamisRoche({ sex, age, height, weight, motherHeight: parents.mother, fatherHeight: parents.father })
            : null,
        adult: adultNoParents(sex, age, height, { mirwald: mw, moore: mo, fransen: fr }),
      },
    ]
  })
}

