-- Démo uniquement (base de test HandBase-test, données fictives) : remplit le « Bilan de détection » avec des joueurs
-- déjà « vus », pour que la page ait des chiffres réalistes. NE JAMAIS lancer sur la base réelle.
--
-- Principe (tirage déterministe : relancer le script donne exactement le même résultat, sans doublon) :
--  - part de joueurs vus par génération : 2008 90 %, 2009 82 %, 2010 70 %, 2011 55 %, 2012 38 %, 2013 22 %,
--    2014 10 %, 2015 4 % (un peu moins chez les filles, × 0,85) ;
--  - variation par club (× 0,25 à × 1,75), avec environ 8 % de clubs entièrement vus et 8 % pas encore visités,
--    pour que « Où aller ? » ait du relief ;
--  - 55 % des « vu » sur la saison en cours (événements de septembre-octobre 2026), le reste sur la saison
--    2025-2026 (événements d'avril à juillet 2026) : le filtre « Cette saison / Depuis toujours » change les chiffres ;
--  - chaque « vu » est attribué à un membre du staff de la démo, sur un événement existant de la bonne période.
-- Les lignes portent data.demoBilan = true : demo_bilan_reperage_retirer.sql les enlève proprement.
-- Les déclencheurs (journal, signature) sont coupés le temps de l'insertion : signature posée ici directement.

begin;
set local session_replication_role = replica;

with
staff(k, uid, name) as (values
  (0, '993a6ad5-8316-407b-8352-754c27bda76f', 'Geoffroy Krantz'),
  (1, '82e1eb07-71ec-4333-b186-20b3e481dc9c', 'Stef bascher'),
  (2, '5e05fd5e-3407-4d2f-ba01-e39a0f142afe', 'Mathieu Turmo'),
  (3, '8b703650-3064-4899-8d00-827a3cce8489', 'Michaël Guigou'),
  (4, 'bb012a46-a628-40d3-996d-57524fa32ff3', 'Patrick Passemard')),
ev_now(k, id) as (values
  (0, '98569460-d468-44f2-8e02-815425fa8def'), (1, '780a94b2-637b-4bb7-934a-6e1238c9164d'),
  (2, '73545b3a-1137-43bf-bd32-80dc3ac53cdd'), (3, 'e5d5033f-0bf0-4cb7-a7e6-bbfe799be28b'),
  (4, 'cfc877b1-244b-4d08-80c7-d5f3a95de098'), (5, '065b54a4-d497-490c-8cd6-21d462a77dcc'),
  (6, 'a6bd07ac-6242-4aeb-bd72-7a81d3726da9')),
ev_before(k, id) as (values
  (0, 'c842bd41-835a-49f0-958a-feba0eb3b518'), (1, '5eb7e8e9-683b-4040-8d0d-c3f054197d2c'),
  (2, '4b428c2c-371d-4a42-a3fe-38ee4443c67a'), (3, '157127ab-e040-4f92-9741-47ea7353a640'),
  (4, '0aec35cd-c543-425b-8fce-51572e0b0d8e'), (5, '0a1f550e-ee99-4a25-a866-a427b1d24c96')),
pct(y, p) as (values ('2008', .90), ('2009', .82), ('2010', .70), ('2011', .55), ('2012', .38), ('2013', .22),
  ('2014', .10), ('2015', .04)),
-- Tirages dans [0, 1) à partir d'empreintes md5 (stables d'une exécution à l'autre).
pl as (
  select p.id,
         ('x' || substr(md5(p.id || ':vu'), 1, 8))::bit(32)::bigint / 4294967296.0 as u,
         ('x' || substr(md5(p.id || ':saison'), 1, 8))::bit(32)::bigint / 4294967296.0 as s,
         ('x' || substr(md5(p.id || ':qui'), 1, 8))::bit(32)::bigint as q,
         ('x' || substr(md5(lower(coalesce(p.data ->> 'club', '')) || ':club'), 1, 8))::bit(32)::bigint / 4294967296.0 as c,
         pc.p * case when p.data ->> 'sex' = 'F' then .85 else 1 end as base
    from hb_players p
    join pct pc on pc.y = left(p.data ->> 'birthDate', 4)
   where not p.deleted and p.data ->> 'mergedInto' is null and not coalesce((p.data ->> 'purged')::boolean, false)
),
vus as (
  select pl.*,
         case when pl.c < .08 then 1.0 when pl.c > .92 then 0.0 else least(.98, pl.base * (.25 + 1.5 * pl.c)) end as chance
    from pl
),
choix as (
  select v.id as pid, st.uid, st.name,
         case when v.s < .55 then (select id from ev_now where k = v.q % 7) else (select id from ev_before where k = v.q % 6) end as eid,
         v.q
    from vus v
    join staff st on st.k = v.q % 5
   where v.u < v.chance
),
lignes as (
  select c.uid || ':' || c.eid || ':' || c.pid as id, c.pid, c.uid, c.name, c.eid,
         ((e.data ->> 'date')::date + make_interval(hours => 9 + (c.q % 9)::int, mins => (c.q % 60)::int))::timestamptz as at
    from choix c
    join hb_events e on e.id = c.eid
)
insert into hb_seen (id, data, updated_at_client, deleted, server_updated_at)
select l.id,
       jsonb_build_object(
         'id', l.id, 'eventId', l.eid, 'playerId', l.pid, 'at', l.at,
         'createdBy', l.uid, 'createdByName', l.name, 'updatedBy', l.uid, 'updatedByName', l.name,
         'createdAtServer', l.at, 'updatedAtServer', now(),
         'updatedAt', (extract(epoch from now()) * 1000)::bigint, 'demoBilan', true),
       (extract(epoch from now()) * 1000)::bigint, false, clock_timestamp()
  from lignes l
on conflict (id) do nothing;

commit;

-- Contrôle : part de joueurs vus par génération (depuis toujours).
select left(p.data ->> 'birthDate', 4) as annee,
       count(*) as joueurs,
       count(*) filter (where exists (select 1 from hb_seen s where not s.deleted and s.data ->> 'playerId' = p.id)) as vus,
       round(100.0 * count(*) filter (where exists (select 1 from hb_seen s where not s.deleted and s.data ->> 'playerId' = p.id)) / count(*)) as pct
  from hb_players p
 where not p.deleted and p.data ->> 'mergedInto' is null
 group by 1 order by 1;
