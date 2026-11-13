import { useParams } from 'react-router-dom'
import { MQ, useMedia } from '../layout'
import { ContextBar, useLeaveTo } from '../components/ContextRoster'
import { playersContext } from '../components/PlayersQuery'
import PlayerDetail from './PlayerDetail'

/**
 * /joueurs/:id : fiche d'un joueur ouverte depuis la liste Joueurs. Ordinateur : la liste filtrée reste à gauche
 * (MasterDetail). Téléphone : glisser la fiche sur la liste filtrée (mêmes filtres, même ordre), le geste Retour ramène à
 * la liste telle quelle ; fiche ouverte directement (lien, rechargement) : la fiche seule.
 */
export default function JoueurFiche() {
  const { id } = useParams()
  const split = useMedia(MQ.split)
  const leave = useLeaveTo('/joueurs', 'JOUEURS')
  const ids = playersContext()
  if (split || !id || ids.length < 2 || !ids.includes(id)) return <PlayerDetail />
  return (
    <ContextBar title="Joueurs" ids={ids} current={id} base="/joueurs" back={() => void leave.go()}>
      <PlayerDetail id={id} hideBack />
    </ContextBar>
  )
}
