import { useEffect, useId, useMemo, useState } from 'react'
import { newId, plural, remove, save, saveMany, type Assignment, type ConfigItem, type Level, type Unit } from '../db'
import { useAssignments, useConfigRows, useLevels, useSportConfig, useUnits } from '../installation'
import { departmentLabel, useDepartments } from '../lists'
import { ROLE_LABEL, type Role } from '../roles'
import { CONFIG_KEYS, HANDBALL, type PositionDef } from '../sportConfig'
import { findUnits } from '../structureImport'
import {
  ancestors,
  ASSIGNMENT_ROLES,
  assignmentsIn,
  buildTree,
  deleteBlocker,
  flatten,
  HANDBALL_LEVELS,
  levelInUse,
  parentChoices,
  subtreeCounts,
  wouldCycle,
  type TreeNode,
} from '../structureTree'
import { supabase } from '../sync'
import { ask, inform } from './Confirm'
import { StructureImport } from './StructureImport'
import { fold } from './PlayerFilter'
import { useOnline } from './TransferGroup'
import { SectionTitle } from './ui'
import { isPoleUnit } from '../poleSeason'
import { POLE_PROGRAMMES } from '../db'

/*
 * Réglages > « Structure et sport » (supabase/044_structure.sql) : postes du sport, niveaux, arbre des unités et
 * affectations. Modifiable par les administrateurs ; lecture seule pour les autres comptes.
 * ÉTAPE 1 : rien de tout cela ne change encore qui voit quoi (les droits restent ceux de src/roles.ts).
 */

const TAP = 'min-h-11 min-w-11'
/** Au-delà, l'arbre est replié au départ (structure importée : des milliers d'unités). */
const SMALL_TREE = 40

export function StructureSettings({ editable }: { editable: boolean }) {
  return (
    <>
      <p className="text-[11px] text-muted">
        Préparation : la structure et les affectations sont enregistrées, mais ne changent pas encore qui voit quoi (le secteur
        d’un encadrant reste ses départements, dans Utilisateurs).
      </p>
      <SportSection editable={editable} />
      <LevelsSection editable={editable} />
      <UnitsSection editable={editable} />
    </>
  )
}

// ---------- Sport : postes ----------

function SportSection({ editable }: { editable: boolean }) {
  const cfg = useSportConfig()
  // Configuration changée (ici ou sur un autre appareil) : le brouillon repart de la nouvelle version.
  return <PositionsEditor key={JSON.stringify(cfg.positions)} editable={editable} />
}

function PositionsEditor({ editable }: { editable: boolean }) {
  const cfg = useSportConfig()
  const rows = useConfigRows()
  const stored = rows.some((r) => r.id === CONFIG_KEYS.positions)
  const [draft, setDraft] = useState<PositionDef[]>(cfg.positions)
  const sig = JSON.stringify(cfg.positions)
  const changed = JSON.stringify(draft) !== sig
  const valid = draft.every((p) => p.label.trim() && p.short.trim())
  const set = (i: number, patch: Partial<PositionDef>) => setDraft(draft.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= draft.length) return
    const next = [...draft]
    ;[next[i], next[j]] = [next[j], next[i]]
    setDraft(next.map((p, k) => ({ ...p, order: k + 1 })))
  }

  async function submit() {
    const value = draft.map((p, k) => ({ ...p, label: p.label.trim(), short: p.short.trim(), order: k + 1 }))
    await save<ConfigItem>('config', { id: CONFIG_KEYS.positions, key: CONFIG_KEYS.positions, value })
  }

  return (
    <section className="card flex flex-col gap-2 p-4">
      <SectionTitle info="Libellés affichés partout (fiches, listes, filtres, exports, questions). Les codes sont ceux enregistrés dans les fiches : ils ne changent jamais.">
        Sport : {cfg.sportName}
      </SectionTitle>
      <Fold summary={`Postes : ${cfg.positions.map((p) => p.short || p.code).join(' · ')}`} editable={editable} keepOpen={changed}>
      <p className="text-[11px] text-muted">
        Postes. Les codes ({draft.map((p) => p.code).join(', ')}) restent les mêmes : seuls le libellé, le libellé court, l’ordre
        et la famille (gardien / champ) se règlent.
      </p>
      <div className="divide-y divide-line rounded-lg border border-line">
        {draft.map((p, i) => (
          <div key={p.code} className="flex flex-col gap-1.5 p-2">
            <div className="flex items-center gap-2">
              <span className="w-11 shrink-0 text-center text-xs font-bold text-muted">{p.code}</span>
              {editable ? (
                <input className="field min-h-11 flex-1 py-1 text-xs" value={p.label} aria-label={`Libellé ${p.code}`} onChange={(e) => set(i, { label: e.target.value })} />
              ) : (
                <span className="flex-1 text-sm">{p.label}</span>
              )}
              {editable && (
                <>
                  <button className={`btn-ghost ${TAP} px-0 text-xs`} disabled={i === 0} aria-label="Monter" onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button className={`btn-ghost ${TAP} px-0 text-xs`} disabled={i === draft.length - 1} aria-label="Descendre" onClick={() => move(i, 1)}>
                    ↓
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 pl-[52px]">
              {editable ? (
                <input className="field min-h-11 flex-1 py-1 text-xs" value={p.short} aria-label={`Libellé court ${p.code}`} placeholder="Libellé court" onChange={(e) => set(i, { short: e.target.value })} />
              ) : (
                <span className="flex-1 text-xs text-muted">{p.short}</span>
              )}
              <button
                className={`${TAP} shrink-0 rounded-md border px-3 text-[11px] font-bold ${p.family === 'gardien' ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-panel-2 text-muted'}`}
                disabled={!editable}
                title="Famille : un gardien n’est pas évalué sur les critères des joueurs de champ"
                onClick={() => set(i, { family: p.family === 'gardien' ? 'champ' : 'gardien' })}
              >
                {p.family === 'gardien' ? 'Gardien' : 'Champ'}
              </button>
            </div>
          </div>
        ))}
      </div>
      {editable && (
        <div className="flex flex-wrap gap-2">
          <button className={`btn-primary ${TAP} flex-1 text-xs`} disabled={!changed || !valid} onClick={() => void submit()}>
            Enregistrer les postes
          </button>
          {changed && (
            <button className={`btn-ghost ${TAP} text-xs`} onClick={() => setDraft(JSON.parse(sig) as PositionDef[])}>
              Annuler
            </button>
          )}
          {stored && !changed && (
            <button
              className={`btn-ghost ${TAP} text-xs`}
              onClick={async () => {
                if (await ask(`Revenir aux postes par défaut (${HANDBALL.sportName}) ?`, { ok: 'Revenir', danger: false })) await remove('config', CONFIG_KEYS.positions)
              }}
            >
              Valeurs par défaut
            </button>
          )}
        </div>
      )}
      </Fold>
    </section>
  )
}

// ---------- Niveaux ----------

function LevelsSection({ editable }: { editable: boolean }) {
  const levels = useLevels()
  const units = useUnits()
  const [name, setName] = useState('')

  async function add() {
    const n = name.trim()
    if (!n) return
    await save<Level>('levels', { id: newId(), name: n, order: Math.max(0, ...levels.map((l) => l.order)) + 1 })
    setName('')
  }
  async function move(i: number, d: -1 | 1) {
    const j = i + d
    if (j < 0 || j >= levels.length) return
    const next = [...levels]
    ;[next[i], next[j]] = [next[j], next[i]]
    await saveMany<Level>('levels', next.map((l, k) => ({ ...l, order: k + 1 })).filter((l, k) => l.order !== levels[k].order || l.id !== levels[k].id))
  }

  return (
    <section className="card flex flex-col gap-2 p-4">
      <SectionTitle info="Les échelons de l’organisation, du plus large au plus local (Fédération, Ligue, Comité, Pôle, Club…). L’ordre sert à ranger l’arbre ; une unité peut être rattachée à n’importe quel niveau au-dessus (un pôle directement à la ligue).">
        Niveaux
      </SectionTitle>
      <Fold summary={levels.map((l) => l.name).join(' › ')} editable={editable} keepOpen={!levels.length}>
      <div className="divide-y divide-line rounded-lg border border-line">
        {levels.map((l, i) => (
          <LevelRow key={`${l.id}:${l.name}`} l={l} editable={editable} used={levelInUse(units, l.id)} first={i === 0} last={i === levels.length - 1} onMove={(d) => void move(i, d)} />
        ))}
        {!levels.length && <div className="p-3 text-center text-xs text-muted">Aucun niveau.</div>}
      </div>
      {editable && !levels.length && (
        <button className={`btn-ghost ${TAP} text-xs`} onClick={() => void saveMany<Level>('levels', HANDBALL_LEVELS)}>
          Proposer les niveaux du handball ({HANDBALL_LEVELS.map((l) => l.name).join(', ')})
        </button>
      )}
      {editable && (
        <div className="flex gap-2">
          <input className="field min-h-11 py-1.5 text-xs" placeholder="Nouveau niveau…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
          <button className={`btn-primary ${TAP} shrink-0 px-3 text-xs`} disabled={!name.trim()} onClick={() => void add()}>
            Ajouter
          </button>
        </div>
      )}
      </Fold>
    </section>
  )
}

/** Réglage rarement modifié (rempli d'avance pour le handball) : une ligne résumé, dépliée à la demande. */
function Fold({ summary, editable, keepOpen, children }: { summary: string; editable: boolean; keepOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (keepOpen) return <>{children}</>
  return (
    <>
      <button className={`btn-ghost ${TAP} justify-between gap-2 text-left text-xs`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="truncate">{summary}</span>
        <span className="shrink-0 text-muted">{open ? 'Replier' : editable ? 'Modifier' : 'Voir'}</span>
      </button>
      {open && children}
    </>
  )
}

function LevelRow({ l, editable, used, first, last, onMove }: { l: Level; editable: boolean; used: number; first: boolean; last: boolean; onMove: (d: -1 | 1) => void }) {
  const [name, setName] = useState(l.name)
  const changed = !!name.trim() && name.trim() !== l.name
  const rename = () => changed && void save<Level>('levels', { ...l, name: name.trim() })
  if (!editable)
    return (
      <div className="flex items-center justify-between px-3 py-2 text-sm">
        {l.name} <span className="text-[11px] text-muted">{used ? plural(used, 'unité') : ''}</span>
      </div>
    )
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5">
      <input className="field min-h-11 flex-1 py-1 text-xs" value={name} aria-label="Nom du niveau" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} />
      {changed && (
        <button className={`btn-primary ${TAP} shrink-0 px-2 text-[11px]`} onClick={rename}>
          OK
        </button>
      )}
      <button className={`btn-ghost ${TAP} shrink-0 px-0 text-xs`} disabled={first} aria-label="Monter" onClick={() => onMove(-1)}>
        ↑
      </button>
      <button className={`btn-ghost ${TAP} shrink-0 px-0 text-xs`} disabled={last} aria-label="Descendre" onClick={() => onMove(1)}>
        ↓
      </button>
      <button
        className={`${TAP} shrink-0 text-muted hover:text-red-400 disabled:opacity-30`}
        title={used ? `Utilisé par ${plural(used, 'unité')}` : 'Supprimer le niveau'}
        aria-label="Supprimer le niveau"
        disabled={used > 0}
        onClick={async () => {
          if (await ask(`Supprimer le niveau « ${l.name} » ?`, { ok: 'Supprimer' })) await remove('levels', l.id)
        }}
      >
        ✕
      </button>
    </div>
  )
}

// ---------- Unités et affectations ----------

interface Member {
  user_id: string
  full_name: string | null
  email: string | null
  role: Role | null
}
const memberName = (m: Member) => m.full_name || m.email || 'Sans nom'

/** Comptes existants (hb_members, en ligne) : administrateurs seulement. */
function useMembers(enabled: boolean) {
  const online = useOnline()
  const [list, setList] = useState<Member[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!enabled || !supabase || !online || list) return
    void supabase.rpc('hb_members').then(({ data, error }) => {
      if (error) setErr(`Liste des comptes indisponible : ${error.message}`)
      else setList((data as Member[]).filter((m) => !!m.role))
    })
  }, [enabled, online, list])
  return { list, err, online }
}

function UnitsSection({ editable }: { editable: boolean }) {
  const levels = useLevels()
  const units = useUnits()
  const assignments = useAssignments()
  const [open, setOpen] = useState<string | null>(null)
  // Unités dépliées. Petit arbre (saisi à la main) : tout est déplié ; grand arbre (import) : tout est replié au départ.
  const [expanded, setExpanded] = useState<Set<string> | null>(null)
  const [q, setQ] = useState('')
  const tree = useMemo(() => buildTree(units, levels), [units, levels])
  const counts = useMemo(() => subtreeCounts(tree), [tree])
  const peopleBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of assignments) m.set(a.unitId, (m.get(a.unitId) ?? 0) + 1)
    return m
  }, [assignments])
  const small = units.length <= SMALL_TREE
  const isExpanded = (id: string) => (expanded ? expanded.has(id) : small)
  // Lignes visibles seulement (une unité repliée ne dessine pas ses milliers de sous-unités).
  const rows = useMemo(() => {
    const out: { unit: Unit; depth: number; kids: number }[] = []
    const walk = (ns: TreeNode<Unit>[]) => {
      for (const n of ns) {
        out.push({ unit: n.unit, depth: n.depth, kids: n.children.length })
        if (n.children.length && (expanded ? expanded.has(n.unit.id) : small)) walk(n.children)
      }
    }
    walk(tree)
    return out
  }, [tree, expanded, small])
  const levelName = (id: string) => levels.find((l) => l.id === id)?.name ?? 'Niveau supprimé'
  const members = useMembers(editable)
  const found = useMemo(() => findUnits(units, q), [units, q])

  const toggle = (id: string) => {
    const next = new Set(expanded ?? (small ? flatten(tree).map((r) => r.unit.id) : []))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }
  /** Montre une unité trouvée : ses parents dépliés, sa fiche ouverte. */
  const reveal = (id: string) => {
    const next = new Set(expanded ?? (small ? flatten(tree).map((r) => r.unit.id) : []))
    ancestors(units, id).forEach((a) => next.add(a.id))
    setExpanded(next)
    setOpen(id)
    setQ('')
    setTimeout(() => document.getElementById(`unite-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
  }
  const path = (u: Unit) =>
    ancestors(units, u.id)
      .reverse()
      .map((a) => a.name)
      .join(' › ')

  return (
    <section className="card flex flex-col gap-2 p-4">
      <SectionTitle info="L’arbre de l’organisation : chaque unité (une ligue, un comité, un pôle…) a un niveau, une unité parente (sauf en tête), un territoire facultatif (départements) et des personnes affectées, chacune avec son rôle. Une personne peut être affectée à plusieurs unités.">
        Unités{units.length ? ` (${units.length.toLocaleString('fr-FR')})` : ''}
      </SectionTitle>
      {editable && <StructureImport />}
      {units.length > SMALL_TREE / 2 && (
        <div className="flex flex-col gap-1">
          <input className="field min-h-11 py-1.5 text-xs" placeholder="Trouver une unité : nom, ville, code postal, numéro…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Trouver une unité" />
          {q.trim() && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
              {found.map((u) => (
                <button key={u.id} className="flex min-h-11 w-full flex-col justify-center border-b border-line px-3 py-1 text-left last:border-0" onClick={() => reveal(u.id)}>
                  <span className="truncate text-sm font-bold">{u.name}</span>
                  <span className="truncate text-[11px] text-muted">{[levelName(u.levelId), u.city, path(u)].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
              {!found.length && <div className="p-3 text-center text-xs text-muted">Aucune unité ne correspond.</div>}
              {found.length >= 30 && <div className="p-2 text-center text-[11px] text-muted">30 premières : précise la recherche.</div>}
            </div>
          )}
        </div>
      )}
      <div className="divide-y divide-line rounded-lg border border-line">
        {rows.map(({ unit, depth, kids }) => {
          const people = peopleBy.get(unit.id) ?? 0
          const isOpen = open === unit.id
          const sub = counts.get(unit.id) ?? 0
          return (
            <div key={unit.id} id={`unite-${unit.id}`}>
              <div className={`flex items-center ${isOpen ? 'bg-accent/10' : ''}`} style={{ paddingLeft: 4 + Math.min(depth, 5) * 14 }}>
                {kids ? (
                  <button
                    className={`${TAP} flex shrink-0 items-center justify-center text-muted`}
                    aria-label={isExpanded(unit.id) ? `Replier ${unit.name}` : `Déplier ${unit.name}`}
                    aria-expanded={isExpanded(unit.id)}
                    onClick={() => toggle(unit.id)}
                  >
                    <span className={`transition ${isExpanded(unit.id) ? 'rotate-90' : ''}`}>▸</span>
                  </button>
                ) : (
                  <span className="w-11 shrink-0 text-center text-muted">{depth > 0 ? '·' : ''}</span>
                )}
                <button className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-1.5 pr-3 text-left" onClick={() => setOpen(isOpen ? null : unit.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{unit.name}</span>
                    <span className="block truncate text-[11px] text-muted">
                      {[
                        levelName(unit.levelId),
                        unit.departments?.length ? unit.departments.join(', ') : '',
                        unit.city ?? '',
                        sub ? plural(sub, 'sous-unité') : '',
                        people ? plural(people, 'personne') : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className={`text-muted transition ${isOpen ? 'rotate-90' : ''}`}>›</span>
                </button>
              </div>
              {isOpen && <UnitDetail unit={unit} editable={editable} members={members} onDeleted={() => setOpen(null)} onOpen={(id) => reveal(id)} />}
            </div>
          )
        })}
        {!rows.length && <div className="p-3 text-center text-xs text-muted">Aucune unité pour l’instant.</div>}
      </div>
      {editable && <NewUnit parentId={undefined} onCreated={setOpen} />}
    </section>
  )
}

/** Nouvelle unité (en tête, ou sous une unité). */
function NewUnit({ parentId, onCreated }: { parentId?: string; onCreated: (id: string) => void }) {
  const levels = useLevels()
  const units = useUnits()
  const parent = units.find((u) => u.id === parentId)
  // Niveau proposé : celui qui suit le niveau du parent (ou le premier).
  const pi = levels.findIndex((l) => l.id === parent?.levelId)
  const [levelId, setLevelId] = useState('')
  const [name, setName] = useState('')
  const lvl = levelId || levels[parent ? Math.min(pi + 1, levels.length - 1) : 0]?.id || ''
  async function add() {
    const n = name.trim()
    if (!n || !lvl) return
    const id = newId()
    await save<Unit>('units', { id, name: n, levelId: lvl, ...(parentId ? { parentId } : {}) })
    setName('')
    onCreated(id)
  }
  if (!levels.length) return <p className="text-[11px] text-muted">Crée d’abord au moins un niveau.</p>
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] font-bold text-muted">{parent ? `Nouvelle sous-unité de « ${parent.name} »` : 'Nouvelle unité de tête'}</div>
      <div className="flex flex-wrap gap-2">
        <select className="field min-h-11 w-full py-1 text-xs sm:w-32 sm:shrink-0" value={lvl} aria-label="Niveau" onChange={(e) => setLevelId(e.target.value)}>
          {levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <input className="field min-h-11 min-w-0 flex-1 py-1.5 text-xs" placeholder="Nom…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <button className={`btn-primary ${TAP} shrink-0 px-3 text-xs`} disabled={!name.trim()} onClick={() => void add()}>
          Ajouter
        </button>
      </div>
    </div>
  )
}

function UnitDetail({
  unit,
  editable,
  members,
  onDeleted,
  onOpen,
}: {
  unit: Unit
  editable: boolean
  members: ReturnType<typeof useMembers>
  onDeleted: () => void
  onOpen: (id: string) => void
}) {
  const levels = useLevels()
  const units = useUnits()
  const assignments = useAssignments()
  const people = assignmentsIn(assignments, unit.id)
  const indent = useMemo(() => new Map(flatten(buildTree(units, levels)).map((r, i) => [r.unit.id, { depth: r.depth, pos: i }])), [units, levels])
  // Parents possibles, dans l'ordre de l'arbre. Grand arbre (import) : seulement les niveaux au-dessus (sinon des milliers de
  // clubs dans la liste), plus le parent actuel.
  const parents = useMemo(() => {
    const rank = new Map(levels.map((l, i) => [l.id, i]))
    const mine = rank.get(unit.levelId)
    return parentChoices(units, unit.id)
      .filter((u) => units.length <= SMALL_TREE || mine === undefined || u.id === unit.parentId || (rank.get(u.levelId) ?? -1) < mine)
      .sort((a, b) => (indent.get(a.id)?.pos ?? 0) - (indent.get(b.id)?.pos ?? 0))
  }, [units, levels, unit.id, unit.levelId, unit.parentId, indent])
  const blocker = deleteBlocker(units, assignments, unit.id)
  const update = (patch: Partial<Unit>) => save<Unit>('units', { ...unit, ...patch })

  const club = <ClubInfo unit={unit} />
  const pole = isPoleUnit(unit, levels)
  if (!editable)
    return (
      <div className="flex flex-col gap-1 bg-panel-2/50 px-4 py-3 text-xs">
        {club}
        {pole && <PoleInfo unit={unit} />}
        {unit.departments?.length ? <div>Territoire : {unit.departments.map((d) => departmentLabel(d)).join(', ')}</div> : null}
        {people.length ? (
          people.map((a) => (
            <div key={a.id}>
              {a.userName ?? 'Compte'} · <span className="text-muted">{ROLE_LABEL[a.role]}</span>
            </div>
          ))
        ) : (
          <div className="text-muted">Personne d’affecté.</div>
        )}
      </div>
    )

  return (
    <div className="flex flex-col gap-3 bg-panel-2/50 px-3 py-3">
      <NameField key={unit.name} value={unit.name} onSave={(name) => void update({ name })} />
      {club}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="label mb-0">Niveau</span>
          <select className="field min-h-11 py-1 text-xs" value={unit.levelId} onChange={(e) => void update({ levelId: e.target.value })}>
            {!levels.some((l) => l.id === unit.levelId) && <option value={unit.levelId}>(niveau supprimé)</option>}
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label mb-0">Rattachée à</span>
          <select
            className="field min-h-11 py-1 text-xs"
            value={unit.parentId ?? ''}
            onChange={async (e) => {
              const p = e.target.value || undefined
              // Contrôle anti-cycle (le serveur refait le même) : la liste n'en propose déjà aucun.
              if (wouldCycle(units, unit.id, p)) return inform('Impossible : une unité ne peut pas être rangée sous elle-même ni sous une de ses sous-unités.')
              const { parentId: _old, ...rest } = unit
              await save<Unit>('units', p ? { ...rest, parentId: p } : rest)
            }}
          >
            <option value="">— Aucune (en tête) —</option>
            {parents.map((u) => (
              <option key={u.id} value={u.id}>
                {'\u00a0\u00a0'.repeat(indent.get(u.id)?.depth ?? 0)}
                {u.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {pole && <PoleFields unit={unit} update={update} />}
      <TerritoryPicker unit={unit} onChange={(departments) => void update({ departments: departments.length ? departments : undefined })} />
      <AssignmentsEditor unit={unit} people={people} members={members} />
      <NewUnit parentId={unit.id} onCreated={onOpen} />
      <button
        className={`btn-ghost ${TAP} text-xs text-red-400`}
        disabled={!!blocker}
        onClick={async () => {
          if (await ask(`Supprimer l’unité « ${unit.name} » ?`, { ok: 'Supprimer' })) {
            await remove('units', unit.id)
            onDeleted()
          }
        }}
      >
        {blocker ? `Suppression impossible : ${blocker}` : 'Supprimer l’unité'}
      </button>
    </div>
  )
}

/** Pôle Espoirs (lecture) : sexe, site, programmes, référence et état PSQS. */
function PoleInfo({ unit }: { unit: Unit }) {
  const parts = [
    unit.poleSex && (unit.poleSex === 'F' ? 'Filles' : 'Garçons'),
    unit.poleSite,
    unit.poleLevels?.length && unit.poleLevels.map((l) => POLE_PROGRAMMES.find((o) => o.value === l)?.short ?? 'Accession').join(', '),
    unit.psqsRef && `PSQS ${unit.psqsRef}`,
    unit.psqsStatus,
  ].filter(Boolean)
  return parts.length ? <div className="text-[11px] text-muted">{parts.join(' · ')}</div> : null
}

/**
 * Pôle Espoirs (saisie) : référence de la structure dans le PSQS et état du dossier (texte libre), gardés sur l'unité
 * (src/structureTree.ts, psqsRef / psqsStatus ; donnée JSON, pas de SQL). Le groupe Pôle et ses exports les reprennent.
 */
function PoleFields({ unit, update }: { unit: Unit; update: (patch: Partial<Unit>) => Promise<unknown> }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-2">
      <div className="text-[11px] font-bold text-muted">Pôle Espoirs</div>
      <PoleInfo unit={unit} />
      <div className="grid grid-cols-2 gap-2">
        <TextField key={`ref-${unit.psqsRef ?? ''}`} label="Référence PSQS" value={unit.psqsRef ?? ''} placeholder="Référence de la structure" onSave={(v) => void update({ psqsRef: v || undefined })} />
        <TextField key={`st-${unit.psqsStatus ?? ''}`} label="État PSQS" value={unit.psqsStatus ?? ''} placeholder="Ex. Validée" onSave={(v) => void update({ psqsStatus: v || undefined })} />
      </div>
    </div>
  )
}

/** Champ texte enregistré par « OK » ou Entrée (même allure que le nom de l'unité). */
function TextField({ label, value, placeholder, onSave }: { label: string; value: string; placeholder?: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  const changed = v.trim() !== value
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label mb-0">{label}</span>
      <div className="flex gap-2">
        <input className="field min-h-11 min-w-0 py-1 text-xs" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && changed && onSave(v.trim())} />
        {changed && (
          <button className={`btn-primary ${TAP} shrink-0 px-3 text-xs`} onClick={() => onSave(v.trim())}>
            OK
          </button>
        )}
      </div>
    </label>
  )
}

/** Informations reprises de l'import (club : numéro, code postal, ville, coordonnées). */
function ClubInfo({ unit }: { unit: Unit }) {
  const parts = [
    unit.clubNumber && `N° ${unit.clubNumber}`,
    [unit.postalCode, unit.city].filter(Boolean).join(' '),
    unit.lat !== undefined && unit.lng !== undefined && `${unit.lat.toFixed(4)}, ${unit.lng.toFixed(4)}`,
  ].filter(Boolean)
  if (!parts.length && !unit.code) return null
  return (
    <div className="text-[11px] text-muted">
      {parts.join(' · ')}
      {unit.code ? `${parts.length ? ' · ' : ''}importée` : ''}
    </div>
  )
}

/** Nom d'une unité : « OK » apparaît quand il change (remonté à neuf quand le nom enregistré change). */
function NameField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [name, setName] = useState(value)
  const changed = !!name.trim() && name.trim() !== value
  return (
    <label className="flex flex-col gap-1">
      <span className="label mb-0">Nom</span>
      <div className="flex gap-2">
        <input className="field min-h-11 py-1 text-xs" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && changed && onSave(name.trim())} />
        {changed && (
          <button className={`btn-primary ${TAP} shrink-0 px-3 text-xs`} onClick={() => onSave(name.trim())}>
            OK
          </button>
        )}
      </div>
    </label>
  )
}

/** Territoire : départements à cocher (cochés en tête, recherche par numéro ou nom). */
function TerritoryPicker({ unit, onChange }: { unit: Unit; onChange: (d: string[]) => void }) {
  const all = useDepartments()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const chosen = unit.departments ?? []
  const words = fold(q).split(/\s+/).filter(Boolean)
  const list = all.filter((d) => words.every((w) => fold(`${d.code} ${d.name}`).includes(w)))
  const toggle = (code: string) => onChange(chosen.includes(code) ? chosen.filter((c) => c !== code) : [...chosen, code].sort())
  return (
    <div className="flex flex-col gap-1">
      <button className={`flex ${TAP} items-center justify-between text-left`} onClick={() => setOpen(!open)}>
        <span>
          <span className="label mb-0 inline">Territoire</span>{' '}
          <span className="text-xs">{chosen.length ? chosen.join(', ') : 'aucun département'}</span>
        </span>
        <span className={`text-muted transition ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && (
        <>
          <input className="field min-h-11 py-1 text-xs" placeholder="Chercher : 83, Var…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
            {[...list.filter((d) => chosen.includes(d.code!)), ...list.filter((d) => !chosen.includes(d.code!))].map((d) => (
              <label key={d.code} className="flex min-h-11 cursor-pointer items-center gap-2 border-b border-line px-3 text-xs last:border-0">
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={chosen.includes(d.code!)} onChange={() => toggle(d.code!)} />
                {d.code} · {d.name}
              </label>
            ))}
            {!list.length && <div className="p-3 text-center text-xs text-muted">Aucun département.</div>}
          </div>
        </>
      )}
    </div>
  )
}

function AssignmentsEditor({ unit, people, members }: { unit: Unit; people: Assignment[]; members: ReturnType<typeof useMembers> }) {
  const [chosen, setChosen] = useState<string[]>([])
  const [role, setRole] = useState<Role>('preparateur')
  const [q, setQ] = useState('')
  // Liste déroulante du champ de recherche : ouverte au toucher ou à la frappe, refermée au choix, à Échap ou en sortant du champ.
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const known = new Map((members.list ?? []).map((m) => [m.user_id, m]))
  // Comptes pas encore affectés ici ni déjà choisis, triés par nom ; la recherche (nom, prénom ou email, tous les mots, sans
  // accents) réduit la liste.
  const free = (members.list ?? [])
    .filter((m) => !people.some((a) => a.userId === m.user_id) && !chosen.includes(m.user_id))
    .sort((a, b) => memberName(a).localeCompare(memberName(b), 'fr'))
  const words = fold(q).split(/\s+/).filter(Boolean)
  const found = words.length ? free.filter((m) => words.every((w) => fold(`${m.full_name ?? ''} ${m.email ?? ''}`).includes(w))) : free
  // Défilement infini : la liste garde sa hauteur ; 50 comptes de plus chaque fois qu'on arrive en bas (rapide même avec
  // des milliers de comptes). Repart à 50 à chaque frappe.
  const STEP = 50
  const [limit, setLimit] = useState(STEP)
  const shown = found.slice(0, limit)
  const picked = chosen.map((id) => known.get(id)).filter((m): m is Member => !!m)
  const unpick = (id: string) => setChosen((c) => c.filter((x) => x !== id))
  const pick = (m: Member) => {
    setChosen((c) => (c.includes(m.user_id) ? c : [...c, m.user_id]))
    setQ('')
    setActive(0)
    setLimit(STEP)
    setOpen(false)
  }
  async function add() {
    if (!picked.length) return
    await saveMany<Assignment>(
      'assignments',
      picked.map((m) => ({ id: newId(), userId: m.user_id, unitId: unit.id, role, userName: memberName(m) })),
    )
    setChosen([])
    setQ('')
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label mb-0">Personnes affectées</span>
      {people.map((a) => (
        <div key={a.id} className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate">{known.get(a.userId) ? memberName(known.get(a.userId)!) : (a.userName ?? 'Compte')}</span>
          <select
            className="field min-h-11 w-36 shrink-0 py-1 text-xs"
            value={a.role}
            aria-label="Rôle dans l’unité"
            onChange={(e) => void save<Assignment>('assignments', { ...a, role: e.target.value as Role })}
          >
            {ASSIGNMENT_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <button
            className={`${TAP} shrink-0 text-muted hover:text-red-400`}
            aria-label="Retirer l’affectation"
            onClick={async () => {
              if (await ask(`Retirer ${a.userName ?? 'ce compte'} de « ${unit.name} » ?`, { ok: 'Retirer' })) await remove('assignments', a.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
      {!people.length && <p className="text-[11px] text-muted">Personne pour l’instant.</p>}
      {!supabase ? (
        <p className="text-[11px] text-muted">Les comptes se choisissent avec le serveur (version en ligne).</p>
      ) : !members.online ? (
        <p className="text-[11px] text-muted">Les comptes se choisissent en ligne.</p>
      ) : members.err ? (
        <p className="text-[11px] text-red-300">{members.err}</p>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-panel-2 p-2">
          <span className="text-[11px] font-bold text-muted">Ajouter des personnes</span>
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((m) => (
                <button
                  key={m.user_id}
                  className="inline-flex min-h-9 items-center gap-1 rounded-full border border-accent bg-accent/15 px-2.5 text-xs font-bold"
                  aria-label={`Retirer ${memberName(m)} du choix`}
                  onClick={() => unpick(m.user_id)}
                >
                  {memberName(m)} <span className="opacity-70">✕</span>
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <input
              className="field min-h-11 w-full py-1 text-xs"
              type="search"
              role="combobox"
              aria-expanded={open && !!members.list}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
              value={q}
              aria-label="Chercher un compte"
              placeholder={members.list ? `Choisir un compte (${free.length}) : nom, prénom, email…` : 'Chargement…'}
              disabled={!members.list}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
                setLimit(STEP)
                setOpen(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setOpen(true)
                  setActive((i) => {
                    const n = Math.min(i + 1, Math.max(0, found.length - 1))
                    if (n >= limit) setLimit((l) => l + STEP)
                    document.getElementById(`${listId}-${n}`)?.scrollIntoView({ block: 'nearest' })
                    return n
                  })
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((i) => {
                    const n = Math.max(0, i - 1)
                    document.getElementById(`${listId}-${n}`)?.scrollIntoView({ block: 'nearest' })
                    return n
                  })
                } else if (e.key === 'Enter' && open && shown[active]) {
                  e.preventDefault()
                  pick(shown[active])
                } else if (e.key === 'Escape') setOpen(false)
              }}
            />
            {open && members.list && (
              <div
                id={listId}
                role="listbox"
                className="absolute inset-x-0 top-full z-30 mt-1 flex max-h-80 flex-col overflow-y-auto rounded-md border border-line bg-panel shadow-lg"
                onScroll={(e) => {
                  const el = e.currentTarget
                  if (limit < found.length && el.scrollTop + el.clientHeight >= el.scrollHeight - 120) setLimit((n) => n + STEP)
                }}
              >
                {shown.map((m, i) => (
                  <div
                    key={m.user_id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={`flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1 text-xs ${i === active ? 'bg-panel-2' : ''}`}
                    // mousedown : choisi avant que le champ perde la main (sinon la liste se ferme avant le clic).
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pick(m)
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <span className="truncate font-bold">{memberName(m)}</span>
                    {m.full_name && m.email && <span className="truncate text-[10px] text-muted">{m.email}</span>}
                  </div>
                ))}
                {!found.length && <p className="p-2 text-[11px] text-muted">{free.length ? 'Aucun compte ne correspond.' : 'Tous les comptes sont déjà affectés ou choisis.'}</p>}
                {limit < found.length && <p className="p-2 text-center text-[11px] text-muted">Chargement de la suite…</p>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <select className="field min-h-11 min-w-0 flex-1 py-1 text-xs" value={role} aria-label="Rôle" onChange={(e) => setRole(e.target.value as Role)}>
              {ASSIGNMENT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button className={`btn-primary ${TAP} shrink-0 px-3 text-xs`} disabled={!picked.length} onClick={() => void add()}>
              {picked.length ? `Affecter ${plural(picked.length, 'personne')}` : 'Affecter'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
