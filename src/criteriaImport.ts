import { db, saveMany, today, type Criterion } from './db'
import { SPORT_CONTENT, sportContent } from './sportContent'
import { COLUMNS, parseCsv, parseRows, rowsFromJson, toCsv, toJson, toSheets, type CriterionFields, type ParsedFile, type RowError } from './criteriaFormat'
import { readXlsx, writeXlsx } from './xlsx'
import { appSlug } from './appBrand'

/*
 * Import / export des critères par les administrateurs (Réglages > Critères et listes).
 *
 * Les critères ne sont plus livrés dans le code : ils viennent tous de la base (hb_criteria), partagés par tous.
 * Un import écrit les critères comme une modification ordinaire (save : date de modification réelle, file d'envoi),
 * donc ils partent au serveur (hb_upsert, réservé aux administrateurs) et arrivent sur tous les appareils.
 *
 * Règle de transition (anciens critères « livrés » : updatedAt = 0, jamais envoyés au serveur) : voir
 * retireUnpublishedCriteria().
 */

/** Champs comparés entre le fichier et la base. */
const FIELDS = COLUMNS.map((c) => c.field)

/** Valeur comparable d'un champ (vide, absent et tableau vide se valent). */
const cmp = (c: Partial<CriterionFields>, f: keyof CriterionFields) => {
  let v = f === 'active' ? c.active !== false : f === 'quick' ? !!c.quick : c[f]
  if (typeof v === 'string') v = v.trim()
  if (f === 'quick' && !v) v = undefined
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return ''
  return JSON.stringify(v)
}

/** Libellés des champs, pour le détail des modifications. */
const FIELD_LABEL = Object.fromEntries(COLUMNS.map((c) => [c.field, c.head])) as Record<keyof CriterionFields, string>

export interface CriteriaPlan {
  mode: 'fusion' | 'remplacement'
  /** Absents de la base partagée : nouveaux, ou présents seulement sur cet appareil (anciens critères livrés). */
  added: { c: CriterionFields; local: boolean }[]
  /** Différents de la base : champs modifiés ; `risky` : type ou échelle changé alors que des valeurs existent. */
  changed: { c: CriterionFields; before: Criterion; fields: string[]; risky: boolean }[]
  unchanged: number
  errors: RowError[]
  /** Remplacement : critères absents du fichier, masqués (actif = non), jamais supprimés. */
  hidden: Criterion[]
  /** Critères de cet appareil jamais partagés et absents du fichier : retirés de l'appareil après l'import. */
  dropped: { c: Criterion; values: number }[]
}

/** Lit un fichier de critères (.xlsx, .csv, .json). */
export async function readCriteriaFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) return parseRows(await readXlsx(await file.arrayBuffer(), 'Critères'))
  if (name.endsWith('.xls')) throw new Error('Ancien format Excel (.xls) : enregistre le fichier en .xlsx ou en CSV.')
  const buf = await file.arrayBuffer()
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    // CSV enregistré par Excel « CSV (séparateur : point-virgule) » : Windows-1252.
    text = new TextDecoder('windows-1252').decode(buf)
  }
  if (name.endsWith('.json') || /^\s*[[{]/.test(text.replace(/^﻿/, ''))) return parseRows(rowsFromJson(text))
  return parseRows(parseCsv(text))
}

/** Nombre de valeurs (mesures et notes d'avis) enregistrées par critère. */
async function valueCounts() {
  const n = new Map<string, number>()
  const add = (id: string) => n.set(id, (n.get(id) ?? 0) + 1)
  await db.measurements.each((m) => !m.deleted && add(m.criterionId))
  await db.evaluations.each((e) => {
    if (!e.deleted) for (const k of Object.keys(e.scores ?? {})) add(k)
  })
  return n
}

/** Compare le fichier à la base de l'appareil (à jour : l'écran d'import attend la fin de la synchronisation). */
export async function planCriteria(parsed: ParsedFile, mode: CriteriaPlan['mode']): Promise<CriteriaPlan> {
  const all = await db.criteria.toArray()
  const cur = new Map(all.map((c) => [c.id, c]))
  const values = await valueCounts()
  const plan: CriteriaPlan = { mode, added: [], changed: [], unchanged: 0, errors: parsed.errors, hidden: [], dropped: [] }
  const inFile = new Set(parsed.rows.map((r) => r.c.id))
  for (const row of parsed.rows) {
    const b = cur.get(row.c.id)
    // Colonne absente du fichier : la valeur actuelle du critère est gardée.
    const c: CriterionFields = b ? { ...row.c, ...Object.fromEntries(parsed.absent.map((f) => [f, b[f]])) } : row.c
    if (!b || b.deleted || !b.updatedAt) {
      plan.added.push({ c, local: !!b && !b.deleted })
      continue
    }
    const fields = FIELDS.filter((f) => cmp(c, f) !== cmp(b, f))
    if (!fields.length) plan.unchanged++
    else
      plan.changed.push({
        c,
        before: b,
        fields: fields.map((f) => FIELD_LABEL[f]),
        risky: (c.kind !== b.kind || c.scale !== b.scale) && (values.get(c.id) ?? 0) > 0,
      })
  }
  for (const b of all) {
    if (b.deleted || inFile.has(b.id)) continue
    if (!b.updatedAt) plan.dropped.push({ c: b, values: values.get(b.id) ?? 0 })
    else if (mode === 'remplacement' && b.active !== false) plan.hidden.push(b)
  }
  return plan
}

/** Applique l'import : une seule écriture groupée (tout ou rien), envoyée ensuite au serveur par la synchronisation. */
export async function applyCriteria(plan: CriteriaPlan) {
  const now = Date.now()
  const cur = new Map((await db.criteria.toArray()).map((c) => [c.id, c]))
  const rows: Omit<Criterion, 'updatedAt'>[] = [
    ...[...plan.added, ...plan.changed].map(({ c }) => {
      const b = cur.get(c.id)
      // Les champs du fichier remplacent ceux de la base (un champ vide efface la valeur) ; la signature est gardée.
      const base = b ? Object.fromEntries(Object.entries(b).filter(([k]) => !(FIELDS as string[]).includes(k))) : {}
      return { ...base, ...c, deleted: false, importedAt: now } as Omit<Criterion, 'updatedAt'>
    }),
    ...plan.hidden.map((b) => ({ ...b, active: false, importedAt: now })),
  ]
  await saveMany<Criterion>('criteria', rows)
  await retireUnpublishedCriteria()
  return { added: plan.added.length, changed: plan.changed.length, hidden: plan.hidden.length }
}

/**
 * Règle de transition (version sans liste de critères dans le code).
 *
 * Jusqu'ici chaque appareil créait lui-même ses critères « livrés » (updatedAt = 0) ; ils n'étaient jamais envoyés au
 * serveur, seuls ceux modifiés par un administrateur y sont. Les retirer d'un coup laisserait les mesures et les avis
 * sans critère à l'écran. Règle retenue, la plus simple et sûre :
 *  - tant qu'aucun critère importé n'est présent (champ importedAt, posé par applyCriteria et reçu du serveur), on
 *    garde tous les critères de l'appareil, même jamais publiés ;
 *  - dès qu'un critère importé est là (import fait sur cet appareil, ou reçu par la synchronisation), les critères
 *    jamais publiés (updatedAt = 0) sont retirés de l'appareil : la base partagée fait foi. Ceux qui sont aussi sur le
 *    serveur ne sont pas concernés : la synchronisation les a déjà remplacés par la version du serveur (updatedAt > 0),
 *    et une ligne jamais publiée ne peut pas attendre d'envoi (save() lui donne une date réelle).
 * (« Le serveur a au moins un critère » ne suffirait pas : sur la base de production, quelques critères modifiés par un
 * administrateur y sont déjà, sans la liste complète.)
 * Pour ne rien perdre, l'administrateur reprend la liste existante : « Exporter » sur un appareil à jour, puis importer
 * ce fichier tel quel. Rien ne change à l'écran ; mesures et avis restent rattachés par identifiant.
 * Appelée après chaque synchronisation (sync.ts) et après un import.
 */
export async function retireUnpublishedCriteria() {
  await db.transaction('rw', db.criteria, async () => {
    const all = await db.criteria.toArray()
    if (!all.some((c) => c.importedAt && !c.deleted)) return
    const gone = all.filter((c) => !c.updatedAt).map((c) => c.id)
    if (gone.length) await db.criteria.bulkDelete(gone)
  })
}

/** Critères de l'appareil jamais partagés (anciens critères livrés) : à reprendre par un import. */
export const unpublishedCount = () => db.criteria.filter((c) => !c.updatedAt && !c.deleted).count()

// ---------- Export ----------

function download(name: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Exporte tous les critères de l'appareil (masqués compris), dans le format de l'import. */
export async function exportCriteria(format: 'xlsx' | 'csv' | 'json') {
  const list = (await db.criteria.toArray()).filter((c) => !c.deleted)
  const name = `${appSlug()}-criteres-${today()}`
  if (format === 'xlsx')
    download(`${name}.xlsx`, writeXlsx(toSheets(list)) as Uint8Array<ArrayBuffer>, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  else if (format === 'csv') download(`${name}.csv`, toCsv(list), 'text/csv;charset=utf-8')
  else download(`${name}.json`, toJson(list, { exportedAt: new Date().toISOString() }), 'application/json')
  return list.length
}

// ---------- Démonstration ----------

/**
 * Critères de la démonstration (loadDemo) : lus dans le fichier du sport de l'installation (src/sportContent.ts ; handball :
 * public/demo/criteres-demo.json ; volley : public/demo/criteres-volley.json ; fichiers de données, pas le code), ajoutés
 * seulement s'ils manquent, sur l'appareil seulement (comme le reste de la démo : pas d'envoi au serveur ; updatedAt = 0,
 * comme les anciens critères livrés : un vrai import les remplace, voir retireUnpublishedCriteria). Fichier d'un sport vide :
 * ceux du handball, pour que la démonstration reste complète.
 */
export async function loadDemoCriteria() {
  const read = async (file: string) => {
    const res = await fetch(`${import.meta.env.BASE_URL}${file}`)
    if (!res.ok) throw new Error('Critères de démonstration introuvables.')
    return parseRows(rowsFromJson(await res.text())).rows
  }
  let rows = await read(sportContent().demoCriteria)
  if (!rows.length) rows = await read(SPORT_CONTENT.handball.demoCriteria)
  let n = 0
  await db.transaction('rw', db.criteria, async () => {
    const have = new Set((await db.criteria.toArray()).filter((c) => !c.deleted).map((c) => c.id))
    const missing = rows.filter(({ c }) => !have.has(c.id)).map(({ c }) => ({ ...c, updatedAt: 0 }) as Criterion)
    n = missing.length
    await db.criteria.bulkPut(missing)
  })
  return n
}
