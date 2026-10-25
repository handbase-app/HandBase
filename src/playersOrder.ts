import type { Measurement, Player } from './db'

/*
 * Ordre et premières lignes de la liste Joueurs, sans base ni React (testé : tools/test-joueurs-cache.ts).
 *
 * La liste était lue par l'index « lastName » d'IndexedDB (`db.players.orderBy('lastName')`) dans un useLiveQuery : Dexie y
 * note chaque fiche lue (40 000 clés rangées une à une dans un arbre, pour savoir quoi relire), plusieurs secondes sur un
 * téléphone. Elle est maintenant lue par la clé primaire (sans ce suivi, src/playersCache.ts) puis rangée ici dans le MÊME
 * ordre que l'index : clés comparées comme IndexedDB (nombres avant textes, textes par unités de code UTF-16, ce que fait
 * `<` en JavaScript), à égalité par identifiant ; une fiche sans nom valable (ni texte ni nombre) n'est pas dans l'index,
 * donc pas dans la liste.
 */

const validKey = (k: unknown): k is string | number => typeof k === 'string' || (typeof k === 'number' && !Number.isNaN(k))

/** Comparaison de deux clés d'IndexedDB (texte ou nombre). */
export function cmpKey(a: string | number, b: string | number): number {
  if (typeof a !== typeof b) return typeof a === 'number' ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Fiches dans l'ordre de `db.players.orderBy('lastName')` (même contenu, même ordre). */
export function byLastName<P extends Pick<Player, 'id' | 'lastName'>>(rows: readonly P[]): P[] {
  return rows.filter((p) => validKey(p.lastName)).sort((a, b) => cmpKey(a.lastName, b.lastName) || cmpKey(a.id, b.id))
}

/**
 * Fiche gardée par la liste Joueurs sans filtre, vue « Base » (src/pages/Players.tsx, src/recipe.ts buildIndex) : ni
 * supprimée, ni fondue dans une autre, ni hors cadre ; `sex` : le seul filtre « Masculin / Féminin » (gardé d'une visite à
 * l'autre), comme la recette.
 */
export const inPlainList = (p: Pick<Player, 'deleted' | 'mergedInto' | 'review' | 'sex'>, sex?: 'M' | 'F') =>
  !p.deleted && !p.mergedInto && p.review !== 'refused' && (!sex || p.sex === sex)

/** Dernière valeur de chaque critère factuel, par joueur. */
export function latestByPlayer(ms: Measurement[]) {
  const out = new Map<string, Map<string, Measurement>>()
  for (const m of ms) {
    if (m.deleted) continue
    if (!out.has(m.playerId)) out.set(m.playerId, new Map())
    const cur = out.get(m.playerId)!.get(m.criterionId)
    if (!cur || m.date > cur.date || (m.date === cur.date && m.updatedAt > cur.updatedAt)) out.get(m.playerId)!.set(m.criterionId, m)
  }
  return out
}
