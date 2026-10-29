#!/bin/bash
# Essai de supabase/057_synchro_legere.sql sur un Postgres 16 JETABLE (Docker, conteneur hbpg-essai, supprimé à la fin) :
# bouchons des schémas Supabase (bouchons.sql : auth, realtime, vault, net, cron), schema.sql puis 002 → 056, l'ANCIENNE
# version de 057 (déclencheurs hb_diffuser, commit 974ed51), la nouvelle deux fois (relançable : déclencheurs retirés),
# les essais (essais.sql : règles d'envoi et d'écoute, aucune diffusion par la base, clé « mes_affectations » et colonne
# user_id des affectations) et la comparaison des canaux avec
# l'appli (lignes.sql + miroir.ts). Données fictives seulement. Rien n'est envoyé à une base distante.
#
#   bash tools/essai-sql-057/lancer.sh
set -eo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$D/../.." && pwd)
C=hbpg-essai
trap 'docker rm -f $C >/dev/null 2>&1 || true' EXIT
docker rm -f $C >/dev/null 2>&1 || true
docker run -d --name $C -e POSTGRES_PASSWORD=essai -e POSTGRES_DB=hb postgres:16 >/dev/null
for i in $(seq 1 30); do docker exec $C pg_isready -U postgres -d hb >/dev/null 2>&1 && break; sleep 1; done
sleep 2
P="docker exec -i $C psql -U postgres -d hb -v ON_ERROR_STOP=1 -q"
$P < "$D/bouchons.sql" 2>/dev/null
# pg_cron et pg_net n'existent pas dans l'image : leur « create extension » est retiré à la volée (fonctions bouchées).
apply() { sed -E 's/create extension if not exists (pg_cron|pg_net)[^;]*;/select 1;/I' | $P >/dev/null 2>"$D/.erreur.txt" || { echo "ÉCHEC $1"; cat "$D/.erreur.txt"; exit 1; }; }
apply schema.sql < "$REPO/supabase/schema.sql"
for f in "$REPO"/supabase/0[0-9][0-9]_*.sql; do case "$f" in *057_*) ;; *) apply "$(basename "$f")" < "$f";; esac; done
git -C "$REPO" show 974ed51:supabase/057_synchro_legere.sql | apply "057 (ancienne version)"
echo "ancien 057 : déclencheurs hb_diffuser = $($P -tA -c "select count(*) from pg_trigger where tgname = 'hb_diffuser'")"
apply 057 < "$REPO/supabase/057_synchro_legere.sql"
apply "057 (relancé)" < "$REPO/supabase/057_synchro_legere.sql"
n=$($P -tA -c "select count(*) from pg_trigger where tgname = 'hb_diffuser'")
f=$($P -tA -c "select count(*) from pg_proc where proname = 'hb_diffuser'")
echo "nouveau 057 (deux fois) : déclencheurs = $n, fonction hb_diffuser = $f"
[ "$n" = 0 ] && [ "$f" = 0 ]
$P < "$D/essais.sql" 2>&1 | grep -E 'NOTICE:  (règles|écritures|quoi)|ERROR|CONTEXT'
$P -tA < "$D/lignes.sql" > "$D/.lignes.json"
cd "$REPO" && npx jiti "$D/miroir.ts" "$D/.lignes.json"
rm -f "$D/.lignes.json" "$D/.erreur.txt"
