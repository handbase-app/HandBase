import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { BackButton } from '../backNav'
import { ask } from '../components/Confirm'
import { StaffPicker, useCanPickStaff } from '../components/StaffPicker'
import { Empty, Icon } from '../components/ui'
import { alive, db, newId, plural, remove, save, type Team } from '../db'
import { can, currentUserId, useRole } from '../roles'
import { STAFF } from '../staffLabels'
import { isMember, useTeams } from '../teams'

/*
 * « Mes staffs » (supabase/034_equipes_encadrants.sql) : équipes d'encadrants enregistrées, à choisir d'un clic
 * comme participants d'un groupe ou d'un événement. Je vois ceux que j'ai créés et ceux dont je fais partie ;
 * seul le créateur d'un staff le renomme, change ses membres ou le supprime.
 */
export default function Teams() {
  const role = useRole()
  const teams = useTeams()
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  // Où chaque staff sert : groupes et événements (non archivés) qui le citent, sur l'appareil.
  const uses = useLiveQuery(async () => {
    const [groups, events] = await Promise.all([db.groups.toArray(), db.events.toArray()])
    const m = new Map<string, { groups: number; events: number }>()
    const add = (id: string, k: 'groups' | 'events') => {
      const u = m.get(id) ?? { groups: 0, events: 0 }
      u[k]++
      m.set(id, u)
    }
    for (const g of alive(groups)) if (!g.archived) for (const t of g.teams ?? []) add(t, 'groups')
    for (const e of alive(events)) if (!e.archived) for (const t of e.teams ?? []) add(t, 'events')
    return m
  })
  if (!teams) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const usesOf = (id: string) => {
    const u = uses?.get(id)
    return u ? [u.groups && plural(u.groups, 'groupe'), u.events && plural(u.events, 'événement')].filter(Boolean).join(', ') : ''
  }

  return (
    <div className="flex flex-col gap-3">
      <BackButton fallback="/groupes" label="GROUPES" className="self-start" />
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-lg font-extrabold">
          <Icon name="users" className="h-4 w-4 text-muted" />
          {STAFF.title}
        </h1>
        {can.manageTeams(role) && editing !== 'new' && (
          <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => (setEditing('new'), setOpen(null))}>
            {STAFF.add}
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted">{STAFF.intro}</p>
      <p className="text-[11px] text-muted">{STAFF.privacy}</p>

      {editing === 'new' && (
        <div className="card p-3">
          <div className="section-title">{STAFF.create}</div>
          <TeamForm onDone={(t) => (setEditing(null), t && setOpen(t.id))} />
        </div>
      )}

      {!teams.length && editing !== 'new' && <Empty>{can.manageTeams(role) ? STAFF.emptyCreate : STAFF.empty}</Empty>}

      <div className="cols flex flex-col gap-3">
      {teams.map((t) =>
        editing === t.id ? (
          <div key={t.id} className="card col-span-full p-3">
            <TeamForm team={t} onDone={() => setEditing(null)} />
          </div>
        ) : (
          <div key={t.id} className={`card flex flex-col gap-1 p-3 ${open === t.id ? 'border-accent/50' : ''}`}>
            <button className="flex items-center justify-between gap-3 text-left" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{t.name}</span>
                {t.description && <span className="block truncate text-[11px] text-muted">{t.description}</span>}
                <span className="block truncate text-[10px] text-muted">
                  {[
                    can.editTeam(t) ? STAFF.mine : t.createdByName && STAFF.createdBy(t.createdByName),
                    isMember(t) && STAFF.member,
                    usesOf(t.id),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-xs font-bold text-muted">{STAFF.count(t.members.length)}</span>
            </button>
            {open === t.id && (
              <div className="mt-1 flex flex-col gap-2 border-t border-line pt-2">
                <p className="text-[11px] text-muted">
                  {t.members.length
                    ? t.members.map((u) => (u === currentUserId() ? 'toi' : t.names?.[u] || '?')).join(', ')
                    : STAFF.count(0)}
                </p>
                {can.editTeam(t) && (
                  <div className="flex gap-2">
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel-2 px-3 py-1.5 text-xs font-bold text-fg transition hover:border-accent"
                      onClick={() => setEditing(t.id)}
                    >
                      <Icon name="pencil" className="h-3.5 w-3.5" />
                      Modifier
                    </button>
                    <button
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel-2 px-3 py-1.5 text-xs font-bold text-muted transition hover:border-red-400 hover:text-red-400"
                      onClick={async () => {
                        if (!(await ask(STAFF.confirmDelete(t.name), { ok: 'Supprimer' }))) return
                        await remove('teams', t.id)
                        setOpen(null)
                      }}
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                      Supprimer
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ),
      )}
      </div>
    </div>
  )
}

/** Création ou modification d'un staff : nom, description, membres (encadrants). */
function TeamForm({ team, onDone }: { team?: Team; onDone: (t?: Team) => void }) {
  const role = useRole()
  const [name, setName] = useState(team?.name ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  // Nouveau staff créé par un encadrant : il en fait partie d'office (il peut se décocher).
  const me = currentUserId()
  const [members, setMembers] = useState<string[]>(team?.members ?? (me && role === 'preparateur' ? [me] : []))
  const [names, setNames] = useState<Record<string, string>>({})
  const canPick = useCanPickStaff()
  const chip = (on: boolean) =>
    `rounded-md border px-2.5 py-1.5 text-xs font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-fg'}`
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{STAFF.nameLabel}</span>
      <input className="field" autoFocus={!team} maxLength={80} placeholder={STAFF.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
      <span className="label">Description</span>
      <input className="field" maxLength={300} placeholder={STAFF.descriptionPlaceholder} value={description} onChange={(e) => setDescription(e.target.value)} />
      <span className="label mt-1">{STAFF.membersLabel}</span>
      <p className="-mt-1 text-[11px] text-muted">{STAFF.membersHelp}</p>
      {canPick ? (
        <StaffPicker value={members} onChange={setMembers} includeSelf onNames={setNames} chip={chip} />
      ) : (
        <p className="text-[11px] text-muted">{STAFF.offline}</p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={!name.trim()}
          onClick={async () => {
            const current = team && (await db.teams.get(team.id))
            const fields = {
              name: name.trim(),
              description: description.trim() || undefined,
              members,
              // Noms pour l'affichage hors ligne (le serveur les reprend des profils).
              names: Object.fromEntries(members.map((u) => [u, names[u] ?? current?.names?.[u] ?? ''])),
            }
            onDone(await save<Team>('teams', current ? { ...current, ...fields } : { id: newId(), ...fields }))
          }}
        >
          {team ? 'Enregistrer' : 'Créer'}
        </button>
        <button className="btn text-muted" onClick={() => onDone()}>
          Annuler
        </button>
      </div>
    </div>
  )
}
