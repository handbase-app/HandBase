import { useState } from 'react'
import { db, newId, remove, save, type ListItem } from '../db'
import { useDepartments, useRegions } from '../lists'
import { ask } from './Confirm'
import { SectionTitle } from './ui'

const INFO = {
  region:
    'Liste proposée pour la région d’un groupe. Renommer une région la renomme dans tous les groupes ; la supprimer la retire des groupes qui l’utilisaient.',
  department:
    'Le numéro (83, 2A…) identifie le département : c’est lui qu’on lit dans les licences, les secteurs des encadrants et les groupes. Le nom affiché se corrige ici ; un département retiré de la liste s’affiche « Département 83 ».',
}

/** Listes modifiables par les administrateurs (régions, départements). */
export function ListEditor({ kind }: { kind: 'region' | 'department' }) {
  const regions = useRegions()
  const departments = useDepartments()
  const items = kind === 'region' ? regions : departments
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const cleanCode = code.trim().toUpperCase()

  async function add() {
    setErr('')
    const n = name.trim()
    if (!n) return
    if (kind === 'department') {
      if (!/^(\d{2,3}|2[AB])$/.test(cleanCode)) return setErr('Numéro de département invalide (ex. 83, 2A, 974).')
      if (departments.some((d) => d.code === cleanCode)) return setErr(`Le département ${cleanCode} est déjà dans la liste.`)
    }
    await save<ListItem>('lists', {
      id: kind === 'department' ? `dept-${cleanCode}` : newId(),
      kind,
      name: n,
      ...(kind === 'department' ? { code: cleanCode } : {}),
      order: Math.max(0, ...items.map((r) => r.order)) + 1,
    })
    setName('')
    setCode('')
  }

  return (
    <section className="card flex flex-col gap-2 p-4">
      <SectionTitle info={INFO[kind]}>{kind === 'region' ? 'Régions' : 'Départements'}</SectionTitle>
      <div className="divide-y divide-line rounded-lg border border-line">
        {items.map((r) => (
          <ItemRow key={r.id} r={r} />
        ))}
        {!items.length && <div className="p-3 text-center text-xs text-muted">Liste vide.</div>}
      </div>
      <div className="flex gap-2">
        {kind === 'department' && (
          <input className="field w-16 shrink-0 py-1.5 text-xs" placeholder="N°" maxLength={3} value={code} onChange={(e) => setCode(e.target.value)} />
        )}
        <input
          className="field py-1.5 text-xs"
          placeholder={kind === 'region' ? 'Nouvelle région…' : 'Nom du département…'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button className="btn-primary shrink-0 px-3 text-xs" disabled={!name.trim() || (kind === 'department' && !cleanCode)} onClick={() => void add()}>
          Ajouter
        </button>
      </div>
      {err && <p className="text-[11px] text-red-300">{err}</p>}
    </section>
  )
}

function ItemRow({ r }: { r: ListItem }) {
  const [name, setName] = useState(r.name)
  const changed = name.trim() !== r.name && !!name.trim()
  const label = r.kind === 'department' ? `${r.code} · ${r.name}` : r.name
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
      {r.code && <span className="w-8 shrink-0 text-center text-xs font-bold text-muted">{r.code}</span>}
      <input
        className="field flex-1 py-1 text-xs"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && changed && void save<ListItem>('lists', { ...r, name: name.trim() })}
      />
      {changed && (
        <button className="btn-primary shrink-0 px-2 py-1 text-[11px]" onClick={() => void save<ListItem>('lists', { ...r, name: name.trim() })}>
          OK
        </button>
      )}
      <button
        className="shrink-0 px-1 text-muted hover:text-red-400"
        title="Retirer de la liste"
        onClick={async () => {
          let msg = `Retirer « ${label} » de la liste ?`
          if (r.kind === 'region') {
            const n = await db.groups.filter((g) => !g.deleted && g.regionId === r.id).count()
            if (n) msg = `Supprimer « ${label} » ? ${n} groupe(s) n’auront plus de région.`
          } else {
            msg += ' Les joueurs, secteurs et groupes gardent leur numéro de département.'
          }
          if (await ask(msg, { ok: 'Retirer' })) await remove('lists', r.id)
        }}
      >
        ✕
      </button>
    </div>
  )
}
