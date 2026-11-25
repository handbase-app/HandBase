-- HandBase / Nextar : notification de LA VEILLE qui PRÉPARE l'événement sur le téléphone (« push de la veille »).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 059_filet_econome.sql (base de test d'abord, puis la réelle).
-- Peut être relancé sans risque (add column if not exists, create … if not exists, create or replace). Ne touche à aucune
-- règle de lecture, à aucune donnée de joueur, ni à hb_upsert. N'ACTIVE RIEN : la tâche quotidienne est préparée en
-- commentaire (section « ACTIVATION »), à lancer après le déploiement de la fonction « veille » et la pose de ses secrets.
--
-- L'IDÉE : la veille d'un événement (vers 18 h, heure de Paris), chaque personne du staff de l'événement reçoit UNE
-- notification sur ses appareils abonnés (« Demain, Détection U13 à 9 h ») ; en la recevant, même appli fermée, le service
-- worker télécharge les joueurs de l'événement, leurs mesures et avis et la grille de notation, avec SES droits (HTTPS, sa
-- session), et les range dans la base du téléphone. Le jour J, tout est là sans réseau, et le serveur n'a pas de rush le matin.
-- Fonction d'envoi : supabase/functions/veille (web push signé VAPID) ; service worker : src/veilleSw.ts.
--
-- CE QUE FAIT CE SCRIPT
--  1. hb_push_subs (026, un abonnement par appareil) : colonnes appareil (« Android », « iPhone »… déduit du navigateur),
--     updated_at (dernier enregistrement), last_ok_at (dernier envoi accepté). hb_push_subscribe (même signature que 026)
--     n'accepte plus qu'une adresse https:// de 1 000 caractères au plus (la fonction d'envoi y fait un POST : jamais une
--     adresse interne) et garde au plus 10 appareils par compte (les plus anciens oubliés).
--  2. hb_veille_envois : un envoi par personne et par jour (clé user_id + jour), avec le bilan (appareils, envois acceptés).
--     Aucune lecture depuis l'appli (RLS sans règle, droits retirés) ; seulement par les fonctions ci-dessous.
--  3. hb_veille_destinataires(jour) : pour le jour d'envoi donné, les événements du LENDEMAIN et les comptes concernés.
--  4. hb_veille_prendre(jour, lot) : les mêmes, limités aux comptes qui ont un appareil abonné et n'ont pas coupé « Rappel la
--     veille » (préférence rappel, 026) ; elle RÉSERVE l'envoi du jour (hb_veille_envois) pour AU PLUS « lot » personnes
--     (300 par défaut), dans un ordre stable : l'événement le plus tôt le lendemain d'abord, puis l'identifiant du compte.
--     Deux appels le même jour ne rendent jamais deux fois la même personne : la réservation sert de curseur, l'appel
--     suivant prend le lot suivant (reprise après une coupure comprise).
--
-- ÉTALEMENT (pas de ruée à 18 h : tous les téléphones qui téléchargent en même temps, c'est le pic qui fait tomber un petit
-- serveur) : la tâche appelle la fonction toutes les 5 minutes de 18 h à 22 h (heure de Paris) ; chaque appel envoie un lot
-- (VEILLE_LOT, 300 par défaut) : 48 créneaux, jusqu'à ~14 000 personnes par soir, les premières à 18 h, celles dont
-- l'événement commence le plus tôt le lendemain d'abord. Chaque téléphone attend en plus 0 à 20 s au hasard avant de
-- télécharger, et abandonne sans insister si le serveur répond « occupé » (429, 503) : l'appli se synchronise à l'ouverture.
--  5. hb_veille_bilan(jour, bilan) : la fonction d'envoi note, par personne, appareils visés et envois acceptés.
--
-- QUI EST « CONCERNÉ » (hb_veille_destinataires) : événement ni supprimé ni archivé, data.date = jour + 1 ; son créateur
-- (organisateur, data.createdBy), ses participants (data.editors) et les membres actuels des staffs choisis (data.teams,
-- 034) ; seulement les comptes qui ont un rôle du staff (admin, preparateur, observateur : pas les comptes joueur 051, ni un
-- ancien membre sans rôle).
--
-- RÈGLES DE LECTURE : chaque compte rendu est créateur ou participant de l'événement (hb_participant_of) ET a un rôle : c'est
-- exactement la branche (e) de la règle staff_read de hb_events (048) ; il voit donc l'événement quel que soit son périmètre.
-- Un compte qui voit l'événement seulement par son territoire ou par ses joueurs (branches c, d) n'est PAS concerné : il ne
-- reçoit rien. tools/essai-sql-060 vérifie, pour chaque ligne rendue, que le compte lit l'événement sous les règles (RLS).
--
-- CE QUI SORT DU SERVEUR : ces fonctions ne sont appelables que par la clé de service (fonction d'envoi), jamais par l'appli
-- (droits retirés à anon et authenticated). Elles rendent l'identifiant de l'événement, un nom court (60 caractères) et
-- l'heure ; JAMAIS un joueur, une mesure ou un avis. Le message poussé (chiffré de bout en bout par le web push) ne contient
-- que { type: "veille", jour, événements: [{ id, nom court, heure }] } ; les données viennent ensuite de notre serveur, par
-- l'appareil, avec les droits de la personne (règles de lecture habituelles).
--
-- REMPLACE LE RAPPEL DE 026 : « Rappel la veille » (hb_enqueue_reminders, tâche handbase-rappels, file hb_notifications,
-- une notification PAR événement) reste en place tant que la veille n'est pas activée ; l'ACTIVATION ci-dessous retire la
-- tâche handbase-rappels (sinon deux notifications le même soir) et programme handbase-veille. Même préférence (rappel).
--
-- Annulation : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 1. Abonnements par appareil (hb_push_subs, 026) ----------

alter table public.hb_push_subs
  add column if not exists appareil text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_ok_at timestamptz;
alter table public.hb_push_subs enable row level security;
revoke all on table public.hb_push_subs from public, anon, authenticated;
grant select, insert, update, delete on table public.hb_push_subs to service_role;

-- Nom court de l'appareil, d'après son navigateur (aucun identifiant : la marque du système seulement).
create or replace function public.hb_push_device(p_user_agent text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_user_agent ~* 'iphone|ipod' then 'iPhone'
    when p_user_agent ~* 'ipad' then 'iPad'
    when p_user_agent ~* 'android' then 'Android'
    when p_user_agent ~* 'macintosh|mac os' then 'Mac'
    when p_user_agent ~* 'windows' then 'Windows'
    when p_user_agent ~* 'linux|cros' then 'Linux'
    else 'Autre' end
$$;

-- Même signature que 026 (l'appli de toutes versions l'appelle ainsi). Adresse https seulement : la fonction d'envoi y fait un
-- POST, une adresse http:// ou interne ne doit jamais être enregistrée.
create or replace function public.hb_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://[^/\s@]+/' or length(p_endpoint) > 1000 then
    raise exception 'Adresse d''abonnement refusée';
  end if;
  if coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_=-]{20,200}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_=-]{8,100}$' then
    raise exception 'Clés d''abonnement refusées';
  end if;
  insert into public.hb_push_subs (endpoint, user_id, p256dh, auth, user_agent, appareil, updated_at)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 300), public.hb_push_device(p_user_agent), clock_timestamp())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
        appareil = excluded.appareil, updated_at = excluded.updated_at;
  -- Au plus 10 appareils par compte : les plus anciens (dernier enregistrement) sont oubliés.
  delete from public.hb_push_subs s
   where s.user_id = auth.uid()
     and s.endpoint in (select endpoint from public.hb_push_subs where user_id = auth.uid()
                         order by updated_at desc, created_at desc offset 10);
end $$;

-- ---------- 2. Un envoi par personne et par jour ----------

create table if not exists public.hb_veille_envois (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Jour d'envoi (heure de Paris) ; les événements sont ceux du lendemain.
  jour date not null,
  evenements integer not null default 0,
  appareils integer,
  envoyes integer,
  created_at timestamptz not null default now(),
  primary key (user_id, jour)
);
alter table public.hb_veille_envois enable row level security;
revoke all on table public.hb_veille_envois from public, anon, authenticated;
grant select, insert, update, delete on table public.hb_veille_envois to service_role;

-- Événements d'un jour (data.date « AAAA-MM-JJ »), sans parcourir toute la table.
create index if not exists hb_events_date on public.hb_events ((data ->> 'date')) where not deleted;

-- ---------- 3. Événements du lendemain et comptes concernés ----------

-- Pour le jour d'envoi p_jour : une ligne par (compte, événement du lendemain). Voir l'en-tête (« QUI EST CONCERNÉ »).
create or replace function public.hb_veille_destinataires(p_jour date)
returns table (user_id uuid, event_id text, nom text, heure text)
language sql stable security definer set search_path = public as $$
  with ev as (
    select e.id, e.data
      from public.hb_events e
     where not e.deleted
       and not coalesce((e.data ->> 'archived')::boolean, false)
       and e.data ->> 'date' = (p_jour + 1)::text
  ),
  gens as (
    select ev.id, ev.data, x.uid
      from ev
      cross join lateral (
        select ev.data ->> 'createdBy' as uid
        union
        select public.hb_participants(ev.data)
      ) x
     where coalesce(x.uid, '') ~ '^[0-9a-fA-F-]{36}$'
  )
  select distinct pr.user_id,
         g.id,
         left(coalesce(nullif(btrim(g.data ->> 'name'), ''), 'Événement'), 60),
         -- Heure « HH:MM » (zéro devant : l'ordre du texte est celui des heures) ; illisible : null.
         case when g.data ->> 'time' ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]'
              then to_char(substring(g.data ->> 'time' from '^\d{1,2}:\d{2}')::time, 'HH24:MI') end
    from gens g
    join public.hb_profiles pr on pr.user_id = g.uid::uuid
   where pr.role in ('admin', 'preparateur', 'observateur')
     -- Branche (e) de la règle de lecture de hb_events (048) : créateur, ou participant (directement ou par un staff).
     and (pr.user_id::text = g.data ->> 'createdBy' or public.hb_participant_of(g.data, pr.user_id))
$$;

-- ---------- 4. Réservation de l'envoi du jour ----------

-- Comptes concernés qui ont au moins un appareil abonné et n'ont pas coupé « Rappel la veille », pas encore servis ce jour :
-- réserve l'envoi du jour (hb_veille_envois) pour au plus p_lot d'entre eux (l'événement le plus tôt le lendemain d'abord,
-- sans heure en dernier, puis l'identifiant du compte) et ne rend QUE les comptes réservés par cet appel (toutes leurs lignes).
-- notif : préférences (créneau « ne pas déranger »). Deux appels en même temps : la clé primaire départage (on conflict).
drop function if exists public.hb_veille_prendre(date);
create or replace function public.hb_veille_prendre(p_jour date, p_lot integer default 300)
returns table (user_id uuid, event_id text, nom text, heure text, notif jsonb)
language sql volatile security definer set search_path = public as $$
  with d as (
    select d.*
      from public.hb_veille_destinataires(p_jour) d
     where exists (select 1 from public.hb_push_subs s where s.user_id = d.user_id)
       and coalesce((select (p.notif ->> 'rappel')::boolean from public.hb_profiles p where p.user_id = d.user_id), true)
       and not exists (select 1 from public.hb_veille_envois v where v.user_id = d.user_id and v.jour = p_jour)
  ),
  lot as (
    select d.user_id, count(*) as n, min(d.heure) as premiere
      from d group by d.user_id
     order by min(d.heure) nulls last, d.user_id
     limit greatest(1, least(coalesce(p_lot, 300), 5000))
  ),
  pris as (
    insert into public.hb_veille_envois (user_id, jour, evenements)
    select lot.user_id, p_jour, lot.n from lot
    on conflict on constraint hb_veille_envois_pkey do nothing
    returning hb_veille_envois.user_id
  )
  select d.user_id, d.event_id, d.nom, d.heure, coalesce(pr.notif, '{}'::jsonb)
    from d
    join pris on pris.user_id = d.user_id
    left join public.hb_profiles pr on pr.user_id = d.user_id
   order by d.user_id, d.heure nulls last, d.nom, d.event_id
$$;

-- Bilan de l'envoi : [{ "u": compte, "a": appareils visés, "e": envois acceptés }, …].
create or replace function public.hb_veille_bilan(p_jour date, p_bilan jsonb)
returns integer language sql volatile security definer set search_path = public as $$
  with b as (
    select (x ->> 'u')::uuid as u, (x ->> 'a')::integer as a, (x ->> 'e')::integer as e
      from jsonb_array_elements(case when jsonb_typeof(p_bilan) = 'array' then p_bilan else '[]'::jsonb end) x
     where x ->> 'u' ~ '^[0-9a-fA-F-]{36}$'
  ),
  m as (
    update public.hb_veille_envois v set appareils = b.a, envoyes = b.e
      from b where v.user_id = b.u and v.jour = p_jour
    returning 1
  )
  select count(*)::integer from m
$$;

-- Droits : personne depuis l'appli ; seulement la clé de service (fonction d'envoi). hb_push_device : outil interne.
revoke all on function public.hb_push_device(text) from public, anon, authenticated;
revoke all on function public.hb_veille_destinataires(date) from public, anon, authenticated;
revoke all on function public.hb_veille_prendre(date, integer) from public, anon, authenticated;
revoke all on function public.hb_veille_bilan(date, jsonb) from public, anon, authenticated;
grant execute on function public.hb_veille_destinataires(date) to service_role;
grant execute on function public.hb_veille_prendre(date, integer) to service_role;
grant execute on function public.hb_veille_bilan(date, jsonb) to service_role;
-- hb_push_subscribe : comme 026 (comptes connectés).
revoke all on function public.hb_push_subscribe(text, text, text, text) from public, anon;
grant execute on function public.hb_push_subscribe(text, text, text, text) to authenticated;

-- ---------- Vérification (lecture seule) ----------
-- Attendu : t t t t f f f t t (colonnes, table, RLS, fonctions SECURITY DEFINER, aucun droit pour authenticated ni anon,
-- clé de service autorisée, index) ; puis les tâches programmées (veille : non tant qu'elle n'est pas activée ; rappels : oui
-- tant que la veille ne l'a pas remplacée).
select (select count(*) = 3 from information_schema.columns
          where table_schema = 'public' and table_name = 'hb_push_subs' and column_name in ('appareil', 'updated_at', 'last_ok_at')) as colonnes_abonnements,
       to_regclass('public.hb_veille_envois') is not null as table_envois,
       (select relrowsecurity from pg_class where oid = 'public.hb_veille_envois'::regclass) as rls_envois,
       (select bool_and(prosecdef) from pg_proc where oid in ('public.hb_veille_destinataires(date)'::regprocedure,
          'public.hb_veille_prendre(date, integer)'::regprocedure, 'public.hb_veille_bilan(date, jsonb)'::regprocedure)) as security_definer,
       has_function_privilege('authenticated', 'public.hb_veille_destinataires(date)', 'execute')
         or has_function_privilege('authenticated', 'public.hb_veille_prendre(date, integer)', 'execute') as appli_peut_lister,
       has_function_privilege('anon', 'public.hb_veille_prendre(date, integer)', 'execute') as anonyme_peut_prendre,
       has_table_privilege('authenticated', 'public.hb_veille_envois', 'select') as appli_lit_envois,
       has_function_privilege('service_role', 'public.hb_veille_prendre(date, integer)', 'execute') as service_peut_prendre,
       to_regclass('public.hb_events_date') is not null as index_date;
-- Tâches programmées (pg_cron) :
-- select jobname, schedule, active from cron.job where jobname in ('handbase-veille', 'handbase-rappels', 'handbase-notify');
-- Ce que la veille enverrait ce soir (comptes et événements de demain ; à lire, pas à diffuser) :
-- select d.user_id, pr.email, d.nom, d.heure, exists (select 1 from public.hb_push_subs s where s.user_id = d.user_id) as abonne
--   from public.hb_veille_destinataires((now() at time zone 'Europe/Paris')::date) d
--   join public.hb_profiles pr using (user_id) order by 2, 4;

-- ---------- ACTIVATION (à lancer À LA MAIN, après le déploiement de la fonction « veille » et de ses secrets) ----------
-- 1) Coffre (Vault) : l'adresse de la fonction et le mot de passe partagé avec elle (le même que le secret HB_NOTIFY_SECRET
--    de la fonction ; hb_notify_secret existe peut-être déjà, posé pour « notify » en 026) :
--      select vault.create_secret('https://<ref du projet>.supabase.co/functions/v1/veille', 'hb_veille_url');
--      select vault.create_secret('<mot de passe>', 'hb_notify_secret');   -- seulement s'il n'existe pas encore
-- 2) Extensions pg_cron et pg_net (Database > Extensions), puis la tâche : toutes les 5 minutes de 16 h à 20 h 55 UTC ; la
--    fonction n'envoie qu'entre 18 h et 22 h, heure de Paris (VEILLE_DEBUT, VEILLE_FIN : l'heure d'été et d'hiver sont
--    couvertes, les créneaux hors fenêtre ne font rien), un lot par appel (VEILLE_LOT, 300) et une seule fois par personne et
--    par jour (réservation) :
--      select cron.unschedule('handbase-rappels') where exists (select 1 from cron.job where jobname = 'handbase-rappels');
--      select cron.unschedule('handbase-veille') where exists (select 1 from cron.job where jobname = 'handbase-veille');
--      select cron.schedule('handbase-veille', '*/5 16-20 * * *', $job$
--        select net.http_post(
--          url := (select decrypted_secret from vault.decrypted_secrets where name = 'hb_veille_url'),
--          headers := jsonb_build_object('Content-Type', 'application/json',
--                       'x-hb-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hb_notify_secret')),
--          body := '{}'::jsonb,
--          timeout_milliseconds := 60000)
--      $job$);
-- 3) Essai sans attendre 18 h (n'importe quand, pour le jour donné ; réserve l'envoi du jour d'un lot de comptes concernés) :
--      select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'hb_veille_url'),
--        headers := jsonb_build_object('Content-Type', 'application/json',
--                     'x-hb-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hb_notify_secret')),
--        body := jsonb_build_object('jour', (now() at time zone 'Europe/Paris')::date, 'force', true));
--    Réponse : select status_code, content from net._http_response order by id desc limit 1;
-- Désactiver (et remettre le rappel de 026) :
--      select cron.unschedule('handbase-veille');
--      select cron.schedule('handbase-rappels', '0 16 * * *', 'select public.hb_enqueue_reminders()');

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- select cron.unschedule('handbase-veille') where exists (select 1 from cron.job where jobname = 'handbase-veille');
-- drop function if exists public.hb_veille_bilan(date, jsonb);
-- drop function if exists public.hb_veille_prendre(date, integer);
-- drop function if exists public.hb_veille_destinataires(date);
-- drop table if exists public.hb_veille_envois;
-- drop index if exists public.hb_events_date;
-- Abonnements : hb_push_subscribe de 026 (sans contrôle d'adresse), colonnes gardées (sans effet) ou retirées :
-- create or replace function public.hb_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
-- returns void language plpgsql security definer set search_path = public as $$
-- begin
--   if auth.uid() is null then raise exception 'Connexion requise'; end if;
--   insert into public.hb_push_subs (endpoint, user_id, p256dh, auth, user_agent)
--   values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 300))
--   on conflict (endpoint) do update
--     set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
-- end $$;
-- alter table public.hb_push_subs drop column if exists appareil, drop column if exists updated_at, drop column if exists last_ok_at;
-- drop function if exists public.hb_push_device(text);
-- Rappel de 026 : select cron.schedule('handbase-rappels', '0 16 * * *', 'select public.hb_enqueue_reminders()');
