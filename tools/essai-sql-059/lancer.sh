#!/bin/bash
# Essai de supabase/059_filet_econome.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-059, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 058, 059 deux fois (relançable), la
# requête de contrôle de 059 ; le jeu et les essais de 058 (8 comptes) ; puis essais.sql : empreinte de hb_filet identique à
# celle des lignes lues directement sous les règles de lecture (8 comptes, 10 clés, 7 curseurs), « neuf » identique à
# hb_quoi_de_neuf, plafond, ligne validée en retard, contenu changé, garde-fous ; enfin miroir.ts : l'appareil (src/filet.ts)
# recalcule, octet pour octet, les empreintes du serveur. Données fictives seulement. Rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-059/lancer.sh            essais (≈ 2 min)
#   bash tools/essai-sql-059/lancer.sh --mesure   puis la mesure sur le jeu de 058 (500 000 joueurs) + une matinée de détection
#                                                 (mesure.sql ; ≈ 15 min, ~4 Go de disque Docker)
#   PG_IMAGE=postgres:15-alpine bash tools/essai-sql-059/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=hbpg-essai-059
IMG=${PG_IMAGE:-postgres:16}
trap 'docker rm -f $C >/dev/null 2>&1 || true' EXIT
docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C --shm-size=1g -e POSTGRES_PASSWORD=essai -e POSTGRES_DB=hb "$IMG" \
  -c shared_buffers=1GB -c work_mem=16MB -c maintenance_work_mem=512MB -c max_wal_size=8GB -c jit=off >/dev/null
for i in $(seq 1 30); do docker exec $C pg_isready -U postgres -d hb >/dev/null 2>&1 && break; sleep 1; done
sleep 2
echo "Postgres : $(docker exec $C psql -U postgres -d hb -tA -c 'show server_version')"
P="docker exec -i $C psql -U postgres -d hb -v ON_ERROR_STOP=1 -q"
$P < "$REPO/tools/essai-sql-057/bouchons.sql" 2>/dev/null
apply() { sed -E 's/create extension if not exists (pg_cron|pg_net)[^;]*;/select 1;/I' | $P >/dev/null 2>"$D/.erreur.txt" || { echo "ÉCHEC $1"; cat "$D/.erreur.txt"; exit 1; }; }
apply schema.sql < "$REPO/supabase/schema.sql"
for f in "$REPO"/supabase/0[0-9][0-9]_*.sql; do case "$f" in *059_*) ;; *) apply "$(basename "$f")" < "$f";; esac; done
apply 059 < "$REPO/supabase/059_filet_econome.sql"
apply "059 (relancé)" < "$REPO/supabase/059_filet_econome.sql"
echo "contrôle de 059 : $($P -tA -F ' ' -c "$(sed -n '/^-- ---------- Vérification/,/^-- Ce que voit/p' "$REPO/supabase/059_filet_econome.sql" | grep -v '^--')")"
if [ "$1" = "--mesure" ]; then
  echo "--- jeu fictif de 058 (500 000 joueurs, 3 M de mesures, 600 000 avis, 1 M de « vu ») ---"
  $P < "$REPO/tools/essai-sql-058/mesure-jeu.sql" 2>&1 | grep -vE '^(SET|INSERT|UPDATE|VACUUM|CREATE|ANALYZE|SELECT|Temps|Time)'
  echo "--- mesure ---"
  $P < "$D/mesure.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /' | grep -vE '^(SET|INSERT|ANALYZE|CREATE|DO)$'
  rm -f "$D/.erreur.txt"
  exit 0
fi
echo "--- jeu et essais de 058 ---"
if ! $P < "$REPO/tools/essai-sql-058/essais.sql" > "$D/.erreur.txt" 2>&1; then echo "ÉCHEC essais de 058"; grep -E 'ERROR|CONTEXT' "$D/.erreur.txt"; exit 1; fi
echo "  ok"
echo "--- essais de 059 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "--- miroir : l'appareil recalcule les empreintes du serveur ---"
$P -tA < "$D/miroir.sql" > "$D/.miroir.json"
(cd "$REPO" && npx jiti tools/essai-sql-059/miroir.ts "$D/.miroir.json")
rm -f "$D/.erreur.txt" "$D/.miroir.json"
