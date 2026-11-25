-- Essais de supabase/069_admin_sante.sql (lancer.sh) : comptes fictifs, données fictives seulement. Toute erreur arrête.
-- Administrateur : réponse complète (base, tables, registre, charge, abonnements, veille, notifications, tâches, quota) ;
-- encadrant, observateur, compte joueur, compte sans rôle : 42501 ; anon : pas le droit d'exécuter ; aucun identifiant de
-- compte, jeton ou adresse d'envoi, texte de commande ou message d'erreur dans la réponse ; tables facultatives absentes :
-- null, sans erreur.
\set ON_ERROR_STOP 1
create schema if not exists essai;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'preparateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000d1', 'preparateur@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test', null)
on conflict (user_id) do update set role = excluded.role;

-- Données fictives des tables fermées.
insert into public.hb_push_subs (endpoint, user_id, p256dh, auth, user_agent, appareil, last_ok_at) values
  ('https://push.exemple.test/jeton-secret-1', '00000000-0000-0000-0000-0000000000d1', 'cle-p256dh-secrete', 'auth-secret-1', 'Mozilla/5.0 (iPhone) agent-secret', 'iPhone', now()),
  ('https://push.exemple.test/jeton-secret-2', '00000000-0000-0000-0000-0000000000d1', 'cle-p256dh-secrete-2', 'auth-secret-2', 'Mozilla/5.0 (Android) agent-secret', 'Android', now() - interval '40 days'),
  ('https://push.exemple.test/jeton-secret-3', '00000000-0000-0000-0000-0000000000a1', 'cle-p256dh-secrete-3', 'auth-secret-3', null, 'iPhone', null);
insert into public.hb_notifications (user_id, kind, group_key, title, body, created_at, sent_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'avis', 'k1', 'Titre secret de notification', 'Corps secret', now() - interval '3 minutes', null),
  ('00000000-0000-0000-0000-0000000000d1', 'avis', 'k2', 'Déjà envoyée', null, now() - interval '1 day', now() - interval '1 day');
insert into public.hb_veille_envois (user_id, jour, evenements, appareils, envoyes) values
  ('00000000-0000-0000-0000-0000000000d1', current_date - 1, 2, 2, 1),
  ('00000000-0000-0000-0000-0000000000a1', current_date - 1, 1, 1, 1),
  ('00000000-0000-0000-0000-0000000000a1', current_date - 20, 1, 1, 1);
insert into public.hb_registre (x, canal, tbl, ligne, us, h, perte, at) values
  (pg_current_xact_id(), 'hb:dept:83', 'players', 'ligne-secrete-1', 1, 'h', false, now()),
  (pg_current_xact_id(), 'hb:dept:83', 'players', 'ligne-secrete-2', 1, 'h', true, now()),
  (pg_current_xact_id(), 'hb:dept:83', 'players', 'ligne-secrete-3', 1, 'h', false, now() - interval '3 days');
insert into public.hb_transcription_quota (periode, user_id, n) values
  ('2026-10', '00000000-0000-0000-0000-0000000000d1', 4),
  ('2026-11', '00000000-0000-0000-0000-0000000000d1', 3),
  ('2026-11', '00000000-0000-0000-0000-0000000000a1', 2);
-- pg_cron : la table des exécutions n'est pas dans les bouchons ; on la crée comme celle de pg_cron.
create table if not exists cron.job_run_details (runid bigserial, jobid bigint, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
insert into cron.job (jobname, schedule, command) values ('handbase-essai', '* * * * *', 'select commande_secrete()'), (null, '0 3 * * *', 'select autre_commande()');
insert into cron.job_run_details (jobid, command, status, return_message, start_time)
select jobid, command, s, m, t from cron.job, (values
  ('succeeded', '1 row', now() - interval '2 days'),
  ('failed', 'ERROR: message secret de la tâche', now() - interval '1 hour')) v(s, m, t)
 where jobname = 'handbase-essai';

-- Exécute hb_admin_sante() comme ce compte ; rend le texte de la réponse, ou « ERR <code> ».
create or replace function essai.sante(p_uid text) returns text
language plpgsql as $$
declare r text;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  begin
    execute 'select public.hb_admin_sante()::text' into r;
  exception when others then
    reset role;
    return 'ERR ' || sqlstate;
  end;
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
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  f1 text := '00000000-0000-0000-0000-0000000000f1';
  t text;
  j jsonb;
  s text;
begin
  -- Réservé aux administrateurs.
  perform essai.attendu('encadrant : refusé (42501)', essai.sante(d1), 'ERR 42501');
  perform essai.attendu('observateur : refusé', essai.sante(d2), 'ERR 42501');
  perform essai.attendu('compte joueur : refusé', essai.sante(e1), 'ERR 42501');
  perform essai.attendu('compte sans rôle : refusé', essai.sante(f1), 'ERR 42501');
  perform essai.attendu('anon : pas le droit d''exécuter (42501)', essai.sante(null), 'ERR 42501');
  perform essai.attendu('SQL direct sans compte : refusé', (select essai.sante('')), 'ERR 42501');
  -- Administrateur : la réponse.
  t := essai.sante(a1);
  if t like 'ERR%' then raise exception 'ÉCHEC administrateur : %', t; end if;
  j := t::jsonb;
  perform essai.attendu('version 1', j ->> 'version', '1');
  perform essai.attendu('taille de la base (octets) > 0', ((j -> 'base' ->> 'taille_octets')::bigint > 0)::text, 'true');
  perform essai.attendu('version de Postgres', (j -> 'base' ->> 'postgres' ~ '^\d+')::text, 'true');
  perform essai.attendu('tables hb_* listées (joueurs, mesures, registre)',
    (select count(*)::text from jsonb_array_elements(j -> 'tables') e where e ->> 'table' in ('hb_players', 'hb_measurements', 'hb_registre')), '3');
  perform essai.attendu('aucune table hors hb_*', (select count(*)::text from jsonb_array_elements(j -> 'tables') e where e ->> 'table' not like 'hb\_%'), '0');
  perform essai.attendu('chaque table : lignes estimées et taille', (select bool_and(e ? 'lignes_estimees' and e ? 'taille_octets')::text from jsonb_array_elements(j -> 'tables') e), 'true');
  perform essai.attendu('registre 24 h : 2 lignes, 1 perte', (j -> 'registre' ->> 'lignes_24h') || ' ' || (j -> 'registre' ->> 'pertes_24h'), '2 1');
  perform essai.attendu('registre : date de purge (clé présente)', (j -> 'registre' ? 'purge_le')::text, 'true');
  perform essai.attendu('charge : niveau calme', j -> 'charge' ->> 'niveau', 'calme');
  perform essai.attendu('abonnements : 3 appareils, 2 comptes', (j -> 'abonnements' ->> 'total') || ' ' || (j -> 'abonnements' ->> 'comptes'), '3 2');
  perform essai.attendu('abonnements par appareil : iPhone 2, Android 1', (select string_agg((e ->> 'appareil') || ' ' || (e ->> 'nb'), ', ') from jsonb_array_elements(j -> 'abonnements' -> 'par_appareil') e), 'iPhone 2, Android 1');
  perform essai.attendu('abonnements sans envoi réussi depuis 30 jours : 2', j -> 'abonnements' ->> 'sans_envoi_reussi_30j', '2');
  perform essai.attendu('veille : 1 jour sur 7 (2 comptes, 2 envoyés)', (select string_agg((e ->> 'comptes') || ' ' || (e ->> 'envoyes'), ',') from jsonb_array_elements(j -> 'veille') e), '2 2');
  perform essai.attendu('notifications en attente : 1', j -> 'notifications' ->> 'en_attente', '1');
  perform essai.attendu('tâches : 2 (une sans nom)', jsonb_array_length(j -> 'taches')::text, '2');
  perform essai.attendu('tâche handbase-essai : dernier état failed, 1 échec sur 2 exécutions',
    (select (e ->> 'dernier_etat') || ' ' || (e ->> 'echecs_7j') || '/' || (e ->> 'executions_7j') from jsonb_array_elements(j -> 'taches') e where e ->> 'tache' = 'handbase-essai'), 'failed 1/2');
  perform essai.attendu('transcription : période la plus récente, total 5', (j -> 'transcription' ->> 'periode') || ' ' || (j -> 'transcription' ->> 'total'), '2026-11 5');
  -- Rien de personnel ni de secret.
  s := lower(t);
  perform essai.attendu('aucun identifiant de compte', (s like '%00000000-0000-0000-0000-0000000000%')::text, 'false');
  perform essai.attendu('aucune adresse mail', (position('@' in s) > 0)::text, 'false');
  perform essai.attendu('aucun jeton ni adresse d''envoi', (s ~ 'jeton-secret|p256dh|auth-secret|push\.exemple|agent-secret|mozilla')::text, 'false');
  perform essai.attendu('aucun texte de commande ni message de tâche', (s ~ 'commande|message secret|error:')::text, 'false');
  perform essai.attendu('aucun contenu de ligne (registre, notification)', (s ~ 'ligne-secrete|hb:dept|titre secret|corps secret')::text, 'false');
  -- Tables facultatives absentes : null, sans erreur.
  drop table cron.job_run_details;
  drop table public.hb_veille_envois;
  t := essai.sante(a1);
  if t like 'ERR%' then raise exception 'ÉCHEC tables absentes : %', t; end if;
  perform essai.attendu('pg_cron absent : taches null', jsonb_typeof(t::jsonb -> 'taches'), 'null');
  perform essai.attendu('060 absent : veille null', jsonb_typeof(t::jsonb -> 'veille'), 'null');
  -- Exécution : authenticated seulement.
  perform essai.attendu('anon ne peut pas exécuter', has_function_privilege('anon', 'public.hb_admin_sante()', 'execute')::text, 'false');
  perform essai.attendu('authenticated peut exécuter', has_function_privilege('authenticated', 'public.hb_admin_sante()', 'execute')::text, 'true');
end $$;
