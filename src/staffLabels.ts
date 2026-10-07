/*
 * Libellés affichés des staffs (équipes d'encadrants enregistrées, supabase/034_equipes_encadrants.sql) et de la
 * visibilité « Mon staff » des groupes (supabase/031_groupes_equipe.sql), réunis ici pour pouvoir les renommer
 * d'un coup. Les noms techniques (team, teams, teamFollow, hb_teams, table Dexie teams) ne changent pas.
 * Les textes des notifications sont écrits par le serveur (supabase/034).
 */

/** Staffs : l'objet (« Staff ETD Var »), sa page et son choix dans les participants. */
export const STAFF = {
  /** Adresse de la page « Mes staffs ». */
  route: '/staffs',
  /** Nom commun, au singulier et au pluriel (« un staff », « 3 staffs »). */
  one: 'staff',
  many: 'staffs',
  /** Titre de la page et des liens qui y mènent. */
  title: 'Mes staffs',
  /** Bouton de création, titre du formulaire. */
  add: '+ Staff',
  create: 'Nouveau staff',
  /** Champ « Nom » du formulaire, et son exemple. */
  nameLabel: 'Nom du staff',
  namePlaceholder: 'Ex. ETD Var, Staff Intercomités 83, Staff Pôle Sud…',
  descriptionPlaceholder: 'Saison, rôle… — facultatif',
  membersLabel: 'Membres',
  intro:
    'Des équipes d’encadrants enregistrées (ETD Var, Staff Pôle Sud…) : un clic pour les ajouter comme participants d’un groupe ou d’un événement. Qui entre dans un staff accède aussitôt à ses groupes et événements ; qui en sort les perd.',
  privacy: 'Un staff n’est visible que par toi et ses membres (pas par les administrateurs). Toi seul le modifies.',
  membersHelp: 'Encadrants du staff. Tu n’en fais partie que si tu te coches.',
  empty: 'Aucun staff pour l’instant.',
  emptyCreate: 'Aucun staff pour l’instant. Crée le premier avec « + Staff ».',
  notFound: 'Staff introuvable.',
  noRole: 'Ton rôle ne permet pas de créer de staff.',
  offline: 'Les encadrants se choisissent en ligne.',
  /** Section en tête du choix des participants. */
  pickerTitle: 'Staffs',
  pickerHelp: 'Tout le staff choisi participe, y compris ceux qui le rejoindront plus tard.',
  pickerManage: 'Gérer mes staffs',
  pickerOthers: 'Encadrants un par un',
  /** Staff cité qui n'est pas sur l'appareil (supprimé, ou dont je ne fais pas partie). */
  hidden: (n: number) => `${n} staff${n > 1 ? 's' : ''} non visible${n > 1 ? 's' : ''}`,
  /** « 5 encadrants ». */
  count: (n: number) => `${n} encadrant${n > 1 ? 's' : ''}`,
  /** Lien de la page Groupes et de Réglages. */
  link: 'Mes staffs (équipes d’encadrants)',
  settingsHelp: 'Équipes d’encadrants enregistrées, à ajouter d’un clic aux groupes et aux événements.',
  /** Suppression. */
  confirmDelete: (name: string) =>
    `Supprimer le staff « ${name} » ? Ses membres perdent l’accès qu’il leur donnait aux groupes et événements (les participants choisis un par un le gardent).`,
  createdBy: (name: string) => `créé par ${name}`,
  mine: 'à toi',
  /** Je suis membre de ce staff. */
  member: 'tu en fais partie',
}

/** Visibilité d'un groupe : libellés du choix « Visible par », des sections de la liste et des pastilles. */
export const GROUP_VIS = {
  label: { private: 'Moi seul', team: 'Mon staff', staff: 'Tout le staff' },
  /** Mention après le nom d'un groupe dans les menus déroulants. */
  tag: { private: ' (privé)', team: ' (mon staff)', staff: '' },
  section: { private: 'Mes groupes privés', team: 'Groupes de mon staff', staff: 'Groupes du staff' },
  help: {
    private: 'Moi seul : personne d’autre ne le voit, même pas les administrateurs.',
    team: 'Mon staff : visible seulement par toi et les participants que tu choisis (pas par les administrateurs).',
    staff: 'Tout le staff : visible par tout le staff.',
  },
  /** Pastille d'un groupe « Mon staff ». */
  chip: 'Mon staff',
  chipTitle: 'Groupe de mon staff : visible seulement par son créateur et ses participants',
} as const

/** « Suivi par le staff » (teamFollow, supabase/032_suivis.sql). */
export const TEAM_FOLLOW = {
  label: 'Suivi par le staff',
  chipTitle: 'Suivi par le staff : ses joueurs sont suivis par son créateur et ses participants (Mes suivis)',
  help: 'Toi et les participants suivez ses joueurs : leurs nouvelles mesures et leurs nouveaux avis arrivent dans « Mes suivis ».',
  already: 'Déjà suivi par le staff (toi compris).',
  short: 'par le staff',
  removeTitle: 'Suivi par le staff : seul le créateur du groupe peut le retirer',
}
