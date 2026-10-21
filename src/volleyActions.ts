import type { PillLabel } from './seqPills'

/*
 * Actions du séquenceur pour le volley (phase 2 : service, réception, attaque, contre…), par identifiant d'action :
 * libellé court de la pastille, libellé long et pictogramme (src/seqPills.ts). Vide pour l'instant : à remplir avec les
 * actions retenues. Choisi par le sport de l'installation (PILLS_BY_SPORT dans src/seqPills.ts).
 */
export const VOLLEY_PILLS: Partial<Record<string, PillLabel>> = {}
