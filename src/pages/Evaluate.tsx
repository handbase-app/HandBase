import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CriterionInput, groupBy, NumberField, PosBadges, QuarterBadge, Segmented, useMe } from '../components/ui'
import { can, currentUserId, useRole } from '../roles'
import { choose, setLeaveGuard } from '../components/Confirm'
import { ProposePlayer } from '../components/ProposePlayer'
import { ReviewBadge, ReviewNote } from '../components/Review'
import { fold } from './Players'
import {
  alive,
  CONTEXT_TYPES,
  criterionApplies,
  db,
  fmtDate,
  newId,
  save,
  today,
  type ContextType,
  type Evaluation,
  type EventType,
  type HBEvent,
  type Player,
} from '../db'

export const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: 'match', label: 'Match' },
  { value: 'tournoi', label: 'Tournoi' },
  { value: 'entrainement', label: 'Entraînement' },
  { value: 'observation', label: 'Observation' },
]

/**
 * Saisie d'un avis subjectif. Les avis des autres observateurs ne sont pas
 * affichés ici, pour ne pas influencer la notation.
 * L'avis porte sur un événement, ou c'est un avis spontané (?contexte=libre) : joueur vu ailleurs
 * (UNSS, entraînement de club…). L'avis spontané d'un observateur attend la validation d'un encadrant ;
 * ?avis=<id> rouvre un avis spontané pour le modifier.
 */
export default function Evaluate() {
  const [params, setParams] = useSearchParams()
  const role = useRole()
  const [me, setMe] = useMe()
  const [meDraft, setMeDraft] = useState(me)
  const playerId = params.get('joueur') ?? ''
  const eventId = params.get('evenement') ?? ''
  const spontaneous = params.get('contexte') === 'libre'
  const avisParam = params.get('avis') ?? ''
  // Avis spontané en cours de modification (celui de l'URL, ou celui qu'on vient d'enregistrer).
  const [avisId, setAvisId] = useState(avisParam)
  const [mode, setMode] = useState<'rapide' | 'complet'>('rapide')
  const [creatingEvent, setCreatingEvent] = useState(false)
  // Joueur absent de la base : fiche proposée, pré-remplie avec la recherche.
  const [proposing, setProposing] = useState<Partial<Player> | null>(null)
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
  // Menu des événements : à venir et des 15 derniers jours en premier (le temps de finir ses avis), les plus
  // anciens à part ; les archivés n'y sont plus, sauf celui déjà choisi (lien direct).
  const recentLimit = new Date(Date.now() - 15 * 86400000).toLocaleDateString('sv')
  const listed = events.filter((e) => !e.archived || e.id === eventId)
  const recentEvents = listed.filter((e) => e.date >= recentLimit)
  const olderEvents = listed.filter((e) => e.date < recentLimit)
  const own = useLiveQuery(() => (avisId ? db.evaluations.get(avisId) : undefined), [avisId])
  const existing = spontaneous
    ? own && !own.deleted && own.playerId === playerId ? own : undefined
    : mine.find((e) => e.playerId === playerId && (e.eventId ?? '') === eventId && !e.contextType)

  const [draft, setDraft] = useState<Partial<Evaluation>>({ scores: {} })
  // Version de référence de l'avis (dernière enregistrée, ou vierge) : sert à détecter une saisie non enregistrée.
  const [baseline, setBaseline] = useState(() => fingerprint({ scores: {} }))
  // Nouveau couple joueur/événement : on repart d'un brouillon vierge…
  // (Avis spontané : on garde le contexte du joueur précédent, souvent le même pour plusieurs joueurs.)
  useEffect(() => {
    setAvisId(avisParam)
    const ctx = spontaneous ? { contextType: draft.contextType, contextPlace: draft.contextPlace, date: draft.date ?? today() } : {}
    const init = existing && (!spontaneous || existing.id === avisParam) ? { ...existing } : { scores: {}, date: event?.date ?? today(), ...ctx }
    setDraft(init)
    setBaseline(fingerprint(init))
    setSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, eventId, spontaneous, avisParam])
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
    if (!player || !(event || (spontaneous && draft.contextType))) return
    const scores = Object.fromEntries(Object.entries(draft.scores ?? {}).filter(([, v]) => isFilled(v)))
    const id = existing?.id ?? newId()
    // Avis spontané : validé d'office pour un encadrant ou un administrateur, sinon en attente
    // (le serveur applique la même règle, quoi qu'envoie l'appareil).
    const review = spontaneous
      ? can.review(role)
        ? { review: 'validated' as const, reviewedBy: currentUserId() ?? undefined, reviewedByName: me, reviewedAt: new Date().toISOString(), reviewNote: undefined }
        : { review: 'pending' as const, reviewedBy: undefined, reviewedByName: undefined, reviewedAt: undefined, reviewNote: undefined }
      : { review: undefined, reviewedBy: undefined, reviewedByName: undefined, reviewedAt: undefined, reviewNote: undefined }
    await save<Evaluation>('evaluations', {
      ...draft,
      ...review,
      id,
      playerId: player.id,
      eventId: spontaneous ? undefined : eventId || undefined,
      contextType: spontaneous ? draft.contextType : undefined,
      contextPlace: spontaneous ? draft.contextPlace?.trim() || undefined : undefined,
      observer: me,
      observerId: currentUserId() ?? draft.observerId,
      date: draft.date ?? today(),
      scores,
    } as Evaluation)
    if (spontaneous) setAvisId(id)
    // Le joueur noté rejoint la liste de l'événement (si on peut modifier l'événement).
    if (event && !spontaneous && can.editEvent(role, event) && !(event.playerIds ?? []).includes(player.id)) {
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

  /** Changer de joueur, d'événement ou de contexte, après vérification de la saisie en cours. */
  const go = async (k: 'joueur' | 'evenement' | 'contexte', v: string) => {
    if (!(await confirmLeave())) return
    const n = new URLSearchParams(params)
    if (v) n.set(k, v)
    else n.delete(k)
    n.delete('avis') // un autre joueur ou contexte : nouvel avis
    if (k === 'contexte') n.delete('evenement')
    setParams(n, { replace: true })
  }

  const evaluatedHere = new Set(spontaneous ? [] : mine.filter((e) => (e.eventId ?? '') === eventId).map((e) => e.playerId))
  // Liste de l'événement : on passe d'un joueur à l'autre sans recherche.
  const byId = new Map(players.map((p) => [p.id, p]))
  const roster = (event?.playerIds ?? []).map((id) => byId.get(id)).filter((p): p is Player => !!p)
  const idx = roster.findIndex((p) => p.id === playerId)
  const prev = idx > 0 ? roster[idx - 1] : undefined
  const next = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : undefined
  const nextTodo = roster.slice(idx + 1).find((p) => !evaluatedHere.has(p.id)) ?? roster.find((p) => !evaluatedHere.has(p.id) && p.id !== playerId)
  const filled = Object.values(draft.scores ?? {}).filter(isFilled).length

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
        <Segmented
          value={spontaneous ? 'libre' : 'evenement'}
          onChange={(v) => void go('contexte', v === 'libre' ? 'libre' : '')}
          options={[
            { value: 'evenement', label: 'Sur un événement' },
            { value: 'libre', label: 'Avis spontané' },
          ]}
        />
        {spontaneous ? (
          <SpontaneousContext draft={draft} setDraft={setDraft} validated={can.review(role)} />
        ) : creatingEvent ? (
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
              {recentEvents.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name} · {fmtDate(ev.date)}
                </option>
              ))}
              {olderEvents.length > 0 && (
                <optgroup label="Plus anciens">
                  {olderEvents.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name} · {fmtDate(ev.date)}
                      {ev.archived ? ' (archivé)' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {can.manageEvents(role) && (
              <button className="btn-ghost shrink-0 px-3 text-xs" onClick={() => setCreatingEvent(true)}>
                + Nouveau
              </button>
            )}
          </div>
        )}
      </div>

      {!event && !spontaneous && (
        <div className="rounded-md border border-line bg-panel p-3 text-xs text-muted">
          Chaque avis est rattaché à un événement (match, tournoi, entraînement, observation…) : choisis-le d’abord.
          Joueur vu ailleurs (UNSS, entraînement de club…) ? Choisis « Avis spontané ».
          {!events.length &&
            (can.manageEvents(role)
              ? ' Aucun événement pour l’instant : crée-le avec « + Nouveau ».'
              : ' Aucun événement pour l’instant : demande à un encadrant ou un administrateur d’en créer un.')}
        </div>
      )}

      {/* Joueur */}
      {(event || spontaneous) && (
      <div className="card flex flex-col gap-2 p-3">
        <span className="label">Joueur</span>
        {proposing ? (
          <ProposePlayer
            initial={proposing}
            onDone={(pl) => {
              setProposing(null)
              if (pl) void go('joueur', pl.id)
            }}
          />
        ) : (
          <PlayerPicker
            players={players}
            roster={roster}
            value={playerId}
            done={evaluatedHere}
            onChange={(id) => void go('joueur', id)}
            onPropose={(q) => {
              // « Jean Dupont » → prénom Jean, nom Dupont.
              const [firstName, ...rest] = q.trim().split(/\s+/)
              setProposing({ firstName, lastName: rest.join(' ') || undefined })
            }}
          />
        )}
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
          ✓ Avis enregistré{event && !spontaneous ? ` pour « ${event.name} »` : ''}
          {spontaneous && !can.review(role) ? ', en attente de validation par un encadrant' : ''}.{' '}
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

      {player && (event || spontaneous) && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold">
              {player.firstName} {player.lastName} <PosBadges p={player} /> <QuarterBadge birthDate={player.birthDate} />
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
          {existing && !saved && (
            <div className="text-[11px] text-muted">
              {spontaneous ? (
                <span className="flex flex-wrap items-center gap-2">
                  Tu modifies ton avis spontané du {fmtDate(existing.date)}. <ReviewBadge e={existing} />
                </span>
              ) : (
                'Tu as déjà évalué ce joueur ici : tu modifies ton avis.'
              )}
              {spontaneous && <ReviewNote e={existing} />}
              {spontaneous && existing.review && existing.review !== 'pending' && !can.review(role) && (
                <div className="mt-1 text-amber-200">Si tu le modifies, il repassera en attente de validation.</div>
              )}
            </div>
          )}
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
                          if (isFilled(v)) scores[c.id] = v!
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
              {!spontaneous && (
                <div>
                  <span className="label">Date</span>
                  <input type="date" className="field" value={draft.date ?? today()} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
                </div>
              )}
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

          {spontaneous && !draft.contextType && <div className="text-[11px] text-amber-200">Indique le contexte (UNSS, entraînement club…) en haut de l’écran.</div>}
          <button
            className="btn-primary"
            disabled={(filled === 0 && draft.overall === undefined) || (spontaneous && !draft.contextType)}
            onClick={() => void submit()}
          >
            {existing ? 'Mettre à jour mon avis' : 'Enregistrer mon avis'} ({filled} critère{filled > 1 ? 's' : ''})
          </button>
        </>
      )}
    </div>
  )
}

/** Contexte d'un avis spontané : type, lieu, date. */
function SpontaneousContext({
  draft,
  setDraft,
  validated,
}: {
  draft: Partial<Evaluation>
  setDraft: Dispatch<SetStateAction<Partial<Evaluation>>>
  validated: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted">
        Pour un joueur vu hors des événements prévus : UNSS, entraînement de club, match local…{' '}
        {validated ? (
          <>Ton avis est validé d’office.</>
        ) : (
          <>
            Ton avis sera <b className="text-white">soumis à validation</b> par un encadrant avant de compter dans les moyennes.
          </>
        )}
      </p>
      <Segmented<ContextType>
        value={draft.contextType}
        onChange={(v) => setDraft((d) => ({ ...d, contextType: v }))}
        options={CONTEXT_TYPES}
        columns={2}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className="field"
          placeholder="Lieu, établissement, club…"
          value={draft.contextPlace ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, contextPlace: e.target.value }))}
        />
        <input type="date" className="field" value={draft.date ?? today()} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
      </div>
    </div>
  )
}

/** Une valeur d'avis renseignée : note, option choisie ou texte non vide. */
const isFilled = (v: unknown): v is number | string => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')

/** Création d'un événement, ou modification de `event` (nom, type, date, lieu). */
export function NewEventForm({ event, groupId, onDone }: { event?: HBEvent; groupId?: string; onDone: (ev?: HBEvent) => void }) {
  // À la création : la liste de l'événement peut partir d'un groupe (copie, modifiable ensuite).
  const groups = useLiveQuery(() => db.groups.orderBy('name').toArray().then((gs) => alive(gs).filter((g) => !g.archived && can.seeGroup(g))), [], [])
  const [group, setGroup] = useState(groupId ?? '')
  const picked = groups.find((g) => g.id === group)
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
      {!event && groups.length > 0 && (
        <select className={`field ${group ? 'border-accent font-bold' : ''}`} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">Joueurs : aucun pour l’instant (à ajouter ensuite)</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              Joueurs : {g.private ? '🔒 ' : ''}groupe {g.name} ({g.playerIds.length})
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={!name.trim()}
          onClick={async () => {
            const fields = { name: name.trim(), type, date, place: place || undefined }
            // Relit l'événement au moment d'enregistrer : la liste des joueurs a pu changer entre-temps.
            const current = event && (await db.events.get(event.id))
            onDone(
              await save<HBEvent>('events', current ? { ...current, ...fields } : { id: newId(), ...fields, playerIds: picked ? [...picked.playerIds] : undefined }),
            )
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
  onPropose,
}: {
  players: Player[]
  roster: Player[]
  value: string
  done: Set<string>
  onChange: (id: string) => void
  /** Joueur introuvable : proposer une fiche (reçoit le texte cherché). */
  onPropose: (q: string) => void
}) {
  const role = useRole()
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
            {p.birthDate && <span className="text-muted"> · {p.birthDate.slice(0, 4)}</span>} <QuarterBadge birthDate={p.birthDate} />
            {p.review === 'pending' && <span className="text-amber-300"> · proposée</span>}
            {p.review === 'refused' && <span className="text-muted"> · hors cadre</span>}
          </span>
          <span className="shrink-0 truncate text-[10px] text-muted">{p.club}</span>
        </button>
      ))}
      </div>
      {words.length > 0 && matches.length === 0 && <p className="text-[11px] text-muted">Aucun joueur trouvé.</p>}
      {words.length > 0 && (
        <button className="self-start text-xs font-bold text-accent" onClick={() => onPropose(q)}>
          + Joueur absent de la base : {can.editPlayers(role) ? 'créer' : 'proposer'} une fiche
        </button>
      )}
    </div>
  )
}

/** Empreinte des champs saisis d'un avis, pour savoir s'il a changé. */
function fingerprint(d: Partial<Evaluation>) {
  const scores = Object.entries(d.scores ?? {})
    .filter(([, v]) => isFilled(v))
    .sort(([a], [b]) => a.localeCompare(b))
  const txt = (v?: string) => v?.trim() || ''
  return JSON.stringify([scores, d.overall ?? null, d.minutesObserved ?? null, txt(d.strengths), txt(d.improvements), d.date ?? '', d.contextType ?? '', txt(d.contextPlace)])
}
