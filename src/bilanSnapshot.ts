/*
 * Dernière carte du bilan gardée sur l'appareil (localStorage) : à l'ouverture de l'appli directement sur le bilan (ou au
 * premier passage, avant que la base soit lue), la carte est dessinée tout de suite avec les couleurs, les chiffres et la
 * légende de la dernière visite de la MÊME vue, marquée « mise à jour… » ; la page complète la remplace dès que les
 * données sont lues (tools/bench-page-bilan.mjs : sur un téléphone simulé ×4, ~1 s au lieu de ~5 s pour une carte en
 * couleur au démarrage). Seulement des chiffres par zone (aucun nom, aucun identifiant de joueur).
 *
 * Clé : base locale, compte, rôle et état complet du bilan (onglet, filtres, lieu, vue, club…) : une autre vue, un autre
 * compte ou un autre rôle n'en reprend jamais. Rien n'est gardé ni montré pendant « Voir comme… », pour une question ou
 * avec la barre de filtres (la page décide : snapshotKey null). Les SNAP_MAX dernières vues sont gardées.
 */

/** Légende de la carte (src/pages/Coverage.tsx MapLegend). */
export type SnapLegend = { sc: { lo: number; hi: number; count?: boolean; digits?: number; unit?: string }; title?: string; note?: string; g?: 'M' | 'F' | 'mixte' }

export interface MapSnapshot {
  /** Couleur de chaque zone (numéro de département), telle que la carte l'a demandée. */
  fills: [string, string][]
  /** Chiffre écrit dans une zone : clé « r:<région> » ou « d:<département> ». */
  labels: [string, string][]
  legend: SnapLegend
  /** Pastille « Autres outre-mer ». */
  others: boolean
}

type Entry = { key: string; snap: MapSnapshot }

export const SNAP_KEY = 'handbase.bilan.carte'
export const SNAP_MAX = 6

/** Clé d'une vue (parties jointes) ; une partie vide reste à sa place (pas de confusion entre deux vues). */
export const snapshotKey = (parts: readonly string[]) => JSON.stringify(parts)

/** Liste gardée avec cette vue en tête (remplacée si elle y était), les plus anciennes au-delà de `max` oubliées. */
export function putSnapshot(list: readonly Entry[], key: string, snap: MapSnapshot, max = SNAP_MAX): Entry[] {
  return [{ key, snap }, ...list.filter((e) => e.key !== key)].slice(0, max)
}

/** Carte gardée pour cette vue, ou null. */
export const findSnapshot = (list: readonly Entry[], key: string): MapSnapshot | null => list.find((e) => e.key === key)?.snap ?? null

/** Lecture tolérante : stockage absent, bloqué ou abîmé → liste vide. */
export function parseSnapshots(raw: string | null): Entry[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter(
      (e): e is Entry =>
        !!e && typeof e.key === 'string' && !!e.snap && Array.isArray(e.snap.fills) && Array.isArray(e.snap.labels) && !!e.snap.legend && typeof e.snap.legend.sc?.lo === 'number',
    )
  } catch {
    return []
  }
}

const read = () => {
  try {
    return parseSnapshots(localStorage.getItem(SNAP_KEY))
  } catch {
    return []
  }
}

export const readSnapshot = (key: string) => findSnapshot(read(), key)

/** Dernière carte écrite (par clé) : rien n'est réécrit tant qu'elle ne change pas. */
const written = new Map<string, string>()

export function writeSnapshot(key: string, snap: MapSnapshot) {
  const text = JSON.stringify(snap)
  if (written.get(key) === text) return
  written.set(key, text)
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(putSnapshot(read(), key, snap)))
  } catch {
    /* stockage indisponible ou plein : la carte sera simplement dessinée sans couleur au prochain démarrage */
  }
}
