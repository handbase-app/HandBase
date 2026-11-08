import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { AnchoredBubble } from '../components/AnchoredBubble'
import { ask } from '../components/Confirm'
import { FilterField, pillClass } from '../components/FilterWindow'
import { RosterQueryBar, type OwnFilters } from '../components/PlayersQuery'
import { usePoleMembers, usePoleRef } from '../components/PoleGroup'
import { Empty, playerName, Avatar } from '../components/ui'
import { canReadWellness, canToggleWellness, shortDay, useWellnessEnabled } from '../components/Wellness'
import type { AxisAnchor } from '../components/ZoneRadar'
import { alive, db, positionLabel, save, today, type Player, type PlayerGroup } from '../db'
import { setGender, w } from '../gender'
import { can, useRole } from '../roles'
import {
  CHARGE_WORDS,
  fmt1,
  painWord,
  staffDay,
  staffRank,
  staffRow,
  TONE_WORDS,
  WELLNESS_ITEMS,
  zoneLabel,
  type ChargeTone,
  type StaffRow,
  type Tone,
  type WellnessEntry,
  type WellnessSession,
} from '../wellness'
import { fetchGroupWellness, type GroupWellness as GW } from '../wellnessApi'

/*
 * Wellness d'un groupe, côté STAFF (/groupes/:id/wellness ; supabase/073_wellness.sql, src/wellness.ts) :
 *  - « Wellness quotidien » : activé / désactivé par le créateur du groupe ou un administrateur (clé `wellness` du groupe,
 *    écrite comme le reste : hb_upsert). Réglage de l'installation fermé : « Réservé aux essais pour l'instant », rien d'autre.
 *  - Tableau du jour : une ligne par joueur, les quatre notes colorées par rapport à SA PROPRE moyenne (28 jours d'avant :
 *    vert comme d'habitude ou mieux, ambre un peu en dessous, rouge doux nettement en dessous), gêne signalée et où, charge
 *    des 7 derniers jours comparée à sa moyenne par semaine sur 28 jours ; « pas encore répondu aujourd'hui » neutre. Barre
 *    « Demander » commune (RosterQueryBar) et deux filtres de la page. Toucher une ligne : bulle accrochée au doigt (fond
 *    flouté) avec ses 14 derniers jours et ses séances.
 * Lu à la demande (jamais gardé sur l'appareil, dans aucun export, jamais envoyé à une IA). Staff du groupe seulement : son
 * créateur et ses participants encadrants, les administrateurs (le serveur vérifie, hb_wellness_groupe).
 */

const TONE_CLS: Record<Tone, string> = {
  usual: 'border-gain/50 bg-gain/15 text-gain',
  below: 'border-spread-lo/50 bg-spread-lo/15 text-spread-lo',
  wellBelow: 'border-loss/50 bg-loss/15 text-loss',
  none: 'border-line bg-panel-2 text-fg',
}
const CHARGE_CLS: Record<ChargeTone, string> = { usual: 'text-gain', more: 'text-spread-lo', muchMore: 'text-loss', less: 'text-muted', none: 'text-muted' }

type Filter = 'pain' | 'missing'

export default function GroupWellnessPage() {
  const { id } = useParams()
  const role = useRole()
  const enabled = useWellnessEnabled()
  const data = useLiveQuery(async () => {
    const g = await db.groups.get(id!)
    const got = (await db.players.bulkGet(g?.playerIds ?? [])).filter((p): p is Player => !!p)
    return { g, players: alive(got) }
  }, [id])
  const pole = !!data?.g?.poleUnitId
  const ref = usePoleRef(data?.g?.poleUnitId)
  const pm = usePoleMembers(pole ? ref : null)
  const players = useMemo(() => (pole ? (pm?.shown ?? []) : (data?.players ?? [])), [pole, pm, data])
  const [res, setRes] = useState<{ ok: true; value: GW } | { ok: false; error: string; missing?: boolean } | null>(null)
  const [bubble, setBubble] = useState<{ p: Player; at: AxisAnchor } | null>(null)
  const [filter, setFilter] = useState<Filter | ''>('')
  const g = data?.g
  const active = !!g?.wellness && enabled
  const ids = players.map((p) => p.id).join(',')
  useEffect(() => {
    if (!g || !active || !canReadWellness(role, g)) return
    let live = true
    void fetchGroupWellness(g.id, ids ? ids.split(',') : []).then((r) => live && setRes(r))
    return () => {
      live = false
    }
  }, [g?.id, active, ids, role]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || (pole && !pm)) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (!g || g.deleted || !can.seeGroup(g)) return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>
  const gw = w(setGender(ref?.sex ?? g.sex, players))
  const t = today()
  // Le week-end, rien n'est demandé : le tableau montre le dernier jour demandé (vendredi).
  const day = staffDay(t)
  const toggle = canToggleWellness(role, g)
  const readable = canReadWellness(role, g)

  async function setWellness(on: boolean) {
    if (!g) return
    if (!on && !(await ask(`Arrêter le wellness quotidien de « ${g.name} » ? Plus rien ne sera demandé aux ${gw.joueurs} ; leurs réponses déjà données restent lisibles par eux.`, { ok: 'Arrêter', focusCancel: true }))) return
    const next: PlayerGroup = { ...g, wellness: on }
    if (on) next.wellnessSince = t
    else delete next.wellnessSince
    await save<PlayerGroup>('groups', next)
  }

  const value = res?.ok ? res.value : null
  const rows = new Map<string, StaffRow>()
  if (value) for (const p of players) rows.set(p.id, staffRow(value.entries.get(p.id) ?? [], value.sessions.get(p.id) ?? [], day))
  const withAccount = (p: Player) => !!value?.accounts.has(p.id)
  const answered = players.filter((p) => rows.get(p.id)?.today).length
  const pains = players.filter((p) => rows.get(p.id)?.today?.pain).length
  const concerned = players.filter(withAccount).length
  const sorted = [...players].sort((a, b) => {
    const ra = rows.get(a.id)
    const rb = rows.get(b.id)
    const ka = !withAccount(a) ? 2000 : ra ? staffRank(ra) : 1000
    const kb = !withAccount(b) ? 2000 : rb ? staffRank(rb) : 1000
    return ka - kb || playerName(a).localeCompare(playerName(b), 'fr')
  })
  const keep = (p: Player) => (filter === 'pain' ? !!rows.get(p.id)?.today?.pain : filter === 'missing' ? withAccount(p) && !rows.get(p.id)?.today : true)
  const own: OwnFilters = {
    panel: (
      <FilterField label="Wellness du jour" k="wl-filtre">
        <div role="radiogroup" aria-label="Wellness du jour" className="flex flex-wrap gap-1.5">
          {(
            [
              ['pain', 'Gêne signalée'],
              ['missing', 'Pas encore répondu'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={filter === v} className={pillClass(filter === v)} onClick={() => setFilter(filter === v ? '' : v)}>
              {label}
            </button>
          ))}
        </div>
      </FilterField>
    ),
    chips: filter ? [{ key: 'wl-filtre', label: filter === 'pain' ? 'Gêne signalée' : 'Pas encore répondu', onRemove: () => setFilter('') }] : [],
    onReset: () => setFilter(''),
    count: (f) => f.filter(keep).length,
  }

  return (
    <div className="flex flex-col gap-4" data-testid="wellness-groupe">
      <BackButton fallback={`/groupes/${g.id}`} label="GROUPE" className="self-start" />
      <div>
        <h1 className="text-lg font-extrabold">Wellness</h1>
        <div className="text-xs font-bold text-accent">{g.name}</div>
      </div>

      {!enabled ? (
        <div className="card p-4 text-sm" data-testid="wellness-ferme">
          <b>Réservé aux essais pour l’instant.</b>
          <p className="mt-1 text-xs text-muted">
            Le questionnaire du matin touche à la santé de mineurs : il s’ouvrira sur l’installation après la décision sur le consentement des familles et l’hébergement. Rien n’est demandé aux {gw.joueurs} d’ici là.
          </p>
        </div>
      ) : (
        <section className="card flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-bold">Wellness quotidien</div>
              <div className="text-xs text-muted">{g.wellness ? `Activé${g.wellnessSince ? ` depuis le ${shortDay(g.wellnessSince)}` : ''}` : 'Désactivé'}</div>
            </div>
            {toggle && (
              <button className={g.wellness ? 'btn-ghost min-h-11 px-4 text-sm' : 'btn-primary min-h-11 px-4 text-sm'} onClick={() => void setWellness(!g.wellness)} aria-pressed={!!g.wellness}>
                {g.wellness ? 'Désactiver' : 'Activer'}
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted">
            Du lundi au vendredi, le matin, les {gw.joueurs} du groupe qui ont un espace joueur disent leur énergie, leur fraîcheur musculaire, leur humeur et leur
            sommeil (1 à 10), et s’ils ont une douleur ou une gêne ; après une séance, l’intensité ressentie. Seuls le staff du groupe et les administrateurs le lisent.
            Rien n’est envoyé à une IA ni mis dans les exports.
          </p>
        </section>
      )}

      {active && !readable && <Empty>Le tableau est réservé au staff du groupe (créateur, participants) et aux administrateurs.</Empty>}
      {active && readable && !res && <div className="py-10 text-center text-sm text-muted">Chargement…</div>}
      {active && readable && res && !res.ok && <Empty>{res.error}</Empty>}
      {active && readable && value && (
        <>
          <p className="text-xs text-muted" data-testid="wellness-bilan">
            {day === t ? 'Aujourd’hui' : 'Week-end, rien n’est demandé. Dernier jour demandé'} (<b className="text-fg">{shortDay(day)}</b>) : <b className="text-fg">{answered}</b> réponse{answered > 1 ? 's' : ''} sur <b className="text-fg">{concerned}</b>
            {concerned < players.length && ` (${players.length - concerned} sans espace joueur)`}
            {pains > 0 && (
              <>
                {' '}
                · <b className="text-fg">{pains}</b> gêne{pains > 1 ? 's' : ''} signalée{pains > 1 ? 's' : ''}
              </>
            )}
          </p>
          <p className="text-[10px] text-muted">
            Couleurs : par rapport à <b>sa propre moyenne</b> (28 jours d’avant) — <span className="text-gain">comme d’habitude ou mieux</span>, <span className="text-spread-lo">un peu en dessous</span>,{' '}
            <span className="text-loss">nettement en dessous</span>. Charge = intensité × durée ; 7 jours comparés à sa moyenne par semaine (28 jours).
          </p>
          {players.length === 0 ? (
            <Empty>{gw.AucunJoueur} dans ce groupe.</Empty>
          ) : (
            <RosterQueryBar scope={`wellness.${g.id}`} players={sorted} own={own}>
              {(inBar) => {
                const shown = sorted.filter((p) => (!inBar || inBar.has(p.id)) && keep(p))
                return (
                  <div className="grid grid-cols-1 gap-2 wide:grid-cols-2">
                    {shown.length === 0 && <Empty>{gw.AucunJoueur} pour ce filtre.</Empty>}
                    {shown.map((p) => (
                      <WellnessRow
                        key={p.id}
                        p={p}
                        groupId={g.id}
                        row={rows.get(p.id) ?? null}
                        isToday={day === t}
                        account={withAccount(p)}
                        onOpen={(at) => setBubble({ p, at })}
                      />
                    ))}
                  </div>
                )
              }}
            </RosterQueryBar>
          )}
        </>
      )}
      {bubble && value && (
        <PlayerBubble p={bubble.p} at={bubble.at} entries={value.entries.get(bubble.p.id) ?? []} sessions={value.sessions.get(bubble.p.id) ?? []} row={rows.get(bubble.p.id) ?? null} onClose={() => setBubble(null)} />
      )}
    </div>
  )
}

/** Une ligne du tableau : nom (vers la fiche, dans le groupe), quatre notes colorées, gêne, charge. */
function WellnessRow({ p, groupId, row, account, isToday, onOpen }: { p: Player; groupId: string; row: StaffRow | null; account: boolean; isToday: boolean; onOpen: (at: AxisAnchor) => void }) {
  const e = row?.today
  return (
    <div className="card flex min-w-0 flex-col gap-1.5 p-2.5" data-testid="wellness-ligne">
      <div className="flex min-w-0 items-center gap-2">
        <Link to={`/groupes/${groupId}/joueurs/${p.id}`} state={{ md: true }} className="flex min-w-0 flex-1 items-center gap-2">
          <Avatar p={p} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{playerName(p)}</span>
            {p.position && <span className="block truncate text-[10px] text-muted">{positionLabel(p.position)}</span>}
          </span>
        </Link>
        {account && e && (
          <button
            type="button"
            className="flex shrink-0 gap-1"
            aria-label={`Détail du wellness de ${playerName(p)}`}
            onClick={(ev) => {
              const r = ev.currentTarget.getBoundingClientRect()
              onOpen({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
            }}
          >
            {WELLNESS_ITEMS.map((it) => {
              const v = e.scores[it.key]
              const tone = row!.tones[it.key]
              return (
                <span key={it.key} className={`flex w-9 flex-col items-center rounded-md border py-0.5 ${typeof v === 'number' ? TONE_CLS[tone] : 'border-line text-muted'}`} title={`${it.label} : ${v ?? '—'} (${TONE_WORDS[tone]})`}>
                  <span className="text-[8px] leading-tight opacity-80">{it.abbr}</span>
                  <span className="text-sm leading-tight font-extrabold tabular-nums">{v ?? '—'}</span>
                </span>
              )
            })}
          </button>
        )}
      </div>
      {!account ? (
        <span className="text-[11px] text-muted">Pas d’espace joueur : rien ne lui est demandé.</span>
      ) : !e ? (
        <button
          type="button"
          className="w-fit text-left text-[11px] text-muted"
          onClick={(ev) => {
            const r = ev.currentTarget.getBoundingClientRect()
            onOpen({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
          }}
        >
          {isToday ? 'Pas encore répondu aujourd’hui' : 'Pas de réponse ce jour-là'}{row?.lastDay ? ` · dernière réponse ${shortDay(row.lastDay)}` : ''}
        </button>
      ) : (
        e.pain && (
          <span className="text-[11px] break-words">
            <b className="text-spread-lo">Gêne signalée</b>
            {e.zones?.length || e.painText ? ` : ${[...(e.zones ?? []).map(zoneLabel), e.painText].filter(Boolean).join(', ')}` : ''}
            {e.painLevel ? ` · ${e.painLevel}/10 (${painWord(e.painLevel)?.toLowerCase()})` : ''}
          </span>
        )
      )}
      {account && row && (row.charge.sessions7 > 0 || row.charge.chronicWeekly > 0) && (
        <span className="text-[10px] text-muted">
          Charge 7 j : <b className="text-fg tabular-nums">{Math.round(row.charge.acute).toLocaleString('fr-FR')}</b>
          {row.charge.chronicWeekly > 0 && ` · moyenne ${Math.round(row.charge.chronicWeekly).toLocaleString('fr-FR')} / sem.`} ·{' '}
          <span className={CHARGE_CLS[row.charge.tone]}>{CHARGE_WORDS[row.charge.tone]}</span>
          {row.charge.noMinutes7 > 0 && ` · ${row.charge.noMinutes7} séance${row.charge.noMinutes7 > 1 ? 's' : ''} sans durée`}
        </span>
      )}
    </div>
  )
}

/** Bulle accrochée au doigt : ses 14 derniers jours, ses moyennes, ses séances de la semaine. */
function PlayerBubble({ p, at, entries, sessions, row, onClose }: { p: Player; at: AxisAnchor; entries: WellnessEntry[]; sessions: WellnessSession[]; row: StaffRow | null; onClose: () => void }) {
  const t = today()
  const days = [...entries].filter((e) => e.day <= t).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14)
  const week = [...sessions].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 8)
  return (
    <AnchoredBubble at={at} label={`Wellness de ${playerName(p)}`} title={playerName(p)} sub="14 derniers jours" onClose={onClose} testId="bulle-wellness">
      <div className="flex max-h-[42vh] w-full min-w-0 flex-col gap-2 overflow-y-auto">
        {row && (
          <div className="grid grid-cols-4 gap-1 text-center">
            {WELLNESS_ITEMS.map((it) => (
              <div key={it.key} className="rounded-md border border-line px-1 py-1">
                <div className="text-[9px] text-muted">{it.short}</div>
                <div className="text-[11px] font-bold tabular-nums">{row.avg[it.key] !== null ? fmt1(row.avg[it.key] as number) : '—'}</div>
                <div className="text-[8px] text-muted">sa moyenne</div>
              </div>
            ))}
          </div>
        )}
        {days.length === 0 ? (
          <p className="text-xs text-muted">Aucune réponse ces derniers jours.</p>
        ) : (
          <table className="w-full table-fixed text-center text-[11px] tabular-nums">
            <thead className="text-[9px] text-muted">
              <tr>
                <th className="w-[32%] text-left font-normal">Jour</th>
                {WELLNESS_ITEMS.map((it) => (
                  <th key={it.key} className="font-normal">
                    {it.abbr}
                  </th>
                ))}
                <th className="font-normal">Gêne</th>
              </tr>
            </thead>
            <tbody>
              {days.map((e) => (
                <tr key={e.day} className="border-t border-line">
                  <td className="truncate py-1 text-left">{shortDay(e.day)}</td>
                  {WELLNESS_ITEMS.map((it) => (
                    <td key={it.key}>{e.scores[it.key] ?? '—'}</td>
                  ))}
                  <td title={e.pain ? [...(e.zones ?? []).map(zoneLabel), e.painText].filter(Boolean).join(', ') : undefined}>{e.pain ? (e.painLevel ? `${e.painLevel}/10` : '•') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {week.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-muted">Séances récentes</div>
            <ul className="text-[11px]">
              {week.map((s) => (
                <li key={s.id}>
                  {shortDay(s.day)} · intensité {s.rpe}/10{s.minutes ? ` · ${s.minutes} min · charge ${s.rpe * s.minutes}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AnchoredBubble>
  )
}
