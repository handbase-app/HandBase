import { onPrefsChanged } from './prefsBus'
import { parsePreferences, parseSex, PREF_STORAGE, preferencesPayload, samePreferences, type Preferences } from './preferencesCore'
import { spyTarget } from './spy'
import { supabase } from './sync'
import { AUTO, readPersonalStyle, readThemeChoice, setPersonalStyle, setThemeChoice, THEMES } from './theme'
import { STYLES, type StyleId } from './uiStyle'

/*
 * Préférences liées au compte (src/preferencesCore.ts) : thème de couleurs, style personnel, filtre Garçons / Filles.
 * Même mécanisme que l'affichage des listes (src/affichage.ts) :
 * - Appareil : localStorage, comme avant (« handbase.theme », « handbase.style », « handbase.sexFilter ») : marche hors ligne
 *   et avant la connexion, posé avant le premier affichage.
 * - Compte : hb_profiles.preferences (supabase/075_preferences.sql), lu avec le rôle à la connexion (src/roles.ts). S'il y a
 *   une valeur, elle gagne ; sinon celle de l'appareil y est envoyée une fois. Chaque changement part 1,5 s après le dernier
 *   (un seul appel, hb_set_preferences), en ligne et connecté seulement ; hors ligne, au retour du réseau.
 *   Pas d'envoi pendant « Voir comme… », ni sans serveur (essai, démonstration : appareil seul), ni avant 075 (colonne
 *   absente : chaque appareil garde ses choix, comme avant).
 */

const known = { themes: [AUTO, ...THEMES.map((t) => t.id)], styles: STYLES.map((s) => s.id as string) }

function readSexStored() {
  try {
    return parseSex(localStorage.getItem(PREF_STORAGE.sexe))
  } catch {
    return 'all' as const
  }
}

const current = (): Preferences => ({ theme: readThemeChoice(), style: readPersonalStyle(), sexe: readSexStored() })

/** Valeur du compte posée sur l'appareil (sans la renvoyer). */
let applying = false
function applyHere(v: Preferences) {
  const now = current()
  applying = true
  try {
    if (v.theme !== now.theme) setThemeChoice(v.theme)
    if (v.style !== now.style) setPersonalStyle(v.style as StyleId | null)
    if (v.sexe !== now.sexe)
      try {
        localStorage.setItem(PREF_STORAGE.sexe, v.sexe)
      } catch {
        /* stockage indisponible */
      }
  } finally {
    applying = false
  }
}

/** Compte dont la valeur a été lue (colonne présente) ; null : pas d'envoi. */
let account: string | null = null
let dirty = false
let timer: ReturnType<typeof setTimeout> | undefined
const DELAY = 1500

function schedule() {
  if (!supabase || applying) return
  dirty = true
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), DELAY)
}

async function flush() {
  if (!supabase || !dirty || !account || spyTarget()) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return // repris au retour du réseau
  const { data } = await supabase.auth.getSession()
  if (data.session?.user.id !== account) return
  dirty = false
  const { error } = await supabase.rpc('hb_set_preferences', { p: preferencesPayload(current()) })
  // Fonction absente (avant 075) ou refus : l'appareil garde son choix, on ne réessaie qu'au prochain changement.
  if (error && /fetch|network|Failed/i.test(error.message)) dirty = true
}

onPrefsChanged(schedule)
if (typeof window !== 'undefined') window.addEventListener('online', () => void flush())

/**
 * Valeur lue sur le compte à la connexion (src/roles.ts, refreshRole) ; `column` faux : la colonne n'existe pas encore
 * (avant 075), rien n'est envoyé. Valeur présente : elle gagne (sauf un changement de l'appareil pas encore envoyé) ;
 * absente : celle de l'appareil est envoyée une fois.
 */
export function applyAccountPreferences(uid: string, raw: unknown, column = true) {
  account = column ? uid : null
  if (!column) return
  const v = parsePreferences(raw, known)
  if (v && !dirty) {
    if (!samePreferences(v, current())) applyHere(v)
    return
  }
  if (!v || !samePreferences(v, current())) {
    dirty = true
    void flush()
  }
}

/** Déconnexion : plus d'envoi (les choix restent sur l'appareil). */
export function forgetAccountPreferences() {
  account = null
  dirty = false
  clearTimeout(timer)
}
