import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import {
  CAHIER_FIELDS,
  CAHIER_TEXT_MAX,
  cleanCahier,
  cleanMatch,
  MATCH_FEELINGS,
  MATCH_HALF_MAX,
  MATCH_RESULTS,
  MATCH_SCORE_MAX,
  MATCH_TEXT_MAX,
  MATCH_TEXTS,
  OPPONENT_MAX,
  playTime,
  resultOf,
  writableDays,
  type CahierKind,
  type CahierParts,
  type MatchFeeling,
  type MatchParts,
  type MatchResult,
} from '../cahiers'
import { db, TRIAL } from '../db'
import { DEMO_LAMP_ZONE } from '../demoLamp'
import { accord } from '../gender'
import { dow, lampContext, lampView, pctText, TASK, todayLine, WISHES_MAX, type LampView, type LampWish, type TaskKey } from '../lamp'
import { fetchMyCahiers, fetchMyLamp, saveCahier, saveMyWishes, type MyLamp } from '../lampApi'
import { shareNote } from '../playerJournal'
import type { JournalNote } from '../playerSpace'
import { isPlayerRole, useRole } from '../roles'
import { supabase } from '../sync'
import { isLocalWellness } from '../wellnessApi'
import { pillClass } from './FilterWindow'
import { FormActions, FormWindow } from './FormWindow'
import { SectionTitle } from './ui'

/*
 * « 🪔 Ma lampe » : la Lampe d'Aladin du jeune (page /moi ; src/lamp.ts, supabase/074_lampe.sql).
 *  - Une lampe qui s'allume (halo et flamme selon le pourcentage), le pourcentage, ce qu'elle peut encore atteindre (toujours
 *    dit en positif), ce qui reste aujourd'hui (« Encore ton cahier du hand pour allumer ta journée »), la série de journées
 *    allumées (montrée seulement quand elle existe : jamais de reproche quand elle s'arrête), les trois trimestres, le bonus
 *    du week-end, et la part des encadrants seulement quand elle est donnée (« + x % de tes encadrants »).
 *  - « Mon cahier du hand » (3 questions, aujourd'hui ou hier) et « Mon cahier de match » (le week-end) : fenêtres au fond
 *    flouté ; privés, partagés un par un avec l'encadrant (« Partager »), comme les notes du journal.
 *  - « Mes 3 vœux » : choisis dans le catalogue de l'installation, dans l'ordre.
 * JAMAIS de classement ni le chiffre d'un autre : seulement sa lampe. Aperçu d'un administrateur avec le serveur : une ligne,
 * aucune donnée lue. Clavier seulement : rien ne part vers une IA.
 * Monté dans l'onglet « Ma lampe » de src/pages/Me.tsx (relu chaque fois que l'onglet s'ouvre : `active`).
 */

// ---------- La lampe dessinée ----------

/** Lampe à huile : halo et flamme proportionnels au pourcentage (0 : une petite braise). Couleurs fixes, lisibles clair et sombre. */
export function LampSvg({ pct, size = 220, label }: { pct: number; size?: number; label?: string }) {
  const k = Math.max(0, Math.min(1, pct / 100))
  const glow = 0.18 + 0.82 * k
  const flame = 0.35 + 0.65 * k
  const r = 18 + 46 * k
  const id = useMemo(() => `l${Math.random().toString(36).slice(2, 8)}`, [])
  return (
    <svg viewBox="0 0 220 150" width={size} style={{ maxWidth: '100%', height: 'auto' }} role="img" aria-label={label ?? `Lampe allumée à ${pctText(pct)}`}>
      <defs>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.95" />
          <stop offset="45%" stopColor="#f59e0b" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-or`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fcd34d" />
          <stop offset="55%" stopColor="#d97706" />
          <stop offset="100%" stopColor="#92400e" />
        </linearGradient>
        <linearGradient id={`${id}-flamme`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="60%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#fef3c7" />
        </linearGradient>
      </defs>
      {/* Halo autour de la flamme, et lueur douce sur toute la lampe. */}
      <circle className="lamp-glow" cx="186" cy="52" r={r} fill={`url(#${id}-halo)`} style={{ ['--lamp-glow' as string]: glow, opacity: glow }} />
      <ellipse cx="110" cy="96" rx={70 + 30 * k} ry={34 + 10 * k} fill={`url(#${id}-halo)`} opacity={0.25 * k} />
      {/* Socle */}
      <ellipse cx="100" cy="134" rx="40" ry="7" fill="#92400e" opacity="0.9" />
      <path d="M78 132 C 84 122, 116 122, 122 132 Z" fill={`url(#${id}-or)`} />
      {/* Anse */}
      <path d="M50 96 C 22 96, 18 66, 40 66 C 52 66, 54 80, 52 86" fill="none" stroke={`url(#${id}-or)`} strokeWidth="7" strokeLinecap="round" />
      {/* Corps et bec */}
      <path
        d="M46 100 C 44 80, 80 70, 112 76 C 136 80, 156 84, 178 72 C 186 68, 190 72, 186 78 C 170 98, 146 116, 108 118 C 72 120, 48 114, 46 100 Z"
        fill={`url(#${id}-or)`}
        stroke="#78350f"
        strokeOpacity="0.5"
        strokeWidth="1.5"
      />
      <path d="M62 96 C 80 88, 120 88, 150 92" fill="none" stroke="#fef3c7" strokeOpacity={0.35 + 0.4 * k} strokeWidth="3" strokeLinecap="round" />
      {/* Couvercle */}
      <ellipse cx="92" cy="76" rx="26" ry="6" fill="#b45309" />
      <path d="M78 74 C 80 62, 104 62, 106 74 Z" fill={`url(#${id}-or)`} />
      <circle cx="92" cy="60" r="5" fill="#fcd34d" stroke="#78350f" strokeOpacity="0.5" />
      {/* Flamme au bout du bec */}
      <g transform={`translate(186 72) scale(${flame}) translate(-186 -72)`}>
        <path className={pct > 0 ? 'lamp-flame' : undefined} d="M186 72 C 174 62, 178 46, 187 30 C 196 46, 200 62, 188 72 Z" fill={`url(#${id}-flamme)`} opacity={pct > 0 ? 1 : 0.55} />
        {pct > 0 && <path className="lamp-flame" d="M187 70 C 182 64, 183 56, 187 48 C 191 56, 192 64, 188 70 Z" fill="#fffbeb" opacity="0.85" />}
      </g>
    </svg>
  )
}

// ---------- Section ----------

const shortDay = (day: string) => new Date(day + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const dayLabel = (day: string, today: string) => (day === today ? 'Aujourd’hui' : shortDay(day))

export function PlayerLamp({
  playerId,
  preview = false,
  canWrite: canWriteProp,
  onGo,
  active = true,
}: {
  playerId: string
  /** Onglet ouvert : relu chaque fois qu'il le redevient (le wellness ou la séance a pu être rempli dans un autre onglet). */
  active?: boolean
  /** Aperçu d'un administrateur (« Voir sa page ») : lecture seule avec le serveur. */
  preview?: boolean
  canWrite?: boolean
  /** Aller à l'onglet du wellness ou de la séance (« Aujourd'hui » de Ma page). */
  onGo?: (tab: 'aujourdhui') => void
}) {
  const role = useRole()
  const p = useLiveQuery(() => db.players.get(playerId), [playerId])
  // Son compte, l'essai ou une fiche de démonstration : ses données ; aperçu d'un administrateur avec le serveur : rien.
  const mine = isPlayerRole(role) || isLocalWellness(playerId)
  const canWrite = canWriteProp ?? ((isPlayerRole(role) || !supabase) && !(preview && !!supabase))
  const [data, setData] = useState<MyLamp | null>(null)
  const [err, setErr] = useState('')
  const [cahiers, setCahiers] = useState<JournalNote[]>([])
  const [open, setOpen] = useState<{ kind: CahierKind; day: string } | null>(null)
  const [wishOpen, setWishOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const [seq, setSeq] = useState(0)
  useEffect(() => {
    if (!mine || !active) return
    let live = true
    void Promise.all([fetchMyLamp(playerId), fetchMyCahiers(playerId)]).then(([r, c]) => {
      if (!live) return
      if (r.ok) setData(r.value)
      else (setData(null), setErr(r.missing ? '' : r.error))
      if (c.ok) setCahiers(c.value)
    })
    return () => {
      live = false
    }
  }, [playerId, mine, seq, active])

  const view: LampView | null = useMemo(() => {
    if (!data) return null
    const ctx = lampContext(p, data.today, { setting: data.settings.zone, fallback: TRIAL || !supabase ? DEMO_LAMP_ZONE : undefined })
    return lampView({ today: data.today, start: ctx.start, days: data.days, coach: data.coach, zone: ctx.zone, settings: data.settings })
  }, [data, p])

  if (!mine)
    return (
      <p className="card p-4 text-[11px] text-muted" data-testid="lampe-apercu">
        Ma lampe : si son groupe a la lampe, {p?.firstName ?? 'le jeune'} voit ici sa jauge de la saison (journées allumées, cahiers, vœux). Rien de ce qu’il écrit n’est lu dans cet aperçu.
      </p>
    )
  if (!data || !view) return err ? <p className="card p-4 text-[11px] text-muted">{err}</p> : <div className="py-10 text-center text-sm text-muted">Chargement…</div>
  if (!data.enabled || !data.requested)
    return (
      <p className="card p-4 text-sm text-muted" data-testid="lampe-pas-ouverte">
        {data.enabled ? 'Ta lampe s’allumera quand ton groupe l’aura activée : demande à ton encadrant.' : 'Ta lampe arrive bientôt : chaque jour rempli l’allumera un peu plus.'}
      </p>
    )

  const t = data.today
  const sex = p?.sex
  const cahierToday = cahiers.find((n) => n.kind === 'cahier' && n.day === t)
  const matchDays = writableDays('match', t)
  const weekendDay = matchDays.find((d) => dow(d) === 6 || dow(d) === 0)
  const reload = () => setSeq((n) => n + 1)
  const doneChip = (k: TaskKey) => !!(view.today.bits & TASK[k])

  return (
    <div className="flex flex-col gap-4" data-testid="ma-lampe">
      <section className="card flex flex-col items-center gap-3 overflow-hidden p-4 text-center">
        <SectionTitle
          className="self-stretch"
          info={
            <>
              Chaque jour de classe (lundi → vendredi, hors vacances), ta journée s’allume quand tu as fait ton wellness du matin, noté ta séance et rempli ton cahier du hand. Chaque trimestre compte pour 30 % : plus tu allumes de journées, plus ta lampe brille. Le week-end, ton cahier de match après une semaine complète t’apporte 1 % de bonus. Tes encadrants peuvent ajouter jusqu’à 10 %. Ta lampe est à toi : personne d’autre ne voit ton pourcentage, et il n’y a pas de classement.
            </>
          }
        >
          Ma lampe d’Aladin
        </SectionTitle>
        <LampSvg pct={view.pct} />
        <div>
          <div className="text-4xl font-extrabold tabular-nums" data-testid="lampe-pct">
            {pctText(view.pct)}
          </div>
          <div className="mt-0.5 text-xs text-muted">{view.maxPct >= 100 ? 'Elle peut encore atteindre 100 % : continue comme ça !' : `Elle peut encore monter jusqu’à ${pctText(view.maxPct)}.`}</div>
        </div>

        {/* Aujourd'hui */}
        <div className="w-full rounded-xl border border-line bg-panel-2 p-3 text-left" data-testid="lampe-aujourdhui">
          <p className="text-sm font-bold">{todayLine(view)}</p>
          {view.today.requested && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Tâches du jour">
              {(['wellness', 'seance', 'cahier'] as const).map((k) => (
                <li key={k} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${doneChip(k) ? 'border-amber-500/60 bg-amber-500/15 text-fg' : 'border-line text-muted'}`}>
                  {doneChip(k) ? '✓ ' : ''}
                  {k === 'wellness' ? 'Wellness' : k === 'seance' ? 'Séance' : 'Cahier du hand'}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <div className="mt-2 flex flex-wrap gap-2">
              {(view.today.requested || cahierToday) && (
                <button className={`${doneChip('cahier') ? 'btn-soft' : 'btn-primary'} min-h-11 px-4 text-sm`} onClick={() => (setMsg(''), setOpen({ kind: 'cahier', day: t }))}>
                  {cahierToday ? 'Mon cahier du hand' : 'Remplir mon cahier du hand'}
                </button>
              )}
              {!view.today.requested && !cahierToday && (
                <button className="btn-ghost min-h-11 px-4 text-sm" onClick={() => (setMsg(''), setOpen({ kind: 'cahier', day: t }))}>
                  Écrire un cahier du hand
                </button>
              )}
              {(view.today.missing.includes('wellness') || view.today.missing.includes('seance')) && onGo && (
                <button className="btn-soft min-h-11 px-4 text-sm" onClick={() => onGo('aujourdhui')}>
                  {view.today.missing.includes('wellness') ? 'Mon wellness' : 'Ma séance'} ›
                </button>
              )}
              {weekendDay && (
                <button className={`${view.weekend?.eligible && !view.weekend.matchDone ? 'btn-primary' : 'btn-soft'} min-h-11 px-4 text-sm`} onClick={() => (setMsg(''), setOpen({ kind: 'match', day: weekendDay }))}>
                  Mon cahier de match
                </button>
              )}
            </div>
          )}
          {view.today.missing.length > 0 && !onGo && (view.today.missing.includes('wellness') || view.today.missing.includes('seance')) && (
            <p className="mt-1.5 text-[11px] text-muted">Le wellness et la séance se remplissent dans l’onglet « Aujourd’hui ».</p>
          )}
          {msg && (
            <p role="status" className="mt-1.5 text-[11px] text-emerald-300">
              {msg}
            </p>
          )}
        </div>

        {/* Ce qui est déjà gagné : toujours en positif. */}
        <div className="flex w-full flex-col gap-1 text-left text-xs">
          {view.streak >= 2 && (
            <p data-testid="lampe-serie">
              🔥 <b>{view.streak}</b> journées allumées d’affilée{view.bestStreak > view.streak ? ` (ta meilleure série : ${view.bestStreak})` : ''}
            </p>
          )}
          {view.streak < 2 && view.bestStreak >= 2 && <p>✨ Ta meilleure série : <b>{view.bestStreak}</b> journées. Chaque journée allumée relance la flamme.</p>}
          {view.litDays > 0 && (
            <p className="text-muted">
              {view.litDays} journée{view.litDays > 1 ? 's' : ''} allumée{view.litDays > 1 ? 's' : ''} depuis le {shortDay(view.start)}.
            </p>
          )}
          {view.bonus.weeks.length > 0 && (
            <p data-testid="lampe-bonus">
              🏟️ <b>+ {pctText(view.bonus.pct)}</b> de bonus du week-end ({view.bonus.weeks.length} cahier{view.bonus.weeks.length > 1 ? 's' : ''} de match après une semaine complète)
            </p>
          )}
          {view.coach > 0 && (
            <p data-testid="lampe-encadrants">
              💛 <b>+ {pctText(view.coach)}</b> de tes encadrants
            </p>
          )}
        </div>

        {/* Trimestres */}
        <div className="flex w-full flex-col gap-2 text-left" data-testid="lampe-trimestres">
          {view.trimesters.map((tr) => (
            <div key={tr.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="font-bold">
                  {tr.label} <span className="font-normal text-muted">· {tr.short}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted">{tr.neutral ? '—' : `${pctText(tr.share)} / ${pctText(tr.weight)}`}</span>
              </div>
              {tr.neutral ? (
                <p className="text-[10px] text-muted">{accord('Arrivé', sex)} après : ce trimestre compte pour les autres.</p>
              ) : (
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-panel-2" role="meter" aria-valuemin={0} aria-valuemax={tr.weight} aria-valuenow={Math.round(tr.share * 10) / 10} aria-label={tr.label}>
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-300" style={{ width: `${tr.weight ? (100 * tr.share) / tr.weight : 0}%` }} />
                </div>
              )}
              {!tr.neutral && (tr.current || tr.done > 0) && (
                <p className="mt-0.5 text-[10px] text-muted">
                  {tr.done} journée{tr.done > 1 ? 's' : ''} allumée{tr.done > 1 ? 's' : ''} sur {tr.requested} demandée{tr.requested > 1 ? 's' : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <CahiersList notes={cahiers} today={t} canWrite={canWrite} playerId={playerId} onOpen={(kind, day) => (setMsg(''), setOpen({ kind, day }))} onChange={setCahiers} />

      <WishesCard catalogue={data.settings.catalogue} wishes={data.wishes} canWrite={canWrite} onEdit={() => setWishOpen(true)} />

      {open && (
        <CahierWindow
          playerId={playerId}
          kind={open.kind}
          day={open.day}
          today={t}
          notes={cahiers}
          onClose={() => setOpen(null)}
          onSaved={(text) => {
            setOpen(null)
            setMsg(text)
            reload()
          }}
        />
      )}
      {wishOpen && (
        <WishesWindow
          catalogue={data.settings.catalogue}
          initial={data.wishes}
          onClose={() => setWishOpen(false)}
          onSave={async (ids) => {
            const r = await saveMyWishes(playerId, ids, data.settings)
            if (!r.ok) return r.error
            setData({ ...data, wishes: r.value })
            setWishOpen(false)
            return ''
          }}
        />
      )}
    </div>
  )
}

// ---------- Mes cahiers ----------

function CahiersList({
  notes,
  today,
  canWrite,
  playerId,
  onOpen,
  onChange,
}: {
  notes: JournalNote[]
  today: string
  canWrite: boolean
  playerId: string
  onOpen: (kind: CahierKind, day: string) => void
  onChange: (notes: JournalNote[]) => void
}) {
  const [more, setMore] = useState(false)
  const [err, setErr] = useState('')
  if (!notes.length) return null
  const shown = more ? notes : notes.slice(0, 5)
  return (
    <section className="card flex flex-col gap-2 p-4" data-testid="mes-cahiers">
      <SectionTitle info="Tes cahiers sont à toi : ton encadrant ne lit que ceux que tu partages. Tu peux reprendre le cahier du hand d’aujourd’hui ou d’hier, et le cahier de match jusqu’à 3 jours après.">Mes cahiers</SectionTitle>
      <ul className="flex flex-col divide-y divide-line">
        {shown.map((n) => {
          const kind = n.kind!
          const editable = canWrite && !!n.day && writableDays(kind, today).includes(n.day)
          const parts = n.parts ?? {}
          const first = kind === 'cahier' ? (parts.travail as string | undefined) : MATCH_FEELINGS.find((f) => f.id === parts.sensation)?.label
          return (
            <li key={n.id} className="flex min-w-0 items-center gap-2 py-2">
              <span aria-hidden className="text-lg">
                {kind === 'cahier' ? '📒' : '🏟️'}
              </span>
              <button type="button" className="min-w-0 flex-1 text-left" disabled={!editable} onClick={() => editable && onOpen(kind, n.day!)}>
                <span className="block text-xs font-bold">
                  {kind === 'cahier' ? 'Cahier du hand' : `Cahier de match${parts.adversaire ? ` · ${parts.adversaire}` : ''}`} <span className="font-normal text-muted">· {dayLabel(n.day ?? n.at.slice(0, 10), today)}</span>
                </span>
                {first && <span className="block truncate text-[11px] text-muted">{first}</span>}
              </button>
              {canWrite && (
                <button
                  type="button"
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold ${n.shared ? 'border-emerald-500/50 text-emerald-300' : 'border-line text-muted'}`}
                  aria-pressed={!!n.shared}
                  onClick={async () => {
                    setErr('')
                    const r = await shareNote(playerId, notes, n.id, !n.shared)
                    if (r.ok) onChange(r.value.filter((x) => x.kind))
                    else setErr(r.error)
                  }}
                >
                  {n.shared ? 'Partagé' : 'Partager'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {notes.length > 5 && (
        <button className="btn-ghost min-h-9 self-start px-3 text-xs" onClick={() => setMore(!more)}>
          {more ? 'Moins' : `Voir les ${notes.length} cahiers`}
        </button>
      )}
      {err && <p className="text-[11px] text-red-300">{err}</p>}
    </section>
  )
}

// ---------- Fenêtre d'un cahier ----------

function CahierWindow({
  playerId,
  kind,
  day: day0,
  today,
  notes,
  onClose,
  onSaved,
}: {
  playerId: string
  kind: CahierKind
  day: string
  today: string
  notes: JournalNote[]
  onClose: () => void
  onSaved: (msg: string) => void
}) {
  const days = writableDays(kind, today)
  const [day, setDay] = useState(day0)
  const existing = (d: string) => notes.find((n) => n.kind === kind && n.day === d)?.parts ?? {}
  const [c, setC] = useState<CahierParts>(() => cleanCahier(existing(day0)))
  const [m, setM] = useState<Record<string, string>>(() => matchDraft(cleanMatch(existing(day0))))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pickDay = (d: string) => {
    setDay(d)
    if (kind === 'cahier') setC(cleanCahier(existing(d)))
    else setM(matchDraft(cleanMatch(existing(d))))
  }
  const parts: CahierParts | MatchParts = kind === 'cahier' ? cleanCahier(c) : cleanMatch(matchParts(m))
  const total = kind === 'match' ? playTime(parts as MatchParts) : undefined
  const autoResult = kind === 'match' ? resultOf((parts as MatchParts).nous, (parts as MatchParts).eux) : undefined

  async function save() {
    setBusy(true)
    setErr('')
    const r = await saveCahier(playerId, kind, day, parts)
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    onSaved(r.value ? 'Enregistré. Il reste à toi : partage-le si tu veux que ton encadrant le lise.' : 'Cahier retiré.')
  }

  return (
    <FormWindow title={kind === 'cahier' ? 'Mon cahier du hand' : 'Mon cahier de match'} onClose={onClose} width={560}>
      <div className="flex flex-col gap-3" data-testid={kind === 'cahier' ? 'fenetre-cahier' : 'fenetre-match'}>
        <div role="radiogroup" aria-label="Jour" className="flex flex-wrap gap-1.5">
          {days.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={day === d} className={pillClass(day === d)} onClick={() => pickDay(d)}>
              {d === today ? 'Aujourd’hui' : new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
            </button>
          ))}
        </div>
        {kind === 'cahier' ? (
          CAHIER_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="label">{f.label}</span>
              <textarea className="field min-h-11 w-full resize-y" rows={2} maxLength={CAHIER_TEXT_MAX} placeholder={f.hint} value={c[f.key] ?? ''} onChange={(e) => setC({ ...c, [f.key]: e.target.value })} />
            </label>
          ))
        ) : (
          <>
            <label className="block">
              <span className="label">Contre (facultatif)</span>
              <input className="field min-h-11 w-full" maxLength={OPPONENT_MAX} value={m.adversaire ?? ''} onChange={(e) => setM({ ...m, adversaire: e.target.value })} />
            </label>
            <div>
              <span className="label">Résultat</span>
              <div className="flex flex-wrap items-center gap-2">
                <input className="field min-h-11 w-16 text-center" inputMode="numeric" aria-label="Score de mon équipe" placeholder="Nous" value={m.nous ?? ''} onChange={(e) => setM({ ...m, nous: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                <span className="text-muted">–</span>
                <input className="field min-h-11 w-16 text-center" inputMode="numeric" aria-label="Score de l’adversaire" placeholder="Eux" value={m.eux ?? ''} onChange={(e) => setM({ ...m, eux: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                <div role="radiogroup" aria-label="Résultat" className="flex flex-wrap gap-1.5">
                  {MATCH_RESULTS.map((r) => {
                    const on = (autoResult ?? (m.resultat as MatchResult | undefined)) === r.id
                    return (
                      <button key={r.id} type="button" role="radio" aria-checked={on} disabled={!!autoResult} className={pillClass(on, true)} onClick={() => setM({ ...m, resultat: m.resultat === r.id ? '' : r.id })}>
                        {r.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <p className="mt-0.5 text-[10px] text-muted">Score jusqu’à {MATCH_SCORE_MAX} ; avec le score, le résultat se met tout seul.</p>
            </div>
            <div>
              <span className="label">Sensation globale</span>
              <div role="radiogroup" aria-label="Sensation globale" className="grid grid-cols-3 gap-1.5">
                {MATCH_FEELINGS.map((f) => (
                  <button key={f.id} type="button" role="radio" aria-checked={m.sensation === f.id} className={`${pillClass(m.sensation === f.id)} min-h-11`} onClick={() => setM({ ...m, sensation: m.sensation === f.id ? '' : (f.id as MatchFeeling) })}>
                    <span aria-hidden>{f.emoji}</span> {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label">Temps de jeu (minutes)</span>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1">
                  1re mi-temps
                  <input className="field min-h-11 w-16 text-center" inputMode="numeric" value={m.mt1 ?? ''} onChange={(e) => setM({ ...m, mt1: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                </label>
                <label className="flex items-center gap-1">
                  2e
                  <input className="field min-h-11 w-16 text-center" inputMode="numeric" value={m.mt2 ?? ''} onChange={(e) => setM({ ...m, mt2: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
                </label>
                <span className="text-muted" data-testid="temps-cumule">
                  Cumulé : <b className="text-fg">{total ?? 0} min</b>
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted">{MATCH_HALF_MAX} minutes au plus par mi-temps.</p>
            </div>
            {MATCH_TEXTS.map((f) => (
              <label key={f.key} className="block">
                <span className="label">{f.label}</span>
                <textarea className="field min-h-11 w-full resize-y" rows={2} maxLength={MATCH_TEXT_MAX} value={m[f.key] ?? ''} onChange={(e) => setM({ ...m, [f.key]: e.target.value })} />
              </label>
            ))}
            {dow(day) !== 6 && dow(day) !== 0 && <p className="text-[11px] text-muted">Le bonus de la lampe compte pour un match du samedi ou du dimanche.</p>}
          </>
        )}
        <p className="text-[10px] text-muted">Privé : ton encadrant ne le lit que si tu le partages. Tout vider puis enregistrer retire le cahier.</p>
        {err && <p className="text-[11px] text-red-300">{err}</p>}
      </div>
      <FormActions>
        <button className="btn-primary min-h-11 px-5" disabled={busy} onClick={() => void save()}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button className="btn-ghost min-h-11 px-4" onClick={onClose}>
          Annuler
        </button>
      </FormActions>
    </FormWindow>
  )
}

/** Brouillon du cahier de match : tout en texte (les nombres restent saisissables). */
function matchDraft(p: MatchParts): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(p)) if (v !== undefined) out[k] = String(v)
  return out
}
function matchParts(d: Record<string, string>): Record<string, unknown> {
  const n = (s?: string) => (s && /^\d+$/.test(s) ? Number(s) : undefined)
  return { ...d, nous: n(d.nous), eux: n(d.eux), mt1: n(d.mt1), mt2: n(d.mt2), resultat: d.resultat || undefined, sensation: d.sensation || undefined }
}

// ---------- Mes 3 vœux ----------

function WishesCard({ catalogue, wishes, canWrite, onEdit }: { catalogue: LampWish[]; wishes: string[]; canWrite: boolean; onEdit: () => void }) {
  if (!catalogue.length) return null
  const chosen = wishes.map((id) => catalogue.find((w) => w.id === id)).filter((w): w is LampWish => !!w)
  return (
    <section className="card flex flex-col gap-2 p-4" data-testid="mes-voeux">
      <SectionTitle info="À la fin de la saison, une lampe à 100 % gagne un lot, et une belle lampe peut aussi être récompensée. Choisis jusqu’à 3 vœux, du plus au moins important : ils aident ton encadrant à choisir. Les lots peuvent porter la marque de celui qui les offre ; aucune publicité ne t’est adressée et aucune donnée n’est partagée.">
        Mes 3 vœux
      </SectionTitle>
      {chosen.length ? (
        <ol className="flex flex-col gap-1.5">
          {chosen.map((w, i) => (
            <li key={w.id} className="flex min-w-0 items-start gap-2 text-sm">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-500/20 text-xs font-extrabold">{i + 1}</span>
              <span className="min-w-0">
                {w.label}
                {w.by && <span className="block text-[10px] text-muted">offert par {w.by}</span>}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted">Pas encore de vœu : que voudrais-tu gagner ?</p>
      )}
      {canWrite && (
        <button className="btn-soft min-h-11 self-start px-4 text-sm" onClick={onEdit}>
          {chosen.length ? 'Changer mes vœux' : 'Choisir mes vœux'}
        </button>
      )}
    </section>
  )
}

function WishesWindow({ catalogue, initial, onClose, onSave }: { catalogue: LampWish[]; initial: string[]; onClose: () => void; onSave: (ids: string[]) => Promise<string> }) {
  const [ids, setIds] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toggle = (id: string) => setIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : xs.length < WISHES_MAX ? [...xs, id] : xs))
  const move = (i: number, d: -1 | 1) =>
    setIds((xs) => {
      const j = i + d
      if (j < 0 || j >= xs.length) return xs
      const next = [...xs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  return (
    <FormWindow title="Mes 3 vœux" onClose={onClose} width={520}>
      <div className="flex flex-col gap-3" data-testid="fenetre-voeux">
        <p className="text-xs text-muted">Touche jusqu’à {WISHES_MAX} vœux ; l’ordre compte (le 1er est celui qui te ferait le plus plaisir).</p>
        {ids.length > 0 && (
          <ol className="flex flex-col gap-1">
            {ids.map((id, i) => (
              <li key={id} className="flex min-w-0 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-sm">
                <span className="w-5 shrink-0 text-center text-xs font-extrabold">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{catalogue.find((w) => w.id === id)?.label}</span>
                <button type="button" className="btn-ghost min-h-9 min-w-9 px-2" aria-label="Monter" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn-ghost min-h-9 min-w-9 px-2" aria-label="Descendre" disabled={i === ids.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
              </li>
            ))}
          </ol>
        )}
        <ul className="flex flex-col gap-1.5">
          {catalogue.map((w) => {
            const on = ids.includes(w.id)
            return (
              <li key={w.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={!on && ids.length >= WISHES_MAX}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-40 ${on ? 'border-amber-500/60 bg-amber-500/15' : 'border-line bg-panel-2'}`}
                  onClick={() => toggle(w.id)}
                >
                  <span aria-hidden>{on ? '★' : '☆'}</span>
                  <span className="min-w-0 flex-1">
                    {w.label}
                    {w.by && <span className="block text-[10px] text-muted">offert par {w.by}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        {err && <p className="text-[11px] text-red-300">{err}</p>}
      </div>
      <FormActions>
        <button
          className="btn-primary min-h-11 px-5"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const e = await onSave(ids)
            setBusy(false)
            setErr(e)
          }}
        >
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button className="btn-ghost min-h-11 px-4" onClick={onClose}>
          Annuler
        </button>
      </FormActions>
    </FormWindow>
  )
}
