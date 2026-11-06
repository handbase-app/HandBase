// Nextar, serveur MCP : TRAÇABILITÉ DE L'ACTIVITÉ DU STAFF (administrateurs, LECTURE SEULE, fonctions PURES comme admin.ts) :
//  - nextar_admin_journal   journal horodaté des actions du staff (créations, modifications, suppressions de l'historique,
//                           ouvertures de l'appli), regroupé en sessions (actions d'un compte à moins de 15 min) ou ligne à ligne ;
//  - nextar_admin_saisies   ce qu'un compte a créé : mesures par test (nombre, joueurs, min / max / moyenne, événements,
//                           heures, provenance), avis par critère (notes chiffrées ; jamais un commentaire), détail en codes ;
//  - nextar_admin_lots      créations en masse : lots (import, proposition validée, génération), auteur, heures, volumes ;
//  - nextar_admin_activite  (admin.ts) s'appuie sur agregerTraces et construireActivite d'ici pour la période calendaire,
//                           l'histogramme par jour / heure et la ventilation par provenance.
// PROVENANCE (supabase/071_provenance.sql) : saisie_appli | import_fichier | proposition_validee | generation, déduite des
// lignes SANS LES RÉÉCRIRE, par les mêmes règles que hb_provenance / hb_lot_de / hb_cree_le (tools/test-mcp.ts les compare) :
// les outils marchent AVANT 071 (lignes lues par pages, bornées, agrégées ici) et mieux après (agrégats dans la base).
// La GÉNÉRATION (démos, jeux d'essai) est exclue par défaut ; montrée, elle a un auteur symbolique « Générateur démo » (aucun
// compte n'est créé), avec les comptes sous lesquels ses lignes ont été posées.
// Règles (les mêmes que admin.ts) : le rôle d'abord (refus sans rien lire), joueurs en codes J-…, comptes du staff en C-… +
// nom affiché + rôle (comptes joueurs exclus), jamais de nom de joueur, de mail, de téléphone, d'IP ni d'identifiant technique
// de compte ; heures en ISO UTC plus un champ lisible à l'heure de Paris ; liste blanche par outil (outils.ts, CLES_ADMIN).
// Fichier sans import Deno (testable avec npx jiti, tools/test-mcp.ts).

import { codeJoueur } from './partage/codesJoueurs.ts'
import {
  BORNES,
  borne,
  clip,
  codeCompte,
  critere,
  ROLE_LIBELLE,
  SANS_NOM,
  SANS_ROLE,
  sansCoordonnees,
  trouverParNom,
  typeAppareil,
  uniq,
  type AgregatSrv,
  type CritereSrv,
  type EvenementSrv,
  type ProfilSrv,
  type Provenance,
  type Reglages,
  type SaisieResumeSrv,
  type SessionSrv,
  type Source,
  type TraceSrv,
  type TypeTrace,
} from './outils.ts'

export const REFUS_ADMIN_TRACES = 'Réservé aux administrateurs : ce compte ne peut pas utiliser cet outil.'
export const INDISPONIBLE_071 = 'indisponible tant que supabase/071_provenance.sql n’est pas appliqué'
const MIN = 60_000
const HEURE = 3_600_000
const JOUR = 86_400_000
/** Deux actions d'un même compte à moins de 15 minutes : même session. */
export const ECART_SESSION = 15 * MIN

export const TYPES: TypeTrace[] = ['mesure', 'avis', 'evenement', 'vu', 'fiche']
export const PROVENANCES: Provenance[] = ['saisie_appli', 'import_fichier', 'proposition_validee', 'generation']
/** Tables de l'historique (hb_audit.table_name) → type. */
export const TABLE_TYPE: Record<string, TypeTrace> = { measurements: 'mesure', evaluations: 'avis', events: 'evenement', seen: 'vu', players: 'fiche' }
/** Signature de hb_stamp (004) pour une écriture sans compte. */
export const SIGNATURE_SQL = 'Administration Supabase (SQL)'

/** Auteur symbolique de la génération (aucun compte d'authentification). */
export const GENERATEUR = { compte: 'générateur', nom_affiche: 'Générateur démo', role: 'Génération (aucun compte)' } as const

/** Descriptions des lots reconnus sans table (avant 071, ou lot absent de hb_lots). */
export const LOTS_CONNUS: Record<string, string> = {
  'demo-progression': 'Progression fictive des groupes Pôle (générateur hors dépôt) : identifiants demo-prog-…, createdAtServer antidaté.',
  'demo-bilan': '« Vus » fictifs du Bilan de détection (supabase/maintenance/demo_bilan_reperage.sql).',
  'demo-rencontres': 'Rencontres fictives d’« Autour de moi » (tools/seed-rencontres.ts).',
  'demo-appli': 'Démo chargée depuis l’appli (identifiants demo-…).',
  'sql-sans-compte': 'Lignes écrites par SQL sans compte (jeux d’essai, imports techniques).',
}

// ---------- Provenance, lot, heure de création (mêmes règles que supabase/071_provenance.sql) ----------

/** hb_provenance(id, data). */
export function provenance(t: TraceSrv): Provenance {
  if (t.marque && (PROVENANCES as string[]).includes(t.marque)) return t.marque as Provenance
  if (t.id.startsWith('demo-') || t.id.startsWith('demo:') || t.marque === 'demo' || t.marque === 'demo-progression' || t.demoBilan || (!t.auteur && t.sql))
    return 'generation'
  if (t.importe) return t.type === 'avis' ? 'proposition_validee' : 'import_fichier'
  return 'saisie_appli'
}

const LOT_VALIDE = /^[A-Za-z0-9_.:-]{1,80}$/
/** hb_lot_de(id, data). */
export function lotDe(t: TraceSrv): string | null {
  if (t.lot && LOT_VALIDE.test(t.lot)) return t.lot
  if (t.id.startsWith('demo-prog-') || t.marque === 'demo-progression') return 'demo-progression'
  if (t.demoBilan) return 'demo-bilan'
  if (t.id.startsWith('demo:')) return 'demo-rencontres'
  if (t.id.startsWith('demo-')) return 'demo-appli'
  if (!t.auteur && t.sql) return 'sql-sans-compte'
  return null
}

const ms = (s?: string | null) => {
  const t = s ? Date.parse(s) : NaN
  return Number.isFinite(t) ? t : undefined
}
/** hb_cree_le(id, data, server_updated_at) : génération → heure réelle d'écriture ; sinon createdAtServer, borné par elle. */
export function creeLe(t: TraceSrv): number {
  const ecrit = ms(t.ecrit) ?? 0
  if (provenance(t) === 'generation') return ecrit
  const c = t.creeServeur && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t.creeServeur) ? ms(t.creeServeur.replace(' ', 'T')) : undefined
  return c === undefined ? ecrit : Math.min(c, ecrit)
}

// ---------- Heures (ISO UTC + Paris) ----------

const FMT_PARIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const PARTS_PARIS = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const iso = (t: number) => new Date(t).toISOString()
/** « 05/11/2026 08:40 » (heure de Paris). */
export const paris = (t: number) => FMT_PARIS.format(new Date(t)).replace(',', '')
function murParis(t: number) {
  const p = Object.fromEntries(PARTS_PARIS.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second }
}
const decalage = (t: number) => {
  const w = murParis(t)
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000
}
/** Minuit à Paris ce jour-là (ms). */
export const minuitParis = (y: number, m: number, d: number) => {
  const u = Date.UTC(y, m - 1, d)
  return u - decalage(u)
}
/** Début de la tranche (jour ou heure de Paris) ; les décalages de Paris sont des heures entières. */
export function trancheDe(t: number, par: 'jour' | 'heure'): number {
  if (par === 'heure') return Math.floor(t / HEURE) * HEURE
  const w = murParis(t)
  return minuitParis(w.y, w.m, w.d)
}
const libelleTranche = (t: number, par: 'jour' | 'heure') => (par === 'jour' ? paris(t).slice(0, 10) : `${paris(t).slice(0, 13)} h`)

/** « 2026-11-05 » (minuit à Paris), « 2026-11-05T08:00:00Z », « 2026-11-05T08:00 » (heure de Paris) → ms ; vide : undefined. */
export function lireInstant(s: unknown): number | undefined | 'invalide' {
  if (s === undefined || s === null || s === '') return undefined
  if (typeof s !== 'string') return 'invalide'
  const j = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (j) return minuitParis(+j[1], +j[2], +j[3])
  const h = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(s)
  if (!h) return 'invalide'
  if (h[7]) {
    const t = Date.parse(s.replace(' ', 'T'))
    return Number.isFinite(t) ? t : 'invalide'
  }
  const u = Date.UTC(+h[1], +h[2] - 1, +h[3], +h[4], +h[5], +(h[6] ?? 0))
  return u - decalage(u)
}

/** Période [depuis, jusqua[ : défaut `defaut` ms avant maintenant ; au plus `maxJours` (sinon le début est avancé). */
export function lirePeriode(
  input: { depuis?: string; jusqu_a?: string },
  maintenant: number,
  defaut: number,
  maxJours: number,
): { depuis: number; jusqua: number; avertissements: string[] } | { erreur: string } {
  const d = lireInstant(input.depuis)
  const f = lireInstant(input.jusqu_a)
  if (d === 'invalide' || f === 'invalide') return { erreur: 'Date illisible : écrire AAAA-MM-JJ (minuit à Paris) ou une heure ISO (« 2026-11-05T08:00:00Z »).' }
  const jusqua = f ?? maintenant
  let depuis = d ?? jusqua - defaut
  if (depuis >= jusqua) return { erreur: 'Période vide : « depuis » doit être avant « jusqu_a ».' }
  const avertissements: string[] = []
  if (jusqua - depuis > maxJours * JOUR) {
    depuis = jusqua - maxJours * JOUR
    avertissements.push(`Période ramenée à ${maxJours} jours (depuis ${iso(depuis)}).`)
  }
  return { depuis, jusqua, avertissements }
}

export const champsPeriode = (p: { depuis: number; jusqua: number }) => ({ depuis: iso(p.depuis), depuis_paris: paris(p.depuis), jusqu_a: iso(p.jusqua), jusqu_a_paris: paris(p.jusqua) })

// ---------- Comptes ----------

const nomAffiche = (p?: ProfilSrv | null) => sansCoordonnees(p?.fullName, 80) || SANS_NOM
const libelleRole = (r?: string | null) => (r && ROLE_LIBELLE[r]) || SANS_ROLE
export const refStaff = (p: ProfilSrv) => ({ compte: codeCompte(p.userId), nom_affiche: nomAffiche(p), role: libelleRole(p.role) })

/** « C-… » (ou « générateur ») → le compte ; inconnu : erreur. */
export function resoudreCompte(code: unknown, profils: readonly ProfilSrv[]): { generateur: true } | { profil: ProfilSrv } | { erreur: string } | null {
  if (code === undefined || code === null || code === '') return null
  const c = String(code).trim()
  if (/^g[ée]n[ée]rat(eur|ion)/i.test(c)) return { generateur: true }
  const p = profils.find((x) => codeCompte(x.userId).toUpperCase() === c.toUpperCase())
  return p ? { profil: p } : { erreur: `Compte « ${clip(c, 20)} » inconnu : codes C-… de nextar_admin_activite ou nextar_connexions.` }
}

// ---------- Agrégats (comme hb_admin_creations, 071) ----------

/** Lignes créées dans [depuis, jusqua[, génération comprise ou non, regroupées comme hb_admin_creations. */
export function agregerTraces(traces: readonly TraceSrv[], f: { depuis: number; jusqua: number; generation: boolean; par: 'total' | 'jour' | 'heure' | 'lot' }): AgregatSrv[] {
  const m = new Map<string, AgregatSrv & { js: Set<string> }>()
  for (const t of traces) {
    if (t.supprime) continue
    const at = creeLe(t)
    if (at < f.depuis || at >= f.jusqua) continue
    const s = provenance(t)
    if (!f.generation && s === 'generation') continue
    const lot = f.par === 'lot' ? lotDe(t) : null
    const tranche = f.par === 'jour' || f.par === 'heure' ? iso(trancheDe(at, f.par)) : null
    const k = [t.type, t.auteur ?? '', s, lot ?? '', tranche ?? ''].join('|')
    let a = m.get(k)
    if (!a) {
      a = { type: t.type, auteur: t.auteur ?? null, source: s, lot, tranche, nb: 0, joueurs: 0, premier: iso(at), dernier: iso(at), js: new Set(), declareMin: null, declareMax: null }
      m.set(k, a)
    }
    a.nb++
    if (t.joueur) a.js.add(t.joueur)
    if (iso(at) < a.premier) a.premier = iso(at)
    if (iso(at) > a.dernier) a.dernier = iso(at)
    if (f.par === 'lot' && t.creeServeur) {
      if (!a.declareMin || t.creeServeur < a.declareMin) a.declareMin = t.creeServeur
      if (!a.declareMax || t.creeServeur > a.declareMax) a.declareMax = t.creeServeur
    }
  }
  return [...m.values()].map(({ js, ...a }) => ({ ...a, joueurs: js.size }))
}

/** Événements d'une mesure : même jour, joueur inscrit (une mesure n'a pas d'événement à elle) ; avis, « vu » : le leur. */
export function evenementsDe(t: TraceSrv, evs: readonly EvenementSrv[]): EvenementSrv[] {
  if (t.evenement) return evs.filter((e) => e.id === t.evenement)
  if (t.type !== 'mesure' || !t.date || !t.joueur) return []
  return evs.filter((e) => e.date === t.date && (e.playerIds ?? []).includes(t.joueur!))
}

const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v) ? +v.trim().replace(',', '.') : null)
const arrondi = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d

/** Comme hb_admin_saisies (071) : mesures par test, avis par critère (notes chiffrées), sur des lignes déjà filtrées. */
export function resumerSaisies(traces: readonly TraceSrv[], evs: readonly EvenementSrv[]): SaisieResumeSrv[] {
  type Acc = { nb: number; js: Set<string>; vals: number[]; texte: number; premier: number; dernier: number; s: Set<string>; e: Set<string> }
  const acc = new Map<string, Acc>()
  const prendre = (k: string) => {
    let a = acc.get(k)
    if (!a) acc.set(k, (a = { nb: 0, js: new Set(), vals: [], texte: 0, premier: Infinity, dernier: -Infinity, s: new Set(), e: new Set() }))
    return a
  }
  for (const t of traces) {
    const at = creeLe(t)
    const s = provenance(t)
    if (t.type === 'mesure' && t.test) {
      const a = prendre(`mesure|${t.test}`)
      a.nb++
      if (t.joueur) a.js.add(t.joueur)
      const v = nombre(t.valeur)
      if (v === null) a.texte++
      else a.vals.push(v)
      a.premier = Math.min(a.premier, at)
      a.dernier = Math.max(a.dernier, at)
      a.s.add(s)
      for (const e of evenementsDe(t, evs)) a.e.add(e.id)
    } else if (t.type === 'avis' && t.scores) {
      for (const [k, v] of Object.entries(t.scores)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue
        const a = prendre(`avis|${k}`)
        a.nb++
        if (t.joueur) a.js.add(t.joueur)
        a.vals.push(v)
        a.premier = Math.min(a.premier, at)
        a.dernier = Math.max(a.dernier, at)
        a.s.add(s)
        if (t.evenement) a.e.add(t.evenement)
      }
    }
  }
  return [...acc].map(([k, a]) => {
    const [type, cle] = k.split('|') as ['mesure' | 'avis', string]
    return {
      type,
      cle,
      nb: a.nb,
      joueurs: a.js.size,
      min: a.vals.length ? Math.min(...a.vals) : null,
      max: a.vals.length ? Math.max(...a.vals) : null,
      moyenne: a.vals.length ? arrondi(a.vals.reduce((x, y) => x + y, 0) / a.vals.length) : null,
      premier: iso(a.premier),
      dernier: iso(a.dernier),
      sources: [...a.s].sort(),
      evenements: [...a.e].sort(),
      valeursTexte: a.texte,
    }
  })
}

// ---------- Petits outils ----------

/** Catalogue des événements (nom, date, joueurs) : ceux de nextar_contexte, plus ceux demandés par identifiant. */
async function catalogue(src: Source, ids: Iterable<string>): Promise<EvenementSrv[]> {
  const evs = await src.evenements({ archives: true })
  const connus = new Set(evs.map((e) => e.id))
  const manquants = uniq([...ids].filter((id) => id && !connus.has(id))).slice(0, 2000)
  return manquants.length ? [...evs, ...(await src.evenementsParIds(manquants))] : evs
}
const nomEvenement = (e: EvenementSrv) => sansCoordonnees(e.name, 80) || 'Événement'
const libelleTest = (id: string, crits: readonly CritereSrv[]) => {
  const c = crits.find((x) => x.id === id)
  return c ? sansCoordonnees(c.label, 60) || id : clip(id, 60)
}
const lotSur = (s: string | null | undefined) => (s && LOT_VALIDE.test(s) ? s : undefined)
/** Clés des nombres par type (au pluriel : « fiche » est une clé interdite des réponses, outils.ts). */
export const PLURIEL: Record<string, string> = { mesure: 'mesures', avis: 'avis', evenement: 'evenements', vu: 'vus', fiche: 'fiches', connexion: 'connexions', rencontre: 'rencontres' }
const parType = (xs: readonly { type: string }[]) => {
  const o: Record<string, number> = {}
  for (const x of xs) o[PLURIEL[x.type] ?? x.type] = (o[PLURIEL[x.type] ?? x.type] ?? 0) + 1
  return o
}
const ACTION_CLE: Record<string, string> = { création: 'creation', modification: 'modification', suppression: 'suppression', restauration: 'restauration', 'suppression définitive': 'suppression' }

/** Lecture des lignes créées : plusieurs types, au plus `max` par type ; tronque si un type l'est. */
async function lireTraces(src: Source, f: { depuis: number; jusqua: number; auteur?: string | null; types: TypeTrace[]; generation: boolean }, max: number) {
  return src.traces({ depuis: iso(f.depuis), jusqua: iso(f.jusqua), auteur: f.auteur ?? null, types: f.types, generation: f.generation ? 'avec' : 'sans' }, max)
}

// ---------- nextar_admin_journal ----------

export interface JournalInput {
  compte?: string
  depuis?: string
  jusqu_a?: string
  types?: string[]
  regrouper?: boolean
  inclure_generation?: boolean
  limite?: number
}

type Evt = { t: number; userId: string | null; action: string; type: TypeTrace | 'connexion'; trace?: TraceSrv; session?: SessionSrv; historique: boolean }

export async function outilAdminJournal(src: Source, reg: Reglages, input: JournalInput = {}) {
  if (!(await src.estAdmin())) return { erreur: REFUS_ADMIN_TRACES }
  const maintenant = reg.maintenant ?? Date.now()
  const per = lirePeriode(input, maintenant, JOUR, BORNES.journalJoursMax)
  if ('erreur' in per) return { erreur: per.erreur }
  const limite = borne(input.limite, BORNES.journalDefaut, 1, BORNES.journalLimiteMax)
  const regrouper = input.regrouper !== false
  const generation = input.inclure_generation === true
  const voulus = (input.types ?? []).filter((x): x is TypeTrace | 'connexion' => [...TYPES, 'connexion'].includes(x))
  const types = voulus.length ? uniq(voulus) : [...TYPES, 'connexion' as const]
  const typesDonnees = types.filter((x): x is TypeTrace => x !== 'connexion')
  const profilsL = await src.profils()
  const staff = new Map(profilsL.filter((p) => p.role !== 'joueur').map((p) => [p.userId, p]))
  const cible = resoudreCompte(input.compte, profilsL)
  if (cible && 'erreur' in cible) return { erreur: cible.erreur }
  if (cible && 'generateur' in cible && !generation) return { erreur: 'Le « Générateur démo » n’apparaît qu’avec inclure_generation: true.' }
  const userId = cible && 'profil' in cible ? cible.profil.userId : null
  const avertissements = [...per.avertissements]
  const depuis = iso(per.depuis)
  const jusqua = iso(per.jusqua)

  const [acts, gen, cx] = await Promise.all([
    typesDonnees.length && !(cible && 'generateur' in cible) ? src.actions({ depuis, jusqua, auteur: userId }, BORNES.journalActions) : Promise.resolve({ lignes: [], tronque: false }),
    // Génération : écrite déclencheurs coupés, absente de l'historique ; lue dans les tables.
    generation && typesDonnees.length && !userId ? lireTraces(src, { ...per, types: typesDonnees, generation: true }, BORNES.journalActions) : Promise.resolve({ lignes: [], tronque: false }),
    types.includes('connexion') || regrouper ? src.connexions(iso(per.depuis - HEURE), BORNES.connexionsSessions) : Promise.resolve({ sessions: [], tronque: false }),
  ])
  if (acts.tronque) avertissements.push(`Plus de ${BORNES.journalActions} écritures à l’historique sur la période : seules les plus récentes sont lues. Réduis la période ou choisis un compte.`)
  if (gen.tronque) avertissements.push(`Génération : plus de ${BORNES.journalActions} lignes par type ; seules les plus récentes sont lues.`)
  // Détails des lignes de l'historique (provenance, lot, joueur, test, événement), type par type.
  const parTypeIds = new Map<TypeTrace, string[]>()
  for (const a of acts.lignes) {
    const ty = TABLE_TYPE[a.table]
    if (!ty || !typesDonnees.includes(ty)) continue
    parTypeIds.set(ty, [...(parTypeIds.get(ty) ?? []), a.rowId])
  }
  const details = new Map<string, TraceSrv>()
  for (const [ty, ids] of parTypeIds) for (const t of await src.tracesParIds(ty, uniq(ids))) details.set(`${ty}|${t.id}`, t)
  const evts: Evt[] = []
  const vusCreation = new Set<string>()
  for (const a of acts.lignes) {
    const ty = TABLE_TYPE[a.table]
    if (!ty || !typesDonnees.includes(ty)) continue
    const t = details.get(`${ty}|${a.rowId}`)
    const at = ms(a.at)
    if (at === undefined || at < per.depuis || at >= per.jusqua) continue
    const gene = a.action === 'création' && t && provenance(t) === 'generation'
    if (gene && !generation) continue
    if (!gene && !staff.has(a.userId)) continue // compte joueur, supprimé ou invisible : pas dans le journal du staff
    if (a.action === 'création') vusCreation.add(`${ty}|${a.rowId}`)
    evts.push({ t: at, userId: gene ? null : a.userId, action: a.action, type: ty, trace: t, historique: true })
  }
  for (const t of gen.lignes) {
    if (provenance(t) !== 'generation' || vusCreation.has(`${t.type}|${t.id}`)) continue
    const at = creeLe(t)
    if (at < per.depuis || at >= per.jusqua) continue
    evts.push({ t: at, userId: null, action: 'création', type: t.type, trace: t, historique: false })
  }
  const sessionsCx = cx.sessions.filter((s) => (!userId || s.userId === userId) && staff.has(s.userId) && !(cible && 'generateur' in cible))
  if (types.includes('connexion'))
    for (const s of sessionsCx) {
      const at = ms(s.startedAt)
      if (at === undefined || at < per.depuis || at >= per.jusqua) continue
      evts.push({ t: at, userId: s.userId, action: 'ouverture de l’appli', type: 'connexion', session: s, historique: false })
    }
  if (cx.tronque) avertissements.push(`Plus de ${BORNES.connexionsSessions} ouvertures de l’appli : seules les plus récentes sont lues.`)
  evts.sort((a, b) => a.t - b.t)

  // Libellés : tests, événements (avis et « vus » : le leur ; mesure : même jour, joueur inscrit).
  const crits = evts.some((e) => e.trace?.test) ? await src.criteres() : []
  const evs = evts.some((e) => e.trace && (e.trace.type === 'evenement' || e.trace.evenement || e.trace.type === 'mesure'))
    ? await catalogue(src, evts.flatMap((e) => (e.trace?.evenement ? [e.trace.evenement] : e.trace?.type === 'evenement' ? [e.trace.id] : [])))
    : []
  const nomsEv = (t: TraceSrv) => (t.type === 'evenement' ? [sansCoordonnees(t.nom ?? evs.find((e) => e.id === t.id)?.name, 80) || 'Événement'] : evenementsDe(t, evs).map(nomEvenement))
  const qui = (u: string | null) => (u === null ? { compte: GENERATEUR.compte, nom_affiche: GENERATEUR.nom_affiche } : { compte: codeCompte(u), nom_affiche: nomAffiche(staff.get(u)) })

  const objet = (e: Evt) => {
    if (e.session) {
      const fin = ms(e.session.lastSeenAt)
      return { ...(typeAppareil(e.session.device).appareil ? { appareil: typeAppareil(e.session.device).appareil } : {}), ...(fin !== undefined ? { fin: iso(fin), fin_paris: paris(fin) } : {}) }
    }
    const t = e.trace
    if (!t) return {}
    const ev = nomsEv(t)
    return {
      ...(t.type !== 'evenement' && t.joueur ? { code: codeJoueur(t.joueur) } : {}),
      ...(t.test ? { test: libelleTest(t.test, crits) } : {}),
      ...(t.type === 'mesure' && (typeof t.valeur === 'number' || typeof t.valeur === 'string') ? { valeur: typeof t.valeur === 'number' ? t.valeur : clip(t.valeur, 30) } : {}),
      ...(ev.length ? { evenement: ev.join(' ; ') } : {}),
    }
  }

  const base = {
    maintenant: iso(maintenant),
    periode: champsPeriode(per),
    ...(cible ? { compte_demande: cible && 'profil' in cible ? refStaff(cible.profil) : GENERATEUR } : {}),
    types,
    regroupe: regrouper,
    inclure_generation: generation,
  }
  const notes = [
    'Créations, modifications et suppressions : historique des écritures (hb_audit), heure du serveur. Génération (écrite déclencheurs coupés) : lue dans les tables, « historique: false ». Ouvertures de l’appli : hb_connections. Comptes joueurs exclus.',
  ]

  if (!regrouper) {
    const lignes = evts.slice(-limite).map((e) => ({
      heure: iso(e.t),
      heure_paris: paris(e.t),
      ...qui(e.userId),
      action: e.action,
      type: e.type,
      objet: objet(e),
      ...(e.trace ? { source: provenance(e.trace), ...(lotSur(lotDe(e.trace)) ? { lot_id: lotSur(lotDe(e.trace)) } : {}) } : {}),
      ...(e.historique || e.type === 'connexion' ? {} : { historique: false }),
    }))
    return {
      ...base,
      total: evts.length,
      ...(evts.length > limite ? { tronque: true } : {}),
      actions: lignes,
      avertissements: [...avertissements, ...(evts.length > limite ? [`${evts.length} actions : les ${limite} plus récentes sont rendues (limite).`] : []), ...notes],
      message: 'Journal des actions du staff, ligne à ligne ; joueurs en codes, comptes par code C-… et nom affiché.',
    }
  }

  // Sessions : actions d'un même compte séparées de moins de 15 minutes.
  const parCompte = new Map<string, Evt[]>()
  for (const e of evts) {
    const k = e.userId ?? '\u0000gen'
    parCompte.set(k, [...(parCompte.get(k) ?? []), e])
  }
  type Sess = { userId: string | null; evts: Evt[] }
  const sessions: Sess[] = []
  for (const [, es] of parCompte) {
    let cur: Sess | null = null
    for (const e of es) {
      if (!cur || e.t - cur.evts[cur.evts.length - 1].t >= ECART_SESSION) sessions.push((cur = { userId: e.userId, evts: [] }))
      cur.evts.push(e)
    }
  }
  sessions.sort((a, b) => a.evts[0].t - b.evts[0].t)
  const rendues = sessions.slice(-limite).map((s) => {
    const debut = s.evts[0].t
    const fin = s.evts[s.evts.length - 1].t
    const appareils = s.userId
      ? uniq(
          sessionsCx
            .filter((c) => c.userId === s.userId && (ms(c.startedAt) ?? Infinity) <= fin + ECART_SESSION && (ms(c.lastSeenAt) ?? -Infinity) >= debut - ECART_SESSION)
            .map((c) => typeAppareil(c.device).appareil)
            .filter((x): x is string => !!x),
        )
      : []
    const donnees = s.evts.filter((e) => e.trace)
    const pa: Record<string, number> = {}
    for (const e of s.evts) if (e.type !== 'connexion') pa[ACTION_CLE[e.action] ?? 'modification'] = (pa[ACTION_CLE[e.action] ?? 'modification'] ?? 0) + 1
    const joueurs = new Set(donnees.filter((e) => e.trace!.type !== 'evenement' && e.trace!.joueur).map((e) => e.trace!.joueur!))
    const p = s.userId ? staff.get(s.userId) : undefined
    return {
      ...(s.userId ? { compte: codeCompte(s.userId), nom_affiche: nomAffiche(p), role: libelleRole(p?.role) } : { ...GENERATEUR }),
      debut: iso(debut),
      debut_paris: paris(debut),
      fin: iso(fin),
      fin_paris: paris(fin),
      duree_min: Math.round((fin - debut) / MIN),
      ...(appareils.length ? { appareil: appareils.join(' + ') } : {}),
      nb_actions: s.evts.length,
      par_type: parType(s.evts),
      ...(Object.keys(pa).length ? { par_action: pa } : {}),
      ...(donnees.length
        ? {
            evenements: uniq(donnees.flatMap((e) => nomsEv(e.trace!))).slice(0, 10),
            tests: uniq(donnees.filter((e) => e.trace!.test).map((e) => libelleTest(e.trace!.test!, crits))).slice(0, 20),
            joueurs: joueurs.size,
            sources: uniq(donnees.map((e) => provenance(e.trace!))).sort(),
            ...(uniq(donnees.map((e) => lotSur(lotDe(e.trace!))).filter((x): x is string => !!x)).length
              ? { lots: uniq(donnees.map((e) => lotSur(lotDe(e.trace!))).filter((x): x is string => !!x)).slice(0, 10) }
              : {}),
          }
        : {}),
    }
  })
  return {
    ...base,
    total: sessions.length,
    ...(sessions.length > limite ? { tronque: true } : {}),
    sessions: rendues,
    avertissements: [
      ...avertissements,
      ...(sessions.length > limite ? [`${sessions.length} sessions : les ${limite} plus récentes sont rendues (limite).`] : []),
      'Session : actions d’un même compte séparées de moins de 15 minutes. Appareil : celui des ouvertures de l’appli qui recouvrent la session. Pour les heures exactes : regrouper: false.',
      ...notes,
    ],
    message: 'Journal des actions du staff, par session ; joueurs en codes, comptes par code C-… et nom affiché.',
  }
}

// ---------- nextar_admin_saisies ----------

export interface SaisiesInput {
  auteur?: string
  depuis?: string
  jusqu_a?: string
  test?: string
  evenement?: string
  source?: string
  detail?: boolean
  limite?: number
  inclure_generation?: boolean
}

export async function outilAdminSaisies(src: Source, reg: Reglages, input: SaisiesInput = {}) {
  if (!(await src.estAdmin())) return { erreur: REFUS_ADMIN_TRACES }
  const maintenant = reg.maintenant ?? Date.now()
  const per = lirePeriode(input, maintenant, BORNES.joursDefaut * JOUR, BORNES.joursMax)
  if ('erreur' in per) return { erreur: per.erreur }
  const limite = borne(input.limite, BORNES.saisiesDefaut, 1, BORNES.saisiesMax)
  if (input.source !== undefined && !(PROVENANCES as string[]).includes(input.source))
    return { erreur: `Provenance inconnue : ${PROVENANCES.join(', ')}.` }
  const profilsL = await src.profils()
  const cible = resoudreCompte(input.auteur, profilsL)
  if (cible && 'erreur' in cible) return { erreur: cible.erreur }
  const genSeule = !!cible && 'generateur' in cible
  const source = (genSeule ? 'generation' : input.source) as Provenance | undefined
  const generation = genSeule || source === 'generation' || input.inclure_generation === true
  const userId = cible && 'profil' in cible ? cible.profil.userId : null
  const avertissements = [...per.avertissements]
  const [crits, evsTous] = await Promise.all([src.criteres(), src.evenements({ archives: true })])
  let testId: string | undefined
  if (input.test) {
    const c = critere(input.test, crits)
    if (!c) return { erreur: `Test ou critère inconnu : « ${clip(input.test, 60)} » (identifiants et libellés de nextar_contexte).` }
    testId = c.id
  }
  let ev: EvenementSrv | undefined
  if (input.evenement) {
    const r = trouverParNom(evsTous, input.evenement)
    if ('erreur' in r) return { erreur: `Événement : ${r.erreur}` }
    ev = r.ok
  }
  const estMesureTest = testId ? crits.find((c) => c.id === testId)?.kind !== 'subjective' : true
  const f = { depuis: iso(per.depuis), jusqua: iso(per.jusqua), auteur: userId, test: testId, evenement: ev?.id, source, generation }
  // Lignes (détail, et résumé avant 071) : filtrées ici comme hb_admin_saisies.
  const garder = (t: TraceSrv) => {
    if (t.supprime) return false
    const at = creeLe(t)
    if (at < per.depuis || at >= per.jusqua) return false
    const s = provenance(t)
    if (!generation && s === 'generation') return false
    if (source && s !== source) return false
    if (testId && (t.type !== 'mesure' || t.test !== testId) && !(t.type === 'avis' && t.scores && testId in t.scores)) return false
    if (ev && !evenementsDe(t, [ev]).length) return false
    return true
  }
  const typesLus: TypeTrace[] = testId ? (estMesureTest ? ['mesure'] : ['avis']) : ['mesure', 'avis']
  let resume = await src.saisiesResume(f)
  // hb_admin_saisies ne regarde un test que dans les mesures ; un critère d'avis passe par les lignes.
  if (resume && testId && !estMesureTest) resume = null
  const via071 = !!resume
  let lues: TraceSrv[] = []
  let tronque = false
  if (!resume || input.detail) {
    const r = await lireTraces(src, { ...per, auteur: userId, types: typesLus, generation }, resume ? BORNES.saisiesLues : BORNES.tracesMax)
    lues = r.lignes.filter(garder)
    tronque = r.tronque
    if (!resume) {
      resume = resumerSaisies(lues, evsTous)
      if (testId && !estMesureTest) resume = resume.filter((x) => x.cle === testId)
      if (tronque) avertissements.push(`Plus de ${BORNES.tracesMax} lignes par type : résumé calculé sur les plus récentes. Appliquer 071 pour des agrégats complets dans la base.`)
    }
  }
  const evs = await catalogue(src, resume.flatMap((x) => x.evenements))
  const nomsEv = (ids: string[]) => uniq(ids.map((id) => evs.find((e) => e.id === id)).filter((e): e is EvenementSrv => !!e).map(nomEvenement)).slice(0, 10)
  const heures = (x: SaisieResumeSrv) => {
    const p = ms(x.premier) ?? 0
    const d = ms(x.dernier) ?? 0
    return { premiere: iso(p), premiere_paris: paris(p), derniere: iso(d), derniere_paris: paris(d) }
  }
  const mes = resume.filter((x) => x.type === 'mesure').sort((a, b) => b.nb - a.nb || a.cle.localeCompare(b.cle))
  const avs = resume.filter((x) => x.type === 'avis').sort((a, b) => b.nb - a.nb || a.cle.localeCompare(b.cle))
  const unite = (id: string) => sansCoordonnees(crits.find((c) => c.id === id)?.unit, 10)
  const detail = input.detail
    ? {
        mesures: lues
          .filter((t) => t.type === 'mesure')
          .sort((a, b) => creeLe(b) - creeLe(a))
          .slice(0, limite)
          .map((t) => {
            const evN = evenementsDe(t, evs).map(nomEvenement)
            return {
              ...(t.joueur ? { code: codeJoueur(t.joueur) } : {}),
              test: libelleTest(t.test ?? '', crits),
              ...(typeof t.valeur === 'number' || typeof t.valeur === 'string' ? { valeur: typeof t.valeur === 'number' ? t.valeur : clip(t.valeur, 30) } : {}),
              heure: iso(creeLe(t)),
              heure_paris: paris(creeLe(t)),
              ...(evN.length ? { evenement: evN.join(' ; ') } : {}),
              source: provenance(t),
              ...(lotSur(lotDe(t)) ? { lot_id: lotSur(lotDe(t)) } : {}),
            }
          }),
        avis: lues
          .filter((t) => t.type === 'avis')
          .sort((a, b) => creeLe(b) - creeLe(a))
          .slice(0, limite)
          .map((t) => {
            const notes = Object.values(t.scores ?? {}).filter((v) => typeof v === 'number')
            const evN = evenementsDe(t, evs).map(nomEvenement)
            return {
              ...(t.joueur ? { code: codeJoueur(t.joueur) } : {}),
              heure: iso(creeLe(t)),
              heure_paris: paris(creeLe(t)),
              ...(evN.length ? { evenement: evN.join(' ; ') } : {}),
              nb_criteres: notes.length,
              ...(notes.length ? { moyenne: arrondi(notes.reduce((x, y) => x + y, 0) / notes.length, 2) } : {}),
              source: provenance(t),
              ...(lotSur(lotDe(t)) ? { lot_id: lotSur(lotDe(t)) } : {}),
            }
          }),
      }
    : undefined
  const nbMes = lues.filter((t) => t.type === 'mesure').length
  const nbAvis = lues.filter((t) => t.type === 'avis').length
  return {
    maintenant: iso(maintenant),
    auteur: cible ? ('profil' in cible ? refStaff(cible.profil) : GENERATEUR) : 'tous les comptes du staff',
    periode: champsPeriode(per),
    ...(testId || ev || source ? { filtres: { ...(testId ? { test: libelleTest(testId, crits), test_id: testId } : {}), ...(ev ? { evenement: nomEvenement(ev) } : {}), ...(source ? { source } : {}) } } : {}),
    inclure_generation: generation,
    via: via071 ? 'agrégats dans la base (071)' : `lignes lues et agrégées par le serveur MCP (${INDISPONIBLE_071} pour les agrégats dans la base)`,
    mesures: {
      total: mes.reduce((s, x) => s + x.nb, 0),
      par_test: mes.map((x) => ({
        test: libelleTest(x.cle, crits),
        test_id: clip(x.cle, 80),
        ...(unite(x.cle) ? { unite: unite(x.cle) } : {}),
        nb: x.nb,
        joueurs: x.joueurs,
        ...(x.min !== null ? { min: x.min, max: x.max, moyenne: x.moyenne } : {}),
        ...(x.valeursTexte ? { valeurs_texte: x.valeursTexte } : {}),
        evenements: nomsEv(x.evenements),
        ...heures(x),
        sources: x.sources.filter((s) => (PROVENANCES as string[]).includes(s)),
      })),
    },
    avis: {
      nb_notes: avs.reduce((s, x) => s + x.nb, 0),
      par_critere: avs.map((x) => ({
        critere: libelleTest(x.cle, crits),
        critere_id: clip(x.cle, 80),
        nb: x.nb,
        joueurs: x.joueurs,
        ...(x.moyenne !== null ? { moyenne: x.moyenne, min: x.min, max: x.max } : {}),
        evenements: nomsEv(x.evenements),
        ...heures(x),
        sources: x.sources.filter((s) => (PROVENANCES as string[]).includes(s)),
      })),
    },
    ...(detail ? { detail } : {}),
    ...(tronque || (detail && (nbMes > limite || nbAvis > limite)) ? { tronque: true } : {}),
    avertissements: [
      ...avertissements,
      ...(detail && (nbMes > limite || nbAvis > limite) ? [`Détail : les ${limite} plus récentes de chaque sorte (limite).`] : []),
      'Lignes CRÉÉES sur la période (heure posée par le serveur), encore présentes. Événement d’une mesure : même jour, joueur inscrit. Avis : notes chiffrées seulement, jamais un commentaire.',
    ],
    message: 'Saisies d’un compte : tests et critères par libellé, joueurs en codes J-…, comptes par code C-… et nom affiché.',
  }
}

// ---------- nextar_admin_activite (admin.ts) : construction à partir des agrégats ----------

export interface LigneActivite {
  avis: number
  mesures: number
  evenements: number
  vus: number
  fiches: number
  parSource: Record<string, number>
  histo: Map<string, { nb: number; parType: Record<string, number> }>
  porteurs: Map<string, number>
}
const CLE_TYPE: Record<TypeTrace, 'avis' | 'mesures' | 'evenements' | 'vus' | 'fiches'> = { avis: 'avis', mesure: 'mesures', evenement: 'evenements', vu: 'vus', fiche: 'fiches' }
export const ligneVide = (): LigneActivite => ({ avis: 0, mesures: 0, evenements: 0, vus: 0, fiches: 0, parSource: {}, histo: new Map(), porteurs: new Map() })

/** Agrégats → par compte (la génération sous la clé null, avec les comptes porteurs). */
export function construireActivite(ags: readonly AgregatSrv[]): Map<string | null, LigneActivite> {
  const m = new Map<string | null, LigneActivite>()
  for (const a of ags) {
    const k = a.source === 'generation' ? null : a.auteur
    if (k === undefined) continue
    let l = m.get(k)
    if (!l) m.set(k, (l = ligneVide()))
    l[CLE_TYPE[a.type]] += a.nb
    l.parSource[a.source] = (l.parSource[a.source] ?? 0) + a.nb
    if (a.tranche) {
      const h = l.histo.get(a.tranche) ?? { nb: 0, parType: {} }
      h.nb += a.nb
      h.parType[PLURIEL[a.type]] = (h.parType[PLURIEL[a.type]] ?? 0) + a.nb
      l.histo.set(a.tranche, h)
    }
    if (k === null && a.auteur) l.porteurs.set(a.auteur, (l.porteurs.get(a.auteur) ?? 0) + a.nb)
  }
  return m
}

export const histogramme = (l: LigneActivite, par: 'jour' | 'heure') =>
  [...l.histo]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, h]) => ({ tranche: t, tranche_paris: libelleTranche(ms(t) ?? 0, par), nb: h.nb, par_type: h.parType }))

/** Lecture des agrégats : dans la base (071), sinon lignes lues ici (bornées). */
export async function lireAgregats(
  src: Source,
  f: { depuis: number; jusqua: number; auteur?: string | null; generation: boolean; par: 'total' | 'jour' | 'heure' | 'lot' },
): Promise<{ ags: AgregatSrv[]; via071: boolean; tronque: boolean }> {
  const r = await src.agregats({ depuis: iso(f.depuis), jusqua: iso(f.jusqua), auteur: f.auteur ?? null, generation: f.generation, par: f.par })
  if (r) return { ags: r, via071: true, tronque: false }
  const lu = await lireTraces(src, { ...f, types: TYPES }, BORNES.tracesMax)
  return { ags: agregerTraces(lu.lignes, f), via071: false, tronque: lu.tronque }
}

// ---------- nextar_admin_lots ----------

export interface LotsInput {
  depuis?: string
  jusqu_a?: string
  limite?: number
}

export async function outilAdminLots(src: Source, reg: Reglages, input: LotsInput = {}) {
  if (!(await src.estAdmin())) return { erreur: REFUS_ADMIN_TRACES }
  const maintenant = reg.maintenant ?? Date.now()
  const per = lirePeriode(input, maintenant, BORNES.joursMax * JOUR, BORNES.joursMax)
  if ('erreur' in per) return { erreur: per.erreur }
  const limite = borne(input.limite, BORNES.lotsDefaut, 1, BORNES.lotsMax)
  const [profilsL, table, lu] = await Promise.all([src.profils(), src.lots(), lireAgregats(src, { ...per, generation: true, par: 'lot' })])
  const staff = new Map(profilsL.filter((p) => p.role !== 'joueur').map((p) => [p.userId, p]))
  const avertissements = [...per.avertissements]
  if (lu.tronque) avertissements.push(`Plus de ${BORNES.tracesMax} lignes par type sur la période : volumes comptés sur les plus récentes. Appliquer 071 pour des volumes complets.`)
  type L = { id: string; sources: Set<string>; vol: Record<string, number>; porteurs: Map<string, number>; premier: number; dernier: number; dmin?: string; dmax?: string; joueurs: number }
  const lots = new Map<string, L>()
  for (const a of lu.ags) {
    const id = lotSur(a.lot)
    if (!id) continue
    let l = lots.get(id)
    if (!l) lots.set(id, (l = { id, sources: new Set(), vol: {}, porteurs: new Map(), premier: Infinity, dernier: -Infinity, joueurs: 0 }))
    l.sources.add(a.source)
    l.vol[PLURIEL[a.type]] = (l.vol[PLURIEL[a.type]] ?? 0) + a.nb
    if (a.auteur) l.porteurs.set(a.auteur, (l.porteurs.get(a.auteur) ?? 0) + a.nb)
    l.premier = Math.min(l.premier, ms(a.premier) ?? Infinity)
    l.dernier = Math.max(l.dernier, ms(a.dernier) ?? -Infinity)
    l.joueurs += a.joueurs
    if (a.declareMin && (!l.dmin || a.declareMin < l.dmin)) l.dmin = a.declareMin
    if (a.declareMax && (!l.dmax || a.declareMax > l.dmax)) l.dmax = a.declareMax
  }
  const parId = new Map((table ?? []).filter((x) => lotSur(x.id)).map((x) => [x.id, x]))
  const ids = uniq([...lots.keys(), ...parId.keys()])
  const qui = (u: string) => ({ compte: codeCompte(u), nom_affiche: staff.has(u) ? nomAffiche(staff.get(u)) : '(compte supprimé ou invisible)' })
  const rendus = ids
    .map((id) => {
      const l = lots.get(id)
      const t = parId.get(id)
      const source = (t && (PROVENANCES as string[]).includes(t.source) ? t.source : l ? [...l.sources].sort()[0] : 'generation') as Provenance
      const cree = ms(t?.createdAt) ?? l?.premier ?? 0
      const vol = l && Object.keys(l.vol).length ? l.vol : Object.fromEntries(Object.entries(t?.nbLignes ?? {}).filter(([k, v]) => k in PLURIEL && typeof v === 'number').map(([k, v]) => [PLURIEL[k], v]))
      const porteurs = l ? [...l.porteurs].sort((a, b) => b[1] - a[1]) : []
      const generation = source === 'generation'
      const auteur = generation ? GENERATEUR : t?.createdBy ? qui(t.createdBy) : porteurs[0] ? qui(porteurs[0][0]) : { compte: '?', nom_affiche: '(auteur inconnu)' }
      const ecrit = l && Number.isFinite(l.premier) ? { premiere_ecriture: iso(l.premier), premiere_ecriture_paris: paris(l.premier), derniere_ecriture: iso(l.dernier), derniere_ecriture_paris: paris(l.dernier), duree_min: Math.round((l.dernier - l.premier) / MIN) } : {}
      return {
        tri: cree,
        lot: {
          id,
          source,
          ...(t?.description || LOTS_CONNUS[id] ? { description: sansCoordonnees(t?.description || LOTS_CONNUS[id], 300) } : {}),
          auteur,
          ...(generation && porteurs.length ? { porteurs: porteurs.slice(0, 10).map(([u, n]) => ({ ...qui(u), nb: n })) } : {}),
          creee_le: iso(cree),
          creee_le_paris: paris(cree),
          ...ecrit,
          volumes: vol,
          ...(l?.dmin ? { dates_declarees: { min: clip(l.dmin, 40), max: clip(l.dmax, 40) } } : {}),
          enregistre: !!t,
        },
      }
    })
    .sort((a, b) => b.tri - a.tri)
  return {
    maintenant: iso(maintenant),
    periode: champsPeriode(per),
    via: lu.via071 ? 'agrégats dans la base (071)' : `lignes lues et agrégées par le serveur MCP (${INDISPONIBLE_071} pour les volumes dans la base)`,
    ...(table === null ? { lignes: `table des lots ${INDISPONIBLE_071} : lots reconnus par leurs marques (data.lotId, identifiants demo-…, data.source, data.demoBilan, signature SQL).` } : {}),
    total: rendus.length,
    ...(rendus.length > limite ? { tronque: true } : {}),
    lots: rendus.slice(0, limite).map((x) => x.lot),
    avertissements: [
      ...avertissements,
      'Lot : création en masse (collage d’un tableau, proposition validée : identifiant de la proposition, génération). Première / dernière écriture : heure réelle posée par le serveur ; dates déclarées : createdAtServer inscrit dans les lignes (un générateur peut l’antidater). Volumes : lignes encore présentes, créées sur la période.',
    ],
    message: 'Lots de créations en masse ; auteurs par code C-… et nom affiché (génération : « Générateur démo » et comptes porteurs) ; aucune donnée de joueur.',
  }
}
