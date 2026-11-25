-- Jeu fictif à l'échelle d'une base nationale (lancer.sh --mesure) : 500 000 joueurs (96 départements, 80 clubs chacun,
-- ~65 licenciés par club), 3 000 000 de mesures, 600 000 avis, 1 000 000 de « vu », sur des joueurs tirés au hasard ;
-- 2 000 auteurs fictifs. Heures serveur étalées sur un an. Données inventées (aucun nom, aucune licence réelle).
-- Écrit déclencheurs coupés (comme un import serveur) : colonnes de périmètre posées directement, pas de journal.
\set ON_ERROR_STOP 1
\timing on
select setseed(0.058);
set session_replication_role = replica;

-- Comptes de la mesure : administrateur, ligue (6 départements), comité du 83, club 6383015.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aaa1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-00000000aaa2', 'ligue@exemple.test'),
  ('00000000-0000-0000-0000-00000000aaa3', 'comite@exemple.test'),
  ('00000000-0000-0000-0000-00000000aaa4', 'club@exemple.test');
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-00000000aaa1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-00000000aaa2', 'ligue@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-00000000aaa3', 'comite@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-00000000aaa4', 'club@exemple.test', 'observateur');
insert into public.hb_units (id, data) values
  ('ligue', '{"id":"ligue","levelId":"niveau-ligue","name":"Ligue fictive","departments":["04","05","06","13","83","84"]}'),
  ('comite', '{"id":"comite","levelId":"niveau-comite","name":"Comité fictif","parentId":"ligue","departments":["83"]}'),
  ('club', '{"id":"club","levelId":"niveau-club","name":"Club fictif","parentId":"comite","clubNumber":"6383015"}');
insert into public.hb_assignments (id, data) values
  ('m-aff-l', '{"id":"m-aff-l","userId":"00000000-0000-0000-0000-00000000aaa2","unitId":"ligue"}'),
  ('m-aff-c', '{"id":"m-aff-c","userId":"00000000-0000-0000-0000-00000000aaa3","unitId":"comite"}'),
  ('m-aff-d', '{"id":"m-aff-d","userId":"00000000-0000-0000-0000-00000000aaa4","unitId":"club"}');

-- Joueurs : n° de club fictif 63 + département (01 à 96) + 3 chiffres (000 à 079).
insert into public.hb_players (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 'p' || i,
       jsonb_build_object('id', 'p' || i, 'firstName', 'Prénom', 'lastName', 'Fictif', 'birthYear', 2008 + i % 8,
                          'clubCode', c, 'createdBy', '00000000-0000-0000-0000-' || lpad(to_hex(1 + i % 2000), 12, '0'), 'updatedAt', i),
       i, timestamptz '2025-10-30' + (random() * 365) * interval '1 day', substr(c, 3, 2), c
  from (select i, '63' || lpad((1 + (i % 96))::text, 2, '0') || lpad(((i / 96) % 80)::text, 3, '0') as c
          from generate_series(1, 500000) i) s;

-- Lignes rattachées : joueur tiré au hasard, périmètre recopié du joueur (comme hb_scope_row).
create temporary table jx as select id, scope_dept, scope_club, row_number() over (order by id) as n from public.hb_players;
create index on jx (n);
analyze jx;
insert into public.hb_measurements (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 'm' || g, jsonb_build_object('id', 'm' || g, 'playerId', jx.id, 'testId', 't' || (g % 12), 'value', g % 997,
                                    'date', '2026-03-01', 'createdBy', '00000000-0000-0000-0000-' || lpad(to_hex(1 + g % 2000), 12, '0'), 'updatedAt', g),
       g, timestamptz '2025-10-30' + (random() * 365) * interval '1 day', jx.scope_dept, jx.scope_club
  from generate_series(1, 3000000) g join jx on jx.n = 1 + (hashint4(g) & 2147483647) % 500000;
insert into public.hb_evaluations (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 'e' || g, jsonb_build_object('id', 'e' || g, 'playerId', jx.id, 'scores', jsonb_build_object('c1', g % 5), 'comment', 'Avis fictif',
                                    'createdBy', '00000000-0000-0000-0000-' || lpad(to_hex(1 + g % 2000), 12, '0'), 'updatedAt', g),
       g, timestamptz '2025-10-30' + (random() * 365) * interval '1 day', jx.scope_dept, jx.scope_club
  from generate_series(1, 600000) g join jx on jx.n = 1 + (hashint4(g + 7) & 2147483647) % 500000;
insert into public.hb_seen (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 's' || g, jsonb_build_object('id', 's' || g, 'playerId', jx.id, 'eventId', 'ev' || (g % 300),
                                    'createdBy', '00000000-0000-0000-0000-' || lpad(to_hex(1 + g % 2000), 12, '0'), 'updatedAt', g),
       g, timestamptz '2025-10-30' + (random() * 365) * interval '1 day', jx.scope_dept, jx.scope_club
  from generate_series(1, 1000000) g join jx on jx.n = 1 + (hashint4(g + 13) & 2147483647) % 500000;
-- Quelques lignes créées par le club lui-même hors de son club (fiches proposées, mesures en tournoi).
update public.hb_measurements set data = data || '{"createdBy":"00000000-0000-0000-0000-00000000aaa4"}' where id in (select 'm' || g from generate_series(1, 3000000, 30000) g);
set session_replication_role = default;
vacuum analyze public.hb_players;
vacuum analyze public.hb_measurements;
vacuum analyze public.hb_evaluations;
vacuum analyze public.hb_seen;
select (select count(*) from public.hb_players) as joueurs, (select count(*) from public.hb_measurements) as mesures,
       (select count(*) from public.hb_evaluations) as avis, (select count(*) from public.hb_seen) as vus,
       (select count(*) from public.hb_players where scope_club = '6383015') as joueurs_du_club,
       (select count(*) from public.hb_measurements where scope_club = '6383015') as mesures_du_club,
       (select count(*) from public.hb_measurements where scope_dept = '83') as mesures_du_83,
       pg_size_pretty(pg_database_size(current_database())) as taille;
