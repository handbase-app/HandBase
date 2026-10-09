import { useEffect, useState } from 'react'
import type { PlayerGroup } from '../db'
import { ROLE_LABEL, type Role } from '../roles'
import { spyTarget } from '../spy'
import { supabase, syncAndForgetHidden } from '../sync'
import { ask, inform } from './Confirm'
import { fold } from './PlayerFilter'
import { Icon } from './ui'

/*
 * « Réattribuer… » (administrateurs) : le groupe passe à un autre compte comme s'il l'avait créé
 * (supabase/038_reattribuer_groupe.sql, hb_transfer_group). Se fait sur le serveur : en ligne uniquement.
 */

interface Member {
  user_id: string
  full_name: string | null
  email: string | null
  role: Role | null
}

/** Proposé à un administrateur (pas pendant « Voir comme… ») : sur un groupe qu’il voit, ou sur celui d’un autre ouvert par « Voir tous les groupes » (039). */
export const canTransferGroup = (role: Role) => role === 'admin' && !spyTarget()

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOn(true)
    const down = () => setOn(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return on
}

const label = (m: Member) => m.full_name || m.email || 'Sans nom'

/**
 * foreign : groupe privé ou « Mon staff » d'un autre, ouvert par « Voir tous les groupes » (supabase/039) : il n'est
 * pas sur cet appareil, rien à y effacer. onDone : après une réattribution réussie.
 */
export function TransferGroup({
  g,
  onClose,
  onHidden,
  onDone,
  foreign = false,
}: {
  g: Pick<PlayerGroup, 'id' | 'name' | 'private' | 'team' | 'createdBy' | 'createdByName'>
  onClose: () => void
  onHidden: () => void
  onDone?: () => void
  foreign?: boolean
}) {
  const online = useOnline()
  const [list, setList] = useState<Member[] | null>(null)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [to, setTo] = useState<string | null>(null)
  const [keepOld, setKeepOld] = useState(false)
  const [busy, setBusy] = useState(false)
  const ready = !!supabase && online

  useEffect(() => {
    if (!supabase || !online || list) return
    void supabase.rpc('hb_members').then(({ data, error }) => {
      if (error) setErr(`Liste du staff indisponible : ${error.message}`)
      else setList((data as Member[]).filter((m) => !!m.role))
    })
  }, [online, list])

  const owner = list?.find((m) => m.user_id === g.createdBy)
  const ownerName = owner ? label(owner) : (g.createdByName ?? 'l’ancien propriétaire')
  // Les participants sont toujours des encadrants (supabase/023) : l'ancien propriétaire ne reste que s'il en est un.
  const canKeep = !g.private && !!g.createdBy && owner?.role === 'preparateur'
  const words = fold(search).split(/\s+/).filter(Boolean)
  const choices = (list ?? []).filter((m) => m.user_id !== g.createdBy && words.every((w) => fold(`${label(m)} ${m.email ?? ''}`).includes(w)))
  // Un observateur ne possède que des groupes privés.
  const allowed = (m: Member) => g.private || m.role !== 'observateur'
  const target = list?.find((m) => m.user_id === to)

  async function submit() {
    if (!supabase || !target) return
    const kept = keepOld && canKeep
    const lose = foreign
      ? ''
      : g.private
      ? ' Groupe privé : tu ne le verras plus, il disparaîtra de cet appareil.'
      : g.team
        ? ' Groupe « Mon staff » : tu n’y auras plus accès, sauf si tu en es participant.'
        : ''
    if (
      !(await ask(
        `Confier le groupe « ${g.name} » à ${label(target)} ? Il en devient propriétaire, comme s’il l’avait créé.${kept ? ` ${ownerName} reste participant.` : ''}${lose}`,
        { ok: 'Réattribuer', danger: false },
      ))
    )
      return
    setBusy(true)
    const { data, error } = await supabase.rpc('hb_transfer_group', { p_group: g.id, p_to: target.user_id, p_keep_old: kept })
    setBusy(false)
    if (error)
      return inform(
        error.code === 'PGRST202'
          ? 'Réattribution pas encore disponible sur le serveur : exécute d’abord supabase/038_reattribuer_groupe.sql (et 039 pour les groupes des autres) dans Supabase.'
          : `Réattribution impossible : ${error.message}`,
      )
    const visible = (data as { visible?: boolean } | null)?.visible !== false
    onDone?.()
    if (!visible) onHidden()
    else onClose()
    // Version du serveur ramenée tout de suite ; groupe devenu invisible : effacé de l'appareil.
    void syncAndForgetHidden()
    await inform(`Groupe « ${g.name} » confié à ${label(target)}.`)
  }

  return (
    <div className="card flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-bold">
          <Icon name="user" className="h-4 w-4 text-muted" />
          Réattribuer le groupe
        </div>
        <button className="text-muted hover:text-fg" aria-label="Fermer" onClick={onClose}>
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[11px] text-muted">
        La personne choisie devient propriétaire du groupe, comme si elle l’avait créé : elle le modifie, le supprime et choisit ses participants.
        {g.createdByName && (
          <>
            {' '}
            Propriétaire actuel : <b className="text-fg">{g.createdByName}</b>.
          </>
        )}
      </p>
      {!supabase ? (
        <p className="text-[11px] text-amber-300">Réattribuer se fait sur le serveur : indisponible dans cette version sans serveur.</p>
      ) : !online ? (
        <p className="text-[11px] text-amber-300">Hors ligne : réattribuer se fait sur le serveur. Réessaie une fois connecté.</p>
      ) : err ? (
        <p className="text-[11px] text-red-300">{err}</p>
      ) : !list ? (
        <p className="text-[11px] text-muted">Chargement du staff…</p>
      ) : (
        <>
          <input className="field py-1.5 text-xs" placeholder="Chercher un nom…" autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex max-h-56 flex-col overflow-y-auto rounded-md border border-line bg-panel p-1">
            {choices.map((m) => (
              <label
                key={m.user_id}
                className={`flex items-center gap-2 rounded px-1.5 py-1.5 text-xs ${allowed(m) ? 'cursor-pointer hover:bg-panel-2' : 'opacity-50'}`}
                title={allowed(m) ? undefined : 'Un observateur ne peut recevoir qu’un groupe privé'}
              >
                <input
                  type="radio"
                  name="transfer-to"
                  className="h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                  disabled={!allowed(m)}
                  checked={to === m.user_id}
                  onChange={() => setTo(m.user_id)}
                />
                <span className="min-w-0 flex-1 truncate">{label(m)}</span>
                <span className="shrink-0 text-[10px] text-muted">
                  {m.role && ROLE_LABEL[m.role]}
                  {!allowed(m) && ' · groupe privé seulement'}
                </span>
              </label>
            ))}
            {!choices.length && <p className="px-1.5 py-1 text-[11px] text-muted">Personne ne correspond.</p>}
          </div>
        </>
      )}
      {!g.private && g.createdBy && (
        <label className={`flex items-start gap-2 text-xs ${canKeep ? '' : 'opacity-50'}`}>
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" disabled={!canKeep} checked={keepOld && canKeep} onChange={(e) => setKeepOld(e.target.checked)} />
          <span>
            Garder l’ancien propriétaire ({ownerName}) comme participant
            {list && !canKeep && <span className="block text-[10px] text-muted">Seulement si c’est un encadrant (les participants sont des encadrants).</span>}
          </span>
        </label>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={onClose}>
          Annuler
        </button>
        <button className="btn-primary px-3 py-1.5 text-xs" disabled={!ready || !target || !allowed(target) || busy} onClick={() => void submit()}>
          {busy ? 'Réattribution…' : 'Réattribuer'}
        </button>
      </div>
    </div>
  )
}
