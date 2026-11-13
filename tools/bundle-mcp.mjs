// Fonction « mcp » en UN fichier pour la mise en ligne par le connecteur Supabase (deploy_edge_function), quand ses
// fichiers sont trop gros pour un seul envoi : rolldown rassemble supabase/functions/mcp/index.ts et tout ce qu'il importe
// en local (serveur, outils, source, admin, partage/), minifié ; les paquets npm: et jsr: restent importés par le runtime.
//   node tools/bundle-mcp.mjs <sortie.js> [entrée.ts]
// Essai de bout en bout du fichier obtenu : même parcours que tools/essai-mcp/lancer.sh avec tools/essai-mcp/main/index.ts
// rassemblé de la même façon.
import { build } from 'rolldown'

const [out, input = 'supabase/functions/mcp/index.ts'] = process.argv.slice(2)
if (!out) throw new Error('usage : node tools/bundle-mcp.mjs <sortie.js> [entrée.ts]')
await build({
  input,
  external: [/^npm:/, /^jsr:/],
  platform: 'neutral',
  output: { file: out, format: 'esm', minify: true },
})
