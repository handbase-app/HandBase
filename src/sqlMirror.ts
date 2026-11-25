// « Poser une question », mode avancé : COPIE LOCALE JETABLE des données de l'appareil, en tables plates et simples, pour
// exécuter dans le navigateur (SQLite WASM, src/sqlWorker.ts) la requête SQL rendue par le modèle quand la recette
// (src/recipe.ts) ne sait pas répondre. Fonctions pures (testées par tools/test-sql.ts) : aucune base, aucun écran.
//  - buildMirrorTables : tables construites depuis ce que l'appareil a déjà (Dexie, donc les droits de l'utilisateur :
//    joueurs, « vu », avis, notes, critères, mesures, événements, groupes visibles, noms du staff). Pas de commentaires ni de
//    textes libres des coachs (points forts, axes, notes de fiche, commentaires de mesure) : jamais copiés.
//  - loadMirror : crée les tables dans une base SQLite EN MÉMOIRE, les remplit, ajoute sans_accents(), puis la passe en
//    lecture seule (PRAGMA query_only = 1). C'est une copie : IndexedDB et Supabase ne sont jamais touchés.
//  - buildSqlSchema : DESCRIPTION des tables envoyée au modèle avec la phrase (colonnes, valeurs possibles : postes,
//    catégories et critères des réglages, types d'événements, date du jour). Aucune donnée, aucun nom de joueur, de club,
//    de lieu, de groupe, d'événement ou de personne.
// Aucune importation à l'exécution hors src/nameMatch.ts : le Web Worker reste léger.

import { nameKey } from './nameMatch'

export type Cell = string | number | null
export type MirrorTable = { name: string; columns: string[]; rows: Cell[][] }

/** Joueur : champs copiés (fiches complètes acceptées). */
export type MPlayer = {
  id: string
  firstName: string
  lastName: string
  birthDate?: string
  sex?: string
  position?: string
  secondaryPositions?: string[]
  laterality?: string
  club?: string
  poles?: { from?: string; to?: string; name?: string; regionId?: string; site?: string }[]
  deleted?: boolean
  mergedInto?: string
  review?: string
  updatedAt?: number
  /** Lus seulement par deptOf (département), jamais copiés. */
  clubCode?: string
  license?: string
  department?: string
}
/** Passage : joueur vu ce jour-là, à cet événement (ou ce jour d'observation), par cette personne du staff (identifiant). */
export type MSight = { playerId: string; day: string; event: string; person: string }
export type MEval = {
  id: string
  playerId: string
  eventId?: string
  contextType?: string
  review?: string
  observer?: string
  observerId?: string
  date: string
  scores: Record<string, number | string>
  deleted?: boolean
  updatedAt?: number
}
export type MMeasure = { playerId: string; criterionId: string; value: number | string; date: string; updatedAt?: number; deleted?: boolean }
export type MCriterion = { id: string; label: string; category: string; kind: string; scale: string; unit?: string; deleted?: boolean; active?: boolean; updatedAt?: number }
export type MEvent = { id: string; name: string; type?: string; date?: string; place?: string; playerIds?: string[]; deleted?: boolean; updatedAt?: number }
export type MGroup = { id: string; name: string; playerIds: string[]; deleted?: boolean; updatedAt?: number }

export type MirrorInput = {
  players: MPlayer[]
  sights: MSight[]
  evals: MEval[]
  measures: MMeasure[]
  criteria: MCriterion[]
  /** Groupes VISIBLES par l'utilisateur seulement. */
  groups: MGroup[]
  events: MEvent[]
  deptOf: (p: MPlayer) => string | undefined
  regionOf: (dept: string) => string | undefined
  regionName: (id: string) => string
  deptName: (code: string) => string
  zoneOf?: (category: string) => string | null | undefined
  /** Nom affiché d'une personne du staff (lu sur l'appareil). */
  staffName: (id: string) => string
  today: string
}

const HEIGHT_ID = 'taille'
const isScore = (s: string) => s === 'score5' || s === 'score3' || s === 'score2'
const usable = (c: MCriterion) => !c.deleted && c.active !== false
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(v)
  return m ? Number(m[1].replace(',', '.')) : null
}
const day = (s: string | undefined) => (!s ? null : s.length <= 10 ? s : new Date(Date.parse(s)).toLocaleDateString('sv'))
const txt = (s: string | undefined | null) => (s && s.trim() ? s.trim() : null)

/** Sur 5 (1 → 5) : comme la recette (src/recipe.ts buildIndex) ; hors échelle : null. */
function normTo5(scale: string, v: number): number | null {
  const [lo, hi] = scale === 'score5' ? [1, 5] : scale === 'score3' ? [0, 3] : [0, 2]
  if (v < lo || v > hi) return null
  return scale === 'score5' ? v : Math.round((1 + ((v - lo) * 4) / (hi - lo)) * 1000) / 1000
}

function poleOf(p: MPlayer, today: string): 'en_cours' | 'passe' | null {
  const ps = (p.poles ?? []).filter((x) => x.from || x.to || x.name || x.regionId || x.site)
  if (!ps.length) return null
  return ps.some((x) => (!x.from || x.from <= today) && (!x.to || x.to >= today)) ? 'en_cours' : 'passe'
}

/** Signature des données (nombres de lignes, dernière modification) : la copie est refaite quand elle change. */
export function mirrorSignature(i: Pick<MirrorInput, 'players' | 'sights' | 'evals' | 'measures' | 'criteria' | 'groups' | 'events'>): string {
  const last = (xs: { updatedAt?: number }[]) => {
    let m = 0
    for (const x of xs) if ((x.updatedAt ?? 0) > m) m = x.updatedAt ?? 0
    return m
  }
  return [i.players, i.evals, i.measures, i.criteria, i.groups, i.events].map((xs) => `${xs.length}:${last(xs)}`).join('|') + `|${i.sights.length}`
}

/** Tables plates de la copie (lignes prêtes à insérer). */
export function buildMirrorTables(input: MirrorInput): MirrorTable[] {
  const players = input.players.filter((p) => !p.deleted && !p.mergedInto && p.review !== 'refused')
  const known = new Set(players.map((p) => p.id))
  const criteria = input.criteria.filter(usable)
  const critById = new Map(criteria.map((c) => [c.id, c]))

  // Noms du staff : un nom par personne, rendu unique (deux personnes du même nom : « Nom (2) »).
  const staffOf = new Map<string, string>()
  const taken = new Map<string, number>()
  const staff = (id: string | undefined) => {
    const key = id?.trim()
    if (!key || key === '?') return null
    let n = staffOf.get(key)
    if (n) return n
    const base = (input.staffName(key) || 'Personne du staff').slice(0, 80)
    const k = taken.get(base) ?? 0
    taken.set(base, k + 1)
    n = k ? `${base} (${k + 1})` : base
    staffOf.set(key, n)
    return n
  }

  // Taille : dernière mesure « taille ».
  const heights = new Map<string, { v: number; d: string; u: number }>()
  const mesures: Cell[][] = []
  for (const m of input.measures) {
    if (m.deleted || !known.has(m.playerId) || !critById.has(m.criterionId)) continue
    const v = num(m.value)
    if (v === null) continue
    mesures.push([m.playerId, m.criterionId, v, day(m.date)])
    if (m.criterionId === HEIGHT_ID) {
      const cur = heights.get(m.playerId)
      const u = m.updatedAt ?? 0
      if (!cur || m.date > cur.d || (m.date === cur.d && u > cur.u)) heights.set(m.playerId, { v, d: m.date, u })
    }
  }

  const joueurs: Cell[][] = players.map((p) => {
    const dept = input.deptOf(p)
    const region = dept ? input.regionOf(dept) : undefined
    const year = /^\d{4}/.test(p.birthDate ?? '') ? Number(p.birthDate!.slice(0, 4)) : null
    return [
      p.id,
      txt(p.lastName),
      txt(p.firstName),
      txt(p.birthDate?.slice(0, 10)),
      year,
      p.sex === 'M' || p.sex === 'F' ? p.sex : null,
      p.position ?? null,
      p.secondaryPositions?.length ? p.secondaryPositions.join(',') : null,
      p.laterality ?? null,
      txt(p.club),
      dept ?? null,
      dept ? input.deptName(dept) : null,
      region ? input.regionName(region) : null,
      heights.get(p.id)?.v ?? null,
      poleOf(p, input.today),
    ]
  })

  const vus: Cell[][] = []
  for (const s of input.sights) if (known.has(s.playerId)) vus.push([s.playerId, s.event, staff(s.person), s.day])

  const avis: Cell[][] = []
  const notes: Cell[][] = []
  for (const e of input.evals) {
    if (e.deleted || e.review === 'refused' || !known.has(e.playerId)) continue
    const valide = (e.review ?? 'validated') === 'validated' ? 1 : 0
    const d = day(e.date)
    avis.push([e.id, e.playerId, e.eventId ?? null, staff(e.observerId || e.observer), d, valide, e.contextType ?? null])
    for (const cid in e.scores) {
      const c = critById.get(cid)
      const v = e.scores[cid]
      // Notes chiffrées des critères d'avis seulement (jamais de texte libre).
      if (!c || c.kind !== 'subjective' || !isScore(c.scale) || typeof v !== 'number' || !Number.isFinite(v)) continue
      const n5 = normTo5(c.scale, v)
      if (n5 === null) continue
      notes.push([e.id, e.playerId, cid, v, n5, d, valide])
    }
  }

  const criteres: Cell[][] = criteria.map((c) => [
    c.id,
    c.label,
    c.category,
    input.zoneOf?.(c.category) ?? null,
    c.scale,
    c.kind === 'subjective' && isScore(c.scale) ? 'avis' : c.kind === 'factual' ? 'mesure' : 'autre',
    c.unit ?? null,
  ])

  // Événements : département le plus fréquent de leurs joueurs (le lieu est un texte libre).
  const deptOfPlayer = new Map<string, string>()
  joueurs.forEach((r) => r[10] && deptOfPlayer.set(r[0] as string, r[10] as string))
  const members = new Map<string, Set<string>>()
  for (const e of input.events) if (!e.deleted) members.set(e.id, new Set((e.playerIds ?? []).filter((id) => known.has(id))))
  for (const s of input.sights) members.get(s.event)?.add(s.playerId)
  const evenements: Cell[][] = []
  const evJoueurs: Cell[][] = []
  for (const e of input.events) {
    if (e.deleted) continue
    const ps = [...(members.get(e.id) ?? [])].filter((id) => known.has(id))
    const count = new Map<string, number>()
    for (const id of ps) {
      const d = deptOfPlayer.get(id)
      if (d) count.set(d, (count.get(d) ?? 0) + 1)
    }
    const top = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    evenements.push([e.id, txt(e.name), e.type ?? null, day(e.date), txt(e.place), top])
    for (const id of ps) evJoueurs.push([e.id, id])
  }

  const groupes: Cell[][] = []
  const groupeJoueurs: Cell[][] = []
  for (const g of input.groups) {
    if (g.deleted) continue
    groupes.push([g.id, txt(g.name)])
    for (const id of new Set(g.playerIds)) if (known.has(id)) groupeJoueurs.push([g.id, id])
  }

  return [
    { name: 'joueurs', columns: JOUEURS_COLS, rows: joueurs },
    { name: 'vus', columns: ['joueur_id', 'evenement_id', 'staff', 'date'], rows: vus },
    { name: 'avis', columns: ['id', 'joueur_id', 'evenement_id', 'auteur', 'date', 'valide', 'contexte'], rows: avis },
    { name: 'notes', columns: ['avis_id', 'joueur_id', 'critere_id', 'valeur', 'note_sur5', 'date', 'valide'], rows: notes },
    { name: 'criteres', columns: ['id', 'libelle', 'categorie', 'zone_radar', 'echelle', 'type', 'unite'], rows: criteres },
    { name: 'mesures', columns: ['joueur_id', 'critere_id', 'valeur', 'date'], rows: mesures },
    { name: 'evenements', columns: ['id', 'nom', 'type', 'date', 'lieu', 'departement'], rows: evenements },
    { name: 'evenement_joueurs', columns: ['evenement_id', 'joueur_id'], rows: evJoueurs },
    { name: 'groupes', columns: ['id', 'nom'], rows: groupes },
    { name: 'groupe_joueurs', columns: ['groupe_id', 'joueur_id'], rows: groupeJoueurs },
    { name: 'staff', columns: ['nom'], rows: [...new Set(staffOf.values())].map((n) => [n]) },
  ]
}

const JOUEURS_COLS = ['id', 'nom', 'prenom', 'naissance', 'annee', 'sexe', 'poste', 'postes_secondaires', 'lateralite', 'club', 'departement', 'departement_nom', 'region', 'taille_cm', 'pole']

/** Types SQLite des colonnes (le reste : TEXT). */
const TYPES: Record<string, string> = { annee: 'INTEGER', taille_cm: 'REAL', valeur: 'REAL', note_sur5: 'REAL', valide: 'INTEGER' }
const INDEXES = [
  'CREATE INDEX vus_joueur ON vus(joueur_id)',
  'CREATE INDEX avis_joueur ON avis(joueur_id)',
  'CREATE INDEX notes_joueur ON notes(joueur_id)',
  'CREATE INDEX notes_critere ON notes(critere_id)',
  'CREATE INDEX mesures_joueur ON mesures(joueur_id, critere_id)',
  'CREATE INDEX evj_joueur ON evenement_joueurs(joueur_id)',
  'CREATE INDEX gj_joueur ON groupe_joueurs(joueur_id)',
]

/** Sous-ensemble de la base sql.js utilisé ici (même forme dans le navigateur et dans les tests). */
export type MirrorDb = {
  run(sql: string, params?: Cell[]): unknown
  prepare(sql: string): { run(params?: Cell[]): void; free(): unknown }
  create_function(name: string, fn: (...args: never[]) => unknown): unknown
}

/** Sans accents, minuscules (comme la recherche par nom, src/nameMatch.ts) : sans_accents(prenom) = 'lucas'. */
export const sansAccents = (v: unknown) => (typeof v === 'string' ? nameKey(v) : v === null || v === undefined ? null : nameKey(String(v)))

/** Crée et remplit la copie (base vide en mémoire), puis la passe en lecture seule. */
export function loadMirror(db: MirrorDb, tables: MirrorTable[]): void {
  db.create_function('sans_accents', sansAccents as (...args: never[]) => unknown)
  db.run('BEGIN')
  for (const t of tables) {
    const pk = t.columns[0] === 'id' ? ' PRIMARY KEY' : ''
    db.run(`CREATE TABLE ${t.name} (${t.columns.map((c, i) => `${c} ${TYPES[c] ?? 'TEXT'}${i === 0 ? pk : ''}`).join(', ')})`)
    const st = db.prepare(`INSERT ${pk ? 'OR IGNORE ' : ''}INTO ${t.name} VALUES (${t.columns.map(() => '?').join(', ')})`)
    try {
      for (const r of t.rows) st.run(r)
    } finally {
      st.free()
    }
  }
  for (const i of INDEXES) db.run(i)
  db.run('COMMIT')
  db.run('PRAGMA query_only = 1')
}

// ---------- Description envoyée au modèle ----------

const MAX_NAMES = 80

export type SqlSchemaContext = {
  criteria: MCriterion[]
  positions: { id: string; label: string }[]
  zoneOf?: (category: string) => string | null | undefined
  today: string
}

/** Description des tables (une entrée par table, plus les règles) : AUCUNE donnée. */
export function buildSqlSchema(ctx: SqlSchemaContext): Record<string, string> {
  const y = Number(ctx.today.slice(0, 4))
  const start = Number(ctx.today.slice(5, 7)) >= 9 ? y : y - 1
  const cs = ctx.criteria.filter(usable)
  const avisCs = cs.filter((c) => c.kind === 'subjective' && isScore(c.scale))
  const mesCs = cs.filter((c) => c.kind === 'factual' && (c.scale === 'number' || isScore(c.scale)))
  const cats = [...new Set(avisCs.map((c) => c.category))]
  const names = (xs: MCriterion[]) => (xs.length <= MAX_NAMES ? xs.map((c) => `${c.label}${c.unit ? ` (${c.unit})` : ''}`).join(' | ') : 'libellé tel que dit')
  return {
    aujourdhui: `${ctx.today} ; saison en cours du ${start}-09-01 au ${start + 1}-08-31 (une saison va du 1er septembre au 31 août)`,
    joueurs:
      'id, nom, prenom, naissance (AAAA-MM-JJ), annee (entier), sexe (M ou F), poste (code), postes_secondaires (codes séparés par des virgules), lateralite (droitier | gaucher | ambidextre), club (nom), departement (numéro, ex. 83), departement_nom, region (nom), taille_cm (dernière taille mesurée), pole (en_cours | passe | NULL : Pôle Espoirs)',
    postes: ctx.positions.map((p) => `${p.id} (${p.label.toLowerCase()})`).join(', '),
    vus: 'joueur_id, evenement_id (ou « jour:AAAA-MM-JJ » pour un avis hors événement), staff (nom de la personne du staff qui l’a vu), date (AAAA-MM-JJ) : une ligne par passage (marqué vu ou avis écrit)',
    avis: 'id, joueur_id, evenement_id (NULL hors événement), auteur (nom de la personne du staff), date, valide (1 : compte dans les moyennes ; 0 : en attente), contexte (unss | club | match | selection | video | autre | NULL)',
    notes: 'avis_id, joueur_id, critere_id, valeur (note brute), note_sur5 (note ramenée sur 5, à utiliser pour les moyennes), date, valide (comme avis.valide)',
    criteres: 'id, libelle, categorie, zone_radar, echelle (score5 | score3 | score2 | number), type (avis | mesure), unite',
    categoriesAvis: cats.join(' | ') || 'aucune',
    criteresAvis: names(avisCs) || 'aucun',
    criteresMesures: names(mesCs) || 'aucun',
    mesures: 'joueur_id, critere_id, valeur (nombre), date : tests physiques et mesures (la taille a le critère id « taille »)',
    evenements: 'id, nom, type (match | tournoi | entrainement | observation), date, lieu, departement (le plus fréquent de ses joueurs)',
    evenement_joueurs: 'evenement_id, joueur_id (joueurs de la liste de l’événement ou vus à cet événement)',
    groupes: 'id, nom ; groupe_joueurs : groupe_id, joueur_id',
    staff: 'nom (personnes du staff qui ont vu des joueurs ou écrit des avis)',
    fonctions: 'sans_accents(texte) : minuscules sans accents, pour comparer des noms, prénoms, clubs, régions, catégories ou libellés (ex. sans_accents(prenom) = \'lucas\', sans_accents(club) LIKE \'%toulon%\')',
  }
}
