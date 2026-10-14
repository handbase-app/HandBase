/*
 * Configuration du sport de l'installation (supabase/044_structure.sql, table hb_config).
 *
 * Une installation = un client = une base Supabase à part. Le sport et ses postes sont des DONNÉES de l'installation,
 * avec des valeurs par défaut HANDBALL ici : table vide ou absente (script 044 pas encore passé), l'appli marche à
 * l'identique. Les CODES de postes (GB, AG, ARG…) sont ceux écrits dans les fiches : ils ne changent jamais ; seuls les
 * libellés, l'ordre et la famille (gardien / champ) se règlent.
 *
 * Fichier pur (ni Dexie ni React) : importable par les tests (npx jiti) et par les modules de calcul (recette, critères).
 * src/installation.ts lit la table et appelle applySportConfig() ; tous les écrans lisent POSITIONS, tenu à jour ici.
 */

/** Codes des postes du handball (valeurs stockées dans les fiches). Une autre installation peut en définir d'autres. */
export type Position = 'GB' | 'AG' | 'ARG' | 'DC' | 'ARD' | 'AD' | 'PIV'

/** Famille d'un poste : le gardien n'est pas évalué sur les mêmes critères que les joueurs de champ. */
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
  /** Identifiant du sport (handball, volley…) : choisit aussi le vocabulaire de dictée (handball seulement pour l'instant). */
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
 * Configuration de l'installation : valeurs de la table (lignes non supprimées) sur les valeurs par défaut handball.
 * Ce qui manque ou est illisible garde la valeur par défaut.
 */
export function resolveSportConfig(rows: readonly ConfigRow[] = [], base: SportConfig = HANDBALL): SportConfig {
  const get = (key: string) => rows.find((r) => !r.deleted && (r.key ?? r.id) === key)?.value
  const sport = get(CONFIG_KEYS.sport)
  const positions = cleanPositions(get(CONFIG_KEYS.positions))
  return {
    sport: (isObj(sport) && text(sport.sport, 30)) || base.sport,
    sportName: (isObj(sport) && text(sport.sportName)) || base.sportName,
    positions: positions ?? base.positions.map((p) => ({ ...p })),
  }
}

// ---------- Configuration en cours (tenue à jour par src/installation.ts) ----------

let current: SportConfig = HANDBALL

/**
 * Postes de l'installation, dans l'ordre : MÊME tableau pour toute la durée de l'appli, mis à jour sur place par
 * applySportConfig() (les écrans et modules qui l'ont importé voient tout de suite les nouveaux libellés).
 */
export const POSITIONS: { id: Position; label: string; short: string }[] = []

const fill = (cfg: SportConfig) =>
  POSITIONS.splice(0, POSITIONS.length, ...[...cfg.positions].sort((a, b) => a.order - b.order).map((p) => ({ id: p.code as Position, label: p.label, short: p.short })))
fill(HANDBALL)

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

/** Le poste est-il de la famille « gardien » ? (Handball : GB.) Code inconnu : non. */
export const isKeeper = (p?: string | null) => def(p)?.family === 'gardien'

/** Codes des postes de l'installation, dans l'ordre. */
export const positionCodes = () => POSITIONS.map((p) => p.id as string)
