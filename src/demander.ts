import { isNameQuery } from './playerQuery'
import { nameKey, queryWords, searchByName } from './nameMatch'

/*
 * « Demander » : une seule porte pour tout demander (src/components/Demander.tsx), comme la barre d'adresse d'un
 * navigateur. Partie PURE (ni React, ni base, ni réseau), testée par tools/test-demander.ts :
 *  - l'historique local des demandes (localStorage « handbase.demander », 30 entrées, dédoublonné, la plus récente en
 *    tête ; chaque entrée : le texte, la page d'origine, la date) : rien de ce qui est lu n'est cru (parseHistory) ;
 *  - trois suggestions par page (« Essaie »), qui changent un peu avec la saison ; toutes sont des phrases que les
 *    moteurs actuels comprennent (recette des joueurs, des événements, des groupes, question du bilan) ;
 *  - routeAsk : où envoyer une demande faite depuis l'EN-TÊTE (hors d'une liste) : une liste de propositions ordonnées,
 *    la première étant celle d'Entrée. Un simple nom → Joueurs (et « Ouvrir l'événement / le groupe » s'il y correspond) ;
 *    « ouvre la fiche de X » → la fiche du joueur ; une phrase d'événements → Événements ; de groupes → Groupes ; une
 *    question de calcul → le bilan ; sinon Joueurs. Les noms (joueurs, événements, groupes) sont ceux de l'appareil :
 *    ils servent ici seulement, rien ne part. Jamais une action qui écrit : « crée un groupe avec… » devient « Filtrer
 *    Joueurs puis créer le groupe avec le résultat », la sélection multiple déjà en place ; rien n'est créé sans toucher
 *    un bouton.
 */

// ---------- Pages et historique ----------

export type AskPage = 'joueurs' | 'evenements' | 'groupes' | 'bilan'
export const ASK_PAGES: readonly AskPage[] = ['joueurs', 'evenements', 'groupes', 'bilan']
/** Chemin de chaque page (et l'inverse : la page d'un chemin, pour l'en-tête). */
export const ASK_PATH: Record<AskPage, string> = { joueurs: '/joueurs', evenements: '/evenements', groupes: '/groupes', bilan: '/bilan' }
export const PAGE_LABEL: Record<AskPage, string> = { joueurs: 'Joueurs', evenements: 'Événements', groupes: 'Groupes', bilan: 'Bilan' }

export type AskEntry = { text: string; page: AskPage; at: number }
export const HISTORY_KEY = 'handbase.demander'
export const HISTORY_MAX = 30
const TEXT_MAX = 300

/** Texte sans accents ni majuscules, espaces réduits (comparaisons). */
export const foldAsk = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const cleanText = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)
const isPage = (v: unknown): v is AskPage => typeof v === 'string' && (ASK_PAGES as readonly string[]).includes(v)

/** Historique relu (texte JSON ou valeur déjà lue) : entrées valables seulement, dédoublonnées, 30 au plus. */
export function parseHistory(raw: unknown): AskEntry[] {
  let v: unknown = raw
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(v)) return []
  const out: AskEntry[] = []
  const seen = new Set<string>()
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const { text, page, at } = x as Record<string, unknown>
    if (typeof text !== 'string' || !isPage(page)) continue
    const t = cleanText(text)
    if (!t) continue
    const k = foldAsk(t)
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ text: t, page, at: typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : 0 })
    if (out.length >= HISTORY_MAX) break
  }
  return out
}

/** Nouvelle demande en tête ; la même (accents et majuscules près) ailleurs dans la liste est retirée ; 30 au plus. */
export function pushHistory(list: readonly AskEntry[], entry: { text: string; page: AskPage; at?: number }): AskEntry[] {
  const text = cleanText(entry.text)
  if (!text) return [...list]
  const k = foldAsk(text)
  return [{ text, page: entry.page, at: entry.at ?? Date.now() }, ...list.filter((e) => foldAsk(e.text) !== k)].slice(0, HISTORY_MAX)
}

/** Sans l'entrée dont le texte est `text`. */
export function removeHistory(list: readonly AskEntry[], text: string): AskEntry[] {
  const k = foldAsk(text)
  return list.filter((e) => foldAsk(e.text) !== k)
}

export const clearHistory = (): AskEntry[] => []

// ---------- Suggestions ----------

/** Année de début de la saison (1er septembre → 31 août) du jour `today` (AAAA-MM-JJ). */
export function seasonStart(today: string): number {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  return m >= 9 ? y : y - 1
}

/**
 * Trois suggestions pour une page, courtes, en français : elles changent selon la page et un peu avec la saison (début de
 * saison : « pas encore vus cette saison » ; ensuite : « pas vus depuis 6 mois ») ; l'année d'âge mise en avant est celle
 * des 15 ans de la saison.
 */
export function suggestionsFor(page: AskPage, ctx: { today: string }): string[] {
  const start = seasonStart(ctx.today)
  const m = Number(ctx.today.slice(5, 7))
  const early = m >= 9 && m <= 12
  const y = start - 15
  switch (page) {
    case 'joueurs':
      return [early ? 'Les gardiens pas encore vus cette saison' : 'Les gardiens pas vus depuis 6 mois', `Les ${y} de plus d’1 m 80`, 'Les gauchers vus cette saison, classés par taille']
    case 'evenements':
      return ['Les tournois de cette saison', 'Combien d’événements par mois ?', early ? 'Les événements à venir' : 'Les stages de cette saison']
    case 'groupes':
      return ['Les groupes de filles', `Les groupes de ${y}`, 'Combien de groupes par comité ?']
    case 'bilan':
      return [`Combien de gauchers ${early ? 'ont déjà été vus cette saison' : 'ont été vus cette saison'} ?`, 'Quel club a le plus de joueurs vus ?', `Les joueuses ${y} vues une seule fois cette saison, par département`]
  }
}

// ---------- Où envoyer une demande faite depuis l'en-tête ----------

export type AskKind = 'name' | 'open-player' | 'open-event' | 'open-group' | 'players' | 'events' | 'groups' | 'bilan' | 'select'

/** Ce que la page de destination doit faire en arrivant (rien n'est créé : `select` prépare seulement la sélection). */
export type AskApply = { page: AskPage; phrase: string; select?: 'groupe' | 'evenement' }

export type AskRoute = {
  kind: AskKind
  /** Libellé de la proposition (« Filtrer Joueurs », « Ouvrir la fiche de … »). */
  label: string
  /** Précision sous le libellé (la phrase, la page). */
  hint?: string
  /** Chemin de destination. */
  to: string
  /** Demande à relancer sur la page de destination (listes et bilan). */
  apply?: AskApply
}

export type Named = { id: string; name: string }
export type AskContext = {
  /** Noms des joueurs de l'appareil (jamais envoyés nulle part) ; absents : pas de proposition « Ouvrir la fiche ». */
  players?: readonly Named[]
  events?: readonly Named[]
  groups?: readonly Named[]
}

const MAX_NAMED = 3

// Mots qui disent de quoi parle la phrase. Les mots de joueurs l'emportent (« les joueurs du tournoi de Cannes » : Joueurs).
const PLAYER_WORDS =
  /\b(joueurs?|joueuses?|gardiens?|gardiennes?|pivots?|ailiers?|ailieres?|arrieres?|demi|demis|centres?|gauchers?|gaucheres?|droitiers?|droitieres?|ambidextres?|n(?:e|es|ee|ees) en|licencies?|licenciees?|garcons?|filles?|taille|mesurent|suivis|cm|metre|metres|fiche|fiches)\b/
const EVENT_WORDS = /\b(evenements?|tournois?|matchs?|matches|stages?|rassemblements?|entrainements?|observations?|a venir|passes)\b/
const GROUP_WORDS = /\b(groupes?|equipes?|selections?|collectifs?)\b/
/** Début de phrase sans sujet (« les », « combien de », « quels sont les »…), retiré pour lire le sujet. */
const LEAD_RE = /^(?:(?:montre|affiche|donne|liste|cherche|trouve)(?: moi)?\s+)?(?:tous |toutes |quels sont |quelles sont |quels |quelles |combien de |combien d'|le nombre de |le nombre d'|la liste des |la liste de )?(?:les |mes |des |ses |nos |ces |le |la |l')?/
const CALC_WORDS = /\b(combien|quels?|quelles?|moyennes?|moyens?|nombre|par (club|departement|region|comite|ligue|poste|annee|generation|mois|sexe|coach|personne)|le plus|le moins|repartition|pourcentage|part des|carte)\b|\?/

/** « ouvre / va à / montre / affiche (la fiche de | l'événement | le groupe) X » : X et le genre dit, s'il est dit. */
const OPEN_RE =
  /^(?:ouvre|ouvrir|va a|va au|va sur|aller a|aller au|aller sur|montre|montrer|montre moi|affiche|afficher|affiche moi|voir|vois|open)\s+(?:moi\s+)?(?:(la fiche (?:de |d'|du |des )?|le joueur |la joueuse |de |d')|(l'evenement |l'evenement de |le tournoi |le tournoi de |le stage |le stage de |le match |le match de |le rassemblement )|(le groupe |le groupe de |l'equipe |l'equipe de ))?(.+)$/

/** « crée / fais / ajoute un (nouveau) groupe (ou événement) avec X » : la cible et la phrase X. */
const CREATE_RE =
  /^(?:cree|creer|creez|fais|faire|faites|fait|ajoute|ajouter|ajoutez|mets|mettre|genere|generer|constitue|constituer|forme|former|prepare|preparer|monte|monter)\s+(?:moi\s+)?(?:un |une |le |la |nouveau |nouvelle |un nouveau |une nouvelle )?(groupe|equipe|selection|collectif|evenement|tournoi|stage|rassemblement)\s+(?:avec|de|des|pour|contenant|regroupant|a partir de|a partir des)\s+(.+)$/

/** Nom d'une liste (événement, groupe) qui contient tous les mots tapés, ou l'inverse (« Intercomités » trouve « Intercomités 83 »). */
function namedMatches(list: readonly Named[] | undefined, text: string): Named[] {
  const words = foldAsk(text).split(' ').filter(Boolean)
  if (!list || !words.length) return []
  const hits = list.filter((n) => {
    const h = foldAsk(n.name)
    return words.every((w) => h.includes(w))
  })
  // Le nom exact d'abord, puis les plus courts (les plus proches du texte).
  const exact = foldAsk(text)
  return hits.sort((a, b) => Number(foldAsk(b.name) === exact) - Number(foldAsk(a.name) === exact) || a.name.length - b.name.length).slice(0, MAX_NAMED)
}

/** Joueurs dont le nom correspond (même recherche que la liste : exacte, sinon approchante). */
function playerMatches(list: readonly Named[] | undefined, text: string): Named[] {
  if (!list || !queryWords(text).length) return []
  const r = searchByName(list as Named[], text, (p) => nameKey(p.name), (p) => nameKey(p.name).split(' ').filter(Boolean))
  return r.list.slice(0, MAX_NAMED)
}

/** Fin de `text` qui correspond à `part` (fin du texte replié `n`), dans la casse d'origine. */
const tail = (text: string, n: string, part: string) => (n.length === text.length ? text.slice(text.length - part.length) : part)

const open = (kind: 'open-player' | 'open-event' | 'open-group', n: Named): AskRoute =>
  kind === 'open-player'
    ? { kind, label: `Ouvrir la fiche de ${n.name}`, to: `/joueurs/${n.id}` }
    : kind === 'open-event'
      ? { kind, label: `Ouvrir l’événement « ${n.name} »`, to: `/evenements/${n.id}` }
      : { kind, label: `Ouvrir le groupe « ${n.name} »`, to: `/groupes/${n.id}` }

const list = (page: AskPage, phrase: string, first = false): AskRoute => ({
  kind: page === 'joueurs' ? 'players' : page === 'evenements' ? 'events' : 'groups',
  label: `${first ? 'Filtrer' : 'Ou plutôt : filtrer'} ${PAGE_LABEL[page]}`,
  hint: `« ${phrase} »`,
  to: ASK_PATH[page],
  apply: { page, phrase },
})

const bilan = (phrase: string, first = false): AskRoute => ({
  kind: 'bilan',
  label: first ? 'Poser la question au bilan' : 'Ou plutôt : poser la question au bilan',
  hint: `Réponse chiffrée, carte ou tableau · « ${phrase} »`,
  to: '/bilan',
  apply: { page: 'bilan', phrase },
})

const select = (phrase: string, what: 'groupe' | 'evenement'): AskRoute => ({
  kind: 'select',
  label: `Filtrer Joueurs, puis ${what === 'groupe' ? 'créer le groupe' : 'créer l’événement'} avec le résultat`,
  hint: `« ${phrase} » · la sélection est prête, rien n’est créé sans le bouton`,
  to: '/joueurs',
  apply: { page: 'joueurs', phrase, select: what },
})

/**
 * Propositions, dans l'ordre, pour une demande faite depuis l'en-tête. Toujours au moins une (phrase vide : aucune) ;
 * la première est celle d'Entrée.
 */
export function routeAsk(phrase: string, ctx: AskContext = {}): AskRoute[] {
  const text = cleanText(phrase)
  if (!text) return []
  // Même longueur que `text` (accents retirés, « montre-moi » → « montre moi ») : les morceaux se retrouvent dans l'original.
  const n = foldAsk(text).replace(/[’`´]/g, "'").replace(/-(moi|nous)\b/g, ' $1')

  // « Crée un groupe avec les gauchers de 2011 » : la liste filtrée avec la sélection prête ; jamais créé d'office.
  const c = n.match(CREATE_RE)
  if (c) {
    const what = /^(groupe|equipe|selection|collectif)$/.test(c[1]) ? 'groupe' : 'evenement'
    const rest = tail(text, n, c[2])
    return [select(rest, what), list('joueurs', rest)]
  }

  // « Ouvre la fiche de Martin », « va au tournoi de Cannes », « montre le groupe U15 ».
  const o = n.match(OPEN_RE)
  if (o) {
    const target = tail(text, n, o[4])
    const players = o[2] || o[3] ? [] : playerMatches(ctx.players, target)
    const events = o[1] || o[3] ? [] : namedMatches(ctx.events, target)
    const groups = o[1] || o[2] ? [] : namedMatches(ctx.groups, target)
    const out: AskRoute[] = []
    if (o[2]) out.push(...events.map((e) => open('open-event', e)), ...groups.map((g) => open('open-group', g)), ...players.map((p) => open('open-player', p)))
    else if (o[3]) out.push(...groups.map((g) => open('open-group', g)), ...events.map((e) => open('open-event', e)), ...players.map((p) => open('open-player', p)))
    else out.push(...players.map((p) => open('open-player', p)), ...events.map((e) => open('open-event', e)), ...groups.map((g) => open('open-group', g)))
    if (out.length) {
      out.push({ kind: 'name', label: `Chercher « ${target} » dans Joueurs`, to: '/joueurs', apply: { page: 'joueurs', phrase: target } })
      return out
    }
    // Rien de ce nom : on cherche le nom dans Joueurs, ou l'on traite le reste comme une phrase.
    if (isNameQuery(target)) return routeAsk(target, ctx)
  }

  // Un simple nom (ou une licence) : recherche dans Joueurs ; un événement ou un groupe de ce nom, à ouvrir.
  if (isNameQuery(text)) {
    const out: AskRoute[] = [{ kind: 'name', label: `Chercher « ${text} » dans Joueurs`, to: '/joueurs', apply: { page: 'joueurs', phrase: text } }]
    for (const e of namedMatches(ctx.events, text)) out.push(open('open-event', e))
    for (const g of namedMatches(ctx.groups, text)) out.push(open('open-group', g))
    for (const p of playerMatches(ctx.players, text)) out.push(open('open-player', p))
    return out
  }

  const calc = CALC_WORDS.test(n)
  // Le sujet de la phrase : dit en tête (« les groupes de filles » : Groupes), sinon les mots de joueurs l'emportent.
  const head = n.replace(LEAD_RE, '')
  const events = EVENT_WORDS.test(head.split(' ')[0]) || (!PLAYER_WORDS.test(n) && EVENT_WORDS.test(n))
  const groups = !events && (GROUP_WORDS.test(head.split(' ')[0]) || (!PLAYER_WORDS.test(n) && GROUP_WORDS.test(n)))
  const out = events
    ? [list('evenements', text, true), list('joueurs', text), ...(calc ? [bilan(text)] : [])]
    : groups
      ? [list('groupes', text, true), list('joueurs', text)]
      : calc
        ? [bilan(text, true), list('joueurs', text)]
        : [list('joueurs', text, true), bilan(text), select(text, 'groupe')]
  // Un texte court qui est le nom d'un événement ou d'un groupe (« Sélection U15 », « Intercomités 83 ») : à ouvrir aussi.
  const named = n.split(' ').length <= 6 ? [...namedMatches(ctx.events, text).map((e) => open('open-event', e)), ...namedMatches(ctx.groups, text).map((g) => open('open-group', g))] : []
  return [out[0], ...named, ...out.slice(1)]
}

/** Page d'une adresse de l'appli (l'en-tête montre les suggestions de la page affichée ; sinon celles de Joueurs). */
export function pageOfPath(pathname: string): AskPage {
  if (pathname.startsWith('/evenements')) return 'evenements'
  if (pathname.startsWith('/groupes')) return 'groupes'
  if (pathname.startsWith('/bilan')) return 'bilan'
  return 'joueurs'
}
