import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { Empty, QuarterBadge } from '../components/ui'
import { alive, counts, db, fmtDate, type Evaluation, type Player } from '../db'

/**
 * « Ratés » : les joueurs dont on a mis la fiche hors cadre (directement, ou une fiche fondue depuis
 * dans la leur), et ce qu'ils sont devenus depuis : licence, convocations, avis validés.
 * Pour apprendre de ses erreurs de détection.
 */
export default function Missed() {
  const data = useLiveQuery(async () => {
    const [players, events, evaluations] = await Promise.all([
      db.players.toArray().then(alive),
      db.events.toArray().then(alive),
      db.evaluations.toArray().then((es) => alive(es).filter(counts)),
    ])
    return { players, events, evaluations }
  }, [])
  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const evalsBy = new Map<string, Evaluation[]>()
  for (const e of data.evaluations) evalsBy.set(e.playerId, [...(evalsBy.get(e.playerId) ?? []), e])

  const rows = data.players
    .map((p) => {
      const refusal = refusalOf(p)
      if (!refusal) return null
      const since = refusal.at?.slice(0, 10) ?? ''
      const nEvents = data.events.filter((ev) => (ev.playerIds ?? []).includes(p.id) && (!since || ev.date >= since)).length
      const later = (evalsBy.get(p.id) ?? []).filter((e) => !since || e.date >= since)
      const overall = later.map((e) => e.overall).filter((v): v is number => typeof v === 'number')
      const avg = overall.length ? overall.reduce((a, b) => a + b, 0) / overall.length : null
      const signals = [
        p.license && `Licencié${p.club ? ` à ${p.club}` : ''}`,
        nEvents > 0 && `Convoqué à ${nEvents} événement${nEvents > 1 ? 's' : ''}`,
        later.length > 0 &&
          `${later.length} avis validé${later.length > 1 ? 's' : ''}${avg !== null ? ` (note globale ${avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5)` : ''}`,
      ].filter((x): x is string => !!x)
      return { p, refusal, signals, avg }
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => b.signals.length - a.signals.length || (b.avg ?? 0) - (a.avg ?? 0) || (b.refusal.at ?? '').localeCompare(a.refusal.at ?? ''))

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-extrabold">Ratés</h1>
      <p className="text-[11px] text-muted">
        Joueurs dont la fiche a été mise hors cadre, et ce qu’ils sont devenus depuis : licence, convocations, avis validés après la décision.
        En tête, ceux qui ont le plus progressé : de bons enseignements pour la détection.
      </p>
      {rows.length === 0 ? (
        <Empty>Aucune fiche mise hors cadre pour l’instant.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(({ p, refusal, signals }) => (
            <Link key={p.id} to={`/joueurs/${p.id}`} className="card flex flex-col gap-1 p-3 text-xs transition hover:border-accent">
              <div className="flex items-center justify-between gap-2">
                <b className="text-sm">
                  {p.firstName} {p.lastName} <QuarterBadge birthDate={p.birthDate} />
                </b>
                <span className="text-[10px] text-muted">{p.review === 'refused' ? 'toujours hors cadre' : 'fiche reprise'}</span>
              </div>
              <div className="text-[10px] text-muted">
                {refusal.proposedBy && <>Proposé par {refusal.proposedBy}. </>}
                Mis hors cadre{refusal.by && <> par {refusal.by}</>}
                {refusal.at && <> le {fmtDate(refusal.at.slice(0, 10))}</>}
                {refusal.note && <> : « {refusal.note} »</>}.
              </div>
              {signals.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {signals.map((s) => (
                    <span key={s} className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                      {s}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-muted">Rien de nouveau depuis.</div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

/** Mise hors cadre de la fiche, ou d'une fiche fondue depuis dans celle-ci. */
function refusalOf(p: Player) {
  if (p.review === 'refused') return { by: p.reviewedByName, at: p.reviewedAt, note: p.reviewNote, proposedBy: p.createdByName }
  const m = p.mergedFrom?.find((x) => x.review === 'refused')
  return m ? { by: m.reviewedByName, at: m.reviewedAt, note: m.reviewNote, proposedBy: m.createdByName } : null
}
