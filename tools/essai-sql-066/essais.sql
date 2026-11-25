-- Essais de supabase/066_mes_tests.sql (lancer.sh), APRÈS le script, sur le jeu fictif de avant.sql. Toute erreur arrête.
-- Le jeune : ses mesures seulement (supprimées comprises), jamais celles d'un autre jeune ; les tests (critères factuels),
-- pas les critères d'observation ; toujours ni avis ni autre fiche ; aucune écriture. Jeune sans fiche, sans rôle, anon :
-- rien. Staff : exactement ce qu'il lisait avant. Lecture par périmètre identique à la lecture directe (tous curseurs,
-- plusieurs tailles de page). Registre : une mesure nouvelle sur sa fiche lui est citée, celle d'un autre non.
\set ON_ERROR_STOP 1

do $$
declare
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  e2 text := '00000000-0000-0000-0000-0000000000e2';
  e3 text := '00000000-0000-0000-0000-0000000000e3';
  f1 text := '00000000-0000-0000-0000-0000000000f1';
  c record;
begin
  -- Le jeune 1 : ses 4 mesures (dont la supprimée : elle doit quitter son appareil), par les deux lectures.
  perform essai.attendu('jeune 1 : ses mesures seulement (supprimée comprise)', essai.ids(e1, 'measurements', 'direct'), 'm-1a,m-1b,m-1c,m-1d');
  perform essai.attendu('jeune 1 : … même chose par la lecture par périmètre', essai.ids(e1, 'measurements', 'perimetre'), 'm-1a,m-1b,m-1c,m-1d');
  perform essai.attendu('jeune 1 : aucune mesure d''une autre fiche',
    essai.vu(e1, $q$select count(*)::text from public.hb_measurements where data ->> 'playerId' <> 'j-1'$q$), '0');
  -- Le jeune 2 : les siennes, pas celles du jeune 1.
  perform essai.attendu('jeune 2 : ses mesures seulement', essai.ids(e2, 'measurements', 'direct'), 'm-2a,m-2b');
  perform essai.attendu('jeune 2 : … par la lecture par périmètre', essai.ids(e2, 'measurements', 'perimetre'), 'm-2a,m-2b');
  -- Les tests : critères factuels seulement.
  perform essai.attendu('jeune 1 : les tests (factuels), pas les critères d''observation', essai.ids(e1, 'criteria', 'direct'), 'cmj_hauteur,poids,sprint_10');
  perform essai.attendu('jeune 2 : les mêmes tests', essai.ids(e2, 'criteria', 'direct'), 'cmj_hauteur,poids,sprint_10');
  -- Toujours rien d'autre.
  perform essai.attendu('jeune 1 : toujours sa seule fiche', essai.ids(e1, 'players', 'direct'), 'j-1');
  perform essai.attendu('jeune 1 : … par la lecture par périmètre', essai.ids(e1, 'players', 'perimetre'), 'j-1');
  perform essai.attendu('jeune 1 : toujours aucun avis', essai.ids(e1, 'evaluations', 'direct'), '');
  perform essai.attendu('jeune 1 : … par la lecture par périmètre', essai.ids(e1, 'evaluations', 'perimetre'), '');
  -- Jeune sans fiche, compte sans rôle : rien.
  perform essai.attendu('jeune sans fiche : aucune mesure', essai.ids(e3, 'measurements', 'direct'), '');
  perform essai.attendu('jeune sans fiche : aucun test', essai.ids(e3, 'criteria', 'direct'), '');
  perform essai.attendu('jeune sans fiche : … par la lecture par périmètre', essai.ids(e3, 'measurements', 'perimetre'), '');
  perform essai.attendu('sans rôle : aucune mesure', essai.ids(f1, 'measurements', 'direct'), '');
  perform essai.attendu('sans rôle : aucun test', essai.ids(f1, 'criteria', 'direct'), '');
  -- Anon : refusé (aucun droit sur les tables depuis 040), et la lecture par périmètre aussi.
  perform essai.attendu('anon : mesures refusées', essai.comme(null, 'select * from public.hb_measurements'), 'ERR 42501');
  perform essai.attendu('anon : tests refusés', essai.comme(null, 'select * from public.hb_criteria'), 'ERR 42501');
  perform essai.attendu('anon : lecture par périmètre refusée', essai.comme(null, $q$select * from public.hb_lire_perimetre('measurements', '-infinity', 10)$q$), 'ERR 42501');
  -- Aucune écriture du jeune, ni sur ses mesures ni sur les tests (hb_player_guard de 051, droits de 040).
  perform essai.attendu('jeune 1 : pas d''écriture directe sur ses mesures',
    left(essai.comme(e1, $q$update public.hb_measurements set data = data || '{"value": 1.5}' where id = 'm-1b'$q$), 3), 'ERR');
  -- hb_upsert : refusé ou ligne rejetée ; dans les deux cas, rien d'écrit (vérifié juste après).
  raise notice '  hb_upsert par le jeune : %', essai.vu(e1, $q$select public.hb_upsert('measurements',
    '[{"id":"m-1x","data":{"id":"m-1x","playerId":"j-1","criterionId":"sprint_10","value":1.2,"date":"2026-11-01"},"updated_at_client":9}]'::jsonb)::text$q$);
  perform essai.attendu('… rien n''a été écrit', (select count(*)::text from public.hb_measurements where id = 'm-1x' or (id = 'm-1b' and (data ->> 'value')::numeric = 1.5)), '0');

  -- Le staff (et tous les autres comptes) : exactement ce qu'il lisait avant 066.
  for c in select a.uid, a.tbl, a.how, a.ids, k.nom from essai.avant a join essai.comptes k using (uid)
            where k.nom not in ('jeune 1', 'jeune 2') loop
    if essai.ids(c.uid, c.tbl, c.how) is distinct from c.ids then
      raise exception 'ÉCHEC % : % (%) a changé : % au lieu de %', c.nom, c.tbl, c.how, essai.ids(c.uid, c.tbl, c.how), c.ids;
    end if;
  end loop;
  raise notice 'ok : staff, sans rôle, jeune sans fiche : mêmes lignes qu''avant 066 (joueurs, tests, mesures, avis ; deux lectures)';
end $$;

-- Lecture par périmètre ligne pour ligne égale à la lecture directe (comme tools/essai-sql-058), pour tous les comptes, sur
-- les mesures et les fiches, à chaque curseur (heures des lignes, début, fin) et plusieurs tailles de page.
do $$
declare
  c record;
  t text;
  k timestamptz;
  n integer;
  direct jsonb;
  par_fn jsonb;
  essais integer := 0;
begin
  for c in select uid, nom from essai.comptes loop
    foreach t in array array['measurements', 'players'] loop
      for k in execute format('select x from (select ''-infinity''::timestamptz x union select ''infinity'' union select server_updated_at from public.%I) s', 'hb_' || t) loop
        foreach n in array array[1, 2, 3, 1000] loop
          perform set_config('test.uid', c.uid, true);
          set local role authenticated;
          execute format('select coalesce(jsonb_agg(jsonb_build_array(id, server_updated_at, data) order by server_updated_at, id), ''[]'')
                            from (select id, data, server_updated_at from public.%I where server_updated_at >= $1
                                   order by server_updated_at, id limit $2) x', 'hb_' || t) into direct using k, n;
          select coalesce(jsonb_agg(jsonb_build_array(id, server_updated_at, data) order by o), '[]') into par_fn
            from (select id, data, server_updated_at, row_number() over () as o from public.hb_lire_perimetre(t, k, n)) x;
          reset role;
          if direct is distinct from par_fn then
            raise exception 'ÉCHEC lecture par périmètre % % curseur % taille % : % ligne(s) au lieu de %', c.nom, t, k, n,
              jsonb_array_length(par_fn), jsonb_array_length(direct);
          end if;
          essais := essais + 1;
        end loop;
      end loop;
    end loop;
  end loop;
  raise notice 'ok : lecture par périmètre identique à la lecture directe (% comparaisons, 8 comptes, mesures et fiches)', essais;
end $$;

-- Registre des changements (061) : une mesure nouvelle sur la fiche du jeune 1 lui est citée ; celle d'une autre fiche non.
do $$
declare
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  e2 text := '00000000-0000-0000-0000-0000000000e2';
  c1 text;
  c2 text;
  r1 jsonb;
  r2 jsonb;
begin
  perform essai.attendu('portées d''une mesure de j-1 : avec hb:joueur:j-1',
    (select 'hb:joueur:j-1' = any (public.hb_canaux_ligne('hb_measurements', to_jsonb(m))) from public.hb_measurements m where id = 'm-1a')::text, 'true');
  perform essai.attendu('portées d''une mesure de j-3 (pas de compte joueur) : sans hb:joueur',
    (select exists (select 1 from unnest(public.hb_canaux_ligne('hb_measurements', to_jsonb(m))) x where x like 'hb:joueur:%') from public.hb_measurements m where id = 'm-3a')::text, 'false');
  c1 := essai.vu(e1, 'select public.hb_registre_depuis(null)::text')::jsonb ->> 'c';
  c2 := essai.vu(e2, 'select public.hb_registre_depuis(null)::text')::jsonb ->> 'c';
  -- Le comité note une nouvelle mesure de j-1 et une de j-3 (tâche serveur, déclencheurs actifs).
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', true);
  insert into public.hb_measurements (id, data) values
    ('m-1e', '{"id":"m-1e","playerId":"j-1","criterionId":"cmj_hauteur","value":36,"date":"2026-11-02","createdBy":"00000000-0000-0000-0000-0000000000c1"}'),
    ('m-3c', '{"id":"m-3c","playerId":"j-3","criterionId":"cmj_hauteur","value":35,"date":"2026-11-02","createdBy":"00000000-0000-0000-0000-0000000000c1"}');
  perform set_config('test.uid', '', true);
  r1 := essai.vu(e1, format('select public.hb_registre_depuis(%L)::text', c1))::jsonb;
  r2 := essai.vu(e2, format('select public.hb_registre_depuis(%L)::text', c2))::jsonb;
  perform essai.attendu('registre du jeune 1 : complet', r1 ->> 'complet', 'true');
  perform essai.attendu('registre du jeune 1 : sa nouvelle mesure citée, pas celle d''un autre',
    (select string_agg(x ->> 0, ',' order by x ->> 0) from jsonb_array_elements(r1 -> 'e' -> 'measurements') x), 'm-1e');
  perform essai.attendu('registre du jeune 2 : rien de cité', coalesce((select count(*)::text from jsonb_array_elements(r2 -> 'e' -> 'measurements') x), '0'), '0');
  perform essai.attendu('jeune 1 : la relit par identifiant', essai.ids(e1, 'measurements', 'direct'), 'm-1a,m-1b,m-1c,m-1d,m-1e');
end $$;
