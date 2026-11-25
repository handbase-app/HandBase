-- Avant 071 (lancer.sh) : lignes FICTIVES de chaque provenance, écrites comme elles le sont en vrai. Aucun nom réel.
--  - saisie de l'appli : écrite avec le compte (test.uid), signée par hb_stamp (createdBy, createdAtServer = maintenant) ;
--  - collage d'un tableau d'avant cette version : data.imported ; proposition validée de cette version : data.source + lotId ;
--  - SQL sans compte : signature « Administration Supabase (SQL) » ;
--  - générateur (comme seed-pole) : déclencheurs coupés, createdBy posé à la main, createdAtServer ANTIDATÉ, source demo-progression ;
--  - « vus » du Bilan de démo : data.demoBilan.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'preparateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin', 'Admin Fictif'),
  ('00000000-0000-0000-0000-0000000000d1', 'preparateur@exemple.test', 'preparateur', 'Encadrant Fictif'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test', 'observateur', 'Observateur Fictif')
on conflict (user_id) do update set role = excluded.role, full_name = excluded.full_name;

-- Périmètre des deux comptes du staff (046 : sans affectation, aucun joueur) : une unité couvrant le 83.
select set_config('test.uid', '', false);
insert into public.hb_units (id, data) values ('u-essai', '{"id":"u-essai","name":"Comité Essai","departments":["83"]}');
insert into public.hb_assignments (id, data) values
  ('as-d1', '{"id":"as-d1","userId":"00000000-0000-0000-0000-0000000000d1","unitId":"u-essai"}'),
  ('as-d2', '{"id":"as-d2","userId":"00000000-0000-0000-0000-0000000000d2","unitId":"u-essai"}');

-- Comme l'encadrant (saisie de l'appli : hb_stamp signe).
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d1', false);
insert into public.hb_players (id, data) values
  ('ess-p1', '{"id":"ess-p1","firstName":"Essai","lastName":"Fictivus","birthDate":"2011-01-01","sex":"M"}'),
  ('ess-p2', '{"id":"ess-p2","firstName":"Autre","lastName":"Fictivus","birthDate":"2012-02-02","sex":"F"}');
insert into public.hb_events (id, data) values
  ('ess-ev', '{"id":"ess-ev","name":"Détection Essai","type":"tournoi","date":"2026-10-12","playerIds":["ess-p1","ess-p2"]}'),
  ('ess-ev2', '{"id":"ess-ev2","name":"Autre jour","type":"tournoi","date":"2026-10-13","playerIds":["ess-p1"]}');
insert into public.hb_measurements (id, data) values
  ('ess-m1', '{"id":"ess-m1","playerId":"ess-p1","criterionId":"sprint","value":1.9,"date":"2026-10-12"}'),
  ('ess-m2', '{"id":"ess-m2","playerId":"ess-p2","criterionId":"sprint","value":2.1,"date":"2026-10-12"}'),
  ('ess-m3', '{"id":"ess-m3","playerId":"ess-p1","criterionId":"cmj","value":"31,5","date":"2026-10-12","imported":{"at":"2026-11-05T10:00:00Z"}}'),
  ('ess-m4', '{"id":"ess-m4","playerId":"ess-p2","criterionId":"sprint","value":2.0,"date":"2026-10-13","source":"proposition_validee","lotId":"prop-essai-1"}'),
  ('ess-m5', '{"id":"ess-m5","playerId":"ess-p1","criterionId":"lateralite","value":"Gauche","date":"2026-10-12"}');
insert into public.hb_evaluations (id, data) values
  ('ess-a1', '{"id":"ess-a1","playerId":"ess-p1","eventId":"ess-ev","date":"2026-10-12","scores":{"tir":4,"defense":3,"poste":"texte"},"strengths":"Commentaire fictif qui ne doit jamais sortir"}'),
  ('ess-a2', '{"id":"ess-a2","playerId":"ess-p2","eventId":"ess-ev","date":"2026-10-12","scores":{"tir":2},"imported":{"at":"2026-11-05T10:00:00Z"}}');
insert into public.hb_seen (id, data) values ('d1:ess-ev:ess-p1', '{"id":"d1:ess-ev:ess-p1","eventId":"ess-ev","playerId":"ess-p1"}');

-- Comme l'observateur : un avis.
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d2', false);
insert into public.hb_evaluations (id, data) values ('ess-a3', '{"id":"ess-a3","playerId":"ess-p1","date":"2026-10-12","scores":{"tir":5}}');

-- SQL sans compte.
select set_config('test.uid', '', false);
insert into public.hb_measurements (id, data) values ('ess-sql-1', '{"id":"ess-sql-1","playerId":"ess-p1","criterionId":"sprint","value":1.5,"date":"2026-09-01"}');

-- Générateur : déclencheurs coupés, signature posée à la main et antidatée (comme seed-pole), « vus » du Bilan de démo.
begin;
set local session_replication_role = replica;
insert into public.hb_measurements (id, data) values
  ('demo-prog-m-1', '{"id":"demo-prog-m-1","playerId":"ess-p1","criterionId":"sprint","value":1.8,"date":"2025-09-16","createdBy":"00000000-0000-0000-0000-0000000000d1","createdByName":"Encadrant Fictif","createdAtServer":"2025-09-16T16:01:37+00:00","source":"demo-progression"}'),
  ('demo-prog-m-2', '{"id":"demo-prog-m-2","playerId":"ess-p2","criterionId":"sprint","value":1.7,"date":"2026-03-14","createdBy":"00000000-0000-0000-0000-0000000000d1","createdByName":"Encadrant Fictif","createdAtServer":"2026-03-14T10:00:00+00:00","source":"demo-progression"}');
insert into public.hb_seen (id, data) values ('d2:ess-ev:ess-p2', '{"id":"d2:ess-ev:ess-p2","eventId":"ess-ev","playerId":"ess-p2","createdBy":"00000000-0000-0000-0000-0000000000d2","createdAtServer":"2026-04-18T09:00:00+00:00","demoBilan":true}');
commit;
do $$ begin raise notice 'ok : % mesures, % avis, % « vus », % fiches, % événements posés avant 071',
  (select count(*) from public.hb_measurements), (select count(*) from public.hb_evaluations), (select count(*) from public.hb_seen),
  (select count(*) from public.hb_players), (select count(*) from public.hb_events); end $$;
