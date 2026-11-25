import { useMemo } from 'react'
import { allDepts, officialRegions, regionOfDept, useDepartments, useRegions } from './lists'
import type { Places } from './voiceFilters'

/**
 * Régions et départements connus de l'appli, pour retrouver un lieu dit à la recherche vocale (bilan, groupes) ; jamais
 * envoyés au modèle. `extra` : numéros de départements en plus (ceux des joueurs, des groupes).
 */
export function useVoicePlaces(extra: string[] = []): Places {
  const regionList = useRegions()
  const deptList = useDepartments()
  const key = extra.join('|')
  return useMemo(() => {
    const regions = regionList.length ? regionList.map((r) => ({ id: r.id, name: r.name })) : officialRegions()
    const names = new Map(deptList.map((d) => [d.code!, d.name]))
    const codes = [...new Set([...allDepts(), ...deptList.map((d) => d.code!), ...extra])]
    return { regions, depts: codes.map((code) => ({ code, name: names.get(code) })), regionOfDept }
  }, [regionList, deptList, key]) // eslint-disable-line react-hooks/exhaustive-deps
}
