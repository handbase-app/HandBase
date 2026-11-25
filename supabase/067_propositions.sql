-- HandBase / Nextar : boîte « À valider » (projet « Serveur MCP Nextar », étape 2). Des PROPOSITIONS de mesures attendent la
-- validation du coach : un tableau collé gardé pour plus tard (« Garder pour plus tard », src/components/ImportMesures.tsx),
-- et demain les lignes déposées par le serveur MCP (Claude, avec le compte du coach) ou lues sur une photo. Rien n'est écrit
-- dans les mesures avant que le coach valide dans l'appli (écran « À valider », mêmes règles que « Coller un tableau »).
-- À exécuter dans Supabase > SQL Editor, APRÈS 066_mes_tests.sql : base de TEST d'abord (vérifier avec la requête de contrôle
-- en fin de fichier), puis les autres. Peut être relancé sans risque (create … if not exists, create or replace, drop … if
-- exists). Additif : ni hb_upsert, ni la synchronisation générale, ni le registre, ni le direct ne sont touchés ; seule
-- hb_set_notif_prefs (033) est reprise pour accepter la préférence « proposition ». N'ACTIVE RIEN : la purge programmée et la
-- notification sont dans la section « ACTIVATION », à lancer à la main plus tard.
-- L'appli marche AVANT ce script : tant que le serveur ne connaît pas la table, la boîte reste sur l'appareil
-- (src/propositions.ts) ; dès qu'elle existe, l'appareil y envoie ses propositions et relit celles du compte.
--
-- 1) Table hb_propositions : id (uuid), user_id (le compte connecté, posé par le serveur), source (« collage » : collé dans
--    l'appli ; « mcp » : déposé par le serveur MCP ; « photo » : lu sur une photo), kind (« mesures » ; « avis », « vus »,
--    « a_revoir » prévus pour plus tard), titre (80 caractères au plus), contexte (objet : portée « evenement », « groupe » ou
--    « tous », identifiant et nom, date des tests, choix déjà faits par le coach), lignes (tableau des lignes BRUTES telles
--    qu'écrites sur la feuille, en-tête compris : chaque ligne est un tableau de cellules, ou un objet qui les porte avec un
--    rapprochement éventuel), etat (« en_attente », « validee », « partielle », « rejetee »), created_at, updated_at,
--    expires_at (created_at + 30 jours), deleted_at.
-- 2) DROITS : PERSONNEL. Chacun lit, crée, modifie et supprime SES propositions, avec un rôle du staff ; personne d'autre ne
--    les voit, pas même un administrateur. Compte sans rôle, compte joueur, anonyme : rien (hb_has_role). Écriture directe
--    (règles ci-dessous), sans passer par hb_upsert. Le futur serveur MCP écrira AVEC LE COMPTE DU COACH (mêmes règles).
-- 3) GARDE-FOUS (déclencheur hb_propositions_garde) :
--    - compte, source, sorte, création et expiration posés par le serveur et jamais changés ensuite ; horloge du SERVEUR
--      seulement (created_at, updated_at, expires_at, deleted_at : now()), jamais celle de l'appareil ;
--    - lignes : 1 à 300, ~200 Ko au plus, chaque ligne un tableau ou un objet ; contexte : un objet de 32 Ko au plus ;
--    - 30 propositions EN ATTENTE au plus par compte (création, ou retour « en attente » après « Défaire ») ; 100 gardées au
--      plus par compte (traitées comprises) ; avant chaque création, les propositions du compte expirées ou traitées depuis
--      7 jours sont effacées (la boîte se range même sans la purge programmée) ;
--    - une proposition traitée garde ses lignes (seul son état change, ou son retrait) ; une proposition retirée le reste.
-- 4) PURGE : hb_propositions_purger() efface pour de vrai les propositions expirées, et celles traitées ou retirées depuis 7
--    jours. Tâche quotidienne dans « ACTIVATION » (non lancée). La base de test est presque pleine : un seul index (compte).
-- 5) NOTIFICATION (préparée, NON ACTIVÉE) : quand une proposition arrive d'ailleurs que de l'appareil (source autre que
--    « collage »), le déclencheur hb_propositions_signal appelle la fonction « veille » (pg_net, comme la veille de 060) avec
--    { type: "proposition", id } ; la fonction envoie au coach « 1 proposition à valider · <titre> » sur ses appareils abonnés
--    (préférence « proposition », créneau « ne pas déranger » : sans son) ; le toucher ouvre la boîte. Le message poussé ne
--    contient que ce texte et le lien : jamais un joueur ni une mesure.
-- Aucune donnée n'est envoyée à une IA par Nextar : la table garde ce que le coach (ou son IA, avec son compte) a déposé.
-- Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- Table ----------

create table if not exists public.hb_propositions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source text not null default 'collage' check (source in ('collage', 'mcp', 'photo')),
  kind text not null default 'mesures' check (kind in ('mesures', 'avis', 'vus', 'a_revoir')),
  titre text not null default 'Proposition' check (length(titre) between 1 and 80),
  contexte jsonb not null default '{}'::jsonb,
  lignes jsonb not null,
  etat text not null default 'en_attente' check (etat in ('en_attente', 'validee', 'partielle', 'rejetee')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  deleted_at timestamptz,
  constraint hb_propositions_contexte check (jsonb_typeof(contexte) = 'object' and octet_length(contexte::text) <= 32768),
  constraint hb_propositions_lignes check (
    jsonb_typeof(lignes) = 'array' and jsonb_array_length(lignes) between 1 and 300 and octet_length(lignes::text) <= 204800
  )
);
-- Un seul index : les propositions d'un compte (lecture, comptes de la boîte, ménage à la création).
create index if not exists hb_propositions_user on public.hb_propositions (user_id);
alter table public.hb_propositions enable row level security;

-- ---------- Droits : chacun les siennes ----------

drop policy if exists "own_select" on public.hb_propositions;
create policy "own_select" on public.hb_propositions for select to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_has_role()));
drop policy if exists "own_insert" on public.hb_propositions;
create policy "own_insert" on public.hb_propositions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.hb_has_role()));
drop policy if exists "own_update" on public.hb_propositions;
create policy "own_update" on public.hb_propositions for update to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_has_role()))
  with check (user_id = (select auth.uid()));
drop policy if exists "own_delete" on public.hb_propositions;
create policy "own_delete" on public.hb_propositions for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_has_role()));

revoke all on public.hb_propositions from public, anon, authenticated;
grant select, insert, update, delete on public.hb_propositions to authenticated;
-- Fonction « veille » (clé de service) : lit la proposition qu'elle annonce.
grant select, insert, update, delete on public.hb_propositions to service_role;

-- ---------- Contrôles à l'écriture ----------

create or replace function public.hb_propositions_garde() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    -- Le compte est celui de la session (l'appli, ou le serveur MCP avec le compte du coach) ; clé de service : celui donné.
    if v_uid is not null then new.user_id := v_uid; end if;
    if new.user_id is null then raise exception 'Compte requis'; end if;
    new.created_at := now();
    new.expires_at := now() + interval '30 days';
    new.deleted_at := null;
    new.etat := 'en_attente';
    perform pg_advisory_xact_lock(hashtextextended('hb_propositions:' || new.user_id::text, 0));
    -- Ménage du compte : expirées, traitées ou retirées depuis 7 jours.
    delete from public.hb_propositions p
     where p.user_id = new.user_id
       and (p.expires_at < now() or ((p.etat <> 'en_attente' or p.deleted_at is not null) and p.updated_at < now() - interval '7 days'));
    if (select count(*) from public.hb_propositions p
         where p.user_id = new.user_id and p.etat = 'en_attente' and p.deleted_at is null and p.expires_at > now()) >= 30 then
      raise exception 'Boîte pleine : 30 propositions en attente au plus. Valide ou rejette d’abord celles qui attendent.'
        using hint = 'hb_propositions_pleine';
    end if;
    if (select count(*) from public.hb_propositions p where p.user_id = new.user_id) >= 100 then
      raise exception 'Trop de propositions gardées (100 au plus) : réessaie dans quelques jours.' using hint = 'hb_propositions_pleine';
    end if;
  else
    new.id := old.id;
    new.user_id := old.user_id;
    new.source := old.source;
    new.kind := old.kind;
    new.created_at := old.created_at;
    new.expires_at := old.expires_at;
    -- Retirée : le reste (date du retrait posée par le serveur).
    if old.deleted_at is not null then new.deleted_at := old.deleted_at;
    elsif new.deleted_at is not null then new.deleted_at := now();
    end if;
    -- Traitée et qui le reste : ses lignes, son contexte et son titre ne changent plus.
    if old.etat <> 'en_attente' and new.etat <> 'en_attente' then
      new.lignes := old.lignes;
      new.contexte := old.contexte;
      new.titre := old.titre;
    end if;
    -- Remise en attente (« Défaire » après un enregistrement) : même plafond qu'à la création.
    if new.etat = 'en_attente' and old.etat <> 'en_attente' and new.deleted_at is null then
      perform pg_advisory_xact_lock(hashtextextended('hb_propositions:' || new.user_id::text, 0));
      if (select count(*) from public.hb_propositions p
           where p.user_id = new.user_id and p.id <> new.id and p.etat = 'en_attente' and p.deleted_at is null and p.expires_at > now()) >= 30 then
        raise exception 'Boîte pleine : 30 propositions en attente au plus.' using hint = 'hb_propositions_pleine';
      end if;
    end if;
  end if;
  new.updated_at := now();
  new.titre := left(btrim(regexp_replace(coalesce(new.titre, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 80);
  if new.titre = '' then new.titre := 'Proposition'; end if;
  if new.contexte is null or jsonb_typeof(new.contexte) <> 'object' then new.contexte := '{}'::jsonb; end if;
  if octet_length(new.contexte::text) > 32768 then raise exception 'Contexte trop long (32 Ko au plus)'; end if;
  if coalesce(jsonb_typeof(new.lignes), '') <> 'array' then raise exception 'Les lignes doivent être une liste'; end if;
  if jsonb_array_length(new.lignes) = 0 then raise exception 'Aucune ligne à garder'; end if;
  if jsonb_array_length(new.lignes) > 300 then raise exception 'Trop de lignes (300 au plus)'; end if;
  if octet_length(new.lignes::text) > 204800 then raise exception 'Tableau trop long (200 Ko au plus)'; end if;
  if exists (select 1 from jsonb_array_elements(new.lignes) e where jsonb_typeof(e) not in ('array', 'object')) then
    raise exception 'Chaque ligne doit être une liste de cellules';
  end if;
  return new;
end $$;
revoke all on function public.hb_propositions_garde() from public, anon, authenticated;

drop trigger if exists hb_propositions_garde on public.hb_propositions;
create trigger hb_propositions_garde before insert or update on public.hb_propositions
  for each row execute function public.hb_propositions_garde();

-- ---------- Purge ----------
-- Effacement réel : expirées (30 jours sans validation), traitées ou retirées depuis p_garde (7 jours). Rend le nombre effacé.
create or replace function public.hb_propositions_purger(p_garde interval default interval '7 days')
returns integer language sql volatile security definer set search_path = public as $$
  with d as (
    delete from public.hb_propositions
     where expires_at < now()
        or ((etat <> 'en_attente' or deleted_at is not null)
            and updated_at < now() - greatest(coalesce(p_garde, interval '7 days'), interval '1 hour'))
    returning 1
  )
  select count(*)::integer from d
$$;
revoke all on function public.hb_propositions_purger(interval) from public, anon, authenticated;
grant execute on function public.hb_propositions_purger(interval) to service_role;

-- ---------- Notification (fonction prête ; son déclencheur est dans « ACTIVATION ») ----------
-- Appelle la fonction « veille » (même adresse et même mot de passe que la veille de 060, coffre Vault) avec
-- { type: "proposition", id }. Coffre ou pg_net absent, appel refusé : rien, et la proposition est quand même enregistrée.
create or replace function public.hb_propositions_signal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  if new.source = 'collage' or new.etat <> 'en_attente' then return null; end if;
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'hb_veille_url' limit 1;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'hb_notify_secret' limit 1;
    if v_url is null or v_secret is null then return null; end if;
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('type', 'proposition', 'id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-hb-secret', v_secret),
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'Proposition % : notification non envoyée (%)', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.hb_propositions_signal() from public, anon, authenticated;

-- ---------- Préférence de notification « proposition » (reprise de 033, une clé de plus) ----------

create or replace function public.hb_set_notif_prefs(p_prefs jsonb) returns void
language sql security definer set search_path = public as $$
  update public.hb_profiles
     set notif = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(p_prefs, '{}'::jsonb))
                   where (key in ('avis', 'fiche', 'participant', 'rappel', 'alerte', 'quiet', 'suivi', 'proposition') and jsonb_typeof(value) = 'boolean')
                      or (key in ('quietFrom', 'quietTo') and jsonb_typeof(value) = 'number'
                          and (value #>> '{}')::numeric between 0 and 23 and (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)))
   where user_id = auth.uid()
$$;
revoke all on function public.hb_set_notif_prefs(jsonb) from public, anon;
grant execute on function public.hb_set_notif_prefs(jsonb) to authenticated;

-- ---------- Vérification ----------
-- Attendu : propositions (nombre), regles_4 = 4, garde_1 = 1, signal_0 = 0 tant que la notification n'est pas activée (1
-- après), rls_active = t, droits_anon_0 = 0, appli_purge = f, index_1 = 1.
select (select count(*) from public.hb_propositions) as propositions,
       (select count(*) from pg_policies where tablename = 'hb_propositions') as regles_4,
       (select count(*) from pg_trigger where tgrelid = 'public.hb_propositions'::regclass and not tgisinternal and tgname = 'hb_propositions_garde') as garde_1,
       (select count(*) from pg_trigger where tgrelid = 'public.hb_propositions'::regclass and not tgisinternal and tgname = 'hb_propositions_signal') as signal_0,
       (select relrowsecurity from pg_class where oid = 'public.hb_propositions'::regclass) as rls_active,
       (select count(*) from information_schema.role_table_grants where table_name = 'hb_propositions' and grantee = 'anon') as droits_anon_0,
       has_function_privilege('authenticated', 'public.hb_propositions_purger(interval)', 'execute') as appli_purge,
       (select count(*) from pg_indexes where tablename = 'hb_propositions' and indexname <> 'hb_propositions_pkey') as index_1;

-- ---------- ACTIVATION (à lancer À LA MAIN, plus tard) ----------
-- 1) Purge quotidienne (3 h 17, heure du serveur ; pg_cron) :
--      select cron.unschedule('handbase-propositions') where exists (select 1 from cron.job where jobname = 'handbase-propositions');
--      select cron.schedule('handbase-propositions', '17 3 * * *', $job$select public.hb_propositions_purger()$job$);
-- 2) Notification des propositions déposées par le serveur MCP (ou une photo) : APRÈS le déploiement de la fonction « veille »
--    avec sa branche « proposition » (supabase/functions/veille), et le coffre posé pour la veille (060, ACTIVATION 1 :
--    hb_veille_url, hb_notify_secret) ; extension pg_net. Le déclencheur, entre les deux repères :
-- >>> déclencheur
-- drop trigger if exists hb_propositions_signal on public.hb_propositions;
-- create trigger hb_propositions_signal after insert on public.hb_propositions
--   for each row when (new.source <> 'collage') execute function public.hb_propositions_signal();
-- <<< déclencheur
--    Essai : insérer une proposition « mcp » pour son propre compte (SQL Editor, en remplaçant <uuid du compte>) puis lire la
--    réponse de la fonction :
--      insert into public.hb_propositions (user_id, source, titre, contexte, lignes)
--        values ('<uuid du compte>', 'mcp', 'Essai de notification', '{"portee":"tous"}', '[["Joueur","Taille"],["Essai","170"]]');
--      select status_code, content from net._http_response order by id desc limit 1;
-- Désactiver : drop trigger if exists hb_propositions_signal on public.hb_propositions;
--              select cron.unschedule('handbase-propositions');

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script ; les appareils gardent leur copie) ----------
-- select cron.unschedule('handbase-propositions') where exists (select 1 from cron.job where jobname = 'handbase-propositions');
-- drop table if exists public.hb_propositions;
-- drop function if exists public.hb_propositions_garde();
-- drop function if exists public.hb_propositions_signal();
-- drop function if exists public.hb_propositions_purger(interval);
-- Préférences : hb_set_notif_prefs de 033 (sans « proposition ») :
-- create or replace function public.hb_set_notif_prefs(p_prefs jsonb) returns void
-- language sql security definer set search_path = public as $$
--   update public.hb_profiles
--      set notif = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(p_prefs, '{}'::jsonb))
--                    where (key in ('avis', 'fiche', 'participant', 'rappel', 'alerte', 'quiet', 'suivi') and jsonb_typeof(value) = 'boolean')
--                       or (key in ('quietFrom', 'quietTo') and jsonb_typeof(value) = 'number'
--                           and (value #>> '{}')::numeric between 0 and 23 and (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)))
--    where user_id = auth.uid()
-- $$;
