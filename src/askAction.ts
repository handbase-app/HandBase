import { pluralG, type Gender } from './gender'
import { levenshtein, nameKey, phonetic } from './nameMatch'

/*
 * « Demander » sait RÉALISER quelques actions (bulle ✦ de l'en-tête et barres « Demander » des listes), toujours après une
 * CARTE DE VALIDATION (src/components/AskAction.tsx) : rien n'est écrit avant « Accepter ». Partie PURE (ni React, ni base,
 * ni réseau), testée par tools/test-demander-actions.ts :
 *  - detectAction : la phrase est-elle une action ? Règles locales, sans IA, pour les tournures fréquentes (« crée un groupe
 *    avec les gauchers de 2011 », « trouve-moi … et crée-moi un groupe avec », « ajoute les 2011 du Var au groupe Pôle Aix »,
 *    « les gauchers dans l'événement Détection 2013 », « les groupes que Paul a créés ») ; une action que les règles ne
 *    lisent pas entièrement part au modèle (mode « action » de la fonction « transcrire ») ; une action interdite est
 *    refusée tout de suite (jamais de suppression, de retrait, de modification de fiche ni d'action sur des comptes) ;
 *  - parsePlan : relit le PLAN rendu par le modèle (JSON) sans rien croire : action de la liste blanche seulement, noms et
 *    textes bornés, recette des joueurs gardée brute (revérifiée ensuite par interpretRecipe, src/recipe.ts) ;
 *  - matchName : rapproche un nom CITÉ (groupe, événement, personne) des noms de l'appareil, sans accents, au son et à une ou
 *    deux lettres près ; exact → appliqué, approchant → « Tu voulais dire … ? », trop éloigné → rien ;
 *  - buildCard : le récapitulatif de la carte (étapes, avertissements, droits, bouton « Accepter » ou pas) ;
 *  - newGroupFields, groupNameFrom, actionDetail : champs du groupe créé, nom proposé, ligne du journal des questions.
 * CONFIDENTIALITÉ : seuls la phrase et le schéma de la recette partent au modèle ; les noms de joueurs, d'utilisateurs,
 * d'événements et de groupes restent sur l'appareil, où ils sont retrouvés ici.
 */

// ---------- Plan ----------

/** Actions permises en v1 (rien d'autre, jamais). */
export const PLAN_ACTIONS = ['creer_groupe', 'ajouter_groupe', 'ajouter_evenement', 'ouvrir_evenement', 'ouvrir_groupe', 'filtrer_createur'] as const
export type PlanAction = (typeof PLAN_ACTIONS)[number]
/** Actions qui écrivent (les autres ouvrent ou filtrent seulement). */
export const WRITES: readonly PlanAction[] = ['creer_groupe', 'ajouter_groupe', 'ajouter_evenement']
/** Actions qui visent un groupe ou un événement existant, cité par son nom. */
export const TARGETED: readonly PlanAction[] = ['ajouter_groupe', 'ajouter_evenement', 'ouvrir_evenement', 'ouvrir_groupe']
export const targetKind = (a: PlanAction): 'groupe' | 'evenement' | undefined =>
  a === 'ajouter_groupe' || a === 'ouvrir_groupe' ? 'groupe' : a === 'ajouter_evenement' || a === 'ouvrir_evenement' ? 'evenement' : undefined

export const ACTION_LABEL: Record<PlanAction, string> = {
  creer_groupe: 'créer un groupe',
  ajouter_groupe: 'ajouter à un groupe',
  ajouter_evenement: 'ajouter à un événement',
  ouvrir_evenement: 'ouvrir un événement filtré',
  ouvrir_groupe: 'ouvrir un groupe filtré',
  filtrer_createur: 'filtrer par créateur',
}

export type AskPlan = {
  action: PlanAction
  /** Nom du groupe ou de l'événement visé, TEL QUE DIT (retrouvé ensuite sur l'appareil). */
  target?: string
  /** Nom proposé pour le groupe à créer (modifiable dans la carte). */
  name?: string
  /** Recette des joueurs, brute (rendue par le modèle : relue par interpretRecipe). */
  players?: Record<string, unknown>
  /** Règles locales : la partie « joueurs » de la phrase, à traduire en recette (mode « question », contexte joueurs). */
  playersPhrase?: string
  /** filtrer_createur : noms de personnes tels que dits, et la liste visée. */
  creators?: string[]
  list?: 'groupes' | 'evenements'
  nonGere: string[]
  /** Reconnue par les règles locales (sans IA). */
  local?: boolean
}

export type PlanRefusal = 'illisible' | 'interdite' | 'inconnue' | 'aucune' | 'cible_absente'
export type PlanCheck = { ok: true; plan: AskPlan } | { ok: false; reason: PlanRefusal; text: string }

export const REFUSAL_TEXT: Record<PlanRefusal, string> = {
  illisible: 'Je n’ai pas compris la demande. Reformule-la, par exemple « crée un groupe avec les gauchers de 2011 ».',
  interdite:
    'Je ne fais pas cela : l’assistant ne supprime, ne retire et ne modifie rien, et ne touche pas aux comptes. Fais-le toi-même depuis la page concernée.',
  inconnue: 'Je ne sais pas encore faire cette action. Je sais : créer un groupe, ajouter à un groupe ou à un événement, ouvrir un groupe ou un événement avec un filtre.',
  aucune: 'Ce n’est pas une action : essaie-la comme une recherche dans la liste.',
  cible_absente: 'Dis-moi quel groupe ou quel événement (son nom).',
}

const MAX_TARGET = 80
const MAX_NAME = 60
const MAX_PLAYERS_JSON = 8_000
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** Texte propre : sans caractère de contrôle, espaces réduits, borné. */
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')
const strings = (v: unknown, n: number, max: number) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
    .map((x) => clean(x, max))
    .filter(Boolean)
    .slice(0, n)

/** Sans accents ni majuscules, MÊME LONGUEUR que le texte (NFC) : les morceaux lus se retrouvent dans l'original. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Mots d'action interdits, dans une réponse du modèle (« supprimer », « retirer_groupe », « modifier »…). */
const FORBIDDEN_ACTION = /(supprim|efface|retir|enleve|vide|vider|modifi|renomm|archiv|deplac|fusion|compte|role|mot_?de_?passe|invit|envoi|message|courriel|mail|interdit)/

/** Relit le plan rendu par le modèle : rien n'est cru sans contrôle. */
export function parsePlan(raw: unknown): PlanCheck {
  const no = (reason: PlanRefusal): PlanCheck => ({ ok: false, reason, text: REFUSAL_TEXT[reason] })
  if (!isObj(raw)) return no('illisible')
  // Plan rendu dans une enveloppe (« plan », « etapes ») : accepté.
  const o = isObj(raw.plan) ? raw.plan : raw
  const a = fold(clean(o.action ?? o.type, 40)).replace(/[\s-]+/g, '_')
  if (!a) return no('illisible')
  if (a === 'aucune' || a === 'aucun' || a === 'recherche' || a === 'filtrer') return no('aucune')
  if (!(PLAN_ACTIONS as readonly string[]).includes(a)) return no(FORBIDDEN_ACTION.test(a) ? 'interdite' : 'inconnue')
  const action = a as PlanAction
  const target = clean(o.cible ?? o.target, MAX_TARGET) || undefined
  const name = clean(o.nom ?? o.name, MAX_NAME) || undefined
  let players: Record<string, unknown> | undefined = isObj(o.joueurs) ? { ...o.joueurs } : isObj(o.recette) ? { ...o.recette } : undefined
  if (players) {
    delete players.sortie
    if (JSON.stringify(players).length > MAX_PLAYERS_JSON) return no('illisible')
    // Le groupe ou l'événement visé n'est pas un critère de la recherche (sinon on ne chercherait que parmi ses joueurs).
    if (target && isObj(players.population)) {
      const pop = { ...players.population }
      const t = nameKey(target)
      for (const k of ['groupes', 'groupe', 'evenements', 'evenement']) {
        if (pop[k] === undefined) continue
        const kept = strings(pop[k], 20, MAX_TARGET).filter((x) => nameKey(x) !== t)
        if (kept.length) pop[k] = kept
        else delete pop[k]
      }
      players = { ...players, population: pop }
    }
  }
  const creators = strings(o.createurs ?? o.creators, 5, MAX_NAME)
  const l = fold(clean(o.liste ?? o.list, 20))
  const list = l.startsWith('groupe') ? 'groupes' : l.startsWith('evenement') ? 'evenements' : undefined
  const nonGere = strings(o.nonGere, 10, 80)
  if (TARGETED.includes(action) && !target) return no('cible_absente')
  if (action === 'filtrer_createur' && !creators.length) return no('cible_absente')
  return {
    ok: true,
    plan: {
      action,
      ...(target ? { target } : {}),
      ...(name && action === 'creer_groupe' ? { name } : {}),
      ...(players ? { players } : {}),
      ...(action === 'filtrer_createur' ? { creators, list: list ?? 'groupes' } : {}),
      nonGere,
    },
  }
}

// ---------- Règles locales (sans IA) ----------

export type Detected =
  /** Action interdite (supprimer, retirer, modifier, comptes) : refusée sans appel. */
  | { kind: 'interdite' }
  /** Action lue entièrement par les règles locales. */
  | { kind: 'plan'; plan: AskPlan }
  /** Ressemble à une action, mais les règles ne la lisent pas : le modèle décide (mode « action »). */
  | { kind: 'modele' }

const FILL = String.raw`(?:(?:alors|bon|ok|euh|stp|s'il te plait|s'il vous plait|peux tu|tu peux|pourrais tu|est ce que tu peux|je veux que tu|j'aimerais que tu|merci de)\s+)*`
const ME = String.raw`(?:(?:moi|nous)\s+)?`
const CREATE_V = String.raw`(?:cree|creer|creez|fais|faire|faites|fait|genere|generer|constitue|constituer|forme|former|prepare|preparer|monte|monter)`
const ADD_V = String.raw`(?:ajoute|ajouter|ajoutez|rajoute|rajouter|mets|mettre|mettez|met|place|placer|inscris|inscrire)`
const FIND_V = String.raw`(?:trouve|trouver|cherche|chercher|prends|prendre|selectionne|selectionner|recupere|recuperer|montre|affiche|donne|liste|isole|filtre|sors)`
const GROUP_N = String.raw`(?:groupe|selection|collectif|equipe)`
const EVENT_N = String.raw`(?:evenement|tournoi|stage|match|rassemblement|entrainement|observation|seance)`
const NAMED = String.raw`(?:\s+(?:appele|appelee|nomme|nommee|intitule|intitulee|qui s'appelle|qu'on appelle)\s+(.+?))?`
const WITH = String.raw`(?:avec|de|des|pour|contenant|regroupant|a partir de|a partir des|qui contient|qui regroupe|qui rassemble)`
/** Après « au » / « dans le » : le nom de type, puis le nom. Groupe : (1) ; « événement » : (2) ; tournoi, stage… : (3) (gardé dans le nom). */
const INTO_TARGET = String.raw`(?:(groupe|selection|collectif)|(evenement)|(tournoi|stage|match|rassemblement|entrainement|observation|seance|detection))\s*(.+)`
const INTO = String.raw`(?:aux|au|a l'|a la|dans le|dans la|dans l'|dans|a|sur)`

const RE = (src: string) => new RegExp(src, 'd')
const CREATE_RE = RE(String.raw`^${FILL}${CREATE_V}\s+${ME}(?:un |une |le |la )?(?:nouveau |nouvelle )?${GROUP_N}${NAMED}\s+${WITH}\s+(.+)$`)
const FIND_CREATE_RE = RE(
  String.raw`^${FILL}${FIND_V}\s+${ME}(.+?)(?:\s+et|\s+puis|,)\s+(?:${CREATE_V}|${ADD_V})\s+(?:(?:moi|nous|les|en|leur)\s+)*(?:(?:un|une|le|la|dans un|dans une|en)\s+)?(?:nouveau |nouvelle )?${GROUP_N}${NAMED}(?:\s+(?:avec|avec eux|avec elles|avec ca|avec ces joueurs|avec ces joueuses|de ces joueurs|de ces joueuses))?$`,
)
const FIND_ADD_RE = RE(String.raw`^${FILL}${FIND_V}\s+${ME}(.+?)(?:\s+et|\s+puis|,)\s+${ADD_V}\s+(?:(?:moi|nous|les|leur|en)\s+)*${INTO}\s*${INTO_TARGET}$`)
const ADD_RE = RE(String.raw`^${FILL}${ADD_V}\s+${ME}(.+?)\s+${INTO}\s*${INTO_TARGET}$`)
const OPEN_RE = RE(
  String.raw`^${FILL}(?:(?:montre|affiche|donne|liste|ouvre|trouve|cherche|sors|isole|filtre|je veux|j'aimerais|il me faut)\s+${ME})?(?:moi\s+)?(?:la liste (?:des |de |d')|tous |toutes |uniquement |seulement )?(?:les |des |mes )?(.+?)\s+(?:dans|de|du|des|a|au|pendant|lors de|lors du|sur|parmi)\s+(?:l'|le |la |les |ce |cet |cette )?${INTO_TARGET}$`,
)
const CREATOR_RE = RE(
  String.raw`^${FILL}(?:(?:montre|affiche|donne|liste|trouve|cherche)\s+${ME})?(?:moi\s+)?(?:tous |toutes )?(?:les |des )?(groupes?|evenements?|tournois?|stages?|matchs?|observations?)\s+(?:(?:que|qu')\s*(.+?)\s+(?:a|ont)\s+(?:crees?|creees?|cree|faits?|faites?|montes?|montees?|organises?|organisees?)|(?:crees?|creees?|faits?|faites?|montes?|montees?|organises?|organisees?)\s+par\s+(.+))$`,
)
/** Mots de joueurs (la partie « joueurs » d'une phrase d'ouverture doit en contenir un, ou une année). */
const PLAYER_WORD =
  /\b(joueurs?|joueuses?|gardiens?|gardiennes?|pivots?|ailiers?|ailieres?|arrieres?|demis?|centres?|gauchers?|gaucheres?|droitiers?|droitieres?|ambidextres?|garcons?|filles?|grands?|grandes?|petits?|petites?|licencies?|licenciees?|jeunes?|(19|20)\d\d)\b/
/** « vus au tournoi », « présents au stage » : une condition de la liste Joueurs, pas une action. */
const SEEN_END = /\b(vus?|vues?|presents?|presentes?|passes?|passees?|venus?|venues?|observes?|observees?|notes?|notees?|evalues?|evaluees?|inscrits?|inscrites?|joue|jouent|selectionnes?|selectionnees?|convoques?|convoquees?)$/
const PRONOUNS = /^(moi|me|nous|toi|vous|je|j'|j|lui|elle|eux|elles|personne|quelqu'un|on|il|ils)$/

/** Actions interdites : supprimer, retirer, modifier une chose précise ; toute action sur des comptes. */
const DEL_V = String.raw`(?:supprime|supprimer|efface|effacer|retire|retirer|enleve|enlever|vide|vider|modifie|modifier|renomme|renommer|archive|archiver|desarchive|deplace|deplacer|change|changer|fusionne|fusionner|exclus|exclure|vire|virer)`
const FORBID_1 = new RegExp(
  String.raw`^${FILL}${DEL_V}\s+(?:moi\s+)?(?:le|la|l'|ce|cet|cette|mon|ma|mes|son|sa|leur|tout le|toute la|un|une)\s*(?:groupe|evenement|tournoi|stage|match|fiche|compte|role|avis|mesure|rassemblement|selection|equipe|joueur|joueuse)\b`,
)
const FORBID_2 = new RegExp(String.raw`^${FILL}${DEL_V}\s+.+?\s+(?:du|de la|de l'|des)\s*(?:groupe|evenement|tournoi|stage|match|rassemblement|selection|liste)\b`)
const ACCOUNT = /\b(comptes?|mots? de passe|roles?|droits? d'acces|acces|invitations?)\b/
const ACCOUNT_V = /\b(cree|creer|supprime|supprimer|change|changer|modifie|modifier|donne|donner|retire|retirer|invite|inviter|reinitialise|reinitialiser|ouvre|ouvrir|ferme|fermer|desactive|desactiver|active|activer|envoie|envoyer)\b/
const FILTER_WORDS = /\b(filtres?|criteres?|conditions?|recherche)\b/

/** Repères grossiers d'une action (le modèle décide) : « crée … groupe », « ajoute … au groupe / à l'événement ». */
const LOOSE_CREATE = new RegExp(String.raw`\b${CREATE_V}\b.*\b${GROUP_N}\b`)
const LOOSE_ADD = new RegExp(String.raw`\b${ADD_V}\b.*\b(?:aux|au|a l'|a la|dans le|dans la|dans l'|dans un|dans une)\s*(?:nouveau |nouvelle )?(?:${GROUP_N}|${EVENT_N})\b`)

/** « ajoute ceux vus au tournoi » : une condition « vu », pas un ajout. */
const SEEN_BEFORE_INTO = /\b(vus?|vues?|presents?|presentes?|passes?|venus?|venues?|observes?|observees?|notes?|notees?|evalues?|evaluees?|joue|jouent|convoques?|convoquees?)\s+(?:aux|au|a l'|a la|dans le|dans la|dans l'|a|dans)\b/

/** Phrase préparée : original (NFC, sans ponctuation finale) et repliée de même longueur (« crée-moi » → « cree moi »). */
function prep(phrase: string) {
  const text = phrase.normalize('NFC').replace(/\s+/g, ' ').trim().replace(/[\s.!?…]+$/, '')
  const n = fold(text)
    .replace(/[’`´]/g, "'")
    .replace(/-(moi|nous|les|leur|en|toi)\b/g, ' $1')
  return { text, n }
}

/** Morceau de l'original qui correspond au groupe `i` de la recherche (sans guillemets autour). */
function piece(text: string, m: RegExpExecArray, i: number): string | undefined {
  const at = m.indices?.[i]
  if (!at) return undefined
  const s = text
    .slice(at[0], at[1])
    .replace(/^[\s«"“']+|[\s»"”']+$/g, '')
    .trim()
  return s || undefined
}

/** Nom de la cible : « tournoi de Cannes » garde son mot de type ; « l'événement X », « le groupe X » : X seulement. */
function targetOf(text: string, m: RegExpExecArray, base: number): { kind: 'groupe' | 'evenement'; name: string } | undefined {
  const name = piece(text, m, base + 3)
  if (!name) return undefined
  if (m[base]) return { kind: 'groupe', name }
  if (m[base + 1]) return { kind: 'evenement', name }
  const noun = piece(text, m, base + 2)
  return { kind: 'evenement', name: noun ? `${noun} ${name}` : name }
}

/**
 * « les gauchers dans l'événement X », « les gardiennes du groupe Y » : une ouverture filtrée. Pas « les joueurs du tournoi
 * de X » (tous ses joueurs : filtre de la liste Joueurs, comme avant) ni « les gardiennes vues au stage » (condition « vu ») :
 * un vrai critère de joueurs, et « dans » / « parmi » ou le mot « événement » / « groupe ».
 */
function openable(n: string, m: RegExpExecArray): boolean {
  const who = m[1]
  if (!PLAYER_WORD.test(who) || SEEN_END.test(who)) return false
  if (/^(?:(?:tous|toutes|les|des|mes|ces)\s+)*(?:joueurs?|joueuses?|jeunes|licencies?|licenciees?)$/.test(who)) return false
  const explicit = !!(m[2] || m[3])
  return explicit || /\s(?:dans|parmi|pendant|lors de|lors du)\s/.test(n)
}

/** Partie « joueurs » d'une phrase, reprise telle quelle (« les » ajouté si besoin : « gauchers » → « les gauchers »). */
const playersText = (s: string) => (/^(les|des|tous|toutes|mes|ces|ceux|celles)\b/i.test(s) ? s : `les ${s}`)

/**
 * La phrase est-elle une action ? `page` : la barre d'où elle vient (« joueurs » : « les gauchers du tournoi X » reste un
 * filtre de la liste, comme avant). null : pas une action (la page la traite comme avant).
 */
export function detectAction(phrase: string, page?: string): Detected | null {
  const { text, n } = prep(phrase)
  if (!n) return null
  if (!FILTER_WORDS.test(n) && !/^(?:efface|effacer|enleve|enlever|retire|retirer|vide|vider)\s+(?:tout|les filtres|le filtre|la selection)\b/.test(n) && (FORBID_1.test(n) || FORBID_2.test(n)))
    return { kind: 'interdite' }
  if (ACCOUNT.test(n) && ACCOUNT_V.test(n)) return { kind: 'interdite' }

  const plan = (p: Omit<AskPlan, 'nonGere' | 'local'>): Detected => ({ kind: 'plan', plan: { ...p, nonGere: [], local: true } })
  let m: RegExpExecArray | null
  if ((m = CREATE_RE.exec(n))) {
    const rest = piece(text, m, 2)
    if (rest) return plan({ action: 'creer_groupe', name: piece(text, m, 1), playersPhrase: rest })
  }
  if ((m = FIND_CREATE_RE.exec(n))) {
    const rest = piece(text, m, 1)
    if (rest) return plan({ action: 'creer_groupe', name: piece(text, m, 2), playersPhrase: rest })
  }
  if ((m = FIND_ADD_RE.exec(n))) {
    const rest = piece(text, m, 1)
    const t = targetOf(text, m, 2)
    if (rest && t) return plan({ action: t.kind === 'groupe' ? 'ajouter_groupe' : 'ajouter_evenement', target: t.name, playersPhrase: rest })
  }
  if ((m = ADD_RE.exec(n)) && !SEEN_END.test(m[1])) {
    const rest = piece(text, m, 1)
    const t = targetOf(text, m, 2)
    if (rest && t) return plan({ action: t.kind === 'groupe' ? 'ajouter_groupe' : 'ajouter_evenement', target: t.name, playersPhrase: rest })
  }
  if ((m = CREATOR_RE.exec(n))) {
    const who = piece(text, m, 2) ?? piece(text, m, 3)
    if (who && !PRONOUNS.test(fold(who))) return plan({ action: 'filtrer_createur', creators: [who], list: m[1].startsWith('groupe') ? 'groupes' : 'evenements' })
  }
  if (page !== 'joueurs' && (m = OPEN_RE.exec(n)) && openable(n, m)) {
    const rest = piece(text, m, 1)
    const t = targetOf(text, m, 2)
    if (rest && t) return plan({ action: t.kind === 'groupe' ? 'ouvrir_groupe' : 'ouvrir_evenement', target: t.name, playersPhrase: playersText(rest) })
  }
  if (LOOSE_CREATE.test(n) || (LOOSE_ADD.test(n) && !SEEN_BEFORE_INTO.test(n))) return { kind: 'modele' }
  return null
}

// ---------- Rapprochement des noms (sur l'appareil) ----------

const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'a', 'au', 'aux', 'en', 'et'])
/** Mots de type, facultatifs (« le tournoi de Cannes » trouve « Cannes 2025 »). */
const GENERIC = new Set(['evenement', 'evenements', 'tournoi', 'tournois', 'stage', 'stages', 'match', 'matchs', 'groupe', 'groupes', 'selection', 'equipe', 'rassemblement', 'entrainement', 'observation', 'seance'])
const tokens = (s: string) => nameKey(s).split(' ').filter((w) => w && !STOP.has(w))

/** Ressemblance de deux mots : 1 identiques ; 0,9 même son ; 0,8 une ou deux lettres ; 0,75 sons voisins ; 0 sinon. Chiffres : identiques seulement. */
export function wordLike(a: string, b: string): number {
  if (a === b) return 1
  if (/\d/.test(a) || /\d/.test(b) || a.length < 3 || b.length < 3) return 0
  const pa = phonetic(a)
  const pb = phonetic(b)
  if (pa === pb) return 0.9
  const max = Math.max(a.length, b.length) >= 6 ? 2 : 1
  if (levenshtein(a, b, max) <= max) return 0.8
  if (pa.length >= 3 && pb.length >= 3 && levenshtein(pa, pb, 1) <= 1) return 0.75
  return 0
}

/**
 * Ressemblance d'un nom dit à un nom de l'appareil (0 à 1). Chaque mot dit doit ressembler à un mot du nom (sauf les mots de
 * type : « tournoi », « groupe ») ; la note mêle la ressemblance des mots dits et la part du nom couverte.
 */
export function nameScore(said: string, cand: string): number {
  const s = tokens(said)
  const c = tokens(cand)
  if (!s.length || !c.length) return 0
  const used = new Set<number>()
  let sum = 0
  let core = 0
  for (const w of s) {
    let best = 0
    let at = -1
    c.forEach((t, i) => {
      if (used.has(i)) return
      const v = wordLike(w, t)
      if (v > best) {
        best = v
        at = i
      }
    })
    if (best < 0.7) {
      if (GENERIC.has(w)) continue
      return 0
    }
    used.add(at)
    sum += best
    core++
  }
  if (!core) return 0
  return 0.8 * (sum / core) + 0.2 * (used.size / c.length)
}

/** Seuil d'une proposition « Tu voulais dire … ? ». */
export const NAME_THRESHOLD = 0.72
const MAX_CHOICES = 5

export type Named = { id: string; name: string; date?: string }
export type NameMatch<T> = { kind: 'exact'; item: T } | { kind: 'approx'; best: T; choices: T[] } | { kind: 'none' }

/**
 * Nom dit retrouvé parmi ceux de l'appareil : exact (mêmes mots, sans accents ni petits mots, un seul) ; approchant (le
 * meilleur et les autres possibles, 5 au plus ; plusieurs du même nom : le plus récent d'abord) ; ou rien (trop éloigné).
 */
export function matchName<T extends { name: string; date?: string }>(said: string, items: readonly T[]): NameMatch<T> {
  const key = tokens(said).join(' ')
  if (!key) return { kind: 'none' }
  const recent = (a: T, b: T) => (b.date ?? '').localeCompare(a.date ?? '')
  const exact = items.filter((x) => tokens(x.name).join(' ') === key).sort(recent)
  if (exact.length === 1) return { kind: 'exact', item: exact[0] }
  const scored = items
    .map((x) => ({ x, s: exact.includes(x) ? 2 : nameScore(said, x.name) }))
    .filter((r) => r.s >= NAME_THRESHOLD)
    .sort((a, b) => b.s - a.s || recent(a.x, b.x) || a.x.name.length - b.x.name.length)
  if (!scored.length) return { kind: 'none' }
  const choices = scored.slice(0, MAX_CHOICES).map((r) => r.x)
  return { kind: 'approx', best: choices[0], choices }
}

// ---------- Groupe créé ----------

/** Nom proposé d'après les critères (« Gauchers · Var (83) · taille ≥ 180 cm »), 60 caractères au plus. */
export function groupNameFrom(criteria: readonly string[]): string {
  const s = criteria.map((c) => c.trim()).filter(Boolean).join(' · ')
  const t = s.length > MAX_NAME ? `${s.slice(0, MAX_NAME - 1).trimEnd()}…` : s
  return t ? t[0].toUpperCase() + t.slice(1) : 'Nouveau groupe'
}

export type GroupSource = { sex?: string | null; year?: string; dept?: string; region?: string }
export type NewGroupFields = { sex: 'M' | 'F' | 'mixte'; scope: 'federation' | 'ligue' | 'comite'; department?: string; regionId?: string; years?: string[] }

/**
 * Champs obligatoires du groupe créé (comme le formulaire « Nouveau groupe ») d'après ses joueurs : sexe (tous des filles,
 * tous des garçons, sinon mixte), portée (un seul département : comité ; une seule ligue : ligue ; sinon fédération) et
 * année d'âge si tous ont la même. Groupe privé (« Moi seul ») : modifiable ensuite.
 */
export function newGroupFields(players: readonly GroupSource[]): NewGroupFields {
  const one = (xs: (string | undefined)[]) => {
    const s = new Set(xs)
    return s.size === 1 ? [...s][0] : undefined
  }
  const sex = players.length && players.every((p) => p.sex === 'F') ? 'F' : players.length && players.every((p) => p.sex === 'M') ? 'M' : 'mixte'
  const dept = one(players.map((p) => p.dept))
  const region = one(players.map((p) => p.region))
  const year = one(players.map((p) => p.year))
  const out: NewGroupFields = dept ? { sex, scope: 'comite', department: dept, ...(region ? { regionId: region } : {}) } : region ? { sex, scope: 'ligue', regionId: region } : { sex, scope: 'federation' }
  if (year && /^\d{4}$/.test(year)) out.years = [year]
  return out
}

// ---------- Carte de validation ----------

/** Au-delà : avertissement dans la carte. */
export const BIG = 200

export type CardInput = {
  plan: AskPlan
  /** Critères compris, en mots (pastilles de la recette). */
  criteria: readonly string[]
  /** Joueurs trouvés. */
  count: number
  gender?: Gender
  /** Groupe ou événement retrouvé sur l'appareil. */
  target?: { name: string }
  /** Nom du groupe à créer (modifiable). */
  groupName?: string
  /** Joueurs déjà dans la cible (ajouts). */
  already?: number
  /** Droits (can.* de src/roles.ts, calculés par l'écran) ; deniedWhy : pourquoi pas. */
  allowed: boolean
  deniedWhy?: string
  /** Ce que la recette n'a pas pris en compte. */
  unsupported?: readonly string[]
  /** Aucun critère de joueurs compris. */
  noCriteria?: boolean
}

export type Card = { steps: string[]; warnings: string[]; canAccept: boolean; blocked?: string }

/** Récapitulatif « Je vais : 1) … 2) … », avertissements, et si « Accepter » est proposé. */
export function buildCard(c: CardInput): Card {
  const a = c.plan.action
  const who = pluralG(c.count, c.gender ?? null)
  const crit = c.criteria.length ? c.criteria.join(' · ') : 'tous les joueurs'
  const steps: string[] = []
  const warnings: string[] = []
  const t = c.target?.name ? `« ${c.target.name} »` : ''
  if (a === 'filtrer_createur') {
    steps.push(`Afficher les ${c.plan.list === 'evenements' ? 'événements' : 'groupes'} créés par ${t || `« ${c.plan.creators?.[0] ?? ''} »`}`)
  } else if (a === 'ouvrir_evenement' || a === 'ouvrir_groupe') {
    steps.push(`Chercher dans ${a === 'ouvrir_groupe' ? 'le groupe' : 'l’événement'} ${t} : ${crit} → ${who}`)
    steps.push(`Ouvrir ${a === 'ouvrir_groupe' ? 'le groupe' : 'l’événement'} et n’afficher que ${c.count > 1 ? 'ces joueurs' : 'ce résultat'}`)
  } else {
    steps.push(`Chercher : ${crit} → ${who}`)
    if (a === 'creer_groupe') steps.push(`Créer le groupe « ${(c.groupName ?? '').trim() || 'Nouveau groupe'} » avec ${c.count > 1 ? `ces ${who}` : who} (visible par moi seul, modifiable ensuite)`)
    else steps.push(`Ajouter ${c.count > 1 ? `ces ${who}` : who} ${a === 'ajouter_groupe' ? 'au groupe' : 'à l’événement'} ${t}${c.already ? ` (${c.already} déjà dedans)` : ''}`)
  }
  if (c.count > BIG && WRITES.includes(a)) warnings.push(`Plus de ${BIG} joueurs : vérifie les critères avant d’accepter.`)
  if (c.unsupported?.length) warnings.push(`Pas pris en compte : ${c.unsupported.join(' ; ')}`)
  let blocked: string | undefined
  if (!c.allowed) blocked = c.deniedWhy || 'Ton rôle ne permet pas cette action.'
  else if (WRITES.includes(a) && c.noCriteria) blocked = 'Je n’ai compris aucun critère de joueurs : précise la demande (par exemple « les gauchers de 2011 »).'
  else if (WRITES.includes(a) && !c.count) blocked = 'Aucun joueur ne correspond : rien à faire.'
  else if (a !== 'creer_groupe' && WRITES.includes(a) && c.already === c.count) blocked = 'Ces joueurs y sont déjà tous : rien à faire.'
  else if (a === 'creer_groupe' && !(c.groupName ?? '').trim()) blocked = 'Donne un nom au groupe.'
  if (!WRITES.includes(a) && a !== 'filtrer_createur' && !c.count) warnings.push('Aucun joueur ne correspond : la liste sera vide.')
  return { steps, warnings, canAccept: !blocked, ...(blocked ? { blocked } : {}) }
}

// ---------- Journal des questions ----------

/** Marque d'une entrée d'action dans le journal (champ « display », 20 caractères au plus côté serveur). */
export const ACTION_DISPLAY = 'action'
/** acceptee / annulee : « Accepter » ou « Annuler » (ou « Oui » à un nom approchant) ; appliquee : filtre sans carte (nom exact). */
export type ActionOutcome = 'acceptee' | 'annulee' | 'appliquee' | 'refusee' | 'impossible'
export const OUTCOME_TEXT: Record<ActionOutcome, string> = {
  acceptee: 'acceptée',
  annulee: 'annulée',
  appliquee: 'appliquée (nom exact, sans carte)',
  refusee: 'refusée (interdite)',
  impossible: 'impossible',
}

/** Ligne « Précision » du journal : l'action proposée, le nombre de joueurs et ce qu'en a fait l'entraîneur. Jamais de nom. */
export function actionDetail(action: PlanAction | 'inconnue' | 'interdite', outcome: ActionOutcome, count?: number, why?: string): string {
  const what = action === 'inconnue' ? 'action non reconnue' : action === 'interdite' ? 'action interdite' : ACTION_LABEL[action]
  return [`Action proposée : ${what}`, count !== undefined ? `${count} joueur${count > 1 ? 's' : ''}` : '', OUTCOME_TEXT[outcome], why ?? ''].filter(Boolean).join(' · ').slice(0, 300)
}
