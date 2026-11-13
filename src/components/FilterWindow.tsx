import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { useBackCloses } from '../backNav'
import { useKeyboardInset } from './Demander'
import { isPhone } from './MultiPicker'

/*
 * Fenêtre « Filtres » des listes (Joueurs, Événements, Groupes, bilan, « Ajouter des joueurs » d'un événement ou d'un
 * groupe) : posée AU-DESSUS de la liste, ouverte par le bouton « Filtres » de la barre « Demander » (qui suit le
 * défilement) : on la règle de n'importe où dans la liste, sans remonter en haut, et la liste ne bouge pas.
 *  - Ordinateur : accrochée sous le bouton, bord droit aligné, ~420 px, hauteur limitée (le contenu défile dedans) ; même
 *    allure que la fenêtre de la bulle ✦ (src/components/Demander.tsx : `ask-pop`). Pas de fond voilé : la liste reste
 *    utilisable, un clic à côté ferme (et garde son effet).
 *  - Téléphone : carte flottante comme la fenêtre ✦ (une marge de chaque côté, fond légèrement voilé et flouté ; un toucher
 *    dessus ferme), bouton « Voir » en bas.
 * Chaque choix s'applique tout de suite (pas de bouton « Appliquer ») ; le pied dit combien d'éléments restent
 * (« 1 234 joueurs sur 40 001 »), « Tout effacer », « Fermer » (« Voir »). Fermeture : ✕, Échap, clic ou toucher à côté ;
 * le focus revient au bouton « Filtres ». Vrai dialogue : titre, aria-modal sur téléphone (fond voilé, focus gardé dedans),
 * non modal sur ordinateur (la liste derrière reste utilisable).
 * Retour du téléphone ou du navigateur : ferme la fenêtre, la liste reste à l'écran (src/backNav.tsx, useBackCloses).
 * Les choix multiples ouverts depuis la fenêtre (src/components/MultiPicker.tsx, YearPicker) portent `data-popup` : les
 * toucher ne ferme pas la fenêtre, et leur Échap ne ferme qu'eux.
 * Toucher une pastille de filtre sous la barre ouvre la fenêtre SUR le réglage de ce filtre (`openAt(clé)`) : la fenêtre
 * défile jusqu'à l'élément `data-filter` qui porte la clé, le met un instant en évidence et y pose le focus.
 * Même fenêtre, en dialogue modal (`modal`), pour les formulaires de création et de modification (src/components/FormWindow.tsx) :
 * centrée sur ordinateur (fond voilé, flouté et inactif), plein écran sur téléphone, pied `footer` à la place du compte.
 */

/** Fenêtre modale (formulaires) : largeur maximale sur ordinateur ; `phoneFull` : plein écran sur téléphone. */
export type ModalOpts = { width?: number; phoneFull?: boolean }

/** État de la fenêtre et son bouton (identifiant de la fenêtre pour aria-controls). */
export function useFilterWindow() {
  const [state, setState] = useState<{ open: boolean; focus?: { key: string; n: number } }>({ open: false })
  const anchor = useRef<HTMLButtonElement | null>(null)
  const id = useId()
  const setOpen = (open: boolean) => setState({ open })
  /** Ouvre la fenêtre (ou y reste) sur le réglage du filtre `key` (pastille touchée). */
  const openAt = (key: string) => setState((s) => ({ open: true, focus: { key, n: (s.focus?.n ?? 0) + 1 } }))
  return { open: state.open, setOpen, openAt, focus: state.focus, anchor, id }
}
export type FilterWindowState = ReturnType<typeof useFilterWindow>

/**
 * Bouton « Filtres » (nombre de filtres posés : « Filtres 3 »). `chip` : étiquette arrondie logée DANS la barre
 * « Demander » ; `pill` : bouton à côté d'un champ (bilan sans la barre du haut).
 */
export function FiltersButton({
  w,
  n,
  variant = 'chip',
  compact = false,
  count,
}: {
  w: FilterWindowState
  n: number
  variant?: 'chip' | 'pill'
  compact?: boolean
  /** Nombre d'éléments de la liste, collé devant « Filtres » (« 40 001 · Filtres ▾ ») : voir chipCount. */
  count?: ChipCount
}) {
  const cls =
    variant === 'chip'
      ? `flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-bold whitespace-nowrap transition ${w.open || n ? 'bg-accent/15 text-fg' : 'bg-panel-2 text-muted hover:text-fg'}`
      : `${compact ? 'min-h-8' : 'min-h-11'} shrink-0 rounded-full border px-3 text-xs font-bold ${w.open || n ? 'border-accent text-fg' : 'border-line text-muted'} ${w.open ? 'bg-accent/15' : 'bg-panel-2'}`
  const name = n ? `Filtres : ${n} posé${n > 1 ? 's' : ''}` : 'Filtres'
  return (
    <>
      <button
        ref={w.anchor as Ref<HTMLButtonElement>}
        type="button"
        onClick={() => w.setOpen(!w.open)}
        aria-haspopup="dialog"
        aria-expanded={w.open}
        aria-controls={w.open ? w.id : undefined}
        aria-label={count ? `${count.spoken} · ${name}` : name}
        className={`${cls} ${count?.busy ? 'wait-busy' : ''}`}
      >
        {count && (
          <>
            <span className="wait-count text-fg tabular-nums">{count.shown}</span>
            <span className="mx-1 opacity-60" aria-hidden>
              ·
            </span>
          </>
        )}
        Filtres
        {n > 0 && (
          <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] text-white" aria-hidden>
            {n}
          </span>
        )}
        <span className="ml-1" aria-hidden>
          {w.open ? '▴' : '▾'}
        </span>
      </button>
      {/* Le nombre annoncé quand il change (le bouton le dit aussi dans son nom). */}
      {count && (
        <span role="status" className="sr-only">
          {count.spoken}
        </span>
      )}
    </>
  )
}

/** Nombre collé devant « Filtres » : `shown` à l'écran (« 7 »), `spoken` lu (« 7 joueurs »), `busy` : estompé pendant un calcul.
    Pas de « sur <total> » : le total de la base n'apporte rien (décidé le 25/10/2026). */
export type ChipCount = { shown: string; spoken: string; busy?: boolean }

/** Le nombre de la liste filtrée pour l'étiquette « Filtres » ; `loading` : « Chargement… » tant que la liste n'est pas lue. */
export function chipCount(n: number, noun: (n: number) => string, opts: { loading?: boolean; busy?: boolean } = {}): ChipCount {
  if (opts.loading) return { shown: 'Chargement…', spoken: 'Chargement…' }
  const shown = n.toLocaleString('fr-FR')
  return { shown, spoken: `${shown} ${noun(n)}`, busy: opts.busy }
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type WinProps = {
  w: FilterWindowState
  count?: ReactNode
  onClear?: () => void
  children: ReactNode
  title?: string
  /** Dialogue modal centré (formulaires) au lieu de la fenêtre accrochée au bouton « Filtres ». */
  modal?: ModalOpts
  /** Pied de la fenêtre à la place du compte, de « Tout effacer » et de « Fermer » (boutons d'un formulaire). */
  footer?: ReactNode
  /** Nom du bouton ✕ pour les lecteurs d'écran. */
  closeLabel?: string
}

/** La fenêtre (rien si fermée). `count` : « 1 234 joueurs sur 40 001 » ; `onClear` : « Tout effacer » (absent : rien à effacer). */
export function FilterWindow({ title = 'Filtres', ...props }: WinProps) {
  if (!props.w.open) return null
  return createPortal(<Win title={title} {...props} />, document.body)
}

function Win({ w, count, onClear, children, title, modal, footer, closeLabel = 'Fermer les filtres' }: WinProps) {
  const [phone] = useState(isPhone)
  const full = !!modal && phone && modal.phoneFull !== false
  const backdrop = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const titleId = `${w.id}-titre`
  const kb = useKeyboardInset(phone)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null)

  /** Ferme ; `back` : le focus revient au bouton « Filtres » (✕, Échap, « Fermer », toucher le fond). */
  const close = (back: boolean) => {
    const a = w.anchor.current
    w.setOpen(false)
    if (back && a?.isConnected) a.focus({ preventScroll: true })
  }
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })
  // Geste Retour : ferme la fenêtre au lieu de quitter la liste.
  useBackCloses(() => closeRef.current(true))

  // Place : sous le bouton, bord droit aligné sur le sien, dans l'écran ; hauteur jusqu'au bas de l'écran (au-dessus du
  // clavier du téléphone). Recalée au défilement (le bouton suit la barre collée en haut, ou s'en va) et au redimensionnement.
  const place = useRef(() => {})
  place.current = () => {
    const r = w.anchor.current?.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = kb.height || window.innerHeight
    const width = phone ? vw - 24 : Math.min(420, vw - 16)
    const left = phone ? 12 : Math.max(8, Math.min((r?.right ?? vw - 8) - width, vw - width - 8))
    const top = Math.round(Math.max(phone ? 56 : 8, Math.min((r?.bottom ?? 64) + 8, vh - (phone ? 260 : 220))))
    const maxH = Math.max(200, vh - top - 12)
    setPos((p) => (p && p.left === left && p.top === top && p.width === width && p.maxH === maxH ? p : { left, top, width, maxH }))
  }
  useLayoutEffect(() => place.current())
  useEffect(() => {
    const again = () => place.current()
    window.addEventListener('resize', again)
    window.addEventListener('scroll', again, true)
    return () => {
      window.removeEventListener('resize', again)
      window.removeEventListener('scroll', again, true)
    }
  }, [])

  // À l'ouverture : le focus sur le premier réglage (sans faire défiler la page) ; ouverte depuis une pastille : sur le
  // réglage de son filtre, amené dans la fenêtre et mis un instant en évidence (il peut n'apparaître qu'au rendu suivant :
  // « + Ajouter une condition » déplié par la page).
  useEffect(() => {
    const key = w.focus?.key
    let tries = 0
    let raf = 0
    let timer = 0
    const find = () => {
      const body = box.current?.querySelector<HTMLElement>('[data-body]')
      const el = key ? body?.querySelector<HTMLElement>(`[data-filter~="${CSS.escape(key)}"]`) : null
      if (key && !el && tries++ < 6) {
        raf = requestAnimationFrame(find)
        return
      }
      if (!el || !body) {
        // Formulaire sur téléphone : pas de clavier qui surgit à l'ouverture (le focus reste sur la fenêtre).
        const first = (modal && phone ? null : box.current?.querySelector<HTMLElement>(`[data-body] :is(${FOCUSABLE})`)) ?? box.current
        first?.focus({ preventScroll: true })
        return
      }
      const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop
      body.scrollTop = Math.max(0, top - 12)
      el.classList.add('filter-hl')
      timer = window.setTimeout(() => el.classList.remove('filter-hl'), 1600)
      const target = el.querySelector<HTMLElement>('[aria-pressed="true"]') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? box.current
      target?.focus({ preventScroll: true })
    }
    // Après le rendu qui place la fenêtre (sa hauteur limitée fait défiler son contenu).
    raf = requestAnimationFrame(find)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [w.focus?.n]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ordinateur : un clic hors de la fenêtre (et hors du bouton, qui la referme lui-même) la ferme, et ce clic garde son
  // effet. Pas dans une liste de choix ouverte depuis la fenêtre (data-popup) ni dans un autre dialogue (confirmation).
  // Échap quand le focus n'est pas dans la fenêtre (ni dans un autre dialogue) : ferme aussi.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null
      // Une pastille de filtre (data-opens-filters) : la fenêtre reste ouverte et passe sur son réglage.
      if (!t || box.current?.contains(t) || w.anchor.current?.contains(t) || t.closest('[data-popup], [data-opens-filters], [role="dialog"], [role="alertdialog"]')) return
      closeRef.current(false)
    }
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const a = document.activeElement
      if (a && a !== document.body && (box.current?.contains(a) || a.closest('[data-popup], [role="dialog"], [role="alertdialog"]'))) return
      closeRef.current(true)
    }
    if (!phone && !modal) document.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
    }
  }, [phone]) // eslint-disable-line react-hooks/exhaustive-deps

  // Modal : la page derrière ne défile pas sous la molette ou le doigt (le contenu de la fenêtre, lui, défile).
  useEffect(() => {
    const el = backdrop.current
    if (!modal || !el) return
    const stop = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) e.preventDefault()
    }
    el.addEventListener('wheel', stop, { passive: false })
    el.addEventListener('touchmove', stop, { passive: false })
    return () => {
      el.removeEventListener('wheel', stop)
      el.removeEventListener('touchmove', stop)
    }
  }, [modal])

  // Clavier dans la fenêtre : Échap ferme (les listes de choix ouvertes depuis elle arrêtent leur Échap) ; téléphone
  // (dialogue modal) : Tab reste dans la fenêtre.
  const keys = (e: KeyboardEvent) => {
    // Les touches restent dans la fenêtre (les flèches de la liste derrière, src/components/PlayerFilter.tsx arrowNav, ne
    // les voient pas).
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
      return
    }
    if (e.key !== 'Tab' || !(phone || modal)) return
    const all = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((x) => x.offsetParent !== null)
    if (!all.length) return
    const i = all.indexOf(document.activeElement as HTMLElement)
    if (e.shiftKey && i <= 0) {
      e.preventDefault()
      all[all.length - 1].focus()
    } else if (!e.shiftKey && i === all.length - 1) {
      e.preventDefault()
      all[0].focus()
    }
  }

  const vh = kb.height || window.innerHeight
  const card = (
    <div
      ref={box}
      id={w.id}
      role="dialog"
      aria-modal={phone || modal ? 'true' : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={keys}
      className={
        !modal
          ? 'ask-pop fixed z-40 flex flex-col overflow-hidden rounded-win border border-ai/40 bg-panel shadow-2xl outline-none'
          : full
            ? 'fixed inset-x-0 top-0 flex flex-col overflow-hidden bg-panel outline-none'
            : 'ask-pop relative flex w-full flex-col overflow-hidden rounded-win border border-line bg-panel shadow-2xl outline-none'
      }
      style={
        !modal
          ? pos
            ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH }
            : { left: -9999, top: 0 }
          : full
            ? { height: vh }
            : { maxWidth: modal.width ?? 640, maxHeight: vh - (phone ? 24 : 48) }
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-3.5">
        <h2 id={titleId} className="min-w-0 flex-1 text-sm font-extrabold">
          {title}
        </h2>
        <button type="button" className="flex min-h-10 min-w-10 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg" aria-label={closeLabel} onClick={() => close(true)}>
          <span aria-hidden className="text-base leading-none">
            ✕
          </span>
        </button>
      </div>
      <div data-body className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-3.5 py-3">
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel-2/60 px-3.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-2">
        {footer ?? (
          <>
            <p className="min-w-0 flex-1 text-xs" aria-live="polite">
              {count}
            </p>
            {onClear && (
              <button type="button" className="min-h-10 shrink-0 px-1 text-[11px] font-bold text-muted underline hover:text-fg" onClick={onClear}>
                Tout effacer
              </button>
            )}
            <button type="button" className="btn-primary min-h-10 shrink-0 px-4 text-xs" onClick={() => close(true)}>
              {phone ? 'Voir' : 'Fermer'}
            </button>
          </>
        )}
      </div>
    </div>
  )
  // Modal (formulaire) : fond voilé et flouté, inactif (un clic dessus ne ferme pas : la saisie n'est pas perdue par mégarde).
  if (modal)
    return (
      <div ref={backdrop} className={`fixed inset-0 z-40 flex justify-center ${full ? '' : 'items-center p-3 sm:p-6'}`}>
        <div className="absolute inset-0 scrim" aria-hidden />
        {card}
      </div>
    )
  if (!phone) return card
  // Téléphone : fond légèrement voilé et flouté (comme la fenêtre ✦) ; un toucher dessus ferme.
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 scrim-light" aria-hidden onClick={() => close(true)} />
      {card}
    </div>
  )
}

/** « 1 234 joueurs sur 40 001 » (nombre en gras), ou « 1 234 joueurs » quand rien n'est filtré. */
export function CountText({ n, noun }: { n: number; noun: (n: number) => string }) {
  return (
    <>
      <b className="tabular-nums">{n.toLocaleString('fr-FR')}</b> {noun(n)}
    </>
  )
}

/**
 * Un réglage de la fenêtre : son nom (petites capitales) et ses choix. `k` : filtre(s) réglé(s) ici (pastille touchée :
 * la fenêtre s'ouvre sur ce réglage, voir `openAt`).
 */
export function FilterField({ label, children, id, k }: { label: string; children: ReactNode; id?: string; k?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1" role={id ? undefined : 'group'} aria-label={id ? undefined : label} data-filter={k}>
      <span id={id} className="text-[10px] font-bold tracking-wider text-muted uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

/** Pastille à bascule des réglages (cochée : pleine, couleur d'accent). `small` : 32 px de haut, texte de 11 px. */
export const pillClass = (on: boolean, small?: boolean) =>
  `${small ? 'min-h-8 px-2 text-[11px]' : 'min-h-9 px-2.5 text-xs'} rounded-full border font-bold transition disabled:opacity-40 ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-fg'}`

/**
 * Pastilles à cocher (listes courtes : postes, latéralité, trimestre, type…) : « Tous » (rien de coché) puis chaque valeur,
 * avec son nombre (les AUTRES filtres appliqués) ; plusieurs cochées = l'une OU l'autre. Une valeur à 0 est grisée (sauf
 * cochée). Boutons à bascule (aria-pressed). `small` : pastilles plus serrées (« Plus de filtres » de la liste Joueurs).
 */
export function ChoicePills<V extends string>({
  label,
  value,
  options,
  onChange,
  counts,
  total,
  allLabel = 'Tous',
  extra,
  k,
  small,
}: {
  /** Filtre(s) réglé(s) ici (voir FilterField). */
  k?: string
  label: string
  value: readonly V[]
  options: readonly { value: V; label: string; short?: string; title?: string }[]
  onChange: (v: V[]) => void
  counts?: ReadonlyMap<string, number> | Readonly<Record<string, number>>
  total?: number
  allLabel?: string
  /** Après les valeurs (« Sans poste »…). */
  extra?: ReactNode
  /** Pastilles plus petites (32 px de haut, texte de 11 px). */
  small?: boolean
}) {
  const nOf = (v: string) => (counts ? (counts instanceof Map ? (counts.get(v) ?? 0) : ((counts as Record<string, number>)[v] ?? 0)) : undefined)
  const pill = (on: boolean) => pillClass(on, small)
  const num = (n?: number) => (n === undefined ? null : <span className="ml-1 text-[10px] font-normal tabular-nums opacity-75">{n.toLocaleString('fr-FR')}</span>)
  return (
    <FilterField label={label} k={k}>
      <div className={`flex flex-wrap ${small ? 'gap-1' : 'gap-1.5'}`}>
        <button type="button" aria-pressed={!value.length} className={pill(!value.length)} onClick={() => onChange([])}>
          {allLabel}
          {num(total)}
        </button>
        {options.map((o) => {
          const on = value.includes(o.value)
          const n = nOf(o.value)
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              title={o.title ?? (o.short && o.short !== o.label ? o.label : undefined)}
              aria-label={o.short && o.short !== o.label ? `${o.title ?? o.label}${n !== undefined ? ` (${n})` : ''}` : undefined}
              disabled={n === 0 && !on}
              className={pill(on)}
              onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
            >
              {o.short ?? o.label}
              {num(n)}
            </button>
          )
        })}
        {extra}
      </div>
    </FilterField>
  )
}
