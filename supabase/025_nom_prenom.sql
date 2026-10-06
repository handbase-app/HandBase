-- HandBase : noms des joueurs affichés « NOM Prénom » dans le journal d'activité (comme dans l'appli).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 024_participants_evenements.sql.
-- Les nouvelles lignes du journal sont écrites « NOM Prénom » ; les lignes déjà écrites sur les fiches
-- joueur sont remises au même format. (Les autres lignes déjà écrites gardent leur texte d'origine.)

-- Nom lisible d'un joueur : « DUPONT Jean ».
create or replace function public.hb_player_name(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select nullif(trim(upper(coalesce(data ->> 'lastName', '')) || ' ' || coalesce(data ->> 'firstName', '')), '')
    from public.hb_players where id = p_id
$$;

-- De quoi parle une ligne, en clair (reprise de 022_alertes.sql, avec le nom du joueur d'abord).
create or replace function public.hb_summary(p_table text, p_data jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return case p_table
    when 'players' then trim(upper(coalesce(p_data ->> 'lastName', '')) || ' ' || coalesce(p_data ->> 'firstName', ''))
    when 'events' then p_data ->> 'name'
    when 'criteria' then p_data ->> 'label'
    when 'measurements' then coalesce(public.hb_player_name(p_data ->> 'playerId'), '?') || ' — '
      || coalesce(p_data ->> 'criterionId', '?') || ' = ' || coalesce(p_data ->> 'value', '?') || ' (' || coalesce(p_data ->> 'date', '') || ')'
    when 'evaluations' then coalesce(p_data ->> 'observer', '?') || ' → '
      || coalesce(public.hb_player_name(p_data ->> 'playerId'), '?')
    when 'groups' then p_data ->> 'name'
    when 'lists' then p_data ->> 'name'
    when 'alerts' then p_data ->> 'name'
    when 'referents' then trim(coalesce(p_data ->> 'firstName', '') || ' ' || coalesce(p_data ->> 'lastName', '')) || ' → '
      || coalesce(public.hb_player_name(p_data ->> 'playerId'), '?')
    else null
  end;
end $$;
revoke all on function public.hb_player_name(text) from public, anon;
revoke all on function public.hb_summary(text, jsonb) from public, anon;

-- Lignes déjà écrites sur les fiches joueur : même format (fiches encore présentes, données non expirées).
update public.hb_audit a
   set summary = public.hb_player_name(a.row_id)
  from public.hb_players p
 where a.table_name = 'players' and p.id = a.row_id and not p.deleted
   and a.summary is distinct from '(données expirées)'
   and public.hb_player_name(a.row_id) is not null;

-- Vérification : quelques noms du journal.
select summary from public.hb_audit where table_name = 'players' order by id desc limit 5;
