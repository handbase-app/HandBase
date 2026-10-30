/*
 * Écran d'ouverture (logo animé au démarrage de l'appli) : quand entrer dans l'appli. Fichier pur (ni DOM ni React),
 * testé par tools/test-ouverture.ts ; l'affichage est dans index.html (posé avant tout script) et src/splashScreen.ts.
 *
 * Règles :
 *  - au moins MIN_MS (le temps de l'animation), puis on entre dès que la synchro est à jour ;
 *  - tant que la synchro avance on reste ; plus rien depuis STALL_MS → on entre (la synchro continue derrière) ;
 *  - pas de synchro possible (pas de serveur, hors ligne, erreur) → on entre à la fin de l'animation ;
 *  - plafond MAX_MS ;
 *  - pas connecté : animation courte (LOGIN_MIN_MS) puis l'écran de connexion ;
 *  - tout premier chargement (appareil vide) : on reste avec la vraie progression jusqu'à la PREMIÈRE PAGE DE JOUEURS reçue
 *    (réglages et structure arrivent avant, src/syncLive.ts, PULL_ORDER), puis on entre (au plus tôt à la fin de
 *    l'animation) : le reste arrive derrière, avec la barre discrète sous l'en-tête (src/components/SyncProgress.tsx).
 *    Bouton « Entrer quand même » après BUTTON_MS, entrée automatique à la fin (ou si la synchro devient impossible : hors
 *    ligne, l'appli s'ouvre sur ce qu'a l'appareil, comme avant). POURQUOI : à 10 000 ouvertures simultanées (série 6 du
 *    29/10), un premier chargement complet pouvait attendre plusieurs minutes ; l'appli est utile dès les joueurs reçus ;
 *  - toucher / clic / Entrée / Échap : on passe (sauf pendant le premier chargement, où c'est le bouton).
 */
import { BUSY_LABEL, progressLabel, type SyncProgress } from './syncProgress'

export const MIN_MS = 2800
export const STALL_MS = 2500
export const MAX_MS = 8000
export const LOGIN_MIN_MS = 2000
export const BUTTON_MS = 10_000

/**
 * Où en est la synchro : none = impossible (pas de serveur, hors ligne, erreur) ; login = pas connecté ;
 * pending = pas encore finie (en attente de session, envoi, réception) ; done = première synchro terminée.
 */
export type SplashSync = 'none' | 'login' | 'pending' | 'done'

export interface SplashInput {
  /** Temps écoulé depuis le début de l'ouverture (ms). */
  elapsed: number
  /** Instant (même origine) du dernier signe de vie de la synchro : changement d'état ou d'avancement. */
  lastActivity: number
  sync: SplashSync
  /** Appareil vide au lancement : premier chargement. */
  firstLoad: boolean
  /** Toucher, clic, Entrée ou Échap. */
  skipped?: boolean
  /** Bouton « Entrer quand même ». */
  forced?: boolean
  /** Première page de joueurs reçue (premier chargement : on peut entrer, le reste arrive derrière). */
  playersReady?: boolean
}

export interface SplashDecision {
  enter: boolean
  /** Bouton « Entrer quand même » visible. */
  button: boolean
  /** On entre avant la fin de la synchro : la pastille clignote une fois (les chiffres vont encore bouger). */
  pulse: boolean
  /** Toucher pour passer accepté. */
  skippable: boolean
}

export function splashDecision(i: SplashInput): SplashDecision {
  const pulse = i.sync === 'pending'
  const out = (enter: boolean, extra: Partial<SplashDecision> = {}): SplashDecision => ({ enter, button: false, pulse: enter && pulse, skippable: true, ...extra })
  if (i.sync === 'login') return out(!!i.skipped || !!i.forced || i.elapsed >= LOGIN_MIN_MS)
  // Premier chargement : seule la fin de la synchro (ou son impossibilité) ou le bouton font entrer.
  if (i.firstLoad && i.sync === 'pending') {
    const button = i.elapsed >= BUTTON_MS
    // Joueurs reçus : on entre à la fin de l'animation (la pastille clignote : la synchro continue).
    if (i.playersReady && i.elapsed >= MIN_MS) return out(true, { button, skippable: false })
    return out(button && !!i.forced, { button, skippable: false })
  }
  if (i.skipped || i.forced) return out(true)
  if (i.elapsed < MIN_MS) return out(false)
  if (i.sync !== 'pending') return out(true)
  if (i.elapsed >= MAX_MS) return out(true)
  return out(i.elapsed - i.lastActivity >= STALL_MS)
}

/** Largeur de la barre (0 à 1), null : avancement inconnu (barre « en attente »). */
export function splashBar(sync: SplashSync, p: SyncProgress | null): number | null {
  // À jour, ou rien à attendre (données de l'appareil prêtes) : barre pleine.
  if (sync === 'done' || sync === 'none') return 1
  // Avancement par tables et par pages (src/syncProgress.ts) : rien encore reçu, barre « en attente ».
  if (p && p.share > 0) return Math.min(1, p.share)
  return null
}

/**
 * Texte sous la barre (lu poliment par les lecteurs d'écran). busy : serveur très demandé, une requête attend son tour : le
 * message d'attente (src/syncProgress.ts, BUSY_LABEL) plutôt qu'un compte qui n'avance plus.
 */
export function splashText(sync: SplashSync, p: SyncProgress | null, server: boolean, online: boolean, busy = false): string {
  if (sync === 'login') return ''
  if (sync === 'done') return 'À jour'
  if (sync === 'none') return !server ? 'Données de l’appareil' : online ? 'Synchro impossible : données de l’appareil' : 'Hors ligne : données de l’appareil'
  if (busy) return BUSY_LABEL
  if (p && p.done > 0) return progressLabel(p)
  return 'Synchronisation…'
}
