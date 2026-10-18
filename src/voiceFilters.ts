// Recherche vocale « micro ✨ » : ce qui est commun à toutes les pages (Joueurs, bilan de détection,
// Événements, Groupes). Fonctions pures, sans dépendance à l'appli (testées dans tools/test-recherche-vocale.ts).
//  - une page décrit ses filtres (VoicePage) : schéma envoyé au modèle (clés, valeurs permises), filtres actifs sous ces
//    clés, et la relecture de la réponse (chaque valeur revérifiée d'après les vraies listes de l'appli) ;
//  - applyWith applique l'action rendue par le modèle (remplacer, ajouter, retirer, effacer) aux filtres actuels ;
//  - rapprochement de noms (accents, majuscules, noms partiels), commandes évidentes sans appel, textes de résultat.
// Seuls la phrase, le schéma et les filtres actifs partent chez Mistral, jamais de données de joueurs ; les noms (clubs,
// événements, groupes) sont recopiés tels que dits par le modèle et retrouvés ici.

// ---------- Rapprochement de noms (accents, majuscules, noms partiels) ----------

/** Minuscules sans accents ni ponctuation, espaces simples. */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Mots qui ne distinguent rien (« le club de Toulon », « HBC », « département du Var »).
const STOP = new Set(['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'et', 'en', 'sur', 'a', 'au', 'aux', 'club', 'hand', 'handball', 'ball', 'hb', 'hbc', 'departement', 'region', 'ligue', 'groupe', 'profil'])
/** Mots qui distinguent (sans accents ni mots vides). */
export const words = (s: string) => normalize(s).split(' ').filter((w) => w && !STOP.has(w))

export type Match<T> = { found: T } | { ambiguous: T[] } | { none: true }

/**
 * Meilleur candidat pour un nom dit ou tapé : égalité exacte, puis égalité sans les mots vides, puis tous les mots
 * présents (mots entiers, puis débuts de mots), puis morceau du nom. Plusieurs candidats aussi bons : « ambigu » (rien
 * n'est choisi : « Var » peut être plusieurs clubs).
 */
export function bestMatch<T>(input: string, items: T[], names: (t: T) => string[]): Match<T> {
  const n = normalize(input)
  const w = words(input)
  if (!n) return { none: true }
  const score = (name: string) => {
    const nn = normalize(name)
    if (nn === n) return 100
    const nw = words(name)
    if (w.length && nw.join(' ') === w.join(' ')) return 90
    if (!w.length) return 0
    if (w.every((x) => nw.includes(x))) return 70
    if (w.every((x) => x.length >= 3 && nw.some((y) => y.startsWith(x)))) return 50
    if (n.length >= 4 && nn.replace(/ /g, '').includes(n.replace(/ /g, ''))) return 30
    return 0
  }
  let best = 0
  let top: T[] = []
  for (const it of items) {
    const sc = Math.max(0, ...names(it).map(score))
    if (sc > best) {
      best = sc
      top = [it]
    } else if (sc === best && sc > 0) top.push(it)
  }
  if (!best) return { none: true }
  return top.length === 1 ? { found: top[0] } : { ambiguous: top }
}

// ---------- Lecture des valeurs ----------

export const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '')
export const isTrue = (v: unknown) => v === true || v === 1 || (typeof v === 'string' && ['true', 'oui', 'vrai', '1'].includes(normalize(v)))
export const quote = (v: unknown) => `« ${asText(v).slice(0, 40) || '?'} »`

export function parseYear(v: unknown, thisYear: number, min = 1950): number | undefined {
  const s = asText(v)
  if (!/^\d{4}$/.test(s)) return undefined
  const y = Number(s)
  return y >= min && y <= thisYear ? y : undefined
}

export function parseSex(v: unknown): 'M' | 'F' | undefined {
  const s = normalize(asText(v))
  if (['m', 'masculin', 'masculins', 'masculine', 'masculines', 'garcon', 'garcons', 'h', 'homme', 'hommes'].includes(s)) return 'M'
  if (['f', 'feminin', 'feminins', 'feminines', 'feminine', 'fille', 'filles', 'femme', 'femmes', 'joueuses'].includes(s)) return 'F'
  return undefined
}

// ---------- Lieux : régions et départements (listes de l'appli, jamais envoyées) ----------

export type Places = {
  regions: { id: string; name: string }[]
  depts: { code: string; name?: string }[]
  /** Région d'un département (pour écarter une région qui contredit le département). */
  regionOfDept?: (code: string) => string | undefined
}

// Noms courants des régions (« PACA », « IDF »…).
export const REGION_ALIASES: Record<string, string[]> = {
  'region-sud': ['PACA', 'Provence-Alpes-Côte d’Azur', 'Provence'],
  'region-idf': ['IDF', 'région parisienne'],
  'region-ara': ['AURA', 'Auvergne Rhône Alpes'],
  'region-bfc': ['BFC'],
  'region-hdf': ['HDF', 'Nord'],
  'region-naq': ['NA'],
  'region-ges': ['Alsace Lorraine Champagne'],
  'region-cvl': ['Centre'],
  'region-pdl': ['PDL'],
  'region-reu': ['Réunion'],
}

export function matchDept(v: unknown, places: Places): Match<{ code: string; name?: string }> {
  const s = asText(v)
  const codes = places.depts
  // Numéro (« 83 », 6 → « 06 », « 2A »), même au milieu d'un nom (« Var (83) »).
  const num = /^(\d{1,3}|2[ab])$/i.exec(s) ?? /\b(\d{2,3}|2[ab])\b/i.exec(s)
  if (num) {
    const c = num[1].toUpperCase()
    const code = /^\d$/.test(c) ? '0' + c : c
    const d = codes.find((x) => x.code === code)
    if (d) return { found: d }
  }
  return bestMatch(
    s,
    codes.filter((d) => d.name),
    (d) => [d.name!],
  )
}

export function matchRegion(v: unknown, places: Places): Match<{ id: string; name: string }> {
  const s = asText(v)
  const exact = places.regions.find((r) => r.id === s)
  return exact ? { found: exact } : bestMatch(s, places.regions, (r) => [r.name, ...(REGION_ALIASES[r.id] ?? [])])
}

export const deptText = (d: { code: string; name?: string }) => (d.name ? `${d.name} (${d.code})` : `département ${d.code}`)

/**
 * Lieu (région puis département, le département décidant) lu dans la réponse ; écrit dans `set` et signalé.
 * Le département suffit : une région qui le contredit est écartée.
 */
export function readPlace(
  f: Record<string, unknown>,
  places: Places,
  r: Reading,
  set: { dept: (code: string) => void; region: (id: string) => void },
  keys = { dept: 'departement', region: 'region' },
  labels = { dept: 'département', region: 'région' },
): { dept?: string; region?: string } {
  const out: { dept?: string; region?: string } = {}
  if (r.has(keys.dept)) {
    const m = matchDept(f[keys.dept], places)
    if ('found' in m) {
      out.dept = m.found.code
      set.dept(m.found.code)
      r.understood.push({ key: keys.dept, label: deptText(m.found) })
    } else if ('ambiguous' in m) r.skip(`${labels.dept} ${quote(f[keys.dept])}`, `plusieurs possibles : ${m.ambiguous.slice(0, 3).map((d) => d.name).join(', ')}`)
    else r.skip(`${labels.dept} ${quote(f[keys.dept])}`, 'pas trouvé')
  }
  if (r.has(keys.region)) {
    const m = matchRegion(f[keys.region], places)
    if ('found' in m) {
      const deptRegion = out.dept && places.regionOfDept?.(out.dept)
      if (deptRegion && deptRegion !== m.found.id) r.skip(`${labels.region} ${quote(m.found.name)}`, `le ${labels.dept} choisi est dans une autre ${labels.region}`)
      else {
        out.region = m.found.id
        set.region(m.found.id)
        r.understood.push({ key: keys.region, label: m.found.name })
      }
    } else if ('ambiguous' in m) r.skip(`${labels.region} ${quote(f[keys.region])}`, `plusieurs possibles : ${m.ambiguous.slice(0, 3).map((x) => x.name).join(', ')}`)
    else r.skip(`${labels.region} ${quote(f[keys.region])}`, 'pas trouvée')
  }
  return out
}

// ---------- Interprétation d'une réponse ----------

export type Understood = { key: string; label: string }

export type Interpretation<V> = {
  /** Nouveaux filtres : les filtres compris, tous les autres à zéro. */
  values: V
  /** Ce qui a été compris, dans l'ordre des pastilles de filtres. */
  understood: Understood[]
  /** Valeurs écartées : inconnues de l'appli, ambiguës ou incohérentes (« club « Toulon » : plusieurs clubs possibles »). */
  notFound: string[]
  /** Ce que le modèle n'a pas su traduire en filtre (renvoyé tel quel, nettoyé). */
  unsupported: string[]
}

/** Lecture d'une réponse : outils communs (clé présente, valeur écartée…). */
export type Reading = {
  f: Record<string, unknown>
  has: (k: string) => boolean
  understood: Understood[]
  notFound: string[]
  unsupported: string[]
  skip: (what: string, why: string) => void
}

/** Début de la relecture : filtres rendus, « nonGere » nettoyé, clés inconnues signalées. */
export function startReading(raw: unknown, nonGere: unknown, known: Iterable<string>): Reading {
  const f: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
  const has = (k: string) => f[k] !== undefined && f[k] !== null && f[k] !== '' && f[k] !== false
  const notFound: string[] = []
  const unsupported = (Array.isArray(nonGere) ? nonGere : [])
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 8)
  const ok = new Set(known)
  for (const k of Object.keys(f)) if (!ok.has(k) && has(k)) unsupported.push(`« ${k.slice(0, 30)} »`)
  return { f, has, understood: [], notFound, unsupported, skip: (what, why) => notFound.push(`${what} (${why})`) }
}

/** Texte cherché (nom d'événement, de groupe, lieu…) retrouvé parmi les noms de l'appli : le nom exact, ou les mots dits si plusieurs conviennent. */
export function readName(said: unknown, names: string[]): { q: string; label: string } | { none: string } {
  const s = asText(said).replace(/\s+/g, ' ').slice(0, 60)
  if (!s || /^\(.*\)$/.test(s)) return { none: '' }
  const m = bestMatch(s, [...new Set(names.filter(Boolean))], (n) => [n])
  if ('found' in m) return { q: m.found, label: m.found }
  // Plusieurs noms possibles : les mots qui distinguent (« tournoi de Toulon » → « tournoi toulon »), qui les trouvent tous.
  if ('ambiguous' in m) {
    const w = words(s).join(' ')
    return { q: w || s, label: `« ${s} » (${m.ambiguous.length} possibles)` }
  }
  return { none: s }
}

// ---------- Opérations sur les filtres actuels ----------

/** remplacer : nouvelle recherche ; ajouter : garder les filtres actuels et ajouter (ou changer) ; retirer ; effacer : tout. */
export type FilterAction = 'remplacer' | 'ajouter' | 'retirer' | 'effacer'
export const ACTIONS: FilterAction[] = ['remplacer', 'ajouter', 'retirer', 'effacer']

export type ModelAnswer = { action?: unknown; filtres?: unknown; retirer?: unknown; nonGere?: unknown }

export type Outcome<V> = {
  action: FilterAction
  /** Filtres à appliquer (tous). */
  values: V
  /** Critères posés (remplacer, ajouter). */
  added: Understood[]
  /** Noms des filtres retirés (« taille »). */
  removed: string[]
  notFound: string[]
  unsupported: string[]
  /** Les filtres changent-ils ? */
  changed: boolean
}

/** Règles d'une page pour appliquer une réponse à ses filtres. */
export type FilterRules<V extends object> = {
  /** Filtres à zéro (« effacer »). */
  empty: V
  /** Champs de V de chaque clé du schéma (remis à zéro par « retirer », recopiés par « ajouter »). */
  fields: Record<string, (keyof V)[]>
  /** Nom court d'un filtre (« Retiré : taille »). */
  keyText: Record<string, string>
  /** Mots acceptés dans « retirer » à la place des clés (petits modèles : « taille », « année »…), sans accents. */
  aliases: Record<string, string>
  /** Relecture de la réponse ; `current` : filtres actuels (pour départager, ex. un club du département déjà choisi). */
  interpret: (filtres: unknown, nonGere: unknown, current: V) => Interpretation<V>
  /** Après « ajouter » : remettre d'aplomb ce qui dépend des clés ajoutées (département d'une autre région…). */
  afterAdd?: (values: V, added: Set<string>, it: Interpretation<V>) => void
}

export const sameValues = <V extends object>(empty: V, a: V, b: V) => (Object.keys(empty) as (keyof V)[]).every((k) => String(a[k]) === String(b[k]))

/** Clé du schéma pour un nom de filtre rendu dans « retirer » : clé exacte ou mot courant (« la taille », « filtre année »). */
export function keyOfWith(rules: { fields: Record<string, unknown[]>; aliases: Record<string, string> }, v: unknown): string | undefined {
  const s = asText(v)
  if (rules.fields[s]) return s
  const w = normalize(s)
    .split(' ')
    .filter((x) => !['le', 'la', 'les', 'l', 'filtre', 'filtres', 'critere', 'condition', 'de', 'd', 'du', 'des', 'sur', 'par'].includes(x))
  return w.length ? rules.aliases[w[0]] : undefined
}

/**
 * Applique la réponse du modèle aux filtres actuels, après vérification de chaque valeur :
 *  - effacer : tout à zéro ; remplacer : seulement les nouveaux critères ;
 *  - ajouter : filtres actuels + nouveaux critères (une clé déjà posée prend la nouvelle valeur) ; « retirer » peut s'y ajouter ;
 *  - retirer : les clés citées reviennent à zéro (un critère rendu dans « filtres », « retire le Var », retire aussi sa clé).
 * Action absente ou inconnue (ancienne version de la fonction) : « retirer » s'il n'y a que des clés à retirer, sinon « remplacer ».
 */
export function applyWith<V extends object>(rules: FilterRules<V>, answer: ModelAnswer, current: V): Outcome<V> {
  const same = (a: V, b: V) => sameValues(rules.empty, a, b)
  const it = rules.interpret(answer.filtres, answer.nonGere, current)
  const rawRemove = Array.isArray(answer.retirer) ? answer.retirer.slice(0, 16) : []
  let action: FilterAction = ACTIONS.includes(answer.action as FilterAction)
    ? (answer.action as FilterAction)
    : !it.understood.length && rawRemove.length
      ? 'retirer'
      : 'remplacer'
  const hasAny = !same(current, rules.empty)
  // Rien d'actif : « ajouter » revient à « remplacer ».
  if (action === 'ajouter' && !hasAny) action = 'remplacer'
  const out = { action, added: [] as Understood[], removed: [] as string[], notFound: it.notFound, unsupported: it.unsupported }
  if (action === 'effacer') return { ...out, values: { ...rules.empty }, changed: hasAny }
  if (action === 'remplacer') {
    if (!it.understood.length) return { ...out, values: current, changed: false }
    return { ...out, values: it.values, added: it.understood, changed: !same(it.values, current) }
  }
  const values: V = { ...current }
  const keys = new Set<string>()
  for (const r of rawRemove) {
    const k = keyOfWith(rules, r)
    if (k) keys.add(k)
    else out.notFound.push(`retirer ${quote(r)} (filtre inconnu)`)
  }
  if (action === 'retirer') for (const u of it.understood) keys.add(u.key)
  for (const k of keys) {
    const fields = rules.fields[k]
    const before = JSON.stringify(fields.map((f) => values[f]))
    for (const f of fields) values[f] = rules.empty[f]
    if (JSON.stringify(fields.map((f) => values[f])) !== before) out.removed.push(rules.keyText[k] ?? k)
  }
  if (action === 'ajouter') {
    for (const u of it.understood) for (const f of rules.fields[u.key] ?? []) values[f] = it.values[f]
    out.added = it.understood
    rules.afterAdd?.(values, new Set(it.understood.map((u) => u.key)), it)
  }
  return { ...out, values, changed: !same(values, current) }
}

// ---------- Description d'une page (schéma, filtres actifs, application) ----------

/** Pages qui ont la recherche vocale (envoyé à la fonction : consignes et exemples de la page). */
export type VoicePageId = 'joueurs' | 'bilan' | 'evenements' | 'groupes'

export type VoicePage<V extends object> = {
  id: VoicePageId
  /**
   * Mode que la fonction « transcrire » déployée doit annoncer (GET, `modes`) pour que le bouton s'affiche ; absent :
   * « filtres » suffit (consignes de la liste Joueurs, valables pour cette page).
   */
  mode?: string
  /** Schéma compact envoyé avec la phrase : une ligne par clé, valeurs permises. */
  schema: () => Record<string, string>
  /** Filtres actifs, avec les clés du schéma (pour « ajoute… », « enlève… »), sans nom cherché. */
  current: (v: V) => Record<string, string | number | boolean>
  rules: FilterRules<V>
  /** Aide du bouton : exemples de phrases. */
  hint: string
}

export const pageApply = <V extends object>(page: VoicePage<V>, answer: ModelAnswer, current: V) => applyWith(page.rules, answer, current)
export const pageSame = <V extends object>(page: VoicePage<V>, a: V, b: V) => sameValues(page.rules.empty, a, b)
export const pageHas = <V extends object>(page: VoicePage<V>, v: V) => !sameValues(page.rules.empty, v, page.rules.empty)

// ---------- Textes ----------

/** Ce qui s'est passé, en une ligne : « Ajouté : Var (83) », « Retiré : taille », « Filtres effacés », « Remplacés : … ». */
export function outcomeText(o: Outcome<unknown>, hadFilters: boolean): string {
  const list = (u: Understood[]) => u.map((x) => x.label).join(' · ')
  if (o.action === 'effacer') return o.changed ? 'Filtres effacés' : 'Aucun filtre à effacer'
  if (!o.changed) return ''
  if (o.action === 'remplacer') return `${hadFilters ? 'Remplacés' : 'Compris'} : ${list(o.added)}`
  return [o.removed.length ? `Retiré : ${o.removed.join(' · ')}` : '', o.added.length ? `Ajouté : ${list(o.added)}` : ''].filter(Boolean).join(' — ')
}

/** « Compris : nés en 2010 · taille ≥ 180 cm » (vide si rien n'a été compris). */
export function summaryText(understood: Understood[]): string {
  return understood.length ? `Compris : ${understood.map((u) => u.label).join(' · ')}` : ''
}

/** « Je ne sais pas encore filtrer sur : … » (vide s'il n'y a rien à dire). */
export function unsupportedText(it: { unsupported: string[] }): string {
  return it.unsupported.length ? `Je ne sais pas encore filtrer sur : ${it.unsupported.join(' ; ')}` : ''
}

/** Valeurs écartées, en termes neutres : « Non appliqué : club « X » (pas trouvé dans la base) ». */
export function notFoundText(it: { notFound: string[] }): string {
  return it.notFound.length ? `Non appliqué : ${it.notFound.join(' ; ')}` : ''
}

// ---------- Commandes évidentes, sans appel au modèle ----------

// « efface la sélection », « réinitialise », « remets à zéro », « tout effacer », « supprime les filtres », « montre tout le monde »…
const POLITE = String.raw`(?:(?:s il (?:te|vous) plait|stp|svp|merci|ok|bon|alors|allez|euh|tu peux|vous pouvez|peux tu|pouvez vous|je veux|on peut|il faut) )*`
const END = String.raw`(?: s il (?:te|vous) plait| stp| svp| merci)?$`
const VERB = String.raw`(?:efface[rsz]?|reinitialise[rsz]?|vide[rsz]?|supprime[rsz]?|enleve[rsz]?|retire[rsz]?|nettoie[rsz]?|nettoyer|reset|remet[stz]? (?:tout )?a zero|remettre (?:tout )?a zero|remise a zero|recommence[rsz]?|on recommence|on repart de zero|repars de zero|on efface tout)`
const WHAT = String.raw`(?: tout)?(?: (?:tous |toutes )?(?:les|la|le|mes|ma|mon|ces|cette|tout|toute) (?:filtres?|selection|criteres?|conditions?|recherche))?(?: tout)?`
const CLEAR_RES = [
  new RegExp(`^${POLITE}${VERB}${WHAT}${END}`),
  new RegExp(`^${POLITE}(?:tout effacer|tout efface|plus de filtres?|sans (?:aucun )?filtres?|aucun filtre|zero filtre)${END}`),
  new RegExp(
    `^${POLITE}(?:montre|affiche|montrer|afficher|montrez|affichez|voir|donne) (?:moi )?(?:tout le monde|tous les joueurs|tous les evenements|tous les groupes|toute la liste|la liste complete|tout|tous)${END}`,
  ),
]

/** Commande reconnue sans le modèle (instantané, gratuit, hors ligne) ; null : à envoyer au modèle. */
export function localCommand(phrase: string): 'effacer' | null {
  const n = normalize(phrase)
  if (!n || n.split(' ').length > 10) return null
  return CLEAR_RES.some((re) => re.test(n)) ? 'effacer' : null
}
