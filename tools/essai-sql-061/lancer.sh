#!/bin/bash
# Essai de supabase/061_registre_changements.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-061, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 060, 061 deux fois (relançable), la
# requête de contrôle de 061 ; le jeu de 058 (8 comptes) ; puis essais.sql : droits du direct (canaux gardés = hb_mes_canaux,
# règles de realtime.messages : mêmes canaux autorisés qu'avec les règles de 057, compte par compte, après chaque changement
# de rôle, d'affectation, d'unité, de niveau), registre (toute ligne visible qui a changé est citée, pertes d'accès citées,
# empreintes = formule de 059, curseur, purge, garde-fous) ; miroir.ts : l'appareil (src/registre.ts) décide juste sur une
# vraie réponse. Données fictives seulement. Rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-061/lancer.sh            essais (≈ 2 min)
#   bash tools/essai-sql-061/lancer.sh --mesure   puis la mesure sur un jeu de volume (10 000 comptes, 20 000 affectations,
#                                                 100 000 joueurs, 500 000 mesures ; mesure.sql ; ≈ 10 min)
#   PG_IMAGE=postgres:15-alpine bash tools/essai-sql-061/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-061}
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
for f in "$REPO"/supabase/0[0-9][0-9]_*.sql; do case "$f" in *061_*) ;; *) apply "$(basename "$f")" < "$f";; esac; done
apply 061 < "$REPO/supabase/061_registre_changements.sql"
apply "061 (relancé)" < "$REPO/supabase/061_registre_changements.sql"
echo "contrôle de 061 : $($P -tA -F ' ' -c "$(sed -n '/^-- ---------- Vérification/,/^-- Taille et dernières/p' "$REPO/supabase/061_registre_changements.sql" | grep -v '^--')")"
if [ "$1" = "--mesure" ]; then
  echo "--- jeu de volume (10 000 comptes, 20 000 affectations, 100 000 joueurs, 500 000 mesures) ---"
  $P < "$D/mesure-jeu.sql" 2>&1 | grep -vE '^(SET|INSERT|UPDATE|VACUUM|CREATE|ANALYZE|SELECT|DO|Temps|Time)' | sed 's/^psql:[^ ]* NOTICE:  /  /'
  echo "--- mesure ---"
  $P < "$D/mesure.sql" 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /' | grep -vE '^(SET|INSERT|ANALYZE|CREATE|DO|UPDATE|ALTER)$'
  rm -f "$D/.erreur.txt"
  exit 0
fi
echo "--- jeu et essais de 058 ---"
if ! $P < "$REPO/tools/essai-sql-058/essais.sql" > "$D/.erreur.txt" 2>&1; then echo "ÉCHEC essais de 058"; grep -E 'ERROR|CONTEXT' "$D/.erreur.txt"; exit 1; fi
echo "  ok"
echo "--- essais de 061 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "--- validation en retard (deux connexions) ---"
COMITE=00000000-0000-0000-0000-0000000000c1
CA=$($P -tA -c "select essai.comme('$COMITE', 'select public.hb_registre_depuis(null)') ->> 'c'")
# Une écriture dont la transaction dure 4 s (heure serveur de la ligne : son début) ; pendant ce temps, le comité passe.
( $P -c "begin; select essai.ecrire('$COMITE', 'measurements', '{\"id\":\"m-tard\",\"playerId\":\"j-0009\",\"value\":1,\"createdBy\":\"$COMITE\",\"updatedAt\":3000}'); select pg_sleep(4); commit;" >/dev/null ) &
ECRIT=$!
sleep 1.5
R1=$($P -tA -c "select essai.comme('$COMITE', 'select public.hb_registre_depuis(''$CA'')')")
wait $ECRIT
$P -tA -c "do \$\$
declare
  r1 jsonb := '$R1';
  r2 jsonb := essai.comme('$COMITE', format('select public.hb_registre_depuis(%L)', r1 ->> 'c'));
begin
  if exists (select 1 from jsonb_array_elements(r1 -> 'e' -> 'measurements') x where x ->> 0 = 'm-tard') then raise exception 'ÉCHEC : ligne pas encore validée citée'; end if;
  if not exists (select 1 from jsonb_array_elements(r2 -> 'e' -> 'measurements') x where x ->> 0 = 'm-tard') then raise exception 'ÉCHEC : ligne validée en retard pas citée : %', r2; end if;
  raise notice 'ligne validée 2,5 s après le passage, heure serveur % AVANT ce passage (%) : citée au passage suivant',
    (select server_updated_at from public.hb_measurements where id = 'm-tard'), r1 ->> 't';
end \$\$;" 2>&1 | sed 's/^NOTICE:  /  /'
echo "--- miroir : l'appareil décide sur une vraie réponse du registre ---"
$P -tA < "$D/miroir.sql" > "$D/.miroir.json"
(cd "$REPO" && npx jiti tools/essai-sql-061/miroir.ts "$D/.miroir.json")
rm -f "$D/.erreur.txt" "$D/.miroir.json"
