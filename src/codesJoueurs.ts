/*
 * CODES DE JOUEUR (projet « Serveur MCP Nextar ») : ce que le serveur MCP donne à l'IA à la place d'un joueur. Nextar
 * n'envoie jamais de données de joueur à une IA : ni nom, ni prénom, ni date de naissance, ni club, ni licence. L'IA reçoit
 * « J-7K3Q2MX », écrit son rapport avec, et l'appareil du coach remet les noms (page /rapport/:id).
 *
 * Fichier PUR, sans aucun import (ni Dexie, ni React, ni réseau) : utilisé par l'appli (remise des noms sur l'appareil) et,
 * en copie générée, par la fonction Supabase « mcp » (supabase/functions/mcp/partage/, tools/generer-partage-mcp.ts).
 * Testé par tools/test-mcp.ts (stabilité, format, 40 000 identifiants fictifs, fautes de frappe, codes partagés).
 *
 * Le code :
 *  - STABLE : calculé à partir du seul identifiant de la fiche (le même sur le serveur et sur tous les appareils), jamais
 *    tiré au hasard ni rangé dans la base ;
 *  - COURT : « J- » puis 6 signes de hachage et 1 signe de contrôle, alphabet de Crockford (chiffres et majuscules sans I, L,
 *    O, U : pas de confusion 0 / O ni 1 / I / L) ;
 *  - NON RÉVERSIBLE SANS LA BASE : un hachage de l'identifiant (lui-même tiré au hasard) ; le code ne dit rien du joueur, et
 *    il faut la liste des fiches pour retrouver laquelle il désigne ;
 *  - VÉRIFIÉ : le signe de contrôle attrape toute faute d'un seul signe (l'IA qui recopie mal un code ne désigne pas un autre
 *    joueur) ; en lecture, minuscules acceptées, O lu 0, I et L lus 1 ;
 *  - PAS DE COLLISION SILENCIEUSE : 30 bits de hachage, donc deux fiches peuvent tomber sur le même code (rare : environ une
 *    paire sur 40 000 fiches). Quand cela arrive dans les fiches connues, le code est « partagé » : l'appareil ne remet aucun
 *    nom (il écrit « code partagé par 2 fiches ») et le serveur le signale (code_partage) ; jamais un nom au hasard.
 */

/** Alphabet de Crockford (32 signes). */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const HASH_LEN = 6
const WEIGHTS = [1, 3, 5, 7, 9, 11] // impairs : toute faute d'un seul signe change le signe de contrôle (modulo 32)

/** Hachage 53 bits (cyrb53, domaine public) : rapide, le même partout (navigateur, Deno, Node). */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

const checkOf = (vals: readonly number[]) => CODE_ALPHABET[vals.reduce((s, v, i) => s + v * WEIGHTS[i], 0) % 32]

/** Code d'une fiche : « J-7K3Q2MX ». Toujours le même pour le même identifiant. */
export function codeJoueur(playerId: string): string {
  let h = cyrb53(`nextar-joueur:${playerId}`)
  const vals: number[] = []
  for (let i = 0; i < HASH_LEN; i++) {
    vals.push(h % 32)
    h = Math.floor(h / 32)
  }
  return `J-${vals.map((v) => CODE_ALPHABET[v]).join('')}${checkOf(vals)}`
}

/** Codes dans un texte : « J- » puis 7 signes (minuscules, O, I, L tolérés ; contrôle vérifié à part). */
export const CODE_PATTERN = /\bJ-[0-9A-Za-z]{7}\b/g

/** Écriture normale d'un code lu (minuscules, O → 0, I / L → 1) ; pas un code : null. Le signe de contrôle n'est pas vérifié ici. */
export function normaliserCode(s: string): string | null {
  const m = /^\s*[Jj]-([0-9A-Za-z]{7})\s*$/.exec(s)
  if (!m) return null
  const body = m[1].toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')
  if ([...body].some((c) => !CODE_ALPHABET.includes(c))) return null
  return `J-${body}`
}

/** Le code est-il bien formé, signe de contrôle compris ? (Une faute d'un seul signe le rend invalide.) */
export function codeValide(s: string): boolean {
  const c = normaliserCode(s)
  if (!c) return false
  const vals = [...c.slice(2, 2 + HASH_LEN)].map((x) => CODE_ALPHABET.indexOf(x))
  return checkOf(vals) === c[2 + HASH_LEN]
}

/**
 * Index code → fiches, pour une liste d'identifiants (fiches de l'appareil, ou du périmètre lu par le serveur). Un code qui
 * désigne plusieurs fiches y figure avec toutes : c'est un code PARTAGÉ (jamais résolu en un nom).
 */
export function indexCodes(ids: Iterable<string>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const id of ids) {
    const c = codeJoueur(id)
    const cur = out.get(c)
    if (cur) {
      if (!cur.includes(id)) cur.push(id)
    } else out.set(c, [id])
  }
  return out
}

/** Codes partagés par plusieurs fiches d'un index (à signaler). */
export const codesPartages = (index: Map<string, string[]>) => [...index].filter(([, ids]) => ids.length > 1).map(([c]) => c)

/** Morceau de texte après remplacement des codes : du texte, ou un joueur (nom retrouvé, code inconnu, code partagé, code faux). */
export type Morceau =
  | { k: 'texte'; t: string }
  | { k: 'joueur'; code: string; nom: string; id: string }
  | { k: 'code'; code: string; raison: 'inconnu' | 'partage' | 'invalide'; fiches?: number }

/**
 * Remplace les codes d'un texte par les noms, SUR L'APPAREIL : `index` (indexCodes des fiches de l'appareil) et `nomDe`
 * (identifiant → « Prénom Nom », ou undefined). Un code hors des fiches de l'appareil reste un code ; un code partagé reste un
 * code ; un code mal recopié (contrôle faux) reste un code. Aucun appel au réseau.
 */
export function remplacerCodes(texte: string, index: Map<string, string[]>, nomDe: (id: string) => string | undefined): Morceau[] {
  const out: Morceau[] = []
  let last = 0
  const push = (m: Morceau) => {
    const prev = out[out.length - 1]
    if (m.k === 'texte' && prev?.k === 'texte') prev.t += m.t
    else if (m.k !== 'texte' || m.t) out.push(m)
  }
  for (const m of texte.matchAll(CODE_PATTERN)) {
    const at = m.index ?? 0
    push({ k: 'texte', t: texte.slice(last, at) })
    last = at + m[0].length
    const code = normaliserCode(m[0])
    if (!code || !codeValide(code)) {
      push({ k: 'code', code: m[0], raison: 'invalide' })
      continue
    }
    const ids = index.get(code) ?? []
    if (ids.length > 1) push({ k: 'code', code, raison: 'partage', fiches: ids.length })
    else {
      const nom = ids.length ? nomDe(ids[0])?.trim() : undefined
      push(nom ? { k: 'joueur', code, nom, id: ids[0] } : { k: 'code', code, raison: 'inconnu' })
    }
  }
  push({ k: 'texte', t: texte.slice(last) })
  return out
}

/** Codes trouvés dans un texte, sans doublon : bien formés et faux (contrôle), pour le compte rendu du serveur. */
export function codesDuTexte(texte: string): { valides: string[]; invalides: string[] } {
  const valides = new Set<string>()
  const invalides = new Set<string>()
  for (const m of texte.matchAll(CODE_PATTERN)) {
    const c = normaliserCode(m[0])
    if (c && codeValide(c)) valides.add(c)
    else invalides.add(m[0])
  }
  return { valides: [...valides], invalides: [...invalides] }
}

/** Fiche telle que l'appareil la connaît (seuls ces champs servent). */
export interface FicheCode {
  id: string
  firstName?: string
  lastName?: string
  deleted?: boolean
  mergedInto?: string
  mergedFrom?: readonly { id?: string }[]
}

export interface IndexFiches {
  /** Code → fiches (plusieurs : code partagé, jamais résolu en un nom). */
  index: Map<string, string[]>
  /** Fiche (ou fiche fondue dans une autre) → « Prénom Nom » de la fiche qui reste. */
  nomDe: (id: string) => string | undefined
  /** Fiche (ou fiche fondue) → identifiant de la fiche qui reste. */
  ficheDe: (id: string) => string | undefined
  /** Fiches vivantes comptées. */
  fiches: number
}

/**
 * Index des codes des fiches de l'APPAREIL, pour remettre les noms dans un rapport : fiches vivantes, et fiches fondues (le
 * code d'une fiche fondue désigne la fiche qui reste, sans compter comme un code partagé avec elle).
 */
export function indexFiches(players: readonly FicheCode[]): IndexFiches {
  const index = new Map<string, string[]>()
  const nom = new Map<string, string>()
  const fiche = new Map<string, string>()
  const add = (id: string, cible: string, n: string) => {
    const c = codeJoueur(id)
    const cur = index.get(c)
    if (!cur) index.set(c, [id])
    else if (!cur.includes(id) && !cur.some((x) => fiche.get(x) === cible)) cur.push(id)
    nom.set(id, n)
    fiche.set(id, cible)
  }
  let fiches = 0
  for (const p of players) {
    if (p.deleted || p.mergedInto) continue
    fiches++
    const n = `${p.firstName ?? ''} ${p.lastName ?? ''}`.replace(/\s+/g, ' ').trim()
    add(p.id, p.id, n)
    for (const m of p.mergedFrom ?? []) if (m?.id && !nom.has(m.id)) add(m.id, p.id, n)
  }
  return { index, nomDe: (id) => nom.get(id), ficheDe: (id) => fiche.get(id), fiches }
}
