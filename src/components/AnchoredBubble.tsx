import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useBackCloses } from '../backNav'
import type { AxisAnchor } from './ZoneRadar'

/**
 * Bulle accrochée à l'endroit touché (libellé d'un axe du radar, petite ligne d'un critère : vues « Progression » et
 * « Écarts » de l'onglet Avis) : dessous s'il y a la place, sinon dessus, pointe vers le doigt ; fond légèrement flouté
 * (scrim-light). ✕, Échap, toucher à côté, Retour du téléphone, défilement de la page ou changement de taille : fermée.
 * En tête : `title` (gros) et `sub` (petite ligne grise), ✕ à droite ; le contenu dessous.
 */
export function AnchoredBubble({
  at,
  label,
  title,
  sub,
  onClose,
  testId,
  children,
}: {
  at: AxisAnchor
  /** Nom de la fenêtre pour les lecteurs d'écran. */
  label: string
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  testId?: string
  children: ReactNode
}) {
  useBackCloses(onClose)
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  const [pos, setPos] = useState<{ left: number; top: number; caret: number; below: boolean } | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(8, Math.min(at.x - w / 2, vw - w - 8))
    const below = at.bottom + 12 + h <= vh - 8 || vh - at.bottom >= at.top
    const top = below ? Math.min(at.bottom + 12, vh - h - 8) : Math.max(8, at.top - 12 - h)
    setPos({ left, top, caret: Math.max(16, Math.min(at.x - left, w - 16)), below })
  }, [at])
  useEffect(() => {
    const before = document.activeElement
    box.current?.focus({ preventScroll: true })
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && close.current()
    const scroll = (e: Event) => !box.current?.contains(e.target as Node) && close.current()
    const resize = () => close.current()
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 scrim-light" aria-hidden />
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={`win absolute w-[min(22rem,calc(100vw-1rem))] p-3.5 pb-2.5 shadow-2xl outline-none transition-opacity duration-100 ${pos ? 'opacity-100' : 'opacity-0'}`}
        style={pos ? { left: pos.left, top: pos.top } : { left: 8, top: at.bottom + 12 }}
        data-testid={testId}
      >
        {pos && (
          <span
            aria-hidden
            className={`absolute h-3 w-3 rotate-45 border-line bg-panel ${pos.below ? '-top-1.5 border-t border-l' : '-bottom-1.5 border-r border-b'}`}
            style={{ left: pos.caret - 6 }}
          />
        )}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[15px] leading-tight font-extrabold">{title}</div>
            {sub && <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">{sub}</div>}
          </div>
          <button className="-mt-1.5 -mr-2 min-h-9 min-w-9 shrink-0 text-muted" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
