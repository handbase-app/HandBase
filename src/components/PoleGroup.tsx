import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { alive, db, newId, POLE_EXITS, POLE_PROGRAMMES, save, today, type Player, type PlayerGroup, type PoleExit, type PoleProgramme, type Unit } from '../db'
import { w } from '../gender'
import { useAssignments, useLevels, useUnits } from '../installation'
import { officialRegions, regionOfDept, useRegions } from '../lists'
import {
  cancelArrival,
  defaultPoleGroupName,
  isPoleLeader,
  joinPole,
  periodMatches,
  leavePole,
  membersAt,
  myPoleUnits,
  periodIndexAt,
  poleRefOf,
  refDate,
  reopenPeriod,
  seasons,
  suggestProgramme,
  type PoleRef,
  type PoleView,
  type Seasons,
  upcomingIndex,
} from '../poleSeason'
import { can, currentUserId, useRole } from '../roles'
import { Icon } from './ui'
import { choose } from './Confirm'

/*
 * Groupe « Pôle » d'une unité (src/poleSeason.ts) : lectures (unité, membres calculés, droits), écritures sur les fiches
 * (entrer, sortir, rétablir, annuler une arrivée à venir : on écrit des dates, jamais un statut) et fenêtre « motif de sortie », partagées par la page
 * Groupes (src/pages/Groups.tsx), la fiche ouverte depuis le groupe (GroupPlayers.tsx), « Ajouter à un groupe »
 * (components/Groups.tsx) et le changement de saison (src/pages/PoleSeason.tsx).
 */

const d = (s?: string) => (s ? s.split('-').reverse().join('/') : '?')
/** « 01/07/2027 ». */
export const fmtDay = d

/** « 1er juillet 2027 ». */
export const fmtLongDay = (s?: string) => {
  if (!s) return '?'
  const t = new Date(`${s}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  return t.replace(/^1 /, '1er ')
}

/** Structure de l'appareil : unités, niveaux, affectations (non supprimées). */
export function useStructure() {
  const units = useUnits()
  const levels = useLevels()
  const assignments = useAssignments()
  return { units, levels, assignments }
}

/** Ligues : la liste des Réglages, sinon le découpage officiel ; et la région d'un département. */
function useRegionOpts() {
  const listed = useRegions()
  return useMemo(() => ({ regions: listed.length ? listed : officialRegions(), regionOfDept }), [listed])
}

/** Références de toutes les unités Pôle de l'appareil (identifiant de l'unité → référence). */
export function usePoleRefs(): Map<string, PoleRef> {
  const { units, levels } = useStructure()
  const opts = useRegionOpts()
  return useMemo(() => {
    const m = new Map<string, PoleRef>()
    for (const u of units) {
      const r = poleRefOf(units, levels, u.id, opts)
      if (r) m.set(u.id, r)
    }
    return m
  }, [units, levels, opts])
}

/** Référence de l'unité Pôle d'un groupe (null : pas de pôle, unité supprimée ou pas un pôle). */
export function usePoleRef(unitId?: string): PoleRef | null {
  const refs = usePoleRefs()
  return (unitId && refs.get(unitId)) || null
}

/**
 * Droits « dirigeant du pôle » du compte (can.editPoles, src/roles.ts) : `leads(unitId)` pour une unité, `units` que je dirige
 * (toutes les unités Pôle pour un administrateur), `any` : au moins une (bloc « Pôle Espoirs » de la fiche).
 */
export function usePoleLeader() {
  const role = useRole()
  const uid = currentUserId()
  const { units, levels, assignments } = useStructure()
  const admin = role === 'admin'
  return useMemo(() => {
    const mine = myPoleUnits(units, levels, assignments, uid, admin)
    return {
      admin,
      units: mine,
      any: mine.length > 0,
      leads: (unitId: string) => can.editPoles(role, isPoleLeader(assignments, uid, unitId)),
    }
  }, [units, levels, assignments, uid, admin, role])
}

/** Groupes Pôle visibles (non supprimés), par unité. */
export function usePoleGroups(): PlayerGroup[] {
  return useLiveQuery(() => db.groups.toArray().then((gs) => alive(gs).filter((g) => !!g.poleUnitId && can.seeGroup(g))), [], [] as PlayerGroup[])
}

/** Saisons vues d'aujourd'hui (recalculées à chaque rendu : une page ouverte la veille du 1er septembre suit le jour). */
export const useSeasons = (): Seasons => seasons(today())

/** Toutes les fiches vivantes de l'appareil (membres calculés). */
export const useAllPlayers = () => useLiveQuery(() => db.players.toArray().then(alive), [])

export interface PoleMembers {
  s: Seasons
  players: Player[]
  /** Membres de la vue en cours (aujourd'hui) et de la vue prochaine (1er septembre suivant). */
  current: Player[]
  next: Player[]
  /** Membres de la vue demandée. */
  shown: Player[]
}

/** Membres calculés d'une unité Pôle (undefined tant que les fiches ne sont pas lues ; listes vides sans référence). */
export function usePoleMembers(ref: PoleRef | null, view: PoleView = 'courante'): PoleMembers | undefined {
  const players = useAllPlayers()
  const s = useSeasons()
  return useMemo(() => {
    if (!players) return undefined
    const current = ref ? membersAt(players, ref, s.refCurrent) : []
    const next = ref ? membersAt(players, ref, s.refNext) : []
    return { s, players, current, next, shown: view === 'prochaine' ? next : current }
  }, [players, ref, view, s.refCurrent, s.refNext]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Effectif d'un groupe Pôle dans la liste des groupes (vue en cours), à défaut playerIds. */
export function usePoleCount(g: Pick<PlayerGroup, 'poleUnitId' | 'playerIds'>): number {
  const ref = usePoleRef(g.poleUnitId)
  const m = usePoleMembers(g.poleUnitId ? ref : null)
  return g.poleUnitId ? (m?.current.length ?? 0) : g.playerIds.length
}

// ---------- Écritures ----------

/** Crée le groupe Pôle d'une unité : « Pôle <site> », visible par tout le staff, membres calculés (playerIds vide). */
export async function createPoleGroup(u: Unit, ref: PoleRef | null): Promise<PlayerGroup> {
  // Un seul par unité : s'il existe déjà (créé sur un autre appareil entre-temps), on le rend.
  const existing = (await db.groups.toArray()).find((g) => !g.deleted && g.poleUnitId === u.id)
  if (existing) return existing
  return save<PlayerGroup>('groups', {
    id: newId(),
    name: defaultPoleGroupName(u),
    playerIds: [],
    poleUnitId: u.id,
    private: false,
    sex: u.poleSex,
    scope: 'ligue',
    ...(ref?.regionId && { regionId: ref.regionId }),
  })
}

export interface JoinManyResult {
  added: number
  transfers: number
  already: number
}

/**
 * Arrivée au pôle : « now » = dès aujourd'hui (arrivée en cours de saison : la fiche apparaît tout de suite dans la vue
 * « Saison en cours ») ; « next » = au 1er juillet (saison prochaine, préparation de la liste).
 */
export type PoleArrival = 'now' | 'next'

/** Veille d'un jour AAAA-MM-JJ (sortie d'un autre pôle la veille d'une arrivée aujourd'hui). */
const dayBefore = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

/** Dates d'une arrivée : jour de référence, entrée, sortie d'un autre pôle, année de début de saison (programme proposé). */
export function arrivalDates(s: Seasons, when: PoleArrival) {
  return when === 'now'
    ? { day: s.refCurrent, entry: s.refCurrent, exit: dayBefore(s.refCurrent), startYear: Number(s.current.from.slice(0, 4)) }
    : { day: s.entry, entry: s.entry, exit: s.exit, startYear: Number(s.next.from.slice(0, 4)) }
}

/**
 * Quand commence la période ? Dès aujourd'hui (saison en cours) ou au 1er juillet (saison prochaine). Proposé d'office :
 * `suggested`, sinon la saison prochaine de mars à août (préparation de la liste), aujourd'hui le reste de l'année.
 * null : annulé.
 */
export function askArrival(s: Seasons, n: number, suggested?: PoleArrival): Promise<PoleArrival | null> {
  const month = Number(s.refCurrent.slice(5, 7))
  const def: PoleArrival = suggested ?? (month >= 3 && month <= 8 ? 'next' : 'now')
  return choose<PoleArrival | 'cancel'>(n > 1 ? `Quand commence leur période au pôle ? (${n} fiches)` : 'Quand commence sa période au pôle ?', [
    { value: 'now', label: `Dès aujourd’hui (saison ${s.current.label})`, style: def === 'now' ? 'primary' : 'ghost', focus: def === 'now' },
    { value: 'next', label: `Au ${d(s.entry)} (saison ${s.next.label})`, style: def === 'next' ? 'primary' : 'ghost', focus: def === 'next' },
    { value: 'cancel', label: 'Annuler', style: 'ghost' },
  ]).then((v) => (v === 'now' || v === 'next' ? v : null))
}

/**
 * Entrée de plusieurs joueurs au pôle (« Ajouter à un groupe », « Ajouter des joueurs ») : une période par fiche (site et
 * ligue de l'unité, entrée aujourd'hui ou au 1er juillet selon `when`, programme déduit de l'âge et du sexe parmi ceux de
 * l'unité, modifiable ensuite sur la fiche) ; une période en cours dans un autre pôle est fermée la veille de l'entrée
 * (« autre »). Arrivée aujourd'hui d'un joueur déjà inscrit pour le 1er juillet : son entrée est avancée (pas de doublon).
 */
export async function joinPoleMany(
  ref: PoleRef,
  ids: readonly string[],
  s: Seasons,
  programmeOf?: (p: Player) => PoleProgramme | undefined,
  when: PoleArrival = 'next',
): Promise<JoinManyResult> {
  const out: JoinManyResult = { added: 0, transfers: 0, already: 0 }
  const a = arrivalDates(s, when)
  for (const id of new Set(ids)) {
    const p = await db.players.get(id)
    if (!p || p.deleted) continue
    if (when === 'now') {
      const future = (p.poles ?? []).findIndex((x) => periodMatches(x, ref) && !!x.from && x.from > a.day && !x.to)
      if (future >= 0) {
        await save<Player>('players', { ...p, poles: (p.poles ?? []).map((x, i) => (i === future ? { ...x, from: a.entry } : x)) })
        out.added++
        continue
      }
    }
    const programme = programmeOf ? programmeOf(p) : suggestProgramme(ref.levels, p, a.startYear)
    const r = joinPole(p, ref, { day: a.day, entry: a.entry, exit: a.exit, programme })
    if (!r) {
      out.already++
      continue
    }
    await save<Player>('players', { ...p, poles: r.poles })
    out.added++
    if (r.transferredFrom) out.transfers++
  }
  return out
}

/** Sortie d'un joueur : ferme sa période en cours à `to` (30 juin par défaut) avec le motif. Faux s'il n'était pas au pôle. */
export async function leavePoleOne(p: Player, ref: PoleRef, s: Seasons, reason: PoleExit, to = s.exit): Promise<boolean> {
  const fresh = (await db.players.get(p.id)) ?? p
  const poles = leavePole(fresh, ref, s.refCurrent, to, reason)
  if (!poles) return false
  await save<Player>('players', { ...fresh, poles })
  return true
}

/**
 * Période de ce pôle pas encore commencée (arrivée à venir) vue au jour `day` (vue « Saison prochaine ») : le menu de la
 * ligne propose alors « Annuler l’arrivée » à la place de « Retirer du pôle… ». undefined : aucune.
 */
export function upcomingArrival(p: Player, ref: PoleRef, s: Seasons, day?: string) {
  const i = upcomingIndex(p, ref, s.refCurrent, day)
  return i < 0 ? undefined : p.poles![i]
}

/**
 * « Annuler l’arrivée » : confirmation simple, puis retire seulement la période à venir de ce pôle (cancelArrival) ; sans
 * date ni motif, les autres périodes ne changent pas. Faux si refusé ou s'il n'y avait rien à annuler.
 */
export async function cancelArrivalOne(p: Player, ref: PoleRef, s: Seasons, groupName: string, day?: string): Promise<boolean> {
  const x = upcomingArrival(p, ref, s, day)
  if (!x) return false
  const msg = `Annuler l’arrivée de ${p.lastName.toUpperCase()} ${p.firstName} au ${groupName} prévue le ${fmtLongDay(x.from)} ? Ses autres périodes de pôle et sa fiche ne changent pas.`
  const ok = await choose(msg, [
    { value: 'keep', label: 'Garder l’arrivée', style: 'ghost' },
    { value: 'cancel', label: 'Annuler l’arrivée', style: 'primary' },
  ])
  if (ok !== 'cancel') return false
  const fresh = (await db.players.get(p.id)) ?? p
  const poles = cancelArrival(fresh, ref, s.refCurrent, day)
  if (!poles) return false
  await save<Player>('players', { ...fresh, poles })
  return true
}

/** « Rétablir » : efface la sortie de la période de ce pôle en cours aujourd'hui. */
export async function reopenPoleOne(p: Player, ref: PoleRef, s: Seasons): Promise<boolean> {
  const fresh = (await db.players.get(p.id)) ?? p
  const i = periodIndexAt(fresh, ref, s.refCurrent)
  if (i < 0) return false
  await save<Player>('players', { ...fresh, poles: reopenPeriod(fresh.poles ?? [], i) })
  return true
}

/** Message après une entrée : « 3 joueurs ajoutés au Pôle Nice (entrée le 01/07/2027, dont 1 transfert) ». */
export function joinMessage(r: JoinManyResult, name: string, s: Seasons, sex?: string | null, when: PoleArrival = 'next'): string {
  const g = w(sex)
  const parts = [when === 'now' ? 'entrée aujourd’hui, saison en cours' : `entrée le ${d(s.entry)}, saison prochaine`, r.transfers ? `dont ${r.transfers} transfert${r.transfers > 1 ? 's' : ''} depuis un autre pôle` : '', r.already ? `${r.already} déjà ${r.already > 1 ? g.inscrits : g.inscrit}` : '']
    .filter(Boolean)
    .join(', ')
  if (!r.added) return r.already ? `Déjà ${r.already > 1 ? g.tous : ''} au ${name}.`.replace('  ', ' ') : 'Rien à changer.'
  return `${r.added} ${r.added > 1 ? g.joueurs : g.joueur} ${r.added > 1 ? g.ajoutes : g.ajoute} au ${name} (${parts}).`
}

// ---------- Affichage ----------

/** Petit badge « Pôle » devant le nom d'un groupe Pôle (liste des groupes, fenêtres). */
export function PoleChip({ className = 'ml-2' }: { className?: string }) {
  return (
    <span
      title="Groupe Pôle : membres calculés depuis les périodes de pôle des fiches"
      className={`inline-flex shrink-0 items-center gap-0.5 rounded border border-teal-500/35 bg-teal-500/15 px-1.5 align-[1px] text-[10px] font-bold text-teal-300 ${className}`}
    >
      PÔLE
    </span>
  )
}

/** Libellé d'un programme : « Accession territoriale »… */
export const programmeLabel = (p?: PoleProgramme) => (p ? (POLE_PROGRAMMES.find((o) => o.value === p)?.label ?? 'Accession') : '')

/** Libellé court du segment des vues (téléphone : « En cours » / « Prochaine »). */
export const VIEW_OPTIONS = (s: Seasons, short = false): { value: PoleView; label: string }[] => [
  { value: 'courante', label: short ? `En cours (${s.current.label})` : `Saison en cours (${s.current.label})` },
  { value: 'prochaine', label: short ? `Prochaine (${s.next.label})` : `Saison prochaine (${s.next.label})` },
]

/** Date de référence d'une vue, pour les écrans. */
export const viewRef = refDate

/**
 * Fenêtre « Motif de sortie » : la liste POLE_EXITS (src/db.ts, seuls motifs autorisés), « Fin de cursus » présélectionné
 * quand c'est la proposition, sinon rien ; Échap ou Annuler renvoient null.
 */
export function ExitReasonDialog({
  name,
  sex,
  suggested,
  date,
  onClose,
}: {
  name: string
  sex?: string | null
  suggested?: PoleExit
  /** Date de sortie affichée (« au 30/06/2027 »). */
  date?: string
  onClose: (reason: PoleExit | null) => void
}) {
  const [reason, setReason] = useState<PoleExit | undefined>(suggested)
  const id = useId()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose(null)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => onClose(null)}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className="card flex max-h-[88dvh] w-full max-w-md flex-col gap-3 overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div id={id} className="text-sm font-extrabold">
          Sortie du pôle : {name}
        </div>
        <p className="text-[11px] text-muted">
          Motif de sortie{date ? ` (sortie au ${d(date)})` : ''}. {w(sex).LeJoueur} garde sa fiche et son historique ; une sortie se rétablit en effaçant la date.
        </p>
        <div role="radiogroup" aria-label="Motif de sortie" className="flex flex-col gap-1">
          {POLE_EXITS.map((o) => (
            <label key={o.value} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-xs ${reason === o.value ? 'border-accent bg-accent-soft' : 'border-line bg-panel-2 hover:border-accent'}`}>
              <input type="radio" name={`${id}-motif`} className="accent-accent" checked={reason === o.value} onChange={() => setReason(o.value)} />
              <span className="font-bold">{o.label}</span>
              {suggested === o.value && <span className="ml-auto text-[10px] text-muted">proposé</span>}
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
      </div>
    </div>,
    document.body,
  )
}
