import Dexie, { type EntityTable, type Transaction } from 'dexie'
import { guardWrite } from './spy'
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

/** « Droitier », « Gauchère »… accordé au sexe du joueur (masculin si inconnu). */
export const lateralityLabel = (l?: Laterality | null, sex?: string | null) =>
  !l ? '' : l === 'ambidextre' ? 'Ambidextre' : sex === 'F' ? (l === 'gaucher' ? 'Gauchère' : 'Droitière') : l === 'gaucher' ? 'Gaucher' : 'Droitier'

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

/** Une période en Pôle Espoirs : pôle (ligue), programme, site, entrée, sortie (vide = encore au pôle) et motif. */
export interface PolePeriod {
  /** Ligue qui porte le pôle (identifiant de région de la liste « region »). */
  regionId?: string
  programme?: 'accession' | 'excellence'
  /** Ville du site (Toulouse, Nîmes…). */
  site?: string
  from?: string
  to?: string
  exitReason?: PoleExit
  /** Ancien nom libre (premières saisies). */
  name?: string
}
export type PoleExit = 'fin_cursus' | 'exclusion' | 'abandon' | 'blessure' | 'autre'
export const POLE_EXITS: { value: PoleExit; label: string }[] = [
  { value: 'fin_cursus', label: 'Fin de cursus' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'abandon', label: 'Abandon' },
  { value: 'blessure', label: 'Blessure' },
  { value: 'autre', label: 'Autre' },
]
export const POLE_PROGRAMMES = [
  { value: 'accession', label: 'Accession' },
  { value: 'excellence', label: 'Excellence' },
] as const

const filled = (x: PolePeriod) => !!(x.from || x.to || x.name || x.regionId || x.site)

/** Pôle Espoirs : « current » (en cours aujourd'hui), « past » (y est passé, en est sorti), sinon rien. */
export function poleStatus(p: Pick<Player, 'poles'>, today = new Date().toLocaleDateString('sv')): 'current' | 'past' | undefined {
  const ps = (p.poles ?? []).filter(filled)
  if (!ps.length) return undefined
  return ps.some((x) => (!x.from || x.from <= today) && (!x.to || x.to >= today)) ? 'current' : 'past'
}

/** Nom d'une période : « Pôle Espoirs Occitanie – Excellence (Toulouse) ». `region` donne le nom d'une ligue. */
export function poleName(x: PolePeriod, region: (id: string) => string | undefined = () => undefined) {
  const prog = POLE_PROGRAMMES.find((p) => p.value === x.programme)?.label
  const base = x.regionId ? `Pôle Espoirs ${region(x.regionId) ?? x.regionId}` : x.name || 'Pôle Espoirs'
  return `${base}${prog ? ` – ${prog}` : ''}${x.site ? ` (${x.site})` : ''}`
}

/** « Pôle Espoirs Occitanie – Excellence (Toulouse), depuis le 01/09/2025 » ; périodes séparées par « ; ». */
export function poleSummary(p: Pick<Player, 'poles'>, region?: (id: string) => string | undefined) {
  const d = (s: string) => s.split('-').reverse().join('/')
  return (p.poles ?? [])
    .filter(filled)
    .map((x) => {
      const when = x.from && x.to ? `du ${d(x.from)} au ${d(x.to)}` : x.from ? `depuis le ${d(x.from)}` : x.to ? `jusqu'au ${d(x.to)}` : ''
      const why = x.to && x.exitReason ? `(${POLE_EXITS.find((e) => e.value === x.exitReason)?.label.toLowerCase()})` : ''
      return [poleName(x, region), [when, why].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    })
    .join(' ; ')
}

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
  /** Postes où il peut aussi jouer (dépanner), en plus du poste principal. */
  secondaryPositions?: Position[]
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
  /** Passages en Pôle Espoirs (une ligne par période) : liste des sportifs de haut niveau pour le ministère. */
  poles?: PolePeriod[]
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
  /** Commentaire du préparateur (« blessé », « D>G »…). */
  note?: string
}

export type EventType = 'match' | 'tournoi' | 'entrainement' | 'observation'

export interface HBEvent extends Syncable {
  name: string
  type: EventType
  date: string
  place?: string
  /** Joueurs convoqués / à évaluer sur l'événement (ordre de passage). */
  playerIds?: string[]
  /** Archivé : caché des listes (Évaluer, événements) ; ses avis comptent toujours. */
  archived?: boolean
  /** Participants (encadrants, supabase/024) : ajoutent des joueurs, retirent les leurs, co-organisent. */
  editors?: string[]
  /** Staffs choisis (supabase/034) : leurs membres du moment sont participants, comme ceux de editors. */
  teams?: string[]
  /** Qui a ajouté chaque joueur de la liste (identifiant de compte) ; tenu par le serveur. */
  addedBy?: Record<string, string>
  /** Noms des comptes cités (participants, « ajouté par »). */
  names?: Record<string, string>
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
  minutesObserved?: number
  strengths?: string
  improvements?: string
}

/** Groupe de joueurs réutilisable (Intercomités 83, Pôle, Sport-études…) : filtre, export, événements. */
export type GroupScope = 'federation' | 'ligue' | 'comite'
export const GROUP_SCOPES: { value: GroupScope; label: string }[] = [
  { value: 'federation', label: 'Fédération' },
  { value: 'ligue', label: 'Ligue' },
  { value: 'comite', label: 'Comité' },
]

export interface PlayerGroup extends Syncable {
  name: string
  description?: string
  playerIds: string[]
  /** Groupe privé (« Moi seul ») : visible et modifiable par son créateur seul. */
  private?: boolean
  /** Groupe « Mon staff » (team) : visible par son créateur et ses participants seulement (supabase/031) ; jamais avec private. */
  team?: boolean
  /** Informations facultatives, pour filtrer et retrouver les groupes. */
  sex?: 'M' | 'F' | 'mixte'
  department?: string
  /** Identifiant de la région (liste « region » de hb_lists). */
  regionId?: string
  /** Portée du groupe : fédération (national), ligue (région) ou comité (département). Information seulement. */
  scope?: GroupScope
  /** Années de naissance concernées (ex. ['2010', '2011']). */
  years?: string[]
  /** Groupe d'une saison passée : caché des listes, gardé pour l'historique. */
  archived?: boolean
  /** Participants (encadrants) : ajoutent des joueurs, retirent ceux qu'ils ont ajoutés (supabase/023). */
  editors?: string[]
  /** Staffs choisis (supabase/034) : leurs membres du moment sont participants, comme ceux de editors. */
  teams?: string[]
  /** Qui a ajouté chaque joueur (identifiant de compte) ; tenu par le serveur. */
  addedBy?: Record<string, string>
  /** Noms des comptes cités (participants, « ajouté par »). */
  names?: Record<string, string>
  /**
   * « Suivi par le staff » (supabase/032_suivis.sql) : groupe « Mon staff » ou du staff qui compte comme suivi pour
   * son créateur et ses participants. Seul le créateur le change ; jamais sur un groupe privé.
   */
  teamFollow?: boolean
}

/**
 * Suivi personnel d'un joueur ou d'un groupe (supabase/032_suivis.sql) : visible par son seul créateur.
 * Identifiant fixe « <compte>:<player|group>:<cible> » (même ligne d'un appareil à l'autre) ;
 * arrêter de suivre = ligne supprimée (deleted), reprise si on suit à nouveau.
 */
export interface Follow extends Syncable {
  kind: 'player' | 'group'
  targetId: string
}

/**
 * Staff (supabase/034_equipes_encadrants.sql) : équipe d'encadrants enregistrée (« ETD Var »…), à choisir d'un clic
 * comme participants d'un groupe ou d'un événement. Visible par son créateur et ses membres seulement ;
 * modifiable par son créateur seul. Membres : comptes encadrants ; leurs noms sont tenus par le serveur.
 */
export interface Team extends Syncable {
  name: string
  description?: string
  members: string[]
  /** Noms des membres (affichage hors ligne). */
  names?: Record<string, string>
}

/** Conditions d'une alerte ; une condition absente ne filtre pas. */
export interface AlertRules {
  sex?: 'M' | 'F'
  years?: string[]
  /** Trimestres de naissance (1 à 4). */
  quarters?: number[]
  laterality?: Laterality
  positions?: Position[]
  /** Compter aussi les postes secondaires. */
  withSecondary?: boolean
  departments?: string[]
  /** Dernière taille mesurée ou déclarée (cm). */
  minHeight?: number
  /** Garder les joueurs sans taille connue. */
  keepMissingHeight?: boolean
  /** Taille adulte prédite (Khamis-Roche, cm) : il faut les tailles des parents. */
  minPredicted?: number
  /** Exclure les joueurs dont la taille prédite n'est pas calculable (par défaut ils sont gardés). */
  dropMissingPredicted?: boolean
  /** Dernière valeur d'un test : au moins (min) ou au plus (max) ; keepMissing : garder les non testés. */
  tests?: { criterionId: string; op: 'min' | 'max'; value: number; keepMissing?: boolean }[]
  /** Moyenne des avis validés sur un critère, au moins ; keepMissing : garder les joueurs sans avis. */
  avis?: { criterionId: string; min: number; keepMissing?: boolean }[]
}

/**
 * Alerte (supabase/022_alertes.sql) : un filtre enregistré ; l'appli signale les joueurs qui viennent d'y
 * entrer. Privée (son créateur seul) ou partagée au staff, comme les groupes.
 */
export interface PlayerAlert extends Syncable {
  name: string
  private?: boolean
  rules: AlertRules
}

/**
 * Élément d'une liste modifiable par les administrateurs (supabase/019_listes_regions.sql).
 * Régions (les groupes gardent leur identifiant) et départements (repérés par leur numéro).
 */
export interface ListItem extends Syncable {
  kind: 'region' | 'department'
  name: string
  /** Département : son numéro (83, 2A…), qui sert d'identifiant (licences, secteurs, groupes). */
  code?: string
  /** Département : sa région (identifiant d'une région de la liste) ; sinon, découpage officiel (lists.ts). */
  regionId?: string
  order: number
}

export interface OutboxItem {
  seq?: number
  table: SyncTable
  rowId: string
}

// Staffs avant les événements et les groupes : envoyés avant les groupes qui les citent, reçus avant eux (droits).
export const SYNC_TABLES = ['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts', 'follows'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

// ---------- Base locale ----------

/** Version d'essai (VITE_TRIAL=1, test en local avant publication) : sa propre base locale et un bandeau. */
export const TRIAL = !!import.meta.env.VITE_TRIAL
/** Démonstration en ligne (VITE_DEMO=1, base HandBase-test, données fictives) : bandeau dédié. */
export const DEMO = !!import.meta.env.VITE_DEMO
export const TRIAL_LABEL = DEMO ? 'DÉMONSTRATION · DONNÉES FICTIVES' : 'VERSION D’ESSAI'

export const db = new Dexie(TRIAL ? 'handbase-essai' : 'handbase') as Dexie & {
  players: EntityTable<Player, 'id'>
  criteria: EntityTable<Criterion, 'id'>
  measurements: EntityTable<Measurement, 'id'>
  events: EntityTable<HBEvent, 'id'>
  evaluations: EntityTable<Evaluation, 'id'>
  groups: EntityTable<PlayerGroup, 'id'>
  lists: EntityTable<ListItem, 'id'>
  alerts: EntityTable<PlayerAlert, 'id'>
  follows: EntityTable<Follow, 'id'>
  teams: EntityTable<Team, 'id'>
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

// v5 : adultes référents retirés de l'appli ; leurs copies sont effacées des appareils.
db.version(5)
  .stores({ referents: null })
  .upgrade((tx) => tx.table('outbox').where('table').equals('referents').delete())

// v6 : listes modifiables (régions).
db.version(6).stores({ lists: 'id, kind, updatedAt' })

// v7 : nouveaux tests physiques (plateforme de force, 6 RM, RSA, Shirado-Sorensen, épaule en degrés).
db.version(7).upgrade(applyDefaultCriteria)

// v8 : alertes.
db.version(8).stores({ alerts: 'id, name, updatedAt' })

// v9 : index sur l'état de validation (propositions à valider, sans parcourir toute la base).
db.version(9).stores({
  players: 'id, lastName, position, updatedAt, review',
  evaluations: 'id, playerId, eventId, observer, date, updatedAt, review',
})

// v10 : tests du FabLab (VMA, sprint 5 m, Illinois, CMJ bras libres, drop jumps et leur RSI).
db.version(10).upgrade(applyDefaultCriteria)

// v11 : suivis (joueurs et groupes suivis, supabase/032_suivis.sql).
db.version(11).stores({ follows: 'id, updatedAt' })

// v12 : staffs (équipes d'encadrants, supabase/034_equipes_encadrants.sql).
db.version(12).stores({ teams: 'id, name, updatedAt' })

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
  guardWrite() // « Voir comme… » : lecture seule
  let full = row as T
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    // Toujours plus récent que la version précédente, même si l'horloge de l'appareil a reculé
    // (sinon la modification perdrait contre l'ancienne version, ici ou sur le serveur).
    const prev = (await db.table(table).get(row.id)) as Row | undefined
    full = { ...row, updatedAt: Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1) } as T
    await db.table(table).put(full)
    await db.outbox.add({ table, rowId: full.id })
  })
  return full
}

/** Suppression logique : la ligne reste pour propager la suppression aux autres appareils. */
export async function remove(table: SyncTable, id: string) {
  guardWrite()
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

/**
 * Comme save(), pour plusieurs lignes d'une même table en une seule transaction (séance de tests…) :
 * même date de modification pour toutes, une entrée de file d'attente par ligne.
 */
export async function saveMany<T extends Row>(table: SyncTable, rows: (Omit<T, 'updatedAt'> & { updatedAt?: number })[]) {
  guardWrite()
  let full: T[] = []
  if (!rows.length) return full
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    // Comme save() : toujours plus récent que la version précédente de chaque ligne.
    const now = Date.now()
    const prev = (await db.table(table).bulkGet(rows.map((r) => r.id))) as (Row | undefined)[]
    full = rows.map((r, i) => ({ ...r, updatedAt: Math.max(now, (prev[i]?.updatedAt ?? 0) + 1) }) as T)
    await db.table(table).bulkPut(full)
    await db.outbox.bulkAdd(full.map((r) => ({ table, rowId: r.id })))
  })
  return full
}

// ---------- Utilitaires ----------

/** Jour (AAAA-MM-JJ) en heure locale (toISOString donne le jour UTC : encore la veille entre minuit et 2 h en été). */
export const localDay = (t: number) => new Date(t).toLocaleDateString('sv')
/** Jour local (AAAA-MM-JJ) d'un horodatage ISO : « 2026-10-07T23:23Z » est le 8 octobre à Paris. */
export const dayOf = (iso: string) => localDay(Date.parse(iso))

/** « 1 joueur », « 12 joueurs » (nombre à la française). */
export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`

export function age(birthDate?: string): number | null {
  if (!birthDate) return null
  // Date seule : lue en heure locale (sinon minuit UTC, la veille à l'ouest de Greenwich).
  const b = new Date(birthDate + 'T00:00:00')
  if (isNaN(b.getTime())) return null
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) a--
  return a
}

export const today = () => localDay(Date.now())

export const fmtDate = (d?: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR') : '—')

export const criterionApplies = (c: Criterion, pos?: Position) =>
  !c.positions || c.positions.length === 0 || (pos ? c.positions.includes(pos) : false)

export function scaleMax(scale: CriterionScale) {
  return scale === 'score5' ? 5 : scale === 'score3' ? 3 : scale === 'score2' ? 2 : null
}
export function scaleMin(scale: CriterionScale) {
  return scale === 'score5' ? 1 : 0
}
