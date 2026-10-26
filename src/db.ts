import Dexie, { type EntityTable } from 'dexie'
import { guardWrite, spyTarget } from './spy'
import { viewAsMiddleware } from './viewAsFilter'
import type { MatchSheet } from './matchSheet'
import type { QuestionLogFields } from './questionLogCore'

// ---------- Types ----------

// Postes : configuration de l'installation (src/sportConfig.ts, table hb_config ; handball par défaut). Les codes stockés
// dans les fiches (GB, AG…) ne changent pas ; POSITIONS est tenu à jour sur place quand la configuration change.
export { POSITIONS, positionLabel, type Position } from './sportConfig'
import type { Position } from './sportConfig'
import { isKeeper } from './sportConfig'
import type { AssignmentFields, LevelFields, UnitFields } from './structureTree'
// Espace joueur (supabase/051_espace_joueur.sql, src/playerSpace.ts) : ce que le jeune écrit lui-même sur sa fiche.
export type { JournalNote, LetterVersion, PlayerSelf, SelfClub, SelfLetter, SelfMarks, SelfPath } from './playerSpace'
import type { PlayerSelf } from './playerSpace'
import type { RewatchOrigin } from './rewatchCore'
import type { UsualTeam } from './rencontres'

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
  /** Niveau (plus saisi pour l'instant : le site suffit ; gardé pour pouvoir le remettre). */
  programme?: PoleProgramme
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
/**
 * Programmes du PPF 2025-2029. Garçons : accession territoriale (3e-2de) puis accession nationale (1re-Tle).
 * Filles : site d'accession (3e-2de, territorial ou national) puis site d'excellence (16-17 ans).
 * « accession » : premières saisies, sans précision.
 */
export type PoleProgramme = 'accession_territoriale' | 'accession_nationale' | 'excellence' | 'accession'
export const POLE_PROGRAMMES: { value: PoleProgramme; label: string; short: string }[] = [
  { value: 'accession_territoriale', label: 'Accession territoriale', short: 'Acc. territoriale' },
  { value: 'accession_nationale', label: 'Accession nationale', short: 'Acc. nationale' },
  { value: 'excellence', label: 'Excellence', short: 'Excellence' },
]
const PROGRAMME_LABEL: Record<PoleProgramme, string> = {
  accession: 'Accession',
  accession_territoriale: 'Accession territoriale',
  accession_nationale: 'Accession nationale',
  excellence: 'Excellence',
}

const filled = (x: PolePeriod) => !!(x.from || x.to || x.name || x.regionId || x.site)

/** Pôle Espoirs : « current » (en cours aujourd'hui), « past » (y est passé, en est sorti), sinon rien. */
export function poleStatus(p: Pick<Player, 'poles'>, today = new Date().toLocaleDateString('sv')): 'current' | 'past' | undefined {
  const ps = (p.poles ?? []).filter(filled)
  if (!ps.length) return undefined
  return ps.some((x) => (!x.from || x.from <= today) && (!x.to || x.to >= today)) ? 'current' : 'past'
}

/** Nom d'une période : « Pôle Espoirs Occitanie – Excellence (Toulouse) ». `region` donne le nom d'une ligue. */
export function poleName(x: PolePeriod, region: (id: string) => string | undefined = () => undefined) {
  const prog = x.programme && PROGRAMME_LABEL[x.programme]
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
  /**
   * Espace joueur (supabase/051_espace_joueur.sql, 052_journal_joueur.sql) : ce que le jeune (ou sa famille) a écrit lui-même
   * depuis son compte joueur (src/playerSpace.ts) : `letter` (« Ma lettre ») et `letterAt` (sa date), `letterHistory` (versions
   * précédentes, 20 au plus, tenues par le serveur), `marks` (« Mes repères »), `path` (« Mon parcours »). Écrit par le serveur
   * seul (hb_player_self_update), jamais par hb_upsert ni par le staff (le serveur remet `self` en place, 052). Montré sur la
   * fiche (section « Ce que dit le joueur ») ; absent des exports CSV / PDF du staff. Le journal du hand n'est PAS ici : table
   * hb_player_journal, privée, lue à la demande (src/playerJournal.ts).
   */
  self?: PlayerSelf
  /**
   * « Mon équipe » (supabase/056_rencontres.sql, src/rencontres.ts) : son équipe dans la catégorie (1, 2 ou 3), le niveau,
   * la catégorie où il joue en cas de surclassement ; `at` (quand) et `src` (joueur ou staff). Posée par le staff (formulaire
   * de la fiche) ou par le jeune depuis sa page (hb_player_set_team) ; sur le serveur, la plus récente gagne pour cette clé.
   * Sert à relier le joueur aux rencontres « Autour de moi ».
   */
  usualTeam?: UsualTeam
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
  /**
   * Écrit par un import de fichier (criteriaImport.ts) : sa date. Sa présence sur un appareil signale que la base
   * partagée tient la liste des critères (règle de transition : retireUnpublishedCriteria).
   */
  importedAt?: number
  /**
   * Radar par zones (src/radarZones.ts) : zone et couleur de la catégorie, posées sur tous les critères de la
   * catégorie depuis les réglages ; absentes = déduites du nom de la catégorie.
   */
  radarZone?: import('./radarZones').RadarZone
  radarColor?: string
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
  /** Heure de début (HH:MM), lue sur la feuille de match. */
  time?: string
  /**
   * Feuille de match importée (src/matchSheet.ts) : équipes, score, numéros et fiches reliées, déroulé, calage sur la
   * vidéo. Champ libre de l'événement, gardé tel quel par le serveur (hb_upsert, 037). Ni noms ni licences, ni le PDF.
   */
  matchSheet?: MatchSheet
  /**
   * Répartition d'un tournoi (supabase/041_reperage_tournoi.sql) : équipes engagées, équipe et numéro de chaque joueur
   * de la liste, équipes confiées à chaque observateur. Facultative : sans elle, tout le monde voit tout.
   */
  tournament?: Tournament
  /**
   * Unité organisatrice (structure, hb_units ; src/eventOrganizer.ts, supabase/048_evenements_organisateur.sql) : décide
   * qui voit l'événement (son territoire et les unités au-dessus, plus créateur et participants). Facultative : les
   * événements d'avant n'en ont pas (« Organisateur non précisé », visibles par tout le staff).
   */
  organizerUnitId?: string
  /** Nom de l'unité organisatrice au moment du choix (affichage si l'unité n'est pas sur l'appareil), comme `names`. */
  organizerName?: string
  /**
   * Garçons / Filles / Mixte (facultatif ; affichage accordé, src/gender.ts). Absent : déduit des joueurs de la liste
   * (setGender). Champ libre de data (jsonb), gardé tel quel par le serveur (hb_upsert) : pas de SQL.
   */
  sex?: 'M' | 'F' | 'mixte'
}

/** Équipe engagée dans un tournoi (identifiant court, propre à l'événement). */
export interface TournamentTeam {
  id: string
  name: string
}

export interface Tournament {
  teams: TournamentTeam[]
  /** Pour chaque joueur de la liste : son équipe et son numéro de maillot (comme sur une feuille de match). */
  players?: Record<string, { team?: string; num?: string }>
  /** Équipes confiées à chaque observateur (compte) ; réattribuables à tout moment. */
  assign?: Record<string, string[]>
}

/** Contexte d'un avis spontané (joueur vu hors des événements prévus). */
export type ContextType = 'unss' | 'club' | 'match' | 'selection' | 'video' | 'autre'

export const CONTEXT_TYPES: { value: ContextType; label: string }[] = [
  { value: 'unss', label: 'UNSS / scolaire' },
  { value: 'club', label: 'Entraînement club' },
  { value: 'match', label: 'Match' },
  { value: 'selection', label: 'Sélection' },
  // Joueur vu à l'écran (Rematch, YouTube…), pas sur place : mention « Vidéo » sur l'avis.
  { value: 'video', label: 'Vidéo' },
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
  /**
   * Groupe « Pôle » d'une unité de la structure (src/poleSeason.ts) : permanent (ni archivé ni dupliqué, un seul par
   * unité), et ses membres ne sont PAS dans playerIds (laissé vide) : ils sont calculés depuis les périodes de pôle des
   * fiches (Player.poles) qui correspondent à l'unité et couvrent la date de la vue (saison en cours / prochaine).
   */
  poleUnitId?: string
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

/**
 * Lien vidéo (supabase/036_videos.sql) sur un joueur ou un événement : on ne garde que le lien (Rematch, YouTube…),
 * jamais la vidéo. Tout compte avec un rôle en ajoute ; son auteur le modifie ; son auteur, un administrateur ou un
 * encadrant (secteur du joueur) le supprime. Auteur et date : signature du serveur (createdByName, createdAtServer).
 */
export interface Video extends Syncable {
  targetKind: 'player' | 'event'
  targetId: string
  url: string
  title?: string
  /**
   * Moment à regarder, en secondes depuis le début (YouTube : la vidéo s'ouvre à ce moment). Avec une liste de
   * moments : début du premier (gardé pour les anciennes versions de l'appli, 037_moments_video.sql).
   */
  at?: number
  /** Moments à regarder (037), triés par début ; absent sur une ligne plus ancienne (at seul = un moment). */
  moments?: VideoMoment[]
}

/** Un passage d'une vidéo : début (secondes), durée facultative (secondes, 600 au plus), note (120 caractères). */
export interface VideoMoment {
  at: number
  dur?: number
  note?: string
}

/**
 * « Vu » (supabase/041_reperage_tournoi.sql) : un observateur a vu ce joueur pendant cet événement. Identifiant fixe
 * « <compte>:<événement>:<joueur> » (même ligne d'un appareil à l'autre) ; le retirer = ligne supprimée, reprise si on
 * le remet. Visible par tous ceux qui voient l'événement. Marque neutre : il n'existe aucun « vu, pas retenu ».
 */
export interface Seen extends Syncable {
  eventId: string
  playerId: string
  /** Moment où il a été marqué vu (ISO), posé par le serveur. */
  at?: string
}

/**
 * « À revoir » (supabase/041) : un encadrant ou un observateur veut revoir ce joueur, à un ou plusieurs événements à
 * venir, dans un ou plusieurs groupes, ou sans destination (liste « À revoir » générale). Visible par le staff de son
 * auteur et par les administrateurs. Ce n'est pas une convocation : la liste des événements visés ne change pas.
 */
export interface Rewatch extends Syncable {
  playerId: string
  /** Événement où il a été repéré. */
  originEventId?: string
  /**
   * D'où il a été posé (supabase/055, src/rewatchCore.ts) : événement, groupe, liste Joueurs (nom du filtre enregistré ou
   * filtres posés), fiche, bilan… Fixé à la création ; absent sur les « à revoir » d'avant (originEventId suffit alors).
   */
  origin?: RewatchOrigin
  /** Événements à venir visés. */
  events?: string[]
  /** Groupes visés (le joueur y est ajouté). */
  groups?: string[]
  note?: string
  /** « Revu » coché à la main (groupes, sans destination) ; posé par le serveur : quand, par qui. */
  done?: { at?: string; by?: string; byName?: string }
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

/**
 * « Journal des questions avancées » (supabase/043_journal_questions.sql, src/questionLog.ts) : un passage de « Poser une
 * question » en mode avancé. Phrase et requête anonymisées, jamais de résultat ni de donnée de joueur. Administrateurs seulement.
 */
export interface QuestionLog extends Syncable, QuestionLogFields {}

/**
 * Configuration de l'installation (supabase/044_structure.sql, src/sportConfig.ts) : une ligne par clé (identifiant = clé :
 * « sport », « postes »…), valeur libre. Table vide : valeurs par défaut handball. Lecture : tous ; écriture : administrateurs.
 */
export interface ConfigItem extends Syncable {
  key: string
  value: unknown
}

/** Structure (supabase/044_structure.sql, src/structureTree.ts) : niveaux, unités, affectations. Écriture : administrateurs. */
export interface Level extends Syncable, LevelFields {}
export interface Unit extends Syncable, UnitFields {}
export interface Assignment extends Syncable, AssignmentFields {}

/**
 * « Mes questions » / « Mes filtres » enregistrés, gardés sur le compte (supabase/054_questions_enregistrees.sql,
 * src/savedQuestions.ts) : personnels, lus et écrits par leur seul créateur (administrateurs compris : ils ne les voient pas).
 * Identifiant « <compte>:<identifiant> ». Supprimée : il ne reste que l'identifiant.
 */
export interface SavedQuestionRow extends Syncable {
  name?: string
  recipe?: unknown
  vars?: string[]
  phrase?: string
  /** Moment de l'enregistrement (horloge de l'appareil). */
  at?: number
  sql?: unknown
}

export interface OutboxItem {
  seq?: number
  table: SyncTable
  rowId: string
}

// Staffs avant les événements et les groupes : envoyés avant les groupes qui les citent, reçus avant eux (droits).
// Vidéos, « vu » et « à revoir » en dernier : le serveur vérifie que le joueur, l'événement ou le groupe visé existe
// (envoyé juste avant). Structure (044) : niveaux avant unités avant affectations (le serveur vérifie que le niveau, le
// parent, l'unité visés existent). Journal des questions avancées (043) et questions enregistrées (054) : indépendants du
// reste, à la fin.
export const SYNC_TABLES = ['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts', 'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log', 'saved_questions'] as const
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
  videos: EntityTable<Video, 'id'>
  seen: EntityTable<Seen, 'id'>
  rewatch: EntityTable<Rewatch, 'id'>
  question_log: EntityTable<QuestionLog, 'id'>
  config: EntityTable<ConfigItem, 'id'>
  levels: EntityTable<Level, 'id'>
  units: EntityTable<Unit, 'id'>
  assignments: EntityTable<Assignment, 'id'>
  saved_questions: EntityTable<SavedQuestionRow, 'id'>
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

/*
 * Critères : plus aucune liste dans le code. Ils viennent tous de la base partagée (hb_criteria), importés par un
 * administrateur depuis un fichier (Réglages > Critères et listes, criteriaImport.ts). Une base neuve démarre sans
 * critère ; les anciennes versions 2, 7 et 10 (qui ajoutaient les critères livrés) restent déclarées, sans effet.
 * Critères déjà sur l'appareil et jamais publiés : voir la règle de transition (retireUnpublishedCriteria).
 */

// v2 : ajoutait des critères livrés (critères de champ, gardien) ; sans effet désormais.
db.version(2).stores({})

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

// v7 : ajoutait des tests physiques livrés ; sans effet désormais.
db.version(7).stores({})

// v8 : alertes.
db.version(8).stores({ alerts: 'id, name, updatedAt' })

// v9 : index sur l'état de validation (propositions à valider, sans parcourir toute la base).
db.version(9).stores({
  players: 'id, lastName, position, updatedAt, review',
  evaluations: 'id, playerId, eventId, observer, date, updatedAt, review',
})

// v10 : ajoutait les tests du FabLab livrés ; sans effet désormais.
db.version(10).stores({})

// v11 : suivis (joueurs et groupes suivis, supabase/032_suivis.sql).
db.version(11).stores({ follows: 'id, updatedAt' })

// v12 : staffs (équipes d'encadrants, supabase/034_equipes_encadrants.sql).
db.version(12).stores({ teams: 'id, name, updatedAt' })

// v13 : liens vidéo (supabase/036_videos.sql).
db.version(13).stores({ videos: 'id, targetId, updatedAt' })

// v14 : « vu » et « à revoir » (supabase/041_reperage_tournoi.sql).
db.version(14).stores({ seen: 'id, eventId, playerId, updatedAt', rewatch: 'id, playerId, *events, *groups, updatedAt' })

// v15 : journal des questions avancées (supabase/043_journal_questions.sql).
db.version(15).stores({ question_log: 'id, at, updatedAt' })

// v16 : configuration de l'installation et structure (supabase/044_structure.sql).
db.version(16).stores({
  config: 'id, updatedAt',
  levels: 'id, updatedAt',
  units: 'id, parentId, levelId, updatedAt',
  assignments: 'id, unitId, userId, updatedAt',
})

// v17 : questions et filtres enregistrés, sur le compte (supabase/054_questions_enregistrees.sql).
db.version(17).stores({ saved_questions: 'id, updatedAt' })

// « Voir comme… » : l'écran ne lit que le périmètre du membre simulé (src/viewAsFilter.ts). Hors simulation : rien.
if (spyTarget()) db.use(viewAsMiddleware)

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

/**
 * Le critère concerne-t-il ce poste ? Joueur sans poste renseigné : on montre tous les critères de joueur de champ
 * (seuls ceux réservés aux gardiens, famille « gardien » de la configuration, sont écartés), plutôt que de n'en garder que quelques-uns.
 */
export const criterionApplies = (c: Criterion, pos?: Position) =>
  !c.positions || c.positions.length === 0 || (pos ? c.positions.includes(pos) : c.positions.some((p) => !isKeeper(p)))

export function scaleMax(scale: CriterionScale) {
  return scale === 'score5' ? 5 : scale === 'score3' ? 3 : scale === 'score2' ? 2 : null
}
export function scaleMin(scale: CriterionScale) {
  return scale === 'score5' ? 1 : 0
}
