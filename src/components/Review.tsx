import { useState } from 'react'
import { db, fmtDate, reviewOf, save, type Evaluation, type ReviewState } from '../db'
import { currentUserId } from '../roles'
import { getMe } from './ui'

/*
 * Validation des avis spontanés : un encadrant ou un administrateur valide l'avis (il compte alors
 * dans les moyennes) ou le met hors cadre (gardé sur la fiche, ne compte jamais).
 * Le serveur n'accepte de ces écritures que la décision et son commentaire (supabase/008_avis_spontanes.sql).
 */

export async function decide(id: string, review: ReviewState, note?: string) {
  const cur = await db.evaluations.get(id)
  if (!cur) return
  await save<Evaluation>('evaluations', {
    ...cur,
    review,
    reviewNote: note?.trim() || undefined,
    reviewedBy: currentUserId() ?? undefined,
    reviewedByName: getMe() || undefined,
    reviewedAt: new Date().toISOString(),
  })
}

const BADGE: Record<ReviewState, { text: string; cls: string }> = {
  pending: { text: 'En attente de validation', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-200' },
  validated: { text: 'Validé', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' },
  refused: { text: 'Hors cadre', cls: 'border-line bg-panel text-muted' },
}

/** État d'un avis spontané (rien pour un avis sur un événement). */
export function ReviewBadge({ e }: { e: Evaluation }) {
  if (!e.review) return null
  const b = BADGE[reviewOf(e)]
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${b.cls}`}>{b.text}</span>
}

/** Qui a décidé, quand, et son commentaire. */
export function ReviewNote({ e }: { e: Evaluation }) {
  if (!e.review || e.review === 'pending' || (!e.reviewNote && !e.reviewedByName)) return null
  return (
    <div className="mt-1 text-[10px] text-muted">
      {e.review === 'validated' ? 'Validé' : 'Mis hors cadre'}
      {e.reviewedByName && <> par <b className="text-white">{e.reviewedByName}</b></>}
      {e.reviewedAt && <> le {fmtDate(e.reviewedAt.slice(0, 10))}</>}
      {e.reviewNote && <> : « {e.reviewNote} »</>}
    </div>
  )
}

/** Boutons de décision, avec un commentaire facultatif. */
export function ReviewActions({ e, compact }: { e: Evaluation; compact?: boolean }) {
  const [note, setNote] = useState(e.reviewNote ?? '')
  const [writing, setWriting] = useState(!compact)
  const state = reviewOf(e)
  const act = (r: ReviewState) => void decide(e.id, r, note)
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {writing ? (
        <textarea
          className="field min-h-10 text-xs"
          placeholder="Commentaire pour l’observateur (facultatif)"
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
        />
      ) : (
        <button className="self-start text-[10px] font-bold text-accent" onClick={() => setWriting(true)}>
          + Commentaire
        </button>
      )}
      <div className="flex gap-2">
        {state !== 'validated' && (
          <button className="btn-primary flex-1 py-1.5 text-xs" onClick={() => act('validated')}>
            ✓ Valider
          </button>
        )}
        {state !== 'refused' && (
          <button className="btn-ghost flex-1 py-1.5 text-xs" onClick={() => act('refused')}>
            Hors cadre
          </button>
        )}
      </div>
    </div>
  )
}
