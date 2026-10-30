-- HandBase : filet de sécurité ÉCONOME (« quoi de neuf ? » qui ne fait plus relire ce que l'appareil a déjà).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 058_lecture_perimetre.sql (base de test d'abord, puis la réelle).
-- Peut être relancé sans risque (create or replace). Ne touche à aucune table, aucun index, aucune règle de lecture.
--
-- POURQUOI (essai de charge du 30/10, série 8, « jour J ») : hb_quoi_de_neuf (057) ne répondait « rien de neuf » que 3,8 à
-- 4,9 % du temps, pour deux raisons :
--  (a) curseur de moins de 5 minutes : elle regarde depuis curseur − 60 s (une ligne validée en retard peut porter une heure
--      antérieure au curseur) ; elle répond donc « oui » pendant 5 minutes après chaque réception, pour des lignes que
--      l'appareil a déjà, et l'appareil relit la table ;
--  (b) les lignes reçues en direct (ligne dans le signal, 057) n'avancent pas le curseur de l'appareil : le filet les relit une fois.
--
-- hb_filet(curseurs) : MÊMES curseurs que hb_quoi_de_neuf ({ table: heure, …, mes_affectations: heure }), même liste blanche,
-- mêmes règles ; pour chaque table, au lieu d'un booléen, une EMPREINTE de ce que le compte peut lire dans la FENÊTRE
-- [curseur − 60 s, maintenant] (dès qu'il y a quelque chose : même un curseur de plus de 5 minutes garde alors la minute de
-- recouvrement) :
--     { "n": lignes dans la fenêtre,
--       "e": sha256( concaténation triée des empreintes de lignes ), une empreinte de ligne étant les 16 premiers caractères
--            hexadécimaux de sha256( id || E'\n' || heure serveur en µs || E'\n' || data::text ),
--       "w": début de la fenêtre (µs depuis 1970), "m": plus grande heure serveur de la fenêtre,
--       "neuf": la réponse de hb_quoi_de_neuf pour ce curseur (booléen) }
--   - plus de 500 lignes dans la fenêtre : { "n": 501, "neuf": … } seulement (l'appareil fait comme avant) ;
--   - rien dans la fenêtre : { "n": 0, "w": …, "neuf": false } ; curseur de plus de 5 minutes et rien STRICTEMENT après lui
--     (plus aucune validation en retard possible avant lui, la règle de hb_quoi_de_neuf) : { "n": 0, "w": curseur + 1 µs,
--     "neuf": false }, aussi léger que hb_quoi_de_neuf (un « exists ») ;
--   - table inconnue du serveur : null ; clé sans curseur : true ; clé inconnue : ignorée (comme hb_quoi_de_neuf).
-- L'appareil (src/filet.ts, src/sync.ts) tient un registre des lignes du serveur qu'il a reçues dans la fenêtre (relectures,
-- ses propres envois, lignes reçues en direct) et calcule la même empreinte : identique, il a déjà tout, lignes validées en
-- retard comprises (même sûreté qu'avant), rien à relire, son curseur avance à « m » et ses lignes reçues en direct de la
-- fenêtre sont confirmées ; différente, il relit la table comme avant ; pas d'empreinte, ou registre incomplet : « neuf ».
--
-- SÉCURITÉ :
--  - SECURITY INVOKER : chaque lecture passe par les règles de lecture du compte connecté (staff_read 046, player_self_read 051,
--    toute règle future) ; la fonction ne rend que des comptes, une heure et une empreinte de lignes qu'il peut déjà lire en
--    entier par la synchronisation ; aucun paramètre ne choisit un périmètre (seulement les tables et leurs curseurs) ;
--  - joueurs, mesures, avis, « vu » : lus par hb_lire_perimetre (058, SECURITY INVOKER elle aussi, prouvée identique à la
--    lecture directe sous les règles par tools/essai-sql-058) : par les index du périmètre, sinon un compte de club lirait sous
--    les règles toutes les lignes du pays de la fenêtre ; sans 058 : lecture directe ;
--  - l'empreinte couvre le CONTENU (data::text) : une ligne reçue en direct d'un autre appareil n'est confirmée que si elle
--    est, octet pour octet, celle du serveur ; une ligne forgée ou erronée ne l'est jamais (l'appareil relit) ;
--  - search_path fixé (public, pg_temp), noms de tables par format(%I), liste blanche.
-- COMPATIBILITÉ : hb_quoi_de_neuf ne change pas (les appareils d'avant continuent avec leurs booléens) ; l'appli nouvelle sur
-- un serveur sans 059 (fonction absente) repasse d'elle-même à hb_quoi_de_neuf et redemande une heure plus tard.
-- MESURE (tools/essai-sql-059/lancer.sh --mesure, Postgres 15 jetable, jeu fictif de 058 : 500 000 joueurs, 3 M de mesures,
-- 1 M de « vu », plus une matinée de détection : 30 000 mesures et 10 000 « vu » dans les 4 dernières minutes ; un appel avec
-- les 19 curseurs, mesures et « vu » récents, le reste d'hier ; EXPLAIN ANALYZE, médiane de 5, cache chaud) :
--                       hb_filet    hb_quoi_de_neuf + relectures qui suivaient ses « oui » (évitées si l'empreinte est identique)
--   club                4,8-5,0 ms  2,4-2,7 ms + 1,7-1,8 ms   (fenêtre : 22 à 48 mesures, 6 à 17 « vu » du club)
--   comité (1 dép.)     5,8-6,4 ms  1,7-1,8 ms + 2,5-2,7 ms   (114 à 286 mesures)
--   ligue (6 dép.)      6,8-7,9 ms  1,7 ms     + 3,2-3,7 ms   (mesures : plus de 500, réponse d'avant)
--   administrateur      4,8 ms      1,4 ms     + 1,6-1,7 ms   (mesures et « vu » : plus de 500, réponse d'avant)
--   Le temps de base est du même ordre que l'ancien filet suivi de ses relectures (le gros du coût : hb_lire_perimetre, ~0,8 ms
--   par table de joueurs, mesures, avis ou « vu » qui a bougé, et le sha256 des lignes de la fenêtre) ; ce qui disparaît quand
--   l'empreinte est identique : 1 à 5 requêtes PostgREST par passage du filet (chacune avec sa transaction, son jeton, ses
--   règles), les lignes envoyées à l'appareil et leur écriture sur l'appareil. Une table sans rien de neuf (curseur ancien) ne
--   coûte qu'un « exists », comme avant. Plus de 500 lignes dans la fenêtre : l'empreinte n'est pas calculée.
-- Dépend de : 057 (colonne hb_assignments.user_id), 058 (hb_lire_perimetre, facultatif). pgcrypto inutile (sha256 de Postgres 11+).
-- Annulation : section « RETOUR ARRIÈRE » à la fin (commentée).

create or replace function public.hb_filet(curseurs jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_tables text[] := array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
                           'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log',
                           'saved_questions'];
  v_perimetre text[] := array['players', 'measurements', 'evaluations', 'seen'];
  v_plafond constant integer := 500;
  v_lire boolean := to_regprocedure('public.hb_lire_perimetre(text, timestamptz, integer)') is not null;
  t text;
  v_rel text;
  v_mine text;
  v_src text;
  v_cur timestamptz;
  v_w timestamptz;
  v_max timestamptz;
  v_n integer;
  v_e text;
  v_neuf boolean;
  v_recent boolean;
  v_out jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if jsonb_typeof(curseurs) is distinct from 'object' then raise exception 'curseurs : objet { table: heure } attendu'; end if;
  for t in select jsonb_object_keys(curseurs) loop
    -- Mêmes clés que hb_quoi_de_neuf : « mes_affectations » (affectations du compte, colonne user_id, $2), ou une table.
    if t = 'mes_affectations' then
      v_rel := 'assignments';
      v_mine := ' and user_id = $2';
    elsif t = any (v_tables) then
      v_rel := t;
      v_mine := '';
    else
      continue;
    end if;
    if to_regclass('public.hb_' || v_rel) is null then
      v_out := v_out || jsonb_build_object(t, null);
      continue;
    end if;
    begin
      v_cur := nullif(curseurs ->> t, '')::timestamptz;
    exception when others then
      v_cur := null; -- curseur illisible : tout relire
    end;
    if v_cur is null or not isfinite(v_cur) then
      v_out := v_out || jsonb_build_object(t, true);
      continue;
    end if;
    v_w := v_cur - interval '60 seconds';
    v_recent := clock_timestamp() - v_cur < interval '5 minutes';
    -- Rien à empreinter, réponse aussi légère que hb_quoi_de_neuf :
    --  - curseur ancien (plus de 5 minutes : plus aucune validation en retard possible avant lui) et rien strictement après :
    --    fenêtre vide à partir du curseur (w = curseur + 1 µs) ;
    --  - curseur récent, petite table (hors joueurs, mesures, avis, « vu ») et rien dans la fenêtre.
    -- (Joueurs, mesures, avis, « vu » à curseur récent : directement l'empreinte par hb_lire_perimetre, dont le coût est borné
    -- par les index du périmètre ; un « exists » sous les règles parcourrait toutes les lignes du pays de la fenêtre.)
    if not v_recent then
      execute format('select exists (select 1 from public.%I where server_updated_at > $1%s)', 'hb_' || v_rel, v_mine)
        into v_neuf using v_cur, auth.uid()::text;
      if not v_neuf then
        v_out := v_out || jsonb_build_object(t, jsonb_build_object('n', 0, 'w', (extract(epoch from v_cur) * 1000000)::bigint + 1, 'neuf', false));
        continue;
      end if;
    elsif not (v_mine = '' and v_rel = any (v_perimetre) and v_lire) then
      execute format('select exists (select 1 from public.%I where server_updated_at >= $1%s)', 'hb_' || v_rel, v_mine)
        into v_neuf using v_w, auth.uid()::text;
      if not v_neuf then
        v_out := v_out || jsonb_build_object(t, jsonb_build_object('n', 0, 'w', (extract(epoch from v_w) * 1000000)::bigint, 'neuf', false));
        continue;
      end if;
    end if;
    -- Lignes de la fenêtre visibles par le compte, triées, au plus v_plafond + 1 ($1 début, $3 nombre).
    if v_mine = '' and v_rel = any (v_perimetre) and v_lire then
      v_src := format('select p.id, p.data, p.server_updated_at from public.hb_lire_perimetre(%L, $1, $3) p', v_rel);
    else
      v_src := format('select t.id, t.data, t.server_updated_at from public.%I t where t.server_updated_at >= $1%s
                        order by t.server_updated_at, t.id limit $3', 'hb_' || v_rel, v_mine);
    end if;
    execute format($q$
      select count(*)::integer, max(x.server_updated_at),
             encode(sha256(convert_to(string_agg(x.h, '' order by x.h collate "C"), 'UTF8')), 'hex')
        from (select s.server_updated_at,
                     -- (Plus de v_plafond lignes : pas d'empreinte, rien à calculer.)
                     case when count(*) over () <= $4 then
                       left(encode(sha256(convert_to(s.id || E'\n' || ((extract(epoch from s.server_updated_at) * 1000000)::bigint)::text
                                                     || E'\n' || s.data::text, 'UTF8')), 'hex'), 16) end as h
                from (%s) s) x
    $q$, v_src) into v_n, v_max, v_e using v_w, auth.uid()::text, v_plafond + 1, v_plafond;
    if v_n > v_plafond then
      -- Trop de lignes pour une empreinte : la réponse de hb_quoi_de_neuf (oui).
      -- (Curseur ancien : on sait déjà qu'il y a une ligne après lui ; récent : il y a des lignes dans la fenêtre.)
      v_neuf := true;
      v_out := v_out || jsonb_build_object(t, jsonb_build_object('n', v_n, 'neuf', v_neuf));
    else
      v_neuf := case when v_recent then v_n > 0 else coalesce(v_max > v_cur, false) end;
      v_out := v_out || jsonb_build_object(t, jsonb_strip_nulls(jsonb_build_object(
        'n', v_n, 'e', v_e, 'w', (extract(epoch from v_w) * 1000000)::bigint, 'm', v_max, 'neuf', v_neuf)));
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function public.hb_filet(jsonb) from public, anon;
grant execute on function public.hb_filet(jsonb) to authenticated;

-- ---------- Vérification (lecture seule) ----------
-- Attendu : fonction = t, invoker = t, search_path = t, ancienne = t (hb_quoi_de_neuf toujours là, pour les appareils d'avant),
-- lecture_perimetre = t (058 passé : joueurs, mesures, avis, « vu » lus par les index du périmètre).
select to_regprocedure('public.hb_filet(jsonb)') is not null as fonction,
       (select not prosecdef from pg_proc where oid = to_regprocedure('public.hb_filet(jsonb)')) as invoker,
       (select proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid = to_regprocedure('public.hb_filet(jsonb)')) as search_path,
       to_regprocedure('public.hb_quoi_de_neuf(jsonb)') is not null as ancienne,
       to_regprocedure('public.hb_lire_perimetre(text, timestamptz, integer)') is not null as lecture_perimetre;

-- Ce que voit un compte (remplacer <uuid> ; tout est annulé à la fin) :
-- begin;
--   select set_config('request.jwt.claims', json_build_object('sub', '<uuid>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   select public.hb_filet(jsonb_build_object('measurements', (now() - interval '2 minutes')::text, 'events', now()::text));
--   explain analyze select public.hb_filet(jsonb_build_object('measurements', (now() - interval '2 minutes')::text));
-- rollback;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script ; l'appli repasse d'elle-même à hb_quoi_de_neuf) ----------
-- drop function if exists public.hb_filet(jsonb);
