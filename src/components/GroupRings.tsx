import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { groupesReperes, onAffichage, setGroupesReperes, useGroupesReperes } from '../affichage'
import { alive, db, type PlayerGroup } from '../db'
import { GROUP_COLORS, GROUP_TONES, groupColorCss, groupColorOf, type GroupColor } from '../groupColors'
import { countHere, MAX_REPERES, resolveRingColors, ringLabel, ringMembership, sameIds, toggleGroupe, type RingGroup } from '../groupRings'
import { sharedQuery, useShared } from '../live'
import { POLE_MEMBER_TABLES, withPoleMembers } from '../poleMembers'
import { can } from '../roles'
import { loadTeams } from '../teams'
import { Icon } from './ui'
import { FilterFold } from './PictoDisplay'

/*
 * « Repérer des groupes » (src/groupRings.ts) : la table joueur → groupes repérés (une seule pour toute l'appli, relue quand
 * les groupes ou le choix changent), l'anneau autour de la photo (components/PlayerRow.tsx), la section au bas de la
 * fenêtre « Filtres » des listes de joueurs, et les pastilles de couleur du formulaire d'un groupe (pages/Groups.tsx).
 */

const NO_RINGS = { groups: [] as RingGroup[], map: new Map<string, RingGroup[]>() }

/** Groupes repérés encore là et visibles (groupes Pôle : membres en cours), puis la table des joueurs. */
const ringQuery = sharedQuery(
  ['groups', 'teams', ...POLE_MEMBER_TABLES],
  async () => {
    const ids = groupesReperes()
    if (!ids.length) return NO_RINGS
    await loadTeams()
    const gs = alive((await db.groups.bulkGet(ids)).filter((g): g is PlayerGroup => !!g)).filter(can.seeGroup)
    return ringMembership(ids, await withPoleMembers(gs))
  },
  800,
)
let lastIds = groupesReperes()
onAffichage(() => {
  if (sameIds(lastIds, groupesReperes())) return
  lastIds = groupesReperes()
  ringQuery.refresh()
})

/** Groupes repérés dont ce joueur fait partie (dans l'ordre du choix) ; aucun : undefined. */
export function useRowRings(playerId?: string): RingGroup[] | undefined {
  const r = useShared(ringQuery)
  return playerId ? r?.map.get(playerId) : undefined
}

/**
 * Liseré des groupes repérés (choix du 03/11, à la place de l'anneau autour de la photo) : un trait de 4 px de la couleur
 * de chaque groupe, côte à côte, sur le bord gauche de la ligne (3 au plus). Posé par-dessus, la ligne garde sa place
 * (PlayerRow ajoute la marge qu'il faut à gauche).
 */
export function RowStripes({ rings }: { rings?: RingGroup[] }) {
  if (!rings?.length) return null
  return (
    <span aria-hidden title={ringLabel(rings)} data-rings={rings.map((g) => g.color).join(' ')} className="pointer-events-none absolute inset-y-0 left-0 flex">
      {rings.map((g) => (
        <span key={g.id} className="w-1" style={{ backgroundColor: groupColorCss(g.color) }} />
      ))}
    </span>
  )
}

/** Largeur du liseré (px) : la ligne décale d'autant son contenu. */
export const STRIPE_W = 4

/** Rond de couleur (pastille du formulaire, de la section). */
const dot = (c: GroupColor) => ({ backgroundColor: groupColorCss(c) })

/**
 * Formulaire d'un groupe : « Couleur (repère dans les listes) », une pastille ronde par couleur (36 px, espacées), celle du
 * groupe choisie ; mêmes droits que le reste du formulaire.
 */
export function GroupColorPicker({ value, onChange }: { value: GroupColor; onChange: (c: GroupColor) => void }) {
  return (
    <div role="radiogroup" aria-label="Couleur du groupe" className="flex flex-wrap gap-2">
      {GROUP_COLORS.map((c) => {
        const on = c === value
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={GROUP_TONES[c].label}
            title={GROUP_TONES[c].label}
            onClick={() => onChange(c)}
            className={`flex h-9 w-9 items-center justify-center rounded-full outline-offset-2 ${on ? 'ring-2 ring-fg ring-offset-2 ring-offset-panel' : ''}`}
            style={dot(c)}
          >
            {on && <Icon name="check" className="h-4 w-4 text-panel" />}
          </button>
        )
      })}
    </div>
  )
}

/** Au-delà, la section montre les 8 plus utiles (repérés, puis ceux qui ont le plus de joueurs ici) et un champ de recherche. */
const SHOWN = 8

/**
 * Bas de la fenêtre « Filtres » de toutes les listes de joueurs : « Repérer des groupes ». Groupes visibles (comme la page
 * Groupes, sans les archivés sauf s'ils sont repérés), repérés d'abord puis par nom ; pour chacun sa couleur, son nom, ses
 * joueurs dans la liste (« 4 ici », si la liste est connue) et une bascule. 3 au plus : les autres sont alors grisés.
 */
export function GroupRingsSection({ players }: { players?: readonly { id: string }[] }) {
  const on = useGroupesReperes()
  const groups = useLiveQuery(() => loadTeams().then(() => db.groups.toArray().then((gs) => withPoleMembers(alive(gs).filter(can.seeGroup)))), [])
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const here = useMemo(() => (players ? new Set(players.map((p) => p.id)) : null), [players])
  const rows = useMemo(() => {
    const list = (groups ?? []).filter((g) => !g.archived || on.includes(g.id))
    // Repérés : les couleurs de leurs anneaux (src/groupRings.ts, resolveRingColors) ; les autres : la leur.
    const picked = on.flatMap((id) => list.find((g) => g.id === id) ?? [])
    const ringColor = new Map(resolveRingColors(picked).map((c, i) => [picked[i].id, c]))
    return list.map((g) => ({
      g,
      color: ringColor.get(g.id) ?? groupColorOf(g),
      on: on.includes(g.id),
      n: here ? countHere(g.playerIds, here) : undefined,
    }))
  }, [groups, on, here])
  if (!groups) return null
  // Groupes repérés encore là : la limite compte ceux-là (un groupe supprimé ne garde pas sa place).
  const live = on.filter((id) => rows.some((r) => r.g.id === id))
  const full = live.length >= MAX_REPERES
  const byName = (a: (typeof rows)[number], b: (typeof rows)[number]) => Number(b.on) - Number(a.on) || a.g.name.localeCompare(b.g.name, 'fr')
  const needle = q.trim().toLocaleLowerCase('fr')
  const many = rows.length > SHOWN
  let shown = needle ? rows.filter((r) => r.g.name.toLocaleLowerCase('fr').includes(needle)) : rows
  if (many && !all && !needle) {
    const keep = new Set([...rows].sort((a, b) => Number(b.on) - Number(a.on) || (b.n ?? 0) - (a.n ?? 0) || a.g.name.localeCompare(b.g.name, 'fr')).slice(0, SHOWN).map((r) => r.g.id))
    shown = rows.filter((r) => keep.has(r.g.id))
  }
  shown = [...shown].sort(byName)
  return (
    <FilterFold id="reperer" title="Repérer des groupes" summary={live.length ? rows.filter((r) => r.on).map((r) => r.g.name).join(' · ') : undefined}>
      {!rows.length && <p className="text-[11px] text-muted">Aucun groupe pour l’instant.</p>}
      {many && (
        <input className="field" type="search" placeholder="Chercher un groupe" aria-label="Chercher un groupe" value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <div role="group" aria-label="Groupes à repérer" className="flex flex-col gap-1">
        {shown.map(({ g, color, on: pressed, n }) => {
          const off = full && !pressed
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={pressed}
              disabled={off}
              title={off ? `${MAX_REPERES} groupes repérés au plus : retire-en un pour choisir celui-ci` : `${g.name} : ${pressed ? 'repéré — toucher pour ne plus le repérer' : 'toucher pour le repérer'}`}
              onClick={() => setGroupesReperes((cur) => toggleGroupe(cur.filter((id) => live.includes(id)), g.id))}
              className={`flex min-h-11 min-w-0 items-center gap-2.5 rounded-xl border px-2.5 text-left text-xs font-bold transition disabled:opacity-40 ${pressed ? 'border-accent bg-accent-soft' : 'border-line bg-panel-2 hover:text-fg'}`}
            >
              <span aria-hidden className="h-4 w-4 shrink-0 rounded-full" style={dot(color)} />
              <span className="min-w-0 flex-1 truncate">{g.name}</span>
              {n !== undefined && n > 0 && <span className="shrink-0 text-[10px] font-normal text-muted tabular-nums">{n.toLocaleString('fr-FR')} ici</span>}
              <span aria-hidden className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${pressed ? 'justify-end bg-accent' : 'justify-start bg-line'}`}>
                <span className="h-4 w-4 rounded-full bg-white shadow" />
              </span>
            </button>
          )
        })}
      </div>
      {full && <p className="text-[10px] text-muted">{MAX_REPERES} groupes repérés : retire-en un pour en choisir un autre.</p>}
      {many && !needle && (
        <button type="button" className="self-start text-[11px] font-bold text-accent underline-offset-2 hover:underline" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Voir moins de groupes' : `Voir tous les groupes (${rows.length})`}
        </button>
      )}
    </FilterFold>
  )
}
