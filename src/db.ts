import Dexie, { type EntityTable, type Transaction } from 'dexie'
import { DEFAULT_CRITERIA } from './criteria'

// ---------- Types ----------

export type Position = 'GB' | 'AG' | 'ARG' | 'DC' | 'ARD' | 'AD' | 'PIV'

export const POSITIONS: { id: Position; label: string; short: string }[] = [
  { id: 'GB', label: 'Gardien', short: 'Gardien' },
  { id: 'AG', label: 'Ailier gauche', short: 'Ailier G.' },
  { id: 'ARG', label: 'Arrière gauche', short: 'Arrière G.' },
  { id: 'DC', label: 'Demi-centre', short: 'Demi-centre' },
  { id: 'ARD', label: 'Arrière droit', short: 'Arrière D.' },
  { id: 'AD', label: 'Ailier droit', short: 'Ailier D.' },
  { id: 'PIV', label: 'Pivot', short: 'Pivot' },
]

export const positionLabel = (p?: Position | null) => POSITIONS.find((x) => x.id === p)?.short ?? '—'

export type Laterality = 'droitier' | 'gaucher' | 'ambidextre'

/** Champs communs à toutes les lignes synchronisées. */
interface Syncable {
  id: string
  updatedAt: number
  deleted?: boolean
  /** Signature posée par le serveur (supabase/004_audit.sql) : qui a créé / modifié, et quand. */
  createdBy?: string
  createdByName?: string
  createdAtServer?: string
  updatedByName?: string
  updatedAtServer?: string
}

export type HeightSource = 'mesuree' | 'declaree'

export interface Player extends Syncable {
  firstName: string
  lastName: string
  birthDate?: string
  sex?: 'M' | 'F'
  /** Tailles des parents biologiques (cm), pour la taille adulte prédite. */
  motherHeight?: number
  motherHeightSource?: HeightSource
  fatherHeight?: number
  fatherHeightSource?: HeightSource
  position?: Position
  team?: string
  license?: string
  /** Anciennes licences (une licence change en cas de mutation), pour reconnaître le joueur à l'import. */
  previousLicenses?: string[]
  /** État de la licence (QUALIFIE, EN_COURS…) et type de demande (RENOUVELLEMENT, CREATION, MUTATION). */
  licenseStatus?: string
  licenseRequestType?: string
  /** Numéro du club (Gest'Hand). */
  clubCode?: string
  nationality?: string
  category?: string
  club?: string
  boarding?: boolean | null
  laterality?: Laterality
  photo?: string
  gaps?: string
  notes?: string
  /** Département saisi à la main (joueur sans licence) ; sinon il est lu dans le n° de club ou de licence. */
  department?: string
  /**
   * Fiche proposée par un observateur (supabase/009_joueurs_proposes.sql) : pending = à valider,
   * validated = validée, refused = hors cadre (gardée pour mémoire). Sans état : fiche normale.
   */
  review?: ReviewState
  reviewNote?: string
  reviewedBy?: string
  reviewedByName?: string
  reviewedAt?: string
  /** Fiches fondues dans celle-ci (supabase/011_fusion_fiches.sql), avec leur histoire. */
  mergedFrom?: MergeTrace[]
  /** Fiche supprimée par fusion : celle qui l'a remplacée. */
  mergedInto?: string
}

/** Trace d'une fiche fondue dans une autre : qui l'avait proposée, si elle avait été mise hors cadre… */
export interface MergeTrace {
  id: string
  name: string
  license?: string
  club?: string
  review?: ReviewState
  reviewNote?: string
  reviewedByName?: string
  reviewedAt?: string
  createdByName?: string
  createdAtServer?: string
  mergedAt: string
  mergedByName?: string
}

/** Qualité d'un adulte référent. */
export type ReferentRole = 'parent' | 'eps' | 'entraineur' | 'etablissement' | 'autre'

export const REFERENT_ROLES: { value: ReferentRole; label: string }[] = [
  { value: 'parent', label: 'Parent / tuteur' },
  { value: 'eps', label: 'Professeur d’EPS' },
  { value: 'entraineur', label: 'Entraîneur' },
  { value: 'etablissement', label: 'Établissement' },
  { value: 'autre', label: 'Autre' },
]

/**
 * Adulte à contacter au sujet d'un joueur (jamais les coordonnées de l'enfant lui-même).
 * Lisible seulement par les encadrants et administrateurs, et par celui qui l'a saisi.
 */
export interface Referent extends Syncable {
  playerId: string
  firstName?: string
  lastName: string
  role: ReferentRole
  /** Collège, club… */
  structure?: string
  phone?: string
  email?: string
  address?: string
  /** Contact à privilégier. */
  preferred?: boolean
  /** D'où vient l'information (« donné par le prof d'EPS le 12/10 »). */
  source?: string
  notes?: string
}

/** factual = une seule source (préparateur) ; subjective = plusieurs observateurs. */
export type CriterionKind = 'factual' | 'subjective'
/** score5 = 1..5, score3 = 0..3, score2 = 0..2, number = valeur libre avec unité, text = note libre,
 *  choice = une option parmi `options` (ex. Gauche / Droit). */
export type CriterionScale = 'score5' | 'score3' | 'score2' | 'number' | 'text' | 'choice'

export interface Criterion extends Syncable {
  label: string
  description?: string
  category: string
  kind: CriterionKind
  scale: CriterionScale
  unit?: string
  /** Options proposées pour l'échelle « choice ». */
  options?: string[]
  /** Postes concernés ; vide = tous. */
  positions?: Position[]
  /** Fait partie du mode d'évaluation rapide. */
  quick?: boolean
  active: boolean
  order: number
}

/** Valeur factuelle d'un critère pour un joueur à une date. */
export interface Measurement extends Syncable {
  playerId: string
  criterionId: string
  value: number | string
  date: string
  author?: string
}

export type EventType = 'match' | 'tournoi' | 'entrainement' | 'observation'

export interface HBEvent extends Syncable {
  name: string
  type: EventType
  date: string
  place?: string
  /** Joueurs convoqués / à évaluer sur l'événement (ordre de passage). */
  playerIds?: string[]
}

/** Contexte d'un avis spontané (joueur vu hors des événements prévus). */
export type ContextType = 'unss' | 'club' | 'match' | 'selection' | 'autre'

export const CONTEXT_TYPES: { value: ContextType; label: string }[] = [
  { value: 'unss', label: 'UNSS / scolaire' },
  { value: 'club', label: 'Entraînement club' },
  { value: 'match', label: 'Match' },
  { value: 'selection', label: 'Sélection' },
  { value: 'autre', label: 'Autre' },
]

/**
 * Validation d'un avis spontané (supabase/008_avis_spontanes.sql) :
 * pending = en attente, validated = compte dans les moyennes, refused = hors cadre (gardé, ne compte jamais).
 * Les avis sur un événement n'ont pas d'état : ils sont validés d'office.
 */
export type ReviewState = 'pending' | 'validated' | 'refused'

/** Avis subjectif d'un observateur sur un joueur, dans un contexte. */
export interface Evaluation extends Syncable {
  playerId: string
  /** Événement de l'avis ; sinon c'est un avis spontané, décrit par contextType / contextPlace. */
  eventId?: string
  contextType?: ContextType
  contextPlace?: string
  review?: ReviewState
  /** Commentaire de celui qui a validé ou refusé l'avis. */
  reviewNote?: string
  reviewedBy?: string
  reviewedByName?: string
  reviewedAt?: string
  observer: string
  /** Compte qui a écrit l'avis (seul lui, ou un admin, peut le modifier). */
  observerId?: string
  date: string
  /** Note (nombre), option choisie ou texte libre, selon l'échelle du critère. */
  scores: Record<string, number | string>
  overall?: number
  minutesObserved?: number
  strengths?: string
  improvements?: string
}

/** Groupe de joueurs réutilisable (Intercomités 83, Pôle, Sport-études…) : filtre, export, événements. */
export interface PlayerGroup extends Syncable {
  name: string
  description?: string
  playerIds: string[]
  /** Groupe privé : visible et modifiable par son créateur seul. */
  private?: boolean
  /** Informations facultatives, pour filtrer et retrouver les groupes. */
  sex?: 'M' | 'F' | 'mixte'
  department?: string
  region?: string
  /** Années de naissance concernées (ex. ['2010', '2011']). */
  years?: string[]
  /** Groupe d'une saison passée : caché des listes, gardé pour l'historique. */
  archived?: boolean
}

export const REGIONS = [
  'Auvergne-Rhône-Alpes',
  'Bourgogne-Franche-Comté',
  'Bretagne',
  'Centre-Val de Loire',
  'Corse',
  'Grand Est',
  'Hauts-de-France',
  'Île-de-France',
  'Normandie',
  'Nouvelle-Aquitaine',
  'Occitanie',
  'Pays de la Loire',
  'Provence-Alpes-Côte d’Azur',
  'Outre-mer',
]

export interface OutboxItem {
  seq?: number
  table: SyncTable
  rowId: string
}

export const SYNC_TABLES = ['players', 'criteria', 'measurements', 'events', 'evaluations', 'referents', 'groups'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

// ---------- Base locale ----------

export const db = new Dexie('handbase') as Dexie & {
  players: EntityTable<Player, 'id'>
  criteria: EntityTable<Criterion, 'id'>
  measurements: EntityTable<Measurement, 'id'>
  events: EntityTable<HBEvent, 'id'>
  evaluations: EntityTable<Evaluation, 'id'>
  referents: EntityTable<Referent, 'id'>
  groups: EntityTable<PlayerGroup, 'id'>
  outbox: EntityTable<OutboxItem, 'seq'>
}

db.version(1).stores({
  players: 'id, lastName, position, updatedAt',
  criteria: 'id, category, kind, order, updatedAt',
  measurements: 'id, playerId, criterionId, [playerId+criterionId], date, updatedAt',
  events: 'id, date, updatedAt',
  evaluations: 'id, playerId, eventId, observer, date, updatedAt',
  outbox: '++seq, table, rowId',
})

db.on('populate', (tx) => {
  tx.table('criteria').bulkAdd(DEFAULT_CRITERIA.map((c, i) => ({ ...c, order: i, active: true, updatedAt: 0 })))
})

/**
 * Applique les critères par défaut aux appareils déjà installés : ajoute les nouveaux et met à jour
 * ceux que personne n'a modifiés (updatedAt = 0). Un critère modifié par un administrateur n'est pas touché.
 * À rappeler dans une nouvelle version de la base à chaque changement de DEFAULT_CRITERIA.
 */
async function applyDefaultCriteria(tx: Transaction) {
  const table = tx.table('criteria')
  for (const [i, c] of DEFAULT_CRITERIA.entries()) {
    const cur = await table.get(c.id)
    if (!cur) await table.add({ ...c, order: i, active: true, updatedAt: 0 })
    else if (!cur.updatedAt) await table.put({ ...cur, ...c, positions: c.positions, quick: c.quick, order: i })
  }
}

// v2 : critères de champ réservés aux joueurs de champ, nouveaux critères gardien.
db.version(2).upgrade(applyDefaultCriteria)

// v3 : adultes référents des joueurs.
db.version(3).stores({ referents: 'id, playerId, updatedAt' })

// v4 : groupes de joueurs.
db.version(4).stores({ groups: 'id, name, updatedAt' })

// ---------- Écritures (toujours via ces fonctions pour alimenter la synchro) ----------

export function newId(): string {
  // crypto.randomUUID n'existe qu'en contexte sécurisé (https / localhost).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    try {
      return crypto.randomUUID()
    } catch {
      /* contexte non sécurisé */
    }
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}

type Row = { id: string; updatedAt: number; deleted?: boolean }

export async function save<T extends Row>(table: SyncTable, row: Omit<T, 'updatedAt'> & { updatedAt?: number }) {
  const full = { ...row, updatedAt: Date.now() } as T
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    await db.table(table).put(full)
    await db.outbox.add({ table, rowId: full.id })
  })
  return full
}

/** Suppression logique : la ligne reste pour propager la suppression aux autres appareils. */
export async function remove(table: SyncTable, id: string) {
  const row = await db.table(table).get(id)
  if (row) await save(table, { ...row, deleted: true })
}

export const alive = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)

/** État de validation d'un avis (les avis sans état sont validés d'office). */
export const reviewOf = (e: Evaluation): ReviewState => e.review ?? 'validated'
/** L'avis compte-t-il dans les moyennes, radars et exports ? */
export const counts = (e: Evaluation) => reviewOf(e) === 'validated'

/** Contexte d'un avis spontané, en clair : « UNSS / scolaire · collège Jean Moulin ». */
export const contextLabel = (e: Evaluation) =>
  [CONTEXT_TYPES.find((c) => c.value === e.contextType)?.label ?? 'Hors événement', e.contextPlace].filter(Boolean).join(' · ')

// ---------- Utilitaires ----------

export function age(birthDate?: string): number | null {
  if (!birthDate) return null
  const b = new Date(birthDate)
  if (isNaN(b.getTime())) return null
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--
  return a
}

export const today = () => new Date().toISOString().slice(0, 10)

export const fmtDate = (d?: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR') : '—')

export const criterionApplies = (c: Criterion, pos?: Position) =>
  !c.positions || c.positions.length === 0 || (pos ? c.positions.includes(pos) : false)

export function scaleMax(scale: CriterionScale) {
  return scale === 'score5' ? 5 : scale === 'score3' ? 3 : scale === 'score2' ? 2 : null
}
export function scaleMin(scale: CriterionScale) {
  return scale === 'score5' ? 1 : 0
}
