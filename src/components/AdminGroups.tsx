import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BackButton } from '../backNav'
import { alive, db, type Player, type PlayerGroup } from '../db'
import { useRegionName } from '../lists'
import type { Role } from '../roles'
import { spyTarget } from '../spy'
import { ADMIN_GROUPS, STAFF } from '../staffLabels'
import { supabase } from '../sync'
import { StampLine } from './ActivityLog'
import { ask, inform } from './Confirm'
import { PanelClose, selectedCls, usePanel, useSelected } from './MasterDetail'
import { TransferGroup, useOnline } from './TransferGroup'
import { Avatar, Empty, Icon, poleEdge, PosBadges, QuarterBadge } from './ui'

/*
 * « Voir tous les groupes » (administrateurs, supabase/039_admin_groupes.sql) : les groupes privés et « Mon staff » des
 * autres comptes, lus en direct sur le serveur quand l'interrupteur est actif. Ils ne sont jamais copiés dans Dexie
 * (ni fil, ni suivis, ni filtres) : la synchronisation et la règle de lecture de hb_groups ne changent pas.
 * Le serveur note chaque affichage de la liste et chaque consultation d'un groupe dans le journal d'activité.
 * Actions : consulter (lecture seule), réattribuer (hb_transfer_group), supprimer (hb_admin_delete_group).
 */

/** Groupe d'un autre, tel que renvoyé par hb_admin_groups(). */
export interface OtherGroup {
  id: string
  name: string
  description?: string
  private: boolean
  team: boolean
  scope?: PlayerGroup['scope']
  sex?: PlayerGroup['sex']
  department?: string
  regionId?: string
  years?: string[]
  archived?: boolean
  createdBy?: string
  ownerName?: string
  playerCount: number
}

/** Détail, tel que renvoyé par hb_admin_group(p_id). */
interface OtherGroupDetail extends Omit<OtherGroup, 'ownerName' | 'playerCount'> {
  playerIds: string[]
  addedBy?: Record<string, string>
  editors: string[]
  names?: Record<string, string>
  teamsCount: number
  createdByName?: string
  createdAtServer?: string
  updatedByName?: string
  updatedAtServer?: string
  ownerLabel: string
}

type Info = (g: Pick<PlayerGroup, 'sex' | 'department' | 'years' | 'scope'>, region?: string) => string

// ---------- Interrupteur (gardé pour la session seulement) ----------

const KEY = 'handbase.groupes.tous'
let on = (() => {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
})()
/** Relecture demandée (après une réattribution ou une suppression). */
let version = 0
const subs = new Set<() => void>()
const notify = () => subs.forEach((f) => f())
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f))
const snapshot = () => `${on ? 1 : 0}:${version}`

function setAllGroups(v: boolean) {
  on = v
  try {
    if (v) sessionStorage.setItem(KEY, '1')
    else sessionStorage.removeItem(KEY)
  } catch {
    /* stockage indisponible */
  }
  notify()
}

export function refreshOtherGroups() {
  version++
  notify()
}

/** Réservé aux administrateurs, et pas pendant « Voir comme… ». */
export const canSeeAllGroups = (role: Role) => role === 'admin' && !spyTarget()

/** Interrupteur actif pour ce rôle (et numéro de relecture). */
export function useAllGroups(role: Role): { on: boolean; version: number } {
  const s = useSyncExternalStore(subscribe, snapshot)
  const [flag, v] = s.split(':')
  return { on: flag === '1' && canSeeAllGroups(role), version: Number(v) }
}

const errText = (e: { code?: string; message: string }) => (e.code === 'PGRST202' ? ADMIN_GROUPS.missing : e.message)

// ---------- Liste ----------

/** Interrupteur en haut de la page Groupes (administrateurs). */
export function AllGroupsToggle({ role }: { role: Role }) {
  const { on: active } = useAllGroups(role)
  if (!canSeeAllGroups(role)) return null
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-panel px-3 py-2">
      <label className="flex items-center justify-between gap-3 text-xs font-bold">
        <span className="flex items-center gap-1.5">
          <Icon name="eye" className="h-3.5 w-3.5 text-muted" /> {ADMIN_GROUPS.toggle}
        </span>
        <input type="checkbox" checked={active} onChange={(e) => setAllGroups(e.target.checked)} />
      </label>
      {active && <p className="text-[11px] text-muted">{ADMIN_GROUPS.toggleHelp}</p>}
    </div>
  )
}

/** Section « Groupes des autres » (interrupteur actif). */
export function OtherGroupsSection({ role, info }: { role: Role; info: Info }) {
  const { on: active, version: v } = useAllGroups(role)
  const online = useOnline()
  const [list, setList] = useState<OtherGroup[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!active || !supabase || !online) return
    let live = true
    setErr('')
    void supabase.rpc('hb_admin_groups').then(({ data, error }) => {
      if (!live) return
      if (error) setErr(errText(error))
      else setList((data as OtherGroup[] | null) ?? [])
    })
    return () => {
      live = false
    }
  }, [active, online, v])
  // Interrupteur coupé : rien ne reste en mémoire.
  useEffect(() => {
    if (!active) setList(null)
  }, [active])

  if (!active) return null
  return (
    <>
      <div className="section-title mt-1 mb-0 flex items-center gap-1.5">
        <Icon name="eye" className="h-3.5 w-3.5" /> {ADMIN_GROUPS.section}
      </div>
      {!supabase ? (
        <p className="text-[11px] text-amber-300">{ADMIN_GROUPS.noServer}</p>
      ) : !online ? (
        <p className="text-[11px] text-amber-300">{ADMIN_GROUPS.offline}</p>
      ) : err ? (
        <p className="text-[11px] text-red-300">{err}</p>
      ) : !list ? (
        <p className="text-[11px] text-muted">{ADMIN_GROUPS.loading}</p>
      ) : !list.length ? (
        <Empty>{ADMIN_GROUPS.empty}</Empty>
      ) : (
        <div className="cols flex flex-col gap-3">
          {list.map((g) => (
            <OtherRow key={g.id} g={g} info={info} />
          ))}
        </div>
      )}
    </>
  )
}

function OwnerChip({ g, name }: { g: { private?: boolean }; name: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-400/50 px-1.5 text-[10px] font-bold text-amber-200">
      <Icon name={g.private ? 'lock' : 'users'} className="h-2.5 w-2.5" /> {ADMIN_GROUPS.owner(g, name)}
    </span>
  )
}

function OtherRow({ g, info }: { g: OtherGroup; info: Info }) {
  const regionName = useRegionName()
  const text = info(g, regionName(g.regionId))
  const sel = useSelected('/groupes') === g.id
  return (
    <Link
      to={`/groupes/${g.id}`}
      data-md={g.id}
      aria-current={sel || undefined}
      className={`card flex items-center justify-between gap-3 border-dashed p-3 outline-none hover:border-accent focus-visible:border-accent ${g.archived ? 'opacity-60' : ''} ${selectedCls(sel)}`}
    >
      <div className="min-w-0">
        <div className="flex items-center text-sm font-bold">
          <span className="truncate">{g.name}</span>
          {g.archived && <span className="ml-2 shrink-0 text-[10px] text-muted">archivé</span>}
        </div>
        <div className="mt-0.5">
          <OwnerChip g={g} name={g.ownerName ?? '?'} />
        </div>
        {text && <div className="truncate text-[11px] font-bold text-accent">{text}</div>}
        {g.description && <div className="truncate text-[11px] text-muted">{g.description}</div>}
      </div>
      <span className="shrink-0 text-xs font-bold text-muted">
        {g.playerCount} joueur{g.playerCount > 1 ? 's' : ''}
      </span>
    </Link>
  )
}

// ---------- Détail (lecture seule) ----------

/** Groupe d'un autre ouvert depuis « Groupes des autres » (/groupes/:id, absent de l'appareil). */
export function OtherGroupDetail({ id, info }: { id: string; info: Info }) {
  const nav = useNavigate()
  const panel = usePanel()
  const online = useOnline()
  const regionName = useRegionName()
  const [g, setG] = useState<OtherGroupDetail | null>(null)
  const [err, setErr] = useState('')
  const [transferring, setTransferring] = useState(false)
  const [busy, setBusy] = useState(false)

  // Chaque ouverture est notée par le serveur (journal d'activité).
  useEffect(() => {
    setG(null)
    setErr('')
    setTransferring(false)
    if (!supabase || !online) return
    let live = true
    void supabase.rpc('hb_admin_group', { p_id: id }).then(({ data, error }) => {
      if (!live) return
      if (error) setErr(errText(error))
      else setG(data as OtherGroupDetail)
    })
    return () => {
      live = false
    }
  }, [id, online])

  // Joueurs : ceux de l'appareil (un administrateur voit tous les joueurs).
  const players = useLiveQuery(
    async () => (g ? alive((await db.players.bulkGet(g.playerIds)).filter((p): p is Player => !!p)) : []),
    [g],
  )

  const back = panel ? <PanelClose /> : <BackButton fallback="/groupes" label="GROUPES" />
  if (!supabase || !online || err || !g)
    return (
      <div className="flex flex-col gap-4">
        <div>{back}</div>
        <p className={`py-10 text-center text-sm ${err || !supabase || !online ? 'text-amber-300' : 'text-muted'}`}>
          {!supabase ? ADMIN_GROUPS.noServer : !online ? ADMIN_GROUPS.offline : err || 'Chargement…'}
        </p>
      </div>
    )

  const who = (uid?: string) => (uid ? (g.names?.[uid] ?? (uid === g.createdBy ? g.createdByName : undefined)) : undefined)
  const addedByOf = (pid: string) => who(g.addedBy?.[pid] ?? g.createdBy)
  const text = info(g, regionName(g.regionId))
  const sorted = [...(players ?? [])].sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'))
  const missing = g.playerIds.length - sorted.length
  const others = g.editors.map((u) => who(u) ?? '?')

  async function del() {
    if (!supabase || !g) return
    if (!(await ask(ADMIN_GROUPS.confirmDelete(g.name, g.ownerLabel), { ok: 'Supprimer' }))) return
    setBusy(true)
    const { error } = await supabase.rpc('hb_admin_delete_group', { p_id: g.id })
    setBusy(false)
    if (error) return inform(`Suppression impossible : ${errText(error)}`)
    refreshOtherGroups()
    nav('/groupes', { replace: true })
    await inform(`Groupe « ${g.name} » supprimé.`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {back}
        <div className="flex flex-wrap gap-3">
          <button className="text-xs text-muted hover:text-fg" aria-expanded={transferring} onClick={() => setTransferring((t) => !t)}>
            Réattribuer…
          </button>
          <button className="text-xs text-muted hover:text-red-400" disabled={busy} onClick={() => void del()}>
            Supprimer
          </button>
        </div>
      </div>

      {transferring && (
        <TransferGroup
          g={g}
          foreign
          onClose={() => setTransferring(false)}
          onDone={refreshOtherGroups}
          onHidden={() => nav('/groupes', { replace: true })}
        />
      )}

      <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-100">
        <Icon name="eye" className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>
          <b>{g.ownerLabel.replace(/^./, (c) => c.toUpperCase())}.</b> {ADMIN_GROUPS.notice}
        </span>
      </p>

      <div>
        <h1 className="text-lg font-extrabold">
          <Icon name={g.private ? 'lock' : 'users'} className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-muted" />
          {g.name}
          {g.archived && <span className="ml-2 text-xs text-muted">archivé</span>}
        </h1>
        {text && <div className="text-xs font-bold text-accent">{text}</div>}
        {g.description && <div className="text-xs text-muted">{g.description}</div>}
        {!g.private && (others.length > 0 || g.teamsCount > 0) && (
          <div className="mt-1 text-[11px] text-muted">
            Participants : {[...others, ...(g.teamsCount ? [STAFF.hidden(g.teamsCount)] : [])].join(', ')}
          </div>
        )}
        <div className="mt-1">
          <StampLine row={g} />
        </div>
      </div>

      <div className="text-[11px] text-muted">
        {g.playerIds.length} joueur{g.playerIds.length > 1 ? 's' : ''}
        {missing > 0 && ` (dont ${missing} absent${missing > 1 ? 's' : ''} de cet appareil)`}
      </div>
      {!g.playerIds.length && <Empty>Aucun joueur dans ce groupe.</Empty>}
      <div className="cols flex flex-col gap-1.5">
        {sorted.map((p) => (
          <Link key={p.id} to={`/joueurs/${p.id}`} className={`card flex items-center gap-3 p-2.5 outline-none hover:border-accent focus:border-accent ${poleEdge(p)}`}>
            <Avatar p={p} size={32} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 truncate text-sm font-bold">
                {p.lastName.toUpperCase()} {p.firstName} <PosBadges p={p} /> <QuarterBadge birthDate={p.birthDate} />
              </div>
              <div className="truncate text-[11px] text-muted">{[p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')}</div>
              {g.editors.length > 0 && addedByOf(p.id) && <div className="truncate text-[10px] text-muted">ajouté par {addedByOf(p.id)}</div>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
