import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { AnchoredBubble } from '../components/AnchoredBubble'
import { ask } from '../components/Confirm'
import { FilterField, pillClass } from '../components/FilterWindow'
import { RosterQueryBar, type OwnFilters } from '../components/PlayersQuery'
import { usePoleMembers, usePoleRef } from '../components/PoleGroup'
import { Empty, playerName, Avatar } from '../components/ui'
import { canReadWellness, canToggleWellness, ChargeLine, PainLines, PainSummary, PAIN_TEXT_CLS, ScoreChip, shortDay, useWellnessEnabled } from '../components/Wellness'
import type { AxisAnchor } from '../components/ZoneRadar'
import { useGroupZone, useLampSettings } from '../components/LampStaff'
import { isRequestedDay } from '../lamp'
import { alive, db, positionLabel, save, today, type Player, type PlayerGroup } from '../db'
import { pluralG, setGender, w } from '../gender'
import { can, useRole } from '../roles'
import {
  fmt1,
  isWeekday,
  painLine,
  painMax,
  painTone,
  sessionLoad,
  staffDay,
  staffRank,
  staffRow,
  WELLNESS_ITEMS,
  type StaffRow,
  type WellnessKey,
  type WellnessEntry,
  type WellnessSession,
} from '../wellness'
import { fetchGroupWellness, type GroupWellness as GW } from '../wellnessApi'
import {
  ALERT_DAYS_CHOICES,
  ALERT_MAX_CHOICES,
  alertSettingsOf,
  alertText,
  askMatch,
  criterionParam,
  criterionText,
  lowAlert,
  lowStreak,
  notesText,
  parseCriterionParam,
  wellnessAsk,
  WELLNESS_ASK_FRESH_DAYS,
  type AlertSettings,
  type AskHit,
} from '../wellnessAlert'

/*
 * Wellness d'un groupe, côté STAFF (/groupes/:id/wellness ; supabase/073_wellness.sql, src/wellness.ts) :
 *  - « Wellness quotidien » : activé / désactivé par le créateur du groupe ou un administrateur (clé `wellness` du groupe,
 *    écrite comme le reste : hb_upsert). Réglage de l'installation fermé : « Réservé aux essais pour l'instant », rien d'autre.
 *  - Tableau du jour : une ligne par joueur, les quatre notes colorées par rapport à SA PROPRE moyenne (28 jours d'avant :
 *    vert comme d'habitude ou mieux, ambre un peu en dessous, rouge doux nettement en dessous), gênes signalées (une ligne par
 *    endroit : « Ischio-jambiers droits · Contracture · 6/10 », pastille colorée par l'intensité la plus forte), charge
 *    des 7 derniers jours comparée à sa moyenne par semaine sur 28 jours ; « pas encore répondu aujourd'hui » neutre. Barre
 *    « Demander » commune (RosterQueryBar) et deux filtres de la page. Toucher les notes : bulle accrochée au doigt (fond
 *    flouté) avec ses 14 derniers jours et ses séances ; toucher le nom : sa fiche, sur l'onglet Wellness
 *    (src/components/PlayerWellness.tsx ; « Retour » revient ici). Notes et charge : composants communs (components/Wellness.tsx).
 *  - Alerte (src/wellnessAlert.ts) : 5 ou moins (moyenne des notes, ou une note réglée) pendant 3 jours demandés de suite :
 *    bandeau au-dessus du tableau (noms, « Voir seulement eux »), pastille sur la ligne, filtre, série dans la bulle, le
 *    joueur remonte dans le tableau. Seuil, durée et note réglables (bulle « Régler », ceux qui activent le wellness).
 *  - « Demander » (barre de la page, ou l'en-tête : ?wl=… dans l'adresse) : « les joueurs en dessous de 6 dans le
 *    wellness », « sommeil sous 5 » : compris sur l'appareil (rien ne part), sur la dernière réponse de chacun (7 jours au
 *    plus), dont la ligne dit la valeur et le jour.
 * Lu à la demande (jamais gardé sur l'appareil, dans aucun export, jamais envoyé à une IA). Staff du groupe seulement : son
 * créateur et ses participants encadrants, les administrateurs (le serveur vérifie, hb_wellness_groupe).
 */

type Filter = 'pain' | 'missing' | 'alert'

export default function GroupWellnessPage() {
  const { id } = useParams()
  const role = useRole()
  const enabled = useWellnessEnabled()
  const lamp = useLampSettings()
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
  const [settingsAt, setSettingsAt] = useState<AxisAnchor | null>(null)
  // Critère dit à « Demander » (dans l'adresse : retrouvé au « Retour » d'une fiche ; jamais une donnée).
  const [sp, setSp] = useSearchParams()
  const crit = parseCriterionParam(sp.get('wl'))
  const setCrit = (c: ReturnType<typeof parseCriterionParam>) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (c) n.set('wl', criterionParam(c))
        else n.delete('wl')
        return n
      },
      { replace: true },
    )
  const g = data?.g
  const zone = useGroupZone(g)
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
  const gender = setGender(ref?.sex ?? g.sex, players)
  // Jours demandés de l'alerte : lundi → vendredi ; zone du pôle connue : sans vacances scolaires ni jours fériés (src/lamp.ts).
  const requestedDay = zone ? (d: string) => isRequestedDay(d, zone) : isWeekday
  const alertCfg = alertSettingsOf(g.wellnessAlert)

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
  // Alerte : la série en cours de chacun (jours demandés de suite à `max` ou moins), levée à `days` jours.
  const streaks = new Map<string, string[]>()
  if (value) for (const p of players) if (withAccount(p)) streaks.set(p.id, lowStreak(value.entries.get(p.id) ?? [], t, alertCfg, requestedDay))
  const alertOf = (p: Player) => {
    const st = streaks.get(p.id)
    return st && lowAlert(st, alertCfg) ? st : null
  }
  const alerted = players.filter((p) => !!alertOf(p))
  // « Demander » : dernière réponse de chacun comparée au critère dit.
  const hits = new Map<string, AskHit>()
  if (value && crit) for (const p of players) if (withAccount(p)) {
    const h = askMatch(value.entries.get(p.id) ?? [], t, crit)
    if (h) hits.set(p.id, h)
  }
  const answered = players.filter((p) => rows.get(p.id)?.today).length
  const pains = players.filter((p) => rows.get(p.id)?.today?.pain).length
  const concerned = players.filter(withAccount).length
  const sorted = [...players].sort((a, b) => {
    const ra = rows.get(a.id)
    const rb = rows.get(b.id)
    const ka = !withAccount(a) ? 2000 : (ra ? staffRank(ra) : 1000) - (alertOf(a) ? 200 : 0)
    const kb = !withAccount(b) ? 2000 : (rb ? staffRank(rb) : 1000) - (alertOf(b) ? 200 : 0)
    return ka - kb || playerName(a).localeCompare(playerName(b), 'fr')
  })
  const keep = (p: Player) =>
    (!crit || hits.has(p.id)) &&
    (filter === 'pain' ? !!rows.get(p.id)?.today?.pain : filter === 'missing' ? withAccount(p) && !rows.get(p.id)?.today : filter === 'alert' ? !!alertOf(p) : true)
  const FILTER_LABEL: Record<Filter, string> = { pain: 'Gêne signalée', missing: 'Pas encore répondu', alert: `Alerte : ${alertCfg.days} jours à ${alertCfg.max} ou moins` }
  const own: OwnFilters = {
    panel: (
      <FilterField label="Wellness du jour" k="wl-filtre">
        <div role="radiogroup" aria-label="Wellness du jour" className="flex flex-wrap gap-1.5">
          {(['pain', 'missing', 'alert'] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={filter === v} className={pillClass(filter === v)} onClick={() => setFilter(filter === v ? '' : v)}>
              {FILTER_LABEL[v]}
            </button>
          ))}
        </div>
      </FilterField>
    ),
    chips: [
      ...(filter ? [{ key: 'wl-filtre', label: FILTER_LABEL[filter], onRemove: () => setFilter('') }] : []),
      ...(crit ? [{ key: 'wl-demande', label: `Wellness : ${criterionText(crit)}`, onRemove: () => setCrit(null) }] : []),
    ],
    onReset: () => {
      setFilter('')
      setCrit(null)
    },
    count: (f) => f.filter(keep).length,
    // « Les joueurs en dessous de 6 dans le wellness », « sommeil sous 5 » : compris ici (src/wellnessAlert.ts), rien ne part.
    ask: (phrase) => {
      const c = wellnessAsk(phrase)
      if (!c) return false
      setCrit(c)
      return true
    },
  }
  async function saveAlert(next: AlertSettings) {
    if (!g) return
    const v: NonNullable<PlayerGroup['wellnessAlert']> = { max: next.max, days: next.days, ...(next.note ? { note: next.note } : {}) }
    await save<PlayerGroup>('groups', { ...g, wellnessAlert: v })
  }

  return (
    <div className="flex flex-col gap-4" data-testid="wellness-groupe">
      <BackButton fallback={`/groupes/${g.id}`} label="GROUPE" className="self-start" />
      <div>
        <h1 className="text-lg font-extrabold">Wellness</h1>
        <div className="text-xs font-bold text-accent">{g.name}</div>
      </div>
      {active && readable && lamp.actif && (
        <Link to={`/groupes/${g.id}/lampes`} className="-mt-2 self-start py-1 text-xs font-bold text-accent" data-testid="lien-lampes">
          🪔 Lampes du groupe ›
        </Link>
      )}

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
            sommeil (1 à 10), et s’ils ont une douleur ou une gêne (pour chaque endroit : ce que c’est et son intensité) ; après une séance,
            l’intensité ressentie et la durée. Seuls le staff du groupe et les administrateurs le lisent.
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
            <span className="text-loss">nettement en dessous</span>. Gêne : une ligne par endroit, pastille selon l’intensité la plus forte (1 à 3, <span className="text-spread-lo">4 à 6</span>, <span className="text-loss">7 à 10</span>). Charge =
            intensité × durée ; 7 jours comparés à sa moyenne par semaine (28 jours).
          </p>
          <AlertBanner
            cfg={alertCfg}
            alerted={alerted}
            gender={gender}
            canSet={toggle}
            filterOn={filter === 'alert'}
            onFilter={() => setFilter(filter === 'alert' ? '' : 'alert')}
            onSettings={setSettingsAt}
          />
          {crit && (
            <p className="text-[11px] text-muted" data-testid="wellness-demande">
              Wellness : <b className="text-fg">{criterionText(crit)}</b>, sur la dernière réponse de chacun ({WELLNESS_ASK_FRESH_DAYS} jours au plus) :{' '}
              <b className="text-fg">{pluralG(hits.size, gender)}</b>.
            </p>
          )}
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
                        alert={alertOf(p)}
                        alertCfg={alertCfg}
                        hit={hits.get(p.id) ?? null}
                        today={t}
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
        <PlayerBubble
          p={bubble.p}
          at={bubble.at}
          entries={value.entries.get(bubble.p.id) ?? []}
          sessions={value.sessions.get(bubble.p.id) ?? []}
          row={rows.get(bubble.p.id) ?? null}
          alert={alertOf(bubble.p)}
          alertCfg={alertCfg}
          onClose={() => setBubble(null)}
        />
      )}
      {settingsAt && <AlertSettingsBubble at={settingsAt} cfg={alertCfg} onSave={(c) => void saveAlert(c)} onClose={() => setSettingsAt(null)} />}
    </div>
  )
}

/** Une ligne du tableau : nom (vers la fiche, dans le groupe), quatre notes colorées, gêne, charge. */
function WellnessRow({
  p,
  groupId,
  row,
  account,
  isToday,
  alert,
  alertCfg,
  hit,
  today: t,
  onOpen,
}: {
  p: Player
  groupId: string
  row: StaffRow | null
  account: boolean
  isToday: boolean
  alert: string[] | null
  alertCfg: AlertSettings
  hit: AskHit | null
  today: string
  onOpen: (at: AxisAnchor) => void
}) {
  const e = row?.today
  return (
    <div className="card flex min-w-0 flex-col gap-1.5 p-2.5" data-testid="wellness-ligne">
      <div className="flex min-w-0 items-center gap-2">
        <Link to={`/groupes/${groupId}/joueurs/${p.id}?onglet=wellness`} state={{ md: true }} className="flex min-w-0 flex-1 items-center gap-2">
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
            {WELLNESS_ITEMS.map((it) => (
              <ScoreChip key={it.key} item={it} value={e.scores[it.key]} tone={row!.tones[it.key]} />
            ))}
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
        <PainSummary entry={e} />
      )}
      {alert && (
        <span className="w-fit rounded-full border border-spread-lo/50 px-2 py-0.5 text-[10px] font-bold text-spread-lo" data-testid="wellness-alerte-ligne">
          🔋 {alert.length} jours de suite à {alertCfg.max} ou moins ({notesText(alertCfg.note ? [alertCfg.note] : [])})
        </span>
      )}
      {hit && (
        <span className="text-[11px] text-muted" data-testid="wellness-demande-ligne">
          {hit.values.map((v) => `${v.label[0].toUpperCase()}${v.label.slice(1)} ${fmt1(v.value)}`).join(' · ')} · {hit.day === t ? 'réponse du jour' : `réponse du ${shortDay(hit.day)}`}
        </span>
      )}
      {account && row && <ChargeLine charge={row.charge} />}
    </div>
  )
}

/** Bulle accrochée au doigt : ses 14 derniers jours, ses moyennes, ses séances de la semaine. */
function PlayerBubble({
  p,
  at,
  entries,
  sessions,
  row,
  alert,
  alertCfg,
  onClose,
}: {
  p: Player
  at: AxisAnchor
  entries: WellnessEntry[]
  sessions: WellnessSession[]
  row: StaffRow | null
  alert: string[] | null
  alertCfg: AlertSettings
  onClose: () => void
}) {
  const t = today()
  const days = [...entries].filter((e) => e.day <= t).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14)
  const week = [...sessions].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 8)
  const withPain = days.filter((e) => painMax(e) !== null)
  return (
    <AnchoredBubble at={at} label={`Wellness de ${playerName(p)}`} title={playerName(p)} sub="14 derniers jours" onClose={onClose} testId="bulle-wellness">
      <div className="flex max-h-[42vh] w-full min-w-0 flex-col gap-2 overflow-y-auto">
        {alert && (
          <p className="rounded-md border border-spread-lo/50 px-2 py-1 text-[11px]" data-testid="bulle-alerte">
            <b className="text-spread-lo">🔋 {alertText({ ...alertCfg, days: alert.length })}</b>
            <span className="block text-muted">{[...alert].reverse().map(shortDay).join(' · ')}</span>
          </p>
        )}
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
              {days.map((e) => {
                const max = painMax(e)
                return (
                  <tr key={e.day} className="border-t border-line">
                    <td className="truncate py-1 text-left">{shortDay(e.day)}</td>
                    {WELLNESS_ITEMS.map((it) => (
                      <td key={it.key}>{e.scores[it.key] ?? '—'}</td>
                    ))}
                    <td className={max !== null ? `font-bold ${PAIN_TEXT_CLS[painTone(max)]}` : ''} title={e.pains?.map(painLine).join(' ; ')}>
                      {max !== null ? `${max}/10` : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {withPain.length > 0 && (
          <div data-testid="bulle-douleurs">
            <div className="text-[10px] font-bold text-muted">Gênes signalées</div>
            <ul className="flex flex-col gap-1 text-[11px]">
              {withPain.map((e) => (
                <li key={e.day}>
                  <span className="text-muted">{shortDay(e.day)}</span>
                  <PainLines pains={e.pains ?? []} />
                </li>
              ))}
            </ul>
          </div>
        )}
        {week.length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-muted">Séances récentes</div>
            <ul className="text-[11px]">
              {week.map((s) => (
                <li key={s.id}>
                  {shortDay(s.day)} · intensité {s.rpe}/10 · {s.minutes} min · charge {sessionLoad(s)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AnchoredBubble>
  )
}

const noteShort = (k: WellnessKey) => WELLNESS_ITEMS.find((x) => x.key === k)?.short.toLowerCase() ?? k

/**
 * Bandeau de l'alerte, au-dessus du tableau : les joueurs à `max` ou moins depuis `days` jours demandés de suite (noms, puis
 * « Voir seulement eux ») ; personne : une petite ligne neutre. « Régler » : ceux qui activent le wellness du groupe.
 */
function AlertBanner({
  cfg,
  alerted,
  gender,
  canSet,
  filterOn,
  onFilter,
  onSettings,
}: {
  cfg: AlertSettings
  alerted: Player[]
  gender: ReturnType<typeof setGender>
  canSet: boolean
  filterOn: boolean
  onFilter: () => void
  onSettings: (at: AxisAnchor) => void
}) {
  const settings = canSet && (
    <button
      type="button"
      className="min-h-9 shrink-0 px-2 text-[11px] font-bold text-accent"
      data-testid="alerte-regler"
      onClick={(ev) => {
        const r = ev.currentTarget.getBoundingClientRect()
        onSettings({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
      }}
    >
      Régler
    </button>
  )
  if (!alerted.length)
    return (
      <div className="-my-1 flex items-center justify-between gap-2 text-[11px] text-muted" data-testid="wellness-alerte-vide">
        <span>
          🔋 Alerte : {alertText(cfg)} · {w(gender).aucunJoueur} pour l’instant.
        </span>
        {settings}
      </div>
    )
  return (
    <section className="card flex flex-col gap-1.5 border-spread-lo/60 p-3" data-testid="wellness-alerte">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <b className="text-spread-lo">🔋 À recharger</b> · {pluralG(alerted.length, gender)} {alerted.length > 1 ? 'sont' : 'est'} à {cfg.max} ou moins depuis au moins {cfg.days} jours demandés de suite
          <span className="text-muted"> ({notesText(cfg.note ? [cfg.note] : [])})</span>
        </div>
        {settings}
      </div>
      <div className="flex flex-wrap gap-1 text-xs">
        {alerted.map((p) => (
          <span key={p.id} className="rounded-full border border-line px-2 py-0.5 font-bold">
            {playerName(p)}
          </span>
        ))}
      </div>
      <button type="button" className={`${pillClass(filterOn)} self-start`} aria-pressed={filterOn} onClick={onFilter}>
        {filterOn ? 'Voir tout le groupe' : 'Voir seulement l’alerte'}
      </button>
      <p className="text-[10px] text-muted">Jours demandés : du lundi au vendredi (sans les vacances scolaires ni les jours fériés quand la zone est connue) ; un jour demandé sans réponse remet le compte à zéro.</p>
    </section>
  )
}

/** Réglage de l'alerte (bulle accrochée, fond flouté) : seuil, jours de suite, note suivie. Écrit sur le groupe. */
function AlertSettingsBubble({ at, cfg, onSave, onClose }: { at: AxisAnchor; cfg: AlertSettings; onSave: (c: AlertSettings) => void; onClose: () => void }) {
  const set = (patch: Partial<AlertSettings>) => onSave({ ...cfg, ...patch })
  return (
    <AnchoredBubble at={at} label="Régler l’alerte du wellness" title="Alerte du wellness" sub={alertText(cfg)} onClose={onClose} testId="bulle-alerte-reglage">
      <div className="flex w-full min-w-0 flex-col gap-2 text-xs">
        <div>
          <div className="mb-1 text-[10px] font-bold text-muted">Note suivie</div>
          <div className="flex flex-wrap gap-1">
            {([null, ...WELLNESS_ITEMS.map((x) => x.key)] as (WellnessKey | null)[]).map((k) => (
              <button key={k ?? 'moyenne'} type="button" className={pillClass(cfg.note === k)} aria-pressed={cfg.note === k} onClick={() => set({ note: k })}>
                {k ? noteShort(k) : 'moyenne des notes'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-bold text-muted">À … ou moins</div>
          <div className="flex flex-wrap gap-1">
            {ALERT_MAX_CHOICES.map((n) => (
              <button key={n} type="button" className={pillClass(cfg.max === n)} aria-pressed={cfg.max === n} onClick={() => set({ max: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-bold text-muted">Jours demandés de suite</div>
          <div className="flex flex-wrap gap-1">
            {ALERT_DAYS_CHOICES.map((n) => (
              <button key={n} type="button" className={pillClass(cfg.days === n)} aria-pressed={cfg.days === n} onClick={() => set({ days: n })}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-muted">Pour tout le staff du groupe.</p>
      </div>
    </AnchoredBubble>
  )
}
