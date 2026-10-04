import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { alive, db, fmtDate, type Player } from '../db'
import { keepFirst, mergePlayers, mergePreview } from '../merge'
import { ask } from './Confirm'
import { department, departmentLabel, fold } from './PlayerFilter'
import { ReviewBadge } from './Review'

/**
 * Fusion de la fiche affichée avec une autre (doublon, fiche proposée qui a obtenu une licence…).
 * On choisit la fiche à garder ; l'autre y est fondue (avis, mesures, événements).
 */
export function MergePlayers({ player, otherId, onClose }: { player: Player; otherId?: string; onClose: () => void }) {
  const nav = useNavigate()
  const players = useLiveQuery(() => db.players.toArray().then(alive), [], [])
  const [q, setQ] = useState('')
  const [other, setOther] = useState<Player | undefined>()
  const [keep, setKeep] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Autre fiche passée en paramètre (lien « Comparer et fusionner »).
  useEffect(() => {
    if (otherId && !other) {
      const o = players.find((p) => p.id === otherId)
      if (o) choose(o)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherId, players])

  function choose(o: Player) {
    setOther(o)
    setKeep(keepFirst(player, o)[0].id)
    setQ('')
  }

  const target = other && (keep === player.id ? player : other)
  const source = other && (keep === player.id ? other : player)
  const preview = useLiveQuery(() => (source ? mergePreview(source.id) : undefined), [source?.id])

  const words = fold(q).split(/\s+/).filter(Boolean)
  const matches = words.length
    ? players
        .filter((p) => p.id !== player.id && words.every((w) => fold(`${p.firstName} ${p.lastName} ${p.club ?? ''} ${p.license ?? ''}`).includes(w)))
        .slice(0, 12)
    : []

  async function run() {
    if (!source || !target) return
    if (
      !(await ask(
        `Fondre la fiche « ${source.firstName} ${source.lastName} » dans « ${target.firstName} ${target.lastName} » ? La première sera supprimée. On ne peut pas revenir en arrière.`,
        { ok: 'Fusionner' },
      ))
    )
      return
    setBusy(true)
    setErr('')
    const e = await mergePlayers(source.id, target.id)
    setBusy(false)
    if (e) return setErr(e)
    onClose()
    nav(`/joueurs/${target.id}`, { replace: true })
  }

  return (
    <div className="card flex flex-col gap-3 border-accent/60 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-extrabold tracking-wider uppercase">Fusionner deux fiches</div>
        <button className="text-xs text-muted" onClick={onClose}>
          Fermer
        </button>
      </div>

      {!other ? (
        <>
          <p className="text-[11px] text-muted">Cherche l’autre fiche du même joueur (doublon, fiche proposée qui a obtenu une licence…).</p>
          <input className="field" autoFocus placeholder="Nom, prénom, club ou licence…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex flex-col gap-1">
            {matches.map((p) => (
              <button key={p.id} className="rounded-md border border-line px-3 py-1.5 text-left text-xs hover:border-accent" onClick={() => choose(p)}>
                <b>
                  {p.lastName.toUpperCase()} {p.firstName}
                </b>
                <span className="text-muted"> · {summary(p)}</span>
              </button>
            ))}
            {words.length > 0 && matches.length === 0 && <p className="text-[11px] text-muted">Aucune fiche trouvée.</p>}
          </div>
        </>
      ) : (
        <>
          <p className="text-[11px] text-muted">Quelle fiche garder ? L’autre y sera fondue puis supprimée.</p>
          <div className="grid grid-cols-2 gap-2">
            {[player, other].map((p) => (
              <button
                key={p.id}
                onClick={() => setKeep(p.id)}
                className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left text-xs ${keep === p.id ? 'border-accent bg-accent/10' : 'border-line'}`}
              >
                <span className="text-[10px] font-bold text-muted">{keep === p.id ? '✓ À GARDER' : 'À FONDRE'}</span>
                <b>
                  {p.lastName.toUpperCase()} {p.firstName}
                </b>
                <ReviewBadge e={p} kind="players" />
                <span className="text-[10px] text-muted">{summary(p)}</span>
              </button>
            ))}
          </div>
          {preview && source && target && (
            <div className="rounded-md border border-line bg-panel-2 p-2.5 text-[11px]">
              Passeront sur la fiche gardée : <b>{preview.evaluations}</b> avis, <b>{preview.measurements}</b> mesure(s),{' '}
              <b>{preview.events}</b> événement(s) mis à jour. Les informations manquantes de la
              fiche gardée sont complétées par l’autre, sans rien écraser
              {source.review === 'refused' ? ' ; la mise hors cadre de la fiche fondue reste dans son historique (vue « Ratés »)' : ''}.
            </div>
          )}
          {err && <p className="text-[11px] text-red-300">{err}</p>}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={busy} onClick={() => void run()}>
              {busy ? 'Fusion…' : 'Fusionner'}
            </button>
            <button className="btn text-muted" onClick={() => setOther(undefined)}>
              Changer
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function summary(p: Player) {
  const d = department(p)
  return (
    [p.birthDate && fmtDate(p.birthDate), p.club, d && departmentLabel(d), p.license ? `licence ${p.license}` : 'sans licence']
      .filter(Boolean)
      .join(' · ') || '—'
  )
}
