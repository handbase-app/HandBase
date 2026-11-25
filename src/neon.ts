/*
 * Néon de l'appli : liseré + halo de la capsule « Nextar » de l'en-tête et du bouton « Avis vocal », pastille micro, notes
 * proposées par l'avis vocal, étiquette « proposé ». Il s'accorde au thème (src/theme.ts : Nuit, Océan, Charbon, Clair,
 * Sable, Ciel) ou au style de l'installation (src/uiStyle.ts : Sport, Officiel, Salle — le style l'emporte, comme pour les
 * autres couleurs). Aucun réglage pour l'utilisateur. La marque (icône de l'appli, écran d'ouverture, connexion) garde
 * toujours la menthe #89F7B3 → #61D0D1 : elle n'utilise pas ces variables.
 *
 * Variables posées sur <html> (src/theme.ts, applyTheme) ; dégradé, halo et fond « soft » en sont tirés dans src/index.css.
 * Fichier pur : testé par tools/test-capsule-notes.ts (chaque thème et style a son néon, contrastes).
 */

export interface Neon {
  /** Début du dégradé (120°) : le plus lumineux. */
  a: string
  /** Fin du dégradé. */
  b: string
  /** Texte posé sur le néon (note proposée, « proposé », « Tout valider ») : contraste ≥ 4,5 sur a et sur b. */
  ink: string
  /** Néon écrit en texte sur les cartes (« ✦ Proposé : 4 ») : contraste ≥ 4,5 sur le fond des cartes. */
  text: string
}

/** La menthe du logo (thème Nuit, d'origine). */
export const BRAND_NEON: Neon = { a: '#89f7b3', b: '#61d0d1', ink: '#0a182d', text: '#89f7b3' }

/** Variables CSS d'un néon. */
export const neonVars = (n: Neon): Record<string, string> => ({ '--neon-a': n.a, '--neon-b': n.b, '--neon-ink': n.ink, '--neon-text': n.text })
