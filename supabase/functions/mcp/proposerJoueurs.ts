// Nextar, serveur MCP : trois outils qui DÉPOSENT des propositions sur des joueurs dans la boîte « À valider » du coach
// (hb_propositions, sortes « avis », « vus » et « a_revoir », déjà prévues par supabase/067_propositions.sql : aucun SQL) :
//  - nextar_proposer_avis     : « voici mes notes du match, mets les avis » : notes par critère d'avis (identifiants de
//                               nextar_contexte, échelle du critère, poste du joueur), date, événement facultatif, points
//                               forts et axes de progression facultatifs (texte du coach, borné, jamais renvoyé) ;
//  - nextar_proposer_vus      : « marque vus les joueurs de cette feuille » pour un événement ;
//  - nextar_proposer_a_revoir : « mets à revoir ces joueurs », raison courte facultative.
// Trois outils plutôt qu'un paramètre « sorte » : un schéma par geste, plus clair pour un modèle ; nextar_proposer reste
// l'outil des mesures, inchangé.
// Comme nextar_proposer : Nextar rapproche lui-même les joueurs (nom lu sur la feuille, n° de maillot, année, ou code J-…),
// dans l'événement, le groupe ou toute la base du coach (aux droits du coach), et ne rend par ligne que « trouvé » + code,
// « à vérifier », « plusieurs possibles » (un nombre) ou « introuvable », ou « refusée » avec la raison. JAMAIS un nom, ni
// le texte du coach (points forts, axes, raison), ni un en-tête : la réponse passe par la liste blanche (outils.ts,
// verifierSortie). RIEN n'est écrit dans les fiches : le coach ouvre la proposition dans l'appli (noms remis sur l'appareil,
// joueur modifiable), coche, puis « Enregistrer N avis » / « Marquer N vus » / « Mettre N à revoir » : l'appli passe par ses
// propres chemins (src/propositionsJoueurs.ts), avec les mêmes droits et la même synchronisation.
// Format des lignes déposées : src/propositionsJoueursCore.ts (copie générée dans partage/). Fichier sans import Deno
// (testable avec npx jiti, tools/test-mcp.ts).

import { indexCodes, normaliserCode } from './partage/codesJoueurs.ts'
import { matchPlayer, type Candidate, type PlayerMatch } from './partage/importMesures.ts'
import {
  controleNote,
  estDate,
  JOUEURS_LIMITES,
  texteCoach,
  texteCourt,
  texteEchelle,
  TYPES_CONTEXTE,
  vautPourPoste,
  type ContexteJoueurs,
  type LigneAReVoir,
  type LigneAvis,
  type LigneJoueur,
  type SorteJoueurs,
  type TypeContexte,
} from './partage/propositionsJoueursCore.ts'
import { BORNES, clip, critere, etatLigne, indexPrefiltre, lienBoite, prefiltrer, trouverParNom, uniq, type CritereSrv, type Reglages, type Source } from './outils.ts'

/** Un joueur tel que Claude l'a lu : nom écrit (ou code J-…), n° de maillot, année. */
export interface DemandeJoueur {
  /** Nom tel qu'écrit sur la feuille (« MARTIN Lucas », « Lucas M. »), ou code « J-… » (nextar_lire). */
  joueur?: string
  nom?: string
  prenom?: string
  numero?: string | number
  annee?: string | number
}

export interface ProposerAvisInput {
  titre?: string
  /** Date des avis (AAAA-MM-JJ) ; défaut : la date de l'événement, sinon aujourd'hui. */
  date?: string
  evenement?: string
  groupe?: string
  /** Avis hors événement : contexte (défaut « match ») et lieu. */
  contexte?: string
  lieu?: string
  lignes?: (DemandeJoueur & { notes?: Record<string, unknown>; date?: string; points_forts?: string; axes_de_progression?: string })[]
}

export interface ProposerVusInput {
  titre?: string
  evenement?: string
  lignes?: DemandeJoueur[]
}

export interface ProposerAReVoirInput {
  titre?: string
  evenement?: string
  groupe?: string
  lignes?: (DemandeJoueur & { raison?: string })[]
}

type Retour = Record<string, unknown> & { ligne: number; etat: string }

const ETAT_REFUSEE = 'refusée'

/** Où chercher les joueurs : l'événement, le groupe, ou toute la base (aux droits du coach). */
async function portee(src: Source, o: { evenement?: string; groupe?: string }) {
  if (o.evenement && o.groupe) return { erreur: 'Donne un événement OU un groupe, pas les deux.' }
  if (o.evenement) {
    const f = trouverParNom(await src.evenements({ archives: true }), o.evenement)
    if ('erreur' in f) return f
    const ev = (await src.evenement(f.ok.id)) ?? f.ok
    return { portee: 'evenement' as const, id: ev.id, nom: ev.name, date: estDate(ev.date) ? ev.date : undefined, ids: uniq(ev.playerIds ?? []), nums: ev.nums }
  }
  if (o.groupe) {
    const f = trouverParNom(await src.groupes({ archives: true }), o.groupe)
    if ('erreur' in f) return f
    const g = (await src.groupe(f.ok.id)) ?? f.ok
    return { portee: 'groupe' as const, id: g.id, nom: g.name, ids: uniq(g.playerIds ?? []) }
  }
  return { portee: 'tous' as const, ids: null as string[] | null }
}

interface Rapprochement {
  n: number
  /** Ce qui est gardé dans la proposition (nom écrit, n°, année, code, fiche sûre, fiches possibles). */
  ligne: LigneJoueur
  match: PlayerMatch
  /** Raison d'un refus de la ligne (rien de lisible). */
  refus?: string
}

/**
 * Rapproche chaque ligne d'un joueur des candidats (noms lus côté serveur, jamais rendus) : code J-… résolu sur les
 * identifiants, sinon nom écrit, n° de maillot et année (matchPlayer de « Coller un tableau ») ; grande base : premier tri
 * sur le son des noms. Deux lignes pour la même fiche : toutes deux à vérifier.
 */
export function rapprocherLignes(demandes: readonly DemandeJoueur[], cands: readonly Candidate[]): Rapprochement[] {
  const grand = cands.length > BORNES.prefiltre
  const index = grand ? indexPrefiltre(cands) : null
  const parCode = indexCodes(cands.map((c) => c.id))
  const out = demandes.map((d, i): Rapprochement => {
    const n = i + 1
    const ecrit = texteCourt(d.joueur, JOUEURS_LIMITES.nom)
    const code = normaliserCode(ecrit)
    const numero = texteCourt(d.numero, 6)
    const anneeTxt = texteCourt(d.annee, 4)
    const annee = /^\d{4}$/.test(anneeTxt) ? +anneeTxt : undefined
    if (code) {
      const ids = parCode.get(code) ?? []
      const match: PlayerMatch =
        ids.length === 1
          ? { playerId: ids[0], confidence: 'sur', others: [], why: 'code' }
          : ids.length > 1
            ? { playerId: ids[0], confidence: 'verifier', others: ids.slice(1), why: 'code partagé' }
            : { confidence: 'introuvable', others: [], why: 'code inconnu ici' }
      return { n, ligne: { n, code, confiance: match.confidence }, match }
    }
    const nom = texteCourt([d.prenom, d.nom].map((x) => texteCourt(x, 60)).filter(Boolean).join(' ') || ecrit, JOUEURS_LIMITES.nom)
    if (!nom && !numero) return { n, ligne: { n, confiance: 'introuvable' }, match: { confidence: 'introuvable', others: [], why: 'pas de nom' }, refus: 'ni nom, ni n° de maillot, ni code' }
    const pool = index ? prefiltrer(nom, cands, index) : cands
    const match = matchPlayer({ name: nom, num: numero || undefined, year: annee }, pool)
    return { n, ligne: { n, ...(nom ? { nom } : {}), ...(numero ? { numero } : {}), ...(annee ? { annee } : {}), confiance: match.confidence }, match }
  })
  const parFiche = new Map<string, number>()
  for (const r of out) if (!r.refus && r.match.confidence === 'sur' && r.match.playerId) parFiche.set(r.match.playerId, (parFiche.get(r.match.playerId) ?? 0) + 1)
  for (const r of out) {
    if (r.match.playerId && r.match.confidence === 'sur' && (parFiche.get(r.match.playerId) ?? 0) > 1) r.match = { ...r.match, confidence: 'verifier', why: 'deux lignes pour la même fiche' }
    const m = r.match
    r.ligne = {
      ...r.ligne,
      confiance: m.confidence,
      ...(m.confidence === 'sur' && m.playerId ? { joueur: m.playerId } : {}),
      ...(m.confidence === 'verifier' ? { possibles: uniq([m.playerId, ...m.others].filter((x): x is string => !!x)).slice(0, JOUEURS_LIMITES.possibles) } : {}),
    }
  }
  return out
}

/** Contexte commun : périmètre, joueurs lus (noms côté serveur), lignes rapprochées. */
async function preparer(src: Source, sorte: SorteJoueurs, input: { evenement?: string; groupe?: string; lignes?: unknown[] }) {
  const lignes = Array.isArray(input.lignes) ? input.lignes.map((l) => (l && typeof l === 'object' && !Array.isArray(l) ? (l as DemandeJoueur) : {})) : []
  const max = JOUEURS_LIMITES.lignes[sorte]
  if (!lignes.length) return { erreur: 'Aucune ligne : donne `lignes`, un joueur par ligne.' }
  if (lignes.length > max) return { erreur: `Trop de lignes : ${max} joueurs au plus par proposition (${lignes.length} reçus) ; découpe en plusieurs.` }
  const p = await portee(src, input)
  if ('erreur' in p) return p
  // Vus : l'événement d'abord ; s'il n'a encore aucun joueur, toute la base.
  const ids = p.ids && !p.ids.length && sorte === 'vus' ? null : p.ids
  const lus = ids && !ids.length ? { joueurs: [], tronque: false } : await src.joueursNoms(ids, ids ? Math.max(ids.length, 1) : BORNES.rapprochementTous)
  const nums = 'nums' in p ? p.nums : undefined
  const cands: Candidate[] = lus.joueurs.map((j) => ({ id: j.id, firstName: j.firstName, lastName: j.lastName, birthDate: j.birthDate, ...(nums?.[j.id] ? { num: nums[j.id] } : {}) }))
  const partages = new Set([...indexCodes(cands.map((c) => c.id))].filter(([, v]) => v.length > 1).map(([c]) => c))
  const trop = !ids && lus.tronque
  return { p, ids, cands, partages, trop, rapproches: rapprocherLignes(lignes, cands), demandes: lignes }
}

/** État d'une ligne pour Claude (code seulement si sûr), comme nextar_proposer. */
const etatDe = (r: Rapprochement, partages: Set<string>, trop: boolean) => (trop ? { etat: 'à rapprocher dans Nextar' } : etatLigne(r.match, partages))

function resumeDe(retours: readonly Retour[]) {
  const n = (e: string) => retours.filter((l) => l.etat === e).length
  return { trouves: n('trouvé'), a_verifier: n('à vérifier'), plusieurs: n('plusieurs possibles'), introuvables: n('introuvable'), refusees: n(ETAT_REFUSEE) }
}

const libellePortee = (p: { portee: string; nom?: string }) => (p.portee === 'tous' ? 'toute la base' : `${p.portee === 'evenement' ? 'événement' : 'groupe'} « ${clip(p.nom, 120)} »`)
const jm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

const MESSAGE =
  'Proposition déposée dans la boîte « À valider » de Nextar : rien n’est enregistré avant que le coach valide dans l’appli ' +
  '(noms remis sur son appareil, joueur modifiable). Les noms et les textes ne sont jamais renvoyés ; un code désigne un joueur trouvé.'

/** Dépôt commun et réponse. */
async function deposer(
  src: Source,
  reg: Reglages,
  o: {
    sorte: SorteJoueurs
    titre: string
    contexte: ContexteJoueurs
    gardees: LigneJoueur[]
    retours: Retour[]
    p: { portee: string; nom?: string }
    date?: string
    avertissements: string[]
    trop: boolean
  },
) {
  const resume = resumeDe(o.retours)
  const commun = { titre: o.titre, sorte: o.sorte, portee: libellePortee(o.p), ...(o.date ? { date: o.date } : {}), lignes: o.retours, resume }
  const avertissements = [
    ...(o.trop ? [`Plus de ${BORNES.rapprochementTous} joueurs dans le périmètre : les joueurs seront rapprochés dans l’appli à l’ouverture. Préciser un événement ou un groupe aide.`] : []),
    ...o.avertissements,
    ...(resume.refusees ? [`${resume.refusees} ligne(s) refusée(s) : non déposée(s) (raison donnée ligne par ligne).`] : []),
  ]
  if (!o.gardees.length) return { etat: 'non déposée', ...commun, message: 'Aucune ligne utilisable : rien n’a été déposé. Les raisons sont données ligne par ligne.', avertissements }
  const contexte = { ...o.contexte, ...(o.contexte.joueurs && o.contexte.joueurs.length > BORNES.joueursContexte ? { joueurs: undefined } : {}) }
  const dep = await src.deposerProposition({ titre: o.titre, contexte: JSON.parse(JSON.stringify(contexte)), lignes: o.gardees as unknown as Record<string, unknown>[], kind: o.sorte })
  if ('erreur' in dep) return { erreur: `Proposition non déposée : ${clip(dep.erreur, 300)}`, etat: 'non déposée', ...commun }
  return { id: dep.id, etat: 'en_attente', ...commun, lien_boite: lienBoite(reg), message: MESSAGE, avertissements }
}

const contexteDe = (sorte: SorteJoueurs, p: { portee: 'evenement' | 'groupe' | 'tous'; id?: string; nom?: string }, ids: string[] | null): ContexteJoueurs => ({
  sorte,
  version: 1,
  portee: p.portee,
  ...(p.id ? { id: p.id } : {}),
  ...(p.nom ? { nom: clip(p.nom, 120) } : {}),
  ...(ids && ids.length <= BORNES.joueursContexte ? { joueurs: ids } : {}),
})

// ---------- nextar_proposer_avis ----------

export async function outilProposerAvis(src: Source, reg: Reglages, input: ProposerAvisInput = {}) {
  if (input.date !== undefined && !estDate(input.date)) return { erreur: '`date` : une date AAAA-MM-JJ.' }
  const typeContexte = input.contexte === undefined ? undefined : TYPES_CONTEXTE.find((t) => t === input.contexte)
  if (input.contexte !== undefined && !typeContexte) return { erreur: `\`contexte\` inconnu : ${TYPES_CONTEXTE.join(', ')}.` }
  const prep = await preparer(src, 'avis', input)
  if ('erreur' in prep) return prep
  const { p, ids, partages, trop, rapproches } = prep
  if (p.portee === 'evenement' && (typeContexte || input.lieu)) return { erreur: '`contexte` et `lieu` servent aux avis hors événement : avec un événement, ne les donne pas.' }
  const crits = (await src.criteres()).filter((c) => !c.deleted && c.active !== false && c.kind === 'subjective')
  if (!crits.length) return { erreur: 'Aucun critère d’avis dans cette installation : rien à noter.' }
  const date = input.date ?? ('date' in p && p.date ? p.date : reg.today)
  // Poste des fiches sûres (règle « critère pour ce poste ») ; les autres sont revues par le coach dans l'appli.
  const surs = uniq(rapproches.filter((r) => r.match.confidence === 'sur' && r.match.playerId).map((r) => r.match.playerId!))
  const postes = new Map((surs.length ? (await src.joueursLire({ ids: surs }, surs.length)).joueurs : []).map((j) => [j.id, j.poste]))
  const retours: Retour[] = []
  const gardees: LigneAvis[] = []
  const avertissements: string[] = []
  for (const r of rapproches) {
    const d = (prep.demandes[r.n - 1] ?? {}) as NonNullable<ProposerAvisInput['lignes']>[number]
    if (r.refus) {
      retours.push({ ligne: r.n, etat: ETAT_REFUSEE, raison: r.refus })
      continue
    }
    const poste = r.match.confidence === 'sur' && r.match.playerId ? postes.get(r.match.playerId) : undefined
    const notes: Record<string, number | string> = {}
    const refusees: { critere: string; raison: string }[] = []
    const brutes = d.notes && typeof d.notes === 'object' && !Array.isArray(d.notes) ? Object.entries(d.notes) : []
    if (brutes.length > JOUEURS_LIMITES.notes) refusees.push({ critere: '…', raison: `${JOUEURS_LIMITES.notes} notes au plus par joueur : les suivantes sont ignorées` })
    for (const [k, v] of brutes.slice(0, JOUEURS_LIMITES.notes)) {
      const c: CritereSrv | undefined = critere(k, crits)
      const nomCrit = clip(k, 80)
      if (!c) refusees.push({ critere: nomCrit, raison: 'critère d’avis inconnu (identifiants : nextar_contexte, criteres_avis)' })
      else if (notes[c.id] !== undefined) refusees.push({ critere: c.id, raison: 'critère noté deux fois' })
      else if (!vautPourPoste(c.positions, poste)) refusees.push({ critere: c.id, raison: `pas pour ce poste (critère des postes ${(c.positions ?? []).join(', ')})` })
      else {
        const x = controleNote(c, v)
        if ('raison' in x) refusees.push({ critere: c.id, raison: x.raison })
        else notes[c.id] = x.ok
      }
    }
    const forts = texteCoach(d.points_forts)
    const progres = texteCoach(d.axes_de_progression)
    const trops = [forts && forts.length > JOUEURS_LIMITES.texte ? 'points forts' : '', progres && progres.length > JOUEURS_LIMITES.texte ? 'axes de progression' : ''].filter(Boolean)
    if (trops.length) {
      retours.push({ ligne: r.n, etat: ETAT_REFUSEE, raison: `${trops.join(' et ')} trop long(s) : ${JOUEURS_LIMITES.texte} signes au plus` })
      continue
    }
    if (d.date !== undefined && !estDate(d.date)) {
      retours.push({ ligne: r.n, etat: ETAT_REFUSEE, raison: 'date de la ligne illisible (AAAA-MM-JJ)' })
      continue
    }
    const nb = Object.keys(notes).length
    if (!nb && !forts && !progres) {
      retours.push({ ligne: r.n, etat: ETAT_REFUSEE, raison: 'aucune note valable ni texte', ...(refusees.length ? { notes_refusees: refusees } : {}) })
      continue
    }
    gardees.push({ ...r.ligne, notes, ...(d.date ? { date: d.date } : {}), ...(forts ? { forts } : {}), ...(progres ? { progres } : {}) })
    retours.push({
      ligne: r.n,
      ...etatDe(r, partages, trop),
      nb_notes: nb,
      ...(forts || progres ? { avec_texte: true } : {}),
      ...(d.date && d.date !== date ? { date: d.date } : {}),
      ...(refusees.length ? { notes_refusees: refusees } : {}),
    })
  }
  if (rapproches.some((r) => r.match.confidence !== 'sur')) avertissements.push('Pour les joueurs à vérifier ou introuvables, le poste n’est pas connu : le coach revoit les critères dans l’appli.')
  const titre =
    clip(input.titre?.trim() || `Avis du ${jm(date)}${p.portee !== 'tous' ? ` · ${p.nom}` : ''}`, BORNES.titreProposition) || 'Avis à valider'
  const contexte: ContexteJoueurs = {
    ...contexteDe('avis', p, ids),
    date,
    ...(p.portee !== 'evenement' ? { typeContexte: (typeContexte ?? 'match') as TypeContexte } : {}),
    ...(p.portee !== 'evenement' && texteCourt(input.lieu, JOUEURS_LIMITES.lieu) ? { lieu: texteCourt(input.lieu, JOUEURS_LIMITES.lieu) } : {}),
  }
  const out = await deposer(src, reg, { sorte: 'avis', titre, contexte, gardees, retours, p, date, avertissements, trop })
  return p.portee === 'evenement' ? out : { ...out, contexte_avis: `hors événement : ${contexte.typeContexte}` }
}

// ---------- nextar_proposer_vus ----------

export async function outilProposerVus(src: Source, reg: Reglages, input: ProposerVusInput = {}) {
  if (!input.evenement?.trim()) return { erreur: '`evenement` est obligatoire : les joueurs sont marqués vus à un événement (identifiant ou nom de nextar_contexte).' }
  const prep = await preparer(src, 'vus', { evenement: input.evenement, lignes: input.lignes })
  if ('erreur' in prep) return prep
  const { p, ids, partages, trop, rapproches } = prep
  const retours: Retour[] = []
  const gardees: LigneJoueur[] = []
  for (const r of rapproches) {
    if (r.refus) {
      retours.push({ ligne: r.n, etat: ETAT_REFUSEE, raison: r.refus })
      continue
    }
    gardees.push(r.ligne)
    retours.push({ ligne: r.n, ...etatDe(r, partages, trop) })
  }
  const titre = clip(input.titre?.trim() || `Vus · ${p.nom ?? 'événement'}`, BORNES.titreProposition) || 'Vus à valider'
  const avertissements = !ids ? ['L’événement n’a encore aucun joueur : ils ont été cherchés dans toute la base.'] : []
  const contexte: ContexteJoueurs = { ...contexteDe('vus', p, ids), ...('date' in p && p.date ? { date: p.date } : {}) }
  return deposer(src, reg, { sorte: 'vus', titre, contexte, gardees, retours, p, date: contexte.date, avertissements, trop })
}

// ---------- nextar_proposer_a_revoir ----------

export async function outilProposerAReVoir(src: Source, reg: Reglages, input: ProposerAReVoirInput = {}) {
  const prep = await preparer(src, 'a_revoir', input)
  if ('erreur' in prep) return prep
  const { p, ids, partages, trop, rapproches } = prep
  const retours: Retour[] = []
  const gardees: LigneAReVoir[] = []
  for (const r of rapproches) {
    const d = (prep.demandes[r.n - 1] ?? {}) as NonNullable<ProposerAReVoirInput['lignes']>[number]
    if (r.refus) {
      retours.push({ ligne: r.n, etat: ETAT_REFUSEE, raison: r.refus })
      continue
    }
    const raison = texteCoach(d.raison)
    if (raison && raison.length > JOUEURS_LIMITES.raison) {
      retours.push({ ligne: r.n, etat: ETAT_REFUSEE, raison: `raison trop longue : ${JOUEURS_LIMITES.raison} signes au plus` })
      continue
    }
    gardees.push({ ...r.ligne, ...(raison ? { raison } : {}) })
    retours.push({ ligne: r.n, ...etatDe(r, partages, trop), ...(raison ? { avec_raison: true } : {}) })
  }
  const titre = clip(input.titre?.trim() || `À revoir${p.portee !== 'tous' ? ` · ${p.nom}` : ` (${gardees.length})`}`, BORNES.titreProposition) || 'À revoir'
  return deposer(src, reg, { sorte: 'a_revoir', titre, contexte: contexteDe('a_revoir', p, ids), gardees, retours, p, avertissements: [], trop })
}

/** Échelles en mots, pour les descriptions d'outils (« 1 à 5 »…). */
export const ECHELLES_TEXTE = `score5 : ${texteEchelle('score5')} ; score3 : ${texteEchelle('score3')} ; score2 : ${texteEchelle('score2')}`
