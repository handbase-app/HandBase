import { accord, pluralG, w, type Gender } from './gender'
import { levenshtein, nameKey, phonetic } from './nameMatch'
import { currentSport } from './sportConfig'

/*
 * « Demander » sait RÉALISER quelques actions (bulle ✦ de l'en-tête et barres « Demander » des listes), toujours après une
 * CARTE DE VALIDATION (src/components/AskAction.tsx) : rien n'est écrit avant « Accepter ». Partie PURE (ni React, ni base,
 * ni réseau), testée par tools/test-demander-actions.ts :
 *  - detectAction : la phrase est-elle une action ? Règles locales, sans IA, pour les tournures fréquentes (« crée un groupe
 *    avec les gauchers de 2011 », « trouve-moi … et crée-moi un groupe avec », « ajoute les 2011 du Var au groupe Pôle Aix »,
 *    « les gauchers dans l'événement Détection 2013 », « les groupes que Paul a créés ») ; une action que les règles ne
 *    lisent pas entièrement part au modèle (mode « action » de la fonction « transcrire ») ; une action interdite est
 *    refusée tout de suite (jamais de suppression, de retrait, de modification de fiche ni d'action sur des comptes) ;
 *    « mets à revoir les gauchers vus aujourd'hui », « marque comme vus les joueurs de l'événement X », « exporte en PDF le
 *    groupe X » : readRewatch, readSeen, readExport (un joueur précis cité par son nom reste « pas encore prévu ») ; une
 *    action PAS ENCORE PRÉVUE (convoquer, suivre, comparer… : UNPLANNED_TEXT) est dite tout de suite, avec la façon de
 *    faire aujourd'hui ; « crée un groupe … et ajoute-les à l'événement X » / « … et mets-les à revoir » : deux étapes (plan.then) ;
 *    « ceux-là », « cette liste » : la liste affichée (plan.current) ; bornes des noms lus (la cible s'arrête avant « qui… »,
 *    « triés… », « avec leurs… » ; « euh », « stp » retirés) ; morceau mal coupé (verbe dedans) : le modèle, jamais un nom
 *    absurde. Catalogue des demandes et filet : tools/catalogue-demandes.ts, tools/test-catalogue-demandes.ts ;
 *  - matchTarget : comme matchName, plus « le prochain intercomité » / « le dernier stage » (à venir le plus proche, passé
 *    le plus récent, toujours à confirmer) ;
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

/**
 * Actions permises (rien d'autre, jamais). « mettre_a_revoir » : mes « à revoir » (fonction du bouton « Mettre à revoir » de la
 * sélection) ; « marquer_vus » : mes « vu » à un événement cité (fonction de « Marquer vu à cet événement ») ; « exporter » :
 * rien d'écrit, ouvre l'export existant (page « Exporter en PDF » d'un groupe, tableur CSV d'une liste).
 */
export const PLAN_ACTIONS = ['creer_groupe', 'ajouter_groupe', 'ajouter_evenement', 'ouvrir_evenement', 'ouvrir_groupe', 'filtrer_createur', 'mettre_a_revoir', 'marquer_vus', 'exporter'] as const
export type PlanAction = (typeof PLAN_ACTIONS)[number]
/** Actions qui écrivent (les autres ouvrent, filtrent ou exportent seulement). */
export const WRITES: readonly PlanAction[] = ['creer_groupe', 'ajouter_groupe', 'ajouter_evenement', 'mettre_a_revoir', 'marquer_vus']
/** Actions qui visent FORCÉMENT un groupe ou un événement existant, cité par son nom. */
export const TARGETED: readonly PlanAction[] = ['ajouter_groupe', 'ajouter_evenement', 'ouvrir_evenement', 'ouvrir_groupe', 'marquer_vus']
/** Type de la cible (quand elle est dite : facultative pour « mettre_a_revoir », événement, et « exporter », groupe). */
export const targetKind = (a: PlanAction): 'groupe' | 'evenement' | undefined =>
  a === 'ajouter_groupe' || a === 'ouvrir_groupe' || a === 'exporter'
    ? 'groupe'
    : a === 'ajouter_evenement' || a === 'ouvrir_evenement' || a === 'marquer_vus' || a === 'mettre_a_revoir'
      ? 'evenement'
      : undefined
/** Actions après lesquelles une deuxième étape (plan.then) est permise. */
const THEN_FROM: readonly PlanAction[] = ['creer_groupe', 'ajouter_groupe', 'ajouter_evenement']
export type ThenAction = 'ajouter_groupe' | 'ajouter_evenement' | 'mettre_a_revoir'

export const ACTION_LABEL: Record<PlanAction, string> = {
  creer_groupe: 'créer un groupe',
  ajouter_groupe: 'ajouter à un groupe',
  ajouter_evenement: 'ajouter à un événement',
  ouvrir_evenement: 'ouvrir un événement filtré',
  ouvrir_groupe: 'ouvrir un groupe filtré',
  filtrer_createur: 'filtrer par créateur',
  mettre_a_revoir: 'mettre à revoir',
  marquer_vus: 'marquer vus à un événement',
  exporter: 'exporter',
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
  /**
   * Deuxième étape (« crée un groupe … et ajoute-les à l'événement X », « … et mets-les à revoir ») : les MÊMES joueurs,
   * ajoutés ensuite à ce groupe ou à cet événement (target), ou mis à revoir (sans cible) ; une seule carte, un seul
   * « Accepter », « Défaire » défait tout.
   */
  then?: { action: ThenAction; target?: string }
  /** exporter : le format dit (« en PDF », « imprime » : pdf ; « Excel », « tableur », « CSV » : csv). */
  format?: 'pdf' | 'csv'
  /** Règles locales : les joueurs de la liste affichée (« ceux-là », « cette liste ») au lieu d'une phrase. */
  current?: boolean
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
  inconnue:
    'Je ne sais pas encore faire cette action. Je sais : créer un groupe, ajouter à un groupe ou à un événement, ouvrir un groupe ou un événement avec un filtre, mettre à revoir, marquer vus à un événement, exporter une liste ou un groupe.',
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
  // Action pas encore prévue, rendue avec sa famille (« quoi ») : le message qui dit comment faire aujourd'hui.
  if (a === 'pas_prevue' || a === 'non_prevue') {
    const quoi = fold(clean(o.quoi, 20)).replace(/[\s-]+/g, '_')
    return { ok: false, reason: 'inconnue', text: Object.hasOwn(UNPLANNED_TEXT, quoi) ? UNPLANNED_TEXT[quoi as Unplanned] : REFUSAL_TEXT.inconnue }
  }
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
  // Deuxième étape (« … et ajoute-les à l'événement X », « … et mets-les à revoir ») : après une création ou un ajout.
  const pu = isObj(o.puis) ? o.puis : isObj(o.ensuite) ? o.ensuite : undefined
  const pa = pu ? fold(clean(pu.action, 40)).replace(/[\s-]+/g, '_') : ''
  const pt = pu ? clean(pu.cible ?? pu.target, MAX_TARGET) : ''
  const then: AskPlan['then'] = !THEN_FROM.includes(action)
    ? undefined
    : (pa === 'ajouter_groupe' || pa === 'ajouter_evenement') && pt
      ? { action: pa, target: pt }
      : pa === 'mettre_a_revoir'
        ? { action: pa }
        : undefined
  const f = fold(clean(o.format, 20))
  const format = action !== 'exporter' ? undefined : /^(?:pdf|impr|liste)/.test(f) ? 'pdf' : /^(?:csv|excel|tableu|xls)/.test(f) ? 'csv' : undefined
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
      ...(then ? { then } : {}),
      ...(format ? { format } : {}),
      nonGere,
    },
  }
}

// ---------- Règles locales (sans IA) ----------

/**
 * Actions PAS ENCORE PRÉVUES dans « Demander » (aucune n'est faite ici) : dites tout de suite, sans appel, avec la façon de
 * faire aujourd'hui. « negatif » : une marque négative sur un jeune (« pas retenu ») n'existe pas et n'existera pas.
 */
export type Unplanned = 'vus' | 'a_revoir' | 'suivre' | 'export' | 'convoquer' | 'evaluer' | 'comparer' | 'creer_evenement' | 'creer_fiche' | 'seance' | 'negatif' | 'dupliquer' | 'saison' | 'repartir'
export const UNPLANNED_TEXT: Record<Unplanned, string> = {
  vus: 'Je sais marquer « vus » les joueurs d’un événement que tu cites (« marque comme vus les gauchers de l’événement … »). Pour un joueur précis : dans l’événement, l’œil au bout de sa ligne.',
  a_revoir: 'Je sais mettre « à revoir » des joueurs décrits par des critères (« mets à revoir les gauchers 2011 vus aujourd’hui »). Pour un joueur précis : l’horloge au bout de sa ligne, ou sa fiche.',
  suivre: 'Je ne sais pas encore suivre des joueurs d’ici. Aujourd’hui : sélectionne-les (appui long sur une ligne), puis « Suivre » dans la barre du bas, ou « Suivre » sur la fiche.',
  export: 'Je ne rédige pas de bilan ni de rapport. Je sais exporter une liste ou un groupe : « exporte en PDF le groupe … », « sors-moi un tableur des 2011 du Var ».',
  convoquer: 'Je ne sais pas encore convoquer ni envoyer de message. Ouvre le groupe ou l’événement pour avoir la liste des joueurs.',
  evaluer: 'Je n’évalue pas à ta place : ouvre la fiche du joueur (ou l’événement), puis « Évaluer ».',
  comparer: 'Je ne sais pas encore comparer d’ici. Aujourd’hui : sélectionne les joueurs (appui long sur une ligne), puis « Comparer » dans la barre du bas.',
  creer_evenement: 'Je ne sais pas encore créer un événement d’ici. Aujourd’hui : Événements → « + Événement », ou une sélection de joueurs → « Créer un événement ».',
  creer_fiche: 'Je ne crée pas de fiche de joueur d’ici : liste Joueurs, menu « ⋯ » de la barre → « Nouveau joueur ».',
  seance: 'Je ne sais pas encore préparer une séance de tests ni saisir des mesures d’ici : fais-le depuis l’événement ou la fiche du joueur.',
  negatif: 'Je ne pose pas ce genre de marque sur un joueur. Je peux en revanche créer un groupe avec ceux que tu gardes, ou les ajouter à un groupe.',
  dupliquer: 'Je ne sais pas encore dupliquer d’ici. Aujourd’hui : dans Groupes, menu « ⋮ » du groupe → « Dupliquer ».',
  saison: 'Je ne change pas de saison d’ici : page du groupe Pôle, menu « ⋮ » → « Changement de saison ».',
  repartir: 'Je ne sais pas encore répartir des joueurs en plusieurs groupes. Je sais créer un groupe à la fois (« crée un groupe avec les 2011 du Var »).',
}

export type Detected =
  /** Action interdite (supprimer, retirer, modifier, comptes) : refusée sans appel. */
  | { kind: 'interdite' }
  /** Action lue entièrement par les règles locales. */
  | { kind: 'plan'; plan: AskPlan }
  /** Ressemble à une action, mais les règles ne la lisent pas : le modèle décide (mode « action »). */
  | { kind: 'modele' }
  /** Action pas encore prévue (marquer vus, exporter…) : dite tout de suite, avec la façon de faire aujourd'hui. */
  | { kind: 'inconnue'; what: Unplanned }

// Petits mots de tête (virgules permises : « Bon, alors… ») et sujet devant le verbe (« tu me trouves », « tu peux m'ajouter »).
const FILL = String.raw`(?:(?:alors|bon|ok|okay|euh|ecoute|stp|s'il te plait|s'il vous plait|peux tu|tu peux|tu pourrais|pourrais tu|tu veux bien|veux tu|est ce que tu peux|est ce que tu pourrais|je veux que tu|je voudrais que tu|j'aimerais que tu|je voudrais|je veux|j'aimerais|il faudrait|on va|on peut|merci de)[\s,]+)*`
const SUBJ = String.raw`(?:(?:tu|vous)\s+)?(?:(?:me|nous)\s+|m'\s*)?`
const L = String.raw`^${FILL}${SUBJ}`
const ME = String.raw`(?:(?:moi|nous)\s+)?`
const CREATE_V = String.raw`(?:cree|creer|creez|crees|creeras|creera|creerez|fais|faire|faites|fait|feras|genere|generer|constitue|constituer|constitues|forme|former|prepare|preparer|prepares|monte|monter)`
const ADD_V = String.raw`(?:ajoute|ajouter|ajoutez|ajoutes|rajoute|rajouter|rajoutes|mets|mettre|mettez|met|place|placer|inscris|inscrire|inscrivez|integre|integrer)`
const FIND_V = String.raw`(?:trouve|trouver|trouves|cherche|chercher|cherches|prends|prendre|selectionne|selectionner|selectionnes|recupere|recuperer|recuperes|montre|affiche|donne|liste|isole|filtre|sors)`
const GROUP_N = String.raw`(?:groupe|selection|collectif|equipe)`
const EVENT_N = String.raw`(?:evenement|tournoi|stage|match|rassemblement|entrainement|observation|seance|intercomite|interligue|interpole)`
const NAMED = String.raw`(?:\s+(?:appele|appelee|nomme|nommee|intitule|intitulee|qui s'appelle|qu'on appelle)\s+(.+?))?`
const WITH = String.raw`(?:avec|de|des|pour|contenant|regroupant|a partir de|a partir des|qui contient|qui regroupe|qui rassemble)`
/** Mots qui ne commencent jamais le nom d'un groupe dit sans « appelé » (« crée un groupe avec… », « … de… »). */
const NOT_NAME_START = String.raw`(?:avec|de|des|du|d'|pour|contenant|regroupant|a partir|qui|qu'|appele|appelee|nomme|nommee|intitule|intitulee)`
/** Noms de type d'événement gardés dans le nom de la cible (« tournoi de Cannes », « l'intercomité de décembre »). */
const TYPED = String.raw`tournoi|stage|match|rassemblement|entrainement|observation|seance|detection|intercomites?|interligues?|interpoles?|regroupement|journee|plateau|championnat|competition|camp`
/** Mots de type trop vagues seuls (« au stage », « dans le tournoi ») : pas une cible. */
const VAGUE = /^(?:tournoi|stage|match|rassemblement|entrainement|observation|seance|regroupement|journee|plateau|championnat|competition|camp)$/
/**
 * Après « au » / « dans le » : possessif facultatif (« mon groupe »), relatif (« le prochain intercomité », « le dernier
 * stage ») : (0), puis le type : groupe (1), « événement » (2), tournoi, stage… (3) (gardé dans le nom), et le nom (4).
 */
const INTO_TARGET = String.raw`(?:(?:mon|ma|notre|nos|ce|cet|cette)\s+)?(?:(prochain|prochaine|dernier|derniere)\s+)?(?:(groupe|selection|collectif)|(evenement)|(${TYPED}))\b\s*(.*)`
const INTO = String.raw`(?:aux|au|a l'|a la|dans le|dans la|dans l'|dans|a|sur)`

const RE = (src: string) => new RegExp(src, 'd')
// « crée un groupe Stage février avec … » : nom dit sans « appelé », avant « avec ».
const CREATE_NAMED_RE = RE(String.raw`${L}${CREATE_V}\s+${ME}(?:un |une |le |la )?(?:nouveau |nouvelle )?${GROUP_N}\s+(?!${NOT_NAME_START}\b)(.+?)\s+avec\s+(.+)$`)
const CREATE_RE = RE(String.raw`${L}${CREATE_V}\s+${ME}(?:un |une |le |la )?(?:nouveau |nouvelle )?${GROUP_N}${NAMED}\s+${WITH}\s+(.+)$`)
// « crée le groupe Intercomité 2011 et mets-y les 2011 du Var ».
const CREATE_THEN_FILL_RE = RE(String.raw`${L}${CREATE_V}\s+${ME}(?:un |une |le |la )?(?:nouveau |nouvelle )?${GROUP_N}\s+(?!${NOT_NAME_START}\b)(.+?)[\s,]+(?:et|puis)\s+${ADD_V}\s+(?:y|dedans)\s+(.+)$`)
// « … et crée-moi un groupe avec », « … et tu me crées un groupe tournoi IP », « …. Et tu me créeras un groupe préparation
// aux Interpoles » : le nom dit après « groupe » (sans « appelé ») est le nom proposé (groupe 3).
const FIND_CREATE_RE = RE(
  String.raw`${L}${FIND_V}\s+${ME}(.+?)[.,;]?(?:\s+et|\s+puis|,)\s+(?:tu\s+)?(?:(?:me|nous)\s+|m'\s*)?(?:${CREATE_V}|${ADD_V})\s+(?:(?:moi|nous|les|en|leur)\s+)*(?:(?:un|une|le|la|dans un|dans une|en)\s+)?(?:nouveau |nouvelle )?${GROUP_N}(?:${NAMED}|[\s.,:;]+(?!(?:avec|de ces|pour eux|pour elles)\b)(.+?))?(?:\s+(?:avec|avec eux|avec elles|avec ca|avec ces joueurs|avec ces joueuses|de ces joueurs|de ces joueuses))?$`,
)
const FIND_ADD_RE = RE(String.raw`${L}${FIND_V}\s+${ME}(.+?)(?:\s+et|\s+puis|,)\s+(?:tu\s+)?(?:(?:me|nous)\s+|m'\s*)?${ADD_V}\s+(?:(?:moi|nous|les|leur|en)\s+)*${INTO}\s*${INTO_TARGET}$`)
// « mets les joueurs mis à revoir au stage de Toussaint dans l'événement X » : la DERNIÈRE cible dite « groupe » ou
// « événement » (le stage reste un critère des joueurs). Groupe (1), « événement » (2), nom (3).
const ADD_EXPLICIT_RE = RE(String.raw`${L}${ADD_V}\s+${ME}(.+)\s+${INTO}\s*(?:(?:mon|ma|notre|nos|ce|cet|cette)\s+)?(?:(groupe|selection|collectif)|(evenement))\s+(.+)$`)
const ADD_RE = RE(String.raw`${L}${ADD_V}\s+${ME}(.+?)\s+${INTO}\s*${INTO_TARGET}$`)
const OPEN_V = String.raw`(?:montre|montrer|affiche|afficher|donne|donner|liste|lister|ouvre|ouvrir|trouve|trouver|cherche|chercher|recherche|rechercher|recherchez|sors|isole|isoler|filtre|filtrer|filtrez|selectionne|selectionner|je veux|j'aimerais|il me faut)`
const OPEN_RE = RE(
  String.raw`${L}(?:(${OPEN_V})\s+${ME})?(?:moi\s+)?(?:la liste (?:des |de |d')|tous |toutes |uniquement |seulement )?(?:les |des |mes )?(.+?)\s+(?:dans|de|du|des|a|au|pendant|lors de|lors du|sur|parmi)\s+(?:l'|le |la |les |ce |cet |cette )?${INTO_TARGET}$`,
)
/** Ouverture sans verb : la phrase commence par les joueurs (« les gauchers du groupe X »), pas par « quel club… ». */
const NO_VERB_START = new RegExp(String.raw`^${FILL}(?:la liste (?:des |de |d')|tous |toutes |uniquement |seulement |juste )?(?:les |des |mes |ceux |celles |(?:19|20)\d\d\b)`)
const CREATOR_RE = RE(
  String.raw`^${FILL}(?:(?:montre|affiche|donne|liste|trouve|cherche)\s+${ME})?(?:moi\s+)?(?:tous |toutes )?(?:les |des )?(groupes?|evenements?|tournois?|stages?|matchs?|observations?)\s+(?:(?:que|qu')\s*(.+?)\s+(?:a|ont)\s+(?:crees?|creees?|cree|faits?|faites?|montes?|montees?|organises?|organisees?)|(?:crees?|creees?|faits?|faites?|montes?|montees?|organises?|organisees?)\s+par\s+(.+))$`,
)
/** « … et ajoute-les / inscris-les au stage X » à la fin d'une phrase : la deuxième étape. Avant (1), cible (2…6). */
const THEN_RE = RE(
  String.raw`^(.*?)(?:(?:^|\s*[,;.]?\s+)(?:et|puis|ensuite)(?:\s+(?:puis|ensuite|apres))?\s+|\s*[,;.]\s+)(?:tu\s+)?(?:(?:me|nous)\s+|m'\s*)?${ADD_V}\s+(?:(?:les|leur|moi|nous|en|y|aussi|tous|toutes|ensuite)\s+)*${INTO}\s*${INTO_TARGET}$`,
)
/** Mots de joueurs (la partie « joueurs » d'une phrase d'ouverture doit en contenir un, ou une année). */
const PLAYER_WORD =
  /\b(joueurs?|joueuses?|gardiens?|gardiennes?|pivots?|ailiers?|ailieres?|arrieres?|demis?|centres?|gauchers?|gaucheres?|droitiers?|droitieres?|ambidextres?|garcons?|filles?|grands?|grandes?|petits?|petites?|licencies?|licenciees?|jeunes?|(19|20)\d\d)\b/
/** Postes d'un autre sport (selon l'installation) : des mots de joueurs aussi (« les passeuses du groupe X »). */
const PLAYER_WORD_SPORT: Record<string, RegExp> = {
  volley: /\b(passeurs?|passeuses?|central|centraux|centrales?|pointus?|pointues?|opposes?|opposees?|liberos?|receptionneurs?|receptionneuses?|attaquants?|attaquantes?|r4)\b/,
}
const playerWord = (s: string) => PLAYER_WORD.test(s) || !!PLAYER_WORD_SPORT[currentSport().sport]?.test(s)
/** « vus au tournoi », « présents au stage » : une condition de la liste Joueurs, pas une action. */
const SEEN_END = /\b(vus?|vues?|presents?|presentes?|passes?|passees?|venus?|venues?|observes?|observees?|notes?|notees?|evalues?|evaluees?|inscrits?|inscrites?|joue|jouent|selectionnes?|selectionnees?|convoques?|convoquees?)$/
const PRONOUNS = /^(moi|me|nous|toi|vous|je|j'|j|lui|elle|eux|elles|personne|quelqu'un|on|il|ils)$/
/** La cible s'arrête avant ce qui décrit les joueurs (« qui n'ont pas d'avis », « triés par taille », « avec leurs mesures »). */
const TARGET_END =
  /\s+(?=(?:qui|qu'|que|dont|tries?|triees?|classes?|classees?|ranges?|rangees?|ordonnes?|ordonnees?|par ordre|du plus|du moins|de la plus|des plus|les plus|avec (?:leurs?|les|des|une?|plus|moins|au moins)|nes?|nees?|de plus d|de moins d|d'au moins|sans|pas encore|jamais|ayant|en commencant)\b)/
/** Joueurs de la liste affichée (« ceux-là », « cette liste », « les joueurs affichés »). */
const CURRENT =
  /^(?:(?:tous|toutes) )?(?:ceux|celles) ?(?:-|\s)?(?:la|ci)$|^(?:toute )?(?:cette|la) (?:liste|selection)(?: affichee)?$|^(?:tous |toutes )?ces (?:joueurs|joueuses|jeunes)(?: la)?$|^(?:tous |toutes )?les (?:joueurs|joueuses) (?:affiches|affichees|de la liste|de cette liste|selectionnes|selectionnees)$/
/** Simple pronom à la place des joueurs (« ajoute-les au groupe X ») : depuis la liste Joueurs, les joueurs affichés. */
const BARE = /^(?:les|la|le|eux|elles|tous|toutes|les tous|les toutes|tout le monde)$/
/** Verbe d'action dans un morceau lu (« … et envoie-le à Paul », « Crée un groupe… ») : le morceau est mal coupé. */
const ACTION_VERB = String.raw`(?:${CREATE_V}|${ADD_V}|cree|ajoute|supprime|supprimer|retire|retirer|enleve|enlever|envoie|envoyer|convoque|convoquer|exporte|exporter|imprime|imprimer|marque|marquer|note|noter|evalue|evaluer|partage|partager|suis|compare|comparer|ouvre|ouvrir|mets|inscris|transmets|garde|garder)`
const VERB_INSIDE = new RegExp(String.raw`(?:^|[\s,;.])(?:et|puis|ensuite)\s+(?:tu\s+)?(?:(?:me|nous|les|leur|lui|en|y)\s+|m'\s*|l'\s*)*${ACTION_VERB}\b|^${ACTION_VERB}\b`)

/** Actions interdites : supprimer, retirer, modifier une chose précise ; toute action sur des comptes. */
const DEL_V = String.raw`(?:supprime|supprimer|efface|effacer|retire|retirer|enleve|enlever|vide|vider|modifie|modifier|renomme|renommer|archive|archiver|desarchive|deplace|deplacer|change|changer|fusionne|fusionner|exclus|exclure|vire|virer)`
const FORBID_1 = new RegExp(
  String.raw`^${FILL}${DEL_V}\s+(?:moi\s+)?(?:le|la|l'|ce|cet|cette|mon|ma|mes|son|sa|leur|tout le|toute la|un|une)\s*(?:groupe|evenement|tournoi|stage|match|fiche|compte|role|avis|mesure|rassemblement|selection|equipe|joueur|joueuse)\b`,
)
const FORBID_2 = new RegExp(String.raw`^${FILL}${DEL_V}\s+.+?\s+(?:du|de la|de l'|des|de mon|de ma|de notre|de ce|de cette)\s*(?:groupe|evenement|tournoi|stage|match|rassemblement|selection|liste|pole|equipe)\b`)
/** Verbes qui ne servent jamais aux filtres d'une liste : interdits (sauf « supprime la taille », retrait d'un filtre). */
const STRONG_DEL = new RegExp(String.raw`${L}(?:supprime|supprimer|supprimez|modifie|modifier|modifiez|renomme|renommer|fusionne|fusionner|archive|archiver|archivez|desarchive|desarchiver|corrige|corriger|detruis|detruire)\b(.*)$`)
const FILTER_ONLY = /^\s*(?:le |la |l'|les )?(?:tri|taille|annee|annees|poste|postes|sexe|club|clubs|departements?|regions?|lateralite|age|recherche|nom)?$/
/** « change le poste de Jade … » : un champ de la fiche de quelqu'un (nom propre dit après « de »). */
const FIELD_OF = /^(?:change|changer|changez|mets a jour|mettre a jour)\s+(?:le |la |l'|les |son |sa |ses )?(?:statut|poste|taille|poids|date|nom|prenom|club|licence|numero|lateralite|sexe|photo|mesures?|notes?|avis|annee|categorie)\b/
const ACCOUNT = /\b(comptes?|mots? de passe|roles?|droits? d'acces|acces|invitations?)\b/
const ACCOUNT_V = /\b(cree|creer|supprime|supprimer|change|changer|modifie|modifier|donne|donner|retire|retirer|invite|inviter|reinitialise|reinitialiser|ouvre|ouvrir|ferme|fermer|desactive|desactiver|active|activer|envoie|envoyer)\b/
const INVITE = new RegExp(String.raw`${L}(?:invite|inviter|invitez|partage|partager|partagez)\b`)
const FILTER_WORDS = /\b(filtres?|criteres?|conditions?|recherche)\b/
/** Question d'aide ou de navigation (« comment je crée un groupe ? ») : pas une action. */
const HELP_Q = /^(?:comment|pourquoi|est ce que je peux|est ce qu'on peut|ou est|ou sont|ou trouver|ou je|c'est quoi|qu'est ce que|a quoi sert)\b/

/** Repères grossiers d'une action (le modèle décide) : « crée … groupe », « ajoute … au groupe / à l'événement ». */
const LOOSE_CREATE = new RegExp(String.raw`\b${CREATE_V}\b.*\b${GROUP_N}s?\b`)
const LOOSE_ADD = new RegExp(String.raw`\b${ADD_V}\b.*\b(?:aux|au|a l'|a la|dans le|dans la|dans l'|dans un|dans une)\s*(?:nouveau |nouvelle |prochain |prochaine |dernier |derniere )?(?:${GROUP_N}|${EVENT_N})`)

/** « ajoute ceux vus au tournoi » : une condition « vu », pas un ajout. */
const SEEN_BEFORE_INTO = /\b(vus?|vues?|presents?|presentes?|passes?|venus?|venues?|observes?|observees?|notes?|notees?|evalues?|evaluees?|joue|jouent|convoques?|convoquees?)\s+(?:aux|au|a l'|a la|dans le|dans la|dans l'|a|dans)\b/

// Actions pas encore prévues, reconnues au verbe de tête (après les petits mots) ; l'ordre compte.
const DATE_WORDS = /\b(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain|apres demain|le \d|\d{1,2} (?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)|ce week end|la semaine prochaine)\b/
const NEW_EVENT = new RegExp(
  String.raw`${L}(?:(?:${CREATE_V}|programme|programmer|planifie|planifier|organise|organiser)\s+(?:moi\s+)?(?:un |une |le |la )?|(?:${ADD_V})\s+(?:moi\s+)?(?:un |une ))(?:nouvel |nouveau |nouvelle )?(?:evenement|${TYPED})\b(.*)$`,
)
const UNPLANNED: [Unplanned, RegExp][] = [
  ['negatif', new RegExp(String.raw`${L}(?:marque|marquer|marquez|mets|mettre|met|note|noter|classe|classer|passe|passer|indique|indiquer|considere)\b.*\b(?:(?:pas|non)\s+(?:retenus?|retenues?|selectionnes?|selectionnees?|gardes?|gardees?|pris|prises?|interessants?|interessantes?)|ecartes?|ecartees?|elimines?|eliminees?|recales?|recalees?|refuses?|refusees?)\b`)],
  ['repartir', new RegExp(String.raw`${L}(?:${CREATE_V}|repartis|repartir|divise|diviser|separe|separer|coupe|couper)\s+(?:moi\s+)?.*\b(?:deux|trois|quatre|plusieurs|2|3|4)\s+(?:groupes|equipes|poules)\b`)],
  ['seance', new RegExp(String.raw`${L}(?:${CREATE_V}|programme|programmer|lance|lancer|demarre|demarrer|commence|commencer|planifie|planifier|organise|organiser)\s+(?:moi\s+)?(?:une |un |la |le )?(?:nouvelle |nouveau )?(?:seance|session|batterie|serie|journee)\s+de\s+(?:tests?|mesures?)`)],
  ['seance', new RegExp(String.raw`${L}(?:note|noter|notez|saisis|saisir|entre|entrer|rentre|rentrer|mesure|mesurer|enregistre|enregistrer)\s+(?:moi\s+)?(?:les|le|la|l'|des|ses|leurs?)\s*.*\b(?:20 ?m|20 metres|30 metres|detentes?|tailles?|poids|vitesses?|envergures?|mesures?|temps|chronos?|tests?|sprints?)\b`)],
  ['vus', new RegExp(String.raw`${L}(?:marque|marquer|marquez|coche|cocher|note|noter|notez|indique|indiquer|mets|mettre|met|passe|passer)\s+.*\b(?:comme|en)\s+(?:vus?|vues?|presents?|presentes?)\b`)],
  ['vus', new RegExp(String.raw`${L}(?:marque|marquer|marquez|coche|cocher)\s+.*\b(?:vus?|vues?|presents?|presentes?)\b`)],
  ['a_revoir', new RegExp(String.raw`${L}(?:mets|mettre|mettez|met|passe|passer|marque|marquer|place|placer|note|noter)\b(?!.*\b(?:dans|au|a|aux)\s+(?:le |la |l'|mon |ma )?(?:groupe|evenement)\b).*?(?<!\b(?:mis|mises|sont|les|des|aux|mes|ses|nos|deja))\s(?:en\s+)?a revoir\b`)],
  ['a_revoir', new RegExp(String.raw`${L}${ADD_V}\s+.*\b(?:a|aux|dans)\s+(?:mes |nos |les |ma liste des |ma liste d')?a revoir$`)],
  // « mets-les (tous) à revoir » : le pronom seul (les joueurs affichés, depuis la liste Joueurs).
  ['a_revoir', new RegExp(String.raw`${L}(?:mets|mettre|mettez|met|passe|passer|marque|marquer|place|placer)\s+(?:les|eux|elles|ceux la|celles la)(?:\s+(?:tous|toutes))?\s+(?:en\s+)?a revoir(?:\s+pour (?:moi|toi|nous))?$`)],
  ['a_revoir', new RegExp(String.raw`${L}${ADD_V}\s+${ME}(?:a|aux|dans)\s+(?:mes |nos |les |ma liste des |ma liste d')?a revoir\s+\S`)],
  ['suivre', new RegExp(String.raw`${L}(?:suis|suivre|suivez)\b`)],
  ['suivre', new RegExp(String.raw`${L}${ADD_V}\s+.*\b(?:a|aux|dans|en)\s+(?:mes |nos |les )?(?:suivis|favoris|suivi)$`)],
  ['export', new RegExp(String.raw`${L}(?:exporte|exporter|exportez|imprime|imprimer|imprimez|telecharge|telecharger)\b`)],
  ['export', new RegExp(String.raw`${L}(?:${CREATE_V}|sors|sortir|donne|donner)\s+(?:moi\s+)?(?:un|une)\s+(?:pdf|excel|csv|fichier|tableur|tableau (?:excel|csv|tableur)|export|impression|bilan|rapport|compte rendu|synthese|resume)\b`)],
  ['convoquer', new RegExp(String.raw`${L}(?:convoque|convoquer|convoquez|envoie|envoyer|envoyez|ecris|ecrire|previens|prevenir|contacte|contacter|appelle|appeler|relance|relancer)\b`)],
  ['convoquer', new RegExp(String.raw`${L}(?:${CREATE_V}|redige|rediger)\s+(?:moi\s+)?(?:la |les |une |des )?(?:convocations?|mails?|courriels?|messages?|lettres?)\b`)],
  ['comparer', new RegExp(String.raw`${L}(?:compare|comparer|comparez)\b`)],
  ['evaluer', new RegExp(String.raw`${L}(?:evalue|evaluer|evaluez)\b`)],
  // « note-les », « note Hugo Exemple » ; pas « note moyenne des gauchers » (une question).
  ['evaluer', new RegExp(String.raw`${L}(?:note|noter|notez)\s+(?:moi\s+)?(?:(?:les|le|la|l'|ce|cet|cette|ces|tous|toutes|ceux|celles|mes|lui|eux|elles)\b|(?!(?:moyenne|moyen|moyennes|des|de|du|d'|globale|finale|max|min|par)\b)\S+(?:\s+\S+)?$)`)],
  ['evaluer', new RegExp(String.raw`${L}(?:mets|mettre|met|donne|donner|ajoute|ajouter)\s+(?:moi\s+)?(?:une|un|des|ma|mon)\s+(?:note|notes|avis|appreciation|commentaire|evaluation)\b`)],
  ['creer_fiche', new RegExp(String.raw`${L}(?:${CREATE_V}|${ADD_V}|enregistre|enregistrer)\s+(?:moi\s+)?(?:un|une)\s+(?:nouveau |nouvelle )?(?:joueur|joueuse|fiche|licencie|licenciee)\b(?!.*\b(?:au|a|dans)\s+(?:le |la |l')?(?:groupe|evenement|${TYPED})\b)`)],
  ['dupliquer', new RegExp(String.raw`${L}(?:duplique|dupliquer|copie|copier|clone|cloner)\b`)],
  ['saison', /\b(?:passe|passer|change|changer|bascule|basculer)\s+(?:a la |de |en )?(?:saison suivante|nouvelle saison|prochaine saison)\b|\bchangement de saison\b/],
]

function unplannedOf(n: string): Unplanned | null {
  // Marque négative, répartition, séance de tests d'abord (« programme une séance de tests » n'est pas un événement à créer).
  const first = UNPLANNED.find(([what, re]) => (what === 'negatif' || what === 'repartir' || what === 'seance') && re.test(n))
  if (first) return first[0]
  const e = NEW_EVENT.exec(n)
  // « fais un événement avec les 2011 du Var » : la liste Joueurs, puis « Créer l'événement » (comme avant).
  if (e && !(/^\s+(?:avec|des|de|pour|a partir)\s/.test(e[1]) && playerWord(e[1]) && !DATE_WORDS.test(e[1]))) return 'creer_evenement'
  for (const [what, re] of UNPLANNED) if (re.test(n)) return what
  return null
}

/** Phrase préparée : original (NFC, sans « euh » ni politesse finale) et repliée de même longueur (« crée-moi » → « cree moi »). */
function prep(phrase: string) {
  const text = phrase
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s,])(?:euh+|heu+|hum+|bah|hein|du coup|en fait)(?=[\s,.!?…]|$),?/gi, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[\s,]+/, '')
    .replace(/[\s.!?…]+$/, '')
    .replace(/[\s,]+(?:s['’]il te pla[iî]t|s['’]il vous pla[iî]t|stp|svp|steuplait|merci(?: beaucoup)?)$/i, '')
    .replace(/[\s,.!?…]+$/, '')
    .trim()
  const n = fold(text)
    .replace(/[’`´]/g, "'")
    .replace(/-(moi|nous|les|leur|en|toi|y)\b/g, ' $1')
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

/** Coupe une cible avant ce qui décrit les joueurs : { nom, suite } (la suite revient à la partie « joueurs »). */
function splitTarget(name: string): { name: string; extra: string } {
  const m = TARGET_END.exec(fold(name).replace(/[’`´]/g, "'"))
  return m ? { name: name.slice(0, m.index).trim(), extra: name.slice(m.index).trim() } : { name, extra: '' }
}

/**
 * Cible lue à partir du groupe `base` (relatif, groupe, « événement », type, nom) : « tournoi de Cannes » garde son mot de
 * type ; « l'événement X », « le groupe X » : X seulement ; « le prochain intercomité » garde « prochain ». La suite qui décrit
 * les joueurs (« qui… », « triés… ») est rendue à part ; type seul trop vague (« au stage ») : rien.
 */
function targetOf(text: string, m: RegExpExecArray, base: number): { kind: 'groupe' | 'evenement'; name: string; extra: string } | undefined {
  const rel = piece(text, m, base)
  const raw = piece(text, m, base + 4) ?? ''
  if (m[base + 1] || m[base + 2]) {
    const s = splitTarget(raw)
    if (!s.name) return undefined
    return m[base + 1] ? { kind: 'groupe', ...s } : { kind: 'evenement', name: rel ? `${rel} ${s.name}` : s.name, extra: s.extra }
  }
  const noun = piece(text, m, base + 3) ?? ''
  const s = splitTarget(`${noun} ${raw}`.trim())
  if (!rel && VAGUE.test(fold(s.name))) return undefined
  return { kind: 'evenement', name: rel ? `${rel} ${s.name}` : s.name, extra: s.extra }
}

/** « … et ajoute-les au stage de Pâques » / « … et mets-les à revoir » à la fin de `text` : ce qui précède, et la deuxième étape. */
function splitThen(text: string, n: string): { before: string; then: NonNullable<AskPlan['then']> } | null {
  const r = THEN_REWATCH_RE.exec(n)
  if (r) return { before: (piece(text, r, 1) ?? '').replace(/[\s.,;:]+$/, ''), then: { action: 'mettre_a_revoir' } }
  const m = THEN_RE.exec(n)
  if (!m) return null
  const t = targetOf(text, m, 2)
  if (!t || t.extra) return null
  return { before: (piece(text, m, 1) ?? '').replace(/[\s.,;:]+$/, ''), then: { action: t.kind === 'groupe' ? 'ajouter_groupe' : 'ajouter_evenement', target: t.name } }
}

// ---------- Mettre à revoir, marquer vus, exporter (règles locales) ----------

type Read = Omit<AskPlan, 'nonGere' | 'local'> | 'modele' | null
/** « tous les joueurs », « toutes les fiches », « tout le monde » : tous (la cible ou la liste entière), sans critère. */
const ALL_PLAYERS = /^(?:(?:tous|toutes|les|des|mes)\s+)*(?:joueurs?|joueuses?|jeunes|licencies?|licenciees?|membres|fiches)$|^tout(?: le monde)?$/
const foldWho = (s: string) => fold(s).replace(/[’`´]/g, "'").replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
/** Partie « joueurs » sans aucun critère (« tous les joueurs de l'événement X ») : rien à demander au modèle. */
export const isAllPlayers = (s: string | undefined) => !!s && ALL_PLAYERS.test(foldWho(s))
/**
 * Partie « joueurs » d'une des trois actions : des critères ou un pronom (« ok », lus ensuite), un nom propre ou un numéro
 * (null : un joueur précis, pas encore prévu ici), autre chose, « ceux qui… » compris (le modèle).
 */
function whoKind(who: string): 'ok' | 'modele' | null {
  const w = foldWho(who)
  if (!w) return null
  if (CURRENT.test(w) || BARE.test(w) || ALL_PLAYERS.test(w) || playerWord(w)) return 'ok'
  if (/^(?:le |la |l')?(?:\p{Lu}|\d)/u.test(who.trim()) || /\b(?:numero|n°|fiche)\b/.test(w)) return null
  return 'modele'
}
const RW_V = String.raw`(?:mets|mettre|mettez|met|passe|passer|marque|marquer|place|placer|note|noter)`
const RW_LIST = String.raw`(?:mes |nos |les |ma liste des |ma liste d'|ma liste |la liste des |la liste d')?a revoir`
/** « Mets à revoir les gauchers vus aujourd'hui » : joueurs (1). */
const REWATCH_FIRST = RE(String.raw`${L}${RW_V}\s+${ME}(?:en\s+)?a revoir\s+(.+)$`)
/** « Mets les 2011 à revoir au stage de Toussaint » : joueurs (1), suite (2). */
const REWATCH_AFTER = RE(String.raw`${L}${RW_V}\s+${ME}(.+?)\s+(?:en\s+)?a revoir(?:\s+(.+))?$`)
/** « Ajoute les gauchers vus aujourd'hui à mes à revoir » / « ajoute à mes à revoir les 2011 du tournoi X » : joueurs (1). */
const REWATCH_ADD = RE(String.raw`${L}${ADD_V}\s+${ME}(.+?)\s+(?:a|aux|dans)\s+${RW_LIST}$`)
const REWATCH_ADD_FIRST = RE(String.raw`${L}${ADD_V}\s+${ME}(?:a|aux|dans)\s+${RW_LIST}\s+(.+)$`)
/** Suite « au stage de Toussaint », « à l'événement X » : l'événement d'où ils sont mis à revoir (relatif (1)… nom (5)). */
const AT_EVENT = RE(String.raw`^${INTO}\s*(?:l'\s*|le |la )?${INTO_TARGET}$`)
/** « … et mets-les à revoir » à la fin d'une création ou d'un ajout : avant (1). */
const THEN_REWATCH_RE = RE(
  String.raw`^(.*?)(?:(?:^|\s*[,;.]?\s+)(?:et|puis|ensuite)(?:\s+(?:puis|ensuite|apres))?\s+|\s*[,;.]\s+)(?:tu\s+)?(?:(?:me|nous)\s+|m'\s*)?${RW_V}\s+(?:(?:les|leur|moi|nous|aussi|tous|toutes|ensuite)\s+)*(?:en\s+)?a revoir(?:\s+pour (?:moi|toi|nous))?$`,
)

/** Mettre à revoir (règles locales) ; l'événement dit (« au stage X ») : chercher parmi ses joueurs, et l'origine. */
function readRewatch(text: string, n: string): Read {
  let who: string | undefined
  let tail: [number, number] | undefined
  let m: RegExpExecArray | null
  if ((m = REWATCH_FIRST.exec(n)) || (m = REWATCH_ADD_FIRST.exec(n)) || (m = REWATCH_ADD.exec(n))) who = piece(text, m, 1)
  else if ((m = REWATCH_AFTER.exec(n))) {
    who = piece(text, m, 1)
    tail = m.indices?.[2]
  }
  if (!who) return 'modele'
  const k = whoKind(who)
  if (k !== 'ok') return k
  if (!tail) return { action: 'mettre_a_revoir', playersPhrase: who }
  const tt = text.slice(tail[0], tail[1])
  const tn = n.slice(tail[0], tail[1])
  if (/^pour (?:moi|toi|nous)$/.test(tn)) return { action: 'mettre_a_revoir', playersPhrase: who }
  const a = AT_EVENT.exec(tn)
  const t = a ? targetOf(tt, a, 1) : undefined
  // « pour le stage », « au stage » (trop vague), « au groupe X » : le modèle, jamais une cible devinée.
  if (!t || t.kind !== 'evenement') return 'modele'
  return { action: 'mettre_a_revoir', target: t.name, playersPhrase: t.extra ? `${who} ${t.extra}` : who }
}

const SEEN_V = String.raw`(?:marque|marquer|marquez|coche|cocher|cochez|note|noter|notez|indique|indiquer|mets|mettre|met|passe|passer)`
const VU = String.raw`(?:vus?|vues?|presents?|presentes?)`
const OF_EVENT = String.raw`(?:de|du|des|dans|a|au|aux|pendant|lors de|lors du|sur)\s+(?:l'\s*|le |la |les )?`
/** « Marque comme vus tous les joueurs de l'événement X » : joueurs (1), cible (2…6). */
const SEEN_FIRST = RE(String.raw`${L}${SEEN_V}\s+${ME}(?:comme|en)\s+${VU}\s+(.+?)\s+${OF_EVENT}${INTO_TARGET}$`)
/** « Note-les comme vus au tournoi X », « marque les gauchers vus à l'événement X » : joueurs (1), cible (2…6). */
const SEEN_AFTER = RE(String.raw`${L}${SEEN_V}\s+${ME}(.+?)\s+(?:comme\s+|en\s+)?${VU}\s+${INTO}\s*(?:l'\s*|le |la )?${INTO_TARGET}$`)

/** Marquer vus à un événement (règles locales) : l'événement est obligatoire (un « vu » y est toujours lié). */
function readSeen(text: string, n: string): Read {
  const m = SEEN_FIRST.exec(n) ?? SEEN_AFTER.exec(n)
  if (!m) return null
  const who = piece(text, m, 1)
  const t = targetOf(text, m, 2)
  if (!who || !t || t.kind !== 'evenement') return null
  const k = whoKind(who)
  if (k !== 'ok') return k
  return { action: 'marquer_vus', target: t.name, playersPhrase: t.extra ? `${who} ${t.extra}` : who }
}

const EXPORT_V = String.raw`(?:exporte|exporter|exportez|imprime|imprimer|imprimez|telecharge|telecharger|telechargez)`
/** « Exporte en PDF les joueurs du groupe X », « imprime la liste des 2011 du Var » : verbe (1), reste (2). */
const EXPORT_RE = RE(String.raw`${L}(${EXPORT_V})\s+${ME}(.+)$`)
/** « Fais-moi un PDF du groupe X », « sors-moi un tableau Excel des gauchers » : format (1), « de » (2), reste (3). */
const EXPORT_MAKE_RE = RE(
  String.raw`${L}(?:${CREATE_V}|sors|sortir|donne|donner)\s+${ME}(?:un |une |le |la )(pdf|fichier (?:excel|csv|pdf)|excel|csv|tableur|tableau (?:excel|csv|tableur)|export|impression|liste a imprimer)\s+(de la |de l'|du |des |de |d')(.+)$`,
)
const FORMAT_IN = /(?:^|\s+)(?:en|au format|sous forme de|format|dans un|dans une)\s+(?:fichier\s+)?(pdf|excel|csv|tableur|tableau)\b/
/** « les joueurs du groupe X », « le groupe X », « la liste du groupe X » : le nom (1). */
const GROUP_EXPORT = RE(
  String.raw`^(?:(?:tous |toutes )?(?:les )?(?:joueurs|joueuses|membres|fiches) (?:du|de mon|de ma|de notre|de ce|de cette|de) |la liste (?:du|de mon|de ma|des joueurs du|des joueuses du|des membres du) |le |mon |ma |notre |ce |cette )?(?:groupe|selection|collectif)\s+(.+)$`,
)
const formatOf = (f: string): 'pdf' | 'csv' => (/pdf|impr/.test(f) ? 'pdf' : 'csv')

/** Exporter (règles locales) : un groupe cité (tous ses joueurs), sinon une liste de joueurs ; rien n'est écrit. */
function readExport(text: string, n: string): Read {
  let tr: string
  let nr: string
  let format: 'pdf' | 'csv' | undefined
  let m: RegExpExecArray | null
  if ((m = EXPORT_RE.exec(n))) {
    const at = m.indices?.[2] ?? [0, 0]
    tr = text.slice(at[0], at[1])
    nr = n.slice(at[0], at[1])
    if (m[1].startsWith('impr')) format = 'pdf'
  } else if ((m = EXPORT_MAKE_RE.exec(n))) {
    const at = m.indices?.[3] ?? [0, 0]
    format = formatOf(m[1])
    const pre = m[2] === 'du ' ? 'le ' : m[2] === 'des ' ? 'les ' : m[2] === 'de la ' ? 'la ' : m[2] === "de l'" ? "l'" : ''
    tr = pre + text.slice(at[0], at[1])
    nr = pre + n.slice(at[0], at[1])
  } else return null
  // Format dit dans la phrase (« en PDF », « en Excel ») : retenu, puis retiré de la partie « joueurs ».
  let f: RegExpExecArray | null
  while ((f = FORMAT_IN.exec(nr))) {
    format = formatOf(f[1])
    tr = (tr.slice(0, f.index) + ' ' + tr.slice(f.index + f[0].length)).replace(/\s+/g, ' ').trim()
    nr = (nr.slice(0, f.index) + ' ' + nr.slice(f.index + f[0].length)).replace(/\s+/g, ' ').trim()
  }
  const fmt = format ? { format } : {}
  const g = GROUP_EXPORT.exec(nr)
  if (g) {
    const s = splitTarget(piece(tr, g, 1) ?? '')
    if (!s.name || s.extra) return 'modele'
    return { action: 'exporter', target: s.name, ...fmt }
  }
  const who = tr.replace(/^la liste (?:des|de la|de l'|du)\s*/i, (x) => (/des\s*$/i.test(x) ? 'les ' : /du\s*$/i.test(x) ? 'le ' : /de la\s*$/i.test(x) ? 'la ' : "l'")).trim()
  const k = whoKind(who)
  if (k !== 'ok') return k
  return { action: 'exporter', playersPhrase: who, ...fmt }
}

/**
 * « les gauchers dans l'événement X », « les gardiennes du groupe Y » : une ouverture filtrée. Pas « les joueurs du tournoi
 * de X » (tous ses joueurs : filtre de la liste Joueurs, comme avant) ni « les gardiennes vues au stage » (condition « vu ») :
 * un vrai critère de joueurs, et « dans » / « parmi », le mot « événement » / « groupe », ou une précision après la cible.
 */
function openable(n: string, who: string, explicit: boolean, extra: string): boolean {
  // `explicit` : « événement » / « groupe » dit, ou référence relative (« du prochain intercomité » : la liste ne la lit pas).
  if (!playerWord(who) || SEEN_END.test(who)) return false
  if (!extra && /^(?:(?:tous|toutes|les|des|mes|ces)\s+)*(?:joueurs?|joueuses?|jeunes|licencies?|licenciees?)$/.test(who)) return false
  return explicit || !!extra || /\s(?:dans|parmi|pendant|lors de|lors du)\s/.test(n)
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
  if (!FILTER_WORDS.test(n) && !/^(?:efface|effacer|enleve|enlever|retire|retirer|vide|vider)\s+(?:tout|les filtres|le filtre|la selection)\b/.test(n)) {
    const strong = STRONG_DEL.exec(n)
    const field = FIELD_OF.exec(n.replace(new RegExp(`^${FILL}`), ''))
    if (FORBID_1.test(n) || FORBID_2.test(n) || (strong && !FILTER_ONLY.test(strong[1])) || (field && /\b(?:de|du|d['’])\s*(?:[A-ZÀ-Ý]|ce joueur|cette joueuse|la joueuse|joueur)/.test(text)))
      return { kind: 'interdite' }
  }
  if ((ACCOUNT.test(n) && ACCOUNT_V.test(n)) || INVITE.test(n)) return { kind: 'interdite' }
  if (HELP_Q.test(n)) return null

  /** Plan lu : relu avant d'être rendu (morceau mal coupé → le modèle ; « ceux-là » → la liste affichée). */
  const plan = (p: Omit<AskPlan, 'nonGere' | 'local'>): Detected => {
    const pp = p.playersPhrase ? fold(p.playersPhrase).replace(/[’`´]/g, "'").replace(/-/g, ' ').replace(/\s+/g, ' ').trim() : ''
    if ([p.playersPhrase, p.name, p.target].some((s) => s && VERB_INSIDE.test(fold(s).replace(/[’`´]/g, "'").replace(/-(les|leur|le|la|y|en)\b/g, ' $1')))) return { kind: 'modele' }
    if (pp && /\bet (?:un|une) autre\b/.test(pp)) return { kind: 'modele' }
    // Deux cibles (« dans le groupe X et dans le stage Y ») : le modèle, jamais une cible « X et dans le stage Y ».
    if (p.target && /(?:\s(?:et|puis)|,)\s+(?:dans|au|aux|a|sur|le groupe|l'evenement|le stage|le tournoi)\b/.test(fold(p.target).replace(/[’`´]/g, "'"))) return { kind: 'modele' }
    let q: Omit<AskPlan, 'nonGere' | 'local'> = p
    if (pp && (CURRENT.test(pp.replace(/ la$/, ' la').replace(/ (la|ci)$/, ' $1')) || (page === 'joueurs' && BARE.test(pp)))) {
      q = { ...p, current: true }
      delete q.playersPhrase
    } else if (pp && BARE.test(pp)) return { kind: 'modele' }
    return { kind: 'plan', plan: { ...q, nonGere: [], local: true } }
  }
  const what = unplannedOf(n)
  // Mettre à revoir, marquer vus, exporter : lus ici ; un joueur précis (nom, numéro) reste « pas encore prévu » ; une
  // tournure que les règles ne lisent pas part au modèle.
  if (what === 'a_revoir' || what === 'vus' || what === 'export') {
    const r = what === 'a_revoir' ? readRewatch(text, n) : what === 'vus' ? readSeen(text, n) : readExport(text, n)
    if (r === 'modele') return { kind: 'modele' }
    if (r) return plan(r)
  }
  if (what) return { kind: 'inconnue', what }
  /** Partie « joueurs » d'une création : la deuxième étape éventuelle (« … et ajoute-les au stage X ») mise à part. */
  const create = (rest: string | undefined, name: string | undefined): Detected | null => {
    if (!rest) return null
    const at = text.lastIndexOf(rest)
    const sp = at >= 0 ? splitThen(rest, n.slice(at, at + rest.length)) : null
    if (sp && !sp.before) return null
    return plan({ action: 'creer_groupe', ...(name ? { name } : {}), playersPhrase: sp ? sp.before : rest, ...(sp ? { then: sp.then } : {}) })
  }
  let m: RegExpExecArray | null
  // « crée un groupe pour samedi avec mes meilleurs » : « pour samedi » n'est pas une partie « joueurs ».
  if (new RegExp(String.raw`${GROUP_N}\s+pour\s+.+?\savec\s`).test(n) && !CREATE_NAMED_RE.test(n)) return { kind: 'modele' }
  if ((m = CREATE_NAMED_RE.exec(n))) {
    const d = create(piece(text, m, 2), piece(text, m, 1))
    if (d) return d
  }
  if ((m = CREATE_RE.exec(n))) {
    const d = create(piece(text, m, 2), piece(text, m, 1))
    if (d) return d
  }
  if ((m = CREATE_THEN_FILL_RE.exec(n))) {
    const rest = piece(text, m, 2)?.replace(/\s+dedans$/i, '')
    if (rest) return plan({ action: 'creer_groupe', name: piece(text, m, 1), playersPhrase: rest })
  }
  if ((m = FIND_CREATE_RE.exec(n))) {
    const rest = piece(text, m, 1)?.replace(/[\s.,;:]+$/, '')
    let name = (piece(text, m, 2) ?? piece(text, m, 3))?.replace(/[\s.,;:]+$/, '')
    let then: AskPlan['then']
    if (name) {
      const at = m.indices?.[3]
      const sp = !piece(text, m, 2) && at ? splitThen(text.slice(at[0], at[1]), n.slice(at[0], at[1])) : null
      if (sp) {
        name = sp.before || undefined
        then = sp.then
      }
    }
    if (rest) return plan({ action: 'creer_groupe', ...(name ? { name } : {}), playersPhrase: rest, ...(then ? { then } : {}) })
  }
  if ((m = FIND_ADD_RE.exec(n))) {
    const rest = piece(text, m, 1)
    const t = targetOf(text, m, 2)
    if (rest && t) return plan({ action: t.kind === 'groupe' ? 'ajouter_groupe' : 'ajouter_evenement', target: t.name, playersPhrase: t.extra ? `${rest} ${t.extra}` : rest })
  }
  if ((m = ADD_EXPLICIT_RE.exec(n))) {
    const rest = piece(text, m, 1)
    const s = splitTarget(piece(text, m, 4) ?? '')
    if (rest && s.name) return plan({ action: m[2] ? 'ajouter_groupe' : 'ajouter_evenement', target: s.name, playersPhrase: s.extra ? `${rest} ${s.extra}` : rest })
  }
  if ((m = ADD_RE.exec(n)) && !SEEN_END.test(m[1])) {
    const rest = piece(text, m, 1)
    const t = targetOf(text, m, 2)
    if (rest && t) return plan({ action: t.kind === 'groupe' ? 'ajouter_groupe' : 'ajouter_evenement', target: t.name, playersPhrase: t.extra ? `${rest} ${t.extra}` : rest })
  }
  if ((m = CREATOR_RE.exec(n))) {
    const who = piece(text, m, 2) ?? piece(text, m, 3)
    if (who && !PRONOUNS.test(fold(who))) return plan({ action: 'filtrer_createur', creators: [who], list: m[1].startsWith('groupe') ? 'groupes' : 'evenements' })
  }
  if (page !== 'joueurs' && (m = OPEN_RE.exec(n)) && (m[1] || NO_VERB_START.test(n) || playerWord(m[2].split(' ')[0]))) {
    const rest = piece(text, m, 2)
    const t = targetOf(text, m, 3)
    if (rest && t && openable(n, m[2], !!(m[3] || m[4] || m[5]), t.extra))
      return plan({ action: t.kind === 'groupe' ? 'ouvrir_groupe' : 'ouvrir_evenement', target: t.name, playersPhrase: playersText(t.extra ? `${rest} ${t.extra}` : rest) })
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

/**
 * Cible dite, retrouvée sur l'appareil, références relatives comprises : « le prochain intercomité » → l'événement À VENIR
 * le plus proche dont le nom contient « intercomité » ; « le dernier stage » → le stage PASSÉ le plus récent ; toujours à
 * confirmer (« Tu voulais dire … ? », les autres en choix). « mon groupe X » → X. Sinon : matchName.
 */
export function matchTarget<T extends { name: string; date?: string }>(said: string, items: readonly T[], today: string): NameMatch<T> {
  const k = nameKey(said).replace(/^(?:le|la|l|au|a la)\s+/, '')
  const r = /^(prochain|prochaine|dernier|derniere)\s+(.+)$/.exec(k)
  if (!r) return matchName(said.replace(/^\s*(?:mon|ma|notre|nos)\s+(?:groupe\s+|sélection\s+|selection\s+)?/i, ''), items)
  const next = r[1].startsWith('prochain')
  const words = tokens(r[2])
  if (!words.length) return { kind: 'none' }
  const hits = items
    .filter((x) => x.date && (next ? x.date >= today : x.date <= today))
    .filter((x) => {
      const c = tokens(x.name)
      return words.every((w) => c.some((t) => wordLike(w, t) >= 0.8))
    })
    .sort((a, b) => (next ? (a.date ?? '').localeCompare(b.date ?? '') : (b.date ?? '').localeCompare(a.date ?? '')))
  if (!hits.length) return { kind: 'none' }
  return { kind: 'approx', best: hits[0], choices: hits.slice(0, MAX_CHOICES) }
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
  /** Deuxième étape (plan.then) : la cible retrouvée, les joueurs déjà dedans (ou déjà à revoir) et les droits. */
  then?: { target?: { name: string }; already?: number; allowed: boolean; deniedWhy?: string }
  /** mettre_a_revoir sans événement : d'où l'« à revoir » est posé, en mots (« depuis la liste « gauchers · 2011 » »). */
  origin?: string
  /** exporter : le groupe visé est un groupe Pôle (son tableur se fait depuis sa page, avec les colonnes du pôle). */
  pole?: boolean
}

/** exports : les boutons de l'export (exporter), à la place d'« Accepter ». */
export type Card = { steps: string[]; warnings: string[]; canAccept: boolean; blocked?: string; exports?: ('pdf' | 'csv')[] }

/** « Les » (plusieurs), « La » (une joueuse), « Le » (un joueur). */
const them = (n: number, g?: Gender) => (n > 1 ? 'Les' : g === 'F' ? 'La' : 'Le')

/** Récapitulatif « Je vais : 1) … 2) … », avertissements, et si « Accepter » est proposé. */
export function buildCard(c: CardInput): Card {
  const a = c.plan.action
  const who = pluralG(c.count, c.gender ?? null)
  const crit = c.criteria.length ? c.criteria.join(' · ') : 'tous les joueurs'
  const steps: string[] = []
  const warnings: string[] = []
  const t = c.target?.name ? `« ${c.target.name} »` : ''
  let exports: Card['exports']
  if (a === 'marquer_vus') {
    steps.push(`Dans l’événement ${t} : ${crit} → ${who}`)
    steps.push(`${them(c.count, c.gender)} marquer ${accord('vu', c.gender ?? null, c.count)} à cet événement (aujourd’hui, par toi)${c.already ? `, ${c.already} déjà ${accord('vu', c.gender ?? null, c.already)}` : ''}`)
  } else if (a === 'mettre_a_revoir') {
    steps.push(t ? `Chercher dans l’événement ${t} : ${crit} → ${who}` : `Chercher : ${crit} → ${who}`)
    const from = t ? `depuis l’événement ${t}` : (c.origin ?? '')
    steps.push(`${them(c.count, c.gender)} mettre à revoir pour toi${from ? ` (${from})` : ''}${c.already ? `, ${c.already} ${c.already > 1 ? 'le sont' : 'l’est'} déjà` : ''}`)
  } else if (a === 'exporter') {
    steps.push(t ? `Joueurs du groupe ${t} → ${who}` : `Joueurs : ${crit} → ${who}`)
    steps.push('Ouvrir l’export :')
    exports = t ? (c.pole ? ['pdf'] : ['pdf', 'csv']) : ['csv']
    if (!t && c.plan.format === 'pdf') warnings.push('Liste à imprimer (PDF) : seulement pour un groupe (crée d’abord un groupe avec ces joueurs, puis « Exporter PDF »). Ici : le tableur.')
    if (t && c.pole) warnings.push('Tableur d’un groupe Pôle : depuis la page du groupe, menu « ⋮ » → « Exporter CSV » (avec les colonnes du pôle).')
  } else if (a === 'filtrer_createur') {
    steps.push(`Afficher les ${c.plan.list === 'evenements' ? 'événements' : 'groupes'} créés par ${t || `« ${c.plan.creators?.[0] ?? ''} »`}`)
  } else if (a === 'ouvrir_evenement' || a === 'ouvrir_groupe') {
    steps.push(`Chercher dans ${a === 'ouvrir_groupe' ? 'le groupe' : 'l’événement'} ${t} : ${crit} → ${who}`)
    steps.push(`Ouvrir ${a === 'ouvrir_groupe' ? 'le groupe' : 'l’événement'} et n’afficher que ${c.count > 1 ? 'ces joueurs' : 'ce résultat'}`)
  } else {
    steps.push(`Chercher : ${crit} → ${who}`)
    if (a === 'creer_groupe') steps.push(`Créer le groupe « ${(c.groupName ?? '').trim() || 'Nouveau groupe'} » avec ${c.count > 1 ? `ces ${who}` : who} (visible par moi seul, modifiable ensuite)`)
    else steps.push(`Ajouter ${c.count > 1 ? `ces ${who}` : who} ${a === 'ajouter_groupe' ? 'au groupe' : 'à l’événement'} ${t}${c.already ? ` (${c.already} déjà dedans)` : ''}`)
    const th = c.plan.then
    if (th?.action === 'mettre_a_revoir') {
      steps.push(`Puis ${them(c.count, c.gender).toLowerCase()} mettre à revoir pour toi${c.then?.already ? ` (${c.then.already} ${c.then.already > 1 ? 'le sont' : 'l’est'} déjà)` : ''}`)
    } else if (th) {
      const tt = c.then?.target?.name ?? th.target ?? ''
      steps.push(`Puis ajouter ${c.count > 1 ? 'les mêmes' : 'le même'} ${th.action === 'ajouter_groupe' ? 'au groupe' : 'à l’événement'} « ${tt} »${c.then?.already ? ` (${c.then.already} déjà dedans)` : ''}`)
    }
  }
  if (c.count > BIG && WRITES.includes(a)) warnings.push(`Plus de ${BIG} joueurs : vérifie les critères avant d’accepter.`)
  if (c.unsupported?.length) warnings.push(`Pas pris en compte : ${c.unsupported.join(' ; ')}`)
  // Sans critère, tous les joueurs : permis seulement quand la phrase le dit d'un événement (« marque comme vus tous les
  // joueurs de l'événement X ») ou pour un export, et que rien n'est resté incompris.
  const allowAll = (a === 'marquer_vus' || (a === 'mettre_a_revoir' && !!c.target) || a === 'exporter') && !c.unsupported?.length
  let blocked: string | undefined
  if (!c.allowed) blocked = c.deniedWhy || 'Ton rôle ne permet pas cette action.'
  else if ((WRITES.includes(a) || a === 'exporter') && c.noCriteria && !allowAll) blocked = 'Je n’ai compris aucun critère de joueurs : précise la demande (par exemple « les gauchers de 2011 »).'
  else if (a === 'exporter' && !c.count) blocked = 'Aucun joueur ne correspond : rien à exporter.'
  else if (WRITES.includes(a) && !c.count) blocked = 'Aucun joueur ne correspond : rien à faire.'
  else if (a !== 'creer_groupe' && WRITES.includes(a) && c.already === c.count)
    blocked =
      a === 'mettre_a_revoir'
        ? `Déjà ${c.count > 1 ? `${w(c.gender ?? null).tous} ` : ''}à revoir pour toi : rien à faire.`
        : a === 'marquer_vus'
          ? `Déjà ${c.count > 1 ? `${w(c.gender ?? null).tous} ` : ''}${accord('vu', c.gender ?? null, c.count)} par toi à cet événement : rien à faire.`
          : 'Ces joueurs y sont déjà tous : rien à faire.'
  else if (a === 'creer_groupe' && !(c.groupName ?? '').trim()) blocked = 'Donne un nom au groupe.'
  else if (c.plan.then && WRITES.includes(a) && !c.then?.allowed) blocked = c.then?.deniedWhy || 'Ton rôle ne permet pas la deuxième étape.'
  if (!WRITES.includes(a) && a !== 'filtrer_createur' && a !== 'exporter' && !c.count) warnings.push('Aucun joueur ne correspond : la liste sera vide.')
  return { steps, warnings, canAccept: !blocked, ...(blocked ? { blocked } : {}), ...(exports ? { exports } : {}) }
}

// ---------- « À revoir », « vu » : faire, puis défaire seulement ce qui a été posé ----------

/** Fonctions de l'appli (src/scouting.ts), passées par l'écran : cette partie reste sans base. */
export type MarkDeps = {
  /** Joueurs déjà marqués par moi (mon « à revoir » encore ouvert, mon « vu » à l'événement). */
  already: (ids: string[]) => Promise<Set<string>>
  /** La fonction du bouton de la sélection (addRewatchMany, markSeenMany) : nombre de joueurs changés. */
  mark: (ids: string[]) => Promise<number>
  /** Après coup : la marque que l'action vient de poser pour ce joueur (sa clé), pour pouvoir la retirer. */
  created: (playerId: string) => Promise<string | undefined>
  /** Retire une marque posée par l'action (remove('rewatch', id), setSeen(…, false)). */
  unmark: (key: string) => Promise<void>
}

/**
 * Marque les joueurs (une seule fois chacun) avec la fonction du bouton ; « Défaire » retire SEULEMENT les marques que
 * l'action a posées (celles d'avant, à moi ou aux autres, restent). undo absent : rien de nouveau.
 */
export async function markWithUndo(ids: readonly string[], d: MarkDeps): Promise<{ done: number; total: number; undo?: () => Promise<number> }> {
  const list = [...new Set(ids)]
  const before = await d.already(list)
  const done = await d.mark(list)
  const keys: string[] = []
  for (const pid of list) {
    if (before.has(pid)) continue
    const k = await d.created(pid)
    if (k) keys.push(k)
  }
  return {
    done,
    total: list.length,
    undo: keys.length
      ? async () => {
          for (const k of keys) await d.unmark(k)
          return keys.length
        }
      : undefined,
  }
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
