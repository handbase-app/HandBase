/*
 * JOUEURS DES ÉVÉNEMENTS DU JOUR D'ABORD : la partie PURE (ni Dexie, ni Supabase), testée par tools/test-priorite.ts ; la
 * lecture vit dans src/sync.ts (pullPriority).
 *
 * POURQUOI : au premier chargement d'un appareil (ou quand le périmètre change et que les joueurs sont relus depuis le
 * début), la lecture par curseur rend les joueurs dans l'ordre de leur heure serveur : ceux de la détection de ce matin
 * peuvent arriver après des milliers d'autres. L'appli s'ouvre dès la première page de joueurs (src/splash.ts) : autant que
 * ce soient ceux qu'on va voir aujourd'hui.
 *
 * COMMENT :
 *  - les événements sont lus juste avant les joueurs (src/syncLive.ts, PULL_ORDER) ; les inscriptions sont dans l'événement
 *    lui-même (hb_events, data.playerIds : joueurs convoqués / à évaluer) ;
 *  - joueurs prioritaires : ceux des événements d'aujourd'hui puis de demain (date locale, data.date « AAAA-MM-JJ »), ni
 *    supprimés ni archivés, dans l'ordre des événements puis de leur liste, sans doublon, au plus PRIORITE_MAX ;
 *  - pour les seules tables encore JAMAIS reçues (premier chargement, ou relecture complète après un changement de
 *    périmètre) parmi joueurs, mesures et avis : ces joueurs d'abord (par identifiant, puis par data.playerId : index de 046,
 *    sous les règles de lecture habituelles, aucune fonction SQL nouvelle), puis la lecture ordinaire par curseur, qui les
 *    relit une fois (sans les réécrire : ligne identique) et pose le curseur. La lecture prioritaire n'avance jamais le
 *    curseur : rien ne peut être sauté ;
 *  - synchronisation ordinaire (appareil déjà servi la veille) : rien de plus (ce qui a changé depuis la veille tient en
 *    une page ; une lecture prioritaire ne ferait qu'ajouter des requêtes au moment le plus chargé).
 */
import type { SyncTable } from './db'

/** Jours après aujourd'hui (1 : aujourd'hui et demain). */
export const PRIORITE_JOURS = 1
/** Joueurs prioritaires au plus (3 requêtes de 100 identifiants par table). */
export const PRIORITE_MAX = 300
/** Tables lues d'abord pour ces joueurs. */
export const PRIORITE_TABLES: readonly SyncTable[] = ['players', 'measurements', 'evaluations']

/** Date locale « AAAA-MM-JJ » décalée de n jours (calendrier, pas 24 h : changements d'heure compris). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n, 12)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

type EventLike = { date?: unknown; playerIds?: unknown; deleted?: boolean; archived?: boolean }

/** Joueurs des événements d'aujourd'hui (today, date locale) à today + days, aujourd'hui d'abord ; au plus max. */
export function eventDayPlayers(events: readonly EventLike[], today: string, days = PRIORITE_JOURS, max = PRIORITE_MAX): string[] {
  const last = addDays(today, days)
  const near = events
    .map((e, i) => ({ e, i, day: typeof e.date === 'string' ? e.date.slice(0, 10) : '' }))
    .filter(({ e, day }) => !e.deleted && !e.archived && day >= today && day <= last && Array.isArray(e.playerIds))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.i - b.i))
  const out = new Set<string>()
  for (const { e } of near) {
    for (const id of e.playerIds as unknown[]) {
      if (out.size >= max) return [...out]
      if (typeof id === 'string' && id) out.add(id)
    }
  }
  return [...out]
}

/**
 * Tables à lire d'abord pour les joueurs prioritaires : parmi PRIORITE_TABLES, celles à relire (toPull) et jamais reçues
 * (fresh) ; aucune s'il n'y a pas de joueur prioritaire.
 */
export function planPriorite(fresh: ReadonlySet<SyncTable>, toPull: ReadonlySet<SyncTable>, ids: readonly string[]): SyncTable[] {
  if (!ids.length) return []
  return PRIORITE_TABLES.filter((t) => fresh.has(t) && toPull.has(t))
}
