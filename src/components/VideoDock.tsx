import { lazy, Suspense, useEffect, useSyncExternalStore, type ComponentProps } from 'react'
import { useLocation } from 'react-router-dom'
import { createDockWatch } from '../dockWatch'
import type { Video } from '../db'

/*
 * Lecteur vidéo posé à la racine de l'appli (App.tsx), hors des pages : un changement de mise en page (téléphone tourné :
 * maître-détail, « rail »…) remonte la page et sa section « Vidéos », mais plus le lecteur. Même cadre YouTube, même
 * lecture, même position.
 *
 * La section « Vidéos » (Videos.tsx) ouvre la vidéo ici (`openVideo`), puis fournit à chaque rendu les réglages du
 * lecteur (`useDockPublish` : version à jour du lien, frise, outils, marques). Le lecteur ne se ferme tout seul que si
 * la personne a quitté l'écran de la vidéo : section démontée ET adresse changée (dockWatch.ts). Rotation : même adresse,
 * il attend que la section revienne (si long que soit le rechargement de la fiche) et prend ses nouveaux réglages.
 */

/** Lecteur intégré : son code (et celui des lecteurs YouTube/Vimeo) n'est chargé qu'au premier clic sur une vidéo. */
const VideoPlayer = lazy(() =>
  import('./VideoPlayer').catch(() => ({
    default: ({ onClose }: { onClose: () => void }) => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
        <p className="win max-w-sm p-4 text-sm">Le lecteur n’a pas pu être chargé (connexion ?). Réessaie plus tard ou ouvre la vidéo sur son site.</p>
      </div>
    ),
  })),
)

export type PlayerProps = ComponentProps<typeof import('./VideoPlayer').default>

/** Vidéo ouverte : section propriétaire (« player:<id> », « event:<id> »), lien et moment demandés à l'ouverture. */
export type DockOpen = { owner: string; v: Video; moment?: number; n: number }

let open: DockOpen | null = null
let props: PlayerProps | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
let seq = 0
/** Numéro d'ouverture de la vidéo en mode édition (null : en lecture). */
let editing: number | null = null

/** Adresse de l'écran (le lecteur reste ouvert tant qu'on n'en change pas). */
const here = () => location.pathname + location.search
/** Sections montées et adresse de la vidéo : fermeture quand on a quitté son écran (pas sur une rotation). */
const watch = createDockWatch(() => closeVideo())

export function openVideo(owner: string, v: Video, moment?: number) {
  open = { owner, v, moment, n: ++seq }
  editing = null
  props = undefined
  watch.opened(owner, here())
  emit()
}

export function closeVideo() {
  watch.closed()
  if (!open) return
  open = null
  props = undefined
  editing = null
  emit()
}

/*
 * Mode édition du séquençage (frise de calage d'une vidéo d'événement) : propre à la vidéo ouverte (numéro d'ouverture),
 * gardé ici et non dans la section, pour survivre à une rotation, un plein écran, un changement de mise en page (la section
 * est remontée, pas le lecteur). Jamais retenu : chaque ouverture de vidéo repart en lecture.
 */

/** Passe la vidéo ouverte en mode édition (ou en sort). */
export function setDockEditing(on: boolean) {
  const next = on && open ? open.n : null
  if (next === editing) return
  editing = next
  emit()
}

/** La vidéo ouverte est en mode édition. */
export function useDockEditing() {
  return useSyncExternalStore(subscribe, () => editing !== null && editing === open?.n)
}

/** Vidéo ouverte par cette section (undefined sinon). Ne change qu'à l'ouverture et à la fermeture. */
export function useDockOpen(owner: string) {
  const o = useSyncExternalStore(subscribe, () => open)
  return o?.owner === owner ? o : undefined
}

/** La section est montée (le lecteur ne se ferme pas tant qu'elle l'est, ni tant qu'on reste à la même adresse). */
export function useDockOwner(owner: string) {
  useEffect(() => {
    watch.mount(owner, here())
    // Démontage après une navigation : l'adresse est déjà la nouvelle, le lecteur se ferme.
    return () => watch.unmount(owner, here())
  }, [owner])
}

/** Réglages du lecteur, fournis à chaque rendu de la section propriétaire (undefined : pas encore prêts, on garde les derniers). */
export function useDockPublish(owner: string, next: PlayerProps | undefined) {
  useEffect(() => {
    if (!next || open?.owner !== owner) return
    props = next
    // Le lecteur suit (seul VideoDock écoute ces réglages : la section ne se redessine pas).
    dockListeners.forEach((l) => l())
  })
}

const dockListeners = new Set<() => void>()
let snap: { open: DockOpen | null; props: PlayerProps | undefined } = { open: null, props: undefined }
const dockSnap = () => (snap.open === open && snap.props === props ? snap : (snap = { open, props }))
const dockSubscribe = (l: () => void) => {
  dockListeners.add(l)
  listeners.add(l)
  return () => {
    dockListeners.delete(l)
    listeners.delete(l)
  }
}

/** Lecteur de l'appli (un seul, posé une fois dans App.tsx). */
export default function VideoDock() {
  const s = useSyncExternalStore(dockSubscribe, dockSnap)
  // Adresse changée alors que la section de la vidéo n'est pas montée (partie pendant un rechargement) : fermé.
  // Section montée : sa nouvelle adresse devient celle de la vidéo (ex. avis ouverts sur un événement, ?avis=…).
  const { pathname, search } = useLocation()
  // (window.location, comme à l'ouverture : même forme d'adresse, préfixe du site compris.)
  useEffect(() => watch.navigated(here()), [pathname, search])
  if (!s.open || !s.props) return null
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 text-sm text-white/80" role="status">
          Chargement du lecteur…
        </div>
      }
    >
      <VideoPlayer key={s.open.n} {...s.props} />
    </Suspense>
  )
}
