-- Essais de supabase/070_propositions_admin.sql (lancer.sh) : comptes fictifs, données fictives seulement. Toute erreur arrête.
-- Lignes d'avant 070 gardées telles quelles ; sorte « admin » créée et modifiée par un administrateur seulement (encadrant,
-- observateur, compte joueur, sans rôle, anon, administrateur rétrogradé : refus) ; clé de service : le compte donné doit
-- être administrateur ; forme (contexte.sorte, 1 à 50 actions, chaque action un objet) ; sorte inconnue refusée ; la sorte
-- ne change jamais ; les sortes de 067 restent ouvertes au staff ; chacun les siennes (un administrateur ne voit pas celles
-- d'un autre administrateur). À la fin : table vidée et rôles remis (les essais de 067 sont rejoués ensuite).
\set ON_ERROR_STOP 1
create schema if not exists essai;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'preparateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'autre@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000d1', 'preparateur@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000d2', 'autre@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test', null)
on conflict (user_id) do update set role = excluded.role;

-- Exécute p_sql comme le compte p_uid (rôle authenticated ; null : anon ; '' : clé de service, sans compte de session) ;
-- rend le nombre de lignes touchées ou lues, ou « ERR <code> ».
create or replace function essai.comme(p_uid text, p_sql text) returns text
language plpgsql as $$
declare n bigint;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  if p_uid is null then set local role anon; elsif p_uid = '' then set local role service_role; else set local role authenticated; end if;
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
  a1 text := '00000000-0000-0000-0000-0000000000a1';
  a2 text := '00000000-0000-0000-0000-0000000000a2';
  d1 text := '00000000-0000-0000-0000-0000000000d1';
  d2 text := '00000000-0000-0000-0000-0000000000d2';
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  f1 text := '00000000-0000-0000-0000-0000000000f1';
  x1 text := '30000000-0000-0000-0000-000000000001';
  ins text := 'insert into public.hb_propositions (id, source, kind, titre, contexte, lignes) values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)';
  insu text := 'insert into public.hb_propositions (user_id, source, kind, titre, contexte, lignes) values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)';
  ctx text := '{"sorte":"role","version":1}';
  act text := '[{"a":"role","userId":"00000000-0000-0000-0000-0000000000f1","compte":"C-0000000","nom":"Compte Fictif","role":"observateur","avant":null}]';
  lig text := '[["Joueur","Taille"],["Essai Fictif","170"]]';
  cinquante text := (select jsonb_agg(jsonb_build_object('a', 'archiver', 'quoi', 'evenement', 'id', 'ev-' || g, 'nom', 'Événement ' || g))::text from generate_series(1, 50) g);
  cinquante_et_un text := (select jsonb_agg(jsonb_build_object('a', 'archiver', 'quoi', 'evenement', 'id', 'ev-' || g, 'nom', 'Événement ' || g))::text from generate_series(1, 51) g);
begin
  -- Lignes d'avant 070.
  perform essai.attendu('propositions d''avant 070 gardées', (select count(*)::text from public.hb_propositions where user_id = '00000000-0000-0000-0000-0000000000b1'), '2');
  perform essai.attendu('… telles quelles (sorte, état, lignes)',
    (select string_agg(kind || ':' || etat || ':' || jsonb_array_length(lignes), ',' order by id) from public.hb_propositions where user_id = '00000000-0000-0000-0000-0000000000b1'),
    'mesures:en_attente:2,mesures:validee:2');

  -- Création : administrateur seulement.
  perform essai.attendu('un administrateur crée une proposition d''administration', essai.comme(a1, format(ins, x1, 'mcp', 'admin', 'Rôles à donner', ctx, act)), '1');
  perform essai.attendu('… à son nom, en attente', (select user_id::text || ':' || etat from public.hb_propositions where id = x1::uuid), a1 || ':en_attente');
  perform essai.attendu('un encadrant : refus', essai.comme(d1, format(insu, d1, 'mcp', 'admin', 't', ctx, act)), 'ERR 42501');
  perform essai.attendu('un observateur : refus', essai.comme(d2, format(insu, d2, 'mcp', 'admin', 't', ctx, act)), 'ERR 42501');
  perform essai.attendu('un compte joueur : refus', essai.comme(e1, format(insu, e1, 'mcp', 'admin', 't', ctx, act)), 'ERR 42501');
  perform essai.attendu('un compte sans rôle : refus', essai.comme(f1, format(insu, f1, 'mcp', 'admin', 't', ctx, act)), 'ERR 42501');
  perform essai.attendu('anon : refus', left(essai.comme(null, format(insu, a1, 'mcp', 'admin', 't', ctx, act)), 3), 'ERR');
  perform essai.attendu('un encadrant qui se dit administrateur (user_id d''un autre) : refus', essai.comme(d1, format(insu, a1, 'mcp', 'admin', 't', ctx, act)), 'ERR 42501');
  perform essai.attendu('clé de service, compte administrateur : accepté', essai.comme('', format(insu, a2, 'mcp', 'admin', 'service', ctx, act)), '1');
  perform essai.attendu('clé de service, compte encadrant : refus', essai.comme('', format(insu, d1, 'mcp', 'admin', 'service', ctx, act)), 'ERR 42501');
  perform essai.attendu('aucune ligne d''administration pour un encadrant', (select count(*)::text from public.hb_propositions where kind = 'admin' and user_id = d1::uuid), '0');

  -- Les sortes de 067 restent ouvertes au staff.
  perform essai.attendu('un encadrant dépose toujours des mesures', essai.comme(d1, format(insu, d1, 'mcp', 'mesures', 'Tests', '{"portee":"tous"}', lig)), '1');
  perform essai.attendu('un observateur aussi', essai.comme(d2, format(insu, d2, 'collage', 'mesures', 'Tests', '{"portee":"tous"}', lig)), '1');

  -- Forme.
  perform essai.attendu('50 actions : accepté', essai.comme(a1, format(insu, a1, 'mcp', 'admin', 'fin de saison', '{"sorte":"archiver"}', cinquante)), '1');
  perform essai.attendu('51 actions : refus', essai.comme(a1, format(insu, a1, 'mcp', 'admin', 'trop', '{"sorte":"archiver"}', cinquante_et_un)), 'ERR 23514');
  perform essai.attendu('sans sous-type : refus', essai.comme(a1, format(insu, a1, 'mcp', 'admin', 't', '{}', act)), 'ERR 23514');
  perform essai.attendu('sous-type inconnu : refus', essai.comme(a1, format(insu, a1, 'mcp', 'admin', 't', '{"sorte":"supprimer"}', act)), 'ERR 23514');
  perform essai.attendu('action qui n''est pas un objet : refus', left(essai.comme(a1, format(insu, a1, 'mcp', 'admin', 't', ctx, '[["role","x"]]')), 3), 'ERR');
  perform essai.attendu('sorte inconnue : refus', essai.comme(a1, format(insu, a1, 'mcp', 'autre', 't', ctx, act)), 'ERR 23514');
  perform essai.attendu('mesures : pas de limite à 50 (300 comme en 067)', essai.comme(d1, format(insu, d1, 'collage', 'mesures', 'gros', '{}', cinquante)), '1');

  -- Modification : administrateur seulement ; la sorte ne change jamais.
  perform essai.attendu('l''administrateur la valide', essai.comme(a1, format('update public.hb_propositions set etat = %L where id = %L', 'partielle', x1)), '1');
  perform essai.attendu('… lignes figées une fois traitée', essai.comme(a1, format('update public.hb_propositions set lignes = %L::jsonb, etat = %L where id = %L', cinquante, 'validee', x1)), '1');
  perform essai.attendu('… toujours ses lignes', (select jsonb_array_length(lignes)::text from public.hb_propositions where id = x1::uuid), '1');
  perform essai.attendu('« Défaire » : remise en attente', essai.comme(a1, format('update public.hb_propositions set etat = %L where id = %L', 'en_attente', x1)), '1');
  perform essai.attendu('un encadrant ne passe pas ses mesures en sorte « admin »',
    essai.comme(d1, format('update public.hb_propositions set kind = %L, contexte = %L::jsonb where user_id = %L and kind = %L', 'admin', ctx, d1, 'mesures')), '2');
  perform essai.attendu('… elles restent des mesures', (select count(*)::text from public.hb_propositions where user_id = d1::uuid and kind = 'mesures'), '2');
  perform essai.attendu('l''administrateur ne change pas la sorte non plus',
    essai.comme(a1, format('update public.hb_propositions set kind = %L where id = %L', 'mesures', x1)), '1');
  perform essai.attendu('… elle reste « admin »', (select kind from public.hb_propositions where id = x1::uuid), 'admin');

  -- Chacun les siennes.
  perform essai.attendu('un autre administrateur ne la voit pas', essai.comme(a2, format('select 1 from public.hb_propositions where id = %L', x1)), '0');
  perform essai.attendu('… ni ne la modifie', essai.comme(a2, format('update public.hb_propositions set etat = %L where id = %L', 'rejetee', x1)), '0');
  perform essai.attendu('un encadrant ne la voit pas', essai.comme(d1, format('select 1 from public.hb_propositions where id = %L', x1)), '0');

  -- Administrateur rétrogradé : ni création, ni modification de ses propositions d'administration.
  update public.hb_profiles set role = 'preparateur' where user_id = a1::uuid;
  perform essai.attendu('administrateur rétrogradé : plus de création', essai.comme(a1, format(insu, a1, 'mcp', 'admin', 't', ctx, act)), 'ERR 42501');
  perform essai.attendu('… ni de modification', essai.comme(a1, format('update public.hb_propositions set etat = %L where id = %L', 'rejetee', x1)), 'ERR 42501');
  perform essai.attendu('… ses mesures restent permises', essai.comme(a1, format(insu, a1, 'collage', 'mesures', 'Tests', '{}', lig)), '1');
  update public.hb_profiles set role = 'admin' where user_id = a1::uuid;
  perform essai.attendu('de nouveau administrateur : il la rejette', essai.comme(a1, format('update public.hb_propositions set etat = %L where id = %L', 'rejetee', x1)), '1');

  -- Ménage : la table vide pour les essais de 067 rejoués ensuite (les lignes d'avant 070 comprises), rôles remis.
  delete from public.hb_propositions;
  delete from public.hb_profiles where user_id in (a2::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid);
  delete from auth.users where id in (a2::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid);
end $$;
