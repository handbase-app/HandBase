-- Miroir de supabase/061_registre_changements.sql (lancer.sh, après essais.sql) : une vraie réponse du registre pour le comité
-- après des écritures (mesures, avis, « vu », joueur), et les lignes citées telles que le comité les relit (JSON, une ligne).
-- miroir.ts y applique src/registre.ts. Données fictives.
\set ON_ERROR_STOP 1
\o /dev/null
select essai.comme('00000000-0000-0000-0000-0000000000c1', 'select public.hb_registre_depuis(null)') ->> 'c' as c0 \gset
select essai.ecrire('00000000-0000-0000-0000-0000000000c1', 'measurements',
  format('{"id":"m-mir-%s","playerId":"j-0009","value":%s.5,"note":"Écrit « à la main » \\ é\\n","createdBy":"00000000-0000-0000-0000-0000000000c1","updatedAt":2000}', g, g)::jsonb)
  from generate_series(1, 6) g;
select essai.ecrire('00000000-0000-0000-0000-0000000000c1', 'players',
  (select data || '{"firstName": "Prénom changé", "updatedAt": 1800000000000}'::jsonb from public.hb_players where id = 'j-0027'));
\o
select json_build_object(
  'reponse', r,
  'lignes', (select json_agg(json_build_object('t', t, 'id', x.id, 'data', x.data, 'server_updated_at', x.server_updated_at))
               from jsonb_each(r -> 'e') e(t, l), jsonb_array_elements(l) c,
                    lateral (select id, data, server_updated_at from public.hb_measurements where e.t = 'measurements' and id = c ->> 0
                             union all select id, data, server_updated_at from public.hb_players where e.t = 'players' and id = c ->> 0) x
              where jsonb_typeof(l) = 'array'))
  from (select essai.comme('00000000-0000-0000-0000-0000000000c1', format('select public.hb_registre_depuis(%L)', :'c0')) as r) s;
