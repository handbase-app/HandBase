-- HandBase : comptes de test gardés sur le COMPTE ADMINISTRATEUR (tous ses appareils). « Changer de compte » (src/comptes.ts)
-- gardait chaque compte de test sur UN appareil : sur le téléphone, il fallait retaper l'e-mail et le mot de passe du compte
-- déjà ajouté sur l'ordinateur. Demandé par Geoffroy le 09/11/2026 : « je veux que ça marche de partout ». Règle choisie :
-- seulement les comptes AJOUTÉS UNE FOIS avec leur mot de passe (sur n'importe quel appareil).
-- Numéro 077 (076 = humeurs du journal, indépendant de celui-ci). À passer APRÈS 075_preferences.sql, avec
-- outils/appliquer-sql.sh (serveur maison) : base hand d'abord (vérifier avec la requête de contrôle en fin de fichier),
-- puis volley si voulu. Peut être relancé sans risque (if not exists, drop policy if
-- exists). Va avec la fonction edge « comptes-test » (supabase/functions/comptes-test) : déployer les deux.
-- Additif : une table nouvelle ; rien d'autre n'est modifié (ni hb_upsert, ni la synchronisation, ni hb_profiles, ni les
-- droits des autres tables ou fonctions). La table n'est pas synchronisée sur les appareils (aucune donnée de joueur).
-- L'appli marche AVANT ce script et avant la fonction : chaque appareil garde ses comptes pour lui, comme avant, sans
-- message d'erreur.
--
-- 1) Table hb_comptes_test : une ligne par (administrateur, compte de test) : e-mail et nom affiché du compte de test (lus
--    au serveur, jamais saisis), son rôle au moment de l'ajout ou de la dernière ouverture (pour l'étiquette « (joueur) »),
--    date d'ajout, date de dernière ouverture. JAMAIS de mot de passe ni de jeton : la preuve du mot de passe est donnée
--    une fois à la fonction (jeton d'accès du compte de test, vérifié puis oublié).
-- 2) Lecture : un administrateur lit SES lignes seulement (admin_uid = lui, et toujours administrateur). Écriture : aucune
--    directe (ni insert, ni update, ni delete pour authenticated) : tout passe par la fonction edge (rôle service), qui
--    vérifie l'appelant (administrateur), le compte de test (pas administrateur) et la preuve du mot de passe.
-- 3) Compte supprimé (auth.users) : ses lignes partent avec lui (on delete cascade), des deux côtés.
-- Retour arrière : drop table if exists public.hb_comptes_test;
-- (les appareils gardent leurs comptes ; ceux qui ne sont pas sur un appareil y seront à rajouter avec leur mot de passe).

-- ---------- Table ----------

create table if not exists public.hb_comptes_test (
  admin_uid uuid not null references auth.users (id) on delete cascade,
  test_uid uuid not null references auth.users (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 320),
  libelle text not null default '' check (char_length(libelle) <= 120),
  role text not null default '' check (role in ('', 'preparateur', 'observateur', 'joueur')),
  ajoute_le timestamptz not null default now(),
  ouvert_le timestamptz,
  primary key (admin_uid, test_uid),
  check (admin_uid <> test_uid)
);

alter table public.hb_comptes_test enable row level security;
drop policy if exists "admin_lit_les_siens" on public.hb_comptes_test;
-- Lire : l'administrateur connecté, ses lignes seulement. Ni insertion, ni modification, ni suppression directes.
create policy "admin_lit_les_siens" on public.hb_comptes_test for select to authenticated
  using (admin_uid = (select auth.uid()) and (select public.hb_is_admin()));
revoke all on public.hb_comptes_test from public, anon, authenticated;
grant select on public.hb_comptes_test to authenticated;
grant select, insert, update, delete on public.hb_comptes_test to service_role;

-- ---------- Vérification ----------
-- Attendu : table_1 = 1, rls = t, regles_1 = 1, appli_peut_lire = t, ecriture_directe_0 = 0 (ni insert, ni update, ni
-- delete pour authenticated), anon_0 = 0, service_ecrit = t, lignes = 0 au départ, colonne_secrete_0 = 0 (aucune colonne
-- de mot de passe ou de jeton).
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'hb_comptes_test') as table_1,
       (select relrowsecurity from pg_class where oid = 'public.hb_comptes_test'::regclass) as rls,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'hb_comptes_test') as regles_1,
       has_table_privilege('authenticated', 'public.hb_comptes_test', 'select') as appli_peut_lire,
       (select count(*) from unnest(array['insert', 'update', 'delete']) p where has_table_privilege('authenticated', 'public.hb_comptes_test', p)) as ecriture_directe_0,
       (select count(*) from unnest(array['select', 'insert', 'update', 'delete']) p where has_table_privilege('anon', 'public.hb_comptes_test', p)) as anon_0,
       has_table_privilege('service_role', 'public.hb_comptes_test', 'insert') as service_ecrit,
       (select count(*) from public.hb_comptes_test) as lignes,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hb_comptes_test'
          and column_name ~ '(mot|pass|jeton|token|secret)') as colonne_secrete_0;
