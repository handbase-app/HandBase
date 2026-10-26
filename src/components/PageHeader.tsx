import { createContext, isValidElement, useContext, type ReactNode } from 'react'
import { BackButton, TabBackButton } from '../backNav'
import { ItemMenu, MenuButton, useRowMenu, type MenuItem } from './ItemMenu'

/*
 * En-tête d'une page de détail (événement, groupe, fiche joueur, séance de mesures, profil recherché…), même grammaire
 * partout : [fermer le panneau, s'il y en a un] … [action principale éventuelle] [⋮]. Plus de « ← RETOUR » depuis le 26/10 :
 * le retour passe par le téléphone, le navigateur ou le menu.
 * Les autres actions (Modifier, Archiver, Dupliquer, Copier le lien…) sont dans le ⋮ ; « Supprimer » y est toujours,
 * en rouge et en dernier, avec la confirmation de la page. Jamais de lien « Supprimer » à côté de « Modifier ».
 */

/** Actions de la page : un menu « ⋮ » au bout de l'en-tête (feuille du bas sur téléphone, petite fenêtre sur ordinateur). */
export function HeaderMenu({ title, subtitle, items, label = 'Plus d’actions' }: { title: ReactNode; subtitle?: ReactNode; items: (MenuItem | false | undefined | null)[]; label?: string }) {
  const menu = useRowMenu()
  const list = items.filter((x): x is MenuItem => !!x)
  if (!list.length) return null
  // Suppression toujours en dernier (en rouge, séparée par ItemMenu).
  const ordered = [...list.filter((x) => !x.danger), ...list.filter((x) => x.danger)]
  return (
    <>
      <MenuButton onOpen={menu.open} open={!!menu.anchor} label={label} className="-mr-2" />
      {menu.anchor && <ItemMenu anchor={menu.anchor} title={title} subtitle={subtitle} items={ordered} onClose={menu.close} />}
    </>
  )
}

/**
 * La rangée d'en-tête : `back` (PanelClose… ; un BackButton n'affiche plus rien), `action` (bouton principal éventuel), `menu`
 * (actions du ⋮).
 */
export function PageHeader({
  back,
  action,
  menu,
  className = '',
}: {
  back: ReactNode
  action?: ReactNode
  menu?: { title: ReactNode; subtitle?: ReactNode; items: (MenuItem | false | undefined | null)[] }
  className?: string
}) {
  // Plus de « ← … » (26/10) : un ancien bouton retour passé ici compte comme rien ; sans rien à gauche ni à droite, pas de rangée.
  const left = isValidElement(back) && (back.type === BackButton || back.type === TabBackButton) ? null : back
  if (!left && !action && !menu) return null
  return (
    <div className={`flex min-h-8 items-center ${left ? 'justify-between' : 'justify-end'} gap-3 ${className}`} data-page-header>
      {left && <div className="flex min-w-0 items-center">{left}</div>}
      {(action || menu) && (
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {menu && <HeaderMenu {...menu} />}
        </div>
      )}
    </div>
  )
}

/**
 * « ⋯ » d'une page de liste (Joueurs, Événements, Groupes) : toutes les actions de la liste (« Nouveau joueur » en premier,
 * « Ajouter à un groupe », « Exporter »…) dans ce menu (petite fenêtre accrochée au bouton, sur téléphone aussi). Posé au
 * bout de la barre « Demander » de la liste, juste à droite de la pilule (BarActions) : rond, même hauteur que la pilule.
 */
export function MoreActions({ title, subtitle, items, label = 'Plus d’actions' }: { title: ReactNode; subtitle?: ReactNode; items: (MenuItem | false | undefined | null)[]; label?: string }) {
  const menu = useRowMenu()
  const list = items.filter((x): x is MenuItem => !!x)
  if (!list.length) return null
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!menu.anchor}
        aria-label={label}
        title={label}
        onClick={(e) => {
          if (menu.anchor) return menu.close()
          const r = e.currentTarget.getBoundingClientRect()
          menu.open({ x: r.right, y: r.bottom, top: r.top, alignRight: true })
        }}
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border bg-panel text-fg shadow-sm transition hover:border-accent ${menu.anchor ? 'border-accent' : 'border-line'}`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {menu.anchor && <ItemMenu anchor={menu.anchor} title={title} subtitle={subtitle} items={list} onClose={menu.close} pop />}
    </>
  )
}

/**
 * Actions d'une page de liste (son « ⋯ ») posées dans sa barre « Demander », juste à droite de la pilule : la page entoure
 * la barre de ses filtres (`ui` de usePlayersQuery / useListQuery) avec BarActions, la barre les place (BarActionsSlot).
 * `below` : posé juste sous la pilule, avant les pastilles (onglets de la page Groupes), à la largeur de la barre.
 */
const BarActionsCtx = createContext<ReactNode>(null)
const BarBelowCtx = createContext<ReactNode>(null)
export function BarActions({ actions, below, children }: { actions: ReactNode; below?: ReactNode; children: ReactNode }) {
  return (
    <BarActionsCtx.Provider value={actions}>
      <BarBelowCtx.Provider value={below ?? null}>{children}</BarBelowCtx.Provider>
    </BarActionsCtx.Provider>
  )
}
export function BarActionsSlot() {
  return useContext(BarActionsCtx)
}
export function BarBelowSlot() {
  return useContext(BarBelowCtx)
}

/**
 * Sous la barre (onglets…) : à la largeur du champ seul, sans passer sous le « ⋯ » (même retrait que lui : bouton de 48 px
 * et l'écart de la rangée) ; sans « ⋯ », toute la largeur.
 */
export function BelowBar({ actions, children }: { actions?: ReactNode; children: ReactNode }) {
  if (!children) return null
  return (
    <div className="flex gap-2">
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <span aria-hidden className="w-12 shrink-0" /> : null}
    </div>
  )
}

/** BelowBar avec ce que BarActions a donné (barre de useListQuery). */
export function BarBelowRow() {
  return <BelowBar actions={useContext(BarActionsCtx)}>{useContext(BarBelowCtx)}</BelowBar>
}
