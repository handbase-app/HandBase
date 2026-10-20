// Sections repliables des listes Événements et Groupes (src/components/FoldSection.tsx) : quelles sections partent
// repliées, sous quelle clé de session leur état est gardé, et le nombre affiché dans le titre (« Passés · 12 »).
// Pur : testé par tools/test-replier.ts.

/**
 * Sorte de section :
 *  - « current » : ce qui sert maintenant (à venir, groupes en cours, Pôles…) → dépliée au départ ;
 *  - « past » : événements passés → repliée au départ ;
 *  - « archived » : archivés (événements ou groupes) → repliée au départ.
 */
export type FoldKind = 'current' | 'past' | 'archived'

/** Dépliée au départ (avant tout choix de l'utilisateur pendant la session) ? */
export const startsOpen = (kind: FoldKind): boolean => kind === 'current'

/** Clé de session (sessionStorage) de l'état ouvert / fermé d'une section : « handbase.<page>.replier.<section> ». */
export const foldKey = (page: string, section: string): string => `handbase.${page}.replier.${section}`

/**
 * Nombre affiché dans le titre (« · 12 ») : rien quand il n'y a rien à compter (section vide ou nombre inconnu).
 * Filtre ou recherche actif : c'est le nombre d'éléments de la section qui répondent, visible même repliée.
 */
export const foldCount = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) || n <= 0 ? '' : String(Math.floor(n)))

