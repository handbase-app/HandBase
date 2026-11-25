-- Essai de supabase/076_humeurs_multiples.sql (lancer.sh) : comptes, fiches et notes FICTIFS posés AVANT 076 (base où 052 → 075
-- sont passés). Les notes « anciennes » (une humeur dans mood) servent à vérifier la reprise moods = [mood].
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune1@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'jeune2@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune1@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e2', 'jeune2@exemple.test', 'joueur')
on conflict (user_id) do update set role = excluded.role;
insert into public.hb_players (id, data) values
  ('j-1', '{"id":"j-1","firstName":"Prénom","lastName":"Fictif Un","clubCode":"6383015","sex":"M"}'),
  ('j-2', '{"id":"j-2","firstName":"Prénom","lastName":"Fictif Deux","clubCode":"6383015","sex":"F"}');
update public.hb_profiles set player_id = 'j-' || right(user_id::text, 1)
 where user_id::text in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');

-- Notes d'avant 076 : deux avec une humeur, une sans, une retirée.
insert into public.hb_player_journal (id, player_id, user_id, at, text, mood, shared) values
  ('ancienne-1', 'j-2', '00000000-0000-0000-0000-0000000000e2', now() - interval '3 days', 'Note d''avant, contente', 'content', true),
  ('ancienne-2', 'j-2', '00000000-0000-0000-0000-0000000000e2', now() - interval '2 days', 'Note d''avant, pensive', 'pensif', false),
  ('ancienne-3', 'j-2', '00000000-0000-0000-0000-0000000000e2', now() - interval '1 days', 'Note d''avant, sans humeur', null, false);
insert into public.hb_player_journal (id, player_id, user_id, at, text, mood, deleted) values
  ('ancienne-4', 'j-2', '00000000-0000-0000-0000-0000000000e2', now() - interval '1 days', '', null, true);
