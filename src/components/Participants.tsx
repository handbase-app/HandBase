import { useState } from 'react'
import type { Team } from '../db'
import { currentUserId } from '../roles'
import { STAFF } from '../staffLabels'
import { participantSummary } from '../teams'

/**
 * Participants d'un groupe ou d'un événement : staffs choisis (« ETD Var · 5 encadrants », membres en un clic),
 * puis participants choisis un par un. Staffs supprimés ou que je ne vois pas : comptés à part, sans détail.
 * `onLeave` : « Me retirer », proposé seulement à un participant choisi un par un (on sort d'un staff, pas d'un groupe).
 */
export function Participants({
  x,
  teams,
  who,
  onLeave,
}: {
  x: { editors?: string[]; teams?: string[] }
  teams: Team[]
  who: (uid: string) => string | undefined
  onLeave?: () => void
}) {
  const [open, setOpen] = useState<string | null>(null)
  const s = participantSummary(x, teams)
  if (!s.teams.length && !s.others.length && !s.hidden) return null
  const me = currentUserId()
  const shown = s.teams.find((t) => t.id === open)
  const name = (t: Team, u: string) => t.names?.[u] || who(u) || '?'
  return (
    <div className="mt-1 text-[11px] text-muted">
      Participants :{' '}
      {s.teams.map((t, i) => (
        <span key={t.id}>
          {i > 0 && ', '}
          <button className="font-bold text-fg underline decoration-dotted underline-offset-2" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
            {t.name}
          </button>{' '}
          · {STAFF.count(t.members.length)}
        </span>
      ))}
      {s.hidden > 0 && `${s.teams.length ? ', ' : ''}${STAFF.hidden(s.hidden)}`}
      {s.others.length > 0 && (
        <>
          {(s.teams.length > 0 || s.hidden > 0) && ' + '}
          <b className="text-fg">{s.others.map((u) => who(u) ?? '?').join(', ')}</b>
        </>
      )}
      {onLeave && me && x.editors?.includes(me) && (
        <button className="ml-2 font-bold text-accent underline" onClick={onLeave}>
          Me retirer
        </button>
      )}
      {shown && (
        <div className="mt-0.5">
          {shown.name} : {shown.members.map((u) => (u === me ? 'toi' : name(shown, u))).join(', ') || STAFF.count(0)}
        </div>
      )}
    </div>
  )
}
