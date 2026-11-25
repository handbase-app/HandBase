-- HandBase : ESPACE JOUEUR (socle) : un compte « joueur », relié à SA fiche, qui ne voit que sa page et y écrit lui-même
-- « Ma lettre » et « Mon parcours » (clé `self` de la fiche). Le staff lit ce qu'il a écrit sur la fiche, dans une section à part.
-- À exécuter dans Supabase > SQL Editor, APRÈS 050_avis_vocal.sql : base de TEST d'abord (vérifier avec la requête de contrôle
-- en fin de fichier), puis la réelle. Peut être relancé sans risque (add column if not exists, create or replace, drop … if exists).
-- L'appli qui connaît le rôle « joueur » (src/roles.ts, src/pages/Me.tsx) doit être publiée APRÈS ce script : avant, un compte
-- joueur n'existe pas (la contrainte de rôle le refuse) et rien ne change pour le staff.
--
-- PRINCIPE (décidé) : un jeune (ou sa famille) a un compte « joueur » qui ne voit QUE sa propre page : son identité (lecture
-- seule), ses passages en pôle (lecture seule), et ce qu'il écrit lui-même. Il ne voit JAMAIS les avis, les notes, les mesures,
-- ni aucun autre joueur, ni les événements, ni les groupes, ni le staff. Le staff voit ce qu'il a écrit, sur sa fiche.
--
-- 1) PROFILS (hb_profiles) : rôle « joueur » accepté par la contrainte ; colonne player_id (fiche reliée, null = compte joueur
--    SANS fiche : il ne voit rien d'autre que l'écran « Entre ton code ») et player_linked_at (depuis quand). hb_has_role() (029)
--    ne compte que admin / preparateur / observateur : un joueur n'a PAS de rôle du staff, toutes les règles de lecture et
--    fonctions qui s'appuient dessus (joueurs, mesures, avis, événements, groupes, critères, listes, staffs, suivis, vidéos,
--    « vu », « à revoir », périmètre, notifications, présence) le laissent dehors sans rien changer. Nouvelles fonctions :
--    hb_is_player() (le compte connecté est un joueur) et hb_my_player_id() (sa fiche).
-- 2) LECTURE d'un compte joueur, table par table :
--    - hb_players : SA ligne seulement (règle player_self_read, en plus de staff_read qui ne le concerne pas) ;
--    - hb_config (sport, postes, apparence) et hb_lists (noms des régions, pour ses passages en pôle) : lisibles (aucune donnée
--      personnelle dedans ; hb_lists demandait un rôle du staff : règle player_lists_read ajoutée) ;
--    - hb_profiles : son propre profil seulement ; et le STAFF ne lit plus les profils des joueurs (règle staff_read restreinte :
--      « role is distinct from 'joueur' ») : le nom d'un jeune ne circule pas par la liste des comptes. hb_members() (029) reste
--      complète pour les administrateurs (ils gèrent ces comptes) ;
--    - hb_levels, hb_units, hb_assignments (structure, affectations du staff) : lisibles par tout compte connecté avant ce
--      script → fermées au joueur (règle « not hb_is_player() ») ;
--    - tout le reste (mesures, avis, événements, groupes, critères, alertes, staffs, suivis, vidéos, vu, à revoir, journal des
--      questions, historique, connexions) : déjà conditionné à hb_has_role() ou au rôle admin : rien ne passe.
-- 3) ÉCRITURE : un joueur n'écrit JAMAIS directement, ni par hb_upsert : déclencheur hb_player_guard (avant toute insertion,
--    modification, suppression) sur chaque table hb_* de données, qui refuse tout compte joueur, sauf pendant
--    hb_player_self_update (réglage local hb.player_self, posé par la fonction pour sa seule transaction). Ceinture et
--    bretelles : hb_upsert (050) accepte des lignes de certaines tables sans regarder le rôle (suivis, « vu »…) ; le déclencheur
--    tranche quoi qu'il arrive, et survivra aux prochaines réécritures de hb_upsert.
--    hb_player_self_update(p_self jsonb) : la seule écriture du joueur ; ne touche que la clé `self` de SA fiche (lettre : why,
--    proud, work, free, 2 000 caractères chacun ; parcours : clubs (20, nom 60 caractères, années AAAA), postes (12 codes),
--    sélections et palmarès (20 lignes de 120 caractères)) ; 20000 caractères au plus en entrée ; tout autre champ ignoré ;
--    `self.updatedAt` posé par le serveur ; updatedAt / updated_at_client de la fiche avancés pour que la synchronisation du
--    staff la reprenne (hb_touch, hb_stamp : « modifié par » = le jeune ; hb_log : journal d'activité). p_self null ou vide :
--    la clé `self` est retirée. hb_scope_row (046) est repris À L'IDENTIQUE avec une ligne de plus : pendant hb_player_self_update,
--    pas de contrôle de périmètre (le jeune n'en a pas) ; les colonnes scope_dept / scope_club sont recalculées comme avant.
-- 4) INVITATIONS (hb_player_invites) : code de 8 caractères (alphabet sans O / 0 / I / 1, lu à voix haute sans ambiguïté),
--    valable 30 jours, créé par un administrateur, ou un encadrant qui a le droit de modifier la fiche (même règle que
--    l'écriture sur hb_players : fiche de son périmètre ou créée par lui : hb_can_invite). Table sans règle de lecture : seules
--    les fonctions y touchent.
--    - hb_invite_player(p_player_id) → { code, expires_at, reused } : le code encore valide s'il y en a un, sinon un nouveau ;
--    - hb_player_access(p_player_id) → { linked, since, code, expires_at } : pour la fiche côté staff ;
--    - hb_revoke_player_access(p_player_id) : le profil du jeune redevient « compte joueur sans fiche » (role joueur, player_id
--      null : il ne voit plus rien), ses codes non utilisés sont effacés ;
--    - hb_claim_invite(p_code) → { player_id, first_name } : appelée par le compte du jeune (rôle joueur, sans fiche) : vérifie
--      le code (refus en clair : code_inconnu, code_utilise, code_expire, fiche_introuvable, fiche_deja_reliee), la date de
--      naissance de la fiche (naissance_manquante) et l'ÂGE MINIMUM (trop_jeune), lu dans la configuration de l'installation
--      (hb_config, clé « espace_joueur », { playerMinAge }, défaut 10 ans, entre 6 et 18 ; Réglages → Espace joueur), relie le
--      profil (player_id, player_linked_at) et marque le code utilisé. Un compte joueur ne peut devenir rien d'autre par
--      lui-même ; seul un administrateur change un rôle (hb_set_role).
--    Chaque action est notée dans le journal d'activité (hb_audit : « accès joueur »).
-- 5) COMPTES : hb_set_role (014) et hb_create_member (015) acceptent « joueur » : un administrateur crée le compte du jeune
--    depuis Réglages → Utilisateurs (rôle Joueur, mot de passe provisoire, lien d'accès comme pour le staff), puis l'encadrant
--    lui donne son code depuis la fiche. Passer un compte à « joueur » ou l'en sortir efface player_id (plus de fiche reliée).
--    Un joueur n'a ni secteur ni affectation.
-- 6) CE QUI NE CHANGE PAS : hb_upsert (050), les règles de lecture du staff (046, 048), le périmètre, les notifications.
-- Retour arrière : les règles player_* et les déclencheurs hb_player_guard se retirent (drop policy / drop trigger), la table
-- hb_player_invites et les fonctions hb_invite_player / hb_claim_invite / hb_revoke_player_access / hb_player_access /
-- hb_player_self_update / hb_is_player / hb_my_player_id se suppriment ; hb_scope_row, hb_set_role et hb_create_member se
-- relancent depuis 046, 014 et 015 ; les comptes joueur se passent en role null (hb_set_role refusant ce rôle ensuite).
-- La clé `self` des fiches reste (lue par la fiche, jamais par les exports).

-- ---------- 1. Profils : rôle joueur, fiche reliée ----------

alter table public.hb_profiles drop constraint if exists hb_profiles_role_check;
alter table public.hb_profiles add constraint hb_profiles_role_check
  check (role in ('admin', 'preparateur', 'observateur', 'joueur'));
alter table public.hb_profiles add column if not exists player_id text;
alter table public.hb_profiles add column if not exists player_linked_at timestamptz;
create index if not exists hb_profiles_player on public.hb_profiles (player_id) where player_id is not null;
-- Colonnes lisibles (029 : liste explicite) : la fiche reliée s'y ajoute (l'appli la lit sur son propre profil).
grant select (player_id, player_linked_at) on public.hb_profiles to authenticated;

-- Le compte connecté est-il un joueur ?
create or replace function public.hb_is_player() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hb_profiles where user_id = auth.uid() and role = 'joueur')
$$;

-- Sa fiche (null : pas un joueur, ou joueur sans fiche reliée).
create or replace function public.hb_my_player_id() returns text
language sql stable security definer set search_path = public as $$
  select player_id from public.hb_profiles where user_id = auth.uid() and role = 'joueur'
$$;

-- ---------- 2. Lecture ----------

-- Sa ligne, et elle seule.
drop policy if exists "player_self_read" on public.hb_players;
create policy "player_self_read" on public.hb_players for select to authenticated
  using (id = (select public.hb_my_player_id()) and not deleted);

-- Listes (noms des régions pour ses passages en pôle) : rien de personnel.
drop policy if exists "player_lists_read" on public.hb_lists;
create policy "player_lists_read" on public.hb_lists for select to authenticated
  using ((select public.hb_is_player()));

-- Profils : le staff voit le staff (pas les joueurs) ; chacun voit le sien.
drop policy if exists "staff_read" on public.hb_profiles;
create policy "staff_read" on public.hb_profiles for select to authenticated
  using (user_id = auth.uid() or ((select public.hb_has_role()) and role is distinct from 'joueur'));

-- Structure et affectations du staff : pas pour un joueur (c'était « true » depuis 044).
do $$
declare t text;
begin
  foreach t in array array['levels', 'units', 'assignments'] loop
    execute format('drop policy if exists "staff_read" on public.hb_%1$s;
      create policy "staff_read" on public.hb_%1$s for select to authenticated using ((select not public.hb_is_player()));', t);
  end loop;
end $$;

-- ---------- 3. Écriture : jamais un joueur, sauf hb_player_self_update ----------

create or replace function public.hb_player_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('hb.player_self', true) is distinct from '1' and public.hb_is_player() then
    raise exception 'Compte joueur : lecture seule';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['players', 'criteria', 'measurements', 'events', 'evaluations', 'referents', 'groups', 'lists', 'alerts',
                           'follows', 'teams', 'videos', 'seen', 'rewatch', 'question_log', 'config', 'levels', 'units', 'assignments'] loop
    if to_regclass('public.hb_' || t) is null then continue; end if;
    -- « hb_a_player_guard » : passe avant les autres déclencheurs du même moment (ordre alphabétique).
    execute format('drop trigger if exists hb_a_player_guard on public.hb_%1$s;
      create trigger hb_a_player_guard before insert or update or delete on public.hb_%1$s
        for each row execute function public.hb_player_guard();', t);
  end loop;
end $$;

-- hb_scope_row : reprise EXACTE de 046, plus la ligne « hb.player_self » (b) : pendant hb_player_self_update, pas de contrôle de
-- périmètre (le jeune n'en a pas ; il ne change ni club ni licence : les colonnes de périmètre sont recalculées, inchangées).
create or replace function public.hb_scope_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_scope jsonb;
  v_depts text[];
  v_clubs text[];
  v_pid text;
  v_owner text;
  v_in_new boolean;
  v_in_old boolean;
  v_only text[];
  v_exists boolean;
begin
  -- a) Département et club de la ligne.
  if tg_table_name = 'hb_players' then
    if tg_op = 'UPDATE' and coalesce((new.data ->> 'purged')::boolean, false) then
      -- Fiche effacée (il ne reste que l'identifiant) : elle garde son périmètre, l'effacement arrive aux bons appareils.
      new.scope_dept := old.scope_dept;
      new.scope_club := old.scope_club;
    else
      new.scope_dept := public.hb_player_dept(new.data);
      new.scope_club := public.hb_player_club(new.data);
    end if;
  else
    v_pid := case tg_table_name
      when 'hb_videos' then case when new.data ->> 'targetKind' = 'player' then new.data ->> 'targetId' end
      when 'hb_follows' then case when new.data ->> 'kind' = 'player' then new.data ->> 'targetId' end
      else new.data ->> 'playerId' end;
    new.scope_dept := null;
    new.scope_club := null;
    if v_pid is not null then
      select p.scope_dept, p.scope_club, p.data ->> 'createdBy' into new.scope_dept, new.scope_club, v_owner
        from public.hb_players p where p.id = v_pid;
    end if;
  end if;

  -- b) Contrôle : seulement un compte connecté, et pas les cascades d'un autre déclencheur (fusion, suivi d'un joueur…).
  if v_uid is null or pg_trigger_depth() > 1 then return new; end if;
  -- Espace joueur (051) : le jeune écrit sa lettre sur sa fiche ; aucun périmètre à vérifier.
  if current_setting('hb.player_self', true) = '1' then return new; end if;
  v_scope := public.hb_my_scope();
  if coalesce((v_scope ->> 'all')::boolean, false) then return new; end if;
  v_depts := array(select jsonb_array_elements_text(v_scope -> 'depts'));
  v_clubs := array(select jsonb_array_elements_text(v_scope -> 'clubs'));
  v_in_new := coalesce(new.scope_dept = any (v_depts), false) or coalesce(new.scope_club = any (v_clubs), false);
  -- hb_upsert écrit par « insert … on conflict do update » : pour une ligne qui existe déjà, c'est le passage « update »
  -- (anciennes valeurs connues) qui décide ; ici, rien n'est changé ni refusé.
  if tg_op = 'INSERT' then
    execute format('select exists (select 1 from public.%I where id = $1)', tg_table_name) into v_exists using new.id;
    if v_exists then return new; end if;
  end if;

  if tg_table_name = 'hb_players' then
    if tg_op = 'INSERT' then
      if v_in_new then return new; end if;
      -- Fiche SANS club ni licence (joueur repéré en tournoi, fiche proposée) : acceptée si son département est couvert par
      -- le périmètre (départements de ses clubs compris : un compte de club propose dans son département). Département
      -- inconnu aussi : alors, s'il n'y a qu'un département couvert, il est posé sur la fiche.
      if new.scope_club is null and cardinality(v_depts) + cardinality(v_clubs) > 0 then
        select array_agg(distinct x) into v_only
          from (select unnest(v_depts) as x
                union select public.hb_player_dept(jsonb_build_object('clubCode', c)) from unnest(v_clubs) c) s
         where coalesce(x, '') <> '';
        if new.scope_dept is null then
          if cardinality(v_only) = 1 then
            new.data := new.data || jsonb_build_object('department', v_only[1]);
            new.scope_dept := v_only[1];
          end if;
          return new;
        end if;
        if new.scope_dept = any (v_only) then return new; end if;
      end if;
      return null;
    end if;
    -- Modification : fiche de son périmètre (ou créée par lui), qui y reste (ou dont le périmètre ne change pas).
    v_in_old := coalesce(old.scope_dept = any (v_depts), false) or coalesce(old.scope_club = any (v_clubs), false);
    if not (v_in_old or coalesce(old.data ->> 'createdBy' = v_uid::text, false)) then return null; end if;
    if v_in_new then return new; end if;
    if new.scope_dept is not distinct from old.scope_dept and new.scope_club is not distinct from old.scope_club then return new; end if;
    return null;
  end if;

  -- Ligne rattachée : sans joueur visé (vidéo d'un événement, suivi d'un groupe) : pas de contrôle de périmètre.
  if v_pid is null then return new; end if;
  -- Joueur visible (périmètre, ou fiche créée par lui).
  if v_in_new or v_owner = v_uid::text then return new; end if;
  -- Sa propre ligne, même si le joueur est sorti de son périmètre depuis.
  if tg_op = 'UPDATE' and old.data ->> 'createdBy' = v_uid::text then return new; end if;
  return null;
end $$;

-- Un texte de la lettre : bords coupés, vide → null, longueur limitée.
create or replace function public.hb_self_text(p jsonb, p_max int) returns text
language sql immutable as $$
  select case when jsonb_typeof(p) = 'string' and btrim(p #>> '{}') <> '' then left(btrim(p #>> '{}'), p_max) end
$$;

-- Lignes (sélections, palmarès) : chaînes non vides, bords coupés, 120 caractères, 20 au plus, sans doublon ; vide → null.
create or replace function public.hb_self_lines(p jsonb) returns jsonb
language sql immutable as $$
  select nullif((select jsonb_agg(l order by n)
                   from (select min(n) as n, l
                           from (select row_number() over () as n, left(btrim(x #>> '{}'), 120) as l
                                   from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
                                  where jsonb_typeof(x) = 'string' and btrim(x #>> '{}') <> '') s
                          group by l order by min(n) limit 20) u), '[]'::jsonb)
$$;

-- Ce que le joueur écrit sur SA fiche : la seule écriture d'un compte joueur. Renvoie ce qui a été gardé (null : rien).
create or replace function public.hb_player_self_update(p_self jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pid text;
  v_letter jsonb := '{}'::jsonb;
  v_path jsonb := '{}'::jsonb;
  v_clubs jsonb := '[]'::jsonb;
  v_positions jsonb := '[]'::jsonb;
  v_lines jsonb;
  v_self jsonb;
  k text;
  v text;
  c jsonb;
  v_name text;
  v_from text;
  v_to text;
  v_ts bigint;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  select player_id into v_pid from public.hb_profiles where user_id = v_uid and role = 'joueur';
  if not found then raise exception 'pas_joueur'; end if;
  if v_pid is null then raise exception 'sans_fiche'; end if;
  if p_self is not null and jsonb_typeof(p_self) <> 'object' then raise exception 'format'; end if;
  if length(coalesce(p_self::text, '')) > 20000 then raise exception 'trop_long'; end if;

  -- Lettre : quatre textes, 2 000 caractères chacun.
  foreach k in array array['why', 'proud', 'work', 'free'] loop
    v := public.hb_self_text(p_self -> 'letter' -> k, 2000);
    if v is not null then v_letter := v_letter || jsonb_build_object(k, v); end if;
  end loop;
  -- Parcours : clubs (nom obligatoire, années AAAA facultatives, 20 au plus).
  if jsonb_typeof(p_self -> 'path' -> 'clubs') = 'array' then
    for c in select x from jsonb_array_elements(p_self -> 'path' -> 'clubs') x loop
      exit when jsonb_array_length(v_clubs) >= 20;
      if jsonb_typeof(c) <> 'object' then continue; end if;
      v_name := public.hb_self_text(c -> 'name', 60);
      if v_name is null then continue; end if;
      v_from := case when coalesce(c ->> 'from', '') ~ '^\d{4}$' then c ->> 'from' end;
      v_to := case when coalesce(c ->> 'to', '') ~ '^\d{4}$' then c ->> 'to' end;
      if v_from is not null and v_to is not null and v_from > v_to then v := v_from; v_from := v_to; v_to := v; end if;
      v_clubs := v_clubs || jsonb_strip_nulls(jsonb_build_object('name', v_name, 'from', v_from, 'to', v_to));
    end loop;
  end if;
  if jsonb_array_length(v_clubs) > 0 then v_path := v_path || jsonb_build_object('clubs', v_clubs); end if;
  -- Postes joués : codes courts (ceux du sport, vérifiés par l'appli), sans doublon, 12 au plus.
  if jsonb_typeof(p_self -> 'path' -> 'positions') = 'array' then
    select coalesce(jsonb_agg(p order by n), '[]'::jsonb) into v_positions
      from (select min(n) as n, p
              from (select row_number() over () as n, x #>> '{}' as p from jsonb_array_elements(p_self -> 'path' -> 'positions') x
                     where jsonb_typeof(x) = 'string' and (x #>> '{}') ~ '^[A-Za-z0-9_-]{1,12}$') s
             group by p order by min(n) limit 12) u;
    if jsonb_array_length(v_positions) > 0 then v_path := v_path || jsonb_build_object('positions', v_positions); end if;
  end if;
  v_lines := public.hb_self_lines(p_self -> 'path' -> 'selections');
  if v_lines is not null then v_path := v_path || jsonb_build_object('selections', v_lines); end if;
  v_lines := public.hb_self_lines(p_self -> 'path' -> 'honours');
  if v_lines is not null then v_path := v_path || jsonb_build_object('honours', v_lines); end if;

  v_self := '{}'::jsonb;
  if v_letter <> '{}'::jsonb then v_self := v_self || jsonb_build_object('letter', v_letter); end if;
  if v_path <> '{}'::jsonb then v_self := v_self || jsonb_build_object('path', v_path); end if;
  if v_self = '{}'::jsonb then v_self := null; else v_self := v_self || jsonb_build_object('updatedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')); end if;

  -- Fiche avancée (updatedAt, updated_at_client) : la synchronisation du staff la reprend ; toujours plus récente que la version en place.
  perform set_config('hb.player_self', '1', true);
  update public.hb_players
     set data = (data - 'self') || case when v_self is null then '{}'::jsonb else jsonb_build_object('self', v_self) end
                || jsonb_build_object('updatedAt', greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, updated_at_client + 1)),
         updated_at_client = greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, updated_at_client + 1)
   where id = v_pid and not deleted
   returning updated_at_client into v_ts;
  perform set_config('hb.player_self', '0', true);
  if v_ts is null then raise exception 'fiche_introuvable'; end if;
  return v_self;
end $$;

-- ---------- 4. Invitations ----------

create table if not exists public.hb_player_invites (
  code text primary key,
  player_id text not null,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_by uuid,
  used_at timestamptz
);
create index if not exists hb_player_invites_player on public.hb_player_invites (player_id);
alter table public.hb_player_invites enable row level security;
-- Aucune règle de lecture ni d'écriture : seules les fonctions ci-dessous (security definer) y touchent.
revoke all on public.hb_player_invites from public, anon, authenticated;

-- Peut-il donner ou retirer l'accès à cette fiche ? Administrateur ; encadrant qui a le droit de la modifier (fiche de son
-- périmètre, ou créée par lui : même règle que hb_scope_row pour hb_players). Fiche supprimée ou inconnue : non.
create or replace function public.hb_can_invite(p_player_id text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  p record;
begin
  if v_uid is null then return false; end if;
  select role into v_role from public.hb_profiles where user_id = v_uid;
  if v_role not in ('admin', 'preparateur') then return false; end if;
  select scope_dept, scope_club, data ->> 'createdBy' as created_by into p from public.hb_players where id = p_player_id and not deleted;
  if not found then return false; end if;
  if v_role = 'admin' then return true; end if;
  return public.hb_scope_has(v_uid, p.scope_dept, p.scope_club, p.created_by);
end $$;

-- Nouveau code : 8 caractères tirés au hasard (pgcrypto), alphabet sans O / 0 / I / 1.
create or replace function public.hb_new_invite_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alpha, 1 + (get_byte(v_bytes, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.hb_player_invites where code = v_code);
  end loop;
  return v_code;
end $$;

-- Journal d'activité : « accès joueur » sur la fiche.
create or replace function public.hb_player_access_log(p_player_id text, p_what text, p_changes jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.hb_actor();
  insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary, changes)
  values (a.uid, a.name, a.role, 'players', p_player_id, 'accès joueur', coalesce(public.hb_player_name(p_player_id), '?') || ' — ' || p_what, p_changes);
end $$;

-- Donne un code pour cette fiche : le code encore valide s'il y en a un (reused = true), sinon un nouveau (30 jours).
create or replace function public.hb_invite_player(p_player_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if not public.hb_can_invite(p_player_id) then raise exception 'Réservé aux administrateurs et aux encadrants de cette fiche'; end if;
  select code, expires_at into r from public.hb_player_invites
   where player_id = p_player_id and used_at is null and expires_at > now()
   order by expires_at desc limit 1;
  if found then
    return jsonb_build_object('code', r.code, 'expires_at', r.expires_at, 'reused', true);
  end if;
  insert into public.hb_player_invites (code, player_id, created_by, created_by_name)
  values (public.hb_new_invite_code(), p_player_id, v_uid, (select coalesce(full_name, email) from public.hb_profiles where user_id = v_uid))
  returning code, expires_at into r;
  perform public.hb_player_access_log(p_player_id, 'code d’accès créé', jsonb_build_object('expires_at', jsonb_build_array(null, r.expires_at)));
  return jsonb_build_object('code', r.code, 'expires_at', r.expires_at, 'reused', false);
end $$;

-- État de l'accès joueur d'une fiche, pour le staff : compte relié (depuis quand), code en cours.
create or replace function public.hb_player_access(p_player_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_linked record;
  v_code record;
begin
  if not public.hb_can_invite(p_player_id) then raise exception 'Réservé aux administrateurs et aux encadrants de cette fiche'; end if;
  select player_linked_at into v_linked from public.hb_profiles where role = 'joueur' and player_id = p_player_id order by player_linked_at desc limit 1;
  select code, expires_at into v_code from public.hb_player_invites
   where player_id = p_player_id and used_at is null and expires_at > now() order by expires_at desc limit 1;
  return jsonb_build_object('linked', v_linked.player_linked_at is not null, 'since', v_linked.player_linked_at,
                            'code', v_code.code, 'expires_at', v_code.expires_at);
end $$;

-- Retire l'accès : le compte du jeune redevient un compte joueur sans fiche (il ne voit plus rien) ; codes non utilisés effacés.
create or replace function public.hb_revoke_player_access(p_player_id text) returns void
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if not public.hb_can_invite(p_player_id) then raise exception 'Réservé aux administrateurs et aux encadrants de cette fiche'; end if;
  update public.hb_profiles set player_id = null, player_linked_at = null where role = 'joueur' and player_id = p_player_id;
  get diagnostics v_n = row_count;
  delete from public.hb_player_invites where player_id = p_player_id and used_at is null;
  perform public.hb_player_access_log(p_player_id, 'accès retiré', jsonb_build_object('comptes', jsonb_build_array(v_n, 0)));
end $$;

-- Âge minimum de l'espace joueur (Réglages → Espace joueur ; hb_config « espace_joueur » : { playerMinAge }) ; défaut 10.
create or replace function public.hb_player_min_age() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case when (data -> 'value' ->> 'playerMinAge') ~ '^\d{1,2}$'
                               and (data -> 'value' ->> 'playerMinAge')::int between 6 and 18
                              then (data -> 'value' ->> 'playerMinAge')::int end
                     from public.hb_config where id = 'espace_joueur' and not deleted), 10)
$$;

-- Le compte du jeune relie sa fiche avec son code. Refus en clair (message = code d'erreur, affiché par l'appli).
create or replace function public.hb_claim_invite(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_linked text;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  inv record;
  p record;
  v_birth date;
  v_min int := public.hb_player_min_age();
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  select role, player_id into v_role, v_linked from public.hb_profiles where user_id = v_uid;
  if v_role is distinct from 'joueur' then raise exception 'pas_joueur'; end if;
  if v_linked is not null then raise exception 'deja_relie'; end if;
  select * into inv from public.hb_player_invites where code = v_code;
  if not found then raise exception 'code_inconnu'; end if;
  if inv.used_at is not null then raise exception 'code_utilise'; end if;
  if inv.expires_at <= now() then raise exception 'code_expire'; end if;
  select id, data ->> 'firstName' as first_name, data ->> 'birthDate' as birth into p from public.hb_players where id = inv.player_id and not deleted;
  if not found then raise exception 'fiche_introuvable'; end if;
  if exists (select 1 from public.hb_profiles where role = 'joueur' and player_id = inv.player_id and user_id <> v_uid) then
    raise exception 'fiche_deja_reliee';
  end if;
  if coalesce(p.birth, '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'naissance_manquante'; end if;
  begin
    v_birth := p.birth::date;
  exception when others then
    raise exception 'naissance_manquante';
  end;
  if extract(year from age(current_date, v_birth)) < v_min then raise exception 'trop_jeune'; end if;

  update public.hb_profiles set player_id = p.id, player_linked_at = now() where user_id = v_uid;
  update public.hb_player_invites set used_by = v_uid, used_at = now() where code = v_code;
  -- Les autres codes de la fiche ne servent plus.
  delete from public.hb_player_invites where player_id = p.id and used_at is null;
  perform public.hb_player_access_log(p.id, 'compte relié');
  return jsonb_build_object('player_id', p.id, 'first_name', p.first_name);
end $$;

-- ---------- 5. Comptes : rôle « joueur » depuis l'appli ----------

-- Reprise de 014 : « joueur » accepté ; passer à joueur ou en sortir efface la fiche reliée.
create or replace function public.hb_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.hb_profiles where user_id = auth.uid()) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  if p_role not in ('preparateur', 'observateur', 'joueur') then
    raise exception 'Un administrateur se nomme uniquement depuis Supabase (SQL Editor)';
  end if;
  if (select role from public.hb_profiles where user_id = p_user) = 'admin' then
    raise exception 'Le rôle d’un administrateur se change uniquement depuis Supabase (SQL Editor)';
  end if;
  update public.hb_profiles
     set role = p_role,
         player_id = case when p_role = 'joueur' and role = 'joueur' then player_id end,
         player_linked_at = case when p_role = 'joueur' and role = 'joueur' then player_linked_at end,
         departments = case when p_role = 'joueur' then '{}'::text[] else departments end
   where user_id = p_user;
end $$;

-- Reprise de 015 : « joueur » accepté (sans secteur).
create or replace function public.hb_create_member(
  p_email text, p_password text, p_full_name text, p_role text, p_departments text[] default '{}', p_phone text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
  v_name text := trim(p_full_name);
begin
  perform public.hb_member_guard(null);
  if p_role not in ('preparateur', 'observateur', 'joueur') then
    raise exception 'Depuis l’appli, on crée seulement des observateurs, des encadrants et des joueurs';
  end if;
  perform public.hb_member_check(v_email, p_password, v_name);
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Un compte existe déjà avec cette adresse e-mail';
  end if;

  -- Compte confirmé d'office (pas d'e-mail de confirmation) : il peut se connecter tout de suite.
  -- Les jetons vides (et non NULL) sont attendus par le service de connexion de Supabase.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    -- Mot de passe provisoire : l'appli demandera d'en choisir un à la première connexion.
    jsonb_build_object('full_name', v_name, 'must_change_password', true), now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', null, now(), now());

  -- Le profil est créé par le déclencheur de 002_roles.sql ; on y met le rôle et le secteur (aucun pour un joueur).
  update public.hb_profiles
     set role = p_role, full_name = v_name, email = v_email, phone = nullif(trim(p_phone), ''),
         departments = case when p_role = 'joueur' then '{}'::text[] else
           coalesce((select array_agg(distinct upper(trim(d)) order by upper(trim(d)))
                       from unnest(p_departments) d where trim(d) <> ''), '{}') end
   where user_id = v_id;

  perform public.hb_member_log(v_id, 'création', v_name,
    jsonb_build_object('email', jsonb_build_array(null, v_email), 'role', jsonb_build_array(null, p_role)));
  return v_id;
end $$;

-- ---------- 6. Droits des fonctions ----------

revoke all on function public.hb_is_player() from public, anon;
revoke all on function public.hb_my_player_id() from public, anon;
revoke all on function public.hb_player_guard() from public, anon, authenticated;
revoke all on function public.hb_self_text(jsonb, int) from public, anon, authenticated;
revoke all on function public.hb_self_lines(jsonb) from public, anon, authenticated;
revoke all on function public.hb_player_self_update(jsonb) from public, anon;
revoke all on function public.hb_can_invite(text) from public, anon;
revoke all on function public.hb_new_invite_code() from public, anon, authenticated;
revoke all on function public.hb_player_access_log(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.hb_invite_player(text) from public, anon;
revoke all on function public.hb_player_access(text) from public, anon;
revoke all on function public.hb_revoke_player_access(text) from public, anon;
revoke all on function public.hb_player_min_age() from public, anon;
revoke all on function public.hb_claim_invite(text) from public, anon;
grant execute on function public.hb_is_player() to authenticated;
grant execute on function public.hb_my_player_id() to authenticated;
grant execute on function public.hb_player_self_update(jsonb) to authenticated;
grant execute on function public.hb_can_invite(text) to authenticated;
grant execute on function public.hb_invite_player(text) to authenticated;
grant execute on function public.hb_player_access(text) to authenticated;
grant execute on function public.hb_revoke_player_access(text) to authenticated;
grant execute on function public.hb_player_min_age() to authenticated;
grant execute on function public.hb_claim_invite(text) to authenticated;
-- hb_set_role, hb_create_member, hb_scope_row : droits inchangés (create or replace les garde).

-- Vérification : la colonne, la table des codes, les règles et les déclencheurs sont en place.
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hb_profiles' and column_name = 'player_id') as colonne_player_id,
       to_regclass('public.hb_player_invites') is not null as table_invitations,
       (select count(*) from pg_policies where schemaname = 'public' and policyname in ('player_self_read', 'player_lists_read')) as regles_joueur_sur_2,
       (select count(*) from pg_trigger where tgname = 'hb_a_player_guard' and not tgisinternal) as tables_gardees,
       (select count(*) from public.hb_profiles where role = 'joueur') as comptes_joueur,
       public.hb_player_min_age() as age_minimum;
