-- HandBase / Nextar : ESPACE JOUEUR, « LAMPE D'ALADIN » (jauge de la saison), CAHIER DU HAND, CAHIER DE MATCH, « 3 VŒUX »
-- (09/11, règles proposées par le responsable du pôle de Saint-Raphaël, construites avec des valeurs par défaut).
-- À exécuter dans Supabase > SQL Editor, APRÈS 073_wellness.sql (il s'appuie sur 052 hb_player_journal / hb_player_self_id /
-- hb_journal_note / hb_self_line / hb_self_iso, 073 hb_wellness_actif / hb_wl_auj / hb_wl_demande / hb_wellness_staff_lit /
-- hb_wellness_groupe) : base de TEST d'abord (vérifier avec la requête de contrôle en fin de fichier), puis les autres. Peut
-- être relancé sans risque (create table if not exists, add column if not exists, create or replace, drop … if exists).
-- ADDITIF : une table (hb_lampe), trois colonnes sur hb_player_journal (table du jeune, PAS synchronisée), des fonctions, un
-- déclencheur de garde, un déclencheur sur hb_players (fiche effacée, supprimée ou fondue) et un sur hb_player_journal (note
-- retirée : ses champs partent aussi). Deux fonctions de 052 sont
-- reprises avec une ligne de plus (hb_player_journal_add : la limite de 200 notes ne compte que les notes simples ;
-- hb_player_journal_edit : ne corrige pas un cahier, qui passe par hb_cahier_enregistrer) et hb_journal_note rend en plus
-- kind / day / parts. Ni hb_upsert, ni hb_stamp / hb_log / hb_touch, ni la synchronisation, ni aucune colonne, index ou
-- règle des tables synchronisées ne sont touchés (tools/essai-sql-074 compare les empreintes avant et après).
-- L'appli marche AVANT ce script : l'onglet « Ma lampe » dit « pas encore en place sur ce serveur » (fonction absente :
-- PGRST202, repli silencieux), le journal reste comme avant ; rien d'autre ne change.
--
-- PRINCIPE
--  - La lampe compte les jours de classe (lundi → vendredi, hors vacances scolaires de la zone et jours fériés : calcul de
--    l'appli, src/lamp.ts) où les 3 tâches du jour sont faites : wellness du matin (hb_wellness, 073), au moins une séance
--    notée pour ce jour (hb_wellness_seances, 073), cahier du hand rempli (3 questions) ; le cahier de match du week-end donne
--    un bonus. Le serveur ne rend que des MASQUES PAR JOUR (bit 1 wellness, 2 séance, 4 cahier du hand, 8 cahier de match :
--    hb_lp_bits), jamais un texte au staff ; le pourcentage se calcule sur l'appareil (mêmes règles pour le jeune et le staff,
--    testées par tools/test-lampe.ts), parce que le calendrier des vacances et les réglages vivent dans l'appli.
--  - Ouverte quand le wellness l'est (073 : hb_config « wellness ») ET le réglage hb_config « lampe » : { "actif": true }
--    (fermée par défaut : récompenses de mineurs, décision du pôle). Concerne les jeunes à qui le wellness est demandé.
--    Réglage complet (Réglages → Lampe d'Aladin, administrateurs, écrit comme toute la configuration : hb_upsert inchangé) :
--    { actif, debut, zone, pont, criteres: [{ key, label }], catalogue: [{ id, label, by }], regles: { … } }.
--  - CAHIERS : deux sortes de notes du « journal du hand » (052) : kind = 'cahier' (travail, difficile, objectif ; 500
--    caractères chacun) ou 'match' (adversaire, nous / eux, resultat, sensation super / correct / complique — jamais un mot
--    négatif —, mt1 / mt2 en minutes, bienAtt / bienDef / amelAtt / amelDef ; 300 caractères), jour = le jour raconté, parts =
--    les champs nettoyés (hb_lp_parts), text = un texte lisible (hb_lp_texte : le journal et les anciennes versions de l'appli
--    l'affichent). PRIVÉS par défaut, partagés une par une comme les autres notes (hb_player_journal_share, inchangée) : le
--    staff ne lit que celles qui sont partagées (règles de 052, inchangées). Une par jour et par sorte (réécrite).
--  - Table hb_lampe (une ligne par jeune et par saison = année de la rentrée) : coach = points des encadrants { critère: 0 à
--    2 } (ils s'AJOUTENT : un encadrant ne baisse jamais un point, un administrateur peut corriger une erreur) ; voeux =
--    identifiants du catalogue (3 au plus, dans l'ordre). LECTURE : par les fonctions ; règles RLS en plus comme 073 (le jeune
--    la sienne, le staff qui lit son wellness, les administrateurs). ÉCRITURE : jamais directe (hb_player_guard aussi).
--
-- FONCTIONS DE L'APPLI
--  1) hb_cahier_enregistrer(p_kind, p_jour, p_parts) → la note (avec kind, day, parts) ; null : tout était vide, la note du
--     jour est retirée. Le jeune, pour SA fiche ; cahier du hand : aujourd'hui ou hier ; cahier de match : jusqu'à 3 jours
--     avant (hb_lp_retard) ; refus : pas_joueur, sans_fiche, sorte, jour_ferme, trop_long. 400 cahiers au plus par sorte.
--  2) hb_lampe_moi() → { actif, demande, saison, aujourdhui, reglage, jours: { jour: masque }, coach, voeux } (le jeune).
--  3) hb_lampe_voeux(p_voeux) → les vœux gardés (le jeune ; lampe ouverte et demandée : lampe_fermee, pas_demande).
--  4) hb_lampe_groupe(p_group_id) → staff du groupe (mêmes droits et mêmes fiches que hb_wellness_groupe, 073, appelée
--     dedans) : { actif, saison, aujourdhui, comptes, joueurs: { fiche: { jours, coach, coachAt, voeux } } }.
--  5) hb_lampe_coach(p_player_id, p_points) → les points gardés : administrateur, ou encadrant qui lit le wellness de la fiche
--     (hb_wellness_staff_lit) ; refus : joueur_inconnu (même refus pour tout le reste), lampe_fermee, baisse.
-- Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 0. Prérequis ----------
do $$
begin
  if to_regprocedure('public.hb_wellness_groupe(text, int)') is null or to_regprocedure('public.hb_wl_demande(text)') is null
     or to_regprocedure('public.hb_wellness_staff_lit(text)') is null or to_regclass('public.hb_player_journal') is null
     or to_regprocedure('public.hb_self_line(jsonb, int)') is null then
    raise exception '074 demande 052 et 073 (hb_player_journal, hb_wellness_groupe…) : passer d''abord les scripts d''avant.';
  end if;
end $$;

-- ---------- 1. Constantes et outils (internes) ----------

-- Mois de la rentrée (9 = septembre) : même valeur que LAMP_SEASON_MONTH (src/lamp.ts).
create or replace function public.hb_lp_mois() returns int language sql immutable as $$ select 9 $$;
-- Jours en arrière où un cahier s'écrit encore : CAHIER_BACK_DAYS = 1, MATCH_BACK_DAYS = 3 (src/cahiers.ts).
create or replace function public.hb_lp_retard(p_kind text) returns int language sql immutable as $$
  select case p_kind when 'cahier' then 1 when 'match' then 3 end
$$;
-- Cahiers gardés au plus, par sorte et par fiche (environ deux saisons).
create or replace function public.hb_lp_max_cahiers() returns int language sql immutable as $$ select 400 $$;

-- Année de la rentrée de la saison d'un jour (2026 pour 2026-2027).
create or replace function public.hb_lp_saison(p date) returns int language sql immutable as $$
  select extract(year from p)::int - case when extract(month from p)::int < public.hb_lp_mois() then 1 else 0 end
$$;

-- Réglage « lampe » (hb_config) : sa valeur, {} sans réglage.
create or replace function public.hb_lp_reglage() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(data -> 'value') = 'object' then data -> 'value' end
                     from public.hb_config where id = 'lampe' and not deleted), '{}'::jsonb)
$$;
-- Ouverte : wellness ouvert (073) et réglage « lampe » actif.
create or replace function public.hb_lp_actif() returns boolean
language sql stable security definer set search_path = public as $$
  select public.hb_wellness_actif() and coalesce(public.hb_lp_reglage() -> 'actif' = 'true'::jsonb, false)
$$;
-- Critères des encadrants (clés) : ceux du réglage, sinon ceux de DEFAULT_COACH_CRITERIA (src/lamp.ts).
create or replace function public.hb_lp_criteres() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array_agg(c ->> 'key' order by o) from jsonb_array_elements(case when jsonb_typeof(public.hb_lp_reglage() -> 'criteres') = 'array'
                                                                         then public.hb_lp_reglage() -> 'criteres' else '[]'::jsonb end) with ordinality x(c, o)
      where jsonb_typeof(c -> 'key') = 'string' and c ->> 'key' ~ '^[a-z0-9_-]{1,32}$' and o <= 8),
    array['entrainabilite', 'attitude', 'humeur', 'remise', 'transformation'])
$$;
-- Points au plus par critère (règle coachPointsMax : 2 par défaut, 1 à 5).
create or replace function public.hb_lp_points_max() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (public.hb_lp_reglage() -> 'regles' ->> 'coachPointsMax')::int
                    where (public.hb_lp_reglage() -> 'regles' ->> 'coachPointsMax') ~ '^[1-5]$'), 2)
$$;
-- Questions du cahier du hand à remplir pour que la tâche compte (règle cahierMinFields : 3 par défaut, 1 à 3).
create or replace function public.hb_lp_min_champs() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (public.hb_lp_reglage() -> 'regles' ->> 'cahierMinFields')::int
                    where (public.hb_lp_reglage() -> 'regles' ->> 'cahierMinFields') ~ '^[1-3]$'), 3)
$$;
-- Catalogue des vœux (identifiants) : celui du réglage s'il existe (même vide), sinon DEFAULT_WISHES (src/lamp.ts).
create or replace function public.hb_lp_catalogue() returns text[]
language sql stable security definer set search_path = public as $$
  select case when jsonb_typeof(public.hb_lp_reglage() -> 'catalogue') = 'array'
              then coalesce((select array_agg(c ->> 'id') from jsonb_array_elements(public.hb_lp_reglage() -> 'catalogue') c
                              where jsonb_typeof(c -> 'id') = 'string' and c ->> 'id' ~ '^[a-z0-9_-]{1,32}$'), '{}')
              else array['carte-edf', 'places-edf', 'ballon', 'maillot', 'centre', 'pro'] end
$$;

-- Texte de plusieurs lignes : caractères de contrôle retirés (sauf retours à la ligne), bords coupés, p_max caractères.
create or replace function public.hb_lp_txt(p jsonb, p_max int) returns text
language sql immutable as $$
  select case when jsonb_typeof(p) = 'string' then
    nullif(btrim(left(btrim(regexp_replace(replace(replace(p #>> '{}', E'\r\n', E'\n'), E'\r', E'\n'),
                                           E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', '', 'g'), E' \t\n'), p_max), E' \t\n'), '') end
$$;
-- Entier 0 → p_max ; sinon null.
create or replace function public.hb_lp_int(p jsonb, p_max int) returns int
language sql immutable as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^\d{1,3}$' and (p #>> '{}')::int <= p_max then (p #>> '{}')::int end
$$;

-- Champs d'un cahier nettoyés (mêmes règles que cleanCahier / cleanMatch, src/cahiers.ts) ; sorte inconnue : null.
create or replace function public.hb_lp_parts(p_kind text, p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  v_nous int;
  v_eux int;
  v_res text;
begin
  if jsonb_typeof(p) is distinct from 'object' then p := '{}'::jsonb; end if;
  if p_kind = 'cahier' then
    return jsonb_strip_nulls(jsonb_build_object('travail', public.hb_lp_txt(p -> 'travail', 500), 'difficile', public.hb_lp_txt(p -> 'difficile', 500),
                                                'objectif', public.hb_lp_txt(p -> 'objectif', 500)));
  elsif p_kind = 'match' then
    v_nous := public.hb_lp_int(p -> 'nous', 99);
    v_eux := public.hb_lp_int(p -> 'eux', 99);
    if v_nous is null or v_eux is null then v_nous := null; v_eux := null; end if;
    v_res := case when v_nous is not null then case when v_nous > v_eux then 'victoire' when v_nous < v_eux then 'defaite' else 'nul' end
                  when p ->> 'resultat' in ('victoire', 'nul', 'defaite') and jsonb_typeof(p -> 'resultat') = 'string' then p ->> 'resultat' end;
    return jsonb_strip_nulls(jsonb_build_object(
      'adversaire', public.hb_self_line(p -> 'adversaire', 80), 'nous', v_nous, 'eux', v_eux, 'resultat', v_res,
      'sensation', case when jsonb_typeof(p -> 'sensation') = 'string' and p ->> 'sensation' in ('super', 'correct', 'complique') then p ->> 'sensation' end,
      'mt1', public.hb_lp_int(p -> 'mt1', 40), 'mt2', public.hb_lp_int(p -> 'mt2', 40),
      'bienAtt', public.hb_lp_txt(p -> 'bienAtt', 300), 'bienDef', public.hb_lp_txt(p -> 'bienDef', 300),
      'amelAtt', public.hb_lp_txt(p -> 'amelAtt', 300), 'amelDef', public.hb_lp_txt(p -> 'amelDef', 300)));
  end if;
  return null;
end $$;

-- La tâche compte-t-elle (même règle que partsCount, src/cahiers.ts) ? Cahier du hand : p_min questions remplies ; cahier de
-- match : la sensation et au moins une ligne « bien fait / améliorer ».
create or replace function public.hb_lp_ok(p_kind text, p jsonb, p_min int) returns boolean
language sql immutable as $$
  select case p_kind
    when 'cahier' then (select count(*) from unnest(array['travail', 'difficile', 'objectif']) k where coalesce(p ->> k, '') <> '') >= p_min
    when 'match' then coalesce(p ->> 'sensation', '') <> '' and exists (select 1 from unnest(array['bienAtt', 'bienDef', 'amelAtt', 'amelDef']) k where coalesce(p ->> k, '') <> '')
    else false end
$$;

-- Texte lisible de la note (même forme que cahierText, src/cahiers.ts), 1 000 caractères.
create or replace function public.hb_lp_texte(p_kind text, p jsonb) returns text
language sql immutable as $$
  select left(array_to_string(array_remove(case p_kind
    when 'cahier' then array['📒 Cahier du hand',
      'Ce que j’ai travaillé / mes sensations : ' || (p ->> 'travail'),
      'Ce qui était difficile : ' || (p ->> 'difficile'),
      'Mon objectif sur le même thème : ' || (p ->> 'objectif')]
    else array['🏟️ Cahier de match' || coalesce(' contre ' || (p ->> 'adversaire'), ''),
      case when p ? 'resultat' or p ? 'nous' then 'Résultat : ' || btrim(coalesce(case p ->> 'resultat' when 'victoire' then 'Victoire' when 'nul' then 'Nul' when 'defaite' then 'Défaite' end, '') || coalesce(' ' || (p ->> 'nous') || ' – ' || (p ->> 'eux'), '')) end,
      'Sensation : ' || case p ->> 'sensation' when 'super' then 'Super' when 'correct' then 'Correct' when 'complique' then 'Compliqué' end,
      case when p ? 'mt1' or p ? 'mt2' then 'Temps de jeu : ' || coalesce(p ->> 'mt1', '0') || ' + ' || coalesce(p ->> 'mt2', '0') || ' = '
           || (coalesce((p ->> 'mt1')::int, 0) + coalesce((p ->> 'mt2')::int, 0)) || ' min' end,
      'Ce que j’ai bien fait en attaque : ' || (p ->> 'bienAtt'),
      'Ce que j’ai bien fait en défense : ' || (p ->> 'bienDef'),
      'Ce que je peux améliorer en attaque : ' || (p ->> 'amelAtt'),
      'Ce que je peux améliorer en défense : ' || (p ->> 'amelDef')] end, null), E'\n'), 1000)
$$;

-- ---------- 2. Cahiers : trois colonnes sur le journal du jeune (052, pas synchronisé) ----------

alter table public.hb_player_journal add column if not exists kind text;
alter table public.hb_player_journal add column if not exists jour date;
alter table public.hb_player_journal add column if not exists parts jsonb;
alter table public.hb_player_journal drop constraint if exists hb_player_journal_kind;
alter table public.hb_player_journal add constraint hb_player_journal_kind check (
  (kind is null and jour is null and parts is null)
  or (kind in ('cahier', 'match') and jour is not null and jsonb_typeof(parts) = 'object'));
create index if not exists hb_player_journal_cahiers on public.hb_player_journal (player_id, kind, jour) where kind is not null and not deleted;

-- Note retirée (hb_player_journal_delete de 052, inchangée, ou cahier vidé) : ses champs partent avec son texte, tout de suite.
create or replace function public.hb_lp_efface() returns trigger
language plpgsql as $$
begin
  if new.deleted then
    new.kind := null;
    new.jour := null;
    new.parts := null;
  end if;
  return new;
end $$;
drop trigger if exists hb_lp_efface on public.hb_player_journal;
create trigger hb_lp_efface before update on public.hb_player_journal
  for each row execute function public.hb_lp_efface();

-- Une note telle que l'appli la reçoit (052 + kind, day, parts pour un cahier).
create or replace function public.hb_journal_note(n public.hb_player_journal) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', n.id, 'at', public.hb_self_iso(n.at), 'text', n.text, 'mood', n.mood,
                                              'shared', n.shared, 'editedAt', public.hb_self_iso(n.edited_at),
                                              'kind', n.kind, 'day', to_char(n.jour, 'YYYY-MM-DD'), 'parts', n.parts))
$$;

-- Reprise de 052 : la limite de 200 ne compte (et n'efface) que les notes simples, jamais un cahier.
create or replace function public.hb_player_journal_add(p_text text, p_mood text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pid text := public.hb_player_self_id();
  v_text text := public.hb_self_note_text(p_text);
  v_id text;
  n public.hb_player_journal;
begin
  if v_text is null then raise exception 'note_vide'; end if;
  loop
    v_id := 'n' || substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=', 'xyz'), 1, 10);
    exit when not exists (select 1 from public.hb_player_journal where id = v_id);
  end loop;
  perform set_config('hb.player_self', '1', true);
  insert into public.hb_player_journal (id, player_id, user_id, at, text, mood)
  values (v_id, v_pid, auth.uid(), clock_timestamp(), v_text, public.hb_self_mood(p_mood))
  returning * into n;
  delete from public.hb_player_journal
   where id in (select id from public.hb_player_journal where player_id = v_pid and not deleted and kind is null -- 074
                 order by at desc, id desc offset 200);
  perform set_config('hb.player_self', '0', true);
  return public.hb_journal_note(n);
end $$;

-- Reprise de 052 : un cahier ne se corrige pas ici (il passe par hb_cahier_enregistrer, qui garde ses champs).
create or replace function public.hb_player_journal_edit(p_id text, p_text text, p_mood text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_text text := public.hb_self_note_text(p_text);
  n public.hb_player_journal;
begin
  if v_text is null then raise exception 'note_vide'; end if;
  perform set_config('hb.player_self', '1', true);
  update public.hb_player_journal
     set text = v_text, mood = public.hb_self_mood(p_mood), edited_at = now(), updated_at = now()
   where id = p_id and player_id = v_pid and not deleted and kind is null -- 074
   returning * into n;
  perform set_config('hb.player_self', '0', true);
  if n.id is null then raise exception 'note_introuvable'; end if;
  return public.hb_journal_note(n);
end $$;

-- Écrire le cahier d'un jour (réécrit s'il existe ; tout vide : retiré).
create or replace function public.hb_cahier_enregistrer(p_kind text, p_jour text, p_parts jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pid text := public.hb_player_self_id();
  v_auj date := public.hb_wl_auj();
  v_jour date;
  v_parts jsonb;
  v_id text;
  n public.hb_player_journal;
begin
  if length(coalesce(p_parts::text, '')) > 8000 then raise exception 'trop_long'; end if;
  if p_kind is null or p_kind not in ('cahier', 'match') then raise exception 'sorte'; end if;
  begin
    v_jour := case when coalesce(p_jour, '') ~ '^\d{4}-\d{2}-\d{2}$' then p_jour::date end;
  exception when others then
    v_jour := null;
  end;
  if v_jour is null or v_jour > v_auj or v_jour < v_auj - public.hb_lp_retard(p_kind) then raise exception 'jour_ferme'; end if;
  v_parts := public.hb_lp_parts(p_kind, p_parts);
  select id into v_id from public.hb_player_journal
   where player_id = v_pid and kind = p_kind and jour = v_jour and not deleted
   order by at desc, id desc limit 1 for update;
  perform set_config('hb.player_self', '1', true);
  if v_parts = '{}'::jsonb then
    -- Tout vide : la note du jour est retirée (comme hb_player_journal_delete : son contenu est effacé tout de suite).
    update public.hb_player_journal
       set deleted = true, text = '', mood = null, shared = false, shared_at = null, kind = null, jour = null, parts = null, updated_at = now()
     where player_id = v_pid and kind = p_kind and jour = v_jour and not deleted;
    perform set_config('hb.player_self', '0', true);
    return null;
  end if;
  if v_id is not null then
    update public.hb_player_journal
       set text = public.hb_lp_texte(p_kind, v_parts), parts = v_parts, edited_at = now(), updated_at = now(), user_id = auth.uid()
     where id = v_id
     returning * into n;
  else
    loop
      v_id := 'n' || substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=', 'xyz'), 1, 10);
      exit when not exists (select 1 from public.hb_player_journal where id = v_id);
    end loop;
    insert into public.hb_player_journal (id, player_id, user_id, at, text, kind, jour, parts)
    values (v_id, v_pid, auth.uid(), clock_timestamp(), public.hb_lp_texte(p_kind, v_parts), p_kind, v_jour, v_parts)
    returning * into n;
    delete from public.hb_player_journal
     where id in (select id from public.hb_player_journal where player_id = v_pid and kind = p_kind and not deleted
                   order by jour desc, at desc offset public.hb_lp_max_cahiers());
  end if;
  perform set_config('hb.player_self', '0', true);
  return public.hb_journal_note(n);
end $$;

-- ---------- 3. Table hb_lampe : points des encadrants, vœux ----------

create table if not exists public.hb_lampe (
  player_id text not null,
  saison int not null,
  coach jsonb not null default '{}'::jsonb,
  coach_by uuid,
  coach_at timestamptz,
  voeux jsonb not null default '[]'::jsonb,
  voeux_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (player_id, saison)
);
alter table public.hb_lampe drop constraint if exists hb_lampe_forme;
alter table public.hb_lampe add constraint hb_lampe_forme check (
  jsonb_typeof(coach) = 'object' and jsonb_typeof(voeux) = 'array' and jsonb_array_length(voeux) <= 3 and saison between 2000 and 2100);
alter table public.hb_lampe enable row level security;
revoke all on public.hb_lampe from public, anon, authenticated;
grant select on public.hb_lampe to authenticated;
drop policy if exists "player_read" on public.hb_lampe;
create policy "player_read" on public.hb_lampe for select to authenticated using (player_id = (select public.hb_my_player_id()));
drop policy if exists "staff_read" on public.hb_lampe;
create policy "staff_read" on public.hb_lampe for select to authenticated using (public.hb_wellness_staff_lit(player_id));
drop trigger if exists hb_a_player_guard on public.hb_lampe;
create trigger hb_a_player_guard before insert or update or delete on public.hb_lampe
  for each row execute function public.hb_player_guard();

-- ---------- 4. Masques par jour ----------

-- { 'AAAA-MM-JJ': masque } d'une fiche de p_from à p_to : 1 wellness, 2 séance, 4 cahier du hand qui compte, 8 cahier de
-- match qui compte (mêmes bits que TASK, src/lamp.ts).
create or replace function public.hb_lp_bits(p_pid text, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(to_char(x.jour, 'YYYY-MM-DD'), x.b), '{}'::jsonb)
    from (select jour, bit_or(b) as b
            from (select w.jour, 1 as b from public.hb_wellness w where w.player_id = p_pid and w.jour between p_from and p_to
                  union all
                  select s.jour, 2 from public.hb_wellness_seances s where s.player_id = p_pid and s.jour between p_from and p_to
                  union all
                  select j.jour, case j.kind when 'cahier' then 4 else 8 end from public.hb_player_journal j
                   where j.player_id = p_pid and j.kind is not null and not j.deleted and j.jour between p_from and p_to
                     and public.hb_lp_ok(j.kind, j.parts, public.hb_lp_min_champs())) t
           group by jour) x
$$;

-- Début de la saison en cours (1er septembre).
create or replace function public.hb_lp_debut() returns date language sql stable as $$
  select make_date(public.hb_lp_saison(public.hb_wl_auj()), public.hb_lp_mois(), 1)
$$;

-- ---------- 5. Le jeune ----------

create or replace function public.hb_lampe_moi() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_auj date := public.hb_wl_auj();
  v_saison int := public.hb_lp_saison(v_auj);
  r public.hb_lampe;
begin
  select * into r from public.hb_lampe where player_id = v_pid and saison = v_saison;
  return jsonb_build_object(
    'actif', public.hb_lp_actif(),
    'demande', public.hb_lp_actif() and public.hb_wl_demande(v_pid),
    'saison', v_saison,
    'aujourdhui', to_char(v_auj, 'YYYY-MM-DD'),
    'reglage', public.hb_lp_reglage() - 'actif',
    'jours', public.hb_lp_bits(v_pid, public.hb_lp_debut(), v_auj),
    'coach', coalesce(r.coach, '{}'::jsonb),
    'voeux', coalesce(r.voeux, '[]'::jsonb));
end $$;

create or replace function public.hb_lampe_voeux(p_voeux jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_saison int := public.hb_lp_saison(public.hb_wl_auj());
  v_cat text[] := public.hb_lp_catalogue();
  v_out jsonb := '[]'::jsonb;
  e jsonb;
begin
  if length(coalesce(p_voeux::text, '')) > 2000 then raise exception 'trop_long'; end if;
  if not public.hb_lp_actif() then raise exception 'lampe_fermee'; end if;
  if not public.hb_wl_demande(v_pid) then raise exception 'pas_demande'; end if;
  -- Identifiants du catalogue, sans doublon, dans l'ordre, 3 au plus (comme cleanWishes, src/lamp.ts) ; le reste ignoré.
  for e in select x from jsonb_array_elements(case when jsonb_typeof(p_voeux) = 'array' then p_voeux else '[]'::jsonb end) x loop
    exit when jsonb_array_length(v_out) >= 3;
    if jsonb_typeof(e) = 'string' and (e #>> '{}') = any (v_cat) and not v_out @> jsonb_build_array(e) then v_out := v_out || jsonb_build_array(e); end if;
  end loop;
  perform set_config('hb.player_self', '1', true);
  insert into public.hb_lampe (player_id, saison, voeux, voeux_at) values (v_pid, v_saison, v_out, now())
  on conflict (player_id, saison) do update set voeux = excluded.voeux, voeux_at = now(), updated_at = now();
  perform set_config('hb.player_self', '0', true);
  return v_out;
end $$;

-- ---------- 6. Le staff ----------

create or replace function public.hb_lampe_groupe(p_group_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_auj date := public.hb_wl_auj();
  v_saison int := public.hb_lp_saison(v_auj);
  v_debut date := public.hb_lp_debut();
  v_ids text[];
begin
  -- Droits et fiches : exactement ceux du tableau du wellness (073 : refus groupe_inconnu ; comptes = fiches du groupe qui ont
  -- un compte joueur, que le groupe compte et que ce compte lit).
  select coalesce(array_agg(x), '{}') into v_ids
    from jsonb_array_elements_text(public.hb_wellness_groupe(p_group_id, 1) -> 'comptes') x;
  return jsonb_build_object(
    'actif', public.hb_lp_actif(),
    'saison', v_saison,
    'aujourdhui', to_char(v_auj, 'YYYY-MM-DD'),
    'comptes', to_jsonb(v_ids),
    'joueurs', coalesce((select jsonb_object_agg(i, jsonb_strip_nulls(jsonb_build_object(
                 'jours', public.hb_lp_bits(i, v_debut, v_auj),
                 'coach', coalesce(l.coach, '{}'::jsonb),
                 'coachAt', public.hb_self_iso(l.coach_at),
                 'voeux', coalesce(l.voeux, '[]'::jsonb))))
                  from unnest(v_ids) i
                  left join public.hb_lampe l on l.player_id = i and l.saison = v_saison), '{}'::jsonb));
end $$;

create or replace function public.hb_lampe_coach(p_player_id text, p_points jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.hb_is_admin();
  v_saison int := public.hb_lp_saison(public.hb_wl_auj());
  v_max int := public.hb_lp_points_max();
  v_crit text[] := public.hb_lp_criteres();
  v_new jsonb := '{}'::jsonb;
  v_old jsonb;
  k text;
begin
  if v_uid is null or not exists (select 1 from public.hb_profiles where user_id = v_uid and role in ('admin', 'preparateur'))
     or not public.hb_wellness_staff_lit(coalesce(p_player_id, '')) then
    raise exception 'joueur_inconnu';
  end if;
  if not public.hb_lp_actif() then raise exception 'lampe_fermee'; end if;
  -- Clés des critères, entiers 1 → max (0 : absent) ; le reste ignoré.
  foreach k in array v_crit loop
    if jsonb_typeof(p_points -> k) = 'number' and (p_points ->> k) ~ '^\d+$' and (p_points ->> k)::int > 0 then
      v_new := v_new || jsonb_build_object(k, least((p_points ->> k)::int, v_max));
    end if;
  end loop;
  select coach into v_old from public.hb_lampe where player_id = p_player_id and saison = v_saison;
  -- Ils s'ajoutent seulement : un encadrant ne baisse jamais un point (un administrateur peut corriger une erreur).
  if not v_admin and exists (select 1 from jsonb_each_text(coalesce(v_old, '{}'::jsonb)) o
                              where o.value ~ '^\d+$' and coalesce((v_new ->> o.key)::int, 0) < o.value::int and o.key = any (v_crit)) then
    raise exception 'baisse';
  end if;
  insert into public.hb_lampe (player_id, saison, coach, coach_by, coach_at) values (p_player_id, v_saison, v_new, v_uid, now())
  on conflict (player_id, saison) do update set coach = excluded.coach, coach_by = v_uid, coach_at = now(), updated_at = now();
  return v_new;
end $$;

-- ---------- 7. Fiche effacée, supprimée ou fondue ----------

create or replace function public.hb_lampe_forget() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_into text;
begin
  if tg_op = 'DELETE' then
    delete from public.hb_lampe where player_id = old.id;
  elsif coalesce((new.data ->> 'purged')::boolean, false) then
    delete from public.hb_lampe where player_id = new.id;
  elsif coalesce(new.data ->> 'mergedInto', '') <> '' and coalesce(old.data ->> 'mergedInto', '') = '' then
    -- Fiche fondue : sa ligne suit la fiche gardée (celle de la fiche gardée prime pour une même saison).
    v_into := new.data ->> 'mergedInto';
    update public.hb_lampe l set player_id = v_into, updated_at = now()
     where l.player_id = new.id and not exists (select 1 from public.hb_lampe t where t.player_id = v_into and t.saison = l.saison);
    delete from public.hb_lampe where player_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists hb_lampe_forget on public.hb_players;
create trigger hb_lampe_forget after update or delete on public.hb_players
  for each row execute function public.hb_lampe_forget();

-- ---------- 8. Droits des fonctions ----------

do $$
declare f text;
begin
  foreach f in array array['public.hb_lp_mois()', 'public.hb_lp_retard(text)', 'public.hb_lp_max_cahiers()', 'public.hb_lp_saison(date)',
      'public.hb_lp_reglage()', 'public.hb_lp_actif()', 'public.hb_lp_criteres()', 'public.hb_lp_points_max()', 'public.hb_lp_min_champs()',
      'public.hb_lp_catalogue()', 'public.hb_lp_txt(jsonb, int)', 'public.hb_lp_int(jsonb, int)', 'public.hb_lp_parts(text, jsonb)',
      'public.hb_lp_ok(text, jsonb, int)', 'public.hb_lp_texte(text, jsonb)', 'public.hb_lp_bits(text, date, date)', 'public.hb_lp_debut()',
      'public.hb_lampe_forget()', 'public.hb_lp_efface()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.hb_cahier_enregistrer(text, text, jsonb)', 'public.hb_lampe_moi()', 'public.hb_lampe_voeux(jsonb)',
      'public.hb_lampe_groupe(text)', 'public.hb_lampe_coach(text, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- Vérification ----------
-- Table et ses 2 règles, 3 colonnes du journal, 5 fonctions de l'appli (compte connecté, pas anon), 3 déclencheurs, lampe
-- ouverte (fermée tant que le réglage n'est pas posé), lignes (0 au départ), cahiers enregistrés.
select to_regclass('public.hb_lampe') is not null as table_ok,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'hb_lampe') as regles_sur_2,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hb_player_journal'
          and column_name in ('kind', 'jour', 'parts')) as colonnes_sur_3,
       has_function_privilege('authenticated', 'public.hb_cahier_enregistrer(text, text, jsonb)', 'execute')
         and has_function_privilege('authenticated', 'public.hb_lampe_moi()', 'execute')
         and has_function_privilege('authenticated', 'public.hb_lampe_voeux(jsonb)', 'execute')
         and has_function_privilege('authenticated', 'public.hb_lampe_groupe(text)', 'execute')
         and has_function_privilege('authenticated', 'public.hb_lampe_coach(text, jsonb)', 'execute') as appli_ok,
       has_function_privilege('anon', 'public.hb_lampe_coach(text, jsonb)', 'execute') as anon_peut_ecrire,
       (select count(*) from pg_trigger where tgname in ('hb_lampe_forget', 'hb_lp_efface')
           or (tgname = 'hb_a_player_guard' and tgrelid = 'public.hb_lampe'::regclass)) as declencheurs_sur_3,
       public.hb_lp_actif() as lampe_ouverte,
       (select count(*) from public.hb_lampe) as lampe_lignes,
       (select count(*) from public.hb_player_journal where kind is not null) as cahiers;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- Les cahiers partent avec les colonnes (les notes restent, avec leur texte lisible : elles deviennent des notes simples) ;
-- le réglage hb_config « lampe » peut rester (ignoré sans ce script). Puis relancer, depuis 052_journal_joueur.sql, les
-- fonctions hb_journal_note, hb_player_journal_add et hb_player_journal_edit (section 2 de 052 : avant ce script, sans les
-- lignes « -- 074 »).
-- drop trigger if exists hb_lampe_forget on public.hb_players;
-- drop function if exists public.hb_lampe_forget();
-- drop function if exists public.hb_lampe_coach(text, jsonb);
-- drop function if exists public.hb_lampe_groupe(text);
-- drop function if exists public.hb_lampe_voeux(jsonb);
-- drop function if exists public.hb_lampe_moi();
-- drop function if exists public.hb_cahier_enregistrer(text, text, jsonb);
-- drop function if exists public.hb_lp_debut();
-- drop function if exists public.hb_lp_bits(text, date, date);
-- drop table if exists public.hb_lampe;
-- drop trigger if exists hb_lp_efface on public.hb_player_journal;
-- drop function if exists public.hb_lp_efface();
-- drop index if exists public.hb_player_journal_cahiers;
-- alter table public.hb_player_journal drop constraint if exists hb_player_journal_kind;
-- update public.hb_player_journal set kind = null, jour = null, parts = null where kind is not null;
-- alter table public.hb_player_journal drop column if exists kind;
-- alter table public.hb_player_journal drop column if exists jour;
-- alter table public.hb_player_journal drop column if exists parts;
-- drop function if exists public.hb_lp_texte(text, jsonb);
-- drop function if exists public.hb_lp_ok(text, jsonb, int);
-- drop function if exists public.hb_lp_parts(text, jsonb);
-- drop function if exists public.hb_lp_int(jsonb, int);
-- drop function if exists public.hb_lp_txt(jsonb, int);
-- drop function if exists public.hb_lp_catalogue();
-- drop function if exists public.hb_lp_min_champs();
-- drop function if exists public.hb_lp_points_max();
-- drop function if exists public.hb_lp_criteres();
-- drop function if exists public.hb_lp_actif();
-- drop function if exists public.hb_lp_reglage();
-- drop function if exists public.hb_lp_saison(date);
-- drop function if exists public.hb_lp_max_cahiers();
-- drop function if exists public.hb_lp_retard(text);
-- drop function if exists public.hb_lp_mois();

-- ---------- ACTIVATION (plus tard, à la main, décision du pôle) ----------
-- insert into public.hb_config (id, data) values ('lampe', '{"id":"lampe","key":"lampe","value":{"actif":true}}')
--   on conflict (id) do update set data = jsonb_set(public.hb_config.data, '{value,actif}', 'true'::jsonb), deleted = false;
