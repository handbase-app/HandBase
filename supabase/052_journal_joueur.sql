-- HandBase : ESPACE JOUEUR, « le journal intime du handball » : « Mes repères », l'historique de « Ma lettre » (dans la clé
-- `self` de la fiche, comme la lettre et le parcours de 051) et « Mon journal du hand » (table à part, PRIVÉE par défaut).
-- À exécuter dans Supabase > SQL Editor, APRÈS 051_espace_joueur.sql : base de TEST d'abord (vérifier avec la requête de
-- contrôle en fin de fichier), puis la réelle. Peut être relancé sans risque (create table if not exists, create or replace,
-- drop … if exists).
-- L'appli qui affiche le journal (src/pages/Me.tsx, src/components/PlayerJournal.tsx) doit être publiée APRÈS ce script :
-- avant, ses appels échouent proprement (« pas encore ouvert sur ce serveur ») et la lettre s'enregistre comme avant.
--
-- POURQUOI : le jeune écrit déjà sa lettre et son parcours (051). On lui donne de quoi raconter SON hand au fil de la saison :
-- des repères courts, des notes datées (le ressenti sportif : un match, un entraînement, une envie ; pas de santé ni de vie
-- privée), et on garde les versions précédentes de sa lettre (on voit le chemin parcouru). Le journal est À LUI : il le garde
-- pour lui, et partage avec son encadrant les notes qu'il choisit, une par une. L'encadrant voit en plus la TENDANCE de ses
-- humeurs (combien de notes par humeur et par semaine, jamais le texte), sans aucune IA.
--
-- CE QUE LE SCRIPT FAIT
-- 1) hb_player_self_update(p_self jsonb) (remplace celle de 051, même signature, mêmes protections : rôle joueur, SA fiche
--    seulement, 20 000 caractères au plus en entrée, réglage local hb.player_self pour passer hb_player_guard et hb_scope_row,
--    updatedAt / updated_at_client de la fiche avancés, hb_stamp et hb_log par les déclencheurs habituels) :
--    - lettre et parcours : nettoyés EXACTEMENT comme en 051 ;
--    - NOUVEAU « marks » (Mes repères) : favPlayer, favTeam, dreamPosition, memorableMatch : une ligne, 80 caractères chacun ;
--    - NOUVEAU : quand la lettre CHANGE, la version précédente part dans `letterHistory` ({ at, letter }, la plus récente en
--      premier, 20 au plus : les plus anciennes tombent) ; `at` = date où cette version avait été écrite (`letterAt`, posé
--      par le serveur ; à défaut, le dernier enregistrement) ; la lettre en place reçoit `letterAt` = maintenant. Le jeune ne
--      peut ni écrire ni effacer cet historique (ce qu'il envoie sous cette clé est ignoré) ;
--    - p_self null ou vide : lettre, parcours et repères retirés ; l'historique reste.
--    - TAILLE TOTALE de `self` : 300 000 caractères au plus (JSON) ; trop lourd : les plus anciennes versions de la lettre
--      tombent d'abord, puis refus clair « self_trop_long » (jamais pour ce qui ne grossit pas).
-- 2) « Mon journal du hand » : table hb_player_journal (une ligne par note : id, player_id, user_id = le compte qui l'a
--    écrite, at = date posée par le serveur, text 1 000 caractères, mood, shared, shared_at, edited_at, deleted, updated_at).
--    PAS dans la fiche : le staff lit toute la ligne de la fiche, il ne doit lire que les notes partagées.
--    - LECTURE (règles RLS) : le jeune lit toutes SES notes (player_id = hb_my_player_id()) ; le staff (hb_has_role()) lit
--      SEULEMENT les notes partagées (shared) des joueurs qu'il a le droit de lire (même règle que la lecture de hb_players,
--      046 : périmètre, ou créateur de la fiche : hb_staff_reads_player). Personne d'autre.
--    - ÉCRITURE : jamais directe (aucun droit insert / update / delete ; hb_player_guard posé aussi) ; quatre fonctions du
--      joueur, mêmes protections que la lettre (rôle joueur, sa fiche, réglage hb.player_self) :
--        hb_player_journal_add(p_text, p_mood) → la note créée (privée) ;
--        hb_player_journal_edit(p_id, p_text, p_mood) → la note corrigée (date d'origine gardée, edited_at posé) ;
--        hb_player_journal_delete(p_id) → vrai si la note existait (son texte et son humeur sont effacés tout de suite) ;
--        hb_player_journal_share(p_id, p_shared) → la note, partagée avec son encadrant ou plus partagée.
--      Texte vide refusé (« note_vide ») ; humeur : liste FERMÉE (motive, content, fier, concentre, serein, pensif, decu,
--      fatigue : c'est le jeune qui s'exprime, pas un jugement porté sur lui) ; toute autre valeur est ignorée (pas
--      d'humeur). 200 notes au plus par fiche : au-delà, les plus anciennes ne sont plus gardées (effacées).
--    - Pas de synchronisation hors ligne : l'appli lit à la demande, en ligne (page /moi, fiche du staff).
--    - Fiche effacée (RGPD, « purged ») ou supprimée définitivement : ses notes partent avec elle.
-- 3) TENDANCE DES HUMEURS pour le staff : hb_player_mood_trend(p_player_id) → les 8 dernières semaines (lundi), le nombre de
--    notes par humeur et par semaine, TOUTES les notes (partagées ou non), JAMAIS de texte. Mêmes droits que la lecture de
--    la fiche (hb_staff_reads_player).
-- 4) PROTECTION DE `self` contre les écritures du STAFF (déclencheur hb_b_player_self_keep sur hb_players) : seules les
--    fonctions du joueur l'écrivent. Une fiche enregistrée par un encadrant depuis un appareil qui avait une copie ancienne
--    (« la plus récente gagne » de hb_upsert) ne fait plus disparaître ce que le jeune a écrit entre-temps : la clé `self`
--    du serveur est remise telle quelle ; une fiche créée par le staff n'a pas de `self`. Exception : l'effacement RGPD
--    d'une fiche (« purged ») emporte tout.
-- 5) JOURNAL D'ACTIVITÉ (hb_log, reprise EXACTE de 034) : le contenu de `self` n'y est plus recopié (comme la photo) :
--    « (écrit par le joueur) ». Sinon chaque enregistrement recopierait la lettre et tout son historique dans hb_audit.
--    L'action (« modification » de la fiche, par le jeune) reste notée. Les notes du journal ne passent jamais par hb_audit.
-- 6) CRÉER LE COMPTE DU JEUNE DEPUIS SA FICHE : hb_create_player_account(p_player_id, p_email, p_password) → l'identifiant du
--    compte, déjà relié à la fiche (pas de code à entrer) : administrateur, ou encadrant qui a le droit de modifier la fiche
--    (hb_can_invite : périmètre, ou fiche créée par lui) ; TOUJOURS un compte « joueur » relié à CETTE fiche (un encadrant ne
--    crée toujours ni encadrant, ni observateur, ni administrateur). Mêmes contrôles que hb_claim_invite (naissance_manquante,
--    trop_jeune), plus fiche_deja_reliee, adresse_utilisee et les règles de hb_member_check ; compte créé comme le fait
--    hb_create_member pour un joueur (mot de passe provisoire à changer à la première connexion), au nom de la fiche ; codes
--    non utilisés effacés ; journal « création » et « accès joueur : compte créé et relié », au nom de celui qui l'a fait.
--    Réglages → Utilisateurs garde la création d'un compte « Joueur » par un administrateur (relié ensuite par un code).
-- 7) FUSION DE FICHES (hb_merge_players, reprise EXACTE de 029 + ajouts « 052 ») : ce que le jeune a écrit suit la fiche
--    gardée : `self` réuni (hb_self_merge : une seule fiche en a → repris tel quel ; les deux → lettre de la fiche gardée,
--    l'autre lettre dans l'historique datée, repères complétés, parcours réuni sans doublon, historiques réunis et triés,
--    20 au plus) ; notes du journal passées à la fiche gardée (avec leur partage) ; compte joueur de la fiche fondue relié
--    à la fiche gardée si elle n'en a pas, sinon délié (il reverra « Entre ton code »), ligne « accès joueur » au journal.
-- 8) UN MEMBRE DU STAFF QUI DEVIENT JOUEUR (hb_set_role, reprise EXACTE de 051 + refus) : refusé tant qu'il a des
--    affectations dans la structure (« Retire d'abord ses affectations (Structure) avant d'en faire un compte joueur. ») ;
--    hb_set_departments (reprise de 010 + une ligne) ne redonne plus de secteur à un compte joueur.
--
-- CE QUI NE CHANGE PAS : lecture de la fiche (le jeune lit SA fiche, le staff la lit comme avant), hb_upsert,
-- hb_player_guard, hb_scope_row, les invitations, les exports du staff (sans `self` ni journal).
-- Retour arrière : relancer la partie « hb_player_self_update » de 051 ; drop table hb_player_journal (les notes partent) ;
-- supprimer les fonctions hb_player_journal_* , hb_player_mood_trend, hb_staff_reads_player, hb_create_player_account ; drop trigger
-- hb_b_player_self_keep et hb_player_journal_forget on public.hb_players ; relancer hb_log depuis 034, hb_merge_players depuis
-- 029, hb_set_role depuis 051, hb_set_departments depuis 010 ; supprimer hb_self_merge.

-- ---------- Outils (internes : jamais appelés directement par l'appli) ----------

-- Texte d'une ligne : caractères de contrôle retirés, espaces repliés, bords coupés, longueur limitée ; vide → null.
create or replace function public.hb_self_line(p jsonb, p_max int) returns text
language sql immutable as $$
  select case when jsonb_typeof(p) = 'string'
              then nullif(left(btrim(regexp_replace(p #>> '{}', '[[:space:][:cntrl:]]+', ' ', 'g')), p_max), '') end
$$;

-- Texte d'une note : caractères de contrôle retirés (sauf retours à la ligne et tabulations), bords coupés, 1 000 caractères.
create or replace function public.hb_self_note_text(p text) returns text
language sql immutable as $$
  select nullif(rtrim(left(btrim(regexp_replace(replace(replace(coalesce(p, ''), E'\r\n', E'\n'), E'\r', E'\n'),
                                               E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', '', 'g')), 1000)), '')
$$;

-- Humeur d'une note : liste fermée ; toute autre valeur → null (pas d'humeur).
create or replace function public.hb_self_mood(p text) returns text
language sql immutable as $$
  select case when p in ('motive', 'content', 'fier', 'concentre', 'serein', 'pensif', 'decu', 'fatigue') then p end
$$;

-- Date au format de l'appli (ISO, UTC).
create or replace function public.hb_self_iso(p timestamptz) returns text
language sql immutable as $$
  select to_char(p at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

-- La fiche du compte connecté, s'il est un joueur relié. Refus en clair sinon (mêmes messages que 051).
create or replace function public.hb_player_self_id() returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pid text;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  select player_id into v_pid from public.hb_profiles where user_id = v_uid and role = 'joueur';
  if not found then raise exception 'pas_joueur'; end if;
  if v_pid is null then raise exception 'sans_fiche'; end if;
  return v_pid;
end $$;

-- Le compte connecté (staff) lit-il cette fiche ? Même règle que la lecture de hb_players (046) : un rôle du staff, et la
-- fiche dans son périmètre ou créée par lui. Fiche supprimée ou inconnue : non.
create or replace function public.hb_staff_reads_player(p_player_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.hb_has_role() and exists (
    select 1 from public.hb_players p
     where p.id = p_player_id and not p.deleted
       and public.hb_scope_has(auth.uid(), p.scope_dept, p.scope_club, p.data ->> 'createdBy'))
$$;

-- ---------- 1. Lettre, parcours, repères, historique de la lettre (clé `self` de la fiche) ----------

-- Écrit `self` sur la fiche (null : clé retirée) : taille vérifiée, réglage hb.player_self pour sa seule durée, fiche avancée
-- (updatedAt, updated_at_client) pour que la synchronisation du staff la reprenne. Renvoie ce qui a été écrit.
create or replace function public.hb_player_self_write(p_pid text, p_self jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_self jsonb := p_self;
  v_before int;
  v_ts bigint;
begin
  -- Trop lourd : les plus anciennes versions de la lettre tombent d'abord ; sinon refus, sauf si ça ne grossit pas.
  while v_self is not null and length(v_self::text) > 300000 and jsonb_array_length(coalesce(v_self -> 'letterHistory', '[]'::jsonb)) > 0 loop
    v_self := case when jsonb_array_length(v_self -> 'letterHistory') = 1 then v_self - 'letterHistory'
                   else jsonb_set(v_self, '{letterHistory}', (v_self -> 'letterHistory') - (jsonb_array_length(v_self -> 'letterHistory') - 1)) end;
  end loop;
  if v_self is not null and length(v_self::text) > 300000 then
    select coalesce(length((data -> 'self')::text), 0) into v_before from public.hb_players where id = p_pid;
    if length(v_self::text) > coalesce(v_before, 0) then raise exception 'self_trop_long'; end if;
  end if;
  if v_self = '{}'::jsonb then v_self := null; end if;

  perform set_config('hb.player_self', '1', true);
  update public.hb_players
     set data = (data - 'self') || case when v_self is null then '{}'::jsonb else jsonb_build_object('self', v_self) end
                || jsonb_build_object('updatedAt', greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, updated_at_client + 1)),
         updated_at_client = greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, updated_at_client + 1)
   where id = p_pid and not deleted
   returning updated_at_client into v_ts;
  perform set_config('hb.player_self', '0', true);
  if v_ts is null then raise exception 'fiche_introuvable'; end if;
  return v_self;
end $$;

create or replace function public.hb_player_self_update(p_self jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_old jsonb;
  v_letter jsonb := '{}'::jsonb;
  v_path jsonb := '{}'::jsonb;
  v_marks jsonb := '{}'::jsonb;
  v_clubs jsonb := '[]'::jsonb;
  v_positions jsonb := '[]'::jsonb;
  v_lines jsonb;
  v_hist jsonb;
  v_self jsonb;
  v_now text := public.hb_self_iso(now());
  k text;
  v text;
  c jsonb;
  v_name text;
  v_from text;
  v_to text;
begin
  if p_self is not null and jsonb_typeof(p_self) <> 'object' then raise exception 'format'; end if;
  if length(coalesce(p_self::text, '')) > 20000 then raise exception 'trop_long'; end if;

  -- Lettre : quatre textes, 2 000 caractères chacun (comme 051).
  foreach k in array array['why', 'proud', 'work', 'free'] loop
    v := public.hb_self_text(p_self -> 'letter' -> k, 2000);
    if v is not null then v_letter := v_letter || jsonb_build_object(k, v); end if;
  end loop;
  -- Parcours : clubs (nom obligatoire, années AAAA facultatives, 20 au plus) (comme 051).
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
  -- Postes joués : codes courts, sans doublon, 12 au plus (comme 051).
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
  -- Repères : quatre champs d'une ligne, 80 caractères chacun.
  foreach k in array array['favPlayer', 'favTeam', 'dreamPosition', 'memorableMatch'] loop
    v := public.hb_self_line(p_self -> 'marks' -> k, 80);
    if v is not null then v_marks := v_marks || jsonb_build_object(k, v); end if;
  end loop;

  -- Ce qui est déjà enregistré (fiche verrouillée jusqu'à la fin : deux enregistrements ne se marchent pas dessus).
  select coalesce(data -> 'self', '{}'::jsonb) into v_old from public.hb_players where id = v_pid and not deleted for update;
  if not found then raise exception 'fiche_introuvable'; end if;
  if jsonb_typeof(v_old) <> 'object' then v_old := '{}'::jsonb; end if;
  -- La lettre précédente rejoint l'historique si elle change (20 versions au plus : les plus anciennes tombent).
  v_hist := case when jsonb_typeof(v_old -> 'letterHistory') = 'array' then v_old -> 'letterHistory' else '[]'::jsonb end;
  if jsonb_typeof(v_old -> 'letter') = 'object' and v_old -> 'letter' <> '{}'::jsonb
     and v_old -> 'letter' is distinct from v_letter then
    v_hist := jsonb_build_array(jsonb_build_object('at', coalesce(v_old ->> 'letterAt', v_old ->> 'updatedAt', v_now), 'letter', v_old -> 'letter'))
              || v_hist;
    while jsonb_array_length(v_hist) > 20 loop v_hist := v_hist - 20; end loop;
  end if;

  v_self := '{}'::jsonb;
  if v_letter <> '{}'::jsonb then
    v_self := v_self || jsonb_build_object('letter', v_letter,
      'letterAt', case when v_old -> 'letter' = v_letter then coalesce(v_old ->> 'letterAt', v_old ->> 'updatedAt', v_now) else v_now end);
  end if;
  if v_path <> '{}'::jsonb then v_self := v_self || jsonb_build_object('path', v_path); end if;
  if v_marks <> '{}'::jsonb then v_self := v_self || jsonb_build_object('marks', v_marks); end if;
  if v_self <> '{}'::jsonb then v_self := v_self || jsonb_build_object('updatedAt', v_now); end if;
  if jsonb_array_length(v_hist) > 0 then v_self := v_self || jsonb_build_object('letterHistory', v_hist); end if;

  return public.hb_player_self_write(v_pid, v_self);
end $$;

-- ---------- 2. « Mon journal du hand » : table à part, privée par défaut ----------

create table if not exists public.hb_player_journal (
  id text primary key,
  player_id text not null,
  user_id uuid,
  at timestamptz not null default now(),
  text text not null default '',
  mood text,
  shared boolean not null default false,
  shared_at timestamptz,
  edited_at timestamptz,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.hb_player_journal drop constraint if exists hb_player_journal_mood;
alter table public.hb_player_journal add constraint hb_player_journal_mood check (mood is null or public.hb_self_mood(mood) is not null);
alter table public.hb_player_journal drop constraint if exists hb_player_journal_text;
alter table public.hb_player_journal add constraint hb_player_journal_text check (length(text) <= 1000);
create index if not exists hb_player_journal_player on public.hb_player_journal (player_id, at desc) where not deleted;
alter table public.hb_player_journal enable row level security;
-- Lecture seulement (les règles ci-dessous trient) ; aucune écriture directe : seules les fonctions y touchent.
revoke all on public.hb_player_journal from public, anon, authenticated;
grant select on public.hb_player_journal to authenticated;

-- Le jeune : toutes SES notes.
drop policy if exists "player_read" on public.hb_player_journal;
create policy "player_read" on public.hb_player_journal for select to authenticated
  using (player_id = (select public.hb_my_player_id()) and not deleted);
-- Le staff : seulement les notes partagées des joueurs qu'il lit.
drop policy if exists "staff_read" on public.hb_player_journal;
create policy "staff_read" on public.hb_player_journal for select to authenticated
  using (shared and not deleted and public.hb_staff_reads_player(player_id));

-- Ceinture : aucun compte joueur n'écrit hors des fonctions (comme les autres tables, 051).
drop trigger if exists hb_a_player_guard on public.hb_player_journal;
create trigger hb_a_player_guard before insert or update or delete on public.hb_player_journal
  for each row execute function public.hb_player_guard();

-- Une note telle que l'appli la reçoit.
create or replace function public.hb_journal_note(n public.hb_player_journal) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', n.id, 'at', public.hb_self_iso(n.at), 'text', n.text, 'mood', n.mood,
                                              'shared', n.shared, 'editedAt', public.hb_self_iso(n.edited_at)))
$$;

-- Nouvelle note (privée). 200 notes au plus par fiche : les plus anciennes sont effacées. Renvoie la note créée.
create or replace function public.hb_player_journal_add(p_text text, p_mood text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pid text := public.hb_player_self_id();
  v_text text := public.hb_self_note_text(p_text);
  v_id text;
  n public.hb_player_journal;
begin
  if v_text is null then raise exception 'note_vide'; end if;
  -- Identifiant court : 11 caractères tirés au hasard (pgcrypto).
  loop
    v_id := 'n' || substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=', 'xyz'), 1, 10);
    exit when not exists (select 1 from public.hb_player_journal where id = v_id);
  end loop;
  perform set_config('hb.player_self', '1', true);
  insert into public.hb_player_journal (id, player_id, user_id, at, text, mood)
  values (v_id, v_pid, auth.uid(), clock_timestamp(), v_text, public.hb_self_mood(p_mood))
  returning * into n;
  delete from public.hb_player_journal
   where id in (select id from public.hb_player_journal where player_id = v_pid and not deleted
                 order by at desc, id desc offset 200);
  perform set_config('hb.player_self', '0', true);
  return public.hb_journal_note(n);
end $$;

-- Corrige une note (texte, humeur) ; sa date reste, edited_at est posé ; son partage ne change pas.
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
   where id = p_id and player_id = v_pid and not deleted
   returning * into n;
  perform set_config('hb.player_self', '0', true);
  if n.id is null then raise exception 'note_introuvable'; end if;
  return public.hb_journal_note(n);
end $$;

-- Partage une note avec son encadrant (p_shared vrai) ou la reprend (faux). Renvoie la note.
create or replace function public.hb_player_journal_share(p_id text, p_shared boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  n public.hb_player_journal;
begin
  perform set_config('hb.player_self', '1', true);
  update public.hb_player_journal
     set shared = coalesce(p_shared, false), shared_at = case when coalesce(p_shared, false) then now() end, updated_at = now()
   where id = p_id and player_id = v_pid and not deleted
   returning * into n;
  perform set_config('hb.player_self', '0', true);
  if n.id is null then raise exception 'note_introuvable'; end if;
  return public.hb_journal_note(n);
end $$;

-- Supprime une note : texte et humeur effacés tout de suite. Vrai si elle existait ; faux sinon (rien à faire).
create or replace function public.hb_player_journal_delete(p_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_n int;
begin
  perform set_config('hb.player_self', '1', true);
  update public.hb_player_journal
     set deleted = true, text = '', mood = null, shared = false, shared_at = null, updated_at = now()
   where id = p_id and player_id = v_pid and not deleted;
  get diagnostics v_n = row_count;
  perform set_config('hb.player_self', '0', true);
  return v_n > 0;
end $$;

-- Fiche effacée (RGPD) ou supprimée définitivement : ses notes partent avec elle.
create or replace function public.hb_player_journal_forget() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.hb_player_journal where player_id = old.id;
  elsif coalesce((new.data ->> 'purged')::boolean, false) then
    delete from public.hb_player_journal where player_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists hb_player_journal_forget on public.hb_players;
create trigger hb_player_journal_forget after update or delete on public.hb_players
  for each row execute function public.hb_player_journal_forget();

-- ---------- 3. Tendance des humeurs (staff) : des nombres, jamais de texte ----------

-- 8 dernières semaines (du lundi, heure de Paris), la plus ancienne en premier : { from, notes, moods: { humeur: nombre } },
-- toutes les notes (partagées ou non). Mêmes droits que la lecture de la fiche.
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
                               from (select j.mood, count(*) as n from public.hb_player_journal j
                                      where j.player_id = p_player_id and not j.deleted and j.mood is not null
                                        and (j.at at time zone 'Europe/Paris')::date >= s.d and (j.at at time zone 'Europe/Paris')::date < s.d + 7
                                      group by j.mood) m), '{}'::jsonb) as moods
              from (select g.t::date as d from generate_series(v_monday - 49, v_monday, interval '7 days') g(t)) s) w);
end $$;

-- ---------- 4. `self` : seules les fonctions du joueur l'écrivent ----------

create or replace function public.hb_player_self_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('hb.player_self', true) = '1' then return new; end if;
  if tg_op = 'INSERT' then
    new.data := new.data - 'self';
    return new;
  end if;
  -- Effacement RGPD de la fiche : tout part, `self` compris.
  if coalesce((new.data ->> 'purged')::boolean, false) then return new; end if;
  new.data := (new.data - 'self') || case when old.data ? 'self' then jsonb_build_object('self', old.data -> 'self') else '{}'::jsonb end;
  return new;
end $$;
-- « hb_b_… » : juste après hb_a_player_guard (ordre alphabétique des déclencheurs d'un même moment), avant les autres.
drop trigger if exists hb_b_player_self_keep on public.hb_players;
create trigger hb_b_player_self_keep before insert or update on public.hb_players
  for each row execute function public.hb_player_self_keep();

-- ---------- 5. Journal d'activité : reprise EXACTE de 034, `self` sans son contenu ----------

create or replace function public.hb_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_table text := substr(tg_table_name, 4); -- hb_players -> players
  v_action text;
  v_changes jsonb;
  v_meta text[] := array['updatedAt', 'updatedBy', 'updatedByName', 'updatedAtServer', 'createdBy', 'createdByName', 'createdAtServer'];
  -- Groupe ou alerte privé, ou groupe d'équipe (031), avant ou après : seule l'action est notée, rien de son contenu.
  -- Suivis (032) : toujours, et sans même l'identifiant de la ligne (il contient le joueur ou le groupe suivi).
  -- Staffs (034) : toujours (leur nom, leurs membres ne regardent qu'eux).
  v_follow boolean := tg_table_name = 'hb_follows';
  v_private boolean := v_follow or tg_table_name = 'hb_teams' or tg_table_name in ('hb_groups', 'hb_alerts')
    and (coalesce((new.data ->> 'private')::boolean, false) or coalesce((old.data ->> 'private')::boolean, false)
         or coalesce((new.data ->> 'team')::boolean, false) or coalesce((old.data ->> 'team')::boolean, false));
begin
  select * into a from public.hb_actor();
  if tg_op = 'INSERT' then
    v_action := case when new.deleted then 'suppression' else 'création' end;
  elsif tg_op = 'DELETE' then
    v_action := 'suppression définitive';
  elsif new.deleted and not old.deleted then
    v_action := 'suppression';
  elsif old.deleted and not new.deleted then
    v_action := 'restauration';
  else
    v_action := 'modification';
  end if;

  if tg_op = 'UPDATE' then
    -- Photo, et (052) ce qu'écrit le joueur (lettre, parcours, repères, historique) : seulement le fait que ça a changé.
    select jsonb_object_agg(k, jsonb_build_array(
             case when k = 'photo' then to_jsonb('(photo)'::text) when k = 'self' then to_jsonb('(écrit par le joueur)'::text) else old.data -> k end,
             case when k = 'photo' then to_jsonb('(photo)'::text) when k = 'self' then to_jsonb('(écrit par le joueur)'::text) else new.data -> k end))
      into v_changes
      from (select jsonb_object_keys(old.data || new.data) as k) keys
     where old.data -> k is distinct from new.data -> k
       and not (k = any (v_meta));
    -- Rien de réel n'a changé (resynchronisation) : pas de ligne de journal.
    if v_changes is null and v_action = 'modification' then return null; end if;
  end if;

  insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary, changes)
  values (a.uid, a.name, a.role, v_table, case when v_follow then '-' else coalesce(new.id, old.id) end, v_action,
          case when v_private then '(privé)' else public.hb_summary(v_table, coalesce(new.data, old.data)) end,
          case when v_private then null else v_changes end);
  return null;
end $$;

-- ---------- 6. Créer le compte du jeune depuis sa fiche, déjà relié ----------

-- Administrateur, ou encadrant qui a le droit de modifier cette fiche (hb_can_invite : périmètre, ou fiche créée par lui ;
-- PAS hb_member_guard, réservé aux administrateurs). Le compte créé est TOUJOURS un compte « joueur » relié à cette fiche :
-- un encadrant ne crée toujours ni encadrant, ni observateur, ni administrateur (hb_create_member ne change pas).
-- Mêmes contrôles que hb_claim_invite : date de naissance (naissance_manquante) et âge minimum (trop_jeune) ; fiche déjà
-- reliée à un compte (fiche_deja_reliee) ; adresse déjà utilisée (adresse_utilisee) ; adresse et mot de passe vérifiés par
-- hb_member_check (8 caractères au moins). Le compte est créé comme hb_create_member le fait pour le rôle « joueur » (mêmes
-- lignes dans auth.users et auth.identities : confirmé d'office, mot de passe provisoire à changer à la première connexion),
-- au nom de la fiche (prénom nom), puis relié tout de suite (pas de code à entrer) ; les codes non utilisés de la fiche sont
-- effacés. Journal : « création » du compte (hb_member_log) et « accès joueur : compte créé et relié », au nom de celui qui
-- l'a fait. Renvoie l'identifiant du compte.
create or replace function public.hb_create_player_account(p_player_id text, p_email text, p_password text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid := gen_random_uuid();
  p record;
  v_birth date;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if not public.hb_can_invite(p_player_id) then raise exception 'Réservé aux administrateurs et aux encadrants de cette fiche'; end if;
  select id, btrim(coalesce(data ->> 'firstName', '') || ' ' || coalesce(data ->> 'lastName', '')) as name, data ->> 'birthDate' as birth
    into p from public.hb_players where id = p_player_id and not deleted;
  if not found then raise exception 'fiche_introuvable'; end if;
  if exists (select 1 from public.hb_profiles where role = 'joueur' and player_id = p.id) then raise exception 'fiche_deja_reliee'; end if;
  if coalesce(p.birth, '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'naissance_manquante'; end if;
  begin
    v_birth := p.birth::date;
  exception when others then
    raise exception 'naissance_manquante';
  end;
  if extract(year from age(current_date, v_birth)) < public.hb_player_min_age() then raise exception 'trop_jeune'; end if;
  perform public.hb_member_check(v_email, p_password, p.name);
  if exists (select 1 from auth.users where lower(email) = v_email) then raise exception 'adresse_utilisee'; end if;

  -- Comme hb_create_member (051) : compte confirmé d'office, jetons vides (et non NULL) attendus par le service de connexion.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', p.name, 'must_change_password', true), now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', null, now(), now());

  -- Le profil est créé par le déclencheur de 002_roles.sql : rôle joueur, sans secteur, relié à la fiche.
  update public.hb_profiles
     set role = 'joueur', full_name = p.name, email = v_email, phone = null, departments = '{}'::text[],
         player_id = p.id, player_linked_at = now()
   where user_id = v_id;
  delete from public.hb_player_invites where player_id = p.id and used_at is null;

  perform public.hb_member_log(v_id, 'création', p.name,
    jsonb_build_object('email', jsonb_build_array(null, v_email), 'role', jsonb_build_array(null, 'joueur')));
  perform public.hb_player_access_log(p.id, 'compte créé et relié');
  return v_id;
end $$;

-- ---------- 7. Fusion de fiches : ce que le jeune a écrit suit la fiche gardée ----------

-- Ce que le jeune a écrit sur deux fiches fondues (t = fiche gardée, s = fiche fondue) : `self` réuni.
--  - une seule des deux en a : celui-là, tel quel ;
--  - lettre : celle de la fiche gardée (sinon celle de l'autre) ; l'autre lettre, si elle diffère, part dans l'historique,
--    datée (letterAt, sinon updatedAt) ; historiques réunis, sans doublon, du plus récent au plus ancien, 20 au plus ;
--  - repères : ceux de la fiche gardée, complétés par ceux de l'autre ;
--  - parcours : clubs (20), postes (12), sélections et palmarès (20 lignes) réunis sans doublon, la fiche gardée d'abord.
create or replace function public.hb_self_merge(t jsonb, s jsonb) returns jsonb
language plpgsql immutable as $$
declare
  r jsonb;
  v_hist jsonb;
  v_path jsonb := '{}'::jsonb;
  k text;
  v_lim int;
  v_arr jsonb;
begin
  if jsonb_typeof(t) is distinct from 'object' or t = '{}'::jsonb then
    return case when jsonb_typeof(s) = 'object' and s <> '{}'::jsonb then s end;
  end if;
  if jsonb_typeof(s) is distinct from 'object' or s = '{}'::jsonb then return t; end if;
  r := t - 'letter' - 'letterAt' - 'letterHistory' - 'marks' - 'path' - 'updatedAt';

  -- Lettre gardée, et historiques réunis (avec la lettre de l'autre fiche si elle diffère).
  v_hist := coalesce(case when jsonb_typeof(t -> 'letterHistory') = 'array' then t -> 'letterHistory' end, '[]'::jsonb)
         || coalesce(case when jsonb_typeof(s -> 'letterHistory') = 'array' then s -> 'letterHistory' end, '[]'::jsonb);
  if jsonb_typeof(t -> 'letter') = 'object' and t -> 'letter' <> '{}'::jsonb then
    r := r || jsonb_strip_nulls(jsonb_build_object('letter', t -> 'letter', 'letterAt', coalesce(t -> 'letterAt', t -> 'updatedAt')));
    if jsonb_typeof(s -> 'letter') = 'object' and s -> 'letter' <> '{}'::jsonb and s -> 'letter' <> t -> 'letter' then
      v_hist := v_hist || jsonb_build_array(jsonb_build_object('at', coalesce(s ->> 'letterAt', s ->> 'updatedAt'), 'letter', s -> 'letter'));
    end if;
  elsif jsonb_typeof(s -> 'letter') = 'object' and s -> 'letter' <> '{}'::jsonb then
    r := r || jsonb_strip_nulls(jsonb_build_object('letter', s -> 'letter', 'letterAt', coalesce(s -> 'letterAt', s -> 'updatedAt')));
  end if;
  select coalesce(jsonb_agg(h order by h ->> 'at' desc nulls last), '[]'::jsonb) into v_hist
    from (select distinct on (h -> 'letter') h from jsonb_array_elements(v_hist) h
           where jsonb_typeof(h) = 'object' and jsonb_typeof(h -> 'letter') = 'object'
           order by h -> 'letter', h ->> 'at' desc nulls last) u;
  select coalesce(jsonb_agg(h order by o), '[]'::jsonb) into v_hist
    from jsonb_array_elements(v_hist) with ordinality x(h, o) where o <= 20;
  if jsonb_array_length(v_hist) > 0 then r := r || jsonb_build_object('letterHistory', v_hist); end if;

  -- Repères : ceux de la fiche gardée l'emportent.
  if jsonb_typeof(s -> 'marks') = 'object' or jsonb_typeof(t -> 'marks') = 'object' then
    r := r || jsonb_build_object('marks', coalesce(case when jsonb_typeof(s -> 'marks') = 'object' then s -> 'marks' end, '{}'::jsonb)
                                       || coalesce(case when jsonb_typeof(t -> 'marks') = 'object' then t -> 'marks' end, '{}'::jsonb));
    if r -> 'marks' = '{}'::jsonb then r := r - 'marks'; end if;
  end if;

  -- Parcours : chaque liste réunie sans doublon, la fiche gardée d'abord.
  foreach k in array array['clubs', 'positions', 'selections', 'honours'] loop
    v_lim := case k when 'positions' then 12 else 20 end;
    select coalesce(jsonb_agg(x order by n), '[]'::jsonb) into v_arr
      from (select x, min(n) as n
              from (select x, row_number() over () as n
                      from jsonb_array_elements(coalesce(case when jsonb_typeof(t -> 'path' -> k) = 'array' then t -> 'path' -> k end, '[]'::jsonb)
                                                || coalesce(case when jsonb_typeof(s -> 'path' -> k) = 'array' then s -> 'path' -> k end, '[]'::jsonb)) x) a
             group by x order by min(n) limit v_lim) u;
    if jsonb_array_length(v_arr) > 0 then v_path := v_path || jsonb_build_object(k, v_arr); end if;
  end loop;
  if v_path <> '{}'::jsonb then r := r || jsonb_build_object('path', v_path); end if;

  r := r || jsonb_strip_nulls(jsonb_build_object('updatedAt', greatest(t ->> 'updatedAt', s ->> 'updatedAt')));
  return nullif(r, '{}'::jsonb);
end $$;

-- hb_merge_players : reprise EXACTE de 029 (dernière définition), plus les ajouts marqués « 052 » : `self` réuni
-- (hb_self_merge), notes du journal et compte joueur qui suivent la fiche gardée.
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
                         'reviewedAt', 'mergedFrom', 'mergedInto', 'notes', 'previousLicenses', 'purged'];
  -- 052 : comptes joueur reliés aux deux fiches.
  v_src_account uuid;
begin
  select role, coalesce(full_name, email) into v_role, v_name from public.hb_profiles where user_id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
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
  -- 052 : ce que le jeune a écrit (clé `self`) réuni selon la règle de hb_self_merge ; écrit sous le réglage hb.player_self
  -- (sinon hb_player_self_keep remettrait le `self` d'avant sur la fiche gardée).
  m := (m - 'self') || coalesce(jsonb_build_object('self', public.hb_self_merge(t -> 'self', s -> 'self')), '{}'::jsonb);
  perform set_config('hb.player_self', '1', true);
  update public.hb_players set data = m, updated_at_client = v_now where id = p_target;
  perform set_config('hb.player_self', '0', true);

  -- La source disparaît, en gardant l'adresse de la cible.
  update public.hb_players set data = s || jsonb_build_object('mergedInto', p_target, 'updatedAt', v_now, 'deleted', true),
                               deleted = true, updated_at_client = v_now
   where id = p_source;

  -- 052 : les notes du journal suivent la fiche gardée, avec leur état « partagé ».
  update public.hb_player_journal set player_id = p_target, updated_at = now() where player_id = p_source;
  -- 052 : compte joueur de la fiche fondue : relié à la fiche gardée si elle n'en a pas ; sinon délié (il reverra « Entre ton
  -- code »), le compte de la fiche gardée restant relié.
  select user_id into v_src_account from public.hb_profiles where role = 'joueur' and player_id = p_source limit 1;
  if v_src_account is not null then
    if exists (select 1 from public.hb_profiles where role = 'joueur' and player_id = p_target) then
      update public.hb_profiles set player_id = null, player_linked_at = null where user_id = v_src_account;
      perform public.hb_player_access_log(p_target, 'fusion : le compte de la fiche fondue est délié (la fiche gardée a déjà un compte)');
    else
      update public.hb_profiles set player_id = p_target where user_id = v_src_account;
      perform public.hb_player_access_log(p_target, 'fusion : le compte de la fiche fondue est relié à la fiche gardée');
    end if;
  end if;
end $$;

-- ---------- 8. Un membre du staff qui devient joueur ----------

-- hb_set_role : reprise EXACTE de 051, plus le refus marqué « 052 » (affectations encore en place). Le passage à « joueur »
-- efface toujours le secteur et la fiche reliée, comme en 051. hb_update_member (015) l'appelle : même garde.
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
  -- 052 : un membre du staff encore affecté dans la structure ne devient pas joueur (ses affectations d'abord).
  if p_role = 'joueur' and (select role from public.hb_profiles where user_id = p_user) is distinct from 'joueur'
     and exists (select 1 from public.hb_assignments where not deleted and data ->> 'userId' = p_user::text) then
    raise exception 'Retire d’abord ses affectations (Structure) avant d’en faire un compte joueur.';
  end if;
  update public.hb_profiles
     set role = p_role,
         player_id = case when p_role = 'joueur' and role = 'joueur' then player_id end,
         player_linked_at = case when p_role = 'joueur' and role = 'joueur' then player_linked_at end,
         departments = case when p_role = 'joueur' then '{}'::text[] else departments end
   where user_id = p_user;
end $$;

-- hb_set_departments : reprise EXACTE de 010, plus la ligne marquée « 052 » : hb_update_member pose le secteur APRÈS le rôle ;
-- sans elle, un compte passé à « joueur » retrouvait le secteur envoyé par le formulaire.
create or replace function public.hb_set_departments(p_user uuid, p_departments text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.hb_profiles where user_id = auth.uid()) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  update public.hb_profiles
     set departments = coalesce((select array_agg(distinct upper(trim(d)) order by upper(trim(d)))
                                   from unnest(p_departments) d where trim(d) <> ''), '{}')
   where user_id = p_user
     and role is distinct from 'joueur'; -- 052 : un compte joueur n'a jamais de secteur
end $$;

-- ---------- 9. Droits des fonctions ----------

revoke all on function public.hb_self_line(jsonb, int) from public, anon, authenticated;
revoke all on function public.hb_self_note_text(text) from public, anon, authenticated;
revoke all on function public.hb_self_iso(timestamptz) from public, anon, authenticated;
revoke all on function public.hb_player_self_id() from public, anon, authenticated;
revoke all on function public.hb_player_self_write(text, jsonb) from public, anon, authenticated;
revoke all on function public.hb_player_self_keep() from public, anon, authenticated;
revoke all on function public.hb_player_journal_forget() from public, anon, authenticated;
revoke all on function public.hb_journal_note(public.hb_player_journal) from public, anon, authenticated;
-- Appelées par les règles de lecture (droits de l'utilisateur connecté) : ouvertes aux comptes connectés seulement.
revoke all on function public.hb_self_mood(text) from public, anon;
revoke all on function public.hb_staff_reads_player(text) from public, anon;
grant execute on function public.hb_self_mood(text) to authenticated;
grant execute on function public.hb_staff_reads_player(text) to authenticated;
revoke all on function public.hb_player_self_update(jsonb) from public, anon;
revoke all on function public.hb_player_journal_add(text, text) from public, anon;
revoke all on function public.hb_player_journal_edit(text, text, text) from public, anon;
revoke all on function public.hb_player_journal_share(text, boolean) from public, anon;
revoke all on function public.hb_player_journal_delete(text) from public, anon;
revoke all on function public.hb_player_mood_trend(text) from public, anon;
revoke all on function public.hb_create_player_account(text, text, text) from public, anon;
revoke all on function public.hb_self_merge(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.hb_create_player_account(text, text, text) to authenticated;
grant execute on function public.hb_player_self_update(jsonb) to authenticated;
grant execute on function public.hb_player_journal_add(text, text) to authenticated;
grant execute on function public.hb_player_journal_edit(text, text, text) to authenticated;
grant execute on function public.hb_player_journal_share(text, boolean) to authenticated;
grant execute on function public.hb_player_journal_delete(text) to authenticated;
grant execute on function public.hb_player_mood_trend(text) to authenticated;
-- hb_log, hb_merge_players, hb_set_role, hb_set_departments : droits inchangés (create or replace les garde).

-- Vérification : table, règles, fonctions et déclencheurs en place ; notes au total (et combien partagées).
select to_regclass('public.hb_player_journal') is not null as table_journal,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'hb_player_journal') as regles_sur_2,
       (select count(*) from pg_proc where proname in ('hb_player_journal_add', 'hb_player_journal_edit', 'hb_player_journal_share',
                                                      'hb_player_journal_delete', 'hb_player_mood_trend', 'hb_create_player_account')) as fonctions_sur_6,
       (select count(*) from pg_trigger where tgname in ('hb_b_player_self_keep', 'hb_player_journal_forget') and not tgisinternal) as declencheurs_sur_2,
       (select count(*) from public.hb_player_journal where not deleted) as notes,
       (select count(*) from public.hb_player_journal where not deleted and shared) as notes_partagees;
