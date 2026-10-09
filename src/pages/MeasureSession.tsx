import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ask, inform, setLeaveGuard, useUnsaved } from '../components/Confirm'
import { CriterionInput, fmtValue, getMe, groupBy, QuarterBadge } from '../components/ui'
import { alive, criterionApplies, db, fmtDate, newId, plural, saveMany, today, type Measurement } from '../db'
import { can, useRole } from '../roles'
import { latestByPlayer } from './Players'

const OPEN_KEY = 'handbase.mesures.open'
const readOpen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

/**
 * Séance de tests d'un joueur, sur sa propre page : une date, des sections repliables par catégorie
 * (celles ouvertes la dernière fois le sont de nouveau, pratique pour enchaîner les joueurs), tout est
 * enregistré ensemble à la même date.
 */
export default function MeasureSession() {
  const { id } = useParams()
  const nav = useNavigate()
  const role = useRole()
  const data = useLiveQuery(async () => {
    const player = await db.players.get(id!)
    if (!player) return null
    const [criteria, measurements] = await Promise.all([
      db.criteria.orderBy('order').toArray().then(alive),
      db.measurements.where('playerId').equals(id!).toArray().then(alive),
    ])
    return { player, criteria, measurements }
  }, [id])
  const [values, setValues] = useState<Record<string, number | string | undefined>>({})
  const [date, setDate] = useState(today())
  const [open, setOpenState] = useState<string[]>(readOpen)
  const [busy, setBusy] = useState(false)
  // Saisie en cours : on prévient avant de quitter l'écran (menu du bas) ou l'onglet.
  const pending = busy ? 0 : Object.values(values).filter((v) => v !== undefined && v !== '').length
  const leaveRef = useRef<() => Promise<boolean>>(async () => true)
  useEffect(() => {
    leaveRef.current = async () => !pending || ask(`Abandonner ${pending > 1 ? `les ${pending} mesures saisies` : 'la mesure saisie'} ?`, { ok: 'Abandonner' })
  }, [pending])
  useEffect(() => {
    setLeaveGuard(() => leaveRef.current())
    return () => setLeaveGuard(null)
  }, [])
  useUnsaved(pending > 0)

  if (data === undefined) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (data === null || data.player.deleted) return <div className="py-20 text-center text-sm text-muted">Joueur introuvable.</div>
  if (!can.editMeasurements(role)) return <div className="py-20 text-center text-sm text-muted">Saisie réservée aux encadrants.</div>

  const { player: p, criteria, measurements } = data
  const latest = latestByPlayer(measurements).get(p.id)
  const sections = groupBy(
    criteria.filter((c) => c.kind === 'factual' && c.active !== false && criterionApplies(c, p.position)),
    (c) => c.category,
  )
  const filled = Object.entries(values).filter(([, v]) => v !== undefined && v !== '')
  const back = () => nav(`/joueurs/${p.id}?onglet=tests`, { replace: true })

  const toggle = (cat: string) => {
    const next = open.includes(cat) ? open.filter((x) => x !== cat) : [...open, cat]
    setOpenState(next)
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next))
    } catch {
      /* stockage indisponible */
    }
  }

  async function saveAll() {
    if (!filled.length) return
    if (!date) return inform('Indique la date de la séance de tests.')
    setBusy(true)
    const author = getMe() || undefined
    try {
      // Toute la séance en une seule transaction : tout est enregistré, ou rien.
      await saveMany<Measurement>(
        'measurements',
        filled.map(([criterionId, value]) => ({ id: newId(), playerId: p.id, criterionId, value: value!, date, author })),
      )
    } catch (e) {
      setBusy(false)
      return inform(`Mesures non enregistrées : ${e instanceof Error ? e.message : e}`)
    }
    back()
  }

  async function cancel() {
    if (filled.length && !(await ask(`Abandonner ${filled.length > 1 ? `les ${plural(filled.length, 'mesure')} saisies` : 'la mesure saisie'} ?`, { ok: 'Abandonner' }))) return
    back()
  }

  return (
    <div className="flex flex-col gap-3 pb-16">
      <button onClick={() => void cancel()} className="self-start text-xs font-bold text-muted">
        ← {p.lastName.toUpperCase()} {p.firstName}
      </button>
      <div>
        <h1 className="text-lg font-extrabold">Séance de tests</h1>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          {p.lastName.toUpperCase()} {p.firstName}
          <QuarterBadge birthDate={p.birthDate} />
        </div>
      </div>

      <div className="card flex items-center justify-between gap-3 p-3">
        <span className="text-[11px] text-muted">Remplis seulement ce qui a été mesuré : tout est enregistré à cette date.</span>
        <input type="date" required className="field w-40 shrink-0" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {sections.map(([cat, cs]) => {
        const isOpen = open.includes(cat)
        const n = cs.filter((c) => values[c.id] !== undefined && values[c.id] !== '').length
        return (
          <div key={cat} className={`card overflow-hidden ${isOpen ? 'border-accent/50' : ''}`}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => toggle(cat)}>
              <span className="flex-1 text-sm font-bold">{cat}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${n ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
                {n}/{cs.length}
              </span>
              <span className={`text-muted transition ${isOpen ? 'rotate-90' : ''}`}>›</span>
            </button>
            {isOpen && (
              <div className={`grid gap-3 border-t border-line p-4 ${cs.every((c) => c.scale === 'number') ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {cs.map((c) => {
                  const last = latest?.get(c.id)
                  return (
                    <div key={c.id} className={c.scale === 'number' ? '' : 'flex items-center justify-between gap-3'}>
                      <div>
                        <span className={c.scale === 'number' ? 'label mb-0' : 'text-xs font-bold'} title={c.description}>
                          {c.label}
                        </span>
                        {/* Dernière valeur : repère pour éviter une faute de frappe (ligne de hauteur fixe : les champs restent alignés). */}
                        <div className="mb-1 h-4 truncate text-[10px] leading-4 text-muted">
                          {last ? `dernière : ${fmtValue(c, last.value)} · ${fmtDate(last.date).slice(0, 6)}${last.date.slice(2, 4)}` : 'aucune mesure'}
                        </div>
                      </div>
                      <CriterionInput c={c} value={values[c.id]} onChange={(v) => setValues((x) => ({ ...x, [c.id]: v }))} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      {/* Enregistrer : toujours visible, collé au-dessus de la barre du bas. */}
      <div className="sticky bottom-[var(--nav-b)] z-10 -mx-4 flex gap-2 border-t border-line bg-bg px-4 py-2">
        <button className="btn-ghost" onClick={() => void cancel()}>
          Annuler
        </button>
        <button className="btn-primary flex-1 shadow-lg" disabled={!filled.length || !date || busy} onClick={() => void saveAll()}>
          {!date ? 'Date de la séance manquante' : filled.length > 1 ? `Enregistrer les ${filled.length} mesures` : filled.length ? 'Enregistrer la mesure' : 'Aucune mesure saisie'}
        </button>
      </div>
    </div>
  )
}
