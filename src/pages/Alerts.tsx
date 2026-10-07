import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { computeAlerts, loadAlertContext, markSeen, matches, missingFor, predictedHeight, resetSeen, rulesSummary, seenFor, useSeenVersion, type AlertContext } from '../alerts'
import { ask } from '../components/Confirm'
import { Empty, Icon, PosBadges, QuarterBadge, Segmented } from '../components/ui'
import { alive, db, newId, POSITIONS, remove, save, scaleMax, type AlertRules, type Laterality, type Player, type PlayerAlert, type Position } from '../db'
import { departmentLabel, useDepartments } from '../lists'
import { department } from '../components/PlayerFilter'
import { can, useRole } from '../roles'

/*
 * Alertes (supabase/022_alertes.sql) : liste, détail (joueurs qui correspondent, nouveaux en tête) et
 * formulaire. Privées ou partagées, avec les mêmes droits que les groupes.
 */

const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-[11px] font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted'}`
const toggle = <T,>(list: T[] | undefined, v: T) => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v])

/** Liste des alertes. */
export default function Alerts() {
  const role = useRole()
  const v = useSeenVersion()
  const data = useLiveQuery(computeAlerts, [v])
  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const mine = data.alerts.filter((a) => a.alert.private)
  const shared = data.alerts.filter((a) => !a.alert.private)
  const card = ({ alert, players, fresh }: (typeof data.alerts)[number]) => (
    <Link key={alert.id} to={`/alertes/${alert.id}`} className="card flex items-center gap-3 p-3 hover:border-accent">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${fresh.length ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}>
        <Icon name="bell" className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold">{alert.name}</div>
        <div className="line-clamp-2 text-[11px] text-muted">{rulesSummary(alert.rules, data.ctx.criteria)}</div>
      </div>
      <div className="shrink-0 text-right text-[11px] text-muted">
        <div>
          <b className="text-fg">{players.length}</b> joueur{players.length > 1 ? 's' : ''}
        </div>
        {fresh.length > 0 && <div className="font-bold text-accent">{fresh.length} nouveau{fresh.length > 1 ? 'x' : ''}</div>}
      </div>
    </Link>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold">Profils recherchés</h1>
        <Link to="/alertes/nouvelle" className="btn-primary px-3 py-1.5 text-xs">
          + Profil
        </Link>
      </div>
      <p className="text-[11px] text-muted">
        Un profil recherché (ex. grand gaucher 2011) : l’appli te signale chaque joueur qui vient d’y entrer — nouvelle fiche, nouvelle mesure
        ou nouvel avis.
      </p>
      {!data.alerts.length && <Empty>Aucun profil recherché pour l’instant. Crée le premier avec « + Profil ».</Empty>}
      {mine.length > 0 && (
        <>
          <div className="section-title mt-1 mb-0 flex items-center gap-1.5">
            <Icon name="lock" className="h-3.5 w-3.5" /> Mes profils recherchés (privés)
          </div>
          {mine.map(card)}
        </>
      )}
      {shared.length > 0 && (
        <>
          <div className="section-title mt-1 mb-0 flex items-center gap-1.5">
            <Icon name="users" className="h-3.5 w-3.5" /> Profils recherchés du staff
          </div>
          {shared.map(card)}
        </>
      )}
      {!can.publicGroups(role) && <p className="text-[11px] text-muted">Tes profils recherchés sont privés : seuls les encadrants les partagent au staff.</p>}
    </div>
  )
}

/** Détail d'une alerte : ses joueurs, les nouveaux en tête ; ouvrir l'alerte les marque comme vus. */
export function AlertDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const role = useRole()
  const [params, setParams] = useSearchParams()
  const editing = params.has('modifier')
  const data = useLiveQuery(async () => {
    const alert = await db.alerts.get(id!)
    return { alert, ctx: await loadAlertContext() }
  }, [id])
  const players = useMemo(() => (data?.alert ? data.ctx.players.filter((p) => matches(p, data.alert!.rules, data.ctx)) : []), [data])
  // Nouveaux à l'ouverture : gardés pour l'affichage, puis marqués comme vus.
  const [fresh, setFresh] = useState<Set<string> | null>(null)
  useEffect(() => {
    if (!data?.alert || fresh) return
    // Première ouverture sur cet appareil : la liste du moment sert de départ (rien de « nouveau »).
    const known = seenFor(data.alert.id, players.map((p) => p.id))
    setFresh(new Set(players.filter((p) => !known.has(p.id)).map((p) => p.id)))
    markSeen(data.alert.id, players.map((p) => p.id))
  }, [data, players, fresh])

  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const { alert, ctx } = data
  if (!alert || alert.deleted || !can.seeGroup(alert)) return <div className="py-20 text-center text-sm text-muted">Profil recherché introuvable.</div>
  if (editing) return <AlertForm alert={alert} onDone={() => setParams({}, { replace: true })} />
  const manage = can.editGroup(role, alert)
  const sorted = [...players].sort((a, b) => Number(fresh?.has(b.id) ?? 0) - Number(fresh?.has(a.id) ?? 0) || a.lastName.localeCompare(b.lastName))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <BackButton fallback="/alertes" label="PROFILS RECHERCHÉS" />
        {manage && (
          <div className="flex gap-4">
            <button className="text-xs text-muted hover:text-fg" onClick={() => setParams({ modifier: '' }, { replace: true })}>
              Modifier
            </button>
            <button
              className="text-xs text-muted hover:text-red-400"
              onClick={async () => {
                if (!(await ask(`Supprimer le profil recherché « ${alert.name} » ? Les joueurs ne sont pas touchés.`, { ok: 'Supprimer' }))) return
                await remove('alerts', alert.id)
                nav('/alertes', { replace: true })
              }}
            >
              Supprimer
            </button>
          </div>
        )}
      </div>
      <div>
        <h1 className="flex items-center gap-2 text-lg font-extrabold">
          {alert.private && <Icon name="lock" className="h-4 w-4 text-muted" />}
          {alert.name}
        </h1>
        <p className="text-xs text-muted">{rulesSummary(alert.rules, ctx.criteria)}</p>
        {alert.createdByName && <p className="text-[10px] text-muted">Créée par {alert.createdByName}</p>}
      </div>
      <div className="section-title mt-1 mb-0">
        {players.length} joueur{players.length > 1 ? 's' : ''}
        {fresh && fresh.size > 0 && <span className="ml-2 text-fg normal-case">· {fresh.size} nouveau{fresh.size > 1 ? 'x' : ''}</span>}
      </div>
      {!players.length && <Empty>Aucun joueur ne correspond pour l’instant : tu seras prévenu dès qu’un joueur y entrera.</Empty>}
      {sorted.map((p) => (
        <PlayerRow key={p.id} p={p} ctx={ctx} fresh={!!fresh?.has(p.id)} rules={alert.rules} missing={missingFor(p, alert.rules, ctx, ctx.criteria)} />
      ))}
    </div>
  )
}

function PlayerRow({ p, ctx, fresh, rules, missing }: { p: Player; ctx: AlertContext; fresh: boolean; rules: AlertRules; missing: string[] }) {
  const h = ctx.latest.get(p.id)?.get('taille')?.value
  const ph = rules.minPredicted ? predictedHeight(p, ctx) : undefined
  return (
    <Link to={`/joueurs/${p.id}`} className={`card flex items-center gap-3 p-3 hover:border-accent ${fresh ? 'border-accent/70' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-bold">
          <span className="truncate">
            {p.lastName.toUpperCase()} {p.firstName}
          </span>
          {fresh && <span className="rounded bg-accent px-1.5 py-px text-[9px] text-white">NOUVEAU</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <PosBadges p={p} />
          {p.birthDate?.slice(0, 4)}
          <QuarterBadge birthDate={p.birthDate} />
          {p.laterality && <span>· {p.laterality}</span>}
          {typeof h === 'number' && <span>· {h.toLocaleString('fr-FR')} cm</span>}
          {ph !== undefined && <span>· prédit {Math.round(ph)} cm</span>}
          {p.club && <span className="truncate">· {p.club}</span>}
        </div>
        {/* Gardé faute de valeur : à vérifier. */}
        {missing.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {missing.map((m) => (
              <span key={m} className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-200">
                {m} ?
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}

/** Nouvelle alerte (page « /alertes/nouvelle »). */
export function NewAlert() {
  const nav = useNavigate()
  return <AlertForm onDone={(a) => nav(a ? `/alertes/${a.id}` : '/alertes', { replace: true })} />
}

/** Formulaire d'alerte, avec le nombre de joueurs qui correspondent en direct. */
function AlertForm({ alert, onDone }: { alert?: PlayerAlert; onDone: (a?: PlayerAlert) => void }) {
  const role = useRole()
  useDepartments()
  const [name, setName] = useState(alert?.name ?? '')
  const [isPrivate, setPrivate] = useState(alert ? !!alert.private : !can.publicGroups(role))
  const [r, setR] = useState<AlertRules>(alert?.rules ?? {})
  const set = (patch: Partial<AlertRules>) => setR((x) => ({ ...x, ...patch }))
  const ctx = useLiveQuery(loadAlertContext)
  const criteria = useLiveQuery(() => db.criteria.orderBy('order').toArray().then(alive), [], [])
  const tests = criteria.filter((c) => c.kind === 'factual' && c.scale === 'number' && c.id !== 'taille')
  const avisCriteria = criteria.filter((c) => c.kind === 'subjective' && scaleMax(c.scale) !== null)
  const years = useMemo(() => [...new Set((ctx?.players ?? []).map((p) => p.birthDate?.slice(0, 4)).filter((y): y is string => !!y))].sort().reverse().slice(0, 12), [ctx])
  const depts = useMemo(() => [...new Set((ctx?.players ?? []).map((p) => department(p)).filter((d): d is string => !!d))].sort(), [ctx])
  const count = useMemo(() => (ctx ? ctx.players.filter((p) => matches(p, r, ctx)).length : 0), [ctx, r])
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    const clean: AlertRules = Object.fromEntries(
      Object.entries(r).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0) && v !== false),
    )
    const row = { ...(alert ?? { id: newId() }), name: name.trim(), private: isPrivate || undefined, rules: clean } as PlayerAlert
    await save<PlayerAlert>('alerts', row)
    // Conditions nouvelles ou changées : les joueurs du moment forment la nouvelle liste de départ.
    if (ctx) resetSeen(row.id, ctx.players.filter((p) => matches(p, clean, ctx)).map((p) => p.id))
    onDone(row)
  }

  // « Garder les joueurs sans valeur » : sous le seuil, exclu ; valeur inconnue, gardé si coché.
  const keep = (checked: boolean, onChange: (v: boolean) => void, what = 'sans valeur') => (
    <label className="-mt-1 flex items-center gap-1.5 text-[11px] text-muted">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Garder aussi les joueurs {what} (à vérifier)
    </label>
  )

  const numInput = (value: number | undefined, onChange: (v?: number) => void, placeholder: string) => (
    <input
      type="number"
      inputMode="decimal"
      className="field w-24 py-1.5 text-xs"
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  )

  return (
    <div className="flex flex-col gap-3 pb-16">
      <button onClick={() => onDone(alert)} className="self-start text-xs font-bold text-muted">
        ← {alert ? alert.name : 'ALERTES'}
      </button>
      <h1 className="text-lg font-extrabold">{alert ? 'Modifier le profil recherché' : 'Nouveau profil recherché'}</h1>

      <div className="card flex flex-col gap-3 p-4">
        <div>
          <span className="label">Nom</span>
          <input className="field" placeholder="Ex. Grand gaucher 2011" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {can.publicGroups(role) && (
          <div>
            <span className="label">Visible par</span>
            <Segmented
              value={isPrivate ? 'prive' : 'public'}
              onChange={(v) => setPrivate(v === 'prive')}
              options={[
                { value: 'prive', label: 'Moi seul' },
                { value: 'public', label: 'Tout le staff' },
              ]}
            />
          </div>
        )}
      </div>

      <div className="card flex flex-col gap-3 p-4">
        <div className="section-title mb-0">Profil</div>
        <Segmented
          value={r.sex ?? ''}
          onChange={(v) => set({ sex: (v || undefined) as AlertRules['sex'] })}
          options={[
            { value: '', label: 'Tous' },
            { value: 'M', label: 'Garçons' },
            { value: 'F', label: 'Filles' },
          ]}
        />
        <div>
          <span className="label">Années de naissance</span>
          <div className="flex flex-wrap gap-1.5">
            {years.map((y) => (
              <button key={y} className={chip(!!r.years?.includes(y))} onClick={() => set({ years: toggle(r.years, y) })}>
                {y}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="label">Trimestres de naissance</span>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4].map((q) => (
              <button key={q} className={chip(!!r.quarters?.includes(q))} onClick={() => set({ quarters: toggle(r.quarters, q) })}>
                Q{q}
              </button>
            ))}
          </div>
        </div>
        <Segmented
          value={r.laterality ?? ''}
          onChange={(v) => set({ laterality: (v || undefined) as Laterality | undefined })}
          options={[
            { value: '', label: 'Toutes' },
            { value: 'droitier', label: 'Droitiers' },
            { value: 'gaucher', label: 'Gauchers' },
            { value: 'ambidextre', label: 'Ambi.' },
          ]}
        />
        <div>
          <span className="label">Postes (au moins un)</span>
          <div className="flex flex-wrap gap-1.5">
            {POSITIONS.map((p) => (
              <button key={p.id} className={chip(!!r.positions?.includes(p.id))} onClick={() => set({ positions: toggle<Position>(r.positions, p.id) })}>
                {p.short}
              </button>
            ))}
          </div>
          <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
            <input type="checkbox" checked={!!r.withSecondary} onChange={(e) => set({ withSecondary: e.target.checked })} />
            Inclure les postes secondaires
          </label>
        </div>
        {depts.length > 1 && (
          <div>
            <span className="label">Départements</span>
            <div className="flex flex-wrap gap-1.5">
              {depts.map((d) => (
                <button key={d} className={chip(!!r.departments?.includes(d))} onClick={() => set({ departments: toggle(r.departments, d) })}>
                  {departmentLabel(d)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card flex flex-col gap-3 p-4">
        <div className="section-title mb-0">Gabarit</div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span>Taille actuelle au moins (cm)</span>
          {numInput(r.minHeight, (v) => set({ minHeight: v }), '185')}
        </div>
        {!!r.minHeight && keep(!!r.keepMissingHeight, (v) => set({ keepMissingHeight: v }), 'sans taille connue')}
        <div className="flex items-center justify-between gap-3 text-xs">
          <span>
            Taille adulte prédite au moins (cm)
            <span className="block text-[10px] text-muted">Calculable seulement si on connaît la taille des parents.</span>
          </span>
          {numInput(r.minPredicted, (v) => set({ minPredicted: v }), '190')}
        </div>
        {!!r.minPredicted && keep(!r.dropMissingPredicted, (v) => set({ dropMissingPredicted: !v }), 'dont elle n’est pas calculable')}
      </div>

      <div className="card flex flex-col gap-2 p-4">
        <div className="section-title mb-0">Tests physiques</div>
        {(r.tests ?? []).map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              className="field min-w-0 flex-1 py-1.5 text-xs"
              value={t.criterionId}
              onChange={(e) => set({ tests: r.tests!.map((x, j) => (j === i ? { ...x, criterionId: e.target.value } : x)) })}
            >
              {tests.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.unit ? ` (${c.unit})` : ''}
                </option>
              ))}
            </select>
            <select
              className="field w-14 py-1.5 text-xs"
              value={t.op}
              onChange={(e) => set({ tests: r.tests!.map((x, j) => (j === i ? { ...x, op: e.target.value as 'min' | 'max' } : x)) })}
            >
              <option value="min">≥</option>
              <option value="max">≤</option>
            </select>
            {numInput(t.value, (v) => set({ tests: r.tests!.map((x, j) => (j === i ? { ...x, value: v ?? 0 } : x)) }), '0')}
            <button className="text-muted hover:text-red-400" onClick={() => set({ tests: r.tests!.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        )).flatMap((row, i) => [row, <div key={`k${i}`}>{keep(!!r.tests![i].keepMissing, (v) => set({ tests: r.tests!.map((x, j) => (j === i ? { ...x, keepMissing: v } : x)) }), 'non testés')}</div>])}
        {tests.length > 0 && (
          <button className="self-start text-xs font-bold text-accent" onClick={() => set({ tests: [...(r.tests ?? []), { criterionId: tests[0].id, op: 'min', value: 0 }] })}>
            + Ajouter un test
          </button>
        )}
        <p className="text-[10px] text-muted">Dernière valeur du joueur. « ≤ » pour les temps (ex. 30 m ≤ 4,3 s).</p>
      </div>

      <div className="card flex flex-col gap-2 p-4">
        <div className="section-title mb-0">Avis des observateurs</div>
        {(r.avis ?? []).map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              className="field min-w-0 flex-1 py-1.5 text-xs"
              value={a.criterionId}
              onChange={(e) => set({ avis: r.avis!.map((x, j) => (j === i ? { ...x, criterionId: e.target.value } : x)) })}
            >
              {avisCriteria.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted">moy. ≥</span>
            {numInput(a.min, (v) => set({ avis: r.avis!.map((x, j) => (j === i ? { ...x, min: v ?? 0 } : x)) }), '4')}
            <button className="text-muted hover:text-red-400" onClick={() => set({ avis: r.avis!.filter((_, j) => j !== i) })}>
              ✕
            </button>
          </div>
        )).flatMap((row, i) => [row, <div key={`k${i}`}>{keep(!!r.avis![i].keepMissing, (v) => set({ avis: r.avis!.map((x, j) => (j === i ? { ...x, keepMissing: v } : x)) }), 'sans avis')}</div>])}
        {avisCriteria.length > 0 && (
          <button className="self-start text-xs font-bold text-accent" onClick={() => set({ avis: [...(r.avis ?? []), { criterionId: avisCriteria[0].id, min: 4 }] })}>
            + Ajouter un critère d’avis
          </button>
        )}
        <p className="text-[10px] text-muted">Moyenne des avis validés du joueur sur ce critère.</p>
      </div>

      <div className="sticky bottom-[calc(52px+env(safe-area-inset-bottom))] z-10 -mx-4 flex items-center gap-2 border-t border-line bg-bg px-4 py-2">
        <span className="shrink-0 text-[11px] text-muted">
          <b className="text-fg">{count}</b> joueur{count > 1 ? 's' : ''} aujourd’hui
        </span>
        <button className="btn-primary flex-1" disabled={!name.trim() || busy} onClick={() => void submit()}>
          {alert ? 'Enregistrer' : 'Créer le profil'}
        </button>
      </div>
    </div>
  )
}

