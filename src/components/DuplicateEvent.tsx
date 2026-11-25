import { useLiveQuery } from 'dexie-react-hooks'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { alive, db, fmtDate, today, type HBEvent } from '../db'
import { ALL_COPY, buildCopyDraft, copyTitle, hasTeams, type CopyOptions, type EventDraft } from '../eventCopy'
import { pluralG, w } from '../gender'
import { EVENT_TYPES, NewEventForm } from '../pages/Evaluate'
import { FormActions, FormWindow } from './FormWindow'
import { isPhone } from './MultiPicker'

/*
 * « Dupliquer l'événement » (menu ⋮ d'un événement, ligne de la liste ou page de l'événement ; can.manageEvents) :
 *  1. petite fenêtre « Dupliquer l'événement » : quoi copier (cases toutes cochées au départ) ;
 *  2. « Continuer » : la même fenêtre devient « Nouvel événement », pré-remplie (NewEventForm `copy`) : tout reste
 *     modifiable, puis « Créer » ;
 *  3. rien n'est écrit avant « Créer » (création normale, src/pages/Evaluate.tsx) ; l'original n'est jamais touché. Créé :
 *     la page du nouvel événement s'ouvre.
 * Une seule fenêtre pour les deux étapes : une seule entrée d'historique (le geste Retour la ferme).
 * Ce qui est copié : src/eventCopy.ts.
 */
export function DuplicateEvent({ ev, onClose }: { ev: HBEvent; onClose: () => void }) {
  const nav = useNavigate()
  const [opts, setOpts] = useState<CopyOptions>(ALL_COPY)
  const [draft, setDraft] = useState<EventDraft | null>(null)
  // Noms des événements de l'appareil : « (copie 2) », « (copie 3) »… si « (copie) » existe déjà.
  const names = useLiveQuery(() => db.events.toArray().then((es) => alive(es).map((e) => e.name)), [], [] as string[])
  const body = useRef<HTMLDivElement>(null)

  // Étape « Nouvel événement » : le focus passe dans le formulaire (le bouton « Continuer » a disparu).
  useLayoutEffect(() => {
    if (!draft) return
    const dialog = body.current?.closest<HTMLElement>('[role="dialog"]')
    const first = isPhone() ? null : dialog?.querySelector<HTMLElement>('[data-body] input')
    ;(first ?? dialog)?.focus({ preventScroll: true })
  }, [draft])

  if (draft)
    return (
      <FormWindow title="Nouvel événement" onClose={onClose}>
        <div ref={body} className="contents">
          <NewEventForm
            copy={draft}
            onDone={(created) => {
              onClose()
              // Ouvre l'événement créé : il prend la place de l'entrée d'historique de la fenêtre.
              if (created) nav(`/evenements/${created.id}`)
            }}
          />
        </div>
      </FormWindow>
    )

  const g = ev.sex
  const n = ev.playerIds?.length ?? 0
  const teams = hasTeams(ev)
  const nTeams = ev.tournament?.teams.length ?? 0
  const set = (k: keyof CopyOptions) => (on: boolean) => setOpts((o) => ({ ...o, [k]: on }))
  const type = EVENT_TYPES.find((x) => x.value === ev.type)?.label ?? ev.type
  return (
    <FormWindow title="Dupliquer l’événement" onClose={onClose} width={440} phoneFull={false} guard={false}>
      <p className="text-[11px] text-muted">
        Copie de « {ev.name} » ({[type, fmtDate(ev.date), ev.place].filter(Boolean).join(' · ')}). Choisis ce qui est repris ; tout reste modifiable avant « Créer ».
      </p>
      <div className="flex flex-col gap-2" role="group" aria-label="Ce qui est copié">
        <Check on={opts.players && n > 0} disabled={!n} onChange={set('players')} label={`Liste des ${w(g).joueurs}`}>
          {n ? `${pluralG(n, g)}, sans leurs avis ni leurs notes` : `aucun${g === 'F' ? 'e' : ''} dans la liste`}
        </Check>
        <Check on={opts.rename} onChange={set('rename')} label="Nom + (copie)">
          « {opts.rename ? copyTitle(ev.name, names) : ev.name} »
        </Check>
        <Check on={opts.today} onChange={set('today')} label="Date : aujourd’hui">
          {opts.today ? fmtDate(today()) : `sinon : ${fmtDate(ev.date)}, comme l’original`}
        </Check>
        {teams && (
          <Check on={opts.teams} onChange={set('teams')} label="Équipes">
            {nTeams > 1 ? `${nTeams} équipes` : '1 équipe'}
            {opts.players && n > 0 ? ' et numéros de maillot' : ''}, sans les résultats
          </Check>
        )}
      </div>
      <p className="text-[11px] text-muted">Toujours repris : type, lieu, organisateur, masculin / féminin, participants et groupes de travail.</p>
      <FormActions>
        <button
          className="btn-primary flex-1"
          onClick={async () => {
            // Noms relus au dernier moment (un événement a pu arriver entre-temps).
            const existing = alive(await db.events.toArray()).map((e) => e.name)
            setDraft(buildCopyDraft(ev, { ...opts, players: opts.players && n > 0, teams: opts.teams && teams }, existing, today()))
          }}
        >
          Continuer
        </button>
        <button className="btn text-muted" onClick={onClose}>
          Annuler
        </button>
      </FormActions>
    </FormWindow>
  )
}

/** Une case de la fenêtre : libellé en gras, détail dessous. */
function Check({ on, onChange, label, children, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; children: ReactNode; disabled?: boolean }) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-xs transition ${on ? 'border-accent/60 bg-accent/10' : 'border-line bg-panel-2'} ${disabled ? 'cursor-default opacity-50' : ''}`}
    >
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-accent" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <b className="block">{label}</b>
        <span className="block text-[11px] text-muted">{children}</span>
      </span>
    </label>
  )
}
