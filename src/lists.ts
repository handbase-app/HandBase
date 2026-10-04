import { useLiveQuery } from 'dexie-react-hooks'
import { alive, db, type ListItem } from './db'

/*
 * Listes modifiables par les administrateurs (Réglages), synchronisées comme le reste.
 * Aucun nom n'est écrit dans le code de l'appli : tout vient de la base (supabase/019_listes_regions.sql).
 */

const byOrder = (a: ListItem, b: ListItem) => a.order - b.order || a.name.localeCompare(b.name, 'fr')

/** Régions, dans l'ordre choisi par les administrateurs. */
export function useRegions(): ListItem[] {
  return useLiveQuery(() => db.lists.where('kind').equals('region').toArray().then((rs) => alive(rs).sort(byOrder)), [], [])
}

/** Nom d'une région à partir de son identifiant (vide si inconnue ou supprimée). */
export function useRegionName() {
  const regions = useRegions()
  const names = new Map(regions.map((r) => [r.id, r.name]))
  return (id?: string) => (id ? names.get(id) : undefined)
}
