import { POSITIONS, type Position } from '../db'

const SPOTS: Record<Position, { x: number; y: number; tag: string }> = {
  AG: { x: 28, y: 178, tag: 'AG' },
  ARG: { x: 66, y: 92, tag: 'ARG' },
  DC: { x: 150, y: 58, tag: 'DC' },
  ARD: { x: 234, y: 92, tag: 'ARD' },
  AD: { x: 272, y: 178, tag: 'AD' },
  PIV: { x: 150, y: 140, tag: 'P' },
  GB: { x: 150, y: 196, tag: 'G' },
}

/** Demi-terrain cliquable pour choisir le poste. */
export function CourtPicker({ value, onChange }: { value?: Position; onChange: (p: Position) => void }) {
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 300 215" className="w-full max-w-[300px] rounded-lg border border-line bg-panel-2">
        {/* zone 6 m */}
        <path d="M 40 205 A 110 95 0 0 1 260 205" fill="#f43f5e10" stroke="#9a9ab8" strokeWidth="1.5" />
        {/* ligne 9 m */}
        <path d="M 6 205 A 144 135 0 0 1 294 205" fill="none" stroke="#9a9ab8" strokeWidth="1.2" strokeDasharray="5 5" />
        {/* but */}
        <rect x="128" y="203" width="44" height="8" fill="none" stroke="#9a9ab8" strokeWidth="1.5" />
        {POSITIONS.map((p) => {
          const s = SPOTS[p.id]
          const on = value === p.id
          return (
            <g key={p.id} onClick={() => onChange(p.id)} className="cursor-pointer">
              <circle cx={s.x} cy={s.y} r={on ? 14 : 11} fill={on ? '#f43f5e' : '#26263a'} stroke={on ? '#fff' : '#9a9ab8'} strokeWidth="1.5" />
              <text x={s.x} y={s.y + 3.5} textAnchor="middle" fontSize={s.tag.length > 2 ? 8 : 10} fontWeight="700" fill="#fff" className="pointer-events-none">
                {s.tag}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="mt-1 text-xs font-bold text-accent">{value ? POSITIONS.find((p) => p.id === value)?.label : 'Choisir un poste'}</div>
    </div>
  )
}
