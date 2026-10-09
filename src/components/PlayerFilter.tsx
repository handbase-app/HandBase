import { useAlerts } from '../alerts'
import { useFollows } from '../follows'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { departmentLabel, regionOfDept, useDepartments, useRegionLabel } from '../lists'
import { can, groupTag } from '../roles'
import { loadTeams } from '../teams'
import { birthQuarter, Icon } from './ui'
import { CourtFilter } from './CourtPicker'
import { MQ, useMedia } from '../layout'
import { alive, db, poleStatus, POSITIONS, type Laterality, type Measurement, type Player, type Position } from '../db'

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
 * Filtres communs (groupe, sexe, région, département, club, année de naissance, poste, recherche) pour parcourir des milliers
 * de joueurs. Le choix Garçons / Filles est mémorisé sur l'appareil ; les autres filtres le sont
 * pendant la session, séparément pour chaque écran (`scope`).
 */
export function usePlayerFilter(
  players: Player[] | undefined,
  scope = 'joueurs',
  opts: { hide?: ('dept' | 'region')[]; dock?: boolean } = {},
) {
  const k = (name: string) => `handbase.filter.${scope}.${name}`
  const wideScreen = useMedia(MQ.xl)
  // Filtres gérés par l'écran lui-même (Vue nationale : la carte choisit la région et le département) :
  // absents du panneau, des pastilles et de « Tout effacer ». Un département masqué n'est jamais appliqué ;
  // une région masquée l'est (l'écran la change avec `setRegion`).
  const hideDept = !!opts.hide?.includes('dept')
  const hideRegion = !!opts.hide?.includes('region')
  const regionLabel = useRegionLabel()
  const [region, setRegion] = useSessionState(k('region'), '')
  const [q, setQ] = useSessionState(k('q'), '')
  const [sex, setSexState] = useState<SexFilter>(readSex)
  useDepartments() // noms des départements à jour dans le menu
  const [group, setGroup] = useSessionState(k('group'), '')
  // Profil recherché (alerte enregistrée) : seulement les joueurs qui y correspondent.
  const [profile, setProfile] = useSessionState(k('profile'), '')
  // Seulement les joueurs que je suis (un par un ou par leurs groupes, « Mes suivis »).
  const [followedOnly, setFollowedOnly] = useSessionState(k('followed'), false)
  // Pôle Espoirs : '' (tous), 'current' (en cours), 'past' (sortis), 'any' (en cours ou passés).
  const [pole, setPole] = useSessionState(k('pole'), '')
  const [videoOnly, setVideoOnly] = useSessionState(k('video'), false)
  const [deptState, setDept] = useSessionState(k('dept'), '')
  const dept = hideDept ? '' : deptState
  const [club, setClub] = useSessionState(k('club'), '')
  const [year, setYear] = useSessionState(k('year'), '')
  const [position, setPosition] = useSessionState<Position | 'all' | 'none'>(k('position'), 'all')
  // Compter aussi les joueurs qui ont ce poste en secondaire (« qui peut dépanner demi-centre ? »).
  const [withSecondary, setWithSecondary] = useSessionState(k('withSecondary'), false)
  const [hand, setHand] = useSessionState<'all' | Laterality>(k('hand'), 'all')
  // Trimestre de naissance (Q1 = janvier–mars … Q4 = octobre–décembre).
  const [quarter, setQuarter] = useSessionState(k('quarter'), 0)
  // Taille minimum (cm), d'après la dernière mesure : « plus de 1 m 80 » = 180.
  const [minH, setMinH] = useSessionState(k('minH'), '')
  const lo = Number(minH) || 0
  // Dernière taille de chaque joueur (chargée seulement quand le filtre sert).
  const heights = useLiveQuery(
    async () => {
      if (!lo) return null
      const last = new Map<string, Measurement>()
      for (const m of await db.measurements.where('criterionId').equals('taille').toArray()) {
        if (m.deleted || typeof m.value !== 'number') continue
        const cur = last.get(m.playerId)
        if (!cur || m.date > cur.date || (m.date === cur.date && m.updatedAt > cur.updatedAt)) last.set(m.playerId, m)
      }
      return new Map([...last].map(([id, m]) => [id, m.value as number]))
    },
    [!lo],
    null,
  )

  const setSex = (v: SexFilter) => {
    setSexState(v)
    try {
      localStorage.setItem(SEX_KEY, v)
    } catch {
      /* stockage indisponible */
    }
  }

  // Groupes (Intercomités, Pôle…) : le groupe choisi limite la liste avant tous les autres filtres.
  const groups = useLiveQuery(
    () => loadTeams().then(() => db.groups.orderBy('name').toArray().then((gs) => alive(gs).filter((g) => can.seeGroup(g) && (!g.archived || g.id === group)))),
    [group],
    [],
  )
  const current = groups.find((g) => g.id === group)
  // Profils recherchés : calcul déjà partagé avec la cible de l'en-tête (rien de plus à calculer).
  const profiles = useAlerts()?.alerts
  const currentProfile = profiles?.find((a) => a.alert.id === profile)
  const followed = useFollows()?.followed
  // Joueurs qui ont au moins un lien vidéo (supabase/036) : lu seulement quand le filtre est actif.
  const withVideo = useLiveQuery(
    async () => (videoOnly ? new Set((await db.videos.toArray()).filter((v) => !v.deleted && v.targetKind === 'player').map((v) => v.targetId)) : undefined),
    [videoOnly],
  )
  const all = useMemo(() => {
    let list = players ?? []
    if (followedOnly) list = followed ? list.filter((p) => followed.has(p.id)) : []
    if (pole) list = list.filter((p) => (pole === 'any' ? !!poleStatus(p) : poleStatus(p) === pole))
    if (videoOnly) list = withVideo ? list.filter((p) => withVideo.has(p.id)) : []
    if (group) {
      const ids = new Set(current?.playerIds ?? [])
      list = list.filter((p) => ids.has(p.id))
    }
    if (profile && currentProfile) {
      const ids = new Set(currentProfile.players.map((p) => p.id))
      list = list.filter((p) => ids.has(p.id))
    }
    return list
  }, [players, group, current, profile, currentProfile, followedOnly, followed, pole, videoOnly, withVideo])
  // Chaque menu compte les joueurs qui passent tous les AUTRES filtres : le nombre affiché à côté d'une
  // année, d'un département ou d'un club est celui qu'on obtiendra en le choisissant.
  const base0 = useMemo(
    () =>
      all.filter((p) => {
        if (!((sex === 'all' || p.sex === sex) && (hand === 'all' || p.laterality === hand) && (!quarter || birthQuarter(p.birthDate) === quarter))) return false
        if (!lo) return true
        // Filtre de taille : un joueur jamais mesuré n'y passe pas.
        const h = heights?.get(p.id)
        return h !== undefined && h >= lo
      }),
    [all, sex, hand, quarter, lo, heights],
  )
  const okDept = (p: Player) => !dept || department(p) === dept
  const okClub = (p: Player) => !club || p.club === club
  const okYear = (p: Player) => !year || !!p.birthDate?.startsWith(year)
  // Région : limite les départements et les clubs proposés (comptée avant le choix du département).
  const regionOf = (p: Player) => regionOfDept(department(p))
  const regionBase = useMemo(() => base0.filter((p) => okClub(p) && okYear(p)), [base0, club, year]) // eslint-disable-line react-hooks/exhaustive-deps
  const regionCounts = useMemo(() => countBy(regionBase, regionOf), [regionBase]) // eslint-disable-line react-hooks/exhaustive-deps
  const base = useMemo(() => (region ? base0.filter((p) => regionOf(p) === region) : base0), [base0, region]) // eslint-disable-line react-hooks/exhaustive-deps
  const deptBase = useMemo(() => base.filter((p) => okClub(p) && okYear(p)), [base, club, year]) // eslint-disable-line react-hooks/exhaustive-deps
  const clubBase = useMemo(() => base.filter((p) => okDept(p) && okYear(p)), [base, dept, year]) // eslint-disable-line react-hooks/exhaustive-deps
  const yearBase = useMemo(() => base.filter((p) => okDept(p) && okClub(p)), [base, dept, club]) // eslint-disable-line react-hooks/exhaustive-deps
  const depts = useMemo(() => countBy(deptBase, department), [deptBase])
  const clubs = useMemo(() => countBy(clubBase, (p) => p.club), [clubBase])
  const years = useMemo(() => countBy(yearBase, (p) => p.birthDate?.slice(0, 4)).sort((a, b) => b[0].localeCompare(a[0])), [yearBase])
  const scoped = useMemo(() => yearBase.filter(okYear), [yearBase, year]) // eslint-disable-line react-hooks/exhaustive-deps
  // Recherche, puis postes (comptés après la recherche : le chiffre d'un poste est celui qu'on obtiendra).
  const searched = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean)
    if (!words.length) return scoped
    return scoped.filter((p) => {
      const hay = fold(`${p.firstName} ${p.lastName} ${p.club ?? ''} ${p.team ?? ''} ${p.license ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
  }, [scoped, q])
  const positionCounts = useMemo(() => {
    const c: Record<string, number> = { none: 0 }
    for (const p of searched) {
      c[p.position ?? 'none'] = (c[p.position ?? 'none'] ?? 0) + 1
      if (withSecondary) for (const x of p.secondaryPositions ?? []) if (x !== p.position) c[x] = (c[x] ?? 0) + 1
    }
    return c
  }, [searched, withSecondary])

  const filtered = useMemo(
    () =>
      searched.filter((p) => {
        if (position === 'none') return !p.position
        if (position === 'all') return true
        return p.position === position || (withSecondary && !!p.secondaryPositions?.includes(position))
      }),
    [searched, position, withSecondary],
  )

  const active =
    !!q || sex !== 'all' || hand !== 'all' || !!quarter || !!lo || !!group || !!profile || followedOnly || !!pole || videoOnly || (!hideRegion && !!region) || !!dept || !!club || !!year || position !== 'all' || withSecondary
  const reset = () => {
    if (!hideRegion) setRegion('')
    setQ('')
    setSex('all')
    setHand('all')
    setQuarter(0)
    setMinH('')
    setGroup('')
    setProfile('')
    setFollowedOnly(false)
    setPole('')
    setVideoOnly(false)
    setDept('')
    setClub('')
    setYear('')
    setPosition('all')
    setWithSecondary(false)
  }

  // Filtres repliés par défaut : la recherche et les postes restent visibles, les filtres actifs
  // s'affichent en pastilles qu'on retire d'un appui.
  const [open, setOpen] = useSessionState(k('open'), false)
  const chips: { label: string; clear: () => void }[] = [
    sex !== 'all' && { label: sex === 'M' ? 'Garçons' : 'Filles', clear: () => setSex('all') },
    year && { label: year, clear: () => setYear('') },
    !!quarter && { label: `Q${quarter}`, clear: () => setQuarter(0) },
    !!lo && { label: `≥ ${lo} cm`, clear: () => setMinH('') },
    hand !== 'all' && { label: hand === 'droitier' ? 'Droitiers' : hand === 'gaucher' ? 'Gauchers' : 'Ambidextres', clear: () => setHand('all') },
    !hideRegion && region && { label: regionLabel(region), clear: () => (setRegion(''), setDept(''), setClub('')) },
    dept && { label: departmentLabel(dept), clear: () => (setDept(''), setClub('')) },
    club && { label: club, clear: () => setClub('') },
    followedOnly && { label: 'Suivis', clear: () => setFollowedOnly(false) },
    pole && { label: POLE_LABEL[pole] ?? 'Pôle', clear: () => setPole('') },
    videoOnly && { label: 'Avec vidéo', clear: () => setVideoOnly(false) },
    currentProfile && { label: `Profil : ${currentProfile.alert.name}`, clear: () => setProfile('') },
    current && { label: `Groupe : ${current.name}`, clear: () => (setGroup(''), !hideRegion && setRegion(''), setDept(''), setClub('')) },
    position !== 'all' && { label: position === 'none' ? 'Sans poste' : (POSITIONS.find((x) => x.id === position)?.label ?? position), clear: () => setPosition('all') },
    withSecondary && { label: '+ postes secondaires', clear: () => setWithSecondary(false) },
  ].filter((c): c is { label: string; clear: () => void } => !!c)

  const panel = (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-2.5">
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
          <div className="flex items-center gap-2 text-xs">
            <span className="shrink-0 font-bold text-muted">Taille minimum (cm)</span>
            <input
              className={`field min-w-0 flex-1 py-1.5 text-xs ${lo ? 'border-accent font-bold' : ''}`}
              type="number"
              inputMode="numeric"
              placeholder="ex. 180"
              value={minH}
              onChange={(e) => setMinH(e.target.value)}
            />
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
          {!hideRegion && (regionCounts.length > 1 || region) ? (
            <select
              className={`field py-1.5 text-xs ${region ? 'border-accent font-bold' : ''}`}
              value={region}
              onChange={(e) => (setRegion(e.target.value), setDept(''), setClub(''))}
            >
              <option value="">Toutes les régions ({regionBase.length.toLocaleString('fr-FR')})</option>
              {[...regionCounts]
                .sort((a, b) => regionLabel(a[0]).localeCompare(regionLabel(b[0]), 'fr'))
                .map(([r, n]) => (
                  <option key={r} value={r}>
                    {regionLabel(r)} ({n.toLocaleString('fr-FR')})
                  </option>
                ))}
            </select>
          ) : null}
          {!hideDept && (depts.length > 1 || dept) ? (
            <select className="field py-1.5 text-xs" value={dept} onChange={(e) => (setDept(e.target.value), setClub(''))}>
              <option value="">Tous les départements ({deptBase.length.toLocaleString('fr-FR')})</option>
              {depts.map(([d, n]) => (
                <option key={d} value={d}>
                  {departmentLabel(d)} ({n.toLocaleString('fr-FR')})
                </option>
              ))}
            </select>
          ) : null}
          <ClubPicker clubs={clubs} total={clubBase.length} value={club} onChange={setClub} />
          <select className={`field py-1.5 text-xs ${pole ? 'border-accent font-bold' : ''}`} value={pole} onChange={(e) => setPole(e.target.value)}>
            <option value="">Pôle Espoirs : tous les joueurs</option>
            <option value="current">{POLE_LABEL.current}</option>
            <option value="past">{POLE_LABEL.past}</option>
            <option value="any">{POLE_LABEL.any}</option>
          </select>
          <button
            onClick={() => setVideoOnly(!videoOnly)}
            className={`flex items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-bold ${videoOnly ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-panel-2 text-muted'}`}
          >
            Seulement les joueurs avec une vidéo
          </button>
          {(!!followed?.size || followedOnly) && (
            <button
              onClick={() => setFollowedOnly(!followedOnly)}
              className={`flex items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-bold ${followedOnly ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-panel-2 text-muted'}`}
            >
              <Icon name="star" filled={followedOnly} className="h-3.5 w-3.5 text-accent" />
              Seulement mes suivis ({followed?.size.toLocaleString('fr-FR') ?? 0})
            </button>
          )}
          {!!profiles?.length && (
            <select className={`field py-1.5 text-xs ${profile ? 'border-accent font-bold' : ''}`} value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="">Tous les joueurs (sans profil recherché)</option>
              {profiles.map(({ alert, players: ps }) => (
                <option key={alert.id} value={alert.id}>
                  Profil : {alert.name}{alert.private ? ' (privé)' : ''} ({ps.length.toLocaleString('fr-FR')})
                </option>
              ))}
            </select>
          )}
          {groups.length > 0 && (
            <select
              className={`field py-1.5 text-xs ${group ? 'border-accent font-bold' : ''}`}
              value={group}
              onChange={(e) => (setGroup(e.target.value), !hideRegion && setRegion(''), setDept(''), setClub(''))}
            >
              <option value="">Tous les joueurs (sans groupe choisi)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  Groupe : {g.name}{groupTag(g)} ({g.playerIds.length.toLocaleString('fr-FR')}){g.archived ? ' — archivé' : ''}
                </option>
              ))}
            </select>
          )}
          <div className="flex flex-col gap-1.5 rounded-md border border-line bg-panel-2/50 p-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-muted">Poste</span>
              <span className="flex gap-1.5">
                <button
                  onClick={() => setPosition('all')}
                  className={`rounded-md border px-2 py-0.5 font-bold ${position === 'all' ? 'border-accent bg-accent text-white' : 'border-line text-muted'}`}
                >
                  Tous {searched.length}
                </button>
                {(positionCounts.none > 0 || position === 'none') && (
                  <button
                    onClick={() => setPosition(position === 'none' ? 'all' : 'none')}
                    className={`rounded-md border px-2 py-0.5 font-bold ${position === 'none' ? 'border-accent bg-accent text-white' : 'border-line text-muted'}`}
                  >
                    Sans poste {positionCounts.none}
                  </button>
                )}
              </span>
            </div>
            <CourtFilter value={position} counts={positionCounts} onChange={setPosition} />
            <label className="flex items-center gap-1.5 self-start text-[11px] text-muted">
              <input type="checkbox" checked={withSecondary} onChange={(e) => setWithSecondary(e.target.checked)} />
              Inclure les postes secondaires
            </label>
          </div>
        </div>
  )

  // Grand écran (opts.dock) : le panneau est toujours ouvert, dans une colonne à côté de la liste (`side`).
  const docked = !!opts.dock && wideScreen
  const ui = (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input className="field min-w-0 flex-1" placeholder="Rechercher…" title="Nom, club ou licence" value={q} onChange={(e) => setQ(e.target.value)} />
        {!docked && (
          <button
            onClick={() => setOpen(!open)}
            className={`shrink-0 rounded-md border px-3 text-xs font-bold ${open || chips.length ? 'border-accent text-fg' : 'border-line text-muted'} ${open ? 'bg-accent/15' : 'bg-panel-2'}`}
          >
            Filtres{chips.length > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] text-white">{chips.length}</span>} {open ? '▴' : '▾'}
          </button>
        )}
      </div>
      {open && !docked && panel}
      {(chips.length > 0 || active) && !open && !docked && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button key={c.label} onClick={c.clear} className="rounded-full border border-accent/60 bg-accent/10 px-2 py-0.5 text-[11px] font-bold">
              {c.label} <span className="text-muted">✕</span>
            </button>
          ))}
          {active && (
            <button className="text-[11px] font-bold text-muted underline" onClick={reset}>
              Tout effacer
            </button>
          )}
        </div>
      )}
      {open && active && !docked && (
        <button className="self-start text-[11px] font-bold text-muted underline" onClick={reset}>
          Effacer les filtres
        </button>
      )}
    </div>
  )
  const side = docked ? (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="section-title mb-0">Filtres{chips.length > 0 && ` (${chips.length})`}</span>
        {active && (
          <button className="text-[11px] font-bold text-muted underline" onClick={reset}>
            Effacer les filtres
          </button>
        )}
      </div>
      {panel}
    </div>
  ) : null

  /** Change dès qu'un filtre change (pas quand les données se mettent à jour). */
  const signature = JSON.stringify([q, sex, hand, quarter, lo, group, profile, followedOnly, pole, videoOnly, region, dept, club, year, position, withSecondary])
  return { filtered, ui, side, active, reset, signature, group: current, region, setRegion, regionCounts }
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
        <button className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted hover:text-fg" title="Tous les clubs" onClick={() => pick('')}>
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
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key) || e.defaultPrevented) return
  // ← → ne servent qu'entre éléments (dans un champ, ils déplacent le curseur).
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target as HTMLElement).matches(itemSelector)) return
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
  // Liste en colonnes (paysage, ordinateur) : ↑ ↓ changent de ligne en restant dans la colonne,
  // ← → passent à l'élément voisin. Sur une seule colonne, c'est l'élément précédent / suivant.
  const top0 = items[0].getBoundingClientRect().top
  let cols = 1
  while (cols < items.length && Math.abs(items[cols].getBoundingClientRect().top - top0) < 2) cols++
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const j = i + (e.key === 'ArrowRight' ? 1 : -1)
    if (j >= 0 && j < items.length) items[j].focus()
    return
  }
  if (e.key === 'ArrowDown') items[Math.min(i + cols, items.length - 1)].focus()
  else if (i - cols >= 0) items[i - cols].focus()
  else root.querySelector<HTMLInputElement>('input[placeholder^="Rechercher"]')?.focus()
}

/** Ouvre la liste Joueurs filtrée sur un groupe (le filtre est gardé pendant la session). */
export function showGroupInPlayers(groupId: string) {
  try {
    sessionStorage.setItem('handbase.filter.joueurs.group', JSON.stringify(groupId))
    for (const f of ['region', 'dept', 'club', 'year', 'q']) sessionStorage.setItem(`handbase.filter.joueurs.${f}`, JSON.stringify(''))
    sessionStorage.setItem('handbase.filter.joueurs.position', JSON.stringify('all'))
    sessionStorage.setItem('handbase.filter.joueurs.hand', JSON.stringify('all'))
    sessionStorage.setItem('handbase.filter.joueurs.quarter', JSON.stringify(0))
    sessionStorage.setItem('handbase.filter.joueurs.followed', JSON.stringify(false))
  } catch {
    /* stockage indisponible */
  }
}

/** Filtres d'un écran (hors département et repli/dépli). */
const POLE_LABEL: Record<string, string> = { current: 'Au Pôle Espoirs (en cours)', past: 'Sortis du Pôle Espoirs', any: 'Passés par le Pôle Espoirs (en cours ou sortis)' }

const FILTER_KEYS = ['q', 'group', 'region', 'club', 'year', 'position', 'withSecondary', 'hand', 'quarter', 'minH', 'profile', 'followed', 'pole', 'video'] as const

/**
 * Ouvre la liste Joueurs avec les filtres d'un autre écran (`from`, région comprise), plus un département.
 * Le choix Garçons / Filles est déjà commun à tous les écrans.
 */
export function showDeptInPlayers(from: string, dept: string) {
  try {
    for (const f of FILTER_KEYS) {
      const v = sessionStorage.getItem(`handbase.filter.${from}.${f}`)
      if (v === null) sessionStorage.removeItem(`handbase.filter.joueurs.${f}`)
      else sessionStorage.setItem(`handbase.filter.joueurs.${f}`, v)
    }
    sessionStorage.setItem('handbase.filter.joueurs.dept', JSON.stringify(dept))
  } catch {
    /* stockage indisponible */
  }
}
