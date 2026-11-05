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
import { BORNES, outilConnexions, outilContexte, outilLire, outilProposer, outilRapport, outilSuivi, verifierSortie, type Reglages, type Source } from './outils.ts'

/** Origines des navigateurs autorisées (comme supabase/functions/transcrire) ; localhost pour les essais. */
export const ORIGINES = ['https://handbase-demo.github.io', 'https://handbase-app.github.io', 'https://volleybase-demo.github.io']
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export const INSTRUCTIONS =
  'Serveur Nextar (détection et suivi de jeunes sportifs). Nextar ne donne JAMAIS le nom d’un joueur : chaque joueur est un code ' +
  '(« J- » puis 7 signes). Commence par nextar_contexte (tests, critères d’avis, postes, événements, groupes). Pour entrer des ' +
  'résultats lus sur une feuille : nextar_proposer (le coach valide ensuite dans l’appli ; rien n’est enregistré avant). Pour ' +
  'interroger : nextar_lire (lignes en codes). Pour un rapport : rédige-le en Markdown AVEC LES CODES, puis nextar_rapport ; ' +
  'donne au coach le lien rendu : son appli remplacera les codes par les noms sur son appareil. N’essaie jamais de deviner ou ' +
  'de demander les noms derrière les codes. Pour un administrateur seulement, en lecture seule : nextar_connexions (qui s’est ' +
  'connecté récemment), nextar_admin_a_faire (ce qui l’attend), nextar_admin_sante (état de l’installation), ' +
  'nextar_admin_activite (activité des comptes du staff) et nextar_admin_questions (questions que les coachs n’arrivent pas à ' +
  'faire aboutir) ; noms et rôles des comptes du staff, jamais d’adresse mail, joueurs toujours en codes.'

type Ctx = { supabase: unknown; userClaims?: { id?: string } | null }

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
        'Réservé aux administrateurs ; lecture seule. Par compte du staff (code C-…, nom affiché, rôle), sur les N derniers jours : ' +
        'avis donnés, mesures saisies, événements créés, joueurs vus (joueur × événement), fiches créées, dernière activité ; ' +
        'plus les comptes inactifs depuis plus de M jours (ou jamais vus). Jamais d’adresse mail ni de donnée de joueur.',
      inputSchema: z.object({
        jours: jours('Période en jours'),
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
