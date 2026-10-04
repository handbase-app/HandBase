-- HandBase : « Provence-Alpes-Côte d'Azur » devient « Région Sud » (nom officiel de la région).
-- À exécuter une fois dans Supabase > SQL Editor (indépendant des autres scripts).
-- Renomme la région des groupes déjà enregistrés ; les appareils reçoivent le changement à la synchro.

update public.hb_groups
   set data = data || jsonb_build_object('region', 'Région Sud', 'updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint),
       updated_at_client = (extract(epoch from clock_timestamp()) * 1000)::bigint
 where data ->> 'region' in ('Provence-Alpes-Côte d’Azur', 'Provence-Alpes-Côte d''Azur');

-- Vérification : régions utilisées par les groupes.
select data ->> 'region' as region, count(*) as groupes
  from public.hb_groups where not deleted and data ? 'region' group by 1 order by 1;
