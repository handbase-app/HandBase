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
import { outilJoueur } from './joueur.ts'
import { executerOutil, type AppelMcp } from './journalMcp.ts'
import { outilProposerAReVoir, outilProposerAvis, outilProposerVus } from './proposerJoueurs.ts'
import { schemasOutils } from './schemas.ts'
import { outilConnexions, outilContexte, outilLire, outilProposer, outilRapport, outilSuivi, type Reglages, type Source } from './outils.ts'

/** Origines des navigateurs autorisées (comme supabase/functions/transcrire) ; localhost pour les essais. */
export const ORIGINES = ['https://handbase-demo.github.io', 'https://handbase-app.github.io', 'https://volleybase-demo.github.io']
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export const INSTRUCTIONS =
  'Serveur Nextar (détection et suivi de jeunes sportifs). Nextar ne donne JAMAIS le nom d’un joueur : chaque joueur est un code ' +
  '(« J- » puis 7 signes). Commence par nextar_contexte (tests, critères d’avis, postes, événements, groupes). Pour entrer des ' +
  'résultats lus sur une feuille : nextar_proposer (le coach valide ensuite dans l’appli ; rien n’est enregistré avant) ; de même ' +
  'nextar_proposer_avis (notes du match par critère d’avis), nextar_proposer_vus (joueurs vus à un événement) et ' +
  'nextar_proposer_a_revoir (joueurs à revoir). Pour ' +
  'interroger : nextar_lire (lignes en codes ; année et trimestre de naissance ; tri et limite exacts dans la base), ' +
  'nextar_joueur (historique d’un joueur par son code : séries de mesures datées, vus, avis dans le temps). Pour un rapport : ' +
  'rédige-le en Markdown AVEC LES CODES, puis nextar_rapport ; ' +
  'donne au coach le lien rendu : son appli remplacera les codes par les noms sur son appareil. N’essaie jamais de deviner ou ' +
  'de demander les noms derrière les codes. Pour un administrateur seulement, en lecture seule : nextar_connexions (qui s’est ' +
  'connecté récemment, par l’appli ou par Claude), nextar_admin_a_faire (ce qui l’attend), nextar_admin_sante (état de l’installation), ' +
  'nextar_admin_activite (activité des comptes du staff, par jour ou par heure, appli et Claude), nextar_admin_journal (actions horodatées du ' +
  'staff, par session, appels de Claude compris), nextar_admin_saisies (ce qu’un compte a saisi), nextar_admin_lots (créations en masse) et ' +
  'nextar_admin_questions (questions que les coachs n’arrivent pas à ' +
  'faire aboutir) ; noms et rôles des comptes du staff, jamais d’adresse mail, joueurs toujours en codes. Toujours pour un ' +
  'administrateur : nextar_admin_proposer PRÉPARE des actions d’administration (rôles, périmètres, archivage, fusions de ' +
  'fiches) déposées dans sa boîte « À valider » ; rien ne s’applique avant qu’il les valide dans l’appli. Chaque appel ' +
  'd’outil est noté (outil, heure, durée, nombre de lignes, filtres structurés ; jamais son contenu).'

type Ctx = { supabase: unknown; userClaims?: { id?: string; sub?: string } | null }
// deno-lint-ignore no-explicit-any
type Gestionnaire = (a: any) => Promise<Record<string, unknown>>

/** Le code de chaque outil (les schémas sont dans schemas.ts ; tools/test-mcp.ts vérifie qu'aucun ne manque). */
export function gestionnaires(src: Source, reg: Reglages): Record<string, Gestionnaire> {
  return {
    nextar_contexte: (a) => outilContexte(src, reg, a ?? {}),
    nextar_proposer: (a) => outilProposer(src, reg, a),
    nextar_proposer_avis: (a) => outilProposerAvis(src, reg, a),
    nextar_proposer_vus: (a) => outilProposerVus(src, reg, a),
    nextar_proposer_a_revoir: (a) => outilProposerAReVoir(src, reg, a),
    nextar_suivi: (a) => outilSuivi(src, reg, a ?? {}),
    nextar_lire: (a) => outilLire(src, reg, a ?? {}),
    nextar_joueur: (a) => outilJoueur(src, reg, a ?? {}),
    nextar_rapport: (a) => outilRapport(src, reg, a),
    nextar_connexions: (a) => outilConnexions(src, reg, a ?? {}),
    nextar_admin_a_faire: (a) => outilAdminAFaire(src, reg, a ?? {}),
    nextar_admin_sante: () => outilAdminSante(src, reg),
    nextar_admin_activite: (a) => outilAdminActivite(src, reg, a ?? {}),
    nextar_admin_questions: (a) => outilAdminQuestions(src, reg, a ?? {}),
    nextar_admin_journal: (a) => outilAdminJournal(src, reg, a ?? {}),
    nextar_admin_saisies: (a) => outilAdminSaisies(src, reg, a ?? {}),
    nextar_admin_lots: (a) => outilAdminLots(src, reg, a ?? {}),
    nextar_admin_proposer: (a) => outilAdminProposer(src, reg, a ?? {}),
  }
}

/**
 * Serveur MCP d'une requête. `garder` : prolonge la vie de la fonction le temps d'écrire le journal (EdgeRuntime.waitUntil),
 * sans retarder la réponse.
 */
export function creerServeur(src: Source, reg: Reglages, garder: (p: Promise<unknown>) => void = (p) => void p.catch(() => {})): McpServer {
  const server = new McpServer({ name: 'nextar', version: '1.1.0' }, { instructions: INSTRUCTIONS })
  const defs = schemasOutils(z)
  const code = gestionnaires(src, reg)
  const journal = (a: AppelMcp) => garder(src.journaliser(a).catch(() => {}))
  for (const [nom, def] of Object.entries(defs)) {
    const f = code[nom]
    if (!f) throw new Error(`outil sans code : ${nom}`)
    server.registerTool(nom, def, (a: unknown) => executerOutil(nom, a, () => f(a), journal))
  }
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
export function fabriquer(o: { sourceDe: (ctx: Ctx) => Source; reglages: () => Reglages; authorizationServer?: string; garder?: (p: Promise<unknown>) => void }) {
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
      const handler = createMcpHandler(() => creerServeur(src, reg, o.garder), {
        maxRequestBodySize: 1024 * 1024,
        onerror: (e: Error) => console.error('MCP :', e.message),
      })
      return handler.fetch(req)
    },
  )
}
