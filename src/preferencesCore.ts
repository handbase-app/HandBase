/*
 * PRÉFÉRENCES LIÉES AU COMPTE (Geoffroy, 09/11/2026 : « lie les couleurs et le filtre garçons / filles ») : le thème de
 * couleurs (Auto, Nuit, Océan…), le style choisi pour soi (ou celui de l'installation) et le filtre Garçons / Filles des
 * listes de joueurs. Mêmes sur tous les appareils d'un compte, comme les pictogrammes (src/affichage.ts).
 * Partie pure (testée par tools/test-preferences.ts) ; l'envoi et la lecture sont dans src/preferences.ts.
 */

export type SexPref = 'all' | 'M' | 'F'
export type Preferences = { theme: string; style: string | null; sexe: SexPref }

/** Clés de l'appareil (les mêmes qu'avant : rien ne se perd). */
export const PREF_STORAGE = { theme: 'handbase.theme', style: 'handbase.style', sexe: 'handbase.sexFilter' } as const

export const DEFAULT_PREFERENCES: Preferences = { theme: 'auto', style: null, sexe: 'all' }

const SEXES: readonly SexPref[] = ['all', 'M', 'F']

/**
 * Valeur lue sur le compte (hb_profiles.preferences) : null si rien d'utilisable. Clé absente ou inconnue (thème retiré
 * de l'appli, style disparu) : valeur par défaut pour cette clé seulement.
 */
export function parsePreferences(v: unknown, known: { themes: readonly string[]; styles: readonly string[] }): Preferences | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (!('theme' in o) && !('style' in o) && !('sexe' in o)) return null
  return {
    theme: typeof o.theme === 'string' && known.themes.includes(o.theme) ? o.theme : DEFAULT_PREFERENCES.theme,
    style: typeof o.style === 'string' && known.styles.includes(o.style) ? o.style : null,
    sexe: typeof o.sexe === 'string' && (SEXES as readonly string[]).includes(o.sexe) ? (o.sexe as SexPref) : 'all',
  }
}

/** Ce qui part au serveur (hb_set_preferences) : les trois clés, ordre fixe. */
export const preferencesPayload = (p: Preferences): Preferences => ({ theme: p.theme, style: p.style, sexe: p.sexe })

export const samePreferences = (a: Preferences, b: Preferences) => JSON.stringify(preferencesPayload(a)) === JSON.stringify(preferencesPayload(b))

/** Filtre Garçons / Filles tel qu'il est gardé sur l'appareil (toute autre valeur : tous). */
export const parseSex = (raw: string | null): SexPref => (raw === 'M' || raw === 'F' ? raw : 'all')
