#!/bin/bash
# Essai de supabase/080_alertes_wellness.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-080, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 077 (078 et 079 : données de démo), empreinte de hb_upsert et de
# hb_wellness_staff_lit, 080 deux fois (relançable), sa requête de contrôle, les comptes / fiches / groupes fictifs de
# tools/essai-sql-073/essais.sql puis essais.sql (réglages personnels, calcul, résumé du matin, droits), la parité TS ↔ SQL
# (parite.ts : mêmes cas que src/wellnessAlerts.ts, 600 tirés au hasard, jours fériés, jours demandés), les empreintes à
# nouveau, puis le retour arrière. Données fictives seulement ; rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-080/lancer.sh
#   PG_IMAGE=postgres:17 bash tools/essai-sql-080/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-080}
IMG=${PG_IMAGE:-postgres:16}
T=$(mktemp -d)
trap 'docker rm -f $C >/dev/null 2>&1 || true; rm -rf "$T"' EXIT
docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C -e POSTGRES_PASSWORD=essai -e POSTGRES_DB=hb -e TZ=Europe/Paris "$IMG" -c jit=off >/dev/null
for i in $(seq 1 30); do docker exec $C pg_isready -U postgres -d hb >/dev/null 2>&1 && break; sleep 1; done
sleep 2
echo "Postgres : $(docker exec $C psql -U postgres -d hb -tA -c 'show server_version')"
P="docker exec -i $C psql -U postgres -d hb -v ON_ERROR_STOP=1 -q"
$P < "$REPO/tools/essai-sql-057/bouchons.sql" 2>/dev/null
apply() { sed -E 's/create extension if not exists (pg_cron|pg_net)[^;]*;/select 1;/I' | $P >/dev/null 2>"$T/erreur.txt" || { echo "ÉCHEC $1"; cat "$T/erreur.txt"; exit 1; }; }
apply schema.sql < "$REPO/supabase/schema.sql"
for f in "$REPO"/supabase/0[0-9][0-9]_*.sql; do
  n=$(basename "$f" | cut -c1-3)
  # 078 et 079 : données de démo seulement (rien à créer, base nue).
  if [ $((10#$n)) -lt 80 ] && [ "$n" != 078 ] && [ "$n" != 079 ]; then apply "$(basename "$f")" < "$f"; fi
done
EMPREINTES="select md5(string_agg(p.proname || ':' || md5(p.prosrc), '|' order by p.proname)) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('hb_upsert', 'hb_upsert_lignes', 'hb_stamp', 'hb_log', 'hb_touch', 'hb_wellness_staff_lit', 'hb_wellness_groupe', 'hb_notify')"
E1=$($P -tA -c "$EMPREINTES")
apply 080 < "$REPO/supabase/080_alertes_wellness.sql"
apply "080 (relancé)" < "$REPO/supabase/080_alertes_wellness.sql"
CONTROLE="$(sed -n '/^-- ---------- Vérification/,/^-- ---------- RETOUR ARRIÈRE/p' "$REPO/supabase/080_alertes_wellness.sql" | grep -v '^--')"
echo "contrôle de 080 (table, règles, garde, rls, appli, anon, calcul fermé, tâche, alertes, Pâques 2027, lundi, 11 novembre) : $(echo "$CONTROLE" | $P -F ' ' -tA)"
echo "--- essais de 080 ---"
# Comptes, fiches et groupes fictifs de 073 (tout ce qui précède ses essais), puis les nôtres.
{ sed -n '1,/^do \$\$/p' "$REPO/tools/essai-sql-073/essais.sql" | sed '$d'; cat "$D/essais.sql"; } | $P 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "--- parité TS ↔ SQL ---"
(cd "$REPO" && npx jiti tools/essai-sql-080/parite.ts) > "$T/parite.sql"
$P < "$T/parite.sql" 2>&1 | grep -E 'NOTICE|ERROR|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /' | cut -c1-400
E2=$($P -tA -c "$EMPREINTES")
[ "$E1" = "$E2" ] && echo "ok : hb_upsert, hb_stamp, hb_log, hb_touch, hb_wellness_staff_lit, hb_wellness_groupe, hb_notify inchangés ($E1)" || { echo "ÉCHEC : fonctions existantes modifiées"; exit 1; }
echo "--- retour arrière ---"
sed -n '/^-- ---------- RETOUR ARRIÈRE/,/^-- ---------- ACTIVATION/p' "$REPO/supabase/080_alertes_wellness.sql" | grep -E '^-- (drop|delete|select cron)' | sed 's/^-- //' | $P >/dev/null
echo "après retour arrière : fonctions $($P -tA -c "select count(*) from pg_proc where proname like 'hb\_wla\_%' or proname like 'hb\_wellness\_alertes%'"), table $($P -tA -c "select count(*) from pg_class where relname = 'hb_wellness_alertes'")"
