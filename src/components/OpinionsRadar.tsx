import { useMemo } from 'react'
import type { Criterion } from '../db'
import { categoryStyles } from '../radarZones'
import ZoneRadar from './ZoneRadar'

/*
 * Radar des avis : moyenne (polygone coloré par zone, src/radarZones.ts) et, à la demande (œil sur la carte de
 * l'avis dans « Détail des avis »), le contour d'un observateur dans sa couleur.
 * À part pour être chargé à la demande.
 */
export default function OpinionsRadar({
  rows,
  observers,
  colors,
  shown,
  compact,
  large,
}: {
  /** Critères notés : moyenne, et moyenne de chaque observateur (dans l'ordre de `observers`). */
  rows: { c: Criterion; avg?: number | null; nums?: (number | null)[] }[]
  observers: string[]
  colors: string[]
  /** Observateurs dont la courbe est affichée (par défaut : aucun, seulement la moyenne). */
  shown?: ReadonlySet<string>
  compact?: boolean
  /** Colonne large (avis à côté de la liste, ordinateur) : radar plus grand, libellés lisibles, sans dépasser l'écran. */
  large?: boolean
}) {
  const axes = useMemo(() => rows.map((r) => ({ id: r.c.id, label: r.c.label, category: r.c.category })), [rows])
  const styles = useMemo(() => categoryStyles(rows.map((r) => r.c)), [rows])
  // Un seul observateur : la moyenne est son avis, pas de courbe en plus.
  const visible = observers.map((o, i) => ({ o, i })).filter(({ o }) => observers.length > 1 && !!shown?.has(o))
  return (
    <ZoneRadar
      axes={axes}
      styles={styles}
      size={large ? 'large' : compact ? 'compact' : 'normal'}
      series={[
        { key: 'moyenne', name: 'Moyenne', values: rows.map((r) => r.avg), mode: 'zones' as const },
        // Courbes choisies par-dessus la moyenne, trait seul, pour rester lisibles.
        ...visible.map(({ o, i }) => ({ key: `o${i}`, name: o, values: rows.map((r) => r.nums?.[i]), mode: 'line' as const, color: colors[i], strokeWidth: 2 })),
      ]}
      legend={[{ name: 'Moyenne', color: 'var(--color-fg)', line: true }, ...visible.map(({ o, i }) => ({ name: o, color: colors[i], line: true }))]}
    />
  )
}
