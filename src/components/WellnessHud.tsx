import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { today } from '../db'
import { isPlayerRole, useRole } from '../roles'
import {
  addDays,
  isTopLevel,
  isWeekday,
  LEVEL_INVITE,
  LEVEL_WORDS,
  levelWord,
  RPE_QUESTION,
  rpeLevel,
  sessionLoad,
  SESSIONS_PER_DAY,
  SESSION_MINUTES_MAX,
  WELLNESS_ITEMS,
  type LevelWord,
  type WellnessEntry,
  type WellnessKey,
  type WellnessSession,
} from '../wellness'
import { fetchMyWellness, isLocalWellness, removeMySession, saveMySession, saveMyWellness, type MyWellness } from '../wellnessApi'
import { ask } from './Confirm'
import { draftComplete, draftToPain, fromEntry, PainLines, PainPicker, type Form } from './Wellness'

/*
 * Wellness du jeune en « tableau de bord de jeu » (maquette du 09/11, thème NEXTAR, bloc .hud de src/index.css), pour l'onglet
 * Aujourd'hui en HUD (src/components/TodayHud.tsx). COUPÉ depuis le 10/11 (Geoffroy : « ça va pas dans le thème… revenir à
 * l'apparence d'avant », « garde-le au cas où ») : utilisé seulement quand TODAY_HUD vaut true (src/components/TodayHud.tsx).
 * L'écran normal est la carte « Mon wellness du jour » de src/components/Wellness.tsx (MyWellnessCard).
 *  - HudMorningForm : chaque note de 1 à 10 en jauge à toucher (HudGauge : question fun, gros émoji et mot positif de la
 *    tranche, 10 segments obliques) ; « Une douleur quelque part ? » « Nan, frais » / « Oui, là », et si oui la même saisie
 *    des endroits que la carte (PainPicker). « Envoyer » ; modifiable toute la journée. Résumé : HudWellnessSummary.
 *  - HudSessionForm : intensité ressentie 1 à 10 en jauge ET durée, obligatoire ; aujourd'hui ou hier ; plusieurs par jour
 *    (HudRecentSessions). « Mes 14 derniers jours » : History de src/components/Wellness.tsx.
 *  - useMyWellness : les données du jeune (aperçu d'un administrateur avec le serveur : rien n'est lu).
 * Mêmes envois que la carte (saveMyWellness, saveMySession, removeMySession) : seule l'interface change.
 */

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

/**
 * Saisie de la forme, dans le bloc .hud de l'onglet Aujourd'hui : une jauge par note, « Une douleur quelque part ? » (« Nan,
 * frais » / « Oui, là », qui ouvre la saisie des endroits, types et intensités), « Envoyer ». Même envoi qu'avant
 * (saveMyWellness → hb_wellness_enregistrer) ; un wellness déjà envoyé se reprend tel quel (Modifier).
 */
export function HudMorningForm({ initial, onSaved, onCancel, playerId }: { initial: WellnessEntry | null; onSaved: (e: WellnessEntry) => void; onCancel?: () => void; playerId: string }) {
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
export function HudWellnessSummary({ entry }: { entry: WellnessEntry }) {
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
export function HudSessionForm({ playerId, sessions, edit, onDone }: { playerId: string; sessions: WellnessSession[]; edit: WellnessSession | null; onDone: (changed: boolean) => void }) {
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
export function HudRecentSessions({ sessions, canWrite, playerId, onEdit, onChanged }: { sessions: WellnessSession[]; canWrite: boolean; playerId: string; onEdit: (s: WellnessSession) => void; onChanged: (msg?: string) => void }) {
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
