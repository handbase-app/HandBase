import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar, Empty, PosBadge } from '../components/ui'
import { alive, db, fmtDate, POSITIONS, remove, save, type Evaluation, type HBEvent, type Player } from '../db'
import { EVENT_TYPES, NewEventForm } from './Evaluate'
import { ask, inform } from '../components/Confirm'
import { can, useRole } from '../roles'
import { arrowNav, usePlayerFilter } from '../components/PlayerFilter'
import { DIVERGENCE } from '../components/Opinions'
import { StampLine } from '../components/ActivityLog'

const typeLabel = (t: string) => EVENT_TYPES.find((x) => x.value === t)?.label ?? t

export default function Events() {
  const role = useRole()
  const events = useLiveQuery(() => db.events.orderBy('date').reverse().toArray().then(alive))
  const evals = useLiveQuery(() => db.evaluations.toArray().then(alive), [], [])
  const [creating, setCreating] = useState(false)
  const nav = useNavigate()

  if (!events) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

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
          <NewEventForm onDone={(ev) => (setCreating(false), ev && nav(`/evenements/${ev.id}`))} />
        </div>
      )}
      {events.length === 0 ? (
        <Empty>{can.manageEvents(role) ? 'Crée un match, un tournoi ou une journée de sélection pour que plusieurs évaluateurs puissent y noter les joueurs.' : 'Aucun événement pour l’instant.'}</Empty>
      ) : (
        events.map((ev) => {
          const es = evals.filter((e) => e.eventId === ev.id)
          return (
            <Link key={ev.id} to={`/evenements/${ev.id}`} className="card flex items-center justify-between p-3 hover:border-accent">
              <div>
                <div className="text-sm font-bold">{ev.name}</div>
                <div className="text-[11px] text-muted">
                  {typeLabel(ev.type)} · {fmtDate(ev.date)}
                  {ev.place ? ` · ${ev.place}` : ''}
                </div>
              </div>
              <div className="text-right text-[11px] text-muted">
                <div>
                  <b className="text-white">{new Set(es.map((e) => e.playerId)).size}</b> joueurs
                </div>
                <div>
                  <b className="text-white">{new Set(es.map((e) => e.observer)).size}</b> observateurs
                </div>
              </div>
            </Link>
          )
        })
      )}
    </div>
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
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-amber-200">Notés hors liste ({offList.length})</div>
                  {manage && (
                    <button className="btn-primary px-3 py-1 text-xs" onClick={() => void setRoster([...(ev.playerIds ?? []), ...offList.map((p) => p.id)])}>
                      Les ajouter à la liste
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  {offList.map((p) => (
                    <Link key={p.id} to={`/joueurs/${p.id}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">
                        <b>
                          {p.firstName} {p.lastName}
                        </b>
                        <span className="text-muted"> · {[p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="shrink-0 text-[10px] text-emerald-300">{evals.filter((e) => e.playerId === p.id).length} avis</span>
                    </Link>
                  ))}
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
                            {p.firstName} {p.lastName} <PosBadge pos={p.position} />
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
        <Ranking players={players} evals={evals} rosterIds={new Set(ev.playerIds ?? [])} eventName={ev.name} />
      )}
    </div>
  )
}

/** Ajout de joueurs : filtres (sexe, club, année, poste, nom), « tout sélectionner » ou un par un. */
function AddPlayers({ current, onAdd, onCancel }: { current: string[]; onAdd: (ids: string[]) => void; onCancel: () => void }) {
  const all = useLiveQuery(() => db.players.orderBy('lastName').toArray().then(alive))
  const { filtered, ui } = usePlayerFilter(all, 'ajout-evenement')
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
                <span className="text-muted"> · {[p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}</span>
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
    .map((g) => ({ ...g, rows: rows.filter((r) => (r.p.position ?? 'none') === g.id) }))
    .filter((g) => g.rows.length)
  const f1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

  function exportRanking() {
    const lines = [['Poste', 'Rang', 'Nom', 'Prénom', 'Année', 'Club', 'Licence', 'Note moyenne', 'Évaluateurs', 'Écart entre évaluateurs', 'Dans la liste']]
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
            {g.label} ({g.rows.length})
          </div>
          <div className="divide-y divide-line">
            {g.rows.map((r, i) => (
              <Link key={r.p.id} to={`/joueurs/${r.p.id}`} className="flex items-center gap-3 py-1.5 text-xs">
                <span className="w-5 text-center font-extrabold text-muted">{r.s ? i + 1 : '–'}</span>
                <span className="min-w-0 flex-1 truncate">
                  <b>
                    {r.p.firstName} {r.p.lastName}
                  </b>
                  <span className="text-muted"> · {[r.p.birthDate?.slice(0, 4), r.p.club].filter(Boolean).join(' · ')}</span>
                </span>
                {r.s && r.s.observers > 1 && r.s.spread >= DIVERGENCE && <span className="text-amber-300">⚠</span>}
                <span className="w-16 shrink-0 text-right text-[10px] text-muted">{r.s ? `${r.s.observers} éval.` : 'pas noté'}</span>
                <span className="w-9 shrink-0 text-right text-sm font-extrabold text-accent">{r.s ? f1(r.s.avg) : ''}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
