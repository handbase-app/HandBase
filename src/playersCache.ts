import { useEffect, useMemo, useState } from 'react'
import { alive, db, type Criterion, type HBEvent, type Measurement, type Player, type PlayerGroup } from './db'
import { sharedQuery, useShared } from './live'
import { loadTeams } from './teams'
import { withPoleMembers } from './poleMembers'
import { can } from './roles'
import { byLastName, cmpKey, inPlainList, latestByPlayer } from './playersOrder'

/*
 * Données de la liste Joueurs, gardées en mémoire pour toute l'appli (src/live.ts sharedQuery, `keep`) : lues une fois,
 * relues après un changement des tables (300 ms après, une seule fois pour un paquet de la synchro) ; revenir sur la liste
 * (retour d'une fiche, menu) l'affiche tout de suite. Lectures faites HORS useLiveQuery : Dexie n'y note pas chaque fiche
 * lue (40 000 joueurs, ~100 000 mesures : plusieurs secondes sur un téléphone, mesuré par tools/bench-page-joueurs.mjs).
 *
 * Premier passage (rien en mémoire) : usePlainPreview lit les premières fiches par l'index (quelques ms) pour les montrer
 * pendant que tout se lit.
 */

const DELAY = 300

/**
 * Premières fiches en cours de lecture (usePlainPreview) : les grandes lectures attendent qu'elles soient là (au plus
 * PREVIEW_WAIT ms). Sinon leurs résultats (des dizaines de milliers de lignes à décoder sur le fil principal) passent
 * devant les petites lectures des premières fiches, montrées alors à peine plus tôt que la liste complète.
 */
let previewGate: Promise<void> | null = null
const PREVIEW_WAIT = 600
const afterPreview = () => previewGate ?? Promise.resolve()

/**
 * Toutes les fiches, par paquets de CHUNK dans l'ordre de la clé primaire (même résultat que `db.players.toArray()`) : chaque
 * paquet est décodé dans sa propre tâche, le fil principal respire entre deux (défilement, frappe pendant la lecture).
 */
const CHUNK = 5000
async function readByChunks() {
  const out: Player[] = []
  for (;;) {
    const last = out.length ? out[out.length - 1].id : undefined
    const part = await (last === undefined ? db.players.limit(CHUNK) : db.players.where(':id').above(last).limit(CHUNK)).toArray()
    for (const p of part) out.push(p)
    if (part.length < CHUNK) return out
  }
}

/** Toutes les fiches non supprimées (`rows`, ordre de la clé primaire) et la liste par nom (`byName`, ordre de l'index). */
const playersStore = sharedQuery(
  ['players'],
  async () => {
    await afterPreview()
    const rows = alive(await readByChunks())
    return { rows, byName: byLastName(rows) }
  },
  DELAY,
  true,
)

/** Taille et poids (même ordre que `where('criterionId').anyOf('taille', 'poids')`), et la dernière valeur par joueur. */
const measuresStore = sharedQuery(
  ['measurements'],
  async () => {
    await afterPreview()
    // Deux lectures `equals` (getAll, rapides) plutôt qu'un anyOf (curseur, fiche par fiche) : poids puis taille, l'ordre de l'index.
    const [poids, taille] = await Promise.all(['poids', 'taille'].map((c) => db.measurements.where('criterionId').equals(c).toArray()))
    const measures: Measurement[] = poids.concat(taille)
    return { measures, latest: latestByPlayer(measures) }
  },
  DELAY,
  true,
)

/** Critères, groupes par nom (membres des groupes Pôle calculés, src/poleMembers.ts ; tous, la visibilité est vue à l'écran), événements. */
const listStore = sharedQuery(
  ['criteria', 'groups', 'teams', 'events', 'units', 'levels', 'lists', 'players'],
  async () => {
    await afterPreview()
    const [criteria, groups, events] = await Promise.all([db.criteria.toArray(), loadTeams().then(() => db.groups.orderBy('name').toArray()), db.events.toArray()])
    const live = alive(groups)
    // Groupes Pôle : membres lus dans les fiches déjà en mémoire (pas de deuxième lecture des 40 000 fiches).
    const players = live.some((g) => g.poleUnitId) ? (await playersStore.load()).rows : undefined
    return { criteria: alive(criteria), groups: await withPoleMembers(live, players), events: alive(events) }
  },
  DELAY,
  true,
)

/** Fiches non supprimées, par nom (comme `db.players.orderBy('lastName').toArray().then(alive)`) ; undefined pendant la 1re lecture. */
export function usePlayersByName(): Player[] | undefined {
  return useShared(playersStore)?.byName
}

/** Taille et poids de toute la base, et leur dernière valeur par joueur ; undefined pendant la 1re lecture. */
export function useListMeasures() {
  return useShared(measuresStore)
}

/**
 * Données « légères » des filtres de la liste (src/components/PlayersQuery.tsx) : mesures de taille et de poids, critères,
 * groupes que je vois (rôle relu à chaque montage, comme avant), événements.
 */
export function useListLight() {
  const m = useShared(measuresStore)
  const l = useShared(listStore)
  return useMemo(() => {
    if (!m || !l) return undefined
    const groups = l.groups.filter((g: PlayerGroup) => can.seeGroup(g))
    // Mêmes données et mêmes groupes visibles qu'au dernier montage : même objet (l'index de la liste n'est pas refait).
    const last = lastLight
    if (last && last.m === m && last.l === l && last.value.groups.length === groups.length && last.value.groups.every((g, i) => g === groups[i])) return last.value
    const value = { measures: m.measures, criteria: l.criteria, groups, events: l.events, staff: new Map<string, string>() }
    lastLight = { m, l, value }
    return value
  }, [m, l])
}
type ListLight = { measures: Measurement[]; criteria: Criterion[]; groups: PlayerGroup[]; events: HBEvent[]; staff: Map<string, string> }
let lastLight: { m: unknown; l: unknown; value: ListLight } | null = null

export type PlainPreview = { rows: Player[]; latest: Map<string, Map<string, Measurement>>; nPending: number; nRefused: number }

/**
 * Premières fiches de la liste sans filtre (vue « Base », filtre « Masculin / Féminin » seul permis), lues par l'index
 * « lastName » : mêmes fiches, même ordre que le début de la liste complète (tools/test-joueurs-cache.ts, et vérifié dans
 * un vrai navigateur par tools/bench-page-joueurs.mjs), avec leur taille et leur poids, et le nombre de fiches proposées et
 * hors cadre (onglets).
 */
export async function readPlainPreview(sex: 'M' | 'F' | undefined, n: number): Promise<PlainPreview> {
  // Lectures d'un seul coup (getAll, sans filtre Dexie qui ferait avancer un curseur fiche par fiche) : 3 fois plus de fiches
  // que nécessaire (supprimées, fondues, hors cadre, autre sexe écartées ici), puis 30 fois si cela ne suffit pas (au pire,
  // moins de n fiches : toujours le début exact de la liste).
  const first = async (k: number): Promise<Player[]> => {
    const got = await db.players.orderBy('lastName').limit(k).toArray()
    const kept = got.filter((p) => inPlainList(p, sex))
    return kept.length >= n || got.length < k || k >= n * 30 ? kept.slice(0, n) : first(n * 30)
  }
  const [rows, pending, refused] = await Promise.all([
    first(n * 3),
    db.players.where('review').equals('pending').toArray(),
    db.players.where('review').equals('refused').toArray(),
  ])
  const ms = (await Promise.all(rows.map((p) => db.measurements.where('playerId').equals(p.id).toArray()))).flat()
  // Même ordre que la lecture complète (poids puis taille, puis identifiant) : à égalité de date, la même mesure gagne.
  const kept = ms.filter((m) => m.criterionId === 'taille' || m.criterionId === 'poids').sort((a, b) => cmpKey(a.criterionId, b.criterionId) || cmpKey(a.id, b.id))
  return { rows, latest: latestByPlayer(kept), nPending: alive(pending).length, nRefused: alive(refused).length }
}

/**
 * readPlainPreview pendant que toute la base se lit (premier passage, rien en mémoire) ; les grandes lectures attendent la
 * fin de celle-ci (previewGate). `enabled` faux (liste déjà en mémoire, filtre posé) : rien n'est lu.
 */
export function usePlainPreview(enabled: boolean, sex: 'M' | 'F' | undefined, n: number): PlainPreview | undefined {
  const [state, setState] = useState<{ key: string; value: PlainPreview } | undefined>()
  const key = `${sex ?? ''}|${n}`
  useEffect(() => {
    if (!enabled || state?.key === key) return
    let live = true
    let open!: () => void
    const gate = new Promise<void>((ok) => (open = ok))
    previewGate = gate
    const timer = window.setTimeout(open, PREVIEW_WAIT)
    readPlainPreview(sex, n)
      .then((value) => live && setState({ key, value }))
      .catch((e) => console.error(e))
      .finally(() => {
        window.clearTimeout(timer)
        open()
        if (previewGate === gate) previewGate = null
      })
    return () => {
      live = false
    }
  }, [enabled, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return enabled && state?.key === key ? state.value : undefined
}
