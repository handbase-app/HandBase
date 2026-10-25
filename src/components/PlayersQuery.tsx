import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { POSITIONS, today, type Player, type Position } from '../db'
import { departmentLabel, regionOfDept, useRegionLabel } from '../lists'
import { groupTag, useRole } from '../roles'
import { categoryStyles, styleOf } from '../radarZones'
import {
  answersNothing,
  avisCriteria,
  defaultSort,
  handsOf,
  interpretRecipe,
  measureCriteria,
  PRIORITY_TEXT,
  putHands,
  putQuarters,
  quartersOf,
  recipeChips,
  runRecipe,
  shareText,
  buildQuestionSchema,
  type Answer,
  type Chip,
  type Population,
  type Recipe,
  type SortBy,
} from '../recipe'
import {
  activeKeys,
  buildPlayersIndex,
  calcRecipe,
  changeText,
  clubPlaces,
  clubsInPlaces,
  cleanQuery,
  decideAction,
  EMPTY_QUERY,
  filterCount,
  hasQuery,
  isNameQuery,
  JOUEURS_KEYS,
  keysForModel,
  keysOfWord,
  listRecipe,
  localQueryCommand,
  mergeQuery,
  missingQuantities,
  needsFullData,
  queryFromSaved,
  quickCounts,
  recipeToSave,
  removeKeys,
  selectPlayers,
  type FilterKey,
  type JoueursQuery,
} from '../playerQuery'
import { useQuestionModel, useRecipeNames, type QuestionModel } from '../questionModel'
import { useListLight } from '../playersCache'
import { deleteQuestion, savedPlace, useSavedQuestions } from '../savedQuestions'
import type { SavedQuestion } from '../recipe'
import { sendQuestionRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import { logQuestion } from '../questionLog'
import { correctQuestionPhrase, rescueInterpretation } from '../questionRescue'
import { AnswerFeedback } from './AnswerFeedback'
import type { RecipeStatus } from '../questionLogCore'
import { cleanSqlSpec, type SqlSpec } from '../sqlGuard'
import { AdvancedBusy, SqlAnswerView, sqlPlayers, useAdvancedAsk, useSqlResult } from './SqlAnswer'
import { ask as confirmAsk } from './Confirm'
import { MicStatus, useMicRecorder } from './MicButton'
import { department, hayOf, readSex, tokensOf, useSessionState, writeSex } from './PlayerFilter'
import { FilterChip, GROUP_OPTIONS, groupLabel, PeriodPicker, RecipeChips, RenameSaved, SaveForm, statText, TargetPicker, valueText, type RecipeModel } from './RecipeChips'
import { Icon } from './ui'
import { Demander, recordAsk, useIncomingAsk } from './Demander'
import { startAskAction } from './AskAction'
import { detectAction } from '../askAction'
import { armSelectAll } from './Selection'
import { YearPicker } from './YearPicker'
import { MultiPicker } from './MultiPicker'
import { ChoicePills, chipCount, CountText, FilterField, FilterWindow, FiltersButton, pillClass, useFilterWindow } from './FilterWindow'
import { BarActionsSlot } from './PageHeader'
import { PictoDisplaySection } from './PictoDisplay'
import { usePictosInFilters } from './Pictos'
import { SegRow } from './ListQuery'
import { putYears, yearsOf } from '../birthYears'
import { appName } from '../appBrand'
import { lateralityPlural, listGender, SEX_LABELS, w, type Gender } from '../gender'
import { listOrigin, type RewatchOrigin } from '../rewatchCore'
import { RewatchOptions } from './RewatchFilter'

/*
 * Filtres de la liste Joueurs = ÉDITEUR DE RECETTE (src/playerQuery.ts, même moteur que « Poser une question », src/recipe.ts).
 *  - En haut, la barre « Demander » (src/components/Demander.tsx : historique, suggestions, menu) et UN micro ✨. Un simple nom (« Martin », « jean-pierre »,
 *    une licence) : recherche locale instantanée (comme avant, noms approchants compris), sans appel. Une phrase dite ou
 *    tapée (Entrée, ✨) : la phrase, la description de la recette et les NOMS des filtres posés partent au mode « question »
 *    (contexte « joueurs ») ; la recette rendue est revérifiée ici puis FUSIONNÉE avec les filtres posés : par défaut elle
 *    AJOUTE ; on n'efface ou ne retire que si c'est dit. Une question de calcul (« quelle est la taille moyenne ? »,
 *    « combien par club ? ») est calculée sur la sélection et affichée au-dessus de la liste, qui reste filtrée.
 *    « Annuler » remet les filtres d'avant ; une ligne dit « Ajouté : … / Retiré : … / Remplacé : … ».
 *  - Les filtres en PASTILLES (mêmes pastilles que la réponse du bilan) : un toucher ouvre la fenêtre « Filtres » sur le
 *    réglage de ce filtre (les conditions : vus, avis, mesures… gardent leur petit réglage), × retire, « Tout effacer ».
 *  - « Filtres » : l'essentiel toujours visible (sexe, années, groupes, région et département), puis « Plus de filtres (N) »,
 *    replié (trimestre, poste, latéralité, club, profil, suivis, vidéo, taille, Pôle, « + Ajouter une condition » : vus,
 *    notes d'avis, nombre d'avis, mesures, événement ; « Trier par », « Mes questions »). Ils construisent la même recette.
 *  - Phrase que la recette n'applique pas entièrement : bascule automatique en MODE AVANCÉ (requête SQL calculée sur une copie
 *    locale, comme au bilan) ; résultat en tête, et la liste devient les joueurs du résultat s'il en donne (colonne joueur_id),
 *    sinon bandeau « Pas pris en compte : … ». Chaque phrase est notée au journal des questions (anonymisée).
 *  - « Enregistrer ce filtre » : une question de « Mes questions », relancée ici ou au bilan.
 *  - État gardé pendant la session (src/playerQuery.ts JOUEURS_KEYS) : « Retour » depuis une fiche retrouve la même liste,
 *    les mêmes pastilles et la même position. Données lourdes (passages, avis, événements) lues seulement au besoin.
 * Aucune donnée de joueur ne part ; uniquement des formulations positives ou neutres sur les jeunes.
 */

const fr = (n: number, d = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: d })
const QUARTER_LABELS = ['Q1 · janv.–mars', 'Q2 · avril–juin', 'Q3 · juil.–sept.', 'Q4 · oct.–déc.']
/**
 * Pastilles dont le réglage est dans la fenêtre « Filtres » (toucher : la fenêtre s'ouvre dessus) ; les autres (vus, avis,
 * mesures, taille maximum…) gardent leur petit réglage sous la barre.
 */
const WINDOW_KEYS = new Set(['sex', 'years', 'quarter', 'positions', 'secondary', 'noPosition', 'hand', 'regions', 'depts', 'clubs', 'height', 'pole', 'video', 'followed', 'profiles', 'rewatch', 'groups', 'events', 'sort'])
/** Filtres de la partie simple de la fenêtre (toujours visibles) ; les autres sont sous « Plus de filtres ». */
const SIMPLE_KEYS = new Set<FilterKey>(['sex', 'years', 'groups', 'regions', 'depts'])
const POLE_LABEL: Record<string, string> = { current: 'Au Pôle Espoirs (en cours)', past: 'Sortis du Pôle Espoirs', any: 'Passés par le Pôle Espoirs (en cours ou sortis)' }
/** Exemples du champ (aide du micro). */
const HINT = 'nés en 2010 de plus d’1 m 85 », « quelle est leur taille moyenne ? », « enlève la taille'

/** Ligne de résultat d'une phrase (gardée pendant la session). */
type ResultLine = {
  phrase: string
  /** Filtres d'avant (« Annuler »), et ceux posés par la phrase (la ligne reste tant qu'ils n'ont pas changé). */
  before: JoueursQuery
  after?: JoueursQuery
  text: string
  notes?: string[]
  unsupported?: string[]
  /** La phrase n'a rien donné d'utile. */
  nothing?: boolean
  /** Ligne du journal de la question (avis sur la réponse). */
  logId?: string
}
type SqlState = { spec: SqlSpec; phrase: string; auto?: boolean; partial?: JoueursQuery; logId?: string }
type Pending = { phrase: string; raw: unknown; nonGere: string[]; action?: string; retirer?: unknown[]; before: JoueursQuery }

const sameQuery = (a: JoueursQuery, b: JoueursQuery) => JSON.stringify(cleanQuery(a)) === JSON.stringify(cleanQuery(b))

/** Dernier index de la recette construit (une seule entrée, comparée par identité des données). */
let lastIndex: { key: unknown[]; ix: ReturnType<typeof buildPlayersIndex<Player>> } | null = null

// ---------- Contexte de la fiche (téléphone : ‹ ›) ----------

let contextIds: string[] = []
/** Joueurs de la liste affichée, dans l'ordre (fiche ouverte depuis la liste : ‹ › sur téléphone). */
export const playersContext = () => contextIds

/**
 * Barre posée sur un autre écran que la liste Joueurs (bilan de détection, src/pages/Coverage.tsx) : sa requête vient de
 * l'écran (`value`, `onChange` : l'adresse), quelques filtres sont des commandes de l'écran (`hidden` : pas de pastille,
 * pas comptés, menus `hideSex` / `hideYear` cachés), pas de tri ni de « Mes questions » (l'écran a les siens), champ
 * compact (`compact`), données de la recette fournies par l'écran (`full`).
 */
export type HostedBar = {
  value: JoueursQuery
  onChange: (q: JoueursQuery) => void
  hidden: ReadonlySet<FilterKey>
  hideSex?: boolean
  hideYear?: boolean
  compact?: boolean
  full?: QuestionModel
  /** L'écran se recalcule (bilan : filtre, lieu) : même signe que la liste qui se recalcule, sous la pilule. */
  busy?: boolean
  /**
   * Filtres propres à l'écran (bilan : sexe, période, années), réglés EN TÊTE de la fenêtre « Filtres » (`panel`) ; posés
   * (valeur autre que celle par défaut) : une pastille chacun avant celles de la barre (`chips` : toucher ouvre la fenêtre
   * sur son réglage, data-filter=`key` ; × le remet par défaut), comptés dans « Filtres n ». « Tout effacer » les remet
   * aussi par défaut : `onReset` reçoit la requête de la barre sans ses pastilles (un seul changement de l'écran).
   */
  own?: { panel: ReactNode; chips: { key: string; label: string; onRemove: () => void }[]; onReset: (q: JoueursQuery) => void }
}

/**
 * Filtres d'une liste de joueurs. `scope` : autre liste que Joueurs (ajout de joueurs à un événement ou un groupe :
 * « ajout-evenement », « ajout-groupe ») : son propre état de session, sans toucher à la liste Joueurs ni à son ‹ ›.
 * `hosted` : barre posée sur un autre écran (le bilan), voir HostedBar.
 */
/**
 * `display` : la liste règle ses pictogrammes dans la fenêtre « Filtres » sur téléphone (section « Affichage »,
 * src/components/PictoDisplay.tsx ; PlayerList `pictosInFilters`).
 * `count` : le nombre de joueurs de la liste filtrée collé devant « Filtres », dans la barre (« 7 sur 40 001 · Filtres ▾ »).
 * Actions de la page (« ⋯ ») : BarActions (src/components/PageHeader.tsx) autour de `ui`, posées à droite de la pilule.
 */
/**
 * `initial` : requête de départ d'une liste à part (`scope`), avant tout choix de la session (page « À revoir » : pas encore
 * revus). `rewatchTop` : les réglages « À revoir » en tête de la fenêtre (page « À revoir »), plus sous « Seulement ».
 */
export function usePlayersQuery(
  players: Player[] | undefined,
  opts: { scope?: string; hosted?: HostedBar; display?: boolean; count?: boolean; initial?: JoueursQuery; rewatchTop?: boolean },
) {
  const hosted = opts.hosted
  const keys = opts.scope
    ? { query: `handbase.${opts.scope}.recette`, text: `handbase.${opts.scope}.texte`, result: `handbase.${opts.scope}.resultat`, sql: `handbase.${opts.scope}.sql` }
    : JOUEURS_KEYS
  const pre = opts.scope ? `handbase.${opts.scope}` : 'handbase.joueurs'
  const regionLabel = useRegionLabel()
  const { questionReady, sqlReady } = useDictation()

  // ---------- État (session) ----------
  const [sessionQuery, setSessionQuery] = useSessionState<unknown>(keys.query, (() => {
    if (opts.initial) return opts.initial
    const sex = readSex()
    return { ...EMPTY_QUERY, recipe: { ...EMPTY_QUERY.recipe, pop: sex !== 'all' ? { sex } : {} } }
  })())
  // Barre posée sur un autre écran : la requête est celle de l'écran (son adresse).
  const rawQuery = hosted ? hosted.value : sessionQuery
  const setRawQuery = (v: unknown, reset = false) =>
    hosted ? (reset && hosted.own ? hosted.own.onReset(cleanQuery(v)) : hosted.onChange(cleanQuery(v))) : setSessionQuery(v)
  const qy = useMemo(() => cleanQuery(rawQuery), [rawQuery])
  const [sessionText, setSessionText] = useSessionState(keys.text, qy.q)
  const [hostedText, setHostedText] = useState(qy.q)
  const [text, setText] = hosted ? [hostedText, setHostedText] : [sessionText, setSessionText]
  // Nom cherché changé par l'écran (retour, adresse) : le champ le reprend (pas pendant la frappe).
  const sentQ = useRef(qy.q)
  useEffect(() => {
    if (!hosted || qy.q === sentQ.current) return
    sentQ.current = qy.q
    if (isNameQuery(text)) setText(qy.q)
  }, [qy.q]) // eslint-disable-line react-hooks/exhaustive-deps
  const [result, setResult] = useSessionState<ResultLine | null>(keys.result, null)
  const [rawSql, setSql] = useSessionState<SqlState | null>(keys.sql, null)
  const sql = useMemo(() => {
    const spec = rawSql ? cleanSqlSpec(rawSql.spec) : null
    return spec && rawSql ? { ...rawSql, spec, partial: rawSql.partial ? cleanQuery(rawSql.partial) : undefined } : null
  }, [rawSql])
  // Fenêtre « Filtres » (src/components/FilterWindow.tsx) : posée au-dessus de la liste, ouverte de n'importe où.
  const fw = useFilterWindow()
  const pictosInFilters = usePictosInFilters()
  const open = fw.open
  const [more, setMore] = useSessionState(`${pre}.conditions`, false)
  const [chipOpen, setChipOpen] = useState<string | null>(null)
  const [asked, setAsked] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [saving, setSaving] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const setQy = (next: JoueursQuery, reset = false) => {
    const clean = cleanQuery(next)
    if (!hosted && (clean.recipe.pop.sex ?? 'all') !== (qy.recipe.pop.sex ?? 'all')) writeSex(clean.recipe.pop.sex ?? 'all')
    sentQ.current = clean.q
    setRawQuery(clean, reset)
    if (clean.q !== qy.q && isNameQuery(text) && clean.q !== text) setText(clean.q)
  }
  const setRecipe = (r: Recipe) => setQy({ ...qy, recipe: listRecipe(r) })
  const setPop = (patch: Partial<Population>) => {
    const pop: Population = { ...qy.recipe.pop, ...patch }
    for (const k of Object.keys(patch) as (keyof Population)[]) if (patch[k] === undefined || patch[k] === false) delete pop[k]
    setRecipe({ ...qy.recipe, pop })
  }

  // ---------- Données ----------
  const wantFull = needsFullData(qy) || asked || !!sql || !!pending || more
  const ownFull = useQuestionModel(wantFull && !hosted?.full)
  const full = hosted?.full ?? ownFull
  // Taille et poids, critères, groupes visibles (groupes Pôle : membres en cours calculés depuis les fiches,
  // src/poleMembers.ts, pour le compteur et le filtre « Groupe »), événements : gardés en mémoire (src/playersCache.ts).
  const light = useListLight()
  const quick = full.quick
  const index = useMemo(() => {
    if (!players || !light) return null
    const src = full.data
    // Mêmes données qu'au dernier passage (retour sur la liste : fiches, mesures et ensembles gardés en mémoire) : même index.
    const key = [players, light, src, quick, today()]
    if (lastIndex && lastIndex.key.every((k, i) => k === key[i])) return lastIndex.ix
    const criteria = src?.criteria ?? light.criteria
    const styles = categoryStyles(criteria)
    const ix = buildPlayersIndex<Player>({
      players,
      sights: src?.sights ?? [],
      evals: src?.evals ?? [],
      measures: src?.measures ?? light.measures,
      criteria,
      groups: src?.groups ?? light.groups,
      events: src?.events ?? light.events,
      deptOf: department,
      regionOf: (d) => regionOfDept(d),
      zoneOf: (c) => styleOf(styles, c).zone,
      today: today(),
      followed: quick.followed,
      videos: quick.videos,
      profileMembers: quick.profileMembers,
      rewatch: quick.rewatch,
    })
    lastIndex = { key, ix }
    return ix
  }, [players, light, full.data, quick])
  const names = useRecipeNames(full.data ?? light, index?.clubNames, quick.profiles)
  const criteria = useMemo(() => full.data?.criteria ?? light?.criteria ?? [], [full.data, light])
  const rmodel: RecipeModel = { names, criteria, events: full.data?.events ?? light?.events }
  const heavyMissing = needsFullData(qy) && !full.data

  // ---------- Liste ----------
  // Calculée en arrière-plan (useDeferredValue) : le champ, les cases et les pastilles suivent tout de suite, la liste (et son
  // nombre) suit dès que le calcul est fait ; pendant ce temps, fine barre sous la pilule et nombre estompé (`calculating`).
  const listQy = useDeferredValue(qy)
  const sel = useMemo(() => (index && !heavyMissing ? selectPlayers(index, listQy, hayOf, tokensOf) : null), [index, listQy, heavyMissing])
  const calcR = useMemo(() => calcRecipe(qy), [qy])
  const calcAns = useMemo(() => (index && calcR && !heavyMissing ? runRecipe(index, calcR) : null), [index, calcR, heavyMissing])
  const viewById = useMemo(() => new Map((players ?? []).map((p) => [p.id, p])), [players])
  const sqlRes = useSqlResult(sql?.spec ?? null, full.source)
  const sqlList = useMemo(() => sqlPlayers(sqlRes.res ?? null, viewById), [sqlRes.res, viewById])
  const fromSql = !!sql && sqlList.players.length > 0
  const filtered = useMemo(() => (fromSql ? sqlList.players : (sel?.list ?? [])), [fromSql, sqlList, sel])
  // Accord (src/gender.ts) : filtre « Féminin », ou liste affichée faite seulement de filles ; sinon masculin générique.
  const gender: Gender = useMemo(() => listGender(qy.recipe.pop.sex, filtered), [qy.recipe.pop.sex, filtered])
  const gw = w(gender)
  useEffect(() => {
    if (!opts.scope) contextIds = filtered.map((p) => p.id)
  }, [filtered, opts.scope])
  // Tri et valeurs : ceux de la liste affichée (calculée en arrière-plan), pour qu'ils aillent avec ses lignes.
  const sortRecipe = useMemo(() => listRecipe(listQy.recipe), [listQy])
  const sorted = !!(listQy.recipe.out.sort || listQy.recipe.avis.length)
  // Stable tant que la liste ne change pas : les lignes ne sont pas redessinées à chaque lettre tapée (src/pages/Players.tsx).
  const valueOf = useCallback(
    (p: Player): string => {
      if (fromSql) return sqlList.extra.get(p.id) ?? ''
      if (!sorted) return ''
      const v = sel?.values.get(p.id)
      return v ? valueText(sortRecipe, names, v.value, v.tag) : ''
    },
    [fromSql, sqlList, sorted, sel, sortRecipe, names],
  )

  // Historique de la barre « Demander » : la page où la demande est faite (bilan : barre posée).
  const askPage = hosted ? 'bilan' : 'joueurs'
  // Demande venue de l'en-tête ou de l'historique (« crée un groupe avec… » : la sélection multiple sera armée une fois
  // les filtres posés : src/components/Selection.tsx).
  const wantSelect = useRef(false)
  const applied = () => {
    if (!wantSelect.current) return
    wantSelect.current = false
    armSelectAll()
  }

  // ---------- Recherche par nom (instantanée, avec un léger délai pendant la frappe) ----------
  const nameMode = !questionReady || isNameQuery(text)
  // Nom tapé pas encore cherché (délai de frappe), ou liste en cours de calcul : le signe d'attente de la liste.
  const typing = nameMode && text.replace(/\s+/g, ' ').trim() !== qy.q.trim()
  const calculating = !!index && !heavyMissing && (typing || listQy !== qy)
  useEffect(() => {
    const q = nameMode ? text.replace(/\s+/g, ' ').trim() : ''
    if (q === qy.q.trim()) return
    const t = window.setTimeout(() => {
      sentQ.current = q
      setRawQuery({ ...qy, q })
      if (q) applied()
    }, q ? 150 : 0)
    return () => window.clearTimeout(t)
  }, [text, nameMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Phrase ----------
  const ctxReady = !!full.ctx && !!index
  const schema = useMemo(
    () => buildQuestionSchema({ criteria, positions: POSITIONS, today: today(), regions: [], depts: [], clubs: [], groups: [], events: [] }),
    [criteria],
  )

  /** Applique une requête venue d'une phrase (ou d'une commande locale) avec sa ligne de résultat. */
  function applyPhrase(phrase: string, before: JoueursQuery, after: JoueursQuery, extra: Partial<ResultLine> = {}) {
    const ch = changeText(recipeChips(listRecipe(before.recipe), names), recipeChips(listRecipe(after.recipe), names), before.q, after.q)
    const calcText = after.calc && JSON.stringify(after.calc) !== JSON.stringify(before.calc) ? 'Calcul sur la sélection : voir la réponse' : ''
    setQy(after)
    setText('')
    setSql(null)
    setResult({ phrase, before, after: cleanQuery(after), text: [ch.text, calcText].filter(Boolean).join(' — ') || (sameQuery(before, after) ? '' : 'Filtres changés'), ...extra })
    recordAsk(askPage, phrase)
    applied()
  }

  async function ask(phrase: string) {
    // Dictée relue comme une question (« vœu » → « Var ») : src/questionRescue.ts.
    const said = correctQuestionPhrase(phrase.replace(/\s+/g, ' ').trim())
    if (!said || abort.current) return
    setError('')
    // Une action (« crée un groupe avec les gauchers de 2011 », « ajoute … au groupe X ») : la carte de validation
    // (src/components/AskAction.tsx) ; rien n'est fait sans « Accepter ». Liste Joueurs seulement (pas le bilan ni l'ajout).
    const act = !hosted && !opts.scope ? detectAction(said, 'joueurs') : null
    if (act) {
      setText('')
      recordAsk(askPage, said)
      startAskAction(said, 'joueurs', act)
      return
    }
    // Simple nom : recherche locale (dite au micro ou tapée).
    if (isNameQuery(said) || !questionReady) {
      setText(said)
      recordAsk(askPage, said)
      return
    }
    // Commandes évidentes, sans appel.
    const local = localQueryCommand(said)
    if (local) {
      const after = local.action === 'effacer' ? EMPTY_QUERY : removeKeys(qy, local.keys)
      if (local.action === 'effacer') setChipOpen(null)
      applyPhrase(said, qy, after)
      return
    }
    setAsked(true)
    setBusy(said)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const ans = await sendQuestionRequest(said, schema, ctrl.signal, { contexte: 'joueurs', actuels: keysForModel(qy) })
      if (ctrl.signal.aborted) return
      setText('')
      setPending({ phrase: said, raw: ans.recette, nonGere: ans.nonGere, action: ans.action, retirer: ans.retirer, before: qy })
    } catch (e) {
      if (!(e instanceof DictationError && e.code === 'annule')) setError(e instanceof DictationError ? e.message : ERROR_TEXT.mistral_erreur)
    } finally {
      if (abort.current === ctrl) abort.current = null
      setBusy('')
    }
  }

  // Où la question est posée (journal des questions) : liste Joueurs, ajout à un événement ou un groupe, bilan.
  const logPage = hosted ? 'bilan' : (opts.scope ?? 'joueurs')
  const adv = useAdvancedAsk(full.source, criteria, index?.data.zoneOf ?? undefined, logPage)

  // Recette rendue par le modèle : relue avec les listes de l'appli (dès qu'elles sont prêtes), fusionnée, notée au journal ;
  // pas tout appliqué : mode avancé (s'il est disponible).
  useEffect(() => {
    if (!pending || !ctxReady || !full.ctx) return
    const p = pending
    setPending(null)
    // Latéralité seule, « en France », « licenciés » : complétés d'après la phrase (src/questionRescue.ts).
    const it = rescueInterpretation(interpretRecipe(p.raw, p.nonGere, full.ctx), p.phrase, full.ctx, { scope: 'liste' })
    const action = decideAction(p.action, p.phrase)
    const remove: FilterKey[] = []
    const notes = [...it.notes]
    for (const r of p.retirer ?? []) {
      const ks = keysOfWord(r)
      if (ks.length) remove.push(...ks)
      else if (typeof r === 'string') notes.push(`retirer « ${r.slice(0, 30)} » (filtre inconnu)`)
    }
    const merged = mergeQuery(p.before, it.recipe, action, remove, (d) => regionOfDept(d))
    // Grandeur demandée que la recette ne calcule pas (sur la sélection fusionnée) : dite, jamais approximée.
    const unsupported = [...it.unsupported]
    if (action !== 'retirer') for (const x of missingQuantities(p.phrase, merged, full.ctx)) if (!unsupported.includes(x)) unsupported.push(x)
    const nothing = action === 'ajouter' && !remove.length && answersNothing(it.recipe, it.unsupported) && sameQuery(merged, p.before)
    const status: RecipeStatus = nothing ? 'pas_comprise' : notes.length || unsupported.length ? 'partielle' : 'complete'
    const missing = [...unsupported, ...notes]
    if (status !== 'complete' && sqlReady && full.source) {
      void (async () => {
        const spec = await adv.ask(p.phrase, 'auto', { recipe: status, missing })
        const logId = adv.lastLogId()
        if (spec) {
          setResult(null)
          setSql({ spec, phrase: p.phrase, auto: true, logId, ...(nothing ? {} : { partial: merged }) })
          recordAsk(askPage, p.phrase)
          applied()
        } else if (nothing) setResult({ phrase: p.phrase, before: p.before, text: '', nothing: true, unsupported, logId })
        else applyPhrase(p.phrase, p.before, merged, { notes, unsupported, logId })
      })()
      return
    }
    const logId = logQuestion({ phrase: p.phrase, recipe: status, recipeMissing: missing, page: logPage }, full.source?.() ?? null)
    if (nothing) setResult({ phrase: p.phrase, before: p.before, text: '', nothing: true, unsupported, logId })
    else applyPhrase(p.phrase, p.before, merged, { notes, unsupported, logId })
  }, [pending, ctxReady]) // eslint-disable-line react-hooks/exhaustive-deps

  const mic = useMicRecorder((t) => void ask(t))
  useIncomingAsk(!hosted && !opts.scope ? 'joueurs' : null, (a) => {
    wantSelect.current = !!a.select
    void ask(a.phrase)
  })
  const rec = mic.phase === 'recording' || mic.phase === 'opening'
  const sending = mic.phase === 'sending' || !!busy || !!pending

  // ---------- Fenêtre « Filtres » : les réglages ----------
  const counts = useMemo(() => (index && open && !heavyMissing ? quickCounts(index, listQy, hayOf, tokensOf) : null), [index, listQy, open, heavyMissing])
  const p = qy.recipe.pop
  const groups = useMemo(() => (full.data?.groups ?? light?.groups ?? []).filter((g) => !g.archived || p.groups?.includes(g.id)), [full.data, light, p.groups])
  const currentGroup = p.groups?.length === 1 ? groups.find((g) => g.id === p.groups![0]) : undefined
  // « À revoir » : joueurs qui en ont (pastille « Seulement »), événements où ils ont été repérés (réglage « Repérés à »).
  const role = useRole()
  const allEvents = full.data?.events ?? light?.events
  const rewatchEvents = useMemo(() => {
    const ids = new Set<string>()
    for (const fs of quick.rewatch.values()) for (const f of fs) if (f.origin) ids.add(f.origin)
    for (const id of p.rewatch?.from ?? []) ids.add(id)
    return (allEvents ?? [])
      .filter((e) => ids.has(e.id))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .map((e) => ({ id: e.id, name: e.name, date: e.date }))
  }, [quick.rewatch, allEvents, p.rewatch?.from])
  const rewatchOptions = (
    <RewatchOptions value={p.rewatch ?? {}} onChange={(rw) => setPop({ rewatch: rw })} events={rewatchEvents} admin={role === 'admin'} fem={gender === 'F'} />
  )
  // Événement (vus ou inscrits) : tous les événements, le plus récent d'abord.
  const eventOptions = useMemo(
    () =>
      [...(allEvents ?? [])]
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        .map((ev) => ({ value: ev.id, label: `${ev.name}${ev.date ? ` (${ev.date.slice(8, 10)}/${ev.date.slice(5, 7)}/${ev.date.slice(0, 4)})` : ''}` })),
    [allEvents],
  )
  // Années cochées (src/birthYears.ts : bornes, et années exactes si elles ne se suivent pas).
  const years = (yearsOf(p) ?? []).map(String).reverse()
  const setYears = (ys: string[]) => {
    const pop: Population = { ...p }
    putYears(pop, ys)
    setRecipe({ ...qy.recipe, pop })
  }
  // Choix multiples (src/recipe.ts) : dans un champ, l'une OU l'autre valeur ; entre les champs, ET.
  const setPopWith = (put: (pop: Population) => void) => {
    const pop: Population = { ...p }
    put(pop)
    setRecipe({ ...qy.recipe, pop })
  }
  const listOrNone = <T,>(xs: T[]) => (xs.length ? xs : undefined)
  // Poste : postes cochés (l'un ou l'autre), ou « Sans poste » (seul).
  const positionValue = p.noPosition ? ['none'] : (p.positions ?? [])
  const setPositions = (vs: string[]) => {
    if (vs.includes('none') && !p.noPosition) return setPop({ noPosition: true, positions: undefined, secondary: undefined })
    const ps = vs.filter((v): v is Position => v !== 'none')
    setPop({ positions: listOrNone(ps), noPosition: undefined, secondary: ps.length ? p.secondary : undefined })
  }
  // Lieu : des régions cochées écartent les départements d'ailleurs (ils ne donneraient personne) ; des départements ou des
  // régions cochés écartent les clubs d'ailleurs (la liste « Club » ne propose que les leurs).
  const places = useMemo(() => (index ? clubPlaces(index) : new Map<string, { depts: Set<string>; regions: Set<string> }>()), [index])
  const setRegions = (rs: string[]) => {
    const depts = rs.length && p.depts ? listOrNone(p.depts.filter((d) => rs.includes(regionOfDept(d) ?? ''))) : p.depts
    setPop({ regions: listOrNone(rs), depts, clubs: clubsInPlaces(p.clubs, places, depts, rs) })
  }
  const setDepts = (ds: string[]) => setPop({ depts: listOrNone(ds), clubs: clubsInPlaces(p.clubs, places, ds, p.regions) })
  const regionOptions = [...(counts?.regions ?? [])]
    .sort((a, b) => regionLabel(a[0]).localeCompare(regionLabel(b[0]), 'fr'))
    .map(([r, n]) => ({ value: r, label: regionLabel(r), count: n }))
  const deptOptions = (counts?.depts ?? []).map(([d, n]) => ({ value: d, label: departmentLabel(d), count: n }))
  const clubOptions = [...(counts?.clubs ?? [])].sort((a, b) => a[2].localeCompare(b[2], 'fr')).map(([k, n, name]) => ({ value: k, label: name, count: n }))
  // Un club coché qui n'est plus proposé (autres filtres) garde son nom.
  for (const k of p.clubs ?? []) if (!clubOptions.some((o) => o.value === k)) clubOptions.push({ value: k, label: names.club(k), count: 0 })

  // Filtres visibles (barre posée : sans ceux que l'écran commande lui-même).
  const shownKeys = activeKeys(qy).filter((k) => !hosted?.hidden.has(k))
  // Filtres propres de l'écran posés (bilan : sexe, période, années) : pastilles et nombre de « Filtres ».
  const own = hosted?.own
  const ownChips = own?.chips ?? []
  const clearable = (hosted ? shownKeys.length > 0 || ownChips.length > 0 : hasQuery(qy)) || !!qy.calc
  const reset = () => {
    // Barre posée : « Tout effacer » retire ses pastilles, pas les commandes de l'écran (lieu ; sexe et années, sauf filtres
    // propres de l'écran dans la fenêtre : remis par défaut avec, `own.onReset`).
    setQy(hosted ? removeKeys({ ...qy, calc: undefined }, shownKeys) : EMPTY_QUERY, true)
    setText('')
    setResult(null)
    setSql(null)
    setChipOpen(null)
  }

  /** Nouvelle condition (repliée sous « + Ajouter une condition ») : posée, et sa pastille ouverte pour la régler. */
  const addCondition = (kind: 'seen' | 'avis' | 'nbAvis' | 'measure' | 'heightMax') => {
    const r: Recipe = structuredClone(qy.recipe)
    let key = ''
    if (kind === 'seen') {
      r.seen ??= { by: 'event', op: 'gte', n: 1, period: { kind: 'season' } }
      key = 'seen'
    } else if (kind === 'avis') {
      r.avis.push({ target: { on: 'global' }, op: 'gte', value: 3 })
      key = `avis.${r.avis.length - 1}`
    } else if (kind === 'nbAvis') {
      r.nbAvis ??= { op: 'gte', n: 1 }
      key = 'nbAvis'
    } else if (kind === 'measure') {
      const m = measureCriteria(criteria).find((c) => c.id !== 'taille') ?? measureCriteria(criteria)[0]
      if (!m) return
      r.measures.push({ id: m.id, op: 'gte', value: 0 })
      key = `measure.${r.measures.length - 1}`
    } else {
      r.pop.hMax ??= 200
      key = 'height'
    }
    setRecipe(r)
    setChipOpen(key)
  }

  const saved = useSavedQuestions()
  // « Mes filtres » de la fenêtre Filtres : ouvert depuis le menu de la barre Demander (« Tous mes filtres »).
  const [savedOpen, setSavedOpen] = useState(false)
  /** Applique une question enregistrée (menu de la barre Demander ou « Mes filtres » de la fenêtre) : ses filtres et son tri. */
  const applySaved = (q: SavedQuestion) => {
    if (q.sql) setSql({ spec: q.sql, phrase: q.name })
    else {
      setQy(queryFromSaved(q.recipe))
      setSql(null)
    }
    setResult(null)
  }
  // « Plus de filtres » : ouvert ou fermé gardé pendant la session ; il s'ouvre de lui-même à l'ouverture de la fenêtre si un
  // de ses filtres est posé (et quand on touche sa pastille).
  const [advOpen, setAdvOpen] = useSessionState(`${pre}.avance`, false)
  const advN = activeKeys(qy).filter((k) => !SIMPLE_KEYS.has(k) && k !== 'names' && k !== 'q' && !hosted?.hidden.has(k)).length
  useEffect(() => {
    if (open && advN > 0) setAdvOpen(true)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  // Réglages de « Plus de filtres » : tous de la même hauteur et du même texte que ceux du haut (40 px, 12 px).
  const ctl = 'min-h-10 px-2 py-1.5 text-xs'
  // Deux niveaux : l'essentiel toujours visible (sexe, années, groupes, région et département) ; « Plus de filtres »
  // (replié ; ouvert de lui-même si un de ses filtres est posé ou si l'on touche sa pastille) : le reste.
  const panel = (
    <>
      {opts.rewatchTop && rewatchOptions}
      {!hosted?.hideSex && (
        <SegRow<'M' | 'F'>
          k="sex"
          label={`${SEX_LABELS.M} / ${SEX_LABELS.F.toLowerCase()}`}
          value={p.sex ?? ''}
          options={[
            { value: 'M', label: SEX_LABELS.M },
            { value: 'F', label: SEX_LABELS.F },
          ]}
          onChange={(v) => setPop({ sex: v || undefined })}
        />
      )}
      {!hosted?.hideYear && (
        <FilterField label="Année de naissance" k="years">
          <YearPicker
            className="min-h-10 px-2 py-1.5 text-xs"
            allLabel="Toutes les années"
            value={years}
            options={(counts?.years ?? []).map(([y, n]) => ({ value: y, count: n }))}
            onChange={setYears}
          />
        </FilterField>
      )}
      {groups.length > 0 && (
        <FilterField label="Groupe" k="groups">
          <MultiPicker
            className="min-h-10 px-2 py-1.5 text-xs"
            label="Groupe"
            allLabel="Aucun"
            noun={['groupe', 'groupes']}
            value={p.groups ?? []}
            // Nombre : joueurs du groupe qui répondent aux autres filtres (lieu compris).
            options={groups.map((g) => ({ value: g.id, label: `${g.name}${groupTag(g)}${g.archived ? ' — archivé' : ''}`, count: counts?.groups.get(g.id) ?? g.playerIds.length }))}
            // Groupe ET lieu se combinent : « les joueurs du groupe X qui sont du Var ».
            onChange={(xs) => setPop({ groups: listOrNone(xs) })}
          />
        </FilterField>
      )}
      {(regionOptions.length > 0 || p.regions || deptOptions.length > 0 || p.depts) && (
        <div className="grid grid-cols-2 gap-2">
          <FilterField label="Région" k="regions">
            <MultiPicker
              className="min-h-10 px-2 py-1.5 text-xs"
              label="Région"
              allLabel="Toutes"
              allCount={counts?.regionTotal}
              noun={['région', 'régions']}
              value={p.regions ?? []}
              options={regionOptions}
              onChange={setRegions}
            />
          </FilterField>
          <FilterField label="Département" k="depts">
            <MultiPicker
              className="min-h-10 px-2 py-1.5 text-xs"
              label="Département"
              allLabel="Tous"
              allCount={counts?.deptTotal}
              noun={['département', 'départements']}
              value={p.depts ?? []}
              options={deptOptions}
              onChange={setDepts}
            />
          </FilterField>
        </div>
      )}
      {!hosted && <SavedOnList saved={saved} open={savedOpen} setOpen={setSavedOpen} onApply={applySaved} />}
      <div className="rounded-md border border-line">
        <button type="button" className="flex min-h-11 w-full items-center gap-2 px-2 text-left text-xs font-bold" aria-expanded={advOpen} onClick={() => setAdvOpen(!advOpen)}>
          <span className="flex-1">
            Plus de filtres{advN > 0 ? ` (${advN})` : ''}
          </span>
          <span className={`text-muted transition ${advOpen ? 'rotate-90' : ''}`}>›</span>
        </button>
        {advOpen && (
          // Un seul gabarit : nom en petites capitales au-dessus, réglage dessous ; champs courts deux par ligne quand la
          // place le permet (conteneur d'au moins 22 rem) ; outils (conditions, tri, mes questions) après un filet.
          <div className="@container flex flex-col gap-3 border-t border-line px-2.5 py-3">
            <ChoicePills
              small
              k="quarter"
              label="Trimestre de naissance"
              value={quartersOf(p).map(String)}
              options={QUARTER_LABELS.map((l, i) => ({ value: String(i + 1), label: l, short: `Q${i + 1}` }))}
              onChange={(vs) => setPopWith((pop) => putQuarters(pop, vs.map(Number)))}
            />
            <ChoicePills
              small
              k="positions secondary noPosition"
              label="Poste"
              value={positionValue}
              options={[
                ...POSITIONS.map((x) => ({ value: x.id as string, label: x.label, short: x.short })),
                ...((counts?.positions.none ?? 0) > 0 || p.noPosition ? [{ value: 'none', label: 'Sans poste' }] : []),
              ]}
              counts={counts?.positions}
              total={counts?.positionTotal}
              onChange={setPositions}
              extra={
                <label className={`flex min-h-8 basis-full items-center gap-1.5 text-[11px] text-muted ${p.positions ? '' : 'opacity-60'}`}>
                  <input type="checkbox" className="h-4 w-4 accent-accent" checked={!!p.secondary} disabled={!p.positions} onChange={(e) => setPop({ secondary: e.target.checked || undefined })} />
                  Inclure les postes secondaires
                </label>
              }
            />
            <ChoicePills
              small
              k="hand"
              label="Latéralité"
              allLabel="Toutes"
              value={handsOf(p)}
              options={(['droitier', 'gaucher', 'ambidextre'] as const).map((v) => ({ value: v, label: lateralityPlural(v, gender) }))}
              onChange={(vs) => setPopWith((pop) => putHands(pop, vs))}
            />
            <div className={`grid gap-3 ${quick.profiles.length > 0 ? '@min-[22rem]:grid-cols-2 @min-[22rem]:gap-2' : ''}`}>
              <FilterField label="Club" k="clubs">
                <MultiPicker
                  className={ctl}
                  label="Club"
                  allLabel={`${p.depts || p.regions ? 'Tous leurs clubs' : 'Tous les clubs'} (${fr(counts?.clubTotal ?? 0)})`}
                  noun={['club', 'clubs']}
                  value={p.clubs ?? []}
                  options={clubOptions}
                  onChange={(cs) => setPop({ clubs: listOrNone(cs) })}
                />
              </FilterField>
              {quick.profiles.length > 0 && (
                <FilterField label="Profil recherché" k="profiles">
                  <MultiPicker
                    className={ctl}
                    label="Profil recherché"
                    allLabel="Aucun"
                    noun={['profil', 'profils']}
                    value={p.profiles ?? []}
                    options={quick.profiles.map((a) => ({ value: a.id, label: a.name, count: quick.profileMembers.get(a.id)?.size ?? 0 }))}
                    onChange={(xs) => setPop({ profiles: listOrNone(xs) })}
                  />
                </FilterField>
              )}
            </div>
            {eventOptions.length > 0 && (
              <FilterField label="Événement (vus ou inscrits)" k="events">
                <MultiPicker
                  className={ctl}
                  label="Événement"
                  allLabel="Tous les événements"
                  noun={['événement', 'événements']}
                  value={p.events ?? []}
                  options={eventOptions}
                  onChange={(xs) => setPop({ events: listOrNone(xs) })}
                />
              </FilterField>
            )}
            <FilterField label="Seulement" k={opts.rewatchTop ? 'video followed' : 'video followed rewatch'}>
              <div className="flex flex-wrap gap-1">
                <button type="button" aria-pressed={!!p.video} onClick={() => setPop({ video: !p.video })} className={pillClass(!!p.video, true)}>
                  Avec une vidéo
                </button>
                {(quick.followed.size > 0 || p.followed) && (
                  <button type="button" aria-pressed={!!p.followed} onClick={() => setPop({ followed: !p.followed })} className={`inline-flex items-center gap-1 ${pillClass(!!p.followed, true)}`}>
                    <Icon name="star" filled={p.followed} className={`h-3 w-3 ${p.followed ? '' : 'text-accent'}`} />
                    Mes suivis
                    <span className="text-[10px] font-normal tabular-nums opacity-75">{fr(quick.followed.size)}</span>
                  </button>
                )}
                {!opts.rewatchTop && (quick.rewatch.size > 0 || p.rewatch) && (
                  <button
                    type="button"
                    aria-pressed={!!p.rewatch}
                    onClick={() => setPop({ rewatch: p.rewatch ? undefined : {} })}
                    className={`inline-flex items-center gap-1 ${pillClass(!!p.rewatch, true)}`}
                  >
                    <Icon name="clock" className={`h-3 w-3 ${p.rewatch ? '' : 'text-sky-300'}`} />À revoir
                    <span className="text-[10px] font-normal tabular-nums opacity-75">{fr(quick.rewatch.size)}</span>
                  </button>
                )}
              </div>
              {!opts.rewatchTop && p.rewatch && rewatchOptions}
            </FilterField>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
              <FilterField label="Taille min. (cm)" k="height">
                <HeightInput className={ctl} value={p.hMin} onChange={(hMin) => setPop({ hMin })} />
              </FilterField>
              <FilterField label="Pôle Espoirs" k="pole">
                <CompactSelect
                  className={`${ctl} ${p.pole ? 'border-accent font-bold' : ''}`}
                  label="Pôle Espoirs"
                  value={p.pole ?? ''}
                  onChange={(v) => setPop({ pole: (v || undefined) as Population['pole'] })}
                  options={[
                    { value: '', label: gw.tousLesJoueurs[0].toUpperCase() + gw.tousLesJoueurs.slice(1) },
                    { value: 'current', label: POLE_LABEL.current },
                    { value: 'past', label: POLE_LABEL.past },
                    { value: 'any', label: POLE_LABEL.any },
                  ]}
                />
              </FilterField>
            </div>
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              <div className="flex flex-col gap-2">
                <button type="button" className="flex min-h-9 w-full items-center gap-2 text-left text-xs font-bold" aria-expanded={more} onClick={() => setMore(!more)}>
                  <span className="flex-1">
                    <span className="text-accent">+</span> Ajouter une condition
                  </span>
                  <span className={`text-muted transition ${more ? 'rotate-90' : ''}`}>›</span>
                </button>
                {more && (
                  <>
                    {!full.data && <p className="text-[11px] text-muted">Chargement des avis et des passages…</p>}
                    <div className="flex flex-wrap gap-1">
                      <button type="button" className={pillClass(false, true)} onClick={() => addCondition('seen')}>
                        Vus (combien, quand, par qui)
                      </button>
                      {avisCriteria(criteria).length > 0 && (
                        <button type="button" className={pillClass(false, true)} onClick={() => addCondition('avis')}>
                          Note d’avis
                        </button>
                      )}
                      <button type="button" className={pillClass(false, true)} onClick={() => addCondition('nbAvis')}>
                        Nombre d’avis
                      </button>
                      {measureCriteria(criteria).length > 0 && (
                        <button type="button" className={pillClass(false, true)} onClick={() => addCondition('measure')}>
                          Mesure
                        </button>
                      )}
                      <button type="button" className={pillClass(false, true)} onClick={() => addCondition('heightMax')}>
                        Taille maximum
                      </button>
                    </div>
                    <p className="text-[10px] text-muted">La condition s’ajoute en pastille : touchez-la pour la régler.</p>
                  </>
                )}
              </div>
              {!hosted && <SortPicker recipe={qy.recipe} model={rmodel} onChange={setRecipe} ctl={ctl} />}
            </div>
          </div>
        )}
      </div>
    </>
  )

  // ---------- Champ, micro, pastilles, ligne de résultat ----------
  const nChips = filterCount(qy, hosted?.hidden) + ownChips.length
  const keepChip = (c: Chip) =>
    c.key !== 'out' && c.key !== 'limit' && !(c.key === 'sort' && !c.removable && !qy.recipe.avis.length) && !hosted?.hidden.has(c.key as FilterKey)
  // Le micro charge les données de la recette pendant qu'on parle.
  const micForField = questionReady && !hosted ? { ...mic, buttonProps: { ...mic.buttonProps, onPointerDown: (e: Parameters<typeof mic.buttonProps.onPointerDown>[0]) => (!asked && setAsked(true), mic.buttonProps.onPointerDown(e)) } } : undefined
  // « Filtres » logé dans la barre (étiquette arrondie, comme « Mode IA » chez Google) ; la barre posée du bilan garde son bouton.
  const filtersChip = (
    <FiltersButton
      w={fw}
      n={nChips}
      count={opts.count ? chipCount(filtered.length, (n: number) => (n > 1 ? gw.joueurs : gw.joueur), { loading: !sel && !fromSql, busy: calculating && !fromSql }) : undefined}
    />
  )
  const field = (
    <Demander
      page={askPage}
      value={text}
      onChange={setText}
      onSubmit={(t) => void ask(t)}
      onFocus={() => questionReady && !asked && setAsked(true)}
      canAsk={questionReady}
      nameMode={nameMode}
      mic={micForField}
      micHint={HINT}
      disabled={sending || rec}
      wait={busy || pending ? { phrase: busy || pending?.phrase, cancel: busy ? () => abort.current?.abort() : undefined } : null}
      calculating={calculating || !!hosted?.busy}
      compact={hosted?.compact}
      label={questionReady ? 'Demander : filtrer ou poser une question' : 'Rechercher un joueur'}
      trailing={!hosted ? filtersChip : undefined}
      saved={
        !hosted
          ? {
              title: 'Mes filtres',
              items: saved,
              onPick: applySaved,
              onShowAll: () => {
                setSavedOpen(true)
                fw.openAt('saved')
              },
              all: (n) => `Tous mes filtres (${n})`,
              manage: 'Gérer mes filtres',
            }
          : undefined
      }
    />
  )
  const filtersButton = <FiltersButton w={fw} n={nChips} variant="pill" compact={hosted?.compact} />
  // La ligne reste tant que les filtres sont ceux posés par la phrase.
  const shownResult = result && (result.nothing || !result.after || sameQuery(result.after, qy)) ? result : null
  // Attente de l'assistant (phrase envoyée, transcription) : dans la pilule et juste dessous (Demander), pas de ligne en plus.
  const status =
    rec ? (
      <MicStatus mic={mic} dictated={false} />
    ) : sending ? null : error ? (
      <div className="text-[11px] text-red-300" role="alert">
        {error}
      </div>
    ) : shownResult ? (
      <ResultView
        r={shownResult}
        onUndo={() => (setQy(shownResult.before), setResult(null), setSql(null))}
        onClose={() => setResult(null)}
        onSave={!hosted && !saving ? () => setSaving(true) : undefined}
        sqlButton={
          sqlReady && full.source && !shownResult.nothing && (shownResult.notes?.length || shownResult.unsupported?.length)
            ? async () => {
                const spec = await adv.ask(shownResult.phrase, 'button', { recipe: 'partielle', missing: [...(shownResult.unsupported ?? []), ...(shownResult.notes ?? [])] })
                if (spec) setSql({ spec, phrase: shownResult.phrase, partial: qy, logId: adv.lastLogId() })
              }
            : undefined
        }
      />
    ) : !nameMode && text.trim() ? (
      <div className="text-[10px] text-muted">Entrée ou ✨ : la phrase s’ajoute aux filtres (seule la phrase est envoyée, jamais les données des joueurs).</div>
    ) : sel?.approx ? (
      <div className="text-[11px] text-muted" role="status">
        Résultats approchants pour « {qy.q.trim()} »
      </div>
    ) : questionReady && qy.q.trim() && sel && !sel.list.length && !fromSql ? (
      <button type="button" className="min-h-9 self-start text-[11px] font-bold text-accent underline" onClick={() => void ask(`les joueurs ${qy.q.trim()}`)}>
        ✨ Comprendre « {qy.q.trim()} » comme une phrase
      </button>
    ) : null
  const chips = (
    <RecipeChips
      recipe={qy.recipe}
      names={names}
      model={rmodel}
      onChange={setRecipe}
      keep={keepChip}
      open={chipOpen}
      setOpen={setChipOpen}
      quickRemove
      inWindow={(c) => WINDOW_KEYS.has(c.key) && !(c.key === 'height' && p.hMax) && !(c.key === 'sort' && hosted)}
      onOpenWindow={(c) => {
        // Filtre rangé sous « Plus de filtres » : déplié (« À revoir » de la page « À revoir » : en tête de la fenêtre).
        if (!SIMPLE_KEYS.has(c.key as FilterKey) && !(opts.rewatchTop && c.key === 'rewatch')) setAdvOpen(true)
        fw.openAt(c.key)
      }}
      before={
        ownChips.length > 0 &&
        ownChips.map((c) => <FilterChip key={c.key} label={c.label} open={false} edit opensWindow onToggle={() => fw.openAt(c.key)} onRemove={c.onRemove} />)
      }
      after={
        clearable ? (
          <>
            <button type="button" className="min-h-9 px-1 text-[11px] font-bold text-muted underline" onClick={reset}>
              Tout effacer
            </button>
            {!saving && !hosted && (
              <button type="button" className="flex min-h-9 items-center gap-1 px-1 text-[11px] font-bold text-muted underline" onClick={() => setSaving(true)}>
                <Icon name="star" className="h-3 w-3" />
                Enregistrer ce filtre
              </button>
            )}
          </>
        ) : undefined
      }
    />
  )
  const saveForm = saving && <SaveForm filter recipe={recipeToSave(qy)} names={names} phrase={result?.phrase} onDone={() => setSaving(false)} />
  const privacy = questionReady && (
    <p className="text-[10px] text-muted">
      Une phrase envoie seulement ses mots (et les noms des filtres posés), jamais les données des joueurs ; elle peut être notée, sans nom de joueur, pour
      améliorer {appName()}.{' '}
      <Link to="/confidentialite#questions" className="underline">
        Confidentialité
      </Link>
    </p>
  )

  // La fenêtre « Filtres » : réglages, puis « 1 234 joueurs sur 40 001 », « Tout effacer », « Fermer ».
  const filterWindow = (
    <FilterWindow
      w={fw}
      count={<CountText n={filtered.length} noun={(n) => (n > 1 ? gw.joueurs : gw.joueur)} />}
      onClear={clearable ? reset : undefined}
    >
      {own?.panel}
      {panel}
      {/* Téléphone : ce qu'on voit au bout des lignes (pictogrammes), à part des filtres. */}
      {opts.display && pictosInFilters && <PictoDisplaySection />}
      {privacy}
    </FilterWindow>
  )

  // Barre « Demander », pastilles et filtres : largeur maximale, centrés (façon Google) sur grand écran.
  const ui = (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      <div className="flex items-center gap-2">
        {field}
        <BarActionsSlot />
      </div>
      {status}
      {chips}
      {saveForm}
      {filterWindow}
    </div>
  )

  // ---------- Au-dessus de la liste : calcul, mode avancé ----------
  const top = (
    <>
      {adv.busy && <AdvancedBusy heard={sql?.phrase ?? result?.phrase} onCancel={adv.cancel} />}
      {adv.error && !adv.busy && (
        <p className="text-[11px] text-red-300" role="alert">
          {adv.error}
        </p>
      )}
      {shownResult?.nothing && (
        <div className="card flex flex-col gap-1 border-sky-500/40 p-3 text-xs" role="status">
          <p className="font-bold">Je ne sais pas encore répondre à : « {shownResult.phrase} »</p>
          {!!shownResult.unsupported?.length && <p className="text-muted">Pas compris : {shownResult.unsupported.join(' ; ')}</p>}
          <p className="text-muted">Les filtres n’ont pas changé. Essayez par exemple « nés en 2010 de plus d’1 m 85 » ou « combien sont-ils par club ? ».</p>
        </div>
      )}
      {sql && (
        <div className="card flex flex-col gap-2 border-sky-500/40 p-3">
          <div className="flex items-start gap-2 text-[11px]">
            <p className="min-w-0 flex-1">
              <b>Résultat du mode avancé</b>
              {sql.auto ? ' (la phrase demandait plus que les filtres habituels)' : ''} pour « {sql.phrase} » : {sql.spec.explanation.replace(/[\s.]+$/, '')}
              {fromSql ? ` — la liste montre les ${gw.joueurs} du résultat.` : '.'}
            </p>
            <button type="button" className="min-h-9 shrink-0 px-1 text-muted" aria-label="Fermer le résultat du mode avancé" onClick={() => setSql(null)}>
              ✕
            </button>
          </div>
          <SqlAnswerView spec={sql.spec} source={full.source} byId={viewById} search="" playerLink={(id) => `/joueurs/${id}`} hidePlayers />
          <div className="flex flex-wrap gap-2">
            {sql.partial && (
              <button type="button" className="min-h-9 text-[11px] text-muted underline" onClick={() => applyPhrase(sql.phrase, qy, sql.partial!, { notes: ['réponse simplifiée'] })}>
                Appliquer plutôt la réponse simplifiée aux filtres
              </button>
            )}
            <details className="text-[11px]">
              <summary className="min-h-9 cursor-pointer py-1 font-bold text-muted">Voir la requête</summary>
              <pre className="mt-1 rounded-md border border-line bg-fg/5 p-2 font-mono text-[11px] break-words whitespace-pre-wrap">{sql.spec.sql}</pre>
            </details>
          </div>
        </div>
      )}
      {qy.calc && calcR && !fromSql && (
        <CalcView recipe={calcR} answer={calcAns} model={rmodel} loading={heavyMissing} gender={gender} onClose={() => setQy({ ...qy, calc: undefined })} />
      )}
      {/* Avis sur la réponse (phase de test) : mode avancé, sinon la phrase dont les filtres sont à l'écran. */}
      {!adv.busy && <AnswerFeedback questionId={adv.error ? adv.logId : (sql?.logId ?? shownResult?.logId)} page={logPage} />}
      {heavyMissing && <p className="text-[11px] text-muted">Chargement des avis et des passages…</p>}
      {sorted && !fromSql && !!sel?.unranked && (
        <p className="text-[11px] text-muted">
          {fr(sel.unranked)} sans valeur pour ce tri ({defaultSort(sortRecipe).by === 'priority' ? `déjà ${gw.vus} deux fois ou plus` : 'pas d’avis ou pas de mesure'}) : en fin de liste.
        </p>
      )}
      {defaultSort(sortRecipe).by === 'priority' && qy.recipe.out.sort && !fromSql && (
        <p className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-[11px]">
          <b>Priorité</b> : {PRIORITY_TEXT}.
        </p>
      )}
    </>
  )

  /** Change dès qu'un filtre change (pas quand les données se mettent à jour). */
  const signature = JSON.stringify([qy.recipe, qy.q, sql?.spec.sql ?? ''])
  // Barre posée : ses morceaux, que l'écran place lui-même (champ et « Filtres » sur la ligne de ses filtres, le reste dessous).
  const parts = {
    field,
    filtersButton,
    /** « Filtres » en étiquette arrondie, à loger DANS une barre « Demander » (bilan : la barre du haut). */
    filtersChip,
    below: (
      <>
        {status}
        {chips}
        {saveForm}
      </>
    ),
    /** La fenêtre « Filtres » (posée dans le document, au-dessus de l'écran) : à rendre même quand la barre est repliée. */
    window: filterWindow,
    top,
    open,
    nChips,
    chipLabels: recipeChips(qy.recipe, names).filter(keepChip).filter((c) => c.key !== 'period').map((c) => c.label),
    wantFull,
  }
  // Liste sans filtre (le filtre « Masculin / Féminin » seul permis), ni phrase en cours : ses premières fiches peuvent être
  // montrées avant que tout soit lu (src/pages/Players.tsx, src/playersCache.ts usePlainPreview).
  const plain = !sql && !pending && activeKeys(qy).every((k) => k === 'sex') && !(nameMode && text.trim())
  // D'où un « à revoir » est posé depuis cette liste (src/rewatchPlace.tsx) : le filtre enregistré appliqué tel quel, sinon
  // les filtres posés (sans nom cherché : un nom de joueur ne part jamais). Lu au clic : toujours la liste à l'écran.
  const originRef = useRef<() => RewatchOrigin>(() => ({ kind: 'list' }))
  useEffect(() => {
    originRef.current = () => {
      const same = saved.find((x) => !x.sql && sameQuery(queryFromSaved(x.recipe), { ...qy, q: '' }))
      const labels = recipeChips(qy.recipe, names)
        .filter((c) => keepChip(c) && !['period', 'sort', 'names', 'outPeriod', 'value'].includes(c.key))
        .map((c) => c.label)
      return listOrigin(labels, same?.name)
    }
  })
  const rewatchOrigin = useCallback(() => originRef.current(), [])
  return {
    filtered,
    ui,
    top,
    signature,
    group: currentGroup,
    valueOf,
    loading: !sel && !fromSql,
    calculating: calculating && !fromSql,
    fromSql,
    parts,
    gender,
    plain,
    sex: qy.recipe.pop.sex,
    rewatchOrigin,
    query: qy,
  }
}

// ---------- Petits composants ----------

/** Taille minimum (cm) : texte libre, appliqué dès qu'il est lisible (100 à 230). */
function HeightInput({ value, onChange, className = '' }: { value?: number; onChange: (v: number | undefined) => void; className?: string }) {
  const [text, setText] = useState(value ? String(value) : '')
  const shown = useRef(value)
  useEffect(() => {
    if (value !== shown.current) {
      shown.current = value
      setText(value ? String(value) : '')
    }
  }, [value])
  return (
    <input
      className={`field min-w-0 ${className} ${value ? 'border-accent font-bold' : ''}`}
      type="number"
      inputMode="numeric"
      placeholder="ex. 180"
      aria-label="Taille minimum (cm)"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        const next = e.target.value.trim() && Number.isInteger(n) && n >= 100 && n <= 230 ? n : undefined
        if (!e.target.value.trim() || next) {
          shown.current = next
          onChange(next)
        }
      }}
    />
  )
}

const SORTS: { value: SortBy | ''; label: string }[] = [
  { value: '', label: 'Nom' },
  { value: 'year', label: 'Année de naissance' },
  { value: 'height', label: 'Taille' },
  { value: 'seen', label: 'Nombre de vus' },
  { value: 'avg', label: 'Note d’avis (moyenne)' },
  { value: 'nbAvis', label: 'Nombre d’avis' },
  { value: 'measure', label: 'Mesure' },
  { value: 'progress', label: 'Progression entre les deux derniers avis' },
  { value: 'priority', label: 'À voir en priorité' },
]

/**
 * Liste déroulante de « Plus de filtres » : même bouton que les choix multiples (MultiPicker : hauteur, texte, flèche
 * dessinée), mais une vraie liste du navigateur.
 */
function CompactSelect<T extends string>({ value, options, onChange, label, className = '' }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div className="relative min-w-0 flex-1">
      <select className={`field appearance-none truncate pr-6 ${className}`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg viewBox="0 0 12 12" className="pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2 opacity-70" aria-hidden>
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** « Trier par » : le tri de la liste (même recette que « classés par taille » dit au micro). `ctl` : hauteur et texte des réglages. */
function SortPicker({ recipe, model, onChange, ctl }: { recipe: Recipe; model: RecipeModel; onChange: (r: Recipe) => void; ctl: string }) {
  const s = recipe.out.sort
  const ms = measureCriteria(model.criteria)
  const set = (patch: Partial<Recipe['out']>) => onChange({ ...recipe, out: { ...recipe.out, type: 'list', ...patch } })
  return (
    <FilterField label="Trier par" k="sort">
      <div className="flex items-stretch gap-2">
        <CompactSelect<SortBy | ''>
          className={`${ctl} ${s ? 'border-accent font-bold' : ''}`}
          label="Trier par"
          value={s?.by ?? ''}
          options={SORTS.filter((o) => o.value !== 'measure' || ms.length)}
          onChange={(by) => {
            if (!by) return onChange({ ...recipe, out: { type: 'list' } })
            set({ sort: { by, dir: by === 'name' ? 'asc' : 'desc' }, ...(by === 'measure' ? { measure: recipe.out.measure ?? recipe.measures[0]?.id ?? ms[0]?.id } : {}) })
          }}
        />
        {s && s.by !== 'priority' && (
          <div className="flex shrink-0 overflow-hidden rounded-md border border-line text-xs font-bold" role="group" aria-label="Sens du tri">
            {(
              [
                ['asc', '↑', 'Croissant'],
                ['desc', '↓', 'Décroissant'],
              ] as const
            ).map(([dir, arrow, name]) => (
              <button
                key={dir}
                type="button"
                aria-pressed={s.dir === dir}
                aria-label={name}
                title={name}
                onClick={() => set({ sort: { by: s.by, dir } })}
                className={`min-h-10 w-10 ${s.dir === dir ? 'bg-accent text-white' : 'bg-panel-2 text-muted hover:text-fg'}`}
              >
                {arrow}
              </button>
            ))}
          </div>
        )}
      </div>
      {s && (s.by === 'avg' || s.by === 'progress') && (
        <TargetPicker value={recipe.out.avg ?? recipe.avis[0]?.target ?? { on: 'global' }} model={model} onChange={(t) => set({ avg: t })} />
      )}
      {s?.by === 'measure' && (
        <CompactSelect
          className={ctl}
          label="Mesure"
          value={recipe.out.measure ?? recipe.measures[0]?.id ?? ms[0]?.id ?? ''}
          onChange={(m) => set({ measure: m })}
          options={ms.map((c) => ({ value: c.id, label: c.label }))}
        />
      )}
      {s && (s.by === 'seen' || s.by === 'priority') && (
        <PeriodPicker value={recipe.out.period ?? recipe.seen?.period ?? { kind: 'season' }} onChange={(period) => set({ period })} />
      )}
    </FilterField>
  )
}

/**
 * « Mes filtres » (questions enregistrées, celles du bilan comprises) relancés sur la liste : filtres et tri (calcul au-dessus
 * de la liste ; mode avancé : sa requête). Dans la fenêtre Filtres, sous l'essentiel ; « Tous mes filtres » du menu de la barre
 * Demander l'ouvre ici (data-filter « saved »). Renommer, supprimer (du compte ou de l'appareil, src/savedQuestions.ts).
 */
function SavedOnList({ saved, open, setOpen, onApply }: { saved: SavedQuestion[]; open: boolean; setOpen: (v: boolean) => void; onApply: (q: SavedQuestion) => void }) {
  const [renaming, setRenaming] = useState<string | null>(null)
  if (!saved.length) return null
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line px-2" data-filter="saved">
      <button type="button" className="flex min-h-11 w-full items-center gap-2 text-left text-xs font-bold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="star" className="h-3.5 w-3.5 text-accent" />
        <span className="flex-1">Mes filtres ({saved.length})</span>
        <span className={`text-muted transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-t border-line py-2">
          {saved.map((q) =>
            renaming === q.id ? (
              <RenameSaved key={q.id} id={q.id} name={q.name} onDone={() => setRenaming(null)} />
            ) : (
              <div key={q.id} className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-xs">
                  {q.name}
                  {q.sql && <span className="text-muted"> · mode avancé</span>}
                </span>
                <button type="button" className="btn-primary min-h-9 shrink-0 px-3 text-xs" onClick={() => onApply(q)}>
                  Appliquer
                </button>
                <button
                  type="button"
                  className="flex min-h-9 min-w-9 shrink-0 items-center justify-center text-muted hover:text-fg"
                  aria-label={`Renommer « ${q.name} »`}
                  title="Renommer"
                  onClick={() => setRenaming(q.id)}
                >
                  <Icon name="pencil" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="flex min-h-9 min-w-9 shrink-0 items-center justify-center text-muted hover:text-fg"
                  aria-label={`Supprimer « ${q.name} »`}
                  title="Supprimer"
                  onClick={async () => (await confirmAskLocal(`Supprimer « ${q.name} » ${savedPlace()} ?`)) && void deleteQuestion(q.id)}
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  )
}
const confirmAskLocal = (text: string) => confirmAsk(text, { ok: 'Supprimer', danger: true })

/**
 * Ligne de résultat d'une phrase : la question reste affichée (« ✦ « … » »), ce qui a changé, « Annuler »,
 * « Enregistrer la question » (liste Joueurs), ce qui n'a pas été appliqué.
 */
function ResultView({ r, onUndo, onClose, onSave, sqlButton }: { r: ResultLine; onUndo: () => void; onClose: () => void; onSave?: () => void; sqlButton?: () => void }) {
  if (r.nothing) return null
  return (
    <div className="flex flex-col gap-1 rounded-md border border-ai/40 bg-ai-soft px-2 py-1.5 text-[11px]" role="status">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate font-bold">
          <span className="text-ai" aria-hidden>
            ✦
          </span>{' '}
          « {r.phrase} »
        </span>
        {r.text && (
          <button type="button" className="min-h-9 shrink-0 font-bold underline" onClick={onUndo}>
            Annuler
          </button>
        )}
        {onSave && (
          <button type="button" className="flex min-h-9 shrink-0 items-center gap-1 font-bold underline" onClick={onSave}>
            <Icon name="star" className="h-3 w-3" />
            Enregistrer la question
          </button>
        )}
        <button type="button" className="min-h-9 shrink-0 px-1 text-muted" aria-label="Fermer" onClick={onClose}>
          ✕
        </button>
      </div>
      <span className="text-muted">{r.text || 'Les filtres n’ont pas changé.'}</span>
      {!!r.unsupported?.length && (
        <span>
          <b>Pas pris en compte :</b> {r.unsupported.join(' ; ')}
        </span>
      )}
      {!!r.notes?.length && (
        <span className="text-muted">
          <b>Non appliqué :</b> {r.notes.join(' ; ')}
        </span>
      )}
      {sqlButton && (
        <button type="button" className="btn-ghost min-h-11 self-start px-3 text-xs" onClick={sqlButton}>
          <span aria-hidden>✨</span> Essayer en mode avancé
        </button>
      )}
    </div>
  )
}

/** Réponse d'une question de calcul, sur la sélection : nombre (et moyenne), ou petit tableau. */
function CalcView({ recipe, answer, model, loading, gender, onClose }: { recipe: Recipe; answer: Answer<Player> | null; model: RecipeModel; loading: boolean; gender?: Gender; onClose: () => void }) {
  const head = (
    <div className="flex items-start gap-2">
      <span className="min-w-0 flex-1 text-[11px] font-bold text-muted">
        Sur la sélection
        {recipe.out.type === 'table' ? ` · ${GROUP_OPTIONS.find((g) => g.value === recipe.out.groupBy)?.label ?? ''}` : ''}
      </span>
      <button type="button" className="min-h-9 shrink-0 px-1 text-muted" aria-label="Fermer la réponse" onClick={onClose}>
        ✕
      </button>
    </div>
  )
  if (loading || !answer)
    return (
      <div className="card flex flex-col gap-1 p-3 text-xs">
        {head}
        <span className="text-muted">Calcul…</span>
      </div>
    )
  if (recipe.out.type === 'count')
    return (
      <div className="card flex flex-col gap-1 p-3">
        {head}
        <span className="text-3xl font-extrabold tabular-nums">{fr(answer.count)}</span>
        <span className="text-xs">{answer.count > 1 ? w(gender).joueurs : w(gender).joueur}</span>
        {answer.stat && <span className="text-sm font-bold">{statText(recipe, model.names, answer.stat, true)}</span>}
      </div>
    )
  const rows = (answer.table ?? []).slice(0, 30)
  const by = recipe.out.groupBy ?? 'club'
  return (
    <div className="card flex flex-col gap-1 p-3 text-xs">
      {head}
      {!rows.length ? (
        <span className="text-muted">Aucune ligne pour l’instant.</span>
      ) : (
        <table className="w-full border-collapse">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key || '?'} className="border-t border-line first:border-t-0">
                <td className={`py-1.5 pr-2 ${row.key ? '' : 'text-muted italic'}`}>{groupLabel(by, row.key, model)}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {by === 'staff' ? (
                    `${fr(row.staff?.players ?? 0)} ${w(gender).vus} · ${fr(row.staff?.avis ?? 0)} avis`
                  ) : (
                    <>
                      <b>{fr(row.match)}</b>
                      {row.seen && ` · ${shareText(row.seen.seen, row.seen.total)} ${w(gender).vus}`}
                      {row.avg !== undefined && ` · moyenne ${row.avg === null ? '–' : fr(row.avg, 2)}`}
                      {row.stat && ` · ${statText(recipe, model.names, row.stat)}`}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(answer.table?.length ?? 0) > rows.length && <span className="text-[10px] text-muted">Les 30 premières lignes.</span>}
    </div>
  )
}
