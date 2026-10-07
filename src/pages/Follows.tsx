import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { alive, db, fmtDate, localDay, plural, positionLabel, type Player } from '../db'
import { buildFollowNews, followsSeen, markFollowsSeen, NEWS_TABLES, setFollow, useFollows, type FollowNews } from '../follows'
import { useThrottledQuery } from '../live'
import { Empty, Icon } from '../components/ui'

function dayLabel(day: string) {
  const now = Date.now()
  if (day === localDay(now)) return 'Aujourd’hui'
  if (day === localDay(now - 24 * 3600 * 1000)) return 'Hier'
  const d = new Date(day + 'T00:00:00')
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const nameOf = (p?: Player) => (p ? `${p.lastName.toUpperCase()} ${p.firstName}` : 'Joueur')

/** Une nouveauté (mesure ou avis) d'un joueur suivi, sur une ligne. */
function NewsLine({ n, seen }: { n: FollowNews; seen: number }) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <Icon name={n.kind === 'measurement' ? 'ruler' : 'star'} className="h-3.5 w-3.5 shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate">
        <b>{n.kind === 'evaluation' ? `Avis · ${n.text}` : n.text}</b>
        {n.pending && <span className="text-amber-300"> · à valider</span>}
        <span className="text-muted">{[n.kind === 'evaluation' ? n.detail : n.testDate && fmtDate(n.testDate), n.author].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
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
  const shown = [...items.filter((n) => n.kind === 'evaluation'), ...(all ? ms : ms.slice(0, SHOWN))]
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

/** Page « Mes suivis » : nouveautés des joueurs suivis, puis les joueurs et groupes suivis. */
export default function Follows() {
  // Ce qui est arrivé depuis la visite précédente est marqué ; la visite compte dès l'ouverture.
  const [seen] = useState(followsSeen)
  useEffect(() => markFollowsSeen(), [])
  const [days, setDays] = useState(30)
  const follows = useFollows()
  const news = useThrottledQuery(() => (follows ? buildFollowNews(days, follows) : Promise.resolve(undefined)), [days, follows], NEWS_TABLES.filter((t) => t !== 'follows' && t !== 'groups'))
  // Joueurs cités (nouveautés et suivis directs), lus un par un : jamais toute la base.
  const ids = [...new Set([...(news ?? []).map((n) => n.playerId), ...(follows?.players ?? [])])]
  const players = useLiveQuery(
    async () => new Map(alive((await db.players.bulkGet(ids)).filter((p): p is Player => !!p)).filter((p) => !p.mergedInto).map((p) => [p.id, p])),
    [ids.join()],
  )

  if (!follows || !players) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const direct = [...follows.players]
    .map((id) => players.get(id))
    .filter((p): p is Player => !!p)
    .sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr'))
  const shown = (news ?? []).filter((n) => players.has(n.playerId))
  // Par jour, puis par joueur (dans l'ordre de sa nouveauté la plus récente).
  const byDay = new Map<string, Map<string, FollowNews[]>>()
  for (const n of shown) {
    let d = byDay.get(n.day)
    if (!d) byDay.set(n.day, (d = new Map()))
    d.set(n.playerId, [...(d.get(n.playerId) ?? []), n])
  }
  const fresh = shown.filter((n) => n.time > seen && !n.mine).length
  const nothing = !follows.followed.size

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-extrabold">
          <Icon name="star" filled className="h-4 w-4 text-accent" />
          Mes suivis
        </h1>
        <p className="text-[11px] text-muted">
          Les nouvelles mesures et les nouveaux avis des joueurs que tu suis. Personne d’autre ne voit tes suivis ; un groupe « suivi par l’équipe » l’est par son
          créateur et ses participants.
        </p>
      </div>

      {nothing ? (
        <Empty>
          Tu ne suis encore personne. Appuie sur <b>Suivre</b> sur la fiche d’un joueur ou sur un groupe : ses nouveautés arriveront ici.
        </Empty>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="section-title mb-0">
            Nouveautés
            {fresh > 0 && <span className="ml-2 rounded-full bg-accent px-1.5 py-px text-[10px] text-white normal-case">{fresh > 99 ? '99+' : fresh} depuis ta dernière visite</span>}
          </div>
          {news === undefined ? (
            <p className="py-6 text-center text-xs text-muted">Chargement…</p>
          ) : (
            <>
              {[...byDay].map(([day, perPlayer]) => (
                <div key={day} className="card px-4 py-2">
                  <div className="section-title mt-1 mb-1">{dayLabel(day)}</div>
                  <div className="divide-y divide-line">
                    {[...perPlayer].map(([pid, items]) => {
                      const p = players.get(pid)
                      return (
                        <div key={pid} className="flex flex-col py-1.5">
                          <Link to={`/joueurs/${pid}`} className="truncate text-sm font-bold hover:text-accent">
                            {nameOf(p)}
                          </Link>
                          <PlayerNews items={items} seen={seen} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
              {!shown.length && <p className="py-4 text-center text-xs text-muted">Rien de nouveau sur les {days} derniers jours.</p>}
              <button className="btn-ghost text-xs" onClick={() => setDays((d) => d + 60)}>
                Voir plus ancien
              </button>
            </>
          )}
        </section>
      )}

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
                  <span className="shrink-0 text-[11px] text-muted" title="Suivi par l’équipe : seul le créateur du groupe peut le retirer">
                    {team ? 'par l’équipe' : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted">Aucun. Suivre un groupe, c’est suivre tous ses joueurs, y compris ceux ajoutés plus tard.</p>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <div className="section-title mb-0">Joueurs suivis ({direct.length})</div>
        {direct.length ? (
          <div className="card divide-y divide-line px-3">
            {direct.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-2 text-xs">
                <Link to={`/joueurs/${p.id}`} className="min-w-0 flex-1 truncate hover:text-accent">
                  <b>{nameOf(p)}</b>
                  <span className="text-muted">{[p.position && positionLabel(p.position), p.birthDate?.slice(0, 4)].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>
                </Link>
                <button className="shrink-0 text-[11px] font-bold text-muted hover:text-red-400" onClick={() => void setFollow('player', p.id, false)}>
                  Ne plus suivre
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted">Aucun joueur suivi un par un.</p>
        )}
      </section>
    </div>
  )
}
