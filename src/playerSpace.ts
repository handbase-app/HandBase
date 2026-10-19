/*
 * Espace joueur (supabase/051_espace_joueur.sql, 052_journal_joueur.sql, src/pages/Me.tsx) : ce qu'un jeune (ou sa famille)
 * écrit lui-même sur sa fiche, dans la clé `self` de la fiche (« Ma lettre » et ses versions précédentes, « Mes repères »,
 * « Mon parcours »), son journal du hand (table à part, privé par défaut), et les règles qui vont avec :
 *  - nettoyage et validation de ce qu'il écrit (tailles maximales, lignes vides retirées, années de clubs cohérentes,
 *    postes inconnus écartés) : même esprit que le contrôle du serveur (hb_player_self_update), en plus doux ;
 *  - âge minimum pour relier un compte à une fiche (réglage de l'installation, clé « espace_joueur », défaut 10 ans) ;
 *  - code d'invitation (8 caractères, alphabet sans O / 0 / I / 1, 30 jours) et texte prêt à envoyer ;
 *  - ce qu'un compte joueur peut voir : sa page si sa fiche est reliée, sinon l'écran « Entre ton code », jamais autre chose ;
 *  - « Mon journal du hand » (052) : humeurs (liste fermée), notes (nettoyage, ajout / correction / suppression / partage
 *    sur l'appareil en mode essai, mêmes règles que le serveur), tendance des humeurs pour le staff (nombres, jamais de texte),
 *    dates (« lundi 20 octobre ») ; numéros d'aide (« J'ai besoin d'en parler ») ; copie « Télécharger mes données ».
 * Fichier pur (ni Dexie ni React) : testé par tools/test-espace-joueur.ts.
 */

// ---------- Ce que le joueur écrit ----------

/** « Ma lettre » : trois questions guidées, positives et ouvertes, plus un champ libre. */
export interface SelfLetter {
  /** Qu'est-ce que le hand t'apporte ? */
  why?: string
  /** Un moment dont tu es fier / fière. */
  proud?: string
  /** Ce que tu veux travailler. */
  work?: string
  /** Si tu veux ajouter quelque chose. */
  free?: string
}

/** Un club du parcours : nom et années (AAAA), facultatives. */
export interface SelfClub {
  name: string
  from?: string
  to?: string
}

/** « Mon parcours » : clubs, postes joués (codes des postes du sport), sélections et palmarès (une ligne par entrée). */
export interface SelfPath {
  clubs?: SelfClub[]
  positions?: string[]
  selections?: string[]
  honours?: string[]
}

/** « Mes repères » : champs courts (une ligne, 80 caractères), facultatifs. */
export interface SelfMarks {
  /** Joueur ou joueuse préféré·e. */
  favPlayer?: string
  /** Équipe préférée. */
  favTeam?: string
  /** Poste rêvé (texte libre). */
  dreamPosition?: string
  /** Un match qui l'a marqué. */
  memorableMatch?: string
}

/** Une version précédente de la lettre : la date où elle avait été écrite, et son texte. */
export interface LetterVersion {
  at: string
  letter: SelfLetter
}

/**
 * Ce que le joueur a écrit lui-même (clé `self` de sa fiche). Lu par le staff sur la fiche (section à part), jamais dans
 * les exports CSV / PDF du staff. Écrit seulement par les fonctions du joueur (hb_player_self_update ; jamais par hb_upsert :
 * le serveur remet le `self` en place, 052). Le journal du hand n'est PAS ici (table hb_player_journal, privée).
 */
export interface PlayerSelf {
  letter?: SelfLetter
  path?: SelfPath
  /** « Mes repères » (052). */
  marks?: SelfMarks
  /** Date (ISO) où la lettre en place a été écrite, posée par le serveur (052). */
  letterAt?: string
  /** Versions précédentes de la lettre, la plus récente en premier, 20 au plus ; tenues par le serveur seul (052). */
  letterHistory?: LetterVersion[]
  /** Dernier enregistrement (ISO), posé par le serveur. */
  updatedAt?: string
}

/** Tailles maximales (les mêmes que le serveur, hb_player_self_update). */
export const SELF_LIMITS = {
  /** Chaque réponse de la lettre. */
  text: 2000,
  /** Clubs du parcours, et longueur d'un nom de club. */
  clubs: 20,
  clubName: 60,
  /** Postes joués. */
  positions: 12,
  /** Lignes de sélections et de palmarès, et longueur d'une ligne. */
  lines: 20,
  line: 120,
  /** Taille totale (JSON) acceptée par le serveur. */
  total: 20_000,
  /** Chaque repère (une ligne). */
  mark: 80,
  /** Versions précédentes de la lettre gardées. */
  letterVersions: 20,
  /** Texte d'une note du journal, et nombre de notes gardées. */
  note: 1000,
  notes: 200,
  /** Taille totale de `self` sur la fiche (lettre, parcours, repères, versions). */
  selfTotal: 300_000,
} as const

export const MARK_KEYS = ['favPlayer', 'favTeam', 'dreamPosition', 'memorableMatch'] as const
export type MarkKey = (typeof MARK_KEYS)[number]

/** Champs de « Mes repères », accordés au sexe de la fiche (« Ma joueuse préférée » quand on sait que c'est une fille). */
export function markFields(sex?: string | null): { key: MarkKey; label: string; short: string; hint: string }[] {
  const f = sex === 'F'
  return [
    { key: 'favPlayer', label: f ? 'Ma joueuse préférée' : 'Mon joueur préféré', short: f ? 'Joueuse préférée' : 'Joueur préféré', hint: 'Joueur ou joueuse, d’ici ou d’ailleurs' },
    { key: 'favTeam', label: 'Mon équipe préférée', short: 'Équipe préférée', hint: 'Un club, une sélection…' },
    { key: 'dreamPosition', label: 'Mon poste rêvé', short: 'Poste rêvé', hint: 'Là où tu rêves de jouer' },
    { key: 'memorableMatch', label: 'Un match qui m’a marqué', short: 'Match marquant', hint: 'Joué ou regardé' },
  ]
}

export const LETTER_KEYS = ['why', 'proud', 'work', 'free'] as const
export type LetterKey = (typeof LETTER_KEYS)[number]

/** Questions de « Ma lettre », accordées au sexe de la fiche (« fière » quand on sait que c'est une fille). */
export function letterQuestions(sex?: string | null): { key: LetterKey; label: string; hint: string }[] {
  const fier = sex === 'F' ? 'fière' : 'fier'
  return [
    { key: 'why', label: 'Qu’est-ce que le hand t’apporte ?', hint: 'Ce que tu aimes, ce que ça te donne, avec qui…' },
    { key: 'proud', label: `Un moment dont tu es ${fier}`, hint: 'Un match, un entraînement, un geste, une progression…' },
    { key: 'work', label: 'Ce que tu veux travailler', hint: 'Ce que tu as envie d’améliorer, à ton rythme.' },
    { key: 'free', label: 'Si tu veux ajouter quelque chose', hint: 'Libre : une question, une envie, un message à ton encadrant…' },
  ]
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** Texte nettoyé : caractères de contrôle retirés (sauf retours à la ligne et tabulations), bords coupés, longueur limitée. */
function cleanText(x: unknown, max: number): string | undefined {
  if (typeof x !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const s = x.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim()
  if (!s) return undefined
  return s.length > max ? s.slice(0, max).trimEnd() : s
}

/** Lignes d'un texte (ou d'un tableau) : vides retirées, bords coupés, nombre et longueur limités. */
export function cleanLines(x: unknown, maxLines = SELF_LIMITS.lines, maxLen = SELF_LIMITS.line): string[] {
  const raw = Array.isArray(x) ? x : typeof x === 'string' ? x.split('\n') : []
  const out: string[] = []
  for (const l of raw) {
    const s = cleanText(l, maxLen)?.replace(/\s*\n\s*/g, ' ')
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= maxLines) break
  }
  return out
}

/** Année à quatre chiffres entre 1950 et l'année prochaine ; sinon rien. */
export function cleanYear(x: unknown, today: string): string | undefined {
  const s = typeof x === 'number' ? String(x) : typeof x === 'string' ? x.trim() : ''
  if (!/^\d{4}$/.test(s)) return undefined
  const y = Number(s)
  const max = Number(today.slice(0, 4)) + 1
  return y >= 1950 && y <= max ? s : undefined
}

export interface CleanedSelf {
  /** Ce qui sera enregistré (undefined : rien du tout). */
  self: PlayerSelf | undefined
  /** Ce qui a été corrigé en passant (information, pas une erreur). */
  notes: string[]
  /** Taille du JSON à envoyer. */
  size: number
}

/**
 * Nettoie ce que le joueur a saisi : textes coupés aux tailles maximales, lignes vides et doublons retirés, clubs sans
 * nom écartés, années invalides retirées et années inversées remises dans l'ordre, postes inconnus du sport écartés.
 * `positions` : codes des postes du sport (src/sportConfig.ts). `today` : AAAA-MM-JJ.
 */
export function cleanSelf(input: unknown, positions: readonly string[], today: string): CleanedSelf {
  const notes: string[] = []
  const src = isObj(input) ? input : {}
  const letter: SelfLetter = {}
  const l = isObj(src.letter) ? src.letter : {}
  for (const k of LETTER_KEYS) {
    const v = cleanText(l[k], SELF_LIMITS.text)
    if (typeof l[k] === 'string' && l[k].trim().length > SELF_LIMITS.text) notes.push(`Réponse « ${k} » coupée à ${SELF_LIMITS.text} caractères`)
    if (v) letter[k] = v
  }
  const path: SelfPath = {}
  const p = isObj(src.path) ? src.path : {}
  const clubs: SelfClub[] = []
  for (const c of Array.isArray(p.clubs) ? p.clubs : []) {
    if (!isObj(c)) continue
    const name = cleanText(c.name, SELF_LIMITS.clubName)?.replace(/\s*\n\s*/g, ' ')
    if (!name) continue
    let from = cleanYear(c.from, today)
    let to = cleanYear(c.to, today)
    if ((c.from && !from) || (c.to && !to)) notes.push(`Année non reconnue pour « ${name} »`)
    if (from && to && from > to) {
      ;[from, to] = [to, from]
      notes.push(`Années remises dans l’ordre pour « ${name} »`)
    }
    clubs.push({ name, ...(from ? { from } : {}), ...(to ? { to } : {}) })
    if (clubs.length >= SELF_LIMITS.clubs) break
  }
  if (clubs.length) path.clubs = clubs
  const known = new Set(positions)
  const pos = (Array.isArray(p.positions) ? p.positions : []).filter((x): x is string => typeof x === 'string' && known.has(x))
  const uniq = [...new Set(pos)].slice(0, SELF_LIMITS.positions)
  if (Array.isArray(p.positions) && p.positions.length > pos.length) notes.push('Poste inconnu écarté')
  if (uniq.length) path.positions = uniq
  const selections = cleanLines(p.selections)
  if (selections.length) path.selections = selections
  const honours = cleanLines(p.honours)
  if (honours.length) path.honours = honours
  const marks: SelfMarks = {}
  const m = isObj(src.marks) ? src.marks : {}
  for (const k of MARK_KEYS) {
    const v = cleanText(m[k], SELF_LIMITS.mark)?.replace(/\s+/g, ' ')
    if (v) marks[k] = v
  }
  const self: PlayerSelf = {}
  if (Object.keys(letter).length) self.letter = letter
  if (Object.keys(path).length) self.path = path
  if (Object.keys(marks).length) self.marks = marks
  const empty = !self.letter && !self.path && !self.marks
  const size = empty ? 0 : JSON.stringify(self).length
  return { self: empty ? undefined : self, notes, size }
}

/** Rien d'écrit (ou rien de gardé après nettoyage) : ni lettre, ni parcours, ni repères, ni version précédente. */
export const selfIsEmpty = (s: PlayerSelf | undefined | null) =>
  !s ||
  ((!s.letter || !Object.values(s.letter).some(Boolean)) &&
    (!s.path || !Object.values(s.path).some((v) => Array.isArray(v) && v.length)) &&
    (!s.marks || !Object.values(s.marks).some(Boolean)) &&
    !s.letterHistory?.length)

/** Deux saisies identiques (pour savoir si le brouillon diffère de ce qui est enregistré) : dates et versions ignorées. */
export const sameSelf = (a: PlayerSelf | undefined, b: PlayerSelf | undefined) =>
  JSON.stringify({ letter: a?.letter ?? {}, path: a?.path ?? {}, marks: a?.marks ?? {} }) ===
  JSON.stringify({ letter: b?.letter ?? {}, path: b?.path ?? {}, marks: b?.marks ?? {} })

const sameLetter = (a: SelfLetter | undefined, b: SelfLetter | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})

/**
 * Enregistrement sur l'appareil (mode essai / local, sans serveur), même règle que hb_player_self_update (052) : lettre,
 * parcours et repères remplacés par la saisie nettoyée ; si la lettre change, la précédente part dans l'historique (datée de
 * son écriture, 20 versions au plus) ; l'historique ne s'écrit jamais depuis la saisie. `now` : ISO.
 */
export function saveSelfLocal(prev: PlayerSelf | undefined, cleaned: PlayerSelf | undefined, now: string): PlayerSelf | undefined {
  let history = [...(prev?.letterHistory ?? [])]
  const hadLetter = !!prev?.letter && Object.values(prev.letter).some(Boolean)
  const same = sameLetter(prev?.letter, cleaned?.letter)
  if (hadLetter && !same) history = [{ at: prev!.letterAt ?? prev!.updatedAt ?? now, letter: prev!.letter! }, ...history].slice(0, SELF_LIMITS.letterVersions)
  const next: PlayerSelf = {}
  if (cleaned?.letter) {
    next.letter = cleaned.letter
    next.letterAt = same ? (prev?.letterAt ?? prev?.updatedAt ?? now) : now
  }
  if (cleaned?.path) next.path = cleaned.path
  if (cleaned?.marks) next.marks = cleaned.marks
  if (next.letter || next.path || next.marks) next.updatedAt = now
  if (history.length) next.letterHistory = history
  return Object.keys(next).length ? next : undefined
}

/** « 2019 – 2022 », « depuis 2022 », « jusqu'en 2020 », ou rien. */
export function clubYears(c: Pick<SelfClub, 'from' | 'to'>): string {
  if (c.from && c.to) return c.from === c.to ? c.from : `${c.from} – ${c.to}`
  if (c.from) return `depuis ${c.from}`
  if (c.to) return `jusqu’en ${c.to}`
  return ''
}

// ---------- « Mon journal du hand » (052) ----------

/** Humeurs d'une note : liste FERMÉE (la même que le serveur, hb_self_mood). C'est le jeune qui s'exprime dans son journal :
 *  « déçu » ou « fatigué » disent ce qu'il ressent, ce n'est pas un jugement porté sur lui. */
export const JOURNAL_MOODS = [
  { id: 'motive', emoji: '🔥', m: 'motivé', f: 'motivée' },
  { id: 'content', emoji: '😄', m: 'content', f: 'contente' },
  { id: 'fier', emoji: '💪', m: 'fier', f: 'fière' },
  { id: 'concentre', emoji: '🎯', m: 'concentré', f: 'concentrée' },
  { id: 'serein', emoji: '😌', m: 'serein', f: 'sereine' },
  { id: 'pensif', emoji: '🤔', m: 'pensif', f: 'pensive' },
  { id: 'decu', emoji: '😕', m: 'déçu', f: 'déçue' },
  { id: 'fatigue', emoji: '😴', m: 'fatigué', f: 'fatiguée' },
] as const
export type JournalMood = (typeof JOURNAL_MOODS)[number]['id']

/** Humeur connue, sinon rien (comme le serveur : toute autre valeur est ignorée). */
export const cleanMood = (x: unknown): JournalMood | undefined => (JOURNAL_MOODS.some((m) => m.id === x) ? (x as JournalMood) : undefined)
export const moodOf = (id: string | null | undefined) => JOURNAL_MOODS.find((m) => m.id === id)
/** « motivée » quand on sait que c'est une fille ; masculin sinon. '' si inconnue. */
export const moodLabel = (id: string | null | undefined, sex?: string | null) => {
  const m = moodOf(id)
  return !m ? '' : sex === 'F' ? m.f : m.m
}

/** Une note du journal, telle que le serveur la renvoie (hb_journal_note) ; `at` posé par le serveur. */
export interface JournalNote {
  id: string
  at: string
  text: string
  mood?: JournalMood
  /** Partagée avec son encadrant (sinon : lue par le jeune seul). */
  shared?: boolean
  editedAt?: string
}

/** Texte d'une note : caractères de contrôle retirés, bords coupés, 1 000 caractères ; vide → undefined. */
export const cleanNoteText = (x: unknown) => cleanText(x, SELF_LIMITS.note)

/** Refus du serveur pour le journal (le code renvoyé, puis le texte affiché). */
export const JOURNAL_ERRORS: Record<string, string> = {
  note_vide: 'Écris quelques mots avant d’ajouter ta note.',
  note_introuvable: 'Cette note n’existe plus (supprimée depuis un autre appareil ?).',
  self_trop_long: 'Ta page est pleine : supprime quelques anciennes notes ou raccourcis ta lettre.',
  trop_long: 'C’est trop long : raccourcis un peu.',
  sans_fiche: 'Ta fiche n’est plus reliée : demande à ton encadrant.',
  pas_joueur: 'Ce compte n’est pas un compte joueur.',
  fiche_introuvable: 'Ta fiche n’est pas disponible : demande à ton encadrant.',
}
export function journalErrorText(message: string | undefined | null, code?: string): string {
  if (code === 'PGRST202' || code === '42P01') return 'Le journal n’est pas encore ouvert sur ce serveur : demande à ton encadrant.'
  const key = (message ?? '').trim()
  return JOURNAL_ERRORS[key] ?? (key ? `Impossible : ${key}` : 'Impossible (connexion internet ?).')
}

/** Identifiant d'une note créée sur l'appareil (mode essai) : « n » + 10 caractères. */
export function newNoteId(rand: () => number = Math.random): string {
  const a = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = 'n'
  for (let i = 0; i < 10; i++) s += a[Math.floor(rand() * a.length) % a.length]
  return s
}

export type JournalResult = { ok: true; notes: JournalNote[]; note?: JournalNote } | { ok: false; error: string }

/** Les notes, la plus récente en premier. */
export const sortNotes = (notes: readonly JournalNote[]) => [...notes].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

/** Ajout sur l'appareil (mode essai), même règle que hb_player_journal_add : note privée, en tête, 200 au plus. */
export function journalAdd(notes: readonly JournalNote[], text: unknown, mood: unknown, now: string, id = newNoteId()): JournalResult {
  const t = cleanNoteText(text)
  if (!t) return { ok: false, error: 'note_vide' }
  const m = cleanMood(mood)
  const note: JournalNote = { id, at: now, text: t, ...(m ? { mood: m } : {}), shared: false }
  return { ok: true, note, notes: sortNotes([note, ...notes]).slice(0, SELF_LIMITS.notes) }
}

/** Correction (texte, humeur) : la date reste, editedAt posé, le partage ne change pas. */
export function journalEdit(notes: readonly JournalNote[], id: string, text: unknown, mood: unknown, now: string): JournalResult {
  const t = cleanNoteText(text)
  if (!t) return { ok: false, error: 'note_vide' }
  const old = notes.find((n) => n.id === id)
  if (!old) return { ok: false, error: 'note_introuvable' }
  const m = cleanMood(mood)
  const note: JournalNote = { id, at: old.at, text: t, ...(m ? { mood: m } : {}), shared: !!old.shared, editedAt: now }
  return { ok: true, note, notes: notes.map((n) => (n.id === id ? note : n)) }
}

/** Partager avec son encadrant, ou reprendre. */
export function journalShare(notes: readonly JournalNote[], id: string, shared: boolean): JournalResult {
  const old = notes.find((n) => n.id === id)
  if (!old) return { ok: false, error: 'note_introuvable' }
  const note = { ...old, shared }
  return { ok: true, note, notes: notes.map((n) => (n.id === id ? note : n)) }
}

/** Suppression (rien à faire si elle n'existe plus). */
export const journalDelete = (notes: readonly JournalNote[], id: string): JournalNote[] => notes.filter((n) => n.id !== id)

/** Remplace (ou ajoute en tête) une note renvoyée par le serveur dans la liste affichée. */
export function withNote(notes: readonly JournalNote[], note: JournalNote): JournalNote[] {
  return notes.some((n) => n.id === note.id) ? notes.map((n) => (n.id === note.id ? note : n)) : sortNotes([note, ...notes]).slice(0, SELF_LIMITS.notes)
}

/** Jour local (AAAA-MM-JJ) d'une date ISO. */
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** « lundi 20 octobre » (l'année en plus si ce n'est pas l'année de `now`). */
export function journalDay(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }
  return d.toLocaleDateString('fr-FR', opts)
}

/** Tendance des humeurs : 8 semaines (du lundi), la plus ancienne en premier ; nombre de notes et nombre par humeur. */
export interface MoodWeek {
  from: string
  notes: number
  moods: Partial<Record<JournalMood, number>>
}
export interface MoodTrend {
  weeks: MoodWeek[]
}

/** Lundi (jour local) de la semaine d'une date. */
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

/** Tendance calculée sur l'appareil (mode essai), même forme que hb_player_mood_trend : toutes les notes, jamais de texte. */
export function moodTrend(notes: readonly Pick<JournalNote, 'at' | 'mood'>[], now: Date = new Date(), weeks = 8): MoodTrend {
  const monday = mondayOf(now)
  const out: MoodWeek[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const from = new Date(monday)
    from.setDate(from.getDate() - 7 * i)
    out.push({ from: localDay(from), notes: 0, moods: {} })
  }
  for (const n of notes) {
    const day = localDay(new Date(n.at))
    const w = [...out].reverse().find((x) => x.from <= day)
    if (!w || day >= localDay(new Date(new Date(monday).setDate(monday.getDate() + 7)))) continue
    w.notes++
    const m = cleanMood(n.mood)
    if (m) w.moods[m] = (w.moods[m] ?? 0) + 1
  }
  return { weeks: out }
}

/** Humeurs comptées sur les `last` dernières semaines, de la plus fréquente à la moins fréquente. */
export function moodCounts(trend: MoodTrend | null | undefined, last = 4): { mood: JournalMood; n: number }[] {
  const counts = new Map<JournalMood, number>()
  for (const w of (trend?.weeks ?? []).slice(-last))
    for (const [k, n] of Object.entries(w.moods)) {
      const m = cleanMood(k)
      if (m && n) counts.set(m, (counts.get(m) ?? 0) + n)
    }
  const order = JOURNAL_MOODS.map((m) => m.id as JournalMood)
  return [...counts].map(([mood, n]) => ({ mood, n })).sort((a, b) => b.n - a.n || order.indexOf(a.mood) - order.indexOf(b.mood))
}

/**
 * Une ligne pour le staff : « surtout motivé, un peu pensif » (les 4 dernières semaines), accordée au sexe de la fiche.
 * La plus fréquente « surtout » (« motivée » seule si c'est la seule) ; les suivantes, s'il y en a, « un peu » (deux au plus).
 * null : aucune humeur indiquée.
 */
export function moodTrendSummary(trend: MoodTrend | null | undefined, sex?: string | null, last = 4): string | null {
  const c = moodCounts(trend, last)
  if (!c.length) return null
  if (c.length === 1) return moodLabel(c[0].mood, sex)
  const rest = c.slice(1, 3).map((x) => moodLabel(x.mood, sex))
  return `surtout ${moodLabel(c[0].mood, sex)}, un peu ${rest.join(', un peu ')}`
}

// ---------- « J'ai besoin d'en parler » ----------

/**
 * Numéros officiels, gratuits et anonymes, affichés par le bouton « J'ai besoin d'en parler » (page /moi). Aucun envoi
 * automatique, aucune détection : c'est le jeune qui choisit d'appeler ou d'écrire.
 * Vérifiés par l'utilisateur et le coordinateur le 20/10/2026.
 */
export const HELP_CONTACTS = [
  { label: '3018', what: 'Harcèlement et cyberharcèlement', href: 'tel:3018' },
  { label: '119', what: 'Enfance en danger, 24 h/24', href: 'tel:119' },
  { label: '3114', what: 'Prévention du suicide, 24 h/24', href: 'tel:3114' },
  { label: 'Fil Santé Jeunes : 0 800 235 236', what: 'Écoute des jeunes, gratuit et anonyme', href: 'tel:0800235236' },
  { label: 'Signal-sports : signal-sports@sports.gouv.fr', what: 'Violences dans le sport', href: 'mailto:signal-sports@sports.gouv.fr' },
] as const

/** Personne à contacter (Réglages → Espace joueur, clé « espace_joueur » : { contact }) : texte libre, 200 caractères. */
export const PLAYER_CONTACT_MAX = 200
export function playerContactOf(rows: readonly { id: string; key?: string; value: unknown; deleted?: boolean }[] = []): string {
  const row = rows.find((r) => !r.deleted && (r.key ?? r.id) === PLAYER_SPACE_KEY)
  const v = isObj(row?.value) ? row!.value.contact : undefined
  return (cleanText(v, PLAYER_CONTACT_MAX) ?? '').replace(/\s*\n\s*/g, ' · ')
}

// ---------- « Créer son compte » depuis la fiche (052) ----------

/** Refus du serveur (hb_create_player_account) : le code, puis le texte affiché au staff. */
export const ACCOUNT_ERRORS: Record<string, string> = {
  naissance_manquante: 'La date de naissance manque sur la fiche : complète-la d’abord.',
  trop_jeune: 'En dessous de l’âge minimum de l’espace joueur (Réglages → Espace joueur).',
  fiche_deja_reliee: 'Cette fiche a déjà un compte joueur.',
  adresse_utilisee: 'Un compte existe déjà avec cette adresse e-mail.',
  fiche_introuvable: 'Fiche introuvable (supprimée ou fusionnée ?).',
}
export function accountErrorText(message: string | undefined | null, code?: string): string {
  if (code === 'PGRST202') return 'Exécute d’abord supabase/052_journal_joueur.sql dans Supabase.'
  const key = (message ?? '').trim()
  return ACCOUNT_ERRORS[key] ?? (key || 'Impossible (connexion internet ?).')
}

/** Mot de passe provisoire facile à dicter (sans 0 / O, 1 / l…) : « kq7m-x4tr-9b » (même forme que Réglages → Utilisateurs). */
export function provisionalPassword(rand: () => number = Math.random): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  let s = ''
  for (let i = 0; i < 10; i++) s += chars[Math.floor(rand() * chars.length) % chars.length]
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

/** Adresse e-mail plausible (même règle que le serveur, hb_member_check). */
export const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim())

/** Message prêt à envoyer au jeune après la création de son compte. */
export const accountMessage = (email: string, password: string, appName = 'Nextar') =>
  `Ton compte ${appName} : ${email.trim().toLowerCase()}, mot de passe provisoire ${password}, à changer à la première connexion.`

// ---------- « Télécharger mes données » ----------

/**
 * Copie complète de ce que le jeune a écrit, pour lui (page /moi) : identité telle que sa page la montre, lettre et versions
 * précédentes, repères, parcours, et TOUTES ses notes (privées et partagées). Rien d'autre (ni avis ni mesures du staff).
 */
export function myDataExport(
  identity: Record<string, string | undefined>,
  self: PlayerSelf | undefined,
  notes: readonly JournalNote[],
  exportedAt: string,
) {
  return {
    copie: 'Mes données écrites dans mon espace joueur',
    exporteeLe: exportedAt,
    identite: Object.fromEntries(Object.entries(identity).filter(([, v]) => v)),
    lettre: self?.letter ?? {},
    lettreEcriteLe: self?.letterAt ?? null,
    versionsPrecedentesDeLaLettre: self?.letterHistory ?? [],
    reperes: self?.marks ?? {},
    parcours: self?.path ?? {},
    journal: sortNotes(notes).map((n) => ({
      date: n.at,
      humeur: n.mood ?? null,
      texte: n.text,
      partageeAvecMonEncadrant: !!n.shared,
      ...(n.editedAt ? { corrigeeLe: n.editedAt } : {}),
    })),
  }
}

/** Nom du fichier : « mes-donnees-nextar-2026-10-20.json ». */
export const myDataFileName = (appSlug: string, day: string) => `mes-donnees-${appSlug}-${day}.json`

// ---------- Âge minimum ----------

/** Réglage de l'installation (hb_config, clé « espace_joueur » : { playerMinAge }) ; défaut 10 ans. */
export const PLAYER_SPACE_KEY = 'espace_joueur'
export const DEFAULT_PLAYER_MIN_AGE = 10

/** Âge minimum lu dans les lignes de configuration (valeur absente ou invalide : défaut). Entre 6 et 18 ans. */
export function playerMinAgeOf(rows: readonly { id: string; key?: string; value: unknown; deleted?: boolean }[] = []): number {
  const row = rows.find((r) => !r.deleted && (r.key ?? r.id) === PLAYER_SPACE_KEY)
  const v = isObj(row?.value) ? row!.value.playerMinAge : undefined
  return typeof v === 'number' && Number.isInteger(v) && v >= 6 && v <= 18 ? v : DEFAULT_PLAYER_MIN_AGE
}

/** Âge révolu à la date `today` (AAAA-MM-JJ) ; null si la date de naissance manque ou est invalide. */
export function ageAt(birthDate: string | undefined | null, today: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null
  const [by, bm, bd] = birthDate.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  if (!by || !bm || !bd || bm > 12 || bd > 31) return null
  let a = ty - by
  if (tm < bm || (tm === bm && td < bd)) a--
  return a
}

export type AgeCheck = 'ok' | 'missing' | 'young'

/** Peut-on relier un compte à cette fiche ? « missing » : pas de date de naissance ; « young » : en dessous de l'âge minimum. */
export function playerAgeCheck(birthDate: string | undefined | null, minAge: number, today: string): AgeCheck {
  const a = ageAt(birthDate, today)
  if (a === null) return 'missing'
  return a >= minAge ? 'ok' : 'young'
}

/** Forme courte : vrai seulement si la date est connue et l'âge suffisant. */
export const playerMinAgeOk = (birthDate: string | undefined | null, minAge: number, today: string) => playerAgeCheck(birthDate, minAge, today) === 'ok'

// ---------- Code d'invitation ----------

/** Alphabet du code : sans O / 0 ni I / 1 (lus à voix haute ou recopiés depuis un SMS sans ambiguïté). */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const INVITE_LENGTH = 8
export const INVITE_DAYS = 30

/** Ce que l'utilisateur a tapé, remis en forme : majuscules, espaces et tirets retirés. */
export const normalizeInviteCode = (s: string) => s.toUpperCase().replace(/[\s-]/g, '')

const INVITE_RE = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_LENGTH}}$`)

/** Code bien formé (8 caractères de l'alphabet) ? */
export const isInviteCode = (s: string) => INVITE_RE.test(normalizeInviteCode(s))

/** « XXXX XXXX » : plus facile à lire et à recopier. */
export const formatInviteCode = (s: string) => {
  const c = normalizeInviteCode(s)
  return c.length === INVITE_LENGTH ? `${c.slice(0, 4)} ${c.slice(4)}` : c
}

/** Texte prêt à envoyer au jeune (SMS, WhatsApp…) : rien d'autre que le code et sa validité. */
export const inviteMessage = (code: string, appName = 'Nextar', days = INVITE_DAYS) => `Ton code ${appName} : ${normalizeInviteCode(code)}, valable ${days} jours`

/** Messages clairs pour les refus du serveur (hb_claim_invite) : le code renvoyé par la fonction, puis le texte affiché. */
export const CLAIM_ERRORS: Record<string, string> = {
  code_inconnu: 'Ce code n’existe pas : vérifie les 8 caractères (pas de O ni de I, ce sont des chiffres ou d’autres lettres).',
  code_expire: 'Ce code a expiré (30 jours) : demande un nouveau code à ton encadrant.',
  code_utilise: 'Ce code a déjà servi : demande un nouveau code à ton encadrant.',
  naissance_manquante: 'Ta date de naissance n’est pas sur ta fiche : demande à ton encadrant de la compléter, puis réessaie.',
  trop_jeune: 'L’espace joueur est ouvert à partir d’un certain âge : demande à ton encadrant.',
  fiche_introuvable: 'La fiche de ce code n’existe plus : demande à ton encadrant.',
  pas_joueur: 'Ce compte n’est pas un compte joueur.',
  deja_relie: 'Ce compte est déjà relié à une fiche.',
  fiche_deja_reliee: 'Cette fiche a déjà un compte joueur : demande à ton encadrant.',
}

/** Message affiché pour une erreur renvoyée par hb_claim_invite (« code_expire », …) ; inconnu : le message brut. */
export function claimErrorText(message: string | undefined | null): string {
  const key = (message ?? '').trim()
  return CLAIM_ERRORS[key] ?? (key ? `Impossible de relier ta fiche : ${key}` : 'Impossible de relier ta fiche (connexion internet ?).')
}

// ---------- Ce qu'un compte joueur voit ----------

export type PlayerAccess = 'staff' | 'claim' | 'page'

/**
 * Compte joueur SANS fiche reliée : rien d'autre que l'écran « Entre ton code » (« claim ») ; avec une fiche : sa page
 * (« page ») ; tout autre rôle : l'appli du staff (« staff »).
 */
export function playerAccess(role: string | null | undefined, playerId: string | null | undefined): PlayerAccess {
  if (role !== 'joueur') return 'staff'
  return playerId ? 'page' : 'claim'
}

/** Tables que la synchronisation d'un compte joueur reçoit : sa fiche, et la configuration de l'installation (sport, postes,
 *  apparence) et les listes (noms des régions, pour ses passages en pôle) : aucune donnée personnelle dedans. */
export const PLAYER_TABLES = ['players', 'config', 'lists'] as const
export const playerReadsTable = (table: string) => (PLAYER_TABLES as readonly string[]).includes(table)
