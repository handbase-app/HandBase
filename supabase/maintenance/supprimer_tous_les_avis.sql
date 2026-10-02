-- HandBase : supprimer TOUS les avis des observateurs (maintenance).
-- À exécuter dans Supabase > SQL Editor, étape par étape (sélectionner un bloc puis « Run »).
--
-- Suppression « douce » : les avis sont marqués supprimés et leur date de modification avancée,
-- pour que chaque appareil (qui garde sa copie hors ligne) les retire à sa prochaine synchronisation.
-- Une ancienne version envoyée plus tard par un appareil est ignorée (la plus récente gagne).

-- 1) APERÇU : ce qui va être supprimé.
select count(*) as avis_actifs from public.hb_evaluations where not deleted;

select e.data ->> 'observer' as evaluateur,
       coalesce(p.data ->> 'firstName', '?') || ' ' || coalesce(p.data ->> 'lastName', '?') as joueur,
       e.data ->> 'date' as date,
       coalesce(ev.data ->> 'name', 'Hors événement') as evenement
  from public.hb_evaluations e
  left join public.hb_players p on p.id = e.data ->> 'playerId'
  left join public.hb_events ev on ev.id = e.data ->> 'eventId'
 where not e.deleted
 order by e.data ->> 'date' desc;

-- 2) SUPPRESSION de tous les avis.
update public.hb_evaluations
   set deleted = true,
       updated_at_client = (extract(epoch from clock_timestamp()) * 1000)::bigint,
       data = data || jsonb_build_object('deleted', true, 'updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint)
 where not deleted;

-- 3) VÉRIFICATION : doit renvoyer 0.
select count(*) as avis_actifs_restants from public.hb_evaluations where not deleted;

-- ANNULER (si besoin) : restaurer les avis supprimés aujourd'hui.
-- update public.hb_evaluations
--    set deleted = false,
--        updated_at_client = (extract(epoch from clock_timestamp()) * 1000)::bigint,
--        data = data || jsonb_build_object('deleted', false, 'updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint)
--  where deleted and server_updated_at::date = current_date;
