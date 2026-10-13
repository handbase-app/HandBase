-- Démo uniquement (base de test) : retire les « vu » ajoutés par demo_bilan_reperage.sql (data.demoBilan = true).
-- Marquage « supprimé » (et non effacement) pour que les appareils déjà synchronisés les retirent aussi.
begin;
set local session_replication_role = replica;
update hb_seen
   set deleted = true,
       data = data || jsonb_build_object('deleted', true, 'updatedAt', (extract(epoch from now()) * 1000)::bigint,
                                         'updatedAtServer', now()),
       updated_at_client = (extract(epoch from now()) * 1000)::bigint,
       server_updated_at = clock_timestamp()
 where coalesce((data ->> 'demoBilan')::boolean, false) and not deleted;
commit;
