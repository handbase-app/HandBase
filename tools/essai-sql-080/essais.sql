-- Essais de supabase/080_alertes_wellness.sql (lancer.sh), APRÈS les comptes, fiches et groupes FICTIFS de
-- tools/essai-sql-073/essais.sql (reprise jusqu'à ses essais : comptes a1, c1, c2, c3, c4, d2, e1…e6 ; fiches j-1…j-6 ; groupes
-- g1 (c1, participant c2, wellness : j-1, j-2, j-3), g2, g3, gd, gp (groupe Pôle de c1, wellness : j-4)). Toute erreur arrête.
-- Réglages personnels (lecture et écriture des siennes seulement, staff seulement, 20 au plus, règle et nom nettoyés) ;
-- calcul pour le compte connecté : seulement ses suivis dont il lit le wellness (073), cible groupe ou tous, alerte éteinte
-- ignorée, groupe « suivi par le staff » ; wellness fermé : rien ; résumé du matin (un par compte, sans nom ni note, une
-- seule fois par jour, préférence coupée, résumé d'un autre jour retiré) ; droits des fonctions.
\set ON_ERROR_STOP 1

do $$
declare
  a1 text := '00000000-0000-0000-0000-0000000000a1';
  c1 text := '00000000-0000-0000-0000-0000000000c1';
  c2 text := '00000000-0000-0000-0000-0000000000c2';
  c4 text := '00000000-0000-0000-0000-0000000000c4';
  d2 text := '00000000-0000-0000-0000-0000000000d2';
  auj date := public.hb_wl_auj();
  dem date[] := public.hb_wla_jours_demandes(public.hb_wl_auj() - 30, public.hb_wl_auj() - 1);
  r1 date;
  r2 date;
  r3 date;
  ins text := 'insert into public.hb_wellness_alertes (nom, regle, cible, actif) values (%L, %L::jsonb, %L, %L)';
  moi text := 'select public.hb_wellness_alertes_moi()::text';
  v jsonb;
  noms text;
  i int;
begin
  r1 := dem[array_length(dem, 1)];
  r2 := dem[array_length(dem, 1) - 1];
  r3 := dem[array_length(dem, 1) - 2];
  insert into public.hb_config (id, data) values ('wellness', '{"id":"wellness","key":"wellness","value":{"actif":true}}')
    on conflict (id) do update set data = excluded.data, deleted = false;

  -- Réponses : j-1 à 3 (douleur aujourd'hui et la veille demandée), j-2 à 8, j-3 à 3 (lu par personne sauf l'admin),
  -- j-4 jamais (espace joueur relié : « pas de réponse »).
  insert into public.hb_wellness (player_id, jour, scores, douleur, douleurs)
  select p, d, case when p = 'j-2' then '{"energie":8,"fraicheur":8,"humeur":8,"sommeil":8}'::jsonb else '{"energie":3,"fraicheur":3,"humeur":3,"sommeil":3}'::jsonb end,
         p = 'j-1' and d in (auj, r1),
         case when p = 'j-1' and d in (auj, r1) then '[{"zone":"genou","cote":"g","type":"gene","intensite":3}]'::jsonb else '[]'::jsonb end
    from unnest(array['j-1', 'j-2', 'j-3']) p, unnest(array[auj, r1, r2, r3]) d;

  -- Suivis : c1 suit j-1, j-4, j-5 et le groupe g1 (j-1, j-2, j-3) ; c4 suit j-1 (pas du staff d'un groupe du wellness) ;
  -- l'administrateur suit j-3.
  insert into public.hb_follows (id, data) values
    (c1 || ':player:j-1', jsonb_build_object('id', c1 || ':player:j-1', 'kind', 'player', 'targetId', 'j-1', 'createdBy', c1)),
    (c1 || ':player:j-4', jsonb_build_object('id', c1 || ':player:j-4', 'kind', 'player', 'targetId', 'j-4', 'createdBy', c1)),
    (c1 || ':player:j-5', jsonb_build_object('id', c1 || ':player:j-5', 'kind', 'player', 'targetId', 'j-5', 'createdBy', c1)),
    (c1 || ':group:g1', jsonb_build_object('id', c1 || ':group:g1', 'kind', 'group', 'targetId', 'g1', 'createdBy', c1)),
    (c4 || ':player:j-1', jsonb_build_object('id', c4 || ':player:j-1', 'kind', 'player', 'targetId', 'j-1', 'createdBy', c4)),
    (a1 || ':player:j-3', jsonb_build_object('id', a1 || ':player:j-3', 'kind', 'player', 'targetId', 'j-3', 'createdBy', a1));

  -- ---------- Réglages : les siens, staff seulement ----------
  perform essai.attendu('c1 : alerte « A » (seuil, tous)', essai.comme(c1, format(ins, 'A', '{"type":"seuil","note":"moyenne","max":5,"jours":3}', null, true)), '1');
  perform essai.attendu('c1 : alerte « B » (douleur, groupe g1)', essai.comme(c1, format(ins, 'B', '{"type":"douleur","jours":1}', 'g1', true)), '1');
  perform essai.attendu('c1 : alerte « C » (pas de réponse, groupe g1)', essai.comme(c1, format(ins, 'C', '{"type":"silence","jours":2}', 'g1', true)), '1');
  perform essai.attendu('c1 : alerte « D » (pas de réponse, tous)', essai.comme(c1, format(ins, '  D  ', '{"type":"silence","jours":2,"bidule":1}', '', true)), '1');
  perform essai.attendu('c1 : alerte « E » éteinte', essai.comme(c1, format(ins, 'E', '{"type":"douleur","jours":1}', null, false)), '1');
  perform essai.attendu('nom et règle nettoyés, cible vide = tous',
    (select nom || ' ' || regle::text || ' ' || coalesce(cible, 'tous') from public.hb_wellness_alertes where nom = 'D'), 'D {"type": "silence", "jours": 2} tous');
  perform essai.attendu('règle abîmée : refusée', essai.comme(c1, format(ins, 'X', '{"type":"seuil","note":"moyenne","max":12,"jours":3}', null, true)), 'ERR P0001 regle');
  perform essai.attendu('sorte inconnue : refusée', essai.comme(c1, format(ins, 'X', '{"type":"blessure","jours":3}', null, true)), 'ERR P0001 regle');
  perform essai.attendu('nom vide : refusé', essai.comme(c1, format(ins, '   ', '{"type":"douleur","jours":1}', null, true)), 'ERR P0001 nom');
  perform essai.attendu('observateur : refusé',
    left(essai.comme(d2, format(ins, 'O', '{"type":"douleur","jours":1}', null, true)), 9), 'ERR 42501');
  perform essai.attendu('compte joueur : refusé',
    left(essai.comme('00000000-0000-0000-0000-0000000000e1', format(ins, 'O', '{"type":"douleur","jours":1}', null, true)), 9), 'ERR 42501');
  perform essai.attendu('anon : refusé', left(essai.comme(null, format(ins, 'O', '{"type":"douleur","jours":1}', null, true)), 9), 'ERR 42501');
  perform essai.attendu('écrire pour un autre compte : la ligne reste au sien',
    essai.comme(c1, $q$insert into public.hb_wellness_alertes (user_id, nom, regle) values ('00000000-0000-0000-0000-0000000000c4', 'F', '{"type":"douleur","jours":1}')$q$), '1');
  perform essai.attendu('… elle est à c1', (select user_id::text from public.hb_wellness_alertes where nom = 'F'), c1);
  delete from public.hb_wellness_alertes where nom = 'F';
  perform essai.attendu('c4 : alerte « G » (seuil, tous)', essai.comme(c4, format(ins, 'G', '{"type":"seuil","note":"moyenne","max":5,"jours":3}', null, true)), '1');
  perform essai.attendu('c4 ne voit que les siennes', essai.vu(c4, 'select string_agg(nom, '','') from public.hb_wellness_alertes'), 'G');
  perform essai.attendu('administrateur : ne voit pas celles des autres', essai.vu(a1, 'select count(*)::text from public.hb_wellness_alertes'), '0');
  perform essai.attendu('c4 ne modifie pas celles de c1', essai.comme(c4, $q$update public.hb_wellness_alertes set nom = 'pris'$q$), '1');
  perform essai.attendu('… seulement la sienne', (select string_agg(nom, ',' order by nom) from public.hb_wellness_alertes), 'A,B,C,D,E,pris');
  perform essai.attendu('c4 ne supprime pas celles de c1', essai.comme(c4, $q$delete from public.hb_wellness_alertes where nom = 'A'$q$), '0');
  perform essai.attendu('c4 : sa propre alerte, renommée', essai.comme(c4, $q$update public.hb_wellness_alertes set nom = 'G', user_id = '00000000-0000-0000-0000-0000000000c1'$q$), '1');
  perform essai.attendu('… le compte ne change jamais', (select user_id::text from public.hb_wellness_alertes where nom = 'G'), c4);
  for i in 1 .. 19 loop perform essai.comme(c4, format(ins, 'N' || i, '{"type":"douleur","jours":1}', null, true)); end loop;
  perform essai.attendu('20 alertes au plus par compte', essai.comme(c4, format(ins, 'N20', '{"type":"douleur","jours":1}', null, true)), 'ERR P0001 trop_d_alertes');
  delete from public.hb_wellness_alertes where nom like 'N%';

  -- ---------- Calcul pour le compte connecté ----------
  v := essai.vu(c1, moi)::jsonb;
  perform essai.attendu('c1 : wellness ouvert', v ->> 'actif', 'true');
  perform essai.attendu('c1 : suivis lus = j-1, j-2 (g1), j-4 (Pôle) ; ni j-3 (hors du périmètre du créateur de g1) ni j-5 (sans wellness)',
    (v -> 'lus')::text, '["j-1", "j-2", "j-4"]');
  select string_agg(a.nom || ':' || (x ->> 'joueur'), ',' order by a.nom, x ->> 'joueur') into noms
    from jsonb_array_elements(v -> 'alertes') x join public.hb_wellness_alertes a on a.id::text = x ->> 'alerte';
  perform essai.attendu('c1 : A sur j-1 (3 jours à 3), B sur j-1 (douleur, dans g1), D sur j-4 (pas de réponse) ; C ne vise que g1, E éteinte',
    noms, 'A:j-1,B:j-1,D:j-4');
  perform essai.attendu('… jours de suite : au moins la durée réglée',
    (select bool_and((x ->> 'jours')::int >= case a.nom when 'A' then 3 when 'B' then 1 else 2 end)::text
       from jsonb_array_elements(v -> 'alertes') x join public.hb_wellness_alertes a on a.id::text = x ->> 'alerte'), 'true');
  perform essai.attendu('… jamais une note ni une douleur dans la réponse', (v::text ~ 'scores|energie|douleur|pain|genou')::text, 'false');
  perform essai.attendu('c4 (suit j-1, pas du staff d''un groupe du wellness) : rien', essai.vu(c4, 'select ((public.hb_wellness_alertes_moi() -> ''lus'') || (public.hb_wellness_alertes_moi() -> ''alertes''))::text'), '[]');
  perform essai.attendu('administrateur (suit j-3, pas d''alerte réglée) : j-3 lu, aucune alerte',
    essai.vu(a1, 'select (public.hb_wellness_alertes_moi() -> ''lus'')::text || (public.hb_wellness_alertes_moi() -> ''alertes'')::text'), '["j-3"][]');
  perform essai.comme(a1, format(ins, 'H', '{"type":"seuil","note":"sommeil","max":4,"jours":2}', null, true));
  perform essai.attendu('administrateur : son alerte sur j-3', essai.vu(a1, 'select jsonb_array_length(public.hb_wellness_alertes_moi() -> ''alertes'')::text'), '1');
  -- Groupe « suivi par le staff » : c2, participant de g1, le suit sans ligne de suivi.
  perform essai.comme(c2, format(ins, 'I', '{"type":"seuil","note":"moyenne","max":5,"jours":3}', null, true));
  perform essai.attendu('c2 sans suivi : rien', essai.vu(c2, 'select (public.hb_wellness_alertes_moi() -> ''lus'')::text'), '[]');
  update public.hb_groups set data = data || '{"teamFollow":true}' where id = 'g1';
  perform essai.attendu('c2, g1 suivi par le staff : j-1 et j-2 lus, alerte sur j-1',
    essai.vu(c2, 'select (public.hb_wellness_alertes_moi() -> ''lus'')::text || (select string_agg(x ->> ''joueur'', '','') from jsonb_array_elements(public.hb_wellness_alertes_moi() -> ''alertes'') x)'),
    '["j-1", "j-2"]j-1');
  update public.hb_groups set data = data - 'teamFollow' where id = 'g1';
  -- « Pas de réponse » : jamais avant que le wellness soit demandé (wellnessSince du groupe Pôle).
  update public.hb_groups set data = data || jsonb_build_object('wellnessSince', to_char(auj, 'YYYY-MM-DD')) where id = 'gp';
  perform essai.attendu('pas de réponse : rien avant le jour où le wellness est demandé',
    essai.vu(c1, 'select (select count(*) from jsonb_array_elements(public.hb_wellness_alertes_moi() -> ''alertes'') x where x ->> ''joueur'' = ''j-4'')::text'), '0');
  update public.hb_groups set data = data - 'wellnessSince' where id = 'gp';
  -- Wellness fermé : rien.
  update public.hb_config set data = '{"id":"wellness","key":"wellness","value":{"actif":false}}' where id = 'wellness';
  perform essai.attendu('wellness fermé : rien', essai.vu(c1, 'select public.hb_wellness_alertes_moi()::text')::jsonb - 'jour' #>> '{}', '{"lus": [], "actif": false, "alertes": []}');
  update public.hb_config set data = '{"id":"wellness","key":"wellness","value":{"actif":true}}' where id = 'wellness';

  -- ---------- Droits ----------
  perform essai.attendu('anon : pas de calcul', left(essai.vu(null, moi), 9), 'ERR 42501');
  perform essai.attendu('appli : pas de calcul pour un autre compte', left(essai.vu(c4, format('select public.hb_wla_calcul(%L)::text', c1)), 9), 'ERR 42501');
  perform essai.attendu('appli : pas de résumé à la demande', left(essai.vu(c1, 'select public.hb_wellness_alertes_quotidien(true)::text'), 9), 'ERR 42501');
  perform essai.attendu('préférence « wellness » acceptée', essai.comme(c1, 'select public.hb_set_notif_prefs(''{"wellness":true,"bidule":true}'')'), '1');
  perform essai.attendu('… gardée (et la clé inconnue retirée)', (select notif::text from public.hb_profiles where user_id::text = c1), '{"wellness": true}');

  -- ---------- Résumé du matin ----------
  insert into public.hb_push_subs (endpoint, user_id, p256dh, auth) values ('https://exemple.test/abonnement-c1', c1::uuid, 'cle', 'secret');
  insert into public.hb_push_subs (endpoint, user_id, p256dh, auth) values ('https://exemple.test/abonnement-c4', c4::uuid, 'cle', 'secret');
  insert into public.hb_notifications (user_id, kind, group_key, title, body, url) values (c1::uuid, 'wellness', 'wellness:2000-01-01', 'Alertes wellness', 'vieux', '/suivis');
  perform essai.attendu('hors de 8 h ou forcé : un seul résumé (c1 ; c4 n''a pas d''alerte en cours)', public.hb_wellness_alertes_quotidien(true)::text, '1');
  perform essai.attendu('… sans nom ni note, lien vers Mes suivis',
    (select title || ' | ' || body || ' | ' || url || ' | ' || group_key from public.hb_notifications where kind = 'wellness' and user_id::text = c1),
    'Alertes wellness | 3 alertes wellness sur tes suivis | /suivis | wellness:' || to_char(auj, 'YYYY-MM-DD'));
  perform essai.attendu('… le résumé d''un autre jour jamais parti est retiré', (select count(*)::text from public.hb_notifications where body = 'vieux'), '0');
  perform essai.attendu('une seule fois par jour', public.hb_wellness_alertes_quotidien(true)::text, '0');
  delete from public.hb_notifications where kind = 'wellness';
  update public.hb_profiles set notif = '{"wellness":false}' where user_id::text = c1;
  perform essai.attendu('préférence « wellness » coupée : rien', public.hb_wellness_alertes_quotidien(true)::text, '0');
  update public.hb_profiles set notif = '{}' where user_id::text = c1;
  perform essai.attendu('sans « forcer », hors de 8 h (ou jour non demandé) : rien, sauf à 8 h un jour demandé',
    public.hb_wellness_alertes_quotidien()::text,
    case when extract(hour from now() at time zone 'Europe/Paris') = 8 and public.hb_wla_demande(auj, null, true) then '1' else '0' end);
  delete from public.hb_notifications where kind = 'wellness';
  update public.hb_config set data = '{"id":"wellness","key":"wellness","value":{"actif":false}}' where id = 'wellness';
  perform essai.attendu('wellness fermé : pas de résumé', public.hb_wellness_alertes_quotidien(true)::text, '0');
  update public.hb_config set data = '{"id":"wellness","key":"wellness","value":{"actif":true}}' where id = 'wellness';

  -- Compte supprimé : ses alertes partent avec lui.
  delete from public.hb_profiles where user_id::text = c4;
  delete from auth.users where id::text = c4;
  perform essai.attendu('compte supprimé : ses alertes aussi', (select count(*)::text from public.hb_wellness_alertes where nom = 'G'), '0');
end $$;

-- Même règle de lecture que 073 : chaque compte suit toutes les fiches reliées à un espace joueur ; les suivis « lus » par
-- le calcul doivent être exactement ceux que hb_wellness_staff_lit lui ouvre (groupe Pôle, groupe archivé, privé
-- d'observateur, hors périmètre compris).
do $$
declare
  u text;
  lus text;
  lit text;
begin
  insert into public.hb_follows (id, data)
  select pr.user_id || ':player:' || p.pid, jsonb_build_object('id', pr.user_id || ':player:' || p.pid, 'kind', 'player', 'targetId', p.pid, 'createdBy', pr.user_id)
    from public.hb_profiles pr
    cross join (select distinct player_id as pid from public.hb_profiles where role = 'joueur' and player_id is not null) p
   where pr.role in ('admin', 'preparateur', 'observateur')
  on conflict (id) do update set deleted = false;
  for u in select user_id::text from public.hb_profiles where role in ('admin', 'preparateur', 'observateur') order by 1 loop
    lus := essai.vu(u, 'select (select string_agg(x, '','' order by x) from jsonb_array_elements_text(public.hb_wellness_alertes_moi() -> ''lus'') x)');
    select string_agg(x.p, ',' order by x.p) into lit
      from (select distinct player_id as p from public.hb_profiles where role = 'joueur' and player_id is not null) x
     where essai.vu(u, format('select public.hb_wellness_staff_lit(%L)::text', x.p)) = 'true';
    perform essai.attendu('compte ' || right(u, 2) || ' : suivis lus = hb_wellness_staff_lit (' || coalesce(lit, 'aucun') || ')', lus, lit);
  end loop;
end $$;
