# HandBase — Collecte & suivi

Webapp (PWA installable) de suivi des joueurs de handball :

- **Fiches joueurs** : identité, poste (terrain cliquable), club, catégorie, latéralité, photo…
- **Données factuelles** (préparateur physique) : tests et mesures avec **historique** et courbe d'évolution.
- **Avis subjectifs** (plusieurs observateurs) : rattachés à un match / tournoi, comparés (moyenne, tableau
  par observateur, radar) avec **signalement des avis divergents**, et cumulés dans le temps.
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
2. *SQL Editor* → coller et exécuter `supabase/schema.sql`.
3. *Authentication → Users* → créer un compte (e-mail + mot de passe) pour chaque membre du staff.
   Désactiver les inscriptions publiques (*Authentication → Sign In / Providers → Allow new users to sign up*).
4. Copier `.env.example` en `.env.local` et y mettre l'URL du projet et la clé publique *anon*
   (*Project Settings → API*).
5. Relancer `npm run dev`, puis *Réglages → Se connecter*.

## Déployer (GitHub Pages)

Chaque `git push` sur `main` publie automatiquement l'app sur **https://kgeogeo.github.io/HandBase/**
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
