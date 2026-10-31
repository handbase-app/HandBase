-- Essais de supabase/060_push_veille.sql (lancer.sh). Comptes, structure, staffs et événements FICTIFS.
-- PREUVES :
--  1. hb_veille_destinataires rend exactement les comptes attendus (créateur, participants, membres d'un staff choisi, avec
--     un rôle du staff) pour les seuls événements du lendemain ni supprimés ni archivés ; pas un compte qui voit l'événement
--     seulement par son territoire, pas un compte joueur, pas un ancien membre sans rôle, pas un membre d'un staff supprimé ;
--  2. pour CHAQUE ligne rendue, le compte lit l'événement sous les règles de lecture (RLS de hb_events, 048) ;
--  3. hb_veille_prendre : seulement les comptes avec un appareil abonné et « Rappel la veille » non coupé ; un seul envoi par
--     personne et par jour (deuxième appel : rien) ; plusieurs événements = plusieurs lignes du même compte (regroupées à
--     l'envoi) ; hb_veille_bilan note le bilan ;
--  4. droits : l'appli (authenticated, anon) ne peut ni lister ni réserver ni lire les envois ; la clé de service peut ;
--  5. hb_push_subscribe : adresse https seulement, clés vérifiées, appareil déduit, 10 appareils au plus par compte.
-- Toute erreur d'assertion arrête le script.
\set ON_ERROR_STOP 1

-- ---------- Comptes ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000060a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000060b1', 'encadrant@exemple.test'),
  ('00000000-0000-0000-0000-0000000060c1', 'observateur-staff@exemple.test'),
  ('00000000-0000-0000-0000-0000000060c2', 'observateur-sans-rappel@exemple.test'),
  ('00000000-0000-0000-0000-0000000060d1', 'ancien@exemple.test'),
  ('00000000-0000-0000-0000-0000000060e1', 'jeune@exemple.test'),
  ('00000000-0000-0000-0000-0000000060f1', 'comite@exemple.test'),
  ('00000000-0000-0000-0000-0000000060f2', 'staff-supprime@exemple.test'),
  ('00000000-0000-0000-0000-0000000060f3', 'createur-archive@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000060a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000060b1', 'encadrant@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000060c1', 'observateur-staff@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000060c2', 'observateur-sans-rappel@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000060d1', 'ancien@exemple.test', null),
  ('00000000-0000-0000-0000-0000000060e1', 'jeune@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000060f1', 'comite@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000060f2', 'staff-supprime@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000060f3', 'createur-archive@exemple.test', 'preparateur')
on conflict (user_id) do update set role = excluded.role;
update public.hb_profiles set notif = '{"rappel": false}' where user_id = '00000000-0000-0000-0000-0000000060c2';

-- Structure fictive : un comité du 83 (le compte « comite » y est affecté), un club du 13 (hors du comité).
insert into public.hb_units (id, data) values
  ('u60-comite', '{"id":"u60-comite","levelId":"niveau-comite","name":"Comité fictif","departments":["83"]}'),
  ('u60-club13', '{"id":"u60-club13","levelId":"niveau-club","name":"Club fictif","clubNumber":"6313999"}');
insert into public.hb_assignments (id, data) values
  ('a60-c', '{"id":"a60-c","userId":"00000000-0000-0000-0000-0000000060f1","unitId":"u60-comite","role":"preparateur"}');

-- Staffs : t60-1 (observateur-staff et observateur-sans-rappel), t60-2 supprimé (staff-supprime).
insert into public.hb_teams (id, data) values
  ('t60-1', '{"id":"t60-1","name":"Staff fictif","members":["00000000-0000-0000-0000-0000000060c1","00000000-0000-0000-0000-0000000060c2"]}');
insert into public.hb_teams (id, data, deleted) values
  ('t60-2', '{"id":"t60-2","name":"Staff supprimé","members":["00000000-0000-0000-0000-0000000060f2"]}', true);

-- ---------- Événements (jour d'envoi : 2026-11-13 ; lendemain : 2026-11-14) ----------
insert into public.hb_events (id, data) values
  -- Détection du comité (territoire 83) : créée par l'admin ; participants : encadrant, ancien (sans rôle), jeune (compte
  -- joueur) ; staff t60-1 ; le compte « comite » la voit par territoire (pas concerné).
  ('e60-1', jsonb_build_object('id', 'e60-1', 'name', 'Détection U13', 'date', '2026-11-14', 'time', '9:30',
     'organizerUnitId', 'u60-comite', 'createdBy', '00000000-0000-0000-0000-0000000060a1',
     'editors', jsonb_build_array('00000000-0000-0000-0000-0000000060b1', '00000000-0000-0000-0000-0000000060d1',
                                  '00000000-0000-0000-0000-0000000060e1'),
     'teams', jsonb_build_array('t60-1', 't60-2'), 'playerIds', jsonb_build_array('j-1', 'j-2'))),
  -- Stage d'un club du 13, hors du périmètre de l'encadrant (seulement participant) ; nom très long ; heure illisible.
  ('e60-2', jsonb_build_object('id', 'e60-2', 'name', repeat('Stage de perfectionnement des gardiens ', 3), 'date', '2026-11-14',
     'time', 'matin', 'organizerUnitId', 'u60-club13', 'createdBy', '00000000-0000-0000-0000-0000000060f3',
     'editors', jsonb_build_array('00000000-0000-0000-0000-0000000060b1'))),
  -- Demain mais archivé ; demain mais supprimé ; après-demain ; aujourd'hui : jamais.
  ('e60-3', jsonb_build_object('id', 'e60-3', 'name', 'Archivé', 'date', '2026-11-14', 'archived', true,
     'createdBy', '00000000-0000-0000-0000-0000000060f3')),
  ('e60-5', jsonb_build_object('id', 'e60-5', 'name', 'Après-demain', 'date', '2026-11-15', 'createdBy', '00000000-0000-0000-0000-0000000060a1')),
  ('e60-6', jsonb_build_object('id', 'e60-6', 'name', 'Aujourd''hui', 'date', '2026-11-13', 'createdBy', '00000000-0000-0000-0000-0000000060a1')),
  -- Demain, sans nom, créateur illisible, aucun participant : personne.
  ('e60-7', jsonb_build_object('id', 'e60-7', 'date', '2026-11-14', 'createdBy', 'n''importe quoi'));
insert into public.hb_events (id, data, deleted) values
  ('e60-4', jsonb_build_object('id', 'e60-4', 'name', 'Supprimé', 'date', '2026-11-14', 'createdBy', '00000000-0000-0000-0000-0000000060a1'), true);

-- ---------- 1. Destinataires ----------
do $$
declare
  got text;
  want text := '00000000-0000-0000-0000-0000000060a1 e60-1 Détection U13 09:30'
     || ' | 00000000-0000-0000-0000-0000000060b1 e60-1 Détection U13 09:30'
     || ' | 00000000-0000-0000-0000-0000000060b1 e60-2 ' || left(repeat('Stage de perfectionnement des gardiens ', 3), 60) || ' -'
     || ' | 00000000-0000-0000-0000-0000000060c1 e60-1 Détection U13 09:30'
     || ' | 00000000-0000-0000-0000-0000000060c2 e60-1 Détection U13 09:30'
     || ' | 00000000-0000-0000-0000-0000000060f3 e60-2 ' || left(repeat('Stage de perfectionnement des gardiens ', 3), 60) || ' -';
begin
  select string_agg(user_id || ' ' || event_id || ' ' || nom || ' ' || coalesce(heure, '-'), ' | ' order by user_id, event_id)
    into got from public.hb_veille_destinataires('2026-11-13');
  if got is distinct from want then raise exception 'ÉCHEC destinataires : obtenu « % », attendu « % »', got, want; end if;
  if exists (select 1 from public.hb_veille_destinataires('2026-11-13')
              where user_id in ('00000000-0000-0000-0000-0000000060d1', '00000000-0000-0000-0000-0000000060e1',
                                '00000000-0000-0000-0000-0000000060f1', '00000000-0000-0000-0000-0000000060f2')) then
    raise exception 'ÉCHEC : ancien membre, compte joueur, comité (territoire) ou staff supprimé rendu';
  end if;
  if (select count(*) from public.hb_veille_destinataires('2026-11-12')) <> 1 then
    raise exception 'ÉCHEC : la veille du 13 doit rendre le seul créateur de l''événement du 13';
  end if;
  if exists (select 1 from public.hb_veille_destinataires('2026-11-11')) then raise exception 'ÉCHEC : rien le 12'; end if;
  raise notice '1. destinataires : 6 lignes attendues, exactes (créateur, participant, staff ; exclus : sans rôle, joueur, territoire, staff supprimé, archivé, supprimé, autres jours)';
end $$;

-- ---------- 2. Chaque destinataire lit l'événement sous les règles de lecture ----------
do $$
declare
  r record;
  n integer;
  checked integer := 0;
begin
  for r in select * from public.hb_veille_destinataires('2026-11-13') loop
    perform set_config('test.uid', r.user_id::text, true);
    perform set_config('hb.scope_cache', '', true);
    set local role authenticated;
    select count(*) into n from public.hb_events where id = r.event_id;
    reset role;
    if n <> 1 then raise exception 'ÉCHEC règles de lecture : % ne lit pas %', r.user_id, r.event_id; end if;
    checked := checked + 1;
  end loop;
  -- Contre-essai : le comité voit e60-1 par son territoire (preuve que l'essai lit vraiment sous RLS), pas e60-2.
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000060f1', true);
  perform set_config('hb.scope_cache', '', true);
  set local role authenticated;
  select count(*) into n from public.hb_events where id in ('e60-1', 'e60-2');
  reset role;
  if n <> 1 then raise exception 'ÉCHEC contre-essai : le comité devrait voir 1 des 2 événements (vu %)', n; end if;
  raise notice '2. règles de lecture : % lignes, chaque compte lit son événement sous RLS ; contre-essai ok', checked;
end $$;

-- ---------- 5. Abonnements (avant 3 : les comptes abonnés) ----------
do $$
declare
  i integer;
  k text := 'BOrf1Zr6mVqXyL0xGH8uAa2Wc3Ds4Ft5Gu6Hv7Iw8Jx9Ky0Lz1Ma2Nb3Oc4Pd5Qe6Rf7Sg8Th9Ui0Vj1Wk2Xl3Ym4Zn5';
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000060b1', true);
  set local role authenticated;
  begin
    perform public.hb_push_subscribe('http://exemple.test/x', k, 'AbCdEfGhIjKlMnOp', 'Mozilla/5.0 (Linux; Android 14)');
    raise exception 'ÉCHEC : adresse http acceptée';
  exception when raise_exception then
    if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    perform public.hb_push_subscribe('https://127.0.0.1@interne/x', k, 'AbCdEfGhIjKlMnOp', null);
    raise exception 'ÉCHEC : adresse avec @ acceptée';
  exception when raise_exception then
    if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  begin
    perform public.hb_push_subscribe('https://push.exemple.test/a', 'court', 'AbCdEfGhIjKlMnOp', null);
    raise exception 'ÉCHEC : clé trop courte acceptée';
  exception when raise_exception then
    if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;
  -- 12 appareils : les 10 plus récents restent.
  for i in 1 .. 12 loop
    perform public.hb_push_subscribe('https://push.exemple.test/b' || i, k, 'AbCdEfGhIjKlMnOp', 'Mozilla/5.0 (Linux; Android 14)');
    perform pg_sleep(0.002);
  end loop;
  reset role;
  if (select count(*) from public.hb_push_subs where user_id = '00000000-0000-0000-0000-0000000060b1') <> 10 then
    raise exception 'ÉCHEC : 10 appareils au plus';
  end if;
  if exists (select 1 from public.hb_push_subs where endpoint in ('https://push.exemple.test/b1', 'https://push.exemple.test/b2')) then
    raise exception 'ÉCHEC : les plus anciens devaient être oubliés';
  end if;
  if (select appareil from public.hb_push_subs where endpoint = 'https://push.exemple.test/b12') <> 'Android' then
    raise exception 'ÉCHEC : appareil';
  end if;
  -- Abonnés : admin, observateur-staff, observateur-sans-rappel (préférence coupée), comité (pas concerné).
  insert into public.hb_push_subs (endpoint, user_id, p256dh, auth) values
    ('https://push.exemple.test/a1', '00000000-0000-0000-0000-0000000060a1', k, 'AbCdEfGhIjKlMnOp'),
    ('https://push.exemple.test/a1bis', '00000000-0000-0000-0000-0000000060a1', k, 'AbCdEfGhIjKlMnOp'),
    ('https://push.exemple.test/c1', '00000000-0000-0000-0000-0000000060c1', k, 'AbCdEfGhIjKlMnOp'),
    ('https://push.exemple.test/c2', '00000000-0000-0000-0000-0000000060c2', k, 'AbCdEfGhIjKlMnOp'),
    ('https://push.exemple.test/f1', '00000000-0000-0000-0000-0000000060f1', k, 'AbCdEfGhIjKlMnOp');
  raise notice '5. abonnements : https seulement, clés vérifiées, appareil déduit, 10 par compte';
end $$;

-- ---------- 3. Réservation : un seul envoi par personne et par jour ----------
do $$
declare
  got text;
  n integer;
begin
  -- Par lots : 1 personne (la première dans l'ordre : événement le plus tôt, puis compte), puis 2, puis plus personne.
  select string_agg(user_id || ' ' || event_id, ' | ' order by user_id, event_id) into got from public.hb_veille_prendre('2026-11-13', 1);
  if got is distinct from '00000000-0000-0000-0000-0000000060a1 e60-1' then raise exception 'ÉCHEC lot 1 : %', got; end if;
  select string_agg(user_id || ' ' || event_id, ' | ' order by user_id, event_id) into got from public.hb_veille_prendre('2026-11-13', 2);
  if got is distinct from '00000000-0000-0000-0000-0000000060b1 e60-1 | 00000000-0000-0000-0000-0000000060b1 e60-2 | 00000000-0000-0000-0000-0000000060c1 e60-1' then
    raise exception 'ÉCHEC lot 2 (toutes les lignes de chaque personne du lot) : %', got;
  end if;
  if (select evenements from public.hb_veille_envois where user_id = '00000000-0000-0000-0000-0000000060b1' and jour = '2026-11-13') <> 2 then
    raise exception 'ÉCHEC : 2 événements notés pour l''encadrant';
  end if;
  select count(*) into n from public.hb_veille_prendre('2026-11-13');
  if n <> 0 then raise exception 'ÉCHEC : deuxième appel le même jour : % lignes', n; end if;
  -- Un nouvel abonné le même soir (après la première tâche) est servi par la tâche suivante, une fois.
  update public.hb_profiles set notif = '{}' where user_id = '00000000-0000-0000-0000-0000000060c2';
  select count(*) into n from public.hb_veille_prendre('2026-11-13');
  if n <> 1 then raise exception 'ÉCHEC : rattrapage d''un compte non servi : % lignes', n; end if;
  select count(*) into n from public.hb_veille_prendre('2026-11-13');
  if n <> 0 then raise exception 'ÉCHEC : rattrapage servi deux fois'; end if;
  -- Bilan.
  n := public.hb_veille_bilan('2026-11-13', '[{"u":"00000000-0000-0000-0000-0000000060a1","a":2,"e":1},{"u":"pas-un-compte","a":1,"e":1}]');
  if n <> 1 or (select envoyes from public.hb_veille_envois where user_id = '00000000-0000-0000-0000-0000000060a1' and jour = '2026-11-13') <> 1 then
    raise exception 'ÉCHEC bilan';
  end if;
  raise notice '3. réservation : abonnés et préférence respectés, par lots dans l''ordre (1 puis 2), un envoi par personne et par jour, 2 événements = 2 lignes, bilan noté';
end $$;

-- ---------- 4. Droits ----------
do $$
declare
  r text;
  denied integer := 0;
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000060a1', true);
  foreach r in array array['authenticated', 'anon'] loop
    execute format('set local role %I', r);
    begin perform * from public.hb_veille_destinataires('2026-11-13'); exception when insufficient_privilege then denied := denied + 1; end;
    begin perform * from public.hb_veille_prendre('2026-11-14'); exception when insufficient_privilege then denied := denied + 1; end;
    begin perform public.hb_veille_bilan('2026-11-13', '[]'); exception when insufficient_privilege then denied := denied + 1; end;
    begin perform * from public.hb_veille_envois; exception when insufficient_privilege then denied := denied + 1; end;
    begin perform * from public.hb_push_subs; exception when insufficient_privilege then denied := denied + 1; end;
    reset role;
  end loop;
  if denied <> 10 then raise exception 'ÉCHEC droits : % refus sur 10', denied; end if;
  set local role service_role;
  perform * from public.hb_veille_destinataires('2026-11-13');
  perform * from public.hb_veille_envois;
  reset role;
  raise notice '4. droits : appli (authenticated, anon) refusée 10 fois sur 10 ; clé de service acceptée';
end $$;
