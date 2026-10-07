import type { SyncTable } from './db'

/*
 * Avancement d'un gros téléchargement (premier chargement d'un appareil) : pour chaque table en cours,
 * le nombre de lignes à recevoir (estimé par le serveur) et celui déjà reçu.
 * Fonctions pures (testables sans serveur) ; l'état vit dans sync.ts.
 */

export type TableProgress = { done: number; total: number }
/** first : premier chargement de l'appareil (sinon, rattrapage d'un gros retard). */
export type SyncProgress = { table: SyncTable | null; done: number; total: number; first: boolean }

/** Au-delà, l'avancement est affiché (en dessous, une synchro ordinaire reste discrète). */
export const PROGRESS_MIN = 2000

/** Totaux additionnés sur toutes les tables ; une estimation trop basse ne fait jamais dépasser 100 %. */
export function aggregate(per: Partial<Record<SyncTable, TableProgress>>, table: SyncTable | null = null, first = true): SyncProgress {
  let done = 0
  let total = 0
  for (const p of Object.values(per)) {
    if (!p) continue
    done += p.done
    total += Math.max(p.total, p.done)
  }
  return { table, done, total, first }
}

/** Avancement à montrer (null : rien à afficher). */
export const showProgress = (p: SyncProgress | null): p is SyncProgress => !!p && p.total > PROGRESS_MIN

export const percent = (p: SyncProgress) => (p.total ? Math.min(100, Math.floor((p.done / p.total) * 100)) : 0)

export const TABLE_LABELS: Record<SyncTable, string> = {
  players: 'joueurs',
  criteria: 'critères',
  measurements: 'mesures',
  events: 'événements',
  evaluations: 'avis',
  groups: 'groupes',
  lists: 'listes',
  alerts: 'profils recherchés',
  follows: 'suivis',
}

const fmt = (n: number) => n.toLocaleString('fr-FR')

/** « Premier chargement : 23 000 / 110 000 éléments (mesures) ». */
export const progressLabel = (p: SyncProgress) =>
  `${p.first ? 'Premier chargement' : 'Mise à jour'} : ${fmt(p.done)} / ${fmt(p.total)} éléments${p.table ? ` (${TABLE_LABELS[p.table]})` : ''}`
