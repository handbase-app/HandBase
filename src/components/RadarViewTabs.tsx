import { useLocation, useSearchParams } from 'react-router-dom'
import { useMedia } from '../layout'
import { radarViewOf, withRadarView, type RadarView } from '../tabQuery'

/**
 * Vue du radar des avis (onglets Complet / Par famille) dans l'adresse (?radar=…, src/tabQuery.ts) : Retour et le
 * partage la retrouvent ; sans paramètre, celle de l'écran (par famille sur téléphone, comme ZoneRadar). Changer de vue
 * remplace l'adresse, garde ses autres paramètres (a, b, c, onglet, fiche…) et son état d'historique.
 */
export function useRadarView(): [RadarView, (v: RadarView) => void] {
  const { search, state } = useLocation()
  const [, setParams] = useSearchParams()
  const view = radarViewOf(search, useMedia('(max-width: 639.98px)'))
  return [view, (v) => setParams(new URLSearchParams(withRadarView(search, v)), { replace: true, state })]
}

/** Onglets « Complet » | « Par famille » au-dessus d'un radar des avis : même style que ceux d'un événement (Events.tsx). */
export function RadarViewTabs({ view, onChange }: { view: RadarView; onChange: (v: RadarView) => void }) {
  return (
    <div role="tablist" aria-label="Vue du radar" className="mb-2 flex overflow-hidden rounded-md border border-line text-xs font-bold">
      {(
        [
          ['complet', 'Complet'],
          ['familles', 'Par famille'],
        ] as const
      ).map(([v, label]) => (
        <button
          key={v}
          role="tab"
          aria-selected={view === v}
          data-tab={v}
          onClick={() => onChange(v)}
          className={`min-w-0 flex-1 truncate px-1 py-2 ${view === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
