import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { depthOf } from '../backCore'
import { ask, pushLeaveGuard, useUnsaved } from './Confirm'
import { FilterWindow, type FilterWindowState } from './FilterWindow'

/*
 * Fenêtre d'un formulaire de création ou de modification (événement, groupe, groupe de travail ; « Dupliquer
 * l'événement ») : même fenêtre que « Filtres » (src/components/FilterWindow.tsx), en dialogue modal. Le fond est voilé,
 * flouté et inactif : on sait ce qu'on est en train de remplir.
 *  - Ordinateur : centrée, ~640 px, titre et ✕ ; téléphone : plein écran.
 *  - Le contenu défile ; le pied reste visible avec les boutons du formulaire (« Créer » ou « Enregistrer », « Annuler »),
 *    posés là par <FormActions> (sans fenêtre, ils restent sous le formulaire, comme avant).
 *  - ✕, Échap et le geste Retour (src/backNav.tsx, useBackCloses) ferment ; si quelque chose a été saisi, on demande
 *    d'abord (« Une saisie n'est pas enregistrée… », comme le reste de l'appli). Les liens qui changent d'écran
 *    consultent la même garde (canLeave).
 */

/** Pied de la fenêtre où <FormActions> pose ses boutons. */
const Slot = createContext<HTMLElement | null>(null)

export function FormWindow({
  title,
  onClose,
  children,
  width = 640,
  phoneFull = true,
  guard = true,
}: {
  title: string
  /** Fermeture demandée (✕, Échap, Retour), après confirmation s'il y a une saisie en cours. */
  onClose: () => void
  children: ReactNode
  /** Largeur maximale sur ordinateur. */
  width?: number
  /** Plein écran sur téléphone (sinon une carte centrée : petite fenêtre de choix). */
  phoneFull?: boolean
  /** Demander avant de perdre une saisie (false : fenêtre de choix sans saisie à perdre). */
  guard?: boolean
}) {
  const id = useId()
  const anchor = useRef<HTMLButtonElement | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  // Quelque chose a été saisi ou changé dans la fenêtre (champ, liste, case).
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = guard && dirty
  const alive = useRef(true)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useUnsaved(guard && dirty)

  const confirmLeave = async () => !dirtyRef.current || (await ask('Une saisie n’est pas enregistrée. La quitter quand même ?', { ok: 'Quitter sans enregistrer' }))

  // Changer d'écran par un lien (menu, ← …) pendant la saisie : même question.
  useEffect(() => {
    alive.current = true
    const release = pushLeaveGuard(confirmLeave)
    // Focus rendu à ce qui l'avait avant l'ouverture (bouton « + Événement »…), s'il est toujours là.
    const before = document.activeElement as HTMLElement | null
    return () => {
      alive.current = false
      release()
      if (before?.isConnected && before !== document.body) before.focus({ preventScroll: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const w: FilterWindowState = {
    open: true,
    setOpen: (open) => {
      if (open) return
      void confirmLeave().then((ok) => ok && alive.current && onCloseRef.current())
    },
    openAt: () => {},
    focus: undefined,
    anchor,
    id,
  }
  const mark = () => {
    if (guard && !dirty) setDirty(true)
  }
  return (
    <FilterWindow
      w={w}
      title={title}
      modal={{ width, phoneFull }}
      closeLabel="Fermer"
      footer={<div ref={setSlot} className="flex min-w-0 flex-1 flex-row-reverse flex-wrap items-center gap-2 [&>*]:min-h-10 sm:[&>.btn-primary]:min-w-36 sm:[&>.btn-primary]:flex-none" />}
    >
      <div className="flex min-w-0 flex-col gap-3" onInputCapture={mark} onChangeCapture={mark}>
        <Slot.Provider value={slot}>{children}</Slot.Provider>
      </div>
    </FilterWindow>
  )
}

/**
 * Boutons d'un formulaire (« Créer » / « Enregistrer » puis « Annuler ») : dans le pied d'une <FormWindow> (toujours
 * visibles, le bouton principal à droite), sinon sous le formulaire comme avant (`className`).
 */
export function FormActions({ children, className = 'flex gap-2' }: { children: ReactNode; className?: string }) {
  const slot = useContext(Slot)
  if (slot) return createPortal(children, slot)
  return <div className={className}>{children}</div>
}

/**
 * Après la fermeture d'une fenêtre, quitter l'écran par l'historique (retour à l'écran d'origine après Enregistrer ou
 * Annuler) : on attend que l'entrée d'historique de la fenêtre (geste Retour, src/backCore.ts) soit retirée, sinon le
 * retour ne ferait que la refermer. Sans fenêtre ouverte : tout de suite.
 */
export function afterWindow(go: () => void) {
  const start = Date.now()
  const tick = () => {
    if (depthOf(history.state) === 0 || Date.now() - start > 1500) go()
    else requestAnimationFrame(tick)
  }
  // Une image plus tard : la fenêtre est démontée et son entrée en cours de retrait.
  requestAnimationFrame(tick)
}
