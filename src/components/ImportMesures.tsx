import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { alive, db, fmtDate, newId, plural, saveMany, today, type Criterion, type Measurement, type Player } from '../db'
import {
  autoChecked,
  FORMAT_LABEL,
  frNum,
  importable,
  parseTable,
  propose,
  rangeFromThresholds,
  toWrite,
  willSave,
  type Alert,
  type Candidate,
  type ColRole,
  type ImportChoices,
  type ImportCriterion,
  type PastedTable,
  type ProposalRow,
  type ProposedValue,
  type ValueDecision,
} from '../importMesures'
import { nameKey } from '../nameMatch'
import { keepProposition } from '../propositions'
import type { PropChoix, PropContexte } from '../propositionsCore'
import { can, useRole } from '../roles'
import { FormActions, FormWindow } from './FormWindow'
import { flash } from './ItemMenu'
import { useReperes } from './Medal'
import { getMe, Icon } from './ui'

/*
 * « Coller un tableau de mesures » (étape 1 du projet « Serveur MCP Nextar ») : le préparateur colle le tableau que SON IA a
 * lu sur sa feuille (ou un tableur, un CSV, des lignes de texte) ; Nextar propose, le coach valide, et les mesures sont
 * écrites comme dans une séance de tests (src/pages/MeasureSession.tsx : table measurements, saveMany, même synchronisation,
 * même auteur). Rien n'est écrit avant « Enregistrer N mesures » ; ensuite « Défaire » quelques secondes (retire seulement
 * ce qui vient d'être créé), comme les actions de la barre Demander.
 *
 * Tout se passe sur l'appareil : AUCUNE IA n'est appelée ici, aucune donnée de joueur ne part.
 *
 *  - ImportMesures : la fenêtre (coller, date des tests, puis l'écran « À valider »), ouverte depuis le ⋮ d'un événement, d'un
 *    groupe (joueurs recherchés parmi les leurs) ou de la liste Joueurs (toute la base).
 *  - ImportReview : l'écran « À valider », réutilisable : il prend des lignes BRUTES (cellules texte), d'où qu'elles viennent
 *    (presse-papiers aujourd'hui ; serveur MCP ou caméra plus tard), et fait le reste (src/importMesures.ts, propose).
 *
 * Trace : chaque mesure importée porte `imported` ({ by, at } : qui a validé, quand), champ libre de la ligne (data jsonb,
 * gardé tel quel par hb_upsert) : pas de SQL. Le commentaire du préparateur (`note`) n'est pas touché.
 */

const UNDO_MS = 10_000

export type ImportScope = { kind: 'evenement' | 'groupe'; id?: string; name: string; players: Player[]; nums?: Record<string, string> } | { kind: 'tous' }

export const fullName = (p: Pick<Player, 'firstName' | 'lastName'>) => `${p.lastName.toUpperCase()} ${p.firstName}`
const yearOf = (p: Pick<Player, 'birthDate'>) => (p.birthDate && /^\d{4}/.test(p.birthDate) ? p.birthDate.slice(0, 4) : '')

/** Choix faits sur l'écran « À valider », tels qu'ils sont gardés avec une proposition (src/propositionsCore.ts). */
export type ReviewState = { choices: ImportChoices; decisions: Record<string, ValueDecision>; checks: Record<number, boolean> }
export const toChoix = (s: ReviewState): PropChoix => ({ ...s.choices, decisions: s.decisions, checks: s.checks })
export const fromChoix = (c: PropChoix | undefined): Partial<ReviewState> =>
  c
    ? {
        choices: { columns: c.columns as ImportChoices['columns'], players: c.players, values: c.values },
        decisions: (c.decisions ?? {}) as Record<string, ValueDecision>,
        checks: c.checks ?? {},
      }
    : {}

/** Contexte d'une proposition gardée depuis cette fenêtre (portée, date, format, joueurs du contexte). */
function scopeContexte(scope: ImportScope, date: string, table: PastedTable | null): PropContexte {
  return {
    portee: scope.kind,
    ...(scope.kind === 'tous' ? {} : { ...(scope.id ? { id: scope.id } : {}), nom: scope.name, joueurs: scope.players.map((p) => p.id) }),
    date,
    ...(table ? { format: table.format, ...(table.free ? { libre: true } : {}) } : {}),
  }
}

/** Fenêtre « Coller un tableau de mesures ». */
export function ImportMesures({ scope, onClose }: { scope: ImportScope; onClose: () => void }) {
  const role = useRole()
  const [text, setText] = useState('')
  const [date, setDate] = useState(today())
  const [table, setTable] = useState<PastedTable | null>(null)
  const [done, setDone] = useState(false)
  const [msg, setMsg] = useState('')
  // « Garder pour plus tard » : le tableau va dans la boîte « À valider » (src/propositions.ts), rien n'est enregistré.
  const keep = async (t: PastedTable, state?: ReviewState): Promise<string | null> => {
    const r = await keepProposition({ rows: t.rows, contexte: { ...scopeContexte(scope, date, t), ...(state ? { choix: toChoix(state) } : {}) } })
    if ('error' in r) return r.error
    setDone(true)
    flash('Gardé dans « À valider » : la pastille en haut de l’écran y mène.')
    onClose()
    return null
  }
  const keepText = async () => {
    const t = parseTable(text)
    if (!t.rows.length) return setMsg('Rien à garder : colle d’abord le tableau.')
    const err = await keep(t)
    if (err) setMsg(err)
  }
  // Toute la base (⋮ de la liste Joueurs) : fiches de la base, sans les fiches hors cadre ni les fiches fondues.
  const all = useLiveQuery(
    async (): Promise<Player[] | null> => (scope.kind === 'tous' ? alive(await db.players.toArray()).filter((p) => p.review !== 'refused' && !p.mergedInto) : null),
    [scope.kind],
  )
  const players = scope.kind === 'tous' ? (all ?? []) : scope.players
  const where =
    scope.kind === 'tous'
      ? `parmi toute la base${all ? ` (${plural(all.length, 'fiche')})` : ''}`
      : `parmi les ${plural(scope.players.length, 'joueur')} ${scope.kind === 'evenement' ? 'de l’événement' : 'du groupe'} « ${scope.name} »`

  if (!can.editMeasurements(role)) return null

  const read = () => {
    const t = parseTable(text)
    if (!t.rows.length) return setMsg('Rien à lire : colle d’abord le tableau.')
    setMsg('')
    setTable(t)
  }
  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t) setText(t)
    } catch {
      setMsg('Le presse-papiers n’est pas accessible : appuie longuement dans la zone et choisis « Coller ».')
    }
  }

  return (
    <FormWindow title={table ? 'À valider' : 'Coller un tableau de mesures'} onClose={onClose} width={820} guard={!done && (!!text.trim() || !!table)}>
      {table ? (
        <ImportReview
          rows={table.rows}
          free={!!table.free}
          formatLabel={FORMAT_LABEL[table.format]}
          players={players}
          nums={scope.kind === 'tous' ? undefined : scope.nums}
          date={date}
          where={where}
          onBack={() => setTable(null)}
          onSaved={() => setDone(true)}
          onUndone={() => setDone(false)}
          onKeep={(s) => keep(table, s)}
          onClose={onClose}
        />
      ) : (
        <>
          <p className="text-xs text-muted">
            Colle le tableau lu par ton IA sur la feuille de tests (Claude, Gemini, ChatGPT : « mets-moi ça en tableau »), un tableau Excel ou Google Sheets, un
            CSV, ou des lignes comme « Lucas M. 1,86 38 ». Joueurs recherchés {where}. Rien n’est enregistré avant ta validation, et rien ne quitte l’appareil.
          </p>
          <textarea
            className="field min-h-[38vh] font-mono text-[13px] leading-snug"
            aria-label="Tableau à coller"
            spellCheck={false}
            placeholder={'| Joueur | Sprint 10 m (s) | CMJ (cm) | Taille |\n|---|---|---|---|\n| Lucas Martin | 1,86 | 38 | 172 |'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="min-w-0">
              <span className="label">Date des tests</span>
              <input type="date" required className="field min-h-11 w-44" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            {typeof navigator !== 'undefined' && !!navigator.clipboard?.readText && (
              <button type="button" className="btn-ghost min-h-11" onClick={() => void paste()}>
                <Icon name="copy" /> Coller
              </button>
            )}
          </div>
          <p className="-mt-1 text-[11px] text-muted">Une colonne « Date » dans le tableau l’emporte sur cette date.</p>
          {msg && (
            <p className="text-xs text-spread-lo" role="status">
              {msg}
            </p>
          )}
          <FormActions>
            <button type="button" className="btn-primary" disabled={!text.trim() || !date} onClick={read}>
              Lire le tableau
            </button>
            {/* Pas le temps de valider maintenant : le tableau attend dans la boîte « À valider » (pastille de l'en-tête). */}
            <button type="button" className="btn-ghost" disabled={!text.trim() || !date} onClick={() => void keepText()}>
              Garder pour plus tard
            </button>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Annuler
            </button>
          </FormActions>
        </>
      )}
    </FormWindow>
  )
}

export const CONF: Record<ProposalRow['match']['confidence'], { label: string; cls: string }> = {
  sur: { label: 'Sûr', cls: 'bg-gain/15 text-gain' },
  verifier: { label: 'À vérifier', cls: 'bg-spread-lo/15 text-spread-lo' },
  introuvable: { label: 'Introuvable', cls: 'bg-panel-2 text-muted' },
}

const ROLE_LABEL: Record<Exclude<ColRole['k'], 'test'>, string> = {
  joueur: 'Joueur (nom et prénom)',
  nom: 'Nom',
  prenom: 'Prénom',
  maillot: 'N° de maillot',
  annee: 'Année de naissance',
  date: 'Date',
  ignore: 'Ignorée',
  inconnue: 'À relier à un test',
}

/**
 * Écran « À valider » : une ligne par joueur du tableau (joueur proposé, confiance, valeurs et alertes), colonnes à relier,
 * case par ligne, « Enregistrer N mesures » puis « Défaire ». Prend des lignes brutes (`rows`, en-tête éventuel en tête).
 */
export function ImportReview({
  rows,
  free = false,
  formatLabel,
  players,
  nums,
  date,
  where,
  onBack,
  backLabel = '‹ Modifier le tableau',
  onSaved,
  onUndone,
  onKeep,
  initial,
  extraActions,
  onClose,
}: {
  rows: string[][]
  free?: boolean
  formatLabel?: string
  /** Joueurs du contexte. */
  players: Player[]
  /** Numéros de maillot du contexte (événement), par fiche. */
  nums?: Record<string, string>
  /** Date des tests choisie (une colonne date du tableau l'emporte). */
  date: string
  where?: string
  onBack?: () => void
  backLabel?: string
  /** Après « Enregistrer N mesures » : mesures créées, lignes du tableau qui portaient une valeur et lignes enregistrées. */
  onSaved?: (ids: string[], info: { lignes: number; enregistrees: number }) => void
  onUndone?: () => void
  /** « Garder pour plus tard » (boîte « À valider ») avec les choix déjà faits ; renvoie un message d'erreur ou null. */
  onKeep?: (state: ReviewState) => Promise<string | null> | void
  /** Choix déjà faits (proposition rouverte depuis la boîte). */
  initial?: Partial<ReviewState>
  /** Boutons de plus au pied (« Rejeter » dans la boîte). */
  extraActions?: ReactNode
  onClose: () => void
}) {
  const criteria = useLiveQuery(() => db.criteria.orderBy('order').toArray().then(alive), [])
  const crits = useMemo(() => importable((criteria ?? []) as (Criterion & ImportCriterion)[]), [criteria])
  const critById = useMemo(() => new Map(crits.map((c) => [c.id, c])), [crits])
  const reperes = useReperes()
  // Bornes connues : celles tirées des repères de l'installation (seuils des médailles), sinon fourchettes larges du module.
  const ranges = useMemo(() => {
    const out: Record<string, [number, number]> = {}
    for (const rc of reperes.criteria) {
      const r = rangeFromThresholds(rc.lines.flatMap((l) => [l.bronze, l.argent, l.or]).filter((x): x is number => typeof x === 'number'))
      if (r) out[rc.criterionId] = r
    }
    return out
  }, [reperes])
  const cands = useMemo<Candidate[]>(() => players.map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate, num: nums?.[p.id] })), [players, nums])
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])

  const [choices, setChoices] = useState<ImportChoices>(initial?.choices ?? {})
  const [decisions, setDecisions] = useState<Record<string, ValueDecision>>(initial?.decisions ?? {})
  const [checks, setChecks] = useState<Record<number, boolean>>(initial?.checks ?? {})
  const [picking, setPicking] = useState<number | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [allCols, setAllCols] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<{ rows: Measurement[]; players: number; dates: string[] } | null>(null)
  const [undoLeft, setUndoLeft] = useState(0)
  const [undone, setUndone] = useState('')

  const ctxBase = useMemo(() => ({ criteria: crits, players: cands, date, today: today(), ranges }), [crits, cands, date, ranges])
  // Joueurs proposés (sans les doublons) : leurs mesures déjà en base sont lues pour signaler les doublons.
  const first = useMemo(() => propose(rows, { ...ctxBase, existing: [] }, choices, free), [rows, ctxBase, choices, free])
  const ids = useMemo(() => [...new Set(first.rows.map((r) => r.match.playerId).filter((x): x is string => !!x))].sort(), [first])
  const existing = useLiveQuery(async (): Promise<Measurement[]> => (ids.length ? db.measurements.where('playerId').anyOf(ids).toArray() : []), [ids.join(',')])
  const proposal = useMemo(() => propose(rows, { ...ctxBase, existing: existing ?? [] }, choices, free), [rows, ctxBase, existing, choices, free])

  const dkey = (r: ProposalRow, v: ProposedValue) => `${r.line}:${v.col}`
  const isChecked = (r: ProposalRow) => !!r.match.playerId && (checks[r.line] ?? autoChecked(r, decisions))
  const toSave = toWrite(proposal, isChecked, decisions)
  const counts = { sur: 0, verifier: 0, introuvable: 0 }
  for (const r of proposal.rows) counts[r.match.confidence]++
  const testCols = proposal.columns.filter((c) => c.role.k === 'test').length
  const shownCols = proposal.columns.filter((c) => allCols || c.role.k === 'inconnue' || c.doubt)

  // « Défaire » : quelques secondes après l'enregistrement.
  useEffect(() => {
    if (!saved) return
    const end = Date.now() + UNDO_MS
    setUndoLeft(Math.ceil(UNDO_MS / 1000))
    const t = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setUndoLeft(left)
      if (!left) window.clearInterval(t)
    }, 250)
    return () => window.clearInterval(t)
  }, [saved])

  const setColumn = (i: number, role: ColRole) => setChoices((c) => ({ ...c, columns: { ...c.columns, [i]: role } }))
  const setPlayer = (line: number, id: string) => {
    setChoices((c) => ({ ...c, players: { ...c.players, [line]: id } }))
    setChecks((c) => {
      const n = { ...c }
      delete n[line]
      return n
    })
    setPicking(null)
  }
  const setValue = (key: string, raw: string) => {
    setChoices((c) => ({ ...c, values: { ...c.values, [key]: raw } }))
    setDecisions((d) => {
      const n = { ...d }
      delete n[key]
      return n
    })
  }
  const decide = (key: string, d: ValueDecision) => setDecisions((x) => ({ ...x, [key]: d }))

  async function save() {
    if (!toSave.length) return
    setBusy(true)
    setError('')
    const author = getMe() || undefined
    const at = new Date().toISOString()
    try {
      // Comme une séance de tests : une seule transaction, même table, même file d'envoi, même auteur ; et la trace.
      const created = await saveMany<Measurement>(
        'measurements',
        toSave.map((m) => ({ id: newId(), ...m, author, imported: { ...(author ? { by: author } : {}), at } })),
      )
      setSaved({ rows: created, players: new Set(created.map((m) => m.playerId)).size, dates: [...new Set(created.map((m) => m.date))].sort() })
      setUndone('')
      // Lignes du tableau qui portaient une valeur, et celles dont au moins une mesure vient d'être écrite (boîte « À valider » :
      // proposition validée, ou validée en partie).
      const lignes = proposal.rows.filter((r) => r.values.some((v) => v.value !== undefined)).length
      const enregistrees = proposal.rows.filter((r) => r.match.playerId && isChecked(r) && r.values.some((v) => willSave(v, decisions[dkey(r, v)]))).length
      onSaved?.(
        created.map((m) => m.id),
        { lignes, enregistrees },
      )
    } catch (e) {
      setError(`Mesures non enregistrées : ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  async function keep() {
    if (!onKeep) return
    setBusy(true)
    setError('')
    try {
      const err = await onKeep({ choices, decisions, checks })
      if (err) setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function undo() {
    if (!saved) return
    setBusy(true)
    try {
      // Seulement ce qui vient d'être créé : chaque mesure importée passe en supprimée (propagée aux autres appareils).
      const now = await db.measurements.bulkGet(saved.rows.map((m) => m.id))
      const mine = now.filter((m): m is Measurement => !!m && !m.deleted)
      await saveMany<Measurement>('measurements', mine.map((m) => ({ ...m, deleted: true })))
      setUndone(`C’est défait : ${plural(mine.length, 'mesure retirée', 'mesures retirées')}.`)
      setSaved(null)
      onUndone?.()
    } catch (e) {
      setError(`Impossible de défaire : ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  if (criteria === undefined) return <div className="py-10 text-center text-sm text-muted">Chargement…</div>

  if (saved || undone)
    return (
      <div className="flex flex-col gap-3 py-2">
        {saved ? (
          <p className="text-sm font-bold text-gain" role="status">
            ✓ {plural(saved.rows.length, 'mesure enregistrée', 'mesures enregistrées')} pour {plural(saved.players, 'joueur')} ({saved.dates.map((d) => fmtDate(d)).join(', ')}).
          </p>
        ) : (
          <p className="text-sm font-bold" role="status">
            {undone}
          </p>
        )}
        {saved && <p className="text-xs text-muted">Elles sont sur la fiche de chaque joueur (onglet Tests), marquées « importé, validé par {getMe() || 'toi'} ».</p>}
        {error && <p className="text-xs text-loss">{error}</p>}
        <FormActions>
          <button type="button" data-autofocus className="btn-primary" onClick={onClose}>
            OK
          </button>
          {saved && undoLeft > 0 && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void undo()}>
              <Icon name="undo" /> Défaire ({undoLeft} s)
            </button>
          )}
        </FormActions>
      </div>
    )

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-muted">
        <span className="font-bold text-fg">{plural(proposal.rows.length, 'ligne')}</span>
        {' : '}
        <span className="text-gain">{counts.sur} sûre{counts.sur > 1 ? 's' : ''}</span>
        {counts.verifier > 0 && <span className="text-spread-lo"> · {counts.verifier} à vérifier</span>}
        {counts.introuvable > 0 && <span> · {counts.introuvable} introuvable{counts.introuvable > 1 ? 's' : ''}</span>}
        <span className="block text-[11px]">
          Lu comme {formatLabel ?? 'tableau'} · {plural(testCols, 'test')} ·{' '}
          {proposal.columns.some((c) => c.role.k === 'date') ? `dates du tableau (sinon le ${fmtDate(date)})` : `tests du ${fmtDate(date)}`}
          {where ? ` · joueurs ${where}` : ''}.
        </span>
      </div>

      {/* Colonnes : celles à relier (ou en doute) toujours visibles ; les autres sur demande. */}
      <section className="card p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-extrabold tracking-wider text-muted uppercase">Colonnes</h3>
          <button type="button" className="min-h-11 px-2 text-xs font-bold text-accent" onClick={() => setAllCols((x) => !x)} aria-expanded={allCols}>
            {allCols ? 'Masquer les colonnes reconnues' : `Voir les ${proposal.columns.length} colonnes`}
          </button>
        </div>
        {!shownCols.length && <p className="text-[11px] text-muted">Toutes les colonnes sont reconnues.</p>}
        <div className="flex flex-col divide-y divide-line">
          {shownCols.map((col) => {
            const value = col.role.k === 'test' ? `t:${col.role.criterionId}` : col.role.k
            const warn = col.role.k === 'inconnue' || col.doubt
            return (
              <label key={col.index} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <span className="min-w-0 flex-1 text-xs">
                  <span className="font-bold">« {col.header} »</span>
                  {warn && <span className="ml-2 rounded-full bg-spread-lo/15 px-2 py-0.5 text-[11px] font-bold text-spread-lo">{col.doubt ? 'à vérifier' : 'à relier'}</span>}
                </span>
                <select
                  className="field min-h-11 w-full sm:w-72"
                  value={value}
                  onChange={(e) => {
                    const v = e.target.value
                    setColumn(col.index, v.startsWith('t:') ? { k: 'test', criterionId: v.slice(2) } : ({ k: v } as ColRole))
                  }}
                >
                  {col.role.k === 'inconnue' && <option value="inconnue">{ROLE_LABEL.inconnue}…</option>}
                  <option value="ignore">{ROLE_LABEL.ignore}</option>
                  <optgroup label="Joueur">
                    {(['joueur', 'nom', 'prenom', 'maillot', 'annee', 'date'] as const).map((k) => (
                      <option key={k} value={k}>
                        {ROLE_LABEL[k]}
                      </option>
                    ))}
                  </optgroup>
                  {groupByCategory(crits).map(([cat, cs]) => (
                    <optgroup key={cat} label={cat}>
                      {cs.map((c) => (
                        <option key={c.id} value={`t:${c.id}`}>
                          {c.label}
                          {c.unit ? ` (${c.unit})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            )
          })}
        </div>
      </section>

      {!testCols && <p className="text-xs text-spread-lo">Aucune colonne n’est reliée à un test : relie au moins une colonne ci-dessus.</p>}

      <ul className="flex flex-col gap-2" aria-label="Lignes à valider">
        {proposal.rows.map((r) => {
          const p = r.match.playerId ? byId.get(r.match.playerId) : undefined
          const on = isChecked(r)
          const conf = CONF[r.match.confidence]
          const nSave = r.values.filter((v) => willSave(v, decisions[dkey(r, v)])).length
          return (
            <li key={r.line} className={`card overflow-hidden ${on ? 'border-accent/50' : ''}`} data-import-row={r.line}>
              <div className="flex items-start gap-1 p-1.5 pr-3">
                <RowCheck on={on} disabled={!p} onToggle={() => setChecks((c) => ({ ...c, [r.line]: !on }))} />
                <button
                  type="button"
                  className="min-h-11 min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left hover:bg-fg/5"
                  aria-expanded={picking === r.line}
                  onClick={() => setPicking(picking === r.line ? null : r.line)}
                  title="Choisir un autre joueur"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-bold">{p ? fullName(p) : 'Choisir le joueur'}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${conf.cls}`}>{conf.label}</span>
                  </span>
                  <span className="block text-[11px] break-words text-muted">
                    {r.name ? `« ${r.name} »` : 'sans nom'}
                    {r.num && !r.match.why.includes('n°') ? ` · n° ${r.num}` : ''}
                    {r.year ? ` · ${r.year}` : ''} · {r.match.why}
                    {r.dateFromTable ? ` · ${fmtDate(r.date)}` : ''}
                  </span>
                </button>
                <span className="shrink-0 pt-3 text-[11px] text-muted tabular-nums">{p && nSave ? plural(nSave, 'mesure') : ''}</span>
              </div>
              {r.badDate && <p className="px-3 pb-2 text-[11px] text-spread-lo">Date illisible « {r.badDate} » : date des tests gardée ({fmtDate(r.date)}).</p>}
              {picking === r.line && (
                <PlayerPick
                  cands={players}
                  first={[r.match.playerId, ...r.match.others].filter((x): x is string => !!x)}
                  nums={nums}
                  hint={r.name}
                  onPick={(id) => setPlayer(r.line, id)}
                  onClose={() => setPicking(null)}
                />
              )}
              {r.values.length > 0 ? (
                <div className="grid gap-px border-t border-line bg-line sm:grid-cols-2">
                  {r.values.map((v) => {
                    const c = critById.get(v.criterionId)
                    if (!c) return null
                    const key = dkey(r, v)
                    return (
                      <ValueCell
                        key={key}
                        c={c}
                        v={v}
                        decision={decisions[key] ?? 'auto'}
                        editing={editing === key}
                        onEdit={(open) => setEditing(open ? key : null)}
                        onValue={(raw) => (setValue(key, raw), setEditing(null))}
                        onDecide={(d) => decide(key, d)}
                      />
                    )
                  })}
                </div>
              ) : (
                <p className="border-t border-line px-3 py-2 text-[11px] text-muted">Aucune valeur pour les tests reliés.</p>
              )}
            </li>
          )
        })}
      </ul>

      {error && <p className="text-xs text-loss">{error}</p>}
      <FormActions>
        <button type="button" className="btn-primary" disabled={!toSave.length || busy} onClick={() => void save()}>
          {busy ? 'Enregistrement…' : toSave.length ? `Enregistrer ${plural(toSave.length, 'mesure')}` : 'Aucune mesure retenue'}
        </button>
        {onKeep && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void keep()}>
            Garder pour plus tard
          </button>
        )}
        {onBack && (
          <button type="button" className="btn-ghost" onClick={onBack}>
            {backLabel}
          </button>
        )}
        {extraActions}
      </FormActions>
    </div>
  )
}

/** Case d'une ligne à valider (retenue / laissée de côté), 44 px de cible. */
export function RowCheck({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={on ? 'Ligne retenue' : 'Ligne laissée de côté'}
      disabled={disabled}
      onClick={onToggle}
      className="flex h-11 w-11 shrink-0 items-center justify-center disabled:opacity-40"
    >
      <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-md border-2 ${on ? 'border-accent bg-accent text-white' : 'border-line'}`}>
        {on && (
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        )}
      </span>
    </button>
  )
}

function groupByCategory(cs: ImportCriterion[]): [string, ImportCriterion[]][] {
  const m = new Map<string, ImportCriterion[]>()
  for (const c of cs) m.set(c.category, [...(m.get(c.category) ?? []), c])
  return [...m]
}

const unitText = (c: ImportCriterion, n: number) => `${frNum(n)}${c.unit ? ` ${c.unit}` : ''}`
const valueText = (c: ImportCriterion, v: number | string) => (typeof v === 'number' ? unitText(c, v) : v)

/** Une valeur proposée : test, valeur (toucher : corriger), alertes et leur correction d'un toucher. */
function ValueCell({
  c,
  v,
  decision,
  editing,
  onEdit,
  onValue,
  onDecide,
}: {
  c: ImportCriterion
  v: ProposedValue
  decision: ValueDecision
  editing: boolean
  onEdit: (open: boolean) => void
  onValue: (raw: string) => void
  onDecide: (d: ValueDecision) => void
}) {
  const [draft, setDraft] = useState(v.raw)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) {
      setDraft(v.raw)
      input.current?.focus()
      input.current?.select()
    }
  }, [editing, v.raw])
  const skipped = decision === 'skip'
  const kept = decision === 'keep'
  const saves = willSave(v, decision)
  const alertLine = (a: Alert) => {
    switch (a.k) {
      case 'unite':
        return {
          text: `Unité ? ${v.raw} → ${unitText(c, a.suggestion)}`,
          actions: [{ label: `Mettre ${unitText(c, a.suggestion)}`, on: () => onValue(String(a.suggestion).replace('.', ',')) }],
        }
      case 'bornes':
        return { text: `Hors des valeurs habituelles (${frNum(a.min)} à ${frNum(a.max)}${c.unit ? ` ${c.unit}` : ''})`, actions: [{ label: 'Corriger', on: () => onEdit(true) }] }
      case 'doublon':
        return {
          text: `${a.inPaste ? 'Déjà plus haut dans le tableau (même date)' : `Déjà en base à cette date${a.existing === undefined ? '' : ` (${valueText(c, a.existing)})`}`} : ${kept ? 'ajoutée quand même' : 'pas importée'}`,
          actions: [{ label: 'Ajouter quand même', on: () => onDecide('keep') }],
        }
      case 'illisible':
        return { text: `Illisible pour ce test : « ${v.raw} »`, actions: [{ label: 'Corriger', on: () => onEdit(true) }] }
    }
  }
  return (
    <div className={`bg-panel px-3 py-2 ${skipped ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs" title={c.label}>
          {c.label}
        </span>
        {editing ? (
          <form
            className="flex shrink-0 items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              onValue(draft)
            }}
          >
            <input ref={input} className="field h-11 w-28 text-right" inputMode="decimal" aria-label={`Valeur de ${c.label}`} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="btn-ghost h-11 px-3" aria-label="Valider la valeur">
              <Icon name="check" />
            </button>
          </form>
        ) : (
          <button
            type="button"
            className={`min-h-11 shrink-0 rounded-lg px-2 text-right text-sm font-bold tabular-nums hover:bg-fg/5 ${skipped || !saves ? 'text-muted line-through decoration-1' : ''}`}
            title="Corriger la valeur"
            onClick={() => onEdit(true)}
          >
            {v.value === undefined ? '—' : valueText(c, v.value)}
            {v.edited && <span className="ml-1 text-[11px] font-normal text-muted">(corrigée)</span>}
          </button>
        )}
      </div>
      {v.converted && !v.alerts.length && (
        <div className="text-[11px] text-muted">
          lu {frNum(v.converted.from)} {v.converted.unit}, converti
        </div>
      )}
      {!skipped &&
        v.alerts.map((a, i) => {
          const l = alertLine(a)
          const settled = kept && (a.k === 'doublon' || a.k === 'bornes' || a.k === 'unite')
          return (
            <div key={i} className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`min-w-0 flex-1 text-[11px] ${settled ? 'text-muted' : 'text-spread-lo'}`}>
                <Icon name="alert" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                {l.text}
                {settled && a.k !== 'doublon' ? ' · gardée' : ''}
              </span>
              {!settled &&
                l.actions.map((x) => (
                  <button key={x.label} type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={x.on}>
                    {x.label}
                  </button>
                ))}
              {!settled && a.k !== 'doublon' && a.k !== 'illisible' && (
                <button type="button" className="min-h-11 px-2 text-xs font-bold text-muted hover:text-fg" onClick={() => onDecide('keep')}>
                  Garder
                </button>
              )}
            </div>
          )
        })}
      {/* Laisser de côté : seulement une valeur qui serait importée (un doublon ne l'est pas d'office). */}
      {(skipped || (saves && v.alerts.length > 0)) && (
        <div className="flex justify-end">
          <button type="button" className="min-h-11 px-2 text-xs font-bold text-muted hover:text-fg" onClick={() => onDecide(skipped ? 'auto' : 'skip')}>
            {skipped ? 'Reprendre cette valeur' : 'Ne pas importer cette valeur'}
          </button>
        </div>
      )}
    </div>
  )
}

/** Choisir un autre joueur, dans le contexte : les possibles d'abord, puis la recherche (2 ou 3 lettres). */
export function PlayerPick({
  cands,
  first,
  nums,
  hint,
  onPick,
  onClose,
}: {
  cands: Player[]
  first: string[]
  nums?: Record<string, string>
  hint: string
  onPick: (id: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus({ preventScroll: true }), [])
  const byId = new Map(cands.map((p) => [p.id, p]))
  const words = nameKey(q).split(' ').filter(Boolean)
  const list: Player[] =
    words.length && nameKey(q).replace(/ /g, '').length >= 2
      ? cands
          .filter((p) => {
            const hay = nameKey(`${p.firstName} ${p.lastName}`).split(' ')
            const num = nums?.[p.id]
            return words.every((w) => hay.some((h) => h.startsWith(w)) || (num && num === w) || yearOf(p) === w)
          })
          .sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr'))
          .slice(0, 8)
      : first.map((id) => byId.get(id)).filter((p): p is Player => !!p)
  return (
    <div className="border-t border-line bg-panel-2/40 p-2" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      <input
        ref={input}
        className="field min-h-11"
        type="search"
        placeholder="Chercher un joueur (2 ou 3 lettres)"
        aria-label={`Chercher le joueur de la ligne « ${hint} »`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mt-1 flex flex-col">
        {list.map((p) => (
          <button key={p.id} type="button" className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-left text-sm hover:bg-fg/5" onClick={() => onPick(p.id)}>
            <span className="min-w-0 truncate font-bold">{fullName(p)}</span>
            <span className="shrink-0 text-[11px] text-muted">
              {[yearOf(p), nums?.[p.id] ? `n° ${nums[p.id]}` : ''].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))}
        {!list.length && <p className="px-2 py-2 text-[11px] text-muted">{words.length ? 'Personne de ce nom ici.' : 'Tape 2 ou 3 lettres du nom ou du prénom.'}</p>}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button type="button" className="min-h-11 px-2 text-xs font-bold text-muted hover:text-fg" onClick={() => onPick('')}>
            Ne pas importer cette ligne
          </button>
          <button type="button" className="btn-ghost min-h-11 px-4 text-xs" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  )
}
