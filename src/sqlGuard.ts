// « Poser une question », mode avancé : contrôle d'une requête SQL rendue par le modèle AVANT de l'exécuter sur la copie
// locale (src/sqlMirror.ts). Fonctions pures (testées par tools/test-sql.ts), sans base ni écran.
//  - une seule instruction, qui commence par SELECT ou WITH ;
//  - aucun mot qui écrit, attache une autre base ou change un réglage (ATTACH, PRAGMA, INSERT, UPDATE, DELETE, CREATE,
//    DROP, ALTER, REPLACE, VACUUM…) ni fonction de chargement (load_extension, readfile…), hors textes entre guillemets ;
//  - LIMIT 500 au plus (ajouté s'il manque, ramené à 500 s'il est plus grand).
// En plus de ce contrôle : la copie est ouverte en lecture seule (PRAGMA query_only) et jetable, l'exécution est coupée
// au-delà du délai (src/sqlClient.ts) ; IndexedDB et Supabase ne sont jamais touchés.

export const SQL_MAX_ROWS = 500
export const SQL_MAX_LENGTH = 4000

const FORBIDDEN = [
  'attach', 'detach', 'pragma', 'insert', 'update', 'delete', 'create', 'drop', 'alter', 'replace', 'vacuum', 'reindex', 'analyze',
  'begin', 'commit', 'rollback', 'savepoint', 'release', 'transaction', 'upsert', 'into',
  'load_extension', 'readfile', 'writefile', 'edit', 'fts3_tokenizer', 'zipfile', 'sqlar', 'sqlite_dbpage', 'sqlite_master', 'sqlite_schema', 'sqlite_temp_master',
]

export type SqlCheck = { ok: true; sql: string } | { ok: false; error: string }

/**
 * Texte de la requête sans commentaires et avec les textes entre guillemets vidés (mêmes positions) : les mots-clés se
 * cherchent là-dedans. `open` : guillemet ou commentaire non fermé.
 */
export function maskSql(sql: string): { masked: string; open: boolean } {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    const n = sql[i + 1]
    if (c === '-' && n === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end < 0 ? sql.length : end
      out += ' '.repeat(stop - i)
      i = stop
      continue
    }
    if (c === '/' && n === '*') {
      const end = sql.indexOf('*/', i + 2)
      if (end < 0) return { masked: out, open: true }
      out += ' '.repeat(end + 2 - i)
      i = end + 2
      continue
    }
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      let j = i + 1
      for (;;) {
        if (j >= sql.length) return { masked: out, open: true }
        if (sql[j] === close) {
          // Guillemet doublé : échappé, le texte continue.
          if (close !== ']' && sql[j + 1] === close) {
            j += 2
            continue
          }
          break
        }
        j++
      }
      // Texte : vidé ; identifiant entre guillemets : gardé en x (pas de mot-clé dedans).
      out += c + (c === "'" ? ' ' : 'x').repeat(j - i - 1) + close
      i = j + 1
      continue
    }
    out += c
    i++
  }
  return { masked: out, open: false }
}

/** Contrôle et prépare une requête : une seule instruction en lecture, LIMIT 500 au plus. Jamais d'exception. */
export function guardSql(raw: unknown): SqlCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'requête absente' }
  let sql = raw.replace(/\r\n?/g, '\n').trim()
  // Point-virgule final (un ou plusieurs) : retiré ; ailleurs : plusieurs instructions, refusées.
  sql = sql.replace(/(?:\s*;)+\s*$/, '').trim()
  if (!sql) return { ok: false, error: 'requête vide' }
  if (sql.length > SQL_MAX_LENGTH) return { ok: false, error: `requête trop longue (${SQL_MAX_LENGTH} caractères au plus)` }
  if ([...sql].some((ch) => ch.charCodeAt(0) < 32 && ch !== '\n' && ch !== '\t')) return { ok: false, error: 'caractère de contrôle' }
  const { masked, open } = maskSql(sql)
  if (open) return { ok: false, error: 'guillemet ou commentaire non fermé' }
  if (masked.includes(';')) return { ok: false, error: 'une seule instruction permise' }
  const low = masked.toLowerCase()
  if (!/^\s*(select|with)\b/.test(low)) return { ok: false, error: 'la requête doit commencer par SELECT ou WITH' }
  for (const w of FORBIDDEN) if (new RegExp(`(^|[^a-z0-9_$])${w}([^a-z0-9_$]|$)`).test(low)) return { ok: false, error: `mot interdit : ${w.toUpperCase()}` }
  // Tables internes et fonctions-tables de réglages (pragma_table_info, sqlite_master…).
  const internal = /(^|[^a-z0-9_$])(pragma_|sqlite_)/.exec(low)
  if (internal) return { ok: false, error: `mot interdit : ${internal[2].toUpperCase()}…` }
  // Paramètres (?, :x, @x, $x) : aucun n'est fourni.
  if (/[?]|(^|[^a-z0-9_])[:@$][a-z_]/.test(low)) return { ok: false, error: 'paramètre interdit' }

  // LIMIT au niveau principal (hors parenthèses) : ajouté, ou ramené à 500.
  let depth = 0
  let limitAt = -1
  for (let i = 0; i < low.length; i++) {
    const c = low[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0 && c === 'l' && low.startsWith('limit', i) && !/[a-z0-9_$]/.test(low[i - 1] ?? ' ') && !/[a-z0-9_$]/.test(low[i + 5] ?? ' ')) limitAt = i
  }
  if (limitAt < 0) return { ok: true, sql: `${sql}\nLIMIT ${SQL_MAX_ROWS}` }
  const tail = sql.slice(limitAt)
  const m = /^limit\s+(\d+)\s*(?:(offset)\s+(\d+)|,\s*(\d+))?\s*$/i.exec(tail)
  if (!m) return { ok: true, sql: `SELECT * FROM (\n${sql}\n) LIMIT ${SQL_MAX_ROWS}` }
  // « LIMIT a, b » : a lignes sautées, b lignes.
  const n = Number(m[4] !== undefined ? m[4] : m[1])
  const offset = m[4] !== undefined ? Number(m[1]) : m[3] !== undefined ? Number(m[3]) : 0
  if (n <= SQL_MAX_ROWS) return { ok: true, sql }
  return { ok: true, sql: `${sql.slice(0, limitAt)}LIMIT ${SQL_MAX_ROWS}${offset ? ` OFFSET ${offset}` : ''}` }
}

/** Libellé lisible d'une colonne : « nb_joueurs » → « Nombre de joueurs », « moyenne_defense » → « Moyenne defense ». */
export function columnLabel(c: string): string {
  const known: Record<string, string> = {
    nb: 'Nombre', n: 'Nombre', nombre: 'Nombre', total: 'Total', count: 'Nombre', nb_joueurs: 'Nombre de joueurs', nombre_joueurs: 'Nombre de joueurs',
    joueurs: 'Joueurs', nb_avis: 'Nombre d’avis', nb_vus: 'Nombre de vus', nb_coachs: 'Nombre de coachs', nb_staff: 'Personnes du staff',
    annee: 'Année', naissance: 'Naissance', sexe: 'Sexe', poste: 'Poste', postes_secondaires: 'Autres postes', lateralite: 'Latéralité', club: 'Club',
    departement: 'Département', departement_nom: 'Département', region: 'Région', taille_cm: 'Taille (cm)', taille: 'Taille', pole: 'Pôle',
    moyenne: 'Moyenne', moy: 'Moyenne', staff: 'Personne du staff', auteur: 'Auteur', date: 'Date', critere: 'Critère', critere_id: 'Critère',
    libelle: 'Critère', categorie: 'Catégorie', evenement: 'Événement', evenement_id: 'Événement', nom: 'Nom', prenom: 'Prénom', groupe: 'Groupe', valeur: 'Valeur',
  }
  const k = c.trim().toLowerCase()
  if (known[k]) return known[k]
  const s = c
    .replace(/[_\s]+/g, ' ')
    .replace(/\bnb\b/gi, 'nombre')
    .replace(/\bmoy\b/gi, 'moyenne')
    .trim()
  return s ? s[0].toUpperCase() + s.slice(1) : c
}

/** Mots jamais affichés sur les jeunes (explication du modèle) : remplacée par une phrase neutre. */
const NEGATIVE = /mauvais|\bnuls?\b|faibles?|pires?|pas retenus?|insuffisant|médiocre|mediocre|régress|regress|échec|echec|nullité/i
export const NEUTRAL_EXPLANATION = 'Requête calculée sur les données de cet appareil.'
export function safeExplanation(s: unknown): string {
  const t = typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 400) : ''
  return !t || NEGATIVE.test(t) ? NEUTRAL_EXPLANATION : t
}
export const hasNegative = (s: string) => NEGATIVE.test(s)

// ---------- Réponse en mode avancé : dans l'adresse (`?s=`) et dans « Mes questions » ----------

export type SqlDisplay = 'nombre' | 'liste' | 'tableau' | 'carte'
export const SQL_DISPLAYS: readonly SqlDisplay[] = ['nombre', 'liste', 'tableau', 'carte']
/** Requête contrôlée, explication en français (positive ou neutre), affichage voulu. */
export type SqlSpec = { sql: string; explanation: string; display: SqlDisplay }

/** Spécification relue (adresse, stockage, modèle) : requête recontrôlée, explication nettoyée ; null si illisible. */
export function cleanSqlSpec(v: unknown): SqlSpec | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const g = guardSql(o.sql)
  if (!g.ok) return null
  const display = SQL_DISPLAYS.includes(o.display as SqlDisplay) ? (o.display as SqlDisplay) : 'tableau'
  return { sql: g.sql, explanation: safeExplanation(o.explanation), display }
}
export const encodeSqlSpec = (s: SqlSpec) => JSON.stringify({ sql: s.sql, explanation: s.explanation, display: s.display })
export function decodeSqlSpec(s: string | null | undefined): SqlSpec | null {
  if (!s || s.length > SQL_MAX_LENGTH + 1200) return null
  try {
    return cleanSqlSpec(JSON.parse(s))
  } catch {
    return null
  }
}
