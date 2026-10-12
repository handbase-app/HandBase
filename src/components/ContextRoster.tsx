import { useEffect, useRef, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { canLeave } from './Confirm'
import { selectedCls, useSelected } from './MasterDetail'
import { Avatar, PosBadges } from './ui'
import type { Player } from '../db'

/*
 * Fiche d'un joueur ouverte depuis une liste (événement ; plus tard groupe, « À revoir », bilan) : on reste dans
 * cette liste. Ordinateur : ses joueurs seulement dans la colonne de gauche (ContextRoster, dans MasterDetail),
 * la fiche à droite. Téléphone : la fiche en plein écran sous une barre « liste · 5 / 23 » avec ‹ › (ContextBar).
 * Les adresses restent partageables : `${base}/${id du joueur}`.
 */

/** Morceau de la liste : titre (équipe, poste…), sous-titre (poste dans une équipe), joueurs. */
export type ContextSection = { heading?: string | null; sub?: string; mine?: boolean; players: Player[] }

/** Revient à la liste d'origine : par l'historique si l'on en vient (même position), sinon en la rouvrant. */
export function useLeaveTo(to: string) {
  const nav = useNavigate()
  const loc = useLocation()
  return async () => {
    if (!(await canLeave())) return
    if ((loc.state as { md?: boolean } | null)?.md) nav(-1)
    else nav(to, { replace: true })
  }
}

/** Passe à un autre joueur de la liste : l'historique ne garde pas chaque fiche parcourue (comme MasterDetail). */
export function useShowInContext(base: string) {
  const nav = useNavigate()
  const loc = useLocation()
  return async (pid: string) => {
    if (!(await canLeave())) return
    nav(`${base}/${pid}`, { replace: true, state: loc.state })
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
  back,
  count,
  sections,
  number,
  detail,
  actions,
}: {
  base: string
  back: { label: string; go: () => void }
  count: string
  sections: ContextSection[]
  number?: (p: Player) => string | undefined
  detail?: (p: Player) => string
  actions?: (p: Player) => ReactNode
}) {
  const selected = useSelected(base)
  const box = useRef<HTMLDivElement>(null)
  const withNumber = !!number && sections.some((s) => s.players.some((p) => number(p)))
  // Fiche suivante (‹ ›, ↑ ↓) : sa ligne reste visible.
  useEffect(() => {
    if (!selected) return
    box.current?.querySelector(`[data-row="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <div ref={box} className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <button onClick={back.go} className="min-h-8 min-w-0 truncate text-left text-xs font-bold text-muted hover:text-fg" title="Revenir à la liste">
          ← {back.label}
        </button>
        <span className="shrink-0 text-[11px] text-muted">{count}</span>
      </div>
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
            <div
              key={p.id}
              data-row={p.id}
              className={`card flex scroll-mt-[calc(var(--hdr)+0.75rem)] scroll-mb-4 items-center gap-1 py-0.5 pr-0.5 pl-1.5 ${selectedCls(selected === p.id)}`}
            >
              <Link
                to={`${base}/${p.id}`}
                replace
                data-md={p.id}
                aria-current={selected === p.id ? 'page' : undefined}
                className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-md py-1"
              >
                {withNumber && <span className="w-5 shrink-0 text-center text-[11px] text-muted" title="Numéro de maillot">{number!(p) ?? '–'}</span>}
                <Avatar p={p} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold">
                    <span className="truncate">
                      {p.lastName.toUpperCase()} {p.firstName}
                    </span>
                    <PosBadges p={p} />
                  </span>
                  {detail && <span className="block truncate text-[10px] text-muted">{detail(p)}</span>}
                </span>
              </Link>
              {actions && <span className="flex shrink-0 items-center">{actions(p)}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------- Téléphone : barre au-dessus de la fiche ----------

/** « liste · 5 / 23 », ‹ › (joueur précédent / suivant, même ordre) et retour à la liste ; collée sous l'en-tête. */
export function ContextBar({ title, ids, current, base, back }: { title: string; ids: string[]; current?: string; base: string; back: () => void }) {
  const show = useShowInContext(base)
  const i = current ? ids.indexOf(current) : -1
  const prev = i > 0 ? ids[i - 1] : undefined
  const next = i >= 0 && i < ids.length - 1 ? ids[i + 1] : undefined
  const arrow = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel text-lg font-bold leading-none disabled:opacity-30'
  return (
    <div
      data-ctx-bar
      className="sticky top-[var(--hdr)] z-10 -mx-4 -mt-4 mb-3 flex items-center gap-2 border-b border-line bg-bg/95 px-4 py-1.5 backdrop-blur rail:-mt-3"
    >
      <button onClick={back} className="flex h-9 shrink-0 items-center px-1 text-sm font-bold text-muted" aria-label={`Revenir à ${title}`} title="Revenir à la liste">
        ←
      </button>
      <span className="min-w-0 flex-1 truncate text-xs font-bold">
        {title}
        {i >= 0 && <span className="font-normal text-muted"> · {i + 1} / {ids.length}</span>}
      </span>
      <button className={arrow} disabled={!prev} onClick={() => prev && void show(prev)} aria-label="Joueur précédent">
        ‹
      </button>
      <button className={arrow} disabled={!next} onClick={() => next && void show(next)} aria-label="Joueur suivant">
        ›
      </button>
    </div>
  )
}
