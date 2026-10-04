import { useState } from 'react'
import { db, newId, remove, save, type ListItem } from '../db'
import { useRegions } from '../lists'
import { ask } from './Confirm'
import { SectionTitle } from './ui'

/** Régions (administrateurs) : renommer, ajouter, supprimer. Les groupes suivent le nouveau nom. */
export function RegionsEditor() {
  const regions = useRegions()
  const [name, setName] = useState('')

  async function add() {
    const n = name.trim()
    if (!n) return
    await save<ListItem>('lists', { id: newId(), kind: 'region', name: n, order: Math.max(0, ...regions.map((r) => r.order)) + 1 })
    setName('')
  }

  return (
    <section className="card flex flex-col gap-2 p-4">
      <SectionTitle info="Liste proposée pour la région d’un groupe. Renommer une région la renomme dans tous les groupes ; la supprimer la retire des groupes qui l’utilisaient.">
        Régions
      </SectionTitle>
      <div className="divide-y divide-line rounded-lg border border-line">
        {regions.map((r) => (
          <RegionRow key={r.id} r={r} />
        ))}
        {!regions.length && <div className="p-3 text-center text-xs text-muted">Aucune région.</div>}
      </div>
      <div className="flex gap-2">
        <input
          className="field py-1.5 text-xs"
          placeholder="Nouvelle région…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <button className="btn-primary shrink-0 px-3 text-xs" disabled={!name.trim()} onClick={() => void add()}>
          Ajouter
        </button>
      </div>
    </section>
  )
}

function RegionRow({ r }: { r: ListItem }) {
  const [name, setName] = useState(r.name)
  const changed = name.trim() !== r.name && !!name.trim()
  return (
    <div className="flex items-center gap-2 px-2 py-1.5">
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
        title="Supprimer cette région"
        onClick={async () => {
          const n = await db.groups.filter((g) => !g.deleted && g.regionId === r.id).count()
          const msg = n ? `Supprimer « ${r.name} » ? ${n} groupe(s) n’auront plus de région.` : `Supprimer « ${r.name} » ?`
          if (await ask(msg, { ok: 'Supprimer' })) await remove('lists', r.id)
        }}
      >
        ✕
      </button>
    </div>
  )
}
