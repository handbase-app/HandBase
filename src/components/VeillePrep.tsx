import { useEffect, useState } from 'react'
import { appName } from '../appBrand'
import { enablePush, pushSupport, syncSubscription } from '../push'

/*
 * « Préparer mes détections la veille » (push de la veille : supabase/060_push_veille.sql, src/veilleSw.ts). L'autorisation des
 * notifications n'est demandée qu'après ce geste clair (jamais à l'ouverture de l'appli). Le retrait se fait dans
 * Réglages → Notifications (« Désactiver »). iPhone : seulement dans l'appli ajoutée à l'écran d'accueil (iOS 16.4 et plus) :
 * aide courte à la place du bouton.
 *  - page d'un événement (compact) : seulement pour son organisateur, ses participants ou son staff, si l'événement n'est
 *    pas passé et si ce téléphone n'est pas encore abonné ;
 *  - Réglages → Notifications : l'explication et l'état.
 */
export const VEILLE_EXPLICATION =
  'La veille de tes événements, vers 18 h, une notification télécharge tes joueurs, leurs mesures et avis et la grille de notation : le jour J, tout est sur ce téléphone, même sans réseau.'

export function VeillePrep({ compact = false, onChange }: { compact?: boolean; onChange?: (subscribed: boolean) => void }) {
  const support = pushSupport()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (support !== 'ok') return
    let live = true
    void syncSubscription().then((s) => live && setSubscribed(s))
    return () => {
      live = false
    }
  }, [support])

  if (support === 'not-configured' || support === 'unsupported') return null
  if (support === 'ios-install')
    return (
      <p className="text-[11px] text-muted" data-testid="veille-ios">
        Pour préparer tes détections la veille sur iPhone : ajoute {appName()} à l’écran d’accueil (Safari → Partager → « Sur l’écran d’accueil », iOS 16.4
        ou plus récent), puis ouvre-la depuis l’icône.
      </p>
    )
  if (subscribed === null) return null
  if (subscribed) return compact ? null : <p className="text-[11px] text-emerald-300">Détections préparées la veille sur ce téléphone.</p>

  return (
    <div className={compact ? 'mt-1 flex flex-col gap-1' : 'flex flex-col gap-1.5'} data-testid="veille-prep">
      <button
        type="button"
        className={compact ? 'btn-ghost self-start px-3 py-1.5 text-xs' : 'btn-primary self-start px-3 py-1.5 text-xs'}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setErr('')
          const e = await enablePush()
          setBusy(false)
          if (e) return setErr(e)
          setSubscribed(true)
          onChange?.(true)
        }}
      >
        {busy ? 'Activation…' : 'Préparer mes détections la veille'}
      </button>
      <span className="text-[11px] text-muted">{VEILLE_EXPLICATION}</span>
      {err && <span className="text-[11px] text-red-300">{err}</span>}
    </div>
  )
}
