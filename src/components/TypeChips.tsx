import { useState } from 'react'
import { parseFilter, showAll, showNone, toggleCat, toggleSide, type Cat, type TypeFilter } from '../actionFilter'
import type { Side } from '../matchSheet'
import { Glyph } from './SeqPill'

/*
 * Pastilles de visibilité par type d'action (actionFilter.ts), à cocher / décocher : « BUT 12 », « 7 M 3 »… et, au
 * séquençage, les deux équipes (dans leur couleur, elles servent aussi de légende). « Tout » / « Aucun ». Deux tons : sur
 * la vidéo (blanc sur voile noir, fixe) ou dans l'appli (couleurs du style d'installation).
 */

/** Choix gardé sur l'appareil (lectures et écritures sous try/catch : stockage parfois indisponible). */
export function useTypeFilter(key: string): [TypeFilter, (f: TypeFilter) => void] {
  const [f, setF] = useState<TypeFilter>(() => {
    try {
      return parseFilter(localStorage.getItem(key))
    } catch {
      return parseFilter(null)
    }
  })
  const set = (v: TypeFilter) => {
    setF(v)
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* stockage indisponible : choix pour cette fois */
    }
  }
  return [f, set]
}

export interface TeamChip {
  side: Side
  abbr: string
  name: string
  color: string
}

export default function TypeChips({
  present,
  filter,
  onChange,
  teams,
  tone,
  names = true,
  className = '',
}: {
  present: { cat: Cat; n: number }[]
  filter: TypeFilter
  onChange: (f: TypeFilter) => void
  /** Équipes à cocher (séquençage) ; absent : pas de filtre par équipe. */
  teams?: TeamChip[]
  tone: 'video' | 'app'
  /** Noms complets des équipes à côté de leur abréviation (place suffisante). */
  names?: boolean
  className?: string
}) {
  const video = tone === 'video'
  const base = 'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-extrabold leading-none transition-colors motion-reduce:transition-none'
  const on = video ? 'bg-white/15 text-white ring-1 ring-white/60 hover:bg-white/25' : 'bg-panel-2 text-fg ring-1 ring-line hover:ring-accent'
  const off = video ? 'text-white/45 ring-1 ring-white/20 line-through decoration-white/50 hover:text-white/70' : 'text-muted ring-1 ring-line/60 line-through hover:text-fg'
  const link = `h-7 shrink-0 rounded px-1.5 text-[11px] font-bold ${video ? 'text-white/75 hover:bg-white/10 hover:text-white' : 'text-muted hover:text-fg'} disabled:opacity-35`
  const ids = present.map((p) => p.cat.id)
  const allOn = !filter.hide.some((id) => ids.includes(id)) && !filter.sides.length
  const noneOn = ids.every((id) => filter.hide.includes(id))
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`} role="group" aria-label="Types d’actions affichés">
      {present.map(({ cat, n }) => {
        const vis = !filter.hide.includes(cat.id)
        return (
          <button
            key={cat.id}
            type="button"
            className={`${base} ${vis ? on : off}`}
            aria-pressed={vis}
            title={`${cat.label.long} : ${vis ? 'affichés, toucher pour masquer' : 'masqués, toucher pour afficher'}`}
            onClick={() => onChange(toggleCat(filter, cat.id))}
          >
            <Glyph g={cat.label.glyph} card={cat.label.card} size={11} />
            {cat.label.short}
            <span className={`font-semibold tabular-nums ${vis ? 'opacity-75' : ''}`}>{n}</span>
          </button>
        )
      })}
      {teams?.map((t) => {
        const vis = !filter.sides.includes(t.side)
        return (
          <button
            key={t.side}
            type="button"
            className={`${base} ${vis ? 'text-white ring-1 ring-white/70' : `${off} bg-transparent`} ${teams.indexOf(t) === 0 ? 'ml-1.5' : ''}`}
            style={vis ? { background: t.color } : { boxShadow: `inset 0 0 0 2px ${t.color}` }}
            aria-pressed={vis}
            title={`${t.name} : ${vis ? 'affichée, toucher pour masquer' : 'masquée, toucher pour afficher'}`}
            onClick={() => onChange(toggleSide(filter, t.side))}
          >
            {t.abbr}
            {names && <span className="max-w-[9rem] truncate font-semibold">{t.name}</span>}
          </button>
        )
      })}
      {present.length > 1 && (
        <span className="ml-1 flex shrink-0 items-center">
          <button type="button" className={link} disabled={allOn} onClick={() => onChange(showAll())}>
            Tout
          </button>
          <button type="button" className={link} disabled={noneOn} onClick={() => onChange(showNone(filter, ids))}>
            Aucun
          </button>
        </span>
      )}
    </div>
  )
}
