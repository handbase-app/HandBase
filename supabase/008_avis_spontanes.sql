-- HandBase : avis spontanés et validation des avis.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 007_evenements_proprietaire.sql.
--
-- Un avis est rattaché soit à un événement, soit à un contexte libre (« avis spontané » :
-- UNSS, entraînement de club…, champ contextType). Les avis spontanés passent par une validation :
--
--   review = 'pending'    en attente : visible, mais ne compte pas dans les moyennes ;
--   review = 'validated'  validé : compte comme un avis normal ;
--   review = 'refused'    hors cadre : gardé et visible sur la fiche, ne compte jamais.
--
-- Les avis sur un événement n'ont pas de champ review : ils sont validés d'office, comme avant.
-- Règles tenues ici, quoi qu'envoie l'appareil :
--   - l'avis spontané d'un observateur arrive « en attente » ; s'il le modifie, il y repasse ;
--   - celui d'un encadrant ou d'un administrateur est validé d'office ;
--   - seuls les encadrants et administrateurs valident ou refusent l'avis d'un autre : ils ne
--     peuvent alors changer que la décision et son commentaire, pas l'avis lui-même ;
--   - le nom de celui qui décide et la date sont posés par le serveur.

-- Contenu d'un avis, sans les champs de suivi : sert à savoir si l'auteur l'a vraiment modifié.
create or replace function public.hb_eval_content(p jsonb) returns jsonb
language sql immutable as $$
  select p - array['updatedAt', 'updatedBy', 'updatedByName', 'updatedAtServer', 'createdBy', 'createdByName',
                   'createdAtServer', 'observer', 'review', 'reviewNote', 'reviewedBy', 'reviewedByName', 'reviewedAt']
$$;

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
  v_existing_deleted boolean;
  v_deleting boolean;
  v_ok boolean;
  v_author boolean;
  v_reviewing boolean;
  v_review_keys text[] := array['review', 'reviewNote', 'reviewedBy', 'reviewedByName', 'reviewedAt'];
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if p_table not in ('players','criteria','measurements','events','evaluations') then
    raise exception 'Table inconnue : %', p_table;
  end if;
  select role, coalesce(full_name, email) into v_role, v_name from public.hb_profiles where user_id = v_uid;
  v_role := coalesce(v_role, 'observateur');

  for r in select * from jsonb_array_elements(p_rows) loop
    v_data := r -> 'data';
    v_deleting := coalesce((r ->> 'deleted')::boolean, false);
    execute format('select data, deleted from public.hb_%1$s where id = $1', p_table)
      into v_existing, v_existing_deleted using r ->> 'id';
    -- L'auteur d'un avis : celui qui l'a écrit (ou qui l'écrit, pour un nouvel avis).
    v_author := coalesce(p_table = 'evaluations'
      and v_data ->> 'observerId' = v_uid::text
      and (v_existing is null or v_existing ->> 'observerId' = v_uid::text), false);
    -- Décision sur l'avis spontané d'un autre : l'avis enregistré fait foi, seule la décision change.
    v_reviewing := p_table = 'evaluations' and not v_author and not v_deleting and coalesce(v_existing ? 'review', false);

    v_ok := case
      -- Tout avis est rattaché à un événement ou à un contexte libre (sauf pour le supprimer).
      when p_table = 'evaluations' and not v_deleting and not v_reviewing
        and coalesce(v_data ->> 'eventId', '') = '' and coalesce(v_data ->> 'contextType', '') = '' then false
      when v_role = 'admin' then true
      when p_table = 'players' then v_role = 'preparateur' and not v_deleting
      when p_table = 'measurements' then v_role = 'preparateur'
      -- Un encadrant ne modifie / supprime que ses propres événements
      -- (ou ceux sans créateur connu, créés avant le journal d'activité).
      when p_table = 'events' then v_role = 'preparateur'
        and (v_existing is null or coalesce(v_existing ->> 'createdBy', '') in ('', v_uid::text))
      when p_table = 'evaluations' then v_author
        -- Un encadrant peut valider ou refuser l'avis spontané d'un autre.
        or (v_role = 'preparateur' and v_reviewing)
      else false -- critères : administrateurs uniquement
    end;

    -- Pas de décision sur un avis supprimé entre-temps (on le ferait réapparaître).
    if v_reviewing and v_existing_deleted then
      v_ok := false;
    end if;

    if not coalesce(v_ok, false) then
      v_rejected := v_rejected || to_jsonb(r ->> 'id');
      continue;
    end if;

    if p_table = 'evaluations' and not v_deleting then
      if v_reviewing then
        -- Décision d'un validateur : seuls la décision et son commentaire changent.
        v_data := (v_existing - v_review_keys - 'updatedAt') || jsonb_strip_nulls(jsonb_build_object(
          'updatedAt', v_data -> 'updatedAt',
          'review', case when v_data ->> 'review' in ('pending', 'validated', 'refused') then v_data ->> 'review' else v_existing ->> 'review' end,
          'reviewNote', nullif(trim(v_data ->> 'reviewNote'), ''),
          'reviewedBy', v_uid, 'reviewedByName', v_name, 'reviewedAt', now()));
      else
        -- Un avis est toujours signé du nom du compte qui l'écrit.
        if v_role <> 'admin' and v_name is not null then
          v_data := jsonb_set(v_data, '{observer}', to_jsonb(v_name));
        end if;
        if coalesce(v_data ->> 'eventId', '') <> '' then
          -- Avis sur un événement : pas de validation.
          v_data := v_data - v_review_keys;
        elsif v_existing is not null and v_existing ? 'review'
          and public.hb_eval_content(v_existing) = public.hb_eval_content(v_data)
          and (v_role = 'observateur' or v_existing ->> 'review' = 'validated') then
          -- Avis inchangé (simple renvoi) : la décision reste.
          v_data := (v_data - v_review_keys)
            || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(v_existing) where key = any (v_review_keys));
        elsif v_role in ('admin', 'preparateur') then
          -- Avis spontané d'un encadrant ou d'un administrateur : validé d'office.
          v_data := (v_data - v_review_keys) || jsonb_build_object(
            'review', 'validated', 'reviewedBy', v_uid, 'reviewedByName', v_name, 'reviewedAt', now());
        else
          -- Avis spontané d'un observateur, nouveau ou modifié : en attente de validation.
          v_data := (v_data - v_review_keys) || jsonb_build_object('review', 'pending');
        end if;
      end if;
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

-- Vérification : avis par état (« sur événement » = validés d'office).
select coalesce(data ->> 'review', 'sur événement') as etat, count(*) as avis
  from public.hb_evaluations where not deleted group by 1 order by 1;
