import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { alive, db, POSITIONS, today, type Player, type Position } from '../db'
import { departmentLabel, regionOfDept, useRegionLabel } from '../lists'
import { MQ, useMedia } from '../layout'
import { can, groupTag } from '../roles'
import { loadTeams } from '../teams'
import { categoryStyles, styleOf } from '../radarZones'
import {
  answersNothing,
  avisCriteria,
  defaultSort,
  interpretRecipe,
  measureCriteria,
  PRIORITY_TEXT,
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
  cleanQuery,
  decideAction,
  EMPTY_QUERY,
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
import { withPoleMembers } from '../poleMembers'
import { deleteQuestion, useSavedQuestions } from '../savedQuestions'
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
import { CourtFilter } from './CourtPicker'
import { ClubPicker, department, hayOf, readSex, tokensOf, useSessionState, writeSex } from './PlayerFilter'
import { GROUP_OPTIONS, groupLabel, PeriodPicker, RecipeChips, SaveForm, Select, statText, TargetPicker, valueText, type RecipeModel } from './RecipeChips'
import { Icon, Segmented } from './ui'
import { Demander, recordAsk, useIncomingAsk } from './Demander'
import { startAskAction } from './AskAction'
import { detectAction } from '../askAction'
import { armSelectAll } from './Selection'
import { YearPicker } from './YearPicker'
import { putYears, yearsOf } from '../birthYears'
import { appName } from '../appBrand'
import { lateralityPlural, listGender, SEX_LABELS, w, type Gender } from '../gender'

/*
 * Filtres de la liste Joueurs = ÉDITEUR DE RECETTE (src/playerQuery.ts, même moteur que « Poser une question », src/recipe.ts).
 *  - En haut, la barre « Demander » (src/components/Demander.tsx : historique, suggestions, menu) et UN micro ✨. Un simple nom (« Martin », « jean-pierre »,
 *    une licence) : recherche locale instantanée (comme avant, noms approchants compris), sans appel. Une phrase dite ou
 *    tapée (Entrée, ✨) : la phrase, la description de la recette et les NOMS des filtres posés partent au mode « question »
 *    (contexte « joueurs ») ; la recette rendue est revérifiée ici puis FUSIONNÉE avec les filtres posés : par défaut elle
 *    AJOUTE ; on n'efface ou ne retire que si c'est dit. Une question de calcul (« quelle est la taille moyenne ? »,
 *    « combien par club ? ») est calculée sur la sélection et affichée au-dessus de la liste, qui reste filtrée.
 *    « Annuler » remet les filtres d'avant ; une ligne dit « Ajouté : … / Retiré : … / Remplacé : … ».
 *  - Les filtres en PASTILLES (mêmes pastilles que la réponse du bilan) : un toucher pour changer, « Retirer », « Tout effacer ».
 *  - « Filtres » : les filtres rapides d'avant (année, trimestre, sexe, taille, latéralité, lieu, club, Pôle, vidéo, suivis,
 *    profil, groupe, poste), puis « + Ajouter une condition » (vus, notes d'avis, nombre d'avis, mesures, événement) et
 *    « Trier par ». Ils construisent la même recette.
 *  - Phrase que la recette n'applique pas entièrement : bascule automatique en MODE AVANCÉ (requête SQL calculée sur une copie
 *    locale, comme au bilan) ; résultat en tête, et la liste devient les joueurs du résultat s'il en donne (colonne joueur_id),
 *    sinon bandeau « Pas pris en compte : … ». Chaque phrase est notée au journal des questions (anonymisée).
 *  - « Enregistrer ce filtre » : une question de « Mes questions », relancée ici ou au bilan.
 *  - État gardé pendant la session (src/playerQuery.ts JOUEURS_KEYS) : « Retour » depuis une fiche retrouve la même liste,
 *    les mêmes pastilles et la même position. Données lourdes (passages, avis, événements) lues seulement au besoin.
 * Aucune donnée de joueur ne part ; uniquement des formulations positives ou neutres sur les jeunes.
 */

const fr = (n: number, d = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: d })
const QUARTER_ACTIVE = ['border-emerald-500 text-emerald-300', 'border-yellow-500 text-yellow-300', 'border-orange-500 text-orange-300', 'border-red-500 text-red-300']
const QUARTER_LABELS = ['Q1 · janv.–mars', 'Q2 · avril–juin', 'Q3 · juil.–sept.', 'Q4 · oct.–déc.']
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
}

/**
 * Filtres d'une liste de joueurs. `scope` : autre liste que Joueurs (ajout de joueurs à un événement ou un groupe :
 * « ajout-evenement », « ajout-groupe ») : son propre état de session, sans toucher à la liste Joueurs ni à son ‹ ›.
 * `hosted` : barre posée sur un autre écran (le bilan), voir HostedBar.
 */
export function usePlayersQuery(players: Player[] | undefined, opts: { dock: boolean; scope?: string; hosted?: HostedBar }) {
  const hosted = opts.hosted
  const wide = useMedia(MQ.xl)
  const docked = opts.dock && wide
  const keys = opts.scope
    ? { query: `handbase.${opts.scope}.recette`, text: `handbase.${opts.scope}.texte`, result: `handbase.${opts.scope}.resultat`, sql: `handbase.${opts.scope}.sql` }
    : JOUEURS_KEYS
  const pre = opts.scope ? `handbase.${opts.scope}` : 'handbase.joueurs'
  const regionLabel = useRegionLabel()
  const { questionReady, sqlReady } = useDictation()

  // ---------- État (session) ----------
  const [sessionQuery, setSessionQuery] = useSessionState<unknown>(keys.query, (() => {
    const sex = readSex()
    return { ...EMPTY_QUERY, recipe: { ...EMPTY_QUERY.recipe, pop: sex !== 'all' ? { sex } : {} } }
  })())
  // Barre posée sur un autre écran : la requête est celle de l'écran (son adresse).
  const rawQuery = hosted ? hosted.value : sessionQuery
  const setRawQuery = (v: unknown) => (hosted ? hosted.onChange(cleanQuery(v)) : setSessionQuery(v))
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
  const [open, setOpen] = useSessionState(`${pre}.filtres`, false)
  const [more, setMore] = useSessionState(`${pre}.conditions`, false)
  const [chipOpen, setChipOpen] = useState<string | null>(null)
  const [asked, setAsked] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [saving, setSaving] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const setQy = (next: JoueursQuery) => {
    const clean = cleanQuery(next)
    if (!hosted && (clean.recipe.pop.sex ?? 'all') !== (qy.recipe.pop.sex ?? 'all')) writeSex(clean.recipe.pop.sex ?? 'all')
    sentQ.current = clean.q
    setRawQuery(clean)
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
  const light = useLiveQuery(async () => {
    const [measures, criteria, groups, events] = await Promise.all([
      db.measurements.where('criterionId').anyOf('taille', 'poids').toArray(),
      db.criteria.toArray(),
      loadTeams().then(() => db.groups.orderBy('name').toArray()),
      db.events.toArray(),
    ])
    // Groupes Pôle : membres en cours calculés depuis les fiches (src/poleMembers.ts), pour le compteur et le filtre « Groupe ».
    const visible = await withPoleMembers(alive(groups).filter((g) => can.seeGroup(g)))
    return { measures, criteria: alive(criteria), groups: visible, events: alive(events), staff: new Map<string, string>() }
  }, [])
  const quick = full.quick
  const index = useMemo(() => {
    if (!players || !light) return null
    const src = full.data
    const criteria = src?.criteria ?? light.criteria
    const styles = categoryStyles(criteria)
    return buildPlayersIndex<Player>({
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
    })
  }, [players, light, full.data, quick])
  const names = useRecipeNames(full.data ?? light, index?.clubNames, quick.profiles)
  const criteria = useMemo(() => full.data?.criteria ?? light?.criteria ?? [], [full.data, light])
  const rmodel: RecipeModel = { names, criteria, events: full.data?.events ?? light?.events }
  const heavyMissing = needsFullData(qy) && !full.data

  // ---------- Liste ----------
  const sel = useMemo(() => (index && !heavyMissing ? selectPlayers(index, qy, hayOf, tokensOf) : null), [index, qy, heavyMissing])
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
  const sortRecipe = useMemo(() => listRecipe(qy.recipe), [qy])
  const sorted = !!(qy.recipe.out.sort || qy.recipe.avis.length)
  const valueOf = (p: Player): string => {
    if (fromSql) return sqlList.extra.get(p.id) ?? ''
    if (!sorted) return ''
    const v = sel?.values.get(p.id)
    return v ? valueText(sortRecipe, names, v.value, v.tag) : ''
  }

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

  // ---------- Filtres rapides ----------
  const panelShown = docked || open
  const counts = useMemo(() => (index && panelShown && !heavyMissing ? quickCounts(index, qy, hayOf, tokensOf) : null), [index, qy, panelShown, heavyMissing])
  const p = qy.recipe.pop
  const groups = useMemo(() => (full.data?.groups ?? light?.groups ?? []).filter((g) => !g.archived || p.groups?.includes(g.id)), [full.data, light, p.groups])
  const currentGroup = p.groups?.length === 1 ? groups.find((g) => g.id === p.groups![0]) : undefined
  // Années cochées (src/birthYears.ts : bornes, et années exactes si elles ne se suivent pas).
  const years = (yearsOf(p) ?? []).map(String).reverse()
  const setYears = (ys: string[]) => {
    const pop: Population = { ...p }
    putYears(pop, ys)
    setRecipe({ ...qy.recipe, pop })
  }
  const position: Position | 'all' | 'none' = p.noPosition ? 'none' : p.positions?.length === 1 ? p.positions[0] : 'all'

  // Filtres visibles (barre posée : sans ceux que l'écran commande lui-même).
  const shownKeys = activeKeys(qy).filter((k) => !hosted?.hidden.has(k))
  const reset = () => {
    // Barre posée : « Tout effacer » retire ses pastilles, pas les commandes de l'écran (sexe, année, lieu).
    setQy(hosted ? removeKeys({ ...qy, calc: undefined }, shownKeys) : EMPTY_QUERY)
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
  const panel = (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-2.5">
      {!hosted?.hideSex && (
      <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
        {(
          [
            ['all', 'Tous'],
            ['M', SEX_LABELS.M],
            ['F', SEX_LABELS.F],
          ] as const
        ).map(([v, label]) => (
          <button key={v} onClick={() => setPop({ sex: v === 'all' ? undefined : v })} className={`min-h-9 flex-1 py-1.5 ${(p.sex ?? 'all') === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
            {label}
          </button>
        ))}
      </div>
      )}
      <div className={hosted?.hideYear ? 'grid' : 'grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-2'}>
        {!hosted?.hideYear && (
        <YearPicker
          className="px-2 py-1.5 text-xs"
          allLabel="Toutes années"
          value={years}
          options={(counts?.years ?? []).map(([y, n]) => ({ value: y, count: n }))}
          onChange={setYears}
        />
        )}
        <select
          className={`field px-2 py-1.5 text-xs ${p.quarter ? `font-bold ${QUARTER_ACTIVE[p.quarter - 1]}` : ''}`}
          aria-label="Trimestre de naissance"
          value={p.quarter ?? 0}
          onChange={(e) => setPop({ quarter: Number(e.target.value) || undefined })}
        >
          <option value={0}>Tous trimestres</option>
          {QUARTER_LABELS.map((l, i) => (
            <option key={i} value={i + 1}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="shrink-0 font-bold text-muted">Taille minimum (cm)</span>
        <HeightInput value={p.hMin} onChange={(hMin) => setPop({ hMin })} />
      </div>
      <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
        {(
          [
            ['all', 'Toutes'],
            ['droitier', lateralityPlural('droitier', gender)],
            ['gaucher', lateralityPlural('gaucher', gender)],
            ['ambidextre', 'Ambi.'],
          ] as const
        ).map(([v, label]) => (
          <button key={v} onClick={() => setPop({ hand: v === 'all' ? undefined : v })} className={`min-h-9 flex-1 py-1.5 ${(p.hand ?? 'all') === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
            {label}
          </button>
        ))}
      </div>
      {(counts?.regions.length ?? 0) > 1 || p.regions ? (
        <select
          className={`field py-1.5 text-xs ${p.regions ? 'border-accent font-bold' : ''}`}
          aria-label="Région"
          value={p.regions?.[0] ?? ''}
          onChange={(e) => setPop({ regions: e.target.value ? [e.target.value] : undefined, depts: undefined, clubs: undefined })}
        >
          <option value="">Toutes les régions ({fr(counts?.regionTotal ?? 0)})</option>
          {[...(counts?.regions ?? []), ...(p.regions && !counts?.regions.some(([r]) => r === p.regions![0]) ? [[p.regions[0], 0] as [string, number]] : [])]
            .sort((a, b) => regionLabel(a[0]).localeCompare(regionLabel(b[0]), 'fr'))
            .map(([r, n]) => (
              <option key={r} value={r}>
                {regionLabel(r)} ({fr(n)})
              </option>
            ))}
        </select>
      ) : null}
      {(counts?.depts.length ?? 0) > 1 || p.depts ? (
        <select
          className={`field py-1.5 text-xs ${p.depts ? 'border-accent font-bold' : ''}`}
          aria-label="Département"
          value={p.depts?.[0] ?? ''}
          onChange={(e) => setPop({ depts: e.target.value ? [e.target.value] : undefined, clubs: undefined })}
        >
          <option value="">Tous les départements ({fr(counts?.deptTotal ?? 0)})</option>
          {[...(counts?.depts ?? []), ...(p.depts && !counts?.depts.some(([d]) => d === p.depts![0]) ? [[p.depts[0], 0] as [string, number]] : [])].map(([d, n]) => (
            <option key={d} value={d}>
              {departmentLabel(d)} ({fr(n)})
            </option>
          ))}
        </select>
      ) : null}
      <ClubPicker
        clubs={(counts?.clubs ?? []).map(([, n, name]) => [name, n] as [string, number])}
        total={counts?.clubTotal ?? 0}
        value={p.clubs?.length ? p.clubs.map((k) => names.club(k)).join(', ') : ''}
        onChange={(name) => setPop({ clubs: name ? [counts?.clubs.find(([, , n]) => n === name)?.[0] ?? name.toLowerCase().replace(/\s+/g, ' ').trim()] : undefined })}
      />
      <select
        className={`field py-1.5 text-xs ${p.pole ? 'border-accent font-bold' : ''}`}
        aria-label="Pôle Espoirs"
        value={p.pole ?? ''}
        onChange={(e) => setPop({ pole: (e.target.value || undefined) as Population['pole'] })}
      >
        <option value="">Pôle Espoirs : {gw.tousLesJoueurs}</option>
        <option value="current">{POLE_LABEL.current}</option>
        <option value="past">{POLE_LABEL.past}</option>
        <option value="any">{POLE_LABEL.any}</option>
      </select>
      <button
        onClick={() => setPop({ video: !p.video })}
        className={`flex min-h-9 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-bold ${p.video ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-panel-2 text-muted'}`}
      >
        Seulement les {gw.joueurs} avec une vidéo
      </button>
      {(quick.followed.size > 0 || p.followed) && (
        <button
          onClick={() => setPop({ followed: !p.followed })}
          className={`flex min-h-9 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-bold ${p.followed ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-panel-2 text-muted'}`}
        >
          <Icon name="star" filled={p.followed} className="h-3.5 w-3.5 text-accent" />
          Seulement mes suivis ({fr(quick.followed.size)})
        </button>
      )}
      {quick.profiles.length > 0 && (
        <select
          className={`field py-1.5 text-xs ${p.profiles ? 'border-accent font-bold' : ''}`}
          aria-label="Profil recherché"
          value={p.profiles?.[0] ?? ''}
          onChange={(e) => setPop({ profiles: e.target.value ? [e.target.value] : undefined })}
        >
          <option value="">{gw.TousLesJoueurs} (sans profil recherché)</option>
          {quick.profiles.map((a) => (
            <option key={a.id} value={a.id}>
              Profil : {a.name} ({fr(quick.profileMembers.get(a.id)?.size ?? 0)})
            </option>
          ))}
        </select>
      )}
      {groups.length > 0 && (
        <select
          className={`field py-1.5 text-xs ${p.groups ? 'border-accent font-bold' : ''}`}
          aria-label="Groupe"
          value={p.groups?.[0] ?? ''}
          onChange={(e) => setPop({ groups: e.target.value ? [e.target.value] : undefined, regions: undefined, depts: undefined, clubs: undefined })}
        >
          <option value="">{gw.TousLesJoueurs} (sans groupe choisi)</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              Groupe : {g.name}
              {groupTag(g)} ({fr(g.playerIds.length)}){g.archived ? ' — archivé' : ''}
            </option>
          ))}
        </select>
      )}
      <div className="flex flex-col gap-1.5 rounded-md border border-line bg-panel-2/50 p-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold text-muted">Poste</span>
          <span className="flex gap-1.5">
            <button
              onClick={() => setPop({ positions: undefined, noPosition: undefined, secondary: undefined })}
              className={`min-h-7 rounded-md border px-2 py-0.5 font-bold ${position === 'all' && !p.positions ? 'border-accent bg-accent text-white' : 'border-line text-muted'}`}
            >
              Tous {counts?.positionTotal ?? ''}
            </button>
            {((counts?.positions.none ?? 0) > 0 || p.noPosition) && (
              <button
                onClick={() => setPop({ noPosition: !p.noPosition || undefined, positions: undefined, secondary: undefined })}
                className={`min-h-7 rounded-md border px-2 py-0.5 font-bold ${p.noPosition ? 'border-accent bg-accent text-white' : 'border-line text-muted'}`}
              >
                Sans poste {counts?.positions.none ?? 0}
              </button>
            )}
          </span>
        </div>
        <CourtFilter
          value={position}
          counts={counts?.positions ?? {}}
          onChange={(v) =>
            v === 'all' || v === 'none'
              ? setPop({ positions: undefined, noPosition: v === 'none' || undefined, secondary: undefined })
              : setPop({ positions: [v], noPosition: undefined })
          }
        />
        <label className="flex min-h-7 items-center gap-1.5 self-start text-[11px] text-muted">
          <input type="checkbox" checked={!!p.secondary} disabled={!p.positions} onChange={(e) => setPop({ secondary: e.target.checked || undefined })} />
          Inclure les postes secondaires
        </label>
      </div>
      <div className="rounded-md border border-line">
        <button type="button" className="flex min-h-11 w-full items-center gap-2 px-2 text-left text-xs font-bold" aria-expanded={more} onClick={() => setMore(!more)}>
          <span className="flex-1">+ Ajouter une condition</span>
          <span className={`text-muted transition ${more ? 'rotate-90' : ''}`}>›</span>
        </button>
        {more && (
          <div className="flex flex-col gap-2 border-t border-line p-2">
            {!full.data && <p className="text-[11px] text-muted">Chargement des avis et des passages…</p>}
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => addCondition('seen')}>
                Vus (combien, quand, par qui)
              </button>
              {avisCriteria(criteria).length > 0 && (
                <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => addCondition('avis')}>
                  Note d’avis
                </button>
              )}
              <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => addCondition('nbAvis')}>
                Nombre d’avis
              </button>
              {measureCriteria(criteria).length > 0 && (
                <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => addCondition('measure')}>
                  Mesure
                </button>
              )}
              <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => addCondition('heightMax')}>
                Taille maximum
              </button>
            </div>
            {(full.data?.events.length ?? 0) > 0 && (
              <select
                className={`field min-h-11 py-1.5 text-xs ${p.events ? 'border-accent font-bold' : ''}`}
                aria-label="Vus ou inscrits à un événement"
                value={p.events?.[0] ?? ''}
                onChange={(e) => setPop({ events: e.target.value ? [e.target.value] : undefined })}
              >
                <option value="">Événement : tous</option>
                {[...(full.data?.events ?? [])]
                  .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
                  .map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                      {ev.date ? ` (${ev.date.slice(8, 10)}/${ev.date.slice(5, 7)}/${ev.date.slice(0, 4)})` : ''}
                    </option>
                  ))}
              </select>
            )}
            <p className="text-[10px] text-muted">La condition s’ajoute en pastille : touchez-la pour la régler.</p>
          </div>
        )}
      </div>
      {!hosted && <SortPicker recipe={qy.recipe} model={rmodel} onChange={setRecipe} />}
      {!hosted && (
      <SavedOnList
        saved={saved}
        onApply={(q) => {
          if (q.sql) setSql({ spec: q.sql, phrase: q.name })
          else {
            setQy(queryFromSaved(q.recipe))
            setSql(null)
          }
          setResult(null)
        }}
      />
      )}
    </div>
  )

  // ---------- Champ, micro, pastilles, ligne de résultat ----------
  const nChips = shownKeys.filter((k) => k !== 'q').length
  const keepChip = (c: Chip) =>
    c.key !== 'out' && c.key !== 'limit' && !(c.key === 'sort' && !c.removable && !qy.recipe.avis.length) && !hosted?.hidden.has(c.key as FilterKey)
  // Le micro charge les données de la recette pendant qu'on parle.
  const micForField = questionReady && !hosted ? { ...mic, buttonProps: { ...mic.buttonProps, onPointerDown: (e: Parameters<typeof mic.buttonProps.onPointerDown>[0]) => (!asked && setAsked(true), mic.buttonProps.onPointerDown(e)) } } : undefined
  // « Filtres » logé dans la barre (étiquette arrondie, comme « Mode IA » chez Google) ; la barre posée du bilan garde son bouton.
  const filtersChip = (
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={`flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-bold transition ${open || nChips ? 'bg-accent/15 text-fg' : 'bg-panel-2 text-muted hover:text-fg'}`}>
      Filtres{nChips > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] text-white">{nChips}</span>} <span className="ml-1">{open ? '▴' : '▾'}</span>
    </button>
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
      compact={hosted?.compact}
      label={questionReady ? 'Demander : filtrer ou poser une question' : 'Rechercher un joueur'}
      trailing={!hosted && !docked ? filtersChip : undefined}
    />
  )
  const filtersButton = !docked && (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      className={`${hosted?.compact ? 'min-h-8' : 'min-h-11'} shrink-0 rounded-full border px-3 text-xs font-bold ${open || nChips ? 'border-accent text-fg' : 'border-line text-muted'} ${open ? 'bg-accent/15' : 'bg-panel-2'}`}
    >
      Filtres{nChips > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] text-white">{nChips}</span>} {open ? '▴' : '▾'}
    </button>
  )
  // La ligne reste tant que les filtres sont ceux posés par la phrase.
  const shownResult = result && (result.nothing || !result.after || sameQuery(result.after, qy)) ? result : null
  const status =
    mic.phase !== 'idle' ? (
      <MicStatus mic={mic} dictated={false} />
    ) : busy || pending ? (
      <div className="flex items-center gap-2 text-xs text-muted" role="status">
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span className="min-w-0 flex-1 truncate">« {busy || pending?.phrase} » : je prépare la recette…</span>
        {busy && (
          <button type="button" className="min-h-9 shrink-0 px-2 text-[11px] font-bold underline" onClick={() => abort.current?.abort()}>
            Annuler
          </button>
        )}
      </div>
    ) : error ? (
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
      after={
        (hosted ? shownKeys.length > 0 : hasQuery(qy)) || qy.calc ? (
          <>
            <button type="button" className="min-h-9 px-1 text-[11px] font-bold text-muted underline" onClick={reset}>
              Tout effacer
            </button>
            {!saving && (
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
  const saveForm = saving && <SaveForm recipe={recipeToSave(qy)} names={names} phrase={result?.phrase} onDone={() => setSaving(false)} />
  const privacy = questionReady && (
    <p className="text-[10px] text-muted">
      Une phrase envoie seulement ses mots (et les noms des filtres posés), jamais les données des joueurs ; elle peut être notée, sans nom de joueur, pour
      améliorer {appName()}.{' '}
      <Link to="/confidentialite#questions" className="underline">
        Confidentialité
      </Link>
    </p>
  )

  const ui = docked ? null : (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">{field}</div>
      {status}
      {chips}
      {saveForm}
      {open && panel}
      {open && privacy}
    </div>
  )
  const side = docked ? (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">{field}</div>
      {status}
      {chips}
      {saveForm}
      <span className="section-title mb-0">Filtres{nChips > 0 && ` (${nChips})`}</span>
      {panel}
      {privacy}
    </div>
  ) : null

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
    panel: open ? (
      <>
        {panel}
        {privacy}
      </>
    ) : null,
    top,
    open,
    nChips,
    chipLabels: recipeChips(qy.recipe, names).filter(keepChip).filter((c) => c.key !== 'period').map((c) => c.label),
    wantFull,
  }
  return { filtered, ui, side, top, signature, group: currentGroup, valueOf, loading: !sel && !fromSql, fromSql, parts, gender, filtersOpen: open }
}

// ---------- Petits composants ----------

/** Taille minimum (cm) : texte libre, appliqué dès qu'il est lisible (100 à 230). */
function HeightInput({ value, onChange }: { value?: number; onChange: (v: number | undefined) => void }) {
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
      className={`field min-w-0 flex-1 py-1.5 text-xs ${value ? 'border-accent font-bold' : ''}`}
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

/** « Trier par » : le tri de la liste (même recette que « classés par taille » dit au micro). */
function SortPicker({ recipe, model, onChange }: { recipe: Recipe; model: RecipeModel; onChange: (r: Recipe) => void }) {
  const s = recipe.out.sort
  const ms = measureCriteria(model.criteria)
  const set = (patch: Partial<Recipe['out']>) => onChange({ ...recipe, out: { ...recipe.out, type: 'list', ...patch } })
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-muted">Trier par</span>
        <Select<SortBy | ''>
          label="Trier par"
          value={s?.by ?? ''}
          options={SORTS.filter((o) => o.value !== 'measure' || ms.length)}
          onChange={(by) => {
            if (!by) return onChange({ ...recipe, out: { type: 'list' } })
            set({ sort: { by, dir: by === 'name' ? 'asc' : 'desc' }, ...(by === 'measure' ? { measure: recipe.out.measure ?? recipe.measures[0]?.id ?? ms[0]?.id } : {}) })
          }}
        />
        {s && s.by !== 'priority' && (
          <Segmented<'asc' | 'desc'>
            value={s.dir}
            onChange={(dir) => set({ sort: { by: s.by, dir } })}
            options={[
              { value: 'asc', label: '↑' },
              { value: 'desc', label: '↓' },
            ]}
          />
        )}
      </div>
      {s && (s.by === 'avg' || s.by === 'progress') && (
        <TargetPicker value={recipe.out.avg ?? recipe.avis[0]?.target ?? { on: 'global' }} model={model} onChange={(t) => set({ avg: t })} />
      )}
      {s?.by === 'measure' && (
        <Select label="Mesure" value={recipe.out.measure ?? recipe.measures[0]?.id ?? ms[0]?.id ?? ''} onChange={(m) => set({ measure: m })} options={ms.map((c) => ({ value: c.id, label: c.label }))} />
      )}
      {s && (s.by === 'seen' || s.by === 'priority') && (
        <PeriodPicker value={recipe.out.period ?? recipe.seen?.period ?? { kind: 'season' }} onChange={(period) => set({ period })} />
      )}
    </div>
  )
}

/** « Mes questions » relancées sur la liste (filtres et tri ; calcul au-dessus de la liste ; mode avancé : sa requête). */
function SavedOnList({ saved, onApply }: { saved: ReturnType<typeof useSavedQuestions>; onApply: (q: ReturnType<typeof useSavedQuestions>[number]) => void }) {
  const [open, setOpen] = useState(false)
  if (!saved.length) return null
  return (
    <div className="rounded-md border border-line">
      <button type="button" className="flex min-h-11 w-full items-center gap-2 px-2 text-left text-xs font-bold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="star" className="h-3.5 w-3.5 text-accent" />
        <span className="flex-1">Mes questions ({saved.length})</span>
        <span className={`text-muted transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-t border-line p-2">
          {saved.map((q) => (
            <div key={q.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs">{q.name}</span>
              <button type="button" className="btn-primary min-h-11 shrink-0 px-3 text-xs" onClick={() => onApply(q)}>
                Appliquer
              </button>
              <button
                type="button"
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted hover:text-fg"
                aria-label={`Supprimer « ${q.name} »`}
                onClick={async () => (await confirmAskLocal(`Supprimer la question « ${q.name} » de cet appareil ?`)) && deleteQuestion(q.id)}
              >
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </div>
          ))}
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
