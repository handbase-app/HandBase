/*
 * Configuration du sport de l'installation (supabase/044_structure.sql, table hb_config).
 *
 * Une installation = un client = une base Supabase à part. Le sport et ses postes sont des DONNÉES de l'installation.
 * Sport : la ligne « sport » de la table ; sans elle, VITE_SPORT (construction, démo, version d'essai : « volley ») ;
 * sinon HANDBALL : table vide ou absente (script 044 pas encore passé), l'appli marche à l'identique. Les CODES de postes
 * (GB, AG, ARG… ; volley : P, R4, C, PT) sont ceux écrits dans les fiches : ils ne changent jamais ; les libellés, l'ordre
 * et la famille (gardien / champ ; volley : libéro / autre poste) se règlent, et un poste proposé par le sport s'ajoute
 * (volley : le libéro).
 *
 * Fichier pur (ni Dexie ni React) : importable par les tests (npx jiti) et par les modules de calcul (recette, critères).
 * src/installation.ts lit la table et appelle applySportConfig() ; tous les écrans lisent POSITIONS, tenu à jour ici.
 */

/** Codes des postes du handball (valeurs stockées dans les fiches). */
export type HandballPosition = 'GB' | 'AG' | 'ARG' | 'DC' | 'ARD' | 'AD' | 'PIV'
/** Codes des postes du volley (P, R4, C, PT par défaut ; L, le libéro, quand l'installation l'ajoute). */
export type VolleyPosition = 'P' | 'R4' | 'C' | 'PT' | 'L'

/**
 * Code d'un poste, tel qu'écrit dans les fiches. Les codes sont des DONNÉES de l'installation (Réglages → « Structure et
 * sport ») : tout code valide (CODE_RE) est accepté ; les codes connus du handball et du volley restent proposés par
 * l'éditeur (`string & {}` garde l'autocomplétion sans refuser les autres). Les tables qui doivent couvrir TOUS les postes
 * d'un sport se typent sur HandballPosition ou VolleyPosition (ex. src/demo.ts).
 */
export type Position = HandballPosition | VolleyPosition | (string & {})

/**
 * Famille d'un poste : « gardien » = le poste à part du sport, évalué sur ses propres critères (handball : le gardien ;
 * volley : le libéro, s'il est ajouté) ; « champ » = les autres. Le nom affiché de chaque famille dépend du sport
 * (familyLabel) ; la valeur stockée reste « gardien » / « champ » (compatibilité des fiches et de hb_config).
 */
export type PositionFamily = 'gardien' | 'champ'

/** Un poste tel que réglé dans l'installation. */
export interface PositionDef {
  /** Code stocké dans les fiches (GB, AG…) : jamais modifié. */
  code: string
  /** Libellé (« Ailier gauche »). */
  label: string
  /** Libellé court (« Ailier G. »). */
  short: string
  /** En toutes lettres pour les exports (« Gardien de but ») ; sinon le libellé. */
  full?: string
  family: PositionFamily
  order: number
}

export interface SportConfig {
  /** Identifiant du sport (handball, volley…) : choisit aussi le terrain, les fonctions propres et le vocabulaire de dictée (src/dictation/vocabulary.ts). */
  sport: string
  /** Nom affiché (« Handball »). */
  sportName: string
  positions: PositionDef[]
}

/** Handball : valeurs par défaut, identiques aux anciennes constantes du code (src/db.ts, src/groupExport.ts). */
export const HANDBALL: SportConfig = {
  sport: 'handball',
  sportName: 'Handball',
  positions: [
    { code: 'GB', label: 'Gardien', short: 'Gardien', full: 'Gardien de but', family: 'gardien', order: 1 },
    { code: 'AG', label: 'Ailier gauche', short: 'Ailier G.', family: 'champ', order: 2 },
    { code: 'ARG', label: 'Arrière gauche', short: 'Arrière G.', family: 'champ', order: 3 },
    { code: 'DC', label: 'Demi-centre', short: 'Demi-centre', family: 'champ', order: 4 },
    { code: 'ARD', label: 'Arrière droit', short: 'Arrière D.', family: 'champ', order: 5 },
    { code: 'AD', label: 'Ailier droit', short: 'Ailier D.', family: 'champ', order: 6 },
    { code: 'PIV', label: 'Pivot', short: 'Pivot', family: 'champ', order: 7 },
  ],
}

/**
 * Volley (salle) : 4 postes par défaut. Le libéro (LIBERO, plus bas) n'en fait pas partie : une installation l'ajoute dans
 * Réglages → « Structure et sport » si elle le souhaite. Codes courts = étiquettes du terrain (src/components/CourtPicker.tsx).
 */
export const VOLLEYBALL: SportConfig = {
  sport: 'volley',
  sportName: 'Volley',
  positions: [
    { code: 'P', label: 'Passeur', short: 'Passeur', full: 'Passeur', family: 'champ', order: 1 },
    { code: 'R4', label: 'Réceptionneur-attaquant', short: 'R4', full: 'Réceptionneur-attaquant', family: 'champ', order: 2 },
    { code: 'C', label: 'Central', short: 'Central', full: 'Central', family: 'champ', order: 3 },
    { code: 'PT', label: 'Pointu', short: 'Pointu', full: 'Pointu (opposé)', family: 'champ', order: 4 },
  ],
}

/** Libéro : poste à part (famille « gardien » : ses propres critères), proposé à l'ajout, absent des postes par défaut. */
export const LIBERO: PositionDef = { code: 'L', label: 'Libéro', short: 'Libéro', full: 'Libéro', family: 'gardien', order: 5 }

/** Fonctions propres à un sport (masquées ailleurs). */
export type SportFeature =
  /** Import des licences depuis un export Gest'Hand (src/importLicences.ts, Réglages). */
  | 'licencesGestHand'
  /** Feuille de match électronique FFHB en PDF (src/matchSheet.ts, MatchSheet.tsx, sheetTeams.ts ; aussi côté joueur). */
  | 'feuilleMatchFFHB'

/**
 * Ce qui accompagne un sport sans être réglable dans hb_config : vocabulaire, fonctions propres, familles de postes.
 * Les contenus (critères, tests, actions du séquenceur) sont rangés par sport dans src/sportContent.ts.
 */
export interface SportProfile {
  config: SportConfig
  /** Le mot courant, au masculin : « le hand », « mon journal du volley ». */
  word: string
  /** Fédération (nom par défaut de l'unité racine d'un import de structure). */
  federation: string
  features: readonly SportFeature[]
  /** Noms affichés des familles (Réglages : bouton de chaque poste) et aide. */
  families: Record<PositionFamily, string>
  familyHint: string
  /**
   * Moyennes par catégorie sans postes réglés sur les critères (src/recipe.ts) : familles de catégories (radarZones
   * categoryKind) où le poste à part, puis les autres postes, ne sont pas classés.
   */
  specialSkips: readonly string[]
  othersSkip: readonly string[]
  /** Postes proposés à l'ajout dans les réglages, hors postes par défaut (volley : le libéro). */
  extraPositions: readonly PositionDef[]
}

export const SPORTS: Record<string, SportProfile> = {
  handball: {
    config: HANDBALL,
    word: 'hand',
    federation: 'Fédération française de handball',
    features: ['licencesGestHand', 'feuilleMatchFFHB'],
    families: { gardien: 'Gardien', champ: 'Champ' },
    familyHint: 'Famille : un gardien n’est pas évalué sur les critères des joueurs de champ',
    specialSkips: ['defense', 'attaque'],
    othersSkip: ['gardien', 'gardien-arrets'],
    extraPositions: [],
  },
  volley: {
    config: VOLLEYBALL,
    word: 'volley',
    federation: 'Fédération française de volley',
    features: [],
    families: { gardien: 'Libéro', champ: 'Autre poste' },
    familyHint: 'Famille : le libéro a ses propres critères (pas classé en attaque)',
    // Le libéro défend mais n'attaque pas ; les autres postes ne sont pas classés sur une catégorie du libéro (« Libéro » :
    // famille « gardien » de src/radarZones.ts, comme « Spécifique gardien » au handball).
    specialSkips: ['attaque'],
    othersSkip: ['gardien'],
    extraPositions: [LIBERO],
  },
}

/** Identifiant de sport reconnu (« volleyball », « Volley-ball » → volley) ; undefined sinon. */
export function knownSport(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim().toLowerCase().replace(/[\s_-]+/g, '')
  if (s === 'volley' || s === 'volleyball') return 'volley'
  if (s === 'handball' || s === 'hand') return 'handball'
  return undefined
}

/** Variable de construction VITE_SPORT (build, démo, version d'essai) ; sous les tests (jiti) : l'environnement. */
const envSport = (): string | undefined => {
  try {
    return import.meta.env?.VITE_SPORT as string | undefined
  } catch {
    return undefined
  }
}

/** Sport par défaut de l'installation quand hb_config n'a pas de ligne « sport » : VITE_SPORT reconnu, sinon handball. */
export const defaultSportId = (env: unknown = envSport()) => knownSport(env) ?? 'handball'

/** Profil d'un sport ; un sport inconnu (réglé dans hb_config) : aucune fonction propre, terrain et postes du handball. */
export function sportProfile(sport: string = current.sport): SportProfile {
  return (
    SPORTS[sport] ?? {
      ...SPORTS.handball,
      word: sport,
      federation: 'Fédération',
      features: [],
      families: { gardien: 'Poste à part', champ: 'Autre poste' },
      familyHint: 'Famille : le poste à part a ses propres critères',
    }
  )
}

/** Clés de la table hb_config (identifiant de ligne = clé). */
export const CONFIG_KEYS = { sport: 'sport', positions: 'postes' } as const

/** Ligne de la table hb_config : une clé, une valeur (jsonb). */
export interface ConfigRow {
  id: string
  key: string
  value: unknown
  deleted?: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 60) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
export const CODE_RE = /^[A-Za-z0-9_-]{1,12}$/

/** Postes lus dans une valeur stockée ; invalides ignorés, doublons de code écartés ; null si rien d'utilisable. */
export function cleanPositions(v: unknown): PositionDef[] | null {
  if (!Array.isArray(v)) return null
  const seen = new Set<string>()
  const out: PositionDef[] = []
  v.forEach((x, i) => {
    if (!isObj(x)) return
    const code = typeof x.code === 'string' ? x.code.trim() : ''
    const label = text(x.label)
    if (!CODE_RE.test(code) || seen.has(code) || !label) return
    seen.add(code)
    const full = text(x.full)
    out.push({
      code,
      label,
      short: text(x.short, 30) ?? label,
      ...(full ? { full } : {}),
      family: x.family === 'gardien' ? 'gardien' : 'champ',
      order: typeof x.order === 'number' && Number.isFinite(x.order) ? x.order : i + 1,
    })
  })
  return out.length ? out.sort((a, b) => a.order - b.order) : null
}

/**
 * Configuration de l'installation. Le sport : la ligne « sport » de la table quand elle existe, sinon `fallbackSport`
 * (VITE_SPORT reconnu, sinon handball). Postes : la ligne « postes », sinon ceux du sport. Ce qui manque ou est illisible
 * garde la valeur par défaut. Sport inconnu : postes du handball (à régler dans la table).
 */
export function resolveSportConfig(rows: readonly ConfigRow[] = [], fallbackSport: string = defaultSportId()): SportConfig {
  const get = (key: string) => rows.find((r) => !r.deleted && (r.key ?? r.id) === key)?.value
  const sport = get(CONFIG_KEYS.sport)
  const raw = (isObj(sport) && text(sport.sport, 30)) || fallbackSport
  const id = knownSport(raw) ?? raw
  const known = SPORTS[id]?.config
  const base = known ?? HANDBALL
  const positions = cleanPositions(get(CONFIG_KEYS.positions))
  return {
    sport: id,
    sportName: (isObj(sport) && text(sport.sportName)) || (known ? known.sportName : id),
    positions: positions ?? base.positions.map((p) => ({ ...p })),
  }
}

// ---------- Configuration en cours (tenue à jour par src/installation.ts) ----------

/** Avant la lecture de la table : le sport par défaut de la construction (VITE_SPORT), sinon handball. */
let current: SportConfig = resolveSportConfig([])

/**
 * Postes de l'installation, dans l'ordre : MÊME tableau pour toute la durée de l'appli, mis à jour sur place par
 * applySportConfig() (les écrans et modules qui l'ont importé voient tout de suite les nouveaux libellés).
 */
export const POSITIONS: { id: Position; label: string; short: string }[] = []

const fill = (cfg: SportConfig) =>
  POSITIONS.splice(0, POSITIONS.length, ...[...cfg.positions].sort((a, b) => a.order - b.order).map((p) => ({ id: p.code as Position, label: p.label, short: p.short })))
fill(current)

/** Applique une configuration (lecture de la table, ou tests). Renvoie true si quelque chose a changé. */
export function applySportConfig(cfg: SportConfig): boolean {
  if (JSON.stringify(cfg) === JSON.stringify(current)) return false
  current = cfg
  fill(cfg)
  return true
}

export const currentSport = () => current

const def = (code?: string | null) => (code ? current.positions.find((p) => p.code === code) : undefined)

/** Libellé court d'un poste (« Ailier G. »), « — » sans poste ; un code inconnu de l'installation s'affiche tel quel. */
export const positionLabel = (p?: string | null) => (p ? (def(p)?.short ?? p) : '—')

/** Poste en toutes lettres pour les exports (« Gardien de but »), vide sans poste. */
export const positionFull = (p?: string | null) => (p ? (def(p)?.full ?? def(p)?.label ?? p) : '')

/**
 * Le poste est-il de la famille « gardien » (le poste à part du sport) ? Handball : GB ; volley : L, qu'il soit ajouté ou
 * seulement proposé par le sport (ses critères ne s'affichent pas pour un joueur sans poste). Code inconnu : non.
 */
export const isKeeper = (p?: string | null) => (def(p) ?? (p ? sportProfile().extraPositions.find((x) => x.code === p) : undefined))?.family === 'gardien'

/** Codes des postes de l'installation, dans l'ordre. */
export const positionCodes = () => POSITIONS.map((p) => p.id as string)

/**
 * Poste proposé par le sport mais pas (encore) ajouté par l'installation (volley : L, le libéro, tant qu'il n'est pas dans
 * « Structure et sport »). Ses critères restent dans la base, sans joueur à qui s'appliquer. Handball : jamais.
 */
export const proposedOnly = (code: string) => !positionCodes().includes(code) && sportProfile().extraPositions.some((x) => x.code === code)

// ---------- Sport en cours : fonctions propres, familles ----------

/** L'installation est-elle de handball ? */
export const isHandball = () => current.sport === 'handball'

/** Le sport en cours a-t-il cette fonction ? (Gest'Hand, feuille de match FFHB : handball seulement.) */
export const sportHas = (f: SportFeature, sport: string = current.sport) => sportProfile(sport).features.includes(f)

/** Nom affiché d'une famille de postes (« Gardien » / « Champ » ; volley : « Libéro » / « Autres postes »). */
export const familyLabel = (f: PositionFamily) => sportProfile().families[f]

/**
 * Moyenne d'une catégorie (src/recipe.ts, sans postes réglés sur le critère) : ce poste n'y est-il pas classé ?
 * Handball : un gardien ni en défense ni en attaque, un joueur de champ pas sur les catégories de gardien.
 */
export function familySkips(pos: string, categoryKind: string | undefined): boolean {
  if (!categoryKind) return false
  const p = sportProfile()
  return (isKeeper(pos) ? p.specialSkips : p.othersSkip).includes(categoryKind)
}
