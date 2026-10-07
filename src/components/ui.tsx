import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

/** Nom d'un joueur tel qu'affiché partout : « NOM Prénom ». */
export const playerName = (p: Pick<Player, 'firstName' | 'lastName'>) => `${(p.lastName ?? '').toUpperCase()} ${p.firstName ?? ''}`.trim()

/** Photo de joueur affichable : seulement une image intégrée (data:image/…), jamais une adresse extérieure. */
export const photoSrc = (s?: string) => (s?.startsWith('data:image/') ? s : undefined)

// ---------- Petits composants ----------

export function Avatar({ p, size = 40 }: { p: Pick<Player, 'firstName' | 'lastName' | 'photo'>; size?: number }) {
  const initials = ((p.lastName?.[0] ?? '') + (p.firstName?.[0] ?? '')).toUpperCase()
  return photoSrc(p.photo) ? (
    <img src={photoSrc(p.photo)} alt="" className="shrink-0 rounded-lg object-cover" style={{ width: size, height: size }} />
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

/** Poste principal (pastille) et postes secondaires, plus discrets : « Ailier G. + DC ». */
export function PosBadges({ p }: { p: Pick<Player, 'position' | 'secondaryPositions'> }) {
  const sec = (p.secondaryPositions ?? []).filter((x) => x !== p.position)
  return (
    <>
      <PosBadge pos={p.position} />
      {sec.length > 0 && (
        <span className="text-[10px] font-bold text-muted" title="Postes secondaires">
          + {sec.map((x) => POSITIONS.find((q) => q.id === x)?.short ?? x).join(', ')}
        </span>
      )}
    </>
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
            value === o.value ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-fg'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Trimestre de naissance (1 = janvier–mars … 4 = octobre–décembre), si la date est complète. */
export function birthQuarter(birthDate?: string): 1 | 2 | 3 | 4 | null {
  const m = birthDate && /^\d{4}-\d{2}/.test(birthDate) ? Number(birthDate.slice(5, 7)) : 0
  return m >= 1 && m <= 12 ? (Math.ceil(m / 3) as 1 | 2 | 3 | 4) : null
}

// Du vert (né en début d'année, plus âgé de sa génération) au rouge (né en fin d'année).
const QUARTER_STYLE = [
  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  'bg-orange-500/20 text-orange-300 border-orange-500/40',
  'bg-red-500/20 text-red-300 border-red-500/40',
]
const QUARTER_MONTHS = ['janvier–mars', 'avril–juin', 'juillet–septembre', 'octobre–décembre']

/** Pastille Q1…Q4 : trimestre de naissance (effet de l'âge relatif). */
export function QuarterBadge({ birthDate }: { birthDate?: string }) {
  const q = birthQuarter(birthDate)
  if (!q) return null
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${QUARTER_STYLE[q - 1]}`} title={`Né(e) au ${q === 1 ? '1er' : `${q}e`} trimestre (${QUARTER_MONTHS[q - 1]})`}>
      Q{q}
    </span>
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
              value === n ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-fg'
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
              value === o ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-fg'
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

/** Petite icône ⓘ : l'explication s'ouvre dans une fenêtre au clic, au lieu d'encombrer la page. */
export function InfoButton({ title, children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open])
  return (
    <>
      <button
        type="button"
        aria-label="Explications"
        title="Explications"
        onClick={() => setOpen(true)}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-muted/60 align-middle text-[10px] font-bold normal-case tracking-normal text-muted hover:border-accent hover:text-accent"
      >
        i
      </button>
      {open &&
        // Affichée à la racine de la page : elle n'hérite pas du style du titre où se trouve le ⓘ.
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => setOpen(false)}>
            <div role="dialog" aria-modal="true" className="card w-full max-w-sm p-5 text-sm leading-relaxed shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {title && <div className="mb-2 font-extrabold">{title}</div>}
              <div className="flex flex-col gap-2 text-[13px] text-fg/90">{children}</div>
              <div className="mt-5 flex justify-end">
                <button autoFocus className="btn-primary px-5" onClick={() => setOpen(false)}>
                  OK
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

/** Titre de section avec, au besoin, son ⓘ d'explications. */
export function SectionTitle({ children, info, className = '' }: { children: ReactNode; info?: ReactNode; className?: string }) {
  return (
    <div className={`section-title flex items-center gap-2 ${className}`}>
      {children}
      {info && <InfoButton title={typeof children === 'string' ? children : undefined}>{info}</InfoButton>}
    </div>
  )
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

/** Tracés des icônes de l'appli (même style que la barre du bas : trait fin, coins arrondis). */
export const ICONS = {
  user: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-4 4-6 8-6s8 2 8 6',
  userPlus: 'M15 19c0-3-3-5-6-5s-6 2-6 5M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M16 11h6',
  users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a3 3 0 1 0 0-6M3 20c0-3 3-5 6-5s6 2 6 5M17 15c2.5 0 4 1.7 4 5',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  list: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M8 12h8M8 16h5',
  download: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  calendar: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
  check: 'M9 12l2 2 4-4M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  message: 'M4 4h16v12H8l-4 4zM9 10l2 2 4-4',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z',
  bell: 'M6 9a6 6 0 1 1 12 0c0 6 3 8 3 8H3s3-2 3-8M10 21a2 2 0 0 0 4 0',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.2-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
} as const
export type IconName = keyof typeof ICONS

export function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  )
}

/**
 * Section repliable d'un formulaire : un titre, un résumé de ce qui est rempli (visible replié), et un
 * compteur facultatif. Même allure que les rubriques des Réglages.
 */
export function Collapsible({
  title,
  summary,
  count,
  defaultOpen = false,
  children,
}: {
  title: string
  summary?: string
  count?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`card overflow-hidden ${open ? 'border-accent/50' : ''}`}>
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(!open)}>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">{title}</span>
          {summary && !open && <span className="block truncate text-[11px] text-muted">{summary}</span>}
        </span>
        {count && <span className="shrink-0 rounded-full bg-panel-2 px-2 py-0.5 text-[10px] font-bold text-muted">{count}</span>}
        <span className={`shrink-0 text-muted transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && <div className="flex flex-col gap-3 border-t border-line p-4">{children}</div>}
    </div>
  )
}
