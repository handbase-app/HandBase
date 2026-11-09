import { useEffect, useState } from 'react'
import { fmtDate, type HBEvent, type Player } from '../db'
import { w } from '../gender'
import { isPlayerRole, useRole } from '../roles'
import {
  avisAndSelf,
  cleanSelfEval,
  selfEvalChips,
  selfEvalTypeLabel,
  SELF_EVAL_CRITERIA,
  SELF_EVAL_DAYS,
  SELF_EVAL_LEVELS,
  SELF_EVAL_TEXT_MAX,
  type SelfEval,
  type SelfEvalEvent,
} from '../selfEval'
import { fetchMyEvents, fetchPlayerSelfEvals, fetchPreviewEvents, saveMySelfEval } from '../selfEvalApi'
import { supabase } from '../sync'
import { ask } from './Confirm'
import { FormActions, FormWindow } from './FormWindow'
import { Icon, SectionTitle } from './ui'

/*
 * Auto-évaluation du jeune (vague 2 « Génération Bleue », src/selfEval.ts, supabase/064_auto_evaluation.sql) :
 *  - SelfEvalSection : « Comment ça s'est passé ? » sur la page du jeune (/moi) : ses matchs, tournois et stages récents ;
 *    « Remplir » (ou « Modifier » pendant 14 jours) ouvre une fenêtre (fond voilé et flouté ; ✕, Échap, Retour du téléphone
 *    ferment) avec 5 critères notés en mots (Un peu → À fond) et deux champs courts. Clavier seulement : rien ne part vers
 *    une IA (ni micro, ni Demander). Les plus anciennes restent lisibles, repliées.
 *  - SelfEvalStaff : « Son regard » sur la fiche (onglet Avis), à part des avis : jamais dans les moyennes ni les radars.
 *  - SelfEvalView : une auto-évaluation en lecture (mots, jamais de moyenne).
 * Script 064 pas passé, hors ligne, pas de droit : rien ne s'affiche (repli silencieux).
 */

/** Une auto-évaluation en lecture : les notes en mots, puis les deux textes. */
export function SelfEvalView({ se, own = false, sex }: { se: Pick<SelfEval, 'scores' | 'good' | 'work'>; own?: boolean; sex?: string | null }) {
  const chips = selfEvalChips(se)
  const g = w(sex)
  return (
    <div className="flex flex-col gap-2">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c.key} className="max-w-full rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] break-words">
              <span className="text-muted">{c.label} : </span>
              <b>{c.word}</b>
            </span>
          ))}
        </div>
      )}
      {se.good && (
        <div>
          <div className="text-[10px] font-bold text-muted">{own ? 'Ce que j’ai bien réussi' : `Ce qu’${g.il} a bien réussi`}</div>
          <div className="text-sm break-words whitespace-pre-wrap">{se.good}</div>
        </div>
      )}
      {se.work && (
        <div>
          <div className="text-[10px] font-bold text-muted">{own ? 'Ce que je veux travailler' : `Ce qu’${g.il} veut travailler`}</div>
          <div className="text-sm break-words whitespace-pre-wrap">{se.work}</div>
        </div>
      )}
    </div>
  )
}

/** « Tournoi · 01/11/2026 · Salle fictive ». */
const eventLine = (e: Pick<SelfEvalEvent, 'type' | 'date' | 'place'>) => [selfEvalTypeLabel(e.type), fmtDate(e.date), e.place].filter(Boolean).join(' · ')
/** « Raconte ton match » (tournoi, stage). */
const raconte = (type: string) => (type === 'tournoi' ? 'Raconte ton tournoi' : type === 'entrainement' ? 'Raconte ton stage' : type === 'match' ? 'Raconte ton match' : 'Raconte')

// ---------- Page du jeune ----------

/**
 * `only` (« Ma page » en onglets, 09/11) : « current », celles à remplir ou encore modifiables (onglet Aujourd'hui) ; « past »,
 * l'historique « Mes auto-évaluations » (onglet Mes matchs) ; sans : les deux (sport sans onglet Mes matchs).
 */
export function SelfEvalSection({ player: p, canWrite, only, hud = false }: { player: Player; canWrite: boolean; only?: 'current' | 'past'; hud?: boolean }) {
  const role = useRole()
  const [list, setList] = useState<SelfEvalEvent[] | null>(null)
  const [open, setOpen] = useState<SelfEvalEvent | null>(null)
  // Son compte (ou l'essai, ou une fiche de démonstration) : ses événements ; aperçu du staff avec le serveur : ce qu'il lit.
  const mine = isPlayerRole(role) || !supabase || p.id.startsWith('demo-')
  const load = () => (mine ? fetchMyEvents(p.id) : fetchPreviewEvents(p.id)).then((r) => setList(r.ok ? r.value : null))
  useEffect(() => {
    let live = true
    void (mine ? fetchMyEvents(p.id) : fetchPreviewEvents(p.id)).then((r) => live && setList(r.ok ? r.value : null))
    return () => {
      live = false
    }
  }, [p.id, mine])

  if (!list) return null
  const current = only === 'past' ? [] : list.filter((e) => e.open)
  const past = only === 'current' ? [] : list.filter((e) => !e.open && e.mine)
  if (!current.length && !past.length) return null

  const form = open && (
    <SelfEvalForm
      player={p}
      event={open}
      onClose={() => setOpen(null)}
      onSaved={() => {
        setOpen(null)
        void load()
      }}
    />
  )

  // Onglet Aujourd'hui en « tableau de bord de jeu » (bloc .hud, src/components/TodayHud.tsx, maquette du 09/11) : un bloc
  // oblique par événement à raconter (🏆, « Raconte ton match », nom · 2 min, délai), même fenêtre, mêmes délais.
  if (hud)
    return (
      <div className="flex flex-col gap-2.5" data-testid="comment-ca-s-est-passe">
        {current.map((e) => (
          <button
            key={e.eventId}
            type="button"
            className={`hud-skew flex min-h-16 w-full items-center px-4 py-2 text-left touch-manipulation ${e.mine ? 'hud-tile' : 'hud-tile ring-2 ring-[var(--hud-accent)] ring-inset'}`}
            disabled={!canWrite}
            onClick={() => setOpen(e)}
            aria-label={`${e.mine ? 'Modifier ce que tu as raconté' : raconte(e.type)} : ${e.name}, ${e.mine ? 'modifiable' : 'à remplir'} jusqu’au ${fmtDate(e.until)}`}
          >
            <span className="hud-unskew flex min-w-0 flex-1 items-center gap-3">
              <span aria-hidden className="text-3xl leading-none">
                {e.mine ? '✅' : '🏆'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="hud-big block text-lg">{e.mine ? 'Raconté !' : raconte(e.type)}</span>
                <span className="block text-xs font-bold break-words">
                  {e.name}
                  {!e.mine && <span className="font-normal whitespace-nowrap text-muted"> · 2 min</span>}
                </span>
                <span className="block text-[10px] text-muted">
                  {e.mine ? 'Modifiable' : 'À remplir'} jusqu’au {fmtDate(e.until)}
                </span>
              </span>
              <span aria-hidden className="hud-big text-3xl text-[var(--hud-accent)]">
                ›
              </span>
            </span>
          </button>
        ))}
        {past.length > 0 && (
          <details className="rounded-[4px] border border-line p-2.5" open={!current.length}>
            <summary className="min-h-9 cursor-pointer content-center text-xs font-bold">Mes auto-évaluations ({past.length})</summary>
            <ul className="mt-2 flex flex-col gap-3">
              {past.map((e) => (
                <li key={e.eventId} className="border-l-2 border-line pl-2">
                  <div className="text-[11px] font-bold">{e.name}</div>
                  <div className="mb-1 text-[10px] text-muted">{eventLine(e)}</div>
                  <SelfEvalView se={e.mine!} own />
                </li>
              ))}
            </ul>
          </details>
        )}
        {form}
      </div>
    )

  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="comment-ca-s-est-passe">
      <SectionTitle
        info={`Après un match, un tournoi ou un stage, dis comment tu l’as vécu. Ton encadrant le lit. Ce n’est pas une note : ça ne compte dans aucun classement. Tu peux la modifier pendant ${SELF_EVAL_DAYS} jours.`}
      >
        Comment ça s’est passé ?
      </SectionTitle>
      {current.length > 0 && (
        <ul className="flex flex-col gap-2">
          {current.map((e) => (
            <li key={e.eventId} className="rounded-lg border border-line bg-panel-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold break-words">{e.name}</div>
                  <div className="text-[11px] text-muted">{eventLine(e)}</div>
                </div>
                {canWrite && (
                  <button className={`${e.mine ? 'btn-ghost' : 'btn-primary'} min-h-10 shrink-0 px-3 text-xs`} onClick={() => setOpen(e)}>
                    {e.mine ? 'Modifier' : 'Remplir'}
                  </button>
                )}
              </div>
              {e.mine ? (
                <div className="mt-2 border-t border-line pt-2">
                  <SelfEvalView se={e.mine} own />
                </div>
              ) : (
                !canWrite && <p className="mt-1 text-[11px] text-muted">Pas encore remplie.</p>
              )}
              <p className="mt-1.5 text-[10px] text-muted">
                {e.mine ? 'Modifiable' : 'À remplir'} jusqu’au {fmtDate(e.until)}.
              </p>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details className="rounded-lg border border-line p-2.5" open={!current.length}>
          <summary className="min-h-9 cursor-pointer content-center text-xs font-bold">Mes auto-évaluations ({past.length})</summary>
          <ul className="mt-2 flex flex-col gap-3">
            {past.map((e) => (
              <li key={e.eventId} className="border-l-2 border-line pl-2">
                <div className="text-[11px] font-bold">{e.name}</div>
                <div className="mb-1 text-[10px] text-muted">{eventLine(e)}</div>
                <SelfEvalView se={e.mine!} own />
              </li>
            ))}
          </ul>
        </details>
      )}
      {form}
    </section>
  )
}

/** Fenêtre « Comment ça s'est passé ? » : 5 critères en mots, deux champs courts ; « Effacer » si elle existe déjà. */
function SelfEvalForm({ player: p, event: e, onClose, onSaved }: { player: Player; event: SelfEvalEvent; onClose: () => void; onSaved: () => void }) {
  const [scores, setScores] = useState<Record<string, number>>(() => ({ ...(e.mine?.scores ?? {}) }))
  const [good, setGood] = useState(e.mine?.good ?? '')
  const [work, setWork] = useState(e.mine?.work ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const empty = !cleanSelfEval({ scores, good, work })

  async function submit(clear = false) {
    if (busy) return
    if (clear && !(await ask('Effacer ton auto-évaluation pour cet événement ?', { ok: 'Effacer', danger: true, focusCancel: true }))) return
    setBusy(true)
    setErr('')
    const r = await saveMySelfEval(p.id, e.eventId, clear ? { scores: {}, good: '', work: '' } : { scores, good, work })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    onSaved()
  }

  return (
    <FormWindow title="Comment ça s’est passé ?" onClose={onClose} width={520}>
      <div>
        <div className="text-sm font-bold break-words">{e.name}</div>
        <div className="text-[11px] text-muted">{eventLine(e)}</div>
      </div>
      <p className="text-[11px] text-muted">
        Rien n’est obligatoire. Choisis ce qui te ressemble ; touche de nouveau pour enlever. Ton encadrant le lit, rien d’autre : pas de note, pas de classement.
      </p>
      {SELF_EVAL_CRITERIA.map((c) => (
        <fieldset key={c.key} className="flex flex-col gap-1.5">
          <legend className="label mb-1">{c.label}</legend>
          <div className="grid grid-cols-5 gap-1" role="radiogroup" aria-label={c.label}>
            {SELF_EVAL_LEVELS.map((word, i) => {
              const n = i + 1
              const on = scores[c.key] === n
              return (
                <button
                  key={word}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`min-h-10 rounded-lg border px-0.5 text-[11px] leading-tight font-bold ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2 text-muted'}`}
                  onClick={() =>
                    setScores((s) => {
                      const next = { ...s }
                      if (next[c.key] === n) delete next[c.key]
                      else next[c.key] = n
                      return next
                    })
                  }
                >
                  {word}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
      <label className="block">
        <span className="label">Ce que j’ai bien réussi</span>
        <textarea className="field min-h-11 w-full resize-y" rows={2} maxLength={SELF_EVAL_TEXT_MAX} placeholder="Une action, un moment, un progrès…" value={good} onChange={(x) => setGood(x.target.value)} />
        <span className="block text-right text-[10px] text-muted">
          {good.length} / {SELF_EVAL_TEXT_MAX}
        </span>
      </label>
      <label className="block">
        <span className="label">Ce que je veux travailler</span>
        <textarea className="field min-h-11 w-full resize-y" rows={2} maxLength={SELF_EVAL_TEXT_MAX} placeholder="Ce que tu as envie d’améliorer…" value={work} onChange={(x) => setWork(x.target.value)} />
        <span className="block text-right text-[10px] text-muted">
          {work.length} / {SELF_EVAL_TEXT_MAX}
        </span>
      </label>
      {err && <p className="text-[11px] text-red-500">{err}</p>}
      <FormActions>
        <button type="button" className="btn-primary min-h-10 px-4 text-xs" disabled={busy || empty} onClick={() => void submit()}>
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button type="button" className="btn-ghost min-h-10 px-4 text-xs" onClick={onClose}>
          Annuler
        </button>
        {e.mine && (
          <button type="button" className="btn-ghost min-h-10 px-4 text-xs text-red-500" disabled={busy} onClick={() => void submit(true)}>
            Effacer
          </button>
        )}
      </FormActions>
    </FormWindow>
  )
}

// ---------- Fiche du staff ----------

/**
 * Auto-évaluations d'un joueur pour le staff, lues quand `enabled` (onglet Avis ouvert) ; null : rien à montrer (pas encore
 * lu, script pas passé, hors ligne, pas de droit).
 */
export function usePlayerSelfEvals(playerId: string, enabled = true): SelfEval[] | null {
  const [state, setState] = useState<{ id: string; list: SelfEval[] | null } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void fetchPlayerSelfEvals(playerId).then((r) => live && setState({ id: playerId, list: r.ok ? r.value : null }))
    return () => {
      live = false
    }
  }, [playerId, enabled])
  return state?.id === playerId ? state.list : null
}

/** « Son regard » : onglet Avis de la fiche, à part des avis des observateurs. Rien d'écrit : rien. */
export function SelfEvalStaff({ player: p, list, events }: { player: Player; list: SelfEval[] | null; events: HBEvent[] }) {
  const [all, setAll] = useState(false)
  if (!list?.length) return null
  const g = w(p.sex)
  const shown = all ? list : list.slice(0, 3)
  return (
    <div className="card p-4" data-testid="son-regard">
      <div className="mb-1 flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase">
        <Icon name="user" className="h-3.5 w-3.5 text-accent" /> Son regard
      </div>
      <p className="mb-3 text-[10px] text-muted">
        Ce que {g.leJoueur} écrit après un événement, depuis sa page. Ce n’est pas un avis : jamais compté dans les moyennes, les radars ni les classements. Lecture
        seule.
      </p>
      <ul className="flex flex-col gap-3">
        {shown.map((s) => (
          <li key={s.eventId} className="border-l-2 border-accent/40 pl-2.5">
            <div className="text-[11px] font-bold">{nameOf(s, events)}</div>
            <div className="mb-1.5 text-[10px] text-muted">
              {selfEvalTypeLabel(s.eventType)} · {fmtDate(s.eventDate)}
            </div>
            <SelfEvalView se={s} sex={p.sex} />
          </li>
        ))}
      </ul>
      {list.length > 3 && (
        <button className="mt-2 min-h-10 text-[11px] font-bold text-accent" onClick={() => setAll(!all)}>
          {all ? 'Voir moins' : `Voir les ${list.length}`}
        </button>
      )}
    </div>
  )
}

/** Nom de l'événement : celui de l'appareil s'il le connaît (nom à jour), sinon celui recopié à l'enregistrement. */
const nameOf = (s: SelfEval, events: HBEvent[]) => events.find((e) => e.id === s.eventId && !e.deleted)?.name ?? s.eventName ?? 'Événement'

/** Dans « Avis du staff », pour l'événement choisi : son regard sur le même événement, à côté (jamais dans les chiffres). */
export function SelfEvalBeside({ eventId, list, sex }: { eventId: string; list: SelfEval[] | undefined; sex?: string | null }) {
  const self = avisAndSelf([], list ?? [], eventId).self
  if (!self) return null
  const g = w(sex)
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3" data-testid="son-regard-evenement">
      <div className="mb-1.5 text-[10px] font-extrabold tracking-wider text-accent uppercase">Son regard sur cet événement</div>
      <SelfEvalView se={self} sex={sex} />
      <p className="mt-1.5 text-[10px] text-muted">Écrit par {g.leJoueur} depuis sa page : pas compté dans les chiffres.</p>
    </div>
  )
}
