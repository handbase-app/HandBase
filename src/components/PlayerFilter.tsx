import { useMemo, useState } from 'react'
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
 * Filtres communs (sexe, club, année de naissance, poste, recherche) pour parcourir des milliers
 * de joueurs. Le choix Garçons / Filles est mémorisé sur l'appareil.
 */
export function usePlayerFilter(players: Player[] | undefined) {
  const [q, setQ] = useState('')
  const [sex, setSexState] = useState<SexFilter>(readSex)
  const [club, setClub] = useState('')
  const [year, setYear] = useState('')
  const [position, setPosition] = useState<Position | 'all' | 'none'>('all')

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
        <select className="field py-1.5 text-xs" value={club} onChange={(e) => (setClub(e.target.value), setYear(''))}>
          <option value="">Tous les clubs ({bySex.length.toLocaleString('fr-FR')})</option>
          {clubs.map(([c, n]) => (
            <option key={c} value={c}>
              {c} ({n})
            </option>
          ))}
        </select>
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

  return { filtered, ui, active, reset }
}
