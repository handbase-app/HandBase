import { accord, pluralG, w, type Gender } from './gender'

/*
 * Sélection multiple dans les listes de joueurs (bouton « Sélectionner » de la barre « Afficher »,
 * src/components/Selection.tsx) : partie pure, testée par tools/test-selection.ts.
 * Une sélection = des identifiants de joueurs, dans l'ordre où ils ont été cochés. Elle survit à un changement de
 * filtre ou de tri (ceux qui sortent du filtre restent comptés, « dont 2 hors du filtre ») ; pas à un changement de page.
 */

/** Au-delà, une action de masse demande confirmation. */
export const SEL_CONFIRM = 20
/** « Comparer » : 2 ou 3 joueurs. */
export const COMPARE_MIN = 2
export const COMPARE_MAX_SEL = 3

/** Cocher / décocher un joueur. */
export function toggleId(sel: readonly string[], id: string): string[] {
  return sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
}

/** Cocher ou décocher plusieurs joueurs d'un coup (ajoutés à la fin, sans doublon). */
export function setIds(sel: readonly string[], ids: readonly string[], on: boolean): string[] {
  if (!on) {
    const drop = new Set(ids)
    return sel.filter((x) => !drop.has(x))
  }
  const have = new Set(sel)
  const out = [...sel]
  for (const id of ids) if (!have.has(id)) (have.add(id), out.push(id))
  return out
}

/** « Tout » : toute la liste filtrée (`all`, y compris au-delà de « Afficher plus »), en plus de ce qui était coché. */
export const selectAll = (sel: readonly string[], all: readonly string[]) => setIds(sel, all, true)

/** « Garder seulement ceux affichés » : ceux de la sélection encore dans la liste filtrée. */
export function keepOnly(sel: readonly string[], all: readonly string[]): string[] {
  const set = new Set(all)
  return sel.filter((x) => set.has(x))
}

/**
 * Combien sont cochés ; parmi eux, combien sont hors de la liste filtrée (`all`) et combien sont dans la liste filtrée
 * mais pas encore affichés (`shown` : la page en cours, avant « Afficher plus ») ; `allIn` : toute la liste est cochée.
 */
export function selectionStats(
  sel: readonly string[],
  all: readonly string[],
  shown: readonly string[] = all,
): { n: number; outside: number; below: number; allIn: boolean } {
  const inAll = new Set(all)
  const inShown = new Set(shown)
  let outside = 0
  let below = 0
  for (const id of sel) {
    if (!inAll.has(id)) outside++
    else if (!inShown.has(id)) below++
  }
  return { n: sel.length, outside, below, allIn: inAll.size > 0 && sel.length - outside === inAll.size }
}

/** « 120 joueuses sélectionnées · dont 60 plus bas · dont 2 hors du filtre » ; « Aucun joueur sélectionné ». */
export function selectionLabel(n: number, outside: number, g?: Gender, below = 0): string {
  if (!n) return g === 'F' ? 'Aucune joueuse sélectionnée' : 'Aucun joueur sélectionné'
  return [pluralG(n, g, 'joueur sélectionné'), below && `dont ${below} plus bas (pas encore ${accord('affiché', g, below)})`, outside && `dont ${outside} hors du filtre`]
    .filter(Boolean)
    .join(' · ')
}

/** Confirmation au-delà de SEL_CONFIRM joueurs. */
export const needsConfirm = (n: number) => n > SEL_CONFIRM

export const canCompare = (n: number) => n >= COMPARE_MIN && n <= COMPARE_MAX_SEL

/** « Suivre » pour tous ; « Ne plus suivre » seulement si tous sont déjà suivis (par moi). */
export function followMode(sel: readonly string[], followed: ReadonlySet<string>): 'follow' | 'unfollow' {
  return sel.length > 0 && sel.every((id) => followed.has(id)) ? 'unfollow' : 'follow'
}

/** Actions de la barre, dans l'ordre d'affichage. */
export const SEL_ACTIONS = ['newGroup', 'addGroup', 'newEvent', 'addEvent', 'compare', 'follow', 'seen', 'rewatch'] as const
export type SelAction = (typeof SEL_ACTIONS)[number]

/** Ce que la liste et le compte permettent (droits can.* déjà évalués). */
export interface SelRights {
  manageGroups: boolean
  manageEvents: boolean
  /** Suivis personnels possibles (compte, ou mode local). */
  follow: boolean
  /** Observateur identifié (« vu », « à revoir »). */
  scout: boolean
  /** Liste d'un événement : « vu » existe seulement là (un « vu » est toujours lié à un événement). */
  eventId?: string
}

/** Actions affichées : seulement celles permises ; « Marquer vu » seulement dans un événement. */
export function selActions(r: SelRights): SelAction[] {
  return SEL_ACTIONS.filter((a) => {
    switch (a) {
      case 'newGroup':
      case 'addGroup':
        return r.manageGroups
      case 'newEvent':
      case 'addEvent':
        return r.manageEvents
      case 'compare':
        return true
      case 'follow':
        return r.follow
      case 'seen':
        return r.scout && !!r.eventId
      case 'rewatch':
        return r.scout
    }
  })
}

/** Message après une action : « 7 joueuses suivies (2 déjà) ». `done` : combien ont changé, `n` : combien visés. */
export function doneMessage(a: 'follow' | 'unfollow' | 'seen' | 'rewatch', done: number, n: number, g?: Gender): string {
  const already = n - done
  const rest = already > 0 ? ` (${already} déjà)` : ''
  const all = n > 1 ? `${w(g).tous} ` : ''
  switch (a) {
    case 'follow':
      return done ? `${pluralG(done, g, 'joueur suivi')}${rest}.` : `Déjà ${all}${accord('suivi', g, n)}.`
    case 'unfollow':
      return done ? `${pluralG(done, g)} de moins dans « Mes suivis ».` : 'Rien à changer.'
    case 'seen':
      return done ? `${pluralG(done, g, 'joueur marqué')} ${accord('vu', g, done)} à cet événement${rest}.` : `Déjà ${all}${accord('vu', g, n)} par toi ici.`
    case 'rewatch':
      return done ? `${pluralG(done, g, 'joueur ajouté')} à « À revoir »${rest}.` : `Déjà ${all}à revoir par toi.`
  }
}

/** Texte de la confirmation d'une action de masse. */
export function confirmText(action: string, n: number, g?: Gender) {
  return `${action} : ${pluralG(n, g)} ?`
}
