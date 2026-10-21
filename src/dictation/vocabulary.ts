// Vocabulaire du handball pour la dictée (source de vérité ; la page d'essai public/essai-dictee/vocabulaire.js en
// garde une copie en JavaScript). Données seules :
// - vocabulaire : termes par thème ; motsCles : liste à plat ;
// - motsVoxtral : mots de contexte envoyés à Voxtral (Mistral, champ context_bias : 100 au plus) ;
// - corrections : erreurs de reconnaissance fréquentes et leur forme juste, volontairement prudentes
//   (une correction fausse est pire qu'aucune). « faux » est une chaîne (comparée sans tenir compte
//   des majuscules ni des accents, mot entier) ou une RegExp (appliquée telle quelle, drapeaux gardés).
//   « juste » peut contenir $1, $2… pour une RegExp, ou être une fonction (comme pour String.replace).

export type Correction = { faux: string | RegExp; juste: string | ((m: string, ...groups: string[]) => string) }

export const vocabulaire: Record<string, string[]> = {
  postes: [
    'gardien', 'gardienne', 'ailier gauche', 'ailier droit', 'ailière', 'arrière gauche', 'arrière droit',
    'demi-centre', 'pivot', 'base arrière', 'arrière', 'ailier', 'défenseur avancé', 'défenseur central',
    'défenseur latéral', 'stoppeur', 'poste 1', 'poste 2', 'poste 3', 'poste 4', 'poste 5', 'poste 6',
    'joker', 'meneur de jeu', 'gaucher', 'droitier', 'ambidextre',
  ],
  gestes: [
    'chabala', 'roucoulette', 'kung-fu', 'flyer', 'kempa', 'lob', 'tir en suspension', "tir à l'appui", 'tir en appui',
    'tir hanche', 'tir à la hanche', 'tir en rotation', 'tir désaxé', 'tir en force', 'tir en finesse', 'tir à rebond',
    'tir croisé', 'tir plongé', 'tir en extension', 'feinte de tir', 'feinte de passe', 'feinte de corps', 'feinte',
    'dribble', 'double dribble', 'marcher', 'passage en force', 'croisé', 'contre-croisé', 'écran', 'bloc',
    'sortie de bloc', 'débordement', 'décalage', 'fixation', 'relais', 'passe à terre', 'passe dans le dos',
    'passe aveugle', 'passe en cloche', 'passe décisive', 'renversement', 'montée de balle', 'contre-attaque',
    'montée rapide', 'engagement rapide', 'repli défensif', 'retour défensif', '1 contre 1', '2 contre 1',
    '2 contre 2', 'duel', 'interception', 'contre', 'dissuasion', 'harcèlement', 'neutralisation', 'aide défensive',
    'glissement', 'changement de rythme', 'changement d\'appui', 'appel de balle', 'jeu sans ballon', 'transition',
  ],
  systemes: [
    'défense 0-6', 'défense 1-5', 'défense 3-2-1', 'défense 5+1', 'défense 4+2', 'défense 3-3', 'homme à homme',
    'défense étagée', 'défense alignée', 'défense de zone', 'zone', 'défense individuelle', 'individuelle',
    '7 contre 6', 'gardien volant', 'surnombre', 'infériorité numérique', 'supériorité numérique', 'attaque placée',
    'jeu en continuité', 'enclenchement', 'combinaison', 'circulation de balle',
  ],
  regles: [
    'jet de 7 mètres', '7 mètres', 'coup franc', 'jet franc', '9 mètres', 'zone', '6 mètres', 'temps mort',
    'exclusion de 2 minutes', '2 minutes', 'avertissement', 'carton jaune', 'carton rouge', 'carton bleu',
    'disqualification', 'renvoi', 'remise en jeu', 'engagement', 'passif', 'jeu passif', 'mi-temps',
    'prolongation', 'empiètement', 'faute', 'jet de coin',
  ],
  gardien: [
    'parade', 'arrêt réflexe', 'arrêt', 'sortie', 'placement', 'relance', 'renvoi', 'couverture de but',
    'papillon', 'grand écart', 'face à face', 'tir à 7 mètres arrêté', 'jeu au pied',
  ],
  profil: [
    'vitesse', 'explosivité', 'détente', 'appuis', 'coordination', 'gabarit', 'envergure', 'puissance',
    'endurance', 'agilité', 'lecture du jeu', 'vision du jeu', "prise d'information", 'prise de décision',
    'intelligence de jeu', 'leadership', 'engagement', 'combativité', 'concentration', 'latéralité', 'gaucher',
    'droitier', 'maturité', 'marge de progression', 'potentiel',
  ],
  parcours: [
    'U11', 'U12', 'U13', 'U14', 'U15', 'U16', 'U17', 'U18', 'Pôle Espoirs', 'PPF', 'sélection',
    'détection', 'stage', 'tournoi', 'Interligues', 'Intercomités', 'comité', 'ligue', 'club formateur',
  ],
}

export const motsCles = [...new Set(Object.values(vocabulaire).flat())]

const NUM: Record<string, string> = { un: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6', sept: '7', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7' }
// « une » seulement dans « une contre une » : « 1 contre une défense » serait faux.
const N = '(un|deux|trois|quatre|cinq|six|sept|[1-7])'
// Bornes de mot tenant compte des lettres accentuées.
const G = '(?<![\\p{L}\\p{N}])'
const D = '(?![\\p{L}\\p{N}])'

export const corrections: Correction[] = [
  // Gestes
  { faux: 'roue coulette', juste: 'roucoulette' },
  { faux: 'roux coulette', juste: 'roucoulette' },
  { faux: 'rou coulette', juste: 'roucoulette' },
  { faux: 'roue-coulette', juste: 'roucoulette' },
  { faux: 'chabalah', juste: 'chabala' },
  { faux: 'chabala', juste: 'chabala' }, // « châbala » → « chabala » (accents tolérés)
  { faux: 'shabala', juste: 'chabala' },
  { faux: 'chaballa', juste: 'chabala' },
  { faux: 'chabbala', juste: 'chabala' },
  { faux: 'cha bala', juste: 'chabala' },
  { faux: 'kung fu', juste: 'kung-fu' },
  { faux: 'kungfu', juste: 'kung-fu' },
  { faux: 'kung fou', juste: 'kung-fu' },
  { faux: 'kung-fou', juste: 'kung-fu' },
  { faux: 'kong fu', juste: 'kung-fu' },
  { faux: 'flayer', juste: 'flyer' },
  { faux: 'flaïer', juste: 'flyer' },
  { faux: 'flaïeur', juste: 'flyer' },
  { faux: 'contre attaque', juste: 'contre-attaque' },
  { faux: 'contre attaques', juste: 'contre-attaques' },
  { faux: 'contre croisé', juste: 'contre-croisé' },
  { faux: 'repis', juste: 'repli' },
  { faux: 'rempli défensif', juste: 'repli défensif' },
  // 1 contre 1, 2 contre 1, 7 contre 6…
  { faux: 'racontre un', juste: '1 contre 1' },
  { faux: 'en contraint', juste: 'en 1 contre 1' },
  { faux: 'une contre une', juste: '1 contre 1' },
  { faux: new RegExp(G + N + '[ -]contre[ -]' + N + D, 'giu'), juste: (_m, a, b) => NUM[a.toLowerCase()] + ' contre ' + NUM[b.toLowerCase()] },
  // Postes
  { faux: 'demi centre', juste: 'demi-centre' },
  { faux: 'demi sentre', juste: 'demi-centre' },
  { faux: 'demi-sentre', juste: 'demi-centre' },
  { faux: new RegExp(G + '(?:2[.,]00 ?m|deux m[eè]tres?)[ -]centre' + D, 'giu'), juste: 'demi-centre' },
  { faux: 'lieux gauche', juste: "l'ailier gauche" },
  { faux: 'lieu gauche', juste: "l'ailier gauche" },
  { faux: 'liégoches', juste: "l'ailier gauche" },
  { faux: 'liégoche', juste: "l'ailier gauche" },
  { faux: 'lié gauche', juste: "l'ailier gauche" },
  { faux: 'lieux droit', juste: "l'ailier droit" },
  { faux: 'lié droit', juste: "l'ailier droit" },
  { faux: 'bas arrière', juste: 'base arrière' },
  { faux: 'pivo', juste: 'pivot' },
  // « gardé » pour « gardien », seulement après un déterminant et jamais dans « gardé à vue »
  { faux: new RegExp(G + '(du|le|au|son|leur|un|ce) gard[ée]' + D + '(?! à vue)', 'giu'), juste: '$1 gardien' },
  // Distances et zones
  { faux: 'neuf mètres', juste: '9 mètres' },
  { faux: 'sept mètres', juste: '7 mètres' },
  { faux: 'six mètres', juste: '6 mètres' },
  { faux: new RegExp(G + '([679]) ?m' + D, 'gu'), juste: '$1 mètres' },
  // Systèmes de défense (seulement après « défense »)
  { faux: new RegExp(G + '(défense) (?:zéro|0)[ -](?:six|6)' + D, 'giu'), juste: '$1 0-6' },
  { faux: new RegExp(G + '(défense) (?:un|1)[ -](?:cinq|5)' + D, 'giu'), juste: '$1 1-5' },
  { faux: new RegExp(G + '(défense) (?:trois|3)[ -](?:deux|2)[ -](?:un|1)' + D, 'giu'), juste: '$1 3-2-1' },
  { faux: new RegExp(G + '(défense) (?:cinq|5) ?(?:plus|\\+) ?(?:un|1)' + D, 'giu'), juste: '$1 5+1' },
  { faux: new RegExp(G + '(défense) (?:quatre|4) ?(?:plus|\\+) ?(?:deux|2)' + D, 'giu'), juste: '$1 4+2' },
  // Parcours
  { faux: new RegExp(G + 'u[ -]?(1[1-8])' + D, 'giu'), juste: 'U$1' },
  { faux: new RegExp(G + '(?:paul|pole|pôle) espoirs?' + D, 'giu'), juste: 'Pôle Espoirs' },
  { faux: 'inter ligue', juste: 'Interligues' },
  { faux: 'inter ligues', juste: 'Interligues' },
  { faux: 'inter comité', juste: 'Intercomités' },
  { faux: 'inter comités', juste: 'Intercomités' },
]

// Mots de contexte pour Voxtral (Mistral, champ context_bias : 100 au plus) : le jargon le plus rare,
// les mots courants (« contre », « zone »…) n'en ont pas besoin.
export const motsVoxtral: string[] = [
  'demi-centre', 'pivot', 'ailier gauche', 'ailier droit', 'arrière gauche', 'arrière droit', 'base arrière',
  'défenseur avancé', 'gardien', 'gaucher', 'droitier',
  'chabala', 'roucoulette', 'kung-fu', 'flyer', 'kempa', 'lob', 'tir en suspension', "tir à l'appui", 'tir à la hanche',
  'tir en rotation', 'tir désaxé', 'tir à rebond', 'feinte de tir', 'feinte de passe', 'feinte de corps',
  'double dribble', 'passage en force', 'croisé', 'contre-croisé', 'écran', 'sortie de bloc', 'débordement',
  'décalage', 'fixation', 'renversement', 'montée de balle', 'contre-attaque', 'engagement rapide',
  'repli défensif', 'retour défensif', '1 contre 1', '2 contre 1', 'interception', 'dissuasion', 'harcèlement',
  'défense 0-6', 'défense 1-5', 'défense 3-2-1', 'défense 5+1', 'défense 4+2', 'homme à homme', 'défense étagée',
  'défense alignée', '7 contre 6', 'gardien volant', 'surnombre', 'infériorité numérique', 'supériorité numérique',
  'jet de 7 mètres', '9 mètres', '6 mètres', 'jet franc', 'jeu passif', 'temps mort', 'exclusion de 2 minutes',
  'carton bleu', 'parade', 'arrêt réflexe', 'relance', 'couverture de but', 'papillon', 'grand écart',
  'explosivité', 'détente', 'appuis', 'envergure', 'gabarit', 'lecture du jeu', 'vision du jeu',
  "prise d'information", 'prise de décision', 'latéralité', 'Pôle Espoirs', 'PPF', 'Interligues', 'Intercomités',
  'U13', 'U15', 'U17', 'U18',
]

// ---------- Volley ----------
// Vocabulaire du volley en salle (usages de la détection et de la filière fédérale) : postes (passeur, réceptionneur-attaquant
// ou R4, pointu, central, libéro), gestes, zones, tests et filière (CDE, CRE, Volleyades, Interpôles…). Mots du terrain en
// français : « attaque » (pas « smash »), « défense » (pas « dig »), « contre » ou « bloc ». Aucun terme du handball.

export const vocabulaireVolley: Record<string, string[]> = {
  postes: [
    'passeur', 'passeuse', 'réceptionneur-attaquant', 'réceptionneuse-attaquante', 'R4', 'pointu', 'pointue', 'opposé',
    'opposée', 'central', 'centrale', 'libéro', 'polyvalent', 'poste 2', 'poste 3', 'poste 4', 'gaucher', 'droitier',
    'ambidextre',
  ],
  gestes: [
    'service', 'service flottant', 'service sauté', 'service sauté flottant', 'service smashé', 'ace', 'réception',
    'manchette', 'plateforme', 'passe', 'passe haute', 'passe à dix doigts', 'passe arrière', 'passe en suspension',
    'deuxième main', 'première main', 'décalée', 'tempo', 'jeu rapide', 'attaque', 'attaque de la ligne arrière',
    'attaque rapide', "course d'élan", 'frappe', 'feinte', 'ligne', 'diagonale', 'sortie de contre', 'contre',
    'contre offensif', 'contre à deux', 'bloc', 'défense', 'plongeon', 'roulade', 'couverture', 'balle facile',
    'contre-attaque', 'transition', 'jeu sans ballon',
  ],
  systemes: [
    'zone 1', 'zone 2', 'zone 3', 'zone 4', 'zone 5', 'zone 6', 'ligne des 3 mètres', 'ligne de fond', 'filet', '5-1', '4-2',
    'rotation', 'système de réception',
  ],
  regles: [
    'faute de filet', 'faute de pied', 'ballon dehors', 'touche de contre', 'quatre touches', 'double touche', 'temps mort',
    'set', 'tie-break', 'échange', 'remplacement',
  ],
  profil: [
    'taille', 'taille assise', 'envergure', 'atteinte', 'détente', 'hauteur d\'attaque', 'hauteur de contre', 'CMJ', 'T-test',
    'médecine-ball', 'taille adulte prédite', 'pic de croissance', 'maturité', 'vitesse', 'explosivité', 'appuis',
    'coordination', 'lecture du jeu', 'anticipation', 'prise de décision', 'leadership', 'engagement', 'combativité',
    'concentration', 'persévérance', "esprit d'équipe", 'autonomie', 'latéralité', 'marge de progression', 'potentiel',
  ],
  parcours: [
    'M11', 'M13', 'M15', 'M18', 'M21', 'CDE', 'CRE', 'CEP', 'ETD', 'ETR', 'CTS', 'DTN', 'PPF', 'Pôle Espoirs', 'Pôle France',
    'CNVB', 'Volleyades', 'Mini-Volleyades', 'Interpôles', 'TSD', 'sélection départementale', 'sélection régionale',
    'détection', 'stage', 'tournoi', 'comité', 'ligue', 'club formateur', 'CFCP', 'Élite Avenir', 'Coupe de France jeunes',
    'Relève', 'double projet',
  ],
}

export const motsClesVolley = [...new Set(Object.values(vocabulaireVolley).flat())]

const ZONE: Record<string, string> = { un: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6' }

// Prudentes, comme celles du handball : formes écrites des termes du volley, sigles des catégories, noms des compétitions.
export const correctionsVolley: Correction[] = [
  { faux: 'libero', juste: 'libéro' },
  { faux: 'liberos', juste: 'libéros' },
  { faux: 'manchete', juste: 'manchette' },
  { faux: 'man chette', juste: 'manchette' },
  { faux: 'contre attaque', juste: 'contre-attaque' },
  { faux: 'contre attaques', juste: 'contre-attaques' },
  { faux: 'tie break', juste: 'tie-break' },
  { faux: 'service smash', juste: 'service smashé' },
  { faux: 'medecine ball', juste: 'médecine-ball' },
  { faux: new RegExp(G + '(passe|touche) à 10 doigts' + D, 'giu'), juste: '$1 à dix doigts' },
  // Zones et postes dits en lettres : « zone quatre » → « zone 4 ».
  { faux: new RegExp(G + '(zone|poste) (un|deux|trois|quatre|cinq|six)' + D, 'giu'), juste: (_m, a, b) => `${a} ${ZONE[b.toLowerCase()]}` },
  // Sigles : « R 4 », « M 15 », « T test », « c m j » (majuscules seulement pour R et M : « 1 m 15 » n'est pas une catégorie).
  { faux: new RegExp(G + 'R[ -](?:4|quatre)' + D, 'gu'), juste: 'R4' },
  { faux: new RegExp(G + 'M[ -](11|13|15|18|21)' + D, 'gu'), juste: 'M$1' },
  { faux: new RegExp(G + 't[ -]?test' + D, 'giu'), juste: 'T-test' },
  { faux: new RegExp(G + 'c[ .]m[ .]j' + D, 'giu'), juste: 'CMJ' },
  // Compétitions et structures.
  { faux: new RegExp(G + 'mini[ -]?volley[ -]?ades?' + D, 'giu'), juste: 'Mini-Volleyades' },
  { faux: new RegExp(G + '(?<!mini[ -])volley[ -]?ades?' + D, 'giu'), juste: 'Volleyades' },
  { faux: new RegExp(G + 'inter[ -]?p[oô]les?' + D, 'giu'), juste: 'Interpôles' },
  { faux: new RegExp(G + '(?:paul|pole|pôle) espoirs?' + D, 'giu'), juste: 'Pôle Espoirs' },
  { faux: new RegExp(G + '(?:pole|pôle) france' + D, 'giu'), juste: 'Pôle France' },
]

// Mots de contexte pour Voxtral (100 au plus) : le jargon du volley le plus rare (les mots courants n'en ont pas besoin).
export const motsVoxtralVolley: string[] = [
  'passeur', 'passeuse', 'réceptionneur-attaquant', 'réceptionneuse-attaquante', 'R4', 'pointu', 'pointue', 'opposé',
  'central', 'centrale', 'libéro', 'polyvalent',
  'service flottant', 'service sauté', 'service smashé', 'ace', 'réception', 'manchette', 'plateforme', 'passe haute',
  'passe à dix doigts', 'passe arrière', 'passe en suspension', 'deuxième main', 'décalée', 'tempo', 'jeu rapide',
  'attaque de la ligne arrière', "course d'élan", 'feinte', 'diagonale', 'sortie de contre', 'contre offensif',
  'contre à deux', 'plongeon', 'roulade', 'couverture', 'balle facile', 'contre-attaque', 'transition', 'jeu sans ballon',
  'ligne des 3 mètres', 'zone 1', 'zone 2', 'zone 3', 'zone 4', 'zone 5', 'zone 6', '5-1', 'rotation', 'faute de filet',
  'faute de pied', 'touche de contre', 'double touche', 'tie-break',
  'envergure', 'atteinte', 'détente', "hauteur d'attaque", 'hauteur de contre', 'CMJ', 'T-test', 'médecine-ball',
  'taille assise', 'taille adulte prédite', 'pic de croissance', 'maturité', 'appuis', 'lecture du jeu', 'anticipation',
  'prise de décision', 'latéralité',
  'M13', 'M15', 'M18', 'M21', 'CDE', 'CRE', 'CEP', 'ETD', 'ETR', 'CTS', 'PPF', 'Pôle Espoirs', 'Pôle France', 'CNVB',
  'Volleyades', 'Mini-Volleyades', 'Interpôles', 'TSD', 'sélection départementale', 'sélection régionale', 'double projet',
]

// ---------- Par sport ----------

export type SportVocabulary = { mots: readonly string[]; corrections: readonly Correction[] }

/**
 * Vocabulaire de dictée de chaque sport (src/sportConfig.ts, currentSport().sport) : mots de contexte envoyés à Voxtral et
 * corrections. Handball et volley ; un sport absent : rien d'injecté.
 */
export const VOCABULAIRE_PAR_SPORT: Record<string, SportVocabulary> = {
  handball: { mots: motsVoxtral, corrections },
  volley: { mots: motsVoxtralVolley, corrections: correctionsVolley },
}

export const dictationVocabulary = (sport: string): SportVocabulary => VOCABULAIRE_PAR_SPORT[sport] ?? { mots: [], corrections: [] }
