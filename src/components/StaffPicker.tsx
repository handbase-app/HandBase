import { useEffect, useState } from 'react'
import { currentUserId } from '../roles'
import { supabase } from '../sync'

/**
 * Choix des participants (encadrants) d'un groupe ou d'un événement (supabase/023, 024) : liste du staff
 * lue en ligne. `onNames` reçoit les noms des encadrants proposés, pour l'affichage hors ligne.
 */
export function StaffPicker({
  value,
  onChange,
  ownerId,
  onNames,
  chip,
}: {
  value: string[]
  onChange: (ids: string[]) => void
  ownerId?: string
  onNames: (names: Record<string, string>) => void
  chip: (on: boolean) => string
}) {
  const [staff, setStaff] = useState<{ user_id: string; full_name: string | null }[] | null>(null)
  useEffect(() => {
    if (!supabase) return
    void supabase
      .from('hb_profiles')
      .select('user_id, full_name')
      .eq('role', 'preparateur')
      .order('full_name')
      .then(({ data }) => {
        const list = (data ?? []).filter((p) => p.user_id !== (ownerId ?? currentUserId()))
        setStaff(list)
        onNames(Object.fromEntries(list.map((p) => [p.user_id, p.full_name ?? ''])))
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId])
  if (!supabase) return null
  if (staff === null) return <p className="text-[11px] text-muted">{navigator.onLine ? 'Chargement du staff…' : 'Liste du staff disponible en ligne.'}</p>
  if (!staff.length) return <p className="text-[11px] text-muted">Aucun autre encadrant.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {staff.map((p) => (
        <button
          key={p.user_id}
          type="button"
          className={chip(value.includes(p.user_id))}
          onClick={() => onChange(value.includes(p.user_id) ? value.filter((x) => x !== p.user_id) : [...value, p.user_id])}
        >
          {p.full_name || 'Sans nom'}
        </button>
      ))}
    </div>
  )
}
