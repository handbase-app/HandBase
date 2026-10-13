import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { alive, db, plural, positionLabel, remove, type Player } from '../db'
import { canFollow, setFollow, useFollows } from '../follows'
import { AddToEventDialog } from './AddToEvent'
import { can, useRole } from '../roles'
import { myOpenRewatch, scoutId } from '../scouting'
import { useGlobalComparePick, type ComparePick } from './ComparePick'
import { ask } from './Confirm'
import { AddToGroupDialog } from './Groups'
import { ItemMenu, type MenuAnchor, type MenuItem } from './ItemMenu'
import type { RowLink } from './PlayerRow'
import { RewatchDialog } from './Scouting'
import { playerName } from './ui'

/*
 * Menu d'une ligne de joueur (toutes les listes passent par PlayerRow) : voir la fiche, évaluer, à revoir, suivre,
 * ajouter à un événement ou à un groupe, comparer, modifier la fiche, actions propres à la liste (retirer de
 * l'événement, du groupe), supprimer la fiche (administrateurs, après confirmation). Seulement ce que les droits
 * permettent (can.*), avec les fenêtres existantes.
 */

/** Action propre à la liste (« Retirer de cet événement »…), après les actions communes. */
export type MenuExtra = MenuItem

/** Ce que la page sait de la liste : sa sélection « Comparer » (événement, groupe), son événement. */
export const PlayerMenuScope = createContext<{ pick?: ComparePick; eventId?: string }>({})

type Phase = 'menu' | 'rewatch' | 'event' | 'group'

export function PlayerMenu({ p, anchor, fiche, extras = [], onClose }: { p: Player; anchor: MenuAnchor; fiche: RowLink; extras?: MenuExtra[]; onClose: () => void }) {
  const role = useRole()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const follows = useFollows()
  const scope = useContext(PlayerMenuScope)
  const globalPick = useGlobalComparePick()
  const [phase, setPhase] = useState<Phase>('menu')
  // Mon « à revoir » encore ouvert sur ce joueur : la fenêtre s'ouvre déjà remplie (le modifier ou le retirer).
  const mineOpen = useLiveQuery(() => (scoutId() ? myOpenRewatch(p.id) : undefined), [p.id])
  // Événement de la page (liste d'un événement, fiche ouverte depuis un événement).
  const eventId = scope.eventId ?? pathname.match(/^\/evenements\/([^/?#]+)/)?.[1]
  const pick = scope.pick ?? globalPick
  const name = playerName(p)

  if (phase === 'rewatch') return <RewatchDialog playerId={p.id} originEventId={eventId} onClose={onClose} />
  if (phase === 'event') return <AddToEventDialog playerIds={[p.id]} onClose={onClose} />
  if (phase === 'group') return <AddToGroupDialog playerIds={[p.id]} onClose={onClose} />

  const followed = !!follows?.players.has(p.id)
  const picked = pick.picked.includes(p.id)
  const items: (MenuItem | false)[] = [
    {
      label: 'Voir la fiche',
      icon: 'user',
      onSelect: () => {
        fiche.onClick?.()
        nav(fiche.to, { state: fiche.state, replace: fiche.replace })
      },
    },
    {
      label: 'Évaluer',
      icon: 'check',
      hint: eventId ? 'dans cet événement' : 'avis spontané',
      onSelect: () => nav(eventId ? `/evaluer?evenement=${eventId}&joueur=${p.id}` : `/evaluer?contexte=libre&joueur=${p.id}`),
    },
    !!scoutId() && { label: mineOpen ? 'Modifier mon « à revoir »…' : 'À revoir…', icon: 'clock', stay: true, onSelect: () => setPhase('rewatch') },
    canFollow() && !!follows && { label: followed ? 'Ne plus suivre' : 'Suivre', icon: 'star', filled: followed, onSelect: () => void setFollow('player', p.id, !followed) },
    can.manageEvents(role) && { label: 'Ajouter à un événement…', icon: 'calendar', stay: true, onSelect: () => setPhase('event') },
    can.manageGroups(role) && { label: 'Ajouter à un groupe…', icon: 'users', stay: true, onSelect: () => setPhase('group') },
    {
      label: picked ? 'Retirer de la comparaison' : 'Comparer',
      icon: 'target',
      hint: picked ? undefined : pick.picked.length ? `avec ${pick.picked.length > 1 ? `${pick.picked.length} joueurs choisis` : 'le joueur choisi'}` : 'choisir ensuite 1 ou 2 autres joueurs',
      onSelect: () => {
        if (!pick.on) pick.setOn(true)
        pick.toggle(p.id)
      },
    },
    can.editPlayer(role, p) && { label: can.editPlayers(role) ? 'Modifier la fiche' : 'Modifier ma proposition', icon: 'pencil', onSelect: () => nav(`/joueurs/${p.id}/modifier`) },
    ...extras.map((x, i) => (i === 0 ? { ...x, separated: true } : x)),
    can.deletePlayers(role) && {
      label: 'Supprimer la fiche',
      icon: 'trash',
      danger: true,
      onSelect: async () => {
        const [evs, ms] = await Promise.all([db.evaluations.where('playerId').equals(p.id).toArray(), db.measurements.where('playerId').equals(p.id).toArray()])
        const parts = [alive(evs).length && plural(alive(evs).length, 'avis', 'avis'), alive(ms).length && plural(alive(ms).length, 'mesure')].filter(Boolean)
        const msg = `Supprimer la fiche de ${name} ? Elle disparaît de toutes les listes, pour tout le staff${parts.length ? ` (avec ses ${parts.join(' et ')})` : ''}.`
        if (!(await ask(msg, { ok: 'Supprimer', focusCancel: true }))) return
        await remove('players', p.id)
        if (pathname === `/joueurs/${p.id}`) nav('/joueurs', { replace: true })
      },
    },
  ]
  const year = p.birthDate?.slice(0, 4)
  return (
    <ItemMenu
      anchor={anchor}
      title={name}
      subtitle={[p.position && positionLabel(p.position), year, p.club].filter(Boolean).join(' · ')}
      items={items.filter((x): x is MenuItem => !!x)}
      onClose={onClose}
    />
  )
}
