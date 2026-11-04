import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { measureDirection } from '../compare'
import { alive, db, save, type ConfigItem, type Criterion } from '../db'
import { useSportConfig } from '../installation'
import {
  cleanReperes,
  DEFAULT_MEDAL_LABELS,
  lineOrderProblem,
  MEDAL_NAMES,
  MEDALS,
  numericValue,
  REPERES_KEY,
  type MedalLevel,
  type RepereLine,
  type ReperesConfig,
} from '../reperes'
import { sportContent } from '../sportContent'
import { Medal, useReperes } from './Medal'
import { Icon, Segmented, SectionTitle } from './ui'

/*
 * Réglages → « Repères des tests » (administrateurs ; src/reperes.ts) : par test mesuré, des lignes de repères par sexe et
 * par âge ou catégorie, avec les seuils Bronze, Argent, Or ; et le nom de chaque niveau. Enregistré dans la configuration de
 * l'installation (hb_config, clé « reperes »). Sans repère : rien ne change à l'écran (aucune médaille).
 */

/** Ligne en cours de saisie : les seuils restent du texte (« 2,35 ») jusqu'à l'enregistrement. */
interface DraftLine {
  sex: '' | 'M' | 'F'
  /** '' : tous âges ; « cat:U15 » ; « age:14 ». */
  who: string
  bronze: string
  argent: string
  or: string
}
interface DraftCriterion {
  criterionId: string
  dir?: 1 | -1
  lines: DraftLine[]
}
interface Draft {
  labels: Record<MedalLevel, string>
  criteria: DraftCriterion[]
}

const fmt = (n?: number) => (n === undefined ? '' : String(n).replace('.', ','))
const toDraftLine = (l: RepereLine): DraftLine => ({
  sex: l.sex ?? '',
  who: l.age !== undefined ? `age:${l.age}` : l.cat ? `cat:${l.cat}` : '',
  bronze: fmt(l.bronze),
  argent: fmt(l.argent),
  or: fmt(l.or),
})
const toDraft = (cfg: ReperesConfig): Draft => ({
  // Libellé par défaut : champ vide (le défaut s'affiche en indication).
  labels: Object.fromEntries(MEDALS.map((m) => [m, cfg.labels[m] === DEFAULT_MEDAL_LABELS[m] ? '' : cfg.labels[m]])) as Record<MedalLevel, string>,
  criteria: cfg.criteria.map((c) => ({ criterionId: c.criterionId, dir: c.dir, lines: c.lines.map(toDraftLine) })),
})
const fromDraftLine = (l: DraftLine): RepereLine => {
  const out: RepereLine = {}
  if (l.sex) out.sex = l.sex
  if (l.who.startsWith('age:')) out.age = Number(l.who.slice(4))
  else if (l.who.startsWith('cat:')) out.cat = l.who.slice(4)
  for (const m of MEDALS) {
    const v = numericValue(l[m])
    if (v !== undefined) out[m] = v
  }
  return out
}
/** Valeur à enregistrer (relue par cleanReperes : lignes sans seuil et tests sans ligne écartés). */
const fromDraft = (d: Draft): ReperesConfig =>
  cleanReperes({
    labels: d.labels,
    criteria: d.criteria.map((c) => ({ criterionId: c.criterionId, ...(c.dir ? { dir: c.dir } : {}), lines: c.lines.map(fromDraftLine) })),
  })

const EMPTY_LINE: DraftLine = { sex: '', who: '', bronze: '', argent: '', or: '' }
/** Âges de saison proposés. */
const AGES = Array.from({ length: 13 }, (_, i) => i + 9)

export function ReperesSettings({ editable }: { editable: boolean }) {
  const sport = useSportConfig().sport
  const cats = sportContent(sport).youthCategories
  const cfg = useReperes()
  const criteria = useLiveQuery(() => db.criteria.orderBy('order').toArray().then(alive), [], [] as Criterion[])
  // Tests mesurés (valeur chiffrée) : les seuls qui peuvent avoir des repères.
  const measured = useMemo(() => criteria.filter((c) => c.kind === 'factual' && c.scale === 'number'), [criteria])
  const saved = useMemo(() => JSON.stringify(cfg), [cfg])
  const [draft, setDraft] = useState<Draft>(() => toDraft(cfg))
  const [msg, setMsg] = useState('')
  // Configuration lue après le premier affichage, ou changée ailleurs (autre appareil, autre administrateur) : on repart
  // d'elle tant que rien n'a été touché depuis la dernière lecture (`base`).
  const [base, setBase] = useState(saved)
  const current = JSON.stringify(fromDraft(draft))
  const edited = current !== base
  /** Différent de ce qui est enregistré : « Enregistrer » possible. */
  const dirty = current !== saved
  useEffect(() => {
    if (saved !== base && !edited) {
      setDraft(toDraft(cfg))
      setBase(saved)
    }
  }, [saved]) // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map(criteria.map((c) => [c.id, c]))
  const dirOf = (dc: DraftCriterion): 1 | -1 | 0 => {
    const c = byId.get(dc.criterionId)
    return dc.dir ?? (c ? measureDirection(c) : 0)
  }
  // Problèmes qui empêchent d'enregistrer : sens inconnu, seuils dans le désordre, seuil illisible.
  const problems = draft.criteria.flatMap((dc) => {
    const label = byId.get(dc.criterionId)?.label ?? dc.criterionId
    const d = dirOf(dc)
    const out: string[] = []
    if (!d) out.push(`${label} : choisis le sens (plus haut ou plus bas est mieux).`)
    dc.lines.forEach((l, i) => {
      if (MEDALS.some((m) => l[m].trim() && numericValue(l[m]) === undefined)) out.push(`${label}, ligne ${i + 1} : un seuil n’est pas un nombre.`)
      else if (d) {
        const p = lineOrderProblem(fromDraftLine(l), d)
        if (p) out.push(`${label}, ligne ${i + 1} : ${p}.`)
      }
    })
    return out
  })

  const setCrit = (i: number, f: (c: DraftCriterion) => DraftCriterion) => {
    setMsg('')
    setDraft((d) => ({ ...d, criteria: d.criteria.map((c, j) => (j === i ? f(c) : c)) }))
  }
  const setLine = (i: number, k: number, patch: Partial<DraftLine>) => setCrit(i, (c) => ({ ...c, lines: c.lines.map((l, j) => (j === k ? { ...l, ...patch } : l)) }))
  const available = measured.filter((c) => !draft.criteria.some((d) => d.criterionId === c.id))

  async function submit() {
    const value = fromDraft(draft)
    await save<ConfigItem>('config', { id: REPERES_KEY, key: REPERES_KEY, value })
    setDraft(toDraft(value))
    setBase(JSON.stringify(value))
    setMsg('Enregistré.')
  }

  return (
    <section className="card flex flex-col gap-3 p-4" data-testid="reglage-reperes">
      <SectionTitle
        info={
          <>
            <p>
              Une médaille s’affiche à côté d’un résultat de test quand il atteint un repère : dans l’onglet Tests de la fiche, pendant la séance de tests et
              sur le bilan à imprimer. En dessous du premier repère : rien (jamais de mention négative).
            </p>
            <p>
              Une ligne par sexe et par âge ou catégorie (âge atteint dans l’année où finit la saison de la mesure). La ligne la plus précise compte : le
              sexe d’abord, puis l’âge, puis la catégorie. Une valeur égale au repère l’atteint.
            </p>
          </>
        }
      >
        Repères des tests
      </SectionTitle>

      {/* Noms des niveaux */}
      <div className="flex flex-col gap-2">
        <span className="label mb-0">Noms des niveaux</span>
        {MEDALS.map((m) => (
          <label key={m} className="flex items-center gap-2">
            <Medal level={m} label={draft.labels[m] || DEFAULT_MEDAL_LABELS[m]} size={22} />
            <span className="w-14 shrink-0 text-xs font-bold">{MEDAL_NAMES[m]}</span>
            <input
              className="field min-h-10 min-w-0 flex-1"
              maxLength={40}
              disabled={!editable}
              placeholder={DEFAULT_MEDAL_LABELS[m]}
              aria-label={`Nom du niveau ${MEDAL_NAMES[m]}`}
              value={draft.labels[m]}
              onChange={(e) => (setMsg(''), setDraft((d) => ({ ...d, labels: { ...d.labels, [m]: e.target.value } })))}
            />
          </label>
        ))}
      </div>

      {/* Tests avec repères */}
      {draft.criteria.map((dc, i) => {
        const c = byId.get(dc.criterionId)
        const d = dirOf(dc)
        return (
          <div key={dc.criterionId} className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid={`reperes-${dc.criterionId}`}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold">{c?.label ?? dc.criterionId}</div>
                <div className="text-[11px] text-muted">{c ? [c.category, c.unit].filter(Boolean).join(' · ') : 'Critère introuvable dans la base'}</div>
              </div>
              {editable && (
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg"
                  aria-label={`Retirer les repères de ${c?.label ?? dc.criterionId}`}
                  title="Retirer les repères de ce test"
                  onClick={() => (setMsg(''), setDraft((x) => ({ ...x, criteria: x.criteria.filter((_, j) => j !== i) })))}
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              )}
            </div>
            <Segmented<'1' | '-1'>
              label="Sens du test"
              value={d ? (String(d) as '1' | '-1') : undefined}
              onChange={(v) => editable && setCrit(i, (x) => ({ ...x, dir: v === '1' ? 1 : -1 }))}
              options={[
                { value: '1', label: 'Plus haut = mieux' },
                { value: '-1', label: 'Plus bas = mieux' },
              ]}
            />
            {dc.lines.map((l, k) => {
              const problem = d && MEDALS.every((m) => !l[m].trim() || numericValue(l[m]) !== undefined) ? lineOrderProblem(fromDraftLine(l), d) : null
              return (
                <div key={k} className="flex flex-col gap-1.5 border-t border-line pt-2">
                  <div className="flex items-center gap-2">
                    <select
                      className="field min-h-10 min-w-0 flex-1"
                      aria-label="Sexe"
                      disabled={!editable}
                      value={l.sex}
                      onChange={(e) => setLine(i, k, { sex: e.target.value as DraftLine['sex'] })}
                    >
                      <option value="">Filles et garçons</option>
                      <option value="F">Filles</option>
                      <option value="M">Garçons</option>
                    </select>
                    <select className="field min-h-10 min-w-0 flex-1" aria-label="Âge ou catégorie" disabled={!editable} value={l.who} onChange={(e) => setLine(i, k, { who: e.target.value })}>
                      <option value="">Tous âges</option>
                      <optgroup label="Catégorie">
                        {cats.map((ct) => (
                          <option key={ct.code} value={`cat:${ct.code}`}>
                            {ct.code} ({ct.ages[0]}-{ct.ages[ct.ages.length - 1]} ans)
                          </option>
                        ))}
                        {/* Catégorie enregistrée qui n'est plus dans le sport : gardée. */}
                        {l.who.startsWith('cat:') && !cats.some((ct) => `cat:${ct.code}` === l.who) && <option value={l.who}>{l.who.slice(4)}</option>}
                      </optgroup>
                      <optgroup label="Âge de saison">
                        {AGES.map((a) => (
                          <option key={a} value={`age:${a}`}>
                            {a} ans
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {editable && (
                      <button
                        type="button"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-panel-2 hover:text-fg"
                        aria-label={`Retirer la ligne ${k + 1}`}
                        title="Retirer cette ligne"
                        onClick={() => setCrit(i, (x) => ({ ...x, lines: x.lines.filter((_, j) => j !== k) }))}
                      >
                        <span aria-hidden>✕</span>
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {MEDALS.map((m) => (
                      <label key={m} className="flex min-w-0 items-center gap-1 rounded-md border border-line bg-panel-2 pl-1.5">
                        <Medal level={m} label={draft.labels[m] || DEFAULT_MEDAL_LABELS[m]} size={18} />
                        <input
                          className="min-h-10 w-full min-w-0 bg-transparent px-1 text-sm tabular-nums outline-none"
                          inputMode="decimal"
                          disabled={!editable}
                          placeholder={MEDAL_NAMES[m]}
                          aria-label={`Seuil ${MEDAL_NAMES[m]}${c?.unit ? ` (${c.unit})` : ''}`}
                          value={l[m]}
                          onChange={(e) => setLine(i, k, { [m]: e.target.value })}
                        />
                        {c?.unit && <span className="pr-1.5 text-[10px] text-muted">{c.unit}</span>}
                      </label>
                    ))}
                  </div>
                  {problem && <p className="text-[11px] text-amber-300">{problem}</p>}
                </div>
              )
            })}
            {editable && (
              <button type="button" className="min-h-10 self-start text-xs font-bold text-accent" onClick={() => setCrit(i, (x) => ({ ...x, lines: [...x.lines, { ...EMPTY_LINE }] }))}>
                + Ajouter une ligne
              </button>
            )}
          </div>
        )
      })}

      {!draft.criteria.length && <p className="text-[11px] text-muted">Aucun repère : aucune médaille ne s’affiche.</p>}

      {editable && available.length > 0 && (
        <select
          className="field min-h-10"
          aria-label="Ajouter des repères à un test"
          value=""
          onChange={(e) => {
            const id = e.target.value
            if (!id) return
            setMsg('')
            setDraft((d) => ({ ...d, criteria: [...d.criteria, { criterionId: id, lines: [{ ...EMPTY_LINE }] }] }))
          }}
        >
          <option value="">+ Ajouter des repères à un test…</option>
          {[...new Set(available.map((c) => c.category))].map((cat) => (
            <optgroup key={cat} label={cat}>
              {available
                .filter((c) => c.category === cat)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {c.unit ? ` (${c.unit})` : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      )}
      {editable && !measured.length && <p className="text-[11px] text-muted">Aucun test mesuré dans les critères : importe d’abord les critères (Critères et listes).</p>}

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary min-h-11 px-4 text-xs" disabled={!dirty || problems.length > 0} onClick={() => void submit()}>
            Enregistrer
          </button>
          {dirty && (
            <button className="btn-ghost min-h-11 px-4 text-xs" onClick={() => (setDraft(toDraft(cfg)), setMsg(''))}>
              Annuler les changements
            </button>
          )}
          {msg && <span className="text-[11px] text-emerald-300">{msg}</span>}
        </div>
      )}
      {editable && dirty && problems.length > 0 && (
        <ul className="list-disc pl-5 text-[11px] text-amber-300">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
