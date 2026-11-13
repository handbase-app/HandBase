import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useBackCloses } from '../backNav'
import { db, newId, POSITIONS, remove, save, today, type HBEvent, type Player, type PlayerGroup } from '../db'
import {
  ACTION_DISPLAY,
  actionDetail,
  buildCard,
  detectAction,
  groupNameFrom,
  isAllPlayers,
  markWithUndo,
  matchTarget,
  newGroupFields,
  parsePlan,
  REFUSAL_TEXT,
  targetKind,
  UNPLANNED_TEXT,
  WRITES,
  type ActionOutcome,
  type AskPlan,
  type Detected,
  type Named,
  type PlanAction,
} from '../askAction'
import { ASK_PATH, type AskPage } from '../demander'
import { sendActionRequest, sendQuestionRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import { genderOf, pluralG } from '../gender'
import { regionOfDept } from '../lists'
import { listRecipe, selectPlayers } from '../playerQuery'
import { useQuestionModel } from '../questionModel'
import { logQuestion } from '../questionLog'
import type { RecipeStatus } from '../questionLogCore'
import { rescueInterpretation } from '../questionRescue'
import { buildQuestionSchema, hasConditions, hasPopulation, interpretRecipe, recipeChips } from '../recipe'
import { can, isParticipant, isPlayerRole, useRole } from '../roles'
import { listOrigin, type RewatchOrigin } from '../rewatchCore'
import { addRewatchMany, markSeenMany, myOpenRewatch, openRewatchSet, scoutId, seenSet, setSeen } from '../scouting'
import { doneMessage } from '../selection'
import { spyTarget } from '../spy'
import { addPlayersToEvent } from './AddToEvent'
import { postAsk } from './Demander'
import { addToGroup, removeFromGroup } from './Groups'
import { department, hayOf, tokensOf } from './PlayerFilter'
import { playerName } from './ui'
import { useWait, WaitLine } from './Attente'

/*
 * Actions de « Demander » : la CARTE DE VALIDATION (partie pure : src/askAction.ts). Une phrase d'action, dite ou tapée dans
 * la bulle ✦ de l'en-tête ou dans la barre « Demander » d'une liste (« Trouve-moi tous les gauchers du Var de plus d'1,80 m
 * et crée-moi un groupe avec »), ouvre cette carte :
 *  1. « Je prépare… » : règles locales d'abord (sans IA) ; la partie « joueurs » part au mode « question » (contexte
 *     joueurs) ; une action que les règles ne lisent pas part au mode « action » (plan JSON relu par parsePlan). Seuls la
 *     phrase et le schéma de la recette partent, jamais de données ni de noms de l'appareil ;
 *  2. le groupe ou l'événement CITÉ est retrouvé ici, sur l'appareil (matchTarget : « le prochain intercomité » → l'événement à
 *     venir le plus proche de ce nom, à confirmer) : approchant → « Tu voulais dire … ? »
 *     (Oui / un autre / Annuler) ; trop éloigné → « Je ne trouve pas … » ;
 *  3. la carte : « Je vais : 1) chercher : gauchers · Var · taille ≥ 180 cm → 23 joueurs (voir la liste) ; 2) créer le groupe
 *     « … » avec ces 23 joueurs », nom modifiable, avertissement au-delà de 200 joueurs, droits (can.* de src/roles.ts : sans
 *     le droit, la carte le dit et ne propose pas « Accepter ») ; RIEN n'est écrit avant « Accepter » ;
 *  4. après « Accepter » : l'action est faite par les fonctions des boutons existants (création comme « Nouveau groupe »,
 *     addToGroup, addPlayersToEvent), message de réussite avec un lien, et « Défaire » quelques secondes. Ouvrir un
 *     événement ou un groupe filtré : la page s'ouvre avec le filtre (bandeau « Filtre de Demander », ✕ pour le retirer) ;
 *  5. enchaînement « crée un groupe … et ajoute-les à l'événement X » (plan.then) : une étape de plus dans la carte (« Puis
 *     ajouter les mêmes à … », cible retrouvée et droits vérifiés de même), un seul « Accepter », « Défaire » défait tout ;
 *     « … et mets-les à revoir » : « Puis les mettre à revoir pour toi » ;
 *     « ceux-là », « cette liste » (plan.current) : les joueurs de la liste Joueurs affichée, sans appel ; action pas encore
 *     prévue (convoquer, suivre, comparer… : Detected « inconnue ») : la carte dit comment le faire aujourd'hui ;
 *  6. mettre à revoir (addRewatchMany, comme « Mettre à revoir » de la sélection ; origine : l'événement dit, ou le seul
 *     événement de la recette, sinon la liste et ses critères), marquer vus à un événement (markSeenMany ; droits : ceux de
 *     contribuer à l'événement, observateur participant compris) : « K le sont déjà », et « Défaire » ne retire que ce que
 *     l'action a posé (markWithUndo) ; exporter : rien n'est écrit, boutons [PDF / liste à imprimer] (page « Exporter en
 *     PDF » du groupe) et [Tableur (CSV)] (exportCsv, comme « Exporter (tableur) » de la liste Joueurs).
 * Jamais de suppression, de retrait, de modification de fiche ni d'action sur des comptes. Chaque demande est notée au
 * journal des questions (phrase anonymisée, recette, action proposée et ce qu'en a fait l'entraîneur ; jamais de nom).
 */

// ---------- Demande en cours (une seule à la fois) ----------

/** `current` : les joueurs de la liste affichée (liste Joueurs), pour « ajoute ceux-là au groupe X ». */
type Current = { ids: string[]; label: string }
type Request = { id: number; phrase: string; page: AskPage; detected?: Detected | null; current?: Current }
let request: Request | null = null
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Ouvre la carte d'action pour cette phrase (`detected` : déjà lue par detectAction ; `current` : la liste affichée). */
export function startAskAction(phrase: string, page: AskPage, detected?: Detected | null, current?: Current) {
  request = { id: ++seq, phrase: phrase.replace(/\s+/g, ' ').trim(), page, detected, current }
  emit()
}
const closeRequest = () => {
  request = null
  emit()
}

/** À poser une fois dans l'appli (src/App.tsx) : la carte d'action, quand une demande est en cours. */
export function AskActionHost() {
  const r = useSyncExternalStore(subscribe, () => request)
  return r ? <ActionDialog key={r.id} req={r} onClose={closeRequest} /> : null
}

// ---------- Filtre posé sur un événement ou un groupe ouvert (« les gauchers de l'événement X ») ----------

export type AskListFilter = { label: string; ids: string[]; at: number }
const FILTER_KEY = 'handbase.demander.filtres'
let filters: Record<string, AskListFilter> | null = null
const filterListeners = new Set<() => void>()
function readFilters(): Record<string, AskListFilter> {
  if (filters) return filters
  try {
    const v = JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? '{}') as Record<string, AskListFilter>
    filters = v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    filters = {}
  }
  return filters
}
/** Pose (ou retire, null) le filtre de « Demander » d'un événement ou d'un groupe (gardé pendant la session). */
export function setAskListFilter(kind: 'evenement' | 'groupe', id: string, f: AskListFilter | null) {
  const next = { ...readFilters() }
  if (f) next[`${kind}:${id}`] = f
  else delete next[`${kind}:${id}`]
  filters = next
  try {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(next))
  } catch {
    /* stockage indisponible : gardé jusqu'au rechargement */
  }
  filterListeners.forEach((l) => l())
}
/** Filtre de « Demander » posé sur cet événement ou ce groupe (null : aucun). */
export function useAskListFilter(kind: 'evenement' | 'groupe', id: string | undefined): AskListFilter | null {
  const all = useSyncExternalStore(
    (l) => {
      filterListeners.add(l)
      return () => {
        filterListeners.delete(l)
      }
    },
    readFilters,
  )
  const f = id ? all[`${kind}:${id}`] : undefined
  return f && Array.isArray(f.ids) && typeof f.label === 'string' ? f : null
}

/** Bandeau au-dessus de la liste filtrée : ce que montre le filtre, et ✕ pour le retirer. */
export function AskFilterBanner({ kind, id, f, shown }: { kind: 'evenement' | 'groupe'; id: string; f: AskListFilter; shown: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-ai/40 bg-ai-soft px-3 py-2 text-xs" role="status">
      <span className="shrink-0 text-ai" aria-hidden>
        ✦
      </span>
      <span className="min-w-0 flex-1">
        <b>Filtre de Demander :</b> {f.label} · {shown.toLocaleString('fr-FR')} affiché{shown > 1 ? 's' : ''}
      </span>
      <button type="button" className="min-h-9 shrink-0 px-2 text-[11px] font-bold underline" onClick={() => setAskListFilter(kind, id, null)}>
        Retirer le filtre
      </button>
    </div>
  )
}

// ---------- La carte ----------

type Step =
  | { k: 'plan' }
  | { k: 'name'; said: string; kind: 'groupe' | 'evenement'; choices: Named[]; slot: 'cible' | 'suite' }
  | { k: 'ready' }
  | { k: 'doing' }
  /** « Défaire » en cours : « En cours… » (pas la carte, dont les nombres changent pendant ce temps). */
  | { k: 'undoing' }
  | { k: 'done'; msg: string; link?: { to: string; label: string }; undo?: () => Promise<string> }
  | { k: 'error'; msg: string }

const NO_AI = 'L’assistant en ligne n’est pas disponible ici : je ne peux pas lire les critères de joueurs. Utilise les filtres de la liste Joueurs, puis « → Groupe ».'
/** Cible introuvable (« le prochain intercomité » : aucun à venir). */
const notFound = (kind: 'groupe' | 'evenement', said: string) =>
  /^\s*(?:le |la |l['’])?(?:prochain|prochaine)\b/i.test(said)
    ? `Je ne trouve pas d’événement à venir qui corresponde à « ${said} » sur cet appareil. Vérifie dans Événements.`
    : /^\s*(?:le |la |l['’])?(?:dernier|dernière)\b/i.test(said)
      ? `Je ne trouve pas d’événement passé qui corresponde à « ${said} » sur cet appareil. Vérifie dans Événements.`
      : `Je ne trouve pas ${kind === 'groupe' ? 'de groupe' : 'd’événement'} « ${said} » sur cet appareil. Vérifie son nom dans ${kind === 'groupe' ? 'Groupes' : 'Événements'}.`
const NO_CURRENT = 'Je ne sais pas de quels joueurs tu parles. Dis-moi les critères (« les gauchers de 2011 »), ou fais la demande depuis la liste Joueurs filtrée.'
const UNDO_MS = 10_000
const LIST_MAX = 100
const OUT_CHIPS = new Set(['out', 'value', 'keep', 'outPeriod', 'sort', 'limit', 'minMatch', 'noneYears'])

function ActionDialog({ req, onClose }: { req: Request; onClose: () => void }) {
  const nav = useNavigate()
  const role = useRole()
  const { questionReady, actionReady, allowed, access } = useDictation()
  const model = useQuestionModel(true)
  const criteria = useLiveQuery(() => db.criteria.toArray(), [])
  const [step, setStep] = useState<Step>({ k: 'plan' })
  const [plan, setPlan] = useState<AskPlan | null>(null)
  const [raw, setRaw] = useState<{ recette: unknown; nonGere: string[] } | null>(null)
  const [target, setTarget] = useState<Named | null>(null)
  /** Cible de la deuxième étape (plan.then), retrouvée sur l'appareil. */
  const [thenTarget, setThenTarget] = useState<Named | null>(null)
  const [groupName, setGroupName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [showList, setShowList] = useState(false)
  const [undoLeft, setUndoLeft] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const logged = useRef(false)
  const started = useRef(false)
  const box = useRef<HTMLDivElement>(null)

  // ---------- Journal (une ligne par demande, à la décision) ----------
  const statusRef = useRef<{ recipe: RecipeStatus; missing: string[] }>({ recipe: 'pas_comprise', missing: [] })
  const log = (action: PlanAction | 'inconnue' | 'interdite', outcome: ActionOutcome, count?: number, why?: string) => {
    if (logged.current) return
    logged.current = true
    logQuestion(
      {
        phrase: req.phrase,
        recipe: statusRef.current.recipe,
        recipeMissing: statusRef.current.missing,
        page: req.page,
        display: ACTION_DISPLAY,
        detail: actionDetail(action, outcome, count, why),
      },
      model.source?.() ?? null,
    )
  }
  const fail = (msg: string, action: PlanAction | 'inconnue' | 'interdite', outcome: ActionOutcome) => {
    log(action, outcome)
    setStep({ k: 'error', msg })
  }

  // ---------- 1. Le plan : règles locales, sinon le modèle ----------
  // L'accès à l'assistant est connu (ou il n'y en a pas ici) : on peut commencer.
  const accessKnown = questionReady || !allowed || access !== undefined
  useEffect(() => {
    if (started.current || !criteria || !accessKnown) return
    started.current = true
    void (async () => {
      const d = req.detected ?? detectAction(req.phrase, req.page)
      if (d?.kind === 'interdite') return fail(REFUSAL_TEXT.interdite, 'interdite', 'refusee')
      // Action pas encore prévue (marquer vus, exporter…) : dite tout de suite, avec la façon de faire aujourd'hui.
      if (d?.kind === 'inconnue') return fail(UNPLANNED_TEXT[d.what], 'inconnue', 'impossible')
      const schema = buildQuestionSchema({ criteria, positions: POSITIONS, today: today(), regions: [], depts: [], clubs: [], groups: [], events: [] })
      const ctrl = new AbortController()
      abort.current = ctrl
      try {
        let p: AskPlan
        let recette: unknown = {}
        let nonGere: string[] = []
        if (d?.kind === 'plan') {
          p = d.plan
          if (p.action === 'filtrer_createur') return toList(p)
          // « ceux-là », « cette liste » : les joueurs de la liste affichée, sans appel.
          if (p.current && !req.current?.ids.length) return fail(NO_CURRENT, p.action, 'impossible')
          // « tous les joueurs (de l'événement X) » : aucun critère, rien à demander au modèle.
          if (p.playersPhrase && !p.current && !isAllPlayers(p.playersPhrase)) {
            if (!questionReady) return fail(NO_AI, p.action, 'impossible')
            const ans = await sendQuestionRequest(p.playersPhrase, schema, ctrl.signal, { contexte: 'joueurs', actuels: [] })
            recette = ans.recette
            nonGere = ans.nonGere
          }
        } else {
          if (!actionReady)
            return fail(
              questionReady
                ? 'Je ne sais pas encore lire cette action. Essaie par exemple « crée un groupe avec les gauchers de 2011 » ou « ajoute les 2011 du Var au groupe … ».'
                : NO_AI,
              'inconnue',
              'impossible',
            )
          const ans = await sendActionRequest(req.phrase, schema, ctrl.signal, req.page)
          const c = parsePlan(ans.plan)
          if (!c.ok) return fail(c.text, c.reason === 'interdite' ? 'interdite' : 'inconnue', c.reason === 'interdite' ? 'refusee' : 'impossible')
          p = c.plan
          if (p.action === 'filtrer_createur') return toList(p)
          recette = p.players ?? {}
          nonGere = p.nonGere
        }
        if (ctrl.signal.aborted) return
        setPlan(p)
        setRaw({ recette, nonGere })
        if (p.name) {
          setGroupName(p.name)
          setNameTouched(true)
        }
      } catch (e) {
        if (e instanceof DictationError && e.code === 'annule') return
        fail(e instanceof DictationError ? e.message : ERROR_TEXT.mistral_erreur, d?.kind === 'plan' ? d.plan.action : 'inconnue', 'impossible')
      } finally {
        if (abort.current === ctrl) abort.current = null
      }
    })()
  }, [criteria, accessKnown]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abort.current?.abort(), [])

  /** Filtre par créateur : la liste visée le fait elle-même (nom approchant : « Tu voulais dire … ? » dans la liste). */
  function toList(p: AskPlan) {
    const page = p.list ?? 'groupes'
    postAsk({ page, phrase: req.phrase })
    nav(ASK_PATH[page])
    onClose()
  }

  // ---------- 2. Le groupe ou l'événement cité, retrouvé sur l'appareil ----------
  // Cible facultative (mettre à revoir : l'événement s'il est dit ; exporter : le groupe s'il est dit).
  const kind = plan?.target ? targetKind(plan.action) : undefined
  const named = useMemo((): Named[] => {
    if (!kind || !model.data) return []
    return kind === 'groupe' ? model.data.groups.map((g) => ({ id: g.id, name: g.name })) : model.data.events.map((e) => ({ id: e.id, name: e.name, date: e.date }))
  }, [kind, model.data])
  useEffect(() => {
    if (!plan || !kind || target || step.k !== 'plan' || !model.data) return
    const m = matchTarget(plan.target ?? '', named, today())
    if (m.kind === 'exact') setTarget(m.item)
    else if (m.kind === 'approx') setStep({ k: 'name', said: plan.target ?? '', kind, choices: m.choices, slot: 'cible' })
    else fail(notFound(kind, plan.target ?? ''), plan.action, 'impossible')
  }, [plan, kind, named, model.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // Deuxième étape (« … et ajoute-les à l'événement X ») : sa cible, retrouvée de même, après celle de la première.
  // « … et mets-les à revoir » : pas de cible.
  const thenKind = plan?.then?.target ? targetKind(plan.then.action) : undefined
  useEffect(() => {
    const said = plan?.then?.target
    if (!plan || !said || !thenKind || thenTarget || step.k !== 'plan' || !model.data || (kind && !target)) return
    const list: Named[] = thenKind === 'groupe' ? model.data.groups.map((g) => ({ id: g.id, name: g.name })) : model.data.events.map((e) => ({ id: e.id, name: e.name, date: e.date }))
    const m = matchTarget(said, list, today())
    if (m.kind === 'exact') setThenTarget(m.item)
    else if (m.kind === 'approx') setStep({ k: 'name', said, kind: thenKind, choices: m.choices, slot: 'suite' })
    else fail(notFound(thenKind, said), plan.action, 'impossible')
  }, [plan, thenKind, thenTarget, step.k, model.data, kind, target]) // eslint-disable-line react-hooks/exhaustive-deps

  // Groupe ou événement visé (et ceux de la deuxième étape), tels qu'ils sont sur l'appareil.
  const group: PlayerGroup | undefined = kind === 'groupe' && target ? model.data?.groups.find((g) => g.id === target.id) : undefined
  const event: HBEvent | undefined = kind === 'evenement' && target ? model.data?.events.find((e) => e.id === target.id) : undefined
  const thenGroup: PlayerGroup | undefined = thenKind === 'groupe' && thenTarget ? model.data?.groups.find((g) => g.id === thenTarget.id) : undefined
  const thenEvent: HBEvent | undefined = thenKind === 'evenement' && thenTarget ? model.data?.events.find((e) => e.id === thenTarget.id) : undefined
  /** Chercher parmi les joueurs de l'événement visé (vus, à revoir depuis l'événement) ou du groupe exporté. */
  const inEvent = !!event && (plan?.action === 'ouvrir_evenement' || plan?.action === 'marquer_vus' || plan?.action === 'mettre_a_revoir')
  const inGroup = !!group && (plan?.action === 'ouvrir_groupe' || plan?.action === 'exporter')

  // ---------- 3. Les joueurs : recette relue avec les listes de l'appareil, calculée ici ----------
  const calc = useMemo(() => {
    if (!plan || !raw || !model.ctx || !model.index || (kind && !target) || (thenKind && !thenTarget)) return null
    if (plan.current && req.current) {
      // « ceux-là » : les joueurs de la liste affichée, dans son ordre (« vus à l'événement X » : ceux de l'événement).
      const want = new Set(req.current.ids)
      const evIds = inEvent && event ? new Set(event.playerIds ?? []) : null
      const players = model.index.players.filter((p) => want.has(p.id) && (!evIds || evIds.has(p.id)))
      return { players, chips: [req.current.label], missing: [] as string[], noCriteria: false, recipe: 'complete' as RecipeStatus, events: [] as string[] }
    }
    // Plan lu en local sans partie « joueurs » (« exporte le groupe X ») : rien à relire dans la phrase.
    const it = rescueInterpretation(interpretRecipe(raw.recette, raw.nonGere, model.ctx), plan.playersPhrase ?? (plan.local ? '' : req.phrase), model.ctx, { scope: 'liste' })
    const base = listRecipe(it.recipe)
    const noCriteria = !hasPopulation(base) && !hasConditions(base)
    const r = structuredClone(base)
    if (inEvent && target) r.pop.events = [target.id]
    if (inGroup && target) r.pop.groups = [target.id]
    const players = selectPlayers(model.index, { recipe: r, q: '' }, hayOf, tokensOf).list
    // Critères seulement (population, conditions) : pas les réglages d'affichage de la liste (« liste », tri, limite).
    const chips = recipeChips(base, model.names)
      .filter((c) => !OUT_CHIPS.has(c.key))
      .map((c) => c.label)
    const missing = [...it.unsupported, ...it.notes]
    const recipe: RecipeStatus = noCriteria && (missing.length || WRITES.includes(plan.action)) ? 'pas_comprise' : missing.length ? 'partielle' : 'complete'
    // Événements de la recette (« les 2011 du tournoi X ») : un seul → l'origine d'un « à revoir ».
    return { players, chips, missing, noCriteria, recipe, events: base.pop.events ?? [] }
  }, [plan, raw, model.ctx, model.index, model.names, kind, target, thenKind, thenTarget, req.phrase, req.current, inEvent, inGroup, event])
  useEffect(() => {
    if (calc) statusRef.current = { recipe: calc.recipe, missing: calc.missing }
  }, [calc])
  useEffect(() => {
    if (calc && step.k === 'plan') setStep({ k: 'ready' })
  }, [calc, step.k])
  // Nom proposé pour le groupe : d'après les critères compris (s'il n'a pas été dit ni changé).
  useEffect(() => {
    if (calc && plan?.action === 'creer_groupe' && !nameTouched) setGroupName(groupNameFrom(calc.chips))
  }, [calc, plan, nameTouched])

  // ---------- Droits (mêmes règles que les boutons : can.* de src/roles.ts) ----------
  /** Droit d'ajouter des joueurs à ce groupe ou à cet événement. */
  const addRights = (g: PlayerGroup | undefined, e: HBEvent | undefined, k: 'groupe' | 'evenement'): { ok: boolean; why?: string } => {
    if (k === 'groupe') {
      if (!g) return { ok: false }
      if (g.poleUnitId) return { ok: false, why: 'Groupe Pôle : l’arrivée s’écrit sur la fiche ; ajoute ces joueurs depuis la page du groupe.' }
      if (g.archived) return { ok: false, why: 'Ce groupe est archivé : désarchive-le d’abord.' }
      return can.editGroup(role, g) || can.contributeGroup(role, g) ? { ok: true } : { ok: false, why: 'Tu ne peux pas ajouter de joueurs à ce groupe (ni créateur ni participant).' }
    }
    if (!e) return { ok: false }
    if (e.archived) return { ok: false, why: 'Cet événement est archivé : désarchive-le d’abord.' }
    return can.editEvent(role, e) || can.contributeEvent(role, e) ? { ok: true } : { ok: false, why: 'Tu ne peux pas ajouter de joueurs à cet événement (ni organisateur ni participant).' }
  }
  const scoutRights: { ok: boolean; why?: string } = scoutId() ? { ok: true } : { ok: false, why: 'Connecte-toi d’abord : « à revoir » et « vu » sont posés à ton nom.' }
  const rights = ((): { ok: boolean; why?: string } => {
    if (!plan) return { ok: false }
    if (WRITES.includes(plan.action) && spyTarget()) return { ok: false, why: '« Voir comme… » : lecture seule, rien ne peut être écrit.' }
    if (plan.action === 'creer_groupe') return can.manageGroups(role) ? { ok: true } : { ok: false, why: 'Ton rôle ne permet pas de créer des groupes.' }
    if (plan.action === 'ajouter_groupe') return addRights(group, undefined, 'groupe')
    if (plan.action === 'ajouter_evenement') return addRights(undefined, event, 'evenement')
    // « À revoir » : comme « Mettre à revoir » de la sélection (observateur identifié).
    if (plan.action === 'mettre_a_revoir') return scoutRights
    // « Vu » : mêmes droits que contribuer à l'événement (organisateur, administrateur, participant : observateur compris).
    if (plan.action === 'marquer_vus') {
      if (!scoutRights.ok) return scoutRights
      if (!event) return { ok: false }
      if (event.archived) return { ok: false, why: 'Cet événement est archivé : désarchive-le d’abord.' }
      return can.editEvent(role, event) || isParticipant(event) ? { ok: true } : { ok: false, why: 'Tu ne peux pas marquer de joueurs vus à cet événement (ni organisateur ni participant).' }
    }
    // Export : comme les menus « Exporter » (liste Joueurs, groupe visible) ; jamais pour un compte joueur.
    if (plan.action === 'exporter') {
      if (isPlayerRole(role)) return { ok: false, why: 'Ton rôle ne permet pas d’exporter.' }
      if (group && !can.seeGroup(group)) return { ok: false, why: 'Tu ne peux pas voir ce groupe.' }
    }
    return { ok: true }
  })()
  const thenRights = plan?.then?.action === 'mettre_a_revoir' ? scoutRights : thenKind ? addRights(thenGroup, thenEvent, thenKind) : undefined
  const ids = useMemo(() => calc?.players.map((p) => p.id) ?? [], [calc])
  const inside = (g?: PlayerGroup, e?: HBEvent) => (g ? ids.filter((id) => g.playerIds.includes(id)).length : e ? ids.filter((id) => e.playerIds?.includes(id)).length : undefined)
  // Déjà à revoir pour moi, déjà vus par moi à l'événement : relu en direct sur l'appareil.
  const wantRewatch = plan?.action === 'mettre_a_revoir' || plan?.then?.action === 'mettre_a_revoir'
  const seenEventId = plan?.action === 'marquer_vus' ? event?.id : undefined
  const mine = useLiveQuery(
    async () => ({ rewatch: wantRewatch ? (await openRewatchSet(ids)).size : undefined, seen: seenEventId ? (await seenSet(seenEventId, ids)).size : undefined }),
    [ids, wantRewatch, seenEventId],
  )
  const already =
    plan?.action === 'ajouter_groupe'
      ? inside(group)
      : plan?.action === 'ajouter_evenement'
        ? inside(undefined, event)
        : plan?.action === 'mettre_a_revoir'
          ? mine?.rewatch
          : plan?.action === 'marquer_vus'
            ? mine?.seen
            : undefined
  const gender = calc ? genderOf(calc.players) : undefined
  // D'où l'« à revoir » est posé : l'événement visé, sinon le seul événement de la recette, sinon la liste (ses critères).
  const oneEvent = !event && calc?.events.length === 1 ? model.data?.events.find((e) => e.id === calc.events[0]) : undefined
  const fromEvent = plan?.action === 'mettre_a_revoir' ? (event ?? oneEvent) : oneEvent
  const rewatchFrom: { originEventId?: string; origin?: RewatchOrigin; text: string } = fromEvent
    ? { originEventId: fromEvent.id, text: `depuis l’événement « ${fromEvent.name} »` }
    : plan?.current || !calc?.chips.length
      ? { origin: listOrigin([]), text: plan?.current ? 'depuis la liste Joueurs affichée' : 'depuis la liste Joueurs' }
      : { origin: listOrigin(calc.chips), text: `depuis la liste « ${calc.chips.join(' · ')} »` }
  const card =
    plan && calc
      ? buildCard({
          plan,
          criteria: calc.chips,
          count: calc.players.length,
          gender,
          target: target ?? undefined,
          groupName,
          already,
          allowed: rights.ok,
          deniedWhy: rights.why,
          unsupported: calc.missing,
          noCriteria: calc.noCriteria,
          origin: rewatchFrom.text,
          pole: !!group?.poleUnitId,
          ...(plan.then && thenRights
            ? {
                then: {
                  target: thenTarget ?? undefined,
                  already: plan.then.action === 'mettre_a_revoir' ? mine?.rewatch : inside(thenGroup, thenEvent),
                  allowed: thenRights.ok,
                  deniedWhy: thenRights.why,
                },
              }
            : {}),
        })
      : null

  // ---------- 4. Accepter ----------
  type Done = { msg: string; link?: { to: string; label: string }; undo?: () => Promise<string> }
  /** Ajout au groupe (fonction du bouton « Ajouter à un groupe ») ; « Défaire » retire ceux qui viennent d'être ajoutés. */
  async function addGroupStep(g: PlayerGroup): Promise<Done> {
    const cur = (await db.groups.get(g.id)) ?? g
    const added = [...new Set(ids)].filter((id) => !cur.playerIds.includes(id))
    await addToGroup(cur, ids)
    return {
      msg: added.length ? `${pluralG(added.length, gender ?? null, 'joueur ajouté')} au groupe « ${cur.name} ».` : `Déjà dans « ${cur.name} ».`,
      link: { to: `/groupes/${cur.id}`, label: 'Ouvrir le groupe' },
      undo: added.length
        ? async () => {
            const now = (await db.groups.get(cur.id)) ?? cur
            await removeFromGroup(now, added)
            return `C’est défait : le groupe « ${cur.name} » est comme avant.`
          }
        : undefined,
    }
  }
  /** Ajout à l'événement (fonction de « Ajouter à un événement ») ; « Défaire » retire ceux qui viennent d'être ajoutés. */
  async function addEventStep(e: HBEvent): Promise<Done> {
    const { cur, added } = await addPlayersToEvent(e, ids)
    return {
      msg: added.length ? `${pluralG(added.length, gender ?? null, 'joueur ajouté')} à l’événement « ${cur.name} ».` : `Déjà dans « ${cur.name} ».`,
      link: { to: `/evenements/${cur.id}`, label: 'Ouvrir l’événement' },
      undo: added.length
        ? async () => {
            const now = (await db.events.get(cur.id)) ?? cur
            const drop = new Set(added)
            await save<HBEvent>('events', { ...now, playerIds: (now.playerIds ?? []).filter((id) => !drop.has(id)) })
            return `C’est défait : l’événement « ${cur.name} » est comme avant.`
          }
        : undefined,
    }
  }
  /**
   * « À revoir » pour moi (fonction du bouton « Mettre à revoir » de la sélection, addRewatchMany) : ceux déjà à revoir ne
   * changent pas ; « Défaire » retire seulement les « à revoir » que l'action vient de créer.
   */
  async function rewatchStep(): Promise<Done> {
    const from = rewatchFrom
    const r = await markWithUndo(ids, {
      already: openRewatchSet,
      mark: (list) => addRewatchMany(list, { originEventId: from.originEventId, origin: from.origin }),
      created: async (pid) => (await myOpenRewatch(pid))?.id,
      unmark: (id) => remove('rewatch', id),
    })
    const undo = r.undo
    return {
      msg: doneMessage('rewatch', r.done, r.total, gender),
      link: { to: '/a-revoir', label: 'Voir « À revoir »' },
      undo: undo ? async () => `C’est défait : ${pluralG(await undo(), gender ?? null)} de moins dans « À revoir ».` : undefined,
    }
  }
  /**
   * « Vu » par moi à l'événement (fonction de « Marquer vu à cet événement », markSeenMany) ; « Défaire » retire seulement
   * les « vu » que l'action vient de poser (setSeen, comme l'œil d'une ligne).
   */
  async function seenStep(e: HBEvent): Promise<Done> {
    const r = await markWithUndo(ids, {
      already: (list) => seenSet(e.id, list),
      mark: (list) => markSeenMany(e.id, list),
      created: async (pid) => pid,
      unmark: (pid) => setSeen(e.id, pid, false),
    })
    const undo = r.undo
    return {
      msg: doneMessage('seen', r.done, r.total, gender),
      link: { to: `/evenements/${e.id}`, label: 'Ouvrir l’événement' },
      undo: undo
        ? async () => {
            const n = await undo()
            return `C’est défait : ${n > 1 ? `les ${n} « vu » posés` : 'le « vu » posé'} à l’événement « ${e.name} » ${n > 1 ? 'sont retirés' : 'est retiré'}.`
          }
        : undefined,
    }
  }
  /** Export (rien n'est écrit) : page « Exporter en PDF » du groupe, ou tableur CSV des joueurs trouvés (export existant). */
  async function exportAs(f: 'pdf' | 'csv') {
    if (!plan || !calc || !card?.canAccept || step.k !== 'ready') return
    const n = calc.players.length
    if (f === 'pdf') {
      if (!group) return
      log('exporter', 'acceptee', n, 'liste à imprimer (PDF)')
      onClose()
      nav(`/groupes/${group.id}/rapport`)
      return
    }
    setStep({ k: 'doing' })
    try {
      const { exportCsv } = await import('../export')
      await exportCsv(calc.players, gender)
      log('exporter', 'acceptee', n, 'tableur (CSV)')
      setStep({ k: 'done', msg: `Tableur prêt : ${pluralG(n, gender ?? null)}, fichier CSV enregistré sur l’appareil.`, ...(group ? { link: { to: `/groupes/${group.id}`, label: 'Ouvrir le groupe' } } : {}) })
    } catch (e) {
      setStep({ k: 'error', msg: `L’export n’a pas pu être fait : ${(e as Error)?.message || 'erreur inconnue'}.` })
    }
  }
  async function accept() {
    if (!plan || !calc || !card?.canAccept || step.k !== 'ready') return
    const n = calc.players.length
    setStep({ k: 'doing' })
    try {
      if (plan.action === 'ouvrir_evenement' || plan.action === 'ouvrir_groupe') {
        if (!target) return
        const k = plan.action === 'ouvrir_groupe' ? 'groupe' : 'evenement'
        setAskListFilter(k, target.id, { label: calc.chips.join(' · ') || 'tous les joueurs', ids, at: Date.now() })
        log(plan.action, 'acceptee', n)
        onClose()
        nav(k === 'groupe' ? `/groupes/${target.id}` : `/evenements/${target.id}`)
        return
      }
      const parts: Done[] = []
      if (plan.action === 'creer_groupe') {
        const fields = newGroupFields(
          calc.players.map((p: Player) => {
            const dept = department(p)
            return { sex: p.sex, year: p.birthDate?.slice(0, 4), dept, region: regionOfDept(dept) }
          }),
        )
        const name = groupName.trim()
        // Comme « Nouveau groupe » (src/pages/Groups.tsx, GroupForm) : privé (« Moi seul »), sans participant.
        const g = await save<PlayerGroup>('groups', { id: newId(), name, playerIds: [...new Set(ids)], ...fields, editors: [], private: true })
        parts.push({
          msg: `Groupe « ${name} » créé avec ${pluralG(n, gender ?? null)}.`,
          link: { to: `/groupes/${g.id}`, label: 'Ouvrir le groupe' },
          undo: async () => {
            await remove('groups', g.id)
            return `C’est défait : le groupe « ${name} » n’existe plus.`
          },
        })
      } else if (plan.action === 'ajouter_groupe' && group) parts.push(await addGroupStep(group))
      else if (plan.action === 'ajouter_evenement' && event) parts.push(await addEventStep(event))
      else if (plan.action === 'mettre_a_revoir') parts.push(await rewatchStep())
      else if (plan.action === 'marquer_vus' && event) parts.push(await seenStep(event))
      // Deuxième étape : les mêmes joueurs, ajoutés ensuite à l'autre groupe ou événement, ou mis à revoir.
      if (plan.then?.action === 'mettre_a_revoir') parts.push(await rewatchStep())
      else if (plan.then && thenGroup) parts.push(await addGroupStep(thenGroup))
      else if (plan.then && thenEvent) parts.push(await addEventStep(thenEvent))
      if (!parts.length) return
      log(plan.action, 'acceptee', n, plan.then ? 'deux étapes' : undefined)
      const undos = parts.map((p) => p.undo).filter((u): u is () => Promise<string> => !!u)
      setStep({
        k: 'done',
        msg: parts.map((p) => p.msg).join(' '),
        link: parts[parts.length - 1].link,
        undo: undos.length
          ? async () => {
              const msgs: string[] = []
              for (const u of [...undos].reverse()) msgs.push(await u())
              return msgs.reverse().join(' ')
            }
          : undefined,
      })
    } catch (e) {
      setStep({ k: 'error', msg: `L’action n’a pas pu être faite : ${(e as Error)?.message || 'erreur inconnue'}.` })
    }
  }

  // « Défaire » : quelques secondes après la réussite.
  const doneUndo = step.k === 'done' ? step.undo : undefined
  useEffect(() => {
    if (!doneUndo) return
    const end = Date.now() + UNDO_MS
    setUndoLeft(Math.ceil(UNDO_MS / 1000))
    const t = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setUndoLeft(left)
      if (!left) window.clearInterval(t)
    }, 250)
    return () => window.clearInterval(t)
  }, [doneUndo])

  /** Fermer : « Annuler » avant toute action (noté au journal). */
  function cancel() {
    abort.current?.abort()
    if (step.k === 'plan' || step.k === 'name' || step.k === 'ready') log(plan?.action ?? (req.detected?.kind === 'plan' ? req.detected.plan.action : 'inconnue'), 'annulee', calc?.players.length)
    onClose()
  }
  const cancelRef = useRef(cancel)
  useEffect(() => {
    cancelRef.current = cancel
  })
  // Retour du téléphone ou du navigateur : ferme la carte (comme ✕), on reste sur l'écran. Carte acceptée qui ouvre un
  // groupe ou un événement : il prend la place de l'entrée de la carte (src/backNav.tsx, useBackCloses).
  useBackCloses(() => cancelRef.current())
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && cancelRef.current()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  // Focus dans la carte (clavier, lecteur d'écran) à chaque étape.
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
  }, [step.k])

  // ---------- Rendu ----------
  // Plan en préparation (assistant appelé) : ✦ qui tourne, fine barre d'après la durée habituelle (src/components/Attente.tsx).
  const preparing = step.k === 'plan' || (step.k === 'ready' && !card)
  const wait = useWait(preparing, 'action')
  const spinner = <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
  let body: ReactNode
  if (step.k === 'plan' || (step.k === 'ready' && !card)) {
    body = (
      <>
        <WaitLine wait={wait} label="Je prépare… (rien n’est fait sans ton accord)" />
        <div className="flex justify-end">
          <button type="button" data-autofocus className="btn-ghost px-4 text-xs" onClick={cancel}>
            Annuler
          </button>
        </div>
      </>
    )
  } else if (step.k === 'name') {
    const [best, ...others] = step.choices
    body = (
      <>
        <p className="text-sm font-bold">Tu voulais dire « {best.name} »{best.date ? ` (${best.date.split('-').reverse().join('/')})` : ''} ?</p>
        <p className="text-[11px] text-muted">
          {/^\s*(?:le |la |l['’])?(?:prochain|prochaine)\b/i.test(step.said)
            ? `C’est le prochain événement à venir qui correspond à « ${step.said} ».`
            : /^\s*(?:le |la |l['’])?(?:dernier|dernière)\b/i.test(step.said)
              ? `C’est le dernier événement passé qui correspond à « ${step.said} ».`
              : `J’ai compris « ${step.said} », qui n’est pas le nom exact d’${step.kind === 'groupe' ? 'un groupe' : 'un événement'} de cet appareil.`}
          {step.slot === 'suite' ? ' (deuxième étape)' : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-autofocus
            className="btn-primary min-h-10 px-4 text-xs"
            onClick={() => {
              if (step.slot === 'suite') setThenTarget(best)
              else setTarget(best)
              setStep({ k: 'plan' })
            }}
          >
            Oui
          </button>
          <button type="button" className="btn-ghost min-h-10 px-4 text-xs" onClick={cancel}>
            Annuler
          </button>
        </div>
        {others.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold tracking-wider text-muted uppercase">Ou choisir un autre</span>
            {others.map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex min-h-10 items-center rounded-md border border-line bg-panel-2 px-3 py-2 text-left text-xs hover:border-accent"
                onClick={() => {
                  if (step.slot === 'suite') setThenTarget(c)
                  else setTarget(c)
                  setStep({ k: 'plan' })
                }}
              >
                <span className="min-w-0 flex-1 truncate font-bold">{c.name}</span>
                {c.date && <span className="shrink-0 pl-2 text-[10px] text-muted">{c.date.split('-').reverse().join('/')}</span>}
              </button>
            ))}
          </div>
        )}
      </>
    )
  } else if ((step.k === 'ready' || step.k === 'doing') && card && calc && plan) {
    // Export : le format dit d'abord (en couleur, à droite), sinon le premier proposé.
    const mainExport = plan.format && card.exports?.includes(plan.format) ? plan.format : card.exports?.[0]
    body = (
      <>
        <ol className="flex flex-col gap-2 text-sm">
          {card.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ai text-[11px] font-extrabold text-white">{i + 1}</span>
              <span className="min-w-0 flex-1">
                {s}
                {i === 0 && calc.players.length > 0 && (
                  <>
                    {' '}
                    <button type="button" className="text-xs font-bold text-accent underline" aria-expanded={showList} onClick={() => setShowList(!showList)}>
                      {showList ? 'masquer la liste' : 'voir la liste'}
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
        {showList && (
          <ul className="max-h-48 overflow-y-auto rounded-md border border-line bg-panel-2 px-3 py-1.5 text-xs">
            {calc.players.slice(0, LIST_MAX).map((p) => (
              <li key={p.id} className="truncate py-0.5">
                {playerName(p)}
                {p.birthDate ? <span className="text-muted"> · {p.birthDate.slice(0, 4)}</span> : null}
              </li>
            ))}
            {calc.players.length > LIST_MAX && <li className="py-0.5 text-muted">… et {calc.players.length - LIST_MAX} autres</li>}
          </ul>
        )}
        {plan.action === 'creer_groupe' && rights.ok && (
          <label className="flex flex-col gap-1">
            <span className="label">Nom du groupe</span>
            <input
              className="field"
              value={groupName}
              maxLength={60}
              onChange={(e) => {
                setGroupName(e.target.value)
                setNameTouched(true)
              }}
            />
          </label>
        )}
        {card.warnings.map((w) => (
          <p key={w} className="rounded-md border border-amber-500/40 px-2.5 py-1.5 text-[11px] text-amber-300">
            {w}
          </p>
        ))}
        {card.blocked && <p className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-[11px]">{card.blocked}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-ghost min-h-10 px-4 text-xs" onClick={cancel} disabled={step.k === 'doing'} data-autofocus={card.canAccept ? undefined : true}>
            {card.canAccept ? 'Annuler' : 'Fermer'}
          </button>
          {/* Export : un bouton par format (le format dit en premier, en couleur), à la place d'« Accepter ». */}
          {card.canAccept &&
            card.exports &&
            [...card.exports].sort((a, b) => Number(a === mainExport) - Number(b === mainExport)).map((f) => {
              const main = f === mainExport
              return (
                <button
                  key={f}
                  type="button"
                  data-autofocus={main ? true : undefined}
                  className={`${main ? 'btn-primary' : 'btn-ghost'} min-h-10 px-4 text-xs`}
                  onClick={() => void exportAs(f)}
                  disabled={step.k === 'doing'}
                >
                  {f === 'pdf' ? 'PDF / liste à imprimer' : step.k === 'doing' ? 'En cours…' : 'Tableur (CSV)'}
                </button>
              )
            })}
          {card.canAccept && !card.exports && (
            <button type="button" data-autofocus className="btn-primary min-h-10 px-4 text-xs" onClick={() => void accept()} disabled={step.k === 'doing'}>
              {step.k === 'doing' ? 'En cours…' : 'Accepter'}
            </button>
          )}
        </div>
      </>
    )
  } else if (step.k === 'done') {
    body = (
      <>
        <p className="text-sm text-emerald-300" role="status">
          ✓ {step.msg}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {step.undo && undoLeft > 0 && (
            <button
              type="button"
              className="btn-ghost min-h-10 px-4 text-xs"
              onClick={async () => {
                const u = step.undo!
                setStep({ k: 'undoing' })
                try {
                  const msg = await u()
                  setStep({ k: 'done', msg })
                } catch (e) {
                  setStep({ k: 'error', msg: `Impossible de défaire : ${(e as Error)?.message || 'erreur inconnue'}.` })
                }
              }}
            >
              Défaire ({undoLeft} s)
            </button>
          )}
          {step.link && (
            <Link to={step.link.to} className="btn-ghost min-h-10 px-4 text-xs" onClick={onClose}>
              {step.link.label}
            </Link>
          )}
          <button type="button" data-autofocus className="btn-primary min-h-10 px-4 text-xs" onClick={onClose}>
            OK
          </button>
        </div>
      </>
    )
  } else if (step.k === 'error') {
    body = (
      <>
        <p className="text-sm" role="alert">
          {step.msg}
        </p>
        <div className="flex justify-end">
          <button type="button" data-autofocus className="btn-primary min-h-10 px-4 text-xs" onClick={onClose}>
            Fermer
          </button>
        </div>
      </>
    )
  } else {
    body = (
      <div className="flex items-center gap-2 text-xs text-muted" role="status">
        {spinner}
        <span>En cours…</span>
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center scrim p-3 sm:items-center sm:p-4" onClick={cancel}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-action-title"
        className="win flex max-h-[88dvh] w-full max-w-md flex-col gap-3 overflow-y-auto border-ai/40 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none text-ai" aria-hidden>
            ✦
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="ask-action-title" className="text-sm font-extrabold">
              {step.k === 'done' ? 'C’est fait' : step.k === 'error' ? 'Demander' : 'Je vais :'}
            </h2>
            <p className="truncate text-[11px] text-muted" title={req.phrase}>
              « {req.phrase} »
            </p>
          </div>
          <button type="button" className="min-h-9 shrink-0 px-2 text-muted hover:text-fg" aria-label="Fermer" onClick={step.k === 'done' || step.k === 'error' ? onClose : cancel}>
            ✕
          </button>
        </div>
        {body}
      </div>
    </div>,
    document.body,
  )
}
