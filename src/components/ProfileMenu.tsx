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

/**
 * `rail` (téléphone couché, plus d'en-tête : src/App.tsx) : la bulle est en bas du menu de gauche, le menu s'ouvre à sa
 * droite, son bas aligné sur celui de la bulle. `extra` : entrées ajoutées en tête du menu (« Mes suivis », « Profils
 * recherchés » quand l'étoile et la cible n'ont pas la place dans le menu de gauche) ; `badge` : leurs nouveautés, en
 * pastille sur la bulle.
 */
export function ProfileButton({ rail = false, extra = [], badge = 0 }: { rail?: boolean; extra?: MenuItem[]; badge?: number } = {}) {
  const [me] = useMe()
  const role = useRole()
  const sync = useSyncInfo()
  const nav = useNavigate()
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  // Téléphone aussi : petite fenêtre sous les initiales (pas de feuille du bas, jugée trop lente : Geoffroy, 25/10), que le
  // geste Retour referme sans quitter la page (src/backNav.tsx, useBackCloses).
  const [phone, setPhone] = useState(false)
  useBackCloses(() => setAnchor(null), !!anchor && phone)

  const open = (a: MenuAnchor) => {
    setPhone(isPhone() || rail)
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
  const label = `Mon compte : ${sync.text}${badge > 0 ? ` · ${badge} nouveauté${badge > 1 ? 's' : ''}` : ''}`
  const items: MenuItem[] = [
    ...extra.map((it) => ({ ...it, onSelect: () => close(it.onSelect), stay: true })),
    {
      separated: extra.length > 0,
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
          // Menu de gauche (téléphone couché) : à droite de la bulle, au-dessus de son bas (pas de place dessous).
          open(rail ? { x: r.right + 10, y: r.top, top: r.bottom } : { x: r.right, y: r.bottom, top: r.top, alignRight: true })
        }}
        // .sync-badge : clignote une fois si l'on entre avant la fin de la synchro (src/splashScreen.ts, index.css).
        className="sync-badge relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-[11px] font-extrabold tracking-wide text-fg hover:border-accent"
      >
        {name ? <span aria-hidden>{initials(name)}</span> : <Icon name="user" className="h-4 w-4 text-muted" />}
        <span className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${sync.dot}`} aria-hidden />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-accent px-1 text-center text-[9px] leading-4 font-bold text-white" aria-hidden>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </button>
      {anchor && <ItemMenu anchor={anchor} title={name || 'Mon compte'} subtitle={ROLE_LABEL[role]} items={items} onClose={() => close()} pop />}
    </>
  )
}
