-- Essais de supabase/067_propositions.sql (lancer.sh) : comptes fictifs, données fictives seulement. Toute erreur arrête.
-- Chacun les siennes (administrateur compris : il ne voit ni ne touche celles des autres) ; compte joueur, sans rôle, anon :
-- rien ; compte, source, création et expiration posés par le serveur ; lignes et contexte bornés ; 30 en attente au plus,
-- 100 gardées au plus ; traitée : lignes figées ; remise en attente bornée ; retrait définitif ; ménage à la création ;
-- purge (expirées, traitées ou retirées depuis 7 jours) ; compte supprimé : ses propositions partent ; préférence de
-- notification « proposition » acceptée.
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

-- Exécute p_sql comme le compte p_uid (rôle authenticated ; null : anon) ; rend le nombre de lignes touchées ou lues, ou le
-- code d'erreur.
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
  ins text := 'insert into public.hb_propositions (id, source, titre, contexte, lignes) values (%L, %L, %L, %L::jsonb, %L::jsonb)';
  lig text := '[["Joueur","Sprint 10 m (s)","CMJ (cm)"],["Lucas Exemple","1,86","38"],["Emma Fictive","1,92","35"]]';
  ctx text := '{"portee":"evenement","id":"ev-fictif","nom":"Tests rentrée Pôle","date":"2026-09-05"}';
  i int;
begin
  -- Création, compte et horloge du serveur.
  perform essai.attendu('création par son auteur', essai.comme(d1, format(ins, x1, 'collage', 'Tests rentrée Pôle', ctx, lig)), '1');
  perform essai.attendu('user_id posé par le serveur', (select user_id::text from public.hb_propositions where id = x1::uuid), d1);
  perform essai.attendu('en attente à la création', (select etat from public.hb_propositions where id = x1::uuid), 'en_attente');
  perform essai.attendu('expire 30 jours après la création', (select (expires_at = created_at + interval '30 days')::text from public.hb_propositions where id = x1::uuid), 'true');
  perform essai.comme(d1, format('insert into public.hb_propositions (source, titre, lignes, etat, created_at, expires_at, updated_at, deleted_at)
    values (%L, %L, %L::jsonb, %L, %L, %L, %L, %L)', 'mcp', 'horloge', lig, 'validee', '2030-01-01', '2099-01-01', '2030-01-01', '2030-01-01'));
  perform essai.attendu('horloge de l''appareil ignorée (création, expiration, retrait, état)',
    (select (created_at = now() and expires_at = now() + interval '30 days' and updated_at = now() and deleted_at is null and etat = 'en_attente')::text
       from public.hb_propositions where titre = 'horloge'), 'true');
  -- Droits.
  perform essai.attendu('son auteur les lit', essai.comme(d1, 'select * from public.hb_propositions'), '2');
  perform essai.attendu('un autre ne les voit pas', essai.comme(d2, 'select * from public.hb_propositions'), '0');
  perform essai.attendu('un administrateur ne les voit pas', essai.comme(a1, 'select * from public.hb_propositions'), '0');
  perform essai.attendu('un compte joueur ne les voit pas', essai.comme(e1, 'select * from public.hb_propositions'), '0');
  perform essai.attendu('un compte sans rôle ne les voit pas', essai.comme(f1, 'select * from public.hb_propositions'), '0');
  perform essai.attendu('anon : aucun droit', essai.comme(null, 'select * from public.hb_propositions'), 'ERR 42501');
  perform essai.attendu('anon : pas d''écriture', essai.comme(null, format(ins, gen_random_uuid(), 'mcp', 't', '{}', lig)), 'ERR 42501');
  perform essai.attendu('un administrateur ne la modifie pas', essai.comme(a1, format('update public.hb_propositions set etat = %L where id = %L', 'rejetee', x1)), '0');
  perform essai.attendu('un administrateur ne la supprime pas', essai.comme(a1, format('delete from public.hb_propositions where id = %L', x1)), '0');
  perform essai.attendu('un autre ne la récrit pas', essai.comme(d2, format('update public.hb_propositions set titre = %L where id = %L', 'pris', x1)), '0');
  perform essai.comme(d2, format('insert into public.hb_propositions (user_id, titre, lignes) values (%L, %L, %L::jsonb)', d1, 'pour un autre', lig));
  perform essai.attendu('déposée « pour un autre compte » : reste à son auteur',
    (select user_id::text from public.hb_propositions where titre = 'pour un autre'), d2);
  perform essai.attendu('compte joueur : pas d''écriture', essai.comme(e1, format(ins, gen_random_uuid(), 'collage', 't', '{}', lig)), 'ERR 42501');
  perform essai.attendu('compte sans rôle : pas d''écriture', essai.comme(f1, format(ins, gen_random_uuid(), 'collage', 't', '{}', lig)), 'ERR 42501');
  -- Contenu borné.
  perform essai.attendu('source inconnue : refusée', essai.comme(d1, format(ins, gen_random_uuid(), 'courriel', 't', '{}', lig)), 'ERR 23514');
  perform essai.attendu('sorte inconnue : refusée', essai.comme(d1, format('insert into public.hb_propositions (kind, lignes) values (%L, %L::jsonb)', 'notes', lig)), 'ERR 23514');
  perform essai.attendu('sorte prévue (« avis ») : acceptée', essai.comme(d1, format('insert into public.hb_propositions (kind, titre, lignes) values (%L, %L, %L::jsonb)', 'avis', 'avis prévus', lig)), '1');
  perform essai.attendu('aucune ligne : refusée', essai.comme(d1, format(ins, gen_random_uuid(), 'collage', 't', '{}', '[]')), 'ERR P0001');
  perform essai.attendu('lignes qui ne sont pas un tableau : refusées', essai.comme(d1, format(ins, gen_random_uuid(), 'collage', 't', '{}', '{"a":1}')), 'ERR P0001');
  perform essai.attendu('ligne qui n''est pas une liste de cellules : refusée', essai.comme(d1, format(ins, gen_random_uuid(), 'collage', 't', '{}', '[["a"],42]')), 'ERR P0001');
  perform essai.attendu('ligne objet (cellules et rapprochement) : acceptée',
    essai.comme(d1, format(ins, gen_random_uuid(), 'mcp', 'objets', '{}', '[{"cellules":["J-A07","1,86"],"code":"J-A07"}]')), '1');
  perform essai.attendu('300 lignes : acceptées', essai.comme(d1, format(ins, gen_random_uuid(), 'collage', '300 lignes', '{}',
    (select jsonb_agg(jsonb_build_array('Joueur ' || g, '1,8' || (g % 10)))::text from generate_series(1, 300) g))), '1');
  perform essai.attendu('301 lignes : refusées', essai.comme(d1, format(ins, gen_random_uuid(), 'collage', 't', '{}',
    (select jsonb_agg(jsonb_build_array('Joueur ' || g))::text from generate_series(1, 301) g))), 'ERR P0001');
  perform essai.attendu('plus de 200 Ko : refusées', essai.comme(d1, format(ins, gen_random_uuid(), 'collage', 't', '{}',
    (select jsonb_agg(jsonb_build_array(repeat('x', 1000)))::text from generate_series(1, 210) g))), 'ERR P0001');
  perform essai.attendu('contexte de plus de 32 Ko : refusé', essai.comme(d1, format(ins, gen_random_uuid(), 'collage', 't',
    jsonb_build_object('nom', repeat('x', 33000))::text, lig)), 'ERR P0001');
  perform essai.attendu('contexte qui n''est pas un objet : remplacé par {}',
    essai.comme(d1, format(ins, gen_random_uuid(), 'collage', 'ctx liste', '[1,2]', lig)), '1');
  perform essai.attendu('… vide', (select contexte::text from public.hb_propositions where titre = 'ctx liste'), '{}');
  perform essai.comme(d1, format(ins, gen_random_uuid(), 'collage', E'  Tests\t\nrentrée   ' || repeat('é', 100), '{}', lig));
  perform essai.attendu('titre nettoyé et coupé à 80', (select length(titre)::text || ' ' || left(titre, 13) from public.hb_propositions where titre like 'Tests rentrée é%'), '80 Tests rentrée');
  perform essai.comme(d1, format(ins, gen_random_uuid(), 'collage', '   ', '{"nom":"sans titre"}', lig));
  perform essai.attendu('titre vide : « Proposition »', (select titre from public.hb_propositions where contexte ->> 'nom' = 'sans titre'), 'Proposition');
  -- Traitement.
  perform essai.attendu('validée en partie', essai.comme(d1, format('update public.hb_propositions set etat = %L where id = %L', 'partielle', x1)), '1');
  perform essai.comme(d1, format('update public.hb_propositions set user_id = %L, source = %L, kind = %L, created_at = %L, expires_at = %L where id = %L',
    d2, 'mcp', 'vus', '2020-01-01', '2099-01-01', x1));
  perform essai.attendu('compte, source, sorte, création, expiration inchangés',
    (select (user_id::text = d1 and source = 'collage' and kind = 'mesures' and created_at = now() and expires_at = now() + interval '30 days')::text
       from public.hb_propositions where id = x1::uuid), 'true');
  perform essai.comme(d1, format('update public.hb_propositions set lignes = %L::jsonb, titre = %L, etat = %L where id = %L', '[["autre"]]', 'autre titre', 'validee', x1));
  perform essai.attendu('traitée : lignes et titre figés, état changé',
    (select (lignes = lig::jsonb and titre = 'Tests rentrée Pôle' and etat = 'validee')::text from public.hb_propositions where id = x1::uuid), 'true');
  perform essai.attendu('remise en attente (« Défaire ») : permise', essai.comme(d1, format('update public.hb_propositions set etat = %L where id = %L', 'en_attente', x1)), '1');
  perform essai.attendu('rejetée', essai.comme(d1, format('update public.hb_propositions set etat = %L where id = %L', 'rejetee', x1)), '1');
  perform essai.attendu('état inconnu : refusé', essai.comme(d1, format('update public.hb_propositions set etat = %L where id = %L', 'perdue', x1)), 'ERR 23514');
  perform essai.attendu('retirée', essai.comme(d1, format('update public.hb_propositions set deleted_at = %L where id = %L', '2001-01-01', x1)), '1');
  perform essai.attendu('… date du retrait posée par le serveur', (select (deleted_at = now())::text from public.hb_propositions where id = x1::uuid), 'true');
  perform essai.comme(d1, format('update public.hb_propositions set deleted_at = null where id = %L', x1));
  perform essai.attendu('… et le reste', (select (deleted_at is not null)::text from public.hb_propositions where id = x1::uuid), 'true');
  -- 30 en attente au plus.
  delete from public.hb_propositions;
  for i in 1..30 loop
    perform essai.attendu('création ' || i, essai.comme(d1, format(ins, gen_random_uuid(), 'mcp', 'n' || i, '{}', lig)), '1');
  end loop;
  perform essai.attendu('la 31e en attente : refusée (boîte pleine)', essai.comme(d1, format(ins, gen_random_uuid(), 'mcp', 'n31', '{}', lig)), 'ERR P0001');
  perform essai.attendu('… un autre compte peut encore déposer', essai.comme(d2, format(ins, gen_random_uuid(), 'mcp', 'autre', '{}', lig)), '1');
  perform essai.comme(d1, 'update public.hb_propositions set etat = ''validee'' where titre = ''n1''');
  perform essai.attendu('une traitée libère une place', essai.comme(d1, format(ins, gen_random_uuid(), 'mcp', 'n31', '{}', lig)), '1');
  perform essai.attendu('remise en attente quand la boîte est pleine : refusée', essai.comme(d1, 'update public.hb_propositions set etat = ''en_attente'' where titre = ''n1'''), 'ERR P0001');
  perform essai.comme(d1, 'update public.hb_propositions set deleted_at = now() where titre = ''n2''');
  perform essai.attendu('une retirée libère une place', essai.comme(d1, format(ins, gen_random_uuid(), 'mcp', 'n32', '{}', lig)), '1');
  -- Ménage à la création : traitées ou retirées depuis 7 jours, expirées.
  alter table public.hb_propositions disable trigger hb_propositions_garde;
  update public.hb_propositions set updated_at = now() - interval '8 days' where titre in ('n1', 'n2');
  update public.hb_propositions set expires_at = now() - interval '1 minute' where titre = 'n3';
  alter table public.hb_propositions enable trigger hb_propositions_garde;
  perform essai.attendu('création : ménage du compte, place libérée', essai.comme(d1, format(ins, gen_random_uuid(), 'mcp', 'n33', '{}', lig)), '1');
  perform essai.attendu('… traitée, retirée et expirée effacées', (select count(*)::text from public.hb_propositions where titre in ('n1', 'n2', 'n3')), '0');
  perform essai.attendu('… celles d''un autre compte gardées', (select count(*)::text from public.hb_propositions where user_id = d2::uuid), '1');
  -- 100 gardées au plus (traitées comprises).
  alter table public.hb_propositions disable trigger hb_propositions_garde;
  insert into public.hb_propositions (user_id, titre, lignes, etat)
    select d1::uuid, 'gardée ' || g, lig::jsonb, 'rejetee' from generate_series(1, 100 - (select count(*) from public.hb_propositions where user_id = d1::uuid)) g;
  update public.hb_propositions set etat = 'validee' where titre = 'n4';
  alter table public.hb_propositions enable trigger hb_propositions_garde;
  perform essai.attendu('100 gardées : la suivante refusée', essai.comme(d1, format(ins, gen_random_uuid(), 'mcp', 'n101', '{}', lig)), 'ERR P0001');
  -- Purge.
  delete from public.hb_propositions;
  alter table public.hb_propositions disable trigger hb_propositions_garde;
  insert into public.hb_propositions (user_id, titre, lignes, etat, updated_at, expires_at, deleted_at) values
    (d1::uuid, 'récente', lig::jsonb, 'en_attente', now(), now() + interval '30 days', null),
    (d1::uuid, 'expirée', lig::jsonb, 'en_attente', now() - interval '31 days', now() - interval '1 day', null),
    (d1::uuid, 'traitée il y a 8 jours', lig::jsonb, 'validee', now() - interval '8 days', now() + interval '20 days', null),
    (d2::uuid, 'rejetée il y a 8 jours', lig::jsonb, 'rejetee', now() - interval '8 days', now() + interval '20 days', null),
    (d1::uuid, 'retirée il y a 8 jours', lig::jsonb, 'en_attente', now() - interval '8 days', now() + interval '20 days', now() - interval '8 days'),
    (d1::uuid, 'traitée il y a 2 jours', lig::jsonb, 'partielle', now() - interval '2 days', now() + interval '20 days', null),
    (d1::uuid, 'en attente depuis 20 jours', lig::jsonb, 'en_attente', now() - interval '20 days', now() + interval '10 days', null);
  alter table public.hb_propositions enable trigger hb_propositions_garde;
  perform essai.attendu('purge : l''appli ne peut pas la lancer', essai.comme(d1, 'select public.hb_propositions_purger()'), 'ERR 42501');
  perform essai.attendu('purge : 4 effacées', public.hb_propositions_purger()::text, '4');
  perform essai.attendu('… restent la récente, la traitée il y a 2 jours, celle en attente depuis 20 jours',
    (select string_agg(titre, ', ' order by titre) from public.hb_propositions), 'en attente depuis 20 jours, récente, traitée il y a 2 jours');
  perform essai.attendu('purge relancée : rien', public.hb_propositions_purger()::text, '0');
  -- Préférence de notification.
  perform essai.comme(d1, 'select public.hb_set_notif_prefs(''{"proposition": false, "inconnue": true}''::jsonb)');
  perform essai.attendu('préférence « proposition » gardée, clé inconnue retirée', (select notif::text from public.hb_profiles where user_id = d1::uuid), '{"proposition": false}');
  -- Compte supprimé.
  delete from auth.users where id = d1::uuid;
  perform essai.attendu('compte supprimé : ses propositions partent', (select count(*)::text from public.hb_propositions where user_id = d1::uuid), '0');
end $$;
