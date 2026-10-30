import { useLiveQuery } from 'dexie-react-hooks'
import { AppMark, BRAND_FONT, NextarPictogram, NextarStar, NextarWordmark } from './Brand'
import { DEFAULT_APP_NAME } from '../appBrandCore'
import { useAppBrand } from '../appBrand'
import { useSportConfig } from '../installation'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { useBackCloses } from '../backNav'
import { alive, db, today } from '../db'
import {
  ASK_PATH,
  clearHistory,
  HISTORY_KEY,
  PAGE_LABEL,
  pageOfPath,
  parseHistory,
  pushHistory,
  removeHistory,
  routeAsk,
  suggestionsFor,
  type AskApply,
  type AskContext,
  type AskEntry,
  type AskPage,
  type AskRoute,
} from '../demander'
import { useDictation } from '../dictation/useDictation'
import { MAX_PHRASE } from '../dictation/transcribe'
import { can } from '../roles'
import { useSavedQuestions } from '../savedQuestions'
import type { SavedQuestion } from '../recipe'
import { loadTeams } from '../teams'
import { startAskAction } from './AskAction'
import { canLeave } from './Confirm'
import { MicStatus, useMicRecorder } from './MicButton'
import { Spark, useWait, WaitBar } from './Attente'
import { useAiFlight } from '../aiWait'
import { Icon, playerName } from './ui'

/*
 * « Demander » : une seule porte pour tout demander, comme la barre d'adresse d'un navigateur (partie pure : src/demander.ts).
 *  - Le CHAMP : ✦ à gauche, « Un nom, une question, une action… », micro ✨ à droite seulement si la dictée est
 *    disponible (useDictation, comme avant) ; au clavier tout marche sans micro.
 *  - Le MENU à l'ouverture (focus, toucher) : « Récemment » (historique local, horloge, un toucher relance la demande sur
 *    sa page, ✕ pour retirer une entrée), « Essaie » (trois suggestions de la page), « Mes questions enregistrées » (celles
 *    du bilan), « Afficher tout l'historique » (le menu s'allonge, « Effacer l'historique » en bas). Liste Joueurs et bilan
 *    (`saved`) : en tête, champ vide, « Mes filtres » / « Mes questions » (les 5 plus récents, un toucher les applique, puis
 *    « Tous mes filtres (N) » ou « Gérer mes filtres », qui ouvre la liste complète : renommer, supprimer). Depuis la PALETTE, en
 *    tapant : « Je comprends », les propositions de routeAsk (Entrée : la première, ↑ ↓ pour choisir, Échap ferme).
 *    Clavier complet, rôles ARIA (combobox / listbox), focus gardé au champ. Téléphone : le menu devient une feuille sous
 *    le champ, fermée par le geste Retour sans quitter la page (src/backNav.tsx, useBackCloses).
 *  - PLACEMENTS : sur les listes Joueurs, Événements, Groupes et au bilan (PlayersQuery.tsx, ListQuery.tsx,
 *    AskQuestion.tsx), le champ de la page EST ce composant (même comportement qu'avant pour la phrase : recherche locale
 *    ou appel, ajout aux filtres, pastilles). Plus de barre dans l'en-tête : un bouton en capsule « Nextar » (le mot du
 *    logo, le X en étoile filante ; aux couleurs du thème ; nom accessible « Demander : … », bulle d'aide
 *    « Demander à Nextar (touche /) » ; liseré menthe ; pastille micro au bout si la dictée est disponible), au milieu de l'en-tête sur toutes les pages
 *    (AskButton, src/App.tsx). Raccourci « / » hors d'un champ.
 *  - LE BOUTON : il ouvre TOUJOURS la PALETTE (sur téléphone aussi depuis le 25/10, fond flouté) : ordinateur = fenêtre accrochée
 *    sous la bulle (centrée sous elle, 8 px dessous, ~520 px, sans fond assombri ; Échap, clic dehors ou la bulle
 *    ferment), téléphone = la même fenêtre flottante sous la bulle, marges de chaque côté, fond voilé et flouté. Le retour du
 *    téléphone ou du navigateur la ferme (useBackCloses, comme la feuille du menu). Dedans, ce composant en mode « en-tête »
 *    (`routes` = routeAsk, menu toujours ouvert) : « Je comprends », la demande part sur sa page (postAsk →
 *    useIncomingAsk) ou ouvre la fiche, et la palette se ferme. Téléphone, appui long (≥ 450 ms, dictée disponible) : on
 *    parle tout de suite, le bouton rouge pulse, relâcher envoie la phrase (première proposition de routeAsk).
 *  - CONFIDENTIALITÉ : l'historique reste sur l'appareil (localStorage « handbase.demander ») ; les noms de joueurs,
 *    d'événements et de groupes servent seulement à proposer « Ouvrir … », sur l'appareil. Rien de plus ne part à la
 *    fonction « transcrire » qu'avant (la phrase, le schéma, les filtres actifs).
 *    TODO : une ligne dans la page Confidentialité (src/pages/Privacy.tsx, prise par un autre chantier) : « L'historique
 *    de la barre Demander reste sur cet appareil ; « Effacer l'historique » dans le menu de la barre ».
 */

// ---------- Historique local ----------

const listeners = new Set<() => void>()
let cache: AskEntry[] | null = null

function readHistory(): AskEntry[] {
  if (cache) return cache
  try {
    cache = parseHistory(localStorage.getItem(HISTORY_KEY) ?? '[]')
  } catch {
    cache = []
  }
  return cache
}
function writeHistory(next: AskEntry[]) {
  cache = next
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    /* stockage indisponible : gardé jusqu'au rechargement */
  }
  listeners.forEach((l) => l())
}
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== HISTORY_KEY) return
    cache = null
    listeners.forEach((l) => l())
  })

export function useAskHistory(): AskEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    readHistory,
    readHistory,
  )
}
/** Demande appliquée sur une page : en tête de l'historique. */
export const recordAsk = (page: AskPage, text: string) => writeHistory(pushHistory(readHistory(), { text, page }))
export const forgetAsk = (text: string) => writeHistory(removeHistory(readHistory(), text))
export const clearAskHistory = () => writeHistory(clearHistory())

// ---------- Demande envoyée à une page (depuis l'en-tête ou l'historique) ----------

let incoming: { apply: AskApply; at: number } | null = null
const askListeners = new Set<() => void>()
/** Demande à relancer sur sa page (la page la prend en arrivant ; oubliée au bout de 20 s). */
export function postAsk(apply: AskApply) {
  incoming = { apply, at: Date.now() }
  askListeners.forEach((l) => l())
}
/** La page `page` (null : inactive) prend la demande qui lui est destinée, dès qu'elle est prête. */
export function useIncomingAsk(page: AskPage | null, handler: (a: AskApply) => void) {
  const h = useRef(handler)
  useEffect(() => {
    h.current = handler
  })
  useEffect(() => {
    if (!page) return
    const take = () => {
      if (!incoming || incoming.apply.page !== page) return
      if (Date.now() - incoming.at > 20_000) return void (incoming = null)
      const a = incoming.apply
      incoming = null
      h.current(a)
    }
    // Prise au tour suivant, pas pendant le montage : une page montée deux fois de suite (mode strict en développement, ou
    // remontée pendant son chargement) ne prend la demande qu'une fois montée pour de bon. Avant, la première prise lançait
    // la question, le démontage l'annulait (bilan : la carte s'ouvrait sans réponse) et la demande était déjà consommée.
    const t = window.setTimeout(take, 0)
    askListeners.add(take)
    return () => {
      window.clearTimeout(t)
      askListeners.delete(take)
    }
  }, [page])
}

// ---------- Le champ et son menu ----------

const isPhone = () => {
  try {
    return window.matchMedia('(max-width: 639px)').matches
  } catch {
    return false
  }
}
const SHORT = 5

type Option = { id: string; run: () => void; node: ReactNode; cls?: string }

/** Questions enregistrées montrées en tête du menu (champ vide) : liste Joueurs (« Mes filtres »), bilan (« Mes questions »). */
export type SavedMenu = {
  title: string
  items: SavedQuestion[]
  /** Un toucher : la question est appliquée (comme « Appliquer » de la liste complète). */
  onPick: (q: SavedQuestion) => void
  /** Ouvre la liste complète (renommer, supprimer) ; `all` : « Tous mes filtres (N) », `manage` : « Gérer mes filtres ». */
  onShowAll: () => void
  all: (n: number) => string
  manage: string
}

export type DemanderProps = {
  /** Page du champ : historique et suggestions. */
  page: AskPage
  value: string
  onChange: (v: string) => void
  /** Entrée, ✨, suggestion ou entrée d'historique de cette page : la demande (la page décide : recherche ou appel). */
  onSubmit: (text: string) => void
  /** Les phrases sont comprises ici (suggestions ; sinon le champ reste une recherche de nom). */
  canAsk: boolean
  /** La saisie est un simple nom (recherche instantanée) : pas de bouton ✨. */
  nameMode?: boolean
  /** Micro ✨ (useMicRecorder), avec son exemple ; absent : pas de micro. */
  mic?: ReturnType<typeof useMicRecorder>
  micHint?: string
  disabled?: boolean
  compact?: boolean
  placeholder?: string
  label?: string
  /** Champ de simple recherche (canAsk faux) : ce qu'on peut y taper (bulle d'aide, menu sans historique). */
  hint?: string
  /** En-tête : propositions de routeAsk (« Je comprends ») ; `go` les exécute. */
  routes?: AskRoute[]
  go?: (r: AskRoute) => void
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
  /** Le champ prend le focus (la liste Joueurs charge ses données lourdes à ce moment). */
  onFocus?: () => void
  /** Bouton logé DANS la barre, tout à droite (listes : l'étiquette « Filtres », comme « Mode IA » chez Google). */
  trailing?: ReactNode
  /** Dans la palette du bouton « Demander » : le menu reste ouvert, posé sous le champ (ni liste flottante ni feuille). */
  embedded?: boolean
  /** Palette : Échap la ferme. */
  onEscape?: () => void
  /**
   * La page attend l'assistant pour cette barre (phrase envoyée) : ✦ qui tourne, « Je cherche… », fine barre sous la pilule,
   * « Annuler » si `cancel` est donné ; `phrase` (dite au micro) s'affiche dans le champ vide. La transcription du micro de la barre (mic) fait de même, sans rien à passer.
   */
  wait?: { cancel?: () => void; phrase?: string } | null | false
  /** La liste se recalcule sur l'appareil : fine barre en va-et-vient sous la pilule (si le calcul dure). */
  calculating?: boolean
  /** Questions enregistrées en tête du menu (champ vide) ; absent : le lien « Mes questions enregistrées (N) » vers le bilan. */
  saved?: SavedMenu
}

export function Demander(p: DemanderProps) {
  const id = useId()
  const nav = useNavigate()
  const history = useAskHistory()
  const saved = useSavedQuestions()
  const [open, setOpen] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [active, setActive] = useState(-1)
  const wrap = useRef<HTMLDivElement>(null)
  const ownRef = useRef<HTMLInputElement>(null)
  const inputRef = p.inputRef ?? ownRef
  const suggestions = useMemo(() => (p.canAsk ? suggestionsFor(p.page, { today: today() }) : []), [p.canAsk, p.page])
  const header = !!p.routes
  const text = p.value.trim()
  const rec = p.mic ? p.mic.phase === 'recording' || p.mic.phase === 'opening' : false
  const sending = p.mic?.phase === 'sending'
  const embedded = !!p.embedded
  // Attente de l'assistant (phrase envoyée par la page, ou transcription du micro) : signe dans la pilule et juste dessous.
  const wait = useWait(!!p.wait || sending, sending ? 'dictee' : 'question')
  const cancelWait = p.wait ? p.wait.cancel : sending ? p.mic?.cancel : undefined

  // ---------- Ouverture / fermeture ----------
  const openMenu = () => {
    if (open) return
    const ph = !embedded && isPhone()
    setSheet(ph)
    setOpen(true)
    setActive(-1)
    setShowAll(false)
  }
  const close = (opts: { blur?: boolean } = {}) => {
    if (!open || embedded) return // palette : le menu reste, la palette se ferme quand la demande part
    setOpen(false)
    setActive(-1)
    if (sheet) inputRef.current?.blur()
    else if (!opts.blur) inputRef.current?.focus({ preventScroll: true })
  }
  // Téléphone : le geste Retour (ou le bouton du navigateur) ferme la feuille sans quitter la page ; une page ouverte
  // depuis la feuille prend la place de son entrée d'historique (src/backNav.tsx, useBackCloses).
  useBackCloses(
    () => {
      setOpen(false)
      setActive(-1)
      inputRef.current?.blur()
    },
    open && sheet,
  )
  // Ordinateur : un clic ailleurs ferme (le focus part).
  useEffect(() => {
    if (!open || sheet || embedded) return
    const down = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close({ blur: true })
    }
    document.addEventListener('pointerdown', down, true)
    return () => document.removeEventListener('pointerdown', down, true)
  }) // eslint-disable-line react-hooks/exhaustive-deps
  // Position de la feuille (téléphone) : sous le champ, jusqu'en bas de l'écran.
  const [top, setTop] = useState(0)
  useLayoutEffect(() => {
    if (!open || !sheet) return
    const place = () => setTop(Math.max(0, (wrap.current?.getBoundingClientRect().bottom ?? 0) + 4))
    place()
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [open, sheet])


  // ---------- Actions ----------
  /** Relance une demande : sur cette page (onSubmit), ou sur la page d'une entrée d'historique (postAsk + navigation). */
  const relaunch = async (e: AskEntry) => {
    if (e.page === p.page && !header) {
      p.onChange(e.text)
      close()
      p.onSubmit(e.text)
      return
    }
    if (header && p.go) {
      // Depuis l'en-tête : relue comme une nouvelle demande (première proposition), sur sa page d'origine si elle y colle.
      const rs = routeAsk(e.text)
      const r = rs[0]?.kind === 'action' ? rs[0] : (rs.find((x) => x.apply?.page === e.page) ?? rs[0])
      if (r) {
        close()
        p.go(r)
      }
      return
    }
    if (!(await canLeave())) return
    postAsk({ page: e.page, phrase: e.text })
    close()
    nav(ASK_PATH[e.page])
  }
  const pickSuggestion = (s: string) => {
    if (header && p.go) {
      const r = routeAsk(s)[0]
      if (!r) return
      close()
      p.go(r)
      return
    }
    p.onChange(s)
    close()
    p.onSubmit(s)
  }
  const submit = () => {
    if (!text || p.disabled) return
    if (header && p.go) {
      const r = p.routes?.[0] ?? routeAsk(text)[0]
      if (!r) return
      close()
      p.go(r)
      return
    }
    close()
    p.onSubmit(p.value)
  }

  // ---------- Options du menu (dans l'ordre du clavier) ----------
  const options: Option[] = []
  const sections: { title?: string; items: Option[] }[] = []
  const add = (title: string | undefined, items: Option[]) => {
    if (!items.length) return
    sections.push({ title, items })
    options.push(...items)
  }
  const roomy = sheet || (embedded && isPhone())
  const rowCls = (i: number, extra = '') =>
    `flex w-full cursor-pointer items-center gap-2.5 text-left ${roomy ? 'min-h-11 px-4 text-sm' : 'min-h-9 px-3 text-[13px]'} ${active === i ? 'bg-ai-soft' : 'hover:bg-panel-2'} ${extra}`
  let k = 0
  if (header && text && p.routes?.length) {
    add(
      'Je comprends',
      p.routes.map((r) => ({
        id: `r${k++}`,
        run: () => {
          close()
          p.go?.(r)
        },
        node: (
          <>
            <span className={`shrink-0 text-base font-extrabold ${r.kind === 'select' ? 'text-suggest' : 'text-ai'}`} aria-hidden>
              {r.kind.startsWith('open') ? '↗' : r.kind === 'bilan' ? '?' : r.kind === 'select' ? '+' : r.kind === 'action' ? '✦' : '→'}
            </span>
            <span className="flex min-w-0 flex-col py-1">
              <span className="truncate font-bold">{r.label}</span>
              {r.hint && <span className="truncate text-[11px] font-normal text-muted">{r.hint}</span>}
            </span>
          </>
        ),
      })),
    )
  }
  const shownHistory = showAll ? history : history.slice(0, SHORT)
  const mine = p.saved
  if (mine && !header && !text && mine.items.length) {
    add(mine.title, [
      ...mine.items.slice(0, SHORT).map((q) => ({
        id: `q${k++}`,
        run: () => {
          close()
          mine.onPick(q)
        },
        node: (
          <>
            <Icon name="star" className="h-4 w-4 shrink-0 text-accent" />
            <span className="flex min-w-0 flex-1 flex-col py-1">
              <span className="truncate">{q.name}</span>
              {q.sql && <span className="truncate text-[11px] text-muted">Mode avancé</span>}
            </span>
          </>
        ),
      })),
      {
        id: `q${k++}`,
        run: () => {
          close({ blur: true })
          mine.onShowAll()
        },
        node: (
          <>
            <Icon name="rows" className="h-4 w-4 shrink-0 text-muted" />
            <span className="py-1 font-bold">{mine.items.length > SHORT ? mine.all(mine.items.length) : mine.manage}</span>
          </>
        ),
      },
    ])
  }
  if (!(header && text)) {
    add(
      'Récemment',
      shownHistory.map((e) => ({
        id: `h${k++}`,
        run: () => void relaunch(e),
        node: (
          <>
            <Icon name="clock" className="h-4 w-4 shrink-0 text-muted" />
            <span className="flex min-w-0 flex-1 flex-col py-1">
              <span className="truncate">{e.text}</span>
              {e.page !== p.page && <span className="truncate text-[11px] text-muted">{PAGE_LABEL[e.page]}</span>}
            </span>
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Retirer « ${e.text} » de l’historique`}
              title="Retirer de l’historique"
              className={`shrink-0 rounded-md px-2 py-1 text-muted hover:text-fg ${roomy ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [[aria-selected=true]_&]:opacity-100'}`}
              onPointerDown={(e2) => e2.stopPropagation()}
              onClick={(e2) => {
                e2.stopPropagation()
                forgetAsk(e.text)
              }}
            >
              ✕
            </button>
          </>
        ),
        cls: 'group',
      })),
    )
    add(
      'Essaie',
      suggestions.map((s) => ({
        id: `s${k++}`,
        run: () => pickSuggestion(s),
        node: (
          <>
            <span className="shrink-0 text-ai" aria-hidden>
              ✦
            </span>
            <span className="truncate py-1">{s}</span>
          </>
        ),
      })),
    )
    const links: Option[] = []
    if (saved.length && !mine)
      links.push({
        id: `l${k++}`,
        run: () => {
          close()
          // Ouvert depuis la feuille ou la palette ✦ : le bilan prend la place de leur entrée d'historique.
          void canLeave().then((ok) => ok && nav('/bilan'))
        },
        node: (
          <>
            <Icon name="star" className="h-4 w-4 shrink-0 text-accent" />
            <span className="py-1 font-bold">Mes questions enregistrées ({saved.length})</span>
          </>
        ),
      })
    if (history.length > SHORT && !showAll)
      links.push({
        id: `l${k++}`,
        run: () => setShowAll(true),
        node: (
          <>
            <Icon name="rows" className="h-4 w-4 shrink-0 text-muted" />
            <span className="py-1 font-bold">Afficher tout l’historique ({history.length})</span>
          </>
        ),
      })
    if (showAll && history.length)
      links.push({
        id: `l${k++}`,
        run: () => {
          clearAskHistory()
          setShowAll(false)
        },
        node: (
          <>
            <Icon name="trash" className="h-4 w-4 shrink-0 text-muted" />
            <span className="py-1 font-bold">Effacer l’historique</span>
          </>
        ),
      })
    add(undefined, links)
  }
  const activeId = active >= 0 && options[active] ? `${id}-${options[active].id}` : undefined

  // ---------- Clavier ----------
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return openMenu()
      if (!options.length) return
      const d = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a < 0 ? (d > 0 ? 0 : options.length - 1) : (a + d + options.length) % options.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && active >= 0 && options[active]) options[active].run()
      else submit()
    } else if (e.key === 'Escape') {
      if (embedded) {
        e.preventDefault()
        p.onEscape?.()
      } else if (open) {
        e.preventDefault()
        close()
      } else if (p.value) p.onChange('')
    } else if (e.key === 'Tab' && !embedded) close({ blur: true })
    else if ((e.key === 'Home' || e.key === 'End') && open && active >= 0) {
      e.preventDefault()
      setActive(e.key === 'Home' ? 0 : options.length - 1)
    }
  }

  // ---------- Rendu ----------
  const empty = !options.length && !(header && p.mic && p.mic.phase !== 'idle')
  const menuBody = (
    <div role="listbox" id={`${id}-list`} aria-label="Demander : propositions" className="flex flex-col py-1">
      {header && p.mic && p.mic.phase !== 'idle' && (
        <div className="px-3 py-2">
          <MicStatus mic={p.mic} dictated={false} />
        </div>
      )}
      {empty && (
        <p className="px-3 py-2 text-[11px] text-muted">
          {header ? 'Tapez un nom, une question ou une action, puis Entrée.' : p.canAsk ? 'Un nom, ou une phrase (Entrée) : vos demandes apparaîtront ici.' : (p.hint ?? 'Un nom, un club, une licence.')}
        </p>
      )}
      {sections.map((s, si) => (
        <div key={si} role="presentation" className={si > 0 ? 'mt-1 border-t border-line pt-1' : ''}>
          {s.title && (
            <div role="presentation" className={`px-3 pt-1.5 pb-0.5 text-[10px] font-extrabold tracking-wider uppercase ${s.title === 'Je comprends' ? 'text-ai' : 'text-muted'}`}>
              {s.title}
            </div>
          )}
          {s.items.map((o) => {
            const i = options.indexOf(o)
            return (
              <div
                key={o.id}
                id={`${id}-${o.id}`}
                role="option"
                aria-selected={active === i}
                tabIndex={-1}
                className={rowCls(i, o.cls)}
                onMouseEnter={() => setActive(i)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={o.run}
              >
                {o.node}
              </div>
            )
          })}
        </div>
      ))}
      {header && text && (
        <p className="border-t border-line px-3 pt-1.5 pb-1 text-[10px] text-muted">Entrée : première proposition · ↑ ↓ pour choisir · Échap pour fermer</p>
      )}
    </div>
  )
  const menu = embedded ? (
    <div className="mt-2 border-t border-line">{menuBody}</div>
  ) : !open ? null : sheet ? (
    createPortal(
      <div className="fixed inset-0 z-40" onPointerDown={(e) => e.stopPropagation()}>
        <div className="absolute inset-0 bg-black/40" style={{ top }} onClick={() => close()} aria-hidden />
        <div
          className="absolute inset-x-0 bottom-0 flex flex-col overflow-y-auto overscroll-contain rounded-t-win border-t border-ai/40 bg-panel pb-[max(0.5rem,var(--nav-b))] shadow-2xl"
          style={{ top }}
        >
          {menuBody}
          <button type="button" className="mt-1 flex min-h-11 w-full items-center justify-center border-t border-line text-sm font-bold text-muted" onClick={() => close()}>
            Fermer
          </button>
        </div>
      </div>,
      document.body,
    )
  ) : (
    <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-[min(70vh,28rem)] overflow-y-auto overscroll-contain rounded-win border border-ai/40 bg-panel shadow-2xl">{menuBody}</div>
  )

  const h = p.compact ? 'min-h-9' : 'min-h-12'
  return (
    <div ref={wrap} className={`relative min-w-0 flex-1 ${p.className ?? ''}`}>
      <form
        className="flex min-w-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {/* Barre en pilule, façon Google : tout est DANS la barre (✦, texte, ✕, envoi ou micro, « Filtres »). */}
        <div
          className={`flex ${h} min-w-0 flex-1 items-center gap-1 rounded-full border border-line bg-panel py-0 pr-1.5 pl-4 shadow-sm transition-shadow focus-within:border-ai focus-within:shadow-md ${p.compact ? 'text-xs' : ''}`}
        >
          <Spark busy={wait.on} />
          <input
            ref={inputRef}
            id={`${id}-in`}
            data-search
            className="min-w-0 flex-1 bg-transparent py-1.5 pl-1 text-inherit outline-none placeholder:text-muted/70"
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            aria-haspopup="listbox"
            enterKeyHint={p.nameMode && !header ? 'search' : 'send'}
            placeholder={wait.on ? '' : (p.placeholder ?? (header || p.canAsk ? 'Un nom, une question, une action…' : 'Un nom, un club, une licence…'))}
            aria-label={p.label ?? 'Demander : un nom, une question, une action'}
            title={p.canAsk ? `Un nom, un club, une licence ; ou une phrase${p.micHint ? ` (« ${p.micHint} »)` : ''}, puis Entrée` : (p.hint ?? 'Nom, club ou licence')}
            value={p.value || (wait.on && p.wait ? (p.wait.phrase ?? '') : '')}
            maxLength={MAX_PHRASE}
            disabled={p.disabled || sending || rec}
            aria-busy={wait.on || undefined}
            onChange={(e) => {
              p.onChange(e.target.value)
              setActive(-1)
              if (!open) openMenu()
            }}
            onFocus={() => {
              p.onFocus?.()
              openMenu()
            }}
            onClick={openMenu}
            onKeyDown={onKey}
          />
          {wait.on && (
            // Pendant l'attente : le texte court (et « ≈ 2 s » si fiable) à la place des boutons, puis « Annuler ».
            <>
              <span role="status" className={`shrink-0 px-1 font-bold whitespace-nowrap text-ai ${p.compact ? 'text-[11px]' : 'text-xs'}`}>
                {wait.text}
                {wait.eta && <span className="ml-1 font-normal tabular-nums text-muted">{wait.eta}</span>}
              </span>
              {cancelWait && (
                <button
                  type="button"
                  className={`shrink-0 rounded-full px-2 font-bold text-muted underline hover:text-fg ${p.compact ? 'min-h-7 text-[11px]' : 'min-h-9 text-xs'}`}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={cancelWait}
                >
                  Annuler
                </button>
              )}
            </>
          )}
          {p.value && !wait.on && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Effacer"
              className={`flex ${p.compact ? 'h-7 w-7' : 'h-9 w-9'} shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                p.onChange('')
                inputRef.current?.focus({ preventScroll: true })
              }}
            >
              ✕
            </button>
          )}
          {wait.on ? null : p.canAsk && !p.nameMode && !header && text && !rec && !sending ? (
            // Une phrase tapée : l'envoi remplace le micro (une seule action à droite).
            <button
              type="submit"
              className={`flex ${p.compact ? 'h-7 w-7' : 'h-9 w-9'} shrink-0 items-center justify-center rounded-full bg-ai text-white hover:opacity-90 disabled:opacity-60`}
              disabled={p.disabled}
              aria-label="Envoyer la demande"
              title="Envoyer (Entrée)"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          ) : (
            p.mic && (
              <button
                type="button"
                data-noswipe
                aria-label={rec ? 'Arrêter et appliquer' : sending ? 'Phrase en cours' : 'Demander à la voix'}
                aria-pressed={rec}
                title={rec ? 'Arrêter : la phrase est transcrite puis appliquée' : `Touchez et dites par exemple « ${p.micHint ?? 'les gauchers de 2011'} » ; touchez à nouveau pour finir (ou maintenez pendant que vous parlez)`}
                disabled={sending || p.disabled}
                className={`relative flex ${p.compact ? 'h-7 w-7' : 'h-9 w-9'} shrink-0 touch-none items-center justify-center rounded-full transition select-none [-webkit-touch-callout:none] ${
                  rec ? 'bg-red-600 text-white shadow-[0_0_0_4px_rgba(220,38,38,0.35)]' : 'text-fg hover:bg-panel-2 active:bg-ai active:text-white'
                } disabled:opacity-70`}
                {...p.mic.buttonProps}
              >
                {sending ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : rec ? (
                  <span className="h-3.5 w-3.5 rounded-sm bg-white" />
                ) : (
                  <Icon name="mic" className={p.compact ? 'h-4 w-4' : 'h-5 w-5'} />
                )}
              </button>
            )
          )}
          {p.trailing}
        </div>
      </form>
      {/* Fine barre juste sous la pilule (pas de nouvelle barre : elle ne prend pas de place). */}
      <WaitBar wait={wait} calc={!!p.calculating && !wait.on} className={`absolute bottom-[-5px] ${p.compact ? 'inset-x-3' : 'inset-x-5'}`} />
      {menu}
    </div>
  )
}

// ---------- Le bouton « Demander » de l'en-tête et sa palette ----------

/** Appui long sur le bouton (téléphone) : dictée immédiate. Même seuil que « maintenir pour parler » du micro. */
const LONG_PRESS_MS = 450

/**
 * Noms de l'appareil pour « Ouvrir … » (joueurs, événements, groupes que le compte voit) : lus seulement quand on tape
 * dans la palette ou qu'on dicte ; jamais envoyés.
 */
function useAskContext(wanted: boolean): AskContext {
  const names = useLiveQuery(async () => {
    if (!wanted) return undefined
    const [players, events, groups] = await Promise.all([db.players.toArray(), db.events.toArray(), loadTeams().then(() => db.groups.toArray())])
    return {
      players: alive(players)
        .filter((p) => p.review !== 'refused')
        .map((p) => ({ id: p.id, name: playerName(p) })),
      events: alive(events).map((e) => ({ id: e.id, name: e.name })),
      groups: alive(groups)
        .filter((g) => can.seeGroup(g))
        .map((g) => ({ id: g.id, name: g.name })),
    }
  }, [wanted])
  return names ?? {}
}

/** Contenu de la palette : le champ « Demander » en mode en-tête (propositions de routeAsk), son menu toujours ouvert. */
function AskPalette({ go, inputRef, onEscape }: { go: (r: AskRoute, said: string) => void; inputRef: RefObject<HTMLInputElement | null>; onEscape: () => void }) {
  const loc = useLocation()
  const { questionReady } = useDictation()
  const [text, setText] = useState('')
  const ctx = useAskContext(!!text.trim())
  const routes = useMemo(() => routeAsk(text, ctx), [text, ctx])
  // Micro de la palette : la phrase dite est relue comme une demande tapée (première proposition).
  const mic = useMicRecorder((t) => {
    const r = routeAsk(t, ctx)[0]
    if (r) go(r, t)
  })
  return (
    <Demander
      page={pageOfPath(loc.pathname)}
      value={text}
      onChange={setText}
      onSubmit={() => {}}
      canAsk={questionReady}
      routes={routes}
      go={(r) => go(r, text)}
      inputRef={inputRef}
      mic={questionReady ? mic : undefined}
      micHint="ouvre la fiche de Martin » ou « les gauchers de 2011"
      embedded
      onEscape={onEscape}
    />
  )
}

/** Hauteur cachée en bas par le clavier du téléphone (la feuille se pose juste au-dessus). */
export function useKeyboardInset(on: boolean) {
  const [kb, setKb] = useState({ bottom: 0, height: 0 })
  useEffect(() => {
    const vv = window.visualViewport
    if (!on || !vv) return
    const place = () => setKb({ bottom: Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)), height: Math.round(vv.height) })
    place()
    vv.addEventListener('resize', place)
    vv.addEventListener('scroll', place)
    return () => {
      vv.removeEventListener('resize', place)
      vv.removeEventListener('scroll', place)
    }
  }, [on])
  return kb
}

/**
 * Bulle ✦ « Demander » de l'en-tête, sur toutes les pages (ordinateur : à gauche ; téléphone : au milieu ; « / » hors d'un champ).
 *  - Page qui a sa barre « Demander » (listes, bilan) : le curseur va dans cette barre, son menu s'ouvre.
 *  - Ailleurs : la palette, une fenêtre flottante sous la bulle (téléphone : une marge de chaque côté, fond voilé, geste Retour).
 *  - Téléphone, appui long (dictée disponible) : on parle tout de suite, relâcher envoie la phrase.
 *  - Pastille micro au bout de la capsule (dictée disponible seulement) : un toucher (ou un clic) lance la même dictée,
 *    un second toucher l'envoie ; pendant l'enregistrement, la capsule pulse en rouge et la pastille montre un carré.
 *  - `rail` (téléphone couché, plus d'en-tête : src/App.tsx) : en haut du menu de gauche, le pictogramme de l'appli (le X et
 *    l'étoile filante, l'étoile tourne pendant une demande) ; même toucher, même appui long ; la fenêtre s'ouvre à droite
 *    du menu, sur le fond voilé et flouté du téléphone.
 */
export function AskButton({ rail = false, dock = false }: { rail?: boolean; dock?: boolean } = {}) {
  const brand = useAppBrand()
  const nextar = brand.name.toLowerCase() === DEFAULT_APP_NAME.toLowerCase()
  // Nom du sport de l'installation (« Handball », « Volley ») : dit aux lecteurs d'écran après « Nextar » (plus écrit dans
  // la capsule ; il reste sous le logo de l'icône, tools/icones-sport.py).
  const { sportName } = useSportConfig()
  const nav = useNavigate()
  const loc = useLocation()
  const { questionReady } = useDictation()
  // Une demande à l'assistant en cours, où qu'elle soit (liste, bilan, carte d'action) : la bulle ✦ tourne doucement.
  const flight = useAiFlight()
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  /** La capsule entière (bouton + pastille micro) : la palette se centre dessous, un clic dedans ne la ferme pas. */
  const cap = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const kb = useKeyboardInset(open && phone)
  // Ordinateur : la palette s'accroche sous la bulle (bord gauche aligné, 8 px dessous), sans sortir de l'écran.
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null)
  const measure = () => {
    // Téléphone tenu droit : le rond est en bas à droite (App.tsx) ; la fenêtre reste en haut, juste sous l'en-tête (--hdr),
    // au-dessus du clavier.
    if (dock) return { left: 0, top: (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr')) || 56) + 8, width: 0 }
    const b = (cap.current ?? btn.current)?.getBoundingClientRect()
    if (!b) return null
    // Téléphone couché : à droite du menu de gauche, en haut de l'écran (le bouton est en haut du menu).
    if (rail) {
      const left = Math.round(b.right + 8)
      return { left, top: Math.max(8, Math.round(b.top)), width: Math.min(520, window.innerWidth - left - 12) }
    }
    const width = Math.min(520, window.innerWidth - 16)
    // Centrée sous la bulle (au milieu de l'en-tête), sans sortir de l'écran.
    return { left: Math.round(Math.max(8, Math.min(b.left + b.width / 2 - width / 2, window.innerWidth - width - 8))), top: Math.round(b.bottom + 8), width }
  }

  const openPalette = () => {
    if (open) return input.current?.focus()
    const ph = isPhone() || rail || dock
    // Rendu tout de suite, pour donner le focus dans le même geste (le clavier du téléphone s'ouvre).
    flushSync(() => {
      setPhone(ph)
      setPlace(measure())
      setOpen(true)
    })
    input.current?.focus({ preventScroll: true })
  }
  const closePalette = () => {
    if (!open) return
    setOpen(false)
  }
  // Geste Retour (ou bouton du navigateur) : ferme la palette sans quitter la page ; une page ouverte depuis la palette
  // prend la place de son entrée d'historique (src/backNav.tsx, useBackCloses).
  useBackCloses(() => setOpen(false), open)
  const closeRef = useRef(closePalette)
  useEffect(() => {
    closeRef.current = closePalette
  })
  // Partie ailleurs par un lien du menu (« Mes questions enregistrées ») : la palette se ferme.
  const path = useRef(loc.pathname)
  useEffect(() => {
    if (path.current === loc.pathname) return
    path.current = loc.pathname
    setOpen(false)
  }, [loc.pathname])

  // Ordinateur : un clic hors de la palette (et hors de la bulle) la ferme, et ce clic garde son effet ; la fenêtre
  // redimensionnée, elle reste sous la bulle.
  useEffect(() => {
    if (!open || phone) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (dialog.current?.contains(t) || btn.current?.contains(t) || cap.current?.contains(t)) return
      closeRef.current()
    }
    const resize = () => setPlace(measure())
    document.addEventListener('pointerdown', down, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      window.removeEventListener('resize', resize)
    }
  }, [open, phone]) // eslint-disable-line react-hooks/exhaustive-deps
  // Échap, même quand le curseur n'est plus dans le champ (le champ le traite lui-même).
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /**
   * Clic ou « / » : TOUJOURS la fenêtre sous le bouton (ordinateur : choix de Geoffroy, 20/10 ; téléphone aussi depuis le
   * 25/10 : une fenêtre par-dessus la page, fond flouté, plutôt que le curseur dans la barre de la liste).
   */
  const trigger = () => {
    openPalette()
  }
  const triggerRef = useRef(trigger)
  useEffect(() => {
    triggerRef.current = trigger
  })
  // « / » hors d'un champ.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      triggerRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** Une demande part (palette, dictée) : relue sur sa page (postAsk), ou la page ouverte ; une action : sa carte, ici. */
  const go = async (r: AskRoute, said: string) => {
    if (r.kind === 'action' && r.action) {
      const page = pageOfPath(loc.pathname)
      recordAsk(page, said.trim() || r.action.phrase)
      // La carte d'action s'ouvre par-dessus l'écran (sa propre entrée d'historique).
      setOpen(false)
      startAskAction(r.action.phrase, page, r.action.detected)
      return
    }
    if (!(await canLeave())) return
    recordAsk(r.apply?.page ?? pageOfPath(r.to), said.trim() || r.apply?.phrase || r.label)
    setOpen(false)
    if (r.apply) postAsk(r.apply)
    // La page demandée prend la place de l'entrée d'historique de la palette (retirée si l'on reste ici).
    if (loc.pathname !== r.to) nav(r.to)
  }

  // ---------- Appui long : dictée immédiate (comme un vocal) ----------
  const mic = useMicRecorder((t) => {
    const r = routeAsk(t, ctx)[0]
    if (r) void go(r, t)
  })
  const ctx = useAskContext(mic.phase !== 'idle')
  const timer = useRef(0)
  const long = useRef(false)
  const rec = mic.phase === 'recording' || mic.phase === 'opening'
  const sending = mic.phase === 'sending'
  const press = {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return
      long.current = false
      if (rec) {
        long.current = true // ce toucher finit la dictée en cours (pas d'ouverture)
        return mic.finish()
      }
      if (!questionReady || e.pointerType === 'mouse' || mic.phase !== 'idle') return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* sans capture : pointercancel rattrape le doigt parti */
      }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        long.current = true
        mic.start()
      }, LONG_PRESS_MS)
    },
    onPointerUp: () => {
      window.clearTimeout(timer.current)
      if (long.current && (mic.phase === 'recording' || mic.phase === 'opening')) mic.finish() // relâcher envoie la phrase
    },
    onPointerCancel: () => {
      window.clearTimeout(timer.current)
      if (long.current) mic.finish()
    },
    onClick: () => {
      if (long.current) {
        long.current = false
        return
      }
      if (open) return closePalette() // ordinateur : la bulle ouvre et referme
      if (!sending) trigger()
    },
    onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const body = (
    <>
      <AskPalette go={(r, said) => void go(r, said)} inputRef={input} onEscape={closePalette} />
    </>
  )
  const palette = !open
    ? null
    : createPortal(
        phone ? (
          // Téléphone : la même fenêtre flottante que sur ordinateur, juste sous la bulle, une marge de chaque côté, sur un fond
          // légèrement voilé (un toucher dessus ferme, le geste Retour aussi). En haut de l'écran, le clavier ne la cache pas :
          // sa hauteur s'arrête au-dessus de lui.
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-md" aria-hidden onClick={closePalette} />
            <div
              ref={dialog}
              role="dialog"
              aria-modal="true"
              aria-label="Demander"
              className={`ask-pop absolute flex flex-col overflow-y-auto overscroll-contain rounded-win border border-ai/40 bg-panel p-3 shadow-2xl ${rail && place ? '' : 'inset-x-3'}`}
              style={{
                ...(rail && place ? { left: place.left, width: place.width } : {}),
                top: place?.top ?? 64,
                maxHeight: Math.max(160, (kb.height || window.innerHeight) - (place?.top ?? 64) - 12),
              }}
            >
              {body}
            </div>
          </div>
        ) : (
          // Ordinateur : accrochée sous la bulle, là où l'on vient de cliquer (pas de fond assombri).
          <div
            ref={dialog}
            role="dialog"
            aria-label="Demander"
            className="ask-pop fixed z-40 flex flex-col overflow-y-auto overscroll-contain rounded-win border border-ai/40 bg-panel p-3 shadow-2xl"
            style={place ? { left: place.left, top: place.top, width: place.width, maxHeight: `calc(100dvh - ${place.top + 16}px)` } : { left: 8, top: 64, width: 'min(520px, calc(100vw - 16px))' }}
          >
            {body}
          </div>
        ),
        document.body,
      )

  const label = rec ? 'Demander à la voix : relâchez pour envoyer' : sending || flight ? 'Demander : je cherche…' : 'Demander : un nom, une question, une action'
  if (rail)
    return (
      <>
        {/* Téléphone couché : le pictogramme de l'appli en haut du menu de gauche (même toucher, même appui long). */}
        <button
          type="button"
          data-noswipe
          aria-label={label}
          aria-busy={sending || !!flight || undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-keyshortcuts="/"
          ref={btn}
          title={`Demander à ${brand.name} (touche /)`}
          className={`flex h-11 w-11 shrink-0 touch-none items-center justify-center rounded-xl transition select-none [-webkit-touch-callout:none] ${
            rec ? 'animate-pulse bg-red-600 shadow-[0_0_0_4px_rgba(220,38,38,0.35)]' : open ? 'ring-2 ring-ai' : 'hover:brightness-110 active:scale-95'
          }`}
          {...press}
        >
          {nextar ? (
            <NextarPictogram className="h-9 w-9" spin={sending || !!flight} />
          ) : (
            <AppMark className={`h-9 w-9 rounded-lg ${sending || flight ? 'animate-pulse' : ''}`} />
          )}
        </button>
        {palette}
      </>
    )

  if (dock)
    return (
      <>
        {/* Téléphone tenu droit : rond au liseré néon (comme la capsule), l'étoile de Nextar au milieu ; même toucher, même
            appui long (dictée) que la capsule de l'en-tête. */}
        <button
          type="button"
          data-noswipe
          aria-label={`${nextar ? `${brand.name} ${sportName}` : brand.name}. ${label}`}
          aria-busy={sending || !!flight || undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-keyshortcuts="/"
          ref={btn}
          title={`Demander à ${brand.name} (touche /)`}
          className={`flex h-[52px] w-[52px] shrink-0 touch-none items-center justify-center rounded-full shadow-lg transition select-none [-webkit-touch-callout:none] ${
            rec ? 'animate-pulse bg-red-600 text-white shadow-[0_0_0_4px_rgba(220,38,38,0.35)]' : `ask-capsule active:scale-95 ${open ? 'ring-2 ring-ai' : 'hover:brightness-110'}`
          }`}
          {...press}
        >
          <span className={`flex ${rec ? '' : 'ask-star'} ${sending || flight ? 'wait-spin' : ''}`} aria-hidden>
            <NextarStar className="h-6 w-6" />
          </span>
        </button>
        {palette}
      </>
    )

  // Pastille micro au bout de la capsule : seulement si la dictée est disponible (mêmes conditions que l'appui long et le
  // micro de la palette : rôle, serveur, enregistreur, accès, réglage de l'appareil).
  const dictable = questionReady
  return (
    <>
      {/* Capsule « Nextar » (le mot dessiné) aux couleurs du thème, liseré menthe (.ask-capsule, src/index.css) ; deux boutons côte à
          côte (pas de bouton dans un bouton) : la capsule ouvre « Demander », la pastille micro dicte. */}
      <div
        ref={cap}
        data-noswipe
        className={`flex h-[38px] max-w-[60vw] shrink-0 items-center rounded-full text-[15px] leading-none font-bold transition ${
          rec ? 'animate-pulse border-[1.5px] border-transparent bg-red-600 text-white shadow-[0_0_0_4px_rgba(220,38,38,0.35)]' : 'ask-capsule hover:brightness-110'
        }`}
        style={{ fontFamily: BRAND_FONT }}
      >
        <button
          type="button"
          aria-label={`${nextar ? `${brand.name} ${sportName}` : brand.name}. ${label}`}
          aria-busy={sending || !!flight || undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-keyshortcuts="/"
          ref={btn}
          title={`Demander à ${brand.name} (touche /)`}
          className={`flex h-full min-w-0 flex-1 touch-none items-center gap-1.5 rounded-full pl-4 select-none [-webkit-touch-callout:none] active:brightness-95 ${dictable ? 'pr-1' : 'pr-4'}`}
          {...press}
        >
          {/* Le logo Nextar (le X en étoile filante), seul : le sport n'est plus écrit (choix de Geoffroy, 25/10 ; il reste sur
              l'icône, l'écran d'ouverture et la connexion, et dans le nom accessible « Nextar Handball. Demander : … »). Une
              autre appli (nom réglé par l'administrateur) : étoile + son nom. */}
          {nextar ? (
            <NextarWordmark className="h-[23px]" spin={sending || !!flight} />
          ) : (
            <>
              <span className={`ask-star flex ${sending || flight ? 'wait-spin' : ''}`} aria-hidden>
                <NextarStar className="h-[15px] w-[15px]" />
              </span>
              <span className="truncate">{brand.name}</span>
            </>
          )}
        </button>
        {dictable && (
          // Un toucher : la dictée commence tout de suite (le même micro que l'appui long), un autre toucher (ici ou sur la
          // capsule) l'envoie ; maintenir : on parle tant qu'on appuie. La phrase dite est relue comme une demande tapée.
          <button
            type="button"
            aria-label={rec ? 'Finir la dictée et envoyer' : sending ? 'Transcription en cours' : 'Dicter une question'}
            aria-pressed={rec}
            title={mic.error || (rec ? 'Finir la dictée : la phrase est envoyée' : sending ? 'J’écris ce que vous avez dit…' : 'Dicter une question (touchez pour commencer, touchez pour finir)')}
            disabled={sending}
            className={`ask-mic mr-2 ml-0 flex h-6 w-6 shrink-0 touch-none items-center justify-center rounded-full transition select-none [-webkit-touch-callout:none] hover:brightness-110 active:scale-95 ${rec ? 'ask-mic-rec' : ''}`}
            {...mic.buttonProps}
            onPointerDown={(e) => {
              // Palette ouverte : elle se ferme, la dictée de la capsule prend la main.
              if (open && e.button === 0) closePalette()
              mic.buttonProps.onPointerDown(e)
            }}
          >
            {sending ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            ) : rec ? (
              <span className="h-2.5 w-2.5 rounded-[2px] bg-current" aria-hidden />
            ) : (
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            )}
          </button>
        )}
      </div>
      {palette}
    </>
  )
}
