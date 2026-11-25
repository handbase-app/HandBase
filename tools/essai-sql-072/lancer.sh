#!/bin/bash
# Essai de supabase/072_mcp_lecture_appels.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-072, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 071, une base fictive assez grosse
# (avant.sql : 6 500 joueurs nés en 2013, mesures, vus, avis, un administrateur, un encadrant du 83), empreintes de hb_upsert,
# hb_upsert_lignes, hb_stamp, hb_log, hb_touch et des tables de données, 072 deux fois (relançable), sa requête de contrôle
# (le top 10 par hb_mcp_lire et le calcul direct doivent être égaux), essais.sql (hb_mcp_lire contre un calcul direct écrit
# autrement, périmètre, filtres, bornes, refus, rien de personnel ; journal des appels), puis les empreintes à nouveau, puis
# le retour arrière. Données fictives seulement ; rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-072/lancer.sh
#   PG_IMAGE=postgres:17 bash tools/essai-sql-072/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-072}
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
  if [ $((10#$n)) -lt 72 ]; then apply "$(basename "$f")" < "$f"; fi
done
echo "--- avant 072 : base fictive ---"
apply avant.sql < "$D/avant.sql"
$P -tA -c "select 'joueurs ' || (select count(*) from public.hb_players) || ', nés en 2013 ' || (select count(*) from public.hb_players where data ->> 'birthDate' like '2013%') || ', mesures ' || (select count(*) from public.hb_measurements) || ', vus ' || (select count(*) from public.hb_seen) || ', avis ' || (select count(*) from public.hb_evaluations)" | sed 's/^/  /'
EMPREINTES="select md5(string_agg(p.proname || ':' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proconfig, ','), ''), '|' order by p.proname))
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('hb_upsert', 'hb_upsert_lignes', 'hb_stamp', 'hb_log', 'hb_touch')"
DONNEES="select md5(string_agg(t || ':' || id || ':' || md5(d::text) || ':' || s::text, '|' order by t, id)) from (
  select 'm' t, id, data d, server_updated_at s from public.hb_measurements union all select 'a', id, data, server_updated_at from public.hb_evaluations
  union all select 'v', id, data, server_updated_at from public.hb_seen union all select 'p', id, data, server_updated_at from public.hb_players
  union all select 'e', id, data, server_updated_at from public.hb_events) x"
STRUCTURE="select md5(string_agg(x, ',' order by x)) from (select table_name || '.' || column_name x from information_schema.columns
  where table_schema = 'public' and table_name in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events')
  union all select indexdef from pg_indexes where schemaname = 'public' and tablename in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events')
  union all select tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events')
  union all select policyname || qual from pg_policies where tablename in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events')) y"
E1=$($P -tA -c "$EMPREINTES"); D1=$($P -tA -c "$DONNEES"); K1=$($P -tA -c "$STRUCTURE")
apply 072 < "$REPO/supabase/072_mcp_lecture_appels.sql"
apply "072 (relancé)" < "$REPO/supabase/072_mcp_lecture_appels.sql"
CONTROLE="$(sed -n '/^-- ---------- Vérification/,/^-- ---------- RETOUR ARRIÈRE/p' "$REPO/supabase/072_mcp_lecture_appels.sql" | grep -v '^--')"
echo "contrôle de 072 (indicateurs, puis top 10 par hb_mcp_lire, puis calcul direct) :"
echo "$CONTROLE" | $P -F ' ' -tA | sed 's/^/  /'
T1=$(echo "$CONTROLE" | $P -F ' ' -tA | sed -n '2,11p' | md5sum); T2=$(echo "$CONTROLE" | $P -F ' ' -tA | sed -n '12,21p' | md5sum)
[ "$T1" = "$T2" ] && echo "ok : contrôle, top 10 de hb_mcp_lire = calcul direct" || { echo "ÉCHEC : top 10 du contrôle différent du calcul direct"; exit 1; }
echo "--- essais de 072 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
E2=$($P -tA -c "$EMPREINTES"); D2=$($P -tA -c "$DONNEES"); K2=$($P -tA -c "$STRUCTURE")
[ "$E1" = "$E2" ] && echo "ok : hb_upsert, hb_upsert_lignes, hb_stamp, hb_log, hb_touch inchangés ($E1)" || { echo "ÉCHEC : fonctions de synchronisation modifiées"; exit 1; }
[ "$D1" = "$D2" ] && echo "ok : aucune ligne de données réécrite ($D1)" || { echo "ÉCHEC : lignes de données modifiées"; exit 1; }
[ "$K1" = "$K2" ] && echo "ok : ni colonne, ni index, ni déclencheur, ni règle ajoutés aux tables de données" || { echo "ÉCHEC : structure des tables de données modifiée"; exit 1; }
echo "--- durée du top 10 (administrateur, règles de lecture) ---"
$P -tA -c "select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false); set role authenticated; explain (analyze, costs off, timing off, summary on) select public.hb_mcp_lire('{\"annees\":[2013],\"tri\":{\"par\":\"test\",\"test\":\"taille\",\"ordre\":\"desc\"},\"limite\":10}')" | grep -E 'Execution Time' | sed 's/^/  administrateur, top 10 2013 : /'
echo "--- retour arrière ---"
sed -n '/^-- ---------- RETOUR ARRIÈRE/,/^-- ---------- ACTIVATION/p' "$REPO/supabase/072_mcp_lecture_appels.sql" | grep '^-- drop' | sed 's/^-- //' | $P >/dev/null
echo "après retour arrière : fonctions $($P -tA -c "select count(*) from pg_proc where proname in ('hb_mcp_num','hb_mcp_lire','hb_mcp_appels_purger')"), table hb_mcp_appels $($P -tA -c "select to_regclass('public.hb_mcp_appels') is not null"), données $([ "$($P -tA -c "$DONNEES")" = "$D1" ] && echo inchangées || echo MODIFIÉES)"
