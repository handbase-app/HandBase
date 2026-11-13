-- Essais de supabase/068_rapports.sql (lancer.sh) : comptes fictifs, données fictives seulement. Toute erreur arrête.
-- Chacun les siens (administrateur compris : il ne voit ni ne retire ceux des autres) ; compte joueur, sans rôle, anon : rien ;
-- compte, source, création et expiration posés par le serveur ; pas de modification ; titre nettoyé ; contenu borné ; 50
-- gardés au plus ; ménage des expirés à la création ; purge ; compte supprimé : ses rapports partent.
\set ON_ERROR_STOP 1
create schema if not exists essai;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'preparateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'autre@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000d1', 'preparateur@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000d2', 'autre@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test', null)
on conflict (user_id) do update set role = excluded.role;

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

create or replace function essai.attendu(p_quoi text, p_vu text, p_attendu text) returns void
language plpgsql as $$
begin
  if p_vu is distinct from p_attendu then raise exception 'ÉCHEC % : % au lieu de %', p_quoi, p_vu, p_attendu; end if;
  raise notice 'ok : %', p_quoi;
end $$;

do $$
declare
  d1 text := '00000000-0000-0000-0000-0000000000d1';
  d2 text := '00000000-0000-0000-0000-0000000000d2';
  a1 text := '00000000-0000-0000-0000-0000000000a1';
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  f1 text := '00000000-0000-0000-0000-0000000000f1';
  r1 text := '20000000-0000-0000-0000-000000000001';
  ins text := 'insert into public.hb_rapports (id, titre, contenu) values (%L, %L, %L)';
  md text := E'# Gauchers 2011 du Var\n\n| Code | Poste | Sprint 10 m |\n|---|---|---|\n| J-GV5CX3M | ARG | 1,86 |\n';
  i int;
begin
  -- Création, compte et horloge du serveur.
  perform essai.attendu('création par son auteur', essai.comme(d1, format(ins, r1, 'Gauchers 2011', md)), '1');
  perform essai.attendu('user_id posé par le serveur', (select user_id::text from public.hb_rapports where id = r1::uuid), d1);
  perform essai.attendu('source « mcp »', (select source from public.hb_rapports where id = r1::uuid), 'mcp');
  perform essai.attendu('expire 30 jours après la création', (select (expires_at = created_at + interval '30 days')::text from public.hb_rapports where id = r1::uuid), 'true');
  perform essai.comme(d1, format('insert into public.hb_rapports (titre, contenu, created_at, expires_at, user_id) values (%L, %L, %L, %L, %L)',
    'horloge', md, '2030-01-01', '2099-01-01', d2));
  perform essai.attendu('horloge et compte de l''appareil ignorés',
    (select (created_at = now() and expires_at = now() + interval '30 days' and user_id::text = d1)::text from public.hb_rapports where titre = 'horloge'), 'true');
  -- Droits.
  perform essai.attendu('son auteur les lit', essai.comme(d1, 'select * from public.hb_rapports'), '2');
  perform essai.attendu('un autre ne les voit pas', essai.comme(d2, 'select * from public.hb_rapports'), '0');
  perform essai.attendu('un administrateur ne les voit pas', essai.comme(a1, 'select * from public.hb_rapports'), '0');
  perform essai.attendu('un compte joueur ne les voit pas', essai.comme(e1, 'select * from public.hb_rapports'), '0');
  perform essai.attendu('un compte sans rôle ne les voit pas', essai.comme(f1, 'select * from public.hb_rapports'), '0');
  perform essai.attendu('anon : aucun droit', essai.comme(null, 'select * from public.hb_rapports'), 'ERR 42501');
  perform essai.attendu('anon : pas d''écriture', essai.comme(null, format(ins, gen_random_uuid(), 't', md)), 'ERR 42501');
  perform essai.attendu('compte joueur : pas d''écriture', essai.comme(e1, format(ins, gen_random_uuid(), 't', md)), 'ERR 42501');
  perform essai.attendu('compte sans rôle : pas d''écriture', essai.comme(f1, format(ins, gen_random_uuid(), 't', md)), 'ERR 42501');
  perform essai.attendu('pas de modification (même son auteur)', essai.comme(d1, format('update public.hb_rapports set contenu = %L where id = %L', 'x', r1)), 'ERR 42501');
  perform essai.attendu('un administrateur ne le retire pas', essai.comme(a1, format('delete from public.hb_rapports where id = %L', r1)), '0');
  perform essai.attendu('un autre ne le retire pas', essai.comme(d2, format('delete from public.hb_rapports where id = %L', r1)), '0');
  -- Contenu borné.
  perform essai.attendu('source inconnue : remise à « mcp »', essai.comme(d1, format('insert into public.hb_rapports (source, titre, contenu) values (%L, %L, %L)', 'courriel', 'src', md)), '1');
  perform essai.attendu('… « mcp »', (select source from public.hb_rapports where titre = 'src'), 'mcp');
  perform essai.attendu('contenu vide : refusé', essai.comme(d1, format(ins, gen_random_uuid(), 't', '   ')), 'ERR P0001');
  perform essai.attendu('100 000 caractères : acceptés', essai.comme(d1, format(ins, gen_random_uuid(), 'long', repeat('x', 100000))), '1');
  perform essai.attendu('100 001 caractères : refusés', essai.comme(d1, format(ins, gen_random_uuid(), 't', repeat('x', 100001))), 'ERR P0001');
  perform essai.comme(d1, format(ins, gen_random_uuid(), E'  Rapport\t\nsaison   ' || repeat('é', 200), md));
  perform essai.attendu('titre nettoyé et coupé à 120', (select length(titre)::text || ' ' || left(titre, 14) from public.hb_rapports where titre like 'Rapport saison%'), '120 Rapport saison');
  perform essai.comme(d1, format(ins, gen_random_uuid(), '   ', 'sans titre'));
  perform essai.attendu('titre vide : « Rapport »', (select titre from public.hb_rapports where contenu = 'sans titre'), 'Rapport');
  -- Son auteur le retire.
  perform essai.attendu('son auteur le retire', essai.comme(d1, format('delete from public.hb_rapports where titre = %L', 'long')), '1');
  -- 50 gardés au plus ; les expirés partent à la création.
  delete from public.hb_rapports;
  for i in 1..50 loop perform essai.comme(d1, format(ins, gen_random_uuid(), 'r' || i, md)); end loop;
  perform essai.attendu('50 gardés', (select count(*)::text from public.hb_rapports where user_id = d1::uuid), '50');
  perform essai.attendu('51e : refusé', essai.comme(d1, format(ins, gen_random_uuid(), 'r51', md)), 'ERR P0001');
  perform essai.attendu('un autre compte n''est pas gêné', essai.comme(d2, format(ins, gen_random_uuid(), 'autre', md)), '1');
  alter table public.hb_rapports disable trigger hb_rapports_garde;
  update public.hb_rapports set expires_at = now() - interval '1 minute' where titre in ('r1', 'r2');
  alter table public.hb_rapports enable trigger hb_rapports_garde;
  perform essai.attendu('expirés effacés à la création, place libérée', essai.comme(d1, format(ins, gen_random_uuid(), 'r51', md)), '1');
  perform essai.attendu('… 49 anciens + 1', (select count(*)::text from public.hb_rapports where user_id = d1::uuid), '49');
  -- Purge.
  alter table public.hb_rapports disable trigger hb_rapports_garde;
  update public.hb_rapports set expires_at = now() - interval '1 minute' where titre in ('r3', 'autre');
  alter table public.hb_rapports enable trigger hb_rapports_garde;
  perform essai.attendu('purge : les expirés seulement', public.hb_rapports_purger()::text, '2');
  perform essai.attendu('l''appli ne lance pas la purge', has_function_privilege('authenticated', 'public.hb_rapports_purger()', 'execute')::text, 'false');
  -- Compte supprimé : ses rapports partent.
  delete from auth.users where id = d1::uuid;
  perform essai.attendu('compte supprimé : ses rapports partent', (select count(*)::text from public.hb_rapports where user_id = d1::uuid), '0');
end $$;
