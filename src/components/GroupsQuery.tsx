import { useMemo } from 'react'
import { today, type PlayerGroup } from '../db'
import { departmentLabel, regionOfDept, useRegionName } from '../lists'
import { useFollows } from '../follows'
import { currentUserId, isParticipant } from '../roles'
import { useVoicePlaces } from '../voicePlaces'
import { countBy, filterItems, type ListQuery } from '../listQuery'
import { buildGroupsSchema, groupsSpec, readGroupsRecipe, SCOPE_LIST, SEX_LIST, VIS_LIST, type GroupCtx, type GroupFilters, type QGroup } from '../groupQuery'
import { SegRow, SortCalcPicker, ToggleChip, useListQuery } from './ListQuery'

/*
 * Liste Groupes : filtres = recette « groupes » (src/groupQuery.ts), même expérience que les listes Joueurs et Événements
 * (src/components/ListQuery.tsx) : visibilité, niveau, garçons / filles, ligue, comité, année d'âge, mes groupes, suivis,
 * nombre de joueurs ; tris et calculs sur la sélection.
 */

const WHO = [
  { value: 'mine' as const, label: 'Les miens' },
  { value: 'created' as const, label: 'Créés par moi', short: 'Créés' },
  { value: 'participant' as const, label: 'Où je participe', short: 'Participe' },
]
const HINT = 'les groupes de filles du Var », « ceux de 2011 », « combien par comité ?'

export function useGroupsQuery(groups: PlayerGroup[] | undefined) {
  const regionName = useRegionName()
  const follows = useFollows()
  const followed = useMemo(() => new Set((follows?.groups ?? []).map((g) => g.group.id)), [follows])
  const me = currentUserId() ?? undefined
  const ctx = useMemo<GroupCtx | null>(
    () =>
      groups
        ? {
            me,
            isParticipant: (g) => isParticipant(g),
            followed,
            deptName: (c) => departmentLabel(c),
            regionName: (id) => regionName(id),
            regionOf: (c) => regionOfDept(c),
          }
        : null,
    [groups, me, followed, regionName],
  )
  const geo = useVoicePlaces(useMemo(() => [...new Set((groups ?? []).map((g) => g.department ?? '').filter(Boolean))], [groups]))
  const sums = useMemo(() => [{ unit: (n: number) => (n > 1 ? 'joueurs' : 'joueur'), get: (g: PlayerGroup) => g.playerIds.length }], [])
  const hays = useMemo(() => (groups ?? []).map(groupsSpec.hay), [groups])
  const day = today()
  return useListQuery<GroupFilters, PlayerGroup, GroupCtx>({
    spec: groupsSpec,
    items: groups,
    ctx,
    read: (raw, nonGere) =>
      readGroupsRecipe(raw, nonGere, {
        today: day,
        names: (groups ?? []).map((g) => g.name),
        creators: [...new Set((groups ?? []).map((g) => g.createdByName ?? '').filter(Boolean))],
        geo,
      }),
    schema: () => buildGroupsSchema(day),
    hint: HINT,
    noun: ['groupe', 'groupes'],
    sums,
    regionOf: (d) => regionOfDept(d),
    hays,
    panel: (qy, setQy) => (ctx && groups ? <GroupsPanel groups={groups} ctx={ctx} qy={qy} setQy={setQy} /> : null),
  })
}

/** Panneau « Filtres » : visibilité, niveau, territoire, garçons / filles, année d'âge, mes groupes, suivis, puis tri et calcul. */
function GroupsPanel({ groups, ctx, qy, setQy }: { groups: PlayerGroup[]; ctx: GroupCtx; qy: ListQuery<GroupFilters>; setQy: (q: ListQuery<GroupFilters>) => void }) {
  const f = qy.f
  const setF = (patch: Partial<GroupFilters>) => {
    const next = { ...f, ...patch } as Record<string, unknown>
    for (const k of Object.keys(patch)) if (next[k] === undefined) delete next[k]
    setQy({ ...qy, f: next as GroupFilters })
  }
  const except = (k: string) => filterItems(groupsSpec, groups, qy, ctx, k) as QGroup[]
  const visOf = (g: QGroup) => (g.private ? 'private' : g.team ? 'team' : 'staff')
  const vis = countBy(except('vis'), (g) => [visOf(g)])
  const scopes = countBy(except('scope'), (g) => [g.scope])
  const sexes = countBy(except('sex'), (g) => [g.sex])
  const regionKey = (g: QGroup) => g.regionId ?? (g.department ? ctx.regionOf(g.department) : undefined)
  const regions = countBy(except('regions'), (g) => [regionKey(g)])
  const depts = countBy(except('depts'), (g) => [g.department])
  const years = countBy(except('years'), (g) => g.years ?? [])
  const who = new Map(WHO.map((w) => [w.value, except('who').filter((g) => groupsSpec.test('who', { who: w.value }, g, ctx)).length]))
  const nFollowed = except('followed').filter((g) => ctx.followed.has(g.id)).length
  const region = f.regions?.length === 1 ? f.regions[0] : ''
  return (
    <>
      <SegRow label="Visibilité" value={f.vis?.length === 1 ? f.vis[0] : ''} options={VIS_LIST} counts={vis} total={except('vis').length} onChange={(v) => setF({ vis: v ? [v] : undefined })} />
      <SegRow
        label="Niveau"
        value={f.scope ?? ''}
        options={SCOPE_LIST}
        counts={scopes}
        total={except('scope').length}
        onChange={(v) => setF({ scope: v || undefined, ...(v === 'federation' ? { regions: undefined, depts: undefined } : v === 'ligue' ? { depts: undefined } : {}) })}
      />
      {f.scope !== 'federation' && (regions.size > 0 || depts.size > 0 || f.regions || f.depts) && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold tracking-wider text-muted uppercase">Territoire</span>
          <div className={`grid gap-2 ${f.scope === 'ligue' ? '' : 'grid-cols-2'}`}>
            <select
              className={`field min-h-11 py-1.5 text-xs ${f.regions ? 'border-accent font-bold' : ''}`}
              aria-label="Ligue"
              value={region}
              onChange={(e) => {
                const r = e.target.value
                setF({ regions: r ? [r] : undefined, ...(f.depts && r && !f.depts.every((d) => ctx.regionOf(d) === r) ? { depts: undefined } : {}) })
              }}
            >
              <option value="">Toutes les ligues ({except('regions').length})</option>
              {[...regions.entries()]
                .filter(([r]) => ctx.regionName(r))
                .sort((a, b) => (ctx.regionName(a[0]) ?? '').localeCompare(ctx.regionName(b[0]) ?? '', 'fr'))
                .map(([r, n]) => (
                  <option key={r} value={r}>
                    {ctx.regionName(r)} ({n})
                  </option>
                ))}
            </select>
            {f.scope !== 'ligue' && (
              <select
                className={`field min-h-11 py-1.5 text-xs ${f.depts ? 'border-accent font-bold' : ''}`}
                aria-label="Comité"
                value={f.depts?.length === 1 ? f.depts[0] : ''}
                onChange={(e) => setF({ depts: e.target.value ? [e.target.value] : undefined })}
              >
                <option value="">
                  {region ? 'Tous ses comités' : 'Tous les comités'} ({except('depts').length})
                </option>
                {[...depts.entries()]
                  .filter(([d]) => !region || ctx.regionOf(d) === region)
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([d, n]) => (
                    <option key={d} value={d}>
                      {ctx.deptName(d)} ({n})
                    </option>
                  ))}
              </select>
            )}
          </div>
        </div>
      )}
      <SegRow label="Garçons / filles" value={f.sex ?? ''} options={SEX_LIST} counts={sexes} total={except('sex').length} onChange={(v) => setF({ sex: v || undefined })} />
      {years.size > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold tracking-wider text-muted uppercase">Année d’âge</span>
          <div className="flex flex-wrap gap-1.5">
            {[...years.entries()]
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([y, n]) => (
                <ToggleChip
                  key={y}
                  on={!!f.years?.includes(y)}
                  label={y}
                  n={n}
                  onChange={(on) => setF({ years: on ? [...(f.years ?? []), y] : (f.years ?? []).filter((x) => x !== y).length ? (f.years ?? []).filter((x) => x !== y) : undefined })}
                />
              ))}
          </div>
        </div>
      )}
      <SegRow label="Mes groupes" value={f.who ?? ''} options={WHO} counts={who} total={except('who').length} onChange={(v) => setF({ who: v || undefined })} />
      <div className="flex flex-wrap gap-1.5">
        <ToggleChip on={!!f.followed} label="Suivis" n={nFollowed} onChange={(on) => setF({ followed: on || undefined })} />
        <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => setF({ players: f.players ?? { op: 'gte', n: 10 } })}>
          + Nombre de joueurs
        </button>
      </div>
      <SortCalcPicker spec={groupsSpec} qy={qy} setQy={setQy} />
    </>
  )
}
