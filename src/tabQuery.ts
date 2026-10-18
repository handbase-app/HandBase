/*
 * Onglet d'une fiche gardé dans l'adresse (?onglet=…, sans paramètre pour l'onglet par défaut), et gardé quand on passe
 * d'un élément à l'autre (clic dans la liste de gauche, ‹ ›, ↑ ↓) : on compare la croissance de plusieurs joueurs sans
 * revenir chaque fois sur « Profil ». Même règle que les onglets d'un événement (src/pages/Events.tsx).
 */

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

/** Même chose pour la fiche d'un joueur, selon l'adresse ouverte (`pathname`, `current` : la page affichée). */
export const keepPlayerTab = (search: string, pathname: string, current: string) =>
  keepTab(search, current, PLAYER_TABS, PLAYER_TAB_DEFAULT, playerTabParam(pathname))
