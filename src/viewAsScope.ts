/*
 * « Voir comme… » (outil administrateur, spy.ts) : ce que l'écran garde des données de l'appareil.
 *
 * L'administrateur reçoit toute la base ; pendant la simulation, l'appli ne montre que ce que le membre simulé recevrait du
 * serveur (périmètre, supabase/046 et 047, règle de src/perimeter.ts) : ses joueurs (créés par lui compris) et ce qui leur
 * est rattaché (mesures, avis, « vu », « à revoir », vidéos d'un joueur). Le filtre est posé une seule fois, sous tous les
 * écrans (src/viewAsFilter.ts : intergiciel Dexie) ; ce fichier n'en garde que la règle, pure (testée par
 * tools/test-voir-comme.ts).
 *
 * Écart assumé avec le serveur : une ligne rattachée suit son joueur (visible si le joueur l'est), plus les siennes ; le
 * serveur la range dans le périmètre du joueur au moment où elle est écrite (même résultat, sauf mutation récente).
 */
import { childPlayer, inPerimeter, perimeterText, SCOPED_TABLES, type ChildRow, type Perimeter, type ScopedTable } from './perimeter'

export interface ViewAsScope {
  /** Périmètre du membre simulé. */
  per: Perimeter
  /** Identifiant du membre simulé (ses propres fiches et lignes restent visibles). */
  uid: string | null
  /** Joueurs visibles (identifiants) : pour les lignes rattachées. */
  players: ReadonlySet<string>
}

const SCOPED = new Set<string>(SCOPED_TABLES)

/** Table filtrée pendant la simulation ? (les autres : événements, groupes, critères… passent telles quelles) */
export const isScopedTable = (table: string): table is ScopedTable => SCOPED.has(table)

/** Cette ligne de cette table est-elle visible du membre simulé ? */
export function rowVisible(table: string, row: unknown, s: ViewAsScope): boolean {
  if (s.per.all || !row || typeof row !== 'object' || !isScopedTable(table)) return true
  if (table === 'players') return inPerimeter(s.per, row as Parameters<typeof inPerimeter>[1], s.uid)
  const r = row as ChildRow
  if (s.uid && r.createdBy === s.uid) return true
  const pid = childPlayer(table, r)
  // Vidéo d'un événement ou d'un groupe : pas rattachée à un joueur.
  return pid === undefined ? table === 'videos' : s.players.has(pid)
}

/** Garde les lignes visibles (tableau rendu tel quel si rien n'est filtré). */
export function visibleRows<T>(table: string, rows: readonly T[], s: ViewAsScope | null): T[] {
  if (!s || s.per.all || !isScopedTable(table)) return rows as T[]
  return rows.filter((r) => rowVisible(table, r, s))
}

/** Signature du périmètre (« a-t-il changé ? ») : on recharge l'appli quand c'est le cas. */
export const perimeterSignature = (per: Perimeter) => JSON.stringify({ all: per.all, depts: per.depts, clubs: per.clubs })

/** Bandeau de la simulation : « Aperçu : ce que voit Léa Martin — périmètre : Comité du Var (83) ». */
export function previewText(name: string, per: Perimeter | undefined): { who: string; scope: string } {
  if (!per) return { who: name, scope: '…' }
  return { who: name, scope: perimeterText(per) ?? 'aucune affectation, aucun joueur' }
}
