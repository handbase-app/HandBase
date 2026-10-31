import type { ReactNode } from 'react'
import { POSITIONS, type Position } from '../db'
import { spotsOf } from '../courtSpots'
import { currentSport } from '../sportConfig'

/*
 * Demi-terrain des postes, dessiné selon le sport de l'installation (src/sportConfig.ts) : SPOTS (place et étiquette de
 * chaque code de poste) et COURT_LINES (tracé) sont rangés par sport. Une installation dont les postes n'ont pas tous une
 * place sur le terrain de son sport (postes renommés en codes inconnus, autre sport) voit une simple liste de boutons
 * (PositionButtons). Repère commun : viewBox 300 × 200.
 */
/**
 * Texte et contour sur la couleur d'accent : celle du style (Officiel sombre : accent presque blanc, texte marine), sinon
 * blanc. Le blanc fixe rendait le poste choisi illisible quand l'accent est clair.
 */
const ON_ACCENT = 'var(--color-on-accent, #fff)'

/** Tracé du terrain de chaque sport (sous les ronds des postes). */
const COURT_LINES: Record<string, () => ReactNode> = {
  handball: () => (
    <>
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
    </>
  ),
  volley: () => (
    <>
      {/* zone avant (entre le filet et la ligne d'attaque), teintée */}
      <rect x="60" y="14" width="180" height="60" className="fill-accent/10" />
      {/* lignes de côté et de fond */}
      <path d="M 60 14 L 60 194 L 240 194 L 240 14" fill="none" className="stroke-muted" strokeWidth="1.5" />
      {/* ligne d'attaque (3 m) */}
      <line x1="60" y1="74" x2="240" y2="74" className="stroke-muted" strokeWidth="1.5" />
      {/* zones : trois couloirs de 3 m, en pointillés discrets */}
      <line x1="120" y1="14" x2="120" y2="194" className="stroke-muted" opacity={0.4} strokeWidth="1" strokeDasharray="3 4" />
      <line x1="180" y1="14" x2="180" y2="194" className="stroke-muted" opacity={0.4} strokeWidth="1" strokeDasharray="3 4" />
      {/* numéros des zones : 4 3 2 devant, 5 6 1 derrière */}
      {(
        [
          [4, 64, 70],
          [3, 124, 70],
          [2, 184, 70],
          [5, 64, 190],
          [6, 124, 190],
          [1, 184, 190],
        ] as const
      ).map(([z, x, y]) => (
        <text key={z} x={x} y={y} fontSize="8" fontWeight="700" className="pointer-events-none fill-muted" opacity={0.7}>
          {z}
        </text>
      ))}
      {/* filet (trait épais) et ses poteaux, un peu en dehors des lignes de côté */}
      <line x1="48" y1="13" x2="252" y2="13" className="stroke-muted" strokeWidth="3.5" strokeLinecap="round" />
      <rect x="44" y="9" width="4" height="8" rx="1" className="fill-muted" />
      <rect x="252" y="9" width="4" height="8" rx="1" className="fill-muted" />
    </>
  ),
}

/**
 * Demi-terrain cliquable, sans question (31/10, demande de Geoffroy) : chaque toucher ajoute le poste à la suite ou le
 * retire s'il y est déjà. Le premier de la liste est le poste principal (rond plein), les suivants les postes secondaires,
 * dans l'ordre où on les a touchés (2e, 3e…). Retirer le principal fait passer le suivant en principal.
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
  const order = [...(value ? [value] : []), ...sec]
  function tap(pos: Position) {
    const next = order.includes(pos) ? order.filter((x) => x !== pos) : [...order, pos]
    onChange(next[0], next.slice(1))
  }
  const short = (id: Position) => POSITIONS.find((p) => p.id === id)?.short
  return (
    <div className="flex flex-col items-center">
      <Court value={value} sec={sec} onTap={tap} />
      <div className="mt-1 text-xs font-bold text-accent">
        {value ? POSITIONS.find((p) => p.id === value)?.label : sec.length ? 'Pas de poste principal' : 'Choisir un poste'}
        {sec.length > 0 && <span className="text-muted"> + {sec.map(short).join(', ')}</span>}
      </div>
      <div className="text-[10px] text-muted">1er toucher : principal ● · les suivants : secondaires ○, dans l’ordre · retoucher : retirer</div>
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
  const sport = currentSport().sport
  const spots = spotsOf(sport)
  if (!POSITIONS.every((p) => spots[p.id])) return <PositionButtons value={value} sec={sec} onTap={onTap} counts={counts} />
  return (
    <svg viewBox="0 0 300 200" className={`w-full rounded-lg border border-line bg-panel-2 ${className}`}>
      {(COURT_LINES[sport] ?? COURT_LINES.handball)()}
      {POSITIONS.map((p) => {
        const s = spots[p.id]!
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
              className={on ? 'fill-accent' : sub ? 'fill-accent/15 stroke-accent' : 'fill-panel stroke-muted'}
              style={on ? { stroke: ON_ACCENT } : undefined}
              strokeWidth={sub ? 2.5 : 1.5}
            />
            {/* Poste à part (libéro) : anneau en pointillés, teinte sarcelle de l'installation (--color-scale). */}
            {s.special && <circle cx={s.x} cy={s.y} r={(on ? 14 : sub ? 12.5 : 11) + 3.5} fill="none" style={{ stroke: 'var(--color-scale)' }} strokeWidth={1.5} strokeDasharray="3 2.5" />}
            <text x={s.x} y={s.y + 3.5} textAnchor="middle" fontSize={s.tag.length > 2 ? 8 : 10} fontWeight="700" className={`pointer-events-none ${on ? '' : 'fill-fg'}`} style={on ? { fill: ON_ACCENT } : undefined}>
              {s.tag}
            </text>
            {counts && (
              <g className="pointer-events-none">
                {/* Pastille à droite du rond, à gauche près du bord droit du terrain. */}
                <rect x={s.x + (s.x > 260 ? -29 : 7)} y={s.y - 21} width={22} height={13} rx={6.5} className={on ? '' : 'fill-line'} style={on ? { fill: ON_ACCENT } : undefined} />
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

/** Postes sans terrain dessiné (autre sport que le handball) : un bouton par poste, même logique que le terrain. */
function PositionButtons({ value, sec, onTap, counts }: { value?: Position; sec: Position[]; onTap?: (pos: Position) => void; counts?: Record<string, number> }) {
  return (
    <div className="flex w-full flex-wrap justify-center gap-2">
      {POSITIONS.map((p) => {
        const on = value === p.id
        const sub = sec.includes(p.id)
        return (
          <button
            key={p.id}
            type="button"
            disabled={!onTap}
            onClick={onTap && (() => onTap(p.id))}
            className={`min-h-11 rounded-full border px-3 text-xs font-bold ${on ? 'border-accent bg-accent text-white' : sub ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel text-fg'} ${counts && !counts[p.id] && !on ? 'opacity-40' : ''}`}
          >
            {p.short}
            {counts && <span className="ml-1 text-[10px] opacity-70">{counts[p.id] ?? 0}</span>}
          </button>
        )
      })}
    </div>
  )
}
