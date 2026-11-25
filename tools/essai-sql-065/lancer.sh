#!/bin/bash
# Essai de supabase/065_objectifs_etapes.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-065, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 064, 065 deux fois (relançable), sa
# requête de contrôle, puis essais.sql (le jeune n'écrit que pour sa fiche et ne touche jamais au texte du staff, coches des
# seules étapes de sa fiche, limites 12 / 5 en cours / 8 étapes, liens http(s), staff selon son périmètre, anon refusé, fusion
# et effacement de fiche). Données fictives seulement. Rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-065/lancer.sh
#   PG_IMAGE=postgres:15-alpine bash tools/essai-sql-065/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-065}
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
for f in "$REPO"/supabase/0[0-9][0-9]_*.sql; do case "$f" in *065_*) ;; *) apply "$(basename "$f")" < "$f";; esac; done
apply 065 < "$REPO/supabase/065_objectifs_etapes.sql"
apply "065 (relancé)" < "$REPO/supabase/065_objectifs_etapes.sql"
echo "contrôle de 065 (attendu : t 2 t f 2 0) : $($P -tA -F ' ' -c "$(sed -n '/^-- ---------- Vérification/,$p' "$REPO/supabase/065_objectifs_etapes.sql" | grep -v '^--')")"
echo "--- essais de 065 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
