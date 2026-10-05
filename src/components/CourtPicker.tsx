import { POSITIONS, type Position } from '../db'
import { choose } from './Confirm'

// Positions en attaque, vues de derrière l'attaque (but en haut) : la gauche du joueur est à gauche.
// Terrain à l'échelle : 1 m = 15 px, ligne de but à y = 14, poteaux à x = 127,5 et 172,5.
const SPOTS: Record<Position, { x: number; y: number; tag: string }> = {
  GB: { x: 150, y: 24, tag: 'G' },
  AG: { x: 20, y: 34, tag: 'AG' },
  AD: { x: 280, y: 34, tag: 'AD' },
  ARG: { x: 42, y: 140, tag: 'ARG' },
  DC: { x: 150, y: 172, tag: 'DC' },
  ARD: { x: 258, y: 140, tag: 'ARD' },
  // Pivot : sur la ligne des 6 m, au niveau du point de jet de 7 m.
  PIV: { x: 150, y: 117, tag: 'P' },
}

/**
 * Demi-terrain cliquable : le premier poste touché est le poste principal (rond plein), les suivants
 * sont des postes secondaires (rond entouré, retouché = retiré). Retoucher le principal propose de le
 * retirer ou de le passer en secondaire.
 */
export function CourtPicker({
  value,
  secondary = [],
  onChange,
}: {
  value?: Position
  secondary?: Position[]
  onChange: (principal: Position | undefined, secondary: Position[]) => void
}) {
  const sec = secondary.filter((x) => x !== value)
  async function tap(pos: Position) {
    if (!value) return onChange(pos, sec.filter((x) => x !== pos))
    if (pos === value) {
      const c = await choose(`${POSITIONS.find((x) => x.id === pos)?.label} : poste principal.`, [
        { value: 'cancel', label: 'Annuler', style: 'ghost' },
        { value: 'sec', label: 'Passer en secondaire', style: 'ghost' },
        { value: 'del', label: 'Retirer', style: 'danger' },
      ])
      if (c === 'del') onChange(undefined, sec)
      else if (c === 'sec') onChange(undefined, [...sec, pos])
      return
    }
    onChange(value, sec.includes(pos) ? sec.filter((x) => x !== pos) : [...sec, pos])
  }
  return (
    <div className="flex flex-col items-center">
      <Court value={value} sec={sec} onTap={(pos) => void tap(pos)} />
      <div className="mt-1 text-xs font-bold text-accent">
        {value ? POSITIONS.find((p) => p.id === value)?.label : sec.length ? 'Pas de poste principal' : 'Choisir un poste'}
        {sec.length > 0 && <span className="text-muted"> + {sec.map((x) => POSITIONS.find((p) => p.id === x)?.short).join(', ')}</span>}
      </div>
      <div className="text-[10px] text-muted">● principal · ○ secondaire (toucher un autre poste)</div>
    </div>
  )
}

/** Le même demi-terrain en lecture seule (fiche du joueur) : poste principal plein, secondaires entourés. */
export function CourtView({ value, secondary = [] }: { value?: Position; secondary?: Position[] }) {
  const sec = secondary.filter((x) => x !== value)
  return (
    <div className="flex flex-col items-center">
      <Court value={value} sec={sec} />
      <div className="mt-1 text-xs font-bold text-accent">
        {value ? POSITIONS.find((p) => p.id === value)?.label : 'Pas de poste principal'}
        {sec.length > 0 && <span className="text-muted"> + {sec.map((x) => POSITIONS.find((p) => p.id === x)?.label).join(', ')}</span>}
      </div>
    </div>
  )
}

function Court({
  value,
  sec,
  onTap,
  counts,
  className = 'max-w-[300px]',
}: {
  value?: Position
  sec: Position[]
  onTap?: (pos: Position) => void
  /** Filtre : nombre de joueurs par poste (pastille), postes vides grisés. */
  counts?: Record<string, number>
  className?: string
}) {
  return (
    <svg viewBox="0 0 300 200" className={`w-full rounded-lg border border-line bg-panel-2 ${className}`}>
      {/* ligne de but et but de 3 m */}
      <line x1="0" y1="14" x2="300" y2="14" className="stroke-muted" strokeWidth="1.5" />
      <rect x="127.5" y="4" width="45" height="10" fill="none" className="stroke-fg" strokeWidth="1.5" />
      {/* zone de 6 m : deux quarts de cercle autour des poteaux, reliés par une ligne droite */}
      <path d="M 37.5 14 A 90 90 0 0 0 127.5 104 L 172.5 104 A 90 90 0 0 0 262.5 14 Z" className="fill-accent/10 stroke-muted" strokeWidth="1.5" />
      {/* ligne des 9 m */}
      <path d="M 0 58.4 A 135 135 0 0 0 127.5 149 L 172.5 149 A 135 135 0 0 0 300 58.4" fill="none" className="stroke-muted" strokeWidth="1.2" strokeDasharray="5 5" />
      {/* point de jet de 7 m et limite du gardien (4 m) */}
      <line x1="142.5" y1="119" x2="157.5" y2="119" className="stroke-muted" strokeWidth="2" />
      <line x1="146" y1="74" x2="154" y2="74" className="stroke-muted" strokeWidth="1.5" />
      {POSITIONS.map((p) => {
        const s = SPOTS[p.id]
        const on = value === p.id
        const sub = sec.includes(p.id)
        return (
          <g
            key={p.id}
            onClick={onTap && (() => onTap(p.id))}
            className={onTap ? 'cursor-pointer' : undefined}
            opacity={counts && !counts[p.id] && !on ? 0.35 : 1}
          >
            <circle
              cx={s.x}
              cy={s.y}
              r={on ? 14 : sub ? 12.5 : 11}
              className={on ? 'fill-accent stroke-white' : sub ? 'fill-accent/15 stroke-accent' : 'fill-panel stroke-muted'}
              strokeWidth={sub ? 2.5 : 1.5}
            />
            <text x={s.x} y={s.y + 3.5} textAnchor="middle" fontSize={s.tag.length > 2 ? 8 : 10} fontWeight="700" className={`pointer-events-none ${on ? 'fill-white' : 'fill-fg'}`}>
              {s.tag}
            </text>
            {counts && (
              <g className="pointer-events-none">
                {/* Pastille à droite du rond, à gauche près du bord droit du terrain. */}
                <rect x={s.x + (s.x > 260 ? -29 : 7)} y={s.y - 21} width={22} height={13} rx={6.5} className={on ? 'fill-white' : 'fill-line'} />
                <text x={s.x + (s.x > 260 ? -18 : 18)} y={s.y - 11.5} textAnchor="middle" fontSize={9} fontWeight="700" className={on ? 'fill-accent' : 'fill-fg'}>
                  {counts[p.id] ?? 0}
                </text>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Filtre par poste sur le demi-terrain : un appui choisit le poste, un second appui le retire. */
export function CourtFilter({
  value,
  counts,
  onChange,
}: {
  value: Position | 'all' | 'none'
  counts: Record<string, number>
  onChange: (v: Position | 'all' | 'none') => void
}) {
  return (
    <Court
      value={value === 'all' || value === 'none' ? undefined : value}
      sec={[]}
      counts={counts}
      onTap={(pos) => onChange(value === pos ? 'all' : pos)}
      className="mx-auto max-w-[260px]"
    />
  )
}
