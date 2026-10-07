import { useMemo, useState } from 'react'
import { allDepts, departmentLabel, regionOfDept, useDepartments, useRegionLabel, useRegions, zoneSummary } from '../lists'
import { fold } from './PlayerFilter'

/*
 * Choix d'une zone géographique, replié en une ligne (« Zone : Toute la France ») : un panneau s'ouvre
 * dessous avec une recherche, les régions (case = tous ses départements) et, dépliés, leurs départements.
 * La valeur reste une liste de numéros de départements : cocher une région ajoute tous les siens.
 */

const NONE = '' // départements sans région connue

export function ZonePicker({
  value,
  onChange,
  extra = [],
  label = 'Zone',
  emptyLabel,
}: {
  /** Numéros des départements choisis (vide = toute la France). */
  value: string[] | undefined
  onChange: (v: string[] | undefined) => void
  /** Numéros à proposer en plus des départements connus (ex. ceux des joueurs). */
  extra?: string[]
  label?: string
  /** Texte quand rien n'est choisi (sinon « Toute la France »). */
  emptyLabel?: string
}) {
  const listed = useDepartments()
  const regions = useRegions()
  const regionLabel = useRegionLabel()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const sel = useMemo(() => new Set(value ?? []), [value])

  // Départements regroupés par région, dans l'ordre des Réglages (puis par nom).
  const groups = useMemo(() => {
    const codes = [...new Set([...allDepts(), ...extra, ...(value ?? [])])]
    const by = new Map<string, string[]>()
    for (const c of codes) {
      const r = regionOfDept(c) ?? NONE
      by.set(r, [...(by.get(r) ?? []), c])
    }
    const order = new Map(regions.map((r, i) => [r.id, i]))
    return [...by.entries()]
      .map(([id, depts]) => ({ id, depts }))
      .sort((a, b) => (a.id === NONE ? 1 : 0) - (b.id === NONE ? 1 : 0) || (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99) || regionLabel(a.id).localeCompare(regionLabel(b.id), 'fr'))
  }, [listed, regions, extra, value]) // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id: string) => (id === NONE ? 'Autres' : regionLabel(id))

  // Recherche : une région trouvée par son nom montre tous ses départements, sinon seulement ceux trouvés.
  const words = fold(q).split(/\s+/).filter(Boolean)
  const hit = (s: string) => words.every((w) => fold(s).includes(w))
  const shown = words.length
    ? groups
        .map((g) => (hit(nameOf(g.id)) ? g : { ...g, depts: g.depts.filter((d) => hit(departmentLabel(d)) || d.startsWith(q.trim())) }))
        .filter((g) => g.depts.length)
    : groups

  const emit = (next: Set<string>) => onChange(next.size ? [...next] : undefined)
  const toggleDept = (d: string) => {
    const next = new Set(sel)
    if (next.has(d)) next.delete(d)
    else next.add(d)
    emit(next)
  }
  const toggleRegion = (depts: string[], on: boolean) => {
    const next = new Set(sel)
    for (const d of depts) {
      if (on) next.add(d)
      else next.delete(d)
    }
    emit(next)
  }
  const flip = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const summary = !value?.length && emptyLabel ? emptyLabel : zoneSummary(value)

  return (
    <div>
      <button
        type="button"
        className={`field flex items-center gap-2 text-left ${open ? 'border-accent' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-muted">{label}</span>
        <span className={`min-w-0 flex-1 truncate ${value?.length ? 'font-bold' : 'text-muted'}`}>{summary}</span>
        <span className={`shrink-0 text-muted transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <div className="mt-1.5 overflow-hidden rounded-md border border-line bg-panel-2">
          <div className="border-b border-line p-2">
            <input className="field py-1.5 text-xs" placeholder="Rechercher une région, un département, un numéro…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-[50vh] overflow-y-auto overscroll-contain">
            {shown.map((g) => {
              const all = groups.find((x) => x.id === g.id)!.depts
              const n = all.filter((d) => sel.has(d)).length
              const isOpen = words.length > 0 || expanded.has(g.id)
              return (
                <div key={g.id || 'none'} className="border-b border-line/60 last:border-b-0">
                  <div className="flex items-center">
                    <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                        checked={n === all.length}
                        ref={(el) => {
                          if (el) el.indeterminate = n > 0 && n < all.length
                        }}
                        onChange={(e) => toggleRegion(all, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1 truncate font-bold">{nameOf(g.id)}</span>
                      {n > 0 && n < all.length && <span className="shrink-0 text-[10px] font-bold text-accent">{n}/{all.length}</span>}
                    </label>
                    {!words.length && (
                      <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center text-muted" onClick={() => flip(g.id)} aria-label={isOpen ? 'Replier' : 'Voir les départements'}>
                        <span className={`transition ${isOpen ? 'rotate-90' : ''}`}>›</span>
                      </button>
                    )}
                  </div>
                  {isOpen &&
                    g.depts.map((d) => (
                      <label key={d} className="flex min-h-10 cursor-pointer items-center gap-2.5 pr-3 pl-9 text-xs">
                        <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--color-accent)]" checked={sel.has(d)} onChange={() => toggleDept(d)} />
                        <span className="min-w-0 flex-1 truncate">{departmentLabel(d)}</span>
                      </label>
                    ))}
                </div>
              )
            })}
            {!shown.length && <p className="p-3 text-xs text-muted">Aucune région ni aucun département ne correspond.</p>}
          </div>
          <div className="flex items-center gap-2 border-t border-line p-2">
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={!value?.length} onClick={() => onChange(undefined)}>
              Tout effacer
            </button>
            <span className="flex-1" />
            <button
              type="button"
              className="btn-primary px-5 py-1.5 text-xs"
              onClick={() => {
                setOpen(false)
                setQ('')
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
