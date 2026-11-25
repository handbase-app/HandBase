import type { ReactNode } from 'react'
import { Count } from './Pictos'
import { Icon, type IconName } from './ui'

/*
 * Morceaux communs des listes repliables par cartes : « Mes suivis » (src/pages/Follows.tsx, une carte par journée ou par
 * section) et « À revoir » (src/pages/Rewatch.tsx, une carte par date, événement, personne ou origine).
 *  - PictoMark : l'icône d'une sorte d'élément, son nombre en pastille au-delà d'un (comme les listes de joueurs,
 *    src/components/Pictos.tsx).
 *  - FoldCard : carte repliable ; son en-tête est une ligne de synthèse faite des mêmes pictogrammes que les lignes dessous
 *    (mêmes colonnes, même chevron) ; une seule lecture pour les lecteurs d'écran (`summaryLabel`), le détail au survol.
 */

/** Lien d'une ligne (fond au survol, anneau au clavier). */
export const LINE_LINK = 'rounded-md outline-none hover:bg-panel-2 focus-visible:ring-2 focus-visible:ring-accent'
/** Case d'un pictogramme (une colonne) et chevron : mêmes tailles sur une ligne et sur la synthèse d'une carte. */
export const PICTO_CELL = 'inline-flex h-8 w-8 shrink-0 items-center justify-center'
export const CHEVRON_CELL = 'inline-flex h-8 w-7 shrink-0 items-center justify-center text-muted'

/** Pictogramme : l'icône (couleur `cls`) et son nombre en pastille au-delà d'un. */
export function PictoMark({ icon, n, cls = 'text-muted', filled }: { icon: IconName; n: number; cls?: string; filled?: boolean }) {
  return (
    <span className={`relative ${cls}`}>
      <Icon name={icon} filled={filled} className="h-4 w-4" />
      <Count n={n > 1 ? n : 0} />
    </span>
  )
}

/** Une case de la synthèse d'une carte : clé, icône, nombre, texte (« 2 avis ») et couleur. */
export type SummaryPart = { key: string; icon: IconName; n: number; text: string; cls?: string }

/**
 * Carte repliable (repliée par défaut chez l'appelant) : titre (il passe à la ligne s'il le faut), `badge` juste après
 * (« +3 » de Mes suivis), synthèse en pictogrammes, chevron. Dépliée : le détail.
 */
export function FoldCard({
  title,
  badge,
  summary,
  summaryLabel,
  open,
  onToggle,
  children,
}: {
  title: ReactNode
  badge?: ReactNode
  summary: SummaryPart[]
  summaryLabel: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="card px-4 py-1">
      <button type="button" className="flex w-full items-center gap-0.5 py-1 text-left" aria-expanded={open} onClick={onToggle}>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 pr-1">
          <span className="section-title mb-0">{title}</span>
          {badge}
        </span>
        <span role="img" aria-label={summaryLabel} className="flex shrink-0 items-center gap-0.5">
          {summary.map((p) => (
            <span key={p.key} title={p.text} className={PICTO_CELL}>
              <PictoMark icon={p.icon} n={p.n} cls={p.cls} />
            </span>
          ))}
        </span>
        <span aria-hidden="true" className={CHEVRON_CELL}>
          <span className={`transition ${open ? 'rotate-90' : ''}`}>›</span>
        </span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}
