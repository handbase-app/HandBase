import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { alive, db, today, TRIAL, type Player, type PlayerGroup } from '../db'
import { withPoleMembers } from '../poleMembers'
import { can, useRole } from '../roles'
import { supabase } from '../sync'
import {
  FICHE_DAYS,
  orderWellnessGroups,
  painTone,
  playerWellnessView,
  rateLine,
  sessionLoad,
  staffRow,
  wellnessEnabledOf,
  WELLNESS_ITEMS,
  type FicheDay,
  type PainTone,
  type PlayerWellnessView,
  type WellnessEntry,
  type WellnessSession,
} from '../wellness'
import { fetchPlayerWellness, type PlayerWellnessData, type Res } from '../wellnessApi'
import { AnchoredBubble } from './AnchoredBubble'
import { canReadWellness, ChargeLine, PainLines, PainSummary, ScoreChip, shortDay } from './Wellness'
import type { AxisAnchor } from './ZoneRadar'
import { Empty } from './ui'

/*
 * Onglet « Wellness » de la fiche d'un joueur, côté STAFF (src/pages/PlayerDetail.tsx ; supabase/073_wellness.sql,
 * src/wellness.ts : playerWellnessView). Présent seulement si le réglage de l'installation est ouvert, la fiche est (aujourd'hui)
 * dans au moins un groupe vivant, non archivé, qui demande le wellness, et le compte en lit le wellness (canReadWellness :
 * administrateur, ou encadrant créateur ou participant du groupe ; miroir de hb_wl_staff_de). Sinon pas d'onglet du tout.
 *  - Aujourd'hui (ou la dernière réponse, « Pas encore répondu aujourd'hui · dernière réponse … ») : les quatre notes
 *    colorées par rapport à SA moyenne (mêmes couleurs que le tableau du groupe), gênes une ligne par endroit.
 *  - 4 semaines : une rangée de petites barres par note (une colonne par jour, week-end grisé : jamais « manquant »), trait
 *    pointillé à sa moyenne, rangée des gênes ; toucher un jour ouvre une bulle accrochée au doigt (fond flouté).
 *  - Séances « Ma séance » (date, intensité, durée, charge) et charge 7 j comparée à sa moyenne par semaine (28 j).
 *  - Taux de réponse sur les jours de semaine (completionRate), neutre ; liens vers le wellness du groupe (Pôle d'abord).
 * Lu à la demande (src/wellnessApi.ts : fetchPlayerWellness), jamais gardé sur l'appareil ; mode essai : l'appareil.
 */

/**
 * Groupes du wellness de cette fiche que ce compte lit, le groupe Pôle d'abord ; undefined pendant la lecture, [] : pas
 * d'onglet. Membre d'un groupe Pôle : période de pôle en cours aujourd'hui (comme le serveur, hb_wl_contient).
 */
export function usePlayerWellnessGroups(playerId: string): PlayerGroup[] | undefined {
  const role = useRole()
  return useLiveQuery(async () => {
    if (!wellnessEnabledOf(await db.config.toArray(), { trial: TRIAL, local: !supabase })) return []
    const gs = alive(await db.groups.toArray()).filter((g) => g.wellness === true && !g.archived && can.seeGroup(g) && canReadWellness(role, g))
    if (!gs.length) return []
    const p = await db.players.get(playerId)
    if (!p || p.deleted) return []
    // Groupes Pôle : membres calculés pour cette seule fiche (rien d'autre n'est lu).
    const withMembers = await withPoleMembers(gs, [p])
    return orderWellnessGroups(withMembers.filter((g) => g.playerIds.includes(playerId)))
  }, [playerId, role])
}

type Bubble = { day: FicheDay; at: AxisAnchor }

export function PlayerWellnessTab({ player: p, groups }: { player: Player; groups: PlayerGroup[] }) {
  const main = groups[0]
  const [res, setRes] = useState<Res<PlayerWellnessData> | null>(null)
  const [bubble, setBubble] = useState<Bubble | null>(null)
  useEffect(() => {
    let live = true
    setRes(null)
    void fetchPlayerWellness(p.id, main.id).then((r) => live && setRes(r))
    return () => {
      live = false
    }
  }, [p.id, main.id])

  const links = (
    <div className="flex flex-col items-start gap-1" data-testid="wellness-liens">
      {groups.map((g, i) => (
        <Link key={g.id} to={`/groupes/${g.id}/wellness`} className="py-1 text-xs font-bold text-accent">
          {i === 0 ? 'Voir le wellness du groupe' : 'Voir aussi'}
          {groups.length > 1 && <span className="font-normal"> « {g.name} »</span>} ›
        </Link>
      ))}
    </div>
  )

  if (!res) return <div className="py-10 text-center text-sm text-muted">Chargement…</div>
  if (!res.ok)
    return (
      <div className="flex flex-col gap-3" data-testid="fiche-wellness">
        <Empty>{res.error}</Empty>
        {links}
      </div>
    )
  if (!res.value.account)
    return (
      <div className="flex flex-col gap-3" data-testid="fiche-wellness">
        <Empty>Pas d’espace joueur : rien ne lui est demandé pour l’instant.</Empty>
        {links}
      </div>
    )

  const t = today()
  // Début du taux : la première activation parmi ses groupes (avant, rien n'était demandé).
  const since = groups.map((g) => g.wellnessSince).filter((d): d is string => !!d).sort()[0]
  const v = playerWellnessView(res.value.entries, res.value.sessions, t, { days: FICHE_DAYS, since })
  return (
    <div className="flex flex-col gap-3" data-testid="fiche-wellness">
      <TodayCard v={v} today={t} />
      <WeeksCard v={v} onDay={(day, at) => setBubble({ day, at })} />
      <SessionsCard v={v} />
      <RateCard v={v} />
      {links}
      <p className="text-[10px] text-muted">Lu à la demande pour le staff du groupe : rien n’est gardé sur l’appareil, ni mis dans les exports, ni envoyé à une IA.</p>
      {bubble && <DayBubble day={bubble.day} at={bubble.at} entries={res.value.entries} sessions={v.sessions} onClose={() => setBubble(null)} />}
    </div>
  )
}

/** Réponse du jour (ou la dernière) : quatre notes colorées par rapport à sa moyenne, gênes. */
function TodayCard({ v, today: t }: { v: PlayerWellnessView; today: string }) {
  const f = v.focus
  const weekend = !v.days[v.days.length - 1]?.weekday
  return (
    <section className="card flex flex-col gap-2 p-3" data-testid="wellness-jour">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 className="text-sm font-bold">{f?.isToday ? 'Aujourd’hui' : weekend ? 'Week-end : rien n’est demandé' : 'Pas encore répondu aujourd’hui'}</h2>
        <span className="text-[11px] text-muted">{f ? (f.isToday ? shortDay(t) : `dernière réponse ${shortDay(f.day)}`) : 'pas de réponse ces dernières semaines'}</span>
      </div>
      {f && (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {WELLNESS_ITEMS.map((it) => (
              <ScoreChip key={it.key} item={it} value={f.entry.scores[it.key]} tone={f.tones[it.key]} avg={f.avg[it.key]} big />
            ))}
          </div>
          <p className="text-[10px] text-muted">
            Par rapport à <b>sa propre moyenne</b> (28 jours d’avant) : <span className="text-gain">comme d’habitude ou mieux</span>, <span className="text-spread-lo">un peu en dessous</span>, <span className="text-loss">nettement en dessous</span>.
          </p>
          {f.entry.pain ? <PainSummary entry={f.entry} /> : <span className="text-[11px] text-muted">Pas de gêne signalée.</span>}
        </>
      )}
    </section>
  )
}

/** Point de la rangée des gênes : neutre (1 à 3), ambre (4 à 6), rouge doux (7 à 10), comme la pastille « Gêne signalée ». */
const PAIN_DOT_CLS: Record<PainTone, string> = { light: 'bg-fg/50', medium: 'bg-spread-lo', strong: 'bg-loss' }

const ROW_H = 28
const ROW_GAP = 4

/** 4 semaines : une rangée de barres par note (une colonne par jour), trait à sa moyenne, rangée des gênes. */
function WeeksCard({ v, onDay }: { v: PlayerWellnessView; onDay: (d: FicheDay, at: AxisAnchor) => void }) {
  const n = v.days.length
  const last = v.days[n - 1]?.day
  const answered = v.days.some((d) => d.entry)
  return (
    <section className="card flex flex-col gap-2 p-3" data-testid="wellness-semaines">
      <h2 className="text-sm font-bold">4 dernières semaines</h2>
      {!answered ? (
        <p className="text-xs text-muted">Pas encore de réponse sur ces 4 semaines.</p>
      ) : (
        <div className="flex min-w-0 gap-2">
          {/* Noms des notes et sa moyenne, en face de chaque rangée. */}
          <div className="flex w-[4.5rem] shrink-0 flex-col" style={{ gap: ROW_GAP }}>
            {WELLNESS_ITEMS.map((it) => (
              <div key={it.key} className="flex flex-col justify-center leading-tight" style={{ height: ROW_H }}>
                <span className="truncate text-[10px] font-bold">{it.short}</span>
                <span className="text-[9px] text-muted tabular-nums">{v.avg[it.key] !== null ? `moy. ${(Math.round((v.avg[it.key] as number) * 10) / 10).toLocaleString('fr-FR')}` : '—'}</span>
              </div>
            ))}
            <div className="flex h-3 items-center text-[9px] text-muted">Gêne</div>
          </div>
          <div className="relative min-w-0 flex-1">
            {/* Sa moyenne : trait pointillé sur chaque rangée. */}
            {WELLNESS_ITEMS.map((it, i) =>
              v.avg[it.key] !== null ? (
                <div
                  key={it.key}
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-fg/70"
                  style={{ top: i * (ROW_H + ROW_GAP) + ROW_H * (1 - (v.avg[it.key] as number) / 10) }}
                />
              ) : null,
            )}
            <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, columnGap: 1 }}>
              {v.days.map((d) => (
                <button
                  key={d.day}
                  type="button"
                  className={`flex min-w-0 flex-col rounded-[3px] ${d.weekday ? '' : 'bg-panel-2'}`}
                  style={{ gap: ROW_GAP }}
                  aria-label={`${shortDay(d.day)} : ${d.entry ? WELLNESS_ITEMS.map((it) => `${it.short} ${d.entry!.scores[it.key] ?? '—'}`).join(', ') : d.weekday ? 'pas de réponse' : 'week-end'}${d.pain !== null ? `, gêne ${d.pain}/10` : ''}`}
                  onClick={(ev) => {
                    const r = ev.currentTarget.getBoundingClientRect()
                    onDay(d, { x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
                  }}
                >
                  {WELLNESS_ITEMS.map((it) => {
                    const val = d.entry?.scores[it.key]
                    return (
                      <span key={it.key} className="flex items-end justify-center" style={{ height: ROW_H }}>
                        {typeof val === 'number' && <span className={`w-full max-w-[7px] rounded-t-[2px] ${d.day === last ? 'bg-fg/75' : 'bg-muted/50'}`} style={{ height: `${val * 10}%` }} />}
                      </span>
                    )
                  })}
                  <span className="flex h-3 items-center justify-center">
                    {d.pain !== null && <span className={`h-2.5 w-2.5 rounded-full ${PAIN_DOT_CLS[painTone(d.pain)]}`} />}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-muted">
              <span>{shortDay(v.days[0].day)}</span>
              <span>aujourd’hui</span>
            </div>
          </div>
        </div>
      )}
      <p className="text-[10px] text-muted">Barres : ses notes de 1 à 10 (la plus foncée : aujourd’hui) ; pointillé : sa moyenne sur ces 4 semaines ; colonnes grisées : week-end (rien n’est demandé) ; point : gêne, selon l’intensité (1 à 3, <span className="text-spread-lo">4 à 6</span>, <span className="text-loss">7 à 10</span>). Toucher un jour : le détail.</p>
    </section>
  )
}

/** « Ma séance » : séances récentes et charge 7 jours / moyenne par semaine sur 28 jours. */
function SessionsCard({ v }: { v: PlayerWellnessView }) {
  const [all, setAll] = useState(false)
  const list = all ? v.sessions : v.sessions.slice(0, 8)
  return (
    <section className="card flex flex-col gap-2 p-3" data-testid="wellness-seances">
      <h2 className="text-sm font-bold">Ma séance</h2>
      {v.sessions.length === 0 ? (
        <p className="text-xs text-muted">Pas de séance notée sur ces 4 semaines.</p>
      ) : (
        <>
          <ChargeLine charge={v.charge} className="text-[11px] text-muted" />
          <table className="w-full table-fixed text-[11px] tabular-nums">
            <thead className="text-[9px] text-muted">
              <tr>
                <th className="w-[38%] text-left font-normal">Jour</th>
                <th className="text-right font-normal">Intensité</th>
                <th className="text-right font-normal">Durée</th>
                <th className="text-right font-normal">Charge</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="truncate py-1 text-left">{shortDay(s.day)}</td>
                  <td className="text-right">{s.rpe}/10</td>
                  <td className="text-right">{s.minutes} min</td>
                  <td className="text-right font-bold">{sessionLoad(s).toLocaleString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {v.sessions.length > 8 && (
            <button type="button" className="min-h-9 self-start text-xs font-bold text-accent" onClick={() => setAll(!all)}>
              {all ? 'Moins' : `Voir les ${v.sessions.length - 8} autres`}
            </button>
          )}
          <p className="text-[10px] text-muted">Charge = intensité ressentie × durée ; 7 jours comparés à sa moyenne par semaine sur 28 jours.</p>
        </>
      )}
    </section>
  )
}

/** Taux de réponse sur les jours de semaine, neutre. */
function RateCard({ v }: { v: PlayerWellnessView }) {
  const r = v.rate
  const pct = r.rate !== null ? Math.round(r.rate * 100) : null
  return (
    <section className="card flex flex-col gap-1.5 p-3" data-testid="wellness-taux">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold">Réponses</h2>
        {pct !== null && <span className="text-sm font-extrabold tabular-nums">{pct} %</span>}
      </div>
      {pct !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden>
          <div className="h-full rounded-full bg-fg/45" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="text-[11px] text-muted">
        {rateLine(r)}
        {r.requested > 0 && ` · du ${shortDay(r.from)} au ${shortDay(r.to)}`}
        <span className="mt-0.5 block text-[10px]">Le week-end n’est jamais compté ; aujourd’hui compte dès sa réponse.</span>
      </p>
    </section>
  )
}

/** Bulle d'un jour, accrochée au doigt (fond flouté) : notes colorées ce jour-là, gênes, séances. */
function DayBubble({ day: d, at, entries, sessions, onClose }: { day: FicheDay; at: AxisAnchor; entries: readonly WellnessEntry[]; sessions: readonly WellnessSession[]; onClose: () => void }) {
  const row = d.entry ? staffRow(entries, [], d.day) : null
  const own = sessions.filter((s) => s.day === d.day)
  return (
    <AnchoredBubble at={at} label={`Wellness du ${shortDay(d.day)}`} title={shortDay(d.day)} sub={d.entry ? 'couleurs : par rapport à sa moyenne' : d.weekday ? 'pas de réponse ce jour-là' : 'week-end : rien n’est demandé'} onClose={onClose} testId="bulle-jour-wellness">
      <div className="flex w-full min-w-0 flex-col gap-2">
        {row && d.entry && (
          <div className="grid grid-cols-4 gap-1">
            {WELLNESS_ITEMS.map((it) => (
              <ScoreChip key={it.key} item={it} value={d.entry!.scores[it.key]} tone={row.tones[it.key]} avg={row.avg[it.key]} big />
            ))}
          </div>
        )}
        {d.entry?.pain && d.entry.pains?.length ? <PainLines pains={d.entry.pains} className="text-[11px]" /> : d.entry ? <span className="text-[11px] text-muted">Pas de gêne signalée.</span> : null}
        {own.length > 0 && (
          <ul className="text-[11px]">
            {own.map((s) => (
              <li key={s.id}>
                Séance · intensité {s.rpe}/10 · {s.minutes} min · charge {sessionLoad(s).toLocaleString('fr-FR')}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AnchoredBubble>
  )
}
