-- Essai de supabase/066_mes_tests.sql (lancer.sh), AVANT le script : comptes, fiches, tests et mesures FICTIFS ; ce que chaque
-- compte lit (lecture directe sous les règles, et lecture par périmètre de 058) est gardé pour être comparé après 066.
-- Avant 066, un compte joueur qui demande les tests et les mesures (appli à jour) ne reçoit rien, sans erreur.
\set ON_ERROR_STOP 1
create schema if not exists essai;

-- ---------- Comptes ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'comite83@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'club@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune1@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'jeune2@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e3', 'jeune3@exemple.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'comite83@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000d1', 'club@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune1@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e2', 'jeune2@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e3', 'jeune3@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test', null)
on conflict (user_id) do update set role = excluded.role;
update public.hb_profiles set player_id = 'j-1' where user_id = '00000000-0000-0000-0000-0000000000e1';
update public.hb_profiles set player_id = 'j-2' where user_id = '00000000-0000-0000-0000-0000000000e2';
-- e3 : compte joueur SANS fiche reliée ; f1 : compte sans rôle.

-- Structure fictive : comité du 83 → club 6383015.
insert into public.hb_units (id, data) values
  ('unite-83', '{"id":"unite-83","levelId":"niveau-comite","name":"Comité fictif 83","departments":["83"]}'),
  ('club-1', '{"id":"club-1","levelId":"niveau-club","name":"Club fictif","parentId":"unite-83","clubNumber":"6383015"}');
insert into public.hb_assignments (id, data) values
  ('aff-c1', '{"id":"aff-c1","userId":"00000000-0000-0000-0000-0000000000c1","unitId":"unite-83","role":"preparateur"}'),
  ('aff-d1', '{"id":"aff-d1","userId":"00000000-0000-0000-0000-0000000000d1","unitId":"club-1","role":"observateur"}');

-- Fiches : j-1 (club 6383015), j-2 (83, autre club), j-3 (13).
insert into public.hb_players (id, data) values
  ('j-1', '{"id":"j-1","firstName":"Prénom","lastName":"Fictif Un","clubCode":"6383015"}'),
  ('j-2', '{"id":"j-2","firstName":"Prénom","lastName":"Fictif Deux","clubCode":"6383020"}'),
  ('j-3', '{"id":"j-3","firstName":"Prénom","lastName":"Fictif Trois","clubCode":"6313001"}');

-- Tests (factuels) et un critère d'observation.
insert into public.hb_criteria (id, data) values
  ('sprint_10', '{"id":"sprint_10","label":"Sprint 10 m","category":"Vitesse & endurance","kind":"factual","scale":"number","unit":"s","active":true,"order":1}'),
  ('cmj_hauteur', '{"id":"cmj_hauteur","label":"CMJ – hauteur","category":"Sauts (plateforme)","kind":"factual","scale":"number","unit":"cm","active":true,"order":2}'),
  ('poids', '{"id":"poids","label":"Poids","category":"Gabarit","kind":"factual","scale":"number","unit":"kg","active":true,"order":3}'),
  ('vision', '{"id":"vision","label":"Vision du jeu","category":"Technique","kind":"subjective","scale":"score5","active":true,"order":4}');

-- Mesures : j-1 : 4 (dont une supprimée), j-2 : 2, j-3 : 2 ; auteurs : le comité, l'observateur (sur j-3, hors périmètre).
insert into public.hb_measurements (id, data, deleted) values
  ('m-1a', '{"id":"m-1a","playerId":"j-1","criterionId":"sprint_10","value":1.91,"date":"2026-03-01","createdBy":"00000000-0000-0000-0000-0000000000c1"}', false),
  ('m-1b', '{"id":"m-1b","playerId":"j-1","criterionId":"sprint_10","value":1.82,"date":"2026-10-12","createdBy":"00000000-0000-0000-0000-0000000000c1"}', false),
  ('m-1c', '{"id":"m-1c","playerId":"j-1","criterionId":"poids","value":64,"date":"2026-10-12","createdBy":"00000000-0000-0000-0000-0000000000c1"}', false),
  ('m-1d', '{"id":"m-1d","playerId":"j-1","criterionId":"cmj_hauteur","value":30,"date":"2026-01-02","createdBy":"00000000-0000-0000-0000-0000000000c1"}', true),
  ('m-2a', '{"id":"m-2a","playerId":"j-2","criterionId":"sprint_10","value":2.01,"date":"2026-03-01","createdBy":"00000000-0000-0000-0000-0000000000c1"}', false),
  ('m-2b', '{"id":"m-2b","playerId":"j-2","criterionId":"cmj_hauteur","value":28,"date":"2026-03-01","createdBy":"00000000-0000-0000-0000-0000000000c1"}', false),
  ('m-3a', '{"id":"m-3a","playerId":"j-3","criterionId":"sprint_10","value":1.95,"date":"2026-03-01","createdBy":"00000000-0000-0000-0000-0000000000d2"}', false),
  ('m-3b', '{"id":"m-3b","playerId":"j-3","criterionId":"cmj_hauteur","value":33,"date":"2026-03-01"}', false);
-- Un avis sur j-1 : jamais lisible par le jeune.
insert into public.hb_evaluations (id, data) values
  ('ev-1', '{"id":"ev-1","playerId":"j-1","scores":{"vision":4},"createdBy":"00000000-0000-0000-0000-0000000000c1"}');

-- ---------- Outils ----------
-- Exécute p_sql comme le compte p_uid (rôle authenticated ; null : anon) ; rend le nombre de lignes, ou « ERR code ».
create or replace function essai.comme(p_uid text, p_sql text) returns text
language plpgsql as $$
declare n bigint;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    reset role;
    return 'ERR ' || sqlstate;
  end;
  reset role;
  return n::text;
end $$;

-- Valeur d'une expression calculée comme le compte p_uid (texte ; « ERR code » si refus).
create or replace function essai.vu(p_uid text, p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  begin
    execute p_sql into v;
  exception when others then
    reset role;
    return 'ERR ' || sqlstate;
  end;
  reset role;
  return v;
end $$;
grant usage on schema essai to anon, authenticated;
grant execute on all functions in schema essai to anon, authenticated;

create or replace function essai.attendu(p_quoi text, p_vu text, p_attendu text) returns void
language plpgsql as $$
begin
  if p_vu is distinct from p_attendu then raise exception 'ÉCHEC % : % au lieu de %', p_quoi, p_vu, p_attendu; end if;
  raise notice 'ok : %', p_quoi;
end $$;

-- Ce que lit un compte : identifiants triés de la table, en lecture directe ('direct') ou par hb_lire_perimetre ('perimetre').
create or replace function essai.ids(p_uid text, p_table text, p_how text) returns text
language plpgsql as $$
begin
  return essai.vu(p_uid, case p_how
    when 'direct' then format('select coalesce(string_agg(id, %L order by id), %L) from public.%I', ',', '', 'hb_' || p_table)
    else format('select coalesce(string_agg(id, %L order by id), %L) from public.hb_lire_perimetre(%L, %L, 1000)', ',', '', p_table, '-infinity')
  end);
end $$;

create table essai.comptes (uid text primary key, nom text);
insert into essai.comptes values
  ('00000000-0000-0000-0000-0000000000a1', 'administrateur'),
  ('00000000-0000-0000-0000-0000000000c1', 'comité'),
  ('00000000-0000-0000-0000-0000000000d1', 'club'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur sans affectation'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune 1'),
  ('00000000-0000-0000-0000-0000000000e2', 'jeune 2'),
  ('00000000-0000-0000-0000-0000000000e3', 'jeune sans fiche'),
  ('00000000-0000-0000-0000-0000000000f1', 'sans rôle');

-- ---------- Avant 066 : ce que chacun lit ----------
create table essai.avant (uid text, tbl text, how text, ids text, primary key (uid, tbl, how));
insert into essai.avant
select c.uid, t, h, essai.ids(c.uid, t, h)
  from essai.comptes c, unnest(array['players', 'criteria', 'measurements', 'evaluations']) t, unnest(array['direct', 'perimetre']) h
 where h = 'direct' or t in ('players', 'measurements', 'evaluations');

do $$
declare e1 text := '00000000-0000-0000-0000-0000000000e1';
begin
  perform essai.attendu('avant 066 : le jeune ne lit aucune mesure (sans erreur)', essai.ids(e1, 'measurements', 'direct'), '');
  perform essai.attendu('avant 066 : … ni par la lecture par périmètre', essai.ids(e1, 'measurements', 'perimetre'), '');
  perform essai.attendu('avant 066 : … ni les tests', essai.ids(e1, 'criteria', 'direct'), '');
  perform essai.attendu('avant 066 : sa fiche seulement', essai.ids(e1, 'players', 'direct'), 'j-1');
  perform essai.attendu('avant 066 : le comité lit les mesures du 83', essai.ids('00000000-0000-0000-0000-0000000000c1', 'measurements', 'direct'), 'm-1a,m-1b,m-1c,m-1d,m-2a,m-2b');
end $$;
