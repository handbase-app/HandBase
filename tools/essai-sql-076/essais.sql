-- Essais de supabase/076_humeurs_multiples.sql (lancer.sh), sur les comptes et fiches FICTIFS d'avant.sql. Toute erreur
-- arrête. Reprise des anciennes notes ; ajout avec 1, 2, 3 humeurs ; au-delà de 3 ; valeur inconnue ; ancien appel (p_mood
-- seul) ; correction (nouvelle et ancienne appli) ; note retirée ; écriture directe (déclencheur) ; contrainte ; tendance du
-- staff ; lecture comme l'appli ; droits.
\set ON_ERROR_STOP 1
create schema if not exists essai;

-- Exécute p_sql comme le compte p_uid (rôle authenticated ; null : anon) ; rend le nombre de lignes, ou « ERR code message ».
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
    perform set_config('test.uid', '', true);
    return 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('test.uid', '', true);
  return n::text;
end $$;

-- Valeur d'une expression calculée comme le compte p_uid (texte ; « ERR code message » si refus).
create or replace function essai.vu(p_uid text, p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  begin
    execute p_sql into v;
  exception when others then
    reset role;
    perform set_config('test.uid', '', true);
    return 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('test.uid', '', true);
  return v;
end $$;
grant usage on schema essai to anon, authenticated;
grant execute on all functions in schema essai to anon, authenticated;

create or replace function essai.attendu(p_quoi text, p_vu text, p_attendu text) returns void
language plpgsql as $$
begin
  if p_vu is distinct from p_attendu then raise exception 'ÉCHEC % : % au lieu de %', p_quoi, p_vu, p_attendu; end if;
  raise notice 'ok : %', p_quoi;
end $$;

-- Humeurs d'une note renvoyée : « ["a", "b"] a » ; « aucune aucune » s'il n'y en a pas.
create or replace function essai.h(v text) returns text
language sql as $$
  select case when v like 'ERR%' then v
              else coalesce((v::jsonb -> 'moods')::text, 'aucune') || ' ' || coalesce(v::jsonb ->> 'mood', 'aucune') end
$$;

do $$
declare
  a1 text := '00000000-0000-0000-0000-0000000000a1';
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  e2 text := '00000000-0000-0000-0000-0000000000e2';
  ajout text := 'select public.hb_player_journal_add(p_text => %L, p_moods => %L::text[])::text';
  corr text := 'select public.hb_player_journal_edit(p_id => %L, p_text => %L, p_moods => %L::text[])::text';
  v text;
  nid text;
  tr jsonb;
begin
  -- ---------- Reprise des notes d'avant ----------
  perform essai.attendu('reprise : moods = [mood] pour les notes qui avaient une humeur, rien pour les autres',
    (select string_agg(id || ' ' || moods::text || ' ' || coalesce(mood, '-'), ' ; ' order by id) from public.hb_player_journal where id like 'ancienne-%'),
    'ancienne-1 {content} content ; ancienne-2 {pensif} pensif ; ancienne-3 {} - ; ancienne-4 {} -');
  perform essai.attendu('note d''avant renvoyée avec moods et mood', essai.h((select public.hb_journal_note(j)::text from public.hb_player_journal j where id = 'ancienne-1')), '["content"] content');

  -- ---------- Ajout ----------
  perform essai.attendu('1 humeur', essai.h(essai.vu(e1, format(ajout, 'Une', '{fier}'))), '["fier"] fier');
  v := essai.vu(e1, format(ajout, 'Content et motivé', '{content,motive}'));
  nid := v::jsonb ->> 'id';
  perform essai.attendu('2 humeurs, rangées dans l''ordre de la liste ; mood = la première', essai.h(v), '["motive", "content"] motive');
  perform essai.attendu('3 humeurs (pensif, fatigué mais toujours fier)', essai.h(essai.vu(e1, format(ajout, 'Trois', '{pensif,fatigue,fier}'))), '["fier", "pensif", "fatigue"] fier');
  perform essai.attendu('au-delà de 3 : les 3 premières de la liste gardées', essai.h(essai.vu(e1, format(ajout, 'Cinq', '{fatigue,serein,motive,content,fier}'))), '["motive", "content", "fier"] motive');
  perform essai.attendu('valeur inconnue ignorée, doublons retirés', essai.h(essai.vu(e1, format(ajout, 'Inconnue', '{triste,fier,fier,FIER}'))), '["fier"] fier');
  perform essai.attendu('seulement des valeurs inconnues : pas d''humeur', essai.h(essai.vu(e1, format(ajout, 'Rien de connu', '{triste,colere}'))), 'aucune aucune');
  perform essai.attendu('liste vide : pas d''humeur (facultative)', essai.h(essai.vu(e1, format(ajout, 'Vide', '{}'))), 'aucune aucune');
  perform essai.attendu('liste nulle dans le tableau ignorée', essai.h(essai.vu(e1, format(ajout, 'Nulle', '{NULL,serein}'))), '["serein"] serein');
  perform essai.attendu('p_moods l''emporte sur p_mood', essai.h(essai.vu(e1, format('select public.hb_player_journal_add(p_text => %L, p_mood => %L, p_moods => %L::text[])::text', 'Les deux', 'decu', '{concentre,fier}'))), '["fier", "concentre"] fier');

  -- ---------- Ancienne appli (p_mood seul, comme 052 / 074) ----------
  perform essai.attendu('ancien appel par position (p_text, p_mood)', essai.h(essai.vu(e1, format('select public.hb_player_journal_add(%L, %L)::text', 'Ancienne appli', 'serein'))), '["serein"] serein');
  perform essai.attendu('ancien appel nommé (PostgREST : p_text, p_mood)', essai.h(essai.vu(e1, format('select public.hb_player_journal_add(p_text => %L, p_mood => %L)::text', 'Ancienne nommée', 'decu'))), '["decu"] decu');
  perform essai.attendu('ancien appel, humeur inconnue : ignorée', essai.h(essai.vu(e1, format('select public.hb_player_journal_add(p_text => %L, p_mood => %L)::text', 'Ancienne inconnue', 'triste'))), 'aucune aucune');
  perform essai.attendu('texte seul', essai.h(essai.vu(e1, format('select public.hb_player_journal_add(%L)::text', 'Texte seul'))), 'aucune aucune');
  perform essai.attendu('texte vide : refusé comme avant', essai.vu(e1, format(ajout, '   ', '{fier}')), 'ERR P0001 note_vide');

  -- ---------- Correction ----------
  perform essai.attendu('correction : 3 nouvelles humeurs', essai.h(essai.vu(e1, format(corr, nid, 'Corrigée', '{pensif,fatigue,fier}'))), '["fier", "pensif", "fatigue"] fier');
  perform essai.attendu('ancienne appli, même première humeur : les autres restent',
    essai.h(essai.vu(e1, format('select public.hb_player_journal_edit(%L, %L, %L)::text', nid, 'Texte corrigé par une ancienne version', 'fier'))), '["fier", "pensif", "fatigue"] fier');
  perform essai.attendu('… texte bien corrigé', (select text from public.hb_player_journal where id = nid), 'Texte corrigé par une ancienne version');
  perform essai.attendu('ancienne appli, autre humeur : une seule', essai.h(essai.vu(e1, format('select public.hb_player_journal_edit(%L, %L, %L)::text', nid, 'x', 'serein'))), '["serein"] serein');
  perform essai.attendu('ancienne appli, sans humeur : aucune', essai.h(essai.vu(e1, format('select public.hb_player_journal_edit(%L, %L)::text', nid, 'x'))), 'aucune aucune');
  perform essai.attendu('correction : au-delà de 3, nettoyée', essai.h(essai.vu(e1, format(corr, nid, 'y', '{fatigue,decu,pensif,serein}'))), '["serein", "pensif", "decu"] serein');
  perform essai.attendu('correction : liste vide → plus d''humeur', essai.h(essai.vu(e1, format(corr, nid, 'z', '{}'))), 'aucune aucune');
  perform essai.attendu('note d''un autre : introuvable', essai.vu(e2, format(corr, nid, 'z', '{fier}')), 'ERR P0001 note_introuvable');
  perform essai.attendu('aucune note où mood et moods divergent', (select count(*)::text from public.hb_player_journal where mood is distinct from moods[1]), '0');

  -- ---------- Lecture comme l'appli (select *) : le jeune voit ses humeurs ----------
  perform essai.comme(e1, format(corr, nid, 'Lue', '{concentre,motive}'));
  perform essai.attendu('le jeune lit moods dans la table', essai.vu(e1, format('select moods::text || '' '' || mood from public.hb_player_journal where id = %L', nid)), '{motive,concentre} motive');

  -- ---------- Note retirée ----------
  perform essai.comme(e1, format('select public.hb_player_journal_delete(%L)', nid));
  perform essai.attendu('note retirée : humeurs vidées tout de suite', (select deleted::text || ' ' || moods::text || ' ' || coalesce(mood, 'aucune') || ' [' || text || ']' from public.hb_player_journal where id = nid), 'true {} aucune []');

  -- ---------- Écritures directes (propriétaire : données fictives, outils) ----------
  insert into public.hb_player_journal (id, player_id, at, text, mood) values ('directe-1', 'j-1', now(), 'mood seule', 'fier');
  perform essai.attendu('insertion avec mood seule : moods suit', (select moods::text from public.hb_player_journal where id = 'directe-1'), '{fier}');
  update public.hb_player_journal set mood = 'serein' where id = 'directe-1';
  perform essai.attendu('mise à jour de mood seule : moods suit', (select moods::text from public.hb_player_journal where id = 'directe-1'), '{serein}');
  update public.hb_player_journal set moods = '{fatigue,content,inconnue,content}' where id = 'directe-1';
  perform essai.attendu('mise à jour de moods : nettoyée, mood suit', (select moods::text || ' ' || mood from public.hb_player_journal where id = 'directe-1'), '{content,fatigue} content');
  delete from public.hb_player_journal where id = 'directe-1';
  -- Déclencheur coupé (hors des blocs qui suivent : un bloc en erreur annule ce qu'il a fait) : la contrainte seule.
  alter table public.hb_player_journal disable trigger hb_humeurs_sync;
  begin
    insert into public.hb_player_journal (id, player_id, at, text, mood, moods) values ('directe-2', 'j-1', now(), 'x', 'fier', '{fier,motive}');
    raise exception 'ÉCHEC : liste dans le désordre acceptée';
  exception when check_violation then
    raise notice 'ok : contrainte : liste dans le désordre refusée (déclencheur coupé)';
  end;
  begin
    insert into public.hb_player_journal (id, player_id, at, text, mood, moods) values ('directe-3', 'j-1', now(), 'x', 'fier', '{motive,content,fier,serein}');
    raise exception 'ÉCHEC : 4 humeurs acceptées';
  exception when check_violation then
    raise notice 'ok : contrainte : 4 humeurs refusées (déclencheur coupé)';
  end;
  begin
    insert into public.hb_player_journal (id, player_id, at, text, mood, moods) values ('directe-4', 'j-1', now(), 'x', 'serein', '{fier}');
    raise exception 'ÉCHEC : mood différente de la première acceptée';
  exception when check_violation then
    raise notice 'ok : contrainte : mood ≠ première humeur refusée (déclencheur coupé)';
  end;
  alter table public.hb_player_journal enable trigger hb_humeurs_sync;

  -- ---------- Droits ----------
  perform essai.attendu('anon : refusé', essai.vu(null, format(ajout, 'x', '{fier}')), 'ERR 42501 permission denied for function hb_player_journal_add');
  perform essai.attendu('pas d''écriture directe pour le jeune', essai.vu(e1, $q$update public.hb_player_journal set moods = '{fier}' where player_id = 'j-1'$q$), 'ERR 42501 permission denied for table hb_player_journal');
  perform essai.attendu('une seule fonction de chaque nom (pas de surcharge pour PostgREST)',
    (select string_agg(p.oid::regprocedure::text, ' ; ' order by 1) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('hb_player_journal_add', 'hb_player_journal_edit')),
    'hb_player_journal_add(text,text,text[]) ; hb_player_journal_edit(text,text,text,text[])');

  -- ---------- Tendance du staff : chaque humeur compte une fois, le nombre de notes ne change pas ----------
  delete from public.hb_player_journal where player_id = 'j-1';
  perform essai.comme(e1, format(ajout, 'Content et motivé', '{content,motive}'));
  perform essai.comme(e1, format(ajout, 'Fier et concentré', '{fier,concentre}'));
  perform essai.comme(e1, format(ajout, 'Pensif, fatigué mais toujours fier', '{pensif,fatigue,fier}'));
  perform essai.comme(e1, format(ajout, 'Sans humeur', '{}'));
  perform essai.comme(e1, format('select public.hb_player_journal_add(%L, %L)', 'Ancienne appli', 'content'));
  v := essai.comme(e1, format('select public.hb_player_journal_delete(id) from public.hb_player_journal where text = %L', 'Sans humeur'));
  perform essai.comme(e1, format(ajout, 'Retirée ensuite', '{decu}'));
  perform essai.comme(e1, format('select public.hb_player_journal_delete(id) from public.hb_player_journal where text = %L', 'Retirée ensuite'));
  perform essai.comme(e1, format(ajout, 'Sans humeur', '{}'));
  tr := essai.vu(a1, $q$select public.hb_player_mood_trend('j-1')::text$q$)::jsonb;
  perform essai.attendu('tendance : 8 semaines', jsonb_array_length(tr -> 'weeks')::text, '8');
  perform essai.attendu('tendance : notes de la semaine (5, une par note)', tr -> 'weeks' -> 7 ->> 'notes', '5');
  perform essai.attendu('tendance : chaque humeur d''une note compte une fois',
    ((tr -> 'weeks' -> 7 -> 'moods') = '{"content": 2, "motive": 1, "fier": 2, "concentre": 1, "pensif": 1, "fatigue": 1}'::jsonb)::text, 'true');
  perform essai.attendu('tendance : jamais de texte', (tr::text like '%Content%' or tr::text like '%fatigué%')::text, 'false');
  -- Ligne écrite déclencheurs coupés avec mood seule (données fictives d'avant) : comptée comme [mood].
  set session_replication_role = replica;
  insert into public.hb_player_journal (id, player_id, at, text, mood) values ('replica-1', 'j-1', now(), 'mood seule', 'serein');
  set session_replication_role = origin;
  tr := essai.vu(a1, $q$select public.hb_player_mood_trend('j-1')::text$q$)::jsonb;
  perform essai.attendu('tendance : ligne à mood seule comptée', (tr -> 'weeks' -> 7 ->> 'notes') || ' ' || (tr -> 'weeks' -> 7 -> 'moods' ->> 'serein'), '6 1');
  perform essai.attendu('jeune : pas sa tendance', essai.vu(e1, $q$select public.hb_player_mood_trend('j-1')::text$q$), 'ERR P0001 Réservé au staff qui suit cette fiche');
  delete from public.hb_player_journal where id = 'replica-1';
end $$;
