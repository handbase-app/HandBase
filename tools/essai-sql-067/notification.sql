-- Essais de la notification de 067 (lancer.sh, après essais.sql) : le déclencheur hb_propositions_signal de la section
-- ACTIVATION est posé, avec un faux coffre et un faux pg_net qui note les appels (essai.appels). Une proposition collée dans
-- l'appli : aucun appel ; déposée par le serveur MCP ou lue sur une photo : un appel à la fonction « veille » avec
-- { type: "proposition", id } et le mot de passe partagé ; une modification : aucun appel ; coffre vide ou pg_net en panne :
-- la proposition est quand même enregistrée. Comptes fictifs.
\set ON_ERROR_STOP 1
do $$
declare
  d2 text := '00000000-0000-0000-0000-0000000000d2';
  ins text := 'insert into public.hb_propositions (id, source, titre, lignes) values (%L, %L, %L, %L::jsonb)';
  lig text := '[["Joueur","Taille"],["Lucas Exemple","172"]]';
  m1 uuid := gen_random_uuid();
begin
  delete from essai.appels;
  perform essai.attendu('collée dans l''appli : enregistrée', essai.comme(d2, format(ins, gen_random_uuid(), 'collage', 'collée', lig)), '1');
  perform essai.attendu('… aucun appel', (select count(*)::text from essai.appels), '0');
  perform essai.attendu('déposée par le serveur MCP : enregistrée', essai.comme(d2, format(ins, m1, 'mcp', 'Tests rentrée Pôle', lig)), '1');
  perform essai.attendu('… un appel', (select count(*)::text from essai.appels), '1');
  perform essai.attendu('… à la fonction « veille »', (select url from essai.appels), 'https://exemple.test/functions/v1/veille');
  perform essai.attendu('… { type: proposition, id } seulement (ni ligne, ni titre)', (select body::text from essai.appels),
    jsonb_build_object('type', 'proposition', 'id', m1)::text);
  perform essai.attendu('… avec le mot de passe partagé', (select headers ->> 'x-hb-secret' from essai.appels), 'secret-fictif');
  perform essai.attendu('lue sur une photo : enregistrée', essai.comme(d2, format(ins, gen_random_uuid(), 'photo', 'photo', lig)), '1');
  perform essai.attendu('… un appel de plus', (select count(*)::text from essai.appels), '2');
  perform essai.comme(d2, format('update public.hb_propositions set etat = %L where id = %L', 'validee', m1));
  perform essai.attendu('modification : aucun appel', (select count(*)::text from essai.appels), '2');
end $$;

-- Coffre vide : rien n'est appelé, la proposition est enregistrée.
create or replace view vault.decrypted_secrets as select 'x'::text as name, 'y'::text as decrypted_secret where false;
do $$
begin
  perform essai.attendu('coffre vide : enregistrée', essai.comme('00000000-0000-0000-0000-0000000000d2',
    'insert into public.hb_propositions (source, titre, lignes) values (''mcp'', ''sans coffre'', ''[["a"]]''::jsonb)'), '1');
  perform essai.attendu('… aucun appel', (select count(*)::text from essai.appels), '2');
end $$;

-- pg_net en panne : la proposition est quand même enregistrée (avertissement seulement).
create or replace view vault.decrypted_secrets as
  select * from (values ('hb_veille_url'::text, 'https://exemple.test/functions/v1/veille'::text), ('hb_notify_secret', 'secret-fictif')) v(name, decrypted_secret);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000)
returns bigint language plpgsql as $$ begin raise exception 'pg_net en panne'; end $$;
do $$
begin
  perform essai.attendu('pg_net en panne : enregistrée quand même', essai.comme('00000000-0000-0000-0000-0000000000d2',
    'insert into public.hb_propositions (source, titre, lignes) values (''mcp'', ''panne'', ''[["a"]]''::jsonb)'), '1');
  perform essai.attendu('… elle est bien là', (select count(*)::text from public.hb_propositions where titre = 'panne'), '1');
end $$;
