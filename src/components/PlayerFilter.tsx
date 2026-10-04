import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { departmentLabel, useDepartments } from '../lists'
import { can } from '../roles'
import { birthQuarter } from './ui'
import { alive, db, POSITIONS, type Laterality, type Player, type Position } from '../db'

/** Texte sans accents ni majuscules, pour la recherche. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function countBy<T>(items: T[], key: (t: T) => string | undefined): [string, number][] {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))
}


/**
 * Département du club, lu dans le numéro FFHB : 63 = ligue, 83 = département…
 * (N° club 6383015, licence 6383015xxxxxx). Le n° de club est prioritaire : il est toujours renseigné.
 * Joueur sans licence (fiche proposée) : département saisi à la main.
 */
export function department(p: Pick<Player, 'clubCode' | 'license' | 'department'>): string | undefined {
  const code = /^\d{7}$/.test(p.clubCode ?? '') ? p.clubCode : /^\d{13}$/.test(p.license ?? '') ? p.license : undefined
  return code?.slice(2, 4) ?? (p.department || undefined)
}

// Trimestre choisi : même code couleur que la pastille Q1…Q4 (vert → rouge).
const QUARTER_ACTIVE = ['border-emerald-500 text-emerald-300', 'border-yellow-500 text-yellow-300', 'border-orange-500 text-orange-300', 'border-red-500 text-red-300']
const QUARTER_LABELS = ['Q1 · janvier–mars', 'Q2 · avril–juin', 'Q3 · juillet–septembre', 'Q4 · octobre–décembre']

export type SexFilter = 'all' | 'M' | 'F'

const SEX_KEY = 'handbase.sexFilter'
const readSex = (): SexFilter => {
  try {
    const v = localStorage.getItem(SEX_KEY)
    return v === 'M' || v === 'F' ? v : 'all'
  } catch {
    return 'all'
  }
}

/**
 * Valeur gardée pendant la session (sessionStorage) : on retrouve ses filtres en revenant
 * sur un écran, tant que l'appli reste ouverte.
 */
export function useSessionState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(key)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* stockage indisponible */
    }
  }, [key, value])
  return [value, setValue]
}

/**
 * Filtres communs (groupe, sexe, département, club, année de naissance, poste, recherche) pour parcourir des milliers
 * de joueurs. Le choix Garçons / Filles est mémorisé sur l'appareil ; les autres filtres le sont
 * pendant la session, séparément pour chaque écran (`scope`).
 */
export function usePlayerFilter(players: Player[] | undefined, scope = 'joueurs') {
  const k = (name: string) => `handbase.filter.${scope}.${name}`
  const [q, setQ] = useSessionState(k('q'), '')
  const [sex, setSexState] = useState<SexFilter>(readSex)
  useDepartments() // noms des départements à jour dans le menu
  const [group, setGroup] = useSessionState(k('group'), '')
  const [dept, setDept] = useSessionState(k('dept'), '')
  const [club, setClub] = useSessionState(k('club'), '')
  const [year, setYear] = useSessionState(k('year'), '')
  const [position, setPosition] = useSessionState<Position | 'all' | 'none'>(k('position'), 'all')
  // Compter aussi les joueurs qui ont ce poste en secondaire (« qui peut dépanner demi-centre ? »).
  const [withSecondary, setWithSecondary] = useSessionState(k('withSecondary'), false)
  const [hand, setHand] = useSessionState<'all' | Laterality>(k('hand'), 'all')
  // Trimestre de naissance (Q1 = janvier–mars … Q4 = octobre–décembre).
  const [quarter, setQuarter] = useSessionState(k('quarter'), 0)

  const setSex = (v: SexFilter) => {
    setSexState(v)
    try {
      localStorage.setItem(SEX_KEY, v)
    } catch {
      /* stockage indisponible */
    }
  }

  // Groupes (Intercomités, Pôle…) : le groupe choisi limite la liste avant tous les autres filtres.
  const groups = useLiveQuery(() => db.groups.orderBy('name').toArray().then((gs) => alive(gs).filter((g) => can.seeGroup(g) && (!g.archived || g.id === group))), [group], [])
  const current = groups.find((g) => g.id === group)
  const all = useMemo(() => {
    const list = players ?? []
    if (!group) return list
    const ids = new Set(current?.playerIds ?? [])
    return list.filter((p) => ids.has(p.id))
  }, [players, group, current])
  const bySex = useMemo(
    () => all.filter((p) => (sex === 'all' || p.sex === sex) && (hand === 'all' || p.laterality === hand) && (!quarter || birthQuarter(p.birthDate) === quarter)),
    [all, sex, hand, quarter],
  )
  const depts = useMemo(() => countBy(bySex, department), [bySex])
  const byDept = useMemo(() => (dept ? bySex.filter((p) => department(p) === dept) : bySex), [bySex, dept])
  const clubs = useMemo(() => countBy(byDept, (p) => p.club), [byDept])
  const bySexClub = useMemo(() => (club ? byDept.filter((p) => p.club === club) : byDept), [byDept, club])
  const years = useMemo(() => countBy(bySexClub, (p) => p.birthDate?.slice(0, 4)).sort((a, b) => b[0].localeCompare(a[0])), [bySexClub])
  const scoped = useMemo(() => (year ? bySexClub.filter((p) => p.birthDate?.startsWith(year)) : bySexClub), [bySexClub, year])
  const positionCounts = useMemo(() => {
    const c: Record<string, number> = { none: 0 }
    for (const p of scoped) {
      c[p.position ?? 'none'] = (c[p.position ?? 'none'] ?? 0) + 1
      if (withSecondary) for (const x of p.secondaryPositions ?? []) if (x !== p.position) c[x] = (c[x] ?? 0) + 1
    }
    return c
  }, [scoped, withSecondary])

  const filtered = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean)
    return scoped.filter((p) => {
      if (position === 'none' && p.position) return false
      if (position !== 'all' && position !== 'none' && p.position !== position && !(withSecondary && p.secondaryPositions?.includes(position)))
        return false
      if (!words.length) return true
      const hay = fold(`${p.firstName} ${p.lastName} ${p.club ?? ''} ${p.team ?? ''} ${p.license ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
  }, [scoped, q, position, withSecondary])

  const active = !!q || sex !== 'all' || hand !== 'all' || !!quarter || !!group || !!dept || !!club || !!year || position !== 'all'
  const reset = () => {
    setQ('')
    setSex('all')
    setHand('all')
    setQuarter(0)
    setGroup('')
    setDept('')
    setClub('')
    setYear('')
    setPosition('all')
  }

  const ui = (
    <div className="flex flex-col gap-2">
      <input className="field" placeholder="Rechercher (nom, club, licence)…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
        {(
          [
            ['all', 'Tous'],
            ['M', 'Garçons'],
            ['F', 'Filles'],
          ] as const
        ).map(([v, label]) => (
          <button key={v} onClick={() => setSex(v)} className={`flex-1 py-1.5 ${sex === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select className={`field py-1.5 text-xs ${year ? 'border-accent font-bold' : ''}`} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">Toutes les années</option>
          {[...years, ...(year && !years.some(([y]) => y === year) ? [[year, 0] as [string, number]] : [])].map(([y, n]) => (
            <option key={y} value={y}>
              {y} ({n})
            </option>
          ))}
        </select>
        <select
          className={`field py-1.5 text-xs ${quarter ? `font-bold ${QUARTER_ACTIVE[quarter - 1]}` : ''}`}
          value={quarter}
          onChange={(e) => setQuarter(Number(e.target.value))}
        >
          <option value={0}>Tous les trimestres</option>
          {QUARTER_LABELS.map((l, i) => (
            <option key={i} value={i + 1}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
        {(
          [
            ['all', 'Toutes'],
            ['droitier', 'Droitiers'],
            ['gaucher', 'Gauchers'],
            ['ambidextre', 'Ambi.'],
          ] as const
        ).map(([v, label]) => (
          <button key={v} onClick={() => setHand(v)} className={`flex-1 py-1.5 ${hand === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
            {label}
          </button>
        ))}
      </div>
      {depts.length > 1 || dept ? (
        <select className="field py-1.5 text-xs" value={dept} onChange={(e) => (setDept(e.target.value), setClub(''))}>
          <option value="">Tous les départements ({bySex.length.toLocaleString('fr-FR')})</option>
          {depts.map(([d, n]) => (
            <option key={d} value={d}>
              {departmentLabel(d)} ({n.toLocaleString('fr-FR')})
            </option>
          ))}
        </select>
      ) : null}
      <ClubPicker clubs={clubs} total={byDept.length} value={club} onChange={setClub} />
      {groups.length > 0 && (
        <select
          className={`field py-1.5 text-xs ${group ? 'border-accent font-bold' : ''}`}
          value={group}
          onChange={(e) => (setGroup(e.target.value), setDept(''), setClub(''))}
        >
          <option value="">Tous les joueurs (sans groupe choisi)</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.private ? '🔒 ' : ''}Groupe : {g.name} ({g.playerIds.length.toLocaleString('fr-FR')}){g.archived ? ' — archivé' : ''}
            </option>
          ))}
        </select>
      )}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ id: 'all' as const, short: 'Tous postes' }, ...POSITIONS, { id: 'none' as const, short: 'Sans poste' }].map((p) => {
          const n = p.id === 'all' ? scoped.length : (positionCounts[p.id] ?? 0)
          if (p.id !== 'all' && !n && position !== p.id) return null
          return (
            <button
              key={p.id}
              onClick={() => setPosition(p.id)}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-bold ${
                position === p.id ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-muted'
              }`}
            >
              {p.short} {n}
            </button>
          )
        })}
      </div>
      <label className="-mt-1 flex items-center gap-1.5 self-start text-[11px] text-muted">
        <input type="checkbox" checked={withSecondary} onChange={(e) => setWithSecondary(e.target.checked)} />
        Inclure les postes secondaires
      </label>
      {active && (
        <button className="self-start text-[11px] font-bold text-muted underline" onClick={reset}>
          Effacer les filtres
        </button>
      )}
    </div>
  )

  /** Change dès qu'un filtre change (pas quand les données se mettent à jour). */
  const signature = JSON.stringify([q, sex, hand, quarter, group, dept, club, year, position, withSecondary])
  return { filtered, ui, active, reset, signature, group: current }
}

/** Choix du club en tapant une partie de son nom (la ligue compte une centaine de clubs). */
function ClubPicker({
  clubs,
  total,
  value,
  onChange,
}: {
  clubs: [string, number][]
  total: number
  value: string
  onChange: (club: string) => void
}) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const blurTimer = useRef<number | undefined>(undefined)
  const listRef = useRef<HTMLDivElement>(null)
  const words = fold(text).split(/\s+/).filter(Boolean)
  const matches = clubs.filter(([c]) => words.every((w) => fold(c).includes(w)))
  useEffect(() => setActive(0), [text])
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (c: string) => {
    onChange(c)
    setText('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        className={`field py-1.5 pr-7 text-xs ${value && !open ? 'font-bold' : ''}`}
        placeholder={`Tous les clubs (${total.toLocaleString('fr-FR')}) — taper un nom…`}
        value={open ? text : value}
        onFocus={() => {
          window.clearTimeout(blurTimer.current)
          setText('')
          setOpen(true)
        }}
        // Laisse le temps au clic sur une proposition d'être pris en compte.
        onBlur={() => (blurTimer.current = window.setTimeout(() => setOpen(false), 150))}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // ↑ ↓ pour se déplacer dans les propositions, Entrée pour choisir, Échap pour fermer.
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, matches.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && matches[active]) {
            pick(matches[active][0])
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
        }}
      />
      {value && !open && (
        <button className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted hover:text-white" title="Tous les clubs" onClick={() => pick('')}>
          ✕
        </button>
      )}
      {open && (
        <div ref={listRef} className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-panel shadow-xl">
          <button className="block w-full px-3 py-2 text-left text-xs text-muted hover:bg-panel-2" onMouseDown={(e) => e.preventDefault()} onClick={() => pick('')}>
            Tous les clubs ({total.toLocaleString('fr-FR')})
          </button>
          {matches.map(([c, n], i) => (
            <button
              key={c}
              data-i={i}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full justify-between gap-2 px-3 py-2 text-left text-xs ${i === active ? 'bg-panel-2' : ''} ${c === value ? 'text-accent' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
            >
              <span className="truncate">{c}</span>
              <span className="shrink-0 text-muted">{n}</span>
            </button>
          ))}
          {!matches.length && <div className="px-3 py-2 text-xs text-muted">Aucun club ne correspond.</div>}
        </div>
      )}
    </div>
  )
}

/**
 * Navigation au clavier dans une liste : depuis un champ de saisie, ↓ va au premier élément ;
 * sur un élément, ↑ ↓ passent au précédent / suivant (↑ sur le premier revient au champ).
 * Entrée / Espace activent l'élément (comportement natif des liens et boutons).
 */
export function arrowNav(e: React.KeyboardEvent<HTMLElement>, itemSelector: string) {
  // Les listes de propositions (choix du club…) gèrent déjà leurs flèches.
  if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.defaultPrevented) return
  const root = e.currentTarget
  const items = [...root.querySelectorAll<HTMLElement>(itemSelector)].filter((el) => !(el as HTMLButtonElement).disabled)
  if (!items.length) return
  const target = e.target as HTMLElement
  const i = items.indexOf(target)
  if (i < 0) {
    // Depuis le champ de recherche (ou ailleurs dans la zone) : ↓ va au premier joueur.
    if (e.key === 'ArrowDown' && target.matches('input[placeholder^="Rechercher"]')) {
      e.preventDefault()
      items[0].focus()
    }
    return
  }
  e.preventDefault()
  if (e.key === 'ArrowDown') items[Math.min(i + 1, items.length - 1)].focus()
  else if (i > 0) items[i - 1].focus()
  else root.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')?.focus()
}

/** Ouvre la liste Joueurs filtrée sur un groupe (le filtre est gardé pendant la session). */
export function showGroupInPlayers(groupId: string) {
  try {
    sessionStorage.setItem('handbase.filter.joueurs.group', JSON.stringify(groupId))
    for (const f of ['dept', 'club', 'year', 'q']) sessionStorage.setItem(`handbase.filter.joueurs.${f}`, JSON.stringify(''))
    sessionStorage.setItem('handbase.filter.joueurs.position', JSON.stringify('all'))
    sessionStorage.setItem('handbase.filter.joueurs.hand', JSON.stringify('all'))
    sessionStorage.setItem('handbase.filter.joueurs.quarter', JSON.stringify(0))
  } catch {
    /* stockage indisponible */
  }
}
