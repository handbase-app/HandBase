// Outils communs des listes de joueurs : recherche (textes de chaque fiche), département d'un joueur, Garçons / Filles
// mémorisé, état gardé pendant la session, choix du club, flèches du clavier, « Voir dans Joueurs » d'un groupe.
// (Les anciens filtres rapides usePlayerFilter ne servent plus : toutes les listes de joueurs ont leurs filtres en recette,
// src/components/PlayersQuery.tsx.)
import { useEffect, useState } from 'react'
import type { Player } from '../db'
import { nameTokens, playerHaystack } from '../nameMatch'
import { JOUEURS_KEYS, type JoueursQuery } from '../playerQuery'
import { playerDepartment } from '../perimeter'

// Textes de recherche de chaque joueur, calculés à la première recherche et gardés tant que la fiche ne change pas.
const hays = new WeakMap<Player, string>()
export const hayOf = (p: Player) => {
  let h = hays.get(p)
  if (h === undefined) hays.set(p, (h = playerHaystack(p)))
  return h
}
export const tokensOf = (p: Player) => nameTokens(p)

/** Texte sans accents ni majuscules, pour la recherche. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * Département du club, lu dans le numéro FFHB (6383015 → 83 ; outre-mer : 6401xxx → 971) ; à défaut, département saisi.
 * La règle est dans src/perimeter.ts (playerDepartment, testée) : la même sert au périmètre de chaque compte (046).
 */
export const department = (p: Pick<Player, 'clubCode' | 'license' | 'department'>): string | undefined => playerDepartment(p)

export type SexFilter = 'all' | 'M' | 'F'

const SEX_KEY = 'handbase.sexFilter'
/** Choix Garçons / Filles mémorisé sur l'appareil (commun aux listes de joueurs). */
export const readSex = (): SexFilter => {
  try {
    const v = localStorage.getItem(SEX_KEY)
    return v === 'M' || v === 'F' ? v : 'all'
  } catch {
    return 'all'
  }
}

export function writeSex(v: SexFilter) {
  try {
    localStorage.setItem(SEX_KEY, v)
  } catch {
    /* stockage indisponible */
  }
}

/**
 * Valeur gardée pendant la session (sessionStorage) : on retrouve ses filtres en revenant
 * sur un écran, tant que l'appli reste ouverte.
 */
export function useSessionState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* stockage indisponible */
    }
  }, [key, value])
  return [value, setValue]
}

/**
 * Navigation au clavier dans une liste : depuis un champ de saisie, ↓ va au premier élément ;
 * sur un élément, ↑ ↓ passent au précédent / suivant (↑ sur le premier revient au champ).
 * Entrée / Espace activent l'élément (comportement natif des liens et boutons).
 */
export function arrowNav(e: React.KeyboardEvent<HTMLElement>, itemSelector: string) {
  // Les listes de propositions (choix du club…) gèrent déjà leurs flèches.
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key) || e.defaultPrevented) return
  // ← → ne servent qu'entre éléments (dans un champ, ils déplacent le curseur).
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target as HTMLElement).matches(itemSelector)) return
  const root = e.currentTarget
  const items = [...root.querySelectorAll<HTMLElement>(itemSelector)].filter((el) => !(el as HTMLButtonElement).disabled)
  if (!items.length) return
  const target = e.target as HTMLElement
  const i = items.indexOf(target)
  if (i < 0) {
    // Depuis le champ de recherche (ou ailleurs dans la zone) : ↓ va au premier joueur.
    if (e.key === 'ArrowDown' && target.matches(SEARCH_FIELD)) {
      e.preventDefault()
      items[0].focus()
    }
    return
  }
  e.preventDefault()
  // Liste en colonnes (paysage, ordinateur) : ↑ ↓ changent de ligne en restant dans la colonne,
  // ← → passent à l'élément voisin. Sur une seule colonne, c'est l'élément précédent / suivant.
  const top0 = items[0].getBoundingClientRect().top
  let cols = 1
  while (cols < items.length && Math.abs(items[cols].getBoundingClientRect().top - top0) < 2) cols++
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const j = i + (e.key === 'ArrowRight' ? 1 : -1)
    if (j >= 0 && j < items.length) items[j].focus()
    return
  }
  if (e.key === 'ArrowDown') items[Math.min(i + cols, items.length - 1)].focus()
  else if (i - cols >= 0) items[i - cols].focus()
  else root.querySelector<HTMLInputElement>(SEARCH_FIELD)?.focus()
}

/** Champ de recherche d'une liste (↓ va au premier élément, ↑ sur le premier y revient). */
const SEARCH_FIELD = 'input[data-search], input[placeholder^="Rechercher"]'

/** Ouvre la liste Joueurs filtrée sur un groupe (seul filtre gardé : Garçons / Filles ; gardé pendant la session). */
export function showGroupInPlayers(groupId: string) {
  try {
    const sex = readSex()
    const qy: JoueursQuery = { recipe: { pop: { groups: [groupId], ...(sex !== 'all' ? { sex } : {}) }, avis: [], measures: [], out: { type: 'list' } }, q: '' }
    sessionStorage.setItem(JOUEURS_KEYS.query, JSON.stringify(qy))
    sessionStorage.setItem(JOUEURS_KEYS.text, JSON.stringify(''))
    sessionStorage.removeItem(JOUEURS_KEYS.result)
    sessionStorage.removeItem(JOUEURS_KEYS.sql)
  } catch {
    /* stockage indisponible */
  }
}
