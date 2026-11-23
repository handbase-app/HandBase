import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { AnchoredBubble } from '../components/AnchoredBubble'
import { ask } from '../components/Confirm'
import { FilterField, pillClass } from '../components/FilterWindow'
import { RosterQueryBar, type OwnFilters } from '../components/PlayersQuery'
import { usePoleMembers, usePoleRef } from '../components/PoleGroup'
import { canReadWellness, canToggleWellness, ChargeLine, PainLines, PainSummary, PAIN_TEXT_CLS, shortDay, useWellnessEnabled } from '../components/Wellness'
import { GroupTile } from '../components/GroupTile'
import { Avatar, Empty, Icon, playerName } from '../components/ui'
import type { AxisAnchor } from '../components/ZoneRadar'
import { useGroupZone, useLampSettings } from '../components/LampStaff'
import { isRequestedDay } from '../lamp'
import { alive, db, positionLabel, save, today, type Player, type PlayerGroup } from '../db'
import { pluralG, setGender, w } from '../gender'
import { can, useRole } from '../roles'
import {
  fmt1,
  formeBand,
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

  // Le groupe ce jour-là (en-tête) : réponses, forme moyenne, moyenne de chaque note.
  const gday = value ? groupDay(players.filter(withAccount).map((p) => rows.get(p.id)?.today)) : null
  const showTable = active && readable && !!value
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
      {/* En-tête chaleureux (23/11, « trop austère ») : cœur pêche → corail, nom du groupe, résumé du jour. */}
      <header className="card relative flex flex-col gap-3 overflow-hidden border-rose-400/30 bg-gradient-to-br from-orange-400/15 via-rose-500/10 to-panel p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-300 to-rose-500 text-white shadow-md shadow-rose-500/30">
            <Icon name="heart" className="h-6 w-6" filled />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl leading-tight font-extrabold">Wellness</h1>
            <div className="truncate text-xs font-bold text-rose-300">{g.name}</div>
          </div>
          {active && readable && lamp.actif && <GroupTile to={`/groupes/${g.id}/lampes`} icon="lamp" title="Lampes" tone="lamp" testId="lien-lampes" compact />}
        </div>
        {showTable && gday && (
          <DaySummary
            label={day === t ? `Aujourd’hui · ${shortDay(day)}` : `Week-end, rien n’est demandé · dernier jour demandé : ${shortDay(day)}`}
            gday={gday}
            concerned={concerned}
            pains={pains}
          />
        )}
      </header>

      {!showTable && settingsCard}

      {active && !readable && <Empty>Le tableau est réservé au staff du groupe (créateur, participants) et aux administrateurs.</Empty>}
      {active && readable && !res && <div className="py-10 text-center text-sm text-muted">Chargement…</div>}
      {active && readable && res && !res.ok && <Empty>{res.error}</Empty>}
      {active && readable && value && (
        <>
          <Legend />
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
                  <div className="grid grid-cols-1 gap-3 wide:grid-cols-2">
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
          {settingsCard}
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

/** Pastille ronde de la forme du jour (sur 10), colorée par tranche ; le title dit le calcul. */
function FormeBadge({ f, size = 'md', title }: { f: Forme | null; size?: 'md' | 'lg'; title?: string }) {
  const box = size === 'lg' ? 'h-14 w-14 text-xl' : 'h-12 w-12 text-lg'
  if (!f)
    return (
      <span className={`grid shrink-0 place-items-center rounded-full border-2 border-dashed border-line text-muted ${box}`} title={FORME_HOW}>
        —
      </span>
    )
  return (
    <span className={`flex shrink-0 flex-col items-center justify-center rounded-full border-2 ${SCALE_CLS[formeBand(f.value)]} ${box}`} title={title ?? formeTitle(f)} data-testid="forme">
      <span className="leading-none font-black tabular-nums">{fmt1(f.value)}</span>
      <span className="text-[8px] leading-tight font-bold opacity-80">/10</span>
    </span>
  )
}

/** Résumé du jour dans l'en-tête : forme moyenne, réponses (jauge), gênes, moyenne de chaque note. */
function DaySummary({ label, gday, concerned, pains }: { label: string; gday: ReturnType<typeof groupDay>; concerned: number; pains: number }) {
  const pct = concerned ? Math.round((gday.answered / concerned) * 100) : 0
  const word = gday.forme !== null ? formeWord(gday.forme) : null
  const groupForme: Forme | null = gday.forme !== null ? { value: gday.forme, notes: gday.forme, count: 4, pain: null, minus: 0 } : null
  return (
    <div className="flex flex-col gap-3" data-testid="wellness-bilan">
      <div className="text-[11px] font-bold tracking-wider text-muted uppercase">{label}</div>
      <div className="flex items-center gap-3">
        <FormeBadge f={groupForme} size="lg" title={`Forme moyenne du groupe : moyenne des formes du jour de ceux qui ont répondu. ${FORME_HOW}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold">
            {word ? (
              <>
                {word.emoji} {word.word}
              </>
            ) : (
              'En attente des réponses'
            )}
          </div>
          <div className="text-[11px] text-muted">{gday.forme !== null ? 'forme moyenne du groupe' : 'la forme du groupe s’affichera ici'}</div>
          <div className="mt-1.5 flex items-center gap-2">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full bg-fg/10"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={concerned}
              aria-valuenow={gday.answered}
              aria-label="Réponses du jour"
            >
              <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-rose-500 transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 text-[11px] font-bold tabular-nums">
              {gday.answered}/{concerned} <span className="font-normal text-muted">réponse{gday.answered > 1 ? 's' : ''}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {WELLNESS_ITEMS.map((it) => {
          const v = gday.avg[it.key]
          return (
            <div
              key={it.key}
              className={`flex min-w-0 flex-col items-center rounded-lg border px-1 py-1 ${v !== null ? SCALE_CLS[formeBand(v)] : NEUTRAL_CLS}`}
              title={`${it.label} : moyenne du groupe ce jour-là`}
            >
              <span className="text-base leading-none" aria-hidden>
                {WELLNESS_PICTO[it.key]}
              </span>
              <span className="text-sm leading-tight font-extrabold tabular-nums">{v !== null ? fmt1(v) : '—'}</span>
              <span className="w-full truncate text-center text-[9px] leading-tight font-bold opacity-80">{it.short}</span>
            </div>
          )
        })}
      </div>
      {pains > 0 && (
        <div className="w-fit rounded-full border border-line bg-panel/70 px-2.5 py-0.5 text-[11px]">
          🩹 <b>{pains}</b> gêne{pains > 1 ? 's' : ''} signalée{pains > 1 ? 's' : ''}
        </div>
      )}
    </div>
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
          {WELLNESS_ITEMS.map((it) => `${WELLNESS_PICTO[it.key]} ${it.short.toLowerCase()}`).join(' · ')}. Gêne : une ligne par endroit, pastille selon l’intensité la plus forte (1 à 3,{' '}
          <span className="text-spread-lo">4 à 6</span>, <span className="text-loss">7 à 10</span>). Charge = intensité × durée ; 7 jours comparés à sa moyenne par semaine (28 jours).
        </p>
      </div>
    </details>
  )
}

/** Une carte du tableau : nom (vers la fiche, dans le groupe), forme du jour, quatre notes colorées, gêne, charge. */
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
  const f = formeDuJour(e)
  const open = (ev: MouseEvent<HTMLElement>) => {
    const r = ev.currentTarget.getBoundingClientRect()
    onOpen({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
  }
  const word = f ? formeWord(f.value) : null
  return (
    <div className={`card flex min-w-0 flex-col gap-2.5 border-l-4 p-3 ${f ? SCALE_EDGE[formeBand(f.value)] : 'border-l-line'} ${account ? '' : 'opacity-70'}`} data-testid="wellness-ligne">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link to={`/groupes/${groupId}/joueurs/${p.id}?onglet=wellness`} state={{ md: true }} className="flex min-w-0 flex-1 items-center gap-2.5">
          <Avatar p={p} size={40} />
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
            <FormeBadge f={f} />
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
        <button type="button" className="w-fit rounded-full border border-dashed border-line px-2.5 py-1 text-left text-[11px] text-muted" onClick={open}>
          ☕ {isToday ? 'Pas encore répondu aujourd’hui' : 'Pas de réponse ce jour-là'}
          {row?.lastDay ? ` · dernière réponse ${shortDay(row.lastDay)}` : ''}
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
  const forme = formeDuJour(row?.today)
  return (
    <AnchoredBubble at={at} label={`Wellness de ${playerName(p)}`} title={playerName(p)} sub="14 derniers jours" onClose={onClose} testId="bulle-wellness">
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
