import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment, useEffect, useState } from 'react'
import { db, scaleMax, type Criterion } from '../db'
import { deleteExpression, refreshExpressions, saveExpression, useExpressions } from '../expressions'
import { cleanTexte, sameTexte, type ExpressionCible, type ExpressionRow } from '../expressionsCore'
import { MAX_EXPRESSION, SENS, SENS_LABEL, type Sens } from '../dictation/avis'
import { Empty, groupBy } from '../components/ui'
import { ItemMenu, MenuButton, type MenuAnchor } from '../components/ItemMenu'
import { FormActions, FormWindow } from '../components/FormWindow'
import { ask } from '../components/Confirm'

/*
 * « Mes expressions » (/expressions) : le vocabulaire de l'entraîneur pour l'avis vocal (« teigneux » → Engagement,
 * Combativité, plutôt haut). Une carte : chaque expression en gras, ses critères dessous, ⋮ Modifier / Supprimer ;
 * « + Ajouter une expression ». Fenêtre centrée : le texte, puis 1 à 3 lignes « critère + sens » (critères notés sur une
 * échelle, par famille). Aussi créées depuis la fenêtre des propositions (« Retenir pour la prochaine fois »). Personnelles,
 * gardées sur l'appareil et sur le compte (src/expressions.ts). Retour : la flèche de l'en-tête (écran d'avant, tel quel).
 */

const ARROW: Record<Sens, string> = { haut: '↑', moyen: '=', bas: '↓' }

/** Critères qu'une expression peut viser : actifs, d'observation, notés sur une échelle (ceux que l'avis vocal envoie). */
const usable = (c: Criterion) => !c.deleted && c.active && c.kind === 'subjective' && scaleMax(c.scale) !== null

export default function Expressions() {
  const list = useExpressions()
  const criteria = useLiveQuery(async () => (await db.criteria.toArray()).filter(usable).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)), [])
  const [editing, setEditing] = useState<ExpressionRow | 'new' | null>(null)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; row: ExpressionRow } | null>(null)
  useEffect(() => refreshExpressions(), [])
  const labelOf = (id: string) => criteria?.find((c) => c.id === id)?.label
  if (!list || !criteria) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-lg font-extrabold">Mes expressions</h1>
        <p className="text-xs text-muted">Tes mots à toi. L’analyse en tient compte quand tu dictes un avis. Toi seul les vois.</p>
      </div>
      {list.length ? (
        <div className="card flex flex-col px-3">
          {list.map((r, i) => (
            <div key={r.id} className={`flex items-center gap-2 py-2.5 ${i ? 'border-t border-line' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold break-words">« {r.texte} »</div>
                <div className="text-xs text-muted">
                  →{' '}
                  {r.cibles.map((c, j) => (
                    <Fragment key={c.criterionId}>
                      {j > 0 && ' · '}
                      {labelOf(c.criterionId) ?? <i>critère retiré</i>}
                      <span className="ml-0.5" title={SENS_LABEL[c.sens]} aria-label={SENS_LABEL[c.sens]}>
                        {ARROW[c.sens]}
                      </span>
                    </Fragment>
                  ))}
                </div>
              </div>
              <MenuButton label={`Options de « ${r.texte} »`} open={menu?.row.id === r.id} onOpen={(anchor) => setMenu({ anchor, row: r })} />
            </div>
          ))}
        </div>
      ) : (
        <Empty>
          Aucune expression pour l’instant. Ajoute la première («&nbsp;teigneux&nbsp;», «&nbsp;valeureuse&nbsp;»…), ou coche «&nbsp;Retenir pour la prochaine fois&nbsp;» dans la fenêtre des
          propositions de l’avis vocal.
        </Empty>
      )}
      <button type="button" className="btn-soft" onClick={() => setEditing('new')}>
        + Ajouter une expression
      </button>
      {menu && (
        <ItemMenu
          anchor={menu.anchor}
          title={`« ${menu.row.texte} »`}
          items={[
            { label: 'Modifier', icon: 'pencil', onSelect: () => setEditing(menu.row) },
            {
              label: 'Supprimer',
              icon: 'trash',
              danger: true,
              onSelect: async () => {
                const r = menu.row
                if (await ask(`Supprimer l’expression « ${r.texte} » ? L’analyse n’en tiendra plus compte.`, { ok: 'Supprimer', focusCancel: true })) await deleteExpression(r.id)
              },
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {editing && <ExpressionWindow row={editing === 'new' ? undefined : editing} list={list} criteria={criteria} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** Ajouter ou modifier une expression : le texte, puis 1 à 3 lignes « critère + sens ». Fenêtre centrée. */
function ExpressionWindow({ row, list, criteria, onClose }: { row?: ExpressionRow; list: ExpressionRow[]; criteria: Criterion[]; onClose: () => void }) {
  const [texte, setTexte] = useState(row?.texte ?? '')
  const [cibles, setCibles] = useState<{ criterionId: string; sens: Sens }[]>(() => (row?.cibles.length ? row.cibles.map((c) => ({ ...c })) : [{ criterionId: '', sens: 'haut' }]))
  const [busy, setBusy] = useState(false)
  const families = groupBy(criteria, (c) => c.category)
  const valid: ExpressionCible[] = cibles.filter((c) => c.criterionId)
  const twin = cleanTexte(texte) ? list.find((r) => r.id !== row?.id && sameTexte(r.texte, texte)) : undefined
  const set = (i: number, patch: Partial<{ criterionId: string; sens: Sens }>) => setCibles((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      if (await saveExpression({ id: row?.id, texte, cibles: valid })) onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <FormWindow title={row ? 'Modifier l’expression' : 'Nouvelle expression'} onClose={onClose} phoneFull={false} width={480}>
      <form
        id="expression-form"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <label>
          <span className="label">Expression</span>
          <input
            className="field"
            value={texte}
            maxLength={MAX_EXPRESSION}
            autoFocus={!row}
            placeholder="teigneux, valeureuse, joue très personnel…"
            onChange={(e) => setTexte(e.target.value)}
          />
          {twin && <span className="mt-1 block text-[11px] text-muted">« {twin.texte} » existe déjà : elle sera remplacée.</span>}
        </label>
        <div className="flex flex-col gap-2">
          <span className="label mb-0">Critères visés</span>
          {cibles.map((c, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-lg bg-panel-2 p-2">
              <div className="flex items-center gap-2">
                <select className="field min-w-0 flex-1" aria-label={`Critère ${i + 1}`} value={c.criterionId} onChange={(e) => set(i, { criterionId: e.target.value })}>
                  <option value="">Choisir un critère…</option>
                  {families.map(([cat, cs]) => (
                    <optgroup key={cat} label={cat}>
                      {cs.map((x) => (
                        <option key={x.id} value={x.id} disabled={cibles.some((o, j) => j !== i && o.criterionId === x.id)}>
                          {x.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {cibles.length > 1 && (
                  <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:text-fg" aria-label={`Retirer le critère ${i + 1}`} onClick={() => setCibles((cs) => cs.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </div>
              <SensPicker value={c.sens} onChange={(sens) => set(i, { sens })} />
            </div>
          ))}
          {cibles.length < 3 && (
            <button type="button" className="inline-flex min-h-9 items-center self-start rounded-full border border-dashed border-line px-3 text-xs font-bold text-muted hover:text-fg" onClick={() => setCibles((cs) => [...cs, { criterionId: '', sens: 'haut' }])}>
              + un autre critère
            </button>
          )}
        </div>
      </form>
      <FormActions>
        <button type="submit" form="expression-form" className="btn-save" disabled={busy || !cleanTexte(texte) || !valid.length}>
          Enregistrer
        </button>
        <button type="button" className="btn-save-ghost" onClick={onClose}>
          Annuler
        </button>
      </FormActions>
    </FormWindow>
  )
}

/** Sens sur un critère : trois choix dans une pilule (comme Segmented, src/components/ui.tsx), chacun sur une ligne même sur téléphone. */
function SensPicker({ value, onChange }: { value: Sens; onChange: (s: Sens) => void }) {
  return (
    <div role="group" aria-label="Sens" className="grid grid-cols-[1.2fr_0.8fr_1.2fr] gap-[3px] rounded-full border border-line bg-panel p-[3px]">
      {SENS.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={value === s}
          onClick={() => onChange(s)}
          className={`min-h-8 min-w-0 rounded-full px-1 text-xs font-bold whitespace-nowrap transition ${value === s ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-fg/5 hover:text-fg'}`}
        >
          {SENS_LABEL[s]}
        </button>
      ))}
    </div>
  )
}
