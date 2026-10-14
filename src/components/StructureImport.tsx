import { useMemo, useState } from 'react'
import { db, newId, plural, saveMany, type Level, type Unit } from '../db'
import { useLevels, useUnits } from '../installation'
import {
  DEFAULT_OPTIONS,
  FIELD_LABELS,
  groupAnomalies,
  guessMapping,
  IMPORT_FIELDS,
  KIND_LABELS,
  planImport,
  planUndo,
  readStructureCsv,
  type CsvTable,
  type ImportOptions,
  type ImportPlan,
  type ImportRecord,
  type Kind,
  type Mapping,
} from '../structureImport'
import { ask, inform } from './Confirm'

/*
 * « Importer une structure (CSV) » (Réglages > Structure et sport, administrateurs) : fichier → correspondance des colonnes →
 * APERÇU (rien n'est écrit avant « Importer ») → écriture par lots (saveMany, synchro hb_upsert comme le reste) avec barre de
 * progression → « Annuler l'import » tant que rien n'a changé depuis. Calculs : src/structureImport.ts.
 */

const TAP = 'min-h-11 min-w-11'
const BATCH = 250
const KINDS: Kind[] = ['root', 'ligue', 'comite', 'club']

// Trace du dernier import : sur cet appareil (une par base locale).
const recordKey = () => `hb-structure-import:${db.name}`
function loadRecord(): ImportRecord | null {
  try {
    const raw = localStorage.getItem(recordKey())
    return raw ? (JSON.parse(raw) as ImportRecord) : null
  } catch {
    return null
  }
}
function storeRecord(r: ImportRecord | null) {
  try {
    if (r) localStorage.setItem(recordKey(), JSON.stringify(r))
    else localStorage.removeItem(recordKey())
  } catch {
    /* stockage plein ou bloqué : l'annulation ne sera simplement pas proposée */
  }
}

const pause = () => new Promise((r) => setTimeout(r, 0))

/** Écrit des unités par lots (l'écran reste utilisable), dans l'ordre donné (parents d'abord). */
async function writeInBatches(rows: Unit[], onProgress: (done: number) => void): Promise<Unit[]> {
  const out: Unit[] = []
  for (let i = 0; i < rows.length; i += BATCH) {
    out.push(...(await saveMany<Unit>('units', rows.slice(i, i + BATCH))))
    onProgress(Math.min(i + BATCH, rows.length))
    await pause()
  }
  return out
}

async function readFileText(file: File) {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    // CSV enregistré par Excel : Windows-1252.
    return new TextDecoder('windows-1252').decode(buf)
  }
}

export function StructureImport() {
  const levels = useLevels()
  const units = useUnits()
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState('')
  const [table, setTable] = useState<CsvTable | null>(null)
  const [mapping, setMapping] = useState<Mapping>({})
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_OPTIONS)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null)
  const [record, setRecord] = useState<ImportRecord | null>(loadRecord)
  const [done, setDone] = useState('')

  // Aperçu recalculé à chaque choix (quelques millisecondes pour quelques milliers de lignes). Identifiants : provisoires.
  const plan: ImportPlan | null = useMemo(() => {
    if (!table) return null
    let n = 0
    return planImport({ table, mapping, units, levels, options, newId: () => `nouvelle-${++n}` })
  }, [table, mapping, units, levels, options])

  async function pick(f: File) {
    setDone('')
    try {
      const t = readStructureCsv(await readFileText(f))
      if (!t.headers.length || !t.rows.length) return inform('Ce fichier ne contient aucune ligne de données.')
      setFile(f.name)
      setTable(t)
      setMapping(guessMapping(t.headers))
    } catch (e) {
      await inform(`Lecture impossible : ${(e as Error).message}`)
    }
  }

  async function run() {
    if (!table || !plan || plan.blocker || !plan.writes.length) return
    const c = plan.counts
    const created = KINDS.reduce((s, k) => s + c[k].create, 0)
    const updated = KINDS.reduce((s, k) => s + c[k].update, 0)
    const ok = await ask(
      `Importer : ${[created && `${plural(created, 'unité à créer', 'unités à créer')}`, updated && `${plural(updated, 'unité à mettre à jour', 'unités à mettre à jour')}`].filter(Boolean).join(' et ')} ? Les unités saisies à la main (pôles…) ne sont pas touchées. « Annuler l’import » reste possible tant que rien n’a changé.`,
      { ok: 'Importer', danger: false },
    )
    if (!ok) return
    // Plan définitif, avec de vrais identifiants, sur l'état le plus récent.
    const fresh = planImport({ table, mapping, units: await db.units.toArray(), levels: await db.levels.toArray(), options, newId })
    if (fresh.blocker) return inform(fresh.blocker)
    setProgress({ done: 0, total: fresh.writes.length, label: 'Import' })
    try {
      if (fresh.levelsToCreate.length) await saveMany<Level>('levels', fresh.levelsToCreate)
      const saved = await writeInBatches(
        fresh.writes.map((w) => w.row as Unit),
        (n) => setProgress({ done: n, total: fresh.writes.length, label: 'Import' }),
      )
      const after = new Map(saved.map((u) => [u.id, u.updatedAt]))
      const rec: ImportRecord = {
        at: Date.now(),
        file,
        items: fresh.writes.map((w) => ({ id: w.row.id, kind: w.kind, ...(w.before ? { before: w.before } : {}), after: after.get(w.row.id)! })),
      }
      storeRecord(rec)
      setRecord(rec)
      const fc = fresh.counts
      const list = (key: 'create' | 'update') =>
        KINDS.filter((k) => fc[k][key])
          .map((k) => plural(fc[k][key], KIND_LABELS[k][0], KIND_LABELS[k][1]))
          .join(', ')
      setDone(
        `Import terminé. ${[list('create') && `Créé : ${list('create')}.`, list('update') && `Mis à jour : ${list('update')}.`].filter(Boolean).join(' ')}`,
      )
      setTable(null)
    } catch (e) {
      await inform(`Import interrompu : ${(e as Error).message}. Ce qui a été écrit reste ; relancer l’import complète sans doublon.`)
    } finally {
      setProgress(null)
    }
  }

  async function undo() {
    if (!record) return
    const u = planUndo(record, await db.units.toArray(), await db.assignments.toArray())
    if (!u.ok) return inform(u.reason ?? 'Annulation impossible.')
    const ok = await ask(
      `Annuler l’import du ${new Date(record.at).toLocaleString('fr-FR')} (${record.file}) ? ${[u.remove.length && plural(u.remove.length, 'unité créée sera retirée', 'unités créées seront retirées'), u.restore.length && `${plural(u.restore.length, 'unité reprendra', 'unités reprendront')} leur version d’avant`].filter(Boolean).join(', ')}.`,
      { ok: 'Annuler l’import' },
    )
    if (!ok) return
    const total = u.restore.length + u.remove.length
    setProgress({ done: 0, total, label: 'Annulation' })
    try {
      // D'abord les unités remises en place (elles quittent les unités importées), puis les retraits, sous-unités d'abord.
      await writeInBatches(u.restore as Unit[], (n) => setProgress({ done: n, total, label: 'Annulation' }))
      await writeInBatches(u.remove as Unit[], (n) => setProgress({ done: u.restore.length + n, total, label: 'Annulation' }))
      storeRecord(null)
      setRecord(null)
      setDone('Import annulé : la structure est revenue à son état d’avant.')
    } catch (e) {
      await inform(`Annulation interrompue : ${(e as Error).message}`)
    } finally {
      setProgress(null)
    }
  }

  if (!open)
    return (
      <div className="flex flex-col gap-1">
        <button className={`btn-ghost ${TAP} text-xs`} onClick={() => setOpen(true)}>
          Importer une structure (CSV)
        </button>
        {record && <LastImport record={record} busy={!!progress} onUndo={() => void undo()} />}
        {done && <p className="text-[11px] text-accent">{done}</p>}
      </div>
    )

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel-2/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold">Importer une structure (CSV)</span>
        <button className={`btn-ghost ${TAP} text-xs`} disabled={!!progress} onClick={() => (setOpen(false), setTable(null))}>
          Fermer
        </button>
      </div>
      <p className="text-[11px] text-muted">
        Ligues, comités et clubs d’un fichier CSV (séparateur « ; » ou « , »), par exemple la liste officielle de la fédération. Rien
        n’est écrit avant « Importer » ; réimporter le même fichier met à jour sans créer de doublon.
      </p>
      <label className={`btn-primary ${TAP} cursor-pointer justify-center text-xs ${progress ? 'pointer-events-none opacity-60' : ''}`}>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void pick(f)
          }}
        />
        {table ? `Autre fichier (${file})` : 'Choisir le fichier CSV'}
      </label>

      {table && (
        <>
          <MappingEditor table={table} mapping={mapping} onChange={setMapping} />
          <OptionsEditor options={options} onChange={setOptions} />
          {plan && <Preview plan={plan} />}
          {progress ? (
            <Progress {...progress} />
          ) : (
            <button className={`btn-primary ${TAP} text-xs`} disabled={!plan || !!plan.blocker || !plan.writes.length} onClick={() => void run()}>
              {plan && !plan.blocker && !plan.writes.length ? 'Tout est déjà à jour' : 'Importer'}
            </button>
          )}
        </>
      )}
      {!table && progress && <Progress {...progress} />}
      {done && <p className="text-[11px] text-accent">{done}</p>}
      {record && !table && <LastImport record={record} busy={!!progress} onUndo={() => void undo()} />}
    </div>
  )
}

function LastImport({ record, busy, onUndo }: { record: ImportRecord; busy: boolean; onUndo: () => void }) {
  const created = record.items.filter((i) => !i.before).length
  const updated = record.items.length - created
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
      <span className="min-w-0 flex-1">
        Dernier import sur cet appareil : {new Date(record.at).toLocaleString('fr-FR')} ({record.file}) · {plural(created, 'créée', 'créées')}, {plural(updated, 'mise à jour', 'mises à jour')}
      </span>
      <button className={`btn-ghost ${TAP} text-xs`} disabled={busy} onClick={onUndo}>
        Annuler l’import
      </button>
    </div>
  )
}

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 100
  return (
    <div className="flex flex-col gap-1" role="status" aria-live="polite">
      <div className="h-2 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-muted">
        {label} : {done.toLocaleString('fr-FR')} / {total.toLocaleString('fr-FR')} unités ({pct} %)
      </span>
    </div>
  )
}

function MappingEditor({ table, mapping, onChange }: { table: CsvTable; mapping: Mapping; onChange: (m: Mapping) => void }) {
  // Exemple de chaque colonne : la première valeur non vide.
  const sample = table.headers.map((_, j) => table.rows.find((r) => r[j])?.[j] ?? '')
  return (
    <div className="flex flex-col gap-1">
      <span className="label mb-0">Colonnes ({plural(table.rows.length, 'ligne')})</span>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {IMPORT_FIELDS.map((f) => {
          const i = mapping[f]
          return (
            <label key={f} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0">{FIELD_LABELS[f]}</span>
              <select
                className="field min-h-11 min-w-0 flex-1 py-1 text-xs"
                value={i ?? ''}
                onChange={(e) => {
                  const next = { ...mapping }
                  if (e.target.value === '') delete next[f]
                  else next[f] = Number(e.target.value)
                  onChange(next)
                }}
              >
                <option value="">— aucune —</option>
                {table.headers.map((h, j) => (
                  <option key={j} value={j}>
                    {h || `Colonne ${j + 1}`}
                    {sample[j] ? ` (ex. ${sample[j].slice(0, 24)})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function OptionsEditor({ options, onChange }: { options: ImportOptions; onChange: (o: ImportOptions) => void }) {
  const box = (k: 'ligues' | 'comites' | 'clubs' | 'root', label: string) => (
    <label className={`flex ${TAP} cursor-pointer items-center gap-2 text-xs`}>
      <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={options[k]} onChange={(e) => onChange({ ...options, [k]: e.target.checked })} />
      {label}
    </label>
  )
  return (
    <div className="flex flex-col gap-1">
      <span className="label mb-0">Importer</span>
      <div className="flex flex-wrap gap-x-4">
        {box('ligues', 'Ligues')}
        {box('comites', 'Comités')}
        {box('clubs', 'Clubs')}
      </div>
      {box('root', 'Ranger les ligues sous une unité Fédération (créée si absente)')}
      {options.root && (
        <input
          className="field min-h-11 py-1 text-xs"
          aria-label="Nom de l’unité Fédération"
          value={options.rootName}
          onChange={(e) => onChange({ ...options, rootName: e.target.value })}
        />
      )}
    </div>
  )
}

function Preview({ plan }: { plan: ImportPlan }) {
  if (plan.blocker) return <p className="text-xs text-amber-300">{plan.blocker}</p>
  const c = plan.counts
  const groups = groupAnomalies(plan.anomalies)
  return (
    <div className="flex flex-col gap-2">
      <span className="label mb-0">Aperçu (rien n’est encore écrit)</span>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[11px] text-muted">
            <th className="py-1 font-normal" />
            <th className="py-1 text-right font-normal">À créer</th>
            <th className="py-1 text-right font-normal">À mettre à jour</th>
            <th className="py-1 text-right font-normal">Inchangées</th>
          </tr>
        </thead>
        <tbody>
          {KINDS.filter((k) => c[k].create + c[k].update + c[k].same).map((k) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1.5 capitalize">{KIND_LABELS[k][1]}</td>
              <td className="py-1.5 text-right font-bold">{c[k].create.toLocaleString('fr-FR')}</td>
              <td className="py-1.5 text-right">{c[k].update.toLocaleString('fr-FR')}</td>
              <td className="py-1.5 text-right text-muted">{c[k].same.toLocaleString('fr-FR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {plan.levelsToCreate.length > 0 && <p className="text-[11px] text-muted">Niveaux ajoutés : {plan.levelsToCreate.map((l) => l.name).join(', ')}.</p>}
      {groups.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="label mb-0">À savoir</span>
          {groups.map((g) => (
            <details key={g.type} className="rounded-md border border-line px-2 text-xs">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2">
                <span>{g.label}</span>
                <span className="font-bold">{g.items.length.toLocaleString('fr-FR')}</span>
              </summary>
              <ul className="max-h-48 overflow-y-auto pb-2 text-[11px] text-muted">
                {g.items.slice(0, 200).map((a, i) => (
                  <li key={i}>
                    {a.line ? `Ligne ${a.line} : ` : ''}
                    {a.detail}
                  </li>
                ))}
                {g.items.length > 200 && <li>… et {g.items.length - 200} autres</li>}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}
