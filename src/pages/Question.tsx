import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { alive, db, POSITIONS, today, type Player, type Position } from '../db'
import { type Tally } from '../coverage'
import { officialRegions, regionOfDept, useDepartments, useRegionLabel, useRegions } from '../lists'
import { MQ, useMedia } from '../layout'
import { can, useRole } from '../roles'
import { loadTeams } from '../teams'
import {
  answersNothing,
  periodText,
  applyVars,
  defaultSort,
  hasConditions,
  PRIORITY_TEXT,
  QUESTION_EXAMPLES,
  shareOf,
  shareText,
  decodeRecipe,
  DEFAULT_LIMIT,
  encodeRecipe,
  interpretRecipe,
  LIMITS,
  mapTallies,
  recipeText,
  runRecipe,
  VAR_TEXT,
  varValues,
  type Answer,
  type GroupBy,
  type QIndex,
  type Recipe,
  type SavedQuestion,
  type TableRow,
  type VarValues,
} from '../recipe'
import { deleteQuestion, useSavedQuestions } from '../savedQuestions'
import { useQuestionModel, type QuestionModel } from '../questionModel'
import { AskQuestion, type AskState } from '../components/AskQuestion'
import { AdvancedBusy, SqlAnswerView, SqlExplain, sqlPlayers, useAdvancedAsk, useSqlResult } from '../components/SqlAnswer'
import { logQuestion } from '../questionLog'
import type { RecipeStatus } from '../questionLogCore'
import { useDictation } from '../dictation/useDictation'
import { decodeSqlSpec, encodeSqlSpec, type SqlSpec } from '../sqlGuard'
import { ask } from '../components/Confirm'
import { ContextBar, ContextRoster, useLeaveTo } from '../components/ContextRoster'
import { FollowStar } from '../components/Follow'
import { FranceMap } from '../components/FranceMap'
import { showOtherOM } from '../outreMer'
import MasterDetail from '../components/MasterDetail'
import { PlayerRow } from '../components/PlayerRow'
import { GROUP_OPTIONS, groupLabel, NumberInput, PeriodPicker, RecipeChips, SaveForm, Select, statText, valueText, type RecipeModel } from '../components/RecipeChips'
import { Empty, Icon, Segmented, SectionTitle } from '../components/ui'
import { Bar, bilanQuestionSearch, Crumbs, fillOf, MapLegend, scaleOf } from './Coverage'
import { goesToBilan, isTopClubs, splitPlace, topClubsPlace } from '../bilanQuestion'
import { locateClubs } from '../answerClubs'
import { ClubAnswerMap, useClubPlaces, useOpenClub } from '../components/ClubAnswerMap'
import PlayerDetail from './PlayerDetail'
import { YearPicker } from '../components/YearPicker'
import { putYears, recentYears } from '../birthYears'

type Model = QuestionModel
/** Ce dont les pastilles ont besoin (noms, critères, événements). */
const recipeModel = (m: Model): RecipeModel => ({ names: m.names, criteria: m.data?.criteria ?? [], events: m.data?.events })

/*
 * Réponse à une question posée au bilan de détection : /bilan/question?r=<recette>&mr=<région>&md=<département>&mc=<club>.
 * La recette (src/recipe.ts) est dans l'adresse : le retour d'une fiche joueur, le bouton retour du navigateur ou un lien
 * partagé retrouvent exactement la même réponse ; « Entendu : … » et les valeurs écartées sont dans l'état de l'historique.
 * Tout est calculé sur l'appareil (données Dexie), en lecture seule.
 *  - en haut : la question en pastilles ; un toucher ouvre ses réglages simples (année, période, opérateur et nombre…) et
 *    « Retirer » ; chaque changement remplace l'adresse (pas de nouvelle entrée d'historique) ;
 *  - réponse : nombre, liste de joueurs (lignes standard, fiche dans son contexte), tableau (une ligne ouvre sa liste),
 *    ou carte de France (part de la population qui répond, région → département → club → joueurs, comme le bilan) ;
 *  - « Enregistrer cette question » (nom, valeurs qui deviennent des variables) → « Mes questions », relancées sans envoi ;
 *  - MODE AVANCÉ (src/components/SqlAnswer.tsx) : /bilan/question?s=<requête>. BASCULE AUTOMATIQUE dès que la recette n'a
 *    pas TOUT appliqué (« Non appliqué », « Pas pris en compte », approximation signalée, grandeur demandée non calculée :
 *    src/recipe.ts checkQuantities) ou ne comprend pas : la réponse du mode avancé devient la réponse principale, avec un lien
 *    discret « Voir la réponse simplifiée » (la recette partielle). La recette n'est la réponse principale que si elle a tout
 *    appliqué. Mode avancé indisponible : la recette partielle et son bandeau, comme avant. Requête SQLite écrite par le
 *    modèle, exécutée seulement sur une copie locale jetable (jamais sur Supabase).
 *  - JOURNAL DES QUESTIONS (src/questionLog.ts) : chaque question posée y est notée (anonymisée, jamais le résultat), avec ce
 *    qu'en a fait la recette et, s'il a été lancé, le mode avancé ; rien pendant « Voir comme… ».
 *  - RÉPONSE GÉOGRAPHIQUE (carte, tableau par club, département ou région, nombre limité à un lieu : src/bilanQuestion.ts) :
 *    elle reste sur le bilan (/bilan?q=…, src/pages/Coverage.tsx), ouvert sur le lieu de la question, avec sa carte et
 *    ses clubs colorés par la valeur de la question ; seulement quand la recette a tout appliqué (sinon ici, avec ce qui
 *    n'a pas été appliqué et le mode avancé). Le retour revient au bilan d'avant la question. « Ouvrir en détail »
 *    (bandeau du bilan) ramène ici, avec le lieu affiché.
 * Ordinateur : question et « Mes questions » à gauche (1/3), réponse à droite (2/3). Uniquement des formulations
 * positives ou neutres sur les jeunes (« pas encore vus », tri croissant / décroissant).
 */

/**
 * autoSql : la recette n'a pas tout appliqué, bascule en mode avancé (une fois) ; advanced : réponse venue du mode avancé ;
 * recipeStatus : ce qu'a fait la recette (journal) ; simplified : recette partielle (adresse), lien « Voir la réponse
 * simplifiée » ; fromAdvanced : on regarde cette réponse simplifiée (retour : la réponse du mode avancé).
 */
type HistState = Partial<AskState> & {
  notes?: string[]
  unsupported?: string[]
  saved?: string
  autoSql?: boolean
  advanced?: 'auto' | 'button'
  recipeStatus?: RecipeStatus
  simplified?: string
  fromAdvanced?: boolean
}

const enc = (r: Recipe) => `r=${encodeURIComponent(encodeRecipe(r))}`
/**
 * Lieu de départ du bilan pour une réponse géographique (département d'un club : celui de la plupart de ses joueurs).
 * « Le club qui a le plus de… » (tableau par club limité aux N premiers) : là où sont ces clubs ; un seul → son
 * département, club choisi, ses joueurs à côté (src/bilanQuestion.ts topClubsPlace).
 */
function bilanTarget(r: Recipe, model?: Model, clubDept?: (k: string) => string | undefined) {
  const deptOfClub = (k: string) => clubDept?.(k) ?? model?.ctx?.clubs.find((c) => c.key === k)?.dept
  const to = splitPlace(r, (d) => regionOfDept(d), deptOfClub)
  if (!isTopClubs(r) || !model?.index) return to
  const top = (runRecipe(model.index, r).table ?? []).map((x) => x.key).filter(Boolean)
  return { ...to, place: topClubsPlace(to.place, top, (d) => regionOfDept(d), deptOfClub) }
}
const encSql = (s: SqlSpec) => `s=${encodeURIComponent(encodeSqlSpec(s))}`
/** Bascules automatiques déjà lancées (une par arrivée, même si l'écran est rendu deux fois). */
const autoStarted = new Set<string>()
const fr = (n: number, d = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: d })

/** Recette de l'adresse, et ses changements (sans nouvelle entrée d'historique : le retour reste sur cette réponse). */
function useRecipeParam() {
  const [params, setParams] = useSearchParams()
  const loc = useLocation()
  const raw = params.get('r')
  const recipe = useMemo(() => decodeRecipe(raw), [raw])
  const rawSql = params.get('s')
  const sqlSpec = useMemo(() => decodeSqlSpec(rawSql), [rawSql])
  const set = (r: Recipe, keepMap = false) => {
    const q = new URLSearchParams()
    q.set('r', encodeRecipe(r))
    if (keepMap) for (const k of ['mr', 'md', 'mc']) if (params.get(k)) q.set(k, params.get(k)!)
    setParams(q, { replace: true, state: loc.state })
  }
  const setMap = (patch: { mr?: string; md?: string; mc?: string }) => {
    const q = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v)
      else q.delete(k)
    }
    setParams(q, { replace: true, state: loc.state })
  }
  return { recipe, sqlSpec, params, set, setMap, search: `?${params.toString()}` }
}

// ---------- Page ----------

export default function Question() {
  const role = useRole()
  const loc = useLocation()
  const nav = useNavigate()
  const st = (loc.state ?? {}) as HistState
  const model = useQuestionModel()
  const { recipe, sqlSpec, params, set, setMap, search } = useRecipeParam()
  const side = useMedia(MQ.side)
  const [saving, setSaving] = useState(false)
  const { sqlReady } = useDictation()
  const adv = useAdvancedAsk(model.source, model.data?.criteria ?? [], model.index?.data.zoneOf ?? undefined)
  // Ce que la recette n'a pas appliqué (journal, bandeau).
  const missing = [...(st.unsupported ?? []), ...(st.notes ?? [])]

  // Ni population, ni condition, ni tri parlant : « Je ne sais pas encore répondre », jamais une liste par défaut.
  const nothing = !!recipe && answersNothing(recipe, st.unsupported)

  /**
   * Mode avancé : la requête prête remplace (bascule automatique) ou s'ajoute à (bouton) l'historique. Bascule automatique
   * d'une recette partielle : son adresse est gardée pour « Voir la réponse simplifiée ».
   */
  const advanced = async (how: 'auto' | 'button') => {
    const spec = await adv.ask(st.heard, how, { recipe: st.recipeStatus ?? (nothing ? 'pas_comprise' : 'partielle'), missing })
    if (spec)
      nav(`/bilan/question?${encSql(spec)}`, {
        replace: how === 'auto',
        state: {
          heard: st.heard,
          advanced: how,
          ...(how === 'auto' && recipe && !nothing ? { simplified: encodeRecipe(recipe), notes: st.notes, unsupported: st.unsupported, recipeStatus: st.recipeStatus } : {}),
        } satisfies HistState,
      })
  }

  // Recette brute qui vient d'arriver (AskQuestion) : relue avec les listes de l'appli (et la phrase : grandeurs demandées),
  // mise dans l'adresse ; notée au journal (sauf si le mode avancé suit : noté avec son résultat).
  const pending = !params.get('r') && st.raw !== undefined
  useEffect(() => {
    if (!pending || !model.ctx) return
    const it = interpretRecipe(st.raw, st.nonGere, model.ctx, st.heard)
    const status: RecipeStatus = answersNothing(it.recipe, it.unsupported) ? 'pas_comprise' : it.notes.length || it.unsupported.length ? 'partielle' : 'complete'
    const autoSql = status !== 'complete' && sqlReady && !!st.heard
    if (!autoSql && st.heard) void logQuestion({ phrase: st.heard, recipe: status, recipeMissing: [...it.unsupported, ...it.notes] }, model.source?.() ?? null)
    // Réponse géographique, recette appliquée en entier : sur le bilan, ouvert sur le lieu de la question.
    if (status === 'complete' && goesToBilan(it.recipe)) {
      const to = bilanTarget(it.recipe, model)
      nav(`/bilan?${bilanQuestionSearch(to.recipe, to.place)}`, { replace: true, state: { bilanChain: [], heard: st.heard } })
      return
    }
    nav(`/bilan/question?${enc(it.recipe)}`, {
      replace: true,
      state: { heard: st.heard, notes: it.notes, unsupported: it.unsupported, autoSql, recipeStatus: status } satisfies HistState,
    })
  }, [pending, model.ctx]) // eslint-disable-line react-hooks/exhaustive-deps

  // La recette n'a pas tout appliqué : bascule automatique en mode avancé (un appel de plus), une fois par arrivée.
  const autoNow = !!recipe && !sqlSpec && !!st.autoSql && sqlReady && !!model.source && !!st.heard
  // En attendant (et pendant) le mode avancé : pas de réponse partielle à l'écran.
  const waiting = adv.busy || (autoNow && !autoStarted.has(loc.key))
  const answer = useMemo(() => (model.index && recipe && !nothing && !sqlSpec ? runRecipe(model.index, recipe) : null), [model.index, recipe, nothing, sqlSpec])
  useEffect(() => {
    if (!autoNow || autoStarted.has(loc.key)) return
    autoStarted.add(loc.key)
    void advanced('auto')
  }, [autoNow, loc.key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!can.viewCoverage(role)) return <Empty>Le bilan de détection est réservé aux administrateurs et aux encadrants.</Empty>
  if (!model.index || pending) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const left = (
    <div className="flex flex-col gap-3">
      <AskQuestion />
      {sqlSpec ? (
        <SqlExplain
          key={sqlSpec.sql}
          spec={sqlSpec}
          advanced={st.advanced}
          heard={st.heard}
          saved={st.saved}
          onSimplified={
            st.simplified
              ? () =>
                  nav(`/bilan/question?r=${encodeURIComponent(st.simplified!)}`, {
                    state: { heard: st.heard, notes: st.notes, unsupported: st.unsupported, recipeStatus: st.recipeStatus, fromAdvanced: true } satisfies HistState,
                  })
              : undefined
          }
        />
      ) : waiting ? (
        <AdvancedBusy heard={st.heard} onCancel={adv.cancel} />
      ) : recipe && nothing ? (
        <>
          {adv.error && (
            <p className="text-[11px] text-red-300" role="alert">
              {adv.error}
            </p>
          )}
          <NotUnderstood heard={st.heard} unsupported={st.unsupported} />
        </>
      ) : recipe ? (
        <>
          <div className="flex flex-col gap-1">
            {st.heard && <p className="text-[11px] text-muted">Entendu : « {st.heard} »</p>}
            {st.saved && <p className="text-[11px] text-muted">Ma question : « {st.saved} »</p>}
            {st.fromAdvanced && (
              <div className="flex flex-col items-start gap-1 rounded-md border border-line px-2 py-1.5 text-[11px]" role="note">
                <p>
                  <b>Réponse simplifiée</b> : la recette n’a appliqué qu’une partie de la question ; la réponse en mode avancé est plus juste.
                </p>
                <button type="button" className="min-h-9 text-[11px] font-bold underline" onClick={() => nav(-1)}>
                  Revenir à la réponse en mode avancé
                </button>
              </div>
            )}
            <RecipeChips recipe={recipe} names={model.names} model={recipeModel(model)} onChange={(r) => set(r, r.out.type === 'map')} />
            {!!missing.length && (
              <div className="flex flex-col items-start gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-[11px]" role="note">
                {!!st.unsupported?.length && (
                  <p>
                    <b>Pas pris en compte :</b> {st.unsupported.join(' ; ')}
                  </p>
                )}
                {!!st.notes?.length && (
                  <p>
                    <b>Non appliqué :</b> {st.notes.join(' ; ')}
                  </p>
                )}
                {sqlReady && st.heard && model.source && !st.fromAdvanced && (
                  <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => void advanced('button')}>
                    <span aria-hidden>✨</span> {adv.error ? 'Réessayer en mode avancé' : 'Essayer en mode avancé'}
                  </button>
                )}
                {adv.error && (
                  <span className="text-red-300" role="alert">
                    {adv.error}
                  </span>
                )}
              </div>
            )}
          </div>
          {saving ? (
            <SaveForm recipe={recipe} names={model.names} phrase={st.heard} onDone={() => setSaving(false)} />
          ) : (
            <button type="button" className="btn-ghost min-h-11 self-start px-3 text-xs" onClick={() => setSaving(true)}>
              <Icon name="star" className="h-3.5 w-3.5" />
              Enregistrer cette question
            </button>
          )}
        </>
      ) : (
        <Empty>Posez une question au bilan de détection, ou relancez une de « Mes questions ».</Empty>
      )}
      {side && <SavedQuestions model={model} open />}
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <BackButton fallback="/bilan" label="BILAN DE DÉTECTION" className="self-start" />
        <h1 className="text-lg font-extrabold">Question au bilan</h1>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 side:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <aside className={side ? 'sticky top-[calc(var(--hdr)+1rem)] max-h-[calc(100dvh-var(--hdr)-2rem)] overflow-y-auto' : ''} data-keep-scroll={side ? 'question-gauche' : undefined}>
          {left}
        </aside>
        <section className="min-w-0">
          {sqlSpec && <SqlAnswerView spec={sqlSpec} source={model.source} byId={model.byId} search={search} />}
          {!sqlSpec && !waiting && recipe && answer && model.index && (
            <AnswerView recipe={recipe} answer={answer} model={model} index={model.index} params={params} search={search} setRecipe={set} setMap={setMap} />
          )}
        </section>
        {/* Téléphone : « Mes questions » sous la réponse. */}
        {!side && <SavedQuestions model={model} />}
      </div>
    </div>
  )
}

/** Question pas comprise : ce que le modèle n'a pas su traduire et des questions qui marchent, au lieu d'une réponse. */
function NotUnderstood({ heard, unsupported }: { heard?: string; unsupported?: string[] }) {
  return (
    <div className="card flex flex-col gap-2 border-sky-500/40 p-3 text-xs" role="status">
      <p className="font-bold">Je ne sais pas encore répondre à : « {heard || 'cette question'} »</p>
      {!!unsupported?.length && <p className="text-muted">Pas compris : {unsupported.join(' ; ')}</p>}
      <div>
        <p className="text-muted">Par exemple, essayez :</p>
        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
          {QUESTION_EXAMPLES.slice(0, 3).map((q) => (
            <li key={q}>« {q} »</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------- Réponse ----------

function AnswerView({
  recipe,
  answer,
  model,
  index,
  params,
  search,
  setRecipe,
  setMap,
}: {
  recipe: Recipe
  answer: Answer<Player>
  model: Model
  index: QIndex<Player>
  params: URLSearchParams
  search: string
  setRecipe: (r: Recipe, keepMap?: boolean) => void
  setMap: (patch: { mr?: string; md?: string; mc?: string }) => void
}) {
  const nav = useNavigate()
  const cond = hasConditions(recipe)
  const f = recipe.pop.sex === 'F'
  const who = (n: number) => `${fr(n)} ${f ? (n > 1 ? 'joueuses' : 'joueuse') : n > 1 ? 'joueurs' : 'joueur'}`
  // Une nouvelle réponse (liste d'une ligne de tableau…) : nouvelle entrée d'historique, le retour revient ici.
  const open = (r: Recipe) => nav(`/bilan/question?${enc(r)}`)
  const summary = (
    <p className="text-[11px] text-muted">
      {cond ? (
        <>
          <b className="text-fg">{who(answer.count)}</b> sur {fr(answer.total)} dans la population ({shareText(answer.count, answer.total)})
        </>
      ) : (
        <b className="text-fg">{who(answer.count)}</b>
      )}{' '}
      · calculé sur l’appareil en {answer.ms} ms
    </p>
  )

  if (recipe.out.type === 'count')
    return (
      <div className="flex flex-col gap-3">
        <div className="card flex flex-col items-start gap-1 p-4">
          <span className="text-4xl font-extrabold tabular-nums">{fr(answer.count)}</span>
          <span className="text-sm">{who(answer.count).replace(/^\S+ /, '')}</span>
          {cond && (
            <span className="text-xs text-muted">
              sur {fr(answer.total)} dans la population ({shareText(answer.count, answer.total)})
            </span>
          )}
          {cond && <Bar t={{ seen: answer.count, total: answer.total || 1 }} className="mt-1 w-full" />}
          {answer.stat && <span className="mt-1 text-sm font-bold">{statText(recipe, model.names, answer.stat, true)}</span>}
        </div>
        {answer.count > 0 && (
          <button type="button" className="btn-ghost min-h-11 self-start px-3 text-xs" onClick={() => open({ ...recipe, out: { type: 'list' } })}>
            <Icon name="list" className="h-3.5 w-3.5" />
            Voir {answer.count > 1 ? 'la liste' : 'qui'}
          </button>
        )}
      </div>
    )

  if (recipe.out.type === 'list') {
    const rows = answer.rows ?? []
    const limit = recipe.out.limit ?? DEFAULT_LIMIT
    const ranked = answer.count - (answer.missing ?? 0)
    const sort = defaultSort(recipe).by
    const missingText =
      sort === 'priority'
        ? 'déjà vus deux fois ou plus : pas dans cette liste'
        : sort === 'progress'
          ? 'avec moins de deux avis sur ce point : pas dans ce classement'
          : 'sans valeur pour ce tri (pas d’avis ou pas de mesure) : pas dans ce classement'
    return (
      <div className="flex flex-col gap-2">
        {summary}
        {sort === 'priority' && (
          <p className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-[11px]">
            <b>Priorité</b>, {periodText(recipe.out.period ?? recipe.seen?.period ?? { kind: 'season' }, today())} : {PRIORITY_TEXT}.
          </p>
        )}
        {!!answer.missing && (
          <p className="text-[11px] text-muted">
            {fr(answer.missing)} {missingText}.
          </p>
        )}
        {!rows.length ? (
          <Empty>Personne ne répond à cette question pour l’instant.</Empty>
        ) : (
          rows.map(({ p, value, tag }) => (
            <PlayerRow
              key={p.id}
              p={p}
              link={{ to: `/bilan/question/joueurs/${p.id}${search}` }}
              sub={[p.birthDate?.slice(0, 4), p.club, valueText(recipe, model.names, value, tag)].filter(Boolean).join(' · ')}
              follow={<FollowStar id={p.id} />}
            />
          ))
        )}
        {ranked > limit && limit < LIMITS.limit[1] && (
          <button type="button" className="btn-ghost min-h-11 py-1.5 text-xs" onClick={() => setRecipe({ ...recipe, out: { ...recipe.out, limit: Math.min(LIMITS.limit[1], limit + DEFAULT_LIMIT) } })}>
            Afficher {Math.min(DEFAULT_LIMIT, ranked - limit)} de plus ({fr(ranked - limit)} {ranked - limit > 1 ? 'autres' : 'autre'})
          </button>
        )}
      </div>
    )
  }

  if (recipe.out.type === 'table' && recipe.out.groupBy === 'staff') {
    const rows = answer.table ?? []
    const per = periodText(recipe.out.period ?? recipe.seen?.period ?? { kind: 'season' }, today())
    const max = Math.max(1, ...rows.map((r) => r.staff!.players))
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[11px] text-muted">
          <b className="text-fg">
            {fr(rows.length)} {rows.length > 1 ? 'personnes du staff' : 'personne du staff'}
          </b>{' '}
          · {per} · parmi {who(answer.count)} · calculé sur l’appareil en {answer.ms} ms
        </p>
        <SectionTitle info="Joueurs distincts vus (marqués « vu » ou avec un avis) et avis écrits, dans la période. Noms lus sur cet appareil.">Par personne du staff</SectionTitle>
        {!rows.length ? (
          <Empty>Personne du staff n’a vu ces joueurs dans cette période.</Empty>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="card flex min-h-11 items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{model.names.staff?.(row.key) ?? 'Personne du staff'}</span>
                <span className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                  <span className="shrink-0">
                    <b className="text-fg">{who(row.staff!.players)}</b> vus · {fr(row.staff!.avis)} avis
                  </span>
                  <Bar t={{ seen: row.staff!.players, total: max }} className="w-12 sm:w-20" />
                </span>
              </span>
            </div>
          ))
        )}
      </div>
    )
  }

  if (recipe.out.type === 'table') {
    const by = recipe.out.groupBy ?? 'club'
    const rows = answer.table ?? []
    return (
      <div className="flex flex-col gap-2">
        {summary}
        {by === 'club' && rows.length > 0 && <ClubTableMap rows={rows} recipe={recipe} model={model} />}
        <SectionTitle info="Touchez une ligne pour la liste de ses joueurs (le retour revient à ce tableau).">
          {GROUP_OPTIONS.find((g) => g.value === by)!.label.replace(/^par /, 'Par ')}
          {recipe.out.limit ? ` · ${recipe.out.limit === 1 ? 'le premier' : `les ${recipe.out.limit} premiers`}` : ''}
        </SectionTitle>
        {!rows.length ? (
          <Empty>Aucune ligne ne répond à cette question pour l’instant.</Empty>
        ) : (
          rows.map((row) => {
            const label = groupLabel(by, row.key, recipeModel(model))
            const t: Tally = { seen: row.match, total: row.total }
            // Par événement : pas de liste à ouvrir (un joueur y est compté s'il y a été vu ; le filtre d'événement compte aussi sa liste).
            const go = row.key && by !== 'event' ? () => open(restrict(recipe, by, row.key)) : undefined
            return (
              <button key={row.key || '?'} type="button" disabled={!go} onClick={go} className="card flex min-h-11 items-center gap-3 px-3 py-2 text-left transition hover:border-accent disabled:opacity-80">
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm font-bold ${row.key ? '' : 'text-muted italic'}`}>{label}</span>
                  <span className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                    <span className="shrink-0">
                      {cond ? (
                        <>
                          <b className="text-fg">{fr(row.match)}</b> sur {fr(row.total)} · {shareText(row.match, row.total)}
                        </>
                      ) : (
                        <b className="text-fg">{who(row.total)}</b>
                      )}
                      {row.seen && (
                        <>
                          {' · '}
                          <b className={recipe.out.sort?.by === 'share' ? 'text-fg' : ''}>{shareText(row.seen.seen, row.seen.total)} vus</b>
                          {!cond && ` (${fr(row.seen.seen)})`}
                        </>
                      )}
                      {row.avg !== undefined && ` · moyenne ${row.avg === null ? '–' : fr(row.avg, 2)}`}
                      {row.stat && ` · ${statText(recipe, model.names, row.stat)}`}
                    </span>
                    {cond && <Bar t={t} className="w-12 sm:w-20" />}
                    {row.seen && !cond && <Bar t={row.seen} className="w-12 sm:w-20" />}
                  </span>
                </span>
                {go && <span className="shrink-0 text-muted">›</span>}
              </button>
            )
          })
        )}
        {recipe.out.sort?.by === 'share' && rows.some((r) => shareOf(r) === null) && <p className="text-[10px] text-muted">Sans joueur : en fin de tableau.</p>}
      </div>
    )
  }

  return <MapAnswer answer={answer} model={model} index={index} params={params} search={search} setMap={setMap} summary={summary} />
}

/**
 * Tableau par club de la recette (réponse restée ici : recette pas appliquée en entier) : les clubs à leur adresse, couleur
 * et taille selon le nombre de joueurs qui répondent ; un point ouvre le bilan sur le club (src/components/ClubAnswerMap.tsx).
 */
function ClubTableMap({ rows, recipe, model }: { rows: TableRow[]; recipe: Recipe; model: Model }) {
  const places = useClubPlaces(model.data?.players)
  const open = useOpenClub()
  const clubs = useMemo(
    () => [...locateClubs(rows.map((r) => r.key).filter(Boolean), places.known, places.units, places.deptOf).values()],
    [rows, places.known, places.units], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const f = recipe.pop.sex === 'F'
  const values = new Map(rows.map((r) => [r.key, r.match]))
  if (!clubs.length) return null
  return (
    <ClubAnswerMap
      clubs={clubs}
      values={values}
      valueLabel={`nombre de ${f ? 'joueuses' : 'joueurs'}${hasConditions(recipe) ? ' qui répondent' : ''}`}
      valueText={(k) => `${fr(values.get(k) ?? 0)} ${f ? 'joueuse' : 'joueur'}${(values.get(k) ?? 0) > 1 ? 's' : ''}`}
      onOpen={open}
    />
  )
}

/** Recette limitée à une ligne du tableau, en liste (part vue : les joueurs à voir en priorité de cette ligne). */
function restrict(r: Recipe, by: GroupBy, key: string): Recipe {
  const pop = { ...r.pop }
  if (by === 'club') pop.clubs = [key]
  if (by === 'dept') {
    pop.depts = [key]
    delete pop.regions
  }
  if (by === 'region') pop.regions = [key]
  if (by === 'year') putYears(pop, [Number(key)])
  if (by === 'position') pop.positions = [key as Position]
  if (by === 'sex') pop.sex = key as 'M' | 'F'
  const out: Recipe['out'] =
    r.out.value === 'avg'
      ? { type: 'list', avg: r.out.avg ?? r.avis[0]?.target ?? { on: 'global' }, sort: { by: 'avg', dir: 'desc' } }
      : r.out.value === 'seen' && !r.seen
        ? { type: 'list', sort: { by: 'priority', dir: 'desc' }, ...(r.out.period ? { period: r.out.period } : {}) }
        : { type: 'list' }
  return { ...r, pop, out }
}

// ---------- Carte ----------

/** Joueurs d'un club d'un département qui répondent à la question (carte, dernier niveau). */
function clubPlayers(index: QIndex<Player>, answer: Answer<Player>, dept: string, club: string) {
  const byName = (a: Player, b: Player) => a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' }) || a.firstName.localeCompare(b.firstName, 'fr')
  return answer.match.filter((p) => index.info.get(p.id)!.dept === dept && index.info.get(p.id)!.club === club).sort(byName)
}

function MapAnswer({
  answer,
  model,
  index,
  params,
  search,
  setMap,
  summary,
}: {
  answer: Answer<Player>
  model: Model
  index: QIndex<Player>
  params: URLSearchParams
  search: string
  setMap: (patch: { mr?: string; md?: string; mc?: string }) => void
  summary: ReactNode
}) {
  const regionLabel = useRegionLabel()
  const mr = params.get('mr') ?? ''
  const md = params.get('md') ?? ''
  const mc = params.get('mc')
  const t = useMemo(() => mapTallies(index, answer), [index, answer])
  const shown = !mr ? [...t.byRegion.values()] : [...t.byDept].filter(([d]) => regionOfDept(d) === mr).map(([, x]) => x)
  const sc = scaleOf(shown)
  // Condition rare (moins de 5 % de la population) : couleur selon le NOMBRE de joueurs qui répondent, mis en avant.
  const rare = answer.count > 0 && answer.count < 0.05 * answer.total
  const maxN = Math.max(1, ...shown.map((x) => x.seen))
  const colorOf = (x: Tally | undefined, max = maxN) => (rare && x?.total ? fillOf({ seen: x.seen, total: max }) : fillOf(x, sc))
  const fill = (code: string) => colorOf(!mr ? t.byRegion.get(regionOfDept(code) ?? '') : t.byDept.get(code))
  const pickRegion = (r: string) => setMap({ mr: r, md: '', mc: '' })
  const pickDept = (d: string) => setMap({ mr: regionOfDept(d) ?? '', md: d, mc: '' })
  // Clubs du département choisi : joueurs qui répondent sur joueurs de la population.
  const clubs = useMemo(() => {
    if (!md) return []
    const m = new Map<string, Tally>()
    for (const p of answer.pop) {
      const i = index.info.get(p.id)!
      if (i.dept !== md) continue
      const x = m.get(i.club) ?? { seen: 0, total: 0 }
      m.set(i.club, x)
      x.total++
      if (answer.matchIds.has(p.id)) x.seen++
    }
    return [...m].sort((a, b) => (!a[0] ? 1 : !b[0] ? -1 : b[1].seen - a[1].seen || b[1].total - a[1].total))
  }, [md, answer, index])
  const clubMax = Math.max(1, ...clubs.map(([, x]) => x.seen))
  const share = (x: Tally) =>
    rare ? (
      <>
        <b className="text-fg">{fr(x.seen)}</b> · {shareText(x.seen, x.total)} de {fr(x.total)}
      </>
    ) : (
      <>
        <b className="text-fg">{shareText(x.seen, x.total)}</b> · {fr(x.seen)} sur {fr(x.total)}
      </>
    )
  // Ordre des régions et départements : part (ou nombre, condition rare) décroissante.
  const order = (a: Tally, b: Tally) => (rare ? b.seen - a.seen : b.seen / b.total - a.seen / a.total) || b.total - a.total
  const Row = ({ label, x, onClick, on, max }: { label: string; x: Tally; onClick: () => void; on?: boolean; max?: number }) => (
    <button type="button" onClick={onClick} aria-pressed={on} className={`card flex min-h-11 items-center gap-3 px-3 py-2 text-left transition hover:border-accent ${on ? 'border-accent bg-accent/10' : ''}`}>
      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: colorOf(x, max) }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{label}</span>
        <span className="mt-1 flex items-center gap-2 text-[10px] text-muted">
          <span className="shrink-0">{share(x)}</span>
          <Bar t={x} className="w-12 sm:w-20" />
        </span>
      </span>
      <span className="shrink-0 text-muted">›</span>
    </button>
  )
  const crumbs = [
    { label: 'France', go: () => setMap({ mr: '', md: '', mc: '' }) },
    ...(mr ? [{ label: regionLabel(mr), go: () => pickRegion(mr) }] : []),
    ...(md ? [{ label: model.names.dept(md), go: mc !== null ? () => setMap({ mc: '' }) : undefined }] : []),
    ...(md && mc !== null ? [{ label: mc ? model.names.club(mc) : 'Club non renseigné' }] : []),
  ]
  const players = md && mc !== null ? clubPlayers(index, answer, md, mc) : []
  const list =
    md && mc !== null ? (
      <section className="flex flex-col gap-2">
        <SectionTitle>{mc ? model.names.club(mc) : 'Club non renseigné'} · ceux qui répondent</SectionTitle>
        {players.length ? (
          players.map((p) => <PlayerRow key={p.id} p={p} link={{ to: `/bilan/question/joueurs/${p.id}${search}` }} follow={<FollowStar id={p.id} />} />)
        ) : (
          <Empty>Personne dans ce club ne répond à la question.</Empty>
        )}
      </section>
    ) : md ? (
      <section className="flex flex-col gap-2">
        <SectionTitle>Clubs · {model.names.dept(md)}</SectionTitle>
        {clubs.length ? (
          clubs.map(([k, x]) => <Row key={k || '?'} label={k ? model.names.club(k) : 'Club non renseigné'} x={x} max={clubMax} onClick={() => setMap({ mc: k })} />)
        ) : (
          <Empty>Aucun joueur ici.</Empty>
        )}
      </section>
    ) : mr ? (
      <section className="flex flex-col gap-2">
        <SectionTitle>Départements · {regionLabel(mr)}</SectionTitle>
        {[...t.byDept]
          .filter(([d]) => regionOfDept(d) === mr)
          .sort((a, b) => order(a[1], b[1]))
          .map(([d, x]) => (
            <Row key={d} label={model.names.dept(d)} x={x} onClick={() => pickDept(d)} />
          ))}
      </section>
    ) : (
      <section className="flex flex-col gap-2">
        <SectionTitle>Régions</SectionTitle>
        {answer.total ? (
          [...t.byRegion]
            .sort((a, b) => order(a[1], b[1]))
            .map(([r, x]) => <Row key={r} label={regionLabel(r)} x={x} onClick={() => pickRegion(r)} />)
        ) : (
          <Empty>Aucun joueur dans cette population.</Empty>
        )}
        {t.noDept.total > 0 && <p className="text-[11px] text-muted">Département non renseigné : {fr(t.noDept.seen)} sur {fr(t.noDept.total)}.</p>}
      </section>
    )
  return (
    <div className="flex flex-col gap-3">
      {summary}
      <Crumbs steps={crumbs} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 min-[1400px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className="card flex flex-col gap-2 p-3">
          <FranceMap
            region={mr}
            selected={md}
            fill={fill}
            onRegion={pickRegion}
            onDept={pickDept}
            touch="select"
            className="side:max-h-[calc(100dvh-var(--hdr)-16rem)]"
            ariaLabel="Part des joueurs qui répondent à la question, par région et par département"
            others={showOtherOM(t.byDept)}
            label={(code) => {
              const x = t.byDept.get(code)
              return `${model.names.dept(code)} : ${x?.total ? share(x) : 'aucun joueur dans cette population'}`
            }}
            tip={({ code, isRegion }) => {
              const x = isRegion ? t.byRegion.get(code) : t.byDept.get(code)
              return (
                <>
                  <div className="font-bold">{isRegion ? regionLabel(code) : model.names.dept(code)}</div>
                  {x?.total ? <div className="mt-1 text-muted">{share(x)}</div> : <div className="mt-1 text-muted">Aucun joueur dans cette population</div>}
                </>
              )
            }}
          />
          {rare ? (
            <div className="flex items-center gap-2 text-[10px] text-muted">
              <span className="tabular-nums">0</span>
              <span className="h-3 min-w-0 flex-1 rounded-sm" style={{ background: `linear-gradient(to right, ${fillOf({ seen: 0, total: 1 })}, ${fillOf({ seen: 1, total: 1 })})` }} />
              <span className="tabular-nums">
                {fr(maxN)} {maxN > 1 ? 'joueurs' : 'joueur'}
              </span>
            </div>
          ) : (
            <MapLegend sc={sc} />
          )}
          <p className="text-[10px] text-muted">
            {rare ? 'Peu de joueurs répondent : couleur selon leur nombre (la part est donnée à côté).' : 'Part de la population qui répond à la question.'} {md ? 'Touchez un club pour ses joueurs.' : mr ? 'Touchez un département pour ses clubs.' : 'Touchez une région pour la voir de plus près.'}
          </p>
        </section>
        {list}
      </div>
    </div>
  )
}

// ---------- Enregistrer, Mes questions ----------

/** Valeurs proposées pour les variables (listes de l'appli). */
function useVarLists() {
  const regions = useRegions()
  const depts = useDepartments()
  const groups = useLiveQuery(() => loadTeams().then(() => db.groups.toArray().then((gs) => alive(gs).filter((g) => can.seeGroup(g)).sort((a, b) => a.name.localeCompare(b.name, 'fr')))), [], [])
  return {
    regions: regions.length ? regions.map((r) => ({ id: r.id, name: r.name })) : officialRegions(),
    depts: depts.map((d) => ({ code: d.code!, name: d.name })),
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
  }
}

function VarForm({ q, onLaunch, onCancel }: { q: SavedQuestion; onLaunch: (v: VarValues) => void; onCancel: () => void }) {
  const lists = useVarLists()
  const [v, setV] = useState<VarValues>(() => varValues(q.recipe))
  const max = Number(today().slice(0, 4))
  const set = (patch: VarValues) => setV({ ...v, ...patch })
  return (
    <form
      className="flex flex-col gap-2 border-t border-line pt-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault()
        onLaunch(Object.fromEntries(q.vars.map((k) => [k, v[k]])) as VarValues)
      }}
    >
      {q.vars.map((k) => (
        <div key={k} className="flex flex-wrap items-center gap-2">
          <span className="w-32 shrink-0 font-bold">{VAR_TEXT[k]}</span>
          {k === 'sex' && (
            <Segmented<'' | 'M' | 'F'>
              value={v.sex ?? ''}
              onChange={(sex) => set({ sex })}
              options={[
                { value: '', label: 'Tous' },
                { value: 'M', label: 'Garçons' },
                { value: 'F', label: 'Filles' },
              ]}
            />
          )}
          {k === 'years' && (
            // Une ou plusieurs années (toutes décochées : celles de la question restent).
            <YearPicker className="min-h-9 w-48 py-1 text-xs" allLabel="Celles de la question" value={(v.years ?? []).map(String).reverse()} options={recentYears(max)} onChange={(ys) => set({ years: ys.map(Number) })} />
          )}
          {k === 'period' && <PeriodPicker value={v.period ?? { kind: 'season' }} onChange={(period) => set({ period })} />}
          {k === 'seenN' && <NumberInput label="Nombre de vus" value={v.seenN} min={0} max={LIMITS.n[1]} onChange={(seenN) => set({ seenN })} className="w-16" />}
          {k === 'region' && <Select label="Région" value={v.region ?? ''} onChange={(region) => set({ region })} options={lists.regions.map((r) => ({ value: r.id, label: r.name }))} />}
          {k === 'dept' && <Select label="Département" value={v.dept ?? ''} onChange={(dept) => set({ dept })} options={lists.depts.map((d) => ({ value: d.code, label: `${d.code} · ${d.name}` }))} />}
          {k === 'position' && (
            <Select<Position> label="Poste" value={v.position ?? POSITIONS[0]?.id} onChange={(position) => set({ position })} options={POSITIONS.map((p) => ({ value: p.id, label: p.label }))} />
          )}
          {k === 'group' && <Select label="Groupe" value={v.group ?? ''} onChange={(group) => set({ group })} options={lists.groups.map((g) => ({ value: g.id, label: g.name }))} />}
        </div>
      ))}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary min-h-11 px-4 text-xs">
          Lancer
        </button>
        <button type="button" className="btn-ghost min-h-11 px-4 text-xs" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  )
}

/** « Mes questions » : relance sans appel au modèle ; les variables se choisissent avant. */
export function SavedQuestions({ model, open: startOpen = false, clubDept }: { model?: Model; open?: boolean; clubDept?: (club: string) => string | undefined }) {
  const saved = useSavedQuestions()
  const nav = useNavigate()
  const [open, setOpen] = useState(startOpen)
  const [asking, setAsking] = useState<string | null>(null)
  if (!saved.length) return null
  const launch = (q: SavedQuestion, v: VarValues = {}) => {
    setAsking(null)
    const r = applyVars(q.recipe, v)
    // Réponse géographique : sur le bilan, ouvert sur le lieu de la question (le retour revient ici).
    if (!q.sql && goesToBilan(r)) {
      const to = bilanTarget(r, model, clubDept)
      return nav(`/bilan?${bilanQuestionSearch(to.recipe, to.place)}`, { state: { bilanChain: [] } })
    }
    nav(`/bilan/question?${q.sql ? encSql(q.sql) : enc(r)}`, { state: { saved: q.name } satisfies HistState })
  }
  return (
    <section className="card flex flex-col gap-2 p-3">
      <button type="button" className="flex min-h-9 items-center gap-2 text-left text-sm font-bold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="star" className="h-4 w-4 text-accent" />
        <span className="flex-1">Mes questions ({saved.length})</span>
        <span className={`text-muted transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open &&
        saved.map((q) => (
          <div key={q.id} className="flex flex-col gap-1 rounded-md border border-line p-2">
            <div className="flex flex-wrap items-start gap-2">
              <span className="min-w-[11rem] flex-1">
                <span className="block text-xs font-bold">{q.name}</span>
                <span className="block text-[10px] text-muted">
                  {q.sql ? `Mode avancé · ${q.sql.explanation}` : model ? recipeText(q.recipe, model.names) : q.phrase}
                  {q.vars.length > 0 && ` · à choisir : ${q.vars.map((v) => VAR_TEXT[v]).join(', ')}`}
                </span>
              </span>
              <button
                type="button"
                className="btn-primary min-h-11 shrink-0 px-3 text-xs"
                onClick={() => (q.vars.length ? setAsking(asking === q.id ? null : q.id) : launch(q))}
                aria-expanded={q.vars.length ? asking === q.id : undefined}
              >
                Relancer
              </button>
              <button
                type="button"
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted hover:text-fg"
                aria-label={`Supprimer « ${q.name} »`}
                title="Supprimer cette question"
                onClick={async () => (await ask(`Supprimer la question « ${q.name} » de cet appareil ?`, { ok: 'Supprimer', danger: true })) && deleteQuestion(q.id)}
              >
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </div>
            {asking === q.id && <VarForm q={q} onLaunch={(v) => launch(q, v)} onCancel={() => setAsking(null)} />}
          </div>
        ))}
    </section>
  )
}

// ---------- Fiche d'un joueur ouverte depuis une réponse ----------

/** Joueurs de la réponse affichée (liste, ou joueurs du club choisi sur la carte), pour ‹ › et la colonne de gauche. */
function answerIds(recipe: Recipe | null, answer: Answer<Player> | null, index: QIndex<Player> | null, params: URLSearchParams): Player[] {
  if (!recipe || !answer || !index) return []
  if (recipe.out.type === 'list') return (answer.rows ?? []).map((r) => r.p)
  const md = params.get('md')
  const mc = params.get('mc')
  if (recipe.out.type === 'map' && md && mc !== null) return clubPlayers(index, answer, md, mc)
  return []
}

const QCtx = createContext<{ value: (p: Player) => string } | null>(null)

/**
 * /bilan/question/joueurs/:pid?r=… : fiche dans le contexte de la réponse (comme depuis un événement, un groupe ou le
 * bilan) ; ordinateur : les joueurs de la réponse à gauche ; téléphone : ‹ › ; « Retour » revient à la réponse telle quelle.
 */
export function QuestionPlayers() {
  const { pid } = useParams()
  const role = useRole()
  const split = useMedia(MQ.split)
  const model = useQuestionModel()
  const { recipe, sqlSpec, params, search } = useRecipeParam()
  const answer = useMemo(() => (model.index && recipe && !sqlSpec ? runRecipe(model.index, recipe) : null), [model.index, recipe, sqlSpec])
  // Mode avancé : les joueurs de la requête (même résultat, gardé en mémoire), avec ses colonnes en clair.
  const sqlRes = useSqlResult(sqlSpec, model.source)
  const sqlRows = useMemo(() => sqlPlayers(sqlRes.res ?? null, model.byId), [sqlRes.res, model.byId])
  const players = useMemo(
    () => (sqlSpec ? sqlRows.players : answerIds(recipe, answer, model.index, params)),
    [sqlSpec, sqlRows, recipe, answer, model.index, params],
  )
  const leave = useLeaveTo(`/bilan/question${search}`, 'QUESTION')
  const value = useMemo(() => {
    if (sqlSpec) return (p: Player) => sqlRows.extra.get(p.id) ?? ''
    const m = new Map((answer?.rows ?? []).map((r) => [r.p.id, r]))
    return (p: Player) => (recipe ? valueText(recipe, model.names, m.get(p.id)?.value, m.get(p.id)?.tag) : '')
  }, [answer, recipe, model.names, sqlSpec, sqlRows])
  const base = '/bilan/question/joueurs'
  if (!can.viewCoverage(role)) return <Empty>Le bilan de détection est réservé aux administrateurs et aux encadrants.</Empty>
  if (!pid) return <Navigate to={`/bilan/question${search}`} replace />
  if (!model.index) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const ids = players.map((p) => p.id)
  if (!split)
    return (
      <QCtx.Provider value={{ value }}>
        <ContextBar title="Réponse" ids={ids} current={pid} base={base} search={search} back={() => void leave.go()} />
        <Outlet />
      </QCtx.Provider>
    )
  return (
    <QCtx.Provider value={{ value }}>
      <MasterDetail
        base={base}
        closeTo={`/bilan/question${search}`}
        search={search}
        listCol="minmax(0, var(--md-col))"
        list={
          <ContextRoster
            base={base}
            search={search}
            back={leave}
            count={players.length ? `${players.length.toLocaleString('fr-FR')} dans la réponse` : ''}
            sections={[{ heading: sqlSpec ? sqlSpec.explanation : recipe ? recipeText(recipe, model.names) : null, players }]}
            detail={(p) => [p.birthDate?.slice(0, 4), value(p)].filter(Boolean).join(' · ')}
            actions={(p) => ({ follow: <FollowStar id={p.id} /> })}
          />
        }
      />
    </QCtx.Provider>
  )
}

/** Fiche du joueur, sous ce que la réponse en dit (valeur du tri : moyenne, taille, nombre de vus…). */
export function QuestionPlayer() {
  const { pid = '' } = useParams()
  const split = useMedia(MQ.split)
  const ctx = useContext(QCtx)
  const p = useLiveQuery(() => db.players.get(pid), [pid])
  const v = p && ctx ? ctx.value(p) : ''
  return (
    <div key={pid} className="flex flex-col gap-3">
      {v && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-[11px]">
          Dans la réponse : <b>{v}</b>
        </div>
      )}
      <PlayerDetail id={pid} hideBack={!split} />
    </div>
  )
}

