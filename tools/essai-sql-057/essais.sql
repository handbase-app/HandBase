-- Essais de supabase/057_synchro_legere.sql (plan B : l'appareil qui écrit prévient) sur un jeu fictif (lancer.sh).
-- Comptes : administrateur, comité du 83, club 6383015 (sous le comité), compte joueur (fiche p1), compte sans rôle.
-- Toute erreur d'assertion arrête le script.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'comite@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'club@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'comite@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000d1', 'club@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test', null)
on conflict (user_id) do update set role = excluded.role;
update public.hb_profiles set player_id = 'p1' where user_id = '00000000-0000-0000-0000-0000000000e1';

-- Structure : comité du Var (83), club fictif 6383015 dessous.
-- Niveaux : ceux posés par 044 (niveau-comite, niveau-club…).
insert into public.hb_units (id, data) values
  ('unite-83', '{"id":"unite-83","levelId":"niveau-comite","name":"Comité fictif","departments":["83"]}'),
  ('club-1', '{"id":"club-1","levelId":"niveau-club","name":"Club fictif","parentId":"unite-83","clubNumber":"6383015"}');
insert into public.hb_assignments (id, data) values
  ('aff-c', '{"id":"aff-c","userId":"00000000-0000-0000-0000-0000000000c1","unitId":"unite-83","role":"preparateur"}'),
  ('aff-d', '{"id":"aff-d","userId":"00000000-0000-0000-0000-0000000000d1","unitId":"club-1","role":"observateur"}');

-- Données fictives, écrites en super-utilisateur (les colonnes de périmètre sont posées par les déclencheurs de 046/048).
insert into public.hb_players (id, data) values
  ('p1', '{"id":"p1","firstName":"Prénom","lastName":"Fictif","clubCode":"6383015","createdBy":"00000000-0000-0000-0000-0000000000d1"}'),
  ('p2', '{"id":"p2","firstName":"Autre","lastName":"Fictif","department":"13","createdBy":"00000000-0000-0000-0000-0000000000c1"}'),
  ('p3', '{"id":"p3","firstName":"Ultra","lastName":"Marin","license":"6401002123456"}');
insert into public.hb_teams (id, data) values ('staff-1', '{"id":"staff-1","name":"Staff fictif","members":["00000000-0000-0000-0000-0000000000c1","00000000-0000-0000-0000-0000000000b8"],"createdBy":"00000000-0000-0000-0000-0000000000a1"}');
insert into public.hb_evaluations (id, data) values ('ev1', '{"id":"ev1","playerId":"p1","scores":{},"createdBy":"00000000-0000-0000-0000-0000000000d1"}'),
  ('ev2', '{"id":"ev2","playerId":"inconnu","scores":{},"createdBy":"00000000-0000-0000-0000-0000000000b9"}');
insert into public.hb_measurements (id, data) values ('m1', '{"id":"m1","playerId":"p3","value":180,"createdBy":"00000000-0000-0000-0000-0000000000b9"}');
insert into public.hb_seen (id, data) values ('s1', '{"id":"s1","playerId":"p2","createdBy":"00000000-0000-0000-0000-0000000000b9"}');
insert into public.hb_rewatch (id, data) values ('r1', '{"id":"r1","playerId":"p1","createdBy":"00000000-0000-0000-0000-0000000000b9"}');
insert into public.hb_videos (id, data) values ('v1', '{"id":"v1","targetKind":"player","targetId":"p2","createdBy":"00000000-0000-0000-0000-0000000000b9"}'), ('v2', '{"id":"v2","targetKind":"event","targetId":"e1","createdBy":"00000000-0000-0000-0000-0000000000b9"}');
insert into public.hb_follows (id, data) values ('f1', '{"id":"f1","kind":"player","targetId":"p1","createdBy":"00000000-0000-0000-0000-0000000000b9"}');
insert into public.hb_saved_questions (id, data) values ('00000000-0000-0000-0000-0000000000b9:q1', '{"id":"00000000-0000-0000-0000-0000000000b9:q1","name":"Question","createdBy":"00000000-0000-0000-0000-0000000000b9"}');
insert into public.hb_groups (id, data) values
  ('g1', '{"id":"g1","name":"Privé","private":true,"createdBy":"00000000-0000-0000-0000-0000000000b9"}'),
  ('g2', '{"id":"g2","name":"Équipe","team":true,"editors":["00000000-0000-0000-0000-0000000000b2"],"teams":["staff-1"],"createdBy":"00000000-0000-0000-0000-0000000000b9"}'),
  ('g3', '{"id":"g3","name":"Partagé","createdBy":"00000000-0000-0000-0000-0000000000b9"}');
insert into public.hb_alerts (id, data) values ('a1', '{"id":"a1","private":true,"createdBy":"00000000-0000-0000-0000-0000000000b9"}'), ('a2', '{"id":"a2","createdBy":"00000000-0000-0000-0000-0000000000b9"}');
insert into public.hb_events (id, data) values
  ('e1', '{"id":"e1","name":"Sans organisateur","playerIds":["p1"],"createdBy":"00000000-0000-0000-0000-0000000000b9"}'),
  ('e2', '{"id":"e2","name":"Stage","organizerUnitId":"unite-83","playerIds":["p1","p2"],"editors":["00000000-0000-0000-0000-0000000000b2"],"teams":["staff-1"],"createdBy":"00000000-0000-0000-0000-0000000000b9"}'),
  ('e3', '{"id":"e3","name":"Stage du club","organizerUnitId":"club-1","playerIds":["p3"],"createdBy":"00000000-0000-0000-0000-0000000000b9"}');
insert into public.hb_criteria (id, data) values ('c1', '{"id":"c1","label":"Vision du jeu"}');
insert into public.hb_config (id, data) values ('cfg1', '{"id":"cfg1","key":"x","value":1}');
insert into public.hb_lists (id, data) values ('l1', '{"id":"l1","name":"Liste"}');
insert into public.hb_question_log (id, data) values ('ql1', '{"id":"ql1","question":"?"}');

-- ---------- Règles sur realtime.messages : envoi (insert) et écoute (select), comme Realtime à l'abonnement ----------
create function pg_temp.peut_emettre(p_uid text, p_topic text, p_ext text default 'broadcast') returns boolean
language plpgsql as $$
begin
  begin
    perform set_config('test.uid', coalesce(p_uid, ''), true);
    perform set_config('realtime.topic', p_topic, true);
    set local role authenticated;
    insert into realtime.messages (topic, extension, event, payload, private) values (p_topic, p_ext, 'signal', '{"t":"players"}', true);
    raise exception using errcode = 'P0001', message = 'essai_annule';
  exception
    when insufficient_privilege then return false;
    when raise_exception then
      if sqlerrm = 'essai_annule' then return true; end if;
      raise;
  end;
end $$;
create function pg_temp.peut_ecouter(p_uid text, p_topic text) returns boolean
language plpgsql as $$
declare v boolean;
begin
  insert into realtime.messages (topic, extension, event, payload, private) values (p_topic, 'broadcast', 'signal', '{}', true);
  begin
    perform set_config('test.uid', coalesce(p_uid, ''), true);
    perform set_config('realtime.topic', p_topic, true);
    set local role authenticated;
    select exists (select 1 from realtime.messages where topic = p_topic) into v;
    raise exception using errcode = 'P0001', message = 'essai_annule';
  exception when raise_exception then
    if sqlerrm = 'essai_annule' then return v; end if;
    raise;
  end;
end $$;

do $$
declare
  admin text := '00000000-0000-0000-0000-0000000000a1';
  comite text := '00000000-0000-0000-0000-0000000000c1';
  club text := '00000000-0000-0000-0000-0000000000d1';
  jeune text := '00000000-0000-0000-0000-0000000000e1';
  sansrole text := '00000000-0000-0000-0000-0000000000f1';
  n integer := 0;
begin
  -- Ses canaux : autorisé.
  assert pg_temp.peut_emettre(club, 'hb:club:6383015'), 'club : son club'; n := n + 1;
  assert pg_temp.peut_emettre(club, 'hb:staff'), 'club : staff'; n := n + 1;
  assert pg_temp.peut_emettre(club, 'hb:commun'), 'club : commun'; n := n + 1;
  assert pg_temp.peut_emettre(club, 'hb:compte:' || club), 'club : son compte'; n := n + 1;
  assert pg_temp.peut_emettre(comite, 'hb:dept:83'), 'comité : son département'; n := n + 1;
  assert pg_temp.peut_emettre(admin, 'hb:tout'), 'admin : tout'; n := n + 1;
  assert pg_temp.peut_emettre(jeune, 'hb:joueur:p1'), 'joueur : sa fiche'; n := n + 1;
  -- Ailleurs : refusé.
  assert not pg_temp.peut_emettre(club, 'hb:tout'), 'club : pas tout'; n := n + 1;
  assert not pg_temp.peut_emettre(club, 'hb:dept:83'), 'club : pas le département du comité'; n := n + 1;
  assert not pg_temp.peut_emettre(club, 'hb:club:6383099'), 'club : pas un autre club'; n := n + 1;
  assert not pg_temp.peut_emettre(club, 'hb:compte:' || comite), 'club : pas le compte d''un autre'; n := n + 1;
  assert not pg_temp.peut_emettre(comite, 'hb:dept:13'), 'comité : pas un autre département'; n := n + 1;
  assert not pg_temp.peut_emettre(comite, 'hb:tout'), 'comité : pas tout'; n := n + 1;
  assert not pg_temp.peut_emettre(admin, 'hb:dept:83'), 'admin : tout, pas les départements'; n := n + 1;
  assert not pg_temp.peut_emettre(jeune, 'hb:staff'), 'joueur : pas le staff'; n := n + 1;
  assert not pg_temp.peut_emettre(jeune, 'hb:joueur:p2'), 'joueur : pas une autre fiche'; n := n + 1;
  assert not pg_temp.peut_emettre(sansrole, 'hb:staff'), 'sans rôle : pas le staff'; n := n + 1;
  assert not pg_temp.peut_emettre(null, 'hb:commun'), 'sans compte : rien'; n := n + 1;
  assert not pg_temp.peut_emettre(club, 'hb:x'), 'canal inconnu'; n := n + 1;
  -- Seulement « broadcast » (pas presence) sur ses canaux.
  assert not pg_temp.peut_emettre(club, 'hb:club:6383015', 'presence'), 'club : pas presence'; n := n + 1;
  -- Écoute inchangée (hb_recevoir) : ses canaux seulement.
  assert pg_temp.peut_ecouter(club, 'hb:club:6383015'), 'écoute : son club'; n := n + 1;
  assert not pg_temp.peut_ecouter(club, 'hb:tout'), 'écoute : pas tout'; n := n + 1;
  assert pg_temp.peut_ecouter(comite, 'hb:dept:83'), 'écoute : son département'; n := n + 1;
  assert not pg_temp.peut_ecouter(comite, 'hb:dept:13'), 'écoute : pas un autre département'; n := n + 1;
  raise notice 'règles d''envoi et d''écoute : % assertions', n;
end $$;

-- ---------- Écritures : plus aucun message envoyé par la base ----------
do $$
declare
  avant bigint := (select count(*) from realtime.messages);
  refus jsonb;
begin
  -- Encadrant du comité : une fiche de son département ; administrateur : un critère (table de contenu).
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', true);
  set local role authenticated;
  select to_jsonb(public.hb_upsert('players', '[{"id":"p4","data":{"id":"p4","firstName":"Nouveau","lastName":"Fictif","clubCode":"6383015","updatedAt":5},"updated_at_client":5,"deleted":false}]'::jsonb)) into refus;
  reset role;
  assert refus = '[]'::jsonb, 'fiche du comité acceptée : ' || refus::text;
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  select to_jsonb(public.hb_upsert('criteria', '[{"id":"c2","data":{"id":"c2","label":"Placement"},"updated_at_client":5,"deleted":false}]'::jsonb)) into refus;
  assert refus = '[]'::jsonb, 'critère de l''administrateur accepté : ' || refus::text;
  reset role;
  assert (select count(*) from public.hb_players where id = 'p4') = 1 and (select count(*) from public.hb_criteria where id = 'c2') = 1, 'lignes écrites';
  assert (select count(*) from realtime.messages) = avant, 'aucun message envoyé par la base';
  -- Annonce de version : toujours possible (SQL direct).
  perform set_config('test.uid', '', true);
  perform public.hb_annoncer_version('essai');
  assert (select count(*) from realtime.messages where topic = 'hb:commun' and event = 'version') = 1, 'annonce de version';
  raise notice 'écritures (comité, administrateur) sans message de la base ; annonce de version : ok';
end $$;

-- ---------- « Quoi de neuf ? » et canaux : toujours là ----------
do $$
declare v jsonb; c text[];
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000d1', true);
  set local role authenticated;
  v := public.hb_quoi_de_neuf('{"players": "2020-01-01T00:00:00Z", "inconnue": "x"}'::jsonb);
  c := public.hb_mes_canaux();
  reset role;
  assert v = '{"players": true}'::jsonb, 'quoi de neuf : ' || v::text;
  assert c @> array['hb:commun', 'hb:staff', 'hb:club:6383015', 'hb:compte:00000000-0000-0000-0000-0000000000d1'] and not c @> array['hb:tout'], 'mes canaux : ' || c::text;
  raise notice 'quoi de neuf et mes canaux : ok';
end $$;

-- ---------- « Quoi de neuf ? » : les seules affectations du compte (clé « mes_affectations », 29/10) ----------
-- Affectations existantes ramenées loin dans le passé (déclencheurs coupés), puis une nouvelle pour le comité, maintenant :
-- la table a changé, mais rien parmi celles du club.
set session_replication_role = replica;
update public.hb_assignments set server_updated_at = '2026-01-01T00:00:00Z';
set session_replication_role = default;
insert into public.hb_assignments (id, data) values
  ('aff-c2', '{"id":"aff-c2","userId":"00000000-0000-0000-0000-0000000000c1","unitId":"club-1","role":"observateur"}');
do $$
declare
  comite text := '00000000-0000-0000-0000-0000000000c1';
  club text := '00000000-0000-0000-0000-0000000000d1';
  jeune text := '00000000-0000-0000-0000-0000000000e1';
  vieux jsonb := '{"mes_affectations": "2026-06-01T00:00:00Z", "assignments": "2026-06-01T00:00:00Z"}';
  recent jsonb := jsonb_build_object('mes_affectations', now()::text);
  v jsonb;
  n integer := 0;
begin
  perform set_config('test.uid', club, true);
  set local role authenticated;
  v := public.hb_quoi_de_neuf(vieux);
  reset role;
  assert v = '{"assignments": true, "mes_affectations": false}'::jsonb, 'club, curseur ancien : ' || v::text; n := n + 1;
  perform set_config('test.uid', comite, true);
  set local role authenticated;
  v := public.hb_quoi_de_neuf(vieux);
  reset role;
  assert v = '{"assignments": true, "mes_affectations": true}'::jsonb, 'comité, curseur ancien : ' || v::text; n := n + 1;
  -- Curseur récent : recouvrement de 60 s (l'affectation du comité, posée il y a quelques secondes, compte encore).
  set local role authenticated;
  v := public.hb_quoi_de_neuf(recent);
  reset role;
  assert v = '{"mes_affectations": true}'::jsonb, 'comité, curseur récent : ' || v::text; n := n + 1;
  perform set_config('test.uid', club, true);
  set local role authenticated;
  v := public.hb_quoi_de_neuf(recent);
  reset role;
  assert v = '{"mes_affectations": false}'::jsonb, 'club, curseur récent : ' || v::text; n := n + 1;
  -- Sans curseur : à relire.
  set local role authenticated;
  v := public.hb_quoi_de_neuf('{"mes_affectations": ""}'::jsonb);
  reset role;
  assert v = '{"mes_affectations": true}'::jsonb, 'club, sans curseur : ' || v::text; n := n + 1;
  -- Compte joueur : la structure ne lui est pas lisible (051) : rien.
  perform set_config('test.uid', jeune, true);
  set local role authenticated;
  v := public.hb_quoi_de_neuf('{"mes_affectations": "2020-01-01T00:00:00Z"}'::jsonb);
  reset role;
  assert v = '{"mes_affectations": false}'::jsonb, 'joueur : ' || v::text; n := n + 1;
  raise notice 'quoi de neuf, mes affectations : % assertions', n;
end $$;

-- Colonne user_id (copie de data.userId) : son index sert SOUS LES RÈGLES DE LECTURE (égalité de textes, leakproof), alors
-- que « data ->> 'userId' » ne peut pas servir d'index pour un compte (opérateur non leakproof) : parcours de toute la table.
do $$
declare
  club text := '00000000-0000-0000-0000-0000000000d1';
  r text;
  v_col boolean := false;
  v_json boolean := false;
begin
  perform set_config('test.uid', club, true);
  set local role authenticated;
  set local enable_seqscan = off;
  for r in execute format('explain select id, data, server_updated_at from public.hb_assignments where user_id = %L and server_updated_at >= %L order by server_updated_at, id limit 1000', club, '1970-01-01') loop
    if r like '%Index Cond: ((user_id = %' then v_col := true; end if;
  end loop;
  for r in execute format('explain select id, data, server_updated_at from public.hb_assignments where (data ->> ''userId'') = %L and server_updated_at >= %L order by server_updated_at, id limit 1000', club, '1970-01-01') loop
    if r like '%Index Cond: (((data ->> ''userId''::text) = %' then v_json := true; end if;
  end loop;
  reset enable_seqscan;
  reset role;
  assert v_col, 'lecture de ses affectations : index (user_id, server_updated_at, id) utilisé sous les règles';
  assert not v_json, 'data->>userId sous les règles : pas d''index (d''où la colonne)';
  assert (select user_id from public.hb_assignments where id = 'aff-d') = club, 'colonne = data.userId';
  update public.hb_assignments set data = data || jsonb_build_object('userId', club) where id = 'aff-c2';
  assert (select user_id from public.hb_assignments where id = 'aff-c2') = club, 'colonne suivie à la modification';
  raise notice 'quoi de neuf, mes affectations : colonne user_id et index utilisables sous les règles de lecture : ok';
end $$;
