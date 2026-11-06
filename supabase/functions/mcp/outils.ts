// Nextar : les outils du serveur MCP (six ici ; les quatre outils d'administration sont dans admin.ts), en fonctions PURES (ni Deno, ni réseau, ni base) : elles reçoivent une `Source`
// (accès aux données AUX DROITS DU COACH : source.ts avec le client Supabase de son jeton ; un jeu fictif dans
// tools/test-mcp.ts) et rendent un objet JSON. serveur.ts les branche dans le SDK MCP.
//
// RÈGLE ABSOLUE : NEXTAR N'ENVOIE JAMAIS DE DONNÉES DE JOUEUR À UNE IA. Aucune réponse ne contient un nom, un prénom, une date
// de naissance complète, un club, un numéro de licence, un commentaire libre d'avis ni une fiche. Seulement des CODES
// (« J-7K3Q2MX », src/codesJoueurs.ts), le poste, l'année de naissance, le sexe, le département, des mesures, des moyennes
// d'avis et des nombres de « vus ». Trois verrous :
//  1. la lecture (nextar_lire) ne demande même pas les noms à la base (source.joueursLire ne rend que id, année, sexe, poste,
//     département) ; seul le rapprochement de nextar_proposer lit des noms, côté serveur, et n'en rend aucun ;
//  2. chaque réponse passe par verifierSortie : liste BLANCHE des clés (une clé inconnue arrête tout, l'outil répond par une
//     erreur), clés interdites (nom, prenom, birthDate, club, licence, commentaire…), textes bornés ;
//  3. tools/test-mcp.ts appelle chaque outil sur un jeu fictif et cherche dans les réponses les noms, prénoms, dates de
//     naissance, clubs et licences du jeu : aucun ne doit y être.
// Ce que le coach donne lui-même à Claude (une photo avec des noms) entre par nextar_proposer ; Nextar ne renvoie que des
// codes et un état par ligne, sans répéter ce qu'il a reçu (ni noms, ni en-têtes de colonnes).
// Rien n'est écrit dans les fiches : nextar_proposer dépose dans la boîte « À valider » (hb_propositions, source « mcp »),
// comme nextar_proposer_avis, _vus et _a_revoir (proposerJoueurs.ts : sortes « avis », « vus », « a_revoir » ; le texte du
// coach, points forts, axes ou raison, est gardé dans la proposition et jamais rendu) ; nextar_rapport garde un texte en
// codes pour son auteur seul (hb_rapports, supabase/068_rapports.sql).
// Exception voulue, et la seule : nextar_connexions (administrateurs seulement) rend le NOM AFFICHÉ et le rôle des COMPTES
// du staff connectés (jamais une adresse mail, un téléphone, un identifiant brut, une adresse IP ni un appareil détaillé ;
// aucune donnée de joueur). Sa réponse passe par sa propre liste blanche (CLES_CONNEXIONS : « nom_affiche » n'est permis
// que là) et par un contrôle des textes (aucun « @ », aucune adresse IP). Même régime pour les quatre outils
// d'administration en lecture seule (admin.ts : nextar_admin_a_faire, _sante, _activite, _questions) : refus sans rien lire
// pour un compte qui n'est pas administrateur, une liste blanche par outil (CLES_ADMIN), joueurs en codes seulement. Et
// nextar_admin_proposer (adminProposer.ts), le seul outil d'administration qui écrit : il DÉPOSE des actions d'administration
// (rôles, périmètres, archivage, fusions) dans la boîte « À valider » de l'administrateur (hb_propositions, sorte « admin »,
// supabase/070_propositions_admin.sql) ; rien ne s'applique avant que l'administrateur les valide dans l'appli.

import { codeJoueur, codesDuTexte, indexCodes } from './partage/codesJoueurs.ts'
import {
  importable,
  matchPlayer,
  parseTable,
  propose,
  type Candidate,
  type ImportCriterion,
  type PlayerMatch,
} from './partage/importMesures.ts'
import { nameKey, phonetic } from './partage/nameMatch.ts'
import { resolveSportConfig, type ConfigRow } from './partage/sportConfig.ts'

// ---------- Données lues (par la Source, aux droits du coach) ----------

export interface CritereSrv {
  id: string
  label: string
  category?: string
  kind?: 'factual' | 'subjective'
  scale?: 'score5' | 'score3' | 'score2' | 'number' | 'text' | 'choice'
  unit?: string
  options?: string[]
  positions?: string[]
  active?: boolean
  order?: number
  deleted?: boolean
}

export interface EvenementSrv {
  id: string
  name: string
  type?: string
  date?: string
  archived?: boolean
  playerIds?: string[]
  /** Numéros de maillot par fiche (tournoi, feuille de match) : rapprochement seulement, jamais rendus. */
  nums?: Record<string, string>
}

export interface GroupeSrv {
  id: string
  name: string
  archived?: boolean
  playerIds?: string[]
  /** Groupe d'une unité Pôle (src/poleSeason.ts) : jamais archivé à la main (changement de saison). */
  pole?: boolean
}

/** Unité de la structure (hb_units, 044) : identifiant et nom seulement. */
export interface UniteSrv {
  id: string
  name: string
}

/** Joueur pour nextar_lire : AUCUN nom, aucune date complète, aucun club. */
export interface JoueurLire {
  id: string
  annee?: number
  sexe?: 'M' | 'F'
  poste?: string
  dept?: string
}

/** Joueur pour le rapprochement de nextar_proposer (noms lus côté serveur, jamais rendus). */
export interface JoueurNom {
  id: string
  firstName: string
  lastName: string
  birthDate?: string
}

export interface MesureSrv {
  playerId: string
  criterionId: string
  value: number | string
  date: string
}

export interface AvisSrv {
  playerId: string
  date?: string
  scores: Record<string, number | string>
}

export interface VuSrv {
  playerId: string
  eventId: string
}

export interface PropositionSrv {
  id: string
  source: string
  kind: string
  titre: string
  etat: string
  nbLignes: number
  created_at: string
  updated_at: string
  expires_at: string
  deleted_at?: string | null
}

export interface FiltreJoueurs {
  ids?: string[]
  annees?: number[]
  sexe?: 'M' | 'F'
  postes?: string[]
  depts?: string[]
}

/** Accès aux données, toujours AUX DROITS DU COACH (règles de lecture de la base, périmètre, rôle). */
export interface Source {
  criteres(): Promise<CritereSrv[]>
  config(): Promise<ConfigRow[]>
  evenements(o: { archives: boolean }): Promise<EvenementSrv[]>
  evenement(id: string): Promise<EvenementSrv | null>
  groupes(o: { archives: boolean }): Promise<GroupeSrv[]>
  groupe(id: string): Promise<GroupeSrv | null>
  /** Joueurs vivants du périmètre (ni supprimés, ni fondus, ni hors cadre), au plus `max` ; `tronque` si plus. */
  joueursLire(f: FiltreJoueurs, max: number): Promise<{ joueurs: JoueurLire[]; tronque: boolean }>
  /** Noms pour le rapprochement : ces fiches (null : tout le périmètre), au plus `max`. */
  joueursNoms(ids: string[] | null, max: number): Promise<{ joueurs: JoueurNom[]; tronque: boolean }>
  mesures(playerIds: string[]): Promise<MesureSrv[]>
  avis(playerIds: string[]): Promise<AvisSrv[]>
  vus(playerIds: string[]): Promise<VuSrv[]>
  /**
   * Dépose une proposition dans la boîte « À valider » du coach (hb_propositions, 067). `kind` : « mesures » (défaut, lignes
   * en cellules), ou « avis », « vus », « a_revoir » (nextar_proposer_avis, _vus, _a_revoir : une ligne objet par joueur,
   * src/propositionsJoueursCore.ts).
   */
  deposerProposition(p: { titre: string; contexte: Record<string, unknown>; lignes: string[][] | Record<string, unknown>[]; kind?: 'mesures' | 'avis' | 'vus' | 'a_revoir' }): Promise<{ id: string } | { erreur: string }>
  proposition(id: string): Promise<PropositionSrv | null>
  propositions(limite: number): Promise<PropositionSrv[]>
  deposerRapport(r: { titre: string; contenu: string }): Promise<{ id: string; expires_at: string } | { erreur: string }>
  /** Le compte du jeton est-il administrateur ? (hb_is_admin, supabase/043 ; erreur ou fonction absente : non). */
  estAdmin(): Promise<boolean>
  /**
   * Ouvertures de l'appli vues depuis `depuis` (ISO), la plus récente d'abord, au plus `max` (supabase/030 : lisibles par les
   * administrateurs seulement ; type d'appareil tel qu'envoyé par l'appli, ni adresse IP ni navigateur).
   */
  connexions(depuis: string, max: number): Promise<{ sessions: SessionSrv[]; tronque: boolean }>
  /** Nom, rôle, secteur et unités d'affectation de ces comptes (hb_profiles, hb_assignments, hb_units) ; JAMAIS l'adresse mail. */
  comptes(userIds: string[]): Promise<CompteSrv[]>

  // ---- Administration (outils nextar_admin_*, admin.ts) : appelées APRÈS estAdmin() seulement, aux droits du compte ----
  /** Comptes visibles (hb_profiles : staff et comptes sans rôle ; ni email, ni phone). */
  profils(): Promise<ProfilSrv[]>
  /** Fiches joueur proposées en attente (review « pending », ni supprimées ni fondues), les plus anciennes d'abord ; total. */
  fichesAValider(max: number): Promise<{ fiches: FicheAValiderSrv[]; total: number }>
  /** Avis spontanés en attente (review « pending »), les plus anciens d'abord ; total. */
  avisAValider(max: number): Promise<{ avis: AvisAValiderSrv[]; total: number }>
  /**
   * Prénom, nom, date de naissance et état de validation des fiches (ni supprimées, ni fondues) : doublons probables et
   * masquage des noms dans les questions, CÔTÉ SERVEUR. Jamais rendus.
   */
  nomsJoueurs(max: number): Promise<{ joueurs: NomJoueurSrv[]; tronque: boolean }>
  /** Propositions « À valider » du compte encore en attente (067 ; table absente : aucune). */
  propositionsEnAttente(max: number): Promise<{ propositions: PropositionSrv[]; total: number }>
  /** Journal des questions (043) depuis `depuis` (ISO), sans requête SQL ni nom d'auteur ; au plus `max`. */
  journal(depuis: string, max: number): Promise<{ lignes: JournalSrv[]; tronque: boolean }>
  /** Nombre de lignes vivantes (liste fermée de comptages) ; illisible : null. */
  compter(quoi: Comptage): Promise<number | null>
  /** État de l'installation par supabase/069_admin_sante.sql (hb_admin_sante) ; script pas appliqué : « absente ». */
  sante(): Promise<{ ok: Record<string, unknown> } | { absente: true } | { erreur: string }>
  /** Dernière ouverture de l'appli de chaque compte (hb_last_seen, 030). */
  dernieresVues(): Promise<{ userId: string; lastSeenAt: string }[]>
  /** Dernière écriture notée à l'historique (hb_audit, 004) : de ce compte, ou de tous (sans argument). */
  derniereEcriture(userId?: string): Promise<string | null>
  /** Lignes créées par ce compte depuis `depuis` (ISO) : avis, mesures, événements, « vus », fiches (créateur de la ligne). */
  activite(userId: string, depuis: string): Promise<ActiviteSrv>

  // ---- nextar_admin_proposer (adminProposer.ts) : appelées APRÈS estAdmin() seulement, aux droits du compte ----
  /** Identifiant du compte du jeton (claims vérifiés par withSupabase) ; inconnu : null. Jamais rendu. */
  moi(): Promise<string | null>
  /** Unités de la structure (044), identifiant et nom ; table absente : aucune. */
  unites(): Promise<UniteSrv[]>
  /** Identifiants des fiches (ni supprimées) et si elles sont déjà fondues : rien d'autre (codes J-… résolus ici). */
  idsFiches(max: number): Promise<{ fiches: { id: string; fondue: boolean }[]; tronque: boolean }>
  /**
   * Dépose une proposition d'ADMINISTRATION (sorte « admin », supabase/070_propositions_admin.sql) dans la boîte « À valider »
   * du compte ; 070 pas appliqué (sorte refusée par la table) : « indisponible ».
   */
  deposerPropositionAdmin(p: { titre: string; contexte: Record<string, unknown>; lignes: Record<string, unknown>[] }): Promise<{ id: string } | { indisponible: true } | { erreur: string }>
}

/** Comptages permis à Source.compter (source.ts : table et filtres fixes pour chacun). */
export type Comptage =
  | 'joueurs'
  | 'joueurs_fondus'
  | 'joueurs_revus'
  | 'mesures'
  | 'avis'
  | 'evenements'
  | 'groupes'
  | 'vus'
  | 'videos'
  | 'a_revoir'
  | 'criteres'
  | 'listes'
  | 'unites'
  | 'affectations'
  | 'rencontres'
  | 'journal_questions'
  | 'historique'
  | 'connexions'
  | 'alertes'

/** Compte vu par un administrateur (hb_profiles) : ni adresse mail, ni téléphone. */
export interface ProfilSrv {
  userId: string
  fullName?: string | null
  role?: string | null
  createdAt?: string | null
}

/** Fiche proposée en attente : ce qui peut sortir (année, poste, département) et son auteur ; aucun nom. */
export interface FicheAValiderSrv {
  id: string
  annee?: number
  poste?: string
  dept?: string
  createdBy?: string | null
  createdAt?: string | null
}

/** Avis spontané en attente : joueur (rendu en code), date, auteur ; ni notes ni commentaires. */
export interface AvisAValiderSrv {
  playerId: string
  date?: string | null
  createdBy?: string | null
  createdAt?: string | null
}

/** Nom d'une fiche, lu côté serveur pour les doublons et le masquage ; jamais rendu. */
export interface NomJoueurSrv {
  id: string
  firstName: string
  lastName: string
  birthDate?: string
  /** pending | validated | refused (fiche proposée, validée, hors cadre). */
  review?: string
}

/** Ligne du journal des questions (043, 049) : ni requête SQL, ni détail d'erreur, ni nom d'auteur. */
export interface JournalSrv {
  id: string
  at: string
  authorId?: string
  phrase?: string
  recipe?: string
  status?: string
  recipeMissing?: string[]
  display?: string
  page?: string
  kind?: string
  questionId?: string
  verdict?: string
  comment?: string
  recipeDone?: boolean
}

/** Lignes créées par un compte sur une période (null : illisible). */
export interface ActiviteSrv {
  avis: number | null
  mesures: number | null
  evenements: number | null
  vus: number | null
  fiches: number | null
}

/** Une ouverture de l'appli (hb_connections). */
export interface SessionSrv {
  userId: string
  /** Texte de l'appli (« iPhone (appli installée) », « Ordinateur »…) : jamais rendu tel quel. */
  device?: string | null
  startedAt: string
  lastSeenAt: string
}

/** Compte du staff, pour nextar_connexions : ni adresse mail, ni téléphone. */
export interface CompteSrv {
  userId: string
  fullName?: string | null
  role?: string | null
  /** Secteur du profil (hb_profiles.departments). */
  departments?: string[] | null
  /** Unités où le compte est affecté (supabase/044), sans adresse. */
  unites?: { name: string; depts?: string[]; club?: string; federation?: boolean }[]
}

export interface Reglages {
  /** Adresse de l'appli (liens vers la boîte et les rapports), sans « / » final ; vide : liens relatifs. */
  appUrl: string
  /** Sport par défaut quand la base n'a pas de ligne « sport » (NEXTAR_SPORT). */
  sport?: string
  /** Aujourd'hui (AAAA-MM-JJ, heure de Paris). */
  today: string
  /** Maintenant (ms depuis 1970) ; absent : l'horloge du serveur. */
  maintenant?: number
}

// ---------- Bornes ----------

export const BORNES = {
  /** Lignes d'une proposition (en-tête compris) : comme supabase/067_propositions.sql. */
  lignes: 300,
  /** Taille des lignes déposées (JSON). */
  octets: 200 * 1024,
  /** Cellule. */
  cellule: 200,
  /** Colonnes. */
  colonnes: 40,
  /** Joueurs du contexte gardés avec la proposition (comme src/propositionsCore.ts). */
  joueursContexte: 600,
  /** Joueurs lus pour le rapprochement sur toute la base. */
  rapprochementTous: 20_000,
  /** Au-delà, le rapprochement passe par un premier tri sur le son des noms. */
  prefiltre: 2_000,
  /** Joueurs considérés par nextar_lire avant les filtres sur mesures, avis et vus. */
  lireAvant: 5_000,
  /** Lignes rendues par nextar_lire. */
  lireMax: 200,
  lireDefaut: 50,
  /** Événements et groupes listés par nextar_contexte. */
  liste: 100,
  /** Rapport (texte Markdown) : comme supabase/068_rapports.sql. */
  rapport: 100_000,
  titreRapport: 120,
  titreProposition: 80,
  /** nextar_connexions : fenêtre en minutes (défaut, bornes : 1 min à 7 jours), personnes rendues, ouvertures lues. */
  connexionsMinutes: 10,
  connexionsMinutesMax: 10_080,
  connexionsDefaut: 50,
  connexionsMax: 200,
  connexionsSessions: 5_000,
  /** Outils d'administration (admin.ts). Éléments rendus par file (nextar_admin_a_faire). */
  aFaireDefaut: 10,
  aFaireMax: 50,
  /** Fiches lues pour les doublons et le masquage des noms (au-delà : pas de doublons, questions en catégories seulement). */
  nomsMax: 100_000,
  /** Lignes du journal des questions lues. */
  journalMax: 5_000,
  /** Périodes en jours (activité, questions, inactivité) : défaut 30, de 1 à 365. */
  joursDefaut: 30,
  joursMax: 365,
  /** Comptes du staff passés en revue (nextar_admin_activite) ; comptes rendus (défaut, maximum). */
  activiteComptes: 200,
  activiteDefaut: 50,
  activiteMax: 200,
  /** Groupes de questions rendus (défaut, maximum). */
  questionsDefaut: 20,
  questionsMax: 100,
  /** nextar_admin_proposer : actions par proposition (comme supabase/070_propositions_admin.sql). */
  adminActions: 50,
} as const

// ---------- Vérification des réponses (liste blanche) ----------

/** Clés permises dans une réponse d'outil. Toute autre clé arrête la réponse (erreur). */
const CLES = new Set([
  // communes
  'erreur', 'message', 'avertissements', 'id', 'lien', 'lien_boite', 'etat', 'titre', 'source', 'date', 'expire_le',
  'creee_le', 'mise_a_jour_le', 'propositions', 'possibles', 'suggestions', 'limites', 'regles',
  // contexte
  'sport', 'postes', 'code', 'libelle', 'famille', 'tests', 'categorie', 'unite', 'echelle', 'options', 'criteres_avis',
  'evenements', 'groupes', 'type', 'joueurs', 'archive', 'lignes_par_proposition', 'lire_max', 'rapport_max',
  // proposer / suivi
  'portee', 'colonnes', 'colonne', 'role', 'test_id', 'lignes', 'ligne', 'valeurs', 'alertes', 'code_partage', 'resume',
  'trouves', 'a_verifier', 'plusieurs', 'introuvables', 'a_rapprocher', 'nb_lignes',
  // lire
  'poste', 'annee', 'sexe', 'departement', 'vus', 'mesures', 'valeur', 'avis', 'moyenne', 'nb', 'criteres', 'total',
  'tronque', 'legende', 'tri',
  // rapport
  'codes', 'codes_invalides',
  // proposer_avis, proposer_vus, proposer_a_revoir (proposerJoueurs.ts) ; suivi : sorte de la proposition
  'sorte', 'evenement', 'refusees', 'raison', 'nb_notes', 'notes_refusees', 'critere', 'avec_texte', 'avec_raison', 'contexte_avis',
])
/** Objets dont les clés sont libres (identifiants de tests ou de critères) ; leurs valeurs restent vérifiées. */
const DICTS = new Set(['mesures', 'criteres', 'legende'])
/**
 * nextar_connexions (administrateurs) : SA liste blanche, la seule où un nom (celui d'un COMPTE du staff) peut sortir, sous
 * la clé « nom_affiche ». Aucune clé des outils de joueurs n'y est permise, et inversement.
 */
const CLES_CONNEXIONS = new Set([
  'erreur', 'message', 'avertissements', 'total', 'tronque', 'fenetre_minutes', 'depuis', 'maintenant', 'connexions',
  'compte', 'nom_affiche', 'role', 'perimetre', 'derniere_activite', 'il_y_a', 'appareil', 'appli_installee', 'sessions',
])
/**
 * Outils d'administration (admin.ts) : une liste blanche PAR OUTIL, comme nextar_connexions (« nom_affiche » : nom d'un
 * COMPTE du staff ; joueurs en codes « code » / « codes » seulement ; aucune clé de nom, de mail, de téléphone, d'IP).
 */
const COMMUNES_ADMIN = ['erreur', 'message', 'avertissements', 'maintenant', 'total', 'tronque', 'compte', 'nom_affiche', 'role', 'il_y_a', 'nb']
export const CLES_ADMIN: Record<string, Set<string>> = {
  nextar_admin_a_faire: new Set([
    ...COMMUNES_ADMIN, 'resume', 'comptes_sans_role', 'fiches_a_valider', 'avis_a_valider', 'doublons', 'propositions_en_attente',
    'questions_a_traiter', 'depuis', 'code', 'codes', 'poste', 'annee', 'departement', 'proposee_le', 'par', 'date', 'deposee_le',
    'raison', 'id', 'titre', 'nb_lignes', 'creee_le', 'expire_le', 'liens', 'validation', 'membres', 'boite', 'journal',
  ]),
  nextar_admin_sante: new Set([
    ...COMMUNES_ADMIN, 'volumes', 'table', 'libelle', 'lignes', 'precision', 'comptes', 'par_role', 'connexions', 'comptes_24h',
    'comptes_7j', 'comptes_30j', 'appareils_30j', 'appareil', 'appli_installee_30j', 'version_appli', 'derniere_ecriture',
    'script_069', 'base', 'taille_octets', 'taille', 'postgres', 'tables', 'lignes_estimees', 'registre', 'lignes_24h',
    'pertes_24h', 'derniere', 'purge_le', 'charge', 'niveau', 'jusqua', 'en_cours', 'annonce_le', 'abonnements',
    'par_appareil', 'sans_envoi_reussi_30j', 'veille', 'jour', 'appareils', 'envoyes', 'notifications', 'en_attente',
    'plus_ancienne', 'taches', 'tache', 'derniere_execution', 'dernier_etat', 'echecs_7j', 'executions_7j', 'transcription',
    'periode', 'journal_questions', 'questions_7j', 'erreurs_7j', 'indisponible',
  ]),
  nextar_admin_activite: new Set([
    ...COMMUNES_ADMIN, 'periode_jours', 'depuis', 'comptes', 'avis', 'mesures', 'evenements', 'vus', 'fiches',
    'derniere_activite', 'inactifs', 'seuil_jours', 'totaux',
  ]),
  nextar_admin_questions: new Set([
    ...COMMUNES_ADMIN, 'periode_jours', 'depuis', 'filtre', 'resume', 'questions', 'a_traiter', 'ratees', 'sauvees', 'comprises',
    'comptes', 'avis', 'super', 'mauvaise', 'sans_reponse', 'groupes', 'formulation', 'autres_formulations', 'issue', 'recette',
    'complete', 'partielle', 'pas_comprise', 'mode_avance', 'lance', 'reponse_calculee', 'pas_applique', 'ce_qu_ils_voulaient',
    'pages', 'page', 'derniere', 'transformee', 'par_page', 'masquage', 'noms_connus',
  ]),
  // Seul outil d'administration qui ÉCRIT : il dépose une proposition dans la boîte « À valider » de l'administrateur.
  nextar_admin_proposer: new Set([
    ...COMMUNES_ADMIN, 'id', 'etat', 'titre', 'sorte', 'resume', 'pretes', 'refusees', 'actions', 'n', 'raison', 'role_actuel',
    'unite', 'role_unite', 'secteur', 'quoi', 'libelle', 'date', 'garder', 'fondre', 'lien_boite', 'reste',
  ]),
}

/** Jamais dans une réponse, même dans un dictionnaire (comparé aussi après retrait des signes : « e-mail », « userAgent »). */
const INTERDITES =
  /^(nom|noms|prenom|prenoms|firstname|lastname|name|fullname|full_name|birthdate|naissance|date_naissance|ddn|club|clubs|clubcode|licence|license|licences|previouslicenses|email|emails|e_mail|mail|mails|courriel|telephone|phone|phones|adresse_ip|ip_address|ipaddress|user_agent|useragent|user_id|userid|token|tokens|jeton|jetons|access_token|refresh_token|session_id|sessionid|password|mot_de_passe|commentaire|commentaires|comment|strengths|improvements|portrait|notes|note|gaps|photo|adresse|fiche|cellules|cells)$/i
/** En plus pour nextar_connexions (mots courts, qui pourraient être des identifiants de tests ailleurs). */
const INTERDITES_CONNEXIONS = /^(ip|ips|ua|tel|mobile|portable|navigateur|uid|sub|device)$/i
/** nextar_connexions : textes refusés (une adresse mail, une adresse IP). */
const TEXTE_INTERDIT_CONNEXIONS = /@|\b\d{1,3}(\.\d{1,3}){3}\b|[0-9a-f]{1,4}(:[0-9a-f]{1,4}){4,}/i

const MAX_TEXTE = 2000

/**
 * Vérifie une réponse d'outil ; lève une erreur au premier écart (l'outil répond alors par une erreur, sans données).
 * `outil` : nom de l'outil (« nextar_connexions » a sa propre liste blanche et son contrôle des textes).
 */
export function verifierSortie(x: unknown, outil?: string): void {
  const admin = outil ? CLES_ADMIN[outil] : undefined
  const connexions = outil === 'nextar_connexions'
  verifier(x, 'réponse', false, admin ?? (connexions ? CLES_CONNEXIONS : CLES), connexions || !!admin)
}

function verifier(x: unknown, chemin: string, dict: boolean, cles: Set<string>, textes: boolean): void {
  if (x === null || typeof x === 'number' || typeof x === 'boolean') return
  if (typeof x === 'string') {
    if (x.length > MAX_TEXTE && chemin !== 'réponse.regles') throw new Error(`Réponse refusée : texte trop long en ${chemin}`)
    if (textes && TEXTE_INTERDIT_CONNEXIONS.test(x)) throw new Error(`Réponse refusée : adresse mail ou IP en ${chemin}`)
    return
  }
  if (Array.isArray(x)) {
    x.forEach((v, i) => verifier(v, `${chemin}[${i}]`, false, cles, textes))
    return
  }
  if (typeof x === 'object') {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      const norm = k.toLowerCase().replace(/[^a-z_]/g, '')
      const interdite = (re: RegExp) => re.test(norm) || re.test(k) || re.test(norm.replace(/_/g, ''))
      if (interdite(INTERDITES) || (textes && interdite(INTERDITES_CONNEXIONS))) throw new Error(`Réponse refusée : clé interdite « ${k} » en ${chemin}`)
      if (dict) {
        if (!/^[\w.-]{1,80}$/.test(k)) throw new Error(`Réponse refusée : clé « ${k} » en ${chemin}`)
      } else if (!cles.has(k)) throw new Error(`Réponse refusée : clé inconnue « ${k} » en ${chemin}`)
      verifier(v, `${chemin}.${k}`, !dict && cles === CLES && DICTS.has(k), cles, textes)
    }
    return
  }
  throw new Error(`Réponse refusée : valeur inattendue en ${chemin}`)
}

// ---------- Petits outils ----------

export const clip = (s: unknown, n: number) => {
  const t = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ') // eslint-disable-line no-control-regex
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}
export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
export const uniq = <T>(xs: Iterable<T>) => [...new Set(xs)]
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
export const lienBoite = (r: Reglages) => `${r.appUrl}/?propositions=1`
const lienRapport = (r: Reglages, id: string) => `${r.appUrl}/rapport/${encodeURIComponent(id)}`

const yearOf = (d?: string) => (d && /^\d{4}/.test(d) ? +d.slice(0, 4) : undefined)

/** Retrouve un événement ou un groupe par identifiant ou par nom (sans accents ; exact, puis tous les mots présents). */
export function trouverParNom<T extends { id: string; name: string; date?: string }>(
  liste: readonly T[],
  ref: string,
): { ok: T } | { erreur: string; suggestions?: { id: string; libelle: string; date?: string }[] } {
  const r = ref.trim()
  const byId = liste.find((x) => x.id === r)
  if (byId) return { ok: byId }
  const k = nameKey(r)
  if (!k) return { erreur: 'Nom vide.' }
  const exact = liste.filter((x) => nameKey(x.name) === k)
  const words = k.split(' ')
  const tous = exact.length ? exact : liste.filter((x) => words.every((w) => nameKey(x.name).split(' ').some((t) => t === w || (w.length >= 3 && t.startsWith(w)))))
  const sugg = (xs: readonly T[]) => xs.slice(0, 8).map((x) => ({ id: x.id, libelle: clip(x.name, 120), ...(x.date ? { date: x.date } : {}) }))
  if (tous.length === 1) return { ok: tous[0] }
  if (tous.length > 1) return { erreur: `Plusieurs correspondent à « ${clip(r, 80)} » : précise avec l'identifiant.`, suggestions: sugg(tous) }
  return { erreur: `Introuvable : « ${clip(r, 80)} ». Les noms exacts sont dans nextar_contexte.` }
}

// ---------- 1. nextar_contexte ----------

export async function outilContexte(src: Source, reg: Reglages, input: { archives?: boolean } = {}) {
  const archives = !!input.archives
  const [crits, cfgRows, evs, grs] = await Promise.all([src.criteres(), src.config(), src.evenements({ archives }), src.groupes({ archives })])
  const cfg = resolveSportConfig(cfgRows, reg.sport || 'handball')
  const vivants = crits.filter((c) => !c.deleted && c.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const tests = vivants
    .filter((c) => (c.kind ?? 'factual') === 'factual')
    .map((c) => ({
      id: c.id,
      libelle: clip(c.label, 120),
      ...(c.category ? { categorie: clip(c.category, 80) } : {}),
      ...(c.unit ? { unite: clip(c.unit, 20) } : {}),
      echelle: c.scale ?? 'number',
      ...(c.scale === 'choice' && c.options?.length ? { options: c.options.slice(0, 20).map((o) => clip(o, 60)) } : {}),
    }))
  const criteres_avis = vivants
    .filter((c) => c.kind === 'subjective')
    .map((c) => ({
      id: c.id,
      libelle: clip(c.label, 120),
      ...(c.category ? { categorie: clip(c.category, 80) } : {}),
      echelle: c.scale ?? 'score5',
      postes: c.positions?.length ? c.positions : 'tous',
    }))
  const evenements = evs
    .filter((e) => archives || !e.archived)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    .slice(0, BORNES.liste)
    .map((e) => ({ id: e.id, libelle: clip(e.name, 120), ...(e.date ? { date: e.date } : {}), ...(e.type ? { type: e.type } : {}), joueurs: e.playerIds?.length ?? 0, ...(e.archived ? { archive: true } : {}) }))
  const groupes = grs
    .filter((g) => archives || !g.archived)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .slice(0, BORNES.liste)
    .map((g) => ({ id: g.id, libelle: clip(g.name, 120), joueurs: g.playerIds?.length ?? 0, ...(g.archived ? { archive: true } : {}) }))
  return {
    sport: cfg.sportName,
    postes: cfg.positions.map((p) => ({ code: p.code, libelle: p.label, famille: p.family })),
    tests,
    criteres_avis,
    evenements,
    groupes,
    limites: { lignes_par_proposition: BORNES.lignes - 1, lire_max: BORNES.lireMax, rapport_max: BORNES.rapport },
    regles:
      "Nextar ne donne jamais de nom de joueur : chaque joueur est un code (J- puis 7 signes). Écris tes rapports avec ces codes " +
      "(nextar_rapport) : l'appli du coach remet les noms sur son appareil. Rien n'est enregistré sans la validation du coach : " +
      'nextar_proposer (mesures), nextar_proposer_avis (notes par critère d’avis), nextar_proposer_vus (joueurs vus à un ' +
      'événement) et nextar_proposer_a_revoir déposent dans la boîte « À valider ».',
  }
}

// ---------- 2. nextar_proposer ----------

export interface LigneObjet {
  joueur?: unknown
  nom?: unknown
  prenom?: unknown
  numero?: unknown
  annee?: unknown
  date?: unknown
  valeurs?: Record<string, unknown>
}

export interface ProposerInput {
  titre?: string
  date?: string
  evenement?: string
  groupe?: string
  /** Tableau tel qu'écrit (Markdown, tabulations, CSV, lignes simples) : lu comme « Coller un tableau ». */
  tableau?: string
  /** En-têtes des colonnes (si `lignes` sont des listes de cellules sans en-tête). */
  colonnes?: string[]
  /** Lignes : listes de cellules, ou objets { nom, prenom, numero, annee, date, valeurs: { test: valeur } }. */
  lignes?: (unknown[] | LigneObjet)[]
}

const cell = (v: unknown) => clip(v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v), BORNES.cellule)

/**
 * Lignes reçues → tableau de cellules (en-tête compris), comme si le coach l'avait collé, et colonnes déjà reliées à un test
 * (clé de valeur = identifiant d'un test : la colonne est reliée d'office, en-tête = libellé du test).
 */
export function lignesEnTableau(
  input: Pick<ProposerInput, 'tableau' | 'colonnes' | 'lignes'>,
  crits: readonly ImportCriterion[],
): { rows: string[][]; forced: Record<number, { k: 'test'; criterionId: string }>; format?: string; libre?: boolean } | { erreur: string } {
  const byId = new Map(crits.map((c) => [c.id, c]))
  const titreTest = (c: ImportCriterion) => (c.unit ? `${c.label} (${c.unit})` : c.label)
  if (typeof input.tableau === 'string' && input.tableau.trim()) {
    if (input.tableau.length > BORNES.octets) return { erreur: 'Tableau trop long (200 Ko au plus).' }
    const t = parseTable(input.tableau)
    return { rows: t.rows.map((r) => r.slice(0, BORNES.colonnes).map(cell)), forced: {}, format: t.format, ...(t.free ? { libre: true } : {}) }
  }
  const lignes = Array.isArray(input.lignes) ? input.lignes : []
  if (!lignes.length) return { erreur: 'Aucune ligne : donne `lignes` (cellules ou objets) ou `tableau` (texte).' }
  const forced: Record<number, { k: 'test'; criterionId: string }> = {}
  if (lignes.every((l) => Array.isArray(l))) {
    const rows = (lignes as unknown[][]).map((r) => r.slice(0, BORNES.colonnes).map(cell))
    if (Array.isArray(input.colonnes) && input.colonnes.length) {
      const head = input.colonnes.slice(0, BORNES.colonnes).map(cell)
      head.forEach((h, i) => {
        const c = byId.get(h)
        if (c) {
          forced[i] = { k: 'test', criterionId: c.id }
          head[i] = titreTest(c)
        }
      })
      rows.unshift(head)
    }
    return { rows, forced }
  }
  // Objets : colonnes d'identité présentes, puis une colonne par clé de valeur (dans l'ordre d'apparition).
  const objs = lignes.map((l) => (Array.isArray(l) || !l || typeof l !== 'object' ? {} : (l as LigneObjet)))
  const ident: [keyof LigneObjet, string][] = [
    ['joueur', 'Joueur'],
    ['nom', 'Nom'],
    ['prenom', 'Prénom'],
    ['numero', 'N°'],
    ['annee', 'Année'],
    ['date', 'Date'],
  ]
  const present = ident.filter(([k]) => objs.some((o) => cell(o[k])))
  const keys = uniq(objs.flatMap((o) => (o.valeurs && typeof o.valeurs === 'object' ? Object.keys(o.valeurs) : []))).slice(0, BORNES.colonnes - present.length)
  const head = [...present.map(([, h]) => h), ...keys.map((k) => (byId.get(k) ? titreTest(byId.get(k)!) : cell(k)))]
  keys.forEach((k, i) => {
    if (byId.get(k)) forced[present.length + i] = { k: 'test', criterionId: k }
  })
  const rows = objs.map((o) => [...present.map(([k]) => cell(o[k])), ...keys.map((k) => cell(o.valeurs?.[k]))])
  return { rows: [head, ...rows], forced }
}

/** Premier tri des candidats (grande base) : même son, même mot, ou mêmes trois premières lettres qu'un mot écrit. */
export function prefiltrer(name: string, cands: readonly Candidate[], index: Map<string, number[]>): Candidate[] {
  const keys = new Set<string>()
  for (const w of nameKey(name).split(' ').filter((x) => x.length >= 2)) {
    keys.add(`m:${w}`)
    if (w.length >= 3) {
      keys.add(`p:${phonetic(w)}`)
      keys.add(`d:${w.slice(0, 3)}`)
    }
  }
  const idx = new Set<number>()
  for (const k of keys) for (const i of index.get(k) ?? []) idx.add(i)
  return [...idx].map((i) => cands[i])
}

export function indexPrefiltre(cands: readonly Candidate[]): Map<string, number[]> {
  const index = new Map<string, number[]>()
  const add = (k: string, i: number) => {
    const cur = index.get(k)
    if (cur) {
      if (cur[cur.length - 1] !== i) cur.push(i)
    } else index.set(k, [i])
  }
  cands.forEach((c, i) => {
    for (const w of nameKey(`${c.firstName} ${c.lastName}`).split(' ').filter((x) => x.length >= 2)) {
      add(`m:${w}`, i)
      if (w.length >= 3) {
        add(`p:${phonetic(w)}`, i)
        add(`d:${w.slice(0, 3)}`, i)
      }
    }
    const glued = nameKey(c.lastName).replace(/ /g, '')
    if (glued.length >= 3) {
      add(`m:${glued}`, i)
      add(`p:${phonetic(glued)}`, i)
      add(`d:${glued.slice(0, 3)}`, i)
    }
  })
  return index
}

const ALERTE_TEXTE: Record<string, string> = {
  bornes: 'valeur hors des valeurs habituelles',
  unite: 'unité probablement fausse',
  illisible: 'cellule illisible',
  doublon: 'déjà en base',
}

/** État d'une ligne pour l'IA : jamais de nom, un code seulement si le joueur est sûr. */
export function etatLigne(m: PlayerMatch, partages: Set<string>) {
  if (m.confidence === 'sur' && m.playerId) {
    const code = codeJoueur(m.playerId)
    return { etat: 'trouvé', code, ...(partages.has(code) ? { code_partage: true } : {}) }
  }
  if (m.confidence === 'verifier') return m.others.length ? { etat: 'plusieurs possibles', possibles: Math.min(5, 1 + m.others.length) } : { etat: 'à vérifier', possibles: 1 }
  return { etat: 'introuvable' }
}

export async function outilProposer(src: Source, reg: Reglages, input: ProposerInput) {
  if (input.evenement && input.groupe) return { erreur: 'Donne un événement OU un groupe, pas les deux.' }
  const date = isDate(input.date) ? input.date : reg.today
  const crits = importable((await src.criteres()).map(toImportCriterion))
  // Où chercher les joueurs.
  let portee: 'evenement' | 'groupe' | 'tous' = 'tous'
  let ctxId: string | undefined
  let ctxNom: string | undefined
  let ids: string[] | null = null
  let nums: Record<string, string> | undefined
  if (input.evenement) {
    const f = trouverParNom(await src.evenements({ archives: true }), input.evenement)
    if ('erreur' in f) return f
    const ev = (await src.evenement(f.ok.id)) ?? f.ok
    portee = 'evenement'
    ctxId = ev.id
    ctxNom = ev.name
    ids = uniq(ev.playerIds ?? [])
    nums = ev.nums
  } else if (input.groupe) {
    const f = trouverParNom(await src.groupes({ archives: true }), input.groupe)
    if ('erreur' in f) return f
    const g = (await src.groupe(f.ok.id)) ?? f.ok
    portee = 'groupe'
    ctxId = g.id
    ctxNom = g.name
    ids = uniq(g.playerIds ?? [])
  }
  const table = lignesEnTableau(input, crits)
  if ('erreur' in table) return table
  const rows = table.rows.filter((r) => r.some((c) => c.trim()))
  if (!rows.length) return { erreur: 'Aucune ligne lisible.' }
  if (rows.length > BORNES.lignes) return { erreur: `Trop de lignes : ${BORNES.lignes - 1} au plus par proposition (découpe en plusieurs).` }
  if (new TextEncoder().encode(JSON.stringify(rows)).length > BORNES.octets) return { erreur: 'Tableau trop long (200 Ko au plus).' }
  // Joueurs du contexte (noms lus ici, jamais rendus).
  const lus = ids && !ids.length ? { joueurs: [], tronque: false } : await src.joueursNoms(ids, ids ? Math.max(ids.length, 1) : BORNES.rapprochementTous)
  const cands: Candidate[] = lus.joueurs.map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate, ...(nums?.[p.id] ? { num: nums[p.id] } : {}) }))
  // Grande base : propose() sans candidats (colonnes et valeurs), puis le rapprochement de chaque ligne sur un premier tri
  // (même son, même mot, mêmes trois lettres) ; l'appli refait tout à l'ouverture, sur toute la base de l'appareil.
  const grand = cands.length > BORNES.prefiltre
  const prop = propose(rows, { criteria: crits, players: grand ? [] : cands, existing: [], date, today: reg.today }, { columns: table.forced }, !!table.libre)
  if (grand) {
    const index = indexPrefiltre(cands)
    for (const r of prop.rows) r.match = matchPlayer({ name: r.name, num: r.num, year: r.year }, prefiltrer(r.name, cands, index))
    // Deux lignes pour le même joueur : toutes deux à vérifier (comme propose()).
    const parJoueur = new Map<string, number>()
    for (const r of prop.rows) if (r.match.playerId) parJoueur.set(r.match.playerId, (parJoueur.get(r.match.playerId) ?? 0) + 1)
    for (const r of prop.rows) if (r.match.playerId && (parJoueur.get(r.match.playerId) ?? 0) > 1 && r.match.confidence === 'sur') r.match = { ...r.match, confidence: 'verifier' }
  }
  const partages = new Set([...indexCodes(cands.map((c) => c.id))].filter(([, v]) => v.length > 1).map(([c]) => c))
  const titre = clip(input.titre?.trim() || `Tests du ${date.slice(8, 10)}/${date.slice(5, 7)}${ctxNom ? ` · ${ctxNom}` : ''}`, BORNES.titreProposition) || 'Proposition'
  const contexte: Record<string, unknown> = {
    portee,
    ...(ctxId ? { id: ctxId } : {}),
    ...(ctxNom ? { nom: clip(ctxNom, 120) } : {}),
    date,
    ...(table.format ? { format: table.format } : {}),
    ...(table.libre ? { libre: true } : {}),
    ...(ids && ids.length <= BORNES.joueursContexte ? { joueurs: ids } : {}),
    ...(Object.keys(table.forced).length ? { choix: { columns: table.forced } } : {}),
  }
  const dep = await src.deposerProposition({ titre, contexte, lignes: rows })
  if ('erreur' in dep) return { erreur: `Proposition non déposée : ${clip(dep.erreur, 300)}` }
  const trop = !ids && lus.tronque
  const lignes = prop.rows.map((r) => {
    const alertes = uniq(r.values.flatMap((v) => v.alerts.map((a) => ALERTE_TEXTE[a.k] ?? a.k)))
    return {
      ligne: r.line + 1,
      ...(trop ? { etat: 'à rapprocher dans Nextar' } : etatLigne(r.match, partages)),
      valeurs: r.values.filter((v) => v.value !== undefined).length,
      ...(alertes.length ? { alertes } : {}),
    }
  })
  const n = (e: string) => lignes.filter((l) => l.etat === e).length
  const colonnes = prop.columns.map((c) => ({
    colonne: c.index + 1,
    role: c.role.k === 'test' ? 'test' : c.role.k === 'inconnue' ? 'à relier dans Nextar' : c.role.k,
    ...(c.role.k === 'test' ? { test_id: c.role.criterionId } : {}),
  }))
  const avertissements = [
    ...(trop ? [`Plus de ${BORNES.rapprochementTous} joueurs dans le périmètre : les joueurs seront rapprochés dans l'appli à l'ouverture. Préciser un événement ou un groupe aide.`] : []),
    ...(colonnes.some((c) => c.role === 'à relier dans Nextar') ? ['Des colonnes ne sont reliées à aucun test : le coach les reliera dans l’appli (ou utilise les identifiants de nextar_contexte comme en-têtes).'] : []),
    'Les doublons (même joueur, même test, même date) sont vérifiés dans l’appli à l’ouverture.',
  ]
  return {
    id: dep.id,
    etat: 'en_attente',
    titre,
    portee: portee === 'tous' ? 'toute la base' : `${portee === 'evenement' ? 'événement' : 'groupe'} « ${clip(ctxNom, 120)} »`,
    date,
    colonnes,
    lignes,
    resume: { trouves: n('trouvé'), a_verifier: n('à vérifier'), plusieurs: n('plusieurs possibles'), introuvables: n('introuvable'), ...(trop ? { a_rapprocher: lignes.length } : {}) },
    lien_boite: lienBoite(reg),
    message:
      'Proposition déposée dans la boîte « À valider » de Nextar : rien n’est enregistré avant que le coach valide dans l’appli. ' +
      'Les noms ne sont jamais renvoyés ; un code désigne un joueur trouvé.',
    avertissements,
  }
}

const toImportCriterion = (c: CritereSrv): ImportCriterion => ({
  id: c.id,
  label: c.label,
  unit: c.unit,
  scale: c.scale ?? 'number',
  category: c.category ?? '',
  options: c.options,
  order: c.order ?? 0,
  kind: c.kind ?? 'factual',
  active: c.active,
  deleted: c.deleted,
})

// ---------- 3. nextar_suivi ----------

const ETAT_MOTS: Record<string, string> = { en_attente: 'en attente', validee: 'validée', partielle: 'validée en partie', rejetee: 'rejetée' }

const SORTE_MOTS: Record<string, string> = { mesures: 'mesures', avis: 'avis', vus: 'vus', a_revoir: 'à revoir', admin: 'administration' }

const resumeProp = (p: PropositionSrv) => ({
  id: p.id,
  titre: clip(p.titre, 80),
  sorte: SORTE_MOTS[p.kind] ?? 'autre',
  etat: p.deleted_at ? 'retirée' : (ETAT_MOTS[p.etat] ?? p.etat),
  source: p.source === 'mcp' ? 'depuis Claude' : p.source === 'collage' ? 'collé dans l’appli' : p.source,
  ...(p.nbLignes >= 0 ? { nb_lignes: p.nbLignes } : {}),
  creee_le: p.created_at,
  mise_a_jour_le: p.updated_at,
  expire_le: p.expires_at,
})

export async function outilSuivi(src: Source, reg: Reglages, input: { id?: string } = {}) {
  if (input.id) {
    const p = await src.proposition(input.id.trim())
    if (!p) return { erreur: 'Proposition introuvable (effacée, ou d’un autre compte).' }
    return { ...resumeProp(p), lien_boite: lienBoite(reg) }
  }
  const ps = await src.propositions(20)
  return { propositions: ps.map(resumeProp), lien_boite: lienBoite(reg) }
}

// ---------- 4. nextar_lire ----------

export interface LireInput {
  annees?: number[]
  sexe?: 'M' | 'F'
  postes?: string[]
  departements?: string[]
  evenement?: string
  groupe?: string
  mesures?: { test: string; min?: number; max?: number }[]
  vus_min?: number
  avis_min?: number
  avis_criteres?: { critere: string; min: number }[]
  /** Tests dont la dernière valeur est rendue (identifiants ou libellés ; « toutes » : tous). Par défaut : ceux des filtres et du tri. */
  avec_mesures?: string[] | 'toutes'
  /** Moyennes par critère d'avis (en plus de la moyenne générale). */
  avec_avis_criteres?: boolean
  tri?: { par: 'annee' | 'vus' | 'avis' | 'test'; test?: string; ordre?: 'asc' | 'desc' }
  limite?: number
}

/** Critère par identifiant ou par libellé (sans accents ; exact, puis tous les mots). */
export function critere(ref: string, list: readonly CritereSrv[]): CritereSrv | undefined {
  const r = ref.trim()
  const byId = list.find((c) => c.id === r)
  if (byId) return byId
  const k = nameKey(r)
  const exact = list.filter((c) => nameKey(c.label) === k)
  if (exact.length === 1) return exact[0]
  const w = k.split(' ')
  const near = list.filter((c) => w.every((x) => nameKey(c.label).split(' ').some((t) => t.startsWith(x))))
  return near.length === 1 ? near[0] : undefined
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim()) ? +v.replace(',', '.') : NaN)

export async function outilLire(src: Source, reg: Reglages, input: LireInput = {}) {
  void reg
  const avertissements: string[] = []
  const limite = Math.max(1, Math.min(BORNES.lireMax, Math.floor(input.limite ?? BORNES.lireDefaut)))
  const crits = (await src.criteres()).filter((c) => !c.deleted)
  const tests = crits.filter((c) => (c.kind ?? 'factual') === 'factual')
  const avisCrits = crits.filter((c) => c.kind === 'subjective')
  // Contexte : événement ou groupe.
  let ids: string[] | undefined
  if (input.evenement && input.groupe) return { erreur: 'Donne un événement OU un groupe, pas les deux.' }
  if (input.evenement) {
    const f = trouverParNom(await src.evenements({ archives: true }), input.evenement)
    if ('erreur' in f) return f
    ids = uniq(((await src.evenement(f.ok.id)) ?? f.ok).playerIds ?? [])
  } else if (input.groupe) {
    const f = trouverParNom(await src.groupes({ archives: true }), input.groupe)
    if ('erreur' in f) return f
    ids = uniq(((await src.groupe(f.ok.id)) ?? f.ok).playerIds ?? [])
  }
  // Tests des filtres, du tri et de la sortie.
  const filtresMesures: { c: CritereSrv; min?: number; max?: number }[] = []
  for (const m of input.mesures ?? []) {
    const c = critere(m.test, tests)
    if (!c) return { erreur: `Test inconnu : « ${clip(m.test, 80)} » (identifiants dans nextar_contexte).` }
    filtresMesures.push({ c, min: m.min, max: m.max })
  }
  const filtresAvis: { c: CritereSrv; min: number }[] = []
  for (const a of input.avis_criteres ?? []) {
    const c = critere(a.critere, avisCrits)
    if (!c) return { erreur: `Critère d'avis inconnu : « ${clip(a.critere, 80)} ».` }
    filtresAvis.push({ c, min: a.min })
  }
  let triTest: CritereSrv | undefined
  if (input.tri?.par === 'test') {
    triTest = input.tri.test ? critere(input.tri.test, tests) : undefined
    if (!triTest) return { erreur: 'Tri par test : donne `tri.test` (identifiant ou libellé d’un test).' }
  }
  let sortie: CritereSrv[]
  if (input.avec_mesures === 'toutes') sortie = tests.filter((c) => c.active !== false)
  else if (Array.isArray(input.avec_mesures) && input.avec_mesures.length) {
    sortie = []
    for (const r of input.avec_mesures) {
      const c = critere(r, tests)
      if (!c) avertissements.push(`Test inconnu ignoré : « ${clip(r, 80)} ».`)
      else sortie.push(c)
    }
  } else sortie = [...filtresMesures.map((f) => f.c), ...(triTest ? [triTest] : [])]
  sortie = uniq(sortie)
  // Joueurs (sans noms).
  const annees = (input.annees ?? []).filter((y) => Number.isInteger(y) && y > 1900 && y < 2100)
  const postes = (input.postes ?? []).map((p) => String(p).trim()).filter(Boolean)
  const depts = (input.departements ?? []).map((d) => String(d).trim().toUpperCase()).filter(Boolean)
  if (ids && !ids.length) return { joueurs: [], total: 0, avertissements: ['Cet événement ou ce groupe n’a aucun joueur.'] }
  const lus = await src.joueursLire({ ...(ids ? { ids } : {}), ...(annees.length ? { annees } : {}), ...(input.sexe ? { sexe: input.sexe } : {}), ...(postes.length ? { postes } : {}), ...(depts.length ? { depts } : {}) }, BORNES.lireAvant)
  if (lus.tronque) avertissements.push(`Plus de ${BORNES.lireAvant} joueurs correspondent avant les filtres sur les mesures, avis et vus : seuls les ${BORNES.lireAvant} premiers sont considérés. Précise l’année, le poste, le département, un événement ou un groupe.`)
  let joueurs = lus.joueurs.filter(
    (p) =>
      (!ids || ids.includes(p.id)) &&
      (!annees.length || (p.annee !== undefined && annees.includes(p.annee))) &&
      (!input.sexe || p.sexe === input.sexe) &&
      (!postes.length || (p.poste !== undefined && postes.includes(p.poste))) &&
      (!depts.length || (p.dept !== undefined && depts.includes(p.dept.toUpperCase()))),
  )
  // Mesures, avis, vus : lus pour les joueurs encore en lice quand un filtre ou le tri en a besoin, sinon pour la page rendue.
  const besoinAvant = filtresMesures.length > 0 || filtresAvis.length > 0 || input.avis_min !== undefined || input.vus_min !== undefined || (input.tri && input.tri.par !== 'annee')
  type Info = { mes: Map<string, { valeur: number | string; date: string }>; avis: { moy?: number; nb: number; par: Map<string, number[]> }; vus: number }
  const infos = new Map<string, Info>()
  const charger = async (pids: string[]) => {
    const todo = pids.filter((id) => !infos.has(id))
    if (!todo.length) return
    const [ms, av, vs] = await Promise.all([src.mesures(todo), src.avis(todo), src.vus(todo)])
    for (const id of todo) infos.set(id, { mes: new Map(), avis: { nb: 0, par: new Map() }, vus: 0 })
    for (const m of ms) {
      const i = infos.get(m.playerId)
      if (!i) continue
      const cur = i.mes.get(m.criterionId)
      if (!cur || m.date > cur.date) i.mes.set(m.criterionId, { valeur: m.value, date: m.date })
    }
    const score5 = new Set(avisCrits.filter((c) => (c.scale ?? 'score5') === 'score5').map((c) => c.id))
    const toutes = new Map<string, number[]>()
    for (const a of av) {
      const i = infos.get(a.playerId)
      if (!i) continue
      i.avis.nb++
      for (const [cid, v] of Object.entries(a.scores ?? {})) {
        const n = num(v)
        if (!Number.isFinite(n)) continue
        i.avis.par.set(cid, [...(i.avis.par.get(cid) ?? []), n])
        if (score5.has(cid)) toutes.set(a.playerId, [...(toutes.get(a.playerId) ?? []), n])
      }
    }
    for (const [pid, xs] of toutes) {
      const i = infos.get(pid)
      if (i && xs.length) i.avis.moy = round(xs.reduce((s, x) => s + x, 0) / xs.length)
    }
    const evs = new Map<string, Set<string>>()
    for (const v of vs) evs.set(v.playerId, (evs.get(v.playerId) ?? new Set()).add(v.eventId))
    for (const [pid, s] of evs) {
      const i = infos.get(pid)
      if (i) i.vus = s.size
    }
  }
  const moyCrit = (i: Info, cid: string) => {
    const xs = i.avis.par.get(cid)
    return xs?.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : undefined
  }
  if (besoinAvant) {
    for (let k = 0; k < joueurs.length; k += 500) await charger(joueurs.slice(k, k + 500).map((p) => p.id))
    joueurs = joueurs.filter((p) => {
      const i = infos.get(p.id)!
      for (const f of filtresMesures) {
        const v = num(i.mes.get(f.c.id)?.valeur)
        if (!Number.isFinite(v) || (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) return false
      }
      if (input.vus_min !== undefined && i.vus < input.vus_min) return false
      if (input.avis_min !== undefined && (i.avis.moy === undefined || i.avis.moy < input.avis_min)) return false
      for (const f of filtresAvis) {
        const m = moyCrit(i, f.c.id)
        if (m === undefined || m < f.min) return false
      }
      return true
    })
  }
  // Tri.
  const ordre = input.tri?.ordre === 'asc' ? 1 : input.tri?.ordre === 'desc' ? -1 : input.tri?.par === 'annee' ? 1 : -1
  const cle = (p: JoueurLire): number | undefined => {
    const i = infos.get(p.id)
    switch (input.tri?.par) {
      case 'annee':
        return p.annee
      case 'vus':
        return i?.vus
      case 'avis':
        return i?.avis.moy
      case 'test': {
        const v = num(i?.mes.get(triTest!.id)?.valeur)
        return Number.isFinite(v) ? v : undefined
      }
      default:
        return undefined
    }
  }
  const codeDe = (id: string) => codeJoueur(id)
  joueurs.sort((a, b) => {
    const x = cle(a)
    const y = cle(b)
    if (x !== undefined && y !== undefined && x !== y) return (x - y) * ordre
    if (x === undefined && y !== undefined) return 1
    if (y === undefined && x !== undefined) return -1
    return codeDe(a.id).localeCompare(codeDe(b.id))
  })
  const total = joueurs.length
  const page = joueurs.slice(0, limite)
  await charger(page.map((p) => p.id))
  const index = indexCodes(page.map((p) => p.id))
  const lignes = page.map((p) => {
    const i = infos.get(p.id)!
    const code = codeDe(p.id)
    const mesures: Record<string, { valeur: number | string; date: string }> = {}
    for (const c of sortie) {
      const m = i.mes.get(c.id)
      if (m) mesures[c.id] = { valeur: typeof m.valeur === 'string' ? clip(m.valeur, 60) : m.valeur, date: m.date }
    }
    const criteres: Record<string, number> = {}
    if (input.avec_avis_criteres) for (const c of avisCrits) {
      const m = moyCrit(i, c.id)
      if (m !== undefined) criteres[c.id] = m
    }
    return {
      code,
      ...((index.get(code)?.length ?? 0) > 1 ? { code_partage: true } : {}),
      ...(p.poste ? { poste: p.poste } : {}),
      ...(p.annee ? { annee: p.annee } : {}),
      ...(p.sexe ? { sexe: p.sexe } : {}),
      ...(p.dept ? { departement: p.dept } : {}),
      vus: i.vus,
      ...(Object.keys(mesures).length ? { mesures } : {}),
      avis: { nb: i.avis.nb, ...(i.avis.moy !== undefined ? { moyenne: i.avis.moy } : {}), ...(Object.keys(criteres).length ? { criteres } : {}) },
    }
  })
  const legende: Record<string, string> = {}
  for (const c of sortie) legende[c.id] = clip(c.unit ? `${c.label} (${c.unit})` : c.label, 120)
  if (input.avec_avis_criteres) for (const c of avisCrits) legende[c.id] = clip(c.label, 120)
  return {
    joueurs: lignes,
    total,
    ...(total > page.length ? { tronque: true } : {}),
    ...(Object.keys(legende).length ? { legende } : {}),
    ...(input.tri ? { tri: `${input.tri.par}${triTest ? ` ${triTest.id}` : ''} ${ordre > 0 ? 'croissant' : 'décroissant'}` } : {}),
    avertissements: [
      ...avertissements,
      'Moyenne d’avis : critères notés de 1 à 5. Mesures : dernière valeur de chaque test. Un joueur est désigné par son code ; écris le rapport avec ces codes.',
    ],
  }
}

// ---------- 5. nextar_rapport ----------

export async function outilRapport(src: Source, reg: Reglages, input: { titre?: string; markdown: string }) {
  const contenu = String(input.markdown ?? '').replace(/\r\n?/g, '\n')
  if (!contenu.trim()) return { erreur: 'Rapport vide.' }
  if (contenu.length > BORNES.rapport) return { erreur: `Rapport trop long : ${BORNES.rapport} caractères au plus.` }
  const titre = clip(input.titre || contenu.match(/^#+\s*(.+)$/m)?.[1] || 'Rapport', BORNES.titreRapport) || 'Rapport'
  const codes = codesDuTexte(contenu)
  const dep = await src.deposerRapport({ titre, contenu })
  if ('erreur' in dep) return { erreur: `Rapport non gardé : ${clip(dep.erreur, 300)}` }
  return {
    id: dep.id,
    titre,
    lien: lienRapport(reg, dep.id),
    expire_le: dep.expires_at,
    codes: codes.valides.length,
    ...(codes.invalides.length ? { codes_invalides: codes.invalides.slice(0, 50) } : {}),
    message:
      'Rapport gardé 30 jours pour le coach seul. En ouvrant le lien dans Nextar (connecté), son appareil remplace chaque code par le nom du joueur ; ' +
      'les noms ne passent jamais par ce serveur. « Imprimer / PDF » sur la page.' +
      (codes.invalides.length ? ' Certains codes sont mal recopiés (signe de contrôle faux) : ils resteront des codes.' : ''),
  }
}

// ---------- 6. nextar_connexions (administrateurs seulement) ----------

/** Libellés des rôles : les mêmes que l'appli (src/roles.ts, ROLE_LABEL ; tools/test-mcp.ts vérifie qu'ils restent égaux). */
export const ROLE_LIBELLE: Record<string, string> = { admin: 'Administrateur', preparateur: 'Encadrant', observateur: 'Observateur', joueur: 'Joueur' }
export const SANS_ROLE = 'En attente (aucun rôle)'
export const SANS_NOM = '(nom pas encore choisi)'

/** Retire d'un texte écrit par quelqu'un ce qui ressemble à une adresse mail, un téléphone ou une adresse IP. */
export function sansCoordonnees(s: unknown, n: number): string {
  return clip(
    String(s ?? '')
      .replace(/\S*@\S*/g, ' ')
      .replace(/(?:\+|\b00)\d[\d .-]{7,}\d|\b0[1-9](?:[ .-]?\d{2}){4}\b/g, ' ')
      .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, ' ')
      .replace(/[(<[]\s*[)>\]]/g, ' '),
    n,
  )
}

/** Type d'appareil (texte envoyé par l'appli, src/presence.ts) → vocabulaire fixe ; inconnu : rien. Jamais le texte tel quel. */
export function typeAppareil(device: string | null | undefined): { appareil?: string; appli_installee?: true } {
  const d = String(device ?? '')
  const appareil = /iPad/i.test(d) ? 'tablette' : /iPhone|iPod/i.test(d) ? 'téléphone' : /Android/i.test(d) ? 'téléphone ou tablette' : /Ordinateur/i.test(d) ? 'ordinateur' : undefined
  return { ...(appareil ? { appareil } : {}), ...(appareil && /appli installée/i.test(d) ? { appli_installee: true as const } : {}) }
}

/** « à l'instant », « il y a 4 min », « il y a 2 h 05 », « il y a 3 j ». */
export function ilYA(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  if (min < 24 * 60) return `il y a ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
  return `il y a ${Math.floor(min / (24 * 60))} j`
}

/** Code court et stable d'un compte (« C- » + 7 signes, même calcul que les codes de joueurs) : jamais l'identifiant brut. */
export const codeCompte = (userId: string) => `C-${codeJoueur(userId).slice(2)}`

/** Texte du périmètre (comme src/perimeter.ts, perimeterText, sur les unités d'affectation) ; à défaut, le secteur du profil. */
export function textePerimetre(c: CompteSrv): string | undefined {
  if (c.role === 'admin') return 'Toute la base (administrateur)'
  const us = c.unites ?? []
  if (us.some((u) => u.federation)) return 'Toute la base'
  if (us.length) {
    return clip(
      us
        .map((u) => {
          const nom = sansCoordonnees(u.name, 120) || 'Unité'
          if (u.club) return `${nom} (n° ${sansCoordonnees(u.club, 12)})`
          const ds = (u.depts ?? []).filter(Boolean).map((d) => clip(d, 4))
          if (!ds.length) return nom
          const list = ds.length > 8 ? `${ds.length} départements` : ds.join(', ')
          return nom.includes(`(${list})`) ? nom : `${nom} (${list})`
        })
        .sort((a, b) => a.localeCompare(b, 'fr'))
        .join(' ; '),
      400,
    )
  }
  const ds = (c.departments ?? []).filter(Boolean).map((d) => clip(d, 4))
  return ds.length ? `secteur ${ds.join(', ')}` : undefined
}

export interface ConnexionsInput {
  minutes?: number
  limite?: number
}

export const borne = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def
  return Math.max(min, Math.min(max, n))
}

export async function outilConnexions(src: Source, reg: Reglages, input: ConnexionsInput = {}) {
  // Le rôle d'abord : rien n'est lu pour un compte qui n'est pas administrateur (la base, elle, ne lui rendrait rien).
  if (!(await src.estAdmin())) return { erreur: 'Réservé aux administrateurs : ce compte ne peut pas voir qui s’est connecté.' }
  const minutes = borne(input.minutes, BORNES.connexionsMinutes, 1, BORNES.connexionsMinutesMax)
  const limite = borne(input.limite, BORNES.connexionsDefaut, 1, BORNES.connexionsMax)
  const maintenant = reg.maintenant ?? Date.now()
  const depuis = new Date(maintenant - minutes * 60_000).toISOString()
  const lu = await src.connexions(depuis, BORNES.connexionsSessions)
  // Par compte : dernière activité, appareil de la dernière ouverture, nombre d'ouvertures vues sur la période.
  const parCompte = new Map<string, { derniere: number; device?: string | null; sessions: number }>()
  for (const s of lu.sessions) {
    const t = Date.parse(s.lastSeenAt)
    if (!s.userId || !Number.isFinite(t) || t < maintenant - minutes * 60_000) continue
    const cur = parCompte.get(s.userId)
    if (!cur) parCompte.set(s.userId, { derniere: t, device: s.device, sessions: 1 })
    else {
      cur.sessions++
      if (t > cur.derniere) Object.assign(cur, { derniere: t, device: s.device })
    }
  }
  const ordre = [...parCompte].sort((a, b) => b[1].derniere - a[1].derniere)
  const page = ordre.slice(0, limite)
  const comptes = new Map((page.length ? await src.comptes(page.map(([id]) => id)) : []).map((c) => [c.userId, c]))
  const connexions = page.map(([id, v]) => {
    const c = comptes.get(id) ?? { userId: id }
    const perimetre = textePerimetre(c)
    return {
      compte: codeCompte(id),
      nom_affiche: sansCoordonnees(c.fullName, 80) || SANS_NOM,
      role: (c.role && ROLE_LIBELLE[c.role]) || SANS_ROLE,
      ...(perimetre ? { perimetre } : {}),
      derniere_activite: new Date(v.derniere).toISOString(),
      il_y_a: ilYA(maintenant - v.derniere),
      ...typeAppareil(v.device),
      sessions: v.sessions,
    }
  })
  return {
    fenetre_minutes: minutes,
    depuis,
    maintenant: new Date(maintenant).toISOString(),
    total: ordre.length,
    ...(ordre.length > page.length ? { tronque: true } : {}),
    connexions,
    avertissements: [
      ...(lu.tronque ? [`Plus de ${BORNES.connexionsSessions} ouvertures de l’appli sur la période : seules les plus récentes sont comptées. Réduis la fenêtre.`] : []),
      'Dernière activité : dernier signe de vie de l’appli (envoyé toutes les quelques minutes tant qu’elle est affichée). Sessions : ouvertures de l’appli vues sur la période.',
    ],
    message: 'Comptes du staff (nom affiché et rôle) ; jamais d’adresse mail, de téléphone, d’adresse IP ni de donnée de joueur.',
  }
}

/** Année d'une date complète (pour une Source qui lit birthDate) : seule l'année sort. */
export const anneeDe = yearOf
