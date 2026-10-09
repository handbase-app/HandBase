import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Player } from '../db'
import { Icon, playerName } from './ui'

/*
 * Choix de deux joueurs à comparer (page d'un événement, d'un groupe) : un bouton « Comparer » fait
 * apparaître des cases à cocher ; on en coche deux, une troisième remplace la plus ancienne.
 * La barre du bas ouvre alors l'écran de comparaison (/comparer?a=…&b=…).
 */

export function useComparePick() {
  const [on, setOn] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-2)))
  return {
    on,
    picked,
    toggle,
    /** Active ou quitte le mode comparaison (en le quittant, la sélection est oubliée). */
    setOn: (v: boolean) => (setOn(v), v || setPicked([])),
  }
}
export type ComparePick = ReturnType<typeof useComparePick>

/** Adresse de l'écran de comparaison. */
export const compareUrl = (a: string, b: string, eventId?: string) => `/comparer?a=${a}&b=${b}${eventId ? `&evenement=${eventId}` : ''}`

/** Bouton « Comparer » (allumé en mode comparaison). */
export function CompareToggle({ pick, className = '' }: { pick: ComparePick; className?: string }) {
  return (
    <button
      className={`rounded-md border px-2 py-1 text-[11px] font-bold transition ${pick.on ? 'border-accent bg-accent text-white' : 'border-line text-muted hover:text-fg'} ${className}`}
      aria-pressed={pick.on}
      onClick={() => pick.setOn(!pick.on)}
    >
      {pick.on ? 'Terminé' : 'Comparer'}
    </button>
  )
}

/** Case à cocher d'un joueur, en mode comparaison. */
export function PickBox({ pick, p }: { pick: ComparePick; p: Player }) {
  if (!pick.on) return null
  const checked = pick.picked.includes(p.id)
  return (
    <label className="-m-1.5 flex shrink-0 cursor-pointer items-center p-1.5" title={checked ? 'Retirer de la comparaison' : 'Comparer ce joueur'}>
      <input type="checkbox" className="h-4.5 w-4.5 accent-[var(--color-accent)]" checked={checked} onChange={() => pick.toggle(p.id)} aria-label={`Comparer ${playerName(p)}`} />
    </label>
  )
}

/** Barre collée en bas : où en est la sélection, et le lien vers la comparaison. */
export function CompareBar({ pick, players, eventId }: { pick: ComparePick; players: Player[]; eventId?: string }) {
  if (!pick.on) return null
  const chosen = pick.picked.map((id) => players.find((p) => p.id === id)).filter((p): p is Player => !!p)
  return (
    <div className="sticky bottom-[calc(var(--nav-b)+0.75rem)] z-10 flex items-center gap-2 rounded-lg border border-accent bg-panel/95 p-2 text-xs shadow-lg backdrop-blur">
      <Icon name="users" className="h-4 w-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-[11px]">
        {chosen.length === 2 ? (
          <b className="line-clamp-2">
            {playerName(chosen[0])} et {playerName(chosen[1])}
          </b>
        ) : (
          <span className="text-muted">
            Coche 2 joueurs ({chosen.length}/2).{chosen.length ? ` ${playerName(chosen[0])} choisi.` : ''} Une 3e coche remplace la plus ancienne.
          </span>
        )}
      </span>
      {chosen.length === 2 ? (
        <Link to={compareUrl(chosen[0].id, chosen[1].id, eventId)} className="btn-primary shrink-0 px-3 py-1.5 text-xs">
          Comparer ces 2 joueurs
        </Link>
      ) : (
        <button className="btn shrink-0 px-3 py-1.5 text-xs text-muted" onClick={() => pick.setOn(false)}>
          Annuler
        </button>
      )}
    </div>
  )
}
