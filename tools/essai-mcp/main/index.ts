// Essai de bout en bout du serveur MCP Nextar (tools/essai-mcp/lancer.sh) : la VRAIE pile de la fonction (serveur.ts : CORS,
// découverte OAuth, vérification du jeton par @supabase/server, SDK MCP sans état) dans le runtime des fonctions Supabase
// (image edge-runtime), avec le jeu FICTIF à la place des requêtes à la base. Aucune base, aucun projet Supabase réel.
import { fabriquer } from '../../../supabase/functions/mcp/serveur.ts'
import { sourceFictive } from '../../mcp-jeu-fictif.ts'

const src = sourceFictive()

Deno.serve(
  fabriquer({
    sourceDe: () => src,
    reglages: () => ({ appUrl: 'https://exemple.test/HandBase', today: '2026-11-05' }),
  }),
)
