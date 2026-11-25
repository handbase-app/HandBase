-- Miroir (lancer.sh → miroir.ts) : lignes du serveur telles que l'appareil les reçoit (id, heure serveur en texte JSON, data)
-- avec l'empreinte de chaque ligne calculée par Postgres, et la réponse de hb_filet pour la même fenêtre. Données fictives :
-- une fenêtre ordinaire (joueurs du jeu de 058, administrateur) et des lignes au contenu difficile (guillemets, barres, retours à
-- la ligne, caractères de contrôle, émojis, clés non ASCII, objets et listes vides ou imbriqués), plus deux écritures que
-- l'appareil ne refait pas à l'identique (1.50 et 1e-7) : l'empreinte doit différer (relecture), jamais l'inverse.
\set ON_ERROR_STOP 1
create function pg_temp.lignes(p_debut timestamptz, p_fin timestamptz) returns json language sql as $$
  select coalesce(json_agg(json_build_object('id', id, 'sua', server_updated_at, 'data', data,
           'h', left(encode(sha256(convert_to(id || E'\n' || ((extract(epoch from server_updated_at) * 1000000)::bigint)::text
                                             || E'\n' || data::text, 'UTF8')), 'hex'), 16)) order by server_updated_at, id), '[]')
    from public.hb_players where server_updated_at >= p_debut and server_updated_at < p_fin
$$;
create function pg_temp.filet(p_cur text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', true);
  set local role authenticated;
  r := public.hb_filet(jsonb_build_object('players', p_cur));
  reset role;
  return r -> 'players';
end $$;
-- 1re ligne de sortie : fenêtre ordinaire (curseur 12:01:30 → fenêtre 12:00:30 → maintenant), avant les lignes difficiles.
select json_build_object('lignes', pg_temp.lignes('2026-10-01 12:00:30+00', 'infinity'), 'filet', pg_temp.filet('2026-10-01 12:01:30+00'));
set session_replication_role = replica;
insert into public.hb_players (id, data, server_updated_at, scope_dept, scope_club) values
  ('z-1', $j${"id":"z-1","lastName":"Élodie \"guillemets\" \\ barre / oblique","note":"ligne\nnouvelle\ttab\r\f\b","ctrl":"\u0001\u001f\u007f","emoji":"🤾‍♀️ ça","vide":{},"liste":[],"imbrique":{"b":[1,{"aa":true,"a":null,"":"clé vide"}],"a":"x"},"n":12.5,"neg":-3,"zero":0,"grand":1234567890123,"petit":0.001,"updatedAt":1761820000000}$j$, '2026-10-01 13:00:00.123456+00', '83', '6383015'),
  ('z-2', $j${"id":"z-2","é":1,"z":2,"ab":3,"ä":{"ü":[true,false]},"日本":"語","updatedAt":2}$j$, '2026-10-01 13:00:01+00', '83', '6383015'),
  ('z-3', $j${"id":"z-3","v":1.50,"updatedAt":3}$j$, '2026-10-01 13:00:02.5+00', '83', '6383015'),
  ('z-4', $j${"id":"z-4","v":1e-7,"updatedAt":4}$j$, '2026-10-01 13:00:03.000001+00', '83', '6383015');
set session_replication_role = default;
-- 2e ligne : contenu difficile seulement (curseur 13:01:00 → fenêtre 13:00:00 → maintenant).
select json_build_object('lignes', pg_temp.lignes('2026-10-01 13:00:00+00', 'infinity'), 'filet', pg_temp.filet('2026-10-01 13:01:00+00'));
