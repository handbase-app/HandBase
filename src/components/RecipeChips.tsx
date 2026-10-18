import { useState, type ReactNode } from 'react'
import { today, type Position } from '../db'
import { SEX_LABELS } from '../gender'
import { seasonOf } from '../coverage'
import {
  avgText,
  avisCategories,
  avisCriteria,
  defaultSort,
  DEFAULT_LIMIT,
  hasConditions,
  LIMITS,
  measureCriteria,
  outValueText,
  possibleVars,
  PRIORITY_TEXT,
  recipeChips,
  recipeText,
  removeChip,
  VAR_TEXT,
  type AvisTarget,
  type Chip,
  type Cmp,
  type GroupBy,
  type Names,
  type OutType,
  type Period,
  type QCriterion,
  type Recipe,
  type SortBy,
  type Stat,
  type VarKey,
} from '../recipe'
import { saveQuestion } from '../savedQuestions'
import { Icon, Segmented } from './ui'
import { YearPicker } from './YearPicker'
import { putYears, recentYears, yearsOf } from '../birthYears'

/*
 * La recette en PASTILLES (« Poser une question » au bilan, filtres de la liste Joueurs) : un toucher ouvre ses réglages
 * simples (année, période, opérateur et nombre, cible d'une moyenne, mesure, tri…) et « Retirer ». Textes communs des
 * réponses (valeur du tri, moyenne d'une mesure, ligne d'un tableau) et « Enregistrer cette question ».
 */

/** Ce dont les réglages ont besoin : noms affichés, critères (réglages), événements (lignes « par événement »). */
export type RecipeModel = { names: Names; criteria: QCriterion[]; events?: { id: string; name: string; date?: string }[] }

const fr = (n: number, d = 0) => n.toLocaleString('fr-FR', { maximumFractionDigits: d })


export const chipCls = (on: boolean) =>
  `flex min-h-9 max-w-full items-center gap-1 rounded-full border px-3 py-1 text-left text-xs font-bold transition ${
    on ? 'border-accent bg-accent text-white' : 'border-accent/50 bg-accent/10 text-fg hover:border-accent'
  }`

export function RecipeChips({
  recipe,
  names,
  model,
  onChange,
  keep,
  open: openProp,
  setOpen: setOpenProp,
  after,
}: {
  recipe: Recipe
  names: Names
  model: RecipeModel
  onChange: (r: Recipe) => void
  /** Pastilles montrées (liste Joueurs : filtres et tri seulement). */
  keep?: (c: Chip) => boolean
  /** Pastille ouverte, quand l'écran la choisit (« + Ajouter une condition » ouvre la nouvelle). */
  open?: string | null
  setOpen?: (key: string | null) => void
  /** Après les pastilles (« Tout effacer »…). */
  after?: ReactNode
}) {
  const [openState, setOpenState] = useState<string | null>(null)
  const open = openProp !== undefined ? openProp : openState
  const setOpen = setOpenProp ?? setOpenState
  const chips = recipeChips(recipe, names).filter((c) => !keep || keep(c))
  const chip = chips.find((c) => c.key === open)
  if (!chips.length && !after) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" aria-label="La question en clair, toucher une pastille pour la changer ou la retirer">
        {chips.map((c) => (
          <button key={c.key} type="button" className={chipCls(c.key === open)} aria-expanded={c.key === open} onClick={() => setOpen(c.key === open ? null : c.key)}>
            <span className="min-w-0 truncate">{c.label}</span>
            {(c.edit || c.removable) && <span className="shrink-0 text-[10px] opacity-60">▾</span>}
          </button>
        ))}
        {after}
      </div>
      {chip && <ChipEditor key={chip.key} chip={chip} recipe={recipe} model={model} onChange={onChange} onClose={() => setOpen(null)} />}
    </div>
  )
}

export const OPS: { value: Cmp; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'gte', label: '≥ au moins' },
  { value: 'lte', label: '≤ au plus' },
]
export const OPS2 = OPS.filter((o) => o.value !== 'eq') as { value: 'gte' | 'lte'; label: string }[]

export function NumberInput({ value, onChange, min, max, step = 1, label, className = 'w-20' }: { value?: number; onChange: (n: number) => void; min: number; max: number; step?: number; label: string; className?: string }) {
  const [text, setText] = useState(value === undefined ? '' : String(value).replace('.', ','))
  return (
    <input
      className={`field min-h-11 py-1 text-sm ${className}`}
      inputMode="decimal"
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value.replace(',', '.'))
        if (e.target.value.trim() && Number.isFinite(n) && n >= min && n <= max && (step >= 1 ? Number.isInteger(n) : true)) onChange(n)
      }}
    />
  )
}

export function Select<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <select className="field min-h-11 py-1 text-sm" aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const s = seasonOf(today())
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select<Period['kind']>
        label="Période"
        value={value.kind}
        onChange={(kind) => onChange(kind === 'since' ? { kind, since: value.since ?? s.from } : { kind })}
        options={[
          { value: 'season', label: `Cette saison (${s.label})` },
          { value: '12m', label: '12 derniers mois' },
          { value: 'all', label: 'Depuis toujours' },
          { value: 'since', label: 'Depuis le…' },
        ]}
      />
      {value.kind === 'since' && (
        <input
          type="date"
          className="field min-h-11 py-1 text-sm"
          aria-label="Depuis le"
          max={today()}
          value={value.since ?? ''}
          onChange={(e) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value <= today() && onChange({ kind: 'since', since: e.target.value })}
        />
      )}
    </div>
  )
}

/** Cible d'une moyenne : générale, catégorie, critère. */
export function TargetPicker({ value, model, onChange }: { value: AvisTarget; model: RecipeModel; onChange: (t: AvisTarget) => void }) {
  const cs = model.criteria
  const opts = [
    // Score combiné (venu de la question) : gardé tel quel tant qu'on n'en choisit pas un autre.
    ...(value.on === 'mix' ? [{ value: 'mix', label: avgText(value, model.names).replace(/^score/, 'Score') }] : []),
    { value: 'g', label: 'Moyenne générale' },
    ...avisCategories(cs).map((c) => ({ value: `c:${c}`, label: `Catégorie : ${c}` })),
    ...avisCriteria(cs).map((c) => ({ value: `k:${c.id}`, label: `Critère : ${c.label}` })),
  ]
  const cur = value.on === 'mix' ? 'mix' : value.on === 'category' ? `c:${value.name}` : value.on === 'criterion' ? `k:${value.id}` : 'g'
  return (
    <Select
      label="Moyenne de"
      value={opts.some((o) => o.value === cur) ? cur : 'g'}
      options={opts}
      onChange={(v) =>
        v !== 'mix' && onChange(v.startsWith('c:') ? { on: 'category', name: v.slice(2) } : v.startsWith('k:') ? { on: 'criterion', id: v.slice(2) } : { on: 'global' })
      }
    />
  )
}

export function ChipEditor({ chip, recipe, model, onChange, onClose }: { chip: Chip; recipe: Recipe; model: RecipeModel; onChange: (r: Recipe) => void; onClose: () => void }) {
  const r: Recipe = structuredClone(recipe)
  const apply = (f: (x: Recipe) => void) => {
    f(r)
    onChange(r)
  }
  const [k, i] = chip.key.split('.')
  const idx = Number(i)
  let body: ReactNode = null
  switch (chip.edit) {
    case 'sex':
      body = (
        <Segmented<'M' | 'F'>
          value={r.pop.sex}
          onChange={(v) => apply((x) => (x.pop.sex = v))}
          options={[
            { value: 'M', label: SEX_LABELS.M },
            { value: 'F', label: SEX_LABELS.F },
          ]}
        />
      )
      break
    case 'years': {
      // Une ou plusieurs années cochées (src/components/YearPicker.tsx) ; toutes décochées : la pastille s'en va.
      const picked = (yearsOf(r.pop) ?? []).map(String).reverse()
      body = (
        <div className="flex items-center gap-2 text-xs">
          <span className="shrink-0">nés en</span>
          <YearPicker className="min-h-9 w-48 py-1 text-xs" value={picked} options={recentYears(Number(today().slice(0, 4)))} onChange={(ys) => apply((x) => putYears(x.pop, ys))} />
        </div>
      )
      break
    }
    case 'height':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          taille (cm) de <NumberInput label="Taille minimum" value={r.pop.hMin} min={100} max={230} onChange={(n) => apply((x) => (x.pop.hMin = n))} />
          à <NumberInput label="Taille maximum" value={r.pop.hMax} min={100} max={230} onChange={(n) => apply((x) => (x.pop.hMax = n))} />
        </div>
      )
      break
    case 'seen': {
      const s = r.seen!
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select label="Opérateur" value={s.op} options={OPS} onChange={(op) => apply((x) => (x.seen!.op = op))} />
          <NumberInput label="Nombre" value={s.n} min={0} max={LIMITS.n[1]} onChange={(n) => apply((x) => (x.seen!.n = n))} className="w-16" />
          <Select
            label="Compter"
            value={s.by}
            onChange={(by) => apply((x) => (x.seen!.by = by))}
            options={[
              { value: 'event', label: 'événements distincts' },
              { value: 'person', label: 'personnes du staff distinctes' },
            ]}
          />
        </div>
      )
      break
    }
    case 'period':
      body = <PeriodPicker value={r.seen!.period} onChange={(p) => apply((x) => (x.seen!.period = p))} />
      break
    case 'avis': {
      const a = r.avis[idx]
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select<'avg' | 'max' | 'min'>
            label="Calcul"
            value={a.agg ?? 'avg'}
            onChange={(v) =>
              apply((x) => {
                if (v === 'avg') delete x.avis[idx].agg
                else x.avis[idx].agg = v
              })
            }
            options={[
              { value: 'avg', label: 'Moyenne' },
              { value: 'max', label: 'Meilleure note' },
              { value: 'min', label: 'Plus basse note' },
            ]}
          />
          <TargetPicker value={a.target} model={model} onChange={(t) => apply((x) => (x.avis[idx].target = t))} />
          <Select label="Opérateur" value={a.op} options={OPS2} onChange={(op) => apply((x) => (x.avis[idx].op = op))} />
          <NumberInput label="Note sur 5" value={a.value} min={0} max={5} step={0.1} onChange={(n) => apply((x) => (x.avis[idx].value = n))} className="w-16" />
          <span className="text-muted">sur 5</span>
        </div>
      )
      break
    }
    case 'nbAvis':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select label="Opérateur" value={r.nbAvis!.op} options={OPS} onChange={(op) => apply((x) => (x.nbAvis!.op = op))} />
          <NumberInput label="Nombre d’avis" value={r.nbAvis!.n} min={0} max={LIMITS.n[1]} onChange={(n) => apply((x) => (x.nbAvis!.n = n))} className="w-16" />
          avis
        </div>
      )
      break
    case 'measure': {
      const m = r.measures[idx]
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select label="Mesure" value={m.id} options={measureCriteria(model.criteria).map((c) => ({ value: c.id, label: c.label }))} onChange={(id) => apply((x) => (x.measures[idx].id = id))} />
          <Select label="Opérateur" value={m.op} options={OPS2} onChange={(op) => apply((x) => (x.measures[idx].op = op))} />
          <NumberInput key={m.id} label="Valeur" value={m.value} min={LIMITS.measure[0]} max={LIMITS.measure[1]} step={0.01} onChange={(n) => apply((x) => (x.measures[idx].value = n))} />
          {model.names.unit?.(m.id)}
        </div>
      )
      break
    }
    case 'out':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select<OutType>
            label="Réponse"
            value={r.out.type}
            onChange={(type) => apply((x) => (x.out = { type, ...(type === 'table' ? { groupBy: x.out.groupBy ?? 'club' } : {}) }))}
            options={[
              { value: 'count', label: 'Combien ?' },
              { value: 'list', label: 'Liste de joueurs' },
              { value: 'table', label: 'Tableau' },
              { value: 'map', label: 'Carte de France' },
            ]}
          />
          {r.out.type === 'table' && (
            <Select<GroupBy> label="Regrouper" value={r.out.groupBy ?? 'club'} onChange={(g) => apply((x) => (x.out.groupBy = g))} options={GROUP_OPTIONS} />
          )}
        </div>
      )
      break
    case 'value':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select<'count' | 'seen' | 'avg' | 'measure' | 'age'>
            label="Colonne"
            value={r.out.value ?? 'count'}
            onChange={(v) =>
              apply((x) => {
                x.out.value = v
                if (v === 'measure') x.out.measure ??= x.measures[0]?.id ?? measureCriteria(model.criteria)[0]?.id
              })
            }
            options={[
              { value: 'count', label: 'Nombre seulement' },
              ...(r.out.type === 'table' && r.out.groupBy !== 'event' ? [{ value: 'seen' as const, label: 'Part vue' }] : []),
              { value: 'avg', label: 'Moyenne d’avis' },
              ...(measureCriteria(model.criteria).length ? [{ value: 'measure' as const, label: 'Moyenne d’une mesure' }] : []),
              { value: 'age', label: 'Âge moyen' },
            ]}
          />
          {r.out.value === 'measure' && (
            <Select
              label="Mesure"
              value={r.out.measure ?? ''}
              onChange={(m) => apply((x) => (x.out.measure = m))}
              options={measureCriteria(model.criteria).map((c) => ({ value: c.id, label: c.label }))}
            />
          )}
          {r.out.value === 'seen' && !r.seen && <PeriodPicker value={r.out.period ?? { kind: 'season' }} onChange={(p) => apply((x) => (x.out.period = p))} />}
          {r.out.value === 'avg' && <TargetPicker value={r.out.avg ?? r.avis[0]?.target ?? { on: 'global' }} model={model} onChange={(t) => apply((x) => (x.out.avg = t))} />}
        </div>
      )
      break
    case 'outPeriod':
      body = <PeriodPicker value={r.out.period ?? r.seen?.period ?? { kind: 'season' }} onChange={(p) => apply((x) => (x.out.period = p))} />
      break
    case 'sort': {
      const table = r.out.type === 'table'
      const staff = table && r.out.groupBy === 'staff'
      const s = table ? (r.out.sort ?? { by: staff ? ('seen' as const) : ('share' as const), dir: 'desc' as const }) : defaultSort(r)
      const ms = measureCriteria(model.criteria)
      const options: { value: SortBy; label: string }[] = staff
        ? [
            { value: 'seen', label: 'Joueurs vus' },
            { value: 'nbAvis', label: 'Avis écrits' },
          ]
        : table
          ? [
              { value: 'share', label: r.out.value === 'seen' || !hasConditions(r) ? 'Part vue' : 'Part qui répond' },
              { value: 'count', label: 'Nombre de joueurs' },
              { value: 'avg', label: 'Moyenne d’avis' },
              ...(r.out.value === 'measure' ? [{ value: 'measure' as const, label: outValueText(r, model.names) }] : []),
              ...(r.out.value === 'age' ? [{ value: 'age' as const, label: 'Âge moyen' }] : []),
            ]
          : [
              { value: 'name', label: 'Nom' },
              { value: 'year', label: 'Année de naissance' },
              { value: 'height', label: 'Taille' },
              { value: 'seen', label: 'Nombre de vus' },
              { value: 'avg', label: 'Moyenne d’avis' },
              { value: 'nbAvis', label: 'Nombre d’avis' },
              ...(ms.length ? [{ value: 'measure' as const, label: 'Mesure' }] : []),
              { value: 'progress', label: 'Évolution entre les deux derniers avis' },
              { value: 'priority', label: 'À voir en priorité' },
            ]
      body = (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Select<SortBy> label="Trier par" value={s.by} onChange={(by) => apply((x) => (x.out.sort = { by, dir: by === 'name' ? 'asc' : 'desc' }))} options={options} />
          {s.by !== 'priority' && (
            <Segmented<'asc' | 'desc'>
              value={s.dir}
              onChange={(dir) => apply((x) => (x.out.sort = { by: s.by, dir }))}
              options={[
                { value: 'asc', label: 'Croissant ↑' },
                { value: 'desc', label: 'Décroissant ↓' },
              ]}
            />
          )}
          {s.by === 'priority' && <span className="text-muted">Priorité : {PRIORITY_TEXT}.</span>}
          {(s.by === 'avg' || s.by === 'progress') && <TargetPicker value={r.out.avg ?? r.avis[0]?.target ?? { on: 'global' }} model={model} onChange={(t) => apply((x) => (x.out.avg = t))} />}
          {s.by === 'measure' && (
            <Select
              label="Mesure"
              value={r.out.measure ?? r.measures[0]?.id ?? ms[0]?.id ?? ''}
              onChange={(m) => apply((x) => (x.out.measure = m))}
              options={ms.map((c) => ({ value: c.id, label: c.label }))}
            />
          )}
        </div>
      )
      break
    }
    case 'limit':
      body = (
        <div className="flex items-center gap-2 text-xs">
          Montrer les{' '}
          <NumberInput
            label={r.out.type === 'table' ? 'Nombre de lignes montrées' : 'Nombre de joueurs montrés'}
            value={r.out.limit ?? DEFAULT_LIMIT}
            min={1}
            max={LIMITS.limit[1]}
            onChange={(n) => apply((x) => (x.out.limit = n))}
            className="w-20"
          />{' '}
          premiers{r.out.type === 'table' ? ' (lignes du tableau, après le tri)' : ''}
        </div>
      )
      break
  }
  void k
  return (
    <div className="card flex flex-col gap-2 border-accent/50 p-3">
      {body}
      <div className="flex flex-wrap items-center gap-2">
        {chip.removable && (
          <button type="button" className="btn-ghost min-h-11 px-3 text-xs" onClick={() => (onChange(removeChip(recipe, chip.key)), onClose())}>
            <Icon name="close" className="h-3.5 w-3.5" />
            Retirer « {chip.label} »
          </button>
        )}
        <button type="button" className="ml-auto min-h-11 px-3 text-xs font-bold text-muted underline" onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  )
}

export const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'club', label: 'par club' },
  { value: 'dept', label: 'par département' },
  { value: 'region', label: 'par région' },
  { value: 'year', label: 'par génération' },
  { value: 'position', label: 'par poste' },
  { value: 'sex', label: 'par sexe' },
  { value: 'staff', label: 'par personne du staff' },
  { value: 'event', label: 'par événement' },
]

export function valueText(r: Recipe, names: Names, v: number | null | undefined, tag?: string): string {
  if (tag) return tag
  if (v === null || v === undefined) return ''
  const by = defaultSort(r).by
  const target = r.out.avg ?? r.avis[0]?.target ?? { on: 'global' as const }
  if (by === 'avg') return `${avgText(target, names)} ${fr(v, 2)}`
  if (by === 'progress') return `évolution ${v > 0 ? '+' : ''}${fr(v, 2)} entre les deux derniers avis`
  if (by === 'height') return `${v} cm`
  if (by === 'seen') return `${fr(v)} ${r.seen?.by === 'person' ? (v > 1 ? 'personnes' : 'personne') : v > 1 ? 'événements' : 'événement'}`
  if (by === 'nbAvis') return `${fr(v)} avis`
  if (by === 'measure') {
    const id = r.out.measure ?? r.measures[0]?.id ?? ''
    return `${names.criterion(id)} ${fr(v, 2)}${names.unit?.(id) ? ` ${names.unit(id)}` : ''}`
  }
  return ''
}

/** Moyenne d'une mesure, âge moyen ou moyenne d'avis, en clair : « moyenne Taille 182,5 cm (de 175 à 190 ; 4 mesurés) ». */
export function statText(r: Recipe, names: Names, st: Stat, long = false): string {
  const what = outValueText(r, names)
  if (st.avg === null) return `${what} : pas encore de valeur`
  const v = r.out.value
  const d = v === 'age' ? 1 : 2
  const unit = v === 'measure' && r.out.measure ? names.unit?.(r.out.measure) : v === 'age' ? 'ans' : v === 'avg' ? 'sur 5' : undefined
  const u = unit ? ` ${unit}` : ''
  const range = st.n > 1 && st.min !== undefined && st.max !== undefined ? `de ${fr(st.min, d)} à ${fr(st.max, d)} ; ` : ''
  const n = `${fr(st.n)} ${v === 'measure' ? (st.n > 1 ? 'mesurés' : 'mesuré') : v === 'age' ? 'avec date de naissance' : 'avec avis'}`
  return `${long ? what.replace(/^./, (c) => c.toUpperCase()) : what} ${fr(st.avg, d)}${u} (${range}${n})`
}

export function groupLabel(by: GroupBy, key: string, model: RecipeModel): string {
  if (by === 'club') return key ? model.names.club(key) : 'Club non renseigné'
  if (by === 'dept') return key ? model.names.dept(key) : 'Département non renseigné'
  if (by === 'region') return key ? model.names.region(key) : 'Région inconnue'
  if (by === 'year') return key || 'Année inconnue'
  if (by === 'position') return key ? model.names.position(key as Position) : 'Sans poste'
  if (by === 'staff') return model.names.staff?.(key) ?? 'Personne du staff'
  if (by === 'event') {
    const ev = model.events?.find((e) => e.id === key)
    return ev ? `${ev.name}${ev.date ? ` (${ev.date.slice(8, 10)}/${ev.date.slice(5, 7)}/${ev.date.slice(0, 4)})` : ''}` : 'Événement'
  }
  return key === 'M' || key === 'F' ? SEX_LABELS[key] : 'Sexe non renseigné'
}

export function SaveForm({ recipe, names, phrase, onDone }: { recipe: Recipe; names: Names; phrase?: string; onDone: () => void }) {
  const [name, setName] = useState(() => (phrase ?? recipeText(recipe, names)).slice(0, 80))
  const can = possibleVars(recipe)
  const [vars, setVars] = useState<VarKey[]>([])
  return (
    <form
      className="card flex flex-col gap-2 border-accent/50 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        saveQuestion(name, recipe, vars, phrase)
        onDone()
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-bold">
        Nom de la question
        <input className="field min-h-11 text-sm font-normal" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
      </label>
      {can.length > 0 && (
        <fieldset className="flex flex-col gap-1 text-xs">
          <legend className="mb-1 font-bold">Valeurs à choisir à chaque relance (facultatif)</legend>
          {can.map((v) => (
            <label key={v} className="flex min-h-9 items-center gap-2">
              <input type="checkbox" checked={vars.includes(v)} onChange={(e) => setVars(e.target.checked ? [...vars, v] : vars.filter((x) => x !== v))} />
              {VAR_TEXT[v]}
            </label>
          ))}
        </fieldset>
      )}
      <p className="text-[10px] text-muted">Gardée sur cet appareil. Une question enregistrée se relance sans rien envoyer.</p>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary min-h-11 px-4 text-xs">
          Enregistrer
        </button>
        <button type="button" className="btn-ghost min-h-11 px-4 text-xs" onClick={onDone}>
          Annuler
        </button>
      </div>
    </form>
  )
}

