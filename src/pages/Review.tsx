import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { AvisCard } from '../components/Opinions'
import { Empty } from '../components/ui'
import { alive, contextLabel, db, reviewOf, type Evaluation, type Player } from '../db'
import { can, currentUserId, useRole } from '../roles'

/**
 * Avis spontanés : à valider (encadrants, administrateurs) et suivi de mes propres avis spontanés
 * (état, commentaire du validateur).
 */
export default function ReviewPage() {
  const role = useRole()
  const data = useLiveQuery(async () => {
    const spontaneous = alive(await db.evaluations.filter((e) => !!e.review).toArray())
    const ids = [...new Set(spontaneous.map((e) => e.playerId))]
    const players = (await db.players.bulkGet(ids)).filter((p): p is Player => !!p)
    const criteria = alive(await db.criteria.toArray())
    return { spontaneous, players: new Map(players.map((p) => [p.id, p])), criteria }
  }, [])
  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const me = currentUserId()
  const isMine = (e: Evaluation) => !!me && e.observerId === me
  const todo = data.spontaneous.filter((e) => reviewOf(e) === 'pending' && !isMine(e)).sort((a, b) => a.date.localeCompare(b.date))
  const decided = data.spontaneous
    .filter((e) => reviewOf(e) !== 'pending' && !isMine(e) && e.reviewedAt)
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))
    .slice(0, 20)
  const mine = data.spontaneous.filter(isMine).sort((a, b) => b.date.localeCompare(a.date))

  const card = (e: Evaluation) => {
    const p = data.players.get(e.playerId)
    const scores = data.criteria
      .filter((c) => typeof e.scores[c.id] === 'number')
      .map((c) => `${c.label} ${e.scores[c.id]}`)
      .join(' · ')
    return (
      <div key={e.id} className="flex flex-col">
        <AvisCard e={e} where={contextLabel(e)} role={role} player={p} />
        {scores && <div className="-mt-1 rounded-b-lg border border-t-0 border-line bg-panel px-2.5 py-1.5 text-[10px] text-muted">{scores}</div>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">Avis spontanés</h1>
        <Link to="/evaluer?contexte=libre" className="btn-ghost px-3 py-1.5 text-xs">
          + Avis spontané
        </Link>
      </div>
      <p className="text-[11px] text-muted">
        Avis donnés sur un joueur vu hors des événements prévus (UNSS, entraînement de club…). Ceux des observateurs comptent dans les
        moyennes une fois validés par un encadrant ; hors cadre, ils restent sur la fiche du joueur pour mémoire.
      </p>

      {can.review(role) && (
        <section className="flex flex-col gap-2">
          <div className="section-title">À valider ({todo.length})</div>
          {todo.length ? todo.map(card) : <Empty>Aucun avis en attente.</Empty>}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="section-title">Mes avis spontanés ({mine.length})</div>
        {mine.length ? mine.map(card) : <Empty>Tu n’as pas encore donné d’avis spontané.</Empty>}
      </section>

      {can.review(role) && decided.length > 0 && (
        <details className="rounded-lg border border-line p-2.5">
          <summary className="cursor-pointer text-xs font-bold text-muted">Décisions récentes ({decided.length}) : revenir sur une décision</summary>
          <div className="mt-2 flex flex-col gap-2">{decided.map(card)}</div>
        </details>
      )}
    </div>
  )
}

/** Nombre d'avis qui attendent ma validation (0 pour un observateur). */
export function usePendingCount() {
  const role = useRole()
  return useLiveQuery(
    async () => {
      if (!can.review(role)) return 0
      const me = currentUserId()
      return db.evaluations.filter((e) => e.review === 'pending' && !e.deleted && !(me && e.observerId === me)).count()
    },
    [role],
    0,
  )
}
