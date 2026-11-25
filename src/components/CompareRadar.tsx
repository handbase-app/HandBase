import { useMemo } from 'react'
import type { Criterion } from '../db'
import { categoryStyles } from '../radarZones'
import ZoneRadar from './ZoneRadar'

/*
 * Radar de la comparaison de deux ou trois joueurs : une forme translucide par joueur (sa couleur), superposées,
 * sur le radar par zones (fond des secteurs et légende aux couleurs des catégories, src/radarZones.ts).
 * Chargé à la demande. `focus` (indice d'un joueur) le met en avant et estompe les autres.
 * Chaque ligne porte une valeur par joueur (`v`, dans l'ordre des joueurs). `view` : radar complet ou un radar par
 * catégorie (onglets de la comparaison) ; `names` : noms des joueurs (légende sous les radars par catégorie, bulles).
 */
export default function CompareRadar({
  rows,
  colors,
  focus,
  view,
  names,
}: {
  rows: { c: Criterion; v: (number | null)[] }[]
  colors: string[]
  focus: number | null
  view?: 'full' | 'split'
  names?: string[]
}) {
  const style = (k: number) =>
    focus === null
      ? { fillOpacity: colors.length > 2 ? 0.16 : 0.22, strokeOpacity: 1, strokeWidth: 2 }
      : focus === k
        ? { fillOpacity: 0.38, strokeOpacity: 1, strokeWidth: 2.5 }
        : { fillOpacity: 0.03, strokeOpacity: 0.25, strokeWidth: 1 }
  // Joueur mis en avant dessiné en dernier (au-dessus).
  const order = colors.map((_, i) => i).sort((x, y) => Number(x === focus) - Number(y === focus))
  const axes = useMemo(() => rows.map((r) => ({ id: r.c.id, label: r.c.label, category: r.c.category })), [rows])
  const styles = useMemo(() => categoryStyles(rows.map((r) => r.c)), [rows])
  return (
    <ZoneRadar
      axes={axes}
      styles={styles}
      view={view}
      // Légende des joueurs sous les radars par catégorie (vue complète : les pastilles au-dessus suffisent, et la légende
      // y est celle des catégories).
      legend={view === 'split' ? names?.map((name, k) => ({ name, color: colors[k] })) : undefined}
      series={order.map((k) => ({ key: `v${k}`, name: names?.[k] ?? `Joueur ${k + 1}`, values: rows.map((r) => r.v[k]), mode: 'fill' as const, color: colors[k], ...style(k) }))}
    />
  )
}
