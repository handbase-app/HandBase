import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSessionState } from '../components/PlayerFilter'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { alive, db, fmtDate, localDay, plural, type Player } from '../db'
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
import { Empty, Icon } from '../components/ui'
import { PlayerRow } from '../components/PlayerRow'
import { FollowStar } from '../components/Follow'
import { TEAM_FOLLOW } from '../staffLabels'

function dayLabel(day: string) {
  const now = Date.now()
  if (day === localDay(now)) return 'Aujourd’hui'
  if (day === localDay(now - 24 * 3600 * 1000)) return 'Hier'
  const d = new Date(day + 'T00:00:00')
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const nameOf = (p?: Player) => (p ? `${p.lastName.toUpperCase()} ${p.firstName}` : 'Joueur')

/** Une nouveauté (mesure, avis ou vidéo) d'un joueur suivi, sur une ligne. */
function NewsLine({ n, seen }: { n: FollowNews; seen: number }) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <Icon name={n.kind === 'measurement' ? 'ruler' : n.kind === 'video' ? 'video' : 'star'} className="h-3.5 w-3.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">
        <b>{n.kind === 'evaluation' ? `Avis · ${n.text}` : n.kind === 'video' ? `Vidéo · ${n.text}` : n.text}</b>
        {n.pending && <span className="text-amber-300"> · à valider</span>}
        <span className="text-muted">{[n.kind === 'measurement' ? n.testDate && fmtDate(n.testDate) : n.detail, n.author].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
      </span>
      {n.time > seen && !n.mine && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Nouveau depuis ta dernière visite" />}
    </div>
  )
}

/** Nouveautés d'un joueur sur une journée : une ligne chacune, les mesures repliées au-delà de quelques-unes. */
function PlayerNews({ items, seen }: { items: FollowNews[]; seen: number }) {
  const [all, setAll] = useState(false)
  const SHOWN = 5
  const ms = items.filter((n) => n.kind === 'measurement')
  const shown = [...items.filter((n) => n.kind !== 'measurement'), ...(all ? ms : ms.slice(0, SHOWN))]
  return (
    <>
      {shown.map((n) => (
        <NewsLine key={n.key} n={n} seen={seen} />
      ))}
      {ms.length > SHOWN && (
        <button className="self-start py-0.5 pl-5.5 text-[11px] font-bold text-accent" onClick={() => setAll(!all)}>
          {all ? 'Moins' : `+ ${ms.length - SHOWN} autres mesures`}
        </button>
      )}
    </>
  )
}


/**
 * D'où vient le suivi (« via U17 France », « via 2 groupes », « suivi direct ») : le détail (tous les groupes) au
 * survol, et à l'appui sur téléphone (il s'ouvre sous le texte).
 */
function OriginTag({ origin, except }: { origin?: FollowOrigin; except?: string }) {
  const [open, setOpen] = useState(false)
  const t = originText(origin, except)
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

/** Joueurs d'une journée : nom (vers la fiche), origine du suivi, nouveautés. */
function DayPlayers({
  perPlayer,
  players,
  origins,
  seen,
  except,
}: {
  perPlayer: Map<string, FollowNews[]>
  players: Map<string, Player>
  origins: Map<string, FollowOrigin>
  seen: number
  except?: string
}) {
  return (
    <div className="divide-y divide-line">
      {[...perPlayer].map(([pid, items]) => (
        <div key={pid} className="flex flex-col py-1.5">
          {/* Origine à droite du nom ; sur téléphone, elle passe dessous quand la place manque. */}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link to={`/joueurs/${pid}`} className="max-w-full min-w-0 truncate text-sm font-bold hover:text-accent">
              {nameOf(players.get(pid))}
            </Link>
            <OriginTag origin={origins.get(pid)} except={except} />
          </div>
          <PlayerNews items={items} seen={seen} />
        </div>
      ))}
    </div>
  )
}

/**
 * Carte de nouveautés repliable (une section ou une journée) : repliée par défaut, son titre donne le nombre de nouveautés
 * (dont celles depuis la dernière visite) et de joueurs ; dépliée, le détail. État retenu pendant la session.
 */
function NewsCard({ title, items, seen, open, onToggle, children }: { title: ReactNode; items: FollowNews[]; seen: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  const fresh = items.filter((n) => n.time > seen && !n.mine).length
  const who = new Set(items.map((n) => n.playerId)).size
  return (
    <div className="card px-4 py-1">
      <button type="button" className="flex w-full items-center gap-2 py-1.5 text-left" aria-expanded={open} onClick={onToggle}>
        {/* Titre en entier ; les nombres dessous (sur téléphone, à côté ils le coupaient). */}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="section-title my-0">{title}</span>
          <span className="text-[11px] text-muted">
            {plural(items.length, 'nouveauté')} · {plural(who, 'joueur')}
          </span>
        </span>
        {fresh > 0 && (
          <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[10px] font-bold text-white" title="Depuis ta dernière visite">
            +{fresh > 99 ? '99' : fresh}
          </span>
        )}
        <span className={`shrink-0 text-muted transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

/** Titre d'une section (groupe, « Suivis directement », année), dans la colonne des joueurs. */
function SectionHead({ s, follows }: { s: FollowSection; follows: FollowsResult }) {
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
        <span className="font-normal text-muted"> · {plural(s.playerIds.length, 'joueur')}</span>
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
  const [seen] = useState(followsSeen)
  useEffect(() => markFollowsSeen(), [])
  // Période affichée : retrouvée au retour d'une fiche (pendant la session).
  const [days, setDays] = useSessionState('handbase.suivis.days', 30)
  const [params, setParams] = useSearchParams()
  // Cartes de nouveautés dépliées (repliées par défaut), retrouvées au retour d'une fiche pendant la session.
  const [opened, setOpened] = useSessionState<string[]>('handbase.suivis.ouverts', [])
  const toggle = (k: string) => setOpened((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]))
  const loc = useLocation()
  const view = parseFollowView(params.get('vue'))
  const filterKey = params.get('filtre')
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
  // Section d'un groupe : l'origine affichée ne répète pas ce groupe (« aussi via … »).
  const exceptOf = (s: FollowSection) => (view === 'groupe' ? s.key : undefined)

  // Joueurs rangés par poste, puis par nom dans chaque poste ; l'origine du suivi sous la ligne.
  const roster = (list: Player[], except?: string): ReactNode => (
    <RosterSectionList
      sections={positionRosterView(list, 'nom').sections}
      listClass="flex flex-col gap-2"
      row={(p) => (
        <PlayerRow
          key={p.id}
          p={p}
          link={{ to: `/joueurs/${p.id}` }}
          follow={<FollowStar id={p.id} />}
          below={
            originText(origins.get(p.id), except) ? (
              <div className="-mt-1 flex justify-end">
                <OriginTag origin={origins.get(p.id)} except={except} />
              </div>
            ) : undefined
          }
        />
      )}
    />
  )

  return (
    // Ordinateur : nouveautés à gauche, groupes et joueurs suivis à droite.
    <div className="flex flex-col gap-4 side:grid side:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] side:items-start side:gap-x-6">
      <div className="flex flex-col gap-3 side:col-span-full">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold">
            <Icon name="star" filled className="h-4 w-4 text-accent" />
            Mes suivis
          </h1>
          <p className="max-w-3xl text-[11px] text-muted">
            Les nouvelles mesures et les nouveaux avis des joueurs que tu suis. Personne d’autre ne voit tes suivis ; un groupe « {TEAM_FOLLOW.label.toLowerCase()} » l’est par son
            créateur et ses participants.
          </p>
        </div>
        {!nothing && (
          <>
            <ViewTiles
              view={view}
              onChange={(v) => setQuery(v, null)}
              tiles={[
                { v: 'tout', big: all.length, label: 'Tout', small: 'joueurs suivis' },
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
          </>
        )}
      </div>

      {nothing ? (
        <Empty>
          Tu ne suis encore personne. Appuie sur <b>Suivre</b> sur la fiche d’un joueur ou sur un groupe : ses nouveautés arriveront ici.
        </Empty>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="section-title mb-0">
            Nouveautés{picked && ` · ${picked.label}`}
            {fresh > 0 && <span className="ml-2 rounded-full bg-accent px-1.5 py-px text-[10px] text-white normal-case">{fresh > 99 ? '99+' : fresh} depuis ta dernière visite</span>}
          </div>
          {news === undefined ? (
            <p className="py-6 text-center text-xs text-muted">Chargement…</p>
          ) : (
            <>
              {shownSections
                ? // Par groupe / par année : une carte par section (un joueur de deux groupes est dans les deux), jours dedans.
                  splitBySection(shown, shownSections)
                    .filter((x) => x.items.length)
                    .map(({ section: s, items }) => (
                      <NewsCard key={s.key} title={s.label} items={items} seen={seen} open={!!picked || opened.includes(`s:${s.key}`)} onToggle={() => toggle(`s:${s.key}`)}>
                        {[...byDayThenPlayer(items)].map(([day, perPlayer]) => (
                          <div key={day}>
                            <div className="mt-1 text-[10px] font-bold tracking-wide text-muted uppercase">{dayLabel(day)}</div>
                            <DayPlayers perPlayer={perPlayer} players={players} origins={origins} seen={seen} except={exceptOf(s)} />
                          </div>
                        ))}
                      </NewsCard>
                    ))
                : [...byDayThenPlayer(shown)].map(([day, perPlayer]) => (
                    <NewsCard key={day} title={dayLabel(day)} items={[...perPlayer.values()].flat()} seen={seen} open={opened.includes(`j:${day}`)} onToggle={() => toggle(`j:${day}`)}>
                      <DayPlayers perPlayer={perPlayer} players={players} origins={origins} seen={seen} />
                    </NewsCard>
                  ))}
              {!shown.length && <p className="py-4 text-center text-xs text-muted">Rien de nouveau sur les {days} derniers jours.</p>}
              <button className="btn-ghost text-xs" onClick={() => setDays((d) => d + 60)}>
                Voir plus ancien
              </button>
            </>
          )}
        </section>
      )}

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
                      <span className="text-muted"> · {plural(g.playerIds.length, 'joueur')}</span>
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
              <SectionHead s={s} follows={follows} />
              {roster(byId(s.playerIds), exceptOf(s))}
            </section>
          ))
        ) : (
          <section className="flex flex-col gap-1">
            <div className="section-title mb-0">Joueurs suivis ({all.length})</div>
            {all.length ? (
              // Chaque joueur une seule fois, avec l'origine de son suivi ; l'étoile pleine retire le suivi direct d'un toucher.
              <div className="flex flex-col gap-2">{roster(all)}</div>
            ) : (
              <p className="text-[11px] text-muted">Aucun joueur suivi.</p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
