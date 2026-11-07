-- Avant 072 (lancer.sh) : base FICTIVE assez grosse pour le tri dans la base. Aucun nom réel (noms « Essai » + numéro).
--  - 6 500 joueurs nés en 2013 (plus que les 5 000 que le serveur MCP considère sans 072), 1 500 nés en 2012 (dont un
--    quart au 4e trimestre), quelques autres ; départements 83, 13, 2A, 06 ; une fiche fondue, une hors cadre, une
--    supprimée, une sans département ;
--  - mesures de taille (1 ou 2 dates, plus une ancienne plus grande par joueur, la dernière fait foi ; égalités de valeur pour départager par
--    l'identifiant), de sprint (valeurs en texte « 1,86 ») ; « vus » et avis (notes et commentaire fictif qui ne sort jamais) ;
--  - comptes : un administrateur, un encadrant affecté au 83, un compte sans rôle.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'preparateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'sansrole@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin', 'Admin Fictif'),
  ('00000000-0000-0000-0000-0000000000d1', 'preparateur@exemple.test', 'preparateur', 'Encadrant Fictif'),
  ('00000000-0000-0000-0000-0000000000e1', 'sansrole@exemple.test', null, 'Sans Rôle')
on conflict (user_id) do update set role = excluded.role, full_name = excluded.full_name;
select set_config('test.uid', '', false);
insert into public.hb_units (id, data) values ('u-essai', '{"id":"u-essai","name":"Comité Essai","departments":["83"]}');
insert into public.hb_assignments (id, data) values ('as-d1', '{"id":"as-d1","userId":"00000000-0000-0000-0000-0000000000d1","unitId":"u-essai"}');

-- Joueurs (identifiants dans le désordre : le départage par identifiant compte).
insert into public.hb_players (id, data)
select 'j' || md5(i::text), jsonb_build_object('id', 'j' || md5(i::text), 'firstName', 'Essai', 'lastName', 'Fictif' || i,
       'birthDate', y || '-' || lpad(m::text, 2, '0') || '-' || lpad((1 + i % 28)::text, 2, '0'),
       'sex', case when i % 2 = 0 then 'M' else 'F' end, 'position', (array['GB','AG','ARG','DC','ARD','AD','PIV'])[1 + i % 7],
       'department', (array['83','13','2A','06'])[1 + i % 4], 'club', 'Club Fictif ' || (i % 50))
  from (select i, case when i <= 6500 then 2013 when i <= 8000 then 2012 else 2011 end as y, 1 + (i * 7) % 12 as m
          from generate_series(1, 8400) i) s;
update public.hb_players set data = data || jsonb_build_object('mergedInto', 'j' || md5('1')) where id = 'j' || md5('2');
update public.hb_players set data = data || '{"review":"refused"}' where id = 'j' || md5('3');
update public.hb_players set deleted = true where id = 'j' || md5('4');
update public.hb_players set data = (data - 'department') where id = 'j' || md5('5');
insert into public.hb_players (id, data) values ('j-annee-seule', '{"id":"j-annee-seule","firstName":"Essai","lastName":"AnneeSeule","birthDate":"2013","sex":"M","department":"83"}');

-- Mesures de taille : 1 à 3 dates ; la dernière fait foi (la première est souvent plus grande : un tri sur toutes les
-- mesures serait faux). Valeurs entières de 140 à 199 : beaucoup d'égalités.
insert into public.hb_measurements (id, data)
select 'm-' || i || '-' || k, jsonb_build_object('id', 'm-' || i || '-' || k, 'playerId', 'j' || md5(i::text), 'criterionId', 'taille',
       'value', 140 + (i * 13 + k * 7) % 60, 'date', '2026-0' || (k + 1) || '-15')
  from generate_series(1, 8400) i, generate_series(1, 2) k
 where k <= 1 + i % 2;
-- Ancienne mesure plus grande, datée AVANT : ne doit pas compter.
insert into public.hb_measurements (id, data)
select 'm-old-' || i, jsonb_build_object('id', 'm-old-' || i, 'playerId', 'j' || md5(i::text), 'criterionId', 'taille', 'value', 230, 'date', '2025-01-01')
  from generate_series(1, 8400, 5) i;
insert into public.hb_measurements (id, data)
select 's-' || i, jsonb_build_object('id', 's-' || i, 'playerId', 'j' || md5(i::text), 'criterionId', 'sprint_10',
       'value', replace(to_char(1.70 + (i % 40) / 100.0, 'FM0.00'), '.', ','), 'date', '2026-10-12')
  from generate_series(1, 8400, 2) i;
insert into public.hb_measurements (id, data) values
  ('m-j-annee', '{"id":"m-j-annee","playerId":"j-annee-seule","criterionId":"taille","value":250,"date":"2026-10-12"}'),
  ('m-texte', jsonb_build_object('id', 'm-texte', 'playerId', 'j' || md5('6'), 'criterionId', 'taille', 'value', 'pas mesuré', 'date', '2026-12-01'));
insert into public.hb_measurements (id, data) select 'm-del', jsonb_build_object('id', 'm-del', 'playerId', 'j' || md5('7'), 'criterionId', 'taille', 'value', 260, 'date', '2026-12-01');
update public.hb_measurements set deleted = true where id = 'm-del';

-- Événements, « vus », avis (commentaire fictif qui ne doit jamais sortir).
insert into public.hb_events (id, data) select 'ev-' || k, jsonb_build_object('id', 'ev-' || k, 'name', 'Tournoi Essai ' || k, 'type', 'tournoi', 'date', '2026-10-1' || k,
       'playerIds', (select jsonb_agg('j' || md5(i::text)) from generate_series(k, 400, 3) i)) from generate_series(1, 3) k;
insert into public.hb_seen (id, data)
select 'v-' || k || '-' || i, jsonb_build_object('id', 'v-' || k || '-' || i, 'eventId', 'ev-' || k, 'playerId', 'j' || md5(i::text))
  from generate_series(1, 3) k, generate_series(k, 400, 3) i;
insert into public.hb_seen (id, data) select 'v-bis-' || i, jsonb_build_object('id', 'v-bis-' || i, 'eventId', 'ev-2', 'playerId', 'j' || md5(i::text)) from generate_series(1, 400, 2) i;
insert into public.hb_evaluations (id, data)
select 'a-' || i || '-' || k, jsonb_build_object('id', 'a-' || i || '-' || k, 'playerId', 'j' || md5(i::text), 'eventId', 'ev-1', 'date', '2026-10-1' || k,
       'scores', jsonb_build_object('tir', 1 + (i + k) % 5, 'defense', 1 + (i * k) % 5, 'lateralite', 'gauche'), 'strengths', 'Commentaire fictif secret ' || i)
  from generate_series(1, 300) i, generate_series(1, 2) k;
