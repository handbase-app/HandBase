-- HandBase / Nextar : propositions D'ADMINISTRATION dans la boîte « À valider » (serveur MCP, outil nextar_admin_proposer).
-- « Claude prépare, l'admin valide d'un toucher » : Claude, avec le compte d'un ADMINISTRATEUR, dépose des actions
-- d'administration (donner un rôle, affecter à une unité ou poser un secteur, archiver des événements ou des groupes, fondre
-- des doublons de fiches) ; RIEN ne s'applique avant que l'administrateur coche et touche « Appliquer » dans l'appli, qui
-- passe alors par les MÊMES chemins que ses écrans (hb_update_member, synchronisation des affectations, des événements et des
-- groupes, hb_merge_players), avec les mêmes contrôles de droits.
-- À exécuter dans Supabase > SQL Editor, APRÈS 067_propositions.sql (et 069 s'il est appliqué ; 070 n'en dépend pas) : base
-- de TEST d'abord (vérifier avec la requête de contrôle en fin de fichier), puis les autres. Peut être relancé sans risque
-- (drop … if exists, create or replace). ADDITIF : ni la table (ses lignes restent), ni ses règles de lecture et d'écriture,
-- ni hb_upsert, ni la synchronisation générale ne sont touchés ; seul le déclencheur de garde de 067 est repris (mêmes règles,
-- plus celles de la sorte « admin », repérées « 070 »).
-- L'appli marche AVANT ce script : la boîte ignore une sorte qu'elle ne reçoit pas, et le serveur MCP répond « boîte admin
-- indisponible tant que 070 n'est pas appliqué » (la contrainte de 067 refuse la sorte « admin »).
--
-- 1) SORTE « admin » (une seule sorte, et le sous-type dans le contexte, plutôt que quatre sortes : la garde n'a qu'un cas à
--    connaître, et une sorte d'administration de plus demain ne touche pas la table) :
--    - kind accepte 'admin' en plus de 'mesures', 'avis', 'vus', 'a_revoir' ;
--    - contrainte hb_propositions_admin_forme : une proposition « admin » porte contexte.sorte parmi 'role', 'perimetre',
--      'archiver', 'fusion', et 50 actions au plus (chaque ligne un objet) ; les autres sortes ne changent pas.
-- 2) GARDE (hb_propositions_garde, reprise de 067) : les sortes de 067 restent ouvertes à tout compte du staff (règles de
--    067 inchangées) ; une sorte « admin » ne peut être CRÉÉE que par un administrateur (hb_is_admin(), 043 ; avec la clé de
--    service : le compte donné doit être administrateur), ni MODIFIÉE (état, retrait) que par un administrateur. Refus :
--    42501. La sorte ne change jamais après la création (comme en 067).
-- 3) Lecture : chacun les siennes (règles de 067) ; un administrateur ne voit pas celles d'un autre administrateur.
-- Aucune donnée n'est envoyée à une IA par Nextar : la table garde ce que l'administrateur (ou son IA, avec son compte) a
-- déposé ; le serveur MCP ne rend à Claude que des codes (C-…, J-…) et des noms de comptes du staff.
-- Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 1) Sorte « admin » ----------

-- La contrainte de 067 (écrite dans la colonne, nommée hb_propositions_kind_check par Postgres) : remplacée. Toute autre
-- contrainte de sorte (base créée autrement) part aussi.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.hb_propositions'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ~ '\mkind\M' and pg_get_constraintdef(oid) ~ 'mesures'
              and conname <> 'hb_propositions_kind_check'
  loop
    execute format('alter table public.hb_propositions drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.hb_propositions drop constraint if exists hb_propositions_kind_check;
alter table public.hb_propositions add constraint hb_propositions_kind_check
  check (kind in ('mesures', 'avis', 'vus', 'a_revoir', 'admin'));

alter table public.hb_propositions drop constraint if exists hb_propositions_admin_forme;
alter table public.hb_propositions add constraint hb_propositions_admin_forme check (
  kind <> 'admin' or (
    coalesce(contexte ->> 'sorte', '') in ('role', 'perimetre', 'archiver', 'fusion')
    and jsonb_typeof(lignes) = 'array' and jsonb_array_length(lignes) between 1 and 50
  )
);

-- ---------- 2) Garde (reprise de 067, plus les lignes « 070 ») ----------

create or replace function public.hb_propositions_garde() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    -- Le compte est celui de la session (l'appli, ou le serveur MCP avec le compte du coach) ; clé de service : celui donné.
    if v_uid is not null then new.user_id := v_uid; end if;
    if new.user_id is null then raise exception 'Compte requis'; end if;
    -- 070 : une proposition d'administration n'est créée que par un administrateur (clé de service : le compte donné).
    if new.kind = 'admin' and not (
         case when v_uid is not null then coalesce(public.hb_is_admin(), false)
              else exists (select 1 from public.hb_profiles p where p.user_id = new.user_id and p.role = 'admin') end) then
      raise exception 'Propositions d’administration : réservées aux administrateurs' using errcode = '42501', hint = 'hb_propositions_admin';
    end if;
    new.created_at := now();
    new.expires_at := now() + interval '30 days';
    new.deleted_at := null;
    new.etat := 'en_attente';
    perform pg_advisory_xact_lock(hashtextextended('hb_propositions:' || new.user_id::text, 0));
    -- Ménage du compte : expirées, traitées ou retirées depuis 7 jours.
    delete from public.hb_propositions p
     where p.user_id = new.user_id
       and (p.expires_at < now() or ((p.etat <> 'en_attente' or p.deleted_at is not null) and p.updated_at < now() - interval '7 days'));
    if (select count(*) from public.hb_propositions p
         where p.user_id = new.user_id and p.etat = 'en_attente' and p.deleted_at is null and p.expires_at > now()) >= 30 then
      raise exception 'Boîte pleine : 30 propositions en attente au plus. Valide ou rejette d’abord celles qui attendent.'
        using hint = 'hb_propositions_pleine';
    end if;
    if (select count(*) from public.hb_propositions p where p.user_id = new.user_id) >= 100 then
      raise exception 'Trop de propositions gardées (100 au plus) : réessaie dans quelques jours.' using hint = 'hb_propositions_pleine';
    end if;
  else
    -- 070 : une proposition d'administration n'est modifiée (état, retrait) que par un administrateur.
    if old.kind = 'admin' and v_uid is not null and not coalesce(public.hb_is_admin(), false) then
      raise exception 'Propositions d’administration : réservées aux administrateurs' using errcode = '42501', hint = 'hb_propositions_admin';
    end if;
    new.id := old.id;
    new.user_id := old.user_id;
    new.source := old.source;
    new.kind := old.kind;
    new.created_at := old.created_at;
    new.expires_at := old.expires_at;
    -- Retirée : le reste (date du retrait posée par le serveur).
    if old.deleted_at is not null then new.deleted_at := old.deleted_at;
    elsif new.deleted_at is not null then new.deleted_at := now();
    end if;
    -- Traitée et qui le reste : ses lignes, son contexte et son titre ne changent plus.
    if old.etat <> 'en_attente' and new.etat <> 'en_attente' then
      new.lignes := old.lignes;
      new.contexte := old.contexte;
      new.titre := old.titre;
    end if;
    -- Remise en attente (« Défaire » après un enregistrement) : même plafond qu'à la création.
    if new.etat = 'en_attente' and old.etat <> 'en_attente' and new.deleted_at is null then
      perform pg_advisory_xact_lock(hashtextextended('hb_propositions:' || new.user_id::text, 0));
      if (select count(*) from public.hb_propositions p
           where p.user_id = new.user_id and p.id <> new.id and p.etat = 'en_attente' and p.deleted_at is null and p.expires_at > now()) >= 30 then
        raise exception 'Boîte pleine : 30 propositions en attente au plus.' using hint = 'hb_propositions_pleine';
      end if;
    end if;
  end if;
  new.updated_at := now();
  new.titre := left(btrim(regexp_replace(coalesce(new.titre, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 80);
  if new.titre = '' then new.titre := 'Proposition'; end if;
  if new.contexte is null or jsonb_typeof(new.contexte) <> 'object' then new.contexte := '{}'::jsonb; end if;
  if octet_length(new.contexte::text) > 32768 then raise exception 'Contexte trop long (32 Ko au plus)'; end if;
  if coalesce(jsonb_typeof(new.lignes), '') <> 'array' then raise exception 'Les lignes doivent être une liste'; end if;
  if jsonb_array_length(new.lignes) = 0 then raise exception 'Aucune ligne à garder'; end if;
  if jsonb_array_length(new.lignes) > 300 then raise exception 'Trop de lignes (300 au plus)'; end if;
  if octet_length(new.lignes::text) > 204800 then raise exception 'Tableau trop long (200 Ko au plus)'; end if;
  if exists (select 1 from jsonb_array_elements(new.lignes) e where jsonb_typeof(e) not in ('array', 'object')) then
    raise exception 'Chaque ligne doit être une liste de cellules';
  end if;
  -- 070 : chaque action d'une proposition d'administration est un objet.
  if new.kind = 'admin' and exists (select 1 from jsonb_array_elements(new.lignes) e where jsonb_typeof(e) <> 'object') then
    raise exception 'Chaque action d’une proposition d’administration doit être un objet';
  end if;
  return new;
end $$;
revoke all on function public.hb_propositions_garde() from public, anon, authenticated;

-- Le déclencheur de 067 appelle déjà cette fonction : rien à reposer (reposé quand même, pour une base où il manquerait).
drop trigger if exists hb_propositions_garde on public.hb_propositions;
create trigger hb_propositions_garde before insert or update on public.hb_propositions
  for each row execute function public.hb_propositions_garde();

-- ---------- Vérification ----------
-- Attendu : propositions (nombre, inchangé par ce script), sorte_admin = t, forme_admin_1 = 1, garde_admin = t,
-- garde_1 = 1, regles_4 = 4, rls_active = t, droits_anon_0 = 0.
select (select count(*) from public.hb_propositions) as propositions,
       (select pg_get_constraintdef(oid) ~ '''admin''' from pg_constraint where conrelid = 'public.hb_propositions'::regclass and conname = 'hb_propositions_kind_check') as sorte_admin,
       (select count(*) from pg_constraint where conrelid = 'public.hb_propositions'::regclass and conname = 'hb_propositions_admin_forme') as forme_admin_1,
       (select prosrc ~ 'hb_is_admin' from pg_proc where oid = 'public.hb_propositions_garde()'::regprocedure) as garde_admin,
       (select count(*) from pg_trigger where tgrelid = 'public.hb_propositions'::regclass and not tgisinternal and tgname = 'hb_propositions_garde') as garde_1,
       (select count(*) from pg_policies where tablename = 'hb_propositions') as regles_4,
       (select relrowsecurity from pg_class where oid = 'public.hb_propositions'::regclass) as rls_active,
       (select count(*) from information_schema.role_table_grants where table_name = 'hb_propositions' and grantee = 'anon') as droits_anon_0;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- Les propositions d'administration partent d'abord (la contrainte de 067 ne les accepte pas), puis :
-- delete from public.hb_propositions where kind = 'admin';
-- alter table public.hb_propositions drop constraint if exists hb_propositions_admin_forme;
-- alter table public.hb_propositions drop constraint if exists hb_propositions_kind_check;
-- alter table public.hb_propositions add constraint hb_propositions_kind_check check (kind in ('mesures', 'avis', 'vus', 'a_revoir'));
-- puis relancer la section « Contrôles à l'écriture » de 067_propositions.sql (hb_propositions_garde sans les lignes « 070 »).
