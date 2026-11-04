import { ask } from './components/Confirm'
import { appName } from './appBrand'
import { db } from './db'
import { syncNow, wipeDevice } from './sync'
import { keptAccounts } from './comptes'

/**
 * « Se déconnecter » (Réglages → Mon compte, et menu de la bulle de profil de l'en-tête) : dernière chance d'envoyer ce
 * qui attend, puis confirmation ; les données de l'appareil sont effacées (elles restent sur le serveur). On prévient
 * s'il reste des modifications pas envoyées. `onBusy` : pendant l'envoi (bouton « Envoi… »).
 */
export async function confirmLogout(onBusy?: (busy: boolean) => void) {
  onBusy?.(true)
  // Dernière chance d'envoyer ce qui attend.
  if (navigator.onLine) await syncNow({ retry: true })
  const pending = new Set((await db.outbox.toArray()).map((i) => `${i.table}:${i.rowId}`)).size
  onBusy?.(false)
  // Comptes de test gardés (« Changer de compte », src/comptes.ts) : ils partent aussi.
  const kept = keptAccounts() ? ' Les autres comptes gardés sur cet appareil (comptes de test) seront aussi déconnectés.' : ''
  const ok = await ask(
    pending
      ? `${pending} modification(s) pas encore envoyée(s) au serveur (hors ligne, ou refusée(s)) seront PERDUES. Pour les garder, reste connecté et synchronise une fois en ligne (voir l’état de la synchronisation).${kept} Se déconnecter quand même ?`
      : `Se déconnecter ? Les données ${appName()} seront effacées de cet appareil ; elles restent sur le serveur et reviendront à la prochaine connexion.${kept}`,
    { ok: pending ? 'Perdre et se déconnecter' : 'Se déconnecter' },
  )
  if (ok) await wipeDevice({ signOut: true })
}
