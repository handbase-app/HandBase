#!/bin/bash
# Essai de supabase/074_lampe.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-074, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 073, empreintes de hb_upsert,
# hb_upsert_lignes, hb_stamp, hb_log, hb_touch et de la structure des tables synchronisées, 074 deux fois (relançable), sa
# requête de contrôle, essais.sql (lampe fermée / ouverte, cahier du hand et cahier de match : SA fiche, jours permis, champs
# nettoyés, une note par jour, privée tant qu'elle n'est pas partagée, retirée avec ses champs ; masques par jour ; tableau
# du staff du groupe seulement ; points des encadrants qui ne baissent pas ; vœux du catalogue ; limite des 200 notes qui
# n'efface jamais un cahier ; fusion, effacement), le SQL de la lampe écrit par tools/seed-activite-poles.ts sur un petit jeu
# fictif (jeu-fictif.ts : deux fois, vraies lignes gardées, retour), puis les empreintes à nouveau, puis le retour arrière. Données fictives
# seulement ; rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-074/lancer.sh
#   PG_IMAGE=postgres:17 bash tools/essai-sql-074/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-074}
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
  if [ $((10#$n)) -lt 74 ]; then apply "$(basename "$f")" < "$f"; fi
done
EMPREINTES="select md5(string_agg(p.proname || ':' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proconfig, ','), ''), '|' order by p.proname))
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('hb_upsert', 'hb_upsert_lignes', 'hb_stamp', 'hb_log', 'hb_touch')"
UPSERT="select md5(prosrc) from pg_proc where proname = 'hb_upsert' and pronamespace = 'public'::regnamespace"
STRUCTURE="select md5(string_agg(x, ',' order by x)) from (select table_name || '.' || column_name x from information_schema.columns
  where table_schema = 'public' and table_name in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events', 'hb_groups', 'hb_config')
  union all select indexdef from pg_indexes where schemaname = 'public' and tablename in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events', 'hb_groups', 'hb_config')
  union all select policyname || qual from pg_policies where tablename in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events', 'hb_groups', 'hb_config')) y"
# Fonctions de 052 reprises par 074 (leur empreinte d'avant, pour vérifier le retour arrière).
JOURNAL="select md5(string_agg(proname || ':' || md5(prosrc), '|' order by proname)) from pg_proc
  where pronamespace = 'public'::regnamespace and proname in ('hb_journal_note', 'hb_player_journal_add', 'hb_player_journal_edit')"
E1=$($P -tA -c "$EMPREINTES"); U1=$($P -tA -c "$UPSERT"); K1=$($P -tA -c "$STRUCTURE"); J1=$($P -tA -c "$JOURNAL")
apply 074 < "$REPO/supabase/074_lampe.sql"
apply "074 (relancé)" < "$REPO/supabase/074_lampe.sql"
CONTROLE="$(sed -n '/^-- ---------- Vérification/,/^-- ---------- RETOUR ARRIÈRE/p' "$REPO/supabase/074_lampe.sql" | grep -v '^--')"
echo "contrôle de 074 (table, règles, colonnes, appli, anon, déclencheurs, ouverte, lignes, cahiers) : $(echo "$CONTROLE" | $P -F ' ' -tA)"
echo "--- essais de 074 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "--- SQL de la lampe écrit par tools/seed-activite-poles.ts (jeu fictif, passé deux fois) ---"
(cd "$REPO" && npx jiti tools/essai-sql-074/jeu-fictif.ts) | $P -tA 2>&1 | grep -E 'cahier|lampe|gardées|ERROR|retour' | sed 's/^/  /'
E2=$($P -tA -c "$EMPREINTES"); U2=$($P -tA -c "$UPSERT"); K2=$($P -tA -c "$STRUCTURE")
[ "$U1" = "$U2" ] && echo "ok : md5 de hb_upsert inchangé ($U1)" || { echo "ÉCHEC : hb_upsert modifié"; exit 1; }
[ "$E1" = "$E2" ] && echo "ok : hb_upsert, hb_upsert_lignes, hb_stamp, hb_log, hb_touch inchangés ($E1)" || { echo "ÉCHEC : fonctions de synchronisation modifiées"; exit 1; }
[ "$K1" = "$K2" ] && echo "ok : ni colonne, ni index, ni règle ajoutés aux tables synchronisées" || { echo "ÉCHEC : structure des tables synchronisées modifiée"; exit 1; }
echo "--- retour arrière ---"
sed -n '/^-- ---------- RETOUR ARRIÈRE/,/^-- ---------- ACTIVATION/p' "$REPO/supabase/074_lampe.sql" | grep -E '^-- (drop|alter|update)' | sed 's/^-- //' | $P >/dev/null
# … puis les trois fonctions de 052, relancées depuis 052 (section 2 : de hb_journal_note à hb_player_journal_edit compris).
awk '/^-- Une note telle que l.appli la reçoit/{on=1} on{print} /^-- Partage une note avec son encadrant/{exit}' "$REPO/supabase/052_journal_joueur.sql" | grep -v '^-- Partage' | $P >/dev/null
J2=$($P -tA -c "$JOURNAL")
[ "$J1" = "$J2" ] && echo "ok : hb_journal_note, hb_player_journal_add, hb_player_journal_edit revenues à 052" || { echo "ÉCHEC : fonctions du journal pas revenues à 052"; exit 1; }
echo "après retour arrière : fonctions $($P -tA -c "select count(*) from pg_proc where proname like 'hb\_lp\_%' or proname like 'hb\_lampe%' or proname = 'hb_cahier_enregistrer'"), table $($P -tA -c "select count(*) from pg_class where relname = 'hb_lampe'"), colonnes $($P -tA -c "select count(*) from information_schema.columns where table_name = 'hb_player_journal' and column_name in ('kind', 'jour', 'parts')"), déclencheurs $($P -tA -c "select count(*) from pg_trigger where tgname in ('hb_lampe_forget', 'hb_lp_efface')"), notes $($P -tA -c "select count(*) from public.hb_player_journal where not deleted")"
