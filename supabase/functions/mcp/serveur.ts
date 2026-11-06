// Nextar, serveur MCP : branchement des outils (outils.ts) dans le SDK MCP officiel, en HTTP « streamable » SANS ÉTAT (un
// serveur fabriqué à chaque requête, createMcpHandler), derrière l'authentification OAuth de Supabase :
//  - withCors : navigateurs autorisés (mêmes origines que la fonction « transcrire », plus localhost) ; Claude appelle depuis
//    ses serveurs, il n'en a pas besoin ;
//  - withOAuthProtectedResource : publie la description de la ressource protégée (…/mcp/oauth-protected-resource, RFC 9728)
//    et ajoute WWW-Authenticate aux réponses 401 : c'est ainsi que Claude trouve le serveur OAuth de Supabase ;
//  - withSupabase({ auth: 'user' }) : vérifie le jeton (clés de signature JWKS du projet) et donne un client Supabase AUX
//    DROITS DU COACH (RLS) ; sans jeton valide : 401.
// Paquets vérifiés le 05/11/2026 sur le registre npm : @modelcontextprotocol/server 2.4.0, @supabase/server 1.9.2,
// @supabase/middleware 1.0.0, zod 4.6.7 (doc : supabase.com/docs/guides/ai-tools/byo-mcp).
//
// `fabriquer` reçoit la façon d'obtenir la Source à partir du contexte (index.ts : client Supabase du jeton ; essai local de
// bout en bout : jeu fictif, tools/essai-mcp/).

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@2.4.0'
import { pipeline } from 'npm:@supabase/middleware@1.0.0'
import { withCors } from 'npm:@supabase/middleware@1.0.0/cors'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1.9.2'
import { z } from 'npm:zod@4.6.7'
import { outilAdminActivite, outilAdminAFaire, outilAdminQuestions, outilAdminSante } from './admin.ts'
import { outilAdminProposer } from './adminProposer.ts'
import { outilAdminJournal, outilAdminLots, outilAdminSaisies } from './adminTraces.ts'
import { ECHELLES_TEXTE, outilProposerAReVoir, outilProposerAvis, outilProposerVus } from './proposerJoueurs.ts'
import { JOUEURS_LIMITES, TYPES_CONTEXTE } from './partage/propositionsJoueursCore.ts'
import { BORNES, outilConnexions, outilContexte, outilLire, outilProposer, outilRapport, outilSuivi, verifierSortie, type Reglages, type Source } from './outils.ts'

/** Origines des navigateurs autorisées (comme supabase/functions/transcrire) ; localhost pour les essais. */
export const ORIGINES = ['https://handbase-demo.github.io', 'https://handbase-app.github.io', 'https://volleybase-demo.github.io']
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export const INSTRUCTIONS =
  'Serveur Nextar (détection et suivi de jeunes sportifs). Nextar ne donne JAMAIS le nom d’un joueur : chaque joueur est un code ' +
  '(« J- » puis 7 signes). Commence par nextar_contexte (tests, critères d’avis, postes, événements, groupes). Pour entrer des ' +
  'résultats lus sur une feuille : nextar_proposer (le coach valide ensuite dans l’appli ; rien n’est enregistré avant) ; de même ' +
  'nextar_proposer_avis (notes du match par critère d’avis), nextar_proposer_vus (joueurs vus à un événement) et ' +
  'nextar_proposer_a_revoir (joueurs à revoir). Pour ' +
  'interroger : nextar_lire (lignes en codes). Pour un rapport : rédige-le en Markdown AVEC LES CODES, puis nextar_rapport ; ' +
  'donne au coach le lien rendu : son appli remplacera les codes par les noms sur son appareil. N’essaie jamais de deviner ou ' +
  'de demander les noms derrière les codes. Pour un administrateur seulement, en lecture seule : nextar_connexions (qui s’est ' +
  'connecté récemment), nextar_admin_a_faire (ce qui l’attend), nextar_admin_sante (état de l’installation), ' +
  'nextar_admin_activite (activité des comptes du staff, par jour ou par heure), nextar_admin_journal (actions horodatées du ' +
  'staff, par session), nextar_admin_saisies (ce qu’un compte a saisi), nextar_admin_lots (créations en masse) et ' +
  'nextar_admin_questions (questions que les coachs n’arrivent pas à ' +
  'faire aboutir) ; noms et rôles des comptes du staff, jamais d’adresse mail, joueurs toujours en codes. Toujours pour un ' +
  'administrateur : nextar_admin_proposer PRÉPARE des actions d’administration (rôles, périmètres, archivage, fusions de ' +
  'fiches) déposées dans sa boîte « À valider » ; rien ne s’applique avant qu’il les valide dans l’appli.'

type Ctx = { supabase: unknown; userClaims?: { id?: string; sub?: string } | null }

const texte = (out: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(out, null, 1) }] })

/** Appelle un outil, vérifie sa réponse (liste blanche, outils.ts) et la met en forme MCP ; toute erreur : message neutre. */
async function repondre(nom: string, f: () => Promise<Record<string, unknown>>) {
  try {
    const out = await f()
    verifierSortie(out, nom)
    return { ...texte(out), ...('erreur' in out ? { isError: true } : {}) }
  } catch (e) {
    // Journal de la fonction : le message seul (jamais les données reçues).
    console.error(`${nom} :`, e instanceof Error ? e.message : String(e))
    return { ...texte({ erreur: 'Erreur du serveur Nextar. Réessaie dans un moment.' }), isError: true }
  }
}

const valeur = z.union([z.string().max(BORNES.cellule), z.number(), z.null()])

export function creerServeur(src: Source, reg: Reglages): McpServer {
  const server = new McpServer({ name: 'nextar', version: '1.0.0' }, { instructions: INSTRUCTIONS })
  const lecture = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  const depot = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }

  server.registerTool(
    'nextar_contexte',
    {
      title: 'Contexte Nextar',
      description:
        'Décrit l’installation Nextar du coach : tests et unités (critères de mesure), critères d’avis par poste, postes, événements et ' +
        'groupes (identifiant, nom, date, type, nombre de joueurs). Aucune donnée de joueur. À appeler en premier.',
      inputSchema: z.object({ archives: z.boolean().optional().describe('Inclure les événements et groupes archivés.') }),
      annotations: lecture,
    },
    (a) => repondre('nextar_contexte', () => outilContexte(src, reg, a ?? {})),
  )

  server.registerTool(
    'nextar_proposer',
    {
      title: 'Proposer des mesures à valider',
      description:
        'Dépose des résultats de tests (lus sur une feuille, une photo, une dictée) dans la boîte « À valider » de Nextar. Nextar ' +
        'rapproche lui-même les joueurs et ne renvoie, par ligne, que « trouvé » + code, « à vérifier », « plusieurs possibles » ' +
        '(un nombre) ou « introuvable », avec l’identifiant de la proposition. Rien n’est écrit dans les fiches avant la validation ' +
        'du coach dans l’appli. Donne `tableau` (texte : tableau Markdown, tabulations, CSV) OU `lignes` (listes de cellules avec ' +
        '`colonnes`, ou objets { nom, prenom, numero, annee, valeurs: { <id de test>: valeur } }). Utilise les identifiants de ' +
        'tests de nextar_contexte comme clés ou en-têtes. Précise l’événement ou le groupe (nom ou identifiant) pour un meilleur ' +
        'rapprochement, et la date des tests (AAAA-MM-JJ).',
      inputSchema: z.object({
        titre: z.string().max(BORNES.titreProposition).optional().describe('Titre court (« Tests du 05/11 · Pôle U15 »).'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date des tests (AAAA-MM-JJ) ; une colonne Date l’emporte.'),
        evenement: z.string().max(200).optional().describe('Événement (identifiant ou nom) où chercher les joueurs.'),
        groupe: z.string().max(200).optional().describe('Groupe (identifiant ou nom) où chercher les joueurs.'),
        tableau: z.string().max(BORNES.octets).optional().describe('Le tableau tel quel (Markdown, tabulations, CSV, lignes simples).'),
        colonnes: z.array(z.string().max(BORNES.cellule)).max(BORNES.colonnes).optional().describe('En-têtes, si `lignes` sont des listes de cellules.'),
        lignes: z
          .array(
            z.union([
              z.array(valeur).max(BORNES.colonnes),
              z.object({
                joueur: valeur.optional(),
                nom: valeur.optional(),
                prenom: valeur.optional(),
                numero: valeur.optional(),
                annee: valeur.optional(),
                date: valeur.optional(),
                valeurs: z.record(z.string().max(120), valeur).optional(),
              }),
            ]),
          )
          .max(BORNES.lignes)
          .optional(),
      }),
      annotations: depot,
    },
    (a) => repondre('nextar_proposer', () => outilProposer(src, reg, a)),
  )

  // ---------- Propositions sur des joueurs : avis, vus, à revoir (proposerJoueurs.ts) ----------

  const ligneJoueur = {
    joueur: z.string().max(JOUEURS_LIMITES.nom).optional().describe('Nom tel qu’écrit sur la feuille (« MARTIN Lucas », « Lucas M. »), ou code « J-… » de nextar_lire.'),
    nom: z.string().max(60).optional().describe('Nom de famille, si séparé du prénom.'),
    prenom: z.string().max(60).optional().describe('Prénom, si séparé du nom.'),
    numero: z.union([z.string().max(6), z.number().int()]).optional().describe('N° de maillot lu (aide au rapprochement dans un événement).'),
    annee: z.union([z.string().max(4), z.number().int()]).optional().describe('Année de naissance lue.'),
  }
  const commun = 'Nextar rapproche lui-même les joueurs et ne renvoie, par ligne, que « trouvé » + code, « à vérifier », « plusieurs possibles » ' +
    '(un nombre), « introuvable » ou « refusée » avec la raison, et l’identifiant de la proposition ; jamais un nom ni un texte. Rien ' +
    'n’est écrit dans les fiches avant que le coach valide dans l’appli (boîte « À valider », joueur modifiable).'

  server.registerTool(
    'nextar_proposer_avis',
    {
      title: 'Proposer des avis à valider',
      description:
        '« Voici mes notes du match, mets les avis. » Dépose des avis (notes par critère d’avis) dans la boîte « À valider ». ' + commun +
        ' Une ligne par joueur : `notes` { <id de critère d’avis de nextar_contexte (criteres_avis)>: note } dans l’échelle du critère ' +
        `(${ECHELLES_TEXTE} ; choice : une des options) ; un critère inconnu, hors échelle ou pas pour le poste du joueur est refusé ` +
        `(raison par note). Facultatif : \`points_forts\` et \`axes_de_progression\`, textes courts du coach (${JOUEURS_LIMITES.texte} signes ` +
        'au plus, formulations positives ou neutres ; gardés tels quels, jamais renvoyés), `date` de la ligne. Précise l’événement ' +
        '(identifiant ou nom) quand les avis portent sur un match ou un tournoi de nextar_contexte ; sans événement, avis hors ' +
        `événement (\`contexte\` : ${TYPES_CONTEXTE.join(', ')} ; défaut match), avec un groupe pour mieux rapprocher. ${JOUEURS_LIMITES.lignes.avis} joueurs au plus.`,
      inputSchema: z.object({
        titre: z.string().max(BORNES.titreProposition).optional().describe('Titre court (« Avis U15 · match du 12/10 »).'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date des avis (AAAA-MM-JJ) ; défaut : date de l’événement, sinon aujourd’hui.'),
        evenement: z.string().max(200).optional().describe('Événement (identifiant ou nom) des avis ; joueurs cherchés parmi les siens.'),
        groupe: z.string().max(200).optional().describe('Sans événement : groupe (identifiant ou nom) où chercher les joueurs.'),
        contexte: z.enum(TYPES_CONTEXTE).optional().describe('Sans événement : contexte de l’avis (défaut match).'),
        lieu: z.string().max(JOUEURS_LIMITES.lieu).optional().describe('Sans événement : lieu (« Gymnase de Hyères »).'),
        lignes: z
          .array(
            z.object({
              ...ligneJoueur,
              notes: z.record(z.string().max(120), z.union([z.number(), z.string().max(60)])).optional().describe('{ <id de critère d’avis>: note }.'),
              date: z.string().max(10).optional().describe('Date de cet avis (AAAA-MM-JJ), si différente.'),
              points_forts: z.string().max(2000).optional().describe(`Points forts, texte court du coach (${JOUEURS_LIMITES.texte} signes au plus).`),
              axes_de_progression: z.string().max(2000).optional().describe(`Axes de progression, texte court du coach (${JOUEURS_LIMITES.texte} signes au plus).`),
            }),
          )
          .max(BORNES.lignes),
      }),
      annotations: depot,
    },
    (a) => repondre('nextar_proposer_avis', () => outilProposerAvis(src, reg, a)),
  )

  server.registerTool(
    'nextar_proposer_vus',
    {
      title: 'Proposer des joueurs vus à valider',
      description:
        '« Marque vus les joueurs de cette feuille. » Dépose dans la boîte « À valider » les joueurs vus par le coach à un événement ' +
        '(`evenement` obligatoire : identifiant ou nom de nextar_contexte ; joueurs cherchés parmi les siens, ou dans toute la base ' +
        `s’il n’en a encore aucun). ${commun} Marque neutre : « vu ». ${JOUEURS_LIMITES.lignes.vus} joueurs au plus.`,
      inputSchema: z.object({
        titre: z.string().max(BORNES.titreProposition).optional(),
        evenement: z.string().min(1).max(200).describe('Événement (identifiant ou nom de nextar_contexte).'),
        lignes: z.array(z.object(ligneJoueur)).max(BORNES.lignes),
      }),
      annotations: depot,
    },
    (a) => repondre('nextar_proposer_vus', () => outilProposerVus(src, reg, a)),
  )

  server.registerTool(
    'nextar_proposer_a_revoir',
    {
      title: 'Proposer des joueurs à revoir',
      description:
        '« Mets à revoir ces joueurs. » Dépose dans la boîte « À valider » des joueurs à mettre « à revoir » pour le coach (marque ' +
        `neutre de l’appli), avec une \`raison\` courte facultative (${JOUEURS_LIMITES.raison} signes au plus, formulation positive ou ` +
        'neutre ; gardée telle quelle, jamais renvoyée). Précise l’événement où ils ont été repérés, ou un groupe, pour un meilleur ' +
        `rapprochement (sinon toute la base). ${commun} ${JOUEURS_LIMITES.lignes.a_revoir} joueurs au plus.`,
      inputSchema: z.object({
        titre: z.string().max(BORNES.titreProposition).optional(),
        evenement: z.string().max(200).optional().describe('Événement (identifiant ou nom) où ils ont été repérés.'),
        groupe: z.string().max(200).optional().describe('Groupe (identifiant ou nom) où chercher les joueurs.'),
        lignes: z.array(z.object({ ...ligneJoueur, raison: z.string().max(1000).optional().describe('Raison courte (« à revoir en défense »).') })).max(BORNES.lignes),
      }),
      annotations: depot,
    },
    (a) => repondre('nextar_proposer_a_revoir', () => outilProposerAReVoir(src, reg, a)),
  )

  server.registerTool(
    'nextar_suivi',
    {
      title: 'Suivi d’une proposition',
      description: 'État d’une proposition déposée (en attente, validée, validée en partie, rejetée). Sans identifiant : les 20 dernières.',
      inputSchema: z.object({ id: z.string().uuid().optional().describe('Identifiant rendu par nextar_proposer.') }),
      annotations: lecture,
    },
    (a) => repondre('nextar_suivi', () => outilSuivi(src, reg, a ?? {})),
  )

  server.registerTool(
    'nextar_lire',
    {
      title: 'Lire les joueurs (en codes)',
      description:
        'Interroge les joueurs du périmètre du coach et rend des lignes EN CODES : code, poste, année de naissance, sexe, département, ' +
        'nombre de « vus », dernières mesures des tests demandés, moyenne des avis (critères de 1 à 5). Jamais de nom, de club ni de ' +
        'commentaire. Filtres : années, sexe, postes, départements, événement ou groupe, mesures min / max, vus au moins, moyenne ' +
        'd’avis au moins ; tri ; limite (200 au plus).',
      inputSchema: z.object({
        annees: z.array(z.number().int().min(1950).max(2100)).max(20).optional(),
        sexe: z.enum(['M', 'F']).optional(),
        postes: z.array(z.string().max(10)).max(20).optional().describe('Codes de postes (nextar_contexte).'),
        departements: z.array(z.string().max(4)).max(30).optional().describe('Numéros de département (« 13 », « 2A », « 971 »).'),
        evenement: z.string().max(200).optional(),
        groupe: z.string().max(200).optional(),
        mesures: z.array(z.object({ test: z.string().max(200), min: z.number().optional(), max: z.number().optional() })).max(10).optional(),
        vus_min: z.number().int().min(0).optional(),
        avis_min: z.number().min(0).max(5).optional(),
        avis_criteres: z.array(z.object({ critere: z.string().max(200), min: z.number() })).max(10).optional(),
        avec_mesures: z.union([z.array(z.string().max(200)).max(40), z.literal('toutes')]).optional().describe('Tests à rendre (« toutes » : tous).'),
        avec_avis_criteres: z.boolean().optional().describe('Moyenne par critère d’avis.'),
        tri: z.object({ par: z.enum(['annee', 'vus', 'avis', 'test']), test: z.string().max(200).optional(), ordre: z.enum(['asc', 'desc']).optional() }).optional(),
        limite: z.number().int().min(1).max(BORNES.lireMax).optional(),
      }),
      annotations: lecture,
    },
    (a) => repondre('nextar_lire', () => outilLire(src, reg, a ?? {})),
  )

  server.registerTool(
    'nextar_rapport',
    {
      title: 'Garder un rapport (en codes)',
      description:
        'Garde 30 jours, pour le coach seul, un rapport rédigé en Markdown AVEC LES CODES des joueurs (jamais de noms), et rend un ' +
        'lien vers l’appli Nextar : en l’ouvrant, l’appareil du coach remplace chaque code par le nom et propose « Imprimer / PDF ». ' +
        'Signale les codes mal recopiés.',
      inputSchema: z.object({
        titre: z.string().max(BORNES.titreRapport).optional(),
        markdown: z.string().min(1).max(BORNES.rapport).describe('Le rapport, en Markdown (titres, listes, tableaux), avec les codes.'),
      }),
      annotations: depot,
    },
    (a) => repondre('nextar_rapport', () => outilRapport(src, reg, a)),
  )

  server.registerTool(
    'nextar_connexions',
    {
      title: 'Qui s’est connecté (administrateurs)',
      description:
        'Réservé aux administrateurs ; noms et rôles des comptes, jamais d’adresse mail. Répond à « qui s’est connecté dans les N ' +
        'dernières minutes ? » : pour chaque compte du staff qui a eu l’appli ouverte sur la période, du plus récent au plus ancien, ' +
        'le nom affiché, le rôle, le périmètre (unités d’affectation ou secteur), la dernière activité (heure ISO et « il y a N min »), ' +
        'le type d’appareil (téléphone, tablette, ordinateur) et le nombre d’ouvertures de l’appli ; plus le total. Jamais d’adresse ' +
        'mail, de téléphone, d’identifiant, d’adresse IP ni de donnée de joueur. Un compte qui n’est pas administrateur reçoit un refus.',
      inputSchema: z.object({
        minutes: z.number().int().min(1).max(BORNES.connexionsMinutesMax).optional().describe(`Fenêtre en minutes (défaut ${BORNES.connexionsMinutes}, 7 jours au plus).`),
        limite: z.number().int().min(1).max(BORNES.connexionsMax).optional().describe(`Comptes rendus au plus (défaut ${BORNES.connexionsDefaut}, ${BORNES.connexionsMax} au plus).`),
      }),
      annotations: lecture,
    },
    (a) => repondre('nextar_connexions', () => outilConnexions(src, reg, a ?? {})),
  )

  // ---------- Administration, lecture seule (admin.ts) ----------

  const jours = (quoi: string) =>
    z.number().int().min(1).max(BORNES.joursMax).optional().describe(`${quoi} (défaut ${BORNES.joursDefaut}, ${BORNES.joursMax} au plus).`)

  server.registerTool(
    'nextar_admin_a_faire',
    {
      title: 'Ce qui m’attend (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Répond à « qu’est-ce qui m’attend ? » : comptes en attente de rôle (depuis ' +
        'quand), fiches joueur proposées et avis spontanés à valider (joueurs en codes, auteur par nom affiché), doublons ' +
        'probables à fondre (paires de codes et raison), propositions « À valider » de ce compte encore en attente, questions du ' +
        'journal à traiter ; nombres et quelques éléments de chaque file, liens vers les écrans de l’appli. Jamais de nom de ' +
        'joueur ni d’adresse mail. Un compte qui n’est pas administrateur reçoit un refus.',
      inputSchema: z.object({
        limite: z.number().int().min(1).max(BORNES.aFaireMax).optional().describe(`Éléments rendus par file (défaut ${BORNES.aFaireDefaut}, ${BORNES.aFaireMax} au plus).`),
      }),
      annotations: lecture,
    },
    (a) => repondre('nextar_admin_a_faire', () => outilAdminAFaire(src, reg, a ?? {})),
  )

  server.registerTool(
    'nextar_admin_sante',
    {
      title: 'État de l’installation (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. État de l’installation Nextar : nombre de lignes des tables principales, ' +
        'comptes du staff par rôle, comptes connectés sur 24 h / 7 j / 30 j et types d’appareils, dernière écriture, erreurs du ' +
        'mode avancé sur 7 jours ; avec le script 069 : taille de la base et des tables, registre des changements, charge ' +
        'annoncée, abonnements aux notifications (des nombres), rappels de la veille, notifications en attente, tâches ' +
        'programmées (échecs). Ce qui manque est marqué « indisponible ». Aucun compte, aucun jeton, aucune donnée de joueur.',
      inputSchema: z.object({}),
      annotations: lecture,
    },
    () => repondre('nextar_admin_sante', () => outilAdminSante(src, reg)),
  )

  server.registerTool(
    'nextar_admin_activite',
    {
      title: 'Activité des comptes du staff (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Par compte du staff (code C-…, nom affiché, rôle), sur les N derniers jours ' +
        'ou une période calendaire (depuis / jusqu_a) : avis donnés, mesures saisies, événements créés, joueurs vus (joueur × ' +
        'événement), fiches créées, ventilés par provenance (saisie dans l’appli, import d’un fichier, proposition validée), ' +
        'dernière activité ; classés du plus actif au moins actif ; par: "jour" ou "heure" ajoute un histogramme par compte (heure ' +
        'de Paris). Génération (démos, jeux d’essai) exclue sauf inclure_generation: true (ligne « Générateur démo », avec les ' +
        'comptes sous lesquels ses lignes ont été posées). Plus les comptes inactifs depuis plus de M jours (ou jamais vus). ' +
        'Jamais d’adresse mail ni de donnée de joueur.',
      inputSchema: z.object({
        jours: jours('Période en jours (sans depuis / jusqu_a)'),
        depuis: z.string().max(40).optional().describe('Début : AAAA-MM-JJ (minuit à Paris) ou heure ISO. « Ce mois-ci » : le 1er du mois.'),
        jusqu_a: z.string().max(40).optional().describe('Fin (exclue) : AAAA-MM-JJ ou heure ISO ; défaut : maintenant.'),
        par: z.enum(['total', 'jour', 'heure']).optional().describe('total (défaut), jour ou heure : histogramme par compte.'),
        inclure_generation: z.boolean().optional().describe('Compter aussi la génération (démos, jeux d’essai) ; défaut : non.'),
        inactifs_jours: jours('Inactif : aucune activité depuis ce nombre de jours'),
        limite: z.number().int().min(1).max(BORNES.activiteMax).optional().describe(`Comptes rendus (défaut ${BORNES.activiteDefaut}, ${BORNES.activiteMax} au plus).`),
      }),
      annotations: lecture,
    },
    (a) => repondre('nextar_admin_activite', () => outilAdminActivite(src, reg, a ?? {})),
  )

  server.registerTool(
    'nextar_admin_questions',
    {
      title: 'Questions que les coachs n’arrivent pas à faire aboutir (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Questions « Demander » / « Poser une question » du journal sur les N derniers ' +
        'jours : par défaut celles à traiter (pas comprises en entier, sauvées par le mode avancé, ou jugées « mauvaise réponse » / ' +
        '« pas de réponse »), regroupées par formulation proche, avec le nombre, le nombre de comptes distincts, l’issue, ce que la ' +
        'recette n’a pas appliqué et ce que les coachs voulaient. Les noms de joueurs sont remplacés par [joueur] côté serveur.',
      inputSchema: z.object({
        jours: jours('Période en jours'),
        filtre: z.enum(['a_traiter', 'toutes']).optional().describe('« a_traiter » (défaut) ou « toutes ».'),
        limite: z.number().int().min(1).max(BORNES.questionsMax).optional().describe(`Groupes rendus (défaut ${BORNES.questionsDefaut}, ${BORNES.questionsMax} au plus).`),
      }),
      annotations: lecture,
    },
    (a) => repondre('nextar_admin_questions', () => outilAdminQuestions(src, reg, a ?? {})),
  )

  // ---------- Administration, traçabilité de l'activité du staff (adminTraces.ts), lecture seule ----------

  const periode = {
    depuis: z.string().max(40).optional().describe('Début : AAAA-MM-JJ (minuit à Paris) ou heure ISO (« 2026-11-05T08:00:00Z »).'),
    jusqu_a: z.string().max(40).optional().describe('Fin (exclue) : AAAA-MM-JJ ou heure ISO ; défaut : maintenant.'),
  }
  const compte = (quoi: string) => z.string().max(20).optional().describe(`${quoi} : code « C-… » (nextar_admin_activite, nextar_connexions) ; « générateur » pour la génération.`)
  const generationOpt = z.boolean().optional().describe('Montrer aussi la génération (démos, jeux d’essai), sous « Générateur démo » ; défaut : non.')

  server.registerTool(
    'nextar_admin_journal',
    {
      title: 'Journal des actions du staff (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Journal horodaté des actions du staff sur une période (défaut : 24 h, 31 ' +
        'jours au plus) : créations, modifications et suppressions de mesures, avis, événements, « vus » et fiches (historique ' +
        'des écritures), ouvertures de l’appli. Par défaut regroupé en SESSIONS (actions d’un même compte à moins de 15 min) : ' +
        'compte, début, fin, appareil, nombre par type, événements et tests touchés, joueurs distincts, provenance ; ' +
        'regrouper: false : une ligne par action (heure exacte, compte, action, type, objet en code J-…, test, événement, ' +
        'provenance, lot). Répond à « décris les actions de <compte> ce matin ». Heures en ISO UTC et à l’heure de Paris. ' +
        'Jamais de nom de joueur ni d’adresse mail.',
      inputSchema: z.object({
        compte: compte('Un seul compte'),
        ...periode,
        types: z.array(z.enum(['mesure', 'avis', 'evenement', 'vu', 'fiche', 'connexion'])).max(6).optional().describe('Types d’actions (défaut : tous).'),
        regrouper: z.boolean().optional().describe('Sessions (défaut) ou une ligne par action (false).'),
        inclure_generation: generationOpt,
        limite: z.number().int().min(1).max(BORNES.journalLimiteMax).optional().describe(`Sessions ou lignes rendues, les plus récentes (défaut ${BORNES.journalDefaut}, ${BORNES.journalLimiteMax} au plus).`),
      }),
      annotations: lecture,
    },
    (a) => repondre('nextar_admin_journal', () => outilAdminJournal(src, reg, a ?? {})),
  )

  server.registerTool(
    'nextar_admin_saisies',
    {
      title: 'Ce qu’un compte a saisi (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Contenu créé par un compte du staff sur une période (défaut : 30 jours) : ' +
        'mesures PAR TEST (nombre, joueurs, min, max, moyenne, événements, première et dernière heure de saisie, provenance) et ' +
        'avis PAR CRITÈRE (nombre de notes, joueurs, moyenne ; jamais un commentaire) ; filtres test, événement, provenance ; ' +
        'detail: true ajoute les lignes (code J-…, test, valeur, heure, provenance, lot). Répond à « quelles mesures a-t-il ' +
        'saisies ? ». Jamais de nom de joueur ni d’adresse mail.',
      inputSchema: z.object({
        auteur: compte('Auteur (défaut : tous les comptes du staff)'),
        ...periode,
        test: z.string().max(200).optional().describe('Test ou critère (identifiant ou libellé de nextar_contexte).'),
        evenement: z.string().max(200).optional().describe('Événement (identifiant ou nom).'),
        source: z.enum(['saisie_appli', 'import_fichier', 'proposition_validee', 'generation']).optional().describe('Provenance.'),
        detail: z.boolean().optional().describe('Ajouter les lignes une à une (défaut : non).'),
        inclure_generation: generationOpt,
        limite: z.number().int().min(1).max(BORNES.saisiesMax).optional().describe(`Lignes de détail par sorte (défaut ${BORNES.saisiesDefaut}, ${BORNES.saisiesMax} au plus).`),
      }),
      annotations: lecture,
    },
    (a) => repondre('nextar_admin_saisies', () => outilAdminSaisies(src, reg, a ?? {})),
  )

  server.registerTool(
    'nextar_admin_lots',
    {
      title: 'Créations en masse (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Lots de créations en masse sur une période (défaut : 365 jours) : collage ' +
        'd’un tableau, proposition validée, génération (démos, jeux d’essai) ; pour chacun : identifiant, provenance, ' +
        'description, auteur (génération : « Générateur démo » et comptes porteurs), première et dernière écriture (heure ' +
        'réelle du serveur), durée, volumes par type, dates déclarées dans les lignes (antidatage). Répond à « ces lignes ont-' +
        'elles été créées le même jour, à la même heure ? ». Aucune donnée de joueur.',
      inputSchema: z.object({
        ...periode,
        limite: z.number().int().min(1).max(BORNES.lotsMax).optional().describe(`Lots rendus, les plus récents (défaut ${BORNES.lotsDefaut}, ${BORNES.lotsMax} au plus).`),
      }),
      annotations: lecture,
    },
    (a) => repondre('nextar_admin_lots', () => outilAdminLots(src, reg, a ?? {})),
  )

  // ---------- Administration : préparer des actions à valider (adminProposer.ts) ----------

  server.registerTool(
    'nextar_admin_proposer',
    {
      title: 'Préparer des actions d’administration à valider (administrateurs)',
      description:
        'Réservé aux administrateurs ; N’APPLIQUE RIEN : prépare des actions d’administration et les dépose dans la boîte ' +
        '« À valider » de l’administrateur, qui les coche puis « Appliquer » dans l’appli (mêmes écrans, mêmes droits). Une ' +
        'sorte par proposition, 50 actions au plus : « role » (actions { compte: "C-…", role: observateur | encadrant | joueur } ; ' +
        'jamais administrateur, jamais un administrateur ni ton propre compte ; « joueur » seulement pour un compte en attente), ' +
        '« perimetre » ({ compte, unite: id ou nom, role_unite? } pour affecter à une unité, ou { compte, secteur: ["83", "2A"] }), ' +
        '« archiver » ({ evenement: id } ou { groupe: id }, identifiants de nextar_contexte avec archives ; ou ' +
        '`evenements_avant: AAAA-MM-JJ` pour tous les événements non archivés datés avant ce jour, fin de saison), « fusion » ' +
        '({ garder: "J-…", fondre: "J-…" }, codes de nextar_admin_a_faire ; l’administrateur peut inverser). Codes des comptes : ' +
        'nextar_connexions, nextar_admin_a_faire, nextar_admin_activite. Rend, par action, « prête » ou « refusée » avec la ' +
        'raison, et l’identifiant de la proposition. Joueurs en codes, comptes par nom affiché et rôle, jamais d’adresse mail. ' +
        'Un compte qui n’est pas administrateur reçoit un refus.',
      inputSchema: z.object({
        sorte: z.enum(['role', 'perimetre', 'archiver', 'fusion']).describe('Une sorte par proposition.'),
        titre: z.string().max(BORNES.titreProposition).optional().describe('Titre court (« Fin de saison 2025-26 »).'),
        actions: z
          .array(
            z.object({
              compte: z.string().max(20).optional().describe('role, perimetre : code du compte (« C-… »).'),
              role: z.string().max(30).optional().describe('role : observateur, encadrant ou joueur.'),
              unite: z.string().max(200).optional().describe('perimetre : unité de la structure (identifiant ou nom).'),
              role_unite: z.string().max(30).optional().describe('perimetre (unité) : encadrant, observateur ou administrateur ; défaut : son rôle.'),
              secteur: z.array(z.string().max(4)).max(30).optional().describe('perimetre : départements du secteur ([] : aucun).'),
              evenement: z.string().max(200).optional().describe('archiver : identifiant de l’événement.'),
              groupe: z.string().max(200).optional().describe('archiver : identifiant du groupe.'),
              garder: z.string().max(20).optional().describe('fusion : code « J-… » de la fiche à garder.'),
              fondre: z.string().max(20).optional().describe('fusion : code « J-… » de la fiche à fondre dans l’autre.'),
            }),
          )
          .max(BORNES.adminActions)
          .optional(),
        evenements_avant: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('archiver : tous les événements non archivés datés avant ce jour.'),
      }),
      annotations: depot,
    },
    (a) => repondre('nextar_admin_proposer', () => outilAdminProposer(src, reg, a ?? {})),
  )

  return server
}

/** Réglages lus dans l'environnement de la fonction (NEXTAR_APP_URL, NEXTAR_SPORT). */
export function reglagesEnv(env: { get(k: string): string | undefined }): Reglages {
  return {
    appUrl: (env.get('NEXTAR_APP_URL') ?? '').trim().replace(/\/+$/, ''),
    sport: env.get('NEXTAR_SPORT') ?? undefined,
    today: new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    maintenant: Date.now(),
  }
}

/** Le gestionnaire HTTP complet : CORS, découverte OAuth, jeton du coach, serveur MCP sans état. */
export function fabriquer(o: { sourceDe: (ctx: Ctx) => Source; reglages: () => Reglages; authorizationServer?: string }) {
  return pipeline(
    [
      withCors({
        origin: (origin: string | null) => !!origin && (ORIGINES.includes(origin) || LOCAL.test(origin)),
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['authorization', 'content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id', 'x-client-info', 'apikey'],
        exposedHeaders: ['www-authenticate', 'mcp-session-id', 'mcp-protocol-version'],
        maxAge: 600,
      }),
      withOAuthProtectedResource(o.authorizationServer ? { authorizationServer: o.authorizationServer } : {}),
      withSupabase({ auth: 'user' }),
    ],
    async (req: Request, ctx: Ctx) => {
      const src = o.sourceDe(ctx)
      const reg = o.reglages()
      const handler = createMcpHandler(() => creerServeur(src, reg), {
        maxRequestBodySize: 1024 * 1024,
        onerror: (e: Error) => console.error('MCP :', e.message),
      })
      return handler.fetch(req)
    },
  )
}
