import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { StampLine } from '../components/ActivityLog'
import { MaturityCard } from '../components/MaturityCard'
import { Opinions } from '../components/Opinions'
import { department, departmentLabel } from '../components/PlayerFilter'
import { MergePlayers } from '../components/MergePlayers'
import { Referents } from '../components/Referents'
import { possibleDuplicates } from '../merge'
import { expiryDate } from '../purge'
import { ReviewActions, ReviewBadge, ReviewNote } from '../components/Review'
import { Avatar, CriterionInput, fmtValue, getMe, groupBy, PosBadge } from '../components/ui'
import { age, alive, criterionApplies, db, fmtDate, newId, remove, save, today, type Criterion, type Measurement, type Position } from '../db'
import { latestByPlayer } from './Players'
import { ask } from '../components/Confirm'
import { can, useRole } from '../roles'

export default function PlayerDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const role = useRole()
  // ?fusion=<id> : ouvre la fusion avec cette autre fiche (lien « Comparer et fusionner »).
  const [params, setParams] = useSearchParams()
  const mergeWith = params.get('fusion')
  const [merging, setMerging] = useState(false)
  const data = useLiveQuery(async () => {
    const player = await db.players.get(id!)
    if (!player) return null
    const [criteria, measurements, evaluations, events, homonyms] = await Promise.all([
      db.criteria.orderBy('order').toArray().then(alive),
      db.measurements.where('playerId').equals(id!).toArray().then(alive),
      db.evaluations.where('playerId').equals(id!).toArray().then(alive),
      db.events.toArray(), // y compris supprimés : leurs avis gardent le nom de l'événement
      db.players.where('lastName').equalsIgnoreCase(player.lastName).toArray().then(alive),
    ])
    // Doublons possibles de cette fiche (même nom, naissance compatible, l'une proposée ou sans licence).
    const duplicates = possibleDuplicates(homonyms)
      .filter(([a, b]) => a.id === player.id || b.id === player.id)
      .map(([a, b]) => (a.id === player.id ? b : a))
    return { player, criteria, measurements, evaluations, events, duplicates }
  }, [id])

  if (data === undefined) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (data?.player.mergedInto)
    return (
      <div className="py-20 text-center text-sm text-muted">
        Cette fiche a été fusionnée avec une autre.
        <br />
        <Link to={`/joueurs/${data.player.mergedInto}`} replace className="mt-3 inline-block font-bold text-accent">
          Voir la fiche du joueur →
        </Link>
      </div>
    )
  if (data === null || data.player.deleted) return <div className="py-20 text-center text-sm text-muted">Joueur introuvable.</div>

  const { player: p, criteria, measurements, evaluations, events } = data
  const latest = latestByPlayer(measurements).get(p.id) ?? new Map<string, Measurement>()
  const factual = criteria.filter((c) => c.kind === 'factual')
  const subjective = criteria.filter((c) => c.kind === 'subjective' && criterionApplies(c, p.position))
  const a = age(p.birthDate)

  const info: [string, string | undefined][] = [
    ['Sexe', p.sex === 'M' ? 'Garçon' : p.sex === 'F' ? 'Fille' : undefined],
    ['Club', p.club],
    ['Département', department(p) && departmentLabel(department(p)!)],
    ['Équipe', p.team],
    ['Catégorie / niveau', p.category],
    ['Nationalité', p.nationality],
    ['Licence', p.license && `${p.license}${p.licenseStatus ? ` (${p.licenseStatus.toLowerCase().replace(/_/g, ' ')})` : ''}`],
    ['Type de licence', p.licenseRequestType && p.licenseRequestType.charAt(0) + p.licenseRequestType.slice(1).toLowerCase()],
    ['Anciennes licences', p.previousLicenses?.join(', ')],
    ['Internat', p.boarding === true ? 'Oui' : p.boarding === false ? 'Non' : undefined],
    ['Naissance', p.birthDate && fmtDate(p.birthDate)],
    ['Taille', latest.get('taille') && fmtValue(factual.find((c) => c.id === 'taille'), latest.get('taille')!.value)],
    ['Poids', latest.get('poids') && fmtValue(factual.find((c) => c.id === 'poids'), latest.get('poids')!.value)],
    ['Latéralité', p.laterality && p.laterality[0].toUpperCase() + p.laterality.slice(1)],
    ['Taille de la mère', p.motherHeight !== undefined ? `${p.motherHeight} cm (${p.motherHeightSource === 'mesuree' ? 'mesurée' : 'déclarée'})` : undefined],
    ['Taille du père', p.fatherHeight !== undefined ? `${p.fatherHeight} cm (${p.fatherHeightSource === 'mesuree' ? 'mesurée' : 'déclarée'})` : undefined],
  ]

  const testGroups = groupBy(
    factual.filter((c) => c.category !== 'Gabarit' && latest.has(c.id)),
    (c) => c.category,
  )

  async function del() {
    if (!(await ask(`Supprimer la fiche de ${p.firstName} ${p.lastName} ?`, { ok: 'Supprimer' }))) return
    await remove('players', p.id)
    nav('/joueurs', { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button onClick={() => nav('/joueurs')} className="text-xs font-bold text-muted">
          ← JOUEURS
        </button>
        {can.deletePlayers(role) && (
        <button onClick={() => void del()} className="text-muted hover:text-red-400" title="Supprimer">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
          </svg>
        </button>
        )}
      </div>

      <div className="flex items-center gap-4">
        <Avatar p={p} size={64} />
        <div>
          <h1 className="text-lg font-extrabold">
            {p.firstName} {p.lastName}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <PosBadge pos={p.position} />
            {a !== null && <span>{a} ans</span>}
          </div>
          <StampLine row={p} />
        </div>
      </div>

      {p.review && p.review !== 'validated' && (
        <div className={`rounded-lg border p-3 text-xs ${p.review === 'pending' ? 'border-amber-500/40 bg-amber-500/10' : 'border-line bg-panel'}`}>
          <div className="flex items-center justify-between gap-2">
            <ReviewBadge e={p} kind="players" />
            {p.createdByName && <span className="text-[10px] text-muted">Proposée par {p.createdByName}</span>}
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {p.review === 'pending'
              ? 'Fiche proposée par un observateur : à valider par un encadrant.'
              : 'Fiche mise hors cadre : gardée pour mémoire, pour voir plus tard ce que le joueur est devenu.'}{' '}
            {/* RGPD (supabase/012_expiration_rgpd.sql). */}
            {p.review === 'pending' && expiryDate(p.createdAtServer) && (
              <>Sans décision, elle sera effacée (avec ses avis et référents) le {fmtDate(expiryDate(p.createdAtServer))}.</>
            )}
            {p.review === 'refused' && expiryDate(p.reviewedAt) && <>Ses adultes référents seront effacés le {fmtDate(expiryDate(p.reviewedAt))}.</>}
          </p>
          <ReviewNote e={p} />
          {can.reviewDept(role, department(p)) ? (
            <ReviewActions e={p} kind="players" compact={p.review === 'refused'} />
          ) : (
            can.review(role) && <p className="mt-1 text-[10px] text-muted">Hors de ton secteur : c’est au responsable du département de décider.</p>
          )}
        </div>
      )}
      {p.review === 'validated' && <ReviewNote e={p} />}

      {can.editPlayers(role) && !merging && !mergeWith && data.duplicates.length > 0 && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-xs">
          <b>Doublon possible :</b>{' '}
          {data.duplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <Link to={`/joueurs/${d.id}`} className="font-bold underline">
                {d.firstName} {d.lastName}
              </Link>
              {d.license ? ' (licencié)' : d.review === 'refused' ? ' (hors cadre)' : d.review === 'pending' ? ' (proposée)' : ''}{' '}
              <button className="font-bold text-accent" onClick={() => setParams({ fusion: d.id }, { replace: true })}>
                Comparer et fusionner
              </button>
            </span>
          ))}
        </div>
      )}
      {can.editPlayers(role) && (merging || mergeWith) && (
        <MergePlayers
          player={p}
          otherId={mergeWith ?? undefined}
          onClose={() => {
            setMerging(false)
            setParams({}, { replace: true })
          }}
        />
      )}

      <div className="card divide-y divide-line">
        {info
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex justify-between px-4 py-2 text-xs">
              <span className="text-muted">{k}</span>
              <span className="font-bold">{v}</span>
            </div>
          ))}
      </div>

      {/* Données factuelles */}
      {testGroups.map(([cat, cs]) => (
        <div key={cat} className="card p-4">
          <div className="section-title">{cat}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {cs.map((c) => (
              <div key={c.id}>
                <div className="text-[10px] text-muted">{c.label}</div>
                <div className="text-sm font-extrabold">{fmtValue(c, latest.get(c.id)!.value)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <MaturityCard player={p} measurements={measurements} />

      <Tracking playerId={p.id} position={p.position} criteria={factual} measurements={measurements} editable={can.editMeasurements(role)} />

      {/* Avis subjectifs */}
      <div className="card p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase">
          <span className="text-accent">★</span> Avis des observateurs
        </div>
        <Opinions player={p} criteria={subjective} evaluations={evaluations} events={events} />
      </div>

      {p.gaps && (
        <div className="card p-4">
          <div className="section-title text-amber-300">Lacunes mobilité / souplesse</div>
          <div className="text-sm">{p.gaps}</div>
        </div>
      )}
      {p.notes && (
        <div className="card p-4">
          <div className="section-title">Notes</div>
          <div className="text-sm whitespace-pre-wrap">{p.notes}</div>
        </div>
      )}

      <Referents playerId={p.id} />

      {p.mergedFrom && p.mergedFrom.length > 0 && (
        <div className="card p-4">
          <div className="section-title">Fiches fondues dans celle-ci</div>
          <div className="flex flex-col gap-2 text-[11px]">
            {p.mergedFrom.map((m) => (
              <div key={m.id} className="rounded-md border border-line bg-panel-2 p-2">
                <b>{m.name}</b>
                {m.club && <span className="text-muted"> · {m.club}</span>}
                {m.license && <span className="text-muted"> · licence {m.license}</span>}
                <div className="text-[10px] text-muted">
                  {m.createdByName && <>Proposée par {m.createdByName}. </>}
                  {m.review === 'refused' && (
                    <span className="text-amber-200">
                      Mise hors cadre{m.reviewedByName && <> par {m.reviewedByName}</>}
                      {m.reviewedAt && <> le {fmtDate(m.reviewedAt.slice(0, 10))}</>}
                      {m.reviewNote && <> : « {m.reviewNote} »</>}.{' '}
                    </span>
                  )}
                  Fusionnée le {fmtDate(m.mergedAt.slice(0, 10))}
                  {m.mergedByName && <> par {m.mergedByName}</>}.
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {can.editPlayer(role, p) && (
        <Link to={`/joueurs/${p.id}/modifier`} className="btn-primary">
          {can.editPlayers(role) ? 'Modifier la fiche' : 'Modifier ma proposition'}
        </Link>
      )}
      {can.editPlayers(role) && !merging && !mergeWith && (
        <button className="btn-ghost text-xs" onClick={() => (setMerging(true), window.scrollTo({ top: 0, behavior: 'smooth' }))}>
          Fusionner avec une autre fiche (doublon)…
        </button>
      )}
    </div>
  )
}

/** « Suivi des mesures » : courbe d'évolution d'un critère factuel + saisie d'une séance de tests. */
function Tracking({
  playerId,
  position,
  criteria,
  measurements,
  editable,
}: {
  playerId: string
  position?: Position
  criteria: Criterion[]
  measurements: Measurement[]
  editable: boolean
}) {
  const withData = criteria.filter((c) => c.scale !== 'text' && measurements.some((m) => m.criterionId === c.id))
  const [cid, setCid] = useState<string>('')
  const current = withData.find((c) => c.id === cid) ?? withData[0]
  const [adding, setAdding] = useState(false)
  // Séance de tests : toutes les valeurs saisies sont enregistrées ensemble, à la même date.
  const [values, setValues] = useState<Record<string, number | string | undefined>>({})
  const [newD, setNewD] = useState(today())
  const filled = Object.entries(values).filter(([, v]) => v !== undefined && v !== '')

  const series = useMemo(
    () =>
      measurements
        .filter((m) => m.criterionId === current?.id && typeof m.value === 'number')
        .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt),
    [measurements, current],
  )

  async function add() {
    if (!filled.length) return
    const author = getMe() || undefined
    for (const [criterionId, value] of filled) await save<Measurement>('measurements', { id: newId(), playerId, criterionId, value: value!, date: newD, author })
    setAdding(false)
    setValues({})
    setCid(filled[0][0])
  }

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase">
          <span className="text-accent">↗</span> Suivi des mesures
        </div>
        {editable && (
          <button className="btn-primary px-2.5 py-1 text-xs" onClick={() => setAdding((x) => !x)}>
            {adding ? 'Fermer' : '+ Mesures'}
          </button>
        )}
      </div>

      {editable && adding && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent-soft p-3">
          <div className="flex items-end justify-between gap-3">
            <div className="text-[11px] text-muted">Remplis seulement ce qui a été mesuré, tout est enregistré à la même date.</div>
            <div className="w-40 shrink-0">
              <span className="label">Date des tests</span>
              <input type="date" className="field" value={newD} onChange={(e) => setNewD(e.target.value)} />
            </div>
          </div>
          {groupBy(
            criteria.filter((c) => criterionApplies(c, position)),
            (c) => c.category,
          ).map(([cat, cs]) => (
            <div key={cat} className="rounded-lg border border-line bg-panel p-3">
              <div className="section-title">{cat}</div>
              <div className={`grid gap-3 ${cs.every((c) => c.scale === 'number') ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {cs.map((c) => (
                  <div key={c.id} className={c.scale === 'number' ? '' : 'flex items-center justify-between gap-3'}>
                    <span className={c.scale === 'number' ? 'label' : 'text-xs font-bold'} title={c.description}>
                      {c.label}
                    </span>
                    <CriterionInput c={c} value={values[c.id]} onChange={(v) => setValues((x) => ({ ...x, [c.id]: v }))} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <button className="btn-primary" disabled={!filled.length} onClick={() => void add()}>
            {filled.length > 1 ? `Enregistrer les ${filled.length} mesures` : 'Enregistrer la mesure'}
          </button>
        </div>
      )}

      {!current ? (
        <div className="text-center text-xs text-muted">Aucune mesure enregistrée.</div>
      ) : (
        <>
          <select className="field mb-3" value={current.id} onChange={(e) => setCid(e.target.value)}>
            {withData.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
                {c.unit ? ` (${c.unit})` : ''}
              </option>
            ))}
          </select>
          {series.length > 1 ? (
            <div className="h-48">
              <ResponsiveContainer>
                <LineChart data={series.map((m) => ({ date: fmtDate(m.date).slice(0, 5) + '/' + m.date.slice(2, 4), v: m.value }))} margin={{ left: -18, right: 8, top: 8 }}>
                  <CartesianGrid stroke="#3a3a56" strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: '#9a9ab8', fontSize: 9 }} />
                  <YAxis domain={['auto', 'auto']} tick={{ fill: '#9a9ab8', fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: '#26263a', border: '1px solid #3a3a56', fontSize: 11 }} formatter={(v) => [fmtValue(current, v as number), current.label]} />
                  <Line type="monotone" dataKey="v" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3, fill: '#f43f5e' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-3 text-center text-[11px] text-muted">Une seule mesure : la courbe apparaîtra à la prochaine.</div>
          )}
          <div className="mt-2 divide-y divide-line">
            {[...series].reverse().map((m) => (
              <div key={m.id} className="flex items-center justify-between py-1.5 text-xs">
                <span className="font-bold">{fmtDate(m.date)}</span>
                <span className="flex items-center gap-3">
                  <span>{fmtValue(current, m.value)}</span>
                  {m.author && <span className="text-[10px] text-muted">{m.author}</span>}
                  {editable && (
                    <button
                      className="text-muted hover:text-red-400"
                      title="Supprimer cette mesure"
                      onClick={async () => (await ask('Supprimer cette mesure ?', { ok: 'Supprimer' })) && void remove('measurements', m.id)}
                    >
                      ✕
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
