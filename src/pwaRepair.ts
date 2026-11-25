/*
 * Filet de sécurité des mises à jour (src/pwa.ts), partie pure (testée : npx jiti tools/test-pwa-reparation.ts).
 *
 * Panne vue le 23/11 : pendant la copie d'une nouvelle version sur le serveur, un appareil a vérifié trop tôt ; le nouveau
 * service worker a demandé un fichier de la nouvelle version pas encore copié (404) et son installation a échoué
 * (« redundant »). Ce 404 portait l'en-tête « immuable un an » des /assets/ : le navigateur l'a gardé et chaque nouvel
 * essai retombait dessus, sans jamais de version en attente (pas de bandeau, « dernière version » dans Réglages).
 * Corrigé à la source (vite.config.ts : tous les fichiers installés d'avance sont redemandés au serveur, jamais pris dans
 * le cache du navigateur) ; ce filet couvre les autres causes : le serveur annonce une version plus récente (version.json,
 * écrit à la construction) et aucune n'attend après une vérification → on désinstalle le service worker, on efface ses
 * fichiers installés d'avance (caches workbox-precache*, jamais les autres ni la base locale) et on recharge.
 */

/** Caches à effacer pour réparer : ceux des fichiers installés d'avance (workbox-precache-v2-…), aucun autre. */
export const precacheCaches = (keys: readonly string[]) => keys.filter((k) => k.startsWith('workbox-precache'))

/** Heure de construction lue dans version.json ({ build: "2026-11-23T21:18:00.000Z" }), ou null. */
export function versionOf(json: unknown): string | null {
  const b = json && typeof json === 'object' ? (json as { build?: unknown }).build : undefined
  return typeof b === 'string' && !Number.isNaN(Date.parse(b)) ? b : null
}

/** Le serveur a-t-il une version construite APRÈS la mienne ? (Inconnu, invalide ou plus ancienne : non.) */
export function serverIsNewer(server: string | null | undefined, mine: string): boolean {
  if (!server || !mine) return false
  const s = Date.parse(server)
  const m = Date.parse(mine)
  return Number.isFinite(s) && Number.isFinite(m) && s > m
}

/** Dernière réparation tentée (gardée sur l'appareil) : vers quelle version, et quand. */
export interface RepairAttempt {
  target: string
  at: number
}
/** Pas deux réparations automatiques vers la même version en moins de 15 minutes (pas de boucle de rechargements). */
export const REPAIR_COOLDOWN_MS = 15 * 60 * 1000

export interface RepairInput {
  /** version.json du serveur (null : illisible, hors ligne, version de développement). */
  server: string | null
  /** BUILD_TIME de la page ouverte. */
  mine: string
  /** Une nouvelle version attend déjà (bandeau « Mettre à jour ») : le chemin normal suffit. */
  waiting: boolean
  /** Dernière réparation tentée. */
  last: RepairAttempt | null
  now: number
  /** « Vérifier les mises à jour » touché : la personne le demande, pas de délai entre deux essais. */
  manual?: boolean
}

/**
 * 'none' : rien à réparer (à jour, ou la nouvelle version attend normalement) ; 'repair' : version plus récente sur le
 * serveur sans version en attente ; 'cooldown' : il faudrait réparer mais on vient d'essayer vers cette même version.
 */
export function repairDecision(i: RepairInput): 'none' | 'repair' | 'cooldown' {
  if (i.waiting || !serverIsNewer(i.server, i.mine)) return 'none'
  if (!i.manual && i.last && i.last.target === i.server && i.now - i.last.at >= 0 && i.now - i.last.at < REPAIR_COOLDOWN_MS)
    return 'cooldown'
  return 'repair'
}

/** Relecture prudente de la dernière réparation gardée (JSON abîmé : null). */
export function parseAttempt(raw: string | null | undefined): RepairAttempt | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<RepairAttempt>
    return typeof v?.target === 'string' && typeof v.at === 'number' && Number.isFinite(v.at) ? { target: v.target, at: v.at } : null
  } catch {
    return null
  }
}

/**
 * Fichiers de démarrage de la nouvelle version, lus dans son index.html : script principal, modules préchargés, feuilles
 * de style (adresses relatives à l'appli, sans doublon). Avant de réparer, on vérifie qu'ils sont bien sur le serveur
 * (copie terminée) : sinon le rechargement tomberait sur une page blanche.
 */
export function entryAssets(html: string, base = '/'): string[] {
  const out = new Set<string>()
  const re = /<(?:script|link)\b[^>]*?\b(?:src|href)=["']([^"']+)["'][^>]*>/gi
  for (const m of html.matchAll(re)) {
    const tag = m[0]
    const url = m[1]
    if (/^<link/i.test(tag) && !/\brel=["']?(?:modulepreload|stylesheet)\b/i.test(tag)) continue
    if (/^[a-z]+:|^\/\//i.test(url)) continue // autre site (polices…)
    const path = url.startsWith('/') ? url : base.replace(/\/?$/, '/') + url.replace(/^\.\//, '')
    if (/\/assets\//.test(path)) out.add(path)
  }
  return [...out]
}
