import { Link } from 'react-router-dom'
import { fmtDate, type Measurement, type Player } from '../db'
import { InfoButton } from './ui'
import {
  correctedParentHeight,
  decimalAge,
  khamisRoche,
  MEAN_APHV,
  mirwald,
  moore,
  offsetReliable,
  phase,
  PHASE_LABEL,
  round,
  stage,
  STAGE_LABEL,
  timing,
  TIMING_LABEL,
  type KRResult,
} from '../maturity'

const f1 = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + f1(Math.abs(n))

/** Valeur numérique la plus récente d'un critère à une date donnée (incluse). */
function valueAt(ms: Measurement[], criterionId: string, date: string): number | undefined {
  let best: Measurement | undefined
  for (const m of ms)
    if (m.criterionId === criterionId && typeof m.value === 'number' && m.date <= date && (!best || m.date > best.date)) best = m
  return best?.value as number | undefined
}

interface Snapshot {
  date: string
  age: number
  height: number
  mirwald: number | null
  moore: number
  kr: KRResult | null
}

/** Une estimation par date de mesure de la taille, pour suivre l'évolution. */
export function snapshots(p: Player, ms: Measurement[]): Snapshot[] {
  if (!p.sex || !p.birthDate) return []
  const sex = p.sex
  const dates = [...new Set(ms.filter((m) => m.criterionId === 'taille' && typeof m.value === 'number').map((m) => m.date))].sort()
  const parents =
    p.motherHeight !== undefined && p.fatherHeight !== undefined
      ? {
          mother: correctedParentHeight(p.motherHeight, 'mere', p.motherHeightSource !== 'mesuree'),
          father: correctedParentHeight(p.fatherHeight, 'pere', p.fatherHeightSource !== 'mesuree'),
        }
      : null
  return dates.flatMap((date) => {
    const age = decimalAge(p.birthDate!, date)
    const height = valueAt(ms, 'taille', date)
    if (age === null || height === undefined) return []
    const weight = valueAt(ms, 'poids', date)
    const sitting = valueAt(ms, 'taille_assise', date)
    const input = { sex, age, height, weight, sitting }
    return [
      {
        date,
        age,
        height,
        mirwald: mirwald(input),
        moore: moore(input),
        kr:
          parents && weight !== undefined
            ? khamisRoche({ sex, age, height, weight, motherHeight: parents.mother, fatherHeight: parents.father })
            : null,
      },
    ]
  })
}

export function MaturityCard({ player: p, measurements }: { player: Player; measurements: Measurement[] }) {
  const missing: string[] = []
  if (!p.sex) missing.push('le sexe')
  if (!p.birthDate) missing.push('la date de naissance')
  if (!measurements.some((m) => m.criterionId === 'taille')) missing.push('la taille')

  const snaps = snapshots(p, measurements)
  const last = snaps[snaps.length - 1]
  const noParents = p.motherHeight === undefined || p.fatherHeight === undefined
  const noSitting = !measurements.some((m) => m.criterionId === 'taille_assise')
  const noWeight = !measurements.some((m) => m.criterionId === 'poids')

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-extrabold tracking-wider uppercase">
        <span className="text-accent">⇡</span> Maturité & croissance
        <InfoButton title="Maturité & croissance">
          <p>Estimations calculées à partir des mesures : pas des certitudes.</p>
          <p>
            <b>Pic de croissance</b> (Mirwald 2002, Moore 2015) : écart en années avec le moment où le joueur grandit le plus vite. Négatif =
            pic à venir, positif = pic passé.{p.sex ? ` Âge moyen au pic : ${f1(MEAN_APHV[p.sex])} ans.` : ''} Marge d’environ ±1 an ; ces
            équations sous-estiment l’écart des joueurs très précoces ou très tardifs (le décalage est ramené vers la moyenne).
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
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <OffsetBlock snap={last} sex={p.sex!} noSitting={noSitting} noWeight={noWeight} />
          <AdultHeightBlock snap={last} noParents={noParents} noWeight={noWeight} playerId={p.id} />
          {snaps.length > 1 && <History snaps={snaps} />}
        </div>
      )}
    </div>
  )
}

function OffsetBlock({ snap, sex, noSitting, noWeight }: { snap: Snapshot; sex: 'M' | 'F'; noSitting: boolean; noWeight: boolean }) {
  const ref = snap.mirwald ?? snap.moore
  const ph = phase(ref)
  const reliable = offsetReliable(snap.age, ref)
  const methods = [
    { name: 'Mirwald', offset: snap.mirwald },
    { name: 'Moore', offset: snap.moore },
  ]
  return (
    <div>
      <div className="section-title">Pic de croissance (au {fmtDate(snap.date)}, {f1(snap.age)} ans)</div>
      <div className="grid grid-cols-2 gap-2">
        {methods.map(({ name, offset }) => (
          <div key={name} className="rounded-lg border border-line bg-panel-2 p-2.5">
            <div className="text-[10px] text-muted">{name}</div>
            {offset === null ? (
              <div className="text-[11px] text-muted">
                Manque {[noSitting && 'la taille assise', noWeight && 'le poids'].filter(Boolean).join(' et ')}
              </div>
            ) : (
              <>
                <div className="text-base font-extrabold">{signed(offset)} an</div>
                <div className="text-[10px] text-muted">
                  pic estimé à {f1(snap.age - offset)} ans · {TIMING_LABEL[timing(sex, snap.age - offset)].toLowerCase()}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded border border-accent/50 bg-accent-soft px-1.5 py-0.5 font-bold text-accent">{PHASE_LABEL[ph]}</span>
      </div>
      {!reliable && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
          ⚠ Fiabilité réduite : {snap.age > 16.5 || snap.age < 8 ? 'âge hors de la plage des équations (8–16 ans)' : 'joueur loin de son pic'}.
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

function History({ snaps }: { snaps: Snapshot[] }) {
  return (
    <div>
      <div className="section-title">Évolution</div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-[10px] text-muted">
            <tr>
              <th className="px-1 py-1 text-left">Date</th>
              <th className="px-1">Âge</th>
              <th className="px-1">Taille</th>
              <th className="px-1">Mirwald</th>
              <th className="px-1">Moore</th>
              <th className="px-1">% adulte</th>
            </tr>
          </thead>
          <tbody>
            {[...snaps].reverse().map((s) => (
              <tr key={s.date} className="border-t border-line text-center">
                <td className="px-1 py-1 text-left font-bold">{fmtDate(s.date)}</td>
                <td className="px-1">{f1(s.age)}</td>
                <td className="px-1">{round(s.height)}</td>
                <td className="px-1">{s.mirwald === null ? '—' : signed(s.mirwald)}</td>
                <td className="px-1">{signed(s.moore)}</td>
                <td className="px-1">{s.kr ? `${f1(s.kr.pah)} %` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
