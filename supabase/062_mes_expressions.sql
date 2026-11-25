-- HandBase : « Mes expressions » : le vocabulaire PERSONNEL d'un entraîneur pour l'avis vocal (« teigneux », « valeureux »,
-- « joue très personnel »), relié à 1 à 3 critères avec un sens (plutôt haut, moyen, plutôt bas), gardé sur le COMPTE (tous
-- ses appareils).
-- À exécuter dans Supabase > SQL Editor, APRÈS 061_registre_changements.sql : base de TEST d'abord (vérifier avec la requête
-- de contrôle en fin de fichier), puis les autres. Peut être relancé sans risque (create … if not exists, create or replace,
-- drop … if exists). Additif : aucune table ni fonction existante n'est modifiée (ni hb_upsert, ni la synchronisation, ni le
-- registre, ni le direct).
-- L'appli marche AVANT ce script : tant que le serveur ne connaît pas la table, chaque appareil garde ses expressions pour
-- lui (src/expressions.ts) ; dès qu'elle existe, il y envoie celles qu'il a, puis relit celles du compte.
--
-- 1) Table hb_expressions : id (uuid, choisi par l'appareil), user_id (le compte connecté, posé par le serveur), texte
--    (60 caractères au plus), cibles ([{ criterionId, sens }], 1 à 3, sens « haut », « moyen » ou « bas » ; vide une fois
--    supprimée), created_at, updated_at (horloge de l'appareil, jamais plus de 5 minutes en avance), deleted_at.
--    Une seule expression vivante par texte et par compte (majuscules indifférentes). 150 au plus par compte (l'appli en
--    garde 100 ; la marge couvre deux appareils hors ligne).
-- 2) DROITS : PERSONNEL. Chacun lit, crée, modifie et supprime SES expressions, avec un rôle du staff ; personne d'autre ne
--    les voit, pas même un administrateur. Compte sans rôle, compte joueur : rien (hb_has_role). Écriture directe (règles
--    ci-dessous), sans passer par hb_upsert.
-- 3) LA PLUS RÉCENTE L'EMPORTE : une modification plus ancienne que la version enregistrée est ignorée (l'appareil relit
--    ensuite celle du serveur). Le compte d'une ligne ne change jamais.
-- 4) SUPPRESSION : l'appli garde la ligne avec deleted_at (les autres appareils du compte l'oublient aussi), sans cibles.
--    Compte supprimé : ses expressions partent avec lui (on delete cascade).
-- 5) Rien n'est diffusé ni journalisé : l'appli relit la table au lancement puis au plus toutes les 10 minutes.
-- Seul le VOCABULAIRE part avec un avis vocal (fonction « transcrire », critères sous des identifiants courts) : jamais de
-- nom ni de donnée de joueur.
-- Retour arrière : drop table if exists public.hb_expressions; drop function if exists public.hb_expressions_garde();
-- (les appareils gardent leur copie).

-- ---------- Table ----------

create table if not exists public.hb_expressions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  texte text not null check (length(texte) between 1 and 60),
  cibles jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint hb_expressions_cibles check (
    jsonb_typeof(cibles) = 'array'
    and jsonb_array_length(cibles) <= 3
    and (deleted_at is not null or jsonb_array_length(cibles) >= 1)
  )
);
create index if not exists hb_expressions_user on public.hb_expressions (user_id);
create unique index if not exists hb_expressions_texte on public.hb_expressions (user_id, lower(texte)) where deleted_at is null;
alter table public.hb_expressions enable row level security;

-- ---------- Droits : chacun les siennes ----------

drop policy if exists "own_select" on public.hb_expressions;
create policy "own_select" on public.hb_expressions for select to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_has_role()));
drop policy if exists "own_insert" on public.hb_expressions;
create policy "own_insert" on public.hb_expressions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.hb_has_role()));
drop policy if exists "own_update" on public.hb_expressions;
create policy "own_update" on public.hb_expressions for update to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_has_role()))
  with check (user_id = (select auth.uid()));
drop policy if exists "own_delete" on public.hb_expressions;
create policy "own_delete" on public.hb_expressions for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_has_role()));

revoke all on public.hb_expressions from public, anon, authenticated;
grant select, insert, update, delete on public.hb_expressions to authenticated;

-- ---------- Contrôles à l'écriture ----------
-- Cibles nettoyées (critère : texte de 80 caractères au plus, distinct ; sens connu), horloge bornée, compte inchangé,
-- version plus ancienne ignorée, 150 expressions vivantes au plus.
create or replace function public.hb_expressions_garde() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_max timestamptz := now() + interval '5 minutes';
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return null; -- plus ancienne que celle du serveur : ignorée
    end if;
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  elsif new.deleted_at is null and not exists (select 1 from public.hb_expressions where id = new.id)
    and (select count(*) from public.hb_expressions where user_id = new.user_id and deleted_at is null) >= 150 then
    raise exception 'Trop d’expressions enregistrées (150 au plus)';
  end if;
  new.updated_at := least(new.updated_at, v_max);
  new.texte := btrim(regexp_replace(new.texte, '[[:cntrl:][:space:]]+', ' ', 'g'));
  new.cibles := case when new.deleted_at is not null or jsonb_typeof(new.cibles) <> 'array' then '[]'::jsonb else (
    select coalesce(jsonb_agg(jsonb_build_object('criterionId', c.id, 'sens', c.sens) order by c.n), '[]'::jsonb)
      from (select distinct on (e ->> 'criterionId') e ->> 'criterionId' as id, e ->> 'sens' as sens, n
              from jsonb_array_elements(new.cibles) with ordinality x(e, n)
             where jsonb_typeof(e) = 'object' and length(coalesce(e ->> 'criterionId', '')) between 1 and 80
               and e ->> 'sens' in ('haut', 'moyen', 'bas')
             order by e ->> 'criterionId', n) c) end;
  return new;
end $$;
revoke all on function public.hb_expressions_garde() from public, anon, authenticated;

drop trigger if exists hb_expressions_garde on public.hb_expressions;
create trigger hb_expressions_garde before insert or update on public.hb_expressions
  for each row execute function public.hb_expressions_garde();

-- ---------- Vérification ----------
-- Table, 4 règles (lecture, ajout, modification, suppression : leur auteur seul), contrôles posés ; aucune autre fonction touchée.
select (select count(*) from public.hb_expressions) as expressions,
       (select count(*) from pg_policies where tablename = 'hb_expressions') as regles_4,
       (select count(*) from pg_trigger where tgrelid = 'public.hb_expressions'::regclass and not tgisinternal) as declencheurs_1,
       (select relrowsecurity from pg_class where oid = 'public.hb_expressions'::regclass) as rls_active,
       (select count(*) from information_schema.role_table_grants where table_name = 'hb_expressions' and grantee = 'anon') as droits_anon_0;
