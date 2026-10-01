-- HandBase : schéma serveur Supabase
-- À exécuter une fois dans Supabase > SQL Editor.
--
-- Chaque table stocke la ligne complète de l'application dans `data` (jsonb).
-- `updated_at_client` sert à résoudre les conflits (la plus récente gagne),
-- `server_updated_at` sert aux appareils pour récupérer ce qui a changé.

do $$
declare t text;
begin
  foreach t in array array['players','criteria','measurements','events','evaluations'] loop
    execute format($f$
      create table if not exists public.hb_%1$s (
        id text primary key,
        data jsonb not null,
        updated_at_client bigint not null default 0,
        deleted boolean not null default false,
        server_updated_at timestamptz not null default clock_timestamp()
      );
      create index if not exists hb_%1$s_sua on public.hb_%1$s (server_updated_at);
      alter table public.hb_%1$s enable row level security;
      drop policy if exists "staff_all" on public.hb_%1$s;
      create policy "staff_all" on public.hb_%1$s for all to authenticated using (true) with check (true);
    $f$, t);
  end loop;
end $$;

create or replace function public.hb_touch() returns trigger language plpgsql as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['players','criteria','measurements','events','evaluations'] loop
    execute format('drop trigger if exists hb_touch on public.hb_%1$s;
      create trigger hb_touch before insert or update on public.hb_%1$s
      for each row execute function public.hb_touch();', t);
  end loop;
end $$;

-- Upsert « la plus récente gagne » appelé par l'application.
create or replace function public.hb_upsert(p_table text, p_rows jsonb)
returns void language plpgsql security invoker as $$
begin
  if p_table not in ('players','criteria','measurements','events','evaluations') then
    raise exception 'table inconnue %', p_table;
  end if;
  execute format($f$
    insert into public.hb_%1$s (id, data, updated_at_client, deleted)
    select r->>'id', r->'data', (r->>'updated_at_client')::bigint, coalesce((r->>'deleted')::boolean, false)
    from jsonb_array_elements($1) r
    on conflict (id) do update
      set data = excluded.data,
          updated_at_client = excluded.updated_at_client,
          deleted = excluded.deleted
      where public.hb_%1$s.updated_at_client <= excluded.updated_at_client
  $f$, p_table) using p_rows;
end $$;

grant execute on function public.hb_upsert(text, jsonb) to authenticated;
