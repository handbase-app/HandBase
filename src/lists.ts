import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
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

// ---------- Départements ----------

// Tri par numéro, la Corse (2A, 2B) entre 19 et 21.
const codeKey = (c = '') => (c === '2A' ? 20.1 : c === '2B' ? 20.2 : Number(c) || 999)
const byCode = (a: ListItem, b: ListItem) => codeKey(a.code) - codeKey(b.code)

/**
 * Noms des départements, tenus à jour en continu : `departmentLabel` peut ainsi s'utiliser partout,
 * même hors d'un composant. Les écrans qui affichent des départements appellent `useDepartments()`
 * (directement ou via l'App) pour se redessiner quand la liste change.
 */
let departments: ListItem[] = []
const listeners = new Set<() => void>()
liveQuery(() => db.lists.where('kind').equals('department').toArray()).subscribe((rs) => {
  departments = alive(rs).filter((d) => d.code).sort(byCode)
  listeners.forEach((l) => l())
})

export function useDepartments(): ListItem[] {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return departments
}

/** « 83 · Var » ; « Département 83 » si son nom n'est pas dans la liste. */
export function departmentLabel(code: string) {
  const d = departments.find((x) => x.code === code)
  return d ? `${code} · ${d.name}` : `Département ${code}`
}

/** Départements proposés à la saisie : [{ value: '83', label: '83 · Var' }…]. */
export const departmentChoices = () => departments.map((d) => ({ value: d.code!, label: `${d.code} · ${d.name}` }))
