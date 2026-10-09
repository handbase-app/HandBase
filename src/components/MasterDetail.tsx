import { createContext, Suspense, useContext, useEffect, useRef, type ReactNode } from 'react'
import { useLocation, useMatch, useNavigate, useOutlet } from 'react-router-dom'
import { ask, canLeave, releaseLeaveGuard, setLeaveGuard } from './Confirm'
import { MQ, useMedia } from '../layout'
import { Icon } from './ui'

/*
 * Maître-détail (ordinateur) : la liste reste à gauche, l'élément choisi s'affiche dans un panneau à droite.
 * L'adresse reste celle de l'élément (/joueurs/:id…) : partageable, et sur téléphone elle ouvre l'écran seul,
 * comme avant. Les lignes de la liste portent `data-md="<id>"` : un clic (ou ↑ ↓) les ouvre dans le panneau.
 */

type Panel = { close: () => void }
const PanelCtx = createContext<Panel | null>(null)

/** Dans le panneau de droite (null ailleurs) : l'écran affiche « Fermer » au lieu du bouton retour. */
export const usePanel = () => useContext(PanelCtx)

/** Élément ouvert dans le panneau (pour le surligner dans la liste) ; undefined sur téléphone. */
export function useSelected(base: string) {
  const split = useMedia(MQ.split)
  const id = useMatch(`${base}/:id`)?.params.id
  return split ? id : undefined
}

/** Surlignage de la ligne ouverte dans le panneau. */
export const selectedCls = (on: boolean) => (on ? 'ring-1 ring-accent border-accent bg-accent/10!' : '')

/** Bouton « Fermer » en haut d'un écran affiché dans le panneau. */
export function PanelClose() {
  const panel = usePanel()
  if (!panel) return null
  return (
    <button onClick={panel.close} title="Fermer (Échap)" className="flex shrink-0 items-center gap-1 text-xs font-bold text-muted hover:text-fg">
      <Icon name="close" className="h-3.5 w-3.5" /> FERMER
    </button>
  )
}

// Champs de texte pour lesquels une saisie compte (pas les recherches ni les menus de tri).
const TYPED = 'textarea, input:not([type]), input[type=text], input[type=number], input[type=email], input[type=tel], input[type=url], input[type=date]'

export default function MasterDetail({ base, list, listCol }: { base: string; list: ReactNode; listCol: string }) {
  const split = useMedia(MQ.split)
  const outlet = useOutlet()
  const id = useMatch(`${base}/:id`)?.params.id
  const nav = useNavigate()
  const loc = useLocation()
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  // Champs du panneau où l'on a tapé quelque chose (remis à zéro à chaque élément ouvert).
  const typed = useRef(new WeakSet<Element>())
  const open = id && split

  /** Ouvre `next` dans le panneau (après vérification d'une saisie en cours). */
  async function show(next: string) {
    if (next === id) return
    if (!(await canLeave())) return
    // Premier élément ouvert : nouvelle entrée d'historique (le retour du navigateur ferme le panneau) ;
    // d'un élément à l'autre : on remplace, pour ne pas empiler chaque joueur parcouru.
    nav(`${base}/${next}`, id ? { replace: true, state: loc.state } : { state: { md: true } })
  }

  async function close() {
    if (!(await canLeave())) return
    if ((loc.state as { md?: boolean } | null)?.md) nav(-1)
    else nav(base, { replace: true })
  }
  const closeRef = useRef(close)
  closeRef.current = close
  const showRef = useRef(show)
  showRef.current = show

  // Nouvel élément : panneau remis en haut, saisies oubliées.
  useEffect(() => {
    panelRef.current?.scrollTo(0, 0)
    typed.current = new WeakSet()
  }, [id])

  // Saisie non enregistrée dans le panneau (formulaire du groupe, de l'événement…) : on demande avant de la perdre.
  useEffect(() => {
    if (!open) return
    const g = async () => {
      const fields = [...(panelRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(TYPED) ?? [])]
      if (!fields.some((f) => typed.current.has(f) && f.value.trim() !== '')) return true
      return ask('Une saisie n’est pas enregistrée. La quitter quand même ?', { ok: 'Quitter sans enregistrer' })
    }
    setLeaveGuard(g)
    return () => releaseLeaveGuard(g)
  }, [open])

  // Échap ferme le panneau ; ↑ ↓ sans élément actif parcourent la liste.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      // Une fenêtre (confirmation, lecteur vidéo…) est ouverte : elle gère ses touches.
      if (document.querySelector('[aria-modal="true"], .fixed.inset-0')) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'Escape') return void closeRef.current()
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (t === document.body || t === document.documentElement)) {
        const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-md]') ?? [])]
        const i = items.findIndex((el) => el.dataset.md === id)
        const next = items[i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)]
        if (!next) return
        e.preventDefault()
        next.focus()
        void showRef.current(next.dataset.md!)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, id])

  if (!split) return id ? outlet : list

  /** Clic sur une ligne de la liste : ouverture dans le panneau, sans quitter la liste (capturé avant le lien). */
  const onClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-md]')
    if (!a || !listRef.current?.contains(a)) return
    // Bouton dans la ligne (étoile « suivre »…) : il garde son rôle.
    const inner = (e.target as HTMLElement).closest('button, input, select, textarea, label')
    if (inner && a.contains(inner) && inner !== a) return
    e.preventDefault()
    void show(a.dataset.md!)
  }

  /** ↑ ↓ dans la liste, panneau ouvert : la fiche suit la ligne active. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!id || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    const t = e.target as HTMLElement
    if (!t.matches('[data-md]')) return
    if (!e.defaultPrevented) {
      // Liste sans navigation au clavier propre (groupes, événements) : ligne précédente / suivante.
      const items = [...listRef.current!.querySelectorAll<HTMLElement>('[data-md]')]
      const next = items[items.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1)]
      e.preventDefault()
      next?.focus()
    }
    const active = document.activeElement as HTMLElement | null
    if (active?.dataset.md && active.dataset.md !== id) void show(active.dataset.md)
  }

  return (
    <div className={open ? 'grid items-start gap-5' : ''} style={open ? { gridTemplateColumns: `${listCol} minmax(0, 1fr)` } : undefined}>
      <div ref={listRef} className={`min-w-0 ${open ? 'md-list' : ''}`} onClickCapture={onClick} onKeyDown={onKeyDown}>
        {list}
      </div>
      {open && (
        <section
          ref={panelRef}
          aria-label="Détail"
          // z-30 : au-dessus de l'en-tête et du menu, pour que les fenêtres ouvertes depuis le panneau (lecteur vidéo…) les couvrent.
          className="md-panel sticky top-[calc(var(--hdr)+1.25rem)] z-30 max-h-[calc(100dvh-var(--hdr)-2.5rem)] overflow-y-auto overscroll-contain rounded-xl border border-line bg-bg px-4 pt-3 pb-6"
          onInput={(e) => {
            if ((e.target as Element).matches(TYPED)) typed.current.add(e.target as Element)
          }}
        >
          <PanelCtx.Provider value={{ close: () => void closeRef.current() }}>
            <Suspense fallback={<div className="py-20 text-center text-sm text-muted">Chargement…</div>}>{outlet}</Suspense>
          </PanelCtx.Provider>
        </section>
      )}
    </div>
  )
}
