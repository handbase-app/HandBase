import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { db, today, TRIAL, type PlayerGroup } from '../db'
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
  isTopLevel,
  isWeekday,
  LEVEL_INVITE,
  LEVEL_WORDS,
  levelWord,
  myHistory,
  RPE_QUESTION,
  rpeLevel,
  type LevelWord,
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

/*
 * Wellness, côté JEUNE (page /moi, onglet Aujourd'hui : src/components/TodayHud.tsx ; src/wellness.ts, supabase/073_wellness.sql).
 * Style « jeu vidéo » au thème NEXTAR depuis le 09/11 (maquette validée par Geoffroy : « les jeunes, ça les fait chier de
 * lire… un truc plus péchu »), dans un bloc .hud (src/index.css) :
 *  - « Ma forme » (MorningForm) : chaque note de 1 à 10 en jauge à toucher (HudGauge : question fun, gros émoji et mot positif
 *    de la tranche, 10 segments obliques) ; « Une douleur quelque part ? » « Nan, frais » / « Oui, là », et si oui : une ligne
 *    par endroit (silhouette face / dos où l'on touche près de l'endroit, liste cherchable des mêmes noms, ou endroit écrit),
 *    chacune avec ce que c'est et son intensité 1 à 10. « Envoyer » ; modifiable toute la journée. Résumé : WellnessSummary.
 *  - « Ma séance » (SessionForm) : intensité ressentie 1 à 10 en jauge ET durée, obligatoire ; aujourd'hui ou hier ;
 *    plusieurs par jour (RecentSessions) ; « Mes 14 derniers jours » (History : comparés à SA moyenne, ton positif).
 * Demandé seulement si le réglage de l'installation est ouvert, le compte relié et la fiche dans un groupe activé ; sinon rien
 * ne s'affiche. Aperçu d'un administrateur avec le serveur : une ligne d'explication, aucune donnée lue (useMyWellness).
 * Clavier seulement : rien ne part vers une IA.
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
interface PainDraft {
  zone: string
  cote?: PainSide
  type?: PainType
  texte: string
  intensite?: number
}
const draftComplete = (d: PainDraft) => !!d.type && !!d.intensite && (d.zone !== AREA_OTHER || !!d.texte.trim())
const draftToPain = (d: PainDraft): PainEntry => {
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
function PainPicker({ pains, update }: { pains: PainDraft[]; update: (fn: (list: PainDraft[]) => PainDraft[]) => void }) {
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

// ---------- Jauge du « tableau de bord de jeu » (Ma page du jeune) ----------

/**
 * Jauge à toucher (maquette du 09/11, thème NEXTAR, dans un bloc .hud) : petite question fun, gros émoji et mot de la tranche,
 * le chiffre à droite ; 10 segments obliques, toucher le k-ième met la note à k (remplis en turquoise, en menthe à 9 ou 10).
 * Segments de 32 px de haut, sur toute la largeur (≈ 26 px de large à 360 px). Clavier : flèches, Début / Fin.
 */
export function HudGauge({
  label,
  question,
  value,
  onChange,
  level,
  invite = LEVEL_INVITE,
}: {
  label: string
  question: string
  value?: number
  onChange: (v: number) => void
  level: (v?: number) => LevelWord | null
  invite?: LevelWord
}) {
  const group = useRef<HTMLDivElement>(null)
  const lv = level(value)
  const shown = lv ?? invite
  const top = isTopLevel(value)
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
    <fieldset className="min-w-0" data-testid="jauge">
      <legend className="sr-only">{label}</legend>
      <div className="text-xs font-bold text-muted" aria-hidden>
        {question}
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-2.5" aria-live="polite">
        <span className="text-[32px] leading-none" aria-hidden>
          {shown.emoji}
        </span>
        <span className={`hud-big min-w-0 flex-1 text-[22px] break-words ${lv ? '' : 'text-muted'}`}>{shown.word}</span>
        <span className="hud-big shrink-0 text-[30px] tabular-nums" style={{ color: top ? 'var(--hud-top)' : 'var(--hud-accent)' }}>
          {value ?? '–'}
          <span className="text-xs font-bold text-muted not-italic">/10</span>
        </span>
      </div>
      <div ref={group} role="radiogroup" aria-label={label} onKeyDown={onKey} className="mt-2 flex gap-1 px-1.5">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => {
          const on = typeof value === 'number' && v <= value
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={value === v}
              aria-label={`${label} : ${v} sur 10`}
              tabIndex={value === v || (value === undefined && v === 1) ? 0 : -1}
              className={`hud-skew h-8 min-w-0 flex-1 touch-manipulation ${on ? (top ? 'hud-top' : 'hud-on') : 'hud-off'}`}
              onClick={() => onChange(v)}
            />
          )
        })}
      </div>
    </fieldset>
  )
}

/** Gros bouton oblique (choix, envoi) : `tone` « on » turquoise, « top » menthe, sinon fond panneau. */
function HudButton({ tone, className = '', children, ...rest }: { tone?: 'on' | 'top' | null; className?: string; children: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>) {
  return (
    <button type="button" className={`hud-skew touch-manipulation ${tone === 'on' ? 'hud-on' : tone === 'top' ? 'hud-top' : 'hud-tile'} ${className}`} {...rest}>
      <span className="hud-unskew flex items-center justify-center gap-1.5">{children}</span>
    </button>
  )
}

// ---------- Questionnaire du matin (« Ma forme ») ----------

interface Form {
  scores: Scores
  pain: boolean | null
  pains: PainDraft[]
}
const fromEntry = (e: WellnessEntry | null | undefined): Form => ({
  scores: { ...(e?.scores ?? {}) },
  pain: e ? e.pain : null,
  pains: (e?.pains ?? []).map((p) => ({ zone: p.zone, ...(p.cote ? { cote: p.cote } : {}), type: p.type, texte: p.texte ?? '', intensite: p.intensite })),
})

/**
 * Saisie de la forme, dans le bloc .hud de l'onglet Aujourd'hui : une jauge par note, « Une douleur quelque part ? » (« Nan,
 * frais » / « Oui, là », qui ouvre la saisie des endroits, types et intensités), « Envoyer ». Même envoi qu'avant
 * (saveMyWellness → hb_wellness_enregistrer) ; un wellness déjà envoyé se reprend tel quel (Modifier).
 */
export function MorningForm({ initial, onSaved, onCancel, playerId }: { initial: WellnessEntry | null; onSaved: (e: WellnessEntry) => void; onCancel?: () => void; playerId: string }) {
  const [f, setF] = useState<Form>(() => fromEntry(initial))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const painOk = f.pain !== true || (f.pains.length > 0 && f.pains.every(draftComplete))
  const answered = Object.keys(f.scores).length > 0 || f.pain === true
  const setScore = (k: WellnessKey, v: number) => setF((x) => ({ ...x, scores: { ...x.scores, [k]: v } }))
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
    <div className="flex flex-col gap-5" data-testid="saisie-forme">
      {WELLNESS_ITEMS.map((it) => (
        <HudGauge key={it.key} label={it.label} question={LEVEL_WORDS[it.key].question} value={f.scores[it.key]} onChange={(v) => setScore(it.key, v)} level={(v) => levelWord(it.key, v)} />
      ))}
      <fieldset className="min-w-0">
        <legend className="text-xs font-bold text-muted">Une douleur quelque part ?</legend>
        <div className="mt-2 grid grid-cols-2 gap-3 px-1.5" role="radiogroup" aria-label="Une douleur quelque part ?">
          <HudButton role="radio" aria-checked={f.pain === false} tone={f.pain === false ? 'on' : null} className="min-h-14" onClick={() => setF((x) => ({ ...x, pain: false }))}>
            <span aria-hidden className="text-xl">😎</span>
            <span className="hud-big text-lg">Nan, frais</span>
          </HudButton>
          <HudButton role="radio" aria-checked={f.pain === true} tone={f.pain === true ? 'top' : null} className="min-h-14" onClick={() => setF((x) => ({ ...x, pain: true }))}>
            <span aria-hidden className="text-xl">📍</span>
            <span className="hud-big text-lg">Oui, là</span>
          </HudButton>
        </div>
      </fieldset>
      {f.pain && (
        <div className="flex flex-col gap-2 rounded-[4px] border border-line bg-panel/60 p-2.5" data-testid="douleur">
          <div>
            <div className="text-sm font-bold">Où ?</div>
            <p className="text-[11px] text-muted">Un ou plusieurs endroits ; pour chacun, ce que c’est et son intensité.</p>
          </div>
          <PainPicker pains={f.pains} update={(fn) => setF((x) => ({ ...x, pains: fn(x.pains) }))} />
        </div>
      )}
      <div className="flex flex-col gap-2 px-1.5">
        <HudButton tone="on" className="min-h-14 w-full" disabled={busy || !answered || !painOk} onClick={() => void submit()} data-testid="envoyer-forme">
          <span className="hud-big text-xl">{busy ? 'Envoi…' : 'Envoyer'}</span>
          {!busy && (
            <span aria-hidden className="text-xl">
              🚀
            </span>
          )}
        </HudButton>
        <div className="flex flex-wrap items-center justify-center gap-x-3 text-center">
          {onCancel && (
            <button type="button" className="min-h-9 text-xs font-bold text-muted underline underline-offset-2" onClick={onCancel}>
              Annuler
            </button>
          )}
          {!answered && <span className="text-[11px] text-muted">Touche une jauge, puis envoie.</span>}
          {answered && !painOk && (
            <span className="text-[11px] text-muted">{f.pains.length ? 'Pour chaque endroit : ce que c’est et l’intensité.' : 'Choisis au moins un endroit, ou « Nan, frais ».'}</span>
          )}
          {err && <span className="text-[11px] text-red-300">{err}</span>}
        </div>
      </div>
    </div>
  )
}

/** Résumé visuel du wellness envoyé : 4 petites cases (émoji, mot, mini-jauge) ; la gêne signalée en dessous. */
export function WellnessSummary({ entry }: { entry: WellnessEntry }) {
  const items = WELLNESS_ITEMS.filter((it) => typeof entry.scores[it.key] === 'number')
  return (
    <div className="flex flex-col gap-2" data-testid="resume-forme">
      {items.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 px-1.5">
          {items.map((it) => {
            const v = entry.scores[it.key] as number
            const lv = levelWord(it.key, v)
            const top = isTopLevel(v)
            return (
              <li key={it.key} className="hud-skew hud-tile min-w-0 px-2.5 py-1.5" title={`${it.label} : ${v}/10`}>
                <div className="hud-unskew flex min-w-0 items-center gap-1.5">
                  <span aria-hidden className="text-lg leading-none">
                    {lv?.emoji}
                  </span>
                  <span className="min-w-0 flex-1 text-[11px] leading-tight font-extrabold break-words italic">
                    <span className="sr-only">{it.short} : </span>
                    {lv?.word}
                  </span>
                  <span className="text-xs font-extrabold tabular-nums" style={{ color: top ? 'var(--hud-top)' : 'var(--hud-accent)' }}>
                    {v}
                  </span>
                </div>
                <div className="hud-unskew mt-1 flex gap-[2px]" aria-hidden>
                  {Array.from({ length: 10 }, (_, i) => (
                    <span key={i} className={`h-1 flex-1 rounded-[1px] ${i < v ? (top ? 'hud-top' : 'hud-on') : 'hud-off'}`} />
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {entry.pain && entry.pains?.length ? (
        <div className="px-1.5 text-xs text-muted">
          <span aria-hidden>📍 </span>Gêne signalée :
          <PainLines pains={entry.pains} className="text-fg" />
        </div>
      ) : null}
    </div>
  )
}

// ---------- « Ma séance » ----------

const MINUTE_CHOICES = [60, 90, 120]

/** Saisie d'une séance (dans le bloc .hud) : jour, jauge de l'intensité ressentie, durée OBLIGATOIRE (choix ou minutes). */
export function SessionForm({ playerId, sessions, edit, onDone }: { playerId: string; sessions: WellnessSession[]; edit: WellnessSession | null; onDone: (changed: boolean) => void }) {
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
    <div className="flex flex-col gap-5" data-testid="ma-seance">
      <div className="grid grid-cols-2 gap-3 px-1.5" role="radiogroup" aria-label="Jour de la séance">
        {[t, addDays(t, -1)].map((d, i) => (
          <HudButton key={d} role="radio" aria-checked={day === d} tone={day === d ? 'on' : null} className="min-h-11" onClick={() => setDay(d)}>
            <span className="text-sm font-extrabold italic">{i === 0 ? 'Aujourd’hui' : 'Hier'}</span>
          </HudButton>
        ))}
      </div>
      <HudGauge label="Intensité ressentie" question={RPE_QUESTION} value={rpe} onChange={setRpe} level={(v) => rpeLevel(v)} />
      <fieldset className="min-w-0">
        <legend className="flex w-full items-baseline justify-between gap-2 text-xs font-bold text-muted">
          <span>Ça a duré combien ?</span>
          <span className="font-normal">{minsOk && rpe ? `charge ${sessionLoad({ rpe, minutes: mins })}` : 'obligatoire'}</span>
        </legend>
        <div className="mt-2 grid grid-cols-4 gap-2.5 px-1.5">
          {MINUTE_CHOICES.map((m) => (
            <HudButton key={m} aria-pressed={mins === m} tone={mins === m ? 'on' : null} className="min-h-14 min-w-0" onClick={() => setMinutes(String(m))}>
              <span className="flex flex-col items-center leading-none">
                <span className="hud-big text-2xl tabular-nums">{m}</span>
                <span className="text-[10px] font-bold">min</span>
              </span>
            </HudButton>
          ))}
          <div className={`hud-skew min-h-14 min-w-0 ${mins !== undefined && !MINUTE_CHOICES.includes(mins) ? 'hud-on' : 'hud-tile'}`}>
            <input
              className="hud-unskew h-full w-full min-w-0 bg-transparent text-center text-xl font-extrabold italic tabular-nums outline-none placeholder:text-sm placeholder:font-bold placeholder:text-[var(--hud-muted)]"
              inputMode="numeric"
              maxLength={3}
              placeholder="autre"
              value={mins !== undefined && MINUTE_CHOICES.includes(mins) ? '' : minutes}
              onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
              aria-label="Durée en minutes"
              aria-required="true"
            />
          </div>
        </div>
      </fieldset>
      <div className="flex flex-col gap-2 px-1.5">
        <HudButton tone="on" className="min-h-14 w-full" disabled={busy || !rpe || !minsOk || full} onClick={() => void submit()} data-testid="envoyer-seance">
          <span className="hud-big text-xl">{busy ? 'Envoi…' : edit ? 'Enregistrer' : 'Envoyer'}</span>
          {!busy && (
            <span aria-hidden className="text-xl">
              💪
            </span>
          )}
        </HudButton>
        <div className="flex flex-wrap items-center justify-center gap-x-3 text-center">
          <button type="button" className="min-h-9 text-xs font-bold text-muted underline underline-offset-2" onClick={() => onDone(false)}>
            Annuler
          </button>
          {mins !== undefined && !minsOk && <span className="text-[11px] text-red-300">Durée : de 1 à {SESSION_MINUTES_MAX} minutes.</span>}
          {(!rpe || mins === undefined) && !full && <span className="text-[11px] text-muted">L’intensité et la durée, pour calculer ta charge.</span>}
          {full && <span className="text-[11px] text-muted">{SESSIONS_PER_DAY} séances ce jour-là : c’est le maximum.</span>}
          {err && <span className="text-[11px] text-red-300">{err}</span>}
        </div>
      </div>
    </div>
  )
}

/** Séances d'hier et d'aujourd'hui (« Modifier », « Retirer ») : émoji et mot de l'intensité, durée, charge. */
export function RecentSessions({ sessions, canWrite, playerId, onEdit, onChanged }: { sessions: WellnessSession[]; canWrite: boolean; playerId: string; onEdit: (s: WellnessSession) => void; onChanged: (msg?: string) => void }) {
  const t = today()
  const list = sessions.filter((s) => s.day === t || s.day === addDays(t, -1))
  if (!list.length) return null
  return (
    <ul className="flex flex-col gap-2 px-1.5" data-testid="mes-seances-recentes">
      {list.map((s) => {
        const lv = rpeLevel(s.rpe)
        return (
          <li key={s.id} className="hud-skew hud-tile px-3 py-1.5">
            <div className="hud-unskew flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span aria-hidden className="text-xl leading-none">
                {lv?.emoji}
              </span>
              <span className="min-w-0 flex-1 text-xs">
                <b className="italic">{lv?.word}</b> <span className="text-muted">· {s.day === t ? 'aujourd’hui' : 'hier'} · {s.rpe}/10 · {s.minutes} min · charge {sessionLoad(s)}</span>
              </span>
              {canWrite && (
                <span className="flex gap-1">
                  <button className="min-h-9 px-1.5 text-[11px] text-muted underline underline-offset-2" onClick={() => onEdit(s)}>
                    Modifier
                  </button>
                  <button
                    className="min-h-9 px-1.5 text-[11px] text-muted underline underline-offset-2"
                    onClick={async () => {
                      if (!(await ask('Retirer cette séance ?', { ok: 'Retirer', focusCancel: true }))) return
                      const r = await removeMySession(playerId, s.id)
                      onChanged(r.ok ? undefined : r.error)
                    }}
                  >
                    Retirer
                  </button>
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

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

// ---------- Données du jeune ----------

/**
 * Wellness du jeune pour l'onglet Aujourd'hui (src/components/TodayHud.tsx) : `mine` (son compte, l'essai ou une fiche de
 * démonstration ; aperçu d'un administrateur avec le serveur : rien n'est lu), ses 28 derniers jours (`data`, undefined tant
 * que ce n'est pas lu), `pending` : questionnaire du jour demandé et pas encore rempli (jour de semaine, qui peut
 * l'enregistrer) : petit point sur l'onglet.
 */
export function useMyWellness(playerId: string, canWrite: boolean) {
  const role = useRole()
  const mine = isPlayerRole(role) || isLocalWellness(playerId)
  const [data, setData] = useState<MyWellness | null | undefined>(undefined)
  const [err, setErr] = useState('')
  const load = () => fetchMyWellness(playerId, 28).then((r) => (r.ok ? setData(r.value) : (setData(null), setErr(r.missing ? '' : r.error))))
  useEffect(() => {
    if (!mine) return
    let live = true
    void fetchMyWellness(playerId, 28).then((r) => {
      if (!live) return
      if (r.ok) setData(r.value)
      else (setData(null), setErr(r.missing ? '' : r.error))
    })
    return () => {
      live = false
    }
  }, [playerId, mine])
  const pending = mine && canWrite && !!data?.enabled && data.requested && isWeekday(today()) && !data.entries.some((e) => e.day === today())
  return { mine, data, setData, err, load, pending }
}
