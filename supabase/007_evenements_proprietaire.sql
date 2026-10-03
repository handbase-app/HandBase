-- HandBase : un encadrant ne peut modifier ou supprimer que les événements qu'il a créés.
-- L'administrateur peut tout faire. Les événements sans créateur connu (créés avant
-- 004_audit.sql) restent modifiables par tous les encadrants.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 006_realtime.sql.

-- Écrit les lignes autorisées (la plus récente gagne) et renvoie les identifiants refusés.
drop function if exists public.hb_upsert(text, jsonb);
create function public.hb_upsert(p_table text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_rejected jsonb := '[]'::jsonb;
  r jsonb;
  v_data jsonb;
  v_existing jsonb;
  v_deleting boolean;
  v_ok boolean;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if p_table not in ('players','criteria','measurements','events','evaluations') then
    raise exception 'Table inconnue : %', p_table;
  end if;
  select role, full_name into v_role, v_name from public.hb_profiles where user_id = v_uid;
  v_role := coalesce(v_role, 'observateur');

  for r in select * from jsonb_array_elements(p_rows) loop
    v_data := r -> 'data';
    v_deleting := coalesce((r ->> 'deleted')::boolean, false);
    execute format('select data from public.hb_%1$s where id = $1', p_table) into v_existing using r ->> 'id';

    v_ok := case
      -- Tout avis doit être rattaché à un événement (sauf pour le supprimer).
      when p_table = 'evaluations' and not v_deleting and coalesce(v_data ->> 'eventId', '') = '' then false
      when v_role = 'admin' then true
      when p_table = 'players' then v_role = 'preparateur' and not v_deleting
      when p_table = 'measurements' then v_role = 'preparateur'
      -- Un encadrant ne modifie / supprime que ses propres événements
      -- (ou ceux sans créateur connu, créés avant le journal d'activité).
      when p_table = 'events' then v_role = 'preparateur'
        and (v_existing is null or coalesce(v_existing ->> 'createdBy', '') in ('', v_uid::text))
      when p_table = 'evaluations' then
        v_data ->> 'observerId' = v_uid::text
        and (v_existing is null or v_existing ->> 'observerId' = v_uid::text)
      else false -- critères : administrateurs uniquement
    end;

    if not v_ok then
      v_rejected := v_rejected || to_jsonb(r ->> 'id');
      continue;
    end if;

    -- Un avis est toujours signé du nom du compte qui l'écrit.
    if p_table = 'evaluations' and v_role <> 'admin' and v_name is not null then
      v_data := jsonb_set(v_data, '{observer}', to_jsonb(v_name));
    end if;

    execute format($f$
      insert into public.hb_%1$s (id, data, updated_at_client, deleted)
      values ($1, $2, $3, $4)
      on conflict (id) do update
        set data = excluded.data,
            updated_at_client = excluded.updated_at_client,
            deleted = excluded.deleted
        where public.hb_%1$s.updated_at_client <= excluded.updated_at_client
    $f$, p_table)
    using r ->> 'id', v_data, (r ->> 'updated_at_client')::bigint, v_deleting;
  end loop;

  return v_rejected;
end $$;

revoke all on function public.hb_upsert(text, jsonb) from public, anon;
grant execute on function public.hb_upsert(text, jsonb) to authenticated;

-- Vérification : événements par créateur.
select coalesce(data ->> 'createdByName', '(inconnu)') as createur, count(*) as evenements
  from public.hb_events where not deleted group by 1 order by 2 desc;
