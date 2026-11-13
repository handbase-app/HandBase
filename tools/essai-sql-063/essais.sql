-- Essais de supabase/063_affichage.sql (lancer.sh) : comptes fictifs, données fictives seulement. Toute erreur arrête.
-- Colonne présente et lisible (même requête que le rôle) ; chacun écrit SA ligne seulement ; formes refusées (rien d'écrit) ; nul : retour au défaut ; anon refusé ;
-- pas d'écriture directe de la colonne.
\set ON_ERROR_STOP 1
create schema if not exists essai;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'observateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'autre@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000d1', 'observateur@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000d2', 'autre@exemple.test', 'preparateur')
on conflict (user_id) do update set role = excluded.role;

-- Exécute p_sql comme le compte p_uid (rôle authenticated ; null : anon) ; rend le nombre de lignes, ou le code d'erreur.
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
  rpc text := 'select public.hb_set_affichage(%L::jsonb)';
  ok text := '{"pictos":["suivi","vu","avis"],"sousNom":["annee","age","club","poids"]}';
  ok2 text := '{"pictos":[],"sousNom":["taille"]}';
  lu text;
begin
  perform essai.attendu('colonne affichage présente',
    (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'hb_profiles' and column_name = 'affichage'), 'jsonb');
  perform essai.attendu('rien au départ', (select count(*)::text from public.hb_profiles where affichage is not null), '0');

  -- Écriture de sa ligne.
  perform essai.attendu('écrit par son compte', essai.comme(d1, format(rpc, ok)), '1');
  perform essai.attendu('… sa ligne a la valeur', (select affichage::text from public.hb_profiles where user_id = d1::uuid), ok::jsonb::text);
  perform essai.attendu('… les autres lignes ne bougent pas', (select count(*)::text from public.hb_profiles where affichage is not null), '1');
  perform essai.attendu('un autre compte écrit la sienne', essai.comme(d2, format(rpc, ok2)), '1');
  perform essai.attendu('… celle du premier reste', (select affichage::text from public.hb_profiles where user_id = d1::uuid), ok::jsonb::text);
  perform essai.attendu('un administrateur écrit la sienne seulement', essai.comme(a1, format(rpc, ok2)), '1');
  perform essai.attendu('… pas celle des autres', (select affichage::text from public.hb_profiles where user_id = d1::uuid), ok::jsonb::text);
  perform essai.attendu('lu avec le rôle (requête de l''appli)', essai.comme(d1, 'select role, departments, player_id, affichage from public.hb_profiles where user_id = auth.uid() and affichage is not null'), '1');

  -- Formes refusées : erreur 22023, rien n'est écrit.
  perform essai.attendu('pas un objet', essai.comme(d1, format(rpc, '["suivi"]')), 'ERR 22023');
  perform essai.attendu('texte seul', essai.comme(d1, format(rpc, '"suivi"')), 'ERR 22023');
  perform essai.attendu('un tableau manque', essai.comme(d1, format(rpc, '{"pictos":["suivi"]}')), 'ERR 22023');
  perform essai.attendu('clé de plus', essai.comme(d1, format(rpc, '{"pictos":[],"sousNom":[],"autre":1}')), 'ERR 22023');
  perform essai.attendu('pas un tableau', essai.comme(d1, format(rpc, '{"pictos":"suivi","sousNom":[]}')), 'ERR 22023');
  perform essai.attendu('pictogramme inconnu', essai.comme(d1, format(rpc, '{"pictos":["suivi","bidule"],"sousNom":[]}')), 'ERR 22023');
  perform essai.attendu('sous le nom inconnu', essai.comme(d1, format(rpc, '{"pictos":[],"sousNom":["annee","adresse"]}')), 'ERR 22023');
  perform essai.attendu('pas du texte', essai.comme(d1, format(rpc, '{"pictos":[1],"sousNom":[]}')), 'ERR 22023');
  perform essai.attendu('objet dans le tableau', essai.comme(d1, format(rpc, '{"pictos":[{"k":"suivi"}],"sousNom":[]}')), 'ERR 22023');
  perform essai.attendu('doublon', essai.comme(d1, format(rpc, '{"pictos":["vu","vu"],"sousNom":[]}')), 'ERR 22023');
  perform essai.attendu('trop long', essai.comme(d1, format(rpc, '{"pictos":["suivi","vu","revoir","videos","avis","mesures","pole","groupes","suivi"],"sousNom":[]}')), 'ERR 22023');
  perform essai.attendu('… la valeur enregistrée reste', (select affichage::text from public.hb_profiles where user_id = d1::uuid), ok::jsonb::text);

  -- Tout coché, tout décoché : permis.
  lu := '{"pictos":["suivi","vu","revoir","videos","avis","mesures","pole","groupes"],"sousNom":["annee","age","trimestre","club","departement","taille","poids","lateralite","categorie","envergure"]}';
  perform essai.attendu('tout coché', essai.comme(d1, format(rpc, lu)), '1');
  perform essai.attendu('tout décoché', essai.comme(d1, format(rpc, '{"pictos":[],"sousNom":[]}')), '1');
  -- Nul : retour au défaut.
  perform essai.attendu('nul : effacé', essai.comme(d1, 'select public.hb_set_affichage(null)'), '1');
  perform essai.attendu('… colonne nulle', (select (affichage is null)::text from public.hb_profiles where user_id = d1::uuid), 'true');

  -- Droits.
  perform essai.attendu('anon : refusé', essai.comme(null, format(rpc, ok)), 'ERR 42501');
  perform essai.attendu('pas d''écriture directe de la colonne', essai.comme(d1, format('update public.hb_profiles set affichage = %L::jsonb where user_id = auth.uid()', ok)), 'ERR 42501');
end $$;
