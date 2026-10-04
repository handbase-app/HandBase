import { useEffect, useState } from 'react'
import { refreshRole, ROLE_HELP, ROLE_LABEL, type Role } from '../roles'
import { supabase } from '../sync'
import { ask } from './Confirm'
import { DEPARTMENT_CHOICES, departmentLabel } from './PlayerFilter'
import { SectionTitle, Segmented } from './ui'

/*
 * Membres du staff (administrateurs) : créer, modifier, supprimer des observateurs et des encadrants,
 * depuis n'importe quel appareil. Tout passe par le serveur (supabase/014_gestion_membres.sql) :
 * l'appli ne peut ni créer, ni nommer, ni modifier un administrateur.
 */

interface Profile {
  user_id: string
  email: string | null
  full_name: string | null
  role: Role
  departments: string[] | null
}

type StaffRole = 'observateur' | 'preparateur'

/** Mot de passe provisoire facile à dicter (sans 0/O, 1/l…) : « kq7m-x4tr-9b ». */
function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const r = crypto.getRandomValues(new Uint32Array(10))
  const s = Array.from(r, (n) => chars[n % chars.length]).join('')
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

export function Members() {
  const [list, setList] = useState<Profile[] | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null) // id du membre ouvert, ou 'nouveau'
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null)

  async function load() {
    setErr('')
    const [{ data: s }, { data, error }] = await Promise.all([
      supabase!.auth.getSession(),
      supabase!.from('hb_profiles').select('user_id, email, full_name, role, departments').order('full_name'),
    ])
    setMe(s.session?.user.id ?? null)
    if (error) setErr(navigator.onLine ? `Liste indisponible : ${error.message}` : 'La gestion des membres se fait en ligne.')
    else setList(data as Profile[])
  }
  useEffect(() => {
    void load()
  }, [])

  const admins = list?.filter((p) => p.role === 'admin') ?? []
  const staff = list?.filter((p) => p.role !== 'admin') ?? []

  return (
    <section className="card flex flex-col gap-2 p-4">
      <SectionTitle
        info={
          <>
            <ul className="flex flex-col gap-1">
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <li key={r}>
                  <b>{ROLE_LABEL[r]}</b> : {ROLE_HELP[r]}
                </li>
              ))}
            </ul>
            <p>
              Ajouter quelqu’un : « + Membre », puis donne-lui son e-mail et le mot de passe provisoire. Il le change ensuite dans Réglages →
              Mot de passe.
            </p>
            <p>
              Par sécurité, l’appli ne peut ni créer ni nommer un administrateur : ça se fait uniquement depuis Supabase (SQL Editor). Un compte
              piraté ne peut donc pas s’en fabriquer d’autres.
            </p>
            <p>
              Secteur : départements dont l’encadrant valide les avis spontanés et fiches proposées. Sans département, il valide tout. Pour un
              observateur, c’est indicatif.
            </p>
          </>
        }
      >
        Membres du staff
      </SectionTitle>
      {err && <p className="text-[11px] text-red-300">{err}</p>}

      {created && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
          <div className="font-bold text-emerald-300">Compte créé pour {created.name}</div>
          <div className="mt-1">
            Identifiant : <b>{created.email}</b>
            <br />
            Mot de passe provisoire : <b className="font-mono text-sm">{created.password}</b>
          </div>
          <div className="mt-1 text-[11px] text-muted">À lui donner maintenant : il ne sera plus affiché. Il le changera dans Réglages → Mot de passe.</div>
          <div className="mt-2 flex gap-2">
            <button
              className="btn-ghost px-3 py-1 text-xs"
              onClick={() => void navigator.clipboard?.writeText(`HandBase — identifiant : ${created.email} — mot de passe : ${created.password}`)}
            >
              Copier
            </button>
            <button className="btn px-3 py-1 text-xs text-muted" onClick={() => setCreated(null)}>
              OK
            </button>
          </div>
        </div>
      )}

      {open === 'nouveau' ? (
        <MemberForm
          onDone={async (res) => {
            setOpen(null)
            if (res) setCreated(res)
            await load()
          }}
        />
      ) : (
        list && (
          <button className="btn-primary text-xs" onClick={() => (setOpen('nouveau'), setCreated(null))}>
            + Membre (observateur ou encadrant)
          </button>
        )
      )}

      {list && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {staff.map((p) =>
            open === p.user_id ? (
              <div key={p.user_id} className="p-2">
                <MemberForm
                  member={p}
                  onDone={async () => {
                    setOpen(null)
                    await load()
                    if (p.user_id === me) await refreshRole()
                  }}
                />
              </div>
            ) : (
              <button
                key={p.user_id}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-panel-2"
                onClick={() => (setOpen(p.user_id), setCreated(null))}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold">{p.full_name || '(nom pas encore choisi)'}</div>
                  <div className="truncate text-[10px] text-muted">
                    {p.email}
                    {(p.departments ?? []).length > 0 && ` · secteur ${(p.departments ?? []).join(', ')}`}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-2 text-[11px]">
                  <span className={p.role === 'preparateur' ? 'font-bold text-accent' : 'text-muted'}>{ROLE_LABEL[p.role]}</span>
                  <span className="text-muted">✎</span>
                </span>
              </button>
            ),
          )}
          {admins.map((p) => (
            <div key={p.user_id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-bold">
                  {p.full_name || p.email} {p.user_id === me && <span className="text-muted">— toi</span>}
                </div>
                <div className="truncate text-[10px] text-muted">{p.email}</div>
              </div>
              <span className="shrink-0 text-[11px] text-muted" title="Géré uniquement depuis Supabase (SQL Editor)">
                Administrateur 🔒
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Création (sans `member`) ou modification d'un membre. */
function MemberForm({ member, onDone }: { member?: Profile; onDone: (created?: { name: string; email: string; password: string }) => void }) {
  const [name, setName] = useState(member?.full_name ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [role, setRole] = useState<StaffRole>(member?.role === 'preparateur' ? 'preparateur' : 'observateur')
  const [depts, setDepts] = useState<string[]>(member?.departments ?? [])
  const [password, setPassword] = useState(member ? '' : generatePassword())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toggleDept = (d: string) => setDepts((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]))
  const valid = name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && (member ? !password || password.length >= 8 : password.length >= 8)

  async function submit() {
    setBusy(true)
    setErr('')
    const { error } = member
      ? await supabase!.rpc('hb_update_member', {
          p_user: member.user_id,
          p_email: email.trim(),
          p_full_name: name.trim(),
          p_role: role,
          p_departments: depts,
          p_password: password || null,
        })
      : await supabase!.rpc('hb_create_member', { p_email: email.trim(), p_password: password, p_full_name: name.trim(), p_role: role, p_departments: depts })
    setBusy(false)
    if (error) return setErr(navigator.onLine ? error.message : 'Il faut être en ligne.')
    onDone(member ? undefined : { name: name.trim(), email: email.trim().toLowerCase(), password })
  }

  async function del() {
    if (!member) return
    if (!(await ask(`Supprimer le compte de ${member.full_name || member.email} ? Il ne pourra plus se connecter. Ses avis et mesures restent.`, { ok: 'Supprimer' })))
      return
    setBusy(true)
    const { error } = await supabase!.rpc('hb_delete_member', { p_user: member.user_id })
    setBusy(false)
    if (error) return setErr(error.message)
    onDone()
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/40 bg-panel-2 p-3">
      <div className="text-xs font-extrabold">{member ? `Modifier ${member.full_name || member.email}` : 'Nouveau membre'}</div>
      <div>
        <span className="label">Prénom Nom</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Stéphane Bascher" />
      </div>
      <div>
        <span className="label">E-mail (identifiant)</span>
        <input className="field" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <span className="label">Rôle</span>
        <Segmented<StaffRole>
          value={role}
          onChange={setRole}
          options={[
            { value: 'observateur', label: 'Observateur' },
            { value: 'preparateur', label: 'Encadrant' },
          ]}
        />
      </div>
      <div>
        <span className="label">Secteur (départements)</span>
        <div className="flex flex-wrap items-center gap-1">
          {[...new Set([...DEPARTMENT_CHOICES.map((d) => d.value), ...depts])].map((d) => (
            <button
              key={d}
              type="button"
              title={departmentLabel(d)}
              onClick={() => toggleDept(d)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${depts.includes(d) ? 'border-accent bg-accent text-white' : 'border-line text-muted'}`}
            >
              {d}
            </button>
          ))}
          <span className="text-[10px] text-muted">{depts.length ? '' : role === 'preparateur' ? 'aucun : valide tous les départements' : 'aucun'}</span>
        </div>
      </div>
      <div>
        <span className="label">{member ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe provisoire'}</span>
        <div className="flex gap-2">
          <input className="field font-mono" autoComplete="new-password" autoCapitalize="none" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="btn-ghost shrink-0 px-3 text-xs" onClick={() => setPassword(generatePassword())}>
            Générer
          </button>
        </div>
        {password && password.length < 8 && <p className="mt-1 text-[11px] text-amber-300">8 caractères minimum.</p>}
        {member && password && <p className="mt-1 text-[11px] text-muted">Pense à lui donner ce nouveau mot de passe.</p>}
      </div>
      {err && <p className="text-[11px] text-red-300">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary flex-1 text-xs" disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? '…' : member ? 'Enregistrer' : 'Créer le compte'}
        </button>
        <button className="btn text-xs text-muted" disabled={busy} onClick={() => onDone()}>
          Annuler
        </button>
        {member && (
          <button className="btn text-xs text-muted hover:text-red-400" disabled={busy} onClick={() => void del()}>
            Supprimer le compte
          </button>
        )}
      </div>
    </div>
  )
}
