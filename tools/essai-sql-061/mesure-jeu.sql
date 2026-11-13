-- Jeu de VOLUME (lancer.sh --mesure) : une fédération fictive à l'échelle d'un jour de détection à 10 000 personnes.
-- 13 ligues, 96 comités (un par département), 960 clubs (10 par département) ; 10 000 comptes (20 administrateurs,
-- 100 encadrants de ligue, 180 encadrants de comité, 9 700 comptes de club dont un sur cinq encadrant) ; 20 000 affectations
-- (2 par compte) ; 100 000 joueurs, 500 000 mesures, 50 000 avis, 100 000 « vu », 300 événements, heures étalées sur un an.
-- Écrit déclencheurs coupés (comme un import) : colonnes de périmètre posées directement, rien dans le registre (l'histoire).
-- Données inventées : aucun nom, aucun numéro réel.
\set ON_ERROR_STOP 1
\timing off
select setseed(0.061);
set session_replication_role = replica;

-- Structure.
insert into public.hb_levels (id, data) values
  ('niveau-federation', '{"id":"niveau-federation","name":"Fédération"}'), ('niveau-ligue', '{"id":"niveau-ligue","name":"Ligue"}'),
  ('niveau-comite', '{"id":"niveau-comite","name":"Comité"}'), ('niveau-club', '{"id":"niveau-club","name":"Club"}')
on conflict (id) do nothing;
insert into public.hb_units (id, data) values ('fede', '{"id":"fede","levelId":"niveau-federation","name":"Fédération fictive"}');
insert into public.hb_units (id, data)
select 'ligue-' || l, jsonb_build_object('id', 'ligue-' || l, 'levelId', 'niveau-ligue', 'name', 'Ligue fictive ' || l, 'parentId', 'fede',
         'departments', (select jsonb_agg(lpad(d::text, 2, '0')) from generate_series(1, 96) d where d % 13 = l % 13))
  from generate_series(1, 13) l;
insert into public.hb_units (id, data)
select 'comite-' || lpad(d::text, 2, '0'), jsonb_build_object('id', 'comite-' || lpad(d::text, 2, '0'), 'levelId', 'niveau-comite',
         'name', 'Comité fictif ' || d, 'parentId', 'ligue-' || (case when d % 13 = 0 then 13 else d % 13 end), 'departments', jsonb_build_array(lpad(d::text, 2, '0')))
  from generate_series(1, 96) d;
insert into public.hb_units (id, data)
select 'club-' || lpad(d::text, 2, '0') || '-' || n, jsonb_build_object('id', 'club-' || lpad(d::text, 2, '0') || '-' || n, 'levelId', 'niveau-club',
         'name', 'Club fictif ' || d || '-' || n, 'parentId', 'comite-' || lpad(d::text, 2, '0'), 'clubNumber', '63' || lpad(d::text, 2, '0') || lpad(n::text, 3, '0'))
  from generate_series(1, 96) d, generate_series(0, 9) n;

-- Comptes : uuid 00000000-0000-0000-0001-<n en hexadécimal>.
create temporary table cpt as
select i, ('00000000-0000-0000-0001-' || lpad(to_hex(i), 12, '0'))::uuid as uid,
       case when i <= 20 then 'admin' when i <= 300 or i % 5 = 0 then 'preparateur' else 'observateur' end as role
  from generate_series(1, 10000) i;
insert into auth.users (id, email) select uid, 'compte-' || i || '@exemple.test' from cpt;
insert into public.hb_profiles (user_id, email, role) select uid, 'compte-' || i || '@exemple.test', role from cpt
on conflict (user_id) do update set role = excluded.role;
-- Affectations : administrateurs → Fédération et une ligue ; 21-120 → deux ligues ; 121-300 → un comité et un de ses clubs ;
-- les autres → deux clubs.
insert into public.hb_assignments (id, data)
select 'aff-' || i || '-' || k, jsonb_build_object('id', 'aff-' || i || '-' || k, 'userId', uid, 'role', role,
         'unitId', case
           when i <= 20 then case when k = 1 then 'fede' else 'ligue-' || (1 + i % 13) end
           when i <= 120 then 'ligue-' || (1 + (i + k * 5) % 13)
           when i <= 300 then case when k = 1 then 'comite-' || lpad((1 + i % 96)::text, 2, '0') else 'club-' || lpad((1 + i % 96)::text, 2, '0') || '-' || (i % 10) end
           else 'club-' || lpad((1 + ((i * k * 7) % 960) / 10)::text, 2, '0') || '-' || ((i * k * 7) % 10) end)
  from cpt, generate_series(1, 2) k;

-- Joueurs, mesures, avis, « vu », événements.
insert into public.hb_players (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 'p' || i, jsonb_build_object('id', 'p' || i, 'firstName', 'Prénom', 'lastName', 'Fictif', 'birthYear', 2010 + i % 6, 'clubCode', c,
                                    'createdBy', '00000000-0000-0000-0001-' || lpad(to_hex(1 + i % 10000), 12, '0'), 'updatedAt', i),
       i, timestamptz '2025-10-30' + (random() * 365) * interval '1 day', substr(c, 3, 2), c
  from (select i, '63' || lpad((1 + (i % 960) / 10)::text, 2, '0') || lpad((i % 10)::text, 3, '0') as c from generate_series(1, 100000) i) s;
create temporary table jx as select id, scope_dept, scope_club, row_number() over (order by id) as n from public.hb_players;
create index on jx (n);
analyze jx;
insert into public.hb_measurements (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 'm' || g, jsonb_build_object('id', 'm' || g, 'playerId', jx.id, 'testId', 't' || (g % 12), 'value', g % 997, 'date', '2026-03-01',
                                    'createdBy', '00000000-0000-0000-0001-' || lpad(to_hex(1 + g % 10000), 12, '0'), 'updatedAt', g),
       g, timestamptz '2025-10-30' + (random() * 365) * interval '1 day', jx.scope_dept, jx.scope_club
  from generate_series(1, 500000) g join jx on jx.n = 1 + (hashint4(g) & 2147483647) % 100000;
insert into public.hb_evaluations (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 'e' || g, jsonb_build_object('id', 'e' || g, 'playerId', jx.id, 'scores', jsonb_build_object('c1', g % 5), 'comment', 'Avis fictif',
                                    'createdBy', '00000000-0000-0000-0001-' || lpad(to_hex(1 + g % 10000), 12, '0'), 'updatedAt', g),
       g, timestamptz '2025-10-30' + (random() * 365) * interval '1 day', jx.scope_dept, jx.scope_club
  from generate_series(1, 50000) g join jx on jx.n = 1 + (hashint4(g + 7) & 2147483647) % 100000;
insert into public.hb_seen (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 's' || g, jsonb_build_object('id', 's' || g, 'playerId', jx.id, 'eventId', 'ev' || (g % 300),
                                    'createdBy', '00000000-0000-0000-0001-' || lpad(to_hex(1 + g % 10000), 12, '0'), 'updatedAt', g),
       g, timestamptz '2025-10-30' + (random() * 365) * interval '1 day', jx.scope_dept, jx.scope_club
  from generate_series(1, 100000) g join jx on jx.n = 1 + (hashint4(g + 13) & 2147483647) % 100000;
insert into public.hb_events (id, data, updated_at_client, server_updated_at)
select 'ev' || g, jsonb_build_object('id', 'ev' || g, 'name', 'Détection fictive ' || g, 'date', '2026-11-01', 'updatedAt', g),
       g, timestamptz '2025-10-30' + (random() * 365) * interval '1 day'
  from generate_series(0, 299) g;
set session_replication_role = default;
vacuum analyze public.hb_players;
vacuum analyze public.hb_measurements;
vacuum analyze public.hb_evaluations;
vacuum analyze public.hb_seen;
vacuum analyze public.hb_assignments;
vacuum analyze public.hb_units;
vacuum analyze public.hb_profiles;
select (select count(*) from public.hb_profiles) as comptes, (select count(*) from public.hb_assignments) as affectations,
       (select count(*) from public.hb_units) as unites, (select count(*) from public.hb_players) as joueurs,
       (select count(*) from public.hb_measurements) as mesures, (select count(*) from public.hb_seen) as vus,
       pg_size_pretty(pg_database_size(current_database())) as taille;
