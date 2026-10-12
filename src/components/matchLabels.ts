import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Player } from '../db'
import { KIND_LABEL, type MatchSheet, type StoredAction } from '../matchSheet'
import type { GenerateResult } from '../matchSync'
import { fmtMoment } from '../videos'
import { playerName } from './ui'

/* Libellés des actions d'une feuille de match, partagés par la carte « Feuille de match » et la frise (MatchTimeline). */

export const sideName = (ms: Pick<MatchSheet, 'home' | 'away'>, side?: string) => (side === 'home' ? ms.home : side === 'away' ? ms.away : '')
export const actionLabel = (a: StoredAction) => (a.k === 'autre' ? (a.l ?? 'Action') : a.k === 'tm' ? 'Temps mort' : KIND_LABEL[a.k])
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`

/** Nom affiché pour le joueur d'une action : fiche reliée, sinon « n° 7 (Équipe) ». */
export function useActionWho(ms: MatchSheet | undefined) {
  const ids = (ms?.players ?? []).flatMap((p) => (p.playerId ? [p.playerId] : []))
  const byId = useLiveQuery(async () => new Map((await db.players.bulkGet(ids)).filter((p): p is Player => !!p).map((p) => [p.id, p])), [ids.join(',')], new Map<string, Player>())
  return (a: StoredAction) => {
    if (!ms) return ''
    if (a.k === 'tm') return sideName(ms, a.side)
    if (a.pl === undefined) return a.side ? sideName(ms, a.side) : ''
    const sp = ms.players[a.pl]
    const p = sp?.playerId ? byId.get(sp.playerId) : undefined
    return p ? playerName(p) : `n° ${sp?.num ?? '?'} (${sideName(ms, sp?.side)})`
  }
}

/** Résumé après un calage : « Calé à 12:34 · 14 fiches recalées ». */
export function calibrated(t: number, r: GenerateResult) {
  const n = r.created + r.updated
  return `Calé à ${fmtMoment(Math.round(t))}${n ? ` · ${plural(n, 'fiche recalée', 'fiches recalées')}` : ''}${r.foreign ? ` · ${plural(r.foreign, 'lien', 'liens')} d’un autre compte non modifié${r.foreign > 1 ? 's' : ''}` : ''}.`
}

