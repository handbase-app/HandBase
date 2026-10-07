import { supabase } from './sync'

/*
 * « L'appli est ouverte » (supabase/030_connexions.sql) : un signe de vie toutes les 30 s tant que l'appli est
 * affichée et en ligne. Les administrateurs voient ainsi qui est connecté et quand (Réglages → Équipe).
 * Pas de canal temps réel : il montrerait à tout le staff qui est en ligne.
 */

/** Identifiant de cette ouverture de l'appli (randomUUID n'existe pas hors https, ex. test en réseau local). */
const SESSION = window.isSecureContext
  ? crypto.randomUUID()
  : (() => {
      const b = crypto.getRandomValues(new Uint8Array(16))
      b[6] = (b[6] & 15) | 64 // version 4
      b[8] = (b[8] & 63) | 128
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    })()

let stopped = false

/** Type d'appareil, sans plus de détail. */
function device() {
  const ua = navigator.userAgent
  const kind = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone|iPod/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'Ordinateur'
  const installed = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return installed ? `${kind} (appli installée)` : kind
}

async function ping() {
  if (!supabase || stopped || !navigator.onLine || document.visibilityState !== 'visible') return
  const { data } = await supabase.auth.getSession()
  if (!data.session) return
  const { error } = await supabase.rpc('hb_ping', { p_session: SESSION, p_device: device() })
  // Serveur sans 030 : on n'insiste pas. Autres erreurs : ignorées (prochain essai dans 30 s).
  if (error?.code === 'PGRST202') stopped = true
}

/** À appeler une fois au démarrage (rien en mode local, sans serveur). */
export function startPresence() {
  if (!supabase) return
  // Démarrage avec un compte, ou connexion : tout de suite (callback différé, comme dans sync.ts).
  supabase.auth.onAuthStateChange((e, s) => s && (e === 'INITIAL_SESSION' || e === 'SIGNED_IN') && setTimeout(() => void ping(), 0))
  setInterval(() => void ping(), 30_000)
  document.addEventListener('visibilitychange', () => void ping())
  window.addEventListener('online', () => void ping())
}
