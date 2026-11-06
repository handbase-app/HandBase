import { save, type Evaluation, type HBEvent } from './db'
import { can, currentUserId, type Role } from './roles'

/*
 * Enregistrement d'un avis, tel que le fait l'écran d'avis (src/pages/Evaluate.tsx) : sorti de l'écran pour servir aussi à la
 * boîte « À valider » (avis préparés par Claude, src/propositionsJoueurs.ts). Mêmes règles, même table, même synchronisation :
 *  - avis spontané (hors événement) : validé d'office pour un encadrant ou un administrateur, sinon en attente ;
 *  - joueur hors de la liste de l'événement, noté par quelqu'un qui ne peut pas modifier l'événement : à valider
 *    (supabase/021_avis_hors_liste.sql) ;
 *  - le joueur noté rejoint la liste de l'événement si on peut la modifier.
 * Le serveur applique les mêmes règles, quoi qu'envoie l'appareil.
 */

type Review = Pick<Evaluation, 'review' | 'reviewedBy' | 'reviewedByName' | 'reviewedAt' | 'reviewNote'>

/** Champs de validation d'un nouvel avis (ou d'un avis modifié). */
export function reviewFields(o: { spontaneous: boolean; role: Role; me: string; event?: HBEvent; playerId: string }): Review {
  const none = { reviewedBy: undefined, reviewedByName: undefined, reviewedAt: undefined, reviewNote: undefined }
  if (o.spontaneous)
    return can.review(o.role)
      ? { review: 'validated', reviewedBy: currentUserId() ?? undefined, reviewedByName: o.me, reviewedAt: new Date().toISOString(), reviewNote: undefined }
      : { review: 'pending', ...none }
  if (o.event && !can.editEvent(o.role, o.event) && !can.contributeEvent(o.role, o.event) && !(o.event.playerIds ?? []).includes(o.playerId)) return { review: 'pending', ...none }
  return { review: undefined, ...none }
}

/**
 * Enregistre l'avis `row` (identifiant compris) comme l'écran d'avis : validation, auteur (nom de l'appareil et compte),
 * puis le joueur rejoint la liste de l'événement si on peut la modifier. Renvoie l'avis écrit et si le joueur a été ajouté.
 */
export async function saveEvaluation(
  row: Partial<Evaluation> & { id: string; playerId: string; date: string; scores: Evaluation['scores'] },
  o: { spontaneous: boolean; role: Role; me: string; event?: HBEvent },
): Promise<{ evaluation: Evaluation; addedToEvent: boolean }> {
  const evaluation = (await save<Evaluation>('evaluations', {
    ...row,
    ...reviewFields({ ...o, playerId: row.playerId }),
    eventId: o.spontaneous ? undefined : o.event?.id,
    contextType: o.spontaneous ? row.contextType : undefined,
    contextPlace: o.spontaneous ? row.contextPlace?.trim() || undefined : undefined,
    observer: o.me,
    observerId: currentUserId() ?? row.observerId,
  } as Evaluation)) as Evaluation
  const ev = o.event
  let addedToEvent = false
  if (ev && !o.spontaneous && (can.editEvent(o.role, ev) || can.contributeEvent(o.role, ev)) && !(ev.playerIds ?? []).includes(row.playerId)) {
    const uid = currentUserId()
    await save<HBEvent>('events', {
      ...ev,
      playerIds: [...(ev.playerIds ?? []), row.playerId],
      ...(uid && { addedBy: { ...ev.addedBy, [row.playerId]: uid } }),
    })
    addedToEvent = true
  }
  return { evaluation, addedToEvent }
}
