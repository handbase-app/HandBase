import { supabase } from './sync'

/*
 * Notifications sur le téléphone (web push, supabase/026_notifications.sql). L'abonnement est propre à
 * chaque appareil ; les préférences (quoi recevoir) sont sur le compte.
 */

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushSupport = 'ok' | 'ios-install' | 'unsupported' | 'not-configured'

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export function pushSupport(): PushSupport {
  if (!supabase || !VAPID) return 'not-configured'
  // iPhone : seulement dans l'appli ajoutée à l'écran d'accueil (iOS 16.4 et plus).
  if (isIos() && !standalone()) return 'ios-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

async function registration() {
  return navigator.serviceWorker.ready
}

/** Abonnement de cet appareil (null s'il n'est pas abonné). */
export async function currentSubscription() {
  if (pushSupport() !== 'ok') return null
  return (await registration()).pushManager.getSubscription()
}

function keyBytes(base64url: string) {
  const s = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

/** Demande l'autorisation, abonne l'appareil et l'enregistre sur le serveur. Renvoie un message d'erreur ou null. */
export async function enablePush(): Promise<string | null> {
  if (pushSupport() !== 'ok') return 'Notifications indisponibles sur cet appareil.'
  if (!navigator.onLine) return 'Il faut être en ligne pour activer les notifications.'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'Autorisation refusée : à changer dans les réglages du téléphone (notifications du site ou de l’appli).'
  const reg = await registration()
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID!) }))
  const json = sub.toJSON()
  const { error } = await supabase!.rpc('hb_push_subscribe', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  })
  return error ? `Enregistrement impossible : ${error.message}` : null
}

/**
 * Réenregistre l'abonnement de cet appareil sur le serveur (sans rien demander) : rattrape un abonnement
 * que le serveur n'a pas reçu (hors ligne, serveur pas prêt…) ou rattaché à un autre compte.
 */
export async function syncSubscription() {
  const sub = await currentSubscription().catch(() => null)
  if (!sub || !navigator.onLine) return !!sub
  const json = sub.toJSON()
  const { error } = await supabase!.rpc('hb_push_subscribe', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  })
  return !error
}

/** Désabonne cet appareil (le serveur l'oublie). */
export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  await supabase?.rpc('hb_push_unsubscribe', { p_endpoint: sub.endpoint })
  await sub.unsubscribe()
}

export const NOTIF_KINDS = [
  { id: 'avis', label: 'Avis à valider', help: 'Avis hors liste sur tes événements, avis spontanés de ton secteur.' },
  { id: 'fiche', label: 'Fiches proposées', help: 'Fiches de joueurs proposées dans ton secteur.' },
  { id: 'participant', label: 'Participant', help: 'On t’ajoute comme participant d’un événement ou d’un groupe.' },
  { id: 'rappel', label: 'Rappel la veille', help: 'La veille de tes événements (organisateur ou participant), vers 18 h.' },
] as const

export async function readNotifPrefs(): Promise<Record<string, boolean | number>> {
  if (!supabase) return {}
  const { data: s } = await supabase.auth.getSession()
  const uid = s.session?.user.id
  if (!uid) return {}
  const { data } = await supabase.from('hb_profiles').select('notif').eq('user_id', uid).maybeSingle()
  return (data?.notif as Record<string, boolean | number> | null) ?? {}
}

export async function saveNotifPrefs(prefs: Record<string, boolean | number>) {
  const { error } = (await supabase?.rpc('hb_set_notif_prefs', { p_prefs: prefs })) ?? {}
  return error ? error.message : null
}

export async function sendTestNotification() {
  const { error } = (await supabase?.rpc('hb_notif_test')) ?? {}
  return error ? error.message : null
}
