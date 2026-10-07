import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Team } from '../db'
import { currentUserId } from '../roles'
import { STAFF } from '../staffLabels'
import { supabase } from '../sync'
import { useTeams } from '../teams'
import { fold } from './PlayerFilter'

type StaffEntry = { user_id: string; full_name: string | null }

/**
 * Encadrants proposés comme participants (supabase/023, 024) ou membres d'un staff (034) : liste du staff lue en
 * ligne (comptes encadrants). Sans serveur (mode local, démonstration) : les encadrants cités par les staffs de
 * l'appareil. `exclude` : un compte à ne pas proposer (le créateur du groupe ou de l'événement, soi-même par défaut).
 */
function useStaffDirectory(exclude: string | null | undefined, teams: Team[] | undefined): StaffEntry[] | null {
  const [staff, setStaff] = useState<StaffEntry[] | null>(null)
  useEffect(() => {
    if (!supabase) return
    void supabase
      .from('hb_profiles')
      .select('user_id, full_name')
      .eq('role', 'preparateur')
      .order('full_name')
      .then(({ data }) => setStaff(data ?? []))
  }, [])
  // Même tableau tant que rien ne change : le choix renvoie les noms au parent à chaque nouvelle liste.
  return useMemo(() => {
    if (supabase) return staff && staff.filter((p) => p.user_id !== exclude)
    const known = new Map<string, string>()
    for (const t of teams ?? []) for (const u of t.members) known.set(u, t.names?.[u] ?? known.get(u) ?? '')
    return [...known]
      .map(([user_id, full_name]) => ({ user_id, full_name }))
      .filter((p) => p.user_id !== exclude)
      .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? '', 'fr'))
  }, [staff, exclude, teams])
}

/** Peut-on choisir des participants ici (en ligne, ou des staffs sur l'appareil) ? */
export function useCanPickStaff() {
  const teams = useTeams()
  return !!supabase || !!teams?.length
}

/**
 * Choix des participants (encadrants) d'un groupe ou d'un événement : en tête, mes staffs (un clic ajoute tout le
 * staff, y compris ceux qui le rejoindront) ; puis les encadrants un par un. Sans `onTeams` (membres d'un staff) :
 * seulement les encadrants, soi-même compris si `includeSelf`. `onNames` reçoit les noms des encadrants proposés,
 * pour l'affichage hors ligne.
 */
export function StaffPicker({
  value,
  onChange,
  teams: pickedTeams = [],
  onTeams,
  ownerId,
  includeSelf = false,
  onNames,
  chip,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  teams?: string[]
  onTeams?: (ids: string[]) => void
  ownerId?: string
  includeSelf?: boolean
  onNames: (names: Record<string, string>) => void
  chip: (on: boolean) => string
}) {
  const myTeams = useTeams()
  const staff = useStaffDirectory(includeSelf ? null : (ownerId ?? currentUserId()), myTeams)
  const [open, setOpen] = useState<string | null>(null)
  // Avec des staffs : les encadrants un par un sont repliés (on n'affiche que ceux déjà choisis).
  const [others, setOthers] = useState(false)
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (staff) onNames(Object.fromEntries(staff.map((p) => [p.user_id, p.full_name ?? ''])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staff])
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])
  // Staffs cités mais pas sur l'appareil (supprimés, ou dont je ne fais pas partie) : gardés tels quels, signalés.
  const hidden = pickedTeams.filter((id) => !myTeams?.some((t) => t.id === id)).length
  const shownTeam = myTeams?.find((t) => t.id === open)
  const withTeams = !!onTeams && !!myTeams?.length
  // Déjà couverts par un staff choisi : inutile de les proposer un par un.
  const covered = new Set(myTeams?.filter((t) => pickedTeams.includes(t.id)).flatMap((t) => t.members) ?? [])
  // Liste déroulante : encadrants pas déjà couverts par un staff choisi, filtrés par la recherche.
  const words = fold(search).split(/\s+/).filter(Boolean)
  const choices = (staff ?? []).filter((p) => (!covered.has(p.user_id) || value.includes(p.user_id)) && words.every((w) => fold(p.full_name ?? '').includes(w)))
  const chosen = (staff ?? []).filter((p) => value.includes(p.user_id))

  return (
    <div className="flex flex-col gap-2">
      {onTeams && (!!myTeams?.length || hidden > 0) && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[11px] font-bold text-muted">{STAFF.pickerTitle}</div>
          <div className="flex flex-wrap gap-1.5">
            {myTeams?.map((t) => (
              <span key={t.id} className="inline-flex">
                <button
                  type="button"
                  className={`${chip(pickedTeams.includes(t.id))} rounded-r-none`}
                  aria-label={`${t.name} (${t.members.length})`}
                  title={t.members.map((u) => t.names?.[u] || '?').join(', ')}
                  onClick={() => onTeams(toggle(pickedTeams, t.id))}
                >
                  {t.name} ({t.members.length})
                </button>
                <button
                  type="button"
                  aria-label={`Membres de ${t.name}`}
                  aria-expanded={open === t.id}
                  className={`${chip(false)} -ml-px rounded-l-none px-1.5`}
                  onClick={() => setOpen(open === t.id ? null : t.id)}
                >
                  {open === t.id ? '▴' : '▾'}
                </button>
              </span>
            ))}
          </div>
          {shownTeam && (
            <p className="text-[11px] text-muted">
              <b className="text-fg">{shownTeam.name}</b> : {shownTeam.members.map((u) => shownTeam.names?.[u] || '?').join(', ') || STAFF.count(0)}
            </p>
          )}
          {hidden > 0 && <p className="text-[11px] text-muted">+ {STAFF.hidden(hidden)}</p>}
          <p className="text-[11px] text-muted">
            {STAFF.pickerHelp}{' '}
            <Link to={STAFF.route} className="font-bold text-accent underline">
              {STAFF.pickerManage}
            </Link>
          </p>
        </div>
      )}
      {staff === null ? (
        <p className="text-[11px] text-muted">{navigator.onLine ? 'Chargement du staff…' : 'Liste du staff disponible en ligne.'}</p>
      ) : !staff.length ? (
        <p className="text-[11px] text-muted">Aucun autre encadrant.</p>
      ) : (
        <>
          {/* Encadrants choisis un par un : pastilles (✕ pour retirer). */}
          {chosen.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chosen.map((p) => (
                <button key={p.user_id} type="button" className={chip(true)} title="Retirer" onClick={() => onChange(toggle(value, p.user_id))}>
                  {p.full_name || 'Sans nom'} <span className="opacity-70">✕</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            aria-expanded={others}
            className="flex items-center justify-between rounded-md border border-line bg-panel-2 px-3 py-2 text-left text-xs font-bold text-muted hover:text-fg"
            onClick={() => setOthers(!others)}
          >
            <span>{withTeams ? '+ Ajouter un encadrant hors staff' : '+ Ajouter un encadrant'}</span>
            <span>{others ? '▴' : '▾'}</span>
          </button>
          {others && (
            <div className="flex flex-col gap-1.5 rounded-md border border-line bg-panel p-2">
              <input className="field py-1.5 text-xs" placeholder="Chercher un nom…" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="flex max-h-56 flex-col overflow-y-auto">
                {choices.map((p) => (
                  <label key={p.user_id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-xs hover:bg-panel-2">
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--color-accent)]" checked={value.includes(p.user_id)} onChange={() => onChange(toggle(value, p.user_id))} />
                    {p.full_name || 'Sans nom'}
                  </label>
                ))}
                {!choices.length && <p className="px-1.5 py-1 text-[11px] text-muted">Aucun encadrant ne correspond.</p>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
