import type { ReactNode } from 'react'

/**
 * Onglets en capsule (page Groupes, page Événements, onglets d'un événement, Mes suivis, vue du radar) : une grande pilule
 * arrondie, comme la barre « Demander » (même bord, même fond, même ombre), l'onglet actif en pastille teintée dedans
 * (bg-accent/15, texte accent : le style commun des onglets et choix, 31/10, comme la fiche joueur et la barre du bas ;
 * plus de pastille pleine), les autres en texte discret. Les onglets se partagent la largeur ; `compact` : un peu moins
 * hauts (ordinateur). Rôles ARIA tablist / tab ; `data-tab` sur chaque onglet. `count` : nombre en petit après le nom (comme
 * sur la fiche joueur), collé à son dernier mot ; trop long pour la place (375 px), le nom passe sur deux lignes au lieu
 * d'être coupé (31/10).
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
  items: readonly { value: T; label: ReactNode; count?: number }[]
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
            aria-label={it.count !== undefined && typeof it.label === 'string' ? `${it.label} (${it.count})` : undefined}
            className={`flex min-w-0 flex-1 items-center justify-center rounded-full px-1.5 transition-colors ${compact ? 'py-1.5' : 'py-2'} ${on ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}
          >
            <span className="min-w-0 leading-tight text-balance">
              {it.label}
              {it.count !== undefined && <span className="text-[10px] tabular-nums opacity-70">{`\u00a0${it.count}`}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
