-- HandBase : notifications « Joueurs suivis » (nouvelles mesures et nouveaux avis).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 032_suivis.sql,
-- puis redéployer la fonction d'envoi (supabase/functions/notify/index.ts, nouvelle version : résumé des suivis).
-- Peut être relancé sans risque.
--
-- Quand une mesure ou un avis arrive sur un joueur, chaque compte qui le suit est prévenu (préférence « suivi »,
-- Réglages → Notifications) :
--   - suivi direct          : ligne hb_follows « player » non supprimée ;
--   - groupe suivi          : ligne hb_follows « group » non supprimée, groupe non supprimé, que ce compte voit
--                             encore (le sien, un groupe du staff, ou un groupe d'équipe dont il est participant) ;
--   - groupe suivi par l'équipe (teamFollow) : son créateur et ses participants du moment.
-- Une seule notification par compte et par mesure / avis, quel que soit le nombre de chemins. Jamais pour l'auteur
-- (ni pour le compte qui agit), ni pour un compte sans rôle ; joueur supprimé ou fondu : rien.
-- Seulement à la création (pas aux modifications, ni aux restaurations) :
--   - mesure : à son arrivée ;
--   - avis   : à son arrivée, sauf hors cadre. Un avis en attente de validation n'est annoncé qu'aux encadrants et
--              administrateurs ; les observateurs qui suivent le joueur sont prévenus quand il est validé
--              (un avis modifié par son auteur puis validé de nouveau les prévient de nouveau).
-- Envoi : tout est rangé sous le même sujet (group_key « suivi ») ; la fonction « notify » attend que la saisie
-- se calme (10 minutes sans nouveauté, 1 heure au plus) puis envoie un seul résumé par compte :
-- « 5 nouvelles mesures » (un seul joueur, lien vers sa fiche) ou « 24 nouveautés sur 8 joueurs suivis » (lien
-- vers « Mes suivis »). Chaque ligne pointe vers /joueurs/<id> (effacée avec la fiche, comme les autres).
-- Performance : déclencheurs par instruction (tables de transition) ; personne ne suit rien = sortie immédiate ;
-- recherche des suiveurs par index sur la cible du suivi.

-- ---------- Préférence « suivi » (reprise de 027) ----------

create or replace function public.hb_set_notif_prefs(p_prefs jsonb) returns void
language sql security definer set search_path = public as $$
  update public.hb_profiles
     set notif = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(p_prefs, '{}'::jsonb))
                   where (key in ('avis', 'fiche', 'participant', 'rappel', 'alerte', 'quiet', 'suivi') and jsonb_typeof(value) = 'boolean')
                      or (key in ('quietFrom', 'quietTo') and jsonb_typeof(value) = 'number'
                          and (value #>> '{}')::numeric between 0 and 23 and (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)))
   where user_id = auth.uid()
$$;

-- ---------- Index ----------

-- Suiveurs d'un joueur (ou d'un groupe) : par la cible, suivis actifs seulement.
create index if not exists hb_follows_target on public.hb_follows ((data ->> 'targetId')) where not deleted;
-- Notifications « suivi » en attente, par compte (résumé de la fonction d'envoi).
create index if not exists hb_notifications_suivi on public.hb_notifications (user_id, id) where sent_at is null and kind = 'suivi';

-- ---------- Déclencheur ----------

create or replace function public.hb_notify_suivi() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rows jsonb;
  r record;
  v_name text;
  v_body text;
begin
  -- Cas le plus courant : personne ne suit rien.
  if not exists (select 1 from public.hb_follows where not deleted)
     and not exists (select 1 from public.hb_groups where not deleted and data -> 'teamFollow' = 'true'::jsonb) then
    return null;
  end if;

  -- Lignes à annoncer, et à qui : all (tout rôle), staff (encadrants et administrateurs), obs (observateurs).
  if tg_table_name = 'hb_measurements' and tg_op = 'INSERT' then
    select jsonb_agg(jsonb_build_object('id', n.id, 'pid', n.data ->> 'playerId', 'author', n.data ->> 'createdBy',
             'audience', 'all', 'data', n.data))
      into v_rows from new_rows n
     where not n.deleted and coalesce(n.data ->> 'playerId', '') <> '';
  elsif tg_table_name = 'hb_evaluations' and tg_op = 'INSERT' then
    select jsonb_agg(jsonb_build_object('id', n.id, 'pid', n.data ->> 'playerId', 'author', n.data ->> 'createdBy',
             'observer', n.data ->> 'observerId',
             'audience', case when n.data ->> 'review' = 'pending' then 'staff' else 'all' end, 'data', n.data))
      into v_rows from new_rows n
     where not n.deleted and coalesce(n.data ->> 'playerId', '') <> ''
       and n.data ->> 'review' is distinct from 'refused';
  elsif tg_table_name = 'hb_evaluations' and tg_op = 'UPDATE' then
    -- Avis en attente qui vient d'être validé : les observateurs le voient compter maintenant.
    select jsonb_agg(jsonb_build_object('id', n.id, 'pid', n.data ->> 'playerId', 'author', n.data ->> 'createdBy',
             'observer', n.data ->> 'observerId', 'audience', 'obs', 'data', n.data))
      into v_rows
      from new_rows n join old_rows o on o.id = n.id
     where not n.deleted and not o.deleted and o.data ->> 'review' = 'pending'
       and n.data ->> 'review' is distinct from 'pending' and n.data ->> 'review' is distinct from 'refused'
       and coalesce(n.data ->> 'playerId', '') <> '';
  end if;
  if v_rows is null then return null; end if;

  for r in
    with c as (
      select x.id, x.pid, x.author, x.observer, x.audience, x.data
        from jsonb_to_recordset(v_rows) as x(id text, pid text, author text, observer text, audience text, data jsonb)
    ),
    p as (select distinct c.pid from c),
    fol as (
      -- Suivi direct.
      select p.pid, f.data ->> 'createdBy' as uid
        from p join public.hb_follows f on f.data ->> 'targetId' = p.pid and not f.deleted
       where f.data ->> 'kind' = 'player'
      union
      -- Groupe suivi personnellement, encore visible par ce compte.
      select p.pid, f.data ->> 'createdBy'
        from public.hb_follows f
        join public.hb_groups g on g.id = f.data ->> 'targetId' and not g.deleted
        join p on g.data -> 'playerIds' ? p.pid
       where not f.deleted and f.data ->> 'kind' = 'group'
         and (g.data ->> 'createdBy' = f.data ->> 'createdBy'
              or (not coalesce((g.data ->> 'private')::boolean, false)
                  and (not coalesce((g.data ->> 'team')::boolean, false)
                       or coalesce(g.data -> 'editors', '[]'::jsonb) ? (f.data ->> 'createdBy'))))
      union
      -- Groupe suivi par l'équipe : son créateur et ses participants du moment.
      select p.pid, u.uid
        from public.hb_groups g
        cross join lateral (select g.data ->> 'createdBy'
                            union select jsonb_array_elements_text(coalesce(g.data -> 'editors', '[]'::jsonb))) u(uid)
        join p on g.data -> 'playerIds' ? p.pid
       where not g.deleted and g.data -> 'teamFollow' = 'true'::jsonb
         and not coalesce((g.data ->> 'private')::boolean, false)
    )
    -- Un seul envoi par compte et par ligne.
    select distinct c.id, c.pid, c.data, pr.user_id
      from c
      join fol on fol.pid = c.pid
      join public.hb_profiles pr on pr.user_id::text = fol.uid and pr.role in ('admin', 'preparateur', 'observateur')
      join public.hb_players pl on pl.id = c.pid and not pl.deleted and coalesce(pl.data ->> 'mergedInto', '') = ''
     where fol.uid is distinct from c.author and fol.uid is distinct from c.observer
       and (c.audience = 'all'
            or (c.audience = 'staff' and pr.role in ('admin', 'preparateur'))
            or (c.audience = 'obs' and pr.role = 'observateur'))
     order by c.id, pr.user_id
  loop
    v_name := coalesce(nullif(public.hb_player_name(r.pid), ''), 'Joueur suivi');
    if tg_table_name = 'hb_measurements' then
      -- « Nouvelle mesure » : début du texte lu par la fonction d'envoi (résumé « n nouvelles mesures »).
      select 'Nouvelle mesure : ' || coalesce(c.data ->> 'label', r.data ->> 'criterionId', 'test')
             || coalesce(' ' || (r.data ->> 'value') || coalesce(' ' || nullif(c.data ->> 'unit', ''), ''), '')
        into v_body
        from (select 1) one left join public.hb_criteria c on c.id = r.data ->> 'criterionId';
      v_body := v_body || coalesce(' (par ' || coalesce(r.data ->> 'createdByName', r.data ->> 'author') || ')', '');
    else
      -- « Nouvel avis » : idem.
      v_body := 'Nouvel avis' || coalesce(' de ' || coalesce(r.data ->> 'observer', r.data ->> 'createdByName'), '') || ' : '
        || coalesce((select e.data ->> 'name' from public.hb_events e
                      where e.id = r.data ->> 'eventId' and not e.deleted), 'avis spontané');
    end if;
    perform public.hb_notify(r.user_id, 'suivi', 'suivi', v_name, v_body,
      'nouveautés sur tes joueurs suivis', '/joueurs/' || r.pid);
  end loop;
  return null;
end $$;

-- Par instruction, avec tables de transition (une importation de masse = un seul passage).
drop trigger if exists hb_notify_suivi on public.hb_measurements;
create trigger hb_notify_suivi after insert on public.hb_measurements
  referencing new table as new_rows
  for each statement execute function public.hb_notify_suivi();
drop trigger if exists hb_notify_suivi on public.hb_evaluations;
create trigger hb_notify_suivi after insert on public.hb_evaluations
  referencing new table as new_rows
  for each statement execute function public.hb_notify_suivi();
drop trigger if exists hb_notify_suivi_valide on public.hb_evaluations;
create trigger hb_notify_suivi_valide after update on public.hb_evaluations
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.hb_notify_suivi();

-- ---------- Droits des fonctions (comme 029, 032) ----------
-- Appelées par l'appli (supabase.rpc) ou par les règles de lecture : comptes connectés seulement.
-- Toutes les autres fonctions hb_* (déclencheurs, outils internes) : personne, sauf le serveur.
do $$
declare
  f record;
  v_app text[] := array['hb_upsert', 'hb_merge_players', 'hb_create_member', 'hb_update_member', 'hb_delete_member',
                        'hb_members', 'hb_set_role', 'hb_set_departments', 'hb_purge_expired', 'hb_purge_deleted',
                        'hb_push_subscribe', 'hb_push_unsubscribe', 'hb_set_notif_prefs', 'hb_notif_test', 'hb_has_role',
                        'hb_ping', 'hb_last_seen'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'hb\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname = any (v_app) then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

-- Vérification : déclencheurs en place (3 attendus) et droit de l'appli sur le déclencheur (non attendu).
select tgrelid::regclass as table_, tgname as declencheur from pg_trigger where tgname like 'hb\_notify\_suivi%' order by 1, 2;
select has_function_privilege('authenticated', 'public.hb_notify_suivi()', 'execute') as appli_peut_appeler;
