import { appImagesOf, appNameOf, appSlugOf, type AppBrand } from './appBrandCore'

/*
 * Identité de l'appli (nom, logos ; règles dans src/appBrandCore.ts) : fixée à la construction, Nextar et ses logos de
 * public/brand/. Plus réglable dans l'appli (le 18/10/2026 : on recompile pour changer de nom ou de logo) ; la clé
 * « appli » de la configuration partagée et l'ancienne copie locale sont ignorées, la copie locale effacée au démarrage.
 *
 * Partout où l'on voit le nom de l'appli : appName() (texte, hors React), useAppBrand() (composants). Ne changent PAS : clés de stockage « handbase.* », base Dexie, formats de fichiers, chemins.
 */

/** Copie locale (clé technique, inchangée au renommage). */
const BRAND_KEY = 'handbase.appli'
const BASE = import.meta.env.BASE_URL

// Ancienne copie locale d'un nom / logo réglé : effacée (sinon l'écran d'ouverture la reprendrait, index.html).
try {
  localStorage.removeItem(BRAND_KEY)
} catch {
  /* stockage indisponible */
}

const brand: AppBrand = {}
/** Titre de l'onglet du navigateur (le <title> d'index.html n'est que celui du premier affichage). */
if (typeof document !== 'undefined') document.title = appNameOf(brand)

/** Identité enregistrée (réglée, sans les défauts). */
export const appBrand = (): AppBrand => brand
/** Nom de l'appli (« Nextar » par défaut). */
export const appName = () => appNameOf(brand)
/** Nom pour les fichiers téléchargés (« nextar »). */
export const appSlug = () => appSlugOf(brand)
/** Logo complet et pictogramme (adresses d'images). */
export const appImages = () => appImagesOf(brand, BASE)

/** Identité de l'appli dans un composant : nom et images. */
export function useAppBrand() {
  return { name: appNameOf(brand), ...appImagesOf(brand, BASE), brand }
}
