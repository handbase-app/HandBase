import type { ReactNode } from 'react'

/**
 * Onglets en capsule (page Groupes, onglets d'un événement) : une grande pilule arrondie, comme la barre « Demander »
 * (même bord, même fond, même ombre), l'onglet actif en pastille pleine dedans. Les onglets se partagent la largeur ;
 * `compact` : un peu moins hauts (ordinateur). Rôles ARIA tablist / tab ; `data-tab` sur chaque onglet.
 */
export function CapsuleTabs<T extends string>({
  label,
  value,
  items,
  onChange,
  compact = false,
  className = '',
}: {
  /** Nom de la liste d'onglets (lecteurs d'écran). */
  label: string
  value: T
  items: readonly { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  compact?: boolean
  className?: string
}) {
  return (
    <div role="tablist" aria-label={label} className={`flex rounded-full border border-line bg-panel p-0.5 text-xs font-bold shadow-sm ${className}`}>
      {items.map((it) => {
        const on = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={on}
            data-tab={it.value}
            onClick={() => onChange(it.value)}
            className={`min-w-0 flex-1 truncate rounded-full px-1 transition-colors ${compact ? 'py-1.5' : 'py-2'} ${on ? 'bg-accent text-white shadow-sm' : 'text-muted hover:bg-panel-2 hover:text-fg'}`}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
