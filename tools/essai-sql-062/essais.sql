-- Essais de supabase/062_mes_expressions.sql (lancer.sh) : comptes fictifs, données fictives seulement. Toute erreur arrête.
-- Chacun les siennes (administrateur compris : il ne voit ni ne touche celles des autres) ; compte joueur, sans rôle, anon :
-- rien ; un seul texte vivant par compte (majuscules indifférentes) ; version plus ancienne ignorée ; horloge bornée ;
-- cibles nettoyées ; suppression puis même texte de nouveau ; 150 au plus ; compte supprimé : ses expressions partent.
\set ON_ERROR_STOP 1
create schema if not exists essai;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'observateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'autre@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000d1', 'observateur@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000d2', 'autre@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test', null)
on conflict (user_id) do update set role = excluded.role;

-- Exécute p_sql comme le compte p_uid (rôle authenticated) ; rend le nombre de lignes touchées ou lues, ou le code d'erreur.
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
  x1 text := '10000000-0000-0000-0000-000000000001';
  ins text := 'insert into public.hb_expressions (id, texte, cibles, updated_at) values (%L, %L, %L::jsonb, %L)';
  ups text := 'insert into public.hb_expressions (id, texte, cibles, updated_at, deleted_at) values (%L, %L, %L::jsonb, %L, %L)
               on conflict (id) do update set texte = excluded.texte, cibles = excluded.cibles, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at';
  c2 text := '[{"criterionId":"engagement","sens":"haut"},{"criterionId":"combativite","sens":"haut"}]';
  i int;
begin
  perform essai.attendu('création par son auteur', essai.comme(d1, format(ins, x1, 'teigneux', c2, '2026-10-30 10:00+00')), '1');
  perform essai.attendu('user_id posé par le serveur', (select user_id::text from public.hb_expressions where id = x1::uuid), d1);
  perform essai.attendu('son auteur la lit', essai.comme(d1, 'select * from public.hb_expressions'), '1');
  perform essai.attendu('un autre ne la voit pas', essai.comme(d2, 'select * from public.hb_expressions'), '0');
  perform essai.attendu('un administrateur ne la voit pas', essai.comme(a1, 'select * from public.hb_expressions'), '0');
  perform essai.attendu('un compte joueur ne la voit pas', essai.comme(e1, 'select * from public.hb_expressions'), '0');
  perform essai.attendu('anon : aucun droit', essai.comme(null, 'select * from public.hb_expressions'), 'ERR 42501');
  perform essai.attendu('un administrateur ne la modifie pas', essai.comme(a1, format('update public.hb_expressions set texte = %L where id = %L', 'x', x1)), '0');
  perform essai.attendu('un administrateur ne la supprime pas', essai.comme(a1, format('delete from public.hb_expressions where id = %L', x1)), '0');
  perform essai.attendu('un autre ne la récrit pas par upsert', essai.comme(d2, format(ups, x1, 'pris', c2, '2026-10-30 11:00+00', null)), 'ERR 42501');
  perform essai.attendu('pas pour un autre compte (user_id imposé)', essai.comme(d2, format('insert into public.hb_expressions (id, user_id, texte, cibles) values (gen_random_uuid(), %L, %L, %L::jsonb)', d1, 'x', c2)), 'ERR 42501');
  perform essai.attendu('compte joueur : pas d''écriture', essai.comme(e1, format(ins, gen_random_uuid(), 'x', c2, now())), 'ERR 42501');
  perform essai.attendu('compte sans rôle : pas d''écriture', essai.comme(f1, format(ins, gen_random_uuid(), 'x', c2, now())), 'ERR 42501');
  perform essai.attendu('même texte (majuscules) : refusé', essai.comme(d1, format(ins, gen_random_uuid(), 'Teigneux', c2, now())), 'ERR 23505');
  perform essai.attendu('même texte chez un autre compte : permis', essai.comme(d2, format(ins, gen_random_uuid(), 'teigneux', c2, now())), '1');
  perform essai.attendu('version plus ancienne ignorée', essai.comme(d1, format(ups, x1, 'teigneux', '[{"criterionId":"mental","sens":"bas"}]', '2026-10-29 10:00+00', null)), '0');
  perform essai.attendu('… la version du serveur reste', ((select cibles ->> 0 from public.hb_expressions where id = x1::uuid) like '%engagement%')::text, 'true');
  perform essai.attendu('version plus récente gardée', essai.comme(d1, format(ups, x1, 'teigneux', '[{"criterionId":"mental","sens":"bas"},{"criterionId":"mental","sens":"haut"},{"criterionId":"x","sens":"tres"}]', '2026-10-31 10:00+00', null)), '1');
  perform essai.attendu('cibles nettoyées (doublon, sens inconnu)', (select cibles::text from public.hb_expressions where id = x1::uuid), '[{"sens": "bas", "criterionId": "mental"}]');
  perform essai.attendu('aucune cible valable : refusée', essai.comme(d1, format(ins, gen_random_uuid(), 'vide', '[{"criterionId":"x","sens":"?"}]', now())), 'ERR 23514');
  perform essai.attendu('4 cibles : refusée', essai.comme(d1, format(ins, gen_random_uuid(), 'trop', '[{"criterionId":"a","sens":"haut"},{"criterionId":"b","sens":"haut"},{"criterionId":"c","sens":"haut"},{"criterionId":"d","sens":"haut"}]', now())), 'ERR 23514');
  perform essai.attendu('texte de 61 caractères : refusé', essai.comme(d1, format(ins, gen_random_uuid(), repeat('a', 61), c2, now())), 'ERR 23514');
  perform essai.attendu('horloge en avance bornée', essai.comme(d1, format(ins, gen_random_uuid(), 'futur', c2, now() + interval '2 days')), '1');
  perform essai.attendu('… à 5 minutes', (select (updated_at <= now() + interval '5 minutes')::text from public.hb_expressions where texte = 'futur'), 'true');
  perform essai.comme(d1, format('update public.hb_expressions set user_id = %L, updated_at = now() + interval ''1 minute'' where id = %L', d2, x1));
  perform essai.attendu('le compte ne change pas', (select user_id::text from public.hb_expressions where id = x1::uuid), d1);
  perform essai.attendu('suppression (deleted_at, cibles vidées)', essai.comme(d1, format(ups, x1, 'teigneux', c2, now() + interval '2 minutes', now() + interval '2 minutes')), '1');
  perform essai.attendu('… cibles vidées', (select cibles::text from public.hb_expressions where id = x1::uuid), '[]');
  perform essai.attendu('même texte après suppression : permis', essai.comme(d1, format(ins, gen_random_uuid(), 'teigneux', c2, now())), '1');
  for i in 1..148 loop
    perform essai.comme(d1, format(ins, gen_random_uuid(), 'mot ' || i, c2, now()));
  end loop;
  perform essai.attendu('150 vivantes', (select count(*)::text from public.hb_expressions where user_id = d1::uuid and deleted_at is null), '150');
  perform essai.attendu('la 151e : refusée', essai.comme(d1, format(ins, gen_random_uuid(), 'encore une', c2, now())), 'ERR P0001');
  perform essai.attendu('… modifier une existante reste permis', essai.comme(d1, format(ups, (select id from public.hb_expressions where texte = 'mot 1'), 'mot 1', c2, now() + interval '1 second', null)), '1');
  delete from auth.users where id = d1::uuid;
  perform essai.attendu('compte supprimé : ses expressions partent', (select count(*)::text from public.hb_expressions where user_id = d1::uuid), '0');
end $$;
