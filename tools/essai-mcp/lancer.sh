#!/bin/bash
# Essai de BOUT EN BOUT du serveur MCP Nextar, sans projet Supabase : la pile réelle de la fonction (supabase/functions/mcp/
# serveur.ts) tourne dans le runtime des fonctions Supabase (image Docker public.ecr.aws/supabase/edge-runtime), avec le jeu
# fictif (tools/mcp-jeu-fictif.ts) à la place de la base, des clés ES256 jetables et des jetons fictifs (jeton.mjs) ; puis
# appels.ts fait les appels HTTP de Claude (découverte OAuth, 401, CORS, initialize, tools/list, les onze outils ;
# nextar_connexions et les cinq nextar_admin_* avec le jeton du coach, refusés, puis avec celui d'un administrateur fictif).
# Le runtime télécharge les paquets npm du serveur (SDK MCP, @supabase/server, zod) au premier lancement.
#
#   bash tools/essai-mcp/lancer.sh
#   EDGE_IMAGE=public.ecr.aws/supabase/edge-runtime:v1.77.4 PORT=9707 bash tools/essai-mcp/lancer.sh
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hb-essai-mcp}
IMG=${EDGE_IMAGE:-public.ecr.aws/supabase/edge-runtime:v1.77.4}
PORT=${PORT:-9707}
TMP=$(mktemp -d)
trap 'docker rm -f $C >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT
node "$D/jeton.mjs" "$TMP"
docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C --env-file "$TMP/env" -p 127.0.0.1:$PORT:9000 -v "$REPO:/repo:ro" "$IMG" start --main-service /repo/tools/essai-mcp/main >/dev/null
# Attendre que le serveur réponde (premier lancement : téléchargement des paquets).
for i in $(seq 1 90); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/functions/v1/mcp/oauth-protected-resource"; then break; fi
  sleep 1
done
MCP_URL="http://127.0.0.1:$PORT/functions/v1/mcp" JETONS="$TMP/jetons.json" npx jiti "$D/appels.ts" || { echo "--- journal du runtime ---"; docker logs $C 2>&1 | tail -40; exit 1; }
