import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db, fmtDate, type Measurement, type Player } from '../db'
import { Icon, InfoButton } from './ui'
import { MEAN_APHV, offsetReliable, phase, PHASE_LABEL, round, sittingPlausible, stage, STAGE_LABEL, timing, TIMING_LABEL, type Sex } from '../maturity'
import { snapshots, type Snapshot } from '../maturitySnapshot'

/** Gardé pour les imports existants : la logique est dans src/maturitySnapshot.ts (sans JSX). */
export { snapshots }

const f1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + f1(Math.abs(n))
/** « an » jusqu'à 1,9 (« 1,5 an »), « ans » à partir de 2. */
const yr = (n: number) => (Math.abs(n) >= 1.95 ? 'ans' : 'an')

export function MaturityCard({ player: p, measurements }: { player: Player; measurements: Measurement[] }) {
  const missing: string[] = []
  if (!p.sex) missing.push('le sexe')
  if (!p.birthDate) missing.push('la date de naissance')
  if (!measurements.some((m) => m.criterionId === 'taille')) missing.push('la taille')

  const snaps = snapshots(p, measurements)
  const last = snaps[snaps.length - 1]
  const noParents = p.motherHeight === undefined || p.fatherHeight === undefined
  const noWeight = !measurements.some((m) => m.criterionId === 'poids')
  // Critères taille, poids, taille assise (identifiants fixes) absents de la base : on ne peut pas les saisir.
  const absent = useLiveQuery(
    () => db.criteria.bulkGet(['taille', 'poids', 'taille_assise']).then((cs) => cs.filter((c) => !c || c.deleted).length),
    [],
    0,
  )

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase">
        <span className="text-accent">⇡</span> Maturité & croissance
        <InfoButton title="Maturité & croissance">
          <p>Estimations calculées à partir des mesures : pas des certitudes.</p>
          <p>
            <b>Âge au pic de croissance</b> : trois modèles (Mirwald 2002, Moore 2015, Fransen 2018 pour les garçons) estiment l’écart en
            années avec le moment où le joueur grandit le plus vite. Négatif = pic à venir, positif = pic passé.
            {p.sex ? ` Âge moyen au pic : ${f1(MEAN_APHV[p.sex])} ans.` : ''} La <b>moyenne</b> des modèles disponibles sert de repère
            (précoce, dans la norme, tardif ; avant, autour, après le pic). Marge d’environ ±1 an ; ces équations ramènent vers la moyenne
            les joueurs très précoces ou très tardifs.
          </p>
          <p>
            Mirwald et Fransen demandent la taille, la taille assise (sans le banc) et le poids, pris le même jour ou à moins de 4 mois
            d’écart ; Moore n’utilise que l’âge et une taille.
          </p>
          <p>
            <b>Taille adulte prédite</b> (Khamis-Roche 1994) : à partir de l’âge, de la taille, du poids et de la taille des parents, avec sa
            marge à 90 %. Le pourcentage de taille adulte atteinte situe le joueur dans sa croissance.
          </p>
          <p>À utiliser pour adapter l’entraînement et regrouper par maturité, jamais seul pour sélectionner ou écarter un joueur.</p>
        </InfoButton>
      </div>

      {missing.length > 0 || !last ? (
        <div className="text-xs text-muted">
          Pour calculer, il manque {missing.join(', ') || 'des mesures'}.{' '}
          <Link to={`/joueurs/${p.id}/modifier`} className="font-bold text-accent">
            Compléter la fiche →
          </Link>
          {absent > 0 && <p className="mt-1">Les critères taille, poids et taille assise (identifiants taille, poids, taille_assise) sont à importer par un administrateur.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <OffsetBlock snap={last} sex={p.sex!} />
          <AdultHeightBlock snap={last} noParents={noParents} noWeight={noWeight} playerId={p.id} />
          {snaps.length > 1 && <History snaps={snaps} sex={p.sex!} />}
        </div>
      )}
    </div>
  )
}

/** Ce qui manque à Mirwald / Fransen pour cette taille. */
function lacks(snap: Snapshot) {
  const l = [snap.sitting === undefined && 'taille assise', snap.weight === undefined && 'poids'].filter(Boolean)
  return `Manque : ${l.join(' / ') || 'mesures cohérentes'}`
}

function OffsetBlock({ snap, sex }: { snap: Snapshot; sex: Sex }) {
  const { offset: mean, n } = snap.mean
  const ph = phase(mean)
  const reliable = offsetReliable(snap.age, mean)
  const meanAphv = snap.age - mean
  const rows: { name: string; detail?: string; offset: number | null; note?: string }[] = [
    { name: 'Mirwald', detail: '2002', offset: snap.mirwald },
    { name: 'Moore', detail: sex === 'M' ? (snap.sitting !== undefined ? '2015 · taille assise' : '2015 · taille') : '2015', offset: snap.moore },
    { name: 'Fransen', detail: '2018', offset: snap.fransen, note: sex === 'F' ? 'Non applicable aux filles' : undefined },
  ]
  return (
    <div>
      <div className="section-title">
        Âge au pic de croissance <span className="font-bold text-muted normal-case">· au {fmtDate(snap.date)}, {f1(snap.age)} ans</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-line">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3 bg-panel-2 px-2.5 py-1.5 text-[10px] text-muted">
          <span>Modèle</span>
          <span className="w-[4.5rem] text-right">Décalage</span>
          <span className="w-[4.5rem] text-right">Âge au pic</span>
        </div>
        {rows.map(({ name, detail, offset, note }) => (
          <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 border-t border-line px-2.5 py-1.5 text-xs">
            <span className="min-w-0">
              <b>{name}</b> <span className="text-[10px] text-muted">{detail}</span>
            </span>
            {offset === null ? (
              <span className="col-span-2 text-right text-[11px] text-muted">{note ?? lacks(snap)}</span>
            ) : (
              <>
                <span className="w-[4.5rem] text-right font-bold tabular-nums">{signed(offset)} {yr(offset)}</span>
                <span className="w-[4.5rem] text-right tabular-nums">{f1(snap.age - offset)} ans</span>
              </>
            )}
          </div>
        ))}
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 border-t border-accent/40 bg-accent-soft px-2.5 py-2 text-sm">
          <span className="min-w-0">
            <b>Moyenne</b> <span className="text-[10px] text-muted">sur {n} modèle{n > 1 ? 's' : ''}</span>
          </span>
          <span className="w-[4.5rem] text-right font-extrabold tabular-nums">{signed(mean)} {yr(mean)}</span>
          <span className="w-[4.5rem] text-right font-extrabold tabular-nums">{f1(meanAphv)} ans</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded border border-accent/50 bg-accent-soft px-1.5 py-0.5 font-bold text-accent">{PHASE_LABEL[ph]}</span>
        <span className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-bold">{TIMING_LABEL[timing(sex, meanAphv)]}</span>
        <span className="text-muted">âge moyen au pic : {f1(MEAN_APHV[sex])} ans</span>
      </div>
      {snap.sitting !== undefined && !sittingPlausible(snap.height, snap.sitting) && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
          <Icon name="alert" className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />
          Taille assise à vérifier : {round(snap.sitting)} cm pour {round(snap.height)} cm debout (d’habitude 48 à 56 %). La hauteur du banc
          est-elle déduite ?
        </div>
      )}
      {!reliable && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
          <Icon name="alert" className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />
          Fiabilité réduite : {snap.age > 16.5 || snap.age < 8 ? 'âge hors de la plage des équations (8–16 ans)' : 'joueur loin de son pic'}.
        </div>
      )}
    </div>
  )
}

function AdultHeightBlock({ snap, noParents, noWeight, playerId }: { snap: Snapshot; noParents: boolean; noWeight: boolean; playerId: string }) {
  if (!snap.kr) {
    return (
      <div>
        <div className="section-title">Taille adulte prédite</div>
        <div className="text-xs text-muted">
          {noParents ? (
            <>
              Renseigne la taille des deux parents.{' '}
              <Link to={`/joueurs/${playerId}/modifier`} className="font-bold text-accent">
                Compléter →
              </Link>
            </>
          ) : noWeight ? (
            'Il manque le poids.'
          ) : (
            'Méthode applicable de 4 à 17,5 ans : au-delà, la croissance est quasi terminée.'
          )}
        </div>
      </div>
    )
  }
  const { predicted, error90, pah, remaining } = snap.kr
  const st = stage(pah)
  // Barre de 80 % à 100 % avec les seuils 85 / 90 / 95.
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - 80) / 20) * 100))}%`
  return (
    <div>
      <div className="section-title">Taille adulte prédite (Khamis-Roche)</div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-line bg-panel-2 p-2">
          <div className="text-base font-extrabold">{Math.round(predicted)} cm</div>
          <div className="text-[10px] text-muted">± {Math.round(error90)} cm (90 %)</div>
        </div>
        <div className="rounded-lg border border-line bg-panel-2 p-2">
          <div className="text-base font-extrabold">{f1(pah)} %</div>
          <div className="text-[10px] text-muted">taille adulte atteinte</div>
        </div>
        <div className="rounded-lg border border-line bg-panel-2 p-2">
          <div className="text-base font-extrabold">{f1(remaining)} cm</div>
          <div className="text-[10px] text-muted">reste à grandir</div>
        </div>
      </div>
      <div className="mt-3">
        <div className="relative h-2 rounded-full bg-panel-2">
          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: pos(pah) }} />
          {[85, 90, 95].map((t) => (
            <div key={t} className="absolute -top-1 h-4 w-px bg-muted" style={{ left: pos(t) }} />
          ))}
        </div>
        <div className="relative mt-1 h-3 text-[9px] text-muted">
          {[85, 90, 95].map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: pos(t) }}>
              {t} %
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1 text-[11px]">
        Stade : <b className="text-accent">{STAGE_LABEL[st]}</b>
      </div>
    </div>
  )
}

function History({ snaps, sex }: { snaps: Snapshot[]; sex: Sex }) {
  const cell = (v: number | null) => (v === null ? '—' : signed(v))
  return (
    <div>
      <div className="section-title">Évolution (décalage par rapport au pic, en années)</div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full text-[11px] whitespace-nowrap">
          <thead className="text-[10px] text-muted">
            <tr>
              <th className="px-1 py-1 text-left">Date</th>
              <th className="px-1">Âge</th>
              <th className="px-1">Taille</th>
              <th className="px-1">Mirwald</th>
              <th className="px-1">Moore</th>
              {sex === 'M' && <th className="px-1">Fransen</th>}
              <th className="px-1 text-fg">Moyenne</th>
              <th className="px-1">% adulte</th>
            </tr>
          </thead>
          <tbody>
            {[...snaps].reverse().map((s) => (
              <tr key={s.date} className="border-t border-line text-center tabular-nums">
                <td className="px-1 py-1 text-left font-bold">{fmtDate(s.date)}</td>
                <td className="px-1">{f1(s.age)}</td>
                <td className="px-1">{s.height.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
                <td className="px-1">{cell(s.mirwald)}</td>
                <td className="px-1">{cell(s.moore)}</td>
                {sex === 'M' && <td className="px-1">{cell(s.fransen)}</td>}
                <td className="px-1 font-bold">{signed(s.mean.offset)}</td>
                <td className="px-1">{s.kr ? `${f1(s.kr.pah)} %` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
