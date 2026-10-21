import type { Evaluation, HBEvent, Measurement, Player, PlayerGroup, PolePeriod, Rewatch, Seen, Team, Video, VideoMoment } from './db'
import { accord } from './gender'
import { volleyNote, type VolleyOutcome, type VolleySkill } from './volleyActions'

/*
 * Démonstration du volley (« Charger la démo » quand le sport de l'installation est le volley : src/demo.ts l'écrit dans
 * la base locale). 40 joueuses et joueurs FICTIFS de M13 à M18 (saison 2026-2027 : M13 = 2014-2015, M15 = 2012-2013,
 * M18 = 2009-2011 ; 23 filles, 17 garçons), les 4 postes par défaut (P, R4, C, PT ; le libéro est facultatif), des mesures
 * plausibles, dans des fourchettes de jeunes repérés publiées pour le volley (taille, taille assise, poids, envergure,
 * atteinte, hauteurs d'attaque et de contre, CMJ, T-test, médecine-ball ; jusqu'à 3 séances pour suivre la progression), les tailles
 * des parents (taille adulte prédite, maturité), des événements de la filière (Interpôles, stage CRE, Volleyades M15,
 * détection départementale M13, tournoi des sélections départementales, stage CDE), un pôle espoirs fictif, une sélection
 * régionale, des avis sur les grilles du volley (public/demo/criteres-volley.json) et deux vidéos aux moments notés
 * « Attaque réussie », « Réception neutre »… (pastilles du séquenceur, src/volleyActions.ts).
 *
 * Prénoms et noms courants, combinés au hasard ; clubs fictifs (villes réelles) ; aucune personne réelle, aucune donnée
 * fédérale. Identifiants « demo- » (effacés par clearDemo). Calcul pur et déterministe (mêmes données à chaque chargement,
 * sauf les dates du tournoi récent et du stage à venir, posées par rapport à aujourd'hui) : tools/test-volley-contenu.ts.
 */

const PREFIX = 'demo-'

// Générateur pseudo-aléatoire déterministe (le même que la démo du handball, src/demo.ts).
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Cat = 'M13' | 'M15' | 'M18'
type Sex = 'F' | 'M'
/** Postes par défaut du volley (le libéro, facultatif, n'est pas dans la démo). */
export type DemoPosition = 'P' | 'R4' | 'C' | 'PT'
type Range = readonly [number, number]

/** Années de naissance de chaque catégorie, saison 2026-2027 (âge de la 2e année de la saison). */
export const CAT_YEARS: Record<Cat, readonly number[]> = { M13: [2014, 2015], M15: [2012, 2013], M18: [2009, 2010, 2011] }

/** Fourchettes « jeunes repérés » par sexe et catégorie (T-test : du plus lent au plus rapide). */
export const RANGES: Record<Sex, Record<Cat, Record<'taille' | 'assise' | 'poids' | 'atteinte' | 'attaque' | 'contre' | 'cmj' | 'ttest' | 'mb', Range>>> = {
  F: {
    M13: { taille: [156, 176], assise: [80, 92], poids: [42, 68], atteinte: [205, 228], attaque: [240, 272], contre: [232, 262], cmj: [22, 36], ttest: [13.3, 11.4], mb: [2.6, 5.0] },
    M15: { taille: [162, 184], assise: [84, 95], poids: [48, 72], atteinte: [210, 235], attaque: [252, 292], contre: [240, 278], cmj: [25, 40], ttest: [13.0, 11.0], mb: [3.0, 5.5] },
    M18: { taille: [168, 190], assise: [87, 98], poids: [55, 78], atteinte: [218, 240], attaque: [268, 305], contre: [255, 290], cmj: [27, 42], ttest: [12.6, 10.8], mb: [3.5, 6.2] },
  },
  M: {
    M13: { taille: [155, 182], assise: [80, 92], poids: [40, 70], atteinte: [203, 235], attaque: [245, 285], contre: [235, 272], cmj: [22, 36], ttest: [12.8, 11.0], mb: [3.0, 6.0] },
    M15: { taille: [168, 198], assise: [86, 99], poids: [52, 82], atteinte: [220, 255], attaque: [275, 330], contre: [262, 312], cmj: [28, 46], ttest: [12.0, 10.2], mb: [4.0, 7.5] },
    M18: { taille: [180, 204], assise: [90, 104], poids: [62, 90], atteinte: [235, 265], attaque: [305, 350], contre: [290, 330], cmj: [34, 54], ttest: [11.5, 9.8], mb: [5.0, 9.0] },
  },
}
/** Envergure : taille −2 à +7 cm (filles), 0 à +8 cm (garçons). */
const ENVERGURE: Record<Sex, Range> = { F: [-2, 7], M: [0, 8] }
/** Détente avec élan (hauteur d'attaque − atteinte debout) : 38 à 60 cm (filles), 45 à 75 cm (garçons). */
const ELAN: Record<Sex, Range> = { F: [38, 60], M: [45, 75] }
/** Place dans la fourchette de taille selon le poste : passeurs dans la moitié basse, centraux en haut. */
const HEIGHT_Q: Record<DemoPosition, Range> = { P: [0.12, 0.55], R4: [0.35, 0.78], C: [0.62, 0.98], PT: [0.45, 0.9] }
/** Croissance en 4 mois (cm), par sexe et catégorie. */
const GROWTH: Record<Sex, Record<Cat, Range>> = {
  F: { M13: [1.0, 2.6], M15: [0.3, 1.3], M18: [0, 0.5] },
  M: { M13: [1.0, 3.0], M15: [1.0, 2.8], M18: [0.2, 1.2] },
}

/** Séances de tests : rentrée 2025 (M15 et M18), fin de saison 2026, rentrée 2026. */
export const SESSIONS = ['2025-10-15', '2026-06-10', '2026-10-14'] as const

const FIRST: Record<Sex, string[]> = {
  F: ['Léa', 'Chloé', 'Manon', 'Emma', 'Camille', 'Inès', 'Jade', 'Louise', 'Lina', 'Zoé', 'Sarah', 'Juliette', 'Alice', 'Lola', 'Clara', 'Anaïs', 'Maëlys', 'Lou', 'Nina', 'Romane', 'Elsa', 'Margaux', 'Eva'],
  M: ['Lucas', 'Hugo', 'Nathan', 'Enzo', 'Théo', 'Mathis', 'Noah', 'Tom', 'Louis', 'Ethan', 'Jules', 'Maël', 'Rayan', 'Adam', 'Sacha', 'Evan', 'Nolan'],
}
const LAST = [
  'Martin', 'Bernard', 'Thomas', 'Petit', 'Robert', 'Richard', 'Durand', 'Dubois', 'Moreau', 'Laurent', 'Simon', 'Michel', 'Lefebvre', 'Leroy',
  'Roux', 'David', 'Bertrand', 'Morel', 'Fournier', 'Girard', 'Bonnet', 'Dupont', 'Lambert', 'Fontaine', 'Rousseau', 'Vincent', 'Muller',
  'Lefèvre', 'Faure', 'André', 'Mercier', 'Blanc', 'Guérin', 'Boyer', 'Garnier', 'Chevalier', 'François', 'Legrand', 'Gauthier', 'Perrin',
]

/** Clubs fictifs (villes réelles) et leur département ; région Auvergne-Rhône-Alpes. */
export const CLUBS: readonly { name: string; dept: string }[] = [
  { name: 'Entente Volley Villeurbanne', dept: '69' },
  { name: 'Académie Volley Saint-Étienne', dept: '42' },
  { name: 'Volley Isère Grenoble Sud', dept: '38' },
  { name: 'Ain Volley Bourg Ouest', dept: '01' },
  { name: 'Savoie Volley Chambéry Lac', dept: '73' },
  { name: 'Volley Club Clermont Dômes', dept: '63' },
]
const REGION = 'region-ara'

/** Effectif : catégorie, sexe, poste, club (indice dans CLUBS) ; « pole » : joueuse du pôle espoirs fictif. */
const ROSTER: { cat: Cat; sex: Sex; pos: DemoPosition; club: number; pole?: boolean }[] = [
  // M13 (14) : la moitié dans le Rhône (journée de détection départementale).
  { cat: 'M13', sex: 'F', pos: 'P', club: 0 },
  { cat: 'M13', sex: 'F', pos: 'R4', club: 0 },
  { cat: 'M13', sex: 'F', pos: 'R4', club: 1 },
  { cat: 'M13', sex: 'F', pos: 'C', club: 2 },
  { cat: 'M13', sex: 'F', pos: 'PT', club: 0 },
  { cat: 'M13', sex: 'F', pos: 'R4', club: 3 },
  { cat: 'M13', sex: 'F', pos: 'C', club: 1 },
  { cat: 'M13', sex: 'F', pos: 'R4', club: 2 },
  { cat: 'M13', sex: 'M', pos: 'P', club: 0 },
  { cat: 'M13', sex: 'M', pos: 'R4', club: 1 },
  { cat: 'M13', sex: 'M', pos: 'C', club: 0 },
  { cat: 'M13', sex: 'M', pos: 'PT', club: 3 },
  { cat: 'M13', sex: 'M', pos: 'R4', club: 2 },
  { cat: 'M13', sex: 'M', pos: 'PT', club: 0 },
  // M15 (14)
  { cat: 'M15', sex: 'F', pos: 'P', club: 0, pole: true },
  { cat: 'M15', sex: 'F', pos: 'R4', club: 4, pole: true },
  { cat: 'M15', sex: 'F', pos: 'R4', club: 1 },
  { cat: 'M15', sex: 'F', pos: 'C', club: 2, pole: true },
  { cat: 'M15', sex: 'F', pos: 'PT', club: 5, pole: true },
  { cat: 'M15', sex: 'F', pos: 'R4', club: 0 },
  { cat: 'M15', sex: 'F', pos: 'C', club: 3 },
  { cat: 'M15', sex: 'F', pos: 'P', club: 4 },
  { cat: 'M15', sex: 'M', pos: 'P', club: 1 },
  { cat: 'M15', sex: 'M', pos: 'R4', club: 0 },
  { cat: 'M15', sex: 'M', pos: 'C', club: 2 },
  { cat: 'M15', sex: 'M', pos: 'PT', club: 5 },
  { cat: 'M15', sex: 'M', pos: 'R4', club: 3 },
  { cat: 'M15', sex: 'M', pos: 'C', club: 0 },
  // M18 (12)
  { cat: 'M18', sex: 'F', pos: 'P', club: 0, pole: true },
  { cat: 'M18', sex: 'F', pos: 'R4', club: 1, pole: true },
  { cat: 'M18', sex: 'F', pos: 'C', club: 4, pole: true },
  { cat: 'M18', sex: 'F', pos: 'PT', club: 2 },
  { cat: 'M18', sex: 'F', pos: 'R4', club: 5, pole: true },
  { cat: 'M18', sex: 'F', pos: 'C', club: 0 },
  { cat: 'M18', sex: 'F', pos: 'PT', club: 3 },
  { cat: 'M18', sex: 'M', pos: 'P', club: 2 },
  { cat: 'M18', sex: 'M', pos: 'R4', club: 0 },
  { cat: 'M18', sex: 'M', pos: 'C', club: 1 },
  { cat: 'M18', sex: 'M', pos: 'PT', club: 4 },
  { cat: 'M18', sex: 'M', pos: 'R4', club: 5 },
]

// ---------- Grilles (identifiants de public/demo/criteres-volley.json) ----------

export const GRID_CHAMP = ['champ_service', 'champ_reception', 'champ_attaque', 'champ_contre', 'champ_defense', 'champ_deplacements', 'champ_lecture', 'champ_sans_ballon', 'champ_engagement', 'champ_communication']
export const GRID_PASSEUR = ['passeur_precision', 'passeur_vitesse', 'passeur_deux_mains', 'passeur_distribution', 'passeur_jeu_rapide', 'passeur_arriere_suspension', 'passeur_attaque_2e_main', 'passeur_contre_defense', 'passeur_leadership']
export const GRID_MENTAL = ['mental_concentration', 'mental_perseverance', 'mental_reaction_erreur', 'mental_esprit_equipe', 'mental_ecoute', 'mental_autonomie']
/** Critères du mode rapide (« mode rapide : oui » dans le fichier). */
export const QUICK = new Set(['champ_service', 'champ_reception', 'champ_attaque', 'champ_engagement', 'passeur_precision', 'passeur_distribution', 'passeur_leadership', 'mental_concentration', 'mental_esprit_equipe'])
/** Tests mesurés à chaque séance. */
export const TESTS = ['taille', 'poids', 'taille_assise', 'envergure', 'atteinte', 'hauteur_attaque', 'hauteur_contre', 'cmj_hauteur', 't_test', 'medecine_ball']

const gridOf = (pos?: string) => [...(pos === 'P' ? GRID_PASSEUR : GRID_CHAMP), ...GRID_MENTAL]

const OBSERVERS = [
  { name: 'Coach Paul', bias: 0, noise: 0.5 },
  { name: 'Julie (adjointe)', bias: 0.3, noise: 0.6 },
  { name: 'Marc (entr. pôle)', bias: -0.4, noise: 0.8 },
  { name: 'Sophie (CTS)', bias: 0.1, noise: 0.5 },
  // Ne note que les passeurs (comme l'entraîneur des gardiens au handball).
  { name: 'Nadia (entr. passeurs)', bias: -0.1, noise: 0.6, setters: true },
]

// Groupes de travail fictifs, avec des comptes fictifs (choix des participants en mode local).
const STAFF_NAMES = ['Coach Paul', 'Julie Adjointe', 'Sophie Conseillère', 'Nadia Passeurs', 'Marc Entraîneur']
const staffId = (i: number) => `${PREFIX}compte-${i + 1}`
const TEAMS: Omit<Team, 'updatedAt'>[] = [
  { id: PREFIX + 'staff-1', name: 'ETD Rhône', description: 'Équipe technique départementale', members: [0, 1, 2].map(staffId) },
  { id: PREFIX + 'staff-2', name: 'Staff du pôle espoirs', members: [4, 3, 2].map(staffId) },
].map((t) => ({ ...t, names: Object.fromEntries(t.members.map((u) => [u, STAFF_NAMES[Number(u.split('-').pop()) - 1]])) }))

// Points forts et axes de travail : positifs ou constructifs.
const STRENGTHS = ['Frappe haute et variée en attaque', 'Service flottant précis', 'Plateforme stable en réception', 'Très bon timing au contre', 'Lit tôt la passe adverse', 'Toujours disponible pour le passeur', 'Parle beaucoup, encourage ses partenaires']
const IMPROVE = ['À travailler : la course d’élan', 'À travailler : la pénétration des mains au contre', 'À travailler : l’orientation des appuis en réception', 'À travailler : varier les zones d’attaque', 'À travailler : la communication en défense', 'À travailler : rester positif après une erreur']
const STRENGTHS_P = ['Passe régulière et précise', 'Distribution variée, trouve le central', 'Arrive tôt sous le ballon', 'Organise l’équipe, calme le jeu']
const IMPROVE_P = ['À travailler : la passe arrière', 'À travailler : masquer ses intentions', 'À travailler : la défense en zone 1', 'À travailler : prendre la parole']
const GAPS = ['Souplesse des épaules à suivre (prévention)', 'Mobilité de cheville à suivre', 'Gainage à renforcer']

export interface VolleyDemo {
  players: Player[]
  measurements: Measurement[]
  events: HBEvent[]
  evaluations: Evaluation[]
  groups: PlayerGroup[]
  teams: Team[]
  videos: Video[]
  seen: Seen[]
  rewatch: Rewatch[]
}

/**
 * Données de la démonstration du volley. `now` : horodatage (dates relatives du tournoi récent et du stage à venir,
 * signatures) ; `me` : compte de l'appareil (« vu » et équipes confiées au tournoi) ; `day` : jour local d'un horodatage.
 */
export function buildVolleyDemo(now: number, me: string, day: (t: number) => string = (t) => new Date(t).toLocaleDateString('sv')): VolleyDemo {
  const rand = rng(2027)
  const between = (a: number, b: number) => a + rand() * (b - a)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
  const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d
  const clamp = (n: number, [a, b]: Range) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), n))
  const lerp = ([a, b]: Range, t: number) => a + (b - a) * Math.max(0, Math.min(1, t))
  const ago = (h: number) => new Date(now - h * 3600 * 1000).toISOString()

  const players: Player[] = []
  const measurements: Measurement[] = []
  const level = new Map<string, Record<string, number>>()
  const firstUsed: Record<Sex, number> = { F: 0, M: 0 }

  ROSTER.forEach((r, i) => {
    const id = `${PREFIX}p-${i + 1}`
    const R = RANGES[r.sex][r.cat]
    const year = pick(CAT_YEARS[r.cat])
    // Naissances un peu plus nombreuses en début d'année (effet de l'âge relatif, visible avec les trimestres) ; deux
    // fiches n'ont jamais la même date.
    const month = 1 + Math.min(11, Math.floor(rand() ** 1.15 * 12))
    let dayOfMonth = 1 + Math.floor(rand() * 28)
    const date = () => `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`
    while (players.some((p) => p.birthDate === date())) dayOfMonth = (dayOfMonth % 28) + 1
    const birthDate = date()
    const club = CLUBS[r.club]
    // Gauchers : souvent pointus (attaque en zone 2), rares ailleurs.
    const lr = rand()
    const lat = r.pos === 'PT' ? (lr < 0.4 ? 'gaucher' : 'droitier') : lr < 0.08 ? 'gaucher' : lr < 0.11 ? 'ambidextre' : 'droitier'
    const secondary = r.pos === 'R4' && rand() < (r.cat === 'M13' ? 0.4 : 0.2) ? ['PT'] : r.pos === 'PT' && rand() < 0.3 ? ['R4'] : undefined
    const poleFrom = r.pole ? (r.cat === 'M18' ? (year <= 2010 ? '2024-09-01' : '2025-09-01') : year === 2012 ? '2025-09-01' : '2026-09-01') : undefined
    const poles: PolePeriod[] | undefined = poleFrom ? [{ regionId: REGION, site: 'Lyon', from: poleFrom }] : undefined
    const f = r.sex === 'F'

    // ----- Mesures de la rentrée 2026 (séance 3), puis les séances d'avant -----
    const q = between(...HEIGHT_Q[r.pos])
    const athletic = between(-1, 1) + (r.pole ? 0.35 : 0)
    const taille = round(lerp(R.taille, q), 1)
    const s3 = {
      taille,
      poids: round(lerp(R.poids, q + between(-0.2, 0.15)), 1),
      taille_assise: round(clamp(taille * between(0.507, 0.533), R.assise), 1),
      envergure: Math.round(taille + between(...ENVERGURE[r.sex])),
      atteinte: Math.round(clamp(taille * between(1.3, 1.32), R.atteinte)),
      cmj_hauteur: round(lerp(R.cmj, 0.5 + athletic * 0.35 + between(-0.15, 0.15)), 1),
      t_test: round(lerp(R.ttest, 0.5 + athletic * 0.35 + between(-0.15, 0.15)), 2),
      medecine_ball: round(lerp(R.mb, 0.45 + athletic * 0.25 + (q - 0.5) * 0.3 + between(-0.15, 0.15)), 2),
      hauteur_attaque: 0,
      hauteur_contre: 0,
    }
    s3.hauteur_attaque = Math.round(clamp(s3.atteinte + clamp(s3.cmj_hauteur * between(1.45, 1.65), ELAN[r.sex]), R.attaque))
    s3.hauteur_contre = Math.round(clamp(s3.hauteur_attaque - between(10, 25), R.contre))
    // Séance d'avant : croissance et progression en sens inverse (4 mois, puis 8 mois).
    const before = (s: typeof s3, months: number): typeof s3 => {
      const k = months / 4
      const grow = round(between(...GROWTH[r.sex][r.cat]) * k, 1)
      const t = round(s.taille - grow, 1)
      const reach = Math.round(s.atteinte - grow * 1.3)
      const cmj = round(s.cmj_hauteur - between(0, 1.5) * k, 1)
      const attack = Math.round(s.hauteur_attaque - (s.atteinte - reach) - between(0, 3) * k)
      return {
        taille: t,
        poids: round(s.poids - between(0.2, 1.8) * k, 1),
        taille_assise: round((s.taille_assise * t) / s.taille, 1),
        envergure: Math.round(s.envergure - grow),
        atteinte: reach,
        cmj_hauteur: cmj,
        t_test: round(s.t_test + between(0.03, 0.2) * k, 2),
        medecine_ball: round(s.medecine_ball - between(0.03, 0.2) * k, 2),
        hauteur_attaque: attack,
        hauteur_contre: Math.round(attack - (s.hauteur_attaque - s.hauteur_contre)),
      }
    }
    const s2 = before(s3, 4)
    const sessions: [string, typeof s3][] = [[SESSIONS[1], s2], [SESSIONS[2], s3]]
    if (r.cat !== 'M13') sessions.unshift([SESSIONS[0], before(s2, 8)])
    for (const [date, s] of sessions)
      for (const k of TESTS) {
        const value = s[k as keyof typeof s]
        measurements.push({ id: `${id}-${k}-${date}`, playerId: id, criterionId: k, value, date, author: 'Encadrant (démo)', updatedAt: now })
      }

    // Parents biologiques cohérents avec le gabarit : taille cible d'adulte selon la place dans la fourchette.
    const target = f ? 166 + q * 18 + between(-3, 3) : 178 + q * 22 + between(-3, 3)
    const mother = Math.round(clamp(f ? target + between(-4, 4) : target - 13 + between(-4, 4), [152, 186]))
    const father = Math.round(clamp(f ? 2 * target + 13 - mother : 2 * target - 13 - mother, [166, 206]))

    players.push({
      id,
      firstName: FIRST[r.sex][firstUsed[r.sex]++],
      lastName: LAST[(i * 7) % LAST.length],
      birthDate,
      sex: r.sex,
      position: r.pos,
      ...(secondary ? { secondaryPositions: secondary } : {}),
      team: `${r.cat} ${f ? 'féminines' : 'masculins'}`,
      category: r.cat,
      club: club.name,
      department: club.dept,
      boarding: r.pole ? true : rand() < 0.15,
      laterality: lat,
      fatherHeight: father,
      fatherHeightSource: rand() < 0.5 ? 'mesuree' : 'declaree',
      motherHeight: mother,
      motherHeightSource: rand() < 0.5 ? 'mesuree' : 'declaree',
      ...(poles ? { poles } : {}),
      gaps: rand() < 0.15 ? pick(GAPS) : undefined,
      notes: rand() < 0.3 ? `${accord('Joueur fictif généré', r.sex)} pour la démonstration.` : undefined,
      updatedAt: now,
    })

    // ----- Niveau « réel » caché, dont les avis s'inspirent -----
    const base = between(2.4, 4.0) + (r.pole ? 0.5 : 0) + (r.cat === 'M18' ? 0.2 : 0)
    const lv: Record<string, number> = {}
    for (const c of [...GRID_CHAMP, ...GRID_PASSEUR, ...GRID_MENTAL]) lv[c] = base + between(-0.9, 0.9)
    level.set(id, lv)
  })

  const byId = new Map(players.map((p) => [p.id, p]))
  const yearOf = (p: Player) => Number(p.birthDate!.slice(0, 4))
  const inPole = (p: Player, date: string) => (p.poles ?? []).some((x) => (!x.from || x.from <= date) && (!x.to || x.to >= date))

  // ----- Événements de la filière, avec leurs avis -----
  const E = (n: number) => `${PREFIX}ev-${n}`
  const ids = (ps: Player[]) => ps.map((p) => p.id)
  const events: HBEvent[] = [
    // Saison 2025-2026 : Interpôles (joueuses déjà au pôle), stage CRE (nés de 2012 à 2014), Volleyades M15 (M15 garçons
    // 2011-2012, M14 filles 2012).
    { id: E(1), name: 'Interpôles Sud', type: 'tournoi', date: '2026-02-07', place: 'Montpellier', teams: [PREFIX + 'staff-2'], playerIds: ids(players.filter((p) => inPole(p, '2026-02-07'))), updatedAt: now },
    { id: E(2), name: 'Stage CRE de Pâques', type: 'entrainement', date: '2026-04-14', place: 'Lyon', playerIds: ids(players.filter((p) => yearOf(p) >= 2012 && yearOf(p) <= 2014)), updatedAt: now },
    {
      id: E(3),
      name: 'Volleyades M15',
      type: 'tournoi',
      date: '2026-04-25',
      place: 'Brest',
      playerIds: ids(players.filter((p) => (p.sex === 'M' ? yearOf(p) === 2011 || yearOf(p) === 2012 : yearOf(p) === 2012))),
      updatedAt: now,
    },
    // Saison 2026-2027 : journée de détection du comité (M13 du Rhône).
    {
      id: E(4),
      name: 'Journée de détection départementale M13',
      type: 'observation',
      date: '2026-09-27',
      place: 'Villeurbanne',
      teams: [PREFIX + 'staff-1'],
      playerIds: ids(players.filter((p) => p.category === 'M13' && p.department === '69')),
      updatedAt: now,
    },
  ]
  const evaluations: Evaluation[] = []
  for (const ev of events) {
    const present = OBSERVERS.filter(() => rand() < 0.75).slice(0, 4)
    if (present.length < 2) present.push(OBSERVERS[0], OBSERVERS[3])
    for (const pid of ev.playerIds ?? []) {
      if (rand() < 0.25) continue // pas vu cette fois
      const p = byId.get(pid)!
      const crits = gridOf(p.position)
      for (const o of present) {
        if (o.setters && p.position !== 'P') continue
        if (rand() < 0.2) continue
        const full = rand() < 0.4
        const sc: Record<string, number> = {}
        for (const c of crits) {
          if (!full && !QUICK.has(c)) continue
          if (rand() < 0.1) continue // critère pas observé
          const disagree = rand() < 0.06 ? (rand() < 0.5 ? -1.6 : 1.6) : 0
          sc[c] = Math.max(1, Math.min(5, Math.round(level.get(p.id)![c] + o.bias + disagree + (rand() - 0.5) * 2 * o.noise)))
        }
        if (!Object.keys(sc).length) continue
        const setter = p.position === 'P'
        evaluations.push({
          id: `${PREFIX}e-${ev.id}-${p.id}-${o.name.split(' ')[0]}`,
          playerId: p.id,
          eventId: ev.id,
          observer: o.name,
          date: ev.date,
          scores: sc,
          minutesObserved: ev.type === 'tournoi' ? Math.round(between(40, 120)) : Math.round(between(20, 60)),
          strengths: rand() < 0.5 ? pick(setter ? STRENGTHS_P : STRENGTHS) : undefined,
          improvements: rand() < 0.4 ? pick(setter ? IMPROVE_P : IMPROVE) : undefined,
          updatedAt: now,
        })
      }
    }
  }

  // ----- Vidéos : moments notés par geste et résultat (pastilles du séquenceur), lien générique -----
  const note = (skill: VolleySkill, outcome: VolleyOutcome, more?: string) => `${volleyNote(skill, outcome)}${more ? ` · ${more}` : ''}`
  const attacker = players.find((p) => p.category === 'M18' && p.sex === 'F' && p.position === 'R4' && p.poles)!
  const setter = players.find((p) => p.category === 'M15' && p.sex === 'F' && p.position === 'P' && p.poles)!
  const moments = (ms: [number, string][]): VideoMoment[] => ms.map(([at, n]) => ({ at, dur: 3, note: n }))
  const m1 = moments([
    [1, note('service', 'reussi', 'flottant')],
    [4, note('reception', 'neutre')],
    [7, note('attaque', 'reussi', 'zone 4')],
    [10, note('contre', 'reussi')],
    [13, note('defense', 'retravailler')],
    [16, note('attaque', 'retravailler', 'ligne')],
  ])
  const m2 = moments([
    [2, note('passe', 'reussi', 'jeu rapide avec le central')],
    [8, note('passe', 'neutre')],
    [14, note('defense', 'reussi', 'zone 1')],
  ])
  const videos: Video[] = [
    { id: `${PREFIX}v-1`, targetKind: 'player', targetId: attacker.id, url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'Exemple de lien YouTube (vidéo générique) — gestes repérés', at: m1[0].at, moments: m1, createdByName: 'Marc Entraîneur', createdAtServer: ago(26), updatedAt: now },
    { id: `${PREFIX}v-2`, targetKind: 'player', targetId: setter.id, url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', title: 'Exemple de lien YouTube (vidéo générique) — passes', at: m2[0].at, moments: m2, createdByName: 'Nadia Passeurs', createdAtServer: ago(70), updatedAt: now },
    { id: `${PREFIX}v-3`, targetKind: 'event', targetId: E(3), url: 'https://www.rematch.tv/', title: 'Match complet (lien générique)', createdByName: 'Coach Paul', createdAtServer: ago(48), updatedAt: now },
  ]
  // Avis spontané donné en regardant une vidéo (mention « Vidéo »).
  evaluations.push({
    id: `${PREFIX}e-video-1`,
    playerId: attacker.id,
    contextType: 'video',
    contextPlace: 'Vidéo de match – temps forts',
    review: 'validated',
    observer: 'Marc (entr. pôle)',
    date: '2026-10-05',
    scores: { champ_attaque: 4, champ_service: 4, champ_reception: 3, mental_concentration: 4 },
    strengths: 'Frappe haute en attaque, service flottant précis',
    updatedAt: now,
  })

  // ----- Pôle espoirs fictif et sélection régionale -----
  const poleGirls = players.filter((p) => p.poles)
  const years = (ps: Player[]) => [...new Set(ps.map((p) => String(yearOf(p))))].sort()
  const selection = players.filter((p) => p.category === 'M15' && p.sex === 'M')
  const groups: PlayerGroup[] = [
    { id: PREFIX + 'g-pole', name: 'Pôle Espoirs fictif', description: 'Démonstration : joueuses fictives du pôle espoirs féminin', playerIds: ids(poleGirls), sex: 'F', scope: 'ligue', regionId: REGION, years: years(poleGirls), updatedAt: now },
    { id: PREFIX + 'g-selection', name: 'Sélection régionale M15 garçons', description: 'Volleyades M15 (démonstration)', playerIds: ids(selection), sex: 'M', scope: 'ligue', regionId: REGION, years: years(selection), updatedAt: now },
  ]

  // ----- Tournoi des sélections départementales M13 (repérage : équipes, « vu », « à revoir ») -----
  const scout = buildScouting(players.filter((p) => p.category === 'M13'), now, me, day, ago, rand, E(4))
  return {
    players,
    measurements,
    events: [...events, ...scout.events],
    evaluations: [...evaluations, ...scout.evaluations],
    groups: [...groups, ...scout.groups],
    teams: TEAMS.map((t) => ({ ...t, updatedAt: now })),
    videos,
    seen: scout.seen,
    rewatch: scout.rewatch,
  }
}

/**
 * Tournoi des sélections départementales M13 (il y a 3 jours) : une équipe par comité (Rhône, Loire, Isère, Ain) avec ses
 * numéros, observateurs répartis (dont moi : 2 équipes), « vu » du staff, quelques avis, des « à revoir » vers le stage CDE
 * à venir et vers un groupe, et un « à revoir » de la journée de détection déjà revu au tournoi.
 */
function buildScouting(
  m13: Player[],
  now: number,
  me: string,
  day: (t: number) => string,
  ago: (h: number) => string,
  rand: () => number,
  detection: string,
) {
  const at = (n: number) => day(now + n * 24 * 3600 * 1000)
  const T = PREFIX + 'ev-tsd'
  const STAGE = PREFIX + 'ev-cde'
  const teams = [
    { id: 'ta', name: 'Sélection Rhône', dept: '69' },
    { id: 'tb', name: 'Sélection Loire', dept: '42' },
    { id: 'tc', name: 'Sélection Isère', dept: '38' },
    { id: 'td', name: 'Sélection Ain', dept: '01' },
  ]
  const tPlayers: Record<string, { team: string; num: string }> = {}
  for (const t of teams) m13.filter((p) => p.department === t.dept).forEach((p, k) => (tPlayers[p.id] = { team: t.id, num: String(2 + k * 2 + (k % 2)) }))
  const names = Object.fromEntries([0, 1, 2].map((i) => [staffId(i), STAFF_NAMES[i]]))
  const assign = { [me]: ['ta', 'tb'], [staffId(0)]: ['tc'], [staffId(1)]: ['td'], [staffId(2)]: ['tb'] }
  const events: HBEvent[] = [
    {
      id: T,
      name: 'Tournoi des sélections départementales M13',
      type: 'tournoi',
      date: at(-3),
      place: 'Saint-Priest',
      playerIds: m13.map((p) => p.id),
      teams: [PREFIX + 'staff-1'],
      names,
      tournament: { teams: teams.map(({ id, name }) => ({ id, name })), players: tPlayers, assign },
      updatedAt: now,
    },
    { id: STAGE, name: 'Stage CDE', type: 'entrainement', date: at(14), place: 'Vénissieux', playerIds: [], names, updatedAt: now },
  ]
  const seen: Seen[] = []
  m13.forEach((p, i) => {
    const team = tPlayers[p.id]?.team
    for (const u of [staffId(0), staffId(1), staffId(2)]) {
      const mine = assign[u]?.includes(team)
      if (rand() < (mine ? 0.65 : 0.1))
        seen.push({ id: `${u}:${T}:${p.id}`, eventId: T, playerId: p.id, at: ago(70 - i), createdBy: u, createdByName: STAFF_NAMES[Number(u.split('-').pop()) - 1], createdAtServer: ago(70 - i), updatedAt: now })
    }
    if (assign[me].includes(team) && rand() < 0.35) seen.push({ id: `${me}:${T}:${p.id}`, eventId: T, playerId: p.id, at: ago(60 - i), updatedAt: now })
  })
  // Quelques avis au tournoi (mode rapide de la grille du poste).
  const evaluations: Evaluation[] = m13
    .filter((_, i) => i % 3 === 1)
    .map((p, k) => ({
      id: `${PREFIX}e-tsd-${p.id}`,
      playerId: p.id,
      eventId: T,
      observer: STAFF_NAMES[k % 3],
      observerId: staffId(k % 3),
      createdBy: staffId(k % 3),
      createdByName: STAFF_NAMES[k % 3],
      createdAtServer: ago(66),
      date: at(-3),
      scores: (p.position === 'P' ? { passeur_precision: 4, passeur_distribution: 3, mental_concentration: 4 } : { champ_service: 4, champ_attaque: 3, champ_engagement: 4 }) as Record<string, number>,
      minutesObserved: 15,
      strengths: p.position === 'P' ? 'Passe régulière et précise' : 'Belle détente, frappe haute',
      updatedAt: now,
    }))
  const rhone = m13.filter((p) => p.department === '69')
  const group: PlayerGroup = { id: PREFIX + 'g-reperes', name: 'Repérés au TSD M13', description: 'Joueuses et joueurs à revoir (démonstration)', playerIds: [m13[5].id], updatedAt: now }
  const rw = (n: number, u: number, r: Omit<Rewatch, 'id' | 'updatedAt'>): Rewatch => ({
    id: `${PREFIX}rw-${n}`,
    createdBy: staffId(u),
    createdByName: STAFF_NAMES[u],
    createdAtServer: ago(60 - n),
    updatedAt: now,
    ...r,
  })
  const rewatch: Rewatch[] = [
    rw(1, 2, { playerId: m13[2].id, originEventId: T, events: [STAGE], note: 'Belle détente, à voir sur un match entier' }),
    rw(2, 0, { playerId: m13[2].id, originEventId: T, events: [STAGE], note: 'Réception solide, à confirmer' }),
    rw(3, 0, { playerId: m13[5].id, originEventId: T, groups: [group.id], note: 'Service flottant précis, à suivre en club' }),
    rw(4, 1, { playerId: m13[12].id, originEventId: T, note: 'Revoir en réception' }),
    // Repéré à la journée de détection, revu au tournoi (vu là-bas) : « revu ✓ ».
    rw(5, 2, { playerId: rhone[1].id, originEventId: detection, events: [T], note: 'Lecture du jeu' }),
  ]
  for (const r of rewatch)
    if (r.originEventId === T && !seen.some((s) => s.id === `${r.createdBy}:${T}:${r.playerId}`))
      seen.push({ id: `${r.createdBy}:${T}:${r.playerId}`, eventId: T, playerId: r.playerId, createdBy: r.createdBy, createdByName: r.createdByName, createdAtServer: ago(62), updatedAt: now })
  if (!seen.some((s) => s.playerId === rhone[1].id))
    seen.push({ id: `${staffId(2)}:${T}:${rhone[1].id}`, eventId: T, playerId: rhone[1].id, createdBy: staffId(2), createdByName: STAFF_NAMES[2], createdAtServer: ago(50), updatedAt: now })
  return { events, seen, evaluations, rewatch, groups: [group] }
}
