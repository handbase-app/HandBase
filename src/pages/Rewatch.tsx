import { useEffect, useId, useMemo, useState } from 'react'
import { Link, Navigate, Outlet, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSessionState } from '../components/PlayerFilter'
import { BackButton } from '../backNav'
import { listGender, pluralG, w, type Gender } from '../gender'
import { alive, db, fmtDate, today, type HBEvent, type Player, type PlayerGroup, type Rewatch } from '../db'
import { useThrottledQuery } from '../live'
import { useRole } from '../roles'
import { createdAtOf, factMatches, GROUPINGS, groupRewatch, readGrouping, originEvent, rewatchLine, type OriginNames, type RankedRow, type RewatchCard, type RewatchGrouping } from '../rewatchCore'
import { isMyRewatch, revisitedAt, revisitedKeys, rewatchFact, setRevisited, staffMates } from '../scouting'
import { EMPTY_QUERY, type JoueursQuery } from '../playerQuery'
import { usePlayersQuery } from '../components/PlayersQuery'
import { StickyQuery } from '../components/StickyQuery'
import { RewatchButton } from '../components/Scouting'
import { Empty, GroupMark } from '../components/ui'
import { pillClass } from '../components/FilterWindow'
import { CHEVRON_CELL, FoldCard, LINE_LINK, PICTO_CELL, PictoMark, type SummaryPart } from '../components/FoldCard'
import { ContextBar, ContextRoster, rememberScroll, useLeaveTo, useRestoreScroll } from '../components/ContextRoster'
import MasterDetail from '../components/MasterDetail'
import { FollowStar } from '../components/Follow'
import { MQ, useMedia } from '../layout'
import PlayerDetail from './PlayerDetail'

/*
 * Section « À revoir » (supabase/041, 055 ; partie pure : src/rewatchCore.ts, test : tools/test-a-revoir.ts) : chaque
 * « à revoir » de mon staff avec QUI l'a posé, QUAND (jour et heure) et OÙ (d'où le clic a été fait : événement, groupe,
 * liste Joueurs et son filtre, fiche, bilan…), et son état (pas encore revu, revu).
 *  - En haut, la barre « Demander » de la liste Joueurs (filtres = recette, src/components/PlayersQuery.tsx, état à part :
 *    « arevoir ») : nom, année, poste… et le filtre « À revoir » réglé en tête de la fenêtre « Filtres » (par moi ou tout
 *    mon staff, quand, repérés à, état ; au départ : pas encore revus). Une phrase marche comme sur la liste Joueurs
 *    (« mes à revoir du mois dernier », « ceux repérés au tournoi de l'Espenon »).
 *  - Dessous, un rangement d'un toucher (Par date, Par événement, Par personne ; gardé sur l'appareil), puis une carte
 *    repliable par date, événement ou personne (repliée par défaut, comme « Mes suivis » : src/components/FoldCard.tsx) ;
 *    « à revoir » posés hors d'un événement : « Hors événement », à la fin.
 *  - Dans une carte, une ligne compacte par joueur : un toucher sur le nom ouvre sa fiche dans le contexte de cette liste
 *    (/a-revoir/joueurs/:id, ‹ › sur téléphone, la liste à gauche sur ordinateur), « Retour » revient ici dans le même état
 *    (filtres, rangement, cartes ouvertes, position) ; le chevron déplie le détail : chaque « à revoir » en clair, son
 *    commentaire, son état, les événements et groupes visés, « Marquer revu » / « Remettre à revoir », « Modifier ».
 * Uniquement des formulations positives ou neutres sur les jeunes.
 */

const GROUP_KEY = 'handbase.arevoir.ranger'
const IDS_KEY = 'handbase.arevoir.ids'
const SCROLL = 'arevoir'
const BASE = '/a-revoir/joueurs'
/** Au départ : les « à revoir » de mon staff pas encore revus. */
const INITIAL: JoueursQuery = { ...EMPTY_QUERY, recipe: { ...EMPTY_QUERY.recipe, pop: { rewatch: { state: 'open' } } } }

/** Rangement choisi : gardé sur l'appareil (stockage indisponible : par date). */
function useGrouping(): [RewatchGrouping, (g: RewatchGrouping) => void] {
  const [g, setG] = useState<RewatchGrouping>(() => {
    try {
      return readGrouping(localStorage.getItem(GROUP_KEY))
    } catch {
      return 'date'
    }
  })
  const set = (v: RewatchGrouping) => {
    setG(v)
    try {
      localStorage.setItem(GROUP_KEY, v)
    } catch {
      /* stockage indisponible : le choix vaut pour cette visite */
    }
  }
  return [g, set]
}

const nameOf = (p?: Player) => (p ? `${p.lastName.toUpperCase()} ${p.firstName}` : 'Joueur')

/** « À revoir » visibles, leur état, et les fiches, événements et groupes qu'ils citent. */
async function loadRewatchPage() {
  const rows = alive(await db.rewatch.toArray())
  const [mates, keys] = await Promise.all([staffMates(), revisitedKeys(rows.flatMap((r) => r.events ?? []))])
  const players = new Map(
    alive((await db.players.bulkGet([...new Set(rows.map((r) => r.playerId))])).filter((p): p is Player => !!p))
      .filter((p) => !p.mergedInto)
      .map((p) => [p.id, p]),
  )
  const evIds = new Set<string>()
  const grIds = new Set<string>()
  for (const r of rows) {
    for (const e of r.events ?? []) evIds.add(e)
    const o = originEvent(r)
    if (o) evIds.add(o)
    for (const g of r.groups ?? []) grIds.add(g)
    if (r.origin?.kind === 'group' && r.origin.id) grIds.add(r.origin.id)
  }
  const [events, groups] = await Promise.all([db.events.bulkGet([...evIds]), db.groups.bulkGet([...grIds])])
  const ranked: RankedRow<Rewatch>[] = rows.filter((r) => players.has(r.playerId)).map((r) => ({ r, fact: rewatchFact(r, mates, keys), at: Date.parse(createdAtOf(r)) || r.updatedAt }))
  return {
    ranked,
    keys,
    players,
    events: new Map(events.filter((e): e is HBEvent => !!e).map((e) => [e.id, e])),
    groups: new Map(alive(groups.filter((g): g is PlayerGroup => !!g)).map((g) => [g.id, g])),
  }
}
type PageData = Awaited<ReturnType<typeof loadRewatchPage>>
const TABLES = ['rewatch', 'seen', 'evaluations', 'players', 'events', 'groups', 'teams']

const namesOf = (d: Pick<PageData, 'events' | 'groups'>): OriginNames => ({ event: (id) => d.events.get(id)?.name, group: (id) => d.groups.get(id)?.name })

export default function RewatchPage() {
  const role = useRole()
  const data = useThrottledQuery(loadRewatchPage, [role], TABLES, 300)
  const players = useMemo(() => (data ? [...data.players.values()].sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr')) : undefined), [data])
  const q = usePlayersQuery(players, { scope: 'arevoir', initial: INITIAL, rewatchTop: true, count: true })
  const [grouping, setGrouping] = useGrouping()
  // Cartes et joueurs dépliés (repliés par défaut) : retrouvés au retour d'une fiche pendant la session.
  const [opened, setOpened] = useSessionState<string[]>('handbase.arevoir.ouverts', [])
  const toggle = (k: string) => setOpened((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]))
  useRestoreScroll(SCROLL, !!data && !q.loading)

  const wanted = q.query.recipe.pop.rewatch ?? {}
  const day = today()
  const cards = useMemo(() => {
    if (!data) return []
    const shown = new Set(q.filtered.map((p) => p.id))
    const rows = data.ranked.filter((x) => shown.has(x.r.playerId) && factMatches(x.fact, wanted, day))
    return groupRewatch(rows, grouping, { names: namesOf(data), today: day, eventDate: (id) => data.events.get(id)?.date })
  }, [data, q.filtered, wanted, grouping, day]) // eslint-disable-line react-hooks/exhaustive-deps
  // Ordre des fiches (‹ › sur téléphone, colonne de gauche sur ordinateur) : celui de la page.
  const order = useMemo(() => [...new Set(cards.flatMap((c) => c.players.map((x) => x.playerId)))], [cards])
  useEffect(() => {
    try {
      sessionStorage.setItem(IDS_KEY, JSON.stringify(order))
    } catch {
      /* stockage indisponible : la fiche s'ouvre seule */
    }
  }, [order])

  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  // Accord (src/gender.ts) : liste faite seulement de filles → au féminin ; sinon masculin générique.
  const g = listGender(q.query.recipe.pop.sex, order.map((id) => data.players.get(id)))
  const gw = w(g)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <BackButton fallback="/" label="ACCUEIL" />
      <h1 className="text-lg font-extrabold">À revoir</h1>
      <StickyQuery>{q.ui}</StickyQuery>
      <div className="flex flex-col gap-2 empty:hidden">{q.top}</div>
      {/* Rangement d'un toucher, gardé sur l'appareil. */}
      <div role="radiogroup" aria-label="Ranger les « à revoir »" className="mx-auto flex w-full max-w-3xl flex-wrap gap-1.5">
        {GROUPINGS.map((x) => (
          <button key={x.value} type="button" role="radio" aria-checked={grouping === x.value} className={pillClass(grouping === x.value)} onClick={() => setGrouping(x.value)}>
            {x.label}
          </button>
        ))}
      </div>
      {!data.ranked.length ? (
        <Empty>
          {gw.AucunJoueur} à revoir pour ton staff. Pour en mettre {gw.un} : l’horloge au bout de sa ligne, ou « À revoir… » sur sa fiche.
        </Empty>
      ) : !cards.length ? (
        <Empty>Aucun « à revoir » ne correspond à ces filtres.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {cards.map((c) => (
            <RewatchCardView key={`${grouping}:${c.key}`} card={c} data={data} grouping={grouping} g={g} open={opened.includes(`c:${grouping}:${c.key}`)} onToggle={() => toggle(`c:${grouping}:${c.key}`)} opened={opened} toggle={toggle} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Synthèse d'une carte : joueurs, « à revoir » pas encore revus, revus (seulement ce qui est présent). */
function cardSummary(c: RewatchCard<Rewatch>, g: Gender): { parts: SummaryPart[]; label: string } {
  const open = c.rows.filter((x) => !x.fact.done).length
  const done = c.rows.length - open
  const parts: SummaryPart[] = [{ key: 'players', icon: 'user', n: c.players.length, text: pluralG(c.players.length, g), cls: 'text-muted' }]
  if (open) parts.push({ key: 'open', icon: 'clock', n: open, text: `${open} à revoir`, cls: 'text-sky-300' })
  if (done) parts.push({ key: 'done', icon: 'check', n: done, text: `${done} ${w(g).revu}${done > 1 ? 's' : ''}`, cls: 'text-emerald-300' })
  return { parts, label: parts.map((p) => p.text).join(', ') }
}

function RewatchCardView({
  card,
  data,
  grouping,
  g,
  open,
  onToggle,
  opened,
  toggle,
}: {
  card: RewatchCard<Rewatch>
  data: PageData
  grouping: RewatchGrouping
  g: Gender
  open: boolean
  onToggle: () => void
  opened: string[]
  toggle: (k: string) => void
}) {
  const sum = cardSummary(card, g)
  const ev = grouping === 'event' && card.key.startsWith('event:') ? data.events.get(card.key.slice(6)) : undefined
  return (
    <FoldCard
      title={card.title}
      badge={ev?.date && <span className="text-[10px] font-normal text-muted">{fmtDate(ev.date)}</span>}
      summary={sum.parts}
      summaryLabel={sum.label}
      open={open}
      onToggle={onToggle}
    >
      <div className="divide-y divide-line">
        {card.players.map((x) => {
          const k = `p:${grouping}:${card.key}|${x.playerId}`
          return <PlayerLine key={x.playerId} p={data.players.get(x.playerId)} rows={x.rows} data={data} open={opened.includes(k)} onToggle={() => toggle(k)} />
        })}
      </div>
    </FoldCard>
  )
}

/**
 * Un joueur dans une carte, en une ligne compacte : son nom (un toucher : sa fiche) et, dessous, le dernier « à revoir »
 * en clair ; pictogrammes « à revoir » et « revu » avec leur nombre ; le chevron déplie le détail.
 */
function PlayerLine({ p, rows, data, open, onToggle }: { p?: Player; rows: RankedRow<Rewatch>[]; data: PageData; open: boolean; onToggle: () => void }) {
  const detailId = useId()
  if (!p) return null
  const names = namesOf(data)
  const nOpen = rows.filter((x) => !x.fact.done).length
  const nDone = rows.length - nOpen
  const who = nameOf(p)
  const sw = w(p.sex)
  return (
    <div className="py-0.5">
      <div className="flex items-center gap-0.5">
        <Link
          to={`${BASE}/${p.id}`}
          state={{ md: true }}
          onClick={() => rememberScroll(SCROLL)}
          className={`flex min-h-11 min-w-0 flex-1 flex-col justify-center px-1 ${LINE_LINK}`}
        >
          <span className="truncate text-sm font-bold">{who}</span>
          <span className="truncate text-[10px] text-muted">{rewatchLine(rows[0].r, rows[0].fact.mine, names)}</span>
        </Link>
        <span className={PICTO_CELL} title={nOpen ? `${nOpen} à revoir` : undefined}>
          {nOpen > 0 && <PictoMark icon="clock" n={nOpen} cls="text-sky-300" />}
        </span>
        <span className={PICTO_CELL} title={nDone ? `${nDone} ${sw.revu}` : undefined}>
          {nDone > 0 && <PictoMark icon="check" n={nDone} cls="text-emerald-300" />}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          aria-label={open ? `Replier le détail de ${who}` : `Voir le détail de ${who}`}
          onClick={onToggle}
          className={`${CHEVRON_CELL} hover:text-fg`}
        >
          <span className={`transition ${open ? 'rotate-90' : ''}`}>›</span>
        </button>
      </div>
      {open && (
        <div id={detailId} className="flex flex-col gap-2 pb-2 pl-1">
          {rows.map((x) => (
            <RowDetail key={x.r.id} x={x} sex={p.sex} data={data} />
          ))}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Mon « à revoir » encore ouvert : le compléter ou le retirer (fenêtre « À revoir »). */}
            {rows.some((x) => !x.fact.done && isMyRewatch(x.r)) && <RewatchButton playerId={p.id} rows={rows.filter((x) => !x.fact.done && isMyRewatch(x.r)).map((x) => x.r)} />}
            <Link to={`${BASE}/${p.id}`} state={{ md: true }} onClick={() => rememberScroll(SCROLL)} className="text-[11px] font-bold text-accent hover:underline">
              Voir la fiche ›
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

/** Un « à revoir » en clair : qui, quand, d'où ; commentaire ; état ; événements et groupes visés ; « revu » à la main. */
function RowDetail({ x, sex, data }: { x: RankedRow<Rewatch>; sex?: string; data: PageData }) {
  const { r, fact } = x
  const sw = w(sex)
  const via = revisitedAt(r, data.keys)
  const evs = (r.events ?? []).map((id) => data.events.get(id)).filter((e): e is HBEvent => !!e)
  const grs = (r.groups ?? []).map((id) => data.groups.get(id)).filter((gr): gr is PlayerGroup => !!gr)
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-panel-2/40 px-2 py-1.5 text-[11px]">
      <span>{rewatchLine(r, fact.mine, namesOf(data))}</span>
      {r.note && <span className="text-sky-300">« {r.note} »</span>}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {fact.done ? (
          <b className="text-emerald-300">
            {sw.revu.replace(/^./, (c) => c.toUpperCase())} ✓
            <span className="font-normal text-muted">
              {via && data.events.get(via) ? ` à « ${data.events.get(via)!.name} »` : r.done?.byName ? ` par ${r.done.byName}` : ''}
              {r.done?.at && !via ? `, le ${fmtDate(r.done.at.slice(0, 10)).slice(0, 5)}` : ''}
            </span>
          </b>
        ) : (
          <span className="font-bold text-sky-300">Pas encore {sw.revu}</span>
        )}
        {!fact.done && (
          <button type="button" className="btn-ghost min-h-8 px-2.5 py-0.5 text-[11px]" onClick={() => void setRevisited([r], true)}>
            Marquer {sw.revu}
          </button>
        )}
        {r.done && (
          <button type="button" className="min-h-8 px-1 text-[11px] font-bold text-muted underline" onClick={() => void setRevisited([r], false)}>
            Remettre à revoir
          </button>
        )}
      </span>
      {(evs.length > 0 || grs.length > 0) && (
        <span className="flex flex-wrap items-center gap-1 text-[10px]">
          <span className="text-muted">À revoir à :</span>
          {evs.map((e) => (
            <Link key={e.id} to={`/evenements/${e.id}`} className="rounded-full border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 font-bold">
              {e.name} · {fmtDate(e.date)}
            </Link>
          ))}
          {grs.map((gr) => (
            <Link key={gr.id} to={`/groupes/${gr.id}`} className="rounded-full border border-accent/50 bg-accent-soft px-2 py-0.5 font-bold">
              <GroupMark g={gr} />
              {gr.name}
            </Link>
          ))}
        </span>
      )}
    </div>
  )
}

// ---------- Fiche ouverte depuis « À revoir » ----------

/** Joueurs de la page « À revoir », dans son ordre (session) ; adresse ouverte directement : le joueur seul. */
function readOrder(pid?: string): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(IDS_KEY) ?? '[]')
    const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
    return pid && !ids.includes(pid) ? [pid, ...ids] : ids
  } catch {
    return pid ? [pid] : []
  }
}

/**
 * /a-revoir/joueurs/:pid : la fiche dans le contexte de la page « À revoir » (comme depuis un événement, un groupe ou le
 * bilan). Ordinateur : ses joueurs à gauche, la fiche à droite ; « Fermer » revient à la page telle qu'on l'a laissée.
 * Téléphone : fiche en plein écran sous la barre « À revoir · 3 / 12 » (‹ ›, retour à la même position).
 */
export function RewatchPlayers() {
  const { pid } = useParams()
  const split = useMedia(MQ.split)
  const leave = useLeaveTo('/a-revoir', 'À revoir')
  const [ids] = useState(() => readOrder(pid))
  const rows = useLiveQuery(async () => {
    const ps = alive((await db.players.bulkGet(ids)).filter((p): p is Player => !!p))
    const rw = alive(await db.rewatch.where('playerId').anyOf(ids).toArray())
    const events = new Map((await db.events.bulkGet([...new Set(rw.map(originEvent).filter((x): x is string => !!x))])).filter((e): e is HBEvent => !!e).map((e) => [e.id, e]))
    const groups = new Map(alive((await db.groups.bulkGet([...new Set(rw.map((r) => (r.origin?.kind === 'group' ? r.origin.id : undefined)).filter((x): x is string => !!x))])).filter((x): x is PlayerGroup => !!x)).map((x) => [x.id, x]))
    return { ps, rw, events, groups }
  }, [ids.join(',')])
  if (!pid) return <Navigate to="/a-revoir" replace />
  if (!rows) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const byId = new Map(rows.ps.map((p) => [p.id, p]))
  const players = ids.map((id) => byId.get(id)).filter((p): p is Player => !!p)
  const latest = (id: string) => rows.rw.filter((r) => r.playerId === id).sort((a, b) => createdAtOf(b).localeCompare(createdAtOf(a)))[0]
  const g = listGender(undefined, players)

  if (!split)
    return (
      <>
        <ContextBar title="À revoir" ids={players.map((p) => p.id)} current={pid} base={BASE} back={() => void leave.go()} />
        <Outlet />
      </>
    )
  return (
    <MasterDetail
      base={BASE}
      closeTo="/a-revoir"
      listCol="minmax(0, var(--md-col))"
      list={
        <ContextRoster
          base={BASE}
          back={leave}
          count={`${pluralG(players.length, g)} · à revoir`}
          sections={[{ heading: null, players }]}
          detail={(p) => {
            const r = latest(p.id)
            return r ? rewatchLine(r, isMyRewatch(r), { event: (id) => rows.events.get(id)?.name, group: (id) => rows.groups.get(id)?.name }) : ''
          }}
          actions={(p) => ({ follow: <FollowStar id={p.id} sex={p.sex} /> })}
        />
      }
    />
  )
}

/** Fiche du joueur, sous un bandeau de ses « à revoir » en clair (qui, quand, d'où ; état). */
export function RewatchPlayer() {
  const { pid = '' } = useParams()
  const split = useMedia(MQ.split)
  const info = useLiveQuery(async () => {
    const [p, rw] = await Promise.all([db.players.get(pid), db.rewatch.where('playerId').equals(pid).toArray()])
    const rows = alive(rw).sort((a, b) => createdAtOf(b).localeCompare(createdAtOf(a)))
    const keys = await revisitedKeys(rows.flatMap((r) => r.events ?? []))
    const evIds = [...new Set(rows.flatMap((r) => [...(r.events ?? []), originEvent(r)]).filter((x): x is string => !!x))]
    const grIds = [...new Set(rows.map((r) => (r.origin?.kind === 'group' ? r.origin.id : undefined)).filter((x): x is string => !!x))]
    const [evs, grs] = await Promise.all([db.events.bulkGet(evIds), db.groups.bulkGet(grIds)])
    return { sex: p?.sex, rows, keys, events: new Map(evs.filter((e): e is HBEvent => !!e).map((e) => [e.id, e])), groups: new Map(alive(grs.filter((x): x is PlayerGroup => !!x)).map((x) => [x.id, x])) }
  }, [pid])
  const sw = w(info?.sex)
  return (
    <div key={pid} className="flex flex-col gap-3">
      {!!info?.rows.length && (
        <div className="flex flex-col gap-1 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-[11px]">
          {split && <span className="text-xs font-bold">À revoir</span>}
          {info.rows.map((r) => {
            const done = !!r.done || !!revisitedAt(r, info.keys)
            return (
              <span key={r.id}>
                {rewatchLine(r, isMyRewatch(r), { event: (id) => info.events.get(id)?.name, group: (id) => info.groups.get(id)?.name })}
                {' · '}
                {done ? <b className="text-emerald-300">{sw.revu} ✓</b> : <b className="text-sky-300">pas encore {sw.revu}</b>}
                {r.note && <span className="text-sky-300"> : « {r.note} »</span>}
              </span>
            )
          })}
        </div>
      )}
      {/* Téléphone : la barre du haut fait le retour à la page « À revoir ». */}
      <PlayerDetail id={pid} hideBack={!split} />
    </div>
  )
}
