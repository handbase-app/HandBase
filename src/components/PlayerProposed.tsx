import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, fmtDate, dayOf, type HBEvent } from '../db'
import { w } from '../gender'
import { updateSync } from '../matchSync'
import { proposedOf, type ProposedBy } from '../playerMatches'
import { decideProposal, loadProposedMarks, type ProposedMarks } from '../playerMatchesApi'
import { can, useRole } from '../roles'
import { syncNow } from '../sync'
import { ask, inform } from './Confirm'

/*
 * Côté STAFF de « Mes matchs » (supabase/053_matchs_joueur.sql) : ce qu'un jeune a ajouté depuis son espace porte une petite
 * marque neutre « Proposé par le joueur / la joueuse » ; le staff garde la main :
 *  - « Reprendre à mon compte » : il en devient l'auteur (il le modifie et le supprime ensuite comme le sien) ;
 *  - « Retirer » : suppression, comme dans l'appli.
 * Administrateur, ou encadrant qui a le droit de modifier la fiche du jeune (le serveur vérifie : hb_player_proposal).
 * Repères proposés sur la vidéo d'un match (séquenceur du jeune) : lus à part, repris dans le calage du staff sur demande ;
 * ceux du staff priment toujours.
 */

/** Le nom de la marque, accordé au sexe de la fiche du jeune (masculin si inconnu). */
function useProposedLabel(pb: ProposedBy | undefined) {
  const p = useLiveQuery(async () => (pb ? db.players.get(pb.playerId) : undefined), [pb?.playerId])
  return `Proposé par ${w(p?.sex ?? null).leJoueur}`
}

/** Petite marque neutre sur une ligne (événement, lien vidéo) proposée par un jeune ; rien sinon. */
export function ProposedBadge({ row, className = '' }: { row: unknown; className?: string }) {
  const pb = proposedOf(row)
  const label = useProposedLabel(pb)
  if (!pb) return null
  return (
    <span
      className={`inline-block rounded-full border border-line bg-panel-2 px-1.5 py-px align-middle text-[9px] font-bold text-muted ${className}`}
      title={`${label} depuis son espace joueur${pb.at ? `, le ${fmtDate(dayOf(pb.at))}` : ''}. Le staff peut le reprendre ou le retirer.`}
    >
      {label}
    </span>
  )
}

/** Peut-il décider (règle de l'appli ; le serveur vérifie le périmètre) ? */
const canDecide = (role: string) => role === 'admin' || role === 'preparateur'

/** Bandeau d'un événement ou d'un lien vidéo proposé : marque, « Reprendre à mon compte », « Retirer ». */
export function ProposalBar({ table, row }: { table: 'events' | 'videos'; row: { id: string } }) {
  const role = useRole()
  const pb = proposedOf(row)
  const label = useProposedLabel(pb)
  const [busy, setBusy] = useState(false)
  if (!pb) return null
  const what = table === 'events' ? 'ce match' : 'ce lien vidéo'
  async function run(action: 'adopt' | 'remove') {
    const ok = await ask(
      action === 'adopt'
        ? `Reprendre ${what} à ton compte ? Tu en deviens l’auteur : tu pourras le modifier ou le supprimer. La marque « ${label.toLowerCase()} » disparaît.`
        : `Retirer ${what} ? ${table === 'events' ? 'Il disparaît des matchs du jeune et de l’appli.' : 'Le lien disparaît du match.'}`,
      { ok: action === 'adopt' ? 'Reprendre' : 'Retirer', danger: action === 'remove' },
    )
    if (!ok) return
    setBusy(true)
    const r = await decideProposal(table, row.id, action)
    setBusy(false)
    if (!r.ok) return void inform(`Impossible : ${r.error}`)
    void syncNow()
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]" data-testid="propose-par-joueur">
      <ProposedBadge row={row} />
      {canDecide(role) && (
        <>
          <button className="font-bold text-accent hover:underline disabled:opacity-50" disabled={busy} onClick={() => void run('adopt')}>
            Reprendre à mon compte
          </button>
          <button className="text-muted hover:text-red-400 disabled:opacity-50" disabled={busy} onClick={() => void run('remove')}>
            Retirer
          </button>
        </>
      )}
    </div>
  )
}

/**
 * Repères proposés par les jeunes sur la vidéo d'un match (séquenceur de l'espace joueur) : qui, combien ; « Reprendre dans
 * le calage » les ajoute à celui du staff là où il n'a rien posé (le staff prime). Rien à montrer : rien d'affiché.
 */
export function PlayerMarksCard({ ev }: { ev: HBEvent }) {
  const role = useRole()
  const [rows, setRows] = useState<ProposedMarks[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    let live = true
    void loadProposedMarks(ev.id).then((r) => live && r.ok && setRows(r.value))
    return () => {
      live = false
    }
  }, [ev.id])
  const video = useLiveQuery(async () => {
    const ids = [...new Set(rows.map((r) => r.videoId))]
    return ids.length ? new Map((await db.videos.bulkGet(ids)).flatMap((v) => (v ? [[v.id, v] as const] : []))) : new Map()
  }, [rows.map((r) => r.videoId).join(',')])
  if (!rows.length || !ev.matchSheet) return null
  const calib = can.calibrateMatch(role, { eventId: ev.id })

  async function take(r: ProposedMarks) {
    const v = video?.get(r.videoId)
    if (!v) return setMsg('La vidéo de ces repères n’est pas (ou plus) sur cet appareil.')
    const sync = ev.matchSheet?.sync
    if (sync && (sync.videoId ?? '') !== v.id && Object.keys(sync.marks ?? {}).length + Object.keys(sync.fix ?? {}).length > 0)
      return setMsg('Le calage du staff porte sur une autre vidéo : rien n’est repris.')
    setBusy(true)
    try {
      let added = 0
      await updateSync(ev.id, (s) => {
        const marks = { ...s.marks }
        const fix = { ...s.fix }
        for (const [k, t] of Object.entries(r.marks)) {
          if (marks[k] !== undefined) continue
          marks[k] = t
          added++
        }
        for (const [k, t] of Object.entries(r.fix)) {
          if (fix[k] !== undefined) continue
          fix[k] = t
          added++
        }
        return { ...s, videoId: v.id, url: v.url, marks, fix }
      })
      setMsg(added ? `${added} repère${added > 1 ? 's' : ''} repris dans le calage.` : 'Rien de nouveau : le calage du staff a déjà tout.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card p-4" data-testid="reperes-proposes">
      <div className="section-title">Repères proposés depuis l’espace joueur</div>
      <p className="mb-2 text-[11px] text-muted">Posés par les jeunes sur la vidéo du match, pour leurs propres actions. Le calage du staff prime toujours.</p>
      <ul className="flex flex-col gap-1.5 text-xs">
        {rows.map((r) => (
          <li key={r.playerId} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              <b>{r.name || 'Joueur'}</b>{' '}
              <span className="text-muted">
                · {Object.keys(r.marks).length} borne{Object.keys(r.marks).length > 1 ? 's' : ''}, {Object.keys(r.fix).length} action
                {Object.keys(r.fix).length > 1 ? 's' : ''}
                {r.updatedAt ? ` · ${fmtDate(dayOf(r.updatedAt))}` : ''}
              </span>
            </span>
            {calib && (
              <button className="btn-ghost px-3 py-1 text-[11px]" disabled={busy} onClick={() => void take(r)}>
                Reprendre dans le calage
              </button>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className="mt-2 text-[11px] text-emerald-300">{msg}</p>}
    </div>
  )
}
