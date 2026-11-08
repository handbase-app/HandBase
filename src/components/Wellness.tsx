import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db, today, TRIAL, type Player, type PlayerGroup } from '../db'
import { w } from '../gender'
import { can, currentUserId, isParticipant, isPlayerRole, useRole, type Role } from '../roles'
import { supabase } from '../sync'
import {
  addDays,
  BODY_ZONES,
  fmt1,
  isWeekday,
  myHistory,
  painWord,
  PAIN_TEXT_MAX,
  rpeWord,
  scaleWord,
  sessionLoad,
  SESSIONS_PER_DAY,
  SESSION_MINUTES_MAX,
  wellnessEnabledOf,
  WELLNESS_ITEMS,
  zoneLabel,
  type BodySide,
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
 *    gros boutons (1 à 10, deux rangées de 5), mots positifs ; « Douleurs, gênes » oui / non, et si oui : points sur une
 *    silhouette face / dos ou texte libre, intensité 1 à 10. Modifiable toute la journée.
 *  - Une fois rempli (ou le week-end) : une ligne repliée, « Modifier », « Ma séance » (intensité ressentie 1 à 10, durée
 *    facultative ; aujourd'hui ou hier ; plusieurs par jour) et « Mes 14 derniers jours » (comparés à SA moyenne, ton positif).
 * Demandé seulement si le réglage de l'installation est ouvert, le compte relié et la fiche dans un groupe activé ; sinon rien
 * ne s'affiche. Aperçu d'un administrateur avec le serveur : une ligne d'explication, aucune donnée lue. Clavier seulement :
 * rien ne part vers une IA.
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

// ---------- Petits morceaux ----------

/** Échelle 1 à 10 : deux rangées de 5 gros boutons ; le mot de la valeur choisie à côté du titre. */
function Scale({ label, hint, value, onChange, word, disabled }: { label: string; hint?: string; value?: number; onChange: (v: number | undefined) => void; word: (v?: number) => string | null; disabled?: boolean }) {
  const shown = word(value)
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="flex w-full flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm font-bold">{label}</span>
        <span className="text-xs text-muted" aria-live="polite">
          {shown ? (
            <>
              {shown} · <b className="text-fg">{value}</b>/10
            </>
          ) : (
            hint
          )}
        </span>
      </legend>
      <div className="mt-1.5 grid grid-cols-5 gap-1.5" role="radiogroup" aria-label={label}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => {
          const on = value === v
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              className={`min-h-11 rounded-lg border text-sm font-bold tabular-nums ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2 text-fg'}`}
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

/** Silhouette simple (repère 100 × 220) : tête, buste, bras, jambes. */
function Silhouette() {
  return (
    <g className="fill-panel-2 stroke-line" strokeWidth={1.5}>
      <circle cx={50} cy={14} r={11} />
      <rect x={45} y={24} width={10} height={9} rx={3} />
      <path d="M30 36 Q50 31 70 36 L66 92 Q50 96 34 92 Z" />
      <path d="M30 37 L19 62 L13 98 L19 99 L27 66 L34 46 Z" />
      <path d="M70 37 L81 62 L87 98 L81 99 L73 66 L66 46 Z" />
      <path d="M34 90 Q50 96 66 90 L64 150 L60 208 L52 208 L50 112 L48 208 L40 208 L36 150 Z" />
    </g>
  )
}

/** Points d'une silhouette (face ou dos) : toucher un point l'ajoute ou le retire. */
function BodySideView({ side, zones, onToggle }: { side: BodySide; zones: readonly string[]; onToggle: (id: string) => void }) {
  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center">
      <figcaption className="text-[11px] font-bold text-muted">{side === 'face' ? 'De face' : 'De dos'}</figcaption>
      <svg viewBox="0 0 100 220" className="h-auto w-full max-w-[150px]" role="group" aria-label={side === 'face' ? 'Silhouette de face' : 'Silhouette de dos'}>
        <Silhouette />
        {side === 'face' && (
          <>
            <text x={6} y={216} className="fill-muted text-[8px]">
              droite
            </text>
            <text x={94} y={216} textAnchor="end" className="fill-muted text-[8px]">
              gauche
            </text>
          </>
        )}
        {side === 'dos' && (
          <>
            <text x={6} y={216} className="fill-muted text-[8px]">
              gauche
            </text>
            <text x={94} y={216} textAnchor="end" className="fill-muted text-[8px]">
              droite
            </text>
          </>
        )}
        {BODY_ZONES.filter((z) => z.side === side).map((z) => {
          const on = zones.includes(z.id)
          return (
            <g
              key={z.id}
              role="checkbox"
              aria-checked={on}
              aria-label={z.label}
              tabIndex={0}
              className="cursor-pointer outline-none [&:focus-visible>circle:last-child]:stroke-accent"
              onClick={() => onToggle(z.id)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle(z.id))}
            >
              <title>{z.label}</title>
              {/* Zone de toucher plus large que le point. */}
              <circle cx={z.x} cy={z.y} r={9} fill="transparent" />
              <circle cx={z.x} cy={z.y} r={on ? 6 : 4} className={on ? 'fill-accent stroke-accent' : 'fill-panel stroke-muted'} strokeWidth={1.5} />
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

/** Où ? Silhouettes face et dos côte à côte, zones choisies en pastilles (✕ pour retirer). */
function BodyPicker({ zones, onChange }: { zones: string[]; onChange: (z: string[]) => void }) {
  const toggle = (id: string) => onChange(zones.includes(id) ? zones.filter((x) => x !== id) : [...zones, id].slice(0, 12))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-center gap-3">
        <BodySideView side="face" zones={zones} onToggle={toggle} />
        <BodySideView side="dos" zones={zones} onToggle={toggle} />
      </div>
      {zones.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {zones.map((id) => (
            <button key={id} type="button" className="min-h-9 rounded-full border border-accent/50 bg-accent/10 px-3 text-xs" onClick={() => toggle(id)} aria-label={`Retirer ${zoneLabel(id)}`}>
              {zoneLabel(id)} <span aria-hidden>✕</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Questionnaire du matin ----------

interface Form {
  scores: Scores
  pain: boolean | null
  zones: string[]
  painText: string
  painLevel?: number
}
const fromEntry = (e: WellnessEntry | null | undefined): Form => ({
  scores: { ...(e?.scores ?? {}) },
  pain: e ? e.pain : null,
  zones: [...(e?.zones ?? [])],
  painText: e?.painText ?? '',
  painLevel: e?.painLevel,
})

function MorningForm({ initial, onSaved, onCancel, playerId }: { initial: WellnessEntry | null; onSaved: (e: WellnessEntry) => void; onCancel?: () => void; playerId: string }) {
  const [f, setF] = useState<Form>(() => fromEntry(initial))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const answered = Object.keys(f.scores).length > 0 || f.pain === true
  const setScore = (k: WellnessKey, v: number | undefined) => setF((x) => {
    const scores = { ...x.scores }
    if (v === undefined) delete scores[k]
    else scores[k] = v
    return { ...x, scores }
  })
  async function submit() {
    if (busy || !answered) return
    setBusy(true)
    setErr('')
    const r = await saveMyWellness(playerId, {
      scores: f.scores,
      pain: f.pain === true,
      ...(f.pain ? { zones: f.zones, painText: f.painText, ...(f.painLevel ? { painLevel: f.painLevel } : {}) } : {}),
    })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    onSaved(r.value)
  }
  return (
    <div className="flex flex-col gap-4">
      {WELLNESS_ITEMS.map((it) => (
        <Scale key={it.key} label={it.label} hint={it.hint} value={f.scores[it.key]} onChange={(v) => setScore(it.key, v)} word={scoreWord} />
      ))}
      <fieldset className="min-w-0">
        <legend className="text-sm font-bold">Douleurs, gênes</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Douleurs, gênes">
          {([false, true] as const).map((v) => (
            <button
              key={String(v)}
              type="button"
              role="radio"
              aria-checked={f.pain === v}
              className={`min-h-11 rounded-lg border text-sm font-bold ${f.pain === v ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2'}`}
              onClick={() => setF((x) => ({ ...x, pain: v }))}
            >
              {v ? 'Oui' : 'Non'}
            </button>
          ))}
        </div>
      </fieldset>
      {f.pain && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel-2/50 p-3" data-testid="douleur">
          <div>
            <div className="text-sm font-bold">Où ?</div>
            <p className="text-[11px] text-muted">Touche un ou plusieurs points, ou écris-le (facultatif).</p>
          </div>
          <BodyPicker zones={f.zones} onChange={(zones) => setF((x) => ({ ...x, zones }))} />
          <input
            className="field min-h-11 w-full"
            placeholder="Ou écris où (ex. « mollet droit, en courant »)"
            maxLength={PAIN_TEXT_MAX}
            value={f.painText}
            onChange={(e) => setF((x) => ({ ...x, painText: e.target.value }))}
            aria-label="Où as-tu mal ? (texte)"
          />
          <Scale label="Intensité de la douleur" hint="facultatif" value={f.painLevel} onChange={(v) => setF((x) => ({ ...x, painLevel: v }))} word={(v) => painWord(v)} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary min-h-11 px-5" disabled={busy || !answered} onClick={() => void submit()}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {onCancel && (
          <button className="btn-ghost min-h-11 px-4 text-sm" onClick={onCancel}>
            Annuler
          </button>
        )}
        {!answered && <span className="text-[11px] text-muted">Réponds à ce que tu veux, puis enregistre.</span>}
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
  const [minutes, setMinutes] = useState(edit?.minutes ? String(edit.minutes) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const mins = minutes.trim() ? Number(minutes) : undefined
  const minsOk = mins === undefined || (Number.isInteger(mins) && mins >= 1 && mins <= SESSION_MINUTES_MAX)
  const full = !edit && sessions.filter((s) => s.day === day).length >= SESSIONS_PER_DAY
  async function submit() {
    if (busy || !rpe || !minsOk || full) return
    setBusy(true)
    setErr('')
    const r = await saveMySession(playerId, { id: edit?.id, day, rpe, minutes: mins ?? null })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    onDone(true)
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel-2/50 p-3" data-testid="ma-seance">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Jour de la séance">
        {[t, addDays(t, -1)].map((d, i) => (
          <button key={d} type="button" role="radio" aria-checked={day === d} className={`min-h-11 rounded-lg border text-sm font-bold ${day === d ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel'}`} onClick={() => setDay(d)}>
            {i === 0 ? 'Aujourd’hui' : 'Hier'}
          </button>
        ))}
      </div>
      <Scale label="Intensité ressentie" hint="1 très facile → 10 maximale" value={rpe} onChange={setRpe} word={(v) => rpeWord(v)} />
      <div>
        <span className="text-sm font-bold">Durée</span> <span className="text-[11px] text-muted">(facultatif, en minutes)</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input className="field min-h-11 w-24 text-center" inputMode="numeric" maxLength={3} placeholder="min" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} aria-label="Durée en minutes" />
          {[60, 90, 120].map((m) => (
            <button key={m} type="button" className={`min-h-11 rounded-full border px-3 text-xs font-bold ${mins === m ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel'}`} onClick={() => setMinutes(String(m))}>
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
        {!minsOk && <span className="text-[11px] text-red-300">Durée : de 1 à {SESSION_MINUTES_MAX} minutes.</span>}
        {full && <span className="text-[11px] text-muted">{SESSIONS_PER_DAY} séances ce jour-là : c’est le maximum.</span>}
        {err && <span className="text-[11px] text-red-300">{err}</span>}
      </div>
    </div>
  )
}

/** « Séance du soir · intensité 7 (Difficile) · 90 min ». */
const sessionLine = (s: WellnessSession) => [`Intensité ${s.rpe}/10 (${rpeWord(s.rpe)})`, s.minutes ? `${s.minutes} min` : null, sessionLoad(s) !== null ? `charge ${sessionLoad(s)}` : null].filter(Boolean).join(' · ')

// ---------- 14 derniers jours ----------

function History({ entries }: { entries: WellnessEntry[] }) {
  const h = useMemo(() => myHistory(entries, today()), [entries])
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
              {h.days.map((e) => (
                <tr key={e.day} className="border-t border-line">
                  <td className="truncate py-1.5 text-left">{shortDay(e.day)}</td>
                  {WELLNESS_ITEMS.map((it) => (
                    <td key={it.key} className="py-1.5">
                      {e.scores[it.key] ?? '—'}
                    </td>
                  ))}
                  <td className="py-1.5">{e.pain ? '•' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

// ---------- La carte de la page du jeune ----------

export function MyWellnessCard({ player: p, canWrite }: { player: Player; canWrite: boolean }) {
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
                {entry.pain && <span className="text-muted"> · gêne signalée</span>}
              </>
            ) : weekday ? (
              'Pas encore rempli aujourd’hui.'
            ) : (
              'C’est le week-end : pas de questionnaire, profite bien.'
            )}
          </p>
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
