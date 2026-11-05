/*
 * Boîte « À valider » : règles PURES (ni Dexie, ni React, ni réseau), testées par tools/test-propositions.ts. L'accès à la
 * table (appareil et serveur) est dans src/propositions.ts ; la table du serveur : supabase/067_propositions.sql.
 *
 * Une PROPOSITION, c'est un tableau de mesures qui attend la validation du coach : gardé « pour plus tard » depuis « Coller un
 * tableau » (source « collage »), ou demain déposé par le serveur MCP avec le compte du coach (« mcp ») ou lu sur une photo
 * (« photo »). Ses lignes sont BRUTES (cellules telles qu'écrites, en-tête compris) : l'écran « À valider » (ImportReview,
 * src/components/ImportMesures.tsx) fait le rapprochement au moment d'ouvrir, sur l'appareil. Rien n'est écrit dans les
 * mesures avant la validation ; aucune IA n'est appelée.
 */

export type PropSource = 'collage' | 'mcp' | 'photo'
export type PropKind = 'mesures' | 'avis' | 'vus' | 'a_revoir'
export type PropEtat = 'en_attente' | 'validee' | 'partielle' | 'rejetee'

/** Sortes que cette version sait ouvrir (les autres attendent une version plus récente, sans compter dans la pastille). */
export const KNOWN_KINDS: readonly PropKind[] = ['mesures']

/** Mêmes bornes que le serveur (supabase/067_propositions.sql). */
export const LIMITS = {
  /** Lignes d'une proposition (en-tête compris). */
  lignes: 300,
  /** Taille des lignes (texte JSON). */
  octets: 200 * 1024,
  /** Taille du contexte (texte JSON). */
  contexte: 32 * 1024,
  /** Propositions en attente par compte. */
  enAttente: 30,
  /** Durée de vie d'une proposition en attente. */
  joursExpiration: 30,
  /** Une proposition traitée ou retirée est effacée après… */
  joursGarde: 7,
  /** Joueurs du contexte gardés avec la proposition (événement, groupe). */
  joueurs: 600,
  /** Titre. */
  titre: 80,
} as const

const DAY = 86_400_000

/** Choix déjà faits par le coach sur l'écran « À valider » (colonnes reliées, joueurs choisis, valeurs corrigées, décisions). */
export interface PropChoix {
  columns?: Record<number, unknown>
  players?: Record<number, string>
  values?: Record<string, string>
  decisions?: Record<string, string>
  /** Lignes cochées ou décochées à la main. */
  checks?: Record<number, boolean>
}

/** Contexte d'une proposition : où chercher les joueurs, date des tests, format lu, choix déjà faits. */
export interface PropContexte {
  portee?: 'evenement' | 'groupe' | 'tous'
  /** Identifiant de l'événement ou du groupe. */
  id?: string
  /** Nom de l'événement ou du groupe (affiché dans la boîte). */
  nom?: string
  /** Date des tests (AAAA-MM-JJ) ; une colonne Date du tableau l'emporte. */
  date?: string
  /** Format lu (« markdown », « tabulations »…, src/importMesures.ts). */
  format?: string
  /** Lignes venues du texte simple (colonnes posées par position). */
  libre?: boolean
  /** Joueurs du contexte au moment de garder (fiches), pour retrouver les mêmes candidats. */
  joueurs?: string[]
  choix?: PropChoix
}

/** Une ligne telle que déposée : liste de cellules, ou objet qui les porte (avec un rapprochement éventuel, ignoré ici). */
export type PropLigne = string[] | { cellules?: unknown; [k: string]: unknown }

/** Une proposition sur l'appareil (table Dexie « propositions »). Dates en millisecondes. */
export interface PropositionRow {
  id: string
  /** Compte à qui elle appartient (« » : version d'essai sans serveur). */
  owner: string
  source: PropSource
  kind: PropKind
  titre: string
  contexte: PropContexte
  lignes: PropLigne[]
  etat: PropEtat
  createdAt: number
  updatedAt: number
  expiresAt: number
  deletedAt?: number
  /** À envoyer au serveur. */
  dirty: 0 | 1
  /** Connue du serveur (sinon : à créer). */
  onServer: 0 | 1
  /** Dernier refus du serveur (boîte du compte pleine…) : gardée sur l'appareil en attendant. */
  sendError?: string
}

/** Une ligne de hb_propositions, telle que lue. */
export interface ServerProposition {
  id: string
  source: string
  kind: string
  titre: string
  contexte: unknown
  lignes: unknown
  etat: string
  created_at: string
  updated_at: string
  expires_at: string
  deleted_at: string | null
}

const SOURCES: readonly PropSource[] = ['collage', 'mcp', 'photo']
const KINDS: readonly PropKind[] = ['mesures', 'avis', 'vus', 'a_revoir']
const ETATS: readonly PropEtat[] = ['en_attente', 'validee', 'partielle', 'rejetee']

/** Taille en octets d'une valeur une fois en JSON (ce que le serveur compte). */
export const jsonBytes = (x: unknown) => new TextEncoder().encode(JSON.stringify(x ?? null)).length

/** Cellules d'une ligne (liste, ou objet { cellules }) ; autre chose : aucune. */
export function cellsOf(l: unknown): string[] {
  const raw = Array.isArray(l) ? l : l && typeof l === 'object' ? (l as { cellules?: unknown }).cellules : null
  return Array.isArray(raw) ? raw.map((c) => (c === null || c === undefined ? '' : String(c))) : []
}

/** Lignes d'une proposition en cellules texte (pour ImportReview) ; lignes vides retirées. */
export const rowsOf = (lignes: readonly unknown[]) => lignes.map(cellsOf).filter((r) => r.some((c) => c.trim()))

/** En attente (ni traitée, ni retirée, ni expirée) à l'instant `now`. */
export const isPending = (r: Pick<PropositionRow, 'etat' | 'deletedAt' | 'expiresAt'>, now: number) => r.etat === 'en_attente' && !r.deletedAt && r.expiresAt > now

/** Propositions en attente d'un compte, que cette version sait ouvrir, de la plus récente à la plus ancienne. */
export function pendingOf(rows: readonly PropositionRow[], owner: string, now: number): PropositionRow[] {
  return rows.filter((r) => r.owner === owner && KNOWN_KINDS.includes(r.kind) && isPending(r, now)).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}

/** Nombre montré par la pastille de l'en-tête (0 : pas de pastille). */
export const badgeCount = (rows: readonly PropositionRow[], owner: string, now: number) => pendingOf(rows, owner, now).length

/** Texte de la pastille : « 2 à valider » ; rien à valider : « ». */
export const badgeLabel = (n: number) => (n <= 0 ? '' : `${n > 99 ? '99+' : n} à valider`)

/** « 05/09 » d'une date AAAA-MM-JJ. */
const dayMonth = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')

/** Titre proposé quand on garde un tableau collé : « Tests du 05/09 · Pôle U15 ». */
export function defaultTitle(ctx: PropContexte): string {
  const d = dayMonth(ctx.date)
  const head = d ? `Tests du ${d}` : 'Tests'
  return clip(ctx.nom ? `${head} · ${ctx.nom}` : head, LIMITS.titre)
}

const clip = (s: string, n: number) => {
  const t = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() // eslint-disable-line no-control-regex
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/** D'où vient la proposition, en mots simples. */
export const SOURCE_LABEL: Record<PropSource, string> = { collage: 'collé', mcp: 'depuis Claude', photo: 'photo' }

/** Où sont cherchés les joueurs. */
export function porteeLabel(ctx: PropContexte): string {
  if (ctx.portee === 'evenement') return ctx.nom ? `événement « ${ctx.nom} »` : 'un événement'
  if (ctx.portee === 'groupe') return ctx.nom ? `groupe « ${ctx.nom} »` : 'un groupe'
  return 'toute la base'
}

/** Cellule qui ressemble à une valeur (« 1,86 », « 38 cm », « 1m86 ») plutôt qu'à un libellé (« Sprint 10 m (s) »). */
const looksValue = (c: string) => /^\s*[+-]?\d+([.,]\d+)?\s*(cm|mm|m|s|kg|km\/h|%)?\s*$/i.test(c) || /^\s*\d+\s*m\s*\d{1,2}\s*$/i.test(c)

/** Lignes de données (sans compter une première ligne d'en-tête, quand il y en a sans doute une : aucune valeur). */
export function dataLineCount(lignes: readonly unknown[]): number {
  const rows = rowsOf(lignes)
  if (!rows.length) return 0
  const head = rows[0].every((c) => !looksValue(c))
  return head && rows.length > 1 ? rows.length - 1 : rows.length
}

export interface KeepInput {
  rows: readonly (readonly string[])[]
  contexte: PropContexte
  titre?: string
  source?: PropSource
  kind?: PropKind
  /** Proposition déjà gardée qu'on met à jour (rouverte depuis la boîte) : ses choix et ses lignes. */
  id?: string
}

/**
 * Proposition à garder (nouvelle, ou mise à jour d'une proposition en attente) : lignes nettoyées, contexte borné, titre,
 * limites (lignes, taille, 30 en attente). Renvoie la ligne à écrire sur l'appareil, ou le message à montrer.
 */
export function planKeep(
  existing: readonly PropositionRow[],
  input: KeepInput,
  o: { owner: string; now: number; newId: () => string },
): { row: PropositionRow } | { error: string } {
  const lignes = input.rows.map((r) => r.map((c) => String(c ?? ''))).filter((r) => r.some((c) => c.trim()))
  if (!lignes.length) return { error: 'Rien à garder : le tableau est vide.' }
  if (lignes.length > LIMITS.lignes) return { error: `Tableau trop long : ${LIMITS.lignes} lignes au plus.` }
  if (jsonBytes(lignes) > LIMITS.octets) return { error: 'Tableau trop long (200 Ko au plus).' }
  const joueurs = input.contexte.joueurs?.slice(0, LIMITS.joueurs)
  const contexte: PropContexte = { ...input.contexte, ...(joueurs ? { joueurs } : {}) }
  if (jsonBytes(contexte) > LIMITS.contexte) delete contexte.joueurs
  if (jsonBytes(contexte) > LIMITS.contexte) delete contexte.choix
  const titre = clip(input.titre?.trim() || defaultTitle(contexte), LIMITS.titre) || 'Proposition'
  const prev = input.id ? existing.find((r) => r.id === input.id && r.owner === o.owner) : undefined
  if (prev && isPending(prev, o.now))
    return { row: { ...prev, titre, contexte, lignes, updatedAt: Math.max(o.now, prev.updatedAt + 1), dirty: 1, sendError: undefined } }
  if (pendingOf(existing, o.owner, o.now).length >= LIMITS.enAttente)
    return { error: `La boîte « À valider » est pleine (${LIMITS.enAttente} en attente) : valide ou rejette d’abord celles qui attendent.` }
  return {
    row: {
      id: o.newId(),
      owner: o.owner,
      source: input.source ?? 'collage',
      kind: input.kind ?? 'mesures',
      titre,
      contexte,
      lignes,
      etat: 'en_attente',
      createdAt: o.now,
      updatedAt: o.now,
      expiresAt: o.now + LIMITS.joursExpiration * DAY,
      dirty: 1,
      onServer: 0,
    },
  }
}

/** Nouvel état (validée, en partie, rejetée, ou de nouveau en attente après « Défaire »). */
export function planEtat(r: PropositionRow, etat: PropEtat, now: number): PropositionRow {
  return { ...r, etat, updatedAt: Math.max(now, r.updatedAt + 1), dirty: 1 }
}

/** Retirée de la boîte (effacée pour de vrai 7 jours plus tard). */
export function planDelete(r: PropositionRow, now: number): PropositionRow {
  return { ...r, deletedAt: now, updatedAt: Math.max(now, r.updatedAt + 1), dirty: 1 }
}

/**
 * État après « Enregistrer N mesures » : `lignes` = lignes du tableau qui portaient au moins une valeur, `enregistrees` =
 * celles dont au moins une mesure a été écrite. Toutes : validée ; une partie : validée en partie ; aucune : toujours en attente.
 */
export function etatApresValidation(x: { lignes: number; enregistrees: number }): PropEtat {
  if (x.enregistrees <= 0) return 'en_attente'
  return x.enregistrees >= x.lignes ? 'validee' : 'partielle'
}

/** Libellé neutre d'un état. */
export const ETAT_LABEL: Record<PropEtat, string> = { en_attente: 'en attente', validee: 'validée', partielle: 'validée en partie', rejetee: 'rejetée' }

/** Ce qui part vers le serveur (le serveur pose lui-même le compte et les dates de création et d'expiration). */
export function toServer(r: PropositionRow) {
  return {
    id: r.id,
    source: r.source,
    kind: r.kind,
    titre: r.titre,
    contexte: r.contexte,
    lignes: r.lignes,
    etat: r.etat,
    deleted_at: r.deletedAt ? new Date(r.deletedAt).toISOString() : null,
  }
}

const ms = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : NaN
  return Number.isFinite(t) ? t : undefined
}

/**
 * Ligne du serveur → ligne de l'appareil. Une version locale pas encore envoyée et plus récente l'emporte (null : rien à
 * écrire) ; valeurs inconnues (source, sorte, état) : ligne ignorée.
 */
export function fromServer(s: ServerProposition, local: PropositionRow | undefined, owner: string): PropositionRow | null {
  const source = SOURCES.find((x) => x === s.source)
  const kind = KINDS.find((x) => x === s.kind)
  const etat = ETATS.find((x) => x === s.etat)
  const createdAt = ms(s.created_at)
  const updatedAt = ms(s.updated_at)
  const expiresAt = ms(s.expires_at)
  if (!source || !kind || !etat || createdAt === undefined || updatedAt === undefined || expiresAt === undefined || !Array.isArray(s.lignes)) return null
  if (local?.dirty && local.updatedAt >= updatedAt) return null
  const ctx = s.contexte && typeof s.contexte === 'object' && !Array.isArray(s.contexte) ? (s.contexte as PropContexte) : {}
  const deletedAt = ms(s.deleted_at)
  return {
    id: s.id,
    owner,
    source,
    kind,
    titre: String(s.titre ?? '') || 'Proposition',
    contexte: ctx,
    lignes: s.lignes as PropLigne[],
    etat,
    createdAt,
    updatedAt,
    expiresAt,
    ...(deletedAt !== undefined ? { deletedAt } : {}),
    dirty: 0,
    onServer: 1,
  }
}

/**
 * Relecture du serveur : à partir des dates de modification du serveur (`meta` : toutes les propositions du compte) et
 * des lignes de l'appareil, ce qu'il faut relire en entier (nouvelles ou changées) et ce qu'il faut oublier (connues du
 * serveur, pas modifiées ici, et qui n'y sont plus : effacées par la purge ou depuis un autre appareil).
 */
export function planPull(local: readonly PropositionRow[], meta: readonly { id: string; updated_at: string }[], owner: string): { fetch: string[]; forget: string[] } {
  const mine = local.filter((r) => r.owner === owner)
  const byId = new Map(mine.map((r) => [r.id, r]))
  const fetch: string[] = []
  for (const m of meta) {
    const l = byId.get(m.id)
    const t = ms(m.updated_at)
    if (!l || (t !== undefined && t > l.updatedAt && !(l.dirty && l.updatedAt >= t)) || (l && !l.onServer)) fetch.push(m.id)
  }
  const onServer = new Set(meta.map((m) => m.id))
  const forget = mine.filter((r) => r.onServer && !r.dirty && !onServer.has(r.id)).map((r) => r.id)
  return { fetch, forget }
}

/** Lignes de l'appareil à effacer d'elles-mêmes : traitées ou retirées depuis 7 jours, expirées (comme la purge du serveur). */
export function expiredLocal(rows: readonly PropositionRow[], now: number): string[] {
  const keep = LIMITS.joursGarde * DAY
  return rows
    .filter((r) => !r.dirty && (r.expiresAt < now || ((r.etat !== 'en_attente' || r.deletedAt) && r.updatedAt < now - keep)))
    .map((r) => r.id)
}
