-- DÉMO UNIQUEMENT (HandBase-test, données fictives) : joueurs au Pôle Espoirs et sortis du pôle.
-- Par pôle (14) et par sexe : 20 joueurs au pôle (entrée en septembre 2023, 2024 ou 2025) et 5 sortis
-- (motifs variés). Joueurs choisis dans le territoire du pôle (département = chiffres 3-4 du n° de club), nés de 2009 à 2012, sans pôle déjà saisi.
-- Déclencheurs coupés (ni journal ni notification) ; la date serveur avance pour que les appareils les reçoivent.
begin;
set local session_replication_role = replica;

do $$ begin
  if current_database() is null or not exists (select 1 from public.hb_players where data->>'firstName' is not null limit 1) then
    raise exception 'Base vide ?';
  end if;
end $$;

create temp table pole (region text, depts text[], sites_m text[], sites_f text[]) on commit drop;
insert into pole values
 ('region-ara', '{01,03,07,15,26,38,42,43,63,69,73,74}', '{Lyon,Chambéry,Cournon-d''Auvergne}', '{Lyon,Chambéry,Clermont-Ferrand}'),
 ('region-bfc', '{21,25,39,58,70,71,89,90}', '{Dijon}', '{Besançon,Dijon}'),
 ('region-bre', '{22,29,35,56}', '{Cesson-Sévigné}', '{Brest,Rennes}'),
 ('region-cvl', '{18,28,36,37,41,45}', '{Chartres,Orléans}', '{Orléans}'),
 ('region-ges', '{08,10,51,52,54,55,57,67,68,88}', '{Strasbourg,Pont-à-Mousson,Reims}', '{Metz,Barr}'),
 ('region-hdf', '{02,59,60,62,80}', '{Dunkerque,Amiens}', '{Tourcoing,Amiens}'),
 ('region-idf', '{75,77,78,91,92,93,94,95}', '{Eaubonne}', '{Châtenay-Malabry,Fontainebleau}'),
 ('region-nor', '{14,27,50,61,76}', '{Caen}', '{"Le Havre",Caen}'),
 ('region-naq', '{16,17,19,23,24,33,40,47,64,79,86,87}', '{Bordeaux-Talence,Saint-Yrieix-la-Perche,Pau}', '{Bordeaux-Talence,Angoulême}'),
 ('region-occ', '{09,11,12,30,31,32,34,46,48,65,66,81,82}', '{Montpellier,Nîmes,Toulouse}', '{Nîmes,Toulouse}'),
 ('region-pdl', '{44,49,53,72,85}', '{Nantes}', '{Nantes}'),
 ('region-sud', '{04,05,06,13,83,84,20}', '{Saint-Raphaël,Aix-en-Provence,Ajaccio}', '{"Aix-en-Provence (Luynes)",Nice}'),
 ('region-ant', '{97}', '{"Guadeloupe (CREPS Antilles-Guyane)"}', '{"Basse-Terre (Guadeloupe)"}'),
 ('region-reu', '{97}', '{"Saint-Denis (CREPS Réunion)"}', '{"Le Port"}');

create temp table pick on commit drop as
with cand as (
  select p.id, p.data->>'sex' sex, po.region, po.sites_m, po.sites_f,
         row_number() over (partition by po.region, p.data->>'sex' order by md5(p.id || po.region)) rn
    from public.hb_players p
    join pole po on substr(coalesce(p.data->>'clubCode', ''), 3, 2) = any(po.depts)  -- n° de club FFHB : ligue (2 chiffres) puis département
   where not p.deleted and not (p.data ? 'poles')
     and p.data->>'sex' in ('M', 'F')
     and left(p.data->>'birthDate', 4) between '2009' and '2012'
)
select distinct on (id) * from cand where rn <= 25 order by id, region;

with built as (
  select k.id,
         case when k.sex = 'M' then k.sites_m else k.sites_f end as sites,
         k.region, k.rn, abs(hashtext(k.id)) h
    from pick k
)
update public.hb_players p
   set data = p.data || jsonb_build_object(
         'poles', jsonb_build_array(
           case when b.rn <= 20 then
             jsonb_build_object('regionId', b.region, 'site', b.sites[1 + b.h % array_length(b.sites, 1)],
                                'from', (2023 + b.h % 3)::text || '-09-01')
           else
             jsonb_build_object('regionId', b.region, 'site', b.sites[1 + b.h % array_length(b.sites, 1)],
                                'from', (2022 + b.h % 2)::text || '-09-01',
                                'to', (2024 + b.h % 2)::text || '-' || lpad((1 + b.h % 12)::text, 2, '0') || '-15',
                                'exitReason', (array['fin_cursus','exclusion','abandon','blessure','autre'])[1 + b.rn % 5])
           end),
         'updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint),
       updated_at_client = (extract(epoch from clock_timestamp()) * 1000)::bigint,
       server_updated_at = clock_timestamp()
  from built b
 where b.id = p.id;

select k.region, k.sex, count(*) filter (where k.rn <= 20) au_pole, count(*) filter (where k.rn > 20) sortis
  from pick k group by 1, 2 order by 1, 2;
commit;
