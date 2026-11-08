#!/bin/bash
# Essai de supabase/073_wellness.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-073, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 072, empreinte de hb_upsert,
# hb_upsert_lignes, hb_stamp, hb_log, hb_touch et de la structure des tables synchronisées, 073 deux fois (relançable), sa
# requête de contrôle, essais.sql (réglage d'installation fermé / ouvert, qui est concerné, le jeune n'écrit que le sien,
# douleurs : une ligne par endroit, 1 à 8, toutes valables ; durée de séance obligatoire,
# séances, lecture par le staff du groupe seulement, groupe Pôle, hb_upsert garde la clé « wellness », fusion, effacement,
# purge), puis les empreintes à nouveau, puis le retour arrière. Données fictives seulement ; rien n'est envoyé à une base
# distante.
#
#   bash tools/essai-sql-073/lancer.sh
#   PG_IMAGE=postgres:17 bash tools/essai-sql-073/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-073}
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
  if [ $((10#$n)) -lt 73 ]; then apply "$(basename "$f")" < "$f"; fi
done
EMPREINTES="select md5(string_agg(p.proname || ':' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proconfig, ','), ''), '|' order by p.proname))
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('hb_upsert', 'hb_upsert_lignes', 'hb_stamp', 'hb_log', 'hb_touch')"
UPSERT="select md5(prosrc) from pg_proc where proname = 'hb_upsert' and pronamespace = 'public'::regnamespace"
STRUCTURE="select md5(string_agg(x, ',' order by x)) from (select table_name || '.' || column_name x from information_schema.columns
  where table_schema = 'public' and table_name in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events', 'hb_groups', 'hb_config')
  union all select indexdef from pg_indexes where schemaname = 'public' and tablename in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events', 'hb_groups', 'hb_config')
  union all select policyname || qual from pg_policies where tablename in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events', 'hb_groups', 'hb_config')) y"
E1=$($P -tA -c "$EMPREINTES"); U1=$($P -tA -c "$UPSERT"); K1=$($P -tA -c "$STRUCTURE")
apply 073 < "$REPO/supabase/073_wellness.sql"
apply "073 (relancé)" < "$REPO/supabase/073_wellness.sql"
CONTROLE="$(sed -n '/^-- ---------- Vérification/,/^-- ---------- RETOUR ARRIÈRE/p' "$REPO/supabase/073_wellness.sql" | grep -v '^--')"
echo "contrôle de 073 (tables, règles, appli, anon, purge ouverte, déclencheurs, ouvert, lignes) : $(echo "$CONTROLE" | $P -F ' ' -tA)"
echo "--- essais de 073 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
E2=$($P -tA -c "$EMPREINTES"); U2=$($P -tA -c "$UPSERT"); K2=$($P -tA -c "$STRUCTURE")
[ "$U1" = "$U2" ] && echo "ok : md5 de hb_upsert inchangé ($U1)" || { echo "ÉCHEC : hb_upsert modifié"; exit 1; }
[ "$E1" = "$E2" ] && echo "ok : hb_upsert, hb_upsert_lignes, hb_stamp, hb_log, hb_touch inchangés ($E1)" || { echo "ÉCHEC : fonctions de synchronisation modifiées"; exit 1; }
[ "$K1" = "$K2" ] && echo "ok : ni colonne, ni index, ni règle ajoutés aux tables synchronisées" || { echo "ÉCHEC : structure des tables synchronisées modifiée"; exit 1; }
echo "--- retour arrière ---"
sed -n '/^-- ---------- RETOUR ARRIÈRE/,/^-- ---------- ACTIVATION/p' "$REPO/supabase/073_wellness.sql" | grep '^-- drop' | sed 's/^-- //' | $P >/dev/null
echo "après retour arrière : fonctions $($P -tA -c "select count(*) from pg_proc where proname like 'hb\_wl\_%' or proname like 'hb\_wellness%'"), tables $($P -tA -c "select count(*) from pg_class where relname in ('hb_wellness', 'hb_wellness_seances')"), déclencheur $($P -tA -c "select count(*) from pg_trigger where tgname = 'hb_wellness_forget'")"
