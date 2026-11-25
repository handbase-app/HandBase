import { useEffect, useMemo, useState } from 'react'
import { newId, save, type ConfigItem } from '../db'
import { cleanTemplates, GOAL_TEMPLATES_KEY, TEMPLATES_MAX, templatesOf, type GoalTemplate } from '../goalTemplates'
import { useConfigRows } from '../installation'
import { badVideoUrl, OBJ_TEXT_MAX } from '../objectives'
import { StepsEditor, VideoField, type StepDraft } from './Objectives'
import { Icon, SectionTitle } from './ui'

/*
 * Réglages → « Modèles d'objectifs » (administrateurs ; src/goalTemplates.ts) : des objectifs types, chacun avec ses étapes
 * et ses liens vidéo facultatifs. Sur la fiche d'un joueur, « + Depuis un modèle » (modification des objectifs de travail)
 * ajoute l'objectif et ses étapes, qu'on adapte ensuite ; le modèle ne change pas. Enregistré dans la configuration de
 * l'installation (hb_config, clé « modeles_objectifs »). Aucun modèle : le bouton n'apparaît pas sur la fiche.
 */

interface DraftTemplate {
  id: string
  text: string
  video: string
  steps: StepDraft[]
}

const toDraft = (list: GoalTemplate[]): DraftTemplate[] =>
  list.map((t) => ({ id: t.id, text: t.text, video: t.video ?? '', steps: t.steps.map((s) => ({ id: newId(), text: s.text, video: s.video })) }))
const fromDraft = (d: DraftTemplate[]): GoalTemplate[] =>
  cleanTemplates(d.map((t) => ({ id: t.id, text: t.text, video: t.video, steps: t.steps.map((s) => ({ text: s.text, video: s.video })) })))

/** Identifiant d'un nouveau modèle (court : 40 caractères au plus). */
const templateId = () => `modele-${newId().replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`

export function GoalTemplatesSettings({ editable }: { editable: boolean }) {
  const rows = useConfigRows()
  const saved = useMemo(() => templatesOf(rows), [rows])
  const savedJson = JSON.stringify(saved)
  const [draft, setDraft] = useState<DraftTemplate[]>(() => toDraft(saved))
  const [base, setBase] = useState(savedJson)
  const [msg, setMsg] = useState('')
  const current = JSON.stringify(fromDraft(draft))
  const edited = current !== base
  const dirty = current !== savedJson
  // Modèles lus après le premier affichage, ou changés ailleurs : on repart d'eux tant que rien n'a été touché.
  useEffect(() => {
    if (savedJson !== base && !edited) {
      setDraft(toDraft(saved))
      setBase(savedJson)
    }
  }, [savedJson]) // eslint-disable-line react-hooks/exhaustive-deps

  const badLink = draft.some((t) => badVideoUrl(t.video) || t.steps.some((s) => s.text.trim() && badVideoUrl(s.video)))
  const set = (id: string, x: Partial<DraftTemplate>) => (setMsg(''), setDraft((d) => d.map((t) => (t.id === id ? { ...t, ...x } : t))))

  async function submit() {
    const value = fromDraft(draft)
    await save<ConfigItem>('config', { id: GOAL_TEMPLATES_KEY, key: GOAL_TEMPLATES_KEY, value })
    setDraft(toDraft(value))
    setBase(JSON.stringify(value))
    setMsg('Enregistré.')
  }

  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="reglage-modeles-objectifs">
      <SectionTitle
        info={
          <p>
            Des objectifs types, avec leurs étapes et, si on veut, un lien vidéo (le modèle à imiter, la démonstration de l’exercice). Sur la fiche d’un joueur, en
            modifiant ses objectifs de travail, « Depuis un modèle » ajoute l’objectif et ses étapes : on l’adapte ensuite, le modèle ne change pas.
          </p>
        }
      >
        Modèles d’objectifs
      </SectionTitle>
      {!draft.length && <p className="text-xs text-muted">Pas encore de modèle.</p>}
      {draft.map((t, i) => (
        <div key={t.id} className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid="modele-objectif">
          <div className="flex items-center gap-2">
            <input
              className="field min-h-11 min-w-0 flex-1"
              maxLength={OBJ_TEXT_MAX}
              disabled={!editable}
              placeholder="Ex. : Gagner en détente"
              aria-label={`Modèle ${i + 1}`}
              value={t.text}
              onChange={(e) => set(t.id, { text: e.target.value })}
            />
            {editable && (
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg"
                aria-label={`Retirer le modèle ${i + 1}`}
                title="Retirer ce modèle"
                onClick={() => (setMsg(''), setDraft((d) => d.filter((x) => x.id !== t.id)))}
              >
                <Icon name="trash" className="h-4 w-4" />
              </button>
            )}
          </div>
          {editable ? (
            <>
              <VideoField value={t.video} onChange={(v) => set(t.id, { video: v })} label={`Lien vidéo du modèle ${i + 1}`} />
              <StepsEditor steps={t.steps} onChange={(steps) => set(t.id, { steps })} />
            </>
          ) : (
            <ol className="list-decimal pl-5 text-xs">
              {t.steps.map((s) => (
                <li key={s.id}>{s.text}</li>
              ))}
            </ol>
          )}
        </div>
      ))}
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          {draft.length < TEMPLATES_MAX && (
            <button className="btn-ghost min-h-11 px-3 text-xs" onClick={() => (setMsg(''), setDraft((d) => [...d, { id: templateId(), text: '', video: '', steps: [] }]))}>
              <Icon name="plus" className="mr-1 inline h-3.5 w-3.5" />
              Ajouter un modèle
            </button>
          )}
          <button className="btn-primary min-h-11 px-5" disabled={!dirty || badLink} onClick={() => void submit()}>
            Enregistrer
          </button>
          {badLink && <span className="text-[11px] text-red-500">Un lien n’est pas une adresse web (http:// ou https://).</span>}
          {msg && !dirty && <span className="text-[11px] text-emerald-500">{msg}</span>}
        </div>
      )}
    </section>
  )
}
