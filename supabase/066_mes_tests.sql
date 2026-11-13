-- HandBase : ESPACE JOUEUR, « MES TESTS » (04/11) : le jeune voit SES tests physiques sur sa page (/moi) : par famille, ses plus
-- beaux progrès, la courbe et les mesures datées de chaque test, en PDF ou en tableur (src/components/AllTests.tsx, la même
-- vue que l'onglet Tests de la fiche). Il ne lit que SES mesures et la liste des tests (critères factuels) ; jamais les avis,
-- les critères d'observation, ni les mesures d'un autre joueur.
-- À exécuter dans Supabase > SQL Editor, APRÈS 065_objectifs_etapes.sql (il s'appuie sur 046 : index hb_measurements_player,
-- 051 : hb_is_player, hb_my_player_id, 057 : hb_canaux_ligne, 058 : hb_lire_perimetre) : base de TEST d'abord (vérifier avec
-- la requête de contrôle en fin de fichier), puis les autres. Peut être relancé sans risque (drop policy if exists, create or
-- replace). Rien d'autre n'est modifié : ni hb_upsert, ni les règles du staff, ni les écritures (un joueur n'écrit toujours
-- rien : hb_player_guard de 051).
-- L'appli marche AVANT ce script : un compte joueur demande désormais les critères et les mesures (src/playerSpace.ts,
-- PLAYER_TABLES) ; sans ce script le serveur ne lui en rend aucun (règles du staff : hb_has_role), sans erreur ; « Mes
-- tests » montre « Tes tests apparaîtront ici… ». Côté staff, rien ne change.
--
-- CE QUE LE SCRIPT FAIT
-- 1) LECTURE de hb_measurements : règle player_measurements_read : un compte joueur relié à une fiche lit les mesures de SA
--    fiche (data.playerId = hb_my_player_id()), supprimées comprises (la suppression d'une mesure doit aussi quitter son
--    appareil ; elle était déjà visible avant). Pas de fiche reliée, ou un compte du staff : hb_my_player_id() est nul, la
--    règle ne laisse rien passer (le staff garde staff_read de 046, inchangée).
-- 2) LECTURE de hb_criteria : règle player_criteria_read : un compte joueur relié à une fiche lit les critères FACTUELS
--    (data.kind = « factual » : les tests, leur famille, leur unité ; rien de personnel), pas les critères d'observation.
-- 3) hb_lire_perimetre (058, lecture par périmètre indexée, la lecture d'un compte joueur) : reprise À L'IDENTIQUE avec une
--    branche de plus pour « measurements » : les mesures de la fiche du compte joueur, par l'index hb_measurements_player
--    (046), depuis le curseur, triées et limitées comme les autres branches. Toujours SECURITY INVOKER : elle ne rend que ce
--    que les règles laissent lire (le staff : $6 nul, rien de plus).
-- 4) hb_canaux_ligne (057, portées du registre des changements de 061) : reprise À L'IDENTIQUE avec, pour une mesure, le
--    canal hb:joueur:<fiche> quand un compte joueur est relié à cette fiche (comme pour la fiche elle-même) : le registre cite
--    au jeune ses mesures nouvelles, modifiées, supprimées (sinon il ne les verrait qu'au filet quotidien). Le miroir de
--    l'appli (src/syncLive.ts, rowChannels) n'envoie jamais de signal en direct sur hb:joueur:… (seulement côté serveur,
--    comme pour les fiches). Les critères restent sur hb:staff : l'appareil du jeune les relit au premier passage et au
--    filet quotidien (ils changent rarement).
-- Retour arrière : drop policy if exists "player_measurements_read" on public.hb_measurements; drop policy if exists
-- "player_criteria_read" on public.hb_criteria; puis relancer la section 3 de 058_lecture_perimetre.sql et la section 2 de
-- 057_synchro_legere.sql (hb_lire_perimetre, hb_canaux_ligne d'avant). Les appareils des jeunes gardent leur copie jusqu'à la
-- prochaine relecture (puis « Mes tests » se vide).

-- ---------- 1 et 2. Lecture : ses mesures, les tests ----------

drop policy if exists "player_measurements_read" on public.hb_measurements;
create policy "player_measurements_read" on public.hb_measurements for select to authenticated
  using (data ->> 'playerId' = (select public.hb_my_player_id()));

drop policy if exists "player_criteria_read" on public.hb_criteria;
create policy "player_criteria_read" on public.hb_criteria for select to authenticated
  using ((select public.hb_my_player_id()) is not null and data ->> 'kind' = 'factual');

-- ---------- 3. Lecture par périmètre : ses mesures ----------

-- Copie de 058 (section 3), une branche de plus : voir le point 3 de l'en-tête.
create or replace function public.hb_lire_perimetre(p_table text, p_curseur timestamptz, p_limite integer default 1000)
returns table (id text, data jsonb, server_updated_at timestamptz)
language plpgsql stable security invoker set search_path = public, pg_temp set enable_bitmapscan = off as $$
declare
  v_lim integer := least(greatest(coalesce(p_limite, 1000), 1), 1000);
  v_cur timestamptz := coalesce(p_curseur, '-infinity'::timestamptz);
  v_rel text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if p_table is null or p_table not in ('players', 'measurements', 'evaluations', 'seen') then
    raise exception 'hb_lire_perimetre : table non prise en charge (%)', coalesce(p_table, 'null');
  end if;
  v_rel := 'hb_' || p_table;
  -- Tout est visible (administrateur, niveau Fédération) : la lecture directe, celle d'avant (index hb_<table>_sua).
  if public.hb_scope_all() then
    return query execute format(
      'select t.id, t.data, t.server_updated_at from public.%I t
        where t.server_updated_at >= $1 order by t.server_updated_at, t.id limit $2', v_rel)
      using v_cur, v_lim;
    return;
  end if;
  -- Sinon : clubs, départements, auteur (et fiche ou mesures du compte joueur), chacun par son index ; les règles de lecture filtrent
  -- chaque branche. $3 / $4 / $5 / $6 : le périmètre et l'identité du compte connecté, calculés ici, jamais par l'appareil.
  return query execute format($f$
    select u.id, u.data, u.server_updated_at
      from (
        select distinct on (x.server_updated_at, x.id) x.id, x.data, x.server_updated_at
          from (
            select c.id, c.data, c.server_updated_at
              from unnest($3::text[]) k(v)
              cross join lateral (
                select t.id, t.data, t.server_updated_at from public.%1$I t
                 where t.scope_club = k.v and t.server_updated_at >= $1
                 order by t.server_updated_at, t.id limit $2) c
            union all
            select d.id, d.data, d.server_updated_at
              from unnest($4::text[]) k(v)
              cross join lateral (
                select t.id, t.data, t.server_updated_at from public.%1$I t
                 where t.scope_dept = k.v and t.server_updated_at >= $1
                 order by t.server_updated_at, t.id limit $2) d
            union all
            (select t.id, t.data, t.server_updated_at from public.%1$I t
              where t.created_by = $5 and t.server_updated_at >= $1
              order by t.server_updated_at, t.id limit $2)
            %2$s
          ) x
         order by x.server_updated_at, x.id
      ) u
     order by u.server_updated_at, u.id
     limit $2
  $f$, v_rel,
    -- Compte joueur (051) : sa fiche (règle player_self_read) ; ses mesures (066, règle player_measurements_read : index
    -- hb_measurements_player de 046). Pour les autres comptes, $6 est null : rien.
    case p_table
      when 'players' then
        'union all (select t.id, t.data, t.server_updated_at from public.hb_players t where t.id = $6 and t.server_updated_at >= $1)'
      when 'measurements' then
        'union all (select t.id, t.data, t.server_updated_at from public.hb_measurements t
                     where t.data ->> ''playerId'' = $6 and t.server_updated_at >= $1
                     order by t.server_updated_at, t.id limit $2)'
      else '' end)
    using v_cur, v_lim, public.hb_scope_clubs(), public.hb_scope_depts(), auth.uid()::text, public.hb_my_player_id();
end $$;
revoke all on function public.hb_lire_perimetre(text, timestamptz, integer) from public, anon;
grant execute on function public.hb_lire_perimetre(text, timestamptz, integer) to authenticated;

-- ---------- 4. Portées du registre : ses mesures ----------

-- Copie de 057 (section 2), une branche de plus : voir le point 4 de l'en-tête.
create or replace function public.hb_canaux_ligne(p_table text, p_row jsonb) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  d jsonb := coalesce(p_row -> 'data', '{}'::jsonb);
  v_auteur text := 'hb:compte:' || nullif(d ->> 'createdBy', '');
  v_prive boolean := coalesce((d ->> 'private')::boolean, false);
  v_perimetre text[] := array['hb:tout', 'hb:dept:' || nullif(p_row ->> 'scope_dept', ''), 'hb:club:' || nullif(p_row ->> 'scope_club', ''), v_auteur];
  v_out text[];
begin
  case p_table
    -- Joueurs et lignes rattachées (046) : tout, département, club, auteur ; fiche d'un jeune qui a un compte (051) : lui aussi.
    when 'hb_players' then
      v_out := v_perimetre;
      if exists (select 1 from public.hb_profiles where role = 'joueur' and player_id = p_row ->> 'id') then
        v_out := array_append(v_out, 'hb:joueur:' || (p_row ->> 'id'));
      end if;
    -- Mesures (066) : aussi le jeune de la fiche s'il a un compte (« Mes tests » : il les lit, son registre doit les citer).
    when 'hb_measurements' then
      v_out := v_perimetre;
      if coalesce(d ->> 'playerId', '') <> ''
         and exists (select 1 from public.hb_profiles where role = 'joueur' and player_id = d ->> 'playerId') then
        v_out := array_append(v_out, 'hb:joueur:' || (d ->> 'playerId'));
      end if;
    when 'hb_evaluations', 'hb_seen', 'hb_rewatch' then
      v_out := v_perimetre;
    -- Vidéo d'un joueur : son périmètre ; vidéo d'un événement : tout le staff (046).
    when 'hb_videos' then
      v_out := case when d ->> 'targetKind' = 'player' then v_perimetre else array['hb:staff'] end;
    -- Suivis (032) et questions enregistrées (054) : leur auteur seul.
    when 'hb_follows', 'hb_saved_questions' then
      v_out := array[v_auteur];
    -- Staffs (034) : créateur et membres.
    when 'hb_teams' then
      v_out := array[v_auteur] || array(select 'hb:compte:' || m from jsonb_array_elements_text(public.hb_arr(d -> 'members')) m);
    -- Groupes (031/034) : privé → son auteur ; d'équipe → auteur et participants (choisis un par un ou par un staff) ; sinon tout le staff.
    when 'hb_groups' then
      v_out := case
        when v_prive then array[v_auteur]
        when coalesce((d ->> 'team')::boolean, false) then array[v_auteur] || array(select 'hb:compte:' || u from public.hb_participants(d) u)
        else array['hb:staff', v_auteur] end;
    -- Alertes (022/029) : privée → son auteur ; partagée → tout le staff.
    when 'hb_alerts' then
      v_out := case when v_prive then array[v_auteur] else array['hb:staff'] end;
    -- Événements (048) : sans organisateur (ou avant 048) : tout le staff ; sinon tout, les départements et clubs de l'organisateur
    -- et des joueurs inscrits, l'auteur, les participants.
    when 'hb_events' then
      if jsonb_typeof(p_row -> 'scope_dept') is distinct from 'array' then
        v_out := array['hb:staff'];
      else
        v_out := array['hb:tout', v_auteur]
          || array(select distinct 'hb:dept:' || x from (select jsonb_array_elements_text(public.hb_arr(p_row -> 'scope_dept')) as x
                                                           union select jsonb_array_elements_text(public.hb_arr(p_row -> 'players_dept'))) s
                    where coalesce(x, '') <> '')
          || array(select distinct 'hb:club:' || x from (select jsonb_array_elements_text(public.hb_arr(p_row -> 'scope_club')) as x
                                                           union select jsonb_array_elements_text(public.hb_arr(p_row -> 'players_club'))) s
                    where coalesce(x, '') <> '')
          || array(select 'hb:compte:' || u from public.hb_participants(d) u);
      end if;
    -- Critères et structure (044, 051 : pas pour un joueur) : tout le staff.
    when 'hb_criteria', 'hb_levels', 'hb_units', 'hb_assignments' then
      v_out := array['hb:staff'];
    -- Configuration et listes : tous les comptes, joueurs compris.
    when 'hb_config', 'hb_lists' then
      v_out := array['hb:commun'];
    -- Journal des questions (043) : administrateurs.
    when 'hb_question_log' then
      v_out := array['hb:tout'];
    else
      v_out := '{}'::text[];
  end case;
  return array(select distinct x from unnest(v_out) x where x is not null order by x);
end $$;
revoke all on function public.hb_canaux_ligne(text, jsonb) from public, anon, authenticated;

-- ---------- Vérification ----------
-- Attendu : regles_sur_2 = 2, lecture_mesures = t, canaux_mesures = t, invoker = t (deux règles, les deux fonctions reprises
-- avec leur branche, hb_lire_perimetre toujours SECURITY INVOKER).
select (select count(*) from pg_policies where schemaname = 'public'
          and ((tablename = 'hb_measurements' and policyname = 'player_measurements_read')
            or (tablename = 'hb_criteria' and policyname = 'player_criteria_read'))) as regles_sur_2,
       position('hb_measurements t' in pg_get_functiondef('public.hb_lire_perimetre(text, timestamptz, integer)'::regprocedure)) > 0 as lecture_mesures,
       position('Mesures (066)' in pg_get_functiondef('public.hb_canaux_ligne(text, jsonb)'::regprocedure)) > 0 as canaux_mesures,
       (select not prosecdef from pg_proc where oid = 'public.hb_lire_perimetre(text, timestamptz, integer)'::regprocedure) as invoker;
