import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { alive, counts, db, POSITIONS, today, type Player } from './db'
import { useAlerts } from './alerts'
import { useFollows } from './follows'
import { regionOfDept, useDepartments, useRegionLabel } from './lists'
import { useThrottledQuery } from './live'
import { can } from './roles'
import { scoutId } from './scouting'
import { loadTeams } from './teams'
import { categoryStyles, styleOf } from './radarZones'
import { buildIndex, type Names, type QSight, type QuestionContext } from './recipe'
import { useVoicePlaces } from './voicePlaces'
import { useDeptName } from './components/FranceMap'
import { department } from './components/PlayerFilter'
import type { MirrorSource } from './components/SqlAnswer'

/*
 * Données de « Poser une question » (bilan de détection) et de la liste Joueurs (filtres = recette, src/playerQuery.ts) :
 * joueurs, passages (événement et personne), avis validés, mesures, critères, groupes visibles, événements, lus sur
 * l'appareil (Dexie) ; index de la recette, contexte de relecture (listes réelles, jamais envoyées), noms affichés, et
 * source de la copie locale du mode avancé. `enabled` : la liste Joueurs ne charge tout cela qu'au besoin (condition
 * « vu », avis, mesures, phrase posée).
 */

/** Mes suivis, joueurs avec une vidéo, joueurs de chaque profil recherché (filtres rapides de la liste Joueurs). */
export function useQuickSets() {
  const followed = useFollows()?.followed
  const alerts = useAlerts()?.alerts
  const videos = useLiveQuery(
    async () => new Set((await db.videos.toArray()).filter((v) => !v.deleted && v.targetKind === 'player').map((v) => v.targetId)),
    [],
    new Set<string>(),
  )
  return useMemo(
    () => ({
      followed: followed ?? new Set<string>(),
      videos,
      profileMembers: new Map((alerts ?? []).map((a) => [a.alert.id, new Set(a.players.map((p) => p.id))])),
      profiles: (alerts ?? []).map((a) => ({ id: a.alert.id, name: a.alert.name })),
    }),
    [followed, alerts, videos],
  )
}

/** Joueurs, passages (événement et personne), avis validés, mesures, critères, groupes visibles, événements. */
export function useQuestionData(enabled = true) {
  return useThrottledQuery(
    async () => {
      if (!enabled) return undefined
      const [players, seen, evals, events, measures, criteria, groups] = await Promise.all([
        db.players.toArray(),
        db.seen.toArray(),
        db.evaluations.toArray(),
        db.events.toArray(),
        db.measurements.toArray(),
        db.criteria.toArray(),
        loadTeams().then(() => db.groups.toArray()),
      ])
      const dead = new Set(events.filter((e) => e.deleted).map((e) => e.id))
      const me = scoutId()
      const dayOf = (s: string) => (s.length <= 10 ? s : new Date(Date.parse(s)).toLocaleDateString('sv'))
      // Passages, comme le bilan (src/coverage.ts toSights) : « vu » et avis (hors cadre exclus), avec l'événement et la personne.
      const sights: QSight[] = []
      // Noms des personnes du staff (signature du serveur, auteur de l'avis) : lus ici, affichés, jamais envoyés.
      const staff = new Map<string, string>()
      const named = (id: string | undefined, name: string | undefined) => id && name?.trim() && !staff.has(id) && staff.set(id, name.trim())
      for (const s of seen) {
        if (s.deleted || dead.has(s.eventId)) continue
        const when = s.at ?? s.createdAtServer
        const mine = !!me && (s.createdBy ? s.createdBy === me : s.id.startsWith(`${me}:`))
        named(s.createdBy, s.createdByName)
        sights.push({
          playerId: s.playerId,
          day: when ? dayOf(when) : new Date(s.updatedAt).toLocaleDateString('sv'),
          event: s.eventId,
          person: s.createdBy ?? (mine ? me! : s.id.split(':')[0] || s.createdByName || '?'),
        })
      }
      for (const e of evals) {
        if (e.deleted || e.review === 'refused' || (e.eventId && dead.has(e.eventId))) continue
        const day = dayOf(e.date)
        named(e.observerId, e.observer)
        // Avis sans événement : un jour d'observation compte comme un événement.
        sights.push({ playerId: e.playerId, day, event: e.eventId || `jour:${day}`, person: e.observerId || e.observer || '?' })
      }
      return {
        players,
        sights,
        staff,
        // Moyennes : avis validés seulement (comme la comparaison et le classement).
        evals: evals
          .filter((e) => !e.deleted && counts(e))
          .map((e) => ({ playerId: e.playerId, observer: e.observerId || e.observer, day: dayOf(e.date), scores: e.scores })),
        measures,
        criteria: alive(criteria),
        groups: alive(groups).filter((g) => can.seeGroup(g)),
        events: alive(events),
        // Mode avancé (copie locale en tables, src/sqlMirror.ts) : avis tels quels, en attente compris (colonne « valide »).
        rawEvals: evals.filter((e) => !e.deleted && e.review !== 'refused' && !(e.eventId && dead.has(e.eventId))),
      }
    },
    [enabled],
    ['players', 'seen', 'evaluations', 'events', 'measurements', 'criteria', 'groups', 'teams'],
    300,
  )
}

export type QuestionData = NonNullable<ReturnType<typeof useQuestionData>>

/** Noms affichés (pastilles, tableaux) : lus dans les listes de l'appli et sur l'appareil, jamais envoyés. */
export function useRecipeNames(
  data: { groups: { id: string; name: string }[]; events: { id: string; name: string }[]; criteria: { id: string; label: string; unit?: string }[]; staff?: Map<string, string> } | undefined,
  clubNames: Map<string, string> | undefined,
  profiles: { id: string; name: string }[] = [],
): Names {
  const regionLabel = useRegionLabel()
  const deptName = useDeptName()
  return useMemo<Names>(
    () => ({
      region: (id) => regionLabel(id),
      dept: (c) => `${deptName(c)} (${c})`,
      club: (k) => clubNames?.get(k) ?? k,
      group: (id) => data?.groups.find((g) => g.id === id)?.name ?? 'groupe',
      event: (id) => data?.events.find((e) => e.id === id)?.name ?? 'événement',
      criterion: (id) => data?.criteria.find((c) => c.id === id)?.label ?? 'critère',
      unit: (id) => data?.criteria.find((c) => c.id === id)?.unit,
      position: (id) => POSITIONS.find((p) => p.id === id)?.label ?? id,
      // Une personne sans nom connu est l'auteur d'un avis écrit hors ligne : son nom tel qu'écrit, sinon « Moi ».
      staff: (id) => data?.staff?.get(id) ?? (id === scoutId() ? 'Moi' : /^[0-9a-f-]{30,}$/i.test(id) ? 'Personne du staff' : id),
      profile: (id) => profiles.find((p) => p.id === id)?.name ?? 'profil recherché',
      today: today(),
    }),
    [data, clubNames, profiles, regionLabel, deptName],
  )
}

/** Données indexées, contexte de relecture (listes réelles) et noms affichés. */
export function useQuestionModel(enabled = true) {
  const data = useQuestionData(enabled)
  const lists = useDepartments()
  const deptName = useDeptName()
  const places = useVoicePlaces()
  const quick = useQuickSets()
  const index = useMemo(() => {
    if (!data) return null
    const styles = categoryStyles(data.criteria)
    return buildIndex<Player>({
      ...data,
      deptOf: department,
      regionOf: (d) => regionOfDept(d),
      zoneOf: (c) => styleOf(styles, c).zone,
      today: today(),
      followed: quick.followed,
      videos: quick.videos,
      profileMembers: quick.profileMembers,
    })
  }, [data, lists, quick]) // eslint-disable-line react-hooks/exhaustive-deps
  const ctx = useMemo<QuestionContext | null>(() => {
    if (!index || !data) return null
    // Clubs : nom affiché et département de la plupart de leurs joueurs.
    const depts = new Map<string, Map<string, number>>()
    for (const p of index.players) {
      const i = index.info.get(p.id)!
      if (!i.club || !i.dept) continue
      const m = depts.get(i.club) ?? new Map<string, number>()
      depts.set(i.club, m)
      m.set(i.dept, (m.get(i.dept) ?? 0) + 1)
    }
    const top = (m?: Map<string, number>) => (m ? [...m].sort((a, b) => b[1] - a[1])[0]?.[0] : undefined)
    return {
      ...places,
      positions: POSITIONS,
      clubs: [...index.clubNames].map(([key, name]) => ({ key, name, dept: top(depts.get(key)) })),
      groups: data.groups.map((g) => ({ id: g.id, name: g.name })),
      events: data.events.map((e) => ({ id: e.id, name: e.name, date: e.date })),
      criteria: data.criteria,
      zoneOf: index.data.zoneOf,
      today: today(),
      profiles: quick.profiles,
    }
  }, [index, data, places, quick.profiles])
  const names = useRecipeNames(data, index?.clubNames, quick.profiles)
  const byId = useMemo(() => new Map((data?.players ?? []).map((p) => [p.id, p])), [data])
  // Mode avancé : données de la copie locale (construite seulement à la première requête, src/sqlClient.ts).
  const source = useMemo<MirrorSource>(
    () =>
      data && index
        ? () => ({
            players: data.players,
            sights: data.sights,
            evals: data.rawEvals,
            measures: data.measures,
            criteria: data.criteria,
            groups: data.groups,
            events: data.events,
            deptOf: department,
            regionOf: (d) => regionOfDept(d),
            regionName: names.region,
            deptName: (c) => deptName(c),
            zoneOf: index.data.zoneOf,
            staffName: names.staff!,
            today: today(),
          })
        : null,
    [data, index, names, deptName],
  )
  return { data, index, ctx, names, byId, source, quick }
}

export type QuestionModel = ReturnType<typeof useQuestionModel>
