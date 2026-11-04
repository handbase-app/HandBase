import { useMemo } from 'react'
import type { Criterion } from '../db'
import { useConfigRows } from '../installation'
import { MEDAL_NAMES, medalFor, reperesOf, type MedalLevel, type ReperesConfig, type RepereWho } from '../reperes'

/*
 * Médaille d'un résultat de test (repères de l'installation, src/reperes.ts) : petite médaille bronze / argent / or à côté
 * de la valeur. Aucune médaille : rien (jamais de gris « raté »). Le niveau (« Niveau Pôle ») est lu par les lecteurs
 * d'écran et montré en bulle d'aide ; `withLabel` l'écrit à côté (bilan imprimé : lisible en noir et blanc).
 */

/** Couleurs du métal (fond, reflet, contour) : les mêmes sur tous les thèmes, contour foncé lisible sur fond clair et sombre. */
const METAL: Record<MedalLevel, { fill: string; light: string; stroke: string }> = {
  bronze: { fill: '#c07a3e', light: '#e3a46c', stroke: '#6e3d14' },
  argent: { fill: '#a9b2bf', light: '#dfe5ec', stroke: '#4d5663' },
  or: { fill: '#e2ac1c', light: '#ffd95a', stroke: '#7a5500' },
}
/** Ruban bleu, le même pour les trois. */
const RIBBON = '#3b6fd8'
/** Chiffre gravé (3, 2, 1) : la médaille se distingue aussi sans couleur (impression en noir et blanc). */
const RANK: Record<MedalLevel, string> = { bronze: '3', argent: '2', or: '1' }

/** Repères de l'installation, relus quand la configuration change. */
export function useReperes(): ReperesConfig {
  const rows = useConfigRows()
  return useMemo(() => reperesOf(rows), [rows])
}

export function Medal({
  level,
  label,
  size = 16,
  withLabel = false,
  className = '',
}: {
  level: MedalLevel
  /** Libellé du niveau (« Niveau Pôle »), réglé par l'installation. */
  label: string
  size?: number
  withLabel?: boolean
  className?: string
}) {
  const m = METAL[level]
  const text = `${label} (${MEDAL_NAMES[level].toLowerCase()})`
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 align-middle ${className}`} title={text}>
      <svg viewBox="0 0 20 24" width={size * (20 / 24)} height={size} role="img" aria-label={text} className="medal-svg shrink-0">
        {/* Ruban */}
        <path d="M5 1h4l2 7H7zM11 1h4l-2 7H9z" fill={RIBBON} stroke="#1e3a8a" strokeWidth="0.8" strokeLinejoin="round" />
        {/* Médaille */}
        <circle cx="10" cy="15.5" r="7.2" fill={m.fill} stroke={m.stroke} strokeWidth="1.3" />
        <circle cx="10" cy="15.5" r="4.9" fill="none" stroke={m.light} strokeWidth="1" />
        <text x="10" y="18.4" textAnchor="middle" fontSize="7.5" fontWeight="800" fill={m.stroke} fontFamily="system-ui, sans-serif">
          {RANK[level]}
        </text>
      </svg>
      {withLabel && <span className="text-[10px] font-bold">{label}</span>}
    </span>
  )
}

/**
 * Médaille d'une mesure, si elle atteint un repère ; sinon rien. `day` : date de la mesure (âge de saison du joueur ce
 * jour-là).
 */
export function MeasureMedal({
  cfg,
  c,
  value,
  who,
  day,
  size,
  withLabel,
  className,
}: {
  cfg: ReperesConfig
  c: Criterion | undefined
  value: unknown
  who: RepereWho
  day: string
  size?: number
  withLabel?: boolean
  className?: string
}) {
  const level = medalFor(cfg, c, value, who, day)
  if (!level) return null
  return <Medal level={level} label={cfg.labels[level]} size={size} withLabel={withLabel} className={className} />
}
