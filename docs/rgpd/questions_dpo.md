# HandBase — Questions pour le délégué à la protection des données (DPO)

**HandBase** est une application (web, installable sur téléphone, utilisable sans réseau) qui sert au staff de
détection (administrateurs, encadrants, observateurs) à repérer et suivre de jeunes handballeuses et handballeurs,
**mineurs pour la plupart** : fiche du joueur, mesures et tests physiques, avis des observateurs, rassemblements.
Elle a été développée par Geoffroy Krantz et Stef Bascher.

Pour chaque point : **ce que fait l'appli aujourd'hui**, puis **notre proposition**. Il suffit de répondre
« d'accord » ou de corriger. Merci !

---

## A. Qui est responsable ?

**1. Qui est le responsable du traitement ?**
- Aujourd'hui : rien n'est écrit. L'appli est utilisée par le staff de [À COMPLÉTER : Fédération / Ligue / Comité].
- Proposition : la structure qui organise la détection (Fédération, Ligue ou Comité) est **responsable du
  traitement** ; Geoffroy Krantz et Stef Bascher, qui hébergent et maintiennent l'appli, sont **sous-traitants**.
  Un contrat de sous-traitance (art. 28 RGPD) est signé entre eux. Qui signe, au nom de quelle structure ?

**2. Sur quelle base légale ?**
- Proposition : **mission d'intérêt général** confiée à la fédération délégataire (détection et accès au haut
  niveau, Code du sport), à défaut **intérêt légitime**. Pas de consentement demandé (difficile à recueillir et à
  gérer pour des mineurs), mais une information claire et un droit d'opposition. À valider.

**3. Faut-il une analyse d'impact (AIPD) ?**
- Constat : données de mineurs, évaluation / notation des personnes, suivi dans le temps, plus de 10 000
  joueurs. Deux critères de la liste CNIL au moins sont remplis.
- Proposition : oui, on fait une AIPD courte ; nous rédigeons la partie technique, le DPO la valide.

**4. Le traitement est-il inscrit au registre ?**
- Proposition : le DPO l'ajoute au registre de la structure ; nous fournissons la fiche (données, destinataires,
  durées, sécurité) à partir de ce document.

## B. Données collectées

**5. Données de santé : lesquelles en sont, et que fait-on ?**
- Aujourd'hui : l'appli enregistre poids, taille, tailles des parents, **tests de mobilité** (cheville, épaule,
  hanche…), gainage, force ; elle **calcule** la maturité pubertaire et la taille adulte prédite. Un préparateur
  peut écrire un commentaire libre sur une mesure (par exemple « blessé »), et des notes libres (« lacunes »,
  « observations ») sur la fiche. La charte du staff interdit d'écrire quoi que ce soit sur la santé, mais rien ne
  l'empêche techniquement.
- Questions : poids, mobilité, maturité pubertaire sont-ils des **données de santé** (art. 9) ? Le mot « blessé »
  l'est-il ?
- Proposition : considérer les tests physiques et la maturité comme **données sportives** (mesures de performance,
  pas de diagnostic) ; interdire toute mention de blessure (remplacer par « non réalisé ») et ajouter un
  avertissement dans les champs libres. Si le DPO juge que ce sont des données de santé : il faut une exception de
  l'art. 9 (consentement explicite des parents ?) et on retire ce qui n'est pas indispensable (maturité, mobilité ?).

**6. Les critères « mental & attitude » posent-ils problème ?**
- Aujourd'hui : les observateurs notent engagement, gestion de la pression, concentration, leadership,
  attitude / fair-play, avec des commentaires libres.
- Proposition : les garder (observations de jeu, pas d'évaluation psychologique), avec la règle de la charte
  « décrire le jeu, pas la personne ». À valider.

**7. La photo est-elle nécessaire ?**
- Aujourd'hui : facultative, stockée dans la fiche, visible de tout le staff.
- Proposition : la garder **facultative**, utile pour reconnaître le joueur en rassemblement. Ou la supprimer si le
  DPO estime qu'elle demande l'accord des parents (droit à l'image).

**8. Nationalité et internat sont-ils nécessaires ?**
- Aujourd'hui : nationalité (importée de Gest'Hand ou saisie) et « internat oui / non ».
- Proposition : garder la nationalité (règles d'éligibilité des sélections), garder « internat » (organisation
  pôle / sport-études). Sinon on les retire.

**9. Tailles des parents.**
- Aujourd'hui : tailles de la mère et du père (sans leur nom), facultatives, pour estimer la taille adulte.
- Proposition : garder, facultatif. Les coordonnées des parents (« adultes référents ») ont déjà été
  **supprimées** de l'appli (plus aucune coordonnée n'est conservée).

## C. Durées de conservation

**10. Combien de temps garde-t-on chaque donnée ?**

| Donnée | Aujourd'hui | Proposition |
|---|---|---|
| Fiche proposée, jamais traitée | effacée après 12 mois (automatique) | garder |
| Joueur supprimé par un admin | effacé pour de bon après 30 jours (automatique, chaque nuit) | garder |
| Joueur validé (suivi) | **pas de limite** | [À VALIDER : fin de la catégorie jeunes (ex. 31 décembre de ses 18 ans) ou 2 ans sans activité] |
| Joueur mis « hors cadre » (refusé) | **pas de limite** (gardé pour la vue « Ratés ») | [À VALIDER : 2 ans après la décision] |
| Journal d'activité (garde les anciennes valeurs) | **pas de limite** | [À VALIDER : 12 mois] |
| Connexions du staff (heures d'utilisation, type d'appareil, sans IP ; vues par les admins) | 6 mois (effacement automatique chaque nuit) | garder |
| Notifications envoyées | pas de limite (en cours de correction) | 30 jours |
| Abonnements aux notifications d'un appareil | pas de limite | supprimés avec le compte ou après 6 mois sans utilisation |
| Compte d'un membre du staff qui part | supprimé à la main par un admin | [À VALIDER : désactivé au départ, effacé après 3 mois] |
| Sauvegardes du serveur (Supabase) | selon l'offre de l'hébergeur | [À VALIDER : 7 jours maximum] |

## D. Information des familles

**11. Comment et quand informer les joueurs et les parents ?**
- Aujourd'hui : une page « Confidentialité » existe, mais seulement dans l'appli (le staff la voit, pas les
  familles). Les données d'identité viennent de **Gest'Hand**, pas des familles : c'est une collecte indirecte
  (art. 14), il faut donc informer **dans le mois**.
- Proposition : une notice courte (voir `brouillon_confidentialite.md`) publiée sur le site de [À COMPLÉTER :
  structure], **remise à la première convocation** ou au premier rassemblement, et rappelée dans la notice de
  licence Gest'Hand si possible. Une version lisible par un enfant de 13 ans.

**12. Les familles peuvent-elles s'opposer ?**
- Proposition : oui ; sur demande, la fiche est supprimée (effacée pour de bon sous 30 jours). Le joueur peut alors
  ne plus être suivi par la détection. À valider.

## E. Prestataires et transferts

**13. Contrats avec les prestataires (sous-traitants ultérieurs).**
- Supabase (base de données, comptes) : serveur en **Suisse** (Zurich, pays reconnu « adéquat » par l'UE).
- GitHub Pages (USA) : héberge seulement le programme de l'appli, **aucune donnée de joueur** ; voit l'adresse IP
  des visiteurs.
- Apple / Google / Mozilla (notifications) : le texte de la notification contient des **noms** (ex.
  « [observateur] : [joueur] »).
- SMS / WhatsApp : l'admin envoie à un membre son accès (mot de passe provisoire valable 24 h) depuis son
  propre téléphone.
- Proposition : accepter les conditions standard (DPA) de Supabase et GitHub ; pour les notifications, **retirer les
  noms** du texte (« 2 avis à valider ») ; recommander le SMS ou l'e-mail plutôt que WhatsApp. À valider.

**14. Transferts hors Union européenne.**
- Suisse : décision d'adéquation, rien à faire. USA (GitHub, Apple, Google) : couverts par le Data Privacy
  Framework et les clauses types. Proposition : le mentionner dans la notice ; pas d'autre mesure.

## F. Accès et sécurité

**15. Qui voit quoi dans le staff ?**
- Aujourd'hui : **tout le staff connecté voit tous les joueurs**, observateurs compris, sur tous les départements.
  Groupes et alertes privés : leur créateur seul. Journal d'activité : administrateurs seuls. Export CSV des joueurs
  affichés : **tout le staff** ; sauvegarde complète : administrateurs ; copie d'un joueur : admin et encadrants.
- Proposition : limiter l'**export CSV** aux encadrants et admins ; garder la lecture de tous les joueurs pour tout
  le staff (un observateur doit pouvoir retrouver un joueur vu ailleurs). Ou faut-il limiter les observateurs à
  leur secteur ?

**16. Copies sur les téléphones.**
- Aujourd'hui : pour marcher sans réseau, toute la base est copiée sur chaque appareil, **non chiffrée** ; la
  déconnexion ne l'efface pas encore (en cours : effacement à la déconnexion).
- Proposition : effacer la copie à la déconnexion et après [À VALIDER : 30] jours sans connexion ; la charte impose
  un téléphone verrouillé ; un admin peut couper un compte à distance. Suffisant ?

**17. Données du staff.**
- Aujourd'hui : nom, e-mail, téléphone, rôle, départements, auteur de chaque avis ; tout le staff voit le nom des
  auteurs des avis.
- Proposition : à mentionner dans la notice du staff ; pas d'autre mesure.

## G. Exercice des droits

**18. Procédure pour une demande d'accès, de correction ou d'effacement.**
- Aujourd'hui : un encadrant ou un admin produit en un clic une **copie complète** du joueur (page à imprimer en
  PDF, avis compris) ; un admin peut corriger ou supprimer la fiche.
- Proposition : toute demande est transmise à [À COMPLÉTER : contact DPO / adresse dédiée] ; vérification de
  l'identité (parent ou joueur) ; réponse **sous un mois** ; une trace de la demande et de la réponse est gardée
  [À VALIDER : 3 ans]. Qui répond : le DPO ou un administrateur HandBase ?

**19. Violation de données (perte de téléphone, fuite).**
- Proposition : le membre prévient un admin tout de suite ; l'admin coupe le compte et prévient le DPO, qui juge
  s'il faut notifier la CNIL (72 h) et les familles. À valider.
