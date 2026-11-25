/*
 * PÉRIODE d'un objectif de travail (04/11, décision de Geoffroy) : UNE seule notion, un début et une fin facultative (pas
 * « date + durée », pas deux dates séparées à remplir). Mêmes règles pour les objectifs du staff (fiche, src/objectives.ts),
 * ceux donnés à un groupe (src/groupObjectives.ts) et ceux du jeune (« à moi », src/myGoals.ts, supabase/065).
 *  - DÉBUT : le jour où l'objectif est fixé (`date`, qui garde son sens) ; on peut le repousser (`from`, « à partir du 05/07 »,
 *    les vacances). Sans `from`, la période commence à `date` (objectif donné à un groupe sans date : le jour de l'envoi).
 *  - FIN : facultative (`due`, le même champ que « à faire avant le … » des objectifs donnés à un groupe).
 *  - SAISIE en un toucher (src/components/PeriodPicker.tsx) : « 1 semaine », « 2 semaines », « 1 mois », « Jusqu'à la
 *    rentrée » (le prochain 1er septembre), « Jusqu'au prochain stage » (le prochain événement où le joueur est sur la liste ;
 *    pour un groupe, le prochain commun à tous), « Pas de fin », « Autre date ». Une durée compte depuis le début choisi
 *    (`from`), sinon depuis le jour où on la choisit.
 *  - AFFICHAGE, toujours NEUTRE ou positif : « Jusqu'au 31/08 · encore 12 jours » (et une petite barre de temps),
 *    « Commence le 05/07 », « Période terminée » (jamais « en retard », jamais en rouge : l'objectif ne disparaît pas et ne
 *    change pas d'état tout seul ; le staff le passe « atteint » ou le prolonge, « Prolonger d'une semaine »). Sans fin : rien
 *    de plus qu'avant. Bilan à imprimer : « du 05/07 au 31/08 », « depuis le … ».
 * La période ne change pas les limites (3 en cours pour le staff, 5 pour le jeune).
 * Fichier pur (ni Dexie ni React) : testé par tools/test-periode.ts.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Ce qu'il faut d'un objectif pour parler de sa période. */
export interface PeriodFields {
  status?: 'en_cours' | 'atteint'
  /** Jour où il a été fixé. */
  date?: string
  /** Début repoussé (« à partir du … »), facultatif. */
  from?: string
  /** Fin, facultative. */
  due?: string
  /** Objectif donné à un groupe : le jour de l'envoi (début quand il n'a pas de date). */
  source?: { at?: string }
}

const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))

/** Jour décalé de n jours (AAAA-MM-JJ, calcul en UTC : pas d'effet d'heure d'été). */
export const addDays = (day: string, n: number) => new Date(utc(day) + n * 86400000).toISOString().slice(0, 10)

/** Jours de a à b (b − a ; négatif si b est avant a). */
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86400000)

/** Même jour du mois suivant ; ramené au dernier jour du mois s'il n'existe pas (31/01 → 28/02). */
export function addMonths(day: string, n: number): string {
  const y = +day.slice(0, 4)
  const m = +day.slice(5, 7) - 1 + n
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m, Math.min(+day.slice(8, 10), last))).toISOString().slice(0, 10)
}

/** « Jusqu'à la rentrée » : le prochain 1er septembre, strictement après le début (le 01/09 lui-même : l'année suivante). */
export function nextSchoolStart(day: string): string {
  const y = +day.slice(0, 4)
  return day < `${y}-09-01` ? `${y}-09-01` : `${y + 1}-09-01`
}

/** « 31/08 » la même année que `day`, sinon « 31/08/2027 ». */
export function shortDay(d: string, day: string): string {
  const [y, m, j] = d.split('-')
  return y === day.slice(0, 4) ? `${j}/${m}` : `${j}/${m}/${y}`
}

/** Début de la période : le début repoussé, sinon le jour où il a été fixé, sinon le jour de l'envoi (objectif donné). */
export const periodStart = (o: PeriodFields): string | undefined => o.from ?? o.date ?? o.source?.at

export type PeriodState = 'sans' | 'a_venir' | 'en_cours' | 'terminee'

/**
 * Où en est la période ce jour-là : pas encore commencée (`from` à venir), en cours (avec une fin), terminée (fin passée),
 * ou « sans » (pas de fin, déjà commencée : rien à dire). La fin est comprise (« jusqu'au 31/08 » : le 31 compte encore).
 */
export function periodState(o: PeriodFields, day: string): PeriodState {
  if (o.from && day < o.from) return 'a_venir'
  if (!o.due) return 'sans'
  return day > o.due ? 'terminee' : 'en_cours'
}

/** Jours qui restent jusqu'à la fin (0 : c'est le dernier jour) ; pas de fin : undefined. */
export const daysLeft = (o: PeriodFields, day: string): number | undefined => (o.due ? daysBetween(day, o.due) : undefined)

/**
 * Libellé de la carte (fiche, page du jeune), neutre : « Jusqu'au 31/08 · encore 12 jours », « … · dernier jour »,
 * « Commence le 05/07 » (« · jusqu'au 31/08 » s'il a une fin), « Période terminée » ; sans fin ou déjà atteint : rien.
 */
export function periodLabel(o: PeriodFields, day: string, fmt: (d: string) => string = (d) => shortDay(d, day)): string {
  if (o.status === 'atteint') return ''
  const s = periodState(o, day)
  if (s === 'a_venir') return `Commence le ${fmt(o.from!)}${o.due ? ` · jusqu’au ${fmt(o.due)}` : ''}`
  if (s === 'terminee') return 'Période terminée'
  if (s === 'en_cours') {
    const n = daysLeft(o, day)!
    return `Jusqu’au ${fmt(o.due!)} · ${n === 0 ? 'dernier jour' : `encore ${n} jour${n > 1 ? 's' : ''}`}`
  }
  return ''
}

/** Part du temps écoulée (0 à 1) pour la petite barre : seulement en cours, avec un début connu ; sinon undefined. */
export function periodElapsed(o: PeriodFields, day: string): number | undefined {
  const start = periodStart(o)
  if (periodState(o, day) !== 'en_cours' || !start || o.status === 'atteint') return undefined
  const total = daysBetween(start, o.due!) + 1
  if (total <= 0) return undefined
  return Math.min(1, Math.max(0, (daysBetween(start, day) + 1) / total))
}

/**
 * Pour le bilan à imprimer : « du 05/07 au 31/08 », « jusqu'au 31/08 » (début inconnu), « depuis le 05/07 » / « à partir
 * du 05/07 » (début repoussé, sans fin) ; rien sinon (sans fin ni début repoussé : la date de l'objectif suffit).
 */
export function periodRange(o: PeriodFields, day: string, fmt: (d: string) => string = (d) => shortDay(d, day)): string {
  const start = periodStart(o)
  if (o.due) return start && start <= o.due ? `du ${fmt(start)} au ${fmt(o.due)}` : `jusqu’au ${fmt(o.due)}`
  if (o.from) return o.from > day ? `à partir du ${fmt(o.from)}` : `depuis le ${fmt(o.from)}`
  return ''
}

/** Une fin avant le début (début repoussé, ou jour où il a été fixé) : refusée à l'enregistrement. */
export const periodBad = (o: PeriodFields) => !!o.due && !!(o.from ?? o.date) && o.due < (o.from ?? o.date)!

export const PERIOD_ERROR = 'La fin de la période vient avant son début : choisis une autre date.'

// ---------- Raccourcis (saisie en un toucher) ----------

export type PeriodShortcut = '1s' | '2s' | '1m' | 'rentree' | 'evenement' | 'sans'

/** Dans l'ordre des pastilles. « Jusqu'au prochain stage » : seulement quand il y a un événement à venir (sinon caché). */
export const PERIOD_SHORTCUTS: { key: PeriodShortcut; label: string }[] = [
  { key: '1s', label: '1 semaine' },
  { key: '2s', label: '2 semaines' },
  { key: '1m', label: '1 mois' },
  { key: 'rentree', label: 'Jusqu’à la rentrée' },
  { key: 'evenement', label: 'Jusqu’au prochain stage' },
  { key: 'sans', label: 'Pas de fin' },
]

/** Prochain événement à venir : « stage » dans son nom, sinon « événement » (la pastille le dit). */
export const eventShortcutLabel = (e: { name: string }) => (/stage/i.test(e.name) ? 'Jusqu’au prochain stage' : 'Jusqu’au prochain événement')

/** D'où comptent les durées : le début repoussé s'il y en a un, sinon le jour où on choisit. */
export const shortcutBase = (o: Pick<PeriodFields, 'from'>, day: string) => o.from ?? day

/**
 * Fin donnée par un raccourci, depuis `base` (shortcutBase) : undefined pour « Pas de fin » ; null quand il ne s'applique pas
 * (« Jusqu'au prochain stage » sans événement à venir).
 */
export function shortcutEnd(key: PeriodShortcut, base: string, nextEvent?: { date: string }): string | undefined | null {
  switch (key) {
    case '1s':
      return addDays(base, 7)
    case '2s':
      return addDays(base, 14)
    case '1m':
      return addMonths(base, 1)
    case 'rentree':
      return nextSchoolStart(base)
    case 'evenement':
      return nextEvent && nextEvent.date > base ? nextEvent.date : null
    case 'sans':
      return undefined
  }
}

/** Le raccourci qui donne cette fin (pastille allumée) ; une autre fin : « autre ». */
export function matchShortcut(due: string | undefined, base: string, nextEvent?: { date: string }): PeriodShortcut | 'autre' {
  if (!due) return 'sans'
  for (const { key } of PERIOD_SHORTCUTS) if (key !== 'sans' && shortcutEnd(key, base, nextEvent) === due) return key
  return 'autre'
}

/** « Prolonger d'une semaine » (période terminée) : 7 jours de plus, comptés depuis aujourd'hui si la fin est passée. */
export const extendPeriod = (due: string, day: string, days = 7) => addDays(due < day ? day : due, days)

/**
 * Prochain événement à venir (strictement après `after`) où TOUS ces joueurs sont sur la liste : un joueur (fiche, page du
 * jeune) ou un groupe (« Donner un objectif au groupe » : le prochain commun). Supprimés et archivés écartés ; aucun : undefined.
 */
export function nextEventFor<E extends { id: string; name: string; date: string; deleted?: boolean; archived?: boolean; playerIds?: string[] }>(
  events: readonly E[],
  playerIds: readonly string[],
  after: string,
): E | undefined {
  if (!playerIds.length) return undefined
  return events
    .filter((e) => !e.deleted && !e.archived && DAY_RE.test(e.date) && e.date > after && playerIds.every((id) => (e.playerIds ?? []).includes(id)))
    .sort((a, b) => a.date.localeCompare(b.date))[0]
}

/** Début et fin gardés (relecture d'une fiche, de ses objectifs « à moi ») : jours AAAA-MM-JJ seulement, clés absentes sinon. */
export function cleanPeriod(x: { from?: unknown; due?: unknown }): { from?: string; due?: string } {
  return {
    ...(typeof x.from === 'string' && DAY_RE.test(x.from) ? { from: x.from } : {}),
    ...(typeof x.due === 'string' && DAY_RE.test(x.due) ? { due: x.due } : {}),
  }
}
