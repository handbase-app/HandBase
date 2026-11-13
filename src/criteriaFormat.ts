import type { Criterion, CriterionKind, CriterionScale } from './db'
import { currentSport, positionCodes, sportProfile, type Position } from './sportConfig'
import type { Cell, Sheet } from './xlsx'

/*
 * Format des fichiers de critères (import / export par les administrateurs, Réglages > Critères et listes).
 * Les critères ne sont pas livrés avec l'appli : ils viennent de la base, importés depuis un fichier (Excel, CSV ou JSON).
 * Une ligne = un critère, repéré par son identifiant (fixe : mesures et avis y sont rattachés).
 * Reprise de la liste existante : « Exporter » sur un appareil à jour, puis importer ce fichier (rien ne change à l'écran,
 * mesures et avis restent rattachés par identifiant) ; c'est alors la base partagée qui tient les critères.
 */

/** Champs d'un critère portés par le fichier (le reste — dates, signatures — est tenu par l'appli). */
export type CriterionFields = Pick<Criterion, 'id' | 'category' | 'label' | 'kind' | 'scale' | 'unit' | 'options' | 'description' | 'positions' | 'quick' | 'active' | 'order'>

/** Colonnes, dans l'ordre du fichier ; `keys` : en-têtes reconnus (sans accents, espaces ni casse). */
export const COLUMNS = [
  { field: 'id', head: 'id', keys: ['id', 'identifiant'], help: 'Identifiant fixe (lettres minuscules, chiffres, « _ »). Ne jamais le changer : mesures et avis y sont rattachés.' },
  { field: 'category', head: 'catégorie', keys: ['categorie', 'category'], help: 'Rubrique d’affichage (Gabarit, Défense…).' },
  { field: 'label', head: 'libellé', keys: ['libelle', 'label', 'nom'], help: 'Nom affiché.' },
  { field: 'kind', head: 'type', keys: ['type', 'kind'], help: '« factuel » (test, une valeur par date) ou « subjectif » (noté dans les avis).' },
  { field: 'scale', head: 'échelle', keys: ['echelle', 'scale'], help: 'score5 (1 à 5), score3 (0 à 3), score2 (0 à 2), number (valeur avec unité), choice (options), text (texte libre).' },
  { field: 'unit', head: 'unité', keys: ['unite', 'unit'], help: 'Pour l’échelle number : cm, kg, s, km/h…' },
  { field: 'options', head: 'options', keys: ['options'], help: 'Pour l’échelle choice : au moins 2 options, séparées par « | ».' },
  { field: 'description', head: 'description', keys: ['description', 'definition'], help: 'Ce qu’on observe ou mesure (facultatif).' },
  { field: 'positions', head: 'postes', keys: ['postes', 'positions', 'poste'], help: 'Postes concernés : leurs codes, séparés par des virgules ; vide = tous.' },
  { field: 'quick', head: 'mode rapide', keys: ['moderapide', 'rapide', 'quick'], help: 'oui : fait partie de l’évaluation rapide (critères subjectifs).' },
  { field: 'active', head: 'actif', keys: ['actif', 'active'], help: 'non : critère masqué (son historique est gardé). Vide = oui.' },
  { field: 'order', head: 'ordre', keys: ['ordre', 'order'], help: 'Rang d’affichage (nombre). Vide = rang de la ligne dans le fichier.' },
] as const satisfies readonly { field: keyof CriterionFields; head: string; keys: readonly string[]; help: string }[]

export const SCALE_VALUES: CriterionScale[] = ['score5', 'score3', 'score2', 'number', 'choice', 'text']

/** Identifiant accepté : lettres, chiffres, « _ », « - », « . », « : » (les critères créés dans l'appli ont un UUID). */
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'string' ? v.trim() : String(v).trim())

const YES = new Set(['oui', 'o', 'x', '1', 'vrai', 'true', 'yes', 'y'])
const NO = new Set(['non', 'n', '0', 'faux', 'false', 'no'])

/** Erreur sur une ligne du fichier (numéro de ligne tel qu'affiché par le tableur : en-tête = 1). */
export interface RowError {
  line: number
  id?: string
  reason: string
}

export interface ParsedFile {
  rows: { line: number; c: CriterionFields }[]
  errors: RowError[]
  /** Colonnes facultatives absentes du fichier : pour un critère existant, sa valeur actuelle est gardée. */
  absent: (keyof CriterionFields)[]
}

/**
 * Lignes brutes (première ligne = en-têtes) → critères validés et erreurs. Lignes vides ignorées.
 * Les objets JSON passent aussi par ici (voir rowsFromJson).
 */
export function parseRows(table: Cell[][]): ParsedFile {
  const errors: RowError[] = []
  const rows: ParsedFile['rows'] = []
  const head = (table[0] ?? []).map((h) => norm(str(h)))
  const ix = Object.fromEntries(COLUMNS.map((c) => [c.field, head.findIndex((h) => (c.keys as readonly string[]).includes(h))])) as Record<keyof CriterionFields, number>
  const missing = COLUMNS.filter((c) => ['id', 'category', 'label', 'kind', 'scale'].includes(c.field) && ix[c.field] < 0).map((c) => `« ${c.head} »`)
  if (missing.length) throw new Error(`Colonne${missing.length > 1 ? 's' : ''} ${missing.join(', ')} introuvable${missing.length > 1 ? 's' : ''} sur la première ligne. Pars du modèle (bouton « Modèle »).`)

  const seen = new Map<string, number>()
  table.slice(1).forEach((r, i) => {
    const line = i + 2
    const get = (f: keyof CriterionFields) => (ix[f] >= 0 ? r[ix[f]] : undefined)
    if (!r.some((v) => str(v) !== '')) return // ligne vide
    const id = str(get('id'))
    const fail = (reason: string) => errors.push({ line, id: id || undefined, reason })
    if (!id) return fail('identifiant manquant')
    if (!ID_RE.test(id)) return fail(`identifiant « ${id} » invalide (lettres, chiffres, « _ » ou « - », sans espace ni accent)`)
    if (seen.has(id)) return fail(`identifiant en double (déjà ligne ${seen.get(id)})`)
    seen.set(id, line)

    const label = str(get('label'))
    if (!label) return fail('libellé manquant')
    const category = str(get('category'))
    if (!category) return fail('catégorie manquante')

    const k = norm(str(get('kind')))
    const kind: CriterionKind | undefined = k.startsWith('fact') ? 'factual' : k.startsWith('subj') ? 'subjective' : undefined
    if (!kind) return fail(`type « ${str(get('kind'))} » inconnu (factuel ou subjectif)`)

    const sc = str(get('scale')).toLowerCase()
    const scale = (SCALE_ALIASES[norm(sc)] ?? sc) as CriterionScale
    if (!SCALE_VALUES.includes(scale)) return fail(`échelle « ${sc} » inconnue (${SCALE_VALUES.join(', ')})`)

    const options = [...new Set(str(get('options')).split('|').map((x) => x.trim()).filter(Boolean))]
    if (scale === 'choice' && ix.options >= 0 && options.length < 2) return fail('échelle choice : indique au moins 2 options séparées par « | »')

    // Codes des postes de l'installation (src/sportConfig.ts ; handball par défaut), sans tenir compte de la casse, et ceux
    // que le sport propose à l'ajout (volley : L, le libéro) : ses critères s'importent avant que le poste soit ajouté.
    const codes = positionCodes()
    const known = [...codes, ...sportProfile().extraPositions.map((p) => p.code).filter((c) => !codes.includes(c))]
    const posList = str(get('positions')).split(/[\s,;/|]+/).filter(Boolean).map((x) => known.find((c) => c.toUpperCase() === x.toUpperCase()) ?? x.toUpperCase())
    const badPos = posList.filter((x) => !known.includes(x))
    if (badPos.length) return fail(`poste${badPos.length > 1 ? 's' : ''} inconnu${badPos.length > 1 ? 's' : ''} : ${badPos.join(', ')} (${codes.join(', ')})`)

    const bool = (f: 'quick' | 'active', dflt: boolean) => {
      const v = get(f)
      if (typeof v === 'boolean') return v
      const s = norm(str(v))
      if (!s) return dflt
      if (YES.has(s)) return true
      if (NO.has(s)) return false
      return null
    }
    const quick = bool('quick', false)
    if (quick === null) return fail(`« mode rapide » : « ${str(get('quick'))} » n’est ni oui ni non`)
    const active = bool('active', true)
    if (active === null) return fail(`« actif » : « ${str(get('active'))} » n’est ni oui ni non`)

    const o = get('order')
    let order = i
    if (str(o) !== '') {
      const n = typeof o === 'number' ? o : Number(str(o).replace(',', '.'))
      if (!Number.isFinite(n)) return fail(`ordre « ${str(o)} » : un nombre est attendu`)
      order = n
    }

    const unit = str(get('unit'))
    const description = str(get('description'))
    rows.push({
      line,
      c: {
        id,
        category,
        label,
        kind,
        scale,
        // Rien n'est retiré ni réordonné : un export réimporté tel quel ne change rien.
        unit: unit || undefined,
        options: options.length ? options : undefined,
        description: description || undefined,
        positions: posList.length ? ([...new Set(posList)] as Position[]) : undefined,
        quick: quick || undefined,
        active,
        order,
      },
    })
  })
  return { rows, errors, absent: COLUMNS.map((c) => c.field).filter((f) => ix[f] < 0) }
}

/** Quelques écritures courantes de l'échelle, en plus des valeurs techniques. */
const SCALE_ALIASES: Record<string, CriterionScale> = {
  nombre: 'number',
  valeur: 'number',
  numerique: 'number',
  texte: 'text',
  choix: 'choice',
  note15: 'score5',
  note03: 'score3',
  note02: 'score2',
}

/** Critères → lignes (en-têtes compris), dans l'ordre d'affichage. */
export function toRows(criteria: CriterionFields[]): Cell[][] {
  const yes = (b?: boolean) => (b ? 'oui' : 'non')
  return [
    COLUMNS.map((c) => c.head),
    ...[...criteria]
      .sort((a, b) => a.order - b.order)
      .map((c) => [
        c.id,
        c.category,
        c.label,
        c.kind === 'factual' ? 'factuel' : 'subjectif',
        c.scale,
        c.unit ?? '',
        (c.options ?? []).join(' | '),
        c.description ?? '',
        (c.positions ?? []).join(', '),
        yes(c.quick),
        yes(c.active !== false),
        c.order,
      ]),
  ]
}

/** Aide de la colonne « postes » : les codes du sport de l'installation (« handball : GB, AG, ARG, DC, ARD, AD, PIV »). */
export const positionsHelp = () =>
  `Postes concernés : leurs codes, séparés par des virgules (${currentSport().sportName.toLowerCase()} : ${positionCodes().join(', ')}) ; vide = tous.`

/** Feuilles d'un classeur de critères : « Critères » puis « Aide » (colonnes et valeurs permises). */
export function toSheets(criteria: CriterionFields[]): Sheet[] {
  return [
    { name: 'Critères', rows: toRows(criteria), widths: [18, 24, 32, 11, 10, 8, 18, 50, 26, 12, 7, 7] },
    { name: 'Aide', rows: [['colonne', 'contenu'], ...COLUMNS.map((c) => [c.head, c.field === 'positions' ? positionsHelp() : c.help])], widths: [14, 110] },
  ]
}

// ---------- CSV ----------

/** CSV (séparateur « ; », « , » ou tabulation, deviné sur la première ligne ; guillemets à la mode Excel). */
export function parseCsv(text: string): Cell[][] {
  text = text.replace(/^﻿/, '')
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const sep = [';', '\t', ','].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const rows: Cell[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === sep) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  // Apostrophe ajoutée par l'export devant un texte qui commence par =, +, - ou @ (voir csvEsc) : retirée.
  return rows.map((r) => r.map((v) => (typeof v === 'string' && /^'[=+\-@]/.test(v) ? v.slice(1) : v)))
}

const csvEsc = (v: Cell) => {
  let s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v)
  // Texte qu'un tableur prendrait pour une formule : neutralisé (comme l'export des joueurs).
  if (/^[=+\-@]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV pour Excel en français (« ; », UTF-8 avec BOM). */
export const toCsv = (criteria: CriterionFields[]) => '﻿' + toRows(criteria).map((r) => r.map(csvEsc).join(';')).join('\r\n') + '\r\n'

// ---------- JSON ----------

export const JSON_FORMAT = 'handbase-criteres'

/** JSON : { format, version, criteria: [{ id, category, label, kind, scale, … }] } (champs du type Criterion). */
export function toJson(criteria: CriterionFields[], extra: Record<string, unknown> = {}) {
  const clean = [...criteria]
    .sort((a, b) => a.order - b.order)
    .map((c) =>
      Object.fromEntries(
        COLUMNS.map((col) => [col.field, col.field === 'active' ? c.active !== false : c[col.field]] as const).filter(
          ([, v]) => v !== undefined && !(Array.isArray(v) && !v.length),
        ),
      ),
    )
  return JSON.stringify({ format: JSON_FORMAT, version: 1, ...extra, criteria: clean }, null, 2) + '\n'
}

/**
 * JSON → lignes, pour passer par les mêmes contrôles que les tableurs. Accepte un tableau d'objets ou
 * { criteria: [...] } (ou « criteres ») ; clés : noms des champs (label, kind…) ou en-têtes du tableur (libellé, type…).
 * Les valeurs techniques (factual, subjective, booléens, tableaux de postes ou d'options) sont acceptées.
 */
export function rowsFromJson(text: string): Cell[][] {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new Error('Fichier JSON illisible.')
  }
  const list = Array.isArray(data) ? data : ((data as { criteria?: unknown; criteres?: unknown })?.criteria ?? (data as { criteres?: unknown })?.criteres)
  if (!Array.isArray(list)) throw new Error('Fichier JSON sans liste de critères (« criteria »).')
  const head = COLUMNS.map((c) => c.head)
  const rows = list.map((o: Record<string, unknown>) => {
    const byKey = new Map(Object.entries(o ?? {}).map(([k, v]) => [norm(k), v]))
    return COLUMNS.map((c) => {
      const v = c.keys.map((k) => byKey.get(k)).find((x) => x !== undefined)
      if (c.field === 'options' && Array.isArray(v)) return v.join(' | ')
      if (c.field === 'positions' && Array.isArray(v)) return v.join(', ')
      return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : (v as Cell)
    })
  })
  return [head, ...rows]
}

// ---------- Catégories (Réglages → Critères) ----------

/** Clé de comparaison d'une catégorie : espaces en trop et majuscules ignorés. */
export const categoryKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr')

/**
 * Catégories existantes, sans doublon (à la casse et aux espaces près), dans l'ordre d'affichage des réglages :
 * ordre des critères, ceux du type `first` (subjectifs / factuels) d'abord.
 */
export function categoryList(criteria: Pick<Criterion, 'category' | 'order' | 'kind' | 'deleted'>[], first?: CriterionKind): string[] {
  const sorted = criteria
    .filter((c) => !c.deleted && c.category.trim())
    .sort((a, b) => (first ? Number(b.kind === first) - Number(a.kind === first) : 0) || a.order - b.order)
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of sorted) {
    const k = categoryKey(c.category)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(c.category)
  }
  return out
}

/** Catégorie tapée : l'existante si elle y est déjà (à la casse et aux espaces près), sinon le texte nettoyé. */
export function resolveCategory(typed: string, existing: string[]): string {
  const k = categoryKey(typed)
  return existing.find((c) => categoryKey(c) === k) ?? typed.trim().replace(/\s+/g, ' ')
}
