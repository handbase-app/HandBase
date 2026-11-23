import type { ReactNode } from 'react'
import { alive, db, poleStatus, today, type Player } from '../db'
import { allPlayerLevels, levelCss, levelLabel, playerLevels, RING_GAP, ringWidth, scopeLevelMap, type Level } from '../levels'
import { sharedQuery, useShared } from '../live'
import { Avatar } from './ui'
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
 * Anneau des niveaux autour du carré arrondi de la photo ou des initiales (coins rounded-lg, la même forme partout : listes, fiche, wellness…) : un niveau, sa
 * couleur ; deux, coupé à la verticale : moitié GAUCHE le plus important, moitié droite l'autre, un petit vide en haut et
 * en bas entre les deux. Posé par-dessus, hors de la boîte : la rangée ne bouge pas.
 */
export function LevelFrame({ levels, size, children }: { levels: readonly Level[]; size: number; children: ReactNode }) {
  if (!levels.length) return <>{children}</>
  const w = ringWidth(size)
  const [left, right] = levels
  const fill = right
    ? `linear-gradient(90deg, ${levelCss(left)} 0 calc(50% - 0.75px), transparent calc(50% - 0.75px) calc(50% + 0.75px), ${levelCss(right)} calc(50% + 0.75px))`
    : levelCss(left)
  const ring = 'linear-gradient(#000 0 0)'
  return (
    <span className="relative inline-flex shrink-0 rounded-lg" style={{ width: size, height: size }} title={levelLabel(levels)} data-niveaux={levels.join(' ')}>
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          inset: -(w + RING_GAP),
          padding: w,
          borderRadius: `calc(var(--radius-lg) + ${w + RING_GAP}px)`,
          background: fill,
          WebkitMask: `${ring} content-box, ${ring}`,
          WebkitMaskComposite: 'xor',
          mask: `${ring} content-box exclude, ${ring}`,
        }}
      />
    </span>
  )
}

/**
 * Carré photo ou initiales d'un joueur (Avatar) avec l'anneau des niveaux : le même partout où les initiales s'affichent
 * en carré (tête de la fiche, « Moi », wellness et lampes du groupe, évaluation), comme le rond des listes (RowAvatar).
 */
export function PlayerAvatar({ p, size }: { p: Pick<Player, 'firstName' | 'lastName' | 'photo'> & Partial<Pick<Player, 'id' | 'poles'>>; size: number }) {
  return (
    <LevelFrame levels={usePlayerLevels(p)} size={size}>
      <Avatar p={p} size={size} />
    </LevelFrame>
  )
}
