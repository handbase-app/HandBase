import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { buildFeed, FEED_KINDS, feedSeen, localDay, markFeedSeen, upcomingEvents, type FeedItem, type FeedKind } from '../feed'
import { myDepartments } from '../roles'
import { EVENT_TYPES } from './Evaluate'
import { Icon } from '../components/ui'

const PREFS_KEY = 'handbase.feedPrefs'
type Prefs = { kinds: FeedKind[]; hideMine: boolean; sector: boolean }
const readPrefs = (): Prefs => {
  try {
    return { kinds: [], hideMine: false, sector: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return { kinds: [], hideMine: false, sector: false }
  }
}

const icon = (k: FeedKind) => FEED_KINDS.find((x) => x.value === k)!.icon
const time = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

function dayLabel(day: string) {
  const now = Date.now()
  if (day === localDay(now)) return 'Aujourd’hui'
  if (day === localDay(now - 24 * 3600 * 1000)) return 'Hier'
  const d = new Date(day + 'T00:00:00')
  const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** `withDay` : l'heure seule aujourd'hui, sinon « hier » ou la date (encadré de l'accueil). */
function Row({ it, seen, withDay = false }: { it: FeedItem; seen: number; withDay?: boolean }) {
  const today = it.day === localDay(Date.now())
  const body = (
    <div className="flex gap-2.5 py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-panel-2 text-muted">
        <Icon name={icon(it.kind)} />
      </span>
      <div className="min-w-0 flex-1 text-xs">
        <div>
          {it.author && <b>{it.author} · </b>}
          {it.author ? it.text : it.text.charAt(0).toUpperCase() + it.text.slice(1)}
          {it.time > seen && !it.mine && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" title="Nouveau" />}
        </div>
        {it.detail && <div className="truncate text-[11px] text-muted">{it.detail}</div>}
      </div>
      <span className="shrink-0 text-[10px] text-muted">
        {!withDay || today ? time(it.time) : dayLabel(it.day) === 'Hier' ? 'hier' : new Date(it.time).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
      </span>
    </div>
  )
  return it.to ? (
    <Link to={it.to} className="block hover:bg-panel-2/60">
      {body}
    </Link>
  ) : (
    body
  )
}

function Upcoming({ n }: { n: number }) {
  const evs = useLiveQuery(() => upcomingEvents(n), [n], [])
  if (!evs.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      {evs.map((e) => {
        const d = new Date(e.date + 'T00:00:00')
        return (
          <Link key={e.id} to={`/evenements/${e.id}`} className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2 hover:border-accent">
            <div className="w-10 shrink-0 text-center leading-tight">
              <div className="text-[9px] font-bold text-muted uppercase">{d.toLocaleDateString('fr-FR', { weekday: 'short' })}</div>
              <div className="text-base font-extrabold text-accent">{d.getDate()}</div>
              <div className="text-[9px] text-muted">{d.toLocaleDateString('fr-FR', { month: 'short' })}</div>
            </div>
            <div className="min-w-0 text-xs">
              <div className="truncate font-bold">{e.name}</div>
              <div className="truncate text-[11px] text-muted">
                {[EVENT_TYPES.find((t) => t.value === e.type)?.label, e.place].filter(Boolean).join(' · ')}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

/** Encadré de l'accueil : prochains événements et dernières nouveautés. */
export function HomeFeed() {
  const [seen] = useState(feedSeen)
  const items = useLiveQuery(() => buildFeed({ days: 14 }), [], [])
  const fresh = items.filter((i) => i.time > seen && !i.mine).length
  return (
    <div className="card flex w-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="section-title mb-0">
          Quoi de neuf
          {fresh > 0 && <span className="ml-2 rounded-full bg-accent px-1.5 py-px text-[10px] text-white normal-case">{fresh > 99 ? '99+' : fresh} nouveau{fresh > 1 ? 'x' : ''}</span>}
        </div>
        <Link to="/actualite" className="text-[11px] font-bold text-accent">
          Tout voir →
        </Link>
      </div>
      <Upcoming n={2} />
      {items.length ? (
        <div className="divide-y divide-line">
          {items.slice(0, 6).map((it) => (
            <Row key={it.key} it={it} seen={seen} withDay />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted">Rien de nouveau ces deux dernières semaines.</p>
      )}
    </div>
  )
}

/** Page « Quoi de neuf » : tout le fil, jour par jour. */
export default function Feed() {
  // La pastille compte ce qui est arrivé depuis la visite précédente.
  const [seen] = useState(feedSeen)
  useEffect(() => markFeedSeen(), [])
  const [days, setDays] = useState(30)
  const [prefs, setPrefs] = useState(readPrefs)
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* stockage indisponible */
    }
  }, [prefs])
  const hasSector = myDepartments().length > 0
  const items = useLiveQuery(() => buildFeed({ days, sector: hasSector && prefs.sector }), [days, prefs.sector, hasSector])
  const shown = (items ?? []).filter((i) => (!prefs.kinds.length || prefs.kinds.includes(i.kind)) && !(prefs.hideMine && i.mine))
  const byDay = new Map<string, FeedItem[]>()
  for (const it of shown) byDay.set(it.day, [...(byDay.get(it.day) ?? []), it])
  const toggle = (k: FeedKind) => setPrefs((p) => ({ ...p, kinds: p.kinds.includes(k) ? p.kinds.filter((x) => x !== k) : [...p.kinds, k] }))
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-[11px] font-bold ${on ? 'border-accent bg-accent/15 text-white' : 'border-line text-muted'}`

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-extrabold">Quoi de neuf</h1>

      <section className="flex flex-col gap-2">
        <div className="section-title mb-0">À venir</div>
        <Upcoming n={3} />
      </section>

      <div className="flex flex-wrap gap-1.5">
        <button className={chip(!prefs.kinds.length)} onClick={() => setPrefs((p) => ({ ...p, kinds: [] }))}>
          Tout
        </button>
        {FEED_KINDS.map((k) => (
          <button key={k.value} className={chip(prefs.kinds.includes(k.value))} onClick={() => toggle(k.value)}>
            <Icon name={k.icon} className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
            {k.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {hasSector && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={prefs.sector} onChange={(e) => setPrefs((p) => ({ ...p, sector: e.target.checked }))} />
            Mon secteur seulement
          </label>
        )}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={prefs.hideMine} onChange={(e) => setPrefs((p) => ({ ...p, hideMine: e.target.checked }))} />
          Masquer mes actions
        </label>
      </div>

      {items === undefined ? (
        <p className="py-10 text-center text-sm text-muted">Chargement…</p>
      ) : (
        <>
          {[...byDay].map(([day, its]) => (
            <section key={day} className="card px-4 py-2">
              <div className="section-title mt-1 mb-0">{dayLabel(day)}</div>
              <div className="divide-y divide-line">
                {its.map((it) => (
                  <Row key={it.key} it={it} seen={seen} />
                ))}
              </div>
            </section>
          ))}
          {!shown.length && <p className="py-6 text-center text-xs text-muted">Rien de nouveau sur les {days} derniers jours.</p>}
          <button className="btn-ghost text-xs" onClick={() => setDays((d) => d + 60)}>
            Voir plus ancien
          </button>
        </>
      )}
    </div>
  )
}
