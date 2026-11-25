import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db, TRIAL, type Player, type PlayerGroup } from '../db'
import { DEMO_LAMP_ZONE } from '../demoLamp'
import { cleanLampSettings, LAMP_KEY, lampContext, lampView, pctText, TASK, zoneFor, type LampSettings, type LampView, type Zone } from '../lamp'
import { fetchPlayerLamp, saveCoach, type StaffLampRow } from '../lampApi'
import { useRole } from '../roles'
import { supabase } from '../sync'
import { LampSvg } from './PlayerLamp'

/*
 * Lampe d'Aladin, côté STAFF, sur la fiche (onglet Wellness, src/components/PlayerWellness.tsx) : même public que le wellness
 * (administrateurs, encadrants créateurs ou participants d'un groupe qui le demande à la fiche ; le serveur vérifie :
 * hb_lampe_groupe, hb_lampe_coach). Choisi plutôt que l'onglet Avis : les avis sont lus par tous les observateurs, la lampe
 * et ses points ne regardent que l'encadrement du pôle.
 *  - Sa lampe (même calcul que celle du jeune, src/lamp.ts), ses trimestres, son bonus, sa série, ce qu'il a fait aujourd'hui.
 *  - « Part des encadrants » : 5 critères (Réglages), 0 / +1 / +2 chacun, pour la saison ; les points s'AJOUTENT seulement
 *    (un encadrant ne baisse pas un point donné ; un administrateur peut corriger une erreur). Le jeune voit seulement
 *    « + x % de tes encadrants », jamais le détail ni un manque.
 *  - Ses 3 vœux (pour les lots).
 * Jamais un texte du jeune ici (ses cahiers partagés sont dans l'onglet de son journal).
 */

/** Réglage « lampe » de l'installation (copie de l'appareil ; mode essai ou sans serveur : ouverte). */
export function useLampSettings(): LampSettings {
  const row = useLiveQuery(() => db.config.get(LAMP_KEY), [])
  return cleanLampSettings(row && !row.deleted ? row.value : undefined, { trial: TRIAL || !supabase })
}

/** Zone des vacances d'un groupe Pôle : départements de l'unité, sinon son site. */
export function useGroupZone(g: Pick<PlayerGroup, 'poleUnitId'> | undefined): Zone | null | undefined {
  return useLiveQuery(async () => {
    if (!g?.poleUnitId) return null
    const u = await db.units.get(g.poleUnitId)
    if (!u || u.deleted) return null
    return zoneFor({ departments: u.departments, site: u.poleSite })
  }, [g?.poleUnitId])
}

/** Lampe d'une fiche pour le staff (même calcul que celle du jeune). */
export function staffLampView(p: Player | undefined, row: StaffLampRow, settings: LampSettings, today: string, groupZone: Zone | null | undefined): LampView {
  const ctx = lampContext(p, today, { zone: groupZone, setting: settings.zone, fallback: TRIAL || !supabase ? DEMO_LAMP_ZONE : undefined })
  return lampView({ today, start: ctx.start, days: row.days, coach: row.coach, zone: ctx.zone, settings })
}

export function LampStaffCard({ player: p, group }: { player: Player; group: PlayerGroup }) {
  const role = useRole()
  const zone = useGroupZone(group)
  const [res, setRes] = useState<Awaited<ReturnType<typeof fetchPlayerLamp>> | null>(null)
  const [seq, setSeq] = useState(0)
  useEffect(() => {
    let live = true
    void fetchPlayerLamp(p.id, group.id, seq > 0).then((r) => live && setRes(r))
    return () => {
      live = false
    }
  }, [p.id, group.id, seq])
  if (!res || zone === undefined) return null
  if (!res.ok) return res.missing ? null : <p className="text-[11px] text-muted">{res.error}</p>
  const { g, row, account } = res.value
  if (!g.enabled || !account || !row) return null
  const v = staffLampView(p, row, g.settings, g.today, zone)
  const canCoach = role === 'admin' || role === 'preparateur'
  const wishes = row.wishes.map((id) => g.settings.catalogue.find((w) => w.id === id)).filter((w) => !!w)
  return (
    <section className="card flex flex-col gap-3 p-3" data-testid="fiche-lampe">
      <div className="flex items-center gap-3">
        <LampSvg pct={v.pct} size={96} />
        <div className="min-w-0">
          <h2 className="text-sm font-bold">Lampe d’Aladin</h2>
          <div className="text-2xl font-extrabold tabular-nums">{pctText(v.pct)}</div>
          <div className="text-[11px] text-muted">
            {v.onTrack ? 'sur la route des 100 %' : `jusqu’à ${pctText(v.trackPct)} en allumant tout le reste`}
            {v.streak >= 2 ? ` · ${v.streak} journées d’affilée` : ''}
          </div>
        </div>
      </div>
      <LampDetails v={v} />
      {canCoach && <CoachEditor playerId={p.id} settings={g.settings} saved={row.coach} admin={role === 'admin'} onSaved={() => setSeq((n) => n + 1)} />}
      <div>
        <div className="text-[11px] font-bold">Ses vœux</div>
        {wishes.length ? (
          <ol className="list-decimal pl-5 text-xs">
            {wishes.map((w) => (
              <li key={w!.id}>{w!.label}</li>
            ))}
          </ol>
        ) : (
          <p className="text-[11px] text-muted">Pas encore de vœu choisi.</p>
        )}
      </div>
      <Link to={`/groupes/${group.id}/lampes`} className="py-1 text-xs font-bold text-accent">
        Lampes du groupe ›
      </Link>
    </section>
  )
}

/** Trimestres, bonus, encadrants, aujourd'hui : en une ligne chacun. */
export function LampDetails({ v }: { v: LampView }) {
  const done = (k: keyof typeof TASK) => !!(v.today.bits & TASK[k])
  return (
    <div className="flex flex-col gap-1.5 text-[11px]">
      <div className="grid grid-cols-3 gap-1.5">
        {v.trimesters.map((t) => (
          <div key={t.key} className="min-w-0 rounded-md border border-line px-1.5 py-1">
            <div className="truncate text-[9px] text-muted">{t.label}</div>
            <div className="font-bold tabular-nums">{t.neutral ? '—' : pctText(t.share)}</div>
            {!t.neutral && (
              <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full rounded-full bg-amber-500" style={{ width: `${t.weight ? (100 * t.share) / t.weight : 0}%` }} />
              </div>
            )}
            <div className="text-[9px] text-muted">{t.neutral ? 'arrivé après' : `${t.done}/${t.requested} j`}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
        {v.bonus.weeks.length > 0 && <span>Bonus du week-end : + {pctText(v.bonus.pct)}</span>}
        {v.coach > 0 && <span>Encadrants : + {pctText(v.coach)}</span>}
        {v.today.requested && (
          <span>
            Aujourd’hui : {done('wellness') ? '✓' : '·'} wellness, {done('seance') ? '✓' : '·'} séance, {done('cahier') ? '✓' : '·'} cahier
          </span>
        )}
        {!v.today.requested && <span>Aujourd’hui : rien n’est demandé</span>}
      </div>
    </div>
  )
}

/** Points des encadrants : 0, +1, +2 par critère ; ce qui est donné ne se retire pas (sauf administrateur). */
function CoachEditor({ playerId, settings, saved, admin, onSaved }: { playerId: string; settings: LampSettings; saved: Record<string, number>; admin: boolean; onSaved: () => void }) {
  const [pts, setPts] = useState<Record<string, number>>(saved)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => setPts(saved), [saved])
  const max = settings.rules.coachPointsMax
  const unit = settings.rules.coachShare / (max * settings.criteria.length)
  const dirty = settings.criteria.some((c) => (pts[c.key] ?? 0) !== (saved[c.key] ?? 0))
  const total = settings.criteria.reduce((a, c) => a + (pts[c.key] ?? 0), 0) * unit
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line p-2" data-testid="points-encadrants">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold">Part des encadrants (saison)</span>
        <span className="text-[11px] tabular-nums">+ {pctText(total)} / {pctText(settings.rules.coachShare)}</span>
      </div>
      {settings.criteria.map((c) => (
        <div key={c.key} className="flex min-w-0 items-center justify-between gap-2">
          <span className="min-w-0 truncate text-xs">{c.label}</span>
          <div role="radiogroup" aria-label={c.label} className="flex shrink-0 gap-1">
            {Array.from({ length: max + 1 }, (_, n) => n).map((n) => {
              const on = (pts[c.key] ?? 0) === n
              const locked = !admin && n < (saved[c.key] ?? 0)
              return (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={locked || busy}
                  title={locked ? 'Un point donné ne se retire pas' : undefined}
                  className={`min-h-9 min-w-11 rounded-full border px-2 text-[11px] font-bold disabled:opacity-30 ${on ? 'border-amber-500 bg-amber-500/20 text-fg' : 'border-line text-muted'}`}
                  onClick={() => setPts({ ...pts, [c.key]: n })}
                >
                  {n === 0 ? '·' : `+${n}`}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-muted">Les points s’ajoutent seulement : un point donné ne se retire pas{admin ? ' (administrateur : correction possible)' : ''}. Le jeune voit seulement « + x % de tes encadrants ».</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-primary min-h-11 px-4 text-xs"
          disabled={!dirty || busy}
          onClick={async () => {
            setBusy(true)
            setMsg(null)
            const r = await saveCoach(playerId, pts, settings, admin)
            setBusy(false)
            if (!r.ok) return setMsg({ ok: false, text: r.error })
            setMsg({ ok: true, text: 'Enregistré.' })
            onSaved()
          }}
        >
          {busy ? 'Enregistrement…' : 'Enregistrer les points'}
        </button>
        {msg && <span className={`text-[11px] ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>{msg.text}</span>}
      </div>
    </div>
  )
}
