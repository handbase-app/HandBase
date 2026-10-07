# HandBase — Brouillon de notice de confidentialité

> Brouillon à faire valider par le DPO. Les crochets sont à remplir une fois les décisions prises
> (voir `questions_dpo.md`). Partie A : notice complète (staff), destinée à remplacer le texte de la page
> *Réglages → Confidentialité*. Partie B : notice courte pour les joueurs et leurs parents.

---

## Partie A — Notice complète

### 1. À quoi sert HandBase ?
HandBase est l'outil du staff de détection de [À COMPLÉTER : Fédération / Ligue / Comité] pour repérer et suivre
les jeunes joueuses et joueurs de handball : mesures et tests physiques, avis des observateurs, groupes,
rassemblements et sélections. Les données ne servent qu'à cela : ni vente, ni publicité, ni décision automatique
(les calculs de l'appli aident le staff, ils ne décident pas à sa place).

### 2. Qui est responsable ?
- Responsable du traitement : [À COMPLÉTER : responsable du traitement, adresse].
- Délégué à la protection des données : [À COMPLÉTER : contact DPO].
- Hébergement et maintenance de l'appli : Geoffroy Krantz et Stef Bascher, sous-traitants, pour le compte du
  responsable du traitement.
- Base légale : [À VALIDER : mission d'intérêt général de détection confiée à la fédération / intérêt légitime].

### 3. Quelles données sur les joueurs ?
- **Identité et licence**, en grande partie importées de **Gest'Hand** (la base des licences de la Fédération) :
  nom, prénom, sexe, date de naissance, nationalité, club et numéro de club, numéro et état de la licence,
  département, catégorie, équipe.
- **Profil sportif** : poste(s), latéralité, internat (oui / non), groupes, événements et rassemblements suivis,
  photo (facultative).
- **Mesures et tests physiques** : taille, poids, taille assise, envergure, vitesse, sauts, force, gainage,
  **tests de mobilité** (cheville, épaule, hanche…), avec un commentaire possible ; tailles de la mère et du père
  (facultatives, sans leur nom).
- **Calculs automatiques** : maturité (avance ou retard de croissance), taille adulte prédite.
- **Avis des observateurs** : notes sur le jeu (attaque, défense, intelligence de jeu, mental & attitude :
  engagement, gestion de la pression, concentration, leadership, fair-play), points forts, points à travailler,
  signés par leur auteur.
- **Suivi** : qui a proposé, validé ou mis « hors cadre » une fiche, et pourquoi.
- **Données de santé** : [À VALIDER selon l'avis du DPO — soit : « Les mesures physiques et la maturité calculée
  sont des données sportives ; aucune information médicale (blessure, maladie, traitement) ne doit être
  enregistrée » ; soit : « Certaines mesures sont considérées comme des données de santé ; elles sont
  enregistrées avec [base / consentement] et protégées ainsi : … »].
- Aucune coordonnée des parents ou du joueur n'est enregistrée.

### 4. Quelles données sur le staff ?
Nom, e-mail, téléphone, rôle, départements suivis, préférences de notifications, et le nom de l'auteur de chaque
fiche, mesure ou avis. Le **journal d'activité** garde qui a fait quoi, quand, avec l'ancienne et la nouvelle valeur.
Les **connexions** (heures d'utilisation de l'appli et type d'appareil, sans adresse IP) sont visibles des administrateurs seuls et effacées après **6 mois**.

### 5. Qui voit quoi ?
Seulement le staff, avec un compte personnel créé par un administrateur (pas d'inscription libre) :
- **tous les membres** voient toutes les fiches joueurs, leurs mesures et les avis ;
- groupes et alertes **privés** : leur créateur seul ;
- journal d'activité : administrateurs seuls ;
- export Excel (CSV) des joueurs affichés : [À VALIDER : tout le staff / encadrants et administrateurs] ;
  sauvegarde complète : administrateurs ; copie complète d'un joueur : encadrants et administrateurs.

Chaque membre a accepté la charte d'utilisation (pas de données de santé, rester factuel, ne rien sortir de l'appli).

### 6. Où sont les données, et qui d'autre y touche ?
- **Serveur** : Supabase, centre de données de Zurich (**Suisse**, pays reconnu par l'Union européenne comme
  protégeant correctement les données).
- **Programme de l'appli** : GitHub Pages (**États-Unis**). Il ne contient aucune donnée de joueur ; GitHub voit
  l'adresse IP de l'appareil qui ouvre l'appli.
- **Notifications** (si le membre les active) : elles passent par le service de son téléphone ou navigateur
  (Apple, Google, Mozilla, en partie aux États-Unis) ; leur texte peut contenir [À VALIDER : le nom d'un joueur et
  d'un observateur / aucun nom].
- **Accès du staff** : l'administrateur envoie l'accès par e-mail, SMS ou WhatsApp, avec un mot de passe provisoire
  valable 24 h, à remplacer à la première connexion.
- **Sur les appareils du staff** : pour fonctionner sans réseau, l'appli garde une copie de la base sur le
  téléphone ou l'ordinateur, [À VALIDER : effacée à la déconnexion et après N jours sans connexion]. Le téléphone
  doit être verrouillé.
- Transferts hors Union européenne : Suisse (décision d'adéquation) ; États-Unis (GitHub, services de
  notification) : [À VALIDER : Data Privacy Framework / clauses contractuelles types].

### 7. Combien de temps ?
- Fiche proposée par un observateur et jamais traitée : effacée automatiquement après **12 mois**.
- Fiche supprimée : effacée définitivement après **30 jours** (le temps de la retirer de tous les appareils et de
  revenir sur une erreur), y compris dans le journal d'activité.
- Joueur suivi : [À VALIDER : durée].
- Joueur mis « hors cadre » : [À VALIDER : durée].
- Journal d'activité : [À VALIDER : durée].
- Notifications : 30 jours. Compte d'un membre du staff qui part : [À VALIDER : durée].
- Sauvegardes du serveur : [À VALIDER : durée].

### 8. Les droits des joueurs et des parents
Le joueur, ou ses parents s'il est mineur, peut demander : une copie de toutes ses données (avis compris), leur
correction, leur effacement, la limitation de leur utilisation, ou s'y opposer.
- Comment : écrire à [À COMPLÉTER : contact DPO / adresse dédiée], ou le dire à un membre du staff qui transmet
  à un administrateur.
- Réponse sous **un mois**. La copie est une page lisible (à imprimer ou en PDF) avec toute la fiche.
- En cas de désaccord : réclamation possible auprès de la CNIL (cnil.fr).

Les membres du staff ont les mêmes droits sur leurs propres données.

### 9. Sécurité
Comptes personnels, mots de passe provisoires limités à 24 h, droits vérifiés par le serveur selon le rôle,
connexion chiffrée (HTTPS), journal de toutes les modifications, effacements automatiques ci-dessus. En cas de perte
d'un appareil, prévenir tout de suite un administrateur, qui coupe l'accès.

*Version [À COMPLÉTER : date].*

---

## Partie B — Notice courte pour les joueurs et les parents

### Tes données dans HandBase

**C'est quoi ?** HandBase est l'application des entraîneurs et observateurs de la détection de
[À COMPLÉTER : structure]. Ils s'en servent pour repérer les jeunes handballeuses et handballeurs, suivre leurs
progrès et organiser les stages et les sélections.

**Qu'est-ce qu'on y note sur toi ?**
- Ton nom, ta date de naissance, ton club et ta licence (ils viennent de Gest'Hand, le fichier des licences de la
  Fédération).
- Ton poste, ta main ou ton pied fort, et parfois ta photo.
- Tes mesures et tes tests physiques (taille, poids, vitesse, sauts, souplesse…), et parfois la taille de tes
  parents pour estimer ta taille d'adulte.
- Ce que les observateurs pensent de ton jeu (notes et commentaires).
- [À VALIDER : phrase sur les données de santé, selon la décision du DPO.]

**Qui peut le voir ?** Seulement les entraîneurs et observateurs de la détection, avec un compte personnel.
Ce n'est jamais vendu ni publié.

**Où ?** Sur un serveur en Suisse, et sur les téléphones des entraîneurs pour que l'appli marche sans internet.

**Pendant combien de temps ?** [À VALIDER : durée, par exemple « jusqu'à la fin de tes années jeunes »]. Une fiche
supprimée est effacée pour de bon au bout de 30 jours.

**Tes droits.** Toi ou tes parents pouvez demander à **voir tout ce qui est écrit sur toi**, le faire corriger,
le faire effacer ou refuser d'être suivi. Il suffit d'écrire à [À COMPLÉTER : contact DPO] ou d'en parler à un
entraîneur. On répond en moins d'un mois. Si ça ne va pas, vous pouvez vous adresser à la CNIL (cnil.fr).

Responsable : [À COMPLÉTER : responsable du traitement]. Notice complète : [À COMPLÉTER : lien].
