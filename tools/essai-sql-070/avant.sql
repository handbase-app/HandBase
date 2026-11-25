-- Avant 070 (lancer.sh) : des propositions déjà dans la boîte (067), d'un compte qui ne sert pas aux essais de 067. Elles
-- doivent rester telles quelles après 070 (essais.sql). Données fictives.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'avant@exemple.test') on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values ('00000000-0000-0000-0000-0000000000b1', 'avant@exemple.test', 'preparateur')
on conflict (user_id) do update set role = excluded.role;
select set_config('test.uid', '', false);
insert into public.hb_propositions (id, user_id, source, titre, contexte, lignes) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'collage', 'Tests gardés avant 070', '{"portee":"tous"}', '[["Joueur","Taille"],["Essai Fictif","170"]]'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', 'mcp', 'Déposée par Claude avant 070', '{"portee":"tous"}', '[["Joueur","CMJ"],["Autre Fictif","31"]]');
update public.hb_propositions set etat = 'validee' where id = '20000000-0000-0000-0000-000000000002';
do $$ begin raise notice 'ok : 2 propositions posées avant 070'; end $$;
