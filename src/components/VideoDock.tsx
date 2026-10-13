import { lazy, Suspense, useEffect, useSyncExternalStore, type ComponentProps } from 'react'
import type { Video } from '../db'

/*
 * Lecteur vidéo posé à la racine de l'appli (App.tsx), hors des pages : un changement de mise en page (téléphone tourné :
 * maître-détail, « rail »…) remonte la page et sa section « Vidéos », mais plus le lecteur. Même cadre YouTube, même
 * lecture, même position.
 *
 * La section « Vidéos » (Videos.tsx) ouvre la vidéo ici (`openVideo`), puis fournit à chaque rendu les réglages du
 * lecteur (`useDockPublish` : version à jour du lien, frise, outils, marques). Section démontée sans revenir (on quitte la
 * fiche) : le lecteur se ferme ; remontée tout de suite (rotation) : il reste ouvert et prend ses nouveaux réglages.
 */

/** Lecteur intégré : son code (et celui des lecteurs YouTube/Vimeo) n'est chargé qu'au premier clic sur une vidéo. */
const VideoPlayer = lazy(() =>
  import('./VideoPlayer').catch(() => ({
    default: ({ onClose }: { onClose: () => void }) => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
        <p className="card max-w-sm p-4 text-sm">Le lecteur n’a pas pu être chargé (connexion ?). Réessaie plus tard ou ouvre la vidéo sur son site.</p>
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
/** Sections montées, par propriétaire. */
const mounted = new Map<string, number>()
let seq = 0

/** Temps laissé à une section démontée pour revenir (rotation : la page se redessine, ses données se relisent). */
const GRACE = 1500

export function openVideo(owner: string, v: Video, moment?: number) {
  open = { owner, v, moment, n: ++seq }
  props = undefined
  emit()
}

export function closeVideo() {
  if (!open) return
  open = null
  props = undefined
  emit()
}

/** Vidéo ouverte par cette section (undefined sinon). Ne change qu'à l'ouverture et à la fermeture. */
export function useDockOpen(owner: string) {
  const o = useSyncExternalStore(subscribe, () => open)
  return o?.owner === owner ? o : undefined
}

/** La section est montée (le lecteur ne se ferme pas tant qu'elle l'est, ou qu'elle revient vite). */
export function useDockOwner(owner: string) {
  useEffect(() => {
    mounted.set(owner, (mounted.get(owner) ?? 0) + 1)
    return () => {
      const n = (mounted.get(owner) ?? 1) - 1
      if (n > 0) mounted.set(owner, n)
      else mounted.delete(owner)
      if (n > 0 || open?.owner !== owner) return
      const was = open
      window.setTimeout(() => {
        if (open === was && !mounted.get(owner)) closeVideo()
      }, GRACE)
    }
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
