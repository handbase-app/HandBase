import {
  activeObjectives,
  cleanObjectiveText,
  cleanShortText,
  cleanVideoUrl,
  DAY,
  doneObjectives,
  OBJ_KEEP,
  OBJ_STEP_TEXT_MAX,
  OBJ_STEPS_MAX,
  stepsOf,
  staffStepIds,
  type ObjectiveStatus,
  type ObjectiveStep,
  type StepProgress,
  type WorkObjective,
} from './objectives'
import { cleanPeriod, PERIOD_ERROR, periodBad } from './period'

/*
 * « Mes objectifs », côté du jeune (04/11, liste à cocher avec des étapes ; supabase/065_objectifs_etapes.sql) :
 *  - ses PROPRES objectifs (« à moi ») : 5 en cours au plus, avec leurs étapes, leurs liens vidéo et, si on veut, une
 *    période (début repoussé `from`, fin `due` : src/period.ts, mêmes règles que le staff), qu'il ajoute, modifie, retire et
 *    coche lui-même ;
 *  - ses COCHES sur les étapes des objectifs du staff (rangés dans la fiche, src/objectives.ts) : { identifiant d'étape →
 *    jour où il l'a cochée }. Il ne touche jamais au texte du staff, ni à l'état « atteint » d'un objectif du staff (le
 *    staff le coche : choix par défaut du 04/11).
 * Rangé à part de la fiche (une ligne par jeune, hb_player_goals), écrit seulement par sa fonction (hb_player_goals_save) ;
 * lu par lui et par le staff qui lit sa fiche. Mode essai et fiches de démonstration : sur l'appareil (src/myGoalsApi.ts).
 * Ce que le jeune écrit ici ne part jamais vers une IA (clavier seulement).
 *
 * Ce fichier assemble aussi la VUE commune (fiche du staff, page du jeune, bilan à imprimer) : objectifs du staff puis les
 * siens, l'avancement « 1 étape sur 3 », et les droits (qui coche quoi, qui modifie quoi).
 * Fichier pur (ni Dexie ni React) : testé par tools/test-objectifs-etapes.ts.
 */

/** Ses objectifs en cours, au plus. */
export const OWN_MAX_ACTIVE = 5
/** Coches gardées, au plus (étapes du staff). */
export const CHECKS_MAX = 200

export interface MyGoals {
  /** Ses objectifs (« à moi ») : même forme que ceux du staff, sans événement d'origine (il ne lit pas les événements). */
  own: WorkObjective[]
  /** Étapes du staff qu'il a cochées : identifiant → jour (AAAA-MM-JJ). */
  checks: Record<string, string>
  /** Dernier enregistrement (ISO), s'il y en a eu un. */
  at?: string
}

export const emptyMyGoals = (): MyGoals => ({ own: [], checks: {} })

const ID = /^[A-Za-z0-9_-]{1,40}$/

/** Un de ses objectifs, nettoyé (même règle que le serveur, hb_go_clean_own) ; forme inconnue : null. */
function cleanOwn(raw: unknown): WorkObjective | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Record<string, unknown>
  const text = cleanObjectiveText(x.text)
  if (typeof x.id !== 'string' || !ID.test(x.id) || !text) return null
  const status: ObjectiveStatus = x.status === 'atteint' ? 'atteint' : 'en_cours'
  const video = cleanVideoUrl(x.video)
  const steps = stepsOf(x.steps)
  return {
    id: x.id,
    text,
    status,
    ...(typeof x.date === 'string' && DAY.test(x.date) ? { date: x.date } : {}),
    ...(status === 'atteint' && typeof x.doneAt === 'string' && DAY.test(x.doneAt) ? { doneAt: x.doneAt } : {}),
    ...(video ? { video } : {}),
    ...(steps.length ? { steps } : {}),
    ...cleanPeriod(x),
  }
}

/**
 * Ce qu'on lit (serveur, appareil) ou ce qu'on va écrire : formes nettoyées, identifiants en double écartés, 12 gardés au
 * plus, coches valables seulement (identifiant, jour). Ne dépasse jamais 5 en cours : au-delà, les suivants sont écartés
 * (forme abîmée ; l'écran, lui, refuse d'en ajouter un sixième).
 */
export function cleanMyGoals(raw: unknown): MyGoals {
  const x = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const own: WorkObjective[] = []
  const seen = new Set<string>()
  let active = 0
  for (const r of Array.isArray(x.own) ? x.own : []) {
    if (own.length >= OBJ_KEEP) break
    const o = cleanOwn(r)
    if (!o || seen.has(o.id)) continue
    if (o.status === 'en_cours') {
      if (active >= OWN_MAX_ACTIVE) continue
      active++
    }
    seen.add(o.id)
    own.push(o)
  }
  const checks: Record<string, string> = {}
  const c = x.checks && typeof x.checks === 'object' && !Array.isArray(x.checks) ? (x.checks as Record<string, unknown>) : {}
  for (const [k, v] of Object.entries(c)) {
    if (Object.keys(checks).length >= CHECKS_MAX) break
    if (ID.test(k) && typeof v === 'string' && DAY.test(v)) checks[k] = v
  }
  return { own, checks, ...(typeof x.at === 'string' && x.at ? { at: x.at } : {}) }
}

/** Ligne du serveur (hb_player_goals : own, checks, updated_at) → ce que l'appli garde. */
export const myGoalsFromRow = (r: Record<string, unknown> | null | undefined): MyGoals =>
  r ? cleanMyGoals({ own: r.own, checks: r.checks, at: r.updated_at ?? r.at }) : emptyMyGoals()

/** Ses objectifs gardés : tous ceux en cours, puis les atteints les plus récents (12 en tout). */
function trimOwn(list: WorkObjective[]): WorkObjective[] {
  if (list.length <= OBJ_KEEP) return list
  const keep = new Set(doneObjectives(list).slice(0, Math.max(0, OBJ_KEEP - activeObjectives(list).length)).map((o) => o.id))
  return list.filter((o) => o.status === 'en_cours' || keep.has(o.id))
}

// ---------- Ce que le jeune fait ----------

export type MyGoalError = 'vide' | 'max' | 'lien' | 'etapes' | 'periode'
export type MyGoalResult = { ok: true; goals: MyGoals } | { ok: false; error: MyGoalError }

export const MY_GOAL_ERRORS: Record<MyGoalError, string> = {
  vide: 'Écris ton objectif en quelques mots.',
  max: `${OWN_MAX_ACTIVE} objectifs à toi en cours au plus : coche-en un « atteint » ou retire-le d’abord.`,
  lien: 'Ce lien n’est pas une adresse web (il doit commencer par http:// ou https://).',
  etapes: `${OBJ_STEPS_MAX} étapes au plus par objectif.`,
  periode: PERIOD_ERROR,
}

/** Ce qu'on tape dans la fenêtre « Mon objectif » : un titre, un lien, des étapes (texte, lien, cochée ou pas), la période. */
export interface OwnGoalInput {
  text: string
  video?: string
  steps: { id: string; text: string; video?: string; done?: string }[]
  /** Début repoussé et fin (AAAA-MM-JJ), facultatifs (src/period.ts). */
  from?: string
  due?: string
}

type Checked = { ok: true; text: string; video?: string; steps: ObjectiveStep[]; period: { from?: string; due?: string } }

/** Contrôle d'une saisie (titre, liens, nombre d'étapes, fin après le début) ; étapes vides retirées. `date` : jour où il a été fixé. */
function checkInput(input: OwnGoalInput, date?: string): Checked | { ok: false; error: MyGoalError } {
  const text = cleanObjectiveText(input.text)
  if (!text) return { ok: false, error: 'vide' }
  const bad = (v?: string) => !!v?.trim() && !cleanVideoUrl(v)
  if (bad(input.video) || input.steps.some((s) => cleanShortText(s.text, OBJ_STEP_TEXT_MAX) && bad(s.video))) return { ok: false, error: 'lien' }
  const filled = input.steps.filter((s) => cleanShortText(s.text, OBJ_STEP_TEXT_MAX))
  if (filled.length > OBJ_STEPS_MAX) return { ok: false, error: 'etapes' }
  const period = cleanPeriod(input)
  if (periodBad({ ...period, date })) return { ok: false, error: 'periode' }
  return { ok: true, text, ...(cleanVideoUrl(input.video) ? { video: cleanVideoUrl(input.video) } : {}), steps: stepsOf(filled), period }
}

/** Nouvel objectif à lui, « en cours » (à la fin). */
export function addOwnGoal(g: MyGoals, input: OwnGoalInput, id: string, day: string): MyGoalResult {
  const c = checkInput(input, day)
  if (!c.ok) return c
  if (activeObjectives(g.own).length >= OWN_MAX_ACTIVE) return { ok: false, error: 'max' }
  const o: WorkObjective = { id, text: c.text, status: 'en_cours', date: day, ...(c.video ? { video: c.video } : {}), ...(c.steps.length ? { steps: c.steps } : {}), ...c.period }
  return { ok: true, goals: { ...g, own: trimOwn([...g.own, o]) } }
}

/** Un de ses objectifs modifié (titre, lien, étapes, période) ; son état ne change pas ici. */
export function editOwnGoal(g: MyGoals, id: string, input: OwnGoalInput): MyGoalResult {
  const c = checkInput(input, g.own.find((o) => o.id === id)?.date)
  if (!c.ok) return c
  return {
    ok: true,
    goals: {
      ...g,
      own: g.own.map((o) => {
        if (o.id !== id) return o
        const { video: _v, steps: _s, from: _f, due: _d, ...rest } = o
        return { ...rest, text: c.text, ...(c.video ? { video: c.video } : {}), ...(c.steps.length ? { steps: c.steps } : {}), ...c.period }
      }),
    },
  }
}

/** Un de ses objectifs retiré (il ne lui sert plus) : sans trace. */
export const removeOwnGoal = (g: MyGoals, id: string): MyGoals => ({ ...g, own: g.own.filter((o) => o.id !== id) })

/** Un de ses objectifs coché « atteint » (date du jour) ou de nouveau « en cours » (si la place le permet). */
export function setOwnGoalStatus(g: MyGoals, id: string, status: ObjectiveStatus, day: string): MyGoalResult {
  const o = g.own.find((x) => x.id === id)
  if (!o || o.status === status) return { ok: true, goals: g }
  if (status === 'en_cours' && activeObjectives(g.own).length >= OWN_MAX_ACTIVE) return { ok: false, error: 'max' }
  return {
    ok: true,
    goals: {
      ...g,
      own: g.own.map((x) => {
        if (x.id !== id) return x
        if (status === 'atteint') return { ...x, status, doneAt: day }
        const { doneAt: _d, ...rest } = x
        return { ...rest, status }
      }),
    },
  }
}

/**
 * Étape du staff cochée ou décochée par le jeune. Seulement une étape qui existe sur sa fiche (jamais un objectif du staff :
 * son « atteint » reste au staff) ; une étape déjà cochée garde son jour.
 */
export function setStaffStepCheck(g: MyGoals, staff: readonly WorkObjective[], stepId: string, on: boolean, day: string): MyGoals {
  if (!staffStepIds(staff).has(stepId)) return g
  const checks = { ...g.checks }
  if (on) checks[stepId] = checks[stepId] ?? day
  else delete checks[stepId]
  return { ...g, checks }
}

/** Coches gardées à l'enregistrement : seulement celles d'étapes encore sur la fiche (même règle que le serveur). */
export const pruneChecks = (g: MyGoals, staff: readonly WorkObjective[]): MyGoals => {
  const ids = staffStepIds(staff)
  return { ...g, checks: Object.fromEntries(Object.entries(g.checks).filter(([k]) => ids.has(k))) }
}

// ---------- Vue commune ----------

export type GoalOwner = 'staff' | 'moi'
export type Viewer = 'staff' | 'joueur'

export interface StepView extends ObjectiveStep {
  /** Cochée (par le staff ou par le jeune). */
  checked: boolean
  /** Qui l'a cochée. */
  by?: 'staff' | 'joueur'
  /** Le jour. */
  at?: string
}

export interface GoalView {
  owner: GoalOwner
  goal: WorkObjective
  steps: StepView[]
  progress: StepProgress
}

/** Étapes d'un objectif, avec leur coche : celle du staff (dans la fiche) d'abord, sinon celle du jeune. */
function stepViews(o: WorkObjective, owner: GoalOwner, checks: Record<string, string>): StepView[] {
  return (o.steps ?? []).map((s) => {
    if (s.done) return { ...s, checked: true, by: owner === 'staff' ? 'staff' : 'joueur', at: s.done }
    const c = owner === 'staff' ? checks[s.id] : undefined
    return c ? { ...s, checked: true, by: 'joueur', at: c } : { ...s, checked: false }
  })
}

const view = (o: WorkObjective, owner: GoalOwner, checks: Record<string, string>): GoalView => {
  const steps = stepViews(o, owner, checks)
  return { owner, goal: o, steps, progress: { done: steps.filter((s) => s.checked).length, total: steps.length } }
}

/**
 * Les objectifs d'un jeune, tels qu'on les montre : en cours (ceux du staff, puis les siens, dans l'ordre où ils ont été
 * posés), et atteints (le plus récent en premier). `mine` : null quand ses objectifs ne sont pas lisibles (script 065 pas
 * passé, hors ligne) : ceux du staff seulement, avec les coches du staff.
 */
export function goalViews(staff: readonly WorkObjective[], mine: MyGoals | null): { active: GoalView[]; done: GoalView[] } {
  const checks = mine?.checks ?? {}
  const own = mine?.own ?? []
  return {
    active: [...activeObjectives(staff).map((o) => view(o, 'staff', checks)), ...activeObjectives(own).map((o) => view(o, 'moi', checks))],
    done: [...doneObjectives(staff).map((o) => view(o, 'staff', checks)), ...doneObjectives(own).map((o) => view(o, 'moi', checks))].sort((a, b) =>
      (b.goal.doneAt ?? '').localeCompare(a.goal.doneAt ?? ''),
    ),
  }
}

/**
 * Droits, par personne qui regarde :
 *  - le staff (qui peut modifier la fiche : `staffEdit`) coche et modifie les objectifs du staff et leurs étapes ; il lit
 *    ceux du jeune sans y toucher ; une étape cochée par le jeune reste à lui (le staff la voit cochée « par lui »).
 *  - le jeune (sa page, quand il peut écrire : `playerWrite`) coche et modifie les siens ; coche les étapes du staff (pas
 *    celles que le staff a déjà cochées) ; ne modifie jamais un objectif du staff ni ne le coche « atteint ».
 */
export interface GoalRights {
  /** Cocher l'objectif lui-même (« atteint »). */
  check: boolean
  /** Modifier son texte, son lien, ses étapes ; le retirer. */
  edit: boolean
}

export function goalRights(viewer: Viewer, owner: GoalOwner, opts: { staffEdit?: boolean; playerWrite?: boolean }): GoalRights {
  if (viewer === 'staff') {
    const ok = owner === 'staff' && !!opts.staffEdit
    return { check: ok, edit: ok }
  }
  const ok = owner === 'moi' && !!opts.playerWrite
  return { check: ok, edit: ok }
}

/** Peut-on cocher ou décocher cette étape ? */
export function stepCheckable(viewer: Viewer, owner: GoalOwner, s: Pick<StepView, 'checked' | 'by'>, opts: { staffEdit?: boolean; playerWrite?: boolean }): boolean {
  if (viewer === 'staff') return owner === 'staff' && !!opts.staffEdit && !(s.checked && s.by === 'joueur')
  if (!opts.playerWrite) return false
  return owner === 'moi' || !(s.checked && s.by === 'staff')
}
