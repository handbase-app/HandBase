#!/bin/bash
# Essai de supabase/060_push_veille.sql sur un Postgres JETABLE (Docker, conteneur hbpg-essai-060, supprimé à la fin) :
# bouchons des schémas Supabase (../essai-sql-057/bouchons.sql), schema.sql puis 002 → 059, 060 deux fois (relançable), la
# requête de contrôle de 060, puis essais.sql : destinataires exacts (créateur, participants, staff ; exclus : sans rôle,
# compte joueur, territoire seul, staff supprimé, archivé, supprimé, autres jours), chaque destinataire lit l'événement sous
# les règles de lecture, réservation (un envoi par personne et par jour), droits, abonnements.
# Comptes et événements fictifs. Rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-060/lancer.sh
#   PG_IMAGE=postgres:15-alpine bash tools/essai-sql-060/lancer.sh    autre image (défaut postgres:16)
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=hbpg-essai-060
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
for f in "$REPO"/supabase/0[0-9][0-9]_*.sql; do case "$f" in *060_*) ;; *) apply "$(basename "$f")" < "$f";; esac; done
apply 060 < "$REPO/supabase/060_push_veille.sql"
apply "060 (relancé)" < "$REPO/supabase/060_push_veille.sql"
echo "contrôle de 060 : $($P -tA -F ' ' -c "$(sed -n '/^-- ---------- Vérification/,/^-- Tâches programmées/p' "$REPO/supabase/060_push_veille.sql" | grep -v '^--')")"
if ! $P < "$D/essais.sql" > "$D/.erreur.txt" 2>&1; then echo "ÉCHEC essais de 060"; grep -E 'ERROR|ERREUR|CONTEXT|ÉCHEC' "$D/.erreur.txt"; exit 1; fi
grep -E 'NOTICE' "$D/.erreur.txt" | sed -E 's/^(psql:[^ ]* )?NOTICE:  /  /'
echo "essais de 060 : ok"
