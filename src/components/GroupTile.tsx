import { Link } from 'react-router-dom'
import { Icon, type IconName } from './ui'

/*
 * Tuiles d'accès d'un groupe (23/11, Geoffroy : « pas assez visible… plus voyant, plus joli, bien intégré ») : Wellness (cœur
 * blanc sur une pastille pêche → corail, fond rosé) et Lampes (lampe sur une pastille dorée, fond ambre). Sous le titre du
 * groupe (src/pages/Groups.tsx) ; `compact` : petite capsule (lien « Lampes » de src/pages/GroupWellness.tsx).
 * Textes colorés en -300 : les thèmes clairs les foncent (src/index.css, :root[data-light]).
 */
export type TileTone = 'wellness' | 'lamp'

const TONES: Record<TileTone, { box: string; dot: string; sub: string }> = {
  wellness: {
    box: 'border-rose-400/40 bg-gradient-to-br from-orange-400/15 to-rose-500/15 hover:border-rose-400/80',
    dot: 'bg-gradient-to-br from-orange-300 to-rose-500 text-white shadow-sm shadow-rose-500/40',
    sub: 'text-rose-300',
  },
  lamp: {
    box: 'border-amber-400/40 bg-gradient-to-br from-yellow-300/15 to-amber-500/15 hover:border-amber-400/80',
    dot: 'bg-gradient-to-br from-yellow-300 to-amber-500 text-white shadow-sm shadow-amber-500/40',
    sub: 'text-amber-300',
  },
}

export function GroupTile({ to, icon, title, sub, tone, testId, compact }: { to: string; icon: IconName; title: string; sub?: string; tone: TileTone; testId?: string; compact?: boolean }) {
  const t = TONES[tone]
  if (compact)
    return (
      <Link to={to} className={`inline-flex min-h-9 w-fit items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-xs font-bold transition active:scale-[.98] ${t.box}`} data-testid={testId}>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${t.dot}`}>
          <Icon name={icon} className="h-4 w-4" filled={icon === 'heart'} />
        </span>
        {title} <span className={t.sub}>›</span>
      </Link>
    )
  return (
    <Link to={to} className={`flex min-h-14 min-w-0 items-center gap-2 rounded-xl border p-2 sm:pr-3 transition active:scale-[.98] ${t.box}`} data-testid={testId}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${t.dot}`}>
        <Icon name={icon} className="h-5 w-5" filled={icon === 'heart'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight font-extrabold">{title}</span>
        {sub && <span className={`block truncate text-[11px] leading-tight font-bold ${t.sub}`}>{sub}</span>}
      </span>
      <span className={`hidden shrink-0 text-lg leading-none sm:inline ${t.sub}`} aria-hidden>
        ›
      </span>
    </Link>
  )
}
