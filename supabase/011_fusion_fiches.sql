-- HandBase : fusion de deux fiches joueur (doublons, fiche proposée qui obtient une licence…).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 010_secteurs.sql.
--
-- hb_merge_players(source, cible) : la fiche « source » est fondue dans la fiche « cible », qui reste.
--   - les avis, mesures et adultes référents de la source passent sur la cible ;
--   - dans les listes de joueurs des événements, la source est remplacée par la cible (sans doublon) ;
--   - la cible est complétée par les informations que la source avait et qu'elle n'avait pas
--     (rien n'est écrasé ; licences différentes : celle de la source rejoint les anciennes licences ;
--     notes : mises bout à bout) ;
--   - la cible garde la trace de la fusion (mergedFrom) : qui avait proposé la fiche source, si elle
--     avait été mise hors cadre, par qui, quand… (pour la vue « Ratés ») ;
--   - la source est supprimée (mergedInto = cible : un lien vers elle mène à la cible).
-- Tout est fait d'un bloc : si une étape échoue, rien n'est modifié.
-- Réservé aux encadrants et administrateurs. Chaque ligne modifiée est tracée dans le journal.

create or replace function public.hb_merge_players(p_source text, p_target text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  s jsonb;
  t jsonb;
  m jsonb;
  k text;
  v jsonb;
  -- Horodatage « appareil » plus récent que toute version existante : la fusion l'emporte partout.
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_keep text[] := array['id', 'updatedAt', 'deleted', 'createdBy', 'createdByName', 'createdAtServer', 'updatedBy',
                         'updatedByName', 'updatedAtServer', 'review', 'reviewNote', 'reviewedBy', 'reviewedByName',
                         'reviewedAt', 'mergedFrom', 'mergedInto', 'notes', 'previousLicenses'];
begin
  select role, coalesce(full_name, email) into v_role, v_name from public.hb_profiles where user_id = v_uid;
  if coalesce(v_role, '') not in ('admin', 'preparateur') then
    raise exception 'Réservé aux encadrants et administrateurs';
  end if;
  if p_source = p_target then raise exception 'Choisir deux fiches différentes'; end if;
  select data into s from public.hb_players where id = p_source and not deleted for update;
  select data into t from public.hb_players where id = p_target and not deleted for update;
  if s is null or t is null then raise exception 'Fiche introuvable (déjà supprimée ou fusionnée ?)'; end if;

  -- Avis, mesures et référents : rattachés à la cible.
  update public.hb_evaluations set data = data || jsonb_build_object('playerId', p_target, 'updatedAt', v_now), updated_at_client = v_now
   where data ->> 'playerId' = p_source;
  update public.hb_measurements set data = data || jsonb_build_object('playerId', p_target, 'updatedAt', v_now), updated_at_client = v_now
   where data ->> 'playerId' = p_source;
  update public.hb_referents set data = data || jsonb_build_object('playerId', p_target, 'updatedAt', v_now), updated_at_client = v_now
   where data ->> 'playerId' = p_source;

  -- Listes de joueurs des événements : la source remplacée par la cible, à sa place, sans doublon.
  update public.hb_events e
     set data = e.data || jsonb_build_object('updatedAt', v_now, 'playerIds', (
           select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
             from (select distinct on (x) x, o
                     from (select case when a.v = p_source then p_target else a.v end as x, a.o
                             from jsonb_array_elements_text(e.data -> 'playerIds') with ordinality a(v, o)) z
                    order by x, o) y)),
         updated_at_client = v_now
   where e.data -> 'playerIds' ? p_source;

  -- Cible complétée par ce que la source savait de plus.
  m := t;
  for k, v in select key, value from jsonb_each(s) loop
    continue when k = any (v_keep) or v = 'null'::jsonb or v = '""'::jsonb;
    if not (m ? k) or m -> k = 'null'::jsonb or m -> k = '""'::jsonb then
      m := m || jsonb_build_object(k, v);
    end if;
  end loop;
  -- Deux licences différentes : celle de la source rejoint les anciennes licences de la cible.
  if coalesce(s ->> 'license', '') <> '' and coalesce(t ->> 'license', '') <> '' and s ->> 'license' <> t ->> 'license'
     or jsonb_array_length(coalesce(s -> 'previousLicenses', '[]'::jsonb)) > 0 then
    m := m || jsonb_build_object('previousLicenses', (
      select coalesce(jsonb_agg(distinct l), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(t -> 'previousLicenses', '[]'::jsonb) || coalesce(s -> 'previousLicenses', '[]'::jsonb)
             || case when coalesce(s ->> 'license', '') not in ('', coalesce(t ->> 'license', '')) then jsonb_build_array(s ->> 'license') else '[]'::jsonb end) l
       where l <> coalesce(m ->> 'license', '')));
  end if;
  -- Notes : mises bout à bout.
  if coalesce(s ->> 'notes', '') <> '' and coalesce(s ->> 'notes', '') <> coalesce(t ->> 'notes', '') then
    m := m || jsonb_build_object('notes', concat_ws(E'\n', nullif(t ->> 'notes', ''), s ->> 'notes'));
  end if;
  -- Trace de la fusion (et de l'histoire de la fiche source).
  m := m || jsonb_build_object('updatedAt', v_now, 'mergedFrom', coalesce(t -> 'mergedFrom', '[]'::jsonb)
         || coalesce(s -> 'mergedFrom', '[]'::jsonb)
         || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
              'id', p_source,
              'name', trim(coalesce(s ->> 'firstName', '') || ' ' || coalesce(s ->> 'lastName', '')),
              'license', s -> 'license', 'club', s -> 'club',
              'review', s -> 'review', 'reviewNote', s -> 'reviewNote',
              'reviewedByName', s -> 'reviewedByName', 'reviewedAt', s -> 'reviewedAt',
              'createdByName', s -> 'createdByName', 'createdAtServer', s -> 'createdAtServer',
              'mergedAt', now(), 'mergedByName', v_name))));
  update public.hb_players set data = m, updated_at_client = v_now where id = p_target;

  -- La source disparaît, en gardant l'adresse de la cible.
  update public.hb_players set data = s || jsonb_build_object('mergedInto', p_target, 'updatedAt', v_now, 'deleted', true),
                               deleted = true, updated_at_client = v_now
   where id = p_source;
end $$;

revoke all on function public.hb_merge_players(text, text) from public, anon;
grant execute on function public.hb_merge_players(text, text) to authenticated;

-- Vérification : la fonction existe.
select proname as fonction from pg_proc where proname = 'hb_merge_players';
