import { useEffect, useState, type ReactNode } from 'react'
import { POSITIONS, scaleMax, scaleMin, type Criterion, type Player, type Position } from '../db'

// ---------- Identité de l'utilisateur sur cet appareil ----------

const ME_KEY = 'handbase.me'
export function getMe(): string {
  try {
    return localStorage.getItem(ME_KEY) ?? ''
  } catch {
    return ''
  }
}
export function useMe(): [string, (v: string) => void] {
  const [me, setMeState] = useState(getMe)
  const setMe = (v: string) => {
    setMeState(v)
    try {
      localStorage.setItem(ME_KEY, v)
    } catch {
      /* stockage indisponible */
    }
  }
  return [me, setMe]
}

// ---------- Petits composants ----------

export function Avatar({ p, size = 40 }: { p: Pick<Player, 'firstName' | 'lastName' | 'photo'>; size?: number }) {
  const initials = ((p.firstName?.[0] ?? '') + (p.lastName?.[0] ?? '')).toUpperCase()
  return p.photo ? (
    <img src={p.photo} alt="" className="shrink-0 rounded-lg object-cover" style={{ width: size, height: size }} />
  ) : (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 font-extrabold text-accent"
      style={{ width: size, height: size, fontSize: size * 0.32 }}
    >
      {initials || '?'}
    </div>
  )
}

const POS_COLORS: Record<Position, string> = {
  GB: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  AG: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  AD: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  ARG: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  ARD: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  DC: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  PIV: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
}

export function PosBadge({ pos }: { pos?: Position }) {
  if (!pos) return null
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${POS_COLORS[pos]}`}>
      {POSITIONS.find((p) => p.id === pos)?.short}
    </span>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  columns,
}: {
  value: T | undefined
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  /** Nombre de colonnes (sinon tout sur une ligne). */
  columns?: number
}) {
  return (
    <div className={columns ? 'grid gap-2' : 'flex gap-2'} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-bold transition ${
            value === o.value ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-white'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Saisie d'une valeur selon l'échelle du critère. */
export function CriterionInput({
  c,
  value,
  onChange,
}: {
  c: Criterion
  value: number | string | undefined
  onChange: (v: number | string | undefined) => void
}) {
  const max = scaleMax(c.scale)
  if (max !== null) {
    const min = scaleMin(c.scale)
    const opts = Array.from({ length: max - min + 1 }, (_, i) => min + i)
    return (
      <div className="flex gap-1">
        {opts.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(value === n ? undefined : n)}
            className={`h-8 w-8 rounded-md border text-xs font-bold transition ${
              value === n ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-white'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    )
  }
  if (c.scale === 'choice') {
    return (
      <div className="flex flex-wrap gap-1">
        {(c.options ?? []).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(value === o ? undefined : o)}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-bold transition ${
              value === o ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-white'
            }`}
          >
            {o}
          </button>
        ))}
        {!c.options?.length && <span className="text-[11px] text-muted">Aucune option définie (Réglages → critères).</span>}
      </div>
    )
  }
  if (c.scale === 'text') {
    return <input className="field" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />
  }
  return <NumberField value={value as number | undefined} unit={c.unit} onChange={onChange} />
}

/** Champ numérique qui accepte la virgule (clavier français). */
export function NumberField({
  value,
  unit,
  onChange,
}: {
  value: number | undefined
  unit?: string
  onChange: (v: number | undefined) => void
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value).replace('.', ','))
  useEffect(() => {
    const parsed = parseFloat(text.replace(',', '.'))
    if ((isNaN(parsed) ? undefined : parsed) !== value) setText(value === undefined ? '' : String(value).replace('.', ','))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return (
    <div className="relative">
      <input
        className="field pr-12"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9.,-]/g, '')
          setText(t)
          const n = parseFloat(t.replace(',', '.'))
          onChange(isNaN(n) ? undefined : n)
        }}
      />
      {unit && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">{unit}</span>}
    </div>
  )
}

export function fmtValue(c: Criterion | undefined, v: number | string | undefined) {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'number') {
    const s = Number.isInteger(v) ? String(v) : v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
    if (c && scaleMax(c.scale) !== null) return `${s}/${scaleMax(c.scale)}`
    return c?.unit ? `${s} ${c.unit}` : s
  }
  return v
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-muted">{children}</div>
}

/** Regroupe une liste par catégorie en conservant l'ordre. */
export function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(it)
  }
  return [...m.entries()]
}

/** Redimensionne une photo pour la stocker légèrement (synchro). */
export function resizeImage(file: File, size = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, size / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(img.src)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}
