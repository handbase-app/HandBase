import type { Glyph, PillLabel } from './seqPills'

/*
 * Actions du volley pour le séquenceur et les moments d'une vidéo (phase 2) : 6 gestes (service, réception, passe,
 * attaque, contre, défense) et 3 résultats (réussi, neutre, à retravailler) : un codage DataVolley simplifié (gestes S R E
 * A B D ; réussi = # +, neutre = !, à retravailler = - / =). Mots positifs ou neutres.
 *
 * Calcul pur, comme pour le handball (src/seqPills.ts, src/actionFilter.ts) :
 *  - une ACTION (PillKind) = un geste et son résultat (« attaque_reussi »), ou le geste seul quand le résultat n'est pas dit
 *    (« attaque ») ; sa pastille (VOLLEY_PILLS) : libellé court, libellé long (« Attaque réussie »), pictogramme du geste ;
 *  - une CATÉGORIE du filtre = un geste (ses trois résultats regroupés, comme « 7 M » regroupe but, tir et arrêt sur 7 m) :
 *    pastilles SERVICE, RÉCEPTION, PASSE, ATTAQUE, CONTRE, DÉFENSE (VOLLEY_CAT_SPECS, src/actionFilter.ts) ;
 *  - le volley n'a pas de feuille de match importée : les actions sont les MOMENTS d'une vidéo, notés « Attaque réussie »,
 *    « Réception neutre · n° 7 », « Défense à retravailler » (volleyNote) ; volleyMomentKind relit le geste et le résultat
 *    au début de la note (sans accents ni majuscules ; « bloc » = contre). Une autre note : « autre ».
 * Choisi par le sport de l'installation (PILLS_BY_SPORT dans src/seqPills.ts, catégories dans src/actionFilter.ts).
 */

export type VolleySkill = 'service' | 'reception' | 'passe' | 'attaque' | 'contre' | 'defense'
export type VolleyOutcome = 'reussi' | 'neutre' | 'retravailler'
/** Action : un geste et son résultat, ou le geste seul (résultat non dit). */
export type VolleyActionKind = VolleySkill | `${VolleySkill}_${VolleyOutcome}`

export interface VolleySkillDef {
  id: VolleySkill
  /** « Attaque » (note d'un moment, libellé long). */
  label: string
  /** Pastille du filtre (« ATTAQUE »). */
  short: string
  /** Pastille d'une action, plus courte (place pour la marque du résultat) : « RÉCEP. ». */
  pill: string
  /** Compteur du filtre : « 3/12 attaques ». */
  plural: string
  /** Code DataVolley du geste (export futur). */
  code: string
  glyph: Glyph
  /** Accord du résultat : « réussie » (féminin) ou « réussi ». */
  fem: boolean
}

export const VOLLEY_SKILLS: readonly VolleySkillDef[] = [
  { id: 'service', label: 'Service', short: 'SERVICE', pill: 'SERVICE', plural: 'services', code: 'S', glyph: 'ball', fem: false },
  { id: 'reception', label: 'Réception', short: 'RÉCEPTION', pill: 'RÉCEP.', plural: 'réceptions', code: 'R', glyph: 'platform', fem: true },
  { id: 'passe', label: 'Passe', short: 'PASSE', pill: 'PASSE', plural: 'passes', code: 'E', glyph: 'pass', fem: true },
  { id: 'attaque', label: 'Attaque', short: 'ATTAQUE', pill: 'ATTAQUE', plural: 'attaques', code: 'A', glyph: 'shot', fem: true },
  { id: 'contre', label: 'Contre', short: 'CONTRE', pill: 'CONTRE', plural: 'contres', code: 'B', glyph: 'block', fem: false },
  { id: 'defense', label: 'Défense', short: 'DÉFENSE', pill: 'DÉFENSE', plural: 'défenses', code: 'D', glyph: 'save', fem: true },
]

export interface VolleyOutcomeDef {
  id: VolleyOutcome
  /** Mot du résultat, accordé au geste (« réussie », « neutre », « à retravailler »). */
  word: (fem: boolean) => string
  /** Marque sur la pastille d'une action (« ATTAQUE + », « DÉFENSE ↻ ») ; neutre : aucune. */
  mark: string
  /** Équivalence DataVolley (export futur). */
  dataVolley: string
}

export const VOLLEY_OUTCOMES: readonly VolleyOutcomeDef[] = [
  { id: 'reussi', word: (fem) => (fem ? 'réussie' : 'réussi'), mark: ' +', dataVolley: '# +' },
  { id: 'neutre', word: () => 'neutre', mark: '', dataVolley: '!' },
  { id: 'retravailler', word: () => 'à retravailler', mark: ' ↻', dataVolley: '- / =' },
]

const skillOf = (id: VolleySkill) => VOLLEY_SKILLS.find((s) => s.id === id)!

/** Identifiant de l'action : « attaque_reussi » ; sans résultat : « attaque ». */
export const volleyKind = (skill: VolleySkill, outcome?: VolleyOutcome): VolleyActionKind => (outcome ? `${skill}_${outcome}` : skill)

/** Note d'un moment de vidéo pour cette action : « Attaque réussie », « Contre neutre », « Défense à retravailler ». */
export function volleyNote(skill: VolleySkill, outcome?: VolleyOutcome): string {
  const s = skillOf(skill)
  const o = VOLLEY_OUTCOMES.find((x) => x.id === outcome)
  return o ? `${s.label} ${o.word(s.fem)}` : s.label
}

/** Toutes les actions du volley : chaque geste seul, puis avec chacun de ses résultats. */
export const VOLLEY_KINDS: readonly VolleyActionKind[] = VOLLEY_SKILLS.flatMap((s) => [volleyKind(s.id), ...VOLLEY_OUTCOMES.map((o) => volleyKind(s.id, o.id))])

/**
 * Pastilles des actions du volley, par identifiant d'action : libellé court (« ATTAQUE + »), long (« Attaque réussie »)
 * et pictogramme du geste. Lu par pillLabel (src/seqPills.ts) quand le sport de l'installation est le volley.
 */
export const VOLLEY_PILLS: Partial<Record<string, PillLabel>> = Object.fromEntries(
  VOLLEY_SKILLS.flatMap((s) => [
    [volleyKind(s.id), { short: s.pill, long: s.label, glyph: s.glyph }],
    ...VOLLEY_OUTCOMES.map((o) => [volleyKind(s.id, o.id), { short: `${s.pill}${o.mark}`, long: volleyNote(s.id, o.id), glyph: s.glyph }]),
  ]),
)

/**
 * Catégories du filtre par type d'action (src/actionFilter.ts) : un geste, ses actions (avec ou sans résultat), le
 * compteur (« attaques ») et la pastille (« ATTAQUE », pictogramme du geste, « Attaques » dans l'aide).
 */
export const VOLLEY_CAT_SPECS: { id: VolleySkill; kinds: VolleyActionKind[]; plural: string; label: PillLabel }[] = VOLLEY_SKILLS.map((s) => ({
  id: s.id,
  kinds: [volleyKind(s.id), ...VOLLEY_OUTCOMES.map((o) => volleyKind(s.id, o.id))],
  plural: s.plural,
  label: { short: s.short, long: s.plural[0].toUpperCase() + s.plural.slice(1), glyph: s.glyph },
}))

// ---------- Lecture d'une note de moment ----------

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** Geste en tête de note (« bloc » : le contre). */
const SKILL_RE: [RegExp, VolleySkill][] = [
  [/^services?\b/, 'service'],
  [/^receptions?\b/, 'reception'],
  [/^passes?\b/, 'passe'],
  [/^attaques?\b/, 'attaque'],
  [/^(?:contres?|blocs?)\b/, 'contre'],
  [/^defenses?\b/, 'defense'],
]
/** Résultat, dans la première partie de la note (avant « · ») : « Service flottant réussi », « Attaque zone 4 neutre ». */
const OUTCOME_RE: [RegExp, VolleyOutcome][] = [
  [/\breussi(?:e|s|es)?\b/, 'reussi'],
  [/\bneutres?\b/, 'neutre'],
  [/\ba (?:re)?travailler\b/, 'retravailler'],
]

/**
 * Action d'un moment de vidéo d'après sa note : geste en tête (« Attaque réussie · n° 7 », « Bloc neutre »), résultat
 * cherché dans la même partie de la note ; sans résultat dit, le geste seul. Note d'une autre forme : « autre ».
 */
export function volleyMomentKind(note: string | undefined): VolleyActionKind | 'autre' {
  const n = fold(note ?? '')
    .replace(/[’']/g, ' ')
    .trim()
  const skill = SKILL_RE.find(([re]) => re.test(n))?.[1]
  if (!skill) return 'autre'
  const head = n.split(/[·|•]/)[0]
  const outcome = OUTCOME_RE.find(([re]) => re.test(head))?.[1]
  return volleyKind(skill, outcome)
}
