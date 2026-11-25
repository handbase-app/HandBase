import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { alive, db, saveMany, save, today, type Player, type PlayerGroup, type Unit } from '../db'
import { pluralG, w } from '../gender'
import { useLevels, useUnits } from '../installation'
import { officialRegions, regionOfDept, useRegions } from '../lists'
import { unitRegionId } from '../poleSeason'
import { can } from '../roles'
import type { Role } from '../roles'
import {
  comiteName,
  endSelection,
  conversionTarget,
  ligueName,
  conversionWrites,
  majorityCategory,
  membersOfView,
  missingSelectionGroups,
  openSelection,
  pastSeasons,
  SCOPE_OF,
  SELECTION_CATEGORIES,
  SELECTION_EXITS,
  selectionGroupId,
  selectionGroupName,
  selectionGroupSpecs,
  selectionIndexAt,
  selectionLevelOfUnit,
  selectionBaseName,
  selectionCurrentAt,
  selectionMembersAt,
  type SelectionCategory,
  type SelectionExit,
  type SelectionRef,
  type SelectionView,
} from '../selections'
import { seasonOf } from '../coverage'
import { Icon } from './ui'

/*
 * Groupes de SÉLECTION (comité, ligue, équipe de France ; partie pure : src/selections.ts) : lectures (membres calculés par
 * vue, effectif, noms des unités), écritures sur les fiches (ajout = période ouverte aujourd'hui ; retrait = sortie + motif ;
 * rien ne s'efface), création des groupes manquants (administrateurs), conversion d'un ancien groupe, fenêtres. Partagé par
 * la page Groupes (src/pages/Groups.tsx), la fiche ouverte depuis le groupe (GroupPlayers.tsx) et « Ajouter à un groupe »
 * (components/Groups.tsx). Même modèle que le groupe Pôle (components/PoleGroup.tsx).
 */

/** Unité de la structure (comité, ligue) lue sur l'appareil : son nom et ses départements (libellés des sélections). */
export function useUnitOf(): (id?: string) => Unit | undefined {
  const units = useUnits()
  return useMemo(() => {
    const m = new Map(units.map((u) => [u.id, u]))
    return (id?: string) => (id ? m.get(id) : undefined)
  }, [units])
}

/** Toutes les fiches vivantes (membres calculés). */
const useAllPlayers = () => useLiveQuery(() => db.players.toArray().then(alive), [])

/**
 * Nom gardé sur une période de comité ou de ligue (SelectionPeriod.unitName) : le nom affiché du collectif, sans le sexe
 * (« Comité de l'Ain », « Ligue Occitanie »), lisible même sans la structure (espace joueur). France : rien.
 */
export function useUnitName(): (id?: string, level?: 'comite' | 'ligue' | 'france') => string | undefined {
  const units = useUnits()
  const levels = useLevels()
  return useMemo(() => {
    const m = new Map(units.map((u) => [u.id, u]))
    return (id?: string, level?: 'comite' | 'ligue' | 'france') => {
      const u = id ? m.get(id) : undefined
      const lv = level ?? (u ? selectionLevelOfUnit(u, levels) : undefined)
      return u && lv && lv !== 'france' ? selectionBaseName({ level: lv }, u) : undefined
    }
  }, [units, levels])
}

export interface SelectionMembers {
  today: string
  players: Player[]
  /** Membres d'aujourd'hui. */
  current: Player[]
  /** Membres de la vue demandée (aujourd'hui, ou toute une saison passée). */
  shown: Player[]
  /** Saisons passées où le groupe a eu des membres (la plus récente d'abord). */
  seasons: string[]
}

/** Membres calculés d'un groupe de sélection (undefined tant que les fiches ne sont pas lues). */
export function useSelectionMembers(ref: SelectionRef | null | undefined, view: SelectionView = 'courante'): SelectionMembers | undefined {
  const players = useAllPlayers()
  const day = today()
  return useMemo(() => {
    if (!players) return undefined
    const current = ref ? selectionMembersAt(players, ref, day) : []
    const shown = ref ? (view === 'courante' ? current : membersOfView(players, ref, view, day)) : []
    return { today: day, players, current, shown, seasons: ref ? pastSeasons(players, ref, day) : [] }
  }, [players, ref, view, day])
}

/** Effectifs du jour de tous les groupes de sélection (un seul passage sur les fiches) : identifiant du groupe → nombre. */
export function useSelectionCounts(groups: readonly Pick<PlayerGroup, 'id' | 'selection'>[] | undefined): Map<string, number> {
  const players = useAllPlayers()
  const day = today()
  return useMemo(() => {
    const m = new Map<string, number>()
    if (!players || !groups?.some((g) => g.selection)) return m
    for (const p of players) {
      const seen = new Set<string>()
      for (const x of p.selections ?? []) {
        if (!selectionCurrentAt(x, day)) continue
        const sex = x.sex ?? (p.sex === 'M' || p.sex === 'F' ? p.sex : undefined)
        if (!sex) continue
        const id = selectionGroupId({ level: x.level, unitId: x.unitId, category: x.category, sex })
        if (seen.has(id)) continue
        seen.add(id)
        m.set(id, (m.get(id) ?? 0) + 1)
      }
    }
    return m
  }, [players, groups, day])
}

/** Effectif d'un groupe dans la liste des groupes : membres d'aujourd'hui pour un groupe de sélection, sinon playerIds. */
export function useSelectionCount(g: Pick<PlayerGroup, 'selection' | 'playerIds'>): number {
  const m = useSelectionMembers(g.selection ?? null)
  return g.selection ? (m?.current.length ?? 0) : g.playerIds.length
}

/** Qui gère les membres d'un groupe de sélection : ceux qui modifient les fiches (encadrants, administrateurs). */
export const canManageSelection = (role: Role) => can.editPlayers(role)

// ---------- Création des groupes ----------

/**
 * Groupes de sélection manquants de la structure (chaque comité et chaque ligue, masculin et féminin, et les 6 groupes France),
 * créés par un ADMINISTRATEUR à l'ouverture de la page Groupes. Identifiants fixes : un second appareil réécrit les mêmes
 * lignes, sans doublon. Visibles par tout le staff ; membres calculés (playerIds vide). Renvoie le nombre créé.
 */
export function useEnsureSelectionGroups(role: Role) {
  const units = useUnits()
  const levels = useLevels()
  const groups = useLiveQuery(() => db.groups.toArray(), [])
  useEffect(() => {
    if (role !== 'admin' || !groups) return
    const specs = selectionGroupSpecs(units, levels)
    const missing = missingSelectionGroups(specs, groups)
    if (!missing.length) return
    const byId = new Map(groups.map((g) => [g.id, g]))
    void saveMany<PlayerGroup>(
      'groups',
      missing.map((s) => ({
        ...(byId.get(s.id) ?? {}),
        id: s.id,
        name: s.name,
        playerIds: [],
        selection: s.ref,
        private: false,
        sex: s.ref.sex,
        scope: SCOPE_OF[s.ref.level],
        deleted: false,
        ...(s.department && { department: s.department }),
      })),
    ).catch(() => undefined)
  }, [role, groups, units, levels])
}

// ---------- Écritures ----------

export interface SelectionAddResult {
  added: number
  already: number
}

/** Ajout au groupe : une période ouverte à `from` (aujourd'hui par défaut) sur chaque fiche ; déjà sélectionné : rien. */
export async function addToSelection(ref: SelectionRef, ids: readonly string[], from = today(), unitName?: string): Promise<SelectionAddResult> {
  const out: SelectionAddResult = { added: 0, already: 0 }
  for (const id of new Set(ids)) {
    const p = await db.players.get(id)
    if (!p || p.deleted) continue
    const selections = openSelection(p, ref, from, unitName)
    if (!selections) {
      out.already++
      continue
    }
    await save<Player>('players', { ...p, selections })
    out.added++
  }
  return out
}

/**
 * Retrait (« Fin de sélection… ») : la période en cours se ferme hier, avec le motif (src/selections.ts, endSelection) ; ajoutée
 * aujourd'hui même, elle est retirée. null s'il n'était pas sélectionné ; sinon « removed » : période du jour retirée.
 */
export async function leaveSelection(p: Player, ref: SelectionRef, reason: SelectionExit): Promise<{ removed: boolean } | null> {
  const fresh = (await db.players.get(p.id)) ?? p
  const r = endSelection(fresh, ref, today(), reason)
  if (!r) return null
  await save<Player>('players', { ...fresh, selections: r.selections })
  return { removed: r.removed }
}

/** « 3 joueurs ajoutés à Équipe de France U17 masculin (depuis aujourd'hui, modifiable sur la fiche) ». */
export function addMessage(r: SelectionAddResult, name: string, sex?: string | null): string {
  const g = w(sex)
  const already = r.already ? `, ${r.already} déjà ${r.already > 1 ? g.inscrits : g.inscrit}` : ''
  if (!r.added) return r.already ? `Déjà dans « ${name} ».` : 'Rien à changer.'
  return `${pluralG(r.added, sex)} ${r.added > 1 ? g.ajoutes : g.ajoute} à « ${name} » (entrée aujourd’hui, modifiable sur la fiche${already}).`
}

/** Période en cours de ce joueur dans ce groupe (ligne de la liste : « depuis le … »). */
export function currentPeriod(p: Player, ref: SelectionRef, day = today()) {
  const i = selectionIndexAt(p, ref, day)
  return i < 0 ? undefined : p.selections![i]
}

// ---------- Affichage ----------

/** Petit badge « SÉL. » devant le nom d'un groupe de sélection. */
export function SelectionChip({ className = 'ml-2' }: { className?: string }) {
  return (
    <span
      title="Groupe de sélection : membres calculés depuis les périodes de sélection des fiches"
      className={`inline-flex shrink-0 items-center gap-0.5 rounded border border-sky-500/35 bg-sky-500/15 px-1.5 align-[1px] text-[10px] font-bold text-sky-300 ${className}`}
    >
      SÉL.
    </span>
  )
}

/** Options des vues : saison en cours, puis les saisons passées où le groupe a eu des membres. */
export function selectionViewOptions(m: Pick<SelectionMembers, 'today' | 'seasons'>): { value: SelectionView; label: string }[] {
  return [{ value: 'courante', label: `En ce moment (${seasonOf(m.today).label})` }, ...m.seasons.map((s) => ({ value: s as SelectionView, label: `Saison ${s}` }))]
}

/** Fenêtre centrée (téléphone : en bas) sur fond flouté ; Échap ou un toucher à côté la ferment. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const id = useId()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center scrim p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className="win flex max-h-[88dvh] w-full max-w-md flex-col gap-3 overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div id={id} className="text-sm font-extrabold">
          {title}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Fenêtre « Motif de sortie » d'une sélection : motifs neutres (SELECTION_EXITS) ; Échap ou Annuler : null. */
export function SelectionExitDialog({ name, group, sex, onClose }: { name: string; group: string; sex?: string | null; onClose: (r: SelectionExit | null) => void }) {
  const [reason, setReason] = useState<SelectionExit | undefined>()
  const id = useId()
  return (
    <Dialog title={`Fin de sélection : ${name}`} onClose={() => onClose(null)}>
      <p className="text-[11px] text-muted">
        Sortie de « {group} » : sa période se ferme à la date d’hier (ajoutée aujourd’hui même, elle est simplement retirée). {w(sex).LeJoueur} garde sa fiche et
        l’historique de ses sélections ; la date se corrige sur la fiche.
      </p>
      <div role="radiogroup" aria-label="Motif de sortie" className="flex flex-col gap-1">
        {SELECTION_EXITS.map((o) => (
          <label key={o.value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-xs ${reason === o.value ? 'border-accent bg-accent-soft' : 'border-line bg-panel-2 hover:border-accent'}`}>
            <input type="radio" name={`${id}-motif`} className="accent-accent" checked={reason === o.value} onChange={() => setReason(o.value)} />
            <span className="font-bold">{o.label}</span>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn px-4 text-xs text-muted" onClick={() => onClose(null)}>
          Annuler
        </button>
        <button className="btn-primary px-4 text-xs" disabled={!reason} onClick={() => reason && onClose(reason)}>
          <Icon name="check" className="mr-1 inline h-3.5 w-3.5" />
          Confirmer la sortie
        </button>
      </div>
    </Dialog>
  )
}

/** Ligues de la structure par région (identifiant de la liste « region ») : conversion d'un groupe « Ligue ». */
function useLigueOfRegion(): (regionId: string) => string | undefined {
  const units = useUnits()
  const levels = useLevels()
  const listed = useRegions()
  return useMemo(() => {
    const regions = listed.length ? listed : officialRegions()
    const m = new Map<string, string>()
    for (const u of units)
      if (selectionLevelOfUnit(u, levels) === 'ligue') {
        const r = unitRegionId(units, u.id, { levels, regions, regionOfDept })
        if (r && !m.has(r)) m.set(r, u.id)
      }
    return (id: string) => m.get(id)
  }, [units, levels, listed])
}

/**
 * « Convertir en groupe de sélection » : un groupe ordinaire qui a une portée (« Equipe de France », « Intercomités 83 »)
 * devient des périodes de sélection : chaque membre reçoit une période ouverte à la date choisie (aujourd'hui par défaut) dans
 * le groupe de sélection choisi (proposé d'après la portée, le sexe, le comité ou la ligue, et l'âge pour la France). L'ancien
 * groupe n'est pas touché (à archiver ensuite si on veut) ; rien ne s'efface.
 */
export function ConvertGroupDialog({ g, players, onClose }: { g: PlayerGroup; players: Player[]; onClose: (msg?: string, targetId?: string) => void }) {
  const units = useUnits()
  const levels = useLevels()
  const ligueOf = useLigueOfRegion()
  const unitName = useUnitName()
  const unitOf = useUnitOf()
  const [from, setFrom] = useState(today())
  const suggestedCat = majorityCategory(players, from) ?? 'U17'
  const [category, setCategory] = useState<SelectionCategory>(suggestedCat)
  const [sex, setSex] = useState<'M' | 'F' | undefined>(g.sex === 'M' || g.sex === 'F' ? g.sex : undefined)
  const level = g.scope === 'federation' ? 'france' : g.scope === 'ligue' ? 'ligue' : 'comite'
  const choices = useMemo(
    () =>
      units
        .filter((u) => !u.deleted && selectionLevelOfUnit(u, levels) === level)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [units, levels, level],
  )
  const auto = conversionTarget({ ...g, sex }, { units, levels, ligueOfRegion: ligueOf, category })
  const [unitId, setUnitId] = useState<string>(auto?.unitId ?? '')
  useEffect(() => {
    if (!unitId && auto?.unitId) setUnitId(auto.unitId)
  }, [auto?.unitId]) // eslint-disable-line react-hooks/exhaustive-deps
  const ref: SelectionRef | null = !sex ? null : level === 'france' ? { level, category, sex } : unitId ? { level, unitId, sex } : null
  const name = ref ? selectionGroupName(ref, unitOf(ref.unitId)) : ''
  const writes = ref ? conversionWrites(players, ref, from || today(), unitName(ref.unitId, ref.level)) : []
  const [busy, setBusy] = useState(false)
  async function run() {
    if (!ref || busy) return
    setBusy(true)
    try {
      const byId = new Map(players.map((p) => [p.id, p]))
      await saveMany<Player>(
        'players',
        writes.map((x) => ({ ...byId.get(x.id)!, selections: x.selections })),
      )
      const n = writes.length
      onClose(`${pluralG(n, sex)} ${n > 1 ? w(sex).ajoutes : w(sex).ajoute} à « ${name} » (entrée le ${from.split('-').reverse().join('/')}).`, selectionGroupId(ref))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title="Convertir en groupe de sélection" onClose={() => onClose()}>
      <p className="text-[11px] text-muted">
        Chaque {w(sex ?? g.sex).joueur} de « {g.name} » reçoit une période de sélection sur sa fiche, à partir de la date choisie. Ce groupe-ci ne change pas ; tu pourras l’archiver ensuite.
      </p>
      {!(g.sex === 'M' || g.sex === 'F') && (
        <label className="flex flex-col gap-0.5">
          <span className="label">Masculin ou féminin</span>
          <select className="field" value={sex ?? ''} onChange={(e) => setSex((e.target.value || undefined) as 'M' | 'F' | undefined)}>
            <option value="">Choisir…</option>
            <option value="M">Masculin</option>
            <option value="F">Féminin</option>
          </select>
        </label>
      )}
      {level === 'france' ? (
        <label className="flex flex-col gap-0.5">
          <span className="label">Catégorie</span>
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value as SelectionCategory)}>
            {SELECTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                Équipe de France {c}
                {c === suggestedCat ? ' (proposée d’après l’âge)' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="flex flex-col gap-0.5">
          <span className="label">{level === 'comite' ? 'Comité' : 'Ligue'}</span>
          <select className="field" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Choisir…</option>
            {choices.map((u) => (
              <option key={u.id} value={u.id}>
                {level === 'comite' ? comiteName(u.name, u.departments) : ligueName(u.name)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-0.5">
        <span className="label">Début des périodes</span>
        <input type="date" className="field" value={from} max="9999-12-31" onChange={(e) => setFrom(e.target.value || today())} />
      </label>
      {ref && (
        <p className="text-xs">
          Vers <b>{name}</b> : {pluralG(writes.length, sex)} à ajouter
          {players.length > writes.length ? ` (${players.length - writes.length} déjà dans ce groupe à cette date)` : ''}.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn px-4 text-xs text-muted" onClick={() => onClose()}>
          Annuler
        </button>
        <button className="btn-primary px-4 text-xs" disabled={!ref || !writes.length || busy} onClick={() => void run()}>
          Convertir
        </button>
      </div>
    </Dialog>
  )
}
