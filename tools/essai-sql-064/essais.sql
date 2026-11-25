-- Essais de supabase/064_auto_evaluation.sql (lancer.sh) : comptes, fiches et événements FICTIFS. Toute erreur arrête.
-- Le jeune : voit SES événements concernés (pas une observation, pas un événement à venir, supprimé ou dont il n'est pas sur
-- la liste), écrit seulement les siennes (jamais pour un autre), dans la fenêtre (jour même → 14 jours), lit seulement les
-- siennes ; aucune écriture directe (jeune, staff, administrateur) ; staff : selon le périmètre de la fiche ; anon : rien ;
-- tout vide : retirée ; notes et textes nettoyés ; fusion de fiches : elles suivent la fiche gardée ; effacement RGPD et
-- suppression définitive : elles partent.
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
  ('00000000-0000-0000-0000-0000000000e3', 'jeune3@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'comite83@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000c3', 'comite13@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune1@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e2', 'jeune2@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e3', 'jeune3@exemple.test', 'joueur')
on conflict (user_id) do update set role = excluded.role;
update public.hb_profiles set player_id = 'j-1' where user_id = '00000000-0000-0000-0000-0000000000e1';
update public.hb_profiles set player_id = 'j-2' where user_id = '00000000-0000-0000-0000-0000000000e2';
-- e3 : compte joueur SANS fiche reliée.

-- Structure fictive : ligue (13, 83) → comité du 83, comité du 13.
insert into public.hb_units (id, data) values
  ('ligue-sud', '{"id":"ligue-sud","levelId":"niveau-ligue","name":"Ligue fictive","departments":["13","83"]}'),
  ('unite-83', '{"id":"unite-83","levelId":"niveau-comite","name":"Comité fictif 83","parentId":"ligue-sud","departments":["83"]}'),
  ('unite-13', '{"id":"unite-13","levelId":"niveau-comite","name":"Comité fictif 13","parentId":"ligue-sud","departments":["13"]}');
insert into public.hb_assignments (id, data) values
  ('aff-c1', '{"id":"aff-c1","userId":"00000000-0000-0000-0000-0000000000c1","unitId":"unite-83","role":"preparateur"}'),
  ('aff-c3', '{"id":"aff-c3","userId":"00000000-0000-0000-0000-0000000000c3","unitId":"unite-13","role":"preparateur"}');

-- Fiches : j-1 et j-3 dans le 83, j-2 dans le 13.
insert into public.hb_players (id, data) values
  ('j-1', '{"id":"j-1","firstName":"Prénom","lastName":"Fictif Un","clubCode":"6383015"}'),
  ('j-2', '{"id":"j-2","firstName":"Prénom","lastName":"Fictif Deux","clubCode":"6313001"}'),
  ('j-3', '{"id":"j-3","firstName":"Prénom","lastName":"Fictif Trois","clubCode":"6383020"}');

-- Événements, datés par rapport à aujourd'hui (heure de Paris).
create temporary table jours as select (now() at time zone 'Europe/Paris')::date as auj;
grant select on jours to authenticated;
insert into public.hb_events (id, data, deleted)
select x.id, jsonb_build_object('id', x.id, 'name', x.name, 'type', x.type, 'date', to_char(j.auj + x.n, 'YYYY-MM-DD'),
                                'place', 'Salle fictive', 'playerIds', x.ids), x.del
  from jours j, (values
    ('ev-ok', 'Tournoi fictif', 'tournoi', -3, '["j-1","j-2"]'::jsonb, false),
    ('ev-auj', 'Match du jour', 'match', 0, '["j-1"]'::jsonb, false),
    ('ev-14', 'Stage fictif', 'entrainement', -14, '["j-1"]'::jsonb, false),
    ('ev-15', 'Match fictif ancien', 'match', -15, '["j-1"]'::jsonb, false),
    ('ev-futur', 'Stage à venir', 'entrainement', 5, '["j-1"]'::jsonb, false),
    ('ev-obs', 'Observation fictive', 'observation', -2, '["j-1"]'::jsonb, false),
    ('ev-autre', 'Match d''un autre', 'match', -1, '["j-2","j-3"]'::jsonb, false),
    ('ev-suppr', 'Match supprimé', 'match', -2, '["j-1"]'::jsonb, true),
    ('ev-vieux', 'Tournoi d''il y a longtemps', 'tournoi', -90, '["j-1"]'::jsonb, false)
  ) as x(id, name, type, n, ids, del);

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

do $$
declare
  a1 text := '00000000-0000-0000-0000-0000000000a1';
  c1 text := '00000000-0000-0000-0000-0000000000c1';
  c3 text := '00000000-0000-0000-0000-0000000000c3';
  d2 text := '00000000-0000-0000-0000-0000000000d2';
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  e2 text := '00000000-0000-0000-0000-0000000000e2';
  e3 text := '00000000-0000-0000-0000-0000000000e3';
  save text := 'select public.hb_player_selfeval_save(%L, %L::jsonb, %L, %L)';
  liste text := 'select public.hb_player_selfeval_events()';
  lu text;
begin
  -- ---------- Ses événements ----------
  lu := essai.vu(e1, 'select string_agg(x ->> ''eventId'' || '':'' || (x ->> ''open''), '','' order by x ->> ''date'' desc) from jsonb_array_elements(public.hb_player_selfeval_events()) x');
  perform essai.attendu('jeune 1 : ses événements (jour même, 3 j, 14 j ouverts ; 15 j fermé ; ni à venir, ni observation, ni supprimé, ni d''un autre, ni plus de 60 j)',
    lu, 'ev-auj:true,ev-ok:true,ev-14:true,ev-15:false');
  perform essai.attendu('… sans la liste des joueurs (aucun autre identifiant de fiche)',
    essai.vu(e1, 'select (' || liste || ')::text ~ ''playerIds|j-2|j-3''')::text, 'false');
  perform essai.attendu('… nom, type, date, lieu et dernier jour donnés',
    essai.vu(e1, 'select x ->> ''name'' || ''|'' || (x ->> ''type'') || ''|'' || (x ? ''place'')::text || ''|'' || ((x ->> ''until'')::date - (x ->> ''date'')::date) from jsonb_array_elements(public.hb_player_selfeval_events()) x where x ->> ''eventId'' = ''ev-ok'''),
    'Tournoi fictif|tournoi|true|14');
  perform essai.attendu('jeune 2 : les siens', essai.vu(e2, 'select string_agg(x ->> ''eventId'', '','' order by x ->> ''eventId'') from jsonb_array_elements(public.hb_player_selfeval_events()) x'), 'ev-autre,ev-ok');
  perform essai.attendu('compte joueur sans fiche : refusé', essai.vu(e3, liste), 'ERR P0001 sans_fiche');
  perform essai.attendu('staff : pas une fonction pour lui', essai.vu(c1, liste), 'ERR P0001 pas_joueur');
  perform essai.attendu('anon : refusé', essai.vu(null, liste), 'ERR 42501 permission denied for function hb_player_selfeval_events');

  -- ---------- Enregistrer ----------
  perform essai.attendu('jeune 1 : tournoi d''il y a 3 jours',
    essai.vu(e1, format(save, 'ev-ok', '{"engagement":4,"plaisir":7,"bidule":3,"progres":2.5,"collectif":"5","concentration":5}', E'  Mes passes\u0007 décisives  ', 'Le repli défensif')),
    (select (jsonb_build_object('eventId', 'ev-ok', 'eventType', 'tournoi', 'eventDate', to_char(auj - 3, 'YYYY-MM-DD'), 'eventName', 'Tournoi fictif',
                               'scores', '{"engagement":4,"concentration":5}'::jsonb, 'good', 'Mes passes décisives', 'work', 'Le repli défensif',
                               'at', public.hb_self_iso(now())))::text from jours));
  perform essai.attendu('… une ligne, à SA fiche, notes nettoyées (clés connues, entiers 1 à 5)',
    (select string_agg(player_id || ' ' || scores::text, ';') from public.hb_player_selfeval), 'j-1 {"engagement": 4, "concentration": 5}');
  perform essai.attendu('… le compte qui a écrit est noté', (select user_id::text from public.hb_player_selfeval where player_id = 'j-1'), e1);
  perform essai.attendu('modifiée (une seule par événement)', essai.comme(e1, format(save, 'ev-ok', '{"engagement":5}', 'Mes passes', null)), '1');
  perform essai.attendu('… toujours une ligne, nouvelle version', (select count(*) || ' ' || scores::text || ' ' || coalesce(work, '-') from public.hb_player_selfeval where player_id = 'j-1' group by scores, work), '1 {"engagement": 5} -');
  perform essai.attendu('jour même : permis', essai.comme(e1, format(save, 'ev-auj', '{"plaisir":5}', null, null)), '1');
  perform essai.attendu('14 jours après : encore permis', essai.comme(e1, format(save, 'ev-14', '{"progres":3}', null, 'Mes appuis')), '1');
  perform essai.attendu('15 jours après : fermé', essai.vu(e1, format(save, 'ev-15', '{"plaisir":4}', null, null)), 'ERR P0001 fenetre_fermee');
  perform essai.attendu('à venir : pas encore', essai.vu(e1, format(save, 'ev-futur', '{"plaisir":4}', null, null)), 'ERR P0001 pas_encore');
  perform essai.attendu('observation : refusé (sans rien en dire)', essai.vu(e1, format(save, 'ev-obs', '{"plaisir":4}', null, null)), 'ERR P0001 evenement_inconnu');
  perform essai.attendu('pas sur la liste : refusé', essai.vu(e1, format(save, 'ev-autre', '{"plaisir":4}', null, null)), 'ERR P0001 evenement_inconnu');
  perform essai.attendu('événement supprimé : refusé', essai.vu(e1, format(save, 'ev-suppr', '{"plaisir":4}', null, null)), 'ERR P0001 evenement_inconnu');
  perform essai.attendu('événement inconnu : refusé', essai.vu(e1, format(save, 'nimporte', '{"plaisir":4}', null, null)), 'ERR P0001 evenement_inconnu');
  perform essai.attendu('entrée trop longue : refusée', essai.vu(e1, format(save, 'ev-ok', '{"plaisir":4}', repeat('x', 5000), null)), 'ERR P0001 trop_long');
  perform essai.attendu('texte coupé à 300 caractères', essai.comme(e1, format(save, 'ev-auj', '{}', repeat('é', 400), null)), '1');
  perform essai.attendu('… 300', (select length(good)::text from public.hb_player_selfeval where player_id = 'j-1' and event_id = 'ev-auj'), '300');
  perform essai.attendu('compte sans fiche : refusé', essai.vu(e3, format(save, 'ev-ok', '{"plaisir":4}', null, null)), 'ERR P0001 sans_fiche');
  perform essai.attendu('staff : refusé (il n''en écrit jamais)', essai.vu(c1, format(save, 'ev-ok', '{"plaisir":4}', null, null)), 'ERR P0001 pas_joueur');
  perform essai.attendu('administrateur : refusé aussi', essai.vu(a1, format(save, 'ev-ok', '{"plaisir":4}', null, null)), 'ERR P0001 pas_joueur');
  perform essai.attendu('anon : refusé', essai.vu(null, format(save, 'ev-ok', '{"plaisir":4}', null, null)), 'ERR 42501 permission denied for function hb_player_selfeval_save');

  -- Jamais pour un autre : le jeune 2 écrit la sienne sur le même tournoi ; celle du jeune 1 ne bouge pas.
  perform essai.attendu('jeune 2 : la sienne, sur le même tournoi', essai.comme(e2, format(save, 'ev-ok', '{"plaisir":3}', null, null)), '1');
  perform essai.attendu('jeune 2 : un match où le jeune 1 n''est pas', essai.comme(e2, format(save, 'ev-autre', '{"collectif":4}', 'Mon placement', null)), '1');
  perform essai.attendu('… celle du jeune 1 intacte', (select scores::text from public.hb_player_selfeval where player_id = 'j-1' and event_id = 'ev-ok'), '{"engagement": 5}');
  perform essai.attendu('… lignes par fiche', (select string_agg(player_id || '=' || n, ',' order by player_id) from (select player_id, count(*) n from public.hb_player_selfeval group by 1) s), 'j-1=3,j-2=2');

  -- ---------- Aucune écriture directe ----------
  perform essai.attendu('jeune : insertion directe refusée', essai.comme(e1, $q$insert into public.hb_player_selfeval (player_id, event_id, event_type, event_date) values ('j-2', 'ev-autre', 'match', current_date)$q$), 'ERR 42501 permission denied for table hb_player_selfeval');
  perform essai.attendu('jeune : modification directe refusée', essai.comme(e1, $q$update public.hb_player_selfeval set good = 'x'$q$), 'ERR 42501 permission denied for table hb_player_selfeval');
  perform essai.attendu('jeune : suppression directe refusée', essai.comme(e1, $q$delete from public.hb_player_selfeval$q$), 'ERR 42501 permission denied for table hb_player_selfeval');
  perform essai.attendu('staff : modification directe refusée', essai.comme(c1, $q$update public.hb_player_selfeval set good = 'x'$q$), 'ERR 42501 permission denied for table hb_player_selfeval');
  perform essai.attendu('administrateur : insertion directe refusée', essai.comme(a1, $q$insert into public.hb_player_selfeval (player_id, event_id, event_type, event_date) values ('j-1', 'ev-x', 'match', current_date)$q$), 'ERR 42501 permission denied for table hb_player_selfeval');

  -- ---------- Lecture ----------
  perform essai.attendu('jeune 1 : lit les siennes', essai.comme(e1, 'select * from public.hb_player_selfeval'), '3');
  perform essai.attendu('jeune 1 : pas celles du jeune 2', essai.comme(e1, $q$select * from public.hb_player_selfeval where player_id = 'j-2'$q$), '0');
  perform essai.attendu('jeune 2 : les siennes', essai.comme(e2, 'select * from public.hb_player_selfeval'), '2');
  perform essai.attendu('compte joueur sans fiche : rien', essai.comme(e3, 'select * from public.hb_player_selfeval'), '0');
  perform essai.attendu('administrateur : toutes', essai.comme(a1, 'select * from public.hb_player_selfeval'), '5');
  perform essai.attendu('comité du 83 : celles de j-1 (son périmètre)', essai.comme(c1, 'select * from public.hb_player_selfeval'), '3');
  perform essai.attendu('… pas celles de j-2 (13 : hors périmètre)', essai.comme(c1, $q$select * from public.hb_player_selfeval where player_id = 'j-2'$q$), '0');
  perform essai.attendu('comité du 13 : celles de j-2 seulement', essai.vu(c3, $q$select string_agg(player_id || ':' || event_id, ',' order by event_id) from public.hb_player_selfeval$q$), 'j-2:ev-autre,j-2:ev-ok');
  perform essai.attendu('observateur sans affectation : rien', essai.comme(d2, 'select * from public.hb_player_selfeval'), '0');
  perform essai.attendu('anon : refusé', essai.comme(null, 'select * from public.hb_player_selfeval'), 'ERR 42501 permission denied for table hb_player_selfeval');
  perform essai.attendu('pas dans les avis (hb_evaluations reste vide)', (select count(*)::text from public.hb_evaluations), '0');
  -- Retirée du staff de l'événement plus tard : la sienne reste, en lecture seule (open = false), avec le nom recopié.
  update public.hb_events set data = jsonb_set(data, '{playerIds}', '["j-2"]') where id = 'ev-14';
  perform essai.attendu('plus sur la liste : gardée, fermée',
    essai.vu(e1, 'select x ->> ''open'' || ''|'' || (x ->> ''name'') || ''|'' || (x -> ''mine'' ->> ''work'') from jsonb_array_elements(public.hb_player_selfeval_events()) x where x ->> ''eventId'' = ''ev-14'''),
    'false|Stage fictif|Mes appuis');
  perform essai.attendu('… et plus modifiable', essai.vu(e1, format(save, 'ev-14', '{"progres":4}', null, null)), 'ERR P0001 evenement_inconnu');

  -- ---------- Tout vide : retirée ----------
  perform essai.attendu('tout vide : rien rendu', coalesce(essai.vu(e1, format(save, 'ev-auj', '{"bidule":2}', '   ', E'\n')), 'null'), 'null');
  perform essai.attendu('… ligne retirée', (select count(*)::text from public.hb_player_selfeval where player_id = 'j-1' and event_id = 'ev-auj'), '0');

  -- ---------- Fusion : elles suivent la fiche gardée (celle de la fiche gardée prime pour un même événement) ----------
  perform essai.attendu('fusion j-2 → j-1 (administrateur)', essai.comme(a1, $q$select public.hb_merge_players('j-2', 'j-1')$q$), '1');
  perform essai.attendu('… lignes par fiche après fusion', (select string_agg(player_id || ':' || event_id, ',' order by event_id) from public.hb_player_selfeval), 'j-1:ev-14,j-1:ev-autre,j-1:ev-ok');
  perform essai.attendu('… même tournoi : celle de la fiche gardée', (select scores::text from public.hb_player_selfeval where player_id = 'j-1' and event_id = 'ev-ok'), '{"engagement": 5}');

  -- ---------- Effacement RGPD, suppression définitive ----------
  insert into public.hb_player_selfeval (player_id, event_id, event_type, event_date, scores) values ('j-3', 'ev-autre', 'match', current_date, '{"plaisir":4}');
  update public.hb_players set data = data || '{"purged":true}' where id = 'j-1';
  perform essai.attendu('fiche effacée (RGPD) : les siennes partent', (select count(*)::text from public.hb_player_selfeval where player_id = 'j-1'), '0');
  perform essai.attendu('… pas celles des autres', (select count(*)::text from public.hb_player_selfeval where player_id = 'j-3'), '1');
  delete from public.hb_players where id = 'j-3';
  perform essai.attendu('fiche supprimée définitivement : les siennes partent', (select count(*)::text from public.hb_player_selfeval), '0');
end $$;

-- La table refuse une forme abîmée, même écrite par le propriétaire.
do $$
begin
  begin
    insert into public.hb_player_selfeval (player_id, event_id, event_type, event_date, scores) values ('j-9', 'ev-ok', 'match', current_date, '{"plaisir":9}');
    raise exception 'ÉCHEC : note 9 acceptée';
  exception when check_violation then
    raise notice 'ok : note hors échelle refusée par la table';
  end;
  begin
    insert into public.hb_player_selfeval (player_id, event_id, event_type, event_date, scores) values ('j-9', 'ev-obs', 'observation', current_date, '{}');
    raise exception 'ÉCHEC : observation acceptée';
  exception when check_violation then
    raise notice 'ok : observation refusée par la table';
  end;
end $$;
