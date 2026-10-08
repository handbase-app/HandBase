import { useEffect, useState } from 'react'
import { ROLE_LABEL, type Role } from '../roles'
import { devToolsOn, setDevTools, setSpy, spyTarget } from '../spy'
import { supabase } from '../sync'
import { inform } from './Confirm'
import { Icon } from './ui'

/*
 * Outils administrateur (Réglages) : interrupteur, puis « Voir comme… » chaque membre du staff (spy.ts).
 * Lecture seule ; chaque simulation est notée dans le journal (supabase/035_voir_comme.sql).
 */

interface Member {
  user_id: string
  full_name: string | null
  email: string | null
  role: Role | null
  departments: string[] | null
}

export function AdminTools() {
  const [on, setOn] = useState(devToolsOn)
  return (
    <section className="card flex flex-col gap-2 p-4">
      <label className="flex items-center justify-between gap-3 text-xs font-bold">
        Activer les outils administrateur
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setDevTools(e.target.checked)
            setOn(e.target.checked)
          }}
        />
      </label>
      <p className="text-[11px] text-muted">Outils de support, pour comprendre ce que voit un membre du staff. Réglage gardé sur cet appareil.</p>
      {on && <ViewAsList />}
    </section>
  )
}

function ViewAsList() {
  const [list, setList] = useState<Member[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [me, setMe] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    void Promise.all([supabase.auth.getSession(), supabase.rpc('hb_members')]).then(([{ data: s }, { data, error }]) => {
      setMe(s.session?.user.id ?? null)
      if (error) setErr(navigator.onLine ? `Liste indisponible : ${error.message}` : 'La liste des membres se consulte en ligne.')
      else setList((data as Member[]).filter((m) => m.role && m.role !== 'admin'))
    })
  }, [])

  async function viewAs(m: Member) {
    if (!supabase || !m.role) return
    setBusy(m.user_id)
    // Trace dans le journal d'abord : pas de simulation sans trace.
    const { error } = await supabase.rpc('hb_log_view_as', { p_user: m.user_id })
    setBusy('')
    if (error)
      return inform(
        error.code === 'PGRST202'
          ? 'Exécute d’abord supabase/035_voir_comme.sql dans Supabase (la simulation doit être notée dans le journal).'
          : `Impossible de commencer : ${error.message}`,
      )
    setSpy({ uid: m.user_id, role: m.role as SpyRole, departments: m.departments ?? [], name: m.full_name || m.email || 'Membre' })
  }

  if (!supabase) return <p className="text-[11px] text-muted">Disponible avec le serveur.</p>
  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="text-xs font-bold">Voir l’appli comme…</div>
      <p className="text-[11px] text-muted">
        L’appli se comporte comme pour ce membre : son rôle, son secteur, ses avis, les groupes et événements qu’il voit. En lecture seule, et
        noté dans l’historique. Ses groupes privés, ses groupes « Mon staff » dont tu ne fais pas partie, ses staffs et ses suivis ne te sont pas
        envoyés par le serveur : ils n’apparaissent pas.
      </p>
      {err && <p className="text-[11px] text-red-300">{err}</p>}
      {spyTarget() && <p className="text-[11px] text-amber-200">Simulation en cours : quitte-la d’abord (bandeau en haut).</p>}
      {list && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {list
            .filter((m) => m.user_id !== me)
            .map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold">{m.full_name || m.email}</div>
                  <div className="truncate text-[10px] text-muted">
                    {m.role && ROLE_LABEL[m.role]}
                    {(m.departments ?? []).length > 0 && ` · secteur ${(m.departments ?? []).join(', ')}`}
                  </div>
                </div>
                <button
                  className="btn-ghost flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs"
                  disabled={!!busy || !!spyTarget()}
                  onClick={() => void viewAs(m)}
                >
                  <Icon name="eye" className="h-3.5 w-3.5" />
                  {busy === m.user_id ? '…' : 'Voir comme'}
                </button>
              </div>
            ))}
          {list.length === 0 && <p className="p-3 text-[11px] text-muted">Aucun encadrant ni observateur.</p>}
        </div>
      )}
    </div>
  )
}

type SpyRole = 'admin' | 'preparateur' | 'observateur'

/** Bandeau de la simulation, en haut de toutes les pages : qui, lecture seule, Quitter. */
export function SpyBanner() {
  const t = spyTarget()
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    let timer: number | undefined
    const flash = () => {
      setBlocked(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setBlocked(false), 3000)
    }
    window.addEventListener('handbase:readonly', flash)
    return () => window.removeEventListener('handbase:readonly', flash)
  }, [])
  if (!t) return null
  return (
    // Accroché sous l'en-tête (qui reste en haut de l'écran) : toujours visible.
    <div className="absolute inset-x-0 top-full border-b border-amber-500/50 bg-amber-400 px-4 py-1.5 text-[11px] text-black">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
        <span className="min-w-0">
          <Icon name="eye" className="mr-1 inline h-3.5 w-3.5" />
          Tu vois l’appli comme <b>{t.name}</b> ({ROLE_LABEL[t.role]}
          {t.departments.length ? ` · secteur ${t.departments.join(', ')}` : ''}) ·{' '}
          {/* Écriture tentée : le message remplace « lecture seule » (le bandeau garde sa hauteur). */}
          {blocked ? <b>rien n’a été enregistré (lecture seule)</b> : 'lecture seule'}
        </span>
        <button className="shrink-0 rounded bg-black/80 px-2.5 py-1 font-bold text-amber-300" onClick={() => setSpy(null)}>
          Quitter
        </button>
      </div>
    </div>
  )
}
