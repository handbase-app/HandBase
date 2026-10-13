import { useLiveQuery } from 'dexie-react-hooks'
import { useState, useSyncExternalStore } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { db, type Player } from '../db'
import { Icon, playerName } from './ui'

/*
 * Choix des joueurs à comparer (page d'un événement, d'un groupe) : un bouton « Comparer » fait
 * apparaître des cases à cocher ; on en coche deux ou trois, une quatrième remplace la plus ancienne.
 * La barre du bas ouvre alors l'écran de comparaison (/comparer?a=…&b=…&c=…).
 * Le menu d'une ligne de joueur (« Comparer ») ajoute à cette sélection quand la page en a une, sinon à la
 * sélection commune (useGlobalComparePick, barre GlobalCompareBar).
 */

/** Nombre maximal de joueurs comparés ensemble. */
export const COMPARE_MAX = 3

export interface ComparePick {
  on: boolean
  picked: string[]
  toggle: (id: string) => void
  /** Active ou quitte le mode comparaison (en le quittant, la sélection est oubliée). */
  setOn: (v: boolean) => void
}

const toggled = (s: string[], id: string) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-COMPARE_MAX))

export function useComparePick(): ComparePick {
  const [on, setOn] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  return {
    on,
    picked,
    toggle: (id: string) => setPicked((s) => toggled(s, id)),
    setOn: (v: boolean) => {
      setOn(v)
      if (!v) setPicked([])
    },
  }
}

/*
 * Sélection commune, pour les listes sans mode comparaison (joueurs, bilan, suivis, « À revoir »…) :
 * gardée pendant la session, affichée dans une barre en bas de l'écran (GlobalCompareBar).
 */
const PICK_KEY = 'handbase.compare'
let gPicked: string[] = (() => {
  try {
    return (JSON.parse(sessionStorage.getItem(PICK_KEY) ?? '[]') as string[]).slice(0, COMPARE_MAX)
  } catch {
    return []
  }
})()
const gListeners = new Set<() => void>()
function setGlobal(ids: string[]) {
  gPicked = ids
  try {
    sessionStorage.setItem(PICK_KEY, JSON.stringify(ids))
  } catch {
    /* stockage indisponible */
  }
  gListeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  gListeners.add(l)
  return () => {
    gListeners.delete(l)
  }
}

export function useGlobalComparePick(): ComparePick {
  const picked = useSyncExternalStore(subscribe, () => gPicked)
  return {
    on: picked.length > 0,
    picked,
    toggle: (id) => setGlobal(toggled(gPicked, id)),
    setOn: (v) => {
      if (!v) setGlobal([])
    },
  }
}

/** Barre de la sélection commune, au-dessus des onglets ; rien sur l'écran de comparaison. */
export function GlobalCompareBar() {
  const pick = useGlobalComparePick()
  const { pathname } = useLocation()
  const key = pick.picked.join(',')
  const players = useLiveQuery(async (): Promise<(Player | undefined)[]> => (key ? db.players.bulkGet(key.split(',')) : []), [key])
  if (!pick.on || pathname === '/comparer' || !players) return null
  return (
    <div className="fixed inset-x-0 bottom-[calc(var(--nav-b)+0.75rem)] z-30 px-4 wide:left-[var(--nav-l)]">
      <div className="mx-auto max-w-xl">
        <CompareBar
          pick={pick}
          players={players.filter((p): p is Player => !!p && !p.deleted)}
          floating
          onGo={() => pick.setOn(false)}
          hint="Choisis un autre joueur : menu ⋮ (ou appui long), puis « Comparer »."
        />
      </div>
    </div>
  )
}

/** Adresse de l'écran de comparaison : joueurs en a, b, c (les anciens liens ?a=&b= restent valables). */
export const compareUrl = (ids: string[], eventId?: string) =>
  `/comparer?${ids
    .slice(0, COMPARE_MAX)
    .map((id, i) => `${'abc'[i]}=${id}`)
    .join('&')}${eventId ? `&evenement=${eventId}` : ''}`

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
export function CompareBar({
  pick,
  players,
  eventId,
  floating = false,
  onGo,
  hint,
}: {
  pick: ComparePick
  players: Player[]
  eventId?: string
  /** Dans une barre fixe (sélection commune) plutôt que collée en bas de la page. */
  floating?: boolean
  /** En ouvrant la comparaison. */
  onGo?: () => void
  /** Consigne à la place de « Coche 2 ou 3 joueurs… » (sélection sans cases à cocher). */
  hint?: string
}) {
  if (!pick.on) return null
  const chosen = pick.picked.map((id) => players.find((p) => p.id === id)).filter((p): p is Player => !!p)
  return (
    <div
      className={`${floating ? '' : 'sticky bottom-[calc(var(--nav-b)+0.75rem)] z-10'} flex items-center gap-2 rounded-lg border border-accent bg-panel/95 p-2 text-xs shadow-lg backdrop-blur`}
    >
      <Icon name="users" className="h-4 w-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-[11px]">
        {chosen.length >= 2 ? (
          <b className="line-clamp-2">
            {chosen.slice(0, -1).map((p) => playerName(p)).join(', ')} et {playerName(chosen[chosen.length - 1])}
            {chosen.length < COMPARE_MAX && <span className="font-normal text-muted"> · un 3e est possible</span>}
          </b>
        ) : hint ? (
          <span className="text-muted">
            {chosen.length ? `${playerName(chosen[0])} choisi. ` : ''}
            {hint}
          </span>
        ) : (
          <span className="text-muted">
            Coche 2 ou {COMPARE_MAX} joueurs ({chosen.length}/{COMPARE_MAX}).{chosen.length ? ` ${playerName(chosen[0])} choisi.` : ''} Une {COMPARE_MAX + 1}e coche
            remplace la plus ancienne.
          </span>
        )}
      </span>
      {chosen.length >= 2 ? (
        <>
          {floating && (
            <button className="shrink-0 px-1 text-[11px] text-muted hover:text-fg" onClick={() => pick.setOn(false)}>
              Annuler
            </button>
          )}
          <Link to={compareUrl(chosen.map((p) => p.id), eventId)} onClick={onGo} className="btn-primary shrink-0 px-3 py-1.5 text-xs">
            Comparer {chosen.length} joueurs
          </Link>
        </>
      ) : (
        <button className="btn shrink-0 px-3 py-1.5 text-xs text-muted" onClick={() => pick.setOn(false)}>
          Annuler
        </button>
      )}
    </div>
  )
}
