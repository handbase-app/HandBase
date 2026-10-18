import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, lazy, Suspense, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { db, type Player } from '../db'
import { canFollow, setFollowMany, useFollows } from '../follows'
import { genderOf, pluralG, w, type Gender } from '../gender'
import { can, useRole } from '../roles'
import { addRewatchMany, markSeenMany, scoutId } from '../scouting'
import {
  canCompare,
  confirmText,
  doneMessage,
  followMode,
  keepOnly,
  needsConfirm,
  selActions,
  selectAll,
  selectionLabel,
  selectionStats,
  toggleId,
  type SelAction,
} from '../selection'
import { ReadOnlyError } from '../spy'
import { AddToEventDialog } from './AddToEvent'
import { compareUrl } from './ComparePick'
import { ask } from './Confirm'
import { AddToGroupDialog } from './Groups'
import { Icon, type IconName } from './ui'

/*
 * Sélection multiple, la même pour toutes les listes de joueurs (PlayerList, components/Pictos.tsx) ; partie pure :
 * src/selection.ts (tools/test-selection.ts).
 * - « Sélectionner », à côté de la barre « Afficher » : une case à cocher sur chaque ligne (PlayerRow) ; toucher la
 *   ligne coche / décoche au lieu d'ouvrir la fiche.
 * - En haut (SelectionHeader) : compteur, « Tout » (toute la liste filtrée, y compris au-delà de « Afficher plus »),
 *   « Aucun », « Garder seulement ceux affichés » (si des cochés sont sortis du filtre), « Annuler ».
 * - En bas, collée au-dessus de la barre de navigation (SelectionBar) : les actions permises par le rôle.
 * Un état par liste (store ci-dessous) : il survit aux filtres et au tri de la liste, pas au changement de page.
 * Chaque ligne ne suit que sa propre case (pas de nouveau rendu de toute la liste à chaque coche).
 */

/** Ce que la liste ajoute aux actions : son événement (« vu », « à revoir » depuis l'événement) ou son groupe. */
export interface SelContext {
  eventId?: string
  groupId?: string
}

type Msg = { text: string; to?: string; link?: string }

class SelStore {
  on = false
  ids: string[] = []
  /** Toute la liste filtrée (au-delà de « Afficher plus »), et ce qui est affiché. Posés à chaque rendu de la liste. */
  all: readonly string[] = []
  shown: readonly string[] = []
  /** Sélection permise sur cette liste (pas en mode « retirer » ni « comparer »). */
  enabled = true
  private set = new Set<string>()
  private v = 0
  private subs = new Set<() => void>()
  subscribe = (f: () => void) => {
    this.subs.add(f)
    return () => void this.subs.delete(f)
  }
  version = () => this.v
  has = (id: string) => this.set.has(id)
  update(p: { on?: boolean; ids?: string[] }) {
    if (p.on !== undefined) this.on = p.on
    if (p.ids) {
      this.ids = p.ids
      this.set = new Set(p.ids)
    }
    this.v++
    this.subs.forEach((f) => f())
  }
  toggle = (id: string) => this.update({ ids: toggleId(this.ids, id) })
}

const SelCtx = createContext<SelStore | null>(null)

/** Sélection d'une liste : un store par PlayerList. `enabled` faux (mode « retirer », comparaison…) : mode quitté. */
export function useListSelection(all: readonly string[], shown: readonly string[], enabled: boolean) {
  const ref = useRef<SelStore>(null)
  if (!ref.current) ref.current = new SelStore()
  const store = ref.current
  store.all = all
  store.shown = shown
  store.enabled = enabled
  const on = useSyncExternalStore(store.subscribe, () => store.on)
  useEffect(() => {
    if (!enabled && store.on) store.update({ on: false, ids: [] })
  }, [enabled, store])
  return { store, on: on && enabled }
}

export function SelectionProvider({ store, children }: { store: SelStore; children: ReactNode }) {
  return <SelCtx.Provider value={store}>{children}</SelCtx.Provider>
}

/**
 * Menu d'une ligne (clic droit, appui long, ⋮) : « Sélectionner » entre en mode sélection avec ce joueur coché
 * (« Désélectionner » s'il l'est déjà). null hors d'une PlayerList qui permet la sélection.
 */
export function useRowSelectItem(id: string): { label: string; onSelect: () => void } | null {
  const store = useContext(SelCtx)
  if (!store || !store.enabled) return null
  const checked = store.on && store.has(id)
  return {
    label: checked ? 'Désélectionner' : 'Sélectionner',
    onSelect: () => store.update(checked ? { ids: store.ids.filter((x) => x !== id) } : { on: true, ids: store.has(id) ? store.ids : [...store.ids, id] }),
  }
}

/** Case d'une ligne : null hors mode sélection (ou hors d'une PlayerList). */
export function useRowSelection(id: string): { checked: boolean; toggle: () => void } | null {
  const store = useContext(SelCtx)
  const state = useSyncExternalStore(
    store?.subscribe ?? noSub,
    () => (!store?.on ? 0 : store.has(id) ? 2 : 1),
  )
  if (!store || !state) return null
  return { checked: state === 2, toggle: () => store.toggle(id) }
}
const noSub = () => () => {}

/** Case à cocher d'une ligne de joueur (PlayerRow) ; `id` relie le libellé (toute la ligne) à la case. */
export function RowCheck({ id, p, checked, toggle, compact }: { id: string; p: Player; checked: boolean; toggle: () => void; compact: boolean }) {
  return (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={toggle}
      aria-label={`Sélectionner ${p.lastName.toUpperCase()} ${p.firstName}`}
      className={`relative z-[1] shrink-0 cursor-pointer accent-[var(--color-accent)] ${compact ? 'h-4 w-4' : 'h-5 w-5'}`}
    />
  )
}

export const useRowCheckId = () => useId()

// ---------- Bouton « Sélectionner » ----------

export function SelectButton({ store, className = '' }: { store: SelStore; className?: string }) {
  const on = useSyncExternalStore(store.subscribe, () => store.on)
  return (
    <button
      type="button"
      aria-pressed={on}
      title={on ? 'Quitter la sélection' : 'Sélectionner des joueurs : une case à cocher sur chaque ligne, puis une action pour tous'}
      onClick={() => store.update(on ? { on: false, ids: [] } : { on: true })}
      className={`flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-bold transition max-[420px]:px-1.5 @max-[30rem]/plb:px-1.5 ${
        on ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-muted hover:text-fg'
      } ${className}`}
    >
      <Icon name="select" className="h-4 w-4" />
      {/* Place étroite (téléphone, colonne de contexte) : l'icône seule (le nom reste lu par les lecteurs d'écran). */}
      <span className="max-[420px]:sr-only @max-[30rem]/plb:sr-only">Sélectionner</span>
    </button>
  )
}

/** Genre de la sélection (« 7 joueuses sélectionnées » si toutes F), lu en lot. */
function useSelGender(ids: string[]): { players: Player[]; g: Gender } {
  const key = ids.join(',')
  const players = useLiveQuery(async () => (key ? (await db.players.bulkGet(key.split(','))).filter((p): p is Player => !!p && !p.deleted) : []), [key])
  return { players: players ?? [], g: genderOf(players ?? []) }
}

// ---------- En haut : compteur, Tout, Aucun, Annuler ----------

export function SelectionHeader({ store }: { store: SelStore }) {
  useSyncExternalStore(store.subscribe, store.version)
  const { g } = useSelGender(store.ids)
  const { n, outside, below, allIn } = selectionStats(store.ids, store.all, store.shown)
  const total = new Set(store.all).size
  const btn = 'min-h-8 rounded-md border border-line bg-panel px-2 font-bold text-fg hover:border-accent disabled:opacity-50'
  return (
    <div role="group" aria-label="Sélection" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-accent bg-panel-2 px-2 py-1.5 text-[11px]">
      <b className="min-w-0 basis-full text-fg sm:mr-auto sm:basis-auto" aria-live="polite">
        {selectionLabel(n, outside, g, below)}
      </b>
      <button type="button" className={btn} disabled={allIn} onClick={() => store.update({ ids: selectAll(store.ids, store.all) })} title={`Cocher toute la liste filtrée (${total}), y compris ${w(g).ceux} pas encore ${total > store.shown.length ? 'affichés (« Afficher plus »)' : 'visibles'}`}>
        Tout ({total.toLocaleString('fr-FR')})
      </button>
      <button type="button" className={btn} disabled={!n} onClick={() => store.update({ ids: [] })}>
        Aucun
      </button>
      {outside > 0 && (
        <button type="button" className={btn} onClick={() => store.update({ ids: keepOnly(store.ids, store.all) })}>
          Garder seulement ceux affichés
        </button>
      )}
      <button type="button" className="ml-auto min-h-8 px-1.5 font-bold text-muted underline hover:text-fg sm:ml-0" onClick={() => store.update({ on: false, ids: [] })}>
        Annuler
      </button>
    </div>
  )
}

// ---------- En bas : actions ----------

const ACTION_ICON: Record<SelAction, IconName> = {
  newGroup: 'users',
  addGroup: 'users',
  newEvent: 'calendar',
  addEvent: 'calendar',
  compare: 'rows',
  follow: 'star',
  seen: 'eye',
  rewatch: 'clock',
}

// Formulaires des pages (chargés à la demande : pas d'import circulaire liste → page).
const GroupForm = lazy(() => import('../pages/Groups').then((m) => ({ default: m.GroupForm })))
const NewEventForm = lazy(() => import('../pages/Evaluate').then((m) => ({ default: m.NewEventForm })))

/** Actions dont le libellé court (téléphone) se passe d'icône. */
const PLAIN: SelAction[] = ['newGroup', 'addGroup', 'newEvent', 'addEvent']

type Dialog = 'newGroup' | 'addGroup' | 'newEvent' | 'addEvent' | null

/** Flèches ← → (et Début / Fin) entre les boutons d'une barre d'outils. */
function toolbarKeys(e: KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const i = btns.indexOf(document.activeElement as HTMLButtonElement)
  if (i < 0) return
  e.preventDefault()
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length
  btns[j].focus()
}

export function SelectionBar({ store, context }: { store: SelStore; context?: SelContext }) {
  useSyncExternalStore(store.subscribe, store.version)
  const role = useRole()
  const nav = useNavigate()
  const follows = useFollows()
  const ids = store.ids
  const n = ids.length
  const { g } = useSelGender(ids)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [busy, setBusy] = useState(false)
  const actions = selActions({
    manageGroups: can.manageGroups(role),
    manageEvents: can.manageEvents(role),
    follow: canFollow() && !!follows,
    scout: !!scoutId(),
    eventId: context?.eventId,
  })
  const mode = followMode(ids, follows?.players ?? new Set())
  const who = n > 1 ? pluralG(n, g) : n ? w(g).ceJoueur : w(g).joueurs

  const LABELS: Record<SelAction, [long: string, short: string]> = {
    newGroup: ['Créer un groupe', '+ Groupe'],
    addGroup: ['Ajouter à un groupe', '→ Groupe'],
    newEvent: ['Créer un événement', '+ Événement'],
    addEvent: ['Ajouter à un événement', '→ Événement'],
    compare: ['Comparer', 'Comparer'],
    follow: mode === 'unfollow' ? ['Ne plus suivre', 'Ne plus suivre'] : ['Suivre', 'Suivre'],
    seen: [`Marquer ${w(g).vu} à cet événement`, `${w(g).vu === 'vue' ? 'Vue' : 'Vu'}`],
    rewatch: ['Mettre à revoir', 'À revoir'],
  }

  async function direct(a: 'follow' | 'seen' | 'rewatch') {
    const what = a === 'follow' ? LABELS.follow[0] : LABELS[a][0]
    if (needsConfirm(n) && !(await ask(confirmText(what, n, g), { ok: what, danger: false }))) return
    setBusy(true)
    try {
      const list = [...ids]
      if (a === 'follow') {
        const done = await setFollowMany(list, mode === 'follow')
        setMsg({ text: doneMessage(mode, done, n, g), ...(mode === 'follow' && done ? { to: '/suivis', link: 'Mes suivis' } : {}) })
      } else if (a === 'seen') {
        const done = await markSeenMany(context!.eventId!, list)
        setMsg({ text: doneMessage('seen', done, n, g) })
      } else {
        const done = await addRewatchMany(list, { originEventId: context?.eventId, groupId: context?.groupId })
        setMsg({ text: doneMessage('rewatch', done, n, g), ...(done ? { to: '/a-revoir', link: 'Voir « À revoir »' } : {}) })
      }
    } catch (e) {
      if (e instanceof ReadOnlyError) setMsg({ text: 'Lecture seule (« Voir comme… ») : rien n’a été changé.' })
      else throw e
    } finally {
      setBusy(false)
    }
  }

  function run(a: SelAction) {
    if (!n) return
    setMsg(null)
    if (a === 'compare') return nav(compareUrl(ids, context?.eventId))
    if (a === 'follow' || a === 'seen' || a === 'rewatch') return void direct(a)
    setDialog(a)
  }

  const disabled = (a: SelAction) => busy || !n || (a === 'compare' && !canCompare(n))
  const title = (a: SelAction) =>
    a === 'compare' && !canCompare(n) ? 'Comparer : coche 2 ou 3 joueurs' : `${LABELS[a][0]} (${who})`

  return (
    <>
      <div className="@container/selbar sticky bottom-[calc(var(--nav-b)+0.5rem)] z-20 flex flex-col gap-1.5 rounded-lg border border-accent bg-panel/95 p-2 shadow-lg backdrop-blur">
        {msg && (
          <p role="status" className="flex flex-wrap items-center gap-x-2 text-[11px] text-fg">
            <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="min-w-0 flex-1">
              {msg.text}{' '}
              {msg.to && (
                <Link to={msg.to} className="font-bold underline">
                  {msg.link}
                </Link>
              )}
            </span>
            <button type="button" className="min-h-8 font-bold text-muted underline hover:text-fg" onClick={() => (store.update({ ids: [] }), setMsg(null))}>
              Tout désélectionner
            </button>
          </p>
        )}
        <div role="toolbar" aria-label={`Actions sur la sélection (${who})`} className="flex flex-wrap gap-1" onKeyDown={toolbarKeys}>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              disabled={disabled(a)}
              title={title(a)}
              aria-label={title(a)}
              onClick={() => run(a)}
              className="flex min-h-9 items-center gap-1 rounded-md border border-line bg-panel-2 px-2 text-[11px] font-bold text-fg hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-muted disabled:opacity-60"
            >
              {/* Place étroite (téléphone, colonne de contexte) : « + Groupe », « → Événement »… sans icône (deux rangées au plus). */}
              <Icon name={ACTION_ICON[a]} filled={a === 'follow' && mode === 'unfollow'} className={`h-4 w-4 shrink-0 ${PLAIN.includes(a) ? '@max-[40rem]/selbar:hidden' : ''}`} />
              <span className="@min-[40rem]/selbar:hidden">{LABELS[a][1]}</span>
              <span className="@max-[40rem]/selbar:hidden">{LABELS[a][0]}</span>
            </button>
          ))}
        </div>
      </div>
      {dialog === 'addGroup' && (
        <AddToGroupDialog
          playerIds={[...ids]}
          onClose={(text, groupId) => (setDialog(null), text && setMsg({ text, to: groupId && `/groupes/${groupId}`, link: 'Ouvrir le groupe' }))}
        />
      )}
      {dialog === 'addEvent' && (
        <AddToEventDialog playerIds={[...ids]} onClose={() => setDialog(null)} onAdded={(text, id) => setMsg({ text, to: `/evenements/${id}`, link: 'Ouvrir l’événement' })} />
      )}
      {dialog === 'newGroup' && (
        <FormDialog title={`Nouveau groupe avec ${who}`} onClose={() => setDialog(null)}>
          <GroupForm
            playerIds={[...ids]}
            defaultSex={g}
            onDone={(grp) => {
              setDialog(null)
              if (grp) setMsg({ text: `Groupe « ${grp.name} » créé avec ${pluralG(grp.playerIds.length, g)}.`, to: `/groupes/${grp.id}`, link: 'Ouvrir le groupe' })
            }}
          />
        </FormDialog>
      )}
      {dialog === 'newEvent' && (
        <FormDialog title={`Nouvel événement avec ${who}`} onClose={() => setDialog(null)}>
          <NewEventForm
            playerIds={[...ids]}
            onDone={(ev) => {
              setDialog(null)
              if (ev) setMsg({ text: `Événement « ${ev.name} » créé avec ${pluralG(ev.playerIds?.length ?? 0, g)}.`, to: `/evenements/${ev.id}`, link: 'Ouvrir l’événement' })
            }}
          />
        </FormDialog>
      )}
    </>
  )
}

/** Fenêtre d'un formulaire (créer un groupe, un événement) au-dessus de la liste ; Échap ou le fond la ferment. */
function FormDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId()
  useEffect(() => {
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className="card flex max-h-[88dvh] w-full max-w-md flex-col gap-3 overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div id={id} className="text-sm font-extrabold">
          {title}
        </div>
        <Suspense fallback={<div className="text-xs text-muted">Chargement…</div>}>{children}</Suspense>
      </div>
    </div>,
    document.body,
  )
}
