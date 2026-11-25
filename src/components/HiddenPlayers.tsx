import { plural } from '../db'
import { usePerimeter } from '../installation'

/**
 * Joueurs d'un événement ou d'un groupe que ce compte ne reçoit pas (hors de son périmètre, supabase/046) : comptés, sans
 * leur nom. Rien pour un compte qui voit tout (un joueur absent n'est alors qu'une fiche pas encore reçue ou effacée).
 */
export function HiddenPlayers({ count }: { count: number }) {
  const per = usePerimeter()
  if (!count || !per || per.all) return null
  return (
    <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-muted" data-testid="hors-perimetre-liste">
      + {plural(count, 'joueur')} hors de ton périmètre (nom non affiché)
    </p>
  )
}
