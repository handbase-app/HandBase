-- Essais de supabase/071_provenance.sql (lancer.sh), sur les lignes fictives d'avant.sql. Toute erreur arrête.
-- Provenance, lot et heure de création de chaque sorte de ligne ; agrégats (total, heure, lot ; mesures par test, avis par
-- critère, événement d'une mesure, filtres) ; aucun commentaire d'avis rendu ; refus 42501 sans rien lire pour tout compte
-- qui n'est pas administrateur ; périodes invalides ; droits de hb_lots (chacun les siens, l'administrateur tous, ni
-- modification ni suppression).
\set ON_ERROR_STOP 1
create schema if not exists essai;

-- Exécute p_sql comme le compte p_uid (rôle authenticated ; null : anon) ; rend le nombre de lignes, ou « ERR <code> ».
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

-- Première valeur rendue par p_sql, lue comme le compte p_uid.
create or replace function essai.val(p_uid text, p_sql text) returns text
language plpgsql as $$
declare r text;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  return r;
end $$;

create or replace function essai.attendu(p_quoi text, p_vu text, p_attendu text) returns void
language plpgsql as $$
begin
  if p_vu is distinct from p_attendu then raise exception 'ÉCHEC % : % au lieu de %', p_quoi, p_vu, p_attendu; end if;
  raise notice 'ok : %', p_quoi;
end $$;

do $$
declare
  a1 text := '00000000-0000-0000-0000-0000000000a1';
  d1 text := '00000000-0000-0000-0000-0000000000d1';
  d2 text := '00000000-0000-0000-0000-0000000000d2';
  hier text := 'now() - interval ''1 day''';
begin
  -- Provenance, lot, heure de création.
  perform essai.attendu('provenance des mesures',
    essai.val(a1, 'select string_agg(id || ''='' || public.hb_provenance(id, data), '','' order by id) from public.hb_measurements'),
    'demo-prog-m-1=generation,demo-prog-m-2=generation,ess-m1=saisie_appli,ess-m2=saisie_appli,ess-m3=import_fichier,ess-m4=proposition_validee,ess-m5=saisie_appli,ess-sql-1=generation');
  perform essai.attendu('provenance des avis (data.imported sur un avis : proposition validée)',
    essai.val(a1, 'select string_agg(id || ''='' || public.hb_provenance(id, data), '','' order by id) from public.hb_evaluations'),
    'ess-a1=saisie_appli,ess-a2=proposition_validee,ess-a3=saisie_appli');
  perform essai.attendu('provenance des « vus » (demoBilan : génération)',
    essai.val(a1, 'select string_agg(id || ''='' || public.hb_provenance(id, data), '','' order by id) from public.hb_seen'),
    'd1:ess-ev:ess-p1=saisie_appli,d2:ess-ev:ess-p2=generation');
  perform essai.attendu('fiches et événements saisis dans l’appli',
    essai.val(a1, 'select string_agg(distinct public.hb_provenance(id, data), '','') from (select id, data from public.hb_players union all select id, data from public.hb_events) x'),
    'saisie_appli');
  perform essai.attendu('lots',
    essai.val(a1, 'select string_agg(id || ''='' || coalesce(public.hb_lot_de(id, data), ''-''), '','' order by id) from public.hb_measurements'),
    'demo-prog-m-1=demo-progression,demo-prog-m-2=demo-progression,ess-m1=-,ess-m2=-,ess-m3=-,ess-m4=prop-essai-1,ess-m5=-,ess-sql-1=sql-sans-compte');
  perform essai.attendu('lot d’un « vu » du Bilan de démo', essai.val(a1, 'select public.hb_lot_de(id, data) from public.hb_seen where id = ''d2:ess-ev:ess-p2'''), 'demo-bilan');
  perform essai.attendu('lotId mal formé ignoré', (public.hb_lot_de('x', '{"lotId":"a b;drop","createdBy":"u"}'::jsonb) is null)::text, 'true');
  perform essai.attendu('génération : heure de création = heure réelle d’écriture, pas la date antidatée',
    essai.val(a1, 'select bool_and(public.hb_cree_le(id, data, server_updated_at) = server_updated_at and (data ->> ''createdAtServer'')::timestamptz < server_updated_at - interval ''30 days'') from public.hb_measurements where id like ''demo-prog-%'''), 'true');
  perform essai.attendu('saisie : heure de création = createdAtServer (hb_stamp)',
    essai.val(a1, 'select bool_and(public.hb_cree_le(id, data, server_updated_at) = (data ->> ''createdAtServer'')::timestamptz) from public.hb_measurements where id like ''ess-m%'''), 'true');
  perform essai.attendu('heure de création jamais après la dernière écriture',
    public.hb_cree_le('x', '{"createdBy":"u","createdAtServer":"2030-01-01T00:00:00Z"}'::jsonb, '2026-01-01T00:00:00Z')::text, '2026-01-01 00:00:00+00');

  -- Agrégats : total, sans puis avec la génération.
  perform essai.attendu('hb_admin_creations, total hors génération',
    essai.val(a1, format('select string_agg(type || ''/'' || source || ''='' || n, '','' order by type, source) from (select type, source, sum(nb) n from public.hb_admin_creations(%s) group by 1, 2) x', hier)),
    'avis/proposition_validee=1,avis/saisie_appli=2,evenement/saisie_appli=2,fiche/saisie_appli=2,mesure/import_fichier=1,mesure/proposition_validee=1,mesure/saisie_appli=3,vu/saisie_appli=1');
  perform essai.attendu('hb_admin_creations, avec la génération',
    essai.val(a1, format('select string_agg(type || ''/'' || source || ''='' || n, '','' order by type, source) from (select type, source, sum(nb) n from public.hb_admin_creations(%s, null, null, null, true) where source = ''generation'' group by 1, 2) x', hier)),
    'mesure/generation=3,vu/generation=1');
  perform essai.attendu('hb_admin_creations, un auteur, des types',
    essai.val(a1, format('select sum(nb)::text || '' / '' || sum(joueurs)::text from public.hb_admin_creations(%s, null, %L, array[''mesure'']) ', hier, d1)), '5 / 4');
  perform essai.attendu('hb_admin_creations par heure : des tranches à l’heure de Paris',
    essai.val(a1, format('select bool_and(tranche = date_trunc(''hour'', tranche, ''Europe/Paris'')) and count(*) > 0 from public.hb_admin_creations(%s, null, null, null, true, ''heure'')', hier)), 'true');
  perform essai.attendu('hb_admin_creations par lot : dates déclarées (antidatées) à côté de l’heure réelle',
    essai.val(a1, format('select nb || '' '' || declare_min || '' '' || (premier > now() - interval ''1 hour'')::text from public.hb_admin_creations(%s, null, null, array[''mesure''], true, ''lot'') where lot_id = ''demo-progression''', hier)),
    '2 2025-09-16T16:01:37+00:00 true');
  perform essai.attendu('période passée : rien', essai.val(a1, 'select count(*) from public.hb_admin_creations(now() - interval ''10 days'', now() - interval ''5 days'')'), '0');

  -- Saisies : mesures par test, avis par critère, événement d'une mesure (même jour, joueur inscrit), filtres.
  perform essai.attendu('hb_admin_saisies, mesures de l’encadrant',
    essai.val(a1, format('select string_agg(cle || '':'' || nb || ''/'' || joueurs || ''/'' || coalesce(mini::text, ''-'') || ''/'' || coalesce(maxi::text, ''-'') || ''/'' || coalesce(moyenne::text, ''-'') || ''/'' || array_to_string(evenements, ''+'') || ''/'' || array_to_string(sources, ''+'') || ''/'' || valeurs_texte, '' ; '' order by cle) from public.hb_admin_saisies(%s, null, %L) where type = ''mesure''', hier, d1)),
    'cmj:1/1/31.5/31.5/31.500/ess-ev/import_fichier/0 ; lateralite:1/1/-/-/-/ess-ev/saisie_appli/1 ; sprint:3/2/1.9/2.1/2.000/ess-ev/proposition_validee+saisie_appli/0');
  perform essai.attendu('hb_admin_saisies, avis par critère (notes chiffrées seulement)',
    essai.val(a1, format('select string_agg(cle || '':'' || nb || ''/'' || joueurs || ''/'' || moyenne, '' ; '' order by cle) from public.hb_admin_saisies(%s, null, %L) where type = ''avis''', hier, d1)),
    'defense:1/1/3.000 ; tir:2/2/3.000');
  perform essai.attendu('aucun commentaire d’avis rendu',
    essai.val(a1, format('select count(*) from public.hb_admin_saisies(%s) x where x::text ~ ''Commentaire|texte''', hier)), '0');
  perform essai.attendu('hb_admin_saisies, un événement', essai.val(a1, format('select string_agg(type || '':'' || cle || ''='' || nb, '','' order by type, cle) from public.hb_admin_saisies(%s, null, null, null, ''ess-ev'')', hier)),
    'avis:defense=1,avis:tir=2,mesure:cmj=1,mesure:lateralite=1,mesure:sprint=2');
  perform essai.attendu('hb_admin_saisies, une provenance', essai.val(a1, format('select string_agg(type || '':'' || cle || ''='' || nb, '','' order by type, cle) from public.hb_admin_saisies(%s, null, null, null, null, ''proposition_validee'')', hier)),
    'avis:tir=1,mesure:sprint=1');
  perform essai.attendu('hb_admin_saisies, un test', essai.val(a1, format('select string_agg(type || '':'' || cle || ''='' || nb, '','') from public.hb_admin_saisies(%s, null, null, ''cmj'')', hier)), 'mesure:cmj=1');
  perform essai.attendu('hb_admin_saisies, génération comprise', essai.val(a1, format('select nb::text from public.hb_admin_saisies(%s, null, null, ''sprint'', null, null, true)', hier)), '6');

  -- Refus : rien n'est lu pour un compte qui n'est pas administrateur (ni pour anon).
  perform essai.attendu('encadrant : hb_admin_creations refusée', essai.comme(d1, format('select * from public.hb_admin_creations(%s)', hier)), 'ERR 42501');
  perform essai.attendu('observateur : hb_admin_saisies refusée', essai.comme(d2, format('select * from public.hb_admin_saisies(%s)', hier)), 'ERR 42501');
  perform essai.attendu('anon : hb_admin_creations refusée', essai.comme(null, format('select * from public.hb_admin_creations(%s)', hier)), 'ERR 42501');
  perform essai.attendu('anon : hb_provenance refusée', essai.comme(null, 'select public.hb_provenance(''x'', ''{}'')'), 'ERR 42501');
  perform essai.attendu('période à l’envers', essai.comme(a1, 'select * from public.hb_admin_creations(now(), now() - interval ''1 day'')'), 'ERR 22023');
  perform essai.attendu('période de plus de 400 jours', essai.comme(a1, 'select * from public.hb_admin_saisies(now() - interval ''500 days'')'), 'ERR 22023');
  perform essai.attendu('regroupement inconnu', essai.comme(a1, format('select * from public.hb_admin_creations(%s, null, null, null, false, ''semaine'')', hier)), 'ERR 22023');

  -- Lots : ceux de la démo enregistrés par le script ; chacun les siens, l'administrateur tous.
  perform essai.attendu('lots de démo enregistrés',
    essai.val(a1, 'select string_agg(id || ''='' || source || '':'' || nb_lignes::text || '':'' || coalesce(created_by, ''-''), '' ; '' order by id) from public.hb_lots'),
    'demo-bilan=generation:{"vu": 1}:- ; demo-progression=generation:{"mesure": 2}:- ; sql-sans-compte=generation:{"mesure": 1}:-');
  perform essai.attendu('encadrant : ajoute un lot à son nom', essai.comme(d1, 'insert into public.hb_lots (id, source, description, nb_lignes) values (''collage-essai'', ''import_fichier'', ''Collage fictif'', ''{"mesure": 12}'')'), '1');
  perform essai.attendu('encadrant : pas au nom d’un autre', essai.comme(d1, format('insert into public.hb_lots (id, source, created_by) values (''faux'', ''import_fichier'', %L)', a1)), 'ERR 42501');
  perform essai.attendu('provenance inconnue refusée', essai.comme(d1, 'insert into public.hb_lots (id, source) values (''x2'', ''autre'')'), 'ERR 23514');
  perform essai.attendu('identifiant de lot mal formé refusé', essai.comme(d1, 'insert into public.hb_lots (id, source) values (''a b'', ''import_fichier'')'), 'ERR 23514');
  perform essai.attendu('encadrant : ne lit que les siens', essai.comme(d1, 'select * from public.hb_lots'), '1');
  perform essai.attendu('administrateur : lit tous les lots', essai.comme(a1, 'select * from public.hb_lots'), '4');
  perform essai.attendu('encadrant : ni modification', essai.comme(d1, 'update public.hb_lots set description = ''x'''), 'ERR 42501');
  perform essai.attendu('encadrant : ni suppression', essai.comme(d1, 'delete from public.hb_lots'), 'ERR 42501');
  perform essai.attendu('anon : rien', essai.comme(null, 'select * from public.hb_lots'), 'ERR 42501');
  delete from public.hb_lots where id = 'collage-essai';
end $$;
