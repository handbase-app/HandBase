import { Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer } from 'recharts'
import { themeColor } from '../theme'

/*
 * Radar des avis (moyenne et un tracé par observateur), à part pour être chargé à la demande :
 * recharts ne pèse ainsi ni sur la page des événements ni sur la fiche tant que le radar n'est pas affiché.
 */
export default function OpinionsRadar({
  data,
  observers,
  colors,
  compact,
  large,
}: {
  data: Record<string, string | number | null | undefined>[]
  observers: string[]
  colors: string[]
  compact?: boolean
  /** Colonne large (avis à côté de la liste, ordinateur) : radar plus grand, libellés lisibles, sans dépasser l'écran. */
  large?: boolean
}) {
  return (
    <div className={large ? 'mx-auto h-[clamp(22rem,58vh,34rem)] w-full max-w-[46rem]' : compact ? 'h-64' : 'h-80'}>
      <ResponsiveContainer>
        <RadarChart
          data={data}
          outerRadius={large ? '66%' : compact ? '50%' : '58%'}
          margin={large ? { left: 48, right: 48, top: 8, bottom: 4 } : compact ? { left: 4, right: 4, top: 0, bottom: 0 } : { left: 20, right: 20 }}
        >
          <PolarGrid stroke={themeColor('line')} />
          <PolarAngleAxis dataKey="label" tick={{ fill: themeColor('muted'), fontSize: large ? 11 : 9 }} />
          <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={false} axisLine={false} />
          {observers.map((o, i) => (
            <Radar key={o} name={o} dataKey={o} stroke={colors[i]} fill="none" strokeWidth={1.2} strokeOpacity={0.8} />
          ))}
          <Radar name="Moyenne" dataKey="Moyenne" stroke={themeColor('accent')} fill={themeColor('accent')} fillOpacity={0.25} strokeWidth={2.5} />
          <Legend wrapperStyle={{ fontSize: large ? 11 : 10 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
