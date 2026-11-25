import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BackButton, useEntryState } from '../backNav'
import { AnchoredBubble } from '../components/AnchoredBubble'
import { ask } from '../components/Confirm'
import { FilterField, pillClass } from '../components/FilterWindow'
import { RosterQueryBar, type OwnFilters } from '../components/PlayersQuery'
import { usePoleMembers, usePoleRef } from '../components/PoleGroup'
import { canReadWellness, canToggleWellness, ChargeLine, PainLines, PainSummary, PAIN_TEXT_CLS, shortDay, useWellnessEnabled } from '../components/Wellness'
import { GroupTile } from '../components/GroupTile'
import { Empty, Icon, playerName } from '../components/ui'
import { PlayerAvatar } from '../components/LevelRing'
import type { AxisAnchor } from '../components/ZoneRadar'
import { useGroupZone, useLampSettings } from '../components/LampStaff'
import { isRequestedDay } from '../lamp'
import { alive, db, positionLabel, save, today, type Player, type PlayerGroup } from '../db'
import { pluralG, setGender, w } from '../gender'
import { can, useRole } from '../roles'
import {
  addDays,
  daysBetween,
  fmt1,
  formeBand,
  formeTrend,
  gapText,
  gaugeGap,
  groupPeriod,
  isDay,
  nextStaffDay,
  PERIOD_KEYS,
  PERIOD_LABEL,
  periodBounds,
  PERIOD_GAP,
  prevStaffDay,
  type Gauge,
  type GroupPeriod,
  type PeriodKey,
  formeDuJour,
  formeTitle,
  formeWord,
  FORME_HOW,
  groupDay,
  isWeekday,
  levelBand,
  TONE_WORDS,
  WELLNESS_PICTO,
  type Forme,
  type Tone,
  painLine,
  painMax,
  painTone,
  sessionLoad,
  staffDay,
  staffRank,
  staffRow,
  WELLNESS_ITEMS,
  WELLNESS_KEYS,
  type StaffRow,
  type WellnessKey,
  type WellnessEntry,
  type WellnessSession,
} from '../wellness'
import { fetchGroupAverages, fetchGroupWellness, type GroupWellness as GW } from '../wellnessApi'
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
 *  - Tableau du jour : une ligne par joueur, les quatre notes comparées à SA PROPRE moyenne (28 jours d’avant :
 *    repère ▾ un peu en dessous, ▾▾ nettement en dessous), gênes signalées (une ligne par
 *    endroit : « Ischio-jambiers droits · Contracture · 6/10 », pastille colorée par l'intensité la plus forte), charge
 *    des 7 derniers jours comparée à sa moyenne par semaine sur 28 jours ; « pas encore répondu aujourd'hui » neutre. Barre
 *    « Demander » commune (RosterQueryBar) et deux filtres de la page. Toucher les notes : bulle accrochée au doigt (fond
 *    flouté) avec ses 14 derniers jours et ses séances ; toucher le nom : sa fiche, sur l'onglet Wellness
 *    (src/components/PlayerWellness.tsx ; « Retour » revient ici). Notes et charge : composants communs (components/Wellness.tsx).
 *  - Depuis le 23/11 (« trop austère ») : en-tête pêche → corail avec le résumé du jour (forme moyenne, réponses, moyenne de
 *    chaque note), cartes aérées liserées selon la « forme du jour » du joueur (pastille ronde sur 10 : moyenne des notes
 *    moins un quart de la gêne la plus forte, src/wellness.ts : formeDuJour), notes avec picto, colorées selon la note (rouge
 *    doux → turquoise) ; « ▾ » / « ▾▾ » : en dessous de SA propre moyenne. Légende repliée « Comment lire le tableau ».
 *  - Alerte (src/wellnessAlert.ts) : 5 ou moins (moyenne des notes, ou une note réglée) pendant 3 jours demandés de suite :
 *    bandeau au-dessus du tableau (noms, « Voir seulement eux »), pastille sur la ligne, filtre, série dans la bulle, le
 *    joueur remonte dans le tableau. Seuil, durée et note réglables (bulle « Régler », ceux qui activent le wellness).
 *  - « Demander » (barre de la page, ou l'en-tête : ?wl=… dans l'adresse) : « les joueurs en dessous de 6 dans le
 *    wellness », « sommeil sous 5 » : compris sur l'appareil (rien ne part), sur la dernière réponse de chacun (7 jours au
 *    plus), dont la ligne dit la valeur et le jour.
 *  - Depuis le 23/11 (« changer de jour », « comparer dans le temps », « les cases ne sautent pas aux yeux ») :
 *    · ‹ jour › dans l'en-tête (jours de semaine) et une bulle accrochée (derniers jours demandés, il y a 1 semaine / 1 mois
 *      / 1 an, une date) ; le jour choisi est gardé dans l'entrée d'historique (useEntryState : « Retour » y revient). Un jour
 *      passé : hb_wellness_groupe_au (082 ; absent : hb_wellness_groupe sur 120 jours au plus) ; l'alerte reste au jour présent.
 *    · « Le groupe dans le temps » : une jauge par note (forme, énergie, fraîcheur, humeur, sommeil) remplie jusqu'à la
 *      moyenne du groupe ce jour-là, repères « 7 j », « 30 j » (lus avec le tableau) et « 1 an » (mêmes semaines l'an dernier :
 *      hb_wellness_groupe_moyennes, 082, moyennes du groupe seulement ; absent : le repère se tait) ; un mot court quand
 *      l'écart atteint un point (src/wellness.ts : periodBounds, groupPeriod, gaugeGap ; test : tools/test-wellness-periodes.ts).
 *    · Cartes regroupées (à regarder, ont répondu, pas encore répondu, sans espace joueur) ; sans réponse ce jour-là : sa
 *      dernière réponse, atténuée et datée, avec ses couleurs ; petites barres de sa forme des 10 derniers jours demandés.
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
  // Réponse lue pour un jour (jamais gardée sur l'appareil : en mémoire, le temps de la page).
  const [res, setRes] = useState<{ day: string; r: { ok: true; value: GW } | { ok: false; error: string; missing?: boolean } } | null>(null)
  // Moyennes du groupe « même période l'an dernier » (082 ; absent : le repère se tait).
  const [lastYear, setLastYear] = useState<{ day: string; p: GroupPeriod | null } | null>(null)
  // Jour choisi (‹ ›, une date) : gardé dans l'entrée d'historique (« Retour » revient sur ce jour) ; null : le jour présent.
  const [picked, setPicked] = useEntryState<string | null>(`wellness.${id}.jour`, null)
  const [pickAt, setPickAt] = useState<AxisAnchor | null>(null)
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
  const t = today()
  // Le week-end, rien n'est demandé : le jour présent du tableau est le dernier jour demandé (vendredi).
  const last = staffDay(t)
  const day = picked && isDay(picked) && picked < last ? picked : last
  const isCurrent = day === last
  useEffect(() => {
    if (!g || !active || !canReadWellness(role, g)) return
    let live = true
    const list = ids ? ids.split(',') : []
    void fetchGroupWellness(g.id, list, 35, isCurrent ? undefined : day).then((r) => live && setRes({ day, r }))
    const an = periodBounds(day).an
    void fetchGroupAverages(g.id, list, [{ key: 'an', ...an }]).then((r) => live && setLastYear({ day, p: r.ok ? (r.value.get('an') ?? null) : null }))
    return () => {
      live = false
    }
  }, [g?.id, active, ids, role, day]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || (pole && !pm)) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (!g || g.deleted || !can.seeGroup(g)) return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>
  const gw = w(setGender(ref?.sex ?? g.sex, players))
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

  const cur = res?.day === day ? res.r : null
  const value = cur?.ok ? cur.value : null
  const rows = new Map<string, StaffRow>()
  if (value) for (const p of players) rows.set(p.id, staffRow(value.entries.get(p.id) ?? [], value.sessions.get(p.id) ?? [], day))
  const withAccount = (p: Player) => !!value?.accounts.has(p.id)
  // Alerte : la série en cours de chacun (jours demandés de suite à `max` ou moins), levée à `days` jours. Jour présent seulement.
  const streaks = new Map<string, string[]>()
  if (value && isCurrent) for (const p of players) if (withAccount(p)) streaks.set(p.id, lowStreak(value.entries.get(p.id) ?? [], t, alertCfg, requestedDay))
  const alertOf = (p: Player) => {
    const st = streaks.get(p.id)
    return st && lowAlert(st, alertCfg) ? st : null
  }
  const alerted = players.filter((p) => !!alertOf(p))
  // « Demander » : dernière réponse de chacun comparée au critère dit.
  const hits = new Map<string, AskHit>()
  if (value && crit) for (const p of players) if (withAccount(p)) {
    const h = askMatch(value.entries.get(p.id) ?? [], day, crit)
    if (h) hits.set(p.id, h)
  }
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
  const FILTER_LABEL: Record<Filter, string> = { pain: 'Gêne signalée', missing: isCurrent && day === t ? 'Pas encore répondu' : 'Pas de réponse ce jour-là', alert: `Alerte : ${alertCfg.days} jours à ${alertCfg.max} ou moins` }
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

  // Le groupe ce jour-là (en-tête) : réponses, forme moyenne, moyenne de chaque note.
  const roster = players.filter(withAccount)
  const gday = value ? groupDay(roster.map((p) => rows.get(p.id)?.today)) : null
  const board = active && readable
  const showTable = board && !!value
  // Jauges : le jour face aux 7 et 30 derniers jours (lus avec le tableau) et à la même période l'an dernier (082 ; essai : ici).
  const gauges = (() => {
    if (!value || !gday) return null
    const lists = roster.map((p) => value.entries.get(p.id) ?? [])
    const b = periodBounds(day)
    const per: Record<PeriodKey, GroupPeriod | null> = {
      semaine: groupPeriod(lists, b.semaine.from, b.semaine.to),
      mois: groupPeriod(lists, b.mois.from, b.mois.to),
      an: lastYear?.day === day ? lastYear.p : null,
    }
    const refs = (pick: (x: GroupPeriod) => number | null) => {
      const out = {} as Gauge['refs']
      for (const k of PERIOD_KEYS) {
        const x = per[k]
        out[k] = x && x.answers ? pick(x) : null
      }
      return out
    }
    return {
      forme: { value: gday.forme, refs: refs((x) => x.forme) } as Gauge,
      notes: WELLNESS_ITEMS.map((it) => ({ it, g: { value: gday.avg[it.key], refs: refs((x) => x.avg[it.key]) } as Gauge })),
      lastYearKnown: !!per.an?.answers,
    }
  })()
  const pickDay = (d: string | null) => setPicked(d && d < last ? d : null)
  const settingsCard = !enabled ? (
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
  )

  return (
    <div className="flex flex-col gap-4" data-testid="wellness-groupe">
      <BackButton fallback={`/groupes/${g.id}`} label="GROUPE" className="self-start" />
      {/* En-tête chaleureux (23/11, « trop austère ») : cœur pêche → corail, nom du groupe, jour choisi, résumé du jour. */}
      <header className="card relative flex flex-col gap-3 overflow-hidden border-rose-400/30 bg-gradient-to-br from-orange-400/15 via-rose-500/10 to-panel p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-300 to-rose-500 text-white shadow-md shadow-rose-500/30">
            <Icon name="heart" className="h-6 w-6" filled />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl leading-tight font-extrabold">Wellness</h1>
            <div className="truncate text-xs font-bold text-rose-300">{g.name}</div>
          </div>
          {board && lamp.actif && <GroupTile to={`/groupes/${g.id}/lampes`} icon="lamp" title="Lampes" tone="lamp" testId="lien-lampes" compact />}
        </div>
        {board && <DayNav day={day} last={last} today={t} onPick={pickDay} onOpenPicker={setPickAt} />}
        {showTable && gday && <DaySummary gday={gday} concerned={concerned} pains={pains} waiting={day === t} />}
      </header>

      {!board && settingsCard}

      {active && !readable && <Empty>Le tableau est réservé au staff du groupe (créateur, participants) et aux administrateurs.</Empty>}
      {board && !cur && <div className="py-10 text-center text-sm text-muted">Chargement…</div>}
      {board && cur && !cur.ok && <Empty>{cur.error}</Empty>}
      {board && value && (
        <>
          {gauges && <GroupGauges day={day} today={t} forme={gauges.forme} notes={gauges.notes} lastYearKnown={gauges.lastYearKnown} lastYearLoading={lastYear?.day !== day} />}
          <Legend />
          {isCurrent ? (
            <AlertBanner
              cfg={alertCfg}
              alerted={alerted}
              gender={gender}
              canSet={toggle}
              filterOn={filter === 'alert'}
              onFilter={() => setFilter(filter === 'alert' ? '' : 'alert')}
              onSettings={setSettingsAt}
            />
          ) : (
            <p className="-my-1 text-[11px] text-muted">🔋 L’alerte se lit sur le jour présent.</p>
          )}
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
                // Regroupés : ce qui demande un regard d'abord (gêne, notes sous son habitude, alerte), puis les réponses du jour,
                // puis ceux qui n'ont pas répondu (leur dernière réponse, atténuée), puis les fiches sans espace joueur.
                const sectionOf = (p: Player): Section => {
                  if (!withAccount(p)) return 'none'
                  const r = rows.get(p.id)
                  if (!r?.today) return 'wait'
                  const below = WELLNESS_KEYS.some((k) => r.tones[k] === 'below' || r.tones[k] === 'wellBelow')
                  return r.today.pain || below || alertOf(p) ? 'look' : 'ok'
                }
                const bySection = new Map<Section, Player[]>()
                for (const p of shown) {
                  const k = sectionOf(p)
                  bySection.set(k, [...(bySection.get(k) ?? []), p])
                }
                return (
                  <div className="flex flex-col gap-4">
                    {shown.length === 0 && <Empty>{gw.AucunJoueur} pour ce filtre.</Empty>}
                    {SECTIONS.filter((k) => bySection.has(k)).map((k) => (
                      <section key={k} className="flex flex-col gap-2" data-testid={`wellness-section-${k}`}>
                        <h2 className="flex items-center gap-2 text-[11px] font-extrabold tracking-wider text-muted uppercase">
                          <span aria-hidden>{SECTION_LABEL[k].emoji}</span>
                          {k === 'wait' && day !== t ? 'Pas de réponse ce jour-là' : SECTION_LABEL[k].label}
                          <span className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[10px] text-fg tabular-nums">{bySection.get(k)!.length}</span>
                          {SECTION_LABEL[k].hint && <span className="min-w-0 truncate font-normal tracking-normal normal-case">{SECTION_LABEL[k].hint}</span>}
                        </h2>
                        <div className="grid grid-cols-1 gap-3 wide:grid-cols-2">
                          {bySection.get(k)!.map((p) => (
                            <WellnessRow
                              key={p.id}
                              p={p}
                              groupId={g.id}
                              row={rows.get(p.id) ?? null}
                              entries={value.entries.get(p.id) ?? []}
                              day={day}
                              isToday={day === t}
                              account={withAccount(p)}
                              alert={alertOf(p)}
                              alertCfg={alertCfg}
                              hit={hits.get(p.id) ?? null}
                              onOpen={(at) => setBubble({ p, at })}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )
              }}
            </RosterQueryBar>
          )}
          {settingsCard}
        </>
      )}
      {bubble && value && (
        <PlayerBubble
          p={bubble.p}
          at={bubble.at}
          day={day}
          entries={value.entries.get(bubble.p.id) ?? []}
          sessions={value.sessions.get(bubble.p.id) ?? []}
          row={rows.get(bubble.p.id) ?? null}
          alert={alertOf(bubble.p)}
          alertCfg={alertCfg}
          onClose={() => setBubble(null)}
        />
      )}
      {settingsAt && <AlertSettingsBubble at={settingsAt} cfg={alertCfg} onSave={(c) => void saveAlert(c)} onClose={() => setSettingsAt(null)} />}
      {pickAt && (
        <DayPickerBubble
          at={pickAt}
          day={day}
          last={last}
          today={t}
          onPick={(d) => {
            pickDay(d)
            setPickAt(null)
          }}
          onClose={() => setPickAt(null)}
        />
      )}
    </div>
  )
}

type Section = 'look' | 'ok' | 'wait' | 'none'
const SECTIONS: readonly Section[] = ['look', 'ok', 'wait', 'none']
const SECTION_LABEL: Record<Section, { emoji: string; label: string; hint?: string }> = {
  look: { emoji: '👀', label: 'À regarder', hint: 'gêne, ou note sous son habitude' },
  ok: { emoji: '✅', label: 'Ont répondu' },
  wait: { emoji: '☕', label: 'Pas encore répondu' },
  none: { emoji: '·', label: 'Sans espace joueur' },
}

// ---------- Jour choisi : ‹ jour › et la bulle du choix ----------

/** « lun. 9 nov. » (avec l'année si ce n'est pas celle d'aujourd'hui). */
const longDay = (day: string, t: string) => `${shortDay(day)}${day.slice(0, 4) !== t.slice(0, 4) ? ` ${day.slice(0, 4)}` : ''}`
/** « Aujourd’hui », « Hier », « Avant-hier », sinon null. */
function nearName(day: string, t: string): string | null {
  const n = daysBetween(day, t)
  return n === 0 ? 'Aujourd’hui' : n === 1 ? 'Hier' : n === 2 ? 'Avant-hier' : null
}

/** ‹ jour › : jour de semaine d'avant / d'après (jamais après le jour présent) ; toucher le jour ouvre le choix. */
function DayNav({ day, last, today: t, onPick, onOpenPicker }: { day: string; last: string; today: string; onPick: (d: string | null) => void; onOpenPicker: (at: AxisAnchor) => void }) {
  const next = nextStaffDay(day, last)
  const near = nearName(day, t)
  const name = near ?? longDay(day, t)
  const ago = daysBetween(day, t)
  const sub = !isWeekday(day)
    ? `${longDay(day, t)} · week-end, rien n’est demandé`
    : day === last && day !== t
      ? `${longDay(day, t)} · week-end : dernier jour demandé`
      : near
        ? longDay(day, t)
        : ago >= 360
          ? `il y a ${Math.round(ago / 365) > 1 ? `${Math.round(ago / 365)} ans` : 'un an'}`
          : ago >= 28
            ? `il y a ${Math.round(ago / 7)} semaines`
            : `il y a ${ago} jours`
  const arrow =
    'grid h-11 w-11 shrink-0 place-items-center rounded-full border border-rose-400/40 bg-panel/80 text-xl font-black text-rose-300 transition hover:bg-panel disabled:opacity-30'
  return (
    <div className="flex items-center gap-2" data-testid="wellness-jour">
      <button type="button" className={arrow} aria-label="Jour demandé d’avant" title="Jour d’avant" onClick={() => onPick(prevStaffDay(day))}>
        ‹
      </button>
      <button
        type="button"
        className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-2xl border border-rose-400/40 bg-panel/80 px-3 py-1 transition hover:bg-panel"
        aria-label={`Jour montré : ${name} ; choisir un autre jour`}
        data-testid="wellness-jour-choix"
        onClick={(ev) => {
          const r = ev.currentTarget.getBoundingClientRect()
          onOpenPicker({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
        }}
      >
        <span className="max-w-full truncate text-sm leading-tight font-extrabold">📅 {name}</span>
        <span className="max-w-full truncate text-[10px] text-muted">{sub}</span>
      </button>
      <button type="button" className={arrow} aria-label="Jour demandé d’après" title="Jour d’après" disabled={!next} onClick={() => next && onPick(next)}>
        ›
      </button>
    </div>
  )
}

/** Bulle du choix du jour (accrochée, fond flouté) : les derniers jours demandés, une semaine, un mois, un an, une date. */
function DayPickerBubble({ at, day, last, today: t, onPick, onClose }: { at: AxisAnchor; day: string; last: string; today: string; onPick: (d: string | null) => void; onClose: () => void }) {
  const recent: string[] = [last]
  while (recent.length < 6) recent.push(prevStaffDay(recent[recent.length - 1]))
  const far: [string, string][] = [
    ['Il y a 1 semaine', addDays(last, -7)],
    ['Il y a 1 mois', addDays(last, -28)],
    ['Il y a 1 an', addDays(last, -364)],
  ]
  const [typed, setTyped] = useState(day)
  // Une date entière (pas l'année en cours de frappe), pas à venir, pas avant 2000.
  const typedOk = isDay(typed) && typed <= t && typed >= '2000-01-01'
  return (
    <AnchoredBubble at={at} label="Choisir le jour du tableau" title="Quel jour ?" sub={`Montré : ${longDay(day, t)}`} onClose={onClose} testId="bulle-jour">
      <div className="mt-1 flex w-full min-w-0 flex-col gap-3 text-xs">
        <div>
          <div className="mb-1 text-[10px] font-bold text-muted">Derniers jours demandés</div>
          <div className="grid grid-cols-3 gap-1.5">
            {recent.map((d) => {
              const [wd, ...rest] = shortDay(d).split(' ')
              return (
                <button key={d} type="button" className={`${pillClass(d === day)} min-h-11 justify-center`} aria-pressed={d === day} onClick={() => onPick(d)}>
                  <span className="flex flex-col items-center leading-tight">
                    <b>{nearName(d, t) ?? wd}</b>
                    <span className="text-[10px] opacity-80">{nearName(d, t) ? shortDay(d) : rest.join(' ')}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-bold text-muted">Plus loin (même jour de la semaine)</div>
          <div className="flex flex-wrap gap-1.5">
            {far.map(([label, d]) => (
              <button key={label} type="button" className={pillClass(d === day)} aria-pressed={d === day} onClick={() => onPick(d)} title={longDay(d, t)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (typedOk) onPick(typed)
          }}
        >
          <label htmlFor="wellness-jour-date" className="text-[10px] font-bold text-muted">
            Une date précise
          </label>
          <div className="flex gap-1.5">
            <input id="wellness-jour-date" type="date" className="input min-h-11 min-w-0 flex-1" max={t} value={typed} data-testid="wellness-jour-date" onChange={(e) => setTyped(e.currentTarget.value)} />
            <button type="submit" className="btn-primary min-h-11 shrink-0 px-3 text-xs" disabled={!typedOk}>
              Voir ce jour
            </button>
          </div>
        </form>
      </div>
    </AnchoredBubble>
  )
}

// ---------- Couleurs et pastilles (23/11 : « de la couleur, de la pêche, de la vie ») ----------

/**
 * Couleur d'une note ou d'une forme par tranche (1-2, 3-4, 5-6, 7-8, 9-10 ; src/wellness.ts : levelBand, formeBand) : rouge
 * doux, orange, ambre, vert, turquoise plein (9-10). Textes en -300 : les thèmes clairs les foncent (src/index.css, :root[data-light]).
 */
const SCALE_CLS = [
  'border-rose-400/50 bg-rose-500/15 text-rose-300',
  'border-orange-400/50 bg-orange-500/15 text-orange-300',
  'border-amber-400/50 bg-amber-400/15 text-amber-300',
  'border-emerald-400/50 bg-emerald-500/15 text-emerald-300',
  'border-teal-500 bg-teal-600 text-white',
] as const
/** Liseré gauche de la carte d'un joueur, selon sa forme du jour. */
const SCALE_EDGE = ['border-l-rose-400', 'border-l-orange-400', 'border-l-amber-400', 'border-l-emerald-400', 'border-l-teal-500'] as const
const NEUTRAL_CLS = 'border-line bg-panel-2 text-muted'
/** Repère « en dessous de sa propre moyenne » (28 jours d'avant) sur une note : ▾ un peu, ▾▾ nettement. */
const TONE_MARK: Partial<Record<Tone, { mark: string; cls: string }>> = {
  below: { mark: '▾', cls: 'text-spread-lo' },
  wellBelow: { mark: '▾▾', cls: 'text-loss' },
}

/** Une note du jour : picto, valeur colorée selon la note (1 → 10), repère si en dessous de sa propre moyenne. */
function NoteChip({ item, value, tone }: { item: (typeof WELLNESS_ITEMS)[number]; value?: number; tone: Tone }) {
  const has = typeof value === 'number'
  const mark = TONE_MARK[tone]
  return (
    <span
      className={`relative flex min-w-0 flex-col items-center rounded-lg border px-1 pt-1 pb-0.5 ${has ? SCALE_CLS[Math.max(0, levelBand(value))] : NEUTRAL_CLS}`}
      title={`${item.label} : ${value ?? '—'}/10 (${TONE_WORDS[tone]})`}
    >
      <span className="text-sm leading-none" aria-hidden>
        {WELLNESS_PICTO[item.key]}
      </span>
      <span className="text-base leading-tight font-extrabold tabular-nums">{value ?? '—'}</span>
      <span className="w-full truncate text-center text-[9px] leading-tight font-bold opacity-80">{item.short}</span>
      {mark && <span className={`absolute top-0.5 right-1 text-[11px] leading-none font-black ${mark.cls}`}>{mark.mark}</span>}
    </span>
  )
}

/** Pastille ronde de la forme du jour (sur 10), colorée par tranche ; le title dit le calcul. `faded` : dernière réponse connue. */
function FormeBadge({ f, size = 'md', title, faded = false }: { f: Forme | null; size?: 'md' | 'lg'; title?: string; faded?: boolean }) {
  const box = size === 'lg' ? 'h-14 w-14 text-xl' : 'h-12 w-12 text-lg'
  if (!f)
    return (
      <span className={`grid shrink-0 place-items-center rounded-full border-2 border-dashed border-line text-muted ${box}`} title={FORME_HOW}>
        —
      </span>
    )
  return (
    <span
      className={`flex shrink-0 flex-col items-center justify-center rounded-full border-2 ${SCALE_CLS[formeBand(f.value)]} ${box} ${faded ? 'border-dashed opacity-60' : ''}`}
      title={title ?? formeTitle(f)}
      data-testid={faded ? 'forme-derniere' : 'forme'}
    >
      <span className="leading-none font-black tabular-nums">{fmt1(f.value)}</span>
      <span className="text-[8px] leading-tight font-bold opacity-80">/10</span>
    </span>
  )
}

/**
 * Couleur de la jauge des réponses selon son remplissage (mêmes couleurs que les notes) : rouge sous 30 %, orange sous 50 %,
 * ambre sous 70 %, vert sous 90 %, turquoise à 90 % et plus. Presque tout le monde a répondu : vert ; peu de réponses : rouge.
 */
const answeredBand = (pct: number): number => (pct >= 90 ? 4 : pct >= 70 ? 3 : pct >= 50 ? 2 : pct >= 30 ? 1 : 0)

/** Résumé du jour dans l'en-tête : forme moyenne, réponses (jauge), gênes. Les notes du groupe : jauges (GroupGauges). */
function DaySummary({ gday, concerned, pains, waiting }: { gday: ReturnType<typeof groupDay>; concerned: number; pains: number; waiting: boolean }) {
  const pct = concerned ? Math.round((gday.answered / concerned) * 100) : 0
  const word = gday.forme !== null ? formeWord(gday.forme) : null
  const groupForme: Forme | null = gday.forme !== null ? { value: gday.forme, notes: gday.forme, count: 4, pain: null, minus: 0 } : null
  const rest = concerned - gday.answered
  return (
    <div className="flex flex-col gap-2" data-testid="wellness-bilan">
      <div className="flex items-center gap-3">
        <FormeBadge f={groupForme} size="lg" title={`Forme moyenne du groupe : moyenne des formes du jour de ceux qui ont répondu. ${FORME_HOW}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold">
            {word ? (
              <>
                {word.emoji} {word.word}
              </>
            ) : waiting ? (
              'En attente des réponses'
            ) : (
              'Pas de réponse ce jour-là'
            )}
          </div>
          <div className="text-[11px] text-muted">{gday.forme !== null ? 'forme moyenne du groupe' : waiting ? 'la forme du groupe s’affichera ici' : 'rien à montrer pour ce jour'}</div>
          <div className="mt-1.5 flex items-center gap-2">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-fg/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={concerned}
              aria-valuenow={gday.answered}
              aria-label="Réponses du jour"
            >
              <div className={`h-full rounded-full transition-[width] ${GAUGE_FILL[answeredBand(pct)]}`} style={{ width: `${pct}%` }} data-testid="jauge-reponses" />
            </div>
            <span className="shrink-0 text-[11px] font-bold tabular-nums">
              {gday.answered}/{concerned} <span className="font-normal text-muted">réponse{gday.answered > 1 ? 's' : ''}</span>
            </span>
          </div>
        </div>
      </div>
      {(pains > 0 || (waiting && rest > 0)) && (
        <div className="flex flex-wrap gap-1.5">
          {pains > 0 && (
            <span className="w-fit rounded-full border border-line bg-panel/70 px-2.5 py-0.5 text-[11px]">
              🩹 <b>{pains}</b> gêne{pains > 1 ? 's' : ''} signalée{pains > 1 ? 's' : ''}
            </span>
          )}
          {waiting && rest > 0 && (
            <span className="w-fit rounded-full border border-line bg-panel/70 px-2.5 py-0.5 text-[11px]">
              ☕ <b>{rest}</b> en attente
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Le groupe dans le temps : une jauge par note ----------

/** Position (en %) d'une valeur 1 → 10 sur la jauge. */
const gaugePct = (v: number) => Math.max(0, Math.min(100, ((v - 1) / 9) * 100))
/** Fond de la jauge : les tranches de couleur des notes (1-2, 3-4, 5-6, 7-8, 9-10), à peine teintées. */
const GAUGE_BANDS = [
  { w: (2 / 9) * 100, cls: 'bg-rose-400/20' },
  { w: (2 / 9) * 100, cls: 'bg-orange-400/20' },
  { w: (2 / 9) * 100, cls: 'bg-amber-400/25' },
  { w: (2 / 9) * 100, cls: 'bg-emerald-400/20' },
  { w: (1 / 9) * 100, cls: 'bg-teal-500/25' },
] as const
/** Remplissage de la jauge jusqu'à la valeur du jour, couleur de sa tranche. */
const GAUGE_FILL = ['bg-rose-400', 'bg-orange-400', 'bg-amber-400', 'bg-emerald-500', 'bg-teal-500'] as const

/** Une jauge : picto, nom, valeur du jour en gros ; barre 1 → 10 remplie jusqu'au jour ; repères 7 j, 30 j, 1 an ; un mot si l'écart est net. */
function GaugeRow({ picto, label, g, big = false }: { picto: string; label: string; g: Gauge; big?: boolean }) {
  const gap = gaugeGap(g)
  const marks = PERIOD_KEYS.flatMap((k) => (g.refs[k] !== null ? [{ k, v: g.refs[k]!, pct: gaugePct(g.refs[k]!) }] : [])).sort((a, b) => a.pct - b.pct)
  // Étiquettes sous la jauge : une seule pour des repères presque égaux (« 7 j · 30 j ») ; sur une autre ligne quand deux
  // étiquettes sont trop proches pour se lire.
  const groups: { keys: PeriodKey[]; v: number; pct: number }[] = []
  for (const m of marks) {
    const g0 = groups[groups.length - 1]
    if (g0 && Math.abs(m.v - g0.v) <= 0.25) {
      g0.keys.push(m.k)
      g0.pct = (g0.pct + m.pct) / 2
    } else groups.push({ keys: [m.k], v: m.v, pct: m.pct })
  }
  const laneEnd: number[] = []
  const placed = groups.map((m) => {
    let lane = laneEnd.findIndex((end) => m.pct - end >= 14 + 4 * m.keys.length)
    if (lane < 0) lane = laneEnd.length
    laneEnd[lane] = m.pct + 4 * (m.keys.length - 1)
    return { ...m, lane }
  })
  const title = [`${label} du groupe ce jour-là : ${g.value !== null ? fmt1(g.value) : '—'}/10`, ...PERIOD_KEYS.map((k) => `${PERIOD_LABEL[k].long} : ${g.refs[k] !== null ? fmt1(g.refs[k]!) : '—'}`)].join(' · ')
  return (
    <div className="flex min-w-0 flex-col gap-1" title={title} data-testid="jauge">
      <div className="flex items-center gap-2">
        <span className={big ? 'text-xl leading-none' : 'text-lg leading-none'} aria-hidden>
          {picto}
        </span>
        <span className={`min-w-0 flex-1 truncate font-extrabold ${big ? 'text-sm' : 'text-xs'}`}>{label}</span>
        <span
          className={`rounded-lg border px-2 py-0.5 leading-tight font-black tabular-nums ${big ? 'text-xl' : 'text-lg'} ${g.value !== null ? SCALE_CLS[formeBand(g.value)] : NEUTRAL_CLS}`}
        >
          {g.value !== null ? fmt1(g.value) : '—'}
        </span>
      </div>
      <div className="relative mx-1.5">
        <div className={`flex overflow-hidden rounded-full ${big ? 'h-4' : 'h-3'}`} aria-hidden>
          {GAUGE_BANDS.map((b, i) => (
            <span key={i} className={b.cls} style={{ width: `${b.w}%` }} />
          ))}
        </div>
        {g.value !== null && (
          <div className={`absolute top-0 left-0 rounded-full ${GAUGE_FILL[formeBand(g.value)]} ${big ? 'h-4' : 'h-3'}`} style={{ width: `max(${gaugePct(g.value)}%, 0.75rem)` }} aria-hidden />
        )}
        {marks.map((m) => (
          <span
            key={m.k}
            className={`absolute -top-1 w-1 -translate-x-1/2 rounded-full bg-fg shadow ring-2 ring-panel ${big ? 'h-6' : 'h-5'}`}
            style={{ left: `${m.pct}%` }}
            aria-hidden
          />
        ))}
      </div>
      {placed.length > 0 && (
        <div className="relative mx-1.5" style={{ height: `${(Math.max(...placed.map((m) => m.lane)) + 1) * 15}px` }}>
          {placed.map((m) => (
            <span
              key={m.keys.join()}
              className="absolute -translate-x-1/2 rounded-full border border-line bg-panel px-1.5 text-[9px] leading-[13px] font-bold whitespace-nowrap text-fg/80"
              style={{ left: `clamp(${0.9 + m.keys.length * 0.6}rem, ${m.pct}%, calc(100% - ${0.9 + m.keys.length * 0.6}rem))`, top: `${m.lane * 15}px` }}
            >
              {PERIOD_KEYS.filter((k) => m.keys.includes(k)).map((k) => PERIOD_LABEL[k].short).join(' · ')}
            </span>
          ))}
        </div>
      )}
      {gap && (
        <span className={`text-[11px] font-bold ${gap.diff < 0 ? 'text-spread-lo' : 'text-gain'}`} data-testid="jauge-ecart">
          {gap.diff < 0 ? '↓' : '↑'} {gapText(gap, g.refs[gap.ref]!)}
        </span>
      )}
    </div>
  )
}

/** « Le groupe dans le temps » : forme et quatre notes, le jour face aux 7 et 30 derniers jours et à l'an dernier. */
function GroupGauges({
  day,
  today: t,
  forme,
  notes,
  lastYearKnown,
  lastYearLoading,
}: {
  day: string
  today: string
  forme: Gauge
  notes: { it: (typeof WELLNESS_ITEMS)[number]; g: Gauge }[]
  lastYearKnown: boolean
  lastYearLoading: boolean
}) {
  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="wellness-jauges">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 className="text-sm font-extrabold">📈 Le groupe dans le temps</h2>
        <span className="text-[10px] text-muted">moyennes du groupe · {day === t ? 'aujourd’hui' : longDay(day, t)}</span>
      </div>
      <GaugeRow picto="🔋" label="Forme" g={forme} big />
      <div className="grid grid-cols-1 gap-x-6 gap-y-3 wide:grid-cols-2">
        {notes.map(({ it, g }) => (
          <GaugeRow key={it.key} picto={WELLNESS_PICTO[it.key]} label={it.short} g={g} />
        ))}
      </div>
      <p className="text-[10px] text-muted">
        Barre : la moyenne du groupe ce jour-là. Repères : <b className="text-fg/80">7 j</b> et <b className="text-fg/80">30 j</b>, moyennes du groupe sur les 7 et 30 derniers jours ;{' '}
        <b className="text-fg/80">1 an</b>, les mêmes semaines l’an dernier
        {lastYearLoading ? ' (lecture…)' : lastYearKnown ? '' : ' (pas de réponses connues : repère absent)'}. Un mot apparaît quand l’écart atteint {fmt1(PERIOD_GAP)} point.
      </p>
    </section>
  )
}

/** « Comment lire le tableau » : forme, couleurs, repères, gêne, charge (ouvert à la demande). */
function Legend() {
  return (
    <details className="group -my-1 text-[11px] text-muted">
      <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-1.5 font-bold text-fg/80">
        <span className="grid h-4 w-4 place-items-center rounded-full border border-line text-[9px]">?</span> Comment lire le tableau
        <span className="transition group-open:rotate-90">›</span>
      </summary>
      <div className="card mt-1 flex flex-col gap-1.5 p-3">
        <p>
          <b className="text-fg">Forme du jour</b> (pastille ronde) : moyenne de ses notes du matin, moins un quart de sa gêne la plus forte (gêne 8/10 : −2). Sur 10.
        </p>
        <p className="flex flex-wrap items-center gap-1">
          Couleur de la note :
          {['1-2', '3-4', '5-6', '7-8', '9-10'].map((x, i) => (
            <span key={x} className={`rounded-md border px-1.5 font-bold tabular-nums ${SCALE_CLS[i]}`}>
              {x}
            </span>
          ))}
        </p>
        <p>
          <b className="text-spread-lo">▾</b> un peu en dessous de <b>sa propre moyenne</b> (28 jours d’avant), <b className="text-loss">▾▾</b> nettement ; sans repère : comme d’habitude ou mieux.
        </p>
        <p>
          Pas de réponse ce jour-là : sa <b className="text-fg">dernière réponse</b>, atténuée et datée. Petites barres : sa forme des 10 derniers jours demandés (un point : pas de réponse).
        </p>
        <p>
          {WELLNESS_ITEMS.map((it) => `${WELLNESS_PICTO[it.key]} ${it.short.toLowerCase()}`).join(' · ')}. Gêne : une ligne par endroit, pastille selon l’intensité la plus forte (1 à 3,{' '}
          <span className="text-spread-lo">4 à 6</span>, <span className="text-loss">7 à 10</span>). Charge = intensité × durée ; 7 jours comparés à sa moyenne par semaine (28 jours).
        </p>
      </div>
    </details>
  )
}

/** Petites barres : sa forme des 10 derniers jours demandés jusqu'au jour choisi (hauteur et couleur selon la forme). */
function FormeBars({ entries, day }: { entries: readonly WellnessEntry[]; day: string }) {
  const trend = formeTrend(entries, day)
  const n = trend.filter((x) => x.forme !== null).length
  return (
    <span className="flex items-end gap-[3px]" role="img" aria-label={`Forme des 10 derniers jours demandés : ${n} réponse${n > 1 ? 's' : ''}`} data-testid="forme-barres">
      {trend.map((x) =>
        x.forme !== null ? (
          <span
            key={x.day}
            className={`w-1.5 rounded-sm ${GAUGE_FILL[formeBand(x.forme)]} ${x.day === day ? '' : 'opacity-75'}`}
            style={{ height: `${6 + (x.forme / 10) * 18}px` }}
            title={`${shortDay(x.day)} : forme ${fmt1(x.forme)}`}
          />
        ) : (
          <span key={x.day} className="h-1.5 w-1.5 rounded-full bg-fg/15" title={`${shortDay(x.day)} : pas de réponse`} />
        ),
      )}
    </span>
  )
}

/** Liseré gauche atténué : dernière réponse connue (pas de réponse ce jour-là). */
const SCALE_EDGE_SOFT = ['border-l-rose-400/40', 'border-l-orange-400/40', 'border-l-amber-400/40', 'border-l-emerald-400/40', 'border-l-teal-500/40'] as const

/**
 * Une carte du tableau : nom (vers la fiche, dans le groupe), forme du jour, quatre notes colorées, gêne, petites barres de
 * forme, charge. Pas de réponse ce jour-là : sa dernière réponse connue, atténuée et datée, avec ses couleurs et pictos.
 */
function WellnessRow({
  p,
  groupId,
  row,
  entries,
  day,
  account,
  isToday,
  alert,
  alertCfg,
  hit,
  onOpen,
}: {
  p: Player
  groupId: string
  row: StaffRow | null
  entries: readonly WellnessEntry[]
  day: string
  account: boolean
  isToday: boolean
  alert: string[] | null
  alertCfg: AlertSettings
  hit: AskHit | null
  onOpen: (at: AxisAnchor) => void
}) {
  const e = row?.today
  const f = formeDuJour(e)
  // Pas de réponse ce jour-là : la dernière connue (avant ce jour), ses notes et leurs repères à ce jour-là.
  const lastEntry = !e && row?.lastDay ? (entries.find((x) => x.day === row.lastDay) ?? null) : null
  const lastRow = lastEntry ? staffRow(entries, [], lastEntry.day) : null
  const lastF = formeDuJour(lastEntry)
  const open = (ev: MouseEvent<HTMLElement>) => {
    const r = ev.currentTarget.getBoundingClientRect()
    onOpen({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
  }
  const word = f ? formeWord(f.value) : null
  const edge = f ? SCALE_EDGE[formeBand(f.value)] : lastF ? SCALE_EDGE_SOFT[formeBand(lastF.value)] : 'border-l-line'
  return (
    <div className={`card flex min-w-0 flex-col gap-2.5 border-l-4 p-3 ${edge} ${account ? '' : 'opacity-70'}`} data-testid="wellness-ligne">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link to={`/groupes/${groupId}/joueurs/${p.id}?onglet=wellness`} state={{ md: true }} className="flex min-w-0 flex-1 items-center gap-2.5">
          <PlayerAvatar p={p} size={40} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{playerName(p)}</span>
            {p.position && <span className="block truncate text-[10px] text-muted">{positionLabel(p.position)}</span>}
            {word && (
              <span className="block truncate text-[11px] font-bold">
                {word.emoji} {word.word}
              </span>
            )}
          </span>
        </Link>
        {account && (
          <button type="button" className="shrink-0 rounded-full" aria-label={`Forme du jour et détail du wellness de ${playerName(p)}`} onClick={open}>
            {f || !lastF ? <FormeBadge f={f} /> : <FormeBadge f={lastF} faded title={`Dernière réponse (${shortDay(lastEntry!.day)}) : ${formeTitle(lastF)}`} />}
          </button>
        )}
      </div>
      {account && e && (
        <button type="button" className="grid grid-cols-4 gap-1.5" aria-label={`Détail du wellness de ${playerName(p)}`} onClick={open}>
          {WELLNESS_ITEMS.map((it) => (
            <NoteChip key={it.key} item={it} value={e.scores[it.key]} tone={row!.tones[it.key]} />
          ))}
        </button>
      )}
      {!account ? (
        <span className="text-[11px] text-muted">Pas d’espace joueur : rien ne lui est demandé.</span>
      ) : !e ? (
        <button type="button" className="flex min-w-0 flex-col gap-1.5 text-left" onClick={open} aria-label={`Dernière réponse et détail du wellness de ${playerName(p)}`}>
          <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full border border-dashed border-line bg-panel-2 px-2.5 py-0.5 font-bold text-fg/80">☕ {isToday ? 'Pas encore répondu aujourd’hui' : 'Pas de réponse ce jour-là'}</span>
            {lastEntry && <span className="text-muted">dernière réponse : {shortDay(lastEntry.day)}</span>}
          </span>
          {lastEntry && lastRow && (
            <span className="grid grid-cols-4 gap-1.5 opacity-60" data-testid="derniere-reponse">
              {WELLNESS_ITEMS.map((it) => (
                <NoteChip key={it.key} item={it} value={lastEntry.scores[it.key]} tone={lastRow.tones[it.key]} />
              ))}
            </span>
          )}
          {lastEntry && painMax(lastEntry) !== null && <PainSummary entry={lastEntry} className="opacity-60" />}
          {!lastEntry && <span className="text-[11px] text-muted">Aucune réponse sur les 5 dernières semaines.</span>}
        </button>
      ) : (
        <PainSummary entry={e} />
      )}
      {alert && (
        <span className="w-fit rounded-full border border-spread-lo/50 bg-spread-lo/10 px-2 py-0.5 text-[10px] font-bold text-spread-lo" data-testid="wellness-alerte-ligne">
          🔋 {alert.length} jours de suite à {alertCfg.max} ou moins ({notesText(alertCfg.note ? [alertCfg.note] : [])})
        </span>
      )}
      {hit && (
        <span className="text-[11px] text-muted" data-testid="wellness-demande-ligne">
          {hit.values.map((v) => `${v.label[0].toUpperCase()}${v.label.slice(1)} ${fmt1(v.value)}`).join(' · ')} · {hit.day === day ? 'réponse du jour' : `réponse du ${shortDay(hit.day)}`}
        </span>
      )}
      {account && row && (
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <FormeBars entries={entries} day={day} />
          <ChargeLine charge={row.charge} className="min-w-0 text-right text-[10px] text-muted" />
        </div>
      )}
    </div>
  )
}

/** Bulle accrochée au doigt : ses 14 derniers jours, ses moyennes, ses séances de la semaine. */
function PlayerBubble({
  p,
  at,
  day,
  entries,
  sessions,
  row,
  alert,
  alertCfg,
  onClose,
}: {
  p: Player
  at: AxisAnchor
  day: string
  entries: WellnessEntry[]
  sessions: WellnessSession[]
  row: StaffRow | null
  alert: string[] | null
  alertCfg: AlertSettings
  onClose: () => void
}) {
  const days = [...entries].filter((e) => e.day <= day).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14)
  const week = [...sessions].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 8)
  const withPain = days.filter((e) => painMax(e) !== null)
  const forme = formeDuJour(row?.today)
  return (
    <AnchoredBubble at={at} label={`Wellness de ${playerName(p)}`} title={playerName(p)} sub={day === today() ? '14 derniers jours' : `14 jours jusqu’au ${shortDay(day)}`} onClose={onClose} testId="bulle-wellness">
      <div className="flex max-h-[42vh] w-full min-w-0 flex-col gap-2 overflow-y-auto">
        {alert && (
          <p className="rounded-md border border-spread-lo/50 px-2 py-1 text-[11px]" data-testid="bulle-alerte">
            <b className="text-spread-lo">🔋 {alertText({ ...alertCfg, days: alert.length })}</b>
            <span className="block text-muted">{[...alert].reverse().map(shortDay).join(' · ')}</span>
          </p>
        )}
        {forme && (
          <div className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${SCALE_CLS[formeBand(forme.value)]}`} data-testid="bulle-forme">
            <span className="text-lg leading-none font-black tabular-nums">{fmt1(forme.value)}</span>
            <span className="min-w-0 text-[11px] leading-tight">
              <b>
                Forme du jour · {formeWord(forme.value).emoji} {formeWord(forme.value).word}
              </b>
              <span className="block text-fg/80">
                Notes {fmt1(forme.notes)} de moyenne{forme.pain !== null ? `, gêne ${forme.pain}/10 : −${fmt1(forme.minus)}` : ', pas de gêne'}.
              </span>
              <span className="block text-muted">{FORME_HOW}</span>
            </span>
          </div>
        )}
        {row && (
          <div className="grid grid-cols-4 gap-1 text-center">
            {WELLNESS_ITEMS.map((it) => (
              <div key={it.key} className="rounded-md border border-line px-1 py-1">
                <div className="text-[9px] text-muted">
                  {WELLNESS_PICTO[it.key]} {it.short}
                </div>
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
                <th className="w-[28%] text-left font-normal">Jour</th>
                <th className="font-normal" title={FORME_HOW}>
                  Forme
                </th>
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
                const fe = formeDuJour(e)
                return (
                  <tr key={e.day} className="border-t border-line">
                    <td className="truncate py-1 text-left">{shortDay(e.day)}</td>
                    <td>{fe ? <span className={`rounded px-1 font-bold ${SCALE_CLS[formeBand(fe.value)]}`}>{fmt1(fe.value)}</span> : '—'}</td>
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
