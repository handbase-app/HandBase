// Texte de calibration de la dictée (page d'essai) : texte original et fictif, sans aucune personne réelle
// (numéros de maillot seulement, aucun nom). Environ 2 minutes de lecture, en paragraphes courts.
// Il mêle postes, gestes, systèmes, règles, termes de gardien, qualités, catégories, nombres et scores,
// et quelques pièges d'homophones (sert / serre, axée / âgée, poing / point, lancer / lancé).

export const paragraphes = [
  "Match de U17 aux Interligues, la salle est pleine. Le numéro 7, demi-centre gaucher, accélère la montée de balle et sert le pivot dans le dos de la défense 0-6. Le pivot serre les dents, se retourne et marque en suspension.",
  "À la 23e minute, le score est de 12 à 10. L'adversaire passe en défense 3-2-1, très haute et axée sur l'interception. La numéro 4, arrière droite âgée de seize ans, enchaîne un croisé puis une sortie de bloc derrière un écran du pivot.",
  "Sur une contre-attaque, l'ailier gauche numéro 3 tente une roucoulette, puis une chabala au-dessus du gardien. Plus tard, un kung-fu sur l'aile et un flyer bien lancé font lever le public. Le kempa reste à travailler.",
  "Le numéro 9 arme un tir à la hanche à 9 mètres, le ballon frappe le poteau. L'arbitre lève le bras : jeu passif. Sur la dernière attaque, une faute vaut au numéro 14 un carton jaune, puis une exclusion de 2 minutes.",
  "Le gardien numéro 1 sort la parade sur le jet de 7 mètres. Bon placement, arrêt réflexe du pied, puis une relance rapide vers l'ailier droit. Il lève le poing pour encourager sa défense étagée.",
  "En fin de match, l'entraîneur tente le 7 contre 6 avec un gardien volant. En face, une défense 5+1 harcèle le demi-centre. Chaque point compte et chaque ballon perdu se paie cher : 24 à 23 à deux minutes de la fin.",
  "Profil à suivre pour le Pôle Espoirs : explosivité, détente, envergure, lecture du jeu et prise de décision. Il doit encore lancer plus fort sur ses appuis et garder son calme en 1 contre 1.",
  "Un U15 mature et combatif, avec une belle marge de progression. À revoir en stage de détection, en attaque placée comme en repli défensif.",
]

// Termes du hand présents dans le texte, en plus du vocabulaire (vocabulaire.js) : servent à reconnaître
// un mot de jargon mal entendu qui manque aux mots de contexte de Voxtral.
export const termes = [
  'demi-centre', 'gaucher', 'montée de balle', 'pivot', 'défense 0-6', 'en suspension', 'défense 3-2-1', 'interception',
  'arrière droite', 'croisé', 'sortie de bloc', 'écran', 'contre-attaque', 'ailier gauche', 'roucoulette', 'chabala',
  'kung-fu', 'flyer', 'kempa', 'tir à la hanche', '9 mètres', 'poteau', 'jeu passif', 'carton jaune', 'exclusion de 2 minutes',
  'gardien', 'parade', 'jet de 7 mètres', 'placement', 'arrêt réflexe', 'relance', 'ailier droit', 'défense étagée',
  '7 contre 6', 'gardien volant', 'défense 5+1', 'Pôle Espoirs', 'explosivité', 'détente', 'envergure', 'lecture du jeu',
  'prise de décision', 'appuis', '1 contre 1', 'U15', 'U17', 'Interligues', 'marge de progression', 'stage de détection',
  'attaque placée', 'repli défensif',
]
