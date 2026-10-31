import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CriterionInput, groupBy, Icon, NoCriteria, NumberField, playerName, PosBadge, PosBadges, ProposedTag, QuarterBadge, Segmented, useMe } from '../components/ui'
import { can, currentUserId, groupTag, useRole } from '../roles'
import { loadTeams } from '../teams'
import { ask, choose, setLeaveGuard, useUnsaved } from '../components/Confirm'
import { ProposePlayer } from '../components/ProposePlayer'
import { useSwipeNav } from '../components/useSwipeNav'
import { eventSections, filterRoster, groupRoster, sortRoster, useRosterFilter, useRosterGroup, useRosterSort, type RosterGroup } from '../rosterOrder'
import { ReviewBadge, ReviewNote } from '../components/Review'
import { fold } from './Players'
import { BackButton } from '../backNav'
import { StaffPicker, useCanPickStaff } from '../components/StaffPicker'
import { OrganizerField, type OrganizerValue } from '../components/OrganizerField'
import { supabase, useSyncState } from '../sync'
import { MQ, useMedia } from '../layout'
import { ItemMenu, MenuButton, useRowMenu } from '../components/ItemMenu'
import { accord, genderOf, pluralG, setGender, SEX_CHOICES, SEX_LABELS, w, type Gender } from '../gender'
import { setRatingFocus } from '../focusMode'
import { AvisVocal, CommentProposal, SuggestionNote } from '../components/AvisVocal'
import { decide, decideAll, mergeComment, pendingSuggestion, type AvisState } from '../dictation/avis'
import { withPoleMembers } from '../poleMembers'
import { usePlayersByName } from '../playersCache'
import { scoreLegend } from '../sportContent'
import { FormActions } from '../components/FormWindow'
import type { EventDraft } from '../eventCopy'
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

/** Liste vide stable (fiches pas encore lues). */
const NO_PLAYERS: Player[] = []

/**
 * Saisie d'un avis subjectif. Les avis des autres observateurs ne sont pas
 * affichés ici, pour ne pas influencer la notation.
 * L'avis porte sur un événement, ou c'est un avis spontané (?contexte=libre) : joueur vu ailleurs
 * (UNSS, entraînement de club…). L'avis spontané d'un observateur attend la validation d'un encadrant ;
 * ?avis=<id> rouvre un avis spontané pour le modifier.
 */
export default function Evaluate() {
  const [params, setParams] = useSearchParams()
  const sideScreen = useMedia(MQ.side)
  // Ordinateur ou téléphone couché : liste des joueurs de l'événement à gauche, fiche d'évaluation à droite.
  const split = useMedia(MQ.split)
  const listModeRef = useRef(false)
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
  // Menu « ⋮ » de l'avis (« Annuler mes modifications », « Retirer mon avis »), loin du bouton « Enregistrer / Suivant ».
  const avisMenu = useRowMenu()

  // Fiches par nom, gardées en mémoire (src/playersCache.ts).
  const players = usePlayersByName() ?? NO_PLAYERS
  const events = useLiveQuery(() => db.events.orderBy('date').reverse().toArray().then(alive), [], [])
  const criteria = useLiveQuery(
    () => db.criteria.orderBy('order').toArray().then((cs) => alive(cs).filter((c) => c.active && c.kind === 'subjective')),
    [],
    [],
  )
  // Aucun critère d'observation dans la base (non livrés avec l'appli) : message plutôt qu'une fiche vide.
  const noCriteria = useLiveQuery(() => db.criteria.filter((c) => !c.deleted && c.active && c.kind === 'subjective').count().then((n) => n === 0), [], false)
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
  // Un joueur à noter : menu du bas caché sur téléphone tenu droit (src/focusMode.ts, App.tsx).
  const rating = !!player
  useEffect(() => {
    if (!rating) return
    setRatingFocus(true)
    return () => setRatingFocus(false)
  }, [rating])
  const event = events.find((e) => e.id === eventId)
  const own = useLiveQuery(() => (avisId ? db.evaluations.get(avisId) : undefined), [avisId])
  const existing = spontaneous
    ? own && !own.deleted && own.playerId === playerId ? own : undefined
    : mine.find((e) => e.playerId === playerId && (e.eventId ?? '') === eventId && !e.contextType)

  const [draft, setDraft] = useState<Partial<Evaluation>>({ scores: {} })
  // « Avis vocal » : notes et commentaires PROPOSÉS, pas encore acceptés (jamais enregistrés tels quels).
  const [avis, setAvis] = useState<AvisState | null>(null)
  // Place du micro de l'avis vocal, à droite de « Enregistrer » (AvisVocal y rend son bouton).
  const [micSlot, setMicSlot] = useState<HTMLSpanElement | null>(null)
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
    setAvis(null)
    // Liste à gauche : le joueur choisi s'affiche depuis le haut de sa fiche.
    if (listModeRef.current && window.scrollY > 0) window.scrollTo({ top: 0 })
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
  // Glisser pour changer de joueur (src/components/useSwipeNav.ts, même geste que la fiche ouverte depuis une liste) :
  // déclaré ici, avant l'écran « Qui évalue ? », car un hook doit être appelé à chaque affichage, dans le même ordre.
  const swipeNav = useSwipeNav(playerId)
  const cardRef = swipeNav.cardRef

  // Ordre de la liste de l'événement : le même que sur la page de l'événement (par poste, puis « Nom » par défaut).
  const [rosterSort] = useRosterSort(eventId || undefined)
  const [rosterGroup] = useRosterGroup(eventId || undefined)
  // Filtres posés sur la page de l'événement (un poste, masquer ceux que j'ai notés) : on ne note que ces joueurs-là.
  const rosterFilter = useRosterFilter(eventId || undefined)
  useEffect(() => {
    setLeaveGuard(() => leaveRef.current())
    return () => setLeaveGuard(null)
  }, [])
  useUnsaved(dirty)

  // Notes proposées par l'avis vocal pour ce joueur : leurs critères s'affichent aussi en mode rapide.
  const proposed = avis && avis.playerId === playerId ? avis.pending : null
  const shown = useMemo(
    () =>
      criteria.filter(
        (c) => criterionApplies(c, player?.position) && (mode === 'complet' || c.quick || draft.scores?.[c.id] !== undefined || !!proposed?.includes(c.id)),
      ),
    [criteria, player, mode, draft.scores, proposed],
  )

  // ----- Étape 0 : qui évalue ? -----
  if (!me)
    return (
      <div className="mx-auto flex max-w-sm flex-col gap-3 pt-10">
        <h1 className="text-lg font-extrabold">Qui évalue ?</h1>
        <p className="text-xs text-muted">Ton nom sera associé à tes avis pour pouvoir les comparer à ceux des autres membres du staff.</p>
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

  /** Note d'un critère choisie par le coach ; une note proposée pour ce critère est alors acceptée ou remplacée. */
  function setScore(id: string, v: number | string | undefined) {
    setDraft((d) => {
      const scores = { ...(d.scores ?? {}) }
      if (isFilled(v)) scores[id] = v!
      else delete scores[id]
      return { ...d, scores }
    })
    setAvis((a) => (a && a.pending.includes(id) ? decide(a, id, { value: isFilled(v) ? v : undefined }) : a))
  }

  /** « Tout accepter » : les notes proposées encore en attente et les commentaires proposés (à relire avant d'enregistrer). */
  function acceptAllAvis() {
    if (!avis || avis.playerId !== playerId) return
    const a = avis
    setDraft((d) => {
      const scores = { ...(d.scores ?? {}) }
      for (const s of a.result.suggestions) if (a.pending.includes(s.criterionId)) scores[s.criterionId] = s.value
      return {
        ...d,
        scores,
        ...(a.strengths && { strengths: mergeComment(d.strengths, a.result.pointsForts) }),
        ...(a.improvements && { improvements: mergeComment(d.improvements, a.result.axes) }),
      }
    })
    setAvis(decideAll(a, 'accepte'))
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
  // Événement réparti en équipes : l'ordre par équipe choisi sur la page de l'événement.
  const fullRoster = groupRoster(
    sortRoster(
      (event?.playerIds ?? []).map((id) => byId.get(id)).filter((p): p is Player => !!p),
      rosterSort,
    ),
    event,
    rosterGroup,
  )
  // Le joueur en cours reste dans la liste même s'il vient d'être noté (sinon « → » ne saurait plus où il en est).
  const roster = filterRoster(fullRoster, rosterFilter, evaluatedHere, playerId)
  const posLabel = POSITIONS.find((x) => x.id === rosterFilter.pos)?.label
  // Accord au genre (src/gender.ts) : la personne évaluée (pw) ; la liste de l'événement (eg : déclaré, sinon déduit).
  const pw = w(player?.sex)
  const eg = setGender(event?.sex, fullRoster)
  const ew = w(eg)
  const idx = roster.findIndex((p) => p.id === playerId)
  const prev = idx > 0 ? roster[idx - 1] : undefined
  const next = idx >= 0 && idx < roster.length - 1 ? roster[idx + 1] : undefined
  const nextTodo = roster.slice(idx + 1).find((p) => !evaluatedHere.has(p.id)) ?? roster.find((p) => !evaluatedHere.has(p.id) && p.id !== playerId)
  const filled = Object.values(draft.scores ?? {}).filter(isFilled).length
  // Liste des joueurs à gauche (ordinateur, téléphone couché) : seulement pour un événement qui a une liste.
  const listMode = split && !spontaneous && !!event && fullRoster.length > 0
  listModeRef.current = listMode
  const inList = !!player && !!event && (event.playerIds ?? []).includes(player.id)

  // Glisser vers la gauche : joueur suivant ; vers la droite : précédent (liste de l'événement). La fiche suit le doigt ;
  // au lâcher, elle part sur le côté et le joueur suivant arrive de l'autre côté, ou elle revient en place si le geste est
  // trop court (src/components/useSwipeNav.ts). Avis pas enregistré : la question est posée avant de partir.
  const canSwipe = !spontaneous && roster.length > 0 && idx >= 0
  const swipe = swipeNav.handlers({ enabled: canSwipe, prev: prev?.id, next: next?.id, go: (id) => go('joueur', id), hold: () => dirty })
  const changePlayer = (target: Player, dir: 'left' | 'right') => swipe.change(target.id, dir)

  // Ordinateur, un joueur ouvert : joueur et contexte à gauche, grille de notation à droite.
  // Ailleurs, les deux blocs s'effacent (display: contents) : même colonne qu'avant.
  const duo = sideScreen && !!player && !!(event || spontaneous) && !listMode
  const head = (
      <div className={duo ? 'sticky top-[calc(var(--hdr)+1.25rem)] flex flex-col gap-4' : 'contents'}>
      {/* Plus d'onglet « Évaluer » : on arrive ici depuis un événement, une fiche joueur ou Propositions. */}
      {!listMode && (
      <div className="flex items-center justify-between gap-2">
        {/* Retour d'où l'on vient (événement, fiche dans l'événement, fiche, propositions…) ; sans historique : le parent. */}
        {event && !spontaneous ? (
          <BackButton fallback={`/evenements/${event.id}`} label={event.name.toUpperCase()} />
        ) : spontaneous && playerId ? (
          <BackButton fallback={`/joueurs/${playerId}?onglet=avis`} label={`FICHE ${player ? pw.duJoueur.toUpperCase() : 'DU JOUEUR'}`} />
        ) : (
          <BackButton fallback="/avis-spontanes" label="PROPOSITIONS" />
        )}
        <span className="shrink-0 text-[11px] text-muted">
          Avis de : <b className="text-fg">{me}</b>
        </span>
      </div>
      )}

      {listMode ? null : event && !spontaneous ? (
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

      {/* Joueur (liste à gauche : seulement pour choisir un joueur hors liste, ou s'il en est un) */}
      {(event || spontaneous) && (!listMode || !player || !!proposing || !inList) && (
      <div className="card flex flex-col gap-2 p-3">
        <span className="label">{listMode && !player ? `${ew.Joueur} hors liste` : player ? pw.Joueur : ew.Joueur}</span>
        {listMode && !player && !proposing && (
          <p className="-mt-1 text-[11px] text-muted">Choisis {ew.unJoueur} dans la liste, ou cherche ici {ew.unJoueur} {accord('absent', eg)} de la liste de l’événement.</p>
        )}
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
            searchOnly={listMode}
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
                <b>{pw.Joueur} hors liste.</b> Tu organises cet événement : en enregistrant ton avis, {pw.il} sera {pw.ajoute} à la liste.
              </>
            ) : (
              <>
                <b><Icon name="alert" className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />{pw.Joueur} hors liste de l’événement.</b> Ton avis sera soumis à la décision de l’organisateur, d’un encadrant ou d’un
                administrateur : il ne comptera qu’une fois validé, et {pw.leJoueur} sera alors {pw.ajoute} à la liste.
              </>
            )}
          </div>
        )}
        {!spontaneous && !listMode && rosterFilter.active && fullRoster.length > 0 && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px]">
            <span>
              Filtre : <b>{[posLabel, rosterFilter.hideNoted && `${accord('pas encore noté', eg, 2)} par moi`].filter(Boolean).join(' · ')}</b> —{' '}
              {pluralG(roster.length, eg)} sur {fullRoster.length}
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
        {roster.length > 0 && !listMode && (
          <div className="flex items-center justify-between gap-2">
            <button className="btn-ghost px-3 py-1.5 text-xs whitespace-nowrap" disabled={!prev} onClick={() => prev && void changePlayer(prev, 'right')}>
              ←
            </button>
            <span className="text-center text-[11px] whitespace-nowrap text-muted">
              <b className="text-fg">{idx >= 0 ? `${idx + 1} / ${roster.length}` : pluralG(roster.length, eg)}</b> ·{' '}
              {roster.filter((p) => evaluatedHere.has(p.id)).length} {accord('noté', eg, roster.filter((p) => evaluatedHere.has(p.id)).length)}
              {idx >= 0 && <span className="block text-[10px] font-normal">glisse ← → pour changer de {ew.joueur}</span>}
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
          {existing?.review === 'pending' && !spontaneous ? `, en attente de validation (${pw.joueur} hors liste)` : ''}.{' '}
          {nextTodo ? (
            <button className="font-bold underline" onClick={() => void go('joueur', nextTodo.id)}>
              {accord('Joueur suivant', nextTodo.sex)} à noter : {playerName(nextTodo)} →
            </button>
          ) : roster.length ? (
            <b>{ew.TousLesJoueurs} de la liste sont {accord('noté', eg, 2)}.</b>
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

      </div>
  )

  const sheet = player && (event || spontaneous) && (
        <div className={duo ? 'flex flex-col gap-4' : 'contents'}>
        {/* Fiche du joueur : suit le doigt pendant le glissement ; un nouveau joueur arrive du côté opposé au geste. */}
        <div
          key={player.id}
          ref={cardRef}
          style={{ touchAction: 'pan-y' }}
          className={`flex flex-col ${listMode ? 'gap-3 rail:gap-2' : 'gap-4'}`}
        >
          {/* Voir la fiche du joueur (mesures, avis, maturité…) ; le bouton retour ramène ici. Sans poste, les encadrants
              et admins sont invités à la compléter directement. */}
          {listMode ? null : !player.position && can.editPlayers(role) ? (
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
          <div className={`flex items-center justify-between ${listMode ? 'gap-2' : ''}`}>
            <div className={`flex items-center gap-2 text-sm font-bold ${listMode ? 'min-w-0 flex-wrap' : ''}`}>
              {playerName(player)} <PosBadges p={player} /> <QuarterBadge birthDate={player.birthDate} />
              {/* Liste à gauche : en-tête compact, « Voir la fiche » sur la ligne du nom. */}
              {listMode && (
                <button
                  data-noswipe
                  className={`flex items-center gap-1 text-[11px] font-bold ${!player.position && can.editPlayers(role) ? 'text-amber-300' : 'text-muted hover:text-fg'}`}
                  onClick={async () => {
                    if (!(await confirmLeave())) return
                    navigate(
                      !player.position && can.editPlayers(role)
                        ? `/joueurs/${player.id}/modifier?retour=${encodeURIComponent(location.pathname + location.search)}&ouvrir=poste`
                        : `/joueurs/${player.id}`,
                    )
                  }}
                >
                  <Icon name="user" className="h-3.5 w-3.5" />
                  {!player.position && can.editPlayers(role) ? 'Compléter le poste' : 'Voir la fiche'}
                </button>
              )}
            </div>
            <div className={`flex items-center gap-1 ${listMode ? 'shrink-0' : ''}`}>
              {/* Avec le « ⋮ » : bascule un peu plus étroite, pour tenir en 360 px de large. */}
              <div className={listMode ? 'w-36 shrink-0' : existing ? 'w-40' : 'w-44'}>
                <Segmented
                  look="capsule"
                  label="Fiche rapide ou complète"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'rapide', label: 'Rapide' },
                    { value: 'complet', label: 'Complet' },
                  ]}
                />
              </div>
              {(existing || dirty) && (
                <span data-noswipe className="contents">
                  <MenuButton label="Autres actions sur mon avis" open={!!avisMenu.anchor} className="-mr-2" onOpen={avisMenu.open} />
                </span>
              )}
            </div>
          </div>
          {(existing || dirty) && avisMenu.anchor && (
            <ItemMenu
              anchor={avisMenu.anchor}
              title={`Mon avis sur ${playerName(player)}`}
              items={[
                // « Annuler » n'est plus dans la barre du bas (Enregistrer + micro seulement, 31/10) : ici, avec « Retirer ».
                ...(dirty ? [{ label: 'Annuler mes modifications', icon: 'undo' as const, onSelect: revert }] : []),
                ...(existing ? [{ label: 'Retirer mon avis', icon: 'trash' as const, danger: true, onSelect: () => void withdraw() }] : []),
              ]}
              onClose={avisMenu.close}
            />
          )}
          {existing && !saved && (
            <div className="text-[11px] text-muted">
              {spontaneous ? (
                <span className="flex flex-wrap items-center gap-2">
                  Tu modifies ton avis spontané du {fmtDate(existing.date)}. <ReviewBadge e={existing} />
                </span>
              ) : (
                `Tu as déjà ${pw.evalue} ${pw.ceJoueur} ici : tu modifies ton avis.`
              )}
              {spontaneous && <ReviewNote e={existing} />}
              {spontaneous && existing.review && existing.review !== 'pending' && !can.review(role) && (
                <div className="mt-1 text-amber-200">Si tu le modifies, il repassera en attente de validation.</div>
              )}
            </div>
          )}
          {/* Repères de l'échelle du sport (src/sportContent.ts) ; handball : « 1 = très insuffisant · 3 = niveau attendu · 5 = remarquable ». */}
          <div className="text-[11px] text-muted">{scoreLegend()}. Laisse vide ce que tu n'as pas vu.</div>
          <AvisVocal
            playerId={player.id}
            position={player.position}
            criteria={criteria}
            current={draft}
            state={avis}
            setState={setAvis}
            acceptAll={acceptAllAvis}
            slot={micSlot}
          />

          {noCriteria && <NoCriteria kind="subjective" />}
          {groupBy(shown, (c) => c.category).map(([cat, cs]) => (
            <div key={cat} className="card p-3">
              <div className="section-title">{cat}</div>
              <div className="flex flex-col gap-3">
                {cs.map((c) => {
                  const sug = pendingSuggestion(avis, player.id, c.id)
                  return (
                    // Notes toujours sous le libellé : alignées de la même façon d'un critère à l'autre.
                    <div key={c.id} className="flex flex-col items-stretch gap-1.5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-bold">
                          {c.label}
                          {sug && <ProposedTag />}
                        </div>
                        {c.description && <div className="text-[10px] text-muted">{c.description}</div>}
                      </div>
                      <CriterionInput c={c} value={draft.scores?.[c.id]} suggested={sug?.value} wide onChange={(v) => setScore(c.id, v)} />
                      {sug && (
                        <SuggestionNote s={sug} onDismiss={() => setAvis((a) => a && decide(a, c.id, 'ignore'))} />
                      )}
                    </div>
                  )
                })}
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
              {avis?.playerId === player.id && avis.strengths && (
                <CommentProposal
                  text={avis.result.pointsForts}
                  onAdd={() => {
                    setDraft((d) => ({ ...d, strengths: mergeComment(d.strengths, avis.result.pointsForts) }))
                    setAvis((a) => a && { ...a, strengths: false })
                  }}
                  onDismiss={() => setAvis((a) => a && { ...a, strengths: false })}
                />
              )}
              <textarea className="field min-h-14" value={draft.strengths ?? ''} onChange={(e) => setDraft((d) => ({ ...d, strengths: e.target.value }))} />
            </div>
            <div>
              <span className="label">Axes de progression</span>
              {avis?.playerId === player.id && avis.improvements && (
                <CommentProposal
                  text={avis.result.axes}
                  onAdd={() => {
                    setDraft((d) => ({ ...d, improvements: mergeComment(d.improvements, avis.result.axes) }))
                    setAvis((a) => a && { ...a, improvements: false })
                  }}
                  onDismiss={() => setAvis((a) => a && { ...a, improvements: false })}
                />
              )}
              <textarea className="field min-h-14" value={draft.improvements ?? ''} onChange={(e) => setDraft((d) => ({ ...d, improvements: e.target.value }))} />
            </div>
          </div>

          {spontaneous && !draft.contextType && <div className="text-[11px] text-amber-200">Indique le contexte (UNSS, entraînement club…) en haut de l’écran.</div>}
        </div>
          {/* Enregistrer : toujours visible, collé au-dessus de la barre du bas (comme la fiche joueur), ou tout en bas sur téléphone
              tenu droit, où le menu est caché pendant la notation (App.tsx) ; ne glisse pas avec la fiche. */}
          <div className={`save-bar sticky bottom-[var(--nav-b)] z-10 flex flex-col gap-1 border-t border-line bg-bg py-2 ${listMode ? '-mx-2 px-2' : '-mx-4 px-4'}`}>
          <div className="flex items-center gap-2">
            {existing && !dirty && nextTodo ? (
              // Avis enregistré et rien de modifié : le bouton principal passe au joueur suivant à noter.
              <button className="btn-save min-w-0 flex-1" onClick={() => void go('joueur', nextTodo.id)}>
                <span className="truncate">
                  Suivant : {nextTodo.firstName} {(nextTodo.lastName ?? '').charAt(0).toUpperCase()}
                  {nextTodo.lastName ? '.' : ''} →
                </span>
              </button>
            ) : (
              <button
                className="btn-save flex-1"
                disabled={filled === 0 || (spontaneous && !draft.contextType) || (!!existing && !dirty)}
                onClick={() => void submit()}
              >
                <span aria-hidden>✓</span>
                {existing ? (dirty ? 'Mettre à jour' : 'Enregistré') : 'Enregistrer'} · {filled} critère{filled > 1 ? 's' : ''}
              </button>
            )}
            {/* Micro de l'avis vocal (src/components/AvisVocal.tsx), à droite. */}
            <span ref={setMicSlot} className="contents" />
          </div>
          <OfflineNote show={dirty || !!existing} />
          </div>
        </div>
  )

  const touch = swipe.touch
  if (listMode && event)
    return (
      <div className="grid items-start gap-5 rail:gap-2" style={{ gridTemplateColumns: 'minmax(0, var(--md-col)) minmax(0, 1fr)' }} {...touch}>
        <RosterList
          event={event}
          g={eg}
          me={me}
          roster={roster}
          total={fullRoster.length}
          noted={fullRoster.filter((p) => evaluatedHere.has(p.id)).length}
          value={playerId}
          done={evaluatedHere}
          dirty={dirty}
          filter={rosterFilter}
          group={rosterGroup}
          posLabel={posLabel}
          onPick={(id) => void go('joueur', id)}
          onOther={() => void go('joueur', '')}
        />
        <div className="flex min-w-0 flex-col gap-3">
          {head}
          {sheet}
        </div>
      </div>
    )
  return (
    <div
      // Téléphone couché : la page est élargie pour la liste (App.tsx) ; sans liste, la colonne reste celle d'avant.
      className={`flex flex-col gap-4 rail:mx-auto rail:w-full rail:max-w-2xl ${duo ? 'side:grid side:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] side:items-start side:gap-6' : 'side:mx-auto side:w-full side:max-w-2xl'}`}
      {...touch}
    >
      {head}
      {sheet}
    </div>
  )
}

/**
 * Liste des joueurs de l'événement (ordinateur, téléphone couché) : même ordre que la notation, repère
 * « noté par moi », joueur en cours surligné et toujours visible. Choisir un joueur passe par `go`
 * (confirmation si l'avis en cours n'est pas enregistré).
 */
function RosterList({
  event,
  g,
  me,
  roster,
  total,
  noted,
  value,
  done,
  dirty,
  filter,
  group,
  posLabel,
  onPick,
  onOther,
}: {
  event: HBEvent
  /** Genre de la liste (src/gender.ts). */
  g: Gender
  me: string
  roster: Player[]
  total: number
  noted: number
  value: string
  done: Set<string>
  dirty: boolean
  filter: ReturnType<typeof useRosterFilter>
  /** Événement réparti en équipes : rangement choisi sur sa page (bandeaux d'équipe). */
  group: RosterGroup
  posLabel?: string
  onPick: (id: string) => void
  onOther: () => void
}) {
  const [q, setQ] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  // Rotation (ordinateur ↔ téléphone couché) : la hauteur de la liste change, on recadre le joueur en cours.
  const rail = useMedia(MQ.rail)
  const words = fold(q).split(/\s+/).filter(Boolean)
  const items = words.length ? roster.filter((p) => words.every((w) => fold(`${p.firstName} ${p.lastName} ${p.club ?? ''}`).includes(w))) : roster
  // Joueur en cours : gardé visible dans la liste (sans faire défiler la page).
  useEffect(() => {
    const box = boxRef.current
    const el = box?.querySelector<HTMLElement>(`[data-pid="${CSS.escape(value)}"]`)
    if (!box || !el) return
    const top = el.offsetTop - box.offsetTop
    if (top < box.scrollTop) box.scrollTop = top - 4
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 4
  }, [value, items.length, rail])
  /** ↑ ↓ dans la liste : joueur précédent / suivant. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const t = e.target as HTMLElement
    if (!t.dataset.pid) return
    const btns = [...(boxRef.current?.querySelectorAll<HTMLElement>('[data-pid]') ?? [])]
    const nxt = btns[btns.indexOf(t) + (e.key === 'ArrowDown' ? 1 : -1)]
    e.preventDefault()
    if (!nxt) return
    nxt.focus()
    onPick(nxt.dataset.pid!)
  }
  return (
    <aside
      data-noswipe
      aria-label={`${w(g).Joueurs} de l’événement`}
      className="sticky top-[calc(var(--hdr)+1.25rem)] flex max-h-[calc(100dvh-var(--hdr)-2.5rem)] min-w-0 flex-col gap-2 rounded-xl border border-line bg-panel p-2.5 rail:top-[calc(var(--hdr)+0.5rem)] rail:max-h-[calc(100dvh-var(--hdr)-1rem)] rail:gap-1.5 rail:p-1.5"
    >
      <div className="min-w-0">
        <BackButton fallback={`/evenements/${event.id}`} label={event.name} className="block w-full hover:text-fg" />
        <div className="truncate text-[10px] text-muted rail:hidden">
          {EVENT_TYPES.find((t) => t.value === event.type)?.label} · {fmtDate(event.date)}
          {event.place ? ` · ${event.place}` : ''} · Avis de : <b className="text-fg">{me}</b>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="whitespace-nowrap">
          <b className={noted === total ? 'text-emerald-300' : ''}>
            {noted} / {total}
          </b>{' '}
          <span className="text-muted">{accord('noté', g, noted)}</span>
        </span>
        {(noted > 0 || filter.hideNoted) && (
          <label className="flex min-w-0 cursor-pointer items-center gap-1 text-[10px] text-muted">
            <input type="checkbox" className="accent-accent" checked={filter.hideNoted} onChange={(e) => filter.setHideNoted(e.target.checked)} />
            <span className="truncate">Masquer les {accord('noté', g, 2)}</span>
          </label>
        )}
      </div>
      {filter.pos && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-[10px]">
          <span className="min-w-0 truncate">
            Poste : <b>{posLabel}</b>
          </span>
          <button className="shrink-0 font-bold text-accent" onClick={() => filter.setPos('')}>
            Tout afficher
          </button>
        </div>
      )}
      {roster.length > 12 && (
        <input
          type="search"
          className="field py-1 text-xs"
          placeholder={`Chercher ${w(g).unJoueur}…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQ('')
            else if (e.key === 'Enter' && items[0]) {
              e.preventDefault()
              onPick(items[0].id)
            }
          }}
        />
      )}
      <div ref={boxRef} className="-mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto overscroll-contain px-1 pb-1" onKeyDown={onKeyDown}>
        {/* Découpage de la page de l'événement (eventSections) : par équipe (bandeau) puis poste, sinon par poste ; les joueurs dans l'ordre de notation. */}
        {eventSections(items, event, group)
          .map((sec, si) => (
            <div key={si} className="flex flex-col gap-1">
              {sec.heading && sec.team && (
                <div
                  className={`mt-2 truncate rounded border-l-4 bg-panel-2 px-1.5 py-1 text-[11px] font-extrabold tracking-wide uppercase first:mt-0.5 ${sec.mine ? 'border-accent text-accent' : 'border-fg/40'}`}
                >
                  {sec.heading}
                  {sec.mine && <span className="ml-1.5 rounded bg-accent px-1 align-middle text-[9px] text-white normal-case">mon équipe</span>}
                </div>
              )}
              {sec.heading && !sec.team && <div className="section-title mt-1.5 mb-0 px-0.5 text-[10px]">{sec.heading}</div>}
              {sec.sub && <div className="mt-0.5 px-0.5 text-[10px] font-bold tracking-wide text-muted uppercase">{sec.sub}</div>}
              {sec.players.map((p) => {
                const on = p.id === value
                const ok = done.has(p.id)
                return (
                  <button
                    key={p.id}
                    data-pid={p.id}
                    aria-current={on || undefined}
                    title={ok ? `${accord('Noté', p.sex)} par moi` : `Pas encore ${w(p.sex).note} par moi`}
                    onClick={() => !on && onPick(p.id)}
                    className={`card flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-xs transition rail:py-1 ${
                      on ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'hover:border-accent'
                    }`}
                  >
                    {ok ? (
                      <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-300" />
                    ) : (
                      <span className="m-px h-3.5 w-3.5 shrink-0 rounded-full border border-muted/60" />
                    )}
                    <span className={`min-w-0 flex-1 truncate font-bold ${ok && !on ? 'text-muted' : ''}`}>
                      {p.lastName.toUpperCase()} {p.firstName}
                      {on && dirty && <span className="text-amber-300" title="Saisie non enregistrée"> •</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <PosBadge pos={p.position} />
                      <QuarterBadge birthDate={p.birthDate} />
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        {words.length > 0 && items.length === 0 && <p className="px-1 py-2 text-[11px] text-muted">{w(g).AucunJoueur} ne correspond.</p>}
      </div>
      <button className="self-start px-1 text-[11px] font-bold text-accent" onClick={onOther}>
        + {w(g).Joueur} hors liste…
      </button>
    </aside>
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
        Pour un joueur vu hors des événements prévus : UNSS, entraînement de club, match local, ou en vidéo…{' '}
        {validated ? (
          <>Ton avis est validé d’office.</>
        ) : (
          <>
            Ton avis sera <b className="text-fg">soumis à validation</b> par un encadrant avant de compter dans les moyennes.
          </>
        )}
      </p>
      <Segmented<ContextType>
        look="capsule"
        label="Contexte de l’avis spontané"
        value={draft.contextType}
        onChange={(v) => setDraft((d) => ({ ...d, contextType: v }))}
        options={CONTEXT_TYPES}
        columns={2}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          className="field"
          placeholder={draft.contextType === 'video' ? 'Vidéo vue (Rematch, YouTube, match…)' : 'Lieu, établissement, club…'}
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

/**
 * Création d'un événement, ou modification de `event` (nom, type, date, lieu). `extra` : actions rangées au bas du
 * formulaire de modification (ex. « + Importer une feuille de match (PDF) » sur la page de l'événement).
 * `copy` : création pré-remplie par « Dupliquer l'événement » (src/eventCopy.ts) : champs, liste des joueurs et équipes
 * copiés, enregistrés comme une création normale à « Créer ».
 * Boutons dans <FormActions> : dans le pied de la fenêtre (src/components/FormWindow.tsx), sinon sous le formulaire.
 */
export function NewEventForm({
  event,
  groupId,
  playerIds,
  copy,
  onDone,
  extra,
}: {
  event?: HBEvent
  groupId?: string
  /** Création avec ces joueurs déjà dans la liste (sélection multiple d'une liste de joueurs) ; sexe déduit d'eux. */
  playerIds?: string[]
  /** Création à partir d'une copie (« Dupliquer l'événement »). */
  copy?: EventDraft
  onDone: (ev?: HBEvent) => void
  extra?: ReactNode
}) {
  const from = event ? undefined : copy
  // À la création : la liste de l'événement peut partir d'un groupe (copie, modifiable ensuite). Groupe Pôle : ses membres
  // en cours, calculés depuis les fiches (src/poleMembers.ts ; copie jamais enregistrée comme groupe).
  const groups = useLiveQuery(() => loadTeams().then(() => db.groups.orderBy('name').toArray().then((gs) => withPoleMembers(alive(gs).filter((g) => !g.archived && can.seeGroup(g))))), [], [])
  const [group, setGroup] = useState(groupId ?? '')
  const picked = groups.find((g) => g.id === group)
  const init = event ?? from
  const [name, setName] = useState(init?.name ?? '')
  const [type, setType] = useState<EventType>(init?.type ?? 'match')
  const [date, setDate] = useState(init?.date ?? today())
  const [place, setPlace] = useState(init?.place ?? '')
  // Garçons / Filles / Mixte (facultatif, src/gender.ts) : sans choix, déduit des joueurs de la liste (toutes des filles → féminin).
  const [sex, setSex] = useState<HBEvent['sex']>(init?.sex)
  // Copie : sa liste, comme une liste choisie (mais chaque joueur garde celui qui l'avait ajouté).
  const copied = from?.playerIds?.length ? from.playerIds : undefined
  const chosen = !event && (copied ?? playerIds)?.length ? [...new Set(copied ?? playerIds)] : undefined
  const rosterIds = event ? (event.playerIds ?? []) : (chosen ?? picked?.playerIds ?? [])
  const guessed = useLiveQuery(async () => genderOf(await db.players.bulkGet(rosterIds)), [rosterIds.join(',')])
  const auto: Gender = (!event && picked?.sex) || guessed
  // Unité organisatrice (src/eventOrganizer.ts) : à la création, celle du créateur, posée d'office ; modifiable.
  const [organizer, setOrganizer] = useState<OrganizerValue>({ id: init?.organizerUnitId ?? '', name: init?.organizerName })
  // Participants (supabase/024_participants_evenements.sql) : encadrants qui co-organisent.
  const [editors, setEditors] = useState<string[]>(init?.editors ?? [])
  // Staffs choisis (supabase/034) : leurs membres du moment co-organisent. Ceux que je ne vois pas restent tels quels.
  const [teams, setTeams] = useState<string[]>(init?.teams ?? [])
  const canPick = useCanPickStaff()
  const [staffNames, setStaffNames] = useState<Record<string, string>>({})
  const chip = (on: boolean) =>
    `rounded-md border px-2.5 py-1.5 text-xs font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-fg'}`
  return (
    <div className="flex flex-col gap-2">
      <input className="field" autoFocus={!!playerIds?.length} aria-label="Nom de l’événement" placeholder="Ex. Tournoi de Pâques, Lyon – Valence…" value={name} onChange={(e) => setName(e.target.value)} />
      {/* 2 colonnes (téléphone, formulaire étroit), 4 de front dès que la place le permet (fenêtre d'ordinateur). */}
      <div className="@container">
        <Segmented value={type} onChange={setType} options={EVENT_TYPES} className="grid grid-cols-2 gap-[3px] @lg:grid-cols-4" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="field" placeholder="Lieu" value={place} onChange={(e) => setPlace(e.target.value)} />
      </div>
      <OrganizerField value={organizer} onChange={setOrganizer} auto={!event && !from} />
      <span className="label mt-1">{SEX_LABELS.M} / {SEX_LABELS.F.toLowerCase()}</span>
      {/* Style commun des choix (Segmented, 31/10) ; toucher le choix retenu le retire (facultatif). */}
      <Segmented
        label={`${SEX_LABELS.M} / ${SEX_LABELS.F.toLowerCase()}`}
        value={sex}
        onChange={(v) => setSex(sex === v ? undefined : v)}
        options={EVENT_SEXES}
      />
      {!sex && <p className="-mt-1 text-[11px] text-muted">Facultatif : sans choix, déduit des joueurs de la liste{auto ? ` (${EVENT_SEXES.find((x) => x.value === auto)?.label.toLowerCase()})` : ''}.</p>}
      {chosen && (
        <p className="text-[11px] text-muted">
          Liste : {pluralG(chosen.length, guessed, copied ? 'joueur copié' : 'joueur choisi')}
          {copied ? ` de « ${from!.from} »` : ''} (modifiable ensuite){copied ? ', sans leurs avis' : ''}.
        </p>
      )}
      {from?.tournament && (
        <p className="text-[11px] text-muted">
          Équipes : {from.tournament.teams.length > 1 ? `${from.tournament.teams.length} équipes copiées` : '1 équipe copiée'}
          {from.tournament.players ? ', avec les numéros de maillot' : ''} (sans résultats).
        </p>
      )}
      {!event && !chosen && groups.length > 0 && (
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
      <FormActions>
        <button
          className="btn-primary flex-1"
          disabled={!name.trim()}
          onClick={async () => {
            const fields = {
              name: name.trim(),
              type,
              date,
              place: place || undefined,
              sex: sex || (!event && picked?.sex ? picked.sex : undefined),
              organizerUnitId: organizer.id || undefined,
              organizerName: organizer.id ? organizer.name : undefined,
              editors,
              teams: teams.length ? teams : undefined,
              names: { ...event?.names, ...Object.fromEntries(editors.filter((u) => staffNames[u]).map((u) => [u, staffNames[u]])) },
            }
            // « Ajouté par » des joueurs choisis : posé ici pour l'affichage ; le serveur le refait (supabase/024).
            const me = currentUserId()
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
                      playerIds: chosen ? [...chosen] : picked ? [...picked.playerIds] : undefined,
                      ...(chosen && me ? { addedBy: Object.fromEntries(chosen.map((id) => [id, me])) } : {}),
                      // Depuis un groupe : chaque joueur garde celui qui l'avait ajouté au groupe.
                      ...(!chosen && { addedBy: picked?.addedBy ? { ...picked.addedBy } : undefined }),
                      names: { ...picked?.names, ...from?.names, ...fields.names },
                      // Copie (« Dupliquer l'événement ») : chacun garde celui qui l'avait ajouté ; équipes et numéros.
                      ...(copied && { addedBy: { ...(me ? Object.fromEntries(copied.map((id) => [id, me])) : {}), ...from!.addedBy } }),
                      ...(from?.tournament && { tournament: from.tournament }),
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
      </FormActions>
      {extra}
    </div>
  )
}

/** Garçons / Filles / Mixte : libellés partagés (src/gender.ts). */
const EVENT_SEXES = SEX_CHOICES

/** Choix d'un joueur par recherche (la base peut contenir des milliers de joueurs). */
function PlayerPicker({
  players,
  roster,
  value,
  done,
  searchOnly = false,
  onChange,
  onPropose,
}: {
  players: Player[]
  roster: Player[]
  value: string
  done: Set<string>
  /** Liste de l'événement déjà affichée à côté : seulement la recherche, dans toute la base. */
  searchOnly?: boolean
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
  const inRoster = roster.length > 0 && !everywhere && !searchOnly
  // Sans recherche : la liste de l'événement, sinon les joueurs déjà évalués ici.
  const matches = (
    words.length ? (inRoster ? roster : players).filter(hit) : searchOnly ? [] : roster.length ? roster : players.filter((p) => done.has(p.id))
  ).slice(0, words.length && !inRoster ? 20 : Math.max(20, roster.length))
  return (
    <div className="flex flex-col gap-1">
      <input
        className="field"
        placeholder={roster.length && !everywhere && !searchOnly ? 'Chercher dans les joueurs de l’événement…' : 'Nom, prénom, club ou licence…'}
        value={q}
        autoFocus={!value && !searchOnly}
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
      {roster.length > 0 && words.length > 0 && !searchOnly && (
        <button className="self-start text-xs font-bold text-accent" onClick={() => setEverywhere(!everywhere)}>
          {everywhere ? '← Chercher seulement dans les joueurs de l’événement' : 'Chercher dans toute la base (joueur hors liste)…'}
        </button>
      )}
      {words.length > 0 && (!roster.length || everywhere || searchOnly) && (
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

/**
 * Hors ligne, avis en cours ou enregistré : une ligne discrète sous « Enregistrer / Suivant » rassure (l'avis part
 * tout seul au retour du réseau, sync.ts). Sa hauteur est publiée dans --save-extra : les boutons flottants de l'avis
 * vocal (AvisVocal.tsx) remontent d'autant et ne la recouvrent pas.
 */
function OfflineNote({ show }: { show: boolean }) {
  const { state } = useSyncState()
  const on = show && state === 'offline'
  const ref = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const root = document.documentElement.style
    if (!on || !el) return
    const set = () => root.setProperty('--save-extra', `${el.offsetHeight + 4}px`)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => {
      ro.disconnect()
      root.removeProperty('--save-extra')
    }
  }, [on])
  if (!on) return null
  return (
    <p ref={ref} className="text-xs leading-snug text-muted" role="status">
      <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" aria-hidden />
      Hors ligne : ton avis est gardé sur le téléphone et partira tout seul.
    </p>
  )
}
