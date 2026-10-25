import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { alive, db, type Player, type Rewatch } from './db'
import { staffMeasured, toSights, type Sight } from './coverage'
import { keptMemo } from './keptMemo'
import { sharedQuery, useShared } from './live'
import { loadAllMeasures, loadPlayerRows, usePlayerRows } from './playersCache'
import { scoutId } from './scouting'
import { preloadMapShapes } from './components/FranceMap'

/*
 * Données du bilan de détection (src/pages/Coverage.tsx, /bilan) gardées en mémoire pour toute l'appli (src/live.ts
 * sharedQuery, `keep`), comme la liste Joueurs (src/playersCache.ts) : lues une fois, relues 300 ms après un changement
 * des tables (une seule fois pour un paquet de la synchro) ; revenir sur le bilan (retour d'une fiche, menu, autre page)
 * l'affiche sans rien relire. Mesuré par tools/bench-page-bilan.mjs (40 000 fiches fictives, ~116 000 mesures,
 * ~28 000 « vu », téléphone simulé) : chaque ouverture relisait toute la base (fiches, « vu », avis, toutes les mesures)
 * et refaisait tous les calculs.
 *
 *  - fiches : celles de la liste Joueurs (une seule lecture et une seule copie pour les deux écrans) ;
 *  - passages (« vu » et avis, src/coverage.ts toSights) : leur propre lecture ; « à revoir » à part (un « à revoir »
 *    coché ne refait pas les passages, ni donc la carte) ;
 *  - joueurs mesurés par le staff (onglets des administrateurs) : sur toutes les mesures, lues par paquets (le fil principal
 *    respire entre deux) une seule fois pour l'appli (src/playersCache.ts loadAllMeasures : les profils recherchés, calculés
 *    au démarrage, les lisent aussi).
 *
 * « Voir comme… » recharge l'appli (src/spy.ts) : rien de ce qui est gardé ici ne passe d'une identité à l'autre.
 */

const DELAY = 300

/** Passages (« vu » et avis) ; `me` : le compte pour qui « toi » a été écrit (relu s'il change). */
const sightsStore = sharedQuery(
  ['seen', 'evaluations', 'events'],
  async () => {
    const me = scoutId()
    const [seen, evals, events] = await Promise.all([db.seen.toArray(), db.evaluations.toArray(), db.events.toArray()])
    const sights = toSights(seen, evals, {
      deadEvents: new Set(events.filter((e) => !!e.deleted).map((e) => e.id)),
      nameOfSeen: (s) => {
        const row = s as (typeof seen)[number]
        const mine = !!me && (row.createdBy ? row.createdBy === me : row.id.startsWith(`${me}:`))
        return mine ? 'toi' : row.createdByName
      },
    })
    return { me, sights }
  },
  DELAY,
  true,
)

/** « À revoir » de chaque joueur (non supprimés). */
const rewatchStore = sharedQuery(
  ['rewatch'],
  async () => {
    const rw = new Map<string, Rewatch[]>()
    for (const r of alive(await db.rewatch.toArray())) rw.set(r.playerId, [...(rw.get(r.playerId) ?? []), r])
    return rw
  },
  DELAY,
  true,
)

/** Joueurs mesurés par le staff et dernière taille connue (src/coverage.ts staffMeasured), sur toutes les mesures. */
const staffStore = sharedQuery(['measurements'], async () => staffMeasured(await loadAllMeasures()), DELAY, true)

export type CoverageData = { players: Player[]; sights: Sight[]; rewatch: Map<string, Rewatch[]> }

/** Derniers objets rendus : mêmes morceaux, même objet (les calculs gardés, src/keptMemo.ts, le reconnaissent). */
let lastData: CoverageData | undefined

/**
 * Fiches (non supprimées, ordre de la clé primaire), passages et « à revoir » ; undefined pendant la 1re lecture. Mêmes
 * données que l'ancienne lecture directe (`db.players.toArray()` : les fiches supprimées n'y comptaient déjà pas, toutes
 * les vues du bilan passent par livePlayers).
 */
export function useCoverageData(): CoverageData | undefined {
  const players = usePlayerRows()
  const s = useShared(sightsStore)
  const rewatch = useShared(rewatchStore)
  const me = scoutId()
  // Autre compte depuis la lecture (connexion) : « toi » n'est plus le même, passages relus.
  useEffect(() => {
    if (s && s.me !== me) sightsStore.refresh()
  }, [s, me])
  return useMemo(() => {
    if (!players || !s || s.me !== me || !rewatch) return undefined
    if (lastData && lastData.players === players && lastData.sights === s.sights && lastData.rewatch === rewatch) return lastData
    return (lastData = { players, sights: s.sights, rewatch })
  }, [players, s, me, rewatch])
}

const noSubscribe = () => () => {}
const nothing = () => undefined

/** Joueurs mesurés par le staff (lus seulement pour qui voit les onglets des administrateurs : `enabled`). */
export function useStaffMeasured(enabled: boolean) {
  return useSyncExternalStore(enabled ? staffStore.subscribe : noSubscribe, enabled ? staffStore.get : nothing)
}

/** Calculs du bilan (carte, générations, clubs, chiffres clés), gardés pour toute l'appli : src/keptMemo.ts. */
export const coverageKept = keptMemo(6)

/**
 * Préparation du bilan pendant que l'appli ne fait rien (requestIdleCallback), quelques secondes après son ouverture :
 * fiches, passages, « à revoir » et, pour qui voit les onglets des administrateurs (`national`), joueurs mesurés par le
 * staff, lus et gardés, et les contours de la carte ; le premier passage sur le bilan n'a plus qu'à calculer. Rien n'est lu si l'appli est quittée
 * avant (la fonction rendue annule).
 */
export function warmCoverage(national: boolean, after = WARM_AFTER): () => void {
  const idle = (f: () => void) =>
    typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(f, { timeout: 5000 }) : window.setTimeout(f, 0)
  let job: number | undefined
  const timer = window.setTimeout(() => {
    job = idle(() => {
      void loadPlayerRows().catch(() => {})
      void sightsStore.load().catch(() => {})
      void rewatchStore.load().catch(() => {})
      if (national) void staffStore.load().catch(() => {})
      void preloadMapShapes().catch(() => {})
    })
  }, after)
  return () => {
    window.clearTimeout(timer)
    if (job !== undefined) (typeof window.cancelIdleCallback === 'function' ? window.cancelIdleCallback : window.clearTimeout)(job)
  }
}
const WARM_AFTER = 3000
