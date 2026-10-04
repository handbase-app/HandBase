import { useState } from 'react'
import { newId, POSITIONS, save, type Player, type Position } from '../db'
import { can, myDepartments, useRole } from '../roles'
import { DEPARTMENT_CHOICES } from './PlayerFilter'
import { Segmented } from './ui'

/**
 * Fiche minimale d'un joueur absent de la base (UNSS, sans licence…). Créée par un observateur, elle
 * est « proposée » et attend la validation d'un encadrant ; créée par un encadrant, c'est une fiche normale.
 * Le département est obligatoire : il dira plus tard quel responsable de secteur valide.
 */
export function ProposePlayer({
  initial,
  onDone,
}: {
  /** Fiche à modifier, ou début de saisie (ex. nom tapé dans la recherche). */
  initial?: Partial<Player>
  onDone: (p?: Player) => void
}) {
  const role = useRole()
  // Nouvelle fiche : département de mon secteur par défaut, s'il n'y en a qu'un.
  const [p, setP] = useState<Partial<Player>>(() =>
    initial?.id ? initial : { department: myDepartments().length === 1 ? myDepartments()[0] : undefined, ...initial },
  )
  const [otherDept, setOtherDept] = useState(!!p.department && !DEPARTMENT_CHOICES.some((d) => d.value === p.department))
  const set = <K extends keyof Player>(k: K, v: Player[K]) => setP((x) => ({ ...x, [k]: v }))
  const editing = !!p.id
  const ok = !!p.firstName?.trim() && !!p.lastName?.trim() && !!p.department?.trim()

  async function submit() {
    if (!ok) return
    const player = await save<Player>('players', {
      ...p,
      id: p.id ?? newId(),
      firstName: p.firstName!.trim(),
      lastName: p.lastName!.trim(),
      club: p.club?.trim() || undefined,
      department: p.department!.trim(),
      // Le serveur applique la même règle, quoi qu'envoie l'appareil.
      ...(editing ? {} : can.review(role) ? {} : { review: 'pending' as const }),
    } as Player)
    onDone(player)
  }

  return (
    <div className="flex flex-col gap-2">
      {!can.review(role) && !editing && (
        <p className="text-[11px] text-muted">
          La fiche sera <b className="text-white">proposée</b> : un encadrant la validera. Tu peux la modifier tant qu’elle n’est pas traitée.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input className="field" placeholder="Prénom *" value={p.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} />
        <input className="field" placeholder="Nom *" value={p.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="label">Date de naissance</span>
          <input type="date" className="field" value={p.birthDate ?? ''} onChange={(e) => set('birthDate', e.target.value || undefined)} />
        </div>
        <div>
          <span className="label">Sexe</span>
          <Segmented
            value={p.sex}
            onChange={(v) => set('sex', v)}
            options={[
              { value: 'M', label: 'Garçon' },
              { value: 'F', label: 'Fille' },
            ]}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="label">Poste</span>
          <select className="field" value={p.position ?? ''} onChange={(e) => set('position', (e.target.value || undefined) as Position | undefined)}>
            <option value="">—</option>
            {POSITIONS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Département *</span>
          <select
            className="field"
            value={otherDept ? 'autre' : (p.department ?? '')}
            onChange={(e) => {
              const v = e.target.value
              setOtherDept(v === 'autre')
              set('department', v === 'autre' ? '' : v || undefined)
            }}
          >
            <option value="">—</option>
            {DEPARTMENT_CHOICES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
            <option value="autre">Autre…</option>
          </select>
          {otherDept && (
            <input
              className="field mt-1"
              placeholder="N° (ex. 30, 2A)"
              maxLength={3}
              value={p.department ?? ''}
              onChange={(e) => set('department', e.target.value.toUpperCase())}
            />
          )}
        </div>
      </div>
      <input className="field" placeholder="Établissement ou club (ex. collège Jean Moulin)" value={p.club ?? ''} onChange={(e) => set('club', e.target.value)} />
      <textarea className="field min-h-12" placeholder="Notes" value={p.notes ?? ''} onChange={(e) => set('notes', e.target.value || undefined)} />

      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={!ok} onClick={() => void submit()}>
          {editing ? 'Enregistrer' : can.review(role) ? 'Créer la fiche' : 'Proposer la fiche'}
        </button>
        <button className="btn text-muted" onClick={() => onDone()}>
          Annuler
        </button>
      </div>
      {!ok && <p className="text-[10px] text-muted">Prénom, nom et département obligatoires.</p>}
    </div>
  )
}
