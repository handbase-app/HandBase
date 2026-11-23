import type { ReactNode } from 'react'
import { alive, db, poleStatus, today, type Player } from '../db'
import { allPlayerLevels, levelLabel, levelRingBackground, playerLevels, RING_GAP, ringWidth, scopeLevelMap, type Level } from '../levels'
import { sharedQuery, useShared } from '../live'
import { can } from '../roles'
import { loadTeams } from '../teams'
import { loadPlayerRows } from '../playersCache'
import { materializeSelectionGroups } from '../selections'

/*
 * Anneau des niveaux autour de la photo (src/levels.ts) : la table joueur → niveaux des groupes, une seule pour toute
 * l'appli (relue quand les groupes changent), et le Pôle tiré de la fiche (comme l'étiquette « Pôle » de la ligne).
 * Groupes de sélection (src/selections.ts) : membres d'aujourd'hui calculés depuis les périodes des fiches (fiches déjà en
 * mémoire, src/playersCache.ts) ; une sélection en cours compte comme un groupe de sa portée (France, Ligue, Comité).
 */

const levelQuery = sharedQuery(
  ['groups', 'teams', 'players'],
  async () => {
    await loadTeams()
    const groups = alive(await db.groups.toArray()).filter(can.seeGroup)
    const sel = groups.some((g) => g.selection) ? materializeSelectionGroups(groups, await loadPlayerRows(), today()) : groups
    return scopeLevelMap(sel)
  },
  800,
)

/** Niveaux de ce joueur (deux au plus, du plus important au moins important). */
export function usePlayerLevels(p: Partial<Pick<Player, 'id' | 'poles'>>): Level[] {
  const map = useShared(levelQuery)
  return playerLevels(p.id ? map?.get(p.id) : undefined, poleStatus(p) === 'current')
}

/** Tous les niveaux de ce joueur (étiquettes FR, Pôle, LIG, COM de la ligne), du plus important au moins important. */
export function usePlayerAllLevels(p: Partial<Pick<Player, 'id' | 'poles'>>): Level[] {
  const map = useShared(levelQuery)
  return allPlayerLevels(p.id ? map?.get(p.id) : undefined, poleStatus(p) === 'current')
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
