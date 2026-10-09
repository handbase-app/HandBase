import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, type BaseTickContentProps } from 'recharts'
import { themeColor } from '../theme'
import { useWidth } from '../layout'

/*
 * Radar de la comparaison de deux joueurs : deux formes translucides superposées. Chargé à la demande
 * (recharts), comme le radar des avis. `focus` met un joueur en avant et estompe l'autre.
 */
export default function CompareRadar({
  data,
  colors,
  focus,
}: {
  data: { label: string; a: number; b: number }[]
  colors: [string, string]
  focus: 'a' | 'b' | null
}) {
  const style = (k: 'a' | 'b') =>
    focus === null
      ? { fillOpacity: 0.22, strokeOpacity: 1, strokeWidth: 2 }
      : focus === k
        ? { fillOpacity: 0.38, strokeOpacity: 1, strokeWidth: 2.5 }
        : { fillOpacity: 0.03, strokeOpacity: 0.25, strokeWidth: 1 }
  // Joueur mis en avant dessiné en dernier (au-dessus).
  const order: ('a' | 'b')[] = focus === 'a' ? ['b', 'a'] : ['a', 'b']
  // Libellés raccourcis s'ils sortiraient du cadre (le tableau les donne en entier).
  const [ref, w] = useWidth<HTMLDivElement>()
  const narrow = w > 0 && w < 520
  const tick = ({ x: tx, y, payload, textAnchor }: BaseTickContentProps) => {
    const x = Number(tx)
    const room = textAnchor === 'start' ? w - x : textAnchor === 'end' ? x : w
    const max = Math.max(6, Math.floor((room - 6) / 5.6))
    const v = String(payload.value)
    return (
      <text x={x} y={y} textAnchor={textAnchor} dominantBaseline="central" fill={themeColor('muted')} fontSize={9}>
        {v.length > max ? v.slice(0, max - 1).trimEnd() + '…' : v}
        <title>{v}</title>
      </text>
    )
  }
  return (
    <div ref={ref} className="h-72 sm:h-80">
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius={narrow ? '58%' : '64%'} margin={{ left: 4, right: 4, top: 4, bottom: 4 }}>
          <PolarGrid stroke={themeColor('line')} />
          <PolarAngleAxis dataKey="label" tick={w ? tick : false} />
          <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={false} axisLine={false} />
          {order.map((k) => (
            <Radar key={k} dataKey={k} stroke={colors[k === 'a' ? 0 : 1]} fill={colors[k === 'a' ? 0 : 1]} isAnimationActive={false} {...style(k)} />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
