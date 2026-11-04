import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db, fmtDate, newId, save, today, type Player } from '../db'
import { w } from '../gender'
import { objectiveFromTemplate, templatesOf } from '../goalTemplates'
import { useConfigRows } from '../installation'
import {
  addOwnGoal,
  editOwnGoal,
  emptyMyGoals,
  goalRights,
  goalViews,
  MY_GOAL_ERRORS,
  OWN_MAX_ACTIVE,
  removeOwnGoal,
  setOwnGoalStatus,
  setStaffStepCheck,
  stepCheckable,
  type GoalOwner,
  type GoalView,
  type MyGoals,
  type OwnGoalInput,
  type StepView,
  type Viewer,
} from '../myGoals'
import { fetchPlayerGoals, saveMyGoals } from '../myGoalsApi'
import {
  badVideoUrl,
  cleanVideoUrl,
  finalizeObjectives,
  objectiveOrigin,
  objectivesOf,
  OBJECTIVE_ERRORS,
  OBJ_MAX_ACTIVE,
  OBJ_STEP_TEXT_MAX,
  OBJ_STEPS_MAX,
  OBJ_TEXT_MAX,
  OBJ_URL_MAX,
  originEvents,
  progressLabel,
  sameObjectives,
  setObjectiveStatus,
  setStepDone,
  sourceLabel,
  type ObjectiveStep,
  type WorkObjective,
} from '../objectives'
import { ask, inform } from './Confirm'
import { FormActions, FormWindow } from './FormWindow'
import { ItemMenu, type MenuAnchor } from './ItemMenu'
import { Icon, SectionTitle } from './ui'

/*
 * Objectifs de travail, en LISTE À COCHER AVEC DES ÉTAPES (04/11 ; src/objectives.ts, src/myGoals.ts, supabase/065) :
 *  - Une ligne par objectif : la CASE (à gauche) le coche « atteint ✓ » ; la LIGNE elle-même (texte, « 1 étape sur 3 », la
 *    petite flèche ›) déplie ses étapes. Deux cibles séparées, 44 px de haut chacune.
 *  - Déplié : les étapes, chacune avec sa case et son « ▶ vidéo » (lien ouvert dans un nouvel onglet ; jamais intégré : rien
 *    ne se charge à l'affichage), le lien de l'objectif, « + Ajouter une étape » pour qui peut le modifier.
 *  - ObjectivesCard : carte de la fiche (onglet Profil). Le staff qui peut modifier la fiche coche ses objectifs et leurs
 *    étapes sur place ; le crayon ouvre la modification (texte, lien, étapes, « Atteint ✓ », d'où il vient, date, retirer,
 *    ajouter, « + Depuis un modèle ») ; « Terminé » écrit la fiche une fois. Il voit aussi les objectifs du jeune (« à
 *    lui / à elle ») et ses coches, sans y toucher.
 *  - MyObjectives : « Mes objectifs » sur la page du jeune. Il coche les étapes (celles du staff comprises) et ses propres
 *    objectifs, en ajoute (5 en cours au plus), les modifie ou les retire (fenêtre « Mon objectif ») ; ceux du staff restent
 *    au staff (texte, étapes, « atteint »). Clavier seulement : rien ne part vers une IA (ni micro, ni Demander).
 *    Script 065 pas passé, hors ligne : lecture seule (ceux du staff, avec leurs étapes).
 * Toujours en positif : « En cours » ou « Atteint ✓ », « 1 étape sur 3 », rien d'autre.
 */

// ---------- Petits éléments ----------

/** Case à cocher de 44 px (dessin de 22 px) : cochée en vert ; inactive, elle montre l'état sans réagir. */
function CheckBox({ checked, disabled, label, title, onToggle, small = false }: { checked: boolean; disabled?: boolean; label: string; title?: string; onToggle?: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      onClick={onToggle}
      className={`flex shrink-0 items-center justify-center ${small ? 'h-10 w-10' : 'h-11 w-11'} ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
    >
      <span
        className={`flex items-center justify-center rounded-md border-2 ${small ? 'h-5 w-5' : 'h-[22px] w-[22px]'} ${
          checked ? 'border-emerald-500 bg-emerald-500 text-white' : disabled ? 'border-dashed border-line bg-transparent' : 'border-line bg-panel'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        {checked && (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        )}
      </span>
    </button>
  )
}

/** « ▶ vidéo » : ouvre le lien dans un nouvel onglet (http(s) seulement ; rien n'est chargé à l'affichage). */
function VideoLink({ url, label = 'vidéo' }: { url?: string; label?: string }) {
  const href = cleanVideoUrl(url)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-bold text-accent hover:bg-accent/10"
      title="Ouvrir la vidéo dans un nouvel onglet"
    >
      <Icon name="play" filled className="h-3 w-3" />
      {label}
    </a>
  )
}

/** Avancement en petits points (un par étape), à côté de « 1 étape sur 3 ». */
function Dots({ steps }: { steps: StepView[] }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {steps.map((s) => (
        <span key={s.id} className={`h-1.5 w-1.5 rounded-full ${s.checked ? 'bg-emerald-500' : 'bg-line'}`} />
      ))}
    </span>
  )
}

// ---------- Liste à cocher (fiche et page du jeune) ----------

interface ListProps {
  viewer: Viewer
  sex?: string | null
  opts: { staffEdit?: boolean; playerWrite?: boolean }
  onCheckGoal: (v: GoalView) => void
  onCheckStep: (v: GoalView, s: StepView) => void
  /** Modifier un objectif (page du jeune : ses objectifs). */
  onEdit?: (v: GoalView) => void
  /** « + Ajouter une étape » sur un objectif qu'on peut modifier. */
  onAddStep?: (v: GoalView) => void
}

const keyOf = (v: GoalView) => `${v.owner}:${v.goal.id}`

/** « du staff » ; « à moi » (le jeune) ; « à lui » / « à elle » (le staff). */
const ownerLabel = (owner: GoalOwner, viewer: Viewer, sex?: string | null) => (owner === 'staff' ? 'du staff' : viewer === 'joueur' ? 'à moi' : `à ${w(sex).lui}`)

function GoalList({ active, done, ...props }: ListProps & { active: GoalView[]; done: GoalView[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })
  const item = (v: GoalView) => <GoalItem key={keyOf(v)} v={v} expanded={open.has(keyOf(v))} onExpand={() => toggle(keyOf(v))} {...props} />
  return (
    <div className="flex flex-col gap-2">
      {active.length > 0 && <ul className="flex flex-col gap-2">{active.map(item)}</ul>}
      {done.length > 0 &&
        (done.length <= 2 ? (
          <ul className="flex flex-col gap-2">{done.map(item)}</ul>
        ) : (
          <details className="rounded-lg border border-line p-2">
            <summary className="min-h-10 cursor-pointer content-center text-xs font-bold">Objectifs atteints ({done.length})</summary>
            <ul className="mt-2 flex flex-col gap-2">{done.map(item)}</ul>
          </details>
        ))}
    </div>
  )
}

function GoalItem({ v, expanded, onExpand, viewer, sex, opts, onCheckGoal, onCheckStep, onEdit, onAddStep }: ListProps & { v: GoalView; expanded: boolean; onExpand: () => void }) {
  const o = v.goal
  const rights = goalRights(viewer, v.owner, opts)
  const atteint = o.status === 'atteint'
  const progress = progressLabel(v.progress)
  const from = objectiveOrigin(o, fmtDate)
  const source = v.owner === 'staff' ? sourceLabel(o) : ''
  const g = w(sex)
  const stepsId = `etapes-${v.owner}-${o.id}`
  // Case de l'objectif : qui ne peut pas le cocher le voit sans pouvoir y toucher (le jeune, pour un objectif du staff).
  const checkTitle = rights.check ? (atteint ? 'Le remettre en cours' : 'Marquer atteint') : v.owner === 'staff' ? 'Le staff le coche quand il est atteint' : `${g.LeJoueur} le coche quand il est atteint`
  return (
    <li className="rounded-lg border border-line bg-panel-2" data-testid="objectif">
      <div className="flex items-stretch">
        <CheckBox checked={atteint} disabled={!rights.check} label={`« ${o.text} » : ${atteint ? 'atteint' : 'en cours'}`} title={checkTitle} onToggle={() => onCheckGoal(v)} />
        <button
          type="button"
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left"
          aria-expanded={expanded}
          aria-controls={stepsId}
          onClick={onExpand}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold break-words">{o.text}</span>
            {(progress || from || source || (atteint && o.doneAt)) && (
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                {progress && (
                  <span className="inline-flex items-center gap-1.5">
                    {progress}
                    <Dots steps={v.steps} />
                  </span>
                )}
                {/* Donné à tout un groupe (src/groupObjectives.ts) : « groupe Pôle », discrètement (sous la pastille « du staff »). */}
                {source && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Icon name="users" className="h-3 w-3 shrink-0" />
                    {source}
                  </span>
                )}
                {from && <span>{from}</span>}
                {atteint && o.doneAt && <span>atteint le {fmtDate(o.doneAt)}</span>}
              </span>
            )}
          </span>
          <span className="flex shrink-0 flex-col items-end gap-0.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${v.owner === 'staff' ? 'bg-panel text-muted' : 'bg-accent/15 text-accent'}`}>{ownerLabel(v.owner, viewer, sex)}</span>
            {atteint && <span className="text-[10px] font-bold text-emerald-500">✓ atteint</span>}
          </span>
          <Icon name="chevron" className={`h-4 w-4 shrink-0 text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      </div>
      {expanded && (
        <div id={stepsId} className="border-t border-line px-1 pt-1 pb-2">
          {v.steps.length > 0 ? (
            <ul className="flex flex-col">
              {v.steps.map((s) => (
                <StepLine key={s.id} s={s} v={v} viewer={viewer} sex={sex} opts={opts} onCheck={() => onCheckStep(v, s)} />
              ))}
            </ul>
          ) : (
            <p className="px-2 py-2 text-[11px] text-muted">Pas encore d’étape.</p>
          )}
          <div className="flex flex-wrap items-center gap-1 px-1">
            {o.video && <VideoLink url={o.video} label="vidéo de l’objectif" />}
            {rights.edit && onAddStep && v.steps.length < OBJ_STEPS_MAX && (
              <button type="button" className="min-h-10 rounded-full px-2 text-[11px] font-bold text-accent hover:bg-accent/10" onClick={() => onAddStep(v)}>
                + Ajouter une étape
              </button>
            )}
            {rights.edit && onEdit && (
              <button type="button" className="min-h-10 rounded-full px-2 text-[11px] font-bold text-muted hover:bg-panel hover:text-fg" onClick={() => onEdit(v)}>
                <Icon name="pencil" className="mr-1 inline h-3 w-3" />
                Modifier
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function StepLine({ s, v, viewer, sex, opts, onCheck }: { s: StepView; v: GoalView; viewer: Viewer; sex?: string | null; opts: ListProps['opts']; onCheck: () => void }) {
  const can = stepCheckable(viewer, v.owner, s, opts)
  // Cochée par l'autre côté : on le dit (le staff voit « par lui / par elle », le jeune « par le staff »).
  const other = s.checked && ((viewer === 'staff' && s.by === 'joueur') || (viewer === 'joueur' && s.by === 'staff'))
  const byText = other ? (s.by === 'staff' ? 'par le staff' : `par ${w(sex).lui}`) : ''
  return (
    <li className="flex items-center gap-1">
      <CheckBox
        small
        checked={s.checked}
        disabled={!can}
        label={`Étape « ${s.text} » : ${s.checked ? 'faite' : 'à faire'}`}
        title={s.checked && s.at ? `Cochée le ${fmtDate(s.at)}${byText ? ` ${byText}` : ''}` : undefined}
        onToggle={onCheck}
      />
      <span className="min-w-0 flex-1 py-1 text-[13px] break-words">
        {s.text}
        {byText && <span className="ml-1.5 text-[10px] font-bold text-emerald-500">✓ {byText}</span>}
      </span>
      <VideoLink url={s.video} />
    </li>
  )
}

// ---------- Étapes en modification (fiche, fenêtre « Mon objectif », Réglages → modèles) ----------

export interface StepDraft {
  id: string
  text: string
  video?: string
  done?: string
}

/** Champ « Lien vidéo » : http(s) seulement ; un lien refusé est signalé tout de suite. */
export function VideoField({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  const bad = badVideoUrl(value)
  return (
    <div className="flex min-w-0 flex-col">
      <input
        type="url"
        inputMode="url"
        className={`field min-h-10 w-full text-xs ${bad ? 'border-red-500/70' : ''}`}
        placeholder="Lien vidéo (https://…), facultatif"
        maxLength={OBJ_URL_MAX}
        aria-label={label}
        aria-invalid={bad}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {bad && <span className="mt-0.5 text-[10px] text-red-500">Une adresse web : elle commence par http:// ou https://.</span>}
    </div>
  )
}

/** Liste d'étapes modifiable : texte, lien vidéo (montré par le bouton ▶), retirer ; « + Ajouter une étape » (8 au plus). */
export function StepsEditor({ steps, onChange, focusId, newStepId = newId }: { steps: StepDraft[]; onChange: (s: StepDraft[]) => void; focusId?: string; newStepId?: () => string }) {
  // Champs de lien ouverts (ceux qui ont déjà un lien le sont d'office).
  const [links, setLinks] = useState<Set<string>>(() => new Set(steps.filter((s) => s.video).map((s) => s.id)))
  const [focus, setFocus] = useState<string | undefined>(focusId)
  const patch = (id: string, x: Partial<StepDraft>) => onChange(steps.map((s) => (s.id === id ? { ...s, ...x } : s)))
  return (
    <div className="flex flex-col gap-1.5">
      {steps.map((s, i) => {
        const showLink = links.has(s.id)
        return (
          <div key={s.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span className="w-5 shrink-0 text-center text-[11px] font-bold text-muted tabular-nums">{i + 1}</span>
              <input
                className="field min-h-10 min-w-0 flex-1 text-sm"
                placeholder={i === 0 ? 'Ex. : Corde à sauter 10 min par jour' : 'Une autre étape'}
                maxLength={OBJ_STEP_TEXT_MAX}
                aria-label={`Étape ${i + 1}`}
                autoFocus={focus === s.id}
                value={s.text}
                onChange={(e) => patch(s.id, { text: e.target.value })}
              />
              <button
                type="button"
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-panel ${showLink || s.video ? 'text-accent' : 'text-muted'}`}
                aria-label={`Lien vidéo de l’étape ${i + 1}`}
                aria-pressed={showLink}
                title="Lien vidéo (le modèle, la démonstration de l’exercice)"
                onClick={() =>
                  setLinks((l) => {
                    const n = new Set(l)
                    if (n.has(s.id) && !s.video) n.delete(s.id)
                    else n.add(s.id)
                    return n
                  })
                }
              >
                <Icon name="video" className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-fg"
                aria-label={`Retirer l’étape ${i + 1}`}
                title="Retirer cette étape"
                onClick={() => onChange(steps.filter((x) => x.id !== s.id))}
              >
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </div>
            {showLink && (
              <div className="pr-20 pl-6">
                <VideoField value={s.video ?? ''} onChange={(v) => patch(s.id, { video: v })} label={`Lien vidéo de l’étape ${i + 1}`} />
              </div>
            )}
          </div>
        )
      })}
      {steps.length < OBJ_STEPS_MAX ? (
        <button
          type="button"
          className="min-h-10 w-fit rounded-full px-2 text-xs font-bold text-accent hover:bg-accent/10"
          onClick={() => {
            const id = newStepId()
            setFocus(id)
            onChange([...steps, { id, text: '' }])
          }}
        >
          + Ajouter une étape
        </button>
      ) : (
        <p className="text-[10px] text-muted">{OBJ_STEPS_MAX} étapes au plus.</p>
      )}
    </div>
  )
}

/** Étapes d'un objectif → brouillon. */
const toStepDrafts = (steps?: ObjectiveStep[]): StepDraft[] => (steps ?? []).map((s) => ({ ...s }))

// ---------- Objectifs du jeune, lus à la demande ----------

/**
 * Ses objectifs « à moi » et ses coches (fiche du staff, bilan à imprimer). null : pas lisibles (script 065 pas passé, hors
 * ligne, pas de droit) : on montre ceux du staff seulement.
 */
export function usePlayerGoals(playerId: string, enabled = true): MyGoals | null {
  const [state, setState] = useState<{ id: string; goals: MyGoals | null } | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void fetchPlayerGoals(playerId).then((r) => live && setState({ id: playerId, goals: r.ok ? r.value : null }))
    return () => {
      live = false
    }
  }, [playerId, enabled])
  return state?.id === playerId ? state.goals : null
}

// ---------- Fiche du staff ----------

/** Brouillon d'un objectif pendant la modification (texte libre, nettoyé à « Terminé »). */
interface Draft extends Omit<WorkObjective, 'steps'> {
  steps: StepDraft[]
  isNew?: boolean
  /** Étape à pointer en ouvrant (« + Ajouter une étape » depuis la liste). */
  focusStep?: string
}

const toDraft = (o: WorkObjective): Draft => ({ ...o, steps: toStepDrafts(o.steps) })

export function ObjectivesCard({ player: p, canEdit }: { player: Player; canEdit: boolean }) {
  const g = w(p.sex)
  const saved = objectivesOf(p)
  const mine = usePlayerGoals(p.id)
  const templates = templatesOf(useConfigRows())
  const [draft, setDraft] = useState<Draft[] | null>(null)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  // Événements proposés comme origine : ceux où le joueur était sur la liste (6 derniers mois).
  const events = useLiveQuery(async () => (draft ? originEvents(await db.events.toArray(), p.id, today()) : []), [p.id, !!draft]) ?? []
  const views = goalViews(saved, mine)
  if (!saved.length && !mine?.own.length && !canEdit) return null

  const patch = (id: string, x: Partial<Draft>) => setDraft((d) => d && d.map((o) => (o.id === id ? { ...o, ...x } : o)))
  const draftActive = draft ? draft.filter((o) => o.status === 'en_cours').length : 0

  /** La fiche écrite une fois (rien si rien n'a changé). */
  function writeFiche(next: WorkObjective[]) {
    if (sameObjectives(next, saved)) return
    const { objectives: _old, ...rest } = p
    void save<Player>('players', next.length ? { ...rest, objectives: next } : rest)
  }

  function finish() {
    if (!draft) return
    if (draft.some((o) => badVideoUrl(o.video) || o.steps.some((s) => s.text.trim() && badVideoUrl(s.video))))
      return void inform('Un lien n’est pas une adresse web : il doit commencer par http:// ou https://. Corrige-le ou efface-le.')
    // Lignes vides retirées, textes nettoyés, étapes vides retirées ; l'ordre est gardé.
    writeFiche(finalizeObjectives(draft.map(({ isNew: _n, focusStep: _f, ...o }) => o)))
    setDraft(null)
  }

  const startEdit = (focusOn?: { goal: string; step: string }) =>
    setDraft(
      saved.length
        ? saved.map((o) => {
            const d = toDraft(o)
            return focusOn?.goal === o.id ? { ...d, steps: [...d.steps, { id: focusOn.step, text: '' }], focusStep: focusOn.step } : d
          })
        : [{ id: newId(), text: '', status: 'en_cours', steps: [], isNew: true }],
    )

  // Sur place, hors modification : cocher un objectif du staff (« atteint ») ou une de ses étapes.
  function checkGoal(v: GoalView) {
    if (v.owner !== 'staff' || !canEdit) return
    const r = setObjectiveStatus(saved, v.goal.id, v.goal.status === 'atteint' ? 'en_cours' : 'atteint', today())
    if (!r.ok) return void inform(OBJECTIVE_ERRORS[r.error])
    writeFiche(r.list)
  }
  function checkStep(v: GoalView, s: StepView) {
    if (v.owner !== 'staff' || !canEdit || (s.checked && s.by === 'joueur')) return
    writeFiche(setStepDone(saved, v.goal.id, s.id, !s.checked, today()))
  }

  return (
    <div className="card p-4" data-testid="objectifs-travail">
      <div className="mb-2 flex items-center justify-between gap-2">
        <SectionTitle
          className="mb-0"
          info={`${OBJ_MAX_ACTIVE} objectifs en cours au plus, courts et dits en positif (« Gagner en détente »), avec des étapes à cocher (${OBJ_STEPS_MAX} au plus) et, si on veut, un lien vidéo. La case coche l’objectif « atteint » ; la ligne déplie ses étapes. ${g.LeJoueur} les voit sur sa page, coche les étapes et peut ajouter ses propres objectifs (« à ${g.lui} ») ; ceux en cours sont dans le bilan à imprimer.`}
        >
          Objectifs de travail
        </SectionTitle>
        {canEdit &&
          (draft ? (
            <div className="flex items-center gap-1">
              <button className="min-h-10 px-2 text-xs font-bold text-muted" onClick={() => setDraft(null)}>
                Annuler
              </button>
              <button className="min-h-10 px-2 text-xs font-bold text-accent" onClick={finish}>
                Terminé
              </button>
            </div>
          ) : (
            <button
              className="-m-1.5 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg"
              aria-label="Modifier les objectifs de travail"
              title="Modifier les objectifs de travail"
              onClick={() => startEdit()}
            >
              <Icon name="pencil" className="h-4 w-4" />
            </button>
          ))}
      </div>

      {draft ? (
        <div className="flex flex-col gap-3">
          {draft.map((o, i) => (
            <div key={o.id} className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-2.5">
              <div className="flex items-center gap-2">
                <input
                  className="field min-h-11 min-w-0 flex-1"
                  placeholder={i === 0 ? 'Ex. : Gagner en détente' : 'Un autre objectif, en positif'}
                  maxLength={OBJ_TEXT_MAX}
                  value={o.text}
                  aria-label={`Objectif ${i + 1}`}
                  autoFocus={o.isNew}
                  onChange={(e) => patch(o.id, { text: e.target.value })}
                />
                <button
                  className="flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-fg"
                  aria-label="Retirer cet objectif"
                  title="Retirer cet objectif"
                  onClick={() => setDraft((d) => d && d.filter((x) => x.id !== o.id))}
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={o.status === 'atteint'}
                  // Le remettre « en cours » : seulement s'il reste de la place.
                  disabled={o.status === 'atteint' && draftActive >= OBJ_MAX_ACTIVE}
                  className={`min-h-10 rounded-full border px-3 text-xs font-bold ${o.status === 'atteint' ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-500' : 'border-line bg-panel text-muted'}`}
                  onClick={() => patch(o.id, o.status === 'atteint' ? { status: 'en_cours', doneAt: undefined } : { status: 'atteint', doneAt: today() })}
                >
                  {o.status === 'atteint' ? 'Atteint ✓' : 'Marquer atteint'}
                </button>
                <select
                  className="field min-h-10 min-w-0 flex-1 text-xs"
                  aria-label="D’où vient cet objectif"
                  value={o.eventId ?? ''}
                  onChange={(e) => {
                    const ev = events.find((x) => x.id === e.target.value)
                    patch(o.id, ev ? { eventId: ev.id, eventName: ev.name, date: o.date ?? ev.date } : { eventId: undefined, eventName: undefined })
                  }}
                >
                  <option value="">D’où vient-il ? (facultatif)</option>
                  {/* L'événement déjà choisi, même s'il n'est plus dans la liste proposée. */}
                  {o.eventId && !events.some((x) => x.id === o.eventId) && <option value={o.eventId}>{o.eventName ?? 'Événement'}</option>}
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name} · {fmtDate(ev.date)}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  className="field min-h-10 w-40 shrink-0 text-xs"
                  aria-label="Date de l’objectif (facultative)"
                  value={o.date ?? ''}
                  onChange={(e) => patch(o.id, { date: e.target.value || undefined })}
                />
              </div>
              <VideoField value={o.video ?? ''} onChange={(v) => patch(o.id, { video: v || undefined })} label={`Lien vidéo de l’objectif ${i + 1}`} />
              <div className="flex flex-col gap-1">
                <span className="label mb-0">Étapes</span>
                <StepsEditor steps={o.steps} focusId={o.focusStep} onChange={(steps) => patch(o.id, { steps })} />
              </div>
            </div>
          ))}
          {draftActive < OBJ_MAX_ACTIVE ? (
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-ghost min-h-11 w-fit px-3 text-xs" onClick={() => setDraft((d) => d && [...d, { id: newId(), text: '', status: 'en_cours', steps: [], isNew: true }])}>
                <Icon name="plus" className="mr-1 inline h-3.5 w-3.5" />
                Ajouter un objectif
              </button>
              {templates.length > 0 && (
                <button
                  className="btn-ghost min-h-11 w-fit px-3 text-xs"
                  aria-haspopup="menu"
                  aria-expanded={!!menu}
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setMenu({ x: r.left, y: r.bottom, top: r.top })
                  }}
                >
                  <Icon name="list" className="mr-1 inline h-3.5 w-3.5" />
                  Depuis un modèle
                </button>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-muted">
              {OBJ_MAX_ACTIVE} objectifs en cours : pour en ajouter un, marque-en un « atteint » ou retire-le.
            </p>
          )}
          {menu && (
            <ItemMenu
              anchor={menu}
              title="Depuis un modèle"
              subtitle="L’objectif et ses étapes, à adapter ensuite"
              onClose={() => setMenu(null)}
              items={templates.map((t) => ({
                label: t.text,
                hint: t.steps.length ? `${t.steps.length} étape${t.steps.length > 1 ? 's' : ''}` : 'Sans étape',
                icon: 'target',
                onSelect: () => setDraft((d) => d && [...d, toDraft(objectiveFromTemplate(t, newId))]),
              }))}
            />
          )}
        </div>
      ) : views.active.length || views.done.length ? (
        <>
          {!views.active.length && <p className="mb-2 text-xs text-muted">Pas d’objectif en cours.</p>}
          <GoalList
            {...views}
            viewer="staff"
            sex={p.sex}
            opts={{ staffEdit: canEdit }}
            onCheckGoal={checkGoal}
            onCheckStep={checkStep}
            onAddStep={(v) => startEdit({ goal: v.goal.id, step: newId() })}
          />
        </>
      ) : (
        <p className="text-xs text-muted">
          Pas encore d’objectif. Le crayon pour en fixer 1 à {OBJ_MAX_ACTIVE}, avec leurs étapes : {g.leJoueur} les verra sur sa page et pourra cocher les étapes.
        </p>
      )}
    </div>
  )
}

// ---------- Page du jeune ----------

/**
 * « Mes objectifs » : page du jeune. Ceux du staff (lecture, étapes à cocher) et les siens (« à moi »). `canWrite` : son
 * compte, ou l'essai sans serveur (aperçu d'un administrateur avec le serveur : lecture seule).
 */
export function MyObjectives({ player: p, canWrite }: { player: Player; canWrite: boolean }) {
  const staff = objectivesOf(p)
  // undefined : pas encore lu ; null : pas lisible (script 065 pas passé, hors ligne) → lecture seule.
  const [mine, setMine] = useState<MyGoals | null | undefined>(undefined)
  const [form, setForm] = useState<{ goal?: WorkObjective; focusStep?: string } | null>(null)
  // Enregistrements à la suite (l'ordre des coches est gardé) ; en cas de refus, retour au dernier état confirmé.
  const confirmed = useRef<MyGoals>(emptyMyGoals())
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef(0)

  useEffect(() => {
    let live = true
    void fetchPlayerGoals(p.id).then((r) => {
      if (!live) return
      if (r.ok) confirmed.current = r.value
      setMine(r.ok ? r.value : null)
    })
    return () => {
      live = false
    }
  }, [p.id])

  const writable = canWrite && !!mine
  const views = goalViews(staff, mine ?? null)
  const ownActive = mine ? mine.own.filter((o) => o.status === 'en_cours').length : 0
  if (mine === undefined && !staff.length) return null
  if (!views.active.length && !views.done.length && !writable) return null

  function persist(next: MyGoals) {
    setMine(next)
    pending.current++
    chain.current = chain.current.then(async () => {
      const r = await saveMyGoals(p.id, next, staff)
      pending.current--
      if (r.ok) {
        confirmed.current = r.value
        if (!pending.current) setMine(r.value)
      } else {
        setMine(confirmed.current)
        void inform(r.error)
      }
    })
  }

  function checkGoal(v: GoalView) {
    if (!mine || v.owner !== 'moi') return
    const r = setOwnGoalStatus(mine, v.goal.id, v.goal.status === 'atteint' ? 'en_cours' : 'atteint', today())
    if (!r.ok) return void inform(MY_GOAL_ERRORS[r.error])
    persist(r.goals)
  }
  function checkStep(v: GoalView, s: StepView) {
    if (!mine) return
    if (v.owner === 'staff') {
      if (s.checked && s.by === 'staff') return
      persist(setStaffStepCheck(mine, staff, s.id, !s.checked, today()))
    } else persist({ ...mine, own: setStepDone(mine.own, v.goal.id, s.id, !s.checked, today()) })
  }

  return (
    <section className="card flex flex-col gap-2 p-4" data-testid="mes-objectifs">
      <SectionTitle
        info={`Ceux « du staff » sont fixés avec ton encadrant : tu coches leurs étapes, il coche l’objectif quand il est atteint. Ceux « à moi » sont les tiens (${OWN_MAX_ACTIVE} en cours au plus) : tu les écris, tu les coches. Touche un objectif pour voir ses étapes. Ton encadrant voit tout.`}
      >
        Mes objectifs
      </SectionTitle>
      {views.active.length || views.done.length ? (
        <>
          {!views.active.length && <p className="text-xs text-muted">Tous tes objectifs sont atteints : bravo !</p>}
          <GoalList
            {...views}
            viewer="joueur"
            sex={p.sex}
            opts={{ playerWrite: writable }}
            onCheckGoal={checkGoal}
            onCheckStep={checkStep}
            onEdit={(v) => setForm({ goal: v.goal })}
            onAddStep={(v) => setForm({ goal: v.goal, focusStep: newId() })}
          />
        </>
      ) : (
        <p className="text-xs text-muted">Un objectif qui te tient à cœur ? Écris-le, découpe-le en petites étapes et coche-les au fil des semaines.</p>
      )}
      {writable &&
        (ownActive < OWN_MAX_ACTIVE ? (
          <button className="btn-ghost min-h-11 w-fit px-3 text-xs" onClick={() => setForm({})}>
            <Icon name="plus" className="mr-1 inline h-3.5 w-3.5" />
            Ajouter un objectif à moi
          </button>
        ) : (
          <p className="text-[11px] text-muted">{OWN_MAX_ACTIVE} objectifs à toi en cours : coche-en un « atteint » ou retire-le pour en ajouter un.</p>
        ))}
      {form && mine && (
        <OwnGoalForm
          goal={form.goal}
          focusStep={form.focusStep}
          onClose={() => setForm(null)}
          onSave={(input) => {
            const r = form.goal ? editOwnGoal(mine, form.goal.id, input) : addOwnGoal(mine, input, newId(), today())
            if (!r.ok) return MY_GOAL_ERRORS[r.error]
            persist(r.goals)
            setForm(null)
            return null
          }}
          onRemove={
            form.goal
              ? async () => {
                  if (!(await ask('Retirer cet objectif ? Il disparaît de ta page.', { ok: 'Retirer', danger: true, focusCancel: true }))) return
                  persist(removeOwnGoal(mine, form.goal!.id))
                  setForm(null)
                }
              : undefined
          }
        />
      )}
    </section>
  )
}

/** Fenêtre « Mon objectif » : titre, lien vidéo, étapes ; « Retirer » s'il existe déjà. Clavier seulement. */
function OwnGoalForm({
  goal,
  focusStep,
  onSave,
  onRemove,
  onClose,
}: {
  goal?: WorkObjective
  focusStep?: string
  /** Renvoie un message si c'est refusé, sinon null (fenêtre fermée par l'appelant). */
  onSave: (input: OwnGoalInput) => string | null
  onRemove?: () => void
  onClose: () => void
}) {
  const [text, setText] = useState(goal?.text ?? '')
  const [video, setVideo] = useState(goal?.video ?? '')
  const [steps, setSteps] = useState<StepDraft[]>(() => [...toStepDrafts(goal?.steps), ...(focusStep ? [{ id: focusStep, text: '' }] : [])])
  const [err, setErr] = useState('')
  return (
    <FormWindow title={goal ? 'Mon objectif' : 'Nouvel objectif à moi'} onClose={onClose} width={560}>
      <p className="text-[11px] text-muted">Court et dit en positif (« Le tir en suspension », « Gagner en détente »). Ton encadrant le voit. Rien n’est noté.</p>
      <label className="block">
        <span className="label">Mon objectif</span>
        <input
          className="field min-h-11 w-full"
          maxLength={OBJ_TEXT_MAX}
          placeholder="Ex. : Le tir en suspension"
          autoFocus={!focusStep}
          value={text}
          onChange={(e) => (setErr(''), setText(e.target.value))}
        />
      </label>
      <div>
        <span className="label">Une vidéo pour m’inspirer (facultatif)</span>
        <VideoField value={video} onChange={(v) => (setErr(''), setVideo(v))} label="Lien vidéo de mon objectif" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="label mb-0">Mes étapes</span>
        <p className="text-[10px] text-muted">De petites étapes, une case chacune ; un lien vidéo si tu veux (le geste à imiter, l’exercice).</p>
        <StepsEditor steps={steps} focusId={focusStep} onChange={(s) => (setErr(''), setSteps(s))} />
      </div>
      {err && <p className="text-[11px] text-red-500">{err}</p>}
      <FormActions>
        <button
          type="button"
          className="btn-primary min-h-10 px-4 text-xs"
          disabled={!text.trim()}
          onClick={() => {
            const e = onSave({ text, video, steps })
            if (e) setErr(e)
          }}
        >
          Enregistrer
        </button>
        <button type="button" className="btn-ghost min-h-10 px-4 text-xs" onClick={onClose}>
          Annuler
        </button>
        {onRemove && (
          <button type="button" className="btn-ghost min-h-10 px-4 text-xs text-red-500" onClick={onRemove}>
            Retirer
          </button>
        )}
      </FormActions>
    </FormWindow>
  )
}
