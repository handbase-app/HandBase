// Essai de bout en bout du serveur MCP Nextar (tools/essai-mcp/lancer.sh) : la VRAIE pile de la fonction (serveur.ts : CORS,
// découverte OAuth, vérification du jeton par @supabase/server, SDK MCP sans état) dans le runtime des fonctions Supabase
// (image edge-runtime), avec le jeu FICTIF à la place des requêtes à la base. Aucune base, aucun projet Supabase réel.
import { fabriquer } from '../../../supabase/functions/mcp/serveur.ts'
import { MAINTENANT_FICTIF, sourceFictive } from '../../mcp-jeu-fictif.ts'

const src = sourceFictive()
// Le jeton de l'administrateur fictif (jeton.mjs) reçoit une Source où hb_is_admin répond oui (nextar_connexions) ; tout
// autre jeton : celle du coach (refus). L'identifiant vient des « claims » vérifiés par withSupabase.
const srcAdmin = sourceFictive({ admin: true })
const ADMIN = '00000000-0000-4000-8000-0000000000a1'
// deno-lint-ignore no-explicit-any
const compteDe = (ctx: any): string | undefined => ctx?.userClaims?.id ?? ctx?.userClaims?.sub ?? ctx?.claims?.sub

Deno.serve(
  fabriquer({
    sourceDe: (ctx) => (compteDe(ctx) === ADMIN ? srcAdmin : src),
    reglages: () => ({ appUrl: 'https://exemple.test/HandBase', today: '2026-11-05', maintenant: MAINTENANT_FICTIF }),
  }),
)
