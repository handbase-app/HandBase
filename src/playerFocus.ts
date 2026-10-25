/*
 * Lien vers un endroit précis de la fiche d'un joueur (?voir=…) : une ligne de « Mes suivis » (ou du fil « Quoi de neuf »)
 * ouvre la fiche directement sur ce qu'elle annonce.
 *   ?onglet=tests&voir=mesure:<critère>[:<mesure>]  courbe de ce critère (« Suivi des mesures »), la ligne de cette mesure
 *                                         marquée dans l'historique ; ou sa valeur si le critère n'a pas de courbe ;
 *   ?onglet=avis&voir=avis:<id>          cet avis, déplié, dans le « Détail des avis » (avis:tous : le détail des avis) ;
 *   ?voir=video:<id>                     cette vidéo (onglet Profil), lancée dans le lecteur quand elle s'y lit
 *                                         (video:toutes : la section Vidéos).
 * La fiche (src/pages/PlayerDetail.tsx) lit `voir`, le retire de l'adresse (remplacée : « Retour » ramène à l'écran
 * d'origine), puis fait venir l'élément marqué `data-voir="<type>:<id>"` à l'écran, un instant en évidence.
 * Logique pure : test dans tools/test-voir-fiche.ts.
 */
import { PLAYER_TAB_DEFAULT, PLAYER_TABS, withTab, type PlayerTab } from './tabQuery'

export const FOCUS_KEY = 'voir'
export const FOCUS_KINDS = ['mesure', 'avis', 'video'] as const
export type FocusKind = (typeof FOCUS_KINDS)[number]
export interface PlayerFocus {
  kind: FocusKind
  /** Critère (mesure), avis, vidéo ; « tous » / « toutes » : la section entière. */
  id: string
  /** Mesure : la ligne à marquer dans l'historique de la courbe. */
  row?: string
}

/** Onglet de la fiche où se trouve l'élément visé. */
export const FOCUS_TAB: Record<FocusKind, PlayerTab> = { mesure: 'tests', avis: 'avis', video: 'profil' }

/**
 * « mesure:taille » → { kind: 'mesure', id: 'taille' } ; « mesure:taille:<id> » → la ligne de cette mesure en plus ;
 * null si absent ou mal formé. Avis, vidéo : tout ce qui suit le premier « : » est l'identifiant.
 */
export function parseFocus(v: string | null | undefined): PlayerFocus | null {
  if (!v) return null
  const i = v.indexOf(':')
  if (i <= 0) return null
  const kind = FOCUS_KINDS.find((k) => k === v.slice(0, i))
  let id = v.slice(i + 1).trim()
  if (!kind || !id || id.length > 200) return null
  if (kind !== 'mesure') return { kind, id }
  const j = id.indexOf(':')
  const row = j > 0 ? id.slice(j + 1).trim() : ''
  if (j >= 0) id = id.slice(0, j).trim()
  if (!id) return null
  return row ? { kind, id, row } : { kind, id }
}

/** Valeur de l'attribut `data-voir` (et du paramètre) de l'élément visé. */
export const focusAttr = (f: PlayerFocus) => `${f.kind}:${f.id}`

/** Fiche du joueur ouverte sur l'élément visé (son onglet compris). */
export function focusLink(playerId: string, f: PlayerFocus): string {
  const q = new URLSearchParams(withTab('', FOCUS_TAB[f.kind], PLAYER_TABS, PLAYER_TAB_DEFAULT))
  q.set(FOCUS_KEY, f.kind === 'mesure' && f.row ? `${focusAttr(f)}:${f.row}` : focusAttr(f))
  return `/joueurs/${encodeURIComponent(playerId)}?${q}`
}

/** `search` sans `voir` (les autres paramètres, dont l'onglet, restent). */
export function withoutFocus(search: string): string {
  const q = new URLSearchParams(search)
  q.delete(FOCUS_KEY)
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Nouveauté d'un joueur suivi (src/follows.ts) : ce qu'elle doit ouvrir sur sa fiche. */
export function focusOfNews(n: { kind: 'measurement' | 'evaluation' | 'video'; refId: string; criterionId?: string }): PlayerFocus {
  if (n.kind === 'measurement') return { kind: 'mesure', id: n.criterionId ?? n.refId, row: n.refId }
  return { kind: n.kind === 'evaluation' ? 'avis' : 'video', id: n.refId }
}

/**
 * Libellé accessible de la ligne : « Voir la courbe de taille de DUPONT Léo », « Voir l’avis de Stef sur … »,
 * « Voir la vidéo … de … ». `curve` : la mesure a une courbe (valeur chiffrée).
 */
export function focusLabel(n: { kind: 'measurement' | 'evaluation' | 'video'; label?: string; author?: string; curve?: boolean }, who: string): string {
  const what = (n.label ?? '').trim()
  // « Taille » → « taille », mais « VMA » reste « VMA ».
  const lower = /^\p{Lu}\p{Ll}/u.test(what) ? what.charAt(0).toLowerCase() + what.slice(1) : what
  if (n.kind === 'measurement') return n.curve === false ? `Voir la mesure « ${what} » de ${who}` : `Voir la courbe de ${lower || 'cette mesure'} de ${who}`
  if (n.kind === 'evaluation') return n.author ? `Voir l’avis de ${n.author} sur ${who}` : `Voir cet avis sur ${who}`
  return what ? `Voir la vidéo « ${what} » de ${who}` : `Voir la vidéo de ${who}`
}
