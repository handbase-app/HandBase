// Catalogue des demandes de la barre « Demander » ✦ (texte tapé ou dicté) : environ 250 phrases RÉALISTES, en français
// parlé (dictée : « euh », « tu me… », phrases longues, pronoms, fautes de dictée plausibles), pour « ne pas être bloqué ».
// Chaque phrase : la personne qui parle, la situation, le type attendu, ce que l'appli DEVRAIT faire et, pour les actions,
// la lecture juste (action, cible, nom, partie « joueurs », étape suivante). Relu par tools/test-catalogue-demandes.ts
// (filet : ce qui doit être compris en local l'est, et juste ; ce qui part au modèle part bien au modèle).
// Dépôt PUBLIC : noms FICTIFS uniquement (groupes, événements, personnes, joueurs) ; lieux et compétitions génériques.
// Principe produit : seulement du positif ou du neutre sur les jeunes ; une phrase qui appelle un marqueur négatif
// (« pas retenu ») est une action NON PRÉVUE, jamais une fonction à créer.

import type { AskPage } from '../src/demander'
import type { PlanAction } from '../src/askAction'

export type Persona = 'ligue' | 'pole' | 'observateur' | 'admin' | 'club' | 'volley'
export const PERSONA_LABEL: Record<Persona, string> = {
  ligue: 'Conseiller technique de ligue (intercomité, interligues)',
  pole: 'Entraîneur de pôle',
  observateur: 'Observateur en tournoi (téléphone)',
  admin: 'Administrateur (bilan, saison)',
  club: 'Entraîneur de club (découvre l’appli)',
  volley: 'Volley (passeuses, centraux, pointus, libéro, R4)',
}
export type Situation = 'avant' | 'pendant' | 'apres' | 'saison' | 'admin'
export type Attendu = 'question' | 'ouvrir' | 'creer_groupe' | 'ajouter_groupe' | 'ajouter_evenement' | 'enchainement' | 'mettre_a_revoir' | 'marquer_vus' | 'exporter' | 'non_prevue' | 'refus'
export const ATTENDU_LABEL: Record<Attendu, string> = {
  question: 'question',
  ouvrir: 'ouvrir (filtré)',
  creer_groupe: 'créer un groupe',
  ajouter_groupe: 'ajouter à un groupe',
  ajouter_evenement: 'ajouter à un événement',
  enchainement: 'enchaînement',
  mettre_a_revoir: 'mettre à revoir',
  marquer_vus: 'marquer vus (événement)',
  exporter: 'exporter',
  non_prevue: 'action pas encore prévue',
  refus: 'à refuser',
}
/** Où la question doit aller depuis l'en-tête (routeAsk) : liste filtrée, bilan, ou recherche d'un nom / fiche. */
export type Vers = 'joueurs' | 'evenements' | 'groupes' | 'bilan' | 'nom'
/** Famille d'action pas encore prévue (src/askAction.ts, UNPLANNED). */
export type NonPrevue = 'vus' | 'a_revoir' | 'suivre' | 'export' | 'convoquer' | 'evaluer' | 'comparer' | 'creer_evenement' | 'creer_fiche' | 'seance' | 'negatif' | 'dupliquer' | 'saison' | 'repartir'

/** Lecture juste d'une action (ce que detectAction doit rendre quand elle est lue en local). */
export type Lecture = {
  action: PlanAction
  cible?: string
  nom?: string
  joueurs?: string
  /** Joueurs de la liste affichée (« ceux-là », « cette liste »). */
  courants?: true
  /** Deuxième étape : ajout à un groupe ou un événement (cible), ou mise « à revoir » (sans cible). */
  puis?: { action: 'ajouter_groupe' | 'ajouter_evenement' | 'mettre_a_revoir'; cible?: string }
  /** exporter : le format dit (comparé seulement s'il est donné). */
  format?: 'pdf' | 'csv'
}

/**
 * Résultat attendu de detectAction APRÈS corrections : 'local' (lu par les règles, lecture juste), 'modele' (mode
 * « action » de transcrire), null (pas une action : la page la traite comme une recherche, mode « question »),
 * 'interdite', 'inconnue' (action pas encore prévue, message local).
 */
export type Sortie = 'local' | 'modele' | null | 'interdite' | 'inconnue'

export type Demande = {
  phrase: string
  persona: Persona
  situation: Situation
  attendu: Attendu
  /** Barre d'où vient la phrase ; absente : la bulle ✦ de l'en-tête. */
  page?: AskPage
  doit: string
  sortie: Sortie
  lecture?: Lecture
  vers?: Vers
  quoi?: NonPrevue
}

type Opts = { page?: AskPage }
type Item = Omit<Demande, 'persona' | 'situation'>

/** Question (recherche, calcul) : pas une action ; depuis l'en-tête, la bonne page. */
const q = (phrase: string, vers: Vers, doit: string, o: Opts = {}): Item => ({ phrase, attendu: 'question', doit, sortie: null, vers, ...o })
/** Action lue en local (lecture juste attendue). */
const a = (phrase: string, lecture: Lecture, doit: string, o: Opts = {}): Item => ({
  phrase,
  attendu: lecture.puis ? 'enchainement' : lecture.action.startsWith('ouvrir') ? 'ouvrir' : (lecture.action as Attendu),
  doit,
  sortie: 'local',
  lecture,
  ...o,
})
/** Action laissée au modèle (mode « action »). */
const m = (phrase: string, attendu: Attendu, doit: string, o: Opts = {}): Item => ({ phrase, attendu, doit, sortie: 'modele', ...o })
/** Action pas encore prévue : message local « je ne sais pas encore… voici comment faire ». */
const np = (phrase: string, quoi: NonPrevue, doit: string, o: Opts = {}): Item => ({ phrase, attendu: 'non_prevue', doit, sortie: 'inconnue', quoi, ...o })
/** Action NON COUVERTE aujourd'hui (ni lue en local, ni envoyée au modèle) : notée telle quelle, pour la suite. */
const pv = (phrase: string, attendu: Attendu, doit: string, o: Opts = {}): Item => ({ phrase, attendu, doit, sortie: null, ...o })
/** À refuser (supprimer, retirer, modifier, comptes). */
const r = (phrase: string, doit: string, o: Opts = {}): Item => ({ phrase, attendu: 'refus', doit, sortie: 'interdite', ...o })

const bloc = (persona: Persona, situation: Situation, items: Item[]): Demande[] => items.map((x) => ({ ...x, persona, situation }))

const G = (cible: string, joueurs: string): Lecture => ({ action: 'ajouter_groupe', cible, joueurs })
const E = (cible: string, joueurs: string): Lecture => ({ action: 'ajouter_evenement', cible, joueurs })
const C = (joueurs: string, nom?: string, puis?: Lecture['puis']): Lecture => ({ action: 'creer_groupe', joueurs, ...(nom ? { nom } : {}), ...(puis ? { puis } : {}) })
const OE = (cible: string, joueurs: string): Lecture => ({ action: 'ouvrir_evenement', cible, joueurs })
const OG = (cible: string, joueurs: string): Lecture => ({ action: 'ouvrir_groupe', cible, joueurs })
/** Mettre à revoir : joueurs (ou la liste affichée), événement d'origine s'il est dit. */
const RV = (joueurs: string | null, cible?: string): Lecture => ({ action: 'mettre_a_revoir', ...(joueurs === null ? { courants: true } : { joueurs }), ...(cible ? { cible } : {}) })
/** Marquer vus à l'événement cité. */
const VU = (cible: string, joueurs: string | null): Lecture => ({ action: 'marquer_vus', cible, ...(joueurs === null ? { courants: true } : { joueurs }) })
/** Exporter : un groupe (cible), ou une liste (joueurs, ou la liste affichée). */
const EX = (o: { cible?: string; joueurs?: string | null; format?: 'pdf' | 'csv' }): Lecture => ({
  action: 'exporter',
  ...(o.cible ? { cible: o.cible } : {}),
  ...(o.joueurs === null ? { courants: true as const } : o.joueurs ? { joueurs: o.joueurs } : {}),
  ...(o.format ? { format: o.format } : {}),
})

export const CATALOGUE: Demande[] = [
  // ======================= Conseiller technique de ligue =======================
  ...bloc('ligue', 'avant', [
    q('Les 2011 du Var qui ont au moins deux avis', 'joueurs', 'Joueurs filtrés : 2011, Var, au moins 2 avis.'),
    q('euh montre-moi les gardiens nés en 2011 dans la région Sud', 'joueurs', 'Joueurs : gardiens, 2011, Région Sud.'),
    q('Quels sont les gauchers 2011 les plus grands du comité du Var ?', 'joueurs', 'Joueurs : gauchers 2011, Var, triés par taille.'),
    q('Combien de 2011 ont déjà été vus cette saison dans le Var ?', 'bilan', 'Bilan : un nombre.'),
    q('les filles 2011 vues au moins deux fois cette saison, par département', 'bilan', 'Bilan : tableau par département.'),
    q('Les arrières gauches 2011 qui ont une bonne note en engagement', 'joueurs', 'Joueurs : poste ARG, 2011, avis Engagement haut.'),
    q('donne-moi les 2011 qui n’ont pas encore d’avis', 'joueurs', 'Joueurs : 2011 sans avis.'),
    q('les 2011 jamais vus cette saison', 'joueurs', 'Joueurs : 2011, aucun « vu » cette saison.'),
    q('Les dix meilleurs 2011 en vitesse sur 20 mètres', 'joueurs', 'Joueurs : 2011, mesure 20 m, tri, 10 premiers.'),
    q('Les 2011 de plus d’1m80 avec une détente supérieure à 45 centimètres', 'joueurs', 'Joueurs : 2011, taille ≥ 180, détente ≥ 45.'),
    q('les pivots 2011 de plus de 85 kilos', 'joueurs', 'Joueurs : PIV, 2011, poids ≥ 85.'),
    q('Les joueuses 2011 avec une envergure supérieure à leur taille', 'joueurs', 'Joueurs (le modèle : envergure > taille, sinon « pas pris en compte »).'),
    q('Qui sont les 2011 du Var qui sont à revoir ?', 'joueurs', 'Joueurs : 2011, Var, à revoir.'),
    q('les 2011 mis à revoir par Paul au tournoi de Fictiville', 'joueurs', 'Joueurs : à revoir par Paul, lieu tournoi de Fictiville.'),
    q('Les 2011 vus au stage de Toussaint qui n’étaient pas à l’intercomité de l’an dernier', 'joueurs', 'Joueurs : vus au stage, pas dans l’événement (le modèle).'),
    q('Les joueurs du groupe Intercomité 2011', 'joueurs', 'Depuis l’en-tête : Joueurs filtrés par le groupe.'),
    a('Crée un groupe avec les gauchers de 2011 du Var', C('les gauchers de 2011 du Var'), 'Carte : chercher, puis créer le groupe (nom d’après les critères).'),
    a('Crée-moi un groupe appelé Intercomité 2011 garçons avec les garçons 2011 du Var qui ont au moins un avis', C('les garçons 2011 du Var qui ont au moins un avis', 'Intercomité 2011 garçons'), 'Carte : créer « Intercomité 2011 garçons ».'),
    a('Crée un groupe Stage février avec les gauchers nés en 2011 et ajoute-les à l’événement Stage de février', C('les gauchers nés en 2011', 'Stage février', { action: 'ajouter_evenement', cible: 'Stage de février' }), 'Carte en deux étapes : créer le groupe, puis ajouter les mêmes joueurs à l’événement.'),
    a('Prends les 2010 vus au tournoi de Cannes, crée un groupe et inscris-les au stage de Pâques', C('les 2010 vus au tournoi de Cannes', undefined, { action: 'ajouter_evenement', cible: 'stage de Pâques' }), 'Carte en deux étapes ; jamais « et inscris-les… » comme nom.'),
    a('Trouve-moi les 2011 du Var vus au moins deux fois et crée-moi un groupe Intercomité 2011', C('les 2011 du Var vus au moins deux fois', 'Intercomité 2011'), 'Carte : créer « Intercomité 2011 ».'),
    a('Ajoute les 2011 du Var à au moins deux avis au groupe Intercomité 2011', G('Intercomité 2011', 'les 2011 du Var à au moins deux avis'), 'Carte : ajouter au groupe.'),
    a('Mets les joueurs mis à revoir au stage de Toussaint dans l’événement Intercomité de décembre', E('Intercomité de décembre', 'les joueurs mis à revoir au stage de Toussaint'), 'Carte : ajouter à « Intercomité de décembre » (le stage reste un critère).'),
    a('Ajoute les joueurs de mon groupe Repérés 2011 au prochain intercomité', E('prochain intercomité', 'les joueurs de mon groupe Repérés 2011'), 'Carte : l’intercomité à venir le plus proche, à confirmer (« Tu voulais dire … ? »).'),
    a('Inscris les gardiens 2011 du Var au stage de Toussaint', E('stage de Toussaint', 'les gardiens 2011 du Var'), 'Carte : ajouter à l’événement.'),
    a('Rajoute les filles 2011 vues à l’intercomité dans le groupe Interligues 2011 filles', G('Interligues 2011 filles', 'les filles 2011 vues à l’intercomité'), 'Carte : ajouter au groupe.'),
    a('Crée un groupe Intercomité 2012 avec les 2012 du Var et ajoute-les au prochain intercomité', C('les 2012 du Var', 'Intercomité 2012', { action: 'ajouter_evenement', cible: 'prochain intercomité' }), 'Deux étapes ; l’intercomité à venir le plus proche, à confirmer.'),
    a('Ajoute ceux-là au groupe Intercomité 2011', { action: 'ajouter_groupe', cible: 'Intercomité 2011', courants: true }, 'Liste Joueurs : les joueurs affichés ; ailleurs : « dis-moi quels joueurs ».', { page: 'joueurs' }),
    a('Mets cette liste dans le groupe Sélection Var 2011', { action: 'ajouter_groupe', cible: 'Sélection Var 2011', courants: true }, 'Les joueurs affichés, ajoutés au groupe.', { page: 'joueurs' }),
    pv('Fais la même chose mais en 2012', 'creer_groupe', 'Référence à l’action précédente : NON COUVERT (part comme une suite de recherche dans Joueurs).'),
    np('Constitue-moi deux groupes équilibrés avec les 2011 du Var', 'repartir', 'Répartir en plusieurs groupes : pas encore prévu, le dire.'),
    np('Convoque les joueurs du groupe Intercomité 2011 pour le stage de Toussaint', 'convoquer', 'Pas encore prévu (idée « Secrétariat ») : le dire, proposer d’ouvrir le groupe.'),
    np('Envoie un mail aux parents des 2011 sélectionnés', 'convoquer', 'Pas encore prévu (convocations plus tard).'),
    np('Crée un stage le 25 octobre à Fictiville pour les 2011', 'creer_evenement', 'Créer un événement : depuis Événements ; le dire.'),
    np('Prépare la convocation pour l’intercomité', 'convoquer', 'Pas encore prévu.'),
  ]),
  ...bloc('ligue', 'pendant', [
    q('Les 2011 présents à l’intercomité qui n’ont pas encore d’avis', 'joueurs', 'Joueurs : dans l’événement, sans avis.'),
    a('Affiche les gardiennes du groupe Pôle espoirs qui n’ont pas encore d’avis', OG('Pôle espoirs', 'les gardiennes qui n’ont pas encore d’avis'), 'Ouvrir le groupe, filtré (cible sans « qui… »).'),
    a('Les arrières droits du groupe Intercomité 2011 triés par taille', OG('Intercomité 2011', 'les arrières droits triés par taille'), 'Ouvrir le groupe filtré (cible sans « triés… »).'),
    a('les gauchers dans l’événement Intercomité de décembre', OE('Intercomité de décembre', 'les gauchers'), 'Ouvrir l’événement filtré.', { page: 'evenements' }),
    q('Les gauchers dans l’événement Intercomité de décembre', 'joueurs', 'Liste Joueurs : reste un filtre (événement + gauchers).', { page: 'joueurs' }),
    a('Montre-moi les pivots de l’événement Intercomité de décembre avec leurs mesures', OE('Intercomité de décembre', 'les pivots avec leurs mesures'), 'Ouvrir l’événement filtré (cible sans « avec leurs… »).'),
    a('Marque comme vus tous les joueurs de l’événement Intercomité de décembre', VU('Intercomité de décembre', 'tous les joueurs'), 'Carte : marquer vus à l’événement (tous ses joueurs, sans appel au modèle), K déjà vus ; Défaire.'),
    a('Mets à revoir les gauchers vus aujourd’hui', RV('les gauchers vus aujourd’hui'), 'Carte : mettre à revoir pour moi (origine : la liste), K le sont déjà ; Défaire.'),
    np('note-les tous comme vus', 'vus', 'Sans événement : le dire (un « vu » est toujours lié à un événement).'),
    a('Ajoute les meilleurs du match de ce matin au groupe Interligues 2011', G('Interligues 2011', 'les meilleurs du match de ce matin'), 'Carte : cible lue ; « meilleurs du match » : critère flou, la carte dira « pas pris en compte ».'),
  ]),
  ...bloc('ligue', 'apres', [
    q('Combien de joueurs ont été vus à l’intercomité de décembre ?', 'bilan', 'Bilan : un nombre.'),
    q('Quel club a le plus de joueurs retenus dans le groupe Interligues 2011 ?', 'bilan', 'Bilan : tableau par club (modèle).'),
    q('la répartition par poste des 2011 vus cette saison', 'bilan', 'Bilan : tableau par poste.'),
    q('Les 2011 vus au moins trois fois cette saison qui ne sont dans aucun groupe', 'joueurs', 'Joueurs : vus ≥ 3, sans groupe (le modèle, sinon « pas pris en compte »).'),
    a('Crée un groupe Interligues 2011 avec les 2011 notés au-dessus de 3 en moyenne', C('les 2011 notés au-dessus de 3 en moyenne', 'Interligues 2011'), 'Carte : créer « Interligues 2011 ».'),
    a('Ajoute les 2011 vus à l’intercomité au groupe Repérés 2011', G('Repérés 2011', 'les 2011 vus à l’intercomité'), 'Carte : ajouter au groupe.'),
    a('Inscris les joueurs du groupe Interligues 2011 au stage de février', E('stage de février', 'les joueurs du groupe Interligues 2011'), 'Carte : ajouter à l’événement.'),
    a('Ajoute les joueurs de l’intercomité de décembre au dernier stage', E('dernier stage', 'les joueurs de l’intercomité de décembre'), 'Le stage passé le plus récent, à confirmer.'),
    a('Exporte en PDF les joueurs du groupe Interligues 2011', EX({ cible: 'Interligues 2011', format: 'pdf' }), 'Carte : joueurs du groupe → [PDF / liste à imprimer] [Tableur (CSV)].'),
    a('Exporte la liste des 2011 du Var en Excel', EX({ joueurs: 'les 2011 du Var', format: 'csv' }), 'Carte : joueurs → [Tableur (CSV)].'),
    a('Imprime le groupe Interligues 2011', EX({ cible: 'Interligues 2011', format: 'pdf' }), 'Carte : export du groupe, PDF en premier.'),
    np('Marque comme pas retenus ceux qui ne sont pas dans le groupe', 'negatif', 'Jamais de marqueur négatif : « je ne fais pas ça », proposer le groupe.'),
    r('Retire les 2012 du groupe Interligues 2011', 'Refus : retirer, à faire depuis la page.'),
    r('Supprime le groupe Intercomité 2010', 'Refus.'),
    r('Vide l’événement Intercomité de décembre', 'Refus.'),
    np('Fais un bilan de l’intercomité pour le comité directeur', 'export', 'Rapport rédigé : pas prévu ; dire que l’export d’un groupe ou d’une liste existe.'),
  ]),
  ...bloc('ligue', 'saison', [
    q('Les 2011 à revoir que personne n’a revus depuis trois mois', 'joueurs', 'Joueurs : à revoir, pas vus depuis 3 mois (modèle).'),
    q('Quels 2011 ont le plus progressé en détente depuis septembre ?', 'bilan', 'Calcul de progression : le modèle (pas sûr d’être pris en compte).'),
    q('Les 2011 précoces, avec un âge de maturité avancé', 'joueurs', 'Joueurs : maturité avancée.'),
    q('Les 2011 tardifs mais grands', 'joueurs', 'Joueurs : maturité tardive, grands.'),
    q('Les joueuses du Var et des Alpes-Maritimes nées en 2012', 'joueurs', 'Joueurs : deux départements, F, 2012.'),
    q('les 2012 qu’on n’a jamais vus', 'joueurs', 'Joueurs : 2012, jamais vus.'),
    q('Les groupes de 2011', 'groupes', 'Groupes filtrés.'),
    q('Les intercomités de cette saison', 'evenements', 'Événements filtrés.'),
    q('le prochain intercomité', 'evenements', 'Événements : à venir, nom « intercomité ».'),
    a('Ajoute les 2012 repérés au tournoi de Fictiville au groupe Repérés 2012', G('Repérés 2012', 'les 2012 repérés au tournoi de Fictiville'), 'Carte : ajouter au groupe.'),
    np('Suis tous les gauchers 2011 du Var', 'suivre', 'Pas encore prévu ici : sélection → « Suivre ».'),
  ]),
  ...bloc('ligue', 'admin', [
    q('Les groupes que j’ai créés', 'groupes', 'Groupes : mes groupes.'),
    a('Montre-moi tous les groupes que Camille Fictif a créés', { action: 'filtrer_createur' }, 'Groupes filtrés par créatrice (nom à confirmer s’il est approchant).', { page: 'groupes' }),
    r('Donne les droits d’accès à Paul sur le groupe Intercomité 2011', 'Refus : comptes et droits.'),
    np('Duplique le groupe Intercomité 2011 pour 2012', 'dupliquer', 'Pas encore prévu ici : ⋮ du groupe → Dupliquer.'),
  ]),

  // ======================= Entraîneur de pôle =======================
  ...bloc('pole', 'avant', [
    q('les joueurs du pôle nés en 2010', 'joueurs', 'Joueurs : pôle en cours, 2010.'),
    q('Les demi-centres du pôle', 'joueurs', 'Joueurs : DC, pôle.'),
    q('les entrants potentiels au pôle pour l’an prochain', 'joueurs', 'Joueurs (flou : le modèle).'),
    q('Les 2012 du pôle de Fictiville et du pôle d’Exempleville', 'joueurs', 'Joueurs : membres des groupes « Pôle … ».'),
    q('Les joueurs du pôle qui n’ont pas fait les tests physiques cette saison', 'joueurs', 'Joueurs : pôle, sans mesure cette saison (modèle).'),
    a('Crée un groupe Tests novembre avec les joueurs du pôle nés en 2010', C('les joueurs du pôle nés en 2010', 'Tests novembre'), 'Carte : créer « Tests novembre ».'),
    a('Ajoute les 2010 du pôle au stage de Toussaint', E('stage de Toussaint', 'les 2010 du pôle'), 'Carte : ajouter à l’événement.'),
    a('mets les gardiens du pôle dans le groupe Gardiens pôle', G('Gardiens pôle', 'les gardiens du pôle'), 'Carte : ajouter au groupe.'),
    np('Programme une séance de tests physiques pour le groupe Pôle Fictiville', 'seance', 'Pas encore prévu : séquenceur depuis la page.'),
    np('Lance une séance de tests avec les 2010 du pôle', 'seance', 'Pas encore prévu.'),
    np('Crée un événement Tests physiques le 12 novembre', 'creer_evenement', 'Créer un événement : depuis Événements.'),
  ]),
  ...bloc('pole', 'pendant', [
    q('les 20 mètres du groupe Pôle Fictiville', 'joueurs', 'En-tête : Joueurs filtrés par le groupe, colonne 20 m (modèle).'),
    a('Montre les joueurs du groupe Pôle Fictiville qui ont moins de 3,2 secondes au 20 mètres', OG('Pôle Fictiville', 'les joueurs qui ont moins de 3,2 secondes au 20 mètres'), 'Ouvrir le groupe filtré.'),
    a('Les gauchers du groupe Pôle Fictiville', OG('Pôle Fictiville', 'les gauchers'), 'Ouvrir le groupe filtré.'),
    a('Affiche les ailiers du groupe Pôle Fictiville classés par détente', OG('Pôle Fictiville', 'les ailiers classés par détente'), 'Ouvrir le groupe filtré (cible sans « classés… »).'),
    np('Note les 20 mètres de tout le groupe', 'seance', 'Saisie de mesures : pas ici.'),
    np('Évalue les joueurs du groupe Pôle Fictiville', 'evaluer', 'Évaluer : depuis l’événement ou la fiche.'),
  ]),
  ...bloc('pole', 'apres', [
    q('Qui a le plus progressé au 20 mètres depuis la rentrée dans le pôle ?', 'bilan', 'Progression : le modèle.'),
    q('La taille moyenne des joueurs du pôle', 'bilan', 'Bilan : moyenne.'),
    q('Les joueurs du pôle qui ont pris plus de 5 centimètres cette année', 'joueurs', 'Progression de taille : le modèle.'),
    q('Les joueurs du pôle à maturité tardive', 'joueurs', 'Joueurs : pôle, maturité tardive.'),
    q('Combien de joueurs du pôle sont gauchers ?', 'bilan', 'Bilan : nombre.'),
    np('Compare Hugo Exemple et Léo Fictif', 'comparer', 'Comparer : sélection → « Comparer ».'),
    np('Compare les deux demi-centres du pôle', 'comparer', 'Comparer : sélection → « Comparer ».'),
    m('Mets à revoir tous ceux qui ont progressé', 'mettre_a_revoir', 'Le modèle (« ont progressé » : pas un critère connu ; la carte le dira, Accepter bloqué).'),
    a('Crée un groupe Suivi physique avec ceux qui ont moins de 45 centimètres de détente', C('ceux qui ont moins de 45 centimètres de détente', 'Suivi physique'), 'Carte : créer le groupe.'),
    r('Supprime les mesures de la séance d’hier', 'Refus.'),
    r('Modifie la taille de Hugo Exemple à 1m82', 'Refus : modifier une fiche.'),
  ]),
  ...bloc('pole', 'saison', [
    q('Les joueurs du pôle dont la dernière mesure a plus de trois mois', 'joueurs', 'Joueurs : mesures anciennes (modèle).'),
    q('les filles du pôle par année de naissance', 'bilan', 'Bilan : tableau par année.'),
    q('Les 2010 du pôle avec leur pic de croissance', 'joueurs', 'Maturité : le modèle.'),
    q('Les joueurs du pôle sans avis depuis la rentrée', 'joueurs', 'Joueurs : pôle, pas d’avis depuis septembre.'),
    q('Les arrivées au pôle cette saison', 'joueurs', 'Joueurs : entrée au pôle cette saison (modèle).'),
    q('Hugo Exemple', 'nom', 'Recherche du nom dans Joueurs.'),
    q('ouvre la fiche de Jade Fictive', 'nom', 'La fiche de la joueuse (si elle existe), sinon la recherche.'),
    a('Ajoute Hugo Exemple et Léo Fictif au groupe Pôle Fictiville', G('Pôle Fictiville', 'Hugo Exemple et Léo Fictif'), 'Carte : ajouter deux joueurs nommés (groupe Pôle : refus des droits, depuis la page).'),
    a('Mets les 2010 du pôle qui ont plus de 3 avis dans le groupe Suivi 2010', G('Suivi 2010', 'les 2010 du pôle qui ont plus de 3 avis'), 'Carte : ajouter au groupe.'),
    a('Crée-moi un groupe des gardiens du pôle', C('gardiens du pôle'), 'Carte : créer le groupe.'),
    np('Envoie le programme de la semaine aux joueurs du pôle', 'convoquer', 'Pas prévu.'),
  ]),
  ...bloc('pole', 'admin', [
    q('Combien de joueurs dans le pôle cette saison ?', 'bilan', 'Bilan : nombre.'),
    r('Archive le groupe Pôle 2024', 'Refus.'),
    r('Enlève Léo Fictif du pôle', 'Refus.'),
    r('Change le statut de saison de Hugo Exemple', 'Refus : modifier.'),
  ]),

  // ======================= Observateur en tournoi =======================
  ...bloc('observateur', 'pendant', [
    q('les gauchers de Fictiville Handball', 'joueurs', 'Joueurs : club, gauchers.'),
    q('le numéro 12 de Fictiville', 'joueurs', 'Joueurs (numéro : le modèle, sinon recherche).'),
    q('Les joueurs du tournoi de Fictiville', 'joueurs', 'Joueurs filtrés par l’événement.'),
    q('les grands du tournoi de Fictiville', 'joueurs', 'Joueurs : événement, grands (tri par taille).'),
    q('Liste les joueurs du tournoi de l’Espenon qui mesurent plus d’1m85', 'joueurs', 'Liste Joueurs : filtre (événement + taille).', { page: 'joueurs' }),
    a('Liste les joueurs du tournoi de l’Espenon qui mesurent plus d’1m85', OE('tournoi de l’Espenon', 'les joueurs qui mesurent plus d’1m85'), 'En-tête : ouvrir l’événement filtré (cible sans « qui… »).'),
    q('euh les 2011 vus aujourd’hui', 'joueurs', 'Joueurs : 2011, vus aujourd’hui.'),
    q('Ceux que j’ai vus ce matin', 'joueurs', 'Joueurs : vus par moi aujourd’hui.'),
    q('Les joueurs que j’ai mis à revoir aujourd’hui', 'joueurs', 'Joueurs : mes à revoir du jour.'),
    q('Est-ce que j’ai déjà vu Hugo Exemple ?', 'bilan', 'Question oui / non : le bilan ou la fiche (modèle).'),
    q('les pivots costauds de plus d’1m90', 'joueurs', 'Joueurs : PIV, taille ≥ 190.'),
    q('Les gardiennes du tournoi qui n’ont pas encore d’avis', 'joueurs', 'Joueurs : GB F, sans avis (« du tournoi » : flou).'),
    q('Les droitiers pas encore notés en défense', 'joueurs', 'Joueurs : sans avis de la famille Défense.'),
    a('Ajoute les gauchers vus aujourd’hui au groupe Repérés tournoi', G('Repérés tournoi', 'les gauchers vus aujourd’hui'), 'Carte : ajouter au groupe.'),
    a('Trouve les 2011 que j’ai vus ce matin et crée-moi un groupe Repérés Fictiville', C('les 2011 que j’ai vus ce matin', 'Repérés Fictiville'), 'Carte : créer le groupe.'),
    a('Mets les gardiens de Fictiville Handball au tournoi de Fictiville', E('tournoi de Fictiville', 'les gardiens de Fictiville Handball'), 'Carte : ajouter à l’événement.'),
    a('Ajoute les 2011 du club Beta à l’événement Tournoi de Fictiville', E('Tournoi de Fictiville', 'les 2011 du club Beta'), 'Carte : ajouter à l’événement.'),
    a('euh tu peux mettre les gauchers de 2012 dans le groupe Repérés 2012 stp', G('Repérés 2012', 'les gauchers de 2012'), 'Carte : ajouter au groupe (sans « stp » dans le nom).'),
    a('Crée un groupe euh Repérés tournoi avec les joueurs vus aujourd’hui', C('les joueurs vus aujourd’hui', 'Repérés tournoi'), 'Carte : nom sans « euh ».'),
    a('Ajoute les filles de l’équipe de Fictiville au tournoi de Fictiville', E('tournoi de Fictiville', 'les filles de l’équipe de Fictiville'), 'Carte : ajouter à l’événement.'),
    m('Ajoute-les au groupe Repérés tournoi', 'ajouter_groupe', 'Sans joueurs dits, hors liste : le modèle (« les » : qui ?).'),
    a('Ajoute ceux-là au tournoi de Fictiville', { action: 'ajouter_evenement', cible: 'tournoi de Fictiville', courants: true }, 'Liste Joueurs : les joueurs affichés.', { page: 'joueurs' }),
    a('Crée un groupe avec ceux-là', { action: 'creer_groupe', courants: true }, 'Liste Joueurs : groupe avec les joueurs affichés.', { page: 'joueurs' }),
    np('Mets Hugo Exemple à revoir', 'a_revoir', 'Un joueur précis : pas ici, l’horloge sur sa ligne.'),
    np('marque le 7 de Fictiville comme vu', 'vus', 'Un joueur précis : pas ici.'),
    m('Mets-les tous à revoir pour le stage', 'mettre_a_revoir', 'Pronom et « pour le stage » (vague) : le modèle, jamais une cible devinée.'),
    a('Ajoute les gauchers vus aujourd’hui à mes à revoir', RV('les gauchers vus aujourd’hui'), 'Carte : mettre à revoir (ce n’est pas un groupe).'),
    a('mets-les à revoir', RV(null), 'Liste Joueurs : les joueurs affichés, mis à revoir.', { page: 'joueurs' }),
    a('Ajoute à mes à revoir les 2011 du tournoi de Fictiville', RV('les 2011 du tournoi de Fictiville'), 'Carte : mettre à revoir (origine : le tournoi, retrouvé dans la recette).'),
    a('note-les comme vus au tournoi de Fictiville', VU('tournoi de Fictiville', null), 'Liste Joueurs : les joueurs affichés (de ce tournoi), marqués vus.', { page: 'joueurs' }),
    a('Marque les gauchers vus à l’événement Tournoi de Fictiville', VU('Tournoi de Fictiville', 'les gauchers'), 'Carte : marquer vus les gauchers du tournoi.'),
    a('Crée un groupe Repérés tournoi avec les gauchers vus aujourd’hui et mets-les à revoir', C('les gauchers vus aujourd’hui', 'Repérés tournoi', { action: 'mettre_a_revoir' }), 'Deux étapes : créer, puis mettre à revoir.'),
    np('Suis le numéro 9 de Fictiville', 'suivre', 'Pas encore prévu ici.'),
    np('Mets une note de 4 en vitesse à Hugo Exemple', 'evaluer', 'Évaluer : depuis la fiche.'),
    np('Note Hugo Exemple', 'evaluer', 'Évaluer : depuis la fiche.'),
    np('Marque comme non retenus les joueurs de Club Beta', 'negatif', 'Jamais de marqueur négatif.'),
    r('Supprime la fiche de Hugo Exemple', 'Refus.'),
    r('Efface mon avis sur Jade Fictive', 'Refus.'),
    q('Les 2011 du tournoi de Fictiville', 'joueurs', 'Joueurs filtrés.'),
    q('les gauchers dans le tournoi', 'joueurs', 'Joueurs (« le tournoi » sans nom : le modèle).'),
    q('combien de joueurs j’ai vus aujourd’hui', 'bilan', 'Bilan : nombre.'),
  ]),
  ...bloc('observateur', 'apres', [
    q('Les joueurs vus au tournoi de Fictiville que je n’ai pas encore évalués', 'joueurs', 'Joueurs : vus, sans mon avis.'),
    q('Qui ai-je mis à revoir au tournoi de Fictiville ?', 'joueurs', 'Joueurs : mes à revoir, lieu.'),
    q('Les meilleurs du tournoi de Fictiville en attaque', 'joueurs', 'Joueurs : événement, avis Attaque haut.'),
    q('Les 2012 qui ont joué le tournoi de Fictiville et le tournoi de Cannes', 'joueurs', 'Joueurs : deux événements.'),
    q('les joueurs que Paul a vus au tournoi', 'joueurs', 'Joueurs : vus par Paul.'),
    a('Crée un groupe avec les joueurs vus au tournoi de Fictiville qui ont au moins un avis positif', C('les joueurs vus au tournoi de Fictiville qui ont au moins un avis positif'), 'Carte : créer le groupe.'),
    a('Ajoute les joueurs mis à revoir au tournoi de Fictiville au groupe À suivre 2011', G('À suivre 2011', 'les joueurs mis à revoir au tournoi de Fictiville'), 'Carte : ajouter au groupe.'),
    a('Mets les joueurs vus au tournoi de Cannes dans le groupe Repérés 2011', G('Repérés 2011', 'les joueurs vus au tournoi de Cannes'), 'Carte : ajouter au groupe (le tournoi reste un critère).'),
    a('Prends les 2011 vus au tournoi de Fictiville et ajoute-les au groupe Repérés 2011', G('Repérés 2011', 'les 2011 vus au tournoi de Fictiville'), 'Carte : ajouter au groupe.'),
    a('Prends les 2011 vus au tournoi de Fictiville et mets-les dans l’événement Stage de Toussaint', E('Stage de Toussaint', 'les 2011 vus au tournoi de Fictiville'), 'Carte : ajouter à l’événement.'),
    a('Prends les 2011 vus au tournoi de Fictiville, crée un groupe Repérés Fictiville et ajoute-les au stage de Toussaint', C('les 2011 vus au tournoi de Fictiville', 'Repérés Fictiville', { action: 'ajouter_evenement', cible: 'stage de Toussaint' }), 'Deux étapes.'),
    a('Exporte les joueurs vus au tournoi de Fictiville', EX({ joueurs: 'les joueurs vus au tournoi de Fictiville' }), 'Carte : liste → tableur.'),
    a('Fais-moi un PDF du groupe Repérés 2011', EX({ cible: 'Repérés 2011', format: 'pdf' }), 'Carte : export du groupe, PDF en premier.'),
    a('sors-moi un tableau Excel des gauchers', EX({ joueurs: 'les gauchers', format: 'csv' }), 'Carte : liste → tableur.'),
    a('imprime la liste des 2011 du Var', EX({ joueurs: 'les 2011 du Var', format: 'pdf' }), 'Carte : liste → tableur (la liste à imprimer : seulement pour un groupe, la carte le dit).'),
    a('exporte-les', EX({ joueurs: null }), 'Liste Joueurs : les joueurs affichés → tableur.', { page: 'joueurs' }),
    np('Envoie le groupe Repérés 2011 à Paul', 'convoquer', 'Pas encore prévu.'),
    r('Retire Hugo Exemple du groupe Repérés 2011', 'Refus.'),
    r('Renomme le groupe Repérés 2011 en Repérés Fictiville', 'Refus.'),
    m('Ajoute au groupe Repérés 2011 tous les gauchers de 2011', 'ajouter_groupe', 'Cible avant les joueurs : le modèle.'),
  ]),
  ...bloc('observateur', 'avant', [
    q('Les joueurs de Fictiville Handball et du club Beta nés en 2011', 'joueurs', 'Joueurs : deux clubs, 2011.'),
    q('Qui sont les gauchers que je n’ai jamais vus ?', 'joueurs', 'Joueurs : gauchers, jamais vus par moi.'),
    q('les tournois de ce week-end', 'evenements', 'Événements filtrés.'),
    q('Les profils recherchés', 'joueurs', 'Joueurs (profils : modèle).'),
    a('Ajoute les 2011 à revoir au tournoi de Fictiville', E('tournoi de Fictiville', 'les 2011 à revoir'), 'Carte : ajouter à l’événement.'),
    np('Crée un tournoi Fictiville samedi', 'creer_evenement', 'Créer un événement : depuis Événements.'),
  ]),

  // ======================= Administrateur =======================
  ...bloc('admin', 'admin', [
    q('Combien de joueurs ont été vus cette saison ?', 'bilan', 'Bilan : nombre.'),
    q('Combien d’avis par mois depuis septembre ?', 'bilan', 'Bilan : par mois.'),
    q('Quel observateur a fait le plus d’avis cette saison ?', 'bilan', 'Bilan : par personne.'),
    q('La carte des joueurs vus par département', 'bilan', 'Bilan : carte.'),
    q('Combien de clubs en Région Sud ?', 'bilan', 'Bilan : nombre.'),
    q('le nombre d’événements par type cette saison', 'evenements', 'Événements : calcul de la liste.'),
    q('Combien de joueurs n’ont jamais été vus ?', 'bilan', 'Bilan : nombre.'),
    q('Les départements où on a vu le moins de joueurs', 'bilan', 'Bilan : par département, tri.'),
    q('Les événements à venir', 'evenements', 'Événements filtrés.'),
    q('Les groupes archivés', 'groupes', 'Groupes filtrés.'),
    q('Les stages de la saison dernière', 'evenements', 'Événements filtrés.'),
    q('les groupes de filles du Var', 'groupes', 'Groupes filtrés.'),
    q('Combien de groupes par comité ?', 'groupes', 'Groupes : calcul de la liste.'),
    q('la part de gauchers parmi les joueurs vus', 'bilan', 'Bilan : pourcentage.'),
    q('Les événements créés par Paul', 'evenements', 'Événements : créateur (filtre de la liste).'),
    a('les événements créés par Paul', { action: 'filtrer_createur' }, 'Liste Événements : filtre par créateur.', { page: 'evenements' }),
    r('Crée un compte pour Marc Fictif', 'Refus : comptes.'),
    r('Supprime le compte de Léa Fictive', 'Refus.'),
    r('Change le mot de passe de Paul', 'Refus.'),
    r('Donne le rôle administrateur à Camille', 'Refus.'),
    r('Supprime tous les doublons', 'Refus.'),
    r('Fusionne les fiches de Hugo Exemple', 'Refus.'),
    r('Supprime les événements de la saison dernière', 'Refus.'),
    r('Archive tous les groupes de l’an dernier', 'Refus.'),
    np('Passe à la saison suivante', 'saison', 'Changement de saison : depuis la page du groupe Pôle.'),
    a('Exporte toutes les fiches en CSV', EX({ joueurs: 'toutes les fiches', format: 'csv' }), 'Carte : tous les joueurs → tableur.'),
    r('Invite Paul sur l’appli', 'Refus : comptes.'),
    q('Les questions posées cette semaine', 'joueurs', 'Journal des questions : pas une recherche de joueurs (le modèle dira « pas pris en compte »).'),
  ]),
  ...bloc('admin', 'saison', [
    q('Combien de joueurs vus par génération cette saison ?', 'bilan', 'Bilan : par année.'),
    q('les joueurs vus une seule fois cette saison', 'joueurs', 'Joueurs : vus exactement 1 fois.'),
    q('Les joueuses 2012 vues une seule fois cette saison, par département', 'bilan', 'Bilan : tableau.'),
  ]),

  // ======================= Entraîneur de club (découvre) =======================
  ...bloc('club', 'saison', [
    q('mes joueurs', 'joueurs', 'Joueurs (« mes » : le modèle ; suivis ?).'),
    q('Les joueurs de mon club', 'joueurs', 'Joueurs (« mon club » : inconnu → « pas pris en compte »).'),
    q('Les joueurs de Fictiville Handball', 'joueurs', 'Joueurs : club.'),
    q('les U15 de Fictiville', 'joueurs', 'Joueurs : club, U15 → années (modèle).'),
    q('Les moins de 15 ans', 'joueurs', 'Joueurs : âge (modèle).'),
    q('Les filles de 13 ans', 'joueurs', 'Joueurs : F, âge.'),
    q('comment je crée un groupe ?', 'groupes', 'Question d’aide : pas une action ; aujourd’hui la liste Groupes, faute de mieux (aide NON COUVERTE).'),
    q('Qu’est-ce que je peux te demander ?', 'bilan', 'Aide : non couverte (le bilan dira qu’il ne sait pas).'),
    q('aide', 'nom', 'Un mot seul : recherche de nom (non couvert).'),
    q('Les meilleurs joueurs', 'joueurs', 'Joueurs (« meilleurs » : tri par avis, modèle).'),
    q('Les joueurs suivis', 'joueurs', 'Joueurs : suivis.'),
    q('Les joueurs que je suis', 'joueurs', 'Joueurs : suivis par moi.'),
    q('les garçons nés en 2012 qui jouent arrière', 'joueurs', 'Joueurs : M, 2012, arrières.'),
    q('Les joueurs qui ont une vidéo', 'joueurs', 'Joueurs : avec vidéo.'),
    q('Les joueurs les plus rapides', 'joueurs', 'Joueurs : tri vitesse (modèle).'),
    q('Mes groupes', 'groupes', 'Groupes : les miens.'),
    q('Les événements de mon club', 'evenements', 'Événements (club : modèle).'),
    q('Où sont mes à revoir ?', 'bilan', 'Navigation : non couverte (devrait ouvrir « Mes à revoir »).'),
    a('Crée un groupe avec mes joueurs nés en 2012', C('mes joueurs nés en 2012'), 'Carte : créer le groupe.'),
    a('Fais-moi un groupe avec les 2012 de Fictiville Handball', C('les 2012 de Fictiville Handball'), 'Carte : créer le groupe.'),
    a('crée un groupe U13 avec les joueurs de Fictiville nés en 2013', C('les joueurs de Fictiville nés en 2013', 'U13'), 'Carte : créer « U13 ».'),
    a('Ajoute Hugo Exemple au groupe U15 Fictiville', G('U15 Fictiville', 'Hugo Exemple'), 'Carte : ajouter un joueur nommé.'),
    a('Mets les filles de 2012 de Fictiville dans le groupe Filles 2012', G('Filles 2012', 'les filles de 2012 de Fictiville'), 'Carte : ajouter au groupe.'),
    a('Je voudrais créer un groupe pour mes 2012', C('mes 2012'), 'Carte : créer le groupe (« mes » : le modèle de la recette dira s’il ne sait pas).'),
    a('Tu peux me faire une sélection des meilleurs 2012 ?', C('meilleurs 2012'), 'Carte : créer un groupe (la carte montre la liste avant tout).'),
    m('Fais un groupe', 'creer_groupe', 'Sans joueurs : le modèle demandera lesquels.'),
    np('Crée un événement entraînement mardi', 'creer_evenement', 'Créer un événement : depuis Événements.'),
    np('Ajoute un joueur Hugo Exemple né en 2012', 'creer_fiche', 'Créer une fiche : pas par Demander (bouton « + Joueur »).'),
    np('Évalue Hugo Exemple', 'evaluer', 'Évaluer : depuis la fiche.'),
    np('Suis Hugo Exemple', 'suivre', 'Suivre : sur la fiche ou la ligne.'),
    r('Supprime Hugo Exemple', 'Refus.'),
    r('Modifie la date de naissance de Hugo Exemple', 'Refus.'),
    r('Change le poste de Jade Fictive en pivot', 'Refus.'),
    r('Supprime mon groupe U15', 'Refus.'),
    r('Enlève Hugo Exemple de mon groupe', 'Refus.'),
    q('les gauchers', 'joueurs', 'Joueurs : gauchers.'),
    q('Les gardiens', 'joueurs', 'Joueurs : gardiens.'),
    q('2012', 'joueurs', 'Une année seule : Joueurs 2012.'),
    q('Les joueurs qui ont progressé', 'joueurs', 'Progression : modèle (souvent pas pris en compte).'),
    q('montre-moi les filles', 'joueurs', 'Joueurs : F.'),
    q('les gauchers du groupe U15 Fictiville', 'joueurs', 'Liste Joueurs : filtre groupe + gauchers.', { page: 'joueurs' }),
    a('Les gauchers du groupe U15 Fictiville', OG('U15 Fictiville', 'les gauchers'), 'En-tête : ouvrir le groupe filtré.'),
    q('Les joueurs du groupe U15 Fictiville', 'joueurs', 'En-tête : Joueurs filtrés par le groupe.'),
  ]),
  ...bloc('club', 'avant', [
    a('Inscris mes 2012 au tournoi de Fictiville', E('tournoi de Fictiville', 'mes 2012'), 'Carte : ajouter à l’événement.'),
    a('Ajoute les joueurs du groupe U15 Fictiville au tournoi de Fictiville', E('tournoi de Fictiville', 'les joueurs du groupe U15 Fictiville'), 'Carte : ajouter à l’événement.'),
    m('Prépare-moi une équipe pour samedi avec mes meilleurs 2012', 'creer_groupe', 'Le modèle (critère flou).'),
  ]),

  // ======================= Phrases longues, dictées, pronoms =======================
  ...bloc('ligue', 'avant', [
    a('Alors euh tu me trouves tous les gauchers du Var nés en 2011 qui font plus d’1m80 et tu me crées un groupe Gauchers Var 2011', C('tous les gauchers du Var nés en 2011 qui font plus d’1m80', 'Gauchers Var 2011'), 'Carte : créer « Gauchers Var 2011 ».'),
    a('Bon, ajoute les gardiens 2011 de la région Sud au groupe Interligues 2011 s’il te plaît', G('Interligues 2011', 'les gardiens 2011 de la région Sud'), 'Carte : ajouter (sans « s’il te plaît »).'),
    a('Tu peux m’ajouter les arrières droits 2011 du Var dans le groupe Intercomité 2011', G('Intercomité 2011', 'les arrières droits 2011 du Var'), 'Carte : ajouter au groupe.'),
    a('Trouve-moi les 2011 qui ont été vus au moins deux fois et crée-moi un groupe avec', C('les 2011 qui ont été vus au moins deux fois'), 'Carte : créer le groupe.'),
    a('Cherche les ailiers 2011 du Var puis ajoute-les au groupe Intercomité 2011', G('Intercomité 2011', 'les ailiers 2011 du Var'), 'Carte : ajouter au groupe.'),
    a('Ajoute les 2011 des Alpes-Maritimes et du Var au stage de Toussaint', E('stage de Toussaint', 'les 2011 des Alpes-Maritimes et du Var'), 'Carte : ajouter à l’événement.'),
    a('Mets les gauchers du dans le bar nés en 2011 dans le groupe Intercomité 2011', G('Intercomité 2011', 'les gauchers du dans le bar nés en 2011'), 'Carte : ajouter (« dans le bar » corrigé en Var par la relecture de la dictée avant).'),
    a('Ajoute les cochers 2011 au groupe Intercomité 2011', G('Intercomité 2011', 'les cochers 2011'), 'Carte (« cochers » → gauchers corrigé avant, par la relecture de la dictée).'),
    m('Crée un groupe avec les 2011 du Var et un autre avec les 2011 des Alpes-Maritimes', 'creer_groupe', 'Deux groupes : le modèle (n’en fera qu’un : à revoir).'),
    a('Crée le groupe Intercomité 2011 et mets-y les 2011 du Var', C('les 2011 du Var', 'Intercomité 2011'), 'Carte : créer « Intercomité 2011 ».'),
    a('Crée le groupe Intercomité 2013 avec les 2013 vus cette saison puis inscris-les à l’événement Intercomité de mai', C('les 2013 vus cette saison', 'Intercomité 2013', { action: 'ajouter_evenement', cible: 'Intercomité de mai' }), 'Deux étapes.'),
    a('Crée un groupe avec les 2011 du Var et ajoute-les au groupe Interligues 2011', C('les 2011 du Var', undefined, { action: 'ajouter_groupe', cible: 'Interligues 2011' }), 'Deux étapes (groupe puis autre groupe).'),
    m('Crée un groupe avec les 2011 du Var et envoie-le à Paul', 'enchainement', 'Suite non prévue (envoyer) : le modèle, jamais un nom absurde.'),
    m('Crée un groupe avec les gauchers et convoque-les au stage', 'enchainement', 'Suite non prévue : le modèle.'),
    q('les 2011 du Var, mais seulement les filles', 'joueurs', 'Joueurs : 2011, Var, F.'),
    q('et seulement les gauchers', 'joueurs', 'Suite de la recherche précédente (modèle, mode suite).'),
    q('la même chose en 2012', 'joueurs', 'Suite : année changée (modèle).'),
    q('Les mêmes mais du Var', 'joueurs', 'Suite (modèle).'),
    q('Parmi eux, ceux qui font plus d’1m80', 'joueurs', 'Suite (modèle).'),
    q('la note moyenne des gauchers en attaque', 'bilan', 'Bilan : moyenne (pas « évaluer »).'),
    q('note moyenne des gauchers', 'joueurs', 'Liste Joueurs : calcul sur la liste (pas « évaluer »).', { page: 'joueurs' }),
    a('Les gauchers du prochain intercomité', OE('prochain intercomité', 'les gauchers'), 'Ouvrir l’intercomité à venir le plus proche, filtré (à confirmer).'),
    m('Trouve les gauchers puis mets-les dans le groupe Repérés 2011 et dans le stage de Toussaint', 'enchainement', 'Deux cibles : le modèle, jamais une cible « … et dans le stage … ».'),
    a('Crée un groupe Pôle de Fictiville avec les gauchers 2012', C('les gauchers 2012', 'Pôle de Fictiville'), 'Carte : nom « Pôle de Fictiville » (le « de » du nom n’est pas pris pour « avec »).'),
    a('Mets les 2011 à revoir dans le groupe Repérés 2011', G('Repérés 2011', 'les 2011 à revoir'), 'Carte : ajouter au groupe (« à revoir » : un critère).'),
    a('Mets les 2011 à revoir au stage de Toussaint', RV('les 2011', 'stage de Toussaint'), 'Carte : chercher dans l’événement, mettre à revoir depuis l’événement.'),
  ]),

  // ======================= Volley =======================
  ...bloc('volley', 'avant', [
    q('Les passeuses 2010 de la région Sud', 'joueurs', 'Joueurs : passeuses, 2010, région.'),
    q('les centraux de plus d’1m95', 'joueurs', 'Joueurs : centraux, taille ≥ 195.'),
    q('Les pointus gauchers nés en 2009', 'joueurs', 'Joueurs : pointus gauchers, 2009.'),
    q('les libéros vus cette saison', 'joueurs', 'Joueurs : libéros, vus.'),
    q('Les R4 avec une détente de plus de 60 centimètres', 'joueurs', 'Joueurs : R4, détente ≥ 60.'),
    a('Crée un groupe avec les passeuses 2010 du Var', C('les passeuses 2010 du Var'), 'Carte : créer le groupe.'),
    a('Ajoute les centraux 2009 au stage CRE de Toussaint', E('stage CRE de Toussaint', 'les centraux 2009'), 'Carte : ajouter à l’événement.'),
    a('Les libéros du groupe Pôle volley Fictiville', OG('Pôle volley Fictiville', 'les libéros'), 'Ouvrir le groupe filtré.'),
    a('Mets les pointues 2010 dans le groupe Sélection 2010 filles', G('Sélection 2010 filles', 'les pointues 2010'), 'Carte : ajouter au groupe.'),
    a('Trouve les R4 de plus d’1m85 et crée-moi un groupe Réceptionneurs grands', C('les R4 de plus d’1m85', 'Réceptionneurs grands'), 'Carte : créer le groupe.'),
    a('Mets à revoir les passeuses vues au tournoi', RV('les passeuses vues au tournoi'), 'Carte : mettre à revoir (passeuses : mot de joueurs du volley).'),
    r('Supprime le groupe Sélection 2010 filles', 'Refus.'),
  ]),
]

/** Normalisation des comparaisons (accents, majuscules, apostrophes, petits mots de tête, ponctuation). */
export const normCat = (s: string | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[«»"“”.,;:!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:tous|toutes|les|des)\s+)+/, '')
