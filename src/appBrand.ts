import { useSyncExternalStore } from 'react'
import { appImagesOf, appNameOf, appSlugOf, cleanAppBrand, isDefaultAppBrand, type AppBrand } from './appBrandCore'

/*
 * Identité de l'appli en cours (nom, logos ; règles dans src/appBrandCore.ts). Lue dans la configuration partagée par
 * src/installation.ts (clé « appli »), recopiée sur l'appareil pour s'afficher dès le démarrage, avant la synchro (et sur
 * l'écran de connexion, où la configuration n'est pas encore lisible : dernière valeur connue, sinon Nextar).
 *
 * Partout où l'on voit le nom de l'appli : appName() (texte, hors React), useAppBrand() (composants, redessinés quand
 * le réglage change). Ne changent PAS : clés de stockage « handbase.* », base Dexie, formats de fichiers, chemins.
 */

/** Copie locale (clé technique, inchangée au renommage). */
const BRAND_KEY = 'handbase.appli'
const BASE = import.meta.env.BASE_URL

function readCached(): AppBrand {
  try {
    const s = localStorage.getItem(BRAND_KEY)
    return s ? cleanAppBrand(JSON.parse(s)) : {}
  } catch {
    return {}
  }
}

let brand: AppBrand = readCached()
const listeners = new Set<() => void>()

/** Titre de l'onglet du navigateur (le <title> d'index.html n'est que celui du premier affichage). */
function applyTitle() {
  if (typeof document !== 'undefined') document.title = appNameOf(brand)
}
applyTitle()

/** Nouvelle identité lue dans la configuration (src/installation.ts). */
export function setAppBrand(b: AppBrand) {
  if (JSON.stringify(b) === JSON.stringify(brand)) return
  brand = b
  try {
    if (isDefaultAppBrand(b)) localStorage.removeItem(BRAND_KEY)
    else localStorage.setItem(BRAND_KEY, JSON.stringify(b))
  } catch {
    /* stockage indisponible */
  }
  applyTitle()
  listeners.forEach((l) => l())
}

/** Identité enregistrée (réglée, sans les défauts). */
export const appBrand = (): AppBrand => brand
/** Nom de l'appli (« Nextar » par défaut). */
export const appName = () => appNameOf(brand)
/** Nom pour les fichiers téléchargés (« nextar »). */
export const appSlug = () => appSlugOf(brand)
/** Logo complet et pictogramme (adresses d'images). */
export const appImages = () => appImagesOf(brand, BASE)

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Identité de l'appli dans un composant : nom et images ; redessine quand le réglage change. */
export function useAppBrand() {
  const b = useSyncExternalStore(subscribe, appBrand, appBrand)
  return { name: appNameOf(b), ...appImagesOf(b, BASE), brand: b }
}
