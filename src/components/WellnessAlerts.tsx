import { useState } from 'react'
import type { FollowedGroup } from '../follows'
import { WELLNESS_ITEMS } from '../wellness'
import { WELLNESS_LOW_MAX } from '../wellnessAlert'
import {
  ALERT_KINDS,
  DAYS_CHOICES,
  DEFAULT_ALERT_NAME,
  DEFAULT_RULE,
  DROP_CHOICES,
  KIND_LABELS,
  MAX_CHOICES,
  ruleText,
  RULE_NAME_MAX,
  RULES_PER_ACCOUNT,
  type AlertKind,
  type AlertNote,
  type AlertRule,
  type WellnessAlertDef,
} from '../wellnessAlerts'
import { removeAlertDef, saveAlertDef } from '../wellnessAlertsApi'
import { AnchoredBubble } from './AnchoredBubble'
import { ask } from './Confirm'
import { pillClass } from './FilterWindow'
import type { AxisAnchor } from './ZoneRadar'

/*
 * Fenêtre « Mes alertes wellness » (accrochée là où on a touché, fond flouté) pour créer, modifier, allumer, éteindre ou
 * supprimer plusieurs alertes ; ouverte depuis la page « Alertes wellness » (src/pages/WellnessAlerts.tsx). Règles et mots :
 * src/wellnessAlerts.ts ; données : src/wellnessAlertsApi.ts (le serveur calcule, rien n'est gardé sur l'appareil).
 * Seulement pour le staff (administrateur, encadrant) : un observateur ne lit jamais le wellness.
 */

type Draft = Omit<WellnessAlertDef, 'id'> & { id?: string }
const NOTES: readonly { key: AlertNote; label: string }[] = [{ key: 'moyenne', label: 'moyenne des notes' }, ...WELLNESS_ITEMS.map((x) => ({ key: x.key, label: x.short.toLowerCase() }))]
const sameRule = (a: AlertRule, b: AlertRule) => JSON.stringify(a) === JSON.stringify(b)

/** Règle d'une autre sorte, en gardant ce qui peut l'être (note, jours). */
function ruleOfKind(kind: AlertKind, from: AlertRule): AlertRule {
  const note = 'note' in from ? from.note : 'moyenne'
  switch (kind) {
    case 'seuil':
      return { type: 'seuil', note, max: from.type === 'seuil' ? from.max : WELLNESS_LOW_MAX, jours: from.jours }
    case 'chute':
      return { type: 'chute', note, baisse: from.type === 'chute' ? from.baisse : 3, jours: from.jours }
    default:
      return { type: kind, jours: from.jours }
  }
}

/** Pastilles de la fenêtre « Mes alertes wellness » : un peu plus grosses que celles des filtres. */
const bigPill = (on: boolean, small?: boolean) => `${pillClass(on, small)} min-h-10! px-3! text-sm!`

/** Fenêtre « Mes alertes wellness » : la liste, allumer / éteindre, modifier, supprimer, ajouter ; l'alerte proposée. */
export function AlertsBubble({ at, defs, groups, onChanged, onClose }: { at: AxisAnchor; defs: WellnessAlertDef[]; groups: readonly FollowedGroup[]; onChanged: () => void; onClose: () => void }) {
  const [list, setList] = useState(defs)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const suggested = !list.some((d) => sameRule(d.regle, DEFAULT_RULE) && !d.cible)
  const groupName = (id: string | null) => (id ? (groups.find((x) => x.group.id === id)?.group.name ?? 'groupe plus suivi') : 'Tous mes suivis')

  async function save(d: Draft) {
    setBusy(true)
    const r = await saveAlertDef(d)
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setErr(null)
    setList((l) => (d.id ? l.map((x) => (x.id === d.id ? r.value : x)) : [...l, r.value]))
    setDraft(null)
    onChanged()
  }
  async function remove(d: WellnessAlertDef) {
    if (!(await ask(`Supprimer l’alerte « ${d.nom} » ?`, { ok: 'Supprimer', danger: true, focusCancel: true }))) return
    const r = await removeAlertDef(d.id)
    if (!r.ok) return setErr(r.error)
    setList((l) => l.filter((x) => x.id !== d.id))
    onChanged()
  }

  return (
    <AnchoredBubble at={at} label="Mes alertes wellness" title="Mes alertes wellness" sub="Sur tes suivis dont tu lis le wellness · une notification le matin" onClose={onClose} testId="bulle-alertes-wellness" wide>
      <div className="-mr-2 mt-2 flex max-h-[42rem] min-h-0 w-full flex-1 min-w-0 flex-col gap-2 overflow-y-auto pr-2 text-sm">
        {draft ? (
          <AlertEditor
            draft={draft}
            groups={groups}
            busy={busy}
            onChange={setDraft}
            // Sans nom : celui de la sorte (« Douleur signalée »…).
            onSave={() => void save({ ...draft, nom: draft.nom.trim() || KIND_LABELS[draft.regle.type] })}
            onCancel={() => setDraft(null)}
          />
        ) : (
          <>
            {list.map((d) => (
              <div key={d.id} className="flex items-start gap-2 rounded-lg border border-line p-2.5" data-testid="alerte-wellness-ligne">
                <button
                  type="button"
                  role="switch"
                  aria-checked={d.actif}
                  aria-label={d.actif ? `Éteindre « ${d.nom} »` : `Allumer « ${d.nom} »`}
                  className="mt-0.5 shrink-0"
                  onClick={() => void save({ ...d, actif: !d.actif })}
                >
                  <span className={`relative block h-6 w-11 rounded-full transition ${d.actif ? 'bg-accent' : 'bg-line'}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${d.actif ? 'left-5.5' : 'left-0.5'}`} />
                  </span>
                </button>
                <div className={`min-w-0 flex-1 ${d.actif ? '' : 'opacity-60'}`}>
                  <div className="font-bold">{d.nom}</div>
                  <div className="text-xs text-muted">{ruleText(d.regle)}</div>
                  <div className="text-[11px] text-muted">{groupName(d.cible)}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <button type="button" className="min-h-9 px-1.5 text-sm font-bold text-accent" onClick={() => setDraft({ ...d })}>
                    Modifier
                  </button>
                  <button type="button" className="min-h-9 px-1.5 text-sm text-muted hover:text-red-400" onClick={() => void remove(d)}>
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
            {suggested && (
              <div className="rounded-lg border border-dashed border-line p-2.5" data-testid="alerte-wellness-proposee">
                <div className="text-[11px] font-bold text-muted uppercase">Proposée</div>
                <div className="font-bold">🔋 {DEFAULT_ALERT_NAME}</div>
                <div className="text-xs text-muted">{ruleText(DEFAULT_RULE)} · Tous mes suivis</div>
                <button type="button" disabled={busy || list.length >= RULES_PER_ACCOUNT} className={`${bigPill(true, true)} mt-1.5`} onClick={() => void save({ nom: DEFAULT_ALERT_NAME, actif: true, regle: DEFAULT_RULE, cible: null })}>
                  Ajouter cette alerte
                </button>
              </div>
            )}
            {!list.length && !suggested && <p className="text-muted">Aucune alerte.</p>}
            <button
              type="button"
              disabled={list.length >= RULES_PER_ACCOUNT}
              className={`${bigPill(false)} self-start`}
              onClick={() => setDraft({ nom: '', actif: true, regle: DEFAULT_RULE, cible: null })}
            >
              + Nouvelle alerte
            </button>
            <p className="text-[11px] text-muted">
              Jours demandés : du lundi au vendredi, sans les jours fériés (ni les vacances scolaires quand la zone est réglée). Seuls tes suivis dont tu lis déjà le wellness comptent.
            </p>
          </>
        )}
        {err && <p className="text-xs text-red-400">{err}</p>}
      </div>
    </AnchoredBubble>
  )
}

/** Réglage d'une alerte : nom, sorte, note, seuil ou baisse, jours de suite, cible. */
function AlertEditor({ draft, groups, busy, onChange, onSave, onCancel }: { draft: Draft; groups: readonly FollowedGroup[]; busy: boolean; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const r = draft.regle
  const setRule = (regle: AlertRule) => onChange({ ...draft, regle })
  const row = (label: string, children: React.ReactNode) => (
    <div>
      <div className="mb-1 text-xs font-bold text-muted">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
  return (
    <div className="flex flex-col gap-2" data-testid="alerte-wellness-reglage">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-bold text-muted">Nom</span>
        <input
          className="field"
          value={draft.nom}
          maxLength={RULE_NAME_MAX}
          placeholder={KIND_LABELS[r.type]}
          onChange={(e) => onChange({ ...draft, nom: e.target.value })}
        />
      </label>
      {row(
        'Ce qu’elle surveille',
        ALERT_KINDS.map((k) => (
          <button key={k} type="button" className={bigPill(r.type === k)} aria-pressed={r.type === k} onClick={() => setRule(ruleOfKind(k, r))}>
            {KIND_LABELS[k]}
          </button>
        )),
      )}
      {(r.type === 'seuil' || r.type === 'chute') &&
        row(
          'Note suivie',
          NOTES.map((n) => (
            <button key={n.key} type="button" className={bigPill(r.note === n.key)} aria-pressed={r.note === n.key} onClick={() => setRule({ ...r, note: n.key })}>
              {n.label}
            </button>
          )),
        )}
      {r.type === 'seuil' &&
        row(
          'À … ou moins',
          MAX_CHOICES.map((v) => (
            <button key={v} type="button" className={bigPill(r.max === v)} aria-pressed={r.max === v} onClick={() => setRule({ ...r, max: v })}>
              {v}
            </button>
          )),
        )}
      {r.type === 'chute' &&
        row(
          'Baisse d’au moins … points (sur sa moyenne des 14 jours d’avant)',
          DROP_CHOICES.map((v) => (
            <button key={v} type="button" className={bigPill(r.baisse === v)} aria-pressed={r.baisse === v} onClick={() => setRule({ ...r, baisse: v })}>
              {v}
            </button>
          )),
        )}
      {row(
        'Jours demandés de suite',
        DAYS_CHOICES.map((v) => (
          <button key={v} type="button" className={bigPill(r.jours === v)} aria-pressed={r.jours === v} onClick={() => setRule({ ...r, jours: v })}>
            {v}
          </button>
        )),
      )}
      {row(
        'Pour',
        [
          <button key="tous" type="button" className={bigPill(!draft.cible)} aria-pressed={!draft.cible} onClick={() => onChange({ ...draft, cible: null })}>
            Tous mes suivis
          </button>,
          ...groups.map(({ group: g }) => (
            <button key={g.id} type="button" className={bigPill(draft.cible === g.id)} aria-pressed={draft.cible === g.id} onClick={() => onChange({ ...draft, cible: g.id })}>
              {g.name}
            </button>
          )),
        ],
      )}
      <p className="text-xs text-muted">{ruleText(r)}</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} className={bigPill(true)} onClick={onSave}>
          Enregistrer
        </button>
        <button type="button" className={bigPill(false)} onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  )
}
