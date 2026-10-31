import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useBackCloses } from '../backNav'
import { alive, db, poleName, today, type HBEvent, type Player, type Unit } from '../db'
import { useSportConfig } from '../installation'
import { regionLabel } from '../lists'
import { dotCount, foldSteps, monthYear, palierFacts, parcours, periodLabel, stripTag, type Palier, type PalierId, type ParcoursStep } from '../parcours'

/*
 * « Parcours » d'un joueur sur sa fiche (calcul : src/parcours.ts ; décidé avec Geoffroy et Stef le 31/10, d'après les
 * maquettes) : une ligne par palier atteint (Repéré → Comité → Ligue → Pôle → France), dépliable sur ses étapes.
 * Frise fine sous le nom, visible quel que soit l'onglet, sur téléphone comme sur ordinateur (31/10 : plus de colonne à
 * gauche) ; un appui ouvre le parcours complet dans une bulle accrochée là où l'on a appuyé, le palier touché déjà déplié
 * (31/10 : plutôt qu'une fenêtre du bas). Le retour du téléphone, Échap ou un toucher à côté la ferment.
 * Rien du tout si le joueur n'a aucune étape. Accent menthe (comme les maquettes) ; marques neutres ou positives seulement.
 */

/** Parcours du joueur, relu quand ses vus, avis, mesures ou périodes de pôle changent ; undefined pendant la lecture. */
export function usePlayerParcours(p: Player | undefined | null): Palier[] | undefined {
  const sport = useSportConfig().sport
  const poles = JSON.stringify(p?.poles ?? [])
  return useLiveQuery(async () => {
    if (!p) return []
    const [seen, evaluations, measurements] = await Promise.all([
      db.seen.where('playerId').equals(p.id).toArray().then(alive),
      db.evaluations.where('playerId').equals(p.id).toArray().then(alive),
      db.measurements.where('playerId').equals(p.id).toArray().then(alive),
    ])
    const ids = [...new Set([...seen.map((s) => s.eventId), ...evaluations.map((e) => e.eventId).filter((x): x is string => !!x)])]
    const dates = [...new Set(measurements.map((m) => m.date))]
    // Événements où il a été vu (supprimés compris : l'étape a eu lieu), et ceux des jours de ses séances de mesures.
    // Et ceux où il était sur la liste (convocations ; pas d'index sur la liste : parcours de la table, quelques centaines).
    const [found, sameDay, onList] = await Promise.all([
      db.events.bulkGet(ids),
      dates.length ? db.events.where('date').anyOf(dates).toArray() : [],
      db.events.filter((e) => !!e.playerIds?.includes(p.id)).toArray(),
    ])
    const events = new Map<string, HBEvent>()
    for (const e of [...found, ...sameDay, ...onList]) if (e) events.set(e.id, e)
    const orgIds = [...new Set([...events.values()].map((e) => e.organizerUnitId).filter((x): x is string => !!x))]
    const [units, levels] = await Promise.all([db.units.bulkGet(orgIds), db.levels.toArray()])
    return parcours({
      playerId: p.id,
      events: [...events.values()],
      seen,
      evaluations,
      measurements,
      units: units.filter((u): u is Unit => !!u && !u.deleted),
      levels: alive(levels),
      poles: p.poles,
      today: today(),
      sex: p.sex,
      sport,
      poleName: (x) => poleName(x, regionLabel),
    })
  }, [p?.id, p?.sex, poles, sport])
}

const total = (ps: Palier[]) => ps.reduce((n, p) => n + p.steps.length, 0)
/** Sigle du palier dans sa pastille (liste) ; le nom en entier est juste à côté. */
const BADGE: Record<PalierId, string> = { repere: 'REP', comite: 'CD', ligue: 'LIG', pole: 'PÔLE', france: 'FRA' }

// ---------- Frise ----------

/** Point d'ouverture de la bulle : abscisse de l'appui, haut et bas de la frise (coordonnées de l'écran). */
type Anchor = { x: number; top: number; bottom: number; palier?: PalierId }

/**
 * Frise fine sous le nom : un point par palier atteint, l'année d'entrée ou le nombre d'étapes (« ×7 ») et le nom court ;
 * le dernier palier atteint est plein. Un appui ouvre le parcours complet dans une bulle, à l'endroit touché.
 */
export function ParcoursStrip({ paliers }: { paliers: Palier[] }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  if (!paliers.length) return null
  const n = paliers.length
  const last = n - 1
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    // Clavier (Entrée, Espace) : pas de point d'appui, la bulle part du milieu de la frise.
    const x = e.detail > 0 ? e.clientX : r.left + r.width / 2
    const hit = (e.target as Element).closest<HTMLElement>('[data-palier]')?.dataset.palier as PalierId | undefined
    setAnchor({ x, top: r.top, bottom: r.bottom, palier: hit })
  }
  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        aria-label={`Parcours : ${paliers.map((p) => p.short).join(', ')}. Voir le détail`}
        className="-mx-1 flex max-w-xl items-center rounded-lg px-1 py-0.5 text-left transition hover:bg-panel-2"
        data-testid="parcours-frise"
      >
        <span className="relative flex min-w-0 flex-1">
          {/* Un cinquième de la largeur par palier (cinq au plus), à partir de la gauche : même écart d'une fiche à l'autre.
              Filet qui relie les points, du centre du premier au centre du dernier. */}
          {n > 1 && <span aria-hidden className="absolute top-[5px] left-[10%] h-px bg-emerald-400/50" style={{ width: `${(n - 1) * 20}%` }} />}
          {paliers.map((p, i) => (
            <span key={p.id} data-palier={p.id} className="relative flex w-1/5 min-w-0 flex-col items-center">
              <span
                aria-hidden
                className={`h-[11px] w-[11px] rounded-full border-2 border-emerald-400 ${i === last ? 'bg-emerald-400 shadow-[0_0_0_3px] shadow-emerald-400/25' : 'bg-bg'}`}
              />
              <span className="mt-0.5 font-mono text-[10px] leading-3 text-muted tabular-nums">{stripTag(p)}</span>
              <span className={`max-w-full truncate text-[10px] leading-3 ${i === last ? 'font-extrabold text-fg' : 'text-muted'}`}>{p.short}</span>
            </span>
          ))}
        </span>
      </button>
      {anchor && <ParcoursPopover paliers={paliers} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  )
}

/**
 * Bulle du parcours complet, accrochée au point touché : sous la frise (au-dessus faute de place), dans l'écran, avec une
 * petite pointe vers l'appui ; elle défile dedans si le parcours est long. Le palier touché est déjà déplié. Retour du
 * téléphone, ✕, Échap, toucher à côté, défilement de la page ou changement de taille : fermée. Un seul palier : déplié aussi.
 */
function ParcoursPopover({ paliers, anchor, onClose }: { paliers: Palier[]; anchor: Anchor; onClose: () => void }) {
  useBackCloses(onClose)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number; caret: number; below: boolean } | null>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const w = el.offsetWidth
    const h = el.scrollHeight
    const left = Math.max(8, Math.min(anchor.x - w / 2, vw - w - 8))
    const roomBelow = vh - anchor.bottom - 16
    const roomAbove = anchor.top - 16
    // Sous la frise, sauf si la bulle n'y tient pas et qu'il y a plus de place au-dessus.
    const below = h <= roomBelow || roomBelow >= roomAbove
    const maxH = Math.max(160, below ? roomBelow : roomAbove)
    const top = below ? anchor.bottom + 8 : Math.max(8, anchor.top - 8 - Math.min(h, maxH))
    setPos({ left, top, maxH, caret: Math.max(16, Math.min(anchor.x - left, w - 16)), below })
  }, [anchor])

  useEffect(() => {
    const before = document.activeElement
    box.current?.focus({ preventScroll: true })
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    // Défilement de la page (pas celui de la bulle) ou changement de taille : la bulle ne suit pas, on la ferme.
    const scroll = (e: Event) => !box.current?.contains(e.target as Node) && close.current()
    const resize = () => close.current()
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-label="Parcours"
        onClick={(e) => e.stopPropagation()}
        className={`win absolute flex w-[min(24rem,calc(100vw-1rem))] flex-col shadow-2xl outline-none transition-opacity duration-100 ${pos ? 'opacity-100' : 'opacity-0'}`}
        style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxH } : { left: 8, top: anchor.bottom + 8 }}
        data-testid="parcours-fenetre"
      >
        {/* Petite pointe vers l'endroit touché. */}
        {pos && (
          <span
            aria-hidden
            className={`absolute h-3 w-3 rotate-45 border-line bg-panel ${pos.below ? '-top-1.5 border-t border-l' : '-bottom-1.5 border-r border-b'}`}
            style={{ left: pos.caret - 6 }}
          />
        )}
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <ParcoursTitle paliers={paliers} />
          <button className="-mr-2 -mt-1 min-h-9 min-w-9 shrink-0 text-muted" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 pb-3">
          <ParcoursList paliers={paliers} initial={anchor.palier ?? (paliers.length === 1 ? paliers[0].id : undefined)} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- Contenu commun ----------

/** « PARCOURS · 16 ÉTAPES · 5 PALIERS ». */
function ParcoursTitle({ paliers }: { paliers: Palier[] }) {
  const n = total(paliers)
  return (
    <h2 className="mb-1 font-mono text-[11px] font-extrabold tracking-wider text-emerald-300 uppercase">
      Parcours <span className="font-bold opacity-80">· {n} étape{n > 1 ? 's' : ''}</span>
      {paliers.length > 1 && <span className="font-bold opacity-80"> · {paliers.length} paliers</span>}
    </h2>
  )
}

/** Une ligne par palier ; un appui déplie ses étapes (`initial` : le palier touché sur la frise, déjà déplié). */
function ParcoursList({ paliers, initial }: { paliers: Palier[]; initial?: PalierId }) {
  const [open, setOpen] = useState<PalierId | null>(initial ?? null)
  const last = paliers[paliers.length - 1]?.id
  return (
    <ol className="flex flex-col divide-y divide-line">
      {paliers.map((p) => (
        <PalierRow key={p.id} p={p} top={p.id === last} open={open === p.id} toggle={() => setOpen((o) => (o === p.id ? null : p.id))} />
      ))}
    </ol>
  )
}

function PalierRow({ p, top, open, toggle }: { p: Palier; top: boolean; open: boolean; toggle: () => void }) {
  const id = useId()
  const facts = palierFacts(p)
  // Sans avis ni mesures (tournois vus) : les noms des premières étapes disent mieux ce qui s'est passé.
  const detail = facts.length || p.id === 'pole' ? facts : [p.steps.slice(0, 2).map((s) => s.name).join(', ')]
  const sub = [periodLabel(p), ...detail].filter(Boolean).join(' · ')
  const { dots, more } = dotCount(p.steps.length)
  return (
    <li className="py-1">
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left transition hover:bg-panel-2">
        <span
          aria-hidden
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-extrabold ${
            top ? 'bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-400/60' : 'bg-panel-2 text-muted'
          }`}
        >
          {BADGE[p.id]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="text-[13px] font-extrabold">{p.label}</span>
            {p.steps.length > 1 && p.id !== 'pole' && <span className="font-mono text-[11px] font-bold text-emerald-300 tabular-nums">×{p.steps.length}</span>}
            {p.current && <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-bold text-emerald-300">en cours</span>}
          </span>
          {sub && <span className="block font-mono text-[10px] leading-4 text-muted">{sub}</span>}
          {p.steps.length > 1 && (
            <span aria-hidden className="mt-1 flex items-center gap-[3px]">
              {Array.from({ length: dots }, (_, i) => (
                <span key={i} className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
              ))}
              {more > 0 && <span className="ml-0.5 font-mono text-[9px] text-muted">+{more}</span>}
            </span>
          )}
        </span>
        <span aria-hidden className={`mt-1 shrink-0 text-muted transition ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
      </button>
      {open && (
        <div id={id} className="mt-1 mb-1.5 ml-[2.6rem]">
          <Steps p={p} />
        </div>
      )}
    </li>
  )
}

/** Étapes d'un palier : au-delà de quatre, la 1re, la 2e, « ⋯ N autres » (dépliable) et la dernière. */
function Steps({ p }: { p: Palier }) {
  const [all, setAll] = useState(false)
  const rows = all ? p.steps : foldSteps(p.steps)
  return (
    <ul className="flex flex-col gap-0.5 rounded-lg bg-panel-2 px-2.5 py-1.5 text-xs">
      {rows.map((s) =>
        'more' in s ? (
          <li key="plus">
            <button type="button" className="py-0.5 text-[11px] font-bold text-emerald-300" onClick={() => setAll(true)}>
              ⋯ {s.more} autre{s.more > 1 ? 's' : ''}
            </button>
          </li>
        ) : (
          <StepRow key={s.key} s={s} />
        ),
      )}
    </ul>
  )
}

function StepRow({ s }: { s: ParcoursStep }) {
  // Période de pôle : entrée → sortie ; événement : mois et année.
  const when = s.eventId ? monthYear(s.date) : s.current ? (s.date ? `depuis ${monthYear(s.date)}` : 'en cours') : [s.date && monthYear(s.date), s.end && monthYear(s.end)].filter(Boolean).join(' → ')
  const extra = [s.observers > 0 && `${s.observers} obs.`, s.avis > 0 && `${s.avis} avis`, s.mesures > 0 && 'mesures', s.listed && 'sur la liste'].filter(Boolean).join(' · ')
  return (
    <li className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="min-w-0">
        {s.eventId && !s.gone ? (
          <Link to={`/evenements/${s.eventId}`} className="font-bold hover:underline">
            {s.name}
          </Link>
        ) : (
          <span className="font-bold">{s.name}</span>
        )}
        {extra && <span className="block font-mono text-[10px] text-muted">{extra}</span>}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-muted uppercase tabular-nums">{when}</span>
    </li>
  )
}
