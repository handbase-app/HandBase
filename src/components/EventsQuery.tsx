import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { alive, db, today, type HBEvent, type Player } from '../db'
import { departmentLabel, regionOfDept, useRegionName } from '../lists'
import { currentUserId, isParticipant } from '../roles'
import { useTeams } from '../teams'
import { useVoicePlaces } from '../voicePlaces'
import { countBy, filterItems, type ListQuery } from '../listQuery'
import {
  buildEventsSchema,
  EVENT_TYPE_LIST,
  eventInfo,
  eventPlayerCount,
  eventsNeedInfo,
  eventsSpec,
  periodRange,
  readEventsRecipe,
  type EventCtx,
  type EventFilters,
  type EventPeriod,
} from '../eventQuery'
import { department } from './PlayerFilter'
import { SegRow, SortCalcPicker, ToggleChip, useListQuery } from './ListQuery'
import { YearPicker } from './YearPicker'
import { MultiPicker } from './MultiPicker'
import { ChoicePills, FilterField } from './FilterWindow'
import { uniqYears } from '../birthYears'

/*
 * Liste Événements : filtres = recette « événements » (src/eventQuery.ts), même expérience que la liste Joueurs
 * (src/components/ListQuery.tsx). Données lues ici : avis par événement (de la page), vidéos, joueurs « à revoir » ;
 * lieu (département) et génération des événements : lus seulement quand un filtre, un calcul ou le panneau les demande.
 */

export type EventStats = { avis: number; players: Set<string> }

const SHORT: Record<string, string> = { entrainement: 'Entraîn.', observation: 'Observ.' }
const WHEN: { value: string; label: string }[] = [
  { value: 'upcoming', label: 'À venir' },
  { value: 'past', label: 'Passés' },
  { value: 'month', label: 'Ce mois' },
  { value: 'season', label: 'Saison' },
]
const WHO = [
  { value: 'mine' as const, label: 'Les miens' },
  { value: 'created' as const, label: 'Créés par moi', short: 'Créés' },
  { value: 'participant' as const, label: 'Où je participe', short: 'Participe' },
]
const NONE = new Set<string>()
/** Pastilles réglées dans la fenêtre « Filtres » ; celles rangées sous « + Ajouter une condition » (le déplier). */
const IN_WINDOW = new Set(['types', 'who', 'places', 'regions', 'depts', 'gens', 'sheet', 'video', 'rewatch', 'sort'])
const MORE_KEYS = new Set(['places', 'regions', 'depts', 'gens', 'sheet', 'video', 'rewatch'])
/** Période des boutons « Date » (à venir, passés, ce mois, saison en cours) ; '' sinon. */
const periodWhen = (p?: EventPeriod) =>
  p && p.kind !== 'year' && p.kind !== 'between' && !('ym' in p && p.ym) && !('start' in p && p.start !== undefined) ? p.kind : ''
/** Période réglable dans la fenêtre : boutons « Date », une année, entre deux dates (un mois ou une saison précis : non). */
const periodInWindow = (p?: EventPeriod) => !!p && (!!periodWhen(p) || p.kind === 'year' || p.kind === 'between')
const HINT = 'les tournois de cette saison », « à venir dans le Var », « combien par mois ?'

export function useEventsQuery(events: HBEvent[] | undefined, stats: Map<string, EventStats>) {
  useTeams()
  const regionName = useRegionName()
  const day = today()
  const videos = useLiveQuery(
    async () => new Set(alive(await db.videos.toArray()).filter((v) => v.targetKind === 'event').map((v) => v.targetId)),
    [],
    NONE,
  )
  const rewatch = useLiveQuery(
    async () => {
      const s = new Set<string>()
      for (const r of alive(await db.rewatch.toArray())) {
        if (r.originEventId) s.add(r.originEventId)
        for (const e of r.events ?? []) s.add(e)
      }
      return s
    },
    [],
    NONE,
  )
  // Lieu et génération des événements : d'après leurs joueurs (lus seulement au besoin).
  const [needInfo, setNeedInfo] = useState(false)
  const info = useLiveQuery(async () => {
    if (!needInfo || !events) return undefined
    const ids = [...new Set(events.flatMap((e) => [...(e.playerIds ?? []), ...(stats.get(e.id)?.players ?? [])]))]
    const players = new Map((await db.players.bulkGet(ids)).filter((p): p is Player => !!p && !p.deleted).map((p) => [p.id, p]))
    const m = new Map<string, { depts: string[]; years: number[] }>()
    for (const e of events) {
      const ps = [...new Set([...(e.playerIds ?? []), ...(stats.get(e.id)?.players ?? [])])]
        .map((id) => players.get(id))
        .filter((p): p is Player => !!p)
        .map((p) => ({ dept: department(p), year: p.birthDate ? Number(p.birthDate.slice(0, 4)) : undefined }))
      m.set(e.id, eventInfo(e.place, ps))
    }
    return m
  }, [needInfo, events, stats])

  const me = currentUserId() ?? undefined
  const ctx = useMemo<EventCtx | null>(
    () =>
      events && (!needInfo || info)
        ? {
            today: day,
            me,
            isParticipant: (ev) => isParticipant(ev),
            stats,
            videos,
            rewatch,
            info,
            deptName: (c) => departmentLabel(c),
            regionName: (id) => regionName(id),
            regionOf: (c) => regionOfDept(c),
          }
        : null,
    [events, needInfo, info, day, me, stats, videos, rewatch, regionName],
  )
  const geo = useVoicePlaces()
  const sums = useMemo(
    () => [
      { unit: (n: number) => (n > 1 ? 'joueurs' : 'joueur'), get: (e: HBEvent) => eventPlayerCount(e, { stats }) },
      { unit: () => 'avis', get: (e: HBEvent) => stats.get(e.id)?.avis ?? 0 },
    ],
    [stats],
  )
  const hays = useMemo(() => (events ?? []).map(eventsSpec.hay), [events])

  const lq = useListQuery<EventFilters, HBEvent, EventCtx>({
    spec: eventsSpec,
    items: events,
    ctx,
    read: (raw, nonGere) =>
      readEventsRecipe(raw, nonGere, {
        today: day,
        names: (events ?? []).map((e) => e.name),
        places: [...new Set((events ?? []).map((e) => e.place ?? '').filter(Boolean))],
        creators: [...new Set((events ?? []).map((e) => e.createdByName ?? '').filter(Boolean))],
        geo,
      }),
    schema: () => buildEventsSchema(day),
    hint: HINT,
    noun: ['événement', 'événements'],
    sums,
    regionOf: (d) => regionOfDept(d),
    hays,
    panel: (qy, setQy, focus) => (ctx && events ? <EventsPanel events={events} ctx={ctx} qy={qy} setQy={setQy} focus={focus} onNeedInfo={() => setNeedInfo(true)} /> : null),
    // Pastilles réglées dans la fenêtre ; période d'un mois ou d'une saison précise, nombres, créateur : petit réglage.
    inWindow: (k, qy) => IN_WINDOW.has(k) || (k === 'period' && periodInWindow(qy.f.period)),
    chipEditor: (key, qy, setQy) => (key === 'period' && qy.f.period ? <PeriodEditor value={qy.f.period} onChange={(period) => setQy({ ...qy, f: { ...qy.f, period } })} /> : null),
  })
  useEffect(() => {
    if (eventsNeedInfo(lq.qy)) setNeedInfo(true)
  }, [lq.qy])
  return { ...lq, loading: !ctx }
}

/**
 * Fenêtre « Filtres » : type, date, mes événements, puis « + Ajouter une condition », tri et calcul. Types, lieux, régions,
 * départements et générations : plusieurs choix possibles (l'un OU l'autre).
 */
function EventsPanel({
  events,
  ctx,
  qy,
  setQy,
  focus,
  onNeedInfo,
}: {
  events: HBEvent[]
  ctx: EventCtx
  qy: ListQuery<EventFilters>
  setQy: (q: ListQuery<EventFilters>) => void
  focus?: { key: string; n: number }
  onNeedInfo: () => void
}) {
  const [more, setMore] = useState(() => !!focus && MORE_KEYS.has(focus.key))
  // Ouverte (ou rouverte) depuis la pastille d'un filtre rangé sous « + Ajouter une condition » : déplié.
  useEffect(() => {
    if (focus && MORE_KEYS.has(focus.key)) setMore(true)
  }, [focus?.n]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (more) onNeedInfo()
  }, [more, onNeedInfo])
  const f = qy.f
  const setF = (patch: Partial<EventFilters>) => {
    const next = { ...f, ...patch } as Record<string, unknown>
    for (const k of Object.keys(patch)) if (next[k] === undefined) delete next[k]
    setQy({ ...qy, f: next as EventFilters })
  }
  const except = (k: string) => filterItems(eventsSpec, events, qy, ctx, k)
  const types = countBy(except('types'), (e) => [e.type])
  const periodBase = except('period')
  const whenCount = new Map(WHEN.map((w) => [w.value, periodBase.filter((e) => inPeriod(e, { kind: w.value } as EventPeriod, ctx.today)).length]))
  const years = countBy(periodBase, (e) => [e.date.slice(0, 4)])
  const who = new Map(WHO.map((w) => [w.value, except('who').filter((e) => eventsSpec.test('who', { who: w.value }, e, ctx)).length]))
  const when = periodWhen(f.period)
  const year = f.period?.kind === 'year' ? String(f.period.year) : ''
  const places = countBy(except('places'), (e) => [e.place?.trim()])
  const depts = countBy(except('depts'), (e) => ctx.info?.get(e.id)?.depts ?? [])
  const regions = countBy(except('regions'), (e) => (ctx.info?.get(e.id)?.depts ?? []).map((d) => ctx.regionOf(d)))
  const gens = countBy(except('gens'), (e) => (ctx.info?.get(e.id)?.years ?? []).map(String))
  const nYes = (k: 'sheet' | 'video' | 'rewatch') => except(k).filter((e) => eventsSpec.test(k, { [k]: true }, e, ctx)).length
  return (
    <>
      <ChoicePills
        k="types"
        label="Type"
        value={f.types ?? []}
        options={EVENT_TYPE_LIST.map((t) => ({ ...t, short: SHORT[t.value] }))}
        counts={types}
        total={except('types').length}
        onChange={(vs) => setF({ types: vs.length ? vs : undefined })}
      />
      <SegRow k="period" label="Date" value={when} options={WHEN} counts={whenCount} total={periodBase.length} onChange={(v) => setF({ period: v ? ({ kind: v } as EventPeriod) : undefined })} />
      <div className="grid grid-cols-2 gap-2">
        <select
          className={`field min-h-11 py-1.5 text-xs ${year ? 'border-accent font-bold' : ''}`}
          aria-label="Année"
          value={year}
          onChange={(e) => setF({ period: e.target.value ? { kind: 'year', year: Number(e.target.value) } : undefined })}
        >
          <option value="">Toutes les années ({periodBase.length})</option>
          {[...years.entries()]
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([y, n]) => (
              <option key={y} value={y}>
                {y} ({n})
              </option>
            ))}
        </select>
        <button
          type="button"
          className={`min-h-11 rounded-md border px-2 text-xs font-bold ${f.period?.kind === 'between' ? 'border-accent bg-accent/15' : 'border-line bg-panel-2 text-muted'}`}
          onClick={() => setF({ period: f.period?.kind === 'between' ? undefined : { kind: 'between', ...betweenDefault(ctx.today) } })}
        >
          Entre deux dates
        </button>
      </div>
      {f.period?.kind === 'between' && <PeriodEditor value={f.period} onChange={(period) => setF({ period })} />}
      <SegRow k="who" label="Mes événements" value={f.who ?? ''} options={WHO} counts={who} total={except('who').length} onChange={(v) => setF({ who: v || undefined })} />
      <div className="rounded-md border border-line">
        <button type="button" className="flex min-h-11 w-full items-center gap-2 px-2 text-left text-xs font-bold" aria-expanded={more} onClick={() => setMore(!more)}>
          <span className="flex-1">+ Ajouter une condition</span>
          <span className={`text-muted transition ${more ? 'rotate-90' : ''}`}>›</span>
        </button>
        {more && (
          <div className="flex flex-col gap-2 border-t border-line p-2">
            <div className="flex flex-wrap gap-1.5" data-filter="sheet video rewatch">
              <ToggleChip on={!!f.sheet} label="Avec feuille de match" n={nYes('sheet')} onChange={(on) => setF({ sheet: on || undefined })} />
              <ToggleChip on={!!f.video} label="Avec vidéo" n={nYes('video')} onChange={(on) => setF({ video: on || undefined })} />
              <ToggleChip on={!!f.rewatch} label="Avec joueurs à revoir" n={nYes('rewatch')} onChange={(on) => setF({ rewatch: on || undefined })} />
              <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => setF({ players: f.players ?? { op: 'gte', n: 10 } })}>
                Nombre de joueurs
              </button>
              <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => setF({ avis: f.avis ?? { op: 'gte', n: 1 } })}>
                Nombre d’avis
              </button>
            </div>
            {(places.size > 0 || f.places) && (
              <FilterField label="Lieu" k="places">
                <MultiPicker
                  className="min-h-11 py-1.5 text-xs"
                  label="Lieu"
                  allLabel="Tous les lieux"
                  noun={['lieu', 'lieux']}
                  value={f.places ?? []}
                  options={[...places.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([p, n]) => ({ value: p, count: n }))}
                  onChange={(xs) => setF({ places: xs.length ? xs : undefined })}
                />
              </FilterField>
            )}
            {!ctx.info ? (
              <p className="text-[11px] text-muted">Chargement des lieux et des générations…</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <FilterField label="Région" k="regions">
                  <MultiPicker
                    className="min-h-11 py-1.5 text-xs"
                    label="Région"
                    allLabel="Toutes"
                    noun={['région', 'régions']}
                    value={f.regions ?? []}
                    options={[...regions.entries()]
                      .filter(([r]) => ctx.regionName(r))
                      .map(([r, n]) => ({ value: r, label: ctx.regionName(r)!, count: n }))
                      .sort((a, b) => a.label.localeCompare(b.label, 'fr'))}
                    // Des régions cochées écartent les départements d'ailleurs.
                    onChange={(rs) =>
                      setF({ regions: rs.length ? rs : undefined, ...(rs.length && f.depts ? { depts: f.depts.filter((d) => rs.includes(ctx.regionOf(d) ?? '')).length ? f.depts.filter((d) => rs.includes(ctx.regionOf(d) ?? '')) : undefined } : {}) })
                    }
                  />
                </FilterField>
                <FilterField label="Département" k="depts">
                  <MultiPicker
                    className="min-h-11 py-1.5 text-xs"
                    label="Département"
                    allLabel="Tous"
                    noun={['département', 'départements']}
                    value={f.depts ?? []}
                    options={[...depts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, n]) => ({ value: d, label: ctx.deptName(d), count: n }))}
                    onChange={(ds) => setF({ depts: ds.length ? ds : undefined })}
                  />
                </FilterField>
                <FilterField label="Génération des joueurs" k="gens">
                  <YearPicker
                    className="min-h-11 py-1.5 text-xs"
                    label="Génération des joueurs"
                    allLabel="Toutes"
                    value={(f.gens ?? []).map(String).reverse()}
                    options={[...gens.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([y, n]) => ({ value: y, count: n }))}
                    onChange={(ys) => setF({ gens: ys.length ? uniqYears(ys) : undefined })}
                  />
                </FilterField>
              </div>
            )}
            <p className="text-[10px] text-muted">Lieu : d’après le lieu écrit, sinon le département de la plupart de ses joueurs. Génération : au moins un quart de ses joueurs.</p>
          </div>
        )}
      </div>
      <SortCalcPicker spec={eventsSpec} qy={qy} setQy={setQy} />
    </>
  )
}

const inPeriod = (e: { date: string }, p: EventPeriod, day: string) => {
  const r = periodRange(p, day)
  return (!r.from || e.date >= r.from) && (!r.to || e.date <= r.to)
}

function betweenDefault(day: string) {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCMonth(d.getUTCMonth() - 1)
  return { from: d.toISOString().slice(0, 10), to: day }
}

/** Réglage de la période (pastille « date ») : relative, une année, ou entre deux dates. */
function PeriodEditor({ value, onChange }: { value: EventPeriod; onChange: (p: EventPeriod) => void }) {
  const day = today()
  const between = value.kind === 'between' ? value : null
  return (
    <div className="flex flex-col gap-2">
      <select
        className="field min-h-11 py-1 text-sm"
        aria-label="Période"
        value={value.kind}
        onChange={(e) => {
          const k = e.target.value
          onChange(k === 'year' ? { kind: 'year', year: Number(day.slice(0, 4)) } : k === 'between' ? { kind: 'between', ...betweenDefault(day) } : ({ kind: k } as EventPeriod))
        }}
      >
        <option value="upcoming">À venir</option>
        <option value="past">Passés</option>
        <option value="month">Ce mois-ci</option>
        <option value="season">Cette saison</option>
        <option value="year">Une année</option>
        <option value="between">Entre deux dates</option>
      </select>
      {value.kind === 'year' && (
        <input
          className="field min-h-11 w-28 py-1 text-sm"
          type="number"
          inputMode="numeric"
          aria-label="Année"
          value={value.year}
          onChange={(e) => Number(e.target.value) > 1990 && Number(e.target.value) < 2100 && onChange({ kind: 'year', year: Number(e.target.value) })}
        />
      )}
      {between && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          du
          <input className="field min-h-11 py-1 text-sm" type="date" aria-label="Du" value={between.from} onChange={(e) => e.target.value && onChange({ ...between, from: e.target.value })} />
          au
          <input className="field min-h-11 py-1 text-sm" type="date" aria-label="Au" value={between.to} onChange={(e) => e.target.value && onChange({ ...between, to: e.target.value })} />
        </div>
      )}
    </div>
  )
}
