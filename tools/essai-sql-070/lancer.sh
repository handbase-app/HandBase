#!/bin/bash
# Essai de supabase/070_propositions_admin.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-070, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 069, des propositions déjà là
# (avant.sql), 070 deux fois (relançable), sa requête de contrôle, puis essais.sql (lignes gardées, sorte « admin » réservée
# aux administrateurs, forme, bornes, garde de 067 inchangée pour les autres sortes), et enfin les essais de 067
# (../essai-sql-067/essais.sql) rejoués après 070 : la garde reprise garde toutes les règles de 067.
# Données fictives seulement. Rien n'est envoyé à une base distante. Le script n'est appliqué nulle part ailleurs.
#
#   bash tools/essai-sql-070/lancer.sh
#   PG_IMAGE=postgres:15-alpine bash tools/essai-sql-070/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-070}
IMG=${PG_IMAGE:-postgres:16}
trap 'docker rm -f $C >/dev/null 2>&1 || true; rm -f "$D/.erreur.txt"' EXIT
docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C -e POSTGRES_PASSWORD=essai -e POSTGRES_DB=hb "$IMG" -c jit=off >/dev/null
for i in $(seq 1 30); do docker exec $C pg_isready -U postgres -d hb >/dev/null 2>&1 && break; sleep 1; done
sleep 2
echo "Postgres : $(docker exec $C psql -U postgres -d hb -tA -c 'show server_version')"
P="docker exec -i $C psql -U postgres -d hb -v ON_ERROR_STOP=1 -q"
$P < "$REPO/tools/essai-sql-057/bouchons.sql" 2>/dev/null
apply() { sed -E 's/create extension if not exists (pg_cron|pg_net)[^;]*;/select 1;/I' | $P >/dev/null 2>"$D/.erreur.txt" || { echo "ÉCHEC $1"; cat "$D/.erreur.txt"; exit 1; }; }
apply schema.sql < "$REPO/supabase/schema.sql"
for f in "$REPO"/supabase/0[0-9][0-9]_*.sql; do
  n=$(basename "$f" | cut -c1-3)
  if [ $((10#$n)) -lt 70 ]; then apply "$(basename "$f")" < "$f"; fi
done
CONTROLE="$(sed -n '/^-- ---------- Vérification/,/^-- ---------- RETOUR ARRIÈRE/p' "$REPO/supabase/070_propositions_admin.sql" | grep -v '^--')"
echo "--- avant 070 : propositions déjà là ---"
$P < "$D/avant.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
apply 070 < "$REPO/supabase/070_propositions_admin.sql"
apply "070 (relancé)" < "$REPO/supabase/070_propositions_admin.sql"
echo "contrôle de 070 : $($P -tA -F ' ' -c "$CONTROLE")"
echo "--- essais de 070 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "--- essais de 067 rejoués après 070 ---"
$P < "$REPO/tools/essai-sql-067/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "contrôle de 070 à la fin : $($P -tA -F ' ' -c "$CONTROLE")"
