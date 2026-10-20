import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { alive, db, save, type Player, type PlayerGroup } from '../db'
import { genderOf, pluralG, w } from '../gender'
import { isMemberAt } from '../poleSeason'
import { can, currentUserId, useRole } from '../roles'
import { loadTeams } from '../teams'
import { askArrival, joinMessage, joinPoleMany, PoleChip, usePoleLeader, usePoleRefs, useSeasons } from './PoleGroup'
import { getMe, GroupMark } from './ui'

/** Ajoute des joueurs au groupe (sans doublon, ordre conservé). Renvoie le nombre de nouveaux. */
export function addToGroup(g: PlayerGroup, ids: string[]) {
  // Relecture et écriture d'un bloc : des clics rapprochés s'enchaînent sans s'écraser.
  return db.transaction('rw', db.groups, db.outbox, async () => {
    const cur = (await db.groups.get(g.id)) ?? g
    const have = new Set(cur.playerIds)
    const added = [...new Set(ids)].filter((id) => !have.has(id))
    // « Ajouté par » : posé ici pour l'affichage immédiat ; le serveur le refait de son côté (023).
    const me = currentUserId()
    if (added.length)
      await save<PlayerGroup>('groups', {
        ...cur,
        playerIds: [...cur.playerIds, ...added],
        ...(me && {
          addedBy: { ...cur.addedBy, ...Object.fromEntries(added.map((id) => [id, me])) },
          names: { ...cur.names, [me]: getMe() || cur.names?.[me] || '' },
        }),
      })
    return added.length
  })
}

export function removeFromGroup(g: PlayerGroup, ids: string[]) {
  return db.transaction('rw', db.groups, db.outbox, async () => {
    const cur = (await db.groups.get(g.id)) ?? g
    const drop = new Set(ids)
    await save<PlayerGroup>('groups', { ...cur, playerIds: cur.playerIds.filter((id) => !drop.has(id)) })
  })
}

/**
 * Fenêtre « Mettre dans un groupe » : choisir un de ses groupes dans la liste, ou créer un nouveau
 * groupe (page de création, avec ces joueurs déjà dedans).
 * `playerIds` : les joueurs à ajouter (ceux affichés après les filtres, ou un seul joueur).
 */
export function AddToGroupDialog({ playerIds, onClose }: { playerIds: string[]; onClose: (msg?: string, groupId?: string) => void }) {
  const role = useRole()
  const nav = useNavigate()
  // Groupes Pôle (src/poleSeason.ts) : proposés à leurs dirigeants ; y ajouter = écrire une période sur la fiche
  // (entrée au 1er juillet de la saison prochaine), jamais playerIds.
  const leader = usePoleLeader()
  const refs = usePoleRefs()
  const s = useSeasons()
  const groups = useLiveQuery(
    () =>
      loadTeams().then(() =>
        db.groups
          .orderBy('name')
          .toArray()
          .then((gs) => alive(gs).filter((g) => !g.archived && (g.poleUnitId ? leader.leads(g.poleUnitId) && refs.has(g.poleUnitId) : can.editGroup(role, g) || can.contributeGroup(role, g)))),
      ),
    [role, leader, refs],
  )
  const [picked, setPicked] = useState('')
  const n = playerIds.length
  // Accord au genre des joueurs à ajouter (src/gender.ts) : « ces 3 joueuses », « cette joueuse ».
  const chosen = useLiveQuery(() => db.players.bulkGet(playerIds).then((ps) => ps.filter((p): p is Player => !!p)), [playerIds.join(',')])
  const pg = genderOf(chosen ?? [])
  const label = n > 1 ? pluralG(n, pg) : w(pg).ceJoueur
  const target = groups?.find((g) => g.id === picked)
  /** Combien des joueurs à ajouter sont déjà dans le groupe (pôle : membres de la saison prochaine). */
  const insideOf = (g: PlayerGroup) => {
    const ref = g.poleUnitId ? refs.get(g.poleUnitId) : undefined
    return ref ? (chosen ?? []).filter((p) => isMemberAt(p, ref, s.refNext)).length : playerIds.filter((id) => g.playerIds.includes(id)).length
  }
  const countOf = (g: PlayerGroup) => {
    const ref = g.poleUnitId ? refs.get(g.poleUnitId) : undefined
    return ref ? undefined : g.playerIds.length
  }

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => onClose()}>
      <div className="win flex max-h-[80dvh] w-full max-w-md flex-col gap-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm font-extrabold">Mettre {label} dans un groupe</div>
        {groups === undefined ? (
          <div className="text-xs text-muted">Chargement…</div>
        ) : groups.length ? (
          <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
            {groups.map((g) => {
              const inside = insideOf(g)
              const all = inside === n
              const total = countOf(g)
              return (
                <button
                  key={g.id}
                  disabled={all}
                  onClick={() => setPicked(g.id)}
                  className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left text-xs disabled:opacity-50 ${picked === g.id ? 'border-accent bg-accent-soft' : 'border-line bg-panel-2 hover:border-accent'}`}
                >
                  <span className={`h-3.5 w-3.5 shrink-0 rounded-full border ${picked === g.id ? 'border-accent bg-accent' : 'border-line'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">
                      <GroupMark g={g} />
                      {g.name}
                      {g.poleUnitId && <PoleChip />}
                    </span>
                    <span className="block truncate text-[10px] text-muted">
                      {all
                        ? `déjà ${w(pg).tous} dedans`
                        : [total !== undefined ? pluralG(total, g.sex) : `entrée au ${s.entry.split('-').reverse().join('/')}`, inside ? `${inside} déjà dedans` : '', g.description]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-xs text-muted">Tu n’as pas encore de groupe : crée le premier.</p>
        )}
        <button className="btn-ghost text-xs" onClick={() => (onClose(), nav('/groupes/nouveau', { state: { playerIds } }))}>
          + Nouveau groupe avec {label}…
        </button>
        <div className="flex justify-end gap-2">
          <button className="btn px-4 text-xs text-muted" onClick={() => onClose()}>
            Annuler
          </button>
          <button
            className="btn-primary px-4 text-xs"
            disabled={!target}
            onClick={async () => {
              const ref = target!.poleUnitId ? refs.get(target!.poleUnitId) : undefined
              if (ref) {
                const when = await askArrival(s, playerIds.length)
                if (!when) return
                const r = await joinPoleMany(ref, playerIds, s, undefined, when)
                return onClose(joinMessage(r, target!.name, s, pg, when), target!.id)
              }
              const added = await addToGroup(target!, playerIds)
              onClose(added ? `${pluralG(added, pg, 'joueur ajouté')} à « ${target!.name} ».` : `Déjà dans « ${target!.name} ».`, target!.id)
            }}
          >
            Ajouter
          </button>
        </div>
      </div>
    </div>
  )
}

/** Message de confirmation, avec un lien vers le groupe. */
export function GroupNotice({ msg, groupId }: { msg: string; groupId?: string }) {
  if (!msg) return null
  return (
    <p className="text-[11px] text-emerald-300">
      {msg}{' '}
      {groupId && (
        <Link to={`/groupes/${groupId}`} className="font-bold underline">
          Ouvrir le groupe
        </Link>
      )}
    </p>
  )
}

/** Groupes d'un joueur, en pastilles (fiche joueur). */
export function PlayerGroups({ playerId }: { playerId: string }) {
  const role = useRole()
  // Groupes Pôle : membre si une période de ce pôle couvre aujourd'hui ou le 1er septembre prochain (src/poleSeason.ts).
  const refs = usePoleRefs()
  const s = useSeasons()
  const groups = useLiveQuery(
    async () => {
      await loadTeams()
      const p = await db.players.get(playerId)
      const member = (g: PlayerGroup) => {
        const ref = g.poleUnitId ? refs.get(g.poleUnitId) : undefined
        return ref ? !!p && (isMemberAt(p, ref, s.refCurrent) || isMemberAt(p, ref, s.refNext)) : g.playerIds.includes(playerId)
      }
      return alive(await db.groups.toArray()).filter((g) => !g.archived && can.seeGroup(g) && member(g))
    },
    [playerId, refs, s.refCurrent, s.refNext],
    [] as PlayerGroup[],
  )
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState<{ text: string; groupId?: string }>({ text: '' })
  if (!groups.length && !can.manageGroups(role)) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold tracking-wider text-muted uppercase">Groupes</span>
        {groups.map((g) => (
          <Link key={g.id} to={`/groupes/${g.id}`} className="rounded-full border border-accent/50 bg-accent-soft px-2.5 py-0.5 text-[11px] font-bold hover:border-accent">
            <GroupMark g={g} />
            {g.name}
            {g.poleUnitId && <PoleChip className="ml-1" />}
          </Link>
        ))}
        {!groups.length && <span className="text-[11px] text-muted">aucun</span>}
        {can.manageGroups(role) && !adding && (
          <button className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-[11px] text-muted hover:text-fg" onClick={() => (setAdding(true), setMsg({ text: '' }))}>
            + Ajouter à un groupe
          </button>
        )}
      </div>
      {adding && <AddToGroupDialog playerIds={[playerId]} onClose={(text, groupId) => (setAdding(false), setMsg({ text: text ?? '', groupId }))} />}
      <GroupNotice msg={msg.text} />
    </div>
  )
}
