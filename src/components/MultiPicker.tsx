import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { useBackCloses } from '../backNav'
import { orText, toggleIn } from '../recipe'
import { fold } from './PlayerFilter'

/*
 * Choix de plusieurs valeurs dans une liste (fenêtre « Filtres » : départements, régions, clubs, groupes, profils,
 * événements, lieux…), sur le modèle du choix des années (src/components/YearPicker.tsx, qui utilise la même feuille) :
 * un bouton résume le choix (« Tous les départements », « Var », « Var ou Bouches-du-Rhône », « 3 départements ») et ouvre
 * une liste de cases à cocher (effectif entre parenthèses), « Tous » en tête (tout décoche). Plusieurs cases cochées :
 * l'une OU l'autre.
 *  - téléphone (moins de 640 px de large) : feuille qui monte du bas, cases de 44 px, bouton « OK » ;
 *  - ordinateur : menu déroulant sous le bouton.
 * Longue liste : un champ « Chercher » en tête (mots sans accents), 200 lignes montrées au plus (les cochées toujours).
 * Chaque case change le choix tout de suite ; « OK », Échap ou un toucher à côté ferme ; focus rendu au bouton. Clavier :
 * Tab ou flèches d'une case à l'autre, Espace coche, Début / Fin ; de vraies cases à cocher avec leur libellé.
 */

export type ChoiceOption = {
  value: string
  /** Libellé (sinon la valeur). */
  label?: string
  /** Effectif montré entre parenthèses. */
  count?: number
}

export const isPhone = () => {
  try {
    return window.matchMedia('(max-width: 639px)').matches
  } catch {
    return false
  }
}

const stop = (e: SyntheticEvent) => e.stopPropagation()
/** Au-delà, un champ « Chercher » en tête de la liste. */
const SEARCH_FROM = 12
/** Lignes montrées au plus (les valeurs cochées en plus). */
const MAX_ROWS = 200

export function MultiPicker({
  value,
  options,
  onChange,
  label,
  allLabel,
  allCount,
  noun,
  search,
  className = '',
}: {
  /** Valeurs cochées (vide : toutes). */
  value: readonly string[]
  options: readonly ChoiceOption[]
  onChange: (values: string[]) => void
  /** Nom du choix (lecteurs d'écran, en-tête de la feuille). */
  label: string
  /** « Tous les départements ». */
  allLabel: string
  allCount?: number
  /** Nom des valeurs au singulier et au pluriel (« 3 départements »). */
  noun: [string, string]
  /** Champ « Chercher » au-delà de 12 valeurs (false : jamais). */
  search?: boolean
  /** Classes du bouton (largeur, hauteur, taille du texte). */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v
  // Une valeur cochée qui n'est plus proposée (autres filtres) reste visible pour pouvoir la décocher.
  const shown = [...options, ...value.filter((v) => !options.some((o) => o.value === v)).map((v) => ({ value: v, count: 0 }))]
  const text = !value.length ? allLabel : value.length <= 2 ? orText(value.map(labelOf)) : `${value.length} ${noun[1]}`
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} : ${value.length ? orText(value.map(labelOf), 5) : allLabel}`}
        title={value.length > 1 ? value.map(labelOf).join(', ') : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`field flex items-center justify-between gap-1 text-left ${value.length ? 'border-accent font-bold' : ''} ${className}`}
      >
        <span className="min-w-0 truncate">{text}</span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 opacity-70" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && button.current && (
        <ChoiceSheet
          anchor={button.current}
          label={label}
          allLabel={allLabel}
          allCount={allCount}
          value={value}
          options={shown}
          search={search !== false && shown.length > SEARCH_FROM}
          picked={!value.length ? allLabel.toLowerCase() : `${value.length} ${value.length > 1 ? noun[1] : noun[0]}`}
          onToggle={(v) => onChange(toggleIn(value, v) ?? [])}
          onAll={() => onChange([])}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/**
 * La liste de cases à cocher (feuille du bas sur téléphone, menu sous le bouton sur ordinateur) : commune au choix des
 * années (YearPicker) et aux autres choix multiples (MultiPicker). `data-popup` : la fenêtre « Filtres » qui l'a ouverte
 * ne se ferme pas quand on touche dedans.
 */
export function ChoiceSheet({
  anchor,
  label,
  allLabel,
  allCount,
  value,
  options,
  search = false,
  picked,
  groupLabel = 'Valeurs',
  onToggle,
  onAll,
  onClose,
}: {
  anchor: HTMLElement
  label: string
  allLabel: string
  allCount?: number
  value: readonly string[]
  options: readonly ChoiceOption[]
  search?: boolean
  /** Résumé du choix (en-tête de la feuille, annoncé). */
  picked: string
  groupLabel?: string
  onToggle: (v: string) => void
  onAll: () => void
  onClose: () => void
}) {
  const [sheet] = useState(isPhone)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const [q, setQ] = useState('')
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  // Téléphone (feuille du bas) : le geste Retour ferme la feuille, et elle seule (la fenêtre « Filtres » reste ouverte).
  useBackCloses(() => close.current(), sheet)

  // Menu déroulant : sous le bouton (au moins sa largeur), au-dessus faute de place, toujours dans l'écran. Recalé après
  // chaque changement (une pastille qui apparaît au-dessus déplace le bouton), au défilement et au redimensionnement.
  const place = useRef(() => {})
  place.current = () => {
    if (sheet || !box.current) return
    const r = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(Math.max(r.width, search ? 260 : 200), vw - 16)
    const h = box.current.getBoundingClientRect().height
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

  // Focus : le champ « Chercher » sur ordinateur, sinon la première case cochée (sinon « Tous ») ; rendu au bouton en
  // fermant ; Échap ferme (et ne ferme pas la fenêtre « Filtres » derrière).
  useEffect(() => {
    const field = !sheet ? box.current?.querySelector<HTMLInputElement>('input[type="search"]') : null
    const first = field ?? box.current?.querySelector<HTMLInputElement>('input[type="checkbox"]:checked') ?? box.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')
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
  }, [anchor]) // eslint-disable-line react-hooks/exhaustive-deps

  const words = fold(q).split(/\s+/).filter(Boolean)
  const matches = words.length ? options.filter((o) => words.every((w) => fold(o.label ?? o.value).includes(w))) : options
  const rows = matches.length > MAX_ROWS ? [...matches.slice(0, MAX_ROWS), ...matches.slice(MAX_ROWS).filter((o) => value.includes(o.value))] : matches
  const hiddenRows = matches.length - rows.length

  const keys = (e: KeyboardEvent) => {
    const all = [...(box.current?.querySelectorAll<HTMLElement>('input, [data-ok]') ?? [])]
    const i = all.indexOf(document.activeElement as HTMLElement)
    const inSearch = (e.target as HTMLElement).getAttribute('type') === 'search'
    const go = (k: number) => {
      e.preventDefault()
      all[(k + all.length) % all.length]?.focus()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) go(i + 1)
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) go(i - 1)
    else if ((e.key === 'Home' || e.key === 'End') && !inSearch) go(e.key === 'Home' ? 0 : all.length - 1)
    else if (e.key === 'Enter' && inSearch) go(i + 1)
    else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault()
      onClose()
    }
  }

  const row = sheet ? 'min-h-11 gap-3 px-4 text-sm' : 'min-h-9 gap-2.5 px-3 text-[13px]'
  const box1 = 'h-[18px] w-[18px] shrink-0 accent-accent'
  const count = (n?: number) => (n === undefined ? null : <span className="ml-auto pl-2 text-[11px] font-normal tabular-nums text-muted">({n.toLocaleString('fr-FR')})</span>)
  return createPortal(
    <div data-popup className="fixed inset-0 z-50" onClick={stop} onPointerDown={stop} onPointerUp={stop} onKeyDown={stop} onContextMenu={stop}>
      <div className={`absolute inset-0 ${sheet ? 'scrim' : 'scrim-light'}`} onClick={onClose} aria-hidden />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onKeyDown={keys}
        style={sheet ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? 0, width: pos?.width }}
        className={
          sheet
            ? 'absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-win border-t border-line bg-panel pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl'
            : 'fixed flex max-h-[min(70dvh,26rem)] flex-col overflow-hidden rounded-win border border-line bg-panel py-1 shadow-2xl'
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
        {search && (
          <div className={`shrink-0 ${sheet ? 'px-4 pt-2' : 'px-2 pt-1 pb-1'}`}>
            <input
              type="search"
              className={`field w-full ${sheet ? 'min-h-11 text-sm' : 'min-h-8 py-1 text-xs'}`}
              placeholder="Chercher…"
              aria-label={`Chercher : ${label.toLowerCase()}`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        )}
        <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain py-1">
          <label className={`flex w-full shrink-0 cursor-pointer items-center font-bold hover:bg-panel-2 has-[:focus-visible]:bg-panel-2 ${row}`}>
            <input type="checkbox" className={box1} checked={!value.length} onChange={onAll} />
            <span className="min-w-0 truncate">{allLabel}</span>
            {count(allCount)}
          </label>
          <div role="group" aria-label={groupLabel} className="mt-1 flex flex-col border-t border-line pt-1">
            {rows.map((o) => (
              <label key={o.value || 'inconnue'} className={`flex w-full shrink-0 cursor-pointer items-center hover:bg-panel-2 has-[:focus-visible]:bg-panel-2 ${row} ${value.includes(o.value) ? 'font-bold' : ''}`}>
                <input type="checkbox" className={box1} checked={value.includes(o.value)} onChange={() => onToggle(o.value)} />
                <span className="min-w-0 truncate">{o.label ?? o.value}</span>
                {count(o.count)}
              </label>
            ))}
            {!rows.length && <p className={`text-muted ${sheet ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'}`}>Aucun résultat pour « {q.trim()} ».</p>}
            {hiddenRows > 0 && (
              <p className={`text-muted ${sheet ? 'px-4 py-2 text-xs' : 'px-3 py-1.5 text-[11px]'}`}>
                {hiddenRows.toLocaleString('fr-FR')} autres : chercher un nom pour les voir.
              </p>
            )}
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
