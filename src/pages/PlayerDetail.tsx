import { useLiveQuery } from 'dexie-react-hooks'
import { useLayoutEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { StampLine } from '../components/ActivityLog'
import { MaturityCard } from '../components/MaturityCard'
import { PlayerGroups } from '../components/Groups'
import { Opinions } from '../components/Opinions'
import { department } from '../components/PlayerFilter'
import { departmentLabel } from '../lists'
import { MergePlayers } from '../components/MergePlayers'
import { possibleDuplicates } from '../merge'
import { expiryDate } from '../purge'
import { ReviewActions, ReviewBadge, ReviewNote } from '../components/Review'
import { CourtView } from '../components/CourtPicker'
import { Avatar, fmtValue, groupBy, PosBadges, QuarterBadge } from '../components/ui'
import { age, alive, criterionApplies, db, fmtDate, remove, type Criterion, type Measurement } from '../db'
import { latestByPlayer } from './Players'
import { ask } from '../components/Confirm'
import { themeColor } from '../theme'
import { exportPlayer } from '../export'
import { can, useRole } from '../roles'

const TABS = [
  { id: 'profil', label: 'Profil' },
  { id: 'tests', label: 'Tests' },
  { id: 'avis', label: 'Avis' },
  { id: 'croissance', label: 'Croissance' },
] as const
type TabId = (typeof TABS)[number]['id']

/** Onglets de la fiche, collés sous l'en-tête de l'appli quand on fait défiler. */
function Tabs({ tab, setTab, avis }: { tab: TabId; setTab: (t: TabId) => void; avis: number }) {
  // Hauteur réelle de l'en-tête (bandeau d'essai, encoche des iPhone…).
  const [top, setTop] = useState(50)
  useLayoutEffect(() => setTop(document.querySelector('header')?.getBoundingClientRect().height ?? 50), [])
  return (
    <div className="sticky z-10 -mx-4 border-b border-line bg-bg/95 px-4 backdrop-blur" style={{ top }}>
      <div className="flex">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 border-b-2 py-2.5 text-xs font-bold ${tab === t.id ? 'border-accent text-fg' : 'border-transparent text-muted'}`}
          >
            {t.label}
            {t.id === 'avis' && avis > 0 && <span className="ml-1 text-[10px] text-muted">{avis}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function PlayerDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const role = useRole()
  // ?fusion=<id> : ouvre la fusion avec cette autre fiche (lien « Comparer et fusionner »).
  const [params, setParams] = useSearchParams()
  const mergeWith = params.get('fusion')
  // Onglet dans l'adresse (?onglet=avis) : on le retrouve en revenant sur la fiche.
  const tab = (TABS.find((t) => t.id === params.get('onglet'))?.id ?? 'profil') as TabId
  const setTab = (t: TabId) => setParams(t === 'profil' ? {} : { onglet: t }, { replace: true })
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
        <div className="flex items-center gap-3">
        {can.exportPlayer(role) && (
          <button
            onClick={() => void exportPlayer(p.id)}
            className="text-[11px] font-bold text-muted hover:text-accent"
            title="Copie de toutes ses données (demande d’un joueur ou de ses parents)"
          >
            ⤓ Ses données
          </button>
        )}
        {can.deletePlayers(role) && (
        <button onClick={() => void del()} className="text-muted hover:text-red-400" title="Supprimer">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
          </svg>
        </button>
        )}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Avatar p={p} size={64} />
        <div>
          <h1 className="text-lg font-extrabold">
            {p.firstName} {p.lastName}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <PosBadges p={p} />
            {a !== null && <span>{a} ans</span>}
            <QuarterBadge birthDate={p.birthDate} />
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
              <>Sans décision, elle sera effacée (avec ses avis) le {fmtDate(expiryDate(p.createdAtServer))}.</>
            )}
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

      <Tabs tab={tab} setTab={setTab} avis={evaluations.length} />

      {tab === 'profil' && (
        <>
        <PlayerGroups playerId={p.id} />

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

        {(p.position || (p.secondaryPositions ?? []).length > 0) && (
          <div className="card p-4">
            <div className="section-title">Postes</div>
            <CourtView value={p.position} secondary={p.secondaryPositions} />
          </div>
        )}
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
        </>
      )}

      {tab === 'tests' && (
        <>
          {can.editMeasurements(role) && (
            <Link to={`/joueurs/${p.id}/mesures`} className="btn-primary">
              + Nouvelle séance de tests
            </Link>
          )}
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
              {cs.some((c) => c.id === 'sorensen') && <ShiradoRatio latest={latest} />}
            </div>
          </div>
        ))}
        <Tracking criteria={factual} measurements={measurements} editable={can.editMeasurements(role)} />
        </>
      )}

      {/* Avis subjectifs */}
      {tab === 'avis' && (
        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase">
            <span className="text-accent">★</span> Avis des observateurs
          </div>
          <Opinions player={p} criteria={subjective} evaluations={evaluations} events={events} />
        </div>
      )}

      {tab === 'croissance' && <MaturityCard player={p} measurements={measurements} />}

      {tab === 'profil' && can.editPlayer(role, p) && (
        <Link to={`/joueurs/${p.id}/modifier`} className="btn-primary">
          {can.editPlayers(role) ? 'Modifier la fiche' : 'Modifier ma proposition'}
        </Link>
      )}
      {tab === 'profil' && can.editPlayers(role) && !merging && !mergeWith && (
        <button className="btn-ghost text-xs" onClick={() => (setMerging(true), window.scrollTo({ top: 0, behavior: 'smooth' }))}>
          Fusionner avec une autre fiche (doublon)…
        </button>
      )}
    </div>
  )
}

/** « Suivi des mesures » : courbe d'évolution d'un critère factuel et historique (saisie : page Séance de tests). */
function Tracking({
  criteria,
  measurements,
  editable,
}: {
  criteria: Criterion[]
  measurements: Measurement[]
  editable: boolean
}) {
  const withData = criteria.filter((c) => c.scale !== 'text' && c.scale !== 'choice' && measurements.some((m) => m.criterionId === c.id))
  const [cid, setCid] = useState<string>('')
  const current = withData.find((c) => c.id === cid) ?? withData[0]
  const series = useMemo(
    () =>
      measurements
        .filter((m) => m.criterionId === current?.id && typeof m.value === 'number')
        .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt),
    [measurements, current],
  )

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase">
          <span className="text-accent">↗</span> Suivi des mesures
        </div>
      </div>

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
                  <CartesianGrid stroke={themeColor('line')} strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fill: themeColor('muted'), fontSize: 9 }} />
                  <YAxis domain={['auto', 'auto']} tick={{ fill: themeColor('muted'), fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: themeColor('panel'), border: `1px solid ${themeColor('line')}`, fontSize: 11 }} formatter={(v) => [fmtValue(current, v as number), current.label]} />
                  <Line type="monotone" dataKey="v" stroke={themeColor('accent')} strokeWidth={2} dot={{ r: 3, fill: themeColor('accent') }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-3 text-center text-[11px] text-muted">Une seule mesure : la courbe apparaîtra à la prochaine.</div>
          )}
          <div className="mt-2 divide-y divide-line">
            {[...series].reverse().map((m) => (
              <div key={m.id} className="flex items-center justify-between py-1.5 text-xs">
                <span className="min-w-0">
                  <span className="font-bold">{fmtDate(m.date)}</span>
                  {m.note && <span className="ml-2 text-[11px] text-amber-200">« {m.note} »</span>}
                </span>
                <span className="flex shrink-0 items-center gap-3">
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

/** Ratio Shirado / Sorensen, calculé à partir des dernières valeurs (norme 0,7–0,8 ; > 1 = déséquilibre). */
function ShiradoRatio({ latest }: { latest: Map<string, Measurement> }) {
  const a = latest.get('shirado')?.value
  const b = latest.get('sorensen')?.value
  if (typeof a !== 'number' || typeof b !== 'number' || !b) return null
  const r = a / b
  return (
    <div title="Norme : 0,7 à 0,8. Au-dessus de 1 : déséquilibre abdos / lombaires.">
      <div className="text-[10px] text-muted">Ratio Shirado / Sorensen</div>
      <div className={`text-sm font-extrabold ${r > 1 ? 'text-amber-300' : ''}`}>{r.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</div>
    </div>
  )
}
