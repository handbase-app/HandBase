# HandBase — Collecte & suivi

Webapp (PWA installable) de suivi des joueurs de handball :

- **Fiches joueurs** : identité, poste (terrain cliquable), club, catégorie, latéralité, photo…
- **Données factuelles** (préparateur physique) : tests et mesures avec **historique** et courbe d'évolution.
- **Avis subjectifs** (plusieurs observateurs) : rattachés à un match / tournoi, comparés (moyenne, tableau
  par observateur, radar) avec **signalement des avis divergents**, et cumulés dans le temps.
- **Maturité & croissance** (calculées, jamais saisies) : décalage par rapport au pic de croissance
  (Mirwald 2002 et Moore 2015), taille adulte prédite et % atteint (Khamis-Roche 1994, coefficients corrigés
  par l'erratum de 1995), avec correction des tailles parentales déclarées — voir `src/maturity.ts`.
- **Critères paramétrables** dans *Réglages* : ajouter, renommer, masquer, passer de factuel à subjectif, mode rapide.
- **Hors ligne d'abord** : tout est enregistré sur l'appareil, puis synchronisé avec le serveur au retour du réseau.
- Export **CSV** (Excel) et sauvegarde / restauration **JSON**.

## Lancer en local

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5173. Sans serveur configuré, l'app fonctionne en **mode local** (données sur l'appareil).

Pour tester sur un téléphone du même réseau Wi-Fi : l'adresse « Network » affichée par `npm run dev`.
(Le mode hors ligne / l'installation sur l'écran d'accueil nécessitent HTTPS : une fois déployée, c'est automatique.)

## Brancher le serveur (synchronisation entre appareils)

1. Créer un projet gratuit sur https://supabase.com.
2. *SQL Editor* → coller et exécuter `supabase/schema.sql`, puis les scripts numérotés dans l'ordre
   (`002_roles.sql` … `016_mdp_provisoire_24h.sql`).
3. *Authentication → Users* → créer un compte (e-mail + mot de passe) pour chaque membre du staff.
   Désactiver les inscriptions publiques (*Authentication → Sign In / Providers → Allow new users to sign up*).
4. Copier `.env.example` en `.env.local` et y mettre l'URL du projet et la clé publique *anon*
   (*Project Settings → API*).
5. Relancer `npm run dev` et se connecter.

### Rôles

| Rôle | Droits |
|---|---|
| Administrateur | Tout : critères, suppression de joueurs, rôles du staff |
| Encadrant | Fiches joueurs (sans suppression), tests physiques, crée des événements et gère les siens, ses avis, valide les avis spontanés et fiches proposées de son secteur, crée des groupes et gère les siens |
| Observateur | Consulte tout, donne ses propres avis (ses avis spontanés sont soumis à validation) |

Les droits sont vérifiés par le serveur (`hb_upsert`, `supabase/002_roles.sql`). Un administrateur crée, modifie
et supprime les observateurs et encadrants depuis l'appli (*Réglages → Membres du staff*, `supabase/014_gestion_membres.sql`).
Par sécurité, l'appli ne peut ni créer ni nommer un administrateur : uniquement dans le SQL Editor
(`update public.hb_profiles set role = 'admin' where email = '…';`).
Un compte créé (ou un mot de passe donné) par un administrateur est provisoire : l'appli demande d'en choisir un à la
connexion (`supabase/015_telephone_mdp_provisoire.sql`) et expire au bout de 24 h, contrôlé par la base
(`supabase/016_mdp_provisoire_24h.sql`). L'accès s'envoie depuis le téléphone de l'administrateur (e-mail, SMS,
WhatsApp) avec un lien qui connecte en un clic (`#acces=…`, jamais transmis à un serveur). « Mot de passe oublié ? » envoie un lien par e-mail : il faut un SMTP personnalisé
(*Authentication → Emails → SMTP Settings*) et l'adresse de l'appli dans *Authentication → URL Configuration*.

### Avis spontanés

Un joueur vu hors des événements prévus (UNSS, entraînement de club…) peut être noté en « avis spontané » :
contexte libre au lieu d'un événement. Celui d'un observateur arrive **en attente** et ne compte dans les
moyennes qu'une fois **validé** par un encadrant ou un administrateur ; refusé, il passe **hors cadre** (gardé
sur la fiche du joueur, jamais compté). S'il est modifié, il repasse en attente. Les avis spontanés des
encadrants et administrateurs sont validés d'office. Règles tenues par le serveur (`supabase/008_avis_spontanes.sql`).

### Fiches proposées et adultes référents

Un observateur peut **proposer** la fiche d'un joueur absent de la base (UNSS, sans licence) : nom, prénom,
département (obligatoire), établissement ou club… Un encadrant la **valide** ou la met **hors cadre** (onglet
*Joueurs → Hors cadre*, gardée pour voir plus tard ce que le joueur est devenu). Chaque fiche peut avoir des
**adultes référents** (parent, professeur d'EPS…) : table `hb_referents`, lisible seulement par les encadrants et
administrateurs, et par celui qui les a saisis (`supabase/009_joueurs_proposes.sql`).

### Secteurs

L'administrateur attribue à chaque membre ses départements (*Réglages → Membres du staff*). Un encadrant valide les
avis spontanés et fiches proposées des joueurs de son secteur (département lu dans le n° de club ou de licence,
sinon saisi à la main) ; sans département attribué, il valide tout. Un joueur au département inconnu revient à
l'administrateur. Pour un observateur, le secteur est indicatif et pré-remplit le département des fiches qu'il
propose (`supabase/010_secteurs.sql`).

### Fusion de fiches et « Ratés »

Deux fiches du même joueur (doublon, fiche proposée qui obtient une licence) se fusionnent depuis la fiche joueur
(encadrants, administrateurs, en ligne) : avis, mesures, référents et listes d'événements passent sur la fiche
gardée, complétée sans rien écraser ; l'autre est supprimée (`supabase/011_fusion_fiches.sql`, d'un bloc, côté
serveur). Les doublons possibles (même nom, naissance compatible) sont signalés sur la fiche et dans *Propositions* ;
l'import des licences retrouve aussi les fiches proposées saisies sans date de naissance. La vue **Ratés** liste les
joueurs mis hors cadre et ce qu'ils sont devenus depuis (licence, convocations, avis validés).

### Expiration des données (RGPD)

Une fiche proposée jamais traitée est effacée 12 mois après sa création, avec ses adultes référents, ses avis et
ses mesures ; les référents d'une fiche hors cadre sont effacés 12 mois après la décision (la fiche reste pour la vue
« Ratés »). Les données personnelles disparaissent aussi du journal d'activité. `supabase/012_expiration_rgpd.sql` :
tâche de nuit si l'extension *pg_cron* est disponible, sinon lancée une fois par jour par l'appli d'un administrateur.

### Groupes

Listes de joueurs réutilisables (Intercomités 83, Pôle, Sport-études…) : filtre « Groupe » dans les listes de joueurs,
export, et création d'un événement avec les joueurs d'un groupe (copie, modifiable ensuite). Visibles par tout le
staff ; un encadrant ne modifie que les siens, un administrateur tous. Une fusion de fiches remplace aussi la fiche
fondue dans les groupes (`supabase/013_groupes.sql`).

### Journal d'activité

`supabase/004_audit.sql` trace toute écriture côté serveur (déclencheurs de la base, y compris les scripts
lancés dans le SQL Editor) : qui, rôle, quand, quoi, ancienne → nouvelle valeur. Lisible par les
administrateurs dans *Réglages → Journal d'activité* ; les événements et fiches affichent « créé par / modifié par ».

## Déployer (GitHub Pages)

Chaque `git push` sur `main` publie automatiquement l'app sur **https://handbase-app.github.io/HandBase/**
(workflow `.github/workflows/deploy.yml`, à suivre dans l'onglet *Actions* du dépôt).

La configuration Supabase du site en ligne est dans *Settings → Secrets and variables → Actions → Variables* :
`VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (clé *publishable*, publique par nature — ne jamais y mettre la clé *secret*).

Sur téléphone : ouvrir l'adresse, se connecter, puis « Ajouter à l'écran d'accueil ».

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/db.ts` | Modèle de données et base locale (IndexedDB via Dexie). Toutes les écritures passent par `save()` / `remove()` qui alimentent la file de synchro. |
| `src/criteria.ts` | Critères livrés par défaut (factuels et subjectifs). |
| `src/sync.ts` | Synchronisation hors ligne ↔ Supabase (file d'attente, « la plus récente gagne »). |
| `src/pages/` | Écrans : accueil, joueurs, fiche, formulaire, évaluation, matchs, réglages. |
| `src/components/Opinions.tsx` | Comparaison et cumul des avis des observateurs. |
| `supabase/schema.sql` | Tables et fonction serveur. |

## Données personnelles

L'app contient des données de joueurs, souvent mineurs. Avant une utilisation réelle : comptes staff uniquement
(pas d'inscription publique), informer les joueurs / parents, et limiter les données au nécessaire (RGPD).
