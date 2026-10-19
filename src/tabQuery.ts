/*
 * Onglet d'une fiche gardé dans l'adresse (?onglet=…, sans paramètre pour l'onglet par défaut), et gardé quand on passe
 * d'un élément à l'autre (clic dans la liste de gauche, ‹ ›, ↑ ↓) : on compare la croissance de plusieurs joueurs sans
 * revenir chaque fois sur « Profil ». Même règle que les onglets d'un événement (src/pages/Events.tsx).
 */
import { POLE_VIEW_DEFAULT, POLE_VIEWS, type PoleView } from './poleSeason'

/** Onglets de la fiche d'un joueur (src/pages/PlayerDetail.tsx), « profil » par défaut. */
export const PLAYER_TABS = ['profil', 'tests', 'avis', 'croissance'] as const
export type PlayerTab = (typeof PLAYER_TABS)[number]
export const PLAYER_TAB_DEFAULT: PlayerTab = 'profil'

/**
 * Paramètre de l'onglet de la fiche d'un joueur. Sous /bilan/joueurs, `onglet` est déjà celui du bilan (licenciés, vus…),
 * gardé d'un joueur à l'autre pour la liste de gauche et le retour : la fiche y prend `fiche`.
 */
export const playerTabParam = (pathname: string) => (pathname.startsWith('/bilan/joueurs') ? 'fiche' : 'onglet')

/** Onglet lu dans `search` s'il fait partie de `tabs` ; sinon (absent, inconnu) l'onglet par défaut. */
export function tabOf<T extends string>(search: string, tabs: readonly T[], def: T, key = 'onglet'): T {
  const v = new URLSearchParams(search).get(key)
  return tabs.find((t) => t === v) ?? def
}

/**
 * `search` (« ?… » ou vide) avec l'onglet `tab` à la place de celui qu'il porte ; sans paramètre pour l'onglet par
 * défaut ou un onglet que l'élément n'a pas. Les autres paramètres (état de la liste d'origine) restent tels quels.
 */
export function withTab(search: string, tab: string | null | undefined, tabs: readonly string[], def: string, key = 'onglet'): string {
  const q = new URLSearchParams(search)
  q.delete(key)
  if (tab && tab !== def && tabs.includes(tab)) q.set(key, tab)
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** `search` de l'élément suivant : celui de la liste (`search`), plus l'onglet ouvert maintenant (`current`). */
export const keepTab = (search: string, current: string, tabs: readonly string[], def: string, key = 'onglet') =>
  withTab(search, new URLSearchParams(current).get(key), tabs, def, key)


/**
 * Vue du radar des avis (comparaison, src/pages/Compare.tsx, et fiche d'un joueur, src/components/Opinions.tsx ; ?radar=…) : « complet » ou « familles ». Sans paramètre, selon
 * l'écran (complet sur écran large, par famille sur téléphone) ; un choix est toujours écrit dans l'adresse, pour que le
 * lien partagé ouvre la même vue sur un autre écran.
 */
export const RADAR_VIEWS = ['complet', 'familles'] as const
export type RadarView = (typeof RADAR_VIEWS)[number]
export const RADAR_KEY = 'radar'
export const radarViewOf = (search: string, phone: boolean): RadarView => tabOf(search, RADAR_VIEWS, phone ? 'familles' : 'complet', RADAR_KEY)
/** `search` avec la vue `view` (jamais retirée : pas de défaut commun à tous les écrans), autres paramètres gardés. */
export const withRadarView = (search: string, view: RadarView) => withTab(search, view, RADAR_VIEWS, '', RADAR_KEY)

/**
 * Même chose pour la fiche d'un joueur, selon l'adresse ouverte (`pathname`, `current` : la page affichée). La vue du
 * radar des avis (?radar=…) choisie sur la fiche reste aussi la même d'un joueur à l'autre.
 */
export function keepPlayerTab(search: string, pathname: string, current: string) {
  const s = keepTab(search, current, PLAYER_TABS, PLAYER_TAB_DEFAULT, playerTabParam(pathname))
  const radar = RADAR_VIEWS.find((v) => v === new URLSearchParams(current).get(RADAR_KEY))
  return radar ? withRadarView(s, radar) : s
}

/**
 * Vue d'un groupe Pôle (src/poleSeason.ts ; page du groupe, fiche ouverte depuis lui, export) : « Saison en cours »
 * (sans paramètre) ou « Saison prochaine » (?saison=prochaine). Gardée d'un joueur à l'autre et au retour.
 */
export const POLE_VIEW_KEY = 'saison'
export const poleViewOf = (search: string): PoleView => tabOf(search, POLE_VIEWS, POLE_VIEW_DEFAULT, POLE_VIEW_KEY)
export const withPoleView = (search: string, view: PoleView) => withTab(search, view, POLE_VIEWS, POLE_VIEW_DEFAULT, POLE_VIEW_KEY)
