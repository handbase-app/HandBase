-- HandBase / Nextar : « MON JOURNAL DU HAND », PLUSIEURS HUMEURS PAR NOTE (jusqu'à 3).
-- Demandé par Geoffroy le 09/11/2026 : « on peut être content et motivé, fier et concentré… » (pensif, fatigué mais toujours
-- fier). Jusqu'ici une note n'avait qu'une humeur (052, colonne mood).
-- À passer APRÈS 074_lampe.sql (il reprend les fonctions du journal telles que 074 les a laissées : limite des 200 notes qui
-- ne compte que les notes simples, cahiers corrigés ailleurs, note avec kind / day / parts). Indépendant de 075 (préférences) :
-- l'ordre 074 → 075 → 076 convient. Avec outils/appliquer-sql.sh (serveur maison) : base hand d'abord (vérifier avec la
-- requête de contrôle en fin de fichier), puis volley. Peut être relancé sans risque (add column if not exists, drop … if
-- exists, create or replace ; la reprise des données ne touche que les notes pas encore reprises).
-- Table du jeune (hb_player_journal), PAS synchronisée : ni hb_upsert, ni hb_stamp / hb_log / hb_touch, ni aucune table
-- synchronisée ne sont touchés (tools/essai-sql-076 compare les empreintes avant et après).
--
-- PRINCIPE
--  - Colonne moods text[] (vide = pas d'humeur ; l'humeur reste facultative) : liste FERMÉE (hb_self_mood, 052), 3 au plus,
--    sans doublon, rangées dans l'ordre de la liste (motive, content, fier, concentre, serein, pensif, decu, fatigue : le même
--    que JOURNAL_MOODS, src/playerSpace.ts). Une valeur inconnue est ignorée ; au-delà de 3, seules les 3 premières dans
--    l'ordre de la liste sont gardées (l'appli n'en envoie jamais plus de 3) : hb_self_moods.
--  - La colonne mood (052) reste = la PREMIÈRE humeur : les anciennes versions de l'appli, encore en cache sur les téléphones,
--    continuent de lire et d'écrire une humeur. Le déclencheur hb_humeurs_sync garde les deux d'accord, quel que soit
--    l'écrivain : moods seul (nouvelle appli) → mood suit ; mood seul (ancienne écriture directe, données fictives) → moods =
--    [mood] ; note retirée (hb_player_journal_delete de 052, cahier vidé de 074) → les deux vidés tout de suite.
--  - Reprise : les notes qui avaient une humeur ont moods = [mood].
--
-- FONCTIONS DE L'APPLI (signatures changées : les anciennes sont SUPPRIMÉES, pour qu'il n'y ait jamais deux fonctions du même
-- nom que PostgREST ne saurait départager ; droits refaits comme 052 : comptes connectés, pas anon)
--  1) hb_player_journal_add(p_text text, p_mood text default null, p_moods text[] default null) → la note créée.
--  2) hb_player_journal_edit(p_id text, p_text text, p_mood text default null, p_moods text[] default null) → la note corrigée.
--     p_moods donné (même vide) : c'est la liste des humeurs. p_moods absent (ancienne appli, p_mood seul) : une humeur, comme
--     avant ; en correction, si p_mood est la première humeur déjà gardée, les autres restent (une ancienne appli qui corrige
--     le texte d'une note à 2 humeurs ne les perd pas).
--  3) La note renvoyée (hb_journal_note) porte `moods` (s'il y en a) ET `mood` (la première, pour les anciennes versions).
--  4) hb_player_mood_trend (staff) : chaque humeur d'une note compte une fois ; le nombre de notes de la semaine ne change pas.
-- L'appli marche AVANT ce script : la nouvelle version envoie p_moods ; fonction absente (PGRST202) → elle renvoie p_mood seul
-- (une humeur gardée, comme avant) ; elle lit `moods` s'il existe, sinon `mood`.
-- Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 0. Prérequis ----------
do $$
begin
  if to_regclass('public.hb_player_journal') is null or to_regprocedure('public.hb_self_mood(text)') is null
     or to_regprocedure('public.hb_cahier_enregistrer(text, text, jsonb)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hb_player_journal' and column_name = 'kind') then
    raise exception '076 demande 052 et 074 (hb_player_journal avec ses cahiers) : passer d''abord les scripts d''avant.';
  end if;
end $$;

-- ---------- 1. Humeurs d'une note ----------

-- Liste nettoyée : humeurs connues (hb_self_mood), sans doublon, dans l'ordre de la liste, 3 au plus ; {} si aucune.
-- Même règle que cleanMoods (src/playerSpace.ts, MAX_MOODS = 3).
create or replace function public.hb_self_moods(p text[]) returns text[]
language sql immutable as $$
  select coalesce((select array_agg(s.m order by s.o)
                     from (select d.m, coalesce(array_position(array['motive', 'content', 'fier', 'concentre', 'serein', 'pensif', 'decu', 'fatigue'], d.m), 99) as o
                             from (select distinct public.hb_self_mood(x) as m from unnest(coalesce(p, '{}'::text[])) u(x)) d
                            where d.m is not null
                            order by 2
                            limit 3) s), '{}'::text[])
$$;

alter table public.hb_player_journal add column if not exists moods text[] not null default '{}'::text[];

-- mood et moods toujours d'accord (voir PRINCIPE) ; une note retirée n'en garde aucune.
create or replace function public.hb_humeurs_sync() returns trigger
language plpgsql as $$
begin
  if new.deleted then
    new.moods := '{}'::text[];
    new.mood := null;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if cardinality(coalesce(new.moods, '{}'::text[])) = 0 and new.mood is not null then new.moods := array[new.mood]; end if;
  elsif new.moods is not distinct from old.moods and new.mood is distinct from old.mood then
    -- Écriture qui ne connaît que mood (ancienne) : la liste suit.
    new.moods := case when new.mood is null then '{}'::text[] else array[new.mood] end;
  end if;
  new.moods := public.hb_self_moods(new.moods);
  new.mood := new.moods[1];
  return new;
end $$;
drop trigger if exists hb_humeurs_sync on public.hb_player_journal;
create trigger hb_humeurs_sync before insert or update on public.hb_player_journal
  for each row execute function public.hb_humeurs_sync();

-- Reprise : moods = [mood] pour les notes qui avaient une humeur (relancé : plus rien à reprendre). updated_at inchangé.
update public.hb_player_journal set moods = array[mood] where mood is not null and cardinality(moods) = 0;

alter table public.hb_player_journal drop constraint if exists hb_player_journal_moods;
-- Liste toujours propre ; mood = la première dès qu'il y a une liste. (Une ligne écrite déclencheurs coupés — données fictives,
-- session_replication_role = replica — peut n'avoir que mood : elle reste lisible, l'appli et la tendance la lisent comme [mood].)
alter table public.hb_player_journal add constraint hb_player_journal_moods
  check (moods = public.hb_self_moods(moods) and (cardinality(moods) = 0 or mood is not distinct from moods[1]));

-- ---------- 2. Fonctions du journal (reprises de 074, avec la liste des humeurs) ----------

-- Une note telle que l'appli la reçoit (074 + moods ; mood = la première, pour les anciennes versions).
create or replace function public.hb_journal_note(n public.hb_player_journal) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', n.id, 'at', public.hb_self_iso(n.at), 'text', n.text, 'mood', n.mood,
                                              'moods', case when cardinality(n.moods) > 0 then to_jsonb(n.moods) end,
                                              'shared', n.shared, 'editedAt', public.hb_self_iso(n.edited_at),
                                              'kind', n.kind, 'day', to_char(n.jour, 'YYYY-MM-DD'), 'parts', n.parts))
$$;

-- Anciennes signatures (052 / 074) : supprimées, une seule fonction de chaque nom.
drop function if exists public.hb_player_journal_add(text, text);
drop function if exists public.hb_player_journal_edit(text, text, text);

-- Nouvelle note (privée). 200 notes simples au plus par fiche (074). Renvoie la note créée.
create or replace function public.hb_player_journal_add(p_text text, p_mood text default null, p_moods text[] default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pid text := public.hb_player_self_id();
  v_text text := public.hb_self_note_text(p_text);
  v_moods text[] := public.hb_self_moods(case when p_moods is not null then p_moods when p_mood is not null then array[p_mood] end);
  v_id text;
  n public.hb_player_journal;
begin
  if v_text is null then raise exception 'note_vide'; end if;
  loop
    v_id := 'n' || substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=', 'xyz'), 1, 10);
    exit when not exists (select 1 from public.hb_player_journal where id = v_id);
  end loop;
  perform set_config('hb.player_self', '1', true);
  insert into public.hb_player_journal (id, player_id, user_id, at, text, mood, moods)
  values (v_id, v_pid, auth.uid(), clock_timestamp(), v_text, v_moods[1], v_moods)
  returning * into n;
  delete from public.hb_player_journal
   where id in (select id from public.hb_player_journal where player_id = v_pid and not deleted and kind is null
                 order by at desc, id desc offset 200);
  perform set_config('hb.player_self', '0', true);
  return public.hb_journal_note(n);
end $$;

-- Correction (texte, humeurs) : la date reste, editedAt posé ; un cahier ne se corrige pas ici (074).
create or replace function public.hb_player_journal_edit(p_id text, p_text text, p_mood text default null, p_moods text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_text text := public.hb_self_note_text(p_text);
  v_moods text[];
  v_old text[];
  n public.hb_player_journal;
begin
  if v_text is null then raise exception 'note_vide'; end if;
  if p_moods is not null then
    v_moods := public.hb_self_moods(p_moods);
  else
    -- Ancienne appli (p_mood seul) : même première humeur → les autres restent ; sinon, une humeur (ou aucune).
    select j.moods into v_old from public.hb_player_journal j
     where j.id = p_id and j.player_id = v_pid and not j.deleted and j.kind is null;
    v_moods := case when v_old is not null and public.hb_self_mood(p_mood) is not distinct from v_old[1] and cardinality(v_old) > 0 then v_old
                    else public.hb_self_moods(case when p_mood is not null then array[p_mood] end) end;
  end if;
  perform set_config('hb.player_self', '1', true);
  update public.hb_player_journal
     set text = v_text, mood = v_moods[1], moods = v_moods, edited_at = now(), updated_at = now()
   where id = p_id and player_id = v_pid and not deleted and kind is null
   returning * into n;
  perform set_config('hb.player_self', '0', true);
  if n.id is null then raise exception 'note_introuvable'; end if;
  return public.hb_journal_note(n);
end $$;

-- ---------- 3. Tendance des humeurs (staff) : chaque humeur d'une note compte une fois ----------

-- 8 dernières semaines (du lundi, heure de Paris), la plus ancienne en premier : { from, notes, moods: { humeur: nombre } },
-- toutes les notes (partagées ou non), jamais de texte. Mêmes droits que la lecture de la fiche (052, inchangés).
create or replace function public.hb_player_mood_trend(p_player_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_monday date := date_trunc('week', (now() at time zone 'Europe/Paris'))::date;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if not public.hb_staff_reads_player(p_player_id) then raise exception 'Réservé au staff qui suit cette fiche'; end if;
  return (
    select jsonb_build_object('weeks', jsonb_agg(jsonb_build_object('from', to_char(w.d, 'YYYY-MM-DD'), 'notes', w.notes, 'moods', w.moods) order by w.d))
      from (select s.d,
                   (select count(*) from public.hb_player_journal j
                     where j.player_id = p_player_id and not j.deleted
                       and (j.at at time zone 'Europe/Paris')::date >= s.d and (j.at at time zone 'Europe/Paris')::date < s.d + 7) as notes,
                   coalesce((select jsonb_object_agg(m.mood, m.n)
                               from (select u.mood, count(*) as n
                                       from public.hb_player_journal j
                                       cross join lateral unnest(case when cardinality(j.moods) > 0 then j.moods
                                                                      when j.mood is not null then array[j.mood] else '{}'::text[] end) u(mood)
                                      where j.player_id = p_player_id and not j.deleted
                                        and (j.at at time zone 'Europe/Paris')::date >= s.d and (j.at at time zone 'Europe/Paris')::date < s.d + 7
                                      group by u.mood) m), '{}'::jsonb) as moods
              from (select g.t::date as d from generate_series(v_monday - 49, v_monday, interval '7 days') g(t)) s) w);
end $$;

-- ---------- 4. Droits ----------

revoke all on function public.hb_humeurs_sync() from public, anon, authenticated;
revoke all on function public.hb_self_moods(text[]) from public, anon;
grant execute on function public.hb_self_moods(text[]) to authenticated;
revoke all on function public.hb_player_journal_add(text, text, text[]) from public, anon;
revoke all on function public.hb_player_journal_edit(text, text, text, text[]) from public, anon;
revoke all on function public.hb_player_mood_trend(text) from public, anon;
grant execute on function public.hb_player_journal_add(text, text, text[]) to authenticated;
grant execute on function public.hb_player_journal_edit(text, text, text, text[]) to authenticated;
grant execute on function public.hb_player_mood_trend(text) to authenticated;

-- PostgREST : relire les signatures des fonctions.
notify pgrst, 'reload schema';

-- ---------- Vérification ----------
-- Colonne moods, une seule fonction de chaque nom (pas de surcharge), droits (compte connecté, pas anon), déclencheur, notes
-- avec humeur(s) et notes à plusieurs humeurs, aucune note où mood et moods divergent (ni avec mood seule).
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hb_player_journal' and column_name = 'moods') as colonne_moods,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'hb_player_journal_add') as add_sur_1,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'hb_player_journal_edit') as edit_sur_1,
       has_function_privilege('authenticated', 'public.hb_player_journal_add(text, text, text[])', 'execute')
         and has_function_privilege('authenticated', 'public.hb_player_journal_edit(text, text, text, text[])', 'execute') as appli_ok,
       has_function_privilege('anon', 'public.hb_player_journal_add(text, text, text[])', 'execute') as anon_peut_ecrire,
       (select count(*) from pg_trigger where tgname = 'hb_humeurs_sync' and not tgisinternal) as declencheur_sur_1,
       (select count(*) from public.hb_player_journal where cardinality(moods) > 0) as notes_avec_humeur,
       (select count(*) from public.hb_player_journal where cardinality(moods) > 1) as notes_plusieurs_humeurs,
       (select count(*) from public.hb_player_journal where mood is distinct from moods[1]) as desaccords_sur_0;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- Les humeurs en plus partent (la première reste dans mood). Puis relancer, depuis 074_lampe.sql, les fonctions
-- hb_journal_note, hb_player_journal_add et hb_player_journal_edit (section 2 de 074), et depuis 052_journal_joueur.sql
-- hb_player_mood_trend (section 3) et les droits de hb_player_journal_add(text, text) / hb_player_journal_edit(text, text, text)
-- (revoke public, anon ; grant authenticated).
-- drop function if exists public.hb_player_journal_add(text, text, text[]);
-- drop function if exists public.hb_player_journal_edit(text, text, text, text[]);
-- alter table public.hb_player_journal drop constraint if exists hb_player_journal_moods;
-- drop trigger if exists hb_humeurs_sync on public.hb_player_journal;
-- drop function if exists public.hb_humeurs_sync();
-- alter table public.hb_player_journal drop column if exists moods;
-- drop function if exists public.hb_self_moods(text[]);
