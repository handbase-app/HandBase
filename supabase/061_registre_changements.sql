-- HandBase : REGISTRE DES CHANGEMENTS (« quoi de neuf ? » en une lecture d'index), droits du direct calculés une fois,
-- signe de vie porté par la synchronisation, annonce de charge par la base.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 060_push_veille.sql (base de test d'abord, puis la réelle).
-- Peut être relancé sans risque (create … if not exists, create or replace, create or replace trigger). Additif : aucune
-- fonction existante n'est retirée ni changée (hb_filet, hb_quoi_de_neuf, hb_mes_canaux, hb_ping restent pour les appareils
-- d'avant) ; seules les deux règles hb_recevoir / hb_emettre de realtime.messages sont reposées (mêmes droits, voir 2).
--
-- POURQUOI (série 10 du 30/10, 10 000 personnes, jour de détection réaliste, 16 cœurs : la base fait la moitié du travail) :
-- requêtes les plus coûteuses de la journée : hb_filet 35 995 × 26,8 ms = 963 s ; autorisation des canaux du direct
-- (règles de realtime.messages, hb_mes_canaux à chaque abonnement) 46 972 × 11,5 ms = 542 s ; hb_lire_perimetre 356 s ;
-- identifiants hb_events?select=id 11 245 × 24,9 ms = 280 s ; hb_ping 224 313 appels (58 % des requêtes HTTP) ;
-- hb_my_perimeter 158 s. But : tenir 10 000 personnes sur 8 cœurs, sans rien perdre de ce que voient les appareils.
--
-- 1) VERSION DES DROITS (hb_droits_version, hb_droits_compte) : un compteur général, augmenté par toute écriture dans la
--    structure (hb_units, hb_levels), et un compteur PAR COMPTE, augmenté quand son profil change de rôle ou de fiche joueur
--    (hb_profiles : role, player_id ; création, suppression) ou quand une de SES affectations change (hb_assignments, ancien
--    et nouveau data.userId). Ce sont TOUTES les données lues par hb_mes_canaux() et hb_has_role() (hb_scope_of de 046/047 :
--    affectations du compte, unités, niveaux, rôle « admin » du profil ; hb_unit_empty : unités ; hb_player_dept, hb_arr :
--    immuables). Écritures rares (structure, gestion des membres) : la ligne unique n'est jamais une ligne chaude. Un futur
--    script qui récrit hb_mes_canaux, hb_scope_of ou hb_has_role doit finir par « select public.hb_droits_invalider(); »
--    (ce script le fait à la fin).
-- 2) DROITS DU DIRECT CALCULÉS UNE FOIS (hb_canaux_cache) : les canaux de chaque compte (hb_mes_canaux()) et son droit
--    d'émettre (hb_has_role()), gardés avec les deux versions lues AVANT le calcul. Les règles de realtime.messages
--    (hb_recevoir, hb_emettre de 057) lisent désormais hb_canaux_rapides() / hb_emetteur_rapide() : la ligne gardée si ses
--    deux versions sont les versions actuelles (trois lectures par clé primaire), sinon le calcul complet, comme avant.
--    MÊMES DROITS, par construction : la valeur gardée est celle que rendrait hb_mes_canaux() maintenant, puisque rien de ce
--    qu'elle lit n'a changé depuis (sinon une version aurait bougé ; une version lue avant le calcul ne peut pas être plus
--    récente que les données lues par le calcul). Aucun canal de plus, aucun de moins (vérifié compte par compte par
--    tools/essai-sql-061). Remplissage : hb_mes_canaux_memo() (appelée par l'appli au lieu de hb_mes_canaux avant de
--    s'abonner) et hb_registre_depuis (ci-dessous) ; jamais par les règles elles-mêmes (Realtime annule la transaction de
--    son contrôle). Appareils d'avant (hb_mes_canaux) : pas de ligne gardée pour eux tant qu'aucune version nouvelle ne l'a
--    remplie : le calcul complet, comme avant (rien de plus lent).
-- 3) REGISTRE (hb_registre) : à chaque écriture dans une des 19 tables synchronisées (déclencheurs PAR INSTRUCTION, avec
--    tables de transition : un envoi ou un import d'une instruction = un seul INSERT … SELECT), une ligne par (ligne écrite,
--    canal qui la lit) : identifiant de la transaction (xid8), canal (hb:club:…, hb:dept:…, hb:compte:…, hb:staff, hb:tout,
--    hb:commun, hb:joueur:… : les PORTÉES du direct, calculées par hb_canaux_ligne de 057, la même règle que les signaux,
--    jamais moins que ce que les règles de lecture laissent voir), table, identifiant de la ligne, heure serveur (µs),
--    empreinte de la ligne (joueurs, mesures, avis, « vu » seulement : la formule de 059), et « perte » pour les canaux qui
--    lisaient la ligne avant l'écriture et ne la lisent plus (mutation hors du club, groupe rendu privé, suppression) :
--    les PIERRES TOMBALES, qui remplacent les relectures d'identifiants visibles (hb_events?select=id…).
--    CONTENTION (scénario dur : ~300 écritures/s) : journal en AJOUT SEUL, aucune ligne mise à jour par les écritures ;
--    la séquence n'est pas utilisée (xid8 de la transaction, sans verrou), un seul index b-tree (canal, x) et un index
--    BRIN (at) pour la purge (quelques octets). Coût : quelques lignes courtes par écriture, dans la transaction de
--    l'écriture. (Une ligne par portée « mise à jour au plus une fois par seconde » aurait demandé un verrou ou un « upsert »
--    par écriture sur des lignes très partagées, hb:staff ou hb:tout, et n'aurait pas dit QUELLES lignes ont changé.)
-- 4) hb_registre_depuis(curseur) : « quoi de neuf depuis mon curseur ? » en une lecture d'index par canal du compte :
--     { c: nouveau curseur (xmin de l'instantané : toute transaction plus ancienne est terminée), t: heure serveur,
--       complet: le registre couvre tout depuis le curseur, canaux: les canaux du compte (cache de 2),
--       e: { table: [[id, heure µs, empreinte|null, perte 0|1], …] ou { trop: n, depuis: heure µs la plus ancienne } },
--       k: niveau de charge annoncé (6), seulement s'il y en a un }
--    L'appareil (src/registre.ts, src/sync.ts) compare chaque ligne citée à ce qu'il a déjà (registre du filet de 059 :
--    même identifiant, même heure, même empreinte → rien à faire ; ligne reçue en direct ainsi confirmée), relit par
--    identifiant les autres (id=in.(…), sous ses règles de lecture : absente = plus visible, retirée de l'appareil), et ne
--    relit par curseur que les tables « trop ». Pas complet (curseur absent, trop ancien, purgé, ou plus de 20 000 lignes
--    citées) : l'appareil fait le filet de 059 (hb_filet), comme avant, et garde le nouveau curseur.
--    CURSEUR SÛR : c = xmin de l'instantané pris AVANT la lecture ; la lecture voit toutes les transactions terminées
--    avant c ; une transaction encore en cours (ligne validée en retard) a un xid >= c : elle sera citée au passage suivant,
--    quelle que soit l'heure serveur de ses lignes. Une ligne peut être citée deux fois (transaction terminée entre deux
--    instantanés) : sans effet (déjà sur l'appareil).
--    SÉCURITÉ : SECURITY DEFINER (nécessaire : la table du registre n'est lisible par personne directement, sinon un compte
--    pourrait la parcourir sans borne) ; les canaux sont ceux du compte connecté (cache de 2 = hb_mes_canaux), jamais un
--    paramètre ; elle ne rend que des identifiants, des heures et des empreintes de lignes, sur les canaux que le compte
--    écoute DÉJÀ en direct, où les signaux de 057 portent les mêmes identifiants ({t, id, v}) et, pour joueurs, mesures,
--    avis, « vu », la ligne entière (le compte peut la lire : règle staff_read de 046 = canaux du périmètre). L'empreinte
--    n'est donnée que pour ces 4 tables. search_path fixé ; anon : rien.
--    SIGNE DE VIE (p_session, p_appareil, facultatifs) : comme hb_ping (030), dans le même appel (plus de requête à part
--    toutes les 30 s : src/presence.ts).
-- 5) PURGE : hb_registre_purger(garder, max) efface les lignes plus anciennes que « garder » (2 jours par défaut ; un
--    appareil absent plus longtemps fait le filet de 059) et note le plus grand xid effacé (curseurs plus anciens : « pas
--    complet »). Relançable ; tâche pg_cron prévue en commentaire, NON ACTIVÉE (section « ACTIVATION »).
-- 6) CHARGE : hb_charge_etat (une ligne), hb_annoncer_charge(niveau, ttl) (administrateur ou SQL : la ligne + realtime.send
--    « charge » sur hb:commun, que les appareils lisent déjà, src/charge.ts) et hb_surveiller_charge(seuils) (SQL / pg_cron :
--    requêtes actives / max_connections, avec retour lent). Le niveau en cours voyage aussi dans la réponse du registre
--    (champ k) : il arrive même là où les messages envoyés par la base ne sont pas distribués (Realtime auto-hébergé, 057).
--    NON ACTIVÉE (section « ACTIVATION »).
--
-- COMPATIBILITÉ : les appareils d'avant ne voient aucune différence (hb_filet, hb_quoi_de_neuf, hb_mes_canaux, hb_ping, les
-- signaux : inchangés ; les règles du direct rendent les mêmes droits). L'appli nouvelle sur un serveur sans 061 (fonction
-- absente) garde le filet de 059 et hb_ping, et redemande une heure plus tard. Écritures faites déclencheurs coupés
-- (session_replication_role = replica : imports par SQL) : pas dans le registre, comme elles ne font pas de signal ; le filet
-- rare de 059 (une fois par jour) les rattrape.
-- MESURE (tools/essai-sql-061/lancer.sh --mesure : Postgres 16 jetable, jeu fictif de 10 000 comptes, 20 000 affectations,
-- 1 070 unités, 100 000 joueurs, 500 000 mesures ; matinée de 25 000 écritures puis 5 minutes au rythme du jour réaliste à
-- 10 000 personnes, 4 300 écritures ; EXPLAIN ANALYZE, médiane de 5, cache chaud, machine sans autre charge) :
--   « quoi de neuf ? » toutes les 5 min      hb_filet (059)   hb_registre_depuis (061)
--     compte de club (2 clubs)                 3,4-3,8 ms       0,28-0,35 ms   (10 lignes citées)       11 à 12 fois moins
--     comité (1 département + 1 club)          4,3-5,1 ms       0,27-0,32 ms   (43 lignes citées)       16 fois moins
--     ligue (2 ligues, ~14 départements)       5,8-7,2 ms       2,0-3,1 ms     (180 à 656 lignes)       2,4 à 2,9 fois moins
--     administrateur (canal hb:tout)           3,1-3,4 ms       7,6-11,8 ms    (mesures, « vu » : trop) plus cher, mais ~0,2 % des comptes
--   contrôle d'un abonnement au direct       règles de 057    règles de 061
--     club / comité / ligue / administrateur   1,1-1,8 / 1,3-1,7 / 3,0-3,7 / 13-15 ms   0,07-0,10 ms (16 à 170 fois moins)
--   écriture d'une mesure (hb_upsert_lignes)  0,76-0,82 ms sans registre, 0,87-0,90 ms avec (+0,1 ms) ; 4,8 lignes de registre
--     par écriture, 142 octets chacune index compris (~270 Mo par jour de détection réaliste à 10 000 personnes, purgés après 2 jours).
--   (Série 10 sous charge : hb_filet 26,8 ms, contrôle d'abonnement 11,5 ms en moyenne ; les rapports ci-dessus valent pour la
--   charge, pas les valeurs absolues.)
-- Dépend de : 030 (hb_connections), 046/047 (hb_scope_of, colonnes scope_*), 051 (hb_profiles.player_id), 057
-- (hb_canaux_ligne, hb_mes_canaux, règles du direct), 059 (formule d'empreinte). Postgres 14+ (create or replace trigger,
-- xid8 : 13+).
-- Annulation : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 1. Version des droits ----------

create table if not exists public.hb_droits_version (
  id smallint primary key default 1 check (id = 1),
  v bigint not null default 1,
  at timestamptz not null default now()
);
insert into public.hb_droits_version (id) values (1) on conflict (id) do nothing;
create table if not exists public.hb_droits_compte (
  user_id text primary key,
  v bigint not null default 1,
  at timestamptz not null default now()
);
-- Lues seulement par les fonctions ci-dessous (SECURITY DEFINER) : aucune règle, aucun droit (Supabase en donne par défaut).
alter table public.hb_droits_version enable row level security;
alter table public.hb_droits_compte enable row level security;
revoke all on public.hb_droits_version, public.hb_droits_compte from public, anon, authenticated;

-- Tout invalider (structure : unités, niveaux ; ou script qui récrit les fonctions de périmètre). SQL seulement.
create or replace function public.hb_droits_invalider() returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.hb_droits_version set v = v + 1, at = now() where id = 1
$$;
revoke all on function public.hb_droits_invalider() from public, anon, authenticated;

-- Invalider des comptes (affectations, profil). Une ligne par compte touché, jamais une ligne commune.
create or replace function public.hb_droits_comptes(p_users text[]) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.hb_droits_compte (user_id)
  select distinct u from unnest(p_users) u where coalesce(u, '') <> ''
  on conflict (user_id) do update set v = hb_droits_compte.v + 1, at = now()
$$;
revoke all on function public.hb_droits_comptes(text[]) from public, anon, authenticated;

-- Déclencheurs : structure → tout ; affectations → comptes cités (avant et après) ; profil → ce compte.
create or replace function public.hb_droits_changes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_TABLE_NAME = 'hb_assignments' and TG_OP <> 'TRUNCATE' then
    if TG_OP = 'INSERT' then
      perform public.hb_droits_comptes(array(select n.data ->> 'userId' from nouv n));
    elsif TG_OP = 'UPDATE' then
      perform public.hb_droits_comptes(array(select n.data ->> 'userId' from nouv n union select o.data ->> 'userId' from anc o));
    else
      perform public.hb_droits_comptes(array(select o.data ->> 'userId' from anc o));
    end if;
  elsif TG_TABLE_NAME = 'hb_profiles' and TG_OP <> 'TRUNCATE' then
    perform public.hb_droits_comptes(array[case when TG_OP = 'DELETE' then old.user_id::text else new.user_id::text end]);
  else
    perform public.hb_droits_invalider();
  end if;
  return null;
end $$;
revoke all on function public.hb_droits_changes() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['units', 'levels'] loop
    if to_regclass('public.hb_' || t) is null then continue; end if; -- 044 pas passé
    execute format('create or replace trigger hb_droits after insert or update or delete on public.hb_%1$s
                      for each statement execute function public.hb_droits_changes()', t);
    execute format('create or replace trigger hb_droits_vider after truncate on public.hb_%1$s
                      for each statement execute function public.hb_droits_changes()', t);
  end loop;
  if to_regclass('public.hb_assignments') is not null then
    create or replace trigger hb_droits_ins after insert on public.hb_assignments referencing new table as nouv
      for each statement execute function public.hb_droits_changes();
    create or replace trigger hb_droits_upd after update on public.hb_assignments referencing old table as anc new table as nouv
      for each statement execute function public.hb_droits_changes();
    create or replace trigger hb_droits_del after delete on public.hb_assignments referencing old table as anc
      for each statement execute function public.hb_droits_changes();
    create or replace trigger hb_droits_vider after truncate on public.hb_assignments
      for each statement execute function public.hb_droits_changes();
  end if;
end $$;
-- Profil : seulement quand le rôle ou la fiche joueur changent vraiment (027 et 060 réécrivent d'autres colonnes chaque
-- nuit : sans effet ici) ; création et suppression d'un compte.
create or replace trigger hb_droits_profil after update of role, player_id on public.hb_profiles
  for each row when (old.role is distinct from new.role or old.player_id is distinct from new.player_id)
  execute function public.hb_droits_changes();
create or replace trigger hb_droits_profil_ajout after insert or delete on public.hb_profiles
  for each row execute function public.hb_droits_changes();
create or replace trigger hb_droits_vider after truncate on public.hb_profiles
  for each statement execute function public.hb_droits_changes();

-- ---------- 2. Droits du direct calculés une fois ----------

create table if not exists public.hb_canaux_cache (
  user_id text primary key,
  vg bigint not null,         -- version générale lue avant le calcul
  vu bigint not null,         -- version du compte lue avant le calcul (0 : jamais changée)
  canaux text[] not null,     -- hb_mes_canaux()
  emetteur boolean not null,  -- hb_has_role()
  at timestamptz not null default now()
);
alter table public.hb_canaux_cache enable row level security;
revoke all on public.hb_canaux_cache from public, anon, authenticated;

-- Ligne gardée du compte connecté, si elle est À JOUR (ses deux versions sont les actuelles) ; sinon aucune ligne.
create or replace function public.hb_canaux_garde() returns table (canaux text[], emetteur boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.canaux, c.emetteur
    from public.hb_canaux_cache c
   where c.user_id = auth.uid()::text
     and c.vg = (select v.v from public.hb_droits_version v where v.id = 1)
     and c.vu = coalesce((select d.v from public.hb_droits_compte d where d.user_id = auth.uid()::text), 0)
$$;
revoke all on function public.hb_canaux_garde() from public, anon, authenticated;

-- Pour les règles du direct : canaux du compte (ligne à jour, sinon le calcul complet de 057).
create or replace function public.hb_canaux_rapides() returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text[];
begin
  if auth.uid() is null then return '{}'::text[]; end if;
  select g.canaux into v from public.hb_canaux_garde() g;
  if found then return v; end if;
  return public.hb_mes_canaux();
end $$;
create or replace function public.hb_emetteur_rapide() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v boolean;
begin
  if auth.uid() is null then return false; end if;
  select g.emetteur into v from public.hb_canaux_garde() g;
  if found then return v; end if;
  return public.hb_has_role();
end $$;
revoke all on function public.hb_canaux_rapides() from public, anon;
revoke all on function public.hb_emetteur_rapide() from public, anon;
grant execute on function public.hb_canaux_rapides() to authenticated;   -- appelées par les règles, avec le jeton du compte
grant execute on function public.hb_emetteur_rapide() to authenticated;

-- Calcule et garde (versions lues AVANT le calcul : une écriture concurrente rend la ligne périmée, jamais fausse).
-- VOLATILE (elle écrit) : appelée par hb_mes_canaux_memo et hb_registre_depuis, jamais par une règle.
create or replace function public.hb_canaux_memo() returns text[]
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid text := auth.uid()::text;
  v_g bigint;
  v_u bigint;
  v_c text[];
  v_e boolean;
begin
  if v_uid is null then return '{}'::text[]; end if;
  select g.canaux into v_c from public.hb_canaux_garde() g;
  if found then return v_c; end if;
  v_g := (select v from public.hb_droits_version where id = 1);
  v_u := coalesce((select v from public.hb_droits_compte where user_id = v_uid), 0);
  v_c := public.hb_mes_canaux();
  v_e := public.hb_has_role();
  insert into public.hb_canaux_cache as c (user_id, vg, vu, canaux, emetteur)
  values (v_uid, v_g, v_u, v_c, v_e)
  on conflict (user_id) do update set vg = excluded.vg, vu = excluded.vu, canaux = excluded.canaux, emetteur = excluded.emetteur, at = now()
   where c.vg <= excluded.vg and c.vu <= excluded.vu; -- jamais une ligne plus ancienne par-dessus une plus récente
  return v_c;
end $$;
revoke all on function public.hb_canaux_memo() from public, anon, authenticated;

-- Pour l'appli (avant de s'abonner) : exactement hb_mes_canaux(), et la ligne gardée pour les contrôles de Realtime qui suivent.
create or replace function public.hb_mes_canaux_memo() returns text[]
language sql volatile security definer set search_path = public, pg_temp as $$
  select public.hb_canaux_memo()
$$;
revoke all on function public.hb_mes_canaux_memo() from public, anon;
grant execute on function public.hb_mes_canaux_memo() to authenticated;

-- Règles du direct (057, section 5) reposées sur les fonctions rapides : mêmes conditions, même forme (select …) calculée
-- une fois par requête. Non propriétaire de realtime.messages : avertissement, les règles de 057 restent (rien ne casse,
-- seulement plus lent) ; repasser ce bloc en super-utilisateur (supabase_admin).
do $$
begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise notice 'realtime.messages ou realtime.topic() absent : pas de canaux privés sur cette base (Postgres nu, ou Realtime trop ancien).';
    return;
  end if;
  begin
    execute 'drop policy if exists "hb_recevoir" on realtime.messages';
    execute 'drop policy if exists "hb_emettre" on realtime.messages';
    execute $p$create policy "hb_recevoir" on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast' and realtime.topic() = any ((select public.hb_canaux_rapides())::text[]))$p$;
    execute $p$create policy "hb_emettre" on realtime.messages for insert to authenticated
      with check (realtime.messages.extension = 'broadcast' and realtime.topic() = any ((select public.hb_canaux_rapides())::text[]) and (select public.hb_emetteur_rapide()))$p$;
  exception when others then
    raise warning 'Règles hb_recevoir / hb_emettre non reposées sur realtime.messages (%) : celles de 057 restent ; repasser ce bloc en super-utilisateur.', sqlerrm;
  end;
end $$;

-- ---------- 3. Registre ----------

create table if not exists public.hb_registre (
  x xid8 not null,                  -- transaction de l'écriture
  canal text not null,              -- portée (canal du direct) qui lit la ligne
  tbl text not null,                -- table sans « hb_ » (players…)
  ligne text not null,              -- identifiant de la ligne
  us bigint,                        -- heure serveur de la ligne (µs depuis 1970)
  h text,                           -- empreinte (joueurs, mesures, avis, « vu »), formule de 059
  perte boolean not null default false, -- ce canal ne lit plus la ligne (pierre tombale)
  at timestamptz not null default now()
);
create index if not exists hb_registre_canal on public.hb_registre (canal, x);
create index if not exists hb_registre_at on public.hb_registre using brin (at);
alter table public.hb_registre enable row level security;
revoke all on public.hb_registre from public, anon, authenticated;

-- depuis_x : transaction de création du registre (un curseur plus ancien vient d'un registre effacé puis recréé : pas
-- complet) ; purge_x : plus grand xid effacé par la purge.
create table if not exists public.hb_registre_etat (
  id smallint primary key default 1 check (id = 1),
  depuis_x xid8 not null default pg_current_xact_id(),
  purge_x xid8 not null default '0'::xid8,
  purge_at timestamptz
);
insert into public.hb_registre_etat (id) values (1) on conflict (id) do nothing;
alter table public.hb_registre_etat enable row level security;
revoke all on public.hb_registre_etat from public, anon, authenticated;

-- Une instruction d'écriture → ses lignes du registre (un INSERT … SELECT). Canaux d'une ligne : hb_canaux_ligne (057),
-- sur la ligne entière telle qu'enregistrée (colonnes scope_* comprises). Mise à jour : canaux de la nouvelle ligne, plus,
-- en « perte », ceux de l'ancienne qui ne la lisent plus. Suppression : « perte » sur tous les canaux de l'ancienne.
create or replace function public.hb_registre_noter() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rel text := TG_TABLE_NAME;
  v_t text := substr(TG_TABLE_NAME, 4);
  v_contenu boolean := substr(TG_TABLE_NAME, 4) in ('players', 'measurements', 'evaluations', 'seen');
  v_x xid8 := pg_current_xact_id();
begin
  if TG_OP = 'INSERT' then
    insert into public.hb_registre (x, canal, tbl, ligne, us, h, perte)
    select v_x, c.canal, v_t, n.id, n.us,
           case when v_contenu then left(encode(sha256(convert_to(n.id || E'\n' || n.us::text || E'\n' || n.data::text, 'UTF8')), 'hex'), 16) end,
           false
      from (select r.id, r.data, (extract(epoch from r.server_updated_at) * 1000000)::bigint as us, to_jsonb(r) as j from nouv r) n
      cross join lateral unnest(public.hb_canaux_ligne(v_rel, n.j)) c(canal);
  elsif TG_OP = 'UPDATE' then
    insert into public.hb_registre (x, canal, tbl, ligne, us, h, perte)
    select v_x, c.canal, v_t, k.id, k.us,
           case when v_contenu and not c.perte and k.data is not null
                then left(encode(sha256(convert_to(k.id || E'\n' || k.us::text || E'\n' || k.data::text, 'UTF8')), 'hex'), 16) end,
           c.perte
      from (select coalesce(n.id, o.id) as id, n.data,
                   (extract(epoch from coalesce(n.server_updated_at, o.server_updated_at)) * 1000000)::bigint as us,
                   case when n.id is null then '{}'::text[] else public.hb_canaux_ligne(v_rel, to_jsonb(n)) end as cn,
                   case when o.id is null then '{}'::text[] else public.hb_canaux_ligne(v_rel, to_jsonb(o)) end as co
              from anc o full join nouv n on n.id = o.id) k
      cross join lateral (select x, false from unnest(k.cn) x
                          union all
                          select x, true from unnest(k.co) x where not (x = any (k.cn))) c(canal, perte);
  else
    insert into public.hb_registre (x, canal, tbl, ligne, us, h, perte)
    -- (Heure : celle de la suppression, plus récente que toute version de la ligne : c'est la dernière.)
    select v_x, c.canal, v_t, o.id, (extract(epoch from clock_timestamp()) * 1000000)::bigint, null, true
      from anc o cross join lateral unnest(public.hb_canaux_ligne(v_rel, to_jsonb(o))) c(canal);
  end if;
  return null;
end $$;
revoke all on function public.hb_registre_noter() from public, anon, authenticated;

-- Les 19 tables synchronisées (src/db.ts, SYNC_TABLES ; même liste que hb_filet). « create or replace trigger » : jamais
-- d'instant sans déclencheur quand le script est relancé (une écriture y manquerait au registre).
do $$
declare t text;
begin
  foreach t in array array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
                           'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log',
                           'saved_questions'] loop
    if to_regclass('public.hb_' || t) is null then continue; end if;
    execute format('create or replace trigger hb_registre_ins after insert on public.hb_%1$s referencing new table as nouv
                      for each statement execute function public.hb_registre_noter()', t);
    execute format('create or replace trigger hb_registre_upd after update on public.hb_%1$s referencing old table as anc new table as nouv
                      for each statement execute function public.hb_registre_noter()', t);
    execute format('create or replace trigger hb_registre_del after delete on public.hb_%1$s referencing old table as anc
                      for each statement execute function public.hb_registre_noter()', t);
  end loop;
end $$;

-- ---------- 4. « Quoi de neuf depuis mon curseur ? » ----------

-- Voir le point 4 de l'en-tête. p_curseur : le « c » de la réponse précédente (texte), null au premier appel.
-- Plafonds : 500 lignes citées par table (au-delà : { trop, depuis } ; le plafond d'empreinte de 059), 20 000 lignes du
-- registre lues par canal (au-delà : pas complet, l'appareil fait le filet de 059).
create or replace function public.hb_registre_depuis(p_curseur text, p_session uuid default null, p_appareil text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_par_table constant integer := 500;
  v_brut constant integer := 20000;
  v_snap pg_snapshot;
  v_c xid8;
  v_cur xid8;
  v_etat record;
  v_canaux text[];
  v_complet boolean;
  v_plein boolean;
  v_e jsonb;
  v_k jsonb;
  v_out jsonb;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  -- Signe de vie (030, hb_ping) : même règle (un compte du staff, sa propre session seulement).
  if p_session is not null and public.hb_has_role() then
    insert into public.hb_connections (session_id, user_id, device)
    values (p_session, v_uid, left(p_appareil, 60))
    on conflict (session_id) do update set last_seen_at = now(), device = excluded.device
     where hb_connections.user_id = excluded.user_id;
  end if;
  v_canaux := public.hb_canaux_memo();
  -- Instantané AVANT la lecture (voir CURSEUR SÛR).
  v_snap := pg_current_snapshot();
  v_c := pg_snapshot_xmin(v_snap);
  begin
    v_cur := nullif(btrim(p_curseur), '')::xid8;
  exception when others then
    v_cur := null; -- curseur illisible : pas complet
  end;
  select depuis_x, purge_x into v_etat from public.hb_registre_etat where id = 1;
  v_complet := v_cur is not null and v_etat.depuis_x is not null and v_cur >= v_etat.depuis_x and v_cur > v_etat.purge_x
               and v_cur <= pg_snapshot_xmax(v_snap);
  if v_complet then
    -- Une lecture d'index (canal, x) par canal du compte, bornée ; puis, par ligne citée : sa dernière heure, l'empreinte de
    -- cette version (une « perte » n'en a pas), « perte » seulement si, pour cette dernière version, TOUS les canaux du compte
    -- qui la citent l'ont perdue (encore lue par un autre canal : simple changement). Un canal plein (plus de v_brut lignes) :
    -- pas complet.
    with lu as materialized (
      select m.canal, e.tbl, e.ligne, e.us, e.h, e.perte
        from unnest(v_canaux) m(canal)
        cross join lateral (select r.tbl, r.ligne, r.us, r.h, r.perte from public.hb_registre r
                             where r.canal = m.canal and r.x >= v_cur limit v_brut + 1) e),
    -- Tables « trop » d'abord (compte seul) : leurs lignes ne sont ni regroupées ni mises en JSON.
    n as (
      select l.tbl, count(distinct l.ligne) as n, min(l.us) as depuis from lu l group by l.tbl),
    g as (
      select l.tbl, l.ligne, max(l.us) as us, (array_agg(l.h order by l.us desc nulls last, l.perte))[1] as h,
             (array_agg(l.perte order by l.us desc nulls last, l.perte))[1] as perte
        from lu l join n on n.tbl = l.tbl and n.n <= v_par_table
       group by l.tbl, l.ligne),
    s as (
      select g.tbl, jsonb_agg(jsonb_build_array(g.ligne, g.us, g.h, case when g.perte then 1 else 0 end) order by g.us, g.ligne) as lignes
        from g group by g.tbl)
    select exists (select 1 from lu group by lu.canal having count(*) > v_brut),
           coalesce(jsonb_object_agg(n.tbl, case when n.n > v_par_table then jsonb_build_object('trop', n.n, 'depuis', n.depuis) else s.lignes end), '{}'::jsonb)
      into v_plein, v_e
      from n left join s on s.tbl = n.tbl;
    if v_plein then v_complet := false; end if;
  end if;
  -- Niveau de charge annoncé (6), s'il court encore.
  if to_regclass('public.hb_charge_etat') is not null then
    select jsonb_build_object('niveau', niveau, 'ttl', ceil(extract(epoch from jusqua - now()))::integer) into v_k
      from public.hb_charge_etat where id = 1 and niveau <> 'calme' and jusqua > now();
  end if;
  v_out := jsonb_build_object('c', v_c::text, 't', now(), 'complet', v_complet, 'canaux', to_jsonb(v_canaux));
  if v_complet then v_out := v_out || jsonb_build_object('e', v_e); end if;
  if v_k is not null then v_out := v_out || jsonb_build_object('k', v_k); end if;
  return v_out;
end $$;
revoke all on function public.hb_registre_depuis(text, uuid, text) from public, anon;
grant execute on function public.hb_registre_depuis(text, uuid, text) to authenticated;

-- ---------- 5. Purge ----------

-- Efface au plus p_max lignes plus anciennes que p_garder (relancer tant que le résultat vaut p_max) ; note le plus grand
-- xid effacé dans la même transaction (un curseur antérieur devient « pas complet »). SQL / pg_cron seulement.
create or replace function public.hb_registre_purger(p_garder interval default interval '2 days', p_max integer default 200000)
returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
  v_x xid8;
begin
  with d as (
    delete from public.hb_registre
     where ctid in (select ctid from public.hb_registre where at < now() - greatest(p_garder, interval '10 minutes')
                     limit greatest(coalesce(p_max, 0), 1))
    returning x)
  select count(*)::integer, (select x from d order by x desc limit 1) into v_n, v_x from d;
  if v_n > 0 then
    update public.hb_registre_etat set purge_x = greatest(purge_x, v_x), purge_at = now() where id = 1;
  end if;
  return v_n;
end $$;
revoke all on function public.hb_registre_purger(interval, integer) from public, anon, authenticated;

-- ---------- 6. Charge annoncée par la base ----------

create table if not exists public.hb_charge_etat (
  id smallint primary key default 1 check (id = 1),
  niveau text not null default 'calme' check (niveau in ('calme', 'charge', 'sature')),
  jusqua timestamptz not null default now(),
  sous_depuis timestamptz,     -- mesure sous le seuil du niveau en cours depuis (retour lent)
  mesure jsonb,                -- dernière mesure (contrôle)
  at timestamptz not null default now()
);
insert into public.hb_charge_etat (id) values (1) on conflict (id) do nothing;
alter table public.hb_charge_etat enable row level security;
revoke all on public.hb_charge_etat from public, anon, authenticated;

-- Annonce un niveau (calme, charge, sature) pour p_ttl secondes (15 min au plus : une annonce oubliée s'éteint seule) :
-- ligne de hb_charge_etat (lue par hb_registre_depuis) et message « charge » sur hb:commun (src/charge.ts, lireAnnonce).
-- Administrateur connecté, ou SQL direct (comme hb_annoncer_version).
create or replace function public.hb_annoncer_charge(p_niveau text, p_ttl integer default 300) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_n text := lower(translate(coalesce(btrim(p_niveau), ''), 'éÉ', 'ee'));
  v_ttl integer := least(greatest(coalesce(p_ttl, 300), 1), 900);
begin
  if v_uid is not null and (select role from public.hb_profiles where user_id = v_uid) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  if v_n not in ('calme', 'charge', 'sature') then raise exception 'Niveau attendu : calme, charge ou sature'; end if;
  update public.hb_charge_etat set niveau = v_n, jusqua = now() + make_interval(secs => v_ttl), at = now() where id = 1;
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null then
    perform realtime.send(jsonb_build_object('niveau', v_n, 'ttl', v_ttl), 'charge', 'hb:commun', true);
  end if;
end $$;
revoke all on function public.hb_annoncer_charge(text, integer) from public, anon;
grant execute on function public.hb_annoncer_charge(text, integer) to authenticated;

-- Surveillance (SQL / pg_cron toutes les 15 à 30 s, NON ACTIVÉE) : requêtes actives des clients / max_connections ;
-- au-dessus de p_charge : « charge », de p_sature : « sature » (montée immédiate) ; retour d'un cran seulement après
-- p_retour_s secondes sous le seuil du niveau en cours ; annonce répétée (ttl p_ttl) tant que le niveau n'est pas calme.
-- Rend le niveau. Voit les requêtes des autres rôles s'il est propriétaire avec pg_read_all_stats (Supabase : postgres) ;
-- sinon il ne compte que les siennes (toujours « calme » : sans danger).
create or replace function public.hb_surveiller_charge(p_charge numeric default 0.30, p_sature numeric default 0.60,
                                                        p_retour_s integer default 120, p_ttl integer default 120)
returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actives integer;
  v_max integer := current_setting('max_connections')::integer;
  v_ratio numeric;
  v_cible text;
  v_etat record;
  v_nouveau text;
  rang constant text[] := array['calme', 'charge', 'sature'];
begin
  select count(*)::integer into v_actives
    from pg_stat_activity
   where state = 'active' and backend_type = 'client backend' and pid <> pg_backend_pid();
  v_ratio := v_actives::numeric / greatest(v_max, 1);
  v_cible := case when v_ratio >= p_sature then 'sature' when v_ratio >= p_charge then 'charge' else 'calme' end;
  select * into v_etat from public.hb_charge_etat where id = 1 for update;
  if v_etat.jusqua <= now() then v_etat.niveau := 'calme'; end if; -- annonce échue
  if array_position(rang, v_cible) >= array_position(rang, v_etat.niveau) then
    v_nouveau := v_cible;
    update public.hb_charge_etat set sous_depuis = null where id = 1;
  elsif v_etat.sous_depuis is null then
    v_nouveau := v_etat.niveau;
    update public.hb_charge_etat set sous_depuis = now() where id = 1;
  elsif now() - v_etat.sous_depuis >= make_interval(secs => p_retour_s) then
    v_nouveau := rang[array_position(rang, v_etat.niveau) - 1];
    update public.hb_charge_etat set sous_depuis = null where id = 1;
  else
    v_nouveau := v_etat.niveau;
  end if;
  update public.hb_charge_etat
     set mesure = jsonb_build_object('actives', v_actives, 'max_connections', v_max, 'ratio', round(v_ratio, 3), 'cible', v_cible, 'a', now())
   where id = 1;
  if v_nouveau <> 'calme' or v_etat.niveau <> 'calme' then
    perform public.hb_annoncer_charge(v_nouveau, p_ttl);
  end if;
  return v_nouveau;
end $$;
revoke all on function public.hb_surveiller_charge(numeric, numeric, integer, integer) from public, anon, authenticated;

-- ---------- 7. Fin : canaux gardés à recalculer (fonctions de périmètre peut-être récrites par un script récent) ----------
select public.hb_droits_invalider();

-- ---------- Vérification (lecture seule) ----------
-- Attendu : fonctions_10 = 10 ; declencheurs_registre = 3 × tables présentes (57 avec les 19) ; declencheurs_droits = 11 ;
-- regles_rapides = t sur Supabase (f sur un Postgres nu, sans realtime.messages) ; registre_definer et memo_definer = t ;
-- anon_rien = t ; tables_fermees = t ; etat = t ; anciennes = t (hb_filet, hb_quoi_de_neuf, hb_mes_canaux, hb_ping).
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('hb_droits_invalider', 'hb_droits_comptes', 'hb_droits_changes', 'hb_canaux_garde',
                'hb_canaux_rapides', 'hb_emetteur_rapide', 'hb_canaux_memo', 'hb_mes_canaux_memo', 'hb_registre_noter',
                'hb_registre_depuis')) as fonctions_10,
       (select count(*) from pg_trigger where tgname in ('hb_registre_ins', 'hb_registre_upd', 'hb_registre_del') and not tgisinternal) as declencheurs_registre,
       (select count(*) from pg_trigger where tgname like 'hb_droits%' and not tgisinternal) as declencheurs_droits,
       exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'hb_recevoir'
                and qual like '%hb_canaux_rapides%') as regles_rapides,
       (select prosecdef from pg_proc where oid = to_regprocedure('public.hb_registre_depuis(text, uuid, text)')) as registre_definer,
       (select prosecdef from pg_proc where oid = to_regprocedure('public.hb_mes_canaux_memo()')) as memo_definer,
       not has_function_privilege('anon', 'public.hb_registre_depuis(text, uuid, text)', 'execute')
         and not has_function_privilege('anon', 'public.hb_mes_canaux_memo()', 'execute')
         and not has_function_privilege('authenticated', 'public.hb_registre_purger(interval, integer)', 'execute')
         and not has_function_privilege('authenticated', 'public.hb_surveiller_charge(numeric, numeric, integer, integer)', 'execute') as anon_rien,
       not has_table_privilege('authenticated', 'public.hb_registre', 'select')
         and not has_table_privilege('authenticated', 'public.hb_canaux_cache', 'select')
         and not has_table_privilege('anon', 'public.hb_registre', 'select') as tables_fermees,
       exists (select 1 from public.hb_registre_etat where id = 1) and exists (select 1 from public.hb_charge_etat where id = 1) as etat,
       to_regprocedure('public.hb_filet(jsonb)') is not null and to_regprocedure('public.hb_quoi_de_neuf(jsonb)') is not null
         and to_regprocedure('public.hb_mes_canaux()') is not null and to_regprocedure('public.hb_ping(uuid, text)') is not null as anciennes;

-- Taille et dernières purges du registre (contrôle courant) :
-- select count(*) as lignes, pg_size_pretty(pg_total_relation_size('public.hb_registre')) as taille, min(at), max(at),
--        (select purge_x::text || ' / ' || coalesce(purge_at::text, 'jamais') from public.hb_registre_etat) as purge
--   from public.hb_registre;
-- Ce que voit un compte (remplacer <uuid> ; tout est annulé à la fin) :
-- begin;
--   select set_config('request.jwt.claims', json_build_object('sub', '<uuid>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   select public.hb_registre_depuis(null);                       -- premier appel : { c, complet: false, … }
--   select public.hb_registre_depuis('<c rendu juste avant>');    -- { c, complet: true, e: {…} }
-- rollback;

-- ---------- ACTIVATION (NON FAITE : à décider ; pg_cron 1.5+ pour les intervalles en secondes) ----------
-- Purge du registre toutes les 10 minutes (garde 2 jours) :
--   select cron.schedule('handbase-registre', '*/10 * * * *', $q$select public.hb_registre_purger(interval '2 days', 200000)$q$);
-- Surveillance de la charge toutes les 20 secondes (seuils : 30 % / 60 % des connexions actives) :
--   select cron.schedule('handbase-charge', '20 seconds', $q$select public.hb_surveiller_charge(0.30, 0.60, 120, 120)$q$);
-- Arrêt : select cron.unschedule('handbase-registre'); select cron.unschedule('handbase-charge');
--         select public.hb_annoncer_charge('calme', 1);

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script ; l'appli repasse d'elle-même au filet de 059) ----------
-- 1. Règles du direct de 057 (en super-utilisateur si besoin) :
-- do $$ begin
--   execute 'drop policy if exists "hb_recevoir" on realtime.messages';
--   execute 'drop policy if exists "hb_emettre" on realtime.messages';
--   execute $p$create policy "hb_recevoir" on realtime.messages for select to authenticated
--     using (realtime.messages.extension = 'broadcast' and realtime.topic() = any ((select public.hb_mes_canaux())::text[]))$p$;
--   execute $p$create policy "hb_emettre" on realtime.messages for insert to authenticated
--     with check (realtime.messages.extension = 'broadcast' and realtime.topic() = any ((select public.hb_mes_canaux())::text[]) and (select public.hb_has_role()))$p$;
-- end $$;
-- 2. Déclencheurs, fonctions, tables :
-- do $$ declare t text; begin
--   foreach t in array array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
--                            'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log',
--                            'saved_questions'] loop
--     if to_regclass('public.hb_' || t) is null then continue; end if;
--     execute format('drop trigger if exists hb_registre_ins on public.hb_%1$s; drop trigger if exists hb_registre_upd on public.hb_%1$s;
--                     drop trigger if exists hb_registre_del on public.hb_%1$s', t);
--   end loop;
--   foreach t in array array['units', 'levels', 'assignments'] loop
--     if to_regclass('public.hb_' || t) is null then continue; end if;
--     execute format('drop trigger if exists hb_droits on public.hb_%1$s; drop trigger if exists hb_droits_ins on public.hb_%1$s;
--                     drop trigger if exists hb_droits_upd on public.hb_%1$s; drop trigger if exists hb_droits_del on public.hb_%1$s;
--                     drop trigger if exists hb_droits_vider on public.hb_%1$s', t);
--   end loop;
-- end $$;
-- drop trigger if exists hb_droits_profil on public.hb_profiles; drop trigger if exists hb_droits_profil_ajout on public.hb_profiles;
-- drop trigger if exists hb_droits_vider on public.hb_profiles;
-- select cron.unschedule('handbase-registre'); select cron.unschedule('handbase-charge');   -- si activées
-- drop function if exists public.hb_registre_depuis(text, uuid, text), public.hb_registre_purger(interval, integer),
--   public.hb_registre_noter(), public.hb_mes_canaux_memo(), public.hb_canaux_memo(), public.hb_canaux_rapides(),
--   public.hb_emetteur_rapide(), public.hb_canaux_garde(), public.hb_droits_changes(), public.hb_droits_comptes(text[]),
--   public.hb_droits_invalider(), public.hb_surveiller_charge(numeric, numeric, integer, integer), public.hb_annoncer_charge(text, integer);
-- drop table if exists public.hb_registre, public.hb_registre_etat, public.hb_canaux_cache, public.hb_droits_compte,
--   public.hb_droits_version, public.hb_charge_etat;
