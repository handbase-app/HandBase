import type { ReactNode } from 'react'
import { alive, db, poleStatus, type Player } from '../db'
import { levelLabel, levelRingBackground, playerLevels, RING_GAP, ringWidth, scopeLevelMap, type Level } from '../levels'
import { sharedQuery, useShared } from '../live'
import { can } from '../roles'
import { loadTeams } from '../teams'

/*
 * Anneau des niveaux autour de la photo (src/levels.ts) : la table joueur → niveaux des groupes, une seule pour toute
 * l'appli (relue quand les groupes changent), et le Pôle tiré de la fiche (comme l'étiquette « Pôle » de la ligne).
 */

const levelQuery = sharedQuery(
  ['groups', 'teams'],
  async () => {
    await loadTeams()
    return scopeLevelMap(alive(await db.groups.toArray()).filter(can.seeGroup))
  },
  800,
)

/** Niveaux de ce joueur (deux au plus, du plus important au moins important). */
export function usePlayerLevels(p: Partial<Pick<Player, 'id' | 'poles'>>): Level[] {
  const map = useShared(levelQuery)
  return playerLevels(p.id ? map?.get(p.id) : undefined, poleStatus(p) === 'current')
}

/**
 * Anneau autour de la photo (ou des initiales) : 3 px (2,5 px sous 36 px), 1,5 px d'écart ; deux niveaux : moitié gauche,
 * moitié droite. Posé par-dessus, hors de la boîte de la photo : la ligne ne bouge pas.
 */
export function LevelRing({ levels, size, children }: { levels: readonly Level[]; size: number; children: ReactNode }) {
  if (!levels.length) return <>{children}</>
  const w = ringWidth(size)
  const mask = `radial-gradient(farthest-side, transparent calc(100% - ${w + 0.5}px), #000 calc(100% - ${w}px))`
  return (
    <span className="relative inline-flex shrink-0 rounded-full" style={{ width: size, height: size }} title={levelLabel(levels)} data-niveaux={levels.join(' ')}>
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-full"
        style={{ inset: -(w + RING_GAP), background: levelRingBackground(levels, size), WebkitMask: mask, mask }}
      />
    </span>
  )
}
