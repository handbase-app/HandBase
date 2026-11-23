-- Essais de supabase/082_wellness_groupe_moyennes.sql (lancer.sh), après les comptes, fiches et groupes FICTIFS de
-- tools/essai-sql-073/essais.sql : un jour passé du tableau (hb_wellness_groupe_au : même forme et mêmes fiches que
-- hb_wellness_groupe, fenêtre qui finit le jour choisi), moyennes du groupe (hb_wellness_groupe_moyennes : aucune donnée
-- individuelle, membres à la fin de la période, groupe Pôle compris), droits (staff du groupe oui ; autre coach, observateur,
-- joueur, anon non), périodes illisibles refusées. Toute erreur arrête.
\set ON_ERROR_STOP 1

do $$
declare
  a1 text := '00000000-0000-0000-0000-0000000000a1';
  c1 text := '00000000-0000-0000-0000-0000000000c1';
  c2 text := '00000000-0000-0000-0000-0000000000c2';
  c4 text := '00000000-0000-0000-0000-0000000000c4';
  d2 text := '00000000-0000-0000-0000-0000000000d2';
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  auj date := (select j.auj from jours j);
  an date := (select j.auj from jours j) - 364;
  -- Une période : { cle, du, au } (jours relatifs à aujourd'hui).
  p_jour text;
  p_mois text;
  p_an text;
  moy text := 'select (x -> ''periodes'' -> 0)::text from public.hb_wellness_groupe_moyennes(%L, %L::jsonb) x';
  champs text := 'select concat_ws('' '', y ->> ''reponses'', y ->> ''joueurs'', y ->> ''energie'', y ->> ''fraicheur'', y ->> ''humeur'', y ->> ''sommeil'', y ->> ''forme'') from public.hb_wellness_groupe_moyennes(%L, %L::jsonb) x, jsonb_array_elements(x -> ''periodes'') y where y ->> ''cle'' = %L';
  au text := 'select (x -> ''jours'')::text || '' '' || jsonb_array_length(x -> ''jours'') || '' '' || jsonb_array_length(x -> ''seances'') from public.hb_wellness_groupe_au(%L, %L, %s) x';
begin
  p_jour := jsonb_build_array(jsonb_build_object('cle', 'jour', 'du', auj, 'au', auj))::text;
  p_mois := jsonb_build_array(jsonb_build_object('cle', 'mois', 'du', auj - 29, 'au', auj))::text;
  p_an := jsonb_build_array(jsonb_build_object('cle', 'an', 'du', an - 14, 'au', an + 14))::text;
  insert into public.hb_config (id, data) values ('wellness', '{"id":"wellness","key":"wellness","value":{"actif":true}}')
    on conflict (id) do update set data = excluded.data, deleted = false;
  -- Réponses fictives (écrites directement, comme la base) : j-1 et j-2 (groupe g1, lus par c1), j-3 (g1, hors du périmètre
  -- du créateur : jamais compté), j-4 (groupe Pôle depuis 60 jours).
  insert into public.hb_wellness (player_id, jour, scores, douleur, douleurs) values
    ('j-1', auj, '{"energie":8,"fraicheur":7,"humeur":9,"sommeil":6}', true, '[{"zone":"tete","type":"gene","intensite":8}]'),
    ('j-2', auj, '{"energie":6,"fraicheur":6}', false, '[]'),
    ('j-3', auj, '{"energie":1,"fraicheur":1,"humeur":1,"sommeil":1}', false, '[]'),
    ('j-1', auj - 10, '{"energie":5,"fraicheur":5,"humeur":5,"sommeil":5}', false, '[]'),
    ('j-2', auj - 12, '{"energie":7}', false, '[]'),
    ('j-1', auj - 40, '{"energie":4}', false, '[]'),
    ('j-1', an - 3, '{"energie":9,"fraicheur":8,"humeur":7,"sommeil":8}', false, '[]'),
    ('j-2', an + 2, '{"energie":7,"fraicheur":8,"humeur":7,"sommeil":6}', true, '[{"zone":"genou","cote":"g","type":"douleur","intensite":4}]'),
    ('j-3', an, '{"energie":2}', false, '[]'),
    ('j-4', auj - 1, '{"energie":6,"humeur":8}', false, '[]'),
    ('j-4', auj - 100, '{"energie":3}', false, '[]');
  insert into public.hb_wellness_seances (player_id, jour, rpe, duree) values ('j-1', auj - 10, 6, 90), ('j-1', auj - 30, 5, 60);

  -- ---------- Les fiches du groupe : celles de hb_wellness_groupe ----------
  perform essai.attendu('fiches de g1 pour le créateur : celles de hb_wellness_groupe',
    (select to_jsonb(public.hb_wl_groupe_fiches(g.data, c1::uuid, auj))::text from public.hb_groups g where g.id = 'g1'),
    essai.vu(c1, 'select (public.hb_wellness_groupe(''g1'', 35) -> ''comptes'')::text'));
  perform essai.attendu('… groupe Pôle aussi', (select to_jsonb(public.hb_wl_groupe_fiches(g.data, c1::uuid, auj))::text from public.hb_groups g where g.id = 'gp'),
    essai.vu(c1, 'select (public.hb_wellness_groupe(''gp'', 35) -> ''comptes'')::text'));
  perform essai.attendu('… groupe Pôle il y a 100 jours : personne (j-4 n''y était pas)',
    (select to_jsonb(public.hb_wl_groupe_fiches(g.data, c1::uuid, auj - 100))::text from public.hb_groups g where g.id = 'gp'), '[]');
  perform essai.attendu('… groupe sans wellness : personne', (select to_jsonb(public.hb_wl_groupe_fiches(g.data, c1::uuid, auj))::text from public.hb_groups g where g.id = 'g2'), '[]');
  perform essai.attendu('fonction interne fermée à l''appli', essai.vu(c1, format('select public.hb_wl_groupe_fiches(%L::jsonb, %L::uuid, current_date)::text', '{}', c1)),
    'ERR 42501 permission denied for function hb_wl_groupe_fiches');

  -- ---------- Un jour passé du tableau ----------
  perform essai.attendu('aujourd''hui : exactement hb_wellness_groupe', essai.vu(c1, format('select public.hb_wellness_groupe_au(''g1'', %L, 35)::text', auj)),
    essai.vu(c1, 'select public.hb_wellness_groupe(''g1'', 35)::text'));
  perform essai.attendu('il y a 10 jours, 5 jours : la fenêtre finit ce jour-là (réponses, séances)',
    regexp_replace(essai.vu(c1, format(au, 'g1', auj - 10, 5)), '^.* (\d+ \d+)$', '\1'), '2 1');
  perform essai.attendu('il y a 40 jours, 1 jour : sa seule réponse', regexp_replace(essai.vu(c1, format(au, 'g1', auj - 40, 1)), '^.* (\d+ \d+)$', '\1'), '1 0');
  perform essai.attendu('fenêtre bornée à 120 jours', regexp_replace(essai.vu(c1, format(au, 'g1', auj, 5000)), '^.* (\d+ \d+)$', '\1'), '5 2');
  perform essai.attendu('participant : même tableau', essai.vu(c2, format('select public.hb_wellness_groupe_au(''g1'', %L, 5)::text', auj - 10)),
    essai.vu(c1, format('select public.hb_wellness_groupe_au(''g1'', %L, 5)::text', auj - 10)));
  perform essai.attendu('administrateur : mêmes fiches', essai.vu(a1, format('select (public.hb_wellness_groupe_au(''g1'', %L, 5) -> ''comptes'')::text', auj - 10)), '["j-1", "j-2"]');
  perform essai.attendu('autre coach : refusé', essai.vu(c4, format('select public.hb_wellness_groupe_au(''g1'', %L, 5)::text', auj - 10)), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('observateur : refusé', essai.vu(d2, format('select public.hb_wellness_groupe_au(''g1'', %L, 5)::text', auj - 10)), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('joueur : refusé', essai.vu(e1, format('select public.hb_wellness_groupe_au(''g1'', %L, 5)::text', auj - 10)), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('groupe inconnu : refusé', essai.vu(c1, format('select public.hb_wellness_groupe_au(''rien'', %L, 5)::text', auj)), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('anon : refusé', essai.vu(null, format('select public.hb_wellness_groupe_au(''g1'', %L, 5)::text', auj)), 'ERR 42501 permission denied for function hb_wellness_groupe_au');
  perform essai.attendu('demain : refusé', essai.vu(c1, format('select public.hb_wellness_groupe_au(''g1'', %L, 5)::text', auj + 1)), 'ERR P0001 periode');
  perform essai.attendu('date impossible : refusée', essai.vu(c1, 'select public.hb_wellness_groupe_au(''g1'', ''2026-02-30'', 5)::text'), 'ERR P0001 periode');
  perform essai.attendu('texte : refusé', essai.vu(c1, 'select public.hb_wellness_groupe_au(''g1'', ''hier'', 5)::text'), 'ERR P0001 periode');
  perform essai.attendu('plus de 800 jours : refusé', essai.vu(c1, format('select public.hb_wellness_groupe_au(''g1'', %L, 5)::text', auj - 801)), 'ERR P0001 periode');

  -- ---------- Moyennes du groupe ----------
  -- Aujourd'hui : j-1 (8, 7, 9, 6, gêne 8/10 : forme 7,5 − 2 = 5,5) et j-2 (6, 6 : forme 6) ; j-3 jamais compté.
  perform essai.attendu('jour : réponses, joueurs, quatre notes, forme', essai.vu(c1, format(champs, 'g1', p_jour, 'jour')), '2 2 7.00 6.50 9.00 6.00 5.75');
  -- 30 jours : + j-1 il y a 10 jours (5 partout), j-2 il y a 12 jours (énergie 7) ; pas j-1 il y a 40 jours.
  perform essai.attendu('30 jours', essai.vu(c1, format(champs, 'g1', p_mois, 'mois')), '4 2 6.50 6.00 7.00 5.50 5.88');
  -- L'an dernier : j-1 (9, 8, 7, 8 : forme 8) et j-2 (7, 8, 7, 6, gêne 4/10 : 7 − 1 = 6).
  perform essai.attendu('même période l''an dernier', essai.vu(c1, format(champs, 'g1', p_an, 'an')), '2 2 8.00 8.00 7.00 7.00 7.00');
  perform essai.attendu('plusieurs périodes d''un coup, dans l''ordre', essai.vu(c1, format('select string_agg(y ->> ''cle'', '','') from public.hb_wellness_groupe_moyennes(''g1'', %L::jsonb) x, jsonb_array_elements(x -> ''periodes'') y',
    jsonb_build_array(jsonb_build_object('cle', 'jour', 'du', auj, 'au', auj), jsonb_build_object('cle', 'mois', 'du', auj - 29, 'au', auj), jsonb_build_object('cle', 'an', 'du', an - 14, 'au', an + 14))::text)), 'jour,mois,an');
  perform essai.attendu('période sans réponse : 0, notes vides', essai.vu(c1, format(champs, 'g1', jsonb_build_array(jsonb_build_object('cle', 'vide', 'du', auj - 300, 'au', auj - 290))::text, 'vide')), '0 0');
  perform essai.attendu('groupe Pôle, 7 jours : j-4', essai.vu(c1, format(champs, 'gp', jsonb_build_array(jsonb_build_object('cle', 's', 'du', auj - 7, 'au', auj))::text, 's')), '1 1 6.00 8.00 7.00');
  perform essai.attendu('groupe Pôle il y a 100 jours : le groupe d''alors (j-4 pas encore là)',
    essai.vu(c1, format(champs, 'gp', jsonb_build_array(jsonb_build_object('cle', 'v', 'du', auj - 110, 'au', auj - 90))::text, 'v')), '0 0');
  perform essai.attendu('aucune donnée individuelle (ni fiche, ni jour)', essai.vu(c1, format('select public.hb_wellness_groupe_moyennes(''g1'', %L::jsonb)::text ~ ''j-[0-9]|playerId|"day"''', p_mois)), 'false');
  perform essai.attendu('participant : mêmes moyennes', essai.vu(c2, format(moy, 'g1', p_mois)), essai.vu(c1, format(moy, 'g1', p_mois)));
  perform essai.attendu('administrateur : mêmes moyennes', essai.vu(a1, format(moy, 'g1', p_mois)), essai.vu(c1, format(moy, 'g1', p_mois)));
  perform essai.attendu('autre coach : refusé', essai.vu(c4, format(moy, 'g1', p_mois)), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('observateur : refusé', essai.vu(d2, format(moy, 'g1', p_mois)), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('joueur : refusé', essai.vu(e1, format(moy, 'g1', p_mois)), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('anon : refusé', essai.vu(null, format(moy, 'g1', p_mois)), 'ERR 42501 permission denied for function hb_wellness_groupe_moyennes');
  perform essai.attendu('aucune période : refusé', essai.vu(c1, format(moy, 'g1', '[]')), 'ERR P0001 periode');
  perform essai.attendu('pas un tableau : refusé', essai.vu(c1, format(moy, 'g1', '{"cle":"x"}')), 'ERR P0001 periode');
  perform essai.attendu('7 périodes : refusé', essai.vu(c1, format(moy, 'g1', (select jsonb_agg(jsonb_build_object('cle', 'p' || i, 'du', auj, 'au', auj)) from generate_series(1, 7) i)::text)), 'ERR P0001 periode');
  perform essai.attendu('début après la fin : refusé', essai.vu(c1, format(moy, 'g1', jsonb_build_array(jsonb_build_object('cle', 'x', 'du', auj, 'au', auj - 1))::text)), 'ERR P0001 periode');
  perform essai.attendu('plus de 400 jours : refusé', essai.vu(c1, format(moy, 'g1', jsonb_build_array(jsonb_build_object('cle', 'x', 'du', auj - 401, 'au', auj))::text)), 'ERR P0001 periode');
  perform essai.attendu('sans clé : refusé', essai.vu(c1, format(moy, 'g1', jsonb_build_array(jsonb_build_object('du', auj, 'au', auj))::text)), 'ERR P0001 periode');
  perform essai.attendu('fin à venir : refusé', essai.vu(c1, format(moy, 'g1', jsonb_build_array(jsonb_build_object('cle', 'x', 'du', auj, 'au', auj + 1))::text)), 'ERR P0001 periode');

  -- Le ménage : la parité (parite.ts) part d'une base sans réponse.
  delete from public.hb_wellness;
  delete from public.hb_wellness_seances;
end $$;
