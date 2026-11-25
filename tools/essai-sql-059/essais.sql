-- Essais de supabase/059_filet_econome.sql (lancer.sh), sur le jeu fictif de tools/essai-sql-058/essais.sql (8 comptes :
-- administrateur, niveau Fédération, ligue, comité, club, observateur sans affectation, joueur, sans rôle ; 700 joueurs, 3 000
-- mesures, 1 500 avis, 1 000 « vu », 40 heures serveur distinctes). Données fictives seulement.
-- PREUVE : pour chaque compte, chaque clé et plusieurs curseurs, hb_filet rend le même nombre de lignes, la même plus grande
-- heure et la même empreinte que les lignes lues DIRECTEMENT sous les règles de lecture (RLS) dans la fenêtre
-- [curseur − 60 s, …] ; « neuf » est exactement la réponse de hb_quoi_de_neuf (compatibilité). Puis : plafond (plus de 500
-- lignes : pas d'empreinte), ligne validée en retard (heure antérieure au curseur) et contenu changé : empreinte différente ;
-- garde-fous. Toute erreur d'assertion arrête le script.
\set ON_ERROR_STOP 1

-- Lignes de la fenêtre lues directement sous RLS (référence), avec la même formule d'empreinte.
create function pg_temp.reference(p_uid text, p_rel text, p_cur timestamptz, p_mine boolean) returns jsonb
language plpgsql as $$
declare
  n integer;
  e text;
  m timestamptz;
  apres boolean;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  execute format($q$
    select count(*)::integer, max(server_updated_at),
           encode(sha256(convert_to(string_agg(h, '' order by h collate "C"), 'UTF8')), 'hex')
      from (select server_updated_at,
                   left(encode(sha256(convert_to(id || E'\n' || ((extract(epoch from server_updated_at) * 1000000)::bigint)::text
                                                 || E'\n' || data::text, 'UTF8')), 'hex'), 16) as h
              from public.%I where server_updated_at >= $1 %s
             order by server_updated_at, id limit 501) x $q$, 'hb_' || p_rel, case when p_mine then 'and user_id = $2' else '' end)
    into n, m, e using p_cur - interval '60 seconds', p_uid;
  execute format('select exists (select 1 from public.%I where server_updated_at > $1 %s)', 'hb_' || p_rel,
                 case when p_mine then 'and user_id = $2' else '' end) into apres using p_cur, p_uid;
  reset role;
  return jsonb_build_object('n', n, 'e', e, 'm', to_jsonb(m), 'apres', apres);
end $$;

-- Appel d'une fonction (hb_filet ou hb_quoi_de_neuf) comme le compte.
create function pg_temp.appel(p_uid text, p_fn text, p_curseurs jsonb) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  execute format('select public.%I($1)', p_fn) into r using p_curseurs;
  reset role;
  return r;
end $$;

-- Une matinée : copies de lignes du jeu (un dixième), écrites dans les 2 dernières minutes : curseurs RÉCENTS (moins de 5
-- minutes : recouvrement de 60 s, la règle qui faisait répondre « oui » pour rien).
set session_replication_role = replica;
do $$
declare t text;
begin
  foreach t in array array['players', 'measurements', 'evaluations', 'seen'] loop
    execute format($f$insert into public.hb_%1$s (id, data, server_updated_at, scope_dept, scope_club)
                      select 'r-' || id, jsonb_set(data, '{id}', to_jsonb('r-' || id)), now() - (abs(hashtext(id)) %% 120) * interval '1 second',
                             scope_dept, scope_club
                        from public.hb_%1$s where abs(hashtext(id || 'r')) %% 10 = 0 and id not like 'r-%%'$f$, t);
  end loop;
end $$;
set session_replication_role = default;

do $$
declare
  comptes text[] := array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
                          '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2',
                          '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1'];
  cles text[] := array['players', 'measurements', 'evaluations', 'seen', 'events', 'groups', 'criteria', 'units', 'assignments', 'mes_affectations'];
  -- Curseurs : avant tout (fenêtre pleine : plafond), dans le jeu, à la dernière heure, après (fenêtre partielle, puis vide).
  curseurs timestamptz[] := array['2026-10-01 11:00:00+00', '2026-10-01 12:00:20+00', '2026-10-01 12:00:39+00', '2026-10-01 12:01:10+00',
                                  '2026-10-01 12:01:30.5+00', '2026-10-01 12:01:39+00', '2026-10-01 12:01:41+00',
                                  now() - interval '200 seconds', now() - interval '90 seconds', now() - interval '30 seconds', now() + interval '1 second'];
  perimetre text[] := array['players', 'measurements', 'evaluations', 'seen'];
  recent boolean;
  legers integer := 0;
  u text;
  k text;
  c timestamptz;
  req jsonb;
  f jsonb;
  q jsonb;
  ref jsonb;
  essais integer := 0;
  empreintes integer := 0;
  plafonds integer := 0;
  vides integer := 0;
begin
  foreach u in array comptes loop
    foreach c in array curseurs loop
      req := '{}'::jsonb;
      foreach k in array cles loop req := req || jsonb_build_object(k, c::text); end loop;
      f := pg_temp.appel(u, 'hb_filet', req);
      q := pg_temp.appel(u, 'hb_quoi_de_neuf', req);
      foreach k in array cles loop
        ref := pg_temp.reference(u, case when k = 'mes_affectations' then 'assignments' else k end, c, k = 'mes_affectations');
        essais := essais + 1;
        -- Compatibilité : « neuf » = la réponse de hb_quoi_de_neuf.
        if (f -> k ->> 'neuf')::boolean is distinct from (q ->> k)::boolean then
          raise exception 'ÉCHEC neuf % % % : filet % / quoi_de_neuf %', u, k, c, f -> k, q -> k;
        end if;
        recent := clock_timestamp() - c < interval '5 minutes';
        -- Réponses légères : curseur ancien et rien après lui ; curseur récent, petite table, fenêtre vide.
        if (not recent and not (ref ->> 'apres')::boolean) or (recent and not (k = any (perimetre)) and (ref ->> 'n')::integer = 0) then
          legers := legers + 1;
          if f -> k is distinct from jsonb_build_object('n', 0, 'neuf', false, 'w',
               (extract(epoch from case when recent then c - interval '60 seconds' else c end) * 1000000)::bigint + case when recent then 0 else 1 end) then
            raise exception 'ÉCHEC réponse légère % % % : %', u, k, c, f -> k;
          end if;
        elsif (ref ->> 'n')::integer > 500 then
          plafonds := plafonds + 1;
          if (f -> k ->> 'n')::integer <> 501 or f -> k ? 'e' or f -> k ? 'w' then
            raise exception 'ÉCHEC plafond % % % : %', u, k, c, f -> k;
          end if;
        else
          if (f -> k ->> 'n')::integer is distinct from (ref ->> 'n')::integer
             or (f -> k ->> 'e') is distinct from (ref ->> 'e')
             or (f -> k -> 'm') is distinct from (case when ref -> 'm' = 'null'::jsonb then null else ref -> 'm' end)
             or (f -> k ->> 'w')::bigint is distinct from (extract(epoch from c - interval '60 seconds') * 1000000)::bigint then
            raise exception 'ÉCHEC empreinte % % % : filet % / référence %', u, k, c, f -> k, ref;
          end if;
          if (ref ->> 'n')::integer = 0 then vides := vides + 1; else empreintes := empreintes + 1; end if;
        end if;
      end loop;
    end loop;
  end loop;
  raise notice 'empreinte = lignes lues directement sous RLS, neuf = hb_quoi_de_neuf : % essais (% empreintes, % fenêtres vides, % plafonds, % réponses légères) : ok',
    essais, empreintes, vides, plafonds, legers;
  assert empreintes > 100 and vides > 10 and plafonds > 10 and legers > 50, 'jeu d''essai trop pauvre';
end $$;

-- Les comptes ne voient pas la même chose : le club et le comité n'ont pas la même empreinte (le jeu n'est pas trivial).
do $$
declare
  req jsonb := '{"measurements": "2026-10-01 12:01:30.5+00"}';
  club jsonb := pg_temp.appel('00000000-0000-0000-0000-0000000000d1', 'hb_filet', req);
  comite jsonb := pg_temp.appel('00000000-0000-0000-0000-0000000000c1', 'hb_filet', req);
  admin jsonb := pg_temp.appel('00000000-0000-0000-0000-0000000000a1', 'hb_filet', req);
  sansrole jsonb := pg_temp.appel('00000000-0000-0000-0000-0000000000f1', 'hb_filet', req);
begin
  assert (club -> 'measurements' ->> 'n')::int < (comite -> 'measurements' ->> 'n')::int, 'club < comité';
  assert (comite -> 'measurements' ->> 'n')::int < (admin -> 'measurements' ->> 'n')::int, 'comité < administrateur';
  assert club -> 'measurements' ->> 'e' <> comite -> 'measurements' ->> 'e', 'empreintes différentes';
  raise notice 'périmètres : club % lignes, comité %, administrateur % (plafond), ancien membre sans rôle %',
    club -> 'measurements' ->> 'n', comite -> 'measurements' ->> 'n', admin -> 'measurements' ->> 'n', sansrole -> 'measurements' ->> 'n';
end $$;

-- Ligne validée en retard (heure antérieure au curseur, dans la fenêtre), contenu changé, nouvelle ligne : empreinte différente.
-- Curseur récent (il y a 30 s : fenêtre depuis 90 s) ; une fiche du club d'abord, pour que la fenêtre ne soit pas vide.
do $$
declare
  club text := '00000000-0000-0000-0000-0000000000d1';
  req jsonb := jsonb_build_object('players', (now() - interval '30 seconds')::text);
  avant jsonb;
  apres jsonb;
begin
  set local session_replication_role = replica;
  insert into public.hb_players (id, data, server_updated_at, scope_dept, scope_club)
  values ('j-matin', '{"id":"j-matin","lastName":"Fictif matin","clubCode":"6383015","updatedAt":1}', now() - interval '20 seconds', '83', '6383015');
  set local session_replication_role = default;
  avant := pg_temp.appel(club, 'hb_filet', req) -> 'players';
  assert (avant ->> 'n')::int > 0 and avant ? 'e', 'fenêtre non vide';
  set local session_replication_role = replica;
  -- Une fiche du club validée en retard : heure il y a 50 s (avant le curseur, dans la fenêtre).
  insert into public.hb_players (id, data, server_updated_at, scope_dept, scope_club)
  values ('j-retard', '{"id":"j-retard","lastName":"Fictif retard","clubCode":"6383015","updatedAt":1}', now() - interval '50 seconds', '83', '6383015');
  set local session_replication_role = default;
  apres := pg_temp.appel(club, 'hb_filet', req) -> 'players';
  assert (apres ->> 'n')::int = (avant ->> 'n')::int + 1, 'ligne en retard comptée';
  assert apres ->> 'e' <> avant ->> 'e', 'ligne en retard : empreinte différente';
  assert apres ->> 'm' = avant ->> 'm', 'heure la plus récente inchangée (la ligne est antérieure)';
  -- Contenu changé sans changer l'heure (ligne forgée reçue en direct, ou écriture du serveur) : empreinte différente.
  avant := apres;
  set local session_replication_role = replica;
  update public.hb_players set data = data || '{"lastName":"Fictif changé"}' where id = 'j-retard';
  set local session_replication_role = default;
  apres := pg_temp.appel(club, 'hb_filet', req) -> 'players';
  assert (apres ->> 'n')::int = (avant ->> 'n')::int and apres ->> 'e' <> avant ->> 'e', 'contenu changé : empreinte différente';
  -- Une ligne hors du périmètre du club : rien ne change pour lui.
  avant := apres;
  set local session_replication_role = replica;
  insert into public.hb_players (id, data, server_updated_at, scope_dept, scope_club)
  values ('j-ailleurs', '{"id":"j-ailleurs","lastName":"Fictif ailleurs","clubCode":"6375003","updatedAt":1}', now() - interval '40 seconds', '75', '6375003');
  set local session_replication_role = default;
  apres := pg_temp.appel(club, 'hb_filet', req) -> 'players';
  assert apres = avant, 'ligne hors périmètre : invisible dans l''empreinte';
  raise notice 'ligne validée en retard, contenu changé : empreinte différente ; ligne hors périmètre : invisible : ok';
end $$;

-- Garde-fous : clés, curseurs illisibles, sans compte, anon, curseur ancien (neuf = strictement après), fonction d'avant intacte.
do $$
declare
  admin text := '00000000-0000-0000-0000-0000000000a1';
  r jsonb;
  ok boolean;
begin
  r := pg_temp.appel(admin, 'hb_filet', '{"inconnue": "2026-10-01", "players": "", "events": "pas une heure", "units": "-infinity"}');
  assert not r ? 'inconnue', 'clé inconnue ignorée';
  assert r -> 'players' = 'true'::jsonb and r -> 'events' = 'true'::jsonb and r -> 'units' = 'true'::jsonb, 'curseur vide ou illisible : true';
  -- Curseur ancien (plus de 5 minutes) : neuf = une ligne strictement après lui (comme hb_quoi_de_neuf), même si la fenêtre en a.
  r := pg_temp.appel(admin, 'hb_filet', '{"criteria": "2026-10-01 12:01:39+00"}');
  assert jsonb_typeof(r -> 'criteria') = 'object', 'réponse objet';
  -- Sans compte : refusé.
  perform set_config('test.uid', '', true);
  set local role authenticated;
  begin
    perform public.hb_filet('{"players": "2026-10-01"}');
    ok := false;
  exception when raise_exception then ok := true;
  end;
  reset role;
  assert ok, 'sans compte : refusé';
  set local role anon;
  begin
    perform public.hb_filet('{"players": "2026-10-01"}');
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  assert ok, 'anon : refusé';
  begin
    perform pg_temp.appel(admin, 'hb_filet', '[1, 2]');
    ok := false;
  exception when raise_exception then ok := true;
  end;
  assert ok, 'curseurs : objet attendu';
  assert (select not prosecdef from pg_proc where oid = 'public.hb_filet(jsonb)'::regprocedure), 'SECURITY INVOKER';
  -- La fonction d'avant (appareils d'avant) répond toujours par des booléens.
  r := pg_temp.appel(admin, 'hb_quoi_de_neuf', '{"players": "2026-10-01 12:00:00+00", "measurements": ""}');
  assert jsonb_typeof(r -> 'players') = 'boolean' and jsonb_typeof(r -> 'measurements') = 'boolean', 'hb_quoi_de_neuf inchangée';
  raise notice 'garde-fous (clés, curseurs, sans compte, anon, SECURITY INVOKER, hb_quoi_de_neuf inchangée) : ok';
end $$;
