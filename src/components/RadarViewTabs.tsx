import { useLocation, useSearchParams } from 'react-router-dom'
import { useMedia } from '../layout'
import { CapsuleTabs } from './CapsuleTabs'
import { avisViewOf, radarViewOf, withAvisView, withRadarView, type AvisView, type RadarView } from '../tabQuery'

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

/** Onglets « Complet » | « Par famille » au-dessus d'un radar des avis : CapsuleTabs, comme ceux d'un événement (31/10). */
export function RadarViewTabs({ view, onChange }: { view: RadarView; onChange: (v: RadarView) => void }) {
  return (
    <CapsuleTabs
      label="Vue du radar"
      value={view}
      onChange={onChange}
      compact
      className="mb-2"
      items={[
        { value: 'complet', label: 'Complet' },
        { value: 'familles', label: 'Par famille' },
      ]}
    />
  )
}

/**
 * Onglet Avis de la fiche (et avis d'un joueur sur la page de l'événement) : vue choisie dans le segment « Complet | Par
 * famille | Tableau », dans l'adresse (?radar=…) comme la vue du radar : Retour revient au même onglet, et il suit d'un
 * joueur à l'autre. Sans paramètre : radar complet sur écran large, par famille sur téléphone.
 */
export function useAvisView(): [AvisView, (v: AvisView) => void] {
  const { search, state } = useLocation()
  const [, setParams] = useSearchParams()
  const view = avisViewOf(search, useMedia('(max-width: 639.98px)'))
  return [view, (v) => setParams(new URLSearchParams(withAvisView(search, v)), { replace: true, state })]
}

/** Segment unique de l'onglet Avis, quelle que soit la vue (Progression, un événement, moyenne, avis spontanés). */
export function AvisViewTabs({ view, onChange, className = '' }: { view: AvisView; onChange: (v: AvisView) => void; className?: string }) {
  return (
    <CapsuleTabs
      label="Affichage des avis"
      value={view}
      onChange={onChange}
      compact
      className={className}
      items={[
        { value: 'complet', label: 'Complet' },
        { value: 'familles', label: 'Par famille' },
        { value: 'tableau', label: 'Tableau' },
      ]}
    />
  )
}
