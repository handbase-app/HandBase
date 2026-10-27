/*
 * Jeu de démonstration FICTIF à l'échelle nationale pour une installation HANDBALL (le sport par défaut de l'appli) :
 * pendant de tools/seed-volley.ts, pour une base de test isolée.
 *
 * Écrit des fichiers SQL (HORS du dépôt : données générées, jamais commitées) qui remplissent la base avec :
 *  - la configuration (ligne « sport » = { sport: 'handball', sportName: 'Handball' }, comme supabase/044 la décrit ; postes
 *    par défaut du handball, pas de ligne « postes ») et les listes (régions, départements) ;
 *  - une structure façon fédération de handball : fédération, 12 ligues de métropole (Région Sud avec la Corse, comme les
 *    pôles de src/poles.ts) et 6 ultramarines (n° 64 à 70 de src/perimeter.ts), un comité par département, ~1 600 clubs aux
 *    noms FICTIFS placés dans de vraies villes du bon département (villes et coordonnées de tools/seed-volley.ts), et les
 *    51 sites de Pôles Espoirs de src/poles.ts (des institutions : nom et clé comme l'import de structure, src/structureImport.ts) ;
 *  - les 91 critères et tests du handball (public/demo/criteres-demo.json : le fichier de démonstration du handball,
 *    src/sportContent.ts) ;
 *  - ~25 000 joueuses et joueurs FICTIFS nés de 2008 à 2014 (~36 % de filles, effet de l'âge relatif), les 7 postes du
 *    handball (GB, AG, ARG, DC, ARD, AD, PIV ; gauchers surtout à droite), leurs tests physiques (1 à 3 séances), des
 *    événements de la filière (détections départementales U13, Intercomités, Interligues, Interpôles, stages de ligue,
 *    championnat de France U18), des « vu », des avis sur la grille du handball (gardiens : critères du gardien), les groupes
 *    des pôles (périodes de pôle sur les fiches, src/poleSeason.ts), trois sélections régionales, trois liens vidéo.
 * Noms et prénoms courants mélangés au hasard (aucune personne réelle) ; staff fictif (noms et identifiants inventés, sans
 * compte ni profil). Aucune donnée fédérale, aucun mineur réel, aucun logo. Marqueurs seulement positifs ou neutres (jamais
 * « pas retenu » ; sorties de pôle : « fin de cursus ») ; textes accordés au féminin par src/gender.ts.
 *
 * Mêmes règles d'écriture que le volley : générateur pseudo-aléatoire à graine fixe, identifiants stables (UUID dérivés d'une
 * clé), « on conflict (id) do update » ; les lignes portent data.demoSeed = 'hand' (une ligne d'une version précédente du jeu,
 * absente de la nouvelle, est supprimée logiquement à la fin) ; déclencheurs coupés (session_replication_role = replica) ;
 * colonnes de périmètre (046) écrites avec les lignes, contrôlées à la fin ; territoire des événements (048) calculé à la fin
 * par le serveur. Un passage complet : ~58 Mo de SQL, de l'ordre de 150 Mo écrits en une transaction (comme le volley).
 *
 * Relancer :
 *   npx jiti tools/seed-hand.ts <dossier hors du dépôt>             → écrit les fichiers SQL et affiche les chiffres clés
 *   cd <dossier> && psql "<connexion>" -X -f dry-run.sql            → essai complet dans une transaction ANNULÉE
 *   cd <dossier> && psql "<connexion>" -X -f apply.sql              → pour de bon (une seule transaction)
 *   cd <dossier> && psql "<connexion>" -X -f verify.sql             → contrôles (comptes, répartitions, fourchettes)
 *   rencontres (« Autour de moi », après 056) : npx jiti tools/seed-rencontres.ts <dossier>/rencontres.sql --sport handball
 * Tests des parties pures : npx jiti tools/test-seed-hand.ts
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRows, rowsFromJson } from '../src/criteriaFormat'
import { applySportConfig, HANDBALL, resolveSportConfig } from '../src/sportConfig'
import { SPORT_CONTENT } from '../src/sportContent'
import { playerClub, playerDepartment } from '../src/perimeter'
import { POLE_SITES, type PoleSite } from '../src/poles'
import { PROGRAMME_AGES, schoolAge } from '../src/poleSeason'
import { poleCode, poleName } from '../src/structureImport'
import { accord, sexLabel, w } from '../src/gender'
import { pillLabel, type PillKind } from '../src/seqPills'
import type { PoleProgramme } from '../src/db'
import { insideRepo } from './seed-rencontres'
import {
  addDays,
  appDept,
  arrondissement,
  buildLists,
  clamp,
  dayOfYear,
  daysIn,
  de,
  decimalAge,
  DEPTS as VOLLEY_DEPTS,
  FAMOUS as SPORT_FAMOUS,
  FIRST_F,
  FIRST_M,
  fmtDay,
  fold,
  GENERIC_VIDEO,
  hash32,
  LAST_OM,
  LASTNAMES,
  LEVELS_SQL,
  lerp,
  maturityWeight,
  MONTH_W,
  NATIONALITIES,
  parisIso,
  phi,
  r1,
  r2,
  rng,
  roundTo,
  sigmoid,
  TOWN_LIST,
  upsertSql,
  type Dept,
  type Town,
} from './seed-volley'

export { hash32, phi, TOWN_LIST, upsertSql }

// ---------- Hasard déterministe ----------

export const SEED = 'nextar-hand-demo-2026'

/** Tirages d'une entité (flux propre à une clé : stable même si l'ordre de génération change). */
export class Draw {
  private r: () => number
  constructor(...key: (string | number)[]) {
    this.r = rng(hash32(`${SEED}:${key.join(':')}`))
  }
  next = () => this.r()
  between = (a: number, b: number) => a + this.r() * (b - a)
  int = (a: number, b: number) => a + Math.floor(this.r() * (b - a + 1))
  chance = (p: number) => this.r() < p
  pick = <T>(xs: readonly T[]) => xs[Math.floor(this.r() * xs.length)]
  /** Loi normale centrée réduite (Box-Muller). */
  normal = () => {
    const u = Math.max(1e-12, this.r())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.r())
  }
  /** Indice tiré selon des poids. */
  weighted = (ws: readonly number[]) => {
    const tot = ws.reduce((s, x) => s + x, 0)
    let x = this.r() * tot
    for (let i = 0; i < ws.length; i++) {
      x -= ws[i]
      if (x < 0) return i
    }
    return ws.length - 1
  }
}

/** Identifiant stable au format UUID (v5 : empreinte SHA-1 d'une clé), distinct de ceux du volley. */
export function seedUuid(key: string): string {
  const h = createHash('sha1').update(`nextar-hand-seed/${key}`).digest('hex')
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

// ---------- Ligues, départements ----------

export interface Ligue {
  key: string
  code: string
  name: string
  /** Régions (identifiants de la liste) couvertes ; la première est celle de la ligue. */
  regions: string[]
  /** Territoire ultramarin (un seul département). */
  depts?: string[]
}

/**
 * Ligues : 12 de métropole (n° 51 à 63, hors des n° ultramarins 64 à 70 de src/perimeter.ts ; la Corse dans la Région Sud,
 * comme les pôles de src/poles.ts) et 6 ultramarines (une par territoire).
 */
export const LIGUES: Ligue[] = [
  { key: 'region-ara', code: '51', name: 'Ligue Auvergne-Rhône-Alpes de handball', regions: ['region-ara'] },
  { key: 'region-bfc', code: '52', name: 'Ligue Bourgogne-Franche-Comté de handball', regions: ['region-bfc'] },
  { key: 'region-bre', code: '53', name: 'Ligue de Bretagne de handball', regions: ['region-bre'] },
  { key: 'region-cvl', code: '54', name: 'Ligue du Centre-Val de Loire de handball', regions: ['region-cvl'] },
  { key: 'region-ges', code: '56', name: 'Ligue du Grand Est de handball', regions: ['region-ges'] },
  { key: 'region-hdf', code: '57', name: 'Ligue des Hauts-de-France de handball', regions: ['region-hdf'] },
  { key: 'region-idf', code: '58', name: "Ligue d'Île-de-France de handball", regions: ['region-idf'] },
  { key: 'region-nor', code: '59', name: 'Ligue de Normandie de handball', regions: ['region-nor'] },
  { key: 'region-naq', code: '60', name: 'Ligue de Nouvelle-Aquitaine de handball', regions: ['region-naq'] },
  { key: 'region-occ', code: '61', name: "Ligue d'Occitanie de handball", regions: ['region-occ'] },
  { key: 'region-pdl', code: '62', name: 'Ligue des Pays de la Loire de handball', regions: ['region-pdl'] },
  { key: 'region-sud', code: '63', name: 'Ligue Région Sud de handball', regions: ['region-sud', 'region-cor'] },
  { key: 'om-971', code: '64', name: 'Ligue de la Guadeloupe de handball', regions: ['region-ant'], depts: ['971'] },
  { key: 'om-973', code: '65', name: 'Ligue de la Guyane de handball', regions: ['region-guy'], depts: ['973'] },
  { key: 'om-972', code: '66', name: 'Ligue de la Martinique de handball', regions: ['region-ant'], depts: ['972'] },
  { key: 'om-988', code: '67', name: 'Ligue de Nouvelle-Calédonie de handball', regions: ['region-nc'], depts: ['988'] },
  { key: 'om-974', code: '69', name: 'Ligue de La Réunion de handball', regions: ['region-reu'], depts: ['974'] },
  { key: 'om-976', code: '70', name: 'Ligue de Mayotte de handball', regions: ['region-may'], depts: ['976'] },
]
const isMetro = (l: Pick<Ligue, 'code'>) => l.code < '64'

/** Départements (ceux du volley : noms, population, région, n° dans les n° de club), rangés sous les ligues du handball. */
export const DEPTS: Dept[] = VOLLEY_DEPTS.map((d) => {
  const l = d.code.length === 3 ? LIGUES.find((x) => x.depts?.includes(d.code))! : LIGUES.find((x) => isMetro(x) && x.regions.includes(d.region))!
  return { ...d, ligue: l.key }
})
const DEPT = new Map(DEPTS.map((d) => [d.code, d]))

// ---------- Sportifs connus (handball) à ne jamais reconstituer ----------

/** Associations prénom + nom de handballeuses et handballeurs connus (en plus de celles de tools/seed-volley.ts). */
export const FAMOUS = new Set([
  ...SPORT_FAMOUS,
  ...[
    'Valentin Porte', 'Romain Lagarde', 'Hugo Descat', 'Yanis Lenne', 'Dylan Nahi', 'Nicolas Tournat', 'Kylian Villeminot',
    'Thibault Briet', 'Benjamin Gallego', 'Adrien Dipanda', 'Mathieu Grebille', 'Florian Delecroix', 'Baptiste Bonnefond',
    'Laura Flippes', 'Chloé Valentini', 'Lucie Granier', 'Méline Nocandy', 'Pauline Coatanea', 'Estelle Nze Minko',
    'Sarah Bouktit', 'Léna Grandveau', 'Alicia Toublanc', 'Amandine Leynaud', 'Camille Ayglon', 'Manon Houette', 'Laura Glauser',
    'Coralie Lassource', 'Océane Sercien Ugolin', 'Julie Foggea', 'Lucie Modenel', 'Chloé Bouquet', 'Clarisse Mairot',
  ].map(fold),
])

// ---------- Staff fictif (aucun compte ni profil : noms et identifiants inventés) ----------

export interface Staff {
  key: string
  id: string
  name: string
  role: string
  /** Régions (identifiants de la liste) suivies ; vide = national. */
  regions: string[]
  /** N'observe que les gardiens de but (entraîneur des gardiens). */
  keepers?: boolean
}
const S = (key: string, name: string, role: string, regions: string[] = [], keepers?: boolean): Staff => ({ key, id: seedUuid(`staff:${key}`), name, role, regions, ...(keepers ? { keepers } : {}) })
export const STAFF: Staff[] = [
  S('cnd1', 'Agnès Ferrandon', 'Responsable nationale de la détection (PPF)'),
  S('cnd2', 'Bruno Lescure', 'Conseiller technique national, territoires ultramarins', ['region-ant', 'region-guy', 'region-reu', 'region-may', 'region-nc']),
  S('ent', 'Karine Ollivaud', 'Entraîneure nationale jeunes'),
  S('nord', 'Frédéric Mazelier', 'CTS Hauts-de-France et Normandie', ['region-hdf', 'region-nor']),
  S('est', 'Nadia Belkhir', 'CTS Grand Est, Bourgogne-Franche-Comté, Auvergne-Rhône-Alpes', ['region-ges', 'region-bfc', 'region-ara']),
  S('ouest', 'Pascal Tréguier', 'CTS Bretagne, Pays de la Loire, Centre-Val de Loire', ['region-bre', 'region-pdl', 'region-cvl']),
  S('sud', 'Véronique Dalmasso', 'CTS Occitanie, Région Sud, Corse', ['region-occ', 'region-sud', 'region-cor']),
  S('idf', 'Cédric Aubertin', 'CTS Île-de-France', ['region-idf']),
  S('naq', 'Émilie Rouvray', 'CTS Nouvelle-Aquitaine', ['region-naq']),
  S('prep', 'Stéphane Gourdel', 'Préparateur physique'),
  S('pole', 'Isabelle Kervella', 'Responsable de pôle espoirs'),
  S('etd', 'Laurent Quesnoy', 'Conseiller technique départemental'),
  S('gb', 'Hervé Lantenois', 'Entraîneur des gardiens de but (équipe technique régionale)', [], true),
]
const STAFF_BY = new Map(STAFF.map((s) => [s.key, s]))
const staff = (key: string) => STAFF_BY.get(key)!
/** CTS d'une région. */
const ctsOf = (region: string) => STAFF.find((s) => s.key !== 'cnd2' && s.regions.includes(region)) ?? staff('cnd2')

// ---------- Textes des avis (positifs ou constructifs, jamais d'étiquette négative ; accordés par src/gender.ts) ----------

type Sex = 'M' | 'F'
type Text = (g: Sex) => string
const STRENGTHS: Text[] = [
  () => 'Très bonne lecture du jeu',
  (g) => `${accord('Puissant', g)} au tir de loin`,
  (g) => `${accord('Explosif', g)} sur le premier appui`,
  () => 'Gros volume de course',
  () => 'Bon jeu à deux avec le pivot',
  () => 'Solide en défense sur le 1 contre 1',
  () => 'Vitesse de bras déjà remarquable',
  () => 'Toujours disponible en contre-attaque',
  () => 'Communique beaucoup en défense',
  () => 'Belle variété de tirs',
  () => 'Prend les intervalles avec justesse',
  () => 'Calme dans les fins de match serrées',
  () => 'Lance bien le jeu rapide',
  () => 'Très bon timing sur les interceptions',
  (g) => `${accord('Leader', g)} ${accord('naturel', g)}, entraîne les autres`,
  (g) => `Très ${accord('appliqué', g)} à l’entraînement, progresse vite`,
]
const STRENGTHS_GB: Text[] = [
  () => 'Réflexes impressionnants',
  () => 'Très bon placement sur les tirs à 9 m',
  () => 'Relance rapide et précise',
  () => 'Organise bien sa défense',
  () => 'Grande présence dans le but',
  () => 'Lit bien les tireurs des ailes',
  (g) => `Très ${accord('concentré', g)} sur les jets de 7 m`,
]
const IMPROVE = [
  'À travailler : le repli défensif', 'À travailler : le choix de tir', 'À travailler : la constance sur tout le match',
  'À travailler : la communication défensive', 'À travailler : rester positif après une erreur', 'À travailler : le jeu sans ballon',
  'À travailler : le tir en appui', 'À travailler : les feintes de passe', 'À travailler : la passe dans la course',
  'À travailler : le placement en défense étagée', 'À travailler : le gainage pour stabiliser les duels',
]
const IMPROVE_GB = [
  'À travailler : la relance longue', 'À travailler : les sorties sur les ailiers', 'À travailler : la lecture des tirs en appui',
  'À travailler : la communication avec la défense', 'À travailler : les déplacements latéraux',
]
const REMARKABLE = ['Profil remarquable pour la catégorie, à suivre de près', 'Potentiel remarquable : gabarit, vitesse et lecture du jeu au-dessus de la catégorie']
const LATE = 'Maturité probablement tardive : potentiel à protéger'

// ---------- Paramètres du jeu ----------

export const N_PLAYERS = 25_000
/** Jour de référence (saison 2026-2027 en cours) : événements passés et à venir. */
export const TODAY = '2026-10-27'
/** Marque des lignes du jeu (data.demoSeed) : nettoyage des lignes d'une version précédente. */
export const MARK = 'hand'
const IMPORT_AT = '2024-09-12T06:00:00.000Z'
const STRUCT_AT = '2024-09-05T08:00:00.000Z'
const CRIT_AT = '2026-10-15T09:00:00.000Z'

export const YEARS = [2008, 2009, 2010, 2011, 2012, 2013, 2014] as const
/** Part de chaque génération (plus de licenciés chez les plus jeunes) et part des filles (un peu plus d'un tiers). */
const YEAR_W: Record<number, number> = { 2008: 0.11, 2009: 0.13, 2010: 0.14, 2011: 0.15, 2012: 0.155, 2013: 0.16, 2014: 0.155 }
const GIRLS: Record<number, number> = { 2008: 0.34, 2009: 0.35, 2010: 0.36, 2011: 0.37, 2012: 0.38, 2013: 0.38, 2014: 0.37 }
/** Départements « en retard » : peu vus, peu mesurés (« Où aller ? » a du relief). L'outre-mer est aussi moins couvert. */
export const BEHIND = new Set(['02', '18', '36', '52', '58', '93'])
const deptFactor = (d: Dept) => (BEHIND.has(d.code) ? 0.12 : d.code.length === 3 ? 0.5 : d.code === '2A' || d.code === '2B' ? 0.6 : 1)

const OM_CLUBS: Record<string, number> = { '971': 30, '972': 28, '973': 12, '974': 44, '976': 14, '988': 10 }
const METRO_CLUBS = 1480

// ---------- Types internes ----------

/** Catégories de jeunes du handball (src/sportContent.ts) : U13, U15, U18. */
export type Cat = 'U13' | 'U15' | 'U18'
export const CATS: Cat[] = SPORT_CONTENT.handball.youthCategories.map((c) => c.code as Cat)
/** Ligne d'une table hb_* ; `scope` : colonnes de périmètre (046) des joueurs et des lignes rattachées. */
export type Row = { id: string; data: Record<string, unknown>; scope?: [string | null, string | null] }

export interface Club {
  id: string
  number: string
  name: string
  dept: Dept
  town: Town
  city: string
  postal: string
  lat: number
  lng: number
  weight: number
  comiteId: string
}

export interface SeedPlayer {
  i: number
  id: string
  sex: Sex
  year: number
  birthDate: string
  /** Place dans l'année de naissance (0 = 1er janvier, 1 = 31 décembre). */
  ra: number
  club: Club
  dept: Dept
  region: string
  pos?: string
  laterality: 'droitier' | 'gaucher' | 'ambidextre'
  /** Potentiel de taille adulte, talent, maturité (en avance : positif), mental : lois normales. */
  A: number
  t: number
  m: number
  mental: number
  /** Niveau de détection (talent, gabarit, maturité, âge relatif). */
  L: number
  e: Record<'size' | 'w' | 'sit' | 'env' | 'span' | 'ath' | 'spd' | 'agi' | 'end' | 'jump' | 'mb' | 'shot', number>
  data: Record<string, unknown>
  poleUnitId?: string
}

// ---------- Structure : fédération, ligues, comités, clubs, pôles ----------

/** Villes de clubs de handball très connus : on y évite les modèles de noms les plus proches de vrais clubs. */
const KNOWN_CITIES = new Set(
  [
    'Montpellier', 'Paris', 'Nantes', 'Chambéry', 'Saint-Raphaël', 'Aix-en-Provence', 'Dunkerque', 'Toulouse', 'Créteil',
    'Ivry-sur-Seine', 'Nîmes', 'Cesson-Sévigné', 'Chartres', 'Limoges', 'Istres', 'Sélestat', 'Tremblay-en-France',
    'Pontault-Combault', 'Massy', 'Saran', 'Dijon', 'Metz', 'Brest', 'Besançon', 'Nice', 'Fleury-les-Aubrais', 'Plan-de-Cuques',
    'Bourg-de-Péage', 'Toulon', 'Mérignac', 'Le Havre', 'Chambray-lès-Tours', 'Issy-les-Moulineaux', 'Saint-Amand-les-Eaux',
    'Noisy-le-Grand', 'Angers', 'Billère', 'Pau', 'Strasbourg', 'Nancy', 'Villeurbanne', 'Cherbourg-en-Cotentin', 'Sarrebourg',
    'Caen', 'Rennes', 'Marseille', 'Vitrolles', 'Lyon', 'Bordeaux', 'Valence', 'Cournon-d\'Auvergne', 'Celles-sur-Belle',
  ].map(fold),
)
type Pattern = (t: string) => string
/** Modèles de noms FICTIFS (aucun des modèles les plus courants des vrais clubs : « Handball Club de … », « … Handball », « HBC … »). */
const PATTERNS: Pattern[] = [
  (t) => `Entente Handball ${t}`,
  (t) => `Olympique ${t} Handball`,
  (t) => `Stade ${t} Handball`,
  (t) => `Cercle Handball ${de(t)}`,
  (t) => `Handball Jeunes ${t}`,
  (t) => `Avenir Handball ${t}`,
  (t) => `Étoile Handball ${t}`,
  (t) => `Union Handball ${de(t)}`,
  (t) => `Amicale Handball ${t}`,
  (t) => `Jeunesse Handball ${t}`,
  (t) => `Espérance ${t} Handball`,
  (t) => `${t} Hand Avenir`,
  (t) => `Foyer Handball ${t}`,
  (t) => `${t} Université Handball`,
]
/** Modèles évités dans les villes connues. */
const RISKY = new Set([0, 1, 2, 7, 13])
/** Indice du modèle réservé aux villes de 80 000 habitants et plus. */
const BIG_CITY_PATTERN = 13

export interface Structure {
  federationId: string
  ligues: Map<string, Ligue & { id: string }>
  comites: Map<string, string>
  clubs: Club[]
  poles: PoleOut['def'][]
  rows: Row[]
}

export function clubCounts(): Map<string, number> {
  const metro = DEPTS.filter((d) => d.code.length === 2)
  const wts = metro.map((d) => d.pop ** 0.9 * (d.region === 'region-idf' ? 1.3 : 1))
  const k = METRO_CLUBS / wts.reduce((s, x) => s + x, 0)
  const out = new Map<string, number>()
  metro.forEach((d, i) => out.set(d.code, Math.max(3, Math.round(k * wts[i]))))
  for (const [c, n] of Object.entries(OM_CLUBS)) out.set(c, n)
  return out
}

const stamp = (by: string, at: string, uid?: string) => ({
  ...(uid ? { createdBy: uid, updatedBy: uid } : {}),
  createdByName: by,
  createdAtServer: at,
  updatedByName: by,
  updatedAtServer: at,
  demoSeed: MARK,
})

/**
 * Département de chaque site de pôle de src/poles.ts (géographie publique) : les jeunes du département du site y sont un
 * peu plus souvent (affinité), et les tests le contrôlent (le département est bien dans les régions du pôle).
 */
export const SITE_DEPT: Record<string, string> = {
  Lyon: '69', Chambéry: '73', "Cournon-d'Auvergne": '63', 'Clermont-Ferrand': '63', Dijon: '21', Besançon: '25',
  'Cesson-Sévigné': '35', Brest: '29', Rennes: '35', Chartres: '28', Orléans: '45', Strasbourg: '67', 'Pont-à-Mousson': '54',
  Reims: '51', Metz: '57', Barr: '67', Dunkerque: '59', Amiens: '80', Tourcoing: '59', Eaubonne: '95', 'Châtenay-Malabry': '92',
  Fontainebleau: '77', Caen: '14', 'Le Havre': '76', 'Bordeaux-Talence': '33', 'Saint-Yrieix-la-Perche': '87', Pau: '64',
  Angoulême: '16', Montpellier: '34', Nîmes: '30', Toulouse: '31', Nantes: '44', 'Saint-Raphaël': '83', 'Aix-en-Provence': '13',
  Ajaccio: '2A', 'Aix-en-Provence (Luynes)': '13', Nice: '06', 'Guadeloupe (CREPS Antilles-Guyane)': '971',
  'Basse-Terre (Guadeloupe)': '971', 'Saint-Denis (CREPS Réunion)': '974', 'Le Port': '974',
}

export function buildStructure(): Structure {
  const rows: Row[] = []
  const unit = (key: string, data: Record<string, unknown>) => {
    const id = seedUuid(`unit:${key}`)
    rows.push({ id, data: { id, ...data, ...stamp('Import de la structure (démo)', STRUCT_AT) } })
    return id
  }
  const federationId = unit('federation', { name: 'Fédération française de handball', levelId: 'niveau-federation', code: 'federation' })
  const ligues = new Map<string, Ligue & { id: string }>()
  for (const l of LIGUES) ligues.set(l.key, { ...l, id: unit(`ligue:${l.code}`, { name: l.name, levelId: 'niveau-ligue', parentId: federationId, code: `ligue:${l.code}` }) })
  const comites = new Map<string, string>()
  for (const d of DEPTS) {
    const l = ligues.get(d.ligue)!
    comites.set(d.code, unit(`comite:${d.code}`, { name: `Comité ${d.de}`, levelId: 'niveau-comite', parentId: l.id, code: `comite:${l.code}:${d.code}`, departments: [d.code] }))
  }

  // Clubs : nombre par département selon la population ; d'abord une ville par club (des plus grandes aux plus petites),
  // puis les clubs en plus dans les villes, au prorata de leur taille.
  const counts = clubCounts()
  const clubs: Club[] = []
  const seq = new Map<string, number>()
  const names = new Set<string>()
  for (const d of DEPTS) {
    const n = counts.get(d.code)!
    const towns = TOWN_LIST.filter((t) => t.dept === d.code).sort((a, b) => b.pop - a.pop)
    const draw = new Draw('clubs', d.code)
    const perTown = new Map<Town, number>()
    for (let k = 0; k < n; k++) {
      const town = k < towns.length ? towns[k] : towns[draw.weighted(towns.map((t) => t.pop ** 0.85))]
      const rank = perTown.get(town) ?? 0
      perTown.set(town, rank + 1)
      const l = ligues.get(d.ligue)!
      const key = `${l.code}${d.clubDigits}`
      const s = (seq.get(key) ?? 0) + 1
      seq.set(key, s)
      const number = `${key}${String(s).padStart(3, '0')}`
      const postal = town.postal[rank % town.postal.length]
      const label =
        (d.code === '13' && town.city === 'Marseille') || (d.code === '69' && town.city === 'Lyon') ? `${town.city} ${arrondissement(postal)}` : town.name
      const nd = new Draw('club-name', number)
      const known = KNOWN_CITIES.has(fold(town.city))
      const order = PATTERNS.map((_, i) => i)
        .filter((i) => !(known && RISKY.has(i)) && (i !== BIG_CITY_PATTERN || town.pop >= 80))
        .sort((a, b) => hash32(`${number}:${a}`) - hash32(`${number}:${b}`))
      let name = ''
      for (const i of order) {
        const c = PATTERNS[i](label)
        if (!names.has(fold(c))) {
          name = c
          break
        }
      }
      if (!name) name = `Handball Jeunes ${label} ${rank + 1}`
      names.add(fold(name))
      const spread = town.city === 'Paris' ? 0.006 : Math.min(0.035, 0.005 * Math.sqrt(Math.max(1, town.pop) / 8))
      const lat = rank === 0 ? town.lat : town.lat + (nd.next() - 0.5) * spread
      const lng = rank === 0 ? town.lng : town.lng + (nd.next() - 0.5) * spread * 1.4
      const weight = Math.exp(0.7 * nd.normal()) * (1 + 0.15 * Math.log10(1 + town.pop)) * 0.85 ** rank
      const comiteId = comites.get(d.code)!
      const id = unit(`club:${number}`, {
        name,
        levelId: 'niveau-club',
        parentId: comiteId,
        code: `club:${number}`,
        clubNumber: number,
        postalCode: postal,
        city: town.city,
        lat: Math.round(lat * 1e5) / 1e5,
        lng: Math.round(lng * 1e5) / 1e5,
      })
      clubs.push({ id, number, name, dept: d, town, city: town.city, postal, lat, lng, weight, comiteId })
    }
  }

  // Pôles Espoirs : les sites de src/poles.ts, rangés sous la ligue de leur région (comme l'import de structure de l'appli).
  const poles = POLE_SITES.map((site) => {
    const l = LIGUES.find((x) => x.regions.includes(site.regions[0]))!
    const ligue = ligues.get(l.key)!
    const name = poleName(site)
    const id = unit(`pole:${site.sex}:${fold(site.site)}`, { name, levelId: 'niveau-pole', parentId: ligue.id, code: poleCode(site), poleSex: site.sex, poleSite: site.site, poleLevels: site.levels })
    return { ...site, id, name, ligueId: ligue.id, dept: SITE_DEPT[site.site] }
  })
  return { federationId, ligues, comites, clubs, poles, rows }
}

// ---------- Joueuses et joueurs ----------

const pickYear = (d: Draw) => YEARS[d.weighted(YEARS.map((y) => YEAR_W[y]))]

/** Âge de saison (âge atteint dans l'année civile où finit la saison, comme src/sportContent.ts). */
export const seasonAge = (year: number, date: string) => (Number(date.slice(5, 7)) >= 9 ? Number(date.slice(0, 4)) + 1 : Number(date.slice(0, 4))) - year
/** Catégorie de jeunes (U13, U15, U18) d'après les âges de src/sportContent.ts ; en dessous : U13, au-dessus : U18. */
export function categoryOf(year: number, date: string): Cat {
  const a = seasonAge(year, date)
  const cats = SPORT_CONTENT.handball.youthCategories
  const hit = cats.find((c) => c.ages.includes(a))
  if (hit) return hit.code as Cat
  return (a < cats[0].ages[0] ? cats[0].code : cats[cats.length - 1].code) as Cat
}
/** Âges de saison où l'on teste (catégories de jeunes du handball : 12 à 18 ans). */
const TESTED_AGES = new Set(SPORT_CONTENT.handball.youthCategories.flatMap((c) => c.ages))

/**
 * Postes : part dans un effectif et effet du gabarit (les grands à l'arrière, au pivot et au but, les plus petits à l'aile) ;
 * `left` : effet de la latéralité (gauchers surtout à droite : ailier droit, arrière droit).
 */
const POS_BASE: Record<string, { share: number; size: number; left: number }> = {
  GB: { share: 0.13, size: 0.5, left: 1 },
  AG: { share: 0.14, size: -0.7, left: 0.35 },
  ARG: { share: 0.17, size: 0.6, left: 0.35 },
  DC: { share: 0.18, size: -0.1, left: 0.6 },
  ARD: { share: 0.1, size: 0.6, left: 8 },
  AD: { share: 0.11, size: -0.7, left: 8 },
  PIV: { share: 0.13, size: 0.7, left: 0.8 },
}
/** Effet d'être droitier sur ces postes (côté droit : surtout des gauchers). */
const RIGHT_HANDED: Record<string, number> = { ARD: 0.35, AD: 0.35 }
/** Postes secondaires plausibles. */
const SECONDARY: Record<string, [string, number][]> = {
  ARG: [['DC', 0.18], ['AG', 0.04]],
  DC: [['ARG', 0.16]],
  ARD: [['AD', 0.14]],
  AD: [['ARD', 0.12]],
  AG: [['ARG', 0.05]],
  PIV: [['ARG', 0.04]],
}

export function buildPlayers(st: Structure): SeedPlayer[] {
  const clubW = st.clubs.map((c) => c.weight * (c.dept.code.length === 3 ? 1.15 : 1))
  const cum: number[] = []
  clubW.reduce((s, x, i) => (cum[i] = s + x), 0)
  const total = cum[cum.length - 1]
  const findClub = (x: number) => {
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] < x) lo = mid + 1
      else hi = mid
    }
    return st.clubs[lo]
  }
  const codes = HANDBALL.positions.map((p) => p.code)
  const inClub = new Map<string, number>()
  const players: SeedPlayer[] = []
  for (let i = 0; i < N_PLAYERS; i++) {
    const d = new Draw('player', i)
    const id = seedUuid(`player:${i}`)
    const year = pickYear(d)
    const sex: Sex = d.chance(GIRLS[year]) ? 'F' : 'M'
    const month = 1 + d.weighted(MONTH_W)
    const day = d.int(1, daysIn(year, month))
    const birthDate = fmtDay(year, month, day)
    const ra = dayOfYear(year, month, day) / 365
    const club = findClub(d.next() * total)
    const A = d.normal()
    const t = d.normal()
    const m = d.normal()
    const mental = d.normal()
    const e = {
      size: d.normal(), w: d.normal(), sit: d.normal(), env: d.normal(), span: d.normal(), ath: d.normal(),
      spd: d.normal(), agi: d.normal(), end: d.normal(), jump: d.normal(), mb: d.normal(), shot: d.normal(),
    }
    // Latéralité d'abord (environ 12 % de gauchers), puis le poste : les gauchers surtout à droite, les grands à l'arrière,
    // au pivot et au but ; sans poste fixe chez les plus jeunes.
    const lr = d.next()
    const laterality: SeedPlayer['laterality'] = lr < 0.12 ? 'gaucher' : lr < 0.145 ? 'ambidextre' : 'droitier'
    const noPos = d.chance(year === 2014 ? 0.1 : year === 2013 ? 0.05 : 0.02)
    const pos = noPos
      ? undefined
      : codes[d.weighted(codes.map((c) => POS_BASE[c].share * Math.exp(POS_BASE[c].size * A) * (laterality === 'gaucher' ? POS_BASE[c].left : laterality === 'droitier' ? (RIGHT_HANDED[c] ?? 1) : 1)))]
    const sec = pos ? (SECONDARY[pos] ?? []).filter(([, p]) => d.chance(p)).map(([c]) => c) : []
    // Noms : listes mélangées ; jamais l'association d'un sportif connu.
    const firsts = sex === 'F' ? FIRST_F : FIRST_M
    const om = LAST_OM[club.dept.code]
    let firstName = ''
    let lastName = ''
    do {
      firstName = d.pick(firsts)
      lastName = om && d.chance(0.6) ? d.pick(om) : d.pick(LASTNAMES)
    } while (FAMOUS.has(fold(`${firstName} ${lastName}`)))
    const k = inClub.get(club.number) ?? 0
    inClub.set(club.number, k + 1)
    const license = `${club.number}${String(100000 + k * 37 + (hash32(id) % 37)).padStart(6, '0')}`
    const ageNow = decimalAge(birthDate, TODAY)
    const r = 0.5 - ra
    const L = (0.62 * t + 0.4 * A + 0.3 * m * maturityWeight(ageNow) + (sex === 'M' ? 0.6 : 0.45) * r) / 0.85 - (BEHIND.has(club.dept.code) ? 0.3 : 0)
    const req = d.next()
    const data: Record<string, unknown> = {
      id,
      firstName,
      lastName,
      birthDate,
      sex,
      ...(pos ? { position: pos } : {}),
      ...(sec.length ? { secondaryPositions: sec } : {}),
      laterality,
      club: club.name,
      clubCode: club.number,
      license,
      licenseRequestType: req < (year === 2014 ? 0.66 : 0.8) ? 'RENOUVELLEMENT' : req < 0.93 ? 'CREATION' : 'MUTATION',
      nationality: d.chance(0.95) ? 'Française' : d.pick(NATIONALITIES),
      ...stamp('Import des licences (démo)', IMPORT_AT),
    }
    players.push({ i, id, sex, year, birthDate, ra, club, dept: club.dept, region: club.dept.region, pos, laterality, A, t, m, mental, L, e, data })
  }
  return players
}

// ---------- Pôles Espoirs : périodes sur les fiches ----------

export interface PoleOut {
  def: PoleSite & { id: string; name: string; ligueId: string; dept: string }
  /** Membres de la saison en cours (2026-2027). */
  current: SeedPlayer[]
  /** Sortis le 30 juin 2026 (fin de cursus). */
  past: SeedPlayer[]
}

/** Début de la saison en cours (âge scolaire des programmes, src/poleSeason.ts). */
const SEASON_START = 2026
/** Années de naissance accueillies par un site cette saison (programmes du site, âges de src/poleSeason.ts). */
export function siteYears(levels: readonly PoleProgramme[], season = SEASON_START): number[] {
  const out = new Set<number>()
  for (const l of levels.length ? levels : (['accession'] as PoleProgramme[])) {
    const [a, b] = PROGRAMME_AGES[l]
    for (let age = a; age <= b; age++) out.add(season - age)
  }
  return [...out].sort()
}
/** Âge scolaire d'entrée au site pour une année de naissance (le plus petit des programmes qui l'accueillent). */
const entryAge = (levels: readonly PoleProgramme[], year: number) =>
  Math.min(...(levels.length ? levels : (['accession'] as PoleProgramme[])).map((l) => PROGRAMME_AGES[l]).filter(([a, b]) => schoolAge(year, SEASON_START) >= a && schoolAge(year, SEASON_START) <= b).map(([a]) => a))

/** Membre à cette date (période qui la couvre). */
export const inPoleAt = (p: SeedPlayer, day: string) =>
  ((p.data.poles as { from?: string; to?: string }[] | undefined) ?? []).some((x) => (!x.from || x.from <= day) && (!x.to || x.to >= day))

/** Postes d'un effectif de pôle ou d'une sélection (2 par poste, puis les meilleurs restants). */
const TEAM_QUOTAS: [string, number][] = [['GB', 2], ['AG', 2], ['ARG', 2], ['DC', 2], ['ARD', 2], ['AD', 2], ['PIV', 2]]

export function buildPoles(st: Structure, players: SeedPlayer[]): PoleOut[] {
  const taken = new Set<number>()
  const noise = players.map((p) => new Draw('pole-sel', p.i).normal())
  return st.poles.map((def) => {
    const d = new Draw('pole', def.sex, def.site)
    const big = def.levels.length >= 2 || def.levels.includes('accession')
    const size = def.regions.some((r) => r === 'region-ant' || r === 'region-reu') ? 12 : (big ? 18 : 14) + d.int(-2, 2)
    const years = siteYears(def.levels)
    // Jeunes du territoire du pôle (ses régions), un peu plus souvent du département du site.
    const score = (p: SeedPlayer) => p.L + 0.35 * noise[p.i] + (p.dept.code === def.dept ? 0.5 : 0)
    const pool = players.filter((p) => def.regions.includes(p.region) && p.sex === def.sex && !taken.has(p.i) && p.pos)
    const cand = pool.filter((p) => years.includes(p.year)).sort((a, b) => score(b) - score(a))
    const current: SeedPlayer[] = []
    for (const [pos, n] of TEAM_QUOTAS) current.push(...cand.filter((p) => p.pos === pos && !current.includes(p)).slice(0, n))
    for (const p of cand) if (current.length < size && !current.includes(p)) current.push(p)
    // Sortis le 30 juin 2026 en fin de cursus : la génération qui quitte le programme le plus âgé du site.
    const oldest = Math.min(...years) - 1
    const past = pool.filter((p) => p.year === oldest && !current.includes(p)).sort((a, b) => score(b) - score(a)).slice(0, d.int(2, 3))
    for (const p of current) {
      taken.add(p.i)
      const pd = new Draw('pole-entry', p.i)
      const entry = clamp(p.year + entryAge(def.levels, p.year) + (pd.chance(0.3) ? 1 : 0), 2023, SEASON_START)
      p.data.poles = [{ regionId: def.regions[0], site: def.site, from: `${entry}-09-01` }]
      p.data.boarding = pd.chance(0.8)
      p.poleUnitId = def.id
    }
    for (const p of past) {
      taken.add(p.i)
      const from = new Draw('pole-entry', p.i).chance(0.6) ? '2024-09-01' : '2025-09-01'
      p.data.poles = [{ regionId: def.regions[0], site: def.site, from, to: '2026-06-30', exitReason: 'fin_cursus' }]
      p.data.boarding = true
    }
    return { def, current, past }
  })
}

// ---------- Événements de la filière ----------

type EventType = 'match' | 'tournoi' | 'entrainement' | 'observation'
interface Obs {
  s: Staff
  p: number
  /** Ne marque que les joueurs de ces régions (CTS régional) ; absent = tous. */
  regions?: string[]
}
export interface SeedEvent {
  key: string
  id: string
  name: string
  type: EventType
  date: string
  days: number
  place: string
  time: string
  sex?: 'M' | 'F' | 'mixte'
  organizerId: string
  organizerName: string
  creator: Staff
  roster: SeedPlayer[]
  observers: Obs[]
  evals: number
  full: number
  measure?: 'anthro' | 'full'
  tournament?: { teams: { id: string; name: string }[]; players: Record<string, { team: string; num: string }> }
}
export const upcoming = (e: Pick<SeedEvent, 'date'>) => e.date > TODAY

const METRO_REGIONS = LIGUES.filter(isMetro).map((l) => l.key)
/** Secteurs des Interpôles : nord et sud de la métropole ; l'outre-mer avec le sud. */
const NORD = new Set(['region-hdf', 'region-nor', 'region-idf', 'region-ges', 'region-bre', 'region-pdl', 'region-cvl', 'region-bfc'])
export const sectorOf = (regionId: string) => (NORD.has(regionId) ? 'nord' : 'sud')

/** Tri par niveau avec un peu de hasard (propre à chaque sélection), les départements en retard moins repérés. */
function ranker(key: string) {
  const memo = new Map<number, number>()
  const v = (p: SeedPlayer) => {
    let x = memo.get(p.i)
    if (x === undefined) memo.set(p.i, (x = p.L + 0.45 * new Draw(key, 'rank', p.i).normal() + 0.5 * Math.log(deptFactor(p.dept))))
    return x
  }
  return (ps: readonly SeedPlayer[]) => [...ps].sort((a, b) => v(b) - v(a))
}

/** Équipe ou sélection : postes équilibrés (quotas), puis les meilleurs restants. */
function pickTeam(cands: readonly SeedPlayer[], n: number, key: string, quotas: readonly (readonly [string, number])[] = TEAM_QUOTAS, exclude = new Set<number>()) {
  const ranked = ranker(key)(cands.filter((p) => !exclude.has(p.i)))
  const out: SeedPlayer[] = []
  const inOut = new Set<number>()
  const add = (p: SeedPlayer) => {
    out.push(p)
    inOut.add(p.i)
  }
  for (const [pos, k] of quotas) ranked.filter((p) => p.pos === pos && !inOut.has(p.i)).slice(0, k).forEach(add)
  for (const p of ranked) {
    if (out.length >= n) break
    if (!inOut.has(p.i)) add(p)
  }
  return out
}

/** Numéros de maillot d'une équipe : gardiens 1, 12, 16 ; joueurs de champ 2 à 11, puis 13, 14, 15, 17… */
export function jerseys(team: readonly SeedPlayer[]): Map<number, string> {
  const gbNums = [1, 12, 16, 99]
  const field = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 17, 18, 19, 20, 21, 22, 23, 24, 25]
  const out = new Map<number, string>()
  let g = 0
  let f = 0
  for (const p of team) out.set(p.i, String(p.pos === 'GB' && g < gbNums.length ? gbNums[g++] : field[f++]))
  return out
}

/** Participation d'un club à une journée (certains clubs n'envoient personne). */
const clubCov = (c: Club, key: string) => (new Draw('club-cov', key, c.number).next() < 0.08 ? 0 : 0.35 + 1.3 * new Draw('club-cov2', key, c.number).next())

const POS_ORDER = ['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV', undefined]
const sexWord = (sex: Sex) => (sex === 'F' ? 'filles' : 'garçons')

export function buildEvents(st: Structure, players: SeedPlayer[]): SeedEvent[] {
  const events: SeedEvent[] = []
  const lig = (region: string) => [...st.ligues.values()].find((l) => isMetro(l) && l.regions.includes(region))!
  const ligLabel = (l: Ligue) => l.name.replace(/ de handball$/, '')
  const regionalCts = (p: number): Obs[] =>
    METRO_REGIONS.map((r) => ctsOf(r))
      .filter((s, i, a) => a.findIndex((x) => x.key === s.key) === i)
      .map((s) => ({ s, p, regions: s.regions }))
  const ev = (e: Omit<SeedEvent, 'id' | 'days' | 'time'> & { days?: number; time?: string }) => events.push({ days: 1, time: '09:00', ...e, id: seedUuid(`event:${e.key}`) })
  const fed = { organizerId: st.federationId, organizerName: 'Fédération française de handball' }

  // Journées de détection départementales U13 (saison 2025-2026 : nés en 2013, quelques 2014), par les comités.
  const detection = (key: string, code: string, date: string, place: string, share: Record<number, number>) => {
    const d = DEPT.get(code)!
    const roster = players.filter((p) => p.dept.code === code && share[p.year] && new Draw(key, p.i).chance(clamp(share[p.year] * clubCov(p.club, key) * (0.55 + 0.9 * sigmoid(p.L)), 0, 0.95)))
    ev({
      key, name: `Journée de détection départementale U13 – Comité ${d.de}`, type: 'observation', date, place, sex: 'mixte',
      organizerId: st.comites.get(code)!, organizerName: `Comité ${d.de}`, creator: ctsOf(d.region), roster,
      observers: [{ s: ctsOf(d.region), p: 0.8 }, { s: staff('etd'), p: 0.65 }, { s: staff('prep'), p: 0.4 }, { s: staff('gb'), p: 0.5 }],
      evals: 20, full: 0.25, measure: 'anthro',
    })
  }
  const detections2025: [string, string, string][] = [
    ['13', '2025-09-27', 'Aix-en-Provence'],
    ['59', '2025-10-04', "Villeneuve-d'Ascq"],
    ['31', '2025-10-04', 'Toulouse'],
    ['35', '2025-10-11', 'Rennes'],
    ['67', '2025-10-11', 'Strasbourg'],
    ['44', '2025-10-18', 'Nantes'],
  ]
  for (const [code, date, place] of detections2025) detection(`detection-u13-${code}-2025`, code, date, place, { 2013: 0.55, 2014: 0.35 })

  // Championnat de France U18 (journée d'observation) : les CTS observent les clubs engagés (assez de jeunes de l'âge).
  const champU18 = (key: string, sex: Sex, years: number[], date: string) => {
    const byClub = new Map<string, SeedPlayer[]>()
    for (const p of players) if (p.sex === sex && years.includes(p.year) && p.dept.code.length === 2) byClub.set(p.club.number, [...(byClub.get(p.club.number) ?? []), p])
    const roster: SeedPlayer[] = []
    const yearW = (y: number) => [0.55, 0.8, 1][years.indexOf(y)] ?? 1
    for (const [num, ps] of byClub) {
      const pe = ps.length < (sex === 'F' ? 6 : 7) ? 0 : Math.min(0.75, (sex === 'F' ? 0.15 : 0.08) + ps.length / 30) * deptFactor(ps[0].dept)
      if (!new Draw(key, 'club', num).chance(pe)) continue
      for (const p of ps) if (new Draw(key, p.i).chance(yearW(p.year) * (0.5 + 0.4 * sigmoid(p.L)))) roster.push(p)
    }
    ev({
      key, name: `Championnat de France U18 ${sexLabel(sex).toLowerCase()} – journée d'observation`, type: 'match', date, place: 'Salles des clubs engagés', time: '15:00', sex,
      ...fed, creator: staff('cnd1'), roster,
      observers: [{ s: staff('cnd1'), p: 0.15 }, { s: staff('ent'), p: 0.15 }, { s: staff('etd'), p: 0.25 }, { s: staff('gb'), p: 0.4 }, ...regionalCts(0.7)],
      evals: 30, full: 0.15,
    })
  }
  // 2025-2026 : U18 = nés de 2008 à 2010 (16 à 18 ans) ; ordre des années : la plus jeune d'abord.
  champU18('champ-u18-f-2025', 'F', [2010, 2009, 2008], '2025-10-11')
  champU18('champ-u18-m-2025', 'M', [2010, 2009, 2008], '2025-10-12')

  // Stages de ligue (détection régionale) : les meilleurs de la ligue, postes équilibrés.
  const stage = (key: string, region: string, name: string, date: string, place: string, years: number[], nF: number, nM: number, observed = true) => {
    const elig = players.filter((p) => p.region === region && years.includes(p.year) && p.pos)
    const quotas: [string, number][] = [['GB', 4], ['AG', 3], ['ARG', 3], ['DC', 3], ['ARD', 3], ['AD', 3], ['PIV', 3]]
    const roster = [...pickTeam(elig.filter((p) => p.sex === 'F'), nF, `${key}-F`, quotas), ...pickTeam(elig.filter((p) => p.sex === 'M'), nM, `${key}-M`, quotas)]
    const l = lig(region)
    ev({
      key, name: `${name} – ${ligLabel(l)}`, type: 'entrainement', date, days: 3, place, sex: 'mixte',
      organizerId: l.id, organizerName: l.name, creator: ctsOf(region), roster,
      observers: observed ? [{ s: ctsOf(region), p: 0.9 }, { s: staff('prep'), p: 0.8 }, { s: staff('pole'), p: 0.7 }, { s: staff('cnd1'), p: 0.5 }, { s: staff('etd'), p: 0.5 }, { s: staff('gb'), p: 0.85 }] : [],
      evals: observed ? 42 : 0, full: observed ? 0.8 : 0, measure: observed ? 'full' : undefined,
    })
  }
  stage('stage-ara-2025', 'region-ara', 'Stage de détection de la Toussaint', '2025-10-27', 'Vichy', [2011, 2012], 28, 32)

  // Intercomités U14, tour régional de la Région Sud (sélections départementales : garçons et filles nés en 2012).
  {
    const key = 'intercomites-sud-2025'
    const teams: { id: string; name: string }[] = []
    const tp: Record<string, { team: string; num: string }> = {}
    const roster: SeedPlayer[] = []
    for (const sex of ['M', 'F'] as Sex[]) {
      for (const code of ['04', '05', '06', '13', '83', '84', '2A', '2B']) {
        const team = pickTeam(players.filter((p) => p.dept.code === code && p.sex === sex && p.year === 2012 && p.pos), 14, `${key}-${code}-${sex}`)
        if (team.length < 9) continue
        const tid = `d${code}${sex}`
        teams.push({ id: tid, name: `Sélection ${DEPT.get(code)!.name} (${sexWord(sex)})` })
        const nums = jerseys(team)
        team.forEach((p) => {
          roster.push(p)
          tp[p.id] = { team: tid, num: nums.get(p.i)! }
        })
      }
    }
    const l = lig('region-sud')
    ev({
      key, name: 'Intercomités U14 – tour régional Région Sud', type: 'tournoi', date: '2025-12-13', days: 2, place: 'Hyères', sex: 'mixte',
      organizerId: l.id, organizerName: l.name, creator: staff('sud'), roster,
      observers: [{ s: staff('sud'), p: 0.9 }, { s: staff('etd'), p: 0.6 }, { s: staff('pole'), p: 0.5 }, { s: staff('gb'), p: 0.7 }],
      evals: 50, full: 0.3, tournament: { teams, players: tp },
    })
  }

  // Interpôles : jeunes des pôles en activité à la date, de 16 à 18 ans dans la saison.
  const polePlayers = players.filter((p) => p.data.poles)
  const poleRegion = (p: SeedPlayer) => (p.data.poles as { regionId: string }[])[0].regionId
  const interpoles = (key: string, name: string, date: string, days: number, place: string, keep: (p: SeedPlayer) => boolean, sex: 'M' | 'F' | 'mixte', observed = true) =>
    ev({
      key, name, type: 'tournoi', date, days, place, sex,
      ...fed, creator: staff('ent'),
      roster: polePlayers.filter((p) => inPoleAt(p, date) && seasonAge(p.year, date) >= 16 && keep(p)),
      observers: observed
        ? [{ s: staff('cnd1'), p: 0.85 }, { s: staff('cnd2'), p: 0.6 }, { s: staff('ent'), p: 0.8 }, { s: staff('pole'), p: 0.7 }, { s: staff('prep'), p: 0.5 }, { s: staff('gb'), p: 0.9 }, ...regionalCts(0.85)]
        : [],
      evals: observed ? 60 : 0, full: 0.7, measure: observed && (key === 'interpoles-nord-2026' || key === 'interpoles-sud-2026') ? 'full' : undefined,
    })
  interpoles('interpoles-nord-2026', 'Interpôles Nord', '2026-01-24', 3, 'Eaubonne', (p) => sectorOf(poleRegion(p)) === 'nord', 'mixte')
  interpoles('interpoles-sud-2026', 'Interpôles Sud', '2026-02-07', 3, 'Montpellier', (p) => sectorOf(poleRegion(p)) === 'sud', 'mixte')

  stage('stage-pdl-2026', 'region-pdl', 'Stage de ligue de février', '2026-02-16', 'Angers', [2011, 2012, 2013], 30, 30)
  stage('stage-idf-2026', 'region-idf', 'Stage de ligue de Pâques', '2026-04-14', 'Châtenay-Malabry', [2011, 2012, 2013], 32, 32)

  // Interligues U16 (sélections régionales : garçons nés en 2010, filles nées en 2010 et 2011).
  {
    const key = 'interligues-u16-2026'
    const teams: { id: string; name: string }[] = []
    const tp: Record<string, { team: string; num: string }> = {}
    const roster: SeedPlayer[] = []
    const twoM = new Set(['region-idf', 'region-ara', 'region-hdf', 'region-occ', 'region-naq'])
    const twoF = new Set([...twoM, 'region-pdl', 'region-ges'])
    const omM = ['om-974', 'om-971', 'om-972']
    const omF = ['om-974', 'om-971', 'om-972', 'om-988']
    for (const sex of ['M', 'F'] as Sex[]) {
      const years = sex === 'M' ? [2010] : [2010, 2011]
      for (const lk of [...METRO_REGIONS, ...(sex === 'M' ? omM : omF)]) {
        const l = st.ligues.get(lk)!
        const elig = players.filter((p) => p.dept.ligue === lk && p.sex === sex && years.includes(p.year) && p.pos)
        const n = (sex === 'M' ? twoM : twoF).has(lk) ? 2 : 1
        const used = new Set<number>()
        for (let k = 0; k < n; k++) {
          const team = pickTeam(elig, 16, `${key}-${lk}-${sex}-${k}`, TEAM_QUOTAS, used)
          if (team.length < 10) continue
          const tid = `${l.code}${sex}${k + 1}`
          const label = ligLabel(l).replace(/^Ligue (de la |de |du |des |d')?/, '')
          teams.push({ id: tid, name: `${label}${n > 1 ? ` ${k + 1}` : ''} (${sexWord(sex)})` })
          const sorted = [...team].sort((a, b) => POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos))
          const nums = jerseys(sorted)
          sorted.forEach((p) => {
            used.add(p.i)
            roster.push(p)
            tp[p.id] = { team: tid, num: nums.get(p.i)! }
          })
        }
      }
    }
    ev({
      key, name: 'Interligues U16', type: 'tournoi', date: '2026-04-24', days: 3, place: 'Chambéry', sex: 'mixte',
      ...fed, creator: staff('cnd1'), roster,
      observers: [{ s: staff('cnd1'), p: 0.7 }, { s: staff('cnd2'), p: 0.6 }, { s: staff('ent'), p: 0.7 }, { s: staff('pole'), p: 0.6 }, { s: staff('prep'), p: 0.3 }, { s: staff('gb'), p: 0.85 }, ...regionalCts(0.95)],
      evals: 190, full: 0.4, tournament: { teams, players: tp },
    })
  }

  // Intercomités U14, finales nationales : les 16 comités les plus fournis de chaque sexe (nés en 2012).
  {
    const key = 'intercomites-finales-2026'
    const teams: { id: string; name: string }[] = []
    const tp: Record<string, { team: string; num: string }> = {}
    const roster: SeedPlayer[] = []
    for (const sex of ['M', 'F'] as Sex[]) {
      const gen = players.filter((p) => p.sex === sex && p.year === 2012 && p.pos && p.dept.code.length === 2 && !BEHIND.has(p.dept.code))
      const count = new Map<string, number>()
      for (const p of gen) count.set(p.dept.code, (count.get(p.dept.code) ?? 0) + 1)
      const depts = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 16).map(([c]) => c)
      for (const code of depts) {
        const team = pickTeam(gen.filter((p) => p.dept.code === code), 14, `${key}-${code}-${sex}`)
        const tid = `d${code}${sex}`
        teams.push({ id: tid, name: `Sélection ${DEPT.get(code)!.name} (${sexWord(sex)})` })
        const nums = jerseys(team)
        team.forEach((p) => {
          roster.push(p)
          tp[p.id] = { team: tid, num: nums.get(p.i)! }
        })
      }
    }
    ev({
      key, name: 'Intercomités U14 – finales nationales', type: 'tournoi', date: '2026-05-23', days: 3, place: 'Angoulême', sex: 'mixte',
      ...fed, creator: staff('cnd1'), roster,
      observers: [{ s: staff('cnd1'), p: 0.6 }, { s: staff('cnd2'), p: 0.5 }, { s: staff('etd'), p: 0.5 }, { s: staff('gb'), p: 0.7 }, ...regionalCts(0.85)],
      evals: 80, full: 0.3, tournament: { teams, players: tp },
    })
  }

  interpoles('interpoles-france-m-2026', 'Interpôles France (garçons)', '2026-05-25', 4, 'Vichy', (p) => p.sex === 'M', 'M')
  interpoles('interpoles-france-f-2026', 'Interpôles France (filles)', '2026-06-01', 4, 'Vichy', (p) => p.sex === 'F', 'F')

  // Finales du championnat de France U18 (observation) : les 8 meilleures équipes de clubs de chaque sexe (nés de 2008 à 2010).
  {
    const key = 'finales-u18-2026'
    const roster: SeedPlayer[] = []
    for (const sex of ['F', 'M'] as Sex[]) {
      const byClub = new Map<string, SeedPlayer[]>()
      for (const p of players) if (p.sex === sex && p.year >= 2008 && p.year <= 2010 && p.dept.code.length === 2) byClub.set(p.club.number, [...(byClub.get(p.club.number) ?? []), p])
      const strength = (ps: SeedPlayer[]) => [...ps].sort((a, b) => b.L - a.L).slice(0, 12).reduce((t, p) => t + p.L, 0)
      const best = [...byClub.values()].filter((ps) => ps.length >= 12).sort((a, b) => strength(b) - strength(a)).slice(0, 8)
      for (const ps of best) roster.push(...[...ps].sort((a, b) => b.L + 0.5 * (b.year === 2010 ? 0 : 1) - (a.L + 0.5 * (a.year === 2010 ? 0 : 1))).slice(0, 14))
    }
    ev({
      key, name: 'Finales du championnat de France U18 (observation)', type: 'match', date: '2026-06-13', days: 2, place: 'Poitiers', time: '14:00', sex: 'mixte',
      ...fed, creator: staff('cnd1'), roster,
      observers: [{ s: staff('cnd1'), p: 0.8 }, { s: staff('cnd2'), p: 0.6 }, { s: staff('ent'), p: 0.8 }, { s: staff('pole'), p: 0.5 }, { s: staff('gb'), p: 0.8 }, ...regionalCts(0.85)],
      evals: 40, full: 0.4,
    })
  }

  // Saison 2026-2027 : détections U13 (nés en 2014), championnat de France U18 (nés de 2009 à 2011), stages de la Toussaint.
  detection('detection-u13-69-2026', '69', '2026-09-26', 'Villeurbanne', { 2014: 0.6 })
  detection('detection-u13-77-2026', '77', '2026-10-03', 'Melun', { 2014: 0.6 })
  champU18('champ-u18-f-2026', 'F', [2011, 2010, 2009], '2026-10-10')
  champU18('champ-u18-m-2026', 'M', [2011, 2010, 2009], '2026-10-11')
  stage('stage-occ-2026', 'region-occ', 'Stage de détection de la Toussaint', '2026-10-19', 'Montpellier', [2012, 2013], 30, 30)
  stage('stage-hdf-2026', 'region-hdf', 'Stage de détection de la Toussaint', '2026-10-19', "Villeneuve-d'Ascq", [2012, 2013], 30, 30)

  // À venir : Interpôles Nord 2027 (effectifs de la saison) et un stage de février (liste des invités).
  interpoles('interpoles-nord-2027', 'Interpôles Nord', '2027-01-23', 3, 'Eaubonne', (p) => sectorOf(poleRegion(p)) === 'nord', 'mixte', false)
  stage('stage-nor-2027', 'region-nor', 'Stage de ligue de février', '2027-02-15', 'Caen', [2012, 2013], 28, 28, false)
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
}

// ---------- « Vu » et avis ----------

/** L'observateur suit-il ce joueur ? (CTS : ses régions ; entraîneur des gardiens : les gardiens.) */
const follows = (o: Obs, p: SeedPlayer) => (!o.regions || o.regions.includes(p.region)) && (!o.s.keepers || p.pos === 'GB')

export function buildSeen(events: SeedEvent[]): Row[] {
  const rows: Row[] = []
  for (const e of events) {
    if (upcoming(e)) continue
    for (const o of e.observers) {
      for (const p of e.roster) {
        if (!follows(o, p)) continue
        const d = new Draw('seen', e.key, o.s.key, p.i)
        if (!d.chance(clamp(o.p * (0.7 + 0.6 * sigmoid(p.L)), 0, 0.97))) continue
        const at = parisIso(addDays(e.date, d.int(0, e.days - 1)), d.int(9, 18), d.int(0, 59))
        const id = `${o.s.id}:${e.id}:${p.id}`
        rows.push({ id, data: { id, eventId: e.id, playerId: p.id, at, ...stamp(o.s.name, at, o.s.id) } })
      }
    }
  }
  return rows
}

/** Grille d'évaluation tirée du fichier de critères : critères subjectifs, postes, catégorie, mode rapide. */
export interface Grid {
  subjective: { id: string; category: string; positions?: string[]; quick?: boolean }[]
}
/** Critères notés pour un poste : ceux du poste, et ceux sans poste (pour tous) ; sans poste connu : seulement ceux-là. */
export const gridFor = (grid: Grid, pos?: string) => grid.subjective.filter((c) => !c.positions?.length || (!!pos && c.positions.includes(pos)))

/** Petits penchants de chaque poste sur la grille du joueur de champ. */
const POS_TILT: Record<string, Record<string, number>> = {
  PIV: { duel: 0.25, agressivite: 0.2, collectif: 0.2, sans_ballon: 0.2, passe: -0.15 },
  AG: { efficacite_tir: 0.25, sans_ballon: 0.15, interceptions: 0.15, duel: -0.1 },
  AD: { efficacite_tir: 0.25, sans_ballon: 0.15, interceptions: 0.15, duel: -0.1 },
  ARG: { efficacite_tir: 0.2, duel: 0.15 },
  ARD: { efficacite_tir: 0.2, duel: 0.15 },
  DC: { vision: 0.35, passe: 0.3, collectif: 0.25, decision: 0.15, efficacite_tir: -0.15 },
}
const OBS_BIAS: Record<string, number> = { cnd1: -0.15, cnd2: 0, ent: -0.2, nord: 0.1, est: 0.05, ouest: 0.15, sud: 0.1, idf: 0, naq: 0.1, prep: 0.05, pole: -0.1, etd: 0.25, gb: -0.05 }
const MENTAL = 'Mental & attitude'

/** Niveau stable d'un joueur sur un critère (centré sur 3). */
export function levelOf(p: SeedPlayer, c: { id: string; category: string }): number {
  const d = new Draw('level', p.i, c.id)
  const remarkable = p.t > 2.1 ? 0.45 : 0
  if (c.category === MENTAL) return 2.4 + 0.35 * p.t + 0.5 * p.mental + 0.35 * d.normal() + remarkable
  const tilt = (p.pos ? POS_TILT[p.pos]?.[c.id] : undefined) ?? 0
  return 2.15 + 0.75 * p.t + 0.2 * p.m * maturityWeight(decimalAge(p.birthDate, TODAY)) + 0.45 * d.normal() + tilt + remarkable
}

export function buildEvaluations(events: SeedEvent[], grid: Grid): Row[] {
  const rows: Row[] = []
  for (const e of events) {
    if (upcoming(e) || !e.evals || !e.roster.length) continue
    const d = new Draw('evals', e.key)
    // Les observateurs notent d'abord les profils qui ressortent, et quelques autres.
    const pool = e.roster.map((p) => ({ p, w: Math.exp(1.1 * p.L) }))
    const chosen: SeedPlayer[] = []
    while (chosen.length < Math.min(e.evals, e.roster.length) && pool.length) {
      const k = d.weighted(pool.map((x) => x.w))
      chosen.push(pool[k].p)
      pool.splice(k, 1)
    }
    for (const p of chosen) {
      const obs = e.observers.filter((o) => follows(o, p))
      if (!obs.length) continue
      // Un gardien : l'entraîneur des gardiens d'abord, s'il est là.
      const order = [...obs].sort((a, b) => (p.pos === 'GB' ? Number(!!b.s.keepers) - Number(!!a.s.keepers) : 0) || hash32(`${e.key}:${p.i}:${a.s.key}`) - hash32(`${e.key}:${p.i}:${b.s.key}`))
      const n = d.chance(0.18) && obs.length > 1 ? 2 : 1
      for (const o of order.slice(0, n)) {
        const r = new Draw('eval', e.key, p.i, o.s.key)
        const full = r.chance(e.full)
        const scores: Record<string, number> = {}
        for (const c of gridFor(grid, p.pos)) {
          if (!full && !c.quick) continue
          if (r.chance(0.08)) continue // critère pas observé cette fois
          scores[c.id] = Math.round(clamp(levelOf(p, c) + (OBS_BIAS[o.s.key] ?? 0) + 0.45 * r.normal(), 1, 5))
        }
        if (!Object.keys(scores).length) continue
        const day = addDays(e.date, r.int(0, e.days - 1))
        const at = parisIso(day, r.int(18, 21), r.int(0, 59))
        const keeper = p.pos === 'GB'
        const late = p.m < -1 && p.t > 0.8 && decimalAge(p.birthDate, day) < 15.5
        const strengths =
          p.t > 2.1 && r.chance(0.7) ? r.pick(REMARKABLE) : late && r.chance(0.6) ? LATE : r.chance(0.5) ? r.pick(keeper ? STRENGTHS_GB : STRENGTHS)(p.sex) : undefined
        const improvements = r.chance(0.4) ? r.pick(keeper ? IMPROVE_GB : IMPROVE) : undefined
        const minutes = e.type === 'tournoi' || e.type === 'match' ? r.int(40, 120) : e.type === 'entrainement' ? r.int(60, 180) : r.int(20, 60)
        const id = seedUuid(`eval:${e.key}:${p.i}:${o.s.key}`)
        rows.push({
          id,
          data: {
            id, playerId: p.id, eventId: e.id, observer: o.s.name, observerId: o.s.id, date: day, scores, minutesObserved: minutes,
            ...(strengths ? { strengths } : {}), ...(improvements ? { improvements } : {}), ...stamp(o.s.name, at, o.s.id),
          },
        })
      }
    }
  }
  return rows
}

// ---------- Tests physiques ----------

type Range = readonly [number, number]
type RangeKey = 'taille' | 'assise' | 'poids' | 'empan' | 'sprint10' | 'sprint30' | 'ttest' | 'vift' | 'saut' | 'cmj' | 'mb'
/**
 * Fourchettes « jeunes repérés » du handball par sexe et catégorie (temps : du plus lent au plus rapide). L'appli ne fixe
 * des valeurs que pour la démonstration U18 masculine (src/demo.ts : tailles par poste de 171 à 199 cm, sprint 10 m vers
 * 1,82 s, 30 m vers 4,35 s, T-test vers 9,2 s, 30-15 IFT vers 19 km/h, grand saut vers 2,45 m, médecine-ball vers 5,6 m,
 * empan de 20 à 25 cm, envergure de −1 à +7 cm) : les autres catégories en sont déduites (croissance, écart filles-garçons).
 */
export const RANGES: Record<Sex, Record<Cat, Record<RangeKey, Range>>> = {
  F: {
    U13: { taille: [143, 172], assise: [74, 89], poids: [33, 66], empan: [16.5, 22], sprint10: [2.35, 1.95], sprint30: [5.8, 4.8], ttest: [12.6, 10.8], vift: [14, 18], saut: [1.45, 2.05], cmj: [19, 34], mb: [2.6, 5.0] },
    U15: { taille: [152, 180], assise: [79, 93], poids: [42, 75], empan: [17.5, 23], sprint10: [2.25, 1.88], sprint30: [5.5, 4.65], ttest: [12.0, 10.4], vift: [14.5, 18.5], saut: [1.55, 2.2], cmj: [21, 37], mb: [3.0, 5.6] },
    U18: { taille: [157, 185], assise: [82, 96], poids: [48, 80], empan: [18, 23.5], sprint10: [2.18, 1.85], sprint30: [5.3, 4.55], ttest: [11.6, 10.1], vift: [15, 19], saut: [1.65, 2.3], cmj: [23, 40], mb: [3.4, 6.0] },
  },
  M: {
    U13: { taille: [145, 178], assise: [74, 90], poids: [34, 70], empan: [17, 23], sprint10: [2.25, 1.85], sprint30: [5.6, 4.6], ttest: [12.0, 10.2], vift: [15, 19.5], saut: [1.55, 2.25], cmj: [20, 38], mb: [3.0, 6.0] },
    U15: { taille: [158, 192], assise: [80, 98], poids: [43, 85], empan: [19, 25], sprint10: [2.1, 1.75], sprint30: [5.2, 4.3], ttest: [11.2, 9.6], vift: [16.5, 20.5], saut: [1.8, 2.55], cmj: [25, 45], mb: [4.0, 7.5] },
    U18: { taille: [168, 200], assise: [85, 103], poids: [55, 98], empan: [20, 26], sprint10: [1.98, 1.68], sprint30: [4.75, 4.05], ttest: [10.4, 8.9], vift: [17.5, 21.5], saut: [2.1, 2.8], cmj: [30, 52], mb: [4.8, 8.0] },
  },
}
/** Critère de chaque fourchette (identifiants de public/demo/criteres-demo.json). */
export const RANGE_CRITERION: Record<RangeKey, string> = {
  taille: 'taille', assise: 'taille_assise', poids: 'poids', empan: 'empan', sprint10: 'sprint_10', sprint30: 'sprint_30',
  ttest: 't_test', vift: 'vift', saut: 'saut_bilateral', cmj: 'cmj_hauteur', mb: 'medball_conc',
}
/** Envergure − taille (cm), par sexe et catégorie. */
export const ENVERGURE: Record<Sex, Record<Cat, Range>> = {
  F: { U13: [-3, 5], U15: [-2, 6], U18: [-2, 7] },
  M: { U13: [-2, 6], U15: [-1, 8], U18: [0, 9] },
}
const MID: Record<Cat, number> = { U13: 12.5, U15: 14.5, U18: 16.8 }
/** Croissance moyenne (cm par mois) : plus forte avant et autour du pic. */
const GROW: Record<Sex, Record<Cat, number>> = { F: { U13: 0.45, U15: 0.2, U18: 0.05 }, M: { U13: 0.5, U15: 0.45, U18: 0.15 } }

export const TESTS_FULL = ['taille', 'poids', 'taille_assise', 'envergure', 'empan', 'sprint_10', 'sprint_30', 't_test', 'vift', 'saut_bilateral', 'cmj_hauteur', 'medball_conc']
const TESTS_ANTHRO = ['taille', 'poids', 'taille_assise', 'envergure', 'empan']
const TESTS_CDE = ['taille', 'poids', 'taille_assise', 'sprint_30', 'saut_bilateral']
/** Critères physiologiques notés de 1 à 5 (« Profil physique » de la fiche), à la séance de rentrée des pôles. */
export const PHYSIO = ['explosivite', 'puissance', 'vitesse', 'detente', 'tir']

/**
 * Valeurs d'une séance de tests, dans les fourchettes de la catégorie : gabarit tiré du potentiel de taille et de la maturité
 * (plus fort chez les jeunes), vitesse, détente et puissance du talent ; corrélations taille ↔ empan, envergure, poids,
 * vitesse ↔ sprints ↔ T-test, détente ↔ grand saut ↔ CMJ. `minTaille` : taille de la séance d'avant plus un peu de croissance.
 */
export function sessionValues(p: SeedPlayer, date: string, minTaille?: number): Record<string, number> {
  const c = categoryOf(p.year, date)
  const R = RANGES[p.sex][c]
  const a = decimalAge(p.birthDate, date)
  const g = maturityWeight(a)
  const dz = 0.3 * (a - MID[c])
  const s = new Draw('session', p.i, date)
  const zs = 0.85 * p.A + 0.45 * p.m * g + 0.3 * p.e.size - 0.3 + dz
  let taille = roundTo(lerp(R.taille, phi(zs / 1.15)), 0.5)
  if (minTaille !== undefined) taille = Math.min(R.taille[1], Math.max(taille, roundTo(minTaille, 0.5)))
  const zt = (taille - R.taille[0]) / (R.taille[1] - R.taille[0])
  const poids = r1(clamp(lerp(R.poids, phi((0.75 * zs + 0.45 * p.e.w + 0.1 * p.m + (p.pos === 'PIV' ? 0.4 : 0)) / 1.1)) + 0.8 * s.normal(), R.poids[0], R.poids[1]))
  const ratio = clamp(0.515 + 0.005 * p.m * g - (p.sex === 'M' ? 0.004 : 0) + 0.006 * p.e.sit, 0.5, 0.535)
  const assise = roundTo(clamp(taille * ratio, R.assise[0], R.assise[1]), 0.5)
  const envergure = Math.round(taille + lerp(ENVERGURE[p.sex][c], phi(p.e.env)))
  const empan = r1(clamp(lerp(R.empan, 0.6 * zt + 0.4 * phi(p.e.span)) + 0.3 * s.normal(), R.empan[0], R.empan[1]))
  const za = 0.65 * p.t + 0.35 * p.m * g + 0.3 * p.e.ath - 0.15 + 0.8 * dz
  const sprint10 = r2(clamp(lerp(R.sprint10, phi(0.6 * za + 0.45 * p.e.spd)) + 0.03 * s.normal(), R.sprint10[0], R.sprint10[1]))
  const sprint30 = r2(clamp(lerp(R.sprint30, phi(0.55 * za + 0.5 * p.e.spd + 0.15 * p.e.end)) + 0.05 * s.normal(), R.sprint30[0], R.sprint30[1]))
  const ttest = r2(clamp(lerp(R.ttest, phi(0.55 * za + 0.3 * p.e.spd + 0.35 * p.e.agi)) + 0.1 * s.normal(), R.ttest[0], R.ttest[1]))
  const vift = r1(clamp(lerp(R.vift, phi(0.4 * za + 0.6 * p.e.end)) + 0.3 * s.normal(), R.vift[0], R.vift[1]))
  const saut = r2(clamp(lerp(R.saut, phi(0.6 * za + 0.45 * p.e.jump)) + 0.04 * s.normal(), R.saut[0], R.saut[1]))
  const cmj = r1(clamp(lerp(R.cmj, phi(0.6 * za + 0.5 * p.e.jump)) + 0.8 * s.normal(), R.cmj[0], R.cmj[1]))
  const mb = r2(clamp(lerp(R.mb, phi(0.5 * za + 0.35 * zs + 0.3 * p.e.mb)) + 0.1 * s.normal(), R.mb[0], R.mb[1]))
  const note = (z: number) => Math.round(clamp(3 + 1.05 * z + 0.45 * s.normal(), 1, 5))
  return {
    taille, poids, taille_assise: assise, envergure, empan, sprint_10: sprint10, sprint_30: sprint30, t_test: ttest, vift,
    saut_bilateral: saut, cmj_hauteur: cmj, medball_conc: mb,
    explosivite: note(0.6 * za + 0.4 * p.e.jump), puissance: note(0.5 * za + 0.35 * zs + 0.2 * p.e.mb), vitesse: note(0.6 * za + 0.45 * p.e.spd),
    detente: note(0.6 * za + 0.45 * p.e.jump), tir: note(0.6 * p.t + 0.4 * p.e.shot),
  }
}

interface Session {
  date: string
  tests: string[]
  author: Staff
}

/** Séances des comités, un samedi par période, selon le département. */
const CDE_PERIODS = [
  ['2024-11-09', '2024-11-16', '2024-11-23'],
  ['2025-03-15', '2025-03-22', '2025-03-29'],
  ['2025-11-08', '2025-11-15', '2025-11-22'],
  ['2026-03-14', '2026-03-21', '2026-03-28'],
  ['2026-10-03', '2026-10-10', '2026-10-17'],
]
/** Tests des pôles à la rentrée (en plus des Interpôles) ; la dernière ajoute les critères physiologiques. */
const POLE_TESTS = ['2025-10-07', '2026-10-06']
/** Part des joueurs repérés et testés (en plus de ceux testés lors des événements). */
export const DETECTED_SHARE = 0.2

export interface MeasureOut {
  rows: Row[]
  sessions: Map<number, Session[]>
}

export function buildMeasurements(players: SeedPlayer[], events: SeedEvent[], seenPlayers: Set<number>): MeasureOut {
  const sessions = new Map<number, Session[]>()
  /** On ne teste que les âges des catégories de jeunes (12 à 18 ans dans la saison). */
  const add = (p: SeedPlayer, s: Session) => {
    if (TESTED_AGES.has(seasonAge(p.year, s.date))) sessions.set(p.i, [...(sessions.get(p.i) ?? []), s])
  }
  for (const e of events) {
    if (upcoming(e) || !e.measure) continue
    for (const p of e.roster) {
      if (e.measure === 'anthro' && !new Draw('measure-ev', e.key, p.i).chance(0.85)) continue
      add(p, { date: e.date, tests: e.measure === 'full' ? TESTS_FULL : TESTS_ANTHRO, author: e.measure === 'full' ? staff('prep') : staff('etd') })
    }
  }
  const last = POLE_TESTS[POLE_TESTS.length - 1]
  for (const p of players)
    if (p.data.poles) for (const day of POLE_TESTS) if (inPoleAt(p, day)) add(p, { date: day, tests: day === last ? [...TESTS_FULL, ...PHYSIO] : TESTS_FULL, author: staff('prep') })
  // Joueurs repérés (tests des comités) : niveau, âge, département ; ceux déjà vus un peu plus souvent.
  const score = players.map((p) => 0.55 * p.L + 0.3 * (decimalAge(p.birthDate, TODAY) - 15) / 1.9 + 0.6 * Math.log(deptFactor(p.dept)) + 0.6 * new Draw('detected', p.i).normal() + (seenPlayers.has(p.i) ? 0.5 : 0))
  const cut = [...score].sort((a, b) => b - a)[Math.floor(players.length * DETECTED_SHARE)]
  for (const p of players) {
    const had = sessions.has(p.i)
    if (score[p.i] < cut && !had) continue
    const d = new Draw('cde', p.i)
    const periods = [0, 1, 2, 3, 4].filter((k) => TESTED_AGES.has(seasonAge(p.year, CDE_PERIODS[k][0])))
    const n = Math.min(periods.length, had ? (d.chance(0.35) ? 1 : 0) : 1 + d.weighted([0.6, 0.3, 0.1]))
    const chosen: number[] = []
    while (chosen.length < n) {
      const left = periods.filter((k) => !chosen.includes(k))
      chosen.push(left[d.weighted(left.map((k) => 0.6 + 0.2 * k))])
    }
    for (const k of chosen) {
      const date = CDE_PERIODS[k][hash32(`${p.dept.code}:${k}`) % 3]
      add(p, { date, tests: TESTS_CDE, author: d.chance(0.5) ? ctsOf(p.region) : staff('etd') })
    }
  }
  const rows: Row[] = []
  for (const p of players) {
    const list = sessions.get(p.i)
    if (!list) continue
    // Une séance par jour (tests réunis), les trois plus récentes au plus.
    const byDay = new Map<string, Session>()
    for (const s of list.sort((a, b) => a.date.localeCompare(b.date))) {
      const cur = byDay.get(s.date)
      byDay.set(s.date, cur ? { ...cur, tests: [...new Set([...cur.tests, ...s.tests])] } : s)
    }
    const kept = [...byDay.values()].slice(-3)
    sessions.set(p.i, kept)
    let prev: { date: string; taille: number } | undefined
    for (const s of kept) {
      const min = prev ? prev.taille + 0.3 * GROW[p.sex][categoryOf(p.year, s.date)] * ((Date.parse(s.date) - Date.parse(prev.date)) / (30.44 * 864e5)) : undefined
      const v = sessionValues(p, s.date, min)
      prev = { date: s.date, taille: v.taille }
      const at = parisIso(s.date, 19, 15)
      for (const c of [...TESTS_FULL, ...PHYSIO]) {
        if (!s.tests.includes(c)) continue
        const id = seedUuid(`m:${p.i}:${c}:${s.date}`)
        rows.push({ id, data: { id, playerId: p.id, criterionId: c, value: v[c], date: s.date, author: s.author.name, ...stamp(s.author.name, at, s.author.id) } })
      }
    }
  }
  return { rows, sessions }
}

/** Tailles des parents (taille adulte prédite) : cohérentes avec le potentiel de taille, plus grandes que la moyenne. */
export function addParents(p: SeedPlayer, chance: number) {
  const d = new Draw('parents', p.i)
  if (!d.chance(chance)) return
  const adult = lerp(RANGES[p.sex].U18.taille, phi((0.85 * p.A + 0.3 * p.e.size - 0.3) / 1.1))
  const mean = p.sex === 'M' ? 177 : 164
  const target = mean + 0.6 * (adult - mean) + 2.5 * d.normal()
  const sum = 2 * target + (p.sex === 'M' ? -13 : 13)
  const father = Math.round(clamp(sum / 2 + 6.5 + 2.5 * d.normal(), 160, 205))
  const mother = Math.round(clamp(sum - father, 148, 192))
  Object.assign(p.data, {
    fatherHeight: father,
    fatherHeightSource: d.chance(0.35) ? 'mesuree' : 'declaree',
    motherHeight: mother,
    motherHeightSource: d.chance(0.35) ? 'mesuree' : 'declaree',
  })
}

// ---------- Groupes, vidéos ----------

export function buildGroups(players: SeedPlayer[], poles: PoleOut[], events: SeedEvent[]): Row[] {
  const rows: Row[] = []
  for (const { def } of poles) {
    const by = ctsOf(def.regions[0])
    const id = seedUuid(`group:pole:${def.sex}:${fold(def.site)}`)
    rows.push({
      id,
      data: {
        id, name: def.name,
        description: `Pôle Espoirs ${sexLabel(def.sex).toLowerCase()} : membres d'après les périodes de pôle des fiches`,
        playerIds: [], poleUnitId: def.id, private: false, sex: def.sex, scope: 'ligue', regionId: def.regions[0],
        editors: [], names: { [by.id]: by.name }, addedBy: {}, ...stamp(by.name, '2025-08-28T08:30:00.000Z', by.id),
      },
    })
  }
  const roster = (key: string) => events.find((e) => e.key === key)!.roster
  const selections: [string, string, Sex, string, string[], SeedPlayer[], string][] = [
    ['sel-occ-u15-m', 'Sélection régionale U15 garçons – Occitanie', 'M', 'region-occ', ['2012', '2013'], roster('stage-occ-2026').filter((p) => p.sex === 'M'), parisIso('2026-10-22', 17, 40)],
    ['sel-hdf-u15-f', 'Sélection régionale U15 filles – Hauts-de-France', 'F', 'region-hdf', ['2012', '2013'], roster('stage-hdf-2026').filter((p) => p.sex === 'F'), parisIso('2026-10-22', 18, 5)],
    ['sel-ara-u15-m', 'Sélection régionale U15 garçons – Auvergne-Rhône-Alpes', 'M', 'region-ara', ['2012', '2013'], players.filter((p) => p.region === 'region-ara' && p.sex === 'M' && (p.year === 2012 || p.year === 2013) && p.pos), parisIso('2026-10-08', 20, 10)],
  ]
  for (const [key, name, sex, region, years, cands, at] of selections) {
    const by = ctsOf(region)
    const team = pickTeam(cands, 16, key)
    const id = seedUuid(`group:${key}`)
    rows.push({
      id,
      data: {
        id, name, description: `Interligues 2027 : liste en préparation (démonstration, ${w(sex).joueurs} ${accord('fictif', sex, 2)})`, playerIds: team.map((p) => p.id),
        private: false, sex, scope: 'ligue', regionId: region, years, editors: [], names: { [by.id]: by.name },
        addedBy: Object.fromEntries(team.map((p) => [p.id, by.id])), ...stamp(by.name, at, by.id),
      },
    })
  }
  return rows
}

export function buildVideos(players: SeedPlayer[], events: SeedEvent[]): Row[] {
  const note = (k: PillKind, more?: string) => `${pillLabel(k, undefined, 'handball').long}${more ? ` · ${more}` : ''}`
  const best = (f: (p: SeedPlayer) => boolean) => players.filter((p) => f(p) && inPoleAt(p, TODAY)).sort((a, b) => b.L - a.L)[0]
  const back = best((p) => p.sex === 'F' && p.pos === 'ARG')
  const keeper = best((p) => p.sex === 'M' && p.pos === 'GB')
  const moments = (ms: [number, string][]) => ms.map(([at, n]) => ({ at, dur: 3, note: n }))
  const m1 = moments([
    [1, note('but', 'tir en suspension')], [5, note('passe', 'jeu à deux avec le pivot')], [9, note('but', 'contre-attaque')],
    [13, 'Défense · interception'], [17, note('but7')],
  ])
  const m2 = moments([[2, note('arret', 'tir à 9 m')], [8, note('arret7')], [14, 'Relance · contre-attaque']])
  const v = (key: string, data: Record<string, unknown>, by: Staff, at: string): Row => {
    const id = seedUuid(`video:${key}`)
    return { id, data: { id, ...data, ...stamp(by.name, at, by.id) } }
  }
  const interligues = events.find((e) => e.key === 'interligues-u16-2026')!
  return [
    v('arriere', { targetKind: 'player', targetId: back.id, url: GENERIC_VIDEO, title: 'Lien générique de démonstration (aucun mineur à l’image) — gestes repérés', at: m1[0].at, moments: m1 }, staff('pole'), parisIso('2026-10-17', 19, 12)),
    v('gardien', { targetKind: 'player', targetId: keeper.id, url: GENERIC_VIDEO, title: 'Lien générique de démonstration (aucun mineur à l’image) — arrêts', at: m2[0].at, moments: m2 }, staff('gb'), parisIso('2026-10-14', 21, 3)),
    v('interligues', { targetKind: 'event', targetId: interligues.id, url: 'https://www.rematch.tv/', title: 'Match complet (lien générique de démonstration)' }, staff('cnd1'), parisIso('2026-04-27', 9, 30)),
  ]
}

// ---------- Configuration, critères ----------

/** Configuration d'une installation de handball (supabase/044) : sport = handball ; postes par défaut (pas de ligne « postes »). */
export const SPORT_ROW = { id: 'sport', data: { id: 'sport', key: 'sport', value: { sport: HANDBALL.sport, sportName: HANDBALL.sportName } } }

export function buildCriteria(file: string): { rows: Row[]; grid: Grid } {
  applySportConfig(resolveSportConfig([], 'handball'))
  const parsed = parseRows(rowsFromJson(file))
  if (parsed.errors.length) throw new Error(`Critères : ${parsed.errors.map((e) => `ligne ${e.line} ${e.reason}`).join(' ; ')}`)
  // Comme applyCriteria (src/criteriaImport.ts) : champs du fichier, deleted: false, importedAt ; champs vides retirés.
  const rows = parsed.rows.map(({ c }) => {
    const data = JSON.parse(JSON.stringify({ ...c, deleted: false, importedAt: Date.parse(CRIT_AT) })) as Record<string, unknown>
    return { id: c.id, data: { ...data, createdByName: 'Import des critères (démo)', createdAtServer: CRIT_AT, updatedByName: 'Import des critères (démo)', updatedAtServer: CRIT_AT } }
  })
  const grid: Grid = {
    subjective: parsed.rows
      .map(({ c }) => c)
      .filter((c) => c.kind === 'subjective' && c.active !== false)
      .map((c) => ({ id: c.id, category: c.category, ...(c.positions?.length ? { positions: [...c.positions] } : {}), ...(c.quick ? { quick: true } : {}) })),
  }
  return { rows, grid }
}

// ---------- Assemblage ----------

export interface Seed {
  structure: Structure
  players: SeedPlayer[]
  poles: PoleOut[]
  events: SeedEvent[]
  grid: Grid
  tables: Record<'config' | 'lists' | 'units' | 'criteria' | 'players' | 'events' | 'groups' | 'measurements' | 'evaluations' | 'seen' | 'videos', Row[]>
  measured: Map<number, Session[]>
}

export function buildSeed(criteriaFile: string): Seed {
  const criteria = buildCriteria(criteriaFile)
  const structure = buildStructure()
  const players = buildPlayers(structure)
  const poles = buildPoles(structure, players)
  const events = buildEvents(structure, players)
  const seen = buildSeen(events)
  const evaluations = buildEvaluations(events, criteria.grid)
  const byId = new Map(players.map((p) => [p.id, p]))
  const seenPlayers = new Set<number>([...seen, ...evaluations].map((r) => byId.get(r.data.playerId as string)!.i))
  const m = buildMeasurements(players, events, seenPlayers)
  const inStage = new Set(events.filter((e) => e.key.startsWith('stage-') && !upcoming(e)).flatMap((e) => e.roster.map((p) => p.i)))
  for (const p of players) if (m.sessions.has(p.i)) addParents(p, p.data.poles ? 0.9 : inStage.has(p.i) ? 0.75 : 0.55)
  const eventRows: Row[] = events.map((e) => {
    const at = parisIso(addDays(e.date, -21), 10, 0)
    const data: Record<string, unknown> = {
      id: e.id, name: e.name, type: e.type, date: e.date, place: e.place, time: e.time, ...(e.sex ? { sex: e.sex } : {}),
      playerIds: e.roster.map((p) => p.id), organizerUnitId: e.organizerId, organizerName: e.organizerName,
      ...(e.tournament ? { tournament: { ...e.tournament, assign: {} } } : {}),
      addedBy: Object.fromEntries(e.roster.map((p) => [p.id, e.creator.id])), editors: [], names: { [e.creator.id]: e.creator.name },
      ...stamp(e.creator.name, at, e.creator.id),
    }
    return { id: e.id, data }
  })
  // Colonnes de périmètre (046) calculées ici, avec la même règle que le serveur (hb_player_dept, hb_player_club).
  const scopeOf = (pid: unknown): [string | null, string | null] => {
    const p = byId.get(pid as string)
    return p ? [playerDepartment(p.data as { clubCode?: string; license?: string }) ?? null, playerClub(p.data as { clubCode?: string; license?: string }) ?? null] : [null, null]
  }
  const scoped = (rows: Row[], key = 'playerId') => rows.map((r) => ({ ...r, scope: scopeOf(r.data[key]) }))
  const videos = buildVideos(players, events).map((r) => ({ ...r, scope: r.data.targetKind === 'player' ? scopeOf(r.data.targetId) : ([null, null] as [null, null]) }))
  return {
    structure,
    players,
    poles,
    events,
    grid: criteria.grid,
    measured: m.sessions,
    tables: {
      config: [SPORT_ROW],
      lists: buildLists(),
      units: structure.rows,
      criteria: criteria.rows,
      players: scoped(players.map((p) => ({ id: p.id, data: p.data })), 'id'),
      events: eventRows,
      groups: buildGroups(players, poles, events),
      measurements: scoped(m.rows),
      evaluations: scoped(evaluations),
      seen: scoped(seen),
      videos,
    },
  }
}

// ---------- SQL ----------

const MARKED = ['players', 'measurements', 'events', 'evaluations', 'groups', 'seen', 'videos', 'units']

const PRELUDE = `-- Jeu de démonstration handball (données fictives) : début de la transaction.
\\set ON_ERROR_STOP on
begin;
-- Déclencheurs coupés le temps de l'écriture : ni journal, ni signature, ni notification (comme supabase/maintenance/demo_*.sql).
set local session_replication_role = replica;
set local statement_timeout = 0;
create temp table seed_stamp on commit drop as select (extract(epoch from now()) * 1000)::bigint as ms, now() as started;
`

const FINISH_SQL = `-- Statistiques du planificateur à jour (tables remplies dans cette transaction) : sans elles, les requêtes de fin
-- croient les tables vides et choisissent des plans très lents.
analyze public.hb_players, public.hb_measurements, public.hb_evaluations, public.hb_seen, public.hb_videos, public.hb_events, public.hb_units, public.hb_groups;

-- Périmètre (046) : colonnes déjà écrites par le générateur ; contrôle avec les fonctions du serveur (doit modifier 0 ligne).
update public.hb_players set scope_dept = public.hb_player_dept(data), scope_club = public.hb_player_club(data)
 where data ->> 'demoSeed' = '${MARK}'
   and (scope_dept is distinct from public.hb_player_dept(data) or scope_club is distinct from public.hb_player_club(data));

-- Événements (048) : territoire de l'unité organisatrice (fonction du serveur, quelques unités), puis départements et clubs
-- des joueurs inscrits (même calcul que hb_events_players_rescope, en une requête groupée).
select public.hb_events_rescope() as evenements_territoire_recalcules;
with s as (
  select e.id,
         coalesce(array_agg(distinct p.scope_dept order by p.scope_dept) filter (where coalesce(p.scope_dept, '') <> ''), '{}'::text[]) depts,
         coalesce(array_agg(distinct p.scope_club order by p.scope_club) filter (where coalesce(p.scope_club, '') <> ''), '{}'::text[]) clubs
    from public.hb_events e
    left join lateral jsonb_array_elements_text(coalesce(e.data -> 'playerIds', '[]'::jsonb)) x(pid) on true
    left join public.hb_players p on p.id = x.pid and not p.deleted
   where e.data ->> 'demoSeed' = '${MARK}'
   group by e.id)
update public.hb_events e set players_dept = s.depts, players_club = s.clubs
  from s
 where s.id = e.id and (e.players_dept is distinct from s.depts or e.players_club is distinct from s.clubs);

-- Lignes d'une version précédente du jeu (marquées, pas réécrites par ce passage) : supprimées logiquement.
do $$
declare t text; n int;
begin
  foreach t in array array[${MARKED.map((t) => `'${t}'`).join(', ')}] loop
    execute format('update public.hb_%1$s x set deleted = true, data = x.data || jsonb_build_object(''deleted'', true, ''updatedAt'', s.ms),
                           updated_at_client = s.ms, server_updated_at = clock_timestamp()
                      from seed_stamp s
                     where x.data ->> ''demoSeed'' = %2$L and not x.deleted and x.server_updated_at < s.started', t, '${MARK}');
    get diagnostics n = row_count;
    if n > 0 then raise notice 'hb_% : % ligne(s) d''une version précédente supprimée(s)', t, n; end if;
  end loop;
end $$;

-- Postes : ceux du handball par défaut. Une ligne « postes » laissée par une autre installation (volley…) les remplacerait.
do $$
begin
  if exists (select 1 from public.hb_config c where c.id = 'postes' and not c.deleted
              and exists (select 1 from jsonb_array_elements(coalesce(c.data -> 'value', '[]'::jsonb)) x
                           where not (x ->> 'code' = any (array[${HANDBALL.positions.map((p) => `'${p.code}'`).join(', ')}])))) then
    raise warning 'hb_config : la ligne « postes » contient des postes qui ne sont pas ceux du handball : à vérifier (Réglages > Structure et sport)';
  end if;
end $$;
`

const CHECKS_SQL = `-- Contrôle rapide (dans la transaction).
select 'players' as t, count(*) as n from public.hb_players where not deleted and data ->> 'demoSeed' = '${MARK}'
union all select 'measurements', count(*) from public.hb_measurements where not deleted and data ->> 'demoSeed' = '${MARK}'
union all select 'events', count(*) from public.hb_events where not deleted and data ->> 'demoSeed' = '${MARK}'
union all select 'evaluations', count(*) from public.hb_evaluations where not deleted and data ->> 'demoSeed' = '${MARK}'
union all select 'seen', count(*) from public.hb_seen where not deleted and data ->> 'demoSeed' = '${MARK}'
union all select 'groups', count(*) from public.hb_groups where not deleted and data ->> 'demoSeed' = '${MARK}'
union all select 'videos', count(*) from public.hb_videos where not deleted and data ->> 'demoSeed' = '${MARK}'
union all select 'units', count(*) from public.hb_units where not deleted and data ->> 'demoSeed' = '${MARK}'
union all select 'criteria', count(*) from public.hb_criteria where not deleted
union all select 'lists', count(*) from public.hb_lists where not deleted
union all select 'config', count(*) from public.hb_config where not deleted
union all select 'sport = handball', count(*) from public.hb_config where id = 'sport' and not deleted and data -> 'value' ->> 'sport' = 'handball'
union all select 'joueurs sans périmètre', count(*) from public.hb_players where data ->> 'demoSeed' = '${MARK}' and (scope_dept is null or scope_club is null)
union all select 'mesures, avis, vus au périmètre différent du joueur', (select count(*) from public.hb_measurements x join public.hb_players p on p.id = x.data ->> 'playerId'
   where x.data ->> 'demoSeed' = '${MARK}' and (x.scope_dept is distinct from p.scope_dept or x.scope_club is distinct from p.scope_club))
 + (select count(*) from public.hb_evaluations x join public.hb_players p on p.id = x.data ->> 'playerId'
   where x.data ->> 'demoSeed' = '${MARK}' and (x.scope_dept is distinct from p.scope_dept or x.scope_club is distinct from p.scope_club))
 + (select count(*) from public.hb_seen x join public.hb_players p on p.id = x.data ->> 'playerId'
   where x.data ->> 'demoSeed' = '${MARK}' and (x.scope_dept is distinct from p.scope_dept or x.scope_club is distinct from p.scope_club))
union all select 'événements sans territoire', count(*) from public.hb_events where data ->> 'demoSeed' = '${MARK}' and (scope_dept is null or players_dept is null)
union all select 'journal (doit rester inchangé)', count(*) from public.hb_audit;
`

/** Catégorie (U13, U15, U18) d'une mesure en SQL : âge de saison, comme categoryOf. */
const CAT_SQL = (dateExpr: string, birthExpr: string) => {
  const season = `(case when substr(${dateExpr}, 6, 2)::int >= 9 then left(${dateExpr}, 4)::int + 1 else left(${dateExpr}, 4)::int end) - left(${birthExpr}, 4)::int`
  const cats = SPORT_CONTENT.handball.youthCategories
  return `case ${cats.slice(0, -1).map((c) => `when ${season} <= ${Math.max(...c.ages)} then '${c.code}'`).join(' ')} else '${cats[cats.length - 1].code}' end`
}

/** Contrôles après passage (comptes, répartitions, fourchettes) : verify.sql. */
export function verifySql(): string {
  const bands = (['F', 'M'] as Sex[])
    .flatMap((s) => CATS.flatMap((c) => (Object.entries(RANGES[s][c]) as [RangeKey, Range][]).map(([k, [a, b]]) => `('${s}','${c}','${RANGE_CRITERION[k]}',${Math.min(a, b)},${Math.max(a, b)})`)))
    .join(',\n  ')
  return `-- Contrôles du jeu de démonstration handball (lecture seule).
\\set ON_ERROR_STOP on
\\pset footer off
\\echo '--- Lignes par table'
select 'hb_players' t, count(*) filter (where not deleted) n from public.hb_players
union all select 'hb_measurements', count(*) filter (where not deleted) from public.hb_measurements
union all select 'hb_events', count(*) filter (where not deleted) from public.hb_events
union all select 'hb_evaluations', count(*) filter (where not deleted) from public.hb_evaluations
union all select 'hb_seen', count(*) filter (where not deleted) from public.hb_seen
union all select 'hb_groups', count(*) filter (where not deleted) from public.hb_groups
union all select 'hb_videos', count(*) filter (where not deleted) from public.hb_videos
union all select 'hb_units', count(*) filter (where not deleted) from public.hb_units
union all select 'hb_levels', count(*) filter (where not deleted) from public.hb_levels
union all select 'hb_criteria', count(*) filter (where not deleted) from public.hb_criteria
union all select 'hb_lists', count(*) filter (where not deleted) from public.hb_lists
union all select 'hb_config', count(*) filter (where not deleted) from public.hb_config
union all select 'hb_audit (journal)', count(*) from public.hb_audit
union all select 'hb_notifications', count(*) from public.hb_notifications;

\\echo '--- Configuration (sport = handball ; pas de ligne « postes » : postes par défaut du handball)'
select id, data -> 'value' valeur, deleted from public.hb_config order by id;

\\echo '--- Unités par niveau'
select data ->> 'levelId' niveau, count(*) from public.hb_units where not deleted group by 1 order by 1;

\\echo '--- Filles, postes, latéralité (gauchers surtout à droite : AD, ARD)'
select round(100.0 * count(*) filter (where data ->> 'sex' = 'F') / count(*), 1) pct_filles from public.hb_players where not deleted;
select coalesce(data ->> 'position', '(sans poste)') poste, count(*), round(100.0 * count(*) / sum(count(*)) over (), 1) pct,
       round(100.0 * count(*) filter (where data ->> 'laterality' = 'gaucher') / count(*), 1) pct_gauchers
  from public.hb_players where not deleted group by 1 order by 2 desc;
select data ->> 'laterality' lateralite, round(100.0 * count(*) / sum(count(*)) over (), 1) pct from public.hb_players where not deleted group by 1 order by 2 desc;

\\echo '--- Années de naissance et trimestres (tous / vus / aux pôles en 2026-2027)'
select left(data ->> 'birthDate', 4) annee, count(*), round(100.0 * count(*) filter (where data ->> 'sex' = 'F') / count(*)) pct_filles
  from public.hb_players where not deleted group by 1 order by 1;
with p as (
  select id, ((substr(data ->> 'birthDate', 6, 2))::int + 2) / 3 tri,
         exists (select 1 from public.hb_seen s where not s.deleted and s.data ->> 'playerId' = hb_players.id) vu,
         exists (select 1 from jsonb_array_elements(coalesce(data -> 'poles', '[]')) x
                  where x ->> 'from' <= '${TODAY}' and coalesce(x ->> 'to', '9999') >= '${TODAY}') pole
    from public.hb_players where not deleted)
select tri trimestre, round(100.0 * count(*) / sum(count(*)) over (), 1) tous,
       round(100.0 * count(*) filter (where vu) / sum(count(*) filter (where vu)) over (), 1) vus,
       round(100.0 * count(*) filter (where pole) / nullif(sum(count(*) filter (where pole)) over (), 0), 1) poles
  from p group by 1 order by 1;

\\echo '--- Part de joueurs vus par génération (depuis toujours)'
select left(p.data ->> 'birthDate', 4) annee, count(*) joueurs,
       round(100.0 * count(*) filter (where exists (select 1 from public.hb_seen s where not s.deleted and s.data ->> 'playerId' = p.id)) / count(*), 1) pct_vus,
       round(100.0 * count(*) filter (where exists (select 1 from public.hb_measurements m where not m.deleted and m.data ->> 'playerId' = p.id)) / count(*), 1) pct_mesures
  from public.hb_players p where not p.deleted group by 1 order by 1;

\\echo '--- Joueurs par département (les 8 plus gros, les 8 plus petits) et départements les moins vus'
(select scope_dept dept, count(*) joueurs from public.hb_players where not deleted group by 1 order by 2 desc limit 8)
union all (select scope_dept, count(*) from public.hb_players where not deleted group by 1 order by 2 asc limit 8);
select p.scope_dept dept, count(*) joueurs,
       round(100.0 * count(*) filter (where exists (select 1 from public.hb_seen s where not s.deleted and s.data ->> 'playerId' = p.id)) / count(*), 1) pct_vus
  from public.hb_players p where not p.deleted group by 1 having count(*) >= 60 order by 3 asc limit 10;

\\echo '--- Groupes des pôles : membres en cours, sélections'
select g.data ->> 'name' groupe, (select count(*) from public.hb_players p
         where not p.deleted and exists (select 1 from jsonb_array_elements(coalesce(p.data -> 'poles', '[]')) x
                                          where x ->> 'site' = u.data ->> 'poleSite' and x ->> 'regionId' = g.data ->> 'regionId'
                                            and x ->> 'from' <= '${TODAY}' and coalesce(x ->> 'to', '9999') >= '${TODAY}')
           and p.data ->> 'sex' = u.data ->> 'poleSex') membres
  from public.hb_groups g join public.hb_units u on u.id = g.data ->> 'poleUnitId'
 where not g.deleted order by 1;
select data ->> 'name' groupe, jsonb_array_length(data -> 'playerIds') joueurs from public.hb_groups where not deleted and data ->> 'poleUnitId' is null order by 1;
select x ->> 'exitReason' motif_de_sortie, count(*) from public.hb_players p cross join lateral jsonb_array_elements(coalesce(p.data -> 'poles', '[]')) x
 where not p.deleted and x ? 'to' group by 1;

\\echo '--- Tests hors des fourchettes (doit être vide)'
with bands(sex, cat, crit, lo, hi) as (values
  ${bands}),
m as (
  select m.data ->> 'criterionId' crit, (m.data ->> 'value')::numeric v, p.data ->> 'sex' sex,
         ${CAT_SQL(`(m.data ->> 'date')`, `(p.data ->> 'birthDate')`)} cat
    from public.hb_measurements m join public.hb_players p on p.id = m.data ->> 'playerId'
   where not m.deleted)
select m.crit, m.sex, m.cat, count(*) hors, min(v), max(v) from m join bands b using (sex, cat, crit)
 where m.v < b.lo or m.v > b.hi group by 1, 2, 3;
select m.data ->> 'criterionId' test, count(*) mesures, min((m.data ->> 'value')::numeric), round(avg((m.data ->> 'value')::numeric), 2) moyenne, max((m.data ->> 'value')::numeric)
  from public.hb_measurements m where not m.deleted group by 1 order by 1;
select n seances, count(*) joueurs from (select data ->> 'playerId' p, count(distinct data ->> 'date') n from public.hb_measurements where not deleted group by 1) x group by 1 order by 1;

\\echo '--- Avis : critères et joueurs existants, notes ; gardiens notés sur les critères du gardien'
select count(*) avis, count(*) filter (where not exists (select 1 from public.hb_players p where p.id = e.data ->> 'playerId' and not p.deleted)) sans_joueur,
       count(*) filter (where not exists (select 1 from public.hb_events v where v.id = e.data ->> 'eventId' and not v.deleted)) sans_evenement
  from public.hb_evaluations e where not e.deleted;
select count(*) notes, count(*) filter (where c.id is null) critere_inconnu, round(avg(s.value::numeric), 2) moyenne,
       count(*) filter (where s.value::numeric not between 1 and 5) hors_echelle,
       count(*) filter (where c.data -> 'positions' is not null and jsonb_array_length(c.data -> 'positions') > 0
                          and p.data ->> 'position' is not null and not (c.data -> 'positions' ? (p.data ->> 'position'))) hors_poste
  from public.hb_evaluations e cross join lateral jsonb_each_text(e.data -> 'scores') s(key, value)
  join public.hb_players p on p.id = e.data ->> 'playerId'
  left join public.hb_criteria c on c.id = s.key and not c.deleted where not e.deleted;
select count(*) seen_sans_liste from public.hb_seen s join public.hb_events e on e.id = s.data ->> 'eventId'
 where not s.deleted and not (e.data -> 'playerIds' ? (s.data ->> 'playerId'));

\\echo '--- Événements'
select e.data ->> 'date' jour, e.data ->> 'name' nom, jsonb_array_length(e.data -> 'playerIds') liste,
       (select count(*) from public.hb_seen s where not s.deleted and s.data ->> 'eventId' = e.id) vus,
       (select count(*) from public.hb_evaluations v where not v.deleted and v.data ->> 'eventId' = e.id) avis,
       cardinality(e.scope_dept) territoire, cardinality(e.players_dept) depts_joueurs
  from public.hb_events e where not e.deleted order by 1, 2;

\\echo '--- Taille de la base'
select pg_size_pretty(pg_database_size(current_database())) taille_base;
`
}

export function writeSql(seed: Seed, dir: string) {
  mkdirSync(dir, { recursive: true })
  const files: [string, string][] = [
    ['01_config_listes.sql', LEVELS_SQL + '\n' + upsertSql('config', seed.tables.config, 'admin') + '\n' + upsertSql('lists', seed.tables.lists, 'admin')],
    ['02_structure.sql', upsertSql('units', seed.tables.units)],
    ['03_criteres.sql', upsertSql('criteria', seed.tables.criteria)],
    ['04_joueurs.sql', upsertSql('players', seed.tables.players)],
    ['05_evenements.sql', upsertSql('events', seed.tables.events)],
    ['06_groupes.sql', upsertSql('groups', seed.tables.groups)],
    ['07_mesures.sql', upsertSql('measurements', seed.tables.measurements)],
    ['08_avis.sql', upsertSql('evaluations', seed.tables.evaluations)],
    ['09_vus.sql', upsertSql('seen', seed.tables.seen)],
    ['10_videos.sql', upsertSql('videos', seed.tables.videos)],
    ['11_fin.sql', FINISH_SQL],
    ['12_controle.sql', CHECKS_SQL],
  ]
  for (const [name, sql] of files) writeFileSync(join(dir, name), sql)
  const includes = files.map(([n]) => `\\echo '${n}'\n\\ir ${n}`).join('\n')
  writeFileSync(join(dir, 'apply.sql'), `${PRELUDE}\n${includes}\ncommit;\n`)
  writeFileSync(join(dir, 'dry-run.sql'), `${PRELUDE}\n${includes}\n\\echo 'Essai terminé : tout est annulé.'\nrollback;\n`)
  writeFileSync(join(dir, 'verify.sql'), verifySql())
  return files.map(([n]) => n)
}

// ---------- Chiffres clés ----------

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0)
const quarter = (p: SeedPlayer) => Math.floor((Number(p.birthDate.slice(5, 7)) - 1) / 3) + 1
const quarters = (ps: readonly SeedPlayer[]) => [1, 2, 3, 4].map((k) => pct(ps.filter((p) => quarter(p) === k).length, ps.length))

export function stats(seed: Seed) {
  const { players, tables } = seed
  const byId = new Map(players.map((p) => [p.id, p]))
  const seenIds = new Set(tables.seen.map((r) => r.data.playerId as string))
  const measuredIds = new Set(tables.measurements.map((r) => r.data.playerId as string))
  const withPos = players.filter((p) => p.pos)
  const codes = HANDBALL.positions.map((p) => p.code)
  const positions = Object.fromEntries(codes.map((c) => [c, pct(withPos.filter((p) => p.pos === c).length, withPos.length)]))
  const leftByPos = Object.fromEntries(codes.map((c) => [c, pct(withPos.filter((p) => p.pos === c && p.laterality === 'gaucher').length, withPos.filter((p) => p.pos === c).length)]))
  const byYear = Object.fromEntries(
    YEARS.map((y) => {
      const ps = players.filter((p) => p.year === y)
      return [y, { n: ps.length, girls: pct(ps.filter((p) => p.sex === 'F').length, ps.length), seen: pct(ps.filter((p) => seenIds.has(p.id)).length, ps.length), measured: pct(ps.filter((p) => measuredIds.has(p.id)).length, ps.length) }]
    }),
  )
  const depts = new Map<string, { n: number; seen: number }>()
  for (const p of players) {
    const k = appDept(p.dept)
    const d = depts.get(k) ?? { n: 0, seen: 0 }
    d.n++
    if (seenIds.has(p.id)) d.seen++
    depts.set(k, d)
  }
  const deptRows = [...depts].map(([code, d]) => ({ code, n: d.n, seen: pct(d.seen, d.n) }))
  const poleNow = players.filter((p) => inPoleAt(p, TODAY))
  const scores = tables.evaluations.flatMap((r) => Object.values(r.data.scores as Record<string, number>))
  return {
    counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    clubs: seed.structure.clubs.length,
    girls: pct(players.filter((p) => p.sex === 'F').length, players.length),
    positions,
    leftByPosition: leftByPos,
    noPosition: pct(players.length - withPos.length, players.length),
    leftHanded: pct(players.filter((p) => p.laterality === 'gaucher').length, players.length),
    quarters: { all: quarters(players), seen: quarters(players.filter((p) => seenIds.has(p.id))), poles: quarters(poleNow) },
    byYear,
    seenPlayers: pct(seenIds.size, players.length),
    measuredPlayers: pct(measuredIds.size, players.length),
    deptsLeastSeen: deptRows.filter((d) => d.n >= 60).sort((a, b) => a.seen - b.seen).slice(0, 8),
    deptsMostSeen: deptRows.filter((d) => d.n >= 60).sort((a, b) => b.seen - a.seen).slice(0, 6),
    poles: { sites: seed.poles.length, now: poleNow.length, past: seed.poles.reduce((s, x) => s + x.past.length, 0), sizes: seed.poles.map((x) => x.current.length) },
    events: seed.events.map((e) => ({
      date: e.date,
      name: e.name,
      roster: e.roster.length,
      seen: tables.seen.filter((r) => r.data.eventId === e.id).length,
      evals: tables.evaluations.filter((r) => r.data.eventId === e.id).length,
    })),
    evalMean: Math.round((100 * scores.reduce((s, x) => s + x, 0)) / scores.length) / 100,
    scoreDist: [1, 2, 3, 4, 5].map((k) => pct(scores.filter((x) => x === k).length, scores.length)),
    sessions: [1, 2, 3].map((k) => [...seed.measured.values()].filter((s) => s.length === k).length),
    parents: players.filter((p) => p.data.fatherHeight).length,
    seenByUnknown: tables.seen.filter((r) => !byId.has(r.data.playerId as string)).length,
    config: seed.tables.config.map((r) => r.data),
  }
}

// ---------- Programme ----------

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('Usage : npx jiti tools/seed-hand.ts <dossier de sortie hors du dépôt>')
    process.exit(1)
  }
  if (insideRepo(dir)) {
    console.error('Le dossier de sortie doit être HORS du dépôt (données générées, jamais commitées).')
    process.exit(1)
  }
  const root = resolve(fileURLToPath(import.meta.url), '../..')
  const t0 = Date.now()
  const seed = buildSeed(readFileSync(join(root, 'public', SPORT_CONTENT.handball.demoCriteria), 'utf8'))
  const files = writeSql(seed, resolve(dir))
  console.log(JSON.stringify(stats(seed), null, 1))
  console.log(`\n${files.length} fichiers SQL + apply.sql, dry-run.sql, verify.sql dans ${resolve(dir)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
}
