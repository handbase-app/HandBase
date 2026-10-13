import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { BackButton } from '../backNav'
import { alive, db, fmtDate, plural, save, today, type HBEvent, type Player, type Rewatch } from '../db'
import {
  coverageByYear,
  fedReport,
  lastSights,
  percent,
  seasonOf,
  toSights,
  totalOf,
  type ClubCoverage,
  type CoveragePeriod,
  type CoverageSex,
  type Sight,
  type Tally,
} from '../coverage'
import { useThrottledQuery } from '../live'
import { MQ, useMedia } from '../layout'
import { can, currentUserId, useRole } from '../roles'
import { scoutId } from '../scouting'
import { loadTeams } from '../teams'
import { useSessionState } from '../components/PlayerFilter'
import { RewatchToggle } from '../components/Scouting'
import { Empty, Icon, Segmented, SectionTitle } from '../components/ui'
import { PlayerRow } from '../components/PlayerRow'
import { FollowStar } from '../components/Follow'

/*
 * Bilan de détection : couverture par génération (« X vus sur N »), clubs où il reste des joueurs à voir, et la liste de
 * ces joueurs. Un joueur est « vu » dès qu'un membre du staff l'a marqué vu ou a donné un avis (src/coverage.ts).
 * Uniquement des marques positives ou neutres : un joueur pas encore vu est « à voir », jamais autre chose.
 */

// ---------- Choix gardés sur l'appareil ----------

const PERIOD_KEY = 'handbase.bilan.period'
/** Même choix Garçons / Filles que les filtres de joueurs (PlayerFilter) : gardé sur l'appareil. */
const SEX_KEY = 'handbase.sexFilter'

function readKey<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null
    return v && allowed.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}
function useStored<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => readKey(key, allowed, fallback))
  const set = (x: T) => {
    setV(x)
    try {
      localStorage.setItem(key, x)
    } catch {
      /* stockage indisponible */
    }
  }
  return [v, set]
}
const usePeriod = () => useStored<CoveragePeriod>(PERIOD_KEY, ['season', 'all'], 'season')

// ---------- Données ----------

/** Joueurs de la base, passages (« vu » et avis) et « à revoir » ; recalculé quand l'une de ces tables change. */
function useCoverageData() {
  return useThrottledQuery(
    async () => {
      const [players, seen, evals, deadEvents, rewatch] = await Promise.all([
        db.players.toArray(),
        db.seen.toArray(),
        db.evaluations.toArray(),
        db.events.filter((e) => !!e.deleted).primaryKeys(),
        db.rewatch.toArray(),
      ])
      const me = scoutId()
      const sights = toSights(seen, evals, {
        deadEvents: new Set(deadEvents as string[]),
        nameOfSeen: (s) => {
          const row = s as (typeof seen)[number]
          const mine = !!me && (row.createdBy ? row.createdBy === me : row.id.startsWith(`${me}:`))
          return mine ? 'toi' : row.createdByName
        },
      })
      const rw = new Map<string, Rewatch[]>()
      for (const r of alive(rewatch)) rw.set(r.playerId, [...(rw.get(r.playerId) ?? []), r])
      return { players, sights, rewatch: rw }
    },
    [],
    ['players', 'seen', 'evaluations', 'events', 'rewatch'],
    300,
  )
}

/** Période choisie : saison en cours (1er septembre → 31 août) ou depuis toujours. */
function periodInfo(period: CoveragePeriod) {
  const s = seasonOf(today())
  return period === 'season'
    ? { range: s, label: `Saison ${s.label}`, long: `saison ${s.label} (du ${fmtDate(s.from)} au ${fmtDate(s.to)})` }
    : { range: undefined, label: 'Depuis toujours', long: 'depuis toujours' }
}

const yearLabel = (y: string) => y || 'Année inconnue'
const clubLabel = (name: string) => name || 'Club non renseigné'

// ---------- Petits éléments ----------

function Bar({ t, className = '' }: { t: Tally; className?: string }) {
  const p = t.total ? (t.seen / t.total) * 100 : 0
  return (
    <span className={`block h-1.5 overflow-hidden rounded-full bg-panel-2 ${className}`}>
      <span className="block h-full rounded-full bg-accent" style={{ width: `${p}%` }} />
    </span>
  )
}

/** « 3 à voir » (bleu, neutre) ou « tous vus » (vert). */
function LeftBadge({ t }: { t: Tally }) {
  const left = t.total - t.seen
  return left > 0 ? (
    <span className="shrink-0 rounded-full border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-sky-300">{left.toLocaleString('fr-FR')} à voir</span>
  ) : (
    <span className="shrink-0 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-emerald-300">tous vus ✓</span>
  )
}

const vusSur = (t: Tally) => `${t.seen.toLocaleString('fr-FR')} vu${t.seen > 1 ? 's' : ''} sur ${t.total.toLocaleString('fr-FR')}`

function Filters({ sex, setSex, period, setPeriod, showSex = true }: { sex: CoverageSex; setSex: (v: CoverageSex) => void; period: CoveragePeriod; setPeriod: (v: CoveragePeriod) => void; showSex?: boolean }) {
  const season = seasonOf(today())
  return (
    <div className="flex flex-col gap-2 sm:flex-row [&_button]:min-h-8">
      {showSex && (
        <div className="sm:w-72">
          <Segmented<CoverageSex>
            value={sex}
            onChange={setSex}
            options={[
              { value: 'all', label: 'Tous' },
              { value: 'M', label: 'Garçons' },
              { value: 'F', label: 'Filles' },
            ]}
          />
        </div>
      )}
      <div className="sm:w-80">
        <Segmented<CoveragePeriod>
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'season', label: `Saison ${season.label}` },
            { value: 'all', label: 'Depuis toujours' },
          ]}
        />
      </div>
    </div>
  )
}

// ---------- Page ----------

export default function Coverage() {
  const role = useRole()
  const data = useCoverageData()
  const [sex, setSex] = useStored<CoverageSex>(SEX_KEY, ['all', 'M', 'F'], 'all')
  const [period, setPeriod] = usePeriod()
  // Génération et club ouverts : retrouvés au retour d'une fiche joueur.
  const [yearSel, setYear] = useSessionState<string | null>('handbase.bilan.year', null)
  const [clubSel, setClub] = useSessionState<string | null>('handbase.bilan.club', null)
  const side = useMedia(MQ.side)
  const whereRef = useRef<HTMLDivElement>(null)

  const last = useMemo(() => (data ? lastSights(data.sights, periodInfo(period).range) : new Map<string, Sight>()), [data, period])
  const years = useMemo(() => (data ? coverageByYear(data.players, last, sex) : []), [data, last, sex])

  if (!can.viewCoverage(role)) return <Empty>Le bilan de détection est réservé aux administrateurs et aux encadrants.</Empty>
  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const total = totalOf(years)
  const gen = years.find((y) => y.year === yearSel) ?? years.find((y) => y.total > y.seen) ?? years[0]
  const club = gen?.clubs.find((c) => c.key === clubSel)
  const pickYear = (y: string) => {
    setYear(y)
    setClub(null)
    if (!side) requestAnimationFrame(() => whereRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const pickClub = (k: string) => setClub(club?.key === k ? null : k)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <BackButton fallback="/" label="ACCUEIL" className="self-start" />
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold">Bilan de détection</h1>
            <p className="text-[11px] text-muted">Un joueur est vu dès qu’un membre du staff l’a marqué « vu » ou a donné un avis sur lui.</p>
          </div>
          <Link to="/bilan/rapport" className="btn-ghost min-h-8 shrink-0 px-3 py-1.5 text-xs">
            <Icon name="list" className="h-3.5 w-3.5" />
            Rapport Fédé
          </Link>
        </div>
        <Filters sex={sex} setSex={setSex} period={period} setPeriod={setPeriod} />
        {total.total > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-[11px]">
            <span className="shrink-0">
              <b className="text-sm">{percent(total.seen, total.total)} %</b> <span className="text-muted">· {vusSur(total)}</span>
            </span>
            <Bar t={total} className="min-w-0 flex-1" />
          </div>
        )}
      </div>

      {!years.length ? (
        <Empty>{sex === 'all' ? 'Aucun joueur dans la base pour l’instant.' : `Aucun${sex === 'F' ? 'e fille' : ' garçon'} dans la base.`}</Empty>
      ) : (
        <>
          <section>
            <SectionTitle info="Une carte par année de naissance. Touche une génération pour voir ses clubs et les joueurs qu’il reste à voir.">Par génération</SectionTitle>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 side:grid-cols-4 xl:grid-cols-6">
              {years.map((y) => {
                const on = y.year === gen?.year
                return (
                  <button
                    key={y.year || 'inconnue'}
                    onClick={() => pickYear(y.year)}
                    aria-pressed={on}
                    className={`card flex min-w-0 flex-col gap-1.5 p-3 text-left transition hover:border-accent ${on ? 'border-accent bg-accent/10' : ''}`}
                  >
                    <span className={`font-extrabold ${y.year ? 'text-lg' : 'text-sm leading-7'}`}>{yearLabel(y.year)}</span>
                    <span className="text-[11px] text-muted">{vusSur(y)}</span>
                    <Bar t={y} />
                    <span className="text-[11px] font-bold">
                      {percent(y.seen, y.total)} %{' '}
                      {y.total > y.seen ? (
                        <span className="font-normal text-sky-300">· {(y.total - y.seen).toLocaleString('fr-FR')} à voir</span>
                      ) : (
                        <span className="font-normal text-emerald-300">· tous vus ✓</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {gen && (
            <div ref={whereRef} className="grid scroll-mt-20 grid-cols-[minmax(0,1fr)] items-start gap-4 side:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
              <section>
                <SectionTitle info="Clubs de cette génération, du plus grand nombre de joueurs à voir au plus petit. Touche un club pour la liste des joueurs.">
                  Où aller ? · {yearLabel(gen.year)}
                </SectionTitle>
                <div className="flex flex-col gap-2">
                  {gen.clubs.map((c) => {
                    const on = c.key === club?.key
                    return (
                      <div key={c.key || 'aucun'} className="flex flex-col gap-2">
                        <button
                          onClick={() => pickClub(c.key)}
                          aria-expanded={on}
                          className={`card flex min-h-11 items-center gap-3 px-3 py-2 text-left transition hover:border-accent ${on ? 'border-accent bg-accent/10' : ''}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-sm font-bold ${c.key ? '' : 'text-muted italic'}`}>{clubLabel(c.name)}</span>
                            <span className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                              <span className="shrink-0">{vusSur(c)}</span>
                              <Bar t={c} className="w-16 sm:w-24" />
                            </span>
                          </span>
                          <LeftBadge t={c} />
                          {!side && <span className={`shrink-0 text-muted transition ${on ? 'rotate-90' : ''}`}>›</span>}
                        </button>
                        {on && !side && <Who club={c} year={gen.year} last={last} rewatch={data.rewatch} />}
                      </div>
                    )
                  })}
                </div>
              </section>
              {side && (
                <section className="sticky top-[calc(var(--hdr)+1rem)] max-h-[calc(100dvh-var(--hdr)-2rem)] overflow-y-auto">
                  <SectionTitle>Qui ?</SectionTitle>
                  {club ? <Who club={club} year={gen.year} last={last} rewatch={data.rewatch} /> : <Empty>Choisis un club pour voir les joueurs qu’il reste à voir.</Empty>}
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------- Qui ? ----------

function Who({ club, year, last, rewatch }: { club: ClubCoverage<Player>; year: string; last: Map<string, Sight>; rewatch: Map<string, Rewatch[]> }) {
  const role = useRole()
  const [showSeen, setShowSeen] = useState(false)
  const [adding, setAdding] = useState<string[] | null>(null)
  const byName = (a: Player, b: Player) => a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' }) || a.firstName.localeCompare(b.firstName, 'fr')
  const toSee = [...club.toSee].sort(byName)
  const seenP = [...club.seenPlayers].sort(byName)
  const addEvents = can.manageEvents(role)
  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-extrabold">{clubLabel(club.name)}</div>
          <div className="text-[11px] text-muted">
            {yearLabel(year)} · {toSee.length ? `${plural(toSee.length, 'joueur')} à voir` : 'tous vus ✓'}
          </div>
        </div>
        {addEvents && toSee.length > 1 && (
          <button className="btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={() => setAdding(toSee.map((p) => p.id))} title="Ajouter tous les joueurs à voir de ce club à un événement à venir">
            <Icon name="calendar" className="h-3.5 w-3.5" />
            Tous à un événement…
          </button>
        )}
      </div>

      {toSee.length > 0 && (
        <div className="flex flex-col gap-2">
          {toSee.map((p) => (
            <PlayerRow
              key={p.id}
              p={p}
              link={{ to: `/joueurs/${p.id}` }}
              sub={p.birthDate?.slice(0, 4) ?? ''}
              rewatch={<RewatchToggle playerId={p.id} rows={rewatch.get(p.id)} />}
              follow={<FollowStar id={p.id} />}
              actions={
                addEvents && (
                  <button type="button" className="-my-2 shrink-0 p-2 text-muted hover:text-accent" title="Ajouter à un événement" aria-label="Ajouter à un événement" onClick={() => setAdding([p.id])}>
                    <Icon name="calendar" className="h-4 w-4" />
                  </button>
                )
              }
            />
          ))}
        </div>
      )}

      {seenP.length > 0 && (
        <div className="border-t border-line pt-1">
          <button className="flex min-h-8 w-full items-center gap-2 text-left text-[11px] font-bold text-emerald-300" aria-expanded={showSeen} onClick={() => setShowSeen(!showSeen)}>
            <Icon name="eye" className="h-3.5 w-3.5" />
            <span className="flex-1">Déjà vus ({seenP.length})</span>
            <span className={`text-muted transition ${showSeen ? 'rotate-90' : ''}`}>›</span>
          </button>
          {showSeen && (
            <div className="mt-1 flex flex-col gap-2">
              {seenP.map((p) => {
                const s = last.get(p.id)
                return (
                  <PlayerRow
                    key={p.id}
                    p={p}
                    link={{ to: `/joueurs/${p.id}` }}
                    sub={[p.birthDate?.slice(0, 4), s && `vu le ${fmtDate(s.day)}${s.by ? `, par ${s.by}` : ''}`].filter(Boolean).join(' · ')}
                    follow={<FollowStar id={p.id} />}
                  />
                )
              })}
            </div>
          )}
        </div>
      )}
      {adding && <AddToEventDialog playerIds={adding} onClose={() => setAdding(null)} />}
    </div>
  )
}

// ---------- Ajouter à un événement ----------

/** Événements à venir où je peux ajouter des joueurs (organisateur, administrateur, participant) ; un toucher les ajoute. */
function AddToEventDialog({ playerIds, onClose }: { playerIds: string[]; onClose: () => void }) {
  const role = useRole()
  const [done, setDone] = useState<string | null>(null)
  const events = useLiveQuery(async () => {
    await loadTeams()
    const rows = alive(await db.events.where('date').aboveOrEqual(today()).toArray())
    return rows.filter((e) => !e.archived && (can.editEvent(role, e) || can.contributeEvent(role, e))).sort((a, b) => a.date.localeCompare(b.date))
  }, [role])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const n = playerIds.length
  const who = n > 1 ? plural(n, 'joueur') : 'ce joueur'

  async function add(ev: HBEvent) {
    const cur = (await db.events.get(ev.id)) ?? ev
    const ids = cur.playerIds ?? []
    const added = playerIds.filter((id) => !ids.includes(id))
    if (added.length) {
      // « Ajouté par » : posé ici pour l'affichage ; le serveur le refait (supabase/024).
      const me = currentUserId()
      await save<HBEvent>('events', {
        ...cur,
        playerIds: [...ids, ...added],
        ...(me && { addedBy: { ...cur.addedBy, ...Object.fromEntries(added.map((id) => [id, me])) } }),
      })
    }
    setDone(added.length ? `${added.length > 1 ? plural(added.length, 'joueur') + ' ajoutés' : 'Joueur ajouté'} à « ${cur.name} ».` : `Déjà dans « ${cur.name} ».`)
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="card flex max-h-[80dvh] w-full max-w-md flex-col gap-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-extrabold">Ajouter {who} à un événement</div>
        {done ? (
          <p className="text-xs text-emerald-300">{done}</p>
        ) : events === undefined ? (
          <div className="text-xs text-muted">Chargement…</div>
        ) : events.length ? (
          <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
            {events.map((e) => {
              const inside = playerIds.filter((id) => e.playerIds?.includes(id)).length
              return (
                <button key={e.id} onClick={() => void add(e)} className="flex min-h-10 items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-left text-xs hover:border-accent">
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{e.name}</b>
                    <span className="text-muted">
                      {fmtDate(e.date)}
                      {e.place ? ` · ${e.place}` : ''}
                    </span>
                  </span>
                  {inside > 0 && <span className="shrink-0 text-[10px] text-muted">{inside === n ? 'déjà dedans' : `${inside} déjà dedans`}</span>}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted">Aucun événement à venir que tu peux compléter. Crée-le d’abord dans Événements.</p>
        )}
        <div className="flex justify-end gap-2">
          {done && (
            <button className="btn-ghost px-4 text-xs" onClick={() => setDone(null)}>
              Un autre événement
            </button>
          )}
          <button className="btn-primary px-4 text-xs" onClick={onClose}>
            {done ? 'OK' : 'Fermer'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- Rapport chiffré ----------

const cell = (t: Tally) => (t.total ? `${t.seen.toLocaleString('fr-FR')}/${t.total.toLocaleString('fr-FR')}` : '–')
const pct = (t: Tally) => (t.total ? `${percent(t.seen, t.total)} %` : '–')

/**
 * Rapport pour la fédération, à imprimer (ou enregistrer en PDF) : seulement des nombres par génération, sexe et club,
 * et les totaux ; aucun nom de joueur. Feuille blanche à l'écran comme à l'impression.
 */
export function CoverageReport() {
  const role = useRole()
  const data = useCoverageData()
  const [period, setPeriod] = usePeriod()
  const info = periodInfo(period)
  const report = useMemo(() => (data ? fedReport(data.players, lastSights(data.sights, periodInfo(period).range)) : null), [data, period])

  if (!can.viewCoverage(role)) return <Empty>Le bilan de détection est réservé aux administrateurs et aux encadrants.</Empty>
  if (!report) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const noSex = report.total.all.total - report.total.M.total - report.total.F.total
  // Cellules : nom à gauche (retour à la ligne permis), nombres à droite sur une ligne.
  const th = 'border-b border-neutral-400 px-1 py-1 font-bold sm:px-1.5'
  const td = 'border-b border-neutral-200 px-1 py-1 sm:px-1.5'
  const num = 'text-right tabular-nums whitespace-nowrap'
  const name = 'text-left break-words'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="no-print flex flex-col gap-2">
        <BackButton fallback="/bilan" label="BILAN DE DÉTECTION" className="self-start" />
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 flex-1 text-lg font-extrabold">Rapport Fédé</h1>
          <button className="btn-primary min-h-8 px-4 py-1.5 text-xs" onClick={() => window.print()}>
            Imprimer / PDF
          </button>
        </div>
        <p className="text-[11px] text-muted">Seulement des nombres, par génération, sexe et club : aucun nom de joueur.</p>
        <Filters sex="all" setSex={() => {}} period={period} setPeriod={setPeriod} showSex={false} />
      </div>

      <article className="report rounded-lg bg-white p-3 text-[11px] text-neutral-900 shadow sm:p-6 print:rounded-none print:p-0 print:shadow-none">
        <div className="mb-3 border-b-2 border-neutral-900 pb-2">
          <div className="text-[10px] font-bold tracking-widest text-neutral-500">HANDBASE</div>
          <h2 className="text-base font-extrabold">Bilan de détection</h2>
          <div>
            Édité le {fmtDate(today())} · Période : {info.long}
          </div>
          <div className="text-neutral-600">Un joueur est compté « vu » dès qu’un membre du staff l’a marqué vu ou a donné un avis sur lui. Chiffres : vus/joueurs dans la base ; G. garçons, F. filles, Ens. ensemble.</div>
        </div>

        <table className="mb-4 w-full border-collapse">
          <thead>
            <tr>
              <th className={`${th} ${name}`}>Génération</th>
              <th className={`${th} ${num}`}>G.</th>
              <th className={`${th} ${num}`}>F.</th>
              <th className={`${th} ${num}`}>Ens.</th>
              <th className={`${th} ${num}`}>%</th>
            </tr>
          </thead>
          <tbody>
            <tr className="font-bold">
              <td className={`${td} ${name}`}>Toutes</td>
              <td className={`${td} ${num}`}>{cell(report.total.M)}</td>
              <td className={`${td} ${num}`}>{cell(report.total.F)}</td>
              <td className={`${td} ${num}`}>{cell(report.total.all)}</td>
              <td className={`${td} ${num}`}>{pct(report.total.all)}</td>
            </tr>
            {report.years.map((y) => (
              <tr key={y.year || 'inconnue'}>
                <td className={`${td} ${name}`}>{yearLabel(y.year)}</td>
                <td className={`${td} ${num}`}>{cell(y.M)}</td>
                <td className={`${td} ${num}`}>{cell(y.F)}</td>
                <td className={`${td} ${num}`}>{cell(y.all)}</td>
                <td className={`${td} ${num}`}>{pct(y.all)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {report.years.map((y) => (
          <section key={y.year || 'inconnue'} className="mb-4 break-inside-avoid">
            <h3 className="mb-1 text-[12px] font-extrabold">
              {yearLabel(y.year)} — {cell(y.all)} vus ({percent(y.all.seen, y.all.total)} %)
            </h3>
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col />
                <col className="w-[17%]" />
                <col className="w-[15%]" />
                <col className="w-[17%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead>
                <tr>
                  <th className={`${th} ${name}`}>Club</th>
                  <th className={`${th} ${num}`}>G.</th>
                  <th className={`${th} ${num}`}>F.</th>
                  <th className={`${th} ${num}`}>Ens.</th>
                  <th className={`${th} ${num}`}>%</th>
                </tr>
              </thead>
              <tbody>
                {y.clubs.map((c) => (
                  <tr key={c.name || 'aucun'}>
                    <td className={`${td} ${name} ${c.name ? '' : 'italic'}`}>{clubLabel(c.name)}</td>
                    <td className={`${td} ${num}`}>{cell(c.M)}</td>
                    <td className={`${td} ${num}`}>{cell(c.F)}</td>
                    <td className={`${td} ${num}`}>{cell(c.all)}</td>
                    <td className={`${td} ${num} text-neutral-600`}>{pct(c.all)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {noSex > 0 && <p className="text-neutral-600">« Ens. » compte aussi {plural(noSex, 'joueur')} dont le sexe n’est pas renseigné.</p>}
        {!report.years.length && <p>Aucun joueur dans la base.</p>}
      </article>
    </div>
  )
}
