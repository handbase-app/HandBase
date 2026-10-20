import { useMemo } from 'react'
import { today, type PlayerGroup } from '../db'
import { SEX_LABELS } from '../gender'
import { departmentLabel, regionOfDept, useRegionName } from '../lists'
import { useFollows } from '../follows'
import { currentUserId, isParticipant } from '../roles'
import { useVoicePlaces } from '../voicePlaces'
import { countBy, filterItems, type ListQuery } from '../listQuery'
import { buildGroupsSchema, groupsSpec, readGroupsRecipe, SCOPE_LIST, SEX_LIST, VIS_LIST, type GroupCtx, type GroupFilters, type QGroup } from '../groupQuery'
import { SegRow, SortCalcPicker, ToggleChip, useListQuery } from './ListQuery'
import { MultiPicker } from './MultiPicker'
import { ChoicePills } from './FilterWindow'

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

/**
 * Fenêtre « Filtres » : visibilité, niveau, territoire, garçons / filles, année d'âge, mes groupes, suivis, puis tri et
 * calcul. Visibilités, ligues, comités et années d'âge : plusieurs choix possibles (l'un OU l'autre).
 */
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
  const picked = f.regions ?? []
  return (
    <>
      <ChoicePills label="Visibilité" allLabel="Toutes" value={f.vis ?? []} options={VIS_LIST} counts={vis} total={except('vis').length} onChange={(vs) => setF({ vis: vs.length ? vs : undefined })} />
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
            <MultiPicker
              className="min-h-11 py-1.5 text-xs"
              label="Ligue"
              allLabel={`Toutes les ligues (${except('regions').length})`}
              noun={['ligue', 'ligues']}
              value={picked}
              options={[...regions.entries()]
                .filter(([r]) => ctx.regionName(r))
                .map(([r, n]) => ({ value: r as string, label: ctx.regionName(r)!, count: n }))
                .sort((a, b) => a.label.localeCompare(b.label, 'fr'))}
              // Des ligues cochées écartent les comités d'ailleurs.
              onChange={(rs) => {
                const keep = rs.length && f.depts ? f.depts.filter((d) => rs.includes(ctx.regionOf(d) ?? '')) : f.depts
                setF({ regions: rs.length ? rs : undefined, depts: keep?.length ? keep : undefined })
              }}
            />
            {f.scope !== 'ligue' && (
              <MultiPicker
                className="min-h-11 py-1.5 text-xs"
                label="Comité"
                allLabel={`${picked.length ? 'Tous leurs comités' : 'Tous les comités'} (${except('depts').length})`}
                noun={['comité', 'comités']}
                value={f.depts ?? []}
                options={[...depts.entries()]
                  .filter(([d]) => !!d && (!picked.length || picked.includes(ctx.regionOf(d!) ?? '')))
                  .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''))
                  .map(([d, n]) => ({ value: d as string, label: ctx.deptName(d!), count: n }))}
                onChange={(ds) => setF({ depts: ds.length ? ds : undefined })}
              />
            )}
          </div>
        </div>
      )}
      <SegRow label={`${SEX_LABELS.M} / ${SEX_LABELS.F.toLowerCase()}`} value={f.sex ?? ''} options={SEX_LIST} counts={sexes} total={except('sex').length} onChange={(v) => setF({ sex: v || undefined })} />
      {(years.size > 0 || f.years) && (
        <ChoicePills
          label="Année d’âge"
          allLabel="Toutes"
          value={f.years ?? []}
          options={[...new Set([...years.keys(), ...(f.years ?? [])])].sort((a, b) => b.localeCompare(a)).map((y) => ({ value: y, label: y }))}
          counts={years}
          total={except('years').length}
          onChange={(ys) => setF({ years: ys.length ? ys : undefined })}
        />
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
