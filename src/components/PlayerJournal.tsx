import { useEffect, useState, type ReactNode } from 'react'
import type { Player } from '../db'
import { w } from '../gender'
import { useConfigRows } from '../installation'
import { addNote, deleteNote, editNote, fetchNotes, fetchTrend, shareNote } from '../playerJournal'
import {
  HELP_CONTACTS,
  JOURNAL_MOODS,
  journalDay,
  moodLabel,
  moodOf,
  moodTrendSummary,
  playerContactOf,
  SELF_LIMITS,
  type JournalMood,
  type JournalNote,
  type MoodTrend,
} from '../playerSpace'
import { supabase } from '../sync'
import { ask } from './Confirm'
import { useSportProfile } from '../installation'
import { Icon, SectionTitle } from './ui'

/*
 * « Mon journal du hand » (supabase/052_journal_joueur.sql, src/playerJournal.ts) :
 *  - JournalSection (page /moi) : écrire une note (texte + humeur facultative), la corriger, la supprimer, la partager avec
 *    son encadrant ou la reprendre ; privée par défaut ;
 *  - TalkDialog / TalkLink : « J'ai besoin d'en parler » (personne à contacter de l'installation + numéros officiels) ;
 *  - StaffJournal (fiche du staff) : tendance des humeurs (nombres, jamais de texte) et notes partagées, en lecture seule.
 * Clavier seulement : rien de ce que le jeune écrit ne part vers une IA.
 */

/** Petite fenêtre (même allure que les confirmations, src/components/Confirm.tsx). */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="win max-h-[90dvh] w-full max-w-sm overflow-y-auto p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="text-base font-extrabold">{title}</h2>
          <button className="min-h-9 min-w-9 shrink-0 text-muted" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ---------- « J'ai besoin d'en parler » ----------

/** Fenêtre d'aide : simple et chaleureuse. Aucun envoi, aucune détection : c'est le jeune qui choisit d'appeler. */
export function TalkDialog({ onClose, sex }: { onClose: () => void; sex?: string | null }) {
  const contact = playerContactOf(useConfigRows())
  return (
    <Dialog title="Tu as besoin d’en parler ?" onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm leading-relaxed" data-testid="besoin-d-en-parler">
        <p>Tu peux en parler à ton entraîneur ou au responsable de ton pôle. Tu n’es pas seul{w(sex).e} : on est là pour t’écouter.</p>
        {contact && (
          <p className="rounded-lg border border-line bg-panel-2 p-3">
            <span className="block text-[11px] text-muted">Personne à contacter</span>
            <b>{contact}</b>
          </p>
        )}
        <div>
          <p className="mb-1.5 text-[11px] text-muted">Numéros gratuits et anonymes :</p>
          <ul className="flex flex-col gap-1.5">
            {HELP_CONTACTS.map((c) => (
              <li key={c.href}>
                <a href={c.href} className="block rounded-lg border border-line bg-panel-2 px-3 py-2 break-words">
                  <b className="text-accent">{c.label}</b>
                  <span className="block text-[11px] text-muted">{c.what}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <button className="btn-primary min-h-11" onClick={onClose}>
          Fermer
        </button>
      </div>
    </Dialog>
  )
}

/** Lien discret mais trouvable « J'ai besoin d'en parler » (ouvre TalkDialog). */
export function TalkLink({ className = '', sex }: { className?: string; sex?: string | null }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={`min-h-9 text-[11px] font-bold text-muted underline underline-offset-2 ${className}`} onClick={() => setOpen(true)}>
        J’ai besoin d’en parler
      </button>
      {open && <TalkDialog sex={sex} onClose={() => setOpen(false)} />}
    </>
  )
}

// ---------- Humeurs ----------

/** Pastilles d'humeur (une seule à la fois ; toucher la pastille choisie la retire). */
function MoodPicker({ value, onChange, sex }: { value?: JournalMood; onChange: (m?: JournalMood) => void; sex?: string | null }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Humeur (facultatif)">
      {JOURNAL_MOODS.map((m) => {
        const on = value === m.id
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={on}
            className={`min-h-9 rounded-full border px-2.5 text-xs font-bold ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2 text-muted'}`}
            onClick={() => onChange(on ? undefined : m.id)}
          >
            <span aria-hidden>{m.emoji}</span> {sex === 'F' ? m.f : m.m}
          </button>
        )
      })}
    </div>
  )
}

/** Pastille d'une humeur choisie (lecture). */
export function MoodChip({ mood, sex }: { mood?: string; sex?: string | null }) {
  const m = moodOf(mood)
  if (!m) return null
  return (
    <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] font-bold">
      <span aria-hidden>{m.emoji}</span> {moodLabel(m.id, sex)}
    </span>
  )
}

// ---------- Page /moi ----------

/**
 * Section « Mon journal du hand » de /moi. `canWrite` : compte joueur (serveur) ou mode essai / local (appareil).
 * Aperçu d'un administrateur avec le serveur : rien n'est lu (le journal est privé).
 */
export function JournalSection({ player, canWrite, preview }: { player: Player; canWrite: boolean; preview: boolean }) {
  const sport = useSportProfile()
  const sex = player.sex
  const hidden = preview && !!supabase
  const [notes, setNotes] = useState<JournalNote[] | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [text, setText] = useState('')
  const [mood, setMood] = useState<JournalMood>()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string; mood?: JournalMood } | null>(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    if (hidden) return
    let live = true
    void fetchNotes(player.id).then((r) => {
      if (!live) return
      if (r.ok) setNotes(r.value)
      else setLoadErr(r.error)
    })
    return () => {
      live = false
    }
  }, [player.id, hidden])

  async function run(f: () => Promise<{ ok: true; value: JournalNote[] } | { ok: false; error: string }>, done?: string) {
    if (busy) return false
    setBusy(true)
    setMsg(null)
    try {
      const r = await f()
      if (!r.ok) {
        setMsg({ ok: false, text: r.error })
        return false
      }
      setNotes(r.value)
      if (done) setMsg({ ok: true, text: done })
      return true
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (!(await run(() => addNote(player.id, notes ?? [], text, mood), 'Ajoutée à ton journal (privée).'))) return
    setText('')
    setMood(undefined)
  }
  async function saveEdit() {
    if (!editing) return
    if (await run(() => editNote(player.id, notes ?? [], editing.id, editing.text, editing.mood), 'Note corrigée.')) setEditing(null)
  }
  async function remove(n: JournalNote) {
    if (!(await ask('Supprimer cette note ? Elle sera effacée pour de bon.', { ok: 'Supprimer', danger: true, focusCancel: true }))) return
    await run(() => deleteNote(player.id, notes ?? [], n.id), 'Note supprimée.')
  }
  async function share(n: JournalNote) {
    const on = !n.shared
    await run(() => shareNote(player.id, notes ?? [], n.id, on), on ? 'Partagée : ton encadrant peut la lire.' : 'Ton encadrant ne la voit plus.')
  }

  const shown = all ? (notes ?? []) : (notes ?? []).slice(0, 10)
  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="journal-du-hand">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <SectionTitle info="Une note quand tu veux : un match, un entraînement, une envie, ce que tu as ressenti. Le ressenti sportif : pas ta santé ni ta vie privée. Tu peux corriger ou supprimer tes notes à tout moment. Les 200 notes les plus récentes sont gardées : au-delà, les plus anciennes ne le sont plus.">
          Mon journal du {sport.word}
        </SectionTitle>
        <TalkLink sex={sex} />
      </div>
      <p className="text-[11px] text-muted">
        C’est ton journal de {sport.config.sportName.toLowerCase()}, il est à toi : tes notes restent privées. Ton encadrant voit seulement la tendance de tes humeurs et les notes que tu
        choisis de partager.
      </p>

      {hidden ? (
        <p className="text-xs text-muted">Aperçu : le journal est privé, rien n’est affiché ici.</p>
      ) : (
        <>
          {canWrite && (
            <div className="flex flex-col gap-2">
              <label className="block">
                <span className="sr-only">Nouvelle note</span>
                <textarea
                  className="field min-h-11 w-full resize-y"
                  rows={3}
                  placeholder={`Ce que le ${sport.word} t’a fait vivre cette semaine : un match, un entraînement, une envie…`}
                  maxLength={SELF_LIMITS.note}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <span className="block text-right text-[10px] text-muted">
                  {text.length} / {SELF_LIMITS.note}
                </span>
              </label>
              <span className="text-[11px] text-muted">Comment tu te sens ? (facultatif)</span>
              <MoodPicker value={mood} onChange={setMood} sex={sex} />
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn-primary min-h-11 px-5" disabled={busy || !text.trim()} onClick={() => void add()}>
                  {busy ? '…' : 'Ajouter'}
                </button>
                {msg && <span className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</span>}
              </div>
            </div>
          )}

          {loadErr && <p className="text-xs text-muted">{loadErr}</p>}
          {notes === null && !loadErr && <p className="text-xs text-muted">Chargement…</p>}
          {notes && !notes.length && <p className="text-xs text-muted">Pas encore de note.</p>}
          {notes && notes.length > 0 && (
            <ul className="flex flex-col gap-2">
              {shown.map((n) =>
                editing?.id === n.id ? (
                  <li key={n.id} className="flex flex-col gap-2 rounded-lg border border-accent/50 bg-panel-2 p-3">
                    <span className="text-[11px] font-bold">{journalDay(n.at)}</span>
                    <textarea
                      className="field min-h-11 w-full resize-y"
                      rows={3}
                      maxLength={SELF_LIMITS.note}
                      aria-label="Corriger la note"
                      value={editing.text}
                      onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                    />
                    <MoodPicker value={editing.mood} onChange={(m) => setEditing({ ...editing, mood: m })} sex={sex} />
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-primary min-h-11 px-4 text-xs" disabled={busy || !editing.text.trim()} onClick={() => void saveEdit()}>
                        Enregistrer
                      </button>
                      <button className="btn-ghost min-h-11 px-4 text-xs" onClick={() => setEditing(null)}>
                        Annuler
                      </button>
                    </div>
                  </li>
                ) : (
                  <li key={n.id} className="min-w-0 rounded-lg border border-line bg-panel-2 p-3" data-testid="note-journal">
                    <div className="flex items-start gap-2">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[11px] font-bold">{journalDay(n.at)}</span>
                        <MoodChip mood={n.mood} sex={sex} />
                        {n.shared && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">Partagée</span>}
                      </div>
                      {canWrite && (
                        <span className="flex shrink-0 gap-1">
                          <button className="min-h-9 min-w-9 text-muted hover:text-accent" aria-label="Corriger cette note" onClick={() => setEditing({ id: n.id, text: n.text, mood: n.mood })}>
                            <Icon name="pencil" className="mx-auto h-4 w-4" />
                          </button>
                          <button className="min-h-9 min-w-9 text-muted hover:text-red-400" aria-label="Supprimer cette note" onClick={() => void remove(n)}>
                            <Icon name="trash" className="mx-auto h-4 w-4" />
                          </button>
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm break-words whitespace-pre-wrap">{n.text}</p>
                    {canWrite && (
                      <button className="mt-1 min-h-9 text-[11px] font-bold text-accent underline underline-offset-2" disabled={busy} onClick={() => void share(n)}>
                        {n.shared ? 'Ne plus partager' : 'Partager avec mon encadrant'}
                      </button>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
          {notes && notes.length > 10 && (
            <button className="btn-ghost min-h-11 w-fit px-3 text-xs" onClick={() => setAll(!all)}>
              {all ? 'Seulement les plus récentes' : `Voir les ${notes.length - 10} plus anciennes`}
            </button>
          )}
          <p className="text-[10px] text-muted">Les 200 notes les plus récentes sont gardées : au-delà, les plus anciennes ne le sont plus.</p>
        </>
      )}
    </section>
  )
}

// ---------- Fiche du staff ----------

const shortDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'numeric' })

/**
 * Journal du hand, côté staff (fiche, lecture seule) : tendance des humeurs (4 dernières semaines en une ligne, 8 semaines en
 * pastilles), et les notes que le jeune a choisi de partager (les 5 dernières, puis « Voir tout »). Rien s'il n'y a rien.
 */
export function StaffJournal({ player }: { player: Player }) {
  const sport = useSportProfile()
  const g = w(player.sex)
  const [trend, setTrend] = useState<MoodTrend | null>(null)
  const [notes, setNotes] = useState<JournalNote[]>([])
  const [all, setAll] = useState(false)
  useEffect(() => {
    let live = true
    void Promise.all([fetchTrend(player.id), fetchNotes(player.id, true)]).then(([t, n]) => {
      if (!live) return
      setTrend(t)
      setNotes(n.ok ? n.value : [])
    })
    return () => {
      live = false
    }
  }, [player.id])
  const total = (trend?.weeks ?? []).reduce((s, x) => s + x.notes, 0)
  if (!total && !notes.length) return null
  const summary = moodTrendSummary(trend, player.sex)
  const shown = all ? notes : notes.slice(0, 5)
  return (
    <div className="card p-4" data-testid="journal-staff">
      <div className="section-title">Journal du {sport.word}</div>
      <p className="mb-2 text-[10px] text-muted">
        Le journal est privé : {g.leJoueur} choisit les notes qu’{g.il} partage. Tendance des humeurs : des nombres, jamais le texte. Lecture seule.
      </p>
      {trend && total > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          <p className="text-sm">
            Humeur des 4 dernières semaines : <b>{summary ?? 'pas d’humeur indiquée'}</b>
          </p>
          <div className="flex min-w-0 gap-1" aria-label="Humeur la plus fréquente, semaine par semaine (8 semaines)">
            {trend.weeks.map((wk) => {
              const top = Object.entries(wk.moods).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]
              const m = moodOf(top?.[0])
              const detail = Object.entries(wk.moods)
                .map(([k, n]) => `${n} ${moodLabel(k, player.sex)}`)
                .join(', ')
              return (
                <span
                  key={wk.from}
                  title={`Semaine du ${shortDay(wk.from)} : ${wk.notes} note${wk.notes > 1 ? 's' : ''}${detail ? ` (${detail})` : ''}`}
                  className="flex min-w-0 flex-1 flex-col items-center rounded-md bg-panel-2 py-1 text-center"
                >
                  <span className="text-base leading-none">{m ? m.emoji : '·'}</span>
                  <span className="mt-0.5 text-[9px] text-muted">{shortDay(wk.from)}</span>
                </span>
              )
            })}
          </div>
        </div>
      )}
      {notes.length > 0 ? (
        <>
          <div className="text-[10px] font-bold text-muted">Notes partagées</div>
          <ul className="mt-1 flex flex-col gap-2">
            {shown.map((n) => (
              <li key={n.id} className="border-l-2 border-line pl-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold">{journalDay(n.at)}</span>
                  <MoodChip mood={n.mood} sex={player.sex} />
                </div>
                <p className="text-sm break-words whitespace-pre-wrap">{n.text}</p>
              </li>
            ))}
          </ul>
          {notes.length > 5 && (
            <button className="btn-ghost mt-2 px-3 py-1.5 text-xs" onClick={() => setAll(!all)}>
              {all ? 'Seulement les 5 dernières' : `Voir tout le journal partagé (${notes.length})`}
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-muted">Aucune note partagée pour l’instant.</p>
      )}
    </div>
  )
}
