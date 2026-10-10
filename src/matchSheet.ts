import type { Player, VideoMoment } from './db'
import { MAX_MOMENTS } from './videos'

/*
 * Feuille de match électronique FFHB (PDF de 2 pages) → données d'un match : en-tête (compétition, équipes, date, salle,
 * code rencontre, score), joueurs de chaque équipe (numéro, nom, licence, statistiques) et déroulé du match (temps de jeu,
 * score, action, joueur), puis moments vidéo par joueur une fois la vidéo calée.
 *
 * Ce fichier ne dépend pas de pdf.js : il reçoit les éléments de texte déjà positionnés (matchSheetPdf.ts les lit, chargé
 * seulement au clic). La mise en page est lue par position (x, y) et non par texte brut : le déroulé est sur deux colonnes,
 * chaque ligne « MM:SS  score  action joueur » est retrouvée par alignement horizontal.
 *
 * Données personnelles : seule la partie utile est enregistrée avec l'événement (MatchSheet) : numéros, équipe et fiche
 * HandBase reliée ; ni nom ni licence des joueurs sans fiche, et jamais le PDF.
 */

// ---------- Éléments de texte ----------

/** Un morceau de texte du PDF : page (1…), position du coin haut-gauche en points (y vers le bas), largeur, hauteur. */
export interface PdfItem {
  page: number
  x: number
  y: number
  w: number
  h: number
  str: string
}

export type Side = 'home' | 'away'
export type ActionKind = 'but' | 'but7' | 'tir' | 'tir7' | 'arret' | 'arret7' | '2mn' | 'avert' | 'disq' | 'bleu' | 'tm' | 'autre'

export const KIND_LABEL: Record<ActionKind, string> = {
  but: 'But',
  but7: 'But 7m',
  tir: 'Tir',
  tir7: 'Tir 7m',
  arret: 'Arrêt',
  arret7: 'Arrêt 7m',
  '2mn': '2 min',
  avert: 'Avertissement',
  disq: 'Disqualification',
  bleu: 'Carton bleu',
  tm: 'Temps mort',
  autre: 'Autre',
}

/** Statistiques d'un joueur telles qu'écrites sur la feuille (colonnes Buts, 7m, Tirs, Arrêts, Av., 2', Dis). */
export interface SheetStats {
  buts?: number
  sept?: number
  tirs?: number
  arrets?: number
  av?: number
  deux?: number
  dis?: number
}

/** Joueur lu sur la feuille (gardé en mémoire le temps de la vérification, jamais enregistré tel quel). */
export interface SheetPlayer {
  side: Side
  num?: string
  /** Nom complet tel qu'écrit (« NOM Prénom », éventuellement « (Né.e AUTRE) »). */
  name: string
  lastName: string
  firstName: string
  /** Nom de naissance indiqué entre parenthèses. */
  birthName?: string
  license?: string
  captain?: boolean
  stats: SheetStats
}

/** Une ligne du déroulé : temps de jeu (s depuis le coup d'envoi du match), période, score après l'action. */
export interface SheetAction {
  t: number
  p: number
  s: [number, number]
  k: ActionKind
  /** Libellé lu (« But 7m », « Commotion »…). */
  label: string
  side?: Side
  /** Indice du joueur dans roster. */
  pl?: number
  /** Nom lu quand aucun joueur de la liste ne correspond (vérification seulement). */
  who?: string
}

export interface ParsedSheet {
  code?: string
  competition?: string
  pool?: string
  /** AAAA-MM-JJ */
  date?: string
  /** HH:MM */
  time?: string
  place?: string
  home: string
  away: string
  homeClub?: string
  awayClub?: string
  score?: [number, number]
  roster: SheetPlayer[]
  actions: SheetAction[]
  warnings: string[]
}

const LINE_TOL = 2.5
const sameLine = (a: PdfItem, b: PdfItem) => a.page === b.page && Math.abs(a.y - b.y) < LINE_TOL
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
const isNum = (s: string) => /^\d{1,3}$/.test(s.trim())

/** Élément suivant à droite d'un libellé, sur la même ligne. */
function rightOf(items: PdfItem[], label: PdfItem) {
  return items.filter((i) => i !== label && sameLine(i, label) && i.x > label.x + label.w - 1).sort((a, b) => a.x - b.x)[0]
}

function findLabel(items: PdfItem[], text: string, page?: number) {
  return items.find((i) => (page === undefined || i.page === page) && clean(i.str) === text)
}

// ---------- Noms ----------

/** « DE LA FONTAINE Jean-Paul (Né.e MARTIN) » → nom, prénom, nom de naissance. */
export function splitName(raw: string): { lastName: string; firstName: string; birthName?: string } {
  let s = clean(raw)
  let birthName: string | undefined
  const m = s.match(/\s*\((?:n[ée]+\.?e?|n[ée]e?)\s+([^)]+)\)\s*$/i)
  if (m) {
    birthName = clean(m[1])
    s = s.slice(0, m.index).trim()
  }
  s = s.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const tokens = s.split(' ')
  let n = 0
  while (n < tokens.length && /\p{Lu}/u.test(tokens[n]) && tokens[n] === tokens[n].toUpperCase()) n++
  if (n === 0) n = 1
  if (n === tokens.length && tokens.length > 1) n = tokens.length - 1
  return { lastName: tokens.slice(0, n).join(' '), firstName: tokens.slice(n).join(' '), birthName }
}

/** Clé de comparaison de noms (sans accents, tirets, espaces ni casse). */
export const nameKey = (s: string) => fold(s).replace(/[^a-z]/g, '')

// ---------- Lecture ----------

const KNOWN: [RegExp, ActionKind][] = [
  [/^but 7 ?m\b/, 'but7'],
  [/^but\b/, 'but'],
  [/^tir 7 ?m\b/, 'tir7'],
  [/^tir\b/, 'tir'],
  [/^arret 7 ?m\b/, 'arret7'],
  [/^arret\b/, 'arret'],
  [/^2 ?mn\b|^2 ?min\b|^2'/, '2mn'],
  [/^avertissement\b/, 'avert'],
  [/^disqualification\b|^carton rouge\b/, 'disq'],
  [/^carton bleu\b/, 'bleu'],
  [/^temps mort\b/, 'tm'],
]
const KNOWN_PREFIX = /^(but 7 ?m|but|tir 7 ?m|tir|arr[eê]t 7 ?m|arr[eê]t|2 ?mn|2 ?min|avertissement|disqualification|carton rouge|carton bleu|temps mort)\b/i

function kindOf(label: string): ActionKind {
  const f = fold(clean(label))
  return KNOWN.find(([re]) => re.test(f))?.[1] ?? 'autre'
}

/** Lit la feuille à partir des éléments de texte de toutes ses pages. */
export function parseSheet(all: PdfItem[]): ParsedSheet {
  const items = all.filter((i) => i.str.trim()).map((i) => ({ ...i, str: clean(i.str) }))
  const warnings: string[] = []
  const p1 = items.filter((i) => i.page === 1)

  // En-tête (page 1).
  const val = (label: string) => {
    const l = findLabel(p1, label)
    return l ? rightOf(p1, l) : undefined
  }
  const code = val('Code Renc')?.str
  const compItem = val('Compétition')
  const competition = compItem?.str
  const pool = compItem && p1.find((i) => Math.abs(i.x - compItem.x) < 2 && i.y - compItem.y > 3 && i.y - compItem.y < 12 && i.str.length < 40)?.str
  const dm = val('Date')?.str.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/)
  const date = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : undefined
  const time = dm?.[4] ? `${dm[4].padStart(2, '0')}:${dm[5]}` : undefined
  let place: string | undefined
  const salle = findLabel(p1, 'Salle')
  if (salle) {
    const first = rightOf(p1, salle)
    if (first) {
      const second = p1.find((i) => Math.abs(i.x - first.x) < 2 && i.y - first.y > 3 && i.y - first.y < 12)
      const city = second?.str.match(/\b\d{5}\s+(.+)$/)?.[1]
      place = clean([first.str, city && !fold(first.str).includes(fold(city)) ? city : ''].filter(Boolean).join(', ')).slice(0, 120)
    }
  }
  const teamsItem = p1.filter((i) => i.h >= 8 && i.str.includes(' / ')).sort((a, b) => a.y - b.y)[0]
  const [home, away] = teamsItem ? teamsItem.str.split(' / ').map(clean) : ['Recevant', 'Visiteur']
  if (!teamsItem) warnings.push('Équipes non trouvées dans l’en-tête.')
  const scoreItems = teamsItem ? p1.filter((i) => sameLine(i, teamsItem) && i.x > teamsItem.x && isNum(i.str)).sort((a, b) => a.x - b.x) : []
  const score: [number, number] | undefined = scoreItems.length >= 2 ? [Number(scoreItems[0].str), Number(scoreItems[1].str)] : undefined
  const joined = items.map((i) => i.str).join(' | ')
  const homeClub = joined.match(/Club recevant\s*-\s*(\d+)/i)?.[1]
  const awayClub = joined.match(/Club visiteur\s*-\s*(\d+)/i)?.[1]

  // Déroulé : tout ce qui suit le titre « Déroulé du match ».
  const startItem = items.find((i) => /^d[ée]roul[ée] du match$/i.test(i.str))
  const afterStart = (i: PdfItem) => !startItem || i.page > startItem.page || (i.page === startItem.page && i.y > startItem.y)
  const beforeStart = (i: PdfItem) => !!startItem && !afterStart(i) && !(i === startItem)

  // Joueurs : un tableau par ligne de titres contenant « Licence » (1er = recevant, 2e = visiteur).
  const roster: SheetPlayer[] = []
  const headers = items.filter((i) => i.str === 'Licence' && (!startItem || beforeStart(i))).sort((a, b) => a.page - b.page || a.y - b.y)
  headers.slice(0, 2).forEach((hd, ti) => {
    const side: Side = ti === 0 ? 'home' : 'away'
    const cols = items.filter((i) => sameLine(i, hd))
    const col = (re: RegExp) => cols.find((c) => re.test(c.str))
    const numCol = col(/^N°$/)
    const statCols = (
      [
        ['buts', /^Buts$/i],
        ['sept', /^7 ?m$/i],
        ['tirs', /^Tirs$/i],
        ['arrets', /^Arr[eê]ts$/i],
        ['av', /^Av\.?$/i],
        ['deux', /^2'$|^2 ?min$/i],
        ['dis', /^Dis\.?$/i],
      ] as [keyof SheetStats, RegExp][]
    )
      .map(([k, re]) => {
        const c = col(re)
        return c && { k, cx: c.x + c.w / 2 }
      })
      .filter((c): c is { k: keyof SheetStats; cx: number } => !!c)
    const capt = col(/^Capt\.?$/i)
    const next = headers.find((h) => h.page === hd.page && h.y > hd.y + 3)
    const rows = new Map<number, PdfItem[]>()
    for (const i of items) {
      if (i.page !== hd.page || i.y <= hd.y + LINE_TOL || (next && i.y >= next.y - LINE_TOL)) continue
      if (startItem && !beforeStart(i)) continue
      const key = [...rows.keys()].find((y) => Math.abs(y - i.y) < LINE_TOL) ?? i.y
      rows.set(key, [...(rows.get(key) ?? []), i])
    }
    for (const row of [...rows.entries()].sort((a, b) => a[0] - b[0]).map((r) => r[1])) {
      if (row.some((i) => /^officiel/i.test(i.str))) continue
      const lic = row.find((i) => /^\d{13}$/.test(i.str))
      if (!lic) continue
      const numItem = numCol ? row.find((i) => isNum(i.str) && Math.abs(i.x + i.w / 2 - (numCol.x + numCol.w / 2)) < 9) : undefined
      const left = numItem ? numItem.x + numItem.w : numCol ? numCol.x + numCol.w : 0
      const name = clean(
        row
          .filter((i) => i.x > left && i.x < lic.x - 2 && /\p{L}/u.test(i.str))
          .sort((a, b) => a.x - b.x)
          .map((i) => i.str)
          .join(' '),
      )
      if (!name) continue
      const stats: SheetStats = {}
      for (const i of row) {
        if (i.x <= lic.x + lic.w || !statCols.length) continue
        const cx = i.x + i.w / 2
        const best = statCols.reduce((a, b) => (Math.abs(b.cx - cx) < Math.abs(a.cx - cx) ? b : a))
        if (Math.abs(best.cx - cx) > 12) continue
        if (isNum(i.str)) stats[best.k] = Number(i.str)
        else if (/^x$/i.test(i.str)) stats[best.k] = 1
      }
      const captain = !!capt && row.some((i) => /^x$/i.test(i.str) && Math.abs(i.x + i.w / 2 - (capt.x + capt.w / 2)) < 8)
      roster.push({ side, num: numItem?.str, name, ...splitName(name), license: lic.str, captain, stats })
    }
  })
  if (headers.length < 2) warnings.push('Les deux listes de joueurs n’ont pas été trouvées.')

  // Lignes du déroulé.
  const flow = items.filter(afterStart)
  const times = flow.filter((i) => /^\d{1,3}:\d{2}$/.test(i.str))
  // Colonnes : débuts des temps, regroupés (deux colonnes sur la feuille actuelle).
  const colStarts: number[] = []
  for (const x of times.map((t) => t.x).sort((a, b) => a - b)) if (!colStarts.length || x - colStarts[colStarts.length - 1] > 40) colStarts.push(x)
  const colOf = (x: number) => {
    let c = 0
    colStarts.forEach((s, j) => {
      if (x >= s - 15) c = j
    })
    return c
  }
  type Rec = { page: number; col: number; y: number } & ({ period: number } | { t: number; s: [number, number]; text: string })
  const recs: Rec[] = []
  for (const i of flow) {
    const pm = i.str.match(/^p[ée]riode\s*(\d)/i) ?? i.str.match(/^prolongation\s*(\d)/i)
    if (pm) recs.push({ page: i.page, col: colOf(i.x), y: i.y, period: /^prolong/i.test(i.str) ? 2 + Number(pm[1]) : Number(pm[1]) })
  }
  for (const t of times) {
    const col = colOf(t.x)
    const end = colStarts[col + 1] !== undefined ? colStarts[col + 1] - 15 : Infinity
    const line = flow.filter((i) => i !== t && sameLine(i, t) && i.x > t.x && i.x < end).sort((a, b) => a.x - b.x)
    const sc = line.find((i) => /^\d{1,3}\s*-\s*\d{1,3}$/.test(i.str))
    if (!sc) continue
    const text = clean(
      line
        .filter((i) => i.x > sc.x)
        .map((i) => i.str)
        .join(' '),
    )
    const [mm, ss] = t.str.split(':').map(Number)
    const [a, b] = sc.str.split('-').map((x) => Number(x.trim()))
    recs.push({ page: t.page, col, y: t.y, t: mm * 60 + ss, s: [a, b], text })
  }
  recs.sort((a, b) => a.page - b.page || a.col - b.col || a.y - b.y)

  // Actions : le nom du joueur termine le texte (« But 7m NOM Prénom ») ; on cherche le joueur de la liste.
  const names = roster.map((r, idx) => ({ idx, key: ' ' + clean(r.name), side: r.side }))
  const actions: SheetAction[] = []
  let period = 1
  let prev: [number, number] = [0, 0]
  for (const r of recs) {
    if ('period' in r) {
      period = r.period
      continue
    }
    const text = ' ' + r.text
    const len = Math.max(0, ...names.filter((n) => text.endsWith(n.key)).map((n) => n.key.length))
    const cands = len ? names.filter((n) => n.key.length === len && text.endsWith(n.key)) : []
    let label: string
    let who: string | undefined
    if (cands.length) label = clean(text.slice(0, text.length - len))
    else {
      const m = r.text.match(KNOWN_PREFIX)
      label = m ? m[0] : r.text.split(' ')[0]
      who = clean(r.text.slice(label.length)) || undefined
    }
    const k = kindOf(label)
    const goal = k === 'but' || k === 'but7'
    const scoreSide: Side | undefined = r.s[0] > prev[0] ? 'home' : r.s[1] > prev[1] ? 'away' : undefined
    const pick = cands.length > 1 && goal && scoreSide ? cands.find((c) => c.side === scoreSide) : cands[0]
    let side: Side | undefined = goal && scoreSide ? scoreSide : pick?.side
    if (k === 'tm') {
      side = /recevant/i.test(r.text) ? 'home' : /visiteur/i.test(r.text) ? 'away' : undefined
      who = undefined
    }
    actions.push({ t: r.t, p: period, s: r.s, k, label: k === 'autre' ? label : KIND_LABEL[k], side, pl: k === 'tm' ? undefined : pick?.idx, who: pick ? undefined : who })
    prev = r.s
  }
  if (!actions.length) warnings.push('Aucune ligne du déroulé du match n’a été lue.')

  // Temps de la 2e période écrits depuis 00:00 (et non depuis le début du match) : on les remet bout à bout.
  const maxP1 = Math.max(0, ...actions.filter((a) => a.p === 1).map((a) => a.t))
  const p2 = actions.filter((a) => a.p === 2)
  if (p2.length && Math.min(...p2.map((a) => a.t)) < maxP1 - 60) {
    const h = HALVES.find((m) => m * 60 >= maxP1) ?? 30
    for (const a of p2) a.t += h * 60
    warnings.push(`Temps de la 2e période comptés depuis la reprise : décalés de ${h} min.`)
  }
  return { code, competition, pool, date, time, place, home, away, homeClub, awayClub, score, roster, actions, warnings }
}

// ---------- Périodes, saisie en retard ----------

/** Durées de mi-temps possibles (minutes) selon les catégories. */
export const HALVES = [20, 25, 30]

/** Durée d'une mi-temps déduite du déroulé : la plus longue ≤ premier temps de la 2e période ; 30 min sinon. */
export function guessHalfMin(actions: Pick<SheetAction, 't' | 'p'>[]): number {
  const p2 = actions.filter((a) => a.p === 2).map((a) => a.t)
  const maxP1 = Math.max(0, ...actions.filter((a) => a.p === 1).map((a) => a.t))
  if (!p2.length) return 30
  const min2 = Math.min(...p2)
  const fit = HALVES.filter((h) => h * 60 <= min2 && h * 60 >= maxP1)
  return fit.length ? fit[fit.length - 1] : 30
}

/** Début (temps de jeu, s) d'une période : mi-temps de halfMin, prolongations de 5 min. */
export const periodStart = (p: number, halfMin: number) => (p <= 2 ? (p - 1) * halfMin * 60 : 2 * halfMin * 60 + (p - 3) * 300)

/** Nombre d'actions au même temps de jeu à partir duquel on considère une saisie en retard. */
export const LATE_MIN = 5

/**
 * Saisie en retard : la table de marque a rattrapé plusieurs actions d'un coup (5 et plus à la même seconde). Leur temps
 * de jeu est faux : elles ne sont pas placées automatiquement (à caler à la main dans le lecteur).
 */
export function lateIndexes(actions: Pick<SheetAction, 't' | 'p'>[], min = LATE_MIN): Set<number> {
  const count = new Map<string, number>()
  for (const a of actions) count.set(`${a.p}:${a.t}`, (count.get(`${a.p}:${a.t}`) ?? 0) + 1)
  return new Set(actions.flatMap((a, i) => ((count.get(`${a.p}:${a.t}`) ?? 0) >= min ? [i] : [])))
}

// ---------- Données enregistrées avec l'événement ----------

/** Joueur de la feuille tel qu'enregistré : équipe, numéro, fiche reliée (ni nom ni licence). */
export interface StoredPlayer {
  side: Side
  num?: string
  playerId?: string
  /** A des arrêts sur la feuille (gardien). */
  gk?: boolean
}

export interface StoredAction {
  t: number
  p: number
  s: [number, number]
  k: ActionKind
  side?: Side
  pl?: number
  /** Libellé d'une action « autre » (« Commotion »…). */
  l?: string
}

/**
 * Calage sur la vidéo du match (lien vidéo de l'événement) : repères temps de jeu → temps vidéo. Le serveur ne garde
 * que l'adresse, le titre et les moments d'un lien vidéo (036, 037) : les repères sont donc enregistrés ici, avec la
 * feuille de l'événement, pour le lien vidéo videoId.
 */
export interface MatchSync {
  /** Lien vidéo de l'événement utilisé, et son adresse (reprise par les liens générés sur les fiches). */
  videoId?: string
  url?: string
  /** Repères de période, temps vidéo (s) : s1 début 1re mi-temps, e1 fin 1re mi-temps, s2 début 2e, e2 fin du match. */
  marks: Record<string, number>
  /** « Cette action est ici » : temps vidéo posé pour une action (clé actionKeys) ; repère supplémentaire si son temps de jeu est fiable. */
  fix?: Record<string, number>
  /** Moments générés en plus des buts : arrêts (gardiens), tirs. */
  opts?: { saves?: boolean; shots?: boolean }
  /** Dernière génération des moments (ms). */
  generatedAt?: number
}

export interface MatchSheet {
  v: 1
  code?: string
  competition?: string
  home: string
  away: string
  score?: [number, number]
  time?: string
  halfMin: number
  players: StoredPlayer[]
  actions: StoredAction[]
  importedAt: string
  sync?: MatchSync
}

/** Clé stable d'une action (gardée d'un import à l'autre) : période, temps, score, type, rang parmi les identiques. */
export function actionKeys(actions: Pick<StoredAction, 'p' | 't' | 's' | 'k'>[]): string[] {
  const seen = new Map<string, number>()
  return actions.map((a) => {
    const base = `${a.p}:${a.t}:${a.s[0]}-${a.s[1]}:${a.k}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}:${n}`
  })
}

/** Données à enregistrer avec l'événement : liens joueur → fiche choisis à la vérification (indice → id de fiche). */
export function toStored(sheet: ParsedSheet, links: (string | undefined)[], prev?: MatchSheet): MatchSheet {
  return {
    v: 1,
    code: sheet.code,
    competition: sheet.competition,
    home: sheet.home,
    away: sheet.away,
    score: sheet.score,
    time: sheet.time,
    halfMin: prev?.halfMin ?? guessHalfMin(sheet.actions),
    players: sheet.roster.map((r, i) => ({
      side: r.side,
      num: r.num,
      ...(links[i] ? { playerId: links[i] } : {}),
      ...(r.stats.arrets ? { gk: true } : {}),
    })),
    actions: sheet.actions.map((a) => ({ t: a.t, p: a.p, s: a.s, k: a.k, ...(a.side ? { side: a.side } : {}), ...(a.pl !== undefined ? { pl: a.pl } : {}), ...(a.k === 'autre' ? { l: a.label.slice(0, 40) } : {}) })),
    importedAt: new Date().toISOString(),
    // Réimport : le calage est gardé (mêmes clés d'action pour les temps posés à la main).
    ...(prev?.sync ? { sync: prev.sync } : {}),
  }
}

// ---------- Relier les joueurs aux fiches ----------

export type LinkMatch = { kind: 'license'; player: Player } | { kind: 'name'; candidates: Player[] } | { kind: 'none' }

/** Fiche correspondant à un joueur de la feuille : licence exacte (actuelle ou ancienne), sinon même nom (à confirmer). */
export function matchPlayer(r: SheetPlayer, players: Player[], club?: string): LinkMatch {
  if (r.license) {
    const p = players.find((x) => x.license === r.license || x.previousLicenses?.includes(r.license!))
    if (p) return { kind: 'license', player: p }
  }
  const first = nameKey(r.firstName)
  const lasts = [nameKey(r.lastName), r.birthName && nameKey(r.birthName)].filter(Boolean)
  const cands = players
    .filter((p) => nameKey(p.firstName ?? '') === first && lasts.includes(nameKey(p.lastName ?? '')))
    // Même club d'abord.
    .sort((a, b) => Number(!!club && b.clubCode === club) - Number(!!club && a.clubCode === club))
  return cands.length ? { kind: 'name', candidates: cands } : { kind: 'none' }
}

// ---------- Moments vidéo ----------

/** Marque des moments générés depuis la feuille (le serveur ne garde que at, dur, note) : fin de la note. */
export const GEN_MARK = ' · feuille'
export const isGenerated = (m: VideoMoment) => !!m.note?.endsWith(GEN_MARK.trim()) && m.note.includes('·')

/** Durée d'un moment généré et avance sur le temps calculé (secondes). */
export const CLIP_DUR = 12
export const CLIP_LEAD = 8

/** Durée de jeu d'une période (s) : une mi-temps, ou 5 min de prolongation. */
export const periodLength = (p: number, halfMin: number) => (p <= 2 ? halfMin * 60 : 300)

/** Repère : temps de jeu g (s depuis le début du match) ↔ temps vidéo v (s). */
export type Anchor = { g: number; v: number; key: string }

/** Temps vidéo d'un temps de jeu : interpolation linéaire entre deux repères ; avant le premier ou après le dernier, temps réel (pente 1). */
export function mapTime(anchors: Anchor[], g: number): number | undefined {
  if (!anchors.length) return undefined
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  if (g <= first.g) return first.v - (first.g - g)
  if (g >= last.g) return last.v + (g - last.g)
  for (let j = 1; j < anchors.length; j++) {
    const a = anchors[j - 1]
    const b = anchors[j]
    if (g <= b.g) return a.v + ((g - a.g) * (b.v - a.v)) / (b.g - a.g)
  }
  return undefined
}

/**
 * Correspondance temps de jeu → temps vidéo d'une feuille calée. Par période : repères de début et de fin (facultatifs un
 * à un) et actions posées à la main dont le temps de jeu est fiable (pas une saisie en retard) ; interpolation linéaire par
 * morceaux entre repères (les arrêts de jeu se répartissent entre deux repères). Avec seulement le début : simple décalage.
 * Une action saisie en retard n'est placée que si on l'a posée elle-même.
 */
export function timeline(sheet: Pick<MatchSheet, 'actions' | 'halfMin' | 'sync'>) {
  const keys = actionKeys(sheet.actions)
  const late = lateIndexes(sheet.actions)
  const marks = sheet.sync?.marks ?? {}
  const fix = sheet.sync?.fix ?? {}
  const cache = new Map<number, Anchor[]>()
  const anchors = (p: number): Anchor[] => {
    let list = cache.get(p)
    if (list) return list
    const start = periodStart(p, sheet.halfMin)
    const raw: Anchor[] = []
    if (marks[`s${p}`] !== undefined) raw.push({ g: start, v: marks[`s${p}`], key: `s${p}` })
    if (marks[`e${p}`] !== undefined) raw.push({ g: start + periodLength(p, sheet.halfMin), v: marks[`e${p}`], key: `e${p}` })
    sheet.actions.forEach((a, i) => {
      if (a.p === p && !late.has(i) && fix[keys[i]] !== undefined) raw.push({ g: a.t, v: fix[keys[i]], key: keys[i] })
    })
    raw.sort((a, b) => a.g - b.g || a.v - b.v)
    // Repères incohérents (vidéo qui recule quand le jeu avance, même temps de jeu) : le dernier posé dans l'ordre est ignoré.
    list = []
    for (const r of raw) {
      const prev = list[list.length - 1]
      if (!prev || (r.g > prev.g && r.v > prev.v)) list.push(r)
    }
    cache.set(p, list)
    return list
  }
  return {
    keys,
    late,
    anchors,
    /** Temps vidéo de l'action i (s), undefined si elle ne peut pas être placée. */
    at(i: number): number | undefined {
      const a = sheet.actions[i]
      const f = fix[keys[i]]
      if (f !== undefined) return f
      if (late.has(i)) return undefined
      const v = mapTime(anchors(a.p), a.t)
      return v === undefined ? undefined : Math.max(0, v)
    },
    /** Arrêts cumulés d'une période (s) : durée vidéo entre début et fin moins la durée de jeu ; undefined sans les deux repères. */
    stoppage(p: number): number | undefined {
      const s = marks[`s${p}`]
      const e = marks[`e${p}`]
      return s !== undefined && e !== undefined ? e - s - periodLength(p, sheet.halfMin) : undefined
    },
  }
}

/** Temps vidéo d'une action (s), undefined si non calée. */
export const videoTimeOf = (sheet: Pick<MatchSheet, 'actions' | 'halfMin' | 'sync'>, i: number) => timeline(sheet).at(i)

/** Note d'un moment : « But 13-19 · feuille ». */
export const momentNote = (a: StoredAction) => `${a.k === 'autre' ? (a.l ?? 'Action') : KIND_LABEL[a.k]} ${a.s[0]}-${a.s[1]}${GEN_MARK}`

const PRIORITY: Partial<Record<ActionKind, number>> = { but: 0, but7: 0, arret: 1, arret7: 1, tir: 2, tir7: 2 }

/** Actions retenues pour un joueur : buts, et selon les options arrêts et tirs. */
export function playerActionIndexes(sheet: Pick<MatchSheet, 'actions'>, pl: number, opts: MatchSync['opts'] = {}) {
  return sheet.actions.flatMap((a, i) => {
    if (a.pl !== pl) return []
    const keep = a.k === 'but' || a.k === 'but7' || (opts.saves && (a.k === 'arret' || a.k === 'arret7')) || (opts.shots && (a.k === 'tir' || a.k === 'tir7'))
    return keep ? [i] : []
  })
}

/**
 * Moments d'un joueur : ceux ajoutés à la main sont gardés, ceux générés sont refaits (pas de doublon si on relance).
 * 20 moments au plus par lien (serveur) : les buts d'abord, puis les arrêts, puis les tirs.
 */
export function planPlayerMoments(sheet: Pick<MatchSheet, 'actions' | 'halfMin' | 'sync'>, pl: number, existing: VideoMoment[] = [], tl = timeline(sheet)) {
  const manual = existing.filter((m) => !isGenerated(m))
  const idx = playerActionIndexes(sheet, pl, sheet.sync?.opts)
  const placed: { m: VideoMoment; pr: number }[] = []
  let unplaced = 0
  for (const i of idx) {
    const vt = tl.at(i)
    if (vt === undefined) {
      unplaced++
      continue
    }
    placed.push({ m: { at: Math.max(0, Math.round(vt - CLIP_LEAD)), dur: CLIP_DUR, note: momentNote(sheet.actions[i]) }, pr: PRIORITY[sheet.actions[i].k] ?? 3 })
  }
  placed.sort((a, b) => a.pr - b.pr || a.m.at - b.m.at)
  const room = Math.max(0, MAX_MOMENTS - manual.length)
  const kept = placed.slice(0, room).map((x) => x.m)
  return { moments: [...manual, ...kept].sort((a, b) => a.at - b.at), unplaced, dropped: placed.length - kept.length, generated: kept.length }
}

/** Titre des liens générés sur les fiches : « U18 MASCULINS … – Équipe A / Équipe B (03/10/2026) ». */
export function videoTitle(sheet: Pick<MatchSheet, 'competition' | 'home' | 'away'>, date?: string) {
  const d = date ? date.split('-').reverse().join('/') : ''
  return [sheet.competition, `${sheet.home} / ${sheet.away}`].filter(Boolean).join(' – ').slice(0, 185) + (d ? ` (${d})` : '')
}

/** Nombre d'actions par type (écran de vérification). */
export function countKinds(actions: Pick<StoredAction, 'k'>[]) {
  const m = new Map<ActionKind, number>()
  for (const a of actions) m.set(a.k, (m.get(a.k) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
