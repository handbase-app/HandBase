import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db, fmtDate, newId, save, today, type Player } from '../db'
import { w } from '../gender'
import {
  activeObjectives,
  finalizeObjectives,
  doneObjectives,
  objectiveOrigin,
  objectivesOf,
  OBJ_MAX_ACTIVE,
  OBJ_TEXT_MAX,
  originEvents,
  sameObjectives,
  type WorkObjective,
} from '../objectives'
import { Icon, SectionTitle } from './ui'

/*
 * Objectifs de travail (vague 2 « Génération Bleue », src/objectives.ts) :
 *  - ObjectivesCard : carte de la fiche (onglet Profil), modifiable sur place comme « Poste et latéralité » : le crayon ouvre
 *    la modification (texte, « Atteint ✓ », d'où il vient, date, retirer, ajouter) ; « Terminé » écrit la fiche une fois,
 *    « Annuler » oublie. Encadrant qui peut modifier la fiche ; sans objectif, la carte ne paraît que pour lui.
 *  - MyObjectives : « Mes objectifs » sur la page du jeune, en lecture seule.
 * Toujours en positif : « En cours » ou « Atteint ✓ », rien d'autre.
 */

/** Pastille d'état : « En cours » (neutre) ou « Atteint ✓ » (vert). */
function StatusPill({ o }: { o: WorkObjective }) {
  return o.status === 'atteint' ? (
    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-500">Atteint ✓</span>
  ) : (
    <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">En cours</span>
  )
}

/** Un objectif en lecture : texte, état, d'où il vient. */
function ObjectiveLine({ o }: { o: WorkObjective }) {
  const from = objectiveOrigin(o, fmtDate)
  return (
    <li className="flex items-start gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
      <Icon name={o.status === 'atteint' ? 'check' : 'target'} className={`mt-0.5 h-4 w-4 shrink-0 ${o.status === 'atteint' ? 'text-emerald-500' : 'text-accent'}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold break-words">{o.text}</div>
        {(from || o.doneAt) && (
          <div className="mt-0.5 text-[11px] text-muted">
            {from}
            {o.doneAt && `${from ? ' · ' : ''}atteint le ${fmtDate(o.doneAt)}`}
          </div>
        )}
      </div>
      <StatusPill o={o} />
    </li>
  )
}

/** Brouillon d'un objectif pendant la modification (texte libre, nettoyé à « Terminé »). */
interface Draft extends WorkObjective {
  isNew?: boolean
}

export function ObjectivesCard({ player: p, canEdit }: { player: Player; canEdit: boolean }) {
  const g = w(p.sex)
  const saved = objectivesOf(p)
  const [draft, setDraft] = useState<Draft[] | null>(null)
  // Événements proposés comme origine : ceux où le joueur était sur la liste (6 derniers mois).
  const events = useLiveQuery(async () => (draft ? originEvents(await db.events.toArray(), p.id, today()) : []), [p.id, !!draft]) ?? []
  if (!saved.length && !canEdit) return null

  const active = activeObjectives(saved)
  const done = doneObjectives(saved)
  const patch = (id: string, x: Partial<Draft>) => setDraft((d) => d && d.map((o) => (o.id === id ? { ...o, ...x } : o)))
  const draftActive = draft ? draft.filter((o) => o.status === 'en_cours').length : 0

  function finish() {
    if (!draft) return
    // Lignes vides retirées, textes nettoyés ; l'ordre est gardé.
    const next = finalizeObjectives(draft.map(({ isNew: _n, ...o }) => o))
    if (!sameObjectives(next, saved)) {
      const { objectives: _old, ...rest } = p
      void save<Player>('players', next.length ? { ...rest, objectives: next } : rest)
    }
    setDraft(null)
  }

  return (
    <div className="card p-4" data-testid="objectifs-travail">
      <div className="mb-2 flex items-center justify-between gap-2">
        <SectionTitle className="mb-0" info={`${OBJ_MAX_ACTIVE} objectifs en cours au plus, courts et dits en positif (« Gagner en vitesse sur le premier pas »). ${g.LeJoueur} les voit sur sa page, et ceux en cours sont dans le bilan à imprimer.`}>
          Objectifs de travail
        </SectionTitle>
        {canEdit &&
          (draft ? (
            <div className="flex items-center gap-1">
              <button className="min-h-10 px-2 text-xs font-bold text-muted" onClick={() => setDraft(null)}>
                Annuler
              </button>
              <button className="min-h-10 px-2 text-xs font-bold text-accent" onClick={finish}>
                Terminé
              </button>
            </div>
          ) : (
            <button
              className="-m-1.5 flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg"
              aria-label="Modifier les objectifs de travail"
              title="Modifier les objectifs de travail"
              onClick={() => setDraft(saved.length ? saved.map((o) => ({ ...o })) : [{ id: newId(), text: '', status: 'en_cours', isNew: true }])}
            >
              <Icon name="pencil" className="h-4 w-4" />
            </button>
          ))}
      </div>

      {draft ? (
        <div className="flex flex-col gap-3">
          {draft.map((o, i) => (
            <div key={o.id} className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-2.5">
              <div className="flex items-center gap-2">
                <input
                  className="field min-h-11 min-w-0 flex-1"
                  placeholder={i === 0 ? 'Ex. : Gagner en vitesse sur le premier pas' : 'Un autre objectif, en positif'}
                  maxLength={OBJ_TEXT_MAX}
                  value={o.text}
                  aria-label={`Objectif ${i + 1}`}
                  autoFocus={o.isNew}
                  onChange={(e) => patch(o.id, { text: e.target.value })}
                />
                <button
                  className="flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel hover:text-fg"
                  aria-label="Retirer cet objectif"
                  title="Retirer cet objectif"
                  onClick={() => setDraft((d) => d && d.filter((x) => x.id !== o.id))}
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={o.status === 'atteint'}
                  // Le remettre « en cours » : seulement s'il reste de la place.
                  disabled={o.status === 'atteint' && draftActive >= OBJ_MAX_ACTIVE}
                  className={`min-h-10 rounded-full border px-3 text-xs font-bold ${o.status === 'atteint' ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-500' : 'border-line bg-panel text-muted'}`}
                  onClick={() => patch(o.id, o.status === 'atteint' ? { status: 'en_cours', doneAt: undefined } : { status: 'atteint', doneAt: today() })}
                >
                  {o.status === 'atteint' ? 'Atteint ✓' : 'Marquer atteint'}
                </button>
                <select
                  className="field min-h-10 min-w-0 flex-1 text-xs"
                  aria-label="D’où vient cet objectif"
                  value={o.eventId ?? ''}
                  onChange={(e) => {
                    const ev = events.find((x) => x.id === e.target.value)
                    patch(o.id, ev ? { eventId: ev.id, eventName: ev.name, date: o.date ?? ev.date } : { eventId: undefined, eventName: undefined })
                  }}
                >
                  <option value="">D’où vient-il ? (facultatif)</option>
                  {/* L'événement déjà choisi, même s'il n'est plus dans la liste proposée. */}
                  {o.eventId && !events.some((x) => x.id === o.eventId) && <option value={o.eventId}>{o.eventName ?? 'Événement'}</option>}
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name} · {fmtDate(ev.date)}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  className="field min-h-10 w-40 shrink-0 text-xs"
                  aria-label="Date de l’objectif (facultative)"
                  value={o.date ?? ''}
                  onChange={(e) => patch(o.id, { date: e.target.value || undefined })}
                />
              </div>
            </div>
          ))}
          {draftActive < OBJ_MAX_ACTIVE ? (
            <button className="btn-ghost min-h-11 w-fit px-3 text-xs" onClick={() => setDraft((d) => d && [...d, { id: newId(), text: '', status: 'en_cours', isNew: true }])}>
              <Icon name="plus" className="mr-1 inline h-3.5 w-3.5" />
              Ajouter un objectif
            </button>
          ) : (
            <p className="text-[11px] text-muted">
              {OBJ_MAX_ACTIVE} objectifs en cours : pour en ajouter un, marque-en un « atteint » ou retire-le.
            </p>
          )}
        </div>
      ) : saved.length ? (
        <div className="flex flex-col gap-2">
          {active.length > 0 && (
            <ul className="flex flex-col gap-2">
              {active.map((o) => (
                <ObjectiveLine key={o.id} o={o} />
              ))}
            </ul>
          )}
          {!active.length && <p className="text-xs text-muted">Pas d’objectif en cours.</p>}
          {done.length > 0 && <DoneList done={done} />}
        </div>
      ) : (
        <p className="text-xs text-muted">
          Pas encore d’objectif. Le crayon pour en fixer 1 à {OBJ_MAX_ACTIVE} : {g.leJoueur} les verra sur sa page.
        </p>
      )}
    </div>
  )
}

/** Objectifs atteints : repliés au-delà de deux. */
function DoneList({ done }: { done: WorkObjective[] }) {
  if (done.length <= 2)
    return (
      <ul className="flex flex-col gap-2">
        {done.map((o) => (
          <ObjectiveLine key={o.id} o={o} />
        ))}
      </ul>
    )
  return (
    <details className="rounded-lg border border-line p-2">
      <summary className="min-h-9 cursor-pointer content-center text-xs font-bold">Objectifs atteints ({done.length})</summary>
      <ul className="mt-2 flex flex-col gap-2">
        {done.map((o) => (
          <ObjectiveLine key={o.id} o={o} />
        ))}
      </ul>
    </details>
  )
}

/** « Mes objectifs » : page du jeune, lecture seule (fixés avec son encadrant). Rien à montrer : rien. */
export function MyObjectives({ player: p }: { player: Player }) {
  const list = objectivesOf(p)
  if (!list.length) return null
  const active = activeObjectives(list)
  const done = doneObjectives(list)
  return (
    <section className="card flex flex-col gap-2 p-4" data-testid="mes-objectifs">
      <SectionTitle info="Fixés avec ton encadrant. Quand un objectif est atteint, il passe en vert ✓. Pour en parler ou en changer, vois avec lui.">Mes objectifs</SectionTitle>
      {active.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {active.map((o) => (
            <ObjectiveLine key={o.id} o={o} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">Tous tes objectifs sont atteints : bravo ! Les prochains viendront avec ton encadrant.</p>
      )}
      {done.length > 0 && <DoneList done={done} />}
    </section>
  )
}
