import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CriterionInput, groupBy, NumberField, PosBadge, Segmented, useMe } from '../components/ui'
import { can, currentUserId, useRole } from '../roles'
import { choose, setLeaveGuard } from '../components/Confirm'
import { fold } from './Players'
import { alive, criterionApplies, db, fmtDate, newId, save, today, type Evaluation, type EventType, type HBEvent, type Player } from '../db'

export const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'match', label: 'Match' },
  { value: 'tournoi', label: 'Tournoi' },
  { value: 'entrainement', label: 'Entraînement' },
  { value: 'observation', label: 'Observation' },
]

/**
 * Saisie d'un avis subjectif. Les avis des autres observateurs ne sont pas
 * affichés ici, pour ne pas influencer la notation.
 */
export default function Evaluate() {
  const [params, setParams] = useSearchParams()
  const role = useRole()
  const [me, setMe] = useMe()
  const [meDraft, setMeDraft] = useState(me)
  const playerId = params.get('joueur') ?? ''
  const eventId = params.get('evenement') ?? ''
  const [mode, setMode] = useState<'rapide' | 'complet'>('rapide')
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [saved, setSaved] = useState(false)

  const players = useLiveQuery(() => db.players.orderBy('lastName').toArray().then(alive), [], [])
  const events = useLiveQuery(() => db.events.orderBy('date').reverse().toArray().then(alive), [], [])
  const criteria = useLiveQuery(
    () => db.criteria.orderBy('order').toArray().then((cs) => alive(cs).filter((c) => c.active && c.kind === 'subjective')),
    [],
    [],
  )
  const mine = useLiveQuery(
    () => (me ? db.evaluations.where('observer').equals(me).toArray().then(alive) : Promise.resolve([] as Evaluation[])),
    [me],
    [],
  )

  const player = players.find((p) => p.id === playerId)
  const event = events.find((e) => e.id === eventId)
  const existing = mine.find((e) => e.playerId === playerId && (e.eventId ?? '') === eventId)

  const [draft, setDraft] = useState<Partial<Evaluation>>({ scores: {} })
  // Version de référence de l'avis (dernière enregistrée, ou vierge) : sert à détecter une saisie non enregistrée.
  const [baseline, setBaseline] = useState(() => fingerprint({ scores: {} }))
  // Nouveau couple joueur/événement : on repart d'un brouillon vierge…
  useEffect(() => {
    const init = existing ? { ...existing } : { scores: {}, date: event?.date ?? today() }
    setDraft(init)
    setBaseline(fingerprint(init))
    setSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, eventId])
  // …et on charge mon avis existant dès qu'il arrive de la base (chargement asynchrone).
  useEffect(() => {
    if (existing && !saved) {
      setDraft({ ...existing })
      setBaseline(fingerprint(existing))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id])

  const dirty = !!player && fingerprint(draft) !== baseline
  // Avant de quitter l'écran (menu du bas) ou l'onglet : proposer d'enregistrer.
  const leaveRef = useRef<() => Promise<boolean>>(async () => true)
  useEffect(() => {
    setLeaveGuard(() => leaveRef.current())
    return () => setLeaveGuard(null)
  }, [])
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const shown = useMemo(
    () => criteria.filter((c) => criterionApplies(c, player?.position) && (mode === 'complet' || c.quick || draft.scores?.[c.id] !== undefined)),
    [criteria, player, mode, draft.scores],
  )

  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params)
    if (v) n.set(k, v)
    else n.delete(k)
    setParams(n, { replace: true })
  }

  // ----- Étape 0 : qui évalue ? -----
  if (!me)
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-3 pt-10">
        <h1 className="text-lg font-extrabold">Qui évalue ?</h1>
        <p className="text-xs text-muted">Ton nom sera associé à tes avis pour pouvoir les comparer à ceux des autres observateurs.</p>
        <input className="field" placeholder="Prénom Nom" value={meDraft} onChange={(e) => setMeDraft(e.target.value)} />
        <button className="btn-primary" disabled={!meDraft.trim()} onClick={() => setMe(meDraft.trim())}>
          Continuer
        </button>
      </div>
    )

  async function submit() {
    if (!player || !event) return
    const scores = Object.fromEntries(Object.entries(draft.scores ?? {}).filter(([, v]) => typeof v === 'number')) as Record<string, number>
    await save<Evaluation>('evaluations', {
      ...draft,
      id: existing?.id ?? newId(),
      playerId: player.id,
      eventId: eventId || undefined,
      observer: me,
      observerId: currentUserId() ?? draft.observerId,
      date: draft.date ?? today(),
      scores,
    } as Evaluation)
    // Le joueur noté rejoint la liste de l'événement (si on peut modifier l'événement).
    if (can.editEvent(role, event) && !(event.playerIds ?? []).includes(player.id)) {
      await save<HBEvent>('events', { ...event, playerIds: [...(event.playerIds ?? []), player.id] })
    }
    setBaseline(fingerprint({ ...draft, scores }))
    setSaved(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /** Si l'avis en cours a été modifié : enregistrer, abandonner ou rester. Renvoie true si on peut partir. */
  async function confirmLeave() {
    if (!dirty || !player) return true
    const c = await choose(`Ton avis sur ${player.firstName} ${player.lastName} a été modifié mais pas enregistré.`, [
      { value: 'stay', label: 'Rester', style: 'ghost' },
      { value: 'discard', label: 'Ne pas enregistrer', style: 'ghost' },
      { value: 'save', label: 'Enregistrer', style: 'primary' },
    ])
    if (c === 'save') {
      await submit()
      return true
    }
    return c === 'discard'
  }
  leaveRef.current = confirmLeave

  /** Changer de joueur ou d'événement, après vérification de la saisie en cours. */
  const go = async (k: 'joueur' | 'evenement', v: string) => {
    if (await confirmLeave()) setParam(k, v)
  }

  const evaluatedHere = new Set(mine.filter((e) => (e.eventId ?? '') === eventId).map((e) => e.playerId))
  // Liste de l'événement : on passe d'un joueur à l'autre sans recherche.
  const byId = new Map(players.map((p) => [p.id, p]))
  const roster = (event?.playerIds ?? []).map((id) => byId.get(id)).filter((p): p is Player => !!p)
  const idx = roster.findIndex((p) => p.id === playerId)
  const prev = idx > 0 ? roster[idx - 1] : undefined
  const next = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : undefined
  const nextTodo = roster.slice(idx + 1).find((p) => !evaluatedHere.has(p.id)) ?? roster.find((p) => !evaluatedHere.has(p.id) && p.id !== playerId)
  const filled = Object.values(draft.scores ?? {}).filter((v) => typeof v === 'number').length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">Évaluer</h1>
        <span className="text-[11px] text-muted">
          Observateur : <b className="text-white">{me}</b>
        </span>
      </div>

      {/* Contexte */}
      <div className="card flex flex-col gap-2 p-3">
        <span className="label">Contexte</span>
        {creatingEvent ? (
          <NewEventForm
            onDone={(ev) => {
              setCreatingEvent(false)
              if (ev) void go('evenement', ev.id)
            }}
          />
        ) : (
          <div className="flex gap-2">
            <select className="field flex-1" value={eventId} onChange={(e) => void go('evenement', e.target.value)}>
              <option value="">— Choisir l’événement —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} · {fmtDate(ev.date)}
                </option>
              ))}
            </select>
            {can.manageEvents(role) && (
              <button className="btn-ghost shrink-0 px-3 text-xs" onClick={() => setCreatingEvent(true)}>
                + Nouveau
              </button>
            )}
          </div>
        )}
      </div>

      {!event && (
        <div className="rounded-md border border-line bg-panel p-3 text-xs text-muted">
          Chaque avis est rattaché à un événement (match, tournoi, entraînement, observation…) : choisis-le d’abord.
          {!events.length &&
            (can.manageEvents(role)
              ? ' Aucun événement pour l’instant : crée-le avec « + Nouveau ».'
              : ' Aucun événement pour l’instant : demande à un encadrant ou un administrateur d’en créer un.')}
        </div>
      )}

      {/* Joueur */}
      {event && (
      <div className="card flex flex-col gap-2 p-3">
        <span className="label">Joueur</span>
        <PlayerPicker players={players} roster={roster} value={playerId} done={evaluatedHere} onChange={(id) => void go('joueur', id)} />
        {roster.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <button className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap" disabled={!prev} onClick={() => prev && void go('joueur', prev.id)}>
              ←
            </button>
            <span className="text-center text-[11px] whitespace-nowrap text-muted">
              <b className="text-white">{idx >= 0 ? `${idx + 1} / ${roster.length}` : `${roster.length} joueurs`}</b> ·{' '}
              {roster.filter((p) => evaluatedHere.has(p.id)).length} noté{roster.filter((p) => evaluatedHere.has(p.id)).length > 1 ? 's' : ''}
            </span>
            <button className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap" disabled={idx >= 0 ? !next : false} onClick={() => void go('joueur', (next ?? roster[0]).id)}>
              →
            </button>
          </div>
        )}
        {players.length === 0 && can.editPlayers(role) && (
          <Link to="/joueurs/nouveau" className="text-xs font-bold text-accent">
            Aucun joueur : inscrire un joueur →
          </Link>
        )}
      </div>
      )}

      {saved && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
          ✓ Avis enregistré{event ? ` pour « ${event.name} »` : ''}.{' '}
          {nextTodo ? (
            <button className="font-bold underline" onClick={() => void go('joueur', nextTodo.id)}>
              Joueur suivant à noter : {nextTodo.firstName} {nextTodo.lastName} →
            </button>
          ) : roster.length ? (
            <b>Tous les joueurs de la liste sont notés.</b>
          ) : (
            <button className="font-bold underline" onClick={() => void go('joueur', '')}>
              Évaluer un autre joueur
            </button>
          )}
          {player && (
            <>
              {' · '}
              <Link className="font-bold underline" to={`/joueurs/${player.id}`}>
                Voir la comparaison
              </Link>
            </>
          )}
        </div>
      )}

      {player && event && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold">
              {player.firstName} {player.lastName} <PosBadge pos={player.position} />
            </div>
            <div className="w-44">
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'rapide', label: 'Rapide' },
                  { value: 'complet', label: 'Complet' },
                ]}
              />
            </div>
          </div>
          {existing && !saved && <div className="text-[11px] text-muted">Tu as déjà évalué ce joueur ici : tu modifies ton avis.</div>}
          <div className="text-[11px] text-muted">1 = très insuffisant · 3 = niveau attendu · 5 = remarquable. Laisse vide ce que tu n'as pas vu.</div>

          {groupBy(shown, (c) => c.category).map(([cat, cs]) => (
            <div key={cat} className="card p-3">
              <div className="section-title">{cat}</div>
              <div className="flex flex-col gap-3">
                {cs.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold">{c.label}</div>
                      {c.description && <div className="text-[10px] text-muted">{c.description}</div>}
                    </div>
                    <CriterionInput
                      c={c}
                      value={draft.scores?.[c.id]}
                      onChange={(v) =>
                        setDraft((d) => {
                          const scores = { ...(d.scores ?? {}) }
                          if (typeof v === 'number') scores[c.id] = v
                          else delete scores[c.id]
                          return { ...d, scores }
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="card flex flex-col gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold">Note globale de la prestation</span>
              <CriterionInput
                c={{ scale: 'score5' } as never}
                value={draft.overall}
                onChange={(v) => setDraft((d) => ({ ...d, overall: typeof v === 'number' ? v : undefined }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="label">Temps observé</span>
                <NumberField value={draft.minutesObserved} unit="min" onChange={(v) => setDraft((d) => ({ ...d, minutesObserved: v }))} />
              </div>
              <div>
                <span className="label">Date</span>
                <input type="date" className="field" value={draft.date ?? today()} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
              </div>
            </div>
            <div>
              <span className="label">Points forts</span>
              <textarea className="field min-h-14" value={draft.strengths ?? ''} onChange={(e) => setDraft((d) => ({ ...d, strengths: e.target.value }))} />
            </div>
            <div>
              <span className="label">Axes de progression</span>
              <textarea className="field min-h-14" value={draft.improvements ?? ''} onChange={(e) => setDraft((d) => ({ ...d, improvements: e.target.value }))} />
            </div>
          </div>

          <button className="btn-primary" disabled={filled === 0 && draft.overall === undefined} onClick={() => void submit()}>
            {existing ? 'Mettre à jour mon avis' : 'Enregistrer mon avis'} ({filled} critère{filled > 1 ? 's' : ''})
          </button>
        </>
      )}
    </div>
  )
}

/** Création d'un événement, ou modification de `event` (nom, type, date, lieu). */
export function NewEventForm({ event, onDone }: { event?: HBEvent; onDone: (ev?: HBEvent) => void }) {
  const [name, setName] = useState(event?.name ?? '')
  const [type, setType] = useState<EventType>(event?.type ?? 'match')
  const [date, setDate] = useState(event?.date ?? today())
  const [place, setPlace] = useState(event?.place ?? '')
  return (
    <div className="flex flex-col gap-2">
      <input className="field" placeholder="Ex. Tournoi de Pâques, Lyon – Valence…" value={name} onChange={(e) => setName(e.target.value)} />
      <Segmented value={type} onChange={setType} options={EVENT_TYPES} columns={2} />
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="field" placeholder="Lieu" value={place} onChange={(e) => setPlace(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={!name.trim()}
          onClick={async () => {
            const fields = { name: name.trim(), type, date, place: place || undefined }
            // Relit l'événement au moment d'enregistrer : la liste des joueurs a pu changer entre-temps.
            const current = event && (await db.events.get(event.id))
            onDone(await save<HBEvent>('events', current ? { ...current, ...fields } : { id: newId(), ...fields }))
          }}
        >
          {event ? 'Enregistrer' : 'Créer'}
        </button>
        <button className="btn text-muted" onClick={() => onDone()}>
          Annuler
        </button>
      </div>
    </div>
  )
}

/** Choix d'un joueur par recherche (la base peut contenir des milliers de joueurs). */
function PlayerPicker({
  players,
  roster,
  value,
  done,
  onChange,
}: {
  players: Player[]
  roster: Player[]
  value: string
  done: Set<string>
  onChange: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => setActive(0), [q])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const selected = players.find((p) => p.id === value)
  if (selected && !q)
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          <b>
            {selected.firstName} {selected.lastName}
          </b>
          {selected.club && <span className="text-[11px] text-muted"> · {selected.club}</span>}
        </span>
        <button className="shrink-0 text-xs font-bold text-accent" onClick={() => onChange('')}>
          Changer
        </button>
      </div>
    )
  const words = fold(q).split(/\s+/).filter(Boolean)
  // Sans recherche : les joueurs déjà évalués ici d'abord, puis l'ordre alphabétique.
  const matches = (
    words.length
      ? players.filter((p) => {
          const hay = fold(`${p.firstName} ${p.lastName} ${p.club ?? ''} ${p.license ?? ''}`)
          return words.every((w) => hay.includes(w))
        })
      : roster.length
        ? roster
        : players.filter((p) => done.has(p.id))
  ).slice(0, words.length ? 20 : Math.max(20, roster.length))
  return (
    <div className="flex flex-col gap-1">
      <input
        className="field"
        placeholder="Nom, prénom, club ou licence…"
        value={q}
        autoFocus={!value}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          // ↑ ↓ pour se déplacer dans la liste, Entrée pour choisir le joueur.
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && matches[active]) {
            e.preventDefault()
            onChange(matches[active].id)
            setQ('')
          }
        }}
      />
      <div ref={listRef} className="flex flex-col gap-1">
      {matches.map((p, i) => (
        <button
          key={p.id}
          data-i={i}
          onMouseEnter={() => setActive(i)}
          className={`flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-left text-xs ${i === active ? 'border-accent bg-panel-2' : 'border-line'}`}
          onClick={() => (onChange(p.id), setQ(''))}
        >
          <span className="min-w-0 truncate">
            {done.has(p.id) && <span className="text-emerald-300">✓ </span>}
            <b>
              {p.lastName.toUpperCase()} {p.firstName}
            </b>
            {p.birthDate && <span className="text-muted"> · {p.birthDate.slice(0, 4)}</span>}
          </span>
          <span className="shrink-0 truncate text-[10px] text-muted">{p.club}</span>
        </button>
      ))}
      </div>
      {words.length > 0 && matches.length === 0 && <p className="text-[11px] text-muted">Aucun joueur trouvé.</p>}
    </div>
  )
}

/** Empreinte des champs saisis d'un avis, pour savoir s'il a changé. */
function fingerprint(d: Partial<Evaluation>) {
  const scores = Object.entries(d.scores ?? {})
    .filter(([, v]) => typeof v === 'number')
    .sort(([a], [b]) => a.localeCompare(b))
  const txt = (v?: string) => v?.trim() || ''
  return JSON.stringify([scores, d.overall ?? null, d.minutesObserved ?? null, txt(d.strengths), txt(d.improvements), d.date ?? ''])
}
