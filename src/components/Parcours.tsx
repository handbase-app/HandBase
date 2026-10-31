import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
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
 *  - Fiche étroite (téléphone, panneau de droite étroit) : frise fine sous le nom, visible quel que soit l'onglet ; un appui
 *    ouvre la fenêtre du bas avec le parcours complet (le retour du téléphone la ferme).
 *  - Fiche large (ordinateur, tablette) : colonne fixe à gauche, toujours visible, qui ne dépasse pas la hauteur de l'écran.
 * Rien du tout si le joueur n'a aucune étape. Accent menthe (comme les maquettes) ; marques neutres ou positives seulement.
 */

/** Largeur de la fiche à partir de laquelle la colonne remplace la frise (fiche, pas l'écran : le panneau compte). */
export const PARCOURS_WIDE = 704

/**
 * La fiche est-elle assez large pour la colonne ? `ref` se pose sur la fiche ; suivi au redimensionnement (panneau,
 * rotation). Mesure en JavaScript plutôt qu'une requête de conteneur CSS : un conteneur deviendrait le cadre des fenêtres
 * `fixed` ouvertes depuis la fiche.
 */
export function useWideFiche(): [(el: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [wide, setWide] = useState(false)
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => setWide(el.getBoundingClientRect().width >= PARCOURS_WIDE)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, wide]
}

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
    const [found, sameDay] = await Promise.all([db.events.bulkGet(ids), dates.length ? db.events.where('date').anyOf(dates).toArray() : []])
    const events = new Map<string, HBEvent>()
    for (const e of [...found, ...sameDay]) if (e) events.set(e.id, e)
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

// ---------- Frise (fiche étroite) ----------

/**
 * Frise fine sous le nom : un point par palier atteint, l'année d'entrée ou le nombre d'étapes (« ×7 ») et le nom court ;
 * le dernier palier atteint est plein. Un appui ouvre le parcours complet (fenêtre du bas).
 */
export function ParcoursStrip({ paliers }: { paliers: Palier[] }) {
  const [open, setOpen] = useState(false)
  if (!paliers.length) return null
  const n = paliers.length
  const last = n - 1
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Parcours : ${paliers.map((p) => p.short).join(', ')}. Voir le détail`}
        className="-mx-1 flex items-center gap-1 rounded-lg px-1 py-0.5 text-left transition hover:bg-panel-2"
        data-testid="parcours-frise"
      >
        <span className="relative flex min-w-0 flex-1">
          {/* Un cinquième de la largeur par palier (cinq au plus), à partir de la gauche : même écart d'une fiche à l'autre.
              Filet qui relie les points, du centre du premier au centre du dernier. */}
          {n > 1 && <span aria-hidden className="absolute top-[5px] left-[10%] h-px bg-emerald-400/50" style={{ width: `${(n - 1) * 20}%` }} />}
          {paliers.map((p, i) => (
            <span key={p.id} className="relative flex w-1/5 min-w-0 flex-col items-center">
              <span
                aria-hidden
                className={`h-[11px] w-[11px] rounded-full border-2 border-emerald-400 ${i === last ? 'bg-emerald-400 shadow-[0_0_0_3px] shadow-emerald-400/25' : 'bg-bg'}`}
              />
              <span className="mt-0.5 font-mono text-[10px] leading-3 text-muted tabular-nums">{stripTag(p)}</span>
              <span className={`max-w-full truncate text-[10px] leading-3 ${i === last ? 'font-extrabold text-fg' : 'text-muted'}`}>{p.short}</span>
            </span>
          ))}
        </span>
        <span aria-hidden className="shrink-0 pl-1 text-base leading-none text-muted">
          ›
        </span>
      </button>
      {open && <ParcoursSheet paliers={paliers} onClose={() => setOpen(false)} />}
    </>
  )
}

/** Fenêtre du bas : le parcours complet, par palier. Retour du téléphone, ✕, Échap ou toucher à côté : fermée. */
function ParcoursSheet({ paliers, onClose }: { paliers: Palier[]; onClose: () => void }) {
  useBackCloses(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => box.current?.focus(), [])
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden />
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Parcours"
        className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] max-w-2xl flex-col overflow-y-auto overscroll-contain rounded-t-win border-t border-line bg-panel pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl outline-none"
        data-testid="parcours-fenetre"
      >
        <div className="mx-auto mt-2 mb-1 h-1 w-10 shrink-0 rounded-full bg-line" aria-hidden />
        <div className="flex items-center justify-between gap-2 px-4 pt-1">
          <ParcoursTitle paliers={paliers} />
          <button className="-mr-2 min-h-9 min-w-9 shrink-0 text-muted" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="px-4 pt-1">
          <ParcoursList paliers={paliers} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- Colonne (fiche large) ----------

/**
 * Colonne de gauche (fiche large) : le parcours par palier, collé sous l'en-tête (ou en haut du panneau de droite) et jamais
 * plus haut que l'écran : il défile dedans.
 */
export function ParcoursColumn({ paliers, inPanel }: { paliers: Palier[]; inPanel: boolean }) {
  if (!paliers.length) return null
  return (
    <aside
      aria-label="Parcours"
      className={`card sticky overflow-y-auto overscroll-contain p-3 ${
        inPanel ? 'top-0 max-h-[calc(100dvh-var(--hdr)-4rem)]' : 'top-[calc(var(--hdr)+0.75rem)] max-h-[calc(100dvh-var(--hdr)-1.5rem-var(--nav-b))]'
      }`}
      data-testid="parcours-colonne"
    >
      <ParcoursTitle paliers={paliers} />
      <ParcoursList paliers={paliers} />
    </aside>
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

/** Une ligne par palier ; un appui déplie ses étapes. */
function ParcoursList({ paliers }: { paliers: Palier[] }) {
  const [open, setOpen] = useState<PalierId | null>(null)
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
  const extra = [s.observers > 0 && `${s.observers} obs.`, s.avis > 0 && `${s.avis} avis`, s.mesures > 0 && 'mesures'].filter(Boolean).join(' · ')
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
