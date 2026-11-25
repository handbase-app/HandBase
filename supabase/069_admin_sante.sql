-- HandBase / Nextar : ÉTAT DE L'INSTALLATION pour les administrateurs (serveur MCP, outil nextar_admin_sante). Ce que la base
-- sait d'elle-même mais qu'un administrateur ne peut pas lire avec son compte : taille de la base, taille et lignes de chaque
-- table, registre des changements (061), charge annoncée (061), abonnements aux notifications (026, 060 : des NOMBRES, jamais
-- un jeton ni une adresse d'envoi), rappels de la veille (060), notifications en attente (026), tâches programmées (pg_cron :
-- état, jamais le texte des commandes ni les messages d'erreur), quota de transcription (042, total de la période).
-- À exécuter dans Supabase > SQL Editor, APRÈS 068_rapports.sql : base de TEST d'abord (vérifier avec la requête de contrôle en
-- fin de fichier), puis les autres. Peut être relancé sans risque (create or replace). ADDITIF : une seule fonction nouvelle ;
-- aucune table, aucune règle de lecture, aucun déclencheur, ni hb_upsert ne sont touchés.
-- Le serveur MCP marche AVANT ce script : nextar_admin_sante dit « indisponible tant que 069 n'est pas appliqué » pour ces
-- lignes-là et donne le reste (volumes lus avec le compte, connexions…).
--
-- hb_admin_sante() → jsonb :
--   { version: 1, mesure_le,
--     base: { taille_octets, postgres },
--     tables: [ { table, lignes_estimees, taille_octets } ]           (tables hb_*, statistiques de Postgres : estimation)
--     registre: { lignes_24h, pertes_24h, derniere, purge_le } | null  (061 absent : null)
--     charge: { niveau, jusqua, en_cours, annonce_le } | null
--     abonnements: { total, comptes, par_appareil: [ { appareil, nb } ], sans_envoi_reussi_30j } | null
--     veille: [ { jour, comptes, appareils, envoyes } ] (7 derniers jours) | null
--     notifications: { en_attente, plus_ancienne } | null
--     taches: [ { tache, derniere_execution, dernier_etat, echecs_7j, executions_7j } ] | null  (pg_cron absent : null)
--     transcription: { periode, total } | null }
-- SÉCURITÉ :
--  - SECURITY DEFINER (il faut lire des tables fermées à tous les comptes) ; la PREMIÈRE instruction vérifie hb_is_admin()
--    (043) : tout autre compte, et le SQL direct sans compte, reçoit l'erreur 42501 « Réservé aux administrateurs » sans rien lire ;
--  - search_path fixé (public, pg_temp) ; aucun paramètre ; requêtes fixes (les tables facultatives sont lues par EXECUTE de
--    textes constants, après to_regclass) ;
--  - ne rend JAMAIS : identifiant de compte, adresse mail, jeton ou adresse d'envoi des abonnements (endpoint, p256dh, auth,
--    user_agent), contenu d'une ligne, texte d'une commande programmée, message d'erreur d'une tâche ; seulement des nombres,
--    des dates, des noms de tables et de tâches, le type d'appareil (« iPhone », « Android »… déjà réduit par 060) ;
--  - exécution : authenticated seulement (révoquée pour public et anon).
-- Essai : bash tools/essai-sql-069/lancer.sh (Postgres jetable, Docker).
-- Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

create or replace function public.hb_admin_sante() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
  x jsonb;
begin
  -- Le rôle d'abord : rien n'est lu pour un autre compte.
  if not coalesce(public.hb_is_admin(), false) then
    raise exception 'Réservé aux administrateurs' using errcode = '42501';
  end if;

  v := jsonb_build_object('version', 1, 'mesure_le', now(),
    'base', jsonb_build_object('taille_octets', pg_database_size(current_database()), 'postgres', current_setting('server_version')));

  -- Tables hb_* : lignes (statistiques de Postgres, estimation) et taille sur disque, index compris.
  select coalesce(jsonb_agg(jsonb_build_object(
           'table', c.relname,
           'lignes_estimees', greatest(coalesce(s.n_live_tup, c.reltuples::bigint, 0), 0),
           'taille_octets', pg_total_relation_size(c.oid)) order by pg_total_relation_size(c.oid) desc, c.relname), '[]'::jsonb)
    into x
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_user_tables s on s.relid = c.oid
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'hb\_%';
  v := v || jsonb_build_object('tables', x);

  -- Registre des changements (061) : écritures notées et pertes de droit de lecture des dernières 24 h, dernière purge.
  x := null;
  if to_regclass('public.hb_registre') is not null then
    execute $q$select jsonb_build_object('lignes_24h', count(*), 'pertes_24h', count(*) filter (where perte), 'derniere', max(at))
                 from public.hb_registre where at > now() - interval '24 hours'$q$ into x;
    if to_regclass('public.hb_registre_etat') is not null then
      execute $q$select $1 || jsonb_build_object('purge_le', (select purge_at from public.hb_registre_etat where id = 1))$q$ into x using x;
    end if;
  end if;
  v := v || jsonb_build_object('registre', x);

  -- Charge annoncée (061).
  x := null;
  if to_regclass('public.hb_charge_etat') is not null then
    execute $q$select jsonb_build_object('niveau', niveau, 'jusqua', jusqua, 'en_cours', jusqua > now(), 'annonce_le', at)
                 from public.hb_charge_etat where id = 1$q$ into x;
  end if;
  v := v || jsonb_build_object('charge', x);

  -- Abonnements aux notifications (026 ; type d'appareil et dernier envoi accepté : 060). Des nombres seulement.
  x := null;
  if to_regclass('public.hb_push_subs') is not null then
    execute $q$select jsonb_build_object('total', count(*), 'comptes', count(distinct user_id)) from public.hb_push_subs$q$ into x;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hb_push_subs' and column_name = 'appareil') then
      execute $q$select $1 || jsonb_build_object('par_appareil', coalesce((
                   select jsonb_agg(jsonb_build_object('appareil', a, 'nb', nb) order by nb desc, a)
                     from (select coalesce(nullif(btrim(appareil), ''), 'inconnu') as a, count(*) as nb
                             from public.hb_push_subs group by 1) t), '[]'::jsonb))$q$ into x using x;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hb_push_subs' and column_name = 'last_ok_at') then
      execute $q$select $1 || jsonb_build_object('sans_envoi_reussi_30j',
                   (select count(*) from public.hb_push_subs where last_ok_at is null or last_ok_at < now() - interval '30 days'))$q$ into x using x;
    end if;
  end if;
  v := v || jsonb_build_object('abonnements', x);

  -- Rappels de la veille (060), 7 derniers jours.
  x := null;
  if to_regclass('public.hb_veille_envois') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('jour', jour, 'comptes', comptes, 'appareils', appareils, 'envoyes', envoyes) order by jour desc), '[]'::jsonb)
                 from (select jour, count(*) as comptes, coalesce(sum(appareils), 0) as appareils, coalesce(sum(envoyes), 0) as envoyes
                         from public.hb_veille_envois where jour > current_date - 7 group by jour) t$q$ into x;
  end if;
  v := v || jsonb_build_object('veille', x);

  -- Notifications en attente d'envoi (026).
  x := null;
  if to_regclass('public.hb_notifications') is not null then
    execute $q$select jsonb_build_object('en_attente', count(*), 'plus_ancienne', min(created_at))
                 from public.hb_notifications where sent_at is null$q$ into x;
  end if;
  v := v || jsonb_build_object('notifications', x);

  -- Tâches programmées (pg_cron) : nom, dernière exécution et son état, échecs sur 7 jours. Ni commande, ni message.
  x := null;
  if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
    begin
      execute $q$select coalesce(jsonb_agg(jsonb_build_object('tache', t.tache, 'derniere_execution', t.derniere, 'dernier_etat', t.etat,
                     'echecs_7j', t.echecs, 'executions_7j', t.executions) order by t.tache), '[]'::jsonb)
                   from (select coalesce(j.jobname, 'tâche ' || j.jobid) as tache,
                                (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid) as derniere,
                                (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc nulls last limit 1) as etat,
                                (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '7 days' and d.status = 'failed') as echecs,
                                (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '7 days') as executions
                           from cron.job j) t$q$ into x;
    exception when others then
      x := null; -- pg_cron illisible ici : rien plutôt qu'une erreur.
    end;
  end if;
  v := v || jsonb_build_object('taches', x);

  -- Quota de transcription (042) : total de la période la plus récente (aucun compte).
  x := null;
  if to_regclass('public.hb_transcription_quota') is not null then
    execute $q$select jsonb_build_object('periode', periode, 'total', sum(n))
                 from public.hb_transcription_quota group by periode order by periode desc limit 1$q$ into x;
  end if;
  v := v || jsonb_build_object('transcription', x);

  return v;
end $$;

revoke all on function public.hb_admin_sante() from public, anon;
grant execute on function public.hb_admin_sante() to authenticated;

-- ---------- Vérification ----------
-- Attendu : fonction_1 = 1, definer = t, search_path_fixe = t, anon_f = f, public_f = f, authenticated_t = t.
-- (Appelée sans compte depuis le SQL Editor, hb_admin_sante() répond « Réservé aux administrateurs » : c'est voulu.)
select (select count(*) from pg_proc where proname = 'hb_admin_sante' and pronamespace = 'public'::regnamespace) as fonction_1,
       (select prosecdef from pg_proc where oid = 'public.hb_admin_sante()'::regprocedure) as definer,
       (select coalesce(array_to_string(proconfig, ',') like '%search_path=public, pg_temp%', false) from pg_proc where oid = 'public.hb_admin_sante()'::regprocedure) as search_path_fixe,
       has_function_privilege('anon', 'public.hb_admin_sante()', 'execute') as anon_f,
       (select coalesce(bool_or(a.grantee = 0), false) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
         where p.oid = 'public.hb_admin_sante()'::regprocedure and a.privilege_type = 'EXECUTE') as public_f,
       has_function_privilege('authenticated', 'public.hb_admin_sante()', 'execute') as authenticated_t;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- drop function if exists public.hb_admin_sante();
