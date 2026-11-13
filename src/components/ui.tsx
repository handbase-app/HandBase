import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { poleStatus, POSITIONS, scaleMax, scaleMin, type Criterion, type Player, type Position } from '../db'
import { spyTarget } from '../spy'
import { hasPendingProposal, scaleSteps, scoreAfterTap, segmentLabel, segmentState } from '../scoreCapsule'

// ---------- Identité de l'utilisateur sur cet appareil ----------

const ME_KEY = 'handbase.me'
export function getMe(): string {
  // « Voir comme… » : le nom du membre simulé (pour « mes avis », « noté par moi »…).
  const spy = spyTarget()
  if (spy) return spy.name
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

// Couleur de la pastille de chaque poste connu (handball, volley) ; un autre code : pastille neutre.
const POS_COLORS: Partial<Record<Position, string>> = {
  GB: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  AG: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  AD: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  ARG: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  ARD: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  DC: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  PIV: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  // Volley : le libéro, poste à part, comme le gardien.
  P: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  R4: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  C: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  PT: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  L: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
}

export function PosBadge({ pos }: { pos?: Position }) {
  if (!pos) return null
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${POS_COLORS[pos] ?? 'border-line bg-panel-2 text-muted'}`}>
      {POSITIONS.find((p) => p.id === pos)?.short ?? pos}
    </span>
  )
}

/** Poste principal (pastille) et postes secondaires, plus discrets : « Ailier G. + DC ». */
/** Joueur au Pôle Espoirs en ce moment : pastille « PÔLE » (couleur réservée) ; dans les listes, « Pôle » (components/PlayerRow.tsx). */
export function PoleBadge({ p }: { p: Pick<Player, 'poles'> }) {
  if (poleStatus(p) !== 'current') return null
  return (
    <span className="rounded border border-teal-500/35 bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-bold text-teal-300" title="Au Pôle Espoirs">
      PÔLE
    </span>
  )
}

export function PosBadges({ p }: { p: Pick<Player, 'position' | 'secondaryPositions'> & Partial<Pick<Player, 'poles'>> }) {
  const sec = (p.secondaryPositions ?? []).filter((x) => x !== p.position)
  return (
    <>
      <PoleBadge p={p} />
      <PosBadge pos={p.position} />
      {sec.length > 0 && (
        <span className="text-[10px] font-bold text-muted" title="Postes secondaires">
          + {sec.map((x) => POSITIONS.find((q) => q.id === x)?.short ?? x).join(', ')}
        </span>
      )}
    </>
  )
}

/**
 * Style commun des onglets et choix segmentés (31/10, comme les onglets de la fiche joueur et la barre du bas) : capsule
 * fine (SEG_BOX) et pastilles (segItem) ; choix retenu en pastille teintée (bg-accent/15, texte accent), les autres en
 * texte discret, survol léger. Pour les bascules faites à la main (sens du tri, filtres « Tous / … », vues Tableau / Radar…) ;
 * sinon Segmented ou CapsuleTabs.
 */
export const SEG_BOX = 'flex gap-[3px] rounded-full border border-line bg-panel p-[3px]'
export const segItem = (on: boolean) => `rounded-full font-bold transition ${on ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-fg/5 hover:text-fg'}`

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  columns,
  className,
  look = 'boutons',
  label,
}: {
  value: T | undefined
  options: { value: T; label: string; icon?: IconName }[]
  onChange: (v: T) => void
  /** Nombre de colonnes (sinon tout sur une ligne). */
  columns?: number
  /** Grille posée par l'appelant (ex. 2 colonnes, 4 quand la place le permet : `grid grid-cols-2 @lg:grid-cols-4 gap-2`). */
  className?: string
  /** « capsule » : écran d'avis, comme les notes (CriterionInput) : choix retenu en plein blanc (couleur du texte du
   *  thème), sans néon. Par défaut (« boutons ») : le style commun des onglets et choix de l'appli (31/10, comme les onglets
   *  de la fiche joueur, la barre du bas et CapsuleTabs) : pastilles dans une capsule fine, choix retenu en pastille teintée
   *  (bg-accent/15, texte accent), les autres en texte discret ; plus de rectangle plein coloré. */
  look?: 'boutons' | 'capsule'
  /** Nom du groupe pour les lecteurs d'écran. */
  label?: string
}) {
  const capsule = look === 'capsule'
  const grid = columns && !className
  // Plusieurs rangées (grille de l'appelant, ou plus d'options que de colonnes) : coins moins ronds que la pilule.
  const rows = !!className || (grid && columns! > 1 && options.length > columns!)
  // Sur une ligne : grille de colonnes égales (auto-cols-fr) plutôt que flex-1 : dans une place à sa mesure (Carte /
  // Générations du bilan), chaque option prend la largeur de la plus longue, sans qu'un nom déborde de sa pastille.
  return (
    <div
      role="group"
      aria-label={label}
      className={`${className ?? (grid ? 'grid gap-[3px]' : 'grid auto-cols-fr grid-flow-col gap-[3px]')} p-[3px] ${rows ? 'rounded-[20px]' : 'rounded-full'} ${
        capsule ? 'border-[1.5px] border-line bg-panel-2/40' : 'border border-line bg-panel'
      }`}
      style={grid ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex min-h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-xs leading-tight font-bold transition ${
            value === o.value ? (capsule ? 'bg-fg text-panel' : 'bg-accent/15 text-accent') : 'text-muted hover:bg-fg/5 hover:text-fg'
          }`}
        >
          {o.icon && <Icon name={o.icon} className="h-3.5 w-3.5 shrink-0" />}
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
/** « Né(e) au 2e trimestre (avril–juin) » : bulle du trimestre (pastille, ligne de joueur). */
export const quarterTitle = (q: 1 | 2 | 3 | 4) => `Né(e) au ${q === 1 ? '1er' : `${q}e`} trimestre (${QUARTER_MONTHS[q - 1]})`

/** Pastille Q1…Q4 : trimestre de naissance (effet de l'âge relatif). */
export function QuarterBadge({ birthDate }: { birthDate?: string }) {
  const q = birthQuarter(birthDate)
  if (!q) return null
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${QUARTER_STYLE[q - 1]}`} title={quarterTitle(q)}>
      Q{q}
    </span>
  )
}

/**
 * Saisie d'une valeur selon l'échelle du critère. Notes (score5, score3, score2) : une capsule segmentée (src/scoreCapsule.ts),
 * la note retenue en plein blanc (couleur du texte du thème) ; une note proposée par l'« avis vocal » et pas encore validée :
 * capsule au liseré pointillé, segment proposé teinté et pointillé (src/index.css, .sug-ring / .sug-fill). « choice » : même
 * langage (pastilles arrondies dans une capsule). Mesures et texte : un champ.
 */
export function CriterionInput({
  c,
  value,
  onChange,
  suggested,
  wide = false,
}: {
  c: Criterion
  value: number | string | undefined
  onChange: (v: number | string | undefined) => void
  /** Note proposée par l'« avis vocal » (src/components/AvisVocal.tsx) : capsule en menthe néon ; la toucher la valide. */
  suggested?: number
  /** Écran de notation : capsule sur toute la largeur (plafonnée sur ordinateur) ; sinon, à la taille des notes. */
  wide?: boolean
}) {
  const max = scaleMax(c.scale)
  if (max !== null) {
    const steps = scaleSteps(scaleMin(c.scale), max)
    const proposed = hasPendingProposal(value, suggested)
    return (
      <div
        role="group"
        aria-label={proposed ? `${c.label} : note proposée par l’avis vocal` : c.label}
        data-proposed={proposed || undefined}
        className={`flex gap-[3px] rounded-full p-[3px] transition-shadow ${proposed ? 'sug-ring' : 'border-[1.5px] border-line bg-panel-2/40'} ${
          wide ? 'w-full max-w-xl' : 'w-fit max-w-full shrink-0'
        }`}
      >
        {steps.map((n) => {
          const st = segmentState(n, value, suggested)
          return (
            <button
              key={n}
              type="button"
              aria-pressed={st === 'retenu'}
              aria-label={segmentLabel(n, max, st)}
              data-state={st}
              onClick={() => onChange(scoreAfterTap(n, value, suggested))}
              className={`flex h-10 items-center justify-center rounded-full font-bold tabular-nums transition ${wide ? 'min-w-0 flex-1 text-sm' : 'w-8 text-xs'} ${
                st === 'retenu' ? 'bg-fg text-panel' : st === 'propose' ? 'sug-fill' : 'text-muted hover:bg-fg/5 hover:text-fg'
              }`}
            >
              {n}
            </button>
          )
        })}
      </div>
    )
  }
  if (c.scale === 'choice') {
    if (!c.options?.length) return <span className="text-[11px] text-muted">Aucune option définie (Réglages → critères).</span>
    return (
      <div role="group" aria-label={c.label} className="flex w-fit max-w-full flex-wrap gap-[3px] rounded-[22px] border-[1.5px] border-line bg-panel-2/40 p-[3px]">
        {c.options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(value === o ? undefined : o)}
            className={`flex min-h-10 items-center rounded-full px-3.5 text-xs font-bold transition ${value === o ? 'bg-fg text-panel' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}
          >
            {o}
          </button>
        ))}
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

/**
 * Petite icône ⓘ : l'explication s'ouvre dans une bulle accrochée au ⓘ touché (31/10 : plus de fenêtre en bas de l'écran,
 * on n'a pas à baisser les yeux), dessous s'il y a la place, sinon dessus ; fond légèrement voilé et flouté (scrim-light,
 * comme les autres bulles) ; un long texte défile dans la bulle. Un toucher à côté, Échap ou le défilement de la page la ferment.
 */
export function InfoButton({ title, children }: { title?: string; children: ReactNode }) {
  const btn = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<DOMRect | null>(null)
  useEffect(() => {
    if (!at) return
    const close = () => setAt(null)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    // Le défilement de la page ferme la bulle, pas celui du texte dans la bulle.
    const scroll = (e: Event) => !(e.target instanceof Node && bubble.current?.contains(e.target)) && close()
    window.addEventListener('keydown', esc)
    window.addEventListener('scroll', scroll, { passive: true, capture: true })
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', scroll, { capture: true })
      window.removeEventListener('resize', close)
    }
  }, [at])
  const vw = typeof window === 'undefined' ? 360 : window.innerWidth
  const vh = typeof window === 'undefined' ? 640 : window.innerHeight
  const width = Math.min(320, vw - 24)
  const below = !!at && at.bottom < vh * 0.6
  const left = at ? Math.max(12, Math.min(at.left + at.width / 2 - width / 2, vw - width - 12)) : 0
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="Explications"
        title="Explications"
        aria-expanded={!!at}
        onClick={() => setAt(btn.current?.getBoundingClientRect() ?? null)}
        className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-muted/60 align-middle text-[10px] font-bold normal-case tracking-normal text-muted before:absolute before:-inset-3 before:content-[''] hover:border-accent hover:text-accent"
      >
        i
      </button>
      {at &&
        // Affichée à la racine de la page : elle n'hérite pas du style du titre où se trouve le ⓘ.
        createPortal(
          <div className="fixed inset-0 z-50" onClick={() => setAt(null)}>
            <div className="absolute inset-0 scrim-light" aria-hidden />
            <div
              ref={bubble}
              role="dialog"
              aria-label={title ?? 'Explications'}
              className="win absolute overflow-y-auto overscroll-contain p-4 text-sm leading-relaxed shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              style={{ width, left, ...(below ? { top: at.bottom + 8, maxHeight: vh - at.bottom - 20 } : { bottom: vh - at.top + 8, maxHeight: at.top - 20 }) }}
            >
              {title && <div className="mb-1.5 text-[13px] font-extrabold">{title}</div>}
              <div className="flex flex-col gap-2 text-[13px] text-fg/90">{children}</div>
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

/** Aucun critère de ce type dans la base : ils ne sont pas livrés avec l'appli, un administrateur les importe. */
export function NoCriteria({ kind }: { kind: 'factual' | 'subjective' }) {
  return (
    <Empty>
      Aucun {kind === 'factual' ? 'test (critère factuel)' : 'critère d’observation'} pour l’instant : un administrateur doit importer les critères (Réglages → Critères et listes).
    </Empty>
  )
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
  /** Wellness (questionnaire du matin). */
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  list: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M8 12h8M8 16h5',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  rows: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  // Vue Mosaïque (page d'un événement) : quatre vignettes.
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  download: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
  /** Imprimer (bilan à imprimer de la fiche). */
  printer: 'M7 8V3h10v5M7 17H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-3M7 14h10v7H7z',
  /** Médaille (repères des tests, Réglages). */
  medal: 'M8 3h8l-2.5 6h-3zM12 21a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12 13.5v4',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  /** Onglets de « Ma page » (src/pages/Me.tsx) : chronomètre (Mes tests), ballon (Mes matchs), cahier (Mon cahier), lampe à
   *  huile et sa flamme (Ma lampe). */
  stopwatch: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 1.5M10 2h4M12 2v3M18.5 6.5L20 5',
  ball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 3c-2.5 3-2.5 6 0 9s2.5 6 0 9M3.5 9c3 1.5 5.5 1.5 8.5 3s5.5 1.5 8.5 3',
  book: 'M6 3h12v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM4 17a2 2 0 0 1 2-2h12M9 7h6M9 10h4',
  lamp: 'M3 14h13c0 2.8-2.9 4-6.5 4S3 16.8 3 14zM16 14l5-3.5M7 21h5M9.5 18v3M9.5 14v-2M9.5 9.5c-1.3-1.2-1.3-3 0-4.5 1.3 1.5 1.3 3.3 0 4.5z',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  /** Familles de tests (blocs de « Tous les tests », src/components/AllTests.tsx) : gabarit (double flèche verticale), mensurations
   *  (mètre ruban), vitesse (éclair), puissance (haltère), mobilité (flèche en cercle), stabilité (balance), sauts (flèche au-dessus du sol). */
  famHeight: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  famTape: 'M5 7h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM7 7v4M11 7v3M15 7v4M19 7v3',
  famBolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  famDumbbell: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12',
  famMobility: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  famBalance: 'M12 3v18M5 21h14M5 8h14M5 8l-3 6h6zM19 8l-3 6h6z',
  famJump: 'M12 4v11M7 9l5-5 5 5M5 20h14',
  /** Coupe : record d'un test (sa meilleure mesure). */
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  /** Croissance (courbe qui monte ; onglet de la fiche d'un joueur). */
  growth: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  /** Tests (chronomètre ; onglet de la fiche d'un joueur). */
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  calendar: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
  check: 'M9 12l2 2 4-4M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  /** Sélection multiple (case cochée). */
  select: 'M4 4h16v16H4zM8 12l3 3 5-6',
  /** Ajouter (plus). */
  plus: 'M12 5v14M5 12h14',
  message: 'M4 4h16v12H8l-4 4zM9 10l2 2 4-4',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z',
  bell: 'M6 9a6 6 0 1 1 12 0c0 6 3 8 3 8H3s3-2 3-8M10 21a2 2 0 0 0 4 0',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  key: 'M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 11h9M18 11v3M15 11v2.5',
  alert: 'M12 3L2 20h20zM12 10v4M12 17h.01',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  /** Œil barré : courbe masquée. */
  eyeOff: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 4l16 16',
  video: 'M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5',
  /** Pôle / structure (bâtiment). */
  building: 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6',
  /** Avis (bulle simple). */
  chat: 'M4 5h16v11H9l-5 4z',
  play: 'M9 6.5v11l9-5.5z',
  close: 'M6 6l12 12M18 6L6 18',
  /** Petite flèche « › » (déplier les étapes d'un objectif). */
  chevron: 'M9 6l6 6-6 6',
  /** « ⋮ » : menu d'une ligne (à dessiner plein). */
  more: 'M12 6.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM12 13.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2zM12 20.6a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  prev: 'M7 6v12M18 6l-8 6 8 6z',
  next: 'M17 6v12M6 6l8 6-8 6z',
  stop: 'M7 7h10v10H7z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  pause: 'M7 6h3v12H7zM14 6h3v12h-3z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  mute: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6',
  /** Réglages (roue dentée). */
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1V4h-4v3l-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1v3h4v-3l2-1 2 1 2-4z',
  /** Synchroniser (deux flèches en cercle). */
  sync: 'M20 11a8 8 0 0 0-14.9-4M4 3v4h4M4 13a8 8 0 0 0 14.9 4M20 21v-4h-4',
  /** Se déconnecter (porte et flèche). */
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.2-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
} as const
export type IconName = keyof typeof ICONS

/** `filled` : forme pleine (étoile d'un joueur ou groupe suivi, œil « vu ») ; une forme intérieure reste évidée (pupille). */
export function Icon({ name, className = 'h-4 w-4', filled = false, strokeWidth = 1.8 }: { name: IconName; className?: string; filled?: boolean; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? 'currentColor' : 'none'} fillRule="evenodd" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  )
}

/** Petite icône devant le nom d'un groupe privé (cadenas) ou « Mon staff » (personnes) ; rien pour un groupe du staff. */
export function GroupMark({ g, className = 'mr-1 inline h-3 w-3 -translate-y-px' }: { g: { private?: boolean; team?: boolean }; className?: string }) {
  if (!g.private && !g.team) return null
  return <Icon name={g.private ? 'lock' : 'users'} className={className} />
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
