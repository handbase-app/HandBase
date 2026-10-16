import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { alive, db, type Assignment, type ConfigItem, type Level, type Unit } from './db'
import { perimeterOf, type Perimeter } from './perimeter'
import { currentUserId, useRole } from './roles'
import { applySportConfig, currentSport, resolveSportConfig, type SportConfig } from './sportConfig'
import { sortLevels } from './structureTree'

/*
 * Configuration de l'installation (supabase/044_structure.sql) : sport et postes (table hb_config, src/sportConfig.ts),
 * structure (niveaux, unités, affectations ; src/structureTree.ts).
 *
 * La configuration est lue en continu dans la base locale : à chaque changement, POSITIONS (src/sportConfig.ts) est mis à
 * jour sur place et les écrans abonnés (useSportConfig, appelé par l'App) se redessinent. Table vide : handball.
 */

const listeners = new Set<() => void>()
liveQuery(() => db.config.toArray()).subscribe({
  next: (rows: ConfigItem[]) => {
    if (applySportConfig(resolveSportConfig(rows))) listeners.forEach((l) => l())
  },
  error: () => {
    /* base locale indisponible : on garde les valeurs par défaut */
  },
})

/** Configuration du sport en cours ; redessine le composant quand elle change. */
export function useSportConfig(): SportConfig {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return currentSport()
}

/** Lignes brutes de la configuration (écran Structure). */
export const useConfigRows = () => useLiveQuery(() => db.config.toArray().then(alive), [], [] as ConfigItem[])

/** Niveaux, dans l'ordre. */
export const useLevels = () => useLiveQuery(() => db.levels.toArray().then((ls) => sortLevels(ls)), [], [] as Level[])
/** Unités (non supprimées). */
export const useUnits = () => useLiveQuery(() => db.units.toArray().then(alive), [], [] as Unit[])
/** Affectations (non supprimées). */
export const useAssignments = () => useLiveQuery(() => db.assignments.toArray().then(alive), [], [] as Assignment[])

/**
 * Périmètre du compte (supabase/046_perimetre.sql, règle dans src/perimeter.ts), calculé sur la structure de l'appareil :
 * affichage (« Ton périmètre : … »), bilan ouvert dessus, zones grisées. Le serveur, lui, filtre les données ; l'appareil ne
 * fait que le montrer. « Voir comme… » : celui du membre simulé. undefined pendant le chargement.
 */
export function usePerimeter(): Perimeter | undefined {
  const role = useRole()
  const uid = currentUserId()
  const data = useLiveQuery(async () => ({ units: await db.units.toArray(), levels: await db.levels.toArray(), assignments: await db.assignments.toArray() }), [])
  return useMemo(() => (data ? perimeterOf({ userId: uid, admin: role === 'admin', ...data }) : undefined), [data, uid, role])
}
