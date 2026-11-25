// Cas communs des alertes wellness de « Mes suivis » (données FICTIVES) : tools/test-alertes-wellness.ts vérifie la
// partie TS (src/wellnessAlerts.ts) ; tools/essai-sql-080/parite.ts fait vérifier LES MÊMES CAS (et d'autres tirés au
// hasard) par la fonction SQL hb_wla_serie (supabase/080_alertes_wellness.sql) : les deux doivent donner la même série.
import type { Zone } from '../src/lamp'
import { addDays, type WellnessEntry, type WellnessKey } from '../src/wellness'
import type { AlertRule } from '../src/wellnessAlerts'

export interface Cas {
  nom: string
  regle: AlertRule
  entries: WellnessEntry[]
  today: string
  /** Zone des vacances (null : seulement les week-ends et jours fériés). */
  zone?: Zone | null
  account?: boolean
  since?: string | null
  /** Série attendue (nombre de jours). */
  attendu: number
}

/** Réponse d'un jour : notes (toutes à `v`, ou détaillées) et douleur. */
export function rep(day: string, v: number | Partial<Record<WellnessKey, number>> | null, pain = false): WellnessEntry {
  const scores = v === null ? {} : typeof v === 'number' ? { energie: v, fraicheur: v, humeur: v, sommeil: v } : v
  return { day, scores, pain }
}
/** Réponses à `v` sur chaque jour de semaine de `from` à `to` (compris). */
export function semaine(from: string, to: string, v: number): WellnessEntry[] {
  const out: WellnessEntry[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay()
    if (wd >= 1 && wd <= 5) out.push(rep(d, v))
  }
  return out
}

// Semaine de référence : lundi 23 → vendredi 27 novembre 2026 (aujourd'hui : mercredi 25).
const SEUIL5_3: AlertRule = { type: 'seuil', note: 'moyenne', max: 5, jours: 3 }

export const CAS: Cas[] = [
  // ---------- Seuil ----------
  { nom: 'seuil : trois jours demandés à 4 → 3', regle: SEUIL5_3, today: '2026-11-25', entries: [rep('2026-11-23', 4), rep('2026-11-24', 4), rep('2026-11-25', 4)], attendu: 3 },
  { nom: 'seuil : à 5 pile compte (« 5 ou moins »)', regle: SEUIL5_3, today: '2026-11-25', entries: [rep('2026-11-23', 5), rep('2026-11-24', 5), rep('2026-11-25', 5)], attendu: 3 },
  { nom: 'seuil : moyenne 5,25 ne compte pas', regle: SEUIL5_3, today: '2026-11-25', entries: [rep('2026-11-25', { energie: 5, fraicheur: 5, humeur: 5, sommeil: 6 })], attendu: 0 },
  { nom: 'seuil : week-end sauté (vendredi → lundi se suivent)', regle: SEUIL5_3, today: '2026-11-24', entries: [rep('2026-11-20', 4), rep('2026-11-23', 4), rep('2026-11-24', 4)], attendu: 3 },
  { nom: 'seuil : aujourd’hui pas encore répondu → série jusqu’à hier', regle: SEUIL5_3, today: '2026-11-25', entries: [rep('2026-11-20', 4), rep('2026-11-23', 4), rep('2026-11-24', 4)], attendu: 3 },
  { nom: 'seuil : aujourd’hui répondu au-dessus → 0', regle: SEUIL5_3, today: '2026-11-25', entries: [rep('2026-11-23', 4), rep('2026-11-24', 4), rep('2026-11-25', 7)], attendu: 0 },
  { nom: 'seuil : jour demandé sans réponse coupe la série', regle: SEUIL5_3, today: '2026-11-25', entries: [rep('2026-11-19', 4), rep('2026-11-24', 4), rep('2026-11-25', 4)], attendu: 2 },
  { nom: 'seuil : le dimanche, la série part du vendredi', regle: SEUIL5_3, today: '2026-11-29', entries: [rep('2026-11-26', 3), rep('2026-11-27', 3)], attendu: 2 },
  { nom: 'seuil : réponse du samedi ignorée (jour non demandé)', regle: SEUIL5_3, today: '2026-11-30', entries: [rep('2026-11-27', 3), rep('2026-11-28', 9), rep('2026-11-30', 3)], attendu: 2 },
  { nom: 'seuil : 11 novembre férié sauté', regle: SEUIL5_3, today: '2026-11-12', entries: [rep('2026-11-10', 4), rep('2026-11-12', 4)], attendu: 2 },
  { nom: 'seuil sommeil : la note seule, pas la moyenne', regle: { type: 'seuil', note: 'sommeil', max: 4, jours: 2 }, today: '2026-11-25', entries: [rep('2026-11-24', { energie: 9, fraicheur: 9, humeur: 9, sommeil: 3 }), rep('2026-11-25', { energie: 9, fraicheur: 9, humeur: 9, sommeil: 4 })], attendu: 2 },
  { nom: 'seuil sommeil : note absente ce jour-là coupe', regle: { type: 'seuil', note: 'sommeil', max: 4, jours: 2 }, today: '2026-11-25', entries: [rep('2026-11-24', { sommeil: 3 }), rep('2026-11-25', { energie: 2 })], attendu: 0 },
  { nom: 'seuil : réponse partielle, moyenne des notes données', regle: SEUIL5_3, today: '2026-11-25', entries: [rep('2026-11-25', { energie: 4, humeur: 6 })], attendu: 1 },
  { nom: 'seuil : douleur seule (sans note) coupe', regle: SEUIL5_3, today: '2026-11-25', entries: [rep('2026-11-24', 4), rep('2026-11-25', null, true)], attendu: 0 },
  // ---------- Douleur ----------
  { nom: 'douleur : deux jours de suite → 2', regle: { type: 'douleur', jours: 2 }, today: '2026-11-25', entries: [rep('2026-11-23', 7), rep('2026-11-24', 7, true), rep('2026-11-25', 7, true)], attendu: 2 },
  { nom: 'douleur : un jour sans douleur coupe', regle: { type: 'douleur', jours: 1 }, today: '2026-11-25', entries: [rep('2026-11-23', 7, true), rep('2026-11-24', 7), rep('2026-11-25', 7, true)], attendu: 1 },
  { nom: 'douleur : aujourd’hui pas répondu, hier douleur → 1', regle: { type: 'douleur', jours: 1 }, today: '2026-11-25', entries: [rep('2026-11-24', null, true)], attendu: 1 },
  // ---------- Chute ----------
  { nom: 'chute : 8 sur deux semaines puis 5, 5 → baisse de 3 sur 2 jours', regle: { type: 'chute', note: 'moyenne', baisse: 3, jours: 2 }, today: '2026-11-24', entries: [...semaine('2026-11-09', '2026-11-20', 8), rep('2026-11-23', 5), rep('2026-11-24', 5)], attendu: 2 },
  { nom: 'chute : baisse demandée de 4, seulement 3 → 0', regle: { type: 'chute', note: 'moyenne', baisse: 4, jours: 1 }, today: '2026-11-24', entries: [...semaine('2026-11-09', '2026-11-20', 8), rep('2026-11-23', 5), rep('2026-11-24', 5)], attendu: 0 },
  { nom: 'chute : les jours de la série n’entrent pas dans la référence', regle: { type: 'chute', note: 'moyenne', baisse: 3, jours: 3 }, today: '2026-11-25', entries: [...semaine('2026-11-09', '2026-11-20', 8), rep('2026-11-23', 5), rep('2026-11-24', 5), rep('2026-11-25', 5)], attendu: 3 },
  { nom: 'chute : moins de 3 réponses dans les 14 jours → 0', regle: { type: 'chute', note: 'moyenne', baisse: 2, jours: 1 }, today: '2026-11-24', entries: [rep('2026-11-16', 8), rep('2026-11-17', 8), rep('2026-11-24', 4)], attendu: 0 },
  { nom: 'chute : réponses du week-end comptées dans la référence', regle: { type: 'chute', note: 'moyenne', baisse: 2, jours: 1 }, today: '2026-11-23', entries: [rep('2026-11-14', 8), rep('2026-11-15', 8), rep('2026-11-21', 8), rep('2026-11-23', 6)], attendu: 1 },
  { nom: 'chute sur l’énergie seule', regle: { type: 'chute', note: 'energie', baisse: 3, jours: 1 }, today: '2026-11-24', entries: [...semaine('2026-11-09', '2026-11-20', 8), rep('2026-11-23', 8), rep('2026-11-24', { energie: 4, fraicheur: 8, humeur: 8, sommeil: 8 })], attendu: 1 },
  { nom: 'chute : baisse progressive (6 puis 5, 5) : pas une chute de 3', regle: { type: 'chute', note: 'moyenne', baisse: 3, jours: 1 }, today: '2026-11-25', entries: [...semaine('2026-11-09', '2026-11-20', 8), rep('2026-11-23', 6), rep('2026-11-24', 5), rep('2026-11-25', 5)], attendu: 0 },
  { nom: 'chute : même baisse progressive, chute de 2 sur 3 jours', regle: { type: 'chute', note: 'moyenne', baisse: 2, jours: 3 }, today: '2026-11-25', entries: [...semaine('2026-11-09', '2026-11-20', 8), rep('2026-11-23', 6), rep('2026-11-24', 5), rep('2026-11-25', 5)], attendu: 3 },
  // ---------- Pas de réponse ----------
  { nom: 'silence : pas d’espace joueur → jamais', regle: { type: 'silence', jours: 1 }, today: '2026-11-25', entries: [], account: false, attendu: 0 },
  { nom: 'silence : lundi et mardi sans réponse, aujourd’hui pas encore → 2', regle: { type: 'silence', jours: 2 }, today: '2026-11-25', entries: [rep('2026-11-20', 7)], account: true, attendu: 2 },
  { nom: 'silence : aujourd’hui répondu → 0', regle: { type: 'silence', jours: 1 }, today: '2026-11-25', entries: [rep('2026-11-25', 7)], account: true, attendu: 0 },
  { nom: 'silence : pas avant que le wellness soit demandé', regle: { type: 'silence', jours: 1 }, today: '2026-11-25', entries: [], account: true, since: '2026-11-24', attendu: 1 },
  { nom: 'silence : 30 jours regardés au plus', regle: { type: 'silence', jours: 3 }, today: '2026-11-25', entries: [], account: true, attendu: 21 },
  { nom: 'silence : vacances de la Toussaint (zone B) sautées', regle: { type: 'silence', jours: 1 }, today: '2026-11-03', entries: [rep('2026-10-16', 7)], account: true, zone: 'B', attendu: 1 },
  { nom: 'silence : sans zone, les jours de vacances comptent', regle: { type: 'silence', jours: 1 }, today: '2026-11-03', entries: [rep('2026-10-16', 7)], account: true, zone: null, attendu: 11 },
  { nom: 'seuil : vacances d’hiver zone A sautées, pas en zone B', regle: SEUIL5_3, today: '2027-03-01', zone: 'A', entries: [rep('2027-02-11', 4), rep('2027-02-12', 4), rep('2027-03-01', 4)], attendu: 3 },
  { nom: 'seuil : mêmes réponses en zone B (1er mars en vacances, 19 février sans réponse) → 0', regle: SEUIL5_3, today: '2027-03-01', zone: 'B', entries: [rep('2027-02-11', 4), rep('2027-02-12', 4), rep('2027-03-01', 4)], attendu: 0 },
]
