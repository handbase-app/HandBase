import type { Criterion } from './db'

type Seed = Omit<Criterion, 'order' | 'active' | 'updatedAt'>

const f = (id: string, category: string, label: string, scale: Criterion['scale'], unit?: string, description?: string): Seed => ({
  id,
  category,
  label,
  scale,
  unit,
  description,
  kind: 'factual',
})

/** Postes de champ : les critères qui n'ont pas de sens pour un gardien leur sont réservés. */
const FIELD: Criterion['positions'] = ['AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV']

const s = (id: string, category: string, label: string, description: string, extra: Partial<Seed> = {}): Seed => ({
  id,
  category,
  label,
  description,
  scale: 'score5',
  kind: 'subjective',
  ...extra,
})

/**
 * Critères livrés par défaut. Les identifiants sont fixes pour que tous les appareils
 * partagent les mêmes critères ; tout est ensuite modifiable dans Paramètres.
 */
export const DEFAULT_CRITERIA: Seed[] = [
  // ----- Factuel : préparateur physique -----
  f('taille', 'Gabarit', 'Taille', 'number', 'cm'),
  f('poids', 'Gabarit', 'Poids', 'number', 'kg'),

  f('explosivite', 'Critères physiologiques', 'Explosivité', 'score5'),
  f('puissance', 'Critères physiologiques', 'Puissance', 'score5'),
  f('vitesse', 'Critères physiologiques', 'Vitesse', 'score5'),
  f('detente', 'Critères physiologiques', 'Détente', 'score5'),
  f('tir', 'Critères physiologiques', 'Tir', 'score5'),

  f('taille_assise', 'Mensurations', 'Taille assise', 'number', 'cm'),
  f('empan', 'Mensurations', 'Empan', 'number', 'cm'),
  f('envergure', 'Mensurations', 'Envergure', 'number', 'cm'),

  f('sprint_10', 'Vitesse & endurance', 'Sprint 10 m', 'number', 's'),
  f('sprint_30', 'Vitesse & endurance', 'Sprint 30 m', 'number', 's'),
  f('t_test', 'Vitesse & endurance', 'T-Test', 'number', 's'),
  f('vift', 'Vitesse & endurance', '30-15 IFT (VIFT)', 'number', 'km/h'),

  f('saut_bilateral', 'Puissance & détente', 'Grand saut bilatéral', 'number', 'm'),
  f('saut_largeur_g', 'Puissance & détente', 'Saut à la largeur G', 'number', 'm'),
  f('saut_largeur_d', 'Puissance & détente', 'Saut à la largeur D', 'number', 'm'),
  f('medball_conc', 'Puissance & détente', 'Méd. ball concentrique', 'number', 'm'),
  f('medball_plio', 'Puissance & détente', 'Méd. ball pliométrique', 'number', 'm'),

  f('dorsi_g', 'Mobilité', 'Dorsiflexion cheville G', 'number', 'cm'),
  f('dorsi_d', 'Mobilité', 'Dorsiflexion cheville D', 'number', 'cm'),
  f('chaine_post_g', 'Mobilité', 'Chaîne post. G', 'score3'),
  f('chaine_post_d', 'Mobilité', 'Chaîne post. D', 'score3'),
  f('epaule_g', 'Mobilité', 'Épaule RE/RI G', 'score3'),
  f('epaule_d', 'Mobilité', 'Épaule RE/RI D', 'score3'),
  f('hanche_ri', 'Mobilité', 'Hanche RI', 'score2'),
  f('hanche_re', 'Mobilité', 'Hanche RE', 'score2'),
  f('ohs', 'Mobilité', 'Squat bras au-dessus de la tête', 'score3'),

  f('epaule_ri_d', 'Mobilité', 'Épaule RI D (degrés)', 'number', '°'),
  f('epaule_ri_g', 'Mobilité', 'Épaule RI G (degrés)', 'number', '°'),
  f('epaule_re_d', 'Mobilité', 'Épaule RE D (degrés)', 'number', '°'),
  f('epaule_re_g', 'Mobilité', 'Épaule RE G (degrés)', 'number', '°'),

  f('trunk_pu', 'Stabilité & adducteurs', 'Trunk Push-up', 'score3'),
  f('stab_rot', 'Stabilité & adducteurs', 'Stabilité rotative', 'score3'),
  f('adducteur', 'Stabilité & adducteurs', 'Adducteur au mur', 'score3'),
  f('shirado', 'Stabilité & adducteurs', 'Shirado (gainage abdos)', 'number', 's'),
  f('sorensen', 'Stabilité & adducteurs', 'Sorensen (gainage lombaires)', 'number', 's'),

  // Plateforme de force.
  f('sj_hauteur', 'Sauts (plateforme)', 'SJ – hauteur', 'number', 'cm', 'Squat jump, sans contre-mouvement'),
  f('sj_puissance', 'Sauts (plateforme)', 'SJ – puissance relative', 'number', 'W/kg'),
  f('cmj_hauteur', 'Sauts (plateforme)', 'CMJ – hauteur', 'number', 'cm', 'Saut avec contre-mouvement'),
  f('cmj_puissance', 'Sauts (plateforme)', 'CMJ – puissance relative', 'number', 'W/kg'),
  f('cmj_rsi', 'Sauts (plateforme)', 'CMJ – RSI modifié', 'number', undefined, 'Hauteur ÷ temps de contact'),
  f('eur', 'Sauts (plateforme)', 'EUR (CMJ / SJ)', 'number', undefined, 'Utilisation de l’excentrique : 1,05–1,15 bon'),

  f('rm6_squat', 'Force (6 RM)', 'Squat', 'number', 'kg'),
  f('rm6_bench', 'Force (6 RM)', 'Développé couché', 'number', 'kg'),
  f('rm6_dl', 'Force (6 RM)', 'Soulevé de terre trap bar', 'number', 'kg'),
  f('rm1_clean', 'Force (6 RM)', 'Épaulé (1 RM)', 'number', 'kg'),
  f('rm6_traction', 'Force (6 RM)', 'Traction lestée', 'number', 'kg'),
  f('rm6_hipthrust', 'Force (6 RM)', 'Hip thrust', 'number', 'kg'),

  f('rsa_moyen', 'Vitesse & endurance', 'RSA (RAST 6×35 m) – temps moyen', 'number', 's'),
  f('rsa_fatigue', 'Vitesse & endurance', 'RSA – indice de fatigue', 'number', '%'),

  // ----- Subjectif : plusieurs observateurs -----
  s('vision', 'Intelligence de jeu', 'Vision du jeu', 'Voit les partenaires démarqués, anticipe les espaces', { quick: true }),
  s('decision', 'Intelligence de jeu', 'Prise de décision', 'Bon choix (tir / passe / fixation) au bon moment', { quick: true }),
  s('lecture', 'Intelligence de jeu', 'Lecture du jeu adverse', 'Anticipe les intentions de l’adversaire', { positions: FIELD }),
  s('sans_ballon', 'Intelligence de jeu', 'Jeu sans ballon', 'Courses, appels, démarquage, création d’espaces', { positions: FIELD }),

  s('efficacite_tir', 'Attaque', 'Efficacité au tir', 'Choix et qualité du tir, sang-froid face au gardien', { positions: FIELD, quick: true }),
  s('duel', 'Attaque', 'Duel / 1 contre 1', 'Capacité à déborder et à fixer son défenseur', { positions: FIELD }),
  s('passe', 'Attaque', 'Qualité de passe', 'Précision, timing, variété', { positions: FIELD }),
  s('collectif', 'Attaque', 'Jeu collectif', 'Respect du système, combinaisons, jeu à deux avec le pivot', { positions: FIELD }),

  s('agressivite', 'Défense', 'Agressivité défensive', 'Engagement physique, sortie sur le porteur, contact', { positions: FIELD, quick: true }),
  s('placement_def', 'Défense', 'Placement / replacement', 'Position dans le système, retour défensif', { positions: FIELD }),
  s('comm_def', 'Défense', 'Communication défensive', 'Annonces, prises en charge, aide aux partenaires', { positions: FIELD }),
  s('interceptions', 'Défense', 'Interceptions / contres', 'Récupère ou gêne le ballon', { positions: FIELD }),

  s('engagement', 'Mental & attitude', 'Engagement', 'Intensité et investissement du début à la fin', { quick: true }),
  s('pression', 'Mental & attitude', 'Gestion de la pression', 'Réaction dans les moments décisifs et après une erreur', { quick: true }),
  s('leadership', 'Mental & attitude', 'Leadership', 'Entraîne les autres, prend des responsabilités'),
  s('attitude', 'Mental & attitude', 'Attitude / fair-play', 'Comportement envers arbitres, adversaires et banc'),
  s('concentration', 'Mental & attitude', 'Concentration', 'Constance, peu de pertes d’attention'),

  s('gb_placement', 'Spécifique gardien', 'Placement dans le but', 'Angles, position face au tireur', { positions: ['GB'], quick: true }),
  s('gb_reflexes', 'Spécifique gardien', 'Réflexes / réactivité', 'Vitesse de réaction sur les tirs', { positions: ['GB'], quick: true }),
  s('gb_lecture', 'Spécifique gardien', 'Lecture du tireur', 'Anticipation du tir', { positions: ['GB'] }),
  s('gb_relance', 'Spécifique gardien', 'Relance', 'Remise en jeu rapide et précise, relance longue de contre-attaque', { positions: ['GB'] }),
  s('gb_presence', 'Spécifique gardien', 'Présence / communication', 'Organisation de la défense, voix', { positions: ['GB'] }),
  s('gb_sorties', 'Spécifique gardien', 'Sorties', 'Sorties sur les ailiers, interceptions des passes longues', { positions: ['GB'] }),
  s('gb_appuis', 'Spécifique gardien', 'Déplacements & appuis', 'Équilibre, déplacements latéraux, retour rapide en position', { positions: ['GB'] }),
  s('gb_rebond', 'Spécifique gardien', 'Réaction après un but', 'Se remobilise vite après un but encaissé ou une erreur', { positions: ['GB'] }),

  s('gb_9m', 'Gardien — arrêts par zone', 'Tirs de loin (9 m)', 'Efficacité sur les tirs extérieurs', { positions: ['GB'] }),
  s('gb_ailes', 'Gardien — arrêts par zone', 'Tirs des ailes', 'Fermeture de l’angle, timing face aux ailiers', { positions: ['GB'] }),
  s('gb_pivot', 'Gardien — arrêts par zone', 'Tirs du pivot / à 6 m', 'Face-à-face à courte distance', { positions: ['GB'] }),
  s('gb_7m', 'Gardien — arrêts par zone', 'Jets de 7 m', 'Duel psychologique et arrêts sur penalty', { positions: ['GB'] }),
  s('gb_ca', 'Gardien — arrêts par zone', 'Contre-attaques / 1 contre 1', 'Duels face au tireur lancé seul', { positions: ['GB'] }),
]
