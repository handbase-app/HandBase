import { useLayoutEffect, useRef, type ReactNode } from 'react'

/**
 * Barre « Demander » d'une liste (et ses pastilles) collée en haut au défilement, sous l'en-tête : on filtre et on pose une
 * question de n'importe où dans la liste. Sa hauteur est publiée dans --qbar sur le conteneur de la liste, pour que la barre
 * « Afficher / Sélectionner » des listes de joueurs (components/Pictos.tsx) se colle juste en dessous.
 * `stick` faux (panneau des filtres ouvert) : la barre défile avec la page, sinon le bas du panneau serait inaccessible.
 */
export function StickyQuery({ stick, children }: { stick: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const host = el?.parentElement
    if (!el || !host) return
    if (!stick) {
      host.style.setProperty('--qbar', '0px')
      return
    }
    const set = () => host.style.setProperty('--qbar', `${el.offsetHeight}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => {
      ro.disconnect()
      host.style.removeProperty('--qbar')
    }
  }, [stick])
  return (
    <div ref={ref} className={stick ? 'sticky top-[var(--hdr)] z-[16] -mx-1 mb-2 bg-bg/95 px-1 pt-1 pb-2 backdrop-blur' : 'mb-3'}>
      {children}
    </div>
  )
}
