import { useEffect, useState } from 'react'
import { fmtDate, type Player } from '../db'
import { isPlayerRole, useRole } from '../roles'
import { type SelfEvalEvent } from '../selfEval'
import { fetchMyEvents, fetchPreviewEvents } from '../selfEvalApi'
import { supabase } from '../sync'
import { eventLine, SelfEvalForm, SelfEvalView } from './SelfEval'

/*
 * « Comment ça s'est passé ? » en « tableau de bord de jeu » (bloc .hud, src/components/TodayHud.tsx, maquette du 09/11) :
 * un bloc oblique par événement à raconter (🏆, « Raconte ton match », nom · 2 min, délai), même fenêtre (SelfEvalForm),
 * mêmes délais que la carte de src/components/SelfEval.tsx (SelfEvalSection). COUPÉ depuis le 10/11 : utilisé seulement
 * quand TODAY_HUD vaut true (src/components/TodayHud.tsx).
 */

/** « Raconte ton match » (tournoi, stage). */
const raconte = (type: string) => (type === 'tournoi' ? 'Raconte ton tournoi' : type === 'entrainement' ? 'Raconte ton stage' : type === 'match' ? 'Raconte ton match' : 'Raconte')

/** `only` : comme SelfEvalSection (« current » : à remplir ou encore modifiables ; « past » : l'historique ; sans : les deux). */
export function SelfEvalHudSection({ player: p, canWrite, only }: { player: Player; canWrite: boolean; only?: 'current' | 'past' }) {
  const role = useRole()
  const [list, setList] = useState<SelfEvalEvent[] | null>(null)
  const [open, setOpen] = useState<SelfEvalEvent | null>(null)
  // Son compte (ou l'essai, ou une fiche de démonstration) : ses événements ; aperçu du staff avec le serveur : ce qu'il lit.
  const mine = isPlayerRole(role) || !supabase || p.id.startsWith('demo-')
  const load = () => (mine ? fetchMyEvents(p.id) : fetchPreviewEvents(p.id)).then((r) => setList(r.ok ? r.value : null))
  useEffect(() => {
    let live = true
    void (mine ? fetchMyEvents(p.id) : fetchPreviewEvents(p.id)).then((r) => live && setList(r.ok ? r.value : null))
    return () => {
      live = false
    }
  }, [p.id, mine])

  if (!list) return null
  const current = only === 'past' ? [] : list.filter((e) => e.open)
  const past = only === 'current' ? [] : list.filter((e) => !e.open && e.mine)
  if (!current.length && !past.length) return null

  return (
    <div className="flex flex-col gap-2.5" data-testid="comment-ca-s-est-passe">
      {current.map((e) => (
        <button
          key={e.eventId}
          type="button"
          className={`hud-skew flex min-h-16 w-full items-center px-4 py-2 text-left touch-manipulation ${e.mine ? 'hud-tile' : 'hud-tile ring-2 ring-[var(--hud-accent)] ring-inset'}`}
          disabled={!canWrite}
          onClick={() => setOpen(e)}
          aria-label={`${e.mine ? 'Modifier ce que tu as raconté' : raconte(e.type)} : ${e.name}, ${e.mine ? 'modifiable' : 'à remplir'} jusqu’au ${fmtDate(e.until)}`}
        >
          <span className="hud-unskew flex min-w-0 flex-1 items-center gap-3">
            <span aria-hidden className="text-3xl leading-none">
              {e.mine ? '✅' : '🏆'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="hud-big block text-lg">{e.mine ? 'Raconté !' : raconte(e.type)}</span>
              <span className="block text-xs font-bold break-words">
                {e.name}
                {!e.mine && <span className="font-normal whitespace-nowrap text-muted"> · 2 min</span>}
              </span>
              <span className="block text-[10px] text-muted">
                {e.mine ? 'Modifiable' : 'À remplir'} jusqu’au {fmtDate(e.until)}
              </span>
            </span>
            <span aria-hidden className="hud-big text-3xl text-[var(--hud-accent)]">
              ›
            </span>
          </span>
        </button>
      ))}
      {past.length > 0 && (
        <details className="rounded-[4px] border border-line p-2.5" open={!current.length}>
          <summary className="min-h-9 cursor-pointer content-center text-xs font-bold">Mes auto-évaluations ({past.length})</summary>
          <ul className="mt-2 flex flex-col gap-3">
            {past.map((e) => (
              <li key={e.eventId} className="border-l-2 border-line pl-2">
                <div className="text-[11px] font-bold">{e.name}</div>
                <div className="mb-1 text-[10px] text-muted">{eventLine(e)}</div>
                <SelfEvalView se={e.mine!} own />
              </li>
            ))}
          </ul>
        </details>
      )}
      {open && (
        <SelfEvalForm
          player={p}
          event={open}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null)
            void load()
          }}
        />
      )}
    </div>
  )
}
