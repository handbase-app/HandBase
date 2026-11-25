import type { HBEvent, Tournament } from './db'

/*
 * « Dupliquer l'événement » (menu ⋮ d'un événement) : partie pure. La petite fenêtre demande quoi copier ; le brouillon
 * construit ici pré-remplit la fenêtre de création (NewEventForm, src/pages/Evaluate.tsx), qui l'enregistre comme une
 * création normale. Rien n'est écrit avant « Créer », et l'original n'est jamais touché.
 * Toujours repris : type, lieu, organisateur, sexe, participants (encadrants) et groupes de travail.
 * Jamais repris : avis, notes, « vu », « à revoir » (ils vivent dans leurs propres tables, liés à l'événement d'origine),
 * feuille de match et résultats, archivage, heure (lue sur la feuille de match).
 */

/** Ce qu'on copie (cases de la fenêtre « Dupliquer l'événement », toutes cochées au départ). */
export type CopyOptions = {
  /** « Liste des joueurs » : mêmes joueurs (et qui les avait ajoutés), sans leurs avis. */
  players: boolean
  /** « Nom + (copie) » : sinon le même nom. */
  rename: boolean
  /** « Date : aujourd'hui » : sinon la date de l'original. */
  today: boolean
  /** « Équipes » : équipes engagées et numéros de maillot (et équipes confiées aux observateurs), sans résultats. */
  teams: boolean
}

export const ALL_COPY: CopyOptions = { players: true, rename: true, today: true, teams: true }

/** Brouillon d'événement à créer (champs du formulaire de création, plus la liste et les équipes copiées). */
export type EventDraft = Pick<HBEvent, 'name' | 'type' | 'date' | 'place' | 'sex' | 'organizerUnitId' | 'organizerName' | 'teams' | 'names'> & {
  editors: string[]
  playerIds?: string[]
  addedBy?: Record<string, string>
  tournament?: Tournament
  /** Nom de l'événement d'origine (texte d'aide du formulaire). */
  from: string
}

const COPY_RE = /\s*\(copie(?:\s+(\d+))?\)\s*$/i
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr')

/**
 * « <titre> (copie) », ou « (copie 2) », « (copie 3) »… si ce nom existe déjà. Dupliquer une copie repart du titre
 * d'origine : « Tournoi (copie) » → « Tournoi (copie 2) » (et non « Tournoi (copie) (copie) »).
 */
export function copyTitle(name: string, existing: Iterable<string>): string {
  const base = name.replace(COPY_RE, '').trim() || name.trim()
  const taken = new Set([...existing].map(norm))
  for (let n = 1; ; n++) {
    const t = `${base} (copie${n > 1 ? ` ${n}` : ''})`
    if (!taken.has(norm(t))) return t
  }
}

/** L'événement a-t-il des équipes à copier (tournoi réparti, match rangé en deux équipes) ? */
export const hasTeams = (ev: Pick<HBEvent, 'tournament'>) => (ev.tournament?.teams.length ?? 0) > 0

/** Équipes copiées : les équipes ; avec la liste, l'équipe et le numéro de chaque joueur copié ; les équipes confiées. */
function copyTournament(t: Tournament, players: readonly string[] | undefined): Tournament {
  const ids = new Set(t.teams.map((x) => x.id))
  const keep = players ? new Set(players) : null
  const out: Tournament = { teams: t.teams.map((x) => ({ ...x })) }
  if (keep && t.players) {
    const ps = Object.fromEntries(
      Object.entries(t.players)
        .filter(([pid]) => keep.has(pid))
        .map(([pid, v]) => [pid, { ...(v.team && ids.has(v.team) ? { team: v.team } : {}), ...(v.num ? { num: v.num } : {}) }] as const)
        .filter(([, v]) => v.team || v.num),
    )
    if (Object.keys(ps).length) out.players = ps
  }
  if (t.assign) {
    const as = Object.fromEntries(
      Object.entries(t.assign)
        .map(([uid, ts]) => [uid, ts.filter((x) => ids.has(x))] as const)
        .filter(([, ts]) => ts.length),
    )
    if (Object.keys(as).length) out.assign = as
  }
  return out
}

/**
 * Brouillon de la copie de `ev` selon `opts`. `existing` : noms des événements déjà là (pour « (copie 2) ») ;
 * `todayIso` : date du jour (AAAA-MM-JJ).
 */
export function buildCopyDraft(ev: HBEvent, opts: CopyOptions, existing: Iterable<string>, todayIso: string): EventDraft {
  const players = opts.players && ev.playerIds?.length ? [...new Set(ev.playerIds)] : undefined
  const addedBy = players && ev.addedBy ? Object.fromEntries(players.filter((pid) => ev.addedBy![pid]).map((pid) => [pid, ev.addedBy![pid]])) : undefined
  return {
    from: ev.name,
    name: opts.rename ? copyTitle(ev.name, existing) : ev.name,
    type: ev.type,
    date: opts.today ? todayIso : ev.date,
    place: ev.place,
    sex: ev.sex,
    organizerUnitId: ev.organizerUnitId,
    organizerName: ev.organizerName,
    editors: [...(ev.editors ?? [])],
    teams: ev.teams?.length ? [...ev.teams] : undefined,
    names: ev.names ? { ...ev.names } : undefined,
    playerIds: players,
    addedBy: addedBy && Object.keys(addedBy).length ? addedBy : undefined,
    tournament: opts.teams && ev.tournament && hasTeams(ev) ? copyTournament(ev.tournament, players) : undefined,
  }
}
