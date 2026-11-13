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
  -- Compte joueur ou sans rôle : il n'écrit jamais, il n'émet sur aucun canal (même les siens).
  assert not pg_temp.peut_emettre(jeune, 'hb:joueur:p1'), 'joueur : pas même sa fiche'; n := n + 1;
  assert not pg_temp.peut_emettre(jeune, 'hb:commun'), 'joueur : pas le commun'; n := n + 1;
  assert not pg_temp.peut_emettre(jeune, 'hb:compte:' || jeune), 'joueur : pas son compte'; n := n + 1;
  assert not pg_temp.peut_emettre(sansrole, 'hb:commun'), 'sans rôle : pas le commun'; n := n + 1;
  assert not pg_temp.peut_emettre(sansrole, 'hb:compte:' || sansrole), 'sans rôle : pas son compte'; n := n + 1;
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
  assert pg_temp.peut_ecouter(jeune, 'hb:joueur:p1') and pg_temp.peut_ecouter(jeune, 'hb:commun'), 'écoute : le joueur écoute toujours les siens'; n := n + 1;
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

-- ---------- hb_upsert_lignes : écrire et renvoyer les lignes enregistrées (ligne dans le signal, série 5 du 29/10) ----------
do $$
declare
  comite text := '00000000-0000-0000-0000-0000000000c1';
  club text := '00000000-0000-0000-0000-0000000000d1';
  v jsonb;
  l jsonb;
  gros text := (select string_agg(md5(i::text), '') from generate_series(1, 1000) i);
  n integer := 0;
begin
  -- Encadrant du comité : une mesure sur p1 (club 6383015, département 83) : acceptée, renvoyée telle qu'enregistrée.
  perform set_config('test.uid', comite, true);
  set local role authenticated;
  v := public.hb_upsert_lignes('measurements', '[{"id":"m2","data":{"id":"m2","playerId":"p1","criterionId":"taille","value":182,"updatedAt":10},"updated_at_client":10,"deleted":false}]'::jsonb);
  reset role;
  assert v -> 'refusees' = '[]'::jsonb, 'mesure acceptée : ' || v::text; n := n + 1;
  assert jsonb_array_length(v -> 'lignes') = 1, 'une ligne renvoyée : ' || v::text; n := n + 1;
  l := v -> 'lignes' -> 0;
  assert l ->> 'id' = 'm2' and (l -> 'data' ->> 'value')::numeric = 182 and l -> 'deleted' = 'false'::jsonb, 'contenu : ' || l::text; n := n + 1;
  assert l ->> 'scope_dept' = '83' and l ->> 'scope_club' = '6383015', 'périmètre de la ligne (046) : ' || l::text; n := n + 1;
  assert l -> 'data' ->> 'createdBy' = comite, 'signature posée par le serveur (hb_stamp) : ' || l::text; n := n + 1;
  assert (l ->> 'server_updated_at')::timestamptz = (select server_updated_at from public.hb_measurements where id = 'm2'), 'heure serveur enregistrée'; n := n + 1;
  assert l -> 'data' = (select data from public.hb_measurements where id = 'm2'), 'data = la ligne enregistrée'; n := n + 1;
  -- Même ligne, version plus ancienne : refusée (comme hb_upsert), rien de renvoyé.
  set local role authenticated;
  v := public.hb_upsert_lignes('measurements', '[{"id":"m2","data":{"id":"m2","playerId":"p1","value":1,"updatedAt":5},"updated_at_client":5,"deleted":false}]'::jsonb);
  reset role;
  assert v = '{"refusees": ["m2"], "lignes": null}'::jsonb, 'version plus ancienne : ' || v::text; n := n + 1;
  -- Plus de lignes acceptées que p_max : écrites, mais aucune renvoyée (un import : l'appli n'envoie que des identifiants).
  set local role authenticated;
  v := public.hb_upsert_lignes('measurements', '[{"id":"m3","data":{"id":"m3","playerId":"p1","value":170,"updatedAt":10},"updated_at_client":10,"deleted":false},
                                                {"id":"m4","data":{"id":"m4","playerId":"p1","value":171,"updatedAt":10},"updated_at_client":10,"deleted":false}]'::jsonb, 1);
  reset role;
  assert v = '{"refusees": [], "lignes": null}'::jsonb and (select count(*) from public.hb_measurements where id in ('m3', 'm4')) = 2, 'au-delà de p_max : ' || v::text; n := n + 1;
  -- Ligne trop grosse (taille stockée > p_octets) : écrite, pas renvoyée ; la petite du même paquet l'est.
  set local role authenticated;
  v := public.hb_upsert_lignes('measurements', jsonb_build_array(
         jsonb_build_object('id', 'm5', 'data', jsonb_build_object('id', 'm5', 'playerId', 'p1', 'value', 1, 'note', gros, 'updatedAt', 10), 'updated_at_client', 10, 'deleted', false),
         jsonb_build_object('id', 'm6', 'data', jsonb_build_object('id', 'm6', 'playerId', 'p1', 'value', 2, 'updatedAt', 10), 'updated_at_client', 10, 'deleted', false)), 20, 6000);
  reset role;
  assert v -> 'refusees' = '[]'::jsonb and (select count(*) from public.hb_measurements where id in ('m5', 'm6')) = 2, 'deux lignes écrites : ' || v::text; n := n + 1;
  assert (select array_agg(x ->> 'id') from jsonb_array_elements(v -> 'lignes') x) = array['m6'], 'seule la petite revient : ' || (v -> 'lignes')::text; n := n + 1;
  -- Relecture avec les règles de lecture de CELUI QUI ÉCRIT (SECURITY INVOKER) : un avis du journal des questions, que
  -- l'encadrant crée mais ne peut pas relire (lecture réservée aux administrateurs, 043), est accepté mais pas renvoyé.
  set local role authenticated;
  v := public.hb_upsert_lignes('question_log', '[{"id":"qa1","data":{"id":"qa1","kind":"avis","questionId":"q1","verdict":"super","updatedAt":10},"updated_at_client":10,"deleted":false}]'::jsonb);
  reset role;
  assert v = '{"refusees": [], "lignes": []}'::jsonb and (select count(*) from public.hb_question_log where id = 'qa1') = 1, 'journal : écrit, pas relu : ' || v::text; n := n + 1;
  assert (select not prosecdef from pg_proc where proname = 'hb_upsert_lignes'), 'SECURITY INVOKER'; n := n + 1;
  -- Table sans colonnes de périmètre : pas de scope_* ; table inconnue : l'erreur de hb_upsert.
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  v := public.hb_upsert_lignes('criteria', '[{"id":"c3","data":{"id":"c3","label":"Duel","updatedAt":10},"updated_at_client":10,"deleted":false}]'::jsonb);
  reset role;
  assert jsonb_array_length(v -> 'lignes') = 1 and not (v -> 'lignes' -> 0 ? 'scope_dept'), 'critère : ' || v::text; n := n + 1;
  begin
    set local role authenticated;
    v := public.hb_upsert_lignes('profiles', '[]'::jsonb);
    reset role;
    assert false, 'table inconnue acceptée';
  exception when raise_exception then
    reset role;
    assert sqlerrm like 'Table inconnue%', sqlerrm;
  end;
  n := n + 1;
  -- Compte de club : une mesure sur p2 (département 13, hors de son périmètre) : refusée par hb_scope (046), rien renvoyé.
  perform set_config('test.uid', club, true);
  set local role authenticated;
  v := public.hb_upsert_lignes('measurements', '[{"id":"m7","data":{"id":"m7","playerId":"p2","value":3,"updatedAt":10},"updated_at_client":10,"deleted":false}]'::jsonb);
  reset role;
  assert v = '{"refusees": ["m7"], "lignes": null}'::jsonb, 'hors périmètre : ' || v::text; n := n + 1;
  raise notice 'hb_upsert_lignes (ligne dans le signal) : % assertions', n;
end $$;

-- ---------- Ligne dans le signal : tout abonné d'un canal où la ligne voyage peut la lire par la synchronisation normale ----------
-- Pour chaque compte (administrateur, comité, club, joueur, sans rôle) et chaque ligne des quatre tables dont le contenu
-- voyage (joueurs, mesures, avis, « vu ») : si un de SES canaux (hb_mes_canaux) est un canal où la ligne voyage (hb:tout,
-- hb:dept:<scope_dept>, hb:club:<scope_club>, hb:compte:<auteur> ; src/syncLive.ts, serverRowChannels et rowFitsTopic), il
-- DOIT la voir avec ses règles de lecture. Les lignes écrites par un compte qui peut écrire (rôle du staff) seulement : un
-- compte sans rôle ou joueur n'écrit pas, et ne peut émettre sur aucun canal (règle hb_emettre).
create temp table nx_voyage as
  select x.t, x.id, array_remove(array['hb:tout', 'hb:dept:' || x.scope_dept, 'hb:club:' || x.scope_club,
                                       'hb:compte:' || (x.data ->> 'createdBy')], null) as canaux
    from (select 'players' t, id, data, scope_dept, scope_club from public.hb_players
          union all select 'measurements', id, data, scope_dept, scope_club from public.hb_measurements
          union all select 'evaluations', id, data, scope_dept, scope_club from public.hb_evaluations
          union all select 'seen', id, data, scope_dept, scope_club from public.hb_seen) x;
grant select on nx_voyage to authenticated;
do $$
declare
  u text;
  c text[];
  attendus int;
  vus int;
  n integer := 0;
  total int := 0;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1',
                           '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1'] loop
    perform set_config('test.uid', u, true);
    set local role authenticated;
    c := public.hb_mes_canaux();
    select count(*) into attendus from nx_voyage v where v.canaux && c;
    select count(*) into vus from nx_voyage v where v.canaux && c and (
         (v.t = 'players' and exists (select 1 from public.hb_players p where p.id = v.id))
      or (v.t = 'measurements' and exists (select 1 from public.hb_measurements p where p.id = v.id))
      or (v.t = 'evaluations' and exists (select 1 from public.hb_evaluations p where p.id = v.id))
      or (v.t = 'seen' and exists (select 1 from public.hb_seen p where p.id = v.id)));
    reset role;
    assert vus = attendus, format('compte %s : %s lignes sur ses canaux, %s lisibles', u, attendus, vus); n := n + 1;
    total := total + attendus;
  end loop;
  -- Le jeu couvre les cas : l'administrateur (tout), le comité (83), le club (6383015) reçoivent des lignes ; le club ne
  -- reçoit rien du 13 ni du 971.
  assert total >= 10, 'jeu trop maigre : ' || total;
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000d1', true);
  set local role authenticated;
  c := public.hb_mes_canaux();
  reset role;
  assert not exists (select 1 from nx_voyage v join public.hb_seen s on s.id = v.id where v.canaux && c and s.scope_dept = '13'), 'club : rien du 13';
  -- Contre-essai : « à revoir » (règle de lecture plus étroite que le périmètre : son auteur, son staff, les administrateurs,
  -- 041) ne doit JAMAIS porter son contenu : le comité écoute hb:dept:83, où r1 (joueur p1) voyagerait, mais ne le lit pas.
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', true);
  set local role authenticated;
  c := public.hb_mes_canaux();
  assert 'hb:dept:83' = any (c) and not exists (select 1 from public.hb_rewatch where id = 'r1'), 'à revoir : canal du 83 sans droit de lecture';
  reset role;
  assert (select scope_dept from public.hb_rewatch where id = 'r1') = '83', 'r1 est bien du 83';
  raise notice 'ligne dans le signal : canal ⇒ droit de lecture vérifié pour % comptes (% lignes reçues au total)', n, total;
end $$;
