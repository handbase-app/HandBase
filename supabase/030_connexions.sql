-- HandBase : qui est connecté, et journal des connexions de chaque membre (administrateurs seulement).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 029_securite.sql.
-- Peut être relancé sans risque.
--
-- L'appli signale toutes les minutes qu'elle est ouverte (hb_ping) : une ligne par ouverture de l'appli
-- (début, dernier signe de vie, type d'appareil ; pas d'adresse IP). Effacé au bout de 6 mois.

create table if not exists public.hb_connections (
  session_id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  device text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists hb_connections_user on public.hb_connections (user_id, last_seen_at desc);
create index if not exists hb_connections_seen on public.hb_connections (last_seen_at);

-- Lecture : administrateurs uniquement. Écriture : seulement via hb_ping.
alter table public.hb_connections enable row level security;
drop policy if exists "admin_read" on public.hb_connections;
create policy "admin_read" on public.hb_connections for select to authenticated
  using (exists (select 1 from public.hb_profiles a where a.user_id = (select auth.uid()) and a.role = 'admin'));
revoke all on public.hb_connections from public, anon, authenticated;
grant select on public.hb_connections to authenticated;

-- « L'appli est ouverte » : crée ou prolonge la session (celle d'un autre compte n'est jamais touchée).
create or replace function public.hb_ping(p_session uuid, p_device text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.hb_has_role() or p_session is null then return; end if;
  insert into public.hb_connections (session_id, user_id, device)
  values (p_session, auth.uid(), left(p_device, 60))
  on conflict (session_id) do update set last_seen_at = now(), device = excluded.device
   where hb_connections.user_id = excluded.user_id;
end $$;

-- Dernière connexion de chaque membre (administrateurs ; les autres ne reçoivent rien).
create or replace function public.hb_last_seen() returns table (user_id uuid, last_seen_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.user_id, max(c.last_seen_at) from public.hb_connections c
   where exists (select 1 from public.hb_profiles a where a.user_id = auth.uid() and a.role = 'admin')
   group by c.user_id
$$;

revoke all on function public.hb_ping(uuid, text) from public, anon;
revoke all on function public.hb_last_seen() from public, anon;
grant execute on function public.hb_ping(uuid, text) to authenticated;
grant execute on function public.hb_last_seen() to authenticated;

-- Effacement chaque nuit des connexions de plus de 6 mois (sans pg_cron : rien de grave).
do $$
begin
  perform cron.unschedule('handbase-connexions') where exists (select 1 from cron.job where jobname = 'handbase-connexions');
  perform cron.schedule('handbase-connexions', '37 3 * * *',
    $q$delete from public.hb_connections where last_seen_at < now() - interval '6 months'$q$);
exception when others then
  raise notice 'pg_cron indisponible (%) : effacement des vieilles connexions à faire à la main.', sqlerrm;
end $$;
