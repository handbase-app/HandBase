import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackCloses } from '../backNav'
import { db } from '../db'
import { confirmLogout } from '../logout'
import { ROLE_LABEL, useRole } from '../roles'
import { supabase, syncNow, useSyncState } from '../sync'
import { percent, showProgress } from '../syncProgress'
import { canLeave } from './Confirm'
import { flash, isPhone, ItemMenu, type MenuAnchor, type MenuItem } from './ItemMenu'
import { Icon, useMe } from './ui'

/*
 * Bulle de profil, à droite de l'en-tête (après l'étoile des suivis et la cible) : initiales du compte, et un petit point
 * de couleur en bas à droite pour l'état de la synchronisation (vert en direct, ambre en attente ou hors ligne, rouge en
 * erreur, gris en local). Un toucher ouvre le menu du compte (ItemMenu : sous la bulle sur ordinateur, feuille du bas sur
 * téléphone, que le geste Retour referme sans quitter la page) : nom et rôle, état de la synchro (un toucher la relance),
 * Réglages, Confidentialité, Se déconnecter (src/logout.ts, comme dans Réglages ; pas sans serveur).
 */

/** État de la synchronisation, en clair (couleur du point, texte, envois en attente, précision). */
function useSyncInfo() {
  const { state, lastError, live, progress } = useSyncState()
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const map = {
    local: { dot: 'bg-muted', text: 'Local' },
    login: { dot: 'bg-amber-400', text: 'Non connecté' },
    offline: { dot: 'bg-amber-400', text: 'Hors ligne' },
    syncing: { dot: 'bg-sky-400 animate-pulse', text: showProgress(progress) ? `Synchro… ${percent(progress)} %` : 'Synchro…' },
    synced: { dot: 'bg-emerald-400', text: live ? 'En direct' : 'Synchronisé' },
    error: { dot: 'bg-red-500', text: 'Erreur synchro' },
  }[state]
  // Ambre : synchro réussie mais un envoi refusé, ou des envois qui attendent (hors synchro en cours et erreur, qui ont leur couleur).
  const warn = (state === 'synced' && !!lastError) || (pending > 0 && (state === 'synced' || state === 'login'))
  const text = `${map.text}${state !== 'local' && pending > 0 ? ` · ${pending} en attente` : ''}`
  const detail = lastError || (state === 'local' ? 'Données enregistrées sur cet appareil uniquement' : '')
  return { state, dot: warn ? 'bg-amber-400' : map.dot, text, detail }
}

/** Initiales d'un nom (« Prénom Nom » → « PN »), une seule lettre pour un seul mot. */
export function initials(name: string) {
  const words = name.trim().split(/[\s-]+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

export function ProfileButton() {
  const [me] = useMe()
  const role = useRole()
  const sync = useSyncInfo()
  const nav = useNavigate()
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  // Téléphone : feuille du bas, que le geste Retour referme sans quitter la page (src/backNav.tsx, useBackCloses).
  const [sheet, setSheet] = useState(false)
  useBackCloses(() => setAnchor(null), !!anchor && sheet)

  const open = (a: MenuAnchor) => {
    setSheet(isPhone())
    setAnchor(a)
  }
  /**
   * Ferme le menu, puis lance `then` (aller dans Réglages…) : l'écran ouvert prend la place de l'entrée d'historique de
   * la feuille (le retour ramène à l'écran d'avant, en un geste).
   */
  const close = (then?: () => void) => {
    setAnchor(null)
    then?.()
  }
  const go = (to: string) => close(async () => (await canLeave()) && nav(to))

  const name = me.trim()
  const label = `Mon compte : ${sync.text}`
  const items: MenuItem[] = [
    {
      label: sync.text,
      icon: 'sync',
      hint: sync.detail || (sync.state === 'local' ? undefined : 'Toucher pour synchroniser maintenant'),
      wrap: !!sync.detail,
      onSelect: () => close(() => void syncNow()),
      stay: true,
    },
    { label: 'Réglages', icon: 'settings', onSelect: () => go('/parametres'), stay: true, separated: true },
    { label: 'Confidentialité', icon: 'lock', onSelect: () => go('/confidentialite'), stay: true },
  ]
  // Sans serveur (mode local, essai sans base) : pas de compte, pas de déconnexion (comme Réglages → Mon compte).
  if (supabase)
    items.push({
      label: 'Se déconnecter',
      icon: 'logout',
      separated: true,
      stay: true,
      onSelect: () => close(() => void confirmLogout((busy) => busy && navigator.onLine && flash('Envoi des dernières modifications…'))),
    })

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={label}
        title={sync.detail || label}
        onClick={(e) => {
          if (anchor) return close()
          const r = e.currentTarget.getBoundingClientRect()
          open({ x: r.right, y: r.bottom, top: r.top, alignRight: true })
        }}
        // .sync-badge : clignote une fois si l'on entre avant la fin de la synchro (src/splashScreen.ts, index.css).
        className="sync-badge relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-[11px] font-extrabold tracking-wide text-fg hover:border-accent"
      >
        {name ? <span aria-hidden>{initials(name)}</span> : <Icon name="user" className="h-4 w-4 text-muted" />}
        <span className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${sync.dot}`} aria-hidden />
      </button>
      {anchor && <ItemMenu anchor={anchor} title={name || 'Mon compte'} subtitle={ROLE_LABEL[role]} items={items} onClose={() => close()} />}
    </>
  )
}
