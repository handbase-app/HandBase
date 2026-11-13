import { isShare, ONGLETS, percent, type Onglet, type Tally } from './coverage'
import { sexLabel } from './gender'

/*
 * Rapport du bilan de détection (/bilan/rapport, src/pages/Coverage.tsx CoverageReport) : celui de LA VUE du bilan
 * (lieu, onglet, sexe, années, période, filtres de la barre, question posée), plus les choix de la fenêtre « Rapport » :
 * chiffres (onglets), noms des joueurs, carte. Tout est dans l'adresse : les paramètres du bilan tels quels, puis
 * ch=vus,mesures (chiffres), noms=1 (noms des joueurs), carte=0 (sans carte).
 * Sans React ni base locale, pour être testé seul (tools/test-rapport-vue.ts). Jamais de libellé négatif sur un jeune.
 */

/** Choix de la fenêtre « Que veux-tu dans le rapport ? ». */
export interface ReportChoices {
  /** Chiffres (onglets du bilan), dans l'ordre des onglets ; au moins un. */
  tabs: Onglet[]
  /** Liste des joueurs par club (nom, prénom, année, poste) en fin de rapport. */
  names: boolean
  /** Image de la carte de la vue. */
  map: boolean
}

/** Paramètres propres au rapport, ajoutés à ceux du bilan. */
export const REPORT_KEYS = ['ch', 'noms', 'carte'] as const

/** Choix au départ : l'onglet affiché, sans noms, avec la carte. */
export const defaultChoices = (current: Onglet): ReportChoices => ({ tabs: [current], names: false, map: true })

type Place = { region: string; dept: string; club: string | null }

/** Étage du rapport : France → par région ; région → par département ; département → par club ; club → ce club. */
export type Stage = 'regions' | 'depts' | 'clubs' | 'club'
export function stageOf(p: Place): Stage {
  if (p.dept && p.club !== null) return 'club'
  if (p.dept) return 'clubs'
  if (p.region) return 'depts'
  return 'regions'
}
/** Titre de la première colonne du tableau de l'étage. */
export const STAGE_COLUMN: Record<Stage, string> = { regions: 'Région', depts: 'Département', clubs: 'Club', club: 'Génération' }

/**
 * Noms des joueurs : seulement à l'étage d'un département ou d'un club (une liste nationale ou régionale n'a pas de sens
 * et serait trop large). Les joueurs sont toujours ceux reçus sur l'appareil, donc du périmètre du compte.
 */
export function namesAllowed(p: Place): { ok: true } | { ok: false; reason: string } {
  return p.dept ? { ok: true } : { ok: false, reason: 'Possible seulement pour un département ou un club : choisis-en un sur la carte du bilan.' }
}

/** Chiffres dans l'ordre des onglets, sans doublon, parmi ceux permis. */
const cleanTabs = (tabs: readonly string[], allowed: readonly Onglet[]) => ONGLETS.filter((o) => allowed.includes(o) && tabs.includes(o))

/** Adresse du rapport (« ?… ») : paramètres du bilan (`bilanQuery`, sans « ? ») et choix de la fenêtre. */
export function reportSearch(bilanQuery: string, c: ReportChoices): string {
  const q = new URLSearchParams(bilanQuery)
  for (const k of REPORT_KEYS) q.delete(k)
  const tabs = cleanTabs(c.tabs, ONGLETS)
  if (tabs.length) q.set('ch', tabs.join(','))
  if (c.names) q.set('noms', '1')
  if (!c.map) q.set('carte', '0')
  return `?${q.toString()}`
}

/**
 * Choix lus dans l'adresse du rapport. Chiffres absents ou inconnus : l'onglet de la vue (sinon le premier permis) ;
 * noms seulement là où ils sont permis ; carte sauf carte=0.
 */
export function parseReportChoices(q: URLSearchParams, allowed: readonly Onglet[], current: Onglet, place: Place): ReportChoices {
  let tabs = cleanTabs((q.get('ch') ?? '').split(','), allowed)
  if (!tabs.length) tabs = [allowed.includes(current) ? current : allowed[0]]
  return { tabs, names: q.get('noms') === '1' && namesAllowed(place).ok, map: q.get('carte') !== '0' }
}

/** Paramètres du bilan seuls (sans ceux du rapport) : l'état de la vue, pour le relire avec parseBilan. */
export function bilanPart(q: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams(q)
  for (const k of REPORT_KEYS) out.delete(k)
  return out
}

// ---------- En-tête ----------

/** « Bilan de détection — Var (83) ». */
export const reportTitle = (placeText: string) => `Bilan de détection — ${placeText}`

/** Saison courte : « 2026-2027 » → « 2026-27 ». */
export const seasonShort = (label: string) => label.replace(/^(\d{4})-\d{2}(\d{2})$/, '$1-$2')

/**
 * Ligne de ce que montre le rapport : « Licenciés · Masculin · nés en 2008 · Arrière gauche ». Chiffres (ou la question),
 * sexe s'il est choisi, années, filtres de la barre (déjà en mots, jamais un nom de joueur).
 */
export function filterLine(p: { what: string[]; sex: 'all' | 'M' | 'F'; years?: string; bar?: string[] }): string {
  return [...p.what, sexLabel(p.sex), p.years ?? '', ...(p.bar ?? [])].filter(Boolean).join(' · ')
}

/** « Saison 2026-27 · édité le 18/10/2026 · périmètre : Comité du Var (83) » ; « Depuis toujours » pour des vus sans saison. */
export function metaLine(p: { season: string; allTime?: boolean; edited: string; perimeter?: string | null }): string {
  return [p.allTime ? 'Depuis toujours' : `Saison ${seasonShort(p.season)}`, `édité le ${p.edited}`, p.perimeter ? `périmètre : ${p.perimeter}` : ''].filter(Boolean).join(' · ')
}

// ---------- Cellules ----------

const fmt = (n: number) => n.toLocaleString('fr-FR')

/**
 * Cellule d'un tableau pour un chiffre : vus et mesurés « 12/30 · 40 % », licenciés « 30 », repérés « 3 / 30 » ; « – »
 * sans joueur.
 */
export function cellText(o: Onglet, t: Tally): string {
  if (!t.total) return '–'
  if (o === 'licencies') return fmt(t.total)
  if (isShare(o)) return `${fmt(t.seen)}/${fmt(t.total)} · ${percent(t.seen, t.total)} %`
  return `${fmt(t.seen)} / ${fmt(t.total)}`
}

/** Ce qui reste (vus : « à voir », mesurés : « à mesurer ») ; null pour les chiffres en nombre. */
export const leftOf = (o: Onglet, t: Tally) => (isShare(o) ? t.total - t.seen : null)

/**
 * « Où aller » : les clubs (renseignés) qui ont le plus de jeunes pas encore vus, du plus grand nombre au plus petit
 * (puis le plus de joueurs, puis le nom) ; seulement des nombres, aucun nom de joueur.
 */
export function whereToGo<C extends Tally & { key: string; name: string }>(clubs: readonly C[], n = 10): { name: string; left: number; total: number }[] {
  return clubs
    .filter((c) => c.key && c.total > c.seen)
    .sort((a, b) => b.total - b.seen - (a.total - a.seen) || b.total - a.total || a.name.localeCompare(b.name, 'fr'))
    .slice(0, n)
    .map((c) => ({ name: c.name, left: c.total - c.seen, total: c.total }))
}

/** Compte par clé (test le plus fait, poste…), du plus grand au plus petit puis par clé ; clés vides ignorées. */
export function countBy<T>(items: Iterable<T>, key: (t: T) => string | undefined | null): [string, number][] {
  const m = new Map<string, number>()
  for (const x of items) {
    const k = key(x)
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
}

/**
 * Tests les plus faits par le staff parmi les joueurs du rapport : nombre de joueurs mesurés par test (un joueur compte une
 * fois par test), hors tailles déclarées à la licence (`declared`).
 */
export function topTests(
  measurements: readonly { playerId: string; criterionId: string; author?: string; deleted?: boolean }[],
  players: ReadonlySet<string>,
  declared: string,
  n = 8,
): [string, number][] {
  const seen = new Set<string>()
  const rows: string[] = []
  for (const m of measurements) {
    if (m.deleted || m.author === declared || !players.has(m.playerId)) continue
    const k = `${m.criterionId}\u0000${m.playerId}`
    if (seen.has(k)) continue
    seen.add(k)
    rows.push(m.criterionId)
  }
  return countBy(rows, (c) => c).slice(0, n)
}
