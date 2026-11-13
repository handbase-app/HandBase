import { actionKeys, nameKey, timeline, toStored, type ActionKind, type MatchSheet, type ParsedSheet, type SheetPlayer, type Side } from './matchSheet'

/*
 * Espace joueur, « Mes matchs » (supabase/053_matchs_joueur.sql, src/components/PlayerMatches.tsx) : règles pures, sans Dexie
 * ni React, testées par tools/test-matchs-joueur.ts.
 *  - D'où vient une feuille : le staff, le jeune (« joueur »), plus tard Gest'Hand. La lecture (PDF sur l'appareil, ou un
 *    service plus tard) rend toujours une ParsedSheet (src/matchSheet.ts) ; tout le reste ne dépend pas de la source.
 *  - Le jeune figure-t-il sur la feuille (findMeOnSheet) : même règle que le serveur (hb_pm_on_sheet).
 *  - Même match déjà dans l'appli (findDuplicate) : même règle que le serveur (hb_player_import_sheet).
 *  - Ce qu'on envoie au serveur (playerSheetRequest) : la feuille SANS noms ni licences, plus la seule ligne du jeune.
 *  - « Proposé par le joueur » (proposedOf) : marque posée par le serveur sur un événement ou un lien vidéo.
 *  - Séquenceur simplifié du jeune : ses actions de la feuille, estimées sur la vidéo d'après les repères ; ceux du staff
 *    priment toujours (mergeMarks, playerTimeline).
 */

// ---------- Source d'une feuille ----------

/** D'où vient une feuille de match : import du staff, espace joueur, plus tard la connexion à Gest'Hand. */
export type SheetSource = 'staff' | 'joueur' | 'gesthand'

export const SHEET_SOURCE_LABEL: Record<SheetSource, string> = {
  staff: 'Import du staff',
  joueur: 'Espace joueur',
  gesthand: 'Gest’Hand',
}

/** Source d'une feuille enregistrée (champ facultatif : sans lui, c'est un import du staff). */
export const sheetSourceOf = (ms: unknown): SheetSource => {
  const s = (ms as { source?: unknown } | undefined)?.source
  return s === 'joueur' || s === 'gesthand' ? s : 'staff'
}

/** Une façon d'obtenir une feuille lue (PDF sur l'appareil aujourd'hui ; Gest'Hand plus tard). */
export interface SheetProvider {
  source: SheetSource
  read(): Promise<ParsedSheet>
}

// ---------- « Proposé par le joueur » ----------

/** Marque posée par le serveur sur ce qu'un jeune a créé depuis son espace (événement, lien vidéo). */
export interface ProposedBy {
  kind: 'joueur'
  playerId: string
  at?: string
}

/** La marque d'une ligne (événement, lien vidéo), si elle a été proposée par un jeune. */
export function proposedOf(row: unknown): ProposedBy | undefined {
  const p = (row as { proposedBy?: unknown } | null | undefined)?.proposedBy
  if (!p || typeof p !== 'object') return undefined
  const o = p as Record<string, unknown>
  return o.kind === 'joueur' && typeof o.playerId === 'string' && o.playerId ? { kind: 'joueur', playerId: o.playerId, at: typeof o.at === 'string' ? o.at : undefined } : undefined
}

// ---------- Le jeune figure-t-il sur la feuille ? ----------

/** Ce que l'on sait du jeune, lu sur sa fiche. */
export interface SheetMe {
  firstName?: string
  lastName?: string
  license?: string
  previousLicenses?: string[]
  clubCode?: string
}

/** Son club : n° de club de la fiche, à défaut les 7 premiers chiffres de la licence (comme hb_player_club, 046). */
export function clubOfMe(me: Pick<SheetMe, 'clubCode' | 'license'>): string | undefined {
  const c = me.clubCode?.trim()
  if (c) return c
  return me.license && /^\d{13}$/.test(me.license) ? me.license.slice(0, 7) : undefined
}

type Line = Pick<SheetPlayer, 'license' | 'firstName' | 'lastName' | 'birthName'>

/**
 * Cette ligne de la feuille est-elle le jeune ? « license » : sa licence (actuelle ou ancienne) ; « name » : même prénom et
 * même nom (ou nom de naissance) ET n° de club de son équipe sur la feuille = son club ; club inconnu d'un côté : le nom
 * suffit seulement s'il n'y a pas deux licences différentes. Même règle que le serveur (hb_pm_on_sheet).
 */
export function onSheetLine(me: SheetMe, line: Line, sideClub?: string): 'license' | 'name' | undefined {
  if (line.license && (line.license === me.license || (me.previousLicenses ?? []).includes(line.license))) return 'license'
  const first = nameKey(line.firstName ?? '')
  const last = nameKey(me.lastName ?? '')
  if (!first || first !== nameKey(me.firstName ?? '') || !last) return undefined
  if (last !== nameKey(line.lastName ?? '') && last !== nameKey(line.birthName ?? '')) return undefined
  const mine = clubOfMe(me)
  if (sideClub && mine) return sideClub === mine ? 'name' : undefined
  return me.license && line.license ? undefined : 'name'
}

export type Presence = { kind: 'license' | 'name'; index: number } | { kind: 'absent' } | { kind: 'several' }

/** Le jeune sur la feuille : par sa licence d'abord, sinon par son nom (deux lignes possibles : « several », on n'en choisit pas). */
export function findMeOnSheet(sheet: Pick<ParsedSheet, 'roster' | 'homeClub' | 'awayClub'>, me: SheetMe): Presence {
  const club = (side: string) => (side === 'home' ? sheet.homeClub : sheet.awayClub)
  const byLicense = sheet.roster.findIndex((r) => onSheetLine(me, r, club(r.side)) === 'license')
  if (byLicense >= 0) return { kind: 'license', index: byLicense }
  const byName = sheet.roster.flatMap((r, i) => (onSheetLine(me, r, club(r.side)) === 'name' ? [i] : []))
  if (byName.length === 1) return { kind: 'name', index: byName[0] }
  return byName.length ? { kind: 'several' } : { kind: 'absent' }
}

// ---------- Même match déjà dans l'appli ? ----------

/** Ce qui identifie un match : code rencontre, sinon date et équipes (n° des clubs, noms). */
export interface MatchKey {
  code?: string
  date?: string
  home: string
  away: string
  homeClub?: string
  awayClub?: string
}

export const matchKeyOf = (s: Pick<ParsedSheet, 'code' | 'date' | 'home' | 'away' | 'homeClub' | 'awayClub'>): MatchKey => ({
  code: s.code?.trim() || undefined,
  date: s.date,
  home: s.home,
  away: s.away,
  homeClub: s.homeClub,
  awayClub: s.awayClub,
})

/** Événement comparé (ce que l'appli et le serveur en lisent). */
export interface DupCandidate {
  id: string
  date: string
  deleted?: boolean
  createdAtServer?: string
  matchSheet?: { code?: string; home: string; away: string; homeClub?: string; awayClub?: string }
  proposedBy?: unknown
}

/**
 * Même match : même code rencontre quand les deux feuilles en ont un ; sinon même date et mêmes équipes (n° des deux clubs
 * quand on les a tous, ou noms des deux équipes). Même règle que le serveur (hb_player_import_sheet).
 */
export function sameMatch(e: DupCandidate, k: MatchKey): boolean {
  const ms = e.matchSheet
  if (e.deleted || !ms) return false
  const code = ms.code?.trim()
  if (k.code && code) return code.toUpperCase() === k.code.toUpperCase()
  if (!k.date || e.date !== k.date) return false
  if (k.homeClub && k.awayClub && ms.homeClub === k.homeClub && ms.awayClub === k.awayClub) return true
  return nameKey(ms.home) === nameKey(k.home) && nameKey(ms.away) === nameKey(k.away)
}

/** Le match déjà dans l'appli : celui du staff d'abord, puis le plus ancien. */
export function findDuplicate<T extends DupCandidate>(events: T[], k: MatchKey): T | undefined {
  return events
    .filter((e) => sameMatch(e, k))
    .sort((a, b) => Number(!!proposedOf(a)) - Number(!!proposedOf(b)) || (a.createdAtServer ?? '').localeCompare(b.createdAtServer ?? '') || a.id.localeCompare(b.id))[0]
}

// ---------- Ce qui part au serveur ----------

export interface PlayerSheetRequest {
  /** Feuille SANS noms ni licences (forme enregistrée : numéros, équipes, déroulé) ; aucune fiche reliée (le serveur relie la sienne). */
  p_sheet: MatchSheet
  /** Sa seule ligne : rang dans players, et ce qu'il faut pour vérifier que c'est lui. */
  p_me: { index: number; license?: string; lastName: string; firstName: string; birthName?: string }
  /** Date (AAAA-MM-JJ), salle, n° des deux clubs. */
  p_meta: { date?: string; place?: string; homeClub?: string; awayClub?: string }
}

export function playerSheetRequest(s: ParsedSheet, index: number): PlayerSheetRequest {
  const r = s.roster[index]
  const { sync: _drop, ...sheet } = toStored(s, [])
  return {
    p_sheet: sheet,
    p_me: { index, license: r.license, lastName: r.lastName, firstName: r.firstName, ...(r.birthName ? { birthName: r.birthName } : {}) },
    p_meta: { date: s.date, place: s.place, homeClub: s.homeClub, awayClub: s.awayClub },
  }
}

/** Nom d'un match créé depuis une feuille : « Compétition – Équipe A / Équipe B » (comme l'import du staff). */
export const sheetEventName = (s: Pick<ParsedSheet, 'competition' | 'home' | 'away'>) => [s.competition, `${s.home} / ${s.away}`].filter(Boolean).join(' – ').slice(0, 200)

// ---------- Mes matchs ----------

export interface PlayerMatchVideo {
  id: string
  url: string
  /** Titre : seulement celui d'un lien proposé par un jeune (jamais celui donné par le staff). */
  title?: string
  /** Ajouté par moi. */
  mine?: boolean
  /** Proposé par un jeune. */
  proposed?: boolean
}

/** Un de mes matchs : seulement ce que dit la feuille, et les vidéos du match. */
export interface PlayerMatch {
  eventId: string
  date: string
  time?: string
  competition?: string
  home: string
  away: string
  score?: [number, number]
  side?: 'home' | 'away'
  num?: string
  /** Créé par moi (et pas encore repris par le staff). */
  mine?: boolean
  proposed?: boolean
  videos: PlayerMatchVideo[]
}

/** Rattachement à un match existant (serveur : hb_player_match_links ; mode essai : sur l'appareil). */
export interface Attachment {
  eventId: string
  side?: 'home' | 'away'
  num?: string
}

type LocalEvent = DupCandidate & { createdBy?: string; matchSheet?: DupCandidate['matchSheet'] & Partial<Pick<MatchSheet, 'players' | 'competition' | 'score' | 'time'>> }
type LocalVideo = { id: string; url: string; title?: string; targetKind: string; targetId: string; deleted?: boolean; createdBy?: string; createdAtServer?: string; proposedBy?: unknown }

/** Mes matchs calculés sur l'appareil (mode essai, aperçu du staff) : même résultat que le serveur (hb_player_matches). */
export function playerMatchesFrom(events: LocalEvent[], videos: LocalVideo[], playerId: string, attached: Attachment[] = [], myUid?: string): PlayerMatch[] {
  const out: PlayerMatch[] = []
  for (const e of events) {
    const ms = e.matchSheet
    if (e.deleted || !ms) continue
    const line = (ms.players ?? []).find((x) => x.playerId === playerId)
    const att = attached.find((a) => a.eventId === e.id)
    if (!line && !att) continue
    const vs = videos
      .filter((v) => !v.deleted && v.targetKind === 'event' && v.targetId === e.id)
      .sort((a, b) => Number(!!proposedOf(a)) - Number(!!proposedOf(b)) || (a.createdAtServer ?? '').localeCompare(b.createdAtServer ?? '') || a.id.localeCompare(b.id))
      .map((v) => ({
        id: v.id,
        url: v.url,
        ...(proposedOf(v) && v.title ? { title: v.title } : {}),
        mine: myUid ? v.createdBy === myUid : !v.createdBy && proposedOf(v)?.playerId === playerId,
        proposed: !!proposedOf(v),
      }))
    const side = line?.side ?? att?.side
    const num = line?.num ?? att?.num
    out.push({
      eventId: e.id,
      date: e.date,
      ...(ms.time ? { time: ms.time } : {}),
      ...(ms.competition ? { competition: ms.competition } : {}),
      home: ms.home,
      away: ms.away,
      ...(ms.score ? { score: ms.score } : {}),
      ...(side ? { side } : {}),
      ...(num ? { num } : {}),
      // Mode essai : pas de signature du serveur ; c'est le mien si je l'ai proposé.
      mine: myUid ? e.createdBy === myUid : !e.createdBy && proposedOf(e)?.playerId === playerId,
      proposed: !!proposedOf(e),
      videos: vs,
    })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.eventId.localeCompare(b.eventId))
}

/** « HANDBALL CLUB ALPHA – ENTENTE BETA HB ». */
export const matchTitle = (m: Pick<PlayerMatch, 'home' | 'away'>) => `${m.home} – ${m.away}`

/** Mon équipe : « HANDBALL CLUB ALPHA » (ou rien si on ne sait pas). */
export const myTeam = (m: Pick<PlayerMatch, 'home' | 'away' | 'side'>) => (m.side === 'home' ? m.home : m.side === 'away' ? m.away : undefined)

// ---------- Messages ----------

/** Refus du serveur (code d'erreur rendu par les fonctions de 053) → texte clair, tutoiement, jamais de reproche. */
export const MATCH_ERRORS: Record<string, string> = {
  absent_feuille:
    'Ton nom n’a pas été trouvé sur cette feuille (ni ta licence, ni ton nom avec ton club). Vérifie que c’est bien la feuille d’un de tes matchs ; si c’est le cas, ton encadrant peut vérifier ta fiche.',
  plusieurs: 'Deux joueurs de cette feuille ont ton nom : demande à ton encadrant d’ajouter ce match.',
  feuille_invalide: 'Cette feuille n’a pas pu être lue en entier. Essaie avec le PDF d’origine, celui téléchargé après le match.',
  date_invalide: 'La date du match n’a pas été trouvée sur la feuille.',
  trop_long: 'Cette feuille est trop grande pour être envoyée.',
  trop_de_matchs: 'Tu as déjà ajouté beaucoup de matchs aujourd’hui : la suite demain !',
  trop_de_videos: 'Tu as déjà ajouté beaucoup de vidéos aujourd’hui : la suite demain !',
  match_inconnu: 'Ce match n’est pas (ou plus) dans tes matchs.',
  lien_invalide: 'Ce lien n’est pas valide : copie l’adresse de la vidéo (elle commence par https://).',
  repere_invalide: 'Ce repère n’a pas pu être enregistré.',
  pas_joueur: 'Ce compte n’est pas un compte joueur.',
  sans_fiche: 'Ton compte n’est pas encore relié à ta fiche.',
  fiche_introuvable: 'Ta fiche n’est pas disponible : demande à ton encadrant.',
  pas_ouvert: 'Cette partie n’est pas encore ouverte sur ce serveur : demande à ton encadrant.',
  hors_ligne: 'Pas de connexion internet : réessaie quand tu es en ligne.',
}

export function matchErrorText(code: string | undefined | null): string {
  const k = (code ?? '').trim()
  return MATCH_ERRORS[k] ?? (k ? `Ça n’a pas marché : ${k}` : 'Ça n’a pas marché (connexion internet ?).')
}

/** Message de l'appareil avant tout envoi : le jeune n'est pas sur la feuille (ou deux fois). */
export function presenceError(p: Presence): string | undefined {
  return p.kind === 'absent' ? MATCH_ERRORS.absent_feuille : p.kind === 'several' ? MATCH_ERRORS.plusieurs : undefined
}

// ---------- Séquenceur simplifié du jeune ----------

/** Repères de période (temps vidéo, s) : s1 coup d'envoi, e1 fin 1re mi-temps, s2 début 2e, e2 fin du match… */
export const PERIOD_MARKS = ['s1', 'e1', 's2', 'e2', 's3', 'e3', 's4', 'e4'] as const
export type PeriodMark = (typeof PERIOD_MARKS)[number]

/** Repères du jeune pour un match (sur la vidéo videoId) : bornes des périodes, et ses actions calées (clé actionKeys → temps vidéo). */
export interface PlayerMarks {
  videoId: string
  marks: Partial<Record<PeriodMark, number>>
  fix: Record<string, number>
}

/** Une action du déroulé, telle que le jeune la reçoit (aucun joueur : seulement « à moi » ou non). */
export interface SeqAction {
  t: number
  p: number
  s: [number, number]
  k: ActionKind
  l?: string
  /** Équipe de l'action (couleur, nom d'équipe). */
  side?: Side
  /** C'est une de mes actions. */
  me?: boolean
}

/**
 * Ce que le serveur donne pour séquencer un de mes matchs (hb_player_match_seq) : le déroulé (sans aucun joueur : seulement
 * « à moi »), la durée de mi-temps, le calage du staff (s'il y en a un) et le mien.
 */
export interface PlayerSeqData {
  halfMin: number
  actions: SeqAction[]
  /** Calage du staff : vidéo, bornes, actions calées. Prime toujours sur le mien. */
  staff?: { videoId?: string; url?: string; marks: Record<string, number>; fix: Record<string, number> }
  mine?: PlayerMarks
}

type SeqSheet = Pick<MatchSheet, 'actions' | 'halfMin' | 'sync' | 'players'>

/** Mes rangs dans la liste des joueurs : ma fiche reliée, sinon mon équipe et mon numéro (rattachement). */
export function myIndexes(players: Pick<MatchSheet['players'][number], 'playerId' | 'side' | 'num'>[], playerId: string, side?: string, num?: string): number[] {
  const linked = players.flatMap((x, i) => (x.playerId === playerId ? [i] : []))
  if (linked.length) return linked
  return side && num ? players.flatMap((x, i) => (x.side === side && x.num === num ? [i] : [])) : []
}

/** Données de séquençage d'une feuille enregistrée, pour le jeune (mêmes champs que le serveur). */
export function seqDataFrom(ms: SeqSheet, mine: number[], marks?: PlayerMarks): PlayerSeqData {
  const s = ms.sync
  return {
    halfMin: ms.halfMin,
    actions: ms.actions.map((a) => ({
      t: a.t,
      p: a.p,
      s: a.s,
      k: a.k,
      ...(a.l ? { l: a.l } : {}),
      ...(a.side ? { side: a.side } : {}),
      ...(a.pl !== undefined && mine.includes(a.pl) ? { me: true } : {}),
    })),
    ...(s && (Object.keys(s.marks ?? {}).length || Object.keys(s.fix ?? {}).length) ? { staff: { videoId: s.videoId, url: s.url, marks: s.marks ?? {}, fix: s.fix ?? {} } } : {}),
    ...(marks ? { mine: marks } : {}),
  }
}

/** Le calage du staff porte-t-il sur cette vidéo ? (même règle que sheetMoments : identifiant, sinon adresse). */
export const staffOn = (d: PlayerSeqData, video: { id: string; url: string }) => !!d.staff && (d.staff.videoId ? d.staff.videoId === video.id : d.staff.url === video.url)

/**
 * Repères utilisés pour cette vidéo : ceux du staff (s'il a calé CETTE vidéo) priment, les miens complètent. Rend aussi qui a
 * posé chaque repère (« staff » ou « moi »).
 */
export function mergeMarks(d: PlayerSeqData, video: { id: string; url: string }) {
  const none = { marks: {} as Record<string, number>, fix: {} as Record<string, number> }
  const staff = staffOn(d, video) ? d.staff! : none
  const mine = d.mine && d.mine.videoId === video.id ? d.mine : none
  const marks: Record<string, number> = { ...mine.marks, ...staff.marks }
  const fix: Record<string, number> = { ...mine.fix, ...staff.fix }
  const by = (k: string, isMark: boolean): 'staff' | 'moi' | undefined => {
    const s = isMark ? (staff.marks as Record<string, number>)[k] : staff.fix[k]
    if (s !== undefined) return 'staff'
    const m = isMark ? (mine.marks as Record<string, number>)[k] : mine.fix[k]
    return m !== undefined ? 'moi' : undefined
  }
  return { marks, fix, markBy: (k: string) => by(k, true), fixBy: (k: string) => by(k, false) }
}

/** Une de mes actions pour le séquenceur : clé, libellé, temps de jeu, temps vidéo (calé ou estimé), et qui l'a calée. */
export interface MySeqItem {
  key: string
  i: number
  k: ActionKind
  p: number
  t: number
  s: [number, number]
  l?: string
  /** Temps vidéo (s) : calé, sinon estimé d'après les repères ; undefined sans aucun repère. */
  v?: number
  by?: 'staff' | 'moi'
}

/** Mes actions (et seulement les miennes), placées sur la vidéo : calage du staff d'abord, puis le mien, sinon l'estimation. */
export function myActions(d: PlayerSeqData, video: { id: string; url: string }): MySeqItem[] {
  const m = mergeMarks(d, video)
  const tl = timeline({ actions: d.actions.map((a) => ({ t: a.t, p: a.p, s: a.s, k: a.k })), halfMin: d.halfMin, sync: { marks: m.marks, fix: m.fix } })
  const keys = actionKeys(d.actions)
  return d.actions.flatMap((a, i) =>
    a.me ? [{ key: keys[i], i, k: a.k, p: a.p, t: a.t, s: a.s, ...(a.l ? { l: a.l } : {}), v: tl.at(i), by: m.fixBy(keys[i]) }] : [],
  )
}

/** Clés de mes actions (pour vérifier ce que j'envoie, comme le serveur). */
export const myActionKeys = (d: Pick<PlayerSeqData, 'actions'>) => {
  const keys = actionKeys(d.actions)
  return keys.filter((_, i) => d.actions[i].me)
}

/**
 * Mes repères nettoyés avant l'envoi (même contrôle que le serveur) : bornes connues, temps entre 0 et 100 h (arrondis au
 * dixième), actions calées seulement parmi MES actions ; ce que le staff a déjà posé n'est pas envoyé (il prime).
 */
export function cleanMarks(input: PlayerMarks, d: PlayerSeqData, video: { id: string; url: string }): PlayerMarks {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 360000
  const round = (v: number) => Math.round(v * 10) / 10
  const staff = staffOn(d, video) ? d.staff! : undefined
  const marks: PlayerMarks['marks'] = {}
  for (const k of PERIOD_MARKS) {
    const v = input.marks[k]
    if (ok(v) && staff?.marks[k] === undefined) marks[k] = round(v)
  }
  const mine = new Set(myActionKeys(d))
  const fix: Record<string, number> = {}
  for (const [k, v] of Object.entries(input.fix)) if (mine.has(k) && ok(v) && staff?.fix[k] === undefined) fix[k] = round(v)
  return { videoId: video.id, marks, fix }
}

/** Libellé d'une borne : « Coup d'envoi », « Fin 1re mi-temps »… */
export const MARK_LABEL: Record<PeriodMark, string> = {
  s1: 'Coup d’envoi',
  e1: 'Fin de la 1re mi-temps',
  s2: 'Début de la 2e mi-temps',
  e2: 'Fin du match',
  s3: 'Début prolongation 1',
  e3: 'Fin prolongation 1',
  s4: 'Début prolongation 2',
  e4: 'Fin prolongation 2',
}

/** Bornes utiles pour ce déroulé (prolongations seulement s'il y en a). */
export const marksFor = (d: Pick<PlayerSeqData, 'actions'>): PeriodMark[] => {
  const periods = new Set([1, 2, ...d.actions.map((a) => a.p)])
  return PERIOD_MARKS.filter((k) => periods.has(Number(k.slice(1))))
}
