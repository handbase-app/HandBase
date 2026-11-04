import { useState } from 'react'
import { appName } from '../appBrand'
import { fmtDate, today, type Criterion, type Measurement, type Player } from '../db'
import { accord, w } from '../gender'
import { goalViews } from '../myGoals'
import { objectiveOrigin, objectivesOf, progressLabel } from '../objectives'
import { usePlayerGoals } from './Objectives'
import { foldSteps, monthYear, periodLabel, type Palier, type ParcoursStep } from '../parcours'
import { hasReperes, medalFor, MEDALS, type ReperesConfig } from '../reperes'
import { seasonCategory } from '../rencontres'
import { positionFull } from '../sportConfig'
import { sportContent } from '../sportContent'
import { installationAppearance } from '../theme'
import { latestByPlayer } from '../pages/Players'
import { FormActions, FormWindow } from './FormWindow'
import { Medal } from './Medal'
import { fmtValue, groupBy } from './ui'

/*
 * « Bilan à imprimer » (fiche d'un joueur, menu ⋮ ; idée reprise de « Génération Bleue », 04/11) : une page propre pour la
 * famille ou l'école, imprimée ou « Enregistrer au format PDF » par l'impression du navigateur. Tout est fait sur
 * l'appareil : rien n'est envoyé à aucun service.
 *
 * Dedans : nom, année de naissance, club, poste ; le parcours par palier (src/parcours.ts) ; les objectifs de travail en cours
 * (src/objectives.ts, vague 2), ceux du staff puis ceux du jeune (« à lui / à elle », 065, quand ils sont lisibles), avec
 * leurs étapes cochées ou pas et l'avancement (jamais les liens vidéo) ; les dernières mesures avec leurs médailles (repères de l'installation, src/reperes.ts) ; « Le mot du staff », tapé juste avant d'imprimer (gardé sur cet
 * appareil le temps de la session, jamais enregistré dans la base) ; la date et la signature de l'appli.
 * Jamais : les avis des observateurs ni leurs notes (pas écrits pour les familles), les commentaires des mesures, les
 * données d'autres joueurs, rien de négatif. Les données sont celles que la fiche montre (« Voir comme… » compris).
 *
 * Fenêtre d'aperçu : celle des formulaires (src/components/FormWindow.tsx : fond voilé et flouté, Échap et Retour du
 * téléphone ferment). À l'impression, seule la feuille sort (src/index.css, « Bilan à imprimer »), en noir et blanc lisible.
 */

const NOTE_MAX = 1200
const noteKey = (id: string) => `handbase.bilan-famille.${id}`
const readNote = (id: string) => {
  try {
    return sessionStorage.getItem(noteKey(id)) ?? ''
  } catch {
    return ''
  }
}
const keepNote = (id: string, v: string) => {
  try {
    if (v) sessionStorage.setItem(noteKey(id), v)
    else sessionStorage.removeItem(noteKey(id))
  } catch {
    /* stockage indisponible : le mot reste dans la fenêtre */
  }
}

/** Catégories de tests qui décrivent le gabarit (taille, poids) : pas dans le bilan, comme dans la grille de l'onglet Tests. */
const SKIP_CATEGORIES = new Set(['Gabarit'])

export function FamilyReport({
  player: p,
  criteria,
  measurements,
  paliers,
  reperes,
  onClose,
}: {
  player: Player
  /** Critères factuels (tests et mesures). */
  criteria: Criterion[]
  measurements: Measurement[]
  paliers: Palier[]
  reperes: ReperesConfig
  onClose: () => void
}) {
  const [note, setNote] = useState(() => readNote(p.id))
  const change = (v: string) => {
    setNote(v)
    keepNote(p.id, v)
  }

  const latest = latestByPlayer(measurements).get(p.id) ?? new Map<string, Measurement>()
  // Dernières mesures : valeurs chiffrées et choix (pas les notes libres), catégorie par catégorie, dans l'ordre des critères.
  const tests = groupBy(
    criteria.filter((c) => (c.scale === 'number' || c.scale === 'choice') && c.active !== false && !SKIP_CATEGORIES.has(c.category) && latest.has(c.id)),
    (c) => c.category,
  )
  const medalOf = (c: Criterion) => {
    const m = latest.get(c.id)!
    return medalFor(reperes, c, m.value, p, m.date)
  }
  const anyMedal = hasReperes(reperes) && tests.some(([, cs]) => cs.some((c) => !!medalOf(c)))
  // Objectifs de travail EN COURS (les atteints sont dans la fiche, pas dans le bilan) : ceux du staff, puis ceux du jeune,
  // avec ses coches (065 ; pas lisibles : ceux du staff avec les coches du staff).
  const goals = goalViews(objectivesOf(p), usePlayerGoals(p.id)).active

  const org = installationAppearance().name
  const brand = [appName(), org && org.toLowerCase() !== appName().toLowerCase() ? org : ''].filter(Boolean).join(' · ')
  const year = p.birthDate?.slice(0, 4)
  const cat = seasonCategory(p.birthDate, today(), sportContent().youthCategories)
  const facts = [year && `${accord('Né', p.sex)} en ${year}`, cat, p.club, positionFull(p.position)].filter(Boolean)

  return (
    <FormWindow title="Bilan à imprimer" onClose={onClose} width={820} guard={false}>
      <div className="flex flex-col gap-1">
        <label className="label" htmlFor="mot-du-staff">
          Le mot du staff
        </label>
        <textarea
          id="mot-du-staff"
          className="field min-h-24 w-full"
          maxLength={NOTE_MAX}
          placeholder="Quelques mots pour la famille : progrès, envies, encouragements…"
          value={note}
          onChange={(e) => change(e.target.value)}
        />
        <p className="text-[11px] text-muted">
          Gardé sur cet appareil le temps de la session, jamais enregistré. Rien n’est envoyé : pour un PDF, choisis « Enregistrer au format PDF » comme imprimante.
        </p>
      </div>

      {/* La feuille : blanche à l'écran comme sur le papier. */}
      <article
        className="report-sheet family-report rounded-lg bg-white p-4 text-[12px] leading-snug text-neutral-900 shadow sm:p-8 print:rounded-none print:p-0 print:shadow-none"
        aria-label="Aperçu du bilan"
      >
        {/* Pas un <header> : l'impression cache les en-têtes de l'appli (src/index.css). */}
        <div className="keep mb-4 border-b-2 border-neutral-900 pb-2">
          <div className="text-[10px] font-bold tracking-widest text-neutral-500 uppercase">{brand}</div>
          <h2 className="text-lg font-extrabold">
            Bilan de {p.firstName} {p.lastName.toUpperCase()}
          </h2>
          {facts.length > 0 && <div className="font-bold">{facts.join(' · ')}</div>}
        </div>

        {paliers.length > 0 && (
          <section className="mb-4">
            <h3 className="mb-1.5 text-[11px] font-extrabold tracking-wider uppercase">Parcours</h3>
            <ol className="flex flex-col gap-2">
              {paliers.map((pa) => (
                <li key={pa.id} className="keep rounded border border-neutral-300 px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-extrabold">{pa.label}</span>
                    <span className="text-[11px] text-neutral-600 tabular-nums">{periodLabel(pa)}</span>
                  </div>
                  <ul className="mt-0.5 text-[11px] text-neutral-700">
                    {foldSteps(pa.steps).map((s, i) =>
                      'more' in s ? (
                        <li key={`more${i}`}>⋯ et {s.more} autres</li>
                      ) : (
                        <li key={s.key}>{stepText(s)}</li>
                      ),
                    )}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        )}

        {goals.length > 0 && (
          <section className="keep mb-4">
            <h3 className="mb-1.5 text-[11px] font-extrabold tracking-wider uppercase">Objectifs de travail</h3>
            <ul className="flex flex-col gap-1.5">
              {goals.map((v) => (
                <li key={`${v.owner}:${v.goal.id}`} className="keep rounded border border-neutral-300 px-3 py-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span>
                      <span className="font-bold">{v.goal.text}</span>
                      {v.owner === 'moi' && <span className="text-[11px] text-neutral-600"> · son objectif à {w(p.sex).lui}</span>}
                      {objectiveOrigin(v.goal, fmtDate) && <span className="text-[11px] text-neutral-600"> · {objectiveOrigin(v.goal, fmtDate)}</span>}
                    </span>
                    {v.progress.total > 0 && <span className="text-[11px] font-bold text-neutral-700 tabular-nums">{progressLabel(v.progress)}</span>}
                  </div>
                  {v.steps.length > 0 && (
                    <ul className="mt-0.5 text-[11px] text-neutral-700">
                      {/* Cases dessinées en texte : lisibles en noir et blanc. */}
                      {v.steps.map((s) => (
                        <li key={s.id}>
                          <span aria-hidden>{s.checked ? '☑' : '☐'}</span> {s.text}
                          <span className="sr-only">{s.checked ? ' (faite)' : ' (à faire)'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tests.length > 0 && (
          <section className="mb-4">
            <h3 className="mb-1.5 text-[11px] font-extrabold tracking-wider uppercase">Tests physiques</h3>
            <div className="flex flex-col gap-2">
              {tests.map(([category, cs]) => (
                <table key={category} className="keep w-full border-collapse text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-neutral-400">
                      <th className="py-1 pr-2 font-extrabold">{category}</th>
                      <th className="w-24 py-1 pr-2 font-bold text-neutral-600">Résultat</th>
                      <th className="w-20 py-1 pr-2 font-bold text-neutral-600">Date</th>
                      {anyMedal && <th className="w-36 py-1 font-bold text-neutral-600">Repère</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {cs.map((c) => {
                      const m = latest.get(c.id)!
                      const level = medalOf(c)
                      return (
                        <tr key={c.id} className="border-b border-neutral-200">
                          <td className="py-1 pr-2">{c.label}</td>
                          <td className="py-1 pr-2 font-bold whitespace-nowrap tabular-nums">{fmtValue(c, m.value)}</td>
                          <td className="py-1 pr-2 whitespace-nowrap tabular-nums">{fmtDate(m.date)}</td>
                          {anyMedal && <td className="py-1">{level && <Medal level={level} label={reperes.labels[level]} size={16} withLabel />}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ))}
            </div>
            {anyMedal && (
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-600">
                <span>Médailles : résultat qui atteint un repère fixé par {org || 'l’organisation'}.</span>
                {MEDALS.map((m) => (
                  <Medal key={m} level={m} label={reperes.labels[m]} size={13} withLabel />
                ))}
              </p>
            )}
          </section>
        )}

        {note.trim() && (
          <section className="keep mb-4">
            <h3 className="mb-1.5 text-[11px] font-extrabold tracking-wider uppercase">Le mot du staff</h3>
            <p className="rounded border border-neutral-300 px-3 py-2 whitespace-pre-wrap">{note.trim()}</p>
          </section>
        )}

        {!paliers.length && !goals.length && !tests.length && !note.trim() && (
          <p className="mb-4 text-neutral-600">Le parcours commence : les prochaines étapes et les tests viendront s’ajouter ici.</p>
        )}

        <div className="mt-6 flex flex-wrap items-end justify-between gap-2 border-t border-neutral-300 pt-2 text-[10px] text-neutral-600">
          <span>Bilan édité le {fmtDate(today())}</span>
          <span className="text-[12px] font-extrabold tracking-wider text-neutral-900">{appName()}</span>
        </div>
      </article>

      <FormActions>
        <button type="button" className="btn-primary min-h-10 px-4 text-xs" onClick={() => window.print()}>
          Imprimer / PDF
        </button>
        <button type="button" className="btn-ghost min-h-10 px-4 text-xs" onClick={onClose}>
          Fermer
        </button>
      </FormActions>
    </FormWindow>
  )
}

/** Une étape du parcours : « Stage de ligue fictif · oct. 2025 » ; pôle : « … · depuis sept. 2025 » ou « … · sept. 2024 → juin 2025 ». */
function stepText(s: ParcoursStep): string {
  if (!s.date) return s.name
  if (s.end !== undefined || s.current) return `${s.name} · ${s.current ? `depuis ${monthYear(s.date)}` : `${monthYear(s.date)} → ${monthYear(s.end!)}`}`
  return `${s.name} · ${monthYear(s.date)}`
}
