/*
 * Sélections (comité, ligue, équipe de France) : partie PURE (ni Dexie ni React), testée par tools/test-selections.ts.
 * Plan décidé avec Geoffroy et Stef le 23/11 (~/Documents/HandBase_a_faire.md, « Groupes permanents de sélection + stages ») :
 * même mécanisme que le Pôle (src/poleSeason.ts).
 *
 * Modèle :
 *  - la FICHE porte des périodes datées (Player.selections) : niveau (comite / ligue / france), unité de la structure pour un
 *    comité ou une ligue, catégorie pour la France (U17 / U19 / U21), sexe, entrée, sortie, motif de sortie. Pas de statut ni
 *    de réservistes (Stef, 23/11) : être dans le groupe, c'est être sélectionné. Motifs NEUTRES seulement (fin de saison,
 *    catégorie au-dessus, blessure, autre), jamais « non retenu » ;
 *  - un groupe de sélection (PlayerGroup.selection) est PERMANENT (ni archivé ni dupliqué, un seul par comité / ligue et par
 *    sexe, 6 pour la France) ; ses membres ne sont pas dans playerIds : ils sont CALCULÉS depuis les périodes des fiches qui
 *    correspondent au groupe et couvrent la date de la vue (aujourd'hui), ou qui recoupent une saison passée ;
 *  - ajouter un joueur au groupe ouvre une période à la date du jour ; le retirer la ferme avec un motif ; rien ne s'efface.
 * Identifiant du groupe fixe (selectionGroupId) : deux administrateurs qui créent les groupes manquants écrivent les mêmes
 * lignes (supabase/079_selections.sql et tools/seed-hand.ts font le même calcul).
 */
import { seasonOf } from './coverage'
import { accord } from './gender'
import type { LevelRow, UnitRow } from './structureTree'

// ---------- Types ----------

export type SelectionLevel = 'comite' | 'ligue' | 'france'
export const SELECTION_LEVELS: readonly SelectionLevel[] = ['comite', 'ligue', 'france']
export type SelectionCategory = 'U17' | 'U19' | 'U21'
export const SELECTION_CATEGORIES: readonly SelectionCategory[] = ['U17', 'U19', 'U21']
export type SelectionExit = 'fin_saison' | 'categorie_superieure' | 'blessure' | 'autre'
/** Motifs de sortie : neutres, jamais d'étiquette négative. */
export const SELECTION_EXITS: { value: SelectionExit; label: string }[] = [
  { value: 'fin_saison', label: 'Fin de saison' },
  { value: 'categorie_superieure', label: 'Catégorie au-dessus' },
  { value: 'blessure', label: 'Blessure' },
  { value: 'autre', label: 'Autre' },
]
export const selectionExitLabel = (x?: string) => SELECTION_EXITS.find((e) => e.value === x)?.label

/** Une période de sélection sur la fiche (Player.selections). */
export interface SelectionPeriod {
  level: SelectionLevel
  /** Comité ou ligue : l'unité de la structure (hb_units). Absent pour la France. */
  unitId?: string
  /** Nom de l'unité au moment de la saisie (affichage si l'unité n'est pas sur l'appareil). */
  unitName?: string
  /** Équipe de France : la catégorie. */
  category?: SelectionCategory
  /** Sexe du groupe (masculin / féminin) ; absent : celui de la fiche. */
  sex?: 'M' | 'F'
  from?: string
  to?: string
  exitReason?: SelectionExit
}

/** Ce qui désigne un groupe de sélection (PlayerGroup.selection). */
export interface SelectionRef {
  level: SelectionLevel
  unitId?: string
  category?: SelectionCategory
  sex: 'M' | 'F'
}

type SelPlayer = { selections?: readonly SelectionPeriod[]; sex?: string | null }

// ---------- Libellés ----------

const sexWord = (s: 'M' | 'F') => (s === 'F' ? 'féminin' : 'masculin')

/**
 * Département précédé de son article (« du Var », « de l'Ain », « des Bouches-du-Rhône »), par numéro : noms des comités
 * (« Comité du Var masculin »). Même table dans supabase/079_selections.sql (tools/test-selections.ts vérifie qu'elles sont
 * identiques). Géographie publique seulement.
 */
const DEPT_DE_TABLE =
  "01|de l'Ain;02|de l'Aisne;03|de l'Allier;04|des Alpes-de-Haute-Provence;05|des Hautes-Alpes;" +
  "06|des Alpes-Maritimes;07|de l'Ardèche;08|des Ardennes;09|de l'Ariège;10|de l'Aube;11|de l'Aude;" +
  "12|de l'Aveyron;13|des Bouches-du-Rhône;14|du Calvados;15|du Cantal;16|de la Charente;" +
  "17|de la Charente-Maritime;18|du Cher;19|de la Corrèze;2A|de la Corse-du-Sud;2B|de la Haute-Corse;" +
  "21|de la Côte-d'Or;22|des Côtes-d'Armor;23|de la Creuse;24|de la Dordogne;25|du Doubs;26|de la Drôme;" +
  "27|de l'Eure;28|d'Eure-et-Loir;29|du Finistère;30|du Gard;31|de la Haute-Garonne;32|du Gers;33|de la Gironde;" +
  "34|de l'Hérault;35|d'Ille-et-Vilaine;36|de l'Indre;37|d'Indre-et-Loire;38|de l'Isère;39|du Jura;40|des Landes;" +
  "41|de Loir-et-Cher;42|de la Loire;43|de la Haute-Loire;44|de Loire-Atlantique;45|du Loiret;46|du Lot;" +
  "47|de Lot-et-Garonne;48|de la Lozère;49|de Maine-et-Loire;50|de la Manche;51|de la Marne;52|de la Haute-Marne;" +
  "53|de la Mayenne;54|de Meurthe-et-Moselle;55|de la Meuse;56|du Morbihan;57|de la Moselle;58|de la Nièvre;" +
  "59|du Nord;60|de l'Oise;61|de l'Orne;62|du Pas-de-Calais;63|du Puy-de-Dôme;64|des Pyrénées-Atlantiques;" +
  "65|des Hautes-Pyrénées;66|des Pyrénées-Orientales;67|du Bas-Rhin;68|du Haut-Rhin;69|du Rhône;" +
  "70|de la Haute-Saône;71|de Saône-et-Loire;72|de la Sarthe;73|de la Savoie;74|de la Haute-Savoie;75|de Paris;" +
  "76|de la Seine-Maritime;77|de Seine-et-Marne;78|des Yvelines;79|des Deux-Sèvres;80|de la Somme;81|du Tarn;" +
  "82|de Tarn-et-Garonne;83|du Var;84|de Vaucluse;85|de la Vendée;86|de la Vienne;87|de la Haute-Vienne;" +
  "88|des Vosges;89|de l'Yonne;90|du Territoire de Belfort;91|de l'Essonne;92|des Hauts-de-Seine;" +
  "93|de la Seine-Saint-Denis;94|du Val-de-Marne;95|du Val-d'Oise;971|de la Guadeloupe;972|de la Martinique;" +
  "973|de la Guyane;974|de La Réunion;976|de Mayotte;988|de Nouvelle-Calédonie;"
export const DEPT_DE: ReadonlyMap<string, string> = new Map(
  DEPT_DE_TABLE.split(';')
    .filter(Boolean)
    .map((x) => x.split('|') as [string, string]),
)

/**
 * Nom du comité : « Comité du Var (83) » → « Comité du Var » ; unité nommée d'après son seul département (« Var », 83) →
 * « Comité du Var » ; sinon « Comité » + le nom.
 */
export function comiteName(unitName: string, departments?: readonly string[]): string {
  const n = unitName.replace(/\s*\(\s*[0-9AB]+\s*\)\s*$/i, '').trim()
  if (/^comit[ée]s?(?=\s|$)/i.test(n)) return n.replace(/^comit[ée]s?/i, 'Comité')
  const de = departments?.length === 1 ? DEPT_DE.get(departments[0]) : undefined
  return de ? `Comité ${de}` : `Comité ${n}`
}

/** Unité vue par les libellés : son nom (et ses départements, pour l'article du comité) ; ou le seul nom gardé sur la période. */
export type UnitLabel = string | { name: string; departments?: readonly string[] }
const unitNameOf = (u?: UnitLabel) => (typeof u === 'string' ? u : u?.name)
const unitDepts = (u?: UnitLabel) => (typeof u === 'string' ? undefined : u?.departments)

/** « Ligue Auvergne-Rhône-Alpes de handball » → « Ligue Auvergne-Rhône-Alpes » ; « Occitanie » → « Ligue Occitanie ». */
export function ligueName(unitName: string): string {
  const n = unitName.replace(/\s+de\s+(hand(?:ball)?|volley(?:[- ]?ball)?)\s*$/i, '').trim()
  return /^ligues?(?=\s|$)/i.test(n) ? n.replace(/^ligues?/i, 'Ligue') : `Ligue ${n}`
}

/** Nom du collectif sans le sexe : « Comité du Var », « Ligue Occitanie », « Équipe de France U17 ». */
export function selectionBaseName(x: Pick<SelectionPeriod, 'level' | 'category' | 'unitName'>, unit: UnitLabel | undefined = x.unitName): string {
  if (x.level === 'france') return `Équipe de France${x.category ? ` ${x.category}` : ''}`
  const name = unitNameOf(unit)
  if (!name) return x.level === 'comite' ? 'Sélection du comité' : 'Sélection de la ligue'
  return x.level === 'comite' ? comiteName(name, unitDepts(unit)) : ligueName(name)
}

/** Nom du groupe : « Comité du Var masculin », « Ligue Occitanie féminin », « Équipe de France U19 masculin ». */
export const selectionGroupName = (ref: SelectionRef, unit?: UnitLabel) => `${selectionBaseName(ref, unit)} ${sexWord(ref.sex)}`

/** Identifiant fixe du groupe : « sel-comite-<unité>-m », « sel-france-u17-f ». */
export const selectionGroupId = (ref: SelectionRef) => `sel-${ref.level}-${(ref.level === 'france' ? ref.category ?? '' : ref.unitId ?? '').toLowerCase()}-${ref.sex.toLowerCase()}`

/** Ligne d'information d'un groupe de sélection (liste des groupes, en-tête) : le nom dit déjà la catégorie et le sexe. */
export const SELECTION_KIND: Record<SelectionLevel, string> = { comite: 'Sélection départementale', ligue: 'Sélection régionale', france: 'Sélection nationale' }

/** Portée de groupe (PlayerGroup.scope) d'un niveau : la France compte comme un groupe « Fédération » (src/levels.ts). */
export const SCOPE_OF: Record<SelectionLevel, 'federation' | 'ligue' | 'comite'> = { france: 'federation', ligue: 'ligue', comite: 'comite' }
export const LEVEL_OF_SCOPE: Record<string, SelectionLevel> = { federation: 'france', ligue: 'ligue', comite: 'comite' }

// ---------- Périodes ----------

const DAY = /^\d{4}-\d{2}-\d{2}$/
const isDay = (s: string | undefined): s is string => !!s && DAY.test(s)

/** Période renseignée (au moins une date, une unité ou une catégorie). */
export const filledSelection = (x: SelectionPeriod) => !!(x && x.level && (x.from || x.to || x.unitId || x.category || x.unitName))

/** Période en cours à cette date. */
export const selectionCurrentAt = (x: SelectionPeriod, day: string) => filledSelection(x) && (!x.from || x.from <= day) && (!x.to || x.to >= day)

/** Période qui recoupe [from, to] (bornes comprises). */
export const selectionOverlaps = (x: SelectionPeriod, from: string, to: string) => filledSelection(x) && (!x.from || x.from <= to) && (!x.to || x.to >= from)

/** La période est-elle celle de ce groupe ? Même niveau, même unité (ou même catégorie pour la France), même sexe. */
export function selectionMatches(x: SelectionPeriod, ref: SelectionRef, playerSex?: string | null): boolean {
  if (!filledSelection(x) || x.level !== ref.level) return false
  if (ref.level === 'france' ? x.category !== ref.category : x.unitId !== ref.unitId) return false
  const sex = x.sex ?? (playerSex === 'M' || playerSex === 'F' ? playerSex : undefined)
  return !sex || sex === ref.sex
}

/** Indice de la période de ce groupe en cours à cette date (−1 : aucune). */
export function selectionIndexAt(p: SelPlayer, ref: SelectionRef, day: string): number {
  return (p.selections ?? []).findIndex((x) => selectionMatches(x, ref, p.sex) && selectionCurrentAt(x, day))
}

export const isSelectedAt = (p: SelPlayer, ref: SelectionRef, day: string) => selectionIndexAt(p, ref, day) >= 0

/** Membres d'un groupe à une date (ordre de `players` conservé). */
export function selectionMembersAt<P extends SelPlayer>(players: readonly P[], ref: SelectionRef, day: string): P[] {
  return players.filter((p) => isSelectedAt(p, ref, day))
}

/** Membres d'un groupe sur une période (saison passée : tous ceux qui y ont été, même quelques jours). */
export function selectionMembersIn<P extends SelPlayer>(players: readonly P[], ref: SelectionRef, from: string, to: string): P[] {
  return players.filter((p) => (p.selections ?? []).some((x) => selectionMatches(x, ref, p.sex) && selectionOverlaps(x, from, to)))
}

/** Périodes d'un joueur dans ce groupe qui recoupent [from, to], de la plus ancienne à la plus récente. */
export function periodsIn(p: SelPlayer, ref: SelectionRef, from: string, to: string): SelectionPeriod[] {
  return (p.selections ?? []).filter((x) => selectionMatches(x, ref, p.sex) && selectionOverlaps(x, from, to)).sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''))
}

// ---------- Vues par saison ----------

/** Vue d'un groupe de sélection : « courante » (membres aujourd'hui) ou une saison passée (« 2024-2025 »). */
export type SelectionView = 'courante' | `${number}-${number}`
export const SELECTION_VIEW_KEY = 'saison'

/** Vue lue dans l'adresse (?saison=2024-2025) ; inconnue : la saison en cours. */
export function selectionViewOf(search: string): SelectionView {
  const v = new URLSearchParams(search).get(SELECTION_VIEW_KEY) ?? ''
  return /^\d{4}-\d{4}$/.test(v) && Number(v.slice(5)) === Number(v.slice(0, 4)) + 1 ? (v as SelectionView) : 'courante'
}

/** Adresse avec la vue (la saison en cours : sans paramètre). */
export function withSelectionView(search: string, view: SelectionView): string {
  const q = new URLSearchParams(search)
  if (view === 'courante') q.delete(SELECTION_VIEW_KEY)
  else q.set(SELECTION_VIEW_KEY, view)
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Bornes d'une saison « 2024-2025 » (1er septembre → 31 août). */
export const seasonBounds = (label: string) => ({ from: `${label.slice(0, 4)}-09-01`, to: `${label.slice(5, 9)}-08-31`, label })

/**
 * Saisons passées où le groupe a eu au moins un membre (de la plus récente à la plus ancienne), sans la saison en cours.
 * Une période ouverte compte pour toutes les saisons depuis son entrée.
 */
export function pastSeasons(players: readonly SelPlayer[], ref: SelectionRef, today: string, max = 12): string[] {
  const cur = seasonOf(today)
  const out = new Set<string>()
  const curStart = Number(cur.from.slice(0, 4))
  for (const p of players)
    for (const x of p.selections ?? []) {
      if (!selectionMatches(x, ref, p.sex) || !isDay(x.from)) continue
      const first = Number(seasonOf(x.from).from.slice(0, 4))
      const last = Math.min(curStart - 1, Number(seasonOf(isDay(x.to) && x.to < today ? x.to : today).from.slice(0, 4)))
      for (let y = Math.max(first, curStart - max); y <= last; y++) out.add(`${y}-${y + 1}`)
    }
  return [...out].sort((a, b) => b.localeCompare(a))
}

/** Membres d'une vue : aujourd'hui (saison en cours) ou toute la saison passée. */
export function membersOfView<P extends SelPlayer>(players: readonly P[], ref: SelectionRef, view: SelectionView, today: string): P[] {
  if (view === 'courante') return selectionMembersAt(players, ref, today)
  const b = seasonBounds(view)
  return selectionMembersIn(players, ref, b.from, b.to)
}

// ---------- Écritures (fonctions pures : renvoient le nouveau tableau de périodes) ----------

/**
 * Ajout au groupe : ouvre une période à `from` (aujourd'hui par défaut) ; déjà sélectionné ce jour-là : null. Unité et sexe
 * du groupe recopiés (le sexe seulement s'il diffère de celui de la fiche ou si la fiche n'en a pas).
 */
export function openSelection(p: SelPlayer, ref: SelectionRef, from: string, unitName?: string): SelectionPeriod[] | null {
  if (isSelectedAt(p, ref, from)) return null
  const x: SelectionPeriod = {
    level: ref.level,
    ...(ref.level === 'france' ? { category: ref.category } : { unitId: ref.unitId, ...(unitName && { unitName }) }),
    sex: ref.sex,
    from,
  }
  return [...(p.selections ?? []), x]
}

/** Retrait du groupe : ferme la période en cours à `day`, sortie `to` (le même jour par défaut) et motif ; aucune : null. */
export function closeSelection(p: SelPlayer, ref: SelectionRef, day: string, reason: SelectionExit, to = day): SelectionPeriod[] | null {
  const i = selectionIndexAt(p, ref, day)
  if (i < 0) return null
  return (p.selections ?? []).map((x, k) => (k === i ? { ...x, to, exitReason: reason } : x))
}

/** Veille d'un jour AAAA-MM-JJ. */
export const dayBefore = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

/**
 * « Fin de sélection » depuis le groupe : la période en cours se ferme LA VEILLE (dernier jour de sélection : hier), pour que
 * le joueur sorte tout de suite de la vue « En ce moment » ; une période commencée aujourd'hui même (ajout du jour, annulé)
 * est simplement retirée. null : pas de période en cours.
 */
export function endSelection(p: SelPlayer, ref: SelectionRef, today: string, reason: SelectionExit): { selections: SelectionPeriod[]; removed: boolean } | null {
  const i = selectionIndexAt(p, ref, today)
  if (i < 0) return null
  const x = (p.selections ?? [])[i]
  if (x.from && x.from >= today) return { selections: (p.selections ?? []).filter((_, k) => k !== i), removed: true }
  return { selections: closeSelection(p, ref, today, reason, dayBefore(today))!, removed: false }
}

/** Retire seulement une période pas encore commencée (ajout prévu à une date future, annulé) ; null : rien à annuler. */
export function cancelUpcoming(p: SelPlayer, ref: SelectionRef, today: string): SelectionPeriod[] | null {
  const i = (p.selections ?? []).findIndex((x) => selectionMatches(x, ref, p.sex) && isDay(x.from) && x.from > today)
  return i < 0 ? null : (p.selections ?? []).filter((_, k) => k !== i)
}

// ---------- Groupes ----------

/**
 * Groupes « matérialisés » pour la LECTURE (filtres, niveaux de l'anneau, questions, suivis…) : un groupe de sélection reçoit
 * une COPIE dont `playerIds` = ses membres d'aujourd'hui ; les autres sont rendus tels quels. Ces copies ne s'enregistrent
 * JAMAIS (src/poleMembers.ts).
 */
export function materializeSelectionGroups<G extends { selection?: SelectionRef; playerIds: string[] }>(
  groups: readonly G[],
  players: readonly (SelPlayer & { id: string })[],
  day: string,
): G[] {
  return groups.map((g) => (g.selection ? { ...g, playerIds: selectionMembersAt(players, g.selection, day).map((p) => p.id) } : g))
}

/** Niveau de sélection d'une unité : comité ou ligue (par l'identifiant du niveau, sinon son nom), sinon rien. */
export function selectionLevelOfUnit(u: Pick<UnitRow, 'levelId'>, levels: readonly LevelRow[] = []): Exclude<SelectionLevel, 'france'> | undefined {
  const name = levels.find((l) => l.id === u.levelId && !l.deleted)?.name ?? ''
  const key = `${u.levelId.replace(/^niveau-/, '')} ${name}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  if (/^comite|\bcomites?\b/.test(key)) return 'comite'
  if (/^ligue|\bligues?\b/.test(key)) return 'ligue'
  return undefined
}

export interface SelectionGroupSpec {
  id: string
  name: string
  ref: SelectionRef
  /** Comité : son département (le premier de l'unité) ; ligue : rien. */
  department?: string
  unitName?: string
}

/** Tous les groupes de sélection de la structure : chaque comité et chaque ligue en masculin et féminin, et les 6 groupes France. */
export function selectionGroupSpecs(units: readonly UnitRow[], levels: readonly LevelRow[]): SelectionGroupSpec[] {
  const out: SelectionGroupSpec[] = []
  const sexes = ['M', 'F'] as const
  const live = units.filter((u) => !u.deleted).map((u) => ({ u, level: selectionLevelOfUnit(u, levels) }))
  for (const lv of ['comite', 'ligue'] as const)
    for (const { u } of live.filter((x) => x.level === lv).sort((a, b) => a.u.name.localeCompare(b.u.name, 'fr')))
      for (const sex of sexes) {
        const ref: SelectionRef = { level: lv, unitId: u.id, sex }
        out.push({ id: selectionGroupId(ref), name: selectionGroupName(ref, u), ref, unitName: u.name, ...(lv === 'comite' && u.departments?.[0] && { department: u.departments[0] }) })
      }
  for (const category of SELECTION_CATEGORIES)
    for (const sex of sexes) {
      const ref: SelectionRef = { level: 'france', category, sex }
      out.push({ id: selectionGroupId(ref), name: selectionGroupName(ref), ref })
    }
  return out
}

/** Groupes de la liste qui manquent (identifiant fixe absent, ou présent mais supprimé : il est recréé). */
export function missingSelectionGroups(specs: readonly SelectionGroupSpec[], groups: readonly { id: string; deleted?: boolean; selection?: SelectionRef }[]): SelectionGroupSpec[] {
  const have = new Set(groups.filter((g) => !g.deleted && g.selection).map((g) => g.id))
  return specs.filter((s) => !have.has(s.id))
}

// ---------- Statut, résumé ----------

/** Filtre de sélection (liste Joueurs, Demander) : niveau, catégorie (France), en ce moment ou sur une période. */
export interface SelectionWanted {
  level?: SelectionLevel
  category?: SelectionCategory
  /** Sélectionné en ce moment (période en cours aujourd'hui). */
  current?: boolean
  /** Sur une période (saison, année) : au moins un jour de sélection entre ces bornes. */
  from?: string
  to?: string
}

/** Le joueur répond-il au filtre ? Sans borne ni « en ce moment » : il y est passé (période passée ou en cours). */
export function selectionWantedMatches(p: SelPlayer, w: SelectionWanted, today: string): boolean {
  return (p.selections ?? []).some((x) => {
    if (!filledSelection(x)) return false
    if (w.level && x.level !== w.level) return false
    if (w.category && (x.level !== 'france' || x.category !== w.category)) return false
    // Une période qui n'a pas encore commencé ne compte pas (« passés par »).
    if (isDay(x.from) && x.from > today) return false
    if (w.current && !selectionCurrentAt(x, today)) return false
    if (w.from || w.to) return selectionOverlaps(x, w.from ?? '0000-01-01', w.to ?? '9999-12-31')
    return true
  })
}

/** Joueur en sélection aujourd'hui, à ce niveau (étiquettes, anneau). */
export const selectedNow = (p: SelPlayer, level: SelectionLevel, today: string) => (p.selections ?? []).some((x) => x.level === level && selectionCurrentAt(x, today))

/** Libellé d'un filtre : « passés par l'équipe de France U17 », « sélectionnés au comité en ce moment », accordé. */
export function selectionWantedText(w: SelectionWanted, sex?: string | null): string {
  const what =
    w.level === 'france' || w.category
      ? `l’équipe de France${w.category ? ` ${w.category}` : ''}`
      : w.level === 'ligue'
        ? 'la sélection de ligue'
        : w.level === 'comite'
          ? 'la sélection du comité'
          : 'une sélection'
  const when = w.from && w.to ? ` (${periodText(w.from, w.to)})` : ''
  if (w.current) {
    const short = w.level === 'france' || w.category ? `équipe de France${w.category ? ` ${w.category}` : ''}` : w.level === 'ligue' ? 'ligue' : w.level === 'comite' ? 'comité' : ''
    return `${accord('sélectionné', sex, 2)} en ce moment${short ? ` (${short})` : ''}`
  }
  return `${accord('passé', sex, 2)} par ${what}${when}`
}

/** « saison 2024-2025 », « 2025 », « du 01/09/2024 au 15/02/2025 ». */
export function periodText(from: string, to: string): string {
  if (from.slice(5) === '09-01' && to.slice(5) === '08-31' && Number(to.slice(0, 4)) === Number(from.slice(0, 4)) + 1) return `saison ${from.slice(0, 4)}-${to.slice(0, 4)}`
  if (from.slice(5) === '01-01' && to.slice(5) === '12-31' && from.slice(0, 4) === to.slice(0, 4)) return from.slice(0, 4)
  const d = (s: string) => s.split('-').reverse().join('/')
  return `du ${d(from)} au ${d(to)}`
}

/** « Comité du Var, depuis le 01/09/2025 ; Équipe de France U17, du 01/09/2024 au 30/06/2025 (fin de saison) ». */
export function selectionSummary(p: SelPlayer, unitName: (id: string) => UnitLabel | undefined = () => undefined): string {
  const d = (s: string) => s.split('-').reverse().join('/')
  return (p.selections ?? [])
    .filter(filledSelection)
    .sort((a, b) => (b.from ?? '').localeCompare(a.from ?? ''))
    .map((x) => {
      const when = x.from && x.to ? `du ${d(x.from)} au ${d(x.to)}` : x.from ? `depuis le ${d(x.from)}` : x.to ? `jusqu'au ${d(x.to)}` : ''
      const why = x.to && x.exitReason ? `(${selectionExitLabel(x.exitReason)?.toLowerCase()})` : ''
      return [selectionBaseName(x, (x.unitId && unitName(x.unitId)) || x.unitName), [when, why].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    })
    .join(' ; ')
}

/** Catégorie France proposée d'après l'âge de saison (année de fin de saison − année de naissance) : ≤ 17 U17, ≤ 19 U19, sinon U21. */
export function suggestCategory(birthDate: string | undefined, day: string): SelectionCategory | undefined {
  if (!/^\d{4}/.test(birthDate ?? '')) return undefined
  const end = Number(seasonOf(day).to.slice(0, 4))
  const age = end - Number(birthDate!.slice(0, 4))
  return age <= 17 ? 'U17' : age <= 19 ? 'U19' : 'U21'
}

// ---------- Garde-fou de saisie (formulaire de la fiche) ----------

export type SelectionIssueKind = 'sortie_avant_entree' | 'chevauchement' | 'futur' | 'incomplet'

export interface SelectionIssue {
  kind: SelectionIssueKind
  /** « error » : enregistrement bloqué ; « warning » : simple avertissement. */
  level: 'error' | 'warning'
  index: number
  other?: number
  message: string
}

function plusOneYear(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const dd = m === 2 && d === 29 ? 28 : d
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const longDate = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}`
}
const nth = (i: number) => (i === 0 ? '1re' : `${i + 1}e`)

/** Deux périodes du même groupe (niveau, unité ou catégorie, sexe). */
const sameGroup = (a: SelectionPeriod, b: SelectionPeriod, sex?: string | null) => {
  const sa = a.sex ?? sex ?? ''
  const sb = b.sex ?? sex ?? ''
  return a.level === b.level && (a.level === 'france' ? a.category === b.category : a.unitId === b.unitId) && sa === sb
}

/**
 * Problèmes des périodes de sélection d'une fiche (même esprit que src/poleChecks.ts) : une sortie avant l'entrée est
 * REFUSÉE ; un chevauchement dans le même groupe, une entrée à plus d'un an d'ici et une période sans comité / ligue / catégorie
 * sont de simples avertissements. Textes neutres (ils parlent des dates).
 */
export function selectionIssues(list: readonly SelectionPeriod[] | undefined, opts: { today: string; sex?: string | null }): SelectionIssue[] {
  const out: SelectionIssue[] = []
  const xs = list ?? []
  for (const [i, x] of xs.entries()) {
    if (isDay(x.from) && isDay(x.to) && x.to < x.from)
      out.push({ kind: 'sortie_avant_entree', level: 'error', index: i, message: `La sortie (${longDate(x.to)}) est avant l'entrée (${longDate(x.from)}) : corrige l'une des deux dates.` })
    if (isDay(x.from) && x.from > plusOneYear(opts.today)) out.push({ kind: 'futur', level: 'warning', index: i, message: `Entrée le ${longDate(x.from)} : plus d'un an d'ici. Vérifie l'année.` })
    if ((x.from || x.to) && (x.level === 'france' ? !x.category : !x.unitId))
      out.push({ kind: 'incomplet', level: 'warning', index: i, message: x.level === 'france' ? 'Choisis la catégorie (U17, U19, U21).' : `Choisis ${x.level === 'comite' ? 'le comité' : 'la ligue'}.` })
  }
  const dated = xs.map((x, i) => ({ x, i })).filter(({ x }) => isDay(x.from) && !(isDay(x.to) && x.to < x.from!))
  for (let a = 0; a < dated.length; a++)
    for (let b = a + 1; b < dated.length; b++) {
      const A = dated[a].x
      const B = dated[b].x
      if (!sameGroup(A, B, opts.sex)) continue
      const endA = isDay(A.to) ? A.to : '9999-12-31'
      const endB = isDay(B.to) ? B.to : '9999-12-31'
      if (A.from! <= endB && B.from! <= endA)
        out.push({ kind: 'chevauchement', level: 'warning', index: dated[b].i, other: dated[a].i, message: `Cette période recouvre la ${nth(dated[a].i)} période dans le même groupe : une seule à la fois, en principe.` })
    }
  return out.sort((p, q) => p.index - q.index || (p.level === q.level ? 0 : p.level === 'error' ? -1 : 1))
}

/** Message de refus en haut du formulaire (null : rien de bloquant). */
export function selectionBlockMessage(issues: readonly SelectionIssue[]): string | null {
  const n = issues.filter((x) => x.level === 'error').length
  if (!n) return null
  return n === 1 ? 'Sélections : une période a sa sortie avant son entrée. Corrige-la pour enregistrer.' : `Sélections : ${n} périodes ont leur sortie avant leur entrée. Corrige-les pour enregistrer.`
}

// ---------- Conversion d'un ancien groupe ----------

/**
 * Groupe de sélection proposé pour un groupe ordinaire qui a une portée (« Equipe de France », « Intercomités 83 ») :
 * fédération → France (catégorie : `category`, sinon celle proposée d'après l'âge du plus grand nombre de ses joueurs) ;
 * ligue → la ligue de sa région ; comité → le comité de son département. Sexe : celui du groupe (mixte ou absent : null,
 * à choisir). null : rien de sûr (le choix se fait à la main).
 */
export function conversionTarget(
  g: { scope?: string; sex?: string; department?: string; regionId?: string },
  opts: { units: readonly UnitRow[]; levels: readonly LevelRow[]; ligueOfRegion?: (regionId: string) => string | undefined; category?: SelectionCategory },
): SelectionRef | null {
  const sex = g.sex === 'M' || g.sex === 'F' ? g.sex : undefined
  if (!sex || !g.scope) return null
  if (g.scope === 'federation') return opts.category ? { level: 'france', category: opts.category, sex } : null
  const live = opts.units.filter((u) => !u.deleted)
  if (g.scope === 'comite') {
    const u = g.department ? live.find((x) => selectionLevelOfUnit(x, opts.levels) === 'comite' && x.departments?.includes(g.department!)) : undefined
    return u ? { level: 'comite', unitId: u.id, sex } : null
  }
  if (g.scope === 'ligue') {
    const id = g.regionId ? opts.ligueOfRegion?.(g.regionId) : undefined
    return id ? { level: 'ligue', unitId: id, sex } : null
  }
  return null
}

/** Catégorie la plus fréquente des joueurs (âge de saison à `day`) ; aucune date de naissance : undefined. */
export function majorityCategory(players: readonly { birthDate?: string }[], day: string): SelectionCategory | undefined {
  const n = new Map<SelectionCategory, number>()
  for (const p of players) {
    const c = suggestCategory(p.birthDate, day)
    if (c) n.set(c, (n.get(c) ?? 0) + 1)
  }
  return [...n].sort((a, b) => b[1] - a[1] || SELECTION_CATEGORIES.indexOf(a[0]) - SELECTION_CATEGORIES.indexOf(b[0]))[0]?.[0]
}

/** Écritures d'une conversion : une période ouverte à `from` pour chaque joueur pas déjà sélectionné ce jour-là. */
export function conversionWrites<P extends SelPlayer & { id: string }>(players: readonly P[], ref: SelectionRef, from: string, unitName?: string): { id: string; selections: SelectionPeriod[] }[] {
  const out: { id: string; selections: SelectionPeriod[] }[] = []
  for (const p of players) {
    const s = openSelection(p, ref, from, unitName)
    if (s) out.push({ id: p.id, selections: s })
  }
  return out
}

// ---------- Stages (événements) ----------

/** Types d'événement « stage » et leur niveau (palier du parcours, filtres). */
export const STAGE_TYPES = ['stage_comite', 'stage_ligue', 'stage_national'] as const
export type StageType = (typeof STAGE_TYPES)[number]
export const STAGE_LEVEL: Record<StageType, SelectionLevel> = { stage_comite: 'comite', stage_ligue: 'ligue', stage_national: 'france' }
export const STAGE_LABEL: Record<StageType, string> = { stage_comite: 'Stage comité', stage_ligue: 'Stage ligue', stage_national: 'Stage national' }
export const isStageType = (t: string | undefined): t is StageType => !!t && (STAGE_TYPES as readonly string[]).includes(t)
export const stageTypeOf = (level: SelectionLevel): StageType => (level === 'france' ? 'stage_national' : level === 'ligue' ? 'stage_ligue' : 'stage_comite')

/** Filtre « passés par un stage » : niveau (absent : tous), période facultative. */
export interface StageWanted {
  level?: SelectionLevel
  from?: string
  to?: string
}

/** « passés par un stage national », « passées par un stage de ligue (saison 2024-2025) ». */
export function stageWantedText(w: StageWanted, sex?: string | null): string {
  const what = w.level === 'france' ? 'un stage national' : w.level === 'ligue' ? 'un stage de ligue' : w.level === 'comite' ? 'un stage de comité' : 'un stage'
  return `${accord('passé', sex, 2)} par ${what}${w.from && w.to ? ` (${periodText(w.from, w.to)})` : ''}`
}

/** L'événement répond-il au filtre (type stage, niveau, passé, dans la période) ? */
export function stageMatches(ev: { type?: string; date?: string; deleted?: boolean }, w: StageWanted, today: string): boolean {
  if (ev.deleted || !isStageType(ev.type)) return false
  if (w.level && STAGE_LEVEL[ev.type] !== w.level) return false
  const d = ev.date ?? ''
  if (!d || d > today) return false
  if (w.from && d < w.from) return false
  if (w.to && d > w.to) return false
  return true
}

// ---------- Lecture des filtres (réponse du modèle, recette enregistrée) ----------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const foldText = (v: unknown) =>
  (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, ' ')
    .trim()

/** Niveau dit : « comité », « départemental », « ligue », « régional », « France », « national », « EDF »… */
export function parseSelectionLevel(v: unknown): SelectionLevel | undefined {
  const s = foldText(v)
  if (!s) return undefined
  if (/^(france|national|nationale|nationaux|edf|equipe de france|federal|federation|bleus?|bleuets?)$/.test(s)) return 'france'
  if (/^(ligues?|regional|regionale|regionaux|region)$/.test(s) || s.startsWith('ligue')) return 'ligue'
  if (/^(comites?|departemental|departementale|departementaux|cd)$/.test(s) || s.startsWith('comite')) return 'comite'
  return undefined
}

export function parseSelectionCategory(v: unknown): SelectionCategory | undefined {
  const m = /^(?:u|moins de |-)\s*(17|19|21)(?: ans)?$/.exec(foldText(v))
  return m ? (`U${m[1]}` as SelectionCategory) : undefined
}

/**
 * Période dite : « 2025 » (année civile), « 2024-2025 » ou « saison 2024-2025 », « saison_en_cours », « saison_derniere »,
 * { du, au } (AAAA-MM-JJ). Rien de reconnu : undefined.
 */
export function parsePeriodWanted(v: unknown, today: string): { from: string; to: string } | undefined {
  if (isObj(v)) {
    const from = typeof v.du === 'string' && DAY.test(v.du) ? v.du : typeof v.from === 'string' && DAY.test(v.from) ? v.from : undefined
    const to = typeof v.au === 'string' && DAY.test(v.au) ? v.au : typeof v.to === 'string' && DAY.test(v.to) ? v.to : undefined
    if (!from && !to) return undefined
    const a = from ?? '0000-01-01'
    const b = to ?? today
    return a <= b ? { from: a, to: b } : { from: b, to: a }
  }
  const s = foldText(v).replace(/_/g, ' ')
  if (!s) return undefined
  const season = /^(?:saison )?(\d{4}) ?- ?(\d{4})$/.exec(s)
  if (season && Number(season[2]) === Number(season[1]) + 1) return { from: `${season[1]}-09-01`, to: `${season[2]}-08-31` }
  const year = /^(?:en |annee )?(\d{4})$/.exec(s)
  if (year && Number(year[1]) >= 1990 && Number(year[1]) <= 2100) return { from: `${year[1]}-01-01`, to: `${year[1]}-12-31` }
  const cur = seasonOf(today)
  if (/^(?:cette saison|saison en cours|saison|la saison|saison actuelle)$/.test(s)) return { from: cur.from, to: cur.to }
  if (/^(?:saison derniere|la saison derniere|saison precedente|l annee derniere)$/.test(s)) {
    const y = Number(cur.from.slice(0, 4)) - 1
    return { from: `${y}-09-01`, to: `${y + 1}-08-31` }
  }
  return undefined
}

/** Filtre de sélection rendu par le modèle (objet, ou true : passés par une sélection) ; notes : ce qui n'a pas été compris. */
export function readSelectionWanted(v: unknown, today: string, notes: string[] = []): SelectionWanted | undefined {
  if (v === true || v === 'true' || v === 'oui') return {}
  if (typeof v === 'string') {
    const level = parseSelectionLevel(v)
    const category = parseSelectionCategory(v)
    if (level || category) return { ...(level && { level }), ...(category && { level: 'france' as const, category }) }
    if (/en ce moment|actuel|en cours/.test(foldText(v))) return { current: true }
    notes.push(`sélection « ${String(v).slice(0, 40)} »`)
    return undefined
  }
  if (!isObj(v)) return undefined
  const w: SelectionWanted = {}
  if (v.niveau !== undefined) {
    const l = parseSelectionLevel(v.niveau)
    if (l) w.level = l
    else notes.push(`niveau de sélection « ${String(v.niveau).slice(0, 40)} »`)
  }
  if (v.categorie !== undefined) {
    const c = parseSelectionCategory(v.categorie)
    if (c) {
      w.category = c
      w.level = 'france'
    } else notes.push(`catégorie « ${String(v.categorie).slice(0, 40)} »`)
  }
  if (v.en_ce_moment === true || v.enCeMoment === true || v.actuel === true) w.current = true
  if (v.periode !== undefined) {
    const p = parsePeriodWanted(v.periode, today)
    if (p) Object.assign(w, p)
    else notes.push(`période « ${typeof v.periode === 'object' ? JSON.stringify(v.periode).slice(0, 40) : String(v.periode).slice(0, 40)} »`)
  }
  // Une période donnée l'emporte sur « en ce moment » (« sélectionnés France U17 en 2025 »).
  if (w.from || w.to) delete w.current
  return w
}

/** Filtre « stage » rendu par le modèle (objet, chaîne du niveau, ou true : un stage quelconque). */
export function readStageWanted(v: unknown, today: string, notes: string[] = []): StageWanted | undefined {
  if (v === true || v === 'true' || v === 'oui') return {}
  if (typeof v === 'string') {
    const level = parseSelectionLevel(v)
    if (level) return { level }
    notes.push(`stage « ${v.slice(0, 40)} »`)
    return undefined
  }
  if (!isObj(v)) return undefined
  const w: StageWanted = {}
  if (v.niveau !== undefined) {
    const l = parseSelectionLevel(v.niveau)
    if (l) w.level = l
    else notes.push(`niveau de stage « ${String(v.niveau).slice(0, 40)} »`)
  }
  if (v.periode !== undefined) {
    const p = parsePeriodWanted(v.periode, today)
    if (p) Object.assign(w, p)
    else notes.push(`période de stage « ${String(v.periode).slice(0, 40)} »`)
  }
  return w
}

const LEVELS_SET = new Set<string>(SELECTION_LEVELS)
const CATS_SET = new Set<string>(SELECTION_CATEGORIES)
const okDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v)

/** Filtre de sélection relu depuis une recette enregistrée (adresse, « Mes questions ») : champs revérifiés, le reste ignoré. */
export function cleanSelectionWanted(v: unknown): SelectionWanted | undefined {
  if (!isObj(v)) return undefined
  const w: SelectionWanted = {}
  if (typeof v.level === 'string' && LEVELS_SET.has(v.level)) w.level = v.level as SelectionLevel
  if (typeof v.category === 'string' && CATS_SET.has(v.category)) w.category = v.category as SelectionCategory
  if (v.current === true) w.current = true
  if (okDay(v.from)) w.from = v.from
  if (okDay(v.to)) w.to = v.to
  return w
}

export function cleanStageWanted(v: unknown): StageWanted | undefined {
  if (!isObj(v)) return undefined
  const w: StageWanted = {}
  if (typeof v.level === 'string' && LEVELS_SET.has(v.level)) w.level = v.level as SelectionLevel
  if (okDay(v.from)) w.from = v.from
  if (okDay(v.to)) w.to = v.to
  return w
}

/** Description des deux clés pour le modèle (src/recipe.ts, buildQuestionSchema). */
export const SELECTION_SCHEMA =
  'selection (objet : niveau (comite | ligue | france ; omis : toutes), categorie (U17 | U19 | U21 : équipe de France), en_ce_moment (true : sélectionnés en ce moment ; omis : passés par), periode (annee AAAA | saison AAAA-AAAA | saison_en_cours | saison_derniere | {du, au})), stage (objet : niveau (comite | ligue | national ; omis : tous les stages), periode (comme selection) : passés par un stage, événement de type stage)'

// ---------- Lecture locale de la phrase (Demander, liste Joueurs : src/questionRescue.ts) ----------

/** Phrase repliée (minuscules, sans accents, ponctuation en espaces : voiceFilters.normalize). */
const SEL_RE =
  /\b(?:pass\w* par|selectionn\w*|en selection|ont ete selectionn\w*)\s+(?:(?:en|a|au|aux|par|dans)\s+)?(?:(?:l|la|le|les|une|un)\s+)?(?:selections?\s+)?(equipe de france|equipes de france|edf|france|nationale?|ligues?|regionale?|comites?|departementale?|du comite|de ligue)?(?:\s+u\s?(17|19|21))?/
const CURRENT_RE = /\b(?:selectionn\w*\s+(?:en ce moment|actuellement|aujourd hui|cette saison en ce moment)|actuellement selectionn\w*|en selection en ce moment|en ce moment en selection)\b/
const STAGE_RE = /\b(?:pass\w* par|ont fait|ont participe a|fait)\s+(?:un|une|des|les|le|au moins un)\s+stages?(?:\s+(national|nationaux|equipe de france|france|federal|de ligue|ligue|regional|regionaux|de comite|comite|departemental|departementaux))?\b/
const PERIOD_RE = /\b(?:en|pendant|durant|lors de)\s+(?:la\s+)?(?:saison\s+)?((?:19|20)\d\d)(?:\s+((?:19|20)\d\d))?\b|\b(cette saison|la saison derniere|saison derniere)\b/

/** Période dite dans la phrase (« en 2025 », « saison 2024 2025 », « cette saison »). */
function periodIn(text: string, today: string): { from: string; to: string } | undefined {
  const m = PERIOD_RE.exec(text)
  if (!m) return undefined
  if (m[3]) return parsePeriodWanted(m[3], today)
  if (m[2]) return parsePeriodWanted(`${m[1]}-${m[2]}`, today)
  return parsePeriodWanted(m[1], today)
}

/**
 * Sélection et stage dits dans la phrase (repliée) : « passés par l'équipe de France U17 », « sélectionnées en ce moment »,
 * « passés par la ligue », « sélectionnés France U19 en 2025 », « passés par un stage national ». Rien : {}.
 */
export function selectionPhraseIn(text: string, today: string): { selection?: SelectionWanted; stage?: StageWanted } {
  const out: { selection?: SelectionWanted; stage?: StageWanted } = {}
  const period = periodIn(text, today)
  const st = STAGE_RE.exec(text)
  if (st) {
    out.stage = { ...(st[1] && { level: parseSelectionLevel(st[1].replace(/^(de|du) /, '')) }), ...(period ?? {}) }
    if (!out.stage.level) delete out.stage.level
  }
  // Sans le morceau « stage » (« passés par un stage de ligue » n'est pas « passés par la ligue »).
  const rest = st ? text.replace(st[0], ' ') : text
  if (CURRENT_RE.test(rest)) {
    const lv = SEL_RE.exec(rest)
    const level = lv?.[1] ? parseSelectionLevel(lv[1].replace(/^(du|de) /, '')) : undefined
    out.selection = { current: true, ...(level && { level }), ...(lv?.[2] && { level: 'france' as const, category: `U${lv[2]}` as SelectionCategory }) }
    return out
  }
  const m = SEL_RE.exec(rest)
  if (m && (m[1] || m[2])) {
    const level = m[1] ? parseSelectionLevel(m[1].replace(/^(du|de) /, '')) : undefined
    out.selection = { ...(level && { level }), ...(m[2] && { level: 'france' as const, category: `U${m[2]}` as SelectionCategory }), ...(period ?? {}) }
  } else {
    // « équipe de France U17 » sans verbe (« les joueuses de l'équipe de France U19 ») : la catégorie suffit.
    const c = /\b(?:equipe de )?france u\s?(17|19|21)\b/.exec(rest)
    if (c) out.selection = { level: 'france', category: `U${c[1]}` as SelectionCategory, ...(period ?? {}) }
  }
  return out
}
