import { useMemo } from 'react'
import type { Criterion } from '../db'
import { categoryStyles } from '../radarZones'
import ZoneRadar from './ZoneRadar'

/*
 * Radar des avis : moyenne (polygone coloré par zone, src/radarZones.ts) et un contour par observateur.
 * À part pour être chargé à la demande.
 */
export default function OpinionsRadar({
  rows,
  observers,
  colors,
  compact,
  large,
}: {
  /** Critères notés : moyenne, et moyenne de chaque observateur (dans l'ordre de `observers`). */
  rows: { c: Criterion; avg?: number | null; nums?: (number | null)[] }[]
  observers: string[]
  colors: string[]
  compact?: boolean
  /** Colonne large (avis à côté de la liste, ordinateur) : radar plus grand, libellés lisibles, sans dépasser l'écran. */
  large?: boolean
}) {
  const axes = useMemo(() => rows.map((r) => ({ id: r.c.id, label: r.c.label, category: r.c.category })), [rows])
  const styles = useMemo(() => categoryStyles(rows.map((r) => r.c)), [rows])
  return (
    <ZoneRadar
      axes={axes}
      styles={styles}
      size={large ? 'large' : compact ? 'compact' : 'normal'}
      series={[
        ...observers.map((o, i) => ({ key: `o${i}`, name: o, values: rows.map((r) => r.nums?.[i]), mode: 'line' as const, color: colors[i], strokeOpacity: 0.85 })),
        { key: 'moyenne', name: 'Moyenne', values: rows.map((r) => r.avg), mode: 'zones' as const },
      ]}
      legend={[{ name: 'Moyenne', color: 'var(--color-fg)', line: true }, ...observers.map((o, i) => ({ name: o, color: colors[i], line: true }))]}
    />
  )
}
