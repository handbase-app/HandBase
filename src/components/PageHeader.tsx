import type { ReactNode } from 'react'
import { ItemMenu, MenuButton, useRowMenu, type MenuItem } from './ItemMenu'

/*
 * En-tête d'une page de détail (événement, groupe, fiche joueur, séance de mesures, profil recherché…), même grammaire
 * partout : [← RETOUR (destination)] … [action principale éventuelle] [⋮].
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
 * La rangée d'en-tête : `back` (BackButton, PanelClose…), `action` (bouton principal éventuel), `menu` (actions du ⋮).
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
  return (
    <div className={`flex min-h-8 items-center justify-between gap-3 ${className}`} data-page-header>
      <div className="flex min-w-0 items-center">{back}</div>
      {(action || menu) && (
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {menu && <HeaderMenu {...menu} />}
        </div>
      )}
    </div>
  )
}
