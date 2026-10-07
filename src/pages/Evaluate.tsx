import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CriterionInput, groupBy, Icon, NumberField, playerName, PosBadges, QuarterBadge, Segmented, useMe } from '../components/ui'
import { can, currentUserId, groupTag, useRole } from '../roles'
import { loadTeams } from '../teams'
import { ask, choose, setLeaveGuard, useUnsaved } from '../components/Confirm'
import { ProposePlayer } from '../components/ProposePlayer'
import { filterRoster, sortRoster, useRosterFilter, useRosterSort } from '../rosterOrder'
import { ReviewBadge, ReviewNote } from '../components/Review'
import { fold } from './Players'
import { StaffPicker, useCanPickStaff } from '../components/StaffPicker'
import { supabase } from '../sync'
import {
  alive,
  CONTEXT_TYPES,
  POSITIONS,
  criterionApplies,
  db,
  fmtDate,
  newId,
  remove,
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
  const navigate = useNavigate()
  const location = useLocation()
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
  // Joueur absent de la base : fiche proposée, pré-remplie avec la recherche.
  const [proposing, setProposing] = useState<Partial<Player> | null>(null)
  const [saved, setSaved] = useState(false)
  // Sens de l'animation au changement de joueur par glissement.
  // Joueur qui arrive après un glissement (ou une flèche), et de quel côté : seule sa fiche s'anime.
  const [enter, setEnter] = useState<{ id: string; dir: 'left' | 'right' } | null>(null)

  const players = useLiveQuery(() => db.players.orderBy('lastName').toArray().then(alive), [], [])
  const events = useLiveQuery(() => db.events.orderBy('date').reverse().toArray().then(alive), [], [])
  const criteria = useLiveQuery(
    () => db.criteria.orderBy('order').toArray().then((cs) => alive(cs).filter((c) => c.active && c.kind === 'subjective')),
    [],
    [],
  )
  // Mes avis : par compte une fois connecté (un nom peut changer ou être porté par deux personnes),
  // par nom seulement en mode local. Il suffit de ceux de l'événement (ou du joueur, hors événement).
  const uid = supabase ? currentUserId() : null
  const mine = useLiveQuery(
    () =>
      uid
        ? (eventId ? db.evaluations.where('eventId').equals(eventId) : db.evaluations.where('playerId').equals(playerId))
            .filter((e) => e.observerId === uid)
            .toArray()
            .then(alive)
        : me
          ? db.evaluations.where('observer').equals(me).toArray().then(alive)
          : Promise.resolve([] as Evaluation[]),
    [me, uid, eventId, eventId ? '' : playerId],
    [],
  )

  const player = players.find((p) => p.id === playerId)
  const event = events.find((e) => e.id === eventId)
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
  // Geste de glisser (voir plus bas) : déclaré ici, avant l'écran « Qui évalue ? », car un hook
  // doit être appelé à chaque affichage, dans le même ordre.
  // Glissement en cours : départ du doigt, et sens décidé (horizontal = on fait glisser la fiche).
  const swipe = useRef<{ x: number; y: number; t: number; horizontal?: boolean; dx: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // Nouveau joueur affiché après un changement : on repart en haut de sa fiche si on était descendu plus bas.
  useEffect(() => {
    if (!enter || enter.id !== playerId) return
    const top = cardRef.current?.getBoundingClientRect().top
    if (top !== undefined && top < 0) window.scrollBy({ top: top - 80 })
  }, [enter, playerId])

  // Ordre de la liste de l'événement : le même que sur la page de l'événement (par poste, puis « Nom » par défaut).
  const [rosterSort] = useRosterSort(eventId || undefined)
  // Filtres posés sur la page de l'événement (un poste, masquer ceux que j'ai notés) : on ne note que ces joueurs-là.
  const rosterFilter = useRosterFilter(eventId || undefined)
  useEffect(() => {
    setLeaveGuard(() => leaveRef.current())
    return () => setLeaveGuard(null)
  }, [])
  useUnsaved(dirty)

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
      : event && !can.editEvent(role, event) && !can.contributeEvent(role, event) && !(event.playerIds ?? []).includes(player.id)
        ? // Joueur hors liste noté par un autre que l'organisateur : à valider (supabase/021_avis_hors_liste.sql).
          { review: 'pending' as const, reviewedBy: undefined, reviewedByName: undefined, reviewedAt: undefined, reviewNote: undefined }
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
    if (event && !spontaneous && (can.editEvent(role, event) || can.contributeEvent(role, event)) && !(event.playerIds ?? []).includes(player.id)) {
      const me = currentUserId()
      await save<HBEvent>('events', {
        ...event,
        playerIds: [...(event.playerIds ?? []), player.id],
        ...(me && { addedBy: { ...event.addedBy, [player.id]: me } }),
      })
    }
    setBaseline(fingerprint({ ...draft, scores }))
    setSaved(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /** Brouillon vierge pour ce joueur (on garde le contexte d'un avis spontané : lieu, date…). */
  const blankDraft = (): Partial<Evaluation> =>
    spontaneous
      ? { scores: {}, contextType: draft.contextType, contextPlace: draft.contextPlace, date: draft.date ?? today() }
      : { scores: {}, date: event?.date ?? today() }

  /** « Annuler » : on oublie les modifications, retour au dernier avis enregistré (ou à un avis vierge). */
  function revert() {
    const init = existing ? { ...existing } : blankDraft()
    setDraft(init)
    setBaseline(fingerprint(init))
  }

  /** « Retirer mon avis » : supprime l'avis enregistré, après confirmation. */
  async function withdraw() {
    if (!existing || !player) return
    if (!(await ask(`Retirer ton avis sur ${playerName(player)} ? Il sera supprimé.`, { ok: 'Retirer' }))) return
    await remove('evaluations', existing.id)
    const init = blankDraft()
    setDraft(init)
    setBaseline(fingerprint(init))
    setSaved(false)
    if (spontaneous) setAvisId('')
  }

  /** Si l'avis en cours a été modifié : enregistrer, abandonner ou rester. Renvoie true si on peut partir. */
  async function confirmLeave() {
    if (!dirty || !player) return true
    const c = await choose(`Ton avis sur ${playerName(player)} a été modifié mais pas enregistré.`, [
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
  const fullRoster = sortRoster(
    (event?.playerIds ?? []).map((id) => byId.get(id)).filter((p): p is Player => !!p),
    rosterSort,
  )
  // Le joueur en cours reste dans la liste même s'il vient d'être noté (sinon « → » ne saurait plus où il en est).
  const roster = filterRoster(fullRoster, rosterFilter, evaluatedHere, playerId)
  const posLabel = POSITIONS.find((x) => x.id === rosterFilter.pos)?.label
  const idx = roster.findIndex((p) => p.id === playerId)
  const prev = idx > 0 ? roster[idx - 1] : undefined
  const next = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : undefined
  const nextTodo = roster.slice(idx + 1).find((p) => !evaluatedHere.has(p.id)) ?? roster.find((p) => !evaluatedHere.has(p.id) && p.id !== playerId)
  const filled = Object.values(draft.scores ?? {}).filter(isFilled).length

  // Glisser vers la gauche : joueur suivant ; vers la droite : précédent (liste de l'événement).
  // La fiche suit le doigt ; au lâcher, elle part sur le côté et le joueur suivant arrive de l'autre côté,
  // ou elle revient en place si le geste est trop court. Pas dans un champ de saisie (qui garde son propre geste).
  const canSwipe = !spontaneous && roster.length > 0 && idx >= 0
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const setCard = (x: number, transition = '', opacity = 1) => {
    const el = cardRef.current
    if (!el) return
    el.style.transition = transition
    el.style.transform = x ? `translateX(${x}px)` : ''
    el.style.opacity = opacity === 1 ? '' : String(opacity)
  }
  const springBack = () => setCard(0, 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)')

  /** Passe au joueur `target` : la fiche actuelle sort du côté `dir`, la nouvelle arrive de l'autre côté. */
  async function changePlayer(target: Player, dir: 'left' | 'right') {
    if (dirty) {
      // Avis pas enregistré : la fiche revient en place, la question est posée (et « Rester » ne bouge rien).
      springBack()
      setEnter({ id: target.id, dir })
      return void go('joueur', target.id)
    }
    if (!reduceMotion && cardRef.current) {
      const w = cardRef.current.offsetWidth
      setCard(dir === 'left' ? -w : w, 'transform 0.16s ease-in, opacity 0.16s ease-in', 0)
      await new Promise((r) => setTimeout(r, 160))
    }
    setEnter({ id: target.id, dir })
    void go('joueur', target.id)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    const el = e.target as HTMLElement
    swipe.current =
      !canSwipe || el.closest('input, textarea, select, [data-noswipe]') ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), dx: 0 }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const s = swipe.current
    if (!s) return
    const dx = e.touches[0].clientX - s.x
    const dy = e.touches[0].clientY - s.y
    // On décide du sens dès que le doigt a un peu bougé : vertical = défilement normal, on laisse faire.
    if (s.horizontal === undefined) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      s.horizontal = Math.abs(dx) > Math.abs(dy) * 1.2
      if (!s.horizontal) return void (swipe.current = null)
    }
    // Résistance au bout de la liste (pas de joueur de ce côté).
    s.dx = (dx < 0 && !next) || (dx > 0 && !prev) ? dx * 0.25 : dx
    setCard(s.dx)
  }
  const onTouchEnd = () => {
    const s = swipe.current
    swipe.current = null
    if (!s?.horizontal) return
    const w = cardRef.current?.offsetWidth ?? 360
    const speed = Math.abs(s.dx) / Math.max(1, Date.now() - s.t) // px/ms
    const target = s.dx < 0 ? next : prev
    if (target && (Math.abs(s.dx) > w * 0.28 || (speed > 0.5 && Math.abs(s.dx) > 30))) void changePlayer(target, s.dx < 0 ? 'left' : 'right')
    else springBack()
  }

  return (
    <div className="flex flex-col gap-4" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={springBack}>
      {/* Plus d'onglet « Évaluer » : on arrive ici depuis un événement, une fiche joueur ou Propositions. */}
      <div className="flex items-center justify-between gap-2">
        {event && !spontaneous ? (
          <Link to={`/evenements/${event.id}`} className="min-w-0 truncate text-xs font-bold text-muted">
            ← {event.name.toUpperCase()}
          </Link>
        ) : spontaneous && playerId ? (
          <Link to={`/joueurs/${playerId}?onglet=avis`} className="text-xs font-bold text-muted">
            ← FICHE DU JOUEUR
          </Link>
        ) : (
          <Link to="/avis-spontanes" className="text-xs font-bold text-muted">
            ← PROPOSITIONS
          </Link>
        )}
        <span className="shrink-0 text-[11px] text-muted">
          Observateur : <b className="text-fg">{me}</b>
        </span>
      </div>

      {event && !spontaneous ? (
        <div>
          <h1 className="text-lg font-extrabold">{event.name}</h1>
          <div className="text-xs text-muted">
            {EVENT_TYPES.find((t) => t.value === event.type)?.label} · {fmtDate(event.date)}
            {event.place ? ` · ${event.place}` : ''}
          </div>
        </div>
      ) : spontaneous ? (
        <div className="card flex flex-col gap-2 p-3">
          <h1 className="text-lg font-extrabold">Avis spontané</h1>
          <SpontaneousContext draft={draft} setDraft={setDraft} validated={can.review(role)} />
        </div>
      ) : (
        <div className="card flex flex-col gap-3 p-4 text-xs">
          <h1 className="text-lg font-extrabold">Évaluer</h1>
          <p className="text-muted">
            Sur un match, un tournoi ou un stage : ouvre l’événement dans l’onglet <b className="text-fg">Événements</b>, puis « Évaluer ».
            Pour un joueur vu ailleurs (UNSS, club…) : <b className="text-fg">avis spontané</b>, depuis sa fiche ou ici.
          </p>
          <div className="flex gap-2">
            <Link to="/evenements" className="btn-primary flex-1">
              Événements
            </Link>
            <button className="btn-ghost flex-1" onClick={() => void go('contexte', 'libre')}>
              Avis spontané
            </button>
          </div>
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
              // Comme partout dans l'appli, le nom d'abord : « Dupont Jean » → nom Dupont, prénom Jean.
              const [lastName, ...rest] = q.trim().split(/\s+/)
              setProposing({ lastName, firstName: rest.join(' ') || undefined })
            }}
          />
        )}
        {/* Joueur hors liste de l'événement (supabase/021_avis_hors_liste.sql) : prévenir avant de noter. */}
        {event && player && !spontaneous && !(event.playerIds ?? []).includes(player.id) && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2.5 text-[11px] text-amber-100">
            {can.editEvent(role, event) || can.contributeEvent(role, event) ? (
              <>
                <b>Joueur hors liste.</b> Tu organises cet événement : en enregistrant ton avis, il sera ajouté à la liste.
              </>
            ) : (
              <>
                <b><Icon name="alert" className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />Joueur hors liste de l’événement.</b> Ton avis sera soumis à la décision de l’organisateur, d’un encadrant ou d’un
                administrateur : il ne comptera qu’une fois validé, et le joueur sera alors ajouté à la liste.
              </>
            )}
          </div>
        )}
        {!spontaneous && rosterFilter.active && fullRoster.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px]">
            <span>
              Filtre : <b>{[posLabel, rosterFilter.hideNoted && 'pas encore notés par moi'].filter(Boolean).join(' · ')}</b> —{' '}
              {roster.length} joueur{roster.length > 1 ? 's' : ''} sur {fullRoster.length}
            </span>
            <button
              className="shrink-0 font-bold text-accent"
              onClick={() => {
                rosterFilter.setPos('')
                rosterFilter.setHideNoted(false)
              }}
            >
              Tout afficher
            </button>
          </div>
        )}
        {roster.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <button className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap" disabled={!prev} onClick={() => prev && void changePlayer(prev, 'right')}>
              ←
            </button>
            <span className="text-center text-[11px] whitespace-nowrap text-muted">
              <b className="text-fg">{idx >= 0 ? `${idx + 1} / ${roster.length}` : `${roster.length} joueurs`}</b> ·{' '}
              {roster.filter((p) => evaluatedHere.has(p.id)).length} noté{roster.filter((p) => evaluatedHere.has(p.id)).length > 1 ? 's' : ''}
              {idx >= 0 && <span className="block text-[10px] font-normal">glisse ← → pour changer de joueur</span>}
            </span>
            <button className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap" disabled={idx >= 0 ? !next : false} onClick={() => void changePlayer(next ?? roster[0], 'left')}>
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
          {spontaneous && !can.review(role) ? ', en attente de validation par un encadrant' : ''}
          {existing?.review === 'pending' && !spontaneous ? ', en attente de validation (joueur hors liste)' : ''}.{' '}
          {nextTodo ? (
            <button className="font-bold underline" onClick={() => void go('joueur', nextTodo.id)}>
              Joueur suivant à noter : {playerName(nextTodo)} →
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
        {/* Fiche du joueur : suit le doigt pendant le glissement ; un nouveau joueur arrive du côté opposé au geste. */}
        <div
          key={player.id}
          ref={cardRef}
          style={{ touchAction: 'pan-y' }}
          className={`flex flex-col gap-4 ${enter?.id === player.id ? (enter.dir === 'left' ? 'animate-slide-left' : 'animate-slide-right') : ''}`}
        >
          {/* Voir la fiche du joueur (mesures, avis, maturité…) ; le bouton retour ramène ici. Sans poste, les encadrants
              et admins sont invités à la compléter directement. */}
          {!player.position && can.editPlayers(role) ? (
            <button
              data-noswipe
              className="self-start text-[11px] font-bold text-amber-300"
              onClick={async () => {
                if (!(await confirmLeave())) return
                navigate(`/joueurs/${player.id}/modifier?retour=${encodeURIComponent(location.pathname + location.search)}&ouvrir=poste`)
              }}
            >
              ✎ Pas de poste : compléter la fiche
            </button>
          ) : (
            <button
              data-noswipe
              className="flex items-center gap-1.5 self-start text-[11px] font-bold text-muted hover:text-fg"
              onClick={async () => {
                if (!(await confirmLeave())) return
                navigate(`/joueurs/${player.id}`)
              }}
            >
              <Icon name="user" className="h-3.5 w-3.5" />
              Voir la fiche
            </button>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold">
              {playerName(player)} <PosBadges p={player} /> <QuarterBadge birthDate={player.birthDate} />
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
        </div>
          {/* Enregistrer : toujours visible, collé au-dessus de la barre du bas (comme la fiche joueur) ; ne glisse pas avec la fiche. */}
          <div className="sticky bottom-[calc(52px+env(safe-area-inset-bottom))] z-10 -mx-4 flex items-center gap-2 border-t border-line bg-bg px-4 py-2">
            <button
              className="btn-primary flex-1"
              disabled={filled === 0 || (spontaneous && !draft.contextType) || (!!existing && !dirty)}
              onClick={() => void submit()}
            >
              {existing ? (dirty ? 'Mettre à jour' : 'Enregistré ✓') : 'Enregistrer'} · {filled} critère{filled > 1 ? 's' : ''}
            </button>
            {dirty ? (
              <button className="btn shrink-0 text-xs text-muted" onClick={revert} title="Oublier les modifications">
                Annuler
              </button>
            ) : (
              existing && (
                <button className="btn shrink-0 text-xs text-muted hover:text-red-400" onClick={() => void withdraw()}>
                  Retirer mon avis
                </button>
              )
            )}
          </div>
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
            Ton avis sera <b className="text-fg">soumis à validation</b> par un encadrant avant de compter dans les moyennes.
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
  const groups = useLiveQuery(() => loadTeams().then(() => db.groups.orderBy('name').toArray().then((gs) => alive(gs).filter((g) => !g.archived && can.seeGroup(g)))), [], [])
  const [group, setGroup] = useState(groupId ?? '')
  const picked = groups.find((g) => g.id === group)
  const [name, setName] = useState(event?.name ?? '')
  const [type, setType] = useState<EventType>(event?.type ?? 'match')
  const [date, setDate] = useState(event?.date ?? today())
  const [place, setPlace] = useState(event?.place ?? '')
  // Participants (supabase/024_participants_evenements.sql) : encadrants qui co-organisent.
  const [editors, setEditors] = useState<string[]>(event?.editors ?? [])
  // Staffs choisis (supabase/034) : leurs membres du moment co-organisent. Ceux que je ne vois pas restent tels quels.
  const [teams, setTeams] = useState<string[]>(event?.teams ?? [])
  const canPick = useCanPickStaff()
  const [staffNames, setStaffNames] = useState<Record<string, string>>({})
  const chip = (on: boolean) =>
    `rounded-md border px-2.5 py-1.5 text-xs font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-fg'}`
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
              Joueurs : groupe {g.name}{groupTag(g)} ({g.playerIds.length})
            </option>
          ))}
        </select>
      )}
      {canPick && (
        <>
          <span className="label mt-1">Participants</span>
          <p className="-mt-1 text-[11px] text-muted">
            Encadrants qui co-organisent : ils ajoutent des joueurs à la liste, retirent ceux qu’ils ont ajoutés et valident les avis hors liste.
            Modifier, archiver ou supprimer l’événement reste à toi (et aux administrateurs).
          </p>
          <StaffPicker
            value={editors}
            onChange={setEditors}
            teams={teams}
            onTeams={setTeams}
            ownerId={event?.createdBy}
            onNames={setStaffNames}
            chip={chip}
          />
        </>
      )}
      <div className="flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={!name.trim()}
          onClick={async () => {
            const fields = {
              name: name.trim(),
              type,
              date,
              place: place || undefined,
              editors,
              teams: teams.length ? teams : undefined,
              names: { ...event?.names, ...Object.fromEntries(editors.filter((u) => staffNames[u]).map((u) => [u, staffNames[u]])) },
            }
            // Relit l'événement au moment d'enregistrer : la liste des joueurs a pu changer entre-temps.
            const current = event && (await db.events.get(event.id))
            onDone(
              await save<HBEvent>(
                'events',
                current
                  ? { ...current, ...fields }
                  : {
                      id: newId(),
                      ...fields,
                      playerIds: picked ? [...picked.playerIds] : undefined,
                      // Depuis un groupe : chaque joueur garde celui qui l'avait ajouté au groupe.
                      addedBy: picked?.addedBy ? { ...picked.addedBy } : undefined,
                      names: { ...picked?.names, ...fields.names },
                    },
              ),
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
  const [everywhere, setEverywhere] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => setActive(0), [q, everywhere])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  const selected = players.find((p) => p.id === value)
  if (selected && !q)
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          <b>
            {playerName(selected)}
          </b>
          {selected.club && <span className="text-[11px] text-muted"> · {selected.club}</span>}
        </span>
        <button className="shrink-0 text-xs font-bold text-accent" onClick={() => onChange('')}>
          Changer
        </button>
      </div>
    )
  const words = fold(q).split(/\s+/).filter(Boolean)
  const hit = (p: Player) => {
    const hay = fold(`${p.firstName} ${p.lastName} ${p.club ?? ''} ${p.license ?? ''}`)
    return words.every((w) => hay.includes(w))
  }
  // Événement avec une liste de joueurs : la recherche se fait dans cette liste ; toute la base sur demande.
  const inRoster = roster.length > 0 && !everywhere
  // Sans recherche : la liste de l'événement, sinon les joueurs déjà évalués ici.
  const matches = (
    words.length ? (inRoster ? roster : players).filter(hit) : roster.length ? roster : players.filter((p) => done.has(p.id))
  ).slice(0, words.length && !inRoster ? 20 : Math.max(20, roster.length))
  return (
    <div className="flex flex-col gap-1">
      <input
        className="field"
        placeholder={roster.length && !everywhere ? 'Chercher dans les joueurs de l’événement…' : 'Nom, prénom, club ou licence…'}
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
      {words.length > 0 && matches.length === 0 && (
        <p className="text-[11px] text-muted">{inRoster ? 'Aucun joueur de l’événement ne correspond.' : 'Aucun joueur trouvé.'}</p>
      )}
      {roster.length > 0 && words.length > 0 && (
        <button className="self-start text-xs font-bold text-accent" onClick={() => setEverywhere(!everywhere)}>
          {everywhere ? '← Chercher seulement dans les joueurs de l’événement' : 'Chercher dans toute la base (joueur hors liste)…'}
        </button>
      )}
      {words.length > 0 && (!roster.length || everywhere) && (
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
  return JSON.stringify([scores, d.minutesObserved ?? null, txt(d.strengths), txt(d.improvements), d.date ?? '', d.contextType ?? '', txt(d.contextPlace)])
}
