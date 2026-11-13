#!/bin/bash
# Essai de supabase/063_affichage.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-063, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 062, 063 deux fois (relançable), sa
# requête de contrôle, puis essais.sql (forme refusée, sa ligne seulement, anon refusé). Données fictives
# seulement. Rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-063/lancer.sh
#   PG_IMAGE=postgres:15-alpine bash tools/essai-sql-063/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-063}
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
for f in "$REPO"/supabase/0[0-9][0-9]_*.sql; do case "$f" in *063_*) ;; *) apply "$(basename "$f")" < "$f";; esac; done
apply 063 < "$REPO/supabase/063_affichage.sql"
apply "063 (relancé)" < "$REPO/supabase/063_affichage.sql"
echo "contrôle de 063 : $($P -tA -F ' ' -c "$(sed -n '/^-- ---------- Vérification/,$p' "$REPO/supabase/063_affichage.sql" | grep -v '^--')")"
echo "--- essais de 063 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
