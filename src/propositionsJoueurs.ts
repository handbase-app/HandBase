import { markWithUndo, type MarkDeps } from './askAction'
import { indexCodes } from './codesJoueurs'
import { matchPlayer, type Candidate, type PlayerMatch } from './importMesures'
import { etatApresValidation, type PropEtat } from './propositionsCore'
import {
  controleNote,
  lireContexte,
  lireLigne,
  type ContexteJoueurs,
  type LigneAReVoir,
  type LigneAvis,
  type LigneSorte,
  type SorteJoueurs,
} from './propositionsJoueursCore'

/*
 * Boîte « À valider » : propositions sur des JOUEURS préparées par Claude (avis, vus, à revoir ; format :
 * src/propositionsJoueursCore.ts ; serveur MCP : supabase/functions/mcp/proposerJoueurs.ts ; écran :
 * src/components/PropositionsJoueurs.tsx). Règles PURES, testées par tools/test-propositions.ts avec de faux chemins :
 * rapprochement sur l'appareil, ce qui sera enregistré, application des lignes cochées et « Défaire ».
 *
 * L'enregistrement passe par les MÊMES chemins que l'appli, reçus en `DepsJoueurs` (l'écran les branche), donc avec les mêmes
 * droits et la même synchronisation :
 *  - avis     : saveEvaluation (src/avisSave.ts, sorti de l'écran d'avis : validation, auteur, joueur ajouté à l'événement) ;
 *               mon avis déjà là sur ce joueur à cet événement est complété (notes ajoutées ou remplacées, textes ajoutés),
 *               comme le ferait l'écran d'avis ; trace « importé, validé par … » (champ `imported`, comme les mesures) ;
 *  - vus      : markSeenMany (« Marquer vu à cet événement ») ;
 *  - à revoir : addRewatchMany (« Mettre à revoir » de la sélection), raison gardée comme commentaire ;
 * vus et à revoir passent par markWithUndo (src/askAction.ts), comme la barre Demander : « Défaire » ne retire que les
 * marques que l'action vient de poser. Avis : « Défaire » retire les avis créés, remet les avis complétés comme avant, et
 * retire de la liste de l'événement le joueur que l'enregistrement y avait ajouté.
 */

/** Une ligne de la proposition, lue, et son rapprochement sur l'appareil. */
export interface LigneRevue {
  /** Rang dans la proposition (0…). */
  i: number
  ligne: LigneSorte
  match: PlayerMatch
}

const uniq = <T>(xs: Iterable<T>) => [...new Set(xs)]

/** Lignes lisibles d'une proposition (les autres sont ignorées). */
export function lignesDe(sorte: SorteJoueurs, lignes: readonly unknown[]): { i: number; ligne: LigneSorte }[] {
  return lignes.flatMap((l, i) => {
    const x = lireLigne(sorte, l)
    return x ? [{ i, ligne: x }] : []
  })
}

/** Sorte et contexte d'une proposition sur des joueurs ; autre chose : null. */
export const contexteJoueurs = (kind: string, ctx: unknown): ContexteJoueurs | null => {
  const c = lireContexte({ ...(ctx && typeof ctx === 'object' ? ctx : {}), sorte: kind })
  return c && c.sorte === kind ? c : null
}

/**
 * Rapprochement SUR L'APPAREIL (le serveur a fait le sien ; on le refait sur les fiches de l'appareil, dans le même
 * périmètre) : code J-… résolu sur les fiches, sinon la fiche sûre du serveur si elle est là, sinon nom, n° et année
 * (matchPlayer de « Coller un tableau »), avec les fiches possibles du serveur en renfort. Deux lignes pour la même fiche :
 * toutes deux à vérifier.
 */
export function rapprocherSurAppareil(lignes: readonly { i: number; ligne: LigneSorte }[], cands: readonly Candidate[]): LigneRevue[] {
  const ici = new Set(cands.map((c) => c.id))
  const parCode = indexCodes(cands.map((c) => c.id))
  const out = lignes.map(({ i, ligne: l }): LigneRevue => {
    const possibles = (l.possibles ?? []).filter((x) => ici.has(x))
    if (l.code) {
      const ids = parCode.get(l.code) ?? []
      const match: PlayerMatch =
        ids.length === 1
          ? { playerId: ids[0], confidence: 'sur', others: [], why: 'code de Claude' }
          : ids.length > 1
            ? { playerId: ids[0], confidence: 'verifier', others: ids.slice(1), why: 'code partagé par plusieurs fiches' }
            : { confidence: 'introuvable', others: [], why: 'code inconnu sur cet appareil' }
      return { i, ligne: l, match }
    }
    if (l.joueur && ici.has(l.joueur) && l.confiance === 'sur') return { i, ligne: l, match: { playerId: l.joueur, confidence: 'sur', others: [], why: 'trouvé par Nextar' } }
    const m = l.nom || l.numero ? matchPlayer({ name: l.nom ?? '', num: l.numero, year: l.annee }, cands) : { confidence: 'introuvable' as const, others: [], why: 'pas de nom' }
    if (m.confidence === 'introuvable' && possibles.length) return { i, ligne: l, match: { playerId: possibles[0], confidence: 'verifier', others: possibles.slice(1), why: 'possible selon Nextar' } }
    return { i, ligne: l, match: { ...m, others: uniq([...m.others, ...possibles.filter((x) => x !== m.playerId)]).slice(0, 5) } }
  })
  const parFiche = new Map<string, number>()
  for (const r of out) if (r.match.playerId && r.match.confidence === 'sur') parFiche.set(r.match.playerId, (parFiche.get(r.match.playerId) ?? 0) + 1)
  for (const r of out) if (r.match.playerId && r.match.confidence === 'sur' && (parFiche.get(r.match.playerId) ?? 0) > 1) r.match = { ...r.match, confidence: 'verifier', why: 'deux lignes pour la même fiche' }
  return out
}

/** Choix du coach : joueur changé (« » : ne pas importer) et cases cochées ou décochées à la main. */
export interface ChoixJoueurs {
  players?: Record<number, string>
  checks?: Record<number, boolean>
}

/** Fiche retenue pour une ligne (choix du coach d'abord) ; « » ou absente : aucune. */
export const ficheDe = (r: LigneRevue, c: ChoixJoueurs) => (c.players && r.i in c.players ? c.players[r.i] || undefined : r.match.playerId)

/** Ligne cochée ? D'office : joueur sûr ou choisi à la main ; jamais sans joueur. */
export function cochee(r: LigneRevue, c: ChoixJoueurs): boolean {
  if (!ficheDe(r, c)) return false
  if (c.checks && r.i in c.checks) return !!c.checks[r.i]
  return r.match.confidence === 'sur' || !!(c.players && r.i in c.players)
}

/** Critère d'avis tel que l'appareil le connaît. */
export interface CritereAvis {
  id: string
  label: string
  scale?: string
  options?: string[]
}

/** Notes d'une ligne d'avis reprises sur l'appareil, et celles laissées de côté (critère absent, plus pour ce poste…). */
export function notesReprises(
  l: LigneAvis,
  crits: ReadonlyMap<string, CritereAvis>,
  vaut: (critereId: string) => boolean,
): { scores: Record<string, number | string>; ecartees: { critere: string; raison: string }[] } {
  const scores: Record<string, number | string> = {}
  const ecartees: { critere: string; raison: string }[] = []
  for (const [k, v] of Object.entries(l.notes)) {
    const c = crits.get(k)
    if (!c) {
      ecartees.push({ critere: k, raison: 'critère absent de cet appareil' })
      continue
    }
    if (!vaut(k)) {
      ecartees.push({ critere: c.label, raison: 'critère d’un autre poste' })
      continue
    }
    const x = controleNote(c, v)
    if ('raison' in x) ecartees.push({ critere: c.label, raison: x.raison })
    else scores[k] = x.ok
  }
  return { scores, ecartees }
}

// ---------- Application ----------

/** Avis tel qu'enregistré (les champs utiles ici). */
export interface AvisRow {
  id: string
  playerId: string
  eventId?: string
  date: string
  scores: Record<string, number | string>
  strengths?: string
  improvements?: string
  contextType?: string
  contextPlace?: string
  imported?: { by?: string; at: string }
  [k: string]: unknown
}

/** Les chemins de l'appli. */
export interface DepsJoueurs {
  /** Nom de l'appareil (auteur des avis, « validé par »). */
  me: string
  /**
   * Identifiant de la proposition validée : posé sur les avis CRÉÉS (data.source = « proposition_validee », data.lotId :
   * supabase/071_provenance.sql) ; un avis déjà là, complété, garde sa provenance d'origine.
   */
  lot?: string
  newId(): string
  now(): string
  /** Mon avis (non spontané) sur ce joueur à cet événement, s'il y en a un (à compléter plutôt que doubler). */
  monAvis(playerId: string, eventId: string): Promise<AvisRow | undefined>
  /** saveEvaluation de src/avisSave.ts (spontaneous : avis hors événement). */
  enregistrerAvis(row: AvisRow, spontaneous: boolean): Promise<{ addedToEvent: boolean }>
  /** remove('evaluations', id). */
  retirerAvis(id: string): Promise<void>
  /** Remet un avis comme avant (save de la version d'avant). */
  remettreAvis(row: AvisRow): Promise<void>
  /** Retire de la liste de l'événement un joueur que l'enregistrement y avait ajouté. */
  retirerDeEvenement(eventId: string, playerId: string): Promise<void>
  /** « Vu » à l'événement (markSeenMany, setSeen) et « à revoir » (addRewatchMany, remove) : chemins de la barre Demander. */
  vus?: MarkDeps
  aRevoir?: (notes: Record<string, string>) => MarkDeps
}

export interface ResultatLigne {
  i: number
  ok: boolean
  /** « avis enregistré », « déjà vu par toi », … ou la raison (texte neutre). */
  message: string
}

export type RetourAvis = { i: number; k: 'retirer'; id: string; eventId?: string; playerId: string; ajoute: boolean } | { i: number; k: 'remettre'; avant: AvisRow }

export interface Application {
  resultats: ResultatLigne[]
  /** Nombre d'avis enregistrés, de « vu » ou de « à revoir » posés. */
  faits: number
  /** Défait ce qui vient d'être créé ; absent : rien à défaire. Rend le nombre d'éléments retirés ou remis. */
  defaire?: () => Promise<number>
}

/** Ajoute un texte à un texte déjà là (rien si déjà dedans), comme « Avis vocal ». */
const ajouterTexte = (avant: string | undefined, plus: string | undefined) => {
  if (!plus) return avant
  if (!avant?.trim()) return plus
  return avant.includes(plus) ? avant : `${avant.trimEnd()}\n${plus}`
}

/**
 * Enregistre les avis des lignes cochées. `notes` : notes reprises par ligne (notesReprises) ; `ctx` : événement (id) ou
 * avis hors événement (contexte, lieu) ; date : celle de la ligne, sinon celle du contexte.
 */
export async function appliquerAvis(
  revues: readonly LigneRevue[],
  choix: ChoixJoueurs,
  notes: (r: LigneRevue) => Record<string, number | string>,
  ctx: { eventId?: string; date: string; typeContexte?: string; lieu?: string },
  d: DepsJoueurs,
): Promise<Application> {
  const resultats: ResultatLigne[] = []
  const retours: RetourAvis[] = []
  const at = d.now()
  const imported = { ...(d.me ? { by: d.me } : {}), at }
  for (const r of revues) {
    if (!cochee(r, choix)) continue
    const playerId = ficheDe(r, choix)!
    const l = r.ligne as LigneAvis
    const scores = notes(r)
    if (!Object.keys(scores).length && !l.forts && !l.progres) {
      resultats.push({ i: r.i, ok: false, message: 'aucune note reprise sur cet appareil' })
      continue
    }
    try {
      const avant = ctx.eventId ? await d.monAvis(playerId, ctx.eventId) : undefined
      if (avant) {
        const row: AvisRow = {
          ...avant,
          scores: { ...avant.scores, ...scores },
          strengths: ajouterTexte(avant.strengths, l.forts),
          improvements: ajouterTexte(avant.improvements, l.progres),
          imported,
        }
        await d.enregistrerAvis(row, false)
        retours.push({ i: r.i, k: 'remettre', avant })
        resultats.push({ i: r.i, ok: true, message: 'ton avis déjà là est complété' })
      } else {
        const row: AvisRow = {
          id: d.newId(),
          playerId,
          ...(ctx.eventId ? { eventId: ctx.eventId } : { contextType: ctx.typeContexte ?? 'match', ...(ctx.lieu ? { contextPlace: ctx.lieu } : {}) }),
          date: l.date ?? ctx.date,
          scores,
          ...(l.forts ? { strengths: l.forts } : {}),
          ...(l.progres ? { improvements: l.progres } : {}),
          imported,
          ...(d.lot ? { source: 'proposition_validee', lotId: d.lot } : {}),
        }
        const { addedToEvent } = await d.enregistrerAvis(row, !ctx.eventId)
        retours.push({ i: r.i, k: 'retirer', id: row.id, eventId: ctx.eventId, playerId, ajoute: addedToEvent })
        resultats.push({ i: r.i, ok: true, message: 'avis enregistré' })
      }
    } catch (e) {
      resultats.push({ i: r.i, ok: false, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return {
    resultats,
    faits: retours.length,
    defaire: retours.length
      ? async () => {
          let k = 0
          for (const x of [...retours].reverse()) {
            if (x.k === 'remettre') await d.remettreAvis(x.avant)
            else {
              await d.retirerAvis(x.id)
              if (x.ajoute && x.eventId) await d.retirerDeEvenement(x.eventId, x.playerId)
            }
            k++
          }
          return k
        }
      : undefined,
  }
}

/** Marque « vu » (à l'événement) ou « à revoir » les joueurs des lignes cochées, par la fonction du bouton de l'appli. */
export async function appliquerMarques(revues: readonly LigneRevue[], choix: ChoixJoueurs, deps: MarkDeps, deja: string): Promise<Application> {
  const lignes = revues.filter((r) => cochee(r, choix))
  const ids = uniq(lignes.map((r) => ficheDe(r, choix)!))
  const avant = await deps.already(ids)
  const r = await markWithUndo(ids, deps)
  const vus = new Set<string>()
  const resultats = lignes.map((x): ResultatLigne => {
    const id = ficheDe(x, choix)!
    const dbl = vus.has(id)
    vus.add(id)
    return { i: x.i, ok: true, message: avant.has(id) ? deja : dbl ? 'même joueur qu’une autre ligne' : 'fait' }
  })
  return { resultats, faits: r.done, defaire: r.undo }
}

/** Raisons des « à revoir » par fiche (lignes cochées ; la première raison d'une fiche l'emporte). */
export function raisonsParFiche(revues: readonly LigneRevue[], choix: ChoixJoueurs): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of revues) {
    const id = ficheDe(r, choix)
    const raison = (r.ligne as LigneAReVoir).raison
    if (id && raison && cochee(r, choix) && !out[id]) out[id] = raison
  }
  return out
}

/** État de la proposition après l'enregistrement : toutes les lignes lisibles faites → validée ; une partie → en partie. */
export function etatApresJoueurs(revues: readonly LigneRevue[], resultats: readonly ResultatLigne[]): PropEtat {
  return etatApresValidation({ lignes: revues.length, enregistrees: resultats.filter((r) => r.ok).length })
}

/** Libellé du bouton : « Enregistrer 3 avis », « Marquer 5 vus », « Mettre 2 à revoir ». */
export function libelleBouton(sorte: SorteJoueurs, n: number): string {
  if (sorte === 'avis') return `Enregistrer ${n} avis`
  if (sorte === 'vus') return `Marquer ${n} vu${n > 1 ? 's' : ''}`
  return `Mettre ${n} à revoir`
}

/** Résumé d'une proposition dans la boîte : « 12 avis », « 8 joueurs vus », « 3 joueurs à revoir ». */
export function resumeJoueurs(sorte: SorteJoueurs, n: number): string {
  const j = `${n} joueur${n > 1 ? 's' : ''}`
  if (sorte === 'avis') return `${n} avis`
  if (sorte === 'vus') return `${j} vu${n > 1 ? 's' : ''}`
  return `${j} à revoir`
}

/** Message après l'enregistrement : « 3 avis enregistrés », « 5 « vu » posés »… */
export function messageFait(sorte: SorteJoueurs, faits: number, deja: number): string {
  const plus = deja ? ` (${deja} déjà fait${deja > 1 ? 's' : ''})` : ''
  if (sorte === 'avis') return `${faits} avis enregistré${faits > 1 ? 's' : ''}${plus}`
  if (sorte === 'vus') return `${faits} joueur${faits > 1 ? 's' : ''} marqué${faits > 1 ? 's' : ''} vu${faits > 1 ? 's' : ''}${plus}`
  return `${faits} joueur${faits > 1 ? 's' : ''} mis à revoir${plus}`
}
