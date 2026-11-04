import { useEffect, useState } from 'react'
import { accountLabel, firstName, type AccountsView, type SavedAccount } from '../comptesCore'
import { addAccount, removeAccount, switchTo, useAccountsView } from '../comptes'
import { ask } from './Confirm'
import { FormActions, FormWindow } from './FormWindow'
import { flash, type MenuItem } from './ItemMenu'
import { Icon } from './ui'

/*
 * « Changer de compte » en un toucher (src/comptes.ts) : entrées du menu de la bulle de profil, bandeau « Compte de test »,
 * fenêtre « Ajouter un compte de test » (ou reconnecter un compte dont la session ne vaut plus), « Retirer un compte de test ».
 * Rien ne s'affiche pour un compte qui n'est pas administrateur sur un appareil sans compte administrateur gardé (un vrai jeune
 * sur son téléphone ne voit rien de nouveau : src/comptesCore.ts accountsView).
 */

type WindowAsk = { kind: 'ajouter'; email?: string; note?: string } | { kind: 'retirer' }
const OPEN = 'hb-comptes:fenetre'
const openWindow = (d: WindowAsk) => window.dispatchEvent(new CustomEvent<WindowAsk>(OPEN, { detail: d }))

/** Passe sur ce compte ; session plus valable : la fenêtre de connexion s'ouvre pour lui. */
export async function goToAccount(a: SavedAccount) {
  flash(`Passage sur ${firstName(a)}…`)
  const r = await switchTo(a.uid)
  if (r.ok) return
  if (r.reconnect) openWindow({ kind: 'ajouter', email: r.reconnect.email, note: r.message })
  else flash(r.message)
}

async function removeActive(a: SavedAccount, home: SavedAccount | null) {
  const ok = await ask(
    `Retirer le compte de ${firstName(a)} de cet appareil ? Sa session est fermée ici et ses données locales sont effacées${home ? ` ; retour sur ${firstName(home)}` : ''}. Le compte lui-même n’est pas touché.`,
    { ok: 'Retirer' },
  )
  if (!ok) return
  const r = await removeAccount(a.uid)
  if (!r.ok) flash(r.message)
}

/** Entrées du menu de la bulle de profil (src/components/ProfileMenu.tsx), avant « Se déconnecter ». */
export function accountMenuItems(v: AccountsView): MenuItem[] {
  if (!v.show) return []
  const items: MenuItem[] = []
  if (v.onTest && v.home) {
    const home = v.home
    items.push({ label: `Revenir sur ${accountLabel(home)}`, icon: 'undo', onSelect: () => void goToAccount(home) })
  }
  for (const o of v.others) items.push({ label: `Passer sur ${accountLabel(o)}`, icon: 'user', hint: 'Compte de test', onSelect: () => void goToAccount(o) })
  if (v.canAdd) items.push({ label: 'Ajouter un compte de test…', icon: 'userPlus', onSelect: () => openWindow({ kind: 'ajouter' }) })
  if (v.onTest && v.active) {
    const me = v.active
    items.push({ label: 'Retirer ce compte de l’appareil', icon: 'trash', onSelect: () => void removeActive(me, v.home) })
  } else if (v.others.length) items.push({ label: 'Retirer un compte de test…', icon: 'trash', onSelect: () => openWindow({ kind: 'retirer' }) })
  if (items.length) items[0] = { ...items[0], separated: true }
  return items
}

/** Bandeau sous l'en-tête pendant un compte de test : lequel est actif, et le retour en un toucher. */
export function AccountBanner() {
  const v = useAccountsView()
  if (!v.onTest || !v.active) return null
  const home = v.home
  return (
    <div className="no-print border-b border-accent/40 bg-accent/15 px-4 py-1.5 text-[11px]" data-testid="compte-test">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
        <span className="min-w-0 truncate">
          <Icon name="user" className="mr-1 inline h-3.5 w-3.5" />
          Compte de test : <b>{accountLabel(v.active)}</b>
        </span>
        {home && (
          <button type="button" className="shrink-0 rounded-full bg-accent px-2.5 py-1 font-bold text-white" onClick={() => void goToAccount(home)}>
            Revenir sur {firstName(home)}
          </button>
        )}
      </div>
    </div>
  )
}

/** Écran de connexion d'un compte de test (session refusée) : retour sur le compte administrateur gardé. */
export function LoginAccounts() {
  const v = useAccountsView()
  if (!v.onTest || !v.home) return null
  const home = v.home
  return (
    <button type="button" className="btn-ghost text-xs" onClick={() => void goToAccount(home)}>
      Revenir sur {accountLabel(home)}
    </button>
  )
}

/** Fenêtres ouvertes par le menu, le bandeau ou l'écran de connexion (posé une fois dans l'appli et sur l'écran de connexion). */
export function AccountWindows() {
  const [win, setWin] = useState<WindowAsk | null>(null)
  useEffect(() => {
    const on = (e: Event) => setWin((e as CustomEvent<WindowAsk>).detail)
    window.addEventListener(OPEN, on)
    return () => window.removeEventListener(OPEN, on)
  }, [])
  if (!win) return null
  if (win.kind === 'retirer') return <RemoveWindow onClose={() => setWin(null)} />
  return <AddWindow email={win.email} note={win.note} onClose={() => setWin(null)} />
}

function AddWindow({ email: initial = '', note, onClose }: { email?: string; note?: string; onClose: () => void }) {
  const [email, setEmail] = useState(initial)
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setErr('')
    setBusy(true)
    const r = await addAccount(email, password)
    // Réussite : l'appli se recharge sur ce compte.
    if (!r.ok) {
      setBusy(false)
      setErr(r.message)
    }
  }
  return (
    <FormWindow title={initial ? 'Reconnecter un compte' : 'Ajouter un compte de test'} onClose={onClose} width={440} phoneFull={false}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {note && <p className="text-xs font-bold">{note}</p>}
        <p className="text-[11px] text-muted">
          Pour essayer l’appli avec un autre compte (la page d’un jeune…). Ton compte reste ouvert sur cet appareil : tu y reviens en un toucher depuis la
          bulle de profil, sans retaper ton mot de passe. Chaque compte garde ses données à part.
        </p>
        <div>
          <span className="label">E-mail</span>
          <input className="field" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <span className="label">Mot de passe</span>
          <input className="field" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {err && <p className="text-[11px] text-red-300">{err}</p>}
        <FormActions>
          <button type="button" className="btn-primary" disabled={busy || !email.trim() || !password} onClick={() => void submit()}>
            {busy ? 'Connexion…' : 'Se connecter et passer sur ce compte'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
        </FormActions>
      </form>
    </FormWindow>
  )
}

function RemoveWindow({ onClose }: { onClose: () => void }) {
  const v = useAccountsView()
  return (
    <FormWindow title="Retirer un compte de test" onClose={onClose} width={440} phoneFull={false} guard={false}>
      <p className="text-[11px] text-muted">Sa session est fermée sur cet appareil et ses données locales sont effacées. Le compte lui-même n’est pas touché.</p>
      {v.others.map((a) => (
        <div key={a.uid} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{accountLabel(a)}</span>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={async () => {
              const r = await removeAccount(a.uid)
              flash(r.ok ? `Compte de ${firstName(a)} retiré de l’appareil.` : r.message)
            }}
          >
            Retirer
          </button>
        </div>
      ))}
      {!v.others.length && <p className="text-xs">Aucun compte de test sur cet appareil.</p>}
      <FormActions>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Fermer
        </button>
      </FormActions>
    </FormWindow>
  )
}
