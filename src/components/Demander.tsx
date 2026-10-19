import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { loadTeams } from '../teams'
import { canLeave } from './Confirm'
import { MicStatus, useMicRecorder } from './MicButton'
import { Icon, playerName } from './ui'

/*
 * « Demander » : une seule porte pour tout demander, comme la barre d'adresse d'un navigateur (partie pure : src/demander.ts).
 *  - Le CHAMP : ✦ à gauche, « Demander… un nom, une question, une action », micro ✨ à droite seulement si la dictée est
 *    disponible (useDictation, comme avant) ; au clavier tout marche sans micro.
 *  - Le MENU à l'ouverture (focus, toucher) : « Récemment » (historique local, horloge, un toucher relance la demande sur
 *    sa page, ✕ pour retirer une entrée), « Essaie » (trois suggestions de la page), « Mes questions enregistrées » (celles
 *    du bilan), « Afficher tout l'historique » (le menu s'allonge, « Effacer l'historique » en bas). Depuis l'EN-TÊTE, en
 *    tapant : « Je comprends », les propositions de routeAsk (Entrée : la première, ↑ ↓ pour choisir, Échap ferme).
 *    Clavier complet, rôles ARIA (combobox / listbox), focus gardé au champ. Téléphone : le menu devient une feuille sous
 *    le champ, fermée par le geste Retour sans quitter la page (une entrée d'historique du routeur, retirée en fermant).
 *  - PLACEMENTS : sur les listes Joueurs, Événements, Groupes et au bilan (PlayersQuery.tsx, ListQuery.tsx,
 *    AskQuestion.tsx), le champ de la page EST ce composant (même comportement qu'avant pour la phrase : recherche locale
 *    ou appel, ajout aux filtres, pastilles) ; sur ordinateur, la même barre au centre de l'en-tête de toutes les pages
 *    (HeaderAsk, src/App.tsx), raccourci « / ». Sur une page de liste, la barre de l'en-tête reste vide et envoie à la
 *    liste affichée (postAsk → useIncomingAsk) : deux champs, jamais contradictoires.
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
    take()
    askListeners.add(take)
    return () => {
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
  /** En-tête : propositions de routeAsk (« Je comprends ») ; `go` les exécute. */
  routes?: AskRoute[]
  go?: (r: AskRoute) => void
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
  /** Le champ prend le focus (la liste Joueurs charge ses données lourdes à ce moment). */
  onFocus?: () => void
}

export function Demander(p: DemanderProps) {
  const id = useId()
  const nav = useNavigate()
  const loc = useLocation()
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

  // ---------- Ouverture / fermeture ----------
  const stateKey = `demander:${id}`
  const sheetPushed = useRef(false)
  const openMenu = () => {
    if (open) return
    const ph = isPhone()
    setSheet(ph)
    setOpen(true)
    setActive(-1)
    setShowAll(false)
    // Téléphone : une entrée d'historique, pour que le geste Retour ferme la feuille sans quitter la page.
    if (ph && !sheetPushed.current) {
      sheetPushed.current = true
      nav(loc.pathname + loc.search + loc.hash, { state: { ...((loc.state as object) ?? {}), [stateKey]: true } })
    }
  }
  const close = (opts: { blur?: boolean; keepEntry?: boolean } = {}) => {
    if (!open) return
    setOpen(false)
    setActive(-1)
    if (sheet) {
      // L'entrée d'historique de la feuille est retirée (sauf si l'on part ailleurs : elle est remplacée).
      if (sheetPushed.current && !opts.keepEntry && (loc.state as Record<string, unknown> | null)?.[stateKey]) nav(-1)
      sheetPushed.current = false
      inputRef.current?.blur()
    } else if (!opts.blur) inputRef.current?.focus({ preventScroll: true })
  }
  // Geste Retour (ou bouton du navigateur) : l'entrée de la feuille disparaît, la feuille se ferme.
  const hasEntry = !!(loc.state as Record<string, unknown> | null)?.[stateKey]
  useEffect(() => {
    if (open && sheet && sheetPushed.current && !hasEntry) {
      sheetPushed.current = false
      setOpen(false)
      setActive(-1)
      inputRef.current?.blur()
    }
  }, [hasEntry]) // eslint-disable-line react-hooks/exhaustive-deps
  // Ordinateur : un clic ailleurs ferme (le focus part).
  useEffect(() => {
    if (!open || sheet) return
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
      const r = rs.find((x) => x.apply?.page === e.page) ?? rs[0]
      if (r) {
        close({ keepEntry: true })
        p.go(r)
      }
      return
    }
    if (!(await canLeave())) return
    postAsk({ page: e.page, phrase: e.text })
    close({ keepEntry: true })
    nav(ASK_PATH[e.page], { replace: sheet })
  }
  const pickSuggestion = (s: string) => {
    if (header && p.go) {
      const r = routeAsk(s)[0]
      if (!r) return
      close({ keepEntry: true })
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
      close({ keepEntry: true })
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
  const rowCls = (i: number, extra = '') =>
    `flex w-full cursor-pointer items-center gap-2.5 text-left ${sheet ? 'min-h-11 px-4 text-sm' : 'min-h-9 px-3 text-[13px]'} ${active === i ? 'bg-ai-soft' : 'hover:bg-panel-2'} ${extra}`
  let k = 0
  if (header && text && p.routes?.length) {
    add(
      'Je comprends',
      p.routes.map((r) => ({
        id: `r${k++}`,
        run: () => {
          close({ keepEntry: true })
          p.go?.(r)
        },
        node: (
          <>
            <span className={`shrink-0 text-base font-extrabold ${r.kind === 'select' ? 'text-suggest' : 'text-ai'}`} aria-hidden>
              {r.kind.startsWith('open') ? '↗' : r.kind === 'bilan' ? '?' : r.kind === 'select' ? '+' : '→'}
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
              className={`shrink-0 rounded-md px-2 py-1 text-muted hover:text-fg ${sheet ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [[aria-selected=true]_&]:opacity-100'}`}
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
    if (saved.length)
      links.push({
        id: `l${k++}`,
        run: () => {
          close({ keepEntry: true })
          void canLeave().then((ok) => ok && nav('/bilan', { replace: sheet }))
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
      if (open) {
        e.preventDefault()
        close()
      } else if (p.value) p.onChange('')
    } else if (e.key === 'Tab') close({ blur: true })
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
          {header ? 'Tapez un nom, une question ou une action, puis Entrée.' : p.canAsk ? 'Un nom, ou une phrase (Entrée) : vos demandes apparaîtront ici.' : 'Un nom, un club, une licence.'}
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
  const menu = !open ? null : sheet ? (
    createPortal(
      <div className="fixed inset-0 z-40" onPointerDown={(e) => e.stopPropagation()}>
        <div className="absolute inset-0 bg-black/40" style={{ top }} onClick={() => close()} aria-hidden />
        <div
          className="absolute inset-x-0 bottom-0 flex flex-col overflow-y-auto overscroll-contain border-t border-ai/40 bg-panel pb-[max(0.5rem,var(--nav-b))] shadow-2xl"
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
    <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-[min(70vh,28rem)] overflow-y-auto overscroll-contain rounded-xl border border-ai/40 bg-panel shadow-2xl">{menuBody}</div>
  )

  const h = p.compact ? 'min-h-8' : 'min-h-11'
  return (
    <div ref={wrap} className={`relative min-w-0 flex-1 ${p.className ?? ''}`}>
      <form
        className="flex min-w-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className={`field flex ${h} min-w-0 flex-1 items-center gap-2 py-0 pr-1 pl-2.5 focus-within:border-ai ${p.compact ? 'text-xs' : ''}`}>
          <span className="shrink-0 text-ai" aria-hidden>
            ✦
          </span>
          <input
            ref={inputRef}
            id={`${id}-in`}
            data-search
            className="min-w-0 flex-1 bg-transparent py-1.5 text-inherit outline-none placeholder:text-muted/70"
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
            placeholder={p.placeholder ?? (header || p.canAsk ? 'Demander… un nom, une question, une action' : 'Demander… un nom, un club, une licence')}
            aria-label={p.label ?? 'Demander : un nom, une question, une action'}
            title={p.canAsk ? `Un nom, un club, une licence ; ou une phrase${p.micHint ? ` (« ${p.micHint} »)` : ''}, puis Entrée` : 'Nom, club ou licence'}
            value={p.value}
            maxLength={MAX_PHRASE}
            disabled={p.disabled || sending || rec}
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
          {p.value && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Effacer"
              className="shrink-0 rounded-md px-1.5 py-1 text-muted hover:text-fg"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                p.onChange('')
                inputRef.current?.focus({ preventScroll: true })
              }}
            >
              ✕
            </button>
          )}
        </div>
        {p.canAsk && !p.nameMode && !header && text && (
          <button type="submit" className={`btn-primary ${h} shrink-0 px-3 text-sm ${p.compact ? 'py-0' : ''}`} disabled={p.disabled || sending || rec} aria-label="Appliquer la phrase">
            <span aria-hidden>✨</span>
          </button>
        )}
        {p.mic && (
          <button
            type="button"
            data-noswipe
            aria-label={rec ? 'Arrêter et appliquer' : sending ? 'Phrase en cours' : 'Demander à la voix'}
            aria-pressed={rec}
            title={rec ? 'Arrêter : la phrase est transcrite puis appliquée' : `Touchez et dites par exemple « ${p.micHint ?? 'les gauchers de 2011'} » ; touchez à nouveau pour finir (ou maintenez pendant que vous parlez)`}
            disabled={sending || p.disabled}
            className={`relative flex ${h} ${p.compact ? 'min-w-8' : 'min-w-11'} shrink-0 touch-none items-center justify-center rounded-md border-2 px-2 transition select-none [-webkit-touch-callout:none] ${
              rec ? 'border-red-300 bg-red-600 text-white shadow-[0_0_0_4px_rgba(220,38,38,0.35)]' : 'border-line bg-panel-2 text-fg hover:border-ai active:bg-ai active:text-white'
            } disabled:opacity-70`}
            {...p.mic.buttonProps}
          >
            {sending ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : rec ? (
              <span className="h-4 w-4 rounded-sm bg-white" />
            ) : (
              <>
                <Icon name="mic" className={p.compact ? 'h-4 w-4' : 'h-6 w-6'} />
                <span className="pointer-events-none absolute top-0.5 right-0.5 text-[11px] leading-none" aria-hidden>
                  ✨
                </span>
              </>
            )}
          </button>
        )}
      </form>
      {menu}
    </div>
  )
}

// ---------- La barre de l'en-tête (ordinateur) ----------

/**
 * Noms de l'appareil pour « Ouvrir … » (joueurs, événements, groupes que le compte voit) : lus seulement quand on tape
 * dans la barre de l'en-tête ; jamais envoyés.
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

/** La barre « Demander » au centre de l'en-tête (ordinateur seulement ; raccourci « / »). */
export function HeaderAsk() {
  const nav = useNavigate()
  const loc = useLocation()
  const { questionReady } = useDictation()
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const ctx = useAskContext(!!text.trim())
  const routes = useMemo(() => routeAsk(text, ctx), [text, ctx])
  const page = pageOfPath(loc.pathname)

  const go = async (r: AskRoute) => {
    if (!(await canLeave())) return
    recordAsk(r.apply?.page ?? pageOfPath(r.to), text.trim() || r.apply?.phrase || r.label)
    setText('')
    if (r.apply) postAsk(r.apply)
    if (loc.pathname !== r.to) nav(r.to)
    input.current?.blur()
  }
  // Micro de l'en-tête : la phrase dite est relue comme une demande tapée (première proposition).
  const mic = useMicRecorder((t) => {
    const r = routeAsk(t, ctx)[0]
    if (r) void go(r)
  })
  // « / » hors d'un champ : le curseur dans la barre.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const el = input.current
      if (!el || !el.offsetParent) return
      e.preventDefault()
      el.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="hidden min-w-0 flex-1 justify-center px-4 side:flex">
      <Demander
        page={page}
        value={text}
        onChange={setText}
        onSubmit={() => {}}
        canAsk={questionReady}
        routes={routes}
        go={(r) => void go(r)}
        inputRef={input}
        mic={questionReady ? mic : undefined}
        micHint="ouvre la fiche de Martin » ou « les gauchers de 2011"
        className="max-w-[420px]"
      />
    </div>
  )
}
