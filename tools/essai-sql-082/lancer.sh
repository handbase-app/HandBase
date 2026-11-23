#!/bin/bash
# Essai de supabase/082_wellness_groupe_moyennes.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-082, supprimé à la
# fin) : bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 081 (078 et 079 : données de
# démo), empreintes de hb_upsert et des fonctions du wellness, 082 deux fois (relançable), sa requête de contrôle, les comptes /
# fiches / groupes fictifs de tools/essai-sql-073/essais.sql puis essais.sql (jour passé, moyennes, droits, périodes), la
# parité TS ↔ SQL (parite.ts : réponses tirées au hasard, mêmes moyennes que src/wellness.ts), les empreintes à nouveau, puis
# le retour arrière. Données fictives seulement ; rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-082/lancer.sh
#   PG_IMAGE=postgres:17 bash tools/essai-sql-082/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=${CONTENEUR:-hbpg-essai-082}
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
  if [ $((10#$n)) -lt 82 ] && [ "$n" != 078 ] && [ "$n" != 079 ]; then apply "$(basename "$f")" < "$f"; fi
done
UPSERT="select md5(prosrc) from pg_proc where proname = 'hb_upsert' and pronamespace = 'public'::regnamespace"
EMPREINTES="select md5(string_agg(p.proname || ':' || md5(p.prosrc), '|' order by p.proname)) from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('hb_upsert', 'hb_upsert_lignes', 'hb_stamp', 'hb_log', 'hb_touch',
    'hb_wellness_staff_lit', 'hb_wellness_groupe', 'hb_wl_contient', 'hb_wl_staff_de', 'hb_wl_json', 'hb_wl_seance_json', 'hb_notify')"
U1=$($P -tA -c "$UPSERT")
E1=$($P -tA -c "$EMPREINTES")
echo "empreinte de hb_upsert avant 082 : $U1"
apply 082 < "$REPO/supabase/082_wellness_groupe_moyennes.sql"
apply "082 (relancé)" < "$REPO/supabase/082_wellness_groupe_moyennes.sql"
CONTROLE="$(sed -n '/^-- ---------- Vérification/,/^-- ---------- RETOUR ARRIÈRE/p' "$REPO/supabase/082_wellness_groupe_moyennes.sql" | grep -v '^--')"
echo "contrôle de 082 (appli, anon, internes, forme 5,5, période refusée) : $(echo "$CONTROLE" | $P -F ' ' -tA)"
echo "--- essais de 082 ---"
# Comptes, fiches et groupes fictifs de 073 (tout ce qui précède ses essais), puis les nôtres.
{ sed -n '1,/^do \$\$/p' "$REPO/tools/essai-sql-073/essais.sql" | sed '$d'; cat "$D/essais.sql"; } | $P 2>&1 | grep -E 'NOTICE|ERROR|CONTEXT|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "--- parité TS ↔ SQL ---"
(cd "$REPO" && npx jiti tools/essai-sql-082/parite.ts) > "$T/parite.sql"
$P < "$T/parite.sql" 2>&1 | grep -E 'NOTICE|ERROR|ÉCHEC' | sed 's/^psql:[^ ]* NOTICE:  /  /' | cut -c1-400
U2=$($P -tA -c "$UPSERT")
E2=$($P -tA -c "$EMPREINTES")
[ "$U1" = "$U2" ] && echo "ok : hb_upsert inchangé ($U2)" || { echo "ÉCHEC : hb_upsert modifié"; exit 1; }
[ "$E1" = "$E2" ] && echo "ok : hb_upsert, hb_stamp, hb_log, hb_touch, hb_wellness_staff_lit, hb_wellness_groupe, hb_wl_*, hb_notify inchangés ($E1)" || { echo "ÉCHEC : fonctions existantes modifiées"; exit 1; }
echo "--- retour arrière ---"
sed -n '/^-- ---------- RETOUR ARRIÈRE/,$p' "$REPO/supabase/082_wellness_groupe_moyennes.sql" | grep -E '^-- drop' | sed 's/^-- //' | $P >/dev/null
echo "après retour arrière : fonctions de 082 restantes $($P -tA -c "select count(*) from pg_proc where proname in ('hb_wellness_groupe_au', 'hb_wellness_groupe_moyennes', 'hb_wl_groupe_fiches', 'hb_wl_jour_lu', 'hb_wl_forme')"), hb_wellness_groupe toujours là : $($P -tA -c "select count(*) from pg_proc where proname = 'hb_wellness_groupe'")"
