-- Bouchons minimaux des schémas Supabase pour un Postgres 16 nu (tools/essai-sql-057/lancer.sh) : rôles, auth (auth.uid() lu dans
-- le réglage test.uid), realtime (messages, topic(), send), vault, net, cron, extensions, publication supabase_realtime.
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role supabase_admin nologin superuser; create role supabase_realtime_admin nologin;
create schema auth; create schema extensions; create schema vault; create schema net; create schema cron; create schema realtime;
create extension pgcrypto with schema extensions;
grant usage on schema auth, extensions, realtime to anon, authenticated, service_role;
-- Droits par défaut de Supabase sur public (tout pour anon, authenticated, service_role ; 040 retire ensuite l'écriture
-- directe et tout pour anon) : sans eux, une lecture SECURITY INVOKER (hb_upsert_lignes) bute sur des droits que la vraie base a.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}',
  created_at timestamptz default now(), last_sign_in_at timestamptz, encrypted_password text, email_confirmed_at timestamptz,
  aud text, role text, instance_id uuid, updated_at timestamptz, confirmation_token text, recovery_token text,
  email_change_token_new text, email_change text, deleted_at timestamptz, banned_until timestamptz, is_anonymous boolean default false);
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text, provider_id text, identity_data jsonb, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz, not_after timestamptz);
create table auth.refresh_tokens (id bigserial primary key, user_id text, session_id uuid, revoked boolean, created_at timestamptz, updated_at timestamptz);
create table auth.audit_log_entries (id uuid primary key default gen_random_uuid(), payload json, created_at timestamptz default now(), ip_address text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.role', true), ''), 'authenticated') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub', auth.uid(), 'role', auth.role()) $$;
create or replace function auth.email() returns text language sql stable as $$ select email from auth.users where id = auth.uid() $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create view vault.decrypted_secrets as select 'x'::text as name, 'y'::text as decrypted_secret where false;
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
create or replace function cron.unschedule(a text) returns boolean language sql as $$ select true $$;
create table cron.job (jobid bigserial, jobname text, schedule text, command text);
create publication supabase_realtime;
-- Realtime (canaux privés) : table des messages, sujet de la connexion, envoi.
create table realtime.messages (id bigserial, topic text not null, extension text not null, payload jsonb, event text,
  private boolean default false, updated_at timestamptz default now(), inserted_at timestamptz default now(), primary key (id));
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated, anon;
grant usage on sequence realtime.messages_id_seq to authenticated, anon;
create or replace function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '')::text $$;
grant execute on function realtime.topic() to authenticated, anon;
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
language plpgsql security definer as $$ begin
  insert into realtime.messages (payload, event, topic, private, extension) values (payload, event, topic, private, 'broadcast');
end $$;
