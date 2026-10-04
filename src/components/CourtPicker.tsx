import { POSITIONS, type Position } from '../db'

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

/** Demi-terrain cliquable pour choisir le poste. */
export function CourtPicker({ value, onChange }: { value?: Position; onChange: (p: Position) => void }) {
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 300 200" className="w-full max-w-[300px] rounded-lg border border-line bg-panel-2">
        {/* ligne de but et but de 3 m */}
        <line x1="0" y1="14" x2="300" y2="14" stroke="#9a9ab8" strokeWidth="1.5" />
        <rect x="127.5" y="4" width="45" height="10" fill="none" stroke="#fff" strokeWidth="1.5" />
        {/* zone de 6 m : deux quarts de cercle autour des poteaux, reliés par une ligne droite */}
        <path d="M 37.5 14 A 90 90 0 0 0 127.5 104 L 172.5 104 A 90 90 0 0 0 262.5 14 Z" fill="#f43f5e14" stroke="#9a9ab8" strokeWidth="1.5" />
        {/* ligne des 9 m */}
        <path d="M 0 58.4 A 135 135 0 0 0 127.5 149 L 172.5 149 A 135 135 0 0 0 300 58.4" fill="none" stroke="#9a9ab8" strokeWidth="1.2" strokeDasharray="5 5" />
        {/* point de jet de 7 m et limite du gardien (4 m) */}
        <line x1="142.5" y1="119" x2="157.5" y2="119" stroke="#9a9ab8" strokeWidth="2" />
        <line x1="146" y1="74" x2="154" y2="74" stroke="#9a9ab8" strokeWidth="1.5" />
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
