import { alive, db, today, type Player, type PlayerGroup } from './db'
import { officialRegions, regionOfDept } from './lists'
import { materializePoleGroups, poleRefsOf, seasons } from './poleSeason'

/*
 * Membres des groupes Pôle pour les lectures hors React (src/poleSeason.ts, materializePoleGroups) : filtres et recettes
 * de la liste Joueurs, questions, suivis, pictogrammes, fil d'actu, export d'une fiche. Même calcul que la page Groupes
 * (src/components/PoleGroup.tsx, usePoleRefs + usePoleCount) : unités et niveaux de l'appareil, ligues des Réglages (à
 * défaut le découpage officiel), fiches vivantes, vue « Saison en cours ».
 *
 * Les copies rendues ne s'enregistrent JAMAIS : aucun écran ne sauve un groupe venu d'ici (les ajouts au groupe Pôle
 * passent par les périodes des fiches, components/Groups.tsx). Ne pas s'en servir pour un groupe qu'on va modifier.
 */

/** Tables lues en plus des groupes (à ajouter aux requêtes relancées par table, src/live.ts). */
export const POLE_MEMBER_TABLES = ['players', 'units', 'levels', 'lists']

/**
 * Groupes avec les membres en cours de chaque groupe Pôle (copie) ; les autres tels quels. Sans groupe Pôle, rien d'autre
 * n'est lu. `players` : les fiches déjà lues par l'appelant (les supprimées sont écartées), sinon lues ici.
 */
export async function withPoleMembers<G extends Pick<PlayerGroup, 'poleUnitId' | 'playerIds'>>(
  groups: G[],
  players?: readonly Pick<Player, 'id' | 'poles' | 'deleted'>[],
): Promise<G[]> {
  if (!groups.some((g) => g.poleUnitId)) return groups
  const [units, levels, regions, all] = await Promise.all([
    db.units.toArray().then(alive),
    db.levels.toArray(),
    // Même ordre que useRegions (src/lists.ts) : la première ligue reconnue par son nom l'emporte.
    db.lists.where('kind').equals('region').toArray().then((rs) => alive(rs).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'fr'))),
    players ?? db.players.toArray(),
  ])
  const refs = poleRefsOf(units, levels, { regions: regions.length ? regions : officialRegions(), regionOfDept })
  return materializePoleGroups(groups, refs, all.filter((p) => !p.deleted), seasons(today()).refCurrent)
}
