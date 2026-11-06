#!/bin/bash
# Essai de supabase/071_provenance.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-071, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 070, des lignes fictives de chaque
# provenance écrites AVANT 071 (avant.sql : saisie de l'appli signée par hb_stamp, collage, proposition validée, SQL sans
# compte, générateur déclencheurs coupés et createdAtServer antidaté), empreintes de hb_upsert, hb_upsert_lignes, hb_stamp,
# hb_log et des tables de données, 071 deux fois (relançable), sa requête de contrôle, essais.sql (provenance, lots,
# agrégats, refus 42501 pour tout compte qui n'est pas administrateur, droits de hb_lots), puis les empreintes à nouveau :
# 071 ne touche ni la synchronisation ni une seule ligne de données.
# Données fictives seulement. Rien n'est envoyé à une base distante. Le script n'est appliqué nulle part ailleurs.
#
#   bash tools/essai-sql-071/lancer.sh
#   PG_IMAGE=postgres:17 bash tools/essai-sql-071/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-071}
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
  if [ $((10#$n)) -lt 71 ]; then apply "$(basename "$f")" < "$f"; fi
done
echo "--- avant 071 : lignes fictives de chaque provenance ---"
$P < "$D/avant.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
EMPREINTES="select md5(string_agg(p.proname || ':' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proconfig, ','), ''), '|' order by p.proname))
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('hb_upsert', 'hb_upsert_lignes', 'hb_stamp', 'hb_log', 'hb_touch')"
DONNEES="select md5(string_agg(t || ':' || id || ':' || md5(d::text) || ':' || s::text, '|' order by t, id)) from (
  select 'm' t, id, data d, server_updated_at s from public.hb_measurements union all select 'a', id, data, server_updated_at from public.hb_evaluations
  union all select 'v', id, data, server_updated_at from public.hb_seen union all select 'p', id, data, server_updated_at from public.hb_players
  union all select 'e', id, data, server_updated_at from public.hb_events) x"
COLONNES="select md5(string_agg(table_name || '.' || column_name, ',' order by table_name, column_name)) from information_schema.columns
  where table_schema = 'public' and table_name in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events')"
E1=$($P -tA -c "$EMPREINTES"); D1=$($P -tA -c "$DONNEES"); K1=$($P -tA -c "$COLONNES")
apply 071 < "$REPO/supabase/071_provenance.sql"
apply "071 (relancé)" < "$REPO/supabase/071_provenance.sql"
CONTROLE="$(sed -n '/^-- ---------- Vérification/,/^-- ---------- RETOUR ARRIÈRE/p' "$REPO/supabase/071_provenance.sql" | grep -v '^--')"
echo "contrôle de 071 :"
echo "$CONTROLE" | $P -F ' ' -tA | sed 's/^/  /'
echo "--- essais de 071 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
E2=$($P -tA -c "$EMPREINTES"); D2=$($P -tA -c "$DONNEES"); K2=$($P -tA -c "$COLONNES")
[ "$E1" = "$E2" ] && echo "ok : hb_upsert, hb_upsert_lignes, hb_stamp, hb_log, hb_touch inchangés ($E1)" || { echo "ÉCHEC : fonctions de synchronisation modifiées"; exit 1; }
[ "$D1" = "$D2" ] && echo "ok : aucune ligne de données réécrite ($D1)" || { echo "ÉCHEC : lignes de données modifiées"; exit 1; }
[ "$K1" = "$K2" ] && echo "ok : aucune colonne ajoutée aux tables de données" || { echo "ÉCHEC : colonnes des tables de données modifiées"; exit 1; }
echo "--- rencontres fictives (tools/seed-rencontres.ts) après 071 : data.source / lotId, lot remis à jour ---"
SEED=$(mktemp --suffix=.sql)
( cd "$REPO" && npx jiti tools/seed-rencontres.ts "$SEED" --semaines 1 >/dev/null )
$P -c "insert into public.hb_units (id, data) values ('u-club-1', '{\"id\":\"u-club-1\",\"name\":\"Club Fictif Un\",\"clubNumber\":\"6383001\",\"city\":\"Toulon\",\"lat\":43.12,\"lng\":5.93}'), ('u-club-2', '{\"id\":\"u-club-2\",\"name\":\"Club Fictif Deux\",\"clubNumber\":\"6383002\",\"city\":\"Hyères\",\"lat\":43.12,\"lng\":6.13}')" >/dev/null
$P -c "select set_config('test.uid', '', false); insert into public.hb_players (id, data) select 'ess-club-' || i, jsonb_build_object('id', 'ess-club-' || i, 'firstName', 'Essai', 'lastName', 'Club' || i, 'sex', 'M', 'birthDate', '2011-05-05', 'clubCode', case when i % 2 = 0 then '6383001' else '6383002' end) from generate_series(1, 20) i" >/dev/null
apply seed-rencontres < "$SEED"
apply "seed-rencontres (relancé)" < "$SEED"
rm -f "$SEED"
echo "  rencontres $($P -tA -c "select count(*) || ' (marquées generation / demo-rencontres : ' || count(*) filter (where data ->> 'source' = 'generation' and data ->> 'lotId' = 'demo-rencontres') || ')' from public.hb_rencontres where source = 'demo'") ; lot : $($P -tA -c "select coalesce((select id || ' ' || nb_lignes::text from public.hb_lots where id = 'demo-rencontres'), 'aucun (aucune rencontre)')")"
D1=$($P -tA -c "$DONNEES")
echo "--- retour arrière ---"
sed -n '/^-- ---------- RETOUR ARRIÈRE/,$p' "$REPO/supabase/071_provenance.sql" | grep '^-- drop' | sed 's/^-- //' | $P >/dev/null
echo "après retour arrière : fonctions $($P -tA -c "select count(*) from pg_proc where proname in ('hb_provenance','hb_lot_de','hb_cree_le','hb_admin_creations','hb_admin_saisies')"), table hb_lots $($P -tA -c "select to_regclass('public.hb_lots') is not null"), données $([ "$($P -tA -c "$DONNEES")" = "$D1" ] && echo inchangées || echo MODIFIÉES)"
