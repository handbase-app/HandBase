#!/bin/bash
# Essai de supabase/076_humeurs_multiples.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-076, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 075, comptes / fiches / notes d'avant
# (avant.sql) et le SQL du journal de tools/seed-activite-poles.ts (jeu-fictif.ts : avant 076, colonne moods absente),
# empreintes de hb_upsert, hb_upsert_lignes, hb_stamp, hb_log, hb_touch et des tables synchronisées, 076 deux fois
# (relançable), sa requête de contrôle, essais.sql (reprise, ajout avec 1, 2, 3 humeurs, au-delà de 3, valeur inconnue,
# ancien appel p_mood seul, correction, note retirée, écritures directes, contrainte, droits, tendance), le SQL du journal à
# nouveau (après 076 : 2 ou 3 humeurs, deux fois), 076 une troisième fois (données inchangées), les empreintes à nouveau,
# puis le retour arrière. Données fictives seulement ; rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-076/lancer.sh
#   PG_IMAGE=postgres:17 bash tools/essai-sql-076/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-076}
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
  if [ $((10#$n)) -lt 76 ]; then apply "$(basename "$f")" < "$f"; fi
done
apply avant.sql < "$D/avant.sql"
JEU=$(cd "$REPO" && npx jiti tools/essai-sql-076/jeu-fictif.ts)
echo "--- SQL du journal de tools/seed-activite-poles.ts, AVANT 076 ---"
echo "$JEU" | $P -tA 2>&1 | grep -E 'graines|ERROR' | sed 's/^/  /'
EMPREINTES="select md5(string_agg(p.proname || ':' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proconfig, ','), ''), '|' order by p.proname))
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('hb_upsert', 'hb_upsert_lignes', 'hb_stamp', 'hb_log', 'hb_touch')"
UPSERT="select md5(prosrc) from pg_proc where proname = 'hb_upsert' and pronamespace = 'public'::regnamespace"
STRUCTURE="select md5(string_agg(x, ',' order by x)) from (select table_name || '.' || column_name x from information_schema.columns
  where table_schema = 'public' and table_name in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events', 'hb_groups', 'hb_config')
  union all select indexdef from pg_indexes where schemaname = 'public' and tablename in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events', 'hb_groups', 'hb_config')
  union all select policyname || qual from pg_policies where tablename in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events', 'hb_groups', 'hb_config')) y"
# Fonctions du journal reprises par 076 (leur empreinte d'avant, pour vérifier le retour arrière).
JOURNAL="select md5(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(array_to_string(p.proacl::text[], ','), ''), '|' order by p.proname)) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('hb_journal_note', 'hb_player_journal_add', 'hb_player_journal_edit', 'hb_player_mood_trend')"
E1=$($P -tA -c "$EMPREINTES"); U1=$($P -tA -c "$UPSERT"); K1=$($P -tA -c "$STRUCTURE"); J1=$($P -tA -c "$JOURNAL")
apply 076 < "$REPO/supabase/076_humeurs_multiples.sql"
apply "076 (relancé)" < "$REPO/supabase/076_humeurs_multiples.sql"
CONTROLE="$(sed -n '/^-- ---------- Vérification/,/^-- ---------- RETOUR ARRIÈRE/p' "$REPO/supabase/076_humeurs_multiples.sql" | grep -v '^--')"
echo "contrôle de 076 (colonne, add, edit, appli, anon, déclencheur, avec humeur, plusieurs, désaccords) : $(echo "$CONTROLE" | $P -F ' ' -tA)"
echo "--- essais de 076 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "--- SQL du journal de tools/seed-activite-poles.ts, APRÈS 076 (deux fois) ---"
echo "$JEU" | $P -tA 2>&1 | grep -E 'graines|ERROR' | sed 's/^/  /'
echo "$JEU" | $P -tA 2>&1 | grep -E 'graines|ERROR' | sed 's/^/  /'
AVANT3=$($P -tA -c "select md5(string_agg(id || moods::text || coalesce(mood, '') || updated_at::text, ',' order by id)) from public.hb_player_journal")
apply "076 (troisième fois)" < "$REPO/supabase/076_humeurs_multiples.sql"
APRES3=$($P -tA -c "select md5(string_agg(id || moods::text || coalesce(mood, '') || updated_at::text, ',' order by id)) from public.hb_player_journal")
[ "$AVANT3" = "$APRES3" ] && echo "ok : 076 relancé, notes inchangées (humeurs et updated_at)" || { echo "ÉCHEC : 076 relancé a changé des notes"; exit 1; }
echo "contrôle de 076 relancé : $(echo "$CONTROLE" | $P -F ' ' -tA)"
E2=$($P -tA -c "$EMPREINTES"); U2=$($P -tA -c "$UPSERT"); K2=$($P -tA -c "$STRUCTURE")
[ "$U1" = "$U2" ] && echo "ok : md5 de hb_upsert inchangé ($U2 ; 076 ne le nomme même pas)" || { echo "ÉCHEC : hb_upsert modifié ($U1 → $U2)"; exit 1; }
[ "$E1" = "$E2" ] && echo "ok : hb_upsert, hb_upsert_lignes, hb_stamp, hb_log, hb_touch inchangés ($E1)" || { echo "ÉCHEC : fonctions de synchronisation modifiées"; exit 1; }
[ "$K1" = "$K2" ] && echo "ok : ni colonne, ni index, ni règle ajoutés aux tables synchronisées" || { echo "ÉCHEC : structure des tables synchronisées modifiée"; exit 1; }
echo "--- retour arrière ---"
sed -n '/^-- ---------- RETOUR ARRIÈRE/,$p' "$REPO/supabase/076_humeurs_multiples.sql" | grep -E '^-- (drop|alter)' | sed 's/^-- //' | $P >/dev/null
# … puis, depuis 074, hb_journal_note, hb_player_journal_add et hb_player_journal_edit (section 2) ; depuis 052,
# hb_player_mood_trend (section 3) et les droits des deux fonctions.
awk '/^-- Une note telle que l.appli la reçoit \(052/{on=1} /^-- Écrire le cahier d.un jour/{exit} on{print}' "$REPO/supabase/074_lampe.sql" | $P >/dev/null
awk '/^-- 8 dernières semaines/{on=1} /^-- ---------- 4\./{exit} on{print}' "$REPO/supabase/052_journal_joueur.sql" | $P >/dev/null
$P >/dev/null <<'SQL'
revoke all on function public.hb_player_journal_add(text, text) from public, anon;
revoke all on function public.hb_player_journal_edit(text, text, text) from public, anon;
grant execute on function public.hb_player_journal_add(text, text) to authenticated;
grant execute on function public.hb_player_journal_edit(text, text, text) to authenticated;
SQL
J2=$($P -tA -c "$JOURNAL")
[ "$J1" = "$J2" ] && echo "ok : hb_journal_note, hb_player_journal_add, hb_player_journal_edit, hb_player_mood_trend revenues à 074 / 052 (droits compris)" || { echo "ÉCHEC : fonctions du journal pas revenues"; exit 1; }
echo "après retour arrière : colonne moods $($P -tA -c "select count(*) from information_schema.columns where table_name = 'hb_player_journal' and column_name = 'moods'"), fonctions $($P -tA -c "select count(*) from pg_proc where proname in ('hb_self_moods', 'hb_humeurs_sync')"), notes avec humeur $($P -tA -c "select count(*) from public.hb_player_journal where mood is not null and not deleted")"
