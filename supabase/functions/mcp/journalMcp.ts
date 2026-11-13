// Nextar, serveur MCP : JOURNAL DES APPELS D'OUTILS (supabase/072_mcp_lecture_appels.sql, table hb_mcp_appels), en fonctions
// PURES (testées par tools/test-mcp.ts). serveur.ts appelle chaque outil par executerOutil : vérification de la réponse
// (liste blanche, outils.ts), mise en forme MCP, puis, SANS ATTENDRE, une ligne de journal écrite par le compte lui-même
// (Source.journaliser, son jeton) : outil, durée, succès, nombre de lignes rendues et filtres STRUCTURÉS.
//
// RÈGLE : jamais les paramètres bruts. Ils peuvent porter des noms (lignes lues sur une feuille, textes d'avis, titre d'un
// rapport, nom d'un événement tapé par Claude). filtresStructures ne garde qu'une liste fermée de clés, chacune contrôlée
// (nombres bornés, valeurs d'une liste, identifiants de tests ou d'événements au format d'un identifiant, codes J-… / C-…) ;
// une valeur qui ne passe pas est omise. Une écriture refusée ou une table absente (072 pas appliqué) ne change rien à la
// réponse de l'outil.

import { verifierSortie } from './outils.ts'

export interface AppelMcp {
  outil: string
  duree_ms: number
  ok: boolean
  nb_lignes: number
  filtres: Record<string, unknown> | null
}

const ENT = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined)
const NOMBRE = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined)
const UN_DE = <T extends string>(v: unknown, xs: readonly T[]) => (typeof v === 'string' && (xs as readonly string[]).includes(v) ? (v as T) : undefined)
const BOOL = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
/** Identifiant de test ou de critère (« sprint_10 », « cmj ») : jamais un libellé avec des espaces. */
const ID_TEST = /^[A-Za-z0-9_.-]{1,60}$/
/** Identifiant d'événement ou de groupe : uuid, ou identifiant de démo (« demo-… », « demo:… »). Un nom tapé n'est pas gardé. */
const ID_EV = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|demo[-:][A-Za-z0-9_:.-]{1,60})$/i
const DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/
const liste = (v: unknown, ok: (x: unknown) => unknown, max: number) => {
  if (!Array.isArray(v)) return undefined
  const xs = v.map(ok).filter((x) => x !== undefined)
  return xs.length ? [...new Set(xs)].slice(0, max) : undefined
}
const motif = (re: RegExp) => (x: unknown) => (typeof x === 'string' && re.test(x) ? x : undefined)
const test = motif(ID_TEST)

/**
 * Filtres structurés d'un appel, pour le journal : clés d'une liste fermée, valeurs contrôlées ; tout le reste est omis
 * (noms, textes, titres, lignes de proposition : seulement leur nombre). Rien de gardé : null.
 */
export function filtresStructures(outil: string, input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const a = input as Record<string, unknown>
  const f: Record<string, unknown> = {}
  const met = (k: string, v: unknown) => {
    if (v !== undefined) f[k] = v
  }
  met('annees', liste(a.annees, (x) => ENT(x, 1900, 2100), 20))
  met('trimestres', liste(a.trimestres, (x) => ENT(x, 1, 4), 4))
  if (a.nes_entre && typeof a.nes_entre === 'object') {
    const n = a.nes_entre as Record<string, unknown>
    const t = motif(/^\d{4}([- ]?T?[1-4])?$/i)
    const ne = { ...(t(n.de) ? { de: n.de } : {}), ...(t(n.a) ? { a: n.a } : {}) }
    if (Object.keys(ne).length) f.nes_entre = ne
  }
  met('sexe', UN_DE(a.sexe, ['M', 'F'] as const))
  met('postes', liste(a.postes, motif(/^[A-Za-z0-9]{1,10}$/), 20))
  met('departements', liste(a.departements, motif(/^[0-9][0-9AB]?[0-9]?$/i), 30))
  for (const k of ['evenement', 'groupe']) met(k, motif(ID_EV)(a[k]))
  const tests = [
    ...(Array.isArray(a.mesures) ? a.mesures.map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>).test : undefined)) : []),
    ...(Array.isArray(a.avec_mesures) ? a.avec_mesures : []),
    ...(Array.isArray(a.tests) ? a.tests : []),
    ...(a.tri && typeof a.tri === 'object' ? [(a.tri as Record<string, unknown>).test] : []),
    ...(outil === 'nextar_admin_saisies' ? [a.test] : []),
  ]
  met('tests', liste(tests, test, 40))
  if (a.avec_mesures === 'toutes' || a.tests === 'toutes') f.tests_toutes = true
  const criteres = [
    ...(Array.isArray(a.avis_criteres) ? a.avis_criteres.map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>).critere : undefined)) : []),
    ...(outil === '' && Array.isArray(a.criteres) ? a.criteres : []),
  ]
  met('criteres', liste(criteres, test, 10))
  if (a.tri && typeof a.tri === 'object') {
    const t = a.tri as Record<string, unknown>
    const tri = { ...(UN_DE(t.par, ['annee', 'vus', 'avis', 'test'] as const) ? { par: t.par } : {}), ...(UN_DE(t.ordre, ['asc', 'desc'] as const) ? { ordre: t.ordre } : {}) }
    if (Object.keys(tri).length) f.tri = tri
  }
  met('vus_min', ENT(a.vus_min, 0, 10_000))
  met('avis_min', NOMBRE(a.avis_min, 0, 5))
  met('avec_avis_criteres', BOOL(a.avec_avis_criteres))
  met('limite', ENT(a.limite, 0, 100_000))
  met('minutes', ENT(a.minutes, 0, 100_000))
  met('jours', ENT(a.jours, 0, 100_000))
  met('inactifs_jours', ENT(a.inactifs_jours, 0, 100_000))
  met('par', UN_DE(a.par, ['total', 'jour', 'heure'] as const))
  met('types', liste(a.types, (x) => UN_DE(x, ['mesure', 'avis', 'evenement', 'vu', 'fiche', 'connexion', 'mcp'] as const), 7))
  met('regrouper', BOOL(a.regrouper))
  met('inclure_generation', BOOL(a.inclure_generation))
  met('detail', BOOL(a.detail))
  met('archives', BOOL(a.archives))
  met('filtre', UN_DE(a.filtre, ['a_traiter', 'toutes'] as const))
  met('sorte', UN_DE(a.sorte, ['role', 'perimetre', 'archiver', 'fusion'] as const))
  met('source', UN_DE(a.source, ['saisie_appli', 'import_fichier', 'proposition_validee', 'generation'] as const))
  met('contexte', UN_DE(a.contexte, ['unss', 'club', 'match', 'selection', 'video', 'autre'] as const))
  met('depuis', motif(DATE)(a.depuis))
  met('jusqu_a', motif(DATE)(a.jusqu_a))
  met('date', motif(DATE)(a.date))
  met('code', motif(/^J-[0-9A-Z]{7}$/)(a.code))
  for (const k of ['compte', 'auteur']) met(k, motif(/^C-[0-9A-Z]{7}$/)(a[k]))
  met('id', motif(/^[0-9a-f-]{36}$/i)(a.id))
  // Lignes et actions reçues : leur NOMBRE seulement (elles portent des noms lus sur une feuille).
  if (Array.isArray(a.lignes)) f.lignes_recues = a.lignes.length
  if (Array.isArray(a.actions)) f.actions_recues = a.actions.length
  if (typeof a.tableau === 'string') f.tableau_recu = true
  if (typeof a.markdown === 'string') f.markdown_signes = a.markdown.length
  return Object.keys(f).length ? f : null
}

/** Texte court des filtres d'un appel, pour nextar_admin_journal (« annees=2013 ; tri=test desc ; limite=10 »). */
export function texteFiltres(f: unknown): string | undefined {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return undefined
  const sur = filtresStructures('', f) ?? {}
  // Relu à travers filtresStructures : seules les clés et valeurs permises sortent, même d'une ligne écrite à la main.
  for (const k of ['lignes_recues', 'actions_recues', 'tableau_recu', 'markdown_signes'] as const) {
    const v = (f as Record<string, unknown>)[k]
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) sur[k] = v
    if (v === true) sur[k] = true
  }
  if ((f as Record<string, unknown>).tests_toutes === true) sur.tests_toutes = true
  const parties = Object.entries(sur).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v && typeof v === 'object' ? Object.values(v).join(' ') : String(v)}`)
  return parties.length ? parties.join(' ; ').slice(0, 300) : undefined
}

/** Clés des listes principales d'une réponse (dans cet ordre) : leur longueur est le nombre de lignes rendues. */
const LISTES = ['joueurs', 'lignes', 'connexions', 'comptes', 'sessions', 'actions', 'propositions', 'lots', 'groupes', 'tests']

/** Nombre de lignes rendues par un outil (journal) : longueur de sa liste principale ; nextar_joueur : points rendus. */
export function compterLignes(out: Record<string, unknown>): number {
  if (!out || typeof out !== 'object' || 'erreur' in out) return 0
  if ('profil' in out) {
    const m = Array.isArray(out.mesures) ? out.mesures.reduce((s: number, x) => s + (Array.isArray((x as Record<string, unknown>)?.serie) ? ((x as Record<string, unknown>).serie as unknown[]).length : 0), 0) : 0
    return m + (Array.isArray(out.vus) ? out.vus.length : 0) + (Array.isArray(out.avis) ? out.avis.length : 0)
  }
  for (const k of LISTES) if (Array.isArray(out[k])) return (out[k] as unknown[]).length
  return 1
}

const texte = (out: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(out, null, 1) }] })
export const ERREUR_SERVEUR = 'Erreur du serveur Nextar. Réessaie dans un moment.'

/**
 * Appelle un outil, vérifie sa réponse (liste blanche) et la met en forme MCP ; toute erreur : message neutre. Puis note
 * l'appel (journal), sans l'attendre et sans que son échec compte. `maintenant` : horloge (essais).
 */
export async function executerOutil(
  nom: string,
  input: unknown,
  f: () => Promise<Record<string, unknown>>,
  journal?: (a: AppelMcp) => void,
  maintenant: () => number = Date.now,
) {
  const t0 = maintenant()
  let ok = false
  let n = 0
  try {
    const out = await f()
    verifierSortie(out, nom)
    ok = !('erreur' in out)
    n = compterLignes(out)
    return { ...texte(out), ...('erreur' in out ? { isError: true } : {}) }
  } catch (e) {
    // Journal de la fonction : le message seul (jamais les données reçues).
    console.error(`${nom} :`, e instanceof Error ? e.message : String(e))
    return { ...texte({ erreur: ERREUR_SERVEUR }), isError: true }
  } finally {
    try {
      journal?.({ outil: nom, duree_ms: Math.max(0, Math.min(600_000, Math.round(maintenant() - t0))), ok, nb_lignes: n, filtres: filtresStructures(nom, input) })
    } catch {
      // le journal ne fait jamais échouer l'outil
    }
  }
}
