/*
 * Garde-fou des périodes de pôle (fiche, src/pages/PlayerForm.tsx, bloc « Pôle Espoirs ») : partie pure (ni Dexie ni React),
 * testée par tools/test-pole-checks.ts. Demandé par Geoffroy le 23/11 après les dates impossibles de la démo
 * (supabase/078_demo_parcours_coherent.sql) : le parcours de la fiche (src/parcours.ts) se lisait dans le désordre.
 *
 * Une seule chose REFUSÉE (l'enregistrement est bloqué) : une sortie avant l'entrée.
 * AVERTISSEMENTS seulement (on peut enregistrer) :
 *  - entrée avant 12 ans ou à 18 ans et plus (âge exact à la date d'entrée, d'après la date de naissance de la fiche) ;
 *  - deux périodes qui se chevauchent ;
 *  - entrée à plus d'un an d'aujourd'hui (une arrivée de la saison prochaine, le 1er juillet, est normale : src/poleSeason.ts).
 * Rien sur un pôle antérieur à la première observation dans l'appli : c'est le cas de tous les jeunes déjà au pôle quand
 * l'appli arrive.
 * Textes neutres (ils parlent des dates, jamais du jeune), accordés au sexe de la fiche (src/gender.ts).
 */
import type { PolePeriod } from './db'
import { accord } from './gender'

export type PoleIssueKind = 'sortie_avant_entree' | 'age' | 'chevauchement' | 'futur'

export interface PoleIssue {
  kind: PoleIssueKind
  /** « error » : enregistrement bloqué ; « warning » : simple avertissement. */
  level: 'error' | 'warning'
  /** Indice de la période dans la liste (celle sous laquelle afficher le message). */
  index: number
  /** Chevauchement : l'autre période. */
  other?: number
  message: string
}

/** Âge minimal et âge limite (exclu) à l'entrée, sans avertissement. */
export const POLE_AGE_MIN = 12
export const POLE_AGE_MAX = 18

const DAY = /^\d{4}-\d{2}-\d{2}$/
const isDay = (s: string | undefined): s is string => !!s && DAY.test(s)

/** Âge exact (années révolues) au jour `day`, né le `birth` (AAAA-MM-JJ). */
export function ageAt(birth: string, day: string): number {
  const [by, bm, bd] = birth.split('-').map(Number)
  const [y, m, d] = day.split('-').map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

/** Même jour un an plus tard (29 février → 28 février). */
function plusOneYear(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const dd = m === 2 && d === 29 ? 28 : d
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
/** « 12 mars 2027 », « 1er septembre 2026 » */
export function longDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}`
}

/** Numéro de période affiché (1re, 2e…) quand il y en a plusieurs. */
const nth = (i: number) => (i === 0 ? '1re' : `${i + 1}e`)

/**
 * Problèmes des périodes de pôle d'une fiche. `today` : AAAA-MM-JJ ; `birthDate` absente ou invalide : pas de contrôle d'âge ;
 * `sex` : accord des textes. Les périodes vides (aucune date) sont ignorées.
 */
export function poleIssues(poles: readonly PolePeriod[] | undefined, opts: { today: string; birthDate?: string; sex?: string | null }): PoleIssue[] {
  const out: PoleIssue[] = []
  const list = poles ?? []
  const birth = isDay(opts.birthDate) ? opts.birthDate : undefined
  const entre = accord('Entré', opts.sex)
  for (const [i, x] of list.entries()) {
    if (isDay(x.from) && isDay(x.to) && x.to < x.from)
      out.push({ kind: 'sortie_avant_entree', level: 'error', index: i, message: `La sortie (${longDate(x.to)}) est avant l'entrée (${longDate(x.from)}) : corrige l'une des deux dates.` })
    if (isDay(x.from) && birth) {
      const age = ageAt(birth, x.from)
      if (age < POLE_AGE_MIN || age >= POLE_AGE_MAX)
        out.push({ kind: 'age', level: 'warning', index: i, message: `${entre} à ${age} ans d'après la date de naissance : inhabituel pour un pôle (de ${POLE_AGE_MIN} à ${POLE_AGE_MAX - 1} ans). Vérifie les deux dates.` })
    }
    if (isDay(x.from) && x.from > plusOneYear(opts.today))
      out.push({ kind: 'futur', level: 'warning', index: i, message: `Entrée le ${longDate(x.from)} : plus d'un an d'ici. Vérifie l'année.` })
  }
  // Chevauchements : deux périodes datées (entrée connue) qui ont au moins un jour en commun ; sortie vide = au pôle.
  const dated = list.map((x, i) => ({ x, i })).filter(({ x }) => isDay(x.from) && !(isDay(x.to) && x.to < x.from!))
  for (let a = 0; a < dated.length; a++)
    for (let b = a + 1; b < dated.length; b++) {
      const A = dated[a].x
      const B = dated[b].x
      const endA = isDay(A.to) ? A.to : '9999-12-31'
      const endB = isDay(B.to) ? B.to : '9999-12-31'
      if (A.from! <= endB && B.from! <= endA) {
        const [i, j] = [dated[a].i, dated[b].i]
        out.push({ kind: 'chevauchement', level: 'warning', index: j, other: i, message: `Cette période recouvre la ${nth(i)} période : une seule période de pôle à la fois, en principe.` })
      }
    }
  return out.sort((p, q) => p.index - q.index || (p.level === q.level ? 0 : p.level === 'error' ? -1 : 1))
}

/** Au moins un problème bloquant (enregistrement refusé). */
export const poleBlocking = (issues: readonly PoleIssue[]) => issues.some((x) => x.level === 'error')

/** Message de refus en haut du formulaire (null : rien de bloquant). */
export function poleBlockMessage(issues: readonly PoleIssue[]): string | null {
  const n = issues.filter((x) => x.level === 'error').length
  if (!n) return null
  return n === 1
    ? 'Pôle Espoirs : une période a sa sortie avant son entrée. Corrige-la pour enregistrer.'
    : `Pôle Espoirs : ${n} périodes ont leur sortie avant leur entrée. Corrige-les pour enregistrer.`
}
