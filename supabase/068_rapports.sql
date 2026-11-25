-- HandBase / Nextar : RAPPORTS EN CODES du serveur MCP (projet « Serveur MCP Nextar », étape 3). Claude, branché avec le compte
-- du coach (fonction supabase/functions/mcp, outil nextar_rapport), rédige un rapport en Markdown AVEC LES CODES des joueurs
-- (« J-7K3Q2MX », src/codesJoueurs.ts), jamais avec leurs noms ; ce script le garde 30 jours pour SON AUTEUR SEUL. L'appli ouvre
-- /rapport/<id> : l'appareil du coach remplace chaque code par le nom à partir de ses propres données ; les noms ne passent
-- jamais par le serveur MCP.
-- À exécuter dans Supabase > SQL Editor, APRÈS 067_propositions.sql : base de TEST d'abord (vérifier avec la requête de
-- contrôle en fin de fichier), puis les autres. Peut être relancé sans risque (create … if not exists, create or replace,
-- drop … if exists). Additif : rien d'existant n'est touché. N'ACTIVE RIEN : la purge programmée est dans « ACTIVATION ».
-- L'appli marche AVANT ce script : la page /rapport dit « rapports pas encore installés » ; le serveur MCP répond de même.
--
-- 1) Table hb_rapports : id (uuid), user_id (le compte connecté, posé par le serveur), source (« mcp »), titre (120
--    caractères au plus), contenu (texte Markdown, 100 000 caractères au plus), created_at, expires_at (created_at + 30 jours).
--    Un rapport ne se modifie pas : on en dépose un autre (le serveur MCP n'a besoin que de créer ; l'appli que de lire et de
--    retirer).
-- 2) DROITS : PERSONNEL. Chacun lit, crée et supprime SES rapports, avec un rôle du staff ; personne d'autre ne les voit, pas
--    même un administrateur. Compte sans rôle, compte joueur, anonyme : rien (hb_has_role). Pas de modification.
-- 3) GARDE-FOUS (déclencheur hb_rapports_garde) : compte, source, création et expiration posés par le serveur (horloge du
--    SERVEUR) ; titre nettoyé (espaces, caractères de contrôle), vide → « Rapport » ; contenu non vide, 100 000 caractères au
--    plus ; 50 rapports gardés au plus par compte ; avant chaque création, les rapports expirés du compte sont effacés.
-- 4) PURGE : hb_rapports_purger() efface pour de vrai les rapports expirés. Tâche quotidienne dans « ACTIVATION » (non lancée).
--    La base de test est presque pleine (419 Mo sur 500) : un seul index (compte), rien de plus.
-- Aucune donnée n'est envoyée à une IA par Nextar : la table garde le texte que l'IA du coach a déposé avec son compte.
-- Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- Table ----------

create table if not exists public.hb_rapports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null default 'mcp' check (source in ('mcp')),
  titre text not null default 'Rapport' check (length(titre) between 1 and 120),
  contenu text not null check (length(contenu) between 1 and 100000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists hb_rapports_user on public.hb_rapports (user_id);
alter table public.hb_rapports enable row level security;

-- ---------- Droits : chacun les siens ----------

drop policy if exists "own_select" on public.hb_rapports;
create policy "own_select" on public.hb_rapports for select to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_has_role()));
drop policy if exists "own_insert" on public.hb_rapports;
create policy "own_insert" on public.hb_rapports for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.hb_has_role()));
drop policy if exists "own_delete" on public.hb_rapports;
create policy "own_delete" on public.hb_rapports for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_has_role()));

revoke all on public.hb_rapports from public, anon, authenticated;
grant select, insert, delete on public.hb_rapports to authenticated;

-- ---------- Contrôles à l'écriture ----------

create or replace function public.hb_rapports_garde() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then raise exception 'Un rapport ne se modifie pas : dépose-en un autre.'; end if;
  if v_uid is not null then new.user_id := v_uid; end if;
  if new.user_id is null then raise exception 'Compte requis'; end if;
  new.source := 'mcp';
  new.created_at := now();
  new.expires_at := now() + interval '30 days';
  new.titre := left(btrim(regexp_replace(coalesce(new.titre, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 120);
  if new.titre = '' then new.titre := 'Rapport'; end if;
  if new.contenu is null or btrim(new.contenu) = '' then raise exception 'Rapport vide'; end if;
  if length(new.contenu) > 100000 then raise exception 'Rapport trop long (100 000 caractères au plus)'; end if;
  perform pg_advisory_xact_lock(hashtextextended('hb_rapports:' || new.user_id::text, 0));
  delete from public.hb_rapports r where r.user_id = new.user_id and r.expires_at < now();
  if (select count(*) from public.hb_rapports r where r.user_id = new.user_id) >= 50 then
    raise exception 'Trop de rapports gardés (50 au plus) : retire-en dans l’appli, ou attends qu’ils expirent.' using hint = 'hb_rapports_plein';
  end if;
  return new;
end $$;
revoke all on function public.hb_rapports_garde() from public, anon, authenticated;

drop trigger if exists hb_rapports_garde on public.hb_rapports;
create trigger hb_rapports_garde before insert or update on public.hb_rapports
  for each row execute function public.hb_rapports_garde();

-- ---------- Purge ----------
-- Effacement réel des rapports expirés (30 jours). Rend le nombre effacé.
create or replace function public.hb_rapports_purger()
returns integer language sql volatile security definer set search_path = public as $$
  with d as (delete from public.hb_rapports where expires_at < now() returning 1)
  select count(*)::integer from d
$$;
revoke all on function public.hb_rapports_purger() from public, anon, authenticated;
grant execute on function public.hb_rapports_purger() to service_role;

-- ---------- Vérification ----------
-- Attendu : rapports (nombre), regles_3 = 3, garde_1 = 1, rls_active = t, droits_anon_0 = 0, modif_0 = 0 (pas de droit de
-- modification), appli_purge = f, index_1 = 1.
select (select count(*) from public.hb_rapports) as rapports,
       (select count(*) from pg_policies where tablename = 'hb_rapports') as regles_3,
       (select count(*) from pg_trigger where tgrelid = 'public.hb_rapports'::regclass and not tgisinternal and tgname = 'hb_rapports_garde') as garde_1,
       (select relrowsecurity from pg_class where oid = 'public.hb_rapports'::regclass) as rls_active,
       (select count(*) from information_schema.role_table_grants where table_name = 'hb_rapports' and grantee = 'anon') as droits_anon_0,
       (select count(*) from information_schema.role_table_grants where table_name = 'hb_rapports' and grantee = 'authenticated' and privilege_type = 'UPDATE') as modif_0,
       has_function_privilege('authenticated', 'public.hb_rapports_purger()', 'execute') as appli_purge,
       (select count(*) from pg_indexes where tablename = 'hb_rapports' and indexname <> 'hb_rapports_pkey') as index_1;

-- ---------- ACTIVATION (à lancer À LA MAIN, plus tard) ----------
-- Purge quotidienne (3 h 27, heure du serveur ; pg_cron) :
--   select cron.unschedule('handbase-rapports') where exists (select 1 from cron.job where jobname = 'handbase-rapports');
--   select cron.schedule('handbase-rapports', '27 3 * * *', $job$select public.hb_rapports_purger()$job$);
-- Désactiver : select cron.unschedule('handbase-rapports');

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- select cron.unschedule('handbase-rapports') where exists (select 1 from cron.job where jobname = 'handbase-rapports');
-- drop table if exists public.hb_rapports;
-- drop function if exists public.hb_rapports_garde();
-- drop function if exists public.hb_rapports_purger();
