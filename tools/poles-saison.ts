/*
 * Effectifs FICTIFS des Pôles Espoirs pour une saison (partie pure, sans base ni réseau) : partagée par tools/seed-hand.ts
 * (jeu national neuf) et tools/seed-activite-poles.ts (base existante : on part des fiches telles qu'elles sont), testée par
 * tools/test-seed-hand.ts et tools/test-seed-activite-poles.ts.
 *
 * Règles (Geoffroy, 08/11) :
 *  - les 51 sites de src/poles.ts, 12 à 20 jeunes par site, sur QUATRE classes pour tous les sites : 3e, 2de, 1re, Tle
 *    (âges scolaires 14 à 17 de src/poleSeason.ts : en 2026-2027, nés en 2012, 2011, 2010, 2009) ; les programmes
 *    (accession territoriale, nationale, excellence) ne comptent pas pour la population ;
 *  - environ 3/4 des jeunes sont entrés en 3e, 1/4 en 2de, personne plus tard : 3e et 2de sont les classes les plus
 *    nombreuses, et la date d'entrée (période de pôle, `from`) suit la classe (une Tle entrée en 3e : 2023-09-01) ;
 *  - les Tle de la saison passée sont sortis le 30 juin (motif « fin de cursus », seul motif écrit : jamais négatif) ;
 *  - jeunes du territoire du pôle (ses régions), plus souvent des départements proches du site ; un jeune proche d'un
 *    autre site du même territoire y va plutôt ; postes équilibrés (2 par poste d'abord) ; effet de l'âge relatif porté par
 *    le « mérite » donné par l'appelant.
 * Sur une base existante : une fiche modifiée par un vrai compte (`fige`) n'est jamais touchée (elle compte dans l'effectif
 * si elle est au pôle) ; les membres actuels qui conviennent restent (date d'entrée corrigée seulement si elle ne suit pas
 * la règle) ; on complète, on retire le surplus. Relancer le plan sur son propre résultat ne change rien (testé).
 */
import type { PolePeriod } from '../src/db'
import { POLE_SITES, type PoleSite } from '../src/poles'
import { OFFICIAL_REGIONS } from '../src/regionsOfficial'
import { poleCode } from '../src/structureImport'
import { fold, hash32, TOWN_LIST } from './seed-volley'

// ---------- Saison ----------

/** Saison en cours (année civile du 1er septembre) : 2026-2027. */
export const SAISON = 2026
export const RENTREE = `${SAISON}-09-01`
/** Sortie des Tle de la saison passée. */
export const SORTIE = `${SAISON}-06-30`
/** Classes du pôle (âge scolaire de src/poleSeason.ts : saison − année de naissance). */
export const CLASSES = [
  { classe: '3e', age: 14 },
  { classe: '2de', age: 15 },
  { classe: '1re', age: 16 },
  { classe: 'Tle', age: 17 },
] as const
export const anneeDeClasse = (age: number, saison = SAISON) => saison - age
/** Années de naissance des quatre classes (2012, 2011, 2010, 2009 en 2026-2027). */
export const ANNEES_POLE = CLASSES.map((c) => anneeDeClasse(c.age))
/** Année de naissance des Tle de la saison passée (sortis le 30 juin). */
export const ANNEE_SORTIS = anneeDeClasse(18)
/** Poids des classes dans un effectif (3e et 2de les plus nombreuses). */
const POIDS_CLASSE = [1.0, 1.3, 1.05, 0.85]
/**
 * Part des entrées en 3e parmi les jeunes de 2de, 1re et Tle (le reste : entrée en 2de). Avec les 3e (toutes entrées en
 * 3e), environ 3/4 des jeunes d'un pôle sont entrés en 3e.
 */
export const PART_ENTREE_3E = 2 / 3
/** Dates d'entrée possibles d'un jeune né en `annee` : en 3e ou en 2de (1er septembre). */
export const entree3e = (annee: number) => `${annee + 14}-09-01`
export const entree2de = (annee: number) => `${annee + 15}-09-01`
/** Postes : 2 par poste d'abord (gardiens : 3 au plus). */
const QUOTA_POSTE = 2

// ---------- Géographie ----------

/**
 * Département de chaque site (géographie publique) : les jeunes des départements proches y vont plus souvent ; chaque
 * département est dans les régions du pôle (testé).
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

const REGION_OF = new Map(Object.entries(OFFICIAL_REGIONS).flatMap(([r, ds]) => ds.split(' ').map((d) => [d, r] as const)))
/** Région (identifiant de la liste) d'un département ; Corse : « 20 », « 2A », « 2B ». */
export const regionOfDept = (d: string | undefined | null) => (d ? REGION_OF.get(d) : undefined)

/** Centre (moyenne pondérée par la population des villes connues) de chaque département ; Corse « 20 » : 2A + 2B. */
const CENTRES = (() => {
  const acc = new Map<string, { lat: number; lng: number; w: number }>()
  const add = (k: string, lat: number, lng: number, w: number) => {
    const c = acc.get(k) ?? { lat: 0, lng: 0, w: 0 }
    acc.set(k, { lat: c.lat + lat * w, lng: c.lng + lng * w, w: c.w + w })
  }
  for (const t of TOWN_LIST) {
    const w = Math.max(1, t.pop)
    add(t.dept, t.lat, t.lng, w)
    if (t.dept === '2A' || t.dept === '2B') add('20', t.lat, t.lng, w)
  }
  return new Map([...acc].map(([k, c]) => [k, { lat: c.lat / c.w, lng: c.lng / c.w }]))
})()
/** Distance (km) entre les centres de deux départements ; inconnue : 400 km. */
export function deptKm(a: string, b: string): number {
  if (a === b) return 0
  const x = CENTRES.get(a)
  const y = CENTRES.get(b)
  if (!x || !y) return 400
  const r = Math.PI / 180
  const h = Math.sin(((y.lat - x.lat) * r) / 2) ** 2 + Math.cos(x.lat * r) * Math.cos(y.lat * r) * Math.sin(((y.lng - x.lng) * r) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// ---------- Candidats et plan ----------

/** Un jeune qui pourrait être au pôle (fiche existante ou générée). */
export interface Candidat {
  id: string
  sexe: 'M' | 'F'
  annee: number
  /** Département (n° de club) et région du club. */
  dept: string
  region?: string
  poste?: string
  /** Club (n°), pour les comptes. */
  club?: string
  /** Mérite (talent, gabarit, âge relatif…) : plus haut = plus souvent choisi. */
  merite: number
  /** Périodes de pôle actuelles de la fiche. */
  poles?: PolePeriod[]
  /** Fiche modifiée par un vrai compte : jamais touchée. */
  fige?: boolean
  /** Traces d'un vrai compte (tests du pôle saisis, listes de ses événements de la saison) : on la garde de préférence. */
  testsReels?: number
  /** Internat (fiche). */
  boarding?: boolean
}

export const siteKey = (s: PoleSite) => poleCode(s)
/** Le site d'une période (même ville, comparée sans accents ni majuscules ; même sexe que la fiche). */
const memeSite = (x: PolePeriod, s: PoleSite) => fold(x.site ?? '') === fold(s.site)
const couvre = (x: PolePeriod, jour: string) => (!x.from || x.from <= jour) && (!x.to || x.to >= jour)

/** Effectif visé d'un site : 12 à 20 (outre-mer 12 à 15), stable. */
export function tailleSite(s: PoleSite): number {
  const om = s.regions.some((r) => r === 'region-ant' || r === 'region-reu')
  const u = hash32(`taille:${siteKey(s)}`) / 2 ** 32
  if (om) return 12 + Math.floor(u * 4)
  const n = 14 + Math.floor(u * 6) + (s.levels.length >= 2 ? 1 : 0)
  return Math.max(12, Math.min(20, n))
}

/** Effectif visé de chaque classe (3e, 2de, 1re, Tle) pour un effectif de n (plus forts restes). */
export function ciblesClasses(n: number): number[] {
  const tot = POIDS_CLASSE.reduce((a, b) => a + b, 0)
  const raw = POIDS_CLASSE.map((w) => (w * n) / tot)
  const out = raw.map(Math.floor)
  const order = raw.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (let k = 0; out.reduce((a, b) => a + b, 0) < n; k++) out[order[k % 4][1]]++
  return out
}

/** Tirage stable dans [0, 1[ pour une clé. */
const u01 = (...k: (string | number)[]) => hash32(k.join(':')) / 2 ** 32

/** Date d'entrée d'un membre : la sienne si elle suit la règle, sinon 3e (2/3) ou 2de (1/3) ; 3e : la rentrée. */
export function dateEntree(c: Pick<Candidat, 'id' | 'annee'>, actuelle?: string): string {
  if (c.annee === anneeDeClasse(14)) return entree3e(c.annee)
  if (actuelle === entree3e(c.annee) || actuelle === entree2de(c.annee)) return actuelle
  return u01('entree', c.id) < PART_ENTREE_3E ? entree3e(c.annee) : entree2de(c.annee)
}

export interface SitePlan {
  site: PoleSite
  key: string
  taille: number
  cibles: number[]
  /** Au pôle cette saison (fiches figées comprises). */
  membres: Candidat[]
  /** Tle de la saison passée, sortis le 30 juin. */
  sortis: Candidat[]
}
/** Ce qu'il faut écrire sur une fiche : ses nouvelles périodes (null : plus de pôle) et l'internat. */
export interface Ecriture {
  poles: PolePeriod[] | null
  boarding?: boolean
}
export interface Plan {
  sites: SitePlan[]
  /** Fiches à écrire (jamais une fiche figée ; seulement si quelque chose change). */
  ecritures: Map<string, Ecriture>
}

/**
 * Effectifs de la saison sur les 51 sites (ou `sites`) à partir des candidats. `jour` : date de référence (membre actuel =
 * période qui couvre ce jour sur le site).
 */
export function planifierPoles(candidats: readonly Candidat[], opts: { jour: string; sites?: readonly PoleSite[] }): Plan {
  const sites = opts.sites ?? POLE_SITES
  const regionOf = (c: Candidat) => c.region ?? regionOfDept(c.dept)
  // Membre actuel de quel site ?
  const actuelDe = new Map<string, string>()
  for (const c of candidats)
    for (const s of sites) if (s.sex === c.sexe && (c.poles ?? []).some((x) => memeSite(x, s) && couvre(x, opts.jour))) actuelDe.set(c.id, siteKey(s))
  // Site le plus proche de chaque jeune parmi ceux de son territoire (même sexe).
  const plusProche = (c: Candidat) => {
    let best: string | undefined
    let bd = Infinity
    for (const s of sites) {
      if (s.sex !== c.sexe || !s.regions.includes(regionOf(c) ?? '')) continue
      const d = deptKm(c.dept, SITE_DEPT[s.site] ?? '')
      if (d < bd) [bd, best] = [d, siteKey(s)]
    }
    return best
  }
  const proche = new Map(candidats.map((c) => [c.id, plusProche(c)]))
  const pris = new Set<string>()
  // Sites aux viviers les plus petits d'abord (outre-mer, petites ligues), puis l'ordre de src/poles.ts.
  const vivier = (s: PoleSite) => candidats.filter((c) => c.sexe === s.sex && s.regions.includes(regionOf(c) ?? '')).length
  const ordre = sites.map((s, i) => ({ s, i, v: vivier(s) })).sort((a, b) => a.v - b.v || a.i - b.i)
  const plans: SitePlan[] = []
  for (const { s } of ordre) {
    const key = siteKey(s)
    const dept = SITE_DEPT[s.site] ?? ''
    const taille = tailleSite(s)
    const cibles = ciblesClasses(taille)
    const classeDe = (c: Candidat) => ANNEES_POLE.indexOf(c.annee)
    const membres: Candidat[] = []
    const compte = [0, 0, 0, 0]
    const postes = new Map<string, number>()
    const ajouter = (c: Candidat) => {
      membres.push(c)
      pris.add(c.id)
      const k = classeDe(c)
      if (k >= 0) compte[k]++
      if (c.poste) postes.set(c.poste, (postes.get(c.poste) ?? 0) + 1)
    }
    const ici = candidats.filter((c) => actuelDe.get(c.id) === key)
    // 1. Fiches figées au pôle : elles y restent, telles quelles.
    for (const c of ici) if (c.fige) ajouter(c)
    // 2. Membres actuels qui conviennent (bonne année, club du territoire ; 3 gardiens, 5 par poste au plus) : gardés, ceux
    //    qui ont des tests saisis d'abord.
    const garder = ici
      .filter((c) => !c.fige && classeDe(c) >= 0 && s.regions.includes(regionOf(c) ?? ''))
      .sort((a, b) => b.merite + (b.testsReels ? 2 : 0) - (a.merite + (a.testsReels ? 2 : 0)) || a.id.localeCompare(b.id))
    const plein = (p?: string) => (postes.get(p ?? '') ?? 0) >= (p === 'GB' ? 3 : 5)
    for (const c of garder) if (compte[classeDe(c)] < cibles[classeDe(c)] && !plein(c.poste)) ajouter(c)
    // Ceux dont un vrai compte a saisi les tests du pôle ou qu'il a mis dans un événement de la saison restent même si leur
    // classe est pleine (2 de plus par classe, 20 au plus en tout, 3e et 2de restent les classes les plus nombreuses) : leurs
    // tests et leurs stages ne deviennent pas ceux d'un jeune hors du pôle.
    const manqueTotal = () => cibles.reduce((t, x, k) => t + Math.max(0, x - compte[k]), 0)
    for (const c of garder) {
      const k = classeDe(c)
      if (pris.has(c.id) || !c.testsReels || plein(c.poste) || membres.length + manqueTotal() >= 20 || compte[k] >= cibles[k] + 2) continue
      if (k <= 1 || compte[k] + 1 <= Math.max(compte[0], compte[1], cibles[0], cibles[1])) ajouter(c)
    }
    // 3. On complète : la classe la plus en manque d'abord, puis le meilleur jeune (proche du site, poste qui manque).
    const vivierSite = candidats.filter(
      (c) => !c.fige && !pris.has(c.id) && !actuelDe.has(c.id) && c.sexe === s.sex && c.poste && classeDe(c) >= 0 && s.regions.includes(regionOf(c) ?? ''),
    )
    const base = new Map(
      vivierSite.map((c) => {
        const d = deptKm(c.dept, dept)
        return [c.id, c.merite + 0.9 * Math.exp(-d / 200) + (c.dept === dept ? 0.15 : 0) - (proche.get(c.id) === key ? 0 : 0.6)] as const
      }),
    )
    const bonusPoste = (p?: string) => {
      const n = postes.get(p ?? '') ?? 0
      if (p === 'GB' && n >= 3) return -3
      return n < QUOTA_POSTE ? 1.2 : n < QUOTA_POSTE + 1 ? 0.15 : -0.5
    }
    for (;;) {
      const manque = cibles.map((t, k) => ({ k, m: t - compte[k] })).filter((x) => x.m > 0)
      if (!manque.length) break
      let pick: Candidat | undefined
      for (const { k } of manque.sort((a, b) => b.m - a.m || a.k - b.k)) {
        let bv = -Infinity
        for (const c of vivierSite) {
          if (pris.has(c.id) || c.annee !== ANNEES_POLE[k]) continue
          const v = base.get(c.id)! + bonusPoste(c.poste)
          if (v > bv || (v === bv && pick && c.id < pick.id)) [bv, pick] = [v, c]
        }
        if (pick) break
      }
      if (!pick) break
      ajouter(pick)
    }
    // 4. Sortis le 30 juin (Tle de la saison passée) : 2 à 4, ceux qui étaient déjà passés par ce site d'abord.
    const nSortis = 2 + Math.floor(u01('sortis', key) * 3)
    const dejaLa = candidats
      .filter((c) => !c.fige && !pris.has(c.id) && c.sexe === s.sex && c.annee === ANNEE_SORTIS && (c.poles ?? []).some((x) => memeSite(x, s)))
      .sort((a, b) => b.merite - a.merite || a.id.localeCompare(b.id))
    const sortis = dejaLa.slice(0, nSortis)
    if (sortis.length < nSortis) {
      const autres = candidats
        .filter((c) => !c.fige && !pris.has(c.id) && !sortis.includes(c) && !(c.poles ?? []).length && c.sexe === s.sex && c.poste && c.annee === ANNEE_SORTIS && s.regions.includes(regionOf(c) ?? ''))
        .map((c) => ({ c, v: c.merite + 0.9 * Math.exp(-deptKm(c.dept, dept) / 200) - (proche.get(c.id) === key ? 0 : 0.6) }))
        .sort((a, b) => b.v - a.v || a.c.id.localeCompare(b.c.id))
      sortis.push(...autres.slice(0, nSortis - sortis.length).map((x) => x.c))
    }
    for (const c of sortis) pris.add(c.id)
    plans.push({ site: s, key, taille, cibles, membres, sortis })
  }
  // Écritures : périodes de chaque membre et sorti ; les autres fiches non figées qui avaient un pôle n'en ont plus.
  const ecritures = new Map<string, Ecriture>()
  // Comparaison sans l'ordre des clés (la base range les clés d'un jsonb à sa façon).
  const canon = (x: unknown): string =>
    Array.isArray(x) ? `[${x.map(canon).join(',')}]` : x && typeof x === 'object' ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon((x as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(x ?? null)
  const ecrire = (c: Candidat, poles: PolePeriod[] | null, boarding?: boolean) => {
    if (c.fige) return
    const internat = poles ? (c.boarding ?? boarding) : undefined
    if (canon(c.poles?.length ? c.poles : null) === canon(poles) && (internat === undefined || c.boarding === internat)) return
    ecritures.set(c.id, { poles, ...(internat !== undefined ? { boarding: internat } : {}) })
  }
  const internat = (c: Candidat) => u01('internat', c.id) < 0.75
  for (const p of plans) {
    const regionId = p.site.regions[0]
    for (const c of p.membres) {
      if (c.fige) continue
      const actuelle = (c.poles ?? []).find((x) => memeSite(x, p.site) && couvre(x, opts.jour))?.from
      ecrire(c, [{ regionId, site: p.site.site, from: dateEntree(c, actuelle) }], internat(c))
    }
    for (const c of p.sortis) {
      const avant = (c.poles ?? []).find((x) => memeSite(x, p.site))?.from
      const from = avant === entree3e(c.annee) || avant === entree2de(c.annee) ? avant : u01('entree', c.id) < PART_ENTREE_3E ? entree3e(c.annee) : entree2de(c.annee)
      ecrire(c, [{ regionId, site: p.site.site, from, to: SORTIE, exitReason: 'fin_cursus' }], internat(c))
    }
  }
  for (const c of candidats) if (!pris.has(c.id) && !c.fige && (c.poles ?? []).length) ecrire(c, null)
  // Ordre de src/poles.ts dans le résultat.
  plans.sort((a, b) => sites.indexOf(a.site) - sites.indexOf(b.site))
  return { sites: plans, ecritures }
}

/** Applique un plan aux candidats (copie) : ce que seraient les fiches après écriture (essais, relance du plan). */
export function appliquerPlan(candidats: readonly Candidat[], plan: Plan): Candidat[] {
  return candidats.map((c) => {
    const e = plan.ecritures.get(c.id)
    if (!e) return c
    return { ...c, poles: e.poles ?? undefined, ...(e.boarding !== undefined ? { boarding: e.boarding } : {}) }
  })
}
