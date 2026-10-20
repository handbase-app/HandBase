import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { alive, dayOf, db, fmtDate, newId, plural, remove, save, type HBEvent, type Player, type PlayerGroup, type Rewatch, type Team } from '../db'
import { can, currentUserId, useRole } from '../roles'
import { loadTeams } from '../teams'
import {
  byNumber,
  eventPeople,
  isMyRewatch,
  isRevisited,
  myOpenRewatch,
  myTournamentTeams,
  newTeamId,
  numOf,
  personName,
  revisitedAt,
  revisitedKeys,
  saveRewatch,
  saveTournament,
  scoutId,
  setRevisited,
  setSeen,
  sheetPlayersWithoutTeam,
  sightingNames,
  stamp,
  teamObservers,
  teamOf,
  teamsFromSheet,
  tournamentTeams,
  type Sighting,
} from '../scouting'
import { addToGroup } from './Groups'
import { inform } from './Confirm'
import { getMe, GroupMark, Icon } from './ui'
import { DictationTextarea } from './MicButton'
import { accord, pluralG, w, type Gender } from '../gender'

/*
 * Repérage en tournoi (supabase/041_reperage_tournoi.sql) : bouton « vu », couverture de l'équipe d'observateurs,
 * « À revoir… », répartition des équipes d'un tournoi, historique sur la fiche joueur.
 * Uniquement des marques positives ou neutres : rien ici ne dit « vu, pas retenu ».
 */

/** Arrête le clic (bouton posé dans un lien de ligne : ne pas ouvrir la fiche). */
const stop = (e: { preventDefault(): void; stopPropagation(): void }) => {
  e.preventDefault()
  e.stopPropagation()
}

// ---------- « Vu » ----------

/**
 * Œil d'une ligne de joueur, à un toucher, même allure que l'étoile « Suivre » (icône 16 px, zone de toucher 32 px) :
 * plein = mon « vu » ; contour coloré = vu par d'autres observateurs de l'équipe (les noms au survol et dans « vu par… ») ;
 * gris = pas encore vu. Noté par moi : vu d'office (l'avis compte), l'œil reste plein.
 */
export function SeenEye({ eventId, playerId, list = [], sex }: { eventId: string; playerId: string; list?: Sighting[]; sex?: string }) {
  if (!scoutId()) return null
  const g = w(sex)
  const mine = list.find((s) => s.mine)
  const n = list.length
  const toggle = async (e: { preventDefault(): void; stopPropagation(): void }) => {
    stop(e)
    if (mine?.noted && !mine.marked) return void inform(`Tu l’as ${g.note} sur cet événement : ${g.il} compte comme ${g.vu} par toi.`)
    await setSeen(eventId, playerId, !mine?.marked)
  }
  const label = mine ? (mine.noted ? `${accord('Noté', sex)} par toi : ${g.vu}` : `${accord('Vu', sex)} par toi — toucher pour retirer`) : `Marquer ${g.vu}`
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={!!mine}
      title={`${label}${n ? ` · ${g.vu} par ${sightingNames(list)}` : ''}`}
      aria-label={label}
      className="-my-2 inline-flex h-8 w-7 shrink-0 items-center justify-center"
    >
      <Icon name="eye" filled={!!mine} className={`h-4 w-4 ${mine ? 'text-accent' : n ? 'text-accent/70' : 'text-muted/60 hover:text-accent'}`} />
    </button>
  )
}

/** « vu par 3 observateurs » sur la ligne ; les noms au toucher (dans un lien : n'ouvre pas la fiche). */
export function SeenBy({ list, sex }: { list: Sighting[]; sex?: string }) {
  const [open, setOpen] = useState(false)
  if (!list.length) return null
  const n = list.length
  return (
    <span
      role="button"
      tabIndex={0}
      aria-expanded={open}
      className="min-w-0 truncate text-[10px] text-accent"
      onClick={(e) => (stop(e), setOpen(!open))}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (stop(e), setOpen(!open))}
    >
      <Icon name="eye" className="mr-0.5 inline h-3 w-3 -translate-y-px" />
      {open ? sightingNames(list.map((s) => (s.noted ? { ...s, name: `${s.name} (${w(sex).note})` } : s))) : `${w(sex).vu} par ${n === 1 ? (list[0].mine ? 'toi' : list[0].name) : `${n} personnes`}`}
    </span>
  )
}

export type CoverageFilter = 'tous' | 'pasvus' | 'vus' | 'notes' | 'arevoir'

/** Compteurs de couverture de l'équipe et filtres de la liste. */
export function CoverageBar({
  total,
  seen,
  noted,
  rewatch,
  mine,
  filter,
  setFilter,
  g,
}: {
  total: number
  seen: number
  noted: number
  rewatch: number
  /** Mes équipes (tournoi réparti) : vus / total. */
  mine?: { seen: number; total: number }
  filter: CoverageFilter
  setFilter: (f: CoverageFilter) => void
  /** Genre de la liste (src/gender.ts) : « Pas encore vues », « 26 joueuses »… quand ce sont des filles. */
  g?: Gender
}) {
  const chips: [CoverageFilter, string, number][] = [
    ['tous', w(g).Tous, total],
    ['pasvus', accord('Pas encore vu', g, 2), total - seen],
    ['vus', accord('Vu', g, 2), seen],
    ['notes', accord('Noté', g, 2), noted],
    ['arevoir', 'À revoir', rewatch],
  ]
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-accent/40 bg-accent/5 p-2.5">
      <div className="text-[11px] text-muted">
        <b className="text-fg">{pluralG(total, g)}</b> · <b className="text-fg">{seen}</b> {accord('vu', g, seen)} par l’équipe ·{' '}
        <b className="text-fg">{total - seen}</b> {accord('pas encore vu', g, total - seen)} · <b className="text-fg">{noted}</b> {accord('noté', g, noted)} ·{' '}
        <b className="text-fg">{rewatch}</b> à revoir
      </div>
      {mine && mine.total > 0 && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="shrink-0 font-bold">Mes équipes : {mine.seen} sur {mine.total} {accord('vu', g, mine.total)}</span>
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-panel-2">
            <span className="block h-full bg-accent" style={{ width: `${Math.round((mine.seen / mine.total) * 100)}%` }} />
          </span>
        </div>
      )}
      {/* Défilement horizontal sur téléphone : tous les filtres sous le pouce, sans retour à la ligne. */}
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
        {chips.map(([v, label, n]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold whitespace-nowrap ${filter === v ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-muted'}`}
          >
            {label} <span className="opacity-70">{n}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- À revoir ----------

/** « À revoir… » : bouton d'une ligne ou de la fiche ; ouvre le choix des destinations. */
export function RewatchButton({
  playerId,
  originEventId,
  rows = [],
  compact = false,
  hideEmpty = false,
  className = '',
}: {
  playerId: string
  originEventId?: string
  rows?: Rewatch[]
  /** Ligne de liste étroite : sans « à revoir » posé, l'icône seule (le nom au survol et pour les lecteurs d'écran). */
  compact?: boolean
  /** Rien sans « à revoir » posé (la ligne a déjà son bouton rapide, RewatchToggle). */
  hideEmpty?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (!scoutId() || (hideEmpty && !rows.length)) return null
  const mine = rows.some(isMyRewatch)
  const others = [...new Set(rows.filter((r) => !isMyRewatch(r)).map((r) => r.createdByName ?? '?'))]
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => (stop(e), setOpen(true))}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (stop(e), setOpen(true))}
        title={rows.length ? `À revoir : ${[mine && 'toi', ...others].filter(Boolean).join(', ')}` : 'Mettre à revoir (événement à venir, groupe, ou liste générale)'}
        className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold whitespace-nowrap ${
          rows.length ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-line text-muted hover:border-accent hover:text-fg'
        } ${className}`}
      >
        <Icon name="clock" className="h-3 w-3" />
        {rows.length ? `à revoir${rows.length > 1 ? ` ×${rows.length}` : ''}` : compact ? <span className="sr-only">À revoir…</span> : 'À revoir…'}
        {!rows.length && compact && <span aria-hidden>…</span>}
      </span>
      {open && <RewatchDialog playerId={playerId} originEventId={originEventId} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * Horloge « à revoir » d'une ligne de joueur, à côté de l'œil « vu » et de la même taille (icône 16 px, zone 32 px).
 * - pas encore à revoir par moi : un toucher le met à revoir tout de suite, comme la fenêtre sans rien cocher (liste
 *   « À revoir » générale, repéré ici) ; si j'en ai déjà un ouvert ailleurs sur ce joueur, la fenêtre s'ouvre pour le compléter
 *   (comme « À revoir… », pas de doublon) ;
 * - déjà à revoir par moi (pastille pleine) : un toucher ouvre la fenêtre « À revoir… » (événements, groupes, commentaire,
 *   « Retirer mon « à revoir » ») : on ne perd pas d'un toucher ce qui a été précisé.
 * Contour bleu : à revoir pour un autre observateur seulement.
 */
export function RewatchToggle({
  playerId,
  originEventId,
  groupId,
  rows = [],
}: {
  playerId: string
  originEventId?: string
  /** Ligne d'un groupe : le « à revoir » posé d'un toucher vise ce groupe (« à revoir dans ce groupe »). */
  groupId?: string
  rows?: Rewatch[]
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!scoutId()) return null
  const mine = rows.some((r) => isMyRewatch(r) && !r.done)
  const others = [...new Set(rows.filter((r) => !isMyRewatch(r)).map((r) => r.createdByName ?? '?'))]
  const tap = async (e: { preventDefault(): void; stopPropagation(): void }) => {
    stop(e)
    if (busy) return
    if (mine) return setOpen(true)
    setBusy(true)
    try {
      if (await myOpenRewatch(playerId)) return setOpen(true)
      await saveRewatch({ playerId, originEventId, ...(groupId ? { groups: [groupId] } : {}) })
    } finally {
      setBusy(false)
    }
  }
  const label = mine ? 'À revoir par toi — toucher pour préciser ou retirer' : groupId ? 'Mettre à revoir dans ce groupe' : 'Mettre à revoir (liste « À revoir » générale)'
  return (
    <>
      <button
        type="button"
        onClick={(e) => void tap(e)}
        aria-pressed={mine}
        aria-label={label}
        title={`${label}${others.length ? ` · à revoir aussi pour ${others.join(', ')}` : ''}`}
        className="-my-2 inline-flex h-8 w-7 shrink-0 items-center justify-center"
      >
        {mine ? (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sky-400 text-bg">
            <Icon name="clock" className="h-3.5 w-3.5" />
          </span>
        ) : (
          <Icon name="clock" className={`h-4 w-4 ${others.length ? 'text-sky-300' : 'text-muted/60 hover:text-sky-300'}`} />
        )}
      </button>
      {open && <RewatchDialog playerId={playerId} originEventId={originEventId} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * Fenêtre « À revoir » : un ou plusieurs événements à venir, un ou plusieurs groupes (ou un nouveau), ou rien (liste
 * « À revoir » générale) ; commentaire facultatif. Mon « à revoir » encore ouvert sur ce joueur est complété.
 */
export function RewatchDialog({ playerId, originEventId, onClose }: { playerId: string; originEventId?: string; onClose: () => void }) {
  const role = useRole()
  const data = useLiveQuery(async () => {
    await loadTeams()
    const todayIso = new Date().toLocaleDateString('sv')
    const [player, events, groups, existing] = await Promise.all([
      db.players.get(playerId),
      db.events.where('date').aboveOrEqual(todayIso).toArray(),
      db.groups.orderBy('name').toArray(),
      myOpenRewatch(playerId),
    ])
    return {
      player,
      events: alive(events)
        .filter((e) => !e.archived && e.id !== originEventId)
        .sort((a, b) => a.date.localeCompare(b.date)),
      // Pas de groupe Pôle : ses membres viennent des périodes des fiches (« Ajouter à un groupe »), jamais de playerIds.
      groups: alive(groups).filter((g) => !g.archived && !g.poleUnitId && (can.editGroup(role, g) || can.contributeGroup(role, g))),
      existing,
    }
  }, [playerId, role])
  const [evs, setEvs] = useState<string[] | null>(null)
  const [grs, setGrs] = useState<string[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [newGroup, setNewGroup] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  if (!data) return null
  const { player, events, groups, existing } = data
  // Valeurs de départ : mon « à revoir » encore ouvert, s'il y en a un.
  const pickedEvents = evs ?? existing?.events ?? []
  const pickedGroups = grs ?? existing?.groups ?? []
  const text = note ?? existing?.note ?? ''
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const name = player ? `${player.lastName.toUpperCase()} ${player.firstName}` : 'ce joueur'
  const gw = w(player?.sex)

  async function submit() {
    setBusy(true)
    try {
      const gids = [...pickedGroups]
      // Création rapide d'un groupe : « Mon staff » (privé pour un observateur), avec ce joueur.
      const label = newGroup.trim()
      if (label) {
        const me = currentUserId()
        const g = await save<PlayerGroup>('groups', {
          id: newId(),
          name: label,
          playerIds: [],
          ...(can.publicGroups(role) ? { team: true } : { private: true }),
          ...(me && { names: { [me]: getMe() } }),
        })
        gids.push(g.id)
      }
      const targets = await db.groups.bulkGet(gids)
      for (const g of targets) if (g && !g.deleted) await addToGroup(g, [playerId])
      await saveRewatch({
        ...existing,
        id: existing?.id,
        playerId,
        originEventId: existing ? existing.originEventId : originEventId,
        events: pickedEvents.length ? pickedEvents : undefined,
        groups: gids.length ? gids : undefined,
        note: text.trim() || undefined,
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  // Dans le document (portail) : ouverte depuis une ligne de liste, elle ne doit pas être dans son lien.
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={(e) => (stop(e), onClose())}>
      <div role="dialog" aria-modal="true" className="card flex max-h-[85dvh] w-full max-w-md flex-col gap-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="text-sm font-extrabold">À revoir : {name}</div>
          <p className="text-[11px] text-muted">
            Visible par ton staff. Ce n’est pas une convocation : la liste des événements choisis ne change pas, {gw.leJoueur} y apparaît à part.
          </p>
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <div className="flex flex-col gap-1">
            <span className="label">Événements à venir</span>
            {events.length ? (
              events.map((e) => (
                <Check key={e.id} on={pickedEvents.includes(e.id)} onClick={() => setEvs(toggle(pickedEvents, e.id))}>
                  <b>{e.name}</b>
                  <span className="text-muted"> · {fmtDate(e.date)}{e.place ? ` · ${e.place}` : ''}</span>
                </Check>
              ))
            ) : (
              <p className="text-[11px] text-muted">Aucun événement à venir.</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="label">Groupes</span>
            {groups.map((g) => (
              <Check key={g.id} on={pickedGroups.includes(g.id)} onClick={() => setGrs(toggle(pickedGroups, g.id))}>
                <b>
                  <GroupMark g={g} />
                  {g.name}
                </b>
                <span className="text-muted"> · {plural(g.playerIds.length, 'joueur')}{g.playerIds.includes(playerId) ? ' · déjà dedans' : ''}</span>
              </Check>
            ))}
            <input
              className="field py-1.5 text-xs"
              placeholder={`+ Nouveau groupe${can.publicGroups(role) ? ' (groupe de travail)' : ' (privé)'} : nom…`}
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
            />
          </div>
          <label className="flex flex-col gap-1">
            <span className="label">Commentaire (facultatif)</span>
            <DictationTextarea className="field min-h-16 text-xs" maxLength={500} placeholder="Ex. à voir sur un match entier, en défense…" value={text} onChange={setNote} />
          </label>
          {!pickedEvents.length && !pickedGroups.length && !newGroup.trim() && (
            <p className="text-[11px] text-muted">Rien de coché : {gw.il} va dans la liste « À revoir » générale.</p>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {existing && (
            <button
              className="btn-ghost mr-auto px-3 text-xs"
              onClick={async () => {
                await remove('rewatch', existing.id)
                onClose()
              }}
            >
              Retirer mon « à revoir »
            </button>
          )}
          <button className="btn px-4 text-xs text-muted" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary px-4 text-xs" disabled={busy} onClick={() => void submit()}>
            {existing ? 'Enregistrer' : 'Mettre à revoir'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Case à cocher d'une liste (événements, groupes). */
function Check({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-left text-xs ${on ? 'border-accent bg-accent-soft' : 'border-line bg-panel-2 hover:border-accent'}`}
    >
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line'}`}>{on ? '✓' : ''}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}

/** « repéré au Tournoi de l'Espenon par Sophie · 12/10 » + commentaire, pour chaque auteur. */
export function RewatchOrigins({ rows, events, className = '', sex }: { rows: Rewatch[]; events: Map<string, HBEvent>; className?: string; sex?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 text-[10px] text-muted ${className}`}>
      {rows.map((r) => {
        const from = r.originEventId ? events.get(r.originEventId)?.name : undefined
        const by = isMyRewatch(r) ? 'toi' : (r.createdByName ?? '?')
        return (
          <div key={r.id}>
            {from ? <>{w(sex).repere} au {from} </> : `à revoir, signalé${w(sex).e} `}par <b className="text-fg">{by}</b>
            {r.createdAtServer && <> · {fmtDate(dayOf(r.createdAtServer)).slice(0, 5)}</>}
            {r.note && <span className="text-sky-300"> : « {r.note} »</span>}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Section « À revoir » d'un événement visé : distincte de la liste (ce n'est pas une convocation). Chaque joueur avec
 * son origine ; « revu ✓ » dès qu'il est vu ou noté ici ; un organisateur peut l'ajouter à la liste.
 */
export function RewatchInEvent({
  ev,
  rows,
  players,
  events,
  sight,
  canAdd,
  onAdd,
  g,
}: {
  ev: HBEvent
  rows: Rewatch[]
  players: Map<string, Player>
  events: Map<string, HBEvent>
  sight: Map<string, Sighting[]>
  canAdd: boolean
  onAdd: (ids: string[]) => void
  /** Genre de l'événement (src/gender.ts). */
  g?: Gender
}) {
  const byPlayer = new Map<string, Rewatch[]>()
  for (const r of rows) byPlayer.set(r.playerId, [...(byPlayer.get(r.playerId) ?? []), r])
  const list = [...byPlayer].filter(([pid]) => players.has(pid))
  if (!list.length) return null
  const inList = new Set(ev.playerIds ?? [])
  return (
    <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3">
      <div className="text-xs font-bold text-sky-300">À revoir ici ({list.length})</div>
      <p className="mt-0.5 text-[11px] text-muted">{accord('Joueur signalé', g, 2)} par ton staff pour cet événement. Ce n’est pas une convocation : la liste ne change pas.</p>
      <div className="cols mt-2 flex flex-col gap-2">
        {list.map(([pid, rs]) => {
          const p = players.get(pid)!
          const s = sight.get(pid) ?? []
          return (
            <div key={pid} className="flex items-start gap-2 rounded-md border border-line bg-panel p-2">
              <div className="min-w-0 flex-1">
                <Link to={`/joueurs/${pid}`} className="block truncate text-xs font-bold">
                  {p.lastName.toUpperCase()} {p.firstName}
                  <span className="font-normal text-muted"> · {[p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}</span>
                </Link>
                <RewatchOrigins rows={rs} events={events} sex={p.sex} />
                {s.length > 0 && <div className="text-[10px] font-bold text-emerald-300">{w(p.sex).revu} ✓ ({sightingNames(s)})</div>}
                {canAdd && !inList.has(pid) && (
                  <button className="mt-1 text-[10px] font-bold text-accent underline" onClick={() => onAdd([pid])}>
                    Ajouter à la liste de l’événement
                  </button>
                )}
                {inList.has(pid) && <div className="text-[10px] text-muted">dans la liste de l’événement</div>}
              </div>
              <SeenEye eventId={ev.id} playerId={pid} list={s} sex={p.sex} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- Répartition d'un tournoi ----------

/**
 * Répartition par équipe d'un tournoi : couverture par équipe (vus / total, qui en a la charge) ; pour l'organisateur
 * et les participants : équipes engagées, observateurs de chaque équipe, équipe et numéro de chaque joueur.
 * Facultative : sans équipe déclarée, tout le monde voit tout.
 */
export function TournamentPanel({
  ev,
  roster,
  sight,
  edit,
  manage,
  teams,
  g,
}: {
  ev: HBEvent
  roster: Player[]
  sight: Map<string, Sighting[]>
  /** Organisateur ou participant : peut répartir. */
  edit: boolean
  manage: boolean
  teams: Team[]
  /** Genre de l'événement (src/gender.ts). */
  g?: Gender
}) {
  const [open, setOpen] = useState(false)
  const [part, setPart] = useState<'equipes' | 'observateurs' | 'joueurs' | null>(null)
  const [newName, setNewName] = useState('')
  const ts = tournamentTeams(ev)
  const mine = myTournamentTeams(ev)
  const people = eventPeople(ev, manage)
  const name = (u: string) => personName(u, ev, teams)
  const stat = (tid?: string) => {
    const ps = roster.filter((p) => teamOf(ev, p.id) === tid || (!tid && !ts.some((t) => t.id === teamOf(ev, p.id))))
    return { total: ps.length, seen: ps.filter((p) => (sight.get(p.id) ?? []).length).length }
  }
  const mineStat = [...mine].reduce((a, t) => ({ total: a.total + stat(t).total, seen: a.seen + stat(t).seen }), { total: 0, seen: 0 })
  const loose = stat(undefined)
  // Match importé d'une feuille : joueurs reliés encore sans équipe (« Reprendre les deux équipes de la feuille »).
  const fromSheet = ev.matchSheet ? sheetPlayersWithoutTeam(ev.tournament, ev.matchSheet, ev.playerIds ?? []) : 0
  const summary = ts.length
    ? `${plural(ts.length, 'équipe')}${mine.size ? ` · mes équipes : ${mineStat.seen} sur ${mineStat.total} ${accord('vu', g, mineStat.total)}` : ''}${loose.total ? ` · ${loose.total} sans équipe` : ''}`
    : 'Pas de répartition : tout le monde voit tout.'
  // Noms des observateurs choisis : gardés avec l'événement (affichage hors ligne, chez les autres participants).
  const namesOf = (us: string[]) => Object.fromEntries(us.map((u) => [u, personName(u, ev, teams)]).filter(([u, n]) => n !== '?' && n !== 'toi' && u !== 'local'))

  return (
    <div className={`card overflow-hidden ${open ? 'border-accent/50' : ''}`}>
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="users" className="h-4 w-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">Répartition par équipe</span>
          {!open && <span className="block truncate text-[11px] text-muted">{summary}</span>}
        </span>
        <span className={`shrink-0 text-muted transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line p-3">
          {ts.length === 0 && (
            <p className="text-[11px] text-muted">
              Déclare les équipes engagées, rattache chaque joueur à son équipe et confie une ou plusieurs équipes à chaque observateur : chacun voit
              « Mes équipes » en premier, l’événement montre la couverture par équipe. Sans répartition, tout le monde voit tout.
              {edit && fromSheet > 0 && ' Match importé d’une feuille : « Équipes », puis « Reprendre les deux équipes de la feuille de match ».'}
            </p>
          )}
          {ts.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {[...ts].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id))).map((t) => {
                const s = stat(t.id)
                const obs = teamObservers(ev, t.id)
                return (
                  <div key={t.id} className={`rounded-md border px-2.5 py-1.5 text-xs ${mine.has(t.id) ? 'border-accent/60 bg-accent/10' : 'border-line bg-panel-2'}`}>
                    <div className="flex items-center gap-2">
                      <b className="min-w-0 flex-1 truncate">
                        {t.name}
                        {mine.has(t.id) && <span className="ml-1.5 rounded bg-accent px-1 text-[9px] text-white">MON ÉQUIPE</span>}
                      </b>
                      <span className="shrink-0 text-[11px]">
                        <b>{s.seen}</b> / {s.total} {accord('vu', g, s.total)}
                      </span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel">
                      <span className="block h-full bg-accent" style={{ width: s.total ? `${Math.round((s.seen / s.total) * 100)}%` : 0 }} />
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted">{obs.length ? `suivie par ${obs.map(name).join(', ')}` : 'personne n’en a la charge'}</div>
                  </div>
                )
              })}
              {loose.total > 0 && (
                <div className="text-[11px] text-muted">
                  Sans équipe : <b className="text-fg">{loose.seen}</b> / {loose.total} {accord('vu', g, loose.total)}
                </div>
              )}
            </div>
          )}
          {edit && (
            <>
              <div className="flex overflow-hidden rounded-md border border-line text-[11px] font-bold">
                {(
                  [
                    ['equipes', `Équipes (${ts.length})`],
                    ['observateurs', 'Observateurs'],
                    ['joueurs', `${w(g).Joueurs}${loose.total && ts.length ? ` (${loose.total} sans équipe)` : ''}`],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    disabled={v !== 'equipes' && !ts.length}
                    onClick={() => setPart(part === v ? null : v)}
                    className={`flex-1 py-1.5 disabled:opacity-40 ${part === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {part === 'equipes' && (
                <div className="flex flex-col gap-1.5">
                  {fromSheet > 0 && (
                    <button
                      className="btn-ghost min-h-8 justify-center px-3 py-1 text-xs"
                      title={`${pluralG(fromSheet, g)} de la feuille de match encore sans équipe : rangés dans leur équipe, avec leur numéro`}
                      onClick={() => void saveTournament(ev, (x) => teamsFromSheet(x, ev.matchSheet!, ev.playerIds ?? []))}
                    >
                      Reprendre les deux équipes de la feuille de match
                    </button>
                  )}
                  {ts.map((t) => (
                    <div key={`${t.id}:${t.name}`} className="flex items-center gap-2">
                      <input
                        className="field min-w-0 flex-1 py-1 text-xs"
                        defaultValue={t.name}
                        maxLength={60}
                        aria-label="Nom de l’équipe"
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v && v !== t.name) void saveTournament(ev, (x) => ({ ...x, teams: x.teams.map((y) => (y.id === t.id ? { ...y, name: v } : y)) }))
                        }}
                      />
                      <button
                        className="shrink-0 px-1 text-muted hover:text-red-400"
                        title="Retirer cette équipe (ses joueurs restent dans la liste, sans équipe)"
                        onClick={() =>
                          void saveTournament(ev, (x) => ({
                            teams: x.teams.filter((y) => y.id !== t.id),
                            players: Object.fromEntries(Object.entries(x.players ?? {}).map(([k, v]) => [k, v.team === t.id ? { num: v.num } : v])),
                            assign: Object.fromEntries(Object.entries(x.assign ?? {}).map(([k, v]) => [k, v.filter((y) => y !== t.id)])),
                          }))
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const v = newName.trim()
                      if (!v) return
                      setNewName('')
                      void saveTournament(ev, (x) => ({ ...x, teams: [...x.teams, { id: newTeamId(), name: v }] }))
                    }}
                  >
                    <input className="field min-w-0 flex-1 py-1 text-xs" maxLength={60} placeholder="Ex. HBC Rhône Sud 1" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    <button className="btn-primary shrink-0 px-3 py-1 text-xs" disabled={!newName.trim()}>
                      + Équipe
                    </button>
                  </form>
                </div>
              )}
              {part === 'observateurs' && (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] text-muted">Encadrants de l’événement (organisateur et participants). Réattribuable à tout moment.</p>
                  {people.map((u) => {
                    const has = new Set(ev.tournament?.assign?.[u] ?? [])
                    return (
                      <div key={u} className="flex flex-col gap-1">
                        <span className="text-xs font-bold">{name(u)}</span>
                        <div className="flex flex-wrap gap-1">
                          {ts.map((t) => (
                            <button
                              key={t.id}
                              onClick={() =>
                                void saveTournament(
                                  ev,
                                  (x) => {
                                    const cur = x.assign?.[u] ?? []
                                    const next = cur.includes(t.id) ? cur.filter((y) => y !== t.id) : [...cur, t.id]
                                    const assign = { ...x.assign, [u]: next }
                                    if (!next.length) delete assign[u]
                                    return { ...x, assign }
                                  },
                                  namesOf([u]),
                                )
                              }
                              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${has.has(t.id) ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted'}`}
                            >
                              {t.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                  {!people.length && <p className="text-[11px] text-muted">Ajoute des participants à l’événement (Modifier) pour leur confier des équipes.</p>}
                </div>
              )}
              {part === 'joueurs' && (
                <div className="flex flex-col gap-1">
                  <p className="text-[11px] text-muted">Équipe et numéro de maillot de chaque {w(g).joueur} de la liste.</p>
                  {[...roster]
                    .sort((a, b) => (teamOf(ev, a.id) ? 1 : 0) - (teamOf(ev, b.id) ? 1 : 0) || byNumber(ev)(a, b))
                    .map((p) => (
                      <PlayerTeamRow key={`${p.id}:${numOf(ev, p.id) ?? ''}`} ev={ev} p={p} />
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Équipe et numéro d'un joueur (répartition d'un tournoi). */
function PlayerTeamRow({ ev, p }: { ev: HBEvent; p: Player }) {
  const cur = ev.tournament?.players?.[p.id] ?? {}
  const set = (v: { team?: string; num?: string }) =>
    void saveTournament(ev, (x) => {
      const next = { ...x.players?.[p.id], ...v }
      const players = { ...x.players, [p.id]: next }
      if (!next.team && !next.num) delete players[p.id]
      return { ...x, players }
    })
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate">
        <b>{p.lastName.toUpperCase()}</b> {p.firstName}
      </span>
      <input
        className="field w-12 shrink-0 px-1.5 py-1 text-center text-xs"
        inputMode="numeric"
        maxLength={4}
        placeholder="n°"
        aria-label="Numéro de maillot"
        defaultValue={cur.num ?? ''}
        onBlur={(e) => {
          const v = e.target.value.trim().replace(/[^0-9A-Za-z]/g, '').slice(0, 4)
          if (v !== (cur.num ?? '')) set({ num: v || undefined })
        }}
      />
      <select className="field w-36 shrink-0 py-1 text-xs" value={cur.team ?? ''} aria-label="Équipe" onChange={(e) => set({ team: e.target.value || undefined })}>
        <option value="">— sans équipe —</option>
        {tournamentTeams(ev).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  )
}

// ---------- Fiche joueur : historique ----------

/** Historique compact du repérage : « Vu à … (3 obs.) → à revoir au … → revu ✓ ». */
export function ScoutHistory({ playerId, sex }: { playerId: string; sex?: string }) {
  const data = useLiveQuery(async () => {
    const [seen, evals, rewatch] = await Promise.all([
      db.seen.where('playerId').equals(playerId).toArray().then(alive),
      db.evaluations.where('playerId').equals(playerId).toArray().then(alive),
      db.rewatch.where('playerId').equals(playerId).toArray().then(alive),
    ])
    const eventIds = [...new Set([...seen.map((s) => s.eventId), ...evals.map((e) => e.eventId).filter((x): x is string => !!x), ...rewatch.flatMap((r) => [...(r.events ?? []), ...(r.originEventId ? [r.originEventId] : [])])])]
    const events = new Map((await db.events.bulkGet(eventIds)).filter((e): e is HBEvent => !!e).map((e) => [e.id, e]))
    const groups = new Map((await db.groups.bulkGet(rewatch.flatMap((r) => r.groups ?? []))).filter((g): g is PlayerGroup => !!g).map((g) => [g.id, g]))
    const keys = await revisitedKeys(rewatch.flatMap((r) => r.events ?? []))
    return { seen, evals, rewatch, events, groups, keys }
  }, [playerId])
  if (!data) return null
  const { seen, evals, rewatch, events, groups, keys } = data
  // Événements où il a été vu (« vu » ou avis) : nombre d'observateurs distincts.
  const obs = new Map<string, Set<string>>()
  const add = (eid: string, who: string) => obs.set(eid, (obs.get(eid) ?? new Set()).add(who))
  seen.forEach((s) => add(s.eventId, s.createdBy ?? s.id.split(':')[0]))
  evals.forEach((e) => e.eventId && add(e.eventId, e.observerId ?? e.createdBy ?? e.observer))
  type Step = { key: string; date: string; node: ReactNode }
  const steps: Step[] = [...obs]
    .filter(([eid]) => events.has(eid))
    .map(([eid, who]) => {
      const ev = events.get(eid)!
      return {
        key: `v${eid}`,
        date: ev.date,
        node: (
          <Link to={`/evenements/${eid}`} className="hover:underline">
            {accord('Vu', sex)} à <b>{ev.name}</b> ({who.size} obs.)
          </Link>
        ),
      }
    })
  for (const r of rewatch) {
    const dests = [...(r.events ?? []).map((e) => events.get(e)?.name), ...(r.groups ?? []).map((g) => groups.get(g)?.name)].filter(Boolean)
    const at = revisitedAt(r, keys)
    steps.push({
      key: `r${r.id}`,
      date: r.createdAtServer ? dayOf(r.createdAtServer) : new Date(stamp(r)).toLocaleDateString('sv'),
      node: (
        <span title={r.note}>
          à revoir {dests.length ? <>au {dests.join(', ')}</> : '(liste générale)'}
          <span className="text-muted"> · {isMyRewatch(r) ? 'toi' : (r.createdByName ?? '?')}</span>
          {isRevisited(r, keys) && (
            <span className="font-bold text-emerald-300"> → {w(sex).revu} ✓{at && events.get(at) ? ` (${events.get(at)!.name})` : ''}</span>
          )}
        </span>
      ),
    })
  }
  if (!steps.length) return null
  steps.sort((a, b) => a.date.localeCompare(b.date))
  return (
    <div className="card p-3">
      <div className="section-title mb-1.5 flex items-center gap-1.5">
        <Icon name="eye" className="h-3.5 w-3.5 text-accent" /> Repérage
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
        {steps.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-muted">→</span>}
            <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5">{s.node}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** « À revoir » de ce joueur visibles (pour le bouton de la fiche : « à revoir ×2 »). */
export function usePlayerRewatch(playerId: string) {
  return useLiveQuery(() => db.rewatch.where('playerId').equals(playerId).toArray().then(alive), [playerId], [] as Rewatch[])
}

// ---------- Groupe visé ----------

/** « À revoir » qui visent ce groupe, par joueur, avec l'état « revu » (à la main). */
export function useGroupRewatch(groupId?: string) {
  return useLiveQuery(
    async () => {
      const rows = groupId ? alive(await db.rewatch.where('groups').equals(groupId).toArray()) : []
      const events = new Map((await db.events.bulkGet(rows.map((r) => r.originEventId).filter((x): x is string => !!x))).filter((e): e is HBEvent => !!e).map((e) => [e.id, e]))
      const by = new Map<string, Rewatch[]>()
      for (const r of rows) by.set(r.playerId, [...(by.get(r.playerId) ?? []), r])
      return { by, events }
    },
    [groupId],
    { by: new Map<string, Rewatch[]>(), events: new Map<string, HBEvent>() },
  )
}

/** Trace dans un groupe visé : « à revoir, ajouté par X depuis tel événement » + « Revu » (à la main). */
export function GroupRewatchLine({ rows, events, sex }: { rows: Rewatch[]; events: Map<string, HBEvent>; sex?: string }) {
  if (!rows.length) return null
  const open = rows.filter((r) => !r.done)
  const from = (r: Rewatch) => (r.originEventId && events.get(r.originEventId)?.name) || undefined
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-[10px]">
      <span className="min-w-0 text-sky-300">
        à revoir, {w(sex).ajoute} par{' '}
        {rows
          .map((r) => `${isMyRewatch(r) ? 'toi' : (r.createdByName ?? '?')}${from(r) ? ` depuis ${from(r)}` : ''}${r.note ? ` (« ${r.note} »)` : ''}`)
          .join(' ; ')}
      </span>
      {open.length ? (
        <span role="button" tabIndex={0} className="cursor-pointer font-bold text-accent underline" onClick={(e) => (stop(e), void setRevisited(open, true))}>
          {accord('Revu', sex)}
        </span>
      ) : (
        <span className="font-bold text-emerald-300" title={rows.map((r) => r.done?.byName).filter(Boolean).join(', ')}>
          {w(sex).revu} ✓
        </span>
      )}
    </div>
  )
}
