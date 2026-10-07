-- HandBase : notifications sur le téléphone (web push).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 025_nom_prenom.sql,
-- et APRÈS avoir déployé la fonction « notify » et créé ses secrets (voir README, « Notifications »).
--
-- Notifications envoyées (chacun choisit lesquelles dans Réglages → Notifications) :
--   avis         un avis attend une validation (hors liste sur un événement, ou spontané) :
--                organisateur et participants de l'événement, encadrants du secteur du joueur ;
--   fiche        une fiche proposée attend une validation : encadrants du secteur, administrateurs ;
--   participant  on t'a ajouté comme participant d'un événement ou d'un groupe ;
--   rappel       la veille d'un événement (vers 18 h) : son organisateur et ses participants.
--   suivi        (033) nouvelle mesure ou nouvel avis sur un joueur suivi : ceux qui le suivent.
-- On n'est jamais prévenu de sa propre action. Les notifications attendent dans hb_notifications ; la
-- fonction « notify » (appelée toutes les 2 minutes) les regroupe (« 3 avis à valider ») et les envoie,
-- sauf entre 21 h et 8 h (elles partent le matin).

-- ---------- Téléphones abonnés ----------

create table if not exists public.hb_push_subs (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists hb_push_subs_user on public.hb_push_subs (user_id);
-- Aucune lecture directe : seulement par les fonctions ci-dessous et la fonction d'envoi.
alter table public.hb_push_subs enable row level security;

create or replace function public.hb_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  insert into public.hb_push_subs (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;

create or replace function public.hb_push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.hb_push_subs where endpoint = p_endpoint and user_id = auth.uid()
$$;

-- ---------- Préférences (par compte ; absent = oui) ----------

alter table public.hb_profiles add column if not exists notif jsonb not null default '{}'::jsonb;

create or replace function public.hb_set_notif_prefs(p_prefs jsonb) returns void
language sql security definer set search_path = public as $$
  update public.hb_profiles
     set notif = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(p_prefs, '{}'::jsonb))
                   where key in ('avis', 'fiche', 'participant', 'rappel', 'alerte') and jsonb_typeof(value) = 'boolean')
   where user_id = auth.uid()
$$;

-- ---------- File d'attente ----------

create table if not exists public.hb_notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  -- Regroupement à l'envoi : même compte et même clé = une seule notification (« 3 avis à valider »).
  group_key text not null,
  title text not null,
  body text,
  -- Texte au pluriel quand il y en a plusieurs : « avis à valider (Tournoi X) » → « 3 avis à valider (Tournoi X) ».
  plural text,
  url text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists hb_notifications_pending on public.hb_notifications (created_at) where sent_at is null;
alter table public.hb_notifications enable row level security;

-- Met une notification en file, sauf pour l'auteur de l'action, un compte sans téléphone abonné, ou qui l'a coupée.
create or replace function public.hb_notify(p_user uuid, p_kind text, p_group text, p_title text, p_body text, p_plural text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user is not distinct from auth.uid() then return; end if;
  if not exists (select 1 from public.hb_push_subs where user_id = p_user) then return; end if;
  if (select coalesce((notif ->> p_kind)::boolean, true) from public.hb_profiles where user_id = p_user) is false then return; end if;
  insert into public.hb_notifications (user_id, kind, group_key, title, body, plural, url)
  values (p_user, p_kind, p_group, p_title, p_body, p_plural, p_url);
end $$;

-- Encadrants qui valident pour ce département (sans département attribué : tous).
create or replace function public.hb_sector_staff(p_dept text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select user_id from public.hb_profiles
   where role = 'preparateur' and (cardinality(departments) = 0 or p_dept = any (departments))
$$;

-- Organisateur et participants d'un événement.
create or replace function public.hb_event_people(p_event jsonb) returns setof uuid
language sql stable security definer set search_path = public as $$
  select pr.user_id from public.hb_profiles pr
   where pr.role in ('preparateur', 'admin')
     and (pr.user_id::text = p_event ->> 'createdBy' or coalesce(p_event -> 'editors', '[]'::jsonb) ? pr.user_id::text)
$$;

-- ---------- 1. Avis à valider ----------

create or replace function public.hb_notify_avis() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_player jsonb;
  v_event jsonb;
  v_name text;
  v_u uuid;
begin
  if new.deleted or new.data ->> 'review' is distinct from 'pending'
     or (tg_op = 'UPDATE' and old.data ->> 'review' = 'pending') then
    return null;
  end if;
  select data into v_player from public.hb_players where id = new.data ->> 'playerId';
  v_name := coalesce(public.hb_player_name(new.data ->> 'playerId'), 'un joueur');
  if coalesce(new.data ->> 'eventId', '') <> '' then
    select data into v_event from public.hb_events where id = new.data ->> 'eventId' and not deleted;
  end if;
  for v_u in
    select public.hb_sector_staff(public.hb_player_dept(v_player))
    union
    select public.hb_event_people(v_event) where v_event is not null
  loop
    if v_event is not null then
      perform public.hb_notify(v_u, 'avis', 'avis:' || (new.data ->> 'eventId'), 'Avis à valider',
        coalesce(new.data ->> 'observer', '?') || ' : ' || v_name || ' (hors liste, ' || coalesce(v_event ->> 'name', 'événement') || ')',
        'avis à valider (' || coalesce(v_event ->> 'name', 'événement') || ')', '/evenements/' || (new.data ->> 'eventId'));
    else
      perform public.hb_notify(v_u, 'avis', 'avis:spontane', 'Avis spontané à valider',
        coalesce(new.data ->> 'observer', '?') || ' : ' || v_name, 'avis spontanés à valider', '/avis-spontanes');
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists hb_notify_avis on public.hb_evaluations;
create trigger hb_notify_avis after insert or update on public.hb_evaluations
  for each row execute function public.hb_notify_avis();

-- ---------- 2. Fiches proposées à valider ----------

create or replace function public.hb_notify_fiche() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_u uuid;
  v_name text := trim(upper(coalesce(new.data ->> 'lastName', '')) || ' ' || coalesce(new.data ->> 'firstName', ''));
  v_more text := nullif(concat_ws(', ', left(new.data ->> 'birthDate', 4), new.data ->> 'club'), '');
begin
  if new.deleted or new.data ->> 'review' is distinct from 'pending'
     or (tg_op = 'UPDATE' and old.data ->> 'review' = 'pending') then
    return null;
  end if;
  for v_u in
    select public.hb_sector_staff(public.hb_player_dept(new.data))
    union
    select user_id from public.hb_profiles where role = 'admin'
  loop
    perform public.hb_notify(v_u, 'fiche', 'fiche', 'Fiche proposée',
      coalesce(new.data ->> 'createdByName', 'Un observateur') || ' propose ' || v_name || coalesce(' (' || v_more || ')', ''),
      'fiches proposées à valider', '/joueurs/' || new.id);
  end loop;
  return null;
end $$;
drop trigger if exists hb_notify_fiche on public.hb_players;
create trigger hb_notify_fiche after insert or update on public.hb_players
  for each row execute function public.hb_notify_fiche();

-- ---------- 4. Nouveau participant d'un événement ou d'un groupe ----------

create or replace function public.hb_notify_participant() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_u text;
  v_what text := case tg_table_name when 'hb_events' then 'à l’événement' else 'au groupe' end;
  v_url text := case tg_table_name when 'hb_events' then '/evenements/' else '/groupes/' end || new.id;
  v_who text := coalesce(new.data ->> 'createdByName', 'Un encadrant');
begin
  if new.deleted then return null; end if;
  for v_u in
    select e from jsonb_array_elements_text(coalesce(new.data -> 'editors', '[]'::jsonb)) e
     where tg_op = 'INSERT' or not (coalesce(old.data -> 'editors', '[]'::jsonb) ? e)
  loop
    perform public.hb_notify(v_u::uuid, 'participant', 'participant:' || new.id, 'Tu es participant',
      v_who || ' t’a ajouté ' || v_what || ' « ' || coalesce(new.data ->> 'name', '?') || ' »'
        || case when tg_table_name = 'hb_events' and new.data ? 'date' then ' (' || to_char((new.data ->> 'date')::date, 'DD/MM') || ')' else '' end,
      null, v_url);
  end loop;
  return null;
end $$;
drop trigger if exists hb_notify_participant on public.hb_events;
create trigger hb_notify_participant after insert or update on public.hb_events
  for each row execute function public.hb_notify_participant();
drop trigger if exists hb_notify_participant on public.hb_groups;
create trigger hb_notify_participant after insert or update on public.hb_groups
  for each row execute function public.hb_notify_participant();

-- ---------- 6. Rappel la veille d'un événement ----------

create or replace function public.hb_enqueue_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tomorrow date := (now() at time zone 'Europe/Paris')::date + 1;
  e record;
  v_u uuid;
  n integer := 0;
begin
  for e in
    select id, data from public.hb_events
     where not deleted and not coalesce((data ->> 'archived')::boolean, false) and data ->> 'date' = v_tomorrow::text
  loop
    for v_u in select public.hb_event_people(e.data) loop
      -- Une seule fois par événement et par personne, même si la tâche tourne deux fois.
      if not exists (select 1 from public.hb_notifications where user_id = v_u and group_key = 'rappel:' || e.id) then
        perform public.hb_notify(v_u, 'rappel', 'rappel:' || e.id, 'Demain : ' || coalesce(e.data ->> 'name', 'événement'),
          concat_ws(' · ', nullif(e.data ->> 'place', ''),
                    jsonb_array_length(coalesce(e.data -> 'playerIds', '[]'::jsonb)) || ' joueur(s) dans la liste'),
          null, '/evenements/' || e.id);
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- ---------- Notification de test (Réglages → Notifications) ----------

create or replace function public.hb_notif_test() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.hb_push_subs where user_id = auth.uid()) then
    raise exception 'Aucun téléphone abonné pour ce compte';
  end if;
  insert into public.hb_notifications (user_id, kind, group_key, title, body, url)
  values (auth.uid(), 'test', 'test', 'HandBase', 'Les notifications fonctionnent sur ce téléphone.', '/');
end $$;

revoke all on function public.hb_notify(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.hb_sector_staff(text) from public, anon, authenticated;
revoke all on function public.hb_event_people(jsonb) from public, anon, authenticated;
revoke all on function public.hb_enqueue_reminders() from public, anon, authenticated;
revoke all on function public.hb_push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.hb_push_unsubscribe(text) from public, anon;
revoke all on function public.hb_set_notif_prefs(jsonb) from public, anon;
revoke all on function public.hb_notif_test() from public, anon;

-- ---------- Tâches programmées (pg_cron + pg_net) ----------
-- Envoi toutes les 2 minutes : appelle la fonction « notify » avec l'adresse et le secret rangés dans le
-- coffre (Vault) : hb_notify_url et hb_notify_secret. Rappels : tous les jours à 16 h UTC (18 h l'été).
do $$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  perform cron.unschedule('handbase-notify') where exists (select 1 from cron.job where jobname = 'handbase-notify');
  perform cron.schedule('handbase-notify', '*/2 * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'hb_notify_url'),
      headers := jsonb_build_object('Content-Type', 'application/json',
                   'x-hb-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hb_notify_secret')),
      body := '{}'::jsonb)
    where exists (select 1 from public.hb_notifications where sent_at is null)
  $job$);
  perform cron.unschedule('handbase-rappels') where exists (select 1 from cron.job where jobname = 'handbase-rappels');
  perform cron.schedule('handbase-rappels', '0 16 * * *', 'select public.hb_enqueue_reminders()');
  raise notice 'Tâches programmées : envoi toutes les 2 minutes, rappels chaque jour.';
exception when others then
  raise notice 'Tâches non programmées (%) : activer pg_cron et pg_net (Database > Extensions), puis relancer ce script.', sqlerrm;
end $$;

-- Vérification : les tâches programmées et les secrets attendus (oui / non).
select (select count(*) from pg_extension where extname in ('pg_cron', 'pg_net')) as extensions_sur_2,
       exists (select 1 from vault.decrypted_secrets where name = 'hb_notify_url') as secret_url,
       exists (select 1 from vault.decrypted_secrets where name = 'hb_notify_secret') as secret_mot_de_passe;
