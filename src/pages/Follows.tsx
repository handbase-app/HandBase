import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useSessionState } from '../components/PlayerFilter'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useEntryState } from '../backNav'
import { alive, db, fmtDate, localDay, plural, type Player } from '../db'
import { listGender, pluralG, setGender, w, type Gender } from '../gender'
import { buildFollowNews, followsSeen, markFollowsSeen, NEWS_TABLES, setFollow, useFollows, type FollowNews, type FollowsResult } from '../follows'
import {
  followOrigins,
  groupSections,
  originText,
  parseFollowView,
  pickSection,
  sectionChip,
  splitBySection,
  yearSections,
  type FollowOrigin,
  type FollowSection,
  type FollowView,
} from '../followViews'
import { positionRosterView } from '../positionOrder'
import { RosterChip, RosterSectionList } from '../components/PositionRoster'
import { useThrottledQuery } from '../live'
import { Empty, Icon, type IconName } from '../components/ui'
import { PlayerRow } from '../components/PlayerRow'
import { CapsuleTabs } from '../components/CapsuleTabs'
import { PlayerList } from '../components/Pictos'
import { CHEVRON_CELL, FoldCard, LINE_LINK, PICTO_CELL, PictoMark as Mark } from '../components/FoldCard'
import { TEAM_FOLLOW } from '../staffLabels'
import { focusLabel, focusLink, focusOfNews } from '../playerFocus'
import { daySummary, pictoLabel, ROW_KINDS, rowPictos, summaryLabel, summaryParts, type NewsKind } from '../followRows'

function dayLabel(day: string) {
  const now = Date.now()
  if (day === localDay(now)) return 'Aujourd’hui'
  if (day === localDay(now - 24 * 3600 * 1000)) return 'Hier'
  const d = new Date(day + 'T00:00:00')
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const nameOf = (p?: Player) => (p ? `${p.lastName.toUpperCase()} ${p.firstName}` : 'Joueur')

/** Pictogrammes des nouveautés : mêmes icônes et couleurs que ceux des listes de joueurs (src/components/Pictos.tsx). */
const KIND_ICON: Record<NewsKind, IconName> = { evaluation: 'chat', measurement: 'ruler', video: 'video' }
const KIND_COLOR: Record<NewsKind, string> = { evaluation: 'text-emerald-300', measurement: 'text-amber-300', video: 'text-violet-300' }
// Lien de ligne, case d'un pictogramme et chevron : src/components/FoldCard.tsx (communs avec « À revoir »).

/**
 * Pictogramme d'une ligne de « Mes suivis » : l'icône, et son nombre en pastille au-delà d'un (comme dans les listes de
 * joueurs, src/components/Pictos.tsx). Le même pour la ligne d'un joueur et pour la synthèse d'une journée.
 */
function PictoMark({ kind, n }: { kind: NewsKind | 'players'; n: number }) {
  return <Mark icon={kind === 'players' ? 'user' : KIND_ICON[kind]} n={n} cls={kind === 'players' ? 'text-muted' : KIND_COLOR[kind]} />
}
const isFresh = (n: FollowNews, seen: number) => n.time > seen && !n.mine
const FreshDot = () => <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Nouveau depuis ta dernière visite" />

/**
 * Un avis ou une vidéo d'un joueur suivi, sur une ligne : un lien qui ouvre sa fiche dessus (cet avis déplié, cette
 * vidéo ; src/playerFocus.ts). « Retour » ramène ici, même journée et même joueur dépliés, même position.
 */
function NewsLine({ n, seen, who }: { n: FollowNews; seen: number; who: string }) {
  return (
    <Link to={focusLink(n.playerId, focusOfNews(n))} aria-label={focusLabel(n, who)} className={`group -mx-1.5 flex items-center gap-2 px-1.5 py-1 text-xs ${LINE_LINK}`}>
      <Icon name={KIND_ICON[n.kind]} className="h-3.5 w-3.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">
        <b>{n.kind === 'evaluation' ? `Avis · ${n.text}` : `Vidéo · ${n.text}`}</b>
        {n.pending && <span className="text-amber-300"> · à valider</span>}
        <span className="text-muted">{[n.detail, n.author].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
      </span>
      {isFresh(n, seen) && <FreshDot />}
      {/* Ordinateur : petit chevron, plus marqué au survol. */}
      <span aria-hidden="true" className="hidden shrink-0 text-muted/60 group-hover:text-accent side:inline">
        ›
      </span>
    </Link>
  )
}

/** Cartes, joueurs et mesures dépliés : retenus pendant la session (retour d'une fiche). */
type OpenState = { has: (k: string) => boolean; toggle: (k: string) => void }

/**
 * Mesures d'un joueur sur une journée, sur une seule ligne : « Taille 180 cm (+2 cm) · Poids 65 kg », chacune un lien
 * vers sa courbe (sa ligne marquée) ; l'écart avec la mesure précédente du même test, sans jugement. Au-delà de
 * quelques-unes, « + N autres ».
 */
function MeasuresLine({ ms, seen, who, more }: { ms: FollowNews[]; seen: number; who: string; more: OpenState }) {
  const SHOWN = 6
  const moreKey = `m:${ms[0].day}|${ms[0].playerId}`
  const all = more.has(moreKey)
  const shown = all ? ms : ms.slice(0, SHOWN)
  const tail = [...new Set(ms.map((n) => n.testDate && fmtDate(n.testDate)).filter(Boolean)), ...new Set(ms.map((n) => n.author).filter(Boolean))]
  return (
    <div className="flex items-start gap-2 py-1 text-xs">
      <Icon name="ruler" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 leading-relaxed">
        {shown.map((n, i) => (
          <Fragment key={n.key}>
            {i > 0 && <span className="text-muted"> · </span>}
            <Link to={focusLink(n.playerId, focusOfNews(n))} aria-label={focusLabel(n, who)} className={`-mx-0.5 px-0.5 font-bold whitespace-nowrap hover:text-accent ${LINE_LINK}`}>
              {n.label} {n.value}
              {n.delta && <span className="font-normal text-muted"> ({n.delta})</span>}
            </Link>
          </Fragment>
        ))}
        {ms.length > SHOWN && (
          <button type="button" className="ml-1.5 text-[11px] font-bold text-accent" onClick={() => more.toggle(moreKey)}>
            {all ? 'Moins' : `+ ${ms.length - SHOWN} autres`}
          </button>
        )}
        <span className="text-muted">{tail.map((x) => ` · ${x}`).join('')}</span>
      </span>
      {ms.some((n) => isFresh(n, seen)) && <FreshDot />}
    </div>
  )
}

/**
 * Un joueur sur une journée, en une ligne compacte : son nom (toucher : déplier le détail), un pictogramme par sorte de
 * nouveauté (avis, mesures, vidéos) avec leur nombre au-delà d'une, chacun ouvrant la fiche au bon endroit
 * (src/followRows.ts), et le chevron. Dépliée : avis et vidéos une ligne chacun, les mesures sur une ligne, l'origine du
 * suivi et le lien vers la fiche. Repliée par défaut.
 */
function PlayerDay({
  pid,
  items,
  player,
  origin,
  except,
  seen,
  open,
  onToggle,
  more,
  columns,
}: {
  pid: string
  items: FollowNews[]
  player?: Player
  origin?: FollowOrigin
  except?: string
  seen: number
  open: boolean
  onToggle: () => void
  more: OpenState
  /** Sortes de nouveautés de la journée (colonnes des pictogrammes). */
  columns: readonly NewsKind[]
}) {
  const who = nameOf(player)
  const detailId = useId()
  const pictos = rowPictos(items)
  const ms = items.filter((n) => n.kind === 'measurement')
  return (
    <div className="py-0.5">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          title={open ? 'Replier le détail' : 'Voir le détail'}
          onClick={onToggle}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="min-w-0 truncate text-sm font-bold">{who}</span>
          {items.some((n) => isFresh(n, seen)) && <FreshDot />}
        </button>
        {/* Une colonne par sorte présente dans la journée : les pictogrammes restent alignés d'une ligne à l'autre. */}
        {columns.map((kind) => {
          const pc = pictos.find((x) => x.kind === kind)
          if (!pc) return <span key={kind} className="w-8 shrink-0" />
          const label = pictoLabel(pc.kind, pc.n, who)
          return (
            <Link key={pc.kind} to={focusLink(pid, pc.focus)} aria-label={label} title={label} className={`${PICTO_CELL} ${LINE_LINK}`}>
              <PictoMark kind={pc.kind} n={pc.n} />
            </Link>
          )
        })}
        {/* Même effet que le nom (déjà annoncé aux lecteurs d'écran) : seulement une cible de plus au doigt. */}
        <button type="button" tabIndex={-1} aria-hidden="true" onClick={onToggle} className={`${CHEVRON_CELL} hover:text-fg`}>
          <span className={`transition ${open ? 'rotate-90' : ''}`}>›</span>
        </button>
      </div>
      {open && (
        <div id={detailId} className="flex flex-col pb-1.5">
          {items
            .filter((n) => n.kind === 'evaluation')
            .map((n) => (
              <NewsLine key={n.key} n={n} seen={seen} who={who} />
            ))}
          {ms.length > 0 && <MeasuresLine ms={ms} seen={seen} who={who} more={more} />}
          {items
            .filter((n) => n.kind === 'video')
            .map((n) => (
              <NewsLine key={n.key} n={n} seen={seen} who={who} />
            ))}
          <div className="flex flex-wrap items-baseline gap-x-3 pt-0.5">
            <Link to={`/joueurs/${pid}`} className="text-[11px] font-bold text-accent hover:underline">
              Voir la fiche ›
            </Link>
            <OriginTag origin={origin} except={except} sex={player?.sex} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * D'où vient le suivi (« via U17 France », « via 2 groupes », « suivi direct ») : le détail (tous les groupes) au
 * survol, et à l'appui sur téléphone (il s'ouvre sous le texte).
 */
function OriginTag({ origin, except, sex }: { origin?: FollowOrigin; except?: string; sex?: string }) {
  const [open, setOpen] = useState(false)
  const t = originText(origin, except, sex)
  if (!t) return null
  return (
    <span className="ml-auto inline-flex max-w-full min-w-0 flex-col items-end text-right">
      <button
        type="button"
        title={t.detail}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(!open)
        }}
        className="max-w-full truncate text-[10px] font-bold text-muted hover:text-accent"
      >
        {t.text}
      </button>
      {open && <span className="text-[10px] whitespace-pre-line text-muted">{t.detail}</span>}
    </span>
  )
}

/** Tuiles des vues, au style de la frise du Bilan (src/pages/Coverage.tsx) : chiffre, nom, précision. */
function ViewTiles({ view, onChange, tiles }: { view: FollowView; onChange: (v: FollowView) => void; tiles: { v: FollowView; big: number; label: string; small: string }[] }) {
  return (
    <div role="tablist" aria-label="Ranger mes suivis" className="emph-band grid grid-cols-3 gap-2">
      {tiles.map((t) => {
        const on = t.v === view
        return (
          <button
            key={t.v}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.v)}
            className={`card flex min-h-11 min-w-0 flex-col items-start px-3 py-1.5 text-left transition hover:border-accent ${on ? 'border-accent bg-accent/10' : ''}`}
          >
            <span className={`text-base leading-tight font-extrabold tabular-nums ${on ? 'text-accent' : ''}`}>{t.big.toLocaleString('fr-FR')}</span>
            <span className="w-full truncate text-[10px] font-bold tracking-wider text-muted uppercase">{t.label}</span>
            <span className="w-full truncate text-[10px] text-muted">{t.small}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Nouveautés par jour puis par joueur (dans l'ordre de sa nouveauté la plus récente). */
function byDayThenPlayer(items: FollowNews[]) {
  const byDay = new Map<string, Map<string, FollowNews[]>>()
  for (const n of items) {
    let d = byDay.get(n.day)
    if (!d) byDay.set(n.day, (d = new Map()))
    d.set(n.playerId, [...(d.get(n.playerId) ?? []), n])
  }
  return byDay
}

/** Joueurs d'une journée : une ligne compacte chacun (PlayerDay), repliée par défaut ; dépliée, retenue pendant la session. */
function DayPlayers({
  perPlayer,
  players,
  origins,
  seen,
  except,
  more,
}: {
  perPlayer: Map<string, FollowNews[]>
  players: Map<string, Player>
  origins: Map<string, FollowOrigin>
  seen: number
  except?: string
  more: OpenState
}) {
  const all = [...perPlayer.values()].flat()
  const columns = ROW_KINDS.filter((k) => all.some((n) => n.kind === k))
  return (
    <div className="divide-y divide-line">
      {[...perPlayer].map(([pid, items]) => {
        const k = `p:${items[0].day}|${pid}`
        return (
          <PlayerDay
            key={pid}
            pid={pid}
            items={items}
            player={players.get(pid)}
            origin={origins.get(pid)}
            except={except}
            seen={seen}
            open={more.has(k)}
            onToggle={() => more.toggle(k)}
            more={more}
            columns={columns}
          />
        )
      })}
    </div>
  )
}

/**
 * Carte de nouveautés repliable (une section ou une journée) : repliée par défaut. Son en-tête est une ligne de synthèse
 * du même système que les lignes des joueurs (PictoMark, mêmes colonnes et chevron) : joueurs concernés, avis, mesures,
 * vidéos, chacun avec son nombre en pastille au-delà d'un (src/followRows.ts : daySummary) ; le nombre de nouveautés
 * depuis la dernière visite à côté du titre. Dépliée, le détail. État retenu pendant la session.
 */
function NewsCard({ title, items, seen, open, onToggle, children, g }: { title: ReactNode; items: FollowNews[]; seen: number; open: boolean; onToggle: () => void; children: ReactNode; g?: Gender }) {
  const fresh = items.filter((n) => n.time > seen && !n.mine).length
  const sum = daySummary(items)
  return (
    <FoldCard
      title={title}
      // La nouveauté depuis la dernière visite, juste après le titre.
      badge={
        fresh > 0 && (
          <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-bold text-white" title="Depuis ta dernière visite">
            +{fresh > 99 ? '99' : fresh}
          </span>
        )
      }
      // Une seule lecture : « 1 joueuse, 2 avis, 3 mesures, 1 vidéo » ; le détail de chacun au survol.
      summary={summaryParts(sum, g).map((p) => ({ key: p.key, icon: p.key === 'players' ? 'user' : KIND_ICON[p.key], n: p.n, text: p.text, cls: p.key === 'players' ? 'text-muted' : KIND_COLOR[p.key] }))}
      summaryLabel={summaryLabel(sum, g)}
      open={open}
      onToggle={onToggle}
    >
      {children}
    </FoldCard>
  )
}

/** Titre d'une section (groupe, « Suivis directement », année), dans la colonne des joueurs. */
function SectionHead({ s, follows, players }: { s: FollowSection; follows: FollowsResult; players: Map<string, Player> }) {
  const g = s.groupId ? follows.groups.find((x) => x.group.id === s.groupId) : undefined
  return (
    <div className="mt-1 flex items-center gap-2 border-b border-line pb-1">
      <span className="min-w-0 flex-1 text-sm font-extrabold">
        {g ? (
          <Link to={`/groupes/${g.group.id}`} className="hover:text-accent">
            {s.label}
          </Link>
        ) : (
          s.label
        )}
        <span className="font-normal text-muted"> · {pluralG(s.playerIds.length, setGender(g?.group.sex, s.playerIds.map((id) => players.get(id))))}</span>
      </span>
      {g &&
        (g.personal ? (
          <button className="shrink-0 text-[11px] font-bold text-muted hover:text-red-400" onClick={() => void setFollow('group', g.group.id, false)}>
            Ne plus suivre
          </button>
        ) : (
          g.team && (
            <span className="shrink-0 text-[11px] text-muted" title={TEAM_FOLLOW.removeTitle}>
              {TEAM_FOLLOW.short}
            </span>
          )
        ))}
    </div>
  )
}

/**
 * Page « Mes suivis » : vues Tout · Par groupe · Par année (?vue=), pastilles d'une section (&filtre=) qui filtrent les
 * nouveautés et les joueurs ; nouveautés à gauche, joueurs rangés par poste à droite (sur ordinateur). Logique dans
 * src/followViews.ts.
 */
export default function Follows() {
  // Ce qui est arrivé depuis la visite précédente est marqué ; la visite compte dès l'ouverture.
  // Gardée avec l'entrée de l'historique : au retour d'une fiche, les mêmes nouveautés restent marquées.
  const [seen] = useEntryState('suivis.vu', followsSeen)
  useEffect(() => markFollowsSeen(), [])
  // Période affichée : retrouvée au retour d'une fiche (pendant la session).
  const [days, setDays] = useSessionState('handbase.suivis.days', 30)
  const [params, setParams] = useSearchParams()
  // Cartes de nouveautés dépliées (repliées par défaut), retrouvées au retour d'une fiche pendant la session.
  const [opened, setOpened] = useSessionState<string[]>('handbase.suivis.ouverts', [])
  const toggle = (k: string) => setOpened((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]))
  const more: OpenState = { has: (k) => opened.includes(k), toggle }
  const loc = useLocation()
  const view = parseFollowView(params.get('vue'))
  const filterKey = params.get('filtre')
  // Onglet : Nouveautés (par défaut, sans paramètre) ou Joueurs suivis (?onglet=joueurs).
  const tab = params.get('onglet') === 'joueurs' ? 'joueurs' : 'nouveautes'
  const setTab = (t: 'nouveautes' | 'joueurs') => {
    const next = new URLSearchParams(params)
    if (t === 'joueurs') next.set('onglet', 'joueurs')
    else next.delete('onglet')
    setParams(next, { replace: true, state: loc.state })
  }
  // Vue et filtre dans l'adresse, remplacée (pas d'entrée d'historique ; « Retour » retrouve la vue).
  const setQuery = (v: FollowView, f: string | null) => {
    const next = new URLSearchParams(params)
    if (v === 'tout') next.delete('vue')
    else next.set('vue', v)
    if (f && v !== 'tout') next.set('filtre', f)
    else next.delete('filtre')
    setParams(next, { replace: true, state: loc.state })
  }
  const follows = useFollows()
  const news = useThrottledQuery(() => (follows ? buildFollowNews(days, follows) : Promise.resolve(undefined)), [days, follows], NEWS_TABLES.filter((t) => t !== 'follows' && t !== 'groups' && t !== 'teams'))
  // Joueurs suivis (directement ou par un groupe), lus un par un : jamais toute la base.
  const ids = [...new Set([...(news ?? []).map((n) => n.playerId), ...(follows?.followed ?? [])])]
  const players = useLiveQuery(
    async () => new Map(alive((await db.players.bulkGet(ids)).filter((p): p is Player => !!p)).filter((p) => !p.mergedInto).map((p) => [p.id, p])),
    [ids.join()],
  )

  const model = useMemo(() => {
    if (!follows || !players) return undefined
    const groups = follows.groups.map(({ group: g, team, personal }) => ({ id: g.id, name: g.name, playerIds: g.playerIds, team: team && !personal }))
    const origins = followOrigins(follows.players, groups)
    const all = [...follows.followed].map((id) => players.get(id)).filter((p): p is Player => !!p)
    const bySection = { groupe: groupSections(follows.players, groups, (id) => players.has(id)), annee: yearSections(all) }
    return { origins, all, bySection }
  }, [follows, players])

  if (!follows || !players || !model) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const { origins, all, bySection } = model
  const sections = view === 'tout' ? null : bySection[view]
  const picked = sections ? pickSection(sections, filterKey) : null
  const shownSections = sections ? (picked ? [picked] : sections) : null
  const inView = picked ? new Set(picked.playerIds) : null
  const shown = (news ?? []).filter((n) => players.has(n.playerId) && (!inView || inView.has(n.playerId)))
  const fresh = shown.filter((n) => n.time > seen && !n.mine).length
  const nothing = !follows.followed.size
  const byId = (pids: string[]) => pids.map((id) => players.get(id)).filter((p): p is Player => !!p)
  const groupCount = bySection.groupe.filter((s) => s.groupId).length
  // Accord (src/gender.ts) : section d'un groupe « Féminin » ou faite seulement de filles ; tous les suivis : filles seulement.
  const sectionGender = (s: FollowSection): Gender =>
    setGender(s.groupId ? follows.groups.find((x) => x.group.id === s.groupId)?.group.sex : undefined, byId(s.playerIds)) === 'F' ? 'F' : undefined
  const newsGender = (items: FollowNews[]): Gender => listGender(undefined, [...new Set(items.map((n) => n.playerId))].map((id) => players.get(id)))
  const gAll: Gender = listGender(undefined, all)
  const gw = w(picked ? sectionGender(picked) : gAll)
  // Section d'un groupe : l'origine affichée ne répète pas ce groupe (« aussi via … »).
  const exceptOf = (s: FollowSection) => (view === 'groupe' ? s.key : undefined)

  // Joueurs rangés par poste, puis par nom dans chaque poste ; l'origine du suivi sous la ligne.
  const roster = (list: Player[], except?: string): ReactNode => (
    <PlayerList ids={list.map((p) => p.id)}>
    <RosterSectionList
      sections={positionRosterView(list, 'nom').sections}
      listClass="flex flex-col gap-2"
      row={(p) => (
        <PlayerRow
          key={p.id}
          p={p}
          link={{ to: `/joueurs/${p.id}` }}
          below={
            originText(origins.get(p.id), except) ? (
              <div className="-mt-1 flex justify-end">
                <OriginTag origin={origins.get(p.id)} except={except} sex={p.sex} />
              </div>
            ) : undefined
          }
        />
      )}
    />
    </PlayerList>
  )

  return (
    // Deux onglets (Nouveautés · Joueurs suivis), sous les vues et les pastilles qui filtrent les deux.
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold">
            <Icon name="star" filled className="h-4 w-4 text-accent" />
            Mes suivis
          </h1>
        </div>
        {!nothing && (
          <>
            <ViewTiles
              view={view}
              onChange={(v) => setQuery(v, null)}
              tiles={[
                { v: 'tout', big: all.length, label: 'Tout', small: `${w(gAll).joueurs} ${w(gAll).suivis}` },
                { v: 'groupe', big: all.length, label: 'Par groupe', small: plural(groupCount, 'groupe') },
                { v: 'annee', big: all.length, label: 'Par année', small: plural(bySection.annee.length, 'année') },
              ]}
            />
            {sections && sections.length > 0 && (
              <div className="flex flex-wrap gap-1" aria-label="Filtrer sur une section">
                {sections.map((s) => (
                  <RosterChip key={s.key} on={picked?.key === s.key} onClick={() => setQuery(view, picked?.key === s.key ? null : s.key)}>
                    {sectionChip(s)}
                  </RosterChip>
                ))}
              </div>
            )}
            {/* Mêmes onglets que ceux d'un événement ou des groupes (CapsuleTabs). */}
            <CapsuleTabs
              label="Contenu"
              value={tab}
              onChange={setTab}
              items={[
                { value: 'nouveautes', label: fresh > 0 ? `Nouveautés (${fresh > 99 ? '99+' : fresh} nouvelles)` : 'Nouveautés' },
                { value: 'joueurs', label: `${gw.Joueurs} ${gw.suivis}`, count: inView ? inView.size : all.length },
              ]}
            />
          </>
        )}
      </div>

      {nothing ? (
        <Empty>
          {/* Règle de confidentialité ici seulement (31/10 : plus d'explication permanente sous le titre). */}
          Tu ne suis encore personne. Appuie sur <b>Suivre</b> sur la fiche d’un joueur ou sur un groupe : ses nouveautés arriveront ici. Personne d’autre ne
          voit tes suivis ; un groupe « {TEAM_FOLLOW.label.toLowerCase()} » l’est par son créateur et ses participants.
        </Empty>
      ) : tab === 'nouveautes' ? (
        <section className="flex flex-col gap-3">
          {fresh > 0 && <p className="text-[11px] text-muted">{plural(fresh, 'nouveauté')} depuis ta dernière visite{picked && ` · ${picked.label}`}.</p>}
          {news === undefined ? (
            <p className="py-6 text-center text-xs text-muted">Chargement…</p>
          ) : (
            <>
              {shownSections
                ? // Par groupe / par année : une carte par section (un joueur de deux groupes est dans les deux), jours dedans.
                  splitBySection(shown, shownSections)
                    .filter((x) => x.items.length)
                    .map(({ section: s, items }) => (
                      <NewsCard key={s.key} title={s.label} items={items} g={sectionGender(s)} seen={seen} open={!!picked || opened.includes(`s:${s.key}`)} onToggle={() => toggle(`s:${s.key}`)}>
                        {[...byDayThenPlayer(items)].map(([day, perPlayer]) => (
                          <div key={day}>
                            <div className="mt-1 text-[10px] font-bold tracking-wide text-muted uppercase">{dayLabel(day)}</div>
                            <DayPlayers perPlayer={perPlayer} players={players} origins={origins} seen={seen} except={exceptOf(s)} more={more} />
                          </div>
                        ))}
                      </NewsCard>
                    ))
                : [...byDayThenPlayer(shown)].map(([day, perPlayer]) => (
                    <NewsCard key={day} title={dayLabel(day)} items={[...perPlayer.values()].flat()} g={newsGender([...perPlayer.values()].flat())} seen={seen} open={opened.includes(`j:${day}`)} onToggle={() => toggle(`j:${day}`)}>
                      <DayPlayers perPlayer={perPlayer} players={players} origins={origins} seen={seen} more={more} />
                    </NewsCard>
                  ))}
              {!shown.length && <p className="py-4 text-center text-xs text-muted">Rien de nouveau sur les {days} derniers jours.</p>}
              <button className="btn-ghost text-xs" onClick={() => setDays((d) => d + 60)}>
                Voir plus ancien
              </button>
            </>
          )}
        </section>
      ) : (
      <div className="flex flex-col gap-4">
        {view === 'tout' && (
          <section className="flex flex-col gap-1">
            <div className="section-title mb-0">Groupes suivis ({follows.groups.length})</div>
            {follows.groups.length ? (
              <div className="card divide-y divide-line px-3">
                {follows.groups.map(({ group: g, personal, team }) => (
                  <div key={g.id} className="flex items-center gap-2 py-2 text-xs">
                    <Link to={`/groupes/${g.id}`} className="min-w-0 flex-1 truncate hover:text-accent">
                      <b>{g.name}</b>
                      <span className="text-muted"> · {pluralG(g.playerIds.length, g.sex)}</span>
                    </Link>
                    {personal ? (
                      <button className="shrink-0 text-[11px] font-bold text-muted hover:text-red-400" onClick={() => void setFollow('group', g.id, false)}>
                        Ne plus suivre
                      </button>
                    ) : (
                      <span className="shrink-0 text-[11px] text-muted" title={TEAM_FOLLOW.removeTitle}>
                        {team ? TEAM_FOLLOW.short : ''}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted">Aucun. Suivre un groupe, c’est suivre tous ses joueurs, y compris ceux ajoutés plus tard.</p>
            )}
          </section>
        )}

        {shownSections ? (
          shownSections.map((s) => (
            <section key={s.key} className="flex flex-col gap-1">
              <SectionHead s={s} follows={follows} players={players} />
              {roster(byId(s.playerIds), exceptOf(s))}
            </section>
          ))
        ) : (
          <section className="flex flex-col gap-1">
            <div className="section-title mb-0">{w(gAll).Joueurs} {w(gAll).suivis} ({all.length})</div>
            {all.length ? (
              // Chaque joueur une seule fois, avec l'origine de son suivi ; l'étoile pleine retire le suivi direct d'un toucher.
              <div className="flex flex-col gap-2">{roster(all)}</div>
            ) : (
              <p className="text-[11px] text-muted">Aucun joueur suivi.</p>
            )}
          </section>
        )}
      </div>
      )}
    </div>
  )
}
