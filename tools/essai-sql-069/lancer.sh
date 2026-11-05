#!/bin/bash
# Essai de supabase/069_admin_sante.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-069, supprimé à la fin) : bouchons
# des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 068, 069 deux fois (relançable), sa requête de
# contrôle, puis essais.sql (réservé aux administrateurs, forme de la réponse, rien de personnel, tables facultatives
# absentes). Données fictives seulement. Rien n'est envoyé à une base distante. Le script n'est appliqué nulle part ailleurs.
#
#   bash tools/essai-sql-069/lancer.sh
#   PG_IMAGE=postgres:15-alpine bash tools/essai-sql-069/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-069}
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
  if [ $((10#$n)) -lt 69 ]; then apply "$(basename "$f")" < "$f"; fi
done
apply 069 < "$REPO/supabase/069_admin_sante.sql"
apply "069 (relancé)" < "$REPO/supabase/069_admin_sante.sql"
CONTROLE="$(sed -n '/^-- ---------- Vérification/,/^-- ---------- RETOUR ARRIÈRE/p' "$REPO/supabase/069_admin_sante.sql" | grep -v '^--')"
echo "contrôle de 069 : $($P -tA -F ' ' -c "$CONTROLE")"
echo "--- essais de 069 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
