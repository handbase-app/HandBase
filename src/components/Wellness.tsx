import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { db, today, TRIAL, type Player, type PlayerGroup } from '../db'
import { w } from '../gender'
import { can, currentUserId, isParticipant, isPlayerRole, useRole, type Role } from '../roles'
import { supabase } from '../sync'
import {
  addDays,
  AREA_OTHER,
  CHARGE_WORDS,
  TONE_WORDS,
  type ChargeSummary,
  type ChargeTone,
  type Tone,
  areaOf,
  fmt1,
  isWeekday,
  myHistory,
  nearestPoint,
  painKey,
  painLine,
  painMax,
  painPlace,
  painTone,
  painWord,
  PAIN_ENTRIES_MAX,
  PAIN_TEXT_MAX,
  PAIN_TYPES,
  rpeWord,
  scaleWord,
  searchAreas,
  sessionLoad,
  SESSIONS_PER_DAY,
  SESSION_MINUTES_MAX,
  SILHOUETTE_POINTS,
  wellnessEnabledOf,
  WELLNESS_ITEMS,
  type BodyView,
  type PainEntry,
  type PainSide,
  type PainTone,
  type PainType,
  type Scores,
  type WellnessEntry,
  type WellnessKey,
  type WellnessSession,
} from '../wellness'
import { fetchMyWellness, isLocalWellness, removeMySession, saveMySession, saveMyWellness, type MyWellness } from '../wellnessApi'
import { ask } from './Confirm'
import { SectionTitle } from './ui'

/*
 * Wellness, côté JEUNE (page /moi ; src/wellness.ts, supabase/073_wellness.sql) :
 *  - « Mon wellness du jour » : en haut de la page, ouvert, du lundi au vendredi tant qu'il n'est pas rempli ; un seul écran,
 *    chaque note de 1 à 10 sur UNE ligne (10 segments joints, le mot positif de la valeur à côté du titre) ; « Douleurs,
 *    gênes » oui / non, et si oui : une ligne par endroit (silhouette face / dos où l'on touche près de l'endroit, liste
 *    cherchable des mêmes noms, ou endroit écrit), chacune avec ce que c'est et son intensité 1 à 10. Modifiable toute la journée.
 *  - Une fois rempli (ou le week-end) : une ligne repliée, « Modifier », « Ma séance » (intensité ressentie 1 à 10 ET durée,
 *    obligatoire ; aujourd'hui ou hier ; plusieurs par jour) et « Mes 14 derniers jours » (comparés à SA moyenne, ton positif).
 * Demandé seulement si le réglage de l'installation est ouvert, le compte relié et la fiche dans un groupe activé ; sinon rien
 * ne s'affiche. Aperçu d'un administrateur avec le serveur : une ligne d'explication, aucune donnée lue. Clavier seulement :
 * rien ne part vers une IA.
 * Partagés avec la version « tableau de bord de jeu » (coupée, src/components/WellnessHud.tsx) : PainPicker, PainDraft,
 * draftComplete, draftToPain, Form, fromEntry, History.
 */

/** « lun. 3 nov. » */
export const shortDay = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })

/** Réglage de l'installation, côté staff (copie de l'appareil) : mode essai ou sans serveur, toujours ouvert. */
export function useWellnessEnabled(): boolean {
  const rows = useLiveQuery(() => db.config.toArray(), [])
  return wellnessEnabledOf(rows ?? [], { trial: TRIAL, local: !supabase })
}

/** Lit le wellness d'un groupe : administrateur ; encadrant créateur ou participant du groupe. Miroir de hb_wl_staff_de (073). */
export const canReadWellness = (role: Role, g: Pick<PlayerGroup, 'createdBy' | 'editors' | 'teams'>) =>
  role === 'admin' || (role === 'preparateur' && (!g.createdBy || g.createdBy === currentUserId() || isParticipant(g)))
/** Active ou désactive : créateur (encadrant) ou administrateur, comme pour modifier le groupe. */
export const canToggleWellness = (role: Role, g: PlayerGroup) => (role === 'admin' || role === 'preparateur') && can.editGroup(role, g)

// ---------- Couleurs du staff (tableau du groupe, onglet Wellness de la fiche) ----------

/** Note colorée par rapport à SA moyenne : vert comme d'habitude ou mieux, ambre un peu en dessous, rouge doux nettement. */
export const TONE_CLS: Record<Tone, string> = {
  usual: 'border-gain/50 bg-gain/15 text-gain',
  below: 'border-spread-lo/50 bg-spread-lo/15 text-spread-lo',
  wellBelow: 'border-loss/50 bg-loss/15 text-loss',
  none: 'border-line bg-panel-2 text-fg',
}
export const CHARGE_CLS: Record<ChargeTone, string> = { usual: 'text-gain', more: 'text-spread-lo', muchMore: 'text-loss', less: 'text-muted', none: 'text-muted' }

/** Une note du jour (abréviation, valeur), colorée par rapport à sa moyenne ; `big` : onglet de la fiche. */
export function ScoreChip({ item, value, tone, avg, big }: { item: (typeof WELLNESS_ITEMS)[number]; value?: number; tone: Tone; avg?: number | null; big?: boolean }) {
  const has = typeof value === 'number'
  const title = `${item.label} : ${value ?? '—'} (${TONE_WORDS[tone]})`
  if (!big)
    return (
      <span className={`flex w-9 flex-col items-center rounded-md border py-0.5 ${has ? TONE_CLS[tone] : 'border-line text-muted'}`} title={title}>
        <span className="text-[8px] leading-tight opacity-80">{item.abbr}</span>
        <span className="text-sm leading-tight font-extrabold tabular-nums">{value ?? '—'}</span>
      </span>
    )
  return (
    <div className={`flex min-w-0 flex-col items-center rounded-lg border px-1 py-1.5 ${has ? TONE_CLS[tone] : 'border-line text-muted'}`} title={title} data-testid="note-wellness">
      <span className="w-full truncate text-center text-[10px] leading-tight font-bold">{item.short}</span>
      <span className="text-xl leading-tight font-extrabold tabular-nums">{value ?? '—'}</span>
      <span className="text-[9px] leading-tight text-muted">{typeof avg === 'number' ? `moy. ${fmt1(avg)}` : 'pas de moy.'}</span>
    </div>
  )
}

/** « Charge 7 j : 1 890 · moyenne 1 650 / sem. · habituelle » (rien sans séance sur 28 jours). */
export function ChargeLine({ charge, className = 'text-[10px] text-muted' }: { charge: ChargeSummary; className?: string }) {
  if (!(charge.sessions7 > 0 || charge.chronicWeekly > 0)) return null
  return (
    <span className={className}>
      Charge 7 j : <b className="text-fg tabular-nums">{Math.round(charge.acute).toLocaleString('fr-FR')}</b>
      {charge.chronicWeekly > 0 && ` · moyenne ${Math.round(charge.chronicWeekly).toLocaleString('fr-FR')} / sem.`} ·{' '}
      <span className={CHARGE_CLS[charge.tone]}>{CHARGE_WORDS[charge.tone]}</span>
    </span>
  )
}

// ---------- Douleurs : affichage commun (jeune, staff) ----------

/** Pastille « Gêne signalée » : sa couleur suit l'intensité la plus forte (légère : neutre ; moyenne : ambre ; forte : rouge doux). */
export const PAIN_FLAG_CLS: Record<PainTone, string> = {
  light: 'border-line bg-panel-2 text-fg',
  medium: 'border-spread-lo/50 bg-spread-lo/15 text-spread-lo',
  strong: 'border-loss/50 bg-loss/15 text-loss',
}
export const PAIN_TEXT_CLS: Record<PainTone, string> = { light: 'text-fg', medium: 'text-spread-lo', strong: 'text-loss' }

/** Les lignes d'une douleur : « Ischio-jambiers droits · Contracture · 6/10 », une par endroit. */
export function PainLines({ pains, className = '' }: { pains: readonly PainEntry[]; className?: string }) {
  return (
    <ul className={`flex min-w-0 flex-col ${className}`}>
      {pains.map((p) => (
        <li key={painKey(p)} className="break-words">
          {painLine(p)}
        </li>
      ))}
    </ul>
  )
}

/** Pastille + lignes (tableau du staff, historique). */
export function PainSummary({ entry, className = '' }: { entry: WellnessEntry; className?: string }) {
  const max = painMax(entry)
  if (max === null) return null
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 text-[11px] ${className}`} data-testid="douleurs">
      <span className={`w-fit rounded-full border px-2 py-0.5 text-[10px] font-bold ${PAIN_FLAG_CLS[painTone(max)]}`}>
        Gêne signalée · jusqu’à {max}/10
      </span>
      <PainLines pains={entry.pains ?? []} />
    </div>
  )
}

// ---------- Échelle 1 à 10 sur une ligne ----------

/**
 * Échelle 1 à 10 : 10 segments joints sur UNE ligne (44 px de haut, tient dans 360 px), ceux d'avant la valeur teintés, la
 * valeur pleine ; le mot de la valeur choisie à côté du titre. Flèches, Début / Fin au clavier ; toucher la valeur choisie
 * l'enlève.
 */
function Scale({ label, hint, value, onChange, word, small }: { label: string; hint?: string; value?: number; onChange: (v: number | undefined) => void; word: (v?: number) => string | null; small?: boolean }) {
  const shown = word(value)
  const group = useRef<HTMLDivElement>(null)
  const pick = (v: number) => {
    onChange(v)
    ;(group.current?.children[v - 1] as HTMLElement | undefined)?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = value ?? 0
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? Math.min(10, cur + 1) : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? Math.max(1, cur - 1) : e.key === 'Home' ? 1 : e.key === 'End' ? 10 : 0
    if (!next) return
    e.preventDefault()
    pick(next)
  }
  return (
    <fieldset className="min-w-0">
      <legend className="flex w-full flex-wrap items-baseline justify-between gap-x-2">
        <span className={`shrink-0 font-bold ${small ? 'text-xs' : 'text-sm'}`}>{label}</span>
        <span className="ml-auto text-right text-xs text-muted" aria-live="polite">
          {shown ? (
            <>
              {shown} · <b className="text-fg">{value}</b>/10
            </>
          ) : (
            hint
          )}
        </span>
      </legend>
      <div ref={group} role="radiogroup" aria-label={label} onKeyDown={onKey} className={`mt-1 flex overflow-hidden rounded-lg border border-line bg-panel-2 ${small ? 'h-10' : 'h-11'}`}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => {
          const on = value === v
          const before = typeof value === 'number' && v < value
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${v} sur 10`}
              tabIndex={on || (value === undefined && v === 1) ? 0 : -1}
              className={`min-w-0 flex-1 touch-manipulation border-l border-line text-[13px] font-bold tabular-nums transition-colors first:border-l-0 ${on ? 'bg-accent text-white' : before ? 'bg-accent/15 text-accent' : 'text-fg'}`}
              onClick={() => onChange(on ? undefined : v)}
            >
              {v}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

const scoreWord = (v?: number) => {
  const s = scaleWord(v)
  return s ? `${s.emoji} ${s.word}` : null
}

// ---------- Où ? Silhouette, liste ----------

/** Silhouette simple (repère 120 × 240) : tête, buste, bras et mains, jambes et pieds ; de dos, la colonne. */
function Silhouette({ view }: { view: BodyView }) {
  const arm = 'M36 40 Q28 42 26 50 L19 82 L13 112 L21 114 L28 84 L34 58 Z'
  const leg = 'M40 100 Q50 104 59 104 L58 140 L56 166 L54 214 L45 214 L42 166 L40 140 Z'
  const mirror = 'translate(120 0) scale(-1 1)'
  return (
    <g className="fill-panel-2 stroke-line" strokeWidth={1.5} strokeLinejoin="round">
      <circle cx={60} cy={15} r={11} />
      <rect x={54} y={25} width={12} height={11} rx={3} />
      <path d="M36 40 Q60 33 84 40 L80 101 Q60 107 40 101 Z" />
      <path d={arm} />
      <path d={arm} transform={mirror} />
      <ellipse cx={16} cy={122} rx={5} ry={8} />
      <ellipse cx={16} cy={122} rx={5} ry={8} transform={mirror} />
      <path d={leg} />
      <path d={leg} transform={mirror} />
      <ellipse cx={48} cy={226} rx={6} ry={9} />
      <ellipse cx={48} cy={226} rx={6} ry={9} transform={mirror} />
      {view === 'dos' && <path d="M60 40 L60 98 M50 106 Q60 110 70 106" fill="none" strokeDasharray="2 3" />}
    </g>
  )
}

/** Libellé d'un point (endroit et côté). */
const pointLabel = (area: string, cote?: PainSide) => painPlace({ zone: area, cote })

/**
 * Silhouette d'une vue : toucher n'importe où près d'un endroit le choisit (le point le plus proche, nearestPoint) ; les
 * endroits choisis portent le numéro de leur ligne. Clavier : chaque point se choisit avec Entrée ou Espace.
 */
function BodyMap({ view, pains, onToggle }: { view: BodyView; pains: readonly PainDraft[]; onToggle: (area: string, cote?: PainSide) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const pts = SILHOUETTE_POINTS.filter((p) => p.view === view)
  const indexOf = (area: string, cote?: PainSide) => pains.findIndex((x) => painKey(x) === painKey({ zone: area, cote }))
  function tap(e: MouseEvent<SVGSVGElement>) {
    const m = svg.current?.getScreenCTM()
    if (!m || (e.clientX === 0 && e.clientY === 0 && e.detail === 0)) return
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    const p = nearestPoint(view, pt.x, pt.y)
    if (p) onToggle(p.area, p.cote)
  }
  const [left, right] = view === 'face' ? ['droite', 'gauche'] : ['gauche', 'droite']
  return (
    <svg
      ref={svg}
      viewBox="0 0 120 240"
      className="mx-auto block h-auto w-full max-w-[210px] cursor-pointer touch-manipulation select-none"
      onClick={tap}
      role="group"
      aria-label={view === 'face' ? 'Silhouette de face : touche l’endroit' : 'Silhouette de dos : touche l’endroit'}
      data-testid={`silhouette-${view}`}
    >
      <Silhouette view={view} />
      <text x={3} y={9} className="fill-muted text-[7px] font-bold uppercase">
        {left}
      </text>
      <text x={117} y={9} textAnchor="end" className="fill-muted text-[7px] font-bold uppercase">
        {right}
      </text>
      {pts.map((p) => {
        const i = indexOf(p.area, p.cote)
        const on = i >= 0
        const label = pointLabel(p.area, p.cote)
        return (
          <g
            key={`${p.area}-${p.cote ?? ''}`}
            role="checkbox"
            aria-checked={on}
            aria-label={label}
            tabIndex={0}
            className="outline-none [&:focus-visible>circle]:stroke-accent [&:focus-visible>circle]:stroke-[2.5]"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              onToggle(p.area, p.cote)
            }}
          >
            <title>{label}</title>
            {on ? (
              <>
                <circle cx={p.x} cy={p.y} r={6.5} className="fill-accent stroke-panel" strokeWidth={1.2} />
                <text x={p.x} y={p.y + 2.6} textAnchor="middle" className="pointer-events-none fill-white text-[7.5px] font-bold">
                  {i + 1}
                </text>
              </>
            ) : (
              <circle cx={p.x} cy={p.y} r={2.4} className="fill-muted stroke-transparent" strokeWidth={4} opacity={0.7} />
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** La même liste d'endroits, cherchable : un endroit pair se choisit côté gauche ou droit. */
function AreaList({ pains, onToggle }: { pains: readonly PainDraft[]; onToggle: (area: string, cote?: PainSide) => void }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => searchAreas(q), [q])
  const on = (area: string, cote?: PainSide) => pains.some((x) => painKey(x) === painKey({ zone: area, cote }))
  const chip = (sel: boolean) => `min-h-9 shrink-0 rounded-full border px-3 text-xs font-bold ${sel ? 'border-accent bg-accent text-white' : 'border-line bg-panel'}`
  return (
    <div className="flex flex-col gap-2" data-testid="liste-endroits">
      <input type="search" className="field min-h-11 w-full" placeholder="Chercher (cuisse, dos…)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Chercher un endroit" />
      <ul className="max-h-72 divide-y divide-line overflow-y-auto overscroll-contain rounded-lg border border-line bg-panel">
        {list.map((a) => (
          <li key={a.id} className="flex min-h-11 items-center gap-1.5 px-2.5 py-1">
            <span className={`min-w-0 flex-1 text-sm ${a.id === AREA_OTHER ? 'text-muted' : ''}`}>{a.label}</span>
            {a.sides ? (
              (['g', 'd'] as const).map((c) => (
                <button key={c} type="button" aria-pressed={on(a.id, c)} aria-label={a.sides![c]} className={chip(on(a.id, c))} onClick={() => onToggle(a.id, c)}>
                  {c === 'g' ? 'Gauche' : 'Droite'}
                </button>
              ))
            ) : (
              <button type="button" aria-pressed={on(a.id)} aria-label={a.label} className={chip(on(a.id))} onClick={() => onToggle(a.id)}>
                {on(a.id) ? 'Choisi' : a.id === AREA_OTHER ? 'Écrire' : 'Choisir'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Une ligne de douleur en cours de saisie (type et intensité à choisir). */
export interface PainDraft {
  zone: string
  cote?: PainSide
  type?: PainType
  texte: string
  intensite?: number
}
export const draftComplete = (d: PainDraft) => !!d.type && !!d.intensite && (d.zone !== AREA_OTHER || !!d.texte.trim())
export const draftToPain = (d: PainDraft): PainEntry => {
  const keepText = d.zone === AREA_OTHER || d.type === 'autre'
  return { zone: d.zone, ...(d.cote ? { cote: d.cote } : {}), type: d.type!, ...(keepText && d.texte.trim() ? { texte: d.texte.trim() } : {}), intensite: d.intensite! }
}

/** Une ligne : numéro (celui du point de la silhouette), endroit, ce que c'est (puces), intensité 1 à 10 sur une ligne. */
function PainLineEditor({ n, d, onChange, onRemove }: { n: number; d: PainDraft; onChange: (patch: Partial<PainDraft>) => void; onRemove: () => void }) {
  const place = d.zone === AREA_OTHER ? 'Autre endroit' : painPlace(d)
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-panel p-2.5" data-testid="ligne-douleur">
      <div className="flex items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-white" aria-hidden>
          {n}
        </span>
        <span className="min-w-0 flex-1 text-sm font-bold break-words">{place}</span>
        <button type="button" className="-my-1 grid min-h-9 min-w-9 place-items-center rounded-full text-muted hover:text-fg" onClick={onRemove} aria-label={`Retirer ${place}`}>
          ✕
        </button>
      </div>
      {d.zone === AREA_OTHER && (
        <input className="field min-h-11 w-full" placeholder="Où ? (ex. côtes, à droite)" maxLength={PAIN_TEXT_MAX} value={d.texte} onChange={(e) => onChange({ texte: e.target.value })} aria-label="Où as-tu mal ? (texte)" />
      )}
      <div role="radiogroup" aria-label={`Ce que c’est : ${place}`} className="grid grid-cols-3 gap-1.5">
        {PAIN_TYPES.map((t) => {
          const on = d.type === t.id
          return (
            <button key={t.id} type="button" role="radio" aria-checked={on} className={`min-h-9 min-w-0 rounded-full border px-1 text-[11px] leading-tight font-bold whitespace-nowrap ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2'}`} onClick={() => onChange({ type: t.id })}>
              {t.label}
            </button>
          )
        })}
      </div>
      {d.type === 'autre' && d.zone !== AREA_OTHER && (
        <input className="field min-h-11 w-full" placeholder="Précise si tu veux (facultatif)" maxLength={PAIN_TEXT_MAX} value={d.texte} onChange={(e) => onChange({ texte: e.target.value })} aria-label={`Précision : ${place}`} />
      )}
      <Scale small label="Intensité" hint="1 légère → 10 forte" value={d.intensite} onChange={(v) => onChange({ intensite: v })} word={(v) => painWord(v)} />
    </div>
  )
}

/** Où ? Trois onglets (de face, de dos, liste), puis une ligne par endroit choisi. */
export function PainPicker({ pains, update }: { pains: PainDraft[]; update: (fn: (list: PainDraft[]) => PainDraft[]) => void }) {
  const [view, setView] = useState<BodyView | 'liste'>('face')
  const [note, setNote] = useState('')
  function toggle(area: string, cote?: PainSide) {
    const k = painKey({ zone: area, cote })
    const label = area === AREA_OTHER ? 'Autre endroit' : pointLabel(area, cote)
    if (pains.some((x) => painKey(x) === k)) {
      update((list) => list.filter((x) => painKey(x) !== k))
      setNote(`Retiré : ${label}`)
      return
    }
    if (pains.length >= PAIN_ENTRIES_MAX) return setNote(`${PAIN_ENTRIES_MAX} endroits au plus.`)
    update((list) => (list.some((x) => painKey(x) === k) || list.length >= PAIN_ENTRIES_MAX ? list : [...list, { zone: area, ...(areaOf(area)?.sides && cote ? { cote } : {}), texte: '' }]))
    setNote(`Ajouté : ${label}`)
  }
  const tabs = [
    ['face', 'De face'],
    ['dos', 'De dos'],
    ['liste', 'Liste'],
  ] as const
  return (
    <div className="flex flex-col gap-2.5">
      <div role="tablist" aria-label="Choisir l’endroit" className="grid grid-cols-3 overflow-hidden rounded-lg border border-line bg-panel-2">
        {tabs.map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={`min-h-10 border-l border-line text-xs font-bold first:border-l-0 ${view === v ? 'bg-accent text-white' : ''}`} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
      </div>
      {view === 'liste' ? <AreaList pains={pains} onToggle={toggle} /> : <BodyMap view={view} pains={pains} onToggle={toggle} />}
      <p className="min-h-4 text-center text-[11px] text-muted" aria-live="polite">
        {note || (view === 'liste' ? 'Gauche / droite : les tiens.' : 'Touche près de l’endroit ; gauche / droite : les tiens.')}
      </p>
      {pains.map((d, i) => (
        <PainLineEditor
          key={painKey(d)}
          n={i + 1}
          d={d}
          onChange={(patch) => update((list) => list.map((y) => (painKey(y) === painKey(d) ? { ...y, ...patch } : y)))}
          onRemove={() => toggle(d.zone, d.cote)}
        />
      ))}
    </div>
  )
}

// ---------- Questionnaire du matin ----------

export interface Form {
  scores: Scores
  pain: boolean | null
  pains: PainDraft[]
}
export const fromEntry = (e: WellnessEntry | null | undefined): Form => ({
  scores: { ...(e?.scores ?? {}) },
  pain: e ? e.pain : null,
  pains: (e?.pains ?? []).map((p) => ({ zone: p.zone, ...(p.cote ? { cote: p.cote } : {}), type: p.type, texte: p.texte ?? '', intensite: p.intensite })),
})

function MorningForm({ initial, onSaved, onCancel, playerId }: { initial: WellnessEntry | null; onSaved: (e: WellnessEntry) => void; onCancel?: () => void; playerId: string }) {
  const [f, setF] = useState<Form>(() => fromEntry(initial))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const painOk = f.pain !== true || (f.pains.length > 0 && f.pains.every(draftComplete))
  const answered = Object.keys(f.scores).length > 0 || f.pain === true
  const setScore = (k: WellnessKey, v: number | undefined) =>
    setF((x) => {
      const scores = { ...x.scores }
      if (v === undefined) delete scores[k]
      else scores[k] = v
      return { ...x, scores }
    })
  async function submit() {
    if (busy || !answered || !painOk) return
    setBusy(true)
    setErr('')
    const r = await saveMyWellness(playerId, { scores: f.scores, pain: f.pain === true, ...(f.pain ? { pains: f.pains.map(draftToPain) } : {}) })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    onSaved(r.value)
  }
  return (
    <div className="flex flex-col gap-3.5">
      {WELLNESS_ITEMS.map((it) => (
        <Scale key={it.key} label={it.label} hint={it.hint} value={f.scores[it.key]} onChange={(v) => setScore(it.key, v)} word={scoreWord} />
      ))}
      <fieldset className="min-w-0">
        <legend className="text-sm font-bold">Douleurs, gênes</legend>
        <div className="mt-1 grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-panel-2" role="radiogroup" aria-label="Douleurs, gênes">
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={f.pain === v}
              className={`min-h-11 border-l border-line text-sm font-bold first:border-l-0 ${f.pain === v ? 'bg-accent text-white' : ''}`}
              onClick={() => setF((x) => ({ ...x, pain: v }))}
            >
              {v ? 'Oui' : 'Non'}
            </button>
          ))}
        </div>
      </fieldset>
      {f.pain && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel-2/50 p-2.5" data-testid="douleur">
          <div>
            <div className="text-sm font-bold">Où ?</div>
            <p className="text-[11px] text-muted">Un ou plusieurs endroits ; pour chacun, ce que c’est et son intensité.</p>
          </div>
          <PainPicker pains={f.pains} update={(fn) => setF((x) => ({ ...x, pains: fn(x.pains) }))} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary min-h-11 px-5" disabled={busy || !answered || !painOk} onClick={() => void submit()}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {onCancel && (
          <button className="btn-ghost min-h-11 px-4 text-sm" onClick={onCancel}>
            Annuler
          </button>
        )}
        {!answered && <span className="text-[11px] text-muted">Réponds à ce que tu veux, puis enregistre.</span>}
        {answered && !painOk && (
          <span className="text-[11px] text-muted">{f.pains.length ? 'Pour chaque endroit : ce que c’est et l’intensité.' : 'Choisis au moins un endroit, ou réponds « Non ».'}</span>
        )}
        {err && <span className="text-[11px] text-red-300">{err}</span>}
      </div>
    </div>
  )
}

// ---------- « Ma séance » ----------

function SessionForm({ playerId, sessions, edit, onDone }: { playerId: string; sessions: WellnessSession[]; edit: WellnessSession | null; onDone: (changed: boolean) => void }) {
  const t = today()
  const [day, setDay] = useState(edit?.day ?? t)
  const [rpe, setRpe] = useState<number | undefined>(edit?.rpe)
  const [minutes, setMinutes] = useState(edit ? String(edit.minutes) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const mins = minutes.trim() ? Number(minutes) : undefined
  const minsOk = mins !== undefined && Number.isInteger(mins) && mins >= 1 && mins <= SESSION_MINUTES_MAX
  const full = !edit && sessions.filter((s) => s.day === day).length >= SESSIONS_PER_DAY
  async function submit() {
    if (busy || !rpe || !minsOk || full) return
    setBusy(true)
    setErr('')
    const r = await saveMySession(playerId, { id: edit?.id, day, rpe, minutes: mins })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    onDone(true)
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel-2/50 p-3" data-testid="ma-seance">
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-panel" role="radiogroup" aria-label="Jour de la séance">
        {[t, addDays(t, -1)].map((d, i) => (
          <button key={d} type="button" role="radio" aria-checked={day === d} className={`min-h-11 border-l border-line text-sm font-bold first:border-l-0 ${day === d ? 'bg-accent text-white' : ''}`} onClick={() => setDay(d)}>
            {i === 0 ? 'Aujourd’hui' : 'Hier'}
          </button>
        ))}
      </div>
      <Scale label="Intensité ressentie" hint="de 1 à 10" value={rpe} onChange={setRpe} word={(v) => rpeWord(v)} />
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-bold">Durée</span>
          <span className="text-xs text-muted">{minsOk && rpe ? `charge ${sessionLoad({ rpe, minutes: mins })}` : 'en minutes'}</span>
        </div>
        <div className="mt-1 grid grid-cols-4 gap-1.5">
          <input className="field min-h-11 w-full min-w-0 text-center" inputMode="numeric" maxLength={3} placeholder="min" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} aria-label="Durée en minutes" aria-required="true" />
          {[60, 90, 120].map((m) => (
            <button key={m} type="button" className={`min-h-11 min-w-0 rounded-lg border px-1 text-xs font-bold whitespace-nowrap ${mins === m ? 'border-accent bg-accent text-white' : 'border-line bg-panel'}`} onClick={() => setMinutes(String(m))}>
              {m} min
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary min-h-11 px-5" disabled={busy || !rpe || !minsOk || full} onClick={() => void submit()}>
          {busy ? 'Enregistrement…' : edit ? 'Enregistrer' : 'Ajouter ma séance'}
        </button>
        <button className="btn-ghost min-h-11 px-4 text-sm" onClick={() => onDone(false)}>
          Annuler
        </button>
        {mins !== undefined && !minsOk && <span className="text-[11px] text-red-300">Durée : de 1 à {SESSION_MINUTES_MAX} minutes.</span>}
        {(!rpe || mins === undefined) && !full && <span className="text-[11px] text-muted">L’intensité et la durée, pour calculer ta charge.</span>}
        {full && <span className="text-[11px] text-muted">{SESSIONS_PER_DAY} séances ce jour-là : c’est le maximum.</span>}
        {err && <span className="text-[11px] text-red-300">{err}</span>}
      </div>
    </div>
  )
}

/** « Intensité 7/10 (Difficile) · 90 min · charge 630 ». */
const sessionLine = (s: WellnessSession) => `Intensité ${s.rpe}/10 (${rpeWord(s.rpe)}) · ${s.minutes} min · charge ${sessionLoad(s)}`

// ---------- 14 derniers jours ----------

export function History({ entries }: { entries: WellnessEntry[] }) {
  const h = useMemo(() => myHistory(entries, today()), [entries])
  const withPain = h.days.filter((e) => painMax(e) !== null)
  return (
    <div className="flex flex-col gap-2" data-testid="wellness-historique">
      <p className="text-xs">{h.line}</p>
      {h.days.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {WELLNESS_ITEMS.map((it) => (
              <div key={it.key} className="rounded-lg border border-line bg-panel-2 px-2 py-1.5">
                <div className="text-[10px] text-muted">{it.short}</div>
                <div className="text-sm font-bold tabular-nums">{h.recent[it.key] !== null ? fmt1(h.recent[it.key] as number) : '—'}</div>
                <div className="text-[10px] text-muted">{h.usual[it.key] !== null ? `ta moyenne : ${fmt1(h.usual[it.key] as number)}` : ' '}</div>
              </div>
            ))}
          </div>
          <table className="w-full table-fixed text-center text-[11px] tabular-nums">
            <thead className="text-[10px] text-muted">
              <tr>
                <th className="w-[30%] py-1 text-left font-normal">Jour</th>
                {WELLNESS_ITEMS.map((it) => (
                  <th key={it.key} className="py-1 font-normal">
                    {it.abbr}
                  </th>
                ))}
                <th className="py-1 font-normal">Gêne</th>
              </tr>
            </thead>
            <tbody>
              {h.days.map((e) => {
                const max = painMax(e)
                return (
                  <tr key={e.day} className="border-t border-line">
                    <td className="truncate py-1.5 text-left">{shortDay(e.day)}</td>
                    {WELLNESS_ITEMS.map((it) => (
                      <td key={it.key} className="py-1.5">
                        {e.scores[it.key] ?? '—'}
                      </td>
                    ))}
                    <td className={`py-1.5 font-bold ${max !== null ? PAIN_TEXT_CLS[painTone(max)] : ''}`} title={e.pains?.map(painLine).join(' ; ')}>
                      {max !== null ? `${max}/10` : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {withPain.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-bold text-muted">Mes gênes signalées</div>
              {withPain.map((e) => (
                <div key={e.day} className="text-[11px]">
                  <span className="text-muted">{shortDay(e.day)}</span>
                  <PainLines pains={e.pains ?? []} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------- La carte de la page du jeune ----------

/**
 * `onPending` (« Ma page » en onglets) : prévenu à chaque changement, vrai quand le questionnaire du jour est demandé et pas
 * encore rempli (jour de semaine, qui peut l'enregistrer) : petit point sur l'onglet Aujourd'hui.
 */
export function MyWellnessCard({ player: p, canWrite, onPending }: { player: Player; canWrite: boolean; onPending?: (pending: boolean) => void }) {
  const role = useRole()
  const g = w(p.sex)
  // Son compte, l'essai ou une fiche de démonstration : ses données ; aperçu d'un administrateur avec le serveur : rien.
  const mine = isPlayerRole(role) || isLocalWellness(p.id)
  const [data, setData] = useState<MyWellness | null>(null)
  const [mode, setMode] = useState<'idle' | 'edit' | 'session' | 'history'>('idle')
  const [editSession, setEditSession] = useState<WellnessSession | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const load = () => fetchMyWellness(p.id, 28).then((r) => (r.ok ? setData(r.value) : (setData(null), !r.missing && setErr(r.error))))
  useEffect(() => {
    if (!mine) return
    let live = true
    void fetchMyWellness(p.id, 28).then((r) => live && (r.ok ? setData(r.value) : setData(null)))
    return () => {
      live = false
    }
  }, [p.id, mine])
  const pending = mine && canWrite && !!data?.enabled && data.requested && isWeekday(today()) && !data.entries.some((e) => e.day === today())
  useEffect(() => onPending?.(pending), [pending, onPending])

  if (!mine) {
    return (
      <p className="text-[11px] text-muted" data-testid="wellness-apercu">
        Wellness : si son groupe le demande, le questionnaire du matin s’affiche ici pour {g.leJoueur} (ses réponses ne sont lues que par le staff du groupe).
      </p>
    )
  }
  if (!data || !data.enabled || !data.requested) return err ? <p className="text-[11px] text-muted">{err}</p> : null

  const t = today()
  const entry = data.entries.find((e) => e.day === t) ?? null
  const weekday = isWeekday(t)
  // Ouvert en haut : jour de semaine, pas encore rempli ; ou « Modifier ».
  const open = canWrite && ((weekday && !entry && mode === 'idle') || mode === 'edit')
  const recentSessions = data.sessions.filter((s) => s.day === t || s.day === addDays(t, -1))

  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="mon-wellness">
      <SectionTitle info="Chaque matin du lundi au vendredi, quelques secondes pour dire comment tu te sens. Pas de bonne ou de mauvaise réponse : ça aide ton encadrant à adapter l’entraînement. Seul le staff de ton groupe le lit.">
        Mon wellness du jour
      </SectionTitle>
      {open ? (
        <MorningForm
          playerId={p.id}
          initial={entry}
          onCancel={entry ? () => setMode('idle') : undefined}
          onSaved={(e) => {
            setData((d) => (d ? { ...d, entries: [e, ...d.entries.filter((x) => x.day !== e.day)] } : d))
            setMode('idle')
            setMsg('Enregistré, ton encadrant peut le lire.')
          }}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {entry ? (
              <>
                <b>Merci !</b> Ton wellness d’aujourd’hui est enregistré
                {Object.keys(entry.scores).length > 0 && (
                  <span className="text-muted">
                    {' '}
                    · {WELLNESS_ITEMS.filter((it) => entry.scores[it.key]).map((it) => `${it.short} ${entry.scores[it.key]}`).join(' · ')}
                  </span>
                )}
              </>
            ) : weekday ? (
              'Pas encore rempli aujourd’hui.'
            ) : (
              'C’est le week-end : pas de questionnaire, profite bien.'
            )}
          </p>
          {entry?.pain && entry.pains?.length ? (
            <div className="text-xs text-muted">
              Gêne signalée :
              <PainLines pains={entry.pains} className="text-fg" />
            </div>
          ) : null}
          {msg && (
            <p role="status" className="text-[11px] text-emerald-300">
              {msg}
            </p>
          )}
          {canWrite && (
            <div className="flex flex-wrap gap-2">
              {/* Le week-end, rien n'est demandé (aucun taux ne le compte) ; le jeune peut quand même répondre. */}
              <button className={`${entry || weekday ? 'btn-soft' : 'btn-ghost'} min-h-11 px-4 text-sm`} onClick={() => (setMsg(''), setMode('edit'))}>
                {entry ? 'Modifier' : weekday ? 'Remplir' : 'Le remplir quand même'}
              </button>
              <button className="btn-soft min-h-11 px-4 text-sm" onClick={() => (setMsg(''), setEditSession(null), setMode(mode === 'session' ? 'idle' : 'session'))} aria-expanded={mode === 'session'}>
                + Ma séance
              </button>
              <button className="btn-ghost min-h-11 px-4 text-sm" onClick={() => setMode(mode === 'history' ? 'idle' : 'history')} aria-expanded={mode === 'history'}>
                Mes 14 derniers jours
              </button>
            </div>
          )}
        </div>
      )}

      {mode === 'session' && (
        <SessionForm
          key={editSession?.id ?? 'nouvelle'}
          playerId={p.id}
          sessions={data.sessions}
          edit={editSession}
          onDone={(changed) => {
            setMode('idle')
            setEditSession(null)
            if (changed) {
              setMsg('Séance enregistrée, ton encadrant peut la lire.')
              void load()
            }
          }}
        />
      )}
      {recentSessions.length > 0 && mode !== 'session' && (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-bold text-muted">Mes séances d’hier et d’aujourd’hui</div>
          <ul className="flex flex-col gap-1">
            {recentSessions.map((s) => (
              <li key={s.id} className="flex min-w-0 flex-col text-xs">
                <span className="break-words">
                  <span className="text-muted">{s.day === t ? 'Aujourd’hui' : 'Hier'} · </span>
                  {sessionLine(s)}
                </span>
                {canWrite && (
                  <span className="-ml-2 flex gap-1">
                    <button className="min-h-9 px-2 text-[11px] text-muted underline underline-offset-2" onClick={() => (setEditSession(s), setMode('session'))}>
                      Modifier
                    </button>
                    <button
                      className="min-h-9 px-2 text-[11px] text-muted underline underline-offset-2"
                      onClick={async () => {
                        if (!(await ask('Retirer cette séance ?', { ok: 'Retirer', focusCancel: true }))) return
                        const r = await removeMySession(p.id, s.id)
                        if (!r.ok) return setMsg(r.error)
                        void load()
                      }}
                    >
                      Retirer
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode === 'history' && <History entries={data.entries} />}
    </section>
  )
}
