import { niveauCharge, presenceHooks, registreActif, supabase } from './sync'
import { delaiReponsePresence, delaiSigneDeVie, doitRepondrePresence } from './charge'

/*
 * « L'appli est ouverte » (supabase/030_connexions.sql) : un signe de vie tant que l'appli est affichée et en ligne. Les
 * administrateurs voient ainsi qui est connecté et quand (Réglages → Utilisateurs : point vert « connecté en ce moment »,
 * dernière connexion, journal des connexions de chaque membre).
 * Pas de canal temps réel de présence : il montrerait à tout le staff qui est en ligne (et coûterait à Realtime un message
 * par arrivée et par départ, multiplié par les milliers d'abonnés du canal du staff).
 *
 * SANS REQUÊTE À PART (supabase/061 ; série 10 du 30/10 : hb_ping toutes les 30 s faisait 58 % des requêtes HTTP à 10 000
 * personnes, chacune traversant Envoy et PostgREST) :
 *  - le signe de vie part avec « quoi de neuf ? » (hb_registre_depuis, toutes les 5 minutes et à chaque retour sur l'appli,
 *    src/sync.ts) : la session de cette ouverture et le type d'appareil, comme hb_ping, seulement quand l'appli est affichée ;
 *  - hb_ping à part seulement s'il n'est pas parti depuis 10 min (20, 30 en charge : CHARGE_REGLES.signeDeVieRegistreMs) ;
 *  - « connecté en ce moment » reste juste : quand un administrateur affiche l'écran Membres, son appli envoie « qui est
 *    là ? » sur le canal du staff toutes les 45 s (src/components/Members.tsx) ; chaque appareil affiché répond par hb_ping
 *    après 0 à 10 s au hasard, s'il n'a pas donné signe de vie depuis 30 s et si le serveur est calme
 *    (src/charge.ts, doitRepondrePresence). Personne ne regarde : aucune requête.
 *  - Serveur sans 061 : toutes les 30 s (60 s chargé, 120 s saturé), comme avant.
 * Journal des connexions : la fin d'une session est connue à 5 minutes près (au lieu de 30 s).
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
/** Dernier signe de vie parti (hb_ping, ou avec « quoi de neuf ? »). */
let dernier = 0
/** Réponse à « qui est là ? » déjà prévue. */
let reponse: ReturnType<typeof setTimeout> | undefined

/** Type d'appareil, sans plus de détail. */
function device() {
  const ua = navigator.userAgent
  const kind = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone|iPod/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : 'Ordinateur'
  const installed = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return installed ? `${kind} (appli installée)` : kind
}

const visible = () => document.visibilityState === 'visible'

async function ping() {
  if (!supabase || stopped || !navigator.onLine || !visible()) return
  const { data } = await supabase.auth.getSession()
  if (!data.session) return
  dernier = Date.now()
  const { error } = await supabase.rpc('hb_ping', { p_session: SESSION, p_device: device() })
  // Serveur sans 030 : on n'insiste pas. Autres erreurs : ignorées (prochain essai au tour suivant).
  if (error?.code === 'PGRST202') stopped = true
}

/** À appeler une fois au démarrage (rien en mode local, sans serveur). */
export function startPresence() {
  if (!supabase) return
  // Branchements de src/sync.ts : la session part avec « quoi de neuf ? » (appli affichée et en ligne seulement).
  presenceHooks.session = () => (!stopped && navigator.onLine && visible() ? { id: SESSION, device: device() } : null)
  presenceHooks.noted = (at) => {
    dernier = Math.max(dernier, at)
  }
  presenceHooks.demande = () => {
    if (reponse !== undefined || !doitRepondrePresence(Date.now(), dernier, niveauCharge(), visible())) return
    reponse = setTimeout(() => {
      reponse = undefined
      // (Signe de vie parti entre-temps avec « quoi de neuf ? » : déjà « en ligne ».)
      if (doitRepondrePresence(Date.now(), dernier, niveauCharge(), visible())) void ping()
    }, delaiReponsePresence())
  }
  // Démarrage avec un compte, ou connexion : le signe de vie part avec la première synchronisation (061) ; sinon (serveur sans
  // 061, ou pas encore de réponse) 10 s après (callback différé, comme dans sync.ts).
  dernier = Date.now()
  supabase.auth.onAuthStateChange((e, s) => s && (e === 'INITIAL_SESSION' || e === 'SIGNED_IN') && setTimeout(() => !registreActif() && void ping(), 10_000))
  // Toutes les 10 s : signe de vie à part seulement s'il n'est pas parti depuis le délai du moment (30 s au calme sans 061 ;
  // 10 min avec 061, le signe de vie partant avec « quoi de neuf ? »).
  setInterval(() => {
    if (Date.now() - dernier >= delaiSigneDeVie(niveauCharge(), undefined, registreActif())) void ping()
  }, 10_000)
  // Retour sur l'appli : sans 061, tout de suite ; avec 061, la synchronisation du retour (src/sync.ts) l'emporte.
  const reprise = () => !registreActif() && void ping()
  document.addEventListener('visibilitychange', reprise)
  window.addEventListener('online', reprise)
}
