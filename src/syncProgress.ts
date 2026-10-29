import type { SyncTable } from './db'
import { STAFF } from './staffLabels'

/*
 * Avancement d'un gros téléchargement (premier chargement d'un appareil, ou gros retard) : SANS RIEN DEMANDER AU SERVEUR.
 * Avant (jusqu'au 29/10/2026), l'appli comptait d'avance chaque table (18 requêtes HEAD « count=estimated » par appareil
 * neuf, plus une par table en gros retard) : sous les règles de lecture, PostgREST les calcule en entier dès que le compte
 * voit moins de lignes que db-max-rows (le comptage limité à db-max-rows + 1 parcourt alors toute la table). À l'essai de
 * charge (5 000 appareils ouverts en 5 minutes), c'était le premier poste de la base (~13 500 s sur le palier).
 * Maintenant : chaque table à recevoir compte pour une part égale ; dans une table, chaque page pleine (1 000 lignes) rapproche
 * sa part de la fin sans l'atteindre (k pages : k / (k + 1)) ; table finie : sa part entière. La barre avance donc toujours,
 * n'atteint 100 % qu'à la fin, et le texte donne le nombre d'éléments déjà reçus.
 * Fonctions pures (testables sans serveur) ; l'état vit dans sync.ts.
 */

/** pages : pages déjà reçues ; finished : dernière page reçue (plus courte qu'une page pleine). */
export type TableProgress = { done: number; pages: number; finished: boolean }
/**
 * done : éléments reçus ; share : part faite, de 0 à 1 (1 seulement quand tout est reçu) ; first : premier chargement de
 * l'appareil (sinon, rattrapage d'un gros retard).
 */
export type SyncProgress = { table: SyncTable | null; done: number; share: number; first: boolean }

/** Au-delà de ce nombre d'éléments reçus, l'avancement est affiché (en dessous, une synchro ordinaire reste discrète). */
export const PROGRESS_MIN = 2000

/** Une table à recevoir, rien encore. */
export const startTable = (): TableProgress => ({ done: 0, pages: 0, finished: false })

/** Part faite d'une table : k pages pleines reçues → k / (k + 1) ; finie → 1. */
export const tableShare = (p: TableProgress) => (p.finished ? 1 : p.pages / (p.pages + 1))

/** Toutes les tables suivies, chacune pour une part égale. */
export function aggregate(per: Partial<Record<SyncTable, TableProgress>>, table: SyncTable | null = null, first = true): SyncProgress {
  let done = 0
  let sum = 0
  let n = 0
  for (const p of Object.values(per)) {
    if (!p) continue
    done += p.done
    sum += tableShare(p)
    n++
  }
  return { table, done, share: n ? Math.min(1, sum / n) : 0, first }
}

/**
 * Avancement suivant, jamais en arrière pendant le même téléchargement (une table en gros retard qui s'ajoute en cours de
 * route ferait reculer la barre) ; prev : avancement affiché jusqu'ici (null : début).
 */
export const forward = (prev: SyncProgress | null, next: SyncProgress): SyncProgress => (prev && prev.share > next.share ? { ...next, share: prev.share } : next)

/** Avancement à montrer (null : rien à afficher). */
export const showProgress = (p: SyncProgress | null): p is SyncProgress => !!p && p.done > PROGRESS_MIN

export const percent = (p: SyncProgress) => Math.min(100, Math.floor(p.share * 100))

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
  teams: STAFF.many,
  videos: 'vidéos',
  seen: '« vu »',
  rewatch: '« à revoir »',
  config: 'configuration',
  levels: 'niveaux',
  units: 'unités',
  assignments: 'affectations',
  question_log: 'journal des questions',
  saved_questions: 'questions enregistrées',
}

const fmt = (n: number) => n.toLocaleString('fr-FR')

/** « Premier chargement : 23 000 éléments reçus (mesures) ». */
export const progressLabel = (p: SyncProgress) =>
  `${p.first ? 'Premier chargement' : 'Mise à jour'} : ${fmt(p.done)} élément${p.done > 1 ? 's' : ''} reçu${p.done > 1 ? 's' : ''}${p.table ? ` (${TABLE_LABELS[p.table]})` : ''}`
