#!/bin/bash
# Essai de supabase/058_lecture_perimetre.sql sur un Postgres 16 JETABLE (Docker, conteneur hbpg-essai-058, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 057, 058 deux fois (relançable), la
# requête de contrôle de 058, puis essais.sql : 8 comptes, lecture par périmètre identique ligne pour ligne à la lecture
# directe sous RLS, parcours complet avec le protocole de l'appli, contre-essai (fuite et oubli attrapés), garde-fous.
# Données fictives seulement. Rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-058/lancer.sh            essais de sécurité (≈ 1 min)
#   bash tools/essai-sql-058/lancer.sh --mesure   puis la mesure à 500 000 joueurs (mesure-jeu.sql, mesure-lectures.sql ; ≈ 15 min, ~4 Go de disque Docker)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=hbpg-essai-058
trap 'docker rm -f $C >/dev/null 2>&1 || true' EXIT
docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C --shm-size=1g -e POSTGRES_PASSWORD=essai -e POSTGRES_DB=hb postgres:16 \
  -c shared_buffers=1GB -c work_mem=16MB -c maintenance_work_mem=512MB -c max_wal_size=8GB -c jit=off >/dev/null
for i in $(seq 1 30); do docker exec $C pg_isready -U postgres -d hb >/dev/null 2>&1 && break; sleep 1; done
sleep 2
P="docker exec -i $C psql -U postgres -d hb -v ON_ERROR_STOP=1 -q"
$P < "$REPO/tools/essai-sql-057/bouchons.sql" 2>/dev/null
apply() { sed -E 's/create extension if not exists (pg_cron|pg_net)[^;]*;/select 1;/I' | $P >/dev/null 2>"$D/.erreur.txt" || { echo "ÉCHEC $1"; cat "$D/.erreur.txt"; exit 1; }; }
apply schema.sql < "$REPO/supabase/schema.sql"
for f in "$REPO"/supabase/0[0-9][0-9]_*.sql; do case "$f" in *058_*) ;; *) apply "$(basename "$f")" < "$f";; esac; done
if [ "$1" = "--mesure" ]; then
  # Même base, même jeu : lectures d'une page AVANT 058, puis 058 (colonne, index : temps affiché), puis APRÈS.
  echo "--- jeu fictif (500 000 joueurs, 3 M de mesures, 600 000 avis, 1 M de « vu ») ---"
  $P < "$D/mesure-jeu.sql" 2>&1 | grep -vE '^(SET|INSERT|UPDATE|VACUUM|CREATE|ANALYZE|SELECT)'
  echo "--- AVANT 058 ---"
  $P < "$D/mesure-lectures.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
  t0=$(date +%s)
  apply 058 < "$REPO/supabase/058_lecture_perimetre.sql"
  echo "--- 058 passé en $(( $(date +%s) - t0 )) s (colonne générée sur 4 tables, 12 index) ---"
  echo "--- APRÈS 058 ---"
  $P < "$D/mesure-lectures.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
  rm -f "$D/.erreur.txt"
  exit 0
fi
apply 058 < "$REPO/supabase/058_lecture_perimetre.sql"
apply "058 (relancé)" < "$REPO/supabase/058_lecture_perimetre.sql"
echo "contrôle de 058 : $($P -tA -F ' ' -c "$(sed -n '/^-- ---------- Vérification/,/^-- Ce que lit/p' "$REPO/supabase/058_lecture_perimetre.sql" | grep -v '^--')")"
echo "règles de lecture des 4 tables : $($P -tA -F ' ' -c "select string_agg(tablename || '.' || policyname || '(' || cmd || ')', ', ' order by 1, 2) from pg_policies where tablename in ('hb_players', 'hb_measurements', 'hb_evaluations', 'hb_seen')")"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
rm -f "$D/.erreur.txt"
