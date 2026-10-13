# Fonction « transcrire » (Voxtral, Mistral AI)

Dictée en ligne pour la page d'essai `/essai-dictee/` (moteur « Voxtral (Mistral, en ligne) »). La clé Mistral reste
dans les secrets de la fonction, jamais dans la page ni dans le dépôt. Réservée aux administrateurs connectés.
Aucun son ni texte n'est enregistré ou journalisé ; seuls des nombres d'appels sont comptés (`042_quota_transcription.sql`).

Pour l'essai : **base de test seulement** (site de démo). Offre gratuite Mistral : les données envoyées peuvent servir à
l'entraînement de leurs modèles, donc phrases d'essai seulement, sans nom de joueur.

## 1. Clé Mistral (une fois)

1. Ouvrir https://console.mistral.ai et créer un compte (ou se connecter).
2. Choisir l'offre gratuite (« Experiment ») dans la partie facturation (*Admin* → *Billing* ou *Plans*) ; Mistral demande
   en général de vérifier un numéro de téléphone.
3. *API Keys* → *Create new key* : nom `handbase-test`, expiration si proposée. Copier la clé tout de suite (elle n'est
   montrée qu'une fois). Ne la coller nulle part ailleurs que dans le secret Supabase de l'étape 3.
4. Plafond de dépense : dans *Admin* → *Billing* (ou *Limits* / *Usage limits*), **vérifier que l'option existe** de fixer
   une limite mensuelle de dépense ou d'usage, et la régler au plus bas utile (par exemple 5 €). L'emplacement et le nom
   de cette option peuvent changer ; avec l'offre gratuite il n'y a pas de facture, la limite servira au passage en payant.
   Les plafonds de la fonction (étape 3) s'ajoutent à celui-ci.

## 2. Compteurs (base de test)

Supabase (projet de **test**) → *SQL Editor* → coller `supabase/042_quota_transcription.sql` → *Run*.

## 3. Secrets (base de test)

Supabase (projet de test) → *Edge Functions* → *Secrets* → *Add new secret* :

- `MISTRAL_API_KEY` : la clé de l'étape 1 ;
- facultatifs : `TRANSCRIRE_QUOTA_MOIS` (appels par mois civil pour tous, 2000 par défaut),
  `TRANSCRIRE_QUOTA_JOUR` (appels par jour et par compte, 200 par défaut),
  `MISTRAL_MODELE` (`voxtral-mini-latest` par défaut).

## 4. Déploiement

En ligne de commande, depuis la racine du dépôt (`<ref-test>` : identifiant du projet de test, visible dans son adresse
`https://<ref-test>.supabase.co`) :

```sh
npx supabase login
npx supabase functions deploy transcrire --project-ref <ref-test>
```

Garder la vérification JWT (ne pas ajouter `--no-verify-jwt`). Sans la ligne de commande : *Edge Functions* →
*Deploy a new function* → *Via Editor*, nom `transcrire`, coller `index.ts`, laisser *Verify JWT* activé, *Deploy*.

## 5. Vérification

1. Ouvrir le site de démo, se connecter avec un compte administrateur.
2. Ouvrir `https://handbase-demo.github.io/essai-dictee/` : sous « Moteur », la ligne Voxtral doit dire « prêt » avec
   le nombre de dictées restantes.
3. Choisir « Voxtral (Mistral, en ligne) », dicter une phrase d'essai.

Réponses d'erreur (JSON `error`) : `non_connecte` (401), `pas_admin` (403), `quota_atteint` / `quota_jour_atteint` (429,
avec `restant_mois` et `restant_jour`), `trop_long` / `trop_gros` (413, 60 s ou 2 Mo au plus), `cle_absente` (503),
`mistral_limite` / `mistral_cle` / `mistral_erreur` (502). Un appel refusé par Mistral compte quand même dans les plafonds.
Les mots de contexte (`context_bias`, 100 au plus, expressions reliées par « _ ») sont envoyés seulement si
« Utiliser le vocabulaire du hand » est coché ; si Mistral les refuse, la fonction refait l'appel sans eux.
