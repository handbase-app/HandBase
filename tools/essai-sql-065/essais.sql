-- Essais de supabase/065_objectifs_etapes.sql (lancer.sh) : comptes, fiches et objectifs FICTIFS. Toute erreur arrête.
-- Le jeune : écrit seulement pour SA fiche (jamais un autre player_id), ne touche jamais à la fiche (texte du staff, état
-- « atteint » d'un objectif du staff), ne coche que les étapes des objectifs de SA fiche (le jour est posé par le serveur et
-- gardé), limites (12 objectifs, 5 en cours, 8 étapes, longueurs), liens http(s) seulement, période (from, due : jours
-- valables seulement) ; aucune écriture directe (jeune,
-- staff, administrateur) ; lecture : lui, et le staff selon le périmètre de la fiche ; anon : rien ; tout vide : ligne
-- retirée ; fusion de fiches : elle suit la fiche gardée (et se joint à la sienne) ; effacement RGPD et suppression
-- définitive : elle part ; la table refuse une forme abîmée.
\set ON_ERROR_STOP 1
create schema if not exists essai;

-- ---------- Comptes ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'comite83@exemple.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'comite13@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune1@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'jeune2@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e3', 'jeune3@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e4', 'jeune4@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'comite83@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000c3', 'comite13@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune1@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e2', 'jeune2@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e3', 'jeune3@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e4', 'jeune4@exemple.test', 'joueur')
on conflict (user_id) do update set role = excluded.role;
update public.hb_profiles set player_id = 'j-1' where user_id = '00000000-0000-0000-0000-0000000000e1';
update public.hb_profiles set player_id = 'j-2' where user_id = '00000000-0000-0000-0000-0000000000e2';
update public.hb_profiles set player_id = 'j-4' where user_id = '00000000-0000-0000-0000-0000000000e4';
-- e3 : compte joueur SANS fiche reliée.

-- Structure fictive : ligue (13, 83) → comité du 83, comité du 13.
insert into public.hb_units (id, data) values
  ('ligue-sud', '{"id":"ligue-sud","levelId":"niveau-ligue","name":"Ligue fictive","departments":["13","83"]}'),
  ('unite-83', '{"id":"unite-83","levelId":"niveau-comite","name":"Comité fictif 83","parentId":"ligue-sud","departments":["83"]}'),
  ('unite-13', '{"id":"unite-13","levelId":"niveau-comite","name":"Comité fictif 13","parentId":"ligue-sud","departments":["13"]}');
insert into public.hb_assignments (id, data) values
  ('aff-c1', '{"id":"aff-c1","userId":"00000000-0000-0000-0000-0000000000c1","unitId":"unite-83","role":"preparateur"}'),
  ('aff-c3', '{"id":"aff-c3","userId":"00000000-0000-0000-0000-0000000000c3","unitId":"unite-13","role":"preparateur"}');

-- Fiches : j-1, j-3, j-4 dans le 83, j-2 dans le 13. j-1 : un objectif du staff avec deux étapes (une déjà cochée par le
-- staff) ; j-2 : un objectif du staff avec une étape ; j-4 : un objectif enregistré AVANT les étapes (ancienne forme).
insert into public.hb_players (id, data) values
  ('j-1', '{"id":"j-1","firstName":"Prénom","lastName":"Fictif Un","clubCode":"6383015","objectives":[{"id":"o-s1","text":"Gagner en détente","status":"en_cours","steps":[{"id":"e-s1","text":"Corde à sauter 10 min par jour"},{"id":"e-s2","text":"Sauts sur banc","done":"2026-11-01"}]}]}'),
  ('j-2', '{"id":"j-2","firstName":"Prénom","lastName":"Fictif Deux","clubCode":"6313001","objectives":[{"id":"o-s9","text":"Oser le tir de loin","status":"en_cours","steps":[{"id":"e-s9","text":"Dix tirs par séance"}]}]}'),
  ('j-3', '{"id":"j-3","firstName":"Prénom","lastName":"Fictif Trois","clubCode":"6383020"}'),
  ('j-4', '{"id":"j-4","firstName":"Prénom","lastName":"Fictif Quatre","clubCode":"6383020","objectives":[{"id":"o-v1","text":"Parler en défense","status":"en_cours"}]}');

create temporary table jours as select to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-DD') as auj;
grant select on jours to authenticated;

-- Exécute p_sql comme le compte p_uid (rôle authenticated ; null : anon) ; rend le nombre de lignes, ou « ERR code message ».
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
    return 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  return n::text;
end $$;

-- Valeur d'une expression calculée comme le compte p_uid (texte ; « ERR code message » si refus).
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
    return 'ERR ' || sqlstate || ' ' || sqlerrm;
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

-- n objectifs « à moi » fictifs (identifiants g-<préfixe>-1…n), dans l'état donné.
create or replace function essai.objs(p_prefix text, n int, p_status text default 'en_cours') returns jsonb
language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p_prefix || '-' || i, 'text', 'Objectif ' || i, 'status', p_status) order by i), '[]'::jsonb)
    from generate_series(1, n) i
$$;
grant execute on function essai.objs(text, int, text) to anon, authenticated;

do $$
declare
  a1 text := '00000000-0000-0000-0000-0000000000a1';
  c1 text := '00000000-0000-0000-0000-0000000000c1';
  c3 text := '00000000-0000-0000-0000-0000000000c3';
  d2 text := '00000000-0000-0000-0000-0000000000d2';
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  e2 text := '00000000-0000-0000-0000-0000000000e2';
  e3 text := '00000000-0000-0000-0000-0000000000e3';
  e4 text := '00000000-0000-0000-0000-0000000000e4';
  save text := 'select public.hb_player_goals_save(%L::jsonb, %L::jsonb)::text';
  v_auj text := (select auj from jours);
  v_fiche text := (select md5(data::text) from public.hb_players where id = 'j-1');
  lu text;
begin
  -- ---------- Enregistrer : ses objectifs, ses coches ----------
  lu := essai.vu(e1, format(save,
    '[{"id":"g-1","text":"  Le tir en\u0007 suspension  ","status":"en_cours","video":" https://exemple.test/modele ","date":"2026-11-04",
       "from":"2026-12-20","due":"2027-01-03",
       "steps":[{"id":"t-1","text":"Regarder la vidéo du modèle","video":"https://exemple.test/demo"},{"id":"t-2","text":"   "},{"id":"t-1","text":"doublon"},{"id":"t-3","text":"Dix sauts","done":"2026-11-03"}]},
      {"id":"g-2","text":"Courir 2 fois par semaine","status":"atteint","doneAt":"2026-11-02","bidule":1,"from":"2026-02-30","due":"31/12/2026"}]',
    '["e-s1","e-s9","o-s1","inconnue",12]'));
  perform essai.attendu('jeune 1 : objectifs nettoyés (période gardée : jours valables seulement), coche d''une étape de SA fiche seulement (ni d''un autre, ni d''un objectif)',
    lu, (jsonb_build_object(
      'own', '[{"id":"g-1","text":"Le tir en suspension","status":"en_cours","video":"https://exemple.test/modele","date":"2026-11-04","from":"2026-12-20","due":"2027-01-03",
                "steps":[{"id":"t-1","text":"Regarder la vidéo du modèle","video":"https://exemple.test/demo"},{"id":"t-3","text":"Dix sauts","done":"2026-11-03"}]},
               {"id":"g-2","text":"Courir 2 fois par semaine","status":"atteint","doneAt":"2026-11-02"}]'::jsonb,
      'checks', jsonb_build_object('e-s1', v_auj), 'at', public.hb_self_iso(now())))::text);
  perform essai.attendu('… une ligne, à SA fiche, compte noté', (select string_agg(player_id || ' ' || user_id::text, ';') from public.hb_player_goals), 'j-1 ' || e1);
  perform essai.attendu('… la fiche n''a pas bougé (texte du staff, étapes, coches du staff)', (select md5(data::text) from public.hb_players where id = 'j-1'), v_fiche);
  perform essai.attendu('… l''objectif du staff reste « en cours » (son « atteint » est au staff)', (select data -> 'objectives' -> 0 ->> 'status' from public.hb_players where id = 'j-1'), 'en_cours');

  -- Une coche déjà là garde son jour ; une coche retirée part.
  perform set_config('test.uid', '', true); -- écriture de l'essai lui-même (propriétaire), pas d'un compte
  update public.hb_player_goals set checks = '{"e-s1":"2026-10-01"}' where player_id = 'j-1';
  perform essai.attendu('coche déjà là : jour gardé', essai.vu(e1, format('select (public.hb_player_goals_save(%L::jsonb, %L::jsonb) -> ''checks'')::text', essai.objs('g', 1), '["e-s1","e-s2"]')),
    jsonb_build_object('e-s1', '2026-10-01', 'e-s2', v_auj)::text);
  perform essai.attendu('coche retirée', essai.vu(e1, format('select (public.hb_player_goals_save(%L::jsonb, %L::jsonb) -> ''checks'')::text', essai.objs('g', 1), '["e-s2"]')),
    jsonb_build_object('e-s2', v_auj)::text);
  perform essai.attendu('p_checks absent : aucune coche', essai.vu(e1, format('select (public.hb_player_goals_save(%L::jsonb, null) -> ''checks'')::text', essai.objs('g', 1))), '{}');

  -- ---------- Limites ----------
  perform essai.attendu('5 en cours : permis', essai.vu(e1, format('select jsonb_array_length(public.hb_player_goals_save(%L::jsonb, null) -> ''own'')::text', essai.objs('g', 5))), '5');
  perform essai.attendu('5 en cours + 7 atteints (12) : permis',
    essai.vu(e1, format('select jsonb_array_length(public.hb_player_goals_save(%L::jsonb, null) -> ''own'')::text', (essai.objs('g', 5) || essai.objs('h', 7, 'atteint'))::text)), '12');
  perform essai.attendu('6 en cours : refusé', essai.vu(e1, format(save, essai.objs('g', 6), null)), 'ERR P0001 max_en_cours');
  perform essai.attendu('13 objectifs : refusé', essai.vu(e1, format(save, essai.objs('h', 13, 'atteint'), null)), 'ERR P0001 trop_d_objectifs');
  perform essai.attendu('9 étapes : refusé',
    essai.vu(e1, format(save, jsonb_build_array(jsonb_build_object('id', 'g-1', 'text', 'Neuf étapes', 'steps',
      (select jsonb_agg(jsonb_build_object('id', 's' || i, 'text', 'Étape ' || i)) from generate_series(1, 9) i))), null)), 'ERR P0001 trop_d_etapes');
  perform essai.attendu('8 étapes : permis',
    essai.vu(e1, format('select jsonb_array_length(public.hb_player_goals_save(%L::jsonb, null) -> ''own'' -> 0 -> ''steps'')::text', jsonb_build_array(jsonb_build_object('id', 'g-1', 'text', 'Huit étapes', 'steps',
      (select jsonb_agg(jsonb_build_object('id', 's' || i, 'text', 'Étape ' || i)) from generate_series(1, 8) i))))), '8');
  perform essai.attendu('texte coupé à 120, étape à 100',
    essai.vu(e1, format('select (select length(x ->> ''text'') || ''/'' || length(x -> ''steps'' -> 0 ->> ''text'') from jsonb_array_elements(public.hb_player_goals_save(%L::jsonb, null) -> ''own'') x)',
      jsonb_build_array(jsonb_build_object('id', 'g-1', 'text', repeat('é', 200), 'steps', jsonb_build_array(jsonb_build_object('id', 's1', 'text', repeat('a', 300))))))), '120/100');
  perform essai.attendu('entrée trop longue : refusée', essai.vu(e1, format(save, jsonb_build_array(jsonb_build_object('id', 'g-1', 'text', repeat('x', 90000))), null)), 'ERR P0001 trop_long');
  perform essai.attendu('forme inconnue : refusée', essai.vu(e1, format(save, '{"id":"g-1"}', null)), 'ERR P0001 format');

  -- ---------- Liens : http(s) seulement ----------
  perform essai.attendu('lien javascript: refusé', essai.vu(e1, format(save, '[{"id":"g-1","text":"A","video":"javascript:alert(1)"}]', null)), 'ERR P0001 lien');
  perform essai.attendu('lien data: refusé (étape)', essai.vu(e1, format(save, '[{"id":"g-1","text":"A","steps":[{"id":"s","text":"B","video":"data:text/html,x"}]}]', null)), 'ERR P0001 lien');
  perform essai.attendu('lien ftp refusé', essai.vu(e1, format(save, '[{"id":"g-1","text":"A","video":"ftp://exemple.test/x"}]', null)), 'ERR P0001 lien');
  perform essai.attendu('lien avec espace refusé', essai.vu(e1, format(save, '[{"id":"g-1","text":"A","video":"https://exemple.test/a b"}]', null)), 'ERR P0001 lien');
  perform essai.attendu('lien trop long refusé', essai.vu(e1, format(save, jsonb_build_array(jsonb_build_object('id', 'g-1', 'text', 'A', 'video', 'https://exemple.test/' || repeat('a', 500))), null)), 'ERR P0001 lien');
  perform essai.attendu('lien numérique refusé', essai.vu(e1, format(save, '[{"id":"g-1","text":"A","video":12}]', null)), 'ERR P0001 lien');
  perform essai.attendu('lien vide : rien', essai.vu(e1, format('select (public.hb_player_goals_save(%L::jsonb, null) -> ''own'' -> 0 ? ''video'')::text', '[{"id":"g-1","text":"A","video":"  "}]')), 'false');
  perform essai.attendu('HTTPS en majuscules : gardé', essai.vu(e1, format('select public.hb_player_goals_save(%L::jsonb, null) -> ''own'' -> 0 ->> ''video''', '[{"id":"g-1","text":"A","video":"HTTPS://exemple.test/v?t=12"}]')), 'HTTPS://exemple.test/v?t=12');

  -- ---------- Qui peut écrire ----------
  perform essai.attendu('compte joueur sans fiche : refusé', essai.vu(e3, format(save, essai.objs('g', 1), null)), 'ERR P0001 sans_fiche');
  perform essai.attendu('staff : refusé (il n''y écrit jamais)', essai.vu(c1, format(save, essai.objs('g', 1), null)), 'ERR P0001 pas_joueur');
  perform essai.attendu('administrateur : refusé aussi', essai.vu(a1, format(save, essai.objs('g', 1), null)), 'ERR P0001 pas_joueur');
  perform essai.attendu('anon : refusé', essai.vu(null, format(save, essai.objs('g', 1), null)), 'ERR 42501 permission denied for function hb_player_goals_save');

  -- Jamais pour un autre : le jeune 2 écrit les siens ; ceux du jeune 1 ne bougent pas.
  perform essai.attendu('jeune 1 : un objectif', essai.comme(e1, format(save, '[{"id":"g-1","text":"Le tir en suspension","steps":[{"id":"t-1","text":"Regarder la vidéo"}]}]', '["e-s1"]')), '1');
  perform essai.attendu('jeune 2 : les siens, coche de SA fiche (pas celles du jeune 1)', essai.vu(e2, format('select (public.hb_player_goals_save(%L::jsonb, %L::jsonb) -> ''checks'')::text', '[{"id":"g-1","text":"Mon objectif","status":"en_cours"},{"id":"g-2b","text":"Mon deuxième"}]', '["e-s9","e-s1"]')),
    jsonb_build_object('e-s9', v_auj)::text);
  perform essai.attendu('… ceux du jeune 1 intacts', (select own -> 0 ->> 'text' || ' ' || checks::text from public.hb_player_goals where player_id = 'j-1'), 'Le tir en suspension {"e-s1": "' || v_auj || '"}');
  perform essai.attendu('ancienne fiche (objectif sans étapes) : rien à cocher, ses objectifs à lui passent',
    essai.vu(e4, format('select (public.hb_player_goals_save(%L::jsonb, %L::jsonb))::jsonb #>> ''{own,0,text}'' || '' '' || (public.hb_player_goals_save(%L::jsonb, %L::jsonb) -> ''checks'')::text', essai.objs('g', 1), '["o-v1"]', essai.objs('g', 1), '["o-v1"]')), 'Objectif 1 {}');

  -- ---------- Aucune écriture directe ----------
  perform essai.attendu('jeune : insertion directe refusée', essai.comme(e1, $q$insert into public.hb_player_goals (player_id) values ('j-2')$q$), 'ERR 42501 permission denied for table hb_player_goals');
  perform essai.attendu('jeune : modification directe refusée', essai.comme(e1, $q$update public.hb_player_goals set checks = '{}'$q$), 'ERR 42501 permission denied for table hb_player_goals');
  perform essai.attendu('jeune : suppression directe refusée', essai.comme(e1, $q$delete from public.hb_player_goals$q$), 'ERR 42501 permission denied for table hb_player_goals');
  perform essai.attendu('staff : modification directe refusée', essai.comme(c1, $q$update public.hb_player_goals set own = '[]'$q$), 'ERR 42501 permission denied for table hb_player_goals');
  perform essai.attendu('administrateur : insertion directe refusée', essai.comme(a1, $q$insert into public.hb_player_goals (player_id) values ('j-3')$q$), 'ERR 42501 permission denied for table hb_player_goals');
  perform essai.attendu('jeune : la fiche (texte du staff) reste fermée',
    left(essai.comme(e1, $q$update public.hb_players set data = jsonb_set(data, '{objectives,0,text}', '"Autre texte"') where id = 'j-1'$q$), 3), 'ERR');
  perform essai.attendu('… texte du staff intact', (select data -> 'objectives' -> 0 ->> 'text' from public.hb_players where id = 'j-1'), 'Gagner en détente');

  -- ---------- Lecture ----------
  perform essai.attendu('jeune 1 : lit la sienne', essai.comme(e1, 'select * from public.hb_player_goals'), '1');
  perform essai.attendu('jeune 1 : pas celle du jeune 2', essai.comme(e1, $q$select * from public.hb_player_goals where player_id = 'j-2'$q$), '0');
  perform essai.attendu('jeune 2 : la sienne', essai.vu(e2, 'select string_agg(player_id, '','') from public.hb_player_goals'), 'j-2');
  perform essai.attendu('compte joueur sans fiche : rien', essai.comme(e3, 'select * from public.hb_player_goals'), '0');
  perform essai.attendu('administrateur : toutes', essai.comme(a1, 'select * from public.hb_player_goals'), '3');
  perform essai.attendu('comité du 83 : celles de j-1 et j-4 (son périmètre)', essai.vu(c1, 'select string_agg(player_id, '','' order by player_id) from public.hb_player_goals'), 'j-1,j-4');
  perform essai.attendu('comité du 13 : celle de j-2 seulement', essai.vu(c3, 'select string_agg(player_id, '','' order by player_id) from public.hb_player_goals'), 'j-2');
  perform essai.attendu('observateur sans affectation : rien', essai.comme(d2, 'select * from public.hb_player_goals'), '0');
  perform essai.attendu('anon : refusé', essai.comme(null, 'select * from public.hb_player_goals'), 'ERR 42501 permission denied for table hb_player_goals');

  -- ---------- Tout vide : retirée ----------
  perform essai.attendu('tout vide : rien gardé', essai.vu(e4, format(save, '[{"id":"g-1","text":"   "}]', '[]')), '{"own": [], "checks": {}}');
  perform essai.attendu('… ligne retirée', (select count(*)::text from public.hb_player_goals where player_id = 'j-4'), '0');

  -- ---------- Fusion ----------
  -- j-1 : 4 en cours + 1 atteint ; j-2 : 2 en cours, dont un même identifiant que j-1 (g-1) ; coches réunies.
  perform essai.attendu('jeune 1 : 4 en cours + 1 atteint',
    essai.comme(e1, format(save, (essai.objs('g', 4) || '[{"id":"h-1","text":"Atteint","status":"atteint","doneAt":"2026-10-01"}]'::jsonb)::text, '["e-s1"]')), '1');
  perform essai.attendu('fusion j-2 → j-1 (administrateur)', essai.comme(a1, $q$select public.hb_merge_players('j-2', 'j-1')$q$), '1');
  perform essai.attendu('… celle de j-2 a rejoint j-1 (même identifiant : celui de j-1 ; 5 en cours au plus)',
    (select string_agg(x ->> 'id' || ':' || (x ->> 'text'), ',' order by n) from public.hb_player_goals, jsonb_array_elements(own) with ordinality e(x, n) where player_id = 'j-1'),
    'g-1:Objectif 1,g-2:Objectif 2,g-3:Objectif 3,g-4:Objectif 4,h-1:Atteint,g-2b:Mon deuxième');
  perform essai.attendu('… coches réunies', (select string_agg(k, ',' order by k) from public.hb_player_goals, jsonb_object_keys(checks) k where player_id = 'j-1'), 'e-s1,e-s9');
  perform essai.attendu('… plus de ligne pour j-2', (select count(*)::text from public.hb_player_goals where player_id = 'j-2'), '0');
  -- j-4 (une ligne) fondu dans j-3 (aucune) : la ligne suit.
  perform essai.attendu('jeune 4 : un objectif', essai.comme(e4, format(save, essai.objs('g', 1), null)), '1');
  perform essai.attendu('fusion j-4 → j-3', essai.comme(a1, $q$select public.hb_merge_players('j-4', 'j-3')$q$), '1');
  perform essai.attendu('… la ligne suit la fiche gardée', (select string_agg(player_id, ',') from public.hb_player_goals where player_id in ('j-3', 'j-4')), 'j-3');

  -- ---------- Effacement RGPD, suppression définitive (par l'administrateur) ----------
  perform set_config('test.uid', a1, true);
  update public.hb_players set data = data || '{"purged":true}' where id = 'j-1';
  perform essai.attendu('fiche effacée (RGPD) : sa ligne part', (select count(*)::text from public.hb_player_goals where player_id = 'j-1'), '0');
  perform essai.attendu('… pas celles des autres', (select count(*)::text from public.hb_player_goals where player_id = 'j-3'), '1');
  delete from public.hb_players where id = 'j-3';
  perform essai.attendu('fiche supprimée définitivement : sa ligne part', (select count(*)::text from public.hb_player_goals), '0');
end $$;

-- La table refuse une forme abîmée, même écrite par le propriétaire.
do $$
begin
  begin
    insert into public.hb_player_goals (player_id, own) values ('j-9', '[{"id":"g-1","text":"A","status":"en_cours","video":"javascript:alert(1)"}]');
    raise exception 'ÉCHEC : lien javascript accepté';
  exception when check_violation then
    raise notice 'ok : lien non http(s) refusé par la table';
  end;
  begin
    insert into public.hb_player_goals (player_id, own) values ('j-9', essai.objs('g', 6));
    raise exception 'ÉCHEC : 6 en cours acceptés';
  exception when check_violation then
    raise notice 'ok : 6 en cours refusés par la table';
  end;
  begin
    insert into public.hb_player_goals (player_id, checks) values ('j-9', '{"e-1":"hier"}');
    raise exception 'ÉCHEC : coche sans jour acceptée';
  exception when check_violation then
    raise notice 'ok : coche abîmée refusée par la table';
  end;
end $$;
