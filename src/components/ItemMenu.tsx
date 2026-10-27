import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './ui'
import { useLongPress } from './useLongPress'

/*
 * Menu d'une ligne de liste (joueur, événement, groupe, alerte, « à revoir », vidéo) : appui long sur téléphone,
 * clic droit sur ordinateur, touche « menu » ou Maj+F10 au clavier, ou le bouton « ⋮ » au bout de la ligne.
 * - téléphone (moins de 640 px de large) : feuille qui monte du bas, lignes de 44 px ;
 * - ordinateur : petite fenêtre accrochée au pointeur (clic droit) ou au bouton « ⋮ ».
 * Échap ou un toucher à côté ferme ; le clavier reste dans le menu tant qu'il est ouvert (flèches, Tab, Début, Fin).
 * Chaque liste ne propose que les actions permises par les droits (can.*) et reprend ses gestes existants.
 * Libellés positifs ou neutres uniquement.
 */

/** Où ouvrir : point du pointeur, ou bord d'un élément (bouton « ⋮ », ligne au clavier). */
export type MenuAnchor = { x: number; y: number; /** Bord haut, si le menu doit passer au-dessus faute de place. */ top?: number; /** x est le bord droit du menu. */ alignRight?: boolean }

export type MenuItem = {
  label: string
  icon?: IconName
  /** Icône pleine (étoile d'un joueur suivi). */
  filled?: boolean
  /** Précision sous le libellé. */
  hint?: string
  onSelect: () => void
  /** Ne ferme pas le menu (l'action ouvre une fenêtre à la place du menu). */
  stay?: boolean
  /** Suppression : en rouge, séparée des autres. */
  danger?: boolean
  /** Trait au-dessus (début d'un autre groupe d'actions). */
  separated?: boolean
  /** Précision écrite en entier, sur plusieurs lignes au besoin (message d'erreur de la synchro). */
  wrap?: boolean
}

/** Classes des lignes qui ont un menu : pas de sélection du texte ni de menu natif à l'appui long (sauf dans les champs). */
export const MENU_ROW = 'select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text'

/**
 * Ouverture du menu d'une ligne : gestes à poser sur l'élément de la ligne (`bind`), classes (`MENU_ROW`), et
 * `open` pour le bouton « ⋮ ». Le menu lui-même est rendu par la liste quand `anchor` est posé.
 */
export function useRowMenu() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  // Ouvert : un deuxième signal (contextmenu après l'appui long, touche menu) n'ouvre pas un second menu.
  const isOpen = useRef(false)
  const open = (a: MenuAnchor) => {
    if (isOpen.current) return
    isOpen.current = true
    setAnchor(a)
  }
  const close = () => {
    isOpen.current = false
    setAnchor(null)
  }
  const press = useLongPress((at) => open(at))
  const bind = {
    ...press,
    onKeyDown(e: KeyboardEvent) {
      if (!(e.currentTarget as Node).contains(e.target as Node)) return
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return
      e.preventDefault()
      const r = (e.currentTarget as Element).getBoundingClientRect()
      open({ x: r.left + 16, y: r.bottom, top: r.top })
    },
    onContextMenu(e: MouseEvent) {
      if (isOpen.current && (e.currentTarget as Node).contains(e.target as Node)) return e.preventDefault()
      press.onContextMenu(e)
    },
  }
  return { anchor, open, close, bind }
}

/**
 * Bouton « ⋮ » au bout d'une ligne (icône 16 px dans 32 px, comme l'œil, l'horloge et l'étoile).
 * `inLink` : la ligne entière est un lien (événement, groupe…) ; pas de bouton dans un lien, mais un élément
 * « role=button » qui n'ouvre pas le lien.
 */
export function MenuButton({
  onOpen,
  label,
  open = false,
  inLink = false,
  small = false,
  className = '',
}: {
  onOpen: (a: MenuAnchor) => void
  label: string
  open?: boolean
  inLink?: boolean
  /** Plus petit et plus discret (lignes de joueurs, components/PlayerRow.tsx). */
  small?: boolean
  className?: string
}) {
  const go = (e: SyntheticEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    onOpen({ x: r.right, y: r.bottom, top: r.top, alignRight: true })
  }
  const props = {
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-label': label,
    title: label,
    className: `-my-2 shrink-0 cursor-pointer rounded-md hover:text-fg ${small ? 'p-1.5 text-muted/55' : 'p-2 text-muted/70'} ${className}`,
    onClick: go,
  }
  const icon = <Icon name="more" filled className={small ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
  if (inLink)
    return (
      <span role="button" tabIndex={0} {...props} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && go(e)}>
        {icon}
      </span>
    )
  return (
    <button type="button" {...props}>
      {icon}
    </button>
  )
}

/** Petit message en bas de l'écran, deux secondes (« Lien copié »). */
export function flash(msg: string) {
  const el = document.createElement('div')
  el.setAttribute('role', 'status')
  el.className =
    'pointer-events-none fixed bottom-[calc(var(--nav-b)+1rem)] left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-win border border-line bg-panel px-3 py-2 text-xs font-bold shadow-lg'
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2000)
}

/** Adresse complète d'une page de l'appli (origine + chemin de base + route) : « Copier le lien », fichier d'agenda. */
export const appUrl = (path: string) => new URL(import.meta.env.BASE_URL.replace(/\/$/, '') + path, window.location.origin).href

/** « Copier le lien » d'une page de l'appli (adresse complète, partageable). */
export function copyLink(path: string) {
  const url = appUrl(path)
  const done = () => flash('Lien copié')
  // Sans accès au presse-papiers (navigateur intégré, permission refusée) : l'ancienne méthode, sinon l'adresse affichée.
  const fallback = () => {
    const t = document.createElement('textarea')
    t.value = url
    t.setAttribute('readonly', '')
    t.style.position = 'fixed'
    t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    t.remove()
    if (ok) done()
    else flash(`Copie impossible : ${url}`)
  }
  try {
    if (navigator.clipboard) void navigator.clipboard.writeText(url).then(done, fallback)
    else fallback()
  } catch {
    fallback()
  }
}

/** Téléphone (moins de 640 px de large) : le menu est une feuille du bas. */
export const isPhone = () => {
  try {
    return window.matchMedia('(max-width: 639px)').matches
  } catch {
    return false
  }
}

// Les événements du menu (rendu dans le document, hors de la ligne) ne remontent pas jusqu'aux gestionnaires de la liste.
const stop = (e: SyntheticEvent) => e.stopPropagation()

/**
 * Le menu : en-tête (nom de l'élément, précision), puis les actions. `pop` : petite fenêtre accrochée au bouton même sur
 * téléphone (pas de feuille du bas), avec des lignes à la taille du doigt — menu du profil (src/components/ProfileMenu.tsx).
 */
export function ItemMenu({ anchor, title, subtitle, items, onClose, pop = false }: { anchor: MenuAnchor; title: ReactNode; subtitle?: ReactNode; items: MenuItem[]; onClose: () => void; pop?: boolean }) {
  const [phone] = useState(isPhone)
  const sheet = phone && !pop
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const openedAt = useRef(0)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  // Popover : dans l'écran, sous le point d'ouverture, ou au-dessus faute de place.
  useLayoutEffect(() => {
    if (sheet || !box.current) return
    const { width: w, height: h } = box.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = anchor.alignRight ? anchor.x - w : anchor.x
    left = Math.max(8, Math.min(left, vw - w - 8))
    let top = anchor.y + 4
    if (top + h > vh - 8) top = (anchor.top ?? anchor.y) - h - 4
    top = Math.max(8, Math.min(top, vh - h - 8))
    setPos({ left, top })
  }, [sheet, anchor])

  // Focus sur la première action ; rendu à l'élément d'avant en fermant ; Échap ferme même si le focus est sorti.
  useEffect(() => {
    openedAt.current = Date.now()
    const before = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close.current()
    }
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('keydown', esc)
      // Sauf si une fenêtre ouverte par l'action (confirmation…) a déjà pris le focus.
      const now = document.activeElement
      if (before?.isConnected && before !== document.body && (!now || now === document.body)) before.focus({ preventScroll: true })
    }
  }, [])

  const keys = (e: KeyboardEvent) => {
    const all = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = all.indexOf(document.activeElement as HTMLElement)
    const go = (k: number) => {
      e.preventDefault()
      all[(k + all.length) % all.length]?.focus()
    }
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) go(i + 1)
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(all.length - 1)
    else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }
  // Un relâchement juste après l'appui long ne ferme pas le menu qui vient de s'ouvrir.
  const outside = () => Date.now() - openedAt.current > 350 && onClose()
  const pick = (it: MenuItem) => {
    if (!it.stay) onClose()
    it.onSelect()
  }

  const itemCls = phone ? 'min-h-11 gap-3 px-4 text-sm' : 'min-h-9 gap-2.5 px-3 text-[13px]'
  return createPortal(
    <div
      className="fixed inset-0 z-50"
      onClick={stop}
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onKeyDown={stop}
      onContextMenu={(e) => (e.preventDefault(), stop(e))}
    >
      <div className={`absolute inset-0 ${sheet ? 'bg-black/55' : phone ? 'bg-black/25' : ''}`} onClick={outside} onContextMenu={() => onClose()} aria-hidden />
      <div
        ref={box}
        role="menu"
        aria-orientation="vertical"
        aria-label={typeof title === 'string' ? title : undefined}
        onKeyDown={keys}
        style={sheet ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? 0 }}
        className={
          sheet
            ? 'absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col overflow-y-auto overscroll-contain rounded-t-win border-t border-line bg-panel pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl'
            : 'ask-pop fixed flex max-h-[min(80dvh,32rem)] w-64 flex-col overflow-y-auto overscroll-contain rounded-win border border-line bg-panel py-1 shadow-2xl'
        }
      >
        {sheet && <div className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-line" aria-hidden />}
        <div role="presentation" className={`flex flex-col border-b border-line ${sheet ? 'px-4 pt-1 pb-2.5' : 'px-3 pt-1.5 pb-2'}`}>
          <span className={`truncate font-extrabold ${sheet ? 'text-sm' : 'text-[13px]'}`}>{title}</span>
          {subtitle && <span className="truncate text-[11px] text-muted">{subtitle}</span>}
        </div>
        <div role="presentation" className="flex flex-col py-1">
          {items.map((it, k) => (
            <button
              key={k}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => pick(it)}
              className={`flex w-full shrink-0 items-center text-left outline-none hover:bg-panel-2 focus-visible:bg-panel-2 ${itemCls} ${
                it.danger ? 'text-red-400' : ''
              } ${it.separated || (it.danger && k > 0 && !items[k - 1].danger) ? 'mt-1 border-t border-line pt-1' : ''}`}
            >
              {it.icon && <Icon name={it.icon} filled={it.filled} className={`h-4 w-4 shrink-0 ${it.danger ? '' : 'text-muted'}`} />}
              <span className="flex min-w-0 flex-col py-1">
                <span className="truncate font-bold">{it.label}</span>
                {it.hint && <span className={`${it.wrap ? 'break-words' : 'truncate'} text-[11px] font-normal text-muted`}>{it.hint}</span>}
              </span>
            </button>
          ))}
          {sheet && (
            <button type="button" role="menuitem" tabIndex={-1} onClick={onClose} className={`mt-1 flex w-full items-center justify-center border-t border-line font-bold text-muted ${itemCls}`}>
              Fermer
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
