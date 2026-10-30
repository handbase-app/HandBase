import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { useBack } from '../backNav'
import { canLeave, hasUnsaved } from './Confirm'
import { useSelected } from './MasterDetail'
import { CompactPlayerRow } from './PlayerRow'
import { PlayerList } from './Pictos'
import { useSwipeNav } from './useSwipeNav'
import type { Player } from '../db'
import { keepPlayerTab } from '../tabQuery'

/*
 * Fiche d'un joueur ouverte depuis une liste (événement, groupe, bilan de détection) : on reste dans
 * cette liste. Ordinateur : ses joueurs seulement dans la colonne de gauche (ContextRoster, dans MasterDetail),
 * la fiche à droite. Téléphone : la fiche en plein écran sous une barre « liste · 5 / 23 » (ContextBar) ; on glisse la fiche
 * pour passer au joueur suivant / précédent (même geste que l'écran de notation, src/components/useSwipeNav.ts).
 * Les adresses restent partageables : `${base}/${id du joueur}${search}` (`search` : l'état de la liste, ex. filtres du bilan).
 */

/** Morceau de la liste : titre (équipe, poste…), sous-titre (poste dans une équipe), joueurs. */
/** Icônes au bout d'une ligne (mêmes emplacements que les lignes pleines). */
export type ContextIcons = { seen?: ReactNode; rewatch?: ReactNode; follow?: ReactNode }

export type ContextSection = { heading?: string | null; sub?: string; mine?: boolean; players: Player[] }

/**
 * Revient d'où l'on vient (la liste d'origine, en général) : par l'historique, donc à la même position et dans le même
 * état ; sinon (adresse partagée, rechargement sans historique) en rouvrant `to`. `label` : nom de la liste.
 */
export function useLeaveTo(to: string, label: string) {
  return useBack(to, label, { replace: true })
}

/**
 * Passe à un autre joueur de la liste : l'historique ne garde pas chaque fiche parcourue (comme MasterDetail), et
 * l'onglet ouvert de la fiche (Croissance…) reste ouvert (src/tabQuery.ts).
 */
export function useShowInContext(base: string, search = '') {
  const nav = useNavigate()
  const loc = useLocation()
  return async (pid: string) => {
    if (!(await canLeave())) return false
    nav(`${base}/${pid}${keepPlayerTab(search, base, loc.search)}`, { replace: true, state: loc.state })
    return true
  }
}

// ---------- Position dans la liste d'origine ----------

const scrollKey = (key: string) => `handbase.retour.${key}`

/** À l'ouverture d'une fiche depuis la liste : on note où l'on en était (page, et panneau sur ordinateur). */
export function rememberScroll(key: string) {
  try {
    const panel = document.querySelector('.md-panel')?.scrollTop ?? 0
    sessionStorage.setItem(scrollKey(key), JSON.stringify({ y: window.scrollY, panel }))
  } catch {
    /* stockage indisponible : on revient en haut */
  }
}

/** Retour sur la liste (historique) une fois chargée : on la remet où elle était. */
export function useRestoreScroll(key: string, ready: boolean) {
  const pop = useNavigationType() === 'POP'
  const done = useRef(false)
  useEffect(() => {
    if (!ready || done.current) return
    done.current = true
    let saved: { y?: number; panel?: number } | null = null
    try {
      saved = JSON.parse(sessionStorage.getItem(scrollKey(key)) ?? 'null')
      sessionStorage.removeItem(scrollKey(key))
    } catch {
      return
    }
    if (!pop || !saved) return
    const { y = 0, panel = 0 } = saved
    // Après le rendu complet de la liste (et la remise en haut du panneau par MasterDetail).
    requestAnimationFrame(() => {
      if (y) window.scrollTo(0, y)
      if (panel) document.querySelector('.md-panel')?.scrollTo(0, panel)
    })
  }, [ready, pop, key])
}

// ---------- Ordinateur : colonne de gauche ----------

/**
 * Joueurs de la liste d'origine, dans son ordre et ses titres. Une ligne (`data-md`) ouvre la fiche à droite ;
 * ↑ ↓ passent au joueur précédent / suivant (MasterDetail). `actions` : petites icônes au bout de la ligne.
 */
export function ContextRoster({
  base,
  count,
  sections,
  number,
  detail,
  actions,
  search = '',
}: {
  base: string
  /** Gardé d'un joueur à l'autre (état de la liste d'origine). */
  search?: string
  back: { label: string; go: () => void }
  count: string
  sections: ContextSection[]
  number?: (p: Player) => string | undefined
  detail?: (p: Player) => string
  actions?: (p: Player) => ContextIcons
}) {
  const selected = useSelected(base)
  const box = useRef<HTMLDivElement>(null)
  // Lien de chaque ligne : l'état de la liste d'origine, plus l'onglet ouvert de la fiche (gardé d'un joueur à l'autre).
  const query = keepPlayerTab(search, base, useLocation().search)
  const withNumber = !!number && sections.some((s) => s.players.some((p) => number(p)))
  // Fiche suivante (↑ ↓, glisser sur téléphone) : sa ligne reste visible.
  useEffect(() => {
    if (!selected) return
    box.current?.querySelector(`[data-row="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <div ref={box} className="flex flex-col gap-1.5">
      {/* Plus de « ← liste » (26/10) : le retour passe par le téléphone, le navigateur ou le menu ; le nombre reste. */}
      <div className="flex items-baseline justify-end gap-2">
        <span className="shrink-0 text-[11px] text-muted">{count}</span>
      </div>
      <PlayerList ids={sections.flatMap((sec) => sec.players.map((p) => p.id))} context={selContext(base)} sticky={false} className="flex flex-col gap-1.5">
      {sections.map((sec, k) => (
        <div key={k} className="flex flex-col gap-1">
          {sec.heading && (
            <div className={`section-title mt-1.5 mb-0 ${sec.mine ? 'text-accent' : ''}`}>
              {sec.heading}
              {sec.mine && <span className="ml-1.5 rounded bg-accent px-1 align-middle text-[9px] text-white normal-case">mon équipe</span>}
            </div>
          )}
          {sec.sub && <div className="mt-0.5 text-[10px] font-bold tracking-wide text-muted uppercase">{sec.sub}</div>}
          {sec.players.map((p) => (
            <CompactPlayerRow
              key={p.id}
              p={p}
              cardProps={{ 'data-row': p.id }}
              className="scroll-mt-[calc(var(--hdr)+0.75rem)] scroll-mb-4"
              selected={selected === p.id}
              link={{ to: `${base}/${p.id}${query}`, replace: true }}
              linkProps={{ 'data-md': p.id, 'aria-current': selected === p.id ? 'page' : undefined }}
              lead={
                withNumber && (
                  <span className="w-5 shrink-0 text-center text-[11px] text-muted" title="Numéro de maillot">
                    {number!(p) ?? '–'}
                  </span>
                )
              }
              sub={detail ? detail(p) : ''}
              {...actions?.(p)}
            />
          ))}
        </div>
      ))}
      </PlayerList>
    </div>
  )
}

/** Événement ou groupe de la liste (actions « vu », « à revoir » de la sélection multiple), lu dans son adresse. */
function selContext(base: string) {
  const ev = /^\/evenements\/([^/]+)\/joueurs$/.exec(base)?.[1]
  const gr = /^\/groupes\/([^/]+)\/joueurs$/.exec(base)?.[1]
  return ev ? { eventId: ev } : gr ? { groupId: gr } : undefined
}

// ---------- Téléphone : barre au-dessus de la fiche ----------

/**
 * La fiche (`children`) ouverte depuis une liste, sur téléphone. Plus de ‹ › (30/10) ni de barre « ← liste · 5 / 23 »
 * (31/10) : on glisse la fiche elle-même vers la gauche (joueur suivant) ou la droite (précédent), même ordre que la liste,
 * même geste que l'écran de notation (src/components/useSwipeNav.ts) ; le geste Retour ramène à la liste. Lecteurs
 * d'écran : retour, précédent, suivant dans une navigation invisible.
 */
export function ContextBar({
  title,
  ids,
  current,
  base,
  back,
  search = '',
  children,
}: {
  title: string
  ids: string[]
  current?: string
  base: string
  back: () => void
  search?: string
  children: ReactNode
}) {
  const show = useShowInContext(base, search)
  const i = current ? ids.indexOf(current) : -1
  const prev = i > 0 ? ids[i - 1] : undefined
  const next = i >= 0 && i < ids.length - 1 ? ids[i + 1] : undefined
  // La fiche (PlayerDetail, data-fiche) se charge après le changement d'adresse : l'arrivée l'attend.
  const nav = useSwipeNav(current, { ready: (card, id) => !!card.querySelector(`[data-fiche="${CSS.escape(id)}"]`) })
  const swipe = nav.handlers({ enabled: i >= 0, prev, next, go: show, hold: hasUnsaved })
  return (
    <>
      {/* Plus de barre visible (31/10) : on revient à la liste par le geste Retour du téléphone, on change de joueur en
          glissant la fiche. Lecteurs d'écran : retour, précédent, suivant et la place dans la liste restent là. */}
      <nav className="sr-only" aria-label={`${title}${i >= 0 ? ` · ${i + 1} sur ${ids.length}` : ''}`}>
        <button onClick={back}>Revenir à {title}</button>
        {prev && <button onClick={() => void swipe.change(prev, 'right')}>Joueur précédent</button>}
        {next && <button onClick={() => void swipe.change(next, 'left')}>Joueur suivant</button>}
      </nav>
      {/* La fiche suit le doigt (défilement vertical laissé au navigateur : pan-y). */}
      <div ref={nav.cardRef} style={{ touchAction: 'pan-y' }} {...swipe.touch}>
        {children}
      </div>
    </>
  )
}
