import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { originFromPath, type RewatchOrigin } from './rewatchCore'

/*
 * OÙ un « à revoir » est posé (src/rewatchCore.ts, supabase/055) : lu AU MOMENT DU CLIC.
 *  - Une liste qui en sait plus que son adresse (liste Joueurs : nom du filtre enregistré ou filtres posés) entoure ses
 *    lignes de <RewatchPlace get={…}> ; `get` est lu au clic (valeur stable : les lignes ne sont pas redessinées quand
 *    les filtres changent).
 *  - Sinon : l'adresse de l'écran (événement, groupe, fiche, bilan, Mes suivis…), relue elle aussi au clic.
 * L'événement ou le groupe d'une ligne (originEventId, groupId) passe avant (pickOrigin).
 */

const PlaceCtx = createContext<(() => RewatchOrigin | undefined) | null>(null)

export function RewatchPlace({ get, children }: { get: () => RewatchOrigin | undefined; children: ReactNode }) {
  return <PlaceCtx.Provider value={get}>{children}</PlaceCtx.Provider>
}

/** Adresse de l'écran dans l'appli (sans la base du site, ex. /HandBase). */
function appPath() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  const p = window.location.pathname
  return base && p.startsWith(base) ? p.slice(base.length) || '/' : p
}

/** Lecture de l'origine de l'écran, à appeler au moment du clic. */
export function useRewatchOrigin(): () => RewatchOrigin | undefined {
  const get = useContext(PlaceCtx)
  return useCallback(() => get?.() ?? originFromPath(appPath()), [get])
}
