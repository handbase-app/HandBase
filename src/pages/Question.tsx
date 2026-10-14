import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { alive, counts, db, POSITIONS, today, type Player, type Position } from '../db'
import { seasonOf, type Tally } from '../coverage'
import { officialRegions, regionOfDept, useDepartments, useRegionLabel, useRegions } from '../lists'
import { useThrottledQuery } from '../live'
import { MQ, useMedia } from '../layout'
import { can, useRole } from '../roles'
import { scoutId } from '../scouting'
import { loadTeams } from '../teams'
import { categoryStyles, styleOf } from '../radarZones'
import {
  answersNothing,
  periodText,
  applyVars,
  avgText,
  avisCategories,
  avisCriteria,
  buildIndex,
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
  measureCriteria,
  possibleVars,
  recipeChips,
  recipeText,
  removeChip,
  runRecipe,
  VAR_TEXT,
  varValues,
  type Answer,
  type AvisTarget,
  type Chip,
  type Cmp,
  type GroupBy,
  type Names,
  type OutType,
  type Period,
  type QIndex,
  type QSight,
  type QuestionContext,
  type Recipe,
  type SavedQuestion,
  type SortBy,
  type VarKey,
  type VarValues,
} from '../recipe'
import { deleteQuestion, saveQuestion, useSavedQuestions } from '../savedQuestions'
import { useVoicePlaces } from '../voicePlaces'
import { AskQuestion, type AskState } from '../components/AskQuestion'
import { AdvancedBusy, SqlAnswerView, SqlExplain, sqlPlayers, useAdvancedAsk, useSqlResult, type MirrorSource } from '../components/SqlAnswer'
import { useDictation } from '../dictation/useDictation'
import { decodeSqlSpec, encodeSqlSpec, type SqlSpec } from '../sqlGuard'
import { ask } from '../components/Confirm'
import { ContextBar, ContextRoster, useLeaveTo } from '../components/ContextRoster'
import { FollowStar } from '../components/Follow'
import { FranceMap, useDeptName } from '../components/FranceMap'
import MasterDetail from '../components/MasterDetail'
import { department } from '../components/PlayerFilter'
import { PlayerRow } from '../components/PlayerRow'
import { Empty, Icon, Segmented, SectionTitle } from '../components/ui'
import { Bar, Crumbs, fillOf, MapLegend, scaleOf } from './Coverage'
import PlayerDetail from './PlayerDetail'

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
 *  - MODE AVANCÉ (src/components/SqlAnswer.tsx) : /bilan/question?s=<requête> ; quand la recette ne sait rien répondre
 *    (« Je ne sais pas encore… »), bascule automatique ; quand une partie n'est pas prise en compte, bouton « Essayer en mode
 *    avancé ». Requête SQLite écrite par le modèle, exécutée seulement sur une copie locale jetable (jamais sur Supabase).
 * Ordinateur : question et « Mes questions » à gauche (1/3), réponse à droite (2/3). Uniquement des formulations
 * positives ou neutres sur les jeunes (« pas encore vus », tri croissant / décroissant).
 */

// ---------- Données ----------

/** Joueurs, passages (événement et personne), avis validés, mesures, critères, groupes visibles, événements. */
function useQuestionData() {
  return useThrottledQuery(
    async () => {
      const [players, seen, evals, events, measures, criteria, groups] = await Promise.all([
        db.players.toArray(),
        db.seen.toArray(),
        db.evaluations.toArray(),
        db.events.toArray(),
        db.measurements.toArray(),
        db.criteria.toArray(),
        loadTeams().then(() => db.groups.toArray()),
      ])
      const dead = new Set(events.filter((e) => e.deleted).map((e) => e.id))
      const me = scoutId()
      const dayOf = (s: string) => (s.length <= 10 ? s : new Date(Date.parse(s)).toLocaleDateString('sv'))
      // Passages, comme le bilan (src/coverage.ts toSights) : « vu » et avis (hors cadre exclus), avec l'événement et la personne.
      const sights: QSight[] = []
      // Noms des personnes du staff (signature du serveur, auteur de l'avis) : lus ici, affichés, jamais envoyés.
      const staff = new Map<string, string>()
      const named = (id: string | undefined, name: string | undefined) => id && name?.trim() && !staff.has(id) && staff.set(id, name.trim())
      for (const s of seen) {
        if (s.deleted || dead.has(s.eventId)) continue
        const when = s.at ?? s.createdAtServer
        const mine = !!me && (s.createdBy ? s.createdBy === me : s.id.startsWith(`${me}:`))
        named(s.createdBy, s.createdByName)
        sights.push({
          playerId: s.playerId,
          day: when ? dayOf(when) : new Date(s.updatedAt).toLocaleDateString('sv'),
          event: s.eventId,
          person: s.createdBy ?? (mine ? me! : s.id.split(':')[0] || s.createdByName || '?'),
        })
      }
      for (const e of evals) {
        if (e.deleted || e.review === 'refused' || (e.eventId && dead.has(e.eventId))) continue
        const day = dayOf(e.date)
        named(e.observerId, e.observer)
        // Avis sans événement : un jour d'observation compte comme un événement.
        sights.push({ playerId: e.playerId, day, event: e.eventId || `jour:${day}`, person: e.observerId || e.observer || '?' })
      }
      return {
        players,
        sights,
        staff,
        // Moyennes : avis validés seulement (comme la comparaison et le classement).
        evals: evals
          .filter((e) => !e.deleted && counts(e))
          .map((e) => ({ playerId: e.playerId, observer: e.observerId || e.observer, day: dayOf(e.date), scores: e.scores })),
        measures,
        criteria: alive(criteria),
        groups: alive(groups).filter((g) => can.seeGroup(g)),
        events: alive(events),
        // Mode avancé (copie locale en tables, src/sqlMirror.ts) : avis tels quels, en attente compris (colonne « valide »).
        rawEvals: evals.filter((e) => !e.deleted && e.review !== 'refused' && !(e.eventId && dead.has(e.eventId))),
      }
    },
    [],
    ['players', 'seen', 'evaluations', 'events', 'measurements', 'criteria', 'groups', 'teams'],
    300,
  )
}

/** Données indexées, contexte de relecture (listes réelles) et noms affichés. */
function useQuestionModel() {
  const data = useQuestionData()
  const lists = useDepartments()
  const regionLabel = useRegionLabel()
  const deptName = useDeptName()
  const places = useVoicePlaces()
  const index = useMemo(() => {
    if (!data) return null
    const styles = categoryStyles(data.criteria)
    return buildIndex<Player>({ ...data, deptOf: department, regionOf: (d) => regionOfDept(d), zoneOf: (c) => styleOf(styles, c).zone, today: today() })
  }, [data, lists]) // eslint-disable-line react-hooks/exhaustive-deps
  const ctx = useMemo<QuestionContext | null>(() => {
    if (!index || !data) return null
    // Clubs : nom affiché et département de la plupart de leurs joueurs.
    const depts = new Map<string, Map<string, number>>()
    for (const p of index.players) {
      const i = index.info.get(p.id)!
      if (!i.club || !i.dept) continue
      const m = depts.get(i.club) ?? new Map<string, number>()
      depts.set(i.club, m)
      m.set(i.dept, (m.get(i.dept) ?? 0) + 1)
    }
    const top = (m?: Map<string, number>) => (m ? [...m].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined)
    return {
      ...places,
      positions: POSITIONS,
      clubs: [...index.clubNames].map(([key, name]) => ({ key, name, dept: top(depts.get(key)) })),
      groups: data.groups.map((g) => ({ id: g.id, name: g.name })),
      events: data.events.map((e) => ({ id: e.id, name: e.name, date: e.date })),
      criteria: data.criteria,
      zoneOf: index.data.zoneOf,
      today: today(),
    }
  }, [index, data, places])
  const names = useMemo<Names>(
    () => ({
      region: (id) => regionLabel(id),
      dept: (c) => `${deptName(c)} (${c})`,
      club: (k) => index?.clubNames.get(k) ?? k,
      group: (id) => data?.groups.find((g) => g.id === id)?.name ?? 'groupe',
      event: (id) => data?.events.find((e) => e.id === id)?.name ?? 'événement',
      criterion: (id) => data?.criteria.find((c) => c.id === id)?.label ?? 'critère',
      unit: (id) => data?.criteria.find((c) => c.id === id)?.unit,
      position: (id) => POSITIONS.find((p) => p.id === id)?.label ?? id,
      // Une personne sans nom connu est l'auteur d'un avis écrit hors ligne : son nom tel qu'écrit, sinon « Moi ».
      staff: (id) => data?.staff.get(id) ?? (id === scoutId() ? 'Moi' : /^[0-9a-f-]{30,}$/i.test(id) ? 'Personne du staff' : id),
      today: today(),
    }),
    [index, data, regionLabel, deptName],
  )
  const byId = useMemo(() => new Map((data?.players ?? []).map((p) => [p.id, p])), [data])
  // Mode avancé : données de la copie locale (construite seulement à la première requête, src/sqlClient.ts).
  const source = useMemo<MirrorSource>(
    () =>
      data && index
        ? () => ({
            players: data.players,
            sights: data.sights,
            evals: data.rawEvals,
            measures: data.measures,
            criteria: data.criteria,
            groups: data.groups,
            events: data.events,
            deptOf: department,
            regionOf: (d) => regionOfDept(d),
            regionName: names.region,
            deptName: (c) => names.dept(c).replace(/ \([^)]*\)$/, ''),
            zoneOf: index.data.zoneOf,
            staffName: names.staff!,
            today: today(),
          })
        : null,
    [data, index, names],
  )
  return { data, index, ctx, names, byId, source }
}

type Model = ReturnType<typeof useQuestionModel>
/** autoSql : la recette n'a rien su répondre, bascule en mode avancé (une fois) ; advanced : réponse venue du mode avancé. */
type HistState = Partial<AskState> & { notes?: string[]; unsupported?: string[]; saved?: string; autoSql?: boolean; advanced?: 'auto' | 'button' }

const enc = (r: Recipe) => `r=${encodeURIComponent(encodeRecipe(r))}`
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
  /** Mode avancé : la requête prête remplace (bascule automatique) ou s'ajoute à (bouton) l'historique. */
  const advanced = async (how: 'auto' | 'button') => {
    const spec = await adv.ask(st.heard, how, st.unsupported)
    if (spec) nav(`/bilan/question?${encSql(spec)}`, { replace: how === 'auto', state: { heard: st.heard, advanced: how } satisfies HistState })
  }

  // Recette brute qui vient d'arriver (AskQuestion) : relue avec les listes de l'appli, puis mise dans l'adresse.
  const pending = !params.get('r') && st.raw !== undefined
  useEffect(() => {
    if (!pending || !model.ctx) return
    const it = interpretRecipe(st.raw, st.nonGere, model.ctx)
    nav(`/bilan/question?${enc(it.recipe)}`, {
      replace: true,
      state: { heard: st.heard, notes: it.notes, unsupported: it.unsupported, autoSql: answersNothing(it.recipe, it.unsupported) } satisfies HistState,
    })
  }, [pending, model.ctx]) // eslint-disable-line react-hooks/exhaustive-deps

  // Ni population, ni condition, ni tri parlant : « Je ne sais pas encore répondre », jamais une liste par défaut.
  const nothing = !!recipe && answersNothing(recipe, st.unsupported)
  const answer = useMemo(() => (model.index && recipe && !nothing && !sqlSpec ? runRecipe(model.index, recipe) : null), [model.index, recipe, nothing, sqlSpec])

  // La recette ne sait rien répondre : bascule automatique en mode avancé (un appel de plus), une fois par arrivée.
  const autoNow = !!recipe && nothing && !!st.autoSql && sqlReady && !!model.source && !!st.heard
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
        <SqlExplain key={sqlSpec.sql} spec={sqlSpec} advanced={st.advanced} heard={st.heard} saved={st.saved} />
      ) : adv.busy ? (
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
            <RecipeChips recipe={recipe} names={model.names} model={model} onChange={(r) => set(r, r.out.type === 'map')} />
            {!!st.unsupported?.length && (
              <div className="flex flex-col items-start gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-[11px]" role="note">
                <p>
                  <b>Pas pris en compte :</b> {st.unsupported.join(' ; ')}
                </p>
                {sqlReady && st.heard && model.source && (
                  <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => void advanced('button')}>
                    <span aria-hidden>✨</span> Essayer en mode avancé
                  </button>
                )}
                {adv.error && (
                  <span className="text-red-300" role="alert">
                    {adv.error}
                  </span>
                )}
              </div>
            )}
            {!!st.notes?.length && <p className="text-[11px] text-muted">Non appliqué : {st.notes.join(' ; ')}</p>}
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
          {!sqlSpec && recipe && answer && model.index && (
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

// ---------- Pastilles ----------

const chipCls = (on: boolean) =>
  `flex min-h-9 max-w-full items-center gap-1 rounded-full border px-3 py-1 text-left text-xs font-bold transition ${
    on ? 'border-accent bg-accent text-white' : 'border-accent/50 bg-accent/10 text-fg hover:border-accent'
  }`

function RecipeChips({ recipe, names, model, onChange }: { recipe: Recipe; names: Names; model: Model; onChange: (r: Recipe) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const chips = recipeChips(recipe, names)
  const chip = chips.find((c) => c.key === open)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" aria-label="La question en clair, toucher une pastille pour la changer ou la retirer">
        {chips.map((c) => (
          <button key={c.key} type="button" className={chipCls(c.key === open)} aria-expanded={c.key === open} onClick={() => setOpen(c.key === open ? null : c.key)}>
            <span className="min-w-0 truncate">{c.label}</span>
            {(c.edit || c.removable) && <span className="shrink-0 text-[10px] opacity-60">▾</span>}
          </button>
        ))}
      </div>
      {chip && <ChipEditor key={chip.key} chip={chip} recipe={recipe} model={model} onChange={onChange} onClose={() => setOpen(null)} />}
    </div>
  )
}

const OPS: { value: Cmp; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'gte', label: '≥ au moins' },
  { value: 'lte', label: '≤ au plus' },
]
const OPS2 = OPS.filter((o) => o.value !== 'eq') as { value: 'gte' | 'lte'; label: string }[]

function NumberInput({ value, onChange, min, max, step = 1, label, className = 'w-20' }: { value?: number; onChange: (n: number) => void; min: number; max: number; step?: number; label: string; className?: string }) {
  const [text, setText] = useState(value === undefined ? '' : String(value).replace('.', ','))
  return (
    <input
      className={`field min-h-11 py-1 text-sm ${className}`}
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value.replace(',', '.'))
        if (e.target.value.trim() && Number.isFinite(n) && n >= min && n <= max && (step >= 1 ? Number.isInteger(n) : true)) onChange(n)
      }}
    />
  )
}

function Select<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <select className="field min-h-11 py-1 text-sm" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const s = seasonOf(today())
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select<Period['kind']>
        label="Période"
        value={value.kind}
        onChange={(kind) => onChange(kind === 'since' ? { kind, since: value.since ?? s.from } : { kind })}
        options={[
          { value: 'season', label: `Cette saison (${s.label})` },
          { value: '12m', label: '12 derniers mois' },
          { value: 'all', label: 'Depuis toujours' },
          { value: 'since', label: 'Depuis le…' },
        ]}
      />
      {value.kind === 'since' && (
        <input
          type="date"
          className="field min-h-11 py-1 text-sm"
          aria-label="Depuis le"
          max={today()}
          value={value.since ?? ''}
          onChange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value <= today() && onChange({ kind: 'since', since: e.target.value })}
        />
      )}
    </div>
  )
}

/** Cible d'une moyenne : générale, catégorie, critère. */
function TargetPicker({ value, model, onChange }: { value: AvisTarget; model: Model; onChange: (t: AvisTarget) => void }) {
  const cs = model.data?.criteria ?? []
  const opts = [
    // Score combiné (venu de la question) : gardé tel quel tant qu'on n'en choisit pas un autre.
    ...(value.on === 'mix' ? [{ value: 'mix', label: avgText(value, model.names).replace(/^score/, 'Score') }] : []),
    { value: 'g', label: 'Moyenne générale' },
    ...avisCategories(cs).map((c) => ({ value: `c:${c}`, label: `Catégorie : ${c}` })),
    ...avisCriteria(cs).map((c) => ({ value: `k:${c.id}`, label: `Critère : ${c.label}` })),
  ]
  const cur = value.on === 'mix' ? 'mix' : value.on === 'category' ? `c:${value.name}` : value.on === 'criterion' ? `k:${value.id}` : 'g'
  return (
    <Select
      label="Moyenne de"
      value={opts.some((o) => o.value === cur) ? cur : 'g'}
      options={opts}
      onChange={(v) =>
        v !== 'mix' && onChange(v.startsWith('c:') ? { on: 'category', name: v.slice(2) } : v.startsWith('k:') ? { on: 'criterion', id: v.slice(2) } : { on: 'global' })
      }
    />
  )
}

function ChipEditor({ chip, recipe, model, onChange, onClose }: { chip: Chip; recipe: Recipe; model: Model; onChange: (r: Recipe) => void; onClose: () => void }) {
  const r: Recipe = structuredClone(recipe)
  const apply = (f: (x: Recipe) => void) => {
    f(r)
    onChange(r)
  }
  const [k, i] = chip.key.split('.')
  const idx = Number(i)
  let body: ReactNode = null
  switch (chip.edit) {
    case 'sex':
      body = (
        <Segmented<'M' | 'F'>
          value={r.pop.sex}
          onChange={(v) => apply((x) => (x.pop.sex = v))}
          options={[
            { value: 'M', label: 'Garçons' },
            { value: 'F', label: 'Filles' },
          ]}
        />
      )
      break
    case 'years': {
      const [a, b] = r.pop.years ?? [2010, 2010]
      const max = Number(today().slice(0, 4))
      body = (
        <div className="flex items-center gap-2 text-xs">
          nés de <NumberInput label="Première année" value={a} min={LIMITS.year[0]} max={max} onChange={(n) => apply((x) => (x.pop.years = [Math.min(n, b), Math.max(n, b)]))} />
          à <NumberInput label="Dernière année" value={b} min={LIMITS.year[0]} max={max} onChange={(n) => apply((x) => (x.pop.years = [Math.min(a, n), Math.max(a, n)]))} />
        </div>
      )
      break
    }
    case 'height':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          taille (cm) de <NumberInput label="Taille minimum" value={r.pop.hMin} min={100} max={230} onChange={(n) => apply((x) => (x.pop.hMin = n))} />
          à <NumberInput label="Taille maximum" value={r.pop.hMax} min={100} max={230} onChange={(n) => apply((x) => (x.pop.hMax = n))} />
        </div>
      )
      break
    case 'seen': {
      const s = r.seen!
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select label="Opérateur" value={s.op} options={OPS} onChange={(op) => apply((x) => (x.seen!.op = op))} />
          <NumberInput label="Nombre" value={s.n} min={0} max={LIMITS.n[1]} onChange={(n) => apply((x) => (x.seen!.n = n))} className="w-16" />
          <Select
            label="Compter"
            value={s.by}
            onChange={(by) => apply((x) => (x.seen!.by = by))}
            options={[
              { value: 'event', label: 'événements distincts' },
              { value: 'person', label: 'personnes du staff distinctes' },
            ]}
          />
        </div>
      )
      break
    }
    case 'period':
      body = <PeriodPicker value={r.seen!.period} onChange={(p) => apply((x) => (x.seen!.period = p))} />
      break
    case 'avis': {
      const a = r.avis[idx]
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <TargetPicker value={a.target} model={model} onChange={(t) => apply((x) => (x.avis[idx].target = t))} />
          <Select label="Opérateur" value={a.op} options={OPS2} onChange={(op) => apply((x) => (x.avis[idx].op = op))} />
          <NumberInput label="Note sur 5" value={a.value} min={0} max={5} step={0.1} onChange={(n) => apply((x) => (x.avis[idx].value = n))} className="w-16" />
          <span className="text-muted">sur 5</span>
        </div>
      )
      break
    }
    case 'nbAvis':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select label="Opérateur" value={r.nbAvis!.op} options={OPS} onChange={(op) => apply((x) => (x.nbAvis!.op = op))} />
          <NumberInput label="Nombre d’avis" value={r.nbAvis!.n} min={0} max={LIMITS.n[1]} onChange={(n) => apply((x) => (x.nbAvis!.n = n))} className="w-16" />
          avis
        </div>
      )
      break
    case 'measure': {
      const m = r.measures[idx]
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select label="Opérateur" value={m.op} options={OPS2} onChange={(op) => apply((x) => (x.measures[idx].op = op))} />
          <NumberInput label="Valeur" value={m.value} min={LIMITS.measure[0]} max={LIMITS.measure[1]} step={0.01} onChange={(n) => apply((x) => (x.measures[idx].value = n))} />
          {model.names.unit?.(m.id)}
        </div>
      )
      break
    }
    case 'out':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select<OutType>
            label="Réponse"
            value={r.out.type}
            onChange={(type) => apply((x) => (x.out = { type, ...(type === 'table' ? { groupBy: x.out.groupBy ?? 'club' } : {}) }))}
            options={[
              { value: 'count', label: 'Combien ?' },
              { value: 'list', label: 'Liste de joueurs' },
              { value: 'table', label: 'Tableau' },
              { value: 'map', label: 'Carte de France' },
            ]}
          />
          {r.out.type === 'table' && (
            <Select<GroupBy> label="Regrouper" value={r.out.groupBy ?? 'club'} onChange={(g) => apply((x) => (x.out.groupBy = g))} options={GROUP_OPTIONS} />
          )}
        </div>
      )
      break
    case 'value':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select<'count' | 'seen' | 'avg'>
            label="Colonne"
            value={r.out.value ?? 'count'}
            onChange={(v) => apply((x) => (x.out.value = v))}
            options={[
              { value: 'count', label: 'Nombre seulement' },
              { value: 'seen', label: 'Part vue' },
              { value: 'avg', label: 'Moyenne d’avis' },
            ]}
          />
          {r.out.value === 'seen' && !r.seen && <PeriodPicker value={r.out.period ?? { kind: 'season' }} onChange={(p) => apply((x) => (x.out.period = p))} />}
          {r.out.value === 'avg' && <TargetPicker value={r.out.avg ?? r.avis[0]?.target ?? { on: 'global' }} model={model} onChange={(t) => apply((x) => (x.out.avg = t))} />}
        </div>
      )
      break
    case 'outPeriod':
      body = <PeriodPicker value={r.out.period ?? r.seen?.period ?? { kind: 'season' }} onChange={(p) => apply((x) => (x.out.period = p))} />
      break
    case 'sort': {
      const table = r.out.type === 'table'
      const staff = table && r.out.groupBy === 'staff'
      const s = table ? (r.out.sort ?? { by: staff ? ('seen' as const) : ('share' as const), dir: 'desc' as const }) : defaultSort(r)
      const ms = measureCriteria(model.data?.criteria ?? [])
      const options: { value: SortBy; label: string }[] = staff
        ? [
            { value: 'seen', label: 'Joueurs vus' },
            { value: 'nbAvis', label: 'Avis écrits' },
          ]
        : table
          ? [
              { value: 'share', label: r.out.value === 'seen' || !hasConditions(r) ? 'Part vue' : 'Part qui répond' },
              { value: 'count', label: 'Nombre de joueurs' },
              { value: 'avg', label: 'Moyenne d’avis' },
            ]
          : [
              { value: 'name', label: 'Nom' },
              { value: 'year', label: 'Année de naissance' },
              { value: 'height', label: 'Taille' },
              { value: 'seen', label: 'Nombre de vus' },
              { value: 'avg', label: 'Moyenne d’avis' },
              { value: 'nbAvis', label: 'Nombre d’avis' },
              ...(ms.length ? [{ value: 'measure' as const, label: 'Mesure' }] : []),
              { value: 'progress', label: 'Évolution entre les deux derniers avis' },
              { value: 'priority', label: 'À voir en priorité' },
            ]
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select<SortBy> label="Trier par" value={s.by} onChange={(by) => apply((x) => (x.out.sort = { by, dir: by === 'name' ? 'asc' : 'desc' }))} options={options} />
          {s.by !== 'priority' && (
            <Segmented<'asc' | 'desc'>
              value={s.dir}
              onChange={(dir) => apply((x) => (x.out.sort = { by: s.by, dir }))}
              options={[
                { value: 'asc', label: 'Croissant ↑' },
                { value: 'desc', label: 'Décroissant ↓' },
              ]}
            />
          )}
          {s.by === 'priority' && <span className="text-muted">Priorité : {PRIORITY_TEXT}.</span>}
          {(s.by === 'avg' || s.by === 'progress') && <TargetPicker value={r.out.avg ?? r.avis[0]?.target ?? { on: 'global' }} model={model} onChange={(t) => apply((x) => (x.out.avg = t))} />}
          {s.by === 'measure' && (
            <Select
              label="Mesure"
              value={r.out.measure ?? r.measures[0]?.id ?? ms[0]?.id ?? ''}
              onChange={(m) => apply((x) => (x.out.measure = m))}
              options={ms.map((c) => ({ value: c.id, label: c.label }))}
            />
          )}
        </div>
      )
      break
    }
    case 'limit':
      body = (
        <div className="flex items-center gap-2 text-xs">
          Montrer les <NumberInput label="Nombre de joueurs montrés" value={r.out.limit ?? DEFAULT_LIMIT} min={1} max={LIMITS.limit[1]} onChange={(n) => apply((x) => (x.out.limit = n))} className="w-20" /> premiers
        </div>
      )
      break
  }
  void k
  return (
    <div className="card flex flex-col gap-2 border-accent/50 p-3">
      {body}
      <div className="flex flex-wrap items-center gap-2">
        {chip.removable && (
          <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => (onChange(removeChip(recipe, chip.key)), onClose())}>
            <Icon name="close" className="h-3.5 w-3.5" />
            Retirer « {chip.label} »
          </button>
        )}
        <button type="button" className="ml-auto min-h-11 px-3 text-xs font-bold text-muted underline" onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  )
}

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'club', label: 'par club' },
  { value: 'dept', label: 'par département' },
  { value: 'region', label: 'par région' },
  { value: 'year', label: 'par génération' },
  { value: 'position', label: 'par poste' },
  { value: 'sex', label: 'par sexe' },
  { value: 'staff', label: 'par personne du staff' },
]

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
        <SectionTitle info="Touchez une ligne pour la liste de ses joueurs (le retour revient à ce tableau).">
          {GROUP_OPTIONS.find((g) => g.value === by)!.label.replace(/^par /, 'Par ')}
        </SectionTitle>
        {!rows.length ? (
          <Empty>Aucune ligne ne répond à cette question pour l’instant.</Empty>
        ) : (
          rows.map((row) => {
            const label = groupLabel(by, row.key, model)
            const t: Tally = { seen: row.match, total: row.total }
            const go = row.key ? () => open(restrict(recipe, by, row.key)) : undefined
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

/** Valeur du tri, en clair, dans la ligne du joueur (priorité : la raison, en clair). */
function valueText(r: Recipe, names: Names, v: number | null | undefined, tag?: string): string {
  if (tag) return tag
  if (v === null || v === undefined) return ''
  const by = defaultSort(r).by
  const target = r.out.avg ?? r.avis[0]?.target ?? { on: 'global' as const }
  if (by === 'avg') return `${avgText(target, names)} ${fr(v, 2)}`
  if (by === 'progress') return `évolution ${v > 0 ? '+' : ''}${fr(v, 2)} entre les deux derniers avis`
  if (by === 'height') return `${v} cm`
  if (by === 'seen') return `${fr(v)} ${r.seen?.by === 'person' ? (v > 1 ? 'personnes' : 'personne') : v > 1 ? 'événements' : 'événement'}`
  if (by === 'nbAvis') return `${fr(v)} avis`
  if (by === 'measure') {
    const id = r.out.measure ?? r.measures[0]?.id ?? ''
    return `${names.criterion(id)} ${fr(v, 2)}${names.unit?.(id) ? ` ${names.unit(id)}` : ''}`
  }
  return ''
}

function groupLabel(by: GroupBy, key: string, model: Model): string {
  if (by === 'club') return key ? model.names.club(key) : 'Club non renseigné'
  if (by === 'dept') return key ? model.names.dept(key) : 'Département non renseigné'
  if (by === 'region') return key ? model.names.region(key) : 'Région inconnue'
  if (by === 'year') return key || 'Année inconnue'
  if (by === 'position') return key ? model.names.position(key as Position) : 'Sans poste'
  if (by === 'staff') return model.names.staff?.(key) ?? 'Personne du staff'
  return key === 'M' ? 'Garçons' : key === 'F' ? 'Filles' : 'Sexe non renseigné'
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
  if (by === 'year') pop.years = [Number(key), Number(key)]
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

function SaveForm({ recipe, names, phrase, onDone }: { recipe: Recipe; names: Names; phrase?: string; onDone: () => void }) {
  const [name, setName] = useState(() => (phrase ?? recipeText(recipe, names)).slice(0, 80))
  const can = possibleVars(recipe)
  const [vars, setVars] = useState<VarKey[]>([])
  return (
    <form
      className="card flex flex-col gap-2 border-accent/50 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        saveQuestion(name, recipe, vars, phrase)
        onDone()
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-bold">
        Nom de la question
        <input className="field min-h-11 text-sm font-normal" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
      </label>
      {can.length > 0 && (
        <fieldset className="flex flex-col gap-1 text-xs">
          <legend className="mb-1 font-bold">Valeurs à choisir à chaque relance (facultatif)</legend>
          {can.map((v) => (
            <label key={v} className="flex min-h-9 items-center gap-2">
              <input type="checkbox" checked={vars.includes(v)} onChange={(e) => setVars(e.target.checked ? [...vars, v] : vars.filter((x) => x !== v))} />
              {VAR_TEXT[v]}
            </label>
          ))}
        </fieldset>
      )}
      <p className="text-[10px] text-muted">Gardée sur cet appareil. Une question enregistrée se relance sans rien envoyer.</p>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary min-h-11 px-4 text-xs">
          Enregistrer
        </button>
        <button type="button" className="btn-ghost min-h-11 px-4 text-xs" onClick={onDone}>
          Annuler
        </button>
      </div>
    </form>
  )
}

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
            <>
              <NumberInput label="Première année" value={v.years?.[0]} min={LIMITS.year[0]} max={max} onChange={(n) => set({ years: [n, Math.max(n, v.years?.[1] ?? n)] })} />
              à
              <NumberInput label="Dernière année" value={v.years?.[1]} min={LIMITS.year[0]} max={max} onChange={(n) => set({ years: [Math.min(n, v.years?.[0] ?? n), n] })} />
            </>
          )}
          {k === 'period' && <PeriodPicker value={v.period ?? { kind: 'season' }} onChange={(period) => set({ period })} />}
          {k === 'seenN' && <NumberInput label="Nombre de vus" value={v.seenN} min={0} max={LIMITS.n[1]} onChange={(seenN) => set({ seenN })} className="w-16" />}
          {k === 'region' && <Select label="Région" value={v.region ?? ''} onChange={(region) => set({ region })} options={lists.regions.map((r) => ({ value: r.id, label: r.name }))} />}
          {k === 'dept' && <Select label="Département" value={v.dept ?? ''} onChange={(dept) => set({ dept })} options={lists.depts.map((d) => ({ value: d.code, label: `${d.code} · ${d.name}` }))} />}
          {k === 'position' && (
            <Select<Position> label="Poste" value={v.position ?? 'GB'} onChange={(position) => set({ position })} options={POSITIONS.map((p) => ({ value: p.id, label: p.label }))} />
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
export function SavedQuestions({ model, open: startOpen = false }: { model?: Model; open?: boolean }) {
  const saved = useSavedQuestions()
  const nav = useNavigate()
  const [open, setOpen] = useState(startOpen)
  const [asking, setAsking] = useState<string | null>(null)
  if (!saved.length) return null
  const launch = (q: SavedQuestion, v: VarValues = {}) => (
    setAsking(null), nav(`/bilan/question?${q.sql ? encSql(q.sql) : enc(applyVars(q.recipe, v))}`, { state: { saved: q.name } satisfies HistState })
  )
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

