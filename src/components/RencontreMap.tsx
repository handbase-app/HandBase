import { geoBounds, geoCircle, geoConicConformal, geoMercator, geoPath, type GeoPermissibleObjects } from 'd3-geo'
import { useMemo, type KeyboardEvent } from 'react'
import { dotRadius, spreadDots } from '../clubMap'
import { youthsText, type LatLng, type Venue } from '../rencontres'
import { useGeo } from './FranceMap'

/*
 * Carte de « Autour de moi » (src/components/AroundMe.tsx) : les contours des départements (les mêmes que la carte du bilan,
 * src/components/FranceMap.tsx : fichier de l'appli, aucune tuile ni requête extérieure), recalés sur le cercle du rayon
 * choisi ; le cercle ; une épingle par salle, d'autant plus grande qu'il y a de jeunes de la liste qui devraient y jouer
 * (salle sans jeune : petit rond creux, seulement quand toutes les rencontres sont montrées). Toucher une épingle ne
 * garde que les rencontres de cette salle dans la liste (la toucher encore : toutes). Largeur de l'écran, sans défilement
 * de côté ; même dessin sur téléphone et sur ordinateur (le cadre garde ses proportions).
 */

const W = 600
const H = 340
const PAD = 16
/** Kilomètres par degré sur le cercle (même Terre que src/rencontres.ts). */
const KM_PER_DEG = 111.195

type Bounds = [[number, number], [number, number]]
const boundsOf = new WeakMap<object, Bounds>()
const bounds = (f: GeoPermissibleObjects) => {
  let b = boundsOf.get(f as object)
  if (!b) boundsOf.set(f as object, (b = geoBounds(f) as Bounds))
  return b
}

export function RencontreMap({
  center,
  km,
  venues,
  picked,
  onPick,
}: {
  center: LatLng
  km: number
  venues: readonly Venue[]
  picked: string | null
  onPick: (key: string | null) => void
}) {
  const geo = useGeo()
  const circle = useMemo(() => geoCircle().center([center.lng, center.lat]).radius(km / KM_PER_DEG).precision(2)(), [center.lat, center.lng, km])
  // Métropole et Corse : la conique de la carte de France ; outre-mer : Mercator (comme src/clubMap.ts, focusProjection).
  const metro = center.lat > 41 && center.lat < 51.6 && center.lng > -5.6 && center.lng < 10
  const proj = useMemo(
    () =>
      (metro ? geoConicConformal().parallels([44, 49]).rotate([-3, 0]) : geoMercator()).fitExtent(
        [
          [PAD, PAD],
          [W - PAD, H - PAD],
        ],
        circle,
      ),
    [circle, metro],
  )
  const path = useMemo(() => geoPath(proj), [proj])

  // Départements dans le cadre (boîte des quatre coins), tracés avec la même projection.
  const shapes = useMemo(() => {
    if (!geo) return []
    const corners = ([[0, 0], [W, 0], [0, H], [W, H]] as [number, number][]).map((c) => proj.invert?.(c)).filter((c): c is [number, number] => !!c)
    if (corners.length < 4) return []
    const lngs = corners.map((c) => c[0])
    const lats = corners.map((c) => c[1])
    const [x0, x1, y0, y1] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)]
    return geo.features
      .filter((f) => {
        const [[a, b], [c, d]] = bounds(f)
        return c >= x0 && a <= x1 && d >= y0 && b <= y1
      })
      .map((f) => ({ code: f.properties.code, d: path(f) ?? '' }))
  }, [geo, proj, path])

  const ring = path(circle) ?? ''
  const [cx, cy] = proj([center.lng, center.lat]) ?? [W / 2, H / 2]
  const max = Math.max(1, ...venues.map((v) => v.youths))
  const pins = useMemo(() => {
    const pts = venues
      .map((v) => {
        const p = proj([v.lng, v.lat])
        return p ? { v, x: p[0], y: p[1], r: v.youths ? dotRadius(v.youths, max, 6, 14) : 4 } : null
      })
      .filter((p): p is NonNullable<typeof p> => !!p)
    return spreadDots(pts, 1.5)
  }, [venues, proj, max])

  const key = (e: KeyboardEvent, k: string) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    onPick(picked === k ? null : k)
  }

  return (
    // Grand écran : hauteur limitée (la liste reste en vue), le dessin garde ses proportions au milieu du cadre.
    <div className="card overflow-hidden bg-bg p-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto max-h-[46vh] w-full touch-manipulation select-none" role="group" aria-label={`Carte : ${venues.length} salle${venues.length > 1 ? 's' : ''} dans un rayon de ${km} km`}>
        <rect width={W} height={H} fill="var(--color-bg)" />
        {shapes.map((s) => (
          <path key={s.code} d={s.d} fill="var(--color-panel-2)" stroke="var(--color-line)" strokeWidth={1} strokeLinejoin="round" />
        ))}
        <path d={ring} fill="var(--color-accent)" fillOpacity={0.06} stroke="var(--color-accent)" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="6 5" />
        <g aria-hidden>
          <circle cx={cx} cy={cy} r={4} fill="var(--color-fg)" />
          <circle cx={cx} cy={cy} r={8} fill="none" stroke="var(--color-fg)" strokeOpacity={0.5} />
        </g>
        {pins.map(({ v, x, y, r }) => {
          const on = picked === v.key
          const label = `${[v.name, v.city].filter(Boolean).join(', ') || 'Salle'} : ${v.youths ? youthsText(v.youths) : 'aucun jeune de la liste'}, ${v.fixtures.length} rencontre${v.fixtures.length > 1 ? 's' : ''}`
          return (
            <g
              key={v.key}
              transform={`translate(${x} ${y})`}
              role="button"
              tabIndex={0}
              aria-pressed={on}
              aria-label={label}
              className="cursor-pointer outline-none [&:focus-visible>circle:last-of-type]:stroke-[3]"
              onClick={() => onPick(on ? null : v.key)}
              onKeyDown={(e) => key(e, v.key)}
            >
              <title>{label}</title>
              {/* Zone de toucher plus grande que le rond. */}
              <circle r={Math.max(r + 6, 16)} fill="transparent" />
              {on && <circle r={r + 4} fill="none" stroke="var(--color-fg)" strokeWidth={2} />}
              <circle
                r={r}
                fill={v.youths ? 'var(--color-accent)' : 'var(--color-panel)'}
                fillOpacity={v.youths ? 0.9 : 1}
                stroke={v.youths ? 'var(--color-fg)' : 'var(--color-muted)'}
                strokeOpacity={0.8}
                strokeWidth={1.2}
              />
              {v.youths > 0 && r >= 9 && (
                <text textAnchor="middle" dy="0.35em" fontSize={r >= 12 ? 12 : 10} fontWeight={800} fill="#fff" pointerEvents="none">
                  {v.youths}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
