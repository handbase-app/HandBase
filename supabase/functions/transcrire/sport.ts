// HandBase : consignes de la fonction « transcrire » selon le sport de l'installation (champ « sport » des requêtes JSON :
// filtres, avis, question, sql, action ; l'appli l'envoie seulement hors handball, src/dictation/transcribe.ts sportField).
//
// - Handball (champ absent, « handball » ou sport inconnu) : les consignes d'index.ts TELLES QUELLES (rien n'est touché).
// - Volley : les mêmes consignes et les mêmes règles, avec les mots du volley : « entraîneur de volley », postes P (passeur),
//   R4 (réceptionneur-attaquant), C (central), PT (pointu), L (libéro, si l'installation l'a ajouté), gestes (service,
//   réception, attaque, contre, défense), catégories M13 / M15 / M18, Volleyades. Exemples refaits avec ces postes et les
//   critères du volley (public/demo/criteres-volley.json) : grilles « Joueur de champ », « Passeur », « Libéro »,
//   « Mental et comportement » ; un geste (« en attaque ») est un critère, pas une catégorie.
//
// Remplacements [texte du handball, texte du volley], faits dans l'ordre sur chaque consigne. Chaque texte du handball doit
// être présent dans sa consigne (vérifié par tools/test-volley-contenu.ts : une consigne du handball modifiée sans mettre ce
// fichier à jour fait échouer le test). Fichier pur (ni Deno ni réseau) : importé par index.ts, testé avec npx jiti.

/** Sport des consignes : « volley » (volley, volleyball, volley-ball), sinon « handball ». */
export type SportConsignes = 'handball' | 'volley'

export function sportDe(v: unknown): SportConsignes {
  if (typeof v !== 'string') return 'handball'
  const s = v.trim().toLowerCase().replace(/[\s_-]+/g, '')
  return s === 'volley' || s === 'volleyball' ? 'volley' : 'handball'
}

/** Consignes d'index.ts : liste Joueurs (CONSIGNES) et pages (CONSIGNES_PAGES), avis, question et ses contextes, sql, action. */
export type NomConsignes =
  | 'filtres'
  | 'bilan'
  | 'evenements'
  | 'groupes'
  | 'avis'
  | 'question'
  | 'joueurs'
  | 'contexte_evenements'
  | 'contexte_groupes'
  | 'sql'
  | 'action'

type Paire = readonly [string, string]

/** Dans toutes les consignes. */
const COMMUNS: readonly Paire[] = [
  ["entraîneur de handball", "entraîneur de volley"],
  ["appli de détection de handball", "appli de détection de volley"],
]

export const VOLLEY: Record<NomConsignes, readonly Paire[]> = {
  filtres: [
    ['« les gardiens de 2011 ».', '« les passeurs de 2011 ».'],
    ['« nés en 2010 ou 2011 », « U15 »).', '« nés en 2010 ou 2011 », « M15 »).'],
    [
      '« montre-moi les demi-centres du Pôle » → {"action":"remplacer","filtres":{"poste":"DC","pole":"en_cours"}',
      '« montre-moi les centraux du Pôle » → {"action":"remplacer","filtres":{"poste":"C","pole":"en_cours"}',
    ],
    ['Actuels {"departement":"83","poste":"PIV"} ;', 'Actuels {"departement":"83","poste":"R4"} ;'],
    [
      'Actuels {"annee":2010,"poste":"DC"} ; « sans condition d\'année mais des pivots » → {"action":"ajouter","filtres":{"poste":"PIV"}',
      'Actuels {"annee":2010,"poste":"C"} ; « sans condition d\'année mais des pointus » → {"action":"ajouter","filtres":{"poste":"PT"}',
    ],
    ['« les filles de 2011 de moins de 1 m 70 en U15 »', '« les filles de 2011 de moins de 1 m 70 en M15 »'],
    ['"nonGere":["moins de 1 m 70","U15"]', '"nonGere":["moins de 1 m 70","M15"]'],
  ],
  bilan: [],
  evenements: [['« à Toulon », « Intercomités »)', '« à Toulon », « Volleyades »)']],
  groupes: [
    ['(Intercomités, Pôle, sélections…)', '(Volleyades, Pôle, sélections…)'],
    ['(« Intercomités », « Pôle Espoirs », « sélection U15 »)', '(« Volleyades », « Pôle Espoirs », « sélection M15 »)'],
    ['« les Intercomités » → {"action":"remplacer","filtres":{"recherche":"Intercomités"}', '« les Volleyades » → {"action":"remplacer","filtres":{"recherche":"Volleyades"}'],
  ],
  avis: [
    ['(ex. "« voit bien le jeu » : Lecture du jeu ou Prise d\'information")', '(ex. "« toujours bien placé » : Déplacements ou Lecture du jeu")'],
    ['"correct", "moyen", "niveau attendu" : le milieu', '"correct", "moyen", "acquis" : le milieu'],
    ['le dit clairement ("très insuffisant").', 'le dit clairement ("en découverte", "débute tout juste").'],
    ['Exemple 1. Critères : c1 Vitesse (1-5), c2 Tir (1-5), c3 Défense (1-5).', 'Exemple 1. Critères : c1 Attaque (1-5), c2 Service (1-5), c3 Défense (1-5).'],
    ['Texte : "Très rapide, il explose sur les contre-attaques. Au tir c\'est correct."', 'Texte : "Remarquable en attaque, elle frappe très haut. Au service c\'est correct."'],
    [
      '{"id":"c1","valeur":5,"extrait":"il explose sur les contre-attaques","confiance":"forte"},{"id":"c2","valeur":3,"extrait":"Au tir c\'est correct","confiance":"forte"}],"pointsForts":"Très rapide, explosif en contre-attaque."',
      '{"id":"c1","valeur":5,"extrait":"Remarquable en attaque","confiance":"forte"},{"id":"c2","valeur":3,"extrait":"Au service c\'est correct","confiance":"forte"}],"pointsForts":"Attaque remarquable, frappe très haute."',
    ],
    ["Exemple 2. Critères : c1 Lecture du jeu (1-5), c2 Prise d'information (1-5), c3 Repli défensif (0-3).", 'Exemple 2. Critères : c1 Lecture du jeu (1-5), c2 Déplacements (1-5), c3 Contre (1-5).'],
    [
      'Texte : "Il voit bien le jeu. Par contre il doit travailler ses replis, il est souvent en retard."',
      'Texte : "Il est toujours bien placé. Par contre il doit travailler son contre, il saute souvent en retard."',
    ],
    [
      '{"id":"c3","valeur":1,"extrait":"il doit travailler ses replis","confiance":"moyenne"}],"pointsForts":"Bonne vision du jeu.","axes":"À travailler : les replis défensifs.","ambigus":["« Il voit bien le jeu » : Lecture du jeu ou Prise d\'information"]}',
      '{"id":"c3","valeur":2,"extrait":"il doit travailler son contre","confiance":"moyenne"}],"pointsForts":"Toujours bien placé.","axes":"À travailler : le timing au contre.","ambigus":["« Il est toujours bien placé » : Déplacements ou Lecture du jeu"]}',
    ],
  ],
  question: [
    [
      '- Avis : « en défense », « défenseurs » → moyenne de la catégorie Défense ; « note générale » → sur global ; notes sur 5. Un critère nommé (« vitesse », « explosivité ») → sur critere avec son nom.',
      '- Avis : un geste (« en attaque », « au service », « en réception », « en défense ») → sur critere avec son nom (Attaque, Service, Réception, Défense) ; une grille (« Joueur de champ », « Passeur », « Mental et comportement ») → sur categorie ; « note générale » → sur global ; notes sur 5. Un critère nommé (« précision de la passe », « concentration ») → sur critere avec son nom.',
    ],
    ['(« les plus rapides et les plus malins »)', '(« les meilleurs au service et en réception »)'],
    ['« moyenne de taille / de poids / au sprint »', '« moyenne de taille / de poids / de hauteur d\'attaque »'],
    [
      '« les meilleurs défenseurs nés en 2010 selon les avis » → {"recette":{"population":{"annee":2010},"sortie":{"type":"liste","tri":"moyenne","moyenne":{"sur":"categorie","nom":"Défense"}',
      '« les meilleurs en réception nés en 2010 selon les avis » → {"recette":{"population":{"annee":2010},"sortie":{"type":"liste","tri":"moyenne","moyenne":{"sur":"critere","nom":"Réception"}',
    ],
    ['« combien de gardiens 2009 mesurent plus de 1m85 » → {"recette":{"population":{"postes":["GB"]', '« combien de centraux 2009 mesurent plus de 1m85 » → {"recette":{"population":{"postes":["C"]'],
    [
      '« les pivots gauchers de la région Sud avec au moins 4 de moyenne en attaque » → {"recette":{"population":{"postes":["PIV"],"lateralite":"gaucher","regions":["Région Sud"]},"avis":[{"sur":"categorie","nom":"Attaque"',
      '« les pointus gauchers de la région Sud avec au moins 4 de moyenne en attaque » → {"recette":{"population":{"postes":["PT"],"lateralite":"gaucher","regions":["Région Sud"]},"avis":[{"sur":"critere","nom":"Attaque"',
    ],
    ['« les 2010 et 2011 du groupe Intercomités classés par taille »', '« les 2010 et 2011 du groupe Volleyades classés par taille »'],
    ['"groupes":["Intercomités"]', '"groupes":["Volleyades"]'],
    [
      '« les joueurs du tournoi de Cannes qui sautent plus de 40 au CMJ » → {"recette":{"population":{"evenements":["tournoi de Cannes"]},"mesures":[{"critere":"CMJ – hauteur","op":">=","valeur":40}]',
      '« les joueurs du tournoi de Cannes qui ont au moins 300 cm en hauteur d\'attaque » → {"recette":{"population":{"evenements":["tournoi de Cannes"]},"mesures":[{"critere":"Hauteur d’attaque","op":">=","valeur":300}]',
    ],
    ['« les gardiennes 2010 et 2012 du Var » → {"recette":{"population":{"sexe":"F","postes":["GB"]', '« les passeuses 2010 et 2012 du Var » → {"recette":{"population":{"sexe":"F","postes":["P"]'],
    [
      '« les demi-centres les plus rapides et les plus malins, nés en 2011 » → {"recette":{"population":{"postes":["DC"],"annee":2011},"sortie":{"type":"liste","tri":"moyenne","moyenne":{"sur":"combine","nom":["Vitesse","Intelligence de jeu"]}',
      '« les passeurs les plus précis et qui distribuent le mieux, nés en 2011 » → {"recette":{"population":{"postes":["P"],"annee":2011},"sortie":{"type":"liste","tri":"moyenne","moyenne":{"sur":"combine","nom":["Précision de la passe","Distribution et choix"]}',
    ],
    ['« quel club a le plus de pivots gauchers » → {"recette":{"population":{"postes":["PIV"]', '« quel club a le plus de pointus gauchers » → {"recette":{"population":{"postes":["PT"]'],
    [
      '« quelle est la taille moyenne des gardiennes nées en 2011 ? » → {"recette":{"population":{"sexe":"F","annee":2011,"postes":["GB"]}',
      '« quelle est la taille moyenne des centrales nées en 2011 ? » → {"recette":{"population":{"sexe":"F","annee":2011,"postes":["C"]}',
    ],
    [
      '« les joueurs vus par au moins 3 coachs mais jamais plus de 3 en défense » → {"recette":{"vus":{"compter":"personnes","op":">=","n":3},"avis":[{"sur":"categorie","nom":"Défense"',
      '« les joueurs vus par au moins 3 coachs mais jamais plus de 3 en défense » → {"recette":{"vus":{"compter":"personnes","op":">=","n":3},"avis":[{"sur":"critere","nom":"Défense"',
    ],
    [
      '« le nombre moyen de buts marqués par les pivots » → {"recette":{},"nonGere":["buts marqués : pas dans les données"]}',
      '« le nombre moyen de points marqués par les pointus » → {"recette":{},"nonGere":["points marqués : pas dans les données"]}',
    ],
  ],
  joueurs: [['(« efface tout et montre les gardiens » → effacer + postes GB)', '(« efface tout et montre les passeurs » → effacer + postes P)']],
  contexte_evenements: [
    [
      '« seulement les miens avec une feuille de match » → {"action":"ajouter","recette":{"mes":"les_miens","feuilleDeMatch":true}',
      '« seulement les miens avec une vidéo » → {"action":"ajouter","recette":{"mes":"les_miens","video":true}',
    ],
  ],
  contexte_groupes: [['(listes de joueurs : Intercomités, Pôle, sélections…)', '(listes de joueurs : Volleyades, Pôle, sélections…)']],
  sql: [
    [
      "catégorie (« en défense ») : jointure criteres sur critere_id et sans_accents(criteres.categorie) LIKE '%defens%' ; critère nommé : sans_accents(criteres.libelle).",
      "geste ou critère nommé (« en défense », « en attaque ») : jointure criteres sur critere_id et sans_accents(criteres.libelle) = 'defense' ; grille (« Joueur de champ », « Passeur », « Mental et comportement ») : sans_accents(criteres.categorie).",
    ],
    ["« quel club a le plus de pivots gauchers »", '« quel club a le plus de pointus gauchers »'],
    ["WHERE poste = 'PIV' AND lateralite = 'gaucher'", "WHERE poste = 'PT' AND lateralite = 'gaucher'"],
    ['"explication":"Clubs classés par nombre de pivots gauchers."', '"explication":"Clubs classés par nombre de pointus gauchers."'],
    [
      "WHERE n.joueur_id = j.id AND sans_accents(c.categorie) LIKE '%defens%' AND n.note_sur5 > 3)",
      "WHERE n.joueur_id = j.id AND sans_accents(c.libelle) = 'defense' AND n.note_sur5 > 3)",
    ],
    ['« les joueurs qui peuvent aussi jouer pivot »', '« les joueurs qui peuvent aussi jouer central »'],
    ["LIKE '%,PIV,%'", "LIKE '%,C,%'"],
    ['"explication":"Joueurs qui ont pivot dans leurs postes secondaires."', '"explication":"Joueurs qui ont central dans leurs postes secondaires."'],
    ["AND n.valide = 1 AND sans_accents(c.categorie) LIKE '%attaque%'", "AND n.valide = 1 AND sans_accents(c.libelle) = 'attaque'"],
    ["« les joueurs du groupe Intercomités qui n'ont pas encore de mesure de CMJ »", "« les joueurs du groupe Volleyades qui n'ont pas encore de mesure de hauteur d'attaque »"],
    ["LIKE '%intercomites%'", "LIKE '%volleyades%'"],
    ["sans_accents(c.libelle) LIKE 'cmj%'", "sans_accents(c.libelle) LIKE 'hauteur d%attaque%'"],
    ['"explication":"Joueurs du groupe Intercomités sans mesure de CMJ pour l\'instant."', '"explication":"Joueurs du groupe Volleyades sans mesure de hauteur d\'attaque pour l\'instant."'],
    ['« le gardien le plus grand de chaque département »', '« le central le plus grand de chaque département »'],
    ["WHERE poste = 'GB' AND taille_cm IS NOT NULL", "WHERE poste = 'C' AND taille_cm IS NOT NULL"],
    ['"explication":"Dans chaque département, le gardien avec la plus grande taille mesurée."', '"explication":"Dans chaque département, le central avec la plus grande taille mesurée."'],
  ],
  action: [
    ['« la liste des gardiens du tournoi X »', '« la liste des passeurs du tournoi X »'],
    ['(« les gardiennes du groupe X »)', '(« les passeuses du groupe X »)'],
    ['« gardiens » → postes ["GB"]', '« passeurs » → postes ["P"]'],
    [
      '« mets les gardiens de 2011 du Var dans le groupe Pôle Aix » → {"action":"ajouter_groupe","cible":"Pôle Aix","joueurs":{"population":{"postes":["GB"]',
      '« mets les passeurs de 2011 du Var dans le groupe Pôle Aix » → {"action":"ajouter_groupe","cible":"Pôle Aix","joueurs":{"population":{"postes":["P"]',
    ],
    [
      '« ajoute les pivots gauchers au tournoi de Cannes » → {"action":"ajouter_evenement","cible":"tournoi de Cannes","joueurs":{"population":{"postes":["PIV"]',
      '« ajoute les pointus gauchers au tournoi de Cannes » → {"action":"ajouter_evenement","cible":"tournoi de Cannes","joueurs":{"population":{"postes":["PT"]',
    ],
    [
      '« les gardiennes du groupe Pôle Aix » → {"action":"ouvrir_groupe","cible":"Pôle Aix","joueurs":{"population":{"sexe":"F","postes":["GB"]}',
      '« les passeuses du groupe Pôle Aix » → {"action":"ouvrir_groupe","cible":"Pôle Aix","joueurs":{"population":{"sexe":"F","postes":["P"]}',
    ],
    ['« retire les gauchers du groupe Intercomités »', '« retire les gauchers du groupe Volleyades »'],
  ],
}

/** Remplacements d'une consigne pour un sport (communs, puis propres à la consigne) ; handball : aucun. */
export const remplacements = (nom: NomConsignes, sport: SportConsignes): readonly Paire[] => (sport === 'volley' ? [...COMMUNS, ...VOLLEY[nom]] : [])

/**
 * Consigne du sport : handball, le texte d'index.ts inchangé ; volley, chaque texte du handball remplacé (toutes ses
 * occurrences) par celui du volley.
 */
export function consignesDuSport(texte: string, nom: NomConsignes, sport: SportConsignes): string {
  let t = texte
  for (const [de, vers] of remplacements(nom, sport)) t = t.split(de).join(vers)
  return t
}
