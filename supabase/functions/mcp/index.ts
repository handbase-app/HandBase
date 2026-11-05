// Nextar : SERVEUR MCP (fonction Supabase « mcp »). Le coach le branche dans Claude (Réglages → Connecteurs → « Ajouter un
// connecteur personnalisé », adresse https://<projet>.supabase.co/functions/v1/mcp) et se connecte avec son compte Nextar
// (serveur OAuth 2.1 de Supabase Auth, page d'autorisation dans l'appli : /oauth/consent).
//
// RÈGLE : Nextar n'envoie jamais de données de joueur à une IA (codes seulement : outils.ts). Tout passe par le client
// Supabase DU COACH (son jeton, RLS) : jamais la clé de service.
//
// Fichiers : serveur.ts (SDK MCP, OAuth, CORS), outils.ts (les six outils, purs), admin.ts (les quatre outils d'administration en lecture), adminProposer.ts
// (nextar_admin_proposer : dépose des actions d'administration à valider), source.ts (requêtes aux droits du coach),
// partage/ (copies générées de modules purs de src/ : tools/generer-partage-mcp.ts). Mise en ligne : README.md.
//
// Déployer SANS la vérification JWT de la passerelle (la découverte OAuth doit passer sans jeton ; le jeton est vérifié par
// withSupabase) : supabase functions deploy mcp --no-verify-jwt
// Réglages de la fonction (Edge Functions > Secrets) : NEXTAR_APP_URL (adresse de l'appli, pour les liens), NEXTAR_SPORT
// (facultatif : « volley » pour une installation de volley sans ligne « sport »), MCP_AUTH_ISSUER (seulement avec un domaine
// personnalisé). SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, SUPABASE_JWKS sont fournis par Supabase.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { fabriquer, reglagesEnv } from './serveur.ts'
import { sourceSupabase, type ClientSupabase } from './source.ts'

const issuer = Deno.env.get('MCP_AUTH_ISSUER')?.trim()

Deno.serve(
  fabriquer({
    // Compte du jeton (claims vérifiés par withSupabase) : nextar_admin_proposer refuse toute action sur son propre compte.
    sourceDe: (ctx) => sourceSupabase(ctx.supabase as ClientSupabase, ctx.userClaims?.id ?? ctx.userClaims?.sub ?? null),
    reglages: () => reglagesEnv(Deno.env),
    ...(issuer ? { authorizationServer: issuer } : {}),
  }),
)
