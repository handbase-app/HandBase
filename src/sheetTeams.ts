import type { Tournament } from './db'
import type { MatchSheet } from './matchSheet'

/*
 * Les deux équipes d'un match importé d'une feuille FFHB : une équipe par côté (locaux, visiteurs), chaque joueur relié
 * rangé dans la sienne avec son numéro de maillot. Fonctions pures (testées par tools/test-equipes-feuille.ts), reprises
 * par src/scouting.ts. Mêmes règles que le serveur (supabase/041, hb_clean_tournament).
 */

const TEAM_ID = /^[A-Za-z0-9_-]{1,40}$/
const NUM = /^[0-9A-Za-z]{1,4}$/

/** Numéro de maillot accepté par le serveur (1 à 4 lettres ou chiffres), sinon rien. */
export function cleanNum(v?: string) {
  const s = (v ?? '').trim()
  return NUM.test(s) ? s : undefined
}

const same = (a: string, b: string) => a.trim().localeCompare(b.trim(), 'fr', { sensitivity: 'base' }) === 0

type Sheet = Pick<MatchSheet, 'home' | 'away' | 'players'>

/** Équipe d'un joueur, seulement si elle existe encore. */
const knownTeam = (t: Tournament | undefined, playerId: string) => {
  const team = t?.players?.[playerId]?.team
  return team && t!.teams.some((x) => x.id === team) ? team : undefined
}

/**
 * Répartition complétée par la feuille de match : une équipe par côté (nommée comme sur la feuille, « Locaux » /
 * « Visiteurs » à défaut ; reprise si une équipe porte déjà ce nom), et pour chaque joueur relié, de la liste et encore
 * sans équipe : son équipe et son numéro. Ne touche jamais à une équipe choisie à la main, ni aux observateurs.
 */
export function teamsFromSheet(t: Tournament | undefined, ms: Sheet, playerIds: string[], makeId: () => string): Tournament {
  const teams = [...(t?.teams ?? [])]
  const sideTeam = (name: string | undefined, fallback: string, prefer: string, other?: string) => {
    const n = ((name ?? '').trim() || fallback).slice(0, 60)
    const found = teams.find((x) => x.id !== other && same(x.name, n))
    if (found) return found.id
    let id = prefer
    while (!TEAM_ID.test(id) || teams.some((x) => x.id === id)) id = makeId()
    teams.push({ id, name: n })
    return id
  }
  const home = sideTeam(ms.home, 'Locaux', 'locaux')
  // Deux équipes du même nom (match entre équipes d'un même club) : la seconde n'est pas confondue avec la première.
  const away = sideTeam(ms.away, 'Visiteurs', 'visiteurs', home)
  const inList = new Set(playerIds)
  const players = { ...t?.players }
  for (const sp of ms.players) {
    if (!sp.playerId || !inList.has(sp.playerId) || knownTeam(t, sp.playerId)) continue
    const num = players[sp.playerId]?.num ?? cleanNum(sp.num)
    players[sp.playerId] = { team: sp.side === 'away' ? away : home, ...(num && { num }) }
  }
  return { ...t, teams, players }
}

/** Nombre de joueurs reliés de la feuille, dans la liste, encore sans équipe. */
export function sheetPlayersWithoutTeam(t: Tournament | undefined, ms: Pick<MatchSheet, 'players'>, playerIds: string[]) {
  const inList = new Set(playerIds)
  return new Set(ms.players.flatMap((sp) => (sp.playerId && inList.has(sp.playerId) && !knownTeam(t, sp.playerId) ? [sp.playerId] : []))).size
}
