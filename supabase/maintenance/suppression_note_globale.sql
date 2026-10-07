-- HandBase : suppression de la « note globale de la prestation » (champ overall des avis).
-- Le classement et les moyennes se fient désormais à la seule moyenne des critères notés.
-- Relançable. Les déclencheurs (journal, notifications, signature) sont coupés le temps de la mise à jour :
-- on retire un champ, ce n'est pas une modification d'avis par quelqu'un. La date serveur est avancée à la main
-- pour que les appareils reçoivent la version sans note globale.
begin;
set local session_replication_role = replica;

with now_ms as (select (extract(epoch from clock_timestamp()) * 1000)::bigint as ms)
update public.hb_evaluations e
   set data = (e.data - 'overall') || jsonb_build_object('updatedAt', n.ms),
       updated_at_client = n.ms,
       server_updated_at = clock_timestamp()
  from now_ms n
 where e.data ? 'overall';

-- Contrôle : doit renvoyer 0.
select count(*) as avis_avec_note_globale from public.hb_evaluations where data ? 'overall';
commit;
