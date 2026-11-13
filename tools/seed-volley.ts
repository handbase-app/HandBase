/*
 * Jeu de démonstration FICTIF à l'échelle nationale pour une installation volley (base Supabase « Nextar-volley »).
 *
 * Écrit des fichiers SQL (HORS du dépôt : données générées, jamais commitées) qui remplissent la base avec :
 *  - la configuration (sport = volley ; postes par défaut, pas de ligne « postes ») et les listes (régions, départements) ;
 *  - la structure façon FFVB : fédération, ligues (13 de métropole + 6 ultramarines), un comité par département, ~1 450 clubs
 *    aux noms FICTIFS placés dans de vraies villes du bon département (code postal, coordonnées approchées), les pôles
 *    espoirs (villes réelles des pôles, ce sont des institutions) ;
 *  - les 43 critères et tests du volley (public/demo/criteres-volley.json, lus par l'importeur de l'appli) ;
 *  - ~25 000 joueuses et joueurs FICTIFS nés de 2008 à 2013 (58 % de filles, effet de l'âge relatif), leurs tests physiques
 *    (1 à 3 séances, fourchettes de src/demoVolley.ts), des événements de la filière (détections, stages CRE, Volleyades,
 *    Interpôles, tournoi des sélections, Coupe de France), des « vu », des avis sur les grilles du volley, les groupes des
 *    pôles (périodes de pôle sur les fiches, src/poleSeason.ts) et trois sélections régionales, trois liens vidéo.
 * Noms et prénoms courants mélangés au hasard (aucune personne réelle) ; staff fictif (noms et identifiants inventés, sans
 * compte ni profil : l'appli affiche createdByName / observer tels quels). Aucune donnée fédérale, aucun mineur réel.
 *
 * Déterministe : générateur pseudo-aléatoire à graine fixe, identifiants stables (UUID dérivés d'une clé) ; relancer donne
 * les mêmes lignes (seules les dates de modification changent), sans doublon (« on conflict (id) do update »). Les lignes
 * portent data.demoSeed = 'volley' : une ligne d'une version précédente du jeu, absente de la nouvelle, est supprimée
 * (logiquement) à la fin. Déclencheurs coupés pendant l'écriture (session_replication_role = replica : ni journal, ni
 * signature, ni notification) ; la date serveur avance (les appareils reçoivent tout) ; colonnes de périmètre (046) écrites
 * avec les lignes (même règle que hb_player_dept / hb_player_club, contrôlée à la fin), territoire des événements (048)
 * calculé à la fin par le serveur. Les tâches de nuit ne touchent pas ces fiches (ni « review », ni suppression).
 *
 * Offre gratuite de Supabase : un passage complet écrit ~150 Mo en une transaction (~40 s). Ne pas enchaîner plusieurs
 * passages complets : le débit disque est limité, un deuxième passage d'affilée a été ralenti jusqu'à l'arrêt de la base
 * (tout a été annulé). Après un passage annulé ou interrompu, lancer « vacuum (analyze) » sur les tables hb_* avant de
 * recommencer (pages mortes, sinon la base grossit vers la limite de 500 Mo).
 *
 * Relancer :
 *   npx jiti tools/seed-volley.ts <dossier hors du dépôt>      → écrit les fichiers SQL et affiche les chiffres clés
 *   cd <dossier> && psql "<connexion>" -X -f dry-run.sql        → essai complet dans une transaction ANNULÉE
 *   cd <dossier> && psql "<connexion>" -X -f apply.sql          → pour de bon (une seule transaction)
 *   cd <dossier> && psql "<connexion>" -X -f verify.sql         → contrôles (comptes, répartitions, fourchettes)
 * Tests des parties pures : npx jiti tools/test-seed-volley.ts
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRows, rowsFromJson } from '../src/criteriaFormat'
import { applySportConfig, resolveSportConfig } from '../src/sportConfig'
import { OFFICIAL_REGIONS, REGION_FALLBACK } from '../src/regionsOfficial'
import { playerClub, playerDepartment } from '../src/perimeter'
import { RANGES, GRID_CHAMP, GRID_MENTAL, GRID_PASSEUR, QUICK } from '../src/demoVolley'
import { volleyNote, type VolleyOutcome, type VolleySkill } from '../src/volleyActions'
import { poleCode } from '../src/structureImport'
import type { PoleProgramme } from '../src/db'

// ---------- Hasard déterministe ----------

/** Empreinte 32 bits (FNV-1a) d'un texte. */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Générateur pseudo-aléatoire (le même que les démos de l'appli, src/demoVolley.ts). */
export function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const SEED = 'nextar-volley-demo-2026'

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
    const tot = ws.reduce((s, w) => s + w, 0)
    let x = this.r() * tot
    for (let i = 0; i < ws.length; i++) {
      x -= ws[i]
      if (x < 0) return i
    }
    return ws.length - 1
  }
}

/** Fonction de répartition de la loi normale (approximation d'Abramowitz et Stegun, 7.1.26). */
export function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2)
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
export const clamp = (x: number, a: number, b: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), x))
export const lerp = ([a, b]: readonly [number, number], t: number) => a + (b - a) * clamp(t, 0, 1)
export const roundTo = (x: number, step: number) => Math.round(x / step) * step
export const r1 = (x: number) => Math.round(x * 10) / 10
export const r2 = (x: number) => Math.round(x * 100) / 100

/** Identifiant stable au format UUID (v5 : empreinte SHA-1 d'une clé). */
export function seedUuid(key: string): string {
  const h = createHash('sha1').update(`nextar-volley-seed/${key}`).digest('hex')
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// ---------- Départements, ligues ----------

/**
 * Départements : numéro, nom, « de … » (nom du comité), population approchée (milliers d'habitants, pour répartir les
 * clubs). Corse : deux comités (2A, 2B), un seul numéro de département dans les n° de club (« 20 », comme le reste de
 * l'appli) ; outre-mer : un territoire par ligue (n° de club 64… → 971, src/perimeter.ts).
 */
const DEPT_TABLE = `01|Ain|de l'Ain|660
02|Aisne|de l'Aisne|530
03|Allier|de l'Allier|335
04|Alpes-de-Haute-Provence|des Alpes-de-Haute-Provence|165
05|Hautes-Alpes|des Hautes-Alpes|141
06|Alpes-Maritimes|des Alpes-Maritimes|1100
07|Ardèche|de l'Ardèche|330
08|Ardennes|des Ardennes|270
09|Ariège|de l'Ariège|155
10|Aube|de l'Aube|310
11|Aude|de l'Aude|375
12|Aveyron|de l'Aveyron|280
13|Bouches-du-Rhône|des Bouches-du-Rhône|2050
14|Calvados|du Calvados|700
15|Cantal|du Cantal|145
16|Charente|de la Charente|350
17|Charente-Maritime|de la Charente-Maritime|655
18|Cher|du Cher|300
19|Corrèze|de la Corrèze|240
2A|Corse-du-Sud|de la Corse-du-Sud|160
2B|Haute-Corse|de la Haute-Corse|182
21|Côte-d'Or|de la Côte-d'Or|535
22|Côtes-d'Armor|des Côtes-d'Armor|605
23|Creuse|de la Creuse|116
24|Dordogne|de la Dordogne|415
25|Doubs|du Doubs|545
26|Drôme|de la Drôme|520
27|Eure|de l'Eure|600
28|Eure-et-Loir|d'Eure-et-Loir|430
29|Finistère|du Finistère|920
30|Gard|du Gard|750
31|Haute-Garonne|de la Haute-Garonne|1430
32|Gers|du Gers|192
33|Gironde|de la Gironde|1650
34|Hérault|de l'Hérault|1200
35|Ille-et-Vilaine|d'Ille-et-Vilaine|1100
36|Indre|de l'Indre|218
37|Indre-et-Loire|d'Indre-et-Loire|610
38|Isère|de l'Isère|1280
39|Jura|du Jura|258
40|Landes|des Landes|420
41|Loir-et-Cher|de Loir-et-Cher|330
42|Loire|de la Loire|765
43|Haute-Loire|de la Haute-Loire|228
44|Loire-Atlantique|de Loire-Atlantique|1450
45|Loiret|du Loiret|680
46|Lot|du Lot|175
47|Lot-et-Garonne|de Lot-et-Garonne|330
48|Lozère|de la Lozère|77
49|Maine-et-Loire|de Maine-et-Loire|820
50|Manche|de la Manche|495
51|Marne|de la Marne|565
52|Haute-Marne|de la Haute-Marne|170
53|Mayenne|de la Mayenne|307
54|Meurthe-et-Moselle|de Meurthe-et-Moselle|730
55|Meuse|de la Meuse|183
56|Morbihan|du Morbihan|760
57|Moselle|de la Moselle|1045
58|Nièvre|de la Nièvre|202
59|Nord|du Nord|2610
60|Oise|de l'Oise|830
61|Orne|de l'Orne|280
62|Pas-de-Calais|du Pas-de-Calais|1460
63|Puy-de-Dôme|du Puy-de-Dôme|665
64|Pyrénées-Atlantiques|des Pyrénées-Atlantiques|690
65|Hautes-Pyrénées|des Hautes-Pyrénées|230
66|Pyrénées-Orientales|des Pyrénées-Orientales|480
67|Bas-Rhin|du Bas-Rhin|1150
68|Haut-Rhin|du Haut-Rhin|765
69|Rhône|du Rhône|1900
70|Haute-Saône|de la Haute-Saône|235
71|Saône-et-Loire|de Saône-et-Loire|550
72|Sarthe|de la Sarthe|565
73|Savoie|de la Savoie|440
74|Haute-Savoie|de la Haute-Savoie|840
75|Paris|de Paris|2140
76|Seine-Maritime|de la Seine-Maritime|1250
77|Seine-et-Marne|de Seine-et-Marne|1430
78|Yvelines|des Yvelines|1450
79|Deux-Sèvres|des Deux-Sèvres|375
80|Somme|de la Somme|570
81|Tarn|du Tarn|390
82|Tarn-et-Garonne|de Tarn-et-Garonne|262
83|Var|du Var|1080
84|Vaucluse|de Vaucluse|565
85|Vendée|de la Vendée|690
86|Vienne|de la Vienne|440
87|Haute-Vienne|de la Haute-Vienne|372
88|Vosges|des Vosges|362
89|Yonne|de l'Yonne|335
90|Territoire de Belfort|du Territoire de Belfort|140
91|Essonne|de l'Essonne|1310
92|Hauts-de-Seine|des Hauts-de-Seine|1630
93|Seine-Saint-Denis|de la Seine-Saint-Denis|1660
94|Val-de-Marne|du Val-de-Marne|1410
95|Val-d'Oise|du Val-d'Oise|1250
971|Guadeloupe|de la Guadeloupe|385
972|Martinique|de la Martinique|360
973|Guyane|de la Guyane|285
974|La Réunion|de La Réunion|870
976|Mayotte|de Mayotte|300
988|Nouvelle-Calédonie|de Nouvelle-Calédonie|270`

export interface Dept {
  code: string
  name: string
  de: string
  pop: number
  region: string
  /** Numéro de département dans les n° de club (Corse : 20 ; outre-mer : 01, la ligue donne le territoire). */
  clubDigits: string
  ligue: string
}

const REGION_OF = new Map(Object.entries(OFFICIAL_REGIONS).flatMap(([r, ds]) => ds.split(' ').map((d) => [d, r] as const)))

/** Ligues : 13 de métropole (n° 51 à 63, hors des n° ultramarins 64 à 70 de src/perimeter.ts) et 6 ultramarines. */
export const LIGUES: { key: string; code: string; name: string; region: string; depts: string[]; seat: string }[] = [
  { key: 'region-ara', code: '51', name: 'Ligue Auvergne-Rhône-Alpes de volley', region: 'region-ara', depts: [], seat: 'Lyon' },
  { key: 'region-bfc', code: '52', name: 'Ligue Bourgogne-Franche-Comté de volley', region: 'region-bfc', depts: [], seat: 'Dijon' },
  { key: 'region-bre', code: '53', name: 'Ligue de Bretagne de volley', region: 'region-bre', depts: [], seat: 'Rennes' },
  { key: 'region-cvl', code: '54', name: 'Ligue du Centre-Val de Loire de volley', region: 'region-cvl', depts: [], seat: 'Orléans' },
  { key: 'region-cor', code: '55', name: 'Ligue de Corse de volley', region: 'region-cor', depts: [], seat: 'Ajaccio' },
  { key: 'region-ges', code: '56', name: 'Ligue du Grand Est de volley', region: 'region-ges', depts: [], seat: 'Strasbourg' },
  { key: 'region-hdf', code: '57', name: 'Ligue des Hauts-de-France de volley', region: 'region-hdf', depts: [], seat: 'Lille' },
  { key: 'region-idf', code: '58', name: "Ligue d'Île-de-France de volley", region: 'region-idf', depts: [], seat: 'Paris' },
  { key: 'region-nor', code: '59', name: 'Ligue de Normandie de volley', region: 'region-nor', depts: [], seat: 'Caen' },
  { key: 'region-naq', code: '60', name: 'Ligue de Nouvelle-Aquitaine de volley', region: 'region-naq', depts: [], seat: 'Bordeaux' },
  { key: 'region-occ', code: '61', name: "Ligue d'Occitanie de volley", region: 'region-occ', depts: [], seat: 'Toulouse' },
  { key: 'region-pdl', code: '62', name: 'Ligue des Pays de la Loire de volley', region: 'region-pdl', depts: [], seat: 'Nantes' },
  { key: 'region-sud', code: '63', name: 'Ligue Région Sud de volley', region: 'region-sud', depts: [], seat: 'Marseille' },
  { key: 'om-971', code: '64', name: 'Ligue de la Guadeloupe de volley', region: 'region-ant', depts: ['971'], seat: 'Les Abymes' },
  { key: 'om-973', code: '65', name: 'Ligue de la Guyane de volley', region: 'region-guy', depts: ['973'], seat: 'Cayenne' },
  { key: 'om-972', code: '66', name: 'Ligue de la Martinique de volley', region: 'region-ant', depts: ['972'], seat: 'Fort-de-France' },
  { key: 'om-988', code: '67', name: 'Ligue de Nouvelle-Calédonie de volley', region: 'region-nc', depts: ['988'], seat: 'Nouméa' },
  { key: 'om-974', code: '69', name: 'Ligue de La Réunion de volley', region: 'region-reu', depts: ['974'], seat: 'Saint-Denis' },
  { key: 'om-976', code: '70', name: 'Ligue de Mayotte de volley', region: 'region-may', depts: ['976'], seat: 'Mamoudzou' },
]

export const DEPTS: Dept[] = DEPT_TABLE.split('\n').map((line) => {
  const [code, name, de, pop] = line.split('|')
  const overseas = code.length === 3
  const ligue = overseas ? LIGUES.find((l) => l.depts.includes(code))! : LIGUES.find((l) => l.region === REGION_OF.get(code))!
  if (!overseas) ligue.depts.push(code)
  return { code, name, de, pop: Number(pop), region: ligue.region, clubDigits: overseas ? '01' : code.startsWith('2') && /[AB]/.test(code) ? '20' : code, ligue: ligue.key }
})
const DEPT = new Map(DEPTS.map((d) => [d.code, d]))

/** Département d'un joueur tel que l'appli le lit (n° de club) : « 20 » pour la Corse. */
export const appDept = (d: Dept) => (d.clubDigits === '20' ? '20' : d.code)

// ---------- Villes réelles (nom ; code(s) postal(aux) ; latitude ; longitude ; population en milliers) ----------
// Coordonnées approchées du centre de la commune (faits géographiques publics) ; contrôlées par
// tools/test-seed-volley.ts : chaque ville tombe dans le contour de son département (src/assets/departements.json).

const TOWNS: Record<string, string> = {
  '01': `Bourg-en-Bresse;01000;46.205;5.226;42|Oyonnax;01100;46.257;5.655;22|Valserhône;01200;46.108;5.826;16|Ambérieu-en-Bugey;01500;45.958;5.358;14|Saint-Genis-Pouilly;01630;46.243;6.022;13|Gex;01170;46.333;6.058;13|Miribel;01700;45.826;4.954;10|Divonne-les-Bains;01220;46.357;6.143;10|Belley;01300;45.759;5.688;9`,
  '02': `Saint-Quentin;02100;49.847;3.287;53|Soissons;02200;49.381;3.324;29|Laon;02000;49.564;3.620;24|Château-Thierry;02400;49.046;3.403;14|Tergnier;02700;49.656;3.301;13|Chauny;02300;49.616;3.219;11|Hirson;02500;49.922;4.084;9`,
  '03': `Montluçon;03100;46.340;2.603;34|Vichy;03200;46.127;3.426;25|Moulins;03000;46.566;3.333;19|Yzeure;03400;46.565;3.355;13|Cusset;03300;46.135;3.457;13`,
  '04': `Manosque;04100;43.828;5.787;22|Digne-les-Bains;04000;44.093;6.236;16|Sisteron;04200;44.195;5.944;8|Forcalquier;04300;43.960;5.780;5`,
  '05': `Gap;05000;44.559;6.079;41|Briançon;05100;44.899;6.643;11|Embrun;05200;44.564;6.495;6|Laragne-Montéglin;05300;44.316;5.818;4`,
  '06': `Nice;06000,06100,06200,06300;43.703;7.266;342|Cannes;06400;43.552;7.017;74|Antibes;06600;43.581;7.125;73|Cagnes-sur-Mer;06800;43.664;7.149;52|Grasse;06130;43.659;6.924;50|Le Cannet;06110;43.577;7.019;42|Saint-Laurent-du-Var;06700;43.673;7.190;30|Menton;06500;43.775;7.497;30|Vallauris;06220;43.578;7.054;27|Mandelieu-la-Napoule;06210;43.546;6.938;22|Mougins;06250;43.600;6.995;19|Valbonne;06560;43.641;7.009;13`,
  '07': `Annonay;07100;45.240;4.671;17|Aubenas;07200;44.620;4.390;12|Guilherand-Granges;07500;44.933;4.874;11|Tournon-sur-Rhône;07300;45.067;4.833;11|Privas;07000;44.735;4.599;8|Le Teil;07400;44.545;4.682;8`,
  '08': `Charleville-Mézières;08000;49.773;4.720;46|Sedan;08200;49.702;4.940;16|Rethel;08300;49.510;4.367;8|Revin;08500;49.940;4.635;6|Givet;08600;50.138;4.825;6`,
  '09': `Pamiers;09100;43.116;1.611;16|Foix;09000;42.965;1.607;9|Saint-Girons;09200;42.985;1.146;6|Lavelanet;09300;42.931;1.849;6`,
  '10': `Troyes;10000;48.297;4.074;61|Romilly-sur-Seine;10100;48.516;3.727;14|La Chapelle-Saint-Luc;10600;48.313;4.044;12|Saint-André-les-Vergers;10120;48.279;4.052;11|Sainte-Savine;10300;48.296;4.050;10|Bar-sur-Aube;10200;48.234;4.706;5`,
  '11': `Narbonne;11100;43.184;3.004;56|Carcassonne;11000;43.213;2.349;46|Castelnaudary;11400;43.318;1.954;12|Lézignan-Corbières;11200;43.201;2.758;11|Limoux;11300;43.054;2.218;10`,
  '12': `Rodez;12000;44.350;2.575;24|Millau;12100;44.098;3.078;22|Villefranche-de-Rouergue;12200;44.352;2.035;12|Onet-le-Château;12850;44.366;2.593;12|Saint-Affrique;12400;43.958;2.887;8|Decazeville;12300;44.560;2.250;5`,
  '13': `Marseille;13013,13008,13009,13012,13015,13014,13010,13011,13005,13004,13003,13006,13016,13007,13001,13002;43.296;5.370;870|Aix-en-Provence;13100,13090;43.529;5.447;145|Arles;13200;43.677;4.631;51|Martigues;13500;43.405;5.048;49|Aubagne;13400;43.293;5.571;47|Salon-de-Provence;13300;43.640;5.097;46|Istres;13800;43.513;4.989;44|La Ciotat;13600;43.175;5.605;37|Vitrolles;13127;43.460;5.248;34|Marignane;13700;43.416;5.215;34|Miramas;13140;43.582;5.002;27|Gardanne;13120;43.455;5.469;22|Les Pennes-Mirabeau;13170;43.410;5.309;21|Allauch;13190;43.336;5.482;21|Port-de-Bouc;13110;43.405;4.986;17|Châteaurenard;13160;43.882;4.855;16|Septèmes-les-Vallons;13240;43.398;5.366;11|Venelles;13770;43.598;5.483;8`,
  '14': `Caen;14000;49.183;-0.370;106|Hérouville-Saint-Clair;14200;49.205;-0.329;22|Lisieux;14100;49.146;0.226;20|Vire Normandie;14500;48.838;-0.889;17|Bayeux;14400;49.276;-0.703;13|Ifs;14123;49.141;-0.351;12|Mondeville;14120;49.175;-0.322;10|Falaise;14700;48.895;-0.197;8|Honfleur;14600;49.419;0.233;7`,
  '15': `Aurillac;15000;44.926;2.444;26|Saint-Flour;15100;45.034;3.093;6|Arpajon-sur-Cère;15130;44.904;2.457;6|Mauriac;15200;45.219;2.333;4`,
  '16': `Angoulême;16000;45.648;0.156;41|Cognac;16100;45.696;-0.329;18|Soyaux;16800;45.641;0.199;10|Ruelle-sur-Touvre;16600;45.678;0.231;7|La Couronne;16400;45.608;0.100;7|Confolens;16500;46.014;0.672;3`,
  '17': `La Rochelle;17000;46.160;-1.151;77|Saintes;17100;45.745;-0.633;25|Rochefort;17300;45.937;-0.959;24|Royan;17200;45.624;-1.029;19|Aytré;17440;46.134;-1.115;9|Lagord;17140;46.188;-1.155;7|Saint-Jean-d'Angély;17400;45.946;-0.521;7|Jonzac;17500;45.446;-0.434;3`,
  '18': `Bourges;18000;47.081;2.399;64|Vierzon;18100;47.222;2.069;25|Saint-Amand-Montrond;18200;46.723;2.505;10|Saint-Doulchard;18230;47.103;2.355;10|Mehun-sur-Yèvre;18500;47.144;2.216;7`,
  '19': `Brive-la-Gaillarde;19100;45.159;1.533;46|Tulle;19000;45.267;1.770;15|Ussel;19200;45.548;2.309;10|Malemort;19360;45.170;1.564;8`,
  '2A': `Ajaccio;20000,20090;41.919;8.739;71|Porto-Vecchio;20137;41.591;9.279;12|Propriano;20110;41.676;8.904;3|Sartène;20100;41.622;8.974;3`,
  '2B': `Bastia;20200,20600;42.697;9.451;48|Borgo;20290;42.555;9.428;9|Biguglia;20620;42.627;9.420;8|Corte;20250;42.306;9.150;7|Calvi;20260;42.568;8.757;6`,
  '21': `Dijon;21000;47.322;5.041;159|Beaune;21200;47.025;4.840;20|Chenôve;21300;47.293;5.007;14|Talant;21240;47.336;5.009;11|Quetigny;21800;47.315;5.106;10|Auxonne;21130;47.193;5.388;8|Montbard;21500;47.623;4.338;5`,
  '22': `Saint-Brieuc;22000;48.514;-2.765;44|Lannion;22300;48.732;-3.456;20|Lamballe-Armor;22400;48.469;-2.517;17|Plérin;22190;48.535;-2.770;15|Dinan;22100;48.455;-2.050;14|Loudéac;22600;48.178;-2.754;10|Guingamp;22200;48.563;-3.150;7|Paimpol;22500;48.778;-3.049;7`,
  '23': `Guéret;23000;46.171;1.871;13|La Souterraine;23300;46.238;1.487;5|Aubusson;23200;45.956;2.168;3`,
  '24': `Périgueux;24000;45.184;0.721;30|Bergerac;24100;44.853;0.483;27|Boulazac Isle Manoire;24750;45.177;0.766;11|Sarlat-la-Canéda;24200;44.890;1.217;9|Coulounieix-Chamiers;24660;45.170;0.693;8|Terrasson-Lavilledieu;24120;45.130;1.302;6`,
  '25': `Besançon;25000;47.238;6.024;119|Montbéliard;25200;47.510;6.799;25|Pontarlier;25300;46.904;6.355;17|Audincourt;25400;47.483;6.840;14|Valentigney;25700;47.462;6.833;11|Morteau;25500;47.057;6.607;7|Baume-les-Dames;25110;47.352;6.360;5`,
  '26': `Valence;26000;44.933;4.892;64|Montélimar;26200;44.558;4.751;40|Romans-sur-Isère;26100;45.044;5.052;33|Bourg-lès-Valence;26500;44.948;4.894;20|Pierrelatte;26700;44.377;4.696;13|Crest;26400;44.729;5.022;8|Nyons;26110;44.361;5.141;7|Die;26150;44.753;5.370;4`,
  '27': `Évreux;27000;49.024;1.151;47|Vernon;27200;49.093;1.485;24|Louviers;27400;49.215;1.165;18|Val-de-Reuil;27100;49.274;1.211;13|Gisors;27140;49.281;1.776;11|Bernay;27300;49.089;0.598;10|Pont-Audemer;27500;49.355;0.515;9|Les Andelys;27700;49.246;1.412;8`,
  '28': `Chartres;28000;48.446;1.489;38|Dreux;28100;48.737;1.366;30|Lucé;28110;48.438;1.465;15|Châteaudun;28200;48.071;1.338;13|Vernouillet;28500;48.721;1.364;12|Nogent-le-Rotrou;28400;48.322;0.822;9`,
  '29': `Brest;29200;48.390;-4.486;140|Quimper;29000;47.996;-4.102;63|Concarneau;29900;47.875;-3.919;20|Landerneau;29800;48.451;-4.250;16|Morlaix;29600;48.578;-3.828;15|Guipavas;29490;48.435;-4.399;15|Douarnenez;29100;48.093;-4.329;14|Plougastel-Daoulas;29470;48.373;-4.370;13|Quimperlé;29300;47.873;-3.548;12|Landivisiau;29400;48.510;-4.068;9|Carhaix-Plouguer;29270;48.276;-3.574;7`,
  '30': `Nîmes;30000,30900;43.837;4.360;149|Alès;30100;44.125;4.082;43|Bagnols-sur-Cèze;30200;44.162;4.620;18|Beaucaire;30300;43.808;4.644;16|Saint-Gilles;30800;43.678;4.432;14|Villeneuve-lès-Avignon;30400;43.966;4.796;12|Vauvert;30600;43.694;4.276;11|Le Grau-du-Roi;30240;43.538;4.137;8|Uzès;30700;44.012;4.420;8`,
  '31': `Toulouse;31000,31100,31200,31300,31400,31500;43.604;1.444;500|Colomiers;31770;43.611;1.335;40|Tournefeuille;31170;43.585;1.345;29|Muret;31600;43.461;1.326;26|Blagnac;31700;43.637;1.390;25|Plaisance-du-Touch;31830;43.566;1.297;20|Cugnaux;31270;43.537;1.344;19|Balma;31130;43.611;1.499;17|Ramonville-Saint-Agne;31520;43.546;1.475;14|Castanet-Tolosan;31320;43.516;1.499;14|L'Union;31240;43.659;1.484;12|Saint-Orens-de-Gameville;31650;43.551;1.534;12|Saint-Gaudens;31800;43.108;0.723;11|Revel;31250;43.458;2.004;10|Villefranche-de-Lauragais;31290;43.400;1.716;5`,
  '32': `Auch;32000;43.646;0.586;22|L'Isle-Jourdain;32600;43.614;1.082;9|Condom;32100;43.958;0.373;7|Fleurance;32500;43.848;0.663;6|Eauze;32800;43.861;0.101;4`,
  '33': `Bordeaux;33000,33100,33200,33300,33800;44.838;-0.579;260|Mérignac;33700;44.842;-0.646;72|Pessac;33600;44.806;-0.631;66|Talence;33400;44.808;-0.588;43|Villenave-d'Ornon;33140;44.778;-0.558;35|Saint-Médard-en-Jalles;33160;44.896;-0.724;32|Bègles;33130;44.808;-0.548;30|Gradignan;33170;44.772;-0.616;26|La Teste-de-Buch;33260;44.631;-1.146;26|Libourne;33500;44.915;-0.244;25|Cenon;33150;44.857;-0.533;25|Le Bouscat;33110;44.866;-0.600;24|Lormont;33310;44.879;-0.522;24|Eysines;33320;44.884;-0.650;24|Blanquefort;33290;44.913;-0.636;16|Andernos-les-Bains;33510;44.746;-1.102;12|Arcachon;33120;44.658;-1.168;11|Langon;33210;44.553;-0.249;8|Lesparre-Médoc;33340;45.307;-0.938;6`,
  '34': `Montpellier;34000,34070,34080,34090;43.611;3.877;300|Béziers;34500;43.344;3.216;79|Sète;34200;43.403;3.697;44|Agde;34300;43.311;3.476;29|Lunel;34400;43.676;4.136;26|Frontignan;34110;43.448;3.754;23|Castelnau-le-Lez;34170;43.633;3.904;21|Lattes;34970;43.567;3.907;17|Mauguio;34130;43.616;4.008;17|Saint-Jean-de-Védas;34430;43.575;3.828;11|Juvignac;34990;43.614;3.811;11|Clermont-l'Hérault;34800;43.627;3.432;9|Pézenas;34120;43.459;3.423;8|Lodève;34700;43.732;3.319;7`,
  '35': `Rennes;35000,35200,35700;48.111;-1.680;222|Saint-Malo;35400;48.649;-2.025;47|Fougères;35300;48.352;-1.199;20|Vitré;35500;48.124;-1.209;19|Bruz;35170;48.024;-1.746;19|Cesson-Sévigné;35510;48.121;-1.603;18|Saint-Jacques-de-la-Lande;35136;48.088;-1.720;14|Pacé;35740;48.148;-1.774;12|Betton;35830;48.182;-1.643;12|Chantepie;35135;48.089;-1.616;11|Dinard;35800;48.632;-2.062;10|Redon;35600;47.652;-2.084;9|Montfort-sur-Meu;35160;48.138;-1.957;7`,
  '36': `Châteauroux;36000;46.811;1.686;43|Issoudun;36100;46.948;1.993;12|Déols;36130;46.829;1.703;8|Le Blanc;36300;46.633;1.063;6|La Châtre;36400;46.582;1.988;4`,
  '37': `Tours;37000,37100,37200;47.394;0.685;137|Joué-lès-Tours;37300;47.352;0.663;38|Saint-Cyr-sur-Loire;37540;47.400;0.665;16|Saint-Pierre-des-Corps;37700;47.386;0.724;16|Saint-Avertin;37550;47.364;0.739;14|Amboise;37400;47.412;0.983;13|Chambray-lès-Tours;37170;47.335;0.715;12|Chinon;37500;47.167;0.242;8|Loches;37600;47.128;0.995;6`,
  '38': `Grenoble;38000,38100;45.188;5.724;158|Saint-Martin-d'Hères;38400;45.167;5.765;38|Échirolles;38130;45.146;5.718;37|Vienne;38200;45.525;4.874;30|Bourgoin-Jallieu;38300;45.586;5.274;29|Fontaine;38600;45.193;5.686;23|Voiron;38500;45.364;5.590;20|Villefontaine;38090;45.614;5.150;19|Meylan;38240;45.209;5.779;17|Saint-Égrève;38120;45.233;5.683;16|L'Isle-d'Abeau;38080;45.620;5.229;16|Seyssinet-Pariset;38170;45.178;5.689;12|Le Pont-de-Claix;38800;45.123;5.698;11|Voreppe;38340;45.295;5.637;10|La Tour-du-Pin;38110;45.566;5.444;8|Crolles;38920;45.285;5.885;8`,
  '39': `Dole;39100;47.092;5.490;24|Lons-le-Saunier;39000;46.675;5.554;17|Saint-Claude;39200;46.387;5.865;9|Champagnole;39300;46.746;5.909;8`,
  '40': `Mont-de-Marsan;40000;43.890;-0.500;30|Dax;40100;43.710;-1.054;21|Biscarrosse;40600;44.394;-1.164;14|Saint-Paul-lès-Dax;40990;43.726;-1.052;13|Tarnos;40220;43.540;-1.461;12|Capbreton;40130;43.643;-1.428;9|Mimizan;40200;44.201;-1.230;7|Aire-sur-l'Adour;40800;43.701;-0.263;6`,
  '41': `Blois;41000;47.586;1.336;45|Romorantin-Lanthenay;41200;47.358;1.741;17|Vendôme;41100;47.793;1.066;16|Vineuil;41350;47.583;1.375;8|Mer;41500;47.705;1.507;6`,
  '42': `Saint-Étienne;42000,42100;45.434;4.390;173|Saint-Chamond;42400;45.476;4.515;35|Roanne;42300;46.036;4.068;34|Firminy;42700;45.389;4.288;17|Montbrison;42600;45.608;4.065;16|Rive-de-Gier;42800;45.528;4.618;15|Saint-Just-Saint-Rambert;42170;45.500;4.241;15|Riorges;42153;46.043;4.042;11|Andrézieux-Bouthéon;42160;45.526;4.260;10|Feurs;42110;45.743;4.226;8`,
  '43': `Le Puy-en-Velay;43000;45.043;3.885;19|Monistrol-sur-Loire;43120;45.292;4.172;9|Yssingeaux;43200;45.143;4.124;7|Brioude;43100;45.294;3.384;7|Sainte-Sigolène;43600;45.243;4.235;6`,
  '44': `Nantes;44000,44100,44200,44300;47.218;-1.554;320|Saint-Nazaire;44600;47.274;-2.214;71|Saint-Herblain;44800;47.212;-1.650;47|Rezé;44400;47.181;-1.550;43|Saint-Sébastien-sur-Loire;44230;47.208;-1.502;28|Orvault;44700;47.271;-1.623;27|Vertou;44120;47.169;-1.469;25|Couëron;44220;47.214;-1.724;23|Carquefou;44470;47.297;-1.491;20|La Chapelle-sur-Erdre;44240;47.299;-1.551;20|Bouguenais;44340;47.178;-1.621;20|Sainte-Luce-sur-Loire;44980;47.251;-1.484;16|La Baule-Escoublac;44500;47.287;-2.391;16|Guérande;44350;47.329;-2.429;16|Pornic;44210;47.115;-2.103;16|Châteaubriant;44110;47.717;-1.376;12|Ancenis-Saint-Géréon;44150;47.366;-1.177;11|Clisson;44190;47.087;-1.282;7`,
  '45': `Orléans;45000,45100;47.903;1.909;116|Olivet;45160;47.863;1.900;22|Fleury-les-Aubrais;45400;47.933;1.917;21|Saint-Jean-de-Braye;45800;47.913;1.973;21|Saint-Jean-de-la-Ruelle;45140;47.911;1.866;16|Saran;45770;47.950;1.877;16|Montargis;45200;47.998;2.733;14|Gien;45500;47.688;2.631;14|Pithiviers;45300;48.172;2.252;9`,
  '46': `Cahors;46000;44.448;1.441;19|Figeac;46100;44.609;2.032;10|Gourdon;46300;44.737;1.383;4|Souillac;46200;44.897;1.477;3`,
  '47': `Agen;47000;44.203;0.616;32|Villeneuve-sur-Lot;47300;44.408;0.705;22|Marmande;47200;44.500;0.165;18|Le Passage;47520;44.200;0.603;9|Tonneins;47400;44.391;0.309;9|Nérac;47600;44.136;0.339;7`,
  '48': `Mende;48000;44.518;3.501;12|Marvejols;48100;44.554;3.291;5|Saint-Chély-d'Apcher;48200;44.802;3.275;4|Langogne;48300;44.727;3.855;3`,
  '49': `Angers;49000,49100;47.474;-0.552;155|Cholet;49300;47.060;-0.879;54|Saumur;49400;47.260;-0.077;26|Beaupréau-en-Mauges;49600;47.204;-0.988;23|Chemillé-en-Anjou;49120;47.214;-0.731;21|Segré-en-Anjou Bleu;49500;47.686;-0.872;17|Trélazé;49800;47.446;-0.466;15|Avrillé;49240;47.506;-0.588;14|Les Ponts-de-Cé;49130;47.424;-0.524;13|Saint-Barthélemy-d'Anjou;49124;47.468;-0.495;9`,
  '50': `Cherbourg-en-Cotentin;50100;49.640;-1.616;78|Saint-Lô;50000;49.116;-1.090;19|Granville;50400;48.838;-1.597;12|Avranches;50300;48.685;-1.357;10|Coutances;50200;49.047;-1.445;9|Valognes;50700;49.509;-1.470;6`,
  '51': `Reims;51100;49.258;4.032;180|Châlons-en-Champagne;51000;48.957;4.363;45|Épernay;51200;49.044;3.954;22|Vitry-le-François;51300;48.725;4.585;12|Tinqueux;51430;49.250;3.991;10|Bétheny;51450;49.287;4.054;7|Sézanne;51120;48.721;3.724;5`,
  '52': `Saint-Dizier;52100;48.638;4.950;23|Chaumont;52000;48.111;5.139;22|Langres;52200;47.862;5.333;8|Joinville;52300;48.444;5.141;3`,
  '53': `Laval;53000;48.073;-0.770;50|Château-Gontier-sur-Mayenne;53200;47.829;-0.703;16|Mayenne;53100;48.303;-0.614;13|Évron;53600;48.157;-0.405;8|Ernée;53500;48.297;-0.932;6`,
  '54': `Nancy;54000,54100;48.692;6.184;104|Vandœuvre-lès-Nancy;54500;48.656;6.170;30|Lunéville;54300;48.590;6.496;18|Toul;54200;48.675;5.891;16|Laxou;54520;48.685;6.150;15|Pont-à-Mousson;54700;48.903;6.054;15|Longwy;54400;49.519;5.766;15|Villers-lès-Nancy;54600;48.674;6.153;14|Jarny;54800;49.159;5.876;8|Malzéville;54220;48.712;6.186;8`,
  '55': `Verdun;55100;49.160;5.384;17|Bar-le-Duc;55000;48.773;5.161;15|Commercy;55200;48.763;5.592;5|Saint-Mihiel;55300;48.888;5.542;4`,
  '56': `Lorient;56100;47.748;-3.367;57|Vannes;56000;47.658;-2.760;54|Lanester;56600;47.762;-3.341;23|Ploemeur;56270;47.734;-3.428;18|Hennebont;56700;47.805;-3.277;16|Pontivy;56300;48.067;-2.963;15|Auray;56400;47.668;-2.982;14|Ploërmel;56800;47.932;-2.397;10|Séné;56860;47.620;-2.735;9|Questembert;56230;47.660;-2.453;8`,
  '57': `Metz;57000,57050,57070;49.119;6.176;120|Thionville;57100;49.358;6.168;41|Montigny-lès-Metz;57950;49.098;6.151;22|Forbach;57600;49.189;6.896;21|Sarreguemines;57200;49.110;7.068;21|Yutz;57970;49.357;6.188;17|Hayange;57700;49.329;6.062;16|Saint-Avold;57500;49.104;6.707;15|Woippy;57140;49.151;6.152;14|Creutzwald;57150;49.205;6.696;13|Fameck;57290;49.299;6.110;13|Sarrebourg;57400;48.735;7.054;12`,
  '58': `Nevers;58000;46.990;3.159;33|Cosne-Cours-sur-Loire;58200;47.411;2.926;10|Varennes-Vauzelles;58640;47.020;3.142;9|Decize;58300;46.828;3.462;5|Clamecy;58500;47.460;3.520;4`,
  '59': `Lille;59000,59160,59260,59800;50.629;3.057;236|Roubaix;59100;50.692;3.177;99|Tourcoing;59200;50.722;3.161;98|Dunkerque;59140,59240,59640;51.034;2.377;87|Villeneuve-d'Ascq;59650,59491;50.623;3.145;62|Valenciennes;59300;50.358;3.523;43|Douai;59500;50.371;3.080;40|Wattrelos;59150;50.701;3.217;40|Marcq-en-Barœul;59700;50.672;3.096;39|Cambrai;59400;50.176;3.235;32|Maubeuge;59600;50.278;3.973;29|Lambersart;59130;50.650;3.025;28|Armentières;59280;50.687;2.881;25|Loos;59120;50.611;3.016;22|Croix;59170;50.678;3.150;21|Hazebrouck;59190;50.725;2.539;21|Halluin;59250;50.784;3.127;21|Denain;59220;50.329;3.395;20|Grande-Synthe;59760;51.013;2.303;20|Hem;59510;50.655;3.189;19|Saint-Amand-les-Eaux;59230;50.448;3.428;16|Bailleul;59270;50.739;2.735;15|Wattignies;59139;50.586;3.044;14|Caudry;59540;50.125;3.413;14|Anzin;59410;50.372;3.505;13|Seclin;59113;50.549;3.030;12|Le Cateau-Cambrésis;59360;50.104;3.543;7`,
  '60': `Beauvais;60000;49.430;2.081;56|Compiègne;60200;49.418;2.826;41|Creil;60100;49.260;2.475;36|Nogent-sur-Oise;60180;49.272;2.468;20|Senlis;60300;49.207;2.587;15|Crépy-en-Valois;60800;49.234;2.890;15|Méru;60110;49.237;2.135;15|Noyon;60400;49.581;3.000;13|Pont-Sainte-Maxence;60700;49.302;2.604;12|Chantilly;60500;49.194;2.471;11|Clermont;60600;49.379;2.413;10`,
  '61': `Alençon;61000;48.431;0.092;26|Flers;61100;48.749;-0.570;15|Argentan;61200;48.744;-0.020;13|L'Aigle;61300;48.765;0.628;8|Mortagne-au-Perche;61400;48.520;0.547;4`,
  '62': `Calais;62100;50.951;1.858;67|Arras;62000;50.291;2.777;41|Boulogne-sur-Mer;62200;50.726;1.614;40|Lens;62300;50.432;2.833;31|Liévin;62800;50.421;2.778;30|Hénin-Beaumont;62110;50.418;2.951;26|Béthune;62400;50.530;2.641;25|Bruay-la-Buissière;62700;50.483;2.551;21|Avion;62210;50.410;2.834;18|Carvin;62220;50.493;2.958;17|Saint-Omer;62500;50.750;2.252;14|Berck;62600;50.408;1.592;14|Outreau;62230;50.705;1.594;14|Étaples;62630;50.513;1.640;11|Arques;62510;50.735;2.302;10|Le Touquet-Paris-Plage;62520;50.524;1.585;4`,
  '63': `Clermont-Ferrand;63000,63100;45.778;3.087;147|Cournon-d'Auvergne;63800;45.736;3.197;20|Riom;63200;45.894;3.113;19|Chamalières;63400;45.774;3.066;17|Issoire;63500;45.544;3.249;15|Thiers;63300;45.856;3.548;11|Beaumont;63110;45.751;3.083;11|Aubière;63170;45.751;3.111;10|Lempdes;63370;45.770;3.194;9|Ambert;63600;45.550;3.742;7`,
  '64': `Pau;64000;43.296;-0.370;76|Bayonne;64100;43.493;-1.475;52|Anglet;64600;43.484;-1.519;40|Biarritz;64200;43.483;-1.559;25|Hendaye;64700;43.359;-1.774;17|Saint-Jean-de-Luz;64500;43.388;-1.663;14|Lons;64140;43.317;-0.410;13|Billère;64140;43.304;-0.396;13|Oloron-Sainte-Marie;64400;43.194;-0.607;11|Orthez;64300;43.488;-0.773;10|Mourenx;64150;43.381;-0.627;6`,
  '65': `Tarbes;65000;43.233;0.078;43|Lourdes;65100;43.095;-0.046;13|Bagnères-de-Bigorre;65200;43.065;0.149;7|Lannemezan;65300;43.125;0.385;6|Séméac;65600;43.229;0.106;5`,
  '66': `Perpignan;66000,66100;42.699;2.895;121|Canet-en-Roussillon;66140;42.706;3.008;13|Saint-Estève;66240;42.713;2.844;12|Argelès-sur-Mer;66700;42.546;3.024;10|Rivesaltes;66600;42.769;2.873;9|Céret;66400;42.485;2.748;8|Thuir;66300;42.633;2.756;7|Prades;66500;42.617;2.422;6`,
  '67': `Strasbourg;67000,67100,67200;48.573;7.752;290|Haguenau;67500;48.816;7.789;35|Schiltigheim;67300;48.607;7.750;34|Illkirch-Graffenstaden;67400;48.530;7.715;27|Sélestat;67600;48.259;7.454;19|Lingolsheim;67380;48.557;7.684;19|Bischheim;67800;48.614;7.753;17|Bischwiller;67240;48.766;7.858;12|Saverne;67700;48.741;7.362;11|Obernai;67210;48.462;7.481;11|Erstein;67150;48.422;7.662;11|Molsheim;67120;48.542;7.492;10|Wissembourg;67160;49.037;7.946;7`,
  '68': `Mulhouse;68100,68200;47.750;7.336;106|Colmar;68000;48.079;7.358;68|Saint-Louis;68300;47.590;7.560;22|Illzach;68110;47.783;7.347;15|Wittenheim;68270;47.808;7.337;15|Rixheim;68170;47.749;7.405;14|Kingersheim;68260;47.791;7.326;13|Riedisheim;68400;47.749;7.367;12|Guebwiller;68500;47.909;7.211;11|Cernay;68700;47.806;7.175;11|Thann;68800;47.807;7.104;8|Altkirch;68130;47.624;7.240;6`,
  '69': `Lyon;69008,69003,69007,69009,69005,69004,69006,69002,69001;45.764;4.836;520|Villeurbanne;69100;45.767;4.880;152|Vénissieux;69200;45.698;4.887;67|Vaulx-en-Velin;69120;45.778;4.920;52|Saint-Priest;69800;45.696;4.944;48|Caluire-et-Cuire;69300;45.795;4.846;43|Bron;69500;45.739;4.913;42|Villefranche-sur-Saône;69400;45.990;4.719;37|Meyzieu;69330;45.767;5.004;34|Rillieux-la-Pape;69140;45.821;4.898;31|Oullins-Pierre-Bénite;69600;45.714;4.808;37|Décines-Charpieu;69150;45.769;4.959;28|Sainte-Foy-lès-Lyon;69110;45.734;4.795;22|Tassin-la-Demi-Lune;69160;45.764;4.780;22|Saint-Genis-Laval;69230;45.696;4.793;21|Givors;69700;45.590;4.769;20|Écully;69130;45.774;4.778;18|Francheville;69340;45.736;4.763;15|Mions;69780;45.664;4.955;14|Genas;69740;45.731;5.002;13|Brignais;69530;45.674;4.754;12|Tarare;69170;45.896;4.433;10`,
  '70': `Vesoul;70000;47.623;6.155;15|Héricourt;70400;47.578;6.761;11|Lure;70200;47.684;6.497;8|Luxeuil-les-Bains;70300;47.817;6.381;7|Gray;70100;47.445;5.591;5`,
  '71': `Chalon-sur-Saône;71100;46.780;4.854;45|Mâcon;71000;46.307;4.832;34|Le Creusot;71200;46.801;4.434;21|Montceau-les-Mines;71300;46.668;4.369;18|Autun;71400;46.951;4.299;13|Paray-le-Monial;71600;46.451;4.120;9|Digoin;71160;46.481;3.980;8|Louhans;71500;46.627;5.226;6`,
  '72': `Le Mans;72000,72100;48.006;0.199;145|La Flèche;72200;47.698;-0.076;15|Sablé-sur-Sarthe;72300;47.840;-0.333;12|Allonnes;72700;47.968;0.159;11|La Ferté-Bernard;72400;48.187;0.653;9|Coulaines;72190;48.026;0.205;8|Mamers;72600;48.349;0.369;5`,
  '73': `Chambéry;73000;45.564;5.918;60|Aix-les-Bains;73100;45.689;5.909;32|Albertville;73200;45.676;6.392;19|La Motte-Servolex;73290;45.597;5.877;12|Saint-Jean-de-Maurienne;73300;45.276;6.346;8|La Ravoire;73490;45.562;5.966;8|Bourg-Saint-Maurice;73700;45.618;6.769;7|Moûtiers;73600;45.484;6.531;4`,
  '74': `Annecy;74000,74370,74600,74940,74960;45.899;6.129;130|Annemasse;74100;46.193;6.234;36|Thonon-les-Bains;74200;46.371;6.479;35|Cluses;74300;46.061;6.580;17|Sallanches;74700;45.936;6.632;16|Rumilly;74150;45.866;5.944;16|Saint-Julien-en-Genevois;74160;46.144;6.081;15|Bonneville;74130;46.078;6.401;12|Passy;74190;45.923;6.689;11|La Roche-sur-Foron;74800;46.067;6.311;11|Évian-les-Bains;74500;46.401;6.590;9|Reignier-Ésery;74930;46.133;6.269;8`,
  '75': `Paris 15e;75015;48.8401;2.2930;227|Paris 20e;75020;48.8634;2.4012;189|Paris 18e;75018;48.8925;2.3484;190|Paris 19e;75019;48.8871;2.3848;182|Paris 13e;75013;48.8283;2.3623;178|Paris 16e;75016;48.8604;2.2720;162|Paris 17e;75017;48.8873;2.3067;160|Paris 11e;75011;48.8591;2.3800;142|Paris 12e;75012;48.8400;2.3880;139|Paris 14e;75014;48.8292;2.3266;134|Paris 10e;75010;48.8761;2.3608;83|Paris 9e;75009;48.8771;2.3375;59|Paris 5e;75005;48.8444;2.3507;57|Paris 7e;75007;48.8561;2.3122;49|Paris 6e;75006;48.8491;2.3328;40|Paris 8e;75008;48.8727;2.3125;35|Paris 3e;75003;48.8630;2.3601;33|Paris 4e;75004;48.8543;2.3576;28|Paris 2e;75002;48.8683;2.3428;21|Paris 1er;75001;48.8625;2.3364;16`,
  '76': `Le Havre;76600,76610,76620;49.494;0.108;167|Rouen;76000,76100;49.443;1.099;114|Sotteville-lès-Rouen;76300;49.410;1.090;29|Saint-Étienne-du-Rouvray;76800;49.379;1.105;29|Dieppe;76200;49.923;1.078;28|Le Grand-Quevilly;76120;49.409;1.042;26|Le Petit-Quevilly;76140;49.425;1.061;22|Mont-Saint-Aignan;76130;49.463;1.087;19|Fécamp;76400;49.757;0.375;18|Elbeuf;76500;49.287;1.008;16|Montivilliers;76290;49.545;0.188;15|Canteleu;76380;49.441;1.026;14|Barentin;76360;49.546;0.955;12|Bolbec;76210;49.573;0.473;11|Yvetot;76190;49.617;0.754;11|Eu;76260;50.047;1.420;7`,
  '77': `Meaux;77100;48.960;2.879;56|Chelles;77500;48.880;2.594;55|Melun;77000;48.539;2.661;41|Pontault-Combault;77340;48.801;2.607;38|Savigny-le-Temple;77176;48.574;2.583;30|Bussy-Saint-Georges;77600;48.841;2.703;28|Villeparisis;77270;48.942;2.614;27|Champs-sur-Marne;77420;48.853;2.603;25|Torcy;77200;48.850;2.651;23|Roissy-en-Brie;77680;48.791;2.648;23|Lagny-sur-Marne;77400;48.873;2.707;22|Combs-la-Ville;77380;48.664;2.564;22|Dammarie-les-Lys;77190;48.515;2.640;22|Le Mée-sur-Seine;77350;48.531;2.629;21|Montereau-Fault-Yonne;77130;48.385;2.951;20|Ozoir-la-Ferrière;77330;48.762;2.672;20|Mitry-Mory;77290;48.983;2.616;20|Fontainebleau;77300;48.405;2.701;15|Noisiel;77186;48.849;2.621;15|Coulommiers;77120;48.814;3.083;15|Nemours;77140;48.267;2.697;13|Provins;77160;48.560;3.299;12|Vaux-le-Pénil;77000;48.528;2.680;11`,
  '78': `Versailles;78000;48.801;2.130;84|Sartrouville;78500;48.937;2.164;52|Saint-Germain-en-Laye;78100;48.899;2.094;45|Mantes-la-Jolie;78200;48.991;1.717;44|Poissy;78300;48.929;2.046;38|Conflans-Sainte-Honorine;78700;48.999;2.096;36|Montigny-le-Bretonneux;78180;48.771;2.034;33|Les Mureaux;78130;48.991;1.910;33|Houilles;78800;48.926;2.189;32|Trappes;78190;48.775;2.003;32|Plaisir;78370;48.823;1.948;31|Chatou;78400;48.890;2.157;31|Guyancourt;78280;48.773;2.074;30|Le Chesnay-Rocquencourt;78150;48.822;2.123;30|Rambouillet;78120;48.645;1.830;26|Élancourt;78990;48.784;1.957;25|Maisons-Laffitte;78600;48.947;2.146;23|Vélizy-Villacoublay;78140;48.783;2.192;21|Le Vésinet;78110;48.892;2.130;16|Voisins-le-Bretonneux;78960;48.758;2.051;11`,
  '79': `Niort;79000;46.323;-0.465;59|Bressuire;79300;46.840;-0.488;20|Thouars;79100;46.976;-0.215;14|Parthenay;79200;46.649;-0.247;10|Chauray;79180;46.360;-0.379;7|Melle;79500;46.222;-0.142;6`,
  '80': `Amiens;80000,80080,80090;49.894;2.296;134|Abbeville;80100;50.106;1.834;23|Albert;80300;50.002;2.652;10|Péronne;80200;49.932;2.936;8|Montdidier;80500;49.648;2.570;6|Doullens;80600;50.157;2.341;6|Longueau;80330;49.872;2.358;5`,
  '81': `Albi;81000;43.929;2.148;49|Castres;81100;43.606;2.241;42|Gaillac;81600;43.901;1.897;15|Graulhet;81300;43.761;1.989;12|Lavaur;81500;43.699;1.819;11|Mazamet;81200;43.492;2.374;10|Carmaux;81400;44.050;2.159;9`,
  '82': `Montauban;82000;44.018;1.355;61|Castelsarrasin;82100;44.040;1.107;14|Moissac;82200;44.105;1.085;13|Caussade;82300;44.161;1.538;7`,
  '83': `Toulon;83000,83100,83200;43.124;5.928;180|La Seyne-sur-Mer;83500;43.101;5.879;63|Hyères;83400;43.120;6.130;55|Fréjus;83600;43.433;6.737;54|Draguignan;83300;43.537;6.465;40|Saint-Raphaël;83700;43.425;6.768;36|Six-Fours-les-Plages;83140;43.094;5.839;34|La Garde;83130;43.124;6.011;25|La Valette-du-Var;83160;43.138;5.983;24|Brignoles;83170;43.406;6.062;17|Saint-Maximin-la-Sainte-Baume;83470;43.453;5.862;17|Sanary-sur-Mer;83110;43.119;5.801;16|Sainte-Maxime;83120;43.309;6.635;14|Ollioules;83190;43.140;5.848;14|Le Pradet;83220;43.106;6.023;11`,
  '84': `Avignon;84000;43.949;4.806;91|Carpentras;84200;44.055;5.048;29|Orange;84100;44.138;4.808;29|Cavaillon;84300;43.837;5.038;26|Pertuis;84120;43.694;5.502;20|L'Isle-sur-la-Sorgue;84800;43.919;5.051;19|Sorgues;84700;44.008;4.873;19|Le Pontet;84130;43.962;4.860;17|Bollène;84500;44.281;4.749;13|Apt;84400;43.876;5.396;12`,
  '85': `La Roche-sur-Yon;85000;46.670;-1.426;55|Les Sables-d'Olonne;85100;46.497;-1.783;48|Challans;85300;46.846;-1.878;22|Montaigu-Vendée;85600;46.974;-1.309;21|Les Herbiers;85500;46.871;-1.014;16|Fontenay-le-Comte;85200;46.466;-0.806;13|Saint-Hilaire-de-Riez;85270;46.721;-1.945;12|Luçon;85400;46.455;-1.165;9|Aizenay;85190;46.740;-1.608;9|Pouzauges;85700;46.781;-0.838;5`,
  '86': `Poitiers;86000;46.580;0.340;89|Châtellerault;86100;46.817;0.546;31|Buxerolles;86180;46.602;0.373;10|Chauvigny;86300;46.568;0.646;7|Loudun;86200;47.010;0.083;7|Saint-Benoît;86280;46.554;0.341;7|Montmorillon;86500;46.427;0.871;6`,
  '87': `Limoges;87000,87100,87280;45.834;1.261;130|Saint-Junien;87200;45.888;0.902;11|Panazol;87350;45.840;1.311;11|Couzeix;87270;45.875;1.239;9|Isle;87170;45.802;1.213;8|Saint-Yrieix-la-Perche;87500;45.516;1.205;7`,
  '88': `Épinal;88000;48.173;6.451;31|Saint-Dié-des-Vosges;88100;48.285;6.950;19|Gérardmer;88400;48.073;6.877;8|Golbey;88190;48.196;6.437;8|Remiremont;88200;48.017;6.590;7|Neufchâteau;88300;48.355;5.696;6`,
  '89': `Auxerre;89000;47.798;3.567;34|Sens;89100;48.198;3.283;26|Joigny;89300;47.983;3.398;9|Migennes;89400;47.966;3.518;7|Avallon;89200;47.490;3.908;6|Tonnerre;89700;47.856;3.974;5`,
  '90': `Belfort;90000;47.638;6.863;46|Delle;90100;47.508;6.999;5|Valdoie;90300;47.668;6.843;5|Bavilliers;90800;47.623;6.831;5`,
  '91': `Évry-Courcouronnes;91000,91080;48.629;2.441;67|Corbeil-Essonnes;91100;48.613;2.482;52|Massy;91300;48.731;2.271;52|Savigny-sur-Orge;91600;48.679;2.348;37|Sainte-Geneviève-des-Bois;91700;48.645;2.326;36|Palaiseau;91120;48.714;2.246;35|Athis-Mons;91200;48.709;2.391;34|Viry-Châtillon;91170;48.672;2.375;31|Draveil;91210;48.685;2.408;29|Grigny;91350;48.654;2.393;29|Ris-Orangis;91130;48.653;2.416;29|Yerres;91330;48.718;2.494;29|Brétigny-sur-Orge;91220;48.611;2.306;27|Brunoy;91800;48.698;2.505;26|Les Ulis;91940;48.682;2.169;25|Étampes;91150;48.435;2.162;25|Montgeron;91230;48.705;2.459;24|Gif-sur-Yvette;91190;48.701;2.134;21|Orsay;91400;48.698;2.187;16|Mennecy;91540;48.567;2.436;14`,
  '92': `Boulogne-Billancourt;92100;48.835;2.240;120|Nanterre;92000;48.892;2.207;96|Asnières-sur-Seine;92600;48.911;2.285;87|Colombes;92700;48.923;2.252;86|Courbevoie;92400;48.897;2.256;82|Rueil-Malmaison;92500;48.877;2.180;79|Issy-les-Moulineaux;92130;48.824;2.270;69|Levallois-Perret;92300;48.894;2.288;66|Antony;92160;48.754;2.297;63|Clichy;92110;48.904;2.306;63|Neuilly-sur-Seine;92200;48.885;2.266;60|Clamart;92140;48.800;2.266;53|Montrouge;92120;48.818;2.316;50|Suresnes;92150;48.871;2.226;49|Gennevilliers;92230;48.932;2.293;48|Meudon;92190;48.813;2.236;46|Puteaux;92800;48.884;2.239;45|Bagneux;92220;48.796;2.309;41|Châtillon;92320;48.802;2.290;38|Châtenay-Malabry;92290;48.765;2.278;34|Le Plessis-Robinson;92350;48.781;2.263;30|Saint-Cloud;92210;48.844;2.219;30|Fontenay-aux-Roses;92260;48.791;2.287;24|Sèvres;92310;48.822;2.211;23|Sceaux;92330;48.778;2.290;20|Bourg-la-Reine;92340;48.780;2.316;20|Garches;92380;48.846;2.188;18`,
  '93': `Saint-Denis;93200,93210;48.936;2.357;113|Montreuil;93100;48.861;2.443;111|Aubervilliers;93300;48.914;2.383;88|Aulnay-sous-Bois;93600;48.934;2.497;86|Drancy;93700;48.923;2.445;72|Noisy-le-Grand;93160;48.849;2.553;69|Pantin;93500;48.894;2.409;60|Le Blanc-Mesnil;93150;48.938;2.462;57|Épinay-sur-Seine;93800;48.955;2.309;55|Bobigny;93000;48.908;2.439;55|Bondy;93140;48.902;2.483;54|Sevran;93270;48.938;2.527;51|Saint-Ouen-sur-Seine;93400;48.912;2.334;51|Rosny-sous-Bois;93110;48.873;2.486;46|Livry-Gargan;93190;48.919;2.535;46|La Courneuve;93120;48.928;2.396;45|Noisy-le-Sec;93130;48.891;2.459;44|Gagny;93220;48.884;2.534;40|Stains;93240;48.950;2.383;39|Villepinte;93420;48.962;2.533;37|Tremblay-en-France;93290;48.950;2.568;36|Bagnolet;93170;48.869;2.418;36|Neuilly-sur-Marne;93330;48.863;2.530;35|Villemomble;93250;48.884;2.509;30|Romainville;93230;48.885;2.435;29|Montfermeil;93370;48.898;2.567;27|Le Raincy;93340;48.899;2.523;14`,
  '94': `Vitry-sur-Seine;94400;48.787;2.393;95|Créteil;94000;48.790;2.455;92|Champigny-sur-Marne;94500;48.817;2.515;78|Saint-Maur-des-Fossés;94100,94210;48.799;2.493;75|Ivry-sur-Seine;94200;48.813;2.384;64|Maisons-Alfort;94700;48.806;2.437;56|Villejuif;94800;48.792;2.363;55|Fontenay-sous-Bois;94120;48.851;2.477;53|Vincennes;94300;48.848;2.438;50|Choisy-le-Roi;94600;48.763;2.409;46|Alfortville;94140;48.805;2.420;44|Le Perreux-sur-Marne;94170;48.842;2.503;34|Nogent-sur-Marne;94130;48.837;2.483;33|L'Haÿ-les-Roses;94240;48.780;2.338;31|Cachan;94230;48.791;2.335;31|Charenton-le-Pont;94220;48.822;2.413;30|Thiais;94320;48.765;2.392;29|Villiers-sur-Marne;94350;48.827;2.545;29|Sucy-en-Brie;94370;48.770;2.522;27|Orly;94310;48.744;2.394;24|Boissy-Saint-Léger;94470;48.751;2.511;17`,
  '95': `Argenteuil;95100;48.947;2.249;111|Cergy;95000,95800;49.036;2.076;66|Sarcelles;95200;48.997;2.380;58|Garges-lès-Gonesse;95140;48.973;2.400;43|Franconville;95130;48.989;2.230;37|Goussainville;95190;49.032;2.465;32|Pontoise;95000,95300;49.051;2.101;32|Bezons;95870;48.926;2.218;31|Herblay-sur-Seine;95220;48.990;2.165;30|Ermont;95120;48.990;2.258;29|Villiers-le-Bel;95400;49.009;2.391;28|Gonesse;95500;48.987;2.449;26|Taverny;95150;49.026;2.222;26|Sannois;95110;48.972;2.258;26|Eaubonne;95600;48.992;2.278;25|Cormeilles-en-Parisis;95240;48.971;2.201;25|Saint-Ouen-l'Aumône;95310;49.044;2.112;24|Deuil-la-Barre;95170;48.976;2.327;22|Montmorency;95160;48.990;2.322;21|L'Isle-Adam;95290;49.111;2.222;12`,
  '971': `Les Abymes;97139;16.271;-61.505;53|Baie-Mahault;97122;16.267;-61.586;31|Le Gosier;97190;16.206;-61.493;27|Petit-Bourg;97170;16.191;-61.591;25|Sainte-Anne;97180;16.226;-61.380;24|Le Moule;97160;16.333;-61.344;22|Capesterre-Belle-Eau;97130;16.044;-61.567;18|Sainte-Rose;97115;16.332;-61.698;18|Lamentin;97129;16.270;-61.632;16|Pointe-à-Pitre;97110;16.241;-61.533;15|Saint-François;97118;16.253;-61.274;12|Basse-Terre;97100;15.998;-61.726;10`,
  '972': `Fort-de-France;97200;14.616;-61.059;76|Le Lamentin;97232;14.613;-60.999;39|Le Robert;97231;14.678;-60.940;22|Schœlcher;97233;14.614;-61.091;20|Ducos;97224;14.575;-60.975;17|Sainte-Marie;97230;14.783;-60.990;16|Le François;97240;14.616;-60.903;16|Saint-Joseph;97212;14.669;-61.040;16|Rivière-Pilote;97211;14.484;-60.900;12|La Trinité;97220;14.738;-60.963;12|Le Marin;97290;14.469;-60.869;8`,
  '973': `Cayenne;97300;4.938;-52.326;63|Saint-Laurent-du-Maroni;97320;5.498;-54.033;48|Matoury;97351;4.847;-52.331;33|Rémire-Montjoly;97354;4.917;-52.268;26|Kourou;97310;5.160;-52.650;25|Macouria;97355;5.004;-52.444;14`,
  '974': `Saint-Denis;97400;-20.882;55.451;155|Saint-Paul;97460;-21.010;55.270;105|Saint-Pierre;97410;-21.339;55.478;85|Le Tampon;97430;-21.278;55.518;80|Saint-André;97440;-20.963;55.650;57|Saint-Louis;97450;-21.286;55.411;53|Saint-Benoît;97470;-21.034;55.713;38|Saint-Joseph;97480;-21.378;55.619;38|Sainte-Marie;97438;-20.897;55.549;34|La Possession;97419;-20.926;55.336;34|Saint-Leu;97436;-21.170;55.288;34|Le Port;97420;-20.937;55.293;33|Sainte-Suzanne;97441;-20.906;55.609;24|L'Étang-Salé;97427;-21.267;55.367;14|Bras-Panon;97412;-21.001;55.677;13`,
  '976': `Mamoudzou;97600;-12.781;45.228;72|Koungou;97690;-12.733;45.204;32|Dzaoudzi;97615;-12.787;45.282;17|Dembéni;97660;-12.840;45.170;15|Sada;97640;-12.848;45.104;11`,
  '988': `Nouméa;98800;-22.276;166.458;94|Dumbéa;98835;-22.150;166.443;35|Le Mont-Dore;98809;-22.263;166.570;27|Païta;98890;-22.133;166.358;24|Koné;98860;-21.057;164.866;8|Bourail;98870;-21.567;165.483;6`,
}

export interface Town {
  dept: string
  name: string
  /** Ville affichée (« Paris » pour « Paris 15e »). */
  city: string
  postal: string[]
  lat: number
  lng: number
  pop: number
}

export const TOWN_LIST: Town[] = Object.entries(TOWNS).flatMap(([dept, s]) =>
  s.split('|').map((t) => {
    const [name, cps, lat, lng, pop] = t.split(';')
    return { dept, name, city: name.replace(/ \d+(er|e)$/, ''), postal: cps.split(','), lat: Number(lat), lng: Number(lng), pop: Number(pop) }
  }),
)

// ---------- Noms (prénoms et noms courants, mélangés au hasard : aucune personne réelle) ----------

export const FIRST_F = `Emma Léa Chloé Manon Inès Camille Sarah Jade Lola Louise Zoé Lilou Clara Lucie Juliette Anaïs Maëlys Ambre Lina Eva Romane Léna
Alice Mathilde Margaux Louna Mila Rose Agathe Charlotte Pauline Marie Julie Océane Laura Nina Elsa Salomé Justine Noémie Clémence Maëva Lisa
Célia Héloïse Capucine Apolline Elena Lou Léonie Victoire Alicia Mélissa Lana Emy Maya Yasmine Aya Maïa Coline Valentine Constance Lise Margot
Gabrielle Albane Énora Nolwenn Axelle Oriane Marine Morgane Solène Elisa Anna Jeanne Adèle Iris Lily Alix Garance Candice Faustine Cassandre
Naomi Kenza Chiara Thaïs Méline Lyna Shana Nora Eléa Louane Mélina Sofia Amandine Estelle Tiphaine`.split(/\s+/)
export const FIRST_M = `Lucas Hugo Nathan Enzo Théo Mathis Louis Gabriel Jules Ethan Noah Tom Maël Clément Raphaël Arthur Paul Thomas Baptiste Maxime
Alexandre Antoine Valentin Mathéo Timéo Evan Nolan Sacha Adam Rayan Yanis Axel Léo Victor Romain Quentin Matteo Ewen Lenny Noa Aaron Mohamed
Ilyes Liam Malo Gabin Esteban Léon Martin Simon Samuel Benjamin Robin Corentin Florian Adrien Kylian Mathias Loïc Bastien Dylan Alexis Titouan
Elouan Erwan Lorenzo Marius Gaspard Côme Augustin Félix Isaac Nathanaël Tristan Jordan Hamza Ismaël Ryan Bilal Amir Elias Noam Thibault Pierre
Antonin Kenzo Swann Aurélien Nicolas Lilian Killian Tanguy Mattéo Jonathan Damien`.split(/\s+/)
const LAST = `Martin Bernard Thomas Petit Robert Richard Durand Dubois Moreau Laurent Simon Michel Lefebvre Leroy Roux David Bertrand Morel Fournier
Girard Bonnet Dupont Lambert Fontaine Rousseau Vincent Muller Lefèvre Faure André Mercier Blanc Guérin Boyer Garnier Chevalier François Legrand
Gauthier Garcia Perrin Robin Clément Morin Nicolas Henry Roussel Mathieu Gautier Masson Marchand Duval Denis Dumont Marie Lemaire Noël Meyer
Dufour Meunier Brun Blanchard Giraud Joly Rivière Lucas Brunet Gaillard Barbier Arnaud Martinez Gérard Roche Renard Schmitt Roy Leroux Colin
Vidal Caron Picard Roger Fabre Aubert Lemoine Renaud Dumas Lacroix Olivier Philippe Bourgeois Pierre Benoît Rey Leclerc Payet Rolland Leclercq
Guillaume Lecomte Lopez Jean Dupuy Guillot Hubert Berger Carpentier Sanchez Dupuis Moulin Louis Deschamps Huet Vasseur Perez Boucher Fleury
Royer Klein Jacquet Adam Paris Poirier Marty Aubry Guyot Carré Charles Renault Charpentier Ménard Maillard Baron Bertin Bailly Hervé Schneider
Fernandez Collet Léger Bouvier Julien Prévost Millet Perrot Daniel Cousin Germain Breton Besson Langlois Rémy Pelletier Lévêque Perrier
Leblanc Barré Lebrun Marchal Weber Mallet Hamon Boulanger Jacob Monnier Michaud Rodriguez Guichard Gillet Étienne Poulain Tessier Chevallier
Collin Chauvin Bouchet Gay Lemaître Bénard Maréchal Humbert Reynaud Antoine Perret Barthélemy Cordier Pichon Lejeune Gilbert Lamy Delaunay
Pasquier Carlier Laporte Diallo Traoré Benali Haddad Mendy Nguyen Ferreira Pereira Santos Costa Rossi Bianchi Kaya Yilmaz Diop Camara Sylla
Cissé Fofana Mbaye Le Gall Le Roux Le Goff Da Silva Kerboul Tanguy Riou Quéré Abgrall Le Bihan Le Corre Jaouen`.split(/\n/).flatMap((l) => l.split(' '))
// Noms composés réassemblés (« Le Gall », « Da Silva »…).
export const LASTNAMES = (() => {
  const out: string[] = []
  for (let i = 0; i < LAST.length; i++) {
    if ((LAST[i] === 'Le' || LAST[i] === 'Da') && LAST[i + 1]) out.push(`${LAST[i]} ${LAST[++i]}`)
    else out.push(LAST[i])
  }
  return out
})()
/** Noms courants des territoires ultramarins (mélangés aux autres). */
export const LAST_OM: Record<string, string[]> = {
  '971': 'Jean-Baptiste Joseph Laurent Pierre-Louis Sainte-Rose Mondésir Félicité Edmond Gustave Dorville Charlery Bellance Clotilde Rosine'.split(' '),
  '972': 'Jean-Baptiste Joseph Laurent Pierre-Louis Sainte-Rose Mondésir Félicité Edmond Gustave Dorville Charlery Bellance Clotilde Rosine'.split(' '),
  '973': 'Jean-Baptiste Joseph Laurent Pierre-Louis Edmond Gustave Félicité Lubin Rosine Dorville'.split(' '),
  '974': 'Payet Hoarau Grondin Técher Lebon Nativel Clain Dijoux Lauret Mussard Turpin Damour Maillot Fontaine'.split(' '),
  '976': 'Abdallah Ahamada Ali Attoumani Madi Soilihi Said Houmadi Combo Mohamed'.split(' '),
  '988': 'Martin Bernard Durand Petit Leroy Moreau Laurent Simon'.split(' '),
}
/**
 * Associations à éviter : sportifs connus (volley, hand, foot, rugby, natation…) dont le prénom et le nom figurent dans
 * les listes. Repliées (sans accents, minuscules).
 */
export const FAMOUS = new Set(
  [
    'Théo Faure', 'Nicolas Le Goff', 'Antoine Dupont', 'Léon Marchand', 'Evan Fournier', 'Lucas Chevalier', 'Chloé Chevalier', 'Clément Noël',
    'Lenny Martinez', 'Benjamin Mendy', 'Maxime Lopez', 'Thomas Meunier', 'Manon Brunet', 'Lucas Hernandez', 'Thomas Ramos', 'Paul Pogba',
    'Hugo Lloris', 'Olivier Giroud', 'Adrien Rabiot', 'Thomas Lemar', 'Benjamin Pavard', 'Raphaël Varane', 'Antoine Griezmann', 'Iman Ndiaye',
    'Julia Simon', 'Nina Dupont', 'Camille Laurent',
  ].map(fold),
)

// ---------- Staff fictif (aucun compte ni profil : noms et identifiants inventés) ----------

export interface Staff {
  key: string
  id: string
  name: string
  role: string
  /** Régions (identifiants de la liste) suivies ; vide = national. */
  regions: string[]
}
const S = (key: string, name: string, role: string, regions: string[] = []): Staff => ({ key, id: seedUuid(`staff:${key}`), name, role, regions })
export const STAFF: Staff[] = [
  S('cnd1', 'Hélène Marquet', 'CTS, cellule nationale de détection'),
  S('cnd2', 'Julien Bréval', 'CTS, cellule nationale de détection', ['region-ant', 'region-guy', 'region-reu', 'region-may', 'region-nc']),
  S('ent', 'Sandrine Corbel', 'Entraîneure nationale jeunes'),
  S('nord', 'Mathieu Lestrade', 'CTS Hauts-de-France et Normandie', ['region-hdf', 'region-nor']),
  S('est', 'Nathalie Guerrin', 'CTS Grand Est, Bourgogne-Franche-Comté, Auvergne-Rhône-Alpes', ['region-ges', 'region-bfc', 'region-ara']),
  S('ouest', 'Olivier Dantec', 'CTS Bretagne, Pays de la Loire, Centre-Val de Loire', ['region-bre', 'region-pdl', 'region-cvl']),
  S('sud', 'Céline Royat', 'CTS Occitanie, Région Sud, Corse', ['region-occ', 'region-sud', 'region-cor']),
  S('idf', 'Thomas Vernier', 'CTS Île-de-France', ['region-idf']),
  S('naq', 'Aurélie Castagné', 'CTS Nouvelle-Aquitaine', ['region-naq']),
  S('prep', 'Franck Lemarié', 'Préparateur physique'),
  S('pole', 'Isabelle Pradel', 'Entraîneure de pôle espoirs'),
  S('etd', 'Yannick Le Floch', 'Conseiller technique départemental'),
]
const STAFF_BY = new Map(STAFF.map((s) => [s.key, s]))
const staff = (key: string) => STAFF_BY.get(key)!
/** CTS d'une région. */
const ctsOf = (region: string) => STAFF.find((s) => s.key !== 'cnd2' && s.regions.includes(region)) ?? staff('cnd2')

// ---------- Textes des avis (positifs ou constructifs, jamais d'étiquette négative) ----------

const STRENGTHS = [
  'Frappe haute et variée en attaque', 'Service flottant précis et régulier', 'Plateforme stable en réception', 'Très bon timing au contre',
  'Lit tôt la passe adverse', 'Toujours disponible pour le passeur', 'Communique beaucoup, encourage ses partenaires', 'Gros volume de jeu, ne lâche aucun ballon',
  'Course d’élan rapide et bien rythmée', 'Service smashé déjà efficace', 'Défense basse, relève beaucoup de ballons', 'Belle envergure au filet',
  'Calme sous la pression en fin de set', 'Belle détente, frappe au-dessus du contre', 'Bonne lecture des trajectoires en défense', 'Déplacements vifs entre contre et attaque',
]
const STRENGTHS_P = [
  'Passe régulière et précise', 'Distribution variée, trouve le central', 'Arrive tôt sous le ballon', 'Organise l’équipe, calme le jeu', 'Bonne passe en suspension',
  'Masque bien ses intentions', 'Deuxième main bien utilisée',
]
const IMPROVE = [
  'À travailler : la course d’élan', 'À travailler : la pénétration des mains au contre', 'À travailler : l’orientation des appuis en réception',
  'À travailler : varier les zones d’attaque', 'À travailler : la communication en défense', 'À travailler : rester positif après une erreur',
  'À travailler : la régularité au service', 'À travailler : le placement en couverture', 'À travailler : la lecture du contre adverse',
  'À travailler : la transition contre-attaque', 'À travailler : le gainage pour stabiliser la frappe',
]
const IMPROVE_P = [
  'À travailler : la passe arrière', 'À travailler : masquer ses intentions', 'À travailler : la défense en zone 1', 'À travailler : prendre la parole',
  'À travailler : le tempo avec le central', 'À travailler : la passe en suspension',
]
const REMARKABLE = ['Profil remarquable pour la catégorie, à suivre de près', 'Potentiel remarquable : gabarit, vitesse de bras et lecture du jeu', 'Très au-dessus de sa catégorie, à revoir sur un stage CRE']
const LATE = 'Maturité probablement tardive : potentiel à protéger'

// ---------- Pôles espoirs (villes des pôles de la saison 2025-2026 ; filles de Sablé-sur-Sarthe à Nantes à la rentrée 2026) ----------

export interface PoleDef {
  sex: 'M' | 'F'
  /** Ville du pôle. */
  city: string
  /**
   * Site enregistré (unité poleSite, périodes des fiches) : la ville, précisée « féminin » / « masculin » quand les deux
   * pôles sont dans la même ville (l'appli reconnaît une période par son site et sa ligue, pas par le sexe).
   */
  site: string
  region: string
  dept: string
  levels: PoleProgramme[]
  sector: 'nord' | 'sud'
}
const SHARED_CITIES = new Set(['Wattignies', 'Lyon', 'Châtenay-Malabry', 'Bordeaux', 'Montpellier'])
const PL = (sex: 'M' | 'F', city: string, region: string, dept: string, sector: 'nord' | 'sud', levels: PoleProgramme[] = ['accession_nationale']): PoleDef => ({
  sex,
  city,
  site: SHARED_CITIES.has(city) ? `${city} ${sex === 'F' ? 'féminin' : 'masculin'}` : city,
  region,
  dept,
  levels,
  sector,
})
export const POLES: PoleDef[] = [
  PL('F', 'Wattignies', 'region-hdf', '59', 'nord'),
  PL('F', 'Lyon', 'region-ara', '69', 'sud'),
  PL('F', 'Châtenay-Malabry', 'region-idf', '92', 'nord'),
  PL('F', 'Mulhouse', 'region-ges', '68', 'nord'),
  PL('F', 'Bordeaux', 'region-naq', '33', 'sud', ['accession_territoriale']),
  PL('F', 'Montpellier', 'region-occ', '34', 'sud'),
  PL('F', 'Boulouris', 'region-sud', '83', 'sud'),
  PL('F', 'Nantes', 'region-pdl', '44', 'nord'),
  PL('M', 'Wattignies', 'region-hdf', '59', 'nord'),
  PL('M', 'Strasbourg', 'region-ges', '67', 'nord'),
  PL('M', 'Châtenay-Malabry', 'region-idf', '92', 'nord'),
  PL('M', 'Dinard', 'region-bre', '35', 'nord'),
  PL('M', 'Bordeaux', 'region-naq', '33', 'sud'),
  PL('M', 'Lyon', 'region-ara', '69', 'sud'),
  PL('M', 'Cannes', 'region-sud', '06', 'sud'),
  PL('M', 'Montpellier', 'region-occ', '34', 'sud'),
]
/** Ancien site du pôle féminin des Pays de la Loire (jusqu'au 30 juin 2026). */
const OLD_SITE: Record<string, string> = { 'F:Nantes': 'Sablé-sur-Sarthe' }
/** Nom d'une unité ou d'un groupe de pôle, comme ceux de l'import de structure : « Pôle Wattignies (filles) ». */
export const poleLabel = (p: Pick<PoleDef, 'city' | 'sex'>) => `Pôle ${p.city} (${p.sex === 'F' ? 'filles' : 'garçons'})`

// ---------- Paramètres du jeu ----------

export const N_PLAYERS = 25_000
/** Jour de référence (saison 2026-2027 en cours) : événements passés et à venir. */
export const TODAY = '2026-10-21'
/** Marque des lignes du jeu (data.demoSeed) : nettoyage des lignes d'une version précédente. */
export const MARK = 'volley'
const IMPORT_AT = '2024-09-12T06:00:00.000Z'
const STRUCT_AT = '2024-09-05T08:00:00.000Z'
const CRIT_AT = '2026-10-15T09:00:00.000Z'
const SQL_ADMIN = 'Administration Supabase (SQL)'

export const YEARS = [2008, 2009, 2010, 2011, 2012, 2013] as const
/** Part de chaque génération (licences FFvolley : M18 plus nombreux que M13) et part des filles (M13 55 %, M15 61 %, M18 57 %). */
const YEAR_W: Record<number, number> = { 2008: 0.172, 2009: 0.188, 2010: 0.188, 2011: 0.17, 2012: 0.17, 2013: 0.112 }
const GIRLS: Record<number, number> = { 2008: 0.57, 2009: 0.57, 2010: 0.57, 2011: 0.61, 2012: 0.61, 2013: 0.55 }
/** Naissances un peu plus nombreuses en début d'année parmi les licenciés (effet de l'âge relatif, accentué ensuite par la sélection). */
export const MONTH_W = [1.1, 1.08, 1.07, 1.05, 1.03, 1.0, 0.99, 0.97, 0.96, 0.94, 0.92, 0.9]
/** Départements « en retard » : peu vus, peu mesurés (« Où aller ? » a du relief). L'outre-mer est aussi moins couvert. */
export const BEHIND = new Set(['02', '23', '36', '52', '58', '93'])
const deptFactor = (d: Dept) => (BEHIND.has(d.code) ? 0.12 : d.code.length === 3 ? 0.5 : d.code === '2A' || d.code === '2B' ? 0.6 : 1)

const OM_CLUBS: Record<string, number> = { '971': 26, '972': 24, '973': 12, '974': 42, '976': 9, '988': 12 }
const METRO_CLUBS = 1330

// ---------- Types internes ----------

type Sex = 'M' | 'F'
type Cat = 'M13' | 'M15' | 'M18'
/** Ligne d'une table hb_* ; `scope` : colonnes de périmètre (046) des joueurs et des lignes rattachées. */
type Row = { id: string; data: Record<string, unknown>; scope?: [string | null, string | null] }

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
  /** Potentiel de taille adulte, talent, maturité (en avance : positif), mental : lois normales. */
  A: number
  t: number
  m: number
  mental: number
  /** Niveau de détection (talent, gabarit, maturité, âge relatif). */
  L: number
  e: Record<'size' | 'w' | 'sit' | 'env' | 'reach' | 'ath' | 'k' | 'gap' | 'tt' | 'mb', number>
  data: Record<string, unknown>
  poleUnitId?: string
}

// ---------- Structure : fédération, ligues, comités, clubs, pôles ----------

export const de = (t: string) => (/^Le /.test(t) ? `du ${t.slice(3)}` : /^Les /.test(t) ? `des ${t.slice(4)}` : /^[aeiou]/.test(fold(t)) ? `d'${t}` : `de ${t}`)

/** Villes de clubs professionnels ou très connus : on y évite les noms les plus proches des vrais clubs. */
const KNOWN_CITIES = new Set(
  [
    'Tours', 'Chaumont', 'Nice', 'Saint-Nazaire', 'Le Plessis-Robinson', 'Marcq-en-Barœul', 'Évreux', 'Saint-Raphaël', 'Venelles', 'Harnes',
    'Cannes', 'Le Cannet', 'Montpellier', 'Paris', 'Toulouse', 'Rennes', 'Nantes', 'Narbonne', 'Poitiers', 'Sète', 'Cambrai', 'Tourcoing',
    'Mulhouse', 'Béziers', 'Quimper', 'Istres', 'Vandœuvre-lès-Nancy', 'Chamalières', 'Mougins', 'Saint-Cloud', 'Calais', 'Strasbourg', 'Lyon',
    'Grenoble', 'Avignon', 'Bordeaux', 'Pessac', 'Massy', 'Amiens', 'Saint-Quentin', 'Halluin', 'Rouen', 'Martigues', 'Clamart', 'Saint-Chamond',
    'Saint-Étienne', 'Fréjus', 'Hyères', 'Toulon', 'Marseille', 'Lille', 'Ajaccio', 'Bastia',
  ].map(fold),
)
type Pattern = (t: string) => string
const PATTERNS: Pattern[] = [
  (t) => `Volley Club ${de(t)}`,
  (t) => `Entente Volley ${t}`,
  (t) => `${t} Volley-Ball`,
  (t) => `AS ${t} Volley`,
  (t) => `US ${t} Volley`,
  (t) => `Olympique ${t} Volley`,
  (t) => `Volley-Ball Club ${t}`,
  (t) => `JS ${t} Volley`,
  (t) => `Amicale laïque ${t} Volley`,
  (t) => `Stade ${t} Volley`,
  (t) => `Cercle Volley ${t}`,
  (t) => `Volley Jeunes ${t}`,
  (t) => `${t} Volley Club`,
  (t) => `${t} Université Club Volley`,
]
/** Indices des modèles à éviter dans les villes connues (« Ville Volley-Ball », « AS Ville Volley », « Ville Volley Club »). */
const RISKY = new Set([2, 3, 12])

/** Arrondissement d'un code postal de Paris, Lyon, Marseille (« 3e », « 1er »). */
export const arrondissement = (cp: string) => {
  const n = Number(cp.slice(3))
  return n === 1 ? '1er' : `${n}e`
}

export interface Structure {
  federationId: string
  ligues: Map<string, { id: string; code: string; name: string; region: string; depts: string[]; seat: string }>
  comites: Map<string, string>
  clubs: Club[]
  poles: (PoleDef & { id: string; name: string; ligueId: string })[]
  rows: Row[]
}

export function clubCounts(): Map<string, number> {
  const metro = DEPTS.filter((d) => d.code.length === 2)
  const w = metro.map((d) => d.pop ** 0.9 * (d.region === 'region-idf' ? 1.35 : 1))
  const k = METRO_CLUBS / w.reduce((s, x) => s + x, 0)
  const out = new Map<string, number>()
  metro.forEach((d, i) => out.set(d.code, Math.max(3, Math.round(k * w[i]))))
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

export function buildStructure(): Structure {
  const rows: Row[] = []
  const unit = (key: string, data: Record<string, unknown>) => {
    const id = seedUuid(`unit:${key}`)
    rows.push({ id, data: { id, ...data, ...stamp('Import de la structure (démo)', STRUCT_AT) } })
    return id
  }
  const federationId = unit('federation', { name: 'Fédération française de volley', levelId: 'niveau-federation', code: 'federation' })
  const ligues = new Map<string, { id: string; code: string; name: string; region: string; depts: string[]; seat: string }>()
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
      const label = (d.code === '13' && town.city === 'Marseille') || (d.code === '69' && town.city === 'Lyon') ? `${town.city} ${arrondissement(postal)}` : town.name
      const nd = new Draw('club-name', number)
      const known = KNOWN_CITIES.has(fold(town.city))
      const order = PATTERNS.map((_, i) => i)
        .filter((i) => !(known && RISKY.has(i)) && (i !== 13 || town.pop >= 80))
        .sort((a, b) => hash32(`${number}:${a}`) - hash32(`${number}:${b}`))
      let name = ''
      for (const i of order) {
        const c = PATTERNS[i](label)
        if (!names.has(fold(c))) {
          name = c
          break
        }
      }
      if (!name) name = `Volley Club ${de(label)} ${rank + 1}`
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

  // Pôles espoirs : rangés sous la ligue de leur région (comme l'import de structure de l'appli).
  const poles = POLES.map((p) => {
    const l = [...ligues.values()].find((x) => x.region === p.region && x.code < '64')!
    const site = { regions: [p.region], sex: p.sex, site: p.site, levels: p.levels }
    const name = poleLabel(p)
    const id = unit(`pole:${p.sex}:${p.city}`, { name, levelId: 'niveau-pole', parentId: l.id, code: poleCode(site), poleSex: p.sex, poleSite: p.site, poleLevels: p.levels })
    return { ...p, id, name, ligueId: l.id }
  })
  return { federationId, ligues, comites, clubs, poles, rows }
}

// ---------- Joueuses et joueurs ----------

const pickYear = (d: Draw) => YEARS[d.weighted(YEARS.map((y) => YEAR_W[y]))]
export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
export const fmtDay = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
export const dayOfYear = (y: number, m: number, d: number) => (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5

/** Âge décimal à une date. */
export const decimalAge = (birth: string, date: string) => (Date.parse(date) - Date.parse(birth)) / (365.25 * 864e5)
/** Âge de saison (âge atteint dans la 2e année de la saison, règle FFvolley) et catégorie M13 / M15 / M18 des fourchettes. */
export const seasonAge = (year: number, date: string) => (Number(date.slice(5, 7)) >= 9 ? Number(date.slice(0, 4)) + 1 : Number(date.slice(0, 4))) - year
export const categoryOf = (year: number, date: string): Cat => {
  const a = seasonAge(year, date)
  return a <= 13 ? 'M13' : a <= 15 ? 'M15' : 'M18'
}
/** Effet de la maturité selon l'âge (fort à 12-14 ans, faible à 17-18 ans). */
export const maturityWeight = (age: number) => clamp((17.5 - age) / 4.5, 0.2, 1)

const POS_BASE: Record<string, [number, number]> = { R4: [0.43, 0], C: [0.215, 0.85], PT: [0.215, 0.35], P: [0.135, -0.8] }
export const NATIONALITIES = ['Portugaise', 'Marocaine', 'Algérienne', 'Italienne', 'Espagnole', 'Belge', 'Tunisienne', 'Sénégalaise', 'Polonaise', 'Roumaine', 'Brésilienne', 'Camerounaise']

export function buildPlayers(st: Structure): SeedPlayer[] {
  const clubW = st.clubs.map((c) => c.weight * (c.dept.code.length === 3 ? 1.15 : 1))
  const cum: number[] = []
  clubW.reduce((s, w, i) => (cum[i] = s + w), 0)
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
    const e = { size: d.normal(), w: d.normal(), sit: d.normal(), env: d.normal(), reach: d.normal(), ath: d.normal(), k: d.normal(), gap: d.normal(), tt: d.normal(), mb: d.normal() }
    // Poste : les grands vers le centre et le pointu, les plus petits vers la passe ; sans poste fixe chez les plus jeunes.
    const noPos = d.chance(year === 2013 ? 0.08 : year === 2012 ? 0.04 : 0.015)
    const codes = Object.keys(POS_BASE)
    const pos = noPos ? undefined : codes[d.weighted(codes.map((c) => POS_BASE[c][0] * Math.exp(POS_BASE[c][1] * A)))]
    const lr = d.next()
    const laterality = pos === 'PT' ? (lr < 0.32 ? 'gaucher' : lr < 0.35 ? 'ambidextre' : 'droitier') : lr < 0.085 ? 'gaucher' : lr < 0.11 ? 'ambidextre' : 'droitier'
    const sec = pos === 'R4' && d.chance(0.12) ? ['PT'] : pos === 'PT' && d.chance(0.2) ? ['R4'] : pos === 'C' && d.chance(0.04) ? ['PT'] : undefined
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
    const L = (0.62 * t + 0.45 * A + 0.3 * m * maturityWeight(ageNow) + (sex === 'M' ? 0.6 : 0.45) * r) / 0.85 - (BEHIND.has(club.dept.code) ? 0.3 : 0)
    const req = d.next()
    const data: Record<string, unknown> = {
      id,
      firstName,
      lastName,
      birthDate,
      sex,
      ...(pos ? { position: pos } : {}),
      ...(sec ? { secondaryPositions: sec } : {}),
      laterality,
      club: club.name,
      clubCode: club.number,
      license,
      licenseRequestType: req < (year === 2013 ? 0.66 : 0.8) ? 'RENOUVELLEMENT' : req < 0.93 ? 'CREATION' : 'MUTATION',
      nationality: d.chance(0.95) ? 'Française' : d.pick(NATIONALITIES),
      ...stamp('Import des licences (démo)', IMPORT_AT),
    }
    players.push({ i, id, sex, year, birthDate, ra, club, dept: club.dept, region: club.dept.region, pos, A, t, m, mental, L, e, data })
  }
  return players
}

// ---------- Pôles espoirs : périodes sur les fiches ----------

export interface PoleOut {
  def: PoleDef & { id: string; name: string; ligueId: string }
  /** Membres de la saison en cours (2026-2027). */
  current: SeedPlayer[]
  /** Sortis le 30 juin 2026 (fin de cursus). */
  past: SeedPlayer[]
}

const GIRLS_SIZE = [15, 15, 15, 14, 16, 14, 14, 14]
/** Membre à cette date (période qui la couvre). */
export const inPoleAt = (p: SeedPlayer, day: string, site?: string) =>
  ((p.data.poles as { site?: string; from?: string; to?: string }[] | undefined) ?? []).some((x) => (!site || x.site === site) && (!x.from || x.from <= day) && (!x.to || x.to >= day))

export function buildPoles(st: Structure, players: SeedPlayer[]): PoleOut[] {
  const taken = new Set<number>()
  const noise = players.map((p) => new Draw('pole-sel', p.i).normal())
  const score = (p: SeedPlayer) => p.L + 0.35 * noise[p.i]
  let girl = 0
  return st.poles.map((def) => {
    const size = def.sex === 'F' ? GIRLS_SIZE[girl++] : 16
    const d = new Draw('pole', def.sex, def.city)
    const pool = players.filter((p) => p.region === def.region && p.sex === def.sex && !taken.has(p.i) && p.pos)
    const ranked = (ys: number[]) => pool.filter((p) => ys.includes(p.year)).sort((a, b) => score(b) - score(a))
    // Effectif de la saison : nés de 2009 à 2012, postes équilibrés (2 passeurs, 3 centraux, 2 pointus au moins).
    const cand = ranked([2009, 2010, 2011, 2012])
    const current: SeedPlayer[] = []
    for (const [pos, n] of [['P', 2], ['C', 3], ['PT', 2], ['R4', 4]] as const) current.push(...cand.filter((p) => p.pos === pos && !current.includes(p)).slice(0, n))
    for (const p of cand) if (current.length < size && !current.includes(p)) current.push(p)
    const past = ranked([2008]).slice(0, d.int(2, 3))
    const old = OLD_SITE[`${def.sex}:${def.city}`]
    for (const p of current) {
      taken.add(p.i)
      const pd = new Draw('pole-entry', p.i)
      const entry = clamp(p.year + (p.sex === 'F' ? 13 : 14) + (pd.chance(0.3) ? 1 : 0), 2023, 2026)
      const periods: Record<string, unknown>[] = []
      if (old && entry < 2026) {
        periods.push({ regionId: def.region, site: old, from: `${entry}-09-01`, to: '2026-06-30', exitReason: 'autre' })
        periods.push({ regionId: def.region, site: def.site, from: '2026-09-01' })
      } else periods.push({ regionId: def.region, site: def.site, from: `${entry}-09-01` })
      p.data.poles = periods
      p.data.boarding = pd.chance(0.85)
      p.poleUnitId = def.id
    }
    for (const p of past) {
      taken.add(p.i)
      const from = new Draw('pole-entry', p.i).chance(0.6) ? '2023-09-01' : '2024-09-01'
      p.data.poles = [{ regionId: def.region, site: old ?? def.site, from, to: '2026-06-30', exitReason: 'fin_cursus' }]
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

const METRO_REGIONS = LIGUES.filter((l) => l.code < '64').map((l) => l.region)
const SECTOR: Record<string, 'nord' | 'sud'> = Object.fromEntries(POLES.map((p) => [p.region, p.sector]))

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
function pickTeam(cands: readonly SeedPlayer[], n: number, key: string, quotas: readonly (readonly [string, number])[], exclude = new Set<number>()) {
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

/** Participation d'un club à une journée (certains clubs n'envoient personne). */
const clubCov = (c: Club, key: string) => (new Draw('club-cov', key, c.number).next() < 0.08 ? 0 : 0.35 + 1.3 * new Draw('club-cov2', key, c.number).next())

export function buildEvents(st: Structure, players: SeedPlayer[], poles: PoleOut[]): SeedEvent[] {
  const events: SeedEvent[] = []
  const lig = (region: string) => [...st.ligues.values()].find((l) => l.region === region && l.code < '64')!
  const deptName = (code: string) => DEPT.get(code)!
  const regionalCts = (p: number) => METRO_REGIONS.map((r) => ({ s: ctsOf(r), p, regions: [r] })).filter((o, i, a) => a.findIndex((x) => x.s.key === o.s.key) === i).map((o) => ({ ...o, regions: o.s.regions }))
  const ev = (e: Omit<SeedEvent, 'id' | 'days' | 'time'> & { days?: number; time?: string }) =>
    events.push({ days: 1, time: '09:00', ...e, id: seedUuid(`event:${e.key}`) })

  // Journées de détection départementales M13-M15 (saison 2025-2026 : surtout les M13 nés en 2013, quelques M15), par les comités.
  const detections: [string, string, string][] = [
    ['69', '2025-09-27', 'Villeurbanne'],
    ['59', '2025-10-04', 'Wattignies'],
    ['92', '2025-10-04', 'Châtenay-Malabry'],
    ['44', '2025-10-11', 'Nantes'],
    ['31', '2025-10-11', 'Toulouse'],
    ['33', '2025-10-18', 'Mérignac'],
  ]
  for (const [code, date, place] of detections) {
    const d = deptName(code)
    const key = `detection-m13-${code}-2025`
    const share: Record<number, number> = { 2013: 0.26, 2012: 0.45, 2011: 0.4 }
    const roster = players.filter((p) => p.dept.code === code && share[p.year] && new Draw(key, p.i).chance(clamp(share[p.year] * clubCov(p.club, key) * (0.55 + 0.9 * sigmoid(p.L)), 0, 0.95)))
    ev({
      key, name: `Journée de détection départementale M13-M15 – Comité ${d.de}`, type: 'observation', date, place, sex: 'mixte',
      organizerId: st.comites.get(code)!, organizerName: `Comité ${d.de}`, creator: ctsOf(d.region), roster,
      observers: [{ s: ctsOf(d.region), p: 0.8 }, { s: staff('etd'), p: 0.65 }, { s: staff('prep'), p: 0.4 }],
      evals: 20, full: 0.25, measure: 'anthro',
    })
  }

  // Coupe de France M18 (1er tour, plateaux régionaux) : observation des clubs engagés par les CTS.
  // Clubs engagés : ceux qui ont une équipe M18 (assez de joueurs de l'âge) ; les plus âgés jouent davantage.
  const cdf = (key: string, sex: Sex | 'mixte', years: number[], date: string, cat = 'M18', minPlayers = 6) => {
    const elig = players.filter((p) => (sex === 'mixte' || p.sex === sex) && years.includes(p.year) && p.dept.code.length === 2)
    const byClub = new Map<string, SeedPlayer[]>()
    for (const p of elig) byClub.set(p.club.number, [...(byClub.get(p.club.number) ?? []), p])
    const roster: SeedPlayer[] = []
    const yearW = (y: number) => [1, 0.75, 0.55][years.indexOf(y)] ?? 1
    for (const [num, ps] of byClub) {
      const pe = ps.length < minPlayers ? 0 : Math.min(0.8, 0.1 + ps.length / 32) * deptFactor(ps[0].dept)
      if (!new Draw(key, 'club', num).chance(pe)) continue
      for (const p of ps) if (new Draw(key, p.i).chance(yearW(p.year) * (0.5 + 0.4 * sigmoid(p.L)))) roster.push(p)
    }
    ev({
      key, name: `Coupe de France ${cat}${sex === 'F' ? ' féminine' : sex === 'M' ? ' masculine' : ''} – 1er tour (observation)`, type: 'match', date, place: 'Plateaux régionaux', time: '10:00', sex,
      organizerId: st.federationId, organizerName: 'Fédération française de volley', creator: staff('cnd1'), roster,
      observers: [{ s: staff('cnd1'), p: 0.15 }, { s: staff('ent'), p: 0.15 }, { s: staff('etd'), p: 0.25 }, ...regionalCts(0.7)],
      evals: 30, full: 0.15,
    })
  }
  cdf('cdf-m18-f-2025', 'F', [2008, 2009, 2010], '2025-10-11')
  cdf('cdf-m18-m-2025', 'M', [2008, 2009, 2010], '2025-10-12')

  // Stages CRE (centres régionaux d'entraînement) : les meilleurs M13-M15 de la ligue.
  const cre = (key: string, region: string, name: string, date: string, place: string, years: number[], nF: number, nM: number) => {
    const elig = players.filter((p) => p.region === region && years.includes(p.year) && p.pos)
    const roster = [
      ...pickTeam(elig.filter((p) => p.sex === 'F'), nF, `${key}-F`, [['P', 4], ['C', 6], ['PT', 4]]),
      ...pickTeam(elig.filter((p) => p.sex === 'M'), nM, `${key}-M`, [['P', 4], ['C', 5], ['PT', 4]]),
    ]
    const l = lig(region)
    ev({
      key, name: `${name} – ${l.name.replace(/ de volley$/, '')}`, type: 'entrainement', date, days: 3, place, sex: 'mixte',
      organizerId: l.id, organizerName: l.name, creator: ctsOf(region), roster,
      observers: [{ s: ctsOf(region), p: 0.9 }, { s: staff('prep'), p: 0.8 }, { s: staff('pole'), p: 0.7 }, { s: staff('cnd1'), p: 0.5 }, { s: staff('etd'), p: 0.5 }],
      evals: 42, full: 0.8, measure: 'full',
    })
  }
  cre('cre-ara-2025', 'region-ara', 'Stage CRE de la Toussaint', '2025-10-27', 'Vichy', [2011, 2012, 2013], 36, 30)

  // Interpôles (pôles espoirs en activité à la date).
  const poleAt = (p: SeedPlayer, day: string) => inPoleAt(p, day)
  const sectorOf = (p: SeedPlayer) => SECTOR[(p.data.poles as { regionId: string }[])[0].regionId]
  const polePlayers = players.filter((p) => p.data.poles)
  const interpoles = (key: string, name: string, date: string, days: number, place: string, keep: (p: SeedPlayer) => boolean, sex: 'M' | 'F' | 'mixte') =>
    ev({
      key, name, type: 'tournoi', date, days, place, sex,
      organizerId: st.federationId, organizerName: 'Fédération française de volley', creator: staff('ent'),
      roster: polePlayers.filter((p) => poleAt(p, date) && keep(p)),
      observers: [{ s: staff('cnd1'), p: 0.9 }, { s: staff('cnd2'), p: 0.8 }, { s: staff('ent'), p: 0.85 }, { s: staff('pole'), p: 0.8 }, { s: staff('prep'), p: 0.6 }, ...regionalCts(0.9)],
      evals: 60, full: 0.7, measure: key.startsWith('interpoles-nord-2026') || key.startsWith('interpoles-sud-2026') ? 'full' : undefined,
    })
  interpoles('interpoles-nord-2026', 'Interpôles Nord', '2026-01-24', 3, 'Châtenay-Malabry', (p) => sectorOf(p) === 'nord', 'mixte')
  interpoles('interpoles-sud-2026', 'Interpôles Sud', '2026-02-07', 3, 'Montpellier', (p) => sectorOf(p) === 'sud', 'mixte')

  cre('cre-pdl-2026', 'region-pdl', 'Stage CRE de février', '2026-02-16', 'Angers', [2011, 2012, 2013], 32, 26)
  cre('cre-idf-2026', 'region-idf', 'Stage CRE de Pâques', '2026-04-14', 'Châtenay-Malabry', [2011, 2012, 2013], 36, 30)

  // Volleyades M15 (sélections régionales : garçons M15 nés en 2011-2012, filles M14 nées en 2012-2013).
  {
    const key = 'volleyades-m15-2026'
    const teams: { id: string; name: string }[] = []
    const tp: Record<string, { team: string; num: string }> = {}
    const roster: SeedPlayer[] = []
    const twoM = new Set(['region-idf', 'region-ara', 'region-hdf', 'region-occ', 'region-naq'])
    const twoF = new Set([...twoM, 'region-pdl', 'region-ges'])
    const omM = ['om-974', 'om-971', 'om-972']
    const omF = ['om-974', 'om-971', 'om-972', 'om-988']
    for (const sex of ['M', 'F'] as Sex[]) {
      const years = sex === 'M' ? [2011, 2012] : [2012, 2013]
      const ligs = [...LIGUES.filter((l) => l.code < '64').map((l) => l.key), ...(sex === 'M' ? omM : omF)]
      for (const lk of ligs) {
        const l = st.ligues.get(lk)!
        const elig = players.filter((p) => p.dept.ligue === lk && p.sex === sex && years.includes(p.year) && p.pos)
        const n = (sex === 'M' ? twoM : twoF).has(l.region) && l.code < '64' ? 2 : 1
        const used = new Set<number>()
        for (let k = 0; k < n; k++) {
          const team = pickTeam(elig, 13, `${key}-${lk}-${sex}-${k}`, [['P', 2], ['C', 3], ['PT', 2], ['R4', 4]], used)
          if (team.length < 8) continue
          const tid = `${l.code}${sex}${k + 1}`
          const label = l.name.replace(/^Ligue (de la |de |du |des |d')?/, '').replace(/ de volley$/, '')
          teams.push({ id: tid, name: `${label}${n > 1 ? ` ${k + 1}` : ''} (${sex === 'F' ? 'filles' : 'garçons'})` })
          const order = ['P', 'R4', 'C', 'PT', undefined]
          team.sort((a, b) => order.indexOf(a.pos) - order.indexOf(b.pos)).forEach((p, j) => {
            used.add(p.i)
            roster.push(p)
            tp[p.id] = { team: tid, num: String(j + 1) }
          })
        }
      }
    }
    ev({
      key, name: 'Volleyades M15', type: 'tournoi', date: '2026-04-24', days: 3, place: 'Brest', sex: 'mixte',
      organizerId: st.federationId, organizerName: 'Fédération française de volley', creator: staff('cnd1'), roster,
      observers: [{ s: staff('cnd1'), p: 0.7 }, { s: staff('cnd2'), p: 0.6 }, { s: staff('ent'), p: 0.7 }, { s: staff('pole'), p: 0.6 }, { s: staff('prep'), p: 0.3 }, ...regionalCts(0.95)],
      evals: 190, full: 0.4, tournament: { teams, players: tp },
    })
  }

  // Tournoi des sélections départementales M13 (Bretagne, garçons nés en 2013 : les filles M12 sont nées en 2014).
  {
    const key = 'tsd-m13-bre-2026'
    const teams: { id: string; name: string }[] = []
    const tp: Record<string, { team: string; num: string }> = {}
    const roster: SeedPlayer[] = []
    for (const code of ['22', '29', '35', '56']) {
      const team = pickTeam(players.filter((p) => p.dept.code === code && p.sex === 'M' && p.year === 2013 && p.pos), 10, `${key}-${code}`, [['P', 2], ['C', 2], ['PT', 2], ['R4', 3]])
      teams.push({ id: `d${code}`, name: `Sélection ${DEPT.get(code)!.name}` })
      team.forEach((p, j) => {
        roster.push(p)
        tp[p.id] = { team: `d${code}`, num: String(j + 1) }
      })
    }
    const l = lig('region-bre')
    ev({
      key, name: 'Tournoi des sélections départementales M13', type: 'tournoi', date: '2026-05-02', place: 'Saint-Brieuc', sex: 'M',
      organizerId: l.id, organizerName: l.name, creator: staff('ouest'), roster,
      observers: [{ s: staff('ouest'), p: 0.85 }, { s: staff('etd'), p: 0.6 }, { s: staff('cnd2'), p: 0.4 }],
      evals: 30, full: 0.3, tournament: { teams, players: tp },
    })
  }

  // Volleyades M13 (garçons) : 24 sélections départementales.
  {
    const key = 'volleyades-m13-2026'
    const boys = players.filter((p) => p.sex === 'M' && p.year === 2013 && p.pos && p.dept.code.length === 2 && !BEHIND.has(p.dept.code))
    const count = new Map<string, number>()
    for (const p of boys) count.set(p.dept.code, (count.get(p.dept.code) ?? 0) + 1)
    const depts = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 24).map(([c]) => c)
    const teams: { id: string; name: string }[] = []
    const tp: Record<string, { team: string; num: string }> = {}
    const roster: SeedPlayer[] = []
    for (const code of depts) {
      const team = pickTeam(boys.filter((p) => p.dept.code === code), 9, `${key}-${code}`, [['P', 2], ['C', 2], ['PT', 2], ['R4', 3]])
      teams.push({ id: `d${code}`, name: `Sélection ${DEPT.get(code)!.name}` })
      team.forEach((p, j) => {
        roster.push(p)
        tp[p.id] = { team: `d${code}`, num: String(j + 1) }
      })
    }
    ev({
      key, name: 'Volleyades M13 (garçons)', type: 'tournoi', date: '2026-05-23', days: 3, place: 'Arles', sex: 'M',
      organizerId: st.federationId, organizerName: 'Fédération française de volley', creator: staff('cnd1'), roster,
      observers: [{ s: staff('cnd1'), p: 0.65 }, { s: staff('cnd2'), p: 0.55 }, { s: staff('etd'), p: 0.55 }, ...regionalCts(0.9)],
      evals: 80, full: 0.3, tournament: { teams, players: tp },
    })
  }

  interpoles('interpoles-france-m-2026', 'Interpôles France (garçons)', '2026-05-25', 4, 'Vichy', (p) => p.sex === 'M', 'M')
  interpoles('interpoles-france-f-2026', 'Interpôles France (filles)', '2026-06-01', 4, 'Vichy', (p) => p.sex === 'F', 'F')

  // Finales des championnats de France M18 (observation) : les 8 meilleures équipes de clubs de chaque sexe (nés de 2008 à 2010).
  {
    const key = 'finales-m18-2026'
    const roster: SeedPlayer[] = []
    for (const sex of ['F', 'M'] as Sex[]) {
      const byClub = new Map<string, SeedPlayer[]>()
      for (const p of players) if (p.sex === sex && p.year >= 2008 && p.year <= 2010 && p.dept.code.length === 2) byClub.set(p.club.number, [...(byClub.get(p.club.number) ?? []), p])
      const strength = (ps: SeedPlayer[]) => [...ps].sort((a, b) => b.L - a.L).slice(0, 10).reduce((t, p) => t + p.L, 0)
      const best = [...byClub.values()].filter((ps) => ps.length >= 10).sort((a, b) => strength(b) - strength(a)).slice(0, 8)
      for (const ps of best) roster.push(...[...ps].sort((a, b) => b.L + 0.5 * (2010 - b.year) - (a.L + 0.5 * (2010 - a.year))).slice(0, 12))
    }
    ev({
      key, name: 'Finales des championnats de France M18 (observation)', type: 'match', date: '2026-06-13', days: 2, place: 'Poitiers', time: '10:00', sex: 'mixte',
      organizerId: st.federationId, organizerName: 'Fédération française de volley', creator: staff('cnd1'), roster,
      observers: [{ s: staff('cnd1'), p: 0.8 }, { s: staff('cnd2'), p: 0.6 }, { s: staff('ent'), p: 0.8 }, { s: staff('pole'), p: 0.5 }, ...regionalCts(0.85)],
      evals: 40, full: 0.4,
    })
  }

  // Saison 2026-2027 : journées de détection M15 (nés en 2012-2013), Coupe de France M18 (nés de 2009 à 2011), stages CRE.
  for (const [code, date, place] of [['38', '2026-09-26', 'Grenoble'], ['77', '2026-10-03', 'Melun']] as const) {
    const d = deptName(code)
    const key = `detection-m15-${code}-2026`
    const roster = players.filter((p) => p.dept.code === code && (p.year === 2012 || p.year === 2013) && new Draw(key, p.i).chance(clamp(0.45 * clubCov(p.club, key) * (0.55 + 0.9 * sigmoid(p.L)), 0, 0.95)))
    ev({
      key, name: `Journée de détection départementale M15 – Comité ${d.de}`, type: 'observation', date, place, sex: 'mixte',
      organizerId: st.comites.get(code)!, organizerName: `Comité ${d.de}`, creator: ctsOf(d.region), roster,
      observers: [{ s: ctsOf(d.region), p: 0.8 }, { s: staff('etd'), p: 0.65 }, { s: staff('prep'), p: 0.4 }],
      evals: 20, full: 0.25, measure: 'anthro',
    })
  }
  cdf('cdf-m18-f-2026', 'F', [2009, 2010, 2011], '2026-10-10')
  cdf('cdf-m18-m-2026', 'M', [2009, 2010, 2011], '2026-10-11')
  // Coupe de France M21 (nés de 2006 à 2008 : ici, la génération 2008), plateaux mixtes du premier tour.
  cdf('cdf-m21-2026', 'mixte', [2008], '2026-10-17', 'M21', 4)
  cre('cre-occ-2026', 'region-occ', 'Stage CRE de la Toussaint', '2026-10-19', 'Montpellier', [2012, 2013], 32, 26)
  cre('cre-hdf-2026', 'region-hdf', 'Stage CRE de la Toussaint', '2026-10-19', 'Wattignies', [2012, 2013], 32, 26)

  // À venir : Interpôles Nord 2027 (effectifs de la saison) et un stage CRE de février (liste des invités).
  interpoles('interpoles-nord-2027', 'Interpôles Nord', '2027-01-23', 3, 'Châtenay-Malabry', (p) => sectorOf(p) === 'nord', 'mixte')
  {
    const key = 'cre-nor-2027'
    const elig = players.filter((p) => p.region === 'region-nor' && (p.year === 2012 || p.year === 2013) && p.pos)
    const l = lig('region-nor')
    ev({
      key, name: `Stage CRE de février – ${l.name.replace(/ de volley$/, '')}`, type: 'entrainement', date: '2027-02-15', days: 3, place: 'Caen', sex: 'mixte',
      organizerId: l.id, organizerName: l.name, creator: staff('nord'),
      roster: [...pickTeam(elig.filter((p) => p.sex === 'F'), 28, `${key}-F`, [['P', 3], ['C', 5]]), ...pickTeam(elig.filter((p) => p.sex === 'M'), 24, `${key}-M`, [['P', 3], ['C', 4]])],
      observers: [], evals: 0, full: 0,
    })
  }
  void poles
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
}

// ---------- Dates et heures (Paris) ----------

/** Dernier dimanche d'un mois (changement d'heure). */
const lastSunday = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m, 0))
  return d.getUTCDate() - d.getUTCDay()
}
/** Heure locale de Paris → horodatage ISO (UTC). */
export function parisIso(day: string, hh: number, mm: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const summer = (m > 3 && m < 10) || (m === 3 && d >= lastSunday(y, 3)) || (m === 10 && d < lastSunday(y, 10))
  return new Date(Date.UTC(y, m - 1, d, hh - (summer ? 2 : 1), mm)).toISOString()
}
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10)

// ---------- « Vu » et avis ----------

export function buildSeen(events: SeedEvent[]): Row[] {
  const rows: Row[] = []
  for (const e of events) {
    if (upcoming(e)) continue
    for (const o of e.observers) {
      for (const p of e.roster) {
        if (o.regions && !o.regions.includes(p.region)) continue
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

const gridOf = (pos?: string) => [...(pos === 'P' ? GRID_PASSEUR : GRID_CHAMP), ...GRID_MENTAL]
/** Petits penchants de chaque poste sur la grille du joueur de champ. */
const POS_TILT: Record<string, Record<string, number>> = {
  C: { champ_contre: 0.35, champ_attaque: 0.2, champ_reception: -0.3, champ_defense: -0.15 },
  R4: { champ_reception: 0.25, champ_defense: 0.15 },
  PT: { champ_attaque: 0.3, champ_service: 0.15, champ_reception: -0.2 },
}
const OBS_BIAS: Record<string, number> = { cnd1: -0.15, cnd2: 0, ent: -0.2, nord: 0.1, est: 0.05, ouest: 0.15, sud: 0.1, idf: 0, naq: 0.1, prep: 0.05, pole: -0.1, etd: 0.25 }

/** Niveau stable d'un joueur sur un critère (centré sur 3). */
export function levelOf(p: SeedPlayer, c: string): number {
  const d = new Draw('level', p.i, c)
  const remarkable = p.t > 2.1 ? 0.45 : 0
  if (c.startsWith('mental_')) return 2.4 + 0.35 * p.t + 0.5 * p.mental + 0.35 * d.normal() + remarkable
  const tilt = (p.pos ? POS_TILT[p.pos]?.[c] : undefined) ?? 0
  return 2.15 + 0.75 * p.t + 0.2 * p.m * maturityWeight(decimalAge(p.birthDate, TODAY)) + 0.45 * d.normal() + tilt + remarkable
}

export function buildEvaluations(events: SeedEvent[]): Row[] {
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
      const obs = e.observers.filter((o) => !o.regions || o.regions.includes(p.region))
      if (!obs.length) continue
      const n = d.chance(0.18) && obs.length > 1 ? 2 : 1
      const who = [...obs].sort((a, b) => hash32(`${e.key}:${p.i}:${a.s.key}`) - hash32(`${e.key}:${p.i}:${b.s.key}`)).slice(0, n)
      for (const o of who) {
        const r = new Draw('eval', e.key, p.i, o.s.key)
        const full = r.chance(e.full)
        const scores: Record<string, number> = {}
        for (const c of gridOf(p.pos)) {
          if (!full && !QUICK.has(c)) continue
          if (r.chance(0.08)) continue // critère pas observé cette fois
          scores[c] = Math.round(clamp(levelOf(p, c) + (OBS_BIAS[o.s.key] ?? 0) + 0.45 * r.normal(), 1, 5))
        }
        if (!Object.keys(scores).length) continue
        const day = addDays(e.date, r.int(0, e.days - 1))
        const at = parisIso(day, r.int(18, 21), r.int(0, 59))
        const setter = p.pos === 'P'
        const late = p.m < -1 && p.t > 0.8 && decimalAge(p.birthDate, day) < 15.5
        const strengths = p.t > 2.1 && r.chance(0.7) ? r.pick(REMARKABLE) : late && r.chance(0.6) ? LATE : r.chance(0.5) ? r.pick(setter ? STRENGTHS_P : STRENGTHS) : undefined
        const improvements = r.chance(0.4) ? r.pick(setter ? IMPROVE_P : IMPROVE) : undefined
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

export const TESTS_FULL = ['taille', 'poids', 'taille_assise', 'envergure', 'atteinte', 'hauteur_attaque', 'hauteur_contre', 'cmj_hauteur', 't_test', 'medecine_ball']
const TESTS_ANTHRO = ['taille', 'poids', 'taille_assise', 'envergure', 'atteinte']
const TESTS_CDE = ['taille', 'poids', 'taille_assise', 'atteinte', 'hauteur_attaque', 'cmj_hauteur']
/** Envergure − taille (cm), par sexe et catégorie (fourchettes de la recherche). */
export const ENVERGURE: Record<Sex, Record<Cat, readonly [number, number]>> = {
  F: { M13: [-2, 6], M15: [-2, 6], M18: [-2, 7] },
  M: { M13: [-2, 6], M15: [0, 8], M18: [0, 8] },
}
/** Détente avec élan (hauteur d'attaque − atteinte), comme src/demoVolley.ts. */
const ELAN: Record<Sex, readonly [number, number]> = { F: [38, 60], M: [45, 75] }
const MID: Record<Cat, number> = { M13: 12.5, M15: 14.5, M18: 16.5 }
/** Croissance moyenne (cm par mois) : plus forte avant et autour du pic. */
const GROW: Record<Sex, Record<Cat, number>> = { F: { M13: 0.45, M15: 0.2, M18: 0.05 }, M: { M13: 0.5, M15: 0.45, M18: 0.15 } }

/**
 * Valeurs d'une séance de tests, dans les fourchettes de la catégorie (src/demoVolley.ts RANGES) : gabarit tiré du potentiel
 * de taille et de la maturité (plus fort chez les jeunes), détente et vitesse du talent ; corrélations taille ↔ atteinte ↔
 * hauteur d'attaque, détente ↔ hauteur d'attaque. `minTaille` : taille de la séance d'avant plus un peu de croissance.
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
  const poids = r1(clamp(lerp(R.poids, phi((0.75 * zs + 0.45 * p.e.w + 0.1 * p.m) / 1.1)) + 0.8 * s.normal(), R.poids[0], R.poids[1]))
  const ratio = clamp(0.515 + 0.005 * p.m * g - (p.sex === 'M' ? 0.004 : 0) + 0.006 * p.e.sit, 0.5, 0.535)
  const assise = roundTo(clamp(taille * ratio, R.assise[0], R.assise[1]), 0.5)
  const envergure = Math.round(taille + lerp(ENVERGURE[p.sex][c], phi(p.e.env)))
  const atteinte = Math.round(clamp(taille * (1.305 + 0.006 * p.e.reach), R.atteinte[0], R.atteinte[1]))
  const za = 0.65 * p.t + 0.35 * p.m * g + 0.3 * p.e.ath - 0.15 + 0.8 * dz
  const cmj = r1(clamp(lerp(R.cmj, phi(za / 1.05)) + 0.8 * s.normal(), R.cmj[0], R.cmj[1]))
  const elan = clamp(cmj * (1.5 + 0.06 * p.e.k), ELAN[p.sex][0], ELAN[p.sex][1])
  const attaque = Math.round(clamp(atteinte + elan, R.attaque[0], R.attaque[1]))
  const contre = Math.round(clamp(attaque - lerp([10, 25], phi(p.e.gap)), R.contre[0], R.contre[1]))
  const ttest = r2(clamp(lerp(R.ttest, phi(0.6 * za + 0.45 * p.e.tt)) + 0.1 * s.normal(), R.ttest[0], R.ttest[1]))
  const mb = r1(clamp(lerp(R.mb, phi(0.5 * za + 0.35 * zs + 0.3 * p.e.mb)) + 0.1 * s.normal(), R.mb[0], R.mb[1]))
  return { taille, poids, taille_assise: assise, envergure, atteinte, hauteur_attaque: attaque, hauteur_contre: contre, cmj_hauteur: cmj, t_test: ttest, medecine_ball: mb }
}

interface Session {
  date: string
  tests: string[]
  author: Staff
}

/** Séances des comités (tests CDE), un samedi par période, selon le département. */
const CDE_PERIODS = [
  ['2024-11-09', '2024-11-16', '2024-11-23'],
  ['2025-03-15', '2025-03-22', '2025-03-29'],
  ['2025-11-08', '2025-11-15', '2025-11-22'],
  ['2026-03-14', '2026-03-21', '2026-03-28'],
  ['2026-10-03', '2026-10-10', '2026-10-17'],
]
/** Tests des pôles (rentrée, fin de saison), en plus des Interpôles. */
const POLE_TESTS = ['2025-10-07', '2026-06-09', '2026-10-06']
/** Part des joueurs repérés et testés (en plus de ceux testés lors des événements). */
export const DETECTED_SHARE = 0.235

export interface MeasureOut {
  rows: Row[]
  sessions: Map<number, Session[]>
}

export function buildMeasurements(players: SeedPlayer[], events: SeedEvent[], seenPlayers: Set<number>): MeasureOut {
  const sessions = new Map<number, Session[]>()
  const add = (p: SeedPlayer, s: Session) => sessions.set(p.i, [...(sessions.get(p.i) ?? []), s])
  for (const e of events) {
    if (upcoming(e) || !e.measure) continue
    for (const p of e.roster) {
      if (e.measure === 'anthro' && !new Draw('measure-ev', e.key, p.i).chance(0.85)) continue
      add(p, { date: e.date, tests: e.measure === 'full' ? TESTS_FULL : TESTS_ANTHRO, author: e.measure === 'full' ? staff('prep') : staff('etd') })
    }
  }
  for (const p of players) if (p.data.poles) for (const day of POLE_TESTS) if (inPoleAt(p, day)) add(p, { date: day, tests: TESTS_FULL, author: staff('prep') })
  // Joueurs repérés (tests des comités) : niveau, âge, département ; ceux déjà vus un peu plus souvent.
  const score = players.map((p) => 0.55 * p.L + 0.3 * (decimalAge(p.birthDate, TODAY) - 15.5) / 1.7 + 0.6 * Math.log(deptFactor(p.dept)) + 0.6 * new Draw('detected', p.i).normal() + (seenPlayers.has(p.i) ? 0.5 : 0))
  const cut = [...score].sort((a, b) => b - a)[Math.floor(players.length * DETECTED_SHARE)]
  for (const p of players) {
    const had = sessions.has(p.i)
    if (score[p.i] < cut && !had) continue
    const d = new Draw('cde', p.i)
    const n = had ? (d.chance(0.4) ? 1 : 0) : 1 + d.weighted([0.55, 0.3, 0.15])
    const periods = [0, 1, 2, 3, 4]
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
      for (const c of TESTS_FULL) {
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
  const adult = lerp(RANGES[p.sex].M18.taille, phi((0.85 * p.A + 0.3 * p.e.size - 0.3) / 1.1))
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

export function buildGroups(st: Structure, players: SeedPlayer[], poles: PoleOut[], events: SeedEvent[]): Row[] {
  const rows: Row[] = []
  for (const { def } of poles) {
    const by = ctsOf(def.region)
    const id = seedUuid(`group:pole:${def.sex}:${def.city}`)
    rows.push({
      id,
      data: {
        id, name: poleLabel(def),
        description: `Pôle espoirs ${def.sex === 'F' ? 'féminin' : 'masculin'} : membres d'après les périodes de pôle des fiches`,
        playerIds: [], poleUnitId: def.id, private: false, sex: def.sex, scope: 'ligue', regionId: def.region,
        editors: [], names: { [by.id]: by.name }, addedBy: {}, ...stamp(by.name, '2025-08-28T08:30:00.000Z', by.id),
      },
    })
  }
  const roster = (key: string) => events.find((e) => e.key === key)!.roster
  const selections: [string, string, Sex, string, string[], SeedPlayer[], string][] = [
    ['sel-occ-m15', 'Sélection régionale M15 garçons – Occitanie', 'M', 'region-occ', ['2012', '2013'], roster('cre-occ-2026').filter((p) => p.sex === 'M'), parisIso('2026-10-21', 17, 40)],
    ['sel-hdf-m14', 'Sélection régionale M14 filles – Hauts-de-France', 'F', 'region-hdf', ['2013'], roster('cre-hdf-2026').filter((p) => p.sex === 'F' && p.year === 2013), parisIso('2026-10-21', 18, 5)],
    ['sel-ara-m15', 'Sélection régionale M15 garçons – Auvergne-Rhône-Alpes', 'M', 'region-ara', ['2012', '2013'], players.filter((p) => p.region === 'region-ara' && p.sex === 'M' && (p.year === 2012 || p.year === 2013) && p.pos), parisIso('2026-10-08', 20, 10)],
  ]
  for (const [key, name, sex, region, years, cands, at] of selections) {
    const by = ctsOf(region)
    const team = pickTeam(cands, 14, key, [['P', 2], ['C', 3], ['PT', 2], ['R4', 4]])
    const id = seedUuid(`group:${key}`)
    rows.push({
      id,
      data: {
        id, name, description: 'Volleyades M15 2027 : liste en préparation (démonstration, joueurs fictifs)', playerIds: team.map((p) => p.id),
        private: false, sex, scope: 'ligue', regionId: region, years, editors: [], names: { [by.id]: by.name },
        addedBy: Object.fromEntries(team.map((p) => [p.id, by.id])), ...stamp(by.name, at, by.id),
      },
    })
  }
  void st
  return rows
}

/** Lien générique déjà utilisé par la démo locale (src/demoVolley.ts) : aucun mineur à l'image. */
export const GENERIC_VIDEO = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'

export function buildVideos(players: SeedPlayer[], events: SeedEvent[]): Row[] {
  const note = (skill: VolleySkill, outcome: VolleyOutcome, more?: string) => `${volleyNote(skill, outcome)}${more ? ` · ${more}` : ''}`
  const best = (f: (p: SeedPlayer) => boolean) => players.filter((p) => f(p) && inPoleAt(p, TODAY)).sort((a, b) => b.L - a.L)[0]
  const attacker = best((p) => p.sex === 'F' && p.pos === 'R4')
  const setter = best((p) => p.sex === 'M' && p.pos === 'P')
  const moments = (ms: [number, string][]) => ms.map(([at, n]) => ({ at, dur: 3, note: n }))
  const m1 = moments([
    [1, note('service', 'reussi', 'flottant')], [4, note('reception', 'neutre')], [7, note('attaque', 'reussi', 'zone 4')],
    [10, note('contre', 'reussi')], [13, note('defense', 'retravailler')], [16, note('attaque', 'retravailler', 'ligne')],
  ])
  const m2 = moments([[2, note('passe', 'reussi', 'jeu rapide avec le central')], [8, note('passe', 'neutre')], [14, note('defense', 'reussi', 'zone 1')]])
  const v = (key: string, data: Record<string, unknown>, by: Staff, at: string): Row => {
    const id = seedUuid(`video:${key}`)
    return { id, data: { id, ...data, ...stamp(by.name, at, by.id) } }
  }
  const volleyades = events.find((e) => e.key === 'volleyades-m15-2026')!
  return [
    v('attaque', { targetKind: 'player', targetId: attacker.id, url: GENERIC_VIDEO, title: 'Lien générique de démonstration (aucun mineur à l’image) — gestes repérés', at: m1[0].at, moments: m1 }, staff('pole'), parisIso('2026-10-17', 19, 12)),
    v('passe', { targetKind: 'player', targetId: setter.id, url: GENERIC_VIDEO, title: 'Lien générique de démonstration (aucun mineur à l’image) — passes', at: m2[0].at, moments: m2 }, staff('ent'), parisIso('2026-10-14', 21, 3)),
    v('volleyades', { targetKind: 'event', targetId: volleyades.id, url: 'https://www.rematch.tv/', title: 'Match complet (lien générique de démonstration)' }, staff('cnd1'), parisIso('2026-04-27', 9, 30)),
  ]
}

// ---------- Listes, configuration, critères ----------

const REGION_ORDER = ['region-ara', 'region-bfc', 'region-bre', 'region-cvl', 'region-cor', 'region-ges', 'region-hdf', 'region-idf', 'region-nor', 'region-naq', 'region-occ', 'region-pdl', 'region-sud', 'region-ant', 'region-guy', 'region-reu', 'region-may', 'region-nc', 'region-om']

/** Régions (19, comme la base de test du handball) et départements (01 à 95 avec la Corse en « 20 », 97, 971 à 988). */
export function buildLists(): Row[] {
  const rows: Row[] = REGION_ORDER.map((id, i) => ({ id, data: { id, kind: 'region', name: REGION_FALLBACK[id], order: i + 1 } }))
  const depts: { code: string; name: string; regionId?: string }[] = []
  for (const d of DEPTS) {
    if (d.code === '2A') depts.push({ code: '20', name: 'Corse' })
    else if (d.code === '2B') continue
    else depts.push({ code: d.code, name: d.name, ...(d.code.length === 3 ? { regionId: d.region } : {}) })
  }
  depts.push({ code: '97', name: 'Ultramarins (non précisé)', regionId: 'region-om' })
  for (const d of depts) {
    const id = `dept-${d.code}`
    rows.push({ id, data: { id, kind: 'department', code: d.code, name: d.name, ...(d.regionId ? { regionId: d.regionId } : {}), order: d.code === '97' ? 970 : Number(d.code) } })
  }
  return rows
}

export function buildCriteria(file: string): Row[] {
  applySportConfig(resolveSportConfig([], 'volley'))
  const parsed = parseRows(rowsFromJson(file))
  if (parsed.errors.length) throw new Error(`Critères : ${parsed.errors.map((e) => `ligne ${e.line} ${e.reason}`).join(' ; ')}`)
  // Comme applyCriteria (src/criteriaImport.ts) : champs du fichier, deleted: false, importedAt ; champs vides retirés.
  return parsed.rows.map(({ c }) => {
    const data = JSON.parse(JSON.stringify({ ...c, deleted: false, importedAt: Date.parse(CRIT_AT) })) as Record<string, unknown>
    return { id: c.id, data: { ...data, createdByName: 'Import des critères (démo)', createdAtServer: CRIT_AT, updatedByName: 'Import des critères (démo)', updatedAtServer: CRIT_AT } }
  })
}

// ---------- Assemblage ----------

export interface Seed {
  structure: Structure
  players: SeedPlayer[]
  poles: PoleOut[]
  events: SeedEvent[]
  tables: Record<'config' | 'lists' | 'units' | 'criteria' | 'players' | 'events' | 'groups' | 'measurements' | 'evaluations' | 'seen' | 'videos', Row[]>
  measured: Map<number, Session[]>
}

export function buildSeed(criteriaFile: string): Seed {
  const structure = buildStructure()
  const players = buildPlayers(structure)
  const poles = buildPoles(structure, players)
  const events = buildEvents(structure, players, poles)
  const seen = buildSeen(events)
  const evaluations = buildEvaluations(events)
  const byId = new Map(players.map((p) => [p.id, p]))
  const seenPlayers = new Set<number>([...seen, ...evaluations].map((r) => byId.get(r.data.playerId as string)!.i))
  const m = buildMeasurements(players, events, seenPlayers)
  const inCre = new Set(events.filter((e) => e.key.startsWith('cre-') && !upcoming(e)).flatMap((e) => e.roster.map((p) => p.i)))
  for (const p of players) if (m.sessions.has(p.i)) addParents(p, p.data.poles ? 0.9 : inCre.has(p.i) ? 0.75 : 0.55)
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
  // Colonnes de périmètre (046) calculées ici, avec la même règle que le serveur (hb_player_dept, hb_player_club) : les
  // lignes sont écrites une seule fois (pas de seconde passe UPDATE sur ~100 000 lignes).
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
    measured: m.sessions,
    tables: {
      config: [{ id: 'sport', data: { id: 'sport', key: 'sport', value: { sport: 'volley', sportName: 'Volley' } } }],
      lists: buildLists(),
      units: structure.rows,
      criteria: buildCriteria(criteriaFile),
      players: scoped(players.map((p) => ({ id: p.id, data: p.data })), 'id'),
      events: eventRows,
      groups: buildGroups(structure, players, poles, events),
      measurements: scoped(m.rows),
      evaluations: scoped(evaluations),
      seen: scoped(seen),
      videos,
    },
  }
}

// ---------- SQL ----------

const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const BATCH = 400

/**
 * Écriture idempotente (« la plus récente gagne » n'a pas cours ici : le jeu fait foi). `admin` : lignes signées comme les
 * scripts SQL (listes, configuration ; leur date de création d'origine est gardée).
 */
export function upsertSql(table: string, rows: Row[], mode: 'replace' | 'admin' = 'replace'): string {
  const out = [`-- hb_${table} : ${rows.length} ligne(s)`]
  const add =
    mode === 'admin'
      ? `jsonb_build_object('updatedAt', s.ms, 'createdByName', ${q(SQL_ADMIN)}, 'updatedByName', ${q(SQL_ADMIN)}, 'createdAtServer', now(), 'updatedAtServer', now())`
      : `jsonb_build_object('updatedAt', s.ms)`
  const set = mode === 'admin' ? `t.data || (excluded.data - 'createdByName' - 'createdAtServer')` : 'excluded.data'
  const scoped = rows.some((r) => r.scope)
  const lit = (v: string | null | undefined) => (v ? q(v) : 'null')
  for (let i = 0; i < rows.length; i += BATCH) {
    const vals = rows
      .slice(i, i + BATCH)
      .map((r) => `(${q(r.id)},${q(JSON.stringify(r.data))}${scoped ? `,${lit(r.scope?.[0])},${lit(r.scope?.[1])}` : ''})`)
      .join(',\n')
    out.push(
      `insert into public.hb_${table} as t (id, data, updated_at_client, deleted, server_updated_at${scoped ? ', scope_dept, scope_club' : ''})
select v.id, v.d::jsonb || ${add}, s.ms, false, clock_timestamp()${scoped ? ', v.sd, v.sc' : ''}
  from (values
${vals}
) v(id, d${scoped ? ', sd, sc' : ''}) cross join seed_stamp s
on conflict (id) do update set data = ${set}, updated_at_client = excluded.updated_at_client, deleted = false, server_updated_at = excluded.server_updated_at${scoped ? ', scope_dept = excluded.scope_dept, scope_club = excluded.scope_club' : ''};`,
    )
  }
  return out.join('\n\n') + '\n'
}

const MARKED = ['players', 'measurements', 'events', 'evaluations', 'groups', 'seen', 'videos', 'units']

const PRELUDE = `-- Jeu de démonstration volley (données fictives) : début de la transaction.
\\set ON_ERROR_STOP on
begin;
-- Déclencheurs coupés le temps de l'écriture : ni journal, ni signature, ni notification (comme supabase/maintenance/demo_*.sql).
set local session_replication_role = replica;
set local statement_timeout = 0;
create temp table seed_stamp on commit drop as select (extract(epoch from now()) * 1000)::bigint as ms, now() as started;
`

export const LEVELS_SQL = `-- Niveaux de structure (déjà posés par supabase/044_structure.sql : rien ne change s'ils sont là).
insert into public.hb_levels (id, data, updated_at_client)
select l.id, jsonb_build_object('id', l.id, 'name', l.name, 'order', l.ord, 'updatedAt', 1), 1
  from (values ('niveau-federation', 'Fédération', 1), ('niveau-ligue', 'Ligue', 2), ('niveau-comite', 'Comité', 3),
               ('niveau-pole', 'Pôle', 4), ('niveau-club', 'Club', 5)) as l(id, name, ord)
on conflict (id) do nothing;
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

/** Contrôles après passage (comptes, répartitions, fourchettes) : verify.sql. */
export function verifySql(): string {
  const bands = (['F', 'M'] as Sex[])
    .flatMap((s) =>
      (['M13', 'M15', 'M18'] as Cat[]).flatMap((c) =>
        Object.entries(RANGES[s][c]).map(([k, [a, b]]) => {
          const crit = { taille: 'taille', assise: 'taille_assise', poids: 'poids', atteinte: 'atteinte', attaque: 'hauteur_attaque', contre: 'hauteur_contre', cmj: 'cmj_hauteur', ttest: 't_test', mb: 'medecine_ball' }[k]!
          return `('${s}','${c}','${crit}',${Math.min(a, b)},${Math.max(a, b)})`
        }),
      ),
    )
    .join(',\n  ')
  return `-- Contrôles du jeu de démonstration volley (lecture seule).
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

\\echo '--- Unités par niveau'
select data ->> 'levelId' niveau, count(*) from public.hb_units where not deleted group by 1 order by 1;

\\echo '--- Filles, postes, latéralité'
select round(100.0 * count(*) filter (where data ->> 'sex' = 'F') / count(*), 1) pct_filles from public.hb_players where not deleted;
select coalesce(data ->> 'position', '(sans poste)') poste, count(*), round(100.0 * count(*) / sum(count(*)) over (), 1) pct
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

\\echo '--- Groupes des pôles : membres en cours (≤ 16), sélections'
select g.data ->> 'name' groupe, (select count(*) from public.hb_players p
         where not p.deleted and exists (select 1 from jsonb_array_elements(coalesce(p.data -> 'poles', '[]')) x
                                          where x ->> 'site' = u.data ->> 'poleSite' and x ->> 'regionId' = g.data ->> 'regionId'
                                            and x ->> 'from' <= '${TODAY}' and coalesce(x ->> 'to', '9999') >= '${TODAY}')
           and p.data ->> 'sex' = u.data ->> 'poleSex') membres
  from public.hb_groups g join public.hb_units u on u.id = g.data ->> 'poleUnitId'
 where not g.deleted order by 1;
select data ->> 'name' groupe, jsonb_array_length(data -> 'playerIds') joueurs from public.hb_groups where not deleted and data ->> 'poleUnitId' is null order by 1;

\\echo '--- Tests hors des fourchettes (doit être vide)'
with bands(sex, cat, crit, lo, hi) as (values
  ${bands}),
m as (
  select m.data ->> 'criterionId' crit, (m.data ->> 'value')::numeric v, p.data ->> 'sex' sex,
         case when (case when substr(m.data ->> 'date', 6, 2)::int >= 9 then left(m.data ->> 'date', 4)::int + 1 else left(m.data ->> 'date', 4)::int end)
                   - left(p.data ->> 'birthDate', 4)::int <= 13 then 'M13'
              when (case when substr(m.data ->> 'date', 6, 2)::int >= 9 then left(m.data ->> 'date', 4)::int + 1 else left(m.data ->> 'date', 4)::int end)
                   - left(p.data ->> 'birthDate', 4)::int <= 15 then 'M15' else 'M18' end cat
    from public.hb_measurements m join public.hb_players p on p.id = m.data ->> 'playerId'
   where not m.deleted)
select m.crit, m.sex, m.cat, count(*) hors, min(v), max(v) from m join bands b using (sex, cat, crit)
 where m.v < b.lo or m.v > b.hi group by 1, 2, 3;
select m.data ->> 'criterionId' test, count(*) mesures, min((m.data ->> 'value')::numeric), round(avg((m.data ->> 'value')::numeric), 1) moyenne, max((m.data ->> 'value')::numeric)
  from public.hb_measurements m where not m.deleted group by 1 order by 1;
select n seances, count(*) joueurs from (select data ->> 'playerId' p, count(distinct data ->> 'date') n from public.hb_measurements where not deleted group by 1) x group by 1 order by 1;

\\echo '--- Avis : critères et joueurs existants, notes'
select count(*) avis, count(*) filter (where not exists (select 1 from public.hb_players p where p.id = e.data ->> 'playerId' and not p.deleted)) sans_joueur,
       count(*) filter (where not exists (select 1 from public.hb_events v where v.id = e.data ->> 'eventId' and not v.deleted)) sans_evenement
  from public.hb_evaluations e where not e.deleted;
select count(*) notes, count(*) filter (where c.id is null) critere_inconnu, round(avg(s.value::numeric), 2) moyenne,
       count(*) filter (where s.value::numeric not between 1 and 5) hors_echelle
  from public.hb_evaluations e cross join lateral jsonb_each_text(e.data -> 'scores') s(key, value)
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
  const posShare = Object.fromEntries(['R4', 'C', 'PT', 'P'].map((c) => [c, pct(withPos.filter((p) => p.pos === c).length, withPos.length)]))
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
    positions: posShare,
    noPosition: pct(players.length - withPos.length, players.length),
    leftHanded: pct(players.filter((p) => p.data.laterality === 'gaucher').length, players.length),
    quarters: { all: quarters(players), seen: quarters(players.filter((p) => seenIds.has(p.id))), poles: quarters(poleNow) },
    byYear,
    seenPlayers: pct(seenIds.size, players.length),
    measuredPlayers: pct(measuredIds.size, players.length),
    deptsLeastSeen: deptRows.filter((d) => d.n >= 60).sort((a, b) => a.seen - b.seen).slice(0, 8),
    deptsMostSeen: deptRows.filter((d) => d.n >= 60).sort((a, b) => b.seen - a.seen).slice(0, 6),
    poleSizes: seed.poles.map((x) => ({ pole: x.def.name, now: x.current.length, past: x.past.length })),
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
  }
}

// ---------- Programme ----------

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('Usage : npx jiti tools/seed-volley.ts <dossier de sortie hors du dépôt>')
    process.exit(1)
  }
  const root = resolve(fileURLToPath(import.meta.url), '../..')
  if (resolve(dir).startsWith(root)) {
    console.error('Le dossier de sortie doit être HORS du dépôt (données générées, jamais commitées).')
    process.exit(1)
  }
  const t0 = Date.now()
  const seed = buildSeed(readFileSync(join(root, 'public/demo/criteres-volley.json'), 'utf8'))
  const files = writeSql(seed, resolve(dir))
  console.log(JSON.stringify(stats(seed), null, 1))
  console.log(`\n${files.length} fichiers SQL + apply.sql, dry-run.sql, verify.sql dans ${resolve(dir)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
}
