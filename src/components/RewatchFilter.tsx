import { useState } from 'react'
import { BY_LABEL, STATE_LABEL, WHEN_LABEL, type RewatchBy, type RewatchState, type RewatchWanted } from '../rewatchCore'
import { FilterField, pillClass } from './FilterWindow'
import { MultiPicker } from './MultiPicker'

/*
 * Réglages du filtre « À revoir » (src/rewatchCore.ts, Population.rewatch de src/recipe.ts) dans la fenêtre « Filtres » :
 * par qui (moi, tout mon staff ; tous les staffs pour un administrateur), quand il a été mis à revoir (ce mois-ci, le mois
 * dernier, cette saison, entre deux dates), où il a été repéré (événements d'origine) et son état (pas encore revu, revu).
 * Chaque choix s'applique tout de suite, comme le reste de la fenêtre. Libellés neutres seulement.
 */

const fr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

export function RewatchOptions({
  value,
  onChange,
  events,
  admin,
  fem = false,
  ctl = 'min-h-10 px-2 py-1.5 text-xs',
}: {
  value: RewatchWanted
  onChange: (w: RewatchWanted) => void
  /** Événements où des joueurs ont été repérés (origines des « à revoir »), le plus récent d'abord. */
  events: { id: string; name: string; date?: string }[]
  /** « Tous les staffs » : administrateurs seulement. */
  admin: boolean
  fem?: boolean
  ctl?: string
}) {
  const set = (patch: Partial<RewatchWanted>) => {
    const next: RewatchWanted = { ...value, ...patch }
    for (const k of Object.keys(next) as (keyof RewatchWanted)[]) if (next[k] === undefined) delete next[k]
    onChange(next)
  }
  const by = value.by ?? 'staff'
  // « Entre deux dates » sans date encore choisie : le filtre ne change pas (rien à filtrer), les champs restent ouverts.
  const [between, setBetween] = useState(value.when?.kind === 'between')
  const whenKind = value.when?.kind ?? (between ? 'between' : undefined)
  const pill = (on: boolean) => pillClass(on, true)
  const dateInput = (k: 'from' | 'to', label: string) => (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[10px] text-muted">
      {label}
      <input
        type="date"
        className={`field min-w-0 ${ctl}`}
        value={value.when?.[k] ?? ''}
        onChange={(e) => {
          const v = e.target.value || undefined
          const w = { kind: 'between' as const, from: value.when?.kind === 'between' ? value.when.from : undefined, to: value.when?.kind === 'between' ? value.when.to : undefined, [k]: v }
          set({ when: w })
        }}
      />
    </label>
  )
  const byChoices: RewatchBy[] = admin || by === 'all' ? ['me', 'staff', 'all'] : ['me', 'staff']
  return (
    <div className="flex flex-col gap-3 rounded-md border border-sky-500/40 bg-sky-500/5 p-2.5" data-filter="rewatch">
      <FilterField label="Mis à revoir par">
        <div className="flex flex-wrap gap-1">
          {byChoices.map((b) => (
            <button key={b} type="button" aria-pressed={by === b} className={pill(by === b)} onClick={() => set({ by: b === 'staff' ? undefined : b })}>
              {BY_LABEL[b]}
            </button>
          ))}
        </div>
      </FilterField>
      <FilterField label="Mis à revoir">
        <div className="flex flex-wrap gap-1">
          <button type="button" aria-pressed={!whenKind} className={pill(!whenKind)} onClick={() => (setBetween(false), set({ when: undefined }))}>
            N’importe quand
          </button>
          {(['month', 'lastMonth', 'season'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={whenKind === k} className={pill(whenKind === k)} onClick={() => (setBetween(false), set({ when: { kind: k } }))}>
              {WHEN_LABEL[k]}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={whenKind === 'between'}
            className={pill(whenKind === 'between')}
            onClick={() => {
              const on = whenKind !== 'between'
              setBetween(on)
              if (!on || value.when) set({ when: undefined })
            }}
          >
            Entre deux dates
          </button>
        </div>
        {whenKind === 'between' && (
          <div className="mt-1 flex gap-2">
            {dateInput('from', 'Du')}
            {dateInput('to', 'Au')}
          </div>
        )}
        {whenKind === 'between' && !value.when?.from && !value.when?.to && <span className="text-[10px] text-muted">Choisis au moins une date.</span>}
        {whenKind === 'between' && value.when?.from && value.when?.to && (
          <span className="text-[10px] text-muted">
            Du {fr(value.when.from)} au {fr(value.when.to)}, jours compris.
          </span>
        )}
      </FilterField>
      {events.length > 0 && (
        <FilterField label={`Repéré${fem ? 'es' : 's'} à`}>
          <MultiPicker
            className={ctl}
            label="Repérés à"
            allLabel="N’importe où"
            noun={['événement', 'événements']}
            value={value.from ?? []}
            options={events.map((ev) => ({ value: ev.id, label: `${ev.name}${ev.date ? ` (${fr(ev.date)})` : ''}` }))}
            onChange={(xs) => set({ from: xs.length ? xs : undefined })}
          />
        </FilterField>
      )}
      <FilterField label="État">
        <div className="flex flex-wrap gap-1">
          <button type="button" aria-pressed={!value.state} className={pill(!value.state)} onClick={() => set({ state: undefined })}>
            Tous
          </button>
          {(['open', 'done'] as RewatchState[]).map((st) => (
            <button key={st} type="button" aria-pressed={value.state === st} className={pill(value.state === st)} onClick={() => set({ state: st })}>
              {STATE_LABEL(fem)[st]}
            </button>
          ))}
        </div>
      </FilterField>
    </div>
  )
}
