import { useEffect } from 'react'
import { useRole } from './roles'
import { supabase, syncNow } from './sync'

/*
 * Expiration des données personnelles (supabase/012_expiration_rgpd.sql) : fiche proposée jamais
 * traitée effacée 12 mois après sa création ; référents d'une fiche hors cadre effacés 12 mois après
 * la décision. Le serveur s'en charge chaque nuit (pg_cron) ; à défaut, l'appli d'un administrateur
 * la lance une fois par jour (sans effet s'il n'y a rien d'expiré).
 */

export const EXPIRY_MONTHS = 12

/** Date d'expiration (12 mois après `iso`), au format AAAA-MM-JJ. */
export function expiryDate(iso?: string) {
  if (!iso) return undefined
  const d = new Date(iso)
  if (isNaN(d.getTime())) return undefined
  d.setMonth(d.getMonth() + EXPIRY_MONTHS)
  return d.toISOString().slice(0, 10)
}

const LAST_KEY = 'handbase.lastPurge'
const DAY = 24 * 3600 * 1000
/** Une seule demande à la fois (les effets React peuvent être rejoués). */
let running = false

/** Lance l'expiration au plus une fois par jour, depuis l'appli d'un administrateur en ligne. */
export function useDailyPurge() {
  const role = useRole()
  useEffect(() => {
    if (!supabase || role !== 'admin' || !navigator.onLine || running) return
    let last = 0
    try {
      last = Number(localStorage.getItem(LAST_KEY) ?? 0)
    } catch {
      /* stockage indisponible */
    }
    if (Date.now() - last < DAY) return
    running = true
    void supabase.rpc('hb_purge_expired').then(({ data, error }) => {
      running = false
      if (error) return // migration pas encore passée, ou hors ligne : on réessaiera
      try {
        localStorage.setItem(LAST_KEY, String(Date.now()))
      } catch {
        /* stockage indisponible */
      }
      const r = data as { fiches?: number; referents?: number } | null
      if (r && (r.fiches || r.referents)) void syncNow()
    })
  }, [role])
}
