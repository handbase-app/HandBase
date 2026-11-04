import { useState } from 'react'
import { today } from '../db'
import {
  addDays,
  eventShortcutLabel,
  extendPeriod,
  matchShortcut,
  PERIOD_SHORTCUTS,
  periodBad,
  PERIOD_ERROR,
  periodElapsed,
  periodLabel,
  periodState,
  shortcutBase,
  shortcutEnd,
  shortDay,
  type PeriodFields,
  type PeriodShortcut,
} from '../period'
import { Icon } from './ui'

/*
 * Période d'un objectif (04/11 ; partie pure : src/period.ts), saisie en un toucher, la même partout où l'on crée ou modifie
 * un objectif : carte de la fiche (staff), « Donner un objectif au groupe », fenêtre « Mon objectif » (le jeune).
 *  - Pastilles : « 1 semaine », « 2 semaines », « 1 mois », « Jusqu'à la rentrée », « Jusqu'au prochain stage » (seulement
 *    s'il y en a un à venir pour ce joueur, ou commun au groupe), « Pas de fin », « Autre date » (un champ date).
 *  - « Commencer plus tard » : petit lien discret, il montre « À partir du … » (les vacances) ; les durées comptent alors
 *    depuis ce jour-là (la pastille choisie suit le nouveau début).
 *  - Période terminée : « Prolonger d'une semaine ». Toujours neutre : jamais « en retard », jamais de rouge sur un jeune.
 * Pas de bulle ni de fenêtre ici (tout est sur place) : rien à flouter.
 * PeriodNote : le libellé de la carte (« Jusqu'au 31/08 · encore 12 jours ») et sa petite barre de temps.
 */

export interface PeriodValue {
  from?: string
  due?: string
}

const pill = (on: boolean) =>
  `min-h-10 rounded-full border px-3 text-xs font-bold sm:min-h-9 ${on ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel text-muted hover:text-fg'}`

export function PeriodPicker({
  value,
  onChange,
  date,
  nextEvent,
  label = 'Période',
}: {
  value: PeriodValue
  onChange: (v: PeriodValue) => void
  /** Jour où l'objectif a été fixé (début de la période sans « à partir du »). */
  date?: string
  /** Prochain événement à venir où le joueur (ou tout le groupe) est sur la liste. */
  nextEvent?: { name: string; date: string }
  label?: string
}) {
  const day = today()
  const base = shortcutBase(value, day)
  const ev = nextEvent && shortcutEnd('evenement', base, nextEvent) ? nextEvent : undefined
  // Pastille choisie à la main (« Autre date » ouvre le champ) ; sinon, celle qui donne la fin enregistrée.
  const [picked, setPicked] = useState<PeriodShortcut | 'autre' | null>(null)
  const [later, setLater] = useState(!!value.from)
  const active = picked ?? matchShortcut(value.due, base, ev)
  const shown = { ...value, date, status: 'en_cours' as const }
  const state = periodState(shown, day)
  const summary = periodLabel(shown, day) || (value.from ? `À partir du ${shortDay(value.from, day)}, sans fin` : '')
  const bad = periodBad(shown)

  const choose = (k: PeriodShortcut) => {
    setPicked(k)
    const due = shortcutEnd(k, base, ev)
    if (due !== null) onChange({ ...value, due })
  }
  /** Début repoussé (ou retiré) : la pastille choisie suit (« 2 semaines » à partir du nouveau début). */
  const setFrom = (from?: string) => {
    const k = active === 'autre' || active === 'sans' ? null : active
    const due = k ? shortcutEnd(k, shortcutBase({ from }, day), ev) : value.due
    onChange({ from, due: due === null ? value.due : due })
  }

  const items = PERIOD_SHORTCUTS.filter((s) => s.key !== 'evenement' || ev)
  return (
    <div className="flex flex-col gap-1.5" data-testid="periode">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="label mb-0">{label}</span>
        {summary && <span className="text-[11px] text-muted">{summary}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {items.map((s) => (
          <button
            key={s.key}
            type="button"
            className={pill(active === s.key)}
            aria-pressed={active === s.key}
            title={s.key === 'evenement' && ev ? `${ev.name} · ${shortDay(ev.date, day)}` : undefined}
            onClick={() => choose(s.key)}
          >
            {s.key === 'evenement' && ev ? eventShortcutLabel(ev) : s.label}
          </button>
        ))}
        <button type="button" className={pill(active === 'autre')} aria-pressed={active === 'autre'} onClick={() => setPicked('autre')}>
          Autre date
        </button>
      </div>
      {active === 'autre' && (
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Jusqu’au</span>
          <input
            type="date"
            className="field min-h-10 w-44 text-xs"
            aria-label="Fin de la période"
            min={value.from ?? day}
            autoFocus={picked === 'autre'}
            value={value.due ?? ''}
            onChange={(e) => onChange({ ...value, due: e.target.value || undefined })}
          />
        </label>
      )}
      {state === 'terminee' && value.due && (
        <button type="button" className="min-h-10 w-fit rounded-full px-2 text-xs font-bold text-accent hover:bg-accent/10" onClick={() => (setPicked('autre'), onChange({ ...value, due: extendPeriod(value.due!, day) }))}>
          <Icon name="clock" className="mr-1 inline h-3.5 w-3.5" />
          Prolonger d’une semaine
        </button>
      )}
      {later || value.from ? (
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">À partir du</span>
          <input
            type="date"
            className="field min-h-10 w-44 text-xs"
            aria-label="Début de la période"
            min={addDays(day, 1)}
            autoFocus={later && !value.from}
            value={value.from ?? ''}
            onChange={(e) => setFrom(e.target.value || undefined)}
          />
          <button type="button" className="min-h-10 rounded-full px-2 text-[11px] font-bold text-muted hover:bg-panel hover:text-fg" onClick={() => (setLater(false), setFrom(undefined))}>
            Commencer tout de suite
          </button>
        </label>
      ) : (
        <button type="button" className="min-h-9 w-fit rounded-full px-1 text-[11px] font-bold text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => setLater(true)}>
          Commencer plus tard
        </button>
      )}
      {bad && <p className="text-[11px] text-muted">{PERIOD_ERROR}</p>}
    </div>
  )
}

/**
 * Libellé de la carte, neutre (« Jusqu'au 31/08 · encore 12 jours », « Commence le 05/07 », « Période terminée ») et sa petite
 * barre de temps, grise (jamais la couleur d'accent, rouge sur certaines marques : le temps qui passe n'est pas une alerte).
 */
export function PeriodNote({ o }: { o: PeriodFields }) {
  const day = today()
  const text = periodLabel(o, day)
  if (!text) return null
  const f = periodElapsed(o, day)
  return (
    // Coupé seulement au « · » (téléphone) : « Jusqu'au 16/11 · » puis « encore 12 jours » et la barre.
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5" data-testid="periode-note">
      <Icon name="calendar" className="h-3 w-3 shrink-0" />
      {text.split(' · ').map((part, i, all) => (
        <span key={i} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {part}
          {i < all.length - 1 && ' ·'}
          {i === all.length - 1 && f !== undefined && (
            <span className="h-1 w-10 overflow-hidden rounded-full bg-line" aria-hidden>
              <span className="block h-full rounded-full bg-muted/70" style={{ width: `${Math.round(f * 100)}%` }} />
            </span>
          )}
        </span>
      ))}
    </span>
  )
}
