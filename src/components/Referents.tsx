import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { alive, db, newId, REFERENT_ROLES, remove, save, type Referent } from '../db'
import { can, currentUserId, useRole } from '../roles'
import { ask } from './Confirm'
import { Segmented } from './ui'

/*
 * Adultes référents d'un joueur (parent, professeur d'EPS, entraîneur…) : à qui s'adresser pour
 * le contacter. Coordonnées d'adultes uniquement, jamais celles de l'enfant. Lisibles seulement
 * par les encadrants et administrateurs, et par celui qui les a saisis (supabase/009_joueurs_proposes.sql).
 */

export type ReferentDraft = Partial<Referent>

export const referentLabel = (r: Pick<Referent, 'role'>) => REFERENT_ROLES.find((x) => x.value === r.role)?.label ?? ''

/** Le référent peut-il être modifié par moi ? (encadrant : tous ; observateur : les siens) */
const mayEdit = (role: ReturnType<typeof useRole>, r: Referent) => can.allReferents(role) || !r.createdBy || r.createdBy === currentUserId()

export const referentReady = (d: ReferentDraft) => !!d.lastName?.trim() && !!d.role && !!(d.phone?.trim() || d.email?.trim() || d.address?.trim())

/** Enregistre un référent (champs vides retirés). */
export async function saveReferent(playerId: string, d: ReferentDraft) {
  const t = (v?: string) => v?.trim() || undefined
  return save<Referent>('referents', {
    ...d,
    id: d.id ?? newId(),
    playerId,
    role: d.role ?? 'autre',
    lastName: d.lastName!.trim(),
    firstName: t(d.firstName),
    structure: t(d.structure),
    phone: t(d.phone),
    email: t(d.email),
    address: t(d.address),
    source: t(d.source),
    notes: t(d.notes),
    preferred: d.preferred || undefined,
  } as Referent)
}

/** Champs d'un référent. */
export function ReferentFields({ value, onChange }: { value: ReferentDraft; onChange: (d: ReferentDraft) => void }) {
  const set = <K extends keyof Referent>(k: K, v: Referent[K]) => onChange({ ...value, [k]: v })
  return (
    <div className="flex flex-col gap-2">
      <Segmented value={value.role} onChange={(v) => set('role', v)} options={REFERENT_ROLES} columns={2} />
      <div className="grid grid-cols-2 gap-2">
        <input className="field" placeholder="Nom *" value={value.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} />
        <input className="field" placeholder="Prénom" value={value.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} />
        <input className="field" type="tel" placeholder="Téléphone" value={value.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        <input className="field" type="email" placeholder="E-mail" value={value.email ?? ''} onChange={(e) => set('email', e.target.value)} />
      </div>
      <input className="field" placeholder="Structure (collège, club…)" value={value.structure ?? ''} onChange={(e) => set('structure', e.target.value)} />
      <input className="field" placeholder="Adresse postale" value={value.address ?? ''} onChange={(e) => set('address', e.target.value)} />
      <input
        className="field"
        placeholder="Origine de l’info (ex. donné par le prof d’EPS le 12/10)"
        value={value.source ?? ''}
        onChange={(e) => set('source', e.target.value)}
      />
      <textarea className="field min-h-10" placeholder="Remarques" value={value.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={!!value.preferred} onChange={(e) => set('preferred', e.target.checked)} />
        Contact à privilégier
      </label>
      <p className="text-[10px] text-muted">
        Nom, qualité et au moins un moyen de contact (téléphone, e-mail ou adresse). Coordonnées d’un adulte, jamais celles de l’enfant ;
        visibles seulement des encadrants.
      </p>
    </div>
  )
}

/** Section « Adultes référents » de la fiche joueur. */
export function Referents({ playerId }: { playerId: string }) {
  const role = useRole()
  const list = useLiveQuery(() => db.referents.where('playerId').equals(playerId).toArray().then(alive), [playerId], [])
  const [draft, setDraft] = useState<ReferentDraft | null>(null)
  const sorted = [...list].sort((a, b) => Number(!!b.preferred) - Number(!!a.preferred) || a.lastName.localeCompare(b.lastName, 'fr'))

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-extrabold tracking-wider uppercase">Adultes référents</div>
        {!draft && (
          <button className="text-xs font-bold text-accent" onClick={() => setDraft({ role: 'parent' })}>
            + Ajouter
          </button>
        )}
      </div>
      {!can.allReferents(role) && (
        <p className="mb-2 text-[10px] text-muted">Tu ne vois que les référents que tu as saisis : les coordonnées sont réservées aux encadrants.</p>
      )}

      {draft && !draft.id && <EditBox draft={draft} setDraft={setDraft} playerId={playerId} />}

      {sorted.length === 0 && !draft && <p className="text-xs text-muted">Aucun référent.</p>}
      <div className="flex flex-col gap-2">
        {sorted.map((r) =>
          draft?.id === r.id ? (
            <EditBox key={r.id} draft={draft} setDraft={setDraft} playerId={playerId} />
          ) : (
            <div key={r.id} className="rounded-lg border border-line bg-panel-2 p-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <b>
                    {r.firstName} {r.lastName}
                  </b>{' '}
                  <span className="text-muted">· {referentLabel(r)}</span>
                  {r.preferred && <span className="ml-1 rounded-full bg-accent px-1.5 text-[9px] font-bold whitespace-nowrap text-white">à privilégier</span>}
                  {r.structure && <div className="text-[11px] text-muted">{r.structure}</div>}
                </div>
                {mayEdit(role, r) && (
                  <div className="flex shrink-0 gap-1">
                    <button className="px-1 text-muted hover:text-white" title="Modifier" onClick={() => setDraft({ ...r })}>
                      ✎
                    </button>
                    <button
                      className="px-1 text-muted hover:text-red-400"
                      title="Supprimer"
                      onClick={async () => (await ask(`Supprimer le référent ${r.firstName ?? ''} ${r.lastName} ?`, { ok: 'Supprimer' })) && void remove('referents', r.id)}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-1 flex flex-col gap-0.5">
                {r.phone && (
                  <a className="font-bold text-accent" href={`tel:${r.phone.replace(/\s/g, '')}`}>
                    ☎ {r.phone}
                  </a>
                )}
                {r.email && (
                  <a className="font-bold text-accent" href={`mailto:${r.email}`}>
                    ✉ {r.email}
                  </a>
                )}
                {r.address && <div>{r.address}</div>}
                {r.source && <div className="text-[10px] text-muted">Source : {r.source}</div>}
                {r.notes && <div className="text-[11px]">{r.notes}</div>}
                {r.createdByName && <div className="text-[10px] text-muted">Saisi par {r.createdByName}</div>}
              </div>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

function EditBox({ draft, setDraft, playerId }: { draft: ReferentDraft; setDraft: (d: ReferentDraft | null) => void; playerId: string }) {
  return (
    <div className="mb-2 rounded-lg border border-accent/50 p-2.5">
      <ReferentFields value={draft} onChange={setDraft} />
      <div className="mt-2 flex gap-2">
        <button
          className="btn-primary flex-1 py-1.5 text-xs"
          disabled={!referentReady(draft)}
          onClick={async () => {
            await saveReferent(playerId, draft)
            setDraft(null)
          }}
        >
          Enregistrer
        </button>
        <button className="btn text-xs text-muted" onClick={() => setDraft(null)}>
          Annuler
        </button>
      </div>
    </div>
  )
}
