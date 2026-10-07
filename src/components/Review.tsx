import { useState } from 'react'
import { db, fmtDate, save, type ReviewState, dayOf } from '../db'
import { currentUserId } from '../roles'
import { getMe } from './ui'

/*
 * Validation des avis spontanés et des fiches joueur proposées : un encadrant ou un administrateur
 * valide (l'avis compte alors dans les moyennes ; la fiche devient une fiche normale) ou met hors cadre
 * (gardé pour mémoire, jamais compté). Le serveur signe la décision
 * (supabase/008_avis_spontanes.sql, 009_joueurs_proposes.sql).
 */

type Reviewable = { id: string; review?: ReviewState; reviewNote?: string; reviewedByName?: string; reviewedAt?: string }
type Kind = 'evaluations' | 'players'

export async function decide(table: Kind, id: string, review: ReviewState, note?: string) {
  const cur = await db.table(table).get(id)
  if (!cur) return
  await save(table, {
    ...cur,
    review,
    reviewNote: note?.trim() || undefined,
    reviewedBy: currentUserId() ?? undefined,
    reviewedByName: getMe() || undefined,
    reviewedAt: new Date().toISOString(),
  })
}

const TEXT: Record<Kind, Record<ReviewState, string>> = {
  evaluations: { pending: 'En attente de validation', validated: 'Validé', refused: 'Hors cadre' },
  players: { pending: 'Fiche proposée', validated: 'Fiche validée', refused: 'Hors cadre' },
}
const STYLE: Record<ReviewState, string> = {
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  validated: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  refused: 'border-line bg-panel text-muted',
}

/** État de validation (rien pour un avis sur un événement ou une fiche normale). */
export function ReviewBadge({ e, kind = 'evaluations' }: { e: Reviewable; kind?: Kind }) {
  if (!e.review) return null
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${STYLE[e.review]}`}>{TEXT[kind][e.review]}</span>
}

/** Qui a décidé, quand, et son commentaire. */
export function ReviewNote({ e }: { e: Reviewable }) {
  if (!e.review || e.review === 'pending' || (!e.reviewNote && !e.reviewedByName)) return null
  return (
    <div className="mt-1 text-[10px] text-muted">
      {e.review === 'validated' ? 'Validé' : 'Mis hors cadre'}
      {e.reviewedByName && <> par <b className="text-fg">{e.reviewedByName}</b></>}
      {e.reviewedAt && <> le {fmtDate(dayOf(e.reviewedAt))}</>}
      {e.reviewNote && <> : « {e.reviewNote} »</>}
    </div>
  )
}

/** Boutons de décision, avec un commentaire facultatif. */
export function ReviewActions({ e, compact, kind = 'evaluations' }: { e: Reviewable; compact?: boolean; kind?: Kind }) {
  const [note, setNote] = useState(e.reviewNote ?? '')
  const [writing, setWriting] = useState(!compact)
  const state = e.review ?? 'validated'
  const act = (r: ReviewState) => void decide(kind, e.id, r, note)
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {writing ? (
        <textarea
          className="field min-h-10 text-xs"
          placeholder={kind === 'players' ? 'Commentaire (facultatif)' : 'Commentaire pour l’observateur (facultatif)'}
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
            ✓ {kind === 'players' ? 'Valider la fiche' : 'Valider'}
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
