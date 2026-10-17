import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { toggleYear, yearsShort } from '../birthYears'

/*
 * Choix d'une ou plusieurs années de naissance (page Joueurs, Événements, bilan de détection, questions enregistrées).
 * Un bouton résume le choix (« Toutes les années », « 2011 », « 2010 – 2012 », « 2010, 2012, 2014 », « 5 années ») et
 * ouvre une liste de cases à cocher (année, effectif entre parenthèses), « Toutes les années » en tête (tout décoche).
 * - téléphone (moins de 640 px de large) : feuille qui monte du bas, cases de 44 px, bouton « OK » ;
 * - ordinateur : menu déroulant sous le bouton.
 * Chaque case change le choix tout de suite ; « OK », Échap ou un toucher à côté ferme. Clavier : Tab ou flèches d'une
 * case à l'autre, Espace coche, Début / Fin ; de vraies cases à cocher avec leur libellé (lecteurs d'écran).
 * Même allure que le menu des lignes (src/components/ItemMenu.tsx) ; couleurs des styles d'installation (src/uiStyle.ts).
 */

export type YearOption = {
  /** Année (texte, « 2011 ») ; '' : année inconnue. */
  value: string
  /** Libellé (sinon l'année, ou « Année inconnue »). */
  label?: string
  /** Effectif montré entre parenthèses. */
  count?: number
}

const isPhone = () => {
  try {
    return window.matchMedia('(max-width: 639px)').matches
  } catch {
    return false
  }
}

const stop = (e: SyntheticEvent) => e.stopPropagation()

export function YearPicker({
  value,
  options,
  onChange,
  label = 'Année de naissance',
  allLabel = 'Toutes les années',
  allCount,
  unknownLabel = 'Année inconnue',
  className = '',
}: {
  /** Années cochées (vide : toutes). */
  value: readonly string[]
  options: readonly YearOption[]
  onChange: (years: string[]) => void
  /** Nom du choix (lecteurs d'écran, en-tête de la feuille). */
  label?: string
  allLabel?: string
  /** Effectif de « Toutes les années ». */
  allCount?: number
  unknownLabel?: string
  /** Classes du bouton (largeur, hauteur, taille du texte). */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  // Une année choisie qui n'est plus proposée (autres filtres) reste visible pour pouvoir la décocher.
  const shown = [...options, ...value.filter((y) => !options.some((o) => o.value === y)).map((y) => ({ value: y, count: 0 }))]
  const text = yearsShort(value, { all: allLabel, unknown: unknownLabel })
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} : ${text}`}
        title={value.length > 1 ? value.map((y) => y || unknownLabel).join(', ') : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`field flex items-center justify-between gap-1 text-left ${value.length ? 'border-accent font-bold' : ''} ${className}`}
      >
        <span className="min-w-0 truncate">{text}</span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 opacity-70" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && button.current && (
        <YearSheet
          anchor={button.current}
          label={label}
          allLabel={allLabel}
          allCount={allCount}
          unknownLabel={unknownLabel}
          value={value}
          options={shown}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function YearSheet({
  anchor,
  label,
  allLabel,
  allCount,
  unknownLabel,
  value,
  options,
  onChange,
  onClose,
}: {
  anchor: HTMLElement
  label: string
  allLabel: string
  allCount?: number
  unknownLabel: string
  value: readonly string[]
  options: readonly YearOption[]
  onChange: (years: string[]) => void
  onClose: () => void
}) {
  const [sheet] = useState(isPhone)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  // Menu déroulant : sous le bouton (au moins sa largeur), au-dessus faute de place, toujours dans l'écran. Recalé après
  // chaque changement (une pastille qui apparaît au-dessus déplace le bouton), au défilement et au redimensionnement.
  const place = useRef(() => {})
  place.current = () => {
    if (sheet || !box.current) return
    const r = anchor.getBoundingClientRect()
    const width = Math.max(r.width, 200)
    const h = box.current.getBoundingClientRect().height
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left = Math.max(8, Math.min(r.left, vw - width - 8))
    let top = r.bottom + 4
    if (top + h > vh - 8) top = r.top - h - 4
    top = Math.max(8, Math.min(top, vh - h - 8))
    setPos((p) => (p && p.left === left && p.top === top && p.width === width ? p : { left, top, width }))
  }
  useLayoutEffect(() => place.current())
  useEffect(() => {
    if (sheet) return
    const again = () => place.current()
    window.addEventListener('resize', again)
    window.addEventListener('scroll', again, true)
    return () => {
      window.removeEventListener('resize', again)
      window.removeEventListener('scroll', again, true)
    }
  }, [sheet])

  // Focus sur la première case cochée (sinon « Toutes ») ; rendu au bouton en fermant ; Échap ferme.
  useEffect(() => {
    const first = box.current?.querySelector<HTMLInputElement>('input:checked') ?? box.current?.querySelector<HTMLInputElement>('input')
    first?.focus({ preventScroll: true })
    first?.scrollIntoView?.({ block: 'nearest' })
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
      }
    }
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
      if (anchor.isConnected) anchor.focus({ preventScroll: true })
    }
  }, [anchor])

  const keys = (e: KeyboardEvent) => {
    const all = [...(box.current?.querySelectorAll<HTMLElement>('input, [data-ok]') ?? [])]
    const i = all.indexOf(document.activeElement as HTMLElement)
    const go = (k: number) => {
      e.preventDefault()
      all[(k + all.length) % all.length]?.focus()
    }
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) go(i + 1)
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(all.length - 1)
    else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault()
      onClose()
    }
  }

  const row = sheet ? 'min-h-11 gap-3 px-4 text-sm' : 'min-h-9 gap-2.5 px-3 text-[13px]'
  const box1 = 'h-[18px] w-[18px] shrink-0 accent-accent'
  const count = (n?: number) => (n === undefined ? null : <span className="ml-auto pl-2 text-[11px] font-normal tabular-nums text-muted">({n.toLocaleString('fr-FR')})</span>)
  const picked = value.length > 1 ? `${value.length} années cochées` : value.length === 1 ? '1 année cochée' : 'toutes les années'
  return createPortal(
    <div className="fixed inset-0 z-50" onClick={stop} onPointerDown={stop} onPointerUp={stop} onKeyDown={stop} onContextMenu={stop}>
      <div className={`absolute inset-0 ${sheet ? 'bg-black/55' : ''}`} onClick={onClose} aria-hidden />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={keys}
        style={sheet ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? 0, width: pos?.width }}
        className={
          sheet
            ? 'absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-line bg-panel pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl'
            : 'fixed flex max-h-[min(70dvh,26rem)] flex-col rounded-xl border border-line bg-panel py-1 shadow-2xl'
        }
      >
        {sheet && (
          <>
            <div className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-line" aria-hidden />
            <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-line px-4 pt-1 pb-2.5">
              <span className="truncate text-sm font-extrabold">{label}</span>
              <span className="shrink-0 text-[11px] text-muted" aria-live="polite">
                {picked}
              </span>
            </div>
          </>
        )}
        <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain py-1">
          <label className={`flex w-full shrink-0 cursor-pointer items-center font-bold hover:bg-panel-2 has-[:focus-visible]:bg-panel-2 ${row}`}>
            <input type="checkbox" className={box1} checked={!value.length} onChange={() => onChange([])} />
            <span className="min-w-0 truncate">{allLabel}</span>
            {count(allCount)}
          </label>
          <div role="group" aria-label="Années" className="flex flex-col border-t border-line pt-1 mt-1">
            {options.map((o) => (
              <label key={o.value || 'inconnue'} className={`flex w-full shrink-0 cursor-pointer items-center hover:bg-panel-2 has-[:focus-visible]:bg-panel-2 ${row} ${value.includes(o.value) ? 'font-bold' : ''}`}>
                <input type="checkbox" className={box1} checked={value.includes(o.value)} onChange={() => onChange(toggleYear(value, o.value))} />
                <span className="min-w-0 truncate">{o.label ?? (o.value || unknownLabel)}</span>
                {count(o.count)}
              </label>
            ))}
          </div>
        </div>
        <div className={`flex shrink-0 gap-2 border-t border-line ${sheet ? 'px-4 pt-2' : 'px-2 pt-1.5 pb-0.5'}`}>
          <button type="button" data-ok className={`btn-primary flex-1 ${sheet ? 'min-h-11' : 'min-h-8 py-1 text-xs'}`} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
