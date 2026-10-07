import { canFollow, setFollow, useFollows, type FollowKind } from '../follows'
import { Icon } from './ui'

/** Bouton « Suivre / Suivi » (étoile) d'une fiche joueur ou d'un groupe : suivi personnel, privé. */
export function FollowButton({ kind, id }: { kind: FollowKind; id: string }) {
  const follows = useFollows()
  if (!canFollow() || !follows) return null
  const on = kind === 'player' ? follows.players.has(id) : follows.groups.some((g) => g.group.id === id && g.personal)
  return (
    <button
      onClick={() => void setFollow(kind, id, !on)}
      aria-pressed={on}
      title={on ? 'Ne plus suivre' : `Suivre : ses nouvelles mesures et ses nouveaux avis arrivent dans « Mes suivis » (personne d’autre ne le voit)`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
        on ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:border-accent hover:text-fg'
      }`}
    >
      <Icon name="star" filled={on} className={`h-3.5 w-3.5 ${on ? 'text-accent' : ''}`} />
      {on ? 'Suivi' : 'Suivre'}
    </button>
  )
}

/** « Suivi via le groupe … » : joueur déjà suivi par un de mes groupes suivis. */
export function FollowedVia({ playerId }: { playerId: string }) {
  const via = useFollows()?.via.get(playerId)
  if (!via?.length) return null
  return (
    <p className="text-[10px] text-muted">
      Suivi via {via.length === 1 ? 'le groupe' : 'les groupes'} « {via.slice(0, 3).join(' », « ')} »{via.length > 3 ? ` et ${via.length - 3} autres` : ''}
    </p>
  )
}
