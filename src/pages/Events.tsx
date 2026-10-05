import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Avatar, Empty, PosBadges, QuarterBadge } from '../components/ui'
import { alive, counts, db, fmtDate, POSITIONS, remove, save, type Evaluation, type HBEvent, type Player, type Position } from '../db'
import { EVENT_TYPES, NewEventForm } from './Evaluate'
import { ask, inform } from '../components/Confirm'
import { can, currentUserId, useRole } from '../roles'
import { arrowNav, department, fold, usePlayerFilter, useSessionState } from '../components/PlayerFilter'
import { AvisCard, DIVERGENCE } from '../components/Opinions'
import { StampLine } from '../components/ActivityLog'

const typeLabel = (t: string) => EVENT_TYPES.find((x) => x.value === t)?.label ?? t

export default function Events() {
  const role = useRole()
  const events = useLiveQuery(() => db.events.orderBy('date').reverse().toArray().then(alive))
  const evals = useLiveQuery(() => db.evaluations.toArray().then(alive), [], [])
  // Depuis un groupe : « Créer un événement » ouvre le formulaire avec ses joueurs.
  const [params, setParams] = useSearchParams()
  const fromGroup = params.get('groupe') ?? undefined
  const [creating, setCreating] = useState(!!fromGroup)
  const nav = useNavigate()
  const [showAll, setShowAll] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  // Recherche et filtres (gardés pendant la session), sur le modèle des joueurs et des groupes.
  const [q, setQ] = useSessionState('handbase.evenements.q', '')
  const [type, setType] = useSessionState('handbase.evenements.type', '')
  const [year, setYear] = useSessionState('handbase.evenements.year', '')
  const [mine, setMine] = useSessionState('handbase.evenements.mine', false)
  const [open, setOpen] = useSessionState('handbase.evenements.open', false)

  if (!events) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  // À venir (aujourd'hui compris) du plus proche au plus lointain ; passés du plus récent au plus ancien.
  const todayIso = new Date().toLocaleDateString('sv')
  const upcoming = events.filter((e) => !e.archived && e.date >= todayIso).reverse()
  const past = events.filter((e) => !e.archived && e.date < todayIso)
  const archived = events.filter((e) => e.archived)

  // Recherche : nom, lieu, créateur. Dès qu'on cherche ou filtre, une seule liste, archivés compris.
  const words = fold(q).split(/\s+/).filter(Boolean)
  const ok = {
    q: (e: HBEvent) => words.every((w) => fold(`${e.name} ${e.place ?? ''} ${e.createdByName ?? ''}`).includes(w)),
    type: (e: HBEvent) => !type || e.type === type,
    year: (e: HBEvent) => !year || e.date.startsWith(year),
    mine: (e: HBEvent) => !mine || (!!e.createdBy && e.createdBy === currentUserId()),
  }
  const except = (k: keyof typeof ok) => events.filter((e) => (Object.keys(ok) as (keyof typeof ok)[]).every((x) => x === k || ok[x](e)))
  const searching = !!(q || type || year || mine)
  const results = searching ? except('q').filter(ok.q) : []
  const years = [...new Set(events.map((e) => e.date.slice(0, 4)))].sort().reverse()
  const yearCount = (y: string) => except('year').filter((e) => e.date.startsWith(y)).length
  const typeCount = (t: string) => except('type').filter((e) => e.type === t).length
  const chips = [
    type && { label: typeLabel(type), clear: () => setType('') },
    year && { label: year, clear: () => setYear('') },
    mine && { label: 'Mes événements', clear: () => setMine(false) },
  ].filter((c): c is { label: string; clear: () => void } => !!c)
  const resetSearch = () => (setQ(''), setType(''), setYear(''), setMine(false))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">Événements</h1>
        {!creating && can.manageEvents(role) && (
          <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setCreating(true)}>
            + Événement
          </button>
        )}
      </div>
      {creating && (
        <div className="card p-3">
          <NewEventForm
            groupId={fromGroup}
            onDone={(ev) => {
              setCreating(false)
              if (fromGroup) setParams({}, { replace: true })
              if (ev) nav(`/evenements/${ev.id}`)
            }}
          />
        </div>
      )}
      {events.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input className="field min-w-0 flex-1" placeholder="Rechercher…" title="Nom, lieu ou créateur" value={q} onChange={(e) => setQ(e.target.value)} />
            <button
              onClick={() => setOpen(!open)}
              className={`shrink-0 rounded-md border px-3 text-xs font-bold ${open || chips.length ? 'border-accent text-white' : 'border-line text-muted'} ${open ? 'bg-accent/15' : 'bg-panel-2'}`}
            >
              Filtres{chips.length > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] text-white">{chips.length}</span>} {open ? '▴' : '▾'}
            </button>
          </div>
          {open && (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-2.5">
              <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
                {[{ value: '', label: 'Tous' }, ...EVENT_TYPES].map((t) => (
                  <button key={t.value} onClick={() => setType(t.value)} className={`flex-1 py-1.5 ${type === t.value ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
                    {t.value === 'entrainement' ? 'Entraîn.' : t.value === 'observation' ? 'Observ.' : t.label}
                    {t.value && <span className="ml-1 text-[10px] opacity-70">{typeCount(t.value)}</span>}
                  </button>
                ))}
              </div>
              <select className={`field py-1.5 text-xs ${year ? 'border-accent font-bold' : ''}`} value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="">Toutes les années ({except('year').length})</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y} ({yearCount(y)})
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
                Seulement les événements que j’ai créés
              </label>
            </div>
          )}
          {searching && (
            <div className="flex flex-wrap items-center gap-1.5">
              {!open &&
                chips.map((c) => (
                  <button key={c.label} onClick={c.clear} className="rounded-full border border-accent/60 bg-accent/10 px-2 py-0.5 text-[11px] font-bold">
                    {c.label} <span className="text-muted">✕</span>
                  </button>
                ))}
              <button className="text-[11px] font-bold text-muted underline" onClick={resetSearch}>
                Tout effacer
              </button>
            </div>
          )}
        </div>
      )}
      {searching ? (
        <>
          <div className="section-title mt-1 mb-0">
            {results.length} résultat{results.length > 1 ? 's' : ''} <span className="text-muted normal-case">(archivés compris)</span>
          </div>
          {results.map((ev) => (
            <EventRow key={ev.id} ev={ev} evals={evals} upcoming={!ev.archived && ev.date >= todayIso} />
          ))}
          {!results.length && <Empty>Aucun événement ne correspond.</Empty>}
        </>
      ) : events.length === 0 ? (
        <Empty>{can.manageEvents(role) ? 'Crée un match, un tournoi ou une journée de sélection pour que plusieurs évaluateurs puissent y noter les joueurs.' : 'Aucun événement pour l’instant.'}</Empty>
      ) : (
        <>
          <div className="section-title mt-1 mb-0">À venir</div>
          {upcoming.length ? (
            upcoming.map((ev) => <EventRow key={ev.id} ev={ev} evals={evals} upcoming />)
          ) : (
            <p className="text-[11px] text-muted">Aucun événement prévu.</p>
          )}
          {past.length > 0 && (
            <>
              <div className="section-title mt-3 mb-0">Passés</div>
              {past.slice(0, showAll ? undefined : 10).map((ev) => (
                <EventRow key={ev.id} ev={ev} evals={evals} />
              ))}
              {past.length > 10 && !showAll && (
                <button className="btn-ghost text-xs" onClick={() => setShowAll(true)}>
                  Afficher les {past.length - 10} plus anciens
                </button>
              )}
            </>
          )}
          {archived.length > 0 && (
            <>
              <button className="section-title mt-3 mb-0 flex items-center gap-1.5 text-left text-muted" onClick={() => setShowArchived(!showArchived)}>
                Archivés ({archived.length}) <span>{showArchived ? '▴' : '▾'}</span>
              </button>
              {showArchived && archived.map((ev) => <EventRow key={ev.id} ev={ev} evals={evals} />)}
            </>
          )}
        </>
      )}
    </div>
  )
}

/** Dans combien de jours : « aujourd'hui », « demain », « dans 5 jours ». */
function inDays(date: string) {
  const n = Math.round((new Date(date + 'T00:00:00').getTime() - new Date(new Date().toDateString()).getTime()) / 86400000)
  return n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : `dans ${n} jours`
}

function EventRow({ ev, evals, upcoming = false }: { ev: HBEvent; evals: Evaluation[]; upcoming?: boolean }) {
  const es = evals.filter((e) => e.eventId === ev.id)
  const d = new Date(ev.date + 'T00:00:00')
  const today = upcoming && inDays(ev.date) === 'aujourd’hui'
  return (
    <Link to={`/evenements/${ev.id}`} className={`card flex items-center gap-3 p-3 hover:border-accent ${today ? 'border-accent/70' : ''}`}>
      <div className={`w-11 shrink-0 rounded-md py-1 text-center leading-tight ${upcoming ? 'bg-accent/15' : 'bg-panel-2'}`}>
        <div className="text-[9px] font-bold text-muted uppercase">{d.toLocaleDateString('fr-FR', { weekday: 'short' })}</div>
        <div className={`text-base font-extrabold ${upcoming ? 'text-accent' : ''}`}>{d.getDate()}</div>
        <div className="text-[9px] text-muted">{d.toLocaleDateString('fr-FR', { month: 'short', ...(d.getFullYear() !== new Date().getFullYear() && { year: '2-digit' }) })}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-bold">
          {ev.name}
          {ev.archived && <span className="ml-1.5 rounded bg-panel-2 px-1 py-px align-middle text-[9px] text-muted">ARCHIVÉ</span>}
        </div>
        <div className="truncate text-[11px] text-muted">
          {typeLabel(ev.type)}
          {ev.place ? ` · ${ev.place}` : ''}
        </div>
        {upcoming && <div className="text-[11px] font-bold text-accent">{inDays(ev.date)}</div>}
      </div>
      <div className="shrink-0 text-right text-[11px] text-muted">
        {/* Avant l'événement : les convoqués ; dès qu'il y a des avis : joueurs notés et nombre d'avis. */}
        {es.length > 0 ? (
          <>
            <div>
              <b className="text-white">{new Set(es.map((e) => e.playerId)).size}</b> joueurs
            </div>
            <div>
              <b className="text-white">{es.length}</b> avis
            </div>
          </>
        ) : (
          (ev.playerIds ?? []).length > 0 && (
            <div>
              <b className="text-white">{(ev.playerIds ?? []).length}</b> convoqué{(ev.playerIds ?? []).length > 1 ? 's' : ''}
            </div>
          )
        )}
      </div>
    </Link>
  )
}

export function EventDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const role = useRole()
  const [tab, setTab] = useState<'joueurs' | 'classement'>('joueurs')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const data = useLiveQuery(async () => {
    const ev = await db.events.get(id!)
    const evals = alive(await db.evaluations.where('eventId').equals(id!).toArray())
    const ids = [...new Set([...(ev?.playerIds ?? []), ...evals.map((e) => e.playerId)])]
    const players = alive((await db.players.bulkGet(ids)).filter((p): p is Player => !!p))
    return { ev, evals, players }
  }, [id])

  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const { ev, evals, players } = data
  if (!ev || ev.deleted) return <div className="py-20 text-center text-sm text-muted">Événement introuvable.</div>

  const byId = new Map(players.map((p) => [p.id, p]))
  const roster = (ev.playerIds ?? []).map((pid) => byId.get(pid)).filter((p): p is Player => !!p)
  // Joueurs notés sur l'événement sans être dans la liste (ex. avis d'un observateur).
  const inRoster = new Set(ev.playerIds ?? [])
  const offList = players.filter((p) => !inRoster.has(p.id) && evals.some((e) => e.playerId === p.id))
  const observers = [...new Set(evals.map((e) => e.observer))].sort()
  const manage = can.editEvent(role, ev)

  async function setRoster(ids: string[]) {
    await save<HBEvent>('events', { ...ev!, playerIds: ids })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button onClick={() => nav('/evenements')} className="text-xs font-bold text-muted">
          ← ÉVÉNEMENTS
        </button>
        {manage && (
          <div className="flex gap-4">
            {!editing && (
              <button className="text-xs text-muted hover:text-white" onClick={() => setEditing(true)}>
                Modifier
              </button>
            )}
            {/* Archiver : retiré des listes (Évaluer, événements), avis conservés. */}
            <button
              className="text-xs text-muted hover:text-white"
              onClick={async () => {
                if (!ev.archived && !(await ask(`Archiver « ${ev.name} » ? Il n’apparaîtra plus dans Évaluer ni dans la liste ; ses avis sont gardés et comptent toujours.`, { ok: 'Archiver' })))
                  return
                await save<HBEvent>('events', { ...ev, archived: !ev.archived })
              }}
            >
              {ev.archived ? 'Désarchiver' : 'Archiver'}
            </button>
            <button
              className="text-xs text-muted hover:text-red-400"
              onClick={async () => {
                const n = evals.length
                // Chaque avis appartient à un événement : supprimer l'événement supprime ses avis.
                // Les avis des autres évaluateurs ne peuvent être supprimés que par un administrateur.
                if (n && role !== 'admin') {
                  await inform(`« ${ev.name} » contient ${n} avis : seul un administrateur peut le supprimer.`)
                  return
                }
                const msg = n ? `Supprimer « ${ev.name} » et ses ${n} avis ?` : `Supprimer « ${ev.name} » ?`
                if (!(await ask(msg, { ok: 'Supprimer' }))) return
                for (const e of evals) await remove('evaluations', e.id)
                await remove('events', ev.id)
                nav('/evenements', { replace: true })
              }}
            >
              Supprimer
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="card p-3">
          <NewEventForm event={ev} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <div>
          {ev.archived && <div className="mb-1 w-fit rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-bold text-muted">ARCHIVÉ</div>}
          <h1 className="text-lg font-extrabold">{ev.name}</h1>
          <div className="text-xs text-muted">
            {typeLabel(ev.type)} · {fmtDate(ev.date)}
            {ev.place ? ` · ${ev.place}` : ''}
          </div>
          {observers.length > 0 && <div className="mt-1 text-[11px] text-muted">Évaluateurs : {observers.join(', ')}</div>}
          <StampLine row={ev} />
        </div>
      )}

      <Link to={`/evaluer?evenement=${ev.id}${roster[0] ? `&joueur=${roster[0].id}` : ''}`} className="btn-primary">
        Évaluer {roster.length ? `les ${roster.length} joueurs` : 'des joueurs'}
      </Link>

      <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
        {(
          [
            ['joueurs', `Joueurs (${roster.length})`],
            ['classement', 'Classement'],
          ] as const
        ).map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`flex-1 py-2 ${tab === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'joueurs' ? (
        adding ? (
          <AddPlayers current={ev.playerIds ?? []} onCancel={() => setAdding(false)} onAdd={async (ids) => (await setRoster([...(ev.playerIds ?? []), ...ids]), setAdding(false))} />
        ) : (
          <div className="flex flex-col gap-2">
            {manage && (
              <button className="btn-ghost text-xs" onClick={() => setAdding(true)}>
                + Ajouter des joueurs (par groupe ou un par un)
              </button>
            )}
            {offList.length > 0 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="text-xs font-bold text-amber-200">Notés hors liste ({offList.length})</div>
                <p className="mt-0.5 text-[11px] text-muted">
                  Joueurs repérés sur place. Un avis validé compte dans les moyennes et ajoute le joueur à la liste ; hors cadre, il est gardé sans compter.
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  {offList.flatMap((p) =>
                    evals
                      .filter((e) => e.playerId === p.id)
                      .map((e) => <AvisCard key={e.id} e={e} where={ev.name} role={role} player={p} dept={department(p)} event={ev} />),
                  )}
                </div>
              </div>
            )}
            {roster.length === 0 ? (
              offList.length ? null : <Empty>Aucun joueur dans la liste. {manage ? 'Ajoute un groupe (club + année…) ou des joueurs un par un.' : ''}</Empty>
            ) : (
              <>
                {manage && roster.length > 1 && (
                  <button
                    className="self-end text-[11px] font-bold text-muted underline"
                    onClick={async () => (await ask(`Retirer les ${roster.length} joueurs de la liste ? Les avis déjà donnés sont conservés.`, { ok: 'Vider la liste' })) && void setRoster([])}
                  >
                    Vider la liste
                  </button>
                )}
                {roster.map((p, i) => {
                  const n = evals.filter((e) => e.playerId === p.id).length
                  return (
                    <div key={p.id} className="card flex items-center gap-3 p-2.5">
                      <span className="w-6 text-center text-[11px] text-muted">{i + 1}</span>
                      <Link to={`/evaluer?evenement=${ev.id}&joueur=${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar p={p} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 truncate text-sm font-bold">
                            {p.lastName.toUpperCase()} {p.firstName} <PosBadges p={p} /> <QuarterBadge birthDate={p.birthDate} />
                          </div>
                          <div className="truncate text-[10px] text-muted">
                            {[p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </Link>
                      <span className={`shrink-0 text-[10px] font-bold ${n ? 'text-emerald-300' : 'text-muted'}`}>{n ? `${n} avis` : '—'}</span>
                      {manage && (
                        <button
                          className="shrink-0 px-1 text-muted hover:text-red-400"
                          title="Retirer de la liste"
                          onClick={() => void setRoster((ev.playerIds ?? []).filter((x) => x !== p.id))}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )
      ) : (
        <Ranking players={players} evals={evals.filter(counts)} rosterIds={new Set(ev.playerIds ?? [])} eventName={ev.name} />
      )}
    </div>
  )
}

/** Ajout de joueurs : filtres (sexe, club, année, poste, nom), « tout sélectionner » ou un par un. */
/** Ajout de joueurs à une liste (événement, groupe) : par groupe de filtres ou un par un. */
export function AddPlayers({
  current,
  onAdd,
  onCancel,
  scope = 'ajout-evenement',
}: {
  current: string[]
  onAdd: (ids: string[]) => void
  onCancel: () => void
  scope?: string
}) {
  const all = useLiveQuery(() => db.players.orderBy('lastName').toArray().then(alive))
  const { filtered, ui } = usePlayerFilter(all, scope)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(60)
  const inList = new Set(current)
  const available = filtered.filter((p) => !inList.has(p.id))
  const allPicked = available.length > 0 && available.every((p) => picked.has(p.id))

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function pickAll() {
    if (allPicked) {
      setPicked((s) => new Set([...s].filter((id) => !available.some((p) => p.id === id))))
      return
    }
    if (available.length > 300 && !(await ask(`Sélectionner ${available.length.toLocaleString('fr-FR')} joueurs ? Affine les filtres pour un groupe plus précis.`, { ok: 'Tout sélectionner', danger: false }))) return
    setPicked((s) => new Set([...s, ...available.map((p) => p.id)]))
  }

  if (!all) return <div className="py-10 text-center text-sm text-muted">Chargement…</div>
  return (
    <div className="flex flex-col gap-3" onKeyDown={(e) => arrowNav(e, 'button[data-player]')}>
      <div className="card flex flex-col gap-2 p-3">
        <div className="text-xs font-extrabold">Ajouter des joueurs</div>
        {ui}
      </div>

      <div className="sticky top-14 z-10 flex items-center justify-between gap-2 rounded-lg border border-line bg-bg/95 p-2 backdrop-blur">
        <button className="btn-ghost px-3 py-1.5 text-xs" disabled={!available.length} onClick={() => void pickAll()}>
          {allPicked ? 'Tout désélectionner' : `Tout sélectionner (${available.length.toLocaleString('fr-FR')})`}
        </button>
        <div className="flex gap-2">
          <button className="btn px-3 py-1.5 text-xs text-muted" onClick={onCancel}>
            Annuler
          </button>
          <button className="btn-primary px-3 py-1.5 text-xs" disabled={!picked.size} onClick={() => onAdd([...picked])}>
            Ajouter {picked.size || ''}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {filtered.slice(0, limit).map((p) => {
          const already = inList.has(p.id)
          const on = already || picked.has(p.id)
          return (
            <button
              key={p.id}
              data-player
              disabled={already}
              onClick={() => toggle(p.id)}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-xs outline-none focus:ring-2 focus:ring-accent ${on ? 'border-accent bg-accent-soft' : 'border-line bg-panel'} ${already ? 'opacity-50' : ''}`}
            >
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line'}`}>
                {on ? '✓' : ''}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <b>
                  {p.lastName.toUpperCase()} {p.firstName}
                </b>
                <span className="text-muted"> · {[p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}</span> <QuarterBadge birthDate={p.birthDate} />
              </span>
              {already && <span className="shrink-0 text-[10px] text-muted">déjà dans la liste</span>}
            </button>
          )
        })}
        {filtered.length > limit && (
          <button className="btn-ghost text-xs" onClick={() => setLimit((l) => l + 60)}>
            Afficher plus ({(filtered.length - limit).toLocaleString('fr-FR')} restants)
          </button>
        )}
        {!filtered.length && <Empty>Aucun joueur ne correspond aux filtres.</Empty>}
      </div>
    </div>
  )
}

/** Note d'un joueur sur l'événement : moyenne des évaluateurs (note globale, sinon moyenne de ses critères). */
function playerScore(evs: Evaluation[]) {
  const perObserver = new Map<string, number[]>()
  for (const e of evs) {
    const crit = Object.values(e.scores).filter((v) => typeof v === 'number')
    const v = typeof e.overall === 'number' ? e.overall : crit.length ? crit.reduce((a, b) => a + b, 0) / crit.length : null
    if (v === null) continue
    if (!perObserver.has(e.observer)) perObserver.set(e.observer, [])
    perObserver.get(e.observer)!.push(v)
  }
  const vals = [...perObserver.values()].map((xs) => xs.reduce((a, b) => a + b, 0) / xs.length)
  if (!vals.length) return null
  return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, observers: vals.length, spread: Math.max(...vals) - Math.min(...vals) }
}

/** Synthèse de fin de journée : classement par poste. */
function Ranking({ players, evals, rosterIds, eventName }: { players: Player[]; evals: Evaluation[]; rosterIds: Set<string>; eventName: string }) {
  const rows = players
    .map((p) => ({ p, s: playerScore(evals.filter((e) => e.playerId === p.id)) }))
    .sort((a, b) => (b.s?.avg ?? -1) - (a.s?.avg ?? -1))
  const groups = [...POSITIONS.map((x) => ({ id: x.id as string, label: x.label })), { id: 'none', label: 'Poste non renseigné' }]
    .map((g) => ({
      ...g,
      rows: rows.filter((r) => (r.p.position ?? 'none') === g.id),
      // Joueurs qui ont ce poste en secondaire : affichés en grisé, hors classement.
      extra: rows.filter((r) => r.p.position !== g.id && r.p.secondaryPositions?.includes(g.id as Position)),
    }))
    .filter((g) => g.rows.length || g.extra.length)
  const f1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

  function exportRanking() {
    const lines = [['Poste', 'Rang', 'Nom', 'Prénom', 'Année', 'Club', 'Licence', 'Note moyenne', 'Évaluateurs', 'Écart entre évaluateurs', 'Dans la liste', 'Postes secondaires']]
    for (const g of groups)
      g.rows.forEach((r, i) =>
        lines.push([
          g.label,
          String(r.s ? i + 1 : ''),
          r.p.lastName,
          r.p.firstName,
          r.p.birthDate?.slice(0, 4) ?? '',
          r.p.club ?? '',
          r.p.license ?? '',
          r.s ? f1(r.s.avg) : '',
          r.s ? String(r.s.observers) : '0',
          r.s && r.s.observers > 1 ? f1(r.s.spread) : '',
          rosterIds.has(r.p.id) ? 'oui' : 'non',
          (r.p.secondaryPositions ?? []).map((x) => POSITIONS.find((q) => q.id === x)?.short ?? x).join(', '),
        ]),
      )
    const csv = '﻿' + lines.map((l) => l.map((v) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `classement-${eventName.replace(/[^\p{L}\d]+/gu, '-').toLowerCase()}.csv`
    a.click()
  }

  if (!evals.length) return <Empty>Le classement apparaîtra dès les premiers avis.</Empty>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted">Note = moyenne des évaluateurs (note globale, sinon moyenne de leurs critères). ⚠ = avis très partagés.</p>
        <button className="btn-ghost shrink-0 px-3 py-1 text-xs" onClick={exportRanking}>
          Exporter
        </button>
      </div>
      {groups.map((g) => (
        <div key={g.id} className="card p-3">
          <div className="section-title">
            {g.label} ({g.rows.length}
            {g.extra.length ? ` + ${g.extra.length} en secondaire` : ''})
          </div>
          <div className="divide-y divide-line">
            {g.rows.map((r, i) => (
              <RankRow key={r.p.id} r={r} rank={r.s ? String(i + 1) : '–'} f1={f1} />
            ))}
            {g.extra.map((r) => (
              <RankRow key={r.p.id} r={r} rank="" f1={f1} secondary />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Ligne du classement ; en grisé pour un joueur affiché à son poste secondaire (hors classement). */
function RankRow({
  r,
  rank,
  f1,
  secondary,
}: {
  r: { p: Player; s: ReturnType<typeof playerScore> }
  rank: string
  f1: (n: number) => string
  secondary?: boolean
}) {
  return (
    <Link to={`/joueurs/${r.p.id}`} className={`flex items-center gap-3 py-1.5 text-xs ${secondary ? 'opacity-45' : ''}`} title={secondary ? 'Poste secondaire' : undefined}>
      <span className="w-5 text-center font-extrabold text-muted">{secondary ? '○' : rank}</span>
      <span className="min-w-0 flex-1 truncate">
        <b>
          {r.p.lastName.toUpperCase()} {r.p.firstName}
        </b>
        <span className="text-muted"> · {[r.p.birthDate?.slice(0, 4), r.p.club].filter(Boolean).join(' · ')}</span> <QuarterBadge birthDate={r.p.birthDate} />
        {secondary && <span className="text-[10px] text-muted"> · poste principal : {POSITIONS.find((q) => q.id === r.p.position)?.short ?? '—'}</span>}
      </span>
      {r.s && r.s.observers > 1 && r.s.spread >= DIVERGENCE && <span className="text-amber-300">⚠</span>}
      <span className="w-16 shrink-0 text-right text-[10px] text-muted">{r.s ? `${r.s.observers} éval.` : 'pas noté'}</span>
      <span className={`w-9 shrink-0 text-right text-sm font-extrabold ${secondary ? 'text-muted' : 'text-accent'}`}>{r.s ? f1(r.s.avg) : ''}</span>
    </Link>
  )
}
