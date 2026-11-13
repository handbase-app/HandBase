// Nextar, serveur MCP : les QUATRE OUTILS D'ADMINISTRATION, en LECTURE SEULE et en fonctions PURES (comme outils.ts : elles
// reçoivent une Source aux droits du compte, jamais la clé de service) :
//  - nextar_admin_a_faire   « qu'est-ce qui m'attend ? » : comptes sans rôle, fiches et avis à valider, doublons probables,
//                           propositions « À valider » du compte, questions du journal à traiter ;
//  - nextar_admin_sante     état de l'installation : volumes, comptes, connexions, dernière écriture ; avec 069 (hb_admin_sante) :
//                           taille de la base et des tables, registre, charge, abonnements, veille, notifications, tâches ;
//  - nextar_admin_activite  par compte du staff, sur une période (jours, ou depuis / jusqu'à) : avis, mesures, événements,
//                           « vus », fiches créés, par provenance, histogramme par jour / heure (adminTraces.ts : agrégats,
//                           génération sous « Générateur démo ») ; dernière activité ; comptes inactifs ;
//  - nextar_admin_questions ce que les coachs n'arrivent pas à faire : questions du journal ratées, sauvées ou jugées
//                           « mauvaise réponse » / « pas de réponse », regroupées par formulation proche.
// Règles (les mêmes que nextar_connexions, outils.ts) :
//  1. le rôle D'ABORD : un compte qui n'est pas administrateur reçoit un refus, et RIEN n'est lu (tools/test-mcp.ts compte
//     les appels) ; la base, elle, ne lui rendrait de toute façon rien de ce qui est réservé ;
//  2. joueurs en CODES seulement (« J-… », src/codesJoueurs.ts) : jamais un nom, une date de naissance complète, un club, une
//     licence ni un commentaire d'avis ; comptes du staff : code « C-… », nom affiché (sans adresse mail ni téléphone), rôle ;
//  3. textes écrits par quelqu'un (titres, questions) : coordonnées retirées ; QUESTIONS : chaque mot égal (sans accents ni
//     majuscules) à un prénom ou un nom d'une fiche du périmètre devient « [joueur] » ; un mot propre inconnu (majuscule hors
//     début de phrase, absent du vocabulaire de l'installation) devient « [nom] ». La liste des noms reste ici. Trop de fiches
//     pour les lire toutes : AUCUNE formulation ne sort, seulement des nombres et des catégories ;
//  4. chaque réponse passe par la liste blanche de SON outil (outils.ts, CLES_ADMIN) et le contrôle des textes (aucun « @ »,
//     aucune adresse IP) ;
//  5. aucune écriture.
// Fichier sans import Deno (testable avec npx jiti, tools/test-mcp.ts).

import { codeJoueur } from './partage/codesJoueurs.ts'
import { nameKey } from './partage/nameMatch.ts'
import {
  filterEntries,
  groupEntries,
  isAvisVocal,
  maskLicences,
  OUTCOME_LABEL,
  outcomeOf,
  splitLog,
  type AdvancedStatus,
  type QuestionLogRow,
  type RecipeStatus,
  type Verdict,
} from './partage/questionLogCore.ts'
import {
  BORNES,
  borne,
  clip,
  codeCompte,
  ilYA,
  lienBoite,
  ROLE_LIBELLE,
  SANS_NOM,
  SANS_ROLE,
  sansCoordonnees,
  typeAppareil,
  uniq,
  type ActiviteSrv,
  type Comptage,
  type JournalSrv,
  type NomJoueurSrv,
  type ProfilSrv,
  type Reglages,
  type Source,
} from './outils.ts'
import { construireActivite, GENERATEUR, histogramme, INDISPONIBLE_071, lireAgregats, lirePeriode, paris, type LigneActivite } from './adminTraces.ts'

export const REFUS_ADMIN = 'Réservé aux administrateurs : ce compte ne peut pas utiliser cet outil.'
const JOUR = 86_400_000

const nomAffiche = (p?: ProfilSrv | null) => sansCoordonnees(p?.fullName, 80) || SANS_NOM
const libelleRole = (r?: string | null) => (r && ROLE_LIBELLE[r]) || SANS_ROLE
const iso = (t: number) => new Date(t).toISOString()
const tempsDe = (s?: string | null) => {
  const t = s ? Date.parse(s) : NaN
  return Number.isFinite(t) ? t : undefined
}

/** Référence d'un compte du staff : code et nom affiché (jamais l'identifiant brut). */
function refCompte(userId: string | null | undefined, profils: Map<string, ProfilSrv>) {
  if (!userId) return { compte: '?', nom_affiche: '(auteur inconnu)' }
  const p = profils.get(userId)
  return { compte: codeCompte(userId), nom_affiche: p ? nomAffiche(p) : '(compte supprimé ou invisible)' }
}

/** Appels en parallèle, `n` à la fois. */
async function parLots<T, R>(xs: readonly T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (i < xs.length) {
        const k = i++
        out[k] = await f(xs[k])
      }
    }),
  )
  return out
}

// ---------- Doublons probables (même règle que src/merge.ts, possibleDuplicates, et le filtre de src/pages/Review.tsx) ----------

/** Nom sans accents, tirets ni majuscules (comme src/merge.ts) : « Jean-Pierre D'Amico » → « jeanpierre|damico ». */
const normDoublon = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase()
/** Naissances compatibles (comme src/merge.ts) : égales, ou l'une inconnue, ou seule l'année connue et identique. */
const memeNaissance = (a?: string, b?: string) => !a || !b || a === b || (a.length === 4 || b.length === 4 ? a.slice(0, 4) === b.slice(0, 4) : false)

const ETAT_FICHE: Record<string, string> = { pending: 'fiche proposée', refused: 'fiche hors cadre', validated: 'fiche proposée puis validée' }

/**
 * Paires de fiches qui sont probablement la même personne : même prénom et même nom (sans accents, tirets ni majuscules),
 * naissances compatibles, et au moins une des deux fiches proposée ou hors cadre (l'écran « Propositions » de l'appli ne
 * montre que celles-là ; les autres homonymes se règlent à l'import). Ordre : [à garder, à fondre] comme src/merge.ts
 * (keepFirst, sans la licence, que ce serveur ne lit pas).
 */
export function doublonsProbables(js: readonly NomJoueurSrv[]): { a: NomJoueurSrv; b: NomJoueurSrv; raison: string }[] {
  const groupes = new Map<string, NomJoueurSrv[]>()
  for (const p of js) {
    if (p.id.startsWith('demo-')) continue
    const k = `${normDoublon(p.firstName)}|${normDoublon(p.lastName)}`
    if (k === '|') continue
    groupes.set(k, [...(groupes.get(k) ?? []), p])
  }
  const score = (p: NomJoueurSrv) => (!p.review || p.review === 'validated' ? 2 : 0) + (p.review === 'refused' ? -1 : 0)
  const out: { a: NomJoueurSrv; b: NomJoueurSrv; raison: string }[] = []
  for (const g of groupes.values()) {
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        const [x, y] = score(g[j]) > score(g[i]) ? [g[j], g[i]] : [g[i], g[j]]
        if (!(x.review || y.review) || !memeNaissance(x.birthDate, y.birthDate)) continue
        const naissance =
          x.birthDate && y.birthDate && x.birthDate === y.birthDate && x.birthDate.length > 4
            ? 'même date de naissance'
            : !x.birthDate || !y.birthDate
              ? 'date de naissance inconnue sur une des fiches'
              : 'même année de naissance'
        const etats = uniq([x.review, y.review].filter((r): r is string => !!r).map((r) => ETAT_FICHE[r] ?? 'fiche à vérifier'))
        out.push({ a: x, b: y, raison: `même prénom et même nom (sans accents ni tirets), ${naissance} ; ${etats.join(', ')}` })
      }
  }
  return out
}

// ---------- Masquage des noms dans les textes libres (questions, titres) ----------

/** Mots jamais remplacés (mots outils) : « [joueur] de la [joueur] » plutôt qu'une phrase illisible. */
const MOTS_OUTILS = new Set(
  (
    'a au aux avec ce ces cet cette d dans de des du elle elles en est et il ils je l la le les leur leurs lui ma mais me mes moi mon ne ni ' +
    'nous on ou par pas pour qu que quel quelle quelles quels qui quoi sa sans se ses son sont sur ta te tes toi ton tous tout toute toutes ' +
    'tu un une vos votre vous y joueur joueurs joueuse joueuses prenom nom noms licence'
  ).split(' '),
)

export interface Masque {
  /** Le texte, coordonnées et licences retirées, noms de joueurs remplacés par « [joueur] », mots propres inconnus par « [nom] ». */
  texte(s: unknown, n: number): string
  /** Nombre de mots de noms connus (prénoms et noms distincts). */
  noms: number
}

/**
 * Masque côté serveur. `joueurs` : prénoms et noms des fiches du périmètre (jamais rendus) ; `vocabulaire` : libellés de
 * l'installation (tests, critères, événements, groupes, postes) dont les mots, même écrits avec une majuscule, restent.
 * Un mot (ou une partie d'un mot composé : « Jean-Pierre », « d'Exemplaire ») égal à un prénom ou un nom devient « [joueur] »,
 * même en minuscules et sans accents ; un mot avec une majuscule hors début de phrase, inconnu du vocabulaire, devient
 * « [nom] ». Les « [prénom] » / « [nom] » déjà posés par l'appli deviennent « [joueur] ». Limite connue : un nom mal
 * orthographié en minuscules n'est pas reconnu.
 */
export function masqueNoms(joueurs: readonly { firstName: string; lastName: string }[], vocabulaire: readonly string[] = []): Masque {
  const cle = (w: string) => nameKey(w).replace(/[^a-z]/g, '')
  const noms = new Set<string>()
  const ajouter = (k: string) => {
    if (k.length >= 2 && !MOTS_OUTILS.has(k)) noms.add(k)
  }
  for (const j of joueurs)
    for (const x of [j.firstName, j.lastName]) {
      const parts = nameKey(x ?? '').split(' ')
      for (const p of parts) ajouter(p.replace(/[^a-z]/g, ''))
      ajouter(parts.join('').replace(/[^a-z]/g, ''))
    }
  const vocab = new Set<string>()
  for (const v of vocabulaire) for (const p of nameKey(v ?? '').split(' ')) if (p) vocab.add(p.replace(/[^a-z0-9]/g, ''))
  const MOT = /\[[^\]\s]{1,20}\]|[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu
  return {
    noms: noms.size,
    texte(s: unknown, n: number): string {
      const brut = maskLicences(sansCoordonnees(s, 4000).replace(/\[(prénom|prenom|nom)\]/gi, '[joueur]'))
      const t = brut.replace(MOT, (mot: string, pos: number) => {
        if (mot.startsWith('[')) return mot
        if (noms.has(cle(mot))) return '[joueur]'
        const avant = brut.slice(0, pos)
        const debut = !/[\p{L}\p{N}]/u.test(avant) || /[.!?:]\s*$/.test(avant)
        return mot
          .split(/(['’-])/)
          .map((p) => {
            if (/^['’-]$/.test(p) || !p) return p
            const k = cle(p)
            if (k.length >= 2 && !MOTS_OUTILS.has(k) && noms.has(k)) return '[joueur]'
            const propre = /^\p{Lu}/u.test(p) && p !== p.toUpperCase() && k.length >= 3
            if (propre && !debut && !vocab.has(k) && !MOTS_OUTILS.has(k)) return '[nom]'
            return p
          })
          .join('')
      })
      // « [joueur] [joueur] » (prénom puis nom) : un seul.
      return clip(t.replace(/\[(joueur|nom)\](?:[\s-]+\[(?:joueur|nom)\])+/g, '[joueur]'), n)
    },
  }
}

// ---------- 7. nextar_admin_a_faire ----------

export async function outilAdminAFaire(src: Source, reg: Reglages, input: { limite?: number } = {}) {
  if (!(await src.estAdmin())) return { erreur: REFUS_ADMIN }
  const limite = borne(input.limite, BORNES.aFaireDefaut, 1, BORNES.aFaireMax)
  const maintenant = reg.maintenant ?? Date.now()
  const avertissements: string[] = []
  const [profilsL, fiches, avis, props, revus, journal] = await Promise.all([
    src.profils(),
    src.fichesAValider(limite),
    src.avisAValider(limite),
    src.propositionsEnAttente(limite),
    src.compter('joueurs_revus'),
    src.journal(iso(maintenant - BORNES.joursMax * JOUR), BORNES.journalMax),
  ])
  const profils = new Map(profilsL.map((p) => [p.userId, p]))
  // Comptes sans rôle : les plus anciens d'abord (ceux qui attendent depuis le plus longtemps).
  const sansRole = profilsL.filter((p) => !p.role).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
  // Noms des fiches (côté serveur) : doublons, et masquage des titres de propositions.
  let noms: { joueurs: NomJoueurSrv[]; tronque: boolean } | null = null
  if ((revus ?? 1) > 0 || props.total > 0) noms = await src.nomsJoueurs(BORNES.nomsMax)
  let doublons: { codes: string[]; raison: string }[] | null = null
  if (noms && !noms.tronque) doublons = doublonsProbables(noms.joueurs).map((d) => ({ codes: [codeJoueur(d.a.id), codeJoueur(d.b.id)], raison: d.raison }))
  else if (noms?.tronque) avertissements.push(`Plus de ${BORNES.nomsMax} fiches : doublons non calculés ici (écran « Propositions » de l’appli).`)
  else doublons = []
  const masque = noms && !noms.tronque ? masqueNoms(noms.joueurs) : null
  // Journal : questions à traiter (même règle que l'écran Réglages › Journal des questions).
  const lignes = journal.lignes.filter((l) => !isAvisVocal(l)).map(versLigneJournal)
  const { questions, avis: avisJ } = splitLog(lignes)
  const aTraiter = filterEntries(questions, 'a_traiter', avisJ).length
  if (journal.tronque) avertissements.push(`Journal des questions : plus de ${BORNES.journalMax} lignes sur 12 mois, « à traiter » compté sur les plus récentes.`)
  const ilya = (s?: string | null) => {
    const t = tempsDe(s)
    return t === undefined ? {} : { il_y_a: ilYA(maintenant - t) }
  }
  return {
    maintenant: iso(maintenant),
    resume: {
      comptes_sans_role: sansRole.length,
      fiches_a_valider: fiches.total,
      avis_a_valider: avis.total,
      doublons: doublons ? doublons.length : null,
      propositions_en_attente: props.total,
      questions_a_traiter: aTraiter,
    },
    comptes_sans_role: sansRole.slice(0, limite).map((p) => ({ compte: codeCompte(p.userId), nom_affiche: nomAffiche(p), ...(p.createdAt ? { depuis: p.createdAt, ...ilya(p.createdAt) } : {}) })),
    fiches_a_valider: fiches.fiches.slice(0, limite).map((f) => ({
      code: codeJoueur(f.id),
      ...(f.poste ? { poste: clip(f.poste, 10) } : {}),
      ...(f.annee ? { annee: f.annee } : {}),
      ...(f.dept ? { departement: clip(f.dept, 4) } : {}),
      ...(f.createdAt ? { proposee_le: f.createdAt, ...ilya(f.createdAt) } : {}),
      par: refCompte(f.createdBy, profils),
    })),
    avis_a_valider: avis.avis.slice(0, limite).map((a) => ({
      code: codeJoueur(a.playerId),
      ...(a.date && /^\d{4}-\d{2}-\d{2}/.test(a.date) ? { date: a.date.slice(0, 10) } : {}),
      ...(a.createdAt ? { deposee_le: a.createdAt, ...ilya(a.createdAt) } : {}),
      par: refCompte(a.createdBy, profils),
    })),
    doublons: (doublons ?? []).slice(0, limite),
    // Titres : écrits par le compte (ou par Claude) ; masqués comme les questions. Sans la liste des noms : pas de titre.
    propositions_en_attente: props.propositions.slice(0, limite).map((p) => ({
      id: p.id,
      ...(masque ? { titre: masque.texte(p.titre, 80) } : {}),
      ...(p.nbLignes >= 0 ? { nb_lignes: p.nbLignes } : {}),
      creee_le: p.created_at,
      expire_le: p.expires_at,
    })),
    questions_a_traiter: aTraiter,
    ...(fiches.total > limite || avis.total > limite || sansRole.length > limite || (doublons?.length ?? 0) > limite || props.total > limite ? { tronque: true } : {}),
    liens: { validation: `${reg.appUrl}/avis-spontanes`, membres: `${reg.appUrl}/parametres`, boite: lienBoite(reg), journal: `${reg.appUrl}/parametres` },
    avertissements: [
      ...avertissements,
      'Fiches et avis à valider : toute la base (un administrateur décide pour tous les secteurs). Propositions « À valider » : celles de ce compte. Joueurs en codes : l’appli remet les noms.',
    ],
    message: 'Files d’attente de l’administrateur ; joueurs en codes, comptes du staff par nom affiché et rôle, jamais d’adresse mail.',
  }
}

function versLigneJournal(l: JournalSrv): QuestionLogRow {
  return {
    id: l.id,
    at: l.at,
    ...(l.authorId ? { authorId: l.authorId } : {}),
    phrase: l.phrase ?? '',
    recipe: (['complete', 'partielle', 'pas_comprise'].includes(l.recipe ?? '') ? l.recipe : 'pas_comprise') as RecipeStatus,
    ...(l.status ? { status: l.status as AdvancedStatus } : {}),
    ...(l.recipeMissing?.length ? { recipeMissing: l.recipeMissing } : {}),
    ...(l.display ? { display: l.display } : {}),
    ...(l.page ? { page: l.page } : {}),
    ...(l.kind === 'avis' ? { kind: 'avis' as const } : {}),
    ...(l.questionId ? { questionId: l.questionId } : {}),
    ...(l.verdict ? { verdict: l.verdict as Verdict } : {}),
    ...(l.comment ? { comment: l.comment } : {}),
    ...(l.recipeDone ? { recipeDone: true } : {}),
  }
}

// ---------- 8. nextar_admin_sante ----------

/** Volumes rendus : comptage (source.ts) → libellé. */
export const VOLUMES: [Comptage, string][] = [
  ['joueurs', 'fiches joueur'],
  ['joueurs_fondus', 'fiches fondues dans une autre'],
  ['mesures', 'mesures'],
  ['avis', 'avis'],
  ['evenements', 'événements'],
  ['groupes', 'groupes (sans les groupes privés des autres comptes)'],
  ['vus', '« vus » (joueur vu à un événement)'],
  ['videos', 'vidéos'],
  ['a_revoir', '« À revoir »'],
  ['criteres', 'tests et critères'],
  ['listes', 'listes (postes, départements…)'],
  ['unites', 'unités de la structure'],
  ['affectations', 'affectations'],
  ['rencontres', 'rencontres'],
  ['alertes', 'alertes (sans les alertes privées des autres comptes)'],
  ['journal_questions', 'journal des questions'],
  ['historique', 'historique des écritures'],
  ['connexions', 'ouvertures de l’appli (6 mois)'],
]

/** « 419 Mo », « 1,2 Go ». */
export function taille(octets: unknown): string | undefined {
  const n = typeof octets === 'number' ? octets : typeof octets === 'string' && /^\d+$/.test(octets) ? +octets : NaN
  if (!Number.isFinite(n) || n < 0) return undefined
  const u = ['octets', 'Ko', 'Mo', 'Go', 'To']
  let v = n
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? v : v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${u[i]}`.replace('.', ',')
}

const nb = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? +v : null)
const quand = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? clip(v, 40) : null)
const mot = (v: unknown, n = 60) => (typeof v === 'string' ? sansCoordonnees(v, n) || null : null)
const objet = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const liste = (v: unknown) => (Array.isArray(v) ? v.map(objet).filter((x): x is Record<string, unknown> => !!x) : null)
const sansNulls = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined))

const INDISPONIBLE_069 = 'indisponible tant que supabase/069_admin_sante.sql n’est pas appliqué'

/** Réponse de hb_admin_sante (069) → champs connus seulement, un à un (rien n'est recopié tel quel). */
export function lireSante069(j: Record<string, unknown>) {
  const base = objet(j.base)
  const reg = objet(j.registre)
  const ch = objet(j.charge)
  const ab = objet(j.abonnements)
  const no = objet(j.notifications)
  const tr = objet(j.transcription)
  const veille = liste(j.veille)
  const taches = liste(j.taches)
  return {
    base: base ? sansNulls({ taille_octets: nb(base.taille_octets), taille: taille(base.taille_octets) ?? null, postgres: mot(base.postgres, 40) }) : null,
    tables: (liste(j.tables) ?? [])
      .map((t) => ({ table: mot(t.table, 63) ?? '?', lignes_estimees: nb(t.lignes_estimees), taille_octets: nb(t.taille_octets) }))
      .sort((a, b) => (b.taille_octets ?? 0) - (a.taille_octets ?? 0))
      .slice(0, 12)
      .map((t) => sansNulls({ table: t.table, lignes_estimees: t.lignes_estimees, taille: taille(t.taille_octets) ?? null })),
    registre: reg ? sansNulls({ lignes_24h: nb(reg.lignes_24h), pertes_24h: nb(reg.pertes_24h), derniere: quand(reg.derniere), purge_le: quand(reg.purge_le) }) : null,
    charge: ch ? sansNulls({ niveau: mot(ch.niveau, 20), en_cours: ch.en_cours === true, jusqua: quand(ch.jusqua), annonce_le: quand(ch.annonce_le) }) : null,
    abonnements: ab
      ? sansNulls({
          total: nb(ab.total),
          comptes: nb(ab.comptes),
          par_appareil: liste(ab.par_appareil)?.slice(0, 12).map((x) => ({ appareil: mot(x.appareil, 30) ?? 'inconnu', nb: nb(x.nb) ?? 0 })) ?? null,
          sans_envoi_reussi_30j: nb(ab.sans_envoi_reussi_30j),
        })
      : null,
    veille: veille ? veille.slice(0, 7).map((v) => sansNulls({ jour: quand(v.jour), comptes: nb(v.comptes), appareils: nb(v.appareils), envoyes: nb(v.envoyes) })) : null,
    notifications: no ? sansNulls({ en_attente: nb(no.en_attente), plus_ancienne: quand(no.plus_ancienne) }) : null,
    taches: taches
      ? taches.slice(0, 30).map((t) =>
          sansNulls({ tache: mot(t.tache, 60) ?? '?', derniere_execution: quand(t.derniere_execution), dernier_etat: mot(t.dernier_etat, 20), echecs_7j: nb(t.echecs_7j), executions_7j: nb(t.executions_7j) }),
        )
      : null,
    transcription: tr ? sansNulls({ periode: mot(tr.periode, 20), total: nb(tr.total) }) : null,
  }
}

export async function outilAdminSante(src: Source, reg: Reglages) {
  if (!(await src.estAdmin())) return { erreur: REFUS_ADMIN }
  const maintenant = reg.maintenant ?? Date.now()
  const [nombres, profilsL, cx, derniere, journal, sante] = await Promise.all([
    Promise.all(VOLUMES.map(([q]) => src.compter(q))),
    src.profils(),
    src.connexions(iso(maintenant - 30 * JOUR), BORNES.connexionsSessions),
    src.derniereEcriture(),
    src.journal(iso(maintenant - 7 * JOUR), BORNES.journalMax),
    src.sante(),
  ])
  const avertissements: string[] = []
  const volumes = VOLUMES.map(([, libelle], i) => (nombres[i] === null ? { table: libelle, lignes: null, precision: 'illisible avec ce compte' } : { table: libelle, lignes: nombres[i] }))
  // Comptes du staff par rôle (les comptes joueurs ne sont pas lisibles par le staff).
  const parRole = new Map<string, number>()
  for (const p of profilsL) if (p.role !== 'joueur') parRole.set(libelleRole(p.role), (parRole.get(libelleRole(p.role)) ?? 0) + 1)
  // Connexions : comptes distincts sur 24 h, 7 j, 30 j ; type d'appareil de la dernière ouverture de chacun (30 j).
  const derniere30 = new Map<string, { t: number; device?: string | null }>()
  for (const s of cx.sessions) {
    const t = tempsDe(s.lastSeenAt)
    if (t === undefined) continue
    const cur = derniere30.get(s.userId)
    if (!cur || t > cur.t) derniere30.set(s.userId, { t, device: s.device })
  }
  const depuis = (j: number) => [...derniere30.values()].filter((v) => v.t >= maintenant - j * JOUR).length
  const appareils = new Map<string, number>()
  let installee = 0
  for (const v of derniere30.values()) {
    const a = typeAppareil(v.device)
    appareils.set(a.appareil ?? 'inconnu', (appareils.get(a.appareil ?? 'inconnu') ?? 0) + 1)
    if (a.appli_installee) installee++
  }
  if (cx.tronque) avertissements.push(`Plus de ${BORNES.connexionsSessions} ouvertures de l’appli sur 30 jours : seules les plus récentes sont comptées.`)
  // Journal des questions (7 jours) : questions et échecs du mode avancé (le seul journal d'erreurs que l'appli envoie).
  const lignes7 = journal.lignes.filter((l) => !isAvisVocal(l) && l.kind !== 'avis')
  const s69 = 'ok' in sante ? lireSante069(sante.ok) : null
  if ('erreur' in sante) avertissements.push(`hb_admin_sante (069) a répondu par une erreur : ${clip(sansCoordonnees(sante.erreur, 200), 200)}.`)
  const indispo = s69 ? undefined : 'absente' in sante ? INDISPONIBLE_069 : 'indisponible (erreur de hb_admin_sante)'
  const t = tempsDe(derniere)
  return {
    maintenant: iso(maintenant),
    script_069: s69 ? 'appliqué' : 'absente' in sante ? 'pas appliqué' : 'erreur',
    volumes,
    comptes: { total: [...parRole.values()].reduce((a, b) => a + b, 0), par_role: [...parRole].sort((a, b) => b[1] - a[1]).map(([role, n]) => ({ role, nb: n })) },
    connexions: {
      comptes_24h: depuis(1),
      comptes_7j: depuis(7),
      comptes_30j: depuis(30),
      appareils_30j: [...appareils].sort((a, b) => b[1] - a[1]).map(([appareil, n]) => ({ appareil, nb: n })),
      appli_installee_30j: installee,
    },
    ...(derniere ? { derniere_ecriture: derniere, ...(t !== undefined ? { il_y_a: ilYA(maintenant - t) } : {}) } : {}),
    version_appli: 'indisponible : l’appli n’envoie pas son numéro de version (hb_connections ne garde que le type d’appareil).',
    journal_questions: { questions_7j: lignes7.length, erreurs_7j: lignes7.filter((l) => l.status === 'erreur').length },
    base: s69?.base ?? indispo,
    tables: s69?.tables ?? indispo,
    registre: s69 ? (s69.registre ?? 'registre des changements (061) absent') : indispo,
    charge: s69 ? (s69.charge ?? 'charge annoncée (061) absente') : indispo,
    abonnements: s69 ? (s69.abonnements ?? 'abonnements (026) absents') : indispo,
    veille: s69 ? (s69.veille ?? 'rappels de la veille (060) absents') : indispo,
    notifications: s69 ? (s69.notifications ?? 'notifications (026) absentes') : indispo,
    taches: s69 ? (s69.taches ?? 'tâches programmées (pg_cron) illisibles') : indispo,
    transcription: s69 ? (s69.transcription ?? 'quota de transcription (042) absent') : indispo,
    ...(s69 ? {} : { indisponible: ['base', 'tables', 'registre', 'charge', 'abonnements', 'veille', 'notifications', 'taches', 'transcription'] }),
    avertissements: [
      ...avertissements,
      'Volumes : lignes vivantes (non supprimées) lues avec le compte administrateur. Tables (069) : lignes estimées par les statistiques de Postgres. Aucune table de journal d’erreurs de l’appli : erreurs vues = échecs du mode avancé (journal des questions) et des tâches programmées (069).',
    ],
    message: 'État de l’installation : des nombres et des dates ; aucun compte, aucun jeton, aucune donnée de joueur.',
  }
}

// ---------- 9. nextar_admin_activite ----------

export interface ActiviteInput {
  jours?: number
  /** Début et fin calendaires (AAAA-MM-JJ = minuit à Paris, ou heure ISO) ; prioritaires sur `jours`. */
  depuis?: string
  jusqu_a?: string
  /** total (défaut : comme avant), jour ou heure (histogramme par compte, heure de Paris). */
  par?: 'total' | 'jour' | 'heure'
  inclure_generation?: boolean
  inactifs_jours?: number
  limite?: number
}

export async function outilAdminActivite(src: Source, reg: Reglages, input: ActiviteInput = {}) {
  if (!(await src.estAdmin())) return { erreur: REFUS_ADMIN }
  const jours = borne(input.jours, BORNES.joursDefaut, 1, BORNES.joursMax)
  const seuil = borne(input.inactifs_jours, BORNES.joursDefaut, 1, BORNES.joursMax)
  const limite = borne(input.limite, BORNES.activiteDefaut, 1, BORNES.activiteMax)
  const par = input.par === 'jour' || input.par === 'heure' ? input.par : 'total'
  const generation = input.inclure_generation === true
  const maintenant = reg.maintenant ?? Date.now()
  const per = lirePeriode(input.depuis || input.jusqu_a ? input : { depuis: iso(maintenant - jours * JOUR) }, maintenant, jours * JOUR, BORNES.joursMax)
  if ('erreur' in per) return { erreur: per.erreur }
  const depuis = iso(per.depuis)
  const calendaire = !!(input.depuis || input.jusqu_a)
  const tous = (await src.profils()).filter((p) => p.role && p.role !== 'joueur').sort((a, b) => nomAffiche(a).localeCompare(nomAffiche(b), 'fr'))
  const staff = tous.slice(0, BORNES.activiteComptes)
  const enStaff = new Set(staff.map((p) => p.userId))
  const vues = new Map((await src.dernieresVues()).map((v) => [v.userId, v.lastSeenAt]))
  const avertissements: string[] = [...per.avertissements]
  // Appels d'outils du serveur MCP (Claude) sur la période, par compte (072 ; absent : « canal » appli seulement).
  const mcp = await src.appelsMcp({ depuis, jusqua: iso(per.jusqua) }, BORNES.appelsMcpMax)
  const parMcp = new Map<string, { n: number; erreurs: number; dernier: number; outils: Map<string, number> }>()
  for (const a of mcp?.appels ?? []) {
    const t = tempsDe(a.at)
    if (t === undefined) continue
    const cur = parMcp.get(a.userId) ?? { n: 0, erreurs: 0, dernier: -Infinity, outils: new Map() }
    cur.n++
    if (!a.ok) cur.erreurs++
    cur.dernier = Math.max(cur.dernier, t)
    cur.outils.set(a.outil, (cur.outils.get(a.outil) ?? 0) + 1)
    parMcp.set(a.userId, cur)
  }
  if (!mcp) avertissements.push('Appels du serveur MCP (Claude) non journalisés tant que supabase/072_mcp_lecture_appels.sql n’est pas appliqué : canal « appli » seulement.')
  else if (mcp.tronque) avertissements.push(`Plus de ${BORNES.appelsMcpMax} appels du serveur MCP sur la période : seuls les plus récents sont comptés.`)
  // Comptages : agrégats dans la base (071), sinon comptes exacts (total, sans génération), sinon lignes lues (bornées).
  let parCompte: Map<string | null, LigneActivite> | null = null
  let via = 'comptages par compte (comme avant 071)'
  let ventilation = true
  const ags071 = await src.agregats({ depuis, jusqua: iso(per.jusqua), generation, par })
  if (ags071) {
    parCompte = construireActivite(ags071)
    via = 'agrégats dans la base (071)'
  } else if (par !== 'total' || generation) {
    const lu = await lireAgregats(src, { ...per, generation, par })
    parCompte = construireActivite(lu.ags)
    via = `lignes lues et agrégées par le serveur MCP (${INDISPONIBLE_071} pour les agrégats dans la base)`
    if (lu.tronque) avertissements.push(`Plus de ${BORNES.tracesMax} lignes par type sur la période : nombres calculés sur les plus récentes (partiels). Appliquer 071 pour des agrégats complets.`)
  } else ventilation = false
  const lus = await parLots(staff, 6, async (p) => {
    const [a, e] = await Promise.all([
      parCompte ? Promise.resolve(null) : src.activite(p.userId, depuis, { jusqua: iso(per.jusqua), sansGeneration: true }),
      src.derniereEcriture(p.userId),
    ])
    return { a, e }
  })
  const lignes = staff.map((p, i) => {
    const { a: compte, e } = lus[i]
    const l = parCompte?.get(p.userId)
    const a: ActiviteSrv = parCompte ? { avis: l?.avis ?? 0, mesures: l?.mesures ?? 0, evenements: l?.evenements ?? 0, vus: l?.vus ?? 0, fiches: l?.fiches ?? 0 } : compte!
    const m = parMcp.get(p.userId)
    const t = Math.max(tempsDe(vues.get(p.userId)) ?? -Infinity, tempsDe(e) ?? -Infinity, m?.dernier ?? -Infinity)
    const somme = (['avis', 'mesures', 'evenements', 'vus', 'fiches'] as (keyof ActiviteSrv)[]).reduce((s, k) => s + (a[k] ?? 0), 0)
    const appli = tempsDe(vues.get(p.userId)) !== undefined || somme > 0
    return { p, a, l, t: Number.isFinite(t) ? t : undefined, somme, m, appli }
  })
  const quandFmt = (t?: number) => (t === undefined ? { il_y_a: 'jamais vu' } : { derniere_activite: iso(t), il_y_a: ilYA(maintenant - t) })
  const extra = (l?: LigneActivite) => ({
    ...(ventilation ? { par_source: { ...(l?.parSource ?? {}) } } : {}),
    ...(par !== 'total' ? { histogramme: l ? histogramme(l, par) : [] } : {}),
  })
  // Canal : « appli » (ouvertures, écritures), « mcp » (appels d'outils par Claude sur la période), les deux, ou aucun.
  const canalDe = (appli: boolean, m?: { n: number }) => (appli && m?.n ? 'appli et mcp' : m?.n ? 'mcp' : appli ? 'appli' : 'aucun')
  const mcpFmt = (m?: { n: number; erreurs: number; dernier: number; outils: Map<string, number> }) =>
    mcp
      ? {
          appels_mcp: m?.n ?? 0,
          ...(m?.erreurs ? { appels_mcp_erreurs: m.erreurs } : {}),
          ...(m ? { dernier_appel_mcp: iso(m.dernier), dernier_appel_mcp_paris: paris(m.dernier), outils: [...m.outils].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([outil, nb]) => ({ outil, nb })) } : {}),
        }
      : {}
  type Rang = { somme: number; appels: number; t?: number; ligne: Record<string, unknown> }
  const rangs: Rang[] = lignes.map(({ p, a, l, t, somme, m, appli }) => ({
    somme,
    appels: m?.n ?? 0,
    t,
    ligne: { compte: codeCompte(p.userId), nom_affiche: nomAffiche(p), role: libelleRole(p.role), canal: canalDe(appli, m), avis: a.avis, mesures: a.mesures, evenements: a.evenements, vus: a.vus, fiches: a.fiches, ...mcpFmt(m), ...extra(l), ...quandFmt(t) },
  }))
  // Génération : une ligne « Générateur démo » (aucun compte), avec les comptes sous lesquels ses lignes ont été posées.
  const gen = parCompte?.get(null)
  if (generation && gen) {
    const somme = gen.avis + gen.mesures + gen.evenements + gen.vus + gen.fiches
    const profils = new Map(tous.map((p) => [p.userId, p]))
    rangs.push({
      somme,
      appels: 0,
      ligne: {
        ...GENERATEUR,
        avis: gen.avis, mesures: gen.mesures, evenements: gen.evenements, vus: gen.vus, fiches: gen.fiches,
        ...extra(gen),
        comptes_porteurs: [...gen.porteurs].sort((x, y) => y[1] - x[1]).slice(0, 10).map(([u, n]) => ({ compte: codeCompte(u), nom_affiche: profils.has(u) ? nomAffiche(profils.get(u)) : '(compte supprimé ou invisible)', nb: n })),
      },
    })
  }
  const triees = [...rangs].sort((x, y) => y.somme - x.somme || y.appels - x.appels || (y.t ?? 0) - (x.t ?? 0))
  const comptes = triees.slice(0, limite).map((r) => r.ligne)
  const inactifs = lignes
    .filter((l) => l.t === undefined || l.t < maintenant - seuil * JOUR)
    .sort((x, y) => (x.t ?? -Infinity) - (y.t ?? -Infinity))
  const total = (k: keyof ActiviteSrv) => lignes.reduce((s, l) => s + (l.a[k] ?? 0), 0)
  const illisibles = lignes.some((l) => Object.values(l.a).some((v) => v === null))
  const parSourceTotal: Record<string, number> = {}
  if (ventilation) for (const l of lignes) for (const [k, v] of Object.entries(l.l?.parSource ?? {})) parSourceTotal[k] = (parSourceTotal[k] ?? 0) + v
  const horsStaff = parCompte ? [...parCompte.keys()].filter((k) => k !== null && !enStaff.has(k)).length : 0
  return {
    periode_jours: Math.max(1, Math.ceil((per.jusqua - per.depuis) / JOUR)),
    depuis,
    ...(calendaire || par !== 'total' || generation ? { depuis_paris: paris(per.depuis), jusqu_a: iso(per.jusqua), jusqu_a_paris: paris(per.jusqua) } : {}),
    maintenant: iso(maintenant),
    par,
    inclure_generation: generation,
    via,
    total: tous.length,
    ...(tous.length > staff.length || rangs.length > comptes.length ? { tronque: true } : {}),
    totaux: { avis: total('avis'), mesures: total('mesures'), evenements: total('evenements'), vus: total('vus'), fiches: total('fiches'), ...(mcp ? { appels_mcp: lignes.reduce((s, l) => s + (l.m?.n ?? 0), 0) } : {}) },
    ...(ventilation ? { totaux_par_source: parSourceTotal } : { ventilation_source: `${INDISPONIBLE_071} (par: "jour" ou "heure" la donne sur les lignes lues).` }),
    ...(generation ? { totaux_generation: gen ? { avis: gen.avis, mesures: gen.mesures, evenements: gen.evenements, vus: gen.vus, fiches: gen.fiches } : { avis: 0, mesures: 0, evenements: 0, vus: 0, fiches: 0 } } : {}),
    ...(horsStaff ? { hors_staff: horsStaff } : {}),
    comptes,
    inactifs: {
      seuil_jours: seuil,
      total: inactifs.length,
      comptes: inactifs.slice(0, limite).map(({ p, t }) => ({ compte: codeCompte(p.userId), nom_affiche: nomAffiche(p), role: libelleRole(p.role), ...quandFmt(t) })),
    },
    avertissements: [
      ...avertissements,
      ...(tous.length > staff.length ? [`Plus de ${BORNES.activiteComptes} comptes du staff : seuls les ${BORNES.activiteComptes} premiers (ordre des noms) sont passés en revue.`] : []),
      ...(illisibles ? ['Certains nombres sont illisibles (null) : table absente ou refusée par la base.'] : []),
      ...(horsStaff ? [`${horsStaff} compte(s) hors staff (comptes joueurs, comptes supprimés ou sans rôle) ont créé des lignes : non comptés.`] : []),
      'Lignes CRÉÉES par chaque compte sur la période (auteur et heure posés par le serveur), encore présentes. Vus : joueur × événement. Génération (démos, jeux d’essai, lignes écrites par SQL) exclue sauf inclure_generation ; elle apparaît alors sous « Générateur démo ». Dernière activité : dernière ouverture de l’appli, dernière écriture à l’historique ou dernier appel d’outil par Claude (serveur MCP), la plus récente. Canal : appli, mcp (Claude), les deux, ou aucun sur la période. Comptes joueurs exclus.',
    ],
    message: 'Activité des comptes du staff (code, nom affiché, rôle) ; jamais d’adresse mail ni de donnée de joueur.',
  }
}

// ---------- 10. nextar_admin_questions ----------

export interface QuestionsInput {
  jours?: number
  filtre?: 'a_traiter' | 'toutes'
  limite?: number
}

export async function outilAdminQuestions(src: Source, reg: Reglages, input: QuestionsInput = {}) {
  if (!(await src.estAdmin())) return { erreur: REFUS_ADMIN }
  const jours = borne(input.jours, BORNES.joursDefaut, 1, BORNES.joursMax)
  const limite = borne(input.limite, BORNES.questionsDefaut, 1, BORNES.questionsMax)
  const filtre = input.filtre === 'toutes' ? 'toutes' : 'a_traiter'
  const maintenant = reg.maintenant ?? Date.now()
  const depuis = iso(maintenant - jours * JOUR)
  const journal = await src.journal(depuis, BORNES.journalMax)
  const lignes = journal.lignes.filter((l) => !isAvisVocal(l) && l.at >= depuis).map(versLigneJournal)
  const { questions: toutes, avis } = splitLog(lignes)
  const questions = toutes.filter((q) => q.phrase.trim())
  const aTraiter = filterEntries(questions, 'a_traiter', avis)
  const choisies = filtre === 'toutes' ? questions : aTraiter
  const issues = (xs: QuestionLogRow[]) => {
    const c = { rate: 0, sauvee: 0, complete: 0 }
    for (const q of xs) c[outcomeOf(q)]++
    return c
  }
  const verdicts = (xs: QuestionLogRow[]) => {
    const c = { super: 0, mauvaise: 0, sans_reponse: 0 }
    for (const q of xs) for (const a of avis.get(q.id) ?? []) if (a.verdict && a.verdict in c) c[a.verdict as keyof typeof c]++
    return c
  }
  const comptes = (xs: QuestionLogRow[]) => new Set(xs.map((q) => q.authorId).filter(Boolean)).size
  const io = issues(questions)
  const parPage = new Map<string, number>()
  for (const q of choisies) parPage.set(clip(q.page || 'question', 40), (parPage.get(clip(q.page || 'question', 40)) ?? 0) + 1)
  const base = {
    periode_jours: jours,
    depuis,
    maintenant: iso(maintenant),
    filtre: filtre === 'toutes' ? 'toutes les questions' : 'à traiter (pas comprises en entier, ou jugées « mauvaise réponse » / « pas de réponse », pas encore transformées en recette)',
    resume: {
      questions: questions.length,
      a_traiter: aTraiter.length,
      ratees: io.rate,
      sauvees: io.sauvee,
      comprises: io.complete,
      comptes: comptes(questions),
      avis: verdicts(questions),
    },
    par_page: [...parPage].sort((a, b) => b[1] - a[1]).map(([page, n]) => ({ page, nb: n })),
  }
  const avert = journal.tronque ? [`Plus de ${BORNES.journalMax} lignes au journal sur la période : seules les plus récentes sont lues.`] : []
  // Masquage des noms : la liste ENTIÈRE des fiches du périmètre, sinon aucune formulation ne sort.
  const noms = choisies.length ? await src.nomsJoueurs(BORNES.nomsMax) : { joueurs: [], tronque: false }
  if (noms.tronque)
    return {
      ...base,
      groupes: [],
      masquage: `Plus de ${BORNES.nomsMax} fiches : le masquage des noms de joueurs ne peut pas être garanti, aucune formulation n’est rendue (seulement les nombres et les pages).`,
      avertissements: [...avert, 'Formulations non rendues : trop de fiches pour vérifier qu’aucun nom de joueur n’y figure.'],
    }
  const [crits, evs, grs] = choisies.length ? await Promise.all([src.criteres(), src.evenements({ archives: true }), src.groupes({ archives: true })]) : [[], [], []]
  const masque = masqueNoms(noms.joueurs, [...crits.map((c) => c.label), ...crits.map((c) => c.category ?? ''), ...evs.map((e) => e.name), ...grs.map((g) => g.name)])
  // Masquer AVANT de regrouper : le regroupement (src/questionLogCore.ts, groupEntries) ne voit que des phrases masquées.
  const masquees = choisies.map((q) => ({ ...q, phrase: masque.texte(q.phrase, 300) }))
  const groupes = groupEntries(masquees, filtre === 'toutes' ? 'frequentes' : 'rates')
  return {
    ...base,
    total: groupes.length,
    ...(groupes.length > limite ? { tronque: true } : {}),
    groupes: groupes.slice(0, limite).map((g) => {
      const v = verdicts(g.entries)
      const voulu = uniq(g.entries.flatMap((e) => (avis.get(e.id) ?? []).map((a) => a.comment)).filter((c): c is string => !!c?.trim()).map((c) => masque.texte(c, 200)))
      const manque = uniq(g.entries.flatMap((e) => e.recipeMissing ?? []).map((m) => masque.texte(m, 120)).filter(Boolean))
      const rec = { complete: 0, partielle: 0, pas_comprise: 0 }
      for (const e of g.entries) rec[e.recipe]++
      const avance = g.entries.filter((e) => e.status)
      return {
        formulation: g.phrases[0].phrase,
        ...(g.phrases.length > 1 ? { autres_formulations: g.phrases.slice(1, 4).map((p) => p.phrase) } : {}),
        nb: g.entries.length,
        comptes: comptes(g.entries),
        issue: OUTCOME_LABEL[g.outcome],
        recette: rec,
        ...(avance.length ? { mode_avance: { lance: avance.length, reponse_calculee: avance.filter((e) => e.status === 'ok').length } } : {}),
        ...(v.super + v.mauvaise + v.sans_reponse ? { avis: v } : {}),
        ...(manque.length ? { pas_applique: manque.slice(0, 5) } : {}),
        ...(voulu.length ? { ce_qu_ils_voulaient: voulu.slice(0, 3) } : {}),
        pages: uniq(g.entries.map((e) => clip(e.page || 'question', 40))),
        derniere: g.last,
        ...(g.done ? { transformee: true } : {}),
      }
    }),
    masquage: `Noms de joueurs remplacés par [joueur] côté serveur (${masque.noms} prénoms et noms connus, jamais rendus) ; mots propres inconnus : [nom] ; licences : [licence]. Un nom mal orthographié en minuscules peut échapper au masquage.`,
    avertissements: [...avert, 'Formulations regroupées par phrase semblable (comme Réglages › Journal des questions). Comptes : nombre de comptes distincts, jamais leurs noms.'],
  }
}
