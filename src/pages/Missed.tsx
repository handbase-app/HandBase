import { useLiveQuery } from 'dexie-react-hooks'
import { accord, listGender, w } from '../gender'
import { Empty } from '../components/ui'
import { PlayerRow } from '../components/PlayerRow'
import { PlayerList } from '../components/Pictos'
import { alive, counts, db, fmtDate, type Evaluation, type Player, dayOf } from '../db'

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
      const since = (refusal.at ? dayOf(refusal.at) : '')
      const nEvents = data.events.filter((ev) => (ev.playerIds ?? []).includes(p.id) && (!since || ev.date >= since)).length
      const later = (evalsBy.get(p.id) ?? []).filter((e) => !since || e.date >= since)
      const notes = later.flatMap((e) => Object.values(e.scores).filter((v): v is number => typeof v === 'number'))
      const avg = notes.length ? notes.reduce((a, b) => a + b, 0) / notes.length : null
      const signals = [
        p.license && `Licencié${p.club ? ` à ${p.club}` : ''}`,
        nEvents > 0 && `Convoqué à ${nEvents} événement${nEvents > 1 ? 's' : ''}`,
        later.length > 0 &&
          `${later.length} avis validé${later.length > 1 ? 's' : ''}${avg !== null ? ` (moyenne ${avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5)` : ''}`,
      ].filter((x): x is string => !!x)
      return { p, refusal, signals, avg }
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => b.signals.length - a.signals.length || (b.avg ?? 0) - (a.avg ?? 0) || (b.refusal.at ?? '').localeCompare(a.refusal.at ?? ''))

  // Accord (src/gender.ts) : seulement des filles → au féminin.
  const f = listGender(undefined, rows.map((r) => r.p)) === 'F'
  const gw = w(f ? 'F' : undefined)
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-extrabold">Ratés</h1>
      {/* Explication seulement dans l'état vide (31/10), plus sous le titre. */}
      {rows.length === 0 ? (
        <Empty>
          Aucune fiche mise hors cadre pour l’instant. Ici viendront les {gw.joueurs} dont la fiche a été mise hors cadre, et ce qu’{gw.ils} sont{' '}
          {f ? 'devenues' : 'devenus'} depuis (licence, convocations, avis validés après la décision), {gw.ceux} qui ont le plus progressé en tête.
        </Empty>
      ) : (
        <PlayerList ids={rows.map((r) => r.p.id)}>
          {rows.map(({ p, refusal, signals }) => (
            <PlayerRow
              key={p.id}
              p={p}
              link={{ to: `/joueurs/${p.id}` }}
              aside={<span className="shrink-0 text-right text-[10px] text-muted">{p.review === 'refused' ? 'toujours hors cadre' : 'fiche reprise'}</span>}
              below={
                <>
                  <div className="text-[10px] text-muted">
                    {refusal.proposedBy && <>{accord('Proposé', p.sex)} par {refusal.proposedBy}. </>}
                    {accord('Mis', p.sex)} hors cadre{refusal.by && <> par {refusal.by}</>}
                    {refusal.at && <> le {fmtDate(dayOf(refusal.at))}</>}
                    {refusal.note && <> : « {refusal.note} »</>}.
                  </div>
                  {signals.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {signals.map((s) => (
                        <span key={s} className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-200">
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted">Rien de nouveau depuis.</div>
                  )}
                </>
              }
            />
          ))}
        </PlayerList>
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
