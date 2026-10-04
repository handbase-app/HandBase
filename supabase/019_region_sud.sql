-- HandBase : « Provence-Alpes-Côte d'Azur » devient « Région Sud » (nom officiel de la région).
-- À exécuter une fois dans Supabase > SQL Editor (indépendant des autres scripts).
-- Ce script renomme la région des GROUPES DÉJÀ ENREGISTRÉS ; les appareils reçoivent le changement à la synchro.
-- La liste déroulante « Région » de l'appli, elle, est changée dans le code : elle affichera « Région Sud »
-- une fois la nouvelle version publiée.

update public.hb_groups
   set data = data || jsonb_build_object('region', 'Région Sud', 'updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint),
       updated_at_client = (extract(epoch from clock_timestamp()) * 1000)::bigint
 -- Toutes les écritures possibles (apostrophe droite ou courbe, avec ou sans tirets, majuscules…).
 where data ->> 'region' ilike 'provence%azur%';

-- Vérification : régions utilisées par les groupes.
select data ->> 'region' as region, count(*) as groupes
  from public.hb_groups where not deleted and data ? 'region' group by 1 order by 1;
