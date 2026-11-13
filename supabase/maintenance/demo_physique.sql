-- Démo uniquement (base de test HandBase-test, données fictives) : note les critères « Capacités Physiques evidentes »
-- (Endurance, Puissance, Vitesse, Explosivité) dans les avis déjà donnés sur les événements. NE JAMAIS lancer sur la base réelle.
--
-- Principe (tirage déterministe, relançable sans effet de plus) :
--  - chaque joueur a un niveau physique propre (1,5 à 4,5) et un point fort parmi les quatre critères (+1) ;
--  - chaque avis s'en écarte un peu (-1, 0 ou +1) selon l'observateur ; note bornée de 1 à 5 ;
--  - seulement les critères qui s'appliquent au poste du joueur (gardien : Vitesse et Explosivité) ;
--  - une note déjà donnée par un coach n'est jamais remplacée.
-- Les clés ajoutées sont notées dans data.demoPhysique : demo_physique_retirer.sql les enlève proprement.

begin;
set local session_replication_role = replica;

with
crit(id, k) as (values
  ('cd96d89a-68bd-450a-bd6a-9502fe92c064', 0), ('d7706d52-7a57-40a0-bd29-a67ce4912ee1', 1),
  ('768265fb-7b31-421b-8dc1-69575b5e326d', 2), ('7341ffae-cebd-446d-aa83-dd4fb7f24c52', 3)),
cible as (
  select e.id as eid, e.data->>'playerId' as pid, c.id as cid, c.k,
         ('x' || substr(md5(e.data->>'playerId' || ':physique'), 1, 8))::bit(32)::bigint / 4294967296.0 as niveau,
         ('x' || substr(md5(e.data->>'playerId' || ':fort'), 1, 8))::bit(32)::bigint % 4 as fort,
         ('x' || substr(md5(e.id || ':' || c.id), 1, 8))::bit(32)::bigint % 5 as bruit
    from hb_evaluations e
    join hb_players p on p.id = e.data->>'playerId'
    join hb_criteria hc on not hc.deleted
    join crit c on c.id = hc.id
   where not e.deleted and e.data->>'eventId' is not null
     and not (coalesce(e.data->'scores', '{}'::jsonb) ? c.id)
     and (hc.data->'positions' is null or jsonb_array_length(hc.data->'positions') = 0
          or p.data->>'position' is null or hc.data->'positions' ? (p.data->>'position'))
),
notes as (
  select eid, cid,
         greatest(1, least(5, round(1.5 + 3 * niveau + case when k = fort then 1 else 0 end
                                    + case bruit when 0 then -1 when 4 then 1 else 0 end)))::int as v
    from cible
),
par_avis as (
  select eid, jsonb_object_agg(cid, v) as ajout, jsonb_agg(cid) as cles from notes group by eid
)
update hb_evaluations e
   set data = e.data
              || jsonb_build_object('scores', coalesce(e.data->'scores', '{}'::jsonb) || a.ajout,
                                    'demoPhysique', coalesce(e.data->'demoPhysique', '[]'::jsonb) || a.cles,
                                    'updatedAt', (extract(epoch from now()) * 1000)::bigint,
                                    'updatedAtServer', now()),
       updated_at_client = (extract(epoch from now()) * 1000)::bigint,
       server_updated_at = clock_timestamp()
  from par_avis a
 where e.id = a.eid;

commit;

-- Contrôle : nombre d'avis notés et moyenne par critère.
select c.data->>'label' as critere, count(*) as avis, round(avg((e.data->'scores'->>c.id)::numeric), 2) as moyenne
  from hb_criteria c
  join hb_evaluations e on not e.deleted and e.data->'scores' ? c.id
 where c.data->>'category' = 'Capacités Physiques evidentes' and not c.deleted
 group by 1 order by 1;
