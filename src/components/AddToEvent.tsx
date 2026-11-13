import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { alive, db, fmtDate, save, today, type HBEvent } from '../db'
import { accord, genderOf, pluralG, w } from '../gender'
import { can, currentUserId, useRole } from '../roles'
import { loadTeams } from '../teams'

// ---------- Ajouter à un événement ----------

/**
 * Ajoute des joueurs à la liste d'un événement (relu juste avant : sans doublon, ordre conservé). Rend l'événement relu et
 * les joueurs vraiment ajoutés. Aussi utilisé par les actions de « Demander » (src/components/AskAction.tsx).
 */
export async function addPlayersToEvent(ev: HBEvent, playerIds: string[]): Promise<{ cur: HBEvent; added: string[] }> {
  const cur = (await db.events.get(ev.id)) ?? ev
  const ids = cur.playerIds ?? []
  const added = [...new Set(playerIds)].filter((id) => !ids.includes(id))
  if (added.length) {
    // « Ajouté par » : posé ici pour l'affichage ; le serveur le refait (supabase/024).
    const me = currentUserId()
    await save<HBEvent>('events', {
      ...cur,
      playerIds: [...ids, ...added],
      ...(me && { addedBy: { ...cur.addedBy, ...Object.fromEntries(added.map((id) => [id, me])) } }),
    })
  }
  return { cur, added }
}

/** Événements à venir où je peux ajouter des joueurs (organisateur, administrateur, participant) ; un toucher les ajoute. */
export function AddToEventDialog({ playerIds, onClose, onAdded }: { playerIds: string[]; onClose: () => void; /** Après un ajout : le message (sélection multiple). */ onAdded?: (msg: string, eventId: string) => void }) {
  const role = useRole()
  const [done, setDone] = useState<string | null>(null)
  const events = useLiveQuery(async () => {
    await loadTeams()
    const rows = alive(await db.events.where('date').aboveOrEqual(today()).toArray())
    return rows.filter((e) => !e.archived && (can.editEvent(role, e) || can.contributeEvent(role, e))).sort((a, b) => a.date.localeCompare(b.date))
  }, [role])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const n = playerIds.length
  // Accord au genre des joueurs à ajouter (src/gender.ts).
  const pg = useLiveQuery(() => db.players.bulkGet(playerIds).then(genderOf), [playerIds.join(',')])
  const who = n > 1 ? pluralG(n, pg) : w(pg).ceJoueur

  async function add(ev: HBEvent) {
    const { cur, added } = await addPlayersToEvent(ev, playerIds)
    const msg = added.length ? `${added.length > 1 ? pluralG(added.length, pg, 'joueur ajouté') : accord('Joueur ajouté', pg)} à « ${cur.name} ».` : `Déjà dans « ${cur.name} ».`
    setDone(msg)
    onAdded?.(msg, cur.id)
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center scrim p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="win flex max-h-[80dvh] w-full max-w-md flex-col gap-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-extrabold">Ajouter {who} à un événement</div>
        {done ? (
          <p className="text-xs text-emerald-300">{done}</p>
        ) : events === undefined ? (
          <div className="text-xs text-muted">Chargement…</div>
        ) : events.length ? (
          <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
            {events.map((e) => {
              const inside = playerIds.filter((id) => e.playerIds?.includes(id)).length
              return (
                <button key={e.id} onClick={() => void add(e)} className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-left text-xs hover:border-accent">
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{e.name}</b>
                    <span className="text-muted">
                      {fmtDate(e.date)}
                      {e.place ? ` · ${e.place}` : ''}
                    </span>
                  </span>
                  {inside > 0 && <span className="shrink-0 text-[10px] text-muted">{inside === n ? 'déjà dedans' : `${inside} déjà dedans`}</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted">Aucun événement à venir que tu peux compléter. Crée-le d’abord dans Événements.</p>
        )}
        <div className="flex justify-end gap-2">
          {done && (
            <button className="btn-ghost px-4 text-xs" onClick={() => setDone(null)}>
              Un autre événement
            </button>
          )}
          <button className="btn-primary px-4 text-xs" onClick={onClose}>
            {done ? 'OK' : 'Fermer'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
