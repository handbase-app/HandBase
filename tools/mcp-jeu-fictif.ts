// Jeu de données FICTIF pour le serveur MCP Nextar (tools/test-mcp.ts, essai de bout en bout tools/essai-mcp/) : une Source
// en mémoire qui se comporte comme supabase/functions/mcp/source.ts (joueurs vivants seulement, aucun nom pour la lecture,
// propositions et rapports gardés). Noms, clubs et licences inventés. Importable par Node (jiti) et par Deno (imports en .ts,
// aucun module Node).

import type {
  ActiviteSrv,
  AvisAValiderSrv,
  AvisSrv,
  Comptage,
  CompteSrv,
  CritereSrv,
  EvenementSrv,
  GroupeSrv,
  JoueurNom,
  JournalSrv,
  MesureSrv,
  ProfilSrv,
  PropositionSrv,
  SessionSrv,
  Source,
  VuSrv,
} from '../supabase/functions/mcp/outils.ts'

export interface JoueurFictif {
  id: string
  firstName: string
  lastName: string
  birthDate: string
  sex: 'M' | 'F'
  position: string
  dept: string
  club: string
  license: string
  mergedInto?: string
  review?: string
}

export const CRITERES: CritereSrv[] = [
  { id: 'sprint_10', label: 'Sprint 10 m', category: 'Vitesse', kind: 'factual', scale: 'number', unit: 's', active: true, order: 1 },
  { id: 'cmj', label: 'CMJ', category: 'Détente', kind: 'factual', scale: 'number', unit: 'cm', active: true, order: 2 },
  { id: 'taille', label: 'Taille', category: 'Morphologie', kind: 'factual', scale: 'number', unit: 'cm', active: true, order: 3 },
  { id: 'lateralite', label: 'Latéralité', category: 'Morphologie', kind: 'factual', scale: 'choice', options: ['Gauche', 'Droit'], active: true, order: 4 },
  { id: 'tir', label: 'Tir en appui', category: 'Attaque', kind: 'subjective', scale: 'score5', positions: ['ARG', 'ARD'], active: true, order: 10 },
  { id: 'defense', label: 'Défense', category: 'Défense', kind: 'subjective', scale: 'score5', active: true, order: 11 },
  { id: 'mental', label: 'Mental', category: 'Mental', kind: 'subjective', scale: 'score5', active: true, order: 12 },
  { id: 'ancien', label: 'Ancien test', kind: 'factual', scale: 'number', unit: 's', active: false, order: 20, deleted: true },
]

export const JOUEURS: JoueurFictif[] = [
  { id: 'p-lucas', firstName: 'Lucas', lastName: 'Exemplaire', birthDate: '2011-03-14', sex: 'M', position: 'ARG', dept: '83', club: 'Club Fictif de Toulon', license: '6383001000111' },
  { id: 'p-emma', firstName: 'Emma', lastName: 'Imaginaire', birthDate: '2011-07-02', sex: 'F', position: 'DC', dept: '83', club: 'Entente Inventée', license: '6383001000222' },
  { id: 'p-noah', firstName: 'Noah', lastName: 'Fictivus', birthDate: '2012-01-21', sex: 'M', position: 'PIV', dept: '13', club: 'HB Nulle Part', license: '6313001000333' },
  { id: 'p-lea', firstName: 'Léa', lastName: 'Bidonville', birthDate: '2011-11-30', sex: 'F', position: 'ARD', dept: '06', club: 'Club Fictif de Toulon', license: '6306001000444' },
  { id: 'p-hugo', firstName: 'Hugo', lastName: 'Martinvert', birthDate: '2011-05-05', sex: 'M', position: 'ARG', dept: '83', club: 'AS Rêveuse', license: '6383001000555' },
  { id: 'p-hugo2', firstName: 'Hugo', lastName: 'Martinbleu', birthDate: '2012-05-05', sex: 'M', position: 'AG', dept: '83', club: 'AS Rêveuse', license: '6383001000556' },
  { id: 'p-jade', firstName: 'Jade', lastName: 'Chimérique', birthDate: '2010-09-09', sex: 'F', position: 'GB', dept: '2A', club: 'Corsica Fictive', license: '6320001000666' },
  { id: 'p-tom', firstName: 'Tom', lastName: 'Utopiste', birthDate: '2011-02-28', sex: 'M', position: 'AD', dept: '971', club: 'Karukera Invent', license: '6397101000777' },
  { id: 'p-fondu', firstName: 'Lucas', lastName: 'Exemplaire', birthDate: '2011-03-14', sex: 'M', position: 'ARG', dept: '83', club: 'Club Fictif de Toulon', license: '6383001000999', mergedInto: 'p-lucas' },
  { id: 'p-hors', firstName: 'Zoé', lastName: 'Horscadre', birthDate: '2011-04-04', sex: 'F', position: 'AG', dept: '83', club: 'Entente Inventée', license: '6383001000888', review: 'refused' },
]

export const EVENEMENTS: (EvenementSrv & { deleted?: boolean })[] = [
  { id: 'ev-var', name: 'Détection U15 Var', type: 'tournoi', date: '2026-10-12', playerIds: ['p-lucas', 'p-emma', 'p-hugo', 'p-hugo2', 'p-lea'], nums: { 'p-lucas': '7', 'p-emma': '11', 'p-hugo': '9', 'p-hugo2': '19', 'p-lea': '4' } },
  { id: 'ev-old', name: 'Stage de printemps', type: 'observation', date: '2026-04-02', archived: true, playerIds: ['p-noah', 'p-tom'] },
]

export const GROUPES: GroupeSrv[] = [{ id: 'g-pole', name: 'Pôle Espoirs Fictif', playerIds: ['p-lucas', 'p-emma', 'p-noah', 'p-jade'] }]
/** Groupes vus seulement par nextar_admin_proposer (archivage) : un groupe d'unité Pôle, un groupe déjà archivé. */
export const GROUPES_ADMIN: GroupeSrv[] = [
  { id: 'g-pole-u15', name: 'Pôle U15 Fictif', pole: true, playerIds: [] },
  { id: 'g-2024', name: 'Sélection 2024 Fictive', archived: true, playerIds: [] },
  { id: 'g-stage', name: 'Stage Toussaint Fictif', playerIds: ['p-tom'] },
]
/** Événements vus seulement par nextar_admin_proposer (fin de saison 2025-26 ; un sans date). */
export const EVENEMENTS_ADMIN: EvenementSrv[] = [
  { id: 'ev-s1', name: 'Tournoi d’automne Fictif', type: 'tournoi', date: '2025-10-18', playerIds: [] },
  { id: 'ev-s2', name: 'Stage de Noël Fictif', type: 'observation', date: '2025-12-20', playerIds: [] },
  { id: 'ev-s3', name: 'Finales régionales Fictives', type: 'tournoi', date: '2026-05-30', playerIds: [] },
  { id: 'ev-sans-date', name: 'Rassemblement sans date', type: 'observation', playerIds: [] },
]
/** Unités de la structure (deux portent le même nom). */
export const UNITES = [
  { id: 'u-var', name: 'Comité Fictif du Var' },
  { id: 'u-club', name: 'Club Rêvé' },
  { id: 'u-dup1', name: 'Ligue Doublon' },
  { id: 'u-dup2', name: 'Ligue Doublon' },
]

export const MESURES: MesureSrv[] = [
  { playerId: 'p-lucas', criterionId: 'sprint_10', value: 1.92, date: '2026-09-01' },
  { playerId: 'p-lucas', criterionId: 'sprint_10', value: 1.86, date: '2026-10-12' },
  { playerId: 'p-lucas', criterionId: 'taille', value: 176, date: '2026-10-12' },
  { playerId: 'p-emma', criterionId: 'sprint_10', value: 2.05, date: '2026-10-12' },
  { playerId: 'p-emma', criterionId: 'cmj', value: 31, date: '2026-10-12' },
  { playerId: 'p-noah', criterionId: 'cmj', value: 41, date: '2026-09-20' },
  { playerId: 'p-hugo', criterionId: 'sprint_10', value: 1.99, date: '2026-10-12' },
  { playerId: 'p-lea', criterionId: 'lateralite', value: 'Gauche', date: '2026-10-12' },
  { playerId: 'p-hors', criterionId: 'sprint_10', value: 1.7, date: '2026-10-12' },
]

/** Avis : notes ET commentaires (avec des noms dedans) ; les commentaires ne doivent jamais sortir. */
export const AVIS: (AvisSrv & { strengths?: string; improvements?: string; observer?: string })[] = [
  { playerId: 'p-lucas', date: '2026-10-12', scores: { tir: 4, defense: 3, mental: 5 }, strengths: 'Lucas Exemplaire a un tir puissant', observer: 'Observateur Fictif' },
  { playerId: 'p-lucas', date: '2026-10-13', scores: { tir: 5, defense: 4 }, improvements: 'Replacement défensif' },
  { playerId: 'p-emma', date: '2026-10-12', scores: { defense: 4, mental: 4 } },
  { playerId: 'p-hugo', date: '2026-10-12', scores: { tir: 2, defense: 2 }, strengths: 'Hugo Martinvert, bonne volonté' },
]

export const VUS: VuSrv[] = [
  { playerId: 'p-lucas', eventId: 'ev-var' },
  { playerId: 'p-lucas', eventId: 'ev-var' },
  { playerId: 'p-lucas', eventId: 'ev-old' },
  { playerId: 'p-emma', eventId: 'ev-var' },
  { playerId: 'p-noah', eventId: 'ev-old' },
]

/** Textes qui ne doivent JAMAIS apparaître dans une réponse d'outil (noms, prénoms rares, dates, clubs, licences, commentaires). */
// ---------- Comptes du staff et connexions (nextar_connexions) : noms, adresses et téléphones INVENTÉS ----------

/** « Maintenant » du jeu fictif (les connexions sont placées par rapport à lui). */
export const MAINTENANT_FICTIF = Date.parse('2026-11-05T10:00:00.000Z')
const ilYaMin = (m: number) => new Date(MAINTENANT_FICTIF - m * 60_000).toISOString()

/** Comptes fictifs, AVEC adresse mail et téléphone (comme hb_profiles) : ni l'une ni l'autre ne doit jamais sortir. */
export const COMPTES: (CompteSrv & { email: string; phone?: string })[] = [
  { userId: '00000000-0000-4000-8000-0000000000a1', fullName: 'Alice Administratrice-Fictive', role: 'admin', email: 'alice.admin@exemple.test', phone: '06 11 22 33 44' },
  { userId: '00000000-0000-4000-8000-0000000000c1', fullName: 'Bruno Encadrant-Fictif', role: 'preparateur', departments: ['83'], unites: [{ name: 'Comité Fictif du Var', depts: ['83'] }], email: 'bruno.encadrant@exemple.test', phone: '+33 6 55 44 33 22' },
  // Le nom du profil est une adresse mail (compte jamais renommé) : elle ne doit pas sortir non plus.
  { userId: '00000000-0000-4000-8000-0000000000b2', fullName: 'camille.observatrice@exemple.test', role: 'observateur', unites: [{ name: 'Club Rêvé', club: '6383999' }], email: 'camille.observatrice@exemple.test' },
  { userId: '00000000-0000-4000-8000-0000000000b3', fullName: 'Denis Fédéral-Fictif', role: 'observateur', unites: [{ name: 'Fédération Fictive', federation: true }], email: 'denis@exemple.test' },
  { userId: '00000000-0000-4000-8000-0000000000b4', fullName: 'Élise Ancienne-Fictive', role: 'observateur', departments: ['13', '84'], email: 'elise@exemple.test', phone: '0611223344' },
  { userId: '00000000-0000-4000-8000-0000000000b5', fullName: null, role: null, email: 'sans.role@exemple.test' },
]

/** Ouvertures de l'appli (comme hb_connections) ; un type d'appareil farfelu (adresse IP, mail) ne doit pas sortir tel quel. */
export const SESSIONS: SessionSrv[] = [
  { userId: COMPTES[0].userId, device: 'Ordinateur', startedAt: ilYaMin(40), lastSeenAt: ilYaMin(1) },
  { userId: COMPTES[0].userId, device: 'Ordinateur', startedAt: ilYaMin(3000), lastSeenAt: ilYaMin(2900) },
  { userId: COMPTES[1].userId, device: 'iPhone (appli installée)', startedAt: ilYaMin(20), lastSeenAt: ilYaMin(3) },
  { userId: COMPTES[1].userId, device: 'Ordinateur', startedAt: ilYaMin(60), lastSeenAt: ilYaMin(8) },
  { userId: COMPTES[2].userId, device: 'Android', startedAt: ilYaMin(15), lastSeenAt: ilYaMin(9) },
  { userId: COMPTES[3].userId, device: 'iPad', startedAt: ilYaMin(30), lastSeenAt: ilYaMin(12) },
  { userId: COMPTES[4].userId, device: 'Ordinateur', startedAt: ilYaMin(200), lastSeenAt: ilYaMin(180) },
  { userId: COMPTES[5].userId, device: 'Mozilla/5.0 (X11; Linux) 192.168.1.20 test@exemple.test', startedAt: ilYaMin(6), lastSeenAt: ilYaMin(5) },
]

/** Textes des comptes qui ne doivent jamais sortir de nextar_connexions (adresses, téléphones, identifiants bruts). */
export function textesInterditsComptes(): string[] {
  const out = new Set<string>(['@', '192.168.1.20', 'Mozilla', 'exemple.test'])
  for (const c of COMPTES) {
    out.add(c.email)
    if (c.phone) out.add(c.phone)
    out.add(c.userId)
  }
  return [...out]
}

export function textesInterdits(js: readonly JoueurFictif[] = JOUEURS): string[] {
  const out = new Set<string>()
  for (const p of js) {
    out.add(p.lastName)
    if (p.firstName.length >= 4) out.add(p.firstName)
    // Année seule (« 2012 ») : elle peut sortir ; licence vide : rien à chercher.
    if (p.birthDate.length > 4) out.add(p.birthDate)
    out.add(p.club)
    if (p.license) out.add(p.license)
  }
  for (const a of AVIS) {
    if (a.strengths) out.add(a.strengths)
    if (a.improvements) out.add(a.improvements)
    if (a.observer) out.add(a.observer)
  }
  return [...out]
}

// ---------- Administration (outils nextar_admin_*) : fiches, avis, journal, activité INVENTÉS ----------

/** Fiches vues seulement par les outils d'administration (proposées, homonymes) ; noms inventés, qui ne doivent jamais sortir. */
export const JOUEURS_ADMIN: (JoueurFictif & { createdBy?: string; createdAt?: string })[] = [
  // Homonyme proposé de p-noah, seule l'année connue : doublon probable « même année ».
  { id: 'p-noah-bis', firstName: 'Noah', lastName: 'Fictivus', birthDate: '2012', sex: 'M', position: 'PIV', dept: '13', club: 'HB Nulle Part', license: '', review: 'pending', createdBy: '00000000-0000-4000-8000-0000000000b2', createdAt: '2026-10-30T18:00:00.000Z' },
  { id: 'p-ines', firstName: 'Inès', lastName: 'Proposée-Fictive', birthDate: '2013-02-02', sex: 'F', position: 'AD', dept: '83', club: 'Club Fictif de Toulon', license: '', review: 'pending', createdBy: '00000000-0000-4000-8000-0000000000c1', createdAt: '2026-11-02T09:30:00.000Z' },
  // Homonyme sans état de p-hors (hors cadre), même date : doublon probable « même date ».
  { id: 'p-zoe-bis', firstName: 'Zoé', lastName: 'Horscadre', birthDate: '2011-04-04', sex: 'F', position: 'AG', dept: '83', club: 'Entente Inventée', license: '6383001000889' },
]

/** Avis spontanés en attente de validation (auteur : un compte fictif, ou un compte supprimé). */
export const AVIS_A_VALIDER: AvisAValiderSrv[] = [
  { playerId: 'p-emma', date: '2026-11-01', createdBy: '00000000-0000-4000-8000-0000000000b2', createdAt: '2026-11-01T18:00:00.000Z' },
  { playerId: 'p-jade', date: '2026-11-03', createdBy: '00000000-0000-4000-8000-0000000000ff', createdAt: '2026-11-03T12:00:00.000Z' },
]

/** Compte du staff sans ouverture de l'appli depuis 45 jours (inactif) ; vu seulement par les outils d'administration. */
export const COMPTE_INACTIF: CompteSrv & { email: string } = { userId: '00000000-0000-4000-8000-0000000000b6', fullName: 'Fabien Inactif-Fictif', role: 'observateur', email: 'fabien@exemple.test' }

/** Création des comptes (hb_profiles.created_at). */
export const CREES_LE: Record<string, string> = {
  [COMPTES[0].userId]: '2026-01-10T08:00:00.000Z',
  [COMPTES[1].userId]: '2026-02-01T08:00:00.000Z',
  [COMPTES[2].userId]: '2026-03-01T08:00:00.000Z',
  [COMPTES[3].userId]: '2026-04-01T08:00:00.000Z',
  [COMPTES[4].userId]: '2026-05-01T08:00:00.000Z',
  [COMPTES[5].userId]: '2026-11-04T07:00:00.000Z',
  [COMPTE_INACTIF.userId]: '2026-06-01T08:00:00.000Z',
}

/** Activité fictive par compte (lignes créées sur la période, quelle qu'elle soit). */
export const ACTIVITE: Record<string, ActiviteSrv> = {
  [COMPTES[0].userId]: { avis: 2, mesures: 140, evenements: 3, vus: 25, fiches: 1 },
  [COMPTES[1].userId]: { avis: 12, mesures: 30, evenements: 1, vus: 60, fiches: 2 },
  [COMPTES[2].userId]: { avis: 5, mesures: 0, evenements: 0, vus: 10, fiches: 1 },
}

/** Dernière écriture à l'historique, par compte. */
export const ECRITURES: Record<string, string> = {
  [COMPTES[1].userId]: ilYaMin(30),
  [COMPTE_INACTIF.userId]: ilYaMin(50 * 24 * 60),
}

const ilYaJ = (j: number) => ilYaMin(j * 24 * 60)

/**
 * Journal des questions fictif. Des phrases AVEC des noms de joueurs du jeu (comme si l'appareil du coach n'avait pas eu la
 * fiche pour les anonymiser), un téléphone, une adresse mail, une adresse IP, une licence : rien de cela ne doit sortir.
 */
export const JOURNAL: JournalSrv[] = [
  { id: 'q1', at: ilYaJ(1), authorId: COMPTES[1].userId, phrase: 'Montre les mesures de Lucas Exemplaire', recipe: 'pas_comprise', page: 'joueurs' },
  { id: 'q2', at: ilYaJ(2), authorId: COMPTES[0].userId, phrase: 'montre les mesures de lucas exemplaire', recipe: 'pas_comprise', status: 'erreur', page: 'joueurs' },
  { id: 'q3', at: ilYaJ(3), authorId: COMPTES[1].userId, phrase: '[prénom] [nom] a-t-il progressé au Sprint 10 m ?', recipe: 'partielle', recipeMissing: ['Hugo Martinvert', 'tri par progression'], status: 'ok', page: 'bilan' },
  { id: 'q4', at: ilYaJ(4), authorId: COMPTES[1].userId, phrase: 'Gauchers nés en 2011 dans le Var', recipe: 'complete', page: 'joueurs' },
  { id: 'a4', at: ilYaJ(4), authorId: COMPTES[1].userId, kind: 'avis', questionId: 'q4', verdict: 'mauvaise', comment: 'je voulais la fiche de Jade Chimérique, appeler le 06 12 34 56 78 ou jade@exemple.test' },
  { id: 'q5', at: ilYaJ(5), authorId: COMPTES[0].userId, phrase: 'Compare Emma et Léa Bidonville au CMJ', recipe: 'pas_comprise', page: 'comparer' },
  { id: 'q6', at: ilYaJ(6), authorId: COMPTES[0].userId, phrase: 'liste des gardiens du Pôle Espoirs Fictif', recipe: 'complete', page: 'groupes' },
  { id: 'q7', at: ilYaJ(7), authorId: COMPTES[1].userId, phrase: 'Qui est Hugo Martinvert ? 192.168.1.20', recipe: 'pas_comprise', page: 'question' },
  { id: 'q8', at: ilYaJ(8), authorId: COMPTES[0].userId, phrase: 'Joueurs vus à Toulon et Marseille', recipe: 'pas_comprise', page: 'joueurs' },
  { id: 'q9', at: ilYaJ(40), authorId: COMPTES[1].userId, phrase: 'licence 6383001000111 de Tom Utopiste', recipe: 'pas_comprise', page: 'joueurs' },
  { id: 'v1', at: ilYaJ(2), authorId: COMPTES[1].userId, kind: 'avis_vocal', phrase: 'Emma Imaginaire très bonne défense' },
]

/** Réponse fictive de hb_admin_sante (069), avec une clé en trop et des textes piégés : rien de cela ne doit sortir tel quel. */
export const SANTE_069 = {
  version: 1,
  mesure_le: ilYaMin(0),
  base: { taille_octets: 439_353_344, postgres: '17.4' },
  tables: [
    { table: 'hb_registre', lignes_estimees: 338_824, taille_octets: 120_000_000 },
    { table: 'hb_measurements', lignes_estimees: 145_471, taille_octets: 90_000_000 },
    { table: 'hb_players', lignes_estimees: 40_001, taille_octets: 60_000_000 },
  ],
  registre: { lignes_24h: 1200, pertes_24h: 3, derniere: ilYaMin(2), purge_le: ilYaMin(400) },
  charge: { niveau: 'calme', jusqua: ilYaMin(10), en_cours: false, annonce_le: ilYaMin(15) },
  abonnements: { total: 4, comptes: 3, par_appareil: [{ appareil: 'iPhone', nb: 3 }, { appareil: 'Android', nb: 1 }], sans_envoi_reussi_30j: 1, endpoint: 'https://push.exemple.test/jeton-secret' },
  veille: [{ jour: '2026-11-04', comptes: 2, appareils: 3, envoyes: 3 }],
  notifications: { en_attente: 0, plus_ancienne: null },
  taches: [{ tache: 'handbase-purge', derniere_execution: ilYaMin(400), dernier_etat: 'succeeded', echecs_7j: 0, executions_7j: 7 }, { tache: 'alerte admin@exemple.test', dernier_etat: 'failed', echecs_7j: 2, executions_7j: 2 }],
  transcription: { periode: '2026-11', total: 5 },
  secret: 'ne doit pas sortir',
}

/** Textes des outils d'administration qui ne doivent jamais sortir (jetons, téléphones, adresses, IP, licences). */
export function textesInterditsAdmin(): string[] {
  return [...textesInterditsComptes(), COMPTE_INACTIF.email, COMPTE_INACTIF.userId, SECOND_ADMIN.email, SECOND_ADMIN.userId, '06 12 34 56 78', 'jade@exemple.test', '192.168.1.20', '6383001000111', 'jeton-secret', 'ne doit pas sortir', 'Emma Imaginaire très bonne']
}

export interface SourceFictive extends Source {
  /** Propositions d'administration déposées (nextar_admin_proposer). */
  propositionsAdmin: { id: string; titre: string; contexte: Record<string, unknown>; lignes: Record<string, unknown>[] }[]
  /** Écritures tentées (propositions de mesures, rapports, propositions d'administration). */
  ecritures: number
  propositionsDeposees: { id: string; titre: string; contexte: Record<string, unknown>; lignes: string[][]; etat: string; created_at: string }[]
  rapportsDeposes: { id: string; titre: string; contenu: string }[]
  /** Appels faits à joueursNoms (pour vérifier que nextar_lire n'en fait aucun). */
  appelsNoms: number
  /** Appels faits à connexions et comptes (un compte qui n'est pas administrateur : aucun). */
  appelsConnexions: number
  /** Appels faits aux lectures d'administration (un compte qui n'est pas administrateur : aucun). */
  appelsAdmin: number
}

/** Une Source en mémoire sur ces données (ou d'autres joueurs : grande base fictive). */
export function sourceFictive(
  o: {
    joueurs?: JoueurFictif[]
    erreurDepot?: string
    admin?: boolean
    sessions?: SessionSrv[]
    sante?: 'ok' | 'absente' | 'erreur'
    nomsTronques?: boolean
    /** Script 070 pas appliqué : la sorte « admin » est refusée par la table. */
    sans070?: boolean
    /** Identifiant du compte du jeton (défaut : l'administratrice fictive si admin, l'encadrant sinon ; null : inconnu). */
    moi?: string | null
    /** Seul administrateur ? (défaut : oui) ; non : un second administrateur fictif existe. */
    secondAdmin?: boolean
  } = {},
): SourceFictive {
  const joueurs = o.joueurs ?? JOUEURS
  const vivants = () => joueurs.filter((p) => !p.mergedInto && p.review !== 'refused')
  let n = 0
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const props: SourceFictive['propositionsDeposees'] = []
  const raps: SourceFictive['rapportsDeposes'] = []
  const propsAdmin: SourceFictive['propositionsAdmin'] = []
  const src: SourceFictive = {
    propositionsAdmin: propsAdmin,
    ecritures: 0,
    propositionsDeposees: props,
    rapportsDeposes: raps,
    appelsNoms: 0,
    appelsConnexions: 0,
    appelsAdmin: 0,
    async criteres() {
      return CRITERES.filter((c) => !c.deleted).map((c) => ({ ...c }))
    },
    async config() {
      return []
    },
    async evenements({ archives }) {
      return [...EVENEMENTS, ...(o.admin ? EVENEMENTS_ADMIN : [])].filter((e) => !(e as { deleted?: boolean }).deleted && (archives || !e.archived)).map(({ nums: _n, ...e }) => ({ ...e }))
    },
    async evenement(id) {
      const e = EVENEMENTS.find((x) => x.id === id && !x.deleted)
      return e ? { ...e } : null
    },
    async groupes({ archives }) {
      return [...GROUPES, ...(o.admin ? GROUPES_ADMIN : [])].filter((g) => archives || !g.archived).map((g) => ({ ...g }))
    },
    async groupe(id) {
      const g = GROUPES.find((x) => x.id === id)
      return g ? { ...g } : null
    },
    async joueursLire(f, max) {
      let js = vivants()
      if (f.ids) js = js.filter((p) => f.ids!.includes(p.id))
      if (f.sexe) js = js.filter((p) => p.sex === f.sexe)
      if (f.postes?.length) js = js.filter((p) => f.postes!.includes(p.position))
      if (f.depts?.length) js = js.filter((p) => f.depts!.includes(p.dept))
      if (f.annees?.length) js = js.filter((p) => f.annees!.includes(+p.birthDate.slice(0, 4)))
      return { joueurs: js.slice(0, max).map((p) => ({ id: p.id, annee: +p.birthDate.slice(0, 4), sexe: p.sex, poste: p.position, dept: p.dept })), tronque: js.length > max }
    },
    async joueursNoms(ids, max) {
      src.appelsNoms++
      let js = vivants()
      if (ids) js = js.filter((p) => ids.includes(p.id))
      return { joueurs: js.slice(0, max).map((p): JoueurNom => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate })), tronque: js.length > max }
    },
    async mesures(ids) {
      return MESURES.filter((m) => ids.includes(m.playerId))
    },
    async avis(ids) {
      return AVIS.filter((a) => ids.includes(a.playerId)).map((a) => ({ playerId: a.playerId, date: a.date, scores: a.scores }))
    },
    async vus(ids) {
      return VUS.filter((v) => ids.includes(v.playerId))
    },
    async deposerProposition(p) {
      src.ecritures++
      if (o.erreurDepot) return { erreur: o.erreurDepot }
      const id = uuid()
      props.push({ id, ...p, etat: 'en_attente', created_at: '2026-11-05T10:00:00Z' })
      return { id }
    },
    async proposition(id) {
      const p = props.find((x) => x.id === id)
      return p ? toSrv(p) : null
    },
    async propositions(limite) {
      return props.slice(-limite).reverse().map((p) => ({ ...toSrv(p), nbLignes: -1 }))
    },
    async deposerRapport(r) {
      src.ecritures++
      const id = uuid()
      raps.push({ id, ...r })
      return { id, expires_at: '2026-12-05T10:00:00Z' }
    },
    async estAdmin() {
      return o.admin === true
    },
    // Comme la base (030 : lecture réservée aux administrateurs) : rien pour un autre compte.
    async connexions(depuis, max) {
      src.appelsConnexions++
      if (!o.admin) return { sessions: [], tronque: false }
      const ss = (o.sessions ?? SESSIONS).filter((x) => x.lastSeenAt >= depuis).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      return { sessions: ss.slice(0, max).map((x) => ({ ...x })), tronque: ss.length > max }
    },
    // Comme source.ts : ni email ni phone demandés.
    async comptes(ids) {
      src.appelsConnexions++
      return COMPTES.filter((c) => ids.includes(c.userId)).map(({ email: _e, phone: _p, ...c }) => ({ ...c }))
    },
    // ---- Administration : comme la base, rien pour un compte qui n'est pas administrateur ----
    async profils() {
      src.appelsAdmin++
      if (!o.admin) return []
      return [...COMPTES, COMPTE_INACTIF, ...(o.secondAdmin ? [SECOND_ADMIN] : [])].map((c): ProfilSrv => ({ userId: c.userId, fullName: c.fullName, role: c.role, createdAt: CREES_LE[c.userId] }))
    },
    async fichesAValider(max) {
      src.appelsAdmin++
      if (!o.admin) return { fiches: [], total: 0 }
      const fs = [...joueurs, ...JOUEURS_ADMIN].filter((p) => p.review === 'pending' && !p.mergedInto).sort((a, b) => ((a as { createdAt?: string }).createdAt ?? '').localeCompare((b as { createdAt?: string }).createdAt ?? ''))
      return {
        fiches: fs.slice(0, max).map((p) => ({ id: p.id, annee: +p.birthDate.slice(0, 4), poste: p.position, dept: p.dept, createdBy: (p as { createdBy?: string }).createdBy ?? null, createdAt: (p as { createdAt?: string }).createdAt ?? null })),
        total: fs.length,
      }
    },
    async avisAValider(max) {
      src.appelsAdmin++
      if (!o.admin) return { avis: [], total: 0 }
      return { avis: AVIS_A_VALIDER.slice(0, max).map((a) => ({ ...a })), total: AVIS_A_VALIDER.length }
    },
    async nomsJoueurs(max) {
      src.appelsAdmin++
      src.appelsNoms++
      if (!o.admin) return { joueurs: [], tronque: false }
      const js = [...joueurs, ...JOUEURS_ADMIN].filter((p) => !p.mergedInto)
      const lim = o.nomsTronques ? 2 : max
      return { joueurs: js.slice(0, lim).map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate, ...(p.review ? { review: p.review } : {}) })), tronque: js.length > lim }
    },
    async propositionsEnAttente(max) {
      src.appelsAdmin++
      const ps = props.filter((p) => p.etat === 'en_attente').reverse()
      return { propositions: ps.slice(0, max).map((p) => ({ ...toSrv(p), nbLignes: -1 })), total: ps.length }
    },
    async journal(depuis, max) {
      src.appelsAdmin++
      if (!o.admin) return { lignes: [], tronque: false }
      const ls = JOURNAL.filter((l) => l.at >= depuis).sort((a, b) => b.at.localeCompare(a.at))
      return { lignes: ls.slice(0, max).map((l) => ({ ...l })), tronque: ls.length > max }
    },
    async compter(quoi: Comptage) {
      src.appelsAdmin++
      if (!o.admin) return 0
      const tous = [...joueurs, ...JOUEURS_ADMIN]
      const n: Partial<Record<Comptage, number | null>> = {
        joueurs: tous.filter((p) => !p.mergedInto).length,
        joueurs_fondus: tous.filter((p) => p.mergedInto).length,
        joueurs_revus: tous.filter((p) => p.review && !p.mergedInto).length,
        mesures: MESURES.length,
        avis: AVIS.length + AVIS_A_VALIDER.length,
        evenements: EVENEMENTS.length,
        groupes: GROUPES.length,
        vus: VUS.length,
        videos: null, // illisible
        connexions: SESSIONS.length,
        journal_questions: JOURNAL.length,
      }
      return quoi in n ? (n[quoi] ?? null) : 0
    },
    async sante() {
      src.appelsAdmin++
      if (!o.admin) return { erreur: 'Réservé aux administrateurs' }
      if (o.sante === 'ok') return { ok: JSON.parse(JSON.stringify(SANTE_069)) as Record<string, unknown> }
      if (o.sante === 'erreur') return { erreur: 'permission denied for table hb_registre' }
      return { absente: true as const }
    },
    async dernieresVues() {
      src.appelsAdmin++
      if (!o.admin) return []
      const m = new Map<string, string>()
      for (const s of o.sessions ?? SESSIONS) if (!m.has(s.userId) || s.lastSeenAt > m.get(s.userId)!) m.set(s.userId, s.lastSeenAt)
      m.set(COMPTE_INACTIF.userId, ilYaMin(45 * 24 * 60))
      return [...m].map(([userId, lastSeenAt]) => ({ userId, lastSeenAt }))
    },
    async derniereEcriture(userId) {
      src.appelsAdmin++
      if (!o.admin) return null
      if (!userId) return ilYaMin(4)
      return ECRITURES[userId] ?? null
    },
    async activite(userId) {
      src.appelsAdmin++
      if (!o.admin) return { avis: null, mesures: null, evenements: null, vus: null, fiches: null }
      return { ...(ACTIVITE[userId] ?? { avis: 0, mesures: 0, evenements: 0, vus: 0, fiches: 0 }) }
    },
    // ---- nextar_admin_proposer ----
    async moi() {
      src.appelsAdmin++
      return o.moi !== undefined ? o.moi : o.admin ? COMPTES[0].userId : COMPTES[1].userId
    },
    async unites() {
      src.appelsAdmin++
      return o.admin ? UNITES.map((u) => ({ ...u })) : []
    },
    async idsFiches(max) {
      src.appelsAdmin++
      if (!o.admin) return { fiches: [], tronque: false }
      const tous = [...joueurs, ...JOUEURS_ADMIN]
      return { fiches: tous.slice(0, max).map((p) => ({ id: p.id, fondue: !!p.mergedInto })), tronque: tous.length > max }
    },
    async deposerPropositionAdmin(p) {
      src.ecritures++
      // Comme la base : sorte « admin » refusée sans 070, et pour un compte qui n'est pas administrateur (42501).
      if (o.sans070) return { indisponible: true as const }
      if (!o.admin) return { erreur: 'réservé aux administrateurs (refus de la base)' }
      if (p.lignes.length > 50) return { erreur: 'new row violates check constraint "hb_propositions_admin_forme"' }
      const id = uuid()
      propsAdmin.push({ id, ...p })
      return { id }
    },
  }
  return src
}

/** Second administrateur fictif (essai : changer le rôle d'un administrateur qui n'est pas le dernier). */
export const SECOND_ADMIN: CompteSrv & { email: string } = { userId: '00000000-0000-4000-8000-0000000000a2', fullName: 'Gaëlle Administratrice-Fictive', role: 'admin', email: 'gaelle@exemple.test' }

const toSrv = (p: SourceFictive['propositionsDeposees'][number]): PropositionSrv => ({
  id: p.id,
  source: 'mcp',
  kind: 'mesures',
  titre: p.titre,
  etat: p.etat,
  nbLignes: p.lignes.length,
  created_at: p.created_at,
  updated_at: p.created_at,
  expires_at: '2026-12-05T10:00:00Z',
  deleted_at: null,
})

/** Grande base fictive (identifiants et noms tirés d'un générateur fixe). */
export function grandeBase(n: number): JoueurFictif[] {
  const prenoms = ['Adam', 'Basile', 'Chloé', 'Diane', 'Ethan', 'Fanny', 'Gaspard', 'Hélène', 'Iris', 'Jules', 'Kenza', 'Louis', 'Manon', 'Nina', 'Oscar', 'Paul', 'Rose', 'Sacha', 'Théo', 'Victor']
  const syll = ['ba', 'lu', 'mo', 'ri', 'ten', 'vo', 'gar', 'sel', 'pin', 'dor', 'chu', 'fal', 'nek', 'ro', 'zan', 'quel']
  let x = 123456789
  const rnd = () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0), x >>> 12) // bits du haut (ceux du bas se répètent vite)
  const out: JoueurFictif[] = []
  for (let i = 0; i < n; i++) {
    const nom = syll[rnd() % 16] + syll[rnd() % 16] + syll[rnd() % 16] + syll[rnd() % 16]
    out.push({
      id: `fict-${i.toString(36)}-${(rnd() % 1e6).toString(36)}`,
      firstName: prenoms[rnd() % prenoms.length],
      lastName: nom[0].toUpperCase() + nom.slice(1),
      birthDate: `${2008 + (rnd() % 6)}-0${1 + (rnd() % 9)}-1${rnd() % 10}`,
      sex: rnd() % 2 ? 'M' : 'F',
      position: ['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV'][rnd() % 7],
      dept: String(1 + (rnd() % 95)).padStart(2, '0'),
      club: `Club fictif ${rnd() % 500}`,
      license: String(6300000000000 + i),
    })
  }
  return out
}
