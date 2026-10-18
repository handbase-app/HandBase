import { useSessionState } from '../components/PlayerFilter'
import { Link } from 'react-router-dom'
import { BackButton } from '../backNav'
import { listGender, w } from '../gender'
import { alive, db, fmtDate, remove, type HBEvent, type Player, type PlayerGroup } from '../db'
import { useThrottledQuery } from '../live'
import { can, useRole } from '../roles'
import { isMyRewatch, loadRewatchEntries, revisitedAt, setRevisited, stamp, type RewatchEntry } from '../scouting'
import { ask } from '../components/Confirm'
import type { MenuExtra } from '../components/PlayerMenu'
import { RewatchButton, RewatchOrigins } from '../components/Scouting'
import { Empty, GroupMark } from '../components/ui'
import { PlayerRow } from '../components/PlayerRow'
import { PlayerList } from '../components/Pictos'

/**
 * « Mes à revoir » (supabase/041_reperage_tournoi.sql) : joueurs que mon staff veut revoir, une ligne par joueur avec
 * chaque auteur, son origine et son commentaire. Revu : automatiquement s'il a été vu ou noté dans un événement visé ;
 * sinon (groupe, liste générale) avec le bouton « Revu ». Un administrateur peut afficher ceux de tous les staffs.
 */
export default function RewatchPage() {
  const role = useRole()
  // Onglet et « tous les staffs » : retrouvés au retour d'une fiche (pendant la session).
  const [tab, setTab] = useSessionState<'open' | 'done'>('handbase.arevoir.tab', 'open')
  const [all, setAll] = useSessionState('handbase.arevoir.all', false)
  const data = useThrottledQuery(
    async () => {
      const { entries, keys } = await loadRewatchEntries({ mine: !all })
      const rows = entries.flatMap((e) => e.rows)
      const [players, events, groups] = await Promise.all([
        db.players.bulkGet(entries.map((e) => e.playerId)),
        db.events.bulkGet([...new Set(rows.flatMap((r) => [...(r.events ?? []), ...(r.originEventId ? [r.originEventId] : [])]))]),
        db.groups.bulkGet([...new Set(rows.flatMap((r) => r.groups ?? []))]),
      ])
      return {
        entries,
        keys,
        players: new Map(alive(players.filter((p): p is Player => !!p)).filter((p) => !p.mergedInto).map((p) => [p.id, p])),
        events: new Map(events.filter((e): e is HBEvent => !!e).map((e) => [e.id, e])),
        groups: new Map(alive(groups.filter((g): g is PlayerGroup => !!g)).map((g) => [g.id, g])),
      }
    },
    [all, role],
    ['rewatch', 'seen', 'evaluations', 'players', 'events', 'groups', 'teams'],
    300,
  )
  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const { entries, keys, players, events, groups } = data
  const known = entries.filter((e) => players.has(e.playerId))
  const open = known.filter((e) => e.open.length)
  const done = known.filter((e) => !e.open.length)
  const latest = (e: RewatchEntry) => Math.max(...e.rows.map(stamp))
  const shown = (tab === 'open' ? open : done).sort((a, b) => latest(b) - latest(a))
  // Accord (src/gender.ts) : liste faite seulement de filles → au féminin ; sinon masculin générique.
  const gw = w(listGender(undefined, known.map((e) => players.get(e.playerId))))

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <BackButton fallback="/" label="ACCUEIL" />
      <div>
        <h1 className="text-lg font-extrabold">Mes à revoir</h1>
        <p className="text-[11px] text-muted">
          {gw.Joueurs} que ton staff veut revoir. {gw.revu.replace(/^./, (c) => c.toUpperCase())} dès qu’{gw.il} est {gw.vu} ou {gw.note} dans un événement visé ; pour un groupe ou la liste générale, avec « Revu ».
        </p>
        {can.viewCoverage(role) && (
          <Link to="/bilan" className="mt-1 inline-block text-[11px] font-bold text-accent">
            Bilan de détection : qui reste à voir, par génération et par club →
          </Link>
        )}
      </div>
      <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold">
        {(
          [
            ['open', `À revoir (${open.length})`],
            ['done', `${gw.revus.replace(/^./, (c) => c.toUpperCase())} (${done.length})`],
          ] as const
        ).map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`flex-1 py-2 ${tab === v ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
            {label}
          </button>
        ))}
      </div>
      {role === 'admin' && (
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Tous les staffs (administrateur)
        </label>
      )}
      {!shown.length && <Empty>{tab === 'open' ? `${gw.AucunJoueur} à revoir pour ton staff.` : `${gw.AucunJoueur} ${gw.revu} pour l’instant.`}</Empty>}
      <PlayerList ids={shown.map((e) => e.playerId)}>
      <div className="cols flex flex-col gap-2">
        {shown.map((e) => {
          const p = players.get(e.playerId)!
          const rows = tab === 'open' ? e.open : e.rows
          const evIds = [...new Set(rows.flatMap((r) => r.events ?? []))]
          const grIds = [...new Set(rows.flatMap((r) => r.groups ?? []))]
          const manual = e.rows.filter((r) => r.done)
          const via = e.rows.map((r) => revisitedAt(r, keys)).find(Boolean)
          // Menu de la ligne : « Revu », « Remettre à revoir », retirer mon « à revoir » (après confirmation).
          // « Modifier » : « À revoir… » du menu commun (ma fenêtre « à revoir », déjà remplie).
          const mineOpen = e.open.filter(isMyRewatch)
          const extras: (MenuExtra | false)[] = [
            tab === 'open' && { label: 'Marquer revu', icon: 'check', hint: 'tous ses « à revoir » ouverts', onSelect: () => void setRevisited(e.open, true) },
            tab === 'done' && manual.length > 0 && { label: 'Remettre à revoir', icon: 'undo', onSelect: () => void setRevisited(manual, false) },
            mineOpen.length > 0 && {
              label: 'Retirer mon « à revoir »',
              icon: 'close',
              onSelect: async () => {
                const note = mineOpen.some((r) => r.note) ? ' Ton commentaire est retiré avec lui.' : ''
                if (!(await ask(`Retirer ton « à revoir » sur ${p.lastName.toUpperCase()} ${p.firstName} ?${note} Ceux des autres membres du staff restent.`, { ok: 'Retirer', focusCancel: true })))
                  return
                for (const r of mineOpen) await remove('rewatch', r.id)
              },
            },
          ]
          return (
            <PlayerRow
              key={e.playerId}
              p={p}
              link={{ to: `/joueurs/${p.id}` }}
              menuExtras={extras.filter((x): x is MenuExtra => !!x)}
              below={
                <>
                  {/* « Revu ✓ » : sous la ligne (pas à côté du nom, qu'il couperait dans une carte étroite). */}
                  {tab === 'done' && (
                    <div className="text-[11px] font-bold text-emerald-300">
                      {w(p.sex).revu} ✓{' '}
                      <span className="text-[10px] font-normal text-muted">
                        {via && events.get(via) ? events.get(via)!.name : manual.map((r) => r.done?.byName).filter(Boolean).join(', ')}
                      </span>
                    </div>
                  )}
                  <RewatchOrigins rows={rows} events={events} />
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    {evIds.map((id) => {
                      const ev = events.get(id)
                      return ev ? (
                        <Link key={id} to={`/evenements/${id}`} className="rounded-full border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 font-bold">
                          {ev.name} · {fmtDate(ev.date)}
                        </Link>
                      ) : null
                    })}
                    {grIds.map((id) => {
                      const g = groups.get(id)
                      return g ? (
                        <Link key={id} to={`/groupes/${id}`} className="rounded-full border border-accent/50 bg-accent-soft px-2 py-0.5 font-bold">
                          <GroupMark g={g} />
                          {g.name}
                        </Link>
                      ) : null
                    })}
                    {!evIds.length && !grIds.length && <span className="text-muted">liste générale</span>}
                    {tab === 'open' && <RewatchButton playerId={p.id} rows={e.open} className="ml-auto" />}
                    {tab === 'open' && (
                      <button
                        className="btn-ghost shrink-0 px-3 py-1 text-xs"
                        title={`Marquer ${w(p.sex).revu} (pour tous les « à revoir » ouverts de ${w(p.sex).ceJoueur})`}
                        onClick={() => void setRevisited(e.open, true)}
                      >
                        Revu
                      </button>
                    )}
                    {tab === 'done' && manual.length > 0 && (
                      <button className="ml-auto text-[10px] font-bold text-muted underline" onClick={() => void setRevisited(manual, false)}>
                        Remettre à revoir
                      </button>
                    )}
                  </div>
                </>
              }
            />
          )
        })}
      </div>
      </PlayerList>
    </div>
  )
}
