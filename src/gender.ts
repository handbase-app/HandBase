/**
 * Accord des textes au genre (affichage seulement ; ni React ni Dexie). Test : tools/test-genre.ts.
 *
 * Règle : féminin seulement quand on est SÛR qu'on parle de filles ; sinon (garçons, mixte, inconnu) masculin générique.
 *
 *   type Gender = 'M' | 'F' | 'mixte' | undefined
 *
 *   isFem(g)                    true si g === 'F'
 *   w(g)                        formes accordées : w(g).joueurs → « joueuses », w(g).un → « une », w(g).vu → « vue »…
 *                               (liste complète : MASC ci-dessous ; même clés au féminin)
 *   accord(mot, g, n?)          accord d'un adjectif / participe / nom simple : accord('vu', 'F', 2) → « vues »,
 *                               accord('droitier', 'F') → « droitière », accord('joueur', 'F', 3) → « joueuses ».
 *                               La majuscule initiale est gardée (accord('Noté', 'F') → « Notée »).
 *   pluralG(n, g, mot?)         comme plural() de db.ts, accordé : pluralG(14, 'F') → « 14 joueuses »,
 *                               pluralG(1, 'F', 'nouvelle joueuse')… (mot au masculin : 'joueur' par défaut ;
 *                               un groupe de mots est accordé mot à mot : pluralG(2, 'F', 'joueur suivi') → « 2 joueuses suivies »)
 *   genderOf(players)           'F' si tous (au moins un) sont F, 'M' si tous M, sinon 'mixte' (vide ou inconnu → undefined)
 *   setGender(declared, players) genre d'un groupe / événement : son sexe déclaré ('M' | 'F' | 'mixte'), sinon genderOf(joueurs)
 *   lateralityPlural(l, g)      « Droitiers » / « Droitières » / « Gauchères » / « Ambidextres »
 *                               (au singulier : lateralityLabel(l, sex) de src/db.ts, déjà accordé)
 *   SEX_LABELS / SEX_LABEL_ONE  libellés du sexe (« Garçons » / « Filles » / « Mixte » ; « Garçon » / « Fille »), à lire
 *   SEX_CHOICES                 ici plutôt qu'écrits en dur : un seul endroit à changer (ex. « Masculin / Féminin »)
 */

export type Gender = 'M' | 'F' | 'mixte' | undefined

/** Libellés du sexe d'un ensemble (groupe, événement, filtre). Un seul endroit à changer (vocabulaire FFHB…). */
export const SEX_LABELS = { M: 'Garçons', F: 'Filles', mixte: 'Mixte' } as const
/** Libellé du sexe d'une personne. */
export const SEX_LABEL_ONE = { M: 'Garçon', F: 'Fille' } as const
/** Choix « Garçons / Filles / Mixte » (boutons du formulaire d'un groupe ou d'un événement), dans cet ordre. */
export const SEX_CHOICES = (['M', 'F', 'mixte'] as const).map((value) => ({ value, label: SEX_LABELS[value] }))

export const isFem = (g: Gender | string | null): boolean => g === 'F'

/** Formes au masculin (générique). Le féminin a exactement les mêmes clés. */
const MASC = {
  joueur: 'joueur',
  joueurs: 'joueurs',
  Joueur: 'Joueur',
  Joueurs: 'Joueurs',
  un: 'un',
  Un: 'Un',
  le: 'le',
  Le: 'Le',
  /** « le joueur » / « la joueuse » */
  leJoueur: 'le joueur',
  LeJoueur: 'Le joueur',
  unJoueur: 'un joueur',
  UnJoueur: 'Un joueur',
  du: 'du',
  /** « du joueur » / « de la joueuse » */
  duJoueur: 'du joueur',
  au: 'au',
  auJoueur: 'au joueur',
  ce: 'ce',
  Ce: 'Ce',
  ceJoueur: 'ce joueur',
  CeJoueur: 'Ce joueur',
  /** Pronom complément : « le suivre » / « la suivre ». */
  pronLe: 'le',
  ceux: 'ceux',
  Ceux: 'Ceux',
  aucun: 'aucun',
  Aucun: 'Aucun',
  aucunJoueur: 'aucun joueur',
  AucunJoueur: 'Aucun joueur',
  tous: 'tous',
  Tous: 'Tous',
  tousLesJoueurs: 'tous les joueurs',
  TousLesJoueurs: 'Tous les joueurs',
  nouveau: 'nouveau',
  Nouveau: 'Nouveau',
  nouveaux: 'nouveaux',
  nouveauJoueur: 'nouveau joueur',
  NouveauJoueur: 'Nouveau joueur',
  il: 'il',
  Il: 'Il',
  ils: 'ils',
  Ils: 'Ils',
  /** Accord simple au singulier (« vu » / « vue »). */
  e: '',
  /** Accord au pluriel (« vus » / « vues »). */
  es: 's',
  vu: 'vu',
  vus: 'vus',
  suivi: 'suivi',
  suivis: 'suivis',
  note: 'noté',
  notes: 'notés',
  repere: 'repéré',
  reperes: 'repérés',
  licencie: 'licencié',
  licencies: 'licenciés',
  mesure: 'mesuré',
  mesures: 'mesurés',
  inscrit: 'inscrit',
  inscrits: 'inscrits',
  convoque: 'convoqué',
  convoques: 'convoqués',
  selectionne: 'sélectionné',
  selectionnes: 'sélectionnés',
  evalue: 'évalué',
  evalues: 'évalués',
  ajoute: 'ajouté',
  ajoutes: 'ajoutés',
  retire: 'retiré',
  retires: 'retirés',
  propose: 'proposé',
  proposes: 'proposés',
  ne: 'né',
  choisi: 'choisi',
  choisis: 'choisis',
  revu: 'revu',
  revus: 'revus',
}

export type GenderWords = typeof MASC

const FEM: GenderWords = {
  joueur: 'joueuse',
  joueurs: 'joueuses',
  Joueur: 'Joueuse',
  Joueurs: 'Joueuses',
  un: 'une',
  Un: 'Une',
  le: 'la',
  Le: 'La',
  leJoueur: 'la joueuse',
  LeJoueur: 'La joueuse',
  unJoueur: 'une joueuse',
  UnJoueur: 'Une joueuse',
  du: 'de la',
  duJoueur: 'de la joueuse',
  au: 'à la',
  auJoueur: 'à la joueuse',
  ce: 'cette',
  Ce: 'Cette',
  ceJoueur: 'cette joueuse',
  CeJoueur: 'Cette joueuse',
  pronLe: 'la',
  ceux: 'celles',
  Ceux: 'Celles',
  aucun: 'aucune',
  Aucun: 'Aucune',
  aucunJoueur: 'aucune joueuse',
  AucunJoueur: 'Aucune joueuse',
  tous: 'toutes',
  Tous: 'Toutes',
  tousLesJoueurs: 'toutes les joueuses',
  TousLesJoueurs: 'Toutes les joueuses',
  nouveau: 'nouvelle',
  Nouveau: 'Nouvelle',
  nouveaux: 'nouvelles',
  nouveauJoueur: 'nouvelle joueuse',
  NouveauJoueur: 'Nouvelle joueuse',
  il: 'elle',
  Il: 'Elle',
  ils: 'elles',
  Ils: 'Elles',
  e: 'e',
  es: 'es',
  vu: 'vue',
  vus: 'vues',
  suivi: 'suivie',
  suivis: 'suivies',
  note: 'notée',
  notes: 'notées',
  repere: 'repérée',
  reperes: 'repérées',
  licencie: 'licenciée',
  licencies: 'licenciées',
  mesure: 'mesurée',
  mesures: 'mesurées',
  inscrit: 'inscrite',
  inscrits: 'inscrites',
  convoque: 'convoquée',
  convoques: 'convoquées',
  selectionne: 'sélectionnée',
  selectionnes: 'sélectionnées',
  evalue: 'évaluée',
  evalues: 'évaluées',
  ajoute: 'ajoutée',
  ajoutes: 'ajoutées',
  retire: 'retirée',
  retires: 'retirées',
  propose: 'proposée',
  proposes: 'proposées',
  ne: 'née',
  choisi: 'choisie',
  choisis: 'choisies',
  revu: 'revue',
  revus: 'revues',
}

/** Formes accordées au genre (masculin générique sauf 'F'). */
export const w = (g: Gender | string | null): GenderWords => (g === 'F' ? FEM : MASC)

/** Féminins irréguliers (au singulier, en minuscules). */
const IRREGULAR: Record<string, string> = {
  joueur: 'joueuse',
  nouveau: 'nouvelle',
  beau: 'belle',
  un: 'une',
  le: 'la',
  ce: 'cette',
  aucun: 'aucune',
  tous: 'toutes',
  tout: 'toute',
  meilleur: 'meilleure',
  observateur: 'observatrice',
  premier: 'première',
  dernier: 'dernière',
  il: 'elle',
  ils: 'elles',
  du: 'de la',
  au: 'à la',
}
/** Mots qui ne changent pas au féminin. */
const INVARIABLE = new Set([
  'de', 'des', 'les', 'la', 'à', 'en', 'et', 'ou', 'par', 'pour', 'sur', 'avec', 'sans', 'dans', 'chez', 'sous',
  'pas', 'plus', 'très', 'déjà', 'non', 'jamais', 'aussi', 'bien', 'mal', 'ne', 'encore', 'toujours', 'moins',
  'moi', 'toi', 'lui', 'eux', 'mon', 'ton', 'son', 'ma', 'ta', 'sa', 'mes', 'tes', 'ses', 'leur', 'leurs', 'nos', 'vos',
  'jeune', 'ambidextre', 'mixte',
])

const cap = (src: string, out: string) => (src[0] && src[0] !== src[0].toLowerCase() ? out[0].toUpperCase() + out.slice(1) : out)

function femOne(m: string): string {
  const l = m.toLowerCase()
  if (INVARIABLE.has(l) || !/^[a-zàâäéèêëîïôöùûüç]+$/.test(l)) return m
  if (IRREGULAR[l]) return IRREGULAR[l]
  if (l.endsWith('e')) return l
  if (l.endsWith('eur')) return l.slice(0, -1) + 'se'
  if (l.endsWith('er')) return l.slice(0, -2) + 'ère'
  if (l.endsWith('eau')) return l.slice(0, -1) + 'lle'
  if (l.endsWith('if')) return l.slice(0, -1) + 've'
  if (l.endsWith('en') || l.endsWith('on')) return l + 'ne'
  if (l.endsWith('el')) return l + 'le'
  return l + 'e'
}

function pluralOne(word: string): string {
  const l = word.toLowerCase()
  if (l === 'le' || l === 'la') return cap(word, 'les')
  if (INVARIABLE.has(l) || /[sxz]$/.test(l) || !/^[a-zàâäéèêëîïôöùûüç]+$/.test(l)) return word
  const irr: Record<string, string> = { un: 'des', une: 'des', ce: 'ces', cette: 'ces', du: 'des', au: 'aux', tout: 'tous', toute: 'toutes' }
  if (irr[l]) return cap(word, irr[l])
  if (/(eau|eu)$/.test(l)) return word + 'x'
  return word + 's'
}

/**
 * Accorde un mot ou un groupe de mots donnés au masculin singulier : genre (féminin si g === 'F') et nombre (n > 1 :
 * pluriel). accord('vu', 'F', 2) → « vues » ; accord('Joueur suivi', 'F') → « Joueuse suivie ».
 */
export function accord(masc: string, g: Gender | string | null, n = 1): string {
  return masc
    .split(' ')
    .map((m) => {
      if (!m) return m
      const f = g === 'F' ? cap(m, femOne(m)) : m
      return n > 1 ? pluralOne(f) : f
    })
    .join(' ')
}

/** Comme plural() de db.ts, accordé au genre : pluralG(14, 'F') → « 14 joueuses » ; pluralG(1, 'F', 'joueur vu') → « 1 joueuse vue ». */
export const pluralG = (n: number, g: Gender | string | null, masc = 'joueur') => `${n.toLocaleString('fr-FR')} ${accord(masc, g, n)}`

/** Genre d'un ensemble de joueurs : 'F' si tous (au moins un) sont F, 'M' si tous M, 'mixte' sinon ; undefined si vide. */
export function genderOf(players: readonly ({ sex?: string | null } | undefined | null)[]): Gender {
  const xs = players.filter(Boolean) as { sex?: string | null }[]
  if (!xs.length) return undefined
  if (xs.every((p) => p.sex === 'F')) return 'F'
  if (xs.every((p) => p.sex === 'M')) return 'M'
  return 'mixte'
}

/** Genre d'un groupe ou d'un événement : sexe déclaré s'il y en a un, sinon déduit de ses joueurs (genderOf). */
export function setGender(declared: string | null | undefined, players: readonly ({ sex?: string | null } | undefined | null)[]): Gender {
  if (declared === 'F' || declared === 'M' || declared === 'mixte') return declared
  return genderOf(players)
}

/** « Droitiers » / « Droitières », « Gauchers » / « Gauchères », « Ambidextres ». */
export function lateralityPlural(l: string | null | undefined, g: Gender | string | null): string {
  if (!l) return ''
  if (l === 'ambidextre') return 'Ambidextres'
  const base = l === 'gaucher' ? 'Gaucher' : 'Droitier'
  return accord(base, g, 2)
}
