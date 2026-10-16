// Outils communs des listes de joueurs : recherche (textes de chaque fiche), département d'un joueur, Garçons / Filles
// mémorisé, état gardé pendant la session, choix du club, flèches du clavier, « Voir dans Joueurs » d'un groupe.
// (Les anciens filtres rapides usePlayerFilter ne servent plus : toutes les listes de joueurs ont leurs filtres en recette,
// src/components/PlayersQuery.tsx.)
import { useEffect, useRef, useState } from 'react'
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

/** Choix du club en tapant une partie de son nom (la ligue compte une centaine de clubs). */
export function ClubPicker({
  clubs,
  total,
  value,
  onChange,
}: {
  clubs: [string, number][]
  total: number
  value: string
  onChange: (club: string) => void
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const blurTimer = useRef<number | undefined>(undefined)
  const listRef = useRef<HTMLDivElement>(null)
  const words = fold(text).split(/\s+/).filter(Boolean)
  const matches = clubs.filter(([c]) => words.every((w) => fold(c).includes(w)))
  useEffect(() => setActive(0), [text])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (c: string) => {
    onChange(c)
    setText('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        className={`field py-1.5 pr-7 text-xs ${value && !open ? 'font-bold' : ''}`}
        placeholder={`Tous les clubs (${total.toLocaleString('fr-FR')}) — taper un nom…`}
        value={open ? text : value}
        onFocus={() => {
          window.clearTimeout(blurTimer.current)
          setText('')
          setOpen(true)
        }}
        // Laisse le temps au clic sur une proposition d'être pris en compte.
        onBlur={() => (blurTimer.current = window.setTimeout(() => setOpen(false), 150))}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // ↑ ↓ pour se déplacer dans les propositions, Entrée pour choisir, Échap pour fermer.
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && matches[active]) {
            pick(matches[active][0])
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
        }}
      />
      {value && !open && (
        <button className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted hover:text-fg" title="Tous les clubs" onClick={() => pick('')}>
          ✕
        </button>
      )}
      {open && (
        <div ref={listRef} className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-panel shadow-xl">
          <button className="block w-full px-3 py-2 text-left text-xs text-muted hover:bg-panel-2" onMouseDown={(e) => e.preventDefault()} onClick={() => pick('')}>
            Tous les clubs ({total.toLocaleString('fr-FR')})
          </button>
          {matches.map(([c, n], i) => (
            <button
              key={c}
              data-i={i}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full justify-between gap-2 px-3 py-2 text-left text-xs ${i === active ? 'bg-panel-2' : ''} ${c === value ? 'text-accent' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
            >
              <span className="truncate">{c}</span>
              <span className="shrink-0 text-muted">{n}</span>
            </button>
          ))}
          {!matches.length && <div className="px-3 py-2 text-xs text-muted">Aucun club ne correspond.</div>}
        </div>
      )}
    </div>
  )
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
