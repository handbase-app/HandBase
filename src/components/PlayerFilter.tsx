import { useEffect, useMemo, useRef, useState } from 'react'
import { POSITIONS, type Player, type Position } from '../db'

/** Texte sans accents ni majuscules, pour la recherche. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function countBy<T>(items: T[], key: (t: T) => string | undefined): [string, number][] {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))
}

export type SexFilter = 'all' | 'M' | 'F'

const SEX_KEY = 'handbase.sexFilter'
const readSex = (): SexFilter => {
  try {
    const v = localStorage.getItem(SEX_KEY)
    return v === 'M' || v === 'F' ? v : 'all'
  } catch {
    return 'all'
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
 * Filtres communs (sexe, club, année de naissance, poste, recherche) pour parcourir des milliers
 * de joueurs. Le choix Garçons / Filles est mémorisé sur l'appareil ; les autres filtres le sont
 * pendant la session, séparément pour chaque écran (`scope`).
 */
export function usePlayerFilter(players: Player[] | undefined, scope = 'joueurs') {
  const k = (name: string) => `handbase.filter.${scope}.${name}`
  const [q, setQ] = useSessionState(k('q'), '')
  const [sex, setSexState] = useState<SexFilter>(readSex)
  const [club, setClub] = useSessionState(k('club'), '')
  const [year, setYear] = useSessionState(k('year'), '')
  const [position, setPosition] = useSessionState<Position | 'all' | 'none'>(k('position'), 'all')

  const setSex = (v: SexFilter) => {
    setSexState(v)
    try {
      localStorage.setItem(SEX_KEY, v)
    } catch {
      /* stockage indisponible */
    }
  }

  const all = players ?? []
  const bySex = useMemo(() => (sex === 'all' ? all : all.filter((p) => p.sex === sex)), [all, sex])
  const clubs = useMemo(() => countBy(bySex, (p) => p.club), [bySex])
  const bySexClub = useMemo(() => (club ? bySex.filter((p) => p.club === club) : bySex), [bySex, club])
  const years = useMemo(() => countBy(bySexClub, (p) => p.birthDate?.slice(0, 4)).sort((a, b) => b[0].localeCompare(a[0])), [bySexClub])
  const scoped = useMemo(() => (year ? bySexClub.filter((p) => p.birthDate?.startsWith(year)) : bySexClub), [bySexClub, year])
  const positionCounts = useMemo(() => {
    const c: Record<string, number> = { none: 0 }
    for (const p of scoped) c[p.position ?? 'none'] = (c[p.position ?? 'none'] ?? 0) + 1
    return c
  }, [scoped])

  const filtered = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean)
    return scoped.filter((p) => {
      if (position === 'none' ? p.position : position !== 'all' && p.position !== position) return false
      if (!words.length) return true
      const hay = fold(`${p.firstName} ${p.lastName} ${p.club ?? ''} ${p.team ?? ''} ${p.license ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
  }, [scoped, q, position])

  const active = !!q || sex !== 'all' || !!club || !!year || position !== 'all'
  const reset = () => {
    setQ('')
    setSex('all')
    setClub('')
    setYear('')
    setPosition('all')
  }

  const ui = (
    <div className="flex flex-col gap-2">
      <input className="field" placeholder="Rechercher (nom, club, licence)…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
        {(
          [
            ['all', 'Tous'],
            ['M', 'Garçons'],
            ['F', 'Filles'],
          ] as const
        ).map(([v, label]) => (
          <button key={v} onClick={() => setSex(v)} className={`flex-1 py-1.5 ${sex === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <ClubPicker clubs={clubs} total={bySex.length} value={club} onChange={(c) => (setClub(c), setYear(''))} />
        <select className="field w-32 py-1.5 text-xs" value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Toutes années</option>
          {years.map(([y, n]) => (
            <option key={y} value={y}>
              {y} ({n})
            </option>
          ))}
        </select>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ id: 'all' as const, short: 'Tous postes' }, ...POSITIONS, { id: 'none' as const, short: 'Sans poste' }].map((p) => {
          const n = p.id === 'all' ? scoped.length : (positionCounts[p.id] ?? 0)
          if (p.id !== 'all' && !n && position !== p.id) return null
          return (
            <button
              key={p.id}
              onClick={() => setPosition(p.id)}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-bold ${
                position === p.id ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-muted'
              }`}
            >
              {p.short} {n}
            </button>
          )
        })}
      </div>
      {active && (
        <button className="self-start text-[11px] font-bold text-muted underline" onClick={reset}>
          Effacer les filtres
        </button>
      )}
    </div>
  )

  /** Change dès qu'un filtre change (pas quand les données se mettent à jour). */
  const signature = JSON.stringify([q, sex, club, year, position])
  return { filtered, ui, active, reset, signature }
}

/** Choix du club en tapant une partie de son nom (la ligue compte une centaine de clubs). */
function ClubPicker({
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
        <button className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted hover:text-white" title="Tous les clubs" onClick={() => pick('')}>
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
  if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.defaultPrevented) return
  const root = e.currentTarget
  const items = [...root.querySelectorAll<HTMLElement>(itemSelector)].filter((el) => !(el as HTMLButtonElement).disabled)
  if (!items.length) return
  const target = e.target as HTMLElement
  const i = items.indexOf(target)
  if (i < 0) {
    // Depuis le champ de recherche (ou ailleurs dans la zone) : ↓ va au premier joueur.
    if (e.key === 'ArrowDown' && target.matches('input[placeholder^="Rechercher"]')) {
      e.preventDefault()
      items[0].focus()
    }
    return
  }
  e.preventDefault()
  if (e.key === 'ArrowDown') items[Math.min(i + 1, items.length - 1)].focus()
  else if (i > 0) items[i - 1].focus()
  else root.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')?.focus()
}
