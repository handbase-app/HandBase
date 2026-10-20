import { useId, type ReactNode } from 'react'
import { foldCount } from '../fold'
import { useSessionState } from './PlayerFilter'

/**
 * Section repliable d'une liste (Événements : À venir, Passés, Archivés ; Groupes : Pôles Espoirs, Mes groupes privés,
 * Mon staff, Groupes du staff, Groupes des autres, Archivés) : le titre de section habituel (.section-title) devient un
 * bouton, avec le nombre d'éléments (« Passés · 12 ») et un chevron qui tourne. Toucher le titre (ou Entrée / Espace au
 * clavier) replie ou déplie ; le choix est gardé pendant la session (sessionStorage, comme « Plus de filtres »).
 *
 * Le contenu reste un enfant direct de la colonne de la page (display: contents) : espacements et liste à deux
 * colonnes (.cols) inchangés. Replié, il n'est pas dessiné du tout.
 */
export function FoldSection({
  storeKey,
  defaultOpen,
  title,
  icon,
  count,
  muted = false,
  className = 'mt-0',
  children,
}: {
  /** Clé de session de l'état ouvert / fermé (src/fold.ts, foldKey). */
  storeKey: string
  /** Dépliée au départ (src/fold.ts, startsOpen). */
  defaultOpen: boolean
  title: ReactNode
  /** Petite icône devant le titre (Groupes). */
  icon?: ReactNode
  /** Nombre d'éléments de la section (ceux qui répondent si un filtre est actif) ; rien si 0 ou absent. */
  count?: number
  /** Titre en gris (Archivés) au lieu de la couleur d'accent. */
  muted?: boolean
  /** Marge du titre (remplace mt-0). */
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useSessionState(storeKey, defaultOpen)
  const bodyId = useId()
  const n = foldCount(count)
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className={`section-title mb-0 flex w-full py-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-accent ${muted ? 'text-muted' : ''} ${className}`}
      >
        {icon}
        <span className="min-w-0 truncate">{title}</span>
        {n && <span className="shrink-0 tabular-nums opacity-70">· {n}</span>}
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      {open ? (
        <div id={bodyId} className="contents">
          {children}
        </div>
      ) : (
        <div id={bodyId} hidden />
      )}
    </>
  )
}
