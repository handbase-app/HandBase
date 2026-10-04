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
  phone: string | null
}

/** Accès à transmettre à un membre (après création, ou nouveau mot de passe). */
interface Access {
  name: string
  email: string
  phone: string
  password: string
  isNew: boolean
}

type StaffRole = 'observateur' | 'preparateur'

/** Mot de passe provisoire facile à dicter (sans 0/O, 1/l…) : « kq7m-x4tr-9b ». */
function generatePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const r = crypto.getRandomValues(new Uint32Array(10))
  const s = Array.from(r, (n) => chars[n % chars.length]).join('')
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}

/** Numéro au format international sans « + » pour WhatsApp : 06 12 34 56 78 → 33612345678. */
function waNumber(phone: string) {
  const d = phone.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) return d.slice(1)
  if (d.startsWith('00')) return d.slice(2)
  if (d.length === 10 && d.startsWith('0')) return '33' + d.slice(1)
  return d
}

function accessMessage(a: Access) {
  const url = location.origin + import.meta.env.BASE_URL
  // Lien qui connecte en un clic (voir AuthGate) ; la partie après « # » ne quitte pas le téléphone.
  const link = `${url}#acces=${encodeURIComponent(a.email)}:${encodeURIComponent(a.password)}`
  const first = a.name.split(/\s+/)[0]
  return [
    `Bonjour ${first},`,
    '',
    a.isNew ? 'Voici ton accès à HandBase, l’appli du staff.' : 'Voici un lien pour changer ton mot de passe HandBase.',
    a.isNew
      ? 'Clique sur ce lien pour te connecter (valable 24 h), puis choisis ton mot de passe :'
      : 'Clique dessus (valable 24 h), puis choisis ton nouveau mot de passe :',
    link,
    '',
    `Si le lien ne marche pas : ouvre ${url}`,
    `Identifiant : ${a.email}`,
    `Mot de passe provisoire : ${a.password}`,
    '',
    'Pour installer l’appli sur ton téléphone :',
    '- Android (Chrome) : menu ⋮ → « Installer l’application »',
    '- iPhone (Safari) : Partager → « Sur l’écran d’accueil »',
  ].join('\n')
}

/** Envoyer l'accès : e-mail, SMS, WhatsApp ou partage du téléphone (le message part de l'appareil de l'administrateur). */
function AccessShare({ access, onClose }: { access: Access; onClose: () => void }) {
  const text = accessMessage(access)
  const subject = 'Ton accès à HandBase'
  const phone = access.phone.replace(/[^\d+]/g, '')
  const canShare = typeof navigator.share === 'function'
  const btn = 'btn-ghost flex-1 px-2 py-1.5 text-center text-xs'
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
      <div className="font-bold text-emerald-300">{access.isNew ? `Compte créé pour ${access.name}` : `Lien de changement de mot de passe pour ${access.name}`}</div>
      <div className="mt-1">
        Identifiant : <b>{access.email}</b>
        <br />
        Mot de passe provisoire : <b className="font-mono text-sm">{access.password}</b>
      </div>
      <div className="mt-1 text-[11px] text-muted">
        Envoie-lui maintenant : ce mot de passe ne sera plus affiché. Le message contient un lien qui le connecte en un clic, valable 24 h ; il
        choisira ensuite son mot de passe.
      </div>
      {canShare && (
        // Écran de partage du téléphone : Telegram, Signal, Gmail, WhatsApp… au choix.
        <button className="btn-primary mt-2 w-full text-xs" onClick={() => void navigator.share({ title: subject, text }).catch(() => {})}>
          Partager… (toutes les applis)
        </button>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <a className={btn} href={`mailto:${encodeURIComponent(access.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`}>
          ✉ E-mail
        </a>
        {phone ? (
          <a className={btn} href={`sms:${phone}?&body=${encodeURIComponent(text)}`}>
            💬 SMS
          </a>
        ) : (
          <span className={`${btn} opacity-40`} title="Pas de numéro de téléphone">
            💬 SMS
          </span>
        )}
        {phone ? (
          <a className={btn} href={`https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        ) : (
          <span className={`${btn} opacity-40`} title="Pas de numéro de téléphone">
            WhatsApp
          </span>
        )}
        <button className={btn} onClick={() => void navigator.clipboard?.writeText(text)}>
          Copier
        </button>
      </div>
      <div className="mt-2 flex justify-end">
        <button className="btn px-3 py-1 text-xs text-muted" onClick={onClose}>
          Terminé
        </button>
      </div>
    </div>
  )
}

export function Members() {
  const [list, setList] = useState<Profile[] | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null) // id du membre ouvert, ou 'nouveau'
  const [access, setAccess] = useState<Access | null>(null)

  async function load() {
    setErr('')
    const [{ data: s }, { data, error }] = await Promise.all([
      supabase!.auth.getSession(),
      supabase!.from('hb_profiles').select('user_id, email, full_name, role, departments, phone').order('full_name'),
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
              Ajouter quelqu’un : « + Membre », puis envoie-lui son accès par e-mail, SMS ou WhatsApp : un lien qui le connecte en un clic,
              valable 24 h. Il choisit ensuite son propre mot de passe. Mot de passe oublié : il le récupère seul depuis l’écran de connexion.
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

      {access && <AccessShare access={access} onClose={() => setAccess(null)} />}

      {open === 'nouveau' ? (
        <MemberForm
          onDone={async (res) => {
            setOpen(null)
            if (res) setAccess(res)
            await load()
          }}
        />
      ) : (
        list && (
          <button className="btn-primary text-xs" onClick={() => (setOpen('nouveau'), setAccess(null))}>
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
                  onDone={async (res) => {
                    setOpen(null)
                    if (res) setAccess(res)
                    await load()
                    if (p.user_id === me) await refreshRole()
                  }}
                />
              </div>
            ) : (
              <button
                key={p.user_id}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-panel-2"
                onClick={() => (setOpen(p.user_id), setAccess(null))}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold">{p.full_name || '(nom pas encore choisi)'}</div>
                  <div className="truncate text-[10px] text-muted">
                    {p.email}
                    {p.phone && ` · ${p.phone}`}
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
function MemberForm({ member, onDone }: { member?: Profile; onDone: (access?: Access) => void }) {
  const [name, setName] = useState(member?.full_name ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')
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
          p_phone: phone.trim(),
        })
      : await supabase!.rpc('hb_create_member', {
          p_email: email.trim(),
          p_password: password,
          p_full_name: name.trim(),
          p_role: role,
          p_departments: depts,
          p_phone: phone.trim() || null,
        })
    setBusy(false)
    if (error) return setErr(navigator.onLine ? error.message : 'Il faut être en ligne.')
    // Nouveau compte, ou nouveau mot de passe : proposer de lui envoyer son accès.
    onDone(password ? { name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), password, isNew: !member } : undefined)
  }

  /** Mot de passe perdu : nouveau mot de passe provisoire (24 h) et lien à lui renvoyer, en un clic. */
  async function resetLink() {
    if (!member) return
    if (
      !(await ask(
        `Envoyer à ${member.full_name || member.email} un lien pour changer son mot de passe ? Son mot de passe actuel ne marchera plus.`,
        { ok: 'Créer le lien', danger: false },
      ))
    )
      return
    const pw = generatePassword()
    setBusy(true)
    setErr('')
    const { error } = await supabase!.rpc('hb_update_member', { p_user: member.user_id, p_password: pw })
    setBusy(false)
    if (error) return setErr(navigator.onLine ? error.message : 'Il faut être en ligne.')
    onDone({ name: member.full_name || member.email || '', email: (member.email ?? '').toLowerCase(), phone: member.phone ?? '', password: pw, isNew: false })
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
      {member && (
        <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void resetLink()}>
          🔑 Lui envoyer un lien pour changer son mot de passe
        </button>
      )}
      <div>
        <span className="label">Prénom Nom</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Stéphane Bascher" />
      </div>
      <div>
        <span className="label">E-mail (identifiant)</span>
        <input className="field" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <span className="label">Téléphone (pour lui envoyer son accès par SMS / WhatsApp)</span>
        <input className="field" type="tel" inputMode="tel" placeholder="06 12 34 56 78" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
        {member && password && <p className="mt-1 text-[11px] text-muted">Après l’enregistrement, tu pourras lui envoyer ce nouveau mot de passe.</p>}
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
