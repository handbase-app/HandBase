/*
 * Espace joueur (supabase/051_espace_joueur.sql, src/pages/Me.tsx) : ce qu'un jeune (ou sa famille) écrit lui-même sur sa
 * fiche, dans la clé `self` de la fiche (« Ma lettre », « Mon parcours »), et les règles qui vont avec :
 *  - nettoyage et validation de ce qu'il écrit (tailles maximales, lignes vides retirées, années de clubs cohérentes,
 *    postes inconnus écartés) : même esprit que le contrôle du serveur (hb_player_self_update), en plus doux ;
 *  - âge minimum pour relier un compte à une fiche (réglage de l'installation, clé « espace_joueur », défaut 10 ans) ;
 *  - code d'invitation (8 caractères, alphabet sans O / 0 / I / 1, 30 jours) et texte prêt à envoyer ;
 *  - ce qu'un compte joueur peut voir : sa page si sa fiche est reliée, sinon l'écran « Entre ton code », jamais autre chose.
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

/**
 * Ce que le joueur a écrit lui-même (clé `self` de sa fiche). Lu par le staff sur la fiche (section à part), jamais dans
 * les exports CSV / PDF du staff. Écrit seulement par hb_player_self_update (jamais par hb_upsert).
 */
export interface PlayerSelf {
  letter?: SelfLetter
  path?: SelfPath
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
} as const

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
  const self: PlayerSelf = {}
  if (Object.keys(letter).length) self.letter = letter
  if (Object.keys(path).length) self.path = path
  const empty = !self.letter && !self.path
  const size = empty ? 0 : JSON.stringify(self).length
  return { self: empty ? undefined : self, notes, size }
}

/** Rien d'écrit (ou rien de gardé après nettoyage). */
export const selfIsEmpty = (s: PlayerSelf | undefined | null) =>
  !s || ((!s.letter || !Object.values(s.letter).some(Boolean)) && (!s.path || !Object.values(s.path).some((v) => Array.isArray(v) && v.length)))

/** Deux saisies identiques (pour savoir si le brouillon diffère de ce qui est enregistré) : updatedAt ignoré. */
export const sameSelf = (a: PlayerSelf | undefined, b: PlayerSelf | undefined) =>
  JSON.stringify({ letter: a?.letter ?? {}, path: a?.path ?? {} }) === JSON.stringify({ letter: b?.letter ?? {}, path: b?.path ?? {} })

/** « 2019 – 2022 », « depuis 2022 », « jusqu'en 2020 », ou rien. */
export function clubYears(c: Pick<SelfClub, 'from' | 'to'>): string {
  if (c.from && c.to) return c.from === c.to ? c.from : `${c.from} – ${c.to}`
  if (c.from) return `depuis ${c.from}`
  if (c.to) return `jusqu’en ${c.to}`
  return ''
}

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
