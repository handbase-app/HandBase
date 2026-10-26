import { sportContent } from './sportContent'

/*
 * Libellés affichés des groupes de travail (ex-« staffs » : équipes d'encadrants enregistrées,
 * supabase/034_equipes_encadrants.sql) et de la visibilité « Mes groupes de travail » des groupes de joueurs
 * (supabase/031_groupes_equipe.sql), réunis ici pour pouvoir les renommer d'un coup. Les noms techniques (team, teams,
 * teamFollow, hb_teams, table Dexie teams, route /staffs) ne changent pas. Les textes des notifications sont écrits par
 * le serveur (supabase/034).
 */

/** Groupes de travail : l'objet (« Pôles Région Sud »), son onglet dans Groupes et son choix dans les participants. */
export const STAFF = {
  /** Ancienne adresse de la page « Mes staffs » : renvoie vers l'onglet (liens partagés, notifications). */
  route: '/staffs',
  /** Onglet « Groupes de travail » de la page Groupes (?onglet=travail ; groupes de joueurs par défaut). */
  tab: 'travail',
  tabRoute: '/groupes?onglet=travail',
  /** Onglets de la page Groupes. */
  tabPlayers: 'Groupes de joueurs',
  tabWork: 'Groupes de travail',
  /** Nom commun, au singulier et au pluriel (« un groupe de travail », « 3 groupes de travail »). */
  one: 'groupe de travail',
  many: 'groupes de travail',
  /** Titre des liens qui mènent à l'onglet. */
  title: 'Groupes de travail',
  /** Création (« ⋯ » de la barre de l'onglet), titre du formulaire. */
  add: 'Ajouter un groupe de travail',
  create: 'Nouveau groupe de travail',
  /** Champ « Nom » du formulaire, et son exemple. */
  nameLabel: 'Nom du groupe de travail',
  /** Exemple du sport de l'installation (handball : « Ex. ETD Var, Pôles Région Sud, Intercomités 83… »). */
  get namePlaceholder() {
    return sportContent().examples.workGroupName
  },
  descriptionPlaceholder: 'Saison, rôle… — facultatif',
  membersLabel: 'Membres',
  intro:
    'Des encadrants qui travaillent ensemble (ETD Var, Pôles Région Sud…) : un clic pour les ajouter comme participants d’un groupe de joueurs ou d’un événement. Qui entre dans un groupe de travail accède aussitôt à ses groupes et événements ; qui en sort les perd.',
  privacy: 'Un groupe de travail n’est visible que par toi et ses membres (pas par les administrateurs). Toi seul le modifies.',
  membersHelp: 'Encadrants du groupe de travail. Tu n’en fais partie que si tu te coches.',
  empty: 'Aucun groupe de travail pour l’instant.',
  emptyCreate: 'Aucun groupe de travail pour l’instant. Crée le premier avec « Ajouter un groupe de travail », dans le « ⋯ » à droite de la barre.',
  /** Recherche de la barre de l'onglet sans résultat. */
  noMatch: 'Aucun groupe de travail ne correspond.',
  notFound: 'Groupe de travail introuvable.',
  noRole: 'Ton rôle ne permet pas de créer de groupe de travail.',
  offline: 'Les encadrants se choisissent en ligne.',
  /** Section en tête du choix des participants. */
  pickerTitle: 'Groupes de travail',
  pickerHelp: 'Tout le groupe de travail choisi participe, y compris ceux qui le rejoindront plus tard.',
  pickerManage: 'Gérer mes groupes de travail',
  pickerOthers: 'Encadrants un par un',
  /** Groupe de travail cité qui n'est pas sur l'appareil (supprimé, ou dont je ne fais pas partie). */
  hidden: (n: number) => `${n} groupe${n > 1 ? 's' : ''} de travail non visible${n > 1 ? 's' : ''}`,
  /** « 5 encadrants ». */
  count: (n: number) => `${n} encadrant${n > 1 ? 's' : ''}`,
  settingsHelp: 'Encadrants qui travaillent ensemble, à ajouter d’un clic aux groupes et aux événements.',
  /** Fiche d'un groupe de travail : ce qui le partage (groupes de joueurs et événements dont il est participant). */
  sharedGroups: 'Groupes de joueurs partagés',
  sharedEvents: 'Événements partagés',
  sharedNone: 'Rien de partagé pour l’instant : ajoute ce groupe de travail aux participants d’un groupe de joueurs ou d’un événement.',
  /** Suppression. */
  confirmDelete: (name: string) =>
    `Supprimer le groupe de travail « ${name} » ? Ses membres perdent l’accès qu’il leur donnait aux groupes et événements (les participants choisis un par un le gardent).`,
  createdBy: (name: string) => `créé par ${name}`,
  mine: 'à toi',
  /** Je suis membre de ce groupe de travail. */
  member: 'tu en fais partie',
}

/** Visibilité d'un groupe : libellés du choix « Visible par », des sections de la liste et des pastilles. */
export const GROUP_VIS = {
  label: { private: 'Moi seul', team: 'Mes groupes de travail', staff: 'Tout le monde' },
  /** Mention après le nom d'un groupe dans les menus déroulants. */
  tag: { private: ' (privé)', team: ' (groupe de travail)', staff: '' },
  section: { private: 'Mes groupes privés', team: 'Partagés avec mes groupes de travail', staff: 'Visibles par tout le monde' },
  help: {
    private:
      'Moi seul : visible par toi seul. Les administrateurs peuvent y accéder en cas de besoin (départ, réattribution) ; chaque accès est noté dans le journal d’activité.',
    team: 'Mes groupes de travail : visible seulement par toi et les participants que tu choisis (groupes de travail, ou encadrants un par un). Les administrateurs peuvent y accéder en cas de besoin (départ, réattribution) ; chaque accès est noté dans le journal d’activité.',
    staff: 'Tout le monde : visible par tous les comptes de l’appli.',
  },
  /** Pastille d'un groupe « Mes groupes de travail ». */
  chip: 'Groupe de travail',
  chipTitle: 'Partagé avec mes groupes de travail : visible seulement par son créateur et ses participants (administrateurs en cas de besoin)',
  /** Icône cadenas d'un groupe privé. */
  privateTitle: 'Groupe privé : visible par toi seul (administrateurs en cas de besoin, accès noté)',
} as const

/** « Voir tous les groupes » (administrateurs, supabase/039_admin_groupes.sql). */
export const ADMIN_GROUPS = {
  toggle: 'Voir tous les groupes',
  toggleHelp:
    'Affiche aussi, sur la page Groupes, les groupes privés et partagés avec des groupes de travail des autres comptes, en lecture seule, pour les réattribuer ou les supprimer (départ d’un membre…). Chaque affichage et chaque consultation sont notés dans le journal d’activité. Rien n’est copié sur cet appareil.',
  section: 'Groupes des autres (privés et groupes de travail)',
  noServer: 'Voir tous les groupes se lit sur le serveur : indisponible dans cette version sans serveur.',
  offline: 'Hors ligne : les groupes des autres se lisent sur le serveur. Réessaie une fois connecté.',
  missing: 'Pas encore disponible sur le serveur : exécute d’abord supabase/039_admin_groupes.sql dans Supabase.',
  empty: 'Aucun groupe privé ou partagé avec un groupe de travail chez les autres comptes.',
  loading: 'Chargement des groupes des autres…',
  /** Étiquette d'un groupe d'un autre : « privé de Léa », « groupe de travail de Paul ». */
  owner: (g: { private?: boolean }, name: string) => `${g.private ? 'privé' : 'groupe de travail'} de ${name}`,
  notice: 'Consultation administrateur, en lecture seule. Elle est notée dans le journal d’activité (sans le contenu du groupe).',
  confirmDelete: (name: string, owner: string) =>
    `Supprimer le groupe « ${name} » (${owner}) ? Il disparaît aussi chez son propriétaire, qui est prévenu. Les joueurs, leurs avis et les événements ne sont pas touchés.`,
}

/** « Suivi par les participants » (teamFollow, supabase/032_suivis.sql). */
export const TEAM_FOLLOW = {
  label: 'Suivi par les participants',
  chipTitle: 'Suivi par les participants : ses joueurs sont suivis par son créateur et ses participants (Mes suivis)',
  help: 'Toi et les participants suivez ses joueurs : leurs nouvelles mesures et leurs nouveaux avis arrivent dans « Mes suivis ».',
  already: 'Déjà suivi par les participants (toi compris).',
  short: 'par les participants',
  removeTitle: 'Suivi par les participants : seul le créateur du groupe peut le retirer',
}
