import type { ReactNode } from 'react'
import { AIM_COLOR, FIXED_COLOR, type Glyph as GlyphName, type PillLabel } from '../seqPills'

/*
 * Pastilles du séquençage (Sequencer.tsx) : fond opaque de la couleur de l'équipe, contour blanc (lisible sur une vidéo
 * claire ou sombre), libellé court et pictogramme (QUOI), abréviation de l'équipe et numéro (QUI). Calée : contour et
 * coche verts ; action annoncée : plus grande, contour jaune de la cible. Couleurs et libellés : src/seqPills.ts.
 */

/** Pictogramme simple, dessiné (aucun émoji), de la couleur du texte sauf le carton. */
export function Glyph({ g, card, size = 11 }: { g: GlyphName; card?: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 12 12', 'aria-hidden': true, className: 'shrink-0', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const
  switch (g) {
    case 'card':
      return (
        <svg {...common} stroke="#fff" strokeWidth={1}>
          <rect x="2.5" y="0.8" width="7" height="10.4" rx="1.2" fill={card} transform="rotate(8 6 6)" />
        </svg>
      )
    case 'ball':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.6" fill="currentColor" fillOpacity={0.25} />
          <path d="M2.2 4.2c2.4 1 5.2 1 7.6 0M2.2 7.8c2.4-1 5.2-1 7.6 0" strokeWidth={1.1} />
        </svg>
      )
    case 'miss':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="4.6" />
          <path d="M3.6 3.6l4.8 4.8M8.4 3.6l-4.8 4.8" />
        </svg>
      )
    case 'save':
      return (
        <svg {...common}>
          <path d="M6 1.2l4 1.6v3.1c0 2.4-1.7 4-4 4.9-2.3-.9-4-2.5-4-4.9V2.8z" fill="currentColor" fillOpacity={0.25} />
        </svg>
      )
    case 'shot':
      return (
        <svg {...common}>
          <path d="M1.5 6h8M6.5 2.8L9.8 6l-3.3 3.2" />
        </svg>
      )
    case 'pass':
      return (
        <svg {...common}>
          <circle cx="2.4" cy="9" r="1.4" fill="currentColor" stroke="none" />
          <path d="M3.6 7.6C5 3.8 7.4 2.6 10 2.6M7.6 1.2L10 2.6 8.4 4.8" strokeWidth={1.4} />
        </svg>
      )
    case 'turnover':
      return (
        <svg {...common}>
          <path d="M2 4h7.5M7.3 1.8L9.6 4 7.3 6.2M10 8H2.5M4.7 5.8L2.4 8l2.3 2.2" strokeWidth={1.4} />
        </svg>
      )
    case 'clock':
      return (
        <svg {...common}>
          <circle cx="6" cy="6.6" r="4.4" />
          <path d="M6 4v2.8l1.8 1.1M4.6 1h2.8" strokeWidth={1.3} />
        </svg>
      )
    case 'pause':
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <rect x="2.6" y="2" width="2.4" height="8" rx=".5" />
          <rect x="7" y="2" width="2.4" height="8" rx=".5" />
        </svg>
      )
    default:
      return (
        <svg {...common} stroke="none" fill="currentColor">
          <circle cx="6" cy="6" r="2.6" />
        </svg>
      )
  }
}

/** Petite étiquette de couleur d'équipe (annonce, légende) : « [● BUT] ». */
export function Chip({ color, children, className = '' }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 align-[1px] font-extrabold leading-[1.35] text-white ring-1 ring-white/70 ${className}`} style={{ background: color }}>
      {children}
    </span>
  )
}

/** Coche verte « calée », posée sur le coin de la pastille. */
function Check({ big }: { big: boolean }) {
  return (
    <span
      className={`absolute -top-1.5 -right-1.5 flex items-center justify-center rounded-full ring-[1.5px] ring-white ${big ? 'h-4.5 w-4.5' : 'h-4 w-4'}`}
      style={{ background: FIXED_COLOR }}
      aria-hidden
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth={2.2}>
        <path d="M2.5 6.3l2.3 2.3 4.7-5" />
      </svg>
    </span>
  )
}

export type PillSize = 'normal' | 'compact'

/**
 * Contenu et habillage d'une pastille (le bouton et sa position sont posés par Sequencer.tsx).
 * - normal : deux lignes, « ● BUT » / « RHS n°7 » ; annoncée : « ● BUT · RHS » / « n°7 DUPONT Léo ».
 * - compact (téléphone couché) : une ligne, « ● BUT 7 » ; annoncée : « ● BUT RHS 7 ».
 */
export function PillBody({
  label,
  color,
  team,
  num,
  player,
  teamName,
  more,
  size,
  big,
  fixed,
  ping,
}: {
  label: PillLabel
  color: string
  /** Abréviation de l'équipe (« RHS »). */
  team: string
  /** Numéro du joueur, sans « n° ». */
  num?: string
  /** Nom complet du joueur relié (action annoncée seulement). */
  player?: string
  /** Nom complet de l'équipe (action annoncée sans joueur relié). */
  teamName?: string
  /** Autres actions au même moment (« +1 »). */
  more: number
  size: PillSize
  big: boolean
  fixed: boolean
  ping: boolean
}) {
  const border = big ? AIM_COLOR : fixed ? FIXED_COLOR : 'rgba(255,255,255,0.92)'
  const what = (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <Glyph g={label.glyph} card={label.card} size={big ? 13 : 11} />
      <span>{label.short}</span>
      {more > 0 && <span className="rounded-sm bg-black/30 px-0.5 text-[11px] font-bold">+{more}</span>}
    </span>
  )
  const n = num ? `n°${num}` : ''
  const shell = `relative flex rounded-md text-white ${ping ? 'shadow-[0_0_12px_4px_rgba(253,224,71,0.85)] motion-safe:animate-pulse' : 'shadow-[0_1px_3px_rgba(0,0,0,0.6)]'}`
  const style = { background: color, border: `${big ? 3 : fixed ? 2 : 1.5}px solid ${border}` }

  if (size === 'compact')
    return (
      <span className={`${shell} items-center gap-1 whitespace-nowrap font-extrabold leading-none ${big ? 'h-7 px-1.5 text-xs' : 'h-5 px-1 text-[11px]'}`} style={style}>
        {what}
        <span className="font-bold">{[big && team, num && `n°${num}`].filter(Boolean).join(' ')}</span>
        {fixed && <Check big={false} />}
      </span>
    )
  return (
    <span className={`${shell} flex-col items-start leading-tight ${big ? 'px-2 py-1 text-[13px]' : 'px-1.5 py-0.5 text-xs'}`} style={style}>
      <span className="flex items-center gap-1 font-extrabold">
        {what}
        {big && <span className="whitespace-nowrap">· {team}</span>}
      </span>
      <span className={`whitespace-nowrap font-semibold ${big ? 'text-[13px]' : 'text-[11px]'}`}>
        {big ? (player ? [n, player].filter(Boolean).join(' ') : [n, teamName].filter(Boolean).join(' · ') || team) : [team, n].filter(Boolean).join(' ')}
      </span>
      {fixed && <Check big={big} />}
    </span>
  )
}
