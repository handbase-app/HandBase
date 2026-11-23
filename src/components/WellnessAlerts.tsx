import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Player } from '../db'
import type { FollowedGroup } from '../follows'
import { listGender, type Gender } from '../gender'
import { useRole } from '../roles'
import { WELLNESS_ITEMS } from '../wellness'
import { WELLNESS_LOW_MAX } from '../wellnessAlert'
import {
  ALERT_KINDS,
  concernedText,
  DAYS_CHOICES,
  DEFAULT_ALERT_NAME,
  DEFAULT_RULE,
  DROP_CHOICES,
  hitText,
  KIND_LABELS,
  MAX_CHOICES,
  noneText,
  notSharedText,
  ruleText,
  RULE_NAME_MAX,
  RULES_PER_ACCOUNT,
  type AlertKind,
  type AlertNote,
  type AlertRule,
  type MyAlerts,
  type WellnessAlertDef,
} from '../wellnessAlerts'
import { fetchMyAlerts, listAlertDefs, removeAlertDef, saveAlertDef } from '../wellnessAlertsApi'
import { AnchoredBubble } from './AnchoredBubble'
import { ask } from './Confirm'
import { pillClass } from './FilterWindow'
import { playerName } from './ui'
import type { AxisAnchor } from './ZoneRadar'

/*
 * « Mes suivis » : encart « Alertes wellness » (en haut, avec sa pastille) et fenêtre « Mes alertes wellness » (accrochée là
 * où on a touché, fond flouté) pour créer, modifier, allumer, éteindre ou supprimer plusieurs alertes. Règles et mots :
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

export function WellnessAlertsCard({ followed, players, groups }: { followed: ReadonlySet<string>; players: ReadonlyMap<string, Player>; groups: readonly FollowedGroup[] }) {
  const role = useRole()
  const staff = role === 'admin' || role === 'preparateur'
  const [defs, setDefs] = useState<WellnessAlertDef[] | null>(null)
  const [res, setRes] = useState<MyAlerts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [at, setAt] = useState<AxisAnchor | null>(null)
  const [showOthers, setShowOthers] = useState(false)

  // Groupes suivis de chaque suivi (cible d'une alerte) : seulement pour les fiches gardées sur l'appareil (essai).
  const followedList = useMemo(() => [...followed].map((id) => ({ id, groups: groups.filter((g) => g.group.playerIds.includes(id)).map((g) => g.group.id) })), [followed, groups])
  const key = followedList.map((p) => p.id).join()

  const load = useCallback(async () => {
    const d = await listAlertDefs()
    if (!d.ok) {
      setMissing(!!d.missing)
      setError(d.missing ? null : d.error)
      return
    }
    setDefs(d.value)
    const r = await fetchMyAlerts(d.value, followedList)
    if (!r.ok) {
      setMissing(!!r.missing)
      setError(r.missing ? null : r.error)
      return
    }
    setError(null)
    setRes(r.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (staff) void load()
  }, [staff, load])

  if (!staff || missing) return null
  if (error && !res) return <p className="text-[11px] text-muted">Alertes wellness : {error}</p>
  if (!defs || !res) return null
  // Wellness fermé sur l'installation : rien à montrer (ni à régler).
  if (!res.enabled) return null

  const byPlayer = new Map<string, { def: WellnessAlertDef; jours: number }[]>()
  for (const h of res.hits) {
    const def = defs.find((d) => d.id === h.alerte)
    if (!def || !players.has(h.playerId)) continue
    byPlayer.set(h.playerId, [...(byPlayer.get(h.playerId) ?? []), { def, jours: h.jours }])
  }
  const concerned = [...byPlayer.keys()].map((id) => players.get(id)!).sort((a, b) => playerName(a).localeCompare(playerName(b), 'fr'))
  const others = [...followed].filter((id) => players.has(id) && !res.readable.has(id)).map((id) => players.get(id)!).sort((a, b) => playerName(a).localeCompare(playerName(b), 'fr'))
  const g: Gender = listGender(undefined, concerned)
  const gOthers: Gender = listGender(undefined, others)
  const active = defs.filter((d) => d.actif)
  const groupName = (id: string) => groups.find((x) => x.group.id === id)?.group.name

  const open = (ev: React.MouseEvent<HTMLButtonElement>) => {
    const r = ev.currentTarget.getBoundingClientRect()
    setAt({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
  }
  const settingsButton = (
    <button type="button" className="min-h-9 shrink-0 px-2 text-[11px] font-bold text-accent" data-testid="alertes-wellness-regler" onClick={open}>
      Mes alertes wellness
    </button>
  )

  return (
    <>
      {concerned.length ? (
        <section className="card flex flex-col gap-2 border-spread-lo/60 p-3" data-testid="alertes-wellness">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-extrabold">
              Alertes wellness
              <span className="rounded-full bg-spread-lo px-1.5 py-px text-[10px] font-bold text-black" title={concernedText(concerned.length, g)}>
                {concerned.length}
              </span>
            </h2>
            {settingsButton}
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {concerned.map((p) => (
              <li key={p.id} className="flex flex-col gap-0.5 py-1.5">
                <Link to={`/joueurs/${p.id}?onglet=wellness`} className="text-sm font-bold hover:text-accent">
                  {playerName(p)} <span className="font-normal text-muted">›</span>
                </Link>
                {byPlayer.get(p.id)!.map(({ def, jours }) => (
                  <span key={def.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span>{hitText(def.regle, jours)}</span>
                    <span className="text-[10px] text-muted">
                      {def.nom}
                      {def.cible && groupName(def.cible) && (
                        <>
                          {' · '}
                          <Link to={`/groupes/${def.cible}/wellness`} className="hover:text-accent">
                            wellness de {groupName(def.cible)}
                          </Link>
                        </>
                      )}
                    </span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <OthersLine others={others} g={gOthers} open={showOthers} onToggle={() => setShowOthers(!showOthers)} />
        </section>
      ) : (
        <div className="-my-1 flex flex-col gap-0.5" data-testid="alertes-wellness-vide">
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
            <span>{active.length ? `Alertes wellness : ${noneText(listGender(undefined, [...followed].map((id) => players.get(id))))}` : 'Alertes wellness : aucune réglée.'}</span>
            {settingsButton}
          </div>
          <OthersLine others={others} g={gOthers} open={showOthers} onToggle={() => setShowOthers(!showOthers)} />
        </div>
      )}
      {at && (
        <AlertsBubble
          at={at}
          defs={defs}
          groups={groups}
          onChanged={() => void load()}
          onClose={() => setAt(null)}
        />
      )}
    </>
  )
}

/** Suivis dont le wellness n'est pas lu par ce compte : une ligne neutre, les noms à la demande (jamais une raison). */
function OthersLine({ others, g, open, onToggle }: { others: Player[]; g: Gender; open: boolean; onToggle: () => void }) {
  if (!others.length) return null
  return (
    <div className="text-[11px] text-muted">
      <button type="button" className="text-left hover:text-fg" aria-expanded={open} onClick={onToggle}>
        {notSharedText(others.length, g)} <span className="font-bold text-accent">{open ? 'Masquer' : 'Voir'}</span>
      </button>
      {open && <div className="mt-0.5">{others.map(playerName).join(' · ')}</div>}
    </div>
  )
}

/** Fenêtre « Mes alertes wellness » : la liste, allumer / éteindre, modifier, supprimer, ajouter ; l'alerte proposée. */
function AlertsBubble({ at, defs, groups, onChanged, onClose }: { at: AxisAnchor; defs: WellnessAlertDef[]; groups: readonly FollowedGroup[]; onChanged: () => void; onClose: () => void }) {
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
    <AnchoredBubble at={at} label="Mes alertes wellness" title="Mes alertes wellness" sub="Sur tes suivis dont tu lis le wellness · une notification le matin" onClose={onClose} testId="bulle-alertes-wellness">
      <div className="-mr-2 mt-2 flex max-h-[min(60vh,32rem)] w-full min-w-0 flex-col gap-2 overflow-y-auto pr-2 text-xs">
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
              <div key={d.id} className="flex items-start gap-2 rounded-lg border border-line p-2" data-testid="alerte-wellness-ligne">
                <button
                  type="button"
                  role="switch"
                  aria-checked={d.actif}
                  aria-label={d.actif ? `Éteindre « ${d.nom} »` : `Allumer « ${d.nom} »`}
                  className="mt-0.5 shrink-0"
                  onClick={() => void save({ ...d, actif: !d.actif })}
                >
                  <span className={`relative block h-5 w-9 rounded-full transition ${d.actif ? 'bg-accent' : 'bg-line'}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${d.actif ? 'left-4.5' : 'left-0.5'}`} />
                  </span>
                </button>
                <div className={`min-w-0 flex-1 ${d.actif ? '' : 'opacity-60'}`}>
                  <div className="font-bold">{d.nom}</div>
                  <div className="text-[11px] text-muted">{ruleText(d.regle)}</div>
                  <div className="text-[10px] text-muted">{groupName(d.cible)}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <button type="button" className="min-h-8 px-1 text-[11px] font-bold text-accent" onClick={() => setDraft({ ...d })}>
                    Modifier
                  </button>
                  <button type="button" className="min-h-8 px-1 text-[11px] text-muted hover:text-red-400" onClick={() => void remove(d)}>
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
            {suggested && (
              <div className="rounded-lg border border-dashed border-line p-2" data-testid="alerte-wellness-proposee">
                <div className="text-[10px] font-bold text-muted uppercase">Proposée</div>
                <div className="font-bold">🔋 {DEFAULT_ALERT_NAME}</div>
                <div className="text-[11px] text-muted">{ruleText(DEFAULT_RULE)} · Tous mes suivis</div>
                <button type="button" disabled={busy || list.length >= RULES_PER_ACCOUNT} className={`${pillClass(true, true)} mt-1.5`} onClick={() => void save({ nom: DEFAULT_ALERT_NAME, actif: true, regle: DEFAULT_RULE, cible: null })}>
                  Ajouter cette alerte
                </button>
              </div>
            )}
            {!list.length && !suggested && <p className="text-muted">Aucune alerte.</p>}
            <button
              type="button"
              disabled={list.length >= RULES_PER_ACCOUNT}
              className={`${pillClass(false)} self-start`}
              onClick={() => setDraft({ nom: '', actif: true, regle: DEFAULT_RULE, cible: null })}
            >
              + Nouvelle alerte
            </button>
            <p className="text-[10px] text-muted">
              Jours demandés : du lundi au vendredi, sans les jours fériés (ni les vacances scolaires quand la zone est réglée). Seuls tes suivis dont tu lis déjà le wellness comptent.
            </p>
          </>
        )}
        {err && <p className="text-[11px] text-red-400">{err}</p>}
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
      <div className="mb-1 text-[10px] font-bold text-muted">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
  return (
    <div className="flex flex-col gap-2" data-testid="alerte-wellness-reglage">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-bold text-muted">Nom</span>
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
          <button key={k} type="button" className={pillClass(r.type === k)} aria-pressed={r.type === k} onClick={() => setRule(ruleOfKind(k, r))}>
            {KIND_LABELS[k]}
          </button>
        )),
      )}
      {(r.type === 'seuil' || r.type === 'chute') &&
        row(
          'Note suivie',
          NOTES.map((n) => (
            <button key={n.key} type="button" className={pillClass(r.note === n.key)} aria-pressed={r.note === n.key} onClick={() => setRule({ ...r, note: n.key })}>
              {n.label}
            </button>
          )),
        )}
      {r.type === 'seuil' &&
        row(
          'À … ou moins',
          MAX_CHOICES.map((v) => (
            <button key={v} type="button" className={pillClass(r.max === v)} aria-pressed={r.max === v} onClick={() => setRule({ ...r, max: v })}>
              {v}
            </button>
          )),
        )}
      {r.type === 'chute' &&
        row(
          'Baisse d’au moins … points (sur sa moyenne des 14 jours d’avant)',
          DROP_CHOICES.map((v) => (
            <button key={v} type="button" className={pillClass(r.baisse === v)} aria-pressed={r.baisse === v} onClick={() => setRule({ ...r, baisse: v })}>
              {v}
            </button>
          )),
        )}
      {row(
        'Jours demandés de suite',
        DAYS_CHOICES.map((v) => (
          <button key={v} type="button" className={pillClass(r.jours === v)} aria-pressed={r.jours === v} onClick={() => setRule({ ...r, jours: v })}>
            {v}
          </button>
        )),
      )}
      {row(
        'Pour',
        [
          <button key="tous" type="button" className={pillClass(!draft.cible)} aria-pressed={!draft.cible} onClick={() => onChange({ ...draft, cible: null })}>
            Tous mes suivis
          </button>,
          ...groups.map(({ group: g }) => (
            <button key={g.id} type="button" className={pillClass(draft.cible === g.id)} aria-pressed={draft.cible === g.id} onClick={() => onChange({ ...draft, cible: g.id })}>
              {g.name}
            </button>
          )),
        ],
      )}
      <p className="text-[11px] text-muted">{ruleText(r)}</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} className={pillClass(true)} onClick={onSave}>
          Enregistrer
        </button>
        <button type="button" className={pillClass(false)} onClick={onCancel}>
          Annuler
        </button>
      </div>
    </div>
  )
}
