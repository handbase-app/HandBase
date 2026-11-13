#!/bin/bash
# Essai de supabase/067_propositions.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-067, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 066, 067 deux fois (relançable), sa
# requête de contrôle, puis essais.sql (droits, garde-fous, limites, purge) et notification.sql (le déclencheur de la section
# ACTIVATION, tiré du script tel qu'écrit, posé sur la base jetable avec un faux coffre et un faux pg_net qui note les appels).
# Données fictives seulement. Rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-067/lancer.sh
#   PG_IMAGE=postgres:15-alpine bash tools/essai-sql-067/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-067}
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
  if [ $((10#$n)) -lt 67 ]; then apply "$(basename "$f")" < "$f"; fi
done
apply 067 < "$REPO/supabase/067_propositions.sql"
apply "067 (relancé)" < "$REPO/supabase/067_propositions.sql"
CONTROLE="$(sed -n '/^-- ---------- Vérification/,/^-- ---------- ACTIVATION/p' "$REPO/supabase/067_propositions.sql" | grep -v '^--')"
echo "contrôle de 067 : $($P -tA -F ' ' -c "$CONTROLE")"
echo "--- essais de 067 ---"
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "--- notification (déclencheur de la section ACTIVATION) ---"
# Faux coffre et faux pg_net qui note les appels.
$P >/dev/null <<'SQL'
create or replace view vault.decrypted_secrets as
  select * from (values ('hb_veille_url'::text, 'https://exemple.test/functions/v1/veille'::text), ('hb_notify_secret', 'secret-fictif')) v(name, decrypted_secret);
create table if not exists essai.appels (url text, body jsonb, headers jsonb);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000)
returns bigint language sql as $$ insert into essai.appels values (url, body, headers); select 1::bigint $$;
SQL
# Le déclencheur tel qu'écrit dans 067 (lignes entre les repères, « -- » retiré), posé deux fois (relançable).
ACT="$(sed -n '/^-- >>> déclencheur/,/^-- <<< déclencheur/p' "$REPO/supabase/067_propositions.sql" | grep -v '^-- [<>][<>][<>]' | sed 's/^-- //')"
echo "$ACT" | $P >/dev/null
echo "$ACT" | $P >/dev/null
echo "contrôle après activation : $($P -tA -F ' ' -c "$CONTROLE")"
$P < "$D/notification.sql" 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
