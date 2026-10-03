import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../sync'

/*
 * Journal d'activité (administrateurs) : lu directement sur le serveur, en ligne uniquement.
 * Le journal est rempli par la base de données elle-même (supabase/004_audit.sql).
 */

interface AuditRow {
  id: number
  at: string
  user_name: string | null
  user_role: string | null
  table_name: string
  row_id: string
  action: string
  summary: string | null
  changes: Record<string, [unknown, unknown]> | null
}

const TABLES: Record<string, string> = {
  players: 'Joueur',
  events: 'Événement',
  measurements: 'Mesure',
  evaluations: 'Avis',
  criteria: 'Critère',
  referents: 'Référent',
  profiles: 'Membre du staff',
}

const ROLES: Record<string, string> = { admin: 'admin', preparateur: 'encadrant', observateur: 'observateur' }

const FIELDS: Record<string, string> = {
  firstName: 'Prénom',
  lastName: 'Nom',
  birthDate: 'Naissance',
  sex: 'Sexe',
  position: 'Poste',
  club: 'Club',
  clubCode: 'N° club',
  team: 'Équipe',
  category: 'Catégorie',
  license: 'Licence',
  licenseStatus: 'État licence',
  licenseRequestType: 'Type licence',
  previousLicenses: 'Anciennes licences',
  nationality: 'Nationalité',
  laterality: 'Latéralité',
  boarding: 'Internat',
  motherHeight: 'Taille mère',
  fatherHeight: 'Taille père',
  gaps: 'Lacunes',
  notes: 'Notes',
  photo: 'Photo',
  name: 'Nom',
  date: 'Date',
  place: 'Lieu',
  type: 'Type',
  playerIds: 'Joueurs',
  value: 'Valeur',
  scores: 'Notes',
  overall: 'Note globale',
  strengths: 'Points forts',
  improvements: 'Axes de progression',
  contextType: 'Contexte',
  contextPlace: 'Lieu',
  review: 'Validation',
  reviewNote: 'Commentaire de validation',
  department: 'Département',
  phone: 'Téléphone',
  email: 'E-mail',
  address: 'Adresse',
  structure: 'Structure',
  preferred: 'Contact à privilégier',
  source: 'Origine de l’info',
  reviewedByName: 'Validé par',
  reviewedAt: 'Date de validation',
  deleted: 'Supprimé',
  role: 'Rôle',
  departments: 'Secteur',
  label: 'Nom',
  active: 'Actif',
}

const ACTION_STYLE: Record<string, string> = {
  création: 'text-emerald-300',
  modification: 'text-sky-300',
  suppression: 'text-red-300',
  'suppression définitive': 'text-red-400',
  restauration: 'text-amber-300',
  rôle: 'text-violet-300',
  secteur: 'text-violet-300',
}

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅'
  if (field === 'playerIds' && Array.isArray(v)) return `${v.length} joueur${v.length > 1 ? 's' : ''}`
  if (field === 'role' && typeof v === 'string') return ROLES[v] ?? v
  if (typeof v === 'boolean') return v ? 'oui' : 'non'
  if (typeof v === 'object') {
    const s = JSON.stringify(v)
    return s.length > 80 ? s.slice(0, 77) + '…' : s
  }
  return String(v)
}

const PAGE = 50

export function ActivityLog() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [people, setPeople] = useState<string[]>([])
  const [who, setWho] = useState('')
  const [table, setTable] = useState('')
  const [q, setQ] = useState('')
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function load(offset = 0) {
    if (!supabase) return
    setLoading(true)
    setErr('')
    let query = supabase.from('hb_audit').select('*').order('id', { ascending: false }).range(offset, offset + PAGE - 1)
    if (who) query = query.eq('user_name', who)
    if (table) query = query.eq('table_name', table)
    if (q.trim()) query = query.ilike('summary', `%${q.trim()}%`)
    const { data, error } = await query
    setLoading(false)
    if (error) {
      setErr(navigator.onLine ? `Journal indisponible : ${error.message}` : 'Le journal se consulte en ligne.')
      return
    }
    setRows((r) => (offset ? [...r, ...(data as AuditRow[])] : (data as AuditRow[])))
    setMore((data ?? []).length === PAGE)
  }

  useEffect(() => {
    if (!supabase) return
    void supabase
      .from('hb_profiles')
      .select('full_name')
      .then(({ data }) => setPeople([...(data ?? []).map((p) => p.full_name as string).filter(Boolean), 'Administration Supabase (SQL)']))
  }, [])
  useEffect(() => {
    const t = setTimeout(() => void load(0), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, table, q])

  if (!supabase) return null
  return (
    <section className="card flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between">
        <div className="section-title mb-0">Journal d’activité</div>
        <button className="text-[11px] font-bold text-muted underline" onClick={() => void load(0)}>
          Actualiser
        </button>
      </div>
      <p className="text-[11px] text-muted">Tout ce qui est créé, modifié ou supprimé sur le serveur : qui, quand et quoi. Visible par les administrateurs uniquement.</p>
      <div className="grid grid-cols-2 gap-2">
        <select className="field py-1.5 text-xs" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Tout le monde</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select className="field py-1.5 text-xs" value={table} onChange={(e) => setTable(e.target.value)}>
          <option value="">Tous les types</option>
          {Object.entries(TABLES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <input className="field py-1.5 text-xs" placeholder="Rechercher (joueur, événement…)" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p className="text-[11px] text-red-300">{err}</p>}

      <div className="divide-y divide-line rounded-lg border border-line">
        {rows.map((r) => {
          const link = r.action.startsWith('suppression') ? null : r.table_name === 'players' ? `/joueurs/${r.row_id}` : r.table_name === 'events' ? `/evenements/${r.row_id}` : null
          const changes = r.changes ? Object.entries(r.changes) : []
          return (
            <div key={r.id} className="px-3 py-2 text-xs">
              <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="min-w-0">
                  <span className="text-[10px] text-muted">
                    {new Date(r.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · <b className="text-white">{r.user_name ?? '?'}</b>
                    {r.user_role ? ` (${ROLES[r.user_role] ?? r.user_role})` : ''}
                  </span>
                  <br />
                  <span className={`font-bold ${ACTION_STYLE[r.action] ?? ''}`}>{r.action}</span> · {TABLES[r.table_name] ?? r.table_name} ·{' '}
                  <span className="text-white">{r.summary ?? r.row_id}</span>
                </span>
                {changes.length > 0 && <span className="shrink-0 text-muted">{open === r.id ? '▴' : '▾'}</span>}
              </button>
              {open === r.id && (
                <div className="mt-1.5 flex flex-col gap-0.5 rounded bg-panel-2 p-2 text-[11px]">
                  {changes.map(([field, [before, after]]) => (
                    <div key={field}>
                      <span className="text-muted">{FIELDS[field] ?? field} :</span> <span className="line-through opacity-60">{show(field, before)}</span> →{' '}
                      <b>{show(field, after)}</b>
                    </div>
                  ))}
                  {link && (
                    <Link to={link} className="mt-1 font-bold text-accent">
                      Ouvrir →
                    </Link>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {!rows.length && !loading && !err && <div className="p-3 text-center text-xs text-muted">Aucune activité.</div>}
      </div>
      {more && (
        <button className="btn-ghost text-xs" disabled={loading} onClick={() => void load(rows.length)}>
          {loading ? 'Chargement…' : 'Plus ancien'}
        </button>
      )}
    </section>
  )
}

/** « Créé par … le … · modifié par … le … » (signature posée par le serveur). */
export function StampLine({
  row,
}: {
  row: { createdByName?: string; createdAtServer?: string; updatedByName?: string; updatedAtServer?: string }
}) {
  const fmt = (s?: string) => (s ? new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '')
  if (!row.createdByName && !row.updatedByName) return null
  const sameAsCreation = row.updatedByName === row.createdByName && row.updatedAtServer === row.createdAtServer
  return (
    <div className="text-[10px] text-muted">
      {row.createdByName && (
        <>
          Créé par <b className="text-white">{row.createdByName}</b> le {fmt(row.createdAtServer)}
        </>
      )}
      {row.updatedByName && !sameAsCreation && (
        <>
          {row.createdByName ? ' · ' : ''}modifié par <b className="text-white">{row.updatedByName}</b> le {fmt(row.updatedAtServer)}
        </>
      )}
    </div>
  )
}
