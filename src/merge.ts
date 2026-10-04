import { db, type Evaluation, type HBEvent, type Player } from './db'
import { supabase, syncNow } from './sync'

/*
 * Fusion de deux fiches (supabase/011_fusion_fiches.sql) et repérage des doublons possibles.
 * La fusion est faite par le serveur, d'un bloc : elle demande d'être en ligne.
 */

/** Nom sans accents, tirets ni majuscules : « Jean-Pierre D'Amico » → « jeanpierre|damico ». */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toLowerCase()
export const nameKey = (p: Pick<Player, 'firstName' | 'lastName'>) => `${norm(p.firstName)}|${norm(p.lastName)}`

/** Dates de naissance compatibles : égales, ou l'une inconnue, ou seule l'année connue et identique. */
const sameBirth = (a?: string, b?: string) => !a || !b || a === b || (a.length === 4 || b.length === 4 ? a.slice(0, 4) === b.slice(0, 4) : false)

/**
 * Doublons possibles : même prénom et nom, naissances compatibles, et au moins une des deux fiches
 * proposée, hors cadre ou sans licence (deux licenciés différents peuvent porter le même nom).
 */
export function possibleDuplicates(players: Player[]): [Player, Player][] {
  const groups = new Map<string, Player[]>()
  for (const p of players) {
    if (p.deleted || p.id.startsWith('demo-')) continue
    const k = nameKey(p)
    groups.set(k, [...(groups.get(k) ?? []), p])
  }
  const out: [Player, Player][] = []
  for (const g of groups.values()) {
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        const [a, b] = [g[i], g[j]]
        const weak = (p: Player) => !!p.review || !p.license
        if ((weak(a) || weak(b)) && sameBirth(a.birthDate, b.birthDate)) out.push(keepFirst(a, b))
      }
  }
  return out
}

/** Ordre conseillé [à garder, à fondre] : la fiche licenciée, sinon la fiche normale, sinon la plus ancienne. */
export function keepFirst(a: Player, b: Player): [Player, Player] {
  const score = (p: Player) => (p.license ? 4 : 0) + (!p.review || p.review === 'validated' ? 2 : 0) + (p.review === 'refused' ? -1 : 0)
  return score(b) > score(a) ? [b, a] : [a, b]
}

/** Ce que la fusion va déplacer, pour l'aperçu. */
export async function mergePreview(sourceId: string) {
  const [evaluations, measurements, events] = await Promise.all([
    db.evaluations.where('playerId').equals(sourceId).filter((e: Evaluation) => !e.deleted).count(),
    db.measurements.where('playerId').equals(sourceId).filter((m) => !m.deleted).count(),
    db.events.filter((e: HBEvent) => !e.deleted && (e.playerIds ?? []).includes(sourceId)).count(),
  ])
  return { evaluations, measurements, events }
}

/** Fond `sourceId` dans `targetId` (en ligne). Renvoie un message d'erreur, ou null si c'est fait. */
export async function mergePlayers(sourceId: string, targetId: string): Promise<string | null> {
  if (!supabase) return 'La fusion se fait sur le serveur : elle n’est pas disponible en mode local.'
  if (!navigator.onLine) return 'La fusion demande d’être en ligne.'
  // Envoyer d'abord les saisies en attente, pour qu'elles soient fusionnées elles aussi.
  await syncNow()
  const { error } = await supabase.rpc('hb_merge_players', { p_source: sourceId, p_target: targetId })
  if (error) return error.message
  await syncNow()
  return null
}
