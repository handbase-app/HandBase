-- Démo uniquement (base de test) : retire les notes physiques ajoutées par demo_physique.sql (clés listées dans data.demoPhysique).
begin;
set local session_replication_role = replica;
update hb_evaluations e
   set data = (e.data - 'demoPhysique')
              || jsonb_build_object('scores', (e.data->'scores') - array(select jsonb_array_elements_text(e.data->'demoPhysique')),
                                    'updatedAt', (extract(epoch from now()) * 1000)::bigint,
                                    'updatedAtServer', now()),
       updated_at_client = (extract(epoch from now()) * 1000)::bigint,
       server_updated_at = clock_timestamp()
 where not e.deleted and e.data ? 'demoPhysique';
commit;
