import type { Criterion, Measurement } from './db'
import { nameKey, wordLike } from './nameMatch'

/*
 * « Coller un tableau » de mesures (étape 1 du projet « Serveur MCP Nextar ») : le préparateur a noté les résultats sur
 * papier, son IA à lui a mis la photo en tableau, il colle ce tableau dans Nextar ; Nextar propose, le coach valide.
 *
 * Fichier PUR (ni Dexie ni React), testé par tools/test-import-mesures.ts. Tout se passe sur l'appareil : aucune IA n'est
 * appelée ici, aucune donnée de joueur ne part.
 *
 *  1. parseTable(texte) : lignes et cellules, quel que soit le format collé : tableau Markdown à barres (Claude, Gemini,
 *     ChatGPT), tabulations (tableau rendu copié, Excel, Google Sheets), CSV à point-virgule ou à virgule, texte simple
 *     ligne par ligne (« Lucas M. 1,86 38 »).
 *  2. propose(lignes, contexte, choix) : à partir de lignes BRUTES (cellules texte), d'où qu'elles viennent (presse-papiers
 *     aujourd'hui ; serveur MCP ou caméra plus tard), les propositions : colonnes reconnues (nom, prénom, joueur, numéro,
 *     année de naissance, date, un test par colonne), joueur proposé et niveau de confiance (sûr / à vérifier / introuvable),
 *     valeurs lues (virgule décimale, unités dans la cellule, conversions) et alertes (hors bornes, unité probablement
 *     fausse avec la conversion proposée, doublon, illisible). Les choix du coach (colonne reliée, joueur choisi, valeur
 *     corrigée) sont repassés à propose() : tout est recalculé, rien n'est écrit ici.
 */

// ---------- 1. Lecture du texte collé ----------

export type TableFormat = 'markdown' | 'tabulations' | 'csv-point-virgule' | 'csv-virgule' | 'texte'

export const FORMAT_LABEL: Record<TableFormat, string> = {
  markdown: 'tableau à barres (IA)',
  tabulations: 'tableau copié (tableur, IA)',
  'csv-point-virgule': 'CSV (point-virgule)',
  'csv-virgule': 'CSV (virgule)',
  texte: 'texte ligne par ligne',
}

export interface PastedTable {
  format: TableFormat
  rows: string[][]
  /** Les lignes viennent du texte simple : colonnes posées par position (numéro, nom, année, valeurs). */
  free?: boolean
}

/** Mise en forme Markdown retirée d'une cellule (**gras**, _italique_, `code`), espaces insécables remis en espaces. */
export const cleanCell = (s: string) =>
  s
    .replace(/[\u00a0\u202f\u2007]/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*[*_]\s*|\s*[*_]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const MD_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** Une ligne de CSV en cellules (guillemets « "…" » gérés, « "" » pour un guillemet). */
function splitQuoted(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"' && !cur.trim()) {
      q = true
      cur = ''
    } else if (ch === sep) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

/** Lignes non vides, sans les espaces de fin. */
const linesOf = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim())

const count = (s: string, ch: string) => s.split(ch).length - 1

/** Lit le texte collé : format reconnu, lignes et cellules (nettoyées). Lignes entièrement vides retirées. */
export function parseTable(text: string): PastedTable {
  const lines = linesOf(text)
  const keep = (rows: string[][]) => rows.map((r) => r.map(cleanCell)).filter((r) => r.some(Boolean))
  // Markdown : au moins deux lignes à barres (l'en-tête et une ligne), la ligne de tirets retirée.
  const piped = lines.filter((l) => l.includes('|'))
  if (piped.length >= 2 && (piped.some((l) => MD_SEP.test(l)) || piped.every((l) => /^\s*\|/.test(l)))) {
    const rows = piped
      .filter((l) => !MD_SEP.test(l))
      .map((l) =>
        l
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split(/(?<!\\)\|/)
          .map((c) => c.replace(/\\\|/g, '|')),
      )
    return { format: 'markdown', rows: keep(rows) }
  }
  // Tabulations : tableau rendu copié, tableur. Les phrases autour (sans tabulation) sont laissées de côté.
  const tabbed = lines.filter((l) => l.includes('\t'))
  if (tabbed.length >= 1 && tabbed.length >= lines.length / 2) return { format: 'tabulations', rows: keep(tabbed.map((l) => l.split('\t'))) }
  // CSV à point-virgule (tableur français).
  const semi = lines.filter((l) => l.includes(';'))
  if (semi.length >= 2 && semi.length >= lines.length / 2) return { format: 'csv-point-virgule', rows: keep(semi.map((l) => splitQuoted(l, ';'))) }
  // CSV à virgule : seulement si la première ligne est un en-tête (pas de nombre à virgule décimale) et que les lignes ont le
  // même nombre de virgules ; sinon « 1,86 » serait coupé en deux.
  const commas = lines.map((l) => count(l.replace(/"[^"]*"/g, ''), ','))
  if (lines.length >= 2 && commas[0] >= 1 && !/\d,\d/.test(lines[0]) && commas.every((n) => n === commas[0]))
    return { format: 'csv-virgule', rows: keep(lines.map((l) => splitQuoted(l, ','))) }
  return { format: 'texte', rows: freeRows(lines), free: true }
}

// ---------- Texte simple : « Lucas M. 1,86 38 », « 7 - Emma L. : 1m62, 41 cm » ----------

const UNIT_WORD = /^(cm|mm|m|s|sec|secs|secondes?|ms|kg|kgs|kilos?|km\/h|kmh|%|°|w\/kg)$/i

type FreeLine = { num?: string; name: string; year?: string; date?: string; values: string[] }

function readFreeLine(line: string, thisYear: number): FreeLine {
  // Séparateurs courants entre le nom et les valeurs (« : », « – », « | »), puis mots.
  const raw = line
    .replace(/[|;]/g, ' ')
    .replace(/\s[:–—-]\s|:\s/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[,(]+|[,)]+$/g, ''))
    .filter(Boolean)
  // Unité séparée du nombre (« 186 cm ») : recollée.
  const toks: string[] = []
  for (const t of raw) {
    const prev = toks[toks.length - 1]
    if (prev && UNIT_WORD.test(t) && /\d$/.test(prev)) toks[toks.length - 1] = `${prev} ${t}`
    else toks.push(t)
  }
  const out: FreeLine = { name: '', values: [] }
  const name: string[] = []
  toks.forEach((t, i) => {
    const isNum = parseNumber(t) !== null || /^\d+m\d{1,2}$/i.test(t)
    // Numéro de maillot en tête : petit entier suivi d'un mot (« 7 Lucas M. »), ou « #7 », « n°7 ».
    if (i === 0 && (/^(#|n°|no)\s*\d{1,3}$/i.test(t) || (/^\d{1,3}$/.test(t) && toks[1] && parseNumber(toks[1]) === null))) {
      out.num = t.replace(/\D/g, '')
      return
    }
    // Date : seulement écrite avec « / » ou en entier (« 5.11 » est une valeur, pas le 5 novembre).
    if (!out.date && (/\//.test(t) || /^\d{4}-\d\d-\d\d$/.test(t)) && parseDate(t, `${thisYear}-12-31`)) {
      out.date = t
      return
    }
    if (/^(19|20)\d\d$/.test(t) && +t <= thisYear && !out.values.length && !out.year && name.length) {
      out.year = t
      return
    }
    if (isNum) out.values.push(t)
    else if (!out.values.length) name.push(t)
  })
  out.name = name.join(' ')
  return out
}

function freeRows(lines: string[]): string[][] {
  const thisYear = new Date().getFullYear()
  const read = lines.map((l) => readFreeLine(l, thisYear)).filter((f) => f.name || f.values.length)
  const hasNum = read.some((f) => f.num)
  const hasYear = read.some((f) => f.year)
  const hasDate = read.some((f) => f.date)
  const n = Math.max(0, ...read.map((f) => f.values.length))
  return read.map((f) => [
    ...(hasNum ? [f.num ?? ''] : []),
    f.name,
    ...(hasYear ? [f.year ?? ''] : []),
    ...(hasDate ? [f.date ?? ''] : []),
    ...Array.from({ length: n }, (_, i) => f.values[i] ?? ''),
  ])
}

// ---------- Nombres, unités, dates ----------

/** Unités reconnues dans une cellule ou un en-tête, ramenées à leur écriture habituelle. */
const UNIT_ALIASES: Record<string, string> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  metre: 'm',
  metres: 'm',
  s: 's',
  sec: 's',
  secs: 's',
  seconde: 's',
  secondes: 's',
  '"': 's',
  "''": 's',
  ms: 'ms',
  min: 'min',
  g: 'g',
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  'km/h': 'km/h',
  kmh: 'km/h',
  kph: 'km/h',
  'km h': 'km/h',
  '%': '%',
  '°': '°',
  deg: '°',
  degre: '°',
  degres: '°',
  'w/kg': 'W/kg',
  'w kg': 'W/kg',
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Unité écrite → écriture habituelle (« secondes » → « s », « Km/H » → « km/h ») ; inconnue : undefined. */
export function unitOf(s: string | undefined): string | undefined {
  if (!s) return undefined
  const k = fold(s).replace(/\s+/g, ' ').replace(/\.$/, '').trim()
  return UNIT_ALIASES[k]
}

/** Facteur vers l'unité de base de la famille (longueur : m, masse : kg, temps : s). */
const UNIT_BASE: Record<string, [string, number]> = {
  mm: ['long', 0.001],
  cm: ['long', 0.01],
  m: ['long', 1],
  g: ['masse', 0.001],
  kg: ['masse', 1],
  ms: ['temps', 0.001],
  s: ['temps', 1],
  min: ['temps', 60],
}

/** Conversion d'une unité à l'autre de la même famille (186 cm → 1,86 m) ; familles différentes : null. */
export function convertUnit(n: number, from: string, to: string): number | null {
  if (from === to) return n
  const a = UNIT_BASE[from]
  const b = UNIT_BASE[to]
  if (!a || !b || a[0] !== b[0]) return null
  return tidy((n * a[1]) / b[1])
}

/** Arrondi qui efface les restes du calcul en virgule flottante (1,8599999 → 1,86). */
export const tidy = (n: number) => Math.round(n * 1e6) / 1e6

/** Cellules qui veulent dire « pas de mesure » : laissées de côté sans alerte. */
const EMPTY = /^(-+|—|–|\/|x|\?|abs|absent|absente|nc|n\/a|na|nr|non fait|non mesure|dispense|dispensee?|blesse|blessee)$/

export const isEmptyCell = (s: string) => !s.trim() || EMPTY.test(fold(s.trim()))

/**
 * Nombre lu dans une cellule, à la française ou non : « 1,86 », « 1.86 », « 1,86 s », « 186 cm », « 1m86 », « 1 m 86 »,
 * « 1'52 » (1 min 52 s), « 52'' », « 1 234 ». Rien de lisible (ou plusieurs nombres : « 1,86 / 1,84 ») : null.
 */
export function parseNumber(cell: string): { n: number; unit?: string } | null {
  const s = cleanCell(cell)
  if (!s) return null
  let m = /^(\d+)\s*m\s*(\d{1,2})$/i.exec(s)
  if (m) return { n: tidy(+m[1] + +(m[2].length === 1 ? m[2] + '0' : m[2]) / 100), unit: 'm' }
  m = /^(\d+)\s*['’′:]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:''|’’|″|")?$/.exec(s)
  if (m) return { n: tidy(+m[1] * 60 + +m[2].replace(',', '.')), unit: 's' }
  m = /^([+-]?\d{1,3}(?:[ .]\d{3})+|[+-]?\d+)(?:[.,](\d+))?\s*(''|’’|″|"|[a-zA-Zµ°%]+(?:\s?\/\s?[a-zA-Z]+)?)?\.?$/.exec(s)
  if (!m) return null
  // « 1.234 » est un nombre décimal (pas un millier) : un séparateur de milliers n'est accepté qu'en espace.
  let int = m[1]
  let dec = m[2]
  if (/\./.test(int) && !dec) {
    const parts = int.split('.')
    if (parts.length === 2) {
      int = parts[0]
      dec = parts[1]
    } else return null
  } else if (/\./.test(int)) return null
  const n = +`${int.replace(/ /g, '')}${dec ? '.' + dec : ''}`
  if (!Number.isFinite(n)) return null
  let unit: string | undefined
  if (m[3]) {
    unit = unitOf(m[3].replace(/\s/g, '').replace('’’', "''").replace('″', "''"))
    if (!unit) return null
  }
  return { n: tidy(n), ...(unit ? { unit } : {}) }
}

const MONTHS = ['jan', 'fev', 'mar', 'avr', 'mai', 'juin', 'juil', 'aou', 'sep', 'oct', 'nov', 'dec']

const iso = (y: number, mo: number, d: number) => {
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
const fullYear = (y: number, today: string) => {
  if (y >= 100) return y
  const cur = +today.slice(2, 4)
  return y <= cur + 1 ? 2000 + y : 1900 + y
}

/**
 * Date d'une cellule (« 05/11/2026 », « 5/11/26 », « 05.11.2026 », « 2026-11-05 », « 5 nov. 2026 », « 5/11 » : année de
 * `today`, l'année d'avant si la date tombait dans le futur) → AAAA-MM-JJ ; sinon null.
 */
export function parseDate(cell: string, today: string): string | null {
  const s = fold(cleanCell(cell))
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return iso(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s)
  let d: number, mo: number, y: number | undefined
  if (m) {
    d = +m[1]
    mo = +m[2]
    y = m[3] ? fullYear(+m[3], today) : undefined
  } else {
    m = /^(\d{1,2})(?:er)?\s+([a-z]+)\.?(?:\s+(\d{2}|\d{4}))?$/.exec(s)
    if (!m) return null
    const i = MONTHS.findIndex((x) => m![2].startsWith(x) || (x === 'fev' && m![2].startsWith('fev')))
    if (i < 0 || m[2].length < 3) return null
    d = +m[1]
    mo = i + 1
    y = m[3] ? fullYear(+m[3], today) : undefined
  }
  if (y !== undefined) return iso(y, mo, d)
  const ty = +today.slice(0, 4)
  const guess = iso(ty, mo, d)
  if (guess && guess > today) return iso(ty - 1, mo, d)
  return guess
}

/** Année de naissance d'une cellule (« 2010 », « 10 », « 12/03/2010 ») ; sinon undefined. */
export function parseYear(cell: string, today: string): number | undefined {
  const s = cleanCell(cell)
  if (/^\d{4}$/.test(s)) return +s >= 1950 && +s <= +today.slice(0, 4) ? +s : undefined
  if (/^\d{2}$/.test(s)) return fullYear(+s, today)
  const d = parseDate(s, today)
  return d ? +d.slice(0, 4) : undefined
}

// ---------- 2. Colonnes ----------

export type ColRole =
  | { k: 'joueur' }
  | { k: 'nom' }
  | { k: 'prenom' }
  | { k: 'maillot' }
  | { k: 'annee' }
  | { k: 'date' }
  | { k: 'test'; criterionId: string }
  | { k: 'ignore' }
  | { k: 'inconnue' }

export interface Column {
  index: number
  /** En-tête du tableau (« Sprint 10 m (s) ») ou « Colonne 3 » s'il n'y en a pas. */
  header: string
  role: ColRole
  /** Unité lue dans l'en-tête (« (s) », « cm ») : unité des cellules qui n'en ont pas. */
  unit?: string
  /** Rôle reconnu tout seul (sinon choisi par le coach, ou pas encore). */
  auto: boolean
  /** Test reconnu, mais un autre test va presque aussi bien (« Saut » : bilatéral ou largeur ?) : à vérifier. */
  doubt?: boolean
}

/** Critère que l'on peut importer : celui d'une séance de tests (factuel, actif). */
export type ImportCriterion = Pick<Criterion, 'id' | 'label' | 'unit' | 'scale' | 'category' | 'options' | 'order'> & {
  kind?: Criterion['kind']
  active?: boolean
  deleted?: boolean
}

export const importable = <C extends ImportCriterion>(cs: readonly C[]) => cs.filter((c) => (c.kind ?? 'factual') === 'factual' && c.active !== false && !c.deleted)

const ID_RULES: [RegExp, ColRole['k']][] = [
  [/^(joueur|joueuse|joueurs|joueuses|nom prenom|nom et prenom|prenom nom|prenom et nom|nom complet|athlete|sportif|sportive|eleve|identite|nom du joueur|nom de la joueuse|nom joueur|jeune|name|player)$/, 'joueur'],
  [/^(nom|noms|nom de famille|last name|surname)$/, 'nom'],
  [/^(prenom|prenoms|first name)$/, 'prenom'],
  [/^(numero|num|no|n|nr|maillot|numero de maillot|numero maillot|n maillot|dossard|numero dossard)$/, 'maillot'],
  [/^(annee|annee de naissance|annee naissance|annee naiss|ne en|nee en|ne e en|naissance|date de naissance|ddn|ne le|nee le|millesime|an)$/, 'annee'],
  [/^(date|jour|date du test|date test|date des tests|date de passage|date mesure|date de mesure|le)$/, 'date'],
  [/^(club|equipe|poste|postes|categorie|cat|sexe|genre|rang|classement|commentaire|commentaires|remarque|remarques|observation|observations|obs|note|notes|total|moyenne|licence|ligue|comite|departement|lateralite|groupe)$/, 'ignore'],
]

/** En-tête nettoyé pour reconnaître nom, prénom, numéro… (« N° » → « numero »). */
const idKey = (h: string) =>
  nameKey(
    h
      .replace(/\bn\s*[°º]/gi, 'numero ')
      .replace(/#/g, 'numero ')
      .replace(/\([^)]*\)/g, ' '),
  )
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Rôle d'identité d'un en-tête (joueur, nom, prénom, numéro, année, date, colonne à ignorer) ; sinon null. */
export function identityRole(header: string): ColRole['k'] | null {
  const k = idKey(header)
  if (!k) return null
  for (const [re, role] of ID_RULES) if (re.test(k)) return role
  return null
}

// « d » n'en est pas : « D » = droite.
const STOP = new Set(['a', 'la', 'le', 'les', 'de', 'du', 'des', 'en', 'au', 'aux', 'et', 'test', 'tests', 'l', 'sur'])
const SYN: Record<string, string[]> = {
  gauche: ['g'],
  droite: ['d'],
  droit: ['d'],
  medball: ['med', 'ball'],
  medecine: ['med'],
  medicine: ['med'],
  mb: ['med', 'ball'],
  ttest: ['t', 'test'],
  abdos: ['abdo'],
  abdominaux: ['abdo'],
  lombaires: ['lombaire'],
}
/** Mots d'unité retirés des en-têtes et des libellés (« Sprint 10 m (s) » → sprint, 10). « g » n'en est pas : « G » = gauche. */
const UNIT_TOKENS = new Set(['cm', 'mm', 'm', 's', 'sec', 'secs', 'seconde', 'secondes', 'ms', 'kg', 'kgs', 'kmh', 'km', 'h', 'w', 'deg', 'degre', 'degres', 'metres', 'metre'])

/** Mots qui comptent d'un en-tête ou d'un libellé de test, et l'unité qui y est écrite. */
export function testWords(text: string): { words: string[]; unit?: string } {
  let unit: string | undefined
  // Unité entre parenthèses ou crochets : « (s) », « [cm] », « (km/h) ».
  let s = text.replace(/[([]([^)\]]*)[)\]]/g, (_all, inner: string) => {
    const u = unitOf(inner)
    if (u) {
      unit ??= u
      return ' '
    }
    return ` ${inner} `
  })
  s = fold(s)
    .replace(/km\s*\/\s*h/g, ' kmh ')
    .replace(/w\s*\/\s*kg/g, ' wkg ')
    .replace(/%/g, ' pct ')
    .replace(/°/g, ' deg ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
  const words: string[] = []
  for (const w of s.split(' ').filter(Boolean)) {
    if (w === 'kmh') (unit ??= 'km/h')
    else if (w === 'wkg') (unit ??= 'W/kg')
    else if (w === 'pct') (unit ??= '%')
    else if (UNIT_TOKENS.has(w)) {
      const u = unitOf(w === 'deg' ? '°' : w)
      if (u && !['km', 'h', 'w'].includes(w)) unit ??= u
    } else if (!STOP.has(w)) words.push(...(SYN[w] ?? [w]).filter((x) => !STOP.has(x)))
  }
  return { words, unit }
}

/** Unité d'un critère, écriture habituelle (« Km/h » → « km/h ») ; sans unité : undefined. */
const critUnit = (c: Pick<ImportCriterion, 'unit'>) => unitOf(c.unit) ?? (c.unit?.trim() || undefined)

const tokenLike = (h: string, c: string) => {
  if (h === c) return 1
  if (/^\d+$/.test(h) || /^\d+$/.test(c)) return 0
  if (h.length >= 3 && c.length >= 3 && (c.startsWith(h) || h.startsWith(c))) return 0.85
  return wordLike(h, c)
}

/**
 * Ressemblance d'un en-tête à un test (0 à 1) : chaque mot de l'en-tête doit ressembler à un mot du libellé (accents,
 * abréviations « conc » / « concentrique », petites fautes) ; la note monte avec la part du libellé couverte, et avec une
 * unité d'en-tête qui va avec celle du test (« CMJ cm » → la hauteur, pas la puissance en W/kg).
 */
export function headerScore(header: string, c: ImportCriterion): number {
  const h = testWords(header)
  if (!h.words.length) return 0
  const idWords = c.id.toLowerCase().split(/[_\s-]+/)
  if (h.words.join(' ') === idWords.join(' ')) return 1
  const l = testWords(c.label)
  const cw = l.words.length ? l.words : idWords
  const used = new Set<number>()
  let sum = 0
  let alpha = false
  for (const w of h.words) {
    let best = 0
    let at = -1
    cw.forEach((t, i) => {
      if (used.has(i)) return
      const v = tokenLike(w, t)
      if (v > best) {
        best = v
        at = i
      }
    })
    if (best < 0.75) return 0
    used.add(at)
    sum += best
    if (/[a-z]/.test(w)) alpha = true
  }
  // Que des nombres : seulement s'il y en a au moins deux (« 30-15 ») ; « 10 m » seul ne dit pas quel test.
  if (!alpha && h.words.length < 2) return 0
  const cov = used.size / cw.length
  const cu = critUnit(c)
  const hu = h.unit
  const unitBonus = !hu || !cu ? 0 : hu === cu ? 0.1 : convertUnit(1, hu, cu) !== null ? 0.05 : -0.25
  return Math.max(0, Math.min(1, 0.45 + 0.35 * cov + 0.1 * (sum / h.words.length) + unitBonus))
}

export const HEADER_THRESHOLD = 0.6

/** Test le plus proche d'un en-tête (à égalité : celui dont l'unité va, puis l'ordre des tests) ; rien d'assez proche : null. */
export function matchTest<C extends ImportCriterion>(header: string, criteria: readonly C[]): C | null {
  let best: C | null = null
  let bs = 0
  for (const c of criteria) {
    const s = headerScore(header, c)
    if (s > bs + 1e-9 || (Math.abs(s - bs) < 1e-9 && best && c.order < best.order)) {
      best = c
      bs = s
    }
  }
  return bs >= HEADER_THRESHOLD ? best : null
}

/** Un autre test va-t-il presque aussi bien que celui retenu pour cet en-tête ? */
function testDoubt(header: string, criteria: readonly ImportCriterion[], chosen: ImportCriterion): boolean {
  const s = headerScore(header, chosen)
  if (s >= 1) return false
  return criteria.some((c) => c.id !== chosen.id && headerScore(header, c) >= s - 0.03)
}

const looksNumeric = (s: string) => parseNumber(s) !== null || /^\d+\s*m\s*\d{1,2}$/i.test(s)

/** La première ligne est-elle un en-tête ? Aucun nombre, et au moins une colonne reconnue (ou que du texte sur 2 colonnes et plus). */
export function isHeader(row: string[], criteria: readonly ImportCriterion[], today: string): boolean {
  const filled = row.filter(Boolean)
  if (!filled.length) return false
  if (filled.some((c) => looksNumeric(c) || parseDate(c, today))) return false
  if (filled.some((c) => identityRole(c) || matchTest(c, criteria))) return true
  return filled.length >= 2
}

/**
 * Colonnes d'un tableau : par l'en-tête s'il y en a un, sinon par le contenu (texte : le joueur ; petits entiers devant le
 * nom : le numéro ; années : l'année de naissance ; dates : la date ; autres nombres : colonnes à relier à un test).
 * `forced` : rôle choisi par le coach pour une colonne (il l'emporte).
 */
export function readColumns(
  rows: string[][],
  criteria: readonly ImportCriterion[],
  today: string,
  forced: Record<number, ColRole> = {},
  free = false,
): { columns: Column[]; hasHeader: boolean } {
  const width = Math.max(0, ...rows.map((r) => r.length))
  const hasHeader = !free && rows.length > 0 && isHeader(rows[0], criteria, today)
  const data = hasHeader ? rows.slice(1) : rows
  const crits = importable(criteria)
  const columns: Column[] = []
  let seenName = false
  let valueN = 0
  for (let i = 0; i < width; i++) {
    const cells = data.map((r) => r[i] ?? '').filter((c) => !isEmptyCell(c))
    const header = hasHeader ? (rows[0][i] ?? '').trim() : ''
    let role: ColRole = { k: 'inconnue' }
    let unit: string | undefined
    let doubt = false
    if (header) {
      const id = identityRole(header)
      const t = id ? null : matchTest(header, crits)
      unit = testWords(header).unit
      if (id) role = { k: id } as ColRole
      else if (t) {
        role = { k: 'test', criterionId: t.id }
        doubt = testDoubt(header, crits, t)
      }
      // En-tête inconnu mais colonne de texte : sans doute le joueur (« Athlète / Nom »), s'il n'y en a pas encore.
      else if (!seenName && cells.length && cells.every((c) => !looksNumeric(c))) role = { k: 'joueur' }
    } else if (cells.length) {
      const nums = cells.every(looksNumeric)
      if (!nums && cells.every((c) => parseDate(c, today))) role = { k: 'date' }
      else if (!nums) role = { k: 'joueur' }
      else if (cells.every((c) => /^(19|20)\d\d$/.test(c.trim()))) role = { k: 'annee' }
      else if (!seenName && cells.every((c) => /^\d{1,3}$/.test(c.trim()))) role = { k: 'maillot' }
    }
    if (role.k === 'joueur' || role.k === 'nom' || role.k === 'prenom') seenName = true
    // Sans en-tête, les colonnes de nombres s'appellent « Valeur 1 », « Valeur 2 »… (d'après le contenu, pas le choix du coach).
    const label = header || (role.k === 'inconnue' ? `Valeur ${++valueN}` : `Colonne ${i + 1}`)
    const auto = role.k !== 'inconnue'
    const f = forced[i]
    columns.push({ index: i, header: label, role: f ?? role, unit, auto: auto && !f, ...(doubt && !f ? { doubt } : {}) })
  }
  return { columns, hasHeader }
}

// ---------- 3. Bornes plausibles ----------

type Rule = [RegExp, string | null, [number, number]]
/** Fourchettes larges (tous âges des jeunes, filles et garçons) ; la première règle qui va l'emporte. Unité du test entre deux. */
const RANGE_RULES: Rule[] = [
  [/assise/, 'cm', [50, 120]],
  [/envergure/, 'cm', [100, 250]],
  [/attaque|contre/, 'cm', [180, 400]],
  [/atteinte/, 'cm', [150, 350]],
  [/taille/, 'cm', [100, 230]],
  [/poids|masse/, 'kg', [20, 160]],
  [/empan/, 'cm', [12, 32]],
  [/t ?test/, 's', [6, 18]],
  [/illinois/, 's', [11, 28]],
  [/rsa|rast/, 's', [3, 12]],
  [/rsa|rast|fatigue/, '%', [0, 60]],
  [/vma|vift|ift|vitesse max|luc leger|vameval/, 'km/h', [6, 28]],
  [/rsi/, null, [0.05, 5]],
  [/\beur\b/, null, [0.5, 2]],
  [/cmj|\bsj\b|squat jump|drop jump|\bdj ?\d|detente|abalakov|saut vertical/, 'cm', [5, 90]],
  [/puissance|cmj|\bsj\b/, 'W/kg', [5, 100]],
  [/saut|bond|largeur|longueur/, 'm', [0.5, 4]],
  [/med|lancer|ball/, 'm', [1, 25]],
  [/shirado|sorensen|gainage|planche|chaise|ito/, 's', [5, 900]],
  [/dorsi|cheville|lunge/, 'cm', [0, 25]],
]
const SPRINT: Record<number, [number, number]> = { 5: [0.7, 2.5], 10: [1.2, 3.5], 15: [1.8, 4.5], 20: [2.4, 5.5], 25: [3, 6.5], 30: [3.3, 7.5], 40: [4.2, 9], 50: [5, 11], 60: [6, 13] }
const BY_UNIT: Record<string, [number, number]> = { cm: [0, 400], mm: [0, 4000], m: [0, 200], s: [0, 7200], 'km/h': [0, 50], 'W/kg': [0, 150], kg: [0, 400], '%': [0, 100], '°': [0, 200] }

/**
 * Bornes plausibles d'un test (valeurs en dehors : alerte) : celles de l'installation si l'appelant en donne (`known`,
 * tirées des repères), sinon une fourchette large selon le nom du test et son unité ; inconnues : null (pas d'alerte).
 */
export function plausibleRange(c: ImportCriterion, known?: [number, number]): [number, number] | null {
  if (known) return known
  const u = critUnit(c)
  const k = fold(`${c.id.replace(/_/g, ' ')} ${c.label}`).replace(/[^a-z0-9]+/g, ' ')
  const sp = /sprint|course|\bvitesse \d/.test(k) && u === 's' ? /(\d+)\s*m?\b/.exec(fold(c.label).replace(/[^a-z0-9 ]/g, ' ')) : null
  if (sp && SPRINT[+sp[1]]) return SPRINT[+sp[1]]
  if (/sprint/.test(k) && u === 's') return [0.7, 15]
  for (const [re, unit, r] of RANGE_RULES) if (re.test(k) && (unit === null ? !u || u === '' : unit === u)) return r
  if (u === '°') return [0, 200]
  return u ? (BY_UNIT[u] ?? null) : null
}

/** Bornes tirées des repères d'un test (seuils des médailles) : très larges autour (÷ 3, × 3). */
export function rangeFromThresholds(values: number[]): [number, number] | undefined {
  const v = values.filter((x) => Number.isFinite(x) && x > 0)
  if (!v.length) return undefined
  return [tidy(Math.min(...v) / 3), tidy(Math.max(...v) * 3)]
}

// ---------- 4. Valeurs ----------

export type Alert =
  /** Valeur hors des bornes plausibles du test. */
  | { k: 'bornes'; min: number; max: number }
  /** Unité probablement fausse : la valeur convertie (« 1,86 » → 186 pour une taille en cm). */
  | { k: 'unite'; suggestion: number }
  /** Même joueur, même test, même date : déjà en base (ou deux fois dans le tableau). */
  | { k: 'doublon'; existing?: number | string; inPaste?: boolean }
  /** Cellule illisible pour ce test (texte dans un test chiffré, option inconnue…). */
  | { k: 'illisible' }

export interface ReadValue {
  value?: number | string
  alerts: Alert[]
  /** Conversion faite d'après l'unité écrite (« 186 cm → 1,86 m »). */
  converted?: { from: number; unit: string }
}

const scaleRange = (scale: Criterion['scale']): [number, number] | null =>
  scale === 'score5' ? [1, 5] : scale === 'score3' ? [0, 3] : scale === 'score2' ? [0, 2] : null

const FIXES = [100, 0.01, 1000, 0.001, 10, 0.1]

/** Valeur d'une cellule pour un test : lue, convertie, vérifiée (bornes, unité). Cellule vide : aucune valeur, aucune alerte. */
export function readValue(cell: string, c: ImportCriterion, colUnit?: string, known?: [number, number]): ReadValue {
  const raw = cleanCell(cell)
  if (isEmptyCell(raw)) return { alerts: [] }
  if (c.scale === 'text') return { value: raw.slice(0, 200), alerts: [] }
  if (c.scale === 'choice') {
    const opts = c.options ?? []
    const k = fold(raw)
    const starts = opts.filter((o) => fold(o).startsWith(k))
    const hit = opts.find((o) => fold(o) === k) ?? (starts.length === 1 ? starts[0] : undefined)
    return hit ? { value: hit, alerts: [] } : { alerts: [{ k: 'illisible' }] }
  }
  const p = parseNumber(raw)
  if (!p) return { alerts: [{ k: 'illisible' }] }
  const sr = scaleRange(c.scale)
  if (sr) {
    if (!Number.isInteger(p.n) || p.n < sr[0] || p.n > sr[1]) return { value: p.n, alerts: [{ k: 'bornes', min: sr[0], max: sr[1] }] }
    return { value: p.n, alerts: [] }
  }
  const cu = critUnit(c)
  let n = p.n
  let converted: ReadValue['converted']
  const u = p.unit ?? colUnit
  if (u && cu && u !== cu) {
    const x = convertUnit(n, u, cu)
    if (x !== null) {
      converted = { from: n, unit: u }
      n = x
    }
  }
  const r = plausibleRange(c, known)
  const out: ReadValue = { value: n, alerts: [], ...(converted ? { converted } : {}) }
  if (r && (n < r[0] || n > r[1])) {
    const f = FIXES.find((f) => n * f >= r[0] && n * f <= r[1])
    out.alerts.push(f ? { k: 'unite', suggestion: tidy(n * f) } : { k: 'bornes', min: r[0], max: r[1] })
  }
  return out
}

// ---------- 5. Joueurs ----------

export interface Candidate {
  id: string
  firstName: string
  lastName: string
  birthDate?: string
  /** Numéro de maillot dans le contexte (événement : tournoi ou feuille de match). */
  num?: string
}

export type Confidence = 'sur' | 'verifier' | 'introuvable'

export interface PlayerMatch {
  playerId?: string
  confidence: Confidence
  /** Autres joueurs possibles (proposés en premier quand on change). */
  others: string[]
  /** Pourquoi : « nom exact », « nom approchant », « n° 7 »… */
  why: string
}

const nameTokens = (s: string) => nameKey(s).split(' ').filter(Boolean)
const glue = (s: string) => nameKey(s).replace(/ /g, '')

/**
 * Ressemblance d'un nom écrit à un joueur (0 à 1), dans n'importe quel ordre (« MARTIN Lucas », « Lucas Martin »),
 * initiales comprises (« Lucas M. », « L. Martin »), noms composés écrits collés (« Jeanpierre »), petites fautes et noms
 * qui se prononcent pareil (wordLike, src/nameMatch.ts). `strong` : orthographe exacte et prénom + nom présents.
 */
export function nameMatchScore(written: string, p: Pick<Candidate, 'firstName' | 'lastName'>): { s: number; strong: boolean } {
  const it = nameTokens(written)
  if (!it.length) return { s: 0, strong: false }
  const parts: { t: string; part: 0 | 1 }[] = [
    ...nameTokens(p.firstName).map((t) => ({ t, part: 0 as const })),
    ...nameTokens(p.lastName).map((t) => ({ t, part: 1 as const })),
  ]
  if (nameTokens(p.firstName).length > 1) parts.push({ t: glue(p.firstName), part: 0 })
  if (nameTokens(p.lastName).length > 1) parts.push({ t: glue(p.lastName), part: 1 })
  if (!parts.length) return { s: 0, strong: false }
  const used = new Set<number>()
  const covered = new Set<number>()
  let sum = 0
  let exact = true
  // Mots entiers d'abord (une initiale ne doit pas prendre la place d'un mot entier).
  const order = [...it.keys()].sort((a, b) => +(it[a].length === 1) - +(it[b].length === 1))
  for (const i of order) {
    const w = it[i]
    let best = 0
    let at = -1
    parts.forEach((x, j) => {
      if (used.has(j)) return
      const v = w.length === 1 ? (x.t.startsWith(w) ? 0.9 : 0) : wordLike(w, x.t)
      if (v > best) {
        best = v
        at = j
      }
    })
    if (best < 0.75) return { s: 0, strong: false }
    used.add(at)
    covered.add(parts[at].part)
    sum += best
    if (w.length > 1 && best < 1) exact = false
  }
  const s = 0.75 * (sum / it.length) + 0.25 * (covered.size / 2)
  return { s, strong: exact && covered.size === 2 }
}

const yearOf = (p: Candidate) => (p.birthDate && /^\d{4}/.test(p.birthDate) ? +p.birthDate.slice(0, 4) : undefined)
const numKey = (n?: string) => (n ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '')

/**
 * Joueur d'une ligne du tableau, parmi ceux du contexte : nom approchant, numéro de maillot dans l'événement, année de
 * naissance pour départager. « sûr » : nom exact et seul possible (ou numéro et nom qui vont ensemble) ; « à vérifier » :
 * nom approchant, plusieurs possibles, ou numéro et nom qui ne vont pas ensemble ; « introuvable » : personne d'assez proche.
 */
export function matchPlayer(idn: { name: string; num?: string; year?: number }, cands: readonly Candidate[]): PlayerMatch {
  const scored = cands
    .map((p) => {
      const r = nameMatchScore(idn.name, p)
      const y = yearOf(p)
      const yearOk = idn.year === undefined || y === undefined ? undefined : y === idn.year
      return { p, s: r.s ? r.s + (yearOk === true ? 0.1 : yearOk === false ? -0.25 : 0) : 0, strong: r.strong, yearOk }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
  const n = numKey(idn.num)
  const byNum = n ? cands.filter((p) => numKey(p.num) === n) : []
  const ids = (xs: { p: Candidate }[]) => xs.map((x) => x.p.id)
  if (byNum.length === 1) {
    const p = byNum[0]
    const mine = scored.find((x) => x.p.id === p.id)
    if (!idn.name.trim()) return { playerId: p.id, confidence: 'sur', others: [], why: `n° ${n}` }
    if (mine && mine.s >= 0.7) return { playerId: p.id, confidence: 'sur', others: [], why: `n° ${n} et nom` }
    const top = scored[0]
    if (top && top.strong) return { playerId: top.p.id, confidence: 'verifier', others: [p.id, ...ids(scored.slice(1, 4))], why: `nom exact, mais le n° ${n} est à un autre joueur` }
    return { playerId: p.id, confidence: 'verifier', others: ids(scored.slice(0, 4)), why: `n° ${n}, nom différent` }
  }
  if (!scored.length) return { confidence: 'introuvable', others: [], why: idn.name.trim() ? 'aucun nom proche' : 'pas de nom' }
  const top = scored[0]
  const close = scored.filter((x) => x.s >= top.s - 0.05)
  const strongs = scored.filter((x) => x.strong && x.yearOk !== false)
  const others = ids(scored.filter((x) => x !== top).slice(0, 4))
  if (top.yearOk === false) return { playerId: top.p.id, confidence: 'verifier', others, why: `année de naissance différente` }
  // Orthographe exacte (initiales comprises) et seul dans ce cas : sûr, même si un nom voisin existe (Martin / Martins).
  if (top.strong && strongs.length === 1) {
    const initials = nameTokens(idn.name).some((w) => w.length === 1)
    return { playerId: top.p.id, confidence: 'sur', others, why: initials ? 'initiale, seul possible' : top.yearOk ? 'nom exact et année' : 'nom exact' }
  }
  if (close.length > 1) return { playerId: top.p.id, confidence: 'verifier', others, why: `${close.length} joueurs possibles` }
  if (top.s >= 0.6) return { playerId: top.p.id, confidence: 'verifier', others, why: 'nom approchant' }
  return { confidence: 'introuvable', others: ids(scored.slice(0, 4)), why: 'aucun nom assez proche' }
}

// ---------- 6. Propositions ----------

export interface ImportCtx {
  /** Tests de l'installation (seuls les tests d'une séance comptent : importable). */
  criteria: readonly ImportCriterion[]
  /** Joueurs du contexte (événement, groupe, ou toute la base). */
  players: readonly Candidate[]
  /** Mesures déjà en base (au moins celles des joueurs du contexte) : doublons. */
  existing: readonly Pick<Measurement, 'playerId' | 'criterionId' | 'date' | 'value' | 'deleted'>[]
  /** Date des tests choisie (AAAA-MM-JJ) : une colonne date du tableau l'emporte. */
  date: string
  /** Aujourd'hui (AAAA-MM-JJ) : dates sans année, années sur deux chiffres. */
  today: string
  /** Bornes connues par test (repères de l'installation). */
  ranges?: Record<string, [number, number]>
}

/** Choix du coach, repassés à propose() : tout est recalculé avec eux. */
export interface ImportChoices {
  /** Rôle choisi pour une colonne (index de colonne). */
  columns?: Record<number, ColRole>
  /** Joueur choisi pour une ligne (index de ligne de données) ; '' : aucun (ligne laissée de côté). */
  players?: Record<number, string>
  /** Valeur corrigée (texte) : clé `${ligne}:${colonne}`. */
  values?: Record<string, string>
}

export interface ProposedValue {
  col: number
  criterionId: string
  /** Texte de la cellule (ou corrigé). */
  raw: string
  value?: number | string
  alerts: Alert[]
  converted?: ReadValue['converted']
  /** Corrigée par le coach. */
  edited: boolean
}

export interface ProposalRow {
  /** Index de la ligne de données (0 : première ligne sous l'en-tête). */
  line: number
  cells: string[]
  name: string
  num?: string
  year?: number
  date: string
  /** Date lue dans le tableau (sinon la date choisie). */
  dateFromTable: boolean
  /** Cellule de date illisible (la date choisie est gardée). */
  badDate?: string
  match: PlayerMatch
  /** Joueur choisi par le coach. */
  chosen: boolean
  values: ProposedValue[]
}

export interface Proposal {
  columns: Column[]
  hasHeader: boolean
  rows: ProposalRow[]
}

const DUP_KEY = (pid: string, cid: string, date: string) => `${pid}|${cid}|${date}`

/**
 * Propositions pour des lignes brutes (cellules texte, en-tête éventuel en première ligne) : colonnes, joueur proposé et
 * confiance, valeurs et alertes. Fonction pure : le presse-papiers aujourd'hui, le serveur MCP ou une caméra demain.
 */
export function propose(rows: string[][], ctx: ImportCtx, choices: ImportChoices = {}, free = false): Proposal {
  const crits = importable(ctx.criteria)
  const byId = new Map(crits.map((c) => [c.id, c]))
  const { columns, hasHeader } = readColumns(rows, crits, ctx.today, choices.columns, free)
  const data = hasHeader ? rows.slice(1) : rows
  const cands = ctx.players
  const existing = new Map<string, number | string>()
  for (const m of ctx.existing) if (!m.deleted) existing.set(DUP_KEY(m.playerId, m.criterionId, m.date), m.value)
  const of = (r: string[], k: ColRole['k']) =>
    columns
      .filter((c) => c.role.k === k)
      .map((c) => cleanCell(r[c.index] ?? ''))
      .filter(Boolean)
  const out: ProposalRow[] = []
  data.forEach((cells, line) => {
    // Nom : colonnes joueur, nom et prénom, mises bout à bout (l'ordre ne compte pas pour le rapprochement).
    const name = [...of(cells, 'joueur'), ...of(cells, 'nom'), ...of(cells, 'prenom')].join(' ').trim()
    const num = of(cells, 'maillot')[0]
    const yearCell = of(cells, 'annee')[0]
    const year = yearCell ? parseYear(yearCell, ctx.today) : undefined
    const dateCell = of(cells, 'date')[0]
    const tableDate = dateCell ? parseDate(dateCell, ctx.today) : null
    const date = tableDate ?? ctx.date
    const picked = choices.players?.[line]
    const match: PlayerMatch =
      picked !== undefined
        ? picked
          ? { playerId: picked, confidence: 'sur', others: [], why: 'choisi' }
          : { confidence: 'introuvable', others: [], why: 'laissée de côté' }
        : matchPlayer({ name, num, year }, cands)
    const values: ProposedValue[] = []
    for (const col of columns) {
      if (col.role.k !== 'test') continue
      const c = byId.get(col.role.criterionId)
      if (!c) continue
      const key = `${line}:${col.index}`
      const edited = choices.values?.[key] !== undefined
      const raw = edited ? choices.values![key] : (cells[col.index] ?? '')
      if (isEmptyCell(raw) && !edited) continue
      const r = readValue(raw, c, edited ? undefined : col.unit, ctx.ranges?.[c.id])
      if (r.value === undefined && !r.alerts.length) continue
      values.push({ col: col.index, criterionId: c.id, raw: cleanCell(raw), value: r.value, alerts: r.alerts, converted: r.converted, edited })
    }
    // Ligne vide de sens (ni nom ni valeur) : laissée de côté.
    if (!name && !num && !values.length) return
    out.push({
      line,
      cells,
      name,
      ...(num ? { num } : {}),
      ...(year ? { year } : {}),
      date,
      dateFromTable: !!tableDate,
      ...(dateCell && !tableDate ? { badDate: dateCell } : {}),
      match,
      chosen: picked !== undefined,
      values,
    })
  })
  // Doublons : déjà en base, ou deux fois dans le tableau (même joueur, même test, même date).
  const seen = new Map<string, number>()
  for (const r of out) {
    const pid = r.match.playerId
    if (!pid) continue
    for (const v of r.values) {
      if (v.value === undefined) continue
      const k = DUP_KEY(pid, v.criterionId, r.date)
      if (existing.has(k)) v.alerts.push({ k: 'doublon', existing: existing.get(k) })
      else if (seen.has(k)) v.alerts.push({ k: 'doublon', inPaste: true })
      seen.set(k, r.line)
    }
  }
  // Deux lignes pour le même joueur (sans choix du coach) : toutes deux à vérifier.
  const perPlayer = new Map<string, ProposalRow[]>()
  for (const r of out) if (r.match.playerId) perPlayer.set(r.match.playerId, [...(perPlayer.get(r.match.playerId) ?? []), r])
  for (const rs of perPlayer.values())
    if (rs.length > 1) for (const r of rs) if (!r.chosen && r.match.confidence === 'sur') r.match = { ...r.match, confidence: 'verifier', why: `${r.match.why} · ${rs.length} lignes pour ce joueur` }
  return { columns, hasHeader, rows: out }
}

/** Décision du coach sur une valeur : automatique, laissée de côté, ou gardée malgré l'alerte (doublon, bornes). */
export type ValueDecision = 'auto' | 'skip' | 'keep'

/** La valeur sera-t-elle enregistrée (si sa ligne est cochée) ? Un doublon n'est ajouté que si le coach le garde. */
export function willSave(v: ProposedValue, d: ValueDecision = 'auto'): boolean {
  if (v.value === undefined || d === 'skip') return false
  if (v.alerts.some((a) => a.k === 'doublon' || a.k === 'illisible')) return d === 'keep' && !v.alerts.some((a) => a.k === 'illisible')
  return true
}

/**
 * Alertes encore ouvertes d'une valeur (celles que le coach n'a pas tranchées). Un doublon n'en est pas une : il n'est pas
 * importé d'office (le coach peut l'ajouter quand même), il ne bloque donc pas la ligne.
 */
export const openAlerts = (v: ProposedValue, d: ValueDecision = 'auto') => (d === 'auto' ? v.alerts.filter((a) => a.k !== 'doublon') : [])

/** Case cochée d'office : joueur sûr, au moins une valeur à importer, aucune alerte ouverte. */
export function autoChecked(r: ProposalRow, decisions: Record<string, ValueDecision> = {}): boolean {
  if (!r.match.playerId || r.match.confidence !== 'sur' || r.badDate) return false
  const vs = r.values.filter((v) => decisions[`${r.line}:${v.col}`] !== 'skip')
  if (!vs.some((v) => willSave(v, decisions[`${r.line}:${v.col}`]))) return false
  return vs.every((v) => !openAlerts(v, decisions[`${r.line}:${v.col}`]).length)
}

export interface MeasureToWrite {
  playerId: string
  criterionId: string
  value: number | string
  date: string
}

/** Mesures à écrire : lignes cochées avec un joueur, valeurs retenues (willSave). */
export function toWrite(p: Proposal, checked: (r: ProposalRow) => boolean, decisions: Record<string, ValueDecision> = {}): MeasureToWrite[] {
  const out: MeasureToWrite[] = []
  for (const r of p.rows) {
    if (!r.match.playerId || !checked(r)) continue
    for (const v of r.values) if (willSave(v, decisions[`${r.line}:${v.col}`])) out.push({ playerId: r.match.playerId, criterionId: v.criterionId, value: v.value!, date: r.date })
  }
  return out
}

/** « 1,86 » (nombre à la française, 2 décimales au plus). */
export const frNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString('fr-FR', { maximumFractionDigits: 3 }))

/**
 * Numéros de maillot d'un événement, par fiche : répartition du tournoi, puis feuille de match importée (fiches reliées).
 */
export function eventNumbers(ev: { tournament?: { players?: Record<string, { num?: string }> }; matchSheet?: { players?: { num?: string; playerId?: string }[] } }): Record<string, string> {
  const out: Record<string, string> = {}
  for (const sp of ev.matchSheet?.players ?? []) if (sp.playerId && sp.num) out[sp.playerId] = sp.num
  for (const [id, x] of Object.entries(ev.tournament?.players ?? {})) if (x?.num) out[id] = x.num
  return out
}
